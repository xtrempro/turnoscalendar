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
  claimWorkerTransferIntakeHandler,
  confirmWorkerTransferIntakeHandler,
  renameMovedWorkerLink,
  releaseWorkerTransferIntakeHandler,
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

  set(value, options) {
    this.db.documents.set(
      this.path,
      options && options.merge
        ? { ...(this.db.documents.get(this.path) || {}), ...value }
        : value
    );
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
      set: (ref, value, options) => ops.push(() => ref.set(value, options)),
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
      claimTokenFactory: () => "tok-1",
      // El perfil que la unidad de destino tiene para ese RUT: con el se
      // comprueba el nombre que informa al confirmar.
      findWorkerProfile: async () => ({ name: "Ana Rojas Campos", rut: "17816632-8" }),
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

// Un traspaso que la otra unidad pidio: nace aceptado y la unidad que recibe
// crea el perfil sola. El claim evita que dos sesiones creen dos perfiles.
function traspaso(extra = {}) {
  return pendiente({
    status: ACCEPTED,
    handoverRequestId: "whr-1",
    // El perfil viaja con la transferencia, y su RUT es con lo que se
    // comprueba el nombre que informa la unidad que recibe.
    profile: { name: "Ana Perez", rut: "17.816.632-8" },
    ...extra
  });
}

test("crear el perfil del traspaso se reclama UNA vez", async () => {
  const db = new FakeDb({ [`${COLLECTION}/t-1`]: traspaso() });
  const { deps } = dependencies(db);
  const pedir = () => claimWorkerTransferIntakeHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1" }),
    deps
  );

  assert.equal((await pedir()).claimed, true);
  assert.equal((await pedir()).claimed, false);
  // Queda RESERVADO, no aplicado: lo aplicado lo marca el confirm, despues de
  // que el perfil esta guardado.
  assert.equal(db.documents.get(`${COLLECTION}/t-1`).targetIntakeClaimedAt, "AHORA");
  assert.equal(db.documents.get(`${COLLECTION}/t-1`).targetIntakeAppliedAt, undefined);
});

test("una transferencia normal no se aplica sola", async () => {
  // Solo las que nacieron de un pedido de traspaso: una transferencia que esta
  // unidad no pidio tiene que aceptarla una persona.
  const db = new FakeDb({ [`${COLLECTION}/t-1`]: pendiente({ status: ACCEPTED }) });
  const { deps } = dependencies(db);

  assert.equal(
    (await claimWorkerTransferIntakeHandler(
      peticion({ workspaceId: "w-destino", requestId: "t-1" }),
      deps
    )).claimed,
    false
  );
});

test("si crear el perfil falla, el traspaso vuelve a la cola", async () => {
  // Sin soltarlo, el claim lo consumiria para siempre: la persona se quedaria
  // sin perfil y ninguna sesion volveria a intentarlo.
  const db = new FakeDb({ [`${COLLECTION}/t-1`]: traspaso() });
  const { deps } = dependencies(db);
  const tomar = () => claimWorkerTransferIntakeHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1" }),
    deps
  );

  const { claimToken } = await tomar();

  assert.equal(Boolean(claimToken), true);

  const soltado = await releaseWorkerTransferIntakeHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1", claimToken }),
    deps
  );

  assert.equal(soltado.released, true);
  // Y queda disponible para el proximo intento.
  assert.equal((await tomar()).claimed, true);
});

test("solo lo suelta la sesion que lo tomo", async () => {
  // Si cualquiera pudiera soltarlo, una sesion devolveria a la cola un
  // traspaso que otra esta aplicando, y terminarian creando dos perfiles.
  const db = new FakeDb({ [`${COLLECTION}/t-1`]: traspaso() });
  const { deps } = dependencies(db);

  await claimWorkerTransferIntakeHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1" }),
    deps
  );

  const ajena = await releaseWorkerTransferIntakeHandler(
    { ...peticion({ workspaceId: "w-destino", requestId: "t-1" }), auth: { uid: "otra-sesion", token: {} } },
    deps
  );

  assert.equal(ajena.released, false);
  assert.equal(db.documents.get(`${COLLECTION}/t-1`).targetIntakeClaimedAt, "AHORA");
});

