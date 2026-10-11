"use strict";

// Un trabajador se enlazo en otra unidad: soltarlo de la anterior y avisarle.
//
// Lo que estas pruebas protegen: que SUELTE el enlace viejo -si no, su
// aplicacion sigue mostrando una unidad donde ya no trabaja-, que deje la
// tarjeta con la que su supervisor anterior puede desactivar el perfil, que NO
// se dispare en una transferencia -donde ese camino ya hace lo suyo- y que no
// se llame a si mismo, porque soltar el enlace escribe en la misma ruta que lo
// despierta.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DISMISSED,
  DONE,
  NOTICES_COLLECTION,
  PENDING,
  notifyWorkerUnitChangeHandler,
  reportWorkerEnteredHereHandler,
  resolveWorkerUnitChangeNoticeHandler,
  _private
} = require("../workerUnitChangeNotice");

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fakeDb({ links = {}, members = {}, notices = {} } = {}) {
  const userLinks = new Map();
  const borrados = [];
  const escrituras = new Map(Object.entries(notices));

  for (const [uid, porUnidad] of Object.entries(links)) {
    for (const [workspaceId, data] of Object.entries(porUnidad)) {
      userLinks.set(`users/${uid}/workerLinks/${workspaceId}`, data);
    }
  }

  function ref(path) {
    return {
      path,
      get: async () => {
        const data = userLinks.get(path) || escrituras.get(path);

        return { exists: Boolean(data), data: () => data || {} };
      },
      set: async (data, options) => {
        const previo = options?.merge ? (escrituras.get(path) || {}) : {};

        escrituras.set(path, { ...previo, ...data });
      }
    };
  }

  const db = {
    escrituras,
    borrados,
    collection: (nombre) => ({
      doc: (id) => {
        if (nombre === "users") {
          return {
            collection: (sub) => ({
              doc: (wsId) => ref(`users/${id}/${sub}/${wsId}`),
              get: async () => ({
                docs: [...userLinks.entries()]
                  .filter(([path]) => path.startsWith(`users/${id}/workerLinks/`))
                  .map(([path, data]) => ({
                    id: path.split("/").pop(),
                    data: () => data
                  }))
              })
            })
          };
        }

        if (nombre === "workspaces") {
          return {
            collection: (sub) => ({
              doc: (docId) => ref(`workspaces/${id}/${sub}/${docId}`),
              get: async () => ({
                docs: (members[id] || []).map((miembro) => ({
                  id: miembro.uid,
                  data: () => miembro
                }))
              })
            })
          };
        }

        assert.equal(nombre, NOTICES_COLLECTION);

        return ref(`${NOTICES_COLLECTION}/${id}`);
      },
      // Lo usa la deduplicacion: una tarjeta por persona y unidad.
      where: (campo, _op, valor) => ({
        get: async () => ({
          docs: [...escrituras.entries()]
            .filter(([clave, data]) =>
              clave.startsWith(`${NOTICES_COLLECTION}/`) && data[campo] === valor
            )
            .map(([clave, data]) => ({
              id: clave.split("/").pop(),
              data: () => data
            }))
        })
      })
    }),
    batch: () => {
      const pendientes = [];

      return {
        set: (referencia, data, options) => {
          pendientes.push(() => referencia.set(data, options));
        },
        delete: (referencia) => {
          pendientes.push(() => {
            borrados.push(referencia.path);
            escrituras.delete(referencia.path);
          });
        },
        commit: async () => {
          for (const tarea of pendientes) await tarea();
        }
      };
    }
  };

  return db;
}

function deps(db, enviados, overrides = {}) {
  return {
    db,
    canManageProfiles: (miembro) =>
      miembro.role === "owner" || miembro.role === "admin",
    getUserEmail: async (uid) => `${uid}@correo.cl`,
    sendEmail: async (mensaje) => enviados.push(mensaje),
    serverTimestamp: () => "AHORA",
    idFactory: () => "aviso-1",
    logger: { warn: () => {} },
    ...overrides
  };
}

