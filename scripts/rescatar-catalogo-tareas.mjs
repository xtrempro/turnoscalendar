// Rescate del catalogo de tareas perdido, con Point-in-Time Recovery.
//
// Por defecto SOLO LEE: acota a que minuto desaparecio el catalogo, vuelca el
// documento bueno a un archivo y compara las asignaciones de antes y de ahora
// semana por semana. Solo escribe con --apply, y solo el documento del
// catalogo (nunca las asignaciones).
//
// Uso:
//   node scripts/rescatar-catalogo-tareas.mjs                  (diagnostico)
//   node scripts/rescatar-catalogo-tareas.mjs --apply          (repone)
//   node scripts/rescatar-catalogo-tareas.mjs --desde <RFC3339>

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
// La guarda de abajo protege el caso normal: no pisar un catalogo que sigue
// teniendo tareas. Pero un borrado PARCIAL deja sobrevivientes, y entonces la
// guarda impide justo el rescate que hace falta. --forzar es la salida
// explicita, para que pisar sea siempre una decision escrita.
const FORCE = process.argv.includes("--forzar");
const PROJECT_ID = arg("--project", "calendarioturnos-7c4d9");
const WORKSPACE_ID = arg("--workspace", "Boh7mvO5ku9quFFsPcIq");
const FROM = arg("--desde", "");
const OUT = arg("--salida", "catalogo-tareas-rescatado.json");

const DOCUMENTS_ROOT =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    "/databases/(default)/documents";

const TASKS_KEY = "weekly_task_assignment_tasks";
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

async function api(url, options = {}, { allowMissing = false } = {}) {
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

    if (response.status === 404 && allowMissing) return null;

    if (!response.ok) {
        throw new Error(`${response.status} ${url}\n${text.slice(0, 400)}`);
    }

    return text ? JSON.parse(text) : {};
}

