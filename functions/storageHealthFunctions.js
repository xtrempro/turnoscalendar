"use strict";

// Vigilancia del almacenamiento: la revision diaria y las cuatro callables de
// TurnoPlus-Admin > Salud del sistema. Todo es tecnico y SOLO para el
// administrador global: ni los supervisores ni los duenos de las unidades ven
// nada de esto (las colecciones storageHealth* no tienen reglas de lectura).
//
// Variables (functions/.env, o .env.<proyecto> para separar test y prod):
//  - STORAGE_ALERT_EMAIL: direccion tecnica GLOBAL que recibe los avisos.
//    Nunca la del dueno de una unidad. Vacia = no se manda correo y las
//    entregas quedan "skipped_no_recipient" (se ven en Admin y se reintentan).
//  - MAIL_FROM: remitente verificado en Resend (compartido con las
//    invitaciones).
//  - RESEND_API_KEY: secreto (firebase functions:secrets:set RESEND_API_KEY).
//    Sin el, las entregas quedan "skipped_no_api_key".

const admin = require("firebase-admin");
const { logger } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret, defineString } = require("firebase-functions/params");
const { createAdminGuard } = require("./lib/adminAuthorization");
const {
  StorageHealthBusyError,
  cleanError,
  createStorageAlertSender,
  runScheduledStorageHealthCheck,
  runStorageHealthCheckLocked,
  sendStorageHealthTestAlert
} = require("./storageHealthMonitor");
const {
  StorageHealthInputError,
  getStorageHealthHistoryData,
  getStorageHealthOverviewData,
  sanitizeRunResult
} = require("./storageHealthAdmin");

if (!admin.apps.length) admin.initializeApp();

const REGION = "southamerica-west1";
const ENFORCE_APP_CHECK = true;
const DEFAULT_MAIL_FROM = "TurnoPlus <onboarding@resend.dev>";

// Los mismos parametros que declara index.js: firebase-functions los
// deduplica por nombre.
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const MAIL_FROM = defineString("MAIL_FROM", { default: DEFAULT_MAIL_FROM });
const STORAGE_ALERT_EMAIL = defineString("STORAGE_ALERT_EMAIL", { default: "" });

function safeMailFrom(value) {
  const from = String(value || DEFAULT_MAIL_FROM).trim();

  return from && !/[\r\n]/.test(from) ? from.slice(0, 320) : DEFAULT_MAIL_FROM;
}

function readNotificationConfig() {
  let apiKey = "";

  try {
    apiKey = RESEND_API_KEY.value() || "";
  } catch {
    apiKey = "";
  }

  return {
    recipient: String(STORAGE_ALERT_EMAIL.value() || "").trim(),
    apiKey,
    from: safeMailFrom(MAIL_FROM.value())
  };
}

function busyToHttps(error) {
  if (error instanceof StorageHealthBusyError) {
    return new HttpsError(
      error.reason === "running" ? "failed-precondition" : "resource-exhausted",
      error.message,
      { reason: error.reason, retryAfterMs: error.retryAfterMs }
    );
  }
  if (error instanceof StorageHealthInputError) {
    return new HttpsError("invalid-argument", error.message);
  }
  if (error instanceof HttpsError) return error;

  return new HttpsError("internal", "No se pudo completar la operacion.", { error: cleanError(error) });
}

/**
 * Los manejadores, con sus dependencias inyectadas para probarlos sin
 * desplegar. Cada uno exige administrador global ANTES de tocar nada.
 */
function createStorageHealthHandlers({
  db,
  requireAdmin,
  config = readNotificationConfig,
  createSender = createStorageAlertSender,
  now = () => Date.now()
}) {
  const sender = () => {
    const { recipient, apiKey, from } = config();

    // Solo al destinatario tecnico configurado: nada que venga del cliente.
    return createSender({ to: recipient, apiKey, from });
  };

  return {
    async overview(request) {
      await requireAdmin(request.auth);

      try {
        const { recipient, apiKey } = config();

        return await getStorageHealthOverviewData({
          db,
          now: now(),
          notifications: { recipient, apiKeyConfigured: Boolean(apiKey) }
        });
      } catch (error) {
        throw busyToHttps(error);
      }
    },

    async history(request) {
      await requireAdmin(request.auth);

      try {
        return await getStorageHealthHistoryData({ db, params: request.data || {} });
      } catch (error) {
        throw busyToHttps(error);
      }
    },

    async runNow(request) {
      await requireAdmin(request.auth);

      const mode = request.data?.mode === "deliveries" ? "deliveries" : "full";

      try {
        const result = await runStorageHealthCheckLocked({
          db,
          now: now(),
          sendAlert: sender(),
          trigger: "manual",
          mode,
          requestedBy: request.auth.uid
        });

        return sanitizeRunResult(result);
      } catch (error) {
        throw busyToHttps(error);
      }
    },

    async testAlert(request) {
      await requireAdmin(request.auth);

      try {
        const result = await sendStorageHealthTestAlert({
          db,
          now: now(),
          sendAlert: sender(),
          requestedBy: request.auth.uid
        });

        return {
          eventId: result.eventId,
          status: result.delivery.status,
          error: result.delivery.lastError
        };
      } catch (error) {
        throw busyToHttps(error);
      }
    }
  };
}

let handlers = null;

function liveHandlers() {
  if (!handlers) {
    const db = admin.firestore();
    const { requireAdmin } = createAdminGuard({ db, HttpsError, logger });

    handlers = createStorageHealthHandlers({ db, requireAdmin });
  }

  return handlers;
}

const callableOptions = { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK };

const getStorageHealthOverview = onCall(
  { ...callableOptions, timeoutSeconds: 60, secrets: [RESEND_API_KEY] },
  request => liveHandlers().overview(request)
);

const getStorageHealthHistory = onCall(
  { ...callableOptions, timeoutSeconds: 60 },
  request => liveHandlers().history(request)
);

// Misma logica que la revision diaria, con candado y limite de frecuencia.
// Lee las unidades; escribe solo en storageHealth* (raiz).
const runStorageHealthCheckNow = onCall(
  { ...callableOptions, timeoutSeconds: 540, memory: "1GiB", secrets: [RESEND_API_KEY] },
  request => liveHandlers().runNow(request)
);

const sendStorageHealthTestAlert_ = onCall(
  { ...callableOptions, timeoutSeconds: 60, secrets: [RESEND_API_KEY] },
  request => liveHandlers().testAlert(request)
);

// Revision diaria: tamano de cada documento de estado, crecimiento,
// comparacion de formatos en migracion e integridad de los fragmentos. Si el
// candado esta tomado espera; si no logra correr, falla y el programador la
// reintenta (nunca se omite el dia en silencio).
const checkStorageHealth = onSchedule(
  {
    schedule: "every day 05:30",
    timeZone: "America/Santiago",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 3,
    minBackoffSeconds: 300,
    secrets: [RESEND_API_KEY]
  },
  async () => {
    const { recipient, apiKey, from } = readNotificationConfig();

    await runScheduledStorageHealthCheck({
      db: admin.firestore(),
      sendAlert: createStorageAlertSender({ to: recipient, apiKey, from })
    });
  }
);

module.exports = {
  checkStorageHealth,
  createStorageHealthHandlers,
  getStorageHealthHistory,
  getStorageHealthOverview,
  runStorageHealthCheckNow,
  sendStorageHealthTestAlert: sendStorageHealthTestAlert_
};