function evento(antes, despues, params = { uid: "uid-1", workspaceId: "ws-nueva" }) {
  return {
    params,
    data: {
      before: { data: () => antes },
      after: { data: () => despues }
    }
  };
}

const ACTIVO_NUEVO = { workspaceId: "ws-nueva", status: "active" };

const MIEMBROS = {
  "ws-vieja": [
    { uid: "jefa", role: "owner" },
    { uid: "mirona", role: "viewer" }
  ]
};

function conUnidadAnterior(extra = {}) {
  return {
    links: {
      "uid-1": {
        "ws-vieja": {
          workspaceId: "ws-vieja",
          workspaceName: "UCI",
          status: "active",
          profileName: "ALAN PLAZA",
          profileRut: "17816632-8",
          ...extra
        },
        "ws-nueva": ACTIVO_NUEVO
      }
    },
    members: MIEMBROS
  };
}

test("suelta el enlace de la unidad anterior", async () => {
  // Sin esto, su aplicacion sigue mostrando el calendario de una unidad en la
  // que ya no trabaja.
  const db = fakeDb(conUnidadAnterior());
  const enviados = [];

  await notifyWorkerUnitChangeHandler(
    evento(null, ACTIVO_NUEVO),
    deps(db, enviados)
  );

  assert.ok(
    db.borrados.includes("workspaces/ws-vieja/workerLinks/uid-1"),
    "el enlace del lado de la unidad se borra"
  );

  const marcador = db.escrituras.get("users/uid-1/workerLinks/ws-vieja");

  assert.equal(marcador.status, "unlinked");
  assert.equal(marcador.unlinkedBy, "worker_moved_unit");
});

test("deja de ofrecerlo para cubrir turnos de esa unidad", async () => {
  const db = fakeDb(conUnidadAnterior());

  await notifyWorkerUnitChangeHandler(evento(null, ACTIVO_NUEVO), deps(db, []));

  assert.ok(
    db.borrados.includes("workspaces/ws-vieja/workerSwapCandidates/uid-1")
  );
});

test("deja una tarjeta pendiente para el supervisor anterior", async () => {
  const db = fakeDb(conUnidadAnterior());

  await notifyWorkerUnitChangeHandler(evento(null, ACTIVO_NUEVO), deps(db, []));

  const aviso = db.escrituras.get(`${NOTICES_COLLECTION}/aviso-1`);

  assert.equal(aviso.workspaceId, "ws-vieja");
  assert.equal(aviso.profileName, "ALAN PLAZA");
  assert.equal(aviso.status, PENDING);
});

test("ni la tarjeta ni el correo dicen a que unidad se fue", async () => {
  // Para decidir si inactiva el perfil no hace falta, y esta unidad no tiene
  // por que enterarse de donde trabaja ahora.
  const db = fakeDb({
    links: {
      "uid-1": {
        "ws-vieja": {
          workspaceId: "ws-vieja",
          status: "active",
          profileName: "ALAN"
        },
        "ws-nueva": { ...ACTIVO_NUEVO, workspaceName: "Urgencias" }
      }
    },
    members: MIEMBROS
  });
  const enviados = [];

  await notifyWorkerUnitChangeHandler(
    evento(null, { ...ACTIVO_NUEVO, workspaceName: "Urgencias" }),
    deps(db, enviados)
  );

  const texto = JSON.stringify([
    db.escrituras.get(`${NOTICES_COLLECTION}/aviso-1`),
    enviados
  ]);

  assert.ok(!texto.includes("Urgencias"), "no debe nombrar la unidad nueva");
  assert.ok(!texto.includes("ws-nueva"), "ni su id");
});

test("avisa por correo solo a quien podria desactivar el perfil", async () => {
  const db = fakeDb(conUnidadAnterior());
  const enviados = [];

  await notifyWorkerUnitChangeHandler(
    evento(null, ACTIVO_NUEVO),
    deps(db, enviados)
  );

  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].to, "jefa@correo.cl");
  assert.ok(enviados[0].text.includes("Solicitudes"));
});

