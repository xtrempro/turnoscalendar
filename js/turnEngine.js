// js/turnEngine.js

import { TURNO } from "./constants.js";

import {
    getSwaps,
    getProfileData,
    getBaseProfileData,
    getTurnChangeConfig
} from "./storage.js";
import { getJSON } from "./persistence.js";
import { cambioEstaAnulado } from "./swaps.js";
import { getReplacementTurnForWorker } from "./replacements.js";

/* ======================================================
   TURN ENGINE
   Motor central de combinaciones y cambios de turno
====================================================== */

/* ======================================================
   FUSIONAR TURNOS
====================================================== */

export function fusionarTurnos(actual, recibido) {

    actual = Number(actual) || TURNO.LIBRE;
    recibido = Number(recibido) || TURNO.LIBRE;

    if (recibido === TURNO.LIBRE) return actual;
    if (actual === TURNO.LIBRE) return recibido;

    if (recibido === TURNO.MEDIA_MANANA) {
        if (actual === TURNO.MEDIA_TARDE) return TURNO.LARGA;

        return actual;
    }

    if (recibido === TURNO.MEDIA_TARDE) {
        if (actual === TURNO.MEDIA_MANANA) return TURNO.LARGA;
        if (actual === TURNO.DIURNO) return TURNO.LARGA;
        if (actual === TURNO.NOCHE) return TURNO.TURNO18;
        if (actual === TURNO.DIURNO_NOCHE) return TURNO.TURNO24;

        return actual;
    }

    if (recibido === TURNO.TURNO18) {
        if (
            actual === TURNO.MEDIA_MANANA ||
            actual === TURNO.DIURNO ||
            actual === TURNO.LARGA ||
            actual === TURNO.DIURNO_NOCHE ||
            actual === TURNO.TURNO24
        ) {
            return TURNO.TURNO24;
        }

        if (actual === TURNO.NOCHE) return TURNO.TURNO18;

        return actual;
    }

    if (
        actual === TURNO.MEDIA_MANANA ||
        actual === TURNO.MEDIA_TARDE ||
        actual === TURNO.TURNO18
    ) {
        return fusionarTurnos(recibido, actual);
    }

    /* si ya tiene 24, mantener */
    if (actual === TURNO.TURNO24) {
        return TURNO.TURNO24;
    }

    /* si ya tiene D+N, mantener */
    if (actual === TURNO.DIURNO_NOCHE) {
        return TURNO.DIURNO_NOCHE;
    }

    /* Diurno que extiende jornada para cubrir Larga. */
    if (
        (actual === TURNO.DIURNO && recibido === TURNO.LARGA) ||
        (actual === TURNO.LARGA && recibido === TURNO.DIURNO)
    ) {
        return TURNO.LARGA;
    }

    /* Largo + Noche = 24 */
    if (
        (actual === TURNO.LARGA && recibido === TURNO.NOCHE) ||
        (actual === TURNO.NOCHE && recibido === TURNO.LARGA)
    ) {
        return TURNO.TURNO24;
    }

    /* Diurno + Noche = D+N */
    if (
        (actual === TURNO.DIURNO && recibido === TURNO.NOCHE) ||
        (actual === TURNO.NOCHE && recibido === TURNO.DIURNO)
    ) {
        return TURNO.DIURNO_NOCHE;
    }

    /* cualquier otra mezcla no válida */
    return actual;
}

/* ======================================================
   HELPERS
====================================================== */

function isoFromKey(key) {

    const p = key.split("-");

    return `${p[0]}-${String(Number(p[1]) + 1).padStart(2, "0")}-${String(p[2]).padStart(2, "0")}`;
}

