/* ======================================================
   COLORES DE TURNOS (configurables por el supervisor)
   Fuente unica de color para turnos base y turnos extra,
   aplicada al calendario (variables CSS) y al timeline.
====================================================== */

import { TURNO_LABEL } from "./constants.js";
import { getJSON, setJSON } from "./persistence.js";

const CONFIG_KEY = "turnoColorConfig";
// Color base de la aplicacion (azul del logo). Es el mismo token --brand-blue
// de styles.css; cada usuario puede personalizarlo desde Ajustes y solo cambia
// para el (se guarda en su localStorage, no en el workspace).
export const DEFAULT_BRAND_COLOR = "#10498b";
const OLD_LICENSE_DEFAULT = "#e64747";
const LICENSE_MUTED_ORANGE = "#d97706";

// Colores base de los turnos Larga y Noche (los mismos que usa la PWA del
// trabajador). Son semanticos del calendario: no dependen del color de marca.
const SHIFT_LARGA_BLUE = "#0089c5";
const SHIFT_NOCHE_BLUE = "#10498b";

// Defaults anteriores de Larga/Noche. Si una configuracion guardada todavia los
// conserva, significa que nunca se personalizaron: se adoptan los nuevos colores
// (mismo criterio que la migracion del color de Licencia Medica).
const LEGACY_BASE_DEFAULTS = {
    1: "#22c55e",
    2: "#1d6cff"
};

function migrateLegacyBaseColor(code, value) {
    const legacy = LEGACY_BASE_DEFAULTS[code];

    if (!legacy || String(value).toLowerCase() !== legacy) {
        return value;
    }

    return code === 1 ? SHIFT_LARGA_BLUE : SHIFT_NOCHE_BLUE;
}

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
    { key: "license", label: "Licencia Médica", default: LICENSE_MUTED_ORANGE },
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
        let value = normalizeHex(saved?.[item.key], item.default);

        if (
            item.key === "license" &&
            value.toLowerCase() === OLD_LICENSE_DEFAULT
        ) {
            value = LICENSE_MUTED_ORANGE;
        }

        named[item.key] = value;
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
    1: SHIFT_LARGA_BLUE,
    2: SHIFT_NOCHE_BLUE,
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
        base[code] = migrateLegacyBaseColor(
            code,
            normalizeHex(saved?.base?.[code], DEFAULT_BASE[code])
        );
        extra[code] = migrateLegacyBaseColor(
            code,
            normalizeHex(saved?.extra?.[code], base[code])
        );
    }

    const named = buildNamedColors(saved?.named);
    const brand = normalizeHex(saved?.brand, DEFAULT_BRAND_COLOR);

    cachedConfig = { base, extra, named, brand };
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
    const brand = normalizeHex(config?.brand, DEFAULT_BRAND_COLOR);

    setJSON(CONFIG_KEY, { base, extra, named, brand });
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

    return { base, extra, named: { ...NAMED_DEFAULTS }, brand: DEFAULT_BRAND_COLOR };
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
    const { base, extra, named, brand } = getTurnoColorConfig();
    const root = document.documentElement;

    // Token de marca: de el derivan --accent* y todas las sombras
    // rgba(var(--brand-blue-rgb), X) definidas en styles.css.
    const [br, bg, bb] = hexToRgbParts(brand);
    root.style.setProperty("--brand-blue", brand);
    root.style.setProperty("--brand-blue-rgb", `${br}, ${bg}, ${bb}`);
    root.style.setProperty("--brand-blue-dark", darkenHex(brand));

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

// --- utilidades de color para el token de marca ---
function hexToRgbParts(hex) {
    const v = String(hex || "").replace("#", "");
    return [
        parseInt(v.slice(0, 2), 16) || 0,
        parseInt(v.slice(2, 4), 16) || 0,
        parseInt(v.slice(4, 6), 16) || 0
    ];
}

// Variante oscura para hover/degradados (mismo tono, ~22% mas oscuro).
function darkenHex(hex, factor = 0.78) {
    const channel = (n) => Math.max(0, Math.min(255, Math.round(n * factor)))
        .toString(16)
        .padStart(2, "0");
    const [r, g, b] = hexToRgbParts(hex);
    return `#${channel(r)}${channel(g)}${channel(b)}`;
}
