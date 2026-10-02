"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { HttpsError } = require("firebase-functions/v2/https");

const { createAdminGuard } = require("../lib/adminAuthorization");
const { createStorageHealthHandlers } = require("../storageHealthFunctions");
const { eventIdPrefix, runStorageHealthCheck } = require("../storageHealthMonitor");
const { MAX_HISTORY_LIMIT, MAX_EVENTS_LIMIT } = require("../storageHealthAdmin");
const { fakeFirestore } = require("./helpers/fakeFirestore");

const silentLog = { info() {}, warn() {}, error() {} };
const DAY = 24 * 60 * 60 * 1000;
const DAY1 = Date.parse("2026-10-02T08:30:00Z");
const MiB = 1024 * 1024;
const ADMIN_EMAIL = "admin@turnoplus.cl";

const auth = {
  admin: { uid: "a1", token: { email: ADMIN_EMAIL, email_verified: true } },
  claim: { uid: "a2", token: { email: "otro@x.cl", email_verified: true, admin: true } },
  adminDoc: { uid: "a3", token: { email: "doc@x.cl", email_verified: true } },
  unverified: { uid: "a4", token: { email: ADMIN_EMAIL, email_verified: false } },
  owner: { uid: "owner1", token: { email: "owner@hospital.cl", email_verified: true } }
};

function setup(seed = {}, { recipient = "tecnico@turnoplus.cl", apiKey = "re_clave" } = {}) {
  const db = fakeFirestore({ "adminUsers/a3": { active: true }, "adminUsers/owner1": { active: false }, ...seed });
  const { requireAdmin } = createAdminGuard({
    db,
    HttpsError,
    logger: silentLog,
    env: { ADMIN_EMAILS: ADMIN_EMAIL }
  });
  const senders = [];
  const sent = [];
  let clock = DAY1;
  const handlers = createStorageHealthHandlers({
    db,
    requireAdmin,
    config: () => ({ recipient, apiKey, from: "TurnoPlus <noreply@turnoplus.cl>" }),
    createSender: options => {
      senders.push(options);
      return async message => {
        sent.push({ ...message, to: options.to });
        return options.to ? { status: "sent", providerId: "p1" } : { status: "skipped_no_recipient" };
      };
    },
    now: () => clock
  });

  return { db, handlers, senders, sent, advance: ms => { clock += ms; } };
}

function seedUnits() {
  return {
    "workspaces/w1": { name: "Imagenologia", ownerUid: "owner1" },
    "workspaces/w2": { name: "Urgencia" },
    "users/owner1": { email: "owner@hospital.cl", displayName: "Duena" },
    "workspaces/w1/stateModules/log/entries/auditLog": {
      storageKey: "auditLog",
      container: "array",
      items: { a: "x".repeat(Math.round(MiB * 0.86)) }
    }
  };
}

const HANDLERS = ["overview", "history", "runNow", "testAlert"];

test("las 4 callables exigen sesion y administrador global, antes de tocar nada", async () => {
  for (const name of HANDLERS) {
    const { handlers, db, sent } = setup(seedUnits());
    const writesBefore = db.stats.writes;

    await assert.rejects(
      handlers[name]({ auth: null, data: {} }),
      error => error instanceof HttpsError && error.code === "unauthenticated",
      `${name} sin sesion`
    );
    for (const caller of [auth.unverified, auth.owner]) {
      await assert.rejects(
        // Un correo de admin mandado por el cliente en los datos no sirve.
        handlers[name]({ auth: caller, data: { email: ADMIN_EMAIL, admin: true, to: ADMIN_EMAIL } }),
        error => error instanceof HttpsError && error.code === "permission-denied",
        `${name} con ${caller.uid}`
      );
    }

    assert.equal(db.stats.writes, writesBefore, `${name} no escribe si se niega`);
    assert.equal(sent.length, 0, `${name} no manda correos si se niega`);
  }
});

test("el admin entra por correo configurado, por claim o por adminUsers", async () => {
  for (const caller of [auth.admin, auth.claim, auth.adminDoc]) {
    const { handlers } = setup(seedUnits());
    const overview = await handlers.overview({ auth: caller, data: {} });

    assert.equal(overview.status, "unknown", `${caller.uid} entra`);
  }
});

