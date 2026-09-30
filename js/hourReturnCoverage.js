// Cobertura de las devoluciones de tiempo.
//
// Con la opcion encendida (Ajustes > Reemplazos: "Cubrir las devoluciones de
// tiempo"), el turno del que alguien devuelve horas pide cobertura por ESAS
// horas: el calendario y el timeline muestran el "!" y el cuadro de sugerencias
// busca a quien las cubra. Quien cubre queda como un reemplazo del trabajador
// con el tramo estampado (coverFrom/coverUntil), el mismo registro que el
// reparto de un turno entre dos (js/shiftCoverage.js).
//
// Una devolucion parcial deja al trabajador entrar mas tarde o salir antes: lo
// que devuelve es el trozo del turno entre su horario y la nueva hora. Una
// devolucion completa devuelve el tramo entero.

import { getReplacementRequestConfig, isNoCoverageDay } from "./storage.js";
import { getHourReturn } from "./hourReturns.js";
import { coverageGapsForShift, normalizeCoverTime } from "./shiftCoverage.js";
import { getActiveReplacementsForCoveredShift } from "./replacements.js";

export function hourReturnCoverageEnabled() {
    return getReplacementRequestConfig().allowHourReturnCoverage === true;
}

/** Los tramos que el trabajador devuelve: [{from, until}] en "HH:MM". */
export function hourReturnWindows(record) {
    const start = normalizeCoverTime(record?.scheduledStart);
    const end = normalizeCoverTime(record?.scheduledEnd);

    if (!start || !end) return [];
    if (record.fullTurn) return [{ from: start, until: end }];

    const entry = normalizeCoverTime(record.entryTime);
    const exit = normalizeCoverTime(record.exitTime);
    const windows = [];

    // Entra mas tarde: devuelve desde el inicio hasta su nueva entrada.
    if (entry && entry !== start) windows.push({ from: start, until: entry });
    // Sale antes: devuelve desde su nueva salida hasta el fin.
    if (exit && exit !== end) windows.push({ from: exit, until: end });

    return windows;
}

/**
 * ¿Queda algo de la devolucion sin cubrir? Devuelve el primer tramo sin nadie
 * ({ coverWindow, shiftWindow, record }) o null. null tambien si la opcion esta
 * apagada, si no hay devolucion o si el dia se marco "No requiere cobertura".
 */
export function hourReturnPendingCoverage(profile, keyDay) {
    if (!profile || !keyDay || !hourReturnCoverageEnabled()) return null;

    const record = getHourReturn(profile, keyDay);

    if (!record || isNoCoverageDay(profile, keyDay)) return null;

    const records = getActiveReplacementsForCoveredShift(profile, keyDay);

    for (const window of hourReturnWindows(record)) {
        const gaps = coverageGapsForShift(window, records);

        if (gaps.length) {
            return {
                coverWindow: gaps[0],
                shiftWindow: {
                    from: normalizeCoverTime(record.scheduledStart),
                    until: normalizeCoverTime(record.scheduledEnd)
                },
                record
            };
        }
    }

    return null;
}
