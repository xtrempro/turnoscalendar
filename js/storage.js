import { normalizeText, stripAccents } from "./stringUtils.js";
import {
    getRaw,
    setRaw,
    removeKey,
    getJSON,
    setJSON,
    getNumber,
    listKeys,
    moveKey
} from "./persistence.js";

let currentProfile = null;

export const DEFAULT_GRADE_HOUR_CONFIG = {
    professional: {
        10: 9378.56,
        11: 8605.85,
        12: 7897.38,
        13: 7272.24,
        14: 6663.65,
        15: 6107.22,
        16: 6072.8
    },
    general: {
        12: 4420.99,
        13: 4205.87,
        14: 4002.53,
        15: 3784.87,
        16: 3550.55,
        17: 3392.09,
        18: 3230.79,
        19: 3085.6,
        20: 2902.88,
        21: 2751.67,
        22: 2550.45,
        23: 2330.32,
        24: 2148.73
    }
};

export const SIN_INFORMACION_PROFESSION = "Sin informacion";

export const PROFESSIONAL_PROFESSIONS = [
    "Kinesiolog\u00eda",
    "Enfermer\u00eda",
    "TM Imagenolog\u00eda",
    "TM Otorrinolaringolog\u00eda",
    "TM Oftalmolog\u00eda",
    "TM Morfofisiopatolog\u00eda",
    "TM Laboratorio",
    "Terapia Ocupacional",
    "Fonoaudiolog\u00eda",
    "Obstetricia",
    "Nutricionista",
    SIN_INFORMACION_PROFESSION
];

export const TECHNICAL_PROFESSIONS = [
    "T\u00e9cnico en Enfermer\u00eda",
    "T\u00e9cnico en Odontolog\u00eda",
    "T\u00e9cnico en Farmacia",
    "T\u00e9cnico en Imagenolog\u00eda",
    "T\u00e9cnico en Nutrici\u00f3n",
    "T\u00e9cnico en Laboratorio",
    SIN_INFORMACION_PROFESSION
];

export const ADMINISTRATIVE_PROFESSIONS = [
    "T\u00e9cnico en Administraci\u00f3n de Empresas",
    "T\u00e9cnico en Contabilidad",
    "T\u00e9cnico en Log\u00edstica",
    "T\u00e9cnico en Comercio Exterior",
    "Ingenier\u00eda en Administraci\u00f3n de Empresas",
    "Ingenier\u00eda Comercial",
    "Ingenier\u00eda en RRHH"
];

export const PROFESSIONS = [
    ...new Set([
        ...PROFESSIONAL_PROFESSIONS,
        ...TECHNICAL_PROFESSIONS,
        ...ADMINISTRATIVE_PROFESSIONS
    ])
];

const PROFESSION_ALIASES = {
    enfermero: "Enfermer\u00eda",
    enfermera: "Enfermer\u00eda",
    enfermeria: "Enfermer\u00eda",
    fonoaudiologia: "Fonoaudiolog\u00eda",
    kinesiologo: "Kinesiolog\u00eda",
    kinesiologa: "Kinesiolog\u00eda",
    kinesiologia: "Kinesiolog\u00eda",
    "sin informacion": SIN_INFORMACION_PROFESSION,
    "sin info": SIN_INFORMACION_PROFESSION,
    "tecnico en enfermeria": "T\u00e9cnico en Enfermer\u00eda",
    "tecnico en imagenologia": "T\u00e9cnico en Imagenolog\u00eda",
    "tecnico en laboratorio": "T\u00e9cnico en Laboratorio",
    "tm anatomia patologica": "TM Morfofisiopatolog\u00eda",
    "tm imagenologia": "TM Imagenolog\u00eda",
    "tm laboratorio": "TM Laboratorio",
    "tm morfofisiopatologia": "TM Morfofisiopatolog\u00eda",
    "tm oftalmologia": "TM Oftalmolog\u00eda",
    "tm otorrinolaringologia": "TM Otorrinolaringolog\u00eda"
};

function normalizeTextKey(value) {
    return normalizeText(value);
}

function findProfessionOption(value, options = []) {
    const key = normalizeTextKey(value);

    return options.find(profession =>
        normalizeTextKey(profession) === key
    );
}

export function estamentoAllowsCustomProfession(estamento) {
    const normalized = normalizeEstamento(estamento);

    return (
        normalized === "Administrativo" ||
        normalized === "Auxiliar"
    );
}

export function getProfessionOptionsForEstamento(estamento) {
    const normalized = normalizeEstamento(estamento);

    if (normalized === "T\u00e9cnico") {
        return TECHNICAL_PROFESSIONS;
    }

    if (estamentoAllowsCustomProfession(normalized)) {
        return ADMINISTRATIVE_PROFESSIONS;
    }

    return PROFESSIONAL_PROFESSIONS;
}

export function normalizeProfession(value, estamento = "Profesional") {
    const raw = String(value || "").trim();

    if (!raw) return SIN_INFORMACION_PROFESSION;

    const normalizedEstamento = normalizeEstamento(estamento);
    const options = getProfessionOptionsForEstamento(normalizedEstamento);
    const optionMatch = findProfessionOption(raw, options);

    if (optionMatch) return optionMatch;

    if (estamentoAllowsCustomProfession(normalizedEstamento)) {
        return raw;
    }

    const alias = PROFESSION_ALIASES[normalizeTextKey(raw)];

    if (alias && findProfessionOption(alias, options)) {
        return alias;
    }

    return SIN_INFORMACION_PROFESSION;
}

function normalizeProfileId(value) {
    return stripAccents(String(value || "").trim())
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80);
}

