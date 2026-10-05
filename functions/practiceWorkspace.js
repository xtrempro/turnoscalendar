"use strict";

// Unidad de practica: cada supervisor o administrador tiene la suya, con datos
// ficticios, para practicar sin tocar nada real.
//
// - ensurePracticeWorkspace: la crea si no existe (workspaces/practice_<uid>),
//   con la persona como duena y la marca `practice: true`. Solo para quien ya
//   es miembro de alguna unidad REAL (supervisor o administrador): los
//   trabajadores de la PWA no son miembros y no la reciben.
// - resetPracticeWorkspace: borra todo su contenido (menos los miembros); el
//   navegador la vuelve a llenar con los datos de partida (js/practiceSeed.js).
//
// El contenido lo escribe el navegador con la sincronizacion de siempre, asi el
// formato en la nube es exactamente el de una unidad normal.

const PRACTICE_PREFIX = "practice_";
const PRACTICE_NAME = "Unidad de práctica";

function practiceWorkspaceId(uid) {
  return `${PRACTICE_PREFIX}${uid}`;
}

function isPracticeWorkspaceId(workspaceId) {
  return String(workspaceId || "").startsWith(PRACTICE_PREFIX);
}

/**
 * @param {Object} request  callable (auth)
 * @param {Object} deps     { db, HttpsError, serverTimestamp }
 */
async function ensurePracticeWorkspaceHandler(request, { db, HttpsError, serverTimestamp }) {
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }

  const workspaceId = practiceWorkspaceId(uid);
  const memberships = await db.collection("users").doc(uid).collection("workspaces").get();
  const realUnits = memberships.docs.filter(docSnap =>
    !isPracticeWorkspaceId(docSnap.id) && docSnap.data()?.practice !== true
  );

  if (!realUnits.length) {
    throw new HttpsError(
      "permission-denied",
      "La unidad de práctica es para supervisores y administradores de una unidad."
    );
  }

  const token = request.auth.token || {};
  const workspaceRef = db.collection("workspaces").doc(workspaceId);
  let created = false;

  await db.runTransaction(async transaction => {
    const snap = await transaction.get(workspaceRef);

    if (snap.exists) return;

    const now = serverTimestamp();

    created = true;
    transaction.set(workspaceRef, {
      id: workspaceId,
      name: PRACTICE_NAME,
      ownerUid: uid,
      // Mismo formato de almacenamiento que una unidad nueva (workspaces.js).
      stateStorage: "entries-v1",
      replacementStorage: "records-shadow-v1",
      auditLogStorage: "shards-shadow-v1",
      createdByEmail: String(token.email || ""),
      practice: true,
      createdAt: now,
      updatedAt: now
    });
    transaction.set(workspaceRef.collection("members").doc(uid), {
      role: "owner",
      email: String(token.email || ""),
      displayName: String(token.name || ""),
      joinedAt: now,
      practice: true
    });
    transaction.set(db.collection("users").doc(uid).collection("workspaces").doc(workspaceId), {
      name: PRACTICE_NAME,
      role: "owner",
      joinedAt: now,
      practice: true
    });
  });

  return { workspaceId, created };
}

/**
 * Borra el contenido de la unidad de practica de quien llama (todo menos sus
 * miembros), para volver a los datos de partida.
 */
async function resetPracticeWorkspaceHandler(request, { db, HttpsError, serverTimestamp }) {
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }

  const workspaceId = practiceWorkspaceId(uid);
  const workspaceRef = db.collection("workspaces").doc(workspaceId);
  const snap = await workspaceRef.get();
  const data = snap.data() || {};

  // Solo la PROPIA unidad de practica: nunca una unidad real.
  if (!snap.exists || data.practice !== true || data.ownerUid !== uid) {
    throw new HttpsError("failed-precondition", "No tienes una unidad de práctica que reiniciar.");
  }

  const collections = await workspaceRef.listCollections();

  for (const collection of collections) {
    if (collection.id === "members") continue;
    await db.recursiveDelete(collection);
  }

  await workspaceRef.set({
    practiceResetAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  return { workspaceId, reset: true };
}

module.exports = {
  PRACTICE_PREFIX,
  practiceWorkspaceId,
  isPracticeWorkspaceId,
  ensurePracticeWorkspaceHandler,
  resetPracticeWorkspaceHandler
};