test("la unidad de origen no suelta el traspaso de la otra", async () => {
  const db = new FakeDb({ [`${COLLECTION}/t-1`]: traspaso() });
  const { deps } = dependencies(db);

  await falla(
    releaseWorkerTransferIntakeHandler(
      peticion({ workspaceId: "w-origen", requestId: "t-1" }),
      deps
    ),
    "permission-denied"
  );
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

// --- Traspaso entre unidades del mismo establecimiento ---
//
// Dos caminos llegan al mismo codigo: la unidad que transfiere a alguien y la
// que pide a alguien de otra. Lo unico que se bifurca es quien puede pedirlo.

test("sin enlace, autoriza compartir establecimiento", async () => {
  const db = new FakeDb();
  const establecimientos = [];
  const { deps, calls } = dependencies(db, {
    requireSameEstablishment: async (origen, destino) => {
      establecimientos.push({ origen, destino });
    }
  });
  const { linkId, ...sinEnlace } = DATOS;
  const result = await createWorkerTransferRequestHandler(peticion(sinEnlace), deps);

  assert.equal(result.status, PENDING);
  assert.deepEqual(establecimientos, [{ origen: "w-origen", destino: "w-destino" }]);
  // Y no se pide enlace, que es justo lo que estas unidades no tienen.
  assert.deepEqual(calls.link, []);
});

test("con enlace, sigue mandando el enlace", async () => {
  // El camino de siempre no cambia: no se consulta el establecimiento.
  const db = new FakeDb();
  const establecimientos = [];
  const { deps, calls } = dependencies(db, {
    requireSameEstablishment: async (origen, destino) => {
      establecimientos.push({ origen, destino });
    }
  });

  await createWorkerTransferRequestHandler(peticion(DATOS), deps);

  assert.deepEqual(calls.link, [{ linkId: "l-1", target: "w-destino", source: "w-origen" }]);
  assert.deepEqual(establecimientos, []);
});

test("sin enlace y sin establecimiento comun, no se transfiere", async () => {
  const db = new FakeDb();
  const { deps } = dependencies(db, {
    requireSameEstablishment: async () => {
      throw new HttpsError(
        "failed-precondition",
        "Las unidades no estan enlazadas ni son del mismo establecimiento."
      );
    }
  });
  const { linkId, ...sinEnlace } = DATOS;

  await assert.rejects(
    () => createWorkerTransferRequestHandler(peticion(sinEnlace), deps),
    (error) => error.code === "failed-precondition"
  );

  assert.equal(db.documents.get(`${COLLECTION}/t-1`), undefined);
});

// --- La reserva vence (auditoria 2026-10-14) ---
//
// La toma se marcaba como aplicada ANTES de crear el perfil. Si esa sesion no
// llegaba a crearlo -se cierra la pestaña, se cae la red, el navegador se queda
// sin memoria-, el traspaso quedaba consumido para siempre y la persona sin
// perfil. El `release` solo cubria el fallo con excepcion, que es el caso
// amable.

test("confirmar despues de guardar es lo que lo deja aplicado", async () => {
  const db = new FakeDb({ [`${COLLECTION}/t-1`]: traspaso() });
  const { deps } = dependencies(db);
  const quien = peticion({ workspaceId: "w-destino", requestId: "t-1" });

  const { claimToken } = await claimWorkerTransferIntakeHandler(quien, deps);

  const confirmado = await confirmWorkerTransferIntakeHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1", claimToken }),
    deps
  );
  const doc = db.documents.get(`${COLLECTION}/t-1`);

  assert.equal(confirmado.confirmed, true);
  assert.equal(doc.targetIntakeAppliedAt, "AHORA");
  // Y la reserva se suelta: ya no hace falta.
  assert.equal(doc.targetIntakeClaimedByUid, null);
});

test("una reserva abandonada se recupera sola pasado el plazo", async () => {
  // Es el caso que no tenia arreglo: nadie llama al release porque esa sesion
  // ya no existe.
  const vieja = traspaso({
    targetIntakeClaimedAt: "ANTES",
    targetIntakeClaimedAtMs: Date.now() - 11 * 60 * 1000,
    targetIntakeClaimedByUid: "sesion-que-se-fue"
  });
  const db = new FakeDb({ [`${COLLECTION}/t-1`]: vieja });
  const { deps } = dependencies(db);

  const tomado = await claimWorkerTransferIntakeHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1" }),
    deps
  );

  assert.equal(tomado.claimed, true);
});

