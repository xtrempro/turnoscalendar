"use strict";

// Detectar que un RUT ya esta registrado en otra unidad del mismo
// establecimiento. Lo que estas pruebas protegen: que no devuelva datos de
// personas, y que no mire unidades que no corresponden.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  findWorkerInEstablishmentHandler,
  _private
} = require("../workerEstablishmentLookup");

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Doble de Firestore: unidades, y los perfiles de cada una guardados como la
// entrada "profiles" del modulo profile.
function fakeDb(unidades) {
  function entradasDe(unidad) {
    return {
      where: (campo, _op, valor) => ({
        get: async () => ({
          docs: (unidad.entries || [])
            .filter((item) => item[campo] === valor)
            .map((item) => ({ id: item.id || "e1", data: () => item }))
        })
      })
    };
  }

  function refUnidad(unidad) {
    return {
      get: async () => ({
        exists: true,
        data: () => ({ name: unidad.name, establishment: unidad.establishment })
      }),
      collection: () => ({
        doc: () => ({ collection: () => entradasDe(unidad) })
      })
    };
  }

  return {
    collection: () => ({
      doc: (id) => {
        const unidad = unidades.find((item) => item.id === id) || { id, entries: [] };

        return refUnidad(unidad);
      },
      where: (_campo, _op, valor) => ({
        limit: () => ({
          get: async () => ({
            docs: unidades
              .filter((item) => item.establishment === valor)
              .map((item) => ({
                id: item.id,
                data: () => ({ name: item.name, establishment: item.establishment })
              }))
          })
        })
      })
    })
  };
}

function conPerfiles(perfiles) {
  return [{ id: "e1", storageKey: "profiles", value: JSON.stringify(perfiles) }];
}

const UNIDADES = [
  {
    id: "ws-imagenologia",
    name: "Imagenologia",
    establishment: "hospital-claudio-vicuna",
    entries: conPerfiles([{ name: "OTRA PERSONA", rut: "99.999.999-9" }])
  },
  {
    id: "ws-uci",
    name: "UCI",
    establishment: "hospital-claudio-vicuna",
    entries: conPerfiles([
      { name: "ALAN PLAZA", rut: "17.816.632-8", email: "alan@correo.cl", active: true }
    ])
  },
  {
    id: "ws-ajena",
    name: "Unidad de otro hospital",
    establishment: "otro-hospital",
    entries: conPerfiles([{ name: "ALAN PLAZA", rut: "17816632-8" }])
  }
];

const DEPS = {
  HttpsError,
  requireProfileManager: async () => ({ role: "owner" })
};

function peticion(rut, workspaceId = "ws-imagenologia") {
  return { auth: { uid: "supervisor", token: {} }, data: { rut, workspaceId } };
}

test("encuentra el RUT en otra unidad del mismo establecimiento", async () => {
  const resultado = await findWorkerInEstablishmentHandler(
    peticion("17.816.632-8"),
    { ...DEPS, db: fakeDb(UNIDADES) }
  );

  assert.equal(resultado.establishment, "hospital-claudio-vicuna");
  assert.deepEqual(resultado.unidades, [
    { workspaceId: "ws-uci", workspaceName: "UCI", active: true }
  ]);
});

test("no devuelve datos de la persona", async () => {
  // Quien pregunta ya escribio el RUT y sabe de quien se trata. Devolver su
  // nombre o su correo convertiria esto en una via para pescar datos de
  // trabajadores de otras unidades.
  const resultado = await findWorkerInEstablishmentHandler(
    peticion("17.816.632-8"),
    { ...DEPS, db: fakeDb(UNIDADES) }
  );
  const texto = JSON.stringify(resultado);

  assert.ok(!texto.includes("ALAN"), "no debe salir el nombre");
  assert.ok(!texto.includes("alan@correo.cl"), "no debe salir el correo");
  assert.ok(!texto.includes("17816632"), "ni el RUT de vuelta");
});

test("no mira unidades de otro establecimiento", async () => {
  // El mismo RUT existe en "Unidad de otro hospital" y no debe aparecer.
  const resultado = await findWorkerInEstablishmentHandler(
    peticion("17.816.632-8"),
    { ...DEPS, db: fakeDb(UNIDADES) }
  );

  assert.equal(resultado.unidades.length, 1);
  assert.ok(!JSON.stringify(resultado).includes("ws-ajena"));
});

test("una unidad sin establecimiento no ve ninguna otra", async () => {
  // Vacio no coincide con vacio: si no, las unidades sin declarar se verian
  // entre todas.
  const sinDeclarar = [
    { id: "ws-sola", name: "Sola", establishment: "", entries: [] },
    { id: "ws-otra-sola", name: "Otra", establishment: "", entries: conPerfiles([{ rut: "17816632-8" }]) }
  ];
  const resultado = await findWorkerInEstablishmentHandler(
    peticion("17.816.632-8", "ws-sola"),
    { ...DEPS, db: fakeDb(sinDeclarar) }
  );

  assert.deepEqual(resultado, { establishment: "", unidades: [] });
});

test("un perfil inactivo igual se informa", async () => {
  // Es justo el de alguien que se fue de esa unidad, y sus saldos de
  // vacaciones siguen ahi: es el caso que mas conviene detectar.
  const conInactivo = [
    { id: "ws-a", name: "A", establishment: "hcv", entries: [] },
    {
      id: "ws-b",
      name: "B",
      establishment: "hcv",
      entries: conPerfiles([{ rut: "17816632-8", active: false }])
    }
  ];
  const resultado = await findWorkerInEstablishmentHandler(
    peticion("17.816.632-8", "ws-a"),
    { ...DEPS, db: fakeDb(conInactivo) }
  );

  assert.deepEqual(resultado.unidades, [
    { workspaceId: "ws-b", workspaceName: "B", active: false }
  ]);
});

test("sin permiso para administrar perfiles no se consulta nada", async () => {
  await assert.rejects(
    () => findWorkerInEstablishmentHandler(peticion("17.816.632-8"), {
      ...DEPS,
      db: fakeDb(UNIDADES),
      requireProfileManager: async () => {
        throw new HttpsError("permission-denied", "No puedes administrar perfiles.");
      }
    }),
    (error) => error.code === "permission-denied"
  );
});

test("un RUT incompleto no dispara la busqueda", async () => {
  await assert.rejects(
    () => findWorkerInEstablishmentHandler(peticion("123"), {
      ...DEPS,
      db: fakeDb(UNIDADES)
    }),
    (error) => error.code === "invalid-argument"
  );
});

test("el RUT se compara normalizado", () => {
  assert.equal(_private.normalizeRut("17.816.632-8"), "178166328");
  assert.equal(_private.normalizeRut("17816632-8"), "178166328");
});

test("una lista de perfiles rota no rompe la busqueda", () => {
  assert.deepEqual(_private.parseProfiles("{no es json"), []);
  assert.deepEqual(_private.parseProfiles(null), []);
  assert.deepEqual(_private.parseProfiles([{ rut: "1" }]), [{ rut: "1" }]);
});
