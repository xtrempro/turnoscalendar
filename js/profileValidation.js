// Validacion del borrador de perfil. Es PURA: no toca el DOM ni muestra
// alertas; devuelve un resultado describible que la capa de UI presenta.
//
// Resultado: { ok: true } o { ok: false, message, focusRut? }.

import {
    profileDraft,
    PROFILE_MODE,
    hasRotationChanged,
    supportsLibreRotation,
    isReplacementDraft,
    requiresReplacementContract,
    isHonorariaDraft,
    isBeforeDraftUnitEntryDate,
    rotationStartBeforeUnitEntryMessage
} from "./profileDraft.js";
import { requiresRotationStart, requiresRotationFirstTurn } from "./rotationUtils.js";
import { getRutValidationMessage } from "./rutUtils.js";
import {
    findDuplicateEmailProfile,
    getEmailValidationMessage
} from "./emailUtils.js";
import { compareISODate } from "./dateUtils.js";
import { getProfiles } from "./storage.js";
import { getHonorariaContractsForProfile } from "./contracts.js";
import {
    REPLACEMENT_ROTATION_MODE,
    normalizeReplacementRotationMode
} from "./replacementRotation.js";

/**
 * Valida el borrador actual. No muestra nada; devuelve el resultado.
 * @returns {{ok: true} | {ok: false, message: string, focusRut?: boolean}}
 */
