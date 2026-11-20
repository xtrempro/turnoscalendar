#!/usr/bin/env node
// Corte de los reemplazos al documento por mes (19-11-2026) y su vuelta atras.
//
//   node scripts/replacements-por-mes.mjs --workspace <id> --expected-name <nombre> [--project <id>] [--apply]
//   node scripts/replacements-por-mes.mjs --workspace <id> --expected-name <nombre> --rollback [--apply]
//
// Corte: lee `stateModules/turnos/entries/replacements`, reparte sus elementos
// vivos por mes (js/replacementShards.js) y, en UN commit atomico:
//   - crea cada `replacements__AAAA-MM` (precondicion: no existe),
//   - vacia y congela el documento antiguo (precondicion: su updateTime leido;
//     si alguien escribio entre medio, no se aplica NADA),
//   - pone `replacementShards: "monthly-v1"` en la unidad.
// Las cadenas de cada elemento se copian tal cual (sin reserializar) y las claves
// codificadas tambien. Despues relee y exige la misma lista, elemento por elemento.
//
// Vuelta atras: junta los meses en el documento antiguo, lo descongela, borra
// los meses y quita la marca, tambien en un commit. Aborta si el documento
// reconstruido pasaria del 85 % de 1 MiB.
//
// Sin --apply solo informa. Con --apply respalda antes en migration-backups/.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    createFirestoreRestClient,
    firestorePatchWrite,
    firestoreValue,
    plainDocument
} from "./lib/firebase-rest.mjs";
import { REPLACEMENT_SHARD_PREFIX, replacementShardMonth } from "../js/replacementShards.js";
import { encodePartialStateItemKey } from "../js/firebasePartialState.js";

const MIB = 1024 * 1024;
const MAX_SHARD_BYTES = 0.7 * MIB;
const MAX_ROLLBACK_BYTES = 0.85 * MIB;
const FLAG = "monthly-v1";
// Vuelta atras en curso: las reglas solo dejan escribir meses con FLAG.
const ROLLBACK_PENDING = "rollback-pending";

const entriesPath = workspaceId => `workspaces/${workspaceId}/stateModules/turnos/entries`;

function liveItems(document) {
    const items = document.items || {};
    const deleted = document.deletedItems || {};

    return Object.entries(items).filter(([key]) => deleted[key] !== true);
}

function bytesOf(items) {
    return Buffer.byteLength(JSON.stringify(Object.fromEntries(items)));
}

/** Reparte los elementos vivos del documento antiguo por mes. */
export function planShardSplit(legacy) {
    if (!legacy) throw new Error("La unidad no tiene documento de reemplazos.");
    if (legacy.frozen === true) throw new Error("El documento antiguo ya esta congelado: el corte ya se hizo.");
    if (Object.prototype.hasOwnProperty.call(legacy, "value")) {
        throw new Error("El documento antiguo todavia tiene `value`: retirarlo antes (paso 0).");
    }

    const shards = new Map();
    const unreadable = [];
    const ids = new Set();

    for (const [key, raw] of liveItems(legacy)) {
        let record;

        try {
            record = JSON.parse(raw);
        } catch {
            unreadable.push(key);
            continue;
        }

        if (!record || typeof record !== "object" || !String(record.id ?? "").trim()) {
            unreadable.push(key);
            continue;
        }

        // La clave del mapa tiene que ser el id codificado, y el id unico: el
        // corte y la vuelta atras identifican por clave (auditoria por mes, P3-1).
        const id = String(record.id).trim();

        if (encodePartialStateItemKey(id) !== key) {
            throw new Error(`La clave ${key} no corresponde al id ${id}: ABORTA.`);
        }
        if (ids.has(id)) throw new Error(`El id ${id} esta repetido: ABORTA.`);
        ids.add(id);

        const month = replacementShardMonth(record);
        if (!shards.has(month)) shards.set(month, []);
        shards.get(month).push([key, raw]);
    }

    if (unreadable.length) {
        throw new Error(`Hay ${unreadable.length} elementos ilegibles o sin id (${unreadable.slice(0, 5).join(", ")}): ABORTA.`);
    }

    const months = [...shards.keys()].sort();
    const oversized = months.filter(month => bytesOf(shards.get(month)) > MAX_SHARD_BYTES);

    if (oversized.length) throw new Error(`Meses sobre el 70 %: ${oversized.join(", ")}. ABORTA.`);

    return {
        container: legacy.container || "array",
        shards: months.map(month => ({ month, items: shards.get(month), bytes: bytesOf(shards.get(month)) })),
        total: months.reduce((sum, month) => sum + shards.get(month).length, 0)
    };
}

