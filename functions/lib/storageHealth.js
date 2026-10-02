"use strict";

// Vigilancia diaria del tamano de los documentos de Firestore (fase 1 del plan
// de migracion de almacenamiento, 2026-10-02).
//
// Firestore no admite documentos de mas de 1 MiB: cuando una clave del estado
// lo cruza, sus escrituras fallan y los datos dejan de guardarse. Aqui va la
// logica PURA (sin Firestore) para poder probarla: estimar tamanos, decidir el
// nivel, medir crecimiento entre dos informes y comparar los formatos viejo y
// nuevo de la bitacora y de los reemplazos. La funcion programada vive en
// functions/storageHealthMonitor.js.

const FIRESTORE_DOCUMENT_LIMIT_BYTES = 1024 * 1024;
const WARNING_RATIO = 0.70;
const CRITICAL_RATIO = 0.85;
// Lo recien escrito en el formato viejo puede no haber llegado todavia al
// nuevo (la copia se escribe despues): no cuenta como diferencia.
const RECENT_WRITE_GRACE_MS = 15 * 60 * 1000;

const LEVEL_RANK = { healthy: 0, warning: 1, critical: 2 };

function utf8Bytes(value) {
  return Buffer.byteLength(String(value ?? ""), "utf8");
}

function isTimestampLike(value) {
  return Boolean(value) && typeof value === "object" && (
    typeof value.toMillis === "function" ||
    (
      Number.isFinite(Number(value.seconds ?? value._seconds)) &&
      Number.isFinite(Number(value.nanoseconds ?? value._nanoseconds ?? 0))
    )
  );
}

// Mismo calculo que js/firestoreDocumentHealth.js (la alerta del navegador):
// las dos vigilancias tienen que dar la misma cifra.
function estimateFirestoreValueBytes(value) {
  if (value === null || value === undefined) return 1;
  if (typeof value === "boolean") return 1;
  if (typeof value === "number" || typeof value === "bigint") return 8;
  if (typeof value === "string") return utf8Bytes(value) + 1;
  if (value instanceof Date || isTimestampLike(value)) return 8;

  if (Array.isArray(value)) {
    return value.reduce(
      (total, item) => total + estimateFirestoreValueBytes(item),
      0
    );
  }

  if (typeof value === "object") {
    return 32 + Object.entries(value).reduce(
      (total, [key, item]) =>
        total + utf8Bytes(key) + 1 + estimateFirestoreValueBytes(item),
      0
    );
  }

  return utf8Bytes(value) + 1;
}

function estimateFirestoreDocumentBytes(data = {}, documentPath = "") {
  return 32 + utf8Bytes(documentPath) + 1 + Object.entries(data || {}).reduce(
    (total, [key, value]) =>
      total + utf8Bytes(key) + 1 + estimateFirestoreValueBytes(value),
    0
  );
}

function healthLevel(bytes, limitBytes = FIRESTORE_DOCUMENT_LIMIT_BYTES) {
  const ratio = Number(bytes || 0) / limitBytes;

  if (ratio >= CRITICAL_RATIO) return "critical";
  if (ratio >= WARNING_RATIO) return "warning";

  return "healthy";
}

function percentOf(bytes, limitBytes = FIRESTORE_DOCUMENT_LIMIT_BYTES) {
  return Math.round((Number(bytes || 0) / limitBytes) * 1000) / 10;
}

/**
 * Crecimiento diario de un documento entre dos informes y cuantos dias faltan
 * para llegar al nivel critico a ese ritmo.
 *
 * @returns {{bytesPerDay: number|null, daysToCritical: number|null}}
 *   null cuando no hay informe anterior o no crece.
 */
function growthBetween({ bytes, previousBytes, elapsedMs }) {
  if (
    !Number.isFinite(Number(previousBytes)) ||
    !Number.isFinite(Number(elapsedMs)) ||
    Number(elapsedMs) <= 0
  ) {
    return { bytesPerDay: null, daysToCritical: null };
  }

  const days = Number(elapsedMs) / (24 * 60 * 60 * 1000);
  const bytesPerDay = Math.round((Number(bytes) - Number(previousBytes)) / days);
  const criticalBytes = FIRESTORE_DOCUMENT_LIMIT_BYTES * CRITICAL_RATIO;

  if (bytesPerDay <= 0) return { bytesPerDay, daysToCritical: null };

  return {
    bytesPerDay,
    daysToCritical: Number(bytes) >= criticalBytes
      ? 0
      : Math.floor((criticalBytes - Number(bytes)) / bytesPerDay)
  };
}