test("una transferencia no suelta ni avisa", async () => {
  // El enlace viejo queda en "transferred" en el mismo lote, y ese camino ya
  // vacia el calendario e inactiva el perfil.
  const db = fakeDb({
    links: {
      "uid-1": {
        "ws-vieja": {
          workspaceId: "ws-vieja",
          status: "transferred",
          profileName: "ALAN PLAZA"
        },
        "ws-nueva": ACTIVO_NUEVO
      }
    },
    members: MIEMBROS
  });
  const enviados = [];

  await notifyWorkerUnitChangeHandler(
    evento(null, ACTIVO_NUEVO),
    deps(db, enviados)
  );

  assert.deepEqual(enviados, []);
  assert.deepEqual(db.borrados, []);
  assert.equal(db.escrituras.size, 0);
});

test("un enlace que nace de una transferencia tampoco", async () => {
  const db = fakeDb(conUnidadAnterior());
  const enviados = [];

  await notifyWorkerUnitChangeHandler(
    evento(null, { ...ACTIVO_NUEVO, transferredFromWorkspaceId: "ws-vieja" }),
    deps(db, enviados)
  );

  assert.deepEqual(enviados, []);
  assert.deepEqual(db.borrados, []);
});

test("soltar el enlace no se dispara a si mismo", async () => {
  // Soltarlo escribe en users/{uid}/workerLinks/{ws}, que es la misma ruta que
  // despierta a esta funcion. Lo que corta el ciclo es que el marcador no
  // queda activo.
  assert.equal(_private.linkIsActive({ status: "unlinked" }), false);

  const db = fakeDb(conUnidadAnterior());
  const enviados = [];

  await notifyWorkerUnitChangeHandler(
    evento(null, { workspaceId: "ws-vieja", status: "unlinked" }),
    deps(db, enviados)
  );

  assert.deepEqual(enviados, []);
  assert.deepEqual(db.borrados, []);
});

test("tocar un enlace que ya estaba activo no vuelve a avisar", async () => {
  const db = fakeDb(conUnidadAnterior());
  const enviados = [];

  await notifyWorkerUnitChangeHandler(
    evento(ACTIVO_NUEVO, { ...ACTIVO_NUEVO, updatedAt: "mas tarde" }),
    deps(db, enviados)
  );

  assert.deepEqual(enviados, []);
  assert.deepEqual(db.borrados, []);
});

test("el primer enlace de alguien no suelta nada", async () => {
  const db = fakeDb({
    links: { "uid-1": { "ws-nueva": ACTIVO_NUEVO } },
    members: MIEMBROS
  });
  const enviados = [];

  await notifyWorkerUnitChangeHandler(
    evento(null, ACTIVO_NUEVO),
    deps(db, enviados)
  );

  assert.deepEqual(enviados, []);
  assert.deepEqual(db.borrados, []);
});

test("un enlace ya desvinculado no cuenta como unidad anterior", async () => {
  const db = fakeDb({
    links: {
      "uid-1": {
        "ws-vieja": { workspaceId: "ws-vieja", status: "unlinked", profileName: "ALAN" },
        "ws-nueva": ACTIVO_NUEVO
      }
    },
    members: MIEMBROS
  });
  const enviados = [];

  await notifyWorkerUnitChangeHandler(
    evento(null, ACTIVO_NUEVO),
    deps(db, enviados)
  );

  assert.deepEqual(enviados, []);
  assert.deepEqual(db.borrados, []);
});

