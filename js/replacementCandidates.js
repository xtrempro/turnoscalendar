// Motor de candidatos de reemplazo: quien puede cubrir un turno, con cuantas
// horas extras lleva del mes y que reglas lo dejan fuera.
//
// Vive fuera de calendar.js porque lo corren DOS lados:
//
//   - el navegador, para pintar el cuadro de sugerencias y para la primera
//     oleada de la cobertura automatica;
//   - la Cloud Function que hace avanzar las etapas de esa cobertura cuando el
//     supervisor no tiene la aplicacion abierta (functions/index.js ->
//     functions/engine/autoCoverage.mjs).
//
// Por eso aqui no hay DOM, ni Firestore, ni web worker: solo calculo sobre el
// estado. Duplicar estas reglas para el servidor habria sido peor que moverlas:
// el 24 invertido, el tope de horas extras diurnas y la adyacencia de turnos 24
// tienen que dar EXACTAMENTE lo mismo en los dos lados, o el servidor le
// ofreceria a alguien un turno que el navegador le niega.
//
// El orden de presentacion (prioridad por rotativa, tarjeta amarilla, tope) NO
// esta aqui: eso lo hace el worker de busqueda, y solo le importa a la lista que
// se dibuja. La cobertura automatica reordena por horas extras y no lo usa.

import { getJSON } from "./persistence.js";
import {
    getProfileData,
    getProfiles,
    getRotativa,
    getTurnChangeConfig,
    isProfileActive,
    profileCanCoverProfile
} from "./storage.js";
import {
    aplicarCambiosTurno,
    fusionarTurnos,
    getTurnoBase,
    getTurnoProgramado
} from "./turnEngine.js";
import {
    getAbsenceType,
    getTurnoExtraAgregado,
    restarTurnoCubierto,
    tieneAusencia,
    turnoExtraCubreTurno
} from "./rulesEngine.js";
import { getBackedTurnForWorker } from "./replacements.js";
import { calcExtraHours, isBusinessDay } from "./calculations.js";
import { calculateWorkerMonthTotals } from "./hoursEngine.js";
import { getBlockedDayForProfile } from "./workerBlockedDays.js";
import { cededSwapTurnBlocks } from "./swaps.js";
import { getPreassignmentTurnForWorker } from "./preassignments.js";
import {
    contingencyCoversTurn,
    contingencyIsImminent,
    getContingencyKind
} from "./contingency.js";
import { rotationPositionLabel } from "./rotationUtils.js";
import { runCooperativeRange } from "./mainThreadScheduler.js";
import { TURNO } from "./constants.js";

// Tope mensual de horas extras DIURNAS. La cobertura automatica no le ofrece un
// turno a quien quedaria por encima: seria pedirle que acepte algo que despues
// no se le puede pagar.
export const MAX_MONTHLY_DIURNAL_OVERTIME = 40;

// Horas extras que le sumaria al candidato cubrir este turno. Para los casos
// parciales -capacitacion, diurno cubriendo larga, media tarde- el candidato ya
// trae calculado cuanto suma; para el resto es el turno completo.
export function coverageOvertimeHours(candidate, date, neededTurn, holidays) {
    // calcExtraHours aplica la regla del turno extra: un diurno vale 9 h de
    // lunes a jueves y 8 el viernes, no el promedio de 8,8 que devolveria
    // calcHours. Sin eso el tope compararia contra un numero distinto del que
    // el motor le va a acreditar al trabajador.
    return candidate?.overtimeHours ||
        calcExtraHours(date, Number(neededTurn), holidays || {});
}

export function exceedsDiurnalOvertimeLimit(
    candidate,
    date,
    neededTurn,
    holidays,
    limit = MAX_MONTHLY_DIURNAL_OVERTIME
) {
    const accumulated = Number(candidate?.hheeDiurnas) || 0;
    const adding = Number(
        coverageOvertimeHours(candidate, date, neededTurn, holidays).d
    ) || 0;

    // Quedar EN el tope esta permitido; pasarlo, no.
    return accumulated + adding > limit;
}

export function getActualState(profileName, keyDay) {
    return aplicarCambiosTurno(
        profileName,
        keyDay,
        getTurnoProgramado(profileName, keyDay)
    );
}

