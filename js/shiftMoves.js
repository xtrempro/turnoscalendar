import {
    getJSON,
    getRaw,
    setJSON,
    setRaw
} from "./persistence.js";
import { isDateKeyOnOrAfter } from "./dateUtils.js";

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

export function getShiftMoves() {
    const stored = getJSON(STORAGE_KEY, [])
        .map(normalizeShiftMove)
        .filter(Boolean);

    if (getRaw(MIGRATION_KEY, "") === "1") {
        return stored;
    }

    const existingIds = new Set(
        stored.map(move => move.id)
    );
    const migrated = getJSON("auditLog", [])
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

    if (migrated.length) {
        setJSON(STORAGE_KEY, result);
    }

    setRaw(MIGRATION_KEY, "1");

    return result;
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

    saveShiftMoves([
        ...getShiftMoves(),
        normalized
    ]);

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
            label: "TTMM"
        }));
}
