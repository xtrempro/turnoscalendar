import { keyToDate as parseKey } from "./dateUtils.js";
import { stripAccents } from "./stringUtils.js";
// js/rulesEngine.js

/* ======================================================
   RULES ENGINE
   Centraliza ausencias, bloqueos y etiquetas especiales
   SIN romper funcionalidades actuales
====================================================== */

import { MODO, TURNO } from "./constants.js";
import { isBusinessDay } from "./calculations.js";

/* ======================================================
   HELPERS
====================================================== */

export function tieneAusencia(
    keyDay,
    admin,
    legal,
    comp,
    absences
) {
    return (
        admin[keyDay] ||
        legal[keyDay] ||
        comp[keyDay] ||
        absences[keyDay]
    );
}

export function requiereReemplazoTurnoBase(
    keyDay,
    baseState,
    admin,
    legal,
    comp,
    absences
) {
    return (
        Number(baseState) > TURNO.LIBRE &&
        Boolean(
            tieneAusencia(
                keyDay,
                admin,
                legal,
                comp,
                absences
            )
        )
    );
}

export function getTurnoExtraAgregado(baseState, actualState) {
    const base = Number(baseState) || TURNO.LIBRE;
    const actual = Number(actualState) || TURNO.LIBRE;

    if (base === actual) return TURNO.LIBRE;
    if (base === TURNO.LIBRE) return actual;

    if (base === TURNO.DIURNO && actual === TURNO.LARGA) {
        return TURNO.MEDIA_TARDE;
    }

    if (base === TURNO.LARGA && actual === TURNO.TURNO24) {
        return TURNO.NOCHE;
    }

    if (base === TURNO.NOCHE && actual === TURNO.TURNO24) {
        return TURNO.LARGA;
    }

    if (base === TURNO.DIURNO && actual === TURNO.DIURNO_NOCHE) {
        return TURNO.NOCHE;
    }

    if (base === TURNO.NOCHE && actual === TURNO.DIURNO_NOCHE) {
        return TURNO.DIURNO;
    }

    if (base === TURNO.NOCHE && actual === TURNO.TURNO18) {
        return TURNO.MEDIA_TARDE;
    }

    return actual;
}

export function getTurnoComponentes(turno) {
    const state = Number(turno) || TURNO.LIBRE;

    if (state === TURNO.LARGA) return ["L"];
    if (state === TURNO.NOCHE) return ["N"];
    if (state === TURNO.DIURNO) return ["D"];
    if (state === TURNO.TURNO24) return ["L", "N"];
    if (state === TURNO.DIURNO_NOCHE) return ["D", "N"];
    if (state === TURNO.MEDIA_MANANA) return ["HM"];
    if (state === TURNO.MEDIA_TARDE) return ["HT"];
    if (state === TURNO.TURNO18) return ["HT", "N"];

    return [];
}

export function turnoDesdeComponentes(componentes) {
    const set = new Set(componentes || []);

    if (set.has("D") && set.has("N")) {
        return TURNO.DIURNO_NOCHE;
    }

    if (set.has("HM") && set.has("HT") && set.has("N")) {
        return TURNO.TURNO24;
    }

    if (set.has("HT") && set.has("N")) {
        return TURNO.TURNO18;
    }

    if (set.has("HM") && set.has("HT")) {
        return TURNO.LARGA;
    }

    if (set.has("L") && set.has("N")) {
        return TURNO.TURNO24;
    }

    if (set.has("D")) return TURNO.DIURNO;
    if (set.has("L")) return TURNO.LARGA;
    if (set.has("N")) return TURNO.NOCHE;
    if (set.has("HM")) return TURNO.MEDIA_MANANA;
    if (set.has("HT")) return TURNO.MEDIA_TARDE;

    return TURNO.LIBRE;
}

export function restarTurnoCubierto(extraState, coveredState) {
    const covered = new Set(getTurnoComponentes(coveredState));
    const pending = getTurnoComponentes(extraState)
        .filter(component => !covered.has(component));

    return turnoDesdeComponentes(pending);
}

