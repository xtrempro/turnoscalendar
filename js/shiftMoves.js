import {
    getJSON,
    getRaw,
    setJSON,
    setRaw
} from "./persistence.js";

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
