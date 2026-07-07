"use strict";

const { randomBytes } = require("node:crypto");

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

function isFreeTurnDay(day) {
  if (!day || day.hasLeave === true) return false;

  const label = normalizeTextKey(shiftLabel(day));
  const className = shiftClass(day);

  return label === "libre" || className === "libre";
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

  if (!isSwapTurnDay(day)) {
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

function assertReceiverCanCoverDate(candidate, iso, HttpsError) {
  const day = dayFor(candidate, iso);

  if (!isFreeTurnDay(day)) {
    callableError(
      HttpsError,
      "failed-precondition",
      "El trabajador seleccionado ya no esta libre para recibir ese turno."
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

function assertReturnSwapDate(candidate, iso, HttpsError, nowDate) {
  const day = dayFor(candidate, iso);

  if (isPastISODate(iso, nowDate)) {
    callableError(
      HttpsError,
      "failed-precondition",
      "La fecha de devolucion debe ser actual o futura."
    );
  }

  if (!isSwapTurnDay(day)) {
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

function validateSwapDates({ ownDate, returnDate, HttpsError }) {
  if (!parseISODateParts(ownDate) || !parseISODateParts(returnDate)) {
    callableError(
      HttpsError,
      "invalid-argument",
      "Las fechas del cambio de turno no son validas."
    );
  }

  if (ownDate === returnDate) {
    callableError(
      HttpsError,
      "failed-precondition",
      "La fecha de cambio y devolucion deben ser distintas."
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
  assertReceiverCanCoverDate(targetCandidate, ownDate, HttpsError);
  const returnDay = assertReturnSwapDate(
    targetCandidate,
    returnDate,
    HttpsError,
    nowDate
  );
  const requestId = idFactory("swap", uid);
  const createdAt = nowISO(nowDate);
  const now = serverTimestamp();
  const fromProfile = profileNameFor(requesterCandidate, requesterLink);
  const toProfile = profileNameFor(targetCandidate, targetLink);
  const ownTurnLabel = shiftLabel(ownDay);
  const returnTurnLabel = shiftLabel(returnDay);
  const ownTurnClassName =
    shiftClass(ownDay) || shiftClassFromLabel(ownTurnLabel);
  const returnTurnClassName =
    shiftClass(returnDay) || shiftClassFromLabel(returnTurnLabel);
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
  const openId = idFactory("open", uid);
  const now = serverTimestamp();
  const createdAtISO = nowISO(nowDate);
  const ownTurnLabel = shiftLabel(ownDay);
  const ownTurnClassName =
    shiftClass(ownDay) || shiftClassFromLabel(ownTurnLabel);
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

    const now = serverTimestamp();
    const patch = {
      status,
      colleagueResponseAt: now,
      notificationStatus:
        status === "colleague_accepted"
          ? "accepted_by_colleague"
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
      }

      assertReceiverCanCoverDate(
        acceptedCandidate,
        changeDate,
        HttpsError
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
      const returnTurnLabel = shiftLabel(returnDay);

      patch.colleagueAcceptedAt = now;
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
    status
  };
}

function formatDateCL(value) {
  const date = normalizeISODate(value);
  const [year, month, day] = date.split("-");

  return day && month && year ? `${day}-${month}-${year}` : value;
}

module.exports = {
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
