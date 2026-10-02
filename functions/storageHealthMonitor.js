"use strict";

// Vigilancia diaria del almacenamiento (fase 1 del plan de migracion,
// 2026-10-02). Es SOLO TECNICA: desde 2026-10-02 nada de esto llega a la app de
// supervisores ni a los duenos de las unidades. Lo revisa el administrador en
// TurnoPlus-Admin > Salud del sistema (callables de storageHealthFunctions.js)
// y, si esta configurado, un correo a una direccion tecnica global.
//
// Cada revision, en todas las unidades:
//  - mide cada documento de estado (stateModules/*/entries) y los fragmentos de
//    la bitacora;
//  - calcula el crecimiento contra la medicion anterior de ESA unidad y los dias
//    que faltan al 85 % a ese ritmo;
//  - compara el formato viejo y el nuevo de la bitacora y de los reemplazos en
//    las unidades que los tienen en convivencia (si el viejo no se puede
//    reconstruir, eso es una incidencia, no "sin diferencias");
//  - revisa la integridad de los fragmentos (rotos, ilegibles, ids duplicados).
//
// Donde queda (nada global que crezca con las unidades; ningun cliente lo lee
// ni lo escribe: las reglas lo niegan todo):
//  - storageHealthUnits/{unidad}: estado vigente de la unidad, lo ultimo medido
//    de sus documentos (para el crecimiento) y la LINEA BASE de transiciones ya
//    registradas;
//  - storageHealthEvents/{eventId}: una transicion (sube de nivel, se recupera,
//    aparecen o se van diferencias, la unidad no se pudo medir o vuelve a
//    medirse) con su estado de entrega por correo;
//  - storageHealthReports/{fecha}/units/{unidad}: el detalle del dia;
//  - storageHealthReports/{fecha}: un resumen chico de la ultima revision del dia;
//  - storageHealthRuns/{runId}: cada ejecucion (programada o manual);
//  - storageHealthControl/state: candado, limites de frecuencia y la ultima
//    entrega.
//
// Transiciones y entrega (idempotentes):
//  - cada transicion tiene un id ESTABLE (unidad, objeto, de -> a, fecha) y se
//    crea solo si no existe: repetir la revision el mismo dia no la duplica;
//  - la linea base de la unidad avanza al registrar el evento, no al mandar el
//    correo; lo que falta es la ENTREGA, que vive en el evento
//    (deliveryPending + delivery.status) y se reintenta en cada revision hasta
//    que el proveedor responda bien;
//  - nunca se marca "sent" antes de una respuesta exitosa de Resend; el envio
//    lleva una Idempotency-Key derivada de los ids de los eventos, asi un
//    reintento tras una respuesta perdida no manda el mismo correo dos veces
//    (Resend la recuerda 24 h).
//
// Costo del recorrido: lee TODOS los documentos de estado y TODOS los
// fragmentos de la bitacora de cada unidad, y los fragmentos crecen con el
// tiempo (uno por dia con actividad y por numero de fragmento). No se puede
// leer solo lo nuevo sin perder la auditoria de integridad y la comparacion con
// el formato viejo, asi que cada revision registra cuanto leyo y cuanto tardo
// (metrics por unidad y en el resumen) para ver cuando hara falta acotarlo.
//
// Solo LEE las unidades: escribe unicamente sus documentos en la raiz (nada
// dentro de UCI ni UTI).

const crypto = require("node:crypto");
const logger = require("firebase-functions/logger");
const { applyEntry, parseStoredJSON } = require("./lib/stateReader");
const {
  FIRESTORE_DOCUMENT_LIMIT_BYTES,
  auditShardIntegrity,
  checkAuditLogVersions,
  compareAuditLogFormats,
  compareReplacementFormats,
  estimateFirestoreDocumentBytes,
  growthBetween,
  healthLevel,
  legacyListReadable,
  levelChanges,
  percentOf
} = require("./lib/storageHealth");

const UNITS = "storageHealthUnits";
const EVENTS = "storageHealthEvents";
const REPORTS = "storageHealthReports";
const RUNS = "storageHealthRuns";
const CONTROL_DOC = "storageHealthControl/state";

// Documentos SANOS que se guardan igual: los grandes, para medir su
// crecimiento. El tope es solo para los sanos: un documento en alerta se guarda
// SIEMPRE, sean cuantos sean.
const TRACK_MIN_BYTES = 100 * 1024;
const MAX_HEALTHY_TRACKED_PER_UNIT = 60;
// Eventos por correo; los que sobran salen en la revision siguiente.
const MAX_EVENTS_PER_MESSAGE = 50;
const MAX_PENDING_SCAN = 200;
const LOCK_TTL_MS = 10 * 60 * 1000;
const MANUAL_MIN_INTERVAL_MS = { full: 10 * 60 * 1000, deliveries: 2 * 60 * 1000 };
const TEST_ALERT_MIN_INTERVAL_MS = 5 * 60 * 1000;

class StorageHealthBusyError extends Error {
  constructor(reason, retryAfterMs = null, lockMode = null) {
    super(reason === "running"
      ? "Ya hay una revision en curso."
      : "Se ejecuto hace muy poco; espera antes de repetir.");
    this.reason = reason;
    this.retryAfterMs = retryAfterMs;
    this.lockMode = lockMode;
  }
}

function chileDate(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(now));
}

function docKey(item) {
  return encodeURIComponent(`${item.moduleId}/${item.storageKey}`);
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32);
}

/**
 * Texto de error apto para guardar y mostrar: corto y sin nada con forma de
 * credencial.
 */
