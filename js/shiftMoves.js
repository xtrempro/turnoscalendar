import {
    getJSON,
    getRaw,
    setJSON,
    setRaw
} from "./persistence.js";

// Insignia del turno trasladado. Vive aca -y no como texto suelto en el
// calendario- porque el estilo que la achica la busca por este mismo valor.
export const SHIFT_MOVE_BADGE = "TTMM";
import {
    isDateKeyOnOrAfter,
    calendarKeyToInputDate,
    compareISODate
} from "./dateUtils.js";
import { asRecordList } from "./storage.js";

const STORAGE_KEY = "shiftMoves";
const MIGRATION_KEY = "shiftMovesAuditMigrationV1";

function normalizeShiftMove(move = {}) {
    const profile = String(move.profile || "").trim();
    const sourceKey = String(move.sourceKey || "").trim();
    const targetKey = String(move.targetKey || "").trim();
    const sourceTurn = Number(move.sourceTurn) || 0;
    const destinationTurn = Number(move.destinationTurn) || 0;

    if (
        !profile ||
        !sourceKey ||
        !targetKey ||
        !sourceTurn ||
        !destinationTurn
    ) {
        return null;
    }

    return {
        id: String(
            move.id ||
            `${profile}-${sourceKey}-${targetKey}-${Date.now()}`
        ),
        profile,
        sourceKey,
        targetKey,
        sourceTurn,
        destinationTurn,
        hasUndoSnapshot: Boolean(move.hasUndoSnapshot),
        combinedInto24: Boolean(move.combinedInto24),
        combinedBaseComplement: Boolean(move.combinedBaseComplement),
        sourceHadData: Boolean(move.sourceHadData),
        sourcePreviousData: Number(move.sourcePreviousData) || 0,
        sourceHadBase: Boolean(move.sourceHadBase),
        sourcePreviousBase: Number(move.sourcePreviousBase) || 0,
        sourceHadBlocked: Boolean(move.sourceHadBlocked),
        sourcePreviousBlocked: Boolean(move.sourcePreviousBlocked),
        targetHadData: Boolean(move.targetHadData),
        targetPreviousData: Number(move.targetPreviousData) || 0,
        targetHadBase: Boolean(move.targetHadBase),
        targetPreviousBase: Number(move.targetPreviousBase) || 0,
        targetHadBlocked: Boolean(move.targetHadBlocked),
        targetPreviousBlocked: Boolean(move.targetPreviousBlocked),
        createdAt: String(
            move.createdAt || new Date().toISOString()
        )
    };
}

function isSimpleReverseShiftMove(previous, next) {
    if (!previous || !next) return false;
    if (previous.profile !== next.profile) return false;
    if (previous.combinedInto24 || next.combinedInto24) return false;

    const sameDayReverse =
        previous.sourceKey === previous.targetKey &&
        next.sourceKey === next.targetKey &&
        previous.sourceKey === next.sourceKey;
    const locationReverse =
        previous.sourceKey === next.targetKey &&
        previous.targetKey === next.sourceKey;

    return (
        (sameDayReverse || locationReverse) &&
        Number(previous.sourceTurn) === Number(next.destinationTurn) &&
        Number(previous.destinationTurn) === Number(next.sourceTurn)
    );
}

function reverseShiftMoveIndex(moves, normalized) {
    for (let index = moves.length - 1; index >= 0; index--) {
        if (isSimpleReverseShiftMove(moves[index], normalized)) {
            return index;
        }
    }

    return -1;
}

function compactReverseShiftMoves(moves = []) {
    const compacted = [];
    let changed = false;

    moves.forEach(move => {
        const reverseIndex = reverseShiftMoveIndex(compacted, move);

        if (reverseIndex >= 0) {
            compacted.splice(reverseIndex, 1);
            changed = true;
            return;
        }

        compacted.push(move);
    });

    return { moves: compacted, changed };
}

