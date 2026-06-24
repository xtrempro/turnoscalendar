// Helpers para el marcaje de reloj: busqueda de segmentos, banderas de
// adelanto/atraso y formato de fecha. Los helpers genericos de tiempo (parseo y
// formato de horarios, construccion de instantes, dia mas cercano) viven en
// timeUtils.js y se reexportan aqui con los nombres de este dominio.

import { formatDisplayDate, calendarKeyToInputDate } from "./dateUtils.js";
import {
    dateAt,
    parseTimeValue,
    timeNearReference,
    formatTime
} from "./timeUtils.js";

export const formatClockMinute = formatTime;
export const parseClockTimeValue = parseTimeValue;
export const clockDateAt = dateAt;
export const clockTimeNearReference = timeNearReference;

// Alias de segmentos de media jornada administrativa que se consideran
// equivalentes al buscar marcas/segmentos.
const HALF_DAY_SEGMENT_ALIASES = {
    half_admin_morning: ["half_afternoon"],
    half_admin_afternoon: ["half_morning"],
    half_morning: ["half_admin_afternoon"],
    half_afternoon: ["half_admin_morning"]
};

/**
 * Formatea una clave de calendario como `DD/MM/YYYY`.
 * @param {string} keyDay
 * @returns {string}
 */
export function formatClockMarkDate(keyDay) {
    return formatDisplayDate(calendarKeyToInputDate(keyDay));
}

/**
 * Indica si dos segmentos {start, end} se solapan en el tiempo.
 * @param {{start: Date|number, end: Date|number}} a
 * @param {{start: Date|number, end: Date|number}} b
 * @returns {boolean}
 */
export function clockSegmentsOverlap(a, b) {
    return a.start < b.end && b.start < a.end;
}

/**
 * Busca en una marca la entrada correspondiente a un segmento, considerando
 * los alias de media jornada. Devuelve {key, value} o null.
 * @param {{segments?: Object}} mark
 * @param {{id: string}} segment
 * @returns {{key: string, value: *}|null}
 */
export function findClockMarkEntry(mark, segment) {
    if (!mark?.segments || !segment) return null;

    const keys = [segment.id, ...(HALF_DAY_SEGMENT_ALIASES[segment.id] || [])];
    const key = keys.find(item => mark.segments[item]);

    return key
        ? { key, value: mark.segments[key] }
        : null;
}

/**
 * Busca el segmento que corresponde a una clave dada, considerando alias.
 * @param {string} segmentKey
 * @param {Array<{id: string}>} segments
 * @returns {Object|null}
 */
export function findClockSegmentForKey(segmentKey, segments) {
    return segments.find(segment =>
        segment.id === segmentKey ||
        (HALF_DAY_SEGMENT_ALIASES[segmentKey] || []).includes(segment.id)
    ) || null;
}

/**
 * Segmento por defecto (vacio) para una clave, cuando no hay uno real.
 * @param {Date} date
 * @param {string} segmentKey
 * @returns {{id: string, label: string, start: Date, end: Date}}
 */
export function fallbackClockSegment(date, segmentKey) {
    return {
        id: segmentKey,
        label: segmentKey
            .replace(/_/g, " ")
            .replace(/\b\w/g, char => char.toUpperCase()),
        start: clockDateAt(date, 0),
        end: clockDateAt(date, 0)
    };
}

/**
 * Indica si una marca de segmento tiene datos relevantes (entrada/salida o
 * marcas faltantes).
 * @param {{entryTime?: string, exitTime?: string, missingEntry?: boolean, missingExit?: boolean}} segmentMark
 * @returns {boolean}
 */
export function hasClockMarkRecordData(segmentMark) {
    return Boolean(
        segmentMark?.entryTime ||
        segmentMark?.exitTime ||
        segmentMark?.missingEntry ||
        segmentMark?.missingExit
    );
}

/**
 * Calcula entrada/salida reales y banderas de adelanto/atraso respecto al
 * segmento programado.
 * @param {Date} date
 * @param {{start: Date, end: Date}} segment
 * @param {{entryTime?: string, exitTime?: string}} segmentMark
 * @returns {{entry: Date|null, exit: Date|null, lateEntry: boolean, earlyEntry: boolean, earlyExit: boolean, lateExit: boolean}}
 */
export function getClockMarkTimingFlags(date, segment, segmentMark) {
    const entry = segmentMark?.entryTime
        ? clockTimeNearReference(
            date,
            segmentMark.entryTime,
            segment.start
        )
        : null;
    const exit = segmentMark?.exitTime
        ? clockTimeNearReference(
            date,
            segmentMark.exitTime,
            segment.end
        )
        : null;

    return {
        entry,
        exit,
        lateEntry: Boolean(entry && entry > segment.start),
        earlyEntry: Boolean(entry && entry < segment.start),
        earlyExit: Boolean(exit && exit < segment.end),
        lateExit: Boolean(exit && exit > segment.end)
    };
}
