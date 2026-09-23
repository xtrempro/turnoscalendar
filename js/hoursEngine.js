import {
    getShiftAssigned,
    getCurrentProfile,
    getValorHora,
    getRotativa,
    getBaseProfileData
} from "./storage.js";

import {
    aplicarCambiosTurno,
    getTurnoBase,
    getTurnoProgramado,
    includesWorkDay
} from "./turnEngine.js";

import {
    calcExtraHours,
    isBusinessDay
} from "./calculations.js";

import { TURNO } from "./constants.js";
import {
    esAusenciaInjustificada,
    getAbsenceType
} from "./rulesEngine.js";
import { getJSON } from "./persistence.js";
import {
    getWorkedIntervalsForState,
    getClockDeficitHours,
    getClockExtraHours,
    getClockScheduleState,
    getScheduledSegmentsForProfile,
    hasClockMark
} from "./clockMarks.js";
import {
    calculateHheeReturnTransferHours,
    isHheeReturnTransferEnabled
} from "./hourReturnTransfers.js";
import {
    isReplacementProfile
} from "./contracts.js";
import { getShiftMoveMarkers } from "./shiftMoves.js";
import {
    diurnoExtraDayHours,
    roundMonthlyBusinessHours
} from "./overtimeRules.js";

// Jornada diurna PROMEDIO. Reparte la jornada contractual del mes (horas
// habiles esperadas, descuentos por permiso); no es lo que vale un turno
// concreto. Para un turno diurno EXTRA la regla es otra y vive en
// overtimeRules.js: 9 h de lunes a jueves y 8 h el viernes.
const HORA_BASE_DIARIA = 8.8;

function key(y, m, d) {
    return `${y}-${m}-${d}`;
}

function keyToISODate(keyDay) {
    const parts = String(keyDay || "").split("-");

    if (parts.length !== 3) return "";

    return [
        parts[0],
        String(Number(parts[1]) + 1).padStart(2, "0"),
        String(Number(parts[2])).padStart(2, "0")
    ].join("-");
}

function readProfileMap(prefix, nombre) {
    return getJSON(`${prefix}_${nombre}`, {});
}

function roundHour(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
}

function roundExtra(value) {
    return Math.max(
        0,
        Math.round((Number(value) || 0) * 2) / 2
    );
}

function roundSignedExtra(value) {
    const rounded =
        Math.round((Number(value) || 0) * 2) / 2;

    return Object.is(rounded, -0) ? 0 : rounded;
}

function formatHour(value) {
    const rounded = roundHour(value);

    if (Number.isInteger(rounded)) {
        return String(rounded);
    }

    return String(rounded).replace(".", ",");
}

function formatExtra(value) {
    const rounded = roundSignedExtra(value);

    if (Number.isInteger(rounded)) {
        return String(rounded);
    }

    return String(rounded).replace(".", ",");
}

function formatTransferHours(value) {
    const rounded =
        Math.round((Number(value) || 0) * 100) / 100;

    if (Number.isInteger(rounded)) {
        return String(rounded);
    }

    return String(rounded).replace(".", ",");
}

function getDayExtraAlertClass(value, nombre = getCurrentProfile()) {
    if (!getShiftAssigned(nombre)) {
        return "";
    }

    const hours = Number(value) || 0;

    if (hours >= 40) {
        return "hhee-alert-danger";
    }

    if (hours > 30 && hours < 40) {
        return "hhee-alert-warning";
    }

    return "";
}

function dateAt(base, hour) {
    const whole = Math.trunc(hour);
    const minutes = Math.round((hour - whole) * 60);

    return new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate(),
        whole,
        minutes
    );
}

function nextDateAt(base, hour) {
    const date = dateAt(base, hour);

    date.setDate(date.getDate() + 1);

    return date;
}

function sameDayAt(date, hour) {
    return new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        hour,
        0
    );
}

function minDate(...dates) {
    return new Date(
        Math.min(...dates.map(date => date.getTime()))
    );
}

function maxDate(...dates) {
    return new Date(
        Math.max(...dates.map(date => date.getTime()))
    );
}

function hoursBetween(start, end) {
    return Math.max(0, (end - start) / 36e5);
}

function addHours(target, source) {
    target.d += source.d;
    target.n += source.n;
}

function isHalfAdmin(value) {
    return (
        value === "0.5M" ||
        value === "0.5T" ||
        value === 0.5
    );
}

function halfAdminWorkState(keyDay, maps) {
    if (maps.admin[keyDay] === "0.5M") {
        return TURNO.MEDIA_TARDE;
    }

    if (maps.admin[keyDay] === "0.5T") {
        return TURNO.MEDIA_MANANA;
    }

    return TURNO.LIBRE;
}

function halfAdminWorkIntervals(nombre, keyDay, date, state, holidays) {
    if (!state) return [];

    return getScheduledSegmentsForProfile(
        nombre,
        keyDay,
        date,
        state,
        holidays
    ).map(segment => ({
        start: segment.start,
        end: segment.end
    }));
}

function isApprovedAbsence(value) {
    return Boolean(value) && !esAusenciaInjustificada(value);
}

function getMaps(nombre) {
    return {
        admin: readProfileMap("admin", nombre),
        legal: readProfileMap("legal", nombre),
        comp: readProfileMap("comp", nombre),
        absences: readProfileMap("absences", nombre)
    };
}

function includesContractDay(nombre, keyDay) {
    // Incluye tambien los dias sin contrato vigente en que el supervisor le
    // registro un turno al reemplazo (suma base habil y horas trabajadas).
    return includesWorkDay(nombre, keyDay);
}

function hasUnjustifiedAbsence(keyDay, maps) {
    return esAusenciaInjustificada(maps.absences[keyDay]);
}