export function offsetCalendarKey(keyDay, offset) {
    const parts = String(keyDay || "")
        .split("-")
        .map(Number);

    if (parts.length !== 3 || parts.some(Number.isNaN)) return "";

    const date = new Date(parts[0], parts[1], parts[2] + offset);

    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function replacementTurnIncludesDaytimeStart(turn) {
    const value = Number(turn) || TURNO.LIBRE;

    return (
        value === TURNO.LARGA ||
        value === TURNO.TURNO24 ||
        value === TURNO.DIURNO ||
        value === TURNO.DIURNO_NOCHE ||
        value === TURNO.MEDIA_MANANA ||
        value === TURNO.MEDIA_TARDE
    );
}

export function replacementTurnIncludesNight(turn) {
    const value = Number(turn) || TURNO.LIBRE;

    return (
        value === TURNO.NOCHE ||
        value === TURNO.TURNO24 ||
        value === TURNO.DIURNO_NOCHE ||
        value === TURNO.TURNO18
    );
}

// Turnos que ENTRAN por la mañana (08:00). La media tarde queda fuera a
// proposito: parte a las 14:00, asi que despues de una noche todavia queda la
// mañana para dormir.
export function replacementTurnStartsInTheMorning(turn) {
    const value = Number(turn) || TURNO.LIBRE;

    return (
        value === TURNO.LARGA ||
        value === TURNO.TURNO24 ||
        value === TURNO.DIURNO ||
        value === TURNO.DIURNO_NOCHE ||
        value === TURNO.MEDIA_MANANA
    );
}

/**
 * Turno que el candidato tiene al dia siguiente cuando lo que se va a cubrir es
 * una noche, y ese turno empieza por la mañana. La noche termina a las 08:00 y
 * el turno siguiente parte a las 08:00: encadena la jornada sin dormir (el "24
 * invertido" o noche + diurno). No bloquea al candidato -a veces es la unica
 * opcion disponible- pero la tarjeta tiene que decirlo antes de asignar.
 *
 * Se mira el estado COMPROMETIDO (real/proyectado mas preasignaciones), no la
 * rotativa base: si al dia siguiente ya le movieron la Larga, no hay advertencia
 * que dar.
 */
export function nextDayMorningShiftAfterNight(profileName, keyDay, neededTurn) {
    if (!profileName || !keyDay) return TURNO.LIBRE;
    if (!replacementTurnIncludesNight(neededTurn)) return TURNO.LIBRE;

    const next = committedStateWithPreassign(
        profileName,
        offsetCalendarKey(keyDay, 1)
    );

    return replacementTurnStartsInTheMorning(next)
        ? next
        : TURNO.LIBRE;
}

export function candidateFreePositionKind(positionLabel = "") {
    const normalized = String(positionLabel || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

    if (normalized.includes("segundo libre")) return "segundo-libre";
    if (normalized.includes("primer libre")) return "primer-libre";

    return "";
}

export function preferredFreePositionKind(neededTurn) {
    if (
        replacementTurnIncludesNight(neededTurn) &&
        !replacementTurnIncludesDaytimeStart(neededTurn)
    ) {
        return "primer-libre";
    }

    if (replacementTurnIncludesDaytimeStart(neededTurn)) {
        return "segundo-libre";
    }

    return "";
}

export function replacementPriorityForCandidate(candidate, neededTurn) {
    const preferred = preferredFreePositionKind(neededTurn);
    const kind = candidateFreePositionKind(candidate.positionLabel);

    if (!preferred || !kind) return 20;

    if (kind === preferred) return 0;

    if (
        kind === "primer-libre" ||
        kind === "segundo-libre"
    ) {
        return 5;
    }

    return 20;
}

export function replacementCreatesInvertedTwentyFour(
    profileName,
    keyDay,
    currentState,
    neededTurn,
    config = getTurnChangeConfig()
) {
    if (
        !profileName ||
        !keyDay ||
        config.allowInvertedTwentyFourHourShifts !== false
    ) {
        return false;
    }

    const projected = fusionarTurnos(
        currentState,
        neededTurn
    );
    // Importante: se consulta el estado real/proyectado del dia siguiente,
    // no solo la rotativa base. Si el supervisor ya movio la Larga del dia
    // siguiente, getActualState devolvera Libre y el Segundo libre podra cubrir
    // Noche sin generar 24 invertido.
    const previous = getActualState(
        profileName,
        offsetCalendarKey(keyDay, -1)
    );
    const next = getActualState(
        profileName,
        offsetCalendarKey(keyDay, 1)
    );

    return (
        (
            replacementTurnIncludesDaytimeStart(projected) &&
            replacementTurnIncludesNight(previous)
        ) ||
        (
            replacementTurnIncludesNight(projected) &&
            replacementTurnIncludesDaytimeStart(next)
        )
    );
}

// Estado COMPROMETIDO del trabajador ese dia: su estado real/proyectado fusionado
// con lo que tenga PREASIGNADO (aun sin proyectar). Sirve para las reglas de
// compatibilidad: una preasignacion cuenta como si el turno ya estuviera tomado.
export function committedStateWithPreassign(profileName, keyDay) {
    return fusionarTurnos(
        getActualState(profileName, keyDay),
        getPreassignmentTurnForWorker(profileName, keyDay)
    );
}

// Un candidato NO debe sugerirse si, al cubrir el turno buscado, se formaria un 24
// incompatible con un dia adyacente (larga despues de un 24, noche antes de un 24)
// considerando sus preasignaciones. Al cancelar una preasignacion, el candidato
// vuelve a ser elegible.
//
// La adyacencia de 24h tiene UNA excepcion, que la unidad habilita a proposito:
// un Diurno pegado al dia siguiente de un 24h. Encadena 33 horas (08:00 del dia
// 1 a las 17:00 del dia 2), por eso viene apagada, y vale SOLO para el Diurno
// puro: una Larga, un D+N u otro 24 pegados a un 24 siguen prohibidos siempre.
// Es la misma condicion de turnoBloqueadoPorTurno24 (turnEngine.js), que es la
// regla canonica; aqui se repite porque esta version mira el estado COMPROMETIDO
// -real mas preasignaciones- y aquella mira el programado.
//
// Sin la excepcion, en una unidad que la tiene puesta el cuadro de sugerencias
// escondia justo al trabajador que podia cubrir el turno, y el supervisor
// terminaba armando el 24 a mano.
export function preassignmentBlocksReplacementCandidate(
    profileName,
    keyDay,
    neededTurn,
    config = getTurnChangeConfig()
) {
    const projected = fusionarTurnos(
        committedStateWithPreassign(profileName, keyDay),
        neededTurn
    );
    const previous = committedStateWithPreassign(
        profileName,
        offsetCalendarKey(keyDay, -1)
    );
    const next = committedStateWithPreassign(
        profileName,
        offsetCalendarKey(keyDay, 1)
    );
    const isTwentyFour = turno => Number(turno) === TURNO.TURNO24;
    const isPlainDiurno = turno => Number(turno) === TURNO.DIURNO;
    const diurnoPost24Permitido =
        config.allowDiurnoAfterTwentyFour === true;

    return (
        (isTwentyFour(previous) &&
            replacementTurnIncludesDaytimeStart(projected) &&
            !(diurnoPost24Permitido && isPlainDiurno(projected))) ||
        (isTwentyFour(next) &&
            replacementTurnIncludesNight(projected)) ||
        (isTwentyFour(projected) &&
            (replacementTurnIncludesNight(previous) ||
                (replacementTurnIncludesDaytimeStart(next) &&
                    !(diurnoPost24Permitido && isPlainDiurno(next)))))
    );
}

// Etiqueta de posicion del candidato dentro del bloque consecutivo del mismo
// turno (p.ej. "Primer libre", "Segunda larga"). Cuenta hacia atras cuantos dias
// seguidos tiene el mismo estado que el dia objetivo. Solo aplica a rotativas de
// tercer y cuarto turno; en otras (diurno, etc.) devuelve "" para caer en la
// etiqueta previa.
export function candidatePositionLabel(profileName, keyDay, currentState) {
    const rotationType = getRotativa(profileName).type;

    if (rotationType !== "3turno" && rotationType !== "4turno") {
        return "";
    }

    const parts = keyDay.split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    let position = 1;

    for (let back = 1; back <= 10; back++) {
        const previous = new Date(year, month, day - back);
        const previousKey =
            `${previous.getFullYear()}-${previous.getMonth()}-${previous.getDate()}`;

        if (getActualState(profileName, previousKey) !== currentState) {
            break;
        }

        position++;
    }

    return rotationPositionLabel(currentState, position);
}

export function isHalfAdminValue(value) {
    return (
        value === "0.5M" ||
        value === "0.5T" ||
        value === 0.5
    );
}

export function getHalfAdminCoverageTurn(profileName, keyDay) {
    const baseTurn = getTurnoBase(profileName, keyDay);

    if (baseTurn !== TURNO.LARGA) {
        return TURNO.LIBRE;
    }

    const admin = getJSON(`admin_${profileName}`, {});

    if (admin[keyDay] === "0.5M") {
        return TURNO.MEDIA_MANANA;
    }

    if (admin[keyDay] === "0.5T") {
        return TURNO.MEDIA_TARDE;
    }

    return TURNO.LIBRE;
}

export function getReplacementNeededTurn(profileName, keyDay) {
    const admin = getJSON(`admin_${profileName}`, {});

    if (isHalfAdminValue(admin[keyDay])) {
        return getHalfAdminCoverageTurn(profileName, keyDay);
    }

    return getTurnoBase(profileName, keyDay);
}

export function getTrainingAbsence(profileName, keyDay) {
    const absence = getJSON(`absences_${profileName}`, {})[keyDay];

    return getAbsenceType(absence) === "training"
        ? absence
        : null;
}

export function getTrainingCoverageHours(profileName, keyDay) {
    const absence = getTrainingAbsence(profileName, keyDay);
    const hours = absence?.overtimeHours;

    if (!hours) return null;

    return {
        d: Number(hours.d) || 0,
        n: Number(hours.n) || 0
    };
}

/**
 * .Tiene ya el turno que se necesita, puesto a mano y SIN motivo?
 *
 * Es el caso que dejaba a un trabajador fuera de las sugerencias sin razon: se
 * le agrego un turno a mano, quedo con el "?" porque nadie anoto por que, y
 * canCoverShift lo descartaba -ya tiene ese turno, no hay nada que sumarle-.
 * Pero justamente por eso es el mejor candidato: el turno ya esta puesto y lo
 * unico que le falta es el motivo, que es el permiso que se esta intentando
 * cubrir.
 *
 * Elegirlo no agrega un turno: enlaza el que ya tiene con esta ausencia.
 *
 * No aplica si el turno extra YA tiene respaldo: ahi el turno esta justificado
 * y volver a usarlo cubriria dos ausencias con la misma jornada.
 *
 * @returns {boolean}
 */
export function pendingManualExtraCoversTurn(profileName, keyDay, neededTurn) {
    if (!profileName || !keyDay || !neededTurn) return false;

    const profileData = getProfileData(profileName);
    const baseWithSwaps = aplicarCambiosTurno(
        profileName,
        keyDay,
        getTurnoBase(profileName, keyDay),
        { includeReplacements: false }
    );
    const actualWithSwaps = aplicarCambiosTurno(
        profileName,
        keyDay,
        Object.prototype.hasOwnProperty.call(profileData, keyDay)
            ? Number(profileData[keyDay]) || 0
            : getTurnoBase(profileName, keyDay),
        { includeReplacements: false }
    );
    const pendiente = restarTurnoCubierto(
        getTurnoExtraAgregado(baseWithSwaps, actualWithSwaps),
        getBackedTurnForWorker(profileName, keyDay)
    );

    return Boolean(pendiente) &&
        turnoExtraCubreTurno(pendiente, neededTurn);
}

export function canCoverShift(
    currentState,
    neededTurn,
    config = getTurnChangeConfig(),
    options = {}
) {
    if (!neededTurn) return false;

    if (
        currentState === TURNO.DIURNO &&
        neededTurn === TURNO.LARGA
    ) {
        return options.allowDiurnoLongCoverage === true;
    }

    const merged = fusionarTurnos(
        currentState,
        neededTurn
    );

    if (merged === currentState) return false;

    if (
        merged === TURNO.TURNO24 &&
        config.allowTwentyFourHourShifts === false
    ) {
        return false;
    }

    return true;
}

export function diurnoLongCoverageHours(date) {
    return {
        d: date.getDay() === 5 ? 4 : 3,
        n: 0
    };
}

export function isHalfAdminAfternoonCoverage(profileName, keyDay, neededTurn) {
    if (neededTurn !== TURNO.MEDIA_TARDE) return false;

    const admin = getJSON(`admin_${profileName}`, {});

    return admin[keyDay] === "0.5T";
}

export function halfAdminAfternoonCoverageHours(currentState, date) {
    if (
        currentState === TURNO.DIURNO ||
        currentState === TURNO.DIURNO_NOCHE
    ) {
        return diurnoLongCoverageHours(date);
    }

    return {
        d: 6,
        n: 0
    };
}

export function isDiurnoLongCoverageCandidate(
    profile,
    currentState,
    neededTurn,
    date,
    holidays
) {
    return (
        getRotativa(profile.name).type === "diurno" &&
        currentState === TURNO.DIURNO &&
        neededTurn === TURNO.LARGA &&
        isBusinessDay(date, holidays)
    );
}

export function replacementScopeProfiles(profileName, scope = "compatible") {
    const profiles = getProfiles();
    const base = profiles.find(profile =>
        profile.name === profileName
    );

    if (!base || !isProfileActive(base)) return [];

    return profiles.filter(profile =>
        profile.name !== profileName &&
        isProfileActive(profile) &&
        (
            scope === "all-local" ||
            profileCanCoverProfile(profile, base)
        )
    );
}

// Tiene ausencia ese dia (permiso, feriado legal, compensatorio o licencia).
// Se resuelve con tieneAusencia y no con el helper de replacements.js para no
// arrastrar ese modulo -y su cadena de marcajes y bitacora- al empaquetado del
// servidor.
function candidateHasAbsence(profileName, keyDay) {
    return Boolean(
        tieneAusencia(
            keyDay,
            getJSON(`admin_${profileName}`, {}),
            getJSON(`legal_${profileName}`, {}),
            getJSON(`comp_${profileName}`, {}),
            getJSON(`absences_${profileName}`, {})
        )
    );
}

/**
 * Arma la lista de candidatos que PUEDEN cubrir un turno.
 *
 * Devuelve los candidatos ya filtrados por las reglas duras (ausencia, 24
 * invertido, adyacencia de 24 por preasignacion, turno cedido en un cambio y
 * compatibilidad del turno), sin ordenar. Cada candidato viaja con lo que
 * necesitan quienes eligen despues:
 *
 *   hhee / hheeDiurnas / hheeNocturnas  horas extras del mes DEL TURNO
 *   exceedsDiurnalLimit                 pasaria el tope diurno de ese mes
 *   blockedDay                          el trabajador bloqueo la fecha
 *   nextDayMorningShift                 al dia siguiente entra por la mañana
 *   isForced                            no cumple el perfil del ausente
 *
 * Las horas se miden contra el mes del `keyDay` y no contra el mes en curso:
 * una cobertura gestionada el 30 de agosto para un turno del 2 de septiembre se
 * compara con septiembre.
 *
 * `runRange` existe por el navegador: alli se pasa runCooperativeRange para que
 * el barrido de una unidad grande no congele la pagina. En el servidor no hace
 * falta ceder el hilo, pero el mismo recorrido sirve para los dos.
 */
export async function buildReplacementCandidates(profileName, keyDay, {
    neededTurn: requestedTurn = 0,
    scope = "compatible",
    holidays = {},
    runRange = runCooperativeRange,
    shouldContinue = () => true
} = {}) {
    const date = new Date(
        Number(keyDay.split("-")[0]),
        Number(keyDay.split("-")[1]),
        Number(keyDay.split("-")[2])
    );
    const y = date.getFullYear();
    const m = date.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const neededTurn =
        requestedTurn ||
        getReplacementNeededTurn(profileName, keyDay);
    const trainingCoverageHours =
        getTrainingCoverageHours(profileName, keyDay);
    const isHalfAfternoonCoverage =
        isHalfAdminAfternoonCoverage(
            profileName,
            keyDay,
            neededTurn
        );
    // La contingencia solo se adelanta en la lista cuando la fecha ya esta
    // encima. Con dias por delante todavia se puede buscar a otro, y quien
    // quedo de llamado tiene que seguir libre por si ese mismo dia falta
    // alguien mas.
    const contingencyImminent = contingencyIsImminent(date);
    const baseProfile = getProfiles().find(profile =>
        profile.name === profileName
    );
    const scopeProfiles = replacementScopeProfiles(profileName, scope);
    const candidates = [];
    const progress = await runRange(
        0,
        scopeProfiles.length - 1,
        index => {
            const profile = scopeProfiles[index];
            const currentState =
                getActualState(profile.name, keyDay);
            const positionLabel = candidatePositionLabel(
                profile.name,
                keyDay,
                currentState
            );
            const isDiurnoLongCoverage =
                isDiurnoLongCoverageCandidate(
                    profile,
                    currentState,
                    neededTurn,
                    date,
                    holidays
                );
            const overtimeHours = trainingCoverageHours ||
                (
                    isDiurnoLongCoverage
                        ? diurnoLongCoverageHours(date)
                        : isHalfAfternoonCoverage
                            ? halfAdminAfternoonCoverageHours(
                                currentState,
                                date
                            )
                            : null
                );
            const stats = calculateWorkerMonthTotals(
                profile.name,
                y,
                m,
                days,
                holidays,
                getProfileData(profile.name),
                {},
                { d: 0, n: 0 }
            );
            const hheeDiurnas = Number(stats.hheeDiurnas) || 0;
            const hheeNocturnas = Number(stats.hheeNocturnas) || 0;
            const blockedDay =
                getBlockedDayForProfile(profile.name, keyDay);

            const nextDayMorningShift = nextDayMorningShiftAfterNight(
                profile.name,
                keyDay,
                neededTurn
            );
            // Quien quedo de llamado para este dia (js/contingency.js): "LC"
            // para la Larga, "NC" para la Noche.
            const contingencyKind = getContingencyKind(profile.name, keyDay);
            const contingencyCovers = contingencyCoversTurn(
                contingencyKind,
                neededTurn
            );

            candidates.push({
                profile,
                currentState,
                isFree: currentState === 0,
                positionLabel,
                replacementPriority: replacementPriorityForCandidate(
                    { positionLabel },
                    neededTurn
                ),
                isDiurnoLongCoverage,
                overtimeHours,
                nextDayMorningShift,
                // Se calcula aca y viaja con el candidato: el worker que los
                // ordena no tiene la fecha ni los feriados para resolverlo. Es
                // el mismo tope que aplica la cobertura automatica.
                exceedsDiurnalLimit: exceedsDiurnalOvertimeLimit(
                    { overtimeHours, hheeDiurnas },
                    date,
                    neededTurn,
                    holidays
                ),
                isForced:
                    !profileCanCoverProfile(profile, baseProfile),
                // Ya tiene este turno puesto a mano y sin motivo: elegirlo no
                // le agrega nada, enlaza el que tiene con esta ausencia.
                backsPendingExtra: pendingManualExtraCoversTurn(
                    profile.name,
                    keyDay,
                    neededTurn
                ),
                blockedDay,
                contingencyKind,
                contingencyCovers,
                // La bandera que ORDENA. Se resuelve aqui porque el worker que
                // ordena no tiene la fecha para saber si el turno es inminente.
                contingencyPriority: contingencyCovers && contingencyImminent,
                hheeDiurnas,
                hheeNocturnas,
                hhee: hheeDiurnas + hheeNocturnas
            });
        },
        { shouldContinue }
    );

    if (!progress.completed) {
        return { completed: false, neededTurn, candidates: [] };
    }

    const turnChangeConfig = getTurnChangeConfig();
    const eligible = candidates.filter(candidate =>
        !candidateHasAbsence(candidate.profile.name, keyDay) &&
        !replacementCreatesInvertedTwentyFour(
            candidate.profile.name,
            keyDay,
            candidate.currentState,
            neededTurn,
            turnChangeConfig
        ) &&
        !preassignmentBlocksReplacementCandidate(
            candidate.profile.name,
            keyDay,
            neededTurn,
            turnChangeConfig
        ) &&
        !cededSwapTurnBlocks(
            candidate.profile.name,
            keyDay,
            neededTurn
        ) &&
        (
            // Quien ya tiene el turno puesto a mano y sin motivo pasa igual:
            // canCoverShift lo descarta porque no hay nada que sumarle, y es
            // justamente por eso que sirve.
            candidate.backsPendingExtra ||
            canCoverShift(
                candidate.currentState,
                neededTurn,
                turnChangeConfig,
                {
                    allowDiurnoLongCoverage:
                        candidate.isDiurnoLongCoverage
                }
            )
        )
    );

    return {
        completed: true,
        neededTurn,
        candidates: eligible,
        date,
        year: y,
        month: m,
        days
    };
}
