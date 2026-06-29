const admin = require("firebase-admin");
const { createHash, randomBytes } = require("node:crypto");
const logger = require("firebase-functions/logger");
const { setGlobalOptions } = require("firebase-functions/v2");
const {
  onDocumentCreated,
  onDocumentUpdated
} = require("firebase-functions/v2/firestore");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const {
  defineSecret,
  defineString
} = require("firebase-functions/params");
const {
  isFinalSwapStatus
} = require("./swapCancellation");
const { cancelWorkerSwapHandler } = require("./workerSwapCancellation");

// API key de Resend. Configurar con: firebase functions:secrets:set RESEND_API_KEY
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
// Remitente verificado en Resend. Para produccion, verificar un dominio propio
// y usar algo como "TurnoPlus <noreply@tudominio.cl>". Configurable en
// functions/.env (MAIL_FROM=...). Por defecto usa el remitente de pruebas de
// Resend, que solo entrega a la propia cuenta del API key.
const MAIL_FROM = defineString("MAIL_FROM", {
  default: "TurnoPlus <onboarding@resend.dev>"
});
// TurnoPlus y la PWA están registrados con reCAPTCHA Enterprise.
// Las funciones de préstamos entre unidades siempre exigen App Check.
const ENFORCE_APP_CHECK = true;
// TOTP queda preparado para una etapa futura, pero no se exige por ahora.
// Cambiar a true cuando se quiera reactivar MFA obligatorio para propietarios
// y supervisores con permisos de edicion.
const REQUIRE_PRIVILEGED_MFA = false;
// Flujo preparado para centros que pidan doble chequeo por correo en la PWA.
// En etapa comercial queda apagado: el correo de invitacion lleva directamente
// al token de enlace y la PWA no debe mandar un segundo correo passwordless.
const WORKER_PASSWORDLESS_INVITE_EMAIL_ENABLED = false;

admin.initializeApp();
setGlobalOptions({
  region: "southamerica-west1",
  // Evita que una ráfaga de eventos dispare instancias sin límite y eleve
  // innecesariamente el costo o el impacto de un abuso.
  maxInstances: 10
});

const db = admin.firestore();
const WORKER_APP_BASE_URL = "https://turnoplusfuncionarios.web.app/";
const DEFAULT_MAIL_FROM = "TurnoPlus <onboarding@resend.dev>";
const APP_URL = `${WORKER_APP_BASE_URL}?screen=solicitudes`;
const SWAPS_APP_URL = `${WORKER_APP_BASE_URL}?screen=cambios`;
const APP_ICON = `${WORKER_APP_BASE_URL}img/logo-turnoplus.png`;
const APP_BADGE = `${WORKER_APP_BASE_URL}img/favicon-turnoplus-calendar.png`;
const INVALID_TOKEN_CODES = new Set([
  "messaging/invalid-argument",
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered"
]);
const VALID_INTER_UNIT_TURNS = new Set([
  "L",
  "N",
  "24",
  "D",
  "D+N",
  "HM",
  "HT",
  "18"
]);
const SUPERVISOR_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MENU_PERMISSION_KEYS = [
  "turnos",
  "weekly",
  "tasks",
  "kanban",
  "agenda",
  "profile",
  "clockmarks",
  "requests",
  "memos",
  "swap",
  "hours",
  "reports",
  "dashboard",
  "log"
];

function cleanCallableText(value, maxLength = 160) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanManifestParam(value, pattern, maxLength) {
  const clean = String(value || "").trim().slice(0, maxLength);
  return pattern.test(clean) ? clean : "";
}

function normalizeSupervisorPermissions(input = {}) {
  return MENU_PERMISSION_KEYS.reduce((permissions, key) => {
    const raw = input && typeof input === "object" ? input[key] || {} : {};
    const view = raw.view === true;

    permissions[key] = {
      view,
      edit: view && raw.edit === true
    };

    return permissions;
  }, {});
}

function hasAnyPermission(permissions = {}) {
  return MENU_PERMISSION_KEYS.some(key =>
    permissions[key]?.view === true || permissions[key]?.edit === true
  );
}

function createSupervisorInviteToken() {
  return randomBytes(32).toString("base64url");
}

function supervisorInviteIdFromToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function validISODate(value) {
  const text = String(value || "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;

  const date = new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === text;
}

function turnCodeToState(code) {
  return {
    L: 1,
    N: 2,
    "24": 3,
    D: 4,
    "D+N": 5,
    HM: 6,
    HT: 7,
    "18": 8
  }[code] || 0;
}

function canCoverInterUnitShift(currentState, turnCode, allow24) {
  const neededState = turnCodeToState(turnCode);
  const current = Number(currentState) || 0;

  if (!neededState) return false;
  if (current === 0) return true;

  return allow24 !== false &&
    (
      (current === 1 && neededState === 2) ||
      (current === 2 && neededState === 1)
    );
}

function memberCanManageRequests(member = {}) {
  const permissions = member.permissions || {};

  return member.role === "owner" ||
    permissions.requests?.edit === true ||
    permissions.turnos?.edit === true;
}

function memberRequiresMfa(member = {}) {
  const permissions = member.permissions || {};

  return member.role === "owner" ||
    Object.values(permissions).some(permission =>
      permission?.edit === true
    );
}

function tokenHasMfa(token = {}) {
  return Boolean(token.firebase?.sign_in_second_factor);
}

function requireMemberMfa(member, token) {
  if (
    REQUIRE_PRIVILEGED_MFA &&
    memberRequiresMfa(member) &&
    !tokenHasMfa(token)
  ) {
    throw new HttpsError(
      "permission-denied",
      "Los propietarios y supervisores deben validar TOTP para continuar."
    );
  }
}

async function requireWorkspaceRequestManager(
  workspaceId,
  uid,
  token
) {
  const memberSnap = await db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("members")
    .doc(uid)
    .get();

  if (!memberSnap.exists || !memberCanManageRequests(memberSnap.data())) {
    throw new HttpsError(
      "permission-denied",
      "No tienes permisos para gestionar prestamos en esta unidad."
    );
  }

  const member = memberSnap.data();

  requireMemberMfa(member, token);
  return member;
}

async function requireWorkspaceMember(workspaceId, uid, token) {
  const memberSnap = await db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("members")
    .doc(uid)
    .get();

  if (!memberSnap.exists) {
    throw new HttpsError(
      "permission-denied",
      "No perteneces a la unidad solicitante."
    );
  }

  const member = memberSnap.data();

  requireMemberMfa(member, token);
  return member;
}

async function requireWorkspaceOwner(workspaceId, uid, token) {
  const member = await requireWorkspaceMember(workspaceId, uid, token);

  if (member.role !== "owner") {
    throw new HttpsError(
      "permission-denied",
      "Solo el propietario puede administrar invitaciones de supervisor."
    );
  }

  return member;
}

async function requireAcceptedWorkspaceLink(
  linkId,
  sourceWorkspaceId,
  hostWorkspaceId
) {
  const linkSnap = await db.collection("workspaceLinks").doc(linkId).get();
  const link = linkSnap.data() || {};
  const matchesPair =
    (
      link.fromWorkspaceId === sourceWorkspaceId &&
      link.toWorkspaceId === hostWorkspaceId
    ) ||
    (
      link.fromWorkspaceId === hostWorkspaceId &&
      link.toWorkspaceId === sourceWorkspaceId
    );

  if (!linkSnap.exists || link.status !== "accepted" || !matchesPair) {
    throw new HttpsError(
      "failed-precondition",
      "El enlace entre unidades no esta activo."
    );
  }

  return link;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function maskedEmail(value) {
  const [local = "", domain = ""] = normalizeEmail(value).split("@");
  if (!domain) return "correo-invalido";

  return `${local.slice(0, 2)}***@${domain}`;
}

function safeMailFrom() {
  const value = String(MAIL_FROM.value() || DEFAULT_MAIL_FROM).trim();

  return value && !/[\r\n]/.test(value)
    ? value.slice(0, 320)
    : DEFAULT_MAIL_FROM;
}

function workerInviteUrl(workspaceId, token, email) {
  const url = new URL(WORKER_APP_BASE_URL);

  url.searchParams.set("workspace", workspaceId);
  url.searchParams.set("invite", token);
  if (email) url.searchParams.set("email", email);

  return url.toString();
}

async function reserveInviteEmailSend(senderUid, email) {
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  const senderRef = db.collection("securityRateLimits").doc(
    `invite_sender_${senderUid}`
  );
  const recipientHash = createHash("sha256")
    .update(email)
    .digest("hex")
    .slice(0, 40);
  const recipientRef = db.collection("securityRateLimits").doc(
    `invite_recipient_${recipientHash}`
  );

  return db.runTransaction(async transaction => {
    const [senderSnap, recipientSnap] = await Promise.all([
      transaction.get(senderRef),
      transaction.get(recipientRef)
    ]);
    const sender = senderSnap.data() || {};
    const recipient = recipientSnap.data() || {};
    const windowStartedAt = Number(sender.windowStartedAtMs) || now;
    const withinWindow = now - windowStartedAt < hourMs;
    const count = withinWindow ? Number(sender.count) || 0 : 0;
    const recipientLastSentAt = Number(recipient.lastSentAtMs) || 0;

    if (count >= 100 || now - recipientLastSentAt < 60 * 1000) {
      return false;
    }

    transaction.set(senderRef, {
      windowStartedAtMs: withinWindow ? windowStartedAt : now,
      count: count + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.set(recipientRef, {
      lastSentAtMs: now,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return true;
  });
}

exports.sendWorkerAppInviteEmail = onDocumentCreated(
  {
    document: "workspaces/{workspaceId}/workerAppInvites/{token}",
    secrets: [RESEND_API_KEY]
  },
  async (event) => {
    const invite = event.data?.data() || {};
    const { workspaceId, token } = event.params;
    const email = normalizeEmail(invite.email);
    const senderUid = String(invite.createdByUid || "").trim();

    if (
      invite.status !== "pending" ||
      !isValidEmail(email) ||
      !senderUid ||
      invite.workspaceId !== workspaceId ||
      invite.token !== token
    ) {
      await event.data?.ref.set(
        { emailStatus: "skipped_invalid_invite" },
        { merge: true }
      );
      return;
    }

    if (!await reserveInviteEmailSend(senderUid, email)) {
      logger.warn("Invitacion omitida por limite de envio.", {
        senderUid,
        recipient: maskedEmail(email)
      });
      await event.data.ref.set(
        { emailStatus: "rate_limited" },
        { merge: true }
      );
      return;
    }

    const apiKey = RESEND_API_KEY.value();

    if (!apiKey) {
      logger.warn("RESEND_API_KEY no configurada; no se envia el correo.");
      await event.data.ref.set(
        { emailStatus: "skipped_no_api_key" },
        { merge: true }
      );
      return;
    }

    const workerName =
      String(invite.profileName || "trabajador").trim().slice(0, 160);
    const unit =
      String(invite.workspaceName || "TurnoPlus").trim().slice(0, 160);
    // Nunca se confia en enlaces almacenados por el cliente: se reconstruyen
    // con el dominio oficial para impedir correos de phishing desde Firestore.
    const inviteUrl = workerInviteUrl(workspaceId, token, email);
    const installUrl = WORKER_APP_BASE_URL;

    // El boton del correo usa siempre el enlace directo de invitacion.
    // El enlace passwordless queda preparado, pero apagado por defecto para
    // evitar un segundo correo durante la etapa comercial.
    const isGoogleEmail = /@(?:gmail|googlemail)\.com$/i.test(email);
    let ctaUrl = inviteUrl;

    if (
      WORKER_PASSWORDLESS_INVITE_EMAIL_ENABLED &&
      !isGoogleEmail &&
      inviteUrl
    ) {
      try {
        ctaUrl = await admin.auth().generateSignInWithEmailLink(email, {
          url: inviteUrl,
          handleCodeInApp: true
        });
      } catch (linkError) {
        logger.warn(
          "No se pudo generar enlace de ingreso; se usa el enlace normal.",
          { email, message: linkError.message }
        );
        ctaUrl = inviteUrl;
      }
    }

    const { html, text } = buildInviteEmail({
      workerName,
      unit,
      ctaUrl,
      installUrl,
      isGoogleEmail
    });

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: safeMailFrom(),
          to: [email],
          subject: "Invitacion a TurnoPlus Trabajador",
          html,
          text
        })
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Resend ${response.status}: ${detail}`);
      }

      const result = await response.json().catch(() => ({}));

      await event.data.ref.set(
        {
          emailStatus: "sent",
          emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
          emailProviderId: result?.id || "",
          emailError: ""
        },
        { merge: true }
      );

      logger.info("Correo de invitacion enviado.", {
        recipient: maskedEmail(email),
        id: result?.id || ""
      });
    } catch (error) {
      logger.error("No se pudo enviar correo de invitacion.", {
        recipient: maskedEmail(email),
        message: error.message
      });
      await event.data.ref.set(
        {
          emailStatus: "error",
          emailError: String(error.message || error).slice(0, 500)
        },
        { merge: true }
      );
    }
  }
);

exports.createSupervisorInvite = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para crear una invitacion."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);
    const permissions =
      normalizeSupervisorPermissions(request.data?.permissions || {});

    if (!workspaceId) {
      throw new HttpsError(
        "invalid-argument",
        "Falta identificar la unidad."
      );
    }

    if (!hasAnyPermission(permissions)) {
      throw new HttpsError(
        "invalid-argument",
        "La invitacion debe incluir al menos un permiso visible."
      );
    }

    await requireWorkspaceOwner(workspaceId, uid, request.auth.token || {});

    const workspaceRef = db.collection("workspaces").doc(workspaceId);
    const workspaceSnap = await workspaceRef.get();

    if (!workspaceSnap.exists) {
      throw new HttpsError(
        "not-found",
        "La unidad no existe."
      );
    }

    const token = createSupervisorInviteToken();
    const inviteId = supervisorInviteIdFromToken(token);
    const now = admin.firestore.Timestamp.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(
      Date.now() + SUPERVISOR_INVITE_TTL_MS
    );
    const workspace = workspaceSnap.data() || {};

    await workspaceRef
      .collection("supervisorInvites")
      .doc(inviteId)
      .set({
        workspaceId,
        workspaceName: cleanCallableText(workspace.name, 160),
        tokenHash: inviteId,
        status: "open",
        permissions,
        createdAt: now,
        createdByUid: uid,
        createdByEmail: cleanCallableText(request.auth.token?.email, 254),
        createdByName: cleanCallableText(request.auth.token?.name, 160),
        expiresAt,
        updatedAt: now
      });

    return {
      inviteId,
      token,
      workspaceId,
      workspaceName: cleanCallableText(workspace.name, 160),
      expiresAt: expiresAt.toMillis(),
      permissions
    };
  }
);

exports.claimSupervisorInvite = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para solicitar acceso."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);
    const token = cleanCallableText(request.data?.token, 200);

    if (!workspaceId || !token) {
      throw new HttpsError(
        "invalid-argument",
        "La invitacion no esta completa."
      );
    }

    const inviteId = supervisorInviteIdFromToken(token);
    const workspaceRef = db.collection("workspaces").doc(workspaceId);
    const inviteRef =
      workspaceRef.collection("supervisorInvites").doc(inviteId);
    const result = await db.runTransaction(async transaction => {
      const workspaceSnap = await transaction.get(workspaceRef);
      const inviteSnap = await transaction.get(inviteRef);

      if (!workspaceSnap.exists || !inviteSnap.exists) {
        throw new HttpsError(
          "not-found",
          "La invitacion no existe o ya no esta disponible."
        );
      }

      const invite = inviteSnap.data() || {};
      const workspace = workspaceSnap.data() || {};
      const now = admin.firestore.Timestamp.now();
      const expiresAtMs = invite.expiresAt?.toMillis
        ? invite.expiresAt.toMillis()
        : 0;

      if (invite.workspaceId !== workspaceId || invite.tokenHash !== inviteId) {
        throw new HttpsError(
          "permission-denied",
          "La invitacion no corresponde a esta unidad."
        );
      }

      if (invite.status === "claimed" && invite.claimedByUid === uid) {
        return {
          status: "claimed",
          inviteId,
          workspaceId,
          workspaceName:
            cleanCallableText(invite.workspaceName || workspace.name, 160)
        };
      }

      if (invite.status !== "open") {
        throw new HttpsError(
          "failed-precondition",
          "Esta invitacion ya fue utilizada o cerrada."
        );
      }

      if (!expiresAtMs || expiresAtMs <= Date.now()) {
        transaction.update(inviteRef, {
          status: "expired",
          expiredAt: now,
          updatedAt: now
        });

        return {
          status: "expired",
          inviteId,
          workspaceId,
          workspaceName:
            cleanCallableText(invite.workspaceName || workspace.name, 160)
        };
      }

      transaction.update(inviteRef, {
        status: "claimed",
        claimedAt: now,
        claimedByUid: uid,
        claimedByEmail: cleanCallableText(request.auth.token?.email, 254),
        claimedByName: cleanCallableText(request.auth.token?.name, 160),
        updatedAt: now
      });

      return {
        status: "claimed",
        inviteId,
        workspaceId,
        workspaceName:
          cleanCallableText(invite.workspaceName || workspace.name, 160)
      };
    });

    if (result.status === "expired") {
      throw new HttpsError(
        "failed-precondition",
        "Esta invitacion vencio. Solicita una nueva al propietario."
      );
    }

    return result;
  }
);

exports.approveSupervisorInvite = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para aprobar una invitacion."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);
    const inviteId = cleanCallableText(request.data?.inviteId, 100);
    const overrideProvided =
      request.data &&
      Object.prototype.hasOwnProperty.call(
        request.data,
        "permissionsOverride"
      );

    if (!workspaceId || !inviteId) {
      throw new HttpsError(
        "invalid-argument",
        "Falta identificar la invitacion."
      );
    }

    await requireWorkspaceOwner(workspaceId, uid, request.auth.token || {});

    return db.runTransaction(async transaction => {
      const workspaceRef = db.collection("workspaces").doc(workspaceId);
      const inviteRef =
        workspaceRef.collection("supervisorInvites").doc(inviteId);
      const workspaceSnap = await transaction.get(workspaceRef);
      const inviteSnap = await transaction.get(inviteRef);

      if (!workspaceSnap.exists || !inviteSnap.exists) {
        throw new HttpsError(
          "not-found",
          "La solicitud de invitacion no existe."
        );
      }

      const workspace = workspaceSnap.data() || {};
      const invite = inviteSnap.data() || {};

      if (invite.workspaceId !== workspaceId || invite.status !== "claimed") {
        throw new HttpsError(
          "failed-precondition",
          "Solo se pueden aprobar invitaciones reclamadas y pendientes."
        );
      }

      const memberUid = cleanCallableText(invite.claimedByUid, 160);
      const permissions = normalizeSupervisorPermissions(
        overrideProvided
          ? request.data.permissionsOverride || {}
          : invite.permissions || {}
      );

      if (!memberUid) {
        throw new HttpsError(
          "failed-precondition",
          "La invitacion no tiene usuario solicitante."
        );
      }

      if (!hasAnyPermission(permissions)) {
        throw new HttpsError(
          "invalid-argument",
          "La aprobacion debe incluir al menos un permiso visible."
        );
      }

      const memberRef =
        workspaceRef.collection("members").doc(memberUid);
      const memberSnap = await transaction.get(memberRef);

      if (memberSnap.exists) {
        throw new HttpsError(
          "already-exists",
          "Este usuario ya tiene acceso a la unidad."
        );
      }

      const now = admin.firestore.Timestamp.now();
      const workspaceName = cleanCallableText(workspace.name, 160);

      transaction.set(memberRef, {
        role: "member",
        email: cleanCallableText(invite.claimedByEmail, 254),
        displayName: cleanCallableText(invite.claimedByName, 160),
        permissions,
        supervisorInviteId: inviteId,
        joinedAt: now,
        approvedAt: now,
        approvedByUid: uid,
        permissionsUpdatedAt: now
      });
      transaction.set(
        db.collection("users")
          .doc(memberUid)
          .collection("workspaces")
          .doc(workspaceId),
        {
          name: workspaceName || workspaceId,
          role: "member",
          joinedAt: now
        },
        { merge: true }
      );
      transaction.update(inviteRef, {
        status: "approved",
        approvedAt: now,
        approvedByUid: uid,
        approvedByEmail: cleanCallableText(request.auth.token?.email, 254),
        approvedByName: cleanCallableText(request.auth.token?.name, 160),
        finalPermissions: permissions,
        updatedAt: now
      });

      return {
        status: "approved",
        inviteId,
        workspaceId,
        memberUid,
        permissions
      };
    });
  }
);

exports.rejectSupervisorInvite = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para rechazar una invitacion."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);
    const inviteId = cleanCallableText(request.data?.inviteId, 100);
    const reason = cleanCallableText(request.data?.reason, 500);

    if (!workspaceId || !inviteId) {
      throw new HttpsError(
        "invalid-argument",
        "Falta identificar la invitacion."
      );
    }

    await requireWorkspaceOwner(workspaceId, uid, request.auth.token || {});

    const inviteRef = db
      .collection("workspaces")
      .doc(workspaceId)
      .collection("supervisorInvites")
      .doc(inviteId);
    const now = admin.firestore.Timestamp.now();

    await db.runTransaction(async transaction => {
      const inviteSnap = await transaction.get(inviteRef);
      const invite = inviteSnap.data() || {};

      if (!inviteSnap.exists || invite.workspaceId !== workspaceId) {
        throw new HttpsError(
          "not-found",
          "La solicitud de invitacion no existe."
        );
      }

      if (invite.status !== "claimed") {
        throw new HttpsError(
          "failed-precondition",
          "Solo se pueden rechazar solicitudes pendientes."
        );
      }

      transaction.update(inviteRef, {
        status: "rejected",
        rejectedAt: now,
        rejectedByUid: uid,
        rejectedByEmail: cleanCallableText(request.auth.token?.email, 254),
        rejectedByName: cleanCallableText(request.auth.token?.name, 160),
        rejectReason: reason,
        updatedAt: now
      });
    });

    return {
      status: "rejected",
      inviteId,
      workspaceId
    };
  }
);

exports.revokeSupervisorInvite = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para revocar una invitacion."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);
    const inviteId = cleanCallableText(request.data?.inviteId, 100);

    if (!workspaceId || !inviteId) {
      throw new HttpsError(
        "invalid-argument",
        "Falta identificar la invitacion."
      );
    }

    await requireWorkspaceOwner(workspaceId, uid, request.auth.token || {});

    const inviteRef = db
      .collection("workspaces")
      .doc(workspaceId)
      .collection("supervisorInvites")
      .doc(inviteId);
    const now = admin.firestore.Timestamp.now();

    await db.runTransaction(async transaction => {
      const inviteSnap = await transaction.get(inviteRef);
      const invite = inviteSnap.data() || {};

      if (!inviteSnap.exists || invite.workspaceId !== workspaceId) {
        throw new HttpsError(
          "not-found",
          "La invitacion no existe."
        );
      }

      if (!["open", "claimed"].includes(invite.status)) {
        throw new HttpsError(
          "failed-precondition",
          "Esta invitacion ya esta cerrada."
        );
      }

      transaction.update(inviteRef, {
        status: "revoked",
        revokedAt: now,
        revokedByUid: uid,
        revokedByEmail: cleanCallableText(request.auth.token?.email, 254),
        revokedByName: cleanCallableText(request.auth.token?.name, 160),
        updatedAt: now
      });
    });

    return {
      status: "revoked",
      inviteId,
      workspaceId
    };
  }
);

exports.createInterUnitLoan = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para registrar un prestamo."
      );
    }

    const data = request.data || {};
    const linkId = cleanCallableText(data.linkId, 220);
    const sourceWorkspaceId =
      cleanCallableText(data.sourceWorkspaceId, 160);
    const hostWorkspaceId =
      cleanCallableText(data.hostWorkspaceId, 160);
    const workerProfileId =
      cleanCallableText(data.workerProfileId, 120);
    const replacedProfileId =
      cleanCallableText(data.replacedProfileId, 120);
    const replacedProfileName =
      cleanCallableText(data.replacedProfileName, 160);
    const date = cleanCallableText(data.date, 10);
    const turnCode = cleanCallableText(data.turnCode, 8);
    const absenceType = cleanCallableText(data.absenceType, 160);

    if (
      !linkId ||
      !sourceWorkspaceId ||
      !hostWorkspaceId ||
      sourceWorkspaceId === hostWorkspaceId ||
      !workerProfileId ||
      !replacedProfileName ||
      !validISODate(date) ||
      !VALID_INTER_UNIT_TURNS.has(turnCode)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Los datos del prestamo no son validos."
      );
    }

    await Promise.all([
      requireWorkspaceRequestManager(
        hostWorkspaceId,
        uid,
        request.auth.token
      ),
      requireAcceptedWorkspaceLink(
        linkId,
        sourceWorkspaceId,
        hostWorkspaceId
      )
    ]);

    const month = date.slice(0, 7);
    const staffingRef = db
      .collection("workspaces")
      .doc(sourceWorkspaceId)
      .collection("linkedStaffingMonths")
      .doc(month);
    const [staffingSnap, sourceWorkspaceSnap, hostWorkspaceSnap] =
      await Promise.all([
        staffingRef.get(),
        db.collection("workspaces").doc(sourceWorkspaceId).get(),
        db.collection("workspaces").doc(hostWorkspaceId).get()
      ]);

    if (
      !staffingSnap.exists ||
      !sourceWorkspaceSnap.exists ||
      !hostWorkspaceSnap.exists
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Una de las unidades aun no tiene disponibilidad publicada."
      );
    }

    const staffing = staffingSnap.data() || {};
    const worker = Array.isArray(staffing.workers)
      ? staffing.workers.find(item =>
        cleanCallableText(item?.id, 120) === workerProfileId
      )
      : null;
    const day = worker?.days?.[date] || null;

    if (
      !worker ||
      day?.available !== true ||
      !canCoverInterUnitShift(
        day.turn,
        turnCode,
        staffing.allowTwentyFourHourShifts
      )
    ) {
      throw new HttpsError(
        "failed-precondition",
        "El trabajador ya no esta disponible para ese turno."
      );
    }

    const loanId = `loan_${createHash("sha256")
      .update(`${sourceWorkspaceId}|${workerProfileId}|${date}`)
      .digest("hex")
      .slice(0, 32)}`;
    const sourceAssignmentRef = db
      .collection("workspaces")
      .doc(sourceWorkspaceId)
      .collection("loanAssignments")
      .doc(loanId);
    const hostAssignmentRef = db
      .collection("workspaces")
      .doc(hostWorkspaceId)
      .collection("loanAssignments")
      .doc(loanId);
    const sourceWorkspace = sourceWorkspaceSnap.data() || {};
    const hostWorkspace = hostWorkspaceSnap.data() || {};
    const createdAtISO = new Date().toISOString();

    await db.runTransaction(async transaction => {
      const sourceAssignmentSnap =
        await transaction.get(sourceAssignmentRef);
      const currentAssignment = sourceAssignmentSnap.data() || {};

      if (
        sourceAssignmentSnap.exists &&
        currentAssignment.status === "active"
      ) {
        throw new HttpsError(
          "already-exists",
          "El trabajador ya tiene un prestamo activo en esa fecha."
        );
      }

      const assignment = {
        loanId,
        linkId,
        status: "active",
        sourceWorkspaceId,
        sourceWorkspaceName:
          cleanCallableText(sourceWorkspace.name, 160),
        hostWorkspaceId,
        hostWorkspaceName:
          cleanCallableText(hostWorkspace.name, 160),
        workerProfileId,
        workerName: cleanCallableText(worker.name, 160),
        workerEstamento: cleanCallableText(worker.estamento, 100),
        workerProfession: cleanCallableText(worker.profession, 160),
        replacedProfileId,
        replacedProfileName,
        date,
        turnCode,
        absenceType,
        createdByUid: uid,
        createdByName: cleanCallableText(
          request.auth.token.name ||
          request.auth.token.email ||
          "Supervisor",
          160
        ),
        createdAtISO,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      transaction.set(sourceAssignmentRef, {
        ...assignment,
        workspaceRole: "source"
      });
      transaction.set(hostAssignmentRef, {
        ...assignment,
        workspaceRole: "host"
      });
    });

    logger.info("Prestamo entre unidades creado.", {
      loanId,
      sourceWorkspaceId,
      hostWorkspaceId,
      createdByUid: uid
    });

    return {
      ok: true,
      loanId,
      workerName: cleanCallableText(worker.name, 160)
    };
  }
);

exports.getLinkedStaffingMonth = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para consultar unidades enlazadas."
      );
    }

    const data = request.data || {};
    const linkId = cleanCallableText(data.linkId, 220);
    const sourceWorkspaceId =
      cleanCallableText(data.sourceWorkspaceId, 160);
    const requesterWorkspaceId =
      cleanCallableText(data.requesterWorkspaceId, 160);
    const month = cleanCallableText(data.month, 7);

    if (
      !linkId ||
      !sourceWorkspaceId ||
      !requesterWorkspaceId ||
      sourceWorkspaceId === requesterWorkspaceId ||
      !/^\d{4}-\d{2}$/.test(month)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "La consulta de disponibilidad no es valida."
      );
    }

    await Promise.all([
      requireWorkspaceMember(
        requesterWorkspaceId,
        uid,
        request.auth.token
      ),
      requireAcceptedWorkspaceLink(
        linkId,
        sourceWorkspaceId,
        requesterWorkspaceId
      )
    ]);

    const staffingSnap = await db
      .collection("workspaces")
      .doc(sourceWorkspaceId)
      .collection("linkedStaffingMonths")
      .doc(month)
      .get();

    if (!staffingSnap.exists) {
      return { exists: false, month };
    }

    const staffing = staffingSnap.data() || {};

    return {
      exists: true,
      month,
      workspaceId: sourceWorkspaceId,
      workspaceName: cleanCallableText(
        staffing.workspaceName,
        160
      ),
      allowTwentyFourHourShifts:
        staffing.allowTwentyFourHourShifts !== false,
      workers: Array.isArray(staffing.workers)
        ? staffing.workers
        : [],
      updatedAtISO: cleanCallableText(
        staffing.updatedAtISO,
        40
      )
    };
  }
);

exports.cancelInterUnitLoan = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para anular un prestamo."
      );
    }

    const loanId = cleanCallableText(request.data?.loanId, 160);
    const workspaceId =
      cleanCallableText(request.data?.workspaceId, 160);

    if (!loanId || !workspaceId) {
      throw new HttpsError(
        "invalid-argument",
        "Falta identificar el prestamo."
      );
    }

    await requireWorkspaceRequestManager(
      workspaceId,
      uid,
      request.auth.token
    );

    const localRef = db
      .collection("workspaces")
      .doc(workspaceId)
      .collection("loanAssignments")
      .doc(loanId);
    const localSnap = await localRef.get();
    const assignment = localSnap.data() || {};

    if (!localSnap.exists) {
      throw new HttpsError(
        "not-found",
        "El prestamo ya no existe."
      );
    }

    if (
      workspaceId !== assignment.sourceWorkspaceId &&
      workspaceId !== assignment.hostWorkspaceId
    ) {
      throw new HttpsError(
        "permission-denied",
        "El prestamo no pertenece a esta unidad."
      );
    }

    const sourceRef = db
      .collection("workspaces")
      .doc(assignment.sourceWorkspaceId)
      .collection("loanAssignments")
      .doc(loanId);
    const hostRef = db
      .collection("workspaces")
      .doc(assignment.hostWorkspaceId)
      .collection("loanAssignments")
      .doc(loanId);
    const canceledAtISO = new Date().toISOString();

    await db.runTransaction(async transaction => {
      const [sourceSnap, hostSnap] = await Promise.all([
        transaction.get(sourceRef),
        transaction.get(hostRef)
      ]);

      if (!sourceSnap.exists && !hostSnap.exists) {
        throw new HttpsError(
          "not-found",
          "El prestamo ya no existe."
        );
      }

      const cancellation = {
        status: "canceled",
        canceledByUid: uid,
        canceledByName: cleanCallableText(
          request.auth.token.name ||
          request.auth.token.email ||
          "Supervisor",
          160
        ),
        canceledAtISO,
        canceledAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      if (sourceSnap.exists) {
        transaction.set(sourceRef, cancellation, { merge: true });
      }
      if (hostSnap.exists) {
        transaction.set(hostRef, cancellation, { merge: true });
      }
    });

    logger.info("Prestamo entre unidades anulado.", {
      loanId,
      workspaceId,
      canceledByUid: uid
    });

    return { ok: true, loanId };
  }
);

// Manifiesto PWA dinamico. Conserva exclusivamente los parametros necesarios
// para abrir una invitacion desde el icono instalado; nunca registra tokens.
exports.workerInstallManifest = onRequest(
  { cors: false, maxInstances: 10 },
  (request, response) => {
    const workspace = cleanManifestParam(
      request.query.workspace,
      /^[A-Za-z0-9_-]{1,160}$/,
      160
    );
    const invite = cleanManifestParam(
      request.query.invite,
      /^[A-Za-z0-9_-]{1,220}$/,
      220
    );
    const email = cleanManifestParam(
      request.query.email,
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      254
    );
    const startParams = new URLSearchParams({ installed: "1" });

    if (workspace && invite) {
      startParams.set("workspace", workspace);
      startParams.set("invite", invite);
    }
    if (email) startParams.set("email", email);

    response.set({
      "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
      "Content-Type": "application/manifest+json; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    });
    response.status(200).send(JSON.stringify({
      id: "/",
      name: "TurnoPlus Trabajador",
      short_name: "TurnoPlus",
      description: "Aplicacion movil para trabajadores TurnoPlus.",
      start_url: `/?${startParams.toString()}`,
      scope: "/",
      display: "standalone",
      background_color: "#f6f8fb",
      theme_color: "#1d6cff",
      orientation: "portrait",
      icons: [
        {
          src: "/img/icon-turnoplus-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any maskable"
        },
        {
          src: "/img/favicon-turnoplus-calendar.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any maskable"
        }
      ]
    }));
  }
);

exports.cancelWorkerSwap = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  (request) => cancelWorkerSwapHandler(request, {
    db,
    HttpsError,
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp()
  })
);

exports.notifyReplacementRequestCreated = onDocumentCreated(
  "workspaces/{workspaceId}/replacementRequests/{requestId}",
  async (event) => {
    const request = event.data?.data() || {};
    const { workspaceId, requestId } = event.params;

    if (
      request.status !== "pending" ||
      request.channel !== "app" ||
      !request.workerUid
    ) {
      return;
    }

    const title = `Turno extra ${request.turnoLabel || ""}`.trim();
    const body = [
      request.date ? `Fecha ${formatDateCL(request.date)}` : "",
      request.replaced ? `cubre a ${request.replaced}` : "",
      request.absenceType ? `motivo: ${request.absenceType}` : ""
    ].filter(Boolean).join(". ");

    const result = await sendWorkerPush({
      workspaceId,
      uid: request.workerUid,
      category: "overtime",
      title,
      body: body || "Tienes una solicitud de turno extra pendiente.",
      data: {
        type: "replacement_request_created",
        category: "overtime",
        requestId,
        workspaceId,
        screen: "solicitudes",
        url: APP_URL,
        tag: `replacement-${requestId}`,
        requireInteraction: "true"
      }
    });

    await event.data.ref.set({
      notificationStatus: result.sent > 0 ? "push_sent" : "push_not_sent",
      pushSentAt: admin.firestore.FieldValue.serverTimestamp(),
      pushSentCount: result.sent,
      pushError: result.error || ""
    }, { merge: true });
  }
);

exports.notifyWorkerRequestResolved = onDocumentUpdated(
  "workspaces/{workspaceId}/workerRequests/{requestId}",
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const { workspaceId, requestId } = event.params;

    if (
      before.status === after.status ||
      before.status !== "pending" ||
      !["accepted", "rejected"].includes(after.status) ||
      after.source !== "worker_app" ||
      !after.createdByUid
    ) {
      return;
    }

    const accepted = after.status === "accepted";
    const title = accepted ? "Solicitud aceptada" : "Solicitud rechazada";
    const isSwap = after.type === "swap";
    const body = accepted
      ? `${requestTypeLabel(after.type)} fue aceptada por supervisor.`
      : `${requestTypeLabel(after.type)} fue rechazada por supervisor.`;
    const recipients = uniqueValues([
      after.createdByUid,
      isSwap ? after.targetUid : ""
    ]);
    const category = isSwap
      ? "swaps"
      : accepted
        ? "leaveApproved"
        : "leaveCancelled";
    const results = await Promise.all(recipients.map(uid =>
      sendWorkerPush({
        workspaceId,
        uid,
        category,
        title,
        body,
        data: {
          type: "worker_request_resolved",
          category,
          requestId,
          workspaceId,
          status: after.status,
          screen: isSwap ? "cambios" : "solicitudes",
          url: isSwap ? SWAPS_APP_URL : APP_URL,
          tag: `worker-request-${requestId}`
        }
      })
    ));
    const sent = results.reduce((total, result) => total + result.sent, 0);
    const error = results.find((result) => result.error)?.error || "";

    if (isSwap && after.swapRequestId) {
      const workspaceRef = db.collection("workspaces").doc(workspaceId);
      const resolution = {
        status: accepted ? "supervisor_accepted" : "supervisor_rejected",
        supervisorResponseAt: admin.firestore.FieldValue.serverTimestamp(),
        supervisorRequestId: requestId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      const batch = db.batch();
      batch.set(
        workspaceRef.collection("workerSwapRequests").doc(after.swapRequestId),
        resolution,
        { merge: true }
      );
      if (after.openRequestId) {
        batch.set(
          workspaceRef.collection("workerSwapOpenRequests").doc(after.openRequestId),
          resolution,
          { merge: true }
        );
      }
      await batch.commit();
    }

    await event.data.after.ref.set({
      pushResponseSentAt: admin.firestore.FieldValue.serverTimestamp(),
      pushResponseSentCount: sent,
      pushResponseError: error
    }, { merge: true });
  }
);

exports.notifyWorkerSwapRequestCreated = onDocumentCreated(
  "workspaces/{workspaceId}/workerSwapRequests/{requestId}",
  async (event) => {
    const request = event.data?.data() || {};
    const { workspaceId, requestId } = event.params;

    if (
      request.status !== "pending_colleague" ||
      request.source !== "worker_app" ||
      request.type !== "swap" ||
      !request.targetUid
    ) {
      return;
    }

    const body = [
      request.from ? `${request.from} solicita cambio directo` : "Solicitud de cambio directo",
      request.fecha ? `turno ${formatDateCL(request.fecha)}` : "",
      request.devolucion ? `devolucion ${formatDateCL(request.devolucion)}` : ""
    ].filter(Boolean).join(". ");

    const result = await sendWorkerPush({
      workspaceId,
      uid: request.targetUid,
      category: "swaps",
      title: "Cambio de turno",
      body: body || "Tienes una solicitud de cambio de turno pendiente.",
      data: {
        type: "worker_swap_request_created",
        category: "swaps",
        requestId,
        workspaceId,
        screen: "cambios",
        url: SWAPS_APP_URL,
        tag: `worker-swap-${requestId}`,
        requireInteraction: "true"
      }
    });

    await event.data.ref.set({
      notificationStatus: result.sent > 0 ? "push_sent" : "push_not_sent",
      pushSentAt: admin.firestore.FieldValue.serverTimestamp(),
      pushSentCount: result.sent,
      pushError: result.error || ""
    }, { merge: true });
  }
);

exports.processWorkerSwapResponse = onDocumentUpdated(
  "workspaces/{workspaceId}/workerSwapRequests/{requestId}",
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const { workspaceId, requestId } = event.params;

    if (
      before.status !== "pending_colleague" ||
      !["colleague_accepted", "colleague_rejected"].includes(after.status) ||
      after.source !== "worker_app" ||
      after.type !== "swap"
    ) {
      return;
    }

    if (after.status === "colleague_rejected") {
      const result = await sendWorkerPush({
        workspaceId,
        uid: after.createdByUid,
        category: "swaps",
        title: "Cambio rechazado",
        body: `${after.to || "El trabajador"} rechazo el cambio de turno.`,
        data: {
          type: "worker_swap_rejected_by_colleague",
          category: "swaps",
          requestId,
          workspaceId,
          screen: "cambios",
          url: SWAPS_APP_URL,
          tag: `worker-swap-${requestId}`
        }
      });

      await event.data.after.ref.set({
        requesterPushSentAt: admin.firestore.FieldValue.serverTimestamp(),
        requesterPushSentCount: result.sent,
        requesterPushError: result.error || ""
      }, { merge: true });
      return;
    }

    const supervisorRequestId = after.supervisorRequestId || `swap_${requestId}`;
    const createdAt = new Date().toISOString();
    const workerRequestRef = db
      .collection("workspaces")
      .doc(workspaceId)
      .collection("workerRequests")
      .doc(supervisorRequestId);
    let submitted = false;

    await db.runTransaction(async (transaction) => {
      const currentSnap = await transaction.get(event.data.after.ref);
      const current = currentSnap.data() || {};

      // Una anulacion puede competir con este trigger. Solo se crea la
      // solicitud del supervisor si el cambio sigue aceptado por el colega.
      if (current.status !== "colleague_accepted") return;

      transaction.set(workerRequestRef, {
        id: supervisorRequestId,
        type: "swap",
        title: "Cambio directo",
        profile: after.from || after.profile || "",
        from: after.from || after.profile || "",
        to: after.to || after.targetProfile || "",
        targetProfile: after.to || after.targetProfile || "",
        targetUid: after.targetUid || "",
        createdByUid: after.createdByUid || "",
        createdByEmail: after.createdByEmail || "",
        source: "worker_app",
        status: "pending",
        date: after.fecha || after.date || "",
        fecha: after.fecha || after.date || "",
        returnDate: after.devolucion || after.returnDate || "",
        devolucion: after.devolucion || after.returnDate || "",
        ownTurnLabel: after.ownTurnLabel || "",
        returnTurnLabel: after.returnTurnLabel || "",
        detail: after.detail || "",
        swapRequestId: requestId,
        colleagueAcceptedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      transaction.set(event.data.after.ref, {
        status: "pending_supervisor",
        supervisorRequestId,
        supervisorSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      submitted = true;
    });

    if (!submitted) return;

    await sendWorkerPush({
      workspaceId,
      uid: after.createdByUid,
      category: "swaps",
      title: "Cambio aceptado por colega",
      body: "La solicitud fue enviada al supervisor para aprobacion.",
      data: {
        type: "worker_swap_sent_to_supervisor",
        category: "swaps",
        requestId,
        supervisorRequestId,
        workspaceId,
        screen: "cambios",
        url: SWAPS_APP_URL,
        tag: `worker-swap-${requestId}`
      }
    });
  }
);

// Cambio de turno ABIERTO: el trabajador crea una solicitud abierta y esta CF
// la reparte a los companeros elegibles (compatibles, con opt-in, libres ese dia
// y bajo el limite mensual), creando una oferta type="open_swap" a cada uno.
exports.fanOutOpenSwapRequest = onDocumentCreated(
  "workspaces/{workspaceId}/workerSwapOpenRequests/{openId}",
  async (event) => {
    const openReq = event.data?.data() || {};
    const { workspaceId, openId } = event.params;

    if (
      openReq.status !== "open" ||
      openReq.source !== "worker_app" ||
      !openReq.createdByUid ||
      !openReq.ownDate
    ) {
      return;
    }

    const requesterUid = openReq.createdByUid;
    const ownDate = String(openReq.ownDate);
    const wsRef = db.collection("workspaces").doc(workspaceId);

    const requesterCandSnap = await wsRef
      .collection("workerSwapCandidates")
      .doc(requesterUid)
      .get();
    const compatibleUids = Array.isArray(requesterCandSnap.data()?.compatibleWorkerUids)
      ? requesterCandSnap.data().compatibleWorkerUids
      : [];

    const eligible = [];

    for (const colleagueUid of compatibleUids) {
      if (!colleagueUid || colleagueUid === requesterUid) continue;

      const candSnap = await wsRef
        .collection("workerSwapCandidates")
        .doc(colleagueUid)
        .get();
      const cand = candSnap.data() || {};
      const appSnap = await wsRef
        .collection("workerAppData")
        .doc(colleagueUid)
        .get();
      const app = appSnap.data() || {};

      // Opt-in de cambios de turno activado.
      if (app.swapOptIn?.allowSwapRequests !== true) continue;
      // Perfil activo.
      if (cand.status && cand.status !== "active") continue;
      // No tiene ese dia bloqueado.
      const blocked = Array.isArray(cand.blockedDayDates) ? cand.blockedDayDates : [];
      if (blocked.includes(ownDate)) continue;
      // Esta libre ese dia.
      const day = cand.days?.[ownDate];
      const dayClass = String(day?.className || "").toLowerCase();
      const dayLabel = String(day?.label || "").toLowerCase();
      if (dayClass !== "libre" && dayLabel !== "libre") continue;
      // Bajo el limite mensual de cambios.
      const limit = app.swapLimit;
      if (limit?.enabled && Number(limit.used) >= Number(limit.limit)) continue;

      eligible.push({
        uid: colleagueUid,
        profileName: cand.profileName || app.profileName || "Companero"
      });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    let distributed = false;

    await db.runTransaction(async (transaction) => {
      const currentSnap = await transaction.get(event.data.ref);
      const current = currentSnap.data() || {};

      if (current.status !== "open") return;

      eligible.forEach((colleague) => {
        const offerId = `${openId}_${colleague.uid}`;
        const offerRef = wsRef.collection("workerSwapRequests").doc(offerId);

        transaction.set(offerRef, {
          id: offerId,
          workspaceId,
          type: "open_swap",
          source: "worker_app",
          status: "pending_colleague",
          openRequestId: openId,
          groupId: openId,
          createdByUid: requesterUid,
          createdByEmail: openReq.createdByEmail || "",
          from: openReq.profileName || "",
          to: colleague.profileName || "",
          targetUid: colleague.uid,
          fecha: ownDate,
          date: ownDate,
          ownTurnLabel: openReq.ownTurnLabel || "",
          ownTurnClassName: openReq.ownTurnClassName || "",
          returnDate: "",
          returnTurnLabel: "",
          createdAt: now,
          updatedAt: now
        }, { merge: true });
      });
      transaction.set(event.data.ref, {
        status: "distributed",
        recipientUids: eligible.map((colleague) => colleague.uid),
        recipientCount: eligible.length,
        distributedAt: now,
        updatedAt: now
      }, { merge: true });
      distributed = true;
    });

    if (!distributed) return;

    const pushResults = await Promise.all(eligible.map((colleague) =>
      sendWorkerPush({
        workspaceId,
        uid: colleague.uid,
        category: "swaps",
        title: "Cambio de turno disponible",
        body: `${openReq.profileName || "Un companero"} ofrece su turno ${openReq.ownTurnLabel || ""} del ${formatDateCL(ownDate)}.`,
        data: {
          type: "open_swap_offer",
          category: "swaps",
          openRequestId: openId,
          workspaceId,
          screen: "cambios",
          url: SWAPS_APP_URL,
          tag: `open-swap-${openId}`,
          requireInteraction: "true"
        }
      })
    ));
    const sent = pushResults.reduce((total, result) => total + result.sent, 0);

    await event.data.ref.set({
      pushSentCount: sent,
      updatedAt: now
    }, { merge: true });
  }
);

// Arbitraje "primero gana" del cambio abierto: el primer colega que acepta (con
// su dia de devolucion) se queda el cambio; los demas quedan superseded. El
// ganador se envia al supervisor para aprobacion final (workerRequests).
exports.processOpenSwapResponse = onDocumentUpdated(
  "workspaces/{workspaceId}/workerSwapRequests/{requestId}",
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const { workspaceId, requestId } = event.params;

    if (
      after.type !== "open_swap" ||
      before.status !== "pending_colleague" ||
      after.status !== "colleague_accepted"
    ) {
      return;
    }

    const groupId = after.groupId || after.openRequestId;
    const wsRef = db.collection("workspaces").doc(workspaceId);
    const requestRef = event.data.after.ref;
    const openRef = wsRef.collection("workerSwapOpenRequests").doc(groupId);
    const supervisorRequestId = `swap_${requestId}`;
    const supervisorRequestRef = wsRef
      .collection("workerRequests")
      .doc(supervisorRequestId);
    const createdAt = new Date().toISOString();
    let outcome = "stale";

    await db.runTransaction(async (tx) => {
      const [currentSnap, openSnap] = await Promise.all([
        tx.get(requestRef),
        tx.get(openRef)
      ]);
      const current = currentSnap.data() || {};
      const openData = openSnap.data() || {};

      if (current.status !== "colleague_accepted") return;

      if (
        !openSnap.exists ||
        openData.status === "canceled" ||
        isFinalSwapStatus(openData.status)
      ) {
        tx.set(requestRef, {
          status: "canceled",
          canceledAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        outcome = "canceled";
        return;
      }

      if (openData.winnerRequestId) {
        tx.set(requestRef, {
          status: "superseded",
          supersededAt: admin.firestore.FieldValue.serverTimestamp(),
          supersededByRequestId: openData.winnerRequestId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        outcome = "superseded";
        return;
      }

      tx.set(openRef, {
        winnerRequestId: requestId,
        winnerUid: after.targetUid || "",
        supervisorRequestId,
        status: "assigned",
        assignedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      tx.set(supervisorRequestRef, {
        id: supervisorRequestId,
        type: "swap",
        title: "Cambio de turno (abierto)",
        profile: after.from || "",
        from: after.from || "",
        to: after.to || "",
        targetProfile: after.to || "",
        targetUid: after.targetUid || "",
        createdByUid: after.createdByUid || "",
        createdByEmail: after.createdByEmail || "",
        source: "worker_app",
        status: "pending",
        date: after.fecha || after.date || "",
        fecha: after.fecha || after.date || "",
        returnDate: after.returnDate || "",
        devolucion: after.returnDate || "",
        ownTurnLabel: after.ownTurnLabel || "",
        returnTurnLabel: after.returnTurnLabel || "",
        detail: after.detail || "",
        swapRequestId: requestId,
        openRequestId: groupId,
        colleagueAcceptedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      tx.set(requestRef, {
        status: "pending_supervisor",
        supervisorRequestId,
        supervisorSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      outcome = "won";
    });

    if (outcome === "superseded") {
      await sendWorkerPush({
        workspaceId,
        uid: after.targetUid,
        category: "swaps",
        title: "Cambio ya tomado",
        body: "Otro companero acepto este cambio primero.",
        data: {
          type: "open_swap_superseded",
          category: "swaps",
          requestId,
          workspaceId,
          screen: "cambios",
          url: SWAPS_APP_URL,
          tag: `open-swap-${groupId}`
        }
      });
      return;
    }

    if (outcome !== "won") return;

    const siblingsSnap = await wsRef
      .collection("workerSwapRequests")
      .where("groupId", "==", groupId)
      .get();
    const batch = db.batch();

    siblingsSnap.docs.forEach((docSnap) => {
      if (docSnap.id === requestId) return;

      const sibling = docSnap.data();

      if (["pending_colleague", "colleague_accepted"].includes(sibling.status)) {
        batch.set(docSnap.ref, {
          status: "superseded",
          supersededAt: admin.firestore.FieldValue.serverTimestamp(),
          supersededByRequestId: requestId
        }, { merge: true });
      }
    });

    await batch.commit();

    await sendWorkerPush({
      workspaceId,
      uid: after.createdByUid,
      category: "swaps",
      title: "Cambio aceptado",
      body: `${after.to || "Un companero"} acepto tu cambio. Se envio al supervisor para aprobacion.`,
      data: {
        type: "open_swap_accepted",
        category: "swaps",
        requestId,
        workspaceId,
        screen: "cambios",
        url: SWAPS_APP_URL,
        tag: `open-swap-${groupId}`
      }
    });
  }
);

// Eliminacion de entorno programada/anulada: avisa a los trabajadores enlazados
// (push) y propaga el estado a su workerAppData para mostrar el banner/cuenta
// regresiva en la app del trabajador.
exports.notifyWorkspaceDeletion = onDocumentUpdated(
  "workspaces/{workspaceId}",
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const { workspaceId } = event.params;
    const wasPending = before.deletionStatus === "pending_deletion";
    const isPending = after.deletionStatus === "pending_deletion";

    if (wasPending === isPending) return;

    const wsRef = db.collection("workspaces").doc(workspaceId);
    const linksSnap = await wsRef.collection("workerLinks").get();
    const uids = linksSnap.docs.map((docSnap) => docSnap.id).filter(Boolean);
    const workspaceName = after.name || before.name || "tu unidad";
    const scheduledMs = after.deletionScheduledAt?.toMillis
      ? after.deletionScheduledAt.toMillis()
      : null;

    const deletionValue = isPending
      ? { status: "pending_deletion", scheduledAtMs: scheduledMs, workspaceName }
      : admin.firestore.FieldValue.delete();

    const batch = db.batch();
    uids.forEach((uid) => {
      batch.set(
        wsRef.collection("workerAppData").doc(uid),
        { workspaceDeletion: deletionValue, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    });
    await batch.commit();

    const title = isPending ? "Tu unidad sera eliminada" : "Eliminacion anulada";
    const body = isPending
      ? "Tu supervisor programo eliminar la unidad. Descarga tus datos (turnos, HH.EE) antes del cierre."
      : "Se anulo la eliminacion de tu unidad. Todo sigue normal.";

    await Promise.all(uids.map((uid) =>
      sendWorkerPush({
        workspaceId,
        uid,
        category: "messages",
        title,
        body,
        data: {
          type: "workspace_deletion",
          category: "messages",
          workspaceId,
          status: isPending ? "pending_deletion" : "canceled",
          screen: "turnos",
          url: APP_URL,
          tag: `workspace-deletion-${workspaceId}`,
          requireInteraction: isPending ? "true" : "false"
        }
      })
    ));
  }
);

// Ejecuta el borrado definitivo de los entornos cuyo plazo de gracia vencio.
// Nota: Cloud Scheduler no opera en southamerica-west1, por eso esta funcion
// corre en us-central1 (la region solo define donde corre el job; el acceso a
// Firestore es global).
exports.purgeWorkspaceDeletions = onSchedule(
  { schedule: "every 60 minutes", region: "us-central1" },
  async () => {
    const nowMs = Date.now();
    const snap = await db
      .collection("workspaces")
      .where("deletionStatus", "==", "pending_deletion")
      .get();

    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const scheduledMs = data.deletionScheduledAt?.toMillis
        ? data.deletionScheduledAt.toMillis()
        : null;

      // Guarda: solo borrar si sigue pendiente y el plazo realmente vencio.
      if (!scheduledMs || scheduledMs > nowMs) continue;

      const wsId = docSnap.id;
      const wsRef = db.collection("workspaces").doc(wsId);

      try {
        // 1. Quitar el entorno del indice de cada miembro (users/{uid}/workspaces).
        const [membersSnap, workerLinksSnap, invitesSnap] = await Promise.all([
          wsRef.collection("members").get(),
          wsRef.collection("workerLinks").get(),
          wsRef.collection("workerAppInvites").get()
        ]);
        const writer = db.bulkWriter();

        membersSnap.docs.forEach((member) => {
          writer.delete(
            db.collection("users").doc(member.id).collection("workspaces").doc(wsId)
          );
        });
        workerLinksSnap.docs.forEach((link) => {
          writer.delete(
            db.collection("users").doc(link.id).collection("workerLinks").doc(wsId)
          );
        });
        invitesSnap.docs.forEach((invite) => {
          const email = normalizeEmail(invite.data()?.email);

          if (isValidEmail(email)) {
            writer.delete(
              db.collection("workerAppEmailInvites")
                .doc(email)
                .collection("items")
                .doc(invite.id)
            );
          }
        });

        // 2. Eliminar los enlaces con otras unidades (ambos lados).
        const linksFrom = await db
          .collection("workspaceLinks")
          .where("fromWorkspaceId", "==", wsId)
          .get();
        const linksTo = await db
          .collection("workspaceLinks")
          .where("toWorkspaceId", "==", wsId)
          .get();
        [...linksFrom.docs, ...linksTo.docs].forEach((link) =>
          writer.delete(link.ref)
        );

        await writer.close();

        // 3. Borrado recursivo del entorno (doc + subcolecciones).
        await db.recursiveDelete(wsRef);

        logger.info(`Entorno eliminado definitivamente: ${wsId}`);
      } catch (error) {
        logger.error(`No se pudo eliminar el entorno ${wsId}`, error);
      }
    }
  }
);

exports.notifySupervisorMessageCreated = onDocumentCreated(
  "workspaces/{workspaceId}/workerMessages/{workerUid}/messages/{messageId}",
  async (event) => {
    const message = event.data?.data() || {};
    const { workspaceId, workerUid, messageId } = event.params;

    if (
      message.sender !== "supervisor" ||
      !workerUid ||
      !message.text
    ) {
      return;
    }

    const result = await sendWorkerPush({
      workspaceId,
      uid: workerUid,
      category: "messages",
      title: "Mensaje de supervisor",
      body: String(message.text).slice(0, 140),
      data: {
        type: "supervisor_message_created",
        category: "messages",
        messageId,
        workspaceId,
        screen: "mensajes",
        url: `${WORKER_APP_BASE_URL}?screen=mensajes`,
        tag: `supervisor-message-${messageId}`,
        requireInteraction: "true",
        vibrate: "true"
      }
    });

    await event.data.ref.set({
      pushSentAt: admin.firestore.FieldValue.serverTimestamp(),
      pushSentCount: result.sent,
      pushError: result.error || "",
      pushStatus: result.sent > 0 ? "push_sent" : "push_not_sent"
    }, { merge: true });
  }
);

exports.notifyWorkerPeerMessageCreated = onDocumentCreated(
  "workspaces/{workspaceId}/workerPeerThreads/{threadId}/messages/{messageId}",
  async (event) => {
    const message = event.data?.data() || {};
    const { workspaceId, threadId, messageId } = event.params;
    const senderUid = String(message.senderUid || "");
    const targetUid = String(message.targetUid || "");
    const text = String(message.text || "").trim().slice(0, 2000);

    if (
      !senderUid ||
      !targetUid ||
      senderUid === targetUid ||
      !text
    ) {
      return;
    }

    const workspaceRef = db.collection("workspaces").doc(workspaceId);
    const [threadSnap, senderLinkSnap, targetLinkSnap] = await Promise.all([
      workspaceRef.collection("workerPeerThreads").doc(threadId).get(),
      workspaceRef.collection("workerLinks").doc(senderUid).get(),
      workspaceRef.collection("workerLinks").doc(targetUid).get()
    ]);
    const participants = threadSnap.data()?.participantUids || [];

    if (
      !threadSnap.exists ||
      !senderLinkSnap.exists ||
      !targetLinkSnap.exists ||
      !Array.isArray(participants) ||
      !participants.includes(senderUid) ||
      !participants.includes(targetUid)
    ) {
      logger.warn("Mensaje entre trabajadores con relacion invalida.", {
        workspaceId,
        threadId,
        messageId
      });
      return;
    }

    const senderName = String(
      senderLinkSnap.data()?.profileName || "trabajador"
    ).trim().slice(0, 160);

    const result = await sendWorkerPush({
      workspaceId,
      uid: targetUid,
      category: "messages",
      title: `Mensaje de ${senderName}`,
      body: text.slice(0, 140),
      data: {
        type: "worker_peer_message_created",
        category: "messages",
        messageId,
        threadId,
        senderUid,
        targetUid,
        workspaceId,
        screen: "mensajes",
        url: `${WORKER_APP_BASE_URL}?screen=mensajes&peer=${encodeURIComponent(senderUid)}`,
        tag: `worker-peer-message-${messageId}`,
        requireInteraction: "true",
        vibrate: "true"
      }
    });

    await event.data.ref.set({
      pushSentAt: admin.firestore.FieldValue.serverTimestamp(),
      pushSentCount: result.sent,
      pushError: result.error || "",
      pushStatus: result.sent > 0 ? "push_sent" : "push_not_sent"
    }, { merge: true });
  }
);

async function sendWorkerPush({ workspaceId, uid, category, title, body, data }) {
  const tokens = await getWorkerTokens(workspaceId, uid, category);

  if (!tokens.length) {
    logger.info("Sin tokens push activos para trabajador.", {
      workspaceId,
      uid,
      category
    });
    return { sent: 0, error: "Sin tokens activos o permitidos." };
  }

  let sent = 0;
  let firstError = "";

  await Promise.all(tokens.map(async (item) => {
    try {
      await admin.messaging().send(buildMessage(item, {
        title,
        body,
        data
      }));
      sent += 1;
    } catch (error) {
      firstError ||= error.message || String(error);
      logger.warn("No se pudo enviar push FCM.", {
        workspaceId,
        uid,
        category,
        code: error.code,
        message: error.message
      });

      if (INVALID_TOKEN_CODES.has(error.code)) {
        await item.ref.set({
          active: false,
          disabledAt: admin.firestore.FieldValue.serverTimestamp(),
          lastError: error.code || error.message || "invalid_token"
        }, { merge: true });
      }
    }
  }));

  logger.info("Push FCM procesado.", {
    workspaceId,
    uid,
    category,
    tokenCount: tokens.length,
    sent,
    error: sent ? "" : firstError
  });

  return { sent, error: sent ? "" : firstError };
}

async function getWorkerTokens(workspaceId, uid, category) {
  const snapshot = await db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("workerPushTokens")
    .doc(uid)
    .collection("tokens")
    .where("active", "==", true)
    .get();

  return snapshot.docs
    .map((doc) => ({
      ref: doc.ref,
      id: doc.id,
      ...doc.data()
    }))
    .filter((item) => item.token && tokenAllows(item, category));
}

function buildMessage(tokenInfo, payload) {
  const settings = tokenInfo.settings || {};
  const alertMode = settings.alertMode === "vibration" ? "vibration" : "sound";
  const silent = false;
  const vibrate = [320, 120, 320, 120, 220];
  const data = stringifyData({
    ...payload.data,
    title: payload.title,
    body: payload.body,
    icon: APP_ICON,
    badge: APP_BADGE,
    alertMode,
    vibrate: "true",
    silent: "false",
    requireInteraction: payload.data?.requireInteraction || "false"
  });

  return {
    token: tokenInfo.token,
    notification: {
      title: payload.title || "TurnoPlus",
      body: payload.body || "Nueva notificacion."
    },
    data,
    webpush: {
      headers: {
        Urgency: "high",
        TTL: "300"
      },
      notification: {
        title: payload.title || "TurnoPlus",
        body: payload.body || "Nueva notificacion.",
        icon: APP_ICON,
        badge: APP_BADGE,
        tag: data.tag || data.requestId || "turnoplus-notification",
        renotify: true,
        requireInteraction: data.requireInteraction === "true",
        silent,
        vibrate,
        data
      },
      fcmOptions: {
        link: data.url || APP_URL
      }
    }
  };
}

function tokenAllows(tokenInfo, category) {
  const settings = tokenInfo.settings || {};
  const categories = settings.categories || {};
  const alertWindow = settings.alertWindow || "24/7";

  if (category && categories[category] === false) return false;
  if (alertWindow === "Nunca") return false;

  if (alertWindow === "08:00 a 21:00") {
    const hour = Number(new Intl.DateTimeFormat("es-CL", {
      timeZone: "America/Santiago",
      hour: "2-digit",
      hour12: false
    }).format(new Date()));

    return hour >= 8 && hour < 21;
  }

  return true;
}

function uniqueValues(values) {
  return [...new Set(
    values
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
}

function stringifyData(value) {
  return Object.fromEntries(
    Object.entries(value || {}).map(([key, entry]) => [
      key,
      String(entry ?? "")
    ])
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildInviteEmail({ workerName, unit, ctaUrl, installUrl, isGoogleEmail }) {
  const safeName = escapeHtml(workerName);
  const safeUnit = escapeHtml(unit);
  const safeCta = escapeHtml(ctaUrl);
  const safeInstall = escapeHtml(installUrl);
  const ctaLabel = "Enlazar mi app";
  const accessNote =
    "Toca el boton para abrir tu invitacion y enlazar la app. No enviaremos un segundo correo de verificacion; el enlace es personal, no lo compartas.";

  const text = [
    `Hola ${workerName}.`,
    `Te invitamos a enlazar tu aplicacion TurnoPlus Trabajador con ${unit}.`,
    `Abre este enlace personal para enlazar tu app: ${ctaUrl}`,
    `Para tenerla como app en tu celular: abre ${installUrl} y, en el menu del navegador, elige "Agregar a pantalla de inicio" o "Instalar app".`,
    "Si no esperabas esta invitacion, puedes ignorar este correo."
  ].join("\n\n");

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #1f2933; line-height: 1.5;">
      <h2 style="margin: 0 0 12px;">TurnoPlus Trabajador</h2>
      <p>Hola <strong>${safeName}</strong>,</p>
      <p>Te invitamos a enlazar tu aplicacion <strong>TurnoPlus Trabajador</strong> con <strong>${safeUnit}</strong> para revisar tus turnos, permisos y solicitudes desde tu celular.</p>
      <p>${accessNote}</p>
      <p style="margin: 24px 0;">
        <a href="${safeCta}" style="background: #1d6cff; color: #ffffff; text-decoration: none; padding: 12px 22px; border-radius: 10px; font-weight: bold; display: inline-block;">${ctaLabel}</a>
      </p>
      <p style="font-size: 14px; color: #52606d;">Si el boton no funciona, copia y pega este enlace en tu navegador:<br>
        <a href="${safeCta}">${safeCta}</a>
      </p>
      <div style="font-size: 14px; color: #52606d; background: #f1f5f9; border-radius: 10px; padding: 12px 14px; margin-top: 8px;">
        <strong>Instalala como app en tu celular</strong><br>
        Abre <a href="${safeInstall}">${safeInstall}</a> en tu navegador y elige <strong>"Agregar a pantalla de inicio"</strong> o <strong>"Instalar app"</strong>. Asi la tendras como una app normal, sin pasar por una tienda.
      </div>
      <hr style="border: none; border-top: 1px solid #e4e7eb; margin: 24px 0;">
      <p style="font-size: 12px; color: #9aa5b1;">Si no esperabas esta invitacion, puedes ignorar este correo.</p>
    </div>
  `;

  return { html, text };
}

function formatDateCL(value) {
  const [year, month, day] = String(value || "").split("-");

  if (!year || !month || !day) return String(value || "");
  return `${day}-${month}-${year}`;
}

function requestTypeLabel(type) {
  const labels = {
    legal: "F. Legal",
    admin: "P. Administrativo",
    comp: "P. Compensatorio",
    half_admin_morning: "1/2 ADM manana",
    half_admin_afternoon: "1/2 ADM tarde",
    unpaid_leave: "Permiso sin goce",
    clock_incident: "Incidencia de marcaje",
    missing_clock: "Incidencia de marcaje",
    swap: "Cambio de turno"
  };

  return labels[type] || "Solicitud";
}

// ===========================================================================
// Suscripciones / Planes: uso autoritativo de la cuenta del dueño (ownerUid).
// La PWA del trabajador es gratis; el cobro y los limites viven en la cuenta
// del dueño en ProTurnos y cubren TODOS sus entornos.
// ===========================================================================

// Entornos que no deben contar para el uso (marcados para eliminacion).
const BILLING_EXCLUDED_WORKSPACE_STATES = new Set([
  "pending_deletion",
  "deleted"
]);

function subscriptionPeriodEndMillis(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Reconstruye los perfiles de un entorno desde el snapshot modular sincronizado
// (modulo "profile") y cuenta los activos. Es autoritativo: lee la misma fuente
// que usa la app (no un contador escrito aparte), por lo que no se puede evadir
// el limite manipulando un contador en el cliente.
async function countActiveWorkersInWorkspace(workspaceId) {
  const chunksSnap = await db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("stateModules")
    .doc("profile")
    .collection("chunks")
    .get();

  if (chunksSnap.empty) return 0;

  const text = chunksSnap.docs
    .map((doc) => ({
      index: Number(doc.data()?.index) || 0,
      text: String(doc.data()?.text || "")
    }))
    .sort((a, b) => a.index - b.index)
    .map((chunk) => chunk.text)
    .join("");

  let snapshot;
  try {
    snapshot = JSON.parse(text || "{}");
  } catch (error) {
    logger.warn("No se pudo parsear el modulo profile.", { workspaceId });
    return 0;
  }

  const profiles = Array.isArray(snapshot.profiles) ? snapshot.profiles : [];

  // Activo = no desactivado explicitamente (coincide con isProfileActive del
  // cliente: profile.active !== false). Un perfil legacy como string cuenta.
  return profiles.filter((profile) => {
    if (typeof profile === "string") return true;
    return profile && profile.active !== false;
  }).length;
}

// Devuelve el uso real de la cuenta del dueño: plan vigente, vencimiento,
// trabajadores activos (sumando todos los entornos) y cantidad de entornos.
// El cliente compara estos numeros contra los limites de plans.js.
exports.getAccountUsage = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 60
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para ver tu suscripcion."
      );
    }

    // Suscripcion almacenada. Si no hay documento, la cuenta es gratis.
    const accountSnap = await db.collection("accounts").doc(uid).get();
    const account = accountSnap.exists ? accountSnap.data() || {} : {};
    const plan = typeof account.plan === "string" ? account.plan : "free";
    const period =
      account.period === "annual" || account.period === "monthly"
        ? account.period
        : null;
    const periodEndMs = subscriptionPeriodEndMillis(account.currentPeriodEnd);
    const now = Date.now();
    const expired = plan !== "free" && periodEndMs > 0 && now > periodEndMs;
    const effectivePlan = expired ? "free" : plan;

    // Entornos del dueño que no estan marcados para eliminacion.
    const workspacesSnap = await db
      .collection("workspaces")
      .where("ownerUid", "==", uid)
      .get();
    const ownedWorkspaces = workspacesSnap.docs.filter(
      (doc) =>
        !BILLING_EXCLUDED_WORKSPACE_STATES.has(
          String(doc.data()?.deletionStatus || "")
        )
    );

    // Suma autoritativa de trabajadores activos entre TODOS los entornos.
    let activeWorkers = 0;
    for (const workspaceDoc of ownedWorkspaces) {
      activeWorkers += await countActiveWorkersInWorkspace(workspaceDoc.id);
    }

    const pendingDiscount =
      account.pendingDiscount && typeof account.pendingDiscount === "object"
        ? {
            code: String(account.pendingDiscount.code || ""),
            percentOff: Number(account.pendingDiscount.percentOff) || 0,
            amountOff: Number(account.pendingDiscount.amountOff) || 0,
            plan:
              typeof account.pendingDiscount.plan === "string"
                ? account.pendingDiscount.plan
                : null
          }
        : null;

    return {
      plan,
      effectivePlan,
      period,
      currentPeriodEnd: periodEndMs || null,
      source: typeof account.source === "string" ? account.source : null,
      couponCode:
        typeof account.couponCode === "string" ? account.couponCode : null,
      pendingDiscount,
      expired,
      activeWorkers,
      entornos: ownedWorkspaces.length,
      generatedAt: now
    };
  }
);

// ===========================================================================
// Cupones de suscripcion: acceso temporal a un plan, o descuento al pagar.
// Crear/listar/desactivar es solo para el admin; canjear lo hace cualquier
// dueno autenticado. Toda la coleccion "coupons" se accede solo via estas
// funciones (las reglas la cierran al cliente).
// ===========================================================================

// Admin(s) habilitados para gestionar cupones. Gmail ignora los puntos y el
// sufijo +alias, por eso se normaliza antes de comparar.
const COUPON_ADMIN_EMAILS = ["tm.alanplaza@gmail.com"];
const COUPON_CODE_PATTERN = /^[A-Z0-9]{4,24}$/;
const COUPON_PLANS = new Set(["p1", "p2", "p3"]);

function normalizeEmailForAdmin(email) {
  const clean = String(email || "").trim().toLowerCase();
  const at = clean.indexOf("@");

  if (at < 0) return clean;

  let local = clean.slice(0, at);
  const domain = clean.slice(at + 1);

  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "").split("+")[0];
    return `${local}@gmail.com`;
  }

  return clean;
}