function getApprovedCoverage(keyDay, maps) {
    let coverage = 0;

    if (
        maps.legal[keyDay] ||
        maps.comp[keyDay] ||
        isApprovedAbsence(maps.absences[keyDay])
    ) {
        coverage = 1;
    }

    if (maps.admin[keyDay] === 1) {
        coverage = 1;
    } else if (isHalfAdmin(maps.admin[keyDay])) {
        coverage = Math.max(coverage, 0.5);
    }

    return coverage;
}

function getReplacementBusinessCoverage(keyDay, maps) {
    if (maps.legal[keyDay]) return 1;

    if (maps.admin[keyDay] === 1) return 1;
    if (isHalfAdmin(maps.admin[keyDay])) return 0.5;

    const absenceType =
        getAbsenceType(maps.absences[keyDay]);

    return (
        absenceType === "license" ||
        absenceType === "professional_license" ||
        absenceType === "union_leave"
    )
        ? 1
        : 0;
}

function shouldSkipWorkedShift(keyDay, maps) {
    return (
        getApprovedCoverage(keyDay, maps) >= 1 ||
        hasUnjustifiedAbsence(keyDay, maps)
    );
}

function normalDiurnoInterval(date, holidays) {
    if (!isBusinessDay(date, holidays)) {
        return [];
    }

    const day = date.getDay();
    const endHour = day === 5 ? 16 : 17;

    if (![1, 2, 3, 4, 5].includes(day)) {
        return [];
    }

    return [{
        start: dateAt(date, 8),
        end: dateAt(date, endHour)
    }];
}

function intervalsForState(date, state, holidays) {
    const turno = Number(state) || TURNO.LIBRE;

    if (turno === TURNO.LIBRE) {
        return [];
    }

    if (turno === TURNO.LARGA) {
        return [{
            start: dateAt(date, 8),
            end: dateAt(date, 20)
        }];
    }

    if (turno === TURNO.NOCHE) {
        return [{
            start: dateAt(date, 20),
            end: nextDateAt(date, 8)
        }];
    }

    if (turno === TURNO.TURNO24) {
        return [{
            start: dateAt(date, 8),
            end: nextDateAt(date, 8)
        }];
    }

    if (turno === TURNO.DIURNO) {
        return normalDiurnoInterval(date, holidays);
    }

    if (turno === TURNO.DIURNO_NOCHE) {
        return [
            ...normalDiurnoInterval(date, holidays),
            {
                start: dateAt(date, 20),
                end: nextDateAt(date, 8)
            }
        ];
    }

    if (turno === TURNO.MEDIA_MANANA) {
        return [{
            start: dateAt(date, 8),
            end: dateAt(date, 14)
        }];
    }

    if (turno === TURNO.MEDIA_TARDE) {
        return [{
            start: dateAt(date, 14),
            end: dateAt(date, 20)
        }];
    }

    if (turno === TURNO.TURNO18) {
        return [{
            start: dateAt(date, 14),
            end: nextDateAt(date, 8)
        }];
    }

    return [];
}

function hasDiurnoComponent(state) {
    const turno = Number(state) || TURNO.LIBRE;

    return (
        turno === TURNO.DIURNO ||
        turno === TURNO.DIURNO_NOCHE ||
        turno === TURNO.MEDIA_MANANA ||
        turno === TURNO.MEDIA_TARDE ||
        turno === TURNO.TURNO18
    );
}

function usesPartialDayCoverageState(state) {
    const turno = Number(state) || TURNO.LIBRE;

    return (
        turno === TURNO.MEDIA_MANANA ||
        turno === TURNO.MEDIA_TARDE ||
        turno === TURNO.TURNO18
    );
}

function baseCoversDiurnoComponent(state) {
    const turno = Number(state) || TURNO.LIBRE;

    return (
        turno === TURNO.LARGA ||
        turno === TURNO.TURNO24 ||
        turno === TURNO.DIURNO ||
        turno === TURNO.DIURNO_NOCHE
    );
}

function intervalsWithoutDiurnoComponent(date, state, holidays) {
    const turno = Number(state) || TURNO.LIBRE;

    if (turno === TURNO.DIURNO) {
        return [];
    }

    if (turno === TURNO.DIURNO_NOCHE) {
        return [{
            start: dateAt(date, 20),
            end: nextDateAt(date, 8)
        }];
    }

    if (
        turno === TURNO.MEDIA_MANANA ||
        turno === TURNO.MEDIA_TARDE
    ) {
        return [];
    }

    if (turno === TURNO.TURNO18) {
        return [{
            start: dateAt(date, 20),
            end: nextDateAt(date, 8)
        }];
    }

    return intervalsForState(date, turno, holidays);
}

function nextClassificationBoundary(cursor, end) {
    const candidates = [
        new Date(
            cursor.getFullYear(),
            cursor.getMonth(),
            cursor.getDate() + 1,
            0,
            0
        )
    ];

    [7, 21].forEach(hour => {
        const boundary = sameDayAt(cursor, hour);

        if (boundary > cursor) {
            candidates.push(boundary);
        }
    });

    candidates.push(end);

    return minDate(...candidates.filter(date => date > cursor));
}

function isNocturnalSegment(cursor, holidays) {
    const day = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate()
    );

    if (!isBusinessDay(day, holidays)) {
        return true;
    }

    const hour =
        cursor.getHours() + cursor.getMinutes() / 60;

    return hour < 7 || hour >= 21;
}

function classifyInterval(interval, holidays, rangeStart, rangeEnd) {
    const start = maxDate(interval.start, rangeStart);
    const end = minDate(interval.end, rangeEnd);
    const total = { d: 0, n: 0 };

    if (end <= start) {
        return total;
    }

    let cursor = new Date(start);

    while (cursor < end) {
        const boundary = nextClassificationBoundary(cursor, end);
        const amount = hoursBetween(cursor, boundary);

        if (isNocturnalSegment(cursor, holidays)) {
            total.n += amount;
        } else {
            total.d += amount;
        }

        cursor = boundary;
    }

    return total;
}

