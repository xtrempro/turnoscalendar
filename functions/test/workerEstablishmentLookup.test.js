"use strict";

// Detectar que un RUT ya esta registrado en otra unidad del mismo
// establecimiento. Lo que estas pruebas protegen: que no devuelva datos de
// personas, que no mire unidades que no corresponden, y que lea los perfiles
// como estan guardados de verdad y no solo en su forma mas simple.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  findWorkerInEstablishmentHandler,
  findWorkerProfileInWorkspace,
  _private
} = require("../workerEstablishmentLookup");

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Doble de Firestore con el estado del workspace tal como lo escribe el
// cliente: una base compacta en "chunks" y, encima, una entrada por clave en
// "entries" que puede traer parches por elemento.
//
// Cada unidad del arreglo acepta:
//   base  -> lista de perfiles del volcado completo (va a los chunks)
//   entry -> el documento de la entrada "profiles", tal cual
function fakeDb(unidades) {
  function chunksSnap(unidad, moduleId) {
    if (moduleId !== "profile" || !unidad.base) return { docs: [] };

    // El estado es un mapa clave -> JSON en texto, partido en trozos.
    const texto = JSON.stringify({ profiles: JSON.stringify(unidad.base) });
    const corte = Math.ceil(texto.length / 2);

    // Devueltos al reves a proposito: el lector los ordena por index, y si
    // dejara de hacerlo el JSON quedaria partido y no se leeria ningun perfil.
    return {
      docs: [
        { id: "c2", data: () => ({ index: 1, text: texto.slice(corte) }) },
        { id: "c1", data: () => ({ index: 0, text: texto.slice(0, corte) }) }
      ]
    };
  }

  function refUnidad(unidad) {
    return {
      get: async () => ({
        exists: true,
        data: () => ({ name: unidad.name, establishment: unidad.establishment })
      }),
      collection: (nombre) => {
        assert.equal(nombre, "stateModules");

        return {
          doc: (moduleId) => ({
            collection: (sub) => {
              if (sub === "chunks") {
                return { get: async () => chunksSnap(unidad, moduleId) };
              }

              assert.equal(sub, "entries");

              return {
                doc: (key) => ({ unidad, moduleId, key })
              };
            }
          })
        };
      }
    };
  }

  return {
    collection: () => ({
      doc: (id) => {
        const unidad = unidades.find((item) => item.id === id) || { id };

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
    }),
    getAll: async (...refs) => refs.map((ref) => {
      const entrada = ref.moduleId === "profile" && ref.key === "profiles"
        ? ref.unidad.entry
        : null;

      return { exists: Boolean(entrada), data: () => entrada || {} };
    })
  };
}

// Una entrada de lista, como las escribe el cliente para los perfiles.
function entrada(campos) {
  return { storageKey: "profiles", container: "array", ...campos };
}

const UNIDADES = [
  {
    id: "ws-imagenologia",
    name: "Imagenologia",
    establishment: "hospital-claudio-vicuna",
    base: [{ id: "p-otra", name: "OTRA PERSONA", rut: "99.999.999-9" }]
  },
  {
    id: "ws-uci",
    name: "UCI",
    establishment: "hospital-claudio-vicuna",
    base: [
      {
        id: "p-alan",
        name: "ALAN PLAZA",
        rut: "17.816.632-8",
        email: "alan@correo.cl",
        active: true
      }
    ]
  },
  {
    id: "ws-ajena",
    name: "Unidad de otro hospital",
    establishment: "otro-hospital",
    base: [{ id: "p-alan", name: "ALAN PLAZA", rut: "17816632-8" }]
  }
];

const DEPS = {
  HttpsError,
  requireProfileManager: async () => ({ role: "owner" })
};

function peticion(rut, workspaceId = "ws-imagenologia") {
  return { auth: { uid: "supervisor", token: {} }, data: { rut, workspaceId } };
}

function buscar(unidades, rut, workspaceId) {
  return findWorkerInEstablishmentHandler(
    peticion(rut, workspaceId),
    { ...DEPS, db: fakeDb(unidades) }
  );
}

test("encuentra el RUT en otra unidad del mismo establecimiento", async () => {
  const resultado = await buscar(UNIDADES, "17.816.632-8");

  assert.equal(resultado.establishment, "hospital-claudio-vicuna");
  assert.deepEqual(resultado.unidades, [
    { workspaceId: "ws-uci", workspaceName: "UCI", active: true, exitDate: "" }
  ]);
});

test("no devuelve datos de la persona", async () => {
  // Quien pregunta ya escribio el RUT y sabe de quien se trata. Devolver su
  // nombre o su correo convertiria esto en una via para pescar datos de
  // trabajadores de otras unidades.
  const resultado = await buscar(UNIDADES, "17.816.632-8");
  const texto = JSON.stringify(resultado);

  assert.ok(!texto.includes("ALAN"), "no debe salir el nombre");
  assert.ok(!texto.includes("alan@correo.cl"), "no debe salir el correo");
  assert.ok(!texto.includes("17816632"), "ni el RUT de vuelta");
});

test("no mira unidades de otro establecimiento", async () => {
  // El mismo RUT existe en "Unidad de otro hospital" y no debe aparecer.
  const resultado = await buscar(UNIDADES, "17.816.632-8");

  assert.equal(resultado.unidades.length, 1);
  assert.ok(!JSON.stringify(resultado).includes("ws-ajena"));
});

test("una unidad sin establecimiento no ve ninguna otra", async () => {
  // Vacio no coincide con vacio: si no, las unidades sin declarar se verian
  // entre todas.
  const resultado = await buscar(
    [
      { id: "ws-sola", name: "Sola", establishment: "" },
      {
        id: "ws-otra-sola",
        name: "Otra",
        establishment: "",
        base: [{ id: "p-1", rut: "17816632-8" }]
      }
    ],
    "17.816.632-8",
    "ws-sola"
  );

  assert.deepEqual(resultado, { establishment: "", unidades: [] });
});

test("un perfil inactivo igual se informa", async () => {
  // Es justo el de alguien que se fue de esa unidad, y sus saldos de
  // vacaciones siguen ahi: es el caso que mas conviene detectar.
  const resultado = await buscar(
    [
      { id: "ws-a", name: "A", establishment: "hcv" },
      {
        id: "ws-b",
        name: "B",
        establishment: "hcv",
        base: [{ id: "p-1", rut: "17816632-8", active: false }]
      }
    ],
    "17.816.632-8",
    "ws-a"
  );

  assert.deepEqual(resultado.unidades, [
    { workspaceId: "ws-b", workspaceName: "B", active: false, exitDate: "" }
  ]);
});

test("encuentra un perfil que solo existe en items", async () => {
  // El caso real: el perfil se creo despues del ultimo volcado completo, asi
  // que vive como un parche en `items` y no esta en la base ni en `value`.
  // Leyendo solo `value` esta busqueda diria que no esta en ninguna otra
  // unidad y el supervisor lo ingresaria de cero, que es justo lo que esta
  // pieza existe para evitar.
  const resultado = await buscar(
    [
      { id: "ws-a", name: "A", establishment: "hcv" },
      {
        id: "ws-b",
        name: "B",
        establishment: "hcv",
        base: [{ id: "p-vieja", rut: "11111111-1" }],
        entry: entrada({
          items: {
            "p-nueva": JSON.stringify({
              id: "p-nueva",
              name: "ALAN PLAZA",
              rut: "17816632-8",
              active: true
            })
          }
        })
      }
    ],
    "17.816.632-8",
    "ws-a"
  );

  assert.deepEqual(resultado.unidades, [
    { workspaceId: "ws-b", workspaceName: "B", active: true, exitDate: "" }
  ]);
});

test("un perfil borrado en deletedItems no se informa", async () => {
  // Esta en la base pero fue eliminado despues. Informarlo mandaria al
  // supervisor a pedir el traslado de un perfil que ya no existe.
  function unidades(entry) {
    return [
      { id: "ws-a", name: "A", establishment: "hcv" },
      {
        id: "ws-b",
        name: "B",
        establishment: "hcv",
        base: [{ id: "p-alan", rut: "17816632-8", active: true }],
        entry
      }
    ];
  }

  // Control: el mismo perfil sin el borrado si se encuentra. Sin esto la
  // prueba pasaria igual con un lector que no mire la base, por no encontrar
  // nada en ningun caso.
  const control = await buscar(unidades(undefined), "17.816.632-8", "ws-a");

  assert.equal(control.unidades.length, 1, "la base debe leerse");

  const borrado = await buscar(
    unidades(entrada({ deletedItems: { "p-alan": true } })),
    "17.816.632-8",
    "ws-a"
  );

  assert.deepEqual(borrado.unidades, []);
});

test("lo que corrige items pisa a la base", async () => {
  // El RUT estaba mal escrito y se corrigio. Vale el corregido, y el viejo ya
  // no debe encontrar a nadie.
  const unidades = [
    { id: "ws-a", name: "A", establishment: "hcv" },
    {
      id: "ws-b",
      name: "B",
      establishment: "hcv",
      base: [{ id: "p-alan", rut: "17816632-9", active: true }],
      entry: entrada({
        items: {
          "p-alan": JSON.stringify({ id: "p-alan", rut: "17816632-8", active: true })
        }
      })
    }
  ];

  const corregido = await buscar(unidades, "17.816.632-8", "ws-a");
  const viejo = await buscar(unidades, "17.816.632-9", "ws-a");

  assert.equal(corregido.unidades.length, 1);
  assert.deepEqual(viejo.unidades, []);
});

test("una entrada con value y items aplica el value y encima los items", async () => {
  // Una clave que antes viajaba entera deja su `value` viejo en el documento.
  // Es una foto anterior a los items, asi que los items mandan.
  const resultado = await buscar(
    [
      { id: "ws-a", name: "A", establishment: "hcv" },
      {
        id: "ws-b",
        name: "B",
        establishment: "hcv",
        entry: entrada({
          value: JSON.stringify([{ id: "p-alan", rut: "17816632-8", active: true }]),
          items: {
            "p-alan": JSON.stringify({ id: "p-alan", rut: "17816632-8", active: false })
          }
        })
      }
    ],
    "17.816.632-8",
    "ws-a"
  );

  assert.deepEqual(resultado.unidades, [
    { workspaceId: "ws-b", workspaceName: "B", active: false, exitDate: "" }
  ]);
});

test("una unidad sin estado guardado no rompe la busqueda", async () => {
  const resultado = await buscar(
    [
      { id: "ws-a", name: "A", establishment: "hcv" },
      { id: "ws-vacia", name: "Vacia", establishment: "hcv" }
    ],
    "17.816.632-8",
    "ws-a"
  );

  assert.deepEqual(resultado, { establishment: "hcv", unidades: [] });
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
    () => buscar(UNIDADES, "123"),
    (error) => error.code === "invalid-argument"
  );
});

