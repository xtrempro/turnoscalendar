// Reparacion de las preasignaciones confirmadas con el turno perdido.
//
// Desde el 2026-08-19 (498cc64) confirmPreassignment pasaba el turno de la
// reserva -un NUMERO- por codeToTurno, que solo entiende "L"/"N"/... y lo
// volvia Libre. El reemplazo quedaba guardado con `turno: ""`: no cubria nada,
// la reserva ya se habia borrado y el turno "desaparecia" del mes (el ausente
// volvia a salir sin cubrir). Arreglado el 2026-09-30; esto repone el turno a
// los que ya quedaron asi.
//
// Un reemplazo real siempre tiene turno, asi que "vigente, cubre a alguien,
// turno vacio y creado desde el 19-08" no se confunde con otra cosa. El turno
// que se repone es el que el ausente necesitaba cubrir ese dia (la misma regla
// con que el modal de sugerencias decide que turno buscar). Idempotente: si no
// hay nada que reparar, no escribe.

import { keyFromISO } from "./dateUtils.js";
import { getReplacements, saveReplacements } from "./storage.js";
import { replacementActive, turnoToCode } from "./replacements.js";
import { getReplacementNeededTurn } from "./replacementCandidates.js";
import { addAuditLog, AUDIT_CATEGORY } from "./auditLog.js";

const BROKEN_SINCE = "2026-08-19";

export function findEmptyTurnReplacements(list = getReplacements()) {
    return list.filter(record =>
        record &&
        replacementActive(record) &&
        // Lo que guarda confirmPreassignment (otros registros, como los de
        // marcaje, pueden ir sin turno a proposito).
        record.source === "replacement" &&
        record.replaced &&
        record.worker &&
        record.date &&
        String(record.turno ?? "").trim() === "" &&
        String(record.createdAt || "") >= BROKEN_SINCE
    );
}

/** @returns {Object[]} los reemplazos reparados (vacio si no habia). */
export function repairEmptyTurnReplacements() {
    const list = getReplacements();
    const broken = new Set(findEmptyTurnReplacements(list).map(record => record.id));

    if (!broken.size) return [];

    const repaired = [];
    const next = list.map(record => {
        if (!broken.has(record.id)) return record;

        const code = turnoToCode(
            getReplacementNeededTurn(record.replaced, keyFromISO(record.date))
        );

        if (!code) return record;

        const fixed = { ...record, turno: code };

        repaired.push(fixed);

        return fixed;
    });

    if (!repaired.length) return [];

    saveReplacements(next);
    addAuditLog(
        AUDIT_CATEGORY.CALENDAR,
        "Repuso el turno de preasignaciones confirmadas",
        `${repaired.length} reemplazo(s) confirmados desde una preasignacion habian quedado sin turno; se les repuso el turno del ausente: ` +
            repaired.map(record => `${record.worker} cubre a ${record.replaced} el ${record.date} (${record.turno})`).join("; ") +
            ".",
        {}
    );

    return repaired;
}
