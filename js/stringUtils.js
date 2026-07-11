// Utilidades compartidas para normalizar texto (acentos, busquedas, claves).

const COMBINING_MARKS = /[\u0300-\u036f]/g;

// stripAccents/normalizeText son PURAS y se llaman millones de veces sobre un
// conjunto chico de textos (nombres, profesiones, estamentos) al ordenar/agrupar
// el timeline, comparar compatibilidad de reemplazos, etc. String.normalize("NFD")
// es caro (normalizacion Unicode) y dominaba el perfil de CPU (~52% self-time).
// Memoizamos por entrada con una cota de tamano (el universo de textos es finito).
const STRIP_ACCENTS_CACHE = new Map();
const NORMALIZE_TEXT_CACHE = new Map();
const TEXT_CACHE_LIMIT = 20000;

function cacheGetOrCompute(cache, key, compute) {
    const cached = cache.get(key);

    if (cached !== undefined) return cached;

    const result = compute();

    if (cache.size < TEXT_CACHE_LIMIT) {
        cache.set(key, result);
    }

    return result;
}

/**
 * Quita los diacriticos (tildes, dieresis, etc.) de un texto descomponiendo
 * en forma NFD y eliminando los marcadores de combinacion Unicode.
 * No altera mayusculas/minusculas ni espacios. Memoizada.
 *
 * @param {*} value valor a limpiar
 * @returns {string} texto sin acentos
 */
export function stripAccents(value) {
    const input = String(value ?? "");

    return cacheGetOrCompute(STRIP_ACCENTS_CACHE, input, () =>
        input.normalize("NFD").replace(COMBINING_MARKS, "")
    );
}

/**
 * Normaliza texto para comparaciones y busquedas: recorta espacios, quita
 * acentos y pasa a minusculas. Es el patron usado en la mayoria de los
 * modulos para comparar nombres, profesiones, estamentos, etc. Memoizada.
 *
 * @param {*} value valor a normalizar
 * @returns {string} texto comparable
 */
export function normalizeText(value) {
    const input = String(value || "");

    return cacheGetOrCompute(NORMALIZE_TEXT_CACHE, input, () =>
        stripAccents(input).trim().toLowerCase()
    );
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
