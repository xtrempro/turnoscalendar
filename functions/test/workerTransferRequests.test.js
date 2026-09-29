"use strict";

// Transferir a un trabajador a otra unidad enlazada.
//
// Lo que fija este archivo: crear deja la solicitud PENDIENTE y solo con los
// datos del perfil que hacen falta; solo la unidad DESTINO acepta o rechaza, y
// aceptar exige el perfil creado; solo el ORIGEN retira; y aplicarla en origen
// se reclama una sola vez aunque haya dos sesiones abiertas.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ACCEPTED,
  CANCELED,
  COLLECTION,
  PENDING,
  REJECTED,
  cancelWorkerTransferRequestHandler,
  claimWorkerTransferApplicationHandler,
  createWorkerTransferRequestHandler,
  respondWorkerTransferRequestHandler
} = require("../workerTransferRequests.js");

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

    return Promise.resolve({ exists: data !== undefined, data: () => data });
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

  delete() {
    this.db.documents.delete(this.path);
    return Promise.resolve();
  }

  collection(name) {
    return new FakeCol(this.db, `${this.path}/${name}`);
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

  add(value) {
    this.db.added = (this.db.added || 0) + 1;
    const ref = new FakeDoc(this.db, `${this.path}/auto-${this.db.added}`);

    return ref.set(value).then(() => ref);
  }

  where(field, op, value) {
    return new FakeCol(this.db, this.path, [...this.filters, { field, value }]);
  }

  get() {
    const depth = this.path.split("/").length + 1;
    const docs = [...this.db.documents.entries()]
      .filter(([path]) =>
        path.startsWith(`${this.path}/`) && path.split("/").length === depth
      )
      .map(([path, data]) => ({
        id: path.split("/").pop(),
        ref: new FakeDoc(this.db, path),
        data: () => data
      }))
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

  batch() {
    const ops = [];

    return {
      set: (ref, value) => ops.push(() => ref.set(value)),
      delete: ref => ops.push(() => ref.delete()),
      commit: async () => {
        for (const op of ops) await op();
      }
    };
  }

  // Transaccion en serie: suficiente para probar que la segunda ve lo que
  // escribio la primera.
  async runTransaction(work) {
    const pending = [];
    const result = await work({
      get: ref => ref.get(),
      update: (ref, value) => pending.push(() => ref.update(value))
    });

    for (const apply of pending) await apply();
    return result;
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
      idFactory: () => "t-1",
      today: "2026-09-29",
      requireWorkspaceProfileManager: async (workspaceId, uid) => {
        calls.manager.push({ workspaceId, uid });
      },
      requireAcceptedWorkspaceLink: async (linkId, target, source) => {
        calls.link.push({ linkId, target, source });
      },
      ...overrides
    }
  };
}

const DATOS = {
  workspaceId: "w-origen",
  workspaceName: "Imagenologia",
  targetWorkspaceId: "w-destino",
  targetWorkspaceName: "UCI",
  linkId: "l-1",
  startDate: "2026-10-01",
  profile: {
    name: "Ana Perez",
    rut: "11.111.111-1",
    email: "ana@correo.cl",
    estamento: "Profesional",
    grade: "15",
    // Lo que no esta en la lista blanca no viaja.
    docs: ["contrato.pdf"],
    secreto: "no"
  }
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

function pendiente(extra = {}) {
  return {
    sourceWorkspaceId: "w-origen",
    targetWorkspaceId: "w-destino",
    profileName: "Ana Perez",
    startDate: "2026-10-01",
    status: PENDING,
    ...extra
  };
}

test("crear deja la transferencia PENDIENTE con solo los datos del perfil", async () => {
  const db = new FakeDb();
  const { deps, calls } = dependencies(db);
  const result = await createWorkerTransferRequestHandler(peticion(DATOS), deps);

  assert.equal(result.status, PENDING);

  const guardada = db.documents.get(`${COLLECTION}/t-1`);

  assert.equal(guardada.sourceWorkspaceId, "w-origen");
  assert.equal(guardada.targetWorkspaceId, "w-destino");
  assert.equal(guardada.profileName, "Ana Perez");
  assert.equal(guardada.startDate, "2026-10-01");
  assert.equal(guardada.profile.rut, "11.111.111-1");
  assert.equal(guardada.profile.docs, undefined);
  assert.equal(guardada.profile.secreto, undefined);
  assert.deepEqual(calls.manager, [{ workspaceId: "w-origen", uid: "supervisor" }]);
  assert.deepEqual(calls.link, [{ linkId: "l-1", target: "w-destino", source: "w-origen" }]);
});

test("no se transfiere a la propia unidad ni sin fecha valida", async () => {
  const { deps } = dependencies(new FakeDb());

  await falla(
    createWorkerTransferRequestHandler(
      peticion({ ...DATOS, targetWorkspaceId: "w-origen" }),
      deps
    ),
    "invalid-argument"
  );
  await falla(
    createWorkerTransferRequestHandler(
      peticion({ ...DATOS, startDate: "01/10/2026" }),
      deps
    ),
    "invalid-argument"
  );
});

test("un trabajador no tiene dos transferencias pendientes a la vez", async () => {
  const db = new FakeDb({ [`${COLLECTION}/previa`]: pendiente() });
  const { deps } = dependencies(db);

  await falla(
    createWorkerTransferRequestHandler(peticion(DATOS), deps),
    "failed-precondition"
  );
});

test("solo la unidad DESTINO acepta, y aceptar exige el perfil creado", async () => {
  const db = new FakeDb({ [`${COLLECTION}/t-1`]: pendiente() });
  const { deps } = dependencies(db);

  await falla(
    respondWorkerTransferRequestHandler(
      peticion({ workspaceId: "w-origen", requestId: "t-1", status: ACCEPTED, targetProfileName: "Ana Perez" }),
      deps
    ),
    "permission-denied"
  );
  await falla(
    respondWorkerTransferRequestHandler(
      peticion({ workspaceId: "w-destino", requestId: "t-1", status: ACCEPTED }),
      deps
    ),
    "invalid-argument"
  );

  await respondWorkerTransferRequestHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1", status: ACCEPTED, targetProfileName: "Ana Perez" }),
    deps
  );

  const guardada = db.documents.get(`${COLLECTION}/t-1`);

  assert.equal(guardada.status, ACCEPTED);
  assert.equal(guardada.targetProfileName, "Ana Perez");
});

