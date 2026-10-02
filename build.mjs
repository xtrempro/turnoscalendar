// Build de produccion: empaqueta y minifica el JS (los 77 modulos -> 1 archivo
// con hash) y arma la carpeta dist/ que Firebase publica.
//
// - JS: dist/assets/app-[hash].js (cacheable "para siempre" por el hash).
// - styles.css, img/, reports/: se copian tal cual (referencias relativas).
// - index.html: se reescribe para apuntar al bundle con hash.
//
// El SDK de Firebase se carga por import() dinamico desde CDN: esbuild lo deja
// como import en tiempo de ejecucion (no se empaqueta).

import * as esbuild from "esbuild";
import { rmSync, mkdirSync, cpSync, readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { buildObfuscatedTree, PROTECTED_MODULES } from "./scripts/obfuscate-engine.mjs";
import { currentBuildId } from "./scripts/build-id.mjs";

const DIST = "dist";
// Carpeta temporal con la copia de js/ que lleva los motores ofuscados. Vive
// dentro de node_modules para que no la tome ninguna herramienta del proyecto.
const OBF_DIR = path.join("node_modules", ".turnoplus-build");
// Escotilla para depurar: "npm run build:legible" deja el bundle sin ofuscar.
// No usarla para publicar.
const OBFUSCATE = !process.argv.includes("--legible");
// Identificador de este build: viaja en cada registro nuevo de la bitacora
// (js/auditLogVersion.js). Se genera antes de empaquetar.
const AUDIT_BUILD_ID = currentBuildId();

// 1) Limpiar dist/
rmSync(DIST, { recursive: true, force: true });
mkdirSync(path.join(DIST, "assets"), { recursive: true });

// 1.5) Preparar el arbol de fuentes desde el que se empaqueta. Con ofuscacion
// activa es una copia de js/ con los motores transformados; el codigo fuente no
// se toca nunca.
let sourceRoot = "js";

if (OBFUSCATE) {
    const { obfuscated } = buildObfuscatedTree(OBF_DIR);

    sourceRoot = path.join(OBF_DIR, "js");
    console.log(
        `Motores ofuscados (${obfuscated.length}): ` +
        obfuscated.map(file => path.basename(file)).join(", ")
    );
} else {
    console.warn("--legible: el bundle sale SIN ofuscar. No publicar asi.");
}

const entry = (relative) => path.join(sourceRoot, relative);

// 2) Empaquetar el Web Worker por separado. Su URL con hash se inyecta luego
// en el bundle principal para que el navegador lo cargue como módulo.
const workerResult = await esbuild.build({
    entryPoints: [entry("workers/scheduleWorker.js")],
    bundle: true,
    minify: true,
    format: "esm",
    charset: "utf8",
    target: ["es2020"],
    legalComments: "none",
    entryNames: "schedule-worker-[hash]",
    outdir: path.join(DIST, "assets"),
    metafile: true,
    logLevel: "info"
});
const workerOutput = Object.keys(workerResult.metafile.outputs)
    .find(file => file.endsWith(".js"));

if (!workerOutput) {
    console.error("No se genero el Web Worker de calculos.");
    process.exit(1);
}

const workerHref = "/assets/" + path.basename(workerOutput);

// 3) Empaquetar + minificar el JS con hash de contenido en el nombre
const result = await esbuild.build({
    entryPoints: [entry("main.js")],
    bundle: true,
    minify: true,
    format: "esm",
    charset: "utf8",
    target: ["es2020"],
    legalComments: "none",
    define: {
        __SCHEDULE_WORKER_URL__: JSON.stringify(workerHref),
        __TURNOPLUS_AUDIT_BUILD_ID__: JSON.stringify(AUDIT_BUILD_ID)
    },
    entryNames: "app-[hash]",
    outdir: path.join(DIST, "assets"),
    metafile: true,
    logLevel: "info"
});

const jsOutput = Object.keys(result.metafile.outputs)
    .find(file => file.endsWith(".js"));
if (!jsOutput) {
    console.error("No se genero el bundle JS.");
    process.exit(1);
}
const jsHref = "assets/" + path.basename(jsOutput);

// 4) Copiar assets estaticos tal cual
writeFileSync(
    path.join(DIST, "styles.css"),
    readFileSync("styles.css")
);
const buildId = path.basename(jsOutput, ".js").replace(/^app-/, "");
let serviceWorkerSource = readFileSync("sw.js", "utf8");
if (!serviceWorkerSource.includes("__TURNOPLUS_BUILD_ID__")) {
    console.error("No se encontro el marcador de version en sw.js.");
    process.exit(1);
}
serviceWorkerSource = serviceWorkerSource.replaceAll(
    "__TURNOPLUS_BUILD_ID__",
    buildId
);
writeFileSync(path.join(DIST, "sw.js"), serviceWorkerSource, "utf8");
writeFileSync(
    path.join(DIST, "manifest.webmanifest"),
    readFileSync("manifest.webmanifest")
);
for (const dir of ["img", "reports"]) {
    if (existsSync(dir)) {
        cpSync(dir, path.join(DIST, dir), { recursive: true });
    }
}

// 5) Reescribir index.html para apuntar al bundle con hash
let html = readFileSync("index.html", "utf8");
const before = 'src="js/main.js"';
const after = `src="${jsHref}"`;
if (!html.includes(before)) {
    console.error(`No se encontro '${before}' en index.html.`);
    process.exit(1);
}
html = html.replace(before, after);
writeFileSync(path.join(DIST, "index.html"), html, "utf8");

rmSync(OBF_DIR, { recursive: true, force: true });

const sizeKb = (readFileSync(jsOutput).length / 1024).toFixed(0);
const workerSizeKb = (readFileSync(workerOutput).length / 1024).toFixed(0);
console.log(
    `\nOK: ${jsHref} (${sizeKb} KB) + ${workerHref} (${workerSizeKb} KB) ` +
    `+ index.html + styles.css + manifest.webmanifest + img/ + reports/ -> ${DIST}/`
);

if (OBFUSCATE) {
    console.log(
        `Protegidos: ${PROTECTED_MODULES.map(file => path.basename(file)).join(", ")}`
    );
}
