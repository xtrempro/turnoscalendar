"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const {
  FIRESTORE_DOCUMENT_LIMIT_BYTES,
  compareAuditLogFormats,
  compareReplacementFormats,
  estimateFirestoreDocumentBytes,
  growthBetween,
  healthLevel,
  levelIncreases
} = require("../lib/storageHealth");
const {
  runStorageHealthCheck,
  createStorageAlertSender
} = require("../storageHealthMonitor");

const MiB = FIRESTORE_DOCUMENT_LIMIT_BYTES;
const silentLog = { info() {}, warn() {}, error() {} };

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

test("solo se avisa cuando un documento SUBE de nivel", () => {
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

// --- Firestore de mentira para el recorrido completo -----------------------

function fakeDb(seed) {
  const docs = new Map(Object.entries(seed));
  const snapshotOf = (docPath) => ({
    id: docPath.split("/").pop(),
    ref: { path: docPath },
    exists: docs.has(docPath),
    data: () => docs.get(docPath)
  });
  const childrenOf = (collectionPath) => [...docs.keys()].filter(key =>
    key.startsWith(`${collectionPath}/`) &&
    !key.slice(collectionPath.length + 1).includes("/")
  );
  const collection = (collectionPath) => {
    const query = {
      filters: [],
      order: null,
      max: Infinity,
      where(field, op, value) {
        this.filters.push({ field, op, value });
        return this;
      },
      orderBy(field, direction) {
        this.order = { field, direction };
        return this;
      },
      limit(count) {
        this.max = count;
        return this;
      },
      async get() {
        let rows = childrenOf(collectionPath).map(snapshotOf);

        this.filters.forEach(({ field, op, value }) => {
          rows = rows.filter(row => op === "<" ? row.data()[field] < value : true);
        });
        if (this.order) {
          rows.sort((a, b) => String(a.data()[this.order.field]).localeCompare(String(b.data()[this.order.field])));
          if (this.order.direction === "desc") rows.reverse();
        }
        rows = rows.slice(0, this.max);

        return {
          empty: !rows.length,
          size: rows.length,
          docs: rows,
          forEach: fn => rows.forEach(fn)
        };
      },
      async listDocuments() {
        const ids = new Set(
          [...docs.keys()]
            .filter(key => key.startsWith(`${collectionPath}/`))
            .map(key => key.slice(collectionPath.length + 1).split("/")[0])
        );

        return [...ids].map(id => ({
          id,
          collection: name => collection(`${collectionPath}/${id}/${name}`)
        }));
      }
    };

    return Object.assign(Object.create(query), { filters: [], order: null, max: Infinity });
  };

  return {
    docs,
    collection,
    doc: docPath => ({
      async get() { return snapshotOf(docPath); },
      async set(value) { docs.set(docPath, value); }
    })
  };
}

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
      return typeof result === "function" ? result(sent.length) : result;
    }
  };
}

test("recorrido diario: avisa al cruzar el 85 % una sola vez y mide el crecimiento", async () => {
  const db = fakeDb({
    "workspaces/w1": { name: "Imagenologia" },
    [AUDIT_PATH]: bigAuditLog(Math.round(MiB * 0.86))
  });
  const mail = recorder("sent");

  const first = await runStorageHealthCheck({ db, now: DAY1, sendAlert: mail.sendAlert, log: silentLog });

  assert.equal(first.delivery, "sent");
  assert.equal(mail.sent.length, 1);
  assert.match(mail.sent[0].text, /CRITICO .*Imagenologia log\/auditLog/);

  db.docs.set(AUDIT_PATH, bigAuditLog(Math.round(MiB * 0.86) + 5000));
  const second = await runStorageHealthCheck({ db, now: DAY1 + DAY, sendAlert: mail.sendAlert, log: silentLog });

  assert.equal(second.changes, 0, "mismo nivel: no se repite");
  assert.equal(mail.sent.length, 1);

  const unitReport = db.docs.get("storageHealthReports/2026-10-03/units/w1");

  assert.equal(unitReport.documents[0].bytesPerDay, 5000);
});

test("si el correo NO sale, el aviso no se consume: se reintenta al dia siguiente", async () => {
  const db = fakeDb({
    "workspaces/w1": { name: "Imagenologia" },
    [AUDIT_PATH]: bigAuditLog(Math.round(MiB * 0.86))
  });
  const failing = recorder("skipped_no_api_key");

  const first = await runStorageHealthCheck({ db, now: DAY1, sendAlert: failing.sendAlert, log: silentLog });

  assert.equal(first.delivery, "skipped_no_api_key");
  assert.deepEqual(db.docs.get("storageHealthUnits/w1").emailed, { levels: {}, audits: {} });
  // Lo vigente si queda para el banner del dueno.
  assert.equal(db.docs.get("storageHealthUnits/w1").alerts.documents[0].level, "critical");

  const working = recorder("sent");
  const second = await runStorageHealthCheck({ db, now: DAY1 + DAY, sendAlert: working.sendAlert, log: silentLog });

  assert.equal(second.delivery, "sent");
  assert.match(working.sent[0].text, /CRITICO/);
});

