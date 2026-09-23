import { isoFromKey } from "./dateUtils.js";
import { stripAccents } from "./stringUtils.js";
// js/turnEngine.js

import { TURNO } from "./constants.js";

import {
    getSwaps,
    getProfileData,
    getBaseProfileData,
    getTurnChangeConfig,
    getRotativa
} from "./storage.js";
import { getJSON } from "./persistence.js";
import { getCachedHolidays } from "./holidays.js";
import { cambioEstaAnulado } from "./swaps.js";
import { getReplacementTurnForWorker } from "./replacements.js";
import {
    getTurnoExtraAgregado,
    restarTurnoCubierto,
    turnoExtraCubreTurno
} from "./rulesEngine.js";
import {
    getContractForDate,
    getDiurnoBridgeContractForProfile,
    getReplacementBridgeProfileForDate,
    getReplacementRotationModeForDate,
    getReplacedProfileForDate,
    hasContractForDate,
    hasHonorariaContractForDate,
    isHonorariaProfile,
    isReplacementProfile
} from "./contracts.js";
import { REPLACEMENT_ROTATION_MODE } from "./replacementRotation.js";

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

function parseKeyDate(key) {
    const parts = String(key || "").split("-").map(Number);

    if (parts.length !== 3 || !parts.every(Number.isFinite)) {
        return null;
    }

    const date = new Date(parts[0], parts[1], parts[2]);

    return Number.isNaN(date.getTime()) ? null : date;
}

function parseISODate(value) {
    const source = String(value || "").trim();
    const parts = source.split("-").map(Number);

    if (parts.length === 3 && parts.every(Number.isFinite)) {
        const date = new Date(parts[0], parts[1] - 1, parts[2]);

        return Number.isNaN(date.getTime()) ? null : date;
    }

    const fallback = new Date(source);

    if (Number.isNaN(fallback.getTime())) return null;

    return new Date(
        fallback.getFullYear(),
        fallback.getMonth(),
        fallback.getDate()
    );
}

function normalizeFirstTurn(value) {
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
    const startUTC = Date.UTC(
        start.getFullYear(),
        start.getMonth(),
        start.getDate()
    );
    const dateUTC = Date.UTC(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );

    return Math.floor((dateUTC - startUTC) / msPerDay);
}

function isBusinessDaySync(date, key) {
    const day = date.getDay();

    if (day === 0 || day === 6) return false;

    return !getCachedHolidays(date.getFullYear())[key];
}

function rotativaTurnoBase(nombre, key, visited = new Set()) {
    if (visited.has(nombre)) return TURNO.LIBRE;

    visited.add(nombre);

    const bridgeContract = getDiurnoBridgeContractForProfile(
        nombre,
        key
    );

    if (bridgeContract?.replaces) {
        return resolveTurnoBase(
            bridgeContract.replaces,
            key,
            visited
        );
    }

    if (isReplacementProfile(nombre, key)) {
        const replacementContract = getContractForDate(nombre, key);

        if (replacementContract?.excludedDates?.includes(isoFromKey(key))) {
            return TURNO.LIBRE;
        }

        const rotationMode =
            getReplacementRotationModeForDate(nombre, key);

        if (rotationMode === REPLACEMENT_ROTATION_MODE.FREE) {
            return TURNO.LIBRE;
        }

        if (
            rotationMode ===
            REPLACEMENT_ROTATION_MODE.DIURNO_BRIDGE
        ) {
            const date = parseKeyDate(key);

            if (!getReplacementBridgeProfileForDate(nombre, key)) {
                return TURNO.LIBRE;
            }

            return date && isBusinessDaySync(date, key)
                ? TURNO.DIURNO
                : TURNO.LIBRE;
        }

        const replacedProfile =
            getReplacedProfileForDate(nombre, key);

        // Hereda el turno base EFECTIVO del reemplazado (resolveTurnoBase), no
        // solo su rotativa calculada: si sus turnos vienen de baseData_ o del
        // respaldo por dia bloqueado, antes se heredaba LIBRE y el reemplazante
        // se quedaba sin turnos.
        return replacedProfile
            ? resolveTurnoBase(replacedProfile, key, visited)
            : TURNO.LIBRE;
    }

    if (getRotativa(nombre).type === "libre") {
        return TURNO.LIBRE;
    }

    // Honorarios: los turnos se guardan EXPLICITAMENTE (baseData_) al aplicar la
    // rotativa desde la fecha elegida hasta el fin del contrato. El motor NO computa
    // una secuencia para honorarios: hacerlo con un ancla global mezclaria la
    // rotativa nueva con la anterior en los dias que quedan sin turno guardado. Un
    // dia del contrato sin turno guardado queda libre; fuera del contrato tambien
    // (lo enmascaran resolveTurnoBase/getTurnoProgramado).
    if (isHonorariaProfile(nombre, key)) {
        return TURNO.LIBRE;
    }

    const rotativa = getRotativa(nombre);
    const date = parseKeyDate(key);
    const start = parseISODate(rotativa.start);

    if (!date || !start || date < start) return TURNO.LIBRE;

    if (rotativa.type === "diurno") {
        return isBusinessDaySync(date, key)
            ? TURNO.DIURNO
            : TURNO.LIBRE;
    }

    const sequence = rotationSequence(
        rotativa.type,
        rotativa.firstTurn
    );

    if (!sequence.length) return TURNO.LIBRE;

    return sequence[dayDifference(start, date) % sequence.length] ||
        TURNO.LIBRE;
}

