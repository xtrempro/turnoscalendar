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

const CLIENT_ID_KEY = "proturnos_firebase_client_id";
const ENTRY_BATCH_SIZE = 400;
const ENTRY_SYNC_DELAY_MS = 350;

let activeWorkspaceId = "";
let unsubscribeState = null;
let stateSyncStarting = false;
let entrySyncTimer = null;
let applyingRemoteState = false;
let waitingInitialState = false;
let servicesCache = null;
let onStateChanged = () => {};
let syncGeneration = 0;
const lastAppliedHashes = new Map();
const pendingStateEntries = new Map();
const entryModulesPresent = new Set();
let unsubscribeStateEntries = null;

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

function queuePartialStateEntries(entries = []) {
    entries.forEach(entry => {
        const id = [
            entry.moduleId,
            entry.storageKey,
            entry.itemKey || ""
        ].join("\u001e");

        pendingStateEntries.set(id, entry);
    });

    if (
        !pendingStateEntries.size ||
        !activeWorkspaceId ||
        applyingRemoteState ||
        waitingInitialState
    ) return;

    clearTimeout(entrySyncTimer);
    entrySyncTimer = setTimeout(
        flushPartialStateEntries,
        ENTRY_SYNC_DELAY_MS
    );
}

async function flushPartialStateEntries() {
    entrySyncTimer = null;

    if (
        !activeWorkspaceId ||
        applyingRemoteState ||
        waitingInitialState ||
        !pendingStateEntries.size
    ) return;

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

            await batch.commit();
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
    const base = {
        moduleId: String(data.moduleId || ""),
        storageKey: String(data.storageKey || "")
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
    const patch = {};

    entries.forEach(entry => {
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
        changedKeys = applyLocalPatch(patch, { silent: true });
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
    applyRemoteStateEntries(entries);
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

    if (
        workspaceId !== activeWorkspaceId ||
        generation !== syncGeneration
    ) {
        return;
    }

    applyingRemoteState = true;

    try {
        replaceLocalSnapshotSubset(
            mergedSnapshot,
            key => stateModuleForKey(key) === moduleId,
            { silent: true }
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

    if (
        workspaceId !== activeWorkspaceId ||
        generation !== syncGeneration
    ) {
        return;
    }

    applyingRemoteState = true;

    try {
        replaceLocalSnapshot(mergedSnapshot, { silent: true });
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
        queuePartialStateEntries([]);
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
            if (entryModulesPresent.has(moduleId)) return;

            applyingRemoteState = true;
            try {
                replaceLocalSnapshotSubset(
                    {},
                    key => stateModuleForKey(key) === moduleId,
                    { silent: true }
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
    lastAppliedHashes.clear();
    pendingStateEntries.clear();
    entryModulesPresent.clear();
    syncGeneration++;
}

if (typeof window !== "undefined") {
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
            })
        );
    });
}
