"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { HttpsError } = require("firebase-functions/v2/https");

const { createAdminGuard } = require("../lib/adminAuthorization");
const { createStorageHealthHandlers } = require("../storageHealthFunctions");
const { runStorageHealthCheck } = require("../storageHealthMonitor");
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
  assert.equal(page.events[0].delivery.status, "failed");
  assert.equal(page.events[0].delivery.lastError, "Resend 500");
  assert.ok(page.nextEventsCursor);

  const rest = await handlers.history({
    auth: auth.admin,
    data: { workspaceId: "w1", eventsLimit: 4, includeMeasurements: false, eventsBeforeMillis: page.nextEventsCursor }
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
