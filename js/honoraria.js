import {
    getHonorariaContractForDate
} from "./contracts.js";
import { calcExtraHours } from "./calculations.js";
import { getTurnoReal } from "./turnEngine.js";
import { getClockMark, getWorkedIntervalsForState } from "./clockMarks.js";

/**
 * Horas de un dia de honorarios: las del turno, o las TRABAJADAS si el
 * supervisor modifico el marcaje. Es la forma que tiene de ajustar un periodo
 * que se paso del tope sin quitar el turno entero, asi que tiene que contar.
 *
 * El reparto diurno/nocturno se conserva en la misma proporcion del turno: el
 * tope es de horas totales, el reparto solo informa.
 */
function honorariaDayHours(profileName, keyDay, date, state, holidays) {
    // Honorarios contabiliza un turno efectivamente realizado. Por eso el
    // Diurno vale 9 h de lunes a jueves y 8 h el viernes, no el promedio 8,8
    // usado para repartir la jornada habil contractual de otros trabajadores.
    const base = calcExtraHours(date, state, holidays);
    const baseDay = Math.max(0, Number(base.d) || 0);
    const baseNight = Math.max(0, Number(base.n) || 0);

    if (!getClockMark(profileName, keyDay)) {
        return { d: baseDay, n: baseNight };
    }

    const worked = getWorkedIntervalsForState(
        profileName,
        keyDay,
        date,
        state,
        holidays
    ).reduce((total, interval) =>
        total + Math.max(0, (interval.end - interval.start) / 3600000), 0);
    const baseTotal = baseDay + baseNight;

    if (baseTotal <= 0) return { d: worked, n: 0 };

    const ratio = worked / baseTotal;

    return { d: baseDay * ratio, n: baseNight * ratio };
}

function roundHours(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

// Tope mensual. Se conservan los campos antiguos solo como fallback de lectura.
function contractHours(contract) {
    return Math.max(
        0,
        Number(contract?.maxHours) ||
            Number(contract?.maxMonthlyHours) ||
            Number(contract?.maxWeeklyHours) ||
            0
    );
}

function keyFromDate(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isoFromDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function firstHonorariaContractInMonth(profileName, year, month) {
    const days = new Date(year, month + 1, 0).getDate();

    for (let day = 1; day <= days; day++) {
        const contract = getHonorariaContractForDate(
            profileName,
            `${year}-${month}-${day}`
        );

        if (contract) return contract;
    }

    return null;
}

function emptySummary(profileName, contract, year, month) {
    return {
        profileName,
        contract,
        year,
        month,
        allowedHours: 0,
        assignedHours: 0,
        overtimeHours: 0,
        overtimeDay: 0,
        overtimeNight: 0,
        excessByKey: {},
        periodByKey: {},
        periods: {}
    };
}

function monthlyPeriodKey(contract) {
    return [
        contract?.start || "",
        contract?.end || "",
        Number(contract?.hourlyRate) || 0,
        contractHours(contract)
    ].join("|");
}

export function getHonorariaMonthlySummary(
    profileName,
    year,
    month,
    holidays = {}
) {
    const contract = firstHonorariaContractInMonth(
        profileName,
        year,
        month
    );

    if (!contract) return null;

    const summary = emptySummary(profileName, contract, year, month);
    const days = new Date(year, month + 1, 0).getDate();
    const monthStart = isoFromDate(new Date(year, month, 1));
    const monthEnd = isoFromDate(new Date(year, month, days));

    for (let day = 1; day <= days; day++) {
        const date = new Date(year, month, day);
        const keyDay = keyFromDate(date);
        const dayContract = getHonorariaContractForDate(profileName, keyDay);

        if (!dayContract) continue;

        const periodKey = monthlyPeriodKey(dayContract);
        const cap = contractHours(dayContract);
        const period = summary.periods[periodKey] || {
            key: periodKey,
            start: dayContract.start > monthStart
                ? dayContract.start
                : monthStart,
            end: dayContract.end < monthEnd
                ? dayContract.end
                : monthEnd,
            contract: dayContract,
            allowedHours: cap,
            assignedHours: 0,
            overtimeHours: 0,
            overtimeDay: 0,
            overtimeNight: 0
        };

        summary.periods[periodKey] = period;
        summary.periodByKey[keyDay] = periodKey;

        const state = getTurnoReal(profileName, keyDay);
        const hours = honorariaDayHours(
            profileName,
            keyDay,
            date,
            state,
            holidays
        );
        const dayHours = Math.max(0, Number(hours.d) || 0);
        const nightHours = Math.max(0, Number(hours.n) || 0);
        const turnHours = roundHours(dayHours + nightHours);

        if (!turnHours) continue;

        const assignedBefore = period.assignedHours;
        let regularRemaining = Math.max(0, cap - assignedBefore);
        const regularDay = Math.min(dayHours, regularRemaining);

        regularRemaining -= regularDay;

        const regularNight = Math.min(nightHours, regularRemaining);
        const excessDay = roundHours(dayHours - regularDay);
        const excessNight = roundHours(nightHours - regularNight);
        const excessHours = roundHours(excessDay + excessNight);

        period.assignedHours = roundHours(assignedBefore + turnHours);
        summary.assignedHours = roundHours(
            summary.assignedHours + turnHours
        );

        if (excessHours <= 0) continue;

        period.overtimeDay = roundHours(period.overtimeDay + excessDay);
        period.overtimeNight = roundHours(period.overtimeNight + excessNight);
        period.overtimeHours = roundHours(
            period.overtimeHours + excessHours
        );
        summary.overtimeDay = roundHours(
            summary.overtimeDay + excessDay
        );
        summary.overtimeNight = roundHours(
            summary.overtimeNight + excessNight
        );
        summary.overtimeHours = roundHours(
            summary.overtimeHours + excessHours
        );
        summary.excessByKey[keyDay] = {
            keyDay,
            state,
            turnHours,
            excessHours,
            excessDay,
            excessNight,
            assignedHours: period.assignedHours,
            monthlyAssignedHours: period.assignedHours,
            allowedHours: cap,
            limitPeriod: "monthly",
            periodKey,
            monthStart,
            monthEnd
        };
    }

    summary.allowedHours = Object.values(summary.periods)
        .reduce((total, period) => total + period.allowedHours, 0);

    return summary;
}

export function getHonorariaExcessForKey(summary, keyDay) {
    return summary?.excessByKey?.[keyDay] || null;
}

export function getHonorariaLimitMessage(summary, keyDay = "") {
    if (!summary) return "";

    const excess = keyDay
        ? getHonorariaExcessForKey(summary, keyDay)
        : null;
    const periodKey = excess?.periodKey || summary.periodByKey?.[keyDay] || "";
    const period = periodKey
        ? summary.periods?.[periodKey] || null
        : null;
    const allowedHours =
        period?.allowedHours ??
        excess?.allowedHours ??
        summary.allowedHours ??
        0;
    const assignedHours =
        period?.assignedHours ??
        excess?.monthlyAssignedHours ??
        summary.assignedHours ??
        0;

    return `${summary.profileName} tiene permitido un maximo de ${allowedHours} horas para este mes. Actualmente tiene asignadas ${assignedHours} horas.`;
}
