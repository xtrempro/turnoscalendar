"use strict";

// Enrolarse por RUT, con aprobacion del supervisor.
//
// El camino por correo funciona cuando la persona tiene el enlace a mano. No
// sirve cuando el correo quedo mal escrito, cuando el perfil no tiene correo, o
// cuando cambio de telefono y el correo viejo ya no esta. Hasta ahora la unica
// salida era que el supervisor borrara el vinculo y volviera a invitar, que
// crea un uid nuevo y se lleva los chats por delante.
//
// Aqui el trabajador escribe su RUT, ve a que unidades lo invitaron y pide
// acceso. El supervisor aprueba.
//
// EL RUT NO ES UNA CREDENCIAL, y es lo que no se puede perder de vista al tocar
// este archivo. En Chile no es secreto: esta en documentos, lo saben los
// colegas, y el digito verificador lo hace trivial de validar. En una unidad de
// hospital todos conocen el RUT de todos, y quienes lo conocen son justamente
// quienes podrian tener motivo. Por eso el RUT solo sirve para BUSCAR; quien
// autoriza es el supervisor. El enlace lo hace el servidor, y el cliente nunca
// afirma un RUT como verdad: el mismo principio que trustedRutForWorker.

// Una solicitud sin responder caduca. Sin esto, una pendiente de hace meses
// seguiria sirviendo para entrar el dia que alguien la apruebe por inercia.
const REQUEST_TTL_DAYS = 7;

// Tope defensivo, como en la recuperacion de identidad: la busqueda recorre
// unidades y conviene que un error de datos no se vuelva un barrido sin fin.
const MAX_WORKSPACES = 500;

// Lo que se le muestra al supervisor para decidir. Mas que esto es ruido, y
// menos lo deja aprobando a ciegas.
const MAX_DEVICE_LABEL = 120;

function normalizeRut(value) {
  return String(value || "").replace(/[^0-9kK]/g, "").toUpperCase();
}

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function millisFrom(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();

  const parsed = Date.parse(String(value));

  return Number.isFinite(parsed) ? parsed : 0;
}

function requestIsUsable(data, ahora) {
  if (!data) return false;
  if (String(data.status || "") !== "pending") return false;

  const expira = millisFrom(data.expiresAt);

  return !expira || expira > ahora;
}

// Recorre las unidades buscando invitaciones pendientes para ese RUT.
//
// Se recorre en vez de usar una consulta de grupo porque eso exigiria un indice
// compuesto de collectionGroup que el proyecto no tiene, y es el mismo camino
// que ya usa la recuperacion de identidad.
async function findInvitesByRut(db, rut) {
  const workspacesSnap = await db.collection("workspaces")
    .limit(MAX_WORKSPACES)
    .get();
  const encontradas = [];

  for (const workspaceDoc of workspacesSnap.docs) {
    const invitesSnap = await workspaceDoc.ref
      .collection("workerAppInvites")
      .where("profileRut", "==", rut)
      .get();

    for (const inviteDoc of invitesSnap.docs) {
      const invite = inviteDoc.data() || {};

      if (String(invite.status || "") !== "pending") continue;

      const workspace = workspaceDoc.data() || {};

      encontradas.push({
        workspaceId: workspaceDoc.id,
        workspaceName: cleanText(workspace.name || workspace.workspaceName, 160),
        inviteId: inviteDoc.id,
        profileName: cleanText(invite.profileName, 160)
      });
    }
  }

  return encontradas;
}

// 1) Buscar. Devuelve SOLO el nombre de la unidad.
//
// Hace falta el nombre porque a una misma persona pueden haberla invitado desde
// mas de una unidad y tiene que poder elegir. El costo es confirmar que ese RUT
// fue invitado ahi, que un colega ya sabe. No lleva nombres ni correos, y el id
// de la invitacion tampoco sale: ese es el secreto del camino por correo y no
// se le regala a quien solo escribio un RUT.
async function findWorkerInvitesByRutHandler(request, { db, HttpsError }) {
  const rut = normalizeRut(request.data?.rut);

  if (rut.length < 7) {
    throw new HttpsError("invalid-argument", "Escribe tu RUT completo.");
  }

  const encontradas = await findInvitesByRut(db, rut);

  return {
    unidades: encontradas.map((item) => ({
      workspaceId: item.workspaceId,
      workspaceName: item.workspaceName
    }))
  };
}

