// Transferencias de trabajadores entre unidades enlazadas.
//
// Envoltorios delgados de las funciones del servidor
// (functions/workerTransferRequests.js), como js/firebaseInterUnitAbsences.js.
// Lo que cada unidad hace con una transferencia -crear el perfil en destino,
// inactivarlo en origen- vive en main.js, que es donde viven los perfiles.

import { getFirebaseServices } from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";

const COLLECTION = "workerTransferRequests";

async function callFunction(name, payload) {
    const { functions, functionsModule } = await getFirebaseServices();
    const callable = functionsModule.httpsCallable(functions, name);
    const result = await callable(payload);

    return result.data;
}

function activeWorkspaceOrThrow() {
    const workspace = getActiveWorkspace();

    if (!workspace?.id) {
        throw new Error("Selecciona una unidad antes de gestionar transferencias.");
    }

    return workspace;
}

/**
 * Las transferencias que tocan a la unidad activa: las que envio y las que
 * le enviaron. Una fuente y que la pantalla filtre, como las ausencias.
 */
export async function listWorkerTransferRequests() {
    const workspace = getActiveWorkspace();

    if (!workspace?.id) return [];

    const { db, firestoreModule } = await getFirebaseServices();
    const ref = firestoreModule.collection(db, COLLECTION);
    const snaps = await Promise.all([
        firestoreModule.getDocs(firestoreModule.query(
            ref,
            firestoreModule.where("targetWorkspaceId", "==", workspace.id)
        )),
        firestoreModule.getDocs(firestoreModule.query(
            ref,
            firestoreModule.where("sourceWorkspaceId", "==", workspace.id)
        ))
    ]);
    const unique = new Map();

    snaps.forEach(snap => {
        snap.docs.forEach(docSnap => {
            unique.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
        });
    });

    return [...unique.values()];
}

export async function requestWorkerTransfer({
    targetWorkspaceId,
    targetWorkspaceName,
    linkId,
    startDate,
    profile,
    requestedByName
}) {
    const workspace = activeWorkspaceOrThrow();

    return callFunction("createWorkerTransferRequest", {
        workspaceId: workspace.id,
        workspaceName: workspace.name || "",
        targetWorkspaceId,
        targetWorkspaceName,
        linkId,
        startDate,
        profile,
        requestedByName
    });
}

export async function respondWorkerTransfer({
    requestId,
    status,
    targetProfileName = "",
    rejectReason = "",
    resolvedByName = ""
}) {
    const workspace = activeWorkspaceOrThrow();

    return callFunction("respondWorkerTransferRequest", {
        workspaceId: workspace.id,
        requestId,
        status,
        targetProfileName,
        rejectReason,
        resolvedByName
    });
}

export async function cancelWorkerTransfer(requestId) {
    const workspace = activeWorkspaceOrThrow();

    return callFunction("cancelWorkerTransferRequest", {
        workspaceId: workspace.id,
        requestId
    });
}

/**
 * Pide aplicar en origen una transferencia aceptada. Devuelve true solo a la
 * primera sesion que lo pide: las demas no deben tocar nada.
 */
export async function claimWorkerTransferApplication(requestId) {
    const workspace = activeWorkspaceOrThrow();
    const result = await callFunction("claimWorkerTransferApplication", {
        workspaceId: workspace.id,
        requestId
    });

    return result?.claimed === true;
}

let stopAcceptedListener = null;
// Si se cambia de unidad mientras se piden los servicios, el oyente que llega
// tarde ya no es de la unidad activa y no se registra.
let watchGeneration = 0;

/**
 * Escucha las transferencias que ESTA unidad envio y ya fueron aceptadas, pero
 * que aun no se aplican aqui. `onPending` recibe la lista cada vez que cambia.
 */
export async function watchAcceptedOutgoingTransfers(workspace, onPending) {
    stopWatchingAcceptedOutgoingTransfers();

    if (!workspace?.id || typeof onPending !== "function") return;

    const generation = watchGeneration;
    const { db, firestoreModule } = await getFirebaseServices();

    if (generation !== watchGeneration) return;

    const query = firestoreModule.query(
        firestoreModule.collection(db, COLLECTION),
        firestoreModule.where("sourceWorkspaceId", "==", workspace.id),
        firestoreModule.where("status", "==", "accepted")
    );

    stopAcceptedListener = firestoreModule.onSnapshot(
        query,
        snap => {
            const pendientes = snap.docs
                .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
                .filter(item => !item.sourceAppliedAt);

            onPending(pendientes);
        },
        error => {
            console.warn("No se pudieron leer las transferencias aceptadas.", error);
        }
    );
}

export function stopWatchingAcceptedOutgoingTransfers() {
    watchGeneration++;
    stopAcceptedListener?.();
    stopAcceptedListener = null;
}
