// Consultas sobre el perfil GUARDADO actualmente seleccionado (no el borrador),
// y los datos a mostrar en el editor (segun el modo del borrador).

import {
    getProfiles,
    getCurrentProfile,
    getRotativa,
    isProfileActive,
    getShiftAssignmentConfiguredState
} from "./storage.js";
import { profileDraft, PROFILE_MODE } from "./profileDraft.js";
import { normalizeStoredStart } from "./dateUtils.js";
import { normalizeRotationFirstTurn } from "./rotationUtils.js";

/**
 * Devuelve el perfil guardado que esta seleccionado actualmente, o null.
 * @returns {Object|null}
 */
export function getPerfilActual() {
    const current = getCurrentProfile();
    return getProfiles().find(
        profile => profile.name === current
    ) || null;
}

/**
 * Datos del perfil a mostrar en el editor segun el modo del borrador.
 * @returns {Object}
 */
export function getDisplayedProfileData(){
    const profile = getPerfilActual();

    if (profileDraft.mode === PROFILE_MODE.CREATE) {
        return {
            name: profileDraft.name,
            email: profileDraft.email,
            rut: profileDraft.rut,
            phone: profileDraft.phone,
            birthDate: profileDraft.birthDate,
            docs: profileDraft.docs,
            active: profileDraft.active,
            unitEntryDate: profileDraft.unitEntryDate,
            contractType: profileDraft.contractType,
            estamento: profileDraft.estamento,
            profession: profileDraft.profession,
            grade: profileDraft.grade,
            rotationType: profileDraft.rotationType,
            rotationStart: profileDraft.rotationStart,
            rotationFirstTurn: profileDraft.rotationFirstTurn,
            contractStart: profileDraft.contractStart,
            contractEnd: profileDraft.contractEnd,
            contractReplaces: profileDraft.contractReplaces,
            contractReason: profileDraft.contractReason,
            contractLeaveRef: profileDraft.contractLeaveRef,
            honorariaStart: profileDraft.honorariaStart,
            honorariaEnd: profileDraft.honorariaEnd,
            honorariaHourlyRate: profileDraft.honorariaHourlyRate,
            honorariaMaxMonthlyHours: profileDraft.honorariaMaxMonthlyHours,
            unionLeaveEnabled: profileDraft.unionLeaveEnabled,
            shiftAssigned: profileDraft.shiftAssigned
        };
    }

    if (profileDraft.mode === PROFILE_MODE.EDIT) {
        return {
            name: profileDraft.name,
            email: profileDraft.email,
            rut: profileDraft.rut,
            phone: profileDraft.phone,
            birthDate: profileDraft.birthDate,
            docs: profileDraft.docs,
            active: profileDraft.active,
            unitEntryDate: profileDraft.unitEntryDate,
            contractType: profileDraft.contractType,
            estamento: profileDraft.estamento,
            profession: profileDraft.profession,
            grade: profileDraft.grade,
            rotationType: profileDraft.rotationType,
            rotationStart: profileDraft.rotationStart,
            rotationFirstTurn: profileDraft.rotationFirstTurn,
            contractStart: profileDraft.contractStart,
            contractEnd: profileDraft.contractEnd,
            contractReplaces: profileDraft.contractReplaces,
            contractReason: profileDraft.contractReason,
            contractLeaveRef: profileDraft.contractLeaveRef,
            honorariaStart: profileDraft.honorariaStart,
            honorariaEnd: profileDraft.honorariaEnd,
            honorariaHourlyRate: profileDraft.honorariaHourlyRate,
            honorariaMaxMonthlyHours: profileDraft.honorariaMaxMonthlyHours,
            unionLeaveEnabled: profileDraft.unionLeaveEnabled,
            shiftAssigned: profileDraft.shiftAssigned
        };
    }

    if (!profile) {
        return {
            name: "",
            email: "",
            rut: "",
            phone: "",
            birthDate: "",
            docs: [],
            active: true,
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

    const rotativa = getRotativa(profile.name);
    const legacyReplacement =
        rotativa.type === "reemplazo";

    return {
        name: profile.name,
        email: profile.email || "",
        rut: profile.rut || "",
        phone: profile.phone || "",
        birthDate: profile.birthDate || "",
        docs: Array.isArray(profile.docs) ? profile.docs : [],
        active: isProfileActive(profile),
        unitEntryDate: profile.unitEntryDate || "",
        contractType: legacyReplacement
            ? "Reemplazo"
            : profile.contractType || "",
        estamento: profile.estamento,
        profession: profile.profession || "Sin informacion",
        grade: String(profile.grade || ""),
        rotationType: legacyReplacement
            ? ""
            : rotativa.type || "",
        rotationStart: legacyReplacement
            ? ""
            : normalizeStoredStart(rotativa.start),
        rotationFirstTurn: normalizeRotationFirstTurn(rotativa.firstTurn),
        contractStart: "",
        contractEnd: "",
        contractReplaces: "",
        contractReason: "",
        contractLeaveRef: "",
        honorariaStart: profile.honorariaStart || "",
        honorariaEnd: profile.honorariaEnd || "",
        honorariaHourlyRate: String(profile.honorariaHourlyRate || ""),
        honorariaMaxMonthlyHours: String(profile.honorariaMaxMonthlyHours || ""),
        unionLeaveEnabled: Boolean(profile.unionLeaveEnabled),
        shiftAssigned: getShiftAssignmentConfiguredState(profile.name)
    };
}