test("el RUT se compara normalizado", () => {
  assert.equal(_private.normalizeRut("17.816.632-8"), "178166328");
  assert.equal(_private.normalizeRut("17816632-8"), "178166328");
});

// --- Hasta que dia trabajo alla ---
//
// La unidad que pide el traspaso lo necesita para no hacerlo empezar antes y
// vaciar un calendario que la otra ya habia cerrado. Es una fecha de trabajo,
// no un dato de la persona.

function unidadConPerfil(perfil) {
  return [
    { id: "ws-a", name: "A", establishment: "hcv" },
    { id: "ws-b", name: "B", establishment: "hcv", base: [perfil] }
  ];
}

test("de un perfil inactivo se informa su ultimo dia trabajado", async () => {
  const resultado = await buscar(
    unidadConPerfil({
      id: "p-1",
      rut: "17816632-8",
      active: false,
      unitExitDate: "2026-10-15"
    }),
    "17.816.632-8",
    "ws-a"
  );

  assert.equal(resultado.unidades[0].exitDate, "2026-10-15");
});

test("de uno activo no: su fecha de salida puede ser de una vuelta anterior", async () => {
  // Quien esta activo no tiene cerrado nada, y una fecha vieja ahi pondria un
  // limite que no corresponde.
  const resultado = await buscar(
    unidadConPerfil({
      id: "p-1",
      rut: "17816632-8",
      active: true,
      unitExitDate: "2025-01-31"
    }),
    "17.816.632-8",
    "ws-a"
  );

  assert.equal(resultado.unidades[0].exitDate, "");
});

