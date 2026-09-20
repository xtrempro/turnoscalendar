// Ausencias de otras unidades para respaldar un contrato de reemplazo.
//
// Envoltorios delgados de las funciones del servidor, en la misma linea que
// js/firebaseInterUnitLoans.js: aqui no hay logica, solo la llamada. Todo lo
// que cruza unidades pasa por el servidor porque es el unico que puede
// comprobar que el enlace entre ambas esta aceptado.

import { getFirebaseServices } from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";

async function callFunction(name, payload) {
    const { functions, functionsModule } = await getFirebaseServices();
    const callable = functionsModule.httpsCallable(functions, name);
    const result = await callable(payload);

    return result.data;
}

/**
 * Las ausencias disponibles en las unidades enlazadas.
 *
 * Devuelve los DIAS CRUDOS por trabajador y tipo. Agruparlos en rangos es tarea
 * de quien llama, con js/replacementLeaveGrouping.js: es el mismo modulo que
 * agrupa las ausencias propias, asi que los identificadores salen identicos y
 * no hay dos criterios que puedan separarse.
 *
 * @param {string} fromISO corte: nada anterior a esa fecha.
 * @param {string} sourceWorkspaceId opcional, para acotar a una sola unidad.
 */
export async function fetchLinkedUnitAbsences(fromISO, sourceWorkspaceId = "") {
    const workspace = getActiveWorkspace();

    if (!workspace?.id) {
        return { units: [], failedUnits: [], message: "" };
    }

    return callFunction("findLinkedUnitAbsences", {
        requesterWorkspaceId: workspace.id,
        fromISO,
        sourceWorkspaceId
    });
}

/**
 * Las solicitudes de ausencia que tocan a la unidad activa.
 *
 * Devuelve TODAS -las que hay que autorizar y las que se enviaron- en una sola
 * lista, y que la pantalla filtre. Es como ya funciona el panel de unidades
 * enlazadas con sus enlaces: una fuente, varias vistas.
 *
 * Se lee directo de Firestore, sin callable: las reglas ya permiten leer a
 * quien gestiona solicitudes en cualquiera de las dos unidades.
 */
export async function listInterUnitAbsenceRequests() {
    const workspace = getActiveWorkspace();

    if (!workspace?.id) return [];

    const { db, firestoreModule } = await getFirebaseServices();
    const requestsRef =
        firestoreModule.collection(db, "interUnitAbsenceRequests");
    const snaps = await Promise.all([
        // Las que me toca responder.
        firestoreModule.getDocs(firestoreModule.query(
            requestsRef,
            firestoreModule.where("ownerWorkspaceId", "==", workspace.id)
        )),
        // Las que pedi yo, para ver en que quedaron.
        firestoreModule.getDocs(firestoreModule.query(
            requestsRef,
            firestoreModule.where("requesterWorkspaceId", "==", workspace.id)
        ))
    ]);
    // Por id: una unidad podria ser las dos cosas a la vez si alguna vez se
    // permitiera pedirse a si misma, y un duplicado en la lista se veria como
    // dos solicitudes distintas.
    const unique = new Map();

    snaps.forEach(snap => {
        snap.docs.forEach(docSnap => {
            unique.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
        });
    });

    return [...unique.values()];
}

/**
 * Pide permiso para usar una ausencia de otra unidad.
 *
 * NO crea el contrato: deja una solicitud pendiente. El contrato lo crea esta
 * misma unidad recien cuando la otra autoriza.
 */
export async function requestInterUnitAbsence({
    ownerWorkspaceId,
    ownerWorkspaceName,
    linkId,
    replacementProfileName,
    absenceProfileName,
    leaveRef,
    leaveType,
    leaveLabel,
    leaveStart,
    leaveEnd,
    rotationMode,
    requestedByName
}) {
    const workspace = getActiveWorkspace();

    if (!workspace?.id) {
        throw new Error("Selecciona una unidad antes de pedir una ausencia.");
    }

    return callFunction("createInterUnitAbsenceRequest", {
        workspaceId: workspace.id,
        requesterWorkspaceName: workspace.name || "",
        ownerWorkspaceId,
        ownerWorkspaceName,
        linkId,
        replacementProfileName,
        absenceProfileName,
        leaveRef,
        leaveType,
        leaveLabel,
        leaveStart,
        leaveEnd,
        rotationMode,
        requestedByName
    });
}

/**
 * Autoriza o rechaza una solicitud recibida.
 *
 * Solo la unidad DUEÑA de la ausencia: el servidor lo comprueba, aqui se manda
 * la unidad activa y alla se contrasta con la solicitud.
 */
export async function respondInterUnitAbsence({
    requestId,
    status,
    rejectReason = "",
    resolvedByName = ""
}) {
    const workspace = getActiveWorkspace();

    if (!workspace?.id) {
        throw new Error("Selecciona una unidad antes de responder.");
    }

    return callFunction("respondInterUnitAbsenceRequest", {
        workspaceId: workspace.id,
        requestId,
        status,
        rejectReason,
        resolvedByName
    });
}
