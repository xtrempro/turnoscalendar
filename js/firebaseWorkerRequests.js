import {
    getCurrentFirebaseUser,
    getFirebaseServices,
    isFirebaseConfigured
} from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";
import {
    getWorkerRequests,
    saveWorkerRequests
} from "./storage.js";

let activeWorkspaceId = "";
let unsubscribeRequests = null;
let applyingRemoteRequests = false;
let syncTimer = null;
let syncInFlight = false;
let servicesCache = null;
let onRequestsChanged = () => {};
const REQUEST_CLAIM_TTL_MS = 5 * 60 * 1000;
const TERMINAL_REQUEST_STATUSES = new Set([
    "accepted",
    "rejected",
    "canceled"
]);

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
        "workerRequests"
    );
}

async function uploadRequests(requests) {
    if (!activeWorkspaceId || applyingRemoteRequests) return;
    if (syncInFlight) {
        scheduleWorkerRequestUpload();
        return;
    }

    syncInFlight = true;

    try {
        const {
            db,
            firestoreModule
        } = await services();
        const validRequests = requests.filter(request => request?.id);

        // La resolucion de una solicitud es monotona. La transaccion impide que
        // una subida que salio con una copia local antigua vuelva a escribir
        // "pending" despues de que otro supervisor ya la acepto o rechazo.
        for (let offset = 0; offset < validRequests.length; offset += 100) {
            const slice = validRequests.slice(offset, offset + 100);
            const refs = slice.map(request => firestoreModule.doc(
                db,
                "workspaces",
                activeWorkspaceId,
                "workerRequests",
                requestDocId(request)
            ));

            await firestoreModule.runTransaction(db, async transaction => {
                const snapshots = await Promise.all(
                    refs.map(ref => transaction.get(ref))
                );

                slice.forEach((request, index) => {
                    const remote = snapshots[index].exists()
                        ? snapshots[index].data()
                        : null;

                    if (!shouldUploadWorkerRequest(request, remote)) return;

                    transaction.set(
                        refs[index],
                        {
                            ...request,
                            updatedAt: firestoreModule.serverTimestamp()
                        },
                        { merge: true }
                    );
                });
            });
        }
    } catch (error) {
        console.warn(
            "No se pudieron sincronizar solicitudes de trabajadores.",
            error
        );
    } finally {
        syncInFlight = false;
    }
}

export function shouldUploadWorkerRequest(local, remote) {
    if (!local?.id) return false;
    if (!remote) return true;

    const remoteStatus = String(remote.status || "");
    const localStatus = String(local.status || "");

    return !(
        TERMINAL_REQUEST_STATUSES.has(remoteStatus) &&
        remoteStatus !== localStatus
    );
}