function createProfileId(profile = {}) {
    const existing = normalizeProfileId(profile.id);

    if (existing) return existing;

    const seed = normalizeProfileId(
        profile.rut ||
        profile.email ||
        profile.name ||
        `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    );

    return `profile_${seed || Math.random().toString(36).slice(2, 10)}`;
}

function normalizeRateMap(map = {}, fallback = {}) {
    return Object.keys(fallback).reduce((acc, grade) => {
        const value = Number(map[grade]);
        acc[grade] = Number.isFinite(value) && value > 0
            ? value
            : fallback[grade];
        return acc;
    }, {});
}

/* =========================================================
   Valores por grado, con vigencia

   El valor de la hora por grado cambia una vez al año, asi que no puede haber
   una sola tabla: un informe de 2025 tiene que seguir calculandose con los
   valores de 2025 aunque hoy rijan otros.

   La configuracion es una lista de PERIODOS, cada uno con su propia tabla:

     [{ from: "2025-02", to: "2026-01", professional: {...}, general: {...} },
      { from: "2026-02", to: "",       professional: {...}, general: {...} }]

   Siempre a mes cerrado: "from" y "to" son meses, no fechas. Un "to" vacio
   significa "hasta nuevo aviso", que es el periodo vigente.
========================================================= */

function normalizeGradeMonth(value) {
    const match = String(value || "").trim().match(/^(\d{4})-(\d{1,2})/);

    if (!match) return "";

    const month = Number(match[2]);

    if (month < 1 || month > 12) return "";

    return `${match[1]}-${String(month).padStart(2, "0")}`;
}

function normalizeGradeHourPeriod(period = {}, index = 0) {
    const from = normalizeGradeMonth(period.from);
    const to = normalizeGradeMonth(period.to);

    return {
        id: String(period.id || `periodo_${index}_${from || "inicio"}`),
        from,
        // Un "to" anterior al "from" es un error de tipeo: se descarta en vez de
        // dejar un periodo imposible que nunca aplicaria.
        to: to && from && to < from ? "" : to,
        professional: normalizeRateMap(
            period.professional,
            DEFAULT_GRADE_HOUR_CONFIG.professional
        ),
        general: normalizeRateMap(
            period.general,
            DEFAULT_GRADE_HOUR_CONFIG.general
        )
    };
}

function normalizeGradeHourConfig(config = {}) {
    // Compatibilidad: la configuracion vieja era UNA tabla sin fechas. Se migra
    // a un unico periodo abierto, con lo que sigue aplicando a todo el historico
    // exactamente como antes.
    const rawPeriods = Array.isArray(config?.periods) && config.periods.length
        ? config.periods
        : [{
            from: "",
            to: "",
            professional: config?.professional,
            general: config?.general
        }];

    const periods = rawPeriods
        .map(normalizeGradeHourPeriod)
        .sort((a, b) => String(a.from).localeCompare(String(b.from)));

    return { periods };
}

function monthKeyFromDate(date) {
    const parsed = date instanceof Date ? date : new Date(date);

    if (!parsed || Number.isNaN(parsed.getTime())) return "";

    return `${parsed.getFullYear()}-` +
        `${String(parsed.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Periodo que aplica en esa fecha.
 *
 * Si ninguno la cubre NO se devuelve vacio: dejar el valor hora en cero
 * silenciaria el pago de todo un mes. Se cae al periodo aplicable mas cercano
 * -el ultimo que empieza antes, o el primero de todos si la fecha es anterior a
 * cualquiera-, que es como se comportaba la tabla unica.
 */
export function getGradeHourPeriodAt(date = null) {
    return gradeHourPeriodFrom(getGradeHourConfig(), date);
}

function gradeHourPeriodFrom(config, date = null) {
    const periods = config?.periods || [];

    if (!periods.length) return null;

    const month = monthKeyFromDate(date || new Date());

    if (!month) return periods[periods.length - 1];

    const exact = periods.find(period =>
        (!period.from || period.from <= month) &&
        (!period.to || month <= period.to)
    );

    if (exact) return exact;

    const previous = periods
        .filter(period => !period.from || period.from <= month)
        .at(-1);

    return previous || periods[0];
}

function gradeHourGroup(estamento) {
    return normalizeEstamento(estamento) === "Profesional"
        ? "professional"
        : "general";
}

export function getGradeHourConfig() {
    return normalizeGradeHourConfig(
        getJSON("gradeHourConfig", DEFAULT_GRADE_HOUR_CONFIG)
    );
}

export function saveGradeHourConfig(config) {
    const normalized = normalizeGradeHourConfig(config);
    const current = gradeHourPeriodFrom(normalized, new Date());

    // Se guarda tambien la tabla del periodo VIGENTE en la raiz, con el formato
    // antiguo. Una version del app que todavia no conoce los periodos lee
    // "professional"/"general" de la raiz; si no estuvieran, no encontraria
    // nada y caeria a los valores por defecto, mostrando cifras equivocadas sin
    // avisar. Es lo que paso al escribir el primer periodo desde un script.
    setJSON("gradeHourConfig", {
        ...normalized,
        professional: { ...(current?.professional || {}) },
        general: { ...(current?.general || {}) }
    });
}

export function getGradeHourValue(estamento, grade, date = null) {
    const group = gradeHourGroup(estamento);
    const period = getGradeHourPeriodAt(date);

    return Number(period?.[group]?.[String(grade)] || 0);
}

function normalizeHistoryDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return [
            value.getFullYear(),
            String(value.getMonth() + 1).padStart(2, "0"),
            String(value.getDate()).padStart(2, "0")
        ].join("-");
    }

    const match = String(value || "")
        .match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);

    if (!match) return "";

    return [
        match[1],
        String(Number(match[2])).padStart(2, "0"),
        String(Number(match[3])).padStart(2, "0")
    ].join("-");
}

function gradeHistoryKey(profile = currentProfile) {
    return `gradeHistory_${profile}`;
}

function contractHistoryKey(profile = currentProfile) {
    return `contractHistory_${profile}`;
}

function normalizeGradeHistoryEntry(entry = {}) {
    const start = normalizeHistoryDate(entry.start);
    const grade = String(entry.grade || "").trim();
    const contractType = String(entry.contractType || "").trim();
    const rawEstamento = String(entry.estamento || "").trim();
    const estamento = normalizeEstamento(rawEstamento);

    if (!start || (!grade && !contractType && !rawEstamento)) return null;

    return {
        id: String(
            entry.id ||
            `${start}_${contractType || "contrato"}_${grade || "sin-grado"}`
        ),
        start,
        grade,
        estamento,
        contractType,
        createdAt: String(entry.createdAt || new Date().toISOString())
    };
}

function normalizeGradeHistory(history = []) {
    return (Array.isArray(history) ? history : [])
        .map(normalizeGradeHistoryEntry)
        .filter(Boolean)
        .sort((a, b) =>
            a.start.localeCompare(b.start) ||
            a.createdAt.localeCompare(b.createdAt)
        );
}

export function getGradeHistory(profile = currentProfile) {
    if (!profile) return [];

    return normalizeGradeHistory(
        getJSON(gradeHistoryKey(profile), [])
    );
}

export function saveGradeHistory(
    profile = currentProfile,
    history = []
) {
    if (!profile) return;

    setJSON(
        gradeHistoryKey(profile),
        normalizeGradeHistory(history)
    );
}

function compensationEntryFromProfile(
    profileData = {},
    start = "1900-01-01"
) {
    return normalizeGradeHistoryEntry({
        start,
        grade: profileData.grade,
        estamento: profileData.estamento,
        contractType: profileData.contractType
    });
}

export function initializeGradeHistory(
    profile,
    profileData = {},
    start = "1900-01-01"
) {
    if (!profile) return;

    const entry = compensationEntryFromProfile(
        profileData,
        normalizeHistoryDate(start) || "1900-01-01"
    );

    if (!entry) return;

    saveGradeHistory(profile, [entry]);
}

export function recordGradeHistoryChange(
    profile,
    previousProfile = {},
    nextProfile = {},
    start
) {
    if (!profile) return;

    const startDate = normalizeHistoryDate(start);

    if (!startDate) {
        throw new Error(
            "Debes indicar desde que fecha rige el nuevo grado."
        );
    }

    const history = getGradeHistory(profile);
    const previousEntry =
        compensationEntryFromProfile(
            previousProfile,
            "1900-01-01"
        );
    const nextEntry =
        compensationEntryFromProfile(
            nextProfile,
            startDate
        );

    if (!nextEntry) return;

    const nextHistory = history.length
        ? [...history]
        : previousEntry
            ? [previousEntry]
            : [];
    const hasPreviousBeforeStart = nextHistory.some(entry =>
        entry.start < startDate
    );

    if (previousEntry && !hasPreviousBeforeStart) {
        nextHistory.push(previousEntry);
    }

    saveGradeHistory(
        profile,
        [
            ...nextHistory.filter(entry =>
                entry.start !== startDate
            ),
            nextEntry
        ]
    );
}

export function getCompensationProfileAt(
    profile = currentProfile,
    date = null
) {
    const profileData = getProfiles().find(item =>
        item.name === profile
    );

    if (!profileData) return null;

    const dateKey = normalizeHistoryDate(date);
    const contractTypeAtDate = dateKey
        ? getContractTypeAt(profile, dateKey)
        : String(profileData.contractType || "").trim();

    if (!dateKey) {
        return {
            ...profileData,
            contractType: contractTypeAtDate || profileData.contractType
        };
    }

    const history = getGradeHistory(profile);
    const matches = history.filter(item =>
        item.start <= dateKey
    );
    const entry = matches[matches.length - 1];

    if (!entry) {
        return {
            ...profileData,
            contractType: contractTypeAtDate || profileData.contractType
        };
    }

    return {
        ...profileData,
        grade: entry.grade,
        estamento: entry.estamento || profileData.estamento,
        contractType:
            contractTypeAtDate ||
            entry.contractType ||
            profileData.contractType
    };
}

function normalizeContractHistoryChange(change = {}) {
    const field = String(change.field || "").trim();

    if (!field) return null;

    return {
        field,
        label: String(change.label || field).trim(),
        from: String(change.from ?? "").trim(),
        to: String(change.to ?? "").trim(),
        effectiveDate:
            normalizeHistoryDate(change.effectiveDate) || ""
    };
}

function normalizeContractHistoryEntry(entry = {}) {
    const changes = (Array.isArray(entry.changes)
        ? entry.changes
        : []
    )
        .map(normalizeContractHistoryChange)
        .filter(Boolean);

    if (!changes.length) return null;

    const createdAt = String(
        entry.createdAt || new Date().toISOString()
    );
    const id = String(
        entry.id ||
        `${createdAt}_${changes.map(change => change.field).join("_")}`
    );

    return {
        id,
        createdAt,
        effectiveDate:
            normalizeHistoryDate(entry.effectiveDate) || "",
        summary: String(entry.summary || "").trim(),
        changes
    };
}

function normalizeContractHistory(history = []) {
    return (Array.isArray(history) ? history : [])
        .map(normalizeContractHistoryEntry)
        .filter(Boolean)
        .sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt) ||
            b.id.localeCompare(a.id)
        );
}

