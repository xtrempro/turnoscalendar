"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const {
  FIRESTORE_DOCUMENT_LIMIT_BYTES,
  auditShardIntegrity,
  compareAuditLogFormats,
  compareReplacementFormats,
  estimateFirestoreDocumentBytes,
  growthBetween,
  healthLevel,
  levelIncreases
} = require("../lib/storageHealth");
const {
  MAX_HEALTHY_TRACKED_PER_UNIT,
  StorageHealthBusyError,
  createStorageAlertSender,
  runScheduledStorageHealthCheck,
  runStorageHealthCheck,
  runStorageHealthCheckLocked,
  sendStorageHealthTestAlert
} = require("../storageHealthMonitor");
const { fakeFirestore } = require("./helpers/fakeFirestore");

const MiB = FIRESTORE_DOCUMENT_LIMIT_BYTES;
const silentLog = { info() {}, warn() {}, error() {} };

// --- Logica pura -----------------------------------------------------------

test("el tamano se estima igual que la alerta del navegador", async () => {
  const browser = await import(
    pathToFileURL(path.join(__dirname, "../../js/firestoreDocumentHealth.js")).href
  );
  const data = {
    storageKey: "auditLog",
    container: "array",
    value: JSON.stringify([{ id: "a", action: "Aplicó F. Legal" }]),
    items: { a: JSON.stringify({ id: "a" }), "b%2E": "null" },
    deletedItems: { a: false, "b%2E": true },
    revision: 3,
    updatedAt: { toMillis: () => 0 }
  };
  const documentPath = "workspaces/w1/stateModules/log/entries/auditLog";

  assert.equal(
    estimateFirestoreDocumentBytes(data, documentPath),
    browser.estimateFirestoreDocumentBytes(data, documentPath)
  );
});

test("niveles: 70 % observacion, 85 % critico", () => {
  assert.equal(healthLevel(MiB * 0.69), "healthy");
  assert.equal(healthLevel(MiB * 0.70), "warning");
  assert.equal(healthLevel(MiB * 0.85), "critical");
});

test("crecimiento diario y dias que faltan al 85 %", () => {
  const day = 24 * 60 * 60 * 1000;

  assert.deepEqual(
    growthBetween({ bytes: 520000, previousBytes: 510000, elapsedMs: day }),
    { bytesPerDay: 10000, daysToCritical: Math.floor((MiB * 0.85 - 520000) / 10000) }
  );
  assert.deepEqual(
    growthBetween({ bytes: 500000, previousBytes: 510000, elapsedMs: day }),
    { bytesPerDay: -10000, daysToCritical: null }
  );
  assert.deepEqual(
    growthBetween({ bytes: 500000, previousBytes: undefined, elapsedMs: day }),
    { bytesPerDay: null, daysToCritical: null }
  );
});

test("solo cuenta como subida cuando un documento SUBE de nivel", () => {
  assert.deepEqual(levelIncreases({}, { a: "warning" }), [{ key: "a", from: "healthy", to: "warning" }]);
  assert.deepEqual(levelIncreases({ a: "warning" }, { a: "warning" }), []);
  assert.deepEqual(levelIncreases({ a: "warning" }, { a: "critical" }), [{ key: "a", from: "warning", to: "critical" }]);
  assert.deepEqual(levelIncreases({ a: "critical" }, { a: "warning" }), []);
});

test("bitacora: lo podado del viejo no es diferencia; lo faltante o distinto si", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const log = id => ({ id, createdAt: "2026-10-01T10:00:00Z", action: "x" });

  assert.equal(compareAuditLogFormats([log("a")], [log("a"), log("viejo")], now).issues, 0);
  assert.equal(compareAuditLogFormats([log("a"), log("b")], [log("a")], now).issues, 1);
  assert.equal(compareAuditLogFormats([{ ...log("a"), action: "y" }], [log("a")], now).issues, 1);
});

test("bitacora: lo escrito hace menos de 15 minutos todavia no cuenta", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");

  assert.equal(
    compareAuditLogFormats([{ id: "nuevo", createdAt: "2026-10-02T11:55:00Z" }], [], now).issues,
    0
  );
});

test("reemplazos: faltantes, distintos y sobrantes; los borrados y la falta de fecha no avisan", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const record = (id, extra = {}) => ({ id, date: "2026-10-01", createdAt: "2026-09-30T10:00:00Z", ...extra });
  const result = compareReplacementFormats(
    [record("a"), record("b"), record("c", { turno: "L" })],
    [
      { recordId: "a", record: record("a"), date: "2026-10-01" },
      { recordId: "c", record: record("c", { turno: "N" }) },
      { recordId: "x", record: record("x"), date: "2026-10-01" },
      { recordId: "borrado", deleted: true }
    ],
    now
  );

  assert.deepEqual(result.missing, ["b"]);
  assert.deepEqual(result.different, ["c"]);
  assert.deepEqual(result.extra, ["x"]);
  assert.equal(result.issues, 3);
  assert.equal(result.withoutDate, 1);
});

