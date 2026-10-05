"use strict";

// Unidad de practica: una por supervisor/administrador, creada por el servidor
// y reiniciable solo por su duena.

const test = require("node:test");
const assert = require("node:assert/strict");
const { HttpsError } = require("firebase-functions/v2/https");
const {
  ensurePracticeWorkspaceHandler,
  resetPracticeWorkspaceHandler,
  practiceWorkspaceId
} = require("../practiceWorkspace");
const { fakeFirestore } = require("./helpers/fakeFirestore");

const deps = db => ({ db, HttpsError, serverTimestamp: () => "SERVER_TIMESTAMP" });
const supervisor = { uid: "sup1", token: { email: "sup@ejemplo.cl", name: "Supervisora" } };

test("se crea para quien es miembro de una unidad real, como duena y marcada de practica", async () => {
  const db = fakeFirestore({ "users/sup1/workspaces/real1": { name: "UCI", role: "supervisor" } });
  const result = await ensurePracticeWorkspaceHandler({ auth: supervisor }, deps(db));
  const id = practiceWorkspaceId("sup1");

  assert.deepEqual(result, { workspaceId: id, created: true });
  assert.equal(db.docs.get(`workspaces/${id}`).practice, true);
  assert.equal(db.docs.get(`workspaces/${id}`).ownerUid, "sup1");
  assert.equal(db.docs.get(`workspaces/${id}`).stateStorage, "entries-v1", "mismo formato que una unidad nueva");
  assert.equal(db.docs.get(`workspaces/${id}/members/sup1`).role, "owner");
  assert.equal(db.docs.get(`users/sup1/workspaces/${id}`).practice, true);

  // La segunda vez no la vuelve a crear ni toca nada.
  const writes = db.stats.writes;
  const again = await ensurePracticeWorkspaceHandler({ auth: supervisor }, deps(db));

  assert.equal(again.created, false);
  assert.equal(db.stats.writes, writes);
});

test("no se crea sin sesion ni para quien solo tiene su unidad de practica (o ninguna)", async () => {
  const db = fakeFirestore({ [`users/sup1/workspaces/${practiceWorkspaceId("sup1")}`]: { practice: true } });

  await assert.rejects(ensurePracticeWorkspaceHandler({ auth: null }, deps(db)), /iniciar sesión/);
  await assert.rejects(ensurePracticeWorkspaceHandler({ auth: supervisor }, deps(db)), /supervisores y administradores/);
});

test("reiniciar borra el contenido pero conserva a la duena y la unidad", async () => {
  const id = practiceWorkspaceId("sup1");
  const db = fakeFirestore({
    [`workspaces/${id}`]: { practice: true, ownerUid: "sup1" },
    [`workspaces/${id}/members/sup1`]: { role: "owner" },
    [`workspaces/${id}/stateModules/profile`]: { moduleId: "profile" },
    [`workspaces/${id}/stateModules/profile/entries/profiles`]: { value: "[]" },
    [`workspaces/${id}/replacementRequests/r1`]: { status: "pending" }
  });

  assert.deepEqual(await resetPracticeWorkspaceHandler({ auth: supervisor }, deps(db)), { workspaceId: id, reset: true });
  assert.deepEqual([...db.docs.keys()].sort(), [`workspaces/${id}`, `workspaces/${id}/members/sup1`]);
  assert.equal(db.docs.get(`workspaces/${id}`).practiceResetAt, "SERVER_TIMESTAMP");
});

test("reiniciar nunca toca una unidad real ni la practica de otra persona", async () => {
  const id = practiceWorkspaceId("sup1");
  // Sin la marca de practica (o de otra duena): no se toca.
  const db = fakeFirestore({
    [`workspaces/${id}`]: { practice: false, ownerUid: "sup1" },
    [`workspaces/${id}/stateModules/profile/entries/profiles`]: { value: "[]" }
  });

  await assert.rejects(resetPracticeWorkspaceHandler({ auth: supervisor }, deps(db)), /No tienes una unidad de práctica/);
  assert.equal(db.docs.has(`workspaces/${id}/stateModules/profile/entries/profiles`), true);

  const other = fakeFirestore({ [`workspaces/${id}`]: { practice: true, ownerUid: "otra" } });

  await assert.rejects(resetPracticeWorkspaceHandler({ auth: supervisor }, deps(other)), /No tienes una unidad de práctica/);
});

test("nada sale de la unidad de practica y no cuenta para el plan", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { isPracticeWorkspaceId } = require("../practiceWorkspace");
  const index = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const body = name => index.slice(index.indexOf(`exports.${name} = onCall(`), index.indexOf(`exports.${name} = onCall(`) + 1600);

  assert.equal(isPracticeWorkspaceId("practice_abc"), true);
  assert.equal(isPracticeWorkspaceId("C3SGdWKXzN0cWsXJFmq4"), false);

  // Invitaciones, enlace por correo, PWA, prestamos, ausencias entre unidades y transferencias.
  ["createSupervisorInvite", "sendSupervisorInviteEmail", "acceptWorkerAppInvite", "requestWorkspaceLinkByOwnerEmail", "createInterUnitLoan", "createInterUnitAbsenceRequest", "createWorkerTransferRequest"]
    .forEach(name => assert.match(body(name), /rejectPracticeWorkspace\(/, name));

  // El plan no suma sus trabajadores ni la cuenta como unidad; y no se ofrece para enlazar.
  assert.match(index, /doc\.data\(\)\?\.practice !== true &&\s*!isPracticeWorkspaceId\(doc\.id\)/);
  assert.match(index, /if \(data\.practice === true \|\| isPracticeWorkspaceId\(docSnap\.id\)\) return;/);
});
