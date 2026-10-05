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
import {
    getRotationDefinition,
    getShiftDefinition,
    rotationStartIndex as catalogStartIndex
} from "./rotationCatalog.js";

const TURNO_LABEL = {
    0: "",
    1: "Larga",
    2: "Noche",
    3: "24h",
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

function portableDefinition(rotativa) {
    const definition = rotativa?.definition;

    if (!definition || !Array.isArray(definition.pattern)) return null;

    const pattern = definition.pattern.filter(shift =>
        shift && typeof shift === "object" && Number.isFinite(Number(shift.turn))
    );
    if (!pattern.length) return null;

    return {
        mode: definition.mode === "businessDays" ? "businessDays" : "sequence",
        pattern
    };
}

function portableShiftForDate(rotativa, date, start) {
    const definition = portableDefinition(rotativa);
    if (!definition) return null;

    if (definition.mode === "businessDays") {
        return isWeekend(date) ? { turn: TURNO.LIBRE } : definition.pattern[0];
    }

    const raw = String(rotativa?.firstTurn || rotativa?.first || "position:0")
        .trim()
        .toLowerCase();
    const requested = /^position:\d+$/.test(raw)
        ? Number(raw.split(":")[1])
        : 0;
    const startIndex = Math.max(0, Math.min(definition.pattern.length - 1, requested));
    const index = (dayDifference(start, date) + startIndex) % definition.pattern.length;

    return definition.pattern[index] || null;
}

export function buildPortableRotativa(rotativa) {
    const source = rotativa && typeof rotativa === "object" ? rotativa : {};
    const definition = getRotationDefinition(source.type);

    if (!definition || definition.builtin) return { ...source };

    return {
        ...source,
        // Ya resuelta: un alias antiguo ("noche") la PWA lo leeria como 0.
        firstTurn: `position:${catalogStartIndex(source.type, source.firstTurn)}`,
        name: definition.name,
        definition: {
            mode: definition.mode,
            pattern: definition.pattern.map(shiftId => {
                const shift = getShiftDefinition(shiftId);
                return {
                    id: shift?.id || "libre",
                    name: shift?.name || "Libre",
                    turn: Number(shift?.turn) || TURNO.LIBRE,
                    start: shift?.start || "",
                    end: shift?.end || "",
                    fridayEnd: shift?.fridayEnd || "",
                    nextDay: Boolean(shift?.nextDay)
                };
            })
        }
    };
}

// Base simple compartida: NO conoce feriados, permisos, reemplazos ni ediciones.
export function simpleBaseTurno(rotativa, iso) {
    const type = rotativa && rotativa.type;
    if (!type || type === "libre") return TURNO.LIBRE;

    const date = parseISODate(iso);
    const start = parseISODate(rotativa.start);
    if (!date || !start || date < start) return TURNO.LIBRE;

    const portableShift = portableShiftForDate(rotativa, date, start);
    if (portableShift) return Number(portableShift.turn) || TURNO.LIBRE;

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
    const date = parseISODate(iso);
    const start = parseISODate(rotativa?.start);
    const portableShift = date && start && date >= start
        ? portableShiftForDate(rotativa, date, start)
        : null;
    const label = portableShift?.name || TURNO_LABEL[turno] || "Libre";
    return {
        turno,
        label,
        displayLabel: label,
        className: classNameForDay(turno, false),
        isManualExtra: false,
        hasLeave: false,
        shiftDefinition: portableShift
            ? {
                id: portableShift.id || "",
                name: portableShift.name || label,
                start: portableShift.start || "",
                end: portableShift.end || "",
                fridayEnd: portableShift.fridayEnd || "",
                nextDay: Boolean(portableShift.nextDay)
            }
            : null
    };
}

// Comparacion unica para los dos publicadores. La etiqueta y el horario de una
// rotativa configurable ya forman parte de ambos objetos; permisos,
// movimientos y ediciones siguen rompiendo la igualdad.
/**
 * Si un dia viaja como excepcion: cuando difiere de la base nueva O de la
 * antigua. Una PWA anterior a v327 (o el Android empaquetado) no entiende
 * `rotativa.definition` y calcula la base antigua; si solo se comparara con la
 * nueva, los dias de una rotativa personalizada no viajarian y esa app los
 * mostraria libres. Para las rotativas de sistema las dos bases son la misma.
 */
export function dayIsProjectionException(day, portableRotativa, legacyRotativa, iso) {
    return projectedDayDiffersFromBase(day, baseRenderDay(portableRotativa, iso)) ||
        (
            portableRotativa?.definition
                ? projectedDayDiffersFromBase(day, baseRenderDay(legacyRotativa, iso))
                : false
        );
}

export function projectedDayDiffersFromBase(actual, base) {
    return (
        (Number(actual?.turno) || TURNO.LIBRE) !== (Number(base?.turno) || TURNO.LIBRE) ||
        String(actual?.displayLabel || "") !== String(base?.displayLabel || "") ||
        String(actual?.className || "") !== String(base?.className || "") ||
        Boolean(actual?.hasLeave) !== Boolean(base?.hasLeave) ||
        Boolean(actual?.isManualExtra) !== Boolean(base?.isManualExtra) ||
        String(actual?.swapMarker?.label || "") !== String(base?.swapMarker?.label || "")
    );
}