test("resumen: estado general, unidades, comparaciones y notificaciones, saneado", async () => {
  const { db, handlers } = setup(seedUnits());

  await runStorageHealthCheck({
    db,
    now: DAY1,
    log: silentLog,
    sendAlert: async () => ({ status: "skipped_no_api_key" })
  });

  const overview = await handlers.overview({ auth: auth.admin, data: {} });
  const imagenologia = overview.units.find(unit => unit.workspaceId === "w1");
  const text = JSON.stringify(overview);

  assert.equal(overview.status, "critical");
  assert.deepEqual(overview.counts, { total: 2, normal: 1, warning: 0, critical: 1, incomplete: 0 });
  assert.equal(overview.latestRun.date, "2026-10-02");
  assert.equal(overview.latestRun.units, 2);
  assert.equal(imagenologia.status, "critical");
  assert.equal(imagenologia.largest.storageKey, "auditLog");
  assert.deepEqual(imagenologia.account, { uid: "owner1", email: "owner@hospital.cl", name: "Duena" });
  assert.equal(overview.notifications.recipientConfigured, true);
  assert.equal(overview.notifications.recipient, "te***@turnoplus.cl");
  assert.equal(overview.notifications.apiKeyConfigured, true);
  assert.equal(overview.notifications.pendingEvents, 1);
  assert.equal(overview.notifications.lastDelivery.status, "skipped_no_api_key");
  // Nada interno ni secreto.
  assert.doesNotMatch(text, /re_clave|tecnico@turnoplus|idempotencyKey|"tracked"|"baseline"/);
});

test("resumen sin destinatario ni clave lo dice", async () => {
  const { handlers } = setup({}, { recipient: "", apiKey: "" });
  const overview = await handlers.overview({ auth: auth.admin, data: {} });

  assert.equal(overview.notifications.recipientConfigured, false);
  assert.equal(overview.notifications.recipient, null);
  assert.equal(overview.notifications.apiKeyConfigured, false);
  assert.deepEqual(overview.units, []);
});

test("historial: por unidad, paginado por fecha, con limites", async () => {
  const { db, handlers } = setup(seedUnits());

  for (let day = 0; day < 40; day++) {
    await runStorageHealthCheck({ db, now: DAY1 + day * DAY, log: silentLog });
  }

  const first = await handlers.history({ auth: auth.admin, data: { workspaceId: "w1", limit: 5 } });

  assert.equal(first.measurements.length, 5);
  assert.equal(first.measurements[0].date, "2026-11-10");
  assert.equal(first.nextCursor, "2026-11-06");
  assert.equal(first.measurements[0].workspaceId, "w1");

  const second = await handlers.history({ auth: auth.admin, data: { workspaceId: "w1", limit: 5, cursor: first.nextCursor } });

  assert.equal(second.measurements[0].date, "2026-11-05");

  const capped = await handlers.history({ auth: auth.admin, data: { limit: 1000, eventsLimit: 1000 } });

  assert.equal(capped.measurements.length, MAX_HISTORY_LIMIT);
  assert.ok(capped.events.length <= MAX_EVENTS_LIMIT);

  const ranged = await handlers.history({
    auth: auth.admin,
    data: { workspaceId: "w1", fromDate: "2026-10-05", toDate: "2026-10-07" }
  });

  assert.deepEqual(ranged.measurements.map(item => item.date), ["2026-10-07", "2026-10-06", "2026-10-05"]);
  assert.equal(ranged.nextCursor, null);

  for (const data of [{ workspaceId: "../w1" }, { fromDate: "ayer" }, { fromDate: "2026-10-09", toDate: "2026-10-01" }]) {
    await assert.rejects(
      handlers.history({ auth: auth.admin, data }),
      error => error instanceof HttpsError && error.code === "invalid-argument"
    );
  }
});

