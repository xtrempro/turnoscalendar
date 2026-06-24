// Aplica una rotativa al horario del perfil ACTUAL desde una fecha: escribe el
// turno base, los dias bloqueados y el estado de cada dia en storage. Opera
// sobre el perfil activo (getCurrentProfile) y refresca la vista al terminar.

import {
    getCurrentProfile,
    getProfileData,
    getBaseProfileData,
    getBlockedDays,
    saveProfileData,
    saveBaseProfileData,
    saveBlockedDays
} from "./storage.js";
import { fetchHolidays } from "./holidays.js";
import { isBusinessDay } from "./calculations.js";
import { keyFromDate } from "./dateUtils.js";
import { getRotationSequence } from "./rotationUtils.js";
import { refreshAll } from "./refresh.js";

/**
 * Aplica rotativa Diurno desde `fecha` hasta fin de anio: turno 4 (diurno) en
 * dias habiles, libre en los demas.
 * @param {Date} fecha
 */
export async function aplicarDiurnoDesde(fecha) {
    if (!getCurrentProfile()) return;

    const data = getProfileData();
    const baseData = getBaseProfileData();
    const blocked = getBlockedDays();

    const year = fecha.getFullYear();
    const holidays = await fetchHolidays(year);

    let day = new Date(fecha);

    while (day.getFullYear() === year) {
        const key = keyFromDate(day);

        delete data[key];
        delete baseData[key];
        delete blocked[key];

        if (isBusinessDay(day, holidays)) {
            data[key] = 4;
            baseData[key] = 4;
            blocked[key] = true;
        }

        day.setDate(day.getDate() + 1);
    }

    saveProfileData(data);
    saveBaseProfileData(baseData);
    saveBlockedDays(blocked);
    refreshAll();
}

/**
 * Aplica una secuencia ciclica de turnos desde `fecha` hasta fin de anio.
 * @param {Date} fecha
 * @param {number[]} secuencia codigos de turno (0 = libre)
 */
export function aplicarRotativaSecuencialDesde(fecha, secuencia) {
    if (!getCurrentProfile()) return;

    const data = getProfileData();
    const baseData = getBaseProfileData();
    const blocked = getBlockedDays();

    let day = new Date(fecha);
    const year = day.getFullYear();

    while (day.getFullYear() === year) {
        for (let i = 0; i < secuencia.length; i++) {
            const key = keyFromDate(day);
            const turno = secuencia[i];

            delete data[key];
            delete baseData[key];
            delete blocked[key];

            if (turno) {
                data[key] = turno;
                baseData[key] = turno;
                blocked[key] = true;
            }

            day.setDate(day.getDate() + 1);
        }
    }

    saveProfileData(data);
    saveBaseProfileData(baseData);
    saveBlockedDays(blocked);
    refreshAll();
}

/**
 * Aplica rotativa de 4to turno desde `fecha`.
 * @param {Date} fecha
 * @param {string} firstTurn
 */
export function aplicarCuartoTurnoDesde(fecha, firstTurn = "larga") {
    aplicarRotativaSecuencialDesde(
        fecha,
        getRotationSequence("4turno", firstTurn)
    );
}

/**
 * Aplica rotativa de 3er turno desde `fecha`.
 * @param {Date} fecha
 * @param {string} firstTurn
 */
export function aplicarTercerTurnoDesde(fecha, firstTurn = "larga") {
    aplicarRotativaSecuencialDesde(
        fecha,
        getRotationSequence("3turno", firstTurn)
    );
}