function minuteISO(date) {
    const copy = new Date(date);

    copy.setSeconds(0, 0);

    return copy.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function entryUrl(storageKey, readTime = "") {
    const url =
        `${DOCUMENTS_ROOT}/workspaces/${WORKSPACE_ID}` +
        `/stateModules/tasks/entries/${encodeURIComponent(storageKey)}`;

    return readTime ? `${url}?readTime=${encodeURIComponent(readTime)}` : url;
}

function parsedValue(doc) {
    const raw = doc?.fields?.value?.stringValue;

    if (typeof raw !== "string") return null;

    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function taskCountAt(readTime) {
    const doc = await api(
        entryUrl(TASKS_KEY, readTime),
        {},
        { allowMissing: true }
    );
    const value = parsedValue(doc);

    return Array.isArray(value) ? value.length : 0;
}

// Bisecta el minuto en que el catalogo paso de tener tareas a no tenerlas.
async function findLossMinute(goodDate, badDate) {
    let good = new Date(goodDate);
    let bad = new Date(badDate);

    while (bad.getTime() - good.getTime() > 60 * 1000) {
        const middle = new Date((good.getTime() + bad.getTime()) / 2);
        const readTime = minuteISO(middle);
        const count = await taskCountAt(readTime);

        process.stdout.write(`  ${readTime} -> ${count} tareas\n`);

        if (count > 0) {
            good = new Date(readTime);
        } else {
            bad = new Date(readTime);
        }
    }

    return { lastGood: minuteISO(good), firstBad: minuteISO(bad) };
}

function weekCounts(value) {
    const counts = {};

    if (!value || typeof value !== "object") return counts;

    Object.entries(value).forEach(([week, cells]) => {
        counts[week] = Object.keys(cells || {}).length;
    });

    return counts;
}

async function main() {
    console.log(`proyecto  ${PROJECT_ID}`);
    console.log(`unidad    ${WORKSPACE_ID}`);
    console.log(`modo      ${APPLY ? "ESCRITURA (--apply)" : "SOLO LECTURA"}\n`);

    const now = new Date();
    let lastGood = FROM;

    if (!lastGood) {
        console.log("Acotando el minuto del borrado...");

        const window = await findLossMinute(
            new Date(now.getTime() - 12 * 3600 * 1000),
            new Date(now.getTime() - 6 * 3600 * 1000)
        );

        console.log(`\nultimo instante CON tareas: ${window.lastGood}`);
        console.log(`primer instante SIN tareas: ${window.firstBad}\n`);
        lastGood = window.lastGood;
    }

    const goodDoc = await api(entryUrl(TASKS_KEY, lastGood), {}, { allowMissing: true });
    const goodTasks = parsedValue(goodDoc);

    if (!Array.isArray(goodTasks) || !goodTasks.length) {
        throw new Error(`No hay catalogo con tareas en ${lastGood}`);
    }

    writeFileSync(
        OUT,
        JSON.stringify(
            {
                readTime: lastGood,
                workspaceId: WORKSPACE_ID,
                projectId: PROJECT_ID,
                fields: goodDoc.fields,
                tasks: goodTasks
            },
            null,
            2
        ),
        "utf8"
    );

    console.log(`${goodTasks.length} tareas volcadas a ${OUT}`);
    console.log(`campos del documento: ${Object.keys(goodDoc.fields).join(", ")}\n`);

    // Las asignaciones: comparar semana por semana antes y ahora.
    const [beforeDoc, nowDoc] = await Promise.all([
        api(entryUrl(ENTRIES_KEY, lastGood), {}, { allowMissing: true }),
        api(entryUrl(ENTRIES_KEY), {}, { allowMissing: true })
    ]);
    const before = weekCounts(parsedValue(beforeDoc));
    const current = weekCounts(parsedValue(nowDoc));
    const weeks = [...new Set([...Object.keys(before), ...Object.keys(current)])].sort();
    let lost = 0;

    console.log("asignaciones por semana (antes -> ahora):");
    weeks.forEach(week => {
        const from = before[week] || 0;
        const to = current[week] || 0;
        const mark = to < from ? "  <-- FALTAN" : "";

        if (to < from) lost += from - to;

        console.log(`  ${week.padEnd(14)} ${String(from).padStart(4)} -> ${String(to).padStart(4)}${mark}`);
    });

    console.log(
        lost
            ? `\nCasillas perdidas: ${lost}. Hay que reponer tambien las asignaciones.`
            : "\nNinguna casilla perdida: solo falta reponer el catalogo."
    );

    if (!APPLY) {
        console.log("\nSOLO LECTURA. Para reponer el catalogo: --apply");
        return;
    }

    const live = await api(entryUrl(TASKS_KEY), {}, { allowMissing: true });
    const liveTasks = parsedValue(live);

    if (Array.isArray(liveTasks) && liveTasks.length && !FORCE) {
        throw new Error(
            `El catalogo en vivo ya tiene ${liveTasks.length} tareas: ` +
            "no se pisa. Revisa y repite con --forzar si corresponde."
        );
    }

    if (Array.isArray(liveTasks) && liveTasks.length) {
        console.log(
            `
--forzar: se pisan las ${liveTasks.length} tareas en vivo ` +
            `con las ${goodTasks.length} de ${lastGood}.`
        );
    }

    // Se repone el `value` bueno, pero con marca de tiempo NUEVA.
    //
    // Replicar el updatedAt viejo seria un error: una sesion que todavia tenga
    // su catalogo vacio como cambio local pendiente comparia timestamps
    // (isRemoteStateEntryStaleForLocalChange), veria la reposicion como
    // atrasada, la descartaria y volveria a publicar el vacio. Con la hora de
    // ahora, la reposicion gana siempre.
    //
    // `deleted` vuelve a false: es el campo que marcaba la clave como borrada.
    const stamp = new Date();
    const fields = {
        ...goodDoc.fields,
        deleted: { booleanValue: false },
        updatedAt: { timestampValue: stamp.toISOString() },
        updatedAtISO: { stringValue: stamp.toISOString() },
        clientId: { stringValue: `rescate-pitr-${lastGood}` }
    };
    const mask = Object.keys(fields)
        .map(key => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
        .join("&");

    await api(`${entryUrl(TASKS_KEY)}?${mask}`, {
        method: "PATCH",
        body: JSON.stringify({ fields })
    });

    const check = parsedValue(
        await api(entryUrl(TASKS_KEY), {}, { allowMissing: true })
    );

    console.log(
        Array.isArray(check) && check.length === goodTasks.length
            ? `\nOK: catalogo repuesto con ${check.length} tareas.`
            : "\nOJO: la relectura no coincide. Revisar a mano."
    );
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