function classifyIntervals(intervals, holidays, rangeStart, rangeEnd) {
    const total = { d: 0, n: 0 };

    intervals.forEach(interval => {
        addHours(
            total,
            classifyInterval(
                interval,
                holidays,
                rangeStart,
                rangeEnd
            )
        );
    });

    return total;
}

function subtractOneInterval(source, blocker) {
    if (
        blocker.end <= source.start ||
        blocker.start >= source.end
    ) {
        return [source];
    }

    const pieces = [];

    if (blocker.start > source.start) {
        pieces.push({
            start: source.start,
            end: minDate(blocker.start, source.end)
        });
    }

    if (blocker.end < source.end) {
        pieces.push({
            start: maxDate(blocker.end, source.start),
            end: source.end
        });
    }

    return pieces.filter(piece => piece.end > piece.start);
}

function subtractIntervals(actualIntervals, baseIntervals) {
    let fragments = [...actualIntervals];

    baseIntervals.forEach(base => {
        fragments = fragments.flatMap(fragment =>
            subtractOneInterval(fragment, base)
        );
    });

    return fragments;
}

export function calcularExtraDiurnoProgramadoDia(
    date,
    state,
    holidays = {}
) {
    const rangeStart = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );
    const rangeEnd = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate() + 2
    );
    const intervals = subtractIntervals(
        intervalsForState(date, state, holidays),
        normalDiurnoInterval(date, holidays)
    );

    return classifyIntervals(
        intervals,
        holidays,
        rangeStart,
        rangeEnd
    );
}

function actualStateForDay(nombre, data, keyDay) {
    return aplicarCambiosTurno(
        nombre,
        keyDay,
        getTurnoProgramado(nombre, keyDay)
    );
}

function baseStateForExtraComparison(nombre, keyDay) {
    const baseState = aplicarCambiosTurno(
        nombre,
        keyDay,
        getTurnoBase(nombre, keyDay),
        { includeReplacements: false }
    );

    if (isReplacementProfile(nombre, keyDay)) {
        return baseState;
    }

    const markers = getShiftMoveMarkers(nombre, keyDay);

    if (!markers.length) {
        return baseState;
    }

    const marker = markers[markers.length - 1];
    const move = marker.move || {};

    if (marker.role === "source") {
        return TURNO.LIBRE;
    }

    if (
        move.combinedInto24 &&
        move.combinedBaseComplement
    ) {
        return TURNO.TURNO24;
    }

    return Number(move.destinationTurn) || baseState;
}

function addAggregateWorkedHours(
    totals,
    nombre,
    keyDay,
    date,
    state,
    holidays,
    rangeStart,
    rangeEnd
) {
    const turno = Number(state) || TURNO.LIBRE;

    if (turno === TURNO.LIBRE) {
        return;
    }

    if (hasClockMark(nombre, keyDay)) {
        addHours(
            totals,
            classifyIntervals(
                getWorkedIntervalsForState(
                    nombre,
                    keyDay,
                    date,
                    turno,
                    holidays
                ),
                holidays,
                rangeStart,
                rangeEnd
            )
        );
        return;
    }

    if (turno === TURNO.DIURNO) {
        addHours(totals, calcExtraHours(date, turno, holidays));
        return;
    }

    if (turno === TURNO.DIURNO_NOCHE) {
        addHours(totals, calcExtraHours(date, turno, holidays));
        return;
    }

    addHours(
        totals,
        classifyIntervals(
            intervalsForState(date, turno, holidays),
            holidays,
            rangeStart,
            rangeEnd
        )
    );
}

function calculateWorkedTotals(
    nombre,
    y,
    m,
    days,
    holidays,
    data,
    maps,
    carryIn
) {
    const totals = {
        d: carryIn?.d || 0,
        n: carryIn?.n || 0
    };
    const rangeStart = new Date(y, m, 1);
    const rangeEnd = new Date(y, m + 1, 1);

    for (let d = 1; d <= days; d++) {
        const date = new Date(y, m, d);
        const keyDay = key(y, m, d);

        if (!includesContractDay(nombre, keyDay)) {
            continue;
        }

        const coverage = getApprovedCoverage(keyDay, maps);

        if (shouldSkipWorkedShift(keyDay, maps)) {
            continue;
        }

        if (coverage === 0.5) {
            const halfAdminState =
                halfAdminWorkState(keyDay, maps);

            if (halfAdminState) {
                addHours(
                    totals,
                    classifyIntervals(
                        halfAdminWorkIntervals(
                            nombre,
                            keyDay,
                            date,
                            halfAdminState,
                            holidays
                        ),
                        holidays,
                        rangeStart,
                        rangeEnd
                    )
                );
            } else if (isBusinessDay(date, holidays)) {
                totals.d += HORA_BASE_DIARIA / 2;
            }

            continue;
        }

        addAggregateWorkedHours(
            totals,
            nombre,
            keyDay,
            date,
            actualStateForDay(nombre, data, keyDay),
            holidays,
            rangeStart,
            rangeEnd
        );
    }

    return totals;
}

function monthHasMixedBaseRotations(nombre, y, m, days, data) {
    let hasDiurno = false;
    let hasShift = false;

    for (let d = 1; d <= days; d++) {
        const keyDay = key(y, m, d);
        const state = getTurnoBase(nombre, keyDay);

        if (state === TURNO.DIURNO) {
            hasDiurno = true;
        }

        if (
            state === TURNO.LARGA ||
            state === TURNO.NOCHE ||
            state === TURNO.TURNO24
        ) {
            hasShift = true;
        }
    }

    return hasDiurno && hasShift;
}

