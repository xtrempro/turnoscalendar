// Estado del borrador de perfil (crear / editar / ver) y su API basica.
//
// `profileDraft` es un objeto mutable COMPARTIDO: los modulos que lo importan
// operan sobre la misma instancia (en ES modules el binding exportado apunta al
// mismo objeto, y mutar sus propiedades funciona entre modulos). Por eso nunca
// se reasigna; solo se mutan sus campos. La API centraliza operaciones como el
// reinicio para evitar mutaciones dispersas.

import {
    isReplacementContractType,
    isHonorariaContractType,
    getContractsForProfile
} from "./contracts.js";
import {
    normalizeStoredStart,
    compareISODate,
    toInputDate,
    formatDisplayDate
} from "./dateUtils.js";
import {
    requiresRotationFirstTurn,
    requiresRotationStart,
    normalizeRotationFirstTurn
} from "./rotationUtils.js";
import {
    getRotativa,
    isProfileActive,
    getShiftAssigned,
    normalizeProfession,
    getCurrentProfile
} from "./storage.js";

export const PROFILE_MODE = {
    VIEW: "view",
    CREATE: "create",
    EDIT: "edit"
};

export const PROFILE_BIRTH_DATE_DEFAULT = "2000-01-01";
export const PROFILE_UNIT_ENTRY_DATE_ENABLED = false;

export function isUnitEntryDateEnabled() {
    return PROFILE_UNIT_ENTRY_DATE_ENABLED;
}

// Valores por defecto al limpiar el borrador (no incluye `mode`). Es una factory
// para devolver siempre un `docs` (array) nuevo y evitar referencias compartidas.
function clearedDraftValues() {
    return {
        originalName: "",
        originalRotationType: "",
        originalRotationStart: "",
        originalRotationFirstTurn: "larga",
        originalContractType: "",
        originalEstamento: "",
        originalGrade: "",
        name: "",
        email: "",
        rut: "",
        phone: "",
        birthDate: PROFILE_BIRTH_DATE_DEFAULT,
        docs: [],
        active: true,
        unit: "",
        unitEntryDate: "",
        contractType: "",
        estamento: "",
        profession: "Sin informacion",
        grade: "",
        rotationType: "",
        rotationStart: "",
        rotationFirstTurn: "larga",
        contractStart: "",
        contractEnd: "",
        contractReplaces: "",
        contractReason: "",
        contractLeaveRef: "",
        honorariaStart: "",
        honorariaEnd: "",
        honorariaHourlyRate: "",
        honorariaMaxMonthlyHours: "",
        unionLeaveEnabled: false,
        shiftAssigned: false
    };
}

// Estado inicial: igual a los valores limpios pero con fecha de nacimiento vacia
// (la fecha por defecto solo se aplica al limpiar tras empezar a editar).
export const profileDraft = {
    mode: PROFILE_MODE.VIEW,
    ...clearedDraftValues(),
    birthDate: ""
};

/**
 * Reinicia los campos del borrador a sus valores por defecto, conservando el
 * modo actual.
 */
export function resetProfileDraft() {
    Object.assign(profileDraft, clearedDraftValues());
}

/**
 * Indica si el borrador (o un objeto dado) corresponde a un contrato de
 * reemplazo.
 * @param {Object} data
 * @returns {boolean}
 */
export function isReplacementDraft(data = profileDraft) {
    return isReplacementContractType(data.contractType);
}

/**
 * Indica si el borrador (o un objeto dado) corresponde a un contrato de
 * honorarios.
 * @param {Object} data
 * @returns {boolean}
 */
export function isHonorariaDraft(data = profileDraft) {
    return isHonorariaContractType(data.contractType);
}

/**
 * Indica si el borrador esta en modo edicion o creacion (no solo viendo).
 * @returns {boolean}
 */
export function isProfileEditing() {
    return profileDraft.mode !== PROFILE_MODE.VIEW;
}

// --- Consultas derivadas del borrador (movidas desde main.js) ---

export function hasRotationChanged() {
    if (profileDraft.mode !== PROFILE_MODE.EDIT) {
        return false;
    }

    return (
        profileDraft.rotationType !==
            profileDraft.originalRotationType ||
        normalizeStoredStart(profileDraft.rotationStart) !==
            normalizeStoredStart(
                profileDraft.originalRotationStart
            ) ||
        (
            requiresRotationFirstTurn(profileDraft.rotationType) &&
            normalizeRotationFirstTurn(profileDraft.rotationFirstTurn) !==
                normalizeRotationFirstTurn(
                    profileDraft.originalRotationFirstTurn
                )
        )
    );
}

export function getDraftUnitEntryDate() {
    if (!PROFILE_UNIT_ENTRY_DATE_ENABLED) return "";

    return normalizeStoredStart(profileDraft.unitEntryDate || "");
}

export function isBeforeDraftUnitEntryDate(value) {
    const unitEntryDate = getDraftUnitEntryDate();

    return Boolean(
        value &&
        unitEntryDate &&
        compareISODate(value, unitEntryDate) < 0
    );
}

export function rotationStartBeforeUnitEntryMessage(
    value,
    unitEntryDate = getDraftUnitEntryDate()
) {
    return `La rotativa no puede comenzar el ${formatDisplayDate(value)} porque la fecha de ingreso a la unidad es ${formatDisplayDate(unitEntryDate)}.`;
}

