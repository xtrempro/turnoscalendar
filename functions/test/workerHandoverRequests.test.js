"use strict";

// Pedir a otra unidad del establecimiento el traspaso de un trabajador.
//
// Lo que estas pruebas protegen, por orden de importancia: que aceptar un
// pedido no pueda quedar en nada -sin transferencia de verdad, la unidad que
// pidio espera para siempre-, que solo responda quien tiene al trabajador, y
// que el pedido no lleve datos de la persona mas alla del RUT.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ACCEPTED,
  CANCELED,
  COLLECTION,
  PENDING,
  REJECTED,
  cancelWorkerHandoverRequestHandler,
  notifyWorkerHandoverRequestHandler,
  requestWorkerHandoverHandler,
  resolveWorkerHandoverRequestHandler,
  _private
} = require("../workerHandoverRequests");

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fakeDb({ docs = {}, members = {} } = {}) {
  const guardados = new Map(Object.entries(docs));

  function snap(id) {
    const data = guardados.get(id);

    return { exists: Boolean(data), data: () => data || {} };
  }

  return {
    guardados,
    collection: (nombre) => {
      if (nombre === COLLECTION) {
        return {
          doc: (id) => ({
            id,
            get: async () => snap(id),
            set: async (data, options) => {
              const previo = options?.merge ? (guardados.get(id) || {}) : {};

              guardados.set(id, { ...previo, ...data });
            }
          }),
          where: (campo, _op, valor) => ({
            get: async () => ({
              docs: [...guardados.entries()]
                .filter(([, data]) => data[campo] === valor)
                .map(([id, data]) => ({ id, data: () => data }))
            })
          })
        };
      }

      assert.equal(nombre, "workspaces");

      return {
        doc: (workspaceId) => ({
          collection: (sub) => {
            assert.equal(sub, "members");

            return {
              get: async () => ({
                docs: (members[workspaceId] || []).map((miembro) => ({
                  id: miembro.uid,
                  data: () => miembro
                }))
              })
            };
          }
        })
      };
    }
  };
}

function deps(db, overrides = {}) {
  const llamadas = { establecimiento: [], permiso: [] };

  return {
    llamadas,
    deps: {
      db,
      HttpsError,
      idFactory: () => "pedido-1",
      requireProfileManager: async (workspaceId, uid) => {
        llamadas.permiso.push({ workspaceId, uid });
      },
      requireSameEstablishment: async (unoId, otroId) => {
        llamadas.establecimiento.push({ unoId, otroId });

        return "hospital-claudio-vicuna";
      },
      ...overrides
    }
  };
}

function peticion(data, uid = "supervisor") {
  return { auth: { uid, token: {} }, data };
}

const PEDIDO_BASE = {
  workspaceId: "ws-urgencias",
  workspaceName: "Urgencias",
  sourceWorkspaceId: "ws-uci",
  sourceWorkspaceName: "UCI",
  rut: "17.816.632-8",
  requestedByName: "Jefa de Urgencias"
};

function guardado(db) {
  return db.guardados.get("pedido-1");
}

test("crea el pedido pendiente con el RUT normalizado", async () => {
  const db = fakeDb();
  const { deps: dependencias } = deps(db);
  const resultado = await requestWorkerHandoverHandler(
    peticion(PEDIDO_BASE),
    dependencias
  );

  assert.deepEqual(resultado, {
    status: PENDING,
    requestId: "pedido-1",
    created: true
  });

  const pedido = guardado(db);

  assert.equal(pedido.rut, "178166328");
  assert.equal(pedido.requestingWorkspaceId, "ws-urgencias");
  assert.equal(pedido.sourceWorkspaceId, "ws-uci");
  // El establecimiento lo dice el servidor, no el cliente.
  assert.equal(pedido.establishment, "hospital-claudio-vicuna");
  assert.equal(pedido.status, PENDING);
  assert.ok(pedido.expiresAt > pedido.createdAt, "debe caducar");
});

