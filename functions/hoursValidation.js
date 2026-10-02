"use strict";

// Visto bueno del trabajador a sus horas del mes (Anexo 2).
//
// Solo lo registra esta callable, nunca un cliente directo (las reglas niegan
// toda escritura en hoursValidations). Asi el visto bueno acredita QUIEN lo dio
// y SOBRE QUE horas:
//  - la identidad sale del enlace real workerLinks/{uid} del que llama, no de
//    un nombre o RUT enviados por el cliente;
//  - la huella de horas sale de lo que publico la unidad para ese trabajador y
//    mes (workerAppData/{uid}.reportValidationByMonth); la del cliente solo se
//    usa para confirmar que valido lo que estaba viendo;
//  - la fecha es la del servidor.
//
// Donde queda:
//  - workspaces/{ws}/hoursValidations/{uid}_{AAAA-MM}: el estado vigente (un
//    documento por trabajador y mes, se consulta por monthKey);
//  - .../events/{id}: cada visto bueno, inmutable, para la trazabilidad.
// Preparado para la firma: el evento guardara la huella del documento firmado.

const MAX_SIGNATURE_LENGTH = 40;

function cleanText(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function fail(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function monthKeyFor(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function hoursValidationDocId(uid, year, month) {
  return `${uid}_${monthKeyFor(year, month)}`;
}

function readInput(request, HttpsError) {
  const uid = request.auth?.uid || "";

  if (!uid) fail(HttpsError, "unauthenticated", "Debes iniciar sesión para validar tus horas.");

  const data = request.data || {};
  const workspaceId = cleanText(data.workspaceId, 160);
  const year = Number(data.year);
  const month = Number(data.month);
  const signature = cleanText(data.signature, MAX_SIGNATURE_LENGTH);

  if (!workspaceId || workspaceId.includes("/")) {
    fail(HttpsError, "invalid-argument", "No fue posible identificar la unidad.");
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 0 || month > 11) {
    fail(HttpsError, "invalid-argument", "El mes a validar no es válido.");
  }
  if (!signature) fail(HttpsError, "invalid-argument", "Falta la huella de las horas que revisaste.");

  return { uid, workspaceId, year, month, signature };
}

/**
 * @param {Object} request de onCall
 * @param {Object} deps { db, HttpsError, serverTimestamp, nowMillis }
 */
async function approveMonthlyHoursHandler(request, {
  db,
  HttpsError,
  serverTimestamp,
  nowMillis = () => Date.now()
}) {
  const { uid, workspaceId, year, month, signature } = readInput(request, HttpsError);
  const workspaceRef = db.collection("workspaces").doc(workspaceId);
  const linkSnap = await workspaceRef.collection("workerLinks").doc(uid).get();

  if (!linkSnap.exists) {
    fail(HttpsError, "permission-denied", "Tu cuenta no está enlazada con esta unidad.");
  }

  const link = linkSnap.data() || {};
  const profileName = cleanText(link.profileName, 200);

  if (!profileName || link.status === "unlinked") {
    fail(HttpsError, "permission-denied", "Tu cuenta no está enlazada con esta unidad.");
  }

  const appSnap = await workspaceRef.collection("workerAppData").doc(uid).get();
  const appData = appSnap.exists ? appSnap.data() || {} : {};
  const reportKey = `${year}-${month}`;
  const published = appData.reportValidationByMonth?.[reportKey];

  if (!published || typeof published !== "object" || !cleanText(published.signature, MAX_SIGNATURE_LENGTH)) {
    fail(HttpsError, "failed-precondition", "Tu Anexo 2 de ese mes todavía no está disponible.");
  }
  if (published.hasOvertime !== true) {
    fail(HttpsError, "failed-precondition", "Ese mes no tienes horas extras que validar.");
  }

  const serverSignature = cleanText(published.signature, MAX_SIGNATURE_LENGTH);

  if (serverSignature !== signature) {
    fail(HttpsError, "aborted", "Tus horas se actualizaron. Revisa el Anexo 2 de nuevo antes de validar.");
  }

  const monthKey = monthKeyFor(year, month);
  const stateRef = workspaceRef.collection("hoursValidations").doc(hoursValidationDocId(uid, year, month));
  const validatedAtMillis = nowMillis();
  const record = {
    uid,
    workspaceId,
    profileName,
    profileRut: cleanText(link.profileRut || appData.profileRut, 40),
    profileId: cleanText(link.profileId, 160),
    year,
    month,
    monthKey,
    reportMonthKey: reportKey,
    signature: serverSignature,
    totalDay: Number(published.totalDay) || 0,
    totalFestive: Number(published.totalFestive) || 0,
    source: "worker_app"
  };

  return db.runTransaction(async transaction => {
    const current = await transaction.get(stateRef);
    const previous = current.exists ? current.data() || {} : null;

    // Mismas horas ya validadas: no se repite el evento.
    if (previous && previous.signature === serverSignature && previous.uid === uid) {
      return {
        status: "validated",
        monthKey,
        signature: serverSignature,
        validatedAtMillis: Number(previous.validatedAtMillis) || null,
        alreadyValidated: true
      };
    }

    const eventRef = stateRef.collection("events").doc();

    transaction.set(stateRef, {
      ...record,
      validatedAt: serverTimestamp(),
      validatedAtMillis,
      lastEventId: eventRef.id,
      validationCount: (Number(previous?.validationCount) || 0) + 1
    });
    transaction.set(eventRef, {
      ...record,
      type: "validated",
      previousSignature: previous?.signature || null,
      validatedAt: serverTimestamp(),
      validatedAtMillis
    });

    return {
      status: "validated",
      monthKey,
      signature: serverSignature,
      validatedAtMillis,
      alreadyValidated: false
    };
  });
}

module.exports = {
  approveMonthlyHoursHandler,
  hoursValidationDocId,
  monthKeyFor
};
