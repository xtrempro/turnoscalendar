"use strict";

// Transferir a un trabajador a OTRA unidad enlazada.
//
// La unidad de origen elige la unidad destino y la fecha desde la que el
// trabajador empieza alla. Queda una solicitud PENDIENTE; la unidad destino la
// acepta creando el perfil con su propia rotativa, y recien entonces la unidad
// de origen inactiva el perfil y vacia su calendario desde esa fecha.
//
// Igual que las ausencias entre unidades (interUnitAbsenceRequests.js), el
// servidor solo guarda la solicitud y su estado: crear el perfil en destino e
// inactivarlo en origen lo hace cada navegador, que es quien conoce el formato
// de los perfiles y sus modulos de estado.
//
// Aplicar en origen se RECLAMA aqui, en una transaccion: si hay dos sesiones del
// origen abiertas, solo una vacia el calendario y escribe el historial.

const COLLECTION = "workerTransferRequests";
const PENDING = "pending";
const ACCEPTED = "accepted";
const REJECTED = "rejected";
const CANCELED = "canceled";
const RESPONSES = [ACCEPTED, REJECTED];

// Solo viajan los datos del perfil que la unidad destino necesita para crearlo.
// Nada de calendario, permisos ni adjuntos: eso es historia de la unidad de
// origen y se queda alla.
const PROFILE_TEXT_FIELDS = {
  name: 160,
  email: 254,
  rut: 20,
  phone: 20,
  birthDate: 10,
  contractType: 60,
  estamento: 60,
  profession: 120,
  grade: 10,
  sourceRotationType: 40
};

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
  return `wtr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function cleanBalance(value) {
  const number = Number(value);

  return Number.isFinite(number) && number >= 0
    ? Math.min(Math.round(number * 2) / 2, 999)
    : null;
}

// Saldos de vacaciones del año de inicio: lo que le queda en origen mas lo que
// se le devuelve al vaciar su calendario desde la fecha (lo calcula el cliente).
function cleanLeaveBalances(balances) {
  if (!balances || typeof balances !== "object") return null;

  const year = Number(balances.year);

  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;

  const clean = { year };

  ["legal", "comp", "admin", "hoursReturn"].forEach(field => {
    const value = cleanBalance(balances[field]);

    if (value !== null) clean[field] = value;
  });

  return clean;
}

function cleanProfile(profile = {}) {
  const source = profile && typeof profile === "object" ? profile : {};
  const clean = {};

  Object.entries(PROFILE_TEXT_FIELDS).forEach(([field, max]) => {
    clean[field] = cleanText(source[field], max);
  });

  clean.unionLeaveEnabled = source.unionLeaveEnabled === true;

  const leaveBalances = cleanLeaveBalances(source.leaveBalances);

  if (leaveBalances) clean.leaveBalances = leaveBalances;

  return clean;
}

// "Hoy" en Chile, como ISO. El traslado del enlace se decide por fecha local.
function chileTodayISO(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Santiago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date).map(part => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Muda el enlace de la app del trabajador de la unidad de origen a la destino.
 *
 * Es el MISMO uid: sus mensajes, su respaldo y su cuenta siguen siendo los
 * suyos. En origen el espejo queda con status "transferred" (no "unlinked"): la
 * app lo lee como "me cambiaron de unidad" y recarga sus enlaces, en vez de
 * mostrar el aviso de desvinculacion. Crear el enlace en destino encola su
 * proyeccion (requestProjectionOnWorkerLink), asi que perfil y calendario se
 * publican solos con los datos de la unidad nueva.
 *
 * @returns {Promise<{moved: boolean, uid?: string}>}
 */
async function moveWorkerLinkForTransfer(db, solicitud, serverTimestamp) {
  const source = solicitud.sourceWorkspaceId;
  const target = solicitud.targetWorkspaceId;
  const targetProfileName = cleanText(
    solicitud.targetProfileName || solicitud.profileName,
    180
  );

  if (!source || !target || !targetProfileName) return { moved: false };

  const sourceRef = db.collection("workspaces").doc(source);
  const linksSnap = await sourceRef
    .collection("workerLinks")
    .where("profileName", "==", solicitud.profileName)
    .get();
  const linkDoc = linksSnap.docs.find(docSnap =>
    String((docSnap.data() || {}).status || "active") === "active"
  );

  if (!linkDoc) return { moved: false };

  const link = linkDoc.data() || {};
  const uid = cleanText(link.uid || linkDoc.id, 160);

  if (!uid) return { moved: false };

  const now = serverTimestamp();
  const targetRef = db.collection("workspaces").doc(target);
  const payload = {
    uid,
    workspaceId: target,
    workspaceName: cleanText(solicitud.targetWorkspaceName, 160),
    inviteId: "",
    profileName: targetProfileName,
    profileRut: cleanText(link.profileRut, 32),
    workerEmail: cleanText(link.workerEmail, 254),
    workerDisplayName: cleanText(link.workerDisplayName, 160),
    status: "active",
    linkedAt: now,
    updatedAt: now,
    transferredFromWorkspaceId: source,
    transferRequestId: cleanText(solicitud.id, 220)
  };
  const batch = db.batch();

  batch.set(targetRef.collection("workerLinks").doc(uid), payload);
  batch.set(
    db.collection("users").doc(uid).collection("workerLinks").doc(target),
    payload
  );
  batch.delete(sourceRef.collection("workerLinks").doc(uid));
  batch.set(
    db.collection("users").doc(uid).collection("workerLinks").doc(source),
    {
      workspaceId: source,
      workspaceName: cleanText(solicitud.sourceWorkspaceName, 160),
      profileName: cleanText(solicitud.profileName, 180),
      status: "transferred",
      transferredTo: target,
      transferredAt: now,
      updatedAt: now
    }
  );
  batch.set(
    sourceRef.collection("workerMessageDirectory").doc(uid),
    {
      uid,
      workspaceId: source,
      profileName: cleanText(solicitud.profileName, 180),
      status: "unlinked",
      unlinkedAt: now,
      updatedAt: now,
      updatedAtISO: new Date().toISOString()
    },
    { merge: true }
  );
  batch.delete(sourceRef.collection("workerSwapCandidates").doc(uid));

  await batch.commit();

  return { moved: true, uid };
}

/**
 * Muda los enlaces de las transferencias aceptadas cuya fecha ya llego. Lo
 * llama la tarea diaria; al aceptar, si la fecha ya paso, se muda en el acto.
 */
async function moveDueWorkerLinksHandler(dependencies) {
  const { db, serverTimestamp, logger, today = chileTodayISO() } = dependencies;
  const snap = await db
    .collection(COLLECTION)
    .where("status", "==", ACCEPTED)
    .get();
  let moved = 0;

  for (const docSnap of snap.docs) {
    const solicitud = { id: docSnap.id, ...(docSnap.data() || {}) };

    if (solicitud.linkMovedAt || solicitud.startDate > today) continue;

    try {
      const result = await moveWorkerLinkForTransfer(db, solicitud, serverTimestamp);

      await docSnap.ref.update({
        linkMovedAt: serverTimestamp(),
        linkMoved: result.moved,
        updatedAt: serverTimestamp()
      });
      if (result.moved) moved++;
    } catch (error) {
      logger?.warn?.("No se pudo mudar el enlace de la transferencia.", {
        requestId: solicitud.id,
        error: error?.message || String(error)
      });
    }
  }

  return { moved };
}

function validateBasePayload(request, HttpsError) {
  const uid = request.auth?.uid;
  const workspaceId = cleanText(request.data?.workspaceId, 160);
  const requestId = cleanText(request.data?.requestId, 220);

  if (!uid) {
    callableError(
      HttpsError,
      "unauthenticated",
      "Debes iniciar sesion para gestionar transferencias."
    );
  }

  if (!workspaceId) {
    callableError(
      HttpsError,
      "invalid-argument",
      "No fue posible identificar la unidad."
    );
  }

  return { uid, workspaceId, requestId };
}

async function readRequest(db, HttpsError, requestId) {
  if (!requestId) {
    callableError(
      HttpsError,
      "invalid-argument",
      "No fue posible identificar la transferencia."
    );
  }

  const ref = db.collection(COLLECTION).doc(requestId);
  const snap = await ref.get();

  if (!snap.exists) {
    callableError(HttpsError, "not-found", "La transferencia ya no existe.");
  }

  return { ref, solicitud: snap.data() || {} };
}

/**
 * La unidad de origen pide transferir a uno de sus trabajadores.
 */
async function createWorkerTransferRequestHandler(request, dependencies) {
  const {
    db,
    HttpsError,
    serverTimestamp,
    requireWorkspaceProfileManager,
    requireAcceptedWorkspaceLink,
    idFactory = defaultIdFactory
  } = dependencies;
  const { uid, workspaceId } = validateBasePayload(request, HttpsError);
  const data = request.data || {};
  const targetWorkspaceId = cleanText(data.targetWorkspaceId, 160);
  const linkId = cleanText(data.linkId, 220);
  const startDate = cleanText(data.startDate, 10);
  const profile = cleanProfile(data.profile);

  if (
    !targetWorkspaceId ||
    targetWorkspaceId === workspaceId ||
    !linkId ||
    !profile.name ||
    !validISODate(startDate)
  ) {
    callableError(
      HttpsError,
      "invalid-argument",
      "Los datos de la transferencia no son validos."
    );
  }

  await Promise.all([
    requireWorkspaceProfileManager(workspaceId, uid, request.auth.token),
    requireAcceptedWorkspaceLink(linkId, targetWorkspaceId, workspaceId)
  ]);

  // Una transferencia en curso por trabajador: dos pendientes a unidades
  // distintas podrian aceptarse las dos y el trabajador quedaria en ambas.
  const previas = await db
    .collection(COLLECTION)
    .where("sourceWorkspaceId", "==", workspaceId)
    .get();
  const enCurso = previas.docs.some(docSnap => {
    const previa = docSnap.data() || {};

    return previa.profileName === profile.name && previa.status === PENDING;
  });

  if (enCurso) {
    callableError(
      HttpsError,
      "failed-precondition",
      "Este trabajador ya tiene una transferencia pendiente."
    );
  }

  const requestId = idFactory();
  const now = serverTimestamp();

  await db.collection(COLLECTION).doc(requestId).set({
    sourceWorkspaceId: workspaceId,
    sourceWorkspaceName: cleanText(data.workspaceName, 160),
    targetWorkspaceId,
    targetWorkspaceName: cleanText(data.targetWorkspaceName, 160),
    linkId,
    profileName: profile.name,
    profile,
    startDate,
    requestedByUid: uid,
    requestedByName: cleanText(data.requestedByName, 160),
    status: PENDING,
    createdAt: now,
    updatedAt: now
  });

  return { ok: true, requestId, status: PENDING };
}

/**
 * La unidad destino acepta (ya creo el perfil) o rechaza.
 */
async function respondWorkerTransferRequestHandler(request, dependencies) {
  const {
    db,
    HttpsError,
    serverTimestamp,
    requireWorkspaceProfileManager
  } = dependencies;
  const { uid, workspaceId, requestId } =
    validateBasePayload(request, HttpsError);
  const status = cleanText(request.data?.status, 60);
  const targetProfileName = cleanText(request.data?.targetProfileName, 160);

  if (!RESPONSES.includes(status)) {
    callableError(
      HttpsError,
      "invalid-argument",
      "La respuesta a la transferencia no es valida."
    );
  }

  if (status === ACCEPTED && !targetProfileName) {
    callableError(
      HttpsError,
      "invalid-argument",
      "Falta el perfil creado en la unidad destino."
    );
  }

  const { ref, solicitud } = await readRequest(db, HttpsError, requestId);

  // Sin esto la unidad de origen podria aceptarse sola.
  if (solicitud.targetWorkspaceId !== workspaceId) {
    callableError(
      HttpsError,
      "permission-denied",
      "Solo la unidad destino puede responder esta transferencia."
    );
  }

  if (solicitud.status !== PENDING) {
    callableError(
      HttpsError,
      "failed-precondition",
      "Esta transferencia ya fue respondida."
    );
  }

  await requireWorkspaceProfileManager(workspaceId, uid, request.auth.token);

  const now = serverTimestamp();
  const today = dependencies.today || chileTodayISO();
  // El enlace de la app se muda en la fecha de inicio: antes, el trabajador
  // sigue viendo sus ultimos turnos en origen. Si la fecha ya llego, ahora.
  let linkMoved = null;

  if (status === ACCEPTED && solicitud.startDate <= today) {
    try {
      linkMoved = (await moveWorkerLinkForTransfer(
        db,
        { ...solicitud, id: requestId, targetProfileName },
        serverTimestamp
      )).moved;
    } catch (error) {
      // No se pierde: la tarea diaria lo reintenta mientras linkMovedAt falte.
      dependencies.logger?.warn?.("No se pudo mudar el enlace al aceptar.", {
        requestId,
        error: error?.message || String(error)
      });
    }
  }

  await ref.update({
    ...(linkMoved === null
      ? {}
      : { linkMoved, linkMovedAt: now }),
    status,
    targetProfileName: status === ACCEPTED ? targetProfileName : "",
    rejectReason: status === REJECTED
      ? cleanText(request.data?.rejectReason, 300)
      : "",
    resolvedAt: now,
    resolvedByUid: uid,
    resolvedByName: cleanText(request.data?.resolvedByName, 160),
    updatedAt: now
  });

  return { ok: true, requestId, status };
}

/**
 * La unidad de origen retira una solicitud que aun nadie respondio.
 */
async function cancelWorkerTransferRequestHandler(request, dependencies) {
  const {
    db,
    HttpsError,
    serverTimestamp,
    requireWorkspaceProfileManager
  } = dependencies;
  const { uid, workspaceId, requestId } =
    validateBasePayload(request, HttpsError);
  const { ref, solicitud } = await readRequest(db, HttpsError, requestId);

  if (solicitud.sourceWorkspaceId !== workspaceId) {
    callableError(
      HttpsError,
      "permission-denied",
      "Solo la unidad de origen puede retirar esta transferencia."
    );
  }

  if (solicitud.status !== PENDING) {
    callableError(
      HttpsError,
      "failed-precondition",
      "Esta transferencia ya fue respondida."
    );
  }

  await requireWorkspaceProfileManager(workspaceId, uid, request.auth.token);

  const now = serverTimestamp();

  await ref.update({
    status: CANCELED,
    resolvedAt: now,
    resolvedByUid: uid,
    updatedAt: now
  });

  return { ok: true, requestId, status: CANCELED };
}

/**
 * La unidad de origen reclama el derecho a aplicar una transferencia aceptada
 * (inactivar el perfil y vaciar su calendario). Solo la primera sesion que lo
 * pide recibe `claimed: true`.
 */
async function claimWorkerTransferApplicationHandler(request, dependencies) {
  const {
    db,
    HttpsError,
    serverTimestamp,
    requireWorkspaceProfileManager
  } = dependencies;
  const { uid, workspaceId, requestId } =
    validateBasePayload(request, HttpsError);

  if (!requestId) {
    callableError(
      HttpsError,
      "invalid-argument",
      "No fue posible identificar la transferencia."
    );
  }

  await requireWorkspaceProfileManager(workspaceId, uid, request.auth.token);

  const ref = db.collection(COLLECTION).doc(requestId);

  return db.runTransaction(async transaction => {
    const snap = await transaction.get(ref);

    if (!snap.exists) {
      callableError(HttpsError, "not-found", "La transferencia ya no existe.");
    }

    const solicitud = snap.data() || {};

    if (solicitud.sourceWorkspaceId !== workspaceId) {
      callableError(
        HttpsError,
        "permission-denied",
        "Solo la unidad de origen aplica esta transferencia."
      );
    }

    if (solicitud.status !== ACCEPTED || solicitud.sourceAppliedAt) {
      return { ok: true, requestId, claimed: false };
    }

    const now = serverTimestamp();

    transaction.update(ref, {
      sourceAppliedAt: now,
      sourceAppliedByUid: uid,
      updatedAt: now
    });

    return { ok: true, requestId, claimed: true };
  });
}

/**
 * El ORIGEN informa los saldos que de verdad quedaron tras vaciar el calendario
 * (los permisos anulados ya volvieron al saldo). La unidad destino compara con
 * los que se enviaron al pedir y ajusta la diferencia.
 */
async function reportWorkerTransferBalancesHandler(request, dependencies) {
  const {
    db,
    HttpsError,
    serverTimestamp,
    requireWorkspaceProfileManager
  } = dependencies;
  const { uid, workspaceId, requestId } =
    validateBasePayload(request, HttpsError);
  const balances = cleanLeaveBalances(request.data?.leaveBalances);

  if (!balances) {
    callableError(
      HttpsError,
      "invalid-argument",
      "Los saldos informados no son validos."
    );
  }

  const { ref, solicitud } = await readRequest(db, HttpsError, requestId);

  if (solicitud.sourceWorkspaceId !== workspaceId) {
    callableError(
      HttpsError,
      "permission-denied",
      "Solo la unidad de origen informa los saldos."
    );
  }

  if (solicitud.status !== ACCEPTED) {
    callableError(
      HttpsError,
      "failed-precondition",
      "La transferencia no esta aceptada."
    );
  }

  await requireWorkspaceProfileManager(workspaceId, uid, request.auth.token);

  const now = serverTimestamp();

  await ref.update({
    finalLeaveBalances: balances,
    finalLeaveBalancesAt: now,
    updatedAt: now
  });

  return { ok: true, requestId };
}

/**
 * La unidad DESTINO reclama el ajuste de saldos. Solo la primera sesion que lo
 * pide recibe `claimed: true`: sumar la diferencia dos veces la duplicaria.
 */
async function claimWorkerTransferBalancesHandler(request, dependencies) {
  const {
    db,
    HttpsError,
    serverTimestamp,
    requireWorkspaceProfileManager
  } = dependencies;
  const { uid, workspaceId, requestId } =
    validateBasePayload(request, HttpsError);

  if (!requestId) {
    callableError(
      HttpsError,
      "invalid-argument",
      "No fue posible identificar la transferencia."
    );
  }

  await requireWorkspaceProfileManager(workspaceId, uid, request.auth.token);

  const ref = db.collection(COLLECTION).doc(requestId);

  return db.runTransaction(async transaction => {
    const snap = await transaction.get(ref);

    if (!snap.exists) {
      callableError(HttpsError, "not-found", "La transferencia ya no existe.");
    }

    const solicitud = snap.data() || {};

    if (solicitud.targetWorkspaceId !== workspaceId) {
      callableError(
        HttpsError,
        "permission-denied",
        "Solo la unidad destino ajusta estos saldos."
      );
    }

    if (
      solicitud.status !== ACCEPTED ||
      !solicitud.finalLeaveBalances ||
      solicitud.targetBalancesAppliedAt
    ) {
      return { ok: true, requestId, claimed: false };
    }

    const now = serverTimestamp();

    transaction.update(ref, {
      targetBalancesAppliedAt: now,
      targetBalancesAppliedByUid: uid,
      updatedAt: now
    });

    return { ok: true, requestId, claimed: true };
  });
}

module.exports = {
  claimWorkerTransferBalancesHandler,
  reportWorkerTransferBalancesHandler,
  ACCEPTED,
  CANCELED,
  COLLECTION,
  PENDING,
  REJECTED,
  cancelWorkerTransferRequestHandler,
  chileTodayISO,
  claimWorkerTransferApplicationHandler,
  cleanProfile,
  createWorkerTransferRequestHandler,
  moveDueWorkerLinksHandler,
  moveWorkerLinkForTransfer,
  respondWorkerTransferRequestHandler
};
