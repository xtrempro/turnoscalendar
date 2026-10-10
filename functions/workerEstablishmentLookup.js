"use strict";

// Buscar si un RUT ya esta registrado en otra unidad del mismo establecimiento.
//
// Sirve al crear un perfil: si esa persona ya trabaja en otra unidad del mismo
// hospital, el supervisor puede pedir el traslado de su informacion en vez de
// ingresarla de cero. Si prefiere ingresarla de cero, tambien puede.
//
// Por que vive en el servidor y no en el cliente: mirar los perfiles de otra
// unidad exige leer datos de una unidad a la que el supervisor NO pertenece.
// Las reglas de Firestore lo impiden, y con razon. Aqui se hace con permisos
// de servidor pero devolviendo lo MINIMO: que existe y en que unidad.
//
// Lo que no se devuelve, a proposito: el nombre del perfil, su correo, su
// telefono. Quien pregunta ya escribio el RUT y sabe de quien se trata; que la
// respuesta confirme la unidad alcanza para ofrecer el traslado, y no convierte
// esto en una via para pescar datos de trabajadores de otras unidades.

const {
  readModuleBase,
  applyExactEntries,
  storageValue
} = require("./lib/stateReader");

// Tope defensivo, como en el resto de las busquedas que recorren unidades.
const MAX_WORKSPACES = 500;

function normalizeRut(value) {
  return String(value || "").replace(/[^0-9kK]/g, "").toUpperCase();
}

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}

// La lista de perfiles se lee con lib/stateReader, igual que en el resto del
// servidor.
//
// Un perfil NO vive solo en el campo `value` de una entrada: la base puede
// estar partida en chunks, y encima van los parches por elemento de `items` y
// `deletedItems`. Leer solo `value` deja afuera a quien fue creado o editado
// despues del ultimo volcado completo, y aqui ese error es peor que una falla
// visible: devolveria "no esta en ninguna otra unidad" y el supervisor
// ingresaria a la persona de cero, que es exactamente lo que esta busqueda
// existe para evitar.
async function profilesOfWorkspace(db, workspaceId) {
  const state = await readModuleBase(db, workspaceId, "profile");

  await applyExactEntries(db, workspaceId, state, { profile: ["profiles"] });

  const perfiles = storageValue(state, "profiles", []);

  return Array.isArray(perfiles) ? perfiles : [];
}

/**
 * En que OTRAS unidades del mismo establecimiento esta ese RUT.
 *
 * Vive aparte porque hay dos cosas que lo necesitan y tienen que mirar
 * exactamente lo mismo: avisarle a quien crea un perfil que esa persona ya
 * esta en otra unidad, y avisarle a esa otra unidad cuando la ingresan aqui de
 * todos modos (functions/workerUnitChangeNotice.js). Si cada una buscara por
 * su cuenta, un dia una encontraria lo que la otra no.
 *
 * Devuelve tambien el nombre del perfil, que las unidades que ya lo tienen si
 * pueden saber: es SU trabajador. Lo que no sale de aqui hacia quien pregunta
 * es otra cosa, y de eso se encarga el handler.
 */
async function findWorkerUnitsInEstablishment(db, workspaceId, rut) {
  const propiaSnap = await db.collection("workspaces").doc(workspaceId).get();
  const establecimiento = String(propiaSnap.data()?.establishment || "");

  // Sin establecimiento declarado no hay con quien comparar. Vacio no coincide
  // con vacio: si no, una unidad sin declarar veria las de todas las demas.
  if (!establecimiento) return { establishment: "", unidades: [] };

  const hermanasSnap = await db
    .collection("workspaces")
    .where("establishment", "==", establecimiento)
    .limit(MAX_WORKSPACES)
    .get();
  const encontradas = [];

  for (const doc of hermanasSnap.docs) {
    if (doc.id === workspaceId) continue;

    const perfiles = await profilesOfWorkspace(db, doc.id);
    const perfil = perfiles.find(
      (item) => item && normalizeRut(item.rut) === rut
    );

    if (!perfil) continue;

    encontradas.push({
      workspaceId: doc.id,
      workspaceName: cleanText(doc.data()?.name, 160),
      profileName: cleanText(perfil.name, 180),
      // Un perfil inactivo igual sirve: es justo el de alguien que se fue de
      // esa unidad, y sus saldos de vacaciones siguen ahi.
      active: perfil.active !== false
    });
  }

  return { establishment: establecimiento, unidades: encontradas };
}

async function findWorkerInEstablishmentHandler(request, {
  db,
  HttpsError,
  requireProfileManager
}) {
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError("unauthenticated", "Inicia sesion.");
  }

  const workspaceId = cleanText(request.data?.workspaceId, 160);
  const rut = normalizeRut(request.data?.rut);

  if (!workspaceId || rut.length < 7) {
    throw new HttpsError("invalid-argument", "Falta el RUT o la unidad.");
  }

  // Solo quien puede administrar perfiles en SU unidad, que es quien esta
  // creando el perfil. Sin esto, cualquier miembro podria consultar RUTs.
  await requireProfileManager(workspaceId, uid, request.auth?.token || {});

  const { establishment, unidades } =
    await findWorkerUnitsInEstablishment(db, workspaceId, rut);

  // El nombre del perfil NO sale hacia quien pregunta: ya escribio el RUT y
  // sabe de quien se trata, y devolverlo convertiria esto en una via para
  // pescar datos de trabajadores de otras unidades.
  return {
    establishment,
    unidades: unidades.map((item) => ({
      workspaceId: item.workspaceId,
      workspaceName: item.workspaceName,
      active: item.active
    }))
  };
}

module.exports = {
  findWorkerInEstablishmentHandler,
  findWorkerUnitsInEstablishment,
  _private: {
    MAX_WORKSPACES,
    normalizeRut,
    profilesOfWorkspace
  }
};
