// Helpers puros para formatear y normalizar saldos (dias/horas) de permisos.

/**
 * Formatea un saldo: redondea a 2 decimales y usa coma decimal. Los enteros se
 * muestran sin decimales.
 * @param {number|string} value
 * @returns {string}
 */
export function formatSaldo(value) {
    const rounded =
        Math.round((Number(value) || 0) * 100) / 100;

    return Number.isInteger(rounded)
        ? String(rounded)
        : String(rounded).replace(".", ",");
}

/**
 * Normaliza un saldo ingresado: acepta coma decimal, redondea a 2 decimales y
 * no permite negativos. Un valor invalido se interpreta como 0.
 * @param {number|string} value
 * @returns {number}
 */
export function normalizeBalanceValue(value) {
    const numeric = Number(
        String(value ?? "").replace(",", ".")
    );

    if (!Number.isFinite(numeric)) return 0;

    return Math.max(0, Math.round(numeric * 100) / 100);
}

/**
 * Devuelve el saldo manual si es un numero finito (sin negativos); si no, el
 * valor calculado por defecto.
 * @param {number|string} manualValue
 * @param {number} fallbackValue
 * @returns {number}
 */
export function withManualBalance(manualValue, fallbackValue) {
    const numeric = Number(manualValue);

    return Number.isFinite(numeric)
        ? Math.max(0, numeric)
        : fallbackValue;
}
