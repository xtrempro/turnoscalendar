// Entry del motor de cobertura automatica para correr en el SERVIDOR.
//
// esbuild lo empaqueta a functions/engine/autoCoverage.mjs (ver
// build-engine.mjs) y la Cloud Function `advanceAutoCoverage` lo importa con un
// shim de localStorage/window sembrado desde el estado del workspace, igual que
// hace engineHarness.js con el motor de proyeccion.
//
// Por que existe: las etapas de la cobertura son de 24 horas y no pueden
// depender de que un supervisor tenga la pagina abierta. Pero decidir a quien se
// le manda la oleada siguiente exige el motor de candidatos completo -reglas de
// 24 invertido, adyacencia de 24 por preasignacion, turnos cedidos, tope de
// horas extras diurnas del mes DEL TURNO-, asi que el servidor corre EXACTAMENTE
// los mismos modulos que el navegador. Nada de esto esta reescrito aqui: este
// archivo solo une piezas y siembra lo que en el navegador llega por listeners
// de Firestore (enlaces de la PWA y dias bloqueados).
//
// Importa SOLO modulos de computo: ni firebase-client, ni DOM, ni el modulo de
// sincronizacion. Si alguna vez deja de empaquetar, es que alguien le agrego a
// esta cadena un import con Firestore adentro.

import { fetchHolidays, clearHolidaysCache } from "./holidays.js";
import {
    buildReplacementCandidates,
    getReplacementNeededTurn
} from "./replacementCandidates.js";
import {
    buildPlan,
    dueSteps,
    normalizeCampaign,
    selectStageTargets,
    shiftStartInstant,
    stageLabel
} from "./autoCoveragePlan.js";
import {
    createReplacementRequests,
    getPendingReplacementRequestsForShift,
    coveredShiftIsFullyCovered,
    turnoReplacementLabel
} from "./replacements.js";
import { getPreassignmentForCoveredShift } from "./preassignments.js";
import { isNoCoverageDay } from "./storage.js";
import { getAbsenceLabelForProfileDate } from "./replacements.js";
import {
    getWorkerAppLinkForProfile,
    setWorkerAppLinks
} from "./workerAppLinks.js";
import {
    normalizeBlockedDay,
    setWorkerBlockedDays
} from "./workerBlockedDays.js";
import {
    scheduledEntryTime,
    shiftStartsInTheMorning
} from "./attendanceDelay.js";

// Se reexporta lo que la Cloud Function necesita para decidir sin reimplementar.
export {
    buildPlan,
    clearHolidaysCache,
    dueSteps,
    normalizeCampaign,
    stageLabel
};

/**
 * Siembra lo que en el navegador llega por listeners: los enlaces de la PWA
 * (quien puede recibir la solicitud) y los dias que el trabajador bloqueo.
 * La Cloud Function los lee de sus colecciones y los pasa tal cual.
 */
export function seedAutoCoverageContext({ workerLinks = [], blockedDays = [] } = {}) {
    setWorkerAppLinks(workerLinks);
    // Los dias bloqueados se normalizan aca y no en quien los lee: la Cloud
    // Function entrega los documentos crudos, y el filtro necesita el nombre
    // normalizado que arma normalizeBlockedDay.
    setWorkerBlockedDays(
        blockedDays
            .map(day => normalizeBlockedDay(day?.id, day))
            .filter(Boolean)
    );
}

/**
 * .Sigue haciendo falta cubrir este turno?
 *
 * Es la misma comprobacion barata del navegador: si el supervisor ya asigno un
 * reemplazo, lo preasigno o lo marco "no requiere cobertura", la campaña se
 * cierra sin calcular candidatos.
 */
export function shiftStillNeedsCoverage(replaced, keyDay) {
    if (isNoCoverageDay(replaced, keyDay)) return false;
    // Cubierto ENTERO: con la jornada recortada de quien cubre quedan horas sin
    // nadie, y la campaña no puede darse por terminada (ver js/shiftCoverage.js).
    if (coveredShiftIsFullyCovered(replaced, keyDay)) return false;
    if (getPreassignmentForCoveredShift(replaced, keyDay)) return false;

    return true;
}

