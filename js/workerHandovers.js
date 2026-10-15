// Un RUT que ya esta en otra unidad del establecimiento, y el pedido de
// traspaso que sale de ahi.
//
// Envoltorios delgados de las funciones del servidor
// (functions/workerEstablishmentLookup.js y
// functions/workerHandoverRequests.js), como js/workerTransfers.js.
//
// Las dos cosas viven juntas porque son el mismo momento: al escribir el RUT de
// alguien que se esta ingresando, saber que ya trabaja en otra unidad del mismo
// hospital y poder pedir que traspasen su informacion en vez de ingresarla de
// cero.
//
// Lo que NO esta aqui: mover los datos. Un pedido aceptado se convierte en una
// transferencia normal, con el codigo que ya existe (js/workerTransfers.js), y
// de ahi en adelante los dos caminos son el mismo.

import { getFirebaseServices } from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";

const COLLECTION = "workerHandoverRequests";

async function callFunction(name, payload) {
    const { functions, functionsModule } = await getFirebaseServices();
    const callable = functionsModule.httpsCallable(functions, name);
    const result = await callable(payload);

    return result.data;
}

function activeWorkspaceOrThrow() {
    const workspace = getActiveWorkspace();

    if (!workspace?.id) {
        throw new Error("Selecciona una unidad antes de continuar.");
    }

    return workspace;
}

/**
 * Busca ese RUT en las demas unidades del establecimiento.
 *
 * Devuelve solo en que unidad esta y si el perfil sigue activo: ni el nombre ni
 * el correo ni el telefono. No es una limitacion que convenga "arreglar" desde
 * aqui -el servidor tampoco los manda-, porque esto lo puede consultar un
 * supervisor de otra unidad y alcanza de sobra para ofrecer el traspaso.
 */
export async function findWorkerInEstablishment(rut) {
    const workspace = getActiveWorkspace();

    if (!workspace?.id || !rut) return { establishment: "", unidades: [] };

    const data = await callFunction("findWorkerInEstablishment", {
        workspaceId: workspace.id,
        rut
    });

    return {
        establishment: String(data?.establishment || ""),
        unidades: Array.isArray(data?.unidades) ? data.unidades : []
    };
}

/**
 * Los pedidos de traspaso que tocan a la unidad activa: los que pidio y los que
 * le pidieron. Una fuente y que la pantalla filtre, como las transferencias.
 */
export async function listWorkerHandoverRequests() {
    const workspace = getActiveWorkspace();

    if (!workspace?.id) return [];

    const { db, firestoreModule } = await getFirebaseServices();
    const ref = firestoreModule.collection(db, COLLECTION);
    const snaps = await Promise.all([
        firestoreModule.getDocs(firestoreModule.query(
            ref,
            firestoreModule.where("sourceWorkspaceId", "==", workspace.id)
        )),
        firestoreModule.getDocs(firestoreModule.query(
            ref,
            firestoreModule.where("requestingWorkspaceId", "==", workspace.id)
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

/**
 * La unidad que esta creando el perfil pide el traspaso.
 */
export async function requestWorkerHandover({
    sourceWorkspaceId,
    sourceWorkspaceName,
    rut,
    startDate,
    rotationType,
    rotationFirstTurn = "",
    requestedByName = ""
}) {
    const workspace = activeWorkspaceOrThrow();

    return callFunction("requestWorkerHandover", {
        workspaceId: workspace.id,
        workspaceName: workspace.name || "",
        sourceWorkspaceId,
        sourceWorkspaceName,
        rut,
        // La fecha y la rotativa las decide esta unidad, que es la que recibe
        // a la persona. Viajan en el pedido para que aceptarlo alcance: con
        // todo decidido, aqui no queda nada que responder despues.
        startDate,
        rotationType,
        rotationFirstTurn,
        requestedByName
    });
}

export async function cancelWorkerHandoverRequest(requestId) {
    const workspace = activeWorkspaceOrThrow();

    return callFunction("cancelWorkerHandoverRequest", {
        workspaceId: workspace.id,
        requestId
    });
}

/**
 * La unidad que tiene al trabajador responde.
 *
 * ACEPTAR ES LA TRANSFERENCIA: el servidor la crea ya aceptada y hace lo que
 * eso implica aqui -vaciar el calendario desde la fecha, inactivar el perfil,
 * mudar la app-. La otra unidad no tiene que responder nada, porque la fecha y
 * la rotativa ya venian en su pedido.
 *
 * El perfil lo arma quien acepta, que es el unico que lo tiene: sus datos y sus
 * saldos de vacaciones salen de su propio estado.
 */
export async function resolveWorkerHandoverRequest({
    requestId,
    approve,
    profile = null,
    rejectReason = "",
    resolvedByName = "",
    // Desde cuando se acepta, cuando no es la fecha pedida. La decide esta
    // unidad, que es la que entrega, y el servidor solo deja correrla hacia
    // adelante (ver workerHandoverRequests.js).
    startDate = ""
}) {
    const workspace = activeWorkspaceOrThrow();

    return callFunction("resolveWorkerHandoverRequest", {
        workspaceId: workspace.id,
        workspaceName: workspace.name || "",
        requestId,
        approve,
        profile,
        rejectReason,
        resolvedByName,
        startDate
    });
}

let stopRequestsListener = null;
let requestsGeneration = 0;

/**
 * Los pedidos de traspaso que ESTA unidad tiene que responder, en vivo.
 *
 * El panel de Solicitudes los lee al abrirse, y eso alcanza para verlos pero no
 * para enterarse: un pedido llega desde otra unidad y aqui no pasa nada hasta
 * que alguien entra a mirar. Con esto la campanita lo canta cuando llega.
 */
export async function watchIncomingHandoverRequests(workspace, onPending) {
    stopWatchingIncomingHandoverRequests();

    if (!workspace?.id || typeof onPending !== "function") return;

    const generation = requestsGeneration;
    const { db, firestoreModule } = await getFirebaseServices();

    if (generation !== requestsGeneration) return;

    stopRequestsListener = firestoreModule.onSnapshot(
        firestoreModule.query(
            firestoreModule.collection(db, COLLECTION),
            firestoreModule.where("sourceWorkspaceId", "==", workspace.id),
            firestoreModule.where("status", "==", "pending")
        ),
        snap => {
            onPending(
                snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
            );
        },
        error => {
            console.warn("No se pudieron leer los pedidos de traspaso.", error);
        }
    );
}

export function stopWatchingIncomingHandoverRequests() {
    requestsGeneration++;
    stopRequestsListener?.();
    stopRequestsListener = null;
}