test("si una unidad falla, las demas igual se sueltan", async () => {
  const db = fakeDb({
    links: {
      "uid-1": {
        "ws-una": { workspaceId: "ws-una", status: "active", profileName: "ALAN" },
        "ws-otra": { workspaceId: "ws-otra", status: "active", profileName: "ALAN" },
        "ws-nueva": ACTIVO_NUEVO
      }
    },
    members: {
      "ws-una": [{ uid: "jefa-una", role: "owner" }],
      "ws-otra": [{ uid: "jefa-otra", role: "owner" }]
    }
  });
  const enviados = [];
  const dependencias = deps(db, enviados, {
    idFactory: () => `aviso-${db.escrituras.size + 1}`
  });

  dependencias.sendEmail = async (mensaje) => {
    if (mensaje.to === "jefa-una@correo.cl") throw new Error("rebotado");

    enviados.push(mensaje);
  };

  await notifyWorkerUnitChangeHandler(evento(null, ACTIVO_NUEVO), dependencias);

  assert.deepEqual(enviados.map((item) => item.to), ["jefa-otra@correo.cl"]);
  // Y las dos quedaron sueltas, aunque el correo de una fallara.
  assert.ok(db.borrados.includes("workspaces/ws-una/workerLinks/uid-1"));
  assert.ok(db.borrados.includes("workspaces/ws-otra/workerLinks/uid-1"));
});

/* ========================================================= */

function conAviso(extra = {}) {
  return {
    notices: {
      [`${NOTICES_COLLECTION}/aviso-1`]: {
        workspaceId: "ws-vieja",
        profileName: "ALAN PLAZA",
        status: PENDING,
        ...extra
      }
    }
  };
}

function respuesta(data, uid = "jefa") {
  return { auth: { uid, token: {} }, data };
}

const RESOLVE_DEPS = {
  HttpsError,
  requireProfileManager: async () => ({ role: "owner" })
};

test("desactivar cierra el aviso", async () => {
  const db = fakeDb(conAviso());
  const resultado = await resolveWorkerUnitChangeNoticeHandler(
    respuesta({ workspaceId: "ws-vieja", noticeId: "aviso-1", deactivated: true }),
    { ...RESOLVE_DEPS, db }
  );

  assert.equal(resultado.status, DONE);
  assert.equal(
    db.escrituras.get(`${NOTICES_COLLECTION}/aviso-1`).status,
    DONE
  );
});

test("dejarlo activo tambien cierra el aviso", async () => {
  // El supervisor puede saber que vuelve: lo que no corresponde es que la
  // tarjeta se quede ahi para siempre.
  const db = fakeDb(conAviso());
  const resultado = await resolveWorkerUnitChangeNoticeHandler(
    respuesta({ workspaceId: "ws-vieja", noticeId: "aviso-1", deactivated: false }),
    { ...RESOLVE_DEPS, db }
  );

  assert.equal(resultado.status, DISMISSED);
});

test("el aviso de otra unidad no se responde", async () => {
  const db = fakeDb(conAviso());

  await assert.rejects(
    () => resolveWorkerUnitChangeNoticeHandler(
      respuesta({ workspaceId: "ws-ajena", noticeId: "aviso-1", deactivated: true }),
      { ...RESOLVE_DEPS, db }
    ),
    (error) => error.code === "permission-denied"
  );
});

test("un aviso ya resuelto no se responde dos veces", async () => {
  const db = fakeDb(conAviso({ status: DONE }));

  await assert.rejects(
    () => resolveWorkerUnitChangeNoticeHandler(
      respuesta({ workspaceId: "ws-vieja", noticeId: "aviso-1", deactivated: true }),
      { ...RESOLVE_DEPS, db }
    ),
    (error) => error.code === "failed-precondition"
  );
});

test("sin permiso para administrar perfiles no se resuelve", async () => {
  const db = fakeDb(conAviso());

  await assert.rejects(
    () => resolveWorkerUnitChangeNoticeHandler(
      respuesta({ workspaceId: "ws-vieja", noticeId: "aviso-1", deactivated: true }),
      {
        ...RESOLVE_DEPS,
        db,
        requireProfileManager: async () => {
          throw new HttpsError("permission-denied", "No puedes.");
        }
      }
    ),
    (error) => error.code === "permission-denied"
  );
});

