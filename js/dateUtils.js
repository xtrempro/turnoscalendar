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
