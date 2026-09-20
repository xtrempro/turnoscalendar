"use strict";

// Permiso para usar la ausencia de OTRA unidad como respaldo de un contrato.
//
// Lo que fija este archivo: que crear deje la solicitud PENDIENTE y nunca un
// contrato, que una ausencia no se pueda comprometer dos veces, y sobre todo
// que solo la unidad DUEÑA de la ausencia pueda responder. Sin esa ultima
// comprobacion, la unidad solicitante podria aprobarse sola y todo el ida y
// vuelta seria decorativo.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  APPROVED,
  COLLECTION,
  PENDING,
  REJECTED,
  createInterUnitAbsenceRequestHandler,
  respondInterUnitAbsenceRequestHandler
} = require("../interUnitAbsenceRequests.js");

/* =========================================================
   Dobles
========================================================= */

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class FakeDoc {
  constructor(db, path) {
    this.db = db;
    this.path = path;
  }

  get() {
    const data = this.db.documents.get(this.path);

    return Promise.resolve({
      exists: data !== undefined,
      data: () => data
    });
  }

  set(value) {
    this.db.documents.set(this.path, value);

    return Promise.resolve();
  }

  update(value) {
    this.db.documents.set(this.path, {
      ...(this.db.documents.get(this.path) || {}),
      ...value
    });

    return Promise.resolve();
  }
}

class FakeCol {
  constructor(db, path, filters = []) {
    this.db = db;
    this.path = path;
    this.filters = filters;
  }

  doc(id) {
    return new FakeDoc(this.db, `${this.path}/${id}`);
  }

  where(field, op, value) {
    return new FakeCol(
      this.db,
      this.path,
      [...this.filters, { field, value }]
    );
  }

  get() {
    const docs = [...this.db.documents.entries()]
      .filter(([path]) => path.startsWith(`${this.path}/`))
      .map(([, data]) => ({ data: () => data }))
      .filter(snap => this.filters.every(filter =>
        snap.data()?.[filter.field] === filter.value
      ));

    return Promise.resolve({ docs });
  }
}

class FakeDb {
  constructor(documents = {}) {
    this.documents = new Map(Object.entries(documents));
  }

  collection(name) {
    return new FakeCol(this, name);
  }
}

function dependencies(db, overrides = {}) {
  const calls = { manager: [], link: [] };

  return {
    calls,
    deps: {
      db,
      HttpsError,
      serverTimestamp: () => "AHORA",
      idFactory: () => "req-1",
      requireWorkspaceRequestManager: async (workspaceId, uid) => {
        calls.manager.push({ workspaceId, uid });
      },
      requireAcceptedWorkspaceLink: async (linkId, source, host) => {
        calls.link.push({ linkId, source, host });
      },
      ...overrides
    }
  };
}

const DATOS = {
  workspaceId: "w-mia",
  ownerWorkspaceId: "w-otra",
  linkId: "l-1",
  replacementProfileName: "Rita Reemplazo",
  absenceProfileName: "Ana Perez",
  leaveRef: "Ana%20Perez|legal|2026-09-01|2026-09-10",
  leaveType: "legal",
  leaveLabel: "F. Legal",
  leaveStart: "2026-09-01",
  leaveEnd: "2026-09-10",
  rotationMode: "inherit"
};

const peticion = (data, uid = "supervisor") => ({
  auth: { uid, token: {} },
  data
});

async function falla(promesa, code) {
  await assert.rejects(promesa, error => {
    assert.equal(error.code, code);
    return true;
  });
}

/* =========================================================
   Crear: siempre pendiente
========================================================= */

test("crear deja la solicitud PENDIENTE, nunca un contrato", async () => {
  const db = new FakeDb();
  const { deps } = dependencies(db);
  const result = await createInterUnitAbsenceRequestHandler(
    peticion(DATOS),
    deps
  );

  assert.equal(result.status, PENDING);

  const guardada = db.documents.get(`${COLLECTION}/req-1`);

  assert.equal(guardada.status, PENDING);
  assert.equal(guardada.requesterWorkspaceId, "w-mia");
  assert.equal(guardada.ownerWorkspaceId, "w-otra");
  assert.equal(guardada.leaveRef, DATOS.leaveRef);
  assert.equal(guardada.rotationMode, "inherit");
});

test("se comprueban el permiso propio y el enlace entre las dos unidades", async () => {
  // El enlace no se puede verificar en el cliente: por eso las reglas no
  // dejan crear desde el navegador y esto pasa si o si por el servidor.
  const db = new FakeDb();
  const { deps, calls } = dependencies(db);

  await createInterUnitAbsenceRequestHandler(peticion(DATOS), deps);

  assert.deepEqual(calls.manager, [{ workspaceId: "w-mia", uid: "supervisor" }]);
  assert.deepEqual(calls.link, [{
    linkId: "l-1",
    source: "w-otra",
    host: "w-mia"
  }]);
});

test("no se pide una ausencia a la propia unidad", async () => {
  const { deps } = dependencies(new FakeDb());

  await falla(
    createInterUnitAbsenceRequestHandler(
      peticion({ ...DATOS, ownerWorkspaceId: "w-mia" }),
      deps
    ),
    "invalid-argument"
  );
});

test("sin ausencia identificada no hay solicitud", async () => {
  const { deps } = dependencies(new FakeDb());

  await falla(
    createInterUnitAbsenceRequestHandler(
      peticion({ ...DATOS, leaveRef: "" }),
      deps
    ),
    "invalid-argument"
  );
});

test("un rango al reves se rechaza", async () => {
  const { deps } = dependencies(new FakeDb());

  await falla(
    createInterUnitAbsenceRequestHandler(
      peticion({ ...DATOS, leaveStart: "2026-09-10", leaveEnd: "2026-09-01" }),
      deps
    ),
    "invalid-argument"
  );
});