function diurnoHasMissingBaseShift(nombre, y, m, days) {
    const maps = getMaps(nombre);

    for (let d = 1; d <= days; d++) {
        const keyDay = key(y, m, d);

        if (
            getTurnoBase(nombre, keyDay) === TURNO.DIURNO &&
            hasUnjustifiedAbsence(keyDay, maps)
        ) {
            return true;
        }
    }

    return false;
}

function getCalculationMode(nombre, y, m, days, data) {
    if (isReplacementProfile(nombre, key(y, m, 1))) {
        return "aggregate";
    }

    if (monthHasMixedBaseRotations(nombre, y, m, days, data)) {
        return "aggregate";
    }

    if (getRotativa(nombre).type === "diurno") {
        return diurnoHasMissingBaseShift(nombre, y, m, days)
            ? "aggregate"
            : "diurno";
    }

    return getShiftAssigned(nombre, new Date(y, m, 1))
        ? "assigned"
        : "aggregate";
}

function calculateAdjustedBusinessHours(
    nombre,
    y,
    m,
    days,
    holidays,
    maps
) {
    let total = 0;

    for (let d = 1; d <= days; d++) {
        const date = new Date(y, m, d);
        const keyDay = key(y, m, d);

        if (!includesContractDay(nombre, keyDay)) {
            continue;
        }

        if (!isBusinessDay(date, holidays)) {
            continue;
        }

        total += HORA_BASE_DIARIA;
        const coverage = isReplacementProfile(nombre, keyDay)
            ? getReplacementBusinessCoverage(keyDay, maps)
            : getApprovedCoverage(keyDay, maps);

        total -= coverage *
            HORA_BASE_DIARIA;
    }

    // Se redondea aca, en el origen: es la cifra contra la que se miden las
    // horas extras, asi que el numero que muestra el informe y el que usa el
    // calculo tienen que ser el mismo.
    return roundMonthlyBusinessHours(Math.max(0, total));
}

function calculateAggregateExtras(totalD, totalN, horasHabiles) {
    const remainingDay = horasHabiles - totalD;

    if (remainingDay < 0) {
        return {
            hheeDiurnas: roundExtra(Math.abs(remainingDay)),
            hheeNocturnas: roundExtra(totalN)
        };
    }

    const remainingNight = remainingDay - totalN;

    if (remainingNight < 0) {
        return {
            hheeDiurnas: 0,
            hheeNocturnas: roundExtra(Math.abs(remainingNight))
        };
    }

    return {
        hheeDiurnas: 0,
        hheeNocturnas: 0
    };
}

function calculateDiurnoExtras(
    nombre,
    y,
    m,
    days,
    holidays,
    data,
    maps,
    carryIn
) {
    const extras = {
        d: carryIn?.d || 0,
        n: carryIn?.n || 0
    };
    const rangeStart = new Date(y, m, 1);
    const rangeEnd = new Date(y, m + 1, 1);

    for (let d = 1; d <= days; d++) {
        const date = new Date(y, m, d);
        const keyDay = key(y, m, d);

        if (getApprovedCoverage(keyDay, maps) > 0) {
            continue;
        }

        if (hasUnjustifiedAbsence(keyDay, maps)) {
            continue;
        }

        const actualIntervals = getWorkedIntervalsForState(
            nombre,
            keyDay,
            date,
            actualStateForDay(nombre, data, keyDay),
            holidays
        );
        const extraIntervals = subtractIntervals(
            actualIntervals,
            normalDiurnoInterval(date, holidays)
        );

        addHours(
            extras,
            classifyIntervals(
                extraIntervals,
                holidays,
                rangeStart,
                rangeEnd
            )
        );
    }

    return extras;
}

// Aporte de una jornada diurna EXTRA (un Diurno montado sobre un dia que la
// rotativa base no cubre) y los intervalos nocturnos que quedan por medir.
//
// La jornada vale HORA_BASE_DIARIA con marcaje o sin el; el reloj solo suma lo
// trabajado de mas y resta lo programado que no se trabajo, que es la misma
// formula del reporte y del panel de registros.
//
// Antes, con marcaje, se tomaba el intervalo real del Diurno (08:00-17:00 = 9 h
// en vez de 8,8) y ademas se arrastraba una Noche que el turno no tenia:
// getWorkedIntervalsForState con TURNO.NOCHE devuelve el horario nocturno
// COMPLETO cuando no hay marca de ese segmento, asi que un Diurno extra suelto
// sumaba 20:00-24:00 de horas inventadas (1 diurna + 3 nocturnas).
function diurnoExtraContribution(
    nombre,
    keyDay,
    date,
    actualState,
    holidays
) {
    // Un turno diurno extra vale lo que dura ese dia -9 de lunes a jueves, 8 el
    // viernes-, no el promedio semanal.
    const hours = {
        d: diurnoExtraDayHours(date, day => isBusinessDay(day, holidays)),
        n: 0
    };
    const nightIntervals = intervalsWithoutDiurnoComponent(
        date,
        actualState,
        holidays
    );

    if (!hasClockMark(nombre, keyDay)) {
        return { hours, nightIntervals };
    }

    const extra = getClockExtraHours(
        nombre,
        keyDay,
        date,
        TURNO.DIURNO,
        holidays
    );
    const deficit = getClockDeficitHours(
        nombre,
        keyDay,
        date,
        TURNO.DIURNO,
        holidays
    );

    hours.d += (Number(extra.d) || 0) - (Number(deficit.d) || 0);
    hours.n += (Number(extra.n) || 0) - (Number(deficit.n) || 0);

    return {
        hours,
        // La parte nocturna solo se mide contra el reloj si el turno realizado
        // efectivamente la tiene (Diurno+Noche, Turno 18).
        nightIntervals: nightIntervals.length
            ? getWorkedIntervalsForState(
                nombre,
                keyDay,
                date,
                TURNO.NOCHE,
                holidays
            )
            : []
    };
}

