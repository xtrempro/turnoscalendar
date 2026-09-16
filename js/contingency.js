// Contingencia: el trabajador que queda de LLAMADO para un turno de un dia.
//
// Si alguien no llega a ultima hora -licencia, una urgencia-, al que tiene
// marcada la contingencia de ese dia le toca venir a cubrir a su compañero. Hay
// una marca por turno cubrible: "LC" para la Larga y "NC" para la Noche.
//
// NO es un turno. No se publica a la aplicacion del trabajador, no suma horas y
// no entra en la proyeccion: es una anotacion del supervisor, como los dias
// bloqueados. Lo unico que hace en el sistema es adelantarse en las sugerencias
// de reemplazo cuando el turno que se busca es el suyo y la fecha ya esta
// encima (ver replacementCandidates.js).
//
// Vive en `contingency_<trabajador>`, que viaja en el modulo `turnos` y por eso
// no necesita reglas nuevas en Firestore.

import { getJSON, setJSON } from "./persistence.js";
import { aplicarCambiosTurno, getTurnoProgramado } from "./turnEngine.js";
import { getTurnoComponentes, tieneAusencia } from "./rulesEngine.js";
import { TURNO } from "./constants.js";

const STORAGE_PREFIX = "contingency_";

export const CONTINGENCY = { LARGA: "L", NOCHE: "N" };

// Las siglas que se ven en la casilla del calendario y en el timeline.
export const CONTINGENCY_BADGE = { L: "LC", N: "NC" };

export const CONTINGENCY_NAME = {
    L: "L CONTINGENCIA",
    N: "N CONTINGENCIA"
};

/**
 * Dias de anticipacion con los que la contingencia ENCABEZA las sugerencias.
 *
 * Es la diferencia entre "no llego el de esta noche" y "faltan ocho dias": en
 * lo inmediato es a quien le toca venir, pero con tiempo por delante todavia se
 * puede buscar a otro, y el de contingencia debe quedar libre por si ese mismo
 * dia falta alguien mas. Mas alla de este plazo sigue apareciendo en la lista
 * -y con su color-, solo que sin saltarse la fila.
 */
export const CONTINGENCY_PRIORITY_DAYS = 2;

export function contingencyStorageKey(worker) {
    return `${STORAGE_PREFIX}${worker || ""}`;
}

export function normalizeContingencyKind(kind) {
    const value = String(kind || "").trim().toUpperCase();

    if (value === CONTINGENCY.LARGA || value === "LARGA" || value === "LC") {
        return CONTINGENCY.LARGA;
    }

    if (value === CONTINGENCY.NOCHE || value === "NOCHE" || value === "NC") {
        return CONTINGENCY.NOCHE;
    }

    return "";
}

export function getContingencyDays(worker) {
    if (!worker) return {};

    const stored = getJSON(contingencyStorageKey(worker), {});

    return stored && typeof stored === "object" ? stored : {};
}

export function saveContingencyDays(worker, days) {
    if (!worker) return;

    setJSON(
        contingencyStorageKey(worker),
        days && typeof days === "object" ? days : {}
    );
}

export function getContingencyKind(worker, keyDay) {
    if (!worker || !keyDay) return "";

    return normalizeContingencyKind(getContingencyDays(worker)[keyDay]);
}

export function contingencyBadgeFor(worker, keyDay) {
    const kind = getContingencyKind(worker, keyDay);

    return kind ? CONTINGENCY_BADGE[kind] : "";
}

export function contingencyBadgeForKind(kind) {
    const value = normalizeContingencyKind(kind);

    return value ? CONTINGENCY_BADGE[value] : "";
}

export function contingencyNameForKind(kind) {
    const value = normalizeContingencyKind(kind);

    return value ? CONTINGENCY_NAME[value] : "";
}

