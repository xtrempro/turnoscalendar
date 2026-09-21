"use strict";

// Lo que fija este archivo es la FRONTERA DE SEGURIDAD de la recuperacion: a
// quien se le devuelve una identidad y a quien no. La funcion entrega un custom
// token de OTRO uid, asi que sus negativas importan tanto como su exito.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  recoverWorkerIdentityHandler,
  _private: { pickMostRecentLink }
} = require("../workerIdentityRecovery");

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Un Firestore de mentira, con lo justo: unidades y sus workerLinks.
function fakeDb(workspaces) {
  return {
    collection(name) {
      assert.equal(name, "workspaces", "solo se recorre workspaces");

      return {
        async get() {
          return {
            docs: Object.keys(workspaces).map((workspaceId) => ({
              id: workspaceId,
              ref: {
                collection(sub) {
                  assert.equal(sub, "workerLinks");

                  return {
                    where(field, op, value) {
                      assert.equal(field, "workerEmail");
                      assert.equal(op, "==");

                      return {
                        async get() {
                          return {
                            docs: workspaces[workspaceId]
                              .filter((link) => link.workerEmail === value)
                              .map((link) => ({
                                id: link.uid,
                                data: () => link
                              }))
                          };
                        }
                      };
                    }
                  };
                }
              }
            }))
          };
        }
      };
    }
  };
}

function deps(overrides = {}) {
  return {
    HttpsError: FakeHttpsError,
    createCustomToken: async (uid) => `token-de-${uid}`,
    getAuthUser: async () => ({ providerData: [] }),
    ...overrides
  };
}

const UNIDAD = {
  ws1: [
    {
      uid: "uid-anonimo-original",
      workerEmail: "ana@correo.cl",
      profileName: "ANA",
      status: "active",
      linkedAt: "2026-08-01T00:00:00.000Z"
    }
  ]
};

function peticion(token, uid = "uid-nuevo") {
  return { auth: { uid, token } };
}

test("devuelve un token del uid ORIGINAL, sin mover nada", async () => {
  const resultado = await recoverWorkerIdentityHandler(
    peticion({ email: "ana@correo.cl", email_verified: true }),
    deps({ db: fakeDb(UNIDAD) })
  );

  assert.equal(resultado.ok, true);
  assert.equal(resultado.token, "token-de-uid-anonimo-original");
  assert.equal(resultado.workspaceId, "ws1");
  assert.equal(resultado.profileName, "ANA");
});

test("sin correo verificado no se entrega ninguna identidad", async () => {
  await assert.rejects(
    recoverWorkerIdentityHandler(
      peticion({ email: "ana@correo.cl", email_verified: false }),
      deps({ db: fakeDb(UNIDAD) })
    ),
    (error) => error.code === "permission-denied"
  );
});

test("el correo se compara normalizado", async () => {
  const resultado = await recoverWorkerIdentityHandler(
    peticion({ email: "  ANA@Correo.CL  ", email_verified: true }),
    deps({ db: fakeDb(UNIDAD) })
  );

  assert.equal(resultado.token, "token-de-uid-anonimo-original");
});

test("una identidad con cuenta propia NO se entrega", async () => {
  // Si el uid destino ya tiene credenciales, es la cuenta de alguien: devolver
  // su token seria regalarsela a quien figure en el correo del vinculo.
  await assert.rejects(
    recoverWorkerIdentityHandler(
      peticion({ email: "ana@correo.cl", email_verified: true }),
      deps({
        db: fakeDb(UNIDAD),
        getAuthUser: async () => ({ providerData: [{ providerId: "google.com" }] })
      })
    ),
    (error) => error.code === "failed-precondition"
  );
});

test("sin vinculo para ese correo no se inventa nada", async () => {
  await assert.rejects(
    recoverWorkerIdentityHandler(
      peticion({ email: "otro@correo.cl", email_verified: true }),
      deps({ db: fakeDb(UNIDAD) })
    ),
    (error) => error.code === "not-found"
  );
});

test("los vinculos desvinculados no se recuperan", async () => {
  const cerrado = {
    ws1: [{ ...UNIDAD.ws1[0], status: "unlinked" }]
  };

  await assert.rejects(
    recoverWorkerIdentityHandler(
      peticion({ email: "ana@correo.cl", email_verified: true }),
      deps({ db: fakeDb(cerrado) })
    ),
    (error) => error.code === "not-found"
  );
});

test("quien ya es su propia identidad no recibe token", async () => {
  const resultado = await recoverWorkerIdentityHandler(
    peticion({ email: "ana@correo.cl", email_verified: true }, "uid-anonimo-original"),
    deps({ db: fakeDb(UNIDAD) })
  );

  assert.equal(resultado.alreadyLinked, true);
  assert.equal(resultado.token, undefined);
});

test("sin sesion no se atiende", async () => {
  await assert.rejects(
    recoverWorkerIdentityHandler(
      { auth: null },
      deps({ db: fakeDb(UNIDAD) })
    ),
    (error) => error.code === "unauthenticated"
  );
});

test("con varias unidades gana el vinculo mas reciente", () => {
  const elegido = pickMostRecentLink([
    { uid: "viejo", link: { linkedAt: "2026-01-01T00:00:00.000Z" } },
    { uid: "nuevo", link: { linkedAt: "2026-09-01T00:00:00.000Z" } }
  ]);

  assert.equal(elegido.uid, "nuevo");
});

test("acepta timestamps de Firestore, no solo cadenas", () => {
  const elegido = pickMostRecentLink([
    { uid: "viejo", link: { linkedAt: { toMillis: () => 1000 } } },
    { uid: "nuevo", link: { linkedAt: { toMillis: () => 9000 } } }
  ]);

  assert.equal(elegido.uid, "nuevo");
});
