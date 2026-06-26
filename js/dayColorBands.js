// Calcula el color del dia como una pila de BANDAS (de arriba hacia abajo, en
// orden cronologico):
//   [incidencia de entrada] + [componentes del turno base] + [incidencia de salida]
//
// Tamanos:
//   - Cada incidencia de marcaje (extension/reduccion) ocupa un 15% FIJO de la
//     celda (arriba y/o abajo), sin importar cuanto sea, para que se note.
//   - El resto lo reparten los componentes del turno (en partes iguales, salvo
//     18h = 1/3 extension + 2/3 noche).
//
// Incidencias (con las horas reales del marcaje, gracia de 5 min):
//   ingreso anticipado / salida tardia = EXTENSION; ingreso con atraso / salida
//   anticipada = REDUCCION (rojo).
//
// Color extra: si un componente del turno NO pertenece al turno base (vino como
// turno extra / reemplazo), se pinta con su color "extra".
//
// El color de cada banda se resuelve con un "resolver": por defecto usa las
// variables CSS (calendario/timeline, que reaccionan a Ajustes); para la PWA se
// puede pasar un resolver que devuelve hex (snapshot de los colores).
//
// Devuelve un string de linear-gradient, o null si el dia es de un solo color.

import { TURNO } from "./constants.js";
import { dateAt, nextDateAt } from "./timeUtils.js";
import { isBusinessDay } from "./calculations.js";
import { getTurnoComponentes } from "./rulesEngine.js";
import {
    getClockMark,
    getClockScheduleState,
    getScheduledSegmentsForProfile
} from "./clockMarks.js";
import {
    findClockMarkEntry,
    getClockMarkTimingFlags
} from "./clockMarkUtils.js";

// Gracia de marcaje: una diferencia se considera incidencia recien pasados
// estos minutos (el atraso cuenta desde el minuto 6 = mas de 5 min).
const INCIDENT_GRACE_MINUTES = 5;

// Porcentaje fijo de cada banda de incidencia.
const INCIDENT_PCT = 15;

// Codigo -> variable CSS base/extra + color de respaldo.
const TURNO_VAR = {
    L: { num: 1, fallback: "#22c55e" },
    N: { num: 2, fallback: "#1d6cff" },
    D: { num: 4, fallback: "#0b8853" }
};

const NAMED_FALLBACK = {
    extension: "#f59e0b",
    reduction: "#dc2626",
    admin: "#f97316"
};

// Resolver por defecto: usa variables CSS (con color de respaldo).
function defaultResolveColor(code, isExtra) {
    if (code === "extension" || code === "reduction" || code === "admin") {
        return `var(--color-${code}, ${NAMED_FALLBACK[code]})`;
    }

    const info = TURNO_VAR[code];
    if (!info) return `var(--color-extension, ${NAMED_FALLBACK.extension})`;

    const suffix = isExtra ? "-extra" : "";
    return `var(--turno-color-${info.num}${suffix}, ${info.fallback})`;
}

/**
 * Crea un resolver que devuelve colores HEX a partir de una config de colores
 * ({ base, extra, named }). Para la PWA (que no tiene las variables CSS).
 * @param {{base: Object, extra: Object, named: Object}} config
 * @returns {(code: string, isExtra: boolean) => string}
 */
export function buildHexColorResolver(config) {
    return (code, isExtra) => {
        if (code === "extension" || code === "reduction" || code === "admin") {
            return config?.named?.[code] || NAMED_FALLBACK[code];
        }

        const info = TURNO_VAR[code];
        if (!info) return config?.named?.extension || NAMED_FALLBACK.extension;

        const source = isExtra ? config?.extra : config?.base;
        return source?.[info.num] || info.fallback;
    };
}

function diurnoEndHour(date) {
    return date.getDay() === 5 ? 16 : 17;
}

