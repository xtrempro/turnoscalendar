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

// Tope defensivo, como en el resto de las busquedas que recorren unidades.
const MAX_WORKSPACES = 500;

function normalizeRut(value) {
  return String(value || "").replace(/[^0-9kK]/g, "").toUpperCase();
}

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}

// Los perfiles viven como un JSON dentro de una entrada del modulo "profile".
function parseProfiles(raw) {
  if (Array.isArray(raw)) return raw;

  try {
    const parsed = JSON.parse(String(raw || "[]"));

    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

async function profilesOfWorkspace(db, workspaceId) {
  const entriesSnap = await db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("stateModules")
    .doc("profile")
    .collection("entries")
    .where("storageKey", "==", "profiles")
    .get();

  for (const doc of entriesSnap.docs) {
    const entrada = doc.data() || {};

    if (entrada.deleted === true) continue;

    const perfiles = parseProfiles(entrada.value);

    if (perfiles.length) return perfiles;
  }

  return [];
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
      // Un perfil inactivo igual sirve: es justo el de alguien que se fue de
      // esa unidad, y sus saldos de vacaciones siguen ahi.
      active: perfil.active !== false
    });
  }

  return { establishment: establecimiento, unidades: encontradas };
}

module.exports = {
  findWorkerInEstablishmentHandler,
  _private: {
    MAX_WORKSPACES,
    normalizeRut,
    parseProfiles,
    profilesOfWorkspace
  }
};