test("el pedido no lleva datos de la persona, solo el RUT", async () => {
  // La busqueda que origina el pedido devuelve a proposito solo en que unidad
  // esta la persona. Si el pedido viajara con su nombre o su correo, esa
  // reserva no serviria de nada.
  const db = fakeDb();
  const { deps: dependencias } = deps(db);

  await requestWorkerHandoverHandler(
    peticion({ ...PEDIDO_BASE, profileName: "ALAN PLAZA", email: "alan@correo.cl" }),
    dependencias
  );

  const texto = JSON.stringify(guardado(db));

  assert.ok(!texto.includes("ALAN"), "no debe guardar el nombre");
  assert.ok(!texto.includes("alan@correo.cl"), "no debe guardar el correo");
});

test("primero el permiso y despues el establecimiento", async () => {
  // Al reves, un miembro sin permiso podria sondear si dos unidades comparten
  // establecimiento.
  const db = fakeDb();
  const { deps: dependencias, llamadas } = deps(db, {
    requireProfileManager: async () => {
      throw new HttpsError("permission-denied", "No puedes administrar perfiles.");
    }
  });

  await assert.rejects(
    () => requestWorkerHandoverHandler(peticion(PEDIDO_BASE), dependencias),
    (error) => error.code === "permission-denied"
  );

  assert.deepEqual(llamadas.establecimiento, [], "no debio consultarse");
  assert.equal(db.guardados.size, 0);
});

test("unidades de distinto establecimiento no pueden pedir", async () => {
  const db = fakeDb();
  const { deps: dependencias } = deps(db, {
    requireSameEstablishment: async () => {
      throw new HttpsError(
        "failed-precondition",
        "Las unidades no estan enlazadas ni son del mismo establecimiento."
      );
    }
  });

  await assert.rejects(
    () => requestWorkerHandoverHandler(peticion(PEDIDO_BASE), dependencias),
    (error) => error.code === "failed-precondition"
  );

  assert.equal(db.guardados.size, 0);
});

test("no se pide a la propia unidad", async () => {
  const db = fakeDb();
  const { deps: dependencias } = deps(db);

  await assert.rejects(
    () => requestWorkerHandoverHandler(
      peticion({ ...PEDIDO_BASE, sourceWorkspaceId: "ws-urgencias" }),
      dependencias
    ),
    (error) => error.code === "invalid-argument"
  );
});

test("un RUT incompleto no pide nada", async () => {
  const db = fakeDb();
  const { deps: dependencias } = deps(db);

  await assert.rejects(
    () => requestWorkerHandoverHandler(
      peticion({ ...PEDIDO_BASE, rut: "123" }),
      dependencias
    ),
    (error) => error.code === "invalid-argument"
  );
});

test("una fecha sugerida invalida no pasa", async () => {
  const db = fakeDb();
  const { deps: dependencias } = deps(db);

  await assert.rejects(
    () => requestWorkerHandoverHandler(
      peticion({ ...PEDIDO_BASE, suggestedStartDate: "manana" }),
      dependencias
    ),
    (error) => error.code === "invalid-argument"
  );
});

test("dos pedidos iguales no crean dos documentos", async () => {
  const db = fakeDb();
  const { deps: dependencias } = deps(db, { idFactory: () => `pedido-${db.guardados.size + 1}` });

  await requestWorkerHandoverHandler(peticion(PEDIDO_BASE), dependencias);

  const segundo = await requestWorkerHandoverHandler(
    // El mismo RUT escrito distinto: se compara normalizado.
    peticion({ ...PEDIDO_BASE, rut: "17816632-8" }),
    dependencias
  );

  assert.equal(segundo.created, false);
  assert.equal(segundo.requestId, "pedido-1");
  assert.equal(db.guardados.size, 1);
});

test("un pedido caducado no bloquea uno nuevo", async () => {
  const db = fakeDb({
    docs: {
      viejo: {
        requestingWorkspaceId: "ws-urgencias",
        sourceWorkspaceId: "ws-uci",
        rut: "178166328",
        status: PENDING,
        expiresAt: new Date(Date.now() - 1000)
      }
    }
  });
  const { deps: dependencias } = deps(db);
  const resultado = await requestWorkerHandoverHandler(
    peticion(PEDIDO_BASE),
    dependencias
  );

  assert.equal(resultado.created, true);
});

