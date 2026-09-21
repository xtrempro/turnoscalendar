export const REPLACEMENT_ROTATION_MODE = Object.freeze({
    INHERIT: "inherit",
    FREE: "free",
    DIURNO_BRIDGE: "diurno_bridge"
});

export function normalizeReplacementRotationMode(
    value,
    fallback = ""
) {
    const normalized = String(value || "").trim().toLowerCase();

    if (
        normalized === REPLACEMENT_ROTATION_MODE.INHERIT ||
        normalized === REPLACEMENT_ROTATION_MODE.FREE ||
        normalized === REPLACEMENT_ROTATION_MODE.DIURNO_BRIDGE
    ) {
        return normalized;
    }

    return fallback;
}

export function replacementRotationModeLabel(value) {
    const mode = normalizeReplacementRotationMode(value);

    if (mode === REPLACEMENT_ROTATION_MODE.FREE) {
        return "Libre (turnos manuales)";
    }

    if (mode === REPLACEMENT_ROTATION_MODE.DIURNO_BRIDGE) {
        return "Reemplazante diurno y diurno cubre rotativa";
    }

    return "Heredar turnos del trabajador reemplazado";
}
