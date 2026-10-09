"use strict";

// Avisarle a la unidad anterior que un trabajador se enlazo en otra.
//
// Cuando alguien se cambia de servicio por su cuenta -pide acceso con su RUT en
// la unidad nueva y el supervisor de alla lo aprueba- en la unidad vieja no
// pasa nada: su perfil sigue activo, sigue apareciendo en la planificacion y
// sigue contando como trabajador de esa unidad. Nadie se entera salvo que
// alguien lo note.
//
// Esto no lo arregla solo. A proposito: inactivar el perfil de alguien es
// decision del supervisor, que puede saber cosas que el sistema no -que se fue
// a cubrir dos meses y vuelve, que sigue haciendo turnos en ambas-. Lo que si
// corresponde es avisarle.
//
// POR QUE MIRA LOS ENLACES ACTIVOS Y NO LAS TRANSFERENCIAS: cuando un
// supervisor transfiere a alguien, el enlace viejo queda en "transferred" en el
// mismo lote que crea el nuevo, y ese camino ya vacia el calendario e inactiva
// el perfil por su cuenta. Al exigir que el enlace anterior siga ACTIVO, la
// transferencia queda fuera sin necesidad de reconocerla: si llegara a avisar
// ahi, estaria recomendando algo que acaba de pasar solo.
//
// Lo que no dice el aviso: a que unidad se fue. La unidad vieja no tiene por
// que enterarse de donde trabaja ahora, y para decidir si inactiva el perfil no
// le hace falta.

// Topes defensivos. Alguien con enlaces en muchas unidades no deberia convertir
// un cambio de unidad en una rafaga de correos.
const MAX_PREVIOUS_UNITS = 5;
const MAX_NOTIFIED = 20;

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linkIsActive(link) {
  return String(link?.status || "") === "active";
}

async function notifyWorkerUnitChangeHandler(event, {
  db,
  canManageProfiles,
  getUserEmail,
  sendEmail,
  logger
}) {
  const uid = String(event?.params?.uid || "");
  const workspaceId = String(event?.params?.workspaceId || "");
  const antes = event?.data?.before?.data?.() || null;
  const despues = event?.data?.after?.data?.() || null;

  if (!uid || !workspaceId || !despues) return;

  // Solo el momento en que el enlace PASA a activo. Sin esto, cada cambio de
  // updatedAt volveria a avisar.
  if (!linkIsActive(despues) || linkIsActive(antes)) return;

  // Cinturon y tirantes: un enlace que nace de una transferencia lo dice.
  if (despues.transferredFromWorkspaceId) return;

  const linksSnap = await db
    .collection("users")
    .doc(uid)
    .collection("workerLinks")
    .get();
  const anteriores = linksSnap.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
    .filter((link) => {
      const suWorkspace = String(link.workspaceId || link.id);

      return suWorkspace !== workspaceId && linkIsActive(link);
    })
    .slice(0, MAX_PREVIOUS_UNITS);

  if (!anteriores.length) return;

  for (const anterior of anteriores) {
    const unidadVieja = String(anterior.workspaceId || anterior.id);

    try {
      await avisarUnidad({
        db,
        canManageProfiles,
        getUserEmail,
        sendEmail,
        workspaceId: unidadVieja,
        // El nombre que esa unidad le puso, que es el que reconoce.
        profileName: cleanText(anterior.profileName, 180)
      });
    } catch (error) {
      logger?.warn?.("No se pudo avisar del cambio de unidad.", {
        workspaceId: unidadVieja,
        error: String(error?.message || error)
      });
    }
  }
}

async function avisarUnidad({
  db,
  canManageProfiles,
  getUserEmail,
  sendEmail,
  workspaceId,
  profileName
}) {
  const membersSnap = await db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("members")
    .get();
  const destinatarios = [];

  for (const memberDoc of membersSnap.docs) {
    if (destinatarios.length >= MAX_NOTIFIED) break;
    // Los mismos que podrian inactivar el perfil.
    if (!canManageProfiles(memberDoc.data() || {})) continue;

    const email = await getUserEmail(memberDoc.id);

    if (email) destinatarios.push(email);
  }

  if (!destinatarios.length) return;

  const quien = profileName || "Un trabajador de tu unidad";
  const asunto = `${quien} se enlazo en otra unidad`;
  const detalle = `${quien} pidió acceso a la app en otra unidad y se lo aprobaron.`;
  const consejo = "Si ya no trabaja contigo, conviene inactivar su perfil para " +
    "que deje de aparecer en la planificación. Si sigue en tu unidad, no " +
    "tienes que hacer nada.";
  const nota = "Sus saldos de vacaciones siguen aquí: no se traspasan solos. " +
    "Si la otra unidad los necesita, puede pedirte el traspaso desde " +
    "Solicitudes.";
  const text = [detalle, "", consejo, "", nota].join("\n");
  const html = [
    `<p>${escapeHtml(detalle)}</p>`,
    `<p>${escapeHtml(consejo)}</p>`,
    `<p>${escapeHtml(nota)}</p>`
  ].join("");

  for (const to of destinatarios) {
    await sendEmail({ to, subject: asunto, html, text });
  }
}

module.exports = {
  notifyWorkerUnitChangeHandler,
  _private: {
    MAX_NOTIFIED,
    MAX_PREVIOUS_UNITS,
    linkIsActive
  }
};