export function getContractHistory(profile = currentProfile) {
    if (!profile) return [];

    return normalizeContractHistory(
        getJSON(contractHistoryKey(profile), [])
    );
}

export function saveContractHistory(
    profile = currentProfile,
    history = []
) {
    if (!profile) return;

    setJSON(
        contractHistoryKey(profile),
        normalizeContractHistory(history)
    );
}

export function addContractHistoryEntry(profile, entry = {}) {
    if (!profile) return null;

    const normalized = normalizeContractHistoryEntry(entry);

    if (!normalized) return null;

    saveContractHistory(
        profile,
        [
            normalized,
            ...getContractHistory(profile).filter(item =>
                item.id !== normalized.id
            )
        ]
    );

    return normalized;
}

function normalizeContractHistoryValue(value) {
    const text = String(value || "").trim();

    return text === "Sin contrato" ? "" : text;
}

function contractTypeHistoryEvents(profile = currentProfile) {
    return getContractHistory(profile)
        .flatMap(entry =>
            entry.changes
                .filter(change => change.field === "contractType")
                .map(change => ({
                    createdAt: entry.createdAt,
                    effectiveDate:
                        normalizeHistoryDate(change.effectiveDate) ||
                        normalizeHistoryDate(entry.effectiveDate) ||
                        "",
                    from: normalizeContractHistoryValue(change.from),
                    to: normalizeContractHistoryValue(change.to)
                }))
        )
        .filter(event => event.effectiveDate)
        .sort((a, b) =>
            a.effectiveDate.localeCompare(b.effectiveDate) ||
            a.createdAt.localeCompare(b.createdAt)
        );
}

export function getContractTypeAt(profile = currentProfile, date = null) {
    if (!profile) return "";

    const profileData = getProfiles().find(item =>
        item.name === profile
    );

    if (!profileData) return "";

    const dateKey = normalizeHistoryDate(date);

    if (!dateKey) {
        return String(profileData.contractType || "").trim();
    }

    const events = contractTypeHistoryEvents(profile);

    if (!events.length) {
        const historyType = getGradeHistory(profile)
            .filter(entry =>
                entry.start <= dateKey &&
                entry.contractType
            )
            .at(-1)?.contractType;

        return historyType ||
            String(profileData.contractType || "").trim();
    }

    let effectiveType =
        events[0].from || String(profileData.contractType || "").trim();

    for (const event of events) {
        if (event.effectiveDate > dateKey) break;
        effectiveType = event.to;
    }

    return effectiveType || String(profileData.contractType || "").trim();
}

function normalizeEstamento(value){
    const source = String(value || "").trim();

    if (!source) return "Profesional";

    const normalized = normalizeTextKey(source);

    if (normalized === "tecnico") return "T\u00e9cnico";
    if (normalized === "administrativo") return "Administrativo";
    if (normalized === "auxiliar") return "Auxiliar";

    return "Profesional";
}

function usesProfessionCoverage(profile = {}) {
    const estamento = normalizeEstamento(profile.estamento);

    return (
        estamento === "Profesional" ||
        estamento === "T\u00e9cnico"
    );
}

function coverageGroupKey(profile = {}) {
    if (usesProfessionCoverage(profile)) {
        const profession = normalizeProfession(
            profile.profession,
            profile.estamento
        );

        if (profession === SIN_INFORMACION_PROFESSION) {
            return `profession:${normalizeEstamento(profile.estamento)}:${profession}`;
        }

        return `profession:${profession}`;
    }

    return `role:${normalizeEstamento(profile.estamento)}`;
}

export function profileCanCoverProfile(candidate, target) {
    if (!candidate || !target) return false;

    return coverageGroupKey(candidate) === coverageGroupKey(target);
}

function normalizeRotativaType(value){
    const source = String(value || "").trim();
    const normalized = stripAccents(source).toLowerCase();

    if (
        normalized === "3turno" ||
        normalized === "3 turno" ||
        normalized === "3er turno" ||
        normalized === "tercer turno"
    ) {
        return "3turno";
    }

    if (
        normalized === "4turno" ||
        normalized === "4 turno" ||
        normalized === "4oturno" ||
        normalized === "cuarto turno"
    ) {
        return "4turno";
    }

    if (normalized === "diurno") {
        return "diurno";
    }

    if (normalized === "libre") {
        return "libre";
    }

    if (
        normalized === "reemplazo" ||
        normalized === "replacement"
    ) {
        return "reemplazo";
    }

    return "";
}

