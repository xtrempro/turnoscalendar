"use strict";

// Autorizacion del administrador global (TurnoPlus-Admin), compartida por las
// callables de cuentas (getAccountsAndUnits.js) y las de salud del
// almacenamiento (storageHealthFunctions.js). Decide con el token verificado
// por Firebase Auth y con adminUsers/{uid}: nunca con un correo que mande el
// cliente en los datos de la llamada.

const { isAuthorizedAdminIdentity, normalizeEmail } = require("../getAccountsAndUnitsCore");

const DEFAULT_ADMIN_EMAILS = ["tm.alanplaza@gmail.com"];

function configuredAdminEmails(env = process.env) {
  const configured = String(env.ADMIN_EMAILS || "")
    .trim()
    .slice(0, 4000)
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);

  return configured.length ? configured : DEFAULT_ADMIN_EMAILS.map(normalizeEmail);
}

/**
 * @param {Object} deps
 * @param {Object} deps.db Firestore (Admin SDK)
 * @param {Function} deps.HttpsError la clase de firebase-functions/v2/https
 * @param {Object} [deps.logger]
 * @param {Object} [deps.env] para las pruebas
 */
function createAdminGuard({ db, HttpsError, logger = console, env = process.env }) {
  async function isAdminCaller(auth) {
    if (!auth?.uid) return false;

    let hasAdminDocument = false;
    try {
      const adminDoc = await db.collection("adminUsers").doc(auth.uid).get();
      hasAdminDocument = adminDoc.exists && adminDoc.data()?.active !== false;
    } catch (error) {
      logger.warn("No se pudo consultar adminUsers.", { message: error.message });
    }

    return isAuthorizedAdminIdentity({
      token: auth.token || {},
      hasAdminDocument,
      configuredEmails: configuredAdminEmails(env)
    });
  }

  async function requireAdmin(auth) {
    if (!auth?.uid) {
      throw new HttpsError("unauthenticated", "Inicia sesión para continuar.");
    }

    if (!await isAdminCaller(auth)) {
      throw new HttpsError(
        "permission-denied",
        "Esta cuenta no tiene permisos de administrador global."
      );
    }
  }

  return { isAdminCaller, requireAdmin };
}

module.exports = {
  DEFAULT_ADMIN_EMAILS,
  configuredAdminEmails,
  createAdminGuard
};