test("fragmentos: rotos, ilegibles, clave distinta de su id e ids duplicados son incidencias", () => {
  const result = auditShardIntegrity([
    {
      id: "2026-09-01_0",
      data: {
        items: {
          a: JSON.stringify({ id: "a" }),
          roto: "{roto",
          sinId: JSON.stringify({ action: "x" }),
          "x%2Ey": JSON.stringify({ id: "x.y" })
        }
      }
    },
    { id: "2026-09-02_0", data: { items: { a: JSON.stringify({ id: "a" }), z: JSON.stringify({ id: "q" }) } } },
    { id: "2026-09-03_0", data: { month: "2026-09" } },
    { id: "2026-09-04_0", data: { items: "no es un mapa" } }
  ]);

  assert.deepEqual(result.malformed, ["2026-09-03_0", "2026-09-04_0"]);
  assert.deepEqual(result.unparseable, ["2026-09-01_0/roto", "2026-09-01_0/sinId"]);
  assert.deepEqual(result.mismatched, ["2026-09-02_0/z"]);
  assert.deepEqual(result.duplicates, ["a"]);
  assert.equal(result.records, 4);
  assert.equal(result.issues, 6);
  assert.equal(auditShardIntegrity([{ id: "s", data: { items: { a: JSON.stringify({ id: "a" }) } } }]).issues, 0);
});

// --- Recorrido completo ----------------------------------------------------

function bigAuditLog(bytes) {
  return {
    storageKey: "auditLog",
    container: "array",
    items: { a: "x".repeat(bytes) },
    deletedItems: { a: false }
  };
}

const DAY = 24 * 60 * 60 * 1000;
const DAY1 = Date.parse("2026-10-02T08:30:00Z");
const AUDIT_PATH = "workspaces/w1/stateModules/log/entries/auditLog";

function recorder(result = "sent") {
  const sent = [];

  return {
    sent,
    sendAlert: async message => {
      sent.push(message);
      const status = typeof result === "function" ? result(sent.length) : result;

      if (status instanceof Error) throw status;

      return typeof status === "string" ? { status, providerId: status === "sent" ? `msg-${sent.length}` : null } : status;
    }
  };
}

function events(db) {
  return [...db.docs.entries()]
    .filter(([key]) => key.startsWith("storageHealthEvents/"))
    .map(([, value]) => value)
    .sort((a, b) => a.detectedAtMillis - b.detectedAtMillis);
}

function run(db, now, mail, extra = {}) {
  return runStorageHealthCheck({ db, now, sendAlert: mail?.sendAlert, log: silentLog, ...extra });
}

test("cruzar el 85 % crea UN evento, se entrega una vez y mide el crecimiento", async () => {
  const db = fakeFirestore({
    "workspaces/w1": { name: "Imagenologia" },
    [AUDIT_PATH]: bigAuditLog(Math.round(MiB * 0.86))
  });
  const mail = recorder("sent");

  const first = await run(db, DAY1, mail);

  assert.equal(first.delivery.status, "sent");
  assert.equal(first.changes, 1);
  assert.equal(mail.sent.length, 1);
  assert.match(mail.sent[0].text, /CRITICO .*Imagenologia log\/auditLog/);
  assert.match(mail.sent[0].idempotencyKey, /^storage-health-\d+_[0-9a-f]{32}$/);

  const [event] = events(db);

  assert.equal(event.type, "document_level");
  assert.equal(event.from, "healthy");
  assert.equal(event.to, "critical");
  assert.equal(event.deliveryPending, false);
  assert.equal(event.delivery.status, "sent");
  assert.equal(event.delivery.attempts, 1);
  assert.equal(event.delivery.providerId, "msg-1");

  db.docs.set(AUDIT_PATH, bigAuditLog(Math.round(MiB * 0.86) + 5000));
  const second = await run(db, DAY1 + DAY, mail);

  assert.equal(second.changes, 0, "mismo nivel: no hay transicion");
  assert.equal(second.delivery.status, "none");
  assert.equal(mail.sent.length, 1);
  assert.equal(events(db).length, 1);
  assert.equal(db.docs.get("storageHealthReports/2026-10-03/units/w1").documents[0].bytesPerDay, 5000);
  assert.equal(db.docs.get("storageHealthUnits/w1").overview.largest.bytesPerDay, 5000);
});

test("repetir la revision el mismo dia no duplica eventos ni correos", async () => {
  const db = fakeFirestore({
    "workspaces/w1": { name: "Imagenologia" },
    [AUDIT_PATH]: bigAuditLog(Math.round(MiB * 0.86))
  });
  const failing = recorder("failed");

  await run(db, DAY1, failing);
  // Se pierde la linea base (como si la funcion muriera tras crear el evento):
  // la revision siguiente del mismo dia llega al MISMO id y no lo duplica.
  const state = db.docs.get("storageHealthUnits/w1");

  db.docs.set("storageHealthUnits/w1", { ...state, baseline: { levels: {}, audits: {} } });
  const again = await run(db, DAY1 + 60 * 60 * 1000, failing);

  assert.equal(again.changes, 0);
  assert.equal(events(db).length, 1);
  // El reintento usa la misma clave de idempotencia: mismo lote de eventos.
  assert.equal(failing.sent.length, 2);
  assert.equal(failing.sent[0].idempotencyKey, failing.sent[1].idempotencyKey);
});