export function turnoExtraCubreTurno(extraState, coveredState) {
    const extra = Number(extraState) || TURNO.LIBRE;
    const covered = Number(coveredState) || TURNO.LIBRE;

    if (!extra || !covered) return false;
    if (extra === covered) return true;
    if (extra === TURNO.TURNO24) {
        return (
            covered === TURNO.LARGA ||
            covered === TURNO.NOCHE ||
            covered === TURNO.TURNO24 ||
            covered === TURNO.MEDIA_MANANA ||
            covered === TURNO.MEDIA_TARDE ||
            covered === TURNO.TURNO18
        );
    }

    if (extra === TURNO.DIURNO_NOCHE) {
        return (
            covered === TURNO.DIURNO ||
            covered === TURNO.NOCHE ||
            covered === TURNO.DIURNO_NOCHE
        );
    }

    if (extra === TURNO.LARGA) {
        return (
            covered === TURNO.MEDIA_MANANA ||
            covered === TURNO.MEDIA_TARDE
        );
    }

    if (extra === TURNO.TURNO18) {
        return (
            covered === TURNO.MEDIA_TARDE ||
            covered === TURNO.NOCHE ||
            covered === TURNO.TURNO18
        );
    }

    return false;
}

function normalizeText(value) {
    return stripAccents(String(value || "")).toLowerCase();
}

function getAbsenceText(absence) {
    if (!absence) return "";

    if (typeof absence === "string") {
        return absence;
    }

    return [
        absence.type,
        absence.kind,
        absence.label,
        absence.name,
        absence.code
    ]
        .filter(Boolean)
        .join(" ");
}

export function getAbsenceType(absence) {
    if (!absence) return "";

    if (typeof absence === "string") {
        const normalized = normalizeText(absence).replace(/\s+/g, "_");

        return normalized.includes("gremial")
            ? "union_leave"
            : normalized;
    }

    const normalized = normalizeText(
        absence.type ||
        absence.kind ||
        absence.code ||
        absence.label ||
        ""
    ).replace(/\s+/g, "_");

    return normalized.includes("gremial")
        ? "union_leave"
        : normalized;
}

function isMedicalAbsenceType(type) {
    return (
        type === "license" ||
        type === "union_leave" ||
        type === "professional_license"
    );
}

export function puedeReemplazarAusencia(absence, nextType) {
    if (!absence || esAusenciaInjustificada(absence)) {
        return true;
    }

    const currentType = getAbsenceType(absence);

    if (currentType === nextType) {
        return true;
    }

    return (
        isMedicalAbsenceType(currentType) &&
        isMedicalAbsenceType(nextType)
    );
}

function diasEntre(a, b) {
    return Math.floor((a - b) / 86400000);
}

function ultimoDiaRegistradoHasta(map, keyDay) {
    const target = parseKey(keyDay);
    let ultimo = null;

    Object.keys(map || {}).forEach(key => {
        const date = parseKey(key);

        if (Number.isNaN(date.getTime())) return;
        if (date > target) return;

        if (!ultimo || date > ultimo) {
            ultimo = date;
        }
    });

    return ultimo;
}

export function esMedioAdministrativo(value) {
    return (
        value === "0.5M" ||
        value === "0.5T" ||
        value === 0.5
    );
}

export function esAusenciaInjustificada(absence) {
    const text = normalizeText(getAbsenceText(absence));

    return (
        text.includes("injustificada") ||
        text.includes("injustificado") ||
        text.includes("unjustified")
    );
}

function bloqueaAdministrativoPorAusencia(absence) {
    if (!absence) return false;

    return !esAusenciaInjustificada(absence);
}

function bloqueaCompensatorioPorAusencia(absence) {
    if (!absence) return false;

    return !esAusenciaInjustificada(absence);
}

function bloqueaLegalPorAusencia(absence) {
    if (!absence) return false;

    return !esAusenciaInjustificada(absence);
}

function getRotativaType(rotativa) {
    if (!rotativa) return "";
    if (typeof rotativa === "string") return normalizeText(rotativa);

    return normalizeText(rotativa.type || rotativa.rotativa || "");
}

export function esTurnoAdministrativoValido(state, rotativa = "") {
    const turno = Number(state) || TURNO.LIBRE;
    const rotativaType = getRotativaType(rotativa);

    if (
        rotativaType === "diurno" &&
        turno === TURNO.DIURNO
    ) {
        return true;
    }

    return (
        turno === TURNO.LARGA ||
        turno === TURNO.NOCHE
    );
}