function turnoDesdeCodigoSwap(valor) {

    if (valor === "N") return TURNO.NOCHE;
    if (valor === "D") return TURNO.DIURNO;

    return TURNO.LARGA;
}

function includesDaytimeStart(turno) {
    const value = Number(turno) || TURNO.LIBRE;

    return (
        value === TURNO.LARGA ||
        value === TURNO.TURNO24 ||
        value === TURNO.DIURNO ||
        value === TURNO.DIURNO_NOCHE
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
    const hasReplacementTurnOverride =
        Object.prototype.hasOwnProperty.call(options, "replacementTurn");
    let replacementTurn = hasReplacementTurnOverride
        ? Number(options.replacementTurn) || TURNO.LIBRE
        : TURNO.LIBRE;
    let replacementTurnLoaded = hasReplacementTurnOverride;
    const resolveReplacementTurn = () => {
        if (!replacementTurnLoaded) {
            replacementTurn = getReplacementTurnForWorker(nombre, key);
            replacementTurnLoaded = true;
        }

        return replacementTurn;
    };
    const entregaExtraSinAlterarBaseDiurno = entregado => {
        if (
            turno !== TURNO.DIURNO ||
            !turnoExtraCubreTurno(resolveReplacementTurn(), entregado)
        ) {
            return false;
        }

        replacementTurn = restarTurnoCubierto(
            replacementTurn,
            entregado
        );

        return true;
    };
    // Un trabajador de rotativa Diurno puede tener una Larga por extension de
    // horario: a diferencia del caso de arriba, ese extra NO viene de un
    // reemplazo sino de un override en `data_`, asi que llega aqui dentro del
    // propio `turno`. Al entregarlo vuelve a su Diurno base, no a Libre: ese
    // dia igual viene a trabajar, solo deja de hacer la extension.
    const entregaLargaSobreBaseDiurno = entregado => {
        if (
            entregado !== TURNO.LARGA ||
            turno !== TURNO.LARGA ||
            getRotativa(nombre).type !== "diurno" ||
            getTurnoBase(nombre, key) !== TURNO.DIURNO
        ) {
            return false;
        }

        turno = TURNO.DIURNO;

        return true;
    };
    const entregaSinQuedarLibre = entregado =>
        entregaExtraSinAlterarBaseDiurno(entregado) ||
        entregaLargaSobreBaseDiurno(entregado);

    const swaps = Array.isArray(options.swaps)
        ? options.swaps
        : getSwaps();

    const fechaISO = options.isoDate || isoFromKey(key);

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
                const entregado =
                    turnoDesdeCodigoSwap(s.turno);

                if (!entregaSinQuedarLibre(entregado)) {
                    turno = TURNO.LIBRE;
                }
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

                if (entregaSinQuedarLibre(devuelve)) {
                    continue;
                }

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
            resolveReplacementTurn()
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
    return aplicarCambiosTurno(
        nombre,
        key,
        getTurnoProgramado(nombre, key)
    );
}

function estadoTurno(nombre, key) {
    return aplicarCambiosTurno(
        nombre,
        key,
        getTurnoProgramado(nombre, key)
    );
}

function motivoTurno24(nombre, key, turno) {
    const candidate = Number(turno) || TURNO.LIBRE;

    if (!nombre || !candidate) return "";

    const config = getTurnChangeConfig();

    if (
        !config.allowTwentyFourHourShifts &&
        candidate === TURNO.TURNO24
    ) {
        return "24";
    }

    const anterior = estadoTurno(nombre, offsetKey(key, -1));
    const siguiente = estadoTurno(nombre, offsetKey(key, 1));

    // Excepcion que la unidad habilita a proposito: un Diurno pegado al dia
    // siguiente de un 24h. Encadena 33 horas (08:00 del dia 1 a las 17:00 del
    // dia 2), por eso viene apagada. Vale SOLO para el Diurno puro: una Larga,
    // un D+N u otro 24 pegados a un 24 siguen prohibidos siempre.
    const diurnoPost24Permitido =
        config.allowDiurnoAfterTwentyFour === true;

    if (candidate === TURNO.TURNO24) {
        if (
            [
                TURNO.LARGA,
                TURNO.TURNO24,
                TURNO.DIURNO,
                TURNO.DIURNO_NOCHE
            ].includes(siguiente) &&
            !(diurnoPost24Permitido && siguiente === TURNO.DIURNO)
        ) {
            return siguiente === TURNO.DIURNO
                ? "diurno-post-24"
                : "adyacente-24-despues";
        }

        if (
            [
                TURNO.NOCHE,
                TURNO.TURNO24,
                TURNO.DIURNO_NOCHE
            ].includes(anterior)
        ) {
            return "adyacente-24-antes";
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
        return "adyacente-24-despues";
    }

    if (
        anterior === TURNO.TURNO24 &&
        (
            candidate === TURNO.LARGA ||
            candidate === TURNO.TURNO24 ||
            candidate === TURNO.DIURNO ||
            candidate === TURNO.DIURNO_NOCHE
        ) &&
        !(diurnoPost24Permitido && candidate === TURNO.DIURNO)
    ) {
        return candidate === TURNO.DIURNO
            ? "diurno-post-24"
            : "adyacente-24-antes";
    }

    return "";
}

export function turnoBloqueadoPorTurno24(nombre, key, turno) {
    return motivoTurno24(nombre, key, turno) !== "";
}

/**
 * Por que lado choca el 24 invertido: "" si no choca.
 *
 * Devuelve el LADO porque quien lo explica necesita decirlo. Un aviso que dice
 * "no se puede" sin decir contra que turno choca no deja al supervisor decidir
 * nada -y si ademas nombra la regla equivocada, le hace dudar de un ajuste que
 * tenia bien puesto (paso el 2026-09-22)-.
 */
function motivoTurno24Invertido(nombre, key, turno) {
    const candidate = Number(turno) || TURNO.LIBRE;
    const config = getTurnChangeConfig();

    if (
        !nombre ||
        !candidate ||
        config.allowInvertedTwentyFourHourShifts
    ) {
        return "";
    }

    if (
        includesDaytimeStart(candidate) &&
        includesNoche(estadoTurno(nombre, offsetKey(key, -1)))
    ) {
        return "invertido-antes";
    }

    if (
        includesNoche(candidate) &&
        includesDaytimeStart(estadoTurno(nombre, offsetKey(key, 1)))
    ) {
        return "invertido-despues";
    }

    return "";
}

function turnoBloqueadoPorTurno24Invertido(nombre, key, turno) {
    return motivoTurno24Invertido(nombre, key, turno) !== "";
}

/**
 * ¿La unidad prohibe este turno ese dia por las reglas del 24?
 *
 * Son DOS reglas distintas y hay que consultar las dos:
 *
 *   - `turnoBloqueadoPorTurno24`: el 24 de un dia, y lo que no puede ir pegado
 *     a un 24 el dia antes o el siguiente.
 *   - `turnoBloqueadoPorTurno24Invertido`: Noche y, a la manana siguiente, algo
 *     que empieza de dia. Cruza DOS dias, y es la que se activa o desactiva con
 *     "Permitir turnos de 24 horas invertidos".
 *
 * Existe porque exportar solo la primera dejo pasar un defecto el 2026-09-22: el
 * cuadro de contrato de reemplazo heredaba turnos que la unidad tenia
 * prohibidos, porque consultaba una regla y no la otra. Quien pregunte desde
 * fuera pregunta por las dos o por ninguna.
 */
export function motivoBloqueoReglas24(nombre, key, turno) {
    const motivo24 = motivoTurno24(nombre, key, turno);
    if (motivo24) return motivo24;

    return motivoTurno24Invertido(nombre, key, turno);
}

export function turnoBloqueadoPorReglas24(nombre, key, turno) {
    return motivoBloqueoReglas24(nombre, key, turno) !== "";
}

// `allowLibre` agrega el dia VACIO al final del ciclo, para que el ultimo click
// vuelva al turno inicial (Larga -> 24h -> vacio -> Larga). Solo lo usa la
// edicion directa de un trabajador a honorarios, donde la jornada se pacta dia a
// dia y hay que poder dejar el dia sin turno.
function allowedTurnsForBase(baseTurno, isHab, allowLibre = false) {
    const turns = baseAllowedTurns(baseTurno, isHab);

    if (!turns || !allowLibre || turns.includes(TURNO.LIBRE)) {
        return turns;
    }

    return [...turns, TURNO.LIBRE];
}

function baseAllowedTurns(baseTurno, isHab) {
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

    if (base === TURNO.DIURNO) {
        // El diurno puede extender su jornada a Larga (hasta las 20:00): la
        // edicion directa cicla Diurno -> Larga -> D+N. Larga suma las horas
        // diurnas extra sobre el diurno (3 de lunes a jueves, 4 los viernes).
        //
        // El 24 completo entra al ciclo solo con "Permitir agregar turno diurno
        // post 24h" puesto. Sin el, un dia de base Diurno no llegaba nunca a
        // 24h por mas clicks que se dieran, y la excepcion de adyacencia no
        // servia de nada para un trabajador de rotativa Diurno: es justo el que
        // hace el 24 y al dia siguiente vuelve a su Diurno. Va al final, que es
        // el orden por duracion (Diurno 9h -> Larga 12h -> D+N ~21h -> 24h).
        return [
            TURNO.DIURNO,
            TURNO.LARGA,
            ...(isHab ? [TURNO.DIURNO_NOCHE] : []),
            ...(
                getTurnChangeConfig().allowDiurnoAfterTwentyFour === true
                    ? [TURNO.TURNO24]
                    : []
            )
        ];
    }

    if (
        base === TURNO.TURNO24 ||
        base === TURNO.DIURNO_NOCHE
    ) {
        return [base];
    }

    if (base === TURNO.TURNO18) {
        return [
            TURNO.TURNO18,
            TURNO.TURNO24
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
    const allowLibre = options.allowLibre === true;
    const allowedTurns =
        allowedTurnsForBase(baseTurno, isHab, allowLibre);
    // Con un turno base el vacio queda fuera del ciclo (el turno de la rotativa
    // no se borra desde el calendario). `allowLibre` levanta esa proteccion.
    const disallowLibre =
        !allowLibre &&
        (
            Boolean(options.disallowLibre) ||
            baseTurno > TURNO.LIBRE
        );
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
        turnoBloqueadoPorReglas24(nombre, key, turno);

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

export function getProtectedDirectEditTurn(
    nombre,
    key,
    actual,
    isHab = true,
    options = {}
) {
    const effectiveBaseTurn =
        Number(options.effectiveBaseTurn) || TURNO.LIBRE;
    const hasReplacementTurnOverride =
        Object.prototype.hasOwnProperty.call(options, "replacementTurn");
    const replacementTurn = hasReplacementTurnOverride
        ? Number(options.replacementTurn) || TURNO.LIBRE
        : getReplacementTurnForWorker(nombre, key);
    const protectedBaseTurn = replacementTurn
        ? fusionarTurnos(effectiveBaseTurn, replacementTurn)
        : effectiveBaseTurn;
    // A honorarios la jornada se pacta dia a dia, asi que la edicion directa
    // tiene que poder dejar el dia VACIO y volver al turno inicial en el
    // siguiente click. Con un reemplazo asignado se mantiene la proteccion: ese
    // turno no se borra desde el calendario, se anula desde su propio cuadro.
    const allowLibre = options.allowLibre === true ||
        (
            !replacementTurn &&
            (
                isHonorariaProfile(nombre, key) ||
                isReplacementProfile(nombre, key)
            )
        );
    const nextVisibleTurn = siguienteTurnoValido(
        nombre,
        key,
        actual,
        isHab,
        {
            ...options,
            allowLibre,
            baseTurno: protectedBaseTurn
        }
    );
    const complementTurn = replacementTurn
        ? restarTurnoCubierto(nextVisibleTurn, replacementTurn)
        : TURNO.LIBRE;
    const nextStoredTurn = replacementTurn
        ? fusionarTurnos(effectiveBaseTurn, complementTurn)
        : nextVisibleTurn;

    return {
        replacementTurn,
        protectedBaseTurn,
        nextVisibleTurn,
        nextStoredTurn,
        complementTurn
    };
}

// Turnos que admite un dia SIN turno base. El ciclo de la edicion directa los
// recorre con siguienteTurno, que en dia no habil no ofrece Diurno ni D+N; aca
// se listan para poder preguntar por uno suelto sin recorrer el ciclo entero.
function freeDayAllowedTurns(isHab) {
    return isHab
        ? [
            TURNO.LARGA,
            TURNO.NOCHE,
            TURNO.TURNO24,
            TURNO.DIURNO,
            TURNO.DIURNO_NOCHE
        ]
        : [
            TURNO.LARGA,
            TURNO.NOCHE,
            TURNO.TURNO24
        ];
}

// La parte DIURNA de un turno (Diurno, Larga, la mitad de un D+N o de un 24h).
// Se saca quitandole la noche: lo que queda es lo que ocupa el dia.
function parteDiurna(turno) {
    return restarTurnoCubierto(turno, TURNO.NOCHE);
}

/**
 * Desde que turno se suma el elegido.
 *
 * Casi siempre es el turno que ya tiene el dia, y la suma manda: un Diurno sobre
 * una Noche deja D+N. La excepcion son DOS turnos diurnos: Diurno y Larga
 * ocupan el mismo hueco del dia, asi que no se suman, se reemplazan. Y solo se
 * reemplaza lo puesto A MANO: si la Larga viene de la rotativa del trabajador,
 * el turno base no se toca desde el calendario -eso es lo que protege la
 * edicion directa- y el boton simplemente no hara nada.
 *
 * Ejemplos:
 *   base Libre + Larga a mano, se aprieta Diurno -> parte de Libre  -> Diurno
 *   base Noche + Diurno a mano, se aprieta Larga -> parte de Noche  -> 24h
 *   base Libre + Larga a mano, se aprieta Noche  -> parte de Larga  -> 24h
 *   base Diurno (rotativa),    se aprieta Larga  -> parte de Diurno -> Larga
 */
function addTurnStartingPoint(baseTurno, actual, elegido) {
    const estado = Number(actual) || TURNO.LIBRE;

    if (!parteDiurna(elegido)) return estado;

    const extraDiurnoManual = parteDiurna(
        getTurnoExtraAgregado(baseTurno, estado)
    );

    if (!extraDiurnoManual) return estado;

    return restarTurnoCubierto(estado, extraDiurnoManual);
}

/**
 * Turno que queda al AGREGAR uno elegido sobre lo que el dia ya tiene.
 *
 * Es el gemelo de getProtectedDirectEditTurn para los botones de turno del menu
 * Turnos. La diferencia esta en quien decide: en la edicion directa el click
 * CICLA por los turnos posibles, y aca el supervisor ya eligio cual quiere, asi
 * que el dia lo suma a lo que hubiera (Noche + Diurno = D+N, Larga + Noche =
 * 24h). Ninguna regla nueva: la suma la hace fusionarTurnos y el resultado tiene
 * que caer entre los turnos que admite el turno base del dia, que es exactamente
 * lo que limita al ciclo.
 *
 * `allowed` es lo que decide si la casilla se ilumina. Da false cuando el turno
 * elegido no aporta nada (ya esta puesto, o el dia esta cerrado en 24h/D+N),
 * cuando la suma no cabe en ese dia (un D+N en fin de semana) o cuando la
 * bloquean las reglas del 24h y su version invertida.
 */
export function getAddTurnResult(
    nombre,
    key,
    turnoElegido,
    isHab = true,
    options = {}
) {
    const elegido = Number(turnoElegido) || TURNO.LIBRE;
    const actual = Number(options.actualState) || TURNO.LIBRE;
    const effectiveBaseTurn =
        Number(options.effectiveBaseTurn) || TURNO.LIBRE;
    const hasReplacementTurnOverride =
        Object.prototype.hasOwnProperty.call(options, "replacementTurn");
    const replacementTurn = hasReplacementTurnOverride
        ? Number(options.replacementTurn) || TURNO.LIBRE
        : getReplacementTurnForWorker(nombre, key);
    const protectedBaseTurn = replacementTurn
        ? fusionarTurnos(effectiveBaseTurn, replacementTurn)
        : effectiveBaseTurn;
    const nextVisibleTurn = fusionarTurnos(
        addTurnStartingPoint(protectedBaseTurn, actual, elegido),
        elegido
    );
    const allowedTurns =
        allowedTurnsForBase(protectedBaseTurn, isHab) ||
        freeDayAllowedTurns(isHab);
    const allowed =
        elegido !== TURNO.LIBRE &&
        Number(nextVisibleTurn) !== Number(actual) &&
        allowedTurns.includes(nextVisibleTurn) &&
        !turnoBloqueadoPorTurno24(nombre, key, nextVisibleTurn) &&
        !turnoBloqueadoPorTurno24Invertido(nombre, key, nextVisibleTurn);
    // Con un reemplazo asignado se guarda solo la parte que NO cubre el
    // reemplazante, igual que en la edicion directa: su turno no se toca desde
    // el calendario.
    const complementTurn = replacementTurn
        ? restarTurnoCubierto(nextVisibleTurn, replacementTurn)
        : TURNO.LIBRE;
    const nextStoredTurn = replacementTurn
        ? fusionarTurnos(effectiveBaseTurn, complementTurn)
        : nextVisibleTurn;

    return {
        allowed,
        replacementTurn,
        protectedBaseTurn,
        nextVisibleTurn,
        nextStoredTurn,
        complementTurn
    };
}

// Turno base EFECTIVO de un trabajador: turnos base asignados (baseData_), si no
// la rotativa calculada, y si no el respaldo por dia bloqueado. `visited` arrastra
// el guard de ciclos para poder resolver cadenas de reemplazo sin recursion
// infinita (un reemplazo hereda de su reemplazado, que puede ser otro reemplazo).
function resolveTurnoBase(nombre, key, visited) {
    if (isReplacementProfile(nombre, key)) {
        return rotativaTurnoBase(nombre, key, visited);
    }

    if (
        isHonorariaProfile(nombre, key) &&
        !hasHonorariaContractForDate(nombre, key)
    ) {
        return TURNO.LIBRE;
    }

    if (getRotativa(nombre).type === "libre") {
        return TURNO.LIBRE;
    }

    const baseData = getBaseProfileData(nombre);
    const hasBaseData =
        Object.keys(baseData).length > 0;

    if (Object.prototype.hasOwnProperty.call(baseData, key)) {
        return Number(baseData[key]) || TURNO.LIBRE;
    }

    const computedBase = rotativaTurnoBase(nombre, key, visited);

    if (computedBase) {
        return computedBase;
    }

    if (hasBaseData) {
        return TURNO.LIBRE;
    }

    const blocked = getJSON("blocked_" + nombre, {});

    if (!blocked[key]) return TURNO.LIBRE;

    const data = getProfileData(nombre);

    return Number(data[key]) || TURNO.LIBRE;
}

export function getTurnoBase(nombre, key) {
    return resolveTurnoBase(nombre, key, new Set());
}

export function getTurnoProgramado(nombre, key) {
    if (
        isHonorariaProfile(nombre, key) &&
        !hasHonorariaContractForDate(nombre, key)
    ) {
        return TURNO.LIBRE;
    }

    const data = getProfileData(nombre);

    if (Object.prototype.hasOwnProperty.call(data, key)) {
        return Number(data[key]) || TURNO.LIBRE;
    }

    return getTurnoBase(nombre, key);
}

// Un dia cuenta como jornada del trabajador (para horas habiles y horas
// trabajadas) cuando: no es reemplazo (siempre cuenta), o es reemplazo con
// contrato vigente ese dia, o es reemplazo al que el supervisor le registro un
// turno en el calendario fuera del contrato vigente. Fuera del contrato la base
// del reemplazo es LIBRE, asi que un turno programado != LIBRE implica una
// asignacion explicita del supervisor. Compartido por hoursEngine (base habil +
// horas trabajadas) y hoursReport para no duplicar el criterio.
export function includesWorkDay(nombre, key) {
    if (!isReplacementProfile(nombre, key)) return true;
    if (hasContractForDate(nombre, key)) return true;

    return getTurnoProgramado(nombre, key) !== TURNO.LIBRE;
}
