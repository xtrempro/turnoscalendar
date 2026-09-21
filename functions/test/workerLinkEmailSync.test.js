"use strict";

// El correo del vinculo es por donde entra la recuperacion de identidad. Si se
// queda con el correo viejo cuando el supervisor lo corrige, esa persona pierde
// su red de seguridad sin que nadie se entere.
//
// Lo que se fija aqui: que se sincronice cuando corresponde, que NO se escriba
// cuando no hay nada que cambiar -se dispara en cada guardado de perfiles-, y
// sobre todo que un perfil sin correo no vacie un vinculo bueno.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  syncWorkerLinkEmailsHandler,
  _private: { emailUpdatesForLinks, findProfileForLink }
} = require("../workerLinkEmailSync");

const { profilesFromState } = require("../getAccountsAndUnitsCore");

// Firestore de mentira: registra lo que se escribe y desde donde.
function fakeDb(links) {
  const escrituras = [];
  let comprometido = false;

  const coleccion = (ruta) => ({
    doc: (id) => ({
      collection: (sub) => coleccion(`${ruta}/${id}/${sub}`),
      path: `${ruta}/${id}`
    }),
    async get() {
      return {
        docs: Object.entries(links).map(([uid, data]) => ({
          id: uid,
          data: () => data
        }))
      };
    }
  });

  return {
    escrituras,
    fueComprometido: () => comprometido,
    collection: coleccion,
    batch() {
      return {
        set(ref, value, options) {
          escrituras.push({ path: ref.path, value, options });
        },
        async commit() {
          comprometido = true;
        }
      };
    }
  };
}

function evento(profilesJSON, workspaceId = "ws1") {
  return {
    params: { workspaceId },
    data: {
      before: { data: () => ({ storageKey: "profiles" }) },
      after: {
        data: () => ({ storageKey: "profiles", value: JSON.stringify(profilesJSON) })
      }
    }
  };
}

function deps(db) {
  return {
    db,
    profilesFromState,
    serverTimestamp: () => "AHORA"
  };
}

const PERFILES = [
  { rut: "18.765.432-1", name: "ANA SOTO", email: "ana.nueva@correo.cl" }
];

test("corregir el correo del perfil lo sincroniza al vinculo", async () => {
  const db = fakeDb({
    uid1: { status: "active", profileRut: "187654321", workerEmail: "ana.vieja@correo.cl" }
  });

  const updates = await syncWorkerLinkEmailsHandler(evento(PERFILES), deps(db));

  assert.equal(updates.length, 1);
  assert.equal(updates[0].to, "ana.nueva@correo.cl");

  // Los DOS lados del vinculo: el del workspace lo consulta la recuperacion,
  // el del usuario lo lee la PWA.
  const rutas = db.escrituras.map((e) => e.path).sort();
  assert.deepEqual(rutas, [
    "users/uid1/workerLinks/ws1",
    "workspaces/ws1/workerLinks/uid1"
  ]);
  assert.equal(db.escrituras[0].value.workerEmail, "ana.nueva@correo.cl");
  assert.equal(db.escrituras[0].options.merge, true);
});

test("sin cambios no se escribe nada", async () => {
  // Se dispara en CADA guardado de perfiles: escribir siempre seria ruido caro.
  const db = fakeDb({
    uid1: { status: "active", profileRut: "187654321", workerEmail: "ana.nueva@correo.cl" }
  });

  const updates = await syncWorkerLinkEmailsHandler(evento(PERFILES), deps(db));

  assert.equal(updates, null);
  assert.equal(db.escrituras.length, 0);
  assert.equal(db.fueComprometido(), false);
});

test("un perfil SIN correo no vacia el vinculo", async () => {
  // Vaciarlo dejaria a esa persona sin poder recuperarse jamas, y lo mas
  // probable es que sea un dato que falta, no una decision.
  const db = fakeDb({
    uid1: { status: "active", profileRut: "187654321", workerEmail: "ana.vieja@correo.cl" }
  });

  const updates = await syncWorkerLinkEmailsHandler(
    evento([{ rut: "18.765.432-1", name: "ANA SOTO", email: "" }]),
    deps(db)
  );

  assert.equal(updates, null);
  assert.equal(db.escrituras.length, 0);
});

test("un correo mal escrito tampoco pisa al bueno", async () => {
  const db = fakeDb({
    uid1: { status: "active", profileRut: "187654321", workerEmail: "ana.vieja@correo.cl" }
  });

  const updates = await syncWorkerLinkEmailsHandler(
    evento([{ rut: "18.765.432-1", name: "ANA SOTO", email: "ana arroba correo" }]),
    deps(db)
  );

  assert.equal(updates, null);
  assert.equal(db.escrituras.length, 0);
});

test("los vinculos desvinculados se ignoran", async () => {
  const db = fakeDb({
    uid1: { status: "unlinked", profileRut: "187654321", workerEmail: "ana.vieja@correo.cl" }
  });

  const updates = await syncWorkerLinkEmailsHandler(evento(PERFILES), deps(db));

  assert.equal(updates, null);
  assert.equal(db.escrituras.length, 0);
});

test("borrar la entrada de perfiles no toca ningun vinculo", async () => {
  const db = fakeDb({
    uid1: { status: "active", profileRut: "187654321", workerEmail: "ana.vieja@correo.cl" }
  });

  const updates = await syncWorkerLinkEmailsHandler(
    {
      params: { workspaceId: "ws1" },
      data: {
        before: { data: () => ({ storageKey: "profiles" }) },
        after: { data: () => null }
      }
    },
    deps(db)
  );

  assert.equal(updates, null);
  assert.equal(db.escrituras.length, 0);
});

test("otra entrada del modulo profile no dispara nada", async () => {
  const db = fakeDb({ uid1: { status: "active", profileRut: "187654321" } });

  const updates = await syncWorkerLinkEmailsHandler(
    {
      params: { workspaceId: "ws1" },
      data: {
        before: { data: () => ({ storageKey: "otra_cosa" }) },
        after: { data: () => ({ storageKey: "otra_cosa", value: "[]" }) }
      }
    },
    deps(db)
  );

  assert.equal(updates, null);
  assert.equal(db.escrituras.length, 0);
});

test("el RUT manda sobre el nombre al emparejar", () => {
  const perfiles = [
    { rut: "111111111", name: "NOMBRE REPETIDO", email: "uno@correo.cl" },
    { rut: "222222222", name: "NOMBRE REPETIDO", email: "dos@correo.cl" }
  ];

  const elegido = findProfileForLink(
    { profileRut: "22.222.222-2", profileName: "NOMBRE REPETIDO" },
    perfiles
  );

  assert.equal(elegido.email, "dos@correo.cl");
});

test("sin RUT se empareja por nombre, ignorando tildes", () => {
  const elegido = findProfileForLink(
    { profileName: "JOSÉ  PÉREZ" },
    [{ name: "Jose Perez", email: "jose@correo.cl" }]
  );

  assert.equal(elegido.email, "jose@correo.cl");
});

test("un vinculo sin perfil que le corresponda se deja en paz", () => {
  const updates = emailUpdatesForLinks({
    profiles: [{ rut: "999999999", name: "OTRA", email: "otra@correo.cl" }],
    links: [{ uid: "uid1", status: "active", profileRut: "187654321", workerEmail: "ana@correo.cl" }]
  });

  assert.deepEqual(updates, []);
});