function isCouponAdmin(token = {}) {
  if (token.email_verified === false) return false;

  const email = normalizeEmailForAdmin(token.email);

  if (!email) return false;

  return COUPON_ADMIN_EMAILS.some(
    (adminEmail) => normalizeEmailForAdmin(adminEmail) === email
  );
}

function generateCouponCode() {
  // 8 caracteres legibles (sin 0/O/1/I) desde bytes aleatorios.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let code = "";

  for (let index = 0; index < 8; index += 1) {
    code += alphabet[bytes[index] % alphabet.length];
  }

  return code;
}

function serializeCoupon(code, data = {}) {
  return {
    code,
    type: data.type === "discount" ? "discount" : "access",
    plan: typeof data.plan === "string" ? data.plan : null,
    durationDays: Number(data.durationDays) || 0,
    percentOff: Number(data.percentOff) || 0,
    amountOff: Number(data.amountOff) || 0,
    maxRedemptions: Number(data.maxRedemptions) || 0,
    redemptionsCount: Number(data.redemptionsCount) || 0,
    active: data.active !== false,
    expiresAt: subscriptionPeriodEndMillis(data.expiresAt) || null,
    note: typeof data.note === "string" ? data.note : "",
    createdByEmail:
      typeof data.createdByEmail === "string" ? data.createdByEmail : "",
    createdAt: subscriptionPeriodEndMillis(data.createdAt) || null
  };
}

