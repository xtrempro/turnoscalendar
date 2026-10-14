"use strict";

// Pedir a otra unidad del establecimiento el traspaso de un trabajador.
//
// Lo que estas pruebas protegen, por orden de importancia: que aceptar deje la
// transferencia YA aceptada -si naciera pendiente, a quien pidio el traspaso se
// le pediria aceptar lo que el mismo pidio-, que la fecha y la rotativa sean
// las que eligio quien pide y no quien acepta, que solo responda la unidad que
// tiene al trabajador, y que el pedido no lleve datos de la persona mas alla
// del RUT.

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

const TRANSFERENCIAS = "workerTransferRequests";

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fakeDb({ docs = {}, members = {} } = {}) {
  const guardados = new Map(Object.entries(docs));
  const transferencias = new Map();
  // Una version por documento: es lo que permite detectar que otro lo escribio
  // entre la lectura y la escritura de una transaccion.
  const versiones = new Map();

  function versionar(ruta) {
    versiones.set(ruta, (versiones.get(ruta) || 0) + 1);
  }

  function almacen(nombre) {
    return nombre === TRANSFERENCIAS ? transferencias : guardados;
  }

  function snap(mapa, id) {
    const data = mapa.get(id);

    return { exists: Boolean(data), data: () => data || {} };
  }

  const db = {
    guardados,
    transferencias,
    // Transaccion CON contencion, como la de verdad: si entre la lectura y la
    // escritura alguien toco un documento leido, se aborta y se vuelve a
    // correr. Un doble que solo encola escrituras no puede ver el error que
    // esto viene a probar -dos aceptaciones a la vez-, porque las dos leerian
    // el pedido pendiente y las dos escribirian.
    runTransaction: async (work) => {
      for (let intento = 0; intento < 5; intento += 1) {
        const leidos = new Map();
        const pendientes = [];
        const resultado = await work({
          get: async (ref) => {
            leidos.set(ref.path, versiones.get(ref.path) || 0);

            return ref.get();
          },
          set: (ref, valor, opciones) => pendientes.push(
            () => { ref.set(valor, opciones); versionar(ref.path); }
          ),
          update: (ref, valor) => pendientes.push(
            () => { ref.update(valor); versionar(ref.path); }
          )
        });
        const cambiado = [...leidos].some(
          ([ruta, version]) => (versiones.get(ruta) || 0) !== version
        );

        if (cambiado) continue;

        for (const aplicar of pendientes) aplicar();

        return resultado;
      }

      throw new Error("transaccion abortada tras varios intentos");
    },
    collection: (nombre) => {
      if (nombre === COLLECTION || nombre === TRANSFERENCIAS) {
        const mapa = almacen(nombre);

        return {
          doc: (id) => ({
            id,
            path: `${nombre}/${id}`,
            get: async () => snap(mapa, id),
            set: async (data, options) => {
              const previo = options?.merge ? (mapa.get(id) || {}) : {};

              mapa.set(id, { ...previo, ...data });
            },
            update: async (data) => {
              mapa.set(id, { ...(mapa.get(id) || {}), ...data });
            }
          }),
          where: (campo, _op, valor) => ({
            get: async () => ({
              docs: [...mapa.entries()]
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

  return db;
}

function deps(db, overrides = {}) {
  const llamadas = { establecimiento: [], permiso: [], aplicadas: [] };

  return {
    llamadas,
    deps: {
      db,
      HttpsError,
      idFactory: () => "pedido-1",
      transferIdFactory: () => "transfer-1",
      serverTimestamp: () => "AHORA",
      cleanProfile: (profile = {}) => ({
        name: String(profile.name || "").trim(),
        rut: String(profile.rut || ""),
        leaveBalances: profile.leaveBalances || null
      }),
      applyTransferResponse: async (args) => {
        // Se anota el estado del pedido EN EL MOMENTO de aplicar, para poder
        // comprobar que ya estaba cerrado antes de los efectos.
        llamadas.aplicadas.push({
          ...args,
          pedidoAlAplicar: db.guardados.get("pedido-1")?.status
        });

        return { ok: true };
      },
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
  startDate: "2026-11-03",
  rotationType: "4turno",
  rotationFirstTurn: "noche",
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

test("el pedido lleva la fecha y la rotativa que eligio quien pide", async () => {
  // Es la diferencia con una transferencia normal, donde eso lo decide quien
  // transfiere. Aqui lo decide quien recibe, porque es su unidad la que sabe
  // en que turno necesita a la persona.
  const db = fakeDb();
  const { deps: dependencias } = deps(db);

  await requestWorkerHandoverHandler(peticion(PEDIDO_BASE), dependencias);

  const pedido = guardado(db);

  assert.equal(pedido.startDate, "2026-11-03");
  assert.equal(pedido.rotationType, "4turno");
  assert.equal(pedido.rotationFirstTurn, "noche");
});

test("sin fecha no se puede pedir", async () => {
  const db = fakeDb();
  const { deps: dependencias } = deps(db);

  await assert.rejects(
    () => requestWorkerHandoverHandler(
      peticion({ ...PEDIDO_BASE, startDate: "" }),
      dependencias
    ),
    (error) => error.code === "invalid-argument"
  );
});

test("una fecha mal formada no pasa", async () => {
  const db = fakeDb();
  const { deps: dependencias } = deps(db);

  await assert.rejects(
    () => requestWorkerHandoverHandler(
      peticion({ ...PEDIDO_BASE, startDate: "manana" }),
      dependencias
    ),
    (error) => error.code === "invalid-argument"
  );
});

test("sin rotativa no se puede pedir", async () => {
  // Sin ella, al aceptar habria que preguntarsela a quien pidio, y entonces
  // volveria a haber un paso del otro lado.
  const db = fakeDb();
  const { deps: dependencias } = deps(db);

  await assert.rejects(
    () => requestWorkerHandoverHandler(
      peticion({ ...PEDIDO_BASE, rotationType: "" }),
      dependencias
    ),
    (error) => error.code === "invalid-argument"
  );
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

test("dos pedidos iguales no crean dos documentos", async () => {
  const db = fakeDb();
  const { deps: dependencias } = deps(db, {
    idFactory: () => `pedido-${db.guardados.size + 1}`
  });

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
      startDate: "2026-11-03",
      rotationType: "4turno",
      rotationFirstTurn: "noche",
      status: PENDING,
      ...extra
    }
  };
}

function aceptacion(extra = {}) {
  return peticion({
    workspaceId: "ws-uci",
    workspaceName: "UCI",
    requestId: "pedido-1",
    approve: true,
    profile: { name: "ALAN PLAZA", rut: "17816632-8" },
    resolvedByName: "Jefa de UCI",
    ...extra
  });
}

test("aceptar crea la transferencia y la deja ya aceptada", async () => {
  // Es la prueba que mas importa de este archivo. Si naciera pendiente, a la
  // unidad que pidio el traspaso le apareceria una solicitud para aceptar lo
  // que ella misma pidio, que es justo lo que este camino viene a evitar.
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias } = deps(db);
  const resultado = await resolveWorkerHandoverRequestHandler(
    aceptacion(),
    dependencias
  );

  assert.equal(resultado.status, ACCEPTED);
  assert.equal(resultado.transferRequestId, "transfer-1");

  const transferencia = db.transferencias.get("transfer-1");

  assert.equal(transferencia.status, ACCEPTED);
  assert.equal(transferencia.targetProfileName, "ALAN PLAZA");
  assert.equal(transferencia.sourceWorkspaceId, "ws-uci");
  assert.equal(transferencia.targetWorkspaceId, "ws-urgencias");
  assert.equal(transferencia.handoverRequestId, "pedido-1");
  // Sin enlace: lo que autorizo fue compartir establecimiento.
  assert.equal(transferencia.linkId, "");
});

test("la transferencia lleva la rotativa que eligio quien pidio", async () => {
  // De eso depende que la otra unidad pueda crear el perfil sin preguntar
  // nada. Si no viajara, habria que preguntarsela y volveria el paso de mas.
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias } = deps(db);

  await resolveWorkerHandoverRequestHandler(aceptacion(), dependencias);

  assert.deepEqual(db.transferencias.get("transfer-1").targetRotation, {
    type: "4turno",
    firstTurn: "noche",
    start: "2026-11-03"
  });
});

// Aqui habia una prueba que exigia que quien acepta NO pudiera tocar la fecha.
// Dejo de ser cierto a proposito el 2026-10-14: el pedido puede ser anterior a
// que esta unidad decidiera hasta que dia trabajaba aqui, y entonces la fecha
// pedida borraria dias ya validados. Ahora puede correrla hacia adelante -nunca
// hacia atras-, y eso se prueba al final de este archivo.

test("aceptar pasa por la aplicacion de siempre", async () => {
  // Inactivar el perfil aqui y mudar el enlace no se reimplementa: es el mismo
  // applyTransferResponse que usa una transferencia normal.
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias, llamadas } = deps(db);

  await resolveWorkerHandoverRequestHandler(aceptacion(), dependencias);

  assert.equal(llamadas.aplicadas.length, 1);
  assert.equal(llamadas.aplicadas[0].status, ACCEPTED);
  assert.equal(llamadas.aplicadas[0].targetProfileName, "ALAN PLAZA");
  assert.equal(llamadas.aplicadas[0].requestId, "transfer-1");
});

test("el pedido se cierra ANTES de aplicar los efectos", async () => {
  // Si se cerrara despues y algo fallara en el medio, un segundo "aceptar"
  // crearia una segunda transferencia del mismo trabajador.
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias, llamadas } = deps(db);

  await resolveWorkerHandoverRequestHandler(aceptacion(), dependencias);

  assert.equal(llamadas.aplicadas[0].pedidoAlAplicar, ACCEPTED);
});

test("si aplicar falla, el pedido igual queda cerrado y la transferencia aceptada", async () => {
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias } = deps(db, {
    applyTransferResponse: async () => {
      throw new Error("se cayo la red");
    }
  });

  await assert.rejects(
    () => resolveWorkerHandoverRequestHandler(aceptacion(), dependencias)
  );

  assert.equal(guardado(db).status, ACCEPTED);
  assert.equal(db.transferencias.get("transfer-1").status, ACCEPTED);
});

test("aceptar sin el trabajador no crea ninguna transferencia", async () => {
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias } = deps(db);

  await assert.rejects(
    () => resolveWorkerHandoverRequestHandler(
      aceptacion({ profile: { name: "   " } }),
      dependencias
    ),
    (error) => error.code === "invalid-argument"
  );

  assert.equal(db.transferencias.size, 0);
  assert.equal(guardado(db).status, PENDING);
});

test("un pedido viejo sin fecha no se puede aceptar", async () => {
  // Los que se crearon antes de que la fecha fuera parte del pedido.
  const db = fakeDb({ docs: pedidoPendiente({ startDate: "" }) });
  const { deps: dependencias } = deps(db);

  await assert.rejects(
    () => resolveWorkerHandoverRequestHandler(aceptacion(), dependencias),
    (error) => error.code === "failed-precondition"
  );

  assert.equal(db.transferencias.size, 0);
});

test("rechazar no crea ninguna transferencia", async () => {
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias, llamadas } = deps(db);
  const resultado = await resolveWorkerHandoverRequestHandler(
    aceptacion({ approve: false, rejectReason: "Lo necesitamos aqui" }),
    dependencias
  );

  assert.equal(resultado.status, REJECTED);
  assert.equal(db.transferencias.size, 0);
  assert.deepEqual(llamadas.aplicadas, []);
  assert.equal(guardado(db).rejectReason, "Lo necesitamos aqui");
  assert.equal(guardado(db).transferRequestId, "");
});

test("solo responde la unidad que tiene al trabajador", async () => {
  // La que pidio no puede aprobarse su propio pedido.
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias } = deps(db);

  await assert.rejects(
    () => resolveWorkerHandoverRequestHandler(
      aceptacion({ workspaceId: "ws-urgencias" }),
      dependencias
    ),
    (error) => error.code === "permission-denied"
  );

  assert.equal(guardado(db).status, PENDING);
  assert.equal(db.transferencias.size, 0);
});

test("un pedido caducado ya no se puede responder", async () => {
  const db = fakeDb({
    docs: pedidoPendiente({ expiresAt: new Date(Date.now() - 1000) })
  });
  const { deps: dependencias } = deps(db);

  await assert.rejects(
    () => resolveWorkerHandoverRequestHandler(aceptacion(), dependencias),
    (error) => error.code === "failed-precondition"
  );
});

test("un pedido ya resuelto no se responde dos veces", async () => {
  const db = fakeDb({ docs: pedidoPendiente({ status: ACCEPTED }) });
  const { deps: dependencias } = deps(db);

  await assert.rejects(
    () => resolveWorkerHandoverRequestHandler(
      aceptacion({ approve: false }),
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
    () => resolveWorkerHandoverRequestHandler(aceptacion(), dependencias),
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

test("pedirlo de nuevo con otra fecha ACTUALIZA el pedido", async () => {
  // No es un pedido repetido: es el mismo corregido. Devolver el viejo tal
  // cual dejaba a la otra unidad respondiendo algo que ya nadie quiere, y a
  // quien pidio creyendo que pidio lo ultimo que eligio.
  const db = fakeDb();
  const { deps: dependencias } = deps(db);

  await requestWorkerHandoverHandler(peticion(PEDIDO_BASE), dependencias);

  const segundo = await requestWorkerHandoverHandler(
    peticion({
      ...PEDIDO_BASE,
      startDate: "2027-01-15",
      rotationType: "3turno",
      rotationFirstTurn: "larga2"
    }),
    dependencias
  );

  assert.equal(segundo.created, false);
  assert.equal(segundo.updated, true);

  const pedido = guardado(db);

  assert.equal(pedido.startDate, "2027-01-15");
  assert.equal(pedido.rotationType, "3turno");
  assert.equal(pedido.rotationFirstTurn, "larga2");
  assert.equal(db.guardados.size, 1, "sigue siendo un solo pedido");
});

test("pedirlo de nuevo con lo mismo no dice que cambio", async () => {
  const db = fakeDb();
  const { deps: dependencias } = deps(db);

  await requestWorkerHandoverHandler(peticion(PEDIDO_BASE), dependencias);

  const segundo = await requestWorkerHandoverHandler(
    peticion(PEDIDO_BASE),
    dependencias
  );

  assert.equal(segundo.updated, false);
});

// --- Lo que la otra unidad ya decidio no se puede reescribir ---
//
// Si alla ya cerraron su paso -perfil inactivo, con su ultimo dia trabajado-,
// pedir que empiece aqui ese dia o antes vaciaria un calendario que ellos ya
// validaron. Y no tienen como oponerse: aceptar el pedido lo aplica, con la
// fecha que viene adentro.

function depsConPerfilOrigen(db, perfil) {
  return deps(db, {
    findWorkerProfile: async () => perfil
  });
}

test("no se puede pedir que empiece aqui antes de su ultimo dia alla", async () => {
  const db = fakeDb();
  const { deps: dependencias } = depsConPerfilOrigen(db, {
    name: "Ana",
    rut: "17.816.632-8",
    active: false,
    unitExitDate: "2026-11-10"
  });

  await assert.rejects(
    () => requestWorkerHandoverHandler(
      peticion({ ...PEDIDO_BASE, startDate: "2026-11-03" }),
      dependencias
    ),
    (error) => error.code === "failed-precondition"
  );

  assert.equal(db.guardados.size, 0, "no queda pedido guardado");
});

test("tampoco el mismo dia: ese dia todavia es de la otra unidad", async () => {
  const db = fakeDb();
  const { deps: dependencias } = depsConPerfilOrigen(db, {
    rut: "17.816.632-8",
    active: false,
    unitExitDate: "2026-11-03"
  });

  await assert.rejects(
    () => requestWorkerHandoverHandler(
      peticion({ ...PEDIDO_BASE, startDate: "2026-11-03" }),
      dependencias
    ),
    (error) => error.code === "failed-precondition"
  );
});

test("desde el dia siguiente si se puede", async () => {
  const db = fakeDb();
  const { deps: dependencias } = depsConPerfilOrigen(db, {
    rut: "17.816.632-8",
    active: false,
    unitExitDate: "2026-11-02"
  });
  const resultado = await requestWorkerHandoverHandler(
    peticion({ ...PEDIDO_BASE, startDate: "2026-11-03" }),
    dependencias
  );

  assert.equal(resultado.created, true);
  assert.equal(guardado(db).startDate, "2026-11-03");
});

test("con el perfil activo alla no hay nada cerrado que respetar", async () => {
  // Es el traspaso normal: la fecha la decide quien pide, y al aceptar la otra
  // unidad vacia su calendario desde ahi. Su fecha de salida puede ser el
  // sobrante de una inactivacion anterior, y no manda.
  const db = fakeDb();
  const { deps: dependencias } = depsConPerfilOrigen(db, {
    rut: "17.816.632-8",
    active: true,
    unitExitDate: "2026-12-31"
  });
  const resultado = await requestWorkerHandoverHandler(
    peticion({ ...PEDIDO_BASE, startDate: "2026-11-03" }),
    dependencias
  );

  assert.equal(resultado.created, true);
});

test("si el perfil no esta alla, el pedido sigue su camino", async () => {
  // Que no aparezca no es razon para cortar: lo resuelve quien recibe el
  // pedido, que es quien sabe si todavia lo tiene.
  const db = fakeDb();
  const { deps: dependencias } = depsConPerfilOrigen(db, null);
  const resultado = await requestWorkerHandoverHandler(
    peticion(PEDIDO_BASE),
    dependencias
  );

  assert.equal(resultado.created, true);
});

test("corregir un pedido pendiente tambien respeta ese limite", async () => {
  // La correccion pasa por el mismo camino: si no, bastaba pedir bien primero
  // y corregir despues con una fecha anterior.
  const db = fakeDb();
  const { deps: dependencias } = depsConPerfilOrigen(db, {
    rut: "17.816.632-8",
    active: false,
    unitExitDate: "2026-11-02"
  });

  await requestWorkerHandoverHandler(peticion(PEDIDO_BASE), dependencias);

  await assert.rejects(
    () => requestWorkerHandoverHandler(
      peticion({ ...PEDIDO_BASE, startDate: "2026-10-20" }),
      dependencias
    ),
    (error) => error.code === "failed-precondition"
  );

  assert.equal(guardado(db).startDate, "2026-11-03", "sigue la fecha buena");
});

// --- La ultima palabra sobre la fecha la tiene quien entrega ---
//
// El pedido pudo enviarse antes de que esta unidad decidiera hasta que dia
// trabajaba aqui. Aceptar la fecha pedida vaciaria dias ya validados, y no hay
// vuelta atras: aceptar aplica el traspaso.

test("al aceptar se puede correr la fecha hacia adelante", async () => {
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias } = deps(db);
  const resultado = await resolveWorkerHandoverRequestHandler(
    aceptacion({ startDate: "2026-11-09" }),
    dependencias
  );

  assert.equal(resultado.startDate, "2026-11-09");

  const transferencia = db.transferencias.get("transfer-1");

  assert.equal(transferencia.startDate, "2026-11-09");
  // Y la rotativa arranca ahi: antes de ese dia la persona todavia no es suya.
  assert.equal(transferencia.targetRotation.start, "2026-11-09");
});

test("sin fecha elegida manda la pedida, como siempre", async () => {
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias } = deps(db);

  await resolveWorkerHandoverRequestHandler(aceptacion(), dependencias);

  assert.equal(db.transferencias.get("transfer-1").startDate, "2026-11-03");
});

test("no se puede adelantar: eso seria quitarle dias a la otra unidad", async () => {
  // Ellos ya no vuelven a responder -aceptar aplica el traspaso-, asi que
  // correrla hacia atras les sacaria dias sin que pudieran oponerse.
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias } = deps(db);

  await assert.rejects(
    () => resolveWorkerHandoverRequestHandler(
      aceptacion({ startDate: "2026-10-20" }),
      dependencias
    ),
    (error) => error.code === "failed-precondition"
  );

  assert.equal(db.transferencias.size, 0, "no se crea la transferencia");
  assert.equal(guardado(db).status, PENDING, "y el pedido sigue en pie");
});

test("una fecha con cualquier forma se rechaza", async () => {
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias } = deps(db);

  await assert.rejects(
    () => resolveWorkerHandoverRequestHandler(
      aceptacion({ startDate: "mañana" }),
      dependencias
    ),
    (error) => error.code === "invalid-argument"
  );
});

test("el pedido queda anotado con la fecha acordada y con la pedida", async () => {
  // La unidad que pidio ve en su tarjeta desde cuando lo recibe de verdad, sin
  // tener que deducirlo.
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias } = deps(db);

  await resolveWorkerHandoverRequestHandler(
    aceptacion({ startDate: "2026-11-09" }),
    dependencias
  );

  const pedido = guardado(db);

  assert.equal(pedido.startDate, "2026-11-09");
  assert.equal(pedido.requestedStartDate, "2026-11-03");
});

// --- Hallazgos de la auditoria (2026-10-14) ---

test("dos 'aceptar' a la vez crean UNA transferencia, no dos", async () => {
  // Dos pestañas, o dos supervisores de la misma unidad. Con las escrituras
  // sueltas, cada uno creaba su transferencia y al otro lado llegaban dos
  // perfiles de la misma persona.
  const db = fakeDb({ docs: pedidoPendiente() });
  const ids = ["transfer-1", "transfer-2"];
  const { deps: dependencias } = deps(db, {
    transferIdFactory: () => ids.shift()
  });

  const [uno, dos] = await Promise.all([
    resolveWorkerHandoverRequestHandler(aceptacion(), dependencias),
    resolveWorkerHandoverRequestHandler(aceptacion(), dependencias)
  ]);

  assert.equal(db.transferencias.size, 1);
  assert.equal(uno.transferRequestId, dos.transferRequestId);
  // Una de las dos no creo nada y lo dice.
  assert.deepEqual(
    [uno.created, dos.created].sort(),
    [false, true]
  );
});

test("aceptar dos veces seguidas tampoco duplica", async () => {
  // Aqui no es una carrera: el segundo llega con el pedido ya cerrado y se le
  // dice que ya se resolvio, en vez de crearle otra transferencia.
  const db = fakeDb({ docs: pedidoPendiente() });
  const ids = ["transfer-1", "transfer-2"];
  const { deps: dependencias, llamadas } = deps(db, {
    transferIdFactory: () => ids.shift()
  });

  await resolveWorkerHandoverRequestHandler(aceptacion(), dependencias);

  await assert.rejects(
    () => resolveWorkerHandoverRequestHandler(aceptacion(), dependencias),
    (error) => error.code === "failed-precondition"
  );

  assert.equal(db.transferencias.size, 1);
  // Y los efectos -inactivar el perfil, mudar el enlace- no se repiten.
  assert.equal(llamadas.aplicadas.length, 1);
});

test("si el cierre del pedido falla, no queda una transferencia suelta", async () => {
  // Antes eran dos escrituras: la transferencia quedaba viva y el pedido
  // pendiente, listo para aceptarse otra vez.
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias } = deps(db, {
    db: {
      ...db,
      runTransaction: async () => { throw new Error("sin red"); }
    }
  });

  await assert.rejects(
    () => resolveWorkerHandoverRequestHandler(aceptacion(), dependencias),
    /sin red/
  );

  assert.equal(db.transferencias.size, 0);
  assert.equal(guardado(db).status, PENDING);
});

test("no se puede traspasar a una persona distinta de la pedida", async () => {
  // El perfil lo arma el cliente: el RUT es lo unico que ata ese paquete al
  // pedido. Sin comprobarlo, aceptar podia mandar a otra persona -con sus
  // datos y sus saldos- a una unidad que habia pedido a esta.
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias } = deps(db);

  await assert.rejects(
    () => resolveWorkerHandoverRequestHandler(
      aceptacion({ profile: { name: "OTRA PERSONA", rut: "11.111.111-1" } }),
      dependencias
    ),
    (error) => error.code === "failed-precondition"
  );

  assert.equal(db.transferencias.size, 0);
  assert.equal(guardado(db).status, PENDING);
});

test("el RUT se compara normalizado, no con sus puntos", async () => {
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias } = deps(db);
  const resultado = await resolveWorkerHandoverRequestHandler(
    aceptacion({ profile: { name: "ALAN PLAZA", rut: "17.816.632-8" } }),
    dependencias
  );

  assert.equal(resultado.status, ACCEPTED);
});

test("y ese RUT tiene que seguir siendo de la unidad que acepta", async () => {
  // Lo comprueba el servidor contra los perfiles de origen, no la pantalla.
  const db = fakeDb({ docs: pedidoPendiente() });
  const { deps: dependencias } = deps(db, {
    findWorkerProfile: async () => null
  });

  await assert.rejects(
    () => resolveWorkerHandoverRequestHandler(aceptacion(), dependencias),
    (error) => error.code === "failed-precondition"
  );
});
