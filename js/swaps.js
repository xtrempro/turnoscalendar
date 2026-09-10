import { keyFromDate, isoFromKey, keyFromISO } from "./dateUtils.js";
import { normalizeText } from "./stringUtils.js";
import {
    getBaseProfileData,
    getBlockedDays,
    getProfileData,
    getProfiles,
    getRotativa,
    getTurnChangeConfig,
    getSwaps,
    saveBlockedDays,
    saveProfileData,
    saveSwaps
} from "./storage.js";
import { TURNO } from "./constants.js";
import { getJSON } from "./persistence.js";
import { getAbsenceType } from "./rulesEngine.js";
import {
    addAuditLog,
    AUDIT_CATEGORY
} from "./auditLog.js";
import { getTurnoBase, getTurnoProgramado } from "./turnEngine.js";
import { isReplacementProfile } from "./contracts.js";
import {
    getReplacementTurnForWorker,
    moveManualExtraBackup
} from "./replacements.js";
import { getBlockedDayForProfile } from "./workerAvailability.js";

function normalizeTextKey(value) {
    return normalizeText(value);
}

function getProfileByName(name) {
    return getProfiles().find(profile =>
        profile.name === name
    ) || null;
}

function parseKeyDate(key) {
    const parts = String(key || "").split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);

    if (!year || month < 0 || !day) return null;

    const date = new Date(year, month, day);

    return Number.isNaN(date.getTime()) ? null : date;
}

function baseDataRange(data = {}) {
    const dates = Object.keys(data)
        .map(parseKeyDate)
        .filter(Boolean)
        .sort((a, b) => a - b);

    if (!dates.length) return null;

    return {
        start: dates[0],
        end: dates[dates.length - 1]
    };
}

function baseTurnForDate(profileName, date) {
    return getTurnoBase(profileName, keyFromDate(date));
}

export function haveSameBaseRotation(fromName, toName) {
    const fromRotativa = getRotativa(fromName);
    const toRotativa = getRotativa(toName);

    if (
        !fromRotativa.type ||
        !toRotativa.type ||
        isReplacementProfile(fromName) ||
        isReplacementProfile(toName) ||
        fromRotativa.type !== toRotativa.type
    ) {
        return false;
    }

    const fromBase = getBaseProfileData(fromName);
    const toBase = getBaseProfileData(toName);
    const fromRange = baseDataRange(fromBase);
    const toRange = baseDataRange(toBase);

    if (!fromRange || !toRange) return false;

    const start =
        fromRange.start > toRange.start
            ? new Date(fromRange.start)
            : new Date(toRange.start);
    const end =
        fromRange.end < toRange.end
            ? new Date(fromRange.end)
            : new Date(toRange.end);

    if (start > end) return false;

    let compared = 0;
    const day = new Date(start);

    while (day <= end && compared < 42) {
        if (
            baseTurnForDate(fromName, day) !==
            baseTurnForDate(toName, day)
        ) {
            return false;
        }

        compared++;
        day.setDate(day.getDate() + 1);
    }

    return compared >= 7;
}

function usesProfessionCompatibility(profile = {}) {
    return (
        profile.estamento === "Profesional" ||
        profile.estamento === "T\u00e9cnico"
    );
}

// Dos rotativas Diurno son identicas dia a dia, asi que `haveSameBaseRotation`
// siempre da true y el par quedaba descartado. Pero lo que estos trabajadores
// intercambian no es la rotativa: es la Larga por extension de horario que el
// supervisor les asigno sobre un dia Diurno suelto. Ahi si difieren, y el
// intercambio tiene sentido.
export function bothUseDiurnoRotation(fromName, toName) {
    return (
        getRotativa(fromName).type === "diurno" &&
        getRotativa(toName).type === "diurno"
    );
}

export function canSwapProfiles(fromName, toName) {
    if (!getTurnChangeConfig().allowSwaps) return false;

    const from = getProfileByName(fromName);
    const to = getProfileByName(toName);

    if (!from || !to || from.name === to.name) return false;
    if (from.estamento !== to.estamento) return false;

    // Un Diurno solo cambia con otro Diurno: lo que entrega es su dia de
    // extension horaria, y eso solo tiene contraparte en otro Diurno. La regla
    // es mutua, asi que un 3er o 4to turno tampoco ve a los Diurno.
    if (
        (getRotativa(fromName).type === "diurno") !==
        (getRotativa(toName).type === "diurno")
    ) return false;

    if (
        !bothUseDiurnoRotation(fromName, toName) &&
        haveSameBaseRotation(fromName, toName)
    ) return false;

    if (usesProfessionCompatibility(from)) {
        return normalizeTextKey(from.profession) ===
            normalizeTextKey(to.profession);
    }

    return true;
}