test("una reserva reciente no se le quita a quien la tiene", async () => {
  // Si venciera al tiro, dos sesiones crearian dos perfiles de la misma
  // persona, que es justo lo que el claim existe para evitar.
  const fresca = traspaso({
    targetIntakeClaimedAt: "AHORA",
    targetIntakeClaimedAtMs: Date.now() - 60 * 1000,
    targetIntakeClaimedByUid: "otra-sesion"
  });
  const db = new FakeDb({ [`${COLLECTION}/t-1`]: fresca });
  const { deps } = dependencies(db);

  const tomado = await claimWorkerTransferIntakeHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1" }),
    deps
  );

  assert.equal(tomado.claimed, false);
});

test("lo ya aplicado no se vuelve a tomar aunque pase el tiempo", async () => {
  const aplicado = traspaso({
    targetIntakeAppliedAt: "ANTES",
    targetIntakeClaimedAtMs: Date.now() - 11 * 60 * 1000
  });
  const db = new FakeDb({ [`${COLLECTION}/t-1`]: aplicado });
  const { deps } = dependencies(db);

  assert.equal(
    (await claimWorkerTransferIntakeHandler(
      peticion({ workspaceId: "w-destino", requestId: "t-1" }),
      deps
    )).claimed,
    false
  );
});

test("solo confirma quien tiene la reserva", async () => {
  // Si su reserva vencio y otra sesion la tomo, confirma esa otra: es la que
  // esta creando el perfil ahora.
  const db = new FakeDb({ [`${COLLECTION}/t-1`]: traspaso() });
  const { deps } = dependencies(db);

  await claimWorkerTransferIntakeHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1" }),
    deps
  );

  const ajena = await confirmWorkerTransferIntakeHandler(
    {
      ...peticion({ workspaceId: "w-destino", requestId: "t-1" }),
      auth: { uid: "otra-sesion", token: {} }
    },
    deps
  );

  assert.equal(ajena.confirmed, false);
  assert.equal(
    db.documents.get(`${COLLECTION}/t-1`).targetIntakeAppliedAt,
    undefined
  );
});

test("un traspaso ya confirmado no se devuelve a la cola", async () => {
  // Devolverlo crearia un segundo perfil de alguien que ya lo tiene.
  const db = new FakeDb({ [`${COLLECTION}/t-1`]: traspaso() });
  const { deps } = dependencies(db);
  const quien = peticion({ workspaceId: "w-destino", requestId: "t-1" });

  const { claimToken } = await claimWorkerTransferIntakeHandler(quien, deps);
  const conTestigo = peticion({
    workspaceId: "w-destino",
    requestId: "t-1",
    claimToken
  });

  await confirmWorkerTransferIntakeHandler(conTestigo, deps);

  const soltado = await releaseWorkerTransferIntakeHandler(conTestigo, deps);

  assert.equal(soltado.released, false);
  assert.equal(
    db.documents.get(`${COLLECTION}/t-1`).targetIntakeAppliedAt,
    "AHORA"
  );
});

test("la pestaña cuya reserva vencio no confirma la de la otra", async () => {
  // Las dos son del mismo supervisor, asi que comparten uid: con el uid solo,
  // la primera daba por creado un perfil que la segunda todavia esta creando.
  const tokens = ["tok-1", "tok-2"];
  const db = new FakeDb({ [`${COLLECTION}/t-1`]: traspaso() });
  const { deps } = dependencies(db, { claimTokenFactory: () => tokens.shift() });
  const pedir = () => claimWorkerTransferIntakeHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1" }),
    deps
  );

  const primera = await pedir();

  // Se le vence: el documento queda como si la hubiera tomado hace rato.
  db.documents.get(`${COLLECTION}/t-1`).targetIntakeClaimedAtMs =
    Date.now() - 11 * 60 * 1000;

  const segunda = await pedir();

  assert.equal(segunda.claimed, true);
  assert.notEqual(primera.claimToken, segunda.claimToken);

  const tarde = await confirmWorkerTransferIntakeHandler(
    peticion({
      workspaceId: "w-destino",
      requestId: "t-1",
      claimToken: primera.claimToken
    }),
    deps
  );

  assert.equal(tarde.confirmed, false);
  assert.equal(
    db.documents.get(`${COLLECTION}/t-1`).targetIntakeAppliedAt,
    undefined
  );
});

