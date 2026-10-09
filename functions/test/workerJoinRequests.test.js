"use strict";

// Enrolarse por RUT. Lo que estas pruebas protegen no es que "funcione", sino
// las dos cosas que lo hacen seguro: que la busqueda no filtre mas de lo
// imprescindible, y que el servidor no se crea lo que afirma el cliente.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  cancelWorkerJoinRequestHandler,
  findWorkerInvitesByRutHandler,
  notifyWorkerJoinRequestHandler,
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

test("con una sola invitacion no se dice cual es la unidad", async () => {
  // Con una sola, pedir acceso no necesita que la persona elija nada, asi que
  // mandar el nombre seria regalar informacion a cambio de nada. Ocultarlo en
  // la pantalla no bastaria: quien mire el trafico lo veria igual.
  const resultado = await findWorkerInvitesByRutHandler(
    { data: { rut: "17.816.632-8" } },
    { db: fakeDb(UNIDADES), HttpsError }
  );

  assert.equal(resultado.count, 1);
  assert.deepEqual(resultado.unidades, []);

  const texto = JSON.stringify(resultado);
  assert.ok(!texto.includes("Imagenologia"), "no debe salir el nombre de la unidad");
  assert.ok(!texto.includes("ws-imagenologia"), "ni su id");
  assert.ok(!texto.includes("inv-secreto-123"), "ni el id de la invitacion");
  assert.ok(!texto.includes("ALAN"), "ni el nombre del perfil");
});

test("con varias invitaciones se siguen nombrando, por las app ya instaladas", async () => {
  // La app nueva ya no pregunta a que unidad entrar -se toma la invitacion mas
  // reciente-, pero las instaladas si: muestran este listado y mandan la unidad
  // elegida. Si dejara de venir, se quedarian con un selector vacio y sin
  // salida. Se puede quitar cuando ya nadie use una version con selector.
  const dosUnidades = [
    UNIDADES[0],
    {
      ...UNIDADES[1],
      invites: [
        {
          id: "inv-urgencias",
          data: { profileRut: "178166328", status: "pending", profileName: "ALAN PLAZA" }
        }
      ]
    }
  ];
  const resultado = await findWorkerInvitesByRutHandler(
    { data: { rut: "178166328" } },
    { db: fakeDb(dosUnidades), HttpsError }
  );

  assert.equal(resultado.count, 2);
  assert.deepEqual(resultado.unidades.map((u) => u.workspaceName), [
    "Imagenologia",
    "Urgencias"
  ]);
  // Aun aqui, el id de la invitacion sigue sin salir.
  assert.ok(!JSON.stringify(resultado).includes("inv-"), "no debe salir ningun id de invitacion");
});

test("una invitacion ya usada no cuenta", async () => {
  // Urgencias tiene una invitacion para ese RUT, pero esta aceptada: por eso el
  // resultado es una sola, no dos.
  const resultado = await findWorkerInvitesByRutHandler(
    { data: { rut: "178166328" } },
    { db: fakeDb(UNIDADES), HttpsError }
  );

  assert.equal(resultado.count, 1);
});

test("sin invitaciones no hay nada que contar", async () => {
  const resultado = await findWorkerInvitesByRutHandler(
    { data: { rut: "99999999" } },
    { db: fakeDb(UNIDADES), HttpsError }
  );

  assert.equal(resultado.count, 0);
  assert.deepEqual(resultado.unidades, []);
});

test("sin unidad, pedir acceso resuelve la unica invitacion", async () => {
  // Es el caso de una sola: la persona nunca supo cual era, asi que no puede
  // mandarla. La resuelve el servidor.
  const db = fakeDb(UNIDADES);
  const resultado = await requestWorkerJoinHandler(
    { auth: { uid: "uid-1" }, data: { rut: "178166328" } },
    { db, HttpsError }
  );

  assert.equal(resultado.status, "pending");
  assert.equal(db.escrituras[0].data.workspaceId, "ws-imagenologia");
  assert.equal(db.escrituras[0].data.inviteId, "inv-secreto-123");
});

