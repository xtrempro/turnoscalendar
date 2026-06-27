// Construye el texto de estado de la rotativa y la ayuda del editor de perfil,
// segun el borrador (modo, tipo de contrato, rotativa) y el perfil guardado.
// Tambien renderiza el bloque de estado de rotativa (el handler para abrir la
// configuracion se inyecta como callback para no acoplar el modal aqui).

import {
    profileDraft,
    PROFILE_MODE,
    isReplacementDraft,
    isHonorariaDraft,
    hasRotationChanged
} from "./profileDraft.js";
import {
    getRotativaLabel,
    requiresRotationFirstTurn,
    getRotationFirstTurnLabel
} from "./rotationUtils.js";
import { formatDisplayDate } from "./dateUtils.js";
import { getContractsForProfile } from "./contracts.js";
import { getPerfilActual } from "./profileQueries.js";
import { DOM } from "./dom.js";
import { escapeHTML } from "./htmlUtils.js";

/**
 * Renderiza el bloque de estado de rotativa en el editor de perfil.
 * @param {Object} data datos mostrados del perfil
 * @param {boolean} editing si el editor esta en modo edicion
 * @param {(type: string) => void} onConfigure handler para abrir el modal de
 *   configuracion de rotativa (se inyecta para no acoplar el modal aqui)
 */
export function renderProfileRotationStatus(data, editing, onConfigure) {
    if (!DOM.profileRotationStatus) return;

    const replacementContract =
        isReplacementDraft(data);
    const canConfigure =
        editing &&
        (
            replacementContract ||
            (
                Boolean(data.rotationType) &&
                (
                    !isHonorariaDraft(data) ||
                    Boolean(data.honorariaStart && data.honorariaEnd)
                )
            )
        );

    DOM.profileRotationStatus.classList.toggle(
        "profile-status-note--with-action",
        canConfigure
    );

    DOM.profileRotationStatus.innerHTML = `
        <span>${escapeHTML(buildRotationStatus(data))}</span>
        ${canConfigure ? `
            <button id="openRotationConfigBtn" class="profile-status-action" type="button">
                ${replacementContract ? "Nuevo Contrato" : "Configurar rotativa"}
            </button>
        ` : ""}
    `;

    document
        .getElementById("openRotationConfigBtn")
        ?.addEventListener("click", () => {
            onConfigure?.(
                replacementContract
                    ? "reemplazo"
                    : data.rotationType
            );
        });
}

export function formatRotationStartSummary(data, prefix = "") {
    const startText = data.rotationStart
        ? ` desde ${formatDisplayDate(data.rotationStart)}`
        : "";
    const firstTurnText =
        requiresRotationFirstTurn(data.rotationType) &&
        data.rotationStart
            ? `, iniciando con ${getRotationFirstTurnLabel(data.rotationFirstTurn, data.rotationType)}`
            : "";

    return `${prefix}${getRotativaLabel(data.rotationType)}${startText}${firstTurnText}.`;
}