// 2) Pedir acceso. Deja la solicitud para que el supervisor la resuelva.
async function requestWorkerJoinHandler(request, { db, HttpsError }) {
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError("unauthenticated", "Falta la sesion para pedir acceso.");
  }

  const rut = normalizeRut(request.data?.rut);
  const workspaceId = cleanText(request.data?.workspaceId, 160);
  const deviceLabel = cleanText(request.data?.deviceLabel, MAX_DEVICE_LABEL);

  if (!rut || !workspaceId) {
    throw new HttpsError("invalid-argument", "Falta identificar la unidad.");
  }

  // La invitacion se vuelve a buscar en el servidor. Si se confiara en lo que
  // manda el cliente, cualquiera podria pedir acceso a una unidad que nunca lo
  // invito, y al supervisor le llegaria una solicitud con pinta de legitima.
  const encontradas = await findInvitesByRut(db, rut);
  const invitacion = encontradas.find((item) => item.workspaceId === workspaceId);

  if (!invitacion) {
    throw new HttpsError(
      "permission-denied",
      "No encontramos una invitacion pendiente para ese RUT en esa unidad."
    );
  }

  const ahora = Date.now();
  const requestsRef = db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("workerJoinRequests");

  // Una sola solicitud viva por persona y unidad: si vuelve a pedirlo porque el
  // supervisor no reacciono, se reusa la anterior en vez de llenarle la bandeja
  // de copias.
  const previasSnap = await requestsRef.where("uid", "==", uid).get();
  const viva = previasSnap.docs.find((docSnap) => requestIsUsable(docSnap.data(), ahora));

  if (viva) {
    return { requestId: viva.id, status: "pending", reused: true };
  }

  const nueva = requestsRef.doc();

  await nueva.set({
    uid,
    rut,
    workspaceId,
    inviteId: invitacion.inviteId,
    profileName: invitacion.profileName,
    deviceLabel,
    status: "pending",
    createdAt: new Date(ahora),
    expiresAt: new Date(ahora + REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000)
  });

  return { requestId: nueva.id, status: "pending", reused: false };
}

// 3) Resolver. Solo quien puede administrar perfiles de esa unidad.
async function resolveWorkerJoinRequestHandler(request, {
  db,
  HttpsError,
  requireProfileManager,
  acceptInvite
}) {
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError("unauthenticated", "Inicia sesion.");
  }

  const workspaceId = cleanText(request.data?.workspaceId, 160);
  const requestId = cleanText(request.data?.requestId, 160);
  const approve = request.data?.approve === true;

  if (!workspaceId || !requestId) {
    throw new HttpsError("invalid-argument", "Falta identificar la solicitud.");
  }

  await requireProfileManager(workspaceId, uid, request.auth?.token || {});

  const requestRef = db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("workerJoinRequests")
    .doc(requestId);
  const snap = await requestRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Esa solicitud ya no existe.");
  }

  const data = snap.data() || {};
  const ahora = Date.now();

  if (!requestIsUsable(data, ahora)) {
    throw new HttpsError(
      "failed-precondition",
      "Esa solicitud ya fue resuelta o caduco."
    );
  }

  if (!approve) {
    await requestRef.set({
      status: "rejected",
      resolvedAt: new Date(ahora),
      resolvedBy: uid
    }, { merge: true });

    return { status: "rejected" };
  }

  // El enlace lo hace el mismo camino que aceptar una invitacion por correo,
  // para que no existan dos formas distintas de quedar enlazado.
  //
  // approvedBySupervisor se pasa a proposito: ese camino puede exigir un correo
  // verificado cuando se encienda la invitacion sin contrasena, y aqui la
  // prueba es la aprobacion, no el correo. Quien se enrole asi se queda sin
  // ancla de correo hasta que vincule su cuenta Google, y conviene ofrecerselo.
  await acceptInvite({
    uid: String(data.uid || ""),
    workspaceId,
    inviteId: String(data.inviteId || ""),
    approvedBySupervisor: true
  });

  await requestRef.set({
    status: "approved",
    resolvedAt: new Date(ahora),
    resolvedBy: uid
  }, { merge: true });

  return { status: "approved" };
}

module.exports = {
  findWorkerInvitesByRutHandler,
  requestWorkerJoinHandler,
  resolveWorkerJoinRequestHandler,
  _private: {
    MAX_DEVICE_LABEL,
    MAX_WORKSPACES,
    REQUEST_TTL_DAYS,
    findInvitesByRut,
    millisFrom,
    normalizeRut,
    requestIsUsable
  }
};
