// Unifica la escritura de motivos de HHEE en una unidad.
//
// El mismo motivo quedo guardado de varias formas ("APOYO IMAGENOLOGIA - 2",
// "Apoyo Imagenología -2"...). Desde js/motives.js la app ya los trata como
// uno, pero el Anexo 2 y los reportes muestran el texto guardado. Esto deja el
// texto elegido en:
//   - turnos/replacements y turnos/preassignments: el campo `reason` de cada
//     registro, escrito como ITEM (los items mandan sobre `value`; no se toca
//     `value`, ver docs del incidente del 2026-09-15);
//   - turnos/manualExtraReasonPresets: la lista de motivos predefinidos.
// No cambia horas, turnos ni nada mas del registro.
//
// Por defecto SOLO LEE. Con --apply guarda antes una copia de cada documento
// en --respaldo y escribe con precondicion de updateTime (si alguien escribio
// entre medio, falla y se vuelve a correr).
//
//   node scripts/unificar-motivos.mjs --workspace <id> --map mapa.json
//   node scripts/unificar-motivos.mjs --workspace <id> --map mapa.json --apply --respaldo dir
//
// mapa.json: { "texto final": ["variante", ...], ... }. Cada variante se
// compara con motiveKey (mayusculas, tildes y espacios no importan).

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

function arg(name, fallback = "") {
    const index = process.argv.indexOf(name);

    return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const APPLY = process.argv.includes("--apply");
const PROJECT_ID = arg("--project", "calendarioturnos-7c4d9");
const WORKSPACE_ID = arg("--workspace");
const MAP_FILE = arg("--map");
const BACKUP_DIR = arg("--respaldo");
const MODULE_ID = "turnos";

if (!WORKSPACE_ID || !MAP_FILE) throw new Error("Faltan --workspace y --map.");
if (APPLY && !BACKUP_DIR) throw new Error("Con --apply, indica --respaldo <carpeta>.");

const { mergePartialStateEntries, decodePartialStateItemKey, encodePartialStateItemKey } =
    await import(pathToFileURL(path.resolve("js/firebasePartialState.js")).href);
const { motiveKey } = await import(pathToFileURL(path.resolve("js/motives.js")).href);

// variante (clave) -> texto final
const targetByKey = new Map();

Object.entries(JSON.parse(readFileSync(MAP_FILE, "utf8"))).forEach(([target, variants]) => {
    [target, ...variants].forEach(variant => targetByKey.set(motiveKey(variant), target));
});

const entryUrl = key =>
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/workspaces/${WORKSPACE_ID}` +
    `/stateModules/${MODULE_ID}/entries/${encodeURIComponent(encodeURIComponent(key))}`;

let cachedAccessToken = "";

async function accessToken() {
    if (cachedAccessToken) return cachedAccessToken;

    const auth = require(path.join(process.env.APPDATA, "npm", "node_modules", "firebase-tools", "lib", "auth.js"));
    const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount();

    if (!account?.tokens?.refresh_token) throw new Error("Ejecuta firebase login antes de continuar.");

    cachedAccessToken = (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token;
    return cachedAccessToken;
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

    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${response.status} ${url}\n${text.slice(0, 400)}`);

    return text ? JSON.parse(text) : {};
}

function fieldValue(value) {
    if (!value) return undefined;
    if ("stringValue" in value) return value.stringValue;
    if ("booleanValue" in value) return value.booleanValue;
    if ("mapValue" in value) {
        return Object.fromEntries(
            Object.entries(value.mapValue.fields || {}).map(([key, inner]) => [key, fieldValue(inner)])
        );
    }
    return undefined;
}

// La lista como la lee la app: value + items + deletedItems.
function readList(doc, key) {
    const data = Object.fromEntries(
        Object.entries(doc?.fields || {}).map(([field, value]) => [field, fieldValue(value)])
    );
    const base = { moduleId: MODULE_ID, storageKey: key };
    const entries = [];

    if (Object.prototype.hasOwnProperty.call(data, "value")) {
        entries.push({ ...base, itemKey: "", value: data.value, deleted: data.deleted === true });
    }

    const deleted = data.deletedItems || {};

    new Set([...Object.keys(data.items || {}), ...Object.keys(deleted)]).forEach(itemKey => {
        entries.push({
            ...base,
            itemKey: decodePartialStateItemKey(itemKey),
            container: data.container || "",
            value: data.items?.[itemKey],
            deleted: deleted[itemKey] === true
        });
    });

    const list = JSON.parse(mergePartialStateEntries({}, entries)[key] || "[]");

    return { list: Array.isArray(list) ? list : [], hasItems: Boolean(Object.keys(data.items || {}).length) };
}

