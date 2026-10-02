import { getFirebaseServices } from "./firebaseClient.js";
import { getRaw } from "./persistence.js";
import { canEditMenu } from "./workspacePermissions.js";
import {
    diffAuditLogShardUpserts,
    groupAuditLogsByShard
} from "./auditLogShardStore.js";
import { encodePartialStateItemKey } from "./firebasePartialState.js";
import { recordPerformanceEvent } from "./performanceMonitor.js";
import { cacheFirebaseAuditLogShardEntries } from "./firebaseAuditLogShardReader.js";

const SHADOW_STORAGE_MODES = new Set([
    "shards-shadow-v1",
    "shards-read-v1"
]);
const RETRY_MAX_DELAY_MS = 30000;
const WRITE_GROUP_BATCH_SIZE = 100;

let activeWorkspaceId = "";
let persistenceHandler = null;
let writeQueue = Promise.resolve();
let generation = 0;

function clientId() {
    return String(getRaw("proturnos_firebase_client_id", "") || "");
}

function logsFromEvent(event) {
    const change = event?.detail?.changes?.auditLog;

    try {
        return {
            previous: change?.previous ? JSON.parse(change.previous) : [],
            next: change?.next ? JSON.parse(change.next) : []
        };
    } catch {
        return { previous: [], next: [] };
    }
}

function terminalWriteError(error) {
    const code = String(error?.code || "").toLowerCase();

    return [
        "permission-denied",
        "unauthenticated",
        "invalid-argument"
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

async function writeShardGroups(workspaceId, groups, expectedGeneration) {
    if (
        expectedGeneration !== generation ||
        !groups.length ||
        !canEditMenu("log")
    ) {
        return false;
    }

    const { db, firestoreModule } = await getFirebaseServices();

    for (
        let offset = 0;
        offset < groups.length;
        offset += WRITE_GROUP_BATCH_SIZE
    ) {
        if (expectedGeneration !== generation) return false;

        const slice = groups.slice(offset, offset + WRITE_GROUP_BATCH_SIZE);
        const refs = slice.map(group => firestoreModule.doc(
            db,
            "workspaces",
            workspaceId,
            "auditLogShards",
            group.documentId
        ));

        await firestoreModule.runTransaction(db, async transaction => {
            const snapshots = await Promise.all(
                refs.map(ref => transaction.get(ref))
            );

            slice.forEach((group, index) => {
                const current = snapshots[index].exists()
                    ? snapshots[index].data()
                    : {};
                const items = { ...(current.items || {}) };

                group.logs.forEach(log => {
                    items[encodePartialStateItemKey(log.id)] = JSON.stringify(log);
                });

                transaction.set(refs[index], {
                    month: group.month,
                    day: group.day,
                    shard: group.shard,
                    items,
                    clientId: clientId(),
                    updatedAtISO: new Date().toISOString(),
                    updatedAt: firestoreModule.serverTimestamp()
                });
            });
        });
    }

    return true;
}

async function writeWithRetry(workspaceId, groups, expectedGeneration) {
    let attempt = 0;

    while (expectedGeneration === generation) {
        try {
            return await writeShardGroups(
                workspaceId,
                groups,
                expectedGeneration
            );
        } catch (error) {
            if (terminalWriteError(error)) throw error;

            attempt += 1;
            const delay = Math.min(
                RETRY_MAX_DELAY_MS,
                500 * (2 ** Math.min(attempt - 1, 6))
            );

            recordPerformanceEvent("audit-log-shards:write-retry", {
                attempt,
                delay,
                error: error?.message || String(error)
            });
            if (!await waitForRetry(delay, expectedGeneration)) return false;
        }
    }

    return false;
}

function enqueueWrite(workspaceId, groups, expectedGeneration) {
    const task = writeQueue
        .catch(() => undefined)
        .then(() => writeWithRetry(workspaceId, groups, expectedGeneration));

    writeQueue = task.catch(error => {
        console.warn("No se pudo actualizar la bitacora fragmentada.", error);
    });

    return task;
}

export function stopFirebaseAuditLogShardShadowSync() {
    generation += 1;
    activeWorkspaceId = "";

    if (persistenceHandler && typeof window !== "undefined") {
        window.removeEventListener(
            "proturnos:persistenceChanged",
            persistenceHandler
        );
    }

    persistenceHandler = null;
}

export async function startFirebaseAuditLogShardShadowSync(workspace) {
    stopFirebaseAuditLogShardShadowSync();

    if (
        !workspace?.id ||
        !SHADOW_STORAGE_MODES.has(workspace.auditLogStorage) ||
        !canEditMenu("log") ||
        typeof window === "undefined"
    ) {
        return false;
    }

    const expectedGeneration = generation;
    activeWorkspaceId = workspace.id;
    persistenceHandler = event => {
        if (
            expectedGeneration !== generation ||
            !event?.detail?.keys?.includes("auditLog")
        ) {
            return;
        }

        const logs = logsFromEvent(event);
        const upserts = diffAuditLogShardUpserts(logs.previous, logs.next);
        const groups = groupAuditLogsByShard(upserts);

        if (!groups.length) return;

        cacheFirebaseAuditLogShardEntries(upserts);

        void enqueueWrite(workspace.id, groups, expectedGeneration)
            .catch(() => undefined);
    };
    window.addEventListener(
        "proturnos:persistenceChanged",
        persistenceHandler
    );

    return true;
}
