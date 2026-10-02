// Datos del Anexo 2 (Autorizacion para cubrir turnos) por trabajador y mes, y
// el reporte mensual que ve el trabajador en la PWA.
//
// Es UN solo calculo para tres lugares: el boton "Anexo 2" del supervisor
// (main.js), la proyeccion que publica la Cloud Function (serverEngine.js) y
// los informes a pedido (workerRequests.js / workerAppDataSync.js). Si se
// separan, el trabajador validaria un Anexo distinto al que imprime la unidad.
//
// Solo usa modulos que tambien viajan al motor del servidor (storage.js,
// hoursReport.js, contracts.js): nada del DOM ni del estado de la sesion.

import { buildWorkerHheeMonthSummary, buildWorkerReportPreviewHTML } from "./hoursReport.js";
import {
    getCompensationProfileAt,
    getContractTypeAt,
    getProfiles,
    getReplacements,
    getRotativa,
    getShiftAssigned
} from "./storage.js";
import { isHonorariaContractType } from "./contracts.js";
import {
    buildCoverageAuthorizationReportHTML,
    hasCoverageAuthorizationOvertime
} from "./coverageAuthorizationReport.js";

export function coverageSchedule(record) {
    const from = record?.coverFrom || record?.shiftFrom || "";
    const until = record?.coverUntil || record?.shiftUntil || "";
    return from && until ? `${from} A ${until}` : "";
}

function monthPrefix(monthDate) {
    return `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}-`;
}

function monthEnd(monthDate) {
    return new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
}

/**
 * Los honorarios no llevan Anexo 2 (no tienen horas extraordinarias).
 */
export function isCoverageAuthorizationCandidate(profile, monthDate) {
    return !isHonorariaContractType(
        getContractTypeAt(profile?.name, monthEnd(monthDate)) || profile?.contractType
    );
}

/**
 * La fila del Anexo 2 de un trabajador para un mes (la que dibuja
 * buildCoverageAuthorizationReportHTML).
 *
 * @param {Object} [options]
 * @param {string} [options.workspaceName] nombre de la unidad (SERVICIO)
 * @param {Array} [options.profiles] para no releerlos al armar muchos
 * @param {Array} [options.replacements] del mes, sin anulados (idem)
 */
export async function buildCoverageAuthorizationRow(profile, monthDate, options = {}) {
    const month = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const effectiveDate = monthEnd(month);
    const profiles = options.profiles || getProfiles();
    const profileByName = new Map(profiles.map(item => [item.name, item]));
    const prefix = monthPrefix(month);
    const replacements = (options.replacements || getReplacements()).filter(record =>
        !record?.canceled &&
        String(record?.date || "").startsWith(prefix)
    );
    const summary = await buildWorkerHheeMonthSummary(profile, month);
    const calendarByIso = new Map(
        (summary?.calendarDays || []).map(day => [day.iso, day])
    );
    const recordsByIso = new Map();

    replacements
        .filter(record => record.worker === profile.name)
        .forEach(record => {
            const records = recordsByIso.get(record.date) || [];
            records.push(record);
            recordsByIso.set(record.date, records);
        });

    const days = (summary?.extraShifts || []).map(extra => {
        const records = recordsByIso.get(extra.iso) || [];
        const replacedNames = [...new Set(records
            .map(record => record.replaced)
            .filter(Boolean))];
        const replacedRuts = [...new Set(replacedNames
            .map(name => profileByName.get(name)?.rut || "")
            .filter(Boolean))];
        const motives = [...new Set(records
            .map(record => record.replaced
                ? record.absenceType || "Ausencia"
                : record.reason || record.absenceType || "")
            .filter(Boolean))];
        const schedules = [...new Set(records
            .map(coverageSchedule)
            .filter(Boolean))];
        const calendar = calendarByIso.get(extra.iso) || {};

        return {
            iso: extra.iso,
            baseShift: calendar.baseShift || "",
            workedShift: extra.turno || calendar.workedShift || "",
            schedule: schedules.join(" / "),
            dayHours: extra.d,
            festiveHours: extra.n,
            replacedName: replacedNames.join(" / "),
            replacedRut: replacedRuts.join(" / "),
            reason: records.length ? "" : extra.backing,
            motive: motives.join(" / ") || extra.backing || ""
        };
    });
    const effectiveProfile =
        getCompensationProfileAt(profile.name, effectiveDate) || profile;

    return {
        name: profile.name,
        rut: profile.rut || "",
        contractType: effectiveProfile.contractType || profile.contractType || "",
        unit: options.workspaceName || "",
        estamento: effectiveProfile.estamento || profile.estamento || "",
        rotationType: getRotativa(profile.name)?.type || "",
        shiftAssigned: getShiftAssigned(profile.name, effectiveDate),
        days
    };
}