export function validateProfileDraft() {
    const missing = [];
    const shouldRequireRotationStart =
        (
            profileDraft.mode === PROFILE_MODE.CREATE ||
            hasRotationChanged()
        ) &&
        requiresRotationStart(profileDraft.rotationType);
    const rutMessage =
        getRutValidationMessage(profileDraft.rut);
    const emailMessage =
        getEmailValidationMessage(profileDraft.email);
    const duplicateEmailProfile = emailMessage
        ? null
        : findDuplicateEmailProfile(
            getProfiles(),
            profileDraft.email,
            profileDraft.mode === PROFILE_MODE.EDIT
                ? profileDraft.originalName
                : ""
        );

    if (!profileDraft.name.trim()) missing.push("nombre");
    if (!profileDraft.estamento) missing.push("estamento");
    if (
        profileDraft.rotationType === "libre" &&
        !supportsLibreRotation()
    ) {
        return {
            ok: false,
            message: "La rotativa Libre solo esta disponible para contratos Reemplazo u Honorarios."
        };
    }

    if (!isReplacementDraft() && !profileDraft.rotationType) {
        missing.push("rotativa");
    }
    if (requiresReplacementContract()) {
        if (!profileDraft.contractStart) {
            missing.push("inicio de contrato");
        }

        if (!profileDraft.contractEnd) {
            missing.push("termino de contrato");
        }

        if (!profileDraft.contractReplaces.trim()) {
            missing.push("a quien reemplaza");
        }

        if (!profileDraft.contractReason) {
            missing.push("motivo del reemplazo");
        }

        if (!profileDraft.contractLeaveRef) {
            missing.push("permiso que origina el reemplazo");
        }

        if (
            normalizeReplacementRotationMode(
                profileDraft.contractRotationMode,
                REPLACEMENT_ROTATION_MODE.INHERIT
            ) === REPLACEMENT_ROTATION_MODE.DIURNO_BRIDGE &&
            !String(profileDraft.contractBridgeProfile || "").trim()
        ) {
            missing.push("trabajador diurno que cubre la rotativa");
        }
    }

    if (isHonorariaDraft()) {
        // Los contratos viven en la lista (honorariaContracts_{nombre}); se exige
        // al menos uno. El formulario de "nuevo contrato" puede quedar vacio.
        const honorariaName =
            profileDraft.mode === PROFILE_MODE.EDIT
                ? (profileDraft.originalName || profileDraft.name)
                : profileDraft.name;
        const hasContract =
            getHonorariaContractsForProfile(String(honorariaName || "").trim())
                .length > 0;

        if (!hasContract) {
            return {
                ok: false,
                message:
                    "Agrega al menos un contrato de Honorarios (fechas y valor hora) con el boton \"Agregar contrato\"."
            };
        }
    }

    if (
        !isReplacementDraft() &&
        shouldRequireRotationStart &&
        !profileDraft.rotationStart
    ) {
        missing.push("fecha de inicio de rotativa");
    }

    if (
        !isReplacementDraft() &&
        shouldRequireRotationStart &&
        requiresRotationFirstTurn(profileDraft.rotationType) &&
        !profileDraft.rotationFirstTurn
    ) {
        missing.push("turno inicial de rotativa");
    }

    if (
        !isReplacementDraft() &&
        profileDraft.rotationStart &&
        isBeforeDraftUnitEntryDate(profileDraft.rotationStart)
    ) {
        return {
            ok: false,
            message: rotationStartBeforeUnitEntryMessage(profileDraft.rotationStart)
        };
    }

    if (
        isReplacementDraft() &&
        profileDraft.contractStart &&
        profileDraft.contractEnd &&
        compareISODate(
            profileDraft.contractEnd,
            profileDraft.contractStart
        ) < 0
    ) {
        return {
            ok: false,
            message: "La fecha de termino del contrato no puede ser anterior al inicio."
        };
    }

    if (
        isHonorariaDraft() &&
        profileDraft.honorariaStart &&
        profileDraft.honorariaEnd &&
        compareISODate(
            profileDraft.honorariaEnd,
            profileDraft.honorariaStart
        ) < 0
    ) {
        return {
            ok: false,
            message: "La fecha de termino del contrato de Honorarios no puede ser anterior al inicio."
        };
    }

    if (
        isHonorariaDraft() &&
        profileDraft.honorariaStart &&
        profileDraft.honorariaEnd &&
        profileDraft.rotationStart &&
        (
            compareISODate(
                profileDraft.rotationStart,
                profileDraft.honorariaStart
            ) < 0 ||
            compareISODate(
                profileDraft.rotationStart,
                profileDraft.honorariaEnd
            ) > 0
        )
    ) {
        return {
            ok: false,
            message: "La rotativa del trabajador a Honorarios debe comenzar dentro de la vigencia del contrato."
        };
    }

    if (
        isReplacementDraft() &&
        profileDraft.contractReplaces.trim()
    ) {
        const targetName =
            profileDraft.contractReplaces.trim();
        const bridgeName =
            String(profileDraft.contractBridgeProfile || "").trim();
        const bridgeMode =
            normalizeReplacementRotationMode(
                profileDraft.contractRotationMode,
                REPLACEMENT_ROTATION_MODE.INHERIT
            ) === REPLACEMENT_ROTATION_MODE.DIURNO_BRIDGE;

        if (targetName === profileDraft.name.trim()) {
            return {
                ok: false,
                message: "Un trabajador no puede reemplazarse a si mismo."
            };
        }

        if (
            !getProfiles().some(profile =>
                profile.name === targetName
            )
        ) {
            return {
                ok: false,
                message: "El trabajador reemplazado debe existir en el listado de perfiles."
            };
        }

        if (bridgeMode && bridgeName) {
            if (
                bridgeName === profileDraft.name.trim() ||
                bridgeName === targetName
            ) {
                return {
                    ok: false,
                    message: "El trabajador diurno que cubre la rotativa debe ser distinto del reemplazante y del trabajador reemplazado."
                };
            }

            if (
                !getProfiles().some(profile =>
                    profile.name === bridgeName
                )
            ) {
                return {
                    ok: false,
                    message: "El trabajador diurno que cubre la rotativa debe existir en el listado de perfiles."
                };
            }
        }
    }

    // El RUT es el ancla de identidad del trabajador: mantiene sus datos y su
    // respaldo aunque el supervisor le cambie el correo o cambie de cuenta.
    // Por eso es obligatorio al crear y, una vez guardado, no se puede editar.
    if (
        profileDraft.mode === PROFILE_MODE.CREATE &&
        !String(profileDraft.rut || "").trim()
    ) {
        return {
            ok: false,
            message: "El RUT es obligatorio para crear el perfil: es el identificador que conserva los datos del trabajador aunque cambie su correo.",
            focusRut: true
        };
    }

    if (rutMessage) {
        return {
            ok: false,
            message: rutMessage,
            focusRut: true
        };
    }

    if (emailMessage) {
        return {
            ok: false,
            message: emailMessage,
            focusEmail: true
        };
    }

    if (duplicateEmailProfile) {
        return {
            ok: false,
            message:
                `Ya existe un trabajador creado con ese correo (${duplicateEmailProfile.name}). Cada trabajador debe tener un correo distinto dentro de la unidad.`,
            focusEmail: true
        };
    }

    if (!missing.length) {
        return { ok: true };
    }

    return {
        ok: false,
        message: `Falta completar: ${missing.join(", ")}.`
    };
}
