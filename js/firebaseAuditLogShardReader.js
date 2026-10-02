import { getFirebaseServices } from "./firebaseClient.js";
import { canViewMenu } from "./workspacePermissions.js";
import {
    auditLogsFromShardDocuments,
    auditLogShardLocationFromId,
    auditLogUtcMonth
} from "./auditLogShardStore.js";
import { encodePartialStateItemKey } from "./firebasePartialState.js";

export const AUDIT_LOG_SHARD_READ_STORAGE = "shards-read-v1";

let activeWorkspaceId = "";
let readEnabled = false;
let generation = 0;
let watchGeneration = 0;
let watchedMonth = "";
let unsubscribeMonth = null;
let monthFirstSnapshot = null;
let resolveMonthFirstSnapshot = null;
let rejectMonthFirstSnapshot = null;
const monthCache = new Map();
const entryCache = new Map();

function validMonth(month) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ""));
}

function rememberLogs(logs = []) {
    logs.forEach(log => {
        const id = String(log?.id || "").trim();
        if (id) entryCache.set(id, log);
    });

    return logs;
}

function settleMonthFirstSnapshot(value, error = null) {
    if (error) {
        rejectMonthFirstSnapshot?.(error);
    } else {
        resolveMonthFirstSnapshot?.(value);
    }

    monthFirstSnapshot = null;
    resolveMonthFirstSnapshot = null;
    rejectMonthFirstSnapshot = null;
}

function dispatchMonthChanged(month, count, error) {
    if (typeof window === "undefined") return;

    const detail = { month, count };

    if (error !== undefined) detail.error = String(error || "");

    window.dispatchEvent(new CustomEvent(
        "proturnos:auditLogShardMonthChanged",
        { detail }
    ));
}

export function auditLogShardReadEnabled() {
    return Boolean(activeWorkspaceId && readEnabled && canViewMenu("log"));
}

export function getCachedAuditLogShardMonth(month) {
    const cached = monthCache.get(String(month || ""));

    return cached ? cached.slice() : null;
}

export function getCachedAuditLogShardEntry(logId) {
    return entryCache.get(String(logId || "").trim()) || null;
}

export function getCachedAuditLogShardEntries() {
    return [...entryCache.values()];
}

export function cacheFirebaseAuditLogShardEntries(logs = []) {
    const touchedMonths = new Set();

    (Array.isArray(logs) ? logs : []).forEach(log => {
        const id = String(log?.id || "").trim();
        const month = auditLogUtcMonth(log?.createdAt);

        if (!id || !validMonth(month)) return;

        entryCache.set(id, log);

        monthCache.forEach((cached, cachedMonth) => {
            const withoutPrevious = cached.filter(item => item.id !== id);

            if (cachedMonth === month) withoutPrevious.push(log);
            if (withoutPrevious.length !== cached.length || cachedMonth === month) {
                monthCache.set(cachedMonth, withoutPrevious);
                touchedMonths.add(cachedMonth);
            }
        });
    });

    if (
        typeof window !== "undefined" &&
        watchedMonth &&
        touchedMonths.has(watchedMonth)
    ) {
        dispatchMonthChanged(
            watchedMonth,
            monthCache.get(watchedMonth)?.length || 0
        );
    }
}

export function stopFirebaseAuditLogShardMonthWatch() {
    watchGeneration += 1;

    if (unsubscribeMonth) unsubscribeMonth();

    unsubscribeMonth = null;
    watchedMonth = "";
    settleMonthFirstSnapshot([]);
}

export function stopFirebaseAuditLogShardReader() {
    generation += 1;
    stopFirebaseAuditLogShardMonthWatch();
    activeWorkspaceId = "";
    readEnabled = false;
    monthCache.clear();
    entryCache.clear();
}

// Solo configura el lector. No consulta Firestore hasta que LOG pide un mes o
// una operacion solicita un registro puntual.
export function startFirebaseAuditLogShardReader(workspace) {
    stopFirebaseAuditLogShardReader();

    activeWorkspaceId = String(workspace?.id || "");
    readEnabled =
        workspace?.auditLogStorage === AUDIT_LOG_SHARD_READ_STORAGE;

    return auditLogShardReadEnabled();
}