function roundHours(value) {
    return Math.round((Math.max(0, Number(value) || 0)) * 100) / 100;
}

export function coverageAuthorizationTotals(row) {
    return (row?.days || []).reduce((totals, day) => ({
        day: roundHours(totals.day + roundHours(day.dayHours)),
        festive: roundHours(totals.festive + roundHours(day.festiveHours))
    }), { day: 0, festive: 0 });
}

// FNV-1a de 32 bits: corto, sincronico y igual en el navegador y en Node.
function fnv1a(text) {
    let hash = 0x811c9dc5;

    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    return hash.toString(16).padStart(8, "0");
}

/**
 * Huella de las horas del Anexo 2: dia, horas diurnas y festivas de cada
 * turno extra. Es lo que el trabajador valida; si cambia, su visto bueno ya
 * no corresponde a sus horas (queda "cambio despues de validar").
 */
export function coverageAuthorizationSignature(row) {
    const days = (row?.days || [])
        .filter(day => roundHours(day.dayHours) + roundHours(day.festiveHours) > 0)
        .map(day => [String(day.iso || ""), roundHours(day.dayHours), roundHours(day.festiveHours)])
        .sort((a, b) => a[0].localeCompare(b[0]));

    return `v1-${fnv1a(JSON.stringify(days))}`;
}

/**
 * El reporte mensual de la PWA y lo que el trabajador puede validar.
 * - No honorarios: el Anexo 2 (aunque el mes no tenga horas extras, para que
 *   el trabajador vea su hoja), con su huella para el visto bueno.
 * - Honorarios: el reporte de horas de siempre, sin visto bueno.
 *
 * @returns {Promise<{html: string, kind: string, validation: Object|null}>}
 */
export async function buildWorkerMonthlyReport(profile, monthDate, options = {}) {
    const month = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);

    if (!isCoverageAuthorizationCandidate(profile, month)) {
        return {
            html: await buildWorkerReportPreviewHTML(profile, month),
            kind: "hours",
            validation: null
        };
    }

    const row = await buildCoverageAuthorizationRow(profile, month, options);
    const totals = coverageAuthorizationTotals(row);

    return {
        html: buildCoverageAuthorizationReportHTML([row], month, { includeEmpty: true }),
        kind: "anexo2",
        validation: {
            signature: coverageAuthorizationSignature(row),
            hasOvertime: hasCoverageAuthorizationOvertime(row),
            totalDay: totals.day,
            totalFestive: totals.festive
        }
    };
}

/**
 * Estado del visto bueno de un trabajador para un mes, a partir de sus
 * documentos hoursValidations (los escribe la Cloud Function approveMonthlyHours;
 * manda el de fecha de SERVIDOR mas reciente, nunca la hora del telefono):
 * - "validated": valido estas mismas horas;
 * - "changed": valido, pero las horas cambiaron despues;
 * - "pending": no ha validado.
 */
export function hoursValidationState(validations = [], signature = "") {
    const latest = [...(validations || [])]
        .filter(item => item && item.signature)
        .sort((a, b) => (Number(b.validatedAtMillis) || 0) - (Number(a.validatedAtMillis) || 0))[0];

    if (!latest) return { status: "pending", validation: null };

    return {
        status: signature && latest.signature === signature ? "validated" : "changed",
        validation: latest
    };
}