/** Junta los meses para la vuelta atras. */
export function planShardMerge(shardDocuments) {
    const merged = [];
    const seen = new Map();

    for (const document of [...shardDocuments].sort((a, b) => a.id.localeCompare(b.id))) {
        for (const [key, raw] of liveItems(document.data)) {
            if (seen.has(key) && seen.get(key) !== raw) {
                throw new Error(`El elemento ${key} esta en dos meses con distinto contenido: ABORTA.`);
            }
            if (!seen.has(key)) merged.push([key, raw]);
            seen.set(key, raw);
        }
    }

    const bytes = bytesOf(merged);

    if (bytes > MAX_ROLLBACK_BYTES) {
        throw new Error(`La lista reconstruida pesa ${bytes} B (> 85 % de 1 MiB): la vuelta atras no cabe. ABORTA.`);
    }

    return { items: merged, bytes };
}

function documentName(client, documentPath) {
    return client.documentUrl(documentPath).split("/v1/")[1];
}

function commitUrl(client) {
    return `${client.documentUrl("").replace(/\/$/, "")}:commit`;
}

async function readUnit(client, workspaceId, expectedName) {
    const workspaceRaw = await client.getDocument(`workspaces/${workspaceId}`);
    const workspace = workspaceRaw ? plainDocument(workspaceRaw) : null;

    if (!workspace) throw new Error(`No existe la unidad ${workspaceId}.`);
    if (String(workspace.name || "") !== expectedName) {
        throw new Error(`La unidad se llama "${workspace.name}", no "${expectedName}": ABORTA.`);
    }

    const entries = await client.listDocuments(entriesPath(workspaceId));
    const byId = new Map(entries.map(raw => [raw.name.split("/").pop(), raw]));
    const legacyRaw = byId.get("replacements") || null;
    const chunks = await client.listDocuments(`workspaces/${workspaceId}/stateModules/turnos/chunks`);
    const shardDocuments = [...byId.entries()]
        .filter(([id]) => id.startsWith(REPLACEMENT_SHARD_PREFIX))
        .map(([id, raw]) => ({ id, raw, data: plainDocument(raw) }));

    return {
        workspace, workspaceRaw, legacyRaw, legacy: legacyRaw ? plainDocument(legacyRaw) : null, shardDocuments,
        chunkCount: chunks.length
    };
}