test("ni suelta la reserva que esta usando la otra", async () => {
  // Soltarla la devolveria a la cola mientras esa pestaña crea el perfil, y
  // terminarian creando dos.
  const tokens = ["tok-1", "tok-2"];
  const db = new FakeDb({ [`${COLLECTION}/t-1`]: traspaso() });
  const { deps } = dependencies(db, { claimTokenFactory: () => tokens.shift() });
  const pedir = () => claimWorkerTransferIntakeHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1" }),
    deps
  );

  const primera = await pedir();

  db.documents.get(`${COLLECTION}/t-1`).targetIntakeClaimedAtMs =
    Date.now() - 11 * 60 * 1000;

  await pedir();

  const soltado = await releaseWorkerTransferIntakeHandler(
    peticion({
      workspaceId: "w-destino",
      requestId: "t-1",
      claimToken: primera.claimToken
    }),
    deps
  );

  assert.equal(soltado.released, false);
  assert.equal(
    db.documents.get(`${COLLECTION}/t-1`).targetIntakeClaimToken,
    "tok-2"
  );
});

test("sin testigo no se confirma ni se suelta nada", async () => {
  const db = new FakeDb({ [`${COLLECTION}/t-1`]: traspaso() });
  const { deps } = dependencies(db);
  const quien = peticion({ workspaceId: "w-destino", requestId: "t-1" });

  await claimWorkerTransferIntakeHandler(quien, deps);

  assert.equal(
    (await confirmWorkerTransferIntakeHandler(quien, deps)).confirmed,
    false
  );
  assert.equal(
    (await releaseWorkerTransferIntakeHandler(quien, deps)).released,
    false
  );
});

// --- El nombre con que quedo en destino (auditoria 2026-10-14) ---
//
// A la persona se la reconoce por su RUT, asi que en destino puede existir con
// el nombre escrito de otra forma. El enlace de su aplicacion se muda por
// NOMBRE: sin corregirlo, apunta a un perfil que no existe y el trabajador deja
// de ver sus turnos.

test("confirmar guarda el nombre que de verdad tiene en destino", async () => {
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: traspaso({ targetProfileName: "ANA ROJAS" })
  });
  const { deps } = dependencies(db);
  const { claimToken } = await claimWorkerTransferIntakeHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1" }),
    deps
  );

  const resultado = await confirmWorkerTransferIntakeHandler(
    peticion({
      workspaceId: "w-destino",
      requestId: "t-1",
      claimToken,
      profileName: "Ana Rojas Campos"
    }),
    deps
  );

  assert.equal(resultado.renamed, true);
  assert.equal(
    db.documents.get(`${COLLECTION}/t-1`).targetProfileName,
    "Ana Rojas Campos"
  );
});

test("si el enlace ya se habia mudado, se corrige su nombre", async () => {
  // Transferencia que empezaba hoy: el enlace se mudo al aceptar, con el
  // nombre de origen.
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: traspaso({
      targetProfileName: "ANA ROJAS",
      linkMovedAt: "ANTES"
    }),
    "workspaces/w-destino/workerLinks/uid-ana": {
      uid: "uid-ana",
      profileName: "ANA ROJAS",
      status: "active"
    },
    "users/uid-ana/workerLinks/w-destino": {
      uid: "uid-ana",
      profileName: "ANA ROJAS",
      status: "active"
    }
  });
  const { deps } = dependencies(db);
  const { claimToken } = await claimWorkerTransferIntakeHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1" }),
    deps
  );

  await confirmWorkerTransferIntakeHandler(
    peticion({
      workspaceId: "w-destino",
      requestId: "t-1",
      claimToken,
      profileName: "Ana Rojas Campos"
    }),
    deps
  );

  assert.equal(
    db.documents.get("workspaces/w-destino/workerLinks/uid-ana").profileName,
    "Ana Rojas Campos"
  );
  assert.equal(
    db.documents.get("users/uid-ana/workerLinks/w-destino").profileName,
    "Ana Rojas Campos"
  );
  // Y no se toca nada mas del enlace.
  assert.equal(
    db.documents.get("workspaces/w-destino/workerLinks/uid-ana").uid,
    "uid-ana"
  );
});