export function puedeAplicarAdministrativo(
    keyDay,
    state,
    isHab,
    admin,
    legal,
    comp,
    absences,
    shiftAssigned,
    rotativa = ""
) {
    if (legal[keyDay] || comp[keyDay]) {
        return false;
    }

    if (admin[keyDay] && !esMedioAdministrativo(admin[keyDay])) {
        return false;
    }

    if (bloqueaAdministrativoPorAusencia(absences[keyDay])) {
        return false;
    }

    if (!esTurnoAdministrativoValido(state, rotativa)) {
        return false;
    }

    if (!shiftAssigned && !isHab) {
        return false;
    }

    return true;
}

export function puedeAplicarLegalDesde(
    keyDay,
    cantidad,
    holidays,
    admin,
    legal,
    comp,
    absences
) {
    const total = Number(cantidad);

    if (!total || total <= 0 || !Number.isInteger(total)) {
        return false;
    }

    const start = parseKey(keyDay);

    if (
        Number.isNaN(start.getTime()) ||
        !isBusinessDay(start, holidays)
    ) {
        return false;
    }

    const startYear = start.getFullYear();
    let usados = 0;
    let guard = 0;
    const cursor = new Date(start);

    while (usados < total && guard < 370) {
        if (cursor.getFullYear() !== startYear) {
            return false;
        }

        const currentKey =
            `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`;

        if (
            admin[currentKey] ||
            legal[currentKey] ||
            comp[currentKey] ||
            bloqueaLegalPorAusencia(absences[currentKey])
        ) {
            return false;
        }

        if (isBusinessDay(cursor, holidays)) {
            usados++;
        }

        cursor.setDate(cursor.getDate() + 1);
        guard++;
    }

    return usados === total;
}

export function puedeAplicarAusenciaInjustificada(
    keyDay,
    state,
    admin,
    legal,
    comp,
    absences
) {
    if (!Number(state)) {
        return false;
    }

    if (
        tieneAusencia(
            keyDay,
            admin,
            legal,
            comp,
            absences
        )
    ) {
        return false;
    }

    return true;
}

export function bloqueaCompensatorioPorLegal(keyDay, legal) {
    const ultimoLegal = ultimoDiaRegistradoHasta(legal, keyDay);

    if (!ultimoLegal) return false;

    return diasEntre(parseKey(keyDay), ultimoLegal) < 90;
}

export function tieneBloqueoCompensatorio(
    keyDay,
    admin,
    legal,
    comp,
    absences
) {
    if (admin[keyDay] || legal[keyDay] || comp[keyDay]) {
        return true;
    }

    return bloqueaCompensatorioPorAusencia(absences[keyDay]);
}

export function puedeAplicarCompensatorioDesde(
    keyDay,
    cantidad,
    holidays,
    admin,
    legal,
    comp,
    absences
) {
    const total = Number(cantidad);

    if (!total || total <= 0 || !Number.isInteger(total)) {
        return false;
    }

    const start = parseKey(keyDay);

    if (
        Number.isNaN(start.getTime()) ||
        !isBusinessDay(start, holidays)
    ) {
        return false;
    }

    if (bloqueaCompensatorioPorLegal(keyDay, legal)) {
        return false;
    }

    const startYear = start.getFullYear();
    let usados = 0;
    let guard = 0;
    const cursor = new Date(start);

    while (usados < total && guard < 370) {
        if (cursor.getFullYear() !== startYear) {
            return false;
        }

        const currentKey =
            `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`;

        if (
            tieneBloqueoCompensatorio(
                currentKey,
                admin,
                legal,
                comp,
                absences
            )
        ) {
            return false;
        }

        if (isBusinessDay(cursor, holidays)) {
            usados++;
        }

        cursor.setDate(cursor.getDate() + 1);
        guard++;
    }

    return usados === total;
}

export function puedeAplicarAusenciaBloqueanteDesde(
    keyDay,
    cantidad,
    absences,
    nextType
) {
    const total = Number(cantidad);

    if (!total || total <= 0 || !Number.isInteger(total)) {
        return false;
    }

    const start = parseKey(keyDay);

    if (Number.isNaN(start.getTime())) {
        return false;
    }

    const cursor = new Date(start);

    for (let i = 0; i < total; i++) {
        const currentKey =
            `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`;

        if (
            !puedeReemplazarAusencia(
                absences[currentKey],
                nextType
            )
        ) {
            return false;
        }

        cursor.setDate(cursor.getDate() + 1);
    }

    return true;
}

/* ======================================================
   LABEL VISUAL DEL DIA
====================================================== */