function cleanError(error) {
  return String(error?.message || error || "")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/\bre_[A-Za-z0-9_-]+/g, "re_***")
    .slice(0, 300);
}

// Prefijo de los ids de evento: la fecha INVERTIDA (99999999 - AAAAMMDD), asi
// el orden ascendente por id (el unico que Firestore recorre por __name__) es
// "mas reciente primero". Sigue siendo deterministico: no rompe la idempotencia.
function eventIdPrefix(date) {
  const compact = Number(String(date).replace(/-/g, ""));

  return `${String(99999999 - compact).padStart(8, "0")}_${date}`;
}

function eventIdFor({ workspaceId, type, subject, from, to, date }) {
  return `${eventIdPrefix(date)}_${hash([workspaceId, type, subject, from, to, date].join("|"))}`;
}

function alreadyExists(error) {
  return error?.code === 6 || error?.code === "already-exists" ||
    /already exists/i.test(String(error?.message || ""));
}

/**
 * La lista del formato viejo, o null si NO se pudo reconstruir.
 */
function legacyList(entryData) {
  if (!entryData?.storageKey || !legacyListReadable(entryData)) return null;

  const state = {};

  applyEntry(state, entryData);

  const raw = state[entryData.storageKey];

  if (raw === undefined || raw === null) return [];

  const list = parseStoredJSON(raw, null);

  return Array.isArray(list) ? list : null;
}

function shardLogsFrom(shards) {
  const logs = [];

  shards.forEach(({ data }) => {
    Object.values(data?.items || {}).forEach(raw => {
      try {
        const log = typeof raw === "string" ? JSON.parse(raw) : raw;

        if (log && log.id) logs.push(log);
      } catch {
        // Lo cuenta auditShardIntegrity como ilegible.
      }
    });
  });

  return logs;
}

async function measureWorkspace(db, workspaceId, workspace, now) {
  const documents = [];
  const audits = [];
  let documentsRead = 0;
  let auditLogEntry = null;
  let replacementsEntry = null;

  const modules = await db
    .collection(`workspaces/${workspaceId}/stateModules`)
    .listDocuments();

  for (const moduleRef of modules) {
    const entries = await moduleRef.collection("entries").get();

    entries.forEach(entryDoc => {
      const data = entryDoc.data() || {};

      documentsRead++;
      documents.push({
        moduleId: moduleRef.id,
        storageKey: String(data.storageKey || entryDoc.id),
        bytes: estimateFirestoreDocumentBytes(data, entryDoc.ref.path)
      });

      if (moduleRef.id === "log" && data.storageKey === "auditLog") auditLogEntry = data;
      if (moduleRef.id === "turnos" && data.storageKey === "replacements") replacementsEntry = data;
    });
  }

  const shardSnap = await db.collection(`workspaces/${workspaceId}/auditLogShards`).get();
  const shards = [];

  shardSnap.forEach(shardDoc => {
    const data = shardDoc.data() || {};

    documentsRead++;
    shards.push({ id: shardDoc.id, data });
    documents.push({
      moduleId: "auditLogShards",
      storageKey: shardDoc.id,
      bytes: estimateFirestoreDocumentBytes(data, shardDoc.ref.path)
    });
  });

  if (shards.length) {
    audits.push({ kind: "auditLogShards", ...auditShardIntegrity(shards) });
  }

  const legacyAuditLogs = auditLogEntry ? legacyList(auditLogEntry) : [];
  const shardAuditLogs = shardLogsFrom(shards);

  if (String(workspace.auditLogStorage || "").startsWith("shards-") && auditLogEntry) {
    audits.push({
      kind: "auditLog",
      ...compareAuditLogFormats(legacyAuditLogs, shardAuditLogs, now)
    });
  }

  // Version de escritura de la bitacora: aparte de `audits` a proposito, para
  // que no genere eventos, correos ni cambie el estado de la unidad.
  const auditLogVersions = auditLogEntry || shards.length
    ? checkAuditLogVersions(legacyAuditLogs, shardAuditLogs, now)
    : null;

  if (String(workspace.replacementStorage || "").startsWith("records-") && replacementsEntry) {
    const recordsSnap = await db
      .collection(`workspaces/${workspaceId}/replacementRecords`)
      .get();

    documentsRead += recordsSnap.docs.length;
    audits.push({
      kind: "replacements",
      ...compareReplacementFormats(
        legacyList(replacementsEntry),
        recordsSnap.docs.map(item => item.data() || {}),
        now
      )
    });
  }

  return { documents, audits, auditLogVersions, documentsRead, shardDocuments: shards.length };
}

/**
 * Los documentos que se guardan: TODOS los que estan en alerta y, de los
 * sanos, los mas grandes hasta el tope.
 */
function trackedDocuments(documents) {
  const sorted = [...documents].sort((a, b) => b.bytes - a.bytes);
  const alerting = sorted.filter(item => item.level !== "healthy");
  const healthy = sorted
    .filter(item => item.level === "healthy" && item.bytes >= TRACK_MIN_BYTES)
    .slice(0, MAX_HEALTHY_TRACKED_PER_UNIT);

  return [...alerting, ...healthy];
}

const AUDIT_LABELS = {
  auditLog: "bitacora (formato viejo vs fragmentos)",
  auditLogShards: "fragmentos de la bitacora",
  replacements: "reemplazos (formato viejo vs documentos individuales)"
};

