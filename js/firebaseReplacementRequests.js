import { getFirebaseServices } from "./firebaseClient.js";
import {
    getReplacementRequests,
    saveReplacementRequests
} from "./storage.js";
import {
    applyAcceptedReplacementRequests,
    expireReplacementRequests
} from "./replacements.js";

let activeWorkspaceId = "";
let unsubscribeRequests = null;
let applyingRemoteRequests = false;
let syncTimer = null;
let syncInFlight = false;
let servicesCache = null;
let onRequestsChanged = () => {};

// Lo que ya esta en la nube, por solicitud. Antes cada cambio volvia a subir
// TODAS las solicitudes historicas en un solo lote, que se iba a topar con el
// limite de 500 escrituras por lote; ahora solo sube las que cambiaron, en
// lotes de hasta BATCH_LIMIT.
const syncedSignatures = new Map();
const BATCH_LIMIT = 400;

// La huella de una solicitud, sin la fecha que pone el servidor.
export function requestSignature(request) {
    const { updatedAt, ...rest } = request || {};

    return JSON.stringify(rest);
}

/** Las solicitudes que difieren de lo ya subido, en lotes. */
export function pendingRequestUploads(requests, synced = syncedSignatures, limit = BATCH_LIMIT) {
    const changed = (requests || []).filter(request =>
        request?.id && synced.get(String(request.id)) !== requestSignature(request)
    );
    const batches = [];

    for (let index = 0; index < changed.length; index += limit) {
        batches.push(changed.slice(index, index + limit));
    }

    return batches;
}

function requestDocId(request) {
    return encodeURIComponent(String(request?.id || "").trim())
        .replace(/\./g, "%2E");
}

async function services() {
    if (!servicesCache) {
        servicesCache = await getFirebaseServices();
    }

    return servicesCache;
}

function requestsCollection(db, firestoreModule, workspaceId) {
    return firestoreModule.collection(
        db,
        "workspaces",
        workspaceId,
        "replacementRequests"
    );
}

async function uploadRequests(requests) {
    if (!activeWorkspaceId || applyingRemoteRequests) return;
    if (syncInFlight) {
        scheduleRequestUpload();
        return;
    }

    syncInFlight = true;

    try {
        const {
            db,
            firestoreModule
        } = await services();

        for (const chunk of pendingRequestUploads(requests)) {
            const batch = firestoreModule.writeBatch(db);

            chunk.forEach(request => {
                const ref = firestoreModule.doc(
                    db,
                    "workspaces",
                    activeWorkspaceId,
                    "replacementRequests",
                    requestDocId(request)
                );

                batch.set(
                    ref,
                    {
                        ...request,
                        updatedAt: firestoreModule.serverTimestamp()
                    },
                    { merge: true }
                );
            });

            await batch.commit();
            chunk.forEach(request => syncedSignatures.set(String(request.id), requestSignature(request)));
        }
    } catch (error) {
        console.warn(
            "No se pudieron sincronizar solicitudes de reemplazo.",
            error
        );
    } finally {
        syncInFlight = false;
    }
}

function scheduleRequestUpload() {
    if (!activeWorkspaceId || applyingRemoteRequests) return;

    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        uploadRequests(expireReplacementRequests());
    }, 650);
}

// Una solicitud solo avanza de "pending" a resuelta; nada la devuelve a
// pendiente. Si el local ya la resolvio y el remoto la trae pendiente, el
// remoto esta atrasado.
//
// Es el mismo defecto que se corrigio en las solicitudes de trabajador:
// reemplazar la lista local por la remota perdia la resolucion recien hecha,
// porque la subida va con 650 ms de retraso y cualquier snapshot que llegara en
// esa ventana la revertia. Aca costaria una anulacion o una aceptacion.
function mergeRemoteReplacementRequest(local, remote) {
    if (!local) return remote;
    if (!remote) return local;

    return local.status !== "pending" && remote.status === "pending"
        ? local
        : remote;
}

export function mergeRemoteReplacementRequests(localRequests, remoteRequests) {
    const localById = new Map(
        (localRequests || []).map(request => [String(request.id), request])
    );
    const remoteIds = new Set(
        (remoteRequests || []).map(request => String(request.id))
    );
    const merged = (remoteRequests || []).map(remote =>
        mergeRemoteReplacementRequest(localById.get(String(remote.id)), remote)
    );
    // Las que solo existen aca todavia no se subieron: descartarlas las borraria
    // antes de que la subida alcanzara a salir.
    const localOnly = (localRequests || []).filter(request =>
        !remoteIds.has(String(request.id))
    );

    return {
        requests: [...merged, ...localOnly],
        remoteIsBehind:
            localOnly.length > 0 ||
            merged.some((request, index) => request !== remoteRequests[index])
    };
}

function applyRemoteSnapshot(snapshot) {
    const localRequests = getReplacementRequests();
    const remoteRequests = snapshot.docs
        .map(docSnap => docSnap.data())
        .filter(request => request?.id);

    // Lo que llega de la nube ya esta subido tal cual.
    remoteRequests.forEach(request =>
        syncedSignatures.set(String(request.id), requestSignature(request))
    );
    remoteRequests
        .sort((a, b) =>
            String(a.createdAt || "").localeCompare(
                String(b.createdAt || "")
            )
        );

    if (!remoteRequests.length) {
        if (localRequests.length) {
            scheduleRequestUpload();
        }
        return;
    }

    const { requests, remoteIsBehind } = mergeRemoteReplacementRequests(
        localRequests,
        remoteRequests
    );

    applyingRemoteRequests = true;

    try {
        saveReplacementRequests(requests, { silent: true });
    } finally {
        applyingRemoteRequests = false;
    }

    const appliedAccepted = applyAcceptedReplacementRequests();

    if (appliedAccepted || remoteIsBehind) {
        scheduleRequestUpload();
    }

    onRequestsChanged(requests);
}

export async function startFirebaseReplacementRequestSync(
    workspace,
    options = {}
) {
    const workspaceId = workspace?.id || "";

    onRequestsChanged =
        typeof options.onChange === "function"
            ? options.onChange
            : () => {};

    if (activeWorkspaceId === workspaceId && unsubscribeRequests) {
        return;
    }

    stopFirebaseReplacementRequestSync();
    activeWorkspaceId = workspaceId;

    if (!activeWorkspaceId) return;

    try {
        const {
            db,
            firestoreModule
        } = await services();
        const collectionRef = requestsCollection(
            db,
            firestoreModule,
            activeWorkspaceId
        );

        unsubscribeRequests = firestoreModule.onSnapshot(
            collectionRef,
            applyRemoteSnapshot,
            error => {
                console.warn(
                    "No se pudo leer solicitudes de reemplazo Firebase.",
                    error
                );
            }
        );

        scheduleRequestUpload();
    } catch (error) {
        console.warn(
            "No se pudo iniciar sincronizacion de solicitudes.",
            error
        );
    }
}

export function stopFirebaseReplacementRequestSync() {
    clearTimeout(syncTimer);
    syncTimer = null;

    if (unsubscribeRequests) {
        unsubscribeRequests();
        unsubscribeRequests = null;
    }

    activeWorkspaceId = "";
    applyingRemoteRequests = false;
    syncedSignatures.clear();
}

if (typeof window !== "undefined") {
    window.addEventListener("proturnos:replacementRequestsSaved", event => {
        if (event.detail?.remote === false) return;
        scheduleRequestUpload();
    });
}
