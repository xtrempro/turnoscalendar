// Calcula el color del dia como una pila de BANDAS (de arriba hacia abajo, en
// orden cronologico):
//   por componente: [incidencia de entrada] + [componente] + [incidencia de salida]
//   (un D+N con la salida del Diurno modificada lleva su franja en el medio)
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

// Porcentaje fijo de cada banda de incidencia (y con mas de dos, mas angostas).
const INCIDENT_PCT = 15;
const INCIDENT_PCT_CROWDED = 10;

// Codigo -> variable CSS base/extra + color de respaldo.
const TURNO_VAR = {
    L: { num: 1, fallback: "#0089c5" },
    N: { num: 2, fallback: "#10498b" },
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

function gradientFromPercentBands(bands, includeSingleBand = false) {
    if (!bands.length) return null;
    if (bands.length === 1 && !includeSingleBand) return null;

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

    // Incidencias de entrada/salida con horas reales del marcaje (gracia 5 min),
    // por componente. Con un tramo por componente (D+N: diurno y noche) cada
    // uno tiene las suyas, y las del MEDIO -salida del Diurno, entrada de la
    // Noche- se ven entre los dos colores; antes solo se miraban la entrada
    // del primero y la salida del ultimo, y un Diurno que salia antes dentro
    // de un D+N no se veia (aunque las horas si lo descontaban).
    const incidents = comps.map(() => ({ entry: null, exit: null }));
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
        const entryIncident = segment => {
            const segmentMark = findClockMarkEntry(mark, segment);
            const timing = segmentMark
                ? getClockMarkTimingFlags(date, segment, segmentMark.value)
                : null;

            if (!timing?.entry) return null;

            const diff = (segment.start - timing.entry) / 60000;

            if (diff > INCIDENT_GRACE_MINUTES) return "extension";
            if (diff < -INCIDENT_GRACE_MINUTES) return "reduction";
            return null;
        };
        const exitIncident = segment => {
            const segmentMark = findClockMarkEntry(mark, segment);
            const timing = segmentMark
                ? getClockMarkTimingFlags(date, segment, segmentMark.value)
                : null;

            if (!timing?.exit) return null;

            const diff = (timing.exit - segment.end) / 60000;

            if (diff > INCIDENT_GRACE_MINUTES) return "extension";
            if (diff < -INCIDENT_GRACE_MINUTES) return "reduction";
            return null;
        };

        if (segments.length && segments.length === comps.length) {
            segments.forEach((segment, index) => {
                incidents[index].entry = entryIncident(segment);
                incidents[index].exit = exitIncident(segment);
            });
        } else if (segments.length) {
            // Un tramo que abarca varios componentes (24h, 18h, medio ADM):
            // solo su entrada arriba y su salida abajo, como siempre.
            incidents[0].entry = entryIncident(segments[0]);
            incidents[incidents.length - 1].exit = exitIncident(segments[segments.length - 1]);
        }
    }

    // Componentes que pertenecen al turno base (los que no, son extra).
    const baseCodes = baseTurn ? getTurnoComponentes(baseTurn) : [];

    // Reparto: cada incidencia = 15% fijo (10% si son mas de dos, para que el
    // turno se siga viendo); el resto lo reparten los componentes.
    const incidentCount = incidents.reduce(
        (sum, item) => sum + (item.entry ? 1 : 0) + (item.exit ? 1 : 0),
        0
    );
    const incidentPct = incidentCount > 2 ? INCIDENT_PCT_CROWDED : INCIDENT_PCT;
    const baseRegion = 100 - incidentCount * incidentPct;
    const weightTotal = comps.reduce((sum, comp) => sum + (comp.weight || 1), 0);

    const bands = [];

    comps.forEach((comp, index) => {
        const isExtra =
            Boolean(TURNO_VAR[comp.code]) &&
            (
                baseCodes.length > 0
                    ? !baseCodes.includes(comp.code)
                    : options.unbasedComponentsAreExtra === true
            );

        // Turno devuelto (DDTT) que forma un 24h: su mitad es el componente EXTRA.
        // Si el supervisor personalizo el color del turno devuelto, esa banda se
        // pinta con ese color y la otra mitad conserva su color normal.
        const color =
            isExtra && options.extraColorOverride
                ? options.extraColorOverride
                : resolveColor(comp.code, isExtra);

        if (incidents[index].entry) {
            bands.push({ color: resolveColor(incidents[index].entry, false), pct: incidentPct });
        }

        bands.push({
            color,
            pct: baseRegion * ((comp.weight || 1) / weightTotal)
        });

        if (incidents[index].exit) {
            bands.push({ color: resolveColor(incidents[index].exit, false), pct: incidentPct });
        }
    });

    return gradientFromPercentBands(
        bands,
        options.singleBandGradient === true
    );
}
