// Compara auditLog legacy con los fragmentos diarios. Por defecto solo lee;
// --apply crea o completa fragmentos, nunca borra registros archivados.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { groupAuditLogsByShard } from "../js/auditLogShardStore.js";
import { entryLogicalState } from "./lib/entry-migration.mjs";
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
const APPLY = args.includes("--apply");

if (!WORKSPACE_ID || !EXPECTED_NAME) {
    throw new Error("Usa --workspace y --expected-name.");
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== "object") return value;

    return Object.fromEntries(
        Object.keys(value).sort().map(key => [key, canonical(value[key])])
    );
}

function signature(value) {
    return JSON.stringify(canonical(value));
}

function shardLogs(documents) {
    const byId = new Map();

    documents.forEach(document => {
        const data = plainDocument(document);

        Object.values(data.items || {}).forEach(raw => {
            try {
                const log = JSON.parse(String(raw || "null"));
                const id = String(log?.id || "").trim();
                if (id) byId.set(id, log);
            } catch {
                // Se informa como documento invalido mas abajo por conteo.
            }
        });
    });

    return byId;
}

function backupPath() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return path.resolve(
        "migration-backups",
        `${PROJECT_ID}_${WORKSPACE_ID}_audit-shards_${stamp}.json`
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

const legacyPath = `${workspacePath}/stateModules/log/entries/auditLog`;
const legacyDocument = await client.getDocument(legacyPath);
if (!legacyDocument) throw new Error("No existe log/auditLog.");

const legacyData = plainDocument(legacyDocument);
const legacyLogs = entryLogicalState(legacyData, true);
if (!Array.isArray(legacyLogs)) {
    throw new Error("No se pudo reconstruir auditLog de forma segura.");
}

const collectionPath = `${workspacePath}/auditLogShards`;
let shardDocuments = await client.listDocuments(collectionPath);
const archived = shardLogs(shardDocuments);
const missingOrDifferent = legacyLogs.filter(log => {
    const current = archived.get(String(log.id || ""));
    return !current || signature(current) !== signature(log);
});
const archiveOnly = [...archived.keys()].filter(id =>
    !legacyLogs.some(log => String(log.id || "") === id)
);

console.log(`Proyecto: ${PROJECT_ID}`);
console.log(`Unidad: ${EXPECTED_NAME} [${WORKSPACE_ID}]`);
console.log(`Modo: ${APPLY ? "BACKFILL" : "SOLO LECTURA"}`);
console.log(
    `Legacy=${legacyLogs.length}; archivados=${archived.size}; ` +
    `faltantes/distintos=${missingOrDifferent.length}; ` +
    `solo archivo=${archiveOnly.length}`
);

if (!APPLY) {
    console.log("Simulacion terminada. Agrega --apply para crear/completar fragmentos.");
    process.exitCode = missingOrDifferent.length ? 2 : 0;
    process.exit();
}

const savedBackupPath = backupPath();
await mkdir(path.dirname(savedBackupPath), { recursive: true });
await writeFile(savedBackupPath, `${JSON.stringify({
    projectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    workspaceName: EXPECTED_NAME,
    backedUpAt: new Date().toISOString(),
    legacyDocument,
    shardDocuments
}, null, 2)}\n`, "utf8");
console.log(`Respaldo: ${savedBackupPath}`);

const documentsById = new Map(shardDocuments.map(document => [
    String(document.name || "").split("/").pop(),
    document
]));
const groups = groupAuditLogsByShard(missingOrDifferent);

for (const group of groups) {
    const currentDocument = documentsById.get(group.documentId);
    const current = currentDocument ? plainDocument(currentDocument) : {};
    const items = { ...(current.items || {}) };

    group.logs.forEach(log => {
        items[encodeURIComponent(String(log.id)).replace(/\./g, "%2E")] =
            JSON.stringify(log);
    });

    const now = new Date().toISOString();
    await client.patchDocument(
        `${collectionPath}/${group.documentId}`,
        {
            month: firestoreValue(group.month),
            day: firestoreValue(group.day),
            shard: firestoreValue(group.shard),
            items: firestoreValue(items),
            clientId: firestoreValue("audit-log-shard-backfill-v1"),
            updatedAtISO: firestoreValue(now),
            updatedAt: { timestampValue: now }
        },
        ["month", "day", "shard", "items", "clientId", "updatedAtISO", "updatedAt"],
        currentDocument?.updateTime || "",
        { mustNotExist: !currentDocument }
    );
}

shardDocuments = await client.listDocuments(collectionPath);
const verified = shardLogs(shardDocuments);
const remaining = legacyLogs.filter(log => {
    const current = verified.get(String(log.id || ""));
    return !current || signature(current) !== signature(log);
});

if (remaining.length) {
    throw new Error(`VERIFICACION FALLIDA: quedan ${remaining.length} registros.`);
}

console.log(`Verificacion OK: ${legacyLogs.length} registros cubiertos.`);
