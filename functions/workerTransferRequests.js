"use strict";

// Transferir a un trabajador a OTRA unidad.
//
// Dos caminos llegan aqui y comparten TODO lo que sigue -que datos se copian,
// los saldos de vacaciones, el vaciado del calendario en origen, la
// inactivacion del perfil-: la unidad que transfiere a alguien, y la unidad que
// pide a alguien de otra. Si manana cambia que se lleva, cambia para ambos.
//
// Lo unico que se bifurca es quien puede pedirlo:
//
//   - con enlace entre las unidades, como siempre;
//   - sin enlace, si ambas declaran el MISMO establecimiento.
//
// El establecimiento alcanza porque hay doble control: quien pide puede
// tambien crear el perfil de cero, y quien recibe la solicitud puede
// rechazarla. Y ademas porque un trabajador debe estar vigente en una sola
// unidad a la vez: si apareciera en dos, no se sabria quien lo califica por
// que periodo. Buscar cobertura si exige enlace; eso no cambia.
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

function addDaysISO(iso, amount) {
  const [year, month, day] = String(iso).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));

  return date.toISOString().slice(0, 10);
}

// Mismo codificador que js/firebasePartialState.js (encodePartialStateItemKey).
function encodeItemKey(itemKey) {
  return encodeURIComponent(String(itemKey || "")).replace(/\./g, "%2E");
}

function decodeItemKey(itemKey) {
  try {
    return decodeURIComponent(String(itemKey || ""));
  } catch {
    return String(itemKey || "");
  }
}

