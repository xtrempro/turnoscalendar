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
        15: 6107.22
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
    return String(value || "")
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
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
    return String(value || "")
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
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

function normalizeGradeHourConfig(config = {}) {
    return {
        professional: normalizeRateMap(
            config.professional,
            DEFAULT_GRADE_HOUR_CONFIG.professional
        ),
        general: normalizeRateMap(
            config.general,
            DEFAULT_GRADE_HOUR_CONFIG.general
        )
    };
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
    setJSON(
        "gradeHourConfig",
        normalizeGradeHourConfig(config)
    );
}

export function getGradeHourValue(estamento, grade) {
    const group = gradeHourGroup(estamento);
    const config = getGradeHourConfig();

    return Number(config[group]?.[String(grade)] || 0);
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

    if (!start || !grade) return null;

    return {
        id: String(entry.id || `${start}_${grade}`),
        start,
        grade,
        estamento: normalizeEstamento(entry.estamento),
        contractType: String(entry.contractType || "").trim(),
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

    if (!dateKey) {
        return profileData;
    }

    const history = getGradeHistory(profile);
    const matches = history.filter(item =>
        item.start <= dateKey
    );
    const entry = matches[matches.length - 1];

    if (!entry) {
        return profileData;
    }

    return {
        ...profileData,
        grade: entry.grade,
        estamento: entry.estamento || profileData.estamento,
        contractType:
            entry.contractType || profileData.contractType
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
    const normalized = source
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

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

    if (
        normalized === "reemplazo" ||
        normalized === "replacement"
    ) {
        return "reemplazo";
    }

    return "";
}

function normalizeRotationFirstTurn(value) {
    const normalized = String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

    return normalized === "noche"
        ? "noche"
        : "larga";
}

function moveStorageKey(oldKey, newKey){
    moveKey(oldKey, newKey);
}

export function getProfiles(){
    const raw = getJSON("profiles", []);

    return raw.map(profile => {
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

export function getSwaps(){
    return getJSON("swaps", []);
}

export function saveSwaps(data){
    setJSON("swaps", data);
}

export function getReplacements(){
    return getJSON("replacements", []);
}

export function saveReplacements(data){
    setJSON("replacements", data);
}

const DEFAULT_REPLACEMENT_REQUEST_CONFIG = {
    expiresMinutes: 60
};

export const DEFAULT_TURN_CHANGE_CONFIG = {
    allowSwaps: true,
    allowDifferentTurnTypes: true,
    allowTwentyFourHourShifts: true,
    allowInvertedTwentyFourHourShifts: true
};

function normalizeReplacementRequestConfig(config = {}) {
    const expiresMinutes = Number(config.expiresMinutes);

    return {
        expiresMinutes:
            Number.isFinite(expiresMinutes) && expiresMinutes > 0
                ? Math.round(expiresMinutes)
                : DEFAULT_REPLACEMENT_REQUEST_CONFIG.expiresMinutes
    };
}

function normalizeTurnChangeConfig(config = {}) {
    return {
        allowSwaps:
            config.allowSwaps !== false,
        allowDifferentTurnTypes:
            config.allowDifferentTurnTypes !== false,
        allowTwentyFourHourShifts:
            config.allowTwentyFourHourShifts !== false,
        allowInvertedTwentyFourHourShifts:
            config.allowInvertedTwentyFourHourShifts !== false
    };
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

export function getReplacementRequests() {
    return getJSON("replacementRequests", [])
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
    return getJSON("workerRequests", [])
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

export function getShiftAssigned(profile = currentProfile){
    return getJSON("shift_" + profile, false);
}

export function setShiftAssigned(value, profile = currentProfile){
    setJSON("shift_" + profile, Boolean(value));
}

export function getValorHora(profile = currentProfile, date = null){
    const profileData = getCompensationProfileAt(profile, date);
    const configuredValue = profileData
        ? getGradeHourValue(
            profileData.estamento,
            profileData.grade
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

export function saveCarry(y, m, data){
    setJSON(getCarryKey(y, m), data);
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
        "baseData_",
        "shift_",
        "admin_",
        "legal_",
        "comp_",
        "absences_",
        "rotativa_",
        "leaveBalances_",
        "hourReturns_",
        "hheeReturnTransfers_",
        "replacementContracts_",
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