export function obtenerLabelDia(
    keyDay,
    state,
    admin,
    legal,
    comp,
    absences,
    turnoLabelFn
) {
    let label = turnoLabelFn(state);

    /* administrativos */

    if (admin[keyDay] === 1) {
        label = "ADM";
    }

    if (admin[keyDay] === "0.5M") {
        label = "1/2M";
    }

    if (admin[keyDay] === "0.5T") {
        label = "1/2T";
    }

    if (admin[keyDay] === 0.5) {
        label = "1/2";
    }

    /* feriados legales */

    if (legal[keyDay]) {
        label = "FL";
    }

    /* compensatorios */

    if (comp[keyDay]) {
        label = "FC";
    }

    /* licencia médica */

    if (absences[keyDay]) {
        const absenceType = getAbsenceType(absences[keyDay]);

        if (absenceType === "professional_license") {
            label = "LMP";
        } else if (absenceType === "union_leave") {
            label = "PG";
        } else if (absenceType === "unpaid_leave") {
            label = "PSG";
        } else if (absenceType === "license") {
            label = "LM";
        } else if (esAusenciaInjustificada(absences[keyDay])) {
            label = "AI";
        }
    }

    return label;
}

/* ======================================================
   CLASES ESPECIALES CSS
====================================================== */

// Clase de division para 1/2 ADM segun el turno base (larga/diurno) y la mitad
// (0.5M = admin arriba, 0.5T = admin abajo). Devuelve null si el base no aplica.
function halfAdminSplitClass(halfAdmin, baseTurn) {
    const baseName =
        baseTurn === TURNO.DIURNO
            ? "diurno"
            : baseTurn === TURNO.LARGA
                ? "larga"
                : null;

    if (!baseName) return null;

    const which = halfAdmin === "0.5M" ? "m" : "t";
    return `turno-split--adm-${which}-${baseName}`;
}

export function aplicarClasesEspeciales(
    div,
    keyDay,
    state,
    isHab,
    isWeekend,
    isHoliday,
    admin,
    legal,
    comp,
    absences,
    aplicarClaseTurnoFn,
    baseTurn = null,
    dayGradient = null
) {
    if (isWeekend) {
        div.classList.add("weekend");
    }

    if (isHoliday) {
        div.classList.add("holiday");
    }

    // 1/2 ADM (mañana/tarde): el dia se divide en dos colores (administrativo +
    // el turno base sobre el que se aplico, larga o diurno). Si se conoce el
    // base, se usa la clase de division; si no, se cae al color normal.
    const halfAdmin = admin[keyDay];
    const halfAdminSplit =
        (halfAdmin === "0.5M" || halfAdmin === "0.5T")
            ? halfAdminSplitClass(halfAdmin, baseTurn)
            : null;

    if (dayGradient) {
        // Bandas proporcionales (turnos combinados + extension/reduccion de
        // marcaje). Tiene prioridad sobre las clases de color.
        div.style.setProperty("background", dayGradient, "important");
        div.classList.add("turno-split");
    } else if (halfAdminSplit) {
        div.classList.add("turno-split", halfAdminSplit);
    } else {
        aplicarClaseTurnoFn(div, state);
    }

    if (
        (isWeekend || isHoliday) &&
        state > 0
    ) {
        div.classList.add(
            "inactive-selected"
        );
    }

    /* administrativos */

    if (admin[keyDay] === 1) {
        div.classList.add("admin-day");
    }

    if (
        (
            halfAdmin === "0.5M" ||
            halfAdmin === "0.5T" ||
            halfAdmin === 0.5
        ) &&
        !halfAdminSplit &&
        !dayGradient
    ) {
        div.classList.add(
            "half-admin-day"
        );
    }

    /* licencia */

    if (absences[keyDay]) {
        const absenceType = getAbsenceType(absences[keyDay]);

        if (absenceType === "professional_license") {
            div.classList.add("professional-license-day");
        } else if (absenceType === "union_leave") {
            div.classList.add("union-leave-day");
        } else if (absenceType === "unpaid_leave") {
            div.classList.add("unpaid-leave-day");
        } else if (absenceType === "license") {
            div.classList.add("license-day");
        } else if (esAusenciaInjustificada(absences[keyDay])) {
            div.classList.add("unjustified-absence-day");
        }
    }

    /* legal */

    if (legal[keyDay]) {
        div.classList.add(
            state > 0 || isHab
                ? "legal-day"
                : "legal-soft"
        );
    }

    /* compensatorio */

    if (comp[keyDay]) {
        div.classList.add(
            state > 0 || isHab
                ? "comp-day"
                : "comp-soft"
        );
    }
}