test("una transferencia respondida no se vuelve a responder", async () => {
  const db = new FakeDb({ [`${COLLECTION}/t-1`]: pendiente({ status: REJECTED }) });
  const { deps } = dependencies(db);

  await falla(
    respondWorkerTransferRequestHandler(
      peticion({ workspaceId: "w-destino", requestId: "t-1", status: ACCEPTED, targetProfileName: "Ana" }),
      deps
    ),
    "failed-precondition"
  );
});

test("solo el ORIGEN retira una transferencia pendiente", async () => {
  const db = new FakeDb({ [`${COLLECTION}/t-1`]: pendiente() });
  const { deps } = dependencies(db);

  await falla(
    cancelWorkerTransferRequestHandler(
      peticion({ workspaceId: "w-destino", requestId: "t-1" }),
      deps
    ),
    "permission-denied"
  );

  await cancelWorkerTransferRequestHandler(
    peticion({ workspaceId: "w-origen", requestId: "t-1" }),
    deps
  );

  assert.equal(db.documents.get(`${COLLECTION}/t-1`).status, CANCELED);
});

test("aplicarla en origen se reclama UNA vez aunque haya dos sesiones", async () => {
  const db = new FakeDb({ [`${COLLECTION}/t-1`]: pendiente({ status: ACCEPTED }) });
  const { deps } = dependencies(db);
  const pedir = () => claimWorkerTransferApplicationHandler(
    peticion({ workspaceId: "w-origen", requestId: "t-1" }),
    deps
  );

  assert.equal((await pedir()).claimed, true);
  assert.equal((await pedir()).claimed, false);
  assert.equal(db.documents.get(`${COLLECTION}/t-1`).sourceAppliedAt, "AHORA");
});

test("no se aplica una pendiente, ni desde la unidad destino", async () => {
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: pendiente(),
    [`${COLLECTION}/t-2`]: pendiente({ status: ACCEPTED })
  });
  const { deps } = dependencies(db);

  assert.equal(
    (await claimWorkerTransferApplicationHandler(
      peticion({ workspaceId: "w-origen", requestId: "t-1" }),
      deps
    )).claimed,
    false
  );
  await falla(
    claimWorkerTransferApplicationHandler(
      peticion({ workspaceId: "w-destino", requestId: "t-2" }),
      deps
    ),
    "permission-denied"
  );
});

/* =========================================================
   Saldos y enlace de la app
========================================================= */

const {
  moveDueWorkerLinksHandler
} = require("../workerTransferRequests.js");

const ENLACE = {
  uid: "u-ana",
  workspaceId: "w-origen",
  profileName: "Ana Perez",
  profileRut: "11111111-1",
  workerEmail: "ana@correo.cl",
  status: "active",
  inviteId: "inv-viejo"
};

test("los saldos de vacaciones viajan con la solicitud, saneados", async () => {
  const db = new FakeDb();
  const { deps } = dependencies(db);

  await createWorkerTransferRequestHandler(peticion({
    ...DATOS,
    profile: {
      ...DATOS.profile,
      leaveBalances: { year: 2026, legal: 12, comp: 7, admin: 4.5, hoursReturn: -3 }
    }
  }), deps);

  assert.deepEqual(
    db.documents.get(`${COLLECTION}/t-1`).profile.leaveBalances,
    { year: 2026, legal: 12, comp: 7, admin: 4.5 }
  );
});

