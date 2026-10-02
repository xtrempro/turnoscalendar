"use strict";

// Vigilancia diaria del almacenamiento (fase 1 del plan de migracion,
// 2026-10-02). Hasta ahora el aviso solo lo veia el dueno con la app abierta en
// esa unidad, o quien corriera a mano scripts/audit-state-document-health.mjs.
//
// Cada dia, en todas las unidades:
//  - mide cada documento de estado (stateModules/*/entries) y los fragmentos de
//    la bitacora;
//  - calcula el crecimiento contra la medicion anterior de ESA unidad y los dias
//    que faltan al 85 % a ese ritmo;
//  - compara el formato viejo y el nuevo de la bitacora y de los reemplazos en
//    las unidades que los tienen en convivencia (si el viejo no se puede
//    reconstruir, eso es una incidencia, no "sin diferencias").
//
// Donde queda (todo FRAGMENTADO por unidad, ningun documento global que crezca
// con las unidades):
//  - storageHealthUnits/{unidad}: sus avisos VIGENTES (los lee el dueno para el
//    banner de la app), lo ultimo medido de sus documentos grandes (para el
//    crecimiento) y lo que ya se aviso por correo;
//  - storageHealthReports/{fecha}/units/{unidad}: el detalle del dia;
//  - storageHealthReports/{fecha}: un resumen chico (unidades, incompletas,
//    cambios, entrega del correo).
//
// El correo avisa CAMBIOS: un documento que sube a 70 % u 85 %, uno que se
// recupera, una comparacion que encuentra diferencias o que vuelve a quedar
// limpia, y las unidades que no se pudieron medir. Lo avisado solo se da por
// avisado si el correo SALIO: si falla (o falta destinatario o clave), al dia
// siguiente se vuelve a intentar.
//
// Solo LEE las unidades: escribe unicamente sus documentos en la raiz (nada
// dentro de UCI ni UTI). La funcion programada se declara en index.js.

const logger = require("firebase-functions/logger");
const { applyEntry, parseStoredJSON } = require("./lib/stateReader");
const {
  FIRESTORE_DOCUMENT_LIMIT_BYTES,
  compareAuditLogFormats,
  compareReplacementFormats,
  estimateFirestoreDocumentBytes,
  growthBetween,
  healthLevel,
  legacyListReadable,
  levelChanges,
  percentOf
} = require("./lib/storageHealth");

// Documentos que se guardan aunque esten sanos: los grandes, para poder medir
// su crecimiento dia a dia.
const TRACK_MIN_BYTES = 100 * 1024;
const MAX_TRACKED_PER_UNIT = 60;

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

function shardLogsFrom(shardDocs) {
  const logs = [];

  shardDocs.forEach(data => {
    Object.values(data?.items || {}).forEach(raw => {
      try {
        const log = typeof raw === "string" ? JSON.parse(raw) : raw;

        if (log && log.id) logs.push(log);
      } catch {
        // Un item roto se ve como faltante en la comparacion.
      }
    });
  });

  return logs;
}

