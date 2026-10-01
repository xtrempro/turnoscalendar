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
const WRITE_RETRY_MAX_DELAY_MS = 30000;

let activeWorkspaceId = "";
let unsubscribeRecords = null;
let persistenceHandler = null;
let recordDocuments = new Map();
let writeQueue = Promise.resolve();
let generation = 0;
let initialReconciliationPending = false;
let initialReconciliationInFlight = false;

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

function terminalWriteError(error) {
    const code = String(error?.code || "").toLowerCase();

    return [
        "permission-denied",
        "unauthenticated",
        "invalid-argument",
        "replacement-record-tombstoned"
    ].some(value => code.includes(value));
}

async function waitForRetry(delay, expectedGeneration) {
    let remaining = delay;

    while (remaining > 0 && expectedGeneration === generation) {
        const slice = Math.min(remaining, 500);
        await new Promise(resolve => setTimeout(resolve, slice));
        remaining -= slice;
    }

    return expectedGeneration === generation;
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

        const slice = operations.slice(offset, offset + WRITE_BATCH_SIZE);
        const refs = slice.map(operation => {
            const recordId = String(
                operation.type === "upsert"
                    ? operation.record.id
                    : operation.recordId
            );

            return firestoreModule.doc(
                db,
                "workspaces",
                workspaceId,
                "replacementRecords",
                replacementRecordDocId(recordId)
            );
        });

        await firestoreModule.runTransaction(db, async transaction => {
            const snapshots = await Promise.all(
                refs.map(ref => transaction.get(ref))
            );

            slice.forEach((operation, index) => {
                const snapshot = snapshots[index];
                const current = snapshot.exists() ? snapshot.data() : {};
                const recordId = String(
                    operation.type === "upsert"
                        ? operation.record.id
                        : operation.recordId
                );

                if (operation.type === "upsert" && current.deleted === true) {
                    const error = new Error(
                        `El reemplazo ${recordId} ya tiene un tombstone.`
                    );
                    error.code = "replacement-record-tombstoned";
                    throw error;
                }

                if (operation.type === "delete" && current.deleted === true) {
                    return;
                }

                const options = {
                    revision: Math.max(
                        1,
                        Number(current.revision || 0) + 1
                    ),
                    clientId: clientId(),
                    date: operation.type === "upsert"
                        ? operation.record?.date
                        : current.date || current.record?.date
                };
                const payload = operation.type === "upsert"
                    ? replacementRecordPayload(operation.record, options)
                    : replacementRecordTombstone(recordId, options);

                transaction.set(refs[index], {
                    ...payload,
                    updatedAt: firestoreModule.serverTimestamp()
                });
            });
        });
    }

    return true;
}

async function writeChangesWithRetry(
    workspaceId,
    changes,
    expectedGeneration
) {
    let attempt = 0;

    while (expectedGeneration === generation) {
        try {
            return await writeChanges(
                workspaceId,
                changes,
                expectedGeneration
            );
        } catch (error) {
            if (terminalWriteError(error)) throw error;

            attempt += 1;
            const delay = Math.min(
                WRITE_RETRY_MAX_DELAY_MS,
                500 * (2 ** Math.min(attempt - 1, 6))
            );

            recordPerformanceEvent("replacement-records:write-retry", {
                attempt,
                delay,
                error: error?.message || String(error)
            });

            if (!await waitForRetry(delay, expectedGeneration)) return false;
        }
    }

    return false;
}

function enqueueWrite(workspaceId, changes, expectedGeneration) {
    const task = writeQueue
        .catch(() => undefined)
        .then(() => writeChangesWithRetry(
            workspaceId,
            changes,
            expectedGeneration
        ));

    writeQueue = task.catch(error => {
        console.warn(
            "No se pudo actualizar la copia individual de reemplazos.",
            error
        );
    });

    return task;
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
    initialReconciliationInFlight = false;
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
            if (initialReconciliationPending && !discrepancy.upserts.length) {
                initialReconciliationPending = false;
            }

            if (
                initialReconciliationPending &&
                !initialReconciliationInFlight &&
                canEditMenu("turnos") &&
                discrepancy.upserts.length
            ) {
                initialReconciliationInFlight = true;

                void enqueueWrite(workspace.id, {
                    upserts: discrepancy.upserts,
                    deletedIds: []
                }, expectedGeneration)
                    .then(completed => {
                        if (completed && expectedGeneration === generation) {
                            initialReconciliationPending = false;
                        }
                    })
                    .catch(() => {
                        initialReconciliationPending = false;
                    })
                    .finally(() => {
                        initialReconciliationInFlight = false;
                    });
            }
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
        void enqueueWrite(
            workspace.id,
            diffReplacementRecords(records.previous, records.next),
            expectedGeneration
        ).catch(() => undefined);
    };
    window.addEventListener(
        "proturnos:persistenceChanged",
        persistenceHandler
    );

    return true;
}
