import { getFirebaseServices } from "./firebaseClient.js";
import {
    applyLocalPatch,
    exportLocalSnapshot,
    getRaw,
    isInternalKey,
    replaceLocalSnapshot,
    replaceLocalSnapshotSubset,
    setRaw
} from "./persistence.js";
import {
    canEditMenu,
    canViewMenu,
    isWorkspaceOwner
} from "./workspacePermissions.js";
import {
    splitSnapshotByStateModule,
    stateModuleForKey,
    stateModuleIds,
    stateModulePermission
} from "./firebaseStateModules.js";
import {
    applyPartialStateEntry,
    decodePartialStateItemKey,
    groupPartialStateEntries,
    mergePartialStateEntries,
    planPartialStateEntries
} from "./firebasePartialState.js";
import {
    measurePerformance,
    recordPerformanceEvent
} from "./performanceMonitor.js";

const CLIENT_ID_KEY = "proturnos_firebase_client_id";
const ENTRY_BATCH_SIZE = 1;
const ENTRY_SYNC_DELAY_MS = 2500;
const ENTRY_USER_QUIET_MS = 90000;
const ENTRY_ACTIVE_RETRY_MS = 10000;
const ENTRY_VISIBLE_RETRY_MS = 60000;
const REMOTE_APPLY_BATCH_SIZE = 4;
const REMOTE_APPLY_ACTIVE_RETRY_MS = 30000;
const REMOTE_APPLY_CALENDAR_RETRY_MS = 90000;
const LOCAL_ENTRY_PROTECTION_MS = 30 * 60 * 1000;
const WORKER_CALENDAR_URGENT_STATE_PREFIXES = [
    "data_",
    "baseData_",
    "admin_",
    "legal_",
    "comp_",
    "absences_",
    "rotativa_",
    "shift_",
    "shiftAssignmentHistory_"
];
const WORKER_CALENDAR_URGENT_STATE_KEYS = new Set([
    "replacements",
    "swaps",
    "manualHolidays",
    "turnoColorConfig",
    "profiles"
]);

let activeWorkspaceId = "";
let unsubscribeState = null;
let stateSyncStarting = false;
let entrySyncTimer = null;
let applyingRemoteState = false;
let waitingInitialState = false;
let entrySyncInFlight = false;
let urgentEntrySyncPending = false;
let remoteApplyTimer = null;
let remoteApplyInFlight = false;
let entryLastUserActivityAt = Date.now();
let servicesCache = null;
let onStateChanged = () => {};
let syncGeneration = 0;
const lastAppliedHashes = new Map();
const pendingStateEntries = new Map();
const pendingRemoteStateEntries = new Map();
const localDirtyStateEntries = new Map();
const entryModulesPresent = new Set();
let unsubscribeStateEntries = null;

function waitFirebaseStateIdle(timeout = 500) {
    return new Promise(resolve => {
        if (
            typeof window !== "undefined" &&
            typeof window.requestIdleCallback === "function"
        ) {
            window.requestIdleCallback(resolve, {
                timeout: Math.max(120, Number(timeout) || 500)
            });
            return;
        }

        setTimeout(resolve, 0);
    });
}

function markFirebaseStateUserActivity() {
    entryLastUserActivityAt = Date.now();
}

function firebaseStateHasPendingInput() {
    try {
        return Boolean(
            typeof navigator !== "undefined" &&
            navigator.scheduling &&
            typeof navigator.scheduling.isInputPending === "function" &&
            navigator.scheduling.isInputPending({ includeContinuous: true })
        );
    } catch (_error) {
        return false;
    }
}

function firebaseStateInteractiveDelay(quietMs = ENTRY_USER_QUIET_MS) {
    if (typeof document === "undefined") return 0;
    if (document.visibilityState !== "visible") return 0;

    // Los commits de Firestore/IndexedDB pueden congelar el hilo principal
    // incluso tras un periodo de quietud. Mientras el supervisor mira la app,
    // se prioriza la fluidez; la cola se vacia al ocultar la pestaña.
    const delay = Math.max(
        ENTRY_VISIBLE_RETRY_MS,
        ENTRY_ACTIVE_RETRY_MS,
        Number(quietMs) || ENTRY_USER_QUIET_MS
    );

    return firebaseStateHasPendingInput()
        ? Math.max(delay, ENTRY_ACTIVE_RETRY_MS)
        : delay;
}

export function isWorkerCalendarUrgentStateKey(key) {
    const value = String(key || "");

    return WORKER_CALENDAR_URGENT_STATE_KEYS.has(value) ||
        WORKER_CALENDAR_URGENT_STATE_PREFIXES.some(prefix =>
            value.startsWith(prefix)
        );
}