function calculateAssignedExtras(
    nombre,
    y,
    m,
    days,
    holidays,
    data,
    maps,
    carryIn
) {
    const extras = {
        d: carryIn?.d || 0,
        n: carryIn?.n || 0
    };
    const rangeStart = new Date(y, m, 1);
    const rangeEnd = new Date(y, m + 1, 1);

    for (let d = 1; d <= days; d++) {
        const date = new Date(y, m, d);
        const keyDay = key(y, m, d);

        if (getApprovedCoverage(keyDay, maps) > 0) {
            continue;
        }

        if (hasUnjustifiedAbsence(keyDay, maps)) {
            continue;
        }

        const actualState =
            actualStateForDay(nombre, data, keyDay);
        const baseState =
            baseStateForExtraComparison(nombre, keyDay);
        let actualIntervals = getWorkedIntervalsForState(
            nombre,
            keyDay,
            date,
            actualState,
            holidays
        );
        const hasExtraDiurno =
            hasDiurnoComponent(actualState) &&
            !baseCoversDiurnoComponent(baseState) &&
            !usesPartialDayCoverageState(actualState);

        if (hasExtraDiurno) {
            const diurno = diurnoExtraContribution(
                nombre,
                keyDay,
                date,
                actualState,
                holidays
            );

            addHours(extras, diurno.hours);
            actualIntervals = diurno.nightIntervals;
        }

        const baseIntervals = intervalsForState(
            date,
            baseState,
            holidays
        );
        const extraIntervals = subtractIntervals(
            actualIntervals,
            baseIntervals
        );

        addHours(
            extras,
            classifyIntervals(
                extraIntervals,
                holidays,
                rangeStart,
                rangeEnd
            )
        );
    }

    return extras;
}

function calculateCarryForMode(
    mode,
    nombre,
    y,
    m,
    days,
    holidays,
    data,
    maps
) {
    const date = new Date(y, m, days);
    const keyDay = key(y, m, days);
    const monthEnd = new Date(y, m + 1, 1);
    const carryEnd = new Date(y, m + 1, 2);

    if (
        !includesContractDay(nombre, keyDay) ||
        getApprovedCoverage(keyDay, maps) > 0 ||
        hasUnjustifiedAbsence(keyDay, maps)
    ) {
        return { d: 0, n: 0 };
    }

    const actualIntervals = getWorkedIntervalsForState(
        nombre,
        keyDay,
        date,
        actualStateForDay(nombre, data, keyDay),
        holidays
    );

    if (mode === "aggregate") {
        return classifyIntervals(
            actualIntervals,
            holidays,
            monthEnd,
            carryEnd
        );
    }

    const baseIntervals = mode === "diurno"
        ? normalDiurnoInterval(date, holidays)
        : intervalsForState(
            date,
            baseStateForExtraComparison(nombre, keyDay),
            holidays
        );

    return classifyIntervals(
        subtractIntervals(actualIntervals, baseIntervals),
        holidays,
        monthEnd,
        carryEnd
    );
}

function calculateClockAbsenceAdjustments(
    mode,
    nombre,
    y,
    m,
    days,
    holidays,
    data,
    maps
) {
    const total = { d: 0, n: 0 };
    const rangeStart = new Date(y, m, 1);
    const rangeEnd = new Date(y, m + 1, 1);

    for (let d = 1; d <= days; d++) {
        const date = new Date(y, m, d);
        const keyDay = key(y, m, d);

        if (!includesContractDay(nombre, keyDay)) {
            continue;
        }

        if (!hasClockMark(nombre, keyDay)) {
            continue;
        }

        const halfAdminState =
            halfAdminWorkState(keyDay, maps);

        if (
            !halfAdminState &&
            (
                getApprovedCoverage(keyDay, maps) > 0 ||
                hasUnjustifiedAbsence(keyDay, maps)
            )
        ) {
            continue;
        }

        const baseIntervals = halfAdminState
            ? halfAdminWorkIntervals(
                nombre,
                keyDay,
                date,
                halfAdminState,
                holidays
            )
            : mode === "diurno"
                ? normalDiurnoInterval(date, holidays)
                : intervalsForState(
                    date,
                    baseStateForExtraComparison(nombre, keyDay),
                    holidays
                );

        if (!baseIntervals.length) {
            continue;
        }

        const actualIntervals = getWorkedIntervalsForState(
            nombre,
            keyDay,
            date,
            halfAdminState ||
                getClockScheduleState(
                    nombre,
                    keyDay,
                    actualStateForDay(nombre, data, keyDay)
                ),
            holidays
        );
        const absenceIntervals = subtractIntervals(
            baseIntervals,
            actualIntervals
        );

        addHours(
            total,
            classifyIntervals(
                absenceIntervals,
                holidays,
                rangeStart,
                rangeEnd
            )
        );
    }

    return total;
}

function pushPaymentSegment(segments, keyDay, hours) {
    const dayHours = Number(hours?.d) || 0;
    const nightHours = Number(hours?.n) || 0;

    if (dayHours) {
        segments.push({
            keyDay,
            type: "d",
            hours: dayHours
        });
    }

    if (nightHours) {
        segments.push({
            keyDay,
            type: "n",
            hours: nightHours
        });
    }
}

function calculateDiurnoExtraSegments(
    nombre,
    y,
    m,
    days,
    holidays,
    data,
    maps,
    carryIn
) {
    const segments = [];
    const rangeStart = new Date(y, m, 1);
    const rangeEnd = new Date(y, m + 1, 1);

    if (carryIn?.d || carryIn?.n) {
        pushPaymentSegment(
            segments,
            key(y, m, 1),
            carryIn
        );
    }

    for (let d = 1; d <= days; d++) {
        const date = new Date(y, m, d);
        const keyDay = key(y, m, d);

        if (getApprovedCoverage(keyDay, maps) > 0) {
            continue;
        }

        if (hasUnjustifiedAbsence(keyDay, maps)) {
            continue;
        }

        const actualIntervals = getWorkedIntervalsForState(
            nombre,
            keyDay,
            date,
            actualStateForDay(nombre, data, keyDay),
            holidays
        );
        const extraIntervals = subtractIntervals(
            actualIntervals,
            normalDiurnoInterval(date, holidays)
        );

        pushPaymentSegment(
            segments,
            keyDay,
            classifyIntervals(
                extraIntervals,
                holidays,
                rangeStart,
                rangeEnd
            )
        );
    }

    return segments;
}

