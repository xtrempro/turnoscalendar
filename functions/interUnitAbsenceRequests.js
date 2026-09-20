"use strict";

// Pedir permiso para usar la ausencia de OTRA unidad como respaldo del contrato
// de un trabajador a reemplazo.
//
// El supervisor que necesita el contrato elige una ausencia de una unidad
// enlazada y la rotativa que aplicara, pero NO se crea nada todavia: queda una
// solicitud pendiente. Recien cuando el supervisor de la otra unidad autoriza,
// la unidad solicitante puede crear el contrato.
//
// Por que el contrato NO lo crea el servidor al aprobar: los contratos viven en
// los modulos de estado del navegador, con su formato propio y sus tres caras
// por entrada. Escribirlos desde aqui obligaria al servidor a aprender ese
// formato y a mantenerlo sincronizado para siempre. La aprobacion es solo el
// permiso; aplicarla es del cliente, que ya sabe crear contratos.
//
// Una ausencia autorizada queda OCUPADA para todos, tambien para su propia
// unidad: lo decidio el usuario, y es coherente con que localmente una ausencia
// ya usada deje de ofrecerse. Quien pregunta si esta ocupada compara por
// `leaveRef`, el id que calcula el cliente al agrupar los dias en un rango.

const COLLECTION = "interUnitAbsenceRequests";
const PENDING = "pending";
const APPROVED = "approved";
const REJECTED = "rejected";
const RESPONSES = [APPROVED, REJECTED];

function cleanText(value, max = 160) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function validISODate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cleanText(value, 10));
}

