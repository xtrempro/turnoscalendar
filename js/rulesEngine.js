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
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
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
        return normalizeText(absence).replace(/\s+/g, "_");
    }

    return normalizeText(
        absence.type ||
        absence.kind ||
        absence.code ||
        absence.label ||
        ""
    ).replace(/\s+/g, "_");
}

function isMedicalAbsenceType(type) {
    return (
        type === "license" ||
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

function parseKey(keyDay) {
    const parts = String(keyDay || "").split("-");

    return new Date(
        Number(parts[0]),
        Number(parts[1]),
        Number(parts[2])
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

export function puedeIniciarLegal(
    keyDay,
    isHab,
    admin,
    legal,
    comp,
    absences
) {
    if (!isHab) {
        return false;
    }

    if (admin[keyDay] || legal[keyDay] || comp[keyDay]) {
        return false;
    }

    if (
        absences[keyDay] &&
        !esAusenciaInjustificada(absences[keyDay])
    ) {
        return false;
    }

    return true;
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

export function puedeIniciarCompensatorio(
    keyDay,
    isHab,
    admin,
    legal,
    comp,
    absences
) {
    return (
        isHab &&
        !bloqueaCompensatorioPorLegal(keyDay, legal) &&
        !tieneBloqueoCompensatorio(
            keyDay,
            admin,
            legal,
            comp,
            absences
        )
    );
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

    let usados = 0;
    let guard = 0;
    const cursor = new Date(start);

    while (usados < total && guard < 370) {
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
    aplicarClaseTurnoFn
) {
    if (isWeekend) {
        div.classList.add("weekend");
    }

    if (isHoliday) {
        div.classList.add("holiday");
    }

    aplicarClaseTurnoFn(div, state);

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
        admin[keyDay] === "0.5M" ||
        admin[keyDay] === "0.5T" ||
        admin[keyDay] === 0.5
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
        return hasHourReturn || !puedeIniciarLegal(
            keyDay,
            isHab,
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
