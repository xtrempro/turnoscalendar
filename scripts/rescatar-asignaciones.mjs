// Rescate de las asignaciones borradas, con Point-in-Time Recovery.
//
// OJO con el formato: la entrada `weekly_task_assignment_entries` guarda el
// estado en DOS sitios a la vez. El campo `value` es una foto entera que puede
// quedar vieja; el mapa `items` -una clave por SEMANA- es el estado real que
// mantiene la sincronizacion por elemento. Este script trabaja sobre `items`.
// Leer `value` da numeros que parecen sanos cuando ya no lo son.
//
// Por defecto SOLO LEE. Con --apply repone en `items` unicamente las semanas
// que perdieron casillas, dejando el resto tal como esta.
//
// Uso:
//   node scripts/rescatar-asignaciones.mjs --desde 2026-09-03T16:50:00Z
//   node scripts/rescatar-asignaciones.mjs --desde 2026-09-03T16:50:00Z --apply

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

function arg(name, fallback = "") {
    const index = process.argv.indexOf(name);

    return index !== -1 && process.argv[index + 1]
        ? process.argv[index + 1]
        : fallback;
}

const APPLY = process.argv.includes("--apply");
const PROJECT_ID = arg("--project", "calendarioturnos-7c4d9");
const WORKSPACE_ID = arg("--workspace", "Boh7mvO5ku9quFFsPcIq");
const FROM = arg("--desde", "2026-09-03T16:50:00Z");
const OUT = arg("--salida", "asignaciones-rescatadas.json");
// Acota la reposicion a semanas concretas. Sin esto, reponer desde una fecha
// vieja para rescatar UNA semana arrastra a todas las demas a esa misma foto y
// se pierde el trabajo posterior.
const ONLY_WEEKS = arg("--semanas", "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

const DOCUMENTS_ROOT =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    "/databases/(default)/documents";

const ENTRIES_KEY = "weekly_task_assignment_entries";

let cachedAccessToken = "";

function firebaseToolsModule(relativePath) {
    const npmRoot = process.platform === "win32"
        ? path.join(process.env.APPDATA, "npm", "node_modules")
        : execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();

    return require(path.join(npmRoot, "firebase-tools", "lib", relativePath));
}

async function accessToken() {
    if (cachedAccessToken) return cachedAccessToken;

    const auth = firebaseToolsModule("auth.js");
    const account =
        auth.getProjectDefaultAccount(process.cwd()) ||
        auth.getGlobalDefaultAccount();

    if (!account?.tokens?.refresh_token) {
        throw new Error("Ejecuta firebase login antes de continuar.");
    }

    const tokens = await auth.getAccessToken(account.tokens.refresh_token, []);
    cachedAccessToken = tokens.access_token;
    return cachedAccessToken;
}

async function api(url, options = {}) {
    const token = await accessToken();
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-Goog-User-Project": PROJECT_ID,
            ...(options.headers || {})
        }
    });
    const text = await response.text();

    if (response.status === 404) return null;

    if (!response.ok) {
        throw new Error(`${response.status} ${url}\n${text.slice(0, 400)}`);
    }

    return text ? JSON.parse(text) : {};
}

function entryUrl(readTime = "") {
    const url =
        `${DOCUMENTS_ROOT}/workspaces/${WORKSPACE_ID}` +
        `/stateModules/tasks/entries/${encodeURIComponent(ENTRIES_KEY)}`;

    return readTime ? `${url}?readTime=${encodeURIComponent(readTime)}` : url;
}

// El estado real: el mapa `items`, una clave por semana, cada una con el JSON
// de sus casillas. Devuelve { semana: {cellKey: entry} }.
function readItems(doc) {
    const fields = doc?.fields?.items?.mapValue?.fields || {};
    const deleted = doc?.fields?.deletedItems?.mapValue?.fields || {};
    const weeks = {};

    Object.entries(fields).forEach(([week, value]) => {
        if (deleted[week]?.booleanValue === true) return;

        try {
            const parsed = JSON.parse(String(value?.stringValue ?? "null"));

            if (parsed && typeof parsed === "object") weeks[week] = parsed;
        } catch {
            // Una semana ilegible no invalida el resto.
        }
    });

    return weeks;
}