async function measureWorkspace(db, workspaceId, workspace, now) {
  const documents = [];
  const audits = [];
  let auditLogEntry = null;
  let replacementsEntry = null;

  const modules = await db
    .collection(`workspaces/${workspaceId}/stateModules`)
    .listDocuments();

  for (const moduleRef of modules) {
    const entries = await moduleRef.collection("entries").get();

    entries.forEach(entryDoc => {
      const data = entryDoc.data() || {};

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
  const shardDocs = [];

  shardSnap.forEach(shardDoc => {
    const data = shardDoc.data() || {};

    shardDocs.push(data);
    documents.push({
      moduleId: "auditLogShards",
      storageKey: shardDoc.id,
      bytes: estimateFirestoreDocumentBytes(data, shardDoc.ref.path)
    });
  });

  if (String(workspace.auditLogStorage || "").startsWith("shards-") && auditLogEntry) {
    audits.push({
      kind: "auditLog",
      ...compareAuditLogFormats(legacyList(auditLogEntry), shardLogsFrom(shardDocs), now)
    });
  }

  if (String(workspace.replacementStorage || "").startsWith("records-") && replacementsEntry) {
    const recordsSnap = await db
      .collection(`workspaces/${workspaceId}/replacementRecords`)
      .get();

    audits.push({
      kind: "replacements",
      ...compareReplacementFormats(
        legacyList(replacementsEntry),
        recordsSnap.docs.map(item => item.data() || {}),
        now
      )
    });
  }

  return { documents, audits };
}

/**
 * Lo que cambio en una unidad respecto de lo ya avisado por correo.
 */
function unitChanges(name, documents, audits, emailed = {}) {
  const currentLevels = Object.fromEntries(
    documents
      .filter(item => item.level !== "healthy")
      .map(item => [docKey(item), item.level])
  );
  const { raised, recovered } = levelChanges(emailed.levels || {}, currentLevels);
  const byKey = new Map(documents.map(item => [docKey(item), item]));
  const label = key => decodeURIComponent(key);
  const lines = [];

  raised.forEach(({ key, to }) => {
    const item = byKey.get(key);

    lines.push(
      `${to === "critical" ? "CRITICO" : "En observacion"} ${item?.percent ?? "?"}%: ${name} ${label(key)}` +
      (Number.isFinite(item?.daysToCritical) ? ` (al ritmo actual, ${item.daysToCritical} dias al 85%)` : "")
    );
  });
  recovered.forEach(({ key, from, to }) => {
    const item = byKey.get(key);

    lines.push(
      `Recuperado: ${name} ${label(key)} bajo de ${from === "critical" ? "85%" : "70%"}` +
      (to === "healthy" ? "" : " (sigue sobre 70%)") +
      (item ? ` (${item.percent}%)` : "")
    );
  });

  const currentAudits = Object.fromEntries(audits.map(audit => [audit.kind, audit.issues > 0]));

  audits.forEach(audit => {
    if (audit.issues > 0 && !emailed.audits?.[audit.kind]) {
      lines.push(
        audit.unreadable
          ? `No se pudo reconstruir el formato viejo de ${audit.kind}: ${name}`
          : `Diferencias entre formatos: ${name} ${audit.kind}: ${audit.issues} (viejo ${audit.legacy}, nuevo ${audit.archive})`
      );
    }
  });
  Object.entries(emailed.audits || {}).forEach(([kind, hadIssues]) => {
    if (hadIssues && currentAudits[kind] === false) {
      lines.push(`Comparacion limpia otra vez: ${name} ${kind}`);
    }
  });

  return {
    lines,
    nextEmailed: { levels: currentLevels, audits: currentAudits }
  };
}

/**
 * Corre la revision completa. Separado de la funcion programada para poder
 * probarlo con un Firestore de mentira.
 *
 * @returns {Promise<Object>} el resumen del dia
 */
async function runStorageHealthCheck({ db, now = Date.now(), sendAlert = null, log = logger }) {
  const date = chileDate(now);
  const workspaces = await db.collection("workspaces").get();
  const pendingStates = [];
  const incomplete = [];
  const lines = [];
  let measuredDocuments = 0;
  const top = [];

  for (const workspaceDoc of workspaces.docs) {
    const workspaceId = workspaceDoc.id;
    const workspace = workspaceDoc.data() || {};
    const name = String(workspace.name || workspaceId);
    const stateRef = db.doc(`storageHealthUnits/${workspaceId}`);
    let previous = {};

    try {
      const previousSnap = await stateRef.get();

      previous = previousSnap.exists ? previousSnap.data() || {} : {};

      const measured = await measureWorkspace(db, workspaceId, workspace, now);
      const elapsedMs = now - Number(previous.measuredAtMillis || NaN);

      measuredDocuments += measured.documents.length;

      const documents = measured.documents
        .map(item => ({
          ...item,
          percent: percentOf(item.bytes),
          level: healthLevel(item.bytes),
          ...growthBetween({
            bytes: item.bytes,
            previousBytes: previous.tracked?.[docKey(item)],
            elapsedMs
          })
        }))
        .filter(item => item.level !== "healthy" || item.bytes >= TRACK_MIN_BYTES)
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, MAX_TRACKED_PER_UNIT);
      const changes = unitChanges(name, documents, measured.audits, previous.emailed);

      lines.push(...changes.lines);
      documents.slice(0, 3).forEach(item => top.push({ workspaceName: name, ...item }));

      await db.doc(`storageHealthReports/${date}/units/${workspaceId}`).set({
        date,
        workspaceId,
        workspaceName: name,
        documents,
        audits: measured.audits
      });

      pendingStates.push({
        stateRef,
        previous,
        changed: changes.lines.length > 0,
        state: {
          workspaceId,
          workspaceName: name,
          reportDate: date,
          measuredAtMillis: now,
          // Lo vigente, para el banner del dueno.
          alerts: {
            documents: documents
              .filter(item => item.level !== "healthy")
              .map(({ moduleId, storageKey, percent, level, daysToCritical }) =>
                ({ moduleId, storageKey, percent, level, daysToCritical: daysToCritical ?? null })),
            audits: measured.audits
              .filter(audit => audit.issues > 0)
              .map(({ kind, issues, unreadable }) => ({ kind, issues, unreadable: Boolean(unreadable) }))
          },
          tracked: Object.fromEntries(documents.map(item => [docKey(item), item.bytes])),
          nextEmailed: changes.nextEmailed
        }
      });
    } catch (error) {
      // Su estado anterior queda como estaba: no se pierden sus avisos.
      incomplete.push(name);
      lines.push(`No se pudo medir la unidad ${name}: ${error?.message || error}`);
      log.error("storage health: no se pudo medir la unidad", {
        workspaceId,
        error: error?.message || String(error)
      });
    }
  }

  let delivery = "none";

  if (lines.length) {
    log.warn("storage health: avisos", { lines });
    delivery = sendAlert
      ? await sendAlert({
        subject: `TurnoPlus: almacenamiento (${lines.length} aviso(s))`,
        text: [
          "Revision diaria del almacenamiento de Firestore.",
          "",
          ...lines,
          "",
          `Detalle: storageHealthReports/${date}`
        ].join("\n")
      }).catch(error => `error: ${error?.message || error}`)
      : "skipped_no_sender";
  }

  const delivered = delivery === "sent";

  for (const pending of pendingStates) {
    const { nextEmailed, ...state } = pending.state;

    await pending.stateRef.set({
      ...state,
      // Solo se da por avisado lo que el correo llevo. Si no salio, queda lo
      // anterior y manana se vuelve a intentar.
      emailed: delivered || !pending.changed
        ? nextEmailed
        : (pending.previous.emailed || { levels: {}, audits: {} })
    });
  }

  const summary = {
    date,
    generatedAt: new Date(now).toISOString(),
    generatedAtMillis: now,
    limitBytes: FIRESTORE_DOCUMENT_LIMIT_BYTES,
    units: workspaces.docs.length,
    measuredDocuments,
    incomplete,
    complete: incomplete.length === 0,
    changes: lines.length,
    delivery,
    top: top
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 10)
      .map(({ workspaceName, moduleId, storageKey, percent, level }) =>
        ({ workspaceName, moduleId, storageKey, percent, level }))
  };

  await db.doc(`storageHealthReports/${date}`).set(summary);

  log.info("storage health: informe", {
    date,
    units: summary.units,
    measuredDocuments,
    incomplete,
    changes: lines.length,
    delivery,
    top: summary.top.map(item => `${item.workspaceName} ${item.storageKey} ${item.percent}%`)
  });

  return { ...summary, lines };
}

/**
 * El aviso por correo (Resend). Devuelve el estado de la entrega, que queda en
 * el resumen: sin destinatario o sin clave no se manda nada (y lo avisado no
 * se da por avisado).
 */
function createStorageAlertSender({ to, apiKey, from, fetchImpl = fetch }) {
  return async ({ subject, text }) => {
    const recipient = String(to || "").trim();

    if (!recipient) return "skipped_no_recipient";
    if (!apiKey) return "skipped_no_api_key";

    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ from, to: [recipient], subject, text })
    });

    return response.ok ? "sent" : `error: Resend ${response.status}`;
  };
}

module.exports = {
  runStorageHealthCheck,
  createStorageAlertSender
};
