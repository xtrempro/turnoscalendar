// Helpers puros para la busqueda de perfiles del buscador superior: normalizar
// la consulta, construir el texto/llaves de busqueda y encontrar coincidencias.

import { normalizeText } from "./stringUtils.js";
import { normalizeProfession, SIN_INFORMACION_PROFESSION } from "./storage.js";
import { formatProfession } from "./professionUtils.js";

/**
 * Normaliza un texto para comparar en la busqueda de perfiles.
 * @param {*} value
 * @returns {string}
 */
export function normalizeProfileSearch(value) {
    return normalizeText(value);
}

/**
 * Detalle del perfil para el buscador: profesion si aplica, si no el estamento.
 * @param {{estamento?: string, profession?: string}} profile
 * @returns {string}
 */
export function getCalendarProfileDetail(profile = {}) {
    const estamento = profile.estamento || "Sin estamento";
    const profession = normalizeProfession(
        profile.profession,
        estamento
    );

    return profession === SIN_INFORMACION_PROFESSION
        ? estamento
        : formatProfession(profession);
}

/**
 * Texto visible del perfil en el buscador: "Nombre | Detalle".
 * @param {{name?: string}} profile
 * @returns {string}
 */
export function getCalendarProfileSearchValue(profile = {}) {
    const name = String(profile.name || "").trim();
    const separator = "   |   ";

    if (!name) return "";

    return `${name}${separator}${getCalendarProfileDetail(profile)}`;
}

/**
 * Llaves normalizadas con las que se puede encontrar un perfil (nombre y texto
 * completo del buscador).
 * @param {{name?: string}} profile
 * @returns {string[]}
 */
export function getCalendarProfileSearchKeys(profile = {}) {
    return [
        profile.name,
        getCalendarProfileSearchValue(profile)
    ]
        .map(normalizeProfileSearch)
        .filter(Boolean);
}

/**
 * Busca el perfil que mejor coincide con la consulta: primero exacto, luego por
 * prefijo y por ultimo por contenido.
 * @param {string} query
 * @param {Array<Object>} profiles
 * @returns {Object|undefined}
 */
export function findTopProfileSearchMatch(query, profiles) {
    const normalizedQuery = normalizeProfileSearch(query);

    const matchesBy = predicate =>
        profiles.find(profile =>
            getCalendarProfileSearchKeys(profile).some(predicate)
        );

    return (
        matchesBy(value => value === normalizedQuery) ||
        matchesBy(value => value.startsWith(normalizedQuery)) ||
        matchesBy(value => value.includes(normalizedQuery))
    );
}
