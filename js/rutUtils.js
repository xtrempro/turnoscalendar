// Utilidades para formatear y validar el RUT chileno.

/**
 * Formatea un RUT agregando puntos de miles y el guion del digito verificador.
 * Acepta cualquier entrada y conserva solo digitos y la K.
 *
 * @param {*} value RUT en cualquier formato
 * @returns {string} RUT formateado (ej: "12.345.678-9")
 */
export function formatRut(value) {
    const raw = String(value || "")
        .replace(/[^0-9kK]/g, "")
        .toUpperCase();

    if (raw.length <= 1) return raw;

    const body = raw.slice(0, -1);
    const verifier = raw.slice(-1);
    const dotted = body
        .split("")
        .reverse()
        .join("")
        .match(/.{1,3}/g)
        .join(".")
        .split("")
        .reverse()
        .join("");

    return `${dotted}-${verifier}`;
}

/**
 * Limpia un RUT para validarlo: quita puntos y espacios y pasa a mayusculas,
 * dejando el formato "cuerpo-dv".
 *
 * @param {*} value RUT a limpiar
 * @returns {string} RUT sin puntos ni espacios
 */
export function cleanRutForValidation(value) {
    return String(value || "")
        .replace(/\./g, "")
        .replace(/\s+/g, "")
        .toUpperCase();
}

/**
 * Valida un RUT chileno calculando su digito verificador (modulo 11).
 *
 * @param {*} rutCompleto RUT con o sin formato
 * @returns {boolean} true si el digito verificador es correcto
 */
export function validarRut(rutCompleto) {
    const cleaned = cleanRutForValidation(rutCompleto);

    if (!/^[0-9]+-[0-9K]{1}$/.test(cleaned)) return false;

    const [rut, dv] = cleaned.split("-");
    let suma = 0;
    let multiplo = 2;

    for (let i = rut.length - 1; i >= 0; i--) {
        suma += Number(rut.charAt(i)) * multiplo;
        multiplo = multiplo < 7 ? multiplo + 1 : 2;
    }

    let dvEsperado = 11 - (suma % 11);
    dvEsperado =
        dvEsperado === 11
            ? "0"
            : dvEsperado === 10
                ? "K"
                : String(dvEsperado);

    return dv === dvEsperado;
}

/**
 * Devuelve un mensaje de error si el RUT no es valido, o cadena vacia si lo es
 * (o si esta vacio).
 *
 * @param {*} value RUT a validar
 * @returns {string} mensaje de error o ""
 */
export function getRutValidationMessage(value) {
    const rut = String(value || "").trim();

    if (!rut) return "";
    if (validarRut(rut)) return "";

    return "El RUT ingresado no es valido. Revisa el numero y el digito verificador.";
}
