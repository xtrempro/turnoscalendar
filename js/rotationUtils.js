// Logica pura de rotativas: etiquetas, opciones de inicio, normalizacion del
// "primer turno" y construccion de la secuencia de turnos.
//
// Las secuencias usan los codigos crudos de turno: 0 = Libre, 1 = Larga,
// 2 = Noche (coinciden con TURNO.LIBRE/LARGA/NOCHE).
//
// Nota: turnEngine.js y storage.js mantienen copias propias de parte de esta
// logica con diferencias menores; consolidarlas requiere verificar equivalencia
// y queda pendiente para un paso futuro.

import { stripAccents } from "./stringUtils.js";

/**
 * Mes que debe conservarse al pasar desde "Modificar rotativa" al modo de
 * seleccion de fecha. Recibe la fecha visible del calendario, no la fecha
 * actual del sistema.
 * @param {Date} calendarDate
 * @returns {{year: number, month: number}}
 */
export function getRotationSelectionMonth(calendarDate) {
    return {
        year: calendarDate.getFullYear(),
        month: calendarDate.getMonth()
    };
}

/**
 * Etiqueta legible del tipo de rotativa.
 * @param {string} type
 * @returns {string}
 */
export function getRotativaLabel(type) {
    if (type === "3turno") return "3er Turno";
    if (type === "4turno") return "4° Turno";
    if (type === "diurno") return "Diurno";
    if (type === "libre") return "Libre";
    if (type === "reemplazo") return "Reemplazo";
    return "Sin rotativa";
}

/**
 * Indica si el tipo de rotativa requiere elegir un "primer turno".
 * @param {string} type
 * @returns {boolean}
 */
export function requiresRotationFirstTurn(type) {
    return type === "3turno" || type === "4turno";
}

/**
 * Indica si el tipo de rotativa requiere una fecha de inicio.
 * @param {string} type
 * @returns {boolean}
 */
export function requiresRotationStart(type) {
    return Boolean(type) && type !== "libre";
}

/**
 * Opciones de "primer turno" disponibles segun el tipo de rotativa.
 * @param {string} type
 * @returns {Array<{value: string, label: string, summary: string, detail: string}>}
 */
export function getRotationStartOptions(type) {
    if (type === "3turno") {
        return [
            {
                value: "larga",
                label: "Iniciar con primer Largo",
                summary: "primer Largo",
                detail: "Iniciar con el primer turno Largo"
            },
            {
                value: "larga2",
                label: "Iniciar con segundo Largo",
                summary: "segundo Largo",
                detail: "Iniciar con el segundo turno Largo"
            },
            {
                value: "noche",
                label: "Iniciar con primera Noche",
                summary: "primera Noche",
                detail: "Iniciar con la primera Noche"
            },
            {
                value: "noche2",
                label: "Iniciar con segunda Noche",
                summary: "segunda Noche",
                detail: "Iniciar con la segunda Noche"
            },
            {
                value: "libre1",
                label: "Iniciar con primer Libre",
                summary: "primer Libre",
                detail: "Iniciar con el primer Libre"
            },
            {
                value: "libre2",
                label: "Iniciar con segundo Libre",
                summary: "segundo Libre",
                detail: "Iniciar con el segundo Libre"
            }
        ];
    }

    if (type === "4turno") {
        return [
            {
                value: "larga",
                label: "Iniciar con Largo",
                summary: "Largo",
                detail: "Iniciar con turno Largo"
            },
            {
                value: "noche",
                label: "Iniciar con Noche",
                summary: "Noche",
                detail: "Iniciar con turno Noche"
            },
            {
                value: "libre1",
                label: "Iniciar con primer Libre",
                summary: "primer Libre",
                detail: "Iniciar con el primer Libre"
            },
            {
                value: "libre2",
                label: "Iniciar con segundo Libre",
                summary: "segundo Libre",
                detail: "Iniciar con el segundo Libre"
            }
        ];
    }

    return [];
}