function resolutionClaimToken() {
    return globalThis.crypto?.randomUUID?.() ||
        `request_claim_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function resolutionWorkspaceId() {
    return activeWorkspaceId || getActiveWorkspace()?.id || "";
}

function requestRef(db, firestoreModule, workspaceId, requestId) {
    return firestoreModule.doc(
        db,
        "workspaces",
        workspaceId,
        "workerRequests",
        requestDocId({ id: requestId })
    );
}

function activeResolutionClaim(request, now = Date.now()) {
    const expiresAt = Date.parse(String(request?.resolutionClaimExpiresAt || ""));

    return Boolean(
        request?.resolutionClaimToken &&
        Number.isFinite(expiresAt) &&
        expiresAt > now
    );
}

/**
 * Reserva una solicitud pendiente para un solo supervisor. El estado sigue
 * siendo `pending` hasta terminar, por lo que una sesion interrumpida puede
 * reintentarse cuando venza la reserva.
 */
export async function claimWorkerRequestResolution(request = {}) {
    if (!request?.id) return { claimed: false, reason: "missing" };

    const workspaceId = resolutionWorkspaceId();

    if (
        !workspaceId ||
        !isFirebaseConfigured() ||
        !getCurrentFirebaseUser()
    ) {
        return {
            claimed: true,
            local: true,
            token: `local:${resolutionClaimToken()}`
        };
    }

    const { db, firestoreModule } = await services();
    const ref = requestRef(db, firestoreModule, workspaceId, request.id);
    const token = resolutionClaimToken();
    const now = Date.now();
    let reason = "busy";

    await firestoreModule.runTransaction(db, async transaction => {
        const snapshot = await transaction.get(ref);
        const current = snapshot.exists() ? snapshot.data() : request;

        if (String(current?.status || "pending") !== "pending") {
            reason = "resolved";
            return;
        }

        if (activeResolutionClaim(current, now)) {
            reason = "busy";
            return;
        }

        const initial = snapshot.exists() ? {} : { ...request };

        transaction.set(
            ref,
            {
                ...initial,
                id: request.id,
                resolutionClaimToken: token,
                resolutionClaimedByUid: getCurrentFirebaseUser()?.uid || "",
                resolutionClaimedAt: new Date(now).toISOString(),
                resolutionClaimExpiresAt:
                    new Date(now + REQUEST_CLAIM_TTL_MS).toISOString(),
                updatedAt: firestoreModule.serverTimestamp()
            },
            { merge: true }
        );
        reason = "";
    });

    return reason
        ? { claimed: false, reason }
        : { claimed: true, token };
}

export async function finishWorkerRequestResolution(
    requestId,
    token,
    patch = {}
) {
    if (!requestId || !token) return false;
    if (String(token).startsWith("local:")) return true;
    const workspaceId = resolutionWorkspaceId();

    if (!workspaceId) return false;

    const { db, firestoreModule } = await services();
    const ref = requestRef(db, firestoreModule, workspaceId, requestId);
    let finished = false;

    await firestoreModule.runTransaction(db, async transaction => {
        const snapshot = await transaction.get(ref);
        const current = snapshot.exists() ? snapshot.data() : null;

        if (!current) return;
        if (
            current.status === patch.status &&
            TERMINAL_REQUEST_STATUSES.has(String(current.status || ""))
        ) {
            finished = true;
            return;
        }
        if (
            current.status !== "pending" ||
            current.resolutionClaimToken !== token
        ) return;

        transaction.set(
            ref,
            {
                ...patch,
                resolutionClaimToken: firestoreModule.deleteField(),
                resolutionClaimedByUid: firestoreModule.deleteField(),
                resolutionClaimedAt: firestoreModule.deleteField(),
                resolutionClaimExpiresAt: firestoreModule.deleteField(),
                updatedAt: firestoreModule.serverTimestamp()
            },
            { merge: true }
        );
        finished = true;
    });

    return finished;
}

export async function releaseWorkerRequestResolution(requestId, token) {
    if (!requestId || !token || String(token).startsWith("local:")) return;
    const workspaceId = resolutionWorkspaceId();

    if (!workspaceId) return;

    const { db, firestoreModule } = await services();
    const ref = requestRef(db, firestoreModule, workspaceId, requestId);

    await firestoreModule.runTransaction(db, async transaction => {
        const snapshot = await transaction.get(ref);
        const current = snapshot.exists() ? snapshot.data() : null;

        if (
            !current ||
            current.status !== "pending" ||
            current.resolutionClaimToken !== token
        ) return;

        transaction.set(
            ref,
            {
                resolutionClaimToken: firestoreModule.deleteField(),
                resolutionClaimedByUid: firestoreModule.deleteField(),
                resolutionClaimedAt: firestoreModule.deleteField(),
                resolutionClaimExpiresAt: firestoreModule.deleteField(),
                updatedAt: firestoreModule.serverTimestamp()
            },
            { merge: true }
        );
    });
}

function scheduleWorkerRequestUpload() {
    if (!activeWorkspaceId || applyingRemoteRequests) return;

    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        uploadRequests(getWorkerRequests());
    }, 650);
}

// Una solicitud solo avanza de "pendiente" a resuelta: nada en el app la
// devuelve a pendiente. Asi que si el local ya la resolvio y el remoto todavia
// la trae pendiente, el remoto esta atrasado, no al reves.
//
// Sin esto, aceptar una solicitud se perdia: la resolucion queda local y la
// subida va con 650 ms de retraso, asi que cualquier snapshot que llegara en esa
// ventana la devolvia a "pendiente" -y la subida siguiente cementaba la vuelta
// atras, porque sube la lista COMPLETA tal como quedo-. El cambio de turno si se
// aplicaba, porque viaja por otro modulo de estado; lo que se revertia era el
// estado de la solicitud.
function mergeRemoteRequest(local, remote) {
    if (!local) return remote;
    if (!remote) return local;

    return local.status !== "pending" && remote.status === "pending"
        ? local
        : remote;
}

// Exportada para poder probarla sin Firebase: es la regla que decide que
// version de cada solicitud sobrevive.
export function mergeRemoteRequests(localRequests, remoteRequests) {
    const localById = new Map(
        (localRequests || []).map(request => [String(request.id), request])
    );
    const remoteIds = new Set(
        (remoteRequests || []).map(request => String(request.id))
    );
    const merged = (remoteRequests || []).map(remote =>
        mergeRemoteRequest(localById.get(String(remote.id)), remote)
    );
    // Las que solo existen aca todavia no se han subido: descartarlas las
    // borraba antes de que la subida alcanzara a salir.
    const localOnly = (localRequests || []).filter(request =>
        !remoteIds.has(String(request.id))
    );

    return {
        requests: [...merged, ...localOnly],
        // Si algo del local gano, el remoto quedo atrasado y hay que empujarlo.
        remoteIsBehind:
            localOnly.length > 0 ||
            merged.some((request, index) => request !== remoteRequests[index])
    };
}

function applyRemoteSnapshot(snapshot) {
    const localRequests = getWorkerRequests();
    const remoteRequests = snapshot.docs
        .map(docSnap => docSnap.data())
        .filter(request => request?.id)
        .sort((a, b) =>
            String(b.createdAt || "").localeCompare(
                String(a.createdAt || "")
            )
        );

    if (!remoteRequests.length) {
        if (localRequests.length) {
            scheduleWorkerRequestUpload();
        }
        return;
    }

    const { requests, remoteIsBehind } = mergeRemoteRequests(
        localRequests,
        remoteRequests
    );

    applyingRemoteRequests = true;

    try {
        saveWorkerRequests(requests, { silent: true });
    } finally {
        applyingRemoteRequests = false;
    }

    if (remoteIsBehind) scheduleWorkerRequestUpload();

    onRequestsChanged(requests);
}

export async function startFirebaseWorkerRequestSync(
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

    stopFirebaseWorkerRequestSync();
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
                    "No se pudo leer solicitudes de trabajadores Firebase.",
                    error
                );
            }
        );

        scheduleWorkerRequestUpload();
    } catch (error) {
        console.warn(
            "No se pudo iniciar sincronizacion de solicitudes de trabajadores.",
            error
        );
    }
}

export function stopFirebaseWorkerRequestSync() {
    clearTimeout(syncTimer);
    syncTimer = null;

    if (unsubscribeRequests) {
        unsubscribeRequests();
        unsubscribeRequests = null;
    }

    activeWorkspaceId = "";
    applyingRemoteRequests = false;
}

if (typeof window !== "undefined") {
    window.addEventListener("proturnos:workerRequestsSaved", event => {
        if (event.detail?.remote === false) return;
        scheduleWorkerRequestUpload();
    });
}
