// Helpers para el calculo de "devolucion de horas". Los helpers genericos de
// tiempo (clonado, parseo/formato de horarios, eleccion del dia mas cercano)
// viven en timeUtils.js y se reexportan aqui con los nombres de este dominio.

import {
    cloneDate,
    dateAt,
    nextDateAt,
    parseTimeValue,
    timeNearReference,
    formatTime
} from "./timeUtils.js";

export const cloneReturnDate = cloneDate;
export const dateAtReturn = dateAt;
export const nextDateAtReturn = nextDateAt;
export const parseReturnTime = parseTimeValue;
export const timeNearReturnReference = timeNearReference;
export const formatReturnTime = formatTime;

/**
 * Formatea una fecha como `HH:MM hrs.`.
 * @param {Date} date
 * @returns {string}
 */
export function formatReturnDateTime(date) {
    return `${formatReturnTime(date)} hrs.`;
}

/**
 * Redondea horas a un decimal, sin negativos.
 * @param {number} value
 * @returns {number}
 */
export function roundReturnHours(value) {
    return Math.max(
        0,
        Math.round((Number(value) || 0) * 10) / 10
    );
}

/**
 * Horas (redondeadas) entre dos instantes, sin negativos.
 * @param {Date|number} start
 * @param {Date|number} end
 * @returns {number}
 */
export function returnHoursBetween(start, end) {
    return roundReturnHours(
        Math.max(0, (end - start) / 36e5)
    );
}

/**
 * Horas de un segmento {start, end}.
 * @param {{start: Date|number, end: Date|number}} segment
 * @returns {number}
 */
export function getSegmentReturnHours(segment) {
    return returnHoursBetween(segment.start, segment.end);
}

/**
 * Identificador estable de un segmento (usa su id o uno derivado del indice).
 * @param {{id?: string}} segment
 * @param {number} index
 * @returns {string}
 */
export function getReturnSegmentId(segment, index) {
    return String(segment.id || `segment_${index}`);
}
