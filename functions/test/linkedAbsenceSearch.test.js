"use strict";

// Buscar ausencias en las unidades enlazadas.
//
// Sirven para respaldar el contrato de un trabajador a reemplazo. Lo que fija
// este archivo es que se lean las unidades correctas, que se devuelvan los dias
// CRUDOS -sin agrupar- y que una unidad caida no hunda a las demas.
//
// Los datos se siembran en los TROZOS BASE de cada modulo de estado, que es el
// mismo camino de lectura que usa el modulo real. Asi no hace falta conocer
// como se codifica el id de cada entrada suelta.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  findLinkedUnitAbsences,
  leaveKeysForProfile,
  searchWorkspaceAbsences
} = require("../linkedAbsenceSearch.js");

/* =========================================================
   Un Firestore de mentira, con lo justo
========================================================= */

class FakeSnapshot {
  constructor(path, data) {
    this.path = path;
    this.id = path.split("/").at(-1);
    this._data = data;
    this.exists = data !== undefined;
  }

  data() {
    return this._data;
  }
}

class FakeDoc {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path.split("/").at(-1);
  }

  collection(name) {
    return new FakeCol(this.db, `${this.path}/${name}`);
  }

  get() {
    return Promise.resolve(this.db.snap(this.path));
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
      [...this.filters, { field, op, value }]
    );
  }

  get() {
    const docs = [...this.db.documents.entries()]
      // Hijos DIRECTOS: sin esto, "chunks" traeria tambien los nietos.
      .filter(([path]) =>
        path.startsWith(`${this.path}/`) &&
        !path.slice(this.path.length + 1).includes("/")
      )
      .map(([path, data]) => new FakeSnapshot(path, data))
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

  snap(path) {
    return new FakeSnapshot(path, this.documents.get(path));
  }

  getAll(...refs) {
    return Promise.resolve(refs.map(ref => this.snap(ref.path)));
  }
}

/* =========================================================
   Siembra
========================================================= */

/** Un modulo de estado es un JSON cuyos valores son, a su vez, JSON. */
function moduloBase(workspaceId, moduleId, valores) {
  return {
    [`workspaces/${workspaceId}/stateModules/${moduleId}/chunks/0`]: {
      index: 0,
      text: JSON.stringify(
        Object.fromEntries(
          Object.entries(valores).map(([key, value]) => [
            key,
            JSON.stringify(value)
          ])
        )
      )
    }
  };
}

function unidadConAusencias(workspaceId) {
  return {
    ...moduloBase(workspaceId, "profile", {
      profiles: [
        {
          id: "p-1",
          name: "Ana Perez",
          estamento: "Profesional",
          profession: "Enfermeria",
          active: true
        },
        {
          id: "p-2",
          name: "Beto Soto",
          estamento: "Tecnico",
          profession: "Tecnico en Imagenologia",
          active: true
        },
        {
          id: "p-3",
          name: "Ceci Inactiva",
          estamento: "Profesional",
          profession: "Enfermeria",
          active: false
        }
      ]
    }),
    ...moduloBase(workspaceId, "turnos", {
      "legal_Ana Perez": { "2026-8-1": true, "2026-8-2": true, "2026-1-5": true },
      "absences_Ana Perez": { "2026-8-20": { type: "license" } },
      "absences_Beto Soto": { "2026-8-10": "unpaid_leave" },
      // La inactiva tiene permisos, pero no debe aparecer.
      "legal_Ceci Inactiva": { "2026-8-3": true }
    })
  };
}

function enlace(id, fromWorkspaceId, toWorkspaceId, status = "accepted") {
  return {
    [`workspaceLinks/${id}`]: {
      fromWorkspaceId,
      toWorkspaceId,
      fromWorkspaceName: fromWorkspaceId,
      toWorkspaceName: toWorkspaceId,
      status
    }
  };
}

const CORTE = "2026-09-01";

/* =========================================================
   Una unidad
========================================================= */

test("devuelve los dias crudos, por trabajador y por tipo", async () => {
  // SIN agrupar en rangos a proposito: agrupa el cliente, con el mismo modulo
  // que usa para sus propias ausencias. Agrupar aqui exigiria replicar la
  // continuidad habil -que depende de los feriados- y dos implementaciones del
  // mismo criterio derivan en silencio.
  const db = new FakeDb(unidadConAusencias("w-otra"));
  const unidad = await searchWorkspaceAbsences({
    db,
    workspace: { id: "w-otra", name: "Imagenologia", linkId: "l-1" },
    fromISO: CORTE
  });

  assert.equal(unidad.workspaceName, "Imagenologia");
  assert.equal(unidad.linkId, "l-1");

  const ana = unidad.workers.find(worker => worker.name === "Ana Perez");

  assert.deepEqual(ana.leaveKeys.legal, ["2026-8-1", "2026-8-2"]);
  assert.deepEqual(ana.leaveKeys.license, ["2026-8-20"]);
  assert.equal(ana.profession, "Enfermeria");
});

