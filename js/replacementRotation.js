export const REPLACEMENT_ROTATION_MODE = Object.freeze({
    INHERIT: "inherit",
    FREE: "free"
});

export function normalizeReplacementRotationMode(
    value,
    fallback = ""
) {
    const normalized = String(value || "").trim().toLowerCase();

    if (
        normalized === REPLACEMENT_ROTATION_MODE.INHERIT ||
        normalized === REPLACEMENT_ROTATION_MODE.FREE
    ) {
        return normalized;
    }

    return fallback;
}

export function replacementRotationModeLabel(value) {
    return normalizeReplacementRotationMode(value) ===
        REPLACEMENT_ROTATION_MODE.FREE
        ? "Libre (turnos manuales)"
        : "Heredar turnos del trabajador reemplazado";
}