test("una entrega fallida no queda como enviada y se reintenta hasta que sale", async () => {
  const db = fakeFirestore({
    "workspaces/w1": { name: "Imagenologia" },
    [AUDIT_PATH]: bigAuditLog(Math.round(MiB * 0.86))
  });
  const outcomes = ["skipped_no_recipient", "skipped_no_api_key", "failed", new Error("Bearer re_secreto123 timeout"), "sent"];
  const mail = recorder(count => outcomes[count - 1]);

  for (let day = 0; day < outcomes.length; day++) {
    const result = await run(db, DAY1 + day * DAY, mail);
    const [event] = events(db);

    if (day < outcomes.length - 1) {
      assert.notEqual(event.delivery.status, "sent", `dia ${day}: no puede quedar enviado`);
      assert.equal(event.deliveryPending, true);
      assert.equal(event.delivery.sentAtMillis, null);
    }
    assert.equal(result.changes, day === 0 ? 1 : 0, "un solo evento, sin repetir la transicion");
  }

  const [event] = events(db);

  assert.equal(events(db).length, 1);
  assert.equal(event.delivery.status, "sent");
  assert.equal(event.deliveryPending, false);
  // Solo cuentan los intentos que llegaron al proveedor (failed, error, sent).
  assert.equal(event.delivery.attempts, 3);
  assert.equal(mail.sent.length, 5);
  assert.ok(mail.sent.every(message => /CRITICO/.test(message.text)));
});

test("el error guardado de una entrega no expone credenciales", async () => {
  const db = fakeFirestore({
    "workspaces/w1": { name: "Imagenologia" },
    [AUDIT_PATH]: bigAuditLog(Math.round(MiB * 0.86))
  });

  await run(db, DAY1, recorder(() => new Error("fallo con Bearer re_abc123XYZ")));

  const [event] = events(db);

  assert.equal(event.delivery.status, "failed");
  assert.doesNotMatch(event.delivery.lastError, /re_abc123XYZ/);
  assert.match(event.delivery.lastError, /Bearer \*\*\*/);
});

test("la recuperacion se registra como evento propio", async () => {
  const db = fakeFirestore({
    "workspaces/w1": { name: "Imagenologia" },
    [AUDIT_PATH]: bigAuditLog(Math.round(MiB * 0.86))
  });
  const mail = recorder("sent");

  await run(db, DAY1, mail);
  db.docs.set(AUDIT_PATH, bigAuditLog(Math.round(MiB * 0.5)));
  await run(db, DAY1 + DAY, mail);

  const recovered = events(db).find(event => event.direction === "recovered");

  assert.equal(mail.sent.length, 2);
  assert.match(mail.sent[1].text, /Recuperado: Imagenologia log\/auditLog bajo de 85%/);
  assert.equal(recovered.from, "critical");
  assert.equal(recovered.to, "healthy");
  assert.deepEqual(db.docs.get("storageHealthUnits/w1").alerts.documents, []);
  assert.equal(db.docs.get("storageHealthUnits/w1").status, "normal");
  assert.equal(db.docs.get("storageHealthUnits/w1").lastRecoveryAtMillis, DAY1 + DAY);
});

test("diferencias entre formatos: evento al aparecer y al quedar limpio", async () => {
  const legacy = {
    storageKey: "auditLog",
    container: "array",
    items: { a: JSON.stringify({ id: "a", createdAt: "2026-09-01T10:00:00Z" }) },
    deletedItems: { a: false }
  };
  const db = fakeFirestore({
    "workspaces/w1": { name: "Imagenologia", auditLogStorage: "shards-read-v1" },
    [AUDIT_PATH]: legacy,
    "workspaces/w1/auditLogShards/2026-09-01_0": { items: {} }
  });
  const mail = recorder("sent");

  await run(db, DAY1, mail);

  assert.match(mail.sent[0].text, /Diferencias en bitacora .*: Imagenologia: 1/);
  assert.equal(db.docs.get("storageHealthUnits/w1").status, "warning");
  assert.deepEqual(db.docs.get("storageHealthUnits/w1").overview.auditLog, { legacy: 1, archive: 0, issues: 1, unreadable: false });

  db.docs.set("workspaces/w1/auditLogShards/2026-09-01_0", { items: { a: legacy.items.a } });
  await run(db, DAY1 + DAY, mail);

  assert.match(mail.sent[1].text, /Comparacion limpia otra vez: Imagenologia auditLog/);
});

test("una bitacora vieja que no se puede reconstruir NO pasa por limpia", async () => {
  const db = fakeFirestore({
    "workspaces/w1": { name: "Imagenologia", auditLogStorage: "shards-read-v1" },
    [AUDIT_PATH]: { storageKey: "auditLog", container: "array", value: "{roto", items: {} },
    "workspaces/w1/auditLogShards/2026-09-01_0": { items: {} }
  });
  const mail = recorder("sent");

  await run(db, DAY1, mail);

  const audit = db.docs.get("storageHealthReports/2026-10-02/units/w1").audits
    .find(item => item.kind === "auditLog");

  assert.equal(audit.unreadable, true);
  assert.equal(audit.issues, 1);
  assert.match(mail.sent[0].text, /No se pudo reconstruir el formato viejo de auditLog/);
});