/* ======================================================
   VALIDACION MODO SELECCION
====================================================== */

/*
   Determina si, al mover un turno base Larga o Noche hacia un dia destino que
   ya tiene el turno complementario, ambos se juntan formando un 24.
   - destino Larga + complemento Noche => 24
   - destino Noche + complemento Larga => 24
   El complemento puede ser base (dos turnos base => 24 sin HHEE) o extra
   (turno base movido + turno extra => 24 con HHEE). Se exige que el destino no
   tenga cambios de turno (swaps) que alteren el turno (programado === real).
*/
export function moveShiftTargetCombina24(
    destinationTurn,
    baseTurn,
    programmedTurn,
    actualTurn
) {
    const dest = Number(destinationTurn) || TURNO.LIBRE;

    if (dest !== TURNO.LARGA && dest !== TURNO.NOCHE) {
        return false;
    }

    const complemento =
        dest === TURNO.LARGA ? TURNO.NOCHE : TURNO.LARGA;
    const base = Number(baseTurn) || TURNO.LIBRE;
    const programmed = Number(programmedTurn) || TURNO.LIBRE;
    const actual = Number(actualTurn) || TURNO.LIBRE;

    if (programmed !== complemento || actual !== complemento) {
        return false;
    }

    if (base !== TURNO.LIBRE && base !== complemento) {
        return false;
    }

    return true;
}

function moveShiftTurnIncludesDaytimeStart(turn) {
    const value = Number(turn) || TURNO.LIBRE;

    return (
        value === TURNO.LARGA ||
        value === TURNO.TURNO24 ||
        value === TURNO.DIURNO ||
        value === TURNO.DIURNO_NOCHE ||
        value === TURNO.MEDIA_MANANA ||
        value === TURNO.MEDIA_TARDE
    );
}

function moveShiftTurnIncludesNight(turn) {
    const value = Number(turn) || TURNO.LIBRE;

    return (
        value === TURNO.NOCHE ||
        value === TURNO.TURNO24 ||
        value === TURNO.DIURNO_NOCHE ||
        value === TURNO.TURNO18
    );
}

export function moveShiftCreatesInvertedTwentyFour(
    projectedTurn,
    previousTurn = TURNO.LIBRE,
    nextTurn = TURNO.LIBRE
) {
    return (
        (
            moveShiftTurnIncludesDaytimeStart(projectedTurn) &&
            moveShiftTurnIncludesNight(previousTurn)
        ) ||
        (
            moveShiftTurnIncludesNight(projectedTurn) &&
            moveShiftTurnIncludesDaytimeStart(nextTurn)
        )
    );
}

export function moveShiftConfigBlockReason({
    combines24 = false,
    projectedTurn = TURNO.LIBRE,
    previousTurn = TURNO.LIBRE,
    nextTurn = TURNO.LIBRE,
    allowTwentyFourHourShifts = true,
    allowInvertedTwentyFourHourShifts = true
} = {}) {
    if (
        combines24 &&
        allowTwentyFourHourShifts === false
    ) {
        return "La unidad tiene deshabilitada la opcion de turnos 24.";
    }

    if (
        allowInvertedTwentyFourHourShifts === false &&
        moveShiftCreatesInvertedTwentyFour(
            projectedTurn,
            previousTurn,
            nextTurn
        )
    ) {
        return "La unidad tiene deshabilitada la opcion de 24 invertido.";
    }

    return "";
}

