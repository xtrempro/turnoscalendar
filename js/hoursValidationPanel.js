// Visto bueno de horas: en el menu Horas extras, el listado del mes con los
// trabajadores que tienen Anexo 2 (no honorarios con horas extras) y si ya
// validaron sus horas desde la PWA.
//
// El visto bueno lo registra SOLO la Cloud Function approveMonthlyHours en
// workspaces/{ws}/hoursValidations/{uid}_{AAAA-MM}: identidad del enlace,
// huella de horas publicada por la unidad y fecha del servidor. Aqui se cruza
// por el uid del enlace de cada perfil y se recalcula la huella con el MISMO
// calculo (coverageAuthorizationRows.js):
//  - igual: validado (verde);
//  - distinta: sus horas cambiaron despues de validar (amarillo, revalidar);
//  - sin documento: pendiente.

import { escapeHTML } from "./htmlUtils.js";
import { getProfiles, getReplacements, isProfileActive } from "./storage.js";
import { normalizeText } from "./stringUtils.js";
import {
    buildCoverageAuthorizationRow,
    coverageAuthorizationSignature,
    coverageAuthorizationTotals,
    hoursValidationState,
    isCoverageAuthorizationCandidate
} from "./coverageAuthorizationRows.js";
import { hasCoverageAuthorizationOvertime } from "./coverageAuthorizationReport.js";

const STATUS_LABEL = {
    validated: "Validado",
    changed: "Cambió después de validar",
    pending: "Pendiente"
};

// "AAAA-MM", la clave con que se consultan los vistos buenos del mes.
export function hoursValidationMonthKey(monthDate) {
    return `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Los vistos buenos de un perfil: por el uid de su(s) enlace(s) de la PWA y,
 * de respaldo, por el nombre que el SERVIDOR tomo del enlace al registrarlo.
 */
export function validationsForProfile(validations, profile, linkUids = []) {
    const uids = new Set((linkUids || []).filter(Boolean));
    const name = normalizeText(profile?.name || "");

    return (Array.isArray(validations) ? validations : []).filter(item =>
        (item?.uid && uids.has(item.uid)) ||
        (name && normalizeText(item?.profileName || "") === name)
    );
}

/**
 * Filas del listado: trabajador, horas del mes y estado de su visto bueno.
 *
 * @param {Object} options
 * @param {Array} options.validations documentos hoursValidations del mes
 * @param {Function} [options.linkUidsForProfile] perfil -> uids de sus enlaces
 */
export async function buildHoursValidationRows(monthDate, options = {}) {
    const month = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const profiles = getProfiles();
    const replacements = getReplacements();
    const validations = options.validations || [];
    const linkUidsForProfile = options.linkUidsForProfile || (() => []);
    const candidates = profiles.filter(profile =>
        isProfileActive(profile) && isCoverageAuthorizationCandidate(profile, month)
    );
    const rows = [];

    for (const profile of candidates) {
        const row = await buildCoverageAuthorizationRow(profile, month, {
            workspaceName: options.workspaceName || "",
            profiles,
            replacements
        });

        if (!hasCoverageAuthorizationOvertime(row)) continue;

        const signature = coverageAuthorizationSignature(row);
        const state = hoursValidationState(
            validationsForProfile(validations, profile, linkUidsForProfile(profile)),
            signature
        );

        rows.push({
            name: profile.name,
            totals: coverageAuthorizationTotals(row),
            signature,
            status: state.status,
            validatedAtMillis: Number(state.validation?.validatedAtMillis) || 0
        });
    }

    return rows.sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function formatHours(value) {
    return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function formatDateTime(millis) {
    const date = new Date(Number(millis));

    if (!millis || Number.isNaN(date.getTime())) return "";

    return date.toLocaleString("es-CL", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

export function hoursValidationPanelHTML(rows, monthLabel) {
    const validated = rows.filter(row => row.status === "validated").length;
    const body = rows.length
        ? rows.map(row => `
            <button class="hh-validation__row is-${escapeHTML(row.status)}" type="button" data-hours-validation-profile="${escapeHTML(row.name)}">
                <span class="hh-validation__dot" aria-hidden="true"></span>
                <span class="hh-validation__name">${escapeHTML(row.name)}</span>
                <span class="hh-validation__hours">${formatHours(row.totals.day)} h diur.${row.totals.festive ? ` · ${formatHours(row.totals.festive)} h fest.` : ""}</span>
                <span class="hh-validation__status">
                    ${escapeHTML(STATUS_LABEL[row.status] || row.status)}
                    ${row.validatedAtMillis && row.status !== "pending" ? `<small>${escapeHTML(formatDateTime(row.validatedAtMillis))}</small>` : ""}
                </span>
            </button>`).join("")
        : `<p class="hh-validation__empty">Nadie tiene horas extras en ${escapeHTML(monthLabel)}.</p>`;

    return `
        <div class="hh-rec-head">
            <h2>Visto bueno de horas · ${escapeHTML(monthLabel)}</h2>
            <span class="hh-validation__count">${validated} de ${rows.length} validaron</span>
        </div>
        <p class="hh-validation__hint">Cada trabajador revisa su Anexo 2 en la app y da su visto bueno. Si sus horas cambian después, vuelve a quedar por validar.</p>
        <div class="hh-validation__list">${body}</div>`;
}