test("fragmentos rotos e ids duplicados generan incidencia en el recorrido", async () => {
  const db = fakeFirestore({
    "workspaces/w1": { name: "Imagenologia" },
    "workspaces/w1/auditLogShards/2026-09-01_0": { items: { a: JSON.stringify({ id: "a" }), b: "{roto" } },
    "workspaces/w1/auditLogShards/2026-09-02_0": { items: { a: JSON.stringify({ id: "a" }) } },
    "workspaces/w1/auditLogShards/2026-09-03_0": { month: "2026-09" }
  });
  const mail = recorder("sent");

  await run(db, DAY1, mail);

  const audit = db.docs.get("storageHealthReports/2026-10-02/units/w1").audits
    .find(item => item.kind === "auditLogShards");

  assert.deepEqual(audit.duplicates, ["a"]);
  assert.deepEqual(audit.unparseable, ["2026-09-01_0/b"]);
  assert.deepEqual(audit.malformed, ["2026-09-03_0"]);
  assert.match(mail.sent[0].text, /Fragmentos con problemas: Imagenologia: 3 \(rotos 1, ilegibles 1, clave distinta 0, ids duplicados 1\)/);
  assert.equal(events(db)[0].type, "audit");
  assert.equal(db.docs.get("storageHealthUnits/w1").status, "warning");
});

test("una unidad que no se puede medir: un evento al caer y otro al volver, sin repetir cada dia", async () => {
  const db = fakeFirestore({
    "workspaces/w1": { name: "Imagenologia" },
    [AUDIT_PATH]: bigAuditLog(Math.round(MiB * 0.86))
  });
  const mail = recorder("sent");

  await run(db, DAY1, mail);

  const before = db.docs.get("storageHealthUnits/w1");
  const healthyCollection = db.collection;
  let broken = true;

  db.collection = collectionPath => {
    if (broken && collectionPath === "workspaces/w1/stateModules") throw new Error("lectura fallida");
    return healthyCollection(collectionPath);
  };

  const second = await run(db, DAY1 + DAY, mail);
  const afterFailure = db.docs.get("storageHealthUnits/w1");

  assert.deepEqual(second.incomplete, ["Imagenologia"]);
  assert.equal(second.complete, false);
  assert.equal(second.counts.incomplete, 1);
  assert.match(mail.sent[1].text, /No se pudo medir la unidad Imagenologia: lectura fallida/);
  assert.equal(afterFailure.status, "incomplete");
  assert.equal(afterFailure.monitoring.status, "incomplete");
  // Conserva sus mediciones, su linea base y sus alertas.
  assert.deepEqual(afterFailure.baseline, before.baseline);
  assert.deepEqual(afterFailure.tracked, before.tracked);
  assert.deepEqual(afterFailure.alerts, before.alerts);
  assert.equal(afterFailure.measuredAtMillis, before.measuredAtMillis);
  assert.equal(db.docs.get("storageHealthReports/2026-10-03/units/w1").incomplete, true);

  const third = await run(db, DAY1 + 2 * DAY, mail);

  assert.equal(third.changes, 0, "sigue incompleta: no se repite");
  assert.equal(mail.sent.length, 2, "ni el correo");
  assert.equal(db.docs.get("storageHealthUnits/w1").monitoring.since, DAY1 + DAY);

  broken = false;
  const fourth = await run(db, DAY1 + 3 * DAY, mail);

  assert.equal(fourth.changes, 1);
  assert.match(mail.sent[2].text, /La unidad Imagenologia se volvio a medir completa/);
  assert.equal(db.docs.get("storageHealthUnits/w1").monitoring.status, "ok");
  assert.equal(db.docs.get("storageHealthUnits/w1").status, "critical");
  assert.deepEqual(
    events(db).filter(event => event.type === "monitoring").map(event => `${event.from}->${event.to}`),
    ["ok->incomplete", "incomplete->ok"]
  );
});

test("unidad incompleta: si la entrega fallo, se reintenta el MISMO evento", async () => {
  const db = fakeFirestore({ "workspaces/w1": { name: "Imagenologia" } });
  const healthyCollection = db.collection;

  db.collection = collectionPath => {
    if (collectionPath === "workspaces/w1/stateModules") throw new Error("lectura fallida");
    return healthyCollection(collectionPath);
  };

  const mail = recorder(count => (count === 1 ? "failed" : "sent"));

  await run(db, DAY1, mail);
  await run(db, DAY1 + DAY, mail);

  assert.equal(events(db).length, 1);
  assert.equal(events(db)[0].delivery.status, "sent");
  assert.equal(mail.sent.length, 2);
  assert.match(mail.sent[1].text, /No se pudo medir la unidad Imagenologia/);
});

