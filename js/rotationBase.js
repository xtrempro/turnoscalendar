// Base simple de rotativa, COMPARTIDA con la PWA.
//
// Rediseno de sincronizacion de turnos: en vez de publicar todos los dias, se
// publica solo el mapa disperso de EXCEPCIONES (dias donde el turno real difiere
// de esta base simple). La PWA calcula esta misma base para cualquier mes y
// superpone las excepciones -> reproduce exactamente lo real.
//
// Esta funcion base debe ser IDENTICA a APP TurnoPLus/www/js/rotationEngine.js.
// Cualquier divergencia se corrige sola: ese dia pasa a ser una excepcion.

import { TURNO } from "./constants.js";

const TURNO_LABEL = {
    0: "",
    1: "Larga",
    2: "Noche",
    3: "24",
    4: "Diurno",
    5: "D+N",
    6: "1/2M",
    7: "Extensión horaria",
    8: "18 horas"
};

function stripAccents(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeFirstTurn(value) {
    const normalized = stripAccents(value).toLowerCase();

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

    return normalized === "noche" ? "noche" : "larga";
}

function rotateSequence(sequence, startIndex) {
    return [
        ...sequence.slice(startIndex),
        ...sequence.slice(0, startIndex)
    ];
}

function rotationStartIndex(type, firstTurn = "larga") {
    const normalized = normalizeFirstTurn(firstTurn);

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

function rotationSequence(type, firstTurn = "larga") {
    if (type === "3turno") {
        return rotateSequence(
            [TURNO.LARGA, TURNO.LARGA, TURNO.NOCHE, TURNO.NOCHE, TURNO.LIBRE, TURNO.LIBRE],
            rotationStartIndex(type, firstTurn)
        );
    }

    if (type === "4turno") {
        return rotateSequence(
            [TURNO.LARGA, TURNO.NOCHE, TURNO.LIBRE, TURNO.LIBRE],
            rotationStartIndex(type, firstTurn)
        );
    }

    return [];
}

function dayDifference(start, date) {
    const msPerDay = 24 * 60 * 60 * 1000;
    const startUTC = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const dateUTC = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.floor((dateUTC - startUTC) / msPerDay);
}

function parseISODate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!match) return null;
    const [, y, m, d] = match;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(date.getTime()) ? null : date;
}

// Espejo de classNameForDay (workerAppDataSync.js).
function classNameForDay(state, hasLeave) {
    if (hasLeave) return "permiso";

    switch (Number(state) || TURNO.LIBRE) {
        case TURNO.LARGA:
            return "larga";
        case TURNO.NOCHE:
            return "noche";
        case TURNO.TURNO24:
            return "turno24";
        case TURNO.DIURNO:
            return "diurno";
        case TURNO.DIURNO_NOCHE:
            return "diurno-noche";
        case TURNO.MEDIA_MANANA:
        case TURNO.MEDIA_TARDE:
            return "half";
        case TURNO.TURNO18:
            return "turno18";
        default:
            return "libre";
    }
}

function isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6;
}

// Base simple compartida: NO conoce feriados, permisos, reemplazos ni ediciones.
export function simpleBaseTurno(rotativa, iso) {
    const type = rotativa && rotativa.type;
    if (!type || type === "libre") return TURNO.LIBRE;

    const date = parseISODate(iso);
    const start = parseISODate(rotativa.start);
    if (!date || !start || date < start) return TURNO.LIBRE;

    if (type === "diurno") {
        return isWeekend(date) ? TURNO.LIBRE : TURNO.DIURNO;
    }

    const firstTurn = rotativa.firstTurn || rotativa.first || "larga";
    const sequence = rotationSequence(type, firstTurn);
    if (!sequence.length) return TURNO.LIBRE;

    return sequence[dayDifference(start, date) % sequence.length] || TURNO.LIBRE;
}

// Render base para comparar contra el dia real y decidir si es excepcion.
export function baseRenderDay(rotativa, iso) {
    const turno = simpleBaseTurno(rotativa, iso);
    const label = TURNO_LABEL[turno] || "Libre";
    return {
        turno,
        label,
        displayLabel: label,
        className: classNameForDay(turno, false),
        isManualExtra: false,
        hasLeave: false
    };
}
