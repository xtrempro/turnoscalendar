// Formato y deteccion de cambios del historial contractual del perfil
// (tipo de contrato, estamento, profesion, grado y rotativa).

import { formatProfession } from "./professionUtils.js";
import { normalizeStoredStart, formatDisplayDate } from "./dateUtils.js";
import {
    normalizeRotationFirstTurn,
    normalizeRotationFirstTurnForType,
    requiresRotationFirstTurn,
    getRotationFirstTurnLabel,
    getRotativaLabel
} from "./rotationUtils.js";
import { addContractHistoryEntry } from "./storage.js";

/**
 * Formatea una marca de tiempo del historial como `DD-MM-YYYY HH:MM` (es-CL).
 * Si no es una fecha valida, devuelve el valor original.
 * @param {string|number|Date} value
 * @returns {string}
 */
export function formatHistoryDateTime(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value || "";
    }

    return date.toLocaleString("es-CL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

/**
 * Formatea el valor de un campo del historial segun su tipo.
 * @param {string} field
 * @param {*} value
 * @returns {string}
 */
export function formatHistoryValue(field, value) {
    if (field === "profession") {
        return formatProfession(value);
    }

    if (field === "rotation") {
        return formatRotationValue(value);
    }

    if (field === "grade") {
        return value ? `Grado ${value}` : "Sin grado";
    }

    if (field === "contractType") {
        return value || "Sin contrato";
    }

    if (field === "estamento") {
        return value || "Sin estamento";
    }

    return value || "Sin dato";
}

/**
 * Describe una rotativa en texto (tipo, fecha de inicio y primer turno).
 * @param {{type?: string, start?: string, firstTurn?: string}} rotativa
 * @returns {string}
 */
export function formatRotationValue(rotativa = {}) {
    const type = rotativa?.type || "";
    const start = normalizeStoredStart(rotativa?.start || "");
    const firstTurn =
        normalizeRotationFirstTurnForType(
            type,
            rotativa?.firstTurn
        );
    const startText = start
        ? ` desde ${formatDisplayDate(start)}`
        : "";
    const firstTurnText =
        requiresRotationFirstTurn(type) && start
            ? `, inicia con ${getRotationFirstTurnLabel(firstTurn, type)}`
            : "";

    return `${getRotativaLabel(type)}${startText}${firstTurnText}`;
}

/**
 * Compara dos snapshots contractuales y devuelve la lista de cambios
 * (campo, etiqueta, valor anterior/nuevo y fecha de vigencia).
 * @param {Object} previousSnapshot
 * @param {Object} nextSnapshot
 * @param {string} gradeEffectiveDate
 * @returns {Array<{field: string, label: string, from: string, to: string, effectiveDate: string}>}
 */
export function contractHistoryChanges(
    previousSnapshot,
    nextSnapshot,
    gradeEffectiveDate
) {
    if (!previousSnapshot || !nextSnapshot) return [];

    const fieldConfig = [
        {
            key: "contractType",
            label: "Tipo de contrato",
            effectiveDate: gradeEffectiveDate
        },
        {
            key: "estamento",
            label: "Estamento",
            effectiveDate: gradeEffectiveDate
        },
        {
            key: "profession",
            label: "Profesión"
        },
        {
            key: "grade",
            label: "Grado",
            effectiveDate: gradeEffectiveDate
        }
    ];

    const changes = fieldConfig
        .filter(config =>
            String(previousSnapshot[config.key] || "") !==
            String(nextSnapshot[config.key] || "")
        )
        .map(config => ({
            field: config.key,
            label: config.label,
            from: formatHistoryValue(
                config.key,
                previousSnapshot[config.key]
            ),
            to: formatHistoryValue(
                config.key,
                nextSnapshot[config.key]
            ),
            effectiveDate: config.effectiveDate || ""
        }));

    const previousRotation = previousSnapshot.rotativa || {};
    const nextRotation = nextSnapshot.rotativa || {};
    const rotationChanged =
        String(previousRotation.type || "") !==
            String(nextRotation.type || "") ||
        normalizeStoredStart(previousRotation.start || "") !==
            normalizeStoredStart(nextRotation.start || "") ||
        normalizeRotationFirstTurn(previousRotation.firstTurn) !==
            normalizeRotationFirstTurn(nextRotation.firstTurn);

    if (rotationChanged) {
        changes.push({
            field: "rotation",
            label: "Rotativa",
            from: formatHistoryValue("rotation", previousRotation),
            to: formatHistoryValue("rotation", nextRotation),
            effectiveDate:
                normalizeStoredStart(nextRotation.start || "") || ""
        });
    }

    return changes;
}

/**
 * Registra en el historial contractual del perfil los cambios entre dos
 * snapshots, si los hay.
 * @param {string} profileName
 * @param {Object} previousSnapshot
 * @param {Object} nextSnapshot
 * @param {string} gradeEffectiveDate
 */
export function recordProfileContractHistory(
    profileName,
    previousSnapshot,
    nextSnapshot,
    gradeEffectiveDate
) {
    const changes = contractHistoryChanges(
        previousSnapshot,
        nextSnapshot,
        gradeEffectiveDate
    );

    if (!changes.length) return;

    addContractHistoryEntry(profileName, {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        effectiveDate:
            gradeEffectiveDate ||
            changes.find(change => change.effectiveDate)
                ?.effectiveDate ||
            "",
        summary: "Cambio de datos contractuales",
        changes
    });
}
