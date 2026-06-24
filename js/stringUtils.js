// Utilidades compartidas para normalizar texto (acentos, busquedas, claves).

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Quita los diacriticos (tildes, dieresis, etc.) de un texto descomponiendo
 * en forma NFD y eliminando los marcadores de combinacion Unicode.
 * No altera mayusculas/minusculas ni espacios.
 *
 * @param {*} value valor a limpiar
 * @returns {string} texto sin acentos
 */
export function stripAccents(value) {
    return String(value ?? "").normalize("NFD").replace(COMBINING_MARKS, "");
}

/**
 * Normaliza texto para comparaciones y busquedas: recorta espacios, quita
 * acentos y pasa a minusculas. Es el patron usado en la mayoria de los
 * modulos para comparar nombres, profesiones, estamentos, etc.
 *
 * @param {*} value valor a normalizar
 * @returns {string} texto comparable
 */
export function normalizeText(value) {
    return stripAccents(String(value || "")).trim().toLowerCase();
}

/**
 * Deja solo los digitos de un valor y, opcionalmente, lo recorta a una
 * longitud maxima. Util para telefonos, RUT sin formato, etc.
 *
 * @param {*} value valor de entrada
 * @param {number} maxLength cantidad maxima de digitos a conservar
 * @returns {string} solo digitos
 */
export function sanitizeDigits(value, maxLength = Infinity) {
    return String(value || "")
        .replace(/\D/g, "")
        .slice(0, maxLength);
}
