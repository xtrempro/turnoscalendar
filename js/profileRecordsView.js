// Constructores de HTML para los registros de recursos humanos del perfil
// (campos del formulario y tarjetas de cada entrada). Son funciones puras de
// presentacion: reciben config/entry y devuelven HTML.

import { formatDisplayDate } from "./dateUtils.js";
import { escapeHTML } from "./htmlUtils.js";

/**
 * Anio (YYYY) de una entrada de registro, tomado de su fecha de inicio.
 * @param {{date?: string, start?: string}} entry
 * @returns {string}
 */
export function getRecordYear(entry) {
    const source = entry.date || entry.start || "";

    return source ? String(source).slice(0, 4) : "";
}

/**
 * Etiqueta del archivo adjunto de una entrada, si tiene.
 * @param {{file?: {name?: string}}} entry
 * @returns {string}
 */
function renderAttachmentName(entry) {
    return entry?.file?.name
        ? `<small>Clip: ${escapeHTML(entry.file.name)}</small>`
        : "";
}

/**
 * Campo de formulario (input o textarea) para una entrada de registro.
 * @param {{name: string, label: string, type?: string}} field
 * @param {string} recordKey
 * @returns {string}
 */
export function renderRecordField(field, recordKey) {
    const id = `${recordKey}_${field.name}`;

    if (field.type === "textarea") {
        return `
            <label class="record-field record-field--wide">
                <span>${field.label}</span>
                <textarea id="${id}" data-field="${field.name}" rows="3"></textarea>
            </label>
        `;
    }

    return `
        <label class="record-field">
            <span>${field.label}</span>
            <input id="${id}" data-field="${field.name}" type="${field.type || "text"}">
        </label>
    `;
}

/**
 * Tarjeta de una entrada de registro (valores de cada campo + adjunto).
 * @param {{fields: Array<{name: string, label: string, type?: string}>}} config
 * @param {Object} entry
 * @returns {string}
 */
export function renderRecordEntry(config, entry) {
    const values = config.fields
        .map(field => {
            const value = entry[field.name];
            const displayValue =
                field.type === "date" && value
                    ? formatDisplayDate(value)
                    : value;

            return `
                <span>
                    <strong>${field.label}:</strong>
                    ${escapeHTML(displayValue || "Sin dato")}
                </span>
            `;
        })
        .join("");

    return `
        <article class="record-item">
            <div class="record-item__values">
                ${values}
            </div>
            ${renderAttachmentName(entry)}
        </article>
    `;
}