test("historial: eventos de la unidad paginados, con intentos de entrega", async () => {
  const { db, handlers } = setup(seedUnits());
  const path = "workspaces/w1/stateModules/log/entries/auditLog";

  // Sube y baja varias veces: un evento por transicion.
  for (let day = 0; day < 6; day++) {
    db.docs.set(path, { storageKey: "auditLog", items: { a: "x".repeat(Math.round(MiB * (day % 2 ? 0.5 : 0.86))) } });
    await runStorageHealthCheck({ db, now: DAY1 + day * DAY, log: silentLog, sendAlert: async () => ({ status: "failed", error: "Resend 500" }) });
  }

  const page = await handlers.history({ auth: auth.admin, data: { workspaceId: "w1", eventsLimit: 4, includeMeasurements: false } });

  assert.equal(page.measurements.length, 0);
  assert.equal(page.events.length, 4);
  assert.ok(page.events[0].detectedAtMillis > page.events[3].detectedAtMillis);
  // El primer lote fallo y sigue abierto (outbox): los eventos nuevos esperan.
  assert.equal(page.events[0].delivery.status, "pending");

  const all = [...page.events];
  let cursor = page.nextEventsCursor;

  while (cursor) {
    const next = await handlers.history({ auth: auth.admin, data: { workspaceId: "w1", eventsLimit: 4, includeMeasurements: false, eventsCursor: cursor } });

    all.push(...next.events);
    cursor = next.nextEventsCursor;
  }

  const oldest = all.sort((a, b) => a.detectedAtMillis - b.detectedAtMillis)[0];

  assert.equal(oldest.delivery.status, "failed");
  assert.equal(oldest.delivery.lastError, "Resend 500");
  assert.equal(oldest.delivery.attempts, 6, "el mismo lote se reintento cada dia");
  assert.ok(page.nextEventsCursor);

  const rest = await handlers.history({
    auth: auth.admin,
    data: { workspaceId: "w1", eventsLimit: 4, includeMeasurements: false, eventsCursor: page.nextEventsCursor }
  });

  assert.equal(rest.events.length, 2);
  assert.equal(rest.nextEventsCursor, null);
  assert.doesNotMatch(JSON.stringify(page), /idempotencyKey/);
});

test("ejecutar ahora: misma revision, con limite de frecuencia", async () => {
  const { handlers, db, advance } = setup(seedUnits());

  const result = await handlers.runNow({ auth: auth.admin, data: {} });

  assert.equal(result.mode, "full");
  assert.equal(result.trigger, "manual");
  assert.equal(result.units, 2);
  assert.equal(result.counts.critical, 1);
  assert.ok(db.docs.has("storageHealthUnits/w1"));

  await assert.rejects(
    handlers.runNow({ auth: auth.admin, data: {} }),
    error => error instanceof HttpsError && error.code === "resource-exhausted"
  );

  advance(3 * 60 * 1000);
  const deliveries = await handlers.runNow({ auth: auth.admin, data: { mode: "deliveries" } });

  assert.equal(deliveries.mode, "deliveries");
});

