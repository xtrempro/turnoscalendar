"use strict";

// Mantiene el correo del VINCULO al dia con el del perfil.
//
// Por que importa: la recuperacion de identidad (recoverWorkerIdentity) busca
// por workerEmail del vinculo, y ese campo solo se escribia al aceptar una
// invitacion. Si el supervisor corregia el correo del trabajador, el vinculo
// seguia apuntando al viejo para siempre y esa persona quedaba sin red.
//
// La alternativa era desenlazar y reinvitar, pero eso crea un uid NUEVO: el id
// de cada hilo de chat se compone con los uids de ambos interlocutores, asi que
// se perderian las conversaciones -tambien del lado del colega- y el historial
// ligado al uid. Sincronizar el correo en su sitio no cuesta nada de eso.

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Misma normalizacion que usa el resto del backend para comparar RUT.
function normalizeRut(value) {
  return String(value || "").replace(/[^0-9kK]/g, "").toUpperCase();
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// El RUT manda; el nombre es el respaldo para los vinculos antiguos que se
// crearon sin el. Mismo criterio que findProfileForLink del motor.
function findProfileForLink(link = {}, profiles = []) {
  const linkRut = normalizeRut(link.profileRut);

  if (linkRut) {
    const porRut = profiles.find(
      (profile) => profile && normalizeRut(profile.rut) === linkRut
    );
    if (porRut) return porRut;
  }

  const linkName = normalizeName(link.profileName);
  if (!linkName) return null;

  return profiles.find(
    (profile) => profile && normalizeName(profile.name) === linkName
  ) || null;
}

// Que vinculos quedaron con un correo distinto al de su perfil.
function emailUpdatesForLinks({ profiles = [], links = [] } = {}) {
  const updates = [];

  for (const link of links) {
    if (String(link.status || "active") !== "active") continue;

    const profile = findProfileForLink(link, profiles);
    if (!profile) continue;

    const nuevo = normalizeEmail(profile.email);

    // Un perfil SIN correo no borra el del vinculo. Vaciarlo dejaria a esa
    // persona sin poder recuperarse nunca, y lo mas probable es que sea un dato
    // que falta -o un perfil creado a medias- y no una decision deliberada.
    if (!nuevo || !isValidEmail(nuevo)) continue;

    const actual = normalizeEmail(link.workerEmail);
    if (nuevo === actual) continue;

    updates.push({
      uid: link.uid,
      from: actual,
      to: nuevo,
      profileName: profile.name || link.profileName || ""
    });
  }

  return updates;
}

async function syncWorkerLinkEmailsHandler(event, dependencies) {
  const {
    db,
    serverTimestamp,
    profilesFromState,
    logger = { info() {}, warn() {} }
  } = dependencies;

  const workspaceId = event?.params?.workspaceId;
  if (!workspaceId) return null;

  const before = event?.data?.before?.data?.() || null;
  const after = event?.data?.after?.data?.() || null;

  // Esta entrada guarda muchas cosas del modulo "profile"; solo interesa la que
  // lleva la lista de perfiles.
  if (after?.storageKey !== "profiles" && before?.storageKey !== "profiles") {
    return null;
  }

  // Borrado de la entrada: no se toca ningun vinculo. Perder la lista de
  // perfiles no es motivo para dejar a nadie sin correo.
  if (!after) return null;

  const profiles = profilesFromState({}, after);
  if (!profiles.length) return null;

  const workspaceRef = db.collection("workspaces").doc(workspaceId);
  const linksSnap = await workspaceRef.collection("workerLinks").get();
  const links = (linksSnap.docs || []).map((doc) => ({
    uid: doc.id,
    ...(doc.data() || {})
  }));

  const updates = emailUpdatesForLinks({ profiles, links });

  // Se dispara en CADA guardado de perfiles: sin cambios, no se escribe nada.
  if (!updates.length) return null;

  const now = serverTimestamp();
  const batch = db.batch();

  for (const update of updates) {
    const patch = { workerEmail: update.to, workerEmailSyncedAt: now };

    // Los dos lados del vinculo, igual que al aceptar la invitacion: el del
    // workspace es el que consulta la recuperacion, el del usuario es el que
    // lee la PWA.
    batch.set(workspaceRef.collection("workerLinks").doc(update.uid), patch, { merge: true });
    batch.set(
      db.collection("users").doc(update.uid).collection("workerLinks").doc(workspaceId),
      patch,
      { merge: true }
    );
  }

  await batch.commit();

  logger.info("Correo del vinculo sincronizado con el perfil.", {
    workspaceId,
    actualizados: updates.length,
    uids: updates.map((update) => update.uid)
  });

  return updates;
}

module.exports = {
  syncWorkerLinkEmailsHandler,
  _private: {
    emailUpdatesForLinks,
    findProfileForLink,
    isValidEmail,
    normalizeEmail,
    normalizeName,
    normalizeRut
  }
};
