"use strict";

// Vigilancia diaria del almacenamiento (fase 1 del plan de migracion,
// 2026-10-02). Hasta ahora el aviso solo lo veia el dueno con la app abierta en
// esa unidad, o quien corriera a mano scripts/audit-state-document-health.mjs.
//
// Cada dia, en todas las unidades:
//  - mide cada documento de estado (stateModules/*/entries) y los fragmentos de
//    la bitacora, y guarda el informe en storageHealthReports/{fecha} (solo el
//    servidor lo lee: las reglas cierran todo lo que no nombran);
//  - calcula el crecimiento contra el informe anterior y los dias que faltan al
//    85 % a ese ritmo;
//  - compara el formato viejo y el nuevo de la bitacora y de los reemplazos en
//    las unidades que los tienen en convivencia;
//  - AVISA solo cuando un documento SUBE de nivel (70 % / 85 %) o cuando una
//    comparacion que estaba limpia encuentra diferencias. El ultimo estado va
//    en storageHealthState/current para no repetir el mismo aviso cada dia.
//
// Solo LEE las unidades: escribe unicamente sus propios documentos en la raiz.
// Por eso no hay que excluir UCI ni UTI (ver el plan: no se escribe en ellas).

// La funcion programada (checkStorageHealth) se declara en index.js, junto a las
// demas: asi reutiliza la clave de Resend y el remitente que ya estan definidos
// alli. Este modulo solo trae la logica.
const logger = require("firebase-functions/logger");
const { applyEntry, parseStoredJSON } = require("./lib/stateReader");
const {
  FIRESTORE_DOCUMENT_LIMIT_BYTES,
  compareAuditLogFormats,
  compareReplacementFormats,
  estimateFirestoreDocumentBytes,
  growthBetween,
  healthLevel,
  levelIncreases,
  percentOf
} = require("./lib/storageHealth");

// Documentos que se guardan en el informe aunque esten sanos: los grandes, para
// poder medir su crecimiento dia a dia.
const TRACK_MIN_BYTES = 100 * 1024;

function chileDate(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(now));
}

function stateKey(path) {
  return encodeURIComponent(path);
}