test("correo de prueba: siempre al destinatario configurado, nunca al que pida el cliente", async () => {
  const { handlers, sent, senders } = setup(seedUnits());

  const result = await handlers.testAlert({
    auth: auth.admin,
    data: { to: "owner@hospital.cl", recipient: "owner@hospital.cl" }
  });

  assert.equal(result.status, "sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "tecnico@turnoplus.cl");
  assert.ok(senders.every(options => options.to === "tecnico@turnoplus.cl"));
});

test("correo de prueba sin destinatario configurado: no sale y lo dice", async () => {
  const { handlers } = setup({}, { recipient: "" });
  const result = await handlers.testAlert({ auth: auth.admin, data: {} });

  assert.equal(result.status, "skipped_no_recipient");
});

// --- Regresiones de la auditoria de 066807d ---------------------------------

test("historial: 20 eventos del mismo milisegundo se paginan sin saltos ni repetidos", async () => {
  const seed = { "workspaces/w1": { name: "Grande" } };

  for (let index = 0; index < 20; index++) {
    seed[`workspaces/w1/stateModules/turnos/entries/k${index}`] = { storageKey: `k${index}`, value: "x".repeat(Math.round(MiB * 0.72)) };
  }

  const { db, handlers } = setup(seed);

  await runStorageHealthCheck({ db, now: DAY1, log: silentLog });

  const first = await handlers.history({ auth: auth.admin, data: { workspaceId: "w1", eventsLimit: 15, includeMeasurements: false } });
  const second = await handlers.history({ auth: auth.admin, data: { workspaceId: "w1", eventsLimit: 15, includeMeasurements: false, eventsCursor: first.nextEventsCursor } });
  const ids = [...first.events, ...second.events].map(event => event.eventId);

  assert.equal(first.events.length, 15);
  assert.equal(second.events.length, 5);
  assert.equal(second.nextEventsCursor, null);
  assert.equal(new Set(ids).size, 20, "sin repetidos");
  assert.ok(first.events.every(event => event.detectedAtMillis === DAY1));
});

test("historial: mas de 500 eventos de una unidad siguen siendo alcanzables", async () => {
  const seed = { "workspaces/w1": { name: "Imagenologia" } };

  for (let index = 0; index < 520; index++) {
    const day = new Date(DAY1 - Math.floor(index / 10) * DAY).toISOString().slice(0, 10);
    const id = `${eventIdPrefix(day)}_${String(index).padStart(32, "0")}`;

    seed[`storageHealthEvents/${id}`] = { eventId: id, workspaceId: "w1", type: "audit", line: `e${index}`, detectedAtMillis: DAY1 - Math.floor(index / 10) * DAY, delivery: {} };
  }
  seed["storageHealthEvents/2026-10-02_otra"] = { eventId: "2026-10-02_otra", workspaceId: "w2", detectedAtMillis: DAY1, delivery: {} };

  const { handlers } = setup(seed);
  const seen = new Set();
  let cursor = null;
  let pages = 0;
  const firstPage = await handlers.history({ auth: auth.admin, data: { workspaceId: "w1", eventsLimit: 10, includeMeasurements: false } });

  assert.ok(firstPage.events.every(event => event.detectedAtMillis === DAY1), "la primera pagina es la mas reciente");

  do {
    const page = await handlers.history({ auth: auth.admin, data: { workspaceId: "w1", eventsLimit: 50, includeMeasurements: false, ...(cursor ? { eventsCursor: cursor } : {}) } });

    page.events.forEach(event => {
      assert.equal(event.workspaceId, "w1");
      seen.add(event.eventId);
    });
    cursor = page.nextEventsCursor;
    pages++;
  } while (cursor && pages < 20);

  assert.equal(seen.size, 520);
  assert.equal(pages, 11);

  await assert.rejects(
    handlers.history({ auth: auth.admin, data: { eventsCursor: "../x" } }),
    error => error instanceof HttpsError && error.code === "invalid-argument"
  );
});

test("resumen: una unidad eliminada sale del panel y de los conteos, aun antes de la revision", async () => {
  const { db, handlers } = setup(seedUnits());

  await runStorageHealthCheck({ db, now: DAY1, log: silentLog });
  [...db.docs.keys()].filter(key => key.startsWith("workspaces/w1")).forEach(key => db.docs.delete(key));

  const overview = await handlers.overview({ auth: auth.admin, data: {} });

  assert.deepEqual(overview.units.map(unit => unit.workspaceId), ["w2"]);
  assert.deepEqual(overview.counts, { total: 1, normal: 1, warning: 0, critical: 0, incomplete: 0 });
  assert.equal(overview.status, "normal");
  assert.deepEqual(overview.removedUnits.map(unit => unit.workspaceId), ["w1"]);

  // Su historial sigue disponible.
  const history = await handlers.history({ auth: auth.admin, data: { workspaceId: "w1" } });

  assert.equal(history.measurements.length, 1);
});

test("sin dato sigue siendo sin dato: null no se convierte en 0 (ni dias al 85% ni fechas 1970)", async () => {
  const { db, handlers } = setup(seedUnits());

  // Primera medicion: sin crecimiento previo, sin alertas ni recuperaciones en w2.
  await runStorageHealthCheck({ db, now: DAY1, log: silentLog });

  const overview = await handlers.overview({ auth: auth.admin, data: {} });
  const urgencia = overview.units.find(unit => unit.workspaceId === "w2");
  const imagenologia = overview.units.find(unit => unit.workspaceId === "w1");

  assert.equal(urgencia.lastAlertAtMillis, null);
  assert.equal(urgencia.lastRecoveryAtMillis, null);
  assert.equal(imagenologia.largest.bytesPerDay, null, "sin medicion previa no hay crecimiento");
  assert.equal(imagenologia.largest.daysToCritical, null);
  assert.equal(imagenologia.lastRecoveryAtMillis, null);
  assert.equal(urgencia.monitoring.failedAtMillis, null);

  const history = await handlers.history({ auth: auth.admin, data: { workspaceId: "w2" } });

  assert.equal(history.measurements[0].metrics.shardDocuments, 0, "un 0 real se conserva");
});

test("version de escritura: el resumen y el historial la entregan saneada a Admin", async () => {
  const encode = id => encodeURIComponent(id).replace(/\./g, "%2E");
  const log = (id, createdAt, extra = {}) => ({ id, createdAt, action: "x", ...extra });
  const v1 = log("v1", "2026-10-02T07:00:00Z", { writer: { schemaVersion: 1, buildId: "20261002T060000Z-abc1234" } });
  const old = log("vieja", "2026-10-02T08:00:00Z");
  const { db, handlers } = setup({
    "workspaces/w1": { name: "Imagenologia" },
    "workspaces/w1/stateModules/log/entries/auditLog": {
      storageKey: "auditLog",
      container: "array",
      items: { [encode(v1.id)]: JSON.stringify(v1), [encode(old.id)]: JSON.stringify(old) },
      deletedItems: {}
    },
    "workspaces/w1/auditLogShards/2026-10-02_0": { items: { [encode(v1.id)]: JSON.stringify(v1), [encode(old.id)]: JSON.stringify(old) } }
  });

  await runStorageHealthCheck({ db, now: DAY1, log: silentLog });

  const overview = await handlers.overview({ auth: auth.admin, data: {} });
  const unit = overview.units.find(item => item.workspaceId === "w1");

  assert.equal(unit.auditLogVersions.unversionedRecent, 1);
  assert.equal(unit.auditLogVersions.adopted, true);
  assert.equal(unit.status, "normal");

  const history = await handlers.history({ auth: auth.admin, data: { workspaceId: "w1" } });
  const versions = history.measurements[0].auditLogVersions;

  assert.deepEqual(versions.unversionedIds, ["vieja"]);
  assert.deepEqual(versions.recentBuilds, { "20261002T060000Z-abc1234": 1 });
  assert.deepEqual(versions.writerMismatch, []);
  assert.equal(history.events.length, 0, "no genera eventos");
});

test("version: Admin recibe el total real de metadatos distintos (25), no el largo de la muestra (20)", async () => {
  const encode = id => encodeURIComponent(id).replace(/\./g, "%2E");
  const legacyItems = {};
  const shardItems = {};

  for (let index = 0; index < 25; index++) {
    const base = { id: `m${index}`, createdAt: "2026-10-02T07:00:00Z", action: "x" };

    legacyItems[encode(base.id)] = JSON.stringify({ ...base, writer: { schemaVersion: 1, buildId: "build-a" } });
    shardItems[encode(base.id)] = JSON.stringify({ ...base, writer: { schemaVersion: 1, buildId: "build-b" } });
  }

  const { db, handlers } = setup({
    "workspaces/w1": { name: "Imagenologia" },
    "workspaces/w1/stateModules/log/entries/auditLog": { storageKey: "auditLog", container: "array", items: legacyItems, deletedItems: {} },
    "workspaces/w1/auditLogShards/2026-10-02_0": { items: shardItems }
  });

  await runStorageHealthCheck({ db, now: DAY1, log: silentLog });

  const unit = (await handlers.overview({ auth: auth.admin, data: {} })).units.find(item => item.workspaceId === "w1");
  const measured = (await handlers.history({ auth: auth.admin, data: { workspaceId: "w1" } })).measurements[0].auditLogVersions;

  assert.equal(unit.auditLogVersions.writerMismatchCount, 25);
  assert.equal(unit.auditLogVersions.issues, 25);
  assert.equal(measured.writerMismatchCount, 25);
  assert.equal(measured.writerMismatch.length, 20, "muestra de ids");
});