export function buildRotationStatus(data){
    if (isReplacementDraft(data)) {
        if (profileDraft.mode === PROFILE_MODE.VIEW) {
            const profile = getPerfilActual();
            const contracts = profile
                ? getContractsForProfile(profile.name)
                : [];

            if (!contracts.length) {
                return "Contrato Reemplazo sin periodos registrados.";
            }

            const freeContracts = contracts.filter(contract =>
                contract.rotationMode === "free" ||
                (
                    !contract.rotationMode &&
                    data.rotationType === "libre"
                )
            ).length;

            return `Contrato Reemplazo con ${contracts.length} periodo(s) registrado(s): ${contracts.length - freeContracts} con turnos heredados y ${freeContracts} con turnos manuales.`;
        }

        if (!data.contractStart) {
            return "Presione el botón para ingresar un nuevo contrato de reemplazo.";
        }

        if (!data.contractEnd) {
            return `Inicio de contrato: ${formatDisplayDate(data.contractStart)}. Falta definir termino en el modal.`;
        }

        const rotationSummary = data.contractRotationMode === "free"
            ? "Turnos libres para carga manual."
            : "Heredara los turnos del trabajador reemplazado.";

        return `Contrato de reemplazo: ${formatDisplayDate(data.contractStart)} al ${formatDisplayDate(data.contractEnd)}${data.contractReason ? ` | Motivo: ${data.contractReason}` : ""}. ${rotationSummary}`;
    }

    if (isHonorariaDraft(data)) {
        if (!data.honorariaStart || !data.honorariaEnd) {
            return "Completa la vigencia del contrato de Honorarios antes de aplicar la rotativa.";
        }

        const contractSummary =
            `Contrato Honorarios: ${formatDisplayDate(data.honorariaStart)} al ${formatDisplayDate(data.honorariaEnd)} | Tope mensual: ${data.honorariaMaxMonthlyHours || 0} hrs.`;

        if (!data.rotationType) {
            return `${contractSummary} Selecciona una rotativa.`;
        }

        if (data.rotationType === "libre") {
            return `${contractSummary} Rotativa Libre: calendario disponible para carga manual.`;
        }

        if (!data.rotationStart) {
            return `${contractSummary} Configura desde que fecha se aplicara ${getRotativaLabel(data.rotationType)}.`;
        }

        return `${contractSummary} ${formatRotationStartSummary(data, "")}`;
    }

    if (data.rotationType === "libre") {
        return "Rotativa Libre: calendario disponible para carga manual.";
    }

    if (profileDraft.mode === PROFILE_MODE.CREATE) {
        if (!data.rotationType) {
            return "Selecciona una rotativa para definir su fecha de inicio.";
        }

        if (!data.rotationStart) {
            return `Configura en el modal desde que fecha se aplicara ${getRotativaLabel(data.rotationType)}.`;
        }

        return formatRotationStartSummary(data, "");
    }

    if (profileDraft.mode === PROFILE_MODE.EDIT) {
        if (!data.rotationType) {
            return "Selecciona la nueva rotativa para configurar su fecha de inicio.";
        }

        if (!hasRotationChanged()) {
            return formatRotationStartSummary(data, "Rotativa actual: ");
        }

        if (!data.rotationStart) {
            return `Configura en el modal desde que fecha se aplicara la nueva ${getRotativaLabel(data.rotationType)}.`;
        }

        return formatRotationStartSummary(data, "Nueva rotativa: ");
    }

    if (!data.rotationType) {
        return "Este colaborador aun no tiene una rotativa configurada.";
    }

    return formatRotationStartSummary(data, "Rotativa actual: ");
}

export function buildEditorHint(profile){
    if (profileDraft.mode === PROFILE_MODE.CREATE) {
        if (isReplacementDraft()) {
            return "Puedes crear el perfil sin contrato y agregar su primer contrato de reemplazo cuando lo necesites.";
        }

        if (isHonorariaDraft()) {
            return "Completa los datos del contrato de Honorarios y configura una rotativa dentro de su vigencia.";
        }

        return "Completa nombre, estamento, rotativa y configura en el modal desde que fecha inicia antes de guardar.";
    }

    if (profileDraft.mode === PROFILE_MODE.EDIT) {
        if (isReplacementDraft()) {
            return "Puedes actualizar los datos del trabajador o agregar un nuevo contrato de reemplazo indicando inicio, termino y a quien reemplaza.";
        }

        if (isHonorariaDraft()) {
            return "Actualiza la vigencia, el valor hora y el tope mensual. La rotativa solo se mostrara dentro del contrato.";
        }

        return "Actualiza los datos del trabajador. Solo si cambias la rotativa debes configurar en el modal desde que fecha aplica.";
    }

    if (profile) {
        return "";
    }

    return "";
}
