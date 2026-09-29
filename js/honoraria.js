import {
    getHonorariaContractForDate
} from "./contracts.js";
import { calcHours } from "./calculations.js";
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
    const base = calcHours(date, state, holidays);
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

// Tope de horas del contrato (generico: semanal o mensual segun limitPeriod).
function contractHours(contract) {
    return Math.max(
        0,
        Number(contract?.maxHours) ||
            Number(contract?.maxWeeklyHours) ||
            Number(contract?.maxMonthlyHours) ||
            0
    );
}

function allowedWeeklyHours(contract) {
    return contractHours(contract);
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

function weekStartForDate(date) {
    const start = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );
    const offset = (start.getDay() + 6) % 7;

    start.setDate(start.getDate() - offset);

    return start;
}

function addDays(date, days) {
    const next = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );

    next.setDate(next.getDate() + days);

    return next;
}

function formatShortDate(iso) {
    const parts = String(iso || "").split("-").map(Number);

    if (parts.length !== 3 || !parts.every(Number.isFinite)) {
        return "";
    }

    return `${parts[2]}/${parts[1]}`;
}

function emptySummary(profileName, contract = null) {
    const allowedHours = allowedWeeklyHours(contract);

    return {
        profileName,
        contract,
        allowedHours,
        allowedWeeklyHours: allowedHours,
        assignedHours: 0,
        overtimeHours: 0,
        overtimeDay: 0,
        overtimeNight: 0,
        excessByKey: {},
        weekByKey: {},
        weeks: {}
    };
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

    const summary = emptySummary(profileName, contract);
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    const lastWeekStart = weekStartForDate(monthEnd);
    let cursor = weekStartForDate(monthStart);
    let periodAssignedHours = 0;
    let overtimeDay = 0;
    let overtimeNight = 0;
    // Acumulado por "bucket" del tope: por SEMANA (contratos semanales) o por MES
    // calendario (contratos mensuales). Cada contrato define su periodo.
    const bucketAssigned = {};

    while (cursor <= lastWeekStart) {
        const weekStart = new Date(cursor);
        const weekEnd = addDays(weekStart, 6);
        const weekKey = keyFromDate(weekStart);
        const week = {
            key: weekKey,
            start: isoFromDate(weekStart),
            end: isoFromDate(weekEnd),
            allowedHours: summary.allowedWeeklyHours,
            assignedHours: 0,
            overtimeHours: 0,
            overtimeDay: 0,
            overtimeNight: 0
        };

        summary.weeks[weekKey] = week;

        for (let offset = 0; offset < 7; offset++) {
            const date = addDays(weekStart, offset);
            const keyDay = keyFromDate(date);
            const inDisplayedMonth =
                date.getFullYear() === year &&
                date.getMonth() === month;

            const dayContract =
                getHonorariaContractForDate(profileName, keyDay);

            if (!dayContract) {
                continue;
            }

            // Tope y periodo del contrato vigente ESE dia. El bucket del tope es
            // la SEMANA (semanal) o el MES calendario (mensual).
            const cap = contractHours(dayContract);
            const isMonthly = dayContract.limitPeriod === "monthly";
            const bucketKey = isMonthly
                ? `m-${date.getFullYear()}-${date.getMonth()}`
                : weekKey;

            week.allowedHours = cap;

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

            const assignedBefore = bucketAssigned[bucketKey] || 0;
            let regularRemaining = Math.max(0, cap - assignedBefore);
            const regularDay = Math.min(dayHours, regularRemaining);

            regularRemaining -= regularDay;

            const regularNight = Math.min(nightHours, regularRemaining);
            const excessDay = roundHours(dayHours - regularDay);
            const excessNight = roundHours(nightHours - regularNight);
            const excessHours = roundHours(excessDay + excessNight);

            bucketAssigned[bucketKey] = roundHours(assignedBefore + turnHours);
            week.assignedHours = roundHours(
                week.assignedHours + turnHours
            );
            summary.weekByKey[keyDay] = weekKey;

            if (inDisplayedMonth) {
                periodAssignedHours = roundHours(
                    periodAssignedHours + turnHours
                );
            }

            if (excessHours > 0) {
                week.overtimeDay = roundHours(
                    week.overtimeDay + excessDay
                );
                week.overtimeNight = roundHours(
                    week.overtimeNight + excessNight
                );
                week.overtimeHours = roundHours(
                    week.overtimeHours + excessHours
                );

                if (inDisplayedMonth) {
                    overtimeDay = roundHours(overtimeDay + excessDay);
                    overtimeNight = roundHours(overtimeNight + excessNight);
                    summary.excessByKey[keyDay] = {
                        keyDay,
                        state,
                        turnHours,
                        excessHours,
                        excessDay,
                        excessNight,
                        assignedHours: bucketAssigned[bucketKey],
                        weekAssignedHours: bucketAssigned[bucketKey],
                        allowedHours: cap,
                        limitPeriod: isMonthly ? "monthly" : "weekly",
                        weekKey,
                        weekStart: week.start,
                        weekEnd: week.end
                    };
                }
            }
        }

        cursor = addDays(cursor, 7);
    }

    summary.assignedHours = roundHours(periodAssignedHours);
    summary.overtimeDay = overtimeDay;
    summary.overtimeNight = overtimeNight;
    summary.overtimeHours = roundHours(overtimeDay + overtimeNight);

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
    const weekKey = excess?.weekKey || summary.weekByKey?.[keyDay] || "";
    const week = weekKey
        ? summary.weeks?.[weekKey] || null
        : null;
    const allowedHours =
        week?.allowedHours ??
        excess?.allowedHours ??
        summary.allowedWeeklyHours ??
        summary.allowedHours ??
        0;
    const assignedHours =
        week?.assignedHours ??
        excess?.weekAssignedHours ??
        summary.assignedHours ??
        0;
    const period = week
        ? ` entre ${formatShortDate(week.start)} y ${formatShortDate(week.end)}`
        : "";

    return `${summary.profileName} tiene permitido un maximo de ${allowedHours} horas para esta semana${period}. Actualmente tiene asignadas ${assignedHours} horas.`;
}
