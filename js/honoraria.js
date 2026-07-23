import {
    getHonorariaContract,
    hasHonorariaContractForDate
} from "./contracts.js";
import { calcHours } from "./calculations.js";
import { getTurnoReal } from "./turnEngine.js";

function roundHours(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function allowedWeeklyHours(contract) {
    return Math.max(
        0,
        Number(contract?.maxWeeklyHours) ||
            Number(contract?.maxMonthlyHours) ||
            0
    );
}

function keyFromDate(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isoFromDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
    const contract = getHonorariaContract(profileName);

    if (!contract) return null;

    const summary = emptySummary(profileName, contract);
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    const lastWeekStart = weekStartForDate(monthEnd);
    let cursor = weekStartForDate(monthStart);
    let periodAssignedHours = 0;
    let overtimeDay = 0;
    let overtimeNight = 0;

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

            if (!hasHonorariaContractForDate(profileName, keyDay)) {
                continue;
            }

            const state = getTurnoReal(profileName, keyDay);
            const hours = calcHours(date, state, holidays);
            const dayHours = Math.max(0, Number(hours.d) || 0);
            const nightHours = Math.max(0, Number(hours.n) || 0);
            const turnHours = roundHours(dayHours + nightHours);

            if (!turnHours) continue;

            const assignedBefore = week.assignedHours;
            let regularRemaining = Math.max(
                0,
                week.allowedHours - assignedBefore
            );
            const regularDay = Math.min(dayHours, regularRemaining);

            regularRemaining -= regularDay;

            const regularNight = Math.min(nightHours, regularRemaining);
            const excessDay = roundHours(dayHours - regularDay);
            const excessNight = roundHours(nightHours - regularNight);
            const excessHours = roundHours(excessDay + excessNight);

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
                        assignedHours: week.assignedHours,
                        weekAssignedHours: week.assignedHours,
                        allowedHours: week.allowedHours,
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
