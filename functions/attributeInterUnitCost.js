"use strict";

// ============================================================================
//  attributeInterUnitCost — Cloud Function (v2 callable)
// ============================================================================
//
//  Va en turnoplus.cl (ProTurnos/functions/). Ver functions-src/README.md.
//
//  Atribuye el COSTO HHEE de un turno de préstamo entre unidades a la unidad
//  que RECIBE al trabajador (host), aunque el reporte de las horas lo emita la
//  unidad de ORIGEN (source). La regla de negocio: el gasto se imputa a la
//  unidad donde el trabajador realiza el reemplazo.
//
//  Quién llama: el publicador de resúmenes de la unidad ORIGEN (que tiene el
//  perfil del trabajador y por tanto su grado → valor hora real). El origen
//  calcula el costo con la fórmula estándar HHEE, lo descuenta de su propio
//  gasto, y llama a esta función para escribir el costo en el documento del
//  préstamo (source y host). Luego el publicador del HOST lee ese costo y lo
//  suma a su propio gasto HHEE. Usa Admin SDK (los clientes no pueden escribir
//  loanAssignments según las reglas).
//
//  data: { sourceWorkspaceId, loanId, hheeCostClp, month }
// ============================================================================

const admin = require("firebase-admin");
const { logger } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = "southamerica-west1";
const ENFORCE_APP_CHECK = true;

function cleanText(v, max) { return String(v || "").trim().slice(0, max); }

const attributeInterUnitCost = onCall(
    { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30 },
    async (request) => {
        const uid = request.auth && request.auth.uid;
        if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión para continuar.");

        const sourceWorkspaceId = cleanText(request.data && request.data.sourceWorkspaceId, 160);
        const loanId = cleanText(request.data && request.data.loanId, 200);
        const month = cleanText(request.data && request.data.month, 7);
        const hheeCostClp = Math.round(Number(request.data && request.data.hheeCostClp) || 0);

        if (!sourceWorkspaceId || !loanId || !/^\d{4}-\d{2}$/.test(month) || hheeCostClp < 0) {
            throw new HttpsError("invalid-argument", "Datos de atribución inválidos.");
        }

        // El llamador debe ser miembro de la unidad ORIGEN del préstamo.
        const memberSnap = await db.collection("workspaces").doc(sourceWorkspaceId)
            .collection("members").doc(uid).get();
        if (!memberSnap.exists) {
            throw new HttpsError("permission-denied", "No perteneces a la unidad de origen del préstamo.");
        }

        const sourceRef = db.collection("workspaces").doc(sourceWorkspaceId)
            .collection("loanAssignments").doc(loanId);
        const sourceDoc = await sourceRef.get();
        if (!sourceDoc.exists) throw new HttpsError("not-found", "Préstamo no encontrado.");

        const loan = sourceDoc.data() || {};
        if (String(loan.sourceWorkspaceId || "") !== sourceWorkspaceId) {
            throw new HttpsError("failed-precondition", "El préstamo no pertenece a esta unidad de origen.");
        }
        const hostWorkspaceId = cleanText(loan.hostWorkspaceId, 160);

        const patch = {
            hheeCostClp,
            hheeCostMonth: month,
            hheeCostUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            hheeCostByUid: uid
        };

        const writes = [sourceRef.set(patch, { merge: true })];
        if (hostWorkspaceId) {
            writes.push(
                db.collection("workspaces").doc(hostWorkspaceId)
                    .collection("loanAssignments").doc(loanId)
                    .set(patch, { merge: true })
            );
        }
        await Promise.all(writes);

        logger.info("Costo de préstamo atribuido al host.", { loanId, sourceWorkspaceId, hostWorkspaceId, hheeCostClp, month });
        return { ok: true, loanId, hostWorkspaceId, hheeCostClp };
    }
);

module.exports = { attributeInterUnitCost };