export function shouldRequireUnitEntryForRotation() {
    return Boolean(
        !isReplacementDraft() &&
        requiresRotationStart(profileDraft.rotationType) &&
        (
            profileDraft.mode === PROFILE_MODE.CREATE ||
            hasRotationChanged()
        )
    );
}

export function isFirstProfileRotationConfig(type = profileDraft.rotationType) {
    if (profileDraft.mode === PROFILE_MODE.CREATE) {
        return true;
    }

    if (profileDraft.mode !== PROFILE_MODE.EDIT) {
        return !profileDraft.rotationStart;
    }

    return (
        !profileDraft.originalRotationType ||
        (
            requiresRotationStart(profileDraft.originalRotationType) &&
            !profileDraft.originalRotationStart
        )
    );
}

export function getRotationConfigDefaultStart(type = profileDraft.rotationType) {
    if (!requiresRotationStart(type)) {
        return "";
    }

    if (!PROFILE_UNIT_ENTRY_DATE_ENABLED) {
        return toInputDate(new Date());
    }

    const unitEntryDate = getDraftUnitEntryDate();
    const candidate = isFirstProfileRotationConfig(type)
        ? unitEntryDate
        : toInputDate(new Date());

    if (
        unitEntryDate &&
        candidate &&
        compareISODate(candidate, unitEntryDate) < 0
    ) {
        return unitEntryDate;
    }

    return candidate;
}

export function hasGradeValueChanged() {
    if (profileDraft.mode !== PROFILE_MODE.EDIT) {
        return false;
    }

    return (
        String(profileDraft.grade || "") !==
            String(profileDraft.originalGrade || "") ||
        String(profileDraft.estamento || "") !==
            String(profileDraft.originalEstamento || "")
    );
}

/**
 * Carga un perfil guardado en el borrador (incluye originales para diff).
 * @param {Object} profile
 */
export function loadDraftFromProfile(profile){
    const rotativa = getRotativa(profile.name);
    const legacyReplacement =
        rotativa.type === "reemplazo";
    const rotationStart =
        normalizeStoredStart(rotativa.start);

    profileDraft.originalName = profile.name;
    profileDraft.originalRotationType =
        rotativa.type || "";
    profileDraft.originalRotationStart =
        rotationStart;
    profileDraft.originalRotationFirstTurn =
        normalizeRotationFirstTurn(rotativa.firstTurn);
    profileDraft.originalContractType = profile.contractType || "";
    profileDraft.originalEstamento = profile.estamento || "";
    profileDraft.originalGrade = String(profile.grade || "");
    profileDraft.name = profile.name;
    profileDraft.email = profile.email || "";
    profileDraft.rut = profile.rut || "";
    profileDraft.phone = profile.phone || "";
    profileDraft.birthDate = profile.birthDate || "";
    profileDraft.docs = Array.isArray(profile.docs)
        ? [...profile.docs]
        : [];
    profileDraft.active = isProfileActive(profile);
    profileDraft.unit = "";
    profileDraft.unitEntryDate = PROFILE_UNIT_ENTRY_DATE_ENABLED
        ? profile.unitEntryDate || ""
        : "";
    profileDraft.contractType = legacyReplacement
        ? "Reemplazo"
        : profile.contractType || "";
    profileDraft.estamento = profile.estamento || "";
    profileDraft.unionLeaveEnabled =
        Boolean(profile.unionLeaveEnabled);
    profileDraft.profession = normalizeProfession(
        profile.profession,
        profileDraft.estamento
    );
    profileDraft.grade = String(profile.grade || "");
    profileDraft.rotationType = legacyReplacement
        ? ""
        : rotativa.type || "";
    profileDraft.rotationStart = legacyReplacement
        ? ""
        : rotationStart;
    profileDraft.rotationFirstTurn =
        normalizeRotationFirstTurn(rotativa.firstTurn);
    profileDraft.contractStart = "";
    profileDraft.contractEnd = "";
    profileDraft.contractReplaces = "";
    profileDraft.contractReason = "";
    profileDraft.contractLeaveRef = "";
    profileDraft.honorariaStart = profile.honorariaStart || "";
    profileDraft.honorariaEnd = profile.honorariaEnd || "";
    profileDraft.honorariaHourlyRate =
        String(profile.honorariaHourlyRate || "");
    profileDraft.honorariaMaxMonthlyHours =
        String(profile.honorariaMaxMonthlyHours || "");
    profileDraft.shiftAssigned = getShiftAssigned(profile.name);
}

// --- Predicados de contrato del borrador (movidos desde main.js) ---

export function supportsLibreRotation(data = profileDraft) {
    return isReplacementDraft(data) || isHonorariaDraft(data);
}

export function hasPendingReplacementContract() {
    return Boolean(
        profileDraft.contractStart ||
        profileDraft.contractEnd ||
        profileDraft.contractReplaces.trim() ||
        profileDraft.contractReason ||
        profileDraft.contractLeaveRef
    );
}

export function requiresReplacementContract() {
    if (!isReplacementDraft()) {
        return false;
    }

    if (profileDraft.mode === PROFILE_MODE.CREATE) {
        return true;
    }

    if (hasPendingReplacementContract()) {
        return true;
    }

    const existingContracts =
        getContractsForProfile(
            profileDraft.originalName || getCurrentProfile()
        );

    return existingContracts.length === 0;
}