export function cambioEstaAnulado(swap) {
    return Boolean(
        swap?.canceled ||
        swap?.anulado ||
        swap?.status === "canceled" ||
        swap?.status === "anulado"
    );
}

function resetDayToBase(profile, keyDay) {
    const data = getProfileData(profile);
    const baseData = getBaseProfileData(profile);
    const blocked = getBlockedDays(profile);
    const hasAbsence =
        Boolean(getJSON(`admin_${profile}`, {})[keyDay]) ||
        Boolean(getJSON(`legal_${profile}`, {})[keyDay]) ||
        Boolean(getJSON(`comp_${profile}`, {})[keyDay]) ||
        Boolean(getJSON(`absences_${profile}`, {})[keyDay]);
    const hasBase =
        Object.prototype.hasOwnProperty.call(baseData, keyDay);
    const computedBase = getTurnoBase(profile, keyDay);

    if (!hasBase && !computedBase) {
        if (hasAbsence) {
            blocked[keyDay] = true;
            saveBlockedDays(blocked, profile);
        }

        return;
    }

    const baseTurno = hasBase
        ? Number(baseData[keyDay]) || 0
        : computedBase;

    if (baseTurno) {
        data[keyDay] = baseTurno;
        blocked[keyDay] = true;
    } else if (hasAbsence) {
        delete data[keyDay];
        blocked[keyDay] = true;
    } else {
        delete data[keyDay];
        delete blocked[keyDay];
    }

    saveProfileData(data, profile);
    saveBlockedDays(blocked, profile);
}

/* =========================================
   OBTENER CAMBIOS DEL MES
========================================= */
export function cambiosDelMes(year, month) {

    const swaps = getSwaps();

    return swaps.filter(s =>
        Number(s.year) === Number(year) &&
        Number(s.month) === Number(month)
    );
}

export function activeMonthlySwapCount(profile, year, month) {
    if (!profile) return 0;

    return getSwaps().filter(swap =>
        !cambioEstaAnulado(swap) &&
        Number(swap.year) === Number(year) &&
        Number(swap.month) === Number(month) &&
        (
            swap.from === profile ||
            swap.to === profile
        )
    ).length;
}

export function monthlySwapLimitBlockReason(profiles, year, month) {
    const config = getTurnChangeConfig();

    if (!config.limitMonthlySwaps) {
        return "";
    }

    const limit = Number(config.monthlySwapLimit) || 0;

    if (limit <= 0) {
        return "";
    }

    const uniqueProfiles = Array.from(
        new Set(
            (Array.isArray(profiles) ? profiles : [profiles])
                .filter(Boolean)
        )
    );

    const blockedProfile = uniqueProfiles.find(profile =>
        activeMonthlySwapCount(profile, year, month) >= limit
    );

    return blockedProfile
        ? `${blockedProfile} ya alcanzo el limite de ${limit} cambio(s) de turno en este mes.`
        : "";
}

/* =========================================
   REGISTRAR CAMBIO
========================================= */
/**
 * Lleva el motivo de horas extra de cada uno a la fecha en la que su turno
 * aterriza, o lo trae de vuelta al deshacer el cambio.
 *
 * Los dos participantes se miran por separado y con su propia perspectiva:
 * quien CEDE en `fecha` recibe en `devolucion`, y su companero al reves. Cada
 * motivo se mueve de la fecha de la que sale su turno a la fecha a la que
 * llega.
 *
 * @param {object} swap
 * @param {boolean} [undo] al deshacer, las fechas se recorren al reves
 */
function moveSwapManualExtraBackups(swap, undo = false) {
    if (!swap) return;

    [swap.from, swap.to].filter(Boolean).forEach(profile => {
        const perspective = getSwapPerspective(swap, profile);

        if (!perspective) return;
        // Un tramo saltado no mueve turno, asi que tampoco mueve su motivo.
        if (perspective.changeSkipped || perspective.returnSkipped) return;

        const desde = undo ? perspective.returnDate : perspective.changeDate;
        const hasta = undo ? perspective.changeDate : perspective.returnDate;

        moveManualExtraBackup(
            profile,
            desde,
            hasta,
            perspective.changeTurn
        );
    });
}