function auditLine(name, audit) {
  const label = AUDIT_LABELS[audit.kind] || audit.kind;

  if (audit.unreadable) return `No se pudo reconstruir el formato viejo de ${audit.kind}: ${name}`;
  if (audit.kind === "auditLogShards") {
    return `Fragmentos con problemas: ${name}: ${audit.issues} ` +
      `(rotos ${audit.malformed.length}, ilegibles ${audit.unparseable.length}, ` +
      `clave distinta ${audit.mismatched.length}, ids duplicados ${audit.duplicates.length})`;
  }

  return `Diferencias en ${label}: ${name}: ${audit.issues} (viejo ${audit.legacy}, nuevo ${audit.archive})`;
}

/**
 * Las transiciones de una unidad medida respecto de su linea base.
 */
function measuredTransitions({ name, documents, audits, baseline = {}, monitoring = {} }) {
  const currentLevels = Object.fromEntries(
    documents
      .filter(item => item.level !== "healthy")
      .map(item => [docKey(item), item.level])
  );
  const { raised, recovered } = levelChanges(baseline.levels || {}, currentLevels);
  const byKey = new Map(documents.map(item => [docKey(item), item]));
  const label = key => decodeURIComponent(key);
  const transitions = [];
  const documentDetail = item => item ? {
    moduleId: item.moduleId,
    storageKey: item.storageKey,
    percent: item.percent,
    bytes: item.bytes,
    bytesPerDay: item.bytesPerDay ?? null,
    daysToCritical: item.daysToCritical ?? null
  } : {};

  raised.forEach(({ key, from, to }) => {
    const item = byKey.get(key);

    transitions.push({
      type: "document_level",
      subject: key,
      from,
      to,
      direction: "raised",
      detail: documentDetail(item),
      line: `${to === "critical" ? "CRITICO" : "En observacion"} ${item?.percent ?? "?"}%: ${name} ${label(key)}` +
        (Number.isFinite(item?.daysToCritical) ? ` (al ritmo actual, ${item.daysToCritical} dias al 85%)` : "")
    });
  });
  recovered.forEach(({ key, from, to }) => {
    const item = byKey.get(key);

    transitions.push({
      type: "document_level",
      subject: key,
      from,
      to,
      direction: "recovered",
      detail: documentDetail(item),
      line: `Recuperado: ${name} ${label(key)} bajo de ${from === "critical" ? "85%" : "70%"}` +
        (to === "healthy" ? "" : " (sigue sobre 70%)") +
        (item ? ` (${item.percent}%)` : "")
    });
  });

  const currentAudits = Object.fromEntries(audits.map(audit => [audit.kind, audit.issues > 0]));

  audits.forEach(audit => {
    if (audit.issues > 0 && !baseline.audits?.[audit.kind]) {
      transitions.push({
        type: "audit",
        subject: audit.kind,
        from: "clean",
        to: "issues",
        direction: "raised",
        detail: { kind: audit.kind, issues: audit.issues, unreadable: Boolean(audit.unreadable) },
        line: auditLine(name, audit)
      });
    }
  });
  Object.entries(baseline.audits || {}).forEach(([kind, hadIssues]) => {
    if (hadIssues && currentAudits[kind] === false) {
      transitions.push({
        type: "audit",
        subject: kind,
        from: "issues",
        to: "clean",
        direction: "recovered",
        detail: { kind, issues: 0, unreadable: false },
        line: `Comparacion limpia otra vez: ${name} ${kind}`
      });
    }
  });

  if (monitoring.status === "incomplete") {
    transitions.push({
      type: "monitoring",
      subject: "unit",
      from: "incomplete",
      to: "ok",
      direction: "recovered",
      detail: {},
      line: `La unidad ${name} se volvio a medir completa`
    });
  }

  return {
    transitions,
    // Sin auditorias que desaparecieron (la unidad dejo la convivencia).
    baseline: { levels: currentLevels, audits: currentAudits }
  };
}

function unitStatus({ monitoringStatus, documents, audits }) {
  if (monitoringStatus === "incomplete") return "incomplete";
  if (documents.some(item => item.level === "critical")) return "critical";
  if (documents.some(item => item.level === "warning") || audits.some(audit => audit.issues > 0)) {
    return "warning";
  }

  return "normal";
}

function auditOverview(audits, kind) {
  const audit = audits.find(item => item.kind === kind);

  if (!audit) return null;
  if (kind === "auditLogShards") {
    return { shards: audit.shards, records: audit.records, issues: audit.issues };
  }

  return {
    legacy: audit.legacy ?? null,
    archive: audit.archive ?? null,
    issues: audit.issues,
    unreadable: Boolean(audit.unreadable),
    ...(kind === "replacements" ? { withoutDate: audit.withoutDate ?? 0 } : {})
  };
}

async function registerEvents(db, events, { workspaceId, workspaceName, date, now, runId }) {
  let created = 0;

  for (const event of events) {
    const eventId = eventIdFor({ workspaceId, date, ...event });

    try {
      await db.doc(`${EVENTS}/${eventId}`).create({
        eventId,
        workspaceId,
        workspaceName,
        date,
        detectedAtMillis: now,
        runId,
        ...event,
        deliveryPending: true,
        delivery: {
          status: "pending",
          attempts: 0,
          lastAttemptAtMillis: null,
          sentAtMillis: null,
          providerId: null,
          lastError: null
        }
      });
      created++;
    } catch (error) {
      // Ya registrada (otra revision del mismo dia): no se duplica.
      if (!alreadyExists(error)) throw error;
    }
  }

  return created;
}

