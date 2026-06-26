/* ======================================================
   COLORES DE TURNOS (configurables por el supervisor)
   Fuente unica de color para turnos base y turnos extra,
   aplicada al calendario (variables CSS) y al timeline.
====================================================== */

import { TURNO_LABEL } from "./constants.js";
import { getJSON, setJSON } from "./persistence.js";

const CONFIG_KEY = "turnoColorConfig";

// Codigos de turno con color configurable (se siguen seteando como variables).
export const TURNO_COLOR_CODES = [1, 2, 3, 4, 5, 6, 7, 8];

// Codigos de turno BASE con color propio en Ajustes: solo Larga, Noche y
// Diurno. El resto (24, D+N, 18h) se pintan con dos colores derivados de estos,
// y los permisos/horas usan los colores con nombre de abajo.
export const TURNO_COLOR_SETTINGS_CODES = [1, 2, 4];

// Colores de permisos y horas (un solo color cada uno). No son codigos de turno.
// Se aplican como variables CSS: --color-<key> (y --color-<key>-text).
export const NAMED_TURNO_COLORS = [
    { key: "admin", label: "Administrativo", default: "#f97316" },
    { key: "extension", label: "Extensión horaria", default: "#f59e0b" },
    { key: "reduction", label: "Reducción horaria", default: "#dc2626" },
    { key: "legal", label: "F. Legal", default: "#0ea5a6" },
    { key: "comp", label: "F. Compensatorio", default: "#8b2bd9" },
    { key: "license", label: "Licencia Médica", default: "#e64747" },
    { key: "professional_license", label: "LM Profesional", default: "#2563eb" },
    { key: "unpaid_leave", label: "Permiso sin Goce", default: "#6b7280" },
    { key: "hours_return", label: "Devolución de horas", default: "#14b8a6" },
    { key: "unjustified_absence", label: "Ausencia injustificada", default: "#b91c1c" }
];

const NAMED_DEFAULTS = Object.fromEntries(
    NAMED_TURNO_COLORS.map(item => [item.key, item.default])
);

function buildNamedColors(saved) {
    const named = {};

    for (const item of NAMED_TURNO_COLORS) {
        named[item.key] = normalizeHex(saved?.[item.key], item.default);
    }

    return named;
}

// Clase CSS que usa el calendario para cada codigo de turno (TURNO_CLASS).
export const TURNO_CODE_CLASS = {
    1: "green",
    2: "blue",
    3: "purple",
    4: "lightgreen",
    5: "yellow",
    6: "half-morning",
    7: "half-afternoon",
    8: "eighteen"
};

// Colores solidos por defecto (equivalentes a los actuales del timeline).
const DEFAULT_BASE = {
    1: "#22c55e",
    2: "#1d6cff",
    3: "#8b2bd9",
    4: "#0b8853",
    5: "#f0b100",
    6: "#fbbf24",
    7: "#f59e0b",
    8: "#7c3aed"
};

export function turnoColorLabel(code) {
    return TURNO_LABEL[code] || `Turno ${code}`;
}

function normalizeHex(value, fallback) {
    return /^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? String(value) : fallback;
}

// Cache del config parseado para no leer/parsear localStorage por cada celda
// del timeline. Se invalida al guardar/resetear y en cada applyTurnoColors.
let cachedConfig = null;

export function invalidateTurnoColorCache() {
    cachedConfig = null;
}

// Devuelve { base: {code: hex}, extra: {code: hex} } con defaults aplicados.
// El extra por defecto es igual al base (comportamiento actual).
export function getTurnoColorConfig() {
    if (cachedConfig) return cachedConfig;

    const saved = getJSON(CONFIG_KEY, {});
    const base = {};
    const extra = {};

    for (const code of TURNO_COLOR_CODES) {
        base[code] = normalizeHex(saved?.base?.[code], DEFAULT_BASE[code]);
        extra[code] = normalizeHex(saved?.extra?.[code], base[code]);
    }

    const named = buildNamedColors(saved?.named);

    cachedConfig = { base, extra, named };
    return cachedConfig;
}

export function saveTurnoColorConfig(config) {
    const base = {};
    const extra = {};

    for (const code of TURNO_COLOR_CODES) {
        base[code] = normalizeHex(config?.base?.[code], DEFAULT_BASE[code]);
        extra[code] = normalizeHex(config?.extra?.[code], base[code]);
    }

    const named = buildNamedColors(config?.named);

    setJSON(CONFIG_KEY, { base, extra, named });
    cachedConfig = null;
}

export function resetTurnoColorConfig() {
    setJSON(CONFIG_KEY, {});
    cachedConfig = null;
}

export function getDefaultTurnoColorConfig() {
    const base = {};
    const extra = {};

    for (const code of TURNO_COLOR_CODES) {
        base[code] = DEFAULT_BASE[code];
        extra[code] = DEFAULT_BASE[code];
    }

    return { base, extra, named: { ...NAMED_DEFAULTS } };
}

export function defaultTurnoColor(code) {
    return DEFAULT_BASE[Number(code)] || "#64748b";
}

export function getTurnoColor(code, isExtra = false) {
    const config = getTurnoColorConfig();
    const n = Number(code);

    if (!TURNO_COLOR_CODES.includes(n)) return null;

    return isExtra ? config.extra[n] : config.base[n];
}

// Texto legible (negro/blanco) segun la luminancia del fondo.
export function contrastTextColor(hex) {
    const match = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ""));

    if (!match) return "#ffffff";

    const value = match[1];
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    return luminance > 0.62 ? "#1c1c1c" : "#ffffff";
}

// Aplica los colores como variables CSS en :root (las usa el calendario).
export function applyTurnoColors() {
    if (typeof document === "undefined") return;

    // Relee fresco una vez por render (cubre cambios por sync de estado).
    cachedConfig = null;
    const { base, extra, named } = getTurnoColorConfig();
    const root = document.documentElement;

    for (const code of TURNO_COLOR_CODES) {
        root.style.setProperty(`--turno-color-${code}`, base[code]);
        root.style.setProperty(`--turno-text-${code}`, contrastTextColor(base[code]));
        root.style.setProperty(`--turno-color-${code}-extra`, extra[code]);
        root.style.setProperty(`--turno-text-${code}-extra`, contrastTextColor(extra[code]));
    }

    for (const item of NAMED_TURNO_COLORS) {
        const value = named[item.key];
        root.style.setProperty(`--color-${item.key}`, value);
        root.style.setProperty(`--color-${item.key}-text`, contrastTextColor(value));
    }
}