/**
 * Instante de inicio del turno, con la misma hora de ingreso que usa el resto
 * del app para medir atrasos.
 */
export function shiftStartInstantForTurn(keyDay, turno) {
    return shiftStartInstant(
        keyDay,
        scheduledEntryTime(Number(turno)),
        shiftStartsInTheMorning(Number(turno))
    );
}

/**
 * Corre UNA etapa de una campaña y devuelve lo que hay que escribir.
 *
 * No toca Firestore: arma las solicitudes con el mismo `createReplacementRequests`
 * del navegador -por eso los documentos salen identicos, campo por campo- y las
 * devuelve para que la Cloud Function las escriba. El almacen local que ese
 * helper actualiza es el shim en memoria de esta invocacion y se descarta.
 *
 * Devuelve:
 *   { closed: true }                      ya no hay nada que cubrir
 *   { ran, requests }                     etapa corrida (requests puede ir vacio)
 */
export async function runAutoCoverageStep(campaign, step) {
    const replaced = String(campaign?.replaced || "");
    const keyDay = String(campaign?.keyDay || "");

    if (!replaced || !keyDay) return { closed: true };
    if (!shiftStillNeedsCoverage(replaced, keyDay)) return { closed: true };

    const neededTurn = getReplacementNeededTurn(replaced, keyDay);

    if (!neededTurn) return { closed: true };

    const ran = { ...step, ranAt: new Date().toISOString() };

    // La alerta pura del camino corto no manda solicitudes: solo levanta el
    // aviso al supervisor.
    if (step.kind === "alert") return { ran, requests: [] };

    const year = Number(String(keyDay).split("-")[0]);
    const holidays = await fetchHolidays(year);
    const built = await buildReplacementCandidates(replaced, keyDay, {
        neededTurn,
        holidays,
        // En el servidor no hay hilo de interfaz que cuidar: se recorre de
        // corrido en vez de ceder el control entre trabajador y trabajador.
        runRange: async (from, to, handler) => {
            for (let index = from; index <= to; index++) {
                await handler(index);
            }

            return { completed: true, processed: Math.max(0, to - from + 1) };
        }
    });

    if (!built.completed) return { ran: null, requests: [] };

    const pending = new Set(
        getPendingReplacementRequestsForShift(replaced, keyDay, neededTurn)
            .map(request => request.worker)
    );
    const { eligible, selected, targets, overLimit } = selectStageTargets(
        campaign,
        step,
        built.candidates,
        {
            hasApp: name => Boolean(getWorkerAppLinkForProfile(name)),
            pending
        }
    );

    ran.poolSize = eligible.length;
    ran.overLimit = overLimit;

    if (!targets.length) {
        ran.note = selected.length ? "sin-app-o-ya-pendiente" : "sin-candidatos";
        return { ran, requests: [] };
    }

    const requests = createReplacementRequests(
        {
            replaced,
            keyDay,
            turno: neededTurn,
            absenceType:
                getAbsenceLabelForProfileDate(replaced, keyDay) ||
                campaign.absenceType,
            scope: "compatible",
            source: "replacement_request",
            diurnoLongCoverageWorkers: targets
                .filter(candidate => candidate.isDiurnoLongCoverage)
                .map(candidate => candidate.profile.name),
            workerCoverage: Object.fromEntries(
                targets.map(candidate => [
                    candidate.profile.name,
                    {
                        diurnoLongCoverage:
                            Boolean(candidate.isDiurnoLongCoverage),
                        overtimeHours: candidate.overtimeHours || null
                    }
                ])
            )
        },
        targets.map(candidate => candidate.profile.name)
    );

    ran.groupId = requests[0]?.groupId || "";
    ran.sent = requests.map(request => request.worker);
    ran.requestIds = requests.map(request => request.id);

    return { ran, requests };
}

/**
 * Etiqueta del turno, para que la Cloud Function pueda rellenar una campaña
 * antigua a la que le falte.
 */
export function turnLabel(turno) {
    return turnoReplacementLabel(turno);
}