function normalizeRotationFirstTurn(value) {
    const normalized = stripAccents(String(value || "")).toLowerCase();

    if (
        normalized === "larga2" ||
        normalized === "largo2" ||
        normalized === "segunda larga" ||
        normalized === "segundo largo" ||
        normalized === "2 larga" ||
        normalized === "2 largo"
    ) {
        return "larga2";
    }

    if (
        normalized === "noche2" ||
        normalized === "segunda noche" ||
        normalized === "2 noche"
    ) {
        return "noche2";
    }

    if (
        normalized === "libre2" ||
        normalized === "segundo libre" ||
        normalized === "segunda libre" ||
        normalized === "2 libre"
    ) {
        return "libre2";
    }

    if (
        normalized === "libre" ||
        normalized === "libre1" ||
        normalized === "primer libre" ||
        normalized === "primera libre" ||
        normalized === "1 libre"
    ) {
        return "libre1";
    }

    return normalized === "noche"
        ? "noche"
        : "larga";
}

function moveStorageKey(oldKey, newKey){
    moveKey(oldKey, newKey);
}

// Memoizacion de getProfiles: el `.map` normaliza id/estamento/profesion de los
// ~68 perfiles y se llamaba miles de veces por render (era ~41% del CPU). Se
// cachea por la CADENA CRUDA de "profiles" (cambia al guardar). Se devuelve una
// copia superficial del array, asi las mutaciones de primer nivel (push, splice,
// reasignar un perfil) no tocan la cache; el patron editar+guardar reescribe la
// clave y regenera la cache.
let PROFILES_CACHE = { raw: null, value: null };

export function getProfiles(){
    const raw = getRaw("profiles", "");

    if (raw && raw === PROFILES_CACHE.raw && PROFILES_CACHE.value) {
        return PROFILES_CACHE.value.slice();
    }

    const value = asRecordList(getJSON("profiles", [])).map(profile => {
        if (typeof profile === "string") {
            return {
                id: createProfileId({ name: profile }),
                name: profile,
                estamento: "Profesional",
                profession: "Sin informacion"
            };
        }

        const { unit, ...profileWithoutUnit } = profile || {};
        const estamento = normalizeEstamento(profile.estamento);

        return {
            ...profileWithoutUnit,
            id: createProfileId(profile),
            estamento,
            profession: normalizeProfession(
                profile.profession,
                estamento
            )
        };
    });

    if (raw) {
        PROFILES_CACHE = { raw, value };
    }

    return value.slice();
}

export function isProfileActive(profileOrName){
    const profile = typeof profileOrName === "string"
        ? getProfiles().find(item =>
            item.name === profileOrName
        )
        : profileOrName;

    if (!profile) return false;

    return profile.active !== false;
}

/**
 * Devuelve una lista de registros aunque lo guardado haya quedado como objeto.
 *
 * Un delta mal aplicado puede dejar una lista convertida en un mapa
 * `{ id: registro }`. Los registros siguen ahi, solo cambio el envase: se
 * recuperan con Object.values en vez de perderlos. Y un valor que no sea ni
 * lista ni objeto devuelve lista vacia, para que un dato roto no reviente cada
 * pantalla que lo recorre.
 *
 * Es una lectura tolerante a proposito: estas listas las escriben varios
 * supervisores a la vez, y una pantalla en blanco es mucho peor que un dato
 * raro.
 */
export function asRecordList(value) {
    if (Array.isArray(value)) return value;

    if (value && typeof value === "object") {
        return Object.values(value).filter(item =>
            item && typeof item === "object"
        );
    }

    return [];
}

export function getSwaps(){
    return asRecordList(getJSON("swaps", []));
}

export function saveSwaps(data){
    setJSON("swaps", data);
}

export function getReplacements(){
    return asRecordList(getJSON("replacements", []));
}

export function saveReplacements(data){
    setJSON("replacements", data);
}

// Dias marcados por el supervisor como "no requiere cobertura": aunque el
// trabajador tenga un permiso/licencia sobre un turno base, no se solicita
// reemplazo (se suprime el signo de exclamacion en calendario/timeline/staffing).
export function getNoCoverageDays(profile){
    return getJSON(`noCoverage_${profile}`, {});
}

// El valor guardado es `true` (marcas antiguas, sin comentario) o un objeto
// { reason } cuando el supervisor explico por que ese turno no necesita
// reemplazo. Por eso se evalua por verdadero y no contra `true`.
export function isNoCoverageDay(profile, keyDay){
    return Boolean(getNoCoverageDays(profile)[keyDay]);
}

export function getNoCoverageReason(profile, keyDay){
    const value = getNoCoverageDays(profile)[keyDay];

    if (!value || typeof value !== "object") return "";

    return String(value.reason || "").trim();
}

export function setNoCoverageDay(profile, keyDay, value, reason = ""){
    const map = getNoCoverageDays(profile);
    const cleanReason = String(reason || "").trim();

    if (value) {
        map[keyDay] = cleanReason ? { reason: cleanReason } : true;
    } else {
        delete map[keyDay];
    }

    setJSON(`noCoverage_${profile}`, map);
}

const DEFAULT_REPLACEMENT_REQUEST_CONFIG = {
    // 24 horas. Una solicitud que caducaba en 60 minutos vencia de noche o en
    // el turno siguiente antes de que el trabajador alcanzara a mirar el
    // telefono, y el supervisor volvia a quedar sin cobertura sin enterarse.
    expiresMinutes: 24 * 60,
    enableLinkedUnitSuggestions: true,
    enableCrossRoleSuggestions: true,
    enableWorkerAcceptanceRequest: true
};

const DEFAULT_REPORT_SIGNATURE_CONFIG = {
    lines: ["", "", "", ""]
};

export const DEFAULT_TURN_CHANGE_CONFIG = {
    allowSwaps: true,
    allowDifferentTurnTypes: true,
    allowTwentyFourHourShifts: true,
    allowInvertedTwentyFourHourShifts: true,
    // Un Diurno pegado al dia siguiente de un 24h encadena 33 horas de jornada
    // (08:00 del dia 1 a las 17:00 del dia 2), asi que arranca DESACTIVADO: es
    // una excepcion que la unidad habilita a proposito, no el comportamiento
    // por defecto. Solo tiene sentido con los turnos 24 permitidos.
    allowDiurnoAfterTwentyFour: false,
    // Dos funcionarios en un mismo turno: al recortarle la jornada a quien
    // cubre un permiso, el tramo que queda se le puede dar a otro. Arranca
    // DESACTIVADO porque no todas las unidades parten un turno en dos; sin
    // esto, recortar la jornada no ofrece nada y el turno sigue dandose por
    // cubierto, como hasta ahora.
    allowSplitShiftCoverage: false,
    limitMonthlySwaps: false,
    monthlySwapLimit: 2
};

function normalizeReplacementRequestConfig(config = {}) {
    const expiresMinutes = Number(config.expiresMinutes);

    return {
        enableLinkedUnitSuggestions:
            config.enableLinkedUnitSuggestions !== false,
        enableCrossRoleSuggestions:
            config.enableCrossRoleSuggestions !== false,
        enableWorkerAcceptanceRequest:
            config.enableWorkerAcceptanceRequest !== false,
        expiresMinutes:
            Number.isFinite(expiresMinutes) && expiresMinutes > 0
                ? Math.round(expiresMinutes)
                : DEFAULT_REPLACEMENT_REQUEST_CONFIG.expiresMinutes
    };
}

