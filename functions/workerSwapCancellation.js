"use strict";

const {
  normalizeSwapKind,
  canCancelSwapStatus,
  isFinalSwapStatus
} = require("./swapCancellation");

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function cancellationError(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

async function cancelWorkerSwapHandler(request, dependencies) {
  const { db, serverTimestamp, HttpsError } = dependencies;
  const uid = request.auth?.uid;
  const workspaceId = cleanText(request.data?.workspaceId, 160);
  const requestId = cleanText(request.data?.requestId, 220);
  const kind = normalizeSwapKind(request.data?.kind);

  if (!uid) {
    cancellationError(
      HttpsError,
      "unauthenticated",
      "Debes iniciar sesion para anular el cambio de turno."
    );
  }
  if (!workspaceId || !requestId || !kind) {
    cancellationError(
      HttpsError,
      "invalid-argument",
      "No fue posible identificar el cambio de turno."
    );
  }

  const workspaceRef = db.collection("workspaces").doc(workspaceId);
  const linkSnap = await workspaceRef.collection("workerLinks").doc(uid).get();

  if (!linkSnap.exists) {
    cancellationError(
      HttpsError,
      "permission-denied",
      "Tu cuenta ya no esta enlazada con esta unidad."
    );
  }

  if (kind === "direct") {
    const swapRef = workspaceRef.collection("workerSwapRequests").doc(requestId);

    await db.runTransaction(async (transaction) => {
      const swapSnap = await transaction.get(swapRef);
      const swap = swapSnap.data() || {};

      if (!swapSnap.exists) {
        cancellationError(HttpsError, "not-found", "El cambio de turno ya no existe.");
      }
      if (swap.createdByUid !== uid) {
        cancellationError(
          HttpsError,
          "permission-denied",
          "Solo quien creo la solicitud puede anularla."
        );
      }
      if (!canCancelSwapStatus(swap.status)) {
        cancellationError(
          HttpsError,
          "failed-precondition",
          "El cambio de turno ya fue resuelto y no puede anularse."
        );
      }

      let supervisorRef = null;
      let supervisorSnap = null;
      if (swap.supervisorRequestId) {
        supervisorRef = workspaceRef
          .collection("workerRequests")
          .doc(swap.supervisorRequestId);
        supervisorSnap = await transaction.get(supervisorRef);
        if (
          supervisorSnap.exists &&
          isFinalSwapStatus(supervisorSnap.data()?.status)
        ) {
          cancellationError(
            HttpsError,
            "failed-precondition",
            "El supervisor ya resolvio esta solicitud."
          );
        }
      }

      const cancellation = {
        status: "canceled",
        canceledByUid: uid,
        canceledAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      transaction.set(swapRef, cancellation, { merge: true });

      if (supervisorRef && supervisorSnap?.exists) {
        transaction.set(supervisorRef, cancellation, { merge: true });
      }
    });
  } else {
    const openRef = workspaceRef
      .collection("workerSwapOpenRequests")
      .doc(requestId);
    const offersQuery = workspaceRef
      .collection("workerSwapRequests")
      .where("groupId", "==", requestId);

    await db.runTransaction(async (transaction) => {
      const openSnap = await transaction.get(openRef);
      const openSwap = openSnap.data() || {};

      if (!openSnap.exists) {
        cancellationError(HttpsError, "not-found", "El cambio abierto ya no existe.");
      }
      if (openSwap.createdByUid !== uid) {
        cancellationError(
          HttpsError,
          "permission-denied",
          "Solo quien creo la solicitud puede anularla."
        );
      }
      if (!canCancelSwapStatus(openSwap.status)) {
        cancellationError(
          HttpsError,
          "failed-precondition",
          "El cambio abierto ya fue resuelto y no puede anularse."
        );
      }

      const offersSnap = await transaction.get(offersQuery);
      const winner = offersSnap.docs.find((offer) =>
        offer.id === openSwap.winnerRequestId ||
        offer.data()?.status === "pending_supervisor"
      );
      const supervisorRequestId =
        winner?.data()?.supervisorRequestId || openSwap.supervisorRequestId || "";
      let supervisorRef = null;
      let supervisorSnap = null;

      if (supervisorRequestId) {
        supervisorRef = workspaceRef
          .collection("workerRequests")
          .doc(supervisorRequestId);
        supervisorSnap = await transaction.get(supervisorRef);
        if (
          supervisorSnap.exists &&
          isFinalSwapStatus(supervisorSnap.data()?.status)
        ) {
          cancellationError(
            HttpsError,
            "failed-precondition",
            "El supervisor ya resolvio esta solicitud."
          );
        }
      }

      const cancellation = {
        status: "canceled",
        canceledByUid: uid,
        canceledAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      transaction.set(openRef, cancellation, { merge: true });
      offersSnap.docs.forEach((offer) => {
        if (canCancelSwapStatus(offer.data()?.status)) {
          transaction.set(offer.ref, cancellation, { merge: true });
        }
      });
      if (supervisorRef && supervisorSnap?.exists) {
        transaction.set(supervisorRef, cancellation, { merge: true });
      }
    });
  }

  return { ok: true, requestId, kind, status: "canceled" };
}

module.exports = { cancelWorkerSwapHandler };
