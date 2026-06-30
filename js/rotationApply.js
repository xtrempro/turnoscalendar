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
import { getRotationSequence } from "./rotationUtils.js";
import { updateVisibleCalendarDays } from "./calendar.js";
import { generateScheduleInWorker } from "./workerService.js";

function workerISODate(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

async function applyGeneratedSchedule(fecha, options) {
    const profileName = getCurrentProfile();
    if (!profileName) return false;

    const data = getProfileData();
    const baseData = getBaseProfileData();
    const blocked = getBlockedDays();
    const result = await generateScheduleInWorker({
        startISO: workerISODate(fecha),
        endISO: `${fecha.getFullYear()}-12-31`,
        ...options
    }, {
        channel: `rotation:${profileName}`,
        timeoutMs: 20000
    });

    result.entries.forEach(({ keyDay, turn }) => {
        delete data[keyDay];
        delete baseData[keyDay];
        delete blocked[keyDay];

        if (turn) {
            data[keyDay] = turn;
            baseData[keyDay] = turn;
            blocked[keyDay] = true;
        }
    });

    saveProfileData(data);
    saveBaseProfileData(baseData);
    saveBlockedDays(blocked);
    void updateVisibleCalendarDays({ updateSummary: true });
    return true;
}

/**
 * Aplica rotativa Diurno desde `fecha` hasta fin de anio: turno 4 (diurno) en
 * dias habiles, libre en los demas.
 * @param {Date} fecha
 */
export async function aplicarDiurnoDesde(fecha) {
    if (!getCurrentProfile()) return;

    const year = fecha.getFullYear();
    const holidays = await fetchHolidays(year);

    await applyGeneratedSchedule(fecha, {
        mode: "diurno",
        holidays
    });
}

/**
 * Aplica una secuencia ciclica de turnos desde `fecha` hasta fin de anio.
 * @param {Date} fecha
 * @param {number[]} secuencia codigos de turno (0 = libre)
 */
export async function aplicarRotativaSecuencialDesde(fecha, secuencia) {
    if (!getCurrentProfile()) return;

    await applyGeneratedSchedule(fecha, {
        mode: "sequence",
        sequence: secuencia
    });
}

/**
 * Aplica rotativa de 4to turno desde `fecha`.
 * @param {Date} fecha
 * @param {string} firstTurn
 */
export async function aplicarCuartoTurnoDesde(fecha, firstTurn = "larga") {
    await aplicarRotativaSecuencialDesde(
        fecha,
        getRotationSequence("4turno", firstTurn)
    );
}

/**
 * Aplica rotativa de 3er turno desde `fecha`.
 * @param {Date} fecha
 * @param {string} firstTurn
 */
export async function aplicarTercerTurnoDesde(fecha, firstTurn = "larga") {
    await aplicarRotativaSecuencialDesde(
        fecha,
        getRotationSequence("3turno", firstTurn)
    );
}