test("mas de 60 documentos: ninguno en alerta queda fuera; el tope es solo para los sanos", async () => {
  const seed = { "workspaces/w1": { name: "Grande" } };
  const big = bytes => ({ storageKey: "k", value: "x".repeat(bytes) });

  for (let index = 0; index < 70; index++) {
    seed[`workspaces/w1/stateModules/turnos/entries/alerta${index}`] = { ...big(Math.round(MiB * 0.72)), storageKey: `alerta${index}` };
    seed[`workspaces/w1/stateModules/profile/entries/sano${index}`] = { ...big(200 * 1024), storageKey: `sano${index}` };
  }

  const db = fakeFirestore(seed);
  const mail = recorder("sent");

  await run(db, DAY1, mail);

  const report = db.docs.get("storageHealthReports/2026-10-02/units/w1");
  const state = db.docs.get("storageHealthUnits/w1");

  assert.equal(report.documents.filter(item => item.level === "warning").length, 70);
  assert.equal(report.documents.filter(item => item.level === "healthy").length, MAX_HEALTHY_TRACKED_PER_UNIT);
  assert.equal(state.alerts.documents.length, 70);
  assert.equal(Object.keys(state.baseline.levels).length, 70);
  assert.equal(state.overview.warningDocuments, 70);
  assert.equal(events(db).length, 70);
  assert.equal(mail.sent.length, 1, "un correo con 50 avisos");
  assert.match(mail.sent[0].subject, /\(50 aviso\(s\)\)/);
  assert.match(mail.sent[0].text, /Y 20 aviso\(s\) mas pendientes/);

  // Los 20 que no cupieron salen en la revision siguiente.
  await run(db, DAY1 + DAY, mail);

  assert.equal(mail.sent.length, 2);
  assert.match(mail.sent[1].subject, /\(20 aviso\(s\)\)/);
  assert.ok(events(db).every(event => event.delivery.status === "sent"));
});

test("todo queda por unidad, con metricas de lectura y duracion; el resumen es chico", async () => {
  const db = fakeFirestore({
    "workspaces/w1": { name: "A", ownerUid: "u1" },
    "workspaces/w2": { name: "B" },
    [AUDIT_PATH]: bigAuditLog(200 * 1024),
    "workspaces/w1/auditLogShards/2026-09-01_0": { items: { a: JSON.stringify({ id: "a" }) } }
  });
  let tick = 1000;
  const clock = () => (tick += 7);

  const summary = await run(db, DAY1, recorder(), { clock });
  const stored = db.docs.get("storageHealthReports/2026-10-02");
  const unit = db.docs.get("storageHealthUnits/w1");

  assert.equal(stored.units, 2);
  assert.equal(stored.documents, undefined, "el resumen no lleva el detalle");
  assert.deepEqual(stored.counts, { normal: 2, warning: 0, critical: 0, incomplete: 0 });
  assert.ok(stored.durationMs > 0);
  assert.equal(stored.shardDocuments, 1);
  assert.equal(stored.documentsRead, 2 + 1 + 1, "entrada + fragmento + estado previo de w1, estado previo de w2");
  assert.ok(JSON.stringify(stored).length < 4000);
  assert.ok(db.docs.has("storageHealthReports/2026-10-02/units/w1"));
  assert.ok(db.docs.has("storageHealthReports/2026-10-02/units/w2"));
  assert.ok(db.docs.has(`storageHealthRuns/${summary.runId}`));
  assert.equal(unit.ownerUid, "u1");
  assert.ok(unit.metrics.durationMs > 0);
  assert.equal(unit.metrics.documentsRead, 3);
  assert.equal(unit.metrics.shardDocuments, 1);
  assert.deepEqual(unit.overview.auditLogShards, { shards: 1, records: 1, issues: 0 });
});

