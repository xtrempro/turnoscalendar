// El mes de un trabajador con turnos marcados: los dias que reciben un turno
// se destacan y los que quedan libres muestran el turno que tenian. Lo usan la
// Ayuda para cubrir (js/monthlyMagic.js) y el modal de reemplazo
// (js/calendar.js), al pasar el mouse por un candidato.

import { escapeHTML } from "./htmlUtils.js";
import { TURNO, TURNO_COLOR, TURNO_LABEL } from "./constants.js";
import { getTurnoReal } from "./turnEngine.js";

function keyToDate(keyDay) {
    const [y, m, d] = String(keyDay).split("-").map(Number);

    return new Date(y, m, d);
}

function dateLabel(keyDay) {
    return keyToDate(keyDay).toLocaleDateString("es-CL", { weekday: "short", day: "numeric", month: "short" });
}

function turnLabel(turn) {
    return TURNO_LABEL[Number(turn)] || "Turno";
}

// Letra de cada turno en el calendario del trabajador.
const TURN_SHORT = { 1: "L", 2: "N", 3: "24", 4: "D", 5: "D+N", 6: "½M", 7: "½T", 8: "18" };
const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

/**
 * El mes del trabajador como quedaria con los movimientos marcados: los dias
 * que reciben un turno se destacan y los que quedan libres se marcan con el
 * turno que tenian. Se repinta al marcar o desmarcar cada movimiento.
 */
export function workerMonthHTML(name, month, moves = [], { title = "Así quedaría su mes" } = {}) {
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const days = new Date(year, monthIndex + 1, 0).getDate();
    const offset = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
    const turns = new Map();
    const arriving = new Set();
    const leaving = new Map();
    const keyOf = day => `${year}-${monthIndex}-${day}`;

    for (let day = 1; day <= days; day++) {
        turns.set(keyOf(day), Number(getTurnoReal(name, keyOf(day))) || TURNO.LIBRE);
    }

    (moves || []).forEach(move => {
        if (move.targetKey !== move.sourceKey && turns.has(move.sourceKey)) {
            leaving.set(move.sourceKey, turns.get(move.sourceKey));
            turns.set(move.sourceKey, TURNO.LIBRE);
        }
    });
    (moves || []).forEach(move => {
        if (!turns.has(move.targetKey)) return;

        turns.set(move.targetKey, Number(move.destinationTurn) || TURNO.LIBRE);
        arriving.add(move.targetKey);
        leaving.delete(move.targetKey);
    });

    const cells = Array.from({ length: offset }, () => `<span class="mcal-wcal-day is-empty"></span>`);

    for (let day = 1; day <= days; day++) {
        const key = keyOf(day);
        const turn = turns.get(key);
        const color = turn ? TURNO_COLOR[turn] || "#64748b" : "";
        const before = leaving.get(key);
        const classes = [
            "mcal-wcal-day",
            turn ? "has-turn" : "",
            arriving.has(key) ? "is-arriving" : "",
            before ? "is-leaving" : ""
        ].filter(Boolean).join(" ");

        cells.push(`
            <span class="${classes}"${color ? ` style="--wcal-color:${color}"` : ""} title="${escapeHTML(dateLabel(key))}${turn ? `: ${escapeHTML(turnLabel(turn))}` : ""}${arriving.has(key) ? " (llega con el movimiento)" : ""}${before ? ` (se mueve su ${escapeHTML(turnLabel(before))})` : ""}">
                <b>${day}</b>
                <small>${turn ? escapeHTML(TURN_SHORT[turn] || "") : before ? `<s>${escapeHTML(TURN_SHORT[before] || "")}</s>` : ""}</small>
            </span>`);
    }

    return `
        <div class="mcal-wcal" aria-label="Calendario de ${escapeHTML(name)} con los movimientos marcados">
            <strong class="mcal-wcal-title">${escapeHTML(title)}</strong>
            <div class="mcal-wcal-grid">
                ${WEEKDAYS.map(day => `<span class="mcal-wcal-weekday">${day}</span>`).join("")}
                ${cells.join("")}
            </div>
            <p class="mcal-wcal-legend"><span class="mcal-wcal-key is-arriving"></span> recibe un turno <span class="mcal-wcal-key is-leaving"></span> queda libre</p>
        </div>`;
}
