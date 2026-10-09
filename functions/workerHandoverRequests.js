"use strict";

// Pedir a otra unidad del establecimiento el traspaso de un trabajador.
//
// Es la direccion contraria a workerTransferRequests.js. Alla la unidad de
// ORIGEN decide transferir a alguien suyo. Aqui la unidad que esta CREANDO el
// perfil descubre, al escribir el RUT, que esa persona ya esta registrada en
// otra unidad del mismo establecimiento (functions/workerEstablishmentLookup.js)
// y pide que le traspasen su informacion en vez de ingresarla de cero.
//
// LO QUE ESTE ARCHIVO NO HACE, Y ES SU RAZON DE SER: no mueve nada. Un pedido
// de traspaso es solo el pedido. Cuando el origen lo acepta, crea una
// transferencia normal -un documento de workerTransferRequests- con el codigo
// que ya existe, y de ahi en adelante todo es identico: que datos viajan, los
// saldos de vacaciones, el vaciado del calendario en origen, la inactivacion
// del perfil, el cambio de unidad en la app del trabajador. Asi hay una sola
// implementacion de que se lleva, y cambiarla cambia los dos caminos. Si
// alguna vez se siente la tentacion de copiar aqui un pedazo de esa logica,
// esa es la senal de que el diseno se esta rompiendo.
//
// El pedido viaja con el RUT y NO con el nombre. No es un descuido: la
// busqueda que lo origina devuelve a proposito solo en que unidad esta la
// persona, nunca sus datos, para no volverse una via para pescar informacion de
// trabajadores de otras unidades. Quien recibe el pedido resuelve el RUT contra
// sus propios perfiles, que son suyos y ya conoce.
//
// Quien puede pedirlo: quien administra perfiles en la unidad que pide, y solo
// hacia unidades del MISMO establecimiento. El establecimiento alcanza porque
// hay doble control -quien pide podria igual crear el perfil de cero, y quien
// recibe el pedido puede rechazarlo-. Buscar cobertura sigue exigiendo que las
// unidades esten enlazadas; esto es solo para traspasar gente.

const COLLECTION = "workerHandoverRequests";

const PENDING = "pending";
const ACCEPTED = "accepted";
const REJECTED = "rejected";
const CANCELED = "canceled";

// Un pedido sin responder caduca. Son 30 dias y no 7 como en el enrolamiento
// por RUT: ahi espera una persona que quiere entrar a la app hoy, y aqui es un
// tramite entre supervisores que puede caer en una semana de vacaciones. Pero
// caduca igual, porque un pedido de hace meses no deberia poder aprobarse por
// inercia: a esa altura la persona puede haberse ido, o ya estar ingresada.
const REQUEST_TTL_DAYS = 30;

// Tope de destinatarios del aviso, como en las solicitudes de acceso: una
// unidad con muchos supervisores no deberia convertir un pedido en una rafaga.
const MAX_NOTIFIED = 20;