// Dos unidades con invitacion pendiente para el mismo RUT, con fechas.
function conDosInvitaciones(fechaImagenologia, fechaUrgencias) {
  return [
    {
      ...UNIDADES[0],
      invites: [
        {
          id: "inv-imagenologia",
          data: {
            profileRut: "178166328",
            status: "pending",
            profileName: "ALAN PLAZA",
            createdAt: fechaImagenologia
          }
        }
      ]
    },
    {
      ...UNIDADES[1],
      invites: [
        {
          id: "inv-urgencias",
          data: {
            profileRut: "178166328",
            status: "pending",
            profileName: "ALAN PLAZA",
            createdAt: fechaUrgencias
          }
        }
      ]
    }
  ];
}

test("con varias invitaciones, pedir acceso toma la mas reciente", async () => {
  // Es la de donde lo acaban de invitar. Quien trabajo en varios sitios puede
  // arrastrar invitaciones viejas que nunca uso, y antes esto fallaba
  // pidiendole elegir entre nombres de unidades que ya no son suyas.
  const db = fakeDb(conDosInvitaciones(
    "2026-01-10T00:00:00.000Z",
    "2026-03-20T00:00:00.000Z"
  ));
  const resultado = await requestWorkerJoinHandler(
    { auth: { uid: "uid-1" }, data: { rut: "178166328" } },
    { db, HttpsError }
  );

  assert.equal(resultado.status, "pending");
  assert.equal(db.escrituras[0].data.workspaceId, "ws-urgencias");
  assert.equal(db.escrituras[0].data.inviteId, "inv-urgencias");
});

test("la mas reciente no depende del orden en que llegan las unidades", async () => {
  const db = fakeDb(conDosInvitaciones(
    "2026-05-01T00:00:00.000Z",
    "2026-02-01T00:00:00.000Z"
  ));

  await requestWorkerJoinHandler(
    { auth: { uid: "uid-1" }, data: { rut: "178166328" } },
    { db, HttpsError }
  );

  assert.equal(db.escrituras[0].data.workspaceId, "ws-imagenologia");
});

test("dos invitaciones del mismo instante eligen siempre la misma", async () => {
  // Sin desempate, el resultado quedaria a merced del orden en que Firestore
  // devolvio los documentos: a veces una unidad y a veces la otra.
  const misma = "2026-04-04T00:00:00.000Z";
  const elegidas = [];

  for (const unidades of [
    conDosInvitaciones(misma, misma),
    [...conDosInvitaciones(misma, misma)].reverse()
  ]) {
    const db = fakeDb(unidades);

    await requestWorkerJoinHandler(
      { auth: { uid: "uid-1" }, data: { rut: "178166328" } },
      { db, HttpsError }
    );

    elegidas.push(db.escrituras[0].data.inviteId);
  }

  assert.equal(elegidas[0], elegidas[1]);
});

test("una invitacion sin fecha no le gana a una fechada", async () => {
  // Las invitaciones viejas, de antes de que se guardara createdAt, no deben
  // ganarle a la que acaban de enviar.
  const db = fakeDb(conDosInvitaciones(undefined, "2026-02-01T00:00:00.000Z"));

  await requestWorkerJoinHandler(
    { auth: { uid: "uid-1" }, data: { rut: "178166328" } },
    { db, HttpsError }
  );

  assert.equal(db.escrituras[0].data.workspaceId, "ws-urgencias");
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

test("cancelar libera la solicitud propia para poder reintentar", async () => {
  // El caso real: un RUT mal escrito que cae en el de otro trabajador con
  // invitacion pendiente. La solicitud se fue al supervisor equivocado y la
  // persona quedaria esperando para siempre.
  const db = fakeDb(unidadConSolicitud({
    uid: "uid-1",
    status: "pending",
    expiresAt: new Date(Date.now() + 9e5)
  }));

  const resultado = await cancelWorkerJoinRequestHandler(
    { auth: { uid: "uid-1" }, data: { rut: "178166328" } },
    { db, HttpsError }
  );

  assert.equal(resultado.cancelled, 1);
  assert.equal(db.escrituras[0].data.status, "cancelled");
});

test("nadie cancela la solicitud de otro", async () => {
  // Sin esto, cualquiera dejaria a un companero esperando indefinidamente.
  const db = fakeDb(unidadConSolicitud({
    uid: "uid-ajeno",
    status: "pending",
    expiresAt: new Date(Date.now() + 9e5)
  }));

  const resultado = await cancelWorkerJoinRequestHandler(
    { auth: { uid: "uid-1" }, data: { rut: "178166328" } },
    { db, HttpsError }
  );

  assert.equal(resultado.cancelled, 0);
  assert.equal(db.escrituras.length, 0);
});

test("una solicitud ya resuelta no se cancela", async () => {
  const db = fakeDb(unidadConSolicitud({
    uid: "uid-1",
    status: "approved",
    expiresAt: new Date(Date.now() + 9e5)
  }));

  const resultado = await cancelWorkerJoinRequestHandler(
    { auth: { uid: "uid-1" }, data: { rut: "178166328" } },
    { db, HttpsError }
  );

  assert.equal(resultado.cancelled, 0);
});

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

// --- El aviso al supervisor ---

function fakeMembersDb(miembros) {
  return {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          get: async () => ({
            docs: miembros.map((m) => ({ id: m.uid, data: () => m.data }))
          })
        })
      })
    })
  };
}