/**
 * Que niveles SUBIERON desde el informe anterior. Solo eso se avisa: un mismo
 * documento en "warning" dos dias seguidos no vuelve a avisar.
 */
function levelIncreases(previousLevels = {}, currentLevels = {}) {
  return Object.entries(currentLevels)
    .filter(([key, level]) =>
      (LEVEL_RANK[level] || 0) > (LEVEL_RANK[previousLevels[key]] || 0)
    )
    .map(([key, level]) => ({ key, from: previousLevels[key] || "healthy", to: level }));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonical(value[key])])
  );
}

function signature(value) {
  return JSON.stringify(canonical(value));
}

function isRecent(isoValue, now) {
  const time = Date.parse(String(isoValue || ""));

  return Number.isFinite(time) && now - time < RECENT_WRITE_GRACE_MS;
}

/**
 * Bitacora: cada registro del formato viejo tiene que estar IGUAL en los
 * fragmentos. Los fragmentos guardan ademas lo que el viejo ya podo: eso no es
 * diferencia.
 *
 * @param {Array} legacyLogs registros del documento log/auditLog
 * @param {Array} shardLogs registros de todos los fragmentos
 */
function compareAuditLogFormats(legacyLogs = [], shardLogs = [], now = Date.now()) {
  const archived = new Map(
    (shardLogs || [])
      .filter(log => String(log?.id || "").trim())
      .map(log => [String(log.id).trim(), log])
  );
  const missingOrDifferent = (legacyLogs || []).filter(log => {
    const id = String(log?.id || "").trim();

    if (!id || isRecent(log?.canceledAt || log?.createdAt, now)) return false;

    const current = archived.get(id);

    return !current || signature(current) !== signature(log);
  });

  return {
    legacy: (legacyLogs || []).length,
    archive: archived.size,
    missingOrDifferent: missingOrDifferent.map(log => String(log.id)).slice(0, 20),
    issues: missingOrDifferent.length
  };
}

/**
 * Reemplazos: los vigentes del formato viejo contra los documentos
 * individuales no borrados. Mismo criterio que scripts/audit-replacement-records.mjs.
 *
 * @param {Array} legacyRecords la lista vieja `replacements`
 * @param {Array} recordDocs datos de replacementRecords/{id}
 */
function compareReplacementFormats(legacyRecords = [], recordDocs = [], now = Date.now()) {
  const legacy = new Map(
    (legacyRecords || [])
      .filter(record => String(record?.id ?? "").trim())
      .map(record => [String(record.id).trim(), record])
  );
  const individual = new Map();
  let withoutDate = 0;

  (recordDocs || []).forEach(data => {
    const id = String(data?.recordId || data?.record?.id || "").trim();

    if (!id || data?.deleted === true || !data?.record) return;

    individual.set(id, data.record);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date || ""))) withoutDate++;
  });

  const missing = [];
  const different = [];

  legacy.forEach((record, id) => {
    if (isRecent(record?.canceledAt || record?.createdAt, now)) return;
    if (!individual.has(id)) missing.push(id);
    else if (signature(record) !== signature(individual.get(id))) different.push(id);
  });

  const extra = [...individual.keys()].filter(id => !legacy.has(id));

  return {
    legacy: legacy.size,
    archive: individual.size,
    missing: missing.slice(0, 20),
    different: different.slice(0, 20),
    extra: extra.slice(0, 20),
    // Conocido y pendiente (fase 5): no dispara aviso, solo se informa.
    withoutDate,
    issues: missing.length + different.length + extra.length
  };
}

module.exports = {
  FIRESTORE_DOCUMENT_LIMIT_BYTES,
  WARNING_RATIO,
  CRITICAL_RATIO,
  RECENT_WRITE_GRACE_MS,
  estimateFirestoreValueBytes,
  estimateFirestoreDocumentBytes,
  healthLevel,
  percentOf,
  growthBetween,
  levelIncreases,
  compareAuditLogFormats,
  compareReplacementFormats
};