test("la revision solo escribe en las colecciones storageHealth*", async () => {
  const db = fakeFirestore({
    "workspaces/w1": { name: "Imagenologia", auditLogStorage: "shards-read-v1" },
    [AUDIT_PATH]: bigAuditLog(Math.round(MiB * 0.86)),
    "workspaces/w1/auditLogShards/2026-09-01_0": { items: {} }
  });
  const before = new Map([...db.docs.entries()].map(([key, value]) => [key, JSON.stringify(value)]));

  await runStorageHealthCheckLocked({ db, now: DAY1, sendAlert: recorder().sendAlert, log: silentLog });

  [...db.docs.keys()].forEach(key => {
    if (before.has(key)) {
      assert.equal(JSON.stringify(db.docs.get(key)), before.get(key), `${key} no se toca`);
    } else {
      assert.match(key, /^storageHealth(Units|Events|Reports|Runs|Control)\//, `${key} esta fuera de storageHealth*`);
    }
  });
});

// --- Candado, frecuencia y modos -------------------------------------------

test("candado: no corren dos revisiones a la vez y se suelta al terminar", async () => {
  const db = fakeFirestore({ "workspaces/w1": { name: "A" } });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const healthyCollection = db.collection;

  db.collection = collectionPath => {
    if (collectionPath === "workspaces") {
      return { get: async () => { await gate; return healthyCollection("workspaces").get(); } };
    }
    return healthyCollection(collectionPath);
  };

  const first = runStorageHealthCheckLocked({ db, now: DAY1, log: silentLog, trigger: "manual" });

  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(
    runStorageHealthCheckLocked({ db, now: DAY1 + 1000, log: silentLog, trigger: "schedule" }),
    error => error instanceof StorageHealthBusyError && error.reason === "running"
  );

  release();
  await first;

  const control = db.docs.get("storageHealthControl/state");

  assert.equal(control.lock, null);
  assert.equal(control.lastRun.ok, true);
  assert.equal(control.lastRun.trigger, "manual");
});

test("frecuencia: una manual no se repite antes de 10 minutos; la programada no tiene ese limite", async () => {
  const db = fakeFirestore({ "workspaces/w1": { name: "A" } });
  const options = { db, log: silentLog, trigger: "manual" };

  await runStorageHealthCheckLocked({ ...options, now: DAY1 });
  await assert.rejects(
    runStorageHealthCheckLocked({ ...options, now: DAY1 + 5 * 60 * 1000 }),
    error => error instanceof StorageHealthBusyError && error.reason === "rate_limited" && error.retryAfterMs === 5 * 60 * 1000
  );
  await runStorageHealthCheckLocked({ db, log: silentLog, trigger: "schedule", now: DAY1 + 6 * 60 * 1000 });
  await runStorageHealthCheckLocked({ ...options, now: DAY1 + 11 * 60 * 1000 });
});

test("un candado vencido (funcion caida) no bloquea para siempre", async () => {
  const db = fakeFirestore({
    "workspaces/w1": { name: "A" },
    "storageHealthControl/state": { lock: { runId: "viejo", expiresAtMillis: DAY1 - 1 } }
  });

  await runStorageHealthCheckLocked({ db, now: DAY1, log: silentLog });
  assert.equal(db.docs.get("storageHealthControl/state").lock, null);
});

test("modo entregas: reintenta lo pendiente sin medir ni crear eventos", async () => {
  const db = fakeFirestore({
    "workspaces/w1": { name: "Imagenologia" },
    [AUDIT_PATH]: bigAuditLog(Math.round(MiB * 0.86))
  });

  await run(db, DAY1, recorder("skipped_no_api_key"));

  const reportsBefore = [...db.docs.keys()].filter(key => key.startsWith("storageHealthReports/")).length;
  const mail = recorder("sent");
  const result = await runStorageHealthCheckLocked({
    db,
    now: DAY1 + 60 * 1000,
    sendAlert: mail.sendAlert,
    log: silentLog,
    trigger: "manual",
    mode: "deliveries"
  });

  assert.equal(result.mode, "deliveries");
  assert.equal(result.delivery.status, "sent");
  assert.equal(events(db).length, 1);
  assert.equal(events(db)[0].delivery.status, "sent");
  assert.equal(
    [...db.docs.keys()].filter(key => key.startsWith("storageHealthReports/")).length,
    reportsBefore,
    "no mide de nuevo"
  );
});

test("correo de prueba: queda como evento sin reintentos y tiene limite de frecuencia", async () => {
  const db = fakeFirestore({});
  const mail = recorder("sent");

  const result = await sendStorageHealthTestAlert({ db, now: DAY1, sendAlert: mail.sendAlert, requestedBy: "admin1" });

  assert.equal(result.delivery.status, "sent");
  assert.equal(events(db)[0].type, "test");
  assert.equal(events(db)[0].deliveryPending, false);
  await assert.rejects(
    sendStorageHealthTestAlert({ db, now: DAY1 + 60 * 1000, sendAlert: mail.sendAlert }),
    error => error instanceof StorageHealthBusyError && error.reason === "rate_limited"
  );

  // Un correo de prueba fallido no entra a los reintentos diarios.
  const failing = await sendStorageHealthTestAlert({ db, now: DAY1 + 6 * 60 * 1000, sendAlert: recorder("skipped_no_recipient").sendAlert });

  assert.equal(failing.delivery.status, "skipped_no_recipient");
  assert.equal(events(db).filter(event => event.deliveryPending).length, 0);
});

// --- Proveedor de correo ---------------------------------------------------

test("el correo no sale sin destinatario o sin clave, y lo dice", async () => {
  const message = { subject: "s", text: "t" };

  assert.deepEqual(await createStorageAlertSender({ to: "", apiKey: "k", from: "x" })(message), { status: "skipped_no_recipient" });
  assert.deepEqual(await createStorageAlertSender({ to: "a@b.cl", apiKey: "", from: "x" })(message), { status: "skipped_no_api_key" });
});

test("solo una respuesta exitosa cuenta como enviado; lleva Idempotency-Key", async () => {
  const calls = [];
  const send = response => createStorageAlertSender({
    to: "tecnico@turnoplus.cl",
    apiKey: "re_clave",
    from: "TurnoPlus <noreply@turnoplus.cl>",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (response instanceof Error) throw response;
      return response;
    }
  });

  assert.deepEqual(
    await send({ ok: true, json: async () => ({ id: "resend-1" }) })({ subject: "s", text: "t", idempotencyKey: "k1" }),
    { status: "sent", providerId: "resend-1" }
  );
  assert.equal(calls[0].init.headers["Idempotency-Key"], "k1");
  assert.deepEqual(JSON.parse(calls[0].init.body).to, ["tecnico@turnoplus.cl"]);
  assert.deepEqual(
    await send({ ok: false, status: 429 })({ subject: "s", text: "t" }),
    { status: "failed", error: "Resend 429" }
  );

  const thrown = await send(new Error("red caida con re_clave"))({ subject: "s", text: "t" });

  assert.equal(thrown.status, "failed");
  assert.doesNotMatch(thrown.error, /re_clave/);
});