// Componentes del turno base en orden cronologico. Cada uno: code (color y si es
// extra), weight (reparto) y start/end (deteccion de incidencia).
function baseComponents(state, date, holidays, halfAdmin, baseTurn) {
    if (halfAdmin === "0.5M" || halfAdmin === "0.5T") {
        const baseCode =
            baseTurn === TURNO.DIURNO ? "D" : baseTurn === TURNO.LARGA ? "L" : null;

        if (!baseCode) return null;

        const endH = baseCode === "D" ? diurnoEndHour(date) : 20;

        if (halfAdmin === "0.5M") {
            return [
                { code: "admin", weight: 1, start: dateAt(date, 8), end: dateAt(date, 14) },
                { code: baseCode, weight: 1, start: dateAt(date, 14), end: dateAt(date, endH) }
            ];
        }

        return [
            { code: baseCode, weight: 1, start: dateAt(date, 8), end: dateAt(date, 14) },
            { code: "admin", weight: 1, start: dateAt(date, 14), end: dateAt(date, endH) }
        ];
    }

    if (state === TURNO.LARGA) {
        return [{ code: "L", weight: 1, start: dateAt(date, 8), end: dateAt(date, 20) }];
    }

    if (state === TURNO.NOCHE) {
        return [{ code: "N", weight: 1, start: dateAt(date, 20), end: nextDateAt(date, 8) }];
    }

    if (state === TURNO.DIURNO) {
        if (!isBusinessDay(date, holidays)) return null;
        return [{ code: "D", weight: 1, start: dateAt(date, 8), end: dateAt(date, diurnoEndHour(date)) }];
    }

    if (state === TURNO.TURNO24) {
        return [
            { code: "L", weight: 1, start: dateAt(date, 8), end: dateAt(date, 20) },
            { code: "N", weight: 1, start: dateAt(date, 20), end: nextDateAt(date, 8) }
        ];
    }

    if (state === TURNO.DIURNO_NOCHE) {
        const comps = [];

        if (isBusinessDay(date, holidays)) {
            comps.push({ code: "D", weight: 1, start: dateAt(date, 8), end: dateAt(date, diurnoEndHour(date)) });
        }

        comps.push({ code: "N", weight: 1, start: dateAt(date, 20), end: nextDateAt(date, 8) });
        return comps;
    }

    if (state === TURNO.TURNO18) {
        return [
            { code: "extension", weight: 1, start: dateAt(date, 14), end: dateAt(date, 20) },
            { code: "N", weight: 2, start: dateAt(date, 20), end: nextDateAt(date, 8) }
        ];
    }

    return null;
}

function gradientFromPercentBands(bands) {
    if (bands.length <= 1) return null;

    let acc = 0;
    const stops = bands.map(band => {
        const from = acc;
        acc += band.pct;
        const to = acc;
        return `${band.color} ${from.toFixed(3)}% ${to.toFixed(3)}%`;
    });

    return `linear-gradient(to bottom, ${stops.join(", ")})`;
}

/**
 * Gradiente vertical del dia (pila de bandas) o null si es de un solo color.
 * @param {Object} [options] { resolveColor } resolver de color de banda.
 */
export function getDayColorGradient(
    profileName,
    keyDay,
    state,
    date,
    holidays,
    halfAdmin = null,
    baseTurn = null,
    options = {}
) {
    const resolveColor = options.resolveColor || defaultResolveColor;
    const comps = baseComponents(state, date, holidays, halfAdmin, baseTurn);

    if (!comps || !comps.length) return null;

    // Incidencias de entrada/salida con horas reales del marcaje (gracia 5 min).
    let topIncident = null;
    let bottomIncident = null;

    const mark = getClockMark(profileName, keyDay);

    if (mark?.segments) {
        const scheduledState = getClockScheduleState(profileName, keyDay, state);
        const segments = getScheduledSegmentsForProfile(
            profileName,
            keyDay,
            date,
            scheduledState,
            holidays
        );

        if (segments.length) {
            const firstSeg = segments[0];
            const lastSeg = segments[segments.length - 1];
            const firstMark = findClockMarkEntry(mark, firstSeg);
            const lastMark = findClockMarkEntry(mark, lastSeg);

            if (firstMark) {
                const timing = getClockMarkTimingFlags(date, firstSeg, firstMark.value);
                if (timing.entry) {
                    const diff = (firstSeg.start - timing.entry) / 60000;
                    if (diff > INCIDENT_GRACE_MINUTES) topIncident = "extension";
                    else if (diff < -INCIDENT_GRACE_MINUTES) topIncident = "reduction";
                }
            }

            if (lastMark) {
                const timing = getClockMarkTimingFlags(date, lastSeg, lastMark.value);
                if (timing.exit) {
                    const diff = (timing.exit - lastSeg.end) / 60000;
                    if (diff > INCIDENT_GRACE_MINUTES) bottomIncident = "extension";
                    else if (diff < -INCIDENT_GRACE_MINUTES) bottomIncident = "reduction";
                }
            }
        }
    }

    // Componentes que pertenecen al turno base (los que no, son extra).
    const baseCodes = baseTurn ? getTurnoComponentes(baseTurn) : [];

    // Reparto: cada incidencia = 15% fijo; el resto lo reparten los componentes.
    const incidentCount = (topIncident ? 1 : 0) + (bottomIncident ? 1 : 0);
    const baseRegion = 100 - incidentCount * INCIDENT_PCT;
    const weightTotal = comps.reduce((sum, comp) => sum + (comp.weight || 1), 0);

    const bands = [];

    if (topIncident) {
        bands.push({ color: resolveColor(topIncident, false), pct: INCIDENT_PCT });
    }

    for (const comp of comps) {
        const isExtra =
            Boolean(TURNO_VAR[comp.code]) &&
            baseCodes.length > 0 &&
            !baseCodes.includes(comp.code);

        bands.push({
            color: resolveColor(comp.code, isExtra),
            pct: baseRegion * ((comp.weight || 1) / weightTotal)
        });
    }

    if (bottomIncident) {
        bands.push({ color: resolveColor(bottomIncident, false), pct: INCIDENT_PCT });
    }

    return gradientFromPercentBands(bands);
}
