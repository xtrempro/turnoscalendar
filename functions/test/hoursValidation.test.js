"use strict";

// Visto bueno de horas (approveMonthlyHours): acredita quien lo dio y sobre que
// horas, con datos del servidor; nunca con lo que mande el cliente.

const test = require("node:test");
const assert = require("node:assert/strict");
const { HttpsError } = require("firebase-functions/v2/https");
const { approveMonthlyHoursHandler, hoursValidationDocId } = require("../hoursValidation");
const { fakeFirestore } = require("./helpers/fakeFirestore");

const WS = "w1";
const NOW = Date.parse("2026-09-05T15:00:00Z");
const SIGNATURE = "v1-abcd1234";

function setup(extra = {}) {
  const db = fakeFirestore({
    [`workspaces/${WS}/workerLinks/uidA`]: { uid: "uidA", profileName: "Ana Perez", profileRut: "11.111.111-1", profileId: "p-ana" },
    [`workspaces/${WS}/workerLinks/uidB`]: { uid: "uidB", profileName: "Beto Soto", profileRut: "22.222.222-2" },
    [`workspaces/${WS}/workerAppData/uidA`]: {
      profileName: "Ana Perez",
      reportValidationByMonth: { "2026-7": { signature: SIGNATURE, hasOvertime: true, totalDay: 12, totalFestive: 0 } }
    },
    [`workspaces/${WS}/workerAppData/uidB`]: {
      reportValidationByMonth: { "2026-7": { signature: "v1-beto", hasOvertime: true, totalDay: 24, totalFestive: 0 } }
    },
    ...extra
  });
  let clock = NOW;
  const call = (auth, data) => approveMonthlyHoursHandler({ auth, data }, {
    db,
    HttpsError,
    serverTimestamp: () => "SERVER_TIMESTAMP",
    nowMillis: () => clock
  });

  return { db, call, advance: ms => { clock += ms; } };
}

const asA = { uid: "uidA", token: {} };
const base = { workspaceId: WS, year: 2026, month: 7, signature: SIGNATURE };
const stateOf = (db, uid) => db.docs.get(`workspaces/${WS}/hoursValidations/${hoursValidationDocId(uid, 2026, 7)}`);
const eventsOf = (db, uid) => [...db.docs.keys()].filter(key =>
  key.startsWith(`workspaces/${WS}/hoursValidations/${hoursValidationDocId(uid, 2026, 7)}/events/`));

test("registra el visto bueno con la identidad del ENLACE, la huella publicada y la hora del servidor", async () => {
  const { db, call } = setup();
  // El cliente intenta colar otro nombre, RUT, totales y fecha: se ignoran.
  const result = await call(asA, {
    ...base,
    profile: "Beto Soto",
    profileRut: "22.222.222-2",
    totalDay: 999,
    validatedAt: "2099-01-01T00:00:00Z"
  });
  const state = stateOf(db, "uidA");

  assert.equal(result.status, "validated");
  assert.equal(hoursValidationDocId("uidA", 2026, 7), "uidA_2026-08");
  assert.deepEqual(
    {
      uid: state.uid,
      profileName: state.profileName,
      profileRut: state.profileRut,
      monthKey: state.monthKey,
      signature: state.signature,
      totalDay: state.totalDay,
      validatedAtMillis: state.validatedAtMillis,
      validatedAt: state.validatedAt,
      validationCount: state.validationCount
    },
    {
      uid: "uidA",
      profileName: "Ana Perez",
      profileRut: "11.111.111-1",
      monthKey: "2026-08",
      signature: SIGNATURE,
      totalDay: 12,
      validatedAtMillis: NOW,
      validatedAt: "SERVER_TIMESTAMP",
      validationCount: 1
    }
  );
  assert.equal(eventsOf(db, "uidA").length, 1, "un evento inmutable");
  assert.equal(stateOf(db, "uidB"), undefined, "no toca a otro trabajador");
});

test("A no puede validar por B: solo cuenta el uid de quien llama", async () => {
  const { db, call } = setup();

  // Aunque mande la huella de B, se compara contra la huella publicada para A.
  await assert.rejects(
    call(asA, { ...base, signature: "v1-beto" }),
    error => error instanceof HttpsError && error.code === "aborted"
  );
  assert.equal(stateOf(db, "uidB"), undefined);
});

test("sin sesion, sin enlace, enlace desvinculado o datos invalidos: rechaza sin escribir", async () => {
  const { db, call } = setup({ [`workspaces/${WS}/workerLinks/uidX`]: { uid: "uidX", profileName: "X", status: "unlinked" } });
  const writes = db.stats.writes;
  const cases = [
    [null, base, "unauthenticated"],
    [{ uid: "sinEnlace" }, base, "permission-denied"],
    [{ uid: "uidX" }, base, "permission-denied"],
    [asA, { ...base, workspaceId: "" }, "invalid-argument"],
    [asA, { ...base, workspaceId: "a/b" }, "invalid-argument"],
    [asA, { ...base, month: 12 }, "invalid-argument"],
    [asA, { ...base, signature: "" }, "invalid-argument"]
  ];

  for (const [auth, data, code] of cases) {
    await assert.rejects(call(auth, data), error => error instanceof HttpsError && error.code === code, code);
  }
  assert.equal(db.stats.writes, writes);
});

test("las horas cambiaron desde que las vio: pide revisar de nuevo", async () => {
  const { db, call } = setup();

  await assert.rejects(
    call(asA, { ...base, signature: "v1-vieja" }),
    error => error instanceof HttpsError && error.code === "aborted" && /Revisa el Anexo 2/.test(error.message)
  );
  assert.equal(stateOf(db, "uidA"), undefined);
});

test("mes sin Anexo publicado o sin horas extras: no hay nada que validar", async () => {
  const { call } = setup({
    [`workspaces/${WS}/workerAppData/uidA`]: {
      reportValidationByMonth: { "2026-7": { signature: SIGNATURE, hasOvertime: false } }
    }
  });

  await assert.rejects(call(asA, base), error => error.code === "failed-precondition" && /no tienes horas extras/.test(error.message));
  await assert.rejects(call(asA, { ...base, month: 6 }), error => error.code === "failed-precondition" && /todavía no está disponible/.test(error.message));
});

test("revalidar las mismas horas no repite el evento; horas nuevas, si (un estado por mes)", async () => {
  const { db, call, advance } = setup();

  await call(asA, base);
  advance(60000);

  const again = await call(asA, base);

  assert.equal(again.alreadyValidated, true);
  assert.equal(again.validatedAtMillis, NOW, "conserva la fecha del primer visto bueno");
  assert.equal(eventsOf(db, "uidA").length, 1);

  // La unidad publica horas nuevas y el trabajador valida de nuevo.
  db.docs.set(`workspaces/${WS}/workerAppData/uidA`, {
    reportValidationByMonth: { "2026-7": { signature: "v1-nueva", hasOvertime: true, totalDay: 24 } }
  });

  const renewed = await call(asA, { ...base, signature: "v1-nueva" });
  const state = stateOf(db, "uidA");

  assert.equal(renewed.alreadyValidated, false);
  assert.equal(state.signature, "v1-nueva");
  assert.equal(state.validationCount, 2);
  assert.equal(state.validatedAtMillis, NOW + 60000);
  assert.equal(eventsOf(db, "uidA").length, 2, "historial inmutable");
  assert.equal(
    [...db.docs.keys()].filter(key => key.startsWith(`workspaces/${WS}/hoursValidations/`) && !key.includes("/events/")).length,
    1,
    "un solo documento de estado por trabajador y mes (sin crecimiento)"
  );
});
