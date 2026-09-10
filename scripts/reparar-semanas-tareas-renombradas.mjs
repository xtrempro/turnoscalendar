// Repara las semanas que perdieron sus casillas cuando el supervisor BORRO y
// RECREO tareas con el mismo nombre (2026-09-07/08 en Imagenologia): al morir
// la tarea vieja se llevo sus asignaciones, y las nuevas nacieron con otro id.
//
// La casilla lleva el id DENTRO de la clave (`day|<taskId>|<keyDay>`), asi que
// reapuntarla es reescribir la clave, no un campo.
//
// Empareja por nombre normalizado (sin tildes ni mayusculas) y admite renombres
// explicitos en RENOMBRES. Nunca pisa una casilla que ya exista en vivo: la
// version viva es la mas reciente y manda.
//
// Por defecto SOLO LEE. Uso:
//   node scripts/reparar-semanas-tareas-renombradas.mjs
//   node scripts/reparar-semanas-tareas-renombradas.mjs --apply

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
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
const SNAP_DIR = arg("--snapshots", ".");
const ROOT =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    "/databases/(default)/documents";

// Semana -> archivo de snapshot con su version buena.
const FUENTES = [
    ["2026-08-24", "snapshot-2026-09-03.json"],
    ["2026-08-31", "snapshot-2026-09-06.json"]
];

// Renombres confirmados por el supervisor: cambio el nombre, la tarea es la misma.
const RENOMBRES = {
    "SCANNER PHILLIPS": "ESCANER",
    "RELEVO EXTRA RX": "RELEVO RX"
};

// Tareas borradas que hay que RECREAR porque no tienen equivalente actual.
const RECREAR = ["RONDA RX PORTATIL"];

// Instante del que se leen las definiciones de las tareas viejas.
const CATALOGO_VIEJO = arg("--catalogo-viejo", "2026-09-06T23:58:00Z");

let cachedToken = "";

