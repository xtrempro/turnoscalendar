import { getFirebaseServices } from "./firebaseClient.js";
import {
    exportLocalSnapshot,
    getRaw,
    isInternalKey,
    replaceLocalSnapshot,
    setRaw
} from "./persistence.js";
import { canEditAnyMenu } from "./workspacePermissions.js";

const CLIENT_ID_KEY = "proturnos_firebase_client_id";
const CHUNK_SIZE = 450000;

let activeWorkspaceId = "";
let unsubscribeState = null;
let syncTimer = null;
let syncInFlight = false;
let applyingRemoteState = false;
let waitingInitialState = false;
let servicesCache = null;
let onStateChanged = () => {};
let lastUploadedHash = "";
let lastAppliedHash = "";
let syncGeneration = 0;

function stateDocPath(workspaceId) {
    return [
        "workspaces",
        workspaceId,
        "system",
        "appState"
    ];
}

function chunkDocId(index) {
    return `part_${String(index).padStart(4, "0")}`;
}

function chunksCollection(db, firestoreModule, workspaceId) {
    return firestoreModule.collection(
        db,
        "workspaces",
        workspaceId,
        "appStateChunks"
    );
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

function currentLocalStateString() {
    return stableSnapshotString(exportLocalSnapshot());
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

function dispatchStatus(detail) {
    if (typeof window === "undefined") return;

    window.dispatchEvent(
        new CustomEvent("proturnos:firebaseAppState", {
            detail
        })
    );
}

async function uploadAppState() {
    if (
        !activeWorkspaceId ||
        applyingRemoteState ||
        waitingInitialState ||
        !canEditAnyMenu()
    ) {
        return;
    }

    if (syncInFlight) {
        scheduleAppStateUpload();
        return;
    }

    syncInFlight = true;

    try {
        const workspaceId = activeWorkspaceId;
        const stateString = currentLocalStateString();
        const stateHash = hashString(stateString);

        if (stateHash === lastUploadedHash) return;

        const chunks = splitChunks(stateString);
        const nextChunkIds = new Set(
            chunks.map((_chunk, index) => chunkDocId(index))
        );
        const {
            db,
            firestoreModule
        } = await services();

        if (workspaceId !== activeWorkspaceId) return;

        const batch = firestoreModule.writeBatch(db);
        const chunkCollection =
            chunksCollection(db, firestoreModule, workspaceId);
        const existingChunks =
            await firestoreModule.getDocs(chunkCollection);

        if (workspaceId !== activeWorkspaceId) return;

        chunks.forEach((chunk, index) => {
            batch.set(
                firestoreModule.doc(
                    db,
                    "workspaces",
                    workspaceId,
                    "appStateChunks",
                    chunkDocId(index)
                ),
                {
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
            firestoreModule.doc(
                db,
                ...stateDocPath(workspaceId)
            ),
            {
                chunkCount: chunks.length,
                charCount: stateString.length,
                hash: stateHash,
                clientId: getClientId(),
                updatedAtISO: new Date().toISOString(),
                updatedAt: firestoreModule.serverTimestamp()
            },
            { merge: true }
        );

        if (workspaceId !== activeWorkspaceId) return;

        await batch.commit();

        if (workspaceId !== activeWorkspaceId) return;

        lastUploadedHash = stateHash;
        dispatchStatus({
            type: "app-state-uploaded",
            chunkCount: chunks.length,
            hash: stateHash
        });
    } catch (error) {
        console.warn("No se pudo sincronizar el estado Firebase.", error);
        dispatchStatus({
            type: "app-state-error",
            message: error.message || "Error sincronizando estado"
        });
    } finally {
        syncInFlight = false;
    }
}

function scheduleAppStateUpload() {
    if (
        !activeWorkspaceId ||
        applyingRemoteState ||
        waitingInitialState ||
        !canEditAnyMenu()
    ) {
        return;
    }

    clearTimeout(syncTimer);
    syncTimer = setTimeout(uploadAppState, 900);
}

async function readRemoteStateString(workspaceId, expectedChunkCount) {
    const {
        db,
        firestoreModule
    } = await services();
    const snap = await firestoreModule.getDocs(
        chunksCollection(db, firestoreModule, workspaceId)
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
            "La copia remota aun no esta completa. Intenta nuevamente."
        );
    }

    return chunks.map(chunk => chunk.text).join("");
}

async function applyRemoteState(manifest, workspaceId, generation) {
    if (
        workspaceId !== activeWorkspaceId ||
        generation !== syncGeneration
    ) {
        return;
    }

    const remoteHash = String(manifest?.hash || "");

    if (
        remoteHash &&
        (
            remoteHash === lastAppliedHash ||
            remoteHash === lastUploadedHash ||
            remoteHash === hashString(currentLocalStateString())
        )
    ) {
        return;
    }

    const stateString = await readRemoteStateString(
        workspaceId,
        manifest?.chunkCount || 0
    );
    const snapshot = JSON.parse(stateString || "{}");

    if (
        workspaceId !== activeWorkspaceId ||
        generation !== syncGeneration
    ) {
        return;
    }

    applyingRemoteState = true;

    try {
        replaceLocalSnapshot(snapshot, { silent: true });
        lastAppliedHash = remoteHash || hashString(stateString);
    } finally {
        applyingRemoteState = false;
    }

    dispatchStatus({
        type: "app-state-applied",
        hash: lastAppliedHash
    });
    onStateChanged(snapshot);
}

async function applyEmptyRemoteState(workspaceId, generation) {
    if (
        workspaceId !== activeWorkspaceId ||
        generation !== syncGeneration
    ) {
        return;
    }

    const stateString = stableSnapshotString({});

    applyingRemoteState = true;

    try {
        replaceLocalSnapshot({}, { silent: true });
        lastAppliedHash = hashString(stateString);
    } finally {
        applyingRemoteState = false;
    }

    dispatchStatus({
        type: "app-state-applied",
        hash: lastAppliedHash,
        empty: true
    });
    onStateChanged({});
}

async function handleRemoteSnapshot(docSnap, workspaceId, generation) {
    if (
        workspaceId !== activeWorkspaceId ||
        generation !== syncGeneration
    ) {
        return;
    }

    waitingInitialState = false;

    if (!docSnap.exists()) {
        lastAppliedHash = "";
        await applyEmptyRemoteState(workspaceId, generation);
        scheduleAppStateUpload();
        return;
    }

    try {
        await applyRemoteState(docSnap.data(), workspaceId, generation);
    } catch (error) {
        console.warn("No se pudo aplicar estado remoto Firebase.", error);
        dispatchStatus({
            type: "app-state-error",
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

    if (activeWorkspaceId === workspaceId && unsubscribeState) {
        return;
    }

    stopFirebaseAppStateSync();
    activeWorkspaceId = workspaceId;
    syncGeneration++;
    const generation = syncGeneration;

    if (!activeWorkspaceId) return;

    waitingInitialState = true;

    try {
        const {
            db,
            firestoreModule
        } = await services();

        unsubscribeState = firestoreModule.onSnapshot(
            firestoreModule.doc(
                db,
                ...stateDocPath(workspaceId)
            ),
            docSnap =>
                handleRemoteSnapshot(docSnap, workspaceId, generation),
            error => {
                if (
                    workspaceId === activeWorkspaceId &&
                    generation === syncGeneration
                ) {
                    waitingInitialState = false;
                }
                console.warn("No se pudo leer estado Firebase.", error);
            }
        );
    } catch (error) {
        waitingInitialState = false;
        console.warn(
            "No se pudo iniciar sincronizacion de estado Firebase.",
            error
        );
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
    syncInFlight = false;
    applyingRemoteState = false;
    waitingInitialState = false;
    lastUploadedHash = "";
    lastAppliedHash = "";
    syncGeneration++;
}

if (typeof window !== "undefined") {
    window.addEventListener("proturnos:persistenceChanged", event => {
        const keys = event.detail?.keys || [];

        if (keys.length && keys.every(isInternalKey)) return;

        scheduleAppStateUpload();
    });
}