function legacyList(entryData) {
  if (!entryData?.storageKey) return [];

  const state = {};

  applyEntry(state, entryData);

  const list = parseStoredJSON(state[entryData.storageKey], []);

  return Array.isArray(list) ? list : [];
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

async function measureWorkspace(db, workspaceDoc, now) {
  const workspaceId = workspaceDoc.id;
  const workspace = workspaceDoc.data() || {};
  const name = String(workspace.name || workspaceId);
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
      const path = entryDoc.ref.path;
      const bytes = estimateFirestoreDocumentBytes(data, path);

      documents.push({
        path,
        workspaceId,
        workspaceName: name,
        moduleId: moduleRef.id,
        storageKey: String(data.storageKey || ""),
        bytes
      });

      if (moduleRef.id === "log" && data.storageKey === "auditLog") auditLogEntry = data;
      if (moduleRef.id === "turnos" && data.storageKey === "replacements") replacementsEntry = data;
    });
  }

  const shardsEnabled = String(workspace.auditLogStorage || "").startsWith("shards-");
  const shardSnap = await db.collection(`workspaces/${workspaceId}/auditLogShards`).get();
  const shardDocs = [];

  shardSnap.forEach(shardDoc => {
    const data = shardDoc.data() || {};

    shardDocs.push(data);
    documents.push({
      path: shardDoc.ref.path,
      workspaceId,
      workspaceName: name,
      moduleId: "auditLogShards",
      storageKey: shardDoc.id,
      bytes: estimateFirestoreDocumentBytes(data, shardDoc.ref.path)
    });
  });

  if (shardsEnabled && auditLogEntry) {
    audits.push({
      workspaceId,
      workspaceName: name,
      kind: "auditLog",
      ...compareAuditLogFormats(legacyList(auditLogEntry), shardLogsFrom(shardDocs), now)
    });
  }

  if (String(workspace.replacementStorage || "").startsWith("records-") && replacementsEntry) {
    const recordsSnap = await db
      .collection(`workspaces/${workspaceId}/replacementRecords`)
      .get();

    audits.push({
      workspaceId,
      workspaceName: name,
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
 * Corre la revision completa. Separado de la funcion programada para poder
 * probarlo con un Firestore de mentira.
 *
 * @returns {Promise<Object>} el informe guardado
 */
async function runStorageHealthCheck({ db, now = Date.now(), sendAlert = null, log = logger }) {
  const date = chileDate(now);
  const previousSnap = await db
    .collection("storageHealthReports")
    .where("date", "<", date)
    .orderBy("date", "desc")
    .limit(1)
    .get();
  const previous = previousSnap.empty ? null : previousSnap.docs[0].data();
  const previousBytes = new Map(
    (previous?.documents || []).map(item => [item.path, item.bytes])
  );
  const elapsedMs = previous ? now - Number(previous.generatedAtMillis || 0) : NaN;

  const workspaces = await db.collection("workspaces").get();
  const allDocuments = [];
  const audits = [];

  for (const workspaceDoc of workspaces.docs) {
    try {
      const measured = await measureWorkspace(db, workspaceDoc, now);

      allDocuments.push(...measured.documents);
      audits.push(...measured.audits);
    } catch (error) {
      log.error("storage health: no se pudo medir la unidad", {
        workspaceId: workspaceDoc.id,
        error: error?.message || String(error)
      });
    }
  }

  const documents = allDocuments
    .map(item => ({
      ...item,
      percent: percentOf(item.bytes),
      level: healthLevel(item.bytes),
      ...growthBetween({
        bytes: item.bytes,
        previousBytes: previousBytes.get(item.path),
        elapsedMs
      })
    }))
    .filter(item => item.level !== "healthy" || item.bytes >= TRACK_MIN_BYTES)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 400);

  const stateRef = db.doc("storageHealthState/current");
  const stateSnap = await stateRef.get();
  const state = stateSnap.exists ? stateSnap.data() || {} : {};
  const currentLevels = Object.fromEntries(
    documents
      .filter(item => item.level !== "healthy")
      .map(item => [stateKey(item.path), item.level])
  );
  const raised = levelIncreases(state.levels || {}, currentLevels).map(change => ({
    ...change,
    document: documents.find(item => stateKey(item.path) === change.key)
  }));
  const currentAuditIssues = Object.fromEntries(
    audits.map(audit => [`${audit.workspaceId}:${audit.kind}`, audit.issues])
  );
  const newAuditIssues = audits.filter(audit =>
    audit.issues > 0 &&
    !(Number(state.auditIssues?.[`${audit.workspaceId}:${audit.kind}`]) > 0)
  );

  let alertDelivery = "none";

  if (raised.length || newAuditIssues.length) {
    const lines = [
      ...raised.map(({ document, to }) =>
        `${to === "critical" ? "CRITICO" : "Observacion"} ${document.percent}%: ` +
        `${document.workspaceName} ${document.moduleId}/${document.storageKey}` +
        (document.daysToCritical !== null && document.daysToCritical !== undefined
          ? ` (al ritmo actual, ${document.daysToCritical} dias al 85%)`
          : "")
      ),
      ...newAuditIssues.map(audit =>
        `Diferencias entre formatos: ${audit.workspaceName} ${audit.kind}: ${audit.issues} ` +
        `(viejo ${audit.legacy}, nuevo ${audit.archive})`
      )
    ];

    log.warn("storage health: avisos", { lines });
    alertDelivery = sendAlert
      ? await sendAlert({
        subject: `TurnoPlus: almacenamiento (${raised.length + newAuditIssues.length} aviso(s))`,
        text: [
          "Revision diaria del almacenamiento de Firestore.",
          "",
          ...lines,
          "",
          `Informe: storageHealthReports/${date}`
        ].join("\n")
      }).catch(error => `error: ${error?.message || error}`)
      : "skipped_no_sender";
  }

  const report = {
    date,
    generatedAt: new Date(now).toISOString(),
    generatedAtMillis: now,
    limitBytes: FIRESTORE_DOCUMENT_LIMIT_BYTES,
    measuredDocuments: allDocuments.length,
    documents,
    audits,
    alerts: {
      raised: raised.map(({ document, from, to }) => ({
        path: document.path,
        workspaceName: document.workspaceName,
        storageKey: document.storageKey,
        from,
        to,
        percent: document.percent
      })),
      auditIssues: newAuditIssues.map(audit => ({
        workspaceName: audit.workspaceName,
        kind: audit.kind,
        issues: audit.issues
      })),
      delivery: alertDelivery
    }
  };

  await db.doc(`storageHealthReports/${date}`).set(report);
  await stateRef.set({
    levels: currentLevels,
    auditIssues: currentAuditIssues,
    updatedAt: new Date(now).toISOString()
  });

  log.info("storage health: informe", {
    date,
    measuredDocuments: allDocuments.length,
    tracked: documents.length,
    top: documents.slice(0, 5).map(item => `${item.workspaceName} ${item.storageKey} ${item.percent}%`),
    audits: audits.map(audit => `${audit.workspaceName} ${audit.kind}: ${audit.issues}`),
    alertDelivery
  });

  return report;
}

/**
 * El aviso por correo (Resend). Devuelve el estado de la entrega, que queda en
 * el informe: sin destinatario o sin clave no se manda nada.
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