function calculateAssignedExtraSegments(
    nombre,
    y,
    m,
    days,
    holidays,
    data,
    maps,
    carryIn
) {
    const segments = [];
    const rangeStart = new Date(y, m, 1);
    const rangeEnd = new Date(y, m + 1, 1);

    if (carryIn?.d || carryIn?.n) {
        pushPaymentSegment(
            segments,
            key(y, m, 1),
            carryIn
        );
    }

    for (let d = 1; d <= days; d++) {
        const date = new Date(y, m, d);
        const keyDay = key(y, m, d);

        if (getApprovedCoverage(keyDay, maps) > 0) {
            continue;
        }

        if (hasUnjustifiedAbsence(keyDay, maps)) {
            continue;
        }

        const actualState =
            actualStateForDay(nombre, data, keyDay);
        const baseState =
            baseStateForExtraComparison(nombre, keyDay);
        let actualIntervals = getWorkedIntervalsForState(
            nombre,
            keyDay,
            date,
            actualState,
            holidays
        );
        const hasExtraDiurno =
            hasDiurnoComponent(actualState) &&
            !baseCoversDiurnoComponent(baseState) &&
            !usesPartialDayCoverageState(actualState);

        if (hasExtraDiurno) {
            const diurno = diurnoExtraContribution(
                nombre,
                keyDay,
                date,
                actualState,
                holidays
            );

            pushPaymentSegment(segments, keyDay, diurno.hours);
            actualIntervals = diurno.nightIntervals;
        }

        const baseIntervals = intervalsForState(
            date,
            baseState,
            holidays
        );
        const extraIntervals = subtractIntervals(
            actualIntervals,
            baseIntervals
        );

        pushPaymentSegment(
            segments,
            keyDay,
            classifyIntervals(
                extraIntervals,
                holidays,
                rangeStart,
                rangeEnd
            )
        );
    }

    return segments;
}

function calculateAggregateExtraSegments(
    nombre,
    y,
    m,
    days,
    holidays,
    data,
    maps,
    carryIn,
    horasHabiles
) {
    const daily = [];
    const rangeStart = new Date(y, m, 1);
    const rangeEnd = new Date(y, m + 1, 1);

    for (let d = 1; d <= days; d++) {
        const date = new Date(y, m, d);
        const keyDay = key(y, m, d);
        const dayTotals = { d: 0, n: 0 };

        if (d === 1 && (carryIn?.d || carryIn?.n)) {
            addHours(dayTotals, carryIn);
        }

        if (!includesContractDay(nombre, keyDay)) {
            daily.push({
                keyDay,
                ...dayTotals
            });
            continue;
        }

        const coverage = getApprovedCoverage(keyDay, maps);

        if (!shouldSkipWorkedShift(keyDay, maps)) {
            if (coverage === 0.5) {
                if (isBusinessDay(date, holidays)) {
                    dayTotals.d += HORA_BASE_DIARIA / 2;
                }
            } else {
                addAggregateWorkedHours(
                    dayTotals,
                    nombre,
                    keyDay,
                    date,
                    actualStateForDay(nombre, data, keyDay),
                    holidays,
                    rangeStart,
                    rangeEnd
                );
            }
        }

        daily.push({
            keyDay,
            ...dayTotals
        });
    }

    const totalD = daily.reduce(
        (sum, item) => sum + item.d,
        0
    );
    const segments = [];

    if (totalD > horasHabiles) {
        let remainingBase = horasHabiles;

        daily.forEach(item => {
            const covered = Math.min(
                item.d,
                Math.max(0, remainingBase)
            );
            remainingBase -= covered;

            pushPaymentSegment(
                segments,
                item.keyDay,
                {
                    d: item.d - covered,
                    n: item.n
                }
            );
        });

        return segments;
    }

    let remainingBase = Math.max(
        0,
        horasHabiles - totalD
    );

    daily.forEach(item => {
        const covered = Math.min(
            item.n,
            Math.max(0, remainingBase)
        );
        remainingBase -= covered;

        pushPaymentSegment(
            segments,
            item.keyDay,
            {
                d: 0,
                n: item.n - covered
            }
        );
    });

    return segments;
}

function calculateClockAbsenceSegments(
    mode,
    nombre,
    y,
    m,
    days,
    holidays,
    data,
    maps
) {
    const segments = [];
    const rangeStart = new Date(y, m, 1);
    const rangeEnd = new Date(y, m + 1, 1);

    for (let d = 1; d <= days; d++) {
        const date = new Date(y, m, d);
        const keyDay = key(y, m, d);

        if (!includesContractDay(nombre, keyDay)) {
            continue;
        }

        if (!hasClockMark(nombre, keyDay)) {
            continue;
        }

        const halfAdminState =
            halfAdminWorkState(keyDay, maps);

        if (
            !halfAdminState &&
            (
                getApprovedCoverage(keyDay, maps) > 0 ||
                hasUnjustifiedAbsence(keyDay, maps)
            )
        ) {
            continue;
        }

        const baseIntervals = halfAdminState
            ? halfAdminWorkIntervals(
                nombre,
                keyDay,
                date,
                halfAdminState,
                holidays
            )
            : mode === "diurno"
                ? normalDiurnoInterval(date, holidays)
                : intervalsForState(
                    date,
                    baseStateForExtraComparison(nombre, keyDay),
                    holidays
                );

        if (!baseIntervals.length) {
            continue;
        }

        const actualIntervals = getWorkedIntervalsForState(
            nombre,
            keyDay,
            date,
            halfAdminState ||
                getClockScheduleState(
                    nombre,
                    keyDay,
                    actualStateForDay(nombre, data, keyDay)
                ),
            holidays
        );
        const absenceIntervals = subtractIntervals(
            baseIntervals,
            actualIntervals
        );
        const absence = classifyIntervals(
            absenceIntervals,
            holidays,
            rangeStart,
            rangeEnd
        );

        pushPaymentSegment(
            segments,
            keyDay,
            {
                d: -absence.d,
                n: -absence.n
            }
        );
    }

    return segments;
}

