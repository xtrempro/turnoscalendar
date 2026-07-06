import {
    brotliCompressSync,
    constants as zlibConstants,
    gzipSync
} from "node:zlib";
import {
    readFileSync,
    readdirSync,
    statSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
);
const DIST = path.join(ROOT, "dist");
const BASELINE_PATH = path.join(
    ROOT,
    "security",
    "client-build-baseline.json"
);
const TEXT_EXTENSIONS = new Set([
    ".css",
    ".html",
    ".js",
    ".json",
    ".txt",
    ".webmanifest"
]);
const ALLOWED_ROOT_ENTRIES = new Set([
    "assets",
    "img",
    "index.html",
    "manifest.webmanifest",
    "reports",
    "styles.css",
    "sw.js"
]);
const FORBIDDEN_SECRET_PATTERNS = [
    {
        label: "clave privada",
        pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
    },
    {
        label: "credencial de cuenta de servicio",
        pattern: /["']private_key["']\s*:/i
    },
    {
        label: "token privado de GitHub",
        pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/
    },
    {
        label: "clave privada de OpenAI",
        pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/
    },
    {
        label: "clave privada de Stripe",
        pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/
    },
    {
        label: "secreto de Resend",
        pattern: /\bre_[A-Za-z0-9_-]{24,}\b/
    }
];

function fail(message) {
    throw new Error(`Build p\u00fablico inseguro: ${message}`);
}

function walk(directory) {
    return readdirSync(directory, { withFileTypes: true })
        .flatMap(entry => {
            const absolute = path.join(directory, entry.name);

            return entry.isDirectory()
                ? walk(absolute)
                : [absolute];
        });
}

function relative(file) {
    return path.relative(DIST, file).replaceAll("\\", "/");
}

function findSingleAsset(files, pattern, label) {
    const matches = files.filter(file =>
        pattern.test(relative(file))
    );

    if (matches.length !== 1) {
        fail(`se esperaba un solo ${label}; encontrados: ${matches.length}.`);
    }

    return matches[0];
}

function compressedSizes(file) {
    const content = readFileSync(file);

    return {
        raw: content.length,
        gzip: gzipSync(content, { level: 9 }).length,
        brotli: brotliCompressSync(content, {
            params: {
                [zlibConstants.BROTLI_PARAM_QUALITY]: 11
            }
        }).length
    };
}

function formatKilobytes(bytes) {
    return `${(bytes / 1024).toFixed(1)} KB`;
}

function verifyBudget(name, sizes, baseline, increasePercent) {
    for (const encoding of ["raw", "gzip", "brotli"]) {
        const base = Number(baseline?.[encoding]);

        if (!Number.isFinite(base) || base <= 0) {
            fail(`falta la l\u00ednea base ${name}.${encoding}.`);
        }

        const maximum = Math.ceil(base * (1 + increasePercent / 100));

        if (sizes[encoding] > maximum) {
            fail(
                `${name}.${encoding} pesa ${sizes[encoding]} bytes; ` +
                `supera el m\u00e1ximo de ${maximum} bytes ` +
                `(${increasePercent}% sobre la l\u00ednea base).`
            );
        }
    }
}

if (!statSync(DIST, { throwIfNoEntry: false })?.isDirectory()) {
    fail("no existe dist/. Ejecuta npm run build primero.");
}

const rootEntries = readdirSync(DIST);
const unexpectedRootEntries = rootEntries.filter(entry =>
    !ALLOWED_ROOT_ENTRIES.has(entry)
);

if (unexpectedRootEntries.length) {
    fail(
        `hay elementos inesperados en dist/: ` +
        unexpectedRootEntries.join(", ")
    );
}

const files = walk(DIST);
const forbiddenFiles = files.filter(file => {
    const name = path.basename(file).toLowerCase();
    return (
        name.endsWith(".map") ||
        name.startsWith(".env") ||
        name.includes("firebase-debug") ||
        name.endsWith(".pem") ||
        name.endsWith(".key")
    );
});

if (forbiddenFiles.length) {
    fail(
        `se encontraron archivos privados: ` +
        forbiddenFiles.map(relative).join(", ")
    );
}

for (const file of files) {
    if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;

    const content = readFileSync(file, "utf8");

    if (/\/(?:\/|\*)# sourceMappingURL=/.test(content)) {
        fail(`${relative(file)} referencia un mapa de fuentes.`);
    }

    for (const secret of FORBIDDEN_SECRET_PATTERNS) {
        if (secret.pattern.test(content)) {
            fail(`${relative(file)} contiene ${secret.label}.`);
        }
    }
}

const appFile = findSingleAsset(
    files,
    /^assets\/app-[A-Z0-9]+\.js$/,
    "bundle principal con hash"
);
const workerFile = findSingleAsset(
    files,
    /^assets\/schedule-worker-[A-Z0-9]+\.js$/,
    "Web Worker con hash"
);
const stylesFile = path.join(DIST, "styles.css");
const indexHTML = readFileSync(path.join(DIST, "index.html"), "utf8");

if (indexHTML.includes('src="js/main.js"')) {
    fail("index.html todav\u00eda carga el c\u00f3digo fuente sin empaquetar.");
}

if (!indexHTML.includes(`src="assets/${path.basename(appFile)}"`)) {
    fail("index.html no referencia el bundle principal generado.");
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
const allowedIncreasePercent = Number(baseline.allowedIncreasePercent);

if (
    !Number.isFinite(allowedIncreasePercent) ||
    allowedIncreasePercent < 0
) {
    fail("allowedIncreasePercent no es v\u00e1lido.");
}

const measurements = {
    app: compressedSizes(appFile),
    scheduleWorker: compressedSizes(workerFile),
    styles: compressedSizes(stylesFile)
};

Object.entries(measurements).forEach(([name, sizes]) => {
    verifyBudget(
        name,
        sizes,
        baseline.assets?.[name],
        allowedIncreasePercent
    );
});

console.log("Build p\u00fablico verificado: sin mapas ni secretos detectables.");
Object.entries(measurements).forEach(([name, sizes]) => {
    console.log(
        `${name}: ${formatKilobytes(sizes.raw)} raw | ` +
        `${formatKilobytes(sizes.gzip)} gzip | ` +
        `${formatKilobytes(sizes.brotli)} brotli`
    );
});
console.log(
    `Margen m\u00e1ximo: ${allowedIncreasePercent}% sobre ` +
    "security/client-build-baseline.json."
);
