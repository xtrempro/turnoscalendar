import { getFirebaseServices } from "./firebaseClient.js";
import { getRaw } from "./persistence.js";
import { getReplacements } from "./storage.js";
import { canEditMenu, canViewMenu } from "./workspacePermissions.js";
import {
    diffReplacementRecords,
    replacementRecordDocId,
    replacementRecordPayload,
    replacementRecordTombstone,
    replacementRecordsFromDocuments
} from "./replacementRecordStore.js";
import { recordPerformanceEvent } from "./performanceMonitor.js";

const SHADOW_STORAGE = "records-shadow-v1";
const WRITE_BATCH_SIZE = 400;

let activeWorkspaceId = "";
let unsubscribeRecords = null;
let persistenceHandler = null;
let recordDocuments = new Map();
let writeQueue = Promise.resolve();
let generation = 0;
let initialReconciliationPending = false;

function clientId() {
    return String(getRaw("proturnos_firebase_client_id", "") || "");
}

function localRecordsFromEvent(event) {
    const change = event?.detail?.changes?.replacements;

    try {
        return {
            previous: change?.previous ? JSON.parse(change.previous) : [],
            next: change?.next ? JSON.parse(change.next) : []
        };
    } catch {
        return { previous: [], next: getReplacements() };
    }
}

function nextRevision(recordId) {
    return Math.max(
        1,
        Number(recordDocuments.get(String(recordId))?.revision || 0) + 1
    );
}

async function writeChanges(workspaceId, changes, expectedGeneration) {
    if (expectedGeneration !== generation || !canEditMenu("turnos")) return;

    const operations = [
        ...changes.upserts.map(record => ({ type: "upsert", record })),
        ...changes.deletedIds.map(recordId => ({ type: "delete", recordId }))
    ];

    if (!operations.length) return;

    const { db, firestoreModule } = await getFirebaseServices();

    for (let offset = 0; offset < operations.length; offset += WRITE_BATCH_SIZE) {
        if (expectedGeneration !== generation) return;

        const batch = firestoreModule.writeBatch(db);

        operations.slice(offset, offset + WRITE_BATCH_SIZE).forEach(operation => {
            const recordId = String(
                operation.type === "upsert"
                    ? operation.record.id
                    : operation.recordId
            );
            const ref = firestoreModule.doc(
                db,
                "workspaces",
                workspaceId,
                "replacementRecords",
                replacementRecordDocId(recordId)
            );
            const options = {
                revision: nextRevision(recordId),
                clientId: clientId()
            };
            const payload = operation.type === "upsert"
                ? replacementRecordPayload(operation.record, options)
                : replacementRecordTombstone(recordId, options);

            batch.set(ref, {
                ...payload,
                updatedAt: firestoreModule.serverTimestamp()
            });
        });

        await batch.commit();
    }
}

function enqueueWrite(workspaceId, changes, expectedGeneration) {
    writeQueue = writeQueue
        .then(() => writeChanges(workspaceId, changes, expectedGeneration))
        .catch(error => {
            console.warn("No se pudo actualizar la copia individual de reemplazos.", error);
        });
}

function reportAudit(localRecords) {
    const shadowRecords = replacementRecordsFromDocuments(
        [...recordDocuments.values()]
    );
    const discrepancy = diffReplacementRecords(shadowRecords, localRecords);

    recordPerformanceEvent("replacement-records:shadow-audit", {
        localCount: localRecords.length,
        shadowCount: shadowRecords.length,
        missingOrDifferent: discrepancy.upserts.length,
        shadowOnly: discrepancy.deletedIds.length
    });

    return discrepancy;
}

export function stopFirebaseReplacementRecordShadowSync() {
    generation += 1;
    activeWorkspaceId = "";
    unsubscribeRecords?.();
    unsubscribeRecords = null;

    if (persistenceHandler && typeof window !== "undefined") {
        window.removeEventListener(
            "proturnos:persistenceChanged",
            persistenceHandler
        );
    }

    persistenceHandler = null;
    recordDocuments = new Map();
    initialReconciliationPending = false;
}

export async function startFirebaseReplacementRecordShadowSync(workspace) {
    stopFirebaseReplacementRecordShadowSync();

    if (
        !workspace?.id ||
        workspace.replacementStorage !== SHADOW_STORAGE ||
        !canViewMenu("turnos")
    ) {
        return false;
    }

    const expectedGeneration = generation;
    activeWorkspaceId = workspace.id;
    initialReconciliationPending = true;
    const { db, firestoreModule } = await getFirebaseServices();

    if (expectedGeneration !== generation || activeWorkspaceId !== workspace.id) {
        return false;
    }

    const collectionRef = firestoreModule.collection(
        db,
        "workspaces",
        workspace.id,
        "replacementRecords"
    );

    unsubscribeRecords = firestoreModule.onSnapshot(
        collectionRef,
        snapshot => {
            if (expectedGeneration !== generation) return;

            recordDocuments = new Map(
                snapshot.docs.map(document => [
                    String(document.data()?.recordId || document.id),
                    document.data()
                ])
            );

            const localRecords = getReplacements();
            const discrepancy = reportAudit(localRecords);

            // En modo sombra el formato antiguo manda. Solo se completan o
            // actualizan documentos durante el PRIMER snapshot. Los siguientes
            // solo auditan: reconciliar en cada eco hacia que dos clientes se
            // reescribieran mutuamente registros sanos.
            if (
                initialReconciliationPending &&
                canEditMenu("turnos") &&
                discrepancy.upserts.length
            ) {
                enqueueWrite(workspace.id, {
                    upserts: discrepancy.upserts,
                    deletedIds: []
                }, expectedGeneration);
            }

            initialReconciliationPending = false;
        },
        error => {
            console.warn("No se pudo auditar la copia individual de reemplazos.", error);
        }
    );

    persistenceHandler = event => {
        if (
            expectedGeneration !== generation ||
            !event?.detail?.keys?.includes("replacements")
        ) {
            return;
        }

        const records = localRecordsFromEvent(event);
        enqueueWrite(
            workspace.id,
            diffReplacementRecords(records.previous, records.next),
            expectedGeneration
        );
    };
    window.addEventListener(
        "proturnos:persistenceChanged",
        persistenceHandler
    );

    return true;
}