function targetFor(text) {
    const value = String(text ?? "").trim();

    if (!value) return null;

    const target = targetByKey.get(motiveKey(value));

    return target && target !== value ? target : null;
}

function backup(key, doc) {
    mkdirSync(BACKUP_DIR, { recursive: true });
    writeFileSync(path.join(BACKUP_DIR, `${WORKSPACE_ID}-${key}-${doc.updateTime.replace(/[:.]/g, "-")}.json`), JSON.stringify(doc));
}

async function patch(key, doc, fields) {
    const stamp = new Date().toISOString();
    const body = {
        fields: {
            ...fields,
            updatedAt: { timestampValue: stamp },
            updatedAtISO: { stringValue: stamp },
            clientId: { stringValue: "unificar-motivos" }
        }
    };
    const mask = Object.keys(body.fields).map(field => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join("&");

    await api(
        `${entryUrl(key)}?${mask}&currentDocument.updateTime=${encodeURIComponent(doc.updateTime)}`,
        { method: "PATCH", body: JSON.stringify(body) }
    );
}

// Registros con id: solo los que cambian, como items.
async function unifyRecords(key) {
    const doc = await api(entryUrl(key));

    if (!doc) {
        console.log(`${key}: no existe`);
        return;
    }

    const { list } = readList(doc, key);
    const changes = list
        .filter(record => record?.id && targetFor(record.reason))
        .map(record => ({ before: record.reason, record: { ...record, reason: targetFor(record.reason) } }));
    const tally = {};

    changes.forEach(change => {
        const label = `${change.before} -> ${change.record.reason}`;

        tally[label] = (tally[label] || 0) + 1;
    });

    console.log(`\n${key}: ${list.length} registros, ${changes.length} a unificar (updateTime ${doc.updateTime})`);
    Object.entries(tally).forEach(([label, count]) => console.log(`   ${count}  ${label}`));

    if (!APPLY || !changes.length) return;

    backup(key, doc);

    const nextItems = { ...(doc.fields?.items?.mapValue?.fields || {}) };
    const nextDeleted = { ...(doc.fields?.deletedItems?.mapValue?.fields || {}) };

    changes.forEach(({ record }) => {
        const itemKey = encodePartialStateItemKey(record.id);

        nextItems[itemKey] = { stringValue: JSON.stringify(record) };
        nextDeleted[itemKey] = { booleanValue: false };
    });

    await patch(key, doc, {
        items: { mapValue: { fields: nextItems } },
        deletedItems: { mapValue: { fields: nextDeleted } },
        container: { stringValue: "array" }
    });

    const check = readList(await api(entryUrl(key)), key);
    const left = check.list.filter(record => targetFor(record?.reason)).length;

    console.log(`   verificacion: ${check.list.length} registros (antes ${list.length}), variantes que quedan: ${left} ${check.list.length === list.length && !left ? "OK" : "REVISAR"}`);
}

// Lista de textos (sin id): se reescribe entera, sin repetidos.
async function unifyPresets(key) {
    const doc = await api(entryUrl(key));

    if (!doc) {
        console.log(`\n${key}: no existe`);
        return;
    }

    const { list, hasItems } = readList(doc, key);
    const seen = new Set();
    const next = [];

    list.forEach(text => {
        const value = targetFor(text) || String(text ?? "").trim();
        const valueKey = motiveKey(value);

        if (!value || seen.has(valueKey)) return;

        seen.add(valueKey);
        next.push(value);
    });

    const changed = JSON.stringify(next) !== JSON.stringify(list);

    console.log(`\n${key}: ${list.length} -> ${next.length} ${changed ? "(cambia)" : "(sin cambios)"}${hasItems ? " [tiene items: NO se escribe]" : ""}`);
    if (changed) console.log(`   ${JSON.stringify(next)}`);

    if (!APPLY || !changed) return;

    if (hasItems) {
        console.log("   omitido: la lista de textos tiene items; revisar a mano.");
        return;
    }

    backup(key, doc);
    await patch(key, doc, { value: { stringValue: JSON.stringify(next) } });

    const check = readList(await api(entryUrl(key)), key);

    console.log(`   verificacion: ${JSON.stringify(check.list) === JSON.stringify(next) ? "OK" : "REVISAR"}`);
}

console.log(`unidad ${WORKSPACE_ID}`);
console.log(`modo   ${APPLY ? "ESCRITURA (--apply)" : "SOLO LECTURA"}`);

await unifyRecords("replacements");
await unifyRecords("preassignments");
await unifyPresets("manualExtraReasonPresets");

if (!APPLY) console.log("\nSOLO LECTURA. Para escribir: --apply --respaldo <carpeta>");
