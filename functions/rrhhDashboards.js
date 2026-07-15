"use strict";

// ============================================================================
//  rrhhDashboards — Cloud Functions (v2 callable) para el Dashboard RRHH
// ============================================================================
//
//  Modelo de "dashboard" explícito (Opción C): el admin global arma, desde
//  TurnoPlus-Admin, un dashboard que enlaza a un DIRECTOR (viewer) con un
//  conjunto de UNIDADES (workspaces). El director ve solo esas unidades en la
//  app Dashboard, sin necesidad de ser miembro de cada una.
//
//  rrhhDashboards/{dashboardId} = {
//    name, viewerUids:[], viewerEmails:[], workspaceIds:[],
//    createdByUid, createdAt, updatedAt
//  }
//
//  Escritura: solo admin global (estas callables, Admin SDK). Los clientes no
//  acceden a la colección directamente (regla deny-all).
// ============================================================================

const admin = require("firebase-admin");
const { logger } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { isAuthorizedAdminIdentity, normalizeEmail } = require("./getAccountsAndUnitsCore");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = "southamerica-west1";
const ENFORCE_APP_CHECK = true;
const DEFAULT_ADMIN_EMAILS = ["tm.alanplaza@gmail.com"];
const MAX_WORKSPACES = 200;
const MAX_VIEWERS = 20;

function cleanText(v, max = 160) { return String(v || "").trim().slice(0, max); }

function configuredAdminEmails() {
    const configured = cleanText(process.env.ADMIN_EMAILS, 4000)
        .split(",").map(normalizeEmail).filter(Boolean);
    return configured.length ? configured : DEFAULT_ADMIN_EMAILS.map(normalizeEmail);
}

async function requireAdmin(auth) {
    if (!auth?.uid) throw new HttpsError("unauthenticated", "Inicia sesión para continuar.");
    let hasAdminDocument = false;
    try {
        const doc = await db.collection("adminUsers").doc(auth.uid).get();
        hasAdminDocument = doc.exists && doc.data()?.active !== false;
    } catch (e) { logger.warn("No se pudo leer adminUsers.", { message: e.message }); }
    const ok = isAuthorizedAdminIdentity({
        token: auth.token || {}, hasAdminDocument, configuredEmails: configuredAdminEmails()
    });
    if (!ok) throw new HttpsError("permission-denied", "Requiere administrador global.");
}

// Resuelve correos → uids vía Firebase Auth. Devuelve { uids, emails, notFound }.
async function resolveViewers(emails) {
    const list = [...new Set((emails || []).map(normalizeEmail).filter(Boolean))].slice(0, MAX_VIEWERS);
    const uids = [];
    const resolvedEmails = [];
    const notFound = [];
    for (const email of list) {
        try {
            const user = await admin.auth().getUserByEmail(email);
            uids.push(user.uid);
            resolvedEmails.push(user.email ? normalizeEmail(user.email) : email);
        } catch { notFound.push(email); }
    }
    return { uids, emails: resolvedEmails, notFound };
}

// ---- saveRrhhDashboard: crea/actualiza un dashboard ----
const saveRrhhDashboard = onCall(
    { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30 },
    async (request) => {
        await requireAdmin(request.auth);
        const data = request.data || {};
        const name = cleanText(data.name, 160);
        const workspaceIds = [...new Set((Array.isArray(data.workspaceIds) ? data.workspaceIds : [])
            .map((id) => cleanText(id, 160)).filter(Boolean))].slice(0, MAX_WORKSPACES);
        if (!name) throw new HttpsError("invalid-argument", "El dashboard necesita un nombre.");

        const { uids, emails, notFound } = await resolveViewers(data.viewerEmails);
        const dashboardId = cleanText(data.dashboardId, 160) ||
            db.collection("rrhhDashboards").doc().id;

        const payload = {
            name,
            viewerUids: uids,
            viewerEmails: emails,
            workspaceIds,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedByUid: request.auth.uid
        };
        const ref = db.collection("rrhhDashboards").doc(dashboardId);
        const existing = await ref.get();
        if (!existing.exists) {
            payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
            payload.createdByUid = request.auth.uid;
        }
        await ref.set(payload, { merge: true });
        logger.info("Dashboard RRHH guardado.", { dashboardId, viewers: uids.length, units: workspaceIds.length });
        return { ok: true, dashboardId, viewers: emails, viewersNotFound: notFound, workspaceIds };
    }
);

// ---- listRrhhDashboards: lista todos los dashboards (admin) ----
const listRrhhDashboards = onCall(
    { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30 },
    async (request) => {
        await requireAdmin(request.auth);
        const snap = await db.collection("rrhhDashboards").orderBy("name").limit(200).get();
        const dashboards = snap.docs.map((d) => {
            const v = d.data() || {};
            return {
                id: d.id,
                name: String(v.name || d.id),
                viewerEmails: Array.isArray(v.viewerEmails) ? v.viewerEmails : [],
                viewerUids: Array.isArray(v.viewerUids) ? v.viewerUids : [],
                workspaceIds: Array.isArray(v.workspaceIds) ? v.workspaceIds : []
            };
        });
        return { dashboards };
    }
);

// ---- deleteRrhhDashboard ----
const deleteRrhhDashboard = onCall(
    { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30 },
    async (request) => {
        await requireAdmin(request.auth);
        const dashboardId = cleanText(request.data?.dashboardId, 160);
        if (!dashboardId) throw new HttpsError("invalid-argument", "Falta dashboardId.");
        await db.collection("rrhhDashboards").doc(dashboardId).delete();
        logger.info("Dashboard RRHH eliminado.", { dashboardId });
        return { ok: true, dashboardId };
    }
);

module.exports = { saveRrhhDashboard, listRrhhDashboards, deleteRrhhDashboard };