/**
 * Manda los eventos con entrega pendiente. Solo un exito del proveedor los
 * marca "sent"; cualquier otro resultado los deja pendientes para la proxima.
 *
 * Outbox: antes de llamar al proveedor, el lote queda en
 * storageHealthControl/state.outbox con sus ids y el CUERPO HTTP COMPLETO ya
 * serializado (from, to, subject, text). Mientras el resultado sea
 * ambiguo ("failed": error del proveedor, red caida o respuesta perdida, o la
 * funcion murio a mitad), los reintentos mandan ESE MISMO lote con la misma
 * Idempotency-Key y EXACTAMENTE el mismo cuerpo, aunque entretanto cambien
 * STORAGE_ALERT_EMAIL o MAIL_FROM (Resend rechaza una clave reutilizada con
 * otro cuerpo); los eventos nuevos esperan al lote siguiente.
 *
 * Un lote solo se suelta sin "sent" si es NUEVO y su primer intento termino en
 * "skipped_*": ahi se sabe que nunca llego al proveedor. Un lote que ya estaba
 * abierto (su primer intento fue ambiguo) se conserva intacto ante CUALQUIER
 * resultado distinto de "sent", incluido un "skipped_*" de un reintento (p. ej.
 * falto la clave un rato): el correo original pudo haber salido, y soltarlo
 * cambiaria la clave y podria duplicarlo.
 */
async function deliverPendingEvents({ db, sendAlert, now = Date.now(), log = logger }) {
  const controlRef = db.doc(CONTROL_DOC);
  const controlSnap = await controlRef.get();
  const outbox = controlSnap.exists ? controlSnap.data()?.outbox || null : null;
  const snap = await db
    .collection(EVENTS)
    .where("deliveryPending", "==", true)
    .limit(MAX_PENDING_SCAN)
    .get();
  const pending = snap.docs
    .map(doc => ({ ref: db.doc(`${EVENTS}/${doc.id}`), data: { eventId: doc.id, ...(doc.data() || {}) } }))
    .sort((a, b) =>
      Number(a.data.detectedAtMillis || 0) - Number(b.data.detectedAtMillis || 0) ||
      String(a.data.eventId).localeCompare(String(b.data.eventId)));
  let batch;
  let message;
  let reusedOutbox = false;

  if (outbox?.batchId && Array.isArray(outbox.eventIds) && outbox.subject && outbox.text) {
    // Reintento del lote abierto: mismos eventos, misma clave, mismo cuerpo.
    reusedOutbox = true;
    const snaps = await Promise.all(outbox.eventIds.map(id => db.doc(`${EVENTS}/${id}`).get()));

    batch = snaps
      .filter(item => item.exists)
      .map(item => ({ ref: db.doc(`${EVENTS}/${item.id}`), data: { eventId: item.id, ...(item.data() || {}) } }));
    message = {
      idempotencyKey: `storage-health-${outbox.batchId}`,
      subject: outbox.subject,
      text: outbox.text,
      // El cuerpo guardado manda: no se vuelve a leer la configuracion.
      body: typeof outbox.body === "string" ? outbox.body : null
    };
  } else {
    if (!pending.length) return { status: "none", events: 0, remaining: 0 };

    batch = pending.slice(0, MAX_EVENTS_PER_MESSAGE);

    const remainingNow = pending.length - batch.length;
    const ids = batch.map(item => item.data.eventId);
    const batchId = `${now}_${hash(ids.join(","))}`;

    message = {
      idempotencyKey: `storage-health-${batchId}`,
      subject: `TurnoPlus: almacenamiento (${batch.length} aviso(s))`,
      text: [
        "Revision del almacenamiento de Firestore (aviso tecnico).",
        "",
        ...batch.map(item => item.data.line),
        ...(remainingNow > 0 ? ["", `Y ${remainingNow} aviso(s) mas pendientes para el proximo correo.`] : []),
        "",
        "Detalle: TurnoPlus-Admin > Salud del sistema."
      ].join("\n")
    };
    // El cuerpo HTTP completo (con from y to de la configuracion de ESTE
    // momento) queda guardado ANTES de llamar al proveedor.
    message.body = typeof sendAlert?.buildBody === "function" ? sendAlert.buildBody(message) : null;
    await controlRef.set({
      outbox: {
        batchId,
        eventIds: ids,
        subject: message.subject,
        text: message.text,
        body: message.body,
        createdAtMillis: now
      }
    }, { merge: true });
  }

  const inBatch = new Set(batch.map(item => item.data.eventId));
  const remaining = pending.filter(item => !inBatch.has(item.data.eventId)).length;
  const idempotencyKey = message.idempotencyKey;

  // Constancia del intento, pero NO como entregado.
  for (const item of batch) {
    if (item.data.deliveryPending === false) continue;
    await item.ref.set({
      delivery: { status: "sending", lastAttemptAtMillis: now, idempotencyKey }
    }, { merge: true });
  }

  let result;

  if (!sendAlert) {
    result = { status: "skipped_no_sender" };
  } else {
    try {
      result = await sendAlert(message);
    } catch (error) {
      result = { status: "failed", error: cleanError(error) };
    }
  }

  const status = String(result?.status || "failed");
  const sent = status === "sent";
  const attempted = sent || status === "failed";

  for (const item of batch) {
    const previous = item.data.delivery || {};

    // Un evento que ya salio en otro lote no se toca.
    if (item.data.deliveryPending === false) continue;

    await item.ref.set({
      deliveryPending: !sent,
      delivery: {
        status,
        attempts: Number(previous.attempts || 0) + (attempted ? 1 : 0),
        lastAttemptAtMillis: now,
        sentAtMillis: sent ? now : null,
        providerId: sent ? String(result.providerId || "") || null : null,
        lastError: sent ? null : cleanError(result?.error || status)
      }
    }, { merge: true });
  }

  const delivery = {
    status,
    events: batch.length,
    remaining,
    atMillis: now,
    error: sent ? null : cleanError(result?.error || status)
  };

  await controlRef.set({
    lastDelivery: delivery,
    // Se cierra con "sent"; un lote NUEVO tambien con "skipped_*" (nunca llego
    // al proveedor). Todo lo demas lo deja abierto para repetirlo identico.
    ...(sent || (!reusedOutbox && status.startsWith("skipped_")) ? { outbox: null } : {})
  }, { merge: true });
  (sent ? log.info : log.warn)("storage health: entrega", delivery);

  return delivery;
}