/* =========================================================
 * Aviso por RUT: se ingreso de cero a alguien que ya estaba en otra unidad.
 *
 * Es el camino que alcanza a TODOS. El otro -el del enlace de la app- solo
 * se dispara si el trabajador tiene la aplicacion, y la mayoria no la tiene:
 * en esos casos la unidad vieja no se enteraba nunca.
 * ========================================================= */

function entornoRut({ unidades = [], miembros = {} } = {}) {
  const db = fakeDb({ members: miembros });
  const enviados = [];
  const dependencias = {
    db,
    HttpsError,
    requireProfileManager: async () => ({ role: "owner" }),
    findWorkerUnitsInEstablishment: async () => ({
      establishment: "hcv",
      unidades
    }),
    normalizeRut: (v) => String(v || "").replace(/[^0-9kK]/g, "").toUpperCase(),
    serverTimestamp: () => "AHORA",
    canManageProfiles: (m) => m.role === "owner",
    getUserEmail: async (uid) => `${uid}@correo.cl`,
    sendEmail: async (m) => enviados.push(m),
    idFactory: () => `aviso-${db.escrituras.size + 1}`,
    logger: { warn: () => {} }
  };

  return { db, enviados, dependencias };
}

function peticionRut(data, uid = "supervisor") {
  return { auth: { uid, token: {} }, data };
}

const UNIDAD_CON_EL = {
  workspaceId: "ws-vieja",
  workspaceName: "UCI",
  profileName: "ALAN PLAZA",
  active: true
};

test("avisa a la unidad que ya tenia a esa persona", async () => {
  const { db, enviados, dependencias } = entornoRut({
    unidades: [UNIDAD_CON_EL],
    miembros: { "ws-vieja": [{ uid: "jefa", role: "owner" }] }
  });
  const resultado = await reportWorkerEnteredHereHandler(
    peticionRut({ workspaceId: "ws-nueva", rut: "17.816.632-8" }),
    dependencias
  );

  assert.equal(resultado.notified, 1);

  const aviso = db.escrituras.get(`${NOTICES_COLLECTION}/aviso-1`);

  assert.equal(aviso.workspaceId, "ws-vieja");
  assert.equal(aviso.profileRut, "178166328");
  assert.equal(aviso.profileName, "ALAN PLAZA");
  assert.equal(aviso.status, PENDING);
  assert.equal(enviados.length, 1);
});

test("no avisa si alla el perfil ya esta inactivo", async () => {
  // No esta estorbando en ninguna planificacion: no hay nada que decidir.
  const { db, enviados, dependencias } = entornoRut({
    unidades: [{ ...UNIDAD_CON_EL, active: false }],
    miembros: { "ws-vieja": [{ uid: "jefa", role: "owner" }] }
  });
  const resultado = await reportWorkerEnteredHereHandler(
    peticionRut({ workspaceId: "ws-nueva", rut: "17816632-8" }),
    dependencias
  );

  assert.equal(resultado.notified, 0);
  assert.equal(db.escrituras.size, 0);
  assert.deepEqual(enviados, []);
});

test("no deja dos tarjetas por la misma persona", async () => {
  const { db, dependencias } = entornoRut({
    unidades: [UNIDAD_CON_EL],
    miembros: { "ws-vieja": [{ uid: "jefa", role: "owner" }] }
  });

  await reportWorkerEnteredHereHandler(
    peticionRut({ workspaceId: "ws-nueva", rut: "17816632-8" }),
    dependencias
  );

  const segundo = await reportWorkerEnteredHereHandler(
    peticionRut({ workspaceId: "ws-nueva", rut: "17.816.632-8" }),
    dependencias
  );

  assert.equal(segundo.notified, 0);
  assert.equal(db.escrituras.size, 1);
});

test("un RUT incompleto no avisa a nadie", async () => {
  const { dependencias } = entornoRut({ unidades: [UNIDAD_CON_EL] });

  await assert.rejects(
    () => reportWorkerEnteredHereHandler(
      peticionRut({ workspaceId: "ws-nueva", rut: "123" }),
      dependencias
    ),
    (error) => error.code === "invalid-argument"
  );
});