function firebaseRemoteApplyDelay() {
    if (typeof document === "undefined") return 0;
    if (document.visibilityState !== "visible") return 0;

    const activeView = document.body?.dataset?.activeView || "";

    if (activeView === "turnos" || activeView === "timeline") {
        return REMOTE_APPLY_CALENDAR_RETRY_MS;
    }

    const quietRemaining = Math.max(
        0,
        ENTRY_USER_QUIET_MS - (Date.now() - entryLastUserActivityAt)
    );

    if (firebaseStateHasPendingInput() || quietRemaining > 0) {
        return Math.max(
            REMOTE_APPLY_ACTIVE_RETRY_MS,
            Math.min(quietRemaining, REMOTE_APPLY_CALENDAR_RETRY_MS)
        );
    }

    return 0;
}

function remoteEntryId(entry = {}) {
    return [
        entry.moduleId,
        entry.storageKey,
        entry.itemKey || ""
    ].join("\u001e");
}

export function normalizeFirebaseStateDelay(
    delay,
    fallback = ENTRY_SYNC_DELAY_MS
) {
    const value = Number(delay);

    return Number.isFinite(value)
        ? Math.max(0, value)
        : Math.max(0, Number(fallback) || 0);
}

export function shouldDeferFirebaseEntrySlice({
    urgent = false,
    visible = false
} = {}) {
    return !urgent && visible;
}

export function normalizeQueuedStateEntries(entries = []) {
    return (Array.isArray(entries) ? entries : [])
        .flatMap(entry => {
            const storageKey = String(entry?.storageKey || "");
            const moduleId = String(
                entry?.moduleId || stateModuleForKey(storageKey) || ""
            );

            if (!storageKey || !moduleId) return [];

            const items =
                entry.items && typeof entry.items === "object"
                    ? entry.items
                    : {};
            const deletedItems =
                entry.deletedItems && typeof entry.deletedItems === "object"
                    ? entry.deletedItems
                    : {};
            const itemKeys = new Set([
                ...Object.keys(items),
                ...Object.keys(deletedItems)
            ]);

            if (itemKeys.size) {
                return [...itemKeys].map(itemKey => ({
                    moduleId,
                    storageKey,
                    itemKey: decodePartialStateItemKey(itemKey),
                    value: items[itemKey],
                    deleted: deletedItems[itemKey] === true
                }));
            }

            return [{
                moduleId,
                storageKey,
                itemKey: String(entry.itemKey || ""),
                value: entry.value,
                deleted: entry.deleted === true
            }];
        });
}

function remoteEntryUpdatedAtMillis(entry = {}) {
    const explicitMillis = Number(entry.updatedAtMillis);

    if (Number.isFinite(explicitMillis) && explicitMillis > 0) {
        return explicitMillis;
    }

    const isoMillis = Date.parse(String(entry.updatedAtISO || ""));

    if (Number.isFinite(isoMillis) && isoMillis > 0) {
        return isoMillis;
    }

    return 0;
}

export function isRemoteStateEntryStaleForLocalChange(
    entry = {},
    localChange = {},
    now = Date.now(),
    protectionMs = LOCAL_ENTRY_PROTECTION_MS
) {
    const changedAt = Number(localChange.changedAt) || 0;

    if (!changedAt) return false;

    const remoteMillis = remoteEntryUpdatedAtMillis(entry);

    if (remoteMillis > 0) {
        return remoteMillis < changedAt;
    }

    return Number(now) - changedAt < protectionMs;
}

function cleanupLocalDirtyStateEntries(now = Date.now()) {
    localDirtyStateEntries.forEach((record, id) => {
        if (
            Number(now) - Number(record.changedAt || 0) >
            LOCAL_ENTRY_PROTECTION_MS
        ) {
            localDirtyStateEntries.delete(id);
        }
    });
}

function rememberLocalStateEntries(entries = [], changedAt = Date.now()) {
    cleanupLocalDirtyStateEntries(changedAt);

    normalizeQueuedStateEntries(entries).forEach(entry => {
        localDirtyStateEntries.set(remoteEntryId(entry), {
            entry,
            changedAt
        });
    });
}

function locallyProtectedEntries(moduleId = "") {
    cleanupLocalDirtyStateEntries();

    return [...localDirtyStateEntries.values()]
        .map(record => record.entry)
        .filter(entry =>
            !moduleId ||
            entry.moduleId === moduleId ||
            stateModuleForKey(entry.storageKey) === moduleId
        );
}

function mergeLocalDirtyStateEntries(snapshot = {}, moduleId = "") {
    const entries = locallyProtectedEntries(moduleId);

    if (!entries.length) return snapshot;

    return mergePartialStateEntries(snapshot, entries);
}

function shouldApplyRemoteStateEntry(entry = {}) {
    const id = remoteEntryId(entry);
    const localChange = localDirtyStateEntries.get(id);

    if (!localChange) return true;

    if (isRemoteStateEntryStaleForLocalChange(entry, localChange)) {
        recordPerformanceEvent("firebase-app-state:skip-stale-entry", {
            type: "firebase",
            moduleId: entry.moduleId,
            storageKey: entry.storageKey,
            itemKey: entry.itemKey || ""
        });
        return false;
    }

    localDirtyStateEntries.delete(id);
    return true;
}

function queueRemoteStateEntries(entries = []) {
    entries.forEach(entry => {
        if (!entry?.storageKey) return;
        pendingRemoteStateEntries.set(remoteEntryId(entry), entry);
    });
}

