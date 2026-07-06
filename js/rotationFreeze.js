// Preserva el horario ANTERIOR a una fecha antes de reubicar el inicio de la
// rotativa. Modulo liviano (solo storage/turnEngine/dateUtils) para poder
// testearlo en Node sin arrastrar la UI del calendario.

import {
    getCurrentProfile,
    getRotativa,
    getProfileData,
    getBaseProfileData,
    getBlockedDays,
    saveProfileData,
    saveBaseProfileData,
    saveBlockedDays
} from "./storage.js";
import { getTurnoBase } from "./turnEngine.js";
import { keyFromDate, parseISODate } from "./dateUtils.js";

// Antes de mover el inicio de la rotativa hacia `boundaryISO`, materializa
// (congela) en baseData los turnos ANTERIORES que hoy solo se computan desde la
// rotativa vigente. Sin esto, al mover el inicio hacia adelante esos dias pasan
// a calcularse como "libre" y se borran visualmente. No toca dias con turno
// base explicito ni dias libres. Debe llamarse ANTES de saveRotativa.
export function freezePriorRotationSchedule(boundaryISO) {
    const profileName = getCurrentProfile();

    if (!profileName) return;

    const rotativa = getRotativa(profileName);

    if (!rotativa || rotativa.type === "libre" || !rotativa.start) return;

    const start = parseISODate(rotativa.start);
    const boundary = parseISODate(boundaryISO);

    if (!start || !boundary || !(start < boundary)) return;

    const data = getProfileData();
    const baseData = getBaseProfileData();
    const blocked = getBlockedDays();
    let changed = false;

    for (
        let cursor = new Date(start);
        cursor < boundary;
        cursor.setDate(cursor.getDate() + 1)
    ) {
        const key = keyFromDate(cursor);

        if (Object.prototype.hasOwnProperty.call(baseData, key)) continue;

        const turn = getTurnoBase(profileName, key);

        if (!turn) continue;

        baseData[key] = turn;

        if (!Object.prototype.hasOwnProperty.call(data, key)) {
            data[key] = turn;
        }

        blocked[key] = true;
        changed = true;
    }

    if (changed) {
        saveBaseProfileData(baseData);
        saveProfileData(data);
        saveBlockedDays(blocked);
    }
}