// --- Regresiones de la auditoria de 066807d ---------------------------------

test("outbox: tras una respuesta perdida se repite EL MISMO lote, aunque entren eventos nuevos", async () => {
  const db = fakeFirestore({
    "workspaces/w1": { name: "Imagenologia" },
    "workspaces/w2": { name: "Urgencia" },
    [AUDIT_PATH]: bigAuditLog(Math.round(MiB * 0.86))
  });
  // 1: el proveedor envio pero la respuesta se perdio (falla ambigua).
  const mail = recorder(count => (count === 1 ? new Error("socket hang up") : "sent"));

  await run(db, DAY1, mail);

  assert.ok(db.docs.get("storageHealthControl/state").outbox, "el lote queda abierto");

  // Antes del reintento aparece otro evento.
  db.docs.set("workspaces/w2/stateModules/log/entries/auditLog", bigAuditLog(Math.round(MiB * 0.72)));
  await run(db, DAY1 + DAY, mail);

  assert.equal(mail.sent[1].idempotencyKey, mail.sent[0].idempotencyKey, "misma clave");
  assert.equal(mail.sent[1].text, mail.sent[0].text, "mismo cuerpo (Resend rechaza otro cuerpo con la misma clave)");
  assert.doesNotMatch(mail.sent[1].text, /Urgencia/);
  assert.equal(db.docs.get("storageHealthControl/state").outbox, null, "lote cerrado al confirmarse");

  const urgencia = events(db).find(event => event.workspaceId === "w2");

  assert.equal(urgencia.deliveryPending, true, "el evento nuevo espera su lote");

  await run(db, DAY1 + 2 * DAY, mail);

  assert.equal(mail.sent.length, 3);
  assert.notEqual(mail.sent[2].idempotencyKey, mail.sent[0].idempotencyKey);
  assert.match(mail.sent[2].text, /Urgencia/);
  assert.doesNotMatch(mail.sent[2].text, /Imagenologia/, "lo ya enviado no se repite");
  assert.ok(events(db).every(event => event.delivery.status === "sent"));
});

test("outbox: si nunca se llego al proveedor (skipped), el lote se suelta y el siguiente suma lo nuevo", async () => {
  const db = fakeFirestore({
    "workspaces/w1": { name: "Imagenologia" },
    "workspaces/w2": { name: "Urgencia" },
    [AUDIT_PATH]: bigAuditLog(Math.round(MiB * 0.86))
  });
  const mail = recorder(count => (count === 1 ? "skipped_no_api_key" : "sent"));

  await run(db, DAY1, mail);
  assert.equal(db.docs.get("storageHealthControl/state").outbox, null);

  db.docs.set("workspaces/w2/stateModules/log/entries/auditLog", bigAuditLog(Math.round(MiB * 0.72)));
  await run(db, DAY1 + DAY, mail);

  assert.match(mail.sent[1].text, /Imagenologia/);
  assert.match(mail.sent[1].text, /Urgencia/);
});

test("programada: espera a que se suelte un candado de entregas y hace la revision completa", async () => {
  const db = fakeFirestore({
    "workspaces/w1": { name: "Imagenologia" },
    "storageHealthControl/state": { lock: { runId: "r", mode: "deliveries", trigger: "manual", expiresAtMillis: DAY1 + 10 * 60 * 1000 } }
  });
  let clock = DAY1;
  const sleeps = [];
  const result = await runScheduledStorageHealthCheck({
    db,
    log: silentLog,
    now: () => clock,
    sleep: async ms => {
      sleeps.push(ms);
      clock += ms;
      // El reintento de entregas termina.
      db.docs.set("storageHealthControl/state", { lock: null, lastRun: { mode: "deliveries", ok: true } });
    }
  });

  assert.equal(sleeps.length, 1);
  assert.equal(result.units, 1, "corrio la revision completa");
  assert.ok(db.docs.has("storageHealthReports/2026-10-02/units/w1"));
  assert.equal(db.docs.get("storageHealthControl/state").lastFullRun.date, "2026-10-02");
});

test("programada: si mientras esperaba termino una completa de hoy, esa cuenta como la del dia", async () => {
  const db = fakeFirestore({
    "workspaces/w1": { name: "Imagenologia" },
    "storageHealthControl/state": { lock: { runId: "manual", mode: "full", trigger: "manual", expiresAtMillis: DAY1 + 10 * 60 * 1000 } }
  });
  let clock = DAY1;
  const result = await runScheduledStorageHealthCheck({
    db,
    log: silentLog,
    now: () => clock,
    sleep: async ms => {
      clock += ms;
      db.docs.set("storageHealthControl/state", {
        lock: null,
        lastFullRun: { runId: "manual", date: "2026-10-02", startedAtMillis: DAY1 - 60 * 1000, trigger: "manual" }
      });
    }
  });

  assert.deepEqual(result, { skipped: "full_run_done", runId: "manual" });
});

