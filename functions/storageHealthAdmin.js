"use strict";

// Lecturas de la vigilancia del almacenamiento para TurnoPlus-Admin. Logica
// pura sobre un Firestore inyectado (las callables estan en
// storageHealthFunctions.js). Todo lo que sale va por una lista blanca de
// campos: nada de claves de idempotencia, ni el estado interno de seguimiento
// (tracked / baseline), ni secretos.

const { FieldPath } = require("firebase-admin/firestore");
const {
  CONTROL_DOC,
  EVENTS,
  REPORTS,
  UNITS
} = require("./storageHealthMonitor");

const MAX_UNITS = 500;
const DEFAULT_HISTORY_LIMIT = 14;
const MAX_HISTORY_LIMIT = 30;
const DEFAULT_EVENTS_LIMIT = 25;
const MAX_EVENTS_LIMIT = 50;
const MAX_DOCUMENTS_PER_MEASUREMENT = 80;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WORKSPACE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const EVENT_ID_RE = /^[A-Za-z0-9_-]{1,160}$/;

class StorageHealthInputError extends Error {}

function num(value) {
  // Sin dato sigue siendo sin dato: Number(null) y Number("") dan 0, y un 0
  // se leia como "ya sobre 85%" o como la fecha 1970.
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function text(value, max = 300) {
  return value === null || value === undefined ? null : String(value).slice(0, max);
}

function list(value, max = 20) {
  return Array.isArray(value) ? value.slice(0, max).map(item => text(item, 300)) : [];
}

function maskEmail(email) {
  const value = String(email || "").trim();
  const at = value.indexOf("@");

  if (at < 1) return value ? "***" : null;

  return `${value.slice(0, Math.min(2, at))}***${value.slice(at)}`;
}

function sanitizeDocument(item = {}) {
  return {
    moduleId: text(item.moduleId, 120),
    storageKey: text(item.storageKey, 200),
    bytes: num(item.bytes),
    percent: num(item.percent),
    level: text(item.level, 20),
    bytesPerDay: num(item.bytesPerDay),
    daysToCritical: num(item.daysToCritical)
  };
}

function sanitizeAudit(audit = {}) {
  return {
    kind: text(audit.kind, 40),
    issues: num(audit.issues) ?? 0,
    unreadable: Boolean(audit.unreadable),
    legacy: num(audit.legacy),
    archive: num(audit.archive),
    withoutDate: num(audit.withoutDate),
    shards: num(audit.shards),
    records: num(audit.records),
    missingOrDifferent: list(audit.missingOrDifferent),
    missing: list(audit.missing),
    different: list(audit.different),
    extra: list(audit.extra),
    malformed: list(audit.malformed),
    unparseable: list(audit.unparseable),
    mismatched: list(audit.mismatched),
    duplicates: list(audit.duplicates)
  };
}

function sanitizeAuditOverview(value) {
  if (!value || typeof value !== "object") return null;

  return {
    legacy: num(value.legacy),
    archive: num(value.archive),
    issues: num(value.issues) ?? 0,
    unreadable: Boolean(value.unreadable),
    withoutDate: num(value.withoutDate),
    shards: num(value.shards),
    records: num(value.records)
  };
}

function sanitizeMetrics(metrics = {}) {
  return {
    durationMs: num(metrics.durationMs),
    documentsRead: num(metrics.documentsRead),
    shardDocuments: num(metrics.shardDocuments)
  };
}

function sanitizeDelivery(delivery = {}) {
  return {
    status: text(delivery.status, 40),
    attempts: num(delivery.attempts) ?? 0,
    lastAttemptAtMillis: num(delivery.lastAttemptAtMillis),
    sentAtMillis: num(delivery.sentAtMillis),
    providerId: text(delivery.providerId, 120),
    lastError: text(delivery.lastError, 300)
  };
}

function sanitizeUnit(data = {}, account = null) {
  const overview = data.overview || {};
  const monitoring = data.monitoring || {};

  return {
    workspaceId: text(data.workspaceId, 128),
    workspaceName: text(data.workspaceName, 200),
    ownerUid: text(data.ownerUid, 128),
    account,
    status: text(data.status, 20) || "normal",
    reportDate: text(data.reportDate, 10),
    measuredAtMillis: num(data.measuredAtMillis),
    monitoring: {
      status: text(monitoring.status, 20),
      since: num(monitoring.since),
      lastSuccessAtMillis: num(monitoring.lastSuccessAtMillis),
      failedAtMillis: num(monitoring.failedAtMillis),
      lastError: text(monitoring.lastError, 300)
    },
    largest: overview.largest ? sanitizeDocument(overview.largest) : null,
    warningDocuments: num(overview.warningDocuments) ?? 0,
    criticalDocuments: num(overview.criticalDocuments) ?? 0,
    auditLog: sanitizeAuditOverview(overview.auditLog),
    auditLogShards: sanitizeAuditOverview(overview.auditLogShards),
    replacements: sanitizeAuditOverview(overview.replacements),
    alerts: {
      documents: (data.alerts?.documents || []).slice(0, 50).map(sanitizeDocument),
      audits: (data.alerts?.audits || []).slice(0, 10).map(audit => ({
        kind: text(audit.kind, 40),
        issues: num(audit.issues) ?? 0,
        unreadable: Boolean(audit.unreadable)
      }))
    },
    lastAlertAtMillis: num(data.lastAlertAtMillis),
    lastRecoveryAtMillis: num(data.lastRecoveryAtMillis),
    metrics: sanitizeMetrics(data.metrics)
  };
}

function sanitizeSummary(data = {}) {
  return {
    date: text(data.date, 10),
    runId: text(data.runId, 120),
    trigger: text(data.trigger, 20),
    generatedAtMillis: num(data.generatedAtMillis),
    units: num(data.units) ?? 0,
    counts: {
      normal: num(data.counts?.normal) ?? 0,
      warning: num(data.counts?.warning) ?? 0,
      critical: num(data.counts?.critical) ?? 0,
      incomplete: num(data.counts?.incomplete) ?? 0
    },
    incomplete: list(data.incomplete, 50),
    complete: data.complete !== false,
    unitsWithAuditIssues: num(data.unitsWithAuditIssues) ?? 0,
    measuredDocuments: num(data.measuredDocuments),
    documentsRead: num(data.documentsRead),
    shardDocuments: num(data.shardDocuments),
    durationMs: num(data.durationMs),
    changes: num(data.changes) ?? 0,
    delivery: {
      status: text(data.delivery?.status, 40),
      events: num(data.delivery?.events) ?? 0,
      remaining: num(data.delivery?.remaining),
      error: text(data.delivery?.error, 300)
    },
    top: (data.top || []).slice(0, 10).map(item => ({
      workspaceName: text(item.workspaceName, 200),
      ...sanitizeDocument(item)
    }))
  };
}

function sanitizeMeasurement(data = {}) {
  return {
    date: text(data.date, 10),
    runId: text(data.runId, 120),
    workspaceId: text(data.workspaceId, 128),
    workspaceName: text(data.workspaceName, 200),
    measuredAtMillis: num(data.measuredAtMillis),
    status: text(data.status, 20),
    incomplete: Boolean(data.incomplete),
    error: text(data.error, 300),
    documents: (data.documents || []).slice(0, MAX_DOCUMENTS_PER_MEASUREMENT).map(sanitizeDocument),
    documentsTotal: Array.isArray(data.documents) ? data.documents.length : 0,
    audits: (data.audits || []).slice(0, 10).map(sanitizeAudit),
    metrics: sanitizeMetrics(data.metrics)
  };
}

function sanitizeEvent(data = {}) {
  const detail = data.detail || {};

  return {
    eventId: text(data.eventId, 120),
    type: text(data.type, 40),
    workspaceId: text(data.workspaceId, 128),
    workspaceName: text(data.workspaceName, 200),
    subject: text(data.subject, 300),
    from: text(data.from, 20),
    to: text(data.to, 20),
    direction: text(data.direction, 20),
    line: text(data.line, 500),
    date: text(data.date, 10),
    detectedAtMillis: num(data.detectedAtMillis),
    detail: {
      moduleId: text(detail.moduleId, 120),
      storageKey: text(detail.storageKey, 200),
      percent: num(detail.percent),
      daysToCritical: num(detail.daysToCritical),
      kind: text(detail.kind, 40),
      issues: num(detail.issues),
      unreadable: Boolean(detail.unreadable),
      error: text(detail.error, 300)
    },
    deliveryPending: data.deliveryPending === true,
    delivery: sanitizeDelivery(data.delivery)
  };
}

async function readAccounts(db, ownerUids) {
  const accounts = new Map();

  await Promise.all([...ownerUids].map(async uid => {
    try {
      const snap = await db.doc(`users/${uid}`).get();
      const data = snap.exists ? snap.data() || {} : {};

      accounts.set(uid, {
        uid,
        email: text(data.email, 254),
        name: text(data.displayName || data.name, 200)
      });
    } catch {
      accounts.set(uid, { uid, email: null, name: null });
    }
  }));

  return accounts;
}

/**
 * Estado general: ultima revision, unidades por estado, comparaciones y
 * notificaciones.
 *
 * @param {Object} notifications { recipient, apiKeyConfigured, from }
 */
async function getStorageHealthOverviewData({ db, notifications = {}, now = Date.now() }) {
  const [unitsSnap, latestSnap, controlSnap, pendingSnap] = await Promise.all([
    db.collection(UNITS).limit(MAX_UNITS).get(),
    db.collection(REPORTS).orderBy("date", "desc").limit(1).get(),
    db.doc(CONTROL_DOC).get(),
    db.collection(EVENTS).where("deliveryPending", "==", true).limit(201).get()
  ]);
  const allRows = unitsSnap.docs.map(doc => ({ workspaceId: doc.id, ...(doc.data() || {}) }));
  // Una unidad borrada sale del panel aunque la revision aun no la marque:
  // se cruza contra las unidades que existen hoy. Su historial (informes y
  // eventos) se conserva y sigue disponible por getStorageHealthHistory.
  const exists = await Promise.all(allRows.map(async row => {
    if (row.status === "deleted") return false;
    try {
      return (await db.doc(`workspaces/${row.workspaceId}`).get()).exists;
    } catch {
      return true;
    }
  }));
  const rows = allRows.filter((row, index) => exists[index]);
  const removedUnits = allRows
    .filter((row, index) => !exists[index])
    .slice(0, 50)
    .map(row => ({
      workspaceId: text(row.workspaceId, 128),
      workspaceName: text(row.workspaceName, 200),
      deletedDetectedAtMillis: num(row.deletedDetectedAtMillis)
    }));
  const ownerUids = new Set(rows.map(row => String(row.ownerUid || "")).filter(Boolean));
  const accounts = await readAccounts(db, ownerUids);
  const units = rows
    .map(row => sanitizeUnit(row, row.ownerUid ? accounts.get(String(row.ownerUid)) || null : null))
    .sort((a, b) => String(a.workspaceName || "").localeCompare(String(b.workspaceName || ""), "es"));
  const control = controlSnap.exists ? controlSnap.data() || {} : {};
  const lock = control.lock && Number(control.lock.expiresAtMillis || 0) > now ? control.lock : null;
  const counts = { normal: 0, warning: 0, critical: 0, incomplete: 0 };

  units.forEach(unit => {
    counts[unit.status] = (counts[unit.status] || 0) + 1;
  });

  const latest = latestSnap.docs[0] ? sanitizeSummary(latestSnap.docs[0].data()) : null;
  const status = !latest
    ? "unknown"
    : counts.critical ? "critical"
      : counts.incomplete ? "incomplete"
        : counts.warning ? "warning"
          : "normal";

  return {
    generatedAtMillis: now,
    status,
    latestRun: latest,
    lastRun: control.lastRun ? {
      runId: text(control.lastRun.runId, 120),
      mode: text(control.lastRun.mode, 20),
      trigger: text(control.lastRun.trigger, 20),
      startedAtMillis: num(control.lastRun.startedAtMillis),
      finishedAtMillis: num(control.lastRun.finishedAtMillis),
      ok: control.lastRun.ok !== false,
      error: text(control.lastRun.error, 300)
    } : null,
    running: lock ? {
      mode: text(lock.mode, 20),
      trigger: text(lock.trigger, 20),
      startedAtMillis: num(lock.startedAtMillis)
    } : null,
    counts: { total: units.length, ...counts },
    removedUnits,
    auditIssues: units.filter(unit =>
      [unit.auditLog, unit.auditLogShards, unit.replacements].some(audit => audit?.issues > 0)).length,
    notifications: {
      recipientConfigured: Boolean(String(notifications.recipient || "").trim()),
      recipient: maskEmail(notifications.recipient),
      apiKeyConfigured: Boolean(notifications.apiKeyConfigured),
      pendingEvents: pendingSnap.docs.length > 200 ? "200+" : pendingSnap.docs.length,
      lastDelivery: control.lastDelivery ? {
        status: text(control.lastDelivery.status, 40),
        events: num(control.lastDelivery.events) ?? 0,
        remaining: num(control.lastDelivery.remaining),
        atMillis: num(control.lastDelivery.atMillis),
        error: text(control.lastDelivery.error, 300)
      } : null,
      lastTestAlertAtMillis: num(control.lastTestAlertAtMillis)
    },
    units
  };
}

function boundedInt(value, fallback, max) {
  const number = Math.floor(Number(value));

  if (!Number.isFinite(number) || number < 1) return fallback;

  return Math.min(number, max);
}

function optionalDate(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (!DATE_RE.test(String(value))) throw new StorageHealthInputError(`${field} debe ser AAAA-MM-DD.`);

  return String(value);
}

/**
 * Historial paginado. Mediciones por fecha (descendente) y eventos.
 *
 * @param {Object} params
 * @param {string} [params.workspaceId] sin unidad: resumenes diarios globales
 * @param {string} [params.fromDate] AAAA-MM-DD, inclusive
 * @param {string} [params.toDate] AAAA-MM-DD, inclusive
 * @param {string} [params.cursor] la fecha desde la que seguir (exclusiva)
 * @param {number} [params.limit] dias por pagina (max 30)
 * @param {string} [params.eventsCursor] id del ultimo evento recibido (exclusivo)
 * @param {number} [params.eventsLimit] eventos por pagina (max 50)
 */
async function getStorageHealthHistoryData({ db, params = {} }) {
  const workspaceId = params.workspaceId ? String(params.workspaceId) : null;

  if (workspaceId && !WORKSPACE_ID_RE.test(workspaceId)) {
    throw new StorageHealthInputError("Unidad invalida.");
  }

  const fromDate = optionalDate(params.fromDate, "fromDate");
  const toDate = optionalDate(params.toDate, "toDate");
  const cursor = optionalDate(params.cursor, "cursor");
  const limit = boundedInt(params.limit, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT);
  const eventsLimit = boundedInt(params.eventsLimit, DEFAULT_EVENTS_LIMIT, MAX_EVENTS_LIMIT);
  const eventsCursor = params.eventsCursor ? String(params.eventsCursor) : null;

  if (eventsCursor && !EVENT_ID_RE.test(eventsCursor)) {
    throw new StorageHealthInputError("Cursor de eventos invalido.");
  }
  const includeEvents = params.includeEvents !== false;
  const includeMeasurements = params.includeMeasurements !== false;

  if (fromDate && toDate && fromDate > toDate) {
    throw new StorageHealthInputError("fromDate no puede ser posterior a toDate.");
  }

  let measurements = [];
  let nextCursor = null;

  if (includeMeasurements) {
    let query = db.collection(REPORTS).orderBy("date", "desc");

    if (toDate) query = query.where("date", "<=", toDate);
    if (cursor) query = query.where("date", "<", cursor);
    if (fromDate) query = query.where("date", ">=", fromDate);

    const daysSnap = await query.limit(limit + 1).get();
    const days = daysSnap.docs.slice(0, limit);

    nextCursor = daysSnap.docs.length > limit ? String(days[days.length - 1].data()?.date || days[days.length - 1].id) : null;

    if (workspaceId) {
      const snaps = await Promise.all(days.map(day =>
        db.doc(`${REPORTS}/${day.id}/units/${workspaceId}`).get()));

      measurements = snaps
        .filter(snap => snap.exists)
        .map(snap => sanitizeMeasurement(snap.data()));
    } else {
      measurements = days.map(day => sanitizeSummary(day.data()));
    }
  }

  let events = [];
  let nextEventsCursor = null;

  if (includeEvents) {
    // Paginacion por id de documento: es unico, asi que nunca salta ni repite
    // eventos aunque muchos compartan el mismo milisegundo, y no necesita
    // indice compuesto (igualdad + __name__ lo resuelven los indices de un
    // campo). Firestore solo recorre __name__ en orden ASCENDENTE, por eso el
    // id empieza con la fecha invertida (eventIdPrefix): ascendente = mas
    // reciente primero, por dia. Dentro de una pagina se reordena por hora.
    let query = db.collection(EVENTS);

    if (workspaceId) query = query.where("workspaceId", "==", workspaceId);
    query = query.orderBy(FieldPath.documentId());
    if (eventsCursor) query = query.startAfter(eventsCursor);

    const docs = (await query.limit(eventsLimit + 1).get()).docs;
    const page = docs.slice(0, eventsLimit);

    events = page
      .map(doc => sanitizeEvent({ eventId: doc.id, ...(doc.data() || {}) }))
      .sort((a, b) => Number(b.detectedAtMillis || 0) - Number(a.detectedAtMillis || 0));
    nextEventsCursor = docs.length > eventsLimit ? page[page.length - 1].id : null;
  }

  return {
    workspaceId,
    limit,
    measurements,
    nextCursor,
    events,
    nextEventsCursor
  };
}

function sanitizeRunResult(result = {}) {
  if (result.mode === "deliveries") {
    return {
      mode: "deliveries",
      runId: text(result.runId, 120),
      durationMs: num(result.durationMs),
      delivery: {
        status: text(result.delivery?.status, 40),
        events: num(result.delivery?.events) ?? 0,
        remaining: num(result.delivery?.remaining),
        error: text(result.delivery?.error, 300)
      }
    };
  }

  return { mode: "full", ...sanitizeSummary(result) };
}

module.exports = {
  MAX_EVENTS_LIMIT,
  MAX_HISTORY_LIMIT,
  StorageHealthInputError,
  getStorageHealthHistoryData,
  getStorageHealthOverviewData,
  maskEmail,
  sanitizeEvent,
  sanitizeRunResult,
  sanitizeUnit
};
