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

test("recorrido diario: avisa al cruzar el 85 % una sola vez y mide el crecimiento", async () => {
  const db = fakeDb({
    "workspaces/w1": { name: "Imagenologia" },
    "workspaces/w1/stateModules/log/entries/auditLog": bigAuditLog(Math.round(MiB * 0.86))
  });
  const sent = [];
  const sendAlert = async message => {
    sent.push(message);
    return "sent";
  };
  const day1 = Date.parse("2026-10-02T08:30:00Z");

  const first = await runStorageHealthCheck({ db, now: day1, sendAlert, log: silentLog });

  assert.equal(first.alerts.raised.length, 1);
  assert.equal(first.alerts.raised[0].to, "critical");
  assert.equal(first.alerts.delivery, "sent");
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /CRITICO .*Imagenologia log\/auditLog/);

  // Al dia siguiente crecio un poco: sigue critico, NO se repite el aviso.
  db.docs.set(
    "workspaces/w1/stateModules/log/entries/auditLog",
    bigAuditLog(Math.round(MiB * 0.86) + 5000)
  );
  const second = await runStorageHealthCheck({
    db,
    now: day1 + 24 * 60 * 60 * 1000,
    sendAlert,
    log: silentLog
  });

  assert.equal(second.alerts.raised.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(second.documents[0].bytesPerDay, 5000);
  assert.ok(db.docs.has("storageHealthReports/2026-10-03"));
});

test("recorrido diario: avisa si la comparacion de formatos encuentra diferencias", async () => {
  const db = fakeDb({
    "workspaces/w1": { name: "Imagenologia", auditLogStorage: "shards-read-v1" },
    "workspaces/w1/stateModules/log/entries/auditLog": {
      storageKey: "auditLog",
      container: "array",
      items: { a: JSON.stringify({ id: "a", createdAt: "2026-09-01T10:00:00Z" }) },
      deletedItems: { a: false }
    },
    "workspaces/w1/auditLogShards/2026-09-01_0": { items: {} }
  });
  const sent = [];
  const report = await runStorageHealthCheck({
    db,
    now: Date.parse("2026-10-02T08:30:00Z"),
    sendAlert: async message => { sent.push(message); return "sent"; },
    log: silentLog
  });

  assert.equal(report.audits[0].issues, 1);
  assert.equal(report.alerts.auditIssues.length, 1);
  assert.match(sent[0].text, /Diferencias entre formatos: Imagenologia auditLog: 1/);
});

test("el correo no sale sin destinatario o sin clave, y lo dice", async () => {
  assert.equal(await createStorageAlertSender({ to: "", apiKey: "k", from: "x" })({ subject: "s", text: "t" }), "skipped_no_recipient");
  assert.equal(await createStorageAlertSender({ to: "a@b.cl", apiKey: "", from: "x" })({ subject: "s", text: "t" }), "skipped_no_api_key");
  assert.equal(
    await createStorageAlertSender({ to: "a@b.cl", apiKey: "k", from: "x", fetchImpl: async () => ({ ok: true }) })({ subject: "s", text: "t" }),
    "sent"
  );
});
