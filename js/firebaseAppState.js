import { getFirebaseServices } from "./firebaseClient.js";
import {
    exportLocalSnapshot,
    getJSON,
    getRaw,
    isInternalKey,
    removeKey,
    replaceLocalSnapshot,
    replaceLocalSnapshotSubset,
    setJSON,
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

const CLIENT_ID_KEY = "proturnos_firebase_client_id";
const LEGACY_DIRTY_KEY = "proturnos_appstate_dirty_at";
const DIRTY_MODULES_KEY = "proturnos_state_modules_dirty";
const CHUNK_SIZE = 450000;

let activeWorkspaceId = "";
let unsubscribeState = null;
let stateSyncStarting = false;
let syncTimer = null;
let applyingRemoteState = false;
let waitingInitialState = false;
let servicesCache = null;
let onStateChanged = () => {};
let syncGeneration = 0;
const uploadsInFlight = new Set();
const lastUploadedHashes = new Map();
const lastAppliedHashes = new Map();

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

function chunkDocId(index) {
    return `part_${String(index).padStart(4, "0")}`;
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

function dirtyModules() {
    const value = getJSON(DIRTY_MODULES_KEY, {});

    return value && typeof value === "object" ? value : {};
}

function markModulesDirty(moduleIds) {
    const next = dirtyModules();
    const now = Date.now();

    moduleIds.forEach(moduleId => {
        next[moduleId] = now;
    });

    setJSON(DIRTY_MODULES_KEY, next);
}

function clearModuleDirty(moduleId, uploadedHash) {
    if (hashString(currentModuleStateString(moduleId)) !== uploadedHash) {
        return;
    }

    const next = dirtyModules();

    delete next[moduleId];

    if (Object.keys(next).length) {
        setJSON(DIRTY_MODULES_KEY, next);
    } else {
        removeKey(DIRTY_MODULES_KEY);
    }
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

function splitChunks(value) {
    const chunks = [];

    for (let index = 0; index < value.length; index += CHUNK_SIZE) {
        chunks.push(value.slice(index, index + CHUNK_SIZE));
    }

    return chunks.length ? chunks : [""];
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

function dispatchStatus(detail) {
    if (typeof window === "undefined") return;

    window.dispatchEvent(
        new CustomEvent("proturnos:firebaseAppState", {
            detail
        })
    );
}

async function uploadModule(moduleId) {
    if (
        !activeWorkspaceId ||
        applyingRemoteState ||
        waitingInitialState ||
        uploadsInFlight.has(moduleId) ||
        !canWriteModule(moduleId)
    ) {
        return;
    }

    uploadsInFlight.add(moduleId);

    try {
        const workspaceId = activeWorkspaceId;
        const stateString = currentModuleStateString(moduleId);
        const stateHash = hashString(stateString);

        if (stateHash === lastUploadedHashes.get(moduleId)) {
            clearModuleDirty(moduleId, stateHash);
            return;
        }

        const chunks = splitChunks(stateString);
        const nextChunkIds = new Set(
            chunks.map((_chunk, index) => chunkDocId(index))
        );
        const { db, firestoreModule } = await services();

        if (workspaceId !== activeWorkspaceId) return;

        const chunkCollection = moduleChunksCollection(
            db,
            firestoreModule,
            workspaceId,
            moduleId
        );
        const existingChunks =
            await firestoreModule.getDocs(chunkCollection);

        if (workspaceId !== activeWorkspaceId) return;

        const batch = firestoreModule.writeBatch(db);

        chunks.forEach((chunk, index) => {
            batch.set(
                firestoreModule.doc(
                    chunkCollection,
                    chunkDocId(index)
                ),
                {
                    moduleId,
                    index,
                    text: chunk,
                    updatedAt: firestoreModule.serverTimestamp()
                }
            );
        });

        existingChunks.docs.forEach(docSnap => {
            if (!nextChunkIds.has(docSnap.id)) {
                batch.delete(docSnap.ref);
            }
        });

        batch.set(
            moduleDocRef(
                db,
                firestoreModule,
                workspaceId,
                moduleId
            ),
            {
                moduleId,
                permission: stateModulePermission(moduleId),
                chunkCount: chunks.length,
                charCount: stateString.length,
                hash: stateHash,
                clientId: getClientId(),
                updatedAtISO: new Date().toISOString(),
                updatedAt: firestoreModule.serverTimestamp()
            }
        );

        await batch.commit();

        if (workspaceId !== activeWorkspaceId) return;

        lastUploadedHashes.set(moduleId, stateHash);
        clearModuleDirty(moduleId, stateHash);
        dispatchStatus({
            type: "app-state-module-uploaded",
            moduleId,
            chunkCount: chunks.length,
            hash: stateHash
        });
    } catch (error) {
        console.warn(
            `No se pudo sincronizar el modulo ${moduleId}.`,
            error
        );
        dispatchStatus({
            type: "app-state-error",
            moduleId,
            message: error.message || "Error sincronizando estado"
        });
    } finally {
        uploadsInFlight.delete(moduleId);
    }
}

async function uploadDirtyModules() {
    if (
        !activeWorkspaceId ||
        applyingRemoteState ||
        waitingInitialState
    ) {
        return;
    }

    const pending = Object.keys(dirtyModules())
        .filter(moduleId => stateModuleIds().includes(moduleId));

    for (const moduleId of pending) {
        await uploadModule(moduleId);
    }
}

function scheduleAppStateUpload() {
    if (
        !activeWorkspaceId ||
        applyingRemoteState ||
        waitingInitialState
    ) {
        return;
    }

    clearTimeout(syncTimer);
    syncTimer = setTimeout(uploadDirtyModules, 900);
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

function remoteIsOlderThanLocal(moduleId, manifest) {
    const localDirtyAt =
        Number(dirtyModules()[moduleId]) || 0;
    const remoteUpdatedAt =
        Date.parse(manifest?.updatedAtISO || "") || 0;

    return Boolean(
        localDirtyAt &&
        remoteUpdatedAt &&
        localDirtyAt > remoteUpdatedAt
    );
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
            remoteHash === lastUploadedHashes.get(moduleId) ||
            remoteHash === localHash
        )
    ) {
        return;
    }

    if (remoteIsOlderThanLocal(moduleId, manifest)) {
        scheduleAppStateUpload();
        return;
    }

    const { stateString, snapshot } =
        await readRemoteModuleSnapshot(
            workspaceId,
            moduleId,
            manifest?.chunkCount || 0
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
            snapshot,
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
    onStateChanged(snapshot);
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
        modules: manifests.map(({ moduleId }) => moduleId),
        empty: manifests.length === 0
    });
    onStateChanged(mergedSnapshot);
    scheduleAppStateUpload();
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

        unsubscribeState = () => {
            unsubscribers.forEach(unsubscribe => unsubscribe());
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
    clearTimeout(syncTimer);
    syncTimer = null;

    if (unsubscribeState) {
        unsubscribeState();
        unsubscribeState = null;
    }

    activeWorkspaceId = "";
    stateSyncStarting = false;
    applyingRemoteState = false;
    waitingInitialState = false;
    uploadsInFlight.clear();
    lastUploadedHashes.clear();
    lastAppliedHashes.clear();
    removeKey(LEGACY_DIRTY_KEY);
    removeKey(DIRTY_MODULES_KEY);
    syncGeneration++;
}

if (typeof window !== "undefined") {
    window.addEventListener("proturnos:persistenceChanged", event => {
        const keys = event.detail?.keys || [];
        const stateKeys = keys.filter(key => !isInternalKey(key));

        if (!stateKeys.length) return;

        markModulesDirty(
            new Set(stateKeys.map(stateModuleForKey))
        );
        scheduleAppStateUpload();
    });
}
