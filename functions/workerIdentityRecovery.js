"use strict";

// Recuperacion de la identidad del trabajador.
//
// La PWA usa sesiones ANONIMAS y el vinculo se guarda por uid: si el telefono
// borra sus datos, se reinstala la app o se abre el enlace en otro navegador,
// esa identidad muere. Hasta ahora la unica salida era que el supervisor
// borrara el vinculo y volviera a invitar; en una sola unidad eso paso 18 veces
// sobre 7 personas, y dos trabajadores quedaron fuera durante semanas porque
// nadie se entero.
//
// Aqui el trabajador prueba quien es con un correo VERIFICADO -Google si es
// Gmail, enlace por correo si no- y el servidor le devuelve un custom token de
// su uid ORIGINAL.
//
// Por que un token y no una migracion: los documentos del trabajador cuelgan
// del uid en una docena de colecciones, y el id de cada hilo de chat se compone
// con los uids de AMBOS interlocutores. Mover un uid obligaria a reescribir
// tambien el lado de cada colega con quien hablo alguna vez. Devolviendo la
// identidad original no se mueve un solo documento y las reglas de Firestore
// siguen valiendo tal cual.

// Tope defensivo: la busqueda recorre unidades, y conviene que un error de
// datos no se traduzca en un barrido sin fin.
const MAX_WORKSPACES = 500;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function linkedAtMillis(link = {}) {
  const value = link.linkedAt;

  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Con varias unidades enlazadas gana la mas reciente: es la que el trabajador
// esta usando de verdad. Las demas se reportan para que el supervisor revise.
function pickMostRecentLink(matches = []) {
  return matches
    .slice()
    .sort((a, b) => linkedAtMillis(b.link) - linkedAtMillis(a.link))[0] || null;
}

// Se recorren las unidades en vez de consultar un collectionGroup: una igualdad
// sobre una subcoleccion usa el indice automatico de campo simple, mientras que
// un collectionGroup exigiria un indice declarado a mano. Recuperar la
// identidad es una operacion rara; el recorrido acotado sale mas barato que
// arrastrar un indice nuevo.
async function findLinksByEmail(db, email, limit = MAX_WORKSPACES) {
  const workspaces = await db.collection("workspaces").get();
  const matches = [];

  for (const workspaceDoc of (workspaces.docs || []).slice(0, limit)) {
    const snap = await workspaceDoc.ref
      .collection("workerLinks")
      .where("workerEmail", "==", email)
      .get();

    for (const docSnap of (snap.docs || [])) {
      const link = docSnap.data() || {};

      if (String(link.status || "active") !== "active") continue;

      matches.push({ workspaceId: workspaceDoc.id, uid: docSnap.id, link });
    }
  }

  return matches;
}

async function recoverWorkerIdentityHandler(request, dependencies) {
  const {
    db,
    HttpsError,
    createCustomToken,
    getAuthUser,
    logger = { info() {} }
  } = dependencies;

  const authToken = request.auth?.token || {};
  const callerUid = request.auth?.uid || "";

  if (!callerUid) {
    throw new HttpsError(
      "unauthenticated",
      "Inicia sesion para recuperar tu app."
    );
  }

  const email = normalizeEmail(authToken.email);

  // La prueba de identidad es el correo VERIFICADO, venga de Google o del
  // enlace por correo: la funcion no pregunta COMO se verifico. Sin esa marca
  // cualquiera podria reclamar un vinculo ajeno escribiendo la direccion.
  if (!email || authToken.email_verified !== true) {
    throw new HttpsError(
      "permission-denied",
      "Necesitamos un correo verificado para devolverte tu app."
    );
  }

  const matches = await findLinksByEmail(db, email);

  if (!matches.length) {
    throw new HttpsError(
      "not-found",
      "No encontramos una app enlazada a ese correo. Pidele una invitacion a tu supervisor."
    );
  }

  const elegido = pickMostRecentLink(matches);

  // Ya esta dentro de su propia identidad: no hay nada que devolver.
  if (elegido.uid === callerUid) {
    return { ok: true, alreadyLinked: true, workspaceId: elegido.workspaceId };
  }

  // Solo se devuelven identidades ANONIMAS. Un uid con credenciales propias es
  // la cuenta de alguien: emitir un token suyo se la entregaria a quien figure
  // en el correo del vinculo, que lo escribio el supervisor a mano.
  const cuenta = await getAuthUser(elegido.uid);

  if ((cuenta?.providerData || []).length) {
    throw new HttpsError(
      "failed-precondition",
      "Esa app ya esta protegida con una cuenta propia. Inicia sesion con ella."
    );
  }

  const customToken = await createCustomToken(elegido.uid);

  // Sin el token en el registro: es una credencial.
  logger.info("Identidad de trabajador recuperada.", {
    workspaceId: elegido.workspaceId,
    uid: elegido.uid,
    unidadesCoincidentes: matches.length
  });

  return {
    ok: true,
    token: customToken,
    workspaceId: elegido.workspaceId,
    profileName: elegido.link.profileName || "",
    otrasUnidades: Math.max(0, matches.length - 1)
  };
}

module.exports = {
  recoverWorkerIdentityHandler,
  _private: {
    MAX_WORKSPACES,
    findLinksByEmail,
    linkedAtMillis,
    normalizeEmail,
    pickMostRecentLink
  }
};