test("con el mismo nombre no se renombra nada", async () => {
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: traspaso({ targetProfileName: "ANA ROJAS" })
  });
  // Alla se llama igual que en la transferencia.
  const { deps } = dependencies(db, {
    findWorkerProfile: async () => ({ name: "ANA ROJAS", rut: "17816632-8" })
  });
  const { claimToken } = await claimWorkerTransferIntakeHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1" }),
    deps
  );

  const resultado = await confirmWorkerTransferIntakeHandler(
    peticion({
      workspaceId: "w-destino",
      requestId: "t-1",
      claimToken,
      profileName: "ANA ROJAS"
    }),
    deps
  );

  assert.equal(resultado.renamed, false);
});

test("renombrar un enlace que no esta activo no hace nada", async () => {
  const db = new FakeDb({
    "workspaces/w-destino/workerLinks/uid-ana": {
      uid: "uid-ana",
      profileName: "ANA ROJAS",
      status: "unlinked"
    }
  });

  const resultado = await renameMovedWorkerLink(db, {
    targetWorkspaceId: "w-destino",
    previousProfileName: "ANA ROJAS",
    profileName: "Ana Rojas Campos"
  }, () => "AHORA");

  assert.equal(resultado.renamed, false);
  assert.equal(
    db.documents.get("workspaces/w-destino/workerLinks/uid-ana").profileName,
    "ANA ROJAS"
  );
});

test("un nombre que no es el de esa persona se rechaza", async () => {
  // El testigo acredita la reserva, no la identidad: con un nombre cualquiera,
  // el enlace de su aplicacion terminaria apuntando a otro perfil.
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: traspaso({ targetProfileName: "ANA ROJAS" })
  });
  const { deps } = dependencies(db, {
    findWorkerProfile: async () => ({ name: "Ana Rojas Campos", rut: "17816632-8" })
  });
  const { claimToken } = await claimWorkerTransferIntakeHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1" }),
    deps
  );

  await falla(
    confirmWorkerTransferIntakeHandler(
      peticion({
        workspaceId: "w-destino",
        requestId: "t-1",
        claimToken,
        profileName: "Otro Trabajador"
      }),
      deps
    ),
    "failed-precondition"
  );

  assert.equal(
    db.documents.get(`${COLLECTION}/t-1`).targetProfileName,
    "ANA ROJAS"
  );
});

test("si el renombrado del enlace falla, queda anotado para reintentarlo", async () => {
  // Antes se daba por confirmado y nadie volvia a mirarlo: el enlace se
  // quedaba apuntando a un perfil que no existe.
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: traspaso({
      targetProfileName: "ANA ROJAS",
      linkMovedAt: "ANTES"
    })
  });
  const { deps } = dependencies(db);
  const { claimToken } = await claimWorkerTransferIntakeHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1" }),
    deps
  );
  // No hay enlace activo que renombrar: el renombrado no se completa.
  const resultado = await confirmWorkerTransferIntakeHandler(
    peticion({
      workspaceId: "w-destino",
      requestId: "t-1",
      claimToken,
      profileName: "Ana Rojas Campos"
    }),
    deps
  );
  const doc = db.documents.get(`${COLLECTION}/t-1`);

  assert.equal(resultado.confirmed, true);
  assert.equal(resultado.linkRenamePending, true);
  assert.equal(doc.linkRenamePendingFrom, "ANA ROJAS");
  assert.equal(doc.linkRenamePendingTo, "Ana Rojas Campos");
});