export function registrarCambio(data) {

    const swaps = getSwaps();
    const id = Date.now();

    swaps.push({
        id,

        from: data.from,
        to: data.to,

        fecha: data.fecha,
        devolucion: data.devolucion,

        turno: data.turno,
        turnoDevuelto: data.turnoDevuelto,

        year: data.year,
        month: data.month,

        canceled: false
    });

    saveSwaps(swaps);
    // El motivo de horas extra viaja con el turno: cada uno lo lleva de la
    // fecha en que CEDE a la fecha en que RECIBE. Sin esto el motivo se quedaba
    // en la casilla de origen justificando un turno que ese dia ya no se hace,
    // y la casilla donde el turno aterriza salia sin motivo.
    moveSwapManualExtraBackups(swaps[swaps.length - 1]);

    if (typeof window !== "undefined") {
        window.dispatchEvent(
            new CustomEvent("proturnos:calendarProfilesChanged", {
                detail: {
                    profiles: [data.from, data.to].filter(Boolean),
                    metadata: {
                        changeType: "shift_swap_accepted",
                        source: "shift_swap",
                        title: "Cambio de turno registrado",
                        message: "Se incorporo un cambio de turno a tu calendario.",
                        affectedDates: [data.fecha, data.devolucion],
                        entityId: String(id)
                    }
                }
            })
        );
    }

    addAuditLog(
        AUDIT_CATEGORY.TURN_CHANGES,
        "Registro cambio de turno",
        `${data.from} -> ${data.to}: cambio ${data.fecha}, devoluci\u00f3n ${data.devolucion}.`,
        {
            profile: data.from,
            swapId: id,
            from: data.from,
            to: data.to
        }
    );
}

/* =========================================
   BUSCAR CAMBIO POR FECHA
========================================= */
export function swapCodeLabel(code) {
    if (code === "L") return "Larga";
    if (code === "N") return "Noche";
    if (code === "24") return "24h";
    if (code === "D") return "Diurno";
    if (code === "D+N") return "D+N";
    if (code === "HM") return "1/2M";
    if (code === "HT") return "Extensi\u00f3n horaria";
    if (code === "18") return "18 horas";

    return String(code || "");
}

export function getSwapPerspective(swap, profileName) {
    if (!swap || !profileName) return null;

    if (swap.from === profileName) {
        return {
            role: "from",
            counterpart: swap.to,
            changeDate: swap.fecha,
            changeTurn: swap.turno,
            changeTurnLabel: swapCodeLabel(swap.turno),
            changeSkipped: Boolean(swap.skipFecha),
            returnDate: swap.devolucion,
            returnTurn: swap.turnoDevuelto,
            returnTurnLabel: swapCodeLabel(swap.turnoDevuelto),
            returnSkipped: Boolean(swap.skipDevolucion)
        };
    }

    if (swap.to === profileName) {
        return {
            role: "to",
            counterpart: swap.from,
            changeDate: swap.devolucion,
            changeTurn: swap.turnoDevuelto,
            changeTurnLabel: swapCodeLabel(swap.turnoDevuelto),
            changeSkipped: Boolean(swap.skipDevolucion),
            returnDate: swap.fecha,
            returnTurn: swap.turno,
            returnTurnLabel: swapCodeLabel(swap.turno),
            returnSkipped: Boolean(swap.skipFecha)
        };
    }

    return null;
}

export function getCambiosTurnoCalendario(nombre, keyDay) {
    const fecha = isoFromKey(keyDay);
    const markers = [];

    getSwaps().forEach(swap => {
        if (
            !swap ||
            cambioEstaAnulado(swap) ||
            (swap.from !== nombre && swap.to !== nombre)
        ) {
            return;
        }

        const perspective = getSwapPerspective(swap, nombre);

        if (!perspective) return;

        if (
            !perspective.changeSkipped &&
            perspective.changeDate === fecha
        ) {
            markers.push({
                swap,
                perspective,
                type: "change",
                label: `CCTT ${perspective.changeTurnLabel}`.trim()
            });
        }

        if (
            !perspective.returnSkipped &&
            perspective.returnDate === fecha
        ) {
            markers.push({
                swap,
                perspective,
                type: "return",
                label: `DDTT ${perspective.returnTurnLabel}`.trim()
            });
        }
    });

    return markers;
}