async function backup(directory, label, payload) {
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, `${label}_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

    await writeFile(file, JSON.stringify(payload, null, 2));
    return file;
}

function sameItems(a, b) {
    const left = new Map(a);
    const right = new Map(b);

    return left.size === right.size && [...left].every(([key, raw]) => right.get(key) === raw);
}

export async function splitReplacementsByMonth({
    client, workspaceId, expectedName, apply = false,
    backupDirectory = "migration-backups", logResult = console.log
}) {
    const unit = await readUnit(client, workspaceId, expectedName);

    if (unit.shardDocuments.length) {
        throw new Error(`Ya hay documentos por mes (${unit.shardDocuments.map(item => item.id).join(", ")}): ABORTA.`);
    }
    if (unit.workspace.replacementShards) {
        throw new Error(`La unidad ya tiene la marca "${unit.workspace.replacementShards}": ABORTA.`);
    }
    // Una base antigua en chunks se aplica ANTES que los elementos: vaciar el
    // documento no la limpiaria y lo retirado podria reaparecer (P3-1).
    if (unit.chunkCount) {
        throw new Error(`La unidad tiene ${unit.chunkCount} chunks en turnos: limpiarlos antes. ABORTA.`);
    }

    const plan = planShardSplit(unit.legacy);
    const summary = {
        workspaceId,
        live: liveItems(unit.legacy).length,
        months: plan.shards.map(shard => ({ month: shard.month, count: shard.items.length, bytes: shard.bytes }))
    };

    if (!apply) {
        logResult(JSON.stringify({ mode: "simulacion", ...summary }, null, 2));
        return { applied: false, ...summary };
    }

    const backupPath = await backup(backupDirectory, `${workspaceId}_replacements-antes-de-meses`, {
        workspace: unit.workspace, legacy: unit.legacyRaw
    });
    const nowISO = new Date().toISOString();
    const writes = plan.shards.map(shard => firestorePatchWrite(
        documentName(client, `${entriesPath(workspaceId)}/${REPLACEMENT_SHARD_PREFIX}${shard.month}`),
        {
            moduleId: firestoreValue("turnos"),
            storageKey: firestoreValue("replacements"),
            shard: firestoreValue(shard.month),
            container: firestoreValue(plan.container),
            items: firestoreValue(Object.fromEntries(shard.items)),
            deletedItems: firestoreValue({}),
            clientId: firestoreValue("migracion-por-mes"),
            updatedAtISO: firestoreValue(nowISO)
        },
        ["moduleId", "storageKey", "shard", "container", "items", "deletedItems", "clientId", "updatedAtISO"],
        "",
        { mustNotExist: true }
    ));

    writes.push(firestorePatchWrite(
        documentName(client, `${entriesPath(workspaceId)}/replacements`),
        {
            items: firestoreValue({}),
            deletedItems: firestoreValue({}),
            frozen: firestoreValue(true),
            clientId: firestoreValue("migracion-por-mes"),
            updatedAtISO: firestoreValue(nowISO)
        },
        ["items", "deletedItems", "frozen", "clientId", "updatedAtISO"],
        unit.legacyRaw.updateTime
    ));
    // Con precondicion: si otro operador cambio la unidad entre medio, aborta.
    writes.push(firestorePatchWrite(
        documentName(client, `workspaces/${workspaceId}`),
        { replacementShards: firestoreValue(FLAG) },
        ["replacementShards"],
        unit.workspaceRaw.updateTime
    ));

    await client.request(commitUrl(client), { method: "POST", body: JSON.stringify({ writes }) });

    // Verificacion. Desde el commit se puede escribir en los meses: un cambio
    // legitimo posterior no es corrupcion. Se informa como actividad y no se
    // recomienda volver atras por eso (P3-2).
    const after = await readUnit(client, workspaceId, expectedName);
    const union = after.shardDocuments.flatMap(document => liveItems(document.data));

    if (after.workspace.replacementShards !== FLAG) {
        throw new Error(`La marca no quedo puesta. Respaldo: ${backupPath}.`);
    }
    if (after.legacy?.frozen !== true || liveItems(after.legacy).length) {
        throw new Error(`El documento antiguo no quedo vacio y congelado. Respaldo: ${backupPath}.`);
    }
    if (!sameItems(union, liveItems(unit.legacy))) {
        // Un mes creado por el commit y sin escrituras despues tiene createTime == updateTime.
        const touched = after.shardDocuments
            .filter(document => document.raw.updateTime !== document.raw.createTime)
            .map(document => document.id);
        logResult(JSON.stringify({
            mode: "aplicado-con-diferencias",
            backupPath,
            aviso: "La union de los meses no es identica a la lista de antes. Puede ser actividad posterior al corte; revisar los documentos antes de decidir una vuelta atras.",
            documentosEscritosDespues: touched
        }, null, 2));
        return { applied: true, verified: false, backupPath, ...summary };
    }

    logResult(JSON.stringify({ mode: "aplicado", backupPath, verified: union.length, ...summary }, null, 2));
    return { applied: true, backupPath, verified: union.length, ...summary };
}

export async function rollbackReplacementsByMonth({
    client, workspaceId, expectedName, apply = false,
    backupDirectory = "migration-backups", logResult = console.log
}) {
    const first = await readUnit(client, workspaceId, expectedName);

    // Solo desde el estado que deja el corte: antiguo congelado y vacio, marca
    // mensual (o una vuelta atras ya iniciada). Ante un estado mezclado se
    // aborta en vez de elegir una fuente incompleta como autoridad (P2-2).
    const mode = first.workspace.replacementShards;

    if (!first.legacyRaw) throw new Error("No existe el documento antiguo.");
    if (mode !== FLAG && mode !== ROLLBACK_PENDING) {
        throw new Error(`La unidad no esta en modo mensual (marca "${mode || ""}"): ABORTA.`);
    }
    if (first.legacy.frozen !== true || liveItems(first.legacy).length) {
        throw new Error("El documento antiguo no esta congelado y vacio: estado mezclado, ABORTA.");
    }
    if (!first.shardDocuments.length) throw new Error("No hay documentos por mes: nada que revertir.");

    const preview = planShardMerge(first.shardDocuments);

    if (!apply) {
        logResult(JSON.stringify({
            mode: "simulacion-vuelta-atras", workspaceId,
            months: first.shardDocuments.map(item => item.id), live: preview.items.length, bytes: preview.bytes
        }, null, 2));
        return { applied: false, live: preview.items.length };
    }

    // Fase 1: cerrar la entrada. Con la marca fuera de "monthly-v1" las reglas
    // niegan escribir y CREAR meses, y el antiguo sigue congelado: desde aqui
    // nadie escribe reemplazos. Recien entonces se enumera lo que hay.
    if (mode === FLAG) {
        await client.request(commitUrl(client), {
            method: "POST",
            body: JSON.stringify({ writes: [firestorePatchWrite(
                documentName(client, `workspaces/${workspaceId}`),
                { replacementShards: firestoreValue(ROLLBACK_PENDING) },
                ["replacementShards"],
                first.workspaceRaw.updateTime
            )] })
        });
    }

    // Fase 2: con la entrada cerrada, leer de nuevo (incluye meses creados hasta
    // el cierre) y reconstruir.
    const unit = await readUnit(client, workspaceId, expectedName);
    const plan = planShardMerge(unit.shardDocuments);
    const summary = { workspaceId, months: unit.shardDocuments.map(item => item.id), live: plan.items.length, bytes: plan.bytes };
    const backupPath = await backup(backupDirectory, `${workspaceId}_replacements-meses-antes-de-volver`, {
        workspace: unit.workspace, legacy: unit.legacyRaw, shards: unit.shardDocuments.map(item => item.raw)
    });
    const writes = [
        firestorePatchWrite(
            documentName(client, `${entriesPath(workspaceId)}/replacements`),
            {
                items: firestoreValue(Object.fromEntries(plan.items)),
                deletedItems: firestoreValue({}),
                frozen: firestoreValue(false),
                clientId: firestoreValue("migracion-por-mes-vuelta"),
                updatedAtISO: firestoreValue(new Date().toISOString())
            },
            ["items", "deletedItems", "frozen", "clientId", "updatedAtISO"],
            unit.legacyRaw.updateTime
        ),
        // Cada mes se borra con precondicion: si alguien escribio despues de leerlo, no se aplica nada.
        ...unit.shardDocuments.map(item => ({
            delete: documentName(client, `${entriesPath(workspaceId)}/${item.id}`),
            currentDocument: { updateTime: item.raw.updateTime }
        })),
        firestorePatchWrite(
            documentName(client, `workspaces/${workspaceId}`),
            { replacementShards: firestoreValue("") },
            ["replacementShards"],
            unit.workspaceRaw.updateTime
        )
    ];

    await client.request(commitUrl(client), { method: "POST", body: JSON.stringify({ writes }) });

    // Verificacion: el antiguo tiene exactamente lo que habia en los meses, sin
    // meses restantes y sin marca. Si falla, la unidad queda con la marca en
    // "rollback-pending" o sin ella: el respaldo tiene todo.
    const after = await readUnit(client, workspaceId, expectedName);
    const problems = [];

    if (after.workspace.replacementShards) problems.push(`marca "${after.workspace.replacementShards}"`);
    if (after.shardDocuments.length) problems.push(`quedan meses: ${after.shardDocuments.map(item => item.id).join(", ")}`);
    if (after.legacy?.frozen === true) problems.push("el antiguo sigue congelado");
    if (!sameItems(liveItems(after.legacy || {}), plan.items)) problems.push("el antiguo no tiene la lista de los meses");
    if (problems.length) {
        throw new Error(`Vuelta atras NO verificada (${problems.join("; ")}). Respaldo: ${backupPath}.`);
    }

    logResult(JSON.stringify({ mode: "vuelta-atras-aplicada", backupPath, verified: plan.items.length, ...summary }, null, 2));
    return { applied: true, backupPath, verified: plan.items.length, ...summary };
}

function argument(argv, name) {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : "";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const argv = process.argv.slice(2);
    const workspaceId = argument(argv, "--workspace");
    const expectedName = argument(argv, "--expected-name");
    const projectId = argument(argv, "--project") || "calendarioturnos-7c4d9";

    if (!workspaceId || !expectedName) {
        console.error("Uso: --workspace <id> --expected-name <nombre> [--project <id>] [--rollback] [--apply]");
        process.exit(2);
    }

    const client = await createFirestoreRestClient(projectId);
    const run = argv.includes("--rollback") ? rollbackReplacementsByMonth : splitReplacementsByMonth;

    try {
        await run({ client, workspaceId, expectedName, apply: argv.includes("--apply") });
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
