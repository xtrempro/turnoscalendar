"use strict";

// Enrolarse por RUT. Lo que estas pruebas protegen no es que "funcione", sino
// las dos cosas que lo hacen seguro: que la busqueda no filtre mas de lo
// imprescindible, y que el servidor no se crea lo que afirma el cliente.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  findWorkerInvitesByRutHandler,
  requestWorkerJoinHandler,
  resolveWorkerJoinRequestHandler,
  _private
} = require("../workerJoinRequests");

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Doble minimo de Firestore: lo justo para recorrer unidades, leer sus
// invitaciones y manejar la coleccion de solicitudes.
function fakeDb(unidades) {
  const escrituras = [];

  function coleccionInvitaciones(unidad) {
    return {
      where(campo, _op, valor) {
        const docs = (unidad.invites || [])
          .filter((item) => item.data[campo] === valor)
          .map((item) => ({ id: item.id, data: () => item.data }));

        return { get: async () => ({ docs }) };
      }
    };
  }

  function coleccionSolicitudes(unidad) {
    return {
      where(campo, _op, valor) {
        const docs = (unidad.requests || [])
          .filter((item) => item.data[campo] === valor)
          .map((item) => ({ id: item.id, data: () => item.data }));

        return { get: async () => ({ docs }) };
      },
      doc(id = `req-${escrituras.length + 1}`) {
        return {
          id,
          get: async () => {
            const encontrado = (unidad.requests || []).find((item) => item.id === id);

            return {
              exists: Boolean(encontrado),
              data: () => encontrado?.data
            };
          },
          set: async (data, options) => {
            escrituras.push({ id, data, options });
          }
        };
      }
    };
  }

  function docUnidad(unidad) {
    return {
      id: unidad.id,
      ref: {
        collection: (nombre) =>
          nombre === "workerAppInvites"
            ? coleccionInvitaciones(unidad)
            : coleccionSolicitudes(unidad)
      },
      data: () => unidad.data || {},
      collection: (nombre) =>
        nombre === "workerAppInvites"
          ? coleccionInvitaciones(unidad)
          : coleccionSolicitudes(unidad)
    };
  }

  return {
    escrituras,
    collection(nombre) {
      if (nombre !== "workspaces") throw new Error(`coleccion inesperada: ${nombre}`);

      return {
        limit: () => ({
          get: async () => ({ docs: unidades.map(docUnidad) })
        }),
        doc: (id) => {
          const unidad = unidades.find((item) => item.id === id) || { id, requests: [] };

          return docUnidad(unidad).ref;
        }
      };
    }
  };
}

const UNIDADES = [
  {
    id: "ws-imagenologia",
    data: { name: "Imagenologia" },
    invites: [
      {
        id: "inv-secreto-123",
        data: { profileRut: "178166328", status: "pending", profileName: "ALAN PLAZA" }
      }
    ],
    requests: []
  },
  {
    id: "ws-urgencias",
    data: { name: "Urgencias" },
    invites: [
      {
        id: "inv-usada",
        data: { profileRut: "178166328", status: "accepted", profileName: "ALAN PLAZA" }
      }
    ],
    requests: []
  }
];

test("el RUT se normaliza antes de comparar", () => {
  assert.equal(_private.normalizeRut("17.816.632-8"), "178166328");
  assert.equal(_private.normalizeRut("17816632-k"), "17816632K");
});

test("la busqueda devuelve la unidad, y nada mas", async () => {
  // Esto es lo importante: con el RUT basta para saber DONDE te invitaron,
  // porque pueden ser varias unidades y hay que poder elegir. Pero el id de la
  // invitacion es el secreto del camino por correo, y el nombre del perfil es
  // dato personal: ninguno de los dos sale de aqui.
  const resultado = await findWorkerInvitesByRutHandler(
    { data: { rut: "17.816.632-8" } },
    { db: fakeDb(UNIDADES), HttpsError }
  );

  assert.deepEqual(resultado.unidades, [
    { workspaceId: "ws-imagenologia", workspaceName: "Imagenologia" }
  ]);

  const texto = JSON.stringify(resultado);
  assert.ok(!texto.includes("inv-secreto-123"), "no debe salir el id de la invitacion");
  assert.ok(!texto.includes("ALAN"), "no debe salir el nombre del perfil");
});

test("una invitacion ya usada no aparece", async () => {
  // Urgencias tiene una invitacion para ese RUT, pero esta aceptada.
  const resultado = await findWorkerInvitesByRutHandler(
    { data: { rut: "178166328" } },
    { db: fakeDb(UNIDADES), HttpsError }
  );

  assert.equal(resultado.unidades.length, 1);
  assert.equal(resultado.unidades[0].workspaceId, "ws-imagenologia");
});

test("un RUT incompleto no dispara la busqueda", async () => {
  await assert.rejects(
    () => findWorkerInvitesByRutHandler({ data: { rut: "123" } }, { db: fakeDb([]), HttpsError }),
    (error) => error.code === "invalid-argument"
  );
});

test("no se puede pedir acceso a una unidad que no te invito", async () => {
  // El cliente manda la unidad, asi que el servidor vuelve a buscar la
  // invitacion. Sin esto, cualquiera pediria acceso a donde quisiera y al
  // supervisor le llegaria una solicitud con pinta de legitima.
  await assert.rejects(
    () => requestWorkerJoinHandler(
      {
        auth: { uid: "uid-1" },
        data: { rut: "178166328", workspaceId: "ws-urgencias" }
      },
      { db: fakeDb(UNIDADES), HttpsError }
    ),
    (error) => error.code === "permission-denied"
  );
});