export function getCambioTurnoCalendario(nombre, keyDay) {
    return getCambiosTurnoCalendario(nombre, keyDay)[0] || null;
}

export function deshacerCambioTurno(swap) {
    if (!swap) return;

    // El motivo vuelve por donde vino: si el turno regresa a su fecha original,
    // dejarlo en la de devolucion lo colgaria de un turno que ya no esta ahi.
    moveSwapManualExtraBackups(swap, true);

    const fechaKey = keyFromISO(swap.fecha);
    const devolucionKey = keyFromISO(swap.devolucion);

    [
        swap.from,
        swap.to
    ].forEach(profile => {
        if (!profile) return;

        resetDayToBase(profile, fechaKey);
        resetDayToBase(profile, devolucionKey);
    });

    const swaps = getSwaps().map(item =>
        item.id === swap.id
            ? {
                ...item,
                canceled: true,
                canceledAt: new Date().toISOString()
            }
            : item
    );

    saveSwaps(swaps);

    if (typeof window !== "undefined") {
        window.dispatchEvent(
            new CustomEvent("proturnos:calendarProfilesChanged", {
                detail: {
                    profiles: [swap.from, swap.to].filter(Boolean),
                    metadata: {
                        changeType: "shift_swap_canceled",
                        source: "shift_swap",
                        title: "Cambio de turno anulado",
                        message: "Se anuló un cambio de turno en tu calendario.",
                        affectedDates: [swap.fecha, swap.devolucion],
                        entityId: String(swap.id || "")
                    }
                }
            })
        );
    }

    addAuditLog(
        AUDIT_CATEGORY.TURN_CHANGES,
        "Anul\u00f3 cambio de turno",
        `${swap.from} -> ${swap.to}: cambio ${swap.fecha}, devoluci\u00f3n ${swap.devolucion}.`,
        {
            profile: swap.from,
            swapId: swap.id,
            from: swap.from,
            to: swap.to
        }
    );
}

export function activeSwapConflictsProfileDate(profile, keyDay) {
    const fecha = isoFromKey(keyDay);

    return getSwaps().some(swap =>
        !cambioEstaAnulado(swap) &&
        (swap.from === profile || swap.to === profile) &&
        (
            (!swap.skipFecha && swap.fecha === fecha) ||
            (!swap.skipDevolucion && swap.devolucion === fecha)
        )
    );
}

export function profileHasSwapAbsence(profile, keyDay) {
    return Boolean(
        getJSON(`admin_${profile}`, {})[keyDay] ||
        getJSON(`legal_${profile}`, {})[keyDay] ||
        getJSON(`comp_${profile}`, {})[keyDay] ||
        getJSON(`absences_${profile}`, {})[keyDay]
    );
}

export function getSwapTurnState(profile, keyDay) {
    const base = getTurnoBase(profile, keyDay);

    if (isSwapExchangeableTurn(base)) {
        return base;
    }

    if (base !== TURNO.DIURNO) {
        return base;
    }

    const extra = getReplacementTurnForWorker(profile, keyDay);

    if (isSwapExchangeableTurn(extra)) {
        return extra;
    }

    // Extension de horario: el supervisor subio el Diurno a Larga y eso vive
    // como override en `data_`, no como reemplazo. Sin mirar el turno
    // programado, la Larga de un diurno era invisible para los cambios y su
    // dia se ofrecia como un Diurno cualquiera (no intercambiable).
    const programado = getTurnoProgramado(profile, keyDay);

    return isSwapExchangeableTurn(programado)
        ? programado
        : base;
}

// El turno de rotativa detras del dia, ignorando extras. Sirve para distinguir
// "este trabajador esta libre" de "este trabajador viene en Diurno y puede
// extender su jornada a Larga".
export function getSwapBaseRotationTurn(profile, keyDay) {
    return getTurnoBase(profile, keyDay);
}

// Un diurno que recibe una Larga extiende su jornada: no queda con dos turnos
// ni con un 24, queda Larga ese dia (lo mismo que hace `fusionarTurnos`).
export function receivesLargaByExtendingDiurno(
    incomingTurn,
    receiverBaseTurn
) {
    return (
        Number(incomingTurn) === TURNO.LARGA &&
        Number(receiverBaseTurn) === TURNO.DIURNO
    );
}