/**
 * Corre la revision completa. Separado de la funcion programada para poder
 * probarlo con un Firestore de mentira.
 *
 * @param {Object} options
 * @param {Function} [options.clock] reloj real, para medir la duracion
 * @param {string} [options.trigger] "schedule" o "manual"
 * @returns {Promise<Object>} el resumen de la revision
 */
async function runStorageHealthCheck({
  db,
  now = Date.now(),
  clock = Date.now,
  sendAlert = null,
  log = logger,
  trigger = "schedule",
  runId = `run_${now}`,
  requestedBy = null
}) {
  const startedAt = clock();
  const date = chileDate(now);
  const workspaces = await db.collection("workspaces").get();
  const incomplete = [];
  const incompleteIds = [];
  const lines = [];
  const counts = { normal: 0, warning: 0, critical: 0, incomplete: 0 };
  const top = [];
  let measuredDocuments = 0;
  let documentsRead = 0;
  let shardDocuments = 0;
  let eventsCreated = 0;
  let unitsWithAuditIssues = 0;
  let unitsWithUnversionedLogs = 0;

  for (const workspaceDoc of workspaces.docs) {
    const workspaceId = workspaceDoc.id;
    const workspace = workspaceDoc.data() || {};
    const name = String(workspace.name || workspaceId);
    const stateRef = db.doc(`${UNITS}/${workspaceId}`);
    const unitStarted = clock();
    let previous = {};

    try {
      const previousSnap = await stateRef.get();

      previous = previousSnap.exists ? previousSnap.data() || {} : {};
    } catch (error) {
      log.error("storage health: no se pudo leer el estado previo", { workspaceId, error: cleanError(error) });
    }

    const eventContext = { workspaceId, workspaceName: name, date, now, runId };

    try {
      const measured = await measureWorkspace(db, workspaceId, workspace, now);
      const elapsedMs = now - Number(previous.measuredAtMillis || NaN);
      const documents = trackedDocuments(measured.documents.map(item => ({
        ...item,
        percent: percentOf(item.bytes),
        level: healthLevel(item.bytes),
        ...growthBetween({
          bytes: item.bytes,
          previousBytes: previous.tracked?.[docKey(item)],
          elapsedMs
        })
      })));
      const { transitions, baseline } = measuredTransitions({
        name,
        documents,
        audits: measured.audits,
        baseline: previous.baseline,
        monitoring: previous.monitoring
      });
      const metrics = {
        durationMs: Math.max(0, clock() - unitStarted),
        documentsRead: measured.documentsRead + 1,
        shardDocuments: measured.shardDocuments
      };
      const status = unitStatus({ monitoringStatus: "ok", documents, audits: measured.audits });
      const largest = documents[0] || null;

      measuredDocuments += measured.documents.length;
      documentsRead += metrics.documentsRead;
      shardDocuments += metrics.shardDocuments;
      counts[status]++;
      if (measured.audits.some(audit => audit.issues > 0)) unitsWithAuditIssues++;
      lines.push(...transitions.map(item => item.line));
      documents.slice(0, 3).forEach(item => top.push({ workspaceName: name, ...item }));

      // Primero los eventos: si la funcion muere despues, la linea base aun no
      // avanzo y la proxima revision vuelve a llegar al MISMO id.
      eventsCreated += await registerEvents(db, transitions, eventContext);

      await db.doc(`${REPORTS}/${date}/units/${workspaceId}`).set({
        date,
        runId,
        workspaceId,
        workspaceName: name,
        measuredAtMillis: now,
        status,
        incomplete: false,
        documents,
        audits: measured.audits,
        auditLogVersions: measured.auditLogVersions,
        metrics
      });

      if (measured.auditLogVersions?.issues > 0) {
        unitsWithUnversionedLogs++;
        // Solo Cloud Logging y TurnoPlus-Admin: ni eventos ni correos.
        log.warn("storage health: registros de bitacora sin version reciente", {
          workspaceId,
          workspaceName: name,
          unversionedRecent: measured.auditLogVersions.unversionedRecent,
          unversionedIds: measured.auditLogVersions.unversionedIds,
          writerMismatch: measured.auditLogVersions.writerMismatch,
          recentBuilds: measured.auditLogVersions.recentBuilds
        });
      }

      const raisedNow = transitions.some(item => item.direction === "raised");
      const recoveredNow = transitions.some(item => item.direction === "recovered");

      await stateRef.set({
        workspaceId,
        workspaceName: name,
        ownerUid: String(workspace.ownerUid || "") || null,
        status,
        reportDate: date,
        measuredAtMillis: now,
        monitoring: {
          status: "ok",
          since: previous.monitoring?.status === "ok" ? previous.monitoring.since ?? now : now,
          lastSuccessAtMillis: now,
          failedAtMillis: null,
          lastError: null
        },
        baseline,
        alerts: {
          documents: documents
            .filter(item => item.level !== "healthy")
            .map(({ moduleId, storageKey, percent, level, bytesPerDay, daysToCritical }) => ({
              moduleId,
              storageKey,
              percent,
              level,
              bytesPerDay: bytesPerDay ?? null,
              daysToCritical: daysToCritical ?? null
            })),
          audits: measured.audits
            .filter(audit => audit.issues > 0)
            .map(({ kind, issues, unreadable }) => ({ kind, issues, unreadable: Boolean(unreadable) }))
        },
        overview: {
          largest: largest ? {
            moduleId: largest.moduleId,
            storageKey: largest.storageKey,
            bytes: largest.bytes,
            percent: largest.percent,
            level: largest.level,
            bytesPerDay: largest.bytesPerDay ?? null,
            daysToCritical: largest.daysToCritical ?? null
          } : null,
          warningDocuments: documents.filter(item => item.level === "warning").length,
          criticalDocuments: documents.filter(item => item.level === "critical").length,
          auditLog: auditOverview(measured.audits, "auditLog"),
          auditLogShards: auditOverview(measured.audits, "auditLogShards"),
          replacements: auditOverview(measured.audits, "replacements"),
          auditLogVersions: measured.auditLogVersions ? {
            adopted: measured.auditLogVersions.adopted,
            adoptedAtMillis: measured.auditLogVersions.adoptedAtMillis,
            versioned: measured.auditLogVersions.versioned,
            unversionedRecent: measured.auditLogVersions.unversionedRecent,
            writerMismatch: measured.auditLogVersions.writerMismatch.length,
            lastUnversionedAtMillis: measured.auditLogVersions.lastUnversionedAtMillis,
            issues: measured.auditLogVersions.issues
          } : null
        },
        tracked: Object.fromEntries(documents.map(item => [docKey(item), item.bytes])),
        lastAlertAtMillis: raisedNow ? now : previous.lastAlertAtMillis ?? null,
        lastRecoveryAtMillis: recoveredNow ? now : previous.lastRecoveryAtMillis ?? null,
        metrics
      });
    } catch (error) {
      // La unidad conserva sus mediciones, su linea base y sus alertas: solo
      // cambia su estado de monitoreo. La transicion a "incompleta" se registra
      // UNA vez; los dias siguientes no repiten el aviso (si su entrega fallo,
      // el reintento va por el evento).
      const message = cleanError(error);
      const wasIncomplete = previous.monitoring?.status === "incomplete";

      incomplete.push(name);
      incompleteIds.push(workspaceId);
      counts.incomplete++;
      log.error("storage health: no se pudo medir la unidad", { workspaceId, error: message });

      try {
        const transitions = wasIncomplete ? [] : [{
          type: "monitoring",
          subject: "unit",
          from: "ok",
          to: "incomplete",
          direction: "raised",
          detail: { error: message },
          line: `No se pudo medir la unidad ${name}: ${message}`
        }];

        lines.push(...transitions.map(item => item.line));
        eventsCreated += await registerEvents(db, transitions, eventContext);
        await db.doc(`${REPORTS}/${date}/units/${workspaceId}`).set({
          date,
          runId,
          workspaceId,
          workspaceName: name,
          measuredAtMillis: now,
          status: "incomplete",
          incomplete: true,
          error: message,
          metrics: { durationMs: Math.max(0, clock() - unitStarted), documentsRead: 0, shardDocuments: 0 }
        });
        await stateRef.set({
          workspaceId,
          workspaceName: name,
          status: "incomplete",
          monitoring: {
            status: "incomplete",
            since: wasIncomplete ? previous.monitoring.since ?? now : now,
            lastSuccessAtMillis: previous.monitoring?.lastSuccessAtMillis ?? previous.measuredAtMillis ?? null,
            failedAtMillis: now,
            lastError: message
          },
          ...(wasIncomplete ? {} : { lastAlertAtMillis: now })
        }, { merge: true });
      } catch (writeError) {
        log.error("storage health: no se pudo registrar la unidad incompleta", {
          workspaceId,
          error: cleanError(writeError)
        });
      }
    }
  }

  // Unidades que ya no existen: su estado vigente se retira del panel, pero se
  // conserva (con su historial de informes y eventos) marcado como eliminado.
  const activeIds = new Set(workspaces.docs.map(item => item.id));
  const removedUnits = [];

  try {
    const statesSnap = await db.collection(UNITS).get();

    for (const stateDoc of statesSnap.docs) {
      const data = stateDoc.data() || {};

      if (activeIds.has(stateDoc.id) || data.status === "deleted") continue;

      removedUnits.push(stateDoc.id);
      await db.doc(`${UNITS}/${stateDoc.id}`).set({
        status: "deleted",
        deletedDetectedAtMillis: now,
        alerts: { documents: [], audits: [] }
      }, { merge: true });
    }
  } catch (error) {
    log.error("storage health: no se pudieron revisar las unidades eliminadas", { error: cleanError(error) });
  }

  if (lines.length) log.warn("storage health: transiciones", { lines });

  let delivery;

  try {
    delivery = await deliverPendingEvents({ db, sendAlert, now, log });
  } catch (error) {
    delivery = { status: "failed", events: 0, remaining: null, error: cleanError(error) };
    log.error("storage health: no se pudieron revisar las entregas", { error: delivery.error });
  }

  const durationMs = Math.max(0, clock() - startedAt);
  const summary = {
    date,
    runId,
    trigger,
    generatedAt: new Date(now).toISOString(),
    generatedAtMillis: now,
    limitBytes: FIRESTORE_DOCUMENT_LIMIT_BYTES,
    units: workspaces.docs.length,
    counts,
    incomplete,
    incompleteIds,
    complete: incomplete.length === 0,
    unitsWithAuditIssues,
    unitsWithUnversionedLogs,
    removedUnits: removedUnits.length,
    measuredDocuments,
    documentsRead,
    shardDocuments,
    durationMs,
    changes: eventsCreated,
    delivery,
    top: top
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 10)
      .map(({ workspaceName, moduleId, storageKey, percent, level }) =>
        ({ workspaceName, moduleId, storageKey, percent, level }))
  };

  await db.doc(`${REPORTS}/${date}`).set(summary);
  await db.doc(`${RUNS}/${runId}`).set({
    runId,
    mode: "full",
    trigger,
    requestedBy,
    date,
    startedAtMillis: now,
    durationMs,
    units: summary.units,
    counts,
    complete: summary.complete,
    documentsRead,
    changes: eventsCreated,
    deliveryStatus: delivery.status
  });

  log.info("storage health: informe", {
    date,
    trigger,
    units: summary.units,
    measuredDocuments,
    documentsRead,
    shardDocuments,
    durationMs,
    incomplete,
    changes: eventsCreated,
    delivery: delivery.status,
    top: summary.top.map(item => `${item.workspaceName} ${item.storageKey} ${item.percent}%`)
  });

  return { ...summary, lines };
}

