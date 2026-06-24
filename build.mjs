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

const DIST = "dist";

// 1) Limpiar dist/
rmSync(DIST, { recursive: true, force: true });
mkdirSync(path.join(DIST, "assets"), { recursive: true });

// 2) Empaquetar + minificar el JS con hash de contenido en el nombre
const result = await esbuild.build({
    entryPoints: ["js/main.js"],
    bundle: true,
    minify: true,
    format: "esm",
    charset: "utf8",
    target: ["es2020"],
    legalComments: "none",
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

// 3) Copiar assets estaticos tal cual
writeFileSync(
    path.join(DIST, "styles.css"),
    readFileSync("styles.css")
);
for (const dir of ["img", "reports"]) {
    if (existsSync(dir)) {
        cpSync(dir, path.join(DIST, dir), { recursive: true });
    }
}

// 4) Reescribir index.html para apuntar al bundle con hash
let html = readFileSync("index.html", "utf8");
const before = 'src="js/main.js"';
const after = `src="${jsHref}"`;
if (!html.includes(before)) {
    console.error(`No se encontro '${before}' en index.html.`);
    process.exit(1);
}
html = html.replace(before, after);
writeFileSync(path.join(DIST, "index.html"), html, "utf8");

const sizeKb = (readFileSync(jsOutput).length / 1024).toFixed(0);
console.log(`\nOK: ${jsHref} (${sizeKb} KB minificado) + index.html + styles.css + img/ + reports/ -> ${DIST}/`);
