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
// Sube cada vez que cambia la unidad (o se detiene la sincronizacion): una
// subida que empezo con otra generacion deja de escribir.
let syncGeneration = 0;

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

// De donde salen db y firestoreModule. Las pruebas lo cambian para simular un
// Firebase que tarda en responder.
let servicesProvider = getFirebaseServices;

export function setReplacementRequestServicesForTests(provider) {
    servicesProvider = typeof provider === "function" ? provider : getFirebaseServices;
    servicesCache = null;
}

async function services() {
    if (!servicesCache) {
        servicesCache = await servicesProvider();
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

/**
 * Sube los lotes de UNA unidad. La unidad y la generacion se fijan al empezar:
 * si se cambia de unidad mientras espera un lote, los que faltan no se
 * escriben (ni con la unidad nueva, que no es la de estas solicitudes) y sus
 * firmas no se guardan.
 *
 * @param {Object} options
 * @param {string} options.workspaceId  la unidad de estas solicitudes
 * @param {Array} options.requests
 * @param {Function} options.isCurrent  () => sigue siendo la misma generacion
 * @param {Function} options.writeChunk (workspaceId, chunk) => Promise
 * @param {Map} [options.synced]
 * @returns {Promise<number>} cuantos lotes se escribieron
 */
export async function uploadRequestChunks({
    workspaceId,
    requests,
    isCurrent,
    writeChunk,
    synced = syncedSignatures,
    limit = BATCH_LIMIT
}) {
    let written = 0;

    for (const chunk of pendingRequestUploads(requests, synced, limit)) {
        if (!isCurrent()) break;

        await writeChunk(workspaceId, chunk);

        if (!isCurrent()) break;

        chunk.forEach(request => synced.set(String(request.id), requestSignature(request)));
        written += 1;
    }

    return written;
}

async function uploadRequests(requests) {
    if (!activeWorkspaceId || applyingRemoteRequests) return;
    if (syncInFlight) {
        scheduleRequestUpload();
        return;
    }

    syncInFlight = true;

    const workspaceId = activeWorkspaceId;
    const generation = syncGeneration;

    try {
        const {
            db,
            firestoreModule
        } = await services();

        await uploadRequestChunks({
            workspaceId,
            requests,
            isCurrent: () => syncGeneration === generation && activeWorkspaceId === workspaceId,
            writeChunk: async (targetWorkspaceId, chunk) => {
                const batch = firestoreModule.writeBatch(db);

                chunk.forEach(request => {
                    const ref = firestoreModule.doc(
                        db,
                        "workspaces",
                        targetWorkspaceId,
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
            }
        });
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

    // Unidad y generacion de ESTE inicio. Si mientras se espera a Firebase se
    // abre otra unidad, este inicio ya no instala nada: antes podia reanudarse
    // tarde, escuchar la unidad vieja y pisar el listener de la nueva.
    const generation = syncGeneration;
    const isCurrent = () =>
        syncGeneration === generation && activeWorkspaceId === workspaceId;

    try {
        const {
            db,
            firestoreModule
        } = await services();

        if (!isCurrent()) return;

        const collectionRef = requestsCollection(
            db,
            firestoreModule,
            workspaceId
        );

        unsubscribeRequests = firestoreModule.onSnapshot(
            collectionRef,
            snapshot => {
                // Una entrega tardia del listener de otra unidad se ignora.
                if (isCurrent()) applyRemoteSnapshot(snapshot);
            },
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
    syncGeneration += 1;
}

if (typeof window !== "undefined") {
    window.addEventListener("proturnos:replacementRequestsSaved", event => {
        if (event.detail?.remote === false) return;
        scheduleRequestUpload();
    });
}