function scheduleRemoteStateApply(delay = 0) {
    if (
        !pendingRemoteStateEntries.size ||
        remoteApplyInFlight ||
        !activeWorkspaceId
    ) return;

    clearTimeout(remoteApplyTimer);
    remoteApplyTimer = setTimeout(
        flushRemoteStateEntries,
        normalizeFirebaseStateDelay(delay, 0)
    );
}

async function flushRemoteStateEntries() {
    remoteApplyTimer = null;

    if (
        remoteApplyInFlight ||
        !activeWorkspaceId ||
        !pendingRemoteStateEntries.size
    ) return;

    const delay = firebaseRemoteApplyDelay();

    if (delay > 0) {
        recordPerformanceEvent("firebase-app-state:apply-deferred", {
            type: "firebase",
            reason: "foreground-busy",
            delay,
            pendingCount: pendingRemoteStateEntries.size,
            activeView: document.body?.dataset?.activeView || ""
        });
        scheduleRemoteStateApply(delay);
        return;
    }

    remoteApplyInFlight = true;

    try {
        while (pendingRemoteStateEntries.size && activeWorkspaceId) {
            const batchSize =
                typeof document !== "undefined" &&
                document.visibilityState === "visible"
                    ? REMOTE_APPLY_BATCH_SIZE
                    : pendingRemoteStateEntries.size;
            const entries = [...pendingRemoteStateEntries.values()]
                .slice(0, batchSize);

            entries.forEach(entry =>
                pendingRemoteStateEntries.delete(remoteEntryId(entry))
            );

            applyRemoteStateEntries(entries);

            if (!pendingRemoteStateEntries.size) break;

            if (
                typeof document !== "undefined" &&
                document.visibilityState === "visible"
            ) {
                scheduleRemoteStateApply(REMOTE_APPLY_ACTIVE_RETRY_MS);
                return;
            }

            await waitFirebaseStateIdle(600);
        }
    } finally {
        remoteApplyInFlight = false;

        if (pendingRemoteStateEntries.size) {
            scheduleRemoteStateApply(firebaseRemoteApplyDelay());
        }
    }
}

function moduleDocRef(db, firestoreModule, workspaceId, moduleId) {
    return firestoreModule.doc(
        db,
        "workspaces",
        workspaceId,
        "stateModules",
        moduleId
    );
}

function moduleChunksCollection(
    db,
    firestoreModule,
    workspaceId,
    moduleId
) {
    return firestoreModule.collection(
        db,
        "workspaces",
        workspaceId,
        "stateModules",
        moduleId,
        "chunks"
    );
}

function moduleEntriesCollection(
    db,
    firestoreModule,
    workspaceId,
    moduleId
) {
    return firestoreModule.collection(
        db,
        "workspaces",
        workspaceId,
        "stateModules",
        moduleId,
        "entries"
    );
}

function entryDocId(storageKey) {
    const source = String(storageKey || "");
    const encoded = encodeURIComponent(source);

    if (encoded.length <= 900) return encoded;

    return `entry_${hashString(source)}`;
}