function offsetKey(key, offset) {
    const p = key.split("-");
    const date = new Date(
        Number(p[0]),
        Number(p[1]),
        Number(p[2])
    );

    date.setDate(date.getDate() + offset);

    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function turnoDesdeCodigoSwap(valor) {

    if (valor === "N") return TURNO.NOCHE;
    if (valor === "D") return TURNO.DIURNO;

    return TURNO.LARGA;
}

function includesLarga(turno) {
    const value = Number(turno) || TURNO.LIBRE;

    return (
        value === TURNO.LARGA ||
        value === TURNO.TURNO24
    );
}

function includesNoche(turno) {
    const value = Number(turno) || TURNO.LIBRE;

    return (
        value === TURNO.NOCHE ||
        value === TURNO.TURNO24 ||
        value === TURNO.DIURNO_NOCHE ||
        value === TURNO.TURNO18
    );
}

/* ======================================================
   APLICAR CAMBIOS DE TURNO
====================================================== */

export function aplicarCambiosTurno(
    nombre,
    key,
    turnoBase,
    options = {}
) {

    let turno = Number(turnoBase) || TURNO.LIBRE;
    const includeReplacements =
        options.includeReplacements !== false;

    const swaps = getSwaps();

    const fechaISO = isoFromKey(key);

    for (const s of swaps) {
        if (cambioEstaAnulado(s)) {
            continue;
        }

        /* ==================================================
           FECHA ORIGINAL
        ================================================== */

        if (!s.skipFecha && s.fecha === fechaISO) {

            /* quien entrega pierde su turno */
            if (s.from === nombre) {
                turno = TURNO.LIBRE;
            }

            /* quien recibe fusiona */
            if (s.to === nombre) {

                const recibido =
                    turnoDesdeCodigoSwap(s.turno);

                turno =
                    fusionarTurnos(turno, recibido);
            }
        }

        /* ==================================================
           FECHA DEVOLUCIÓN
        ================================================== */

        if (!s.skipDevolucion && s.devolucion === fechaISO) {

            /* trabajador B devuelve SOLO el turno pactado */
            if (s.to === nombre) {

                const devuelve =
                    turnoDesdeCodigoSwap(
                        s.turnoDevuelto
                    );

                if (turno === devuelve) {
                    turno = TURNO.LIBRE;
                }

                else if (
                    turno === TURNO.TURNO24 &&
                    devuelve === TURNO.LARGA
                ) {
                    turno = TURNO.NOCHE;
                }

                else if (
                    turno === TURNO.TURNO24 &&
                    devuelve === TURNO.NOCHE
                ) {
                    turno = TURNO.LARGA;
                }

                else if (
                    turno === TURNO.DIURNO_NOCHE &&
                    devuelve === TURNO.DIURNO
                ) {
                    turno = TURNO.NOCHE;
                }

                else if (
                    turno === TURNO.DIURNO_NOCHE &&
                    devuelve === TURNO.NOCHE
                ) {
                    turno = TURNO.DIURNO;
                }

                else {
                    turno = TURNO.LIBRE;
                }
            }

            /* trabajador A recibe devolución */
            if (s.from === nombre) {

                const recibido =
                    turnoDesdeCodigoSwap(
                        s.turnoDevuelto
                    );

                turno =
                    fusionarTurnos(turno, recibido);
            }
        }
    }

    if (includeReplacements) {
        turno = fusionarTurnos(
            turno,
            getReplacementTurnForWorker(nombre, key)
        );
    }

    return turno;
}

/* ======================================================
   SIGUIENTE TURNO (click manual calendario)
====================================================== */

export function siguienteTurno(actual, isHab = true) {

    actual = Number(actual) || TURNO.LIBRE;

    if (!isHab) {
        switch (actual) {
            case TURNO.LIBRE: return TURNO.LARGA;
            case TURNO.LARGA: return TURNO.NOCHE;
            case TURNO.NOCHE: return TURNO.TURNO24;
            case TURNO.TURNO24: return TURNO.LIBRE;
            case TURNO.TURNO18: return TURNO.LIBRE;
            default: return TURNO.LIBRE;
        }
    }

    /* En dias habiles tambien se permite Diurno y D+N. */
    switch (actual) {
        case TURNO.LIBRE: return TURNO.LARGA;
        case TURNO.LARGA: return TURNO.NOCHE;
        case TURNO.NOCHE: return TURNO.TURNO24;
        case TURNO.TURNO24: return TURNO.DIURNO;
        case TURNO.DIURNO: return TURNO.DIURNO_NOCHE;
        case TURNO.DIURNO_NOCHE: return TURNO.LIBRE;
        case TURNO.TURNO18: return TURNO.LIBRE;
        default: return TURNO.LIBRE;
    }
}



/* ======================================================
   TURNO REAL DEL TRABAJADOR EN FECHA
====================================================== */


export function getTurnoReal(nombre, key) {

    const data = getProfileData(nombre);

    const turnoBase = Number(data[key]) || 0;

    return aplicarCambiosTurno(
        nombre,
        key,
        turnoBase
    );
}

function estadoTurno(nombre, key) {
    const data = getProfileData(nombre);

    return aplicarCambiosTurno(
        nombre,
        key,
        Number(data[key]) || TURNO.LIBRE
    );
}

export function turnoBloqueadoPorTurno24(nombre, key, turno) {
    const candidate = Number(turno) || TURNO.LIBRE;

    if (!nombre || !candidate) return false;

    const config = getTurnChangeConfig();

    if (
        !config.allowTwentyFourHourShifts &&
        candidate === TURNO.TURNO24
    ) {
        return true;
    }

    const anterior = estadoTurno(nombre, offsetKey(key, -1));
    const siguiente = estadoTurno(nombre, offsetKey(key, 1));

    if (candidate === TURNO.TURNO24) {
        if (
            [
                TURNO.LARGA,
                TURNO.TURNO24,
                TURNO.DIURNO,
                TURNO.DIURNO_NOCHE
            ].includes(siguiente)
        ) {
            return true;
        }

        if (
            [
                TURNO.NOCHE,
                TURNO.TURNO24,
                TURNO.DIURNO_NOCHE
            ].includes(anterior)
        ) {
            return true;
        }
    }

    if (
        siguiente === TURNO.TURNO24 &&
        (
            candidate === TURNO.NOCHE ||
            candidate === TURNO.TURNO24 ||
            candidate === TURNO.DIURNO_NOCHE
        )
    ) {
        return true;
    }

    if (
        anterior === TURNO.TURNO24 &&
        (
            candidate === TURNO.LARGA ||
            candidate === TURNO.TURNO24 ||
            candidate === TURNO.DIURNO ||
            candidate === TURNO.DIURNO_NOCHE
        )
    ) {
        return true;
    }

    return false;
}

function turnoBloqueadoPorTurno24Invertido(nombre, key, turno) {
    const candidate = Number(turno) || TURNO.LIBRE;
    const config = getTurnChangeConfig();

    if (
        !nombre ||
        !candidate ||
        config.allowInvertedTwentyFourHourShifts
    ) {
        return false;
    }

    const anterior = estadoTurno(nombre, offsetKey(key, -1));
    const siguiente = estadoTurno(nombre, offsetKey(key, 1));

    return (
        (
            includesLarga(candidate) &&
            includesNoche(anterior)
        ) ||
        (
            includesNoche(candidate) &&
            includesLarga(siguiente)
        )
    );
}

function allowedTurnsForBase(baseTurno, isHab) {
    const base = Number(baseTurno) || TURNO.LIBRE;

    if (base === TURNO.LARGA) {
        return [
            TURNO.LARGA,
            TURNO.TURNO24
        ];
    }

    if (base === TURNO.NOCHE) {
        return [
            TURNO.NOCHE,
            TURNO.TURNO24,
            ...(isHab ? [TURNO.DIURNO_NOCHE] : [])
        ];
    }

    return null;
}

function siguienteEnLista(actual, turnos) {
    const disponibles = Array.from(
        new Set(
            (turnos || [])
                .map(turno => Number(turno) || TURNO.LIBRE)
        )
    );

    if (!disponibles.length) return TURNO.LIBRE;

    const index = disponibles.indexOf(
        Number(actual) || TURNO.LIBRE
    );

    if (index < 0) return disponibles[0];

    return disponibles[(index + 1) % disponibles.length];
}

export function siguienteTurnoValido(
    nombre,
    key,
    actual,
    isHab = true,
    options = {}
) {
    const inicial = Number(actual) || TURNO.LIBRE;
    const visitados = new Set();
    const baseTurno =
        Number(options.baseTurno) || TURNO.LIBRE;
    const allowedTurns =
        allowedTurnsForBase(baseTurno, isHab);
    const disallowLibre =
        Boolean(options.disallowLibre) ||
        baseTurno > TURNO.LIBRE;
    const nextCandidate = turno =>
        allowedTurns
            ? siguienteEnLista(turno, allowedTurns)
            : siguienteTurno(turno, isHab);
    let candidate = nextCandidate(inicial);
    const isBlocked = turno =>
        (
            disallowLibre &&
            Number(turno) === TURNO.LIBRE
        ) ||
        turnoBloqueadoPorTurno24(nombre, key, turno) ||
        turnoBloqueadoPorTurno24Invertido(nombre, key, turno);

    while (
        candidate !== inicial &&
        !visitados.has(candidate) &&
        isBlocked(candidate)
    ) {
        visitados.add(candidate);
        candidate = nextCandidate(candidate);
    }

    return candidate;
}

export function getTurnoBase(nombre, key) {
    const baseData = getBaseProfileData(nombre);
    const hasBaseData =
        Object.keys(baseData).length > 0;

    if (Object.prototype.hasOwnProperty.call(baseData, key)) {
        return Number(baseData[key]) || TURNO.LIBRE;
    }

    if (hasBaseData) {
        return TURNO.LIBRE;
    }

    const blocked = getJSON("blocked_" + nombre, {});

    if (!blocked[key]) return TURNO.LIBRE;

    const data = getProfileData(nombre);

    return Number(data[key]) || TURNO.LIBRE;
}