exports.createCoupon = onCall(
  {
    // Sin App Check: lo usa el panel admin estatico. La seguridad es auth +
    // chequeo de admin (isCouponAdmin).
    enforceAppCheck: false,
    timeoutSeconds: 30
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Inicia sesion.");
    }

    if (!isCouponAdmin(request.auth.token || {})) {
      throw new HttpsError(
        "permission-denied",
        "Solo el administrador puede crear cupones."
      );
    }

    const data = request.data || {};
    const type = data.type === "discount" ? "discount" : "access";
    const plan = COUPON_PLANS.has(data.plan) ? data.plan : "";
    const durationDays = Math.max(
      0,
      Math.min(3650, Math.round(Number(data.durationDays) || 0))
    );
    const percentOff = Math.max(
      0,
      Math.min(100, Math.round(Number(data.percentOff) || 0))
    );
    const amountOff = Math.max(0, Math.round(Number(data.amountOff) || 0));
    const maxRedemptions = Math.max(
      0,
      Math.min(100000, Math.round(Number(data.maxRedemptions) || 0))
    );
    const expiresInDays = Math.max(
      0,
      Math.min(3650, Math.round(Number(data.expiresInDays) || 0))
    );
    const note = cleanCallableText(data.note, 200);

    if (type === "access") {
      if (!plan) {
        throw new HttpsError(
          "invalid-argument",
          "Elige el plan que otorga el cupon de acceso."
        );
      }
      if (durationDays <= 0) {
        throw new HttpsError(
          "invalid-argument",
          "Indica cuantos dias de acceso otorga el cupon."
        );
      }
    } else if (percentOff <= 0 && amountOff <= 0) {
      throw new HttpsError(
        "invalid-argument",
        "Indica un descuento en porcentaje o en monto."
      );
    }

    let requestedCode = String(data.code || "").trim().toUpperCase();

    if (requestedCode && !COUPON_CODE_PATTERN.test(requestedCode)) {
      throw new HttpsError(
        "invalid-argument",
        "El codigo debe tener entre 4 y 24 letras o numeros."
      );
    }

    const now = admin.firestore.Timestamp.now();
    const expiresAt =
      expiresInDays > 0
        ? admin.firestore.Timestamp.fromMillis(
            Date.now() + expiresInDays * 86400000
          )
        : null;
    const payload = {
      type,
      plan: plan || null,
      durationDays,
      percentOff,
      amountOff,
      maxRedemptions,
      redemptionsCount: 0,
      redeemedBy: [],
      active: true,
      expiresAt,
      note,
      createdByUid: request.auth.uid,
      createdByEmail: cleanCallableText(request.auth.token?.email, 254),
      createdAt: now,
      updatedAt: now
    };

    // create() falla si el documento ya existe -> garantiza unicidad del codigo.
    if (requestedCode) {
      try {
        await db
          .collection("coupons")
          .doc(requestedCode)
          .create({ code: requestedCode, ...payload });
      } catch (error) {
        if (error.code === 6 || error.code === "already-exists") {
          throw new HttpsError(
            "already-exists",
            "Ese codigo de cupon ya existe."
          );
        }
        throw error;
      }

      return { code: requestedCode };
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = generateCouponCode();

      try {
        await db
          .collection("coupons")
          .doc(candidate)
          .create({ code: candidate, ...payload });

        return { code: candidate };
      } catch (error) {
        if (error.code !== 6 && error.code !== "already-exists") throw error;
      }
    }

    throw new HttpsError(
      "internal",
      "No se pudo generar un codigo unico. Reintenta."
    );
  }
);

