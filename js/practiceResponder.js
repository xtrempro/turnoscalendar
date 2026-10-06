// Trabajadores ficticios que responden (solo en la unidad de practica).
//
// En la unidad de practica nadie tiene de verdad la app, asi que las
// solicitudes de cobertura se quedarian pendientes para siempre. Este modulo
// hace de "trabajadores": a cada solicitud enviada a la app le toca una
// respuesta (aceptar, rechazar o no contestar) y un momento (a los pocos
// segundos, a los minutos), y la escribe en Firestore EXACTAMENTE como la
// escribe la PWA (www/js/app.js, respondToReplacementRequest). Asi la respuesta
// vuelve por el mismo camino que una real: el listener de solicitudes la trae,
// se aplica el reemplazo al primero que acepto, etc.
//
// La respuesta de cada solicitud sale de su id (siempre la misma), y su momento
// cuenta desde que se creo: si la pagina estuvo cerrada, al volver se ponen al
// dia las que ya "contestaron" mientras tanto.

import { getFirebaseServices } from "./firebaseClient.js";
import { getReplacementRequests } from "./storage.js";
import { isPracticeWorkspace } from "./practiceUnit.js";

const TICK_MS = 2000;
// Margen antes del vencimiento: nadie contesta en el ultimo segundo.
const EXPIRY_MARGIN_MS = 20 * 1000;

let timer = null;
let activeWorkspaceId = "";
// Las ya contestadas en esta sesion: el listener tarda un momento en traerlas
// resueltas y no hay que contestarlas dos veces (la hora de aceptacion decide
// quien se queda con el turno).
const answered = new Set();

// Tres numeros en [0, 1) a partir del id: la misma solicitud, la misma suerte.
function idRandoms(id) {
    const values = [];

    for (const salt of ["respuesta", "demora", "rango"]) {
        let hash = 2166136261;

        for (const char of `${salt}:${id}`) {
            hash ^= char.charCodeAt(0);
            hash = Math.imul(hash, 16777619);
        }

        // Mezcla final (de murmur3): con ids parecidos FNV solo deja sesgos.
        hash ^= hash >>> 16;
        hash = Math.imul(hash, 0x85ebca6b);
        hash ^= hash >>> 13;
        hash = Math.imul(hash, 0xc2b2ae35);
        hash ^= hash >>> 16;

        values.push((hash >>> 0) / 4294967296);
    }

    return values;
}

function timeOf(value) {
    if (!value) return NaN;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.seconds === "number") return value.seconds * 1000;

    return new Date(value).getTime();
}

/**
 * Que contesta el trabajador ficticio y cuando.
 *
 * - La mitad acepta, un tercio rechaza y el resto no contesta (vence).
 * - Cuatro de cada diez contestan en segundos (4-40 s), otros cuatro en
 *   minutos (1-5 min) y el resto se demora (5-12 min).
 * - Nunca despues del vencimiento: si no alcanza, no contesta.
 *
 * @returns {{ outcome: "accepted"|"rejected"|"none", respondAt: number }}
 */
export function practiceResponsePlan(request) {
    const [answer, speed, within] = idRandoms(String(request?.id || ""));
    const createdAt = timeOf(request?.createdAt);
    const expiresAt = timeOf(request?.expiresAt);
    const outcome = answer < 0.5 ? "accepted" : answer < 0.85 ? "rejected" : "none";
    const delayMs = speed < 0.4
        ? 4000 + within * 36000
        : speed < 0.8
            ? 60000 + within * 240000
            : 300000 + within * 420000;

    if (outcome === "none" || !Number.isFinite(createdAt)) {
        return { outcome: "none", respondAt: Infinity };
    }

    const respondAt = createdAt + delayMs;

    if (Number.isFinite(expiresAt) && respondAt > expiresAt - EXPIRY_MARGIN_MS) {
        return { outcome: "none", respondAt: Infinity };
    }

    return { outcome, respondAt };
}

/** Las solicitudes que a esta hora ya tienen respuesta. */
export function duePracticeResponses(requests, now = Date.now()) {
    return (requests || [])
        .filter(request =>
            request?.id &&
            request.status === "pending" &&
            request.channel === "app"
        )
        .map(request => ({ request, plan: practiceResponsePlan(request) }))
        .filter(({ plan }) => plan.outcome !== "none" && plan.respondAt <= now);
}

function requestDocId(request) {
    return encodeURIComponent(String(request?.id || "").trim())
        .replace(/\./g, "%2E");
}

async function respond(workspaceId, request, status) {
    const { db, firestoreModule } = await getFirebaseServices();
    const ref = firestoreModule.doc(
        db,
        "workspaces",
        workspaceId,
        "replacementRequests",
        requestDocId(request)
    );
    const now = firestoreModule.serverTimestamp();
    const accepted = status === "accepted";

    // Lo mismo que escribe la PWA al responder.
    await firestoreModule.updateDoc(ref, {
        status,
        responseAt: now,
        updatedAt: now,
        notificationStatus: accepted ? "accepted_by_worker" : "rejected_by_worker",
        ...(accepted ? { acceptedAt: now } : { rejectedAt: now })
    });
}

function tick() {
    const workspaceId = activeWorkspaceId;

    if (!workspaceId) return;

    duePracticeResponses(getReplacementRequests()).forEach(({ request, plan }) => {
        if (answered.has(request.id)) return;

        answered.add(request.id);
        respond(workspaceId, request, plan.outcome)
            .catch(error => {
                // Recien creada y todavia sin subir (not-found), o un corte de
                // red: el proximo tick lo vuelve a intentar.
                answered.delete(request.id);

                if (error?.code !== "not-found") {
                    console.warn("La respuesta simulada no se pudo escribir.", error);
                }
            });
    });
}

/** Empieza a responder, solo si la unidad es de practica. */
export function startPracticeResponder(workspace) {
    stopPracticeResponder();

    if (!isPracticeWorkspace(workspace)) return;

    activeWorkspaceId = workspace.id;
    timer = setInterval(tick, TICK_MS);
}

export function stopPracticeResponder() {
    clearInterval(timer);
    timer = null;
    activeWorkspaceId = "";
    answered.clear();
}
