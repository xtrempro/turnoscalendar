// Helpers de auditoria de perfil: snapshot del estado contractual/rotativa y
// descripcion legible de los cambios entre dos snapshots (para el log).

import {
    getProfiles,
    getShiftAssignmentConfiguredState,
    getRotativa
} from "./storage.js";
import { normalizeRotationFirstTurn } from "./rotationUtils.js";

/**
 * Toma una "foto" del perfil (datos + asignacion de turno + rotativa) para
 * compararla luego en la auditoria. Devuelve null si el perfil no existe.
 * @param {string} profileName
 * @returns {Object|null}
 */
export function auditProfileSnapshot(profileName) {
    const profile = getProfiles().find(
        item => item.name === profileName
    );

    if (!profile) return null;

    return {
        ...profile,
        shiftAssigned: getShiftAssignmentConfiguredState(profileName),
        rotativa: getRotativa(profileName)
    };
}

/**
 * Describe en texto los cambios entre dos snapshots de perfil.
 * @param {Object|null} before
 * @param {Object} after
 * @returns {string}
 */
export function describeProfileChanges(before, after) {
    if (!before) return "Ficha inicial creada.";

    const changes = [];
    const fields = [
        ["name", "nombre"],
        ["email", "correo"],
        ["rut", "RUT"],
        ["phone", "celular"],
        ["birthDate", "fecha de nacimiento"],
        ["unitEntryDate", "fecha de ingreso"],
        ["contractType", "tipo de contrato"],
        ["honorariaStart", "inicio contrato honorarios"],
        ["honorariaEnd", "termino contrato honorarios"],
        ["honorariaHourlyRate", "valor hora honorarios"],
        ["honorariaMaxMonthlyHours", "maximo mensual honorarios"],
        ["estamento", "estamento"],
        ["profession", "profesion"],
        ["unionLeaveEnabled", "permiso gremial"],
        ["grade", "grado"]
    ];

    fields.forEach(([key, label]) => {
        if (String(before[key] || "") !== String(after[key] || "")) {
            changes.push(label);
        }
    });

    if (Boolean(before.shiftAssigned) !== Boolean(after.shiftAssigned)) {
        changes.push("asignacion de turno");
    }

    if (
        String(before.rotativa?.type || "") !== String(after.rotativa?.type || "") ||
        String(before.rotativa?.start || "") !== String(after.rotativa?.start || "") ||
        normalizeRotationFirstTurn(before.rotativa?.firstTurn) !==
            normalizeRotationFirstTurn(after.rotativa?.firstTurn)
    ) {
        changes.push("rotativa actual");
    }

    if ((before.docs?.length || 0) !== (after.docs?.length || 0)) {
        changes.push("documentos adjuntos");
    }

    if (before.active !== after.active) {
        changes.push("estado del perfil");
    }

    return changes.length
        ? `Campos modificados: ${changes.join(", ")}.`
        : "Se guardo la ficha sin cambios detectados.";
}
