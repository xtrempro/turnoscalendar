// Helpers de tiempo compartidos: clonado de fechas, construccion de instantes a
// una hora dada, parseo y formato de horarios `HH:MM` y eleccion del dia mas
// cercano a una referencia (para turnos que cruzan la medianoche).
//
// Estos helpers eran duplicados en hourReturnUtils.js y clockMarkUtils.js; ambos
// modulos ahora los reexportan con sus nombres especificos.

/**
 * Clona un objeto Date.
 * @param {Date} date
 * @returns {Date}
 */
export function cloneDate(date) {
    return new Date(date.getTime());
}

/**
 * Date en el mismo dia que `base` a la hora/minuto indicados.
 * @param {Date} base
 * @param {number} hour
 * @param {number} minute
 * @returns {Date}
 */
export function dateAt(base, hour, minute = 0) {
    return new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate(),
        hour,
        minute
    );
}

/**
 * Date al dia siguiente de `base` a la hora/minuto indicados.
 * @param {Date} base
 * @param {number} hour
 * @param {number} minute
 * @returns {Date}
 */
export function nextDateAt(base, hour, minute = 0) {
    const date = dateAt(base, hour, minute);
    date.setDate(date.getDate() + 1);
    return date;
}

/**
 * Parsea un horario `HH:MM` validando rangos. Devuelve {hour, minute} o null.
 * @param {string} value
 * @returns {{hour: number, minute: number}|null}
 */
export function parseTimeValue(value) {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);

    if (!match) return null;

    const hour = Number(match[1]);
    const minute = Number(match[2]);

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return null;
    }

    return { hour, minute };
}

/**
 * Dado un horario `HH:MM`, elige la fecha (dia anterior, mismo dia o siguiente)
 * mas cercana a una referencia. Util para turnos que cruzan la medianoche.
 * @param {Date} baseDate
 * @param {string} value horario HH:MM
 * @param {Date} reference
 * @returns {Date|null}
 */
export function timeNearReference(baseDate, value, reference) {
    const parsed = parseTimeValue(value);

    if (!parsed) return null;

    const same = dateAt(baseDate, parsed.hour, parsed.minute);
    const next = cloneDate(same);
    next.setDate(next.getDate() + 1);
    const previous = cloneDate(same);
    previous.setDate(previous.getDate() - 1);

    return [same, next, previous].sort((a, b) =>
        Math.abs(a - reference) - Math.abs(b - reference)
    )[0];
}

/**
 * Formatea una fecha como `HH:MM`.
 * @param {Date} date
 * @returns {string}
 */
export function formatTime(date) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
