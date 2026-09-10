"use strict";

const { randomBytes } = require("node:crypto");
const { isFinalSwapStatus } = require("./swapCancellation");

const SWAP_TURN_LABELS = new Set(["larga", "noche"]);
const SWAP_TURN_CLASSES = new Set(["larga", "noche"]);

function cleanText(value, maxLength = 160) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeISODate(value) {
  const clean = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : "";
}

function parseISODateParts(value) {
  const iso = normalizeISODate(value);
  if (!iso) return null;

  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { iso, year, monthIndex: month - 1, day };
}

function sameMonth(a, b) {
  const left = parseISODateParts(a);
  const right = parseISODateParts(b);

  return Boolean(
    left &&
    right &&
    left.year === right.year &&
    left.monthIndex === right.monthIndex
  );
}

function todayISO(nowDate = () => new Date()) {
  const now = nowDate();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function isPastISODate(iso, nowDate) {
  const today = todayISO(nowDate);
  return normalizeISODate(iso) < today;
}

function idSafe(value) {
  return cleanText(value, 80).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function defaultIdFactory(prefix, uid) {
  return `${prefix}_${idSafe(uid)}_${Date.now()}_${randomBytes(5).toString("hex")}`;
}

function defaultNowISO(nowDate = () => new Date()) {
  return nowDate().toISOString();
}

function callableError(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function dayFor(candidate, iso) {
  const days = candidate?.days || {};
  const day = days[normalizeISODate(iso)];

  return day && typeof day === "object" ? day : null;
}

function normalizeTextKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function shiftLabel(day) {
  return cleanText(day?.displayLabel || day?.label || "", 60);
}

function shiftClass(day) {
  return normalizeTextKey(day?.className || "");
}

function shiftClassFromLabel(label) {
  const key = normalizeTextKey(label).replace(/\s+/g, "-");
  return SWAP_TURN_CLASSES.has(key) ? key : "libre";
}

function isSwapTurnDay(day) {
  if (!day || day.hasLeave === true) return false;

  const label = normalizeTextKey(shiftLabel(day));
  const className = shiftClass(day);

  return SWAP_TURN_LABELS.has(label) || SWAP_TURN_CLASSES.has(className);
}

function isTwentyFourDay(day) {
  if (!day) return false;

  const label = normalizeTextKey(shiftLabel(day));
  const className = shiftClass(day);

  return className === "turno24" || label === "24h" || label === "24";
}

// Turno que ENTREGA el que hace el cambio. En un dia 24 (base + extra) el cambio
// opera sobre el turno BASE (Larga/Noche); el extra queda intacto. En un dia normal,
// es el propio turno. 1 = Larga, 2 = Noche, 0 = ninguno.
function giverTurnCodeFromDay(day) {
  if (!day || day.hasLeave === true) return 0;

  if (isTwentyFourDay(day)) {
    const base = Number(day.baseTurn) || 0;
    return base === 1 || base === 2 ? base : 0;
  }

  return swapTurnCodeFromDay(day);
}

// El dia a cambiar (propio o de devolucion) debe ser Larga/Noche, O un 24 cuyo turno
// BASE sea Larga/Noche (en ese caso se entrega el base y el extra queda).
function isSwappableTurnDay(day) {
  return isSwapTurnDay(day) || giverTurnCodeFromDay(day) !== 0;
}

function turnCodeLabel(code) {
  return code === 1 ? "Larga" : code === 2 ? "Noche" : "";
}

function turnCodeClassName(code) {
  return code === 1 ? "larga" : code === 2 ? "noche" : "";
}

// Etiqueta/clase del turno que realmente se entrega (el BASE en un dia 24).
function giverTurnLabel(day) {
  return isTwentyFourDay(day)
    ? turnCodeLabel(giverTurnCodeFromDay(day))
    : shiftLabel(day);
}

function giverTurnClassName(day) {
  return isTwentyFourDay(day)
    ? turnCodeClassName(giverTurnCodeFromDay(day))
    : (shiftClass(day) || shiftClassFromLabel(shiftLabel(day)));
}

function isFreeTurnDay(day) {
  if (!day || day.hasLeave === true) return false;

  const label = normalizeTextKey(shiftLabel(day));
  const className = shiftClass(day);

  return label === "libre" || className === "libre";
}

// Un dia de rotativa Diurno sin extension. No esta libre -ese dia igual viene a
// trabajar-, pero puede recibir una Larga extendiendo su jornada.
function isDiurnoTurnDay(day) {
  if (!day || day.hasLeave === true) return false;

  const label = normalizeTextKey(shiftLabel(day));
  const className = shiftClass(day);

  return label === "diurno" || className === "diurno";
}

// Dos trabajadores de rotativa Diurno intercambiando su dia de extension
// horaria: el que recibe pasa de Diurno a Larga ese dia. No forma un 24 ni deja
// a nadie libre, asi que no depende de `allowTwentyFour`.
function receiverExtendsDiurnoToLarga(receiverDay, giverTurn) {
  return Number(giverTurn) === 1 && isDiurnoTurnDay(receiverDay);
}

// Codigo de turno intercambiable: 1 = Larga, 2 = Noche (0 = ninguno).
function swapTurnCodeFromDay(day) {
  if (!day || day.hasLeave === true) return 0;

  const label = normalizeTextKey(shiftLabel(day));
  const className = shiftClass(day);

  if (label === "larga" || label === "l" || className === "larga") return 1;
  if (label === "noche" || label === "n" || className === "noche") return 2;
  return 0;
}

// Larga + Noche el mismo dia = turno 24.
function isComplementary24(a, b) {
  return (a === 1 && b === 2) || (a === 2 && b === 1);
}

// El receptor cubre el turno del dia si esta LIBRE, o si tiene el turno
// complementario (queda con turno 24) y la unidad permite el 24. El 24 invertido
// y la materializacion los valida el motor del supervisor al aprobar el cambio.
function receiverCanCoverDay(receiverDay, giverTurn, allowTwentyFour) {
  if (isFreeTurnDay(receiverDay)) return true;
  if (receiverExtendsDiurnoToLarga(receiverDay, giverTurn)) return true;

  return Boolean(
    allowTwentyFour &&
    isComplementary24(Number(giverTurn) || 0, swapTurnCodeFromDay(receiverDay))
  );
}

// Entre dos Diurno solo se cambia Larga por Larga de dia habil. Lo que se
// intercambia es el dia de extension horaria (el Diurno que el supervisor subio
// a Larga), y el dia habil lo marca la propia rotativa: trae Diurno (baseTurn 4)
// en dia habil y Libre en fin de semana o feriado. Una Noche, o una Larga de fin
// de semana, es un turno extra y no entra en este cambio. Es la misma regla que
// aplican el motor del supervisor y la PWA.
const DIURNO_OWN_DATE_MESSAGE =
  "Entre Diurno solo se cambia Larga por Larga de dia habil: el turno a cambiar debe ser una Larga de dia habil.";
const DIURNO_RETURN_DATE_MESSAGE =
  "Entre Diurno solo se cambia Larga por Larga de dia habil: la devolucion debe ser una Larga de dia habil.";

function isDiurnoCandidate(candidate) {
  return String(candidate?.rotativa?.type || "") === "diurno";
}

function isDiurnoExtensionDay(day) {
  return swapTurnCodeFromDay(day) === 1 && Number(day?.baseTurn) === 4;
}

function assertDiurnoExtensionDay(day, HttpsError, message) {
  if (!isDiurnoExtensionDay(day)) {
    callableError(HttpsError, "failed-precondition", message);
  }
}

function isBlocked(candidate, iso) {
  const blocked = Array.isArray(candidate?.blockedDayDates)
    ? candidate.blockedDayDates.map(normalizeISODate)
    : [];

  return blocked.includes(normalizeISODate(iso));
}

function profileNameFor(candidate = {}, link = {}, fallback = "Trabajador") {
  return cleanText(candidate.profileName || link.profileName || fallback, 160);
}

function profileRutFor(candidate = {}, link = {}) {
  return cleanText(candidate.profileRut || link.profileRut || "", 80);
}

function isActiveLink(link = {}) {
  return !link.status || link.status === "active";
}

function isActiveCandidate(candidate = {}) {
  return !candidate.status || candidate.status === "active";
}

function compatibleUids(candidate = {}) {
  return Array.isArray(candidate.compatibleWorkerUids)
    ? candidate.compatibleWorkerUids.map(String)
    : [];
}

function assertSwapLimitAvailable(appData = {}, iso, HttpsError, message) {
  const limit = appData.swapLimit || {};

  if (limit.enabled !== true) return;

  const date = parseISODateParts(iso);
  const limitValue = Number(limit.limit) || 0;
  const used = Number(limit.used) || 0;
  const sameLimitMonth =
    date &&
    Number(limit.year) === date.year &&
    Number(limit.month) === date.monthIndex;

  if (sameLimitMonth && limitValue > 0 && used >= limitValue) {
    callableError(HttpsError, "failed-precondition", message);
  }
}

async function readRequiredDoc(ref, HttpsError, code, message) {
  const snap = await ref.get();

  if (!snap.exists) {
    callableError(HttpsError, code, message);
  }

  return snap.data() || {};
}

async function requireActiveWorkerLink(workspaceRef, uid, HttpsError, message) {
  const link = await readRequiredDoc(
    workspaceRef.collection("workerLinks").doc(uid),
    HttpsError,
    "permission-denied",
    message
  );

  if (!isActiveLink(link)) {
    callableError(HttpsError, "permission-denied", message);
  }

  return link;
}

async function requireActiveCandidate(workspaceRef, uid, HttpsError, message) {
  const candidate = await readRequiredDoc(
    workspaceRef.collection("workerSwapCandidates").doc(uid),
    HttpsError,
    "failed-precondition",
    message
  );

  if (!isActiveCandidate(candidate)) {
    callableError(HttpsError, "failed-precondition", message);
  }

  return candidate;
}

async function readWorkerAppData(workspaceRef, uid) {
  const snap = await workspaceRef.collection("workerAppData").doc(uid).get();
  return snap.exists ? snap.data() || {} : {};
}

function assertWorkerAllowsDirectSwap(appData, HttpsError) {
  if (appData?.swapOptIn?.allowSwapRequests === false) {
    callableError(
      HttpsError,
      "failed-precondition",
      "El trabajador seleccionado tiene desactivadas las solicitudes de cambio de turno."
    );
  }
}

function assertCompatiblePair(
  requesterCandidate,
  targetCandidate,
  requesterUid,
  targetUid,
  HttpsError
) {
  const requesterAllowsTarget =
    compatibleUids(requesterCandidate).includes(targetUid);
  const targetAllowsRequester =
    compatibleUids(targetCandidate).includes(requesterUid);

  if (!requesterAllowsTarget || !targetAllowsRequester) {
    callableError(
      HttpsError,
      "failed-precondition",
      "Los trabajadores ya no cumplen la regla de compatibilidad para cambio de turno."
    );
  }
}

function assertOwnSwapDate(candidate, iso, HttpsError, nowDate) {
  const day = dayFor(candidate, iso);

  if (isPastISODate(iso, nowDate)) {
    callableError(
      HttpsError,
      "failed-precondition",
      "La fecha del turno a cambiar debe ser actual o futura."
    );
  }

  if (!isSwappableTurnDay(day)) {
    callableError(
      HttpsError,
      "failed-precondition",
      "Selecciona un turno Larga o Noche habilitado para cambio."
    );
  }

  if (isBlocked(candidate, iso)) {
    callableError(
      HttpsError,
      "failed-precondition",
      "El trabajador tiene ese dia bloqueado para cambios de turno."
    );
  }

  return day;
}

function assertReceiverCanCoverDate(
  candidate,
  iso,
  HttpsError,
  { giverTurn = 0, allowTwentyFour = false } = {}
) {
  const day = dayFor(candidate, iso);

  if (!receiverCanCoverDay(day, giverTurn, allowTwentyFour)) {
    callableError(
      HttpsError,
      "failed-precondition",
      "El trabajador seleccionado no esta libre, ni viene en Diurno para extender su jornada, ni tiene un turno complementario (para 24) para recibir ese turno."
    );
  }

  if (isBlocked(candidate, iso)) {
    callableError(
      HttpsError,
      "failed-precondition",
      "El trabajador seleccionado tiene bloqueado el dia del turno a cubrir."
    );
  }

  return day;
}

// La unidad permite dejar al receptor con turno 24 (default true). El campo lo
// publica el supervisor en el doc del candidato; si aun no llego, se asume false
// para no ofrecer el 24 hasta que la config este disponible.
function allowsTwentyFour(candidate) {
  return candidate?.allowTwentyFourHourShifts === true;
}

function assertReturnSwapDate(candidate, iso, HttpsError, nowDate) {
  const day = dayFor(candidate, iso);

  if (isPastISODate(iso, nowDate)) {
    callableError(
      HttpsError,
      "failed-precondition",
      "La fecha de devolucion debe ser actual o futura."
    );
  }

  if (!isSwappableTurnDay(day)) {
    callableError(
      HttpsError,
      "failed-precondition",
      "La fecha de devolucion ya no tiene un turno Larga o Noche disponible."
    );
  }

  if (isBlocked(candidate, iso)) {
    callableError(
      HttpsError,
      "failed-precondition",
      "El trabajador tiene bloqueada la fecha de devolucion."
    );
  }

  return day;
}

function validateBasePayload(request, HttpsError) {
  const uid = request.auth?.uid || "";

  if (!uid) {
    callableError(
      HttpsError,
      "unauthenticated",
      "Debes iniciar sesion para gestionar cambios de turno."
    );
  }

  const workspaceId = cleanText(request.data?.workspaceId, 160);

  if (!workspaceId) {
    callableError(
      HttpsError,
      "invalid-argument",
      "No fue posible identificar la unidad."
    );
  }

  return { uid, workspaceId };
}

// La devolucion SI puede caer el mismo dia del cambio: es el cruce en que uno
// entrega su Noche y recibe la Larga del otro. Los dos turnos salen y entran el
// mismo dia, asi que nadie queda con 24h; exigir fechas distintas bloqueaba un
// cambio que el supervisor si puede registrar en ProTurnos.
function validateSwapDates({ ownDate, returnDate, HttpsError }) {
  if (!parseISODateParts(ownDate) || !parseISODateParts(returnDate)) {
    callableError(
      HttpsError,
      "invalid-argument",
      "Las fechas del cambio de turno no son validas."
    );
  }

  if (!sameMonth(ownDate, returnDate)) {
    callableError(
      HttpsError,
      "failed-precondition",
      "La fecha de cambio y devolucion deben pertenecer al mismo mes."
    );
  }
}

function clientSafeRequest(data = {}, updatedAtISO) {
  const copy = { ...data };

  if (copy.createdAt && typeof copy.createdAt !== "string") {
    copy.createdAt = updatedAtISO;
  }
  copy.updatedAt = updatedAtISO;

  return copy;
}

async function createWorkerSwapRequestHandler(request, dependencies) {
  const {
    db,
    HttpsError,
    serverTimestamp,
    idFactory = defaultIdFactory,
    nowISO = defaultNowISO,
    nowDate = () => new Date()
  } = dependencies;
  const { uid, workspaceId } = validateBasePayload(request, HttpsError);
  const targetUid = cleanText(request.data?.targetUid, 160);
  const ownDate = normalizeISODate(request.data?.ownDate);
  const returnDate = normalizeISODate(request.data?.returnDate);

  if (!targetUid || targetUid === uid) {
    callableError(
      HttpsError,
      "invalid-argument",
      "Selecciona un trabajador distinto para recibir el turno."
    );
  }

  validateSwapDates({ ownDate, returnDate, HttpsError });

  const workspaceRef = db.collection("workspaces").doc(workspaceId);
  const [
    requesterLink,
    targetLink,
    requesterCandidate,
    targetCandidate,
    requesterApp,
    targetApp
  ] = await Promise.all([
    requireActiveWorkerLink(
      workspaceRef,
      uid,
      HttpsError,
      "Tu cuenta ya no esta enlazada con esta unidad."
    ),
    requireActiveWorkerLink(
      workspaceRef,
      targetUid,
      HttpsError,
      "El trabajador seleccionado ya no esta enlazado con esta unidad."
    ),
    requireActiveCandidate(
      workspaceRef,
      uid,
      HttpsError,
      "Tu calendario de cambios aun no esta disponible."
    ),
    requireActiveCandidate(
      workspaceRef,
      targetUid,
      HttpsError,
      "El calendario del trabajador seleccionado ya no esta disponible."
    ),
    readWorkerAppData(workspaceRef, uid),
    readWorkerAppData(workspaceRef, targetUid)
  ]);

  assertCompatiblePair(
    requesterCandidate,
    targetCandidate,
    uid,
    targetUid,
    HttpsError
  );
  assertWorkerAllowsDirectSwap(targetApp, HttpsError);
  assertSwapLimitAvailable(
    requesterApp,
    ownDate,
    HttpsError,
    "Alcanzaste el limite mensual de cambios de turno."
  );
  assertSwapLimitAvailable(
    targetApp,
    ownDate,
    HttpsError,
    "El trabajador seleccionado alcanzo el limite mensual de cambios de turno."
  );

  const ownDay = assertOwnSwapDate(
    requesterCandidate,
    ownDate,
    HttpsError,
    nowDate
  );
  // El receptor puede estar libre, venir en Diurno (extiende su jornada a Larga:
  // es el intercambio del dia de extension horaria entre dos rotativas Diurno),
  // O tener el turno complementario (queda con 24) si la unidad lo permite. El
  // motor del supervisor valida el 24/invertido al aprobar; aqui solo se
  // habilita que la solicitud se pueda crear.
  assertReceiverCanCoverDate(targetCandidate, ownDate, HttpsError, {
    // En un dia 24 el que entrega da su turno BASE (no el 24), asi que la
    // compatibilidad se evalua contra ese base.
    giverTurn: giverTurnCodeFromDay(ownDay),
    allowTwentyFour: allowsTwentyFour(targetCandidate)
  });
  const returnDay = assertReturnSwapDate(
    targetCandidate,
    returnDate,
    HttpsError,
    nowDate
  );
  // El SOLICITANTE recibe el turno del companero en la devolucion: no puede ser un
  // dia en que el mismo este de permiso/vacaciones (no podria cubrirlo). El resto de
  // reglas (24, adyacencia) las valida el motor del supervisor al aprobar.
  const requesterReturnDay = dayFor(requesterCandidate, returnDate);
  if (requesterReturnDay && requesterReturnDay.hasLeave === true) {
    callableError(
      HttpsError,
      "failed-precondition",
      "No puedes devolver un turno un dia en que tienes un permiso o vacaciones."
    );
  }
  // Un Diurno solo es compatible con otro Diurno, y entre ellos las dos fechas
  // tienen que ser una Larga de dia habil.
  if (isDiurnoCandidate(requesterCandidate) && isDiurnoCandidate(targetCandidate)) {
    assertDiurnoExtensionDay(ownDay, HttpsError, DIURNO_OWN_DATE_MESSAGE);
    assertDiurnoExtensionDay(returnDay, HttpsError, DIURNO_RETURN_DATE_MESSAGE);
  }

  const requestId = idFactory("swap", uid);
  const createdAt = nowISO(nowDate);
  const now = serverTimestamp();
  const fromProfile = profileNameFor(requesterCandidate, requesterLink);
  const toProfile = profileNameFor(targetCandidate, targetLink);
  // En un dia 24 se entrega/devuelve el turno BASE; la etiqueta lo refleja.
  const ownTurnLabel = giverTurnLabel(ownDay);
  const returnTurnLabel = giverTurnLabel(returnDay);
  const ownTurnClassName = giverTurnClassName(ownDay);
  const returnTurnClassName = giverTurnClassName(returnDay);
  const requestData = {
    id: requestId,
    workspaceId,
    type: "swap",
    source: "worker_app",
    status: "pending_colleague",
    createdByUid: uid,
    createdByEmail: cleanText(request.auth?.token?.email, 254),
    targetUid,
    profile: fromProfile,
    from: fromProfile,
    to: toProfile,
    targetProfile: toProfile,
    targetProfileRut: profileRutFor(targetCandidate, targetLink),
    sourceUid: uid,
    participantUids: [uid, targetUid],
    date: ownDate,
    fecha: ownDate,
    returnDate,
    devolucion: returnDate,
    ownTurnLabel,
    ownTurnClassName,
    returnTurnLabel,
    returnTurnClassName,
    calendarMarkers: {
      changeDate: ownDate,
      returnDate,
      sourceUid: uid,
      targetUid,
      ownTurnLabel,
      ownTurnClassName,
      returnTurnLabel,
      returnTurnClassName
    },
    detail: `${formatDateCL(ownDate)} por devolucion ${formatDateCL(returnDate)} con ${toProfile}.`,
    notificationStatus: "pending_colleague",
    createdAt,
    updatedAt: now
  };

  await workspaceRef
    .collection("workerSwapRequests")
    .doc(requestId)
    .set(requestData);

  return {
    ok: true,
    requestId,
    request: clientSafeRequest(requestData, createdAt)
  };
}

async function createWorkerSwapOpenRequestHandler(request, dependencies) {
  const {
    db,
    HttpsError,
    serverTimestamp,
    idFactory = defaultIdFactory,
    nowISO = defaultNowISO,
    nowDate = () => new Date()
  } = dependencies;
  const { uid, workspaceId } = validateBasePayload(request, HttpsError);
  const ownDate = normalizeISODate(request.data?.ownDate);

  if (!parseISODateParts(ownDate)) {
    callableError(
      HttpsError,
      "invalid-argument",
      "Selecciona una fecha valida para el cambio abierto."
    );
  }

  const workspaceRef = db.collection("workspaces").doc(workspaceId);
  const [link, candidate, appData] = await Promise.all([
    requireActiveWorkerLink(
      workspaceRef,
      uid,
      HttpsError,
      "Tu cuenta ya no esta enlazada con esta unidad."
    ),
    requireActiveCandidate(
      workspaceRef,
      uid,
      HttpsError,
      "Tu calendario de cambios aun no esta disponible."
    ),
    readWorkerAppData(workspaceRef, uid)
  ]);

  assertSwapLimitAvailable(
    appData,
    ownDate,
    HttpsError,
    "Alcanzaste el limite mensual de cambios de turno."
  );

  const ownDay = assertOwnSwapDate(candidate, ownDate, HttpsError, nowDate);

  // Los colegas de un Diurno son solo Diurno: su oferta tiene que ser una Larga
  // de dia habil, o nadie podria tomarla.
  if (isDiurnoCandidate(candidate)) {
    assertDiurnoExtensionDay(ownDay, HttpsError, DIURNO_OWN_DATE_MESSAGE);
  }

  const openId = idFactory("open", uid);
  const now = serverTimestamp();
  const createdAtISO = nowISO(nowDate);
  // En un dia 24 se entrega el turno BASE; la etiqueta lo refleja.
  const ownTurnLabel = giverTurnLabel(ownDay);
  const ownTurnClassName = giverTurnClassName(ownDay);
  const openData = {
    id: openId,
    workspaceId,
    createdByUid: uid,
    createdByEmail: cleanText(request.auth?.token?.email, 254),
    profileName: profileNameFor(candidate, link),
    ownDate,
    ownTurnLabel,
    ownTurnClassName,
    status: "open",
    source: "worker_app",
    createdAt: now,
    createdAtISO,
    updatedAt: now
  };

  await workspaceRef
    .collection("workerSwapOpenRequests")
    .doc(openId)
    .set(openData);

  return {
    ok: true,
    openId,
    request: clientSafeRequest(openData, createdAtISO)
  };
}

async function respondWorkerSwapRequestHandler(request, dependencies) {
  const {
    db,
    HttpsError,
    serverTimestamp,
    nowDate = () => new Date()
  } = dependencies;
  const { uid, workspaceId } = validateBasePayload(request, HttpsError);
  const requestId = cleanText(request.data?.requestId, 220);
  const status = cleanText(request.data?.status, 60);
  const returnDate = normalizeISODate(request.data?.returnDate);

  if (!requestId) {
    callableError(
      HttpsError,
      "invalid-argument",
      "No fue posible identificar la solicitud de cambio."
    );
  }

  if (!["colleague_accepted", "colleague_rejected"].includes(status)) {
    callableError(
      HttpsError,
      "invalid-argument",
      "La respuesta del cambio de turno no es valida."
    );
  }

  const workspaceRef = db.collection("workspaces").doc(workspaceId);

  await requireActiveWorkerLink(
    workspaceRef,
    uid,
    HttpsError,
    "Tu cuenta ya no esta enlazada con esta unidad."
  );

  const requestRef = workspaceRef
    .collection("workerSwapRequests")
    .doc(requestId);
  let acceptedCandidate = null;
  let acceptedAppData = null;
  let finalStatus = status;

  if (status === "colleague_accepted") {
    [acceptedCandidate, acceptedAppData] = await Promise.all([
      requireActiveCandidate(
        workspaceRef,
        uid,
        HttpsError,
        "Tu calendario de cambios ya no esta disponible."
      ),
      readWorkerAppData(workspaceRef, uid)
    ]);
  }

  await db.runTransaction(async (transaction) => {
    const requestSnap = await transaction.get(requestRef);

    if (!requestSnap.exists) {
      callableError(
        HttpsError,
        "not-found",
        "La solicitud de cambio ya no existe."
      );
    }

    const swap = requestSnap.data() || {};

    if (swap.targetUid !== uid) {
      callableError(
        HttpsError,
        "permission-denied",
        "Solo el trabajador receptor puede responder esta solicitud."
      );
    }

    if (
      swap.source !== "worker_app" ||
      !["swap", "open_swap"].includes(swap.type)
    ) {
      callableError(
        HttpsError,
        "failed-precondition",
        "Esta solicitud de cambio no puede responderse desde la app."
      );
    }

    if (swap.status !== "pending_colleague") {
      callableError(
        HttpsError,
        "failed-precondition",
        "Esta solicitud ya no esta pendiente."
      );
    }

    const isOpenSwap = swap.type === "open_swap";
    const effectiveStatus =
      isOpenSwap && status === "colleague_accepted"
        ? "proposal_sent"
        : status;
    finalStatus = effectiveStatus;
    const now = serverTimestamp();
    const patch = {
      status: effectiveStatus,
      colleagueResponseAt: now,
      notificationStatus:
        status === "colleague_accepted"
          ? (isOpenSwap ? "proposal_sent" : "accepted_by_colleague")
          : "rejected_by_colleague",
      updatedAt: now
    };

      if (status === "colleague_accepted") {
      const changeDate = normalizeISODate(swap.fecha || swap.date);
      const effectiveReturnDate =
        swap.type === "open_swap"
          ? returnDate
          : normalizeISODate(swap.returnDate || swap.devolucion);

      if (!parseISODateParts(changeDate)) {
        callableError(
          HttpsError,
          "failed-precondition",
          "La fecha del turno a cubrir ya no es valida."
        );
      }

      if (!parseISODateParts(effectiveReturnDate)) {
        callableError(
          HttpsError,
          "invalid-argument",
          "Selecciona una fecha valida para devolver el turno."
        );
      }

      if (!sameMonth(changeDate, effectiveReturnDate)) {
        callableError(
          HttpsError,
          "failed-precondition",
          "La devolucion debe pertenecer al mismo mes del cambio."
        );
      }

      let bothDiurno = false;

      if (swap.createdByUid && swap.createdByUid !== uid) {
        const requesterCandidateSnap = await transaction.get(
          workspaceRef.collection("workerSwapCandidates").doc(swap.createdByUid)
        );

        if (!requesterCandidateSnap.exists) {
          callableError(
            HttpsError,
            "failed-precondition",
            "El calendario del trabajador que entrega el turno ya no esta disponible."
          );
        }

        const requesterCandidate = requesterCandidateSnap.data() || {};

        if (!isActiveCandidate(requesterCandidate)) {
          callableError(
            HttpsError,
            "failed-precondition",
            "El trabajador que entrega el turno ya no esta activo."
          );
        }

        assertCompatiblePair(
          requesterCandidate,
          acceptedCandidate,
          swap.createdByUid,
          uid,
          HttpsError
        );

        // Una solicitud creada antes de esta regla tambien la cumple al
        // aceptarse: entre Diurno, Larga por Larga de dia habil.
        bothDiurno =
          isDiurnoCandidate(requesterCandidate) &&
          isDiurnoCandidate(acceptedCandidate);

        if (bothDiurno) {
          assertDiurnoExtensionDay(
            dayFor(requesterCandidate, changeDate),
            HttpsError,
            DIURNO_OWN_DATE_MESSAGE
          );
        }
      }

      assertReceiverCanCoverDate(
        acceptedCandidate,
        changeDate,
        HttpsError,
        {
          giverTurn: swapTurnCodeFromDay({
            label: swap.ownTurnLabel,
            className: swap.ownTurnClassName
          }),
          allowTwentyFour: allowsTwentyFour(acceptedCandidate)
        }
      );

      assertSwapLimitAvailable(
        acceptedAppData,
        effectiveReturnDate,
        HttpsError,
        "Alcanzaste el limite mensual de cambios de turno."
      );

      const returnDay = assertReturnSwapDate(
        acceptedCandidate,
        effectiveReturnDate,
        HttpsError,
        nowDate
      );

      if (bothDiurno) {
        assertDiurnoExtensionDay(
          returnDay,
          HttpsError,
          DIURNO_RETURN_DATE_MESSAGE
        );
      }

      const returnTurnLabel = shiftLabel(returnDay);

      if (isOpenSwap) {
        patch.proposalSentAt = now;
      } else {
        patch.colleagueAcceptedAt = now;
      }
      patch.returnDate = effectiveReturnDate;
      patch.devolucion = effectiveReturnDate;
      patch.returnTurnLabel = returnTurnLabel;
      patch.returnTurnClassName =
        shiftClass(returnDay) || shiftClassFromLabel(returnTurnLabel);
    } else {
      patch.colleagueRejectedAt = now;
      patch.rejectReason = cleanText(request.data?.rejectReason, 1000);
    }

    transaction.set(requestRef, patch, { merge: true });
  });

  return {
    ok: true,
    requestId,
    status: finalStatus
  };
}

async function chooseWorkerSwapProposalHandler(request, dependencies) {
  const {
    db,
    HttpsError,
    serverTimestamp,
    nowISO = defaultNowISO,
    nowDate = () => new Date()
  } = dependencies;
  const { uid, workspaceId } = validateBasePayload(request, HttpsError);
  const requestId = cleanText(request.data?.requestId, 220);

  if (!requestId) {
    callableError(
      HttpsError,
      "invalid-argument",
      "No fue posible identificar la propuesta de cambio."
    );
  }

  const workspaceRef = db.collection("workspaces").doc(workspaceId);

  await requireActiveWorkerLink(
    workspaceRef,
    uid,
    HttpsError,
    "Tu cuenta ya no esta enlazada con esta unidad."
  );

  const requestRef = workspaceRef.collection("workerSwapRequests").doc(requestId);
  let supervisorRequestId = "";
  let groupId = "";

  await db.runTransaction(async (transaction) => {
    const requestSnap = await transaction.get(requestRef);

    if (!requestSnap.exists) {
      callableError(
        HttpsError,
        "not-found",
        "La propuesta de cambio ya no existe."
      );
    }

    const proposal = requestSnap.data() || {};
    groupId = cleanText(proposal.groupId || proposal.openRequestId, 220);

    if (
      proposal.source !== "worker_app" ||
      proposal.type !== "open_swap" ||
      proposal.status !== "proposal_sent"
    ) {
      callableError(
        HttpsError,
        "failed-precondition",
        "Esta propuesta ya no esta disponible."
      );
    }

    if (proposal.createdByUid !== uid) {
      callableError(
        HttpsError,
        "permission-denied",
        "Solo quien creo la solicitud abierta puede elegir la propuesta."
      );
    }

    if (!groupId) {
      callableError(
        HttpsError,
        "failed-precondition",
        "La solicitud abierta asociada ya no es valida."
      );
    }

    const openRef = workspaceRef.collection("workerSwapOpenRequests").doc(groupId);
    const openSnap = await transaction.get(openRef);

    if (!openSnap.exists) {
      callableError(
        HttpsError,
        "not-found",
        "La solicitud abierta ya no existe."
      );
    }

    const openData = openSnap.data() || {};

    if (openData.createdByUid !== uid) {
      callableError(
        HttpsError,
        "permission-denied",
        "Solo quien creo la solicitud abierta puede elegir la propuesta."
      );
    }

    if (
      openData.status === "canceled" ||
      isFinalSwapStatus(openData.status) ||
      openData.winnerRequestId
    ) {
      callableError(
        HttpsError,
        "failed-precondition",
        "Esta solicitud abierta ya fue resuelta."
      );
    }

    const changeDate = normalizeISODate(proposal.fecha || proposal.date);
    const returnDate = normalizeISODate(proposal.returnDate || proposal.devolucion);

    if (!parseISODateParts(changeDate) || !parseISODateParts(returnDate)) {
      callableError(
        HttpsError,
        "failed-precondition",
        "La propuesta no tiene fechas validas."
      );
    }

    supervisorRequestId = proposal.supervisorRequestId || `swap_${requestId}`;
    const supervisorRequestRef = workspaceRef
      .collection("workerRequests")
      .doc(supervisorRequestId);
    const now = serverTimestamp();

    transaction.set(openRef, {
      winnerRequestId: requestId,
      winnerUid: proposal.targetUid || "",
      supervisorRequestId,
      status: "assigned",
      assignedAt: now,
      originAcceptedAt: now,
      updatedAt: now
    }, { merge: true });
    transaction.set(supervisorRequestRef, {
      id: supervisorRequestId,
      type: "swap",
      title: "Cambio de turno (abierto)",
      profile: proposal.from || "",
      from: proposal.from || "",
      to: proposal.to || "",
      targetProfile: proposal.to || "",
      targetUid: proposal.targetUid || "",
      createdByUid: proposal.createdByUid || "",
      createdByEmail: proposal.createdByEmail || "",
      source: "worker_app",
      status: "pending",
      date: changeDate,
      fecha: changeDate,
      returnDate,
      devolucion: returnDate,
      ownTurnLabel: proposal.ownTurnLabel || "",
      returnTurnLabel: proposal.returnTurnLabel || "",
      detail: proposal.detail || "",
      swapRequestId: requestId,
      openRequestId: groupId,
      colleagueAcceptedAt: now,
      originAcceptedAt: now,
      createdAt: nowISO(nowDate),
      updatedAt: now
    }, { merge: true });
    transaction.set(requestRef, {
      status: "pending_supervisor",
      supervisorRequestId,
      originAcceptedAt: now,
      supervisorSubmittedAt: now,
      updatedAt: now
    }, { merge: true });
  });

  return {
    ok: true,
    requestId,
    openRequestId: groupId,
    supervisorRequestId,
    status: "pending_supervisor"
  };
}

function formatDateCL(value) {
  const date = normalizeISODate(value);
  const [year, month, day] = date.split("-");

  return day && month && year ? `${day}-${month}-${year}` : value;
}

module.exports = {
  chooseWorkerSwapProposalHandler,
  createWorkerSwapOpenRequestHandler,
  createWorkerSwapRequestHandler,
  respondWorkerSwapRequestHandler,
  _private: {
    isFreeTurnDay,
    isSwapTurnDay,
    normalizeISODate,
    parseISODateParts,
    sameMonth
  }
};