function defaultIdFactory() {
  return `whr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeRut(value) {
  return String(value || "").replace(/[^0-9kK]/g, "").toUpperCase();
}

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function validISODate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function millisFrom(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();

  const parsed = Date.parse(String(value));

  return Number.isFinite(parsed) ? parsed : 0;
}

function requestIsUsable(data, ahora) {
  if (!data) return false;
  if (String(data.status || "") !== PENDING) return false;

  const expira = millisFrom(data.expiresAt);

  return !expira || expira > ahora;
}

function requireAuth(request, HttpsError) {
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError("unauthenticated", "Inicia sesion.");
  }

  return uid;
}

/**
 * La unidad que esta creando el perfil pide el traspaso.
 */
async function requestWorkerHandoverHandler(request, {
  db,
  HttpsError,
  requireProfileManager,
  requireSameEstablishment,
  idFactory = defaultIdFactory
}) {
  const uid = requireAuth(request, HttpsError);
  const data = request.data || {};
  const workspaceId = cleanText(data.workspaceId, 160);
  const sourceWorkspaceId = cleanText(data.sourceWorkspaceId, 160);
  const rut = normalizeRut(data.rut);
  const suggestedStartDate = cleanText(data.suggestedStartDate, 10);

  if (
    !workspaceId ||
    !sourceWorkspaceId ||
    sourceWorkspaceId === workspaceId ||
    rut.length < 7
  ) {
    throw new HttpsError("invalid-argument", "Faltan datos del pedido.");
  }

  if (suggestedStartDate && !validISODate(suggestedStartDate)) {
    throw new HttpsError("invalid-argument", "La fecha sugerida no es valida.");
  }

  // Primero el permiso en la unidad que pide, y despues que compartan
  // establecimiento. Sin lo primero, cualquier miembro podria sondear RUTs.
  await requireProfileManager(workspaceId, uid, request.auth?.token || {});

  const establishment = await requireSameEstablishment(
    workspaceId,
    sourceWorkspaceId
  );

  const ahora = Date.now();
  const previas = await db
    .collection(COLLECTION)
    .where("requestingWorkspaceId", "==", workspaceId)
    .get();
  const yaPedido = previas.docs.find(doc => {
    const previa = doc.data() || {};

    return previa.sourceWorkspaceId === sourceWorkspaceId &&
      normalizeRut(previa.rut) === rut &&
      requestIsUsable(previa, ahora);
  });

  // Un pedido a la vez por persona y unidad: dos iguales solo serian dos
  // avisos y dos tarjetas para decidir lo mismo.
  if (yaPedido) {
    return { status: PENDING, requestId: yaPedido.id, created: false };
  }

  const requestId = idFactory();

  await db.collection(COLLECTION).doc(requestId).set({
    requestingWorkspaceId: workspaceId,
    requestingWorkspaceName: cleanText(data.workspaceName, 160),
    sourceWorkspaceId,
    sourceWorkspaceName: cleanText(data.sourceWorkspaceName, 160),
    establishment,
    rut,
    suggestedStartDate,
    requestedByUid: uid,
    requestedByName: cleanText(data.requestedByName, 160),
    status: PENDING,
    createdAt: new Date(ahora),
    updatedAt: new Date(ahora),
    expiresAt: new Date(ahora + REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000)
  });

  return { status: PENDING, requestId, created: true };
}

/**
 * La unidad que pidio se arrepiente.
 */
async function cancelWorkerHandoverRequestHandler(request, {
  db,
  HttpsError,
  requireProfileManager
}) {
  const uid = requireAuth(request, HttpsError);
  const workspaceId = cleanText(request.data?.workspaceId, 160);
  const requestId = cleanText(request.data?.requestId, 220);

  if (!workspaceId || !requestId) {
    throw new HttpsError("invalid-argument", "Falta identificar el pedido.");
  }

  await requireProfileManager(workspaceId, uid, request.auth?.token || {});

  const ref = db.collection(COLLECTION).doc(requestId);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Ese pedido ya no existe.");
  }

  const solicitud = snap.data() || {};

  if (solicitud.requestingWorkspaceId !== workspaceId) {
    throw new HttpsError(
      "permission-denied",
      "Solo la unidad que pidio puede retirar el pedido."
    );
  }

  if (String(solicitud.status || "") !== PENDING) {
    throw new HttpsError("failed-precondition", "Ese pedido ya fue resuelto.");
  }

  await ref.set({
    status: CANCELED,
    resolvedAt: new Date(),
    resolvedByUid: uid,
    updatedAt: new Date()
  }, { merge: true });

  return { status: CANCELED };
}

/**
 * La unidad de origen acepta o rechaza.
 *
 * Aceptar NO mueve nada aqui: el origen ya creo la transferencia con el camino
 * de siempre y este paso solo la deja anotada, para que el pedido quede cerrado
 * y se pueda seguir desde donde nacio. Por eso al aceptar exige el id de esa
 * transferencia: sin el, un pedido quedaria "aceptado" sin que nada viaje, y la
 * unidad que pidio esperaria para siempre.
 */
async function resolveWorkerHandoverRequestHandler(request, {
  db,
  HttpsError,
  requireProfileManager
}) {
  const uid = requireAuth(request, HttpsError);
  const data = request.data || {};
  const workspaceId = cleanText(data.workspaceId, 160);
  const requestId = cleanText(data.requestId, 220);
  const approve = data.approve === true;
  const transferRequestId = cleanText(data.transferRequestId, 220);

  if (!workspaceId || !requestId) {
    throw new HttpsError("invalid-argument", "Falta identificar el pedido.");
  }

  if (approve && !transferRequestId) {
    throw new HttpsError(
      "invalid-argument",
      "Falta la transferencia que responde al pedido."
    );
  }

  await requireProfileManager(workspaceId, uid, request.auth?.token || {});

  const ref = db.collection(COLLECTION).doc(requestId);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Ese pedido ya no existe.");
  }

  const solicitud = snap.data() || {};

  if (solicitud.sourceWorkspaceId !== workspaceId) {
    throw new HttpsError(
      "permission-denied",
      "Solo la unidad que tiene al trabajador puede responder."
    );
  }

  if (!requestIsUsable(solicitud, Date.now())) {
    throw new HttpsError(
      "failed-precondition",
      "Ese pedido ya fue resuelto o caduco."
    );
  }

  const status = approve ? ACCEPTED : REJECTED;
  const ahora = new Date();

  await ref.set({
    status,
    transferRequestId: approve ? transferRequestId : "",
    resolvedAt: ahora,
    resolvedByUid: uid,
    updatedAt: ahora
  }, { merge: true });

  return { status, requestId };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Avisarle por correo a la unidad que tiene al trabajador.
//
// Por correo y no por push porque los supervisores no tienen push: esa pila
// existe solo para los trabajadores. E importa que se enteren sin abrir la
// aplicacion, porque al otro lado hay alguien esperando para terminar de
// ingresar a una persona.
async function notifyWorkerHandoverRequestHandler(event, {
  db,
  canManageProfiles,
  getUserEmail,
  sendEmail,
  logger
}) {
  const data = event?.data?.data() || {};
  const sourceWorkspaceId = String(data.sourceWorkspaceId || "");

  if (!sourceWorkspaceId) return;
  if (String(data.status || "") !== PENDING) return;

  const membersSnap = await db
    .collection("workspaces")
    .doc(sourceWorkspaceId)
    .collection("members")
    .get();
  const destinatarios = [];

  for (const memberDoc of membersSnap.docs) {
    if (destinatarios.length >= MAX_NOTIFIED) break;
    // El mismo permiso que decide quien puede responderlo.
    if (!canManageProfiles(memberDoc.data() || {})) continue;

    const email = await getUserEmail(memberDoc.id);

    if (email) destinatarios.push(email);
  }

  if (!destinatarios.length) return;

  const unidad = cleanText(data.requestingWorkspaceName, 160) || "Otra unidad";
  const rut = cleanText(data.rut, 20);
  // El pedido no trae el nombre, solo el RUT. Quien lo recibe lo reconoce
  // entre sus propios perfiles, que es justo lo que la aplicacion le muestra.
  const detalle = `${unidad} pide el traspaso del trabajador con RUT ${rut}.`;
  const asunto = `${unidad} pide el traspaso de un trabajador`;
  const text = [
    detalle,
    "",
    "Revisalo en TurnoPlus, en el menu Solicitudes.",
    `Caduca en ${REQUEST_TTL_DAYS} dias.`
  ].join("\n");
  const html = [
    `<p>${escapeHtml(detalle)}</p>`,
    "<p>Revisalo en TurnoPlus, en el menu <strong>Solicitudes</strong>.</p>",
    `<p>Caduca en ${REQUEST_TTL_DAYS} dias.</p>`
  ].join("");

  for (const to of destinatarios) {
    try {
      await sendEmail({ to, subject: asunto, html, text });
    } catch (error) {
      logger?.warn?.("No se pudo avisar de un pedido de traspaso.", {
        sourceWorkspaceId,
        error: String(error?.message || error)
      });
    }
  }
}

module.exports = {
  ACCEPTED,
  CANCELED,
  COLLECTION,
  PENDING,
  REJECTED,
  cancelWorkerHandoverRequestHandler,
  notifyWorkerHandoverRequestHandler,
  requestWorkerHandoverHandler,
  resolveWorkerHandoverRequestHandler,
  _private: {
    MAX_NOTIFIED,
    REQUEST_TTL_DAYS,
    millisFrom,
    normalizeRut,
    requestIsUsable
  }
};