function measure(week) {
    let cells = 0;
    let names = 0;

    Object.values(week || {}).forEach(entry => {
        cells += 1;
        names += (entry?.workers || []).filter(Boolean).length;
    });

    return { cells, names };
}

async function main() {
    console.log(`unidad ${WORKSPACE_ID}`);
    console.log(`bueno  ${FROM}`);
    if (ONLY_WEEKS.length) console.log(`semanas ${ONLY_WEEKS.join(", ")}`);
    console.log(`modo   ${APPLY ? "ESCRITURA (--apply)" : "SOLO LECTURA"}\n`);

    const [goodDoc, liveDoc] = await Promise.all([
        api(entryUrl(FROM)),
        api(entryUrl())
    ]);
    const good = readItems(goodDoc);
    const live = readItems(liveDoc);
    const weeks = [...new Set([...Object.keys(good), ...Object.keys(live)])].sort();
    const damaged = [];

    console.log("semana         antes            ahora           estado");

    weeks.forEach(week => {
        const before = measure(good[week]);
        const after = measure(live[week]);
        const lost = before.names - after.names;

        const inScope = !ONLY_WEEKS.length || ONLY_WEEKS.includes(week);

        if (lost > 0 && inScope) damaged.push(week);

        console.log(
            `  ${week}  ` +
            `${String(before.cells).padStart(3)}c/${String(before.names).padStart(3)}n   ` +
            `${String(after.cells).padStart(3)}c/${String(after.names).padStart(3)}n   ` +
            (lost > 0
                ? (inScope ? `FALTAN ${lost} nombres` : `faltan ${lost}, fuera de alcance`)
                : "ok")
        );
    });

    if (!damaged.length) {
        console.log("\nNada que reponer.");
        return;
    }

    const totalLost = damaged.reduce(
        (sum, week) => sum + (measure(good[week]).names - measure(live[week]).names),
        0
    );

    console.log(`\nSemanas a reponer: ${damaged.join(", ")}`);
    console.log(`Nombres a recuperar: ${totalLost}`);

    writeFileSync(
        OUT,
        JSON.stringify({ readTime: FROM, workspaceId: WORKSPACE_ID, damaged, good }, null, 2),
        "utf8"
    );
    console.log(`Respaldo de las semanas buenas en ${OUT}`);

    if (!APPLY) {
        console.log("\nSOLO LECTURA. Para reponer: --apply");
        return;
    }

    // Se reescribe el mapa `items` COMPLETO: se parte del que hay en vivo y se
    // pisan solo las semanas dañadas con su version buena. Asi lo que no se
    // toco queda intacto y no hace falta escapar rutas de campo por semana.
    const liveItems = liveDoc?.fields?.items?.mapValue?.fields || {};
    const nextItems = { ...liveItems };

    damaged.forEach(week => {
        nextItems[week] = { stringValue: JSON.stringify(good[week]) };
    });

    // `value` es la foto entera que leen los clientes que aun no usan `items`:
    // se deja coherente con lo repuesto, o volveria a discrepar.
    const nextValue = { ...live };

    damaged.forEach(week => {
        nextValue[week] = good[week];
    });

    const stamp = new Date();
    const deletedItems = liveDoc?.fields?.deletedItems?.mapValue?.fields || {};

    damaged.forEach(week => {
        delete deletedItems[week];
    });

    const body = {
        fields: {
            ...liveDoc.fields,
            items: { mapValue: { fields: nextItems } },
            deletedItems: { mapValue: { fields: deletedItems } },
            value: { stringValue: JSON.stringify(nextValue) },
            deleted: { booleanValue: false },
            updatedAt: { timestampValue: stamp.toISOString() },
            updatedAtISO: { stringValue: stamp.toISOString() },
            clientId: { stringValue: `rescate-pitr-${FROM}` }
        }
    };
    const mask = Object.keys(body.fields)
        .map(key => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
        .join("&");

    await api(`${entryUrl()}?${mask}`, {
        method: "PATCH",
        body: JSON.stringify(body)
    });

    const check = readItems(await api(entryUrl()));

    console.log("");
    damaged.forEach(week => {
        const after = measure(check[week]);
        const expected = measure(good[week]);

        console.log(
            `  ${week}: ${after.names}/${expected.names} nombres ` +
            (after.names === expected.names ? "OK" : "REVISAR")
        );
    });
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