exports.redeemCoupon = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError("unauthenticated", "Inicia sesion para canjear el cupon.");
    }

    const code = String(request.data?.code || "").trim().toUpperCase();

    if (!COUPON_CODE_PATTERN.test(code)) {
      throw new HttpsError("invalid-argument", "Ingresa un codigo de cupon valido.");
    }

    const applied = await db.runTransaction(async (transaction) => {
      const couponRef = db.collection("coupons").doc(code);
      const accountRef = db.collection("accounts").doc(uid);
      const couponSnap = await transaction.get(couponRef);
      const accountSnap = await transaction.get(accountRef);

      if (!couponSnap.exists) {
        throw new HttpsError("not-found", "El cupon no existe.");
      }

      const coupon = couponSnap.data() || {};
      const now = Date.now();

      if (coupon.active === false) {
        throw new HttpsError("failed-precondition", "El cupon esta desactivado.");
      }

      const expiresMs = subscriptionPeriodEndMillis(coupon.expiresAt);
      if (expiresMs && now > expiresMs) {
        throw new HttpsError("failed-precondition", "El cupon esta vencido.");
      }

      const max = Number(coupon.maxRedemptions) || 0;
      const count = Number(coupon.redemptionsCount) || 0;
      if (max > 0 && count >= max) {
        throw new HttpsError(
          "resource-exhausted",
          "El cupon ya alcanzo su limite de usos."
        );
      }

      const redeemedBy = Array.isArray(coupon.redeemedBy)
        ? coupon.redeemedBy
        : [];
      if (redeemedBy.includes(uid)) {
        throw new HttpsError("already-exists", "Ya canjeaste este cupon.");
      }

      const nowTs = admin.firestore.Timestamp.now();
      let result;

      if (coupon.type === "discount") {
        const pendingDiscount = {
          code,
          percentOff: Number(coupon.percentOff) || 0,
          amountOff: Number(coupon.amountOff) || 0,
          plan: typeof coupon.plan === "string" ? coupon.plan : null,
          addedAt: nowTs
        };

        transaction.set(
          accountRef,
          { pendingDiscount, updatedAt: nowTs },
          { merge: true }
        );

        result = {
          type: "discount",
          percentOff: pendingDiscount.percentOff,
          amountOff: pendingDiscount.amountOff,
          plan: pendingDiscount.plan
        };
      } else {
        const durationDays = Math.max(1, Number(coupon.durationDays) || 0);
        const account = accountSnap.exists ? accountSnap.data() || {} : {};
        const currentEndMs = subscriptionPeriodEndMillis(account.currentPeriodEnd);
        // Si ya tiene vigente el mismo plan, extiende desde el fin; si no, desde hoy.
        const samePlanActive =
          account.plan === coupon.plan && currentEndMs > now;
        const baseMs = samePlanActive ? currentEndMs : now;
        const newEnd = admin.firestore.Timestamp.fromMillis(
          baseMs + durationDays * 86400000
        );

        transaction.set(
          accountRef,
          {
            plan: coupon.plan,
            period: null,
            source: "coupon",
            couponCode: code,
            currentPeriodEnd: newEnd,
            updatedAt: nowTs
          },
          { merge: true }
        );

        result = {
          type: "access",
          plan: coupon.plan,
          currentPeriodEnd: newEnd.toMillis()
        };
      }

      transaction.update(couponRef, {
        redemptionsCount: count + 1,
        redeemedBy: admin.firestore.FieldValue.arrayUnion(uid),
        updatedAt: nowTs
      });

      return result;
    });

    return { ok: true, ...applied };
  }
);