test("avisa la recuperacion cuando un documento baja del umbral", async () => {
  const db = fakeDb({
    "workspaces/w1": { name: "Imagenologia" },
    [AUDIT_PATH]: bigAuditLog(Math.round(MiB * 0.86))
  });
  const mail = recorder("sent");

  await runStorageHealthCheck({ db, now: DAY1, sendAlert: mail.sendAlert, log: silentLog });
  db.docs.set(AUDIT_PATH, bigAuditLog(Math.round(MiB * 0.5)));
  await runStorageHealthCheck({ db, now: DAY1 + DAY, sendAlert: mail.sendAlert, log: silentLog });

  assert.equal(mail.sent.length, 2);
  assert.match(mail.sent[1].text, /Recuperado: Imagenologia log\/auditLog bajo de 85%/);
  assert.deepEqual(db.docs.get("storageHealthUnits/w1").alerts.documents, []);
});

test("diferencias entre formatos: avisa, y avisa cuando vuelve a quedar limpio", async () => {
  const legacy = {
    storageKey: "auditLog",
    container: "array",
    items: { a: JSON.stringify({ id: "a", createdAt: "2026-09-01T10:00:00Z" }) },
    deletedItems: { a: false }
  };
  const db = fakeDb({
    "workspaces/w1": { name: "Imagenologia", auditLogStorage: "shards-read-v1" },
    [AUDIT_PATH]: legacy,
    "workspaces/w1/auditLogShards/2026-09-01_0": { items: {} }
  });
  const mail = recorder("sent");

  await runStorageHealthCheck({ db, now: DAY1, sendAlert: mail.sendAlert, log: silentLog });

  assert.match(mail.sent[0].text, /Diferencias entre formatos: Imagenologia auditLog: 1/);
  assert.equal(db.docs.get("storageHealthUnits/w1").alerts.audits[0].issues, 1);

  db.docs.set("workspaces/w1/auditLogShards/2026-09-01_0", { items: { a: legacy.items.a } });
  await runStorageHealthCheck({ db, now: DAY1 + DAY, sendAlert: mail.sendAlert, log: silentLog });

  assert.match(mail.sent[1].text, /Comparacion limpia otra vez: Imagenologia auditLog/);
});

test("una bitacora vieja que no se puede reconstruir NO pasa por limpia", async () => {
  const db = fakeDb({
    "workspaces/w1": { name: "Imagenologia", auditLogStorage: "shards-read-v1" },
    [AUDIT_PATH]: { storageKey: "auditLog", container: "array", value: "{roto", items: {} },
    "workspaces/w1/auditLogShards/2026-09-01_0": { items: {} }
  });
  const mail = recorder("sent");

  await runStorageHealthCheck({ db, now: DAY1, sendAlert: mail.sendAlert, log: silentLog });

  const audit = db.docs.get("storageHealthReports/2026-10-02/units/w1").audits[0];

  assert.equal(audit.unreadable, true);
  assert.equal(audit.issues, 1);
  assert.match(mail.sent[0].text, /No se pudo reconstruir el formato viejo de auditLog/);
});

test("una unidad que no se pudo medir conserva su estado y se avisa", async () => {
  const db = fakeDb({
    "workspaces/w1": { name: "Imagenologia" },
    [AUDIT_PATH]: bigAuditLog(Math.round(MiB * 0.86))
  });
  const mail = recorder("sent");

  await runStorageHealthCheck({ db, now: DAY1, sendAlert: mail.sendAlert, log: silentLog });

  const before = db.docs.get("storageHealthUnits/w1");
  const brokenCollection = db.collection;

  db.collection = path => {
    if (path === "workspaces/w1/stateModules") throw new Error("lectura fallida");
    return brokenCollection(path);
  };

  const second = await runStorageHealthCheck({ db, now: DAY1 + DAY, sendAlert: mail.sendAlert, log: silentLog });

  assert.deepEqual(second.incomplete, ["Imagenologia"]);
  assert.equal(second.complete, false);
  assert.deepEqual(db.docs.get("storageHealthUnits/w1"), before, "su estado anterior queda intacto");
  assert.match(mail.sent[1].text, /No se pudo medir la unidad Imagenologia/);
});

test("todo queda por unidad: resumen chico por fecha y detalle en units/{unidad}", async () => {
  const db = fakeDb({
    "workspaces/w1": { name: "A" },
    "workspaces/w2": { name: "B" },
    [AUDIT_PATH]: bigAuditLog(200 * 1024)
  });

  await runStorageHealthCheck({ db, now: DAY1, sendAlert: recorder().sendAlert, log: silentLog });

  const summary = db.docs.get("storageHealthReports/2026-10-02");

  assert.equal(summary.units, 2);
  assert.equal(summary.documents, undefined, "el resumen no lleva el detalle");
  assert.ok(db.docs.has("storageHealthReports/2026-10-02/units/w1"));
  assert.ok(db.docs.has("storageHealthReports/2026-10-02/units/w2"));
  assert.ok(db.docs.has("storageHealthUnits/w1"));
  assert.ok(db.docs.has("storageHealthUnits/w2"));
});

test("el correo no sale sin destinatario o sin clave, y lo dice", async () => {
  assert.equal(await createStorageAlertSender({ to: "", apiKey: "k", from: "x" })({ subject: "s", text: "t" }), "skipped_no_recipient");
  assert.equal(await createStorageAlertSender({ to: "a@b.cl", apiKey: "", from: "x" })({ subject: "s", text: "t" }), "skipped_no_api_key");
  assert.equal(
    await createStorageAlertSender({ to: "a@b.cl", apiKey: "k", from: "x", fetchImpl: async () => ({ ok: true }) })({ subject: "s", text: "t" }),
    "sent"
  );
});
