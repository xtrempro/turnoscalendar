import {
    getHonorariaContract,
    hasHonorariaContractForDate
} from "./contracts.js";
import { calcHours } from "./calculations.js";
import { getTurnoReal } from "./turnEngine.js";

function roundHours(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function emptySummary(profileName, contract = null) {
    return {
        profileName,
        contract,
        allowedHours: contract?.maxMonthlyHours || 0,
        assignedHours: 0,
        overtimeHours: 0,
        overtimeDay: 0,
        overtimeNight: 0,
        excessByKey: {}
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
    const days = new Date(year, month + 1, 0).getDate();
    let assignedHours = 0;
    let overtimeDay = 0;
    let overtimeNight = 0;

    for (let day = 1; day <= days; day++) {
        const keyDay = `${year}-${month}-${day}`;

        if (!hasHonorariaContractForDate(profileName, keyDay)) {
            continue;
        }

        const state = getTurnoReal(profileName, keyDay);
        const date = new Date(year, month, day);
        const hours = calcHours(date, state, holidays);
        const dayHours = Math.max(0, Number(hours.d) || 0);
        const nightHours = Math.max(0, Number(hours.n) || 0);
        const turnHours = dayHours + nightHours;

        if (!turnHours) continue;

        const assignedBefore = assignedHours;
        let regularRemaining = Math.max(
            0,
            summary.allowedHours - assignedBefore
        );
        const regularDay = Math.min(dayHours, regularRemaining);

        regularRemaining -= regularDay;

        const regularNight = Math.min(nightHours, regularRemaining);
        const excessDay = roundHours(dayHours - regularDay);
        const excessNight = roundHours(nightHours - regularNight);
        const excessHours = roundHours(excessDay + excessNight);

        assignedHours = roundHours(assignedHours + turnHours);

        if (excessHours > 0) {
            overtimeDay = roundHours(overtimeDay + excessDay);
            overtimeNight = roundHours(overtimeNight + excessNight);
            summary.excessByKey[keyDay] = {
                keyDay,
                state,
                turnHours: roundHours(turnHours),
                excessHours,
                excessDay,
                excessNight,
                assignedHours
            };
        }
    }

    summary.assignedHours = roundHours(assignedHours);
    summary.overtimeDay = overtimeDay;
    summary.overtimeNight = overtimeNight;
    summary.overtimeHours = roundHours(
        Math.max(0, assignedHours - summary.allowedHours)
    );

    return summary;
}

export function getHonorariaExcessForKey(summary, keyDay) {
    return summary?.excessByKey?.[keyDay] || null;
}

export function getHonorariaLimitMessage(summary) {
    if (!summary) return "";

    return `${summary.profileName} tiene permitido un maximo de ${summary.allowedHours} horas para este mes. Actualmente tiene asignadas ${summary.assignedHours} horas.`;
}
