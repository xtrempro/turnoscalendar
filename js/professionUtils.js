// Helpers de profesion/estamento: que estamentos usan profesion, formato de
// etiquetas y construccion de <option> para los selects de profesion.

import { SIN_INFORMACION_PROFESSION } from "./storage.js";

// Etiquetas legibles para valores de profesion especiales.
const PROFESSION_LABELS = {
    [SIN_INFORMACION_PROFESSION]: "Sin información"
};

/**
 * Indica si el estamento del perfil contempla una profesion (Profesional o
 * Tecnico).
 * @param {{estamento?: string}} profile
 * @returns {boolean}
 */
export function profileUsesProfession(profile = {}) {
    return (
        profile.estamento === "Profesional" ||
        profile.estamento === "Técnico"
    );
}

/**
 * Devuelve la etiqueta legible de una profesion.
 * @param {string} value
 * @returns {string}
 */
export function formatProfession(value) {
    const clean = value || SIN_INFORMACION_PROFESSION;

    return PROFESSION_LABELS[clean] || clean;
}

/**
 * Crea un <option> para un valor de profesion.
 * @param {string} value
 * @returns {HTMLOptionElement}
 */
export function professionOptionElement(value) {
    const option = document.createElement("option");

    option.value = value;
    option.textContent = formatProfession(value);

    return option;
}

/**
 * Reemplaza las opciones de un <select> (o datalist) con las profesiones dadas.
 * @param {Element|null} element
 * @param {string[]} options
 */
export function replaceProfessionOptions(element, options = []) {
    if (!element) return;

    element.replaceChildren(
        ...options.map(professionOptionElement)
    );
}
