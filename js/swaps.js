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
import { getTurnoBase } from "./turnEngine.js";
import { isReplacementProfile } from "./contracts.js";
import { getReplacementTurnForWorker } from "./replacements.js";
import { getBlockedDayForProfile } from "./workerAvailability.js";

function isMedicalLicense(absence) {
    const type = getAbsenceType(absence);

    return (
        type === "license" ||
        type === "union_leave" ||
        type === "professional_license"
    );
}

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

export function canSwapProfiles(fromName, toName) {
    if (!getTurnChangeConfig().allowSwaps) return false;

    const from = getProfileByName(fromName);
    const to = getProfileByName(toName);

    if (!from || !to || from.name === to.name) return false;
    if (from.estamento !== to.estamento) return false;
    if (haveSameBaseRotation(fromName, toName)) return false;

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
export function getCambioPorFecha(fecha) {

    const swaps = getSwaps();

    return swaps.find(s =>
        !cambioEstaAnulado(s) &&
        (
            (!s.skipFecha && s.fecha === fecha) ||
            (!s.skipDevolucion && s.devolucion === fecha)
        )
    );
}

export function getCambioTurnoRecibido(nombre, keyDay) {
    const fecha = isoFromKey(keyDay);

    return getSwaps().find(swap =>
        !cambioEstaAnulado(swap) &&
        (
            (
                !swap.skipFecha &&
                swap.to === nombre &&
                swap.fecha === fecha
            ) ||
            (
                !swap.skipDevolucion &&
                swap.from === nombre &&
                swap.devolucion === fecha
            )
        )
    ) || null;
}

export function swapCodeLabel(code) {
    if (code === "L") return "Larga";
    if (code === "N") return "Noche";
    if (code === "24") return "24";
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

export function getCambioTurnoSolicitado(nombre, keyDay) {
    const fecha = isoFromKey(keyDay);
    const swap = getSwaps().find(item =>
        !cambioEstaAnulado(item) &&
        item.from === nombre &&
        (
            (!item.skipFecha && item.fecha === fecha) ||
            (!item.skipDevolucion && item.devolucion === fecha)
        )
    );

    if (!swap) return null;

    if (!swap.skipFecha && swap.fecha === fecha) {
        return {
            swap,
            label: `CCTT ${swapCodeLabel(swap.turno)}`.trim()
        };
    }

    return {
        swap,
        label: `DDTT ${swapCodeLabel(swap.turnoDevuelto)}`.trim()
    };
}

export function cambioTieneLicenciaEnTurnosBase(swap) {
    if (!swap) return false;

    const checks = [];

    if (!swap.skipFecha && swap.from && swap.fecha) {
        checks.push({
            profile: swap.from,
            key: keyFromISO(swap.fecha)
        });
    }

    if (!swap.skipDevolucion && swap.to && swap.devolucion) {
        checks.push({
            profile: swap.to,
            key: keyFromISO(swap.devolucion)
        });
    }

    return checks.some(({ profile, key }) => {
        const absences = getJSON(`absences_${profile}`, {});

        return isMedicalLicense(absences[key]);
    });
}

export function deshacerCambioTurno(swap) {
    if (!swap) return;

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

    return isSwapExchangeableTurn(extra)
        ? extra
        : base;
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

export function isProfileClearForSwap(profile, keyDay) {
    return (
        !profileHasSwapAbsence(profile, keyDay) &&
        !activeSwapConflictsProfileDate(profile, keyDay) &&
        getSwapTurnState(profile, keyDay) === 0
    );
}

export function canGiveSwapTurn(profile, keyDay) {
    return (
        !profileHasSwapAbsence(profile, keyDay) &&
        !activeSwapConflictsProfileDate(profile, keyDay) &&
        isSwapExchangeableTurn(getSwapTurnState(profile, keyDay))
    );
}

const SWAP_CODE_TO_TURNO = {
    L: TURNO.LARGA,
    N: TURNO.NOCHE,
    "24": TURNO.TURNO24,
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

    if (
        receiverTurn !== 0 &&
        !isComplementarySwapTurn(giverTurn, receiverTurn)
    ) {
        return `${receiver} no tiene calendario libre ni turno complementario para recibir.`;
    }

    if (
        receiverTurn !== 0 &&
        isComplementarySwapTurn(giverTurn, receiverTurn) &&
        !config.allowTwentyFourHourShifts
    ) {
        return `${receiver} quedaria con turno 24 y esa opcion esta desactivada.`;
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
export function eliminarCambio(id) {

    const swaps = getSwaps()
        .filter(s => s.id !== id);

    saveSwaps(swaps);
    addAuditLog(
        AUDIT_CATEGORY.TURN_CHANGES,
        "Elimino cambio de turno",
        `ID de cambio eliminado: ${id}.`,
        { swapId: id }
    );
}