async function accessToken() {
    if (cachedToken) return cachedToken;

    const auth = require(path.join(
        process.env.APPDATA, "npm", "node_modules", "firebase-tools", "lib", "auth.js"
    ));
    const account =
        auth.getProjectDefaultAccount(process.cwd()) ||
        auth.getGlobalDefaultAccount();

    if (!account?.tokens?.refresh_token) {
        throw new Error("Ejecuta firebase login antes de continuar.");
    }

    cachedToken = (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token;
    return cachedToken;
}

async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${await accessToken()}`,
            "Content-Type": "application/json",
            "X-Goog-User-Project": PROJECT_ID,
            ...(options.headers || {})
        }
    });
    const text = await response.text();

    if (!response.ok) throw new Error(`${response.status} ${url}\n${text.slice(0, 400)}`);

    return text ? JSON.parse(text) : {};
}

const entryUrl = (key, readTime = "") =>
    `${ROOT}/workspaces/${WORKSPACE_ID}/stateModules/tasks/entries/${encodeURIComponent(key)}` +
    (readTime ? `?readTime=${encodeURIComponent(readTime)}` : "");

const clave = (value) => String(value || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

function parseValue(doc) {
    try {
        return JSON.parse(String(doc?.fields?.value?.stringValue ?? "null"));
    } catch {
        return null;
    }
}

function readWeeks(doc) {
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

const nombresDe = (cell) => (cell?.workers || []).filter(Boolean).length;
const contarNombres = (cells) =>
    Object.values(cells || {}).reduce((sum, cell) => sum + nombresDe(cell), 0);

async function main() {
    console.log(`unidad ${WORKSPACE_ID}`);
    console.log(`modo   ${APPLY ? "ESCRITURA (--apply)" : "SOLO LECTURA"}\n`);

    const [catalogoVivo, catalogoViejo, asignaciones] = await Promise.all([
        api(entryUrl("weekly_task_assignment_tasks")),
        api(entryUrl("weekly_task_assignment_tasks", CATALOGO_VIEJO)),
        api(entryUrl("weekly_task_assignment_entries"))
    ]);

    const vivas = parseValue(catalogoVivo) || [];
    const viejas = parseValue(catalogoViejo) || [];
    const vivasPorNombre = new Map(vivas.map(task => [clave(task.title || task.name), task]));
    const viejasPorId = new Map(viejas.map(task => [task.id, task]));
    const vivasIds = new Set(vivas.map(task => task.id));

    const mapa = new Map();
    const sinDestino = [];
    const aRecrear = [];

    viejas.forEach(task => {
        const nombre = clave(task.title || task.name);
        const destinoNombre = RENOMBRES[nombre] ? clave(RENOMBRES[nombre]) : nombre;
        const destino = vivasPorNombre.get(destinoNombre);

        if (destino) {
            if (destino.id !== task.id) mapa.set(task.id, destino.id);
            return;
        }

        if (RECREAR.includes(nombre)) {
            aRecrear.push(task);
            mapa.set(task.id, task.id);
            return;
        }

        sinDestino.push(task);
    });

    console.log("--- tareas viejas ---");
    mapa.forEach((nuevo, viejo) => {
        const vieja = viejasPorId.get(viejo);
        const destino = vivas.find(task => task.id === nuevo) || vieja;

        console.log(
            `  ${String(vieja?.title || vieja?.name).padEnd(22)} -> ` +
            `${String(destino?.title || destino?.name).padEnd(22)}` +
            `${viejo === nuevo ? "  (se recrea)" : ""}`
        );
    });
    sinDestino.forEach(task =>
        console.log(`  ${String(task.title || task.name).padEnd(22)} -> SIN DESTINO (se omite)`)
    );

    const live = readWeeks(asignaciones);
    const resultado = {};
    let repuestos = 0;
    let omitidos = 0;
    let colisiones = 0;

    console.log("\n--- semanas ---");

    for (const [week, file] of FUENTES) {
        const snap = JSON.parse(readFileSync(path.join(SNAP_DIR, file), "utf8"));
        const bueno = snap.good?.[week] || {};
        const actual = { ...(live[week] || {}) };

        Object.entries(bueno).forEach(([cellKey, cell]) => {
            const cuantos = nombresDe(cell);

            if (!cuantos) return;

            const partes = String(cellKey).split("|");
            const viejoId = partes[1] || "";
            // Si ya apunta a una tarea viva, se copia tal cual.
            const nuevoId = vivasIds.has(viejoId) ? viejoId : mapa.get(viejoId);

            if (!nuevoId) {
                omitidos += cuantos;
                return;
            }

            partes[1] = nuevoId;
            const nuevaClave = partes.join("|");

            // La version VIVA es la mas reciente: nunca se pisa.
            if (actual[nuevaClave]) {
                colisiones += 1;
                return;
            }

            actual[nuevaClave] = cell;
            repuestos += cuantos;
        });

        resultado[week] = actual;

        console.log(
            `  ${week}  ` +
            `${String(Object.keys(live[week] || {}).length).padStart(3)}c/` +
            `${String(contarNombres(live[week])).padStart(3)}n  ->  ` +
            `${String(Object.keys(actual).length).padStart(3)}c/` +
            `${String(contarNombres(actual)).padStart(3)}n`
        );
    }

    console.log(
        `\nnombres repuestos ${repuestos}   omitidos ${omitidos}   ` +
        `casillas ya presentes ${colisiones}`
    );

    if (aRecrear.length) {
        console.log(`tareas a recrear: ${aRecrear.map(t => t.title || t.name).join(", ")}`);
    }

    if (!APPLY) {
        console.log("\nSOLO LECTURA. Para reparar: --apply");
        return;
    }

    const stamp = new Date();

    // 1) Catalogo: se recrean las tareas sin equivalente, revirtiendo su lapida.
    if (aRecrear.length) {
        const items = { ...(catalogoVivo.fields?.items?.mapValue?.fields || {}) };
        const deletedItems = { ...(catalogoVivo.fields?.deletedItems?.mapValue?.fields || {}) };
        const lista = [...vivas];

        aRecrear.forEach(task => {
            items[task.id] = { stringValue: JSON.stringify(task) };
            delete deletedItems[task.id];
            if (!lista.some(item => item.id === task.id)) lista.push(task);
        });

        const fields = {
            ...catalogoVivo.fields,
            items: { mapValue: { fields: items } },
            deletedItems: { mapValue: { fields: deletedItems } },
            value: { stringValue: JSON.stringify(lista) },
            deleted: { booleanValue: false },
            updatedAt: { timestampValue: stamp.toISOString() },
            updatedAtISO: { stringValue: stamp.toISOString() },
            clientId: { stringValue: "reparacion-tareas-renombradas" }
        };
        const mask = Object.keys(fields)
            .map(key => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
            .join("&");

        await api(`${entryUrl("weekly_task_assignment_tasks")}?${mask}`, {
            method: "PATCH",
            body: JSON.stringify({ fields })
        });

        console.log(`\nCatalogo: ${lista.length} tareas.`);
    }

    // 2) Asignaciones: solo las semanas tocadas, y con hora ACTUAL para que
    //    ninguna sesion crea obsoleta la reposicion y la vuelva a pisar.
    const items = { ...(asignaciones.fields?.items?.mapValue?.fields || {}) };
    const deletedItems = { ...(asignaciones.fields?.deletedItems?.mapValue?.fields || {}) };
    const nextValue = { ...live };

    Object.entries(resultado).forEach(([week, cells]) => {
        items[week] = { stringValue: JSON.stringify(cells) };
        nextValue[week] = cells;
        delete deletedItems[week];
    });

    const fields = {
        ...asignaciones.fields,
        items: { mapValue: { fields: items } },
        deletedItems: { mapValue: { fields: deletedItems } },
        value: { stringValue: JSON.stringify(nextValue) },
        deleted: { booleanValue: false },
        updatedAt: { timestampValue: stamp.toISOString() },
        updatedAtISO: { stringValue: stamp.toISOString() },
        clientId: { stringValue: "reparacion-tareas-renombradas" }
    };
    const mask = Object.keys(fields)
        .map(key => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
        .join("&");

    await api(`${entryUrl("weekly_task_assignment_entries")}?${mask}`, {
        method: "PATCH",
        body: JSON.stringify({ fields })
    });

    const check = readWeeks(await api(entryUrl("weekly_task_assignment_entries")));

    Object.keys(resultado).forEach(week => {
        const hay = contarNombres(check[week]);
        const esperado = contarNombres(resultado[week]);

        console.log(`  ${week}: ${hay}/${esperado} nombres ${hay === esperado ? "OK" : "REVISAR"}`);
    });
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