test("lo anterior al corte no viaja", async () => {
  // "2026-1-5" es febrero (mes base 0), muy anterior al corte.
  const db = new FakeDb(unidadConAusencias("w-otra"));
  const unidad = await searchWorkspaceAbsences({
    db,
    workspace: { id: "w-otra", name: "Imagenologia", linkId: "l-1" },
    fromISO: CORTE
  });
  const ana = unidad.workers.find(worker => worker.name === "Ana Perez");

  assert.ok(!ana.leaveKeys.legal.includes("2026-1-5"));
});

test("los inactivos no aparecen", async () => {
  const db = new FakeDb(unidadConAusencias("w-otra"));
  const unidad = await searchWorkspaceAbsences({
    db,
    workspace: { id: "w-otra", name: "Imagenologia", linkId: "l-1" },
    fromISO: CORTE
  });

  assert.ok(!unidad.workers.some(worker => worker.name === "Ceci Inactiva"));
});

test("quien no tiene ausencias no ocupa lugar en la lista", async () => {
  const state = {
    "legal_Ana": {},
    "absences_Ana": {}
  };

  assert.deepEqual(
    leaveKeysForProfile(
      Object.fromEntries(
        Object.entries(state).map(([key, value]) => [
          key,
          JSON.stringify(value)
        ])
      ),
      "Ana",
      null
    ),
    {}
  );
});

/* =========================================================
   Varias unidades
========================================================= */

test("solo se consultan los enlaces ACEPTADOS", async () => {
  const db = new FakeDb({
    ...enlace("l-1", "w-mia", "w-otra"),
    ...enlace("l-2", "w-mia", "w-pendiente", "pending"),
    ...unidadConAusencias("w-otra"),
    ...unidadConAusencias("w-pendiente")
  });
  const resultado = await findLinkedUnitAbsences({
    db,
    requesterWorkspaceId: "w-mia",
    fromISO: CORTE
  });

  assert.deepEqual(
    resultado.units.map(unit => unit.workspaceId),
    ["w-otra"]
  );
});

test("el enlace vale en los dos sentidos", async () => {
  // La otra unidad pudo ser quien pidio el enlace.
  const db = new FakeDb({
    ...enlace("l-1", "w-otra", "w-mia"),
    ...unidadConAusencias("w-otra")
  });
  const resultado = await findLinkedUnitAbsences({
    db,
    requesterWorkspaceId: "w-mia",
    fromISO: CORTE
  });

  assert.deepEqual(
    resultado.units.map(unit => unit.workspaceId),
    ["w-otra"]
  );
});

test("una unidad caida no hunde a las demas", async () => {
  // Misma tolerancia que la busqueda de reemplazos: se informa aparte.
  const db = new FakeDb({
    ...enlace("l-1", "w-mia", "w-otra"),
    ...enlace("l-2", "w-mia", "w-rota"),
    ...unidadConAusencias("w-otra")
  });
  const original = db.getAll.bind(db);

  db.getAll = (...refs) => (
    refs.some(ref => ref.path.includes("w-rota"))
      ? Promise.reject(new Error("sin permiso"))
      : original(...refs)
  );

  const resultado = await findLinkedUnitAbsences({
    db,
    requesterWorkspaceId: "w-mia",
    fromISO: CORTE
  });

  assert.deepEqual(
    resultado.units.map(unit => unit.workspaceId),
    ["w-otra"]
  );
  assert.equal(resultado.failedUnits.length, 1);
});

test("se puede acotar a UNA unidad enlazada", async () => {
  const db = new FakeDb({
    ...enlace("l-1", "w-mia", "w-otra"),
    ...enlace("l-2", "w-mia", "w-tercera"),
    ...unidadConAusencias("w-otra"),
    ...unidadConAusencias("w-tercera")
  });
  const resultado = await findLinkedUnitAbsences({
    db,
    requesterWorkspaceId: "w-mia",
    fromISO: CORTE,
    sourceWorkspaceId: "w-tercera"
  });

  assert.deepEqual(
    resultado.units.map(unit => unit.workspaceId),
    ["w-tercera"]
  );
});

test("sin unidades enlazadas no hay nada que devolver", async () => {
  const db = new FakeDb(unidadConAusencias("w-otra"));
  const resultado = await findLinkedUnitAbsences({
    db,
    requesterWorkspaceId: "w-mia",
    fromISO: CORTE
  });

  assert.deepEqual(resultado.units, []);
  assert.deepEqual(resultado.failedUnits, []);
});