export function isSwapExchangeableTurn(turno) {
    const value = Number(turno) || 0;

    return value === 1 || value === 2;
}

export function isComplementarySwapTurn(incomingTurn, existingTurn) {
    const incoming = Number(incomingTurn) || 0;
    const existing = Number(existingTurn) || 0;

    return (
        (incoming === 1 && existing === 2) ||
        (incoming === 2 && existing === 1)
    );
}

function offsetKey(key, offset) {
    const date = parseKeyDate(key);

    if (!date) return "";

    date.setDate(date.getDate() + offset);

    return keyFromDate(date);
}

function includesDaytimeStart(turno) {
    const value = Number(turno) || TURNO.LIBRE;

    return (
        value === TURNO.LARGA ||
        value === TURNO.TURNO24 ||
        value === TURNO.DIURNO ||
        value === TURNO.DIURNO_NOCHE
    );
}

function includesNoche(turno) {
    const value = Number(turno) || TURNO.LIBRE;

    return (
        value === TURNO.NOCHE ||
        value === TURNO.TURNO24 ||
        value === TURNO.DIURNO_NOCHE ||
        value === TURNO.TURNO18
    );
}

function swapTurnLabel(turno) {
    const value = Number(turno) || TURNO.LIBRE;

    if (value === TURNO.LARGA) return "Larga";
    if (value === TURNO.NOCHE) return "Noche";

    return "Libre";
}

function projectedReceiverTurn(incomingTurn, receiverTurn) {
    const incoming = Number(incomingTurn) || TURNO.LIBRE;
    const current = Number(receiverTurn) || TURNO.LIBRE;

    if (!current) return incoming;
    if (isComplementarySwapTurn(incoming, current)) {
        return TURNO.TURNO24;
    }

    // El diurno que recibe una Larga termina el dia en Larga, no en Diurno. Si
    // devolvieramos `current`, las reglas de adyacencia con un 24 mirarian un
    // turno que no es el que va a quedar.
    if (receivesLargaByExtendingDiurno(incoming, current)) {
        return TURNO.LARGA;
    }

    return current;
}

function createsInvertedTwentyFourForReceiver({
    receiver,
    keyDay,
    projectedTurn
}) {
    if (!receiver || !keyDay || !projectedTurn) return false;

    const previousTurn =
        getSwapTurnState(receiver, offsetKey(keyDay, -1));
    const nextTurn =
        getSwapTurnState(receiver, offsetKey(keyDay, 1));

    return (
        (
            includesDaytimeStart(projectedTurn) &&
            includesNoche(previousTurn)
        ) ||
        (
            includesNoche(projectedTurn) &&
            includesDaytimeStart(nextTurn)
        )
    );
}

// Un turno de 24h ocupa el dia completo y su transicion horaria: nunca puede haber
// trabajo con inicio diurno (Larga/Diurno/24/D+N) el dia SIGUIENTE a un 24h, ni una
// Noche el dia ANTERIOR a un 24h (el trabajador recien sale del 24h, o entraria sin
// descanso). Es una restriccion FISICA: NO depende de los ajustes de 24h / 24h
// invertido; nunca se puede formar en ningun caso.
function createsForbiddenTwentyFourAdjacency({
    receiver,
    keyDay,
    projectedTurn
}) {
    if (!receiver || !keyDay || !projectedTurn) return false;

    const projected = Number(projectedTurn) || TURNO.LIBRE;
    const previousTurn =
        Number(getSwapTurnState(receiver, offsetKey(keyDay, -1))) || TURNO.LIBRE;
    const nextTurn =
        Number(getSwapTurnState(receiver, offsetKey(keyDay, 1))) || TURNO.LIBRE;
    const isTwentyFour = turno => turno === TURNO.TURNO24;

    // Excepcion habilitable por la unidad: un Diurno puro pegado al dia
    // siguiente de un 24h. Solo el Diurno; Larga, D+N u otro 24 pegados a un 24
    // siguen prohibidos siempre. Aplica en las dos direcciones: poner el Diurno
    // despues del 24, y poner el 24 cuando el dia siguiente ya es Diurno.
    const permiteDiurnoPost24 =
        getTurnChangeConfig().allowDiurnoAfterTwentyFour === true;
    const esDiurno = turno => turno === TURNO.DIURNO;

    return (
        // Inicio diurno el dia siguiente a un 24h.
        (
            isTwentyFour(previousTurn) &&
            includesDaytimeStart(projected) &&
            !(permiteDiurnoPost24 && esDiurno(projected))
        ) ||
        // Noche el dia anterior a un 24h.
        (isTwentyFour(nextTurn) && includesNoche(projected)) ||
        // El propio proyectado es un 24h y su vecino lo hace imposible.
        (
            isTwentyFour(projected) &&
            (
                includesNoche(previousTurn) ||
                (
                    includesDaytimeStart(nextTurn) &&
                    !(permiteDiurnoPost24 && esDiurno(nextTurn))
                )
            )
        )
    );
}