/**
 * Normaliza distintas formas de escribir el "primer turno" a un valor canonico
 * (larga, larga2, noche, noche2, libre1, libre2).
 * @param {string} value
 * @returns {string}
 */
export function normalizeRotationFirstTurn(value) {
    const normalized = stripAccents(String(value || "")).toLowerCase();

    if (
        normalized === "larga2" ||
        normalized === "largo2" ||
        normalized === "segunda larga" ||
        normalized === "segundo largo" ||
        normalized === "2 larga" ||
        normalized === "2 largo"
    ) {
        return "larga2";
    }

    if (
        normalized === "noche2" ||
        normalized === "segunda noche" ||
        normalized === "2 noche"
    ) {
        return "noche2";
    }

    if (
        normalized === "libre2" ||
        normalized === "segundo libre" ||
        normalized === "segunda libre" ||
        normalized === "2 libre"
    ) {
        return "libre2";
    }

    if (
        normalized === "libre" ||
        normalized === "libre1" ||
        normalized === "primer libre" ||
        normalized === "primera libre" ||
        normalized === "1 libre"
    ) {
        return "libre1";
    }

    return normalized === "noche"
        ? "noche"
        : "larga";
}

/**
 * Normaliza el "primer turno" y lo ajusta a las opciones validas del tipo:
 * si el valor no es valido para ese tipo, devuelve la primera opcion.
 * @param {string} type
 * @param {string} value
 * @returns {string}
 */
export function normalizeRotationFirstTurnForType(type, value) {
    const normalized = normalizeRotationFirstTurn(value);
    const options = getRotationStartOptions(type);

    if (!options.length) return normalized;

    return options.some(option => option.value === normalized)
        ? normalized
        : options[0].value;
}

/**
 * Etiqueta resumida del "primer turno" para un tipo dado.
 * @param {string} value
 * @param {string} type
 * @returns {string}
 */
export function getRotationFirstTurnLabel(value, type = "") {
    const normalized = normalizeRotationFirstTurnForType(type, value);
    const option = getRotationStartOptions(type)
        .find(item => item.value === normalized);

    if (option) return option.summary || option.label;

    if (normalized === "larga2") return "segundo Largo";
    if (normalized === "noche") return "primera Noche";
    if (normalized === "noche2") return "segunda Noche";
    if (normalized === "libre1") return "primer Libre";
    if (normalized === "libre2") return "segundo Libre";

    return "primer Largo";
}

/**
 * Rota una secuencia para que comience en el indice dado.
 * @param {Array} sequence
 * @param {number} startIndex
 * @returns {Array}
 */
export function rotateRotationSequence(sequence, startIndex) {
    return [
        ...sequence.slice(startIndex),
        ...sequence.slice(0, startIndex)
    ];
}

/**
 * Indice de inicio dentro de la secuencia base segun el "primer turno".
 * @param {string} type
 * @param {string} firstTurn
 * @returns {number}
 */
export function rotationStartIndex(type, firstTurn = "larga") {
    const normalized =
        normalizeRotationFirstTurnForType(type, firstTurn);

    if (type === "3turno") {
        if (normalized === "larga2") return 1;
        if (normalized === "noche") return 2;
        if (normalized === "noche2") return 3;
        if (normalized === "libre1") return 4;
        if (normalized === "libre2") return 5;

        return 0;
    }

    if (type === "4turno") {
        if (normalized === "noche") return 1;
        if (normalized === "libre1") return 2;
        if (normalized === "libre2") return 3;

        return 0;
    }

    return 0;
}

/**
 * Secuencia de turnos para el tipo de rotativa, ya rotada al "primer turno".
 * @param {string} type
 * @param {string} firstTurn
 * @returns {number[]}
 */
export function getRotationSequence(type, firstTurn = "larga") {
    if (type === "3turno") {
        return rotateRotationSequence(
            [1, 1, 2, 2, 0, 0],
            rotationStartIndex(type, firstTurn)
        );
    }

    if (type === "4turno") {
        return rotateRotationSequence(
            [1, 2, 0, 0],
            rotationStartIndex(type, firstTurn)
        );
    }

    return [];
}