function calculatePaymentFromSegments(
    nombre,
    segments,
    hheeDiurnas,
    hheeNocturnas
) {
    function amountFor(type, target, multiplier) {
        const typedSegments = segments.filter(segment =>
            segment.type === type
        );
        const rawTotal = typedSegments.reduce(
            (sum, segment) => sum + segment.hours,
            0
        );

        if (!target || !typedSegments.length) return 0;

        if (Math.abs(rawTotal) < 0.0001) {
            return (
                target *
                multiplier *
                getValorHora(nombre)
            );
        }

        const factor = target / rawTotal;

        return typedSegments.reduce((sum, segment) => {
            const rate = getValorHora(
                nombre,
                keyToISODate(segment.keyDay)
            );

            return sum +
                (segment.hours * factor * multiplier * rate);
        }, 0);
    }

    return {
        d: amountFor("d", hheeDiurnas, 1.25),
        n: amountFor("n", hheeNocturnas, 1.5)
    };
}

function calculatePaymentSegments({
    mode,
    nombre,
    y,
    m,
    days,
    holidays,
    data,
    maps,
    carryIn,
    horasHabiles
}) {
    const segments = mode === "aggregate"
        ? calculateAggregateExtraSegments(
            nombre,
            y,
            m,
            days,
            holidays,
            data,
            maps,
            carryIn,
            horasHabiles
        )
        : mode === "diurno"
            ? calculateDiurnoExtraSegments(
                nombre,
                y,
                m,
                days,
                holidays,
                data,
                maps,
                carryIn
            )
            : calculateAssignedExtraSegments(
                nombre,
                y,
                m,
                days,
                holidays,
                data,
                maps,
                carryIn
            );

    return [
        ...segments,
        ...calculateClockAbsenceSegments(
            mode,
            nombre,
            y,
            m,
            days,
            holidays,
            data,
            maps
        )
    ];
}

function calculatePreviousCarryIn(nombre, y, m, holidays) {
    const previous = new Date(y, m, 0);
    const previousYear = previous.getFullYear();
    const previousMonth = previous.getMonth();
    const previousDays = previous.getDate();
    const previousData = readProfileMap("data", nombre);
    const previousMaps = getMaps(nombre);
    const previousMode = getCalculationMode(
        nombre,
        previousYear,
        previousMonth,
        previousDays,
        previousData
    );

    return calculateCarryForMode(
        previousMode,
        nombre,
        previousYear,
        previousMonth,
        previousDays,
        holidays,
        previousData,
        previousMaps
    );
}

function buildStats({
    nombre,
    y,
    m,
    days,
    holidays,
    data,
    carryIn
}) {
    const maps = getMaps(nombre);
    const mode = getCalculationMode(nombre, y, m, days, data);
    const effectiveCarryIn =
        calculatePreviousCarryIn(nombre, y, m, holidays);
    const worked = calculateWorkedTotals(
        nombre,
        y,
        m,
        days,
        holidays,
        data,
        maps,
        effectiveCarryIn
    );
    const horasHabiles = calculateAdjustedBusinessHours(
        nombre,
        y,
        m,
        days,
        holidays,
        maps
    );
    let hheeDiurnas = 0;
    let hheeNocturnas = 0;

    if (mode === "aggregate") {
        const extras = calculateAggregateExtras(
            worked.d,
            worked.n,
            horasHabiles
        );

        hheeDiurnas = extras.hheeDiurnas;
        hheeNocturnas = extras.hheeNocturnas;
    } else {
        const extras = mode === "diurno"
            ? calculateDiurnoExtras(
                nombre,
                y,
                m,
                days,
                holidays,
                data,
                maps,
                effectiveCarryIn
            )
            : calculateAssignedExtras(
                nombre,
                y,
                m,
                days,
                holidays,
                data,
                maps,
                effectiveCarryIn
            );

        hheeDiurnas = roundExtra(extras.d);
        hheeNocturnas = roundExtra(extras.n);
    }

    const clockAbsences = calculateClockAbsenceAdjustments(
        mode,
        nombre,
        y,
        m,
        days,
        holidays,
        data,
        maps
    );

    hheeDiurnas = roundSignedExtra(
        hheeDiurnas - clockAbsences.d
    );
    hheeNocturnas = roundSignedExtra(
        hheeNocturnas - clockAbsences.n
    );

    const returnTransferEnabled =
        isHheeReturnTransferEnabled(nombre, y, m);
    const returnTransferHours =
        calculateHheeReturnTransferHours(
            hheeDiurnas,
            hheeNocturnas
        );
    const payment = returnTransferEnabled
        ? { d: 0, n: 0 }
        : calculatePaymentFromSegments(
            nombre,
            calculatePaymentSegments({
                mode,
                nombre,
                y,
                m,
                days,
                holidays,
                data,
                maps,
                carryIn: effectiveCarryIn,
                horasHabiles
            }),
            hheeDiurnas,
            hheeNocturnas
        );

    return {
        totalD: roundHour(worked.d),
        totalN: roundHour(worked.n),
        horasHabiles: roundHour(horasHabiles),
        hheeDiurnas,
        hheeNocturnas,
        paymentDiurno: payment.d,
        paymentNocturno: payment.n,
        returnTransferEnabled,
        returnTransferHours,
        mode,
        carryOut: calculateCarryForMode(
            mode,
            nombre,
            y,
            m,
            days,
            holidays,
            data,
            maps
        )
    };
}

