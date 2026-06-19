// Utilidades compartidas para construir HTML de forma segura.

/**
 * Escapa caracteres especiales de HTML para evitar inyeccion al interpolar
 * texto dentro de plantillas HTML (`innerHTML`, template strings, etc.).
 * Acepta cualquier valor; `null`/`undefined` se tratan como cadena vacia.
 *
 * @param {*} value valor a escapar
 * @returns {string} texto seguro para incrustar en HTML
 */
export function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