/**
 * Candado y limite de frecuencia en storageHealthControl/state. La revision
 * programada respeta el candado (si hay una manual en curso, esa es la del
 * dia); las manuales ademas tienen un intervalo minimo.
 */
async function acquireLock(db, { now, runId, trigger, mode }) {
  const ref = db.doc(CONTROL_DOC);

  await db.runTransaction(async transaction => {
    const snap = await transaction.get(ref);
    const control = snap.exists ? snap.data() || {} : {};
    const lock = control.lock;

    if (lock && Number(lock.expiresAtMillis || 0) > now) {
      throw new StorageHealthBusyError("running", Number(lock.expiresAtMillis) - now, lock.mode || null);
    }

    const lastManual = Number(control.lastManual?.[mode] || 0);
    const interval = MANUAL_MIN_INTERVAL_MS[mode] || MANUAL_MIN_INTERVAL_MS.full;

    if (trigger === "manual" && lastManual && now - lastManual < interval) {
      throw new StorageHealthBusyError("rate_limited", interval - (now - lastManual));
    }

    transaction.set(ref, {
      lock: { runId, trigger, mode, startedAtMillis: now, expiresAtMillis: now + LOCK_TTL_MS },
      ...(trigger === "manual" ? { lastManual: { ...(control.lastManual || {}), [mode]: now } } : {})
    }, { merge: true });
  });

  return async (lastRun) => {
    await db.runTransaction(async transaction => {
      const snap = await transaction.get(ref);
      const control = snap.exists ? snap.data() || {} : {};

      if (control.lock?.runId === runId) {
        transaction.set(ref, {
          lock: null,
          lastRun,
          // La ultima revision COMPLETA que termino bien: la programada la usa
          // para saber si la del dia ya se hizo mientras esperaba el candado.
          ...(mode === "full" && lastRun.ok
            ? { lastFullRun: { runId, date: chileDate(now), startedAtMillis: now, trigger } }
            : {})
        }, { merge: true });
      }
    });
  };
}

