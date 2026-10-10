"use strict";

// Un trabajador se enlazo en otra unidad: soltarlo de la anterior y avisarle.
//
// Pasa cuando alguien se cambia de servicio y en la unidad nueva lo ingresan de
// cero -en vez de pedir el traspaso-. Antes, en la unidad vieja no pasaba nada:
// su perfil seguia activo, seguia apareciendo en la planificacion, seguia
// contando como trabajador de esa unidad, y su aplicacion seguia mostrando el
// calendario de alla. Nadie se enteraba salvo que alguien lo notara.
//
// Aqui se hacen las dos cosas que si corresponden hacer solas:
//
//   1. SOLTAR EL ENLACE de la unidad anterior. Un trabajador esta en una unidad
//      por vez -de eso depende que cada supervisor lo califique por el periodo
//      en que estuvo con el-, y su aplicacion tiene que mostrar donde trabaja
//      hoy. Se suelta cuando acepta la invitacion de la unidad nueva y no
//      antes: soltarlo al crearle el perfil lo dejaria sin ninguna aplicacion
//      en el medio, que puede ser dias.
//
//   2. DEJAR UNA TARJETA en la unidad anterior, con el boton para desactivar el
//      perfil.
//
// Lo que NO se hace solo, a proposito: inactivar el perfil. Es decision del
// supervisor, que puede saber cosas que el sistema no -que se fue a cubrir dos
// meses y vuelve, que arrastra horas pendientes-. Por eso es una tarjeta con un
// boton y no un cambio automatico.
//
// POR QUE MIRA LOS ENLACES ACTIVOS Y NO LAS TRANSFERENCIAS: cuando un
// supervisor transfiere a alguien, el enlace viejo queda en "transferred" en el
// mismo lote que crea el nuevo, y ese camino ya vacia el calendario e inactiva
// el perfil por su cuenta. Al exigir que el enlace anterior siga ACTIVO, la
// transferencia queda fuera sin necesidad de reconocerla.

const NOTICES_COLLECTION = "workerUnitChangeNotices";

const PENDING = "pending";
const DONE = "done";
const DISMISSED = "dismissed";

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