test("la tarea diaria retoma el renombrado pendiente", async () => {
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: traspaso({
      targetProfileName: "Ana Rojas Campos",
      linkMovedAt: "ANTES",
      linkRenamePendingFrom: "ANA ROJAS",
      linkRenamePendingTo: "Ana Rojas Campos"
    }),
    "workspaces/w-destino/workerLinks/uid-ana": {
      uid: "uid-ana",
      profileName: "ANA ROJAS",
      status: "active"
    },
    "users/uid-ana/workerLinks/w-destino": {
      uid: "uid-ana",
      profileName: "ANA ROJAS",
      status: "active"
    }
  });
  const { deps } = dependencies(db);

  await moveDueWorkerLinksHandler({ ...deps, today: "2026-10-05" });

  assert.equal(
    db.documents.get("workspaces/w-destino/workerLinks/uid-ana").profileName,
    "Ana Rojas Campos"
  );
  // Y se borra la anotacion: ya no hay nada que reparar.
  assert.equal(
    db.documents.get(`${COLLECTION}/t-1`).linkRenamePendingTo,
    null
  );
});

// --- La reparacion no se fia de lo anotado (auditoria 2026-10-15) ---

test("la reparacion escribe el nombre del PERFIL, no el anotado", async () => {
  // Lo anotado lo mando un cliente y nunca se pudo comprobar: escribirlo a
  // ciegas en el enlace dejaria al trabajador viendo los turnos de otro.
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: traspaso({
      targetProfileName: "ANA ROJAS",
      linkMovedAt: "ANTES",
      linkRenamePendingFrom: "ANA ROJAS",
      linkRenamePendingTo: "Otro Trabajador"
    }),
    "workspaces/w-destino/workerLinks/uid-ana": {
      uid: "uid-ana",
      profileName: "ANA ROJAS",
      status: "active"
    },
    "users/uid-ana/workerLinks/w-destino": {
      uid: "uid-ana",
      profileName: "ANA ROJAS",
      status: "active"
    }
  });
  const { deps } = dependencies(db);

  await moveDueWorkerLinksHandler({ ...deps, today: "2026-10-05" });

  const enlace = db.documents.get("workspaces/w-destino/workerLinks/uid-ana");

  assert.equal(enlace.profileName, "Ana Rojas Campos");
  assert.equal(
    db.documents.get(`${COLLECTION}/t-1`).targetProfileName,
    "Ana Rojas Campos"
  );
});

test("mientras el perfil no aparezca, la reparacion espera", async () => {
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: traspaso({
      targetProfileName: "ANA ROJAS",
      linkMovedAt: "ANTES",
      linkRenamePendingFrom: "ANA ROJAS",
      linkRenamePendingTo: "Ana Rojas Campos"
    }),
    "workspaces/w-destino/workerLinks/uid-ana": {
      uid: "uid-ana",
      profileName: "ANA ROJAS",
      status: "active"
    }
  });
  const { deps } = dependencies(db, { findWorkerProfile: async () => null });

  await moveDueWorkerLinksHandler({ ...deps, today: "2026-10-05" });

  assert.equal(
    db.documents.get("workspaces/w-destino/workerLinks/uid-ana").profileName,
    "ANA ROJAS"
  );
  // Y sigue anotado para manana.
  assert.equal(
    db.documents.get(`${COLLECTION}/t-1`).linkRenamePendingTo,
    "Ana Rojas Campos"
  );
});

test("un traslado futuro con el nombre sin verificar queda anotado", async () => {
  // El enlace se muda el dia de inicio: sin anotarlo, esa mudanza usaria el
  // nombre de origen y nadie lo habria revisado.
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: traspaso({
      targetProfileName: "ANA ROJAS",
      startDate: "2026-12-01"
    })
  });
  const { deps } = dependencies(db, { findWorkerProfile: async () => null });
  const { claimToken } = await claimWorkerTransferIntakeHandler(
    peticion({ workspaceId: "w-destino", requestId: "t-1" }),
    deps
  );
  const resultado = await confirmWorkerTransferIntakeHandler(
    peticion({
      workspaceId: "w-destino",
      requestId: "t-1",
      claimToken,
      profileName: "Ana Rojas Campos"
    }),
    deps
  );
  const doc = db.documents.get(`${COLLECTION}/t-1`);

  assert.equal(resultado.confirmed, true);
  assert.equal(resultado.renamed, false, "no se verifico, no se guardo");
  assert.equal(resultado.linkRenamePending, true);
  assert.equal(doc.linkRenamePendingTo, "Ana Rojas Campos");
  assert.equal(doc.targetProfileName, "ANA ROJAS", "sigue el de origen");
});