/**
 * La revision con candado. mode "full" mide todo; mode "deliveries" solo
 * reintenta las entregas pendientes (idempotente: no crea eventos).
 */
async function runStorageHealthCheckLocked({
  db,
  now = Date.now(),
  clock = Date.now,
  sendAlert = null,
  log = logger,
  trigger = "schedule",
  mode = "full",
  requestedBy = null
}) {
  const runId = `run_${now}_${trigger}_${mode}`;
  const release = await acquireLock(db, { now, runId, trigger, mode });
  let failure = null;

  try {
    if (mode !== "deliveries") {
      return await runStorageHealthCheck({ db, now, clock, sendAlert, log, trigger, runId, requestedBy });
    }

    const started = clock();
    const delivery = await deliverPendingEvents({ db, sendAlert, now, log });
    const result = { runId, mode, trigger, delivery, durationMs: Math.max(0, clock() - started) };

    await db.doc(`${RUNS}/${runId}`).set({
      runId,
      mode,
      trigger,
      requestedBy,
      date: chileDate(now),
      startedAtMillis: now,
      durationMs: result.durationMs,
      deliveryStatus: delivery.status
    });

    return result;
  } catch (error) {
    failure = cleanError(error);
    throw error;
  } finally {
    await release({
      runId,
      mode,
      trigger,
      startedAtMillis: now,
      finishedAtMillis: clock(),
      ok: !failure,
      error: failure
    }).catch(error => log.error("storage health: no se pudo soltar el candado", { error: cleanError(error) }));
  }
}

const SCHEDULE_MAX_WAIT_MS = 4 * 60 * 1000;
const SCHEDULE_POLL_MS = 20 * 1000;

/**
 * La revision programada del dia. Si el candado esta tomado (una manual
 * completa o un reintento de entregas) ESPERA a que se suelte y entonces
 * corre; solo se da por hecha si mientras esperaba termino bien una revision
 * COMPLETA de hoy. Si el candado sigue tomado al agotar la espera, falla: el
 * programador la reintenta (retryCount en storageHealthFunctions.js) en vez de
 * omitir el dia en silencio.
 */
