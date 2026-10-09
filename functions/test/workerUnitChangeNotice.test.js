"use strict";

// Avisarle a la unidad anterior que un trabajador se enlazo en otra.
//
// Lo que estas pruebas protegen: que avise cuando de verdad hay una unidad que
// se quedo con un perfil activo de alguien que ya no esta, que NO avise en una
// transferencia -donde el propio camino ya inactiva el perfil- y que no vuelva
// a avisar cada vez que el enlace se toca.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  notifyWorkerUnitChangeHandler,
  _private
} = require("../workerUnitChangeNotice");

function fakeDb({ links = {}, members = {} } = {}) {
  return {
    collection: (nombre) => {
      if (nombre === "users") {
        return {
          doc: (uid) => ({
            collection: (sub) => {
              assert.equal(sub, "workerLinks");

              return {
                get: async () => ({
                  docs: Object.entries(links[uid] || {}).map(([id, data]) => ({
                    id,
                    data: () => data
                  }))
                })
              };
            }
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

function deps(db, enviados) {
  return {
    db,
    canManageProfiles: (miembro) =>
      miembro.role === "owner" || miembro.role === "admin",
    getUserEmail: async (uid) => `${uid}@correo.cl`,
    sendEmail: async (mensaje) => enviados.push(mensaje),
    logger: { warn: () => {} }
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

test("avisa a la unidad que se quedo con el perfil activo", async () => {
  const db = fakeDb({
    links: {
      "uid-1": {
        "ws-vieja": {
          workspaceId: "ws-vieja",
          status: "active",
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

  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].to, "jefa@correo.cl");
  assert.ok(enviados[0].subject.includes("ALAN PLAZA"));
  assert.ok(enviados[0].text.includes("inactivar su perfil"));
});

test("no dice a que unidad se fue", async () => {
  // La unidad vieja no tiene por que enterarse de donde trabaja ahora, y para
  // decidir si inactiva el perfil no le hace falta.
  const db = fakeDb({
    links: {
      "uid-1": {
        "ws-vieja": { workspaceId: "ws-vieja", status: "active", profileName: "ALAN" },
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

  const texto = JSON.stringify(enviados);

  assert.ok(!texto.includes("Urgencias"), "no debe nombrar la unidad nueva");
  assert.ok(!texto.includes("ws-nueva"), "ni su id");
});

test("una transferencia no dispara el aviso", async () => {
  // El enlace viejo queda en "transferred" en el mismo lote, y ese camino ya
  // vacia el calendario e inactiva el perfil. Avisar aqui recomendaria algo
  // que acaba de pasar solo.
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
});

test("un enlace que nace de una transferencia tampoco avisa", async () => {
  // Cinturon y tirantes: aunque el enlace viejo quedara activo por un error,
  // el enlace nuevo dice de donde viene.
  const db = fakeDb({
    links: {
      "uid-1": {
        "ws-vieja": { workspaceId: "ws-vieja", status: "active", profileName: "ALAN" },
        "ws-nueva": ACTIVO_NUEVO
      }
    },
    members: MIEMBROS
  });
  const enviados = [];

  await notifyWorkerUnitChangeHandler(
    evento(null, {
      ...ACTIVO_NUEVO,
      transferredFromWorkspaceId: "ws-vieja"
    }),
    deps(db, enviados)
  );

  assert.deepEqual(enviados, []);
});

test("tocar un enlace que ya estaba activo no vuelve a avisar", async () => {
  const db = fakeDb({
    links: {
      "uid-1": {
        "ws-vieja": { workspaceId: "ws-vieja", status: "active", profileName: "ALAN" },
        "ws-nueva": ACTIVO_NUEVO
      }
    },
    members: MIEMBROS
  });
  const enviados = [];

  await notifyWorkerUnitChangeHandler(
    evento(ACTIVO_NUEVO, { ...ACTIVO_NUEVO, updatedAt: "mas tarde" }),
    deps(db, enviados)
  );

  assert.deepEqual(enviados, []);
});

test("el primer enlace de alguien no avisa a nadie", async () => {
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
});

test("un enlace desvinculado no cuenta como unidad anterior", async () => {
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
});

test("avisa a cada unidad anterior que siga activa", async () => {
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
      "ws-otra": [{ uid: "jefa-otra", role: "admin" }]
    }
  });
  const enviados = [];

  await notifyWorkerUnitChangeHandler(
    evento(null, ACTIVO_NUEVO),
    deps(db, enviados)
  );

  assert.deepEqual(enviados.map((item) => item.to).sort(), [
    "jefa-otra@correo.cl",
    "jefa-una@correo.cl"
  ]);
});

test("si una unidad falla, las demas igual reciben el aviso", async () => {
  const db = fakeDb({
    links: {
      "uid-1": {
        "ws-rota": { workspaceId: "ws-rota", status: "active", profileName: "ALAN" },
        "ws-buena": { workspaceId: "ws-buena", status: "active", profileName: "ALAN" },
        "ws-nueva": ACTIVO_NUEVO
      }
    },
    members: {
      "ws-rota": [{ uid: "jefa-rota", role: "owner" }],
      "ws-buena": [{ uid: "jefa-buena", role: "owner" }]
    }
  });
  const enviados = [];
  const dependencias = deps(db, enviados);

  dependencias.sendEmail = async (mensaje) => {
    if (mensaje.to === "jefa-rota@correo.cl") throw new Error("rebotado");

    enviados.push(mensaje);
  };

  await notifyWorkerUnitChangeHandler(
    evento(null, ACTIVO_NUEVO),
    dependencias
  );

  assert.deepEqual(enviados.map((item) => item.to), ["jefa-buena@correo.cl"]);
});

test("sin nombre de perfil el aviso igual se entiende", async () => {
  const db = fakeDb({
    links: {
      "uid-1": {
        "ws-vieja": { workspaceId: "ws-vieja", status: "active" },
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

  assert.equal(enviados.length, 1);
  assert.ok(!enviados[0].text.includes("undefined"));
});

test("solo el paso a activo cuenta", () => {
  assert.equal(_private.linkIsActive({ status: "active" }), true);
  assert.equal(_private.linkIsActive({ status: "transferred" }), false);
  assert.equal(_private.linkIsActive(null), false);
});