function eventoSolicitud(data) {
  return {
    params: { workspaceId: "ws-imagenologia", requestId: "req-1" },
    data: { data: () => data }
  };
}

const PENDIENTE = {
  status: "pending",
  profileName: "ALAN PLAZA",
  rut: "178166328",
  deviceLabel: "Samsung SM-A556E"
};

test("solo se avisa a quien puede aprobar", async () => {
  // Avisarle a quien no puede resolverla seria ruido, y ademas filtraria el
  // nombre y el RUT a gente que no tiene por que verlos.
  const enviados = [];

  await notifyWorkerJoinRequestHandler(eventoSolicitud(PENDIENTE), {
    db: fakeMembersDb([
      { uid: "uid-jefe", data: { role: "owner" } },
      { uid: "uid-miron", data: { role: "member", permissions: {} } }
    ]),
    canManageProfiles: (member) => member.role === "owner",
    getUserEmail: async (uid) => `${uid}@turnoplus.cl`,
    sendEmail: async (mensaje) => { enviados.push(mensaje); },
    logger: { warn() {} }
  });

  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].to, "uid-jefe@turnoplus.cl");
  assert.match(enviados[0].subject, /ALAN PLAZA/);
  assert.match(enviados[0].text, /Samsung SM-A556E/);
  assert.match(enviados[0].text, /7 dias/);
});

test("sin correo conocido no se intenta enviar", async () => {
  const enviados = [];

  await notifyWorkerJoinRequestHandler(eventoSolicitud(PENDIENTE), {
    db: fakeMembersDb([{ uid: "uid-jefe", data: { role: "owner" } }]),
    canManageProfiles: () => true,
    getUserEmail: async () => "",
    sendEmail: async (mensaje) => { enviados.push(mensaje); },
    logger: { warn() {} }
  });

  assert.equal(enviados.length, 0);
});

test("un fallo de envio no detiene al resto", async () => {
  // Un correo rebotado no deberia dejar sin aviso a los demas supervisores.
  const enviados = [];
  const avisos = [];

  await notifyWorkerJoinRequestHandler(eventoSolicitud(PENDIENTE), {
    db: fakeMembersDb([
      { uid: "uid-a", data: { role: "owner" } },
      { uid: "uid-b", data: { role: "owner" } }
    ]),
    canManageProfiles: () => true,
    getUserEmail: async (uid) => `${uid}@turnoplus.cl`,
    sendEmail: async (mensaje) => {
      if (mensaje.to.startsWith("uid-a")) throw new Error("rebotado");
      enviados.push(mensaje);
    },
    logger: { warn: (...args) => avisos.push(args) }
  });

  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].to, "uid-b@turnoplus.cl");
  assert.equal(avisos.length, 1);
});

test("una solicitud que no nace pendiente no avisa", async () => {
  const enviados = [];

  await notifyWorkerJoinRequestHandler(
    eventoSolicitud({ ...PENDIENTE, status: "approved" }),
    {
      db: fakeMembersDb([{ uid: "uid-jefe", data: { role: "owner" } }]),
      canManageProfiles: () => true,
      getUserEmail: async () => "jefe@turnoplus.cl",
      sendEmail: async (mensaje) => { enviados.push(mensaje); },
      logger: { warn() {} }
    }
  );

  assert.equal(enviados.length, 0);
});