export function offsetContingencyKey(keyDay, offset) {
    const parts = String(keyDay || "").split("-").map(Number);

    if (parts.length !== 3 || parts.some(Number.isNaN)) return "";

    const date = new Date(parts[0], parts[1], parts[2] + offset);

    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// El turno COMPROMETIDO del dia: lo programado con los cambios ya aplicados. Es
// el mismo estado que mira el cuadro de sugerencias, no la rotativa base: si al
// trabajador ya le movieron la Larga, el dia queda elegible.
function dayTurn(worker, keyDay) {
    if (!worker || !keyDay) return TURNO.LIBRE;

    return aplicarCambiosTurno(
        worker,
        keyDay,
        getTurnoProgramado(worker, keyDay)
    );
}

function turnIncludes(turno, component) {
    return getTurnoComponentes(Number(turno) || TURNO.LIBRE)
        .includes(component);
}

/**
 * Por que este dia NO admite la marca; "" si la admite.
 *
 * Las reglas son las del propio turno que tendria que venir a cubrir:
 *
 *   LC -entraria a las 08:00 a hacer una Larga-: no el dia en que ya hace
 *      Larga, ni el dia siguiente a una Noche suya, porque esa Noche termina a
 *      las 08:00 y encadenaria la jornada sin dormir.
 *
 *   NC -entraria a las 20:00 a hacer una Noche-: no el dia en que ya hace
 *      Noche, ni la vispera de una Larga suya, por lo mismo al reves.
 *
 * Un dia con permiso, ausencia o devolucion de horas tampoco: quien no puede
 * venir no puede quedar de llamado.
 */
export function contingencyDayBlockReason(worker, keyDay, kind, context = {}) {
    const kindValue = normalizeContingencyKind(kind);

    if (!worker || !keyDay || !kindValue) return "Marca de contingencia no válida.";

    const {
        admin = {},
        legal = {},
        comp = {},
        absences = {},
        hourReturns = {}
    } = context;

    if (
        tieneAusencia(keyDay, admin, legal, comp, absences) ||
        hourReturns?.[keyDay]
    ) {
        return "Ese día tiene permiso, ausencia o devolución de horas.";
    }

    const own = Number.isFinite(Number(context.actualState))
        ? Number(context.actualState)
        : dayTurn(worker, keyDay);

    if (kindValue === CONTINGENCY.LARGA) {
        if (turnIncludes(own, "L")) {
            return "Ese día ya hace Larga: no podría cubrir otra.";
        }

        const previous = Number.isFinite(Number(context.previousState))
            ? Number(context.previousState)
            : dayTurn(worker, offsetContingencyKey(keyDay, -1));

        if (turnIncludes(previous, "N")) {
            return "Viene saliendo de una Noche: ese día no puede tomar una Larga.";
        }

        return "";
    }

    if (turnIncludes(own, "N")) {
        return "Ese día ya hace Noche: no podría cubrir otra.";
    }

    const next = Number.isFinite(Number(context.nextState))
        ? Number(context.nextState)
        : dayTurn(worker, offsetContingencyKey(keyDay, 1));

    if (turnIncludes(next, "L")) {
        return "Al día siguiente hace Larga: una Noche antes encadenaría 24 horas.";
    }

    return "";
}

export function canMarkContingency(worker, keyDay, kind, context = {}) {
    return contingencyDayBlockReason(worker, keyDay, kind, context) === "";
}

export function setContingencyDay(worker, keyDay, kind) {
    const kindValue = normalizeContingencyKind(kind);

    if (!worker || !keyDay || !kindValue) return false;

    const days = getContingencyDays(worker);

    // Una marca por dia: quien queda de llamado para la Larga no puede quedar
    // a la vez para la Noche, porque cubrir una lo deja fuera de la otra.
    days[keyDay] = kindValue;
    saveContingencyDays(worker, days);

    return true;
}

export function clearContingencyDay(worker, keyDay) {
    if (!worker || !keyDay) return false;

    const days = getContingencyDays(worker);

    if (!Object.prototype.hasOwnProperty.call(days, keyDay)) return false;

    delete days[keyDay];
    saveContingencyDays(worker, days);

    return true;
}

/**
 * Pone la marca, o la quita si ese dia ya tenia la MISMA. Volver a marcar es la
 * forma de corregirse sin buscar otro control.
 *
 * @returns {"on"|"off"|""} "" si el dia no la admite.
 */
export function toggleContingencyDay(worker, keyDay, kind, context = {}) {
    const kindValue = normalizeContingencyKind(kind);

    if (!worker || !keyDay || !kindValue) return "";

    if (getContingencyKind(worker, keyDay) === kindValue) {
        clearContingencyDay(worker, keyDay);
        return "off";
    }

    if (!canMarkContingency(worker, keyDay, kindValue, context)) return "";

    setContingencyDay(worker, keyDay, kindValue);

    return "on";
}

/**
 * .La marca de este trabajador sirve para el turno que se esta buscando?
 *
 * La media mañana y la media tarde entran en la Larga: son los dos tramos en
 * que se parte cuando el ausente tenia medio administrativo, y a quien quedo de
 * contingencia de Larga le toca igual.
 */
export function contingencyCoversTurn(kind, neededTurn) {
    const kindValue = normalizeContingencyKind(kind);

    if (!kindValue) return false;

    if (kindValue === CONTINGENCY.NOCHE) {
        return turnIncludes(neededTurn, "N");
    }

    return (
        turnIncludes(neededTurn, "L") ||
        turnIncludes(neededTurn, "HM") ||
        turnIncludes(neededTurn, "HT")
    );
}

// Dias que faltan para el turno. Negativo si ya paso.
export function contingencyLeadDays(date, today = new Date()) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;

    const target = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );
    const from = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
    );

    return Math.round((target - from) / 86400000);
}

export function contingencyIsImminent(date, today = new Date()) {
    const lead = contingencyLeadDays(date, today);

    return lead !== null && lead <= CONTINGENCY_PRIORITY_DAYS;
}
