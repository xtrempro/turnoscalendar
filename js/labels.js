// Etiquetas legibles para estados y tipos usados en mensajes/auditoria.

/**
 * Estado activo/inactivo de un perfil.
 * @param {boolean} value
 * @returns {string}
 */
export function activeLabel(value) {
    return value ? "activo" : "desactivado";
}

/**
 * Si/no para banderas booleanas.
 * @param {boolean} value
 * @returns {string}
 */
export function yesNoLabel(value) {
    return value ? "si" : "no";
}

/**
 * Nombre del tipo de licencia/permiso.
 * @param {string} type
 * @returns {string}
 */
export function getLicenseTypeLabel(type) {
    if (type === "professional_license") return "LM Profesional";
    if (type === "union_leave") return "Permiso Gremial";
    if (type === "unpaid_leave") return "Permiso sin Goce";
    return "Licencia Médica";
}