export function estaBloqueadoModo(
    selectionMode,
    keyDay,
    state,
    isHab,
    admin,
    legal,
    comp,
    absences,
    shiftAssigned,
    options = {}
) {
    const hasHourReturn =
        Boolean(options.hourReturns?.[keyDay]);
    const hasFullHourReturn =
        Boolean(options.hourReturns?.[keyDay]?.fullTurn);
    const actualState =
        Number(options.actualState) || TURNO.LIBRE;

    if (selectionMode === "moveshiftsource") {
        const baseState = Number(state) || TURNO.LIBRE;

        return (
            (
                baseState !== TURNO.LARGA &&
                baseState !== TURNO.NOCHE
            ) ||
            actualState !== baseState ||
            hasHourReturn ||
            tieneAusencia(
                keyDay,
                admin,
                legal,
                comp,
                absences
            )
        );
    }

    if (selectionMode === "moveshifttarget") {
        const isSourceDay =
            options.moveShiftSourceKey === keyDay;

        if (isSourceDay) {
            return Boolean(
                moveShiftConfigBlockReason({
                    projectedTurn:
                        Number(options.moveShiftDestinationTurn) ||
                        TURNO.LIBRE,
                    previousTurn:
                        Number(options.moveShiftPreviousTurn) ||
                        TURNO.LIBRE,
                    nextTurn:
                        Number(options.moveShiftNextTurn) ||
                        TURNO.LIBRE,
                    allowTwentyFourHourShifts:
                        options.allowTwentyFourHourShifts !== false,
                    allowInvertedTwentyFourHourShifts:
                        options.allowInvertedTwentyFourHourShifts !== false
                })
            );
        }

        if (
            hasHourReturn ||
            tieneAusencia(
                keyDay,
                admin,
                legal,
                comp,
                absences
            )
        ) {
            return true;
        }

        const baseTurn = Number(state) || TURNO.LIBRE;
        const programmedTurn =
            Number(options.moveShiftProgrammedTurn) || TURNO.LIBRE;

        // Destino libre: comportamiento original.
        if (
            baseTurn === TURNO.LIBRE &&
            programmedTurn === TURNO.LIBRE &&
            actualState === TURNO.LIBRE
        ) {
            return false;
        }

        // Destino con turno complementario que, al juntarse con el turno que se
        // esta moviendo, forma un 24 (Larga + Noche).
        const combines24 = moveShiftTargetCombina24(
            options.moveShiftDestinationTurn,
            baseTurn,
            programmedTurn,
            actualState
        );
        const projectedTurn = combines24
            ? TURNO.TURNO24
            : Number(options.moveShiftDestinationTurn) || TURNO.LIBRE;

        if (
            moveShiftConfigBlockReason({
                combines24,
                projectedTurn,
                previousTurn:
                    Number(options.moveShiftPreviousTurn) || TURNO.LIBRE,
                nextTurn:
                    Number(options.moveShiftNextTurn) || TURNO.LIBRE,
                allowTwentyFourHourShifts:
                    options.allowTwentyFourHourShifts !== false,
                allowInvertedTwentyFourHourShifts:
                    options.allowInvertedTwentyFourHourShifts !== false
            })
        ) {
            return true;
        }

        if (combines24) {
            return false;
        }

        return true;
    }

    if (selectionMode === "halfadmin") {
        return (
            !isHab ||
            state === 0 ||
            state === 2 ||
            hasHourReturn ||
            tieneAusencia(
                keyDay,
                admin,
                legal,
                comp,
                absences
            )
        );
    }

    if (selectionMode === MODO.ADMIN) {
        return hasHourReturn || !puedeAplicarAdministrativo(
            keyDay,
            state,
            isHab,
            admin,
            legal,
            comp,
            absences,
            shiftAssigned,
            options.rotativa || ""
        );
    }

    if (selectionMode === "legal") {
        return hasHourReturn || !puedeAplicarLegalDesde(
            keyDay,
            options.legalCantidad || 0,
            options.holidays || {},
            admin,
            legal,
            comp,
            absences
        );
    }

    if (selectionMode === "comp") {
        return hasHourReturn || !puedeAplicarCompensatorioDesde(
            keyDay,
            options.compCantidad || 0,
            options.holidays || {},
            admin,
            legal,
            comp,
            absences
        );
    }

    if (selectionMode === "license") {
        return hasHourReturn || !puedeAplicarAusenciaBloqueanteDesde(
            keyDay,
            options.licenseCantidad || 0,
            absences,
            options.licenseType || "license"
        );
    }

    if (selectionMode === "unjustified") {
        return hasHourReturn || !puedeAplicarAusenciaInjustificada(
            keyDay,
            state,
            admin,
            legal,
            comp,
            absences
        );
    }

    if (selectionMode === "clockmark") {
        const hasBlockingAbsence =
            tieneAusencia(
                keyDay,
                admin,
                legal,
                comp,
                absences
            ) &&
            !esMedioAdministrativo(admin[keyDay]);

        return (
            !Number(state) ||
            hasBlockingAbsence ||
            hasFullHourReturn
        );
    }

    if (selectionMode === "hoursreturn") {
        const hasBlockingAbsence = tieneAusencia(
            keyDay,
            admin,
            legal,
            comp,
            absences
        );

        return (
            !Number(state) ||
            hasBlockingAbsence ||
            hasHourReturn
        );
    }

    return false;
}