function parseList(raw) {
  try {
    const value = JSON.parse(String(raw || "[]"));

    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

// La lista de perfiles tal como la lee la app: `value` y encima `items`
// (applyListStateEntries en js/firebasePartialState.js).
function profilesFromEntry(entry = {}) {
  const list = parseList(entry.value);
  const deleted = entry.deletedItems || {};

  Object.entries(entry.items || {}).forEach(([key, raw]) => {
    const id = decodeItemKey(key);
    const index = list.findIndex(item => String(item?.id ?? "").trim() === id);

    if (deleted[key] === true) {
      if (index >= 0) list.splice(index, 1);
      return;
    }

    let parsed = null;

    try {
      parsed = JSON.parse(String(raw ?? "null"));
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== "object") return;

    if (index >= 0) list[index] = parsed;
    else list.push(parsed);
  });

  return list;
}

/**
 * Deja INACTIVO el perfil en la unidad de origen, con su ultimo dia valido,
 * aunque nadie de esa unidad tenga la app abierta. El motor de turnos ya da
 * como libres los dias posteriores a `unitExitDate`, asi que desde la fecha deja
 * de aparecer disponible y de contar como activo alla.
 *
 * Escribe SOLO el elemento de ese perfil en `items` -nunca `value`-, dentro de
 * una transaccion. Si el perfil guardado no tiene `id` no se toca: el elemento
 * se agregaria como un perfil duplicado. En ese caso lo hace el navegador de
 * origen al abrirse, como antes. El vaciado de permisos y el ajuste de saldos
 * siguen siendo del navegador.
 *
 * @returns {Promise<{marked: boolean, reason?: string}>}
 */
async function markSourceProfileTransferred(db, solicitud, dependencies) {
  const { serverTimestamp } = dependencies;
  const source = solicitud.sourceWorkspaceId;
  const startDate = cleanText(solicitud.startDate, 10);

  if (!source || !validISODate(startDate)) {
    return { marked: false, reason: "invalid" };
  }

  const ref = db
    .collection("workspaces").doc(source)
    .collection("stateModules").doc("profile")
    .collection("entries").doc("profiles");

  const result = await db.runTransaction(async transaction => {
    const snap = await transaction.get(ref);

    if (!snap.exists) return { marked: false, reason: "no_entry" };

    const entry = snap.data() || {};

    if (entry.deleted === true) return { marked: false, reason: "deleted" };

    const profile = profilesFromEntry(entry)
      .find(item => item?.name === solicitud.profileName);

    if (!profile) return { marked: false, reason: "no_profile" };

    const id = String(profile.id ?? "").trim();

    if (!id) return { marked: false, reason: "no_id" };
    if (profile.active === false) return { marked: false, reason: "inactive" };

    const key = encodeItemKey(id);

    transaction.update(ref, {
      items: {
        ...(entry.items || {}),
        [key]: JSON.stringify({
          ...profile,
          active: false,
          unitExitDate: addDaysISO(startDate, -1)
        })
      },
      deletedItems: { ...(entry.deletedItems || {}), [key]: false },
      container: "array",
      clientId: "server-worker-transfer",
      updatedAt: serverTimestamp(),
      updatedAtISO: new Date().toISOString()
    });

    return { marked: true };
  });

  // Su app sigue en origen hasta la fecha: que su calendario alla se publique
  // ya con la salida. Se pide DESPUES de escribir el perfil.
  if (result.marked) {
    await db
      .collection("workspaces").doc(source)
      .collection("projectionRequests")
      .add({
        profiles: [solicitud.profileName],
        requestedAt: serverTimestamp(),
        source: "worker_transfer"
      });
  }

  return result;
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
    requireSameEstablishment,
    idFactory = defaultIdFactory
  } = dependencies;
  const { uid, workspaceId } = validateBasePayload(request, HttpsError);
  const data = request.data || {};
  const targetWorkspaceId = cleanText(data.targetWorkspaceId, 160);
  const linkId = cleanText(data.linkId, 220);
  const startDate = cleanText(data.startDate, 10);
  const profile = cleanProfile(data.profile);

  // linkId deja de ser obligatorio: sin el, la autorizacion la da compartir
  // establecimiento.
  if (
    !targetWorkspaceId ||
    targetWorkspaceId === workspaceId ||
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
    linkId
      ? requireAcceptedWorkspaceLink(linkId, targetWorkspaceId, workspaceId)
      : requireSameEstablishment(workspaceId, targetWorkspaceId)
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

  return applyTransferResponse({
    db,
    ref,
    requestId,
    solicitud,
    status,
    targetProfileName,
    uid,
    rejectReason: cleanText(request.data?.rejectReason, 300),
    resolvedByName: cleanText(request.data?.resolvedByName, 160),
    serverTimestamp,
    logger: dependencies.logger,
    today: dependencies.today
  });
}

/**
 * Dejar una transferencia aceptada (o rechazada) y hacer lo que eso implica.
 *
 * Vive aparte porque hay DOS caminos que terminan aqui y tienen que hacer
 * exactamente lo mismo: la unidad destino respondiendo una transferencia que le
 * enviaron, y la unidad de origen aceptando un pedido de traspaso -donde el
 * destino ya dijo que si al pedirlo, con fecha y rotativa, asi que la
 * transferencia nace aceptada- (functions/workerHandoverRequests.js).
 *
 * Lo que implica aceptar, y que no puede quedar en un solo camino: inactivar el
 * perfil en origen desde la fecha, y mudar el enlace de la app si la fecha ya
 * llego. Ambas cosas se hacen aqui, con permisos de servidor, para que ocurran
 * aunque esa unidad no tenga la aplicacion abierta.
 */
async function applyTransferResponse({
  db,
  ref,
  requestId,
  solicitud,
  status,
  targetProfileName,
  uid,
  rejectReason = "",
  resolvedByName = "",
  serverTimestamp,
  logger,
  today: hoy
}) {
  const now = serverTimestamp();
  const today = hoy || chileTodayISO();
  // El enlace de la app se muda en la fecha de inicio: antes, el trabajador
  // sigue viendo sus ultimos turnos en origen. Si la fecha ya llego, ahora.
  let linkMoved = null;
  let sourceProfile = null;

  // Primero el perfil de origen: inactivo desde la fecha, aunque esa unidad
  // no tenga la app abierta. Si falla, lo hace su navegador al abrirse.
  if (status === ACCEPTED) {
    try {
      sourceProfile = await markSourceProfileTransferred(
        db,
        solicitud,
        { serverTimestamp }
      );
    } catch (error) {
      sourceProfile = { marked: false, reason: "error" };
      logger?.warn?.("No se pudo inactivar el perfil en origen.", {
        requestId,
        error: error?.message || String(error)
      });
    }
  }

  if (status === ACCEPTED && solicitud.startDate <= today) {
    try {
      linkMoved = (await moveWorkerLinkForTransfer(
        db,
        { ...solicitud, id: requestId, targetProfileName },
        serverTimestamp
      )).moved;
    } catch (error) {
      // No se pierde: la tarea diaria lo reintenta mientras linkMovedAt falte.
      logger?.warn?.("No se pudo mudar el enlace al aceptar.", {
        requestId,
        error: error?.message || String(error)
      });
    }
  }

  await ref.update({
    ...(linkMoved === null
      ? {}
      : { linkMoved, linkMovedAt: now }),
    ...(sourceProfile
      ? {
        sourceProfileMarked: sourceProfile.marked,
        sourceProfileMarkReason: sourceProfile.reason || ""
      }
      : {}),
    status,
    targetProfileName: status === ACCEPTED ? targetProfileName : "",
    rejectReason: status === REJECTED ? rejectReason : "",
    resolvedAt: now,
    resolvedByUid: uid,
    resolvedByName,
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

// Cuanto vale una reserva de traspaso sin confirmar. Lo bastante larga para
// crear un perfil con calma, y lo bastante corta para que una sesion que se
// corto no deje a nadie esperando mucho rato.
const INTAKE_CLAIM_TTL_MS = 10 * 60 * 1000;

// Un testigo por TOMA, no por cuenta: dos pestañas del mismo supervisor
// comparten uid, asi que con el uid solo, la pestaña cuya reserva vencio podia
// confirmar -o soltar- la reserva que tomo la otra.
function defaultClaimTokenFactory() {
  return `clm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function intakeClaimIsFresh(solicitud, now) {
  const tomada = Number(solicitud && solicitud.targetIntakeClaimedAtMs) || 0;

  return Boolean(tomada) && now - tomada < INTAKE_CLAIM_TTL_MS;
}

/**
 * La unidad DESTINO reclama crear el perfil de un traspaso que ya viene
 * aceptado (functions/workerHandoverRequests.js): ella lo pidio, con fecha y
 * rotativa, asi que no tiene nada que responder y su aplicacion lo crea sola.
 *
 * Solo la primera sesion que lo pide recibe `claimed: true`. Sin esto, dos
 * pestañas abiertas crearian dos perfiles de la misma persona.
 */
async function claimWorkerTransferIntakeHandler(request, dependencies) {
  const {
    db,
    HttpsError,
    serverTimestamp,
    requireWorkspaceProfileManager,
    claimTokenFactory = defaultClaimTokenFactory
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
        "Solo la unidad que recibe crea este perfil."
      );
    }

    // Solo las que nacieron de un pedido de traspaso: una transferencia normal
    // la acepta una persona, no se aplica sola.
    if (
      solicitud.status !== ACCEPTED ||
      !solicitud.handoverRequestId ||
      solicitud.targetIntakeAppliedAt
    ) {
      return { ok: true, requestId, claimed: false };
    }

    // La toma VENCE. Antes se marcaba como aplicada aqui mismo, antes de crear
    // el perfil: si esa sesion no llegaba a crearlo -se cierra la pestaña, se
    // cae la conexion, el navegador se queda sin memoria-, el traspaso quedaba
    // consumido para siempre y la persona sin perfil, sin que nadie volviera a
    // intentarlo. El `release` solo cubria el fallo con excepcion.
    //
    // Ahora se reserva por un rato y la marca definitiva la pone el confirm,
    // despues de guardar el perfil. Una reserva abandonada se recupera sola.
    if (intakeClaimIsFresh(solicitud, Date.now())) {
      return { ok: true, requestId, claimed: false };
    }

    const now = serverTimestamp();
    const claimToken = claimTokenFactory();

    transaction.update(ref, {
      targetIntakeClaimedAt: now,
      targetIntakeClaimedAtMs: Date.now(),
      targetIntakeClaimedByUid: uid,
      targetIntakeClaimToken: claimToken,
      updatedAt: now
    });

    return { ok: true, requestId, claimed: true, claimToken };
  });
}

/**
 * El enlace de la aplicacion ya se habia mudado con el nombre de origen y aqui
 * la persona se llama de otra forma: se corrige el nombre en las dos copias del
 * enlace -la de la unidad y la del usuario-.
 *
 * No toca nada mas: el enlace es el mismo, con el mismo uid; lo unico que
 * estaba mal era a que perfil apuntaba.
 */
async function renameMovedWorkerLink(db, datos, serverTimestamp) {
  const targetWorkspaceId = cleanText(datos.targetWorkspaceId, 160);
  const previousProfileName = cleanText(datos.previousProfileName, 180);
  const profileName = cleanText(datos.profileName, 180);

  if (!targetWorkspaceId || !previousProfileName || !profileName) {
    return { renamed: false };
  }

  const targetRef = db.collection("workspaces").doc(targetWorkspaceId);
  const snap = await targetRef
    .collection("workerLinks")
    .where("profileName", "==", previousProfileName)
    .get();
  const linkDoc = snap.docs.find(docSnap =>
    String((docSnap.data() || {}).status || "active") === "active"
  );

  if (!linkDoc) return { renamed: false };

  const uid = cleanText((linkDoc.data() || {}).uid || linkDoc.id, 160);

  if (!uid) return { renamed: false };

  const now = serverTimestamp();
  const batch = db.batch();

  batch.set(
    targetRef.collection("workerLinks").doc(uid),
    { profileName, updatedAt: now },
    { merge: true }
  );
  batch.set(
    db.collection("users").doc(uid).collection("workerLinks").doc(targetWorkspaceId),
    { profileName, updatedAt: now },
    { merge: true }
  );

  await batch.commit();

  return { renamed: true, uid };
}

/**
 * El perfil ya quedo guardado: la reserva se vuelve definitiva.
 *
 * Es el paso que faltaba. Sin el, "tomado" y "aplicado" eran lo mismo y un
 * traspaso podia darse por hecho sin que existiera el perfil.
 */
async function confirmWorkerTransferIntakeHandler(request, dependencies) {
  const {
    db,
    HttpsError,
    serverTimestamp,
    requireWorkspaceProfileManager
  } = dependencies;
  const { uid, workspaceId, requestId } =
    validateBasePayload(request, HttpsError);
  const claimToken = cleanText(request.data && request.data.claimToken, 80);
  const profileName = cleanText(request.data && request.data.profileName, 180);

  if (!requestId) {
    callableError(
      HttpsError,
      "invalid-argument",
      "No fue posible identificar la transferencia."
    );
  }

  await requireWorkspaceProfileManager(workspaceId, uid, request.auth.token);

  const ref = db.collection(COLLECTION).doc(requestId);
  const resultado = await db.runTransaction(async transaction => {
    const snap = await transaction.get(ref);

    if (!snap.exists) {
      callableError(HttpsError, "not-found", "La transferencia ya no existe.");
    }

    const solicitud = snap.data() || {};

    if (solicitud.targetWorkspaceId !== workspaceId) {
      callableError(
        HttpsError,
        "permission-denied",
        "Solo la unidad que recibe confirma este traspaso."
      );
    }

    if (solicitud.targetIntakeAppliedAt) {
      return { ok: true, requestId, confirmed: false };
    }

    // Solo quien tiene ESTA reserva. El uid no alcanza: dos pestañas del mismo
    // supervisor lo comparten, y la que perdio su reserva por vencimiento
    // confirmaria la que tomo la otra -dando por creado un perfil que esa
    // todavia esta creando-.
    if (
      !claimToken ||
      solicitud.targetIntakeClaimToken !== claimToken ||
      solicitud.targetIntakeClaimedByUid !== uid
    ) {
      return { ok: true, requestId, confirmed: false };
    }

    const now = serverTimestamp();
    // Con que nombre quedo de verdad en la unidad que recibe.
    //
    // Puede no ser el de origen: la persona se reconoce por su RUT, y alla
    // podia existir ya con el nombre escrito de otra forma. El enlace de su
    // aplicacion se muda por NOMBRE, asi que sin esto quedaba apuntando a un
    // perfil que no existe y el trabajador dejaba de ver sus turnos.
    const anterior = cleanText(
      solicitud.targetProfileName || solicitud.profileName,
      180
    );
    const renombrado = Boolean(profileName) && profileName !== anterior;

    transaction.update(ref, {
      ...(renombrado ? { targetProfileName: profileName } : {}),
      targetIntakeAppliedAt: now,
      targetIntakeAppliedByUid: uid,
      targetIntakeClaimedAt: null,
      targetIntakeClaimedAtMs: null,
      targetIntakeClaimedByUid: null,
      updatedAt: now
    });

    return {
      ok: true,
      requestId,
      confirmed: true,
      renombrado,
      anterior,
      // Si el enlace ya se mudo -transferencia que empezaba hoy-, lleva el
      // nombre viejo y hay que corregirlo.
      enlaceMudado: Boolean(solicitud.linkMovedAt),
      targetWorkspaceId: workspaceId
    };
  });

  if (resultado.confirmed && resultado.renombrado && resultado.enlaceMudado) {
    try {
      await renameMovedWorkerLink(db, {
        targetWorkspaceId: resultado.targetWorkspaceId,
        previousProfileName: resultado.anterior,
        profileName
      }, serverTimestamp);
    } catch (error) {
      // El traspaso ya quedo aplicado: el enlace se puede corregir despues.
      dependencies.logger?.warn?.("No se pudo renombrar el enlace mudado.", {
        requestId,
        error: error?.message || String(error)
      });
    }
  }

  return {
    ok: true,
    requestId,
    confirmed: resultado.confirmed === true,
    renamed: resultado.renombrado === true
  };
}

/**
 * Devuelve el traspaso a la cola porque crear el perfil fallo.
 *
 * El claim existe para que dos sesiones no creen dos perfiles, pero si la que
 * lo tomo no consigue guardar, dejarlo marcado como aplicado consumiria el
 * traspaso para siempre: la persona se quedaria sin perfil y nadie volveria a
 * intentarlo. Soltarlo lo deja disponible para el proximo intento.
 *
 * Solo puede soltarlo quien lo tomo: si no, una sesion podria devolver a la
 * cola un traspaso que otra esta aplicando en ese mismo momento, y terminarian
 * los dos creando el perfil.
 */
async function releaseWorkerTransferIntakeHandler(request, dependencies) {
  const {
    db,
    HttpsError,
    serverTimestamp,
    requireWorkspaceProfileManager
  } = dependencies;
  const { uid, workspaceId, requestId } =
    validateBasePayload(request, HttpsError);
  const claimToken = cleanText(request.data && request.data.claimToken, 80);

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
        "Solo la unidad que recibe libera este traspaso."
      );
    }

    // Suelta la RESERVA, no la marca definitiva: un traspaso ya confirmado
    // tiene su perfil creado y devolverlo a la cola lo crearia dos veces.
    //
    // Y suelta SOLO la suya: con el uid a secas, una pestaña cuya reserva
    // vencio devolvia a la cola la que otra estaba aplicando en ese momento.
    if (
      solicitud.targetIntakeAppliedAt ||
      !claimToken ||
      solicitud.targetIntakeClaimToken !== claimToken ||
      solicitud.targetIntakeClaimedByUid !== uid
    ) {
      return { ok: true, requestId, released: false };
    }

    const now = serverTimestamp();

    transaction.update(ref, {
      targetIntakeClaimedAt: null,
      targetIntakeClaimedAtMs: null,
      targetIntakeClaimedByUid: null,
      targetIntakeFailedAt: now,
      updatedAt: now
    });

    return { ok: true, requestId, released: true };
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
  applyTransferResponse,
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
  claimWorkerTransferIntakeHandler,
  confirmWorkerTransferIntakeHandler,
  renameMovedWorkerLink,
  cleanProfile,
  createWorkerTransferRequestHandler,
  markSourceProfileTransferred,
  moveDueWorkerLinksHandler,
  profilesFromEntry,
  moveWorkerLinkForTransfer,
  releaseWorkerTransferIntakeHandler,
  respondWorkerTransferRequestHandler
};