function callableError(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function defaultIdFactory() {
  return `iuar_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Lo comun a las dos llamadas: sesion y unidad desde la que se actua. */
function validateBasePayload(request, HttpsError) {
  const uid = request.auth?.uid;
  const workspaceId = cleanText(request.data?.workspaceId, 160);

  if (!uid) {
    callableError(
      HttpsError,
      "unauthenticated",
      "Debes iniciar sesion para gestionar ausencias entre unidades."
    );
  }

  if (!workspaceId) {
    callableError(
      HttpsError,
      "invalid-argument",
      "No fue posible identificar la unidad."
    );
  }

  return { uid, workspaceId };
}

/**
 * Crea la solicitud, siempre PENDIENTE.
 *
 * Quien la crea es la unidad que necesita el contrato; la que autoriza es la
 * dueña de la ausencia. El enlace entre ambas se comprueba aqui -en el
 * cliente no se puede- y por eso las reglas no permiten crear desde el
 * navegador.
 */
async function createInterUnitAbsenceRequestHandler(request, dependencies) {
  const {
    db,
    HttpsError,
    serverTimestamp,
    requireWorkspaceRequestManager,
    requireAcceptedWorkspaceLink,
    idFactory = defaultIdFactory
  } = dependencies;
  const { uid, workspaceId } = validateBasePayload(request, HttpsError);
  const data = request.data || {};
  const ownerWorkspaceId = cleanText(data.ownerWorkspaceId, 160);
  const linkId = cleanText(data.linkId, 220);
  const replacementProfileName = cleanText(data.replacementProfileName);
  const absenceProfileName = cleanText(data.absenceProfileName);
  const leaveRef = cleanText(data.leaveRef, 400);
  const leaveType = cleanText(data.leaveType, 60);
  const leaveLabel = cleanText(data.leaveLabel, 120);
  const leaveStart = cleanText(data.leaveStart, 10);
  const leaveEnd = cleanText(data.leaveEnd, 10);
  const rotationMode = cleanText(data.rotationMode, 40);

  if (
    !ownerWorkspaceId ||
    ownerWorkspaceId === workspaceId ||
    !linkId ||
    !replacementProfileName ||
    !absenceProfileName ||
    !leaveRef ||
    !leaveType ||
    !validISODate(leaveStart) ||
    !validISODate(leaveEnd) ||
    leaveEnd < leaveStart
  ) {
    callableError(
      HttpsError,
      "invalid-argument",
      "Los datos de la solicitud de ausencia no son validos."
    );
  }

  await Promise.all([
    // Quien pide tiene que poder gestionar solicitudes en SU unidad.
    requireWorkspaceRequestManager(workspaceId, uid, request.auth.token),
    requireAcceptedWorkspaceLink(linkId, ownerWorkspaceId, workspaceId)
  ]);

  // Una ausencia ya autorizada no se vuelve a pedir: quedo ocupada, tambien
  // para su propia unidad. Sin esto, dos unidades podrian respaldar dos
  // contratos distintos con la ausencia de una sola persona.
  const previas = await db
    .collection(COLLECTION)
    .where("leaveRef", "==", leaveRef)
    .get();
  const tomada = previas.docs.some(docSnap => {
    const previa = docSnap.data() || {};

    return previa.ownerWorkspaceId === ownerWorkspaceId &&
      [PENDING, APPROVED].includes(previa.status);
  });

  if (tomada) {
    callableError(
      HttpsError,
      "failed-precondition",
      "Esa ausencia ya tiene una solicitud pendiente o autorizada."
    );
  }

  const requestId = idFactory();
  const now = serverTimestamp();

  await db.collection(COLLECTION).doc(requestId).set({
    requesterWorkspaceId: workspaceId,
    requesterWorkspaceName: cleanText(data.requesterWorkspaceName, 160),
    ownerWorkspaceId,
    ownerWorkspaceName: cleanText(data.ownerWorkspaceName, 160),
    linkId,
    requestedByUid: uid,
    requestedByName: cleanText(data.requestedByName, 160),
    replacementProfileName,
    absenceProfileName,
    leaveRef,
    leaveType,
    leaveLabel,
    leaveStart,
    leaveEnd,
    rotationMode,
    status: PENDING,
    createdAt: now,
    updatedAt: now
  });

  return { ok: true, requestId, status: PENDING };
}

/**
 * Autoriza o rechaza. Solo la unidad DUEÑA de la ausencia.
 *
 * Aprobar no crea el contrato: deja la solicitud en `approved` y la unidad
 * solicitante lo crea cuando la lee. Ver la nota de arriba.
 */
async function respondInterUnitAbsenceRequestHandler(request, dependencies) {
  const {
    db,
    HttpsError,
    serverTimestamp,
    requireWorkspaceRequestManager
  } = dependencies;
  const { uid, workspaceId } = validateBasePayload(request, HttpsError);
  const requestId = cleanText(request.data?.requestId, 220);
  const status = cleanText(request.data?.status, 60);
  const rejectReason = cleanText(request.data?.rejectReason, 300);

  if (!requestId) {
    callableError(
      HttpsError,
      "invalid-argument",
      "No fue posible identificar la solicitud."
    );
  }

  if (!RESPONSES.includes(status)) {
    callableError(
      HttpsError,
      "invalid-argument",
      "La respuesta a la solicitud no es valida."
    );
  }

  const requestRef = db.collection(COLLECTION).doc(requestId);
  const snap = await requestRef.get();

  if (!snap.exists) {
    callableError(
      HttpsError,
      "not-found",
      "La solicitud ya no existe."
    );
  }

  const solicitud = snap.data() || {};

  // La unidad desde la que se responde tiene que ser la dueña de la ausencia.
  // Sin esta comprobacion, la propia unidad solicitante podria aprobarse sola.
  if (solicitud.ownerWorkspaceId !== workspaceId) {
    callableError(
      HttpsError,
      "permission-denied",
      "Solo la unidad dueña de la ausencia puede responder esta solicitud."
    );
  }

  if (solicitud.status !== PENDING) {
    callableError(
      HttpsError,
      "failed-precondition",
      "Esta solicitud ya fue respondida."
    );
  }

  await requireWorkspaceRequestManager(
    workspaceId,
    uid,
    request.auth.token
  );

  const now = serverTimestamp();

  await requestRef.update({
    status,
    resolvedAt: now,
    resolvedByUid: uid,
    resolvedByName: cleanText(request.data?.resolvedByName, 160),
    rejectReason: status === REJECTED ? rejectReason : "",
    updatedAt: now
  });

  return { ok: true, requestId, status };
}

module.exports = {
  APPROVED,
  COLLECTION,
  PENDING,
  REJECTED,
  createInterUnitAbsenceRequestHandler,
  respondInterUnitAbsenceRequestHandler,
  validateBasePayload
};
