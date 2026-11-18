// Dry-run por defecto. Solo copia anulaciones verificadas desde fragmentos a
// sus mismos ids en la bitacora antigua. No hace backfill hacia los fragmentos.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { preserveAuditLogCancellation } from "../js/auditLogCancellation.js";
import { encodePartialStateItemKey } from "../js/firebasePartialState.js";
import { createFirestoreRestClient, firestoreValue, plainDocument } from "./lib/firebase-rest.mjs";
const { applyEntry } = createRequire(import.meta.url)("../functions/lib/stateReader.js");
const { auditShardIntegrity, estimateFirestoreDocumentBytes, legacyListReadable } = createRequire(import.meta.url)("../functions/lib/storageHealth.js");

export async function reconcileAuditLogCancellations({
    client, projectId, workspaceId, expectedName, apply = false,
    backupDirectory = "migration-backups", logResult = console.log
}) {
    if (!workspaceId || !expectedName) throw new Error("Usa --workspace y --expected-name.");
    const root = `workspaces/${encodeURIComponent(workspaceId)}`;
    const workspace = plainDocument(await client.getDocument(root));
    if (workspace.name !== expectedName) throw new Error("La unidad no coincide con --expected-name.");
    const legacyPath = `${root}/stateModules/log/entries/auditLog`;
    const [legacyDoc, shardDocs] = await Promise.all([
        client.getDocument(legacyPath), client.listDocuments(`${root}/auditLogShards`)
    ]);
    if (!legacyDoc) throw new Error("No existe la bitacora antigua.");
    const integrity = auditShardIntegrity(shardDocs.map(doc => ({id:doc.name.split("/").pop(),data:plainDocument(doc)})));
    if (integrity.issues) throw new Error("Los fragmentos tienen problemas de integridad; se requiere revision manual.");
    const stored = plainDocument(legacyDoc);
    if (!legacyListReadable(stored)) throw new Error("Bitacora antigua ilegible.");
    const state = {};
    applyEntry(state, stored);
    const legacy = JSON.parse(state.auditLog || "[]");
    if (!Array.isArray(legacy)) throw new Error("Bitacora antigua ilegible.");
    const canonical = value => Array.isArray(value) ? value.map(canonical)
        : value && typeof value === "object"
            ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
    const signature = value => JSON.stringify(canonical(value));
    const archived = new Map();
    for (const doc of shardDocs) {
        for (const raw of Object.values(plainDocument(doc).items || {})) {
            const log = typeof raw === "string" ? JSON.parse(raw) : raw;
            archived.set(String(log.id),{log,doc});
        }
    }
    const patches = [];
    for (const log of legacy) {
        const source = archived.get(String(log.id));
        if (!source) throw new Error(`Falta el evento ${log.id} en los fragmentos. No se aplica una reparacion parcial.`);
        if (signature(log) === signature(source.log)) continue;
        const next = preserveAuditLogCancellation(log, source.log);
        // Todas las diferencias deben explicarse SOLO por una anulacion que el
        // fragmento conserva y que no es anterior a la de la copia antigua.
        if (!source.log.canceledAt || signature(next) !== signature(source.log) || signature(next) === signature(log)) {
            throw new Error(`El evento ${log.id} tiene otras diferencias; requiere revision manual.`);
        }
        patches.push({id:String(log.id),next,sourceDoc:source.doc});
    }
    const summary = {projectId,workspaceId,workspaceName:workspace.name,mode:apply?"APPLY":"DRY-RUN",
        events:patches.map(p=>({id:p.id,canceledAt:p.next.canceledAt})),count:patches.length};
    logResult(JSON.stringify(summary,null,2));
    if (!apply || !patches.length) return summary;
    const items = {...stored.items};
    const deletedItems = {...stored.deletedItems};
    for (const patch of patches) {
        const key=encodePartialStateItemKey(patch.id);
        items[key]=JSON.stringify(patch.next);
        deletedItems[key]=false;
    }
    const now=new Date().toISOString();
    const next={...stored,items,deletedItems,clientId:"audit-log-cancellation-reconcile-v1",updatedAtISO:now};
    if (estimateFirestoreDocumentBytes(next,legacyPath)>=1024*1024) throw new Error("La reparacion excederia el limite del documento.");
    const backupPath=path.resolve(backupDirectory,`${encodeURIComponent(projectId)}_${encodeURIComponent(workspaceId)}_audit-cancellations_${now.replace(/[:.]/g,"-")}.json`);
    await mkdir(path.dirname(backupPath),{recursive:true});
    await writeFile(backupPath,JSON.stringify({projectId,workspaceId,backedUpAt:now,legacyDoc,
        sourceDocs:[...new Map(patches.map(p=>[p.sourceDoc.name,p.sourceDoc])).values()]},null,2)+"\n","utf8");
    // La precondicion impide pisar una escritura hecha desde nuestra lectura.
    await client.patchDocument(legacyPath,{
        items:firestoreValue(items),deletedItems:firestoreValue(deletedItems),
        clientId:firestoreValue(next.clientId),updatedAtISO:firestoreValue(now)
    },["items","deletedItems","clientId","updatedAtISO","updatedAt"],legacyDoc.updateTime,
    {serverTimestampFields:["updatedAt"]});
    const verified = {};
    applyEntry(verified,plainDocument(await client.getDocument(legacyPath)));
    const byId=new Map(JSON.parse(verified.auditLog).map(log=>[String(log.id),log]));
    if (patches.some(p=>signature(byId.get(p.id))!==signature(p.next))) throw new Error("La verificacion posterior no coincide; revisa el respaldo y las escrituras concurrentes.");
    logResult(`Verificacion OK: ${patches.length} anulaciones; respaldo ${backupPath}`);
    return { ...summary, backupPath };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    const args = process.argv.slice(2);
    const arg = (name, fallback = "") => {
        const index = args.indexOf(name);
        return index < 0 ? fallback : String(args[index + 1] || "");
    };
    const projectId = arg("--project", "calendarioturnos-7c4d9");
    const workspaceId = arg("--workspace");
    const expectedName = arg("--expected-name");
    if (!workspaceId || !expectedName) throw new Error("Usa --workspace y --expected-name.");
    await reconcileAuditLogCancellations({
        client: await createFirestoreRestClient(projectId), projectId,
        workspaceId, expectedName, apply: args.includes("--apply")
    });
}