test("un pedido a otra unidad no se confunde con uno ya hecho", async () => {
  const db = fakeDb({
    docs: {
      otro: {
        requestingWorkspaceId: "ws-urgencias",
        sourceWorkspaceId: "ws-pabellon",
        rut: "178166328",
        status: PENDING
      }
    }
  });
  const { deps: dependencias } = deps(db);
  const resultado = await requestWorkerHandoverHandler(
    peticion(PEDIDO_BASE),
    dependencias
  );

  assert.equal(resultado.created, true);
});

function pedidoPendiente(extra = {}) {
  return {
    "pedido-1": {
      requestingWorkspaceId: "ws-urgencias",
      requestingWorkspaceName: "Urgencias",
      sourceWorkspaceId: "ws-uci",
      rut: "178166328",
      status: PENDING,
      ...extra
    }
  };
}

test("aceptar sin la transferencia no se permite", async () => {
  // Es la prueba que mas importa de este archivo. Si un pedido pudiera quedar
  // "aceptado" sin que exista la transferencia, nada viajaria y la unidad que
  // pidio esperaria para siempre a alguien que nunca llega.
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias } = deps(db);

  await assert.rejects(
    () => resolveWorkerHandoverRequestHandler(
      peticion({ workspaceId: "ws-uci", requestId: "pedido-1", approve: true }),
      dependencias
    ),
    (error) => error.code === "invalid-argument"
  );

  assert.equal(guardado(db).status, PENDING);
});

test("aceptar anota la transferencia que responde al pedido", async () => {
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias } = deps(db);
  const resultado = await resolveWorkerHandoverRequestHandler(
    peticion({
      workspaceId: "ws-uci",
      requestId: "pedido-1",
      approve: true,
      transferRequestId: "transfer-9"
    }),
    dependencias
  );

  assert.equal(resultado.status, ACCEPTED);
  assert.equal(guardado(db).transferRequestId, "transfer-9");
});

test("rechazar no deja ninguna transferencia anotada", async () => {
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias } = deps(db);
  const resultado = await resolveWorkerHandoverRequestHandler(
    peticion({
      workspaceId: "ws-uci",
      requestId: "pedido-1",
      approve: false,
      transferRequestId: "transfer-9"
    }),
    dependencias
  );

  assert.equal(resultado.status, REJECTED);
  assert.equal(guardado(db).transferRequestId, "");
});

test("solo responde la unidad que tiene al trabajador", async () => {
  // La que pidio no puede aprobarse su propio pedido.
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias } = deps(db);

  await assert.rejects(
    () => resolveWorkerHandoverRequestHandler(
      peticion({
        workspaceId: "ws-urgencias",
        requestId: "pedido-1",
        approve: true,
        transferRequestId: "transfer-9"
      }),
      dependencias
    ),
    (error) => error.code === "permission-denied"
  );

  assert.equal(guardado(db).status, PENDING);
});

test("un pedido caducado ya no se puede responder", async () => {
  const db = fakeDb({
    docs: pedidoPendiente({ expiresAt: new Date(Date.now() - 1000) })
  });
  const { deps: dependencias } = deps(db);

  await assert.rejects(
    () => resolveWorkerHandoverRequestHandler(
      peticion({
        workspaceId: "ws-uci",
        requestId: "pedido-1",
        approve: true,
        transferRequestId: "transfer-9"
      }),
      dependencias
    ),
    (error) => error.code === "failed-precondition"
  );
});

test("un pedido ya resuelto no se responde dos veces", async () => {
  const db = fakeDb({ docs: pedidoPendiente({ status: ACCEPTED }) });
  const { deps: dependencias } = deps(db);

  await assert.rejects(
    () => resolveWorkerHandoverRequestHandler(
      peticion({
        workspaceId: "ws-uci",
        requestId: "pedido-1",
        approve: false
      }),
      dependencias
    ),
    (error) => error.code === "failed-precondition"
  );
});

test("solo la unidad que pidio puede retirar el pedido", async () => {
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias } = deps(db);

  await assert.rejects(
    () => cancelWorkerHandoverRequestHandler(
      peticion({ workspaceId: "ws-uci", requestId: "pedido-1" }),
      dependencias
    ),
    (error) => error.code === "permission-denied"
  );

  const retirado = await cancelWorkerHandoverRequestHandler(
    peticion({ workspaceId: "ws-urgencias", requestId: "pedido-1" }),
    dependencias
  );

  assert.equal(retirado.status, CANCELED);
  assert.equal(guardado(db).status, CANCELED);
});