const SWAP_CODE_TO_TURNO = {
    L: TURNO.LARGA,
    N: TURNO.NOCHE,
    "24": TURNO.TURNO24,
    "24h": TURNO.TURNO24,
    "24H": TURNO.TURNO24,
    D: TURNO.DIURNO,
    "D+N": TURNO.DIURNO_NOCHE,
    "18": TURNO.TURNO18
};

function swapCodeToTurno(code) {
    return SWAP_CODE_TO_TURNO[code] || TURNO.LIBRE;
}

/**
 * Turnos que el perfil ENTREGO (cedio) en cambios activos ese dia: como quien
 * entrega en la fecha original, o como receptor que devuelve en la fecha de
 * devolucion. El horario de esos turnos queda comprometido.
 */
export function getCededSwapTurns(profile, keyDay) {
    const fecha = isoFromKey(keyDay);
    const turns = [];

    getSwaps().forEach(swap => {
        if (cambioEstaAnulado(swap)) return;

        if (
            !swap.skipFecha &&
            swap.from === profile &&
            swap.fecha === fecha
        ) {
            turns.push(swapCodeToTurno(swap.turno));
        }

        if (
            !swap.skipDevolucion &&
            swap.to === profile &&
            swap.devolucion === fecha
        ) {
            turns.push(swapCodeToTurno(swap.turnoDevuelto));
        }
    });

    return turns.filter(Boolean);
}

/**
 * True si el perfil cedio (entrego) un turno cuyo horario solapa con el turno
 * requerido. Sirve para bloquear el slot cedido en sugerencias de reemplazo y
 * en la aceptacion de nuevos cambios de turno.
 */
export function cededSwapTurnBlocks(profile, keyDay, neededTurn) {
    const need = Number(neededTurn) || TURNO.LIBRE;

    if (!need) return false;

    return getCededSwapTurns(profile, keyDay).some(ceded =>
        (includesDaytimeStart(ceded) && includesDaytimeStart(need)) ||
        (includesNoche(ceded) && includesNoche(need))
    );
}