async function runScheduledStorageHealthCheck({
  db,
  sendAlert = null,
  log = logger,
  now = () => Date.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  maxWaitMs = SCHEDULE_MAX_WAIT_MS,
  pollMs = SCHEDULE_POLL_MS
}) {
  const startedAt = now();
  const today = chileDate(startedAt);
  let waited = false;

  for (;;) {
    if (waited) {
      const controlSnap = await db.doc(CONTROL_DOC).get();
      const last = controlSnap.exists ? controlSnap.data()?.lastFullRun : null;

      if (last?.date === today && Number(last.startedAtMillis) >= startedAt - LOCK_TTL_MS) {
        log.info("storage health: la revision del dia ya la hizo otra ejecucion completa", { runId: last.runId });
        return { skipped: "full_run_done", runId: last.runId };
      }
    }

    try {
      return await runStorageHealthCheckLocked({ db, now: now(), sendAlert, log, trigger: "schedule", mode: "full" });
    } catch (error) {
      if (!(error instanceof StorageHealthBusyError) || error.reason !== "running") throw error;
      if (now() - startedAt >= maxWaitMs) {
        throw new Error(`storage health: candado ocupado (${error.lockMode || "?"}) tras ${Math.round(maxWaitMs / 1000)} s; queda para el reintento`);
      }

      log.warn("storage health: candado ocupado, la programada espera", { lockMode: error.lockMode });
      await sleep(pollMs);
      waited = true;
    }
  }
}

/**
 * Correo de prueba: solo al destinatario tecnico configurado. Queda como
 * evento "test" (sin reintentos) para verlo en el historial.
 */
async function sendStorageHealthTestAlert({ db, now = Date.now(), sendAlert, requestedBy = null }) {
  const ref = db.doc(CONTROL_DOC);

  await db.runTransaction(async transaction => {
    const snap = await transaction.get(ref);
    const last = Number((snap.exists ? snap.data() || {} : {}).lastTestAlertAtMillis || 0);

    if (last && now - last < TEST_ALERT_MIN_INTERVAL_MS) {
      throw new StorageHealthBusyError("rate_limited", TEST_ALERT_MIN_INTERVAL_MS - (now - last));
    }

    transaction.set(ref, { lastTestAlertAtMillis: now }, { merge: true });
  });

  const date = chileDate(now);
  const eventId = `${eventIdPrefix(date)}_test_${hash(`${now}|${requestedBy || ""}`)}`;
  let result;

  try {
    result = await sendAlert({
      idempotencyKey: `storage-health-${eventId}`,
      subject: "TurnoPlus: prueba del aviso de almacenamiento",
      text: [
        "Correo de prueba de la vigilancia del almacenamiento.",
        "Si lo recibes, los avisos tecnicos llegan a esta direccion.",
        "",
        "Enviado desde TurnoPlus-Admin > Salud del sistema."
      ].join("\n")
    });
  } catch (error) {
    result = { status: "failed", error: cleanError(error) };
  }

  const status = String(result?.status || "failed");
  const sent = status === "sent";
  const delivery = {
    status,
    attempts: sent || status === "failed" ? 1 : 0,
    lastAttemptAtMillis: now,
    sentAtMillis: sent ? now : null,
    providerId: sent ? String(result.providerId || "") || null : null,
    lastError: sent ? null : cleanError(result?.error || status)
  };

  await db.doc(`${EVENTS}/${eventId}`).set({
    eventId,
    type: "test",
    workspaceId: null,
    workspaceName: null,
    subject: "test",
    from: null,
    to: null,
    direction: "test",
    detail: { requestedBy },
    line: "Correo de prueba",
    date,
    detectedAtMillis: now,
    deliveryPending: false,
    delivery
  });

  return { eventId, delivery };
}

/**
 * El aviso por correo (Resend). Devuelve { status, providerId?, error? }:
 * "sent" solo con respuesta 2xx; sin destinatario o sin clave no se llama al
 * proveedor y lo dice; cualquier otro resultado es "failed".
 */
function createStorageAlertSender({ to, apiKey, from, fetchImpl = fetch }) {
  const recipient = String(to || "").trim();

  // El cuerpo HTTP completo de Resend. null sin destinatario (no hay nada que
  // mandar). Lo guarda el outbox para repetirlo identico.
  function buildBody({ subject, text }) {
    return recipient ? JSON.stringify({ from, to: [recipient], subject, text }) : null;
  }

  const send = async ({ subject, text, idempotencyKey = "", body = null }) => {
    // Un cuerpo ya guardado se manda tal cual: su destinatario y remitente son
    // los del primer intento, no los de la configuracion actual.
    const payload = typeof body === "string" && body ? body : buildBody({ subject, text });

    if (!payload) return { status: "skipped_no_recipient" };
    if (!apiKey) return { status: "skipped_no_api_key" };

    try {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": String(idempotencyKey).slice(0, 256) } : {})
        },
        body: payload
      });

      if (!response.ok) return { status: "failed", error: `Resend ${response.status}` };

      let providerId = null;

      try {
        providerId = String((await response.json())?.id || "") || null;
      } catch {
        providerId = null;
      }

      return { status: "sent", providerId };
    } catch (error) {
      return { status: "failed", error: cleanError(error) };
    }
  };

  send.buildBody = buildBody;

  return send;
}

module.exports = {
  CONTROL_DOC,
  EVENTS,
  MAX_HEALTHY_TRACKED_PER_UNIT,
  REPORTS,
  RUNS,
  StorageHealthBusyError,
  UNITS,
  chileDate,
  cleanError,
  eventIdPrefix,
  createStorageAlertSender,
  deliverPendingEvents,
  runStorageHealthCheck,
  runScheduledStorageHealthCheck,
  runStorageHealthCheckLocked,
  sendStorageHealthTestAlert
};