export function getShiftMoves() {
    const stored = asRecordList(getJSON(STORAGE_KEY, []))
        .map(normalizeShiftMove)
        .filter(Boolean);

    if (getRaw(MIGRATION_KEY, "") === "1") {
        const compacted = compactReverseShiftMoves(stored);

        if (compacted.changed) {
            saveShiftMoves(compacted.moves);
        }

        return compacted.moves;
    }

    const existingIds = new Set(
        stored.map(move => move.id)
    );
    const auditLogs = getJSON("auditLog", []);
    const migrated = auditLogs
        .filter(log =>
            String(log?.action || "") === "Movio turno base"
        )
        .map(log => normalizeShiftMove({
            id: `audit-${log.id || log.createdAt || Date.now()}`,
            profile: log.profile || log.meta?.profile,
            sourceKey: log.meta?.sourceKey,
            targetKey: log.meta?.targetKey,
            sourceTurn: log.meta?.sourceTurn,
            destinationTurn: log.meta?.destinationTurn,
            createdAt: log.createdAt
        }))
        .filter(move =>
            move && !existingIds.has(move.id)
        );

    const result = [
        ...stored,
        ...migrated
    ];
    const compacted = compactReverseShiftMoves(result);

    if (migrated.length || compacted.changed) {
        saveShiftMoves(compacted.moves);
    }

    // La bitacora ya NO viaja en el arranque (0,85 MB de puro registro, ver
    // DEFERRED_STATE_MODULES en js/firebaseAppState.js), asi que puede no haber
    // llegado todavia. Marcar la migracion como hecha con la bitacora vacia la
    // daria por cumplida PARA SIEMPRE -la bandera no se vuelve a mirar- y esos
    // "Movio turno base" no se migrarian nunca.
    //
    // Con una bitacora de verdad vacia esto solo cuesta filtrar un arreglo
    // vacio en cada llamada, que es gratis.
    if (auditLogs.length) setRaw(MIGRATION_KEY, "1");

    return compacted.moves;
}

export function saveShiftMoves(moves = []) {
    setJSON(
        STORAGE_KEY,
        (Array.isArray(moves) ? moves : [])
            .map(normalizeShiftMove)
            .filter(Boolean)
    );
}

export function registerShiftMove(move = {}) {
    const normalized = normalizeShiftMove(move);

    if (!normalized) return null;

    const moves = getShiftMoves();
    const reverseIndex = reverseShiftMoveIndex(moves, normalized);

    if (reverseIndex >= 0) {
        saveShiftMoves(
            moves.filter((_, index) => index !== reverseIndex)
        );

        return null;
    }

    saveShiftMoves([...moves, normalized]);

    return normalized;
}

export function cancelShiftMoveById(moveId) {
    const id = String(moveId || "");

    if (!id) return null;

    let canceled = null;
    const remaining = getShiftMoves().filter(move => {
        if (String(move.id || "") !== id) return true;

        canceled = move;
        return false;
    });

    if (!canceled) return null;

    saveShiftMoves(remaining);

    return canceled;
}

// Elimina los movimientos de turno (TTMM) del trabajador cuyo origen o destino
// cae en/desde la fecha dada. Se usa al aplicar una rotativa nueva para que la
// leyenda de "turno modificado" no quede pegada en el calendario futuro.
export function cancelFutureShiftMovesForWorker(profile, startDate) {
    if (!profile || !(startDate instanceof Date)) return [];

    const moves = getShiftMoves();
    const removed = [];
    const remaining = moves.filter(move => {
        const touchesFuture =
            isDateKeyOnOrAfter(move.sourceKey, startDate) ||
            isDateKeyOnOrAfter(move.targetKey, startDate);

        if (move.profile === profile && touchesFuture) {
            removed.push(move);
            return false;
        }

        return true;
    });

    if (removed.length) {
        saveShiftMoves(remaining);
    }

    return removed;
}

function isDateKeyInRange(keyDay, startDate, endISO = "") {
    if (!isDateKeyOnOrAfter(keyDay, startDate)) return false;

    if (!endISO) return true;

    const iso = calendarKeyToInputDate(keyDay);

    return Boolean(iso) && compareISODate(iso, endISO) <= 0;
}

export function cancelShiftMovesForWorkerRange(
    profile,
    startDate,
    endISO = ""
) {
    if (!profile || !(startDate instanceof Date)) return [];

    const moves = getShiftMoves();
    const removed = [];
    const remaining = moves.filter(move => {
        const touchesRange =
            isDateKeyInRange(move.sourceKey, startDate, endISO) ||
            isDateKeyInRange(move.targetKey, startDate, endISO);

        if (move.profile === profile && touchesRange) {
            removed.push(move);
            return false;
        }

        return true;
    });

    if (removed.length) {
        saveShiftMoves(remaining);
    }

    return removed;
}

export function getShiftMoveMarkers(profile, keyDay) {
    if (!profile || !keyDay) return [];

    return getShiftMoves()
        .filter(move =>
            move.profile === profile &&
            (
                move.sourceKey === keyDay ||
                move.targetKey === keyDay
            )
        )
        .map(move => ({
            move,
            role:
                move.sourceKey === move.targetKey
                    ? "same"
                    : move.sourceKey === keyDay
                        ? "source"
                        : "target",
            label: SHIFT_MOVE_BADGE
        }));
}