function defaultIdFactory() {
  return `wuc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Suelta el enlace de la unidad anterior y deja la tarjeta para su supervisor.
 *
 * Se escribe en un lote: si quedara el enlace suelto sin la tarjeta, la unidad
 * perderia al trabajador de su aplicacion sin que nadie le explicara por que.
 */
async function releaseWorkerFromUnit({
  db,
  uid,
  workspaceId,
  link,
  newWorkspaceName,
  serverTimestamp,
  idFactory
}) {
  const now = serverTimestamp();
  const workspaceRef = db.collection("workspaces").doc(workspaceId);
  const profileName = cleanText(link.profileName, 180);
  const batch = db.batch();

  // El lado de la unidad se borra y el del trabajador queda marcado: es como
  // ya se sueltan los enlaces duplicados al aceptar una invitacion.
  batch.delete(workspaceRef.collection("workerLinks").doc(uid));
  batch.set(
    db.collection("users").doc(uid).collection("workerLinks").doc(workspaceId),
    {
      workspaceId,
      workspaceName: cleanText(link.workspaceName, 160),
      profileName,
      status: "unlinked",
      unlinkedAt: now,
      unlinkedBy: "worker_moved_unit",
      updatedAt: now
    },
    { merge: true }
  );
  batch.set(
    workspaceRef.collection("workerMessageDirectory").doc(uid),
    {
      uid,
      workspaceId,
      profileName,
      status: "unlinked",
      unlinkedAt: now,
      updatedAt: now,
      updatedAtISO: new Date().toISOString()
    },
    { merge: true }
  );
  // Que no lo sigan ofreciendo para cubrir turnos de una unidad en la que ya
  // no esta.
  batch.delete(workspaceRef.collection("workerSwapCandidates").doc(uid));

  const noticeId = idFactory();

  batch.set(db.collection(NOTICES_COLLECTION).doc(noticeId), {
    workspaceId,
    uid,
    profileName,
    profileRut: cleanText(link.profileRut, 32),
    // A proposito NO viaja el nombre de la unidad nueva: para decidir si
    // inactiva el perfil no hace falta, y esta unidad no tiene por que
    // enterarse de donde trabaja ahora.
    newWorkspaceName: "",
    status: PENDING,
    createdAt: now,
    updatedAt: now
  });

  await batch.commit();

  return { noticeId, profileName };
}

async function notifyWorkerUnitChangeHandler(event, {
  db,
  canManageProfiles,
  getUserEmail,
  sendEmail,
  serverTimestamp,
  idFactory = defaultIdFactory,
  logger
}) {
  const uid = String(event?.params?.uid || "");
  const workspaceId = String(event?.params?.workspaceId || "");
  const antes = event?.data?.before?.data?.() || null;
  const despues = event?.data?.after?.data?.() || null;

  if (!uid || !workspaceId || !despues) return;

  // Solo el momento en que el enlace PASA a activo. Sin esto, cada cambio de
  // updatedAt volveria a avisar. Y es lo que evita que soltar los enlaces
  // viejos -que escribe en esta misma ruta- se llame a si mismo.
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
      const { profileName } = await releaseWorkerFromUnit({
        db,
        uid,
        workspaceId: unidadVieja,
        link: anterior,
        serverTimestamp,
        idFactory
      });

      await avisarUnidad({
        db,
        canManageProfiles,
        getUserEmail,
        sendEmail,
        workspaceId: unidadVieja,
        // El nombre que esa unidad le puso, que es el que reconoce.
        profileName
      });
    } catch (error) {
      logger?.warn?.("No se pudo soltar al trabajador de su unidad anterior.", {
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
  const detalle = `${quien} fue ingresado en otra unidad y su aplicación ya no ` +
    "muestra la tuya.";
  const consejo = "Si ya no trabaja contigo, desactiva su perfil para que deje " +
    "de aparecer en la planificación. Lo tienes en TurnoPlus, en el menú " +
    "Solicitudes, con el botón para hacerlo.";
  const nota = "Sus saldos de vacaciones siguen aquí: no se traspasan solos. " +
    "Si la otra unidad los necesita, puede pedirte el traspaso.";
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

/**
 * El supervisor de la unidad anterior responde: desactivo el perfil, o decide
 * dejarlo activo.
 *
 * Solo cierra la tarjeta. Desactivar el perfil lo hace su propio navegador, que
 * es donde viven los perfiles y donde ya existe el camino para hacerlo.
 */
async function resolveWorkerUnitChangeNoticeHandler(request, {
  db,
  HttpsError,
  requireProfileManager
}) {
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError("unauthenticated", "Inicia sesion.");
  }

  const data = request.data || {};
  const workspaceId = cleanText(data.workspaceId, 160);
  const noticeId = cleanText(data.noticeId, 220);
  const deactivated = data.deactivated === true;

  if (!workspaceId || !noticeId) {
    throw new HttpsError("invalid-argument", "Falta identificar el aviso.");
  }

  await requireProfileManager(workspaceId, uid, request.auth?.token || {});

  const ref = db.collection(NOTICES_COLLECTION).doc(noticeId);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Ese aviso ya no existe.");
  }

  const aviso = snap.data() || {};

  if (aviso.workspaceId !== workspaceId) {
    throw new HttpsError(
      "permission-denied",
      "Ese aviso es de otra unidad."
    );
  }

  if (String(aviso.status || "") !== PENDING) {
    throw new HttpsError("failed-precondition", "Ese aviso ya fue resuelto.");
  }

  const status = deactivated ? DONE : DISMISSED;
  const ahora = new Date();

  await ref.set({
    status,
    resolvedAt: ahora,
    resolvedByUid: uid,
    updatedAt: ahora
  }, { merge: true });

  return { status, noticeId };
}

module.exports = {
  DISMISSED,
  DONE,
  NOTICES_COLLECTION,
  PENDING,
  notifyWorkerUnitChangeHandler,
  resolveWorkerUnitChangeNoticeHandler,
  _private: {
    MAX_NOTIFIED,
    MAX_PREVIOUS_UNITS,
    linkIsActive,
    releaseWorkerFromUnit
  }
};
