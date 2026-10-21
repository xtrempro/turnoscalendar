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
import {
    rotationBusinessDayTurn,
    rotationUsesBusinessDays
} from "./rotationCatalog.js";
import { updateVisibleCalendarDays } from "./calendar.js";
import { generateScheduleInWorker } from "./workerService.js";
import { isHonorariaProfile } from "./contracts.js";

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
    const endISO = options.endISO || `${fecha.getFullYear()}-12-31`;
    const result = await generateScheduleInWorker({
        startISO: workerISODate(fecha),
        ...options,
        endISO
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
export async function aplicarDiurnoDesde(fecha, options = {}) {
    if (!getCurrentProfile()) return;

    const year = fecha.getFullYear();
    const holidays = await fetchHolidays(year);

    await applyGeneratedSchedule(fecha, {
        mode: "diurno",
        holidays,
        endISO: options.endISO
    });
}

/**
 * Aplica una secuencia ciclica de turnos desde `fecha` hasta fin de anio.
 * @param {Date} fecha
 * @param {number[]} secuencia codigos de turno (0 = libre)
 */
export async function aplicarRotativaSecuencialDesde(
    fecha,
    secuencia,
    options = {}
) {
    if (!getCurrentProfile()) return;

    await applyGeneratedSchedule(fecha, {
        mode: "sequence",
        sequence: secuencia,
        endISO: options.endISO
    });
}

/**
 * Aplica rotativa de 4to turno desde `fecha`.
 * @param {Date} fecha
 * @param {string} firstTurn
 */
export async function aplicarCuartoTurnoDesde(
    fecha,
    firstTurn = "larga",
    options = {}
) {
    await aplicarRotativaSecuencialDesde(
        fecha,
        getRotationSequence("4turno", firstTurn),
        options
    );
}

/**
 * Aplica rotativa de 3er turno desde `fecha`.
 * @param {Date} fecha
 * @param {string} firstTurn
 */
export async function aplicarTercerTurnoDesde(
    fecha,
    firstTurn = "larga",
    options = {}
) {
    await aplicarRotativaSecuencialDesde(
        fecha,
        getRotationSequence("3turno", firstTurn),
        options
    );
}

/**
 * Congela lo que la rotativa ANTERIOR producia antes de mover su inicio.
 *
 * El motor no guarda un turno por dia: lo CALCULA desde el ancla de la rotativa
 * -tipo, primer turno y fecha de inicio-. Mover ese ancla hacia adelante, al
 * reactivar a alguien o al reconfigurar su rotativa, hacia desaparecer de golpe
 * todo lo anterior: meses de turnos ya trabajados que nadie borro, que
 * simplemente dejaban de calcularse. En pantalla se ve igual que una perdida de
 * datos, y para los reportes y la app del trabajador lo es.
 *
 * Aqui esos dias se escriben como turnos explicitos ANTES de mover el ancla.
 * Solo agrega: un dia que ya tiene algo escrito -un cambio de turno, un turno
 * cargado a mano, un permiso- se respeta tal cual.
 *
 * Devuelve cuantos dias quedaron escritos.
 */
export async function freezeRotationBeforeStart({
    type = "",
    firstTurn = "larga",
    fromISO = "",
    untilISO = ""
} = {}) {
    const profileName = getCurrentProfile();

    if (!profileName || !type || type === "libre") return 0;
    if (!fromISO || !untilISO || fromISO > untilISO) return 0;

    // Honorarios no tiene nada que conservar y si mucho que inventar: para
    // ellos el motor NUNCA calcula la secuencia -sus turnos se escriben uno a
    // uno dentro de cada contrato- asi que mover el ancla no apaga nada.
    // Rellenar aqui pintaria dias trabajados fuera de todo contrato.
    if (isHonorariaProfile(profileName)) return 0;

    let payload = null;

    if (rotationUsesBusinessDays(type)) {
        const holidays = {};
        const desde = Number(fromISO.slice(0, 4));
        const hasta = Number(untilISO.slice(0, 4));

        for (let year = desde; year <= hasta; year += 1) {
            Object.assign(holidays, await fetchHolidays(year));
        }

        payload = {
            mode: "businessDays",
            businessTurn: rotationBusinessDayTurn(type),
            holidays
        };
    } else {
        const sequence = getRotationSequence(type, firstTurn);

        if (!sequence.length) return 0;

        payload = { mode: "sequence", sequence };
    }

    const result = await generateScheduleInWorker({
        ...payload,
        startISO: fromISO,
        endISO: untilISO
    });
    const data = getProfileData();
    const baseData = getBaseProfileData();
    const blocked = getBlockedDays();
    let escritos = 0;

    result.entries.forEach(({ keyDay, turn }) => {
        if (!turn) return;

        // Lo que ya esta escrito manda: puede ser un cambio de turno, un turno
        // cargado a mano o lo que quedo de un permiso.
        if (
            Object.prototype.hasOwnProperty.call(data, keyDay) ||
            Object.prototype.hasOwnProperty.call(baseData, keyDay)
        ) {
            return;
        }

        data[keyDay] = turn;
        baseData[keyDay] = turn;
        blocked[keyDay] = true;
        escritos += 1;
    });

    if (!escritos) return 0;

    saveProfileData(data);
    saveBaseProfileData(baseData);
    saveBlockedDays(blocked);

    return escritos;
}

/**
 * Aplica cualquier rotativa configurada en la unidad. Las rotativas de dias
 * habiles conservan el tratamiento de fines de semana y feriados; las demas
 * usan su secuencia ciclica.
 */
export async function aplicarRotativaConfiguradaDesde(
    fecha,
    type,
    firstTurn = "larga",
    options = {}
) {
    if (rotationUsesBusinessDays(type)) {
        const year = fecha.getFullYear();
        const holidays = await fetchHolidays(year);
        await applyGeneratedSchedule(fecha, {
            mode: "businessDays",
            businessTurn: rotationBusinessDayTurn(type),
            holidays,
            endISO: options.endISO
        });
        return;
    }

    const sequence = getRotationSequence(type, firstTurn);
    if (!sequence.length) {
        throw new Error("La rotativa no tiene un patron valido.");
    }

    await aplicarRotativaSecuencialDesde(fecha, sequence, options);
}
