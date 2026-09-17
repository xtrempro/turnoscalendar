/**
 * Horario propio de un trabajador, por periodos.
 *
 * Algunos entran y salen a horas distintas de las del turno: un diurno de 8:40
 * a 17:40, o alguien de tercer turno con la Larga de 7:30 a 19:30. Sus atrasos
 * y sus incidencias se miden contra ESE horario, no contra el general.
 *
 * Va por periodos con fecha de inicio y un termino opcional. Importa porque un
 * acuerdo empieza un dia: al cambiarle el horario a alguien, lo nuevo rige de
 * ahi en adelante y los meses ya revisados no se recalculan con un horario que
 * entonces no existia.
 *
 * Es un acuerdo permanente, distinto de la modificacion de marcaje de un dia
 * suelto. Cuando ambos existen manda la del dia, que es la mas especifica.
 */
import { getJSON, setJSON } from "./persistence.js";
import { getTurnoComponentes } from "./rulesEngine.js";

const STORAGE_KEY = "workerSchedules";

// Que horario le corresponde a cada tramo de turno. Los medios turnos no
// entran: un 1/2 ADM ya tiene su propia regla, que depende de la rotativa.
const SEGMENT_KEYS = {
    L: "larga",
    N: "noche",
    D: "diurno"
};

/**
 * Los tramos que se pueden configurar, por tipo de rotativa.
 *
 * Un diurno solo hace turnos diurnos; el de tercer y cuarto turno hace Largas
 * y Noches. Mostrarle a cada uno solo lo suyo evita configurar horarios que
 * nunca se van a usar.
 */
export function scheduleSegmentsForRotativa(rotativaType) {
    if (rotativaType === "diurno") {
        return [{
            key: "diurno",
            label: "Turno diurno",
            hasFriday: true,
            fridayNote: "Los viernes la jornada termina antes"
        }];
    }

    if (rotativaType === "3turno" || rotativaType === "4turno") {
        return [
            { key: "larga", label: "Turno largo", hasFriday: false },
            { key: "noche", label: "Turno de noche", hasFriday: false }
        ];
    }

    return [];
}

function isTime(value) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

function isDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export function isoFromDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

/**
 * Deja solo horas validas: un campo a medio escribir no puede convertirse en
 * un horario que despues mida atrasos contra una hora inventada.
 */
function normalizeSegment(value) {
    if (!value || typeof value !== "object") return null;

    const entry = isTime(value.entry) ? value.entry : "";
    const exit = isTime(value.exit) ? value.exit : "";
    const exitFriday = isTime(value.exitFriday) ? value.exitFriday : "";

    if (!entry && !exit && !exitFriday) return null;

    return { entry, exit, exitFriday };
}

function normalizeSegments(value) {
    const segments = {};

    Object.values(SEGMENT_KEYS).forEach(key => {
        const segment = normalizeSegment(value?.[key]);

        if (segment) segments[key] = segment;
    });

    return segments;
}

function normalizePeriod(value) {
    const segments = normalizeSegments(value);
    // HORARIO LIBRE: no se le exige entrar ni salir a una hora determinada, solo
    // cumplir las horas de su jornada. Es un periodo SIN horas, que hasta ahora
    // se descartaba por venir vacio, asi que se reconoce por su propia marca.
    const free = value?.free === true;

    if (!free && !Object.keys(segments).length) return null;

    return {
        from: isDate(value?.from) ? value.from : "",
        to: isDate(value?.to) ? value.to : "",
        ...(free ? { free: true } : {}),
        ...segments
    };
}

/**
 * Acepta la forma con periodos y tambien la vieja -un solo horario sin fechas-,
 * que se lee como un periodo sin inicio: lo que ya estaba configurado sigue
 * valiendo igual que antes.
 */
export function normalizeWorkerSchedule(value) {
    const raw = Array.isArray(value?.periods)
        ? value.periods
        : [value];
    const periods = raw
        .map(normalizePeriod)
        .filter(Boolean)
        .sort((a, b) => String(a.from).localeCompare(String(b.from)));

    return periods.length ? { periods } : {};
}

function allSchedules() {
    const stored = getJSON(STORAGE_KEY, {});

    return stored && typeof stored === "object" ? stored : {};
}

export function getWorkerSchedule(profile) {
    if (!profile) return {};

    return normalizeWorkerSchedule(allSchedules()[profile]);
}

