// Retira `value` y compacta lapidas de UNA entrada, con nombre de unidad,
// respaldo, precondicion de version y verificacion posterior. Por defecto lee.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
    assessLegacyValueRemoval,
    compactEntryMaps,
    entryLogicalState
} from "./lib/entry-migration.mjs";
import {
    createFirestoreRestClient,
    firestoreValue,
    plainDocument
} from "./lib/firebase-rest.mjs";

const args = process.argv.slice(2);
const arg = name => {
    const index = args.indexOf(name);
    return index >= 0 ? String(args[index + 1] || "") : "";
};
const PROJECT_ID = arg("--project") || "calendarioturnos-7c4d9";
const WORKSPACE_ID = arg("--workspace");
const EXPECTED_NAME = arg("--expected-name");
const MODULE_ID = arg("--module");
const STORAGE_KEY = arg("--key");
const APPLY = args.includes("--apply");
const REMOVE_VALUE = args.includes("--remove-value");
const COMPACT_TOMBSTONES = args.includes("--compact-tombstones");
const COMPATIBILITY_CLOSED = args.includes("--compatibility-window-closed");

if (!WORKSPACE_ID || !EXPECTED_NAME || !MODULE_ID || !STORAGE_KEY) {
    throw new Error(
        "Usa --workspace, --expected-name, --module y --key. " +
        "La simulacion tambien exige estos datos para evitar revisar otra unidad."
    );
}
if (!REMOVE_VALUE && !COMPACT_TOMBSTONES) {
    throw new Error("Indica --remove-value y/o --compact-tombstones.");
}
if (COMPACT_TOMBSTONES && !COMPATIBILITY_CLOSED) {
    throw new Error(
        "Compactar exige --compatibility-window-closed: una pestana antigua " +
        "podria resucitar datos sin las lapidas."
    );
}

function encodedEntryPath() {
    return `workspaces/${encodeURIComponent(WORKSPACE_ID)}` +
        `/stateModules/${encodeURIComponent(MODULE_ID)}` +
        `/entries/${encodeURIComponent(encodeURIComponent(STORAGE_KEY))}`;
}

function backupName() {
    const safeKey = STORAGE_KEY.replace(/[^a-zA-Z0-9_-]+/g, "_");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    return path.resolve(
        "migration-backups",
        `${PROJECT_ID}_${WORKSPACE_ID}_${MODULE_ID}_${safeKey}_${stamp}.json`
    );
}

const client = await createFirestoreRestClient(PROJECT_ID);
const workspacePath = `workspaces/${encodeURIComponent(WORKSPACE_ID)}`;
const workspaceDocument = await client.getDocument(workspacePath);

if (!workspaceDocument) throw new Error("La unidad no existe.");

const workspace = plainDocument(workspaceDocument);
if (String(workspace.name || "") !== EXPECTED_NAME) {
    throw new Error(
        `ABORTA: se esperaba "${EXPECTED_NAME}" y la unidad es ` +
        `"${workspace.name || "(sin nombre)"}".`
    );
}

const entryPath = encodedEntryPath();
const document = await client.getDocument(entryPath);
if (!document) throw new Error("La entrada indicada no existe.");

const data = plainDocument(document);
const removal = assessLegacyValueRemoval(data);
const compacted = compactEntryMaps(data);

console.log(`Proyecto: ${PROJECT_ID}`);
console.log(`Unidad: ${EXPECTED_NAME} [${WORKSPACE_ID}]`);
console.log(`Entrada: ${MODULE_ID}/${STORAGE_KEY}`);
console.log(`Modo: ${APPLY ? "ESCRITURA" : "SOLO LECTURA"}`);
if (REMOVE_VALUE) {
    console.log(`Retirar value: ${removal.safe ? "SEGURO" : "BLOQUEADO"}`);
    console.log(`  ${removal.reason}`);
}
if (COMPACT_TOMBSTONES) {
    console.log(
        `Compactar: ${compacted.removedTombstones} lapidas y ` +
        `${compacted.removedFalseMarkers} marcadores false`
    );
}

if (REMOVE_VALUE && !removal.safe) {
    throw new Error("No se puede retirar value sin perder datos.");
}
if (!APPLY) {
    console.log("Simulacion terminada. Agrega --apply para escribir.");
    process.exit(0);
}

const backupPath = backupName();
await mkdir(path.dirname(backupPath), { recursive: true });
await writeFile(backupPath, `${JSON.stringify({
    projectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    workspaceName: EXPECTED_NAME,
    moduleId: MODULE_ID,
    storageKey: STORAGE_KEY,
    backedUpAt: new Date().toISOString(),
    document
}, null, 2)}\n`, "utf8");
console.log(`Respaldo: ${backupPath}`);

const fields = {};
const updateMask = [];
if (REMOVE_VALUE) {
    updateMask.push("value", "deleted");
}
if (COMPACT_TOMBSTONES) {
    fields.items = firestoreValue(compacted.items);
    fields.deletedItems = firestoreValue(compacted.deletedItems);
    updateMask.push("items", "deletedItems");
}

await client.patchDocument(
    entryPath,
    fields,
    updateMask,
    document.updateTime
);

const verifiedDocument = await client.getDocument(entryPath);
const verified = plainDocument(verifiedDocument);
const beforeState = entryLogicalState(data, true);
const afterState = entryLogicalState(verified, true);

if (JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
    throw new Error(
        `VERIFICACION FALLIDA. Conserva el respaldo ${backupPath} y no sigas.`
    );
}
if (
    REMOVE_VALUE &&
    Object.prototype.hasOwnProperty.call(verified, "value")
) {
    throw new Error("VERIFICACION FALLIDA: value sigue presente.");
}
if (
    COMPACT_TOMBSTONES &&
    Object.values(verified.deletedItems || {}).some(Boolean)
) {
    throw new Error("VERIFICACION FALLIDA: aun quedan lapidas.");
}

console.log("Verificacion OK: el estado logico se conserva.");