export function getSwapDateBlockReason({
    giver,
    receiver,
    keyDay,
    requiredTurn = 0
}) {
    const config = getTurnChangeConfig();

    if (!config.allowSwaps) {
        return "Los cambios de turno estan desactivados en Ajustes del sistema.";
    }

    if (!giver || !receiver || !keyDay) {
        return "Seleccion incompleta.";
    }

    const date = parseKeyDate(keyDay);
    const limitReason = date
        ? monthlySwapLimitBlockReason(
            [giver, receiver],
            date.getFullYear(),
            date.getMonth()
        )
        : "";

    if (limitReason) {
        return limitReason;
    }

    if (profileHasSwapAbsence(giver, keyDay)) {
        return `${giver} tiene permiso, vacaciones o licencia en esta fecha.`;
    }

    if (profileHasSwapAbsence(receiver, keyDay)) {
        return `${receiver} tiene permiso, vacaciones o licencia en esta fecha.`;
    }

    if (getBlockedDayForProfile(giver, keyDay)) {
        return `${giver} pidio no realizar cambios de turno ni horas extras en esta fecha.`;
    }

    if (getBlockedDayForProfile(receiver, keyDay)) {
        return `${receiver} pidio no realizar cambios de turno ni horas extras en esta fecha.`;
    }

    if (activeSwapConflictsProfileDate(giver, keyDay)) {
        return `${giver} ya tiene un cambio de turno en esta fecha.`;
    }

    if (activeSwapConflictsProfileDate(receiver, keyDay)) {
        return `${receiver} ya tiene un cambio de turno en esta fecha.`;
    }

    const giverTurn = getSwapTurnState(giver, keyDay);
    const receiverTurn = getSwapTurnState(receiver, keyDay);

    if (!isSwapExchangeableTurn(giverTurn)) {
        return `${giver} no tiene turno Larga o Noche para entregar.`;
    }

    if (
        !config.allowDifferentTurnTypes &&
        isSwapExchangeableTurn(requiredTurn) &&
        Number(giverTurn) !== Number(requiredTurn)
    ) {
        return `La configuracion solo permite devolver el mismo tipo de turno (${swapTurnLabel(requiredTurn)} por ${swapTurnLabel(requiredTurn)}).`;
    }

    // Un diurno que recibe una Larga extiende su jornada ese dia: no queda con
    // dos turnos ni con un 24, queda Larga. Es el caso de dos trabajadores de
    // rotativa Diurno que se intercambian su dia de extension horaria; antes
    // caia en "no tiene calendario libre" porque ese dia igual venia a trabajar.
    const receiverExtendsDiurno = receivesLargaByExtendingDiurno(
        giverTurn,
        getSwapBaseRotationTurn(receiver, keyDay)
    );

    if (
        receiverTurn !== 0 &&
        !receiverExtendsDiurno &&
        !isComplementarySwapTurn(giverTurn, receiverTurn)
    ) {
        return `${receiver} no tiene calendario libre ni turno complementario para recibir.`;
    }

    // Ya tiene una Larga propia ese dia: recibir otra no le agrega jornada, solo
    // dejaria el cambio sin efecto visible.
    if (
        receiverExtendsDiurno &&
        isSwapExchangeableTurn(receiverTurn)
    ) {
        return `${receiver} ya tiene un turno Larga o Noche ese dia.`;
    }

    if (
        receiverTurn !== 0 &&
        isComplementarySwapTurn(giverTurn, receiverTurn) &&
        !config.allowTwentyFourHourShifts
    ) {
        return `${receiver} quedaria con turno 24 y esa opcion esta desactivada.`;
    }

    // Restriccion fisica (siempre, sin importar los ajustes): no se puede quedar con
    // una Larga el dia siguiente a un 24h ni con una Noche el dia anterior a un 24h.
    if (
        createsForbiddenTwentyFourAdjacency({
            receiver,
            keyDay,
            projectedTurn: projectedReceiverTurn(
                giverTurn,
                receiverTurn
            )
        })
    ) {
        return `${receiver} no puede quedar con un turno pegado a un turno 24 (ni Larga el dia siguiente, ni Noche el dia anterior a un 24).`;
    }

    if (
        !config.allowInvertedTwentyFourHourShifts &&
        createsInvertedTwentyFourForReceiver({
            receiver,
            keyDay,
            projectedTurn: projectedReceiverTurn(
                giverTurn,
                receiverTurn
            )
        })
    ) {
        return `${receiver} quedaria con un turno 24 invertido y esa opcion esta desactivada.`;
    }

    return "";
}

export function getEligibleSwapReceivers(giver, keyDay = "") {
    if (!giver) return [];

    return getProfiles().filter(profile =>
        profile.name !== giver &&
        profile.active !== false &&
        canSwapProfiles(giver, profile.name) &&
        (
            !keyDay ||
            !getSwapDateBlockReason({
                giver,
                receiver: profile.name,
                keyDay
            })
        )
    );
}

export function getActiveSwapsForProfileKeys(profile, keys = []) {
    const keySet = new Set(keys.map(isoFromKey));

    if (!profile || !keySet.size) return [];

    return getSwaps().filter(swap =>
        !cambioEstaAnulado(swap) &&
        (swap.from === profile || swap.to === profile) &&
        (
            (!swap.skipFecha && keySet.has(swap.fecha)) ||
            (!swap.skipDevolucion && keySet.has(swap.devolucion))
        )
    );
}

export function cancelSwapsForProfileKeys(profile, keys = []) {
    const swaps = getActiveSwapsForProfileKeys(profile, keys);
    const unique = new Map();

    swaps.forEach(swap => {
        unique.set(String(swap.id), swap);
    });

    Array.from(unique.values()).forEach(deshacerCambioTurno);

    return Array.from(unique.values());
}

/* =========================================
   ELIMINAR CAMBIO
========================================= */