test("una fecha con cualquier forma no se informa", async () => {
  // Llegaria al cliente como piso de un calendario: mejor sin limite que con
  // uno que no se entiende.
  for (const valor of ["15-10-2026", "ayer", 20261015, null]) {
    const resultado = await buscar(
      unidadConPerfil({
        id: "p-1",
        rut: "17816632-8",
        active: false,
        unitExitDate: valor
      }),
      "17.816.632-8",
      "ws-a"
    );

    assert.equal(resultado.unidades[0].exitDate, "", `con ${valor}`);
  }
});

test("buscar el perfil en UNA unidad devuelve el perfil entero", async () => {
  // Lo usa el pedido de traspaso para mirar su fecha de salida, y por eso
  // devuelve el perfil y no una version recortada.
  const perfil = await findWorkerProfileInWorkspace(
    fakeDb(unidadConPerfil({
      id: "p-1",
      name: "ALAN PLAZA",
      rut: "17816632-8",
      active: false,
      unitExitDate: "2026-10-15"
    })),
    "ws-b",
    "17.816.632-8"
  );

  assert.equal(perfil.name, "ALAN PLAZA");
  assert.equal(perfil.unitExitDate, "2026-10-15");

  const ninguno = await findWorkerProfileInWorkspace(
    fakeDb(unidadConPerfil({ id: "p-1", rut: "11111111-1" })),
    "ws-b",
    "17.816.632-8"
  );

  assert.equal(ninguno, null);
});