/* =========================================================
   Una ausencia no se compromete dos veces
========================================================= */

test("si ya hay una solicitud pendiente por esa ausencia, no se crea otra", async () => {
  const db = new FakeDb({
    [`${COLLECTION}/previa`]: {
      leaveRef: DATOS.leaveRef,
      ownerWorkspaceId: "w-otra",
      status: PENDING
    }
  });
  const { deps } = dependencies(db);

  await falla(
    createInterUnitAbsenceRequestHandler(peticion(DATOS), deps),
    "failed-precondition"
  );
});

test("tampoco si ya fue autorizada", async () => {
  // Autorizada, la ausencia queda ocupada para todos: dos unidades no pueden
  // respaldar dos contratos con la ausencia de una sola persona.
  const db = new FakeDb({
    [`${COLLECTION}/previa`]: {
      leaveRef: DATOS.leaveRef,
      ownerWorkspaceId: "w-otra",
      status: APPROVED
    }
  });
  const { deps } = dependencies(db);

  await falla(
    createInterUnitAbsenceRequestHandler(peticion(DATOS), deps),
    "failed-precondition"
  );
});

test("una rechazada NO bloquea volver a pedirla", async () => {
  const db = new FakeDb({
    [`${COLLECTION}/previa`]: {
      leaveRef: DATOS.leaveRef,
      ownerWorkspaceId: "w-otra",
      status: REJECTED
    }
  });
  const { deps } = dependencies(db);
  const result = await createInterUnitAbsenceRequestHandler(
    peticion(DATOS),
    deps
  );

  assert.equal(result.status, PENDING);
});

/* =========================================================
   Responder: solo la unidad dueña
========================================================= */

function conPendiente() {
  return new FakeDb({
    [`${COLLECTION}/req-1`]: {
      requesterWorkspaceId: "w-mia",
      ownerWorkspaceId: "w-otra",
      leaveRef: DATOS.leaveRef,
      status: PENDING
    }
  });
}

test("la unidad que pide NO puede aprobarse sola", async () => {
  // Es el agujero que invalidaria todo el ida y vuelta.
  const db = conPendiente();
  const { deps } = dependencies(db);

  await falla(
    respondInterUnitAbsenceRequestHandler(
      peticion({
        workspaceId: "w-mia",
        requestId: "req-1",
        status: APPROVED
      }),
      deps
    ),
    "permission-denied"
  );
  assert.equal(db.documents.get(`${COLLECTION}/req-1`).status, PENDING);
});

test("la unidad dueña autoriza y queda registrado quien fue", async () => {
  const db = conPendiente();
  const { deps, calls } = dependencies(db);
  const result = await respondInterUnitAbsenceRequestHandler(
    peticion({
      workspaceId: "w-otra",
      requestId: "req-1",
      status: APPROVED,
      resolvedByName: "Jefa de la otra unidad"
    }, "jefa"),
    deps
  );

  assert.equal(result.status, APPROVED);

  const guardada = db.documents.get(`${COLLECTION}/req-1`);

  assert.equal(guardada.status, APPROVED);
  assert.equal(guardada.resolvedByUid, "jefa");
  assert.equal(guardada.resolvedByName, "Jefa de la otra unidad");
  // Y se exige permiso de gestion en la unidad que responde.
  assert.deepEqual(calls.manager, [{ workspaceId: "w-otra", uid: "jefa" }]);
});

test("rechazar guarda el motivo; aprobar lo deja vacio", async () => {
  const rechazo = conPendiente();

  await respondInterUnitAbsenceRequestHandler(
    peticion({
      workspaceId: "w-otra",
      requestId: "req-1",
      status: REJECTED,
      rejectReason: "La necesito para mi propia gente"
    }, "jefa"),
    dependencies(rechazo).deps
  );

  assert.equal(
    rechazo.documents.get(`${COLLECTION}/req-1`).rejectReason,
    "La necesito para mi propia gente"
  );

  const aprobacion = conPendiente();

  await respondInterUnitAbsenceRequestHandler(
    peticion({
      workspaceId: "w-otra",
      requestId: "req-1",
      status: APPROVED,
      rejectReason: "sobra"
    }, "jefa"),
    dependencies(aprobacion).deps
  );

  assert.equal(aprobacion.documents.get(`${COLLECTION}/req-1`).rejectReason, "");
});

test("no se responde dos veces", async () => {
  const db = new FakeDb({
    [`${COLLECTION}/req-1`]: {
      requesterWorkspaceId: "w-mia",
      ownerWorkspaceId: "w-otra",
      status: APPROVED
    }
  });
  const { deps } = dependencies(db);

  await falla(
    respondInterUnitAbsenceRequestHandler(
      peticion({
        workspaceId: "w-otra",
        requestId: "req-1",
        status: REJECTED
      }),
      deps
    ),
    "failed-precondition"
  );
});

test("solo se aceptan aprobar y rechazar", async () => {
  const { deps } = dependencies(conPendiente());

  await falla(
    respondInterUnitAbsenceRequestHandler(
      peticion({
        workspaceId: "w-otra",
        requestId: "req-1",
        status: "cancelada"
      }),
      deps
    ),
    "invalid-argument"
  );
});

test("una solicitud que ya no existe se dice claramente", async () => {
  const { deps } = dependencies(new FakeDb());

  await falla(
    respondInterUnitAbsenceRequestHandler(
      peticion({
        workspaceId: "w-otra",
        requestId: "fantasma",
        status: APPROVED
      }),
      deps
    ),
    "not-found"
  );
});