test("pedir acceso deja la solicitud pendiente con su caducidad", async () => {
  const db = fakeDb(UNIDADES);
  const resultado = await requestWorkerJoinHandler(
    {
      auth: { uid: "uid-1" },
      data: {
        rut: "17.816.632-8",
        workspaceId: "ws-imagenologia",
        deviceLabel: "Samsung SM-A556E"
      }
    },
    { db, HttpsError }
  );

  assert.equal(resultado.status, "pending");
  assert.equal(resultado.reused, false);

  const escrita = db.escrituras[0].data;
  assert.equal(escrita.uid, "uid-1");
  assert.equal(escrita.inviteId, "inv-secreto-123");
  assert.equal(escrita.deviceLabel, "Samsung SM-A556E");

  const dias = (escrita.expiresAt - escrita.createdAt) / (24 * 60 * 60 * 1000);
  assert.equal(Math.round(dias), 7);
});

test("volver a pedirlo reusa la solicitud viva en vez de duplicarla", async () => {
  const conPendiente = [
    {
      ...UNIDADES[0],
      requests: [
        {
          id: "req-viva",
          data: {
            uid: "uid-1",
            status: "pending",
            expiresAt: new Date(Date.now() + 9e5)
          }
        }
      ]
    }
  ];
  const db = fakeDb(conPendiente);
  const resultado = await requestWorkerJoinHandler(
    {
      auth: { uid: "uid-1" },
      data: { rut: "178166328", workspaceId: "ws-imagenologia" }
    },
    { db, HttpsError }
  );

  assert.deepEqual(resultado, { requestId: "req-viva", status: "pending", reused: true });
  assert.equal(db.escrituras.length, 0, "no debe escribir una solicitud nueva");
});

function unidadConSolicitud(data) {
  return [{ ...UNIDADES[0], requests: [{ id: "req-1", data }] }];
}

test("aprobar enlaza por el mismo camino que la invitacion por correo", async () => {
  const llamadas = [];
  const db = fakeDb(unidadConSolicitud({
    uid: "uid-trabajador",
    inviteId: "inv-secreto-123",
    status: "pending",
    expiresAt: new Date(Date.now() + 9e5)
  }));

  const resultado = await resolveWorkerJoinRequestHandler(
    {
      auth: { uid: "uid-supervisor", token: {} },
      data: { workspaceId: "ws-imagenologia", requestId: "req-1", approve: true }
    },
    {
      db,
      HttpsError,
      requireProfileManager: async () => ({ role: "owner" }),
      acceptInvite: async (args) => { llamadas.push(args); }
    }
  );

  assert.equal(resultado.status, "approved");
  assert.deepEqual(llamadas, [{
    uid: "uid-trabajador",
    workspaceId: "ws-imagenologia",
    inviteId: "inv-secreto-123",
    // La prueba es la aprobacion, no el correo: ese camino puede exigir uno
    // verificado cuando se encienda la invitacion sin contrasena.
    approvedBySupervisor: true
  }]);
});

test("una solicitud caducada ya no enlaza a nadie", async () => {
  const llamadas = [];
  const db = fakeDb(unidadConSolicitud({
    uid: "uid-trabajador",
    inviteId: "inv-secreto-123",
    status: "pending",
    expiresAt: new Date(Date.now() - 1000)
  }));

  await assert.rejects(
    () => resolveWorkerJoinRequestHandler(
      {
        auth: { uid: "uid-supervisor", token: {} },
        data: { workspaceId: "ws-imagenologia", requestId: "req-1", approve: true }
      },
      {
        db,
        HttpsError,
        requireProfileManager: async () => ({ role: "owner" }),
        acceptInvite: async (args) => { llamadas.push(args); }
      }
    ),
    (error) => error.code === "failed-precondition"
  );

  assert.equal(llamadas.length, 0, "no debe enlazar");
});

test("rechazar no enlaza y deja constancia de quien decidio", async () => {
  const llamadas = [];
  const db = fakeDb(unidadConSolicitud({
    uid: "uid-trabajador",
    inviteId: "inv-secreto-123",
    status: "pending",
    expiresAt: new Date(Date.now() + 9e5)
  }));

  const resultado = await resolveWorkerJoinRequestHandler(
    {
      auth: { uid: "uid-supervisor", token: {} },
      data: { workspaceId: "ws-imagenologia", requestId: "req-1", approve: false }
    },
    {
      db,
      HttpsError,
      requireProfileManager: async () => ({ role: "owner" }),
      acceptInvite: async (args) => { llamadas.push(args); }
    }
  );

  assert.equal(resultado.status, "rejected");
  assert.equal(llamadas.length, 0);
  assert.equal(db.escrituras[0].data.resolvedBy, "uid-supervisor");
});

test("sin permiso de perfiles no se resuelve nada", async () => {
  const llamadas = [];
  const db = fakeDb(unidadConSolicitud({
    uid: "uid-trabajador",
    inviteId: "inv-secreto-123",
    status: "pending",
    expiresAt: new Date(Date.now() + 9e5)
  }));

  await assert.rejects(
    () => resolveWorkerJoinRequestHandler(
      {
        auth: { uid: "uid-curioso", token: {} },
        data: { workspaceId: "ws-imagenologia", requestId: "req-1", approve: true }
      },
      {
        db,
        HttpsError,
        requireProfileManager: async () => {
          throw new HttpsError("permission-denied", "No puedes administrar perfiles.");
        },
        acceptInvite: async (args) => { llamadas.push(args); }
      }
    ),
    (error) => error.code === "permission-denied"
  );

  assert.equal(llamadas.length, 0);
});