test("sin permiso en la unidad que ingresa, no se avisa", async () => {
  const { db, dependencias } = entornoRut({ unidades: [UNIDAD_CON_EL] });

  dependencias.requireProfileManager = async () => {
    throw new HttpsError("permission-denied", "No puedes.");
  };

  await assert.rejects(
    () => reportWorkerEnteredHereHandler(
      peticionRut({ workspaceId: "ws-nueva", rut: "17816632-8" }),
      dependencias
    ),
    (error) => error.code === "permission-denied"
  );

  assert.equal(db.escrituras.size, 0);
});

test("el cliente no elige a que unidades avisar", async () => {
  // Las vuelve a buscar el servidor: si se confiara en la lista que llega,
  // cualquiera podria dejarle una tarjeta a una unidad ajena.
  const { db, dependencias } = entornoRut({
    unidades: [UNIDAD_CON_EL],
    miembros: { "ws-vieja": [{ uid: "jefa", role: "owner" }] }
  });

  await reportWorkerEnteredHereHandler(
    peticionRut({
      workspaceId: "ws-nueva",
      rut: "17816632-8",
      unidades: [{ workspaceId: "ws-que-no-corresponde", active: true }]
    }),
    dependencias
  );

  const avisos = [...db.escrituras.entries()]
    .filter(([clave]) => clave.startsWith(NOTICES_COLLECTION));

  assert.equal(avisos.length, 1);
  assert.equal(avisos[0][1].workspaceId, "ws-vieja");
});

test("una tarjeta pendiente se actualiza con la fecha nueva", async () => {
  // Es el dato con el que la unidad decide. Una tarjeta vieja no puede
  // taparlo: diria que la persona se fue, pero no desde cuando volvio a estar
  // activa en otra parte.
  const { db, dependencias } = entornoRut({
    unidades: [UNIDAD_CON_EL],
    miembros: { "ws-vieja": [{ uid: "jefa", role: "owner" }] }
  });

  await reportWorkerEnteredHereHandler(
    peticionRut({ workspaceId: "ws-nueva", rut: "17816632-8" }),
    dependencias
  );

  await reportWorkerEnteredHereHandler(
    peticionRut({
      workspaceId: "ws-nueva",
      rut: "17816632-8",
      activeFrom: "2026-11-03"
    }),
    dependencias
  );

  const avisos = [...db.escrituras.entries()]
    .filter(([clave]) => clave.startsWith(NOTICES_COLLECTION));

  assert.equal(avisos.length, 1, "no se duplica");
  assert.equal(avisos[0][1].activeFrom, "2026-11-03");
});

test("una fecha mal formada no se guarda", async () => {
  const { dependencias } = entornoRut({ unidades: [UNIDAD_CON_EL] });

  await assert.rejects(
    () => reportWorkerEnteredHereHandler(
      peticionRut({
        workspaceId: "ws-nueva",
        rut: "17816632-8",
        activeFrom: "manana"
      }),
      dependencias
    ),
    (error) => error.code === "invalid-argument"
  );
});

test("la fecha valida si pasa", async () => {
  // La validacion se escribio a mano y perdio las barras una vez: quedo en
  // /^d{4}-.../, que no calza NINGUNA fecha y rechazaba todos los avisos.
  const { db, dependencias } = entornoRut({
    unidades: [UNIDAD_CON_EL],
    miembros: { "ws-vieja": [{ uid: "jefa", role: "owner" }] }
  });

  const resultado = await reportWorkerEnteredHereHandler(
    peticionRut({
      workspaceId: "ws-nueva",
      rut: "17816632-8",
      activeFrom: "2026-11-03"
    }),
    dependencias
  );

  assert.equal(resultado.notified, 1);
  assert.equal(db.escrituras.get(`${NOTICES_COLLECTION}/aviso-1`).activeFrom, "2026-11-03");
});