test("un pedido que ya no existe no se responde", async () => {
  const db = fakeDb();
  const { deps: dependencias } = deps(db);

  await assert.rejects(
    () => resolveWorkerHandoverRequestHandler(
      peticion({
        workspaceId: "ws-uci",
        requestId: "pedido-1",
        approve: true,
        transferRequestId: "transfer-9"
      }),
      dependencias
    ),
    (error) => error.code === "not-found"
  );
});

function avisoDeps(db, enviados) {
  return {
    db,
    canManageProfiles: (miembro) => miembro.role === "owner" || miembro.role === "admin",
    getUserEmail: async (uid) => `${uid}@correo.cl`,
    sendEmail: async (mensaje) => enviados.push(mensaje),
    logger: { warn: () => {} }
  };
}

function evento(data) {
  return { data: { data: () => data } };
}

test("avisa solo a quien puede responder el pedido", async () => {
  const db = fakeDb({
    members: {
      "ws-uci": [
        { uid: "jefa", role: "owner" },
        { uid: "mirona", role: "viewer" }
      ]
    }
  });
  const enviados = [];

  await notifyWorkerHandoverRequestHandler(
    evento({
      sourceWorkspaceId: "ws-uci",
      requestingWorkspaceName: "Urgencias",
      rut: "178166328",
      status: PENDING
    }),
    avisoDeps(db, enviados)
  );

  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].to, "jefa@correo.cl");
});

test("el aviso nombra la unidad y el RUT, y no inventa a la persona", async () => {
  const db = fakeDb({ members: { "ws-uci": [{ uid: "jefa", role: "owner" }] } });
  const enviados = [];

  await notifyWorkerHandoverRequestHandler(
    evento({
      sourceWorkspaceId: "ws-uci",
      requestingWorkspaceName: "Urgencias",
      rut: "178166328",
      status: PENDING
    }),
    avisoDeps(db, enviados)
  );

  assert.ok(enviados[0].text.includes("Urgencias"));
  assert.ok(enviados[0].text.includes("178166328"));
  assert.ok(enviados[0].text.includes("Solicitudes"));
  assert.ok(!enviados[0].text.includes("undefined"));
});

test("un pedido que nace resuelto no avisa a nadie", async () => {
  const db = fakeDb({ members: { "ws-uci": [{ uid: "jefa", role: "owner" }] } });
  const enviados = [];

  await notifyWorkerHandoverRequestHandler(
    evento({ sourceWorkspaceId: "ws-uci", rut: "178166328", status: CANCELED }),
    avisoDeps(db, enviados)
  );

  assert.deepEqual(enviados, []);
});

test("si un correo falla, los demas igual se envian", async () => {
  const db = fakeDb({
    members: {
      "ws-uci": [
        { uid: "rota", role: "owner" },
        { uid: "jefa", role: "admin" }
      ]
    }
  });
  const enviados = [];
  const dependencias = avisoDeps(db, enviados);

  dependencias.sendEmail = async (mensaje) => {
    if (mensaje.to === "rota@correo.cl") throw new Error("rebotado");

    enviados.push(mensaje);
  };

  await notifyWorkerHandoverRequestHandler(
    evento({
      sourceWorkspaceId: "ws-uci",
      requestingWorkspaceName: "Urgencias",
      rut: "178166328",
      status: PENDING
    }),
    dependencias
  );

  assert.deepEqual(enviados.map((item) => item.to), ["jefa@correo.cl"]);
});

test("un pedido pendiente sin fecha de caducidad sigue sirviendo", () => {
  // Los pedidos viejos, de antes de que caducaran, no deben quedar muertos.
  assert.equal(_private.requestIsUsable({ status: PENDING }, Date.now()), true);
  assert.equal(
    _private.requestIsUsable({ status: PENDING, expiresAt: new Date(Date.now() + 1000) }, Date.now()),
    true
  );
  assert.equal(_private.requestIsUsable({ status: ACCEPTED }, Date.now()), false);
});
