const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { setGlobalOptions } = require("firebase-functions/v2");
const {
  onDocumentCreated,
  onDocumentUpdated
} = require("firebase-functions/v2/firestore");
const { defineSecret, defineString } = require("firebase-functions/params");

// API key de Resend. Configurar con: firebase functions:secrets:set RESEND_API_KEY
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
// Remitente verificado en Resend. Para produccion, verificar un dominio propio
// y usar algo como "TurnoPlus <noreply@tudominio.cl>". Configurable en
// functions/.env (MAIL_FROM=...). Por defecto usa el remitente de pruebas de
// Resend, que solo entrega a la propia cuenta del API key.
const MAIL_FROM = defineString("MAIL_FROM", {
  default: "TurnoPlus <onboarding@resend.dev>"
});

admin.initializeApp();
setGlobalOptions({ region: "southamerica-west1" });

const db = admin.firestore();
const WORKER_APP_BASE_URL = "https://turnoplusfuncionarios.web.app/";
const APP_URL = `${WORKER_APP_BASE_URL}?screen=solicitudes`;
const APP_ICON = `${WORKER_APP_BASE_URL}img/logo-turnoplus.png`;
const APP_BADGE = `${WORKER_APP_BASE_URL}img/favicon-turnoplus-calendar.png`;
const INVALID_TOKEN_CODES = new Set([
  "messaging/invalid-argument",
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered"
]);

exports.sendWorkerAppInviteEmail = onDocumentCreated(
  {
    document: "workspaces/{workspaceId}/workerAppInvites/{token}",
    secrets: [RESEND_API_KEY]
  },
  async (event) => {
    const invite = event.data?.data() || {};
    const email = String(invite.email || "").trim();

    if (invite.status !== "pending" || !email) {
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

    const workerName = String(invite.profileName || "trabajador").trim();
    const unit = String(invite.workspaceName || "TurnoPlus").trim();
    const inviteUrl = String(invite.inviteUrl || "");
    const installUrl = String(invite.appInstallUrl || WORKER_APP_BASE_URL);

    // Para correos no-Gmail: el boton del correo ES el enlace de ingreso
    // passwordless (un correo, un clic). Para Gmail, el enlace abre la app y se
    // inicia sesion con Google. Si falla la generacion (p. ej. dominio de
    // continuacion no autorizado), se usa el enlace normal como respaldo.
    const isGoogleEmail = /@(?:gmail|googlemail)\.com$/i.test(email);
    let ctaUrl = inviteUrl;

    if (!isGoogleEmail && inviteUrl) {
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
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: MAIL_FROM.value(),
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
        email,
        id: result?.id || ""
      });
    } catch (error) {
      logger.error("No se pudo enviar correo de invitacion.", {
        email,
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
          screen: "solicitudes",
          url: APP_URL,
          tag: `worker-request-${requestId}`
        }
      })
    ));
    const sent = results.reduce((total, result) => total + result.sent, 0);
    const error = results.find((result) => result.error)?.error || "";

    if (isSwap && after.swapRequestId) {
      await db
        .collection("workspaces")
        .doc(workspaceId)
        .collection("workerSwapRequests")
        .doc(after.swapRequestId)
        .set({
          status: accepted ? "supervisor_accepted" : "supervisor_rejected",
          supervisorResponseAt: admin.firestore.FieldValue.serverTimestamp(),
          supervisorRequestId: requestId
        }, { merge: true });
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
        screen: "solicitudes",
        url: APP_URL,
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
          screen: "solicitudes",
          url: APP_URL,
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

    await workerRequestRef.set({
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

    await event.data.after.ref.set({
      status: "pending_supervisor",
      supervisorRequestId,
      supervisorSubmittedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

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
        screen: "solicitudes",
        url: APP_URL,
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
    const batch = db.batch();

    eligible.forEach((colleague) => {
      const offerId = `${openId}_${colleague.uid}`;
      const offerRef = wsRef.collection("workerSwapRequests").doc(offerId);

      batch.set(offerRef, {
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

    await batch.commit();

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
          screen: "solicitudes",
          url: APP_URL,
          tag: `open-swap-${openId}`,
          requireInteraction: "true"
        }
      })
    ));
    const sent = pushResults.reduce((total, result) => total + result.sent, 0);

    await event.data.ref.set({
      status: "distributed",
      recipientUids: eligible.map((colleague) => colleague.uid),
      recipientCount: eligible.length,
      pushSentCount: sent,
      distributedAt: now,
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
    let won = false;

    await db.runTransaction(async (tx) => {
      const openSnap = await tx.get(openRef);
      const openData = openSnap.data() || {};

      if (openData.winnerRequestId) {
        won = false;
        return;
      }

      tx.set(openRef, {
        winnerRequestId: requestId,
        winnerUid: after.targetUid || "",
        status: "assigned",
        assignedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      won = true;
    });

    if (!won) {
      await requestRef.set({
        status: "superseded",
        supersededAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

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
          screen: "solicitudes",
          url: APP_URL,
          tag: `open-swap-${groupId}`
        }
      });
      return;
    }

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

    const supervisorRequestId = `swap_${requestId}`;
    const createdAt = new Date().toISOString();

    await wsRef.collection("workerRequests").doc(supervisorRequestId).set({
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

    await requestRef.set({
      status: "pending_supervisor",
      supervisorRequestId,
      supervisorSubmittedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

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
        screen: "solicitudes",
        url: APP_URL,
        tag: `open-swap-${groupId}`
      }
    });
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
    const text = String(message.text || "").trim();
    const senderName = String(message.senderName || "trabajador").trim();

    if (
      !senderUid ||
      !targetUid ||
      senderUid === targetUid ||
      !text
    ) {
      return;
    }

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
  const ctaLabel = isGoogleEmail ? "Enlazar mi app" : "Entrar a mi app";
  const accessNote = isGoogleEmail
    ? "Toca el boton para abrir la app e iniciar sesion con tu cuenta Google."
    : "Toca el boton para entrar directo a tu app (sin contrasena). El enlace es personal; no lo compartas.";

  const text = [
    `Hola ${workerName}.`,
    `Te invitamos a enlazar tu aplicacion TurnoPlus Trabajador con ${unit}.`,
    isGoogleEmail
      ? `Abre este enlace e inicia sesion con tu cuenta Google: ${ctaUrl}`
      : `Entra directo con este enlace (es personal, no lo compartas): ${ctaUrl}`,
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