function getClientId() {
    const existing = getRaw(CLIENT_ID_KEY, "");

    if (existing) return existing;

    const nextId =
        globalThis.crypto?.randomUUID?.() ||
        `client_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    setRaw(CLIENT_ID_KEY, nextId);
    return nextId;
}

function stableSnapshotString(snapshot = {}) {
    const ordered = {};

    Object.keys(snapshot)
        .filter(key => !isInternalKey(key))
        .sort()
        .forEach(key => {
            ordered[key] = snapshot[key];
        });

    return JSON.stringify(ordered);
}

function currentModuleSnapshot(moduleId) {
    return splitSnapshotByStateModule(
        exportLocalSnapshot()
    )[moduleId] || {};
}

function currentModuleStateString(moduleId) {
    return stableSnapshotString(currentModuleSnapshot(moduleId));
}

function hashString(value) {
    let hash = 2166136261;

    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return `${value.length}-${(hash >>> 0).toString(36)}`;
}

async function services() {
    if (!servicesCache) {
        servicesCache = await getFirebaseServices();
    }

    return servicesCache;
}

function canWriteModule(moduleId) {
    const permission = stateModulePermission(moduleId);

    if (permission === "owner") {
        return isWorkspaceOwner();
    }

    return canEditMenu(permission);
}

function canReadModule(moduleId) {
    const permission = stateModulePermission(moduleId);

    if (permission === "owner") {
        return isWorkspaceOwner();
    }

    return canViewMenu(permission);
}

function scheduleEntrySync(delay = ENTRY_SYNC_DELAY_MS, options = {}) {
    if (options.urgent) {
        urgentEntrySyncPending = true;
    }

    if (
        !pendingStateEntries.size ||
        !activeWorkspaceId ||
        applyingRemoteState ||
        waitingInitialState ||
        entrySyncInFlight
    ) return;

    clearTimeout(entrySyncTimer);
    entrySyncTimer = setTimeout(
        flushPartialStateEntries,
        normalizeFirebaseStateDelay(delay, ENTRY_SYNC_DELAY_MS)
    );
}

function queueGroupedPartialStateEntries(entries = []) {
    normalizeQueuedStateEntries(entries).forEach(entry => {
        const id = [
            entry.moduleId,
            entry.storageKey,
            entry.itemKey || ""
        ].join("\u001e");

        pendingStateEntries.set(id, entry);
    });
}

function queuePartialStateEntries(entries = [], options = {}) {
    if (options.urgent) {
        urgentEntrySyncPending = true;
    }

    rememberLocalStateEntries(entries);
    queueGroupedPartialStateEntries(entries);

    if (
        !pendingStateEntries.size ||
        !activeWorkspaceId ||
        applyingRemoteState ||
            waitingInitialState
    ) return;

    scheduleEntrySync(
        options.urgent ? 0 : ENTRY_SYNC_DELAY_MS,
        { urgent: options.urgent }
    );
}

function pendingStateEntryId(entry = {}) {
    return [
        entry.moduleId,
        entry.storageKey,
        entry.itemKey || ""
    ].join("\u001e");
}

async function commitPartialStateDocumentsNow(
    documents = [],
    {
        workspaceId = activeWorkspaceId,
        reason = "manual-flush"
    } = {}
) {
    if (!workspaceId || !documents.length) return;

    const { db, firestoreModule } = await services();
    const batch = firestoreModule.writeBatch(db);

    documents.forEach(entry => {
        const payload = {
            moduleId: entry.moduleId,
            storageKey: entry.storageKey,
            clientId: getClientId(),
            updatedAtISO: new Date().toISOString(),
            updatedAt: firestoreModule.serverTimestamp()
        };

        if (
            Object.keys(entry.items || {}).length ||
            Object.keys(entry.deletedItems || {}).length
        ) {
            payload.items = entry.items || {};
            payload.deletedItems = entry.deletedItems || {};
        }

        if (Object.prototype.hasOwnProperty.call(entry, "value")) {
            payload.value = entry.value;
            payload.deleted = entry.deleted;
        }

        batch.set(
            firestoreModule.doc(
                moduleEntriesCollection(
                    db,
                    firestoreModule,
                    workspaceId,
                    entry.moduleId
                ),
                entryDocId(entry.storageKey)
            ),
            payload,
            { merge: true }
        );
    });

    await measurePerformance(
        "firebase-app-state:commit-entries-now",
        () => batch.commit(),
        {
            reason,
            documentCount: documents.length,
            moduleIds: Array.from(
                new Set(documents.map(entry => entry.moduleId))
            ).join(",")
        },
        {
            asyncThreshold: 120
        }
    );
}

export async function flushPendingFirebaseAppStateEntries({
    keys = [],
    changes = {},
    reason = "manual-flush"
} = {}) {
    if (!activeWorkspaceId) {
        return {
            flushed: false,
            count: 0,
            reason: "no-workspace"
        };
    }

    const stateKeys = Array.from(new Set(
        (Array.isArray(keys) ? keys : [keys])
            .map(key => String(key || "").trim())
            .filter(key => key && !isInternalKey(key))
    ));

    if (!stateKeys.length) {
        return {
            flushed: false,
            count: 0,
            reason: "no-keys"
        };
    }

    const planned = planPartialStateEntries({
        keys: stateKeys,
        changes,
        readRaw: key => getRaw(key, null),
        moduleForKey: stateModuleForKey
    }).filter(entry => canWriteModule(entry.moduleId));
    const stateKeySet = new Set(stateKeys);
    const queued = [...pendingStateEntries.values()]
        .filter(entry => stateKeySet.has(entry.storageKey))
        .filter(entry => canWriteModule(entry.moduleId));
    const writable = [
        ...planned,
        ...queued
    ];

    if (!writable.length) {
        return {
            flushed: false,
            count: 0,
            reason: "no-writable-entries"
        };
    }

    const documents = groupPartialStateEntries(writable);

    try {
        rememberLocalStateEntries(writable);
        await commitPartialStateDocumentsNow(documents, { reason });

        writable.forEach(entry => {
            pendingStateEntries.delete(pendingStateEntryId(entry));
        });

        dispatchStatus({
            type: "app-state-entries-saved",
            count: writable.length,
            reason
        });

        return {
            flushed: true,
            count: writable.length,
            documentCount: documents.length
        };
    } catch (error) {
        queueGroupedPartialStateEntries(writable);
        scheduleEntrySync(0, { urgent: true });
        throw error;
    }
}

async function flushPartialStateEntries() {
    entrySyncTimer = null;

    if (
        !activeWorkspaceId ||
        applyingRemoteState ||
        waitingInitialState ||
        !pendingStateEntries.size ||
        entrySyncInFlight
    ) return;

    const urgent = urgentEntrySyncPending;
    urgentEntrySyncPending = false;
    const interactiveDelay = urgent ? 0 : firebaseStateInteractiveDelay();

    if (interactiveDelay > 0) {
        recordPerformanceEvent("firebase-app-state:commit-deferred", {
            type: "firebase",
            reason: "user-active",
            delay: interactiveDelay,
            pendingCount: pendingStateEntries.size
        });
        scheduleEntrySync(interactiveDelay);
        return;
    }

    entrySyncInFlight = true;
    const workspaceId = activeWorkspaceId;
    const pending = [...pendingStateEntries.values()];
    pendingStateEntries.clear();
    const writable = pending.filter(entry =>
        canWriteModule(entry.moduleId)
    );
    const documents = groupPartialStateEntries(writable);

    try {
        const { db, firestoreModule } = await services();

        for (
            let offset = 0;
            offset < documents.length;
            offset += ENTRY_BATCH_SIZE
        ) {
            if (workspaceId !== activeWorkspaceId) return;

            const deferredDelay = urgent ? 0 : firebaseStateInteractiveDelay();

            if (deferredDelay > 0) {
                queueGroupedPartialStateEntries(documents.slice(offset));
                recordPerformanceEvent("firebase-app-state:commit-deferred", {
                    type: "firebase",
                    reason: "user-active-before-slice",
                    delay: deferredDelay,
                    pendingCount: documents.length - offset
                });
                scheduleEntrySync(deferredDelay);
                return;
            }

            const batch = firestoreModule.writeBatch(db);
            const slice = documents.slice(
                offset,
                offset + ENTRY_BATCH_SIZE
            );

            slice.forEach(entry => {
                const payload = {
                    moduleId: entry.moduleId,
                    storageKey: entry.storageKey,
                    clientId: getClientId(),
                    updatedAtISO: new Date().toISOString(),
                    updatedAt: firestoreModule.serverTimestamp()
                };

                if (
                    Object.keys(entry.items).length ||
                    Object.keys(entry.deletedItems).length
                ) {
                    payload.items = entry.items;
                    payload.deletedItems = entry.deletedItems;
                }

                if (Object.prototype.hasOwnProperty.call(entry, "value")) {
                    payload.value = entry.value;
                    payload.deleted = entry.deleted;
                }

                batch.set(
                    firestoreModule.doc(
                        moduleEntriesCollection(
                            db,
                            firestoreModule,
                            workspaceId,
                            entry.moduleId
                        ),
                        entryDocId(entry.storageKey)
                    ),
                    payload,
                    { merge: true }
                );
            });

            await measurePerformance(
                "firebase-app-state:commit-entries",
                () => batch.commit(),
                {
                    documentCount: slice.length,
                    entryCount: writable.length,
                    moduleIds: Array.from(
                        new Set(slice.map(entry => entry.moduleId))
                    ).join(",")
                },
                {
                    asyncThreshold: 120
                }
            );

            if (offset + ENTRY_BATCH_SIZE < documents.length) {
                const visible =
                    typeof document !== "undefined" &&
                    document.visibilityState === "visible";

                if (shouldDeferFirebaseEntrySlice({ urgent, visible })) {
                    queueGroupedPartialStateEntries(
                        documents.slice(offset + ENTRY_BATCH_SIZE)
                    );
                    recordPerformanceEvent("firebase-app-state:commit-deferred", {
                        type: "firebase",
                        reason: "one-visible-slice-per-flush",
                        delay: ENTRY_ACTIVE_RETRY_MS,
                        pendingCount:
                            documents.length -
                            (offset + ENTRY_BATCH_SIZE)
                    });
                    scheduleEntrySync(ENTRY_ACTIVE_RETRY_MS);
                    return;
                }

                if (!urgent) {
                    await waitFirebaseStateIdle(1200);
                }
            }
        }

        dispatchStatus({
            type: "app-state-entries-saved",
            count: writable.length
        });
    } catch (error) {
        pending.forEach(entry => {
            const id = [
                entry.moduleId,
                entry.storageKey,
                entry.itemKey || ""
            ].join("\u001e");
            pendingStateEntries.set(id, entry);
        });
        dispatchStatus({
            type: "app-state-error",
            message: error.message || "Error guardando cambios parciales"
        });
        console.warn(
            "No se pudieron guardar los cambios parciales del estado.",
            error
        );
    } finally {
        entrySyncInFlight = false;

        if (pendingStateEntries.size) {
            scheduleEntrySync(
                urgentEntrySyncPending ? 0 : firebaseStateInteractiveDelay(),
                { urgent: urgentEntrySyncPending }
            );
        }
    }
}

function dispatchStatus(detail) {
    if (typeof window === "undefined") return;

    window.dispatchEvent(
        new CustomEvent("proturnos:firebaseAppState", {
            detail
        })
    );
}

async function readRemoteModuleSnapshot(
    workspaceId,
    moduleId,
    expectedChunkCount
) {
    const { db, firestoreModule } = await services();
    const snap = await firestoreModule.getDocs(
        moduleChunksCollection(
            db,
            firestoreModule,
            workspaceId,
            moduleId
        )
    );
    const chunks = snap.docs
        .map(docSnap => ({
            id: docSnap.id,
            index: Number(docSnap.data()?.index) || 0,
            text: String(docSnap.data()?.text || "")
        }))
        .sort((a, b) =>
            a.index - b.index ||
            a.id.localeCompare(b.id)
        );

    if (
        Number.isFinite(Number(expectedChunkCount)) &&
        chunks.length < Number(expectedChunkCount)
    ) {
        throw new Error(
            `El modulo ${moduleId} aun no esta completo.`
        );
    }

    const stateString = chunks.map(chunk => chunk.text).join("");

    return {
        stateString,
        snapshot: JSON.parse(stateString || "{}")
    };
}

function stateEntriesFromDoc(docSnap) {
    const data = docSnap.data() || {};
    const updatedAtMillis =
        typeof data.updatedAt?.toMillis === "function"
            ? data.updatedAt.toMillis()
            : Date.parse(String(data.updatedAtISO || "")) || 0;
    const base = {
        moduleId: String(data.moduleId || ""),
        storageKey: String(data.storageKey || ""),
        clientId: String(data.clientId || ""),
        updatedAtISO: String(data.updatedAtISO || ""),
        updatedAtMillis
    };

    if (!base.storageKey) return [];

    if (
        data.items &&
        typeof data.items === "object"
    ) {
        const deletedItems = data.deletedItems || {};
        const itemKeys = new Set([
            ...Object.keys(data.items),
            ...Object.keys(deletedItems)
        ]);

        return [...itemKeys].map(itemKey => ({
            ...base,
            itemKey: decodePartialStateItemKey(itemKey),
            value: data.items[itemKey],
            deleted: deletedItems[itemKey] === true
        }));
    }

    return [{
        ...base,
        itemKey: String(data.itemKey || ""),
        value: data.value,
        deleted: data.deleted === true
    }];
}

async function readRemoteModuleEntries(
    workspaceId,
    moduleId
) {
    const { db, firestoreModule } = await services();
    const snap = await firestoreModule.getDocs(
        moduleEntriesCollection(
            db,
            firestoreModule,
            workspaceId,
            moduleId
        )
    );
    const entries = snap.docs
        .flatMap(stateEntriesFromDoc)
        .filter(entry => entry.storageKey);

    if (entries.length) entryModulesPresent.add(moduleId);
    return entries;
}

function applyRemoteStateEntries(entries = []) {
    return measurePerformance(
        "firebase-app-state:apply-entries",
        () => {
            const applicableEntries = entries.filter(shouldApplyRemoteStateEntry);

            if (!applicableEntries.length) return;

            const patch = {};

            applicableEntries.forEach(entry => {
                const storageKey = entry.storageKey;
                const snapshot = {
                    [storageKey]: Object.prototype.hasOwnProperty.call(patch, storageKey)
                        ? patch[storageKey]
                        : getRaw(storageKey, null)
                };

                applyPartialStateEntry(snapshot, entry);
                patch[storageKey] = Object.prototype.hasOwnProperty.call(
                    snapshot,
                    storageKey
                )
                    ? snapshot[storageKey]
                    : null;
            });

            applyingRemoteState = true;
            let changedKeys = [];

            try {
                changedKeys = measurePerformance(
                    "firebase-app-state:apply-local-patch",
                    () => applyLocalPatch(patch, { silent: true }),
                    {
                        entryCount: applicableEntries.length,
                        patchKeyCount: Object.keys(patch).length
                    }
                );
            } finally {
                applyingRemoteState = false;
            }

            if (changedKeys.length) {
                dispatchStatus({
                    type: "app-state-entries-applied",
                    keys: changedKeys
                });
                onStateChanged(patch, {
                    partial: true,
                    keys: changedKeys
                });
            }
        },
        {
            entryCount: entries.length
        }
    );
}

function handleEntriesSnapshot(
    snap,
    moduleId,
    workspaceId,
    generation
) {
    if (
        workspaceId !== activeWorkspaceId ||
        generation !== syncGeneration
    ) return;

    const changes = typeof snap.docChanges === "function"
        ? snap.docChanges()
        : snap.docs.map(doc => ({ type: "added", doc }));
    const entries = changes
        .filter(change => change.type !== "removed")
        .flatMap(change => stateEntriesFromDoc(change.doc))
        .filter(entry => entry.storageKey);

    if (!entries.length) return;

    entryModulesPresent.add(moduleId);
    recordPerformanceEvent("firebase-app-state:entries-snapshot", {
        type: "firebase",
        moduleId,
        entryCount: entries.length,
        changeCount: changes.length
    });
    queueRemoteStateEntries(entries);
    scheduleRemoteStateApply(firebaseRemoteApplyDelay());
}

async function applyRemoteModule(
    moduleId,
    manifest,
    workspaceId,
    generation
) {
    if (
        workspaceId !== activeWorkspaceId ||
        generation !== syncGeneration
    ) {
        return;
    }

    const remoteHash = String(manifest?.hash || "");
    const localHash = hashString(currentModuleStateString(moduleId));

    if (
        remoteHash &&
        (
            remoteHash === lastAppliedHashes.get(moduleId) ||
            remoteHash === localHash
        )
    ) {
        return;
    }

    const { stateString, snapshot } =
        await readRemoteModuleSnapshot(
            workspaceId,
            moduleId,
            manifest?.chunkCount || 0
        );
    const entries = await readRemoteModuleEntries(
        workspaceId,
        moduleId
    );
    const mergedSnapshot = mergePartialStateEntries(
        { ...snapshot },
        entries
    );
    mergeLocalDirtyStateEntries(mergedSnapshot, moduleId);

    if (
        workspaceId !== activeWorkspaceId ||
        generation !== syncGeneration
    ) {
        return;
    }

    applyingRemoteState = true;

    try {
        measurePerformance(
            "firebase-app-state:replace-module-subset",
            () => replaceLocalSnapshotSubset(
                mergedSnapshot,
                key => stateModuleForKey(key) === moduleId,
                { silent: true }
            ),
            {
                moduleId,
                keyCount: Object.keys(mergedSnapshot).length,
                stateLength: stateString.length
            }
        );
        lastAppliedHashes.set(
            moduleId,
            remoteHash || hashString(stateString)
        );
    } finally {
        applyingRemoteState = false;
    }

    dispatchStatus({
        type: "app-state-module-applied",
        moduleId,
        hash: lastAppliedHashes.get(moduleId)
    });
    onStateChanged(mergedSnapshot);
}

async function applyInitialModules(
    moduleDocs,
    workspaceId,
    generation
) {
    const mergedSnapshot = {};
    const manifests = moduleDocs.filter(({ docSnap }) =>
        docSnap.exists()
    );

    for (const { moduleId, docSnap } of manifests) {
        const manifest = docSnap.data() || {};
        const { stateString, snapshot } =
            await readRemoteModuleSnapshot(
                workspaceId,
                moduleId,
                manifest.chunkCount || 0
            );

        Object.assign(mergedSnapshot, snapshot);
        lastAppliedHashes.set(
            moduleId,
            String(manifest.hash || "") || hashString(stateString)
        );
    }

    const readableModules = stateModuleIds().filter(canReadModule);

    for (const moduleId of readableModules) {
        const entries = await readRemoteModuleEntries(
            workspaceId,
            moduleId
        );

        mergePartialStateEntries(mergedSnapshot, entries);
    }
    mergeLocalDirtyStateEntries(mergedSnapshot);

    if (
        workspaceId !== activeWorkspaceId ||
        generation !== syncGeneration
    ) {
        return;
    }

    applyingRemoteState = true;

    try {
        measurePerformance(
            "firebase-app-state:replace-initial-snapshot",
            () => replaceLocalSnapshot(mergedSnapshot, { silent: true }),
            {
                moduleCount: manifests.length,
                keyCount: Object.keys(mergedSnapshot).length
            }
        );
    } finally {
        applyingRemoteState = false;
    }

    waitingInitialState = false;
    dispatchStatus({
        type: "app-state-applied",
        modules: Array.from(new Set([
            ...manifests.map(({ moduleId }) => moduleId),
            ...entryModulesPresent
        ])),
        empty:
            manifests.length === 0 &&
            entryModulesPresent.size === 0
    });
    onStateChanged(mergedSnapshot);

    if (pendingStateEntries.size) {
        scheduleEntrySync(
            urgentEntrySyncPending ? 0 : ENTRY_SYNC_DELAY_MS,
            { urgent: urgentEntrySyncPending }
        );
    }
}

async function handleModuleSnapshot(
    docSnap,
    moduleId,
    workspaceId,
    generation
) {
    if (
        workspaceId !== activeWorkspaceId ||
        generation !== syncGeneration
    ) {
        return;
    }

    try {
        if (!docSnap.exists()) {
            const localSnapshot = mergeLocalDirtyStateEntries({}, moduleId);

            if (Object.keys(localSnapshot).length) {
                applyingRemoteState = true;
                try {
                    measurePerformance(
                        "firebase-app-state:preserve-local-module-subset",
                        () => replaceLocalSnapshotSubset(
                            localSnapshot,
                            key => stateModuleForKey(key) === moduleId,
                            { silent: true }
                        ),
                        {
                            moduleId,
                            keyCount: Object.keys(localSnapshot).length
                        }
                    );
                } finally {
                    applyingRemoteState = false;
                }
                onStateChanged(localSnapshot);
                return;
            }

            if (entryModulesPresent.has(moduleId)) return;

            applyingRemoteState = true;
            try {
                measurePerformance(
                    "firebase-app-state:clear-module-subset",
                    () => replaceLocalSnapshotSubset(
                        {},
                        key => stateModuleForKey(key) === moduleId,
                        { silent: true }
                    ),
                    {
                        moduleId
                    }
                );
            } finally {
                applyingRemoteState = false;
            }
            lastAppliedHashes.delete(moduleId);
            onStateChanged({});
            return;
        }

        await applyRemoteModule(
            moduleId,
            docSnap.data() || {},
            workspaceId,
            generation
        );
    } catch (error) {
        console.warn("No se pudo aplicar estado modular Firebase.", error);
        dispatchStatus({
            type: "app-state-error",
            moduleId,
            message: error.message || "Error leyendo estado remoto"
        });
    }
}

export async function startFirebaseAppStateSync(
    workspace,
    options = {}
) {
    const workspaceId = workspace?.id || "";

    onStateChanged =
        typeof options.onChange === "function"
            ? options.onChange
            : () => {};

    if (
        activeWorkspaceId === workspaceId &&
        (unsubscribeState || stateSyncStarting)
    ) {
        return;
    }

    stopFirebaseAppStateSync();
    activeWorkspaceId = workspaceId;
    syncGeneration++;
    const generation = syncGeneration;

    if (!activeWorkspaceId) return;

    waitingInitialState = true;
    stateSyncStarting = true;

    try {
        const { db, firestoreModule } = await services();
        const readableModules = stateModuleIds().filter(canReadModule);
        const moduleRefs = readableModules.map(moduleId => ({
            moduleId,
            ref: moduleDocRef(
                db,
                firestoreModule,
                workspaceId,
                moduleId
            )
        }));
        const moduleDocs = await Promise.all(
            moduleRefs.map(async ({ moduleId, ref }) => ({
                moduleId,
                docSnap: await firestoreModule.getDoc(ref)
            }))
        );

        await applyInitialModules(
            moduleDocs,
            workspaceId,
            generation
        );

        if (
            workspaceId !== activeWorkspaceId ||
            generation !== syncGeneration
        ) {
            return;
        }

        const unsubscribers = moduleRefs.map(({ moduleId, ref }) =>
            firestoreModule.onSnapshot(
                ref,
                docSnap =>
                    handleModuleSnapshot(
                        docSnap,
                        moduleId,
                        workspaceId,
                        generation
                    ),
                error => {
                    if (
                        workspaceId === activeWorkspaceId &&
                        generation === syncGeneration
                    ) {
                        dispatchStatus({
                            type: "app-state-error",
                            moduleId,
                            message:
                                error.message ||
                                "No se pudo leer el modulo remoto"
                        });
                    }
                    console.warn(
                        `No se pudo leer el modulo ${moduleId}.`,
                        error
                    );
                }
            )
        );
        const entryUnsubscribers = moduleRefs.map(({ moduleId }) =>
            firestoreModule.onSnapshot(
                moduleEntriesCollection(
                    db,
                    firestoreModule,
                    workspaceId,
                    moduleId
                ),
                snap => handleEntriesSnapshot(
                    snap,
                    moduleId,
                    workspaceId,
                    generation
                ),
                error => {
                    if (
                        workspaceId === activeWorkspaceId &&
                        generation === syncGeneration
                    ) {
                        console.warn(
                            `No se pudieron leer cambios parciales de ${moduleId}.`,
                            error
                        );
                    }
                }
            )
        );

        unsubscribeStateEntries = () => {
            entryUnsubscribers.forEach(unsubscribe => unsubscribe());
        };

        unsubscribeState = () => {
            unsubscribers.forEach(unsubscribe => unsubscribe());
            unsubscribeStateEntries?.();
            unsubscribeStateEntries = null;
        };
    } catch (error) {
        waitingInitialState = false;
        console.warn(
            "No se pudo iniciar sincronizacion modular Firebase.",
            error
        );
    } finally {
        stateSyncStarting = false;
    }
}

export function stopFirebaseAppStateSync() {
    clearTimeout(entrySyncTimer);
    entrySyncTimer = null;
    clearTimeout(remoteApplyTimer);
    remoteApplyTimer = null;

    if (unsubscribeState) {
        unsubscribeState();
        unsubscribeState = null;
    }

    if (unsubscribeStateEntries) {
        unsubscribeStateEntries();
        unsubscribeStateEntries = null;
    }

    activeWorkspaceId = "";
    stateSyncStarting = false;
    applyingRemoteState = false;
    waitingInitialState = false;
    entrySyncInFlight = false;
    remoteApplyInFlight = false;
    lastAppliedHashes.clear();
    pendingStateEntries.clear();
    pendingRemoteStateEntries.clear();
    localDirtyStateEntries.clear();
    entryModulesPresent.clear();
    syncGeneration++;
}

if (typeof window !== "undefined") {
    [
        "pointerdown",
        "keydown",
        "wheel",
        "touchstart",
        "input"
    ].forEach(eventName => {
        window.addEventListener(
            eventName,
            markFirebaseStateUserActivity,
            { capture: true, passive: true }
        );
    });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            scheduleEntrySync(0);
            scheduleRemoteStateApply(0);
        }
    });

    window.addEventListener("proturnos:persistenceChanged", event => {
        const keys = event.detail?.keys || [];
        const stateKeys = keys.filter(key => !isInternalKey(key));

        if (!stateKeys.length) return;

        queuePartialStateEntries(
            planPartialStateEntries({
                keys: stateKeys,
                changes: event.detail?.changes || {},
                readRaw: key => getRaw(key, null),
                moduleForKey: stateModuleForKey
            }),
            {
                urgent: stateKeys.some(isWorkerCalendarUrgentStateKey)
            }
        );
    });
}
