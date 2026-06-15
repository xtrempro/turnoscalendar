/* ======================================================
   CONSTANTS
====================================================== */

/* ==========================================
   TURNOS
========================================== */

export const TURNO = {
    LIBRE: 0,
    LARGA: 1,
    NOCHE: 2,
    TURNO24: 3,
    DIURNO: 4,
    DIURNO_NOCHE: 5,
    MEDIA_MANANA: 6,
    MEDIA_TARDE: 7,
    TURNO18: 8
};

/* ==========================================
   LABELS
========================================== */

export const TURNO_LABEL = {
    0: "",
    1: "Larga",
    2: "Noche",
    3: "24",
    4: "Diurno",
    5: "D+N",
    6: "1/2M",
    7: "Extensi\u00f3n horaria",
    8: "18 horas"
};

/* ==========================================
   CSS CLASSES
========================================== */

export const TURNO_CLASS = {
    1: "green",
    2: "blue",
    3: "purple",
    4: "lightgreen",
    5: "yellow",
    6: "half-morning",
    7: "half-afternoon",
    8: "eighteen"
};

export const TURNO_COLOR = {
   0:"var(--timeline-empty)",
   1:"#22c55e",
   2:"#1d6cff",
   3:"#8b2bd9",
   4:"#0b8853",
   5:"#f0b100",
   6:"#fbbf24",
   7:"#f59e0b",
   8:"#7c3aed"
};

/* ==========================================
   MODOS SELECCION
========================================== */

export const MODO = {
    ADMIN: "admin",
    HALF_ADMIN: "halfadmin",
    LICENSE: "license"
};

/* ==========================================
   AUSENCIAS
========================================== */

export const AUSENCIA = {
    LICENSE: "license"
};

/* ==========================================
   ESTAMENTOS
========================================== */

export const ESTAMENTO = [
    "Profesional",
    "Técnico",
    "Administrativo",
    "Auxiliar"
];