function normalizeTurnChangeConfig(config = {}) {
    const monthlySwapLimit = Number(config.monthlySwapLimit);

    return {
        allowSwaps:
            config.allowSwaps !== false,
        allowDifferentTurnTypes:
            config.allowDifferentTurnTypes !== false,
        allowTwentyFourHourShifts:
            config.allowTwentyFourHourShifts !== false,
        allowInvertedTwentyFourHourShifts:
            config.allowInvertedTwentyFourHourShifts !== false,
        // Depende de los turnos 24: sin ellos no hay dia siguiente a un 24 que
        // habilitar, y dejar el flag suelto en true escondia una excepcion
        // activa detras de un ajuste apagado.
        allowDiurnoAfterTwentyFour:
            config.allowDiurnoAfterTwentyFour === true &&
            config.allowTwentyFourHourShifts !== false,
        allowSplitShiftCoverage:
            config.allowSplitShiftCoverage === true,
        limitMonthlySwaps:
            config.limitMonthlySwaps === true,
        monthlySwapLimit:
            Number.isFinite(monthlySwapLimit) && monthlySwapLimit > 0
                ? Math.round(monthlySwapLimit)
                : DEFAULT_TURN_CHANGE_CONFIG.monthlySwapLimit
    };
}

function normalizeReportSignatureConfig(config = {}) {
    const source = Array.isArray(config.lines)
        ? config.lines
        : [];
    const lines = DEFAULT_REPORT_SIGNATURE_CONFIG.lines.map(
        (_line, index) =>
            String(source[index] ?? "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 120)
    );

    return { lines };
}

function normalizeReplacementRequest(request = {}) {
    if (!request?.id) return null;

    return {
        ...request,
        id: String(request.id),
        groupId: String(request.groupId || request.id),
        groupSize: Number(request.groupSize) || 1,
        status: String(request.status || "pending"),
        worker: String(request.worker || ""),
        workerProfileId: String(request.workerProfileId || ""),
        workerUid: String(request.workerUid || request.uid || ""),
        workerEmail: String(request.workerEmail || ""),
        replaced: String(request.replaced || ""),
        replacedProfileId: String(request.replacedProfileId || ""),
        date: String(request.date || ""),
        keyDay: String(request.keyDay || ""),
        turno: String(request.turno || ""),
        turnoLabel: String(request.turnoLabel || ""),
        absenceType: String(request.absenceType || ""),
        source: String(request.source || "replacement_request"),
        channel: String(request.channel || "app"),
        phone: String(request.phone || ""),
        createdAt: String(request.createdAt || new Date().toISOString()),
        expiresAt: String(request.expiresAt || ""),
        canceledAt: String(request.canceledAt || ""),
        acceptedAt: String(request.acceptedAt || ""),
        rejectedAt: String(request.rejectedAt || ""),
        expiredAt: String(request.expiredAt || ""),
        appliedAt: String(request.appliedAt || ""),
        supersededAt: String(request.supersededAt || ""),
        supersededByRequestId:
            String(request.supersededByRequestId || "")
    };
}

export function getReplacementRequestConfig() {
    return normalizeReplacementRequestConfig(
        getJSON(
            "replacementRequestConfig",
            DEFAULT_REPLACEMENT_REQUEST_CONFIG
        )
    );
}

export function saveReplacementRequestConfig(config) {
    setJSON(
        "replacementRequestConfig",
        normalizeReplacementRequestConfig(config)
    );
}

export function getTurnChangeConfig() {
    return normalizeTurnChangeConfig(
        getJSON(
            "turnChangeConfig",
            DEFAULT_TURN_CHANGE_CONFIG
        )
    );
}

export function saveTurnChangeConfig(config) {
    setJSON(
        "turnChangeConfig",
        normalizeTurnChangeConfig(config)
    );
}

/* =========================================================
   Nombres de los administradores de la unidad

   El saludo del inicio mostraba la firma del supervisor a TODOS los usuarios,
   asi que un colaborador invitado veia el nombre de otra persona. El nombre que
   trae el documento del miembro viene de su cuenta de Google y no siempre sirve
   ("usuario123", el correo, o vacio).

   Aca se guarda el nombre que el supervisor decide para cada administrador,
   indexado por correo. Manda sobre el de la cuenta, y se puede corregir en
   Ajustes sin tocar la cuenta de nadie.
========================================================= */

function normalizeAdminNameKey(email) {
    return String(email || "").trim().toLowerCase();
}

export function getAdminDisplayNames() {
    const stored = getJSON("adminDisplayNames", {});

    if (!stored || typeof stored !== "object") return {};

    return Object.entries(stored).reduce((map, [email, name]) => {
        const key = normalizeAdminNameKey(email);
        const clean = String(name || "").trim().slice(0, 80);

        if (key && clean) map[key] = clean;

        return map;
    }, {});
}

export function saveAdminDisplayNames(names) {
    setJSON("adminDisplayNames", getAdminDisplayNamesFrom(names));
}

function getAdminDisplayNamesFrom(names) {
    if (!names || typeof names !== "object") return {};

    return Object.entries(names).reduce((map, [email, name]) => {
        const key = normalizeAdminNameKey(email);
        const clean = String(name || "").trim().slice(0, 80);

        if (key && clean) map[key] = clean;

        return map;
    }, {});
}

export function getAdminDisplayName(email) {
    return getAdminDisplayNames()[normalizeAdminNameKey(email)] || "";
}

export function setAdminDisplayName(email, name) {
    const key = normalizeAdminNameKey(email);

    if (!key) return;

    const names = getAdminDisplayNames();
    const clean = String(name || "").trim().slice(0, 80);

    if (clean) {
        names[key] = clean;
    } else {
        delete names[key];
    }

    saveAdminDisplayNames(names);
}

export function getReportSignatureConfig() {
    return normalizeReportSignatureConfig(
        getJSON(
            "reportSignatureConfig",
            DEFAULT_REPORT_SIGNATURE_CONFIG
        )
    );
}

export function saveReportSignatureConfig(config) {
    setJSON(
        "reportSignatureConfig",
        normalizeReportSignatureConfig(config)
    );
}

export function getReplacementRequests() {
    return asRecordList(getJSON("replacementRequests", []))
        .map(normalizeReplacementRequest)
        .filter(Boolean);
}

export function saveReplacementRequests(requests, options = {}) {
    const normalized = (Array.isArray(requests) ? requests : [])
        .map(normalizeReplacementRequest)
        .filter(Boolean);

    setJSON("replacementRequests", normalized);

    if (
        !options.silent &&
        typeof window !== "undefined"
    ) {
        window.dispatchEvent(
            new CustomEvent("proturnos:replacementRequestsSaved", {
                detail: {
                    requests: normalized,
                    remote: options.remote !== false
                }
            })
        );
    }
}

function normalizeWorkerRequestType(value) {
    const key = normalizeTextKey(value)
        .replace(/1\/2/g, "half")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    if (
        key.includes("p_administrativo") ||
        key.includes("permiso_administrativo") ||
        key === "admin" ||
        key === "administrativo"
    ) {
        return "admin";
    }

    if (
        key.includes("adm_manana") ||
        key.includes("half_adm_manana") ||
        key.includes("half_admin_morning")
    ) {
        return "half_admin_morning";
    }

    if (
        key.includes("adm_tarde") ||
        key.includes("half_adm_tarde") ||
        key.includes("half_admin_afternoon")
    ) {
        return "half_admin_afternoon";
    }

    if (
        key.includes("f_legal") ||
        key.includes("feriado_legal") ||
        key === "legal"
    ) {
        return "legal";
    }

    if (
        key.includes("f_compensatorio") ||
        key.includes("compensatorio") ||
        key === "comp"
    ) {
        return "comp";
    }

    if (
        key.includes("permiso_sin_goce") ||
        key.includes("sin_goce") ||
        key.includes("unpaid")
    ) {
        return "unpaid_leave";
    }

    if (
        key.includes("permiso_gremial") ||
        key.includes("gremial") ||
        key.includes("union")
    ) {
        return "union_leave";
    }

    if (
        key.includes("olvido") ||
        key.includes("sin_marcaje") ||
        key.includes("missing_clock")
    ) {
        return "missing_clock";
    }

    if (
        key.includes("incidencia") ||
        key.includes("marcaje_tardio") ||
        key.includes("clock_incident")
    ) {
        return "clock_incident";
    }

    if (
        key.includes("cambio_turno") ||
        key.includes("swap")
    ) {
        return "swap";
    }

    return key || "unknown";
}

function normalizeWorkerRequestDate(value, keyDay = "") {
    const normalized = normalizeHistoryDate(value);

    if (normalized) return normalized;

    const match = String(keyDay || "")
        .match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

    if (!match) return "";

    return [
        match[1],
        String(Number(match[2]) + 1).padStart(2, "0"),
        String(Number(match[3])).padStart(2, "0")
    ].join("-");
}

function normalizeWorkerRequest(request = {}) {
    if (!request?.id) return null;

    const profile = String(
        request.profile ||
        request.worker ||
        request.workerName ||
        request.profileName ||
        request.from ||
        ""
    ).trim();
    const rawDate =
        request.date ||
        request.startDate ||
        request.fecha ||
        request.keyDay ||
        "";
    const days = Number(
        request.days ??
        request.amount ??
        request.cantidad ??
        request.totalDays ??
        0
    );

    return {
        ...request,
        id: String(request.id),
        type: normalizeWorkerRequestType(
            request.type ||
            request.requestType ||
            request.kind
        ),
        status: String(request.status || "pending"),
        profile,
        profileId: String(request.profileId || request.workerProfileId || ""),
        date: normalizeWorkerRequestDate(rawDate, request.keyDay),
        endDate: normalizeWorkerRequestDate(
            request.endDate || request.fechaTermino || "",
            request.endKeyDay
        ),
        days: Number.isFinite(days) && days > 0 ? days : 0,
        halfType: String(request.halfType || request.period || ""),
        note: String(request.note || request.comment || request.detalle || ""),
        rejectReason: String(request.rejectReason || request.rejectionNote || ""),
        adminNote: String(request.adminNote || ""),
        source: String(request.source || "worker_app"),
        channel: String(request.channel || "app"),
        createdAt: String(request.createdAt || new Date().toISOString()),
        updatedAt: String(request.updatedAt || ""),
        acceptedAt: String(request.acceptedAt || ""),
        rejectedAt: String(request.rejectedAt || ""),
        appliedAt: String(request.appliedAt || ""),
        createdByUid: String(request.createdByUid || request.uid || ""),
        createdByEmail: String(request.createdByEmail || request.email || "")
    };
}

export function getWorkerRequests() {
    return asRecordList(getJSON("workerRequests", []))
        .map(normalizeWorkerRequest)
        .filter(Boolean)
        .sort((a, b) =>
            String(b.createdAt || "").localeCompare(
                String(a.createdAt || "")
            )
        );
}

export function saveWorkerRequests(requests, options = {}) {
    const normalized = (Array.isArray(requests) ? requests : [])
        .map(normalizeWorkerRequest)
        .filter(Boolean);

    setJSON("workerRequests", normalized);

    if (
        !options.silent &&
        typeof window !== "undefined"
    ) {
        window.dispatchEvent(
            new CustomEvent("proturnos:workerRequestsSaved", {
                detail: {
                    requests: normalized,
                    remote: options.remote !== false
                }
            })
        );
    }
}

export function getReplacementContracts(profile = currentProfile){
    if (!profile) return [];

    return getJSON("replacementContracts_" + profile, []);
}

export function saveReplacementContracts(
    contracts,
    profile = currentProfile
){
    if (!profile) return;

    setJSON(
        "replacementContracts_" + profile,
        Array.isArray(contracts) ? contracts : []
    );
}

// Contratos de Honorarios: varios por trabajador, cada uno con su vigencia, valor
// hora y tope semanal (antes era un unico contrato en campos del perfil).
export function getHonorariaContracts(profile = currentProfile){
    if (!profile) return [];

    return getJSON("honorariaContracts_" + profile, []);
}

// Verdadero si el arreglo de contratos ya fue escrito alguna vez (aunque quede
// vacio tras borrar todos). Sirve para NO re-migrar el contrato legado del perfil
// una vez que el trabajador ya paso al modelo de lista.
export function hasHonorariaContractsStored(profile = currentProfile){
    if (!profile) return false;

    return getRaw("honorariaContracts_" + profile, null) !== null;
}

export function saveHonorariaContracts(
    contracts,
    profile = currentProfile
){
    if (!profile) return;

    setJSON(
        "honorariaContracts_" + profile,
        Array.isArray(contracts) ? contracts : []
    );
}

// Valor hora del contrato de Honorarios vigente en `date` (o el mas reciente si
// no hay fecha o ninguno la cubre); cae al campo legado del perfil si todavia no
// hay contratos en el arreglo.
function honorariaHourlyRateForDate(profile, profileData, date){
    const contracts = getHonorariaContracts(profile)
        .filter(contract => contract && contract.start && contract.end);

    if (contracts.length) {
        const iso = normalizeHistoryDate(date);
        const active = iso
            ? contracts.find(contract =>
                String(contract.start) <= iso &&
                String(contract.end) >= iso
            )
            : null;
        const chosen = active || contracts
            .slice()
            .sort((a, b) => String(b.start).localeCompare(String(a.start)))[0];
        const rate = Math.max(0, Number(chosen?.hourlyRate) || 0);

        if (rate > 0) return rate;
    }

    return Math.max(0, Number(profileData?.honorariaHourlyRate) || 0);
}

export function saveProfiles(profiles, options = {}){
    const normalized = (profiles || []).map(profile => {
        const { unit, ...profileWithoutUnit } = profile || {};
        const estamento = normalizeEstamento(profile.estamento);

        return {
            ...profileWithoutUnit,
            id: createProfileId(profile),
            estamento,
            profession: normalizeProfession(
                profile.profession,
                estamento
            )
        };
    });

    setJSON("profiles", normalized);

    if (
        !options.silent &&
        typeof window !== "undefined"
    ) {
        window.dispatchEvent(
            new CustomEvent("proturnos:profilesSaved", {
                detail: {
                    profiles: normalized,
                    remote: options.remote !== false
                }
            })
        );
    }
}

export function setCurrentProfile(profile){
    currentProfile = profile || null;
}

export function getCurrentProfile(){
    return currentProfile;
}

export function getProfileData(profile = currentProfile){
    return getJSON("data_" + profile, {});
}

export function saveProfileData(data, profile = currentProfile){
    setJSON("data_" + profile, data);
}

export function saveProfileDayTurn(
    keyDay,
    turn,
    profile = currentProfile
){
    if (!profile || !keyDay) return {};

    const latestData = getProfileData(profile);
    latestData[keyDay] = turn;
    saveProfileData(latestData, profile);

    return latestData;
}

export function getBaseProfileData(profile = currentProfile){
    return getJSON("baseData_" + profile, {});
}

export function saveBaseProfileData(data, profile = currentProfile){
    setJSON("baseData_" + profile, data);
}

export function getBlockedDays(profile = currentProfile){
    return getJSON("blocked_" + profile, {});
}

export function saveBlockedDays(data, profile = currentProfile){
    setJSON("blocked_" + profile, data);
}

const SHIFT_ASSIGNMENT_HISTORY_PREFIX = "shiftAssignmentHistory_";

function normalizeShiftAssignmentMonth(value = new Date()) {
    if (typeof value === "string") {
        const match = value.trim().match(/^(\d{4})-(\d{2})/);

        if (match) {
            const year = Number(match[1]);
            const month = Number(match[2]);

            if (year >= 1900 && month >= 1 && month <= 12) {
                return `${year}-${String(month).padStart(2, "0")}`;
            }
        }
    }

    const date = value instanceof Date
        ? value
        : new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeShiftAssignmentHistory(raw, legacyAssigned = false) {
    const source = raw && typeof raw === "object" ? raw : {};
    const events = Array.isArray(source.events)
        ? source.events
            .map(event => ({
                month: normalizeShiftAssignmentMonth(event?.month),
                assigned: event?.assigned === true,
                createdAt: String(event?.createdAt || "")
            }))
            .filter(event => event.month)
            .sort((a, b) => a.month.localeCompare(b.month))
        : [];

    return {
        baseline: typeof source.baseline === "boolean"
            ? source.baseline
            : Boolean(legacyAssigned),
        events
    };
}

export function getShiftAssignmentHistory(profile = currentProfile) {
    if (!profile) {
        return { baseline: false, events: [] };
    }

    const legacyAssigned = getJSON("shift_" + profile, false);

    return normalizeShiftAssignmentHistory(
        getJSON(SHIFT_ASSIGNMENT_HISTORY_PREFIX + profile, null),
        legacyAssigned
    );
}

export function getShiftAssignmentConfiguredState(
    profile = currentProfile
) {
    const history = getShiftAssignmentHistory(profile);
    const lastEvent = history.events.at(-1);

    return lastEvent
        ? lastEvent.assigned
        : Boolean(getJSON("shift_" + profile, false));
}

export function getShiftAssigned(
    profile = currentProfile,
    date = new Date()
) {
    if (!profile) return false;

    const rawHistory = getJSON(
        SHIFT_ASSIGNMENT_HISTORY_PREFIX + profile,
        null
    );

    if (!rawHistory || !Array.isArray(rawHistory.events)) {
        return Boolean(getJSON("shift_" + profile, false));
    }

    const targetMonth = normalizeShiftAssignmentMonth(date);
    const history = normalizeShiftAssignmentHistory(
        rawHistory,
        getJSON("shift_" + profile, false)
    );
    let assigned = history.baseline;

    history.events.forEach(event => {
        if (!targetMonth || event.month <= targetMonth) {
            assigned = event.assigned;
        }
    });

    return assigned;
}

export function setShiftAssigned(value, profile = currentProfile){
    setJSON("shift_" + profile, Boolean(value));
}

export function recordShiftAssignmentChange(
    value,
    effectiveMonth,
    profile = currentProfile
) {
    if (!profile) return null;

    const month = normalizeShiftAssignmentMonth(effectiveMonth);

    if (!month) {
        throw new Error(
            "El mes de vigencia de la asignacion de turno no es valido."
        );
    }

    const legacyAssigned = Boolean(
        getJSON("shift_" + profile, false)
    );
    const rawHistory = getJSON(
        SHIFT_ASSIGNMENT_HISTORY_PREFIX + profile,
        null
    );
    const history = normalizeShiftAssignmentHistory(
        rawHistory,
        legacyAssigned
    );
    const nextEvent = {
        month,
        assigned: Boolean(value),
        createdAt: new Date().toISOString()
    };
    const events = history.events
        .filter(event => event.month !== month);

    events.push(nextEvent);
    events.sort((a, b) => a.month.localeCompare(b.month));

    const nextHistory = {
        baseline: rawHistory && typeof rawHistory.baseline === "boolean"
            ? rawHistory.baseline
            : legacyAssigned,
        events
    };
    const configuredState = events.at(-1)?.assigned ?? nextHistory.baseline;

    setJSON(
        SHIFT_ASSIGNMENT_HISTORY_PREFIX + profile,
        nextHistory
    );
    setShiftAssigned(configuredState, profile);

    return nextEvent;
}

export function getValorHora(profile = currentProfile, date = null){
    const profileData = getCompensationProfileAt(profile, date);
    const isHonoraria = normalizeText(profileData?.contractType) === "honorarios";

    if (isHonoraria) {
        const honorariaHourlyRate =
            honorariaHourlyRateForDate(profile, profileData, date);

        if (honorariaHourlyRate > 0) {
            return honorariaHourlyRate;
        }
    }

    const configuredValue = profileData
        ? getGradeHourValue(
            profileData.estamento,
            profileData.grade,
            date
        )
        : 0;

    if (configuredValue > 0) {
        return configuredValue;
    }

    return 0;
}

export function getCarryKey(y, m){
    return `carry_${currentProfile}_${y}_${m}`;
}

// El carry se redondea a 1 decimal (la granularidad de horas de la app) ANTES de
// guardar. Sin esto, calculateCarryOver devuelve floats con micro-variación
// (p.ej. 1.2999999 vs 1.3) y cada recálculo produce un JSON distinto: setRaw lo
// detecta como "cambio", se sincroniza a Firestore, vuelve por onSnapshot,
// dispara otro re-render que recalcula y reescribe... un loop infinito que
// mantenía el hilo principal ocupado (freezes de 9-39s). Al redondear, el valor
// queda estable y setRaw (que compara strings) corta el loop.
function roundCarryHour(value){
    const rounded = Math.round((Number(value) || 0) * 10) / 10;
    return Object.is(rounded, -0) ? 0 : rounded;
}

export function saveCarry(y, m, data){
    setJSON(getCarryKey(y, m), {
        d: roundCarryHour(data?.d),
        n: roundCarryHour(data?.n)
    });
}

export function getCarry(y, m){
    return getJSON(getCarryKey(y, m), { d: 0, n: 0 });
}

export function getAdminDays(){
    return getJSON("admin_" + currentProfile, {});
}

export function saveAdminDays(data){
    setJSON("admin_" + currentProfile, data);
}

export function getLegalDays(){
    return getJSON("legal_" + currentProfile, {});
}

export function saveLegalDays(data){
    setJSON("legal_" + currentProfile, data);
}

export function getCompDays(){
    return getJSON("comp_" + currentProfile, {});
}

export function saveCompDays(data){
    setJSON("comp_" + currentProfile, data);
}

export function getManualLeaveBalances(
    year = new Date().getFullYear(),
    profile = currentProfile
) {
    if (!profile) return {};

    const allBalances = getJSON(
        "leaveBalances_" + profile,
        {}
    );

    return allBalances[String(year)] || {};
}

export function saveManualLeaveBalances(
    year = new Date().getFullYear(),
    balances = {},
    profile = currentProfile
) {
    if (!profile) return;

    const allBalances = getJSON(
        "leaveBalances_" + profile,
        {}
    );
    const currentYearBalances =
        allBalances[String(year)] || {};
    const nextBalances = {
        ...currentYearBalances
    };

    ["legal", "comp", "admin", "hoursReturn"].forEach(field => {
        if (
            !Object.prototype.hasOwnProperty.call(
                balances,
                field
            )
        ) {
            return;
        }

        nextBalances[field] = Math.max(
            0,
            Number(balances[field]) || 0
        );
    });

    allBalances[String(year)] = nextBalances;

    setJSON("leaveBalances_" + profile, allBalances);
}

export function getAbsences(){
    return getJSON("absences_" + currentProfile, {});
}

export function saveAbsences(data){
    setJSON("absences_" + currentProfile, data);
}

export function getRotativa(profile = currentProfile){
    const raw = getRaw("rotativa_" + profile, null);

    if (!raw) {
        return {
            type: "",
            start: "",
            firstTurn: "larga"
        };
    }

    try {
        const parsed = JSON.parse(raw);

        if (typeof parsed === "string") {
            return {
                type: "4turno",
                start: parsed,
                firstTurn: "larga"
            };
        }

        if (parsed && typeof parsed === "object") {
            return {
                type: normalizeRotativaType(parsed.type),
                start: String(parsed.start || ""),
                firstTurn: normalizeRotationFirstTurn(parsed.firstTurn)
            };
        }
    } catch {
        return {
            type: "4turno",
            start: raw,
            firstTurn: "larga"
        };
    }

    return {
        type: "",
        start: "",
        firstTurn: "larga"
    };
}

export function saveRotativa(rotativa, profile = currentProfile){
    const type = normalizeRotativaType(rotativa?.type);
    const start = String(rotativa?.start || "");
    const firstTurn = normalizeRotationFirstTurn(rotativa?.firstTurn);

    if (!type) {
        removeKey("rotativa_" + profile);
        return;
    }

    setJSON("rotativa_" + profile, { type, start, firstTurn });
}

export function updateProfile(oldName, nextProfile){
    const profiles = getProfiles();
    const targetName = String(
        nextProfile?.name || ""
    ).trim();

    if (!targetName) {
        throw new Error(
            "El nombre del colaborador es obligatorio."
        );
    }

    if (
        profiles.some(
            profile =>
                profile.name !== oldName &&
                profile.name === targetName
        )
    ) {
        throw new Error("Ese perfil ya existe.");
    }

    const updatedProfiles = profiles.map(profile => {
        if (profile.name !== oldName) {
            return profile;
        }

        const estamento = normalizeEstamento(
            nextProfile.estamento ?? profile.estamento
        );

        return {
            ...profile,
            ...nextProfile,
            name: targetName,
            estamento,
            profession: normalizeProfession(
                nextProfile.profession ?? profile.profession,
                estamento
            )
        };
    });

    saveProfiles(updatedProfiles);

    if (oldName === targetName) {
        if (currentProfile === oldName) {
            currentProfile = targetName;
        }
        return;
    }

    const keysToMove = [
        "data_",
        "blocked_",
        "contingency_",
        "baseData_",
        "shift_",
        "shiftAssignmentHistory_",
        "admin_",
        "legal_",
        "comp_",
        "leaveHold_",
        "absences_",
        "rotativa_",
        "leaveBalances_",
        "hourReturns_",
        "hheeReturnTransfers_",
        "replacementContracts_",
        "honorariaContracts_",
        "clockMarks_",
        "hrLogs_",
        "gradeHistory_",
        "contractHistory_"
    ];

    keysToMove.forEach(prefix => {
        moveStorageKey(
            `${prefix}${oldName}`,
            `${prefix}${targetName}`
        );
    });

    const carryPrefix = `carry_${oldName}_`;
    const carryKeys = listKeys(carryPrefix);

    carryKeys.forEach(key => {
        moveStorageKey(
            key,
            key.replace(
                carryPrefix,
                `carry_${targetName}_`
            )
        );
    });

    const swaps = getSwaps().map(swap => ({
        ...swap,
        from: swap.from === oldName
            ? targetName
            : swap.from,
        to: swap.to === oldName
            ? targetName
            : swap.to
    }));

    saveSwaps(swaps);

    const shiftMoves = getJSON("shiftMoves", []).map(move => ({
        ...move,
        profile: move.profile === oldName
            ? targetName
            : move.profile
    }));

    setJSON("shiftMoves", shiftMoves);

    const replacements = getReplacements().map(replacement => ({
        ...replacement,
        worker: replacement.worker === oldName
            ? targetName
            : replacement.worker,
        replaced: replacement.replaced === oldName
            ? targetName
            : replacement.replaced
    }));

    saveReplacements(replacements);

    const replacementRequests = getReplacementRequests().map(request => ({
        ...request,
        worker: request.worker === oldName
            ? targetName
            : request.worker,
        replaced: request.replaced === oldName
            ? targetName
            : request.replaced
    }));

    saveReplacementRequests(replacementRequests);

    // Campañas de cobertura automatica. Se tocan por su clave cruda y no por
    // autoCoverage.js: ese modulo importa storage.js, y al reves quedaria un
    // ciclo entre los dos.
    const autoCoverageCampaigns = getJSON("autoCoverageCampaigns", [])
        .map(campaign => ({
            ...campaign,
            replaced: campaign.replaced === oldName
                ? targetName
                : campaign.replaced
        }));

    setJSON("autoCoverageCampaigns", autoCoverageCampaigns);

    const workerRequests = getWorkerRequests().map(request => ({
        ...request,
        profile: request.profile === oldName
            ? targetName
            : request.profile,
        worker: request.worker === oldName
            ? targetName
            : request.worker,
        workerName: request.workerName === oldName
            ? targetName
            : request.workerName,
        targetProfile: request.targetProfile === oldName
            ? targetName
            : request.targetProfile,
        from: request.from === oldName
            ? targetName
            : request.from,
        to: request.to === oldName
            ? targetName
            : request.to
    }));

    saveWorkerRequests(workerRequests);

    const replaceProfileName = value => {
        if (!oldName || value === null || value === undefined) {
            return value;
        }

        return String(value).split(oldName).join(targetName);
    };
    const memos = getJSON("memos", []).map(memo => ({
        ...memo,
        profile: memo.profile === oldName
            ? targetName
            : memo.profile,
        sourceId: replaceProfileName(memo.sourceId),
        detail: replaceProfileName(memo.detail)
    }));

    setJSON("memos", memos);

    if (currentProfile === oldName) {
        currentProfile = targetName;
    }

    if (typeof window !== "undefined") {
        window.dispatchEvent(
            new CustomEvent("proturnos:profileRenamed", {
                detail: {
                    oldName,
                    newName: targetName
                }
            })
        );
    }
}
