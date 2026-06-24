// Conversores de fecha compartidos.
//
// Hay dos representaciones de fecha en el proyecto:
//   - Clave interna de calendario: `YYYY-M-D`, con mes 0-based (0 = enero) y
//     sin ceros a la izquierda. Ej: "2026-4-5" = 5 de mayo de 2026.
//   - ISO: `YYYY-MM-DD`, con mes 1-based y ceros a la izquierda.

/**
 * Convierte una fecha a clave interna de calendario `YYYY-M-D` (mes 0-based).
 * @param {Date} date
 * @returns {string}
 */
export function keyFromDate(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Convierte una clave interna `YYYY-M-D` (mes 0-based) a un objeto Date.
 * No valida: una clave invalida produce una fecha invalida.
 * @param {string} key
 * @returns {Date}
 */
export function keyToDate(key) {
    const parts = String(key || "").split("-");
    return new Date(Number(parts[0]), Number(parts[1]), Number(parts[2]));
}

/**
 * Descompone una clave interna `YYYY-M-D` en sus partes numericas
 * (mes 0-based, tal como se guarda en la clave).
 * @param {string} key
 * @returns {{year: number, month: number, day: number}}
 */
export function parseKeyParts(key) {
    const parts = String(key || "").split("-");
    return {
        year: Number(parts[0]),
        month: Number(parts[1]),
        day: Number(parts[2])
    };
}

/**
 * Convierte una clave interna `YYYY-M-D` (mes 0-based) a ISO `YYYY-MM-DD`.
 * @param {string} key
 * @returns {string}
 */
export function isoFromKey(key) {
    const parts = String(key || "").split("-");
    return `${parts[0]}-${String(Number(parts[1]) + 1).padStart(2, "0")}-${String(Number(parts[2])).padStart(2, "0")}`;
}

/**
 * Convierte una fecha ISO `YYYY-MM-DD` (mes 1-based) a clave interna `YYYY-M-D`.
 * @param {string} iso
 * @returns {string}
 */
export function keyFromISO(iso) {
    const parts = String(iso || "").split("-");
    return `${parts[0]}-${Number(parts[1]) - 1}-${Number(parts[2])}`;
}

/**
 * Convierte una fecha a ISO `YYYY-MM-DD` (mes 1-based, con ceros).
 * @param {Date} date
 * @returns {string}
 */
export function toISODate(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

/**
 * Convierte una fecha ISO `YYYY-MM-DD` (mes 1-based) a un objeto Date.
 * @param {string} iso
 * @returns {Date}
 */
export function parseISODate(iso) {
    const parts = String(iso || "").split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

// --- Helpers de mas alto nivel usados por la UI (inputs, encabezados, etc.) ---

/**
 * Alias de toISODate: el valor que esperan los <input type="date"> es ISO.
 * @param {Date} date
 * @returns {string}
 */
export function toInputDate(date) {
    return toISODate(date);
}

/**
 * Valor para un <input type="month">: `YYYY-MM` (mes 1-based, con cero).
 * @param {Date} date
 * @returns {string}
 */
export function toMonthInputValue(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0")
    ].join("-");
}

/**
 * Convierte el valor de un <input type="month"> (`YYYY-MM`) al primer dia de
 * ese mes, o null si es invalido.
 * @param {string} value
 * @returns {Date|null}
 */
export function parseMonthInputValue(value) {
    const parts = String(value || "").split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]) - 1;

    if (!year || month < 0) return null;

    return new Date(year, month, 1);
}

/**
 * Normaliza una fecha de inicio almacenada a ISO `YYYY-MM-DD`. Acepta ISO ya
 * formateado o cualquier cosa parseable por Date; devuelve "" si no es valida.
 * @param {string} start
 * @returns {string}
 */
export function normalizeStoredStart(start) {
    if (!start) return "";

    if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
        return start;
    }

    const date = new Date(start);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return toISODate(date);
}

/**
 * Convierte el valor de un <input type="date"> (ISO `YYYY-MM-DD`) a clave
 * interna de calendario `YYYY-M-D` (mes 0-based). Devuelve "" si es invalido.
 * @param {string} value
 * @returns {string}
 */
export function inputDateToCalendarKey(value) {
    if (!value) return "";

    const parts = value.split("-");

    if (parts.length !== 3) return "";

    return `${parts[0]}-${Number(parts[1]) - 1}-${Number(parts[2])}`;
}

/**
 * Convierte una clave interna de calendario `YYYY-M-D` al valor ISO de un
 * <input type="date">. Devuelve "" si la clave esta vacia.
 * @param {string} key
 * @returns {string}
 */
export function calendarKeyToInputDate(key) {
    if (!key) return "";

    return toISODate(keyToDate(key));
}

/**
 * Compara dos fechas ISO `YYYY-MM-DD` como cadenas (orden cronologico).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareISODate(a, b) {
    return String(a || "").localeCompare(String(b || ""));
}

/**
 * Indica si una clave de calendario corresponde a una fecha igual o posterior
 * a la fecha dada.
 * @param {string} key
 * @param {Date} startDate
 * @returns {boolean}
 */
export function isDateKeyOnOrAfter(key, startDate) {
    const date = keyToDate(key);

    if (Number.isNaN(date.getTime())) return false;

    return date >= startDate;
}

/**
 * Formatea una fecha ISO `YYYY-MM-DD` como `DD/MM/YYYY` para mostrar.
 * @param {string} value
 * @returns {string}
 */
export function formatDisplayDate(value) {
    if (!value) return "";

    const parts = value.split("-");

    if (parts.length !== 3) return value;

    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/**
 * Encabezado de mes en mayusculas, ej: "MAYO 2026".
 * @param {Date} date
 * @returns {string}
 */
export function formatMonthHeading(date) {
    return date.toLocaleString(
        "es-CL",
        {
            month: "long",
            year: "numeric"
        }
    ).toUpperCase();
}

/**
 * Numero serial de un periodo (year, month 0-based) para comparar/ordenar.
 * @param {number} year
 * @param {number} month
 * @returns {number}
 */
export function monthSerial(year, month) {
    return Number(year) * 12 + Number(month);
}

/**
 * Devuelve el periodo (year, month 0-based) del mes siguiente.
 * @param {number} year
 * @param {number} month
 * @returns {{year: number, month: number}}
 */
export function nextMonthPeriod(year, month) {
    const date = new Date(
        Number(year),
        Number(month) + 1,
        1
    );

    return {
        year: date.getFullYear(),
        month: date.getMonth()
    };
}