test("y la tarea diaria lo deja listo antes de que llegue la fecha", async () => {
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: traspaso({
      targetProfileName: "ANA ROJAS",
      startDate: "2026-12-01",
      linkRenamePendingFrom: "ANA ROJAS",
      linkRenamePendingTo: "Ana Rojas Campos"
    })
  });
  const { deps } = dependencies(db);

  await moveDueWorkerLinksHandler({ ...deps, today: "2026-10-05" });

  const doc = db.documents.get(`${COLLECTION}/t-1`);

  // El enlace todavia no se mueve -falta para la fecha-, pero el nombre con
  // que se movera ya quedo bien.
  assert.equal(doc.targetProfileName, "Ana Rojas Campos");
  assert.equal(doc.linkRenamePendingTo, null);
  assert.equal(doc.linkMovedAt, undefined);
});

// --- La mudanza del dia usa el nombre resuelto (auditoria 2026-10-15) ---

test("al llegar la fecha, el enlace se muda con el nombre resuelto", async () => {
  // El bucle seguia con la copia que leyo al empezar: resolvia el nombre en el
  // documento y mudaba el enlace con el de origen, que es justo el error que
  // esta reparacion viene a evitar.
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: traspaso({
      targetProfileName: "ANA ROJAS",
      startDate: "2026-10-01",
      linkRenamePendingFrom: "ANA ROJAS",
      linkRenamePendingTo: "Ana Rojas Campos"
    }),
    "workspaces/w-origen/workerLinks/uid-ana": {
      uid: "uid-ana",
      profileName: "Ana Perez",
      status: "active"
    }
  });
  const { deps } = dependencies(db);

  await moveDueWorkerLinksHandler({ ...deps, today: "2026-10-05" });

  const enlace = db.documents.get("workspaces/w-destino/workerLinks/uid-ana");

  assert.equal(enlace.profileName, "Ana Rojas Campos");
  assert.equal(
    db.documents.get("users/uid-ana/workerLinks/w-destino").profileName,
    "Ana Rojas Campos"
  );
});

test("sin saber el nombre de destino, el enlace NO se muda", async () => {
  // Mudarlo con el de origen lo deja apuntando a un perfil que no existe, y
  // ademas marca la mudanza como hecha: nadie volveria a mirarla.
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: traspaso({
      targetProfileName: "ANA ROJAS",
      startDate: "2026-10-01",
      linkRenamePendingFrom: "ANA ROJAS",
      linkRenamePendingTo: "Ana Rojas Campos"
    }),
    "workspaces/w-origen/workerLinks/uid-ana": {
      uid: "uid-ana",
      profileName: "Ana Perez",
      status: "active"
    }
  });
  const { deps } = dependencies(db, { findWorkerProfile: async () => null });

  await moveDueWorkerLinksHandler({ ...deps, today: "2026-10-05" });

  const doc = db.documents.get(`${COLLECTION}/t-1`);

  assert.equal(
    db.documents.get("workspaces/w-destino/workerLinks/uid-ana"),
    undefined,
    "no se creo el enlace en destino"
  );
  // El de origen sigue en pie y la mudanza no se da por hecha.
  assert.equal(
    db.documents.get("workspaces/w-origen/workerLinks/uid-ana").profileName,
    "Ana Perez"
  );
  assert.equal(doc.linkMovedAt, undefined);
  assert.equal(doc.linkRenamePendingTo, "Ana Rojas Campos", "sigue pendiente");
});

test("una transferencia sin nombre pendiente se muda como siempre", async () => {
  const db = new FakeDb({
    [`${COLLECTION}/t-1`]: traspaso({ startDate: "2026-10-01" }),
    "workspaces/w-origen/workerLinks/uid-ana": {
      uid: "uid-ana",
      profileName: "Ana Perez",
      status: "active"
    }
  });
  const { deps } = dependencies(db);

  const resultado = await moveDueWorkerLinksHandler({
    ...deps,
    today: "2026-10-05"
  });

  assert.equal(resultado.moved, 1);
  assert.equal(
    db.documents.get("workspaces/w-destino/workerLinks/uid-ana").profileName,
    "Ana Perez"
  );
});