test("programada: si el candado no se suelta, falla (para que el programador reintente) en vez de omitir el dia", async () => {
  const db = fakeFirestore({
    "workspaces/w1": { name: "Imagenologia" },
    "storageHealthControl/state": { lock: { runId: "r", mode: "deliveries", expiresAtMillis: DAY1 + 60 * 60 * 1000 } }
  });
  let clock = DAY1;

  await assert.rejects(
    runScheduledStorageHealthCheck({ db, log: silentLog, now: () => clock, sleep: async ms => { clock += ms; } }),
    /candado ocupado \(deliveries\)/
  );
  assert.ok(!db.docs.has("storageHealthReports/2026-10-02"), "no se dio por hecha");
});

test("una unidad eliminada se marca como tal y conserva su historial", async () => {
  const db = fakeFirestore({
    "workspaces/w1": { name: "Imagenologia" },
    "workspaces/w2": { name: "Urgencia" },
    "workspaces/w2/stateModules/log/entries/auditLog": bigAuditLog(Math.round(MiB * 0.86))
  });

  await run(db, DAY1, recorder());
  [...db.docs.keys()].filter(key => key.startsWith("workspaces/w2")).forEach(key => db.docs.delete(key));

  const summary = await run(db, DAY1 + DAY, recorder());
  const state = db.docs.get("storageHealthUnits/w2");

  assert.equal(summary.units, 1);
  assert.equal(summary.removedUnits, 1);
  assert.equal(state.status, "deleted");
  assert.equal(state.deletedDetectedAtMillis, DAY1 + DAY);
  assert.deepEqual(state.alerts, { documents: [], audits: [] });
  assert.ok(db.docs.has("storageHealthReports/2026-10-02/units/w2"), "historial conservado");

  const again = await run(db, DAY1 + 2 * DAY, recorder());

  assert.equal(again.removedUnits, 0, "se marca una sola vez");
});

test("outbox: el reintento manda el MISMO cuerpo HTTP y la misma clave aunque cambien destinatario y remitente", async () => {
  const db = fakeFirestore({
    "workspaces/w1": { name: "Imagenologia" },
    [AUDIT_PATH]: bigAuditLog(Math.round(MiB * 0.86))
  });
  const requests = [];
  const resend = responses => async (url, init) => {
    requests.push({ url, key: init.headers["Idempotency-Key"], body: init.body });
    const next = responses.shift();

    if (next instanceof Error) throw next;
    return next;
  };

  // 1er intento: Resend recibe la solicitud pero la respuesta se pierde.
  const before = createStorageAlertSender({
    to: "tecnico-viejo@turnoplus.cl",
    from: "TurnoPlus <viejo@turnoplus.cl>",
    apiKey: "re_test",
    fetchImpl: resend([new Error("socket hang up")])
  });

  await run(db, DAY1, { sendAlert: before });

  const outbox = db.docs.get("storageHealthControl/state").outbox;

  assert.equal(typeof outbox.body, "string", "el cuerpo completo queda en el outbox antes del intento");
  assert.equal(outbox.body, requests[0].body);

  // Entre medio cambian STORAGE_ALERT_EMAIL y MAIL_FROM, y entra otro evento.
  db.docs.set("workspaces/w2", { name: "Urgencia" });
  db.docs.set("workspaces/w2/stateModules/log/entries/auditLog", bigAuditLog(Math.round(MiB * 0.72)));

  const after = createStorageAlertSender({
    to: "tecnico-nuevo@turnoplus.cl",
    from: "TurnoPlus <nuevo@turnoplus.cl>",
    apiKey: "re_test",
    fetchImpl: resend([{ ok: true, json: async () => ({ id: "resend-1" }) }, { ok: true, json: async () => ({ id: "resend-2" }) }])
  });

  await run(db, DAY1 + DAY, { sendAlert: after });

  assert.equal(requests[1].key, requests[0].key, "misma Idempotency-Key");
  assert.equal(requests[1].body, requests[0].body, "mismo cuerpo HTTP completo");

  const retried = JSON.parse(requests[1].body);

  assert.deepEqual(retried.to, ["tecnico-viejo@turnoplus.cl"]);
  assert.equal(retried.from, "TurnoPlus <viejo@turnoplus.cl>");
  assert.doesNotMatch(retried.text, /Urgencia/);
  assert.equal(db.docs.get("storageHealthControl/state").outbox, null, "lote cerrado al confirmarse");

  // El lote SIGUIENTE ya usa la configuracion nueva.
  await run(db, DAY1 + 2 * DAY, { sendAlert: after });

  const next = JSON.parse(requests[2].body);

  assert.notEqual(requests[2].key, requests[0].key);
  assert.deepEqual(next.to, ["tecnico-nuevo@turnoplus.cl"]);
  assert.equal(next.from, "TurnoPlus <nuevo@turnoplus.cl>");
  assert.match(next.text, /Urgencia/);
  assert.ok(events(db).every(event => event.delivery.status === "sent"));
});