exports.listCoupons = onCall(
  {
    // Sin App Check: lo usa el panel admin estatico (auth + isCouponAdmin).
    enforceAppCheck: false,
    timeoutSeconds: 30
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Inicia sesion.");
    }

    if (!isCouponAdmin(request.auth.token || {})) {
      throw new HttpsError(
        "permission-denied",
        "Solo el administrador puede ver los cupones."
      );
    }

    const snap = await db
      .collection("coupons")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    return {
      coupons: snap.docs.map((doc) => serializeCoupon(doc.id, doc.data()))
    };
  }
);

exports.setCouponActive = onCall(
  {
    // Sin App Check: lo usa el panel admin estatico (auth + isCouponAdmin).
    enforceAppCheck: false,
    timeoutSeconds: 30
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Inicia sesion.");
    }

    if (!isCouponAdmin(request.auth.token || {})) {
      throw new HttpsError(
        "permission-denied",
        "Solo el administrador puede modificar cupones."
      );
    }

    const code = String(request.data?.code || "").trim().toUpperCase();

    if (!COUPON_CODE_PATTERN.test(code)) {
      throw new HttpsError("invalid-argument", "Codigo de cupon invalido.");
    }

    await db.collection("coupons").doc(code).update({
      active: Boolean(request.data?.active),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { ok: true };
  }
);

// ===========================================================================
// Panel de control admin: metricas agregadas de toda la plataforma.
// Solo para el admin. No exige App Check para simplificar la app del panel
// (la seguridad real es auth + admin); la app del panel solo lee este dato.
// ===========================================================================

// Cuenta perfiles activos y totales de un entorno desde el modulo "profile".
async function readWorkspaceProfileCounts(workspaceId) {
  const chunksSnap = await db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("stateModules")
    .doc("profile")
    .collection("chunks")
    .get();

  if (chunksSnap.empty) return { active: 0, total: 0 };

  const text = chunksSnap.docs
    .map((doc) => ({
      index: Number(doc.data()?.index) || 0,
      text: String(doc.data()?.text || "")
    }))
    .sort((a, b) => a.index - b.index)
    .map((chunk) => chunk.text)
    .join("");

  let snapshot;
  try {
    snapshot = JSON.parse(text || "{}");
  } catch (error) {
    return { active: 0, total: 0 };
  }

  const profiles = Array.isArray(snapshot.profiles) ? snapshot.profiles : [];
  const active = profiles.filter((profile) => {
    if (typeof profile === "string") return true;
    return profile && profile.active !== false;
  }).length;

  return { active, total: profiles.length };
}

exports.getAdminDashboard = onCall(
  {
    enforceAppCheck: false,
    timeoutSeconds: 180
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Inicia sesion.");
    }

    if (!isCouponAdmin(request.auth.token || {})) {
      throw new HttpsError(
        "permission-denied",
        "Solo el administrador puede ver el panel."
      );
    }

    const now = Date.now();

    // Entornos + conteo de trabajadores (autoritativo, por entorno activo).
    const workspacesSnap = await db.collection("workspaces").get();
    const owners = new Set();
    let activeWorkspaces = 0;
    let pendingDeletion = 0;
    const countPromises = [];

    workspacesSnap.docs.forEach((doc) => {
      const data = doc.data() || {};

      if (BILLING_EXCLUDED_WORKSPACE_STATES.has(
        String(data.deletionStatus || "")
      )) {
        pendingDeletion += 1;
        return;
      }

      activeWorkspaces += 1;
      if (data.ownerUid) owners.add(data.ownerUid);
      countPromises.push(readWorkspaceProfileCounts(doc.id));
    });

    const counts = await Promise.all(countPromises);
    let totalActiveWorkers = 0;
    let totalProfiles = 0;
    counts.forEach((item) => {
      totalActiveWorkers += item.active;
      totalProfiles += item.total;
    });

    // Suscripciones por cuenta (dueno). Plan efectivo considerando vencimiento.
    const accountsSnap = await db.collection("accounts").get();
    const accountByOwner = new Map();
    accountsSnap.docs.forEach((doc) => {
      accountByOwner.set(doc.id, doc.data() || {});
    });

    const allOwners = new Set([...owners, ...accountByOwner.keys()]);
    const byPlan = { free: 0, p1: 0, p2: 0, p3: 0 };
    let expired = 0;
    const upcoming = [];

    allOwners.forEach((uid) => {
      const account = accountByOwner.get(uid) || {};
      const plan = typeof account.plan === "string" ? account.plan : "free";
      const endMs = subscriptionPeriodEndMillis(account.currentPeriodEnd);
      const isExpired = plan !== "free" && endMs > 0 && now > endMs;
      const effectivePlan = isExpired ? "free" : plan;

      if (byPlan[effectivePlan] !== undefined) {
        byPlan[effectivePlan] += 1;
      } else {
        byPlan.free += 1;
      }

      if (isExpired) expired += 1;

      if (
        plan !== "free" &&
        endMs > 0 &&
        !isExpired &&
        endMs - now <= 30 * 86400000
      ) {
        upcoming.push({
          ownerUid: uid,
          plan,
          source: typeof account.source === "string" ? account.source : null,
          currentPeriodEnd: endMs
        });
      }
    });

    upcoming.sort((a, b) => a.currentPeriodEnd - b.currentPeriodEnd);

    // Cupones.
    const couponsSnap = await db.collection("coupons").get();
    let activeCoupons = 0;
    let totalRedemptions = 0;
    couponsSnap.docs.forEach((doc) => {
      const coupon = doc.data() || {};
      if (coupon.active !== false) activeCoupons += 1;
      totalRedemptions += Number(coupon.redemptionsCount) || 0;
    });

    return {
      generatedAt: now,
      owners: { total: owners.size },
      workspaces: {
        active: activeWorkspaces,
        pendingDeletion,
        total: workspacesSnap.size
      },
      workers: {
        totalActive: totalActiveWorkers,
        totalProfiles
      },
      subscriptions: {
        byPlan,
        expired,
        withAccountDoc: accountsSnap.size
      },
      expirations: {
        upcoming: upcoming.slice(0, 50)
      },
      coupons: {
        total: couponsSnap.size,
        active: activeCoupons,
        totalRedemptions
      }
    };
  }
);