export async function watchFirebaseAuditLogShardMonth(month) {
    const normalizedMonth = String(month || "");

    if (!auditLogShardReadEnabled() || !validMonth(normalizedMonth)) {
        return [];
    }

    if (watchedMonth === normalizedMonth && monthFirstSnapshot) {
        return monthFirstSnapshot;
    }

    if (
        watchedMonth === normalizedMonth &&
        monthCache.has(normalizedMonth)
    ) {
        return getCachedAuditLogShardMonth(normalizedMonth);
    }

    stopFirebaseAuditLogShardMonthWatch();

    const expectedGeneration = generation;
    const expectedWatchGeneration = watchGeneration;
    const workspaceId = activeWorkspaceId;
    const { db, firestoreModule } = await getFirebaseServices();

    if (
        expectedGeneration !== generation ||
        expectedWatchGeneration !== watchGeneration ||
        workspaceId !== activeWorkspaceId
    ) {
        return [];
    }

    const shards = firestoreModule.collection(
        db,
        "workspaces",
        workspaceId,
        "auditLogShards"
    );
    const monthQuery = firestoreModule.query(
        shards,
        firestoreModule.where("month", "==", normalizedMonth)
    );

    watchedMonth = normalizedMonth;
    monthFirstSnapshot = new Promise((resolve, reject) => {
        resolveMonthFirstSnapshot = resolve;
        rejectMonthFirstSnapshot = reject;
    });

    unsubscribeMonth = firestoreModule.onSnapshot(
        monthQuery,
        snapshot => {
            if (
                expectedGeneration !== generation ||
                expectedWatchGeneration !== watchGeneration ||
                workspaceId !== activeWorkspaceId ||
                normalizedMonth !== watchedMonth
            ) {
                return;
            }

            const logs = rememberLogs(auditLogsFromShardDocuments(
                snapshot.docs.map(item => item.data())
            ));

            monthCache.set(normalizedMonth, logs);
            settleMonthFirstSnapshot(logs);

            dispatchMonthChanged(normalizedMonth, logs.length, "");
        },
        error => {
            if (
                expectedGeneration !== generation ||
                expectedWatchGeneration !== watchGeneration ||
                workspaceId !== activeWorkspaceId ||
                normalizedMonth !== watchedMonth
            ) {
                return;
            }

            monthCache.set(normalizedMonth, []);
            dispatchMonthChanged(
                normalizedMonth,
                0,
                error?.message || "No se pudo cargar el mes."
            );
            settleMonthFirstSnapshot([], error);
            console.warn(
                `No se pudo leer la bitacora fragmentada de ${normalizedMonth}.`,
                error
            );
        }
    );

    return monthFirstSnapshot;
}

export async function readFirebaseAuditLogShardEntry(
    logId,
    createdAt = ""
) {
    const id = String(logId || "").trim();

    if (!id || !auditLogShardReadEnabled()) return null;

    const cached = getCachedAuditLogShardEntry(id);
    if (cached) return cached;

    const location = auditLogShardLocationFromId(id, createdAt);
    if (!location) return null;

    const expectedGeneration = generation;
    const workspaceId = activeWorkspaceId;
    const { db, firestoreModule } = await getFirebaseServices();
    const snapshot = await firestoreModule.getDoc(firestoreModule.doc(
        db,
        "workspaces",
        workspaceId,
        "auditLogShards",
        location.documentId
    ));

    if (
        expectedGeneration !== generation ||
        workspaceId !== activeWorkspaceId ||
        !snapshot.exists()
    ) {
        return null;
    }

    const raw = snapshot.data()?.items?.[encodePartialStateItemKey(id)];

    if (!raw) return null;

    try {
        const log = typeof raw === "string" ? JSON.parse(raw) : raw;

        if (String(log?.id || "") !== id) return null;

        rememberLogs([log]);
        return log;
    } catch {
        return null;
    }
}