test("aceptar con la fecha ya cumplida muda el enlace de la app, mismo uid", async () => {
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: pendiente({ startDate: "2026-09-29", sourceWorkspaceName: "Imagenologia", targetWorkspaceName: "UCI" }),
    "workspaces/w-origen/workerLinks/u-ana": ENLACE,
    "users/u-ana/workerLinks/w-origen": ENLACE
  });
  const { deps } = dependencies(db);

  await respondWorkerTransferRequestHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1", status: ACCEPTED, targetProfileName: "Ana P." }),
    deps
  );

  const destino = db.documents.get("workspaces/w-destino/workerLinks/u-ana");

  assert.equal(destino.status, "active");
  assert.equal(destino.profileName, "Ana P.");
  assert.equal(destino.profileRut, "11111111-1");
  assert.equal(destino.workspaceName, "UCI");
  assert.equal(db.documents.get("users/u-ana/workerLinks/w-destino").workspaceId, "w-destino");
  assert.equal(db.documents.has("workspaces/w-origen/workerLinks/u-ana"), false);
  // En origen queda "transferred", no "unlinked": la app no muestra el aviso
  // de desvinculacion, recarga y pasa a la unidad nueva.
  assert.equal(db.documents.get("users/u-ana/workerLinks/w-origen").status, "transferred");
  assert.equal(db.documents.get(`${COLLECTION}/t-1`).linkMoved, true);
});

test("con fecha futura el enlace se queda en origen hasta ese dia", async () => {
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: pendiente({ startDate: "2026-10-05" }),
    "workspaces/w-origen/workerLinks/u-ana": ENLACE
  });
  const { deps } = dependencies(db);

  await respondWorkerTransferRequestHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1", status: ACCEPTED, targetProfileName: "Ana Perez" }),
    deps
  );

  assert.equal(db.documents.has("workspaces/w-origen/workerLinks/u-ana"), true);
  assert.equal(db.documents.has("workspaces/w-destino/workerLinks/u-ana"), false);
  assert.equal(db.documents.get(`${COLLECTION}/t-1`).linkMovedAt, undefined);

  // La tarea diaria no lo toca antes de la fecha...
  await moveDueWorkerLinksHandler({ ...deps, today: "2026-10-04" });
  assert.equal(db.documents.has("workspaces/w-destino/workerLinks/u-ana"), false);

  // ...y lo muda ese dia, una sola vez.
  const primero = await moveDueWorkerLinksHandler({ ...deps, today: "2026-10-05" });
  const segundo = await moveDueWorkerLinksHandler({ ...deps, today: "2026-10-06" });

  assert.equal(primero.moved, 1);
  assert.equal(segundo.moved, 0);
  assert.equal(db.documents.get("workspaces/w-destino/workerLinks/u-ana").status, "active");
});

test("sin app enlazada, aceptar no inventa ningun enlace", async () => {
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: pendiente({ startDate: "2026-09-01" })
  });
  const { deps } = dependencies(db);

  await respondWorkerTransferRequestHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1", status: ACCEPTED, targetProfileName: "Ana Perez" }),
    deps
  );

  assert.equal(db.documents.get(`${COLLECTION}/t-1`).linkMoved, false);
  assert.equal(
    [...db.documents.keys()].some(path => path.includes("workerLinks")),
    false
  );
});

/* =========================================================
   Saldos reales tras vaciar el calendario en origen
========================================================= */

const {
  claimWorkerTransferBalancesHandler,
  reportWorkerTransferBalancesHandler
} = require("../workerTransferRequests.js");

test("solo el ORIGEN informa los saldos finales, y solo si esta aceptada", async () => {
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: pendiente(),
    [`${COLLECTION}/t-2`]: pendiente({ status: ACCEPTED })
  });
  const { deps } = dependencies(db);
  const saldos = { year: 2026, legal: 15, comp: 10, admin: 6 };

  await falla(
    reportWorkerTransferBalancesHandler(
      peticion({ workspaceId: "w-origen", requestId: "t-1", leaveBalances: saldos }),
      deps
    ),
    "failed-precondition"
  );
  await falla(
    reportWorkerTransferBalancesHandler(
      peticion({ workspaceId: "w-destino", requestId: "t-2", leaveBalances: saldos }),
      deps
    ),
    "permission-denied"
  );

  await reportWorkerTransferBalancesHandler(
    peticion({ workspaceId: "w-origen", requestId: "t-2", leaveBalances: saldos }),
    deps
  );

  assert.deepEqual(db.documents.get(`${COLLECTION}/t-2`).finalLeaveBalances, saldos);
});