export function calcularHorasMesPerfil(
    nombre,
    y,
    m,
    days,
    holidays,
    data,
    blocked,
    carryIn
) {
    if (!nombre) {
        return {
            totalD: 0,
            totalN: 0,
            horasHabiles: 0,
            hheeDiurnas: 0,
            hheeNocturnas: 0,
            paymentDiurno: 0,
            paymentNocturno: 0,
            returnTransferEnabled: false,
            returnTransferHours: 0,
            mode: "aggregate",
            carryOut: { d: 0, n: 0 }
        };
    }

    return buildStats({
        nombre,
        y,
        m,
        days,
        holidays,
        data,
        carryIn
    });
}

// API nominal usada por las actualizaciones incrementales. Conserva el motor
// probado de horas y limita el cálculo al trabajador/mes solicitado.
export function calculateWorkerMonthTotals(
    workerId,
    year,
    month,
    days,
    holidays,
    data,
    blocked,
    carryIn
) {
    return calcularHorasMesPerfil(
        workerId,
        year,
        month,
        days,
        holidays,
        data,
        blocked,
        carryIn
    );
}

export function renderSummaryHTML(stats, extra = {}) {
    const valorHora =
        getValorHora();
    const dayAlertClass =
        getDayExtraAlertClass(stats.hheeDiurnas);

    const pagoDiurno =
        Number.isFinite(Number(stats.paymentDiurno))
            ? Number(stats.paymentDiurno)
            : stats.hheeDiurnas *
                1.25 *
                valorHora;

    const pagoNocturno =
        Number.isFinite(Number(stats.paymentNocturno))
            ? Number(stats.paymentNocturno)
            : stats.hheeNocturnas *
                1.5 *
                valorHora;

    const currency = new Intl.NumberFormat(
        "es-CL",
        {
            maximumFractionDigits: 0
        }
    );

    const enabled = stats.returnTransferEnabled;
    const totalHours =
        (Number(stats.hheeDiurnas) || 0) +
        (Number(stats.hheeNocturnas) || 0);
    const totalPago = pagoDiurno + pagoNocturno;
    const returnHours =
        Number.isFinite(Number(stats.returnTransferHours)) &&
        Number(stats.returnTransferHours) > 0
            ? Number(stats.returnTransferHours)
            : Math.max(0, stats.hheeDiurnas || 0) * 1.25 +
                Math.max(0, stats.hheeNocturnas || 0) * 1.5;

    const bigValue = enabled
        ? `${formatTransferHours(returnHours)} h`
        : `$${currency.format(totalPago)}`;
    const curLabel = enabled
        ? "a devoluci\u00f3n"
        : "total estimado";
    const subText = enabled
        ? `${formatExtra(totalHours)} h extraordinarias del mes`
        : `${formatExtra(totalHours)} h extraordinarias \u00b7 valor hora $${currency.format(valorHora)}`;

    const dayAmount = enabled
        ? `${formatTransferHours(
            Math.max(0, stats.hheeDiurnas || 0) * 1.25
        )} h a devoluci\u00f3n`
        : `$${currency.format(pagoDiurno)}`;
    const nightAmount = enabled
        ? `${formatTransferHours(
            Math.max(0, stats.hheeNocturnas || 0) * 1.5
        )} h a devoluci\u00f3n`
        : `$${currency.format(pagoNocturno)}`;

    const delta = Number(extra.deltaHours);
    const deltaHTML =
        Number.isFinite(delta) && Math.abs(delta) >= 0.05
            ? `<div class="hh-delta ${delta < 0 ? "down" : ""}">${delta < 0 ? "\u25bc" : "\u25b2"} ${formatExtra(Math.abs(delta))} h vs. ${extra.prevLabel || "mes anterior"}</div>`
            : "";

    return `
        <div class="hh-total">
            <span class="big${enabled ? " is-return" : ""}">${bigValue}</span>
            <span class="cur">${curLabel}</span>
        </div>
        <div class="hh-total-sub">${subText}</div>
        ${deltaHTML}

        <div class="hh-split">
            <div class="hh-split-cell">
                <span class="lbl"><span class="hh-dot hh-dot-d"></span> Diurnas &times;1,25</span>
                <div class="h ${dayAlertClass}">${formatExtra(stats.hheeDiurnas)} h</div>
                <div class="money">${dayAmount}</div>
            </div>
            <div class="hh-split-cell">
                <span class="lbl"><span class="hh-dot hh-dot-n"></span> Nocturnas &times;1,5</span>
                <div class="h">${formatExtra(stats.hheeNocturnas)} h</div>
                <div class="money">${nightAmount}</div>
            </div>
        </div>

        <div class="hh-meta">
            <span>Base del mes: <b>${formatHour(stats.horasHabiles)} h</b></span>
            <span>Trabajado: <b>${formatHour(stats.totalD)} h</b> D / <b>${formatHour(stats.totalN)} h</b> N</span>
            <span>Valor hora: <b>$${currency.format(valorHora)}</b></span>
        </div>
    `;
}

export function calcularCarryMes(
    y,
    m,
    days,
    holidays,
    data
) {
    const nombre = getCurrentProfile();

    return calculateCarryOver(
        nombre,
        y,
        m,
        days,
        holidays,
        data
    );
}

export function calculateCarryOver(
    workerId,
    y,
    m,
    days,
    holidays,
    data
) {
    const nombre = workerId;

    if (!nombre) {
        return { d: 0, n: 0 };
    }

    return buildStats({
        nombre,
        y,
        m,
        days,
        holidays,
        data,
        carryIn: { d: 0, n: 0 }
    }).carryOut;
}