export function getWorkerSchedulePeriods(profile) {
    return getWorkerSchedule(profile).periods || [];
}

export function saveWorkerSchedule(profile, schedule) {
    if (!profile) return;

    const all = allSchedules();
    const normalized = normalizeWorkerSchedule(schedule);

    if (normalized.periods?.length) {
        all[profile] = normalized;
    } else {
        delete all[profile];
    }

    setJSON(STORAGE_KEY, all);
}

export function hasWorkerSchedule(profile) {
    return getWorkerSchedulePeriods(profile).length > 0;
}

function dayBefore(iso) {
    const [year, month, day] = String(iso).split("-").map(Number);
    const date = new Date(year, month - 1, day - 1);

    return isoFromDate(date);
}

/**
 * Agrega un periodo nuevo y cierra el anterior el dia antes.
 *
 * Es lo que hace que lo nuevo rija de ahi en adelante sin tocar lo de atras:
 * los meses ya revisados se siguen midiendo con el horario que tenian.
 *
 * @param {string} profile
 * @param {{from: string, to?: string}} period con los tramos dentro
 */
export function addWorkerSchedulePeriod(profile, period) {
    const nuevo = normalizePeriod(period);

    if (!profile || !nuevo || !nuevo.from) return false;

    const periods = getWorkerSchedulePeriods(profile)
        .filter(existente => existente.from !== nuevo.from)
        .map(existente => {
            const abierto = !existente.to || existente.to >= nuevo.from;

            return existente.from < nuevo.from && abierto
                ? { ...existente, to: dayBefore(nuevo.from) }
                : existente;
        });

    saveWorkerSchedule(profile, { periods: [...periods, nuevo] });
    return true;
}

export function removeWorkerSchedulePeriod(profile, from) {
    const periods = getWorkerSchedulePeriods(profile)
        .filter(period => period.from !== from);

    saveWorkerSchedule(profile, { periods });
}

/**
 * El horario que regia en esa fecha, o {} si no habia ninguno.
 *
 * @param {string} profile
 * @param {Date|string} date
 */
export function getWorkerScheduleAt(profile, date) {
    const iso = date instanceof Date ? isoFromDate(date) : String(date || "");
    const periods = getWorkerSchedulePeriods(profile);

    if (!iso) return {};

    return periods.find(period =>
        (!period.from || period.from <= iso) &&
        (!period.to || iso <= period.to)
    ) || {};
}

/**
 * .Ese dia trabaja con HORARIO LIBRE?
 *
 * Sin hora fija de entrada ni de salida: lo que se le exige es cumplir las
 * horas de su jornada -9 de lunes a jueves, 8 los viernes-, asi que no se le
 * miden atrasos ni salidas fuera de hora. Lo que si se mira es cuanto trabajo
 * de verdad (ver js/hoursReport.js).
 *
 * @param {string} profile
 * @param {Date|string} date
 * @returns {boolean}
 */
export function isFreeScheduleAt(profile, date) {
    return getWorkerScheduleAt(profile, date).free === true;
}

/**
 * Hora de ingreso propia para ese turno, si la tiene.
 *
 * La entrada la fija el PRIMER tramo del turno: en un 24 (Larga + Noche) se
 * entra por la Larga.
 */
export function workerEntryTime(schedule, shift) {
    const [first] = getTurnoComponentes(shift);

    return schedule?.[SEGMENT_KEYS[first]]?.entry || "";
}

/**
 * Hora de salida propia para ese turno, si la tiene.
 *
 * La salida la fija el ULTIMO tramo: en un 24 se sale por la Noche. Y el
 * diurno puede tener una hora distinta los viernes, que es cuando la jornada
 * termina antes.
 */
export function workerExitTime(schedule, shift, date = null) {
    const components = getTurnoComponentes(shift);
    const last = components[components.length - 1];
    const segment = schedule?.[SEGMENT_KEYS[last]];

    if (!segment) return "";

    const isFriday = date instanceof Date && date.getDay() === 5;

    return (isFriday && segment.exitFriday) || segment.exit || "";
}

export const WORKER_SCHEDULE_STORAGE_KEY = STORAGE_KEY;
export const WORKER_SCHEDULE_SEGMENT_KEYS = SEGMENT_KEYS;