test("el ajuste de saldos en destino se reclama UNA vez", async () => {
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: pendiente({
      status: ACCEPTED,
      finalLeaveBalances: { year: 2026, legal: 15 }
    }),
    [`${COLLECTION}/t-2`]: pendiente({ status: ACCEPTED })
  });
  const { deps } = dependencies(db);
  const pedir = (requestId, workspaceId = "w-destino") =>
    claimWorkerTransferBalancesHandler(peticion({ workspaceId, requestId }), deps);

  await falla(pedir("t-1", "w-origen"), "permission-denied");
  assert.equal((await pedir("t-1")).claimed, true);
  assert.equal((await pedir("t-1")).claimed, false);
  // Sin saldos finales todavia no hay nada que ajustar.
  assert.equal((await pedir("t-2")).claimed, false);
});

/* =========================================================
   El perfil de origen queda inactivo desde el servidor
========================================================= */

const PERFILES = "workspaces/w-origen/stateModules/profile/entries/profiles";

function entradaPerfiles(perfiles, extra = {}) {
  return {
    moduleId: "profile",
    storageKey: "profiles",
    value: JSON.stringify(perfiles),
    ...extra
  };
}

test("aceptar deja el perfil de origen inactivo, SOLO en items", async () => {
  const perfiles = [
    { id: "profile_ana", name: "Ana Perez", active: true, rut: "1-9" },
    { id: "profile_bea", name: "Bea Soto", active: true }
  ];
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: pendiente({ startDate: "2026-10-01" }),
    [PERFILES]: entradaPerfiles(perfiles)
  });
  const { deps } = dependencies(db);

  await respondWorkerTransferRequestHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1", status: ACCEPTED, targetProfileName: "Ana Perez" }),
    deps
  );

  const entrada = db.documents.get(PERFILES);

  // `value` intacto: es la lista entera y pisarla es como se perdieron datos.
  assert.equal(entrada.value, JSON.stringify(perfiles));
  assert.deepEqual(JSON.parse(entrada.items.profile_ana), {
    id: "profile_ana",
    name: "Ana Perez",
    active: false,
    rut: "1-9",
    unitExitDate: "2026-09-30"
  });
  assert.equal(entrada.deletedItems.profile_ana, false);
  assert.equal(entrada.container, "array");
  assert.equal(db.documents.get(`${COLLECTION}/t-1`).sourceProfileMarked, true);

  // Y se pide publicar su calendario de origen con la salida ya escrita.
  const pedidos = [...db.documents.entries()]
    .filter(([path]) => path.startsWith("workspaces/w-origen/projectionRequests/"));

  assert.equal(pedidos.length, 1);
  assert.deepEqual(pedidos[0][1].profiles, ["Ana Perez"]);
});

test("respeta lo que ya estaba en items y lee el perfil desde ahi", async () => {
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: pendiente(),
    [PERFILES]: entradaPerfiles(
      [{ id: "profile_ana", name: "Ana Perez", active: true }],
      {
        items: {
          profile_ana: JSON.stringify({ id: "profile_ana", name: "Ana Perez", active: true, grade: "12" }),
          profile_eva: JSON.stringify({ id: "profile_eva", name: "Eva", active: true })
        }
      }
    )
  });
  const { deps } = dependencies(db);

  await respondWorkerTransferRequestHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1", status: ACCEPTED, targetProfileName: "Ana Perez" }),
    deps
  );

  const items = db.documents.get(PERFILES).items;

  assert.equal(JSON.parse(items.profile_ana).grade, "12");
  assert.equal(JSON.parse(items.profile_ana).active, false);
  assert.equal(JSON.parse(items.profile_eva).active, true);
});

test("un perfil guardado SIN id no se toca: se agregaria duplicado", async () => {
  const perfiles = [{ name: "Ana Perez", active: true }];
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: pendiente(),
    [PERFILES]: entradaPerfiles(perfiles)
  });
  const { deps } = dependencies(db);

  await respondWorkerTransferRequestHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1", status: ACCEPTED, targetProfileName: "Ana Perez" }),
    deps
  );

  assert.equal(db.documents.get(PERFILES).items, undefined);

  const solicitud = db.documents.get(`${COLLECTION}/t-1`);

  assert.equal(solicitud.status, ACCEPTED);
  assert.equal(solicitud.sourceProfileMarked, false);
  assert.equal(solicitud.sourceProfileMarkReason, "no_id");
});

test("rechazar no toca el perfil de origen", async () => {
  const perfiles = [{ id: "profile_ana", name: "Ana Perez", active: true }];
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: pendiente(),
    [PERFILES]: entradaPerfiles(perfiles)
  });
  const { deps } = dependencies(db);

  await respondWorkerTransferRequestHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1", status: REJECTED }),
    deps
  );

  assert.equal(db.documents.get(PERFILES).items, undefined);
});
