import { parseKeyParts as parseKey } from "./dateUtils.js";
import { onlyViewIrrelevantStateKeys } from "./stateChangeRelevance.js";
import { isShiftUncovered } from "./home.js";
import { normalizeText } from "./stringUtils.js";
import { escapeHTML } from "./htmlUtils.js";
import {
    ATTACHMENT_ACCEPT,
    deleteStoredAttachment,
    hasAttachmentContent,
    openAttachmentFile,
    readAttachmentFiles
} from "./attachmentUtils.js";
import {
    getCurrentProfile,
    getProfiles,
    getReplacements,
    getRotativa,
    isProfileActive,
    isNoCoverageDay,
    getProfessionOptionsForEstamento,
    normalizeProfession
} from "./storage.js";
import {
    aplicarCambiosTurno,
    getTurnoBase,
    getTurnoProgramado
} from "./turnEngine.js";
import { TURNO } from "./constants.js";
import { currentDate } from "./calendar.js";
import {
    getJSON,
    getRaw,
    listKeys,
    removeKey,
    setJSON,
    setRaw
} from "./persistence.js";
import { fetchHolidays } from "./holidays.js";
import { isBusinessDay } from "./calculations.js";
import { showConfirm } from "./dialogs.js";
import {
    getDiurnoBridgeContractForProfile,
    getInheritedReplacementContractForCoveredShift,
    getReplacementRotationModeForDate,
    getReplacedProfileForDate,
    isReplacementProfile
} from "./contracts.js";
import { REPLACEMENT_ROTATION_MODE } from "./replacementRotation.js";
import {
    getAbsenceType,
    requiereReemplazoTurnoBase
} from "./rulesEngine.js";
import {
    getReplacementForCoveredShift,
    getReplacementsByWorkerForDay,
    replacementActive
} from "./replacements.js";
import {
    addAuditLog,
    AUDIT_CATEGORY
} from "./auditLog.js";
import { getHourReturn } from "./hourReturns.js";
import { getShiftGroupMap, getShiftGroupGaps } from "./shiftHolders.js";
import { getActiveCampaignForShift } from "./autoCoverage.js";
import {
    campaignStatusLabel,
    formatCoverageTimeLeft,
    stageLabel
} from "./autoCoveragePlan.js";
import { runCooperativeRange } from "./mainThreadScheduler.js";
import { measurePerformance } from "./performanceMonitor.js";

const APPLICANTS_KEY = "staffing_applicants";
const STAFFING_WEEKLY_CACHE_VERSION = 1;
const STAFFING_WEEKLY_CACHE_PREFIX = "proturnos_ui_cache_staffing_weekly_";
const STAFFING_WEEKLY_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const STAFFING_WEEKLY_CACHE_MAX_ENTRIES = 24;
const STAFFING_WEEKLY_PRELOAD_OFFSETS = [0, 1, -1, 2, 3];

let staffingWeekDate = null;
let staffingWeeklyRenderRequest = 0;
let staffingWeeklyPreloadTimer = 0;
let staffingWeeklyPreloadRequest = 0;
let staffingWeeklyStickyCleanup = null;

function localDateISO(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function addLocalDays(date, days) {
    const next = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );

    next.setDate(next.getDate() + days);
    return next;
}

function staffingCacheHash(value) {
    let hash = 2166136261;
    const text = String(value || "");

    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
}

function staffingWeeklyStartISO(date) {
    return localDateISO(weekStartMonday(date));
}

function staffingWeeklyCacheSignature({
    weekStartISO,
    roleFilter,
    professionFilter,
    typeFilter,
    onlyTrouble
}) {
    return [
        weekStartISO,
        roleFilter || "Todos",
        professionFilter || "Todas",
        typeFilter || "Todos",
        onlyTrouble ? "1" : "0"
    ].join("\u001f");
}

function staffingWeeklyCacheKey(signature) {
    return (
        STAFFING_WEEKLY_CACHE_PREFIX +
        `${STAFFING_WEEKLY_CACHE_VERSION}_` +
        staffingCacheHash(signature)
    );
}

function parseStaffingWeeklyCache(raw) {
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function readStaffingWeeklyCache(signature) {
    const key = staffingWeeklyCacheKey(signature);
    const payload = parseStaffingWeeklyCache(getRaw(key, null));

    if (
        !payload ||
        payload.version !== STAFFING_WEEKLY_CACHE_VERSION ||
        payload.signature !== signature ||
        typeof payload.html !== "string" ||
        Date.now() - Number(payload.savedAt || 0) >
            STAFFING_WEEKLY_CACHE_MAX_AGE_MS
    ) {
        return null;
    }

    return payload;
}

function staffingWeeklyRetentionRange() {
    const currentStart = weekStartMonday(currentDate);

    return {
        min: localDateISO(addLocalDays(currentStart, -7)),
        max: localDateISO(addLocalDays(currentStart, 21))
    };
}

function pruneStaffingWeeklyCache() {
    const keys = listKeys(STAFFING_WEEKLY_CACHE_PREFIX);
    const { min, max } = staffingWeeklyRetentionRange();
    const entries = keys
        .map(key => ({
            key,
            payload: parseStaffingWeeklyCache(getRaw(key, null))
        }))
        .filter(entry => entry.payload);

    entries
        .filter(entry =>
            entry.payload.weekStartISO < min ||
            entry.payload.weekStartISO > max
        )
        .forEach(entry => removeKey(entry.key));

    entries
        .filter(entry =>
            entry.payload.weekStartISO >= min &&
            entry.payload.weekStartISO <= max
        )
        .sort((a, b) =>
            Number(b.payload.savedAt || 0) -
            Number(a.payload.savedAt || 0)
        )
        .slice(STAFFING_WEEKLY_CACHE_MAX_ENTRIES)
        .forEach(entry => removeKey(entry.key));
}

function writeStaffingWeeklyCache({
    signature,
    weekStartISO,
    html
}) {
    if (!signature || !weekStartISO || typeof html !== "string") return;

    try {
        setRaw(
            staffingWeeklyCacheKey(signature),
            JSON.stringify({
                version: STAFFING_WEEKLY_CACHE_VERSION,
                signature,
                weekStartISO,
                savedAt: Date.now(),
                html
            })
        );
        pruneStaffingWeeklyCache();
    } catch {
        // El cache semanal es oportunista; si no cabe, se recalcula normal.
    }
}

function clearStaffingWeeklyCache() {
    listKeys(STAFFING_WEEKLY_CACHE_PREFIX).forEach(removeKey);
}

const STAFFING_ESTAMENTOS = [
    "Profesional",
    "Técnico",
    "Administrativo",
    "Auxiliar"
];
const PROFESSION_BASED_ESTAMENTOS = new Set([
    "Profesional",
    "Técnico"
]);
function normalizeStaffingEstamento(value) {
    const clean = String(value || "").trim();

    const comparable = normalizeText(value);

    if (comparable === "tecnico") return "Técnico";

    return STAFFING_ESTAMENTOS.find(estamento =>
        normalizeText(estamento) === comparable
    ) || clean;
}

function isProfessionBasedStaffing(estamento) {
    return PROFESSION_BASED_ESTAMENTOS.has(
        normalizeStaffingEstamento(estamento)
    );
}

function professionEstamento(estamento) {
    const normalized = normalizeStaffingEstamento(estamento);
    const source = String(normalized || estamento || "")
        .toLowerCase();

    if (source.includes("cnico")) return "T\u00e9cnico";
    if (normalized === "Administrativo") return "Administrativo";
    if (normalized === "Auxiliar") return "Auxiliar";

    return "Profesional";
}

function normalizeStaffingProfession(value, estamento = "Profesional") {
    const clean = String(value || "").trim();

    return normalizeProfession(
        clean || "Sin informacion",
        professionEstamento(estamento)
    );
}

function normalizeStaffingRotativa(type) {
    const value = String(type || "")
        .trim()
        .toLowerCase();

    if (value === "4° turno" || value === "4 turno") return "4turno";
    if (value === "3er turno" || value === "3 turno") return "3turno";
    if (value === "diurno") return "diurno";

    return value;
}

function getStaffingProfileModality(profile, keyDay = "") {
    const bridgeContract = keyDay
        ? getDiurnoBridgeContractForProfile(profile.name, keyDay)
        : null;

    if (bridgeContract?.replaces) {
        return normalizeStaffingRotativa(
            getRotativa(bridgeContract.replaces)?.type ||
            getRotativa(profile.name)?.type ||
            profile.rotativaActual ||
            profile.rotation
        );
    }

    const replacementRotationMode =
        keyDay && isReplacementProfile(profile.name)
            ? getReplacementRotationModeForDate(profile.name, keyDay)
            : "";
    const replacedProfileName =
        replacementRotationMode === REPLACEMENT_ROTATION_MODE.INHERIT
            ? getReplacedProfileForDate(profile.name, keyDay)
            : "";
    const inheritedRotativa =
        replacedProfileName
            ? getRotativa(replacedProfileName)?.type
            : "";

    return normalizeStaffingRotativa(
        (
            replacementRotationMode === REPLACEMENT_ROTATION_MODE.FREE
                ? "libre"
                : replacementRotationMode ===
                    REPLACEMENT_ROTATION_MODE.DIURNO_BRIDGE
                    ? "diurno"
                : getRotativa(profile.name)?.type
        ) ||
        inheritedRotativa ||
        profile.rotativaActual ||
        profile.rotation
    );
}

function getStaffingProfileGroupKey(profile) {
    const estamento = normalizeStaffingEstamento(profile.estamento);

    return isProfessionBasedStaffing(estamento)
        ? normalizeStaffingProfession(profile.profession, estamento)
        : "total";
}

function getStaffingGroupLabel(estamento, groupKey) {
    return isProfessionBasedStaffing(estamento)
        ? normalizeStaffingProfession(groupKey, estamento)
        : estamento;
}

function worksStaffingLong(turno) {
    return turno === TURNO.LARGA ||
        turno === TURNO.TURNO24;
}

const STAFFING_SEGMENT = {
    DAY_MORNING: "day_morning",
    DAY_AFTERNOON: "day_afternoon",
    NIGHT: "night"
};

function addDaySegments(segments) {
    segments.add(STAFFING_SEGMENT.DAY_MORNING);
    segments.add(STAFFING_SEGMENT.DAY_AFTERNOON);
}

function turnSegmentsForStaffing(row, turno) {
    const state = Number(turno) || TURNO.LIBRE;
    const segments = new Set();

    if (
        state === TURNO.NOCHE ||
        state === TURNO.TURNO24 ||
        state === TURNO.DIURNO_NOCHE ||
        state === TURNO.TURNO18
    ) {
        segments.add(STAFFING_SEGMENT.NIGHT);
    }

    if (row.modality === "diurno") {
        if (
            state === TURNO.DIURNO ||
            state === TURNO.DIURNO_NOCHE
        ) {
            addDaySegments(segments);
        }
    } else if (
        state === TURNO.LARGA ||
        state === TURNO.TURNO24
    ) {
        addDaySegments(segments);
    }

    if (state === TURNO.MEDIA_MANANA) {
        segments.add(STAFFING_SEGMENT.DAY_MORNING);
    }

    if (
        state === TURNO.MEDIA_TARDE ||
        state === TURNO.TURNO18
    ) {
        segments.add(STAFFING_SEGMENT.DAY_AFTERNOON);
    }

    return segments;
}

function removeSegmentsByAbsence(absence, currentSegments) {
    const removed = new Set();

    if (!absence) return removed;

    if (absence.kind === "half_morning") {
        removed.add(STAFFING_SEGMENT.DAY_MORNING);
        return removed;
    }

    if (absence.kind === "half_afternoon") {
        removed.add(STAFFING_SEGMENT.DAY_AFTERNOON);
        return removed;
    }

    if (absence.kind === "half_unknown") {
        removed.add(STAFFING_SEGMENT.DAY_MORNING);
        removed.add(STAFFING_SEGMENT.DAY_AFTERNOON);
        return removed;
    }

    currentSegments.forEach(segment => removed.add(segment));

    return removed;
}

function key(y, m, d){
    return `${y}-${m}-${d}`;
}

function normalizeSearch(value) {
    return normalizeText(value);
}

async function readApplicantDocuments(files, applicantId) {
    return readAttachmentFiles(files, {
        moduleId: "weekly",
        ownerId: applicantId,
        recordId: "applicant-documents"
    });
}

async function openApplicantDocument(doc) {
    try {
        await openAttachmentFile(doc, { newTab: true });
    } catch (error) {
        alert(error?.message || "No se pudo abrir el documento.");
    }
}

function formatFileSize(size) {
    const bytes = Number(size) || 0;

    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 102.4) / 10} KB`;
    }

    return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

// Acepta las dos formas guardadas: YYYY-MM-DD y DD-MM-YYYY.
export function birthDateParts(value) {
    const source = String(value || "").trim();
    let match = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (match) {
        return {
            month: Number(match[2]) - 1,
            day: Number(match[3])
        };
    }

    match = source.match(/^(\d{2})-(\d{2})-(\d{4})$/);

    if (match) {
        return {
            month: Number(match[2]) - 1,
            day: Number(match[1])
        };
    }

    return null;
}

function formatMonth(year, month) {
    return new Date(year, month, 1)
        .toLocaleString("es-CL", {
            month: "short",
            year: "2-digit"
        })
        .replace(".", "");
}

function formatFullWeekday(date) {
    return date
        .toLocaleDateString("es-CL", { weekday: "long" });
}

function formatShortDate(date) {
    return date.toLocaleDateString("es-CL", {
        day: "2-digit",
        month: "2-digit"
    });
}

function isMedicalType(type) {
    return (
        type === "license" ||
        type === "union_leave" ||
        type === "professional_license"
    );
}

function getAbsencesPerfil(nombre) {
    return getJSON("absences_" + nombre, {});
}

function medicalSeriesTemplate() {
    const end = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
    );
    const start = new Date(
        end.getFullYear(),
        end.getMonth() - 23,
        1
    );
    const months = [];

    for (let i = 0; i < 24; i++) {
        const date = new Date(
            start.getFullYear(),
            start.getMonth() + i,
            1
        );

        months.push({
            year: date.getFullYear(),
            month: date.getMonth(),
            label: formatMonth(
                date.getFullYear(),
                date.getMonth()
            ),
            license: 0,
            professional: 0
        });
    }

    return months;
}

function countMedicalAbsences(nombre) {
    const months = medicalSeriesTemplate();
    const index = new Map(
        months.map((item, position) => [
            `${item.year}-${item.month}`,
            position
        ])
    );

    Object.entries(getAbsencesPerfil(nombre))
        .forEach(([keyDay, absence]) => {
            const type = getAbsenceType(absence);

            if (!isMedicalType(type)) return;

            const parsed = parseKey(keyDay);
            const position =
                index.get(`${parsed.year}-${parsed.month}`);

            if (position === undefined) return;

            if (type === "professional_license") {
                months[position].professional++;
            } else {
                months[position].license++;
            }
        });

    return months;
}

function mode(values) {
    if (!values.length) return 0;

    const counts = new Map();

    values.forEach(value => {
        counts.set(value, (counts.get(value) || 0) + 1);
    });

    return [...counts.entries()]
        .sort((a, b) =>
            b[1] - a[1] ||
            b[0] - a[0]
        )[0][0];
}

function formatDecimal(value) {
    const rounded =
        Math.round((Number(value) || 0) * 10) / 10;

    if (Number.isInteger(rounded)) return String(rounded);

    return String(rounded).replace(".", ",");
}

export function renderStaffingMedicalChart() {
    const target = document.getElementById("staffingMedicalChart");
    if (!target) return;

    const selectedName = getCurrentProfile();
    const selectedProfile = getProfiles().find(profile =>
        profile.name === selectedName
    );

    if (!selectedProfile) {
        target.innerHTML = `
            <section class="medical-chart-card">
                <div class="empty-state empty-state--compact">
                    Selecciona un trabajador para comparar licencias.
                </div>
            </section>
        `;
        return;
    }

    const peers = getProfiles()
        .filter(isProfileActive)
        .filter(profile =>
            profile.name !== selectedProfile.name &&
            profile.estamento === selectedProfile.estamento
        );
    const selectedSeries =
        countMedicalAbsences(selectedProfile.name);
    const peerSeries =
        peers.map(profile => countMedicalAbsences(profile.name));

    const chartRows = selectedSeries.map((item, index) => {
        const peerTotals = peerSeries.map(series =>
            (series[index]?.license || 0) +
            (series[index]?.professional || 0)
        );
        const average = peerTotals.length
            ? peerTotals.reduce((sum, value) => sum + value, 0) /
                peerTotals.length
            : 0;

        return {
            ...item,
            total: item.license + item.professional,
            peerAverage: average,
            peerMode: mode(peerTotals)
        };
    });
    const maxValue = Math.max(
        1,
        ...chartRows.map(row =>
            Math.max(row.total, row.peerAverage, row.peerMode)
        )
    );
    const selectedTotals = chartRows.reduce(
        (total, row) => ({
            license: total.license + row.license,
            professional:
                total.professional + row.professional
        }),
        { license: 0, professional: 0 }
    );
    const peerPeriodTotals = peers.map((_profile, peerIndex) =>
        peerSeries[peerIndex].reduce(
            (sum, row) =>
                sum + row.license + row.professional,
            0
        )
    );
    const peerPeriodAverage = peerPeriodTotals.length
        ? peerPeriodTotals.reduce((sum, value) => sum + value, 0) /
            peerPeriodTotals.length
        : 0;
    const peerPeriodMode = mode(peerPeriodTotals);
    const latestLabel =
        chartRows[chartRows.length - 1]?.label || "";
    const firstLabel = chartRows[0]?.label || "";

    target.innerHTML = `
        <section class="medical-chart-card">
            <div class="medical-chart-head">
                <div>
                    <h4>Licencias \u00faltimos 2 a\u00f1os</h4>
                    <p>
                        ${escapeHTML(selectedProfile.name)} vs ${peers.length} trabajador(es)
                        ${escapeHTML(selectedProfile.estamento)} | ${escapeHTML(firstLabel)} - ${escapeHTML(latestLabel)}
                    </p>
                </div>

                <div class="medical-chart-summary">
                    <span>LM: <strong>${selectedTotals.license}</strong></span>
                    <span>LMP: <strong>${selectedTotals.professional}</strong></span>
                    <span>Prom. pares: <strong>${formatDecimal(peerPeriodAverage)}</strong></span>
                    <span>Moda pares: <strong>${formatDecimal(peerPeriodMode)}</strong></span>
                </div>
            </div>

            <div class="medical-chart-legend">
                <span><i class="medical-color-license"></i> LM perfil</span>
                <span><i class="medical-color-professional"></i> LMP perfil</span>
                <span><i class="medical-line-average"></i> Promedio pares</span>
                <span><i class="medical-line-mode"></i> Moda pares</span>
            </div>

            <div class="medical-chart-bars">
                ${chartRows.map(row => {
                    const licenseHeight = row.license
                        ? (row.license / maxValue) * 100
                        : 0;
                    const professionalHeight = row.professional
                        ? (row.professional / maxValue) * 100
                        : 0;
                    const averageBottom =
                        (row.peerAverage / maxValue) * 100;
                    const modeBottom =
                        (row.peerMode / maxValue) * 100;

                    return `
                        <div class="medical-chart-month" title="${escapeHTML(row.label)}: LM ${row.license}, LMP ${row.professional}, promedio pares ${escapeHTML(formatDecimal(row.peerAverage))}, moda pares ${escapeHTML(formatDecimal(row.peerMode))}">
                            <div class="medical-chart-bar">
                                <span class="medical-ref medical-ref--average" style="bottom:${averageBottom}%"></span>
                                <span class="medical-ref medical-ref--mode" style="bottom:${modeBottom}%"></span>
                                <span class="medical-stack medical-stack--professional" style="height:${professionalHeight}%"></span>
                                <span class="medical-stack medical-stack--license" style="height:${licenseHeight}%"></span>
                            </div>
                            <small>${escapeHTML(row.label)}</small>
                        </div>
                    `;
                }).join("")}
            </div>
        </section>
    `;
}

function getApplicants() {
    return getJSON(APPLICANTS_KEY, [])
        .map(applicant => ({
            id: applicant.id || `app_${Date.now()}`,
            name: String(applicant.name || "").trim(),
            phone: String(applicant.phone || "").trim(),
            receivedDate: applicant.receivedDate || "",
            estamento: normalizeStaffingEstamento(
                applicant.estamento || "Profesional"
            ),
            profession: normalizeProfession(
                applicant.profession,
                applicant.estamento || "Profesional"
            ),
            institution: String(applicant.institution || "").trim(),
            graduationYear:
                String(applicant.graduationYear || "").trim(),
            experience: String(applicant.experience || "").trim(),
            interviewImpressions:
                String(applicant.interviewImpressions || "").trim(),
            documents: Array.isArray(applicant.documents)
                ? applicant.documents
                : [],
            createdAt: applicant.createdAt || new Date().toISOString()
        }))
        .sort((a, b) =>
            String(b.receivedDate || "").localeCompare(
                String(a.receivedDate || "")
            ) ||
            a.name.localeCompare(b.name, "es")
        );
}

function saveApplicants(applicants) {
    setJSON(APPLICANTS_KEY, applicants);
}

function applicantRoleOptions(selected = "") {
    return ["Profesional", "T\u00e9cnico", "Administrativo", "Auxiliar"]
        .map(estamento => `
            <option value="${escapeHTML(estamento)}" ${normalizeStaffingEstamento(selected) === normalizeStaffingEstamento(estamento) ? "selected" : ""}>
                ${escapeHTML(estamento)}
            </option>
        `)
        .join("");
}

function formatEstamentoLabel(value) {
    const normalized = normalizeSearch(value);

    if (normalized.includes("cnico")) return "T\u00e9cnico";
    if (normalized.includes("administrativo")) return "Administrativo";
    if (normalized.includes("auxiliar")) return "Auxiliar";

    return "Profesional";
}

function applicantProfessionOptions(estamento = "Profesional") {
    return getProfessionOptionsForEstamento(estamento)
        .filter(value => value !== "Sin informacion")
        .map(value => `
            <option value="${escapeHTML(value)}"></option>
        `)
        .join("");
}

function applicantFilterProfessionOptions(applicants, selected) {
    const professions = [...new Set(
        applicants
            .map(applicant => applicant.profession)
            .filter(Boolean)
            .filter(value => value !== "Sin informacion")
    )].sort((a, b) => a.localeCompare(b, "es"));

    return `
        <option value="Todas">Todas</option>
        ${professions.map(profession => `
            <option value="${escapeHTML(profession)}" ${profession === selected ? "selected" : ""}>
                ${escapeHTML(profession)}
            </option>
        `).join("")}
    `;
}

function applicantMatchesFilters(applicant, roleFilter, professionFilter) {
    const roleMatches =
        roleFilter === "Todos" ||
        normalizeStaffingEstamento(applicant.estamento) ===
            normalizeStaffingEstamento(roleFilter);
    const professionMatches =
        professionFilter === "Todas" ||
        applicant.profession === professionFilter;

    return roleMatches && professionMatches;
}

function renderApplicantDocuments(applicant) {
    const docs = applicant.documents || [];

    if (!docs.length) {
        return `
            <div class="attachment-empty">
                Sin documentos adjuntos.
            </div>
        `;
    }

    return docs.map((doc, index) => `
        <div class="attachment-item">
            <span>
                <strong>${escapeHTML(doc.name || "Documento")}</strong>
                <small>
                    ${escapeHTML(doc.type || "Archivo")}
                    ${doc.size ? ` | ${escapeHTML(formatFileSize(doc.size))}` : ""}
                </small>
            </span>
            <span class="attachment-actions">
                <button class="secondary-button attachment-view" type="button" data-applicant-doc="${escapeHTML(applicant.id)}" data-doc-index="${index}" ${hasAttachmentContent(doc) ? "" : "disabled"}>
                    Ver
                </button>
            </span>
        </div>
    `).join("");
}

function renderApplicantCard(applicant) {
    return `
        <article class="applicant-card" data-applicant-id="${escapeHTML(applicant.id)}">
            <div class="applicant-card__head">
                <div class="applicant-card__title">
                    <strong>${escapeHTML(applicant.name || "Sin nombre")}</strong>
                    <span>
                        ${escapeHTML(formatEstamentoLabel(applicant.estamento))}
                        ${applicant.profession && applicant.profession !== "Sin informacion" ? ` | ${escapeHTML(applicant.profession)}` : ""}
                    </span>
                </div>
                <button class="ghost-button" type="button" data-applicant-delete="${escapeHTML(applicant.id)}">
                    Eliminar
                </button>
            </div>

            <div class="applicant-card__meta">
                <span>Tel: <strong>${escapeHTML(applicant.phone || "Sin informacion")}</strong></span>
                <span>Recepcion: <strong>${escapeHTML(applicant.receivedDate || "Sin fecha")}</strong></span>
                <span>Egreso: <strong>${escapeHTML(applicant.graduationYear || "Sin informacion")}</strong></span>
                <span>Institucion: <strong>${escapeHTML(applicant.institution || "Sin informacion")}</strong></span>
            </div>

            <div class="applicant-card__notes">
                <div>
                    <small>Experiencia Laboral</small>
                    <p>${escapeHTML(applicant.experience || "Sin informacion")}</p>
                </div>
                <div>
                    <small>Impresiones de la Entrevista</small>
                    <p>${escapeHTML(applicant.interviewImpressions || "Sin informacion")}</p>
                </div>
            </div>

            <div class="applicant-documents">
                ${renderApplicantDocuments(applicant)}
            </div>
        </article>
    `;
}

function renderApplicantsPanel() {
    const target = document.getElementById("staffingApplicantsPanel");

    if (!target) return;

    const applicants = getApplicants();
    const roleFilter =
        document.getElementById("applicantFilterRole")?.value ||
        "Todos";
    const currentProfessionFilter =
        document.getElementById("applicantFilterProfession")?.value ||
        "Todas";
    const professions = new Set(
        applicants.map(applicant => applicant.profession)
    );
    const professionFilter = professions.has(currentProfessionFilter)
        ? currentProfessionFilter
        : "Todas";
    const visible = applicants.filter(applicant =>
        applicantMatchesFilters(
            applicant,
            roleFilter,
            professionFilter
        )
    );
    const today = new Date().toISOString().slice(0, 10);

    target.innerHTML = `
        <div class="section-head">
            <h3>Postulantes</h3>
        </div>

        <div class="applicant-toolbar">
            <label>
                <span>Filtrar estamento</span>
                <select id="applicantFilterRole">
                    <option value="Todos">Todos</option>
                    ${applicantRoleOptions(roleFilter)}
                </select>
            </label>

            <label>
                <span>Filtrar profesi\u00f3n</span>
                <select id="applicantFilterProfession">
                    ${applicantFilterProfessionOptions(applicants, professionFilter)}
                </select>
            </label>
        </div>

        <form id="applicantForm" class="applicant-form">
            <label>
                <span>Nombre</span>
                <input name="name" type="text" required>
            </label>
            <label>
                <span>Telefono</span>
                <input name="phone" type="tel">
            </label>
            <label>
                <span>Fecha de Recepci\u00f3n</span>
                <input name="receivedDate" type="date" value="${today}">
            </label>
            <label>
                <span>Estamento</span>
                <select name="estamento">
                    ${applicantRoleOptions("Profesional")}
                </select>
            </label>
            <label>
                <span>Profesi\u00f3n</span>
                <input name="profession" type="text" list="applicantProfessionOptions">
                <datalist id="applicantProfessionOptions">
                    ${applicantProfessionOptions("Profesional")}
                </datalist>
            </label>
            <label>
                <span>Universidad/Instituto</span>
                <input name="institution" type="text">
            </label>
            <label>
                <span>A\u00f1o de egreso</span>
                <input name="graduationYear" type="number" min="1950" max="2100">
            </label>
            <label>
                <span>Documentos</span>
                <input name="documents" type="file" multiple accept="${ATTACHMENT_ACCEPT}">
            </label>
            <label>
                <span>Experiencia Laboral</span>
                <textarea name="experience"></textarea>
            </label>
            <label>
                <span>Impresiones de la Entrevista</span>
                <textarea name="interviewImpressions"></textarea>
            </label>
            <div class="applicant-form-actions">
                <button class="primary-button" type="submit">
                    Guardar postulante
                </button>
            </div>
        </form>

        <div class="applicant-list">
            ${visible.length
                ? visible.map(renderApplicantCard).join("")
                : `
                    <div class="attachment-empty">
                        ${applicants.length ? "No hay postulantes para los filtros seleccionados." : "Sin postulantes registrados."}
                    </div>
                `}
        </div>
    `;

    bindApplicantsPanel(target);
}

function bindApplicantsPanel(target) {
    const form = target.querySelector("#applicantForm");
    const roleFilter = target.querySelector("#applicantFilterRole");
    const professionFilter =
        target.querySelector("#applicantFilterProfession");
    const roleInput = form?.elements.estamento;
    const professionOptions =
        target.querySelector("#applicantProfessionOptions");

    if (roleFilter) {
        roleFilter.onchange = renderApplicantsPanel;
    }

    if (professionFilter) {
        professionFilter.onchange = renderApplicantsPanel;
    }

    if (roleInput && professionOptions) {
        roleInput.onchange = () => {
            professionOptions.innerHTML =
                applicantProfessionOptions(roleInput.value);
        };
    }

    if (form) {
        form.onsubmit = async event => {
            event.preventDefault();

            const formData = new FormData(form);
            const estamento = normalizeStaffingEstamento(
                formData.get("estamento")
            );
            const name = String(formData.get("name") || "").trim();

            if (!name) {
                alert("Debes indicar el nombre del postulante.");
                return;
            }

            const submitButton = form.querySelector("[type='submit']");

            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = "Guardando...";
            }

            try {
                const applicantId =
                    `app_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const documents = await readApplicantDocuments(
                    form.elements.documents?.files,
                    applicantId
                );
                const applicants = getApplicants();
                const record = {
                    id: applicantId,
                    name,
                    phone: String(formData.get("phone") || "").trim(),
                    receivedDate:
                        String(formData.get("receivedDate") || "").trim(),
                    estamento,
                    profession: normalizeProfession(
                        formData.get("profession"),
                        estamento
                    ),
                    institution:
                        String(formData.get("institution") || "").trim(),
                    graduationYear:
                        String(formData.get("graduationYear") || "").trim(),
                    experience:
                        String(formData.get("experience") || "").trim(),
                    interviewImpressions:
                        String(formData.get("interviewImpressions") || "").trim(),
                    documents,
                    createdAt: new Date().toISOString()
                };

                saveApplicants([record, ...applicants]);
                addAuditLog(
                    AUDIT_CATEGORY.STAFFING,
                    "Agrego postulante",
                    `${record.name}: ${formatEstamentoLabel(record.estamento)} | ${record.profession}.`,
                    { applicantId: record.id }
                );
                renderApplicantsPanel();
            } catch (error) {
                console.error(error);
                alert(error?.planBlocked
                    ? error.message
                    : "No se pudieron guardar los documentos del postulante.");
            }
        };
    }

    target
        .querySelectorAll("[data-applicant-delete]")
        .forEach(button => {
            button.onclick = async () => {
                const id = button.dataset.applicantDelete;
                const applicants = getApplicants();
                const applicant = applicants.find(item =>
                    item.id === id
                );

                if (
                    !applicant ||
                    !await showConfirm(
                        `Se eliminará el registro de ${applicant.name} y sus documentos asociados.`,
                        {
                            title: "Eliminar postulante",
                            tone: "danger",
                            confirmText: "Eliminar",
                            destructive: true
                        }
                    )
                ) {
                    return;
                }

                saveApplicants(applicants.filter(item => item.id !== id));
                await Promise.all(
                    (applicant.documents || []).map(document =>
                        deleteStoredAttachment(document).catch(error => {
                            console.warn(
                                "No se pudo eliminar un adjunto remoto.",
                                error
                            );
                        })
                    )
                );
                addAuditLog(
                    AUDIT_CATEGORY.STAFFING,
                    "Elimino postulante",
                    `${applicant.name}: registro eliminado.`,
                    { applicantId: applicant.id }
                );
                renderApplicantsPanel();
            };
        });

    target
        .querySelectorAll("[data-applicant-doc]")
        .forEach(button => {
            button.onclick = async () => {
                const applicant = getApplicants().find(item =>
                    item.id === button.dataset.applicantDoc
                );
                const doc =
                    applicant?.documents?.[Number(button.dataset.docIndex)];

                await openApplicantDocument(doc);
            };
        });
}

function renderStaffingProfiles() {
    const target = document.getElementById("staffingProfiles");

    if (!target) return;

    const profiles = getProfiles();
    const showInactive =
        document.getElementById("staffingShowInactiveProfiles")?.checked ??
        false;
    const roleFilter =
        document.getElementById("staffingFilterRole")?.value ||
        "Todos";
    const query = normalizeSearch(
        document.getElementById("staffingProfileSearch")?.value || ""
    );
    const current = getCurrentProfile();
    const visible = profiles.filter(profile => {
        const activeMatches =
            showInactive || isProfileActive(profile);
        const roleMatches =
            roleFilter === "Todos" ||
            normalizeStaffingEstamento(profile.estamento) ===
                normalizeStaffingEstamento(roleFilter);
        const haystack = normalizeSearch([
            profile.name,
            profile.estamento,
            profile.profession,
            profile.email,
            profile.rut
        ].join(" "));

        return activeMatches &&
            roleMatches &&
            (!query || haystack.includes(query));
    });
    const empty = document.getElementById("staffingEmptyProfiles");

    target.innerHTML = "";

    if (empty) {
        empty.classList.toggle("hidden", Boolean(visible.length));
        empty.textContent = profiles.length
            ? "No hay resultados con ese filtro."
            : "Aun no hay colaboradores creados.";
    }

    visible.forEach(profile => {
        const item = document.createElement("div");
        item.className = "profile-item";

        if (!isProfileActive(profile)) {
            item.classList.add("is-inactive");
        }

        if (profile.name === current) {
            item.classList.add("active");
        }

        const avatar = document.createElement("div");
        avatar.className = "profile-item__avatar";
        avatar.textContent =
            profile.name.trim().charAt(0).toUpperCase() || "T";

        const content = document.createElement("div");
        content.className = "profile-item__content";

        const name = document.createElement("strong");
        name.textContent = profile.name;

        const meta = document.createElement("span");
        meta.textContent = [
            formatEstamentoLabel(profile.estamento),
            profile.profession && profile.profession !== "Sin informacion"
                ? profile.profession
                : ""
        ]
            .filter(Boolean)
            .join(" | ");

        content.append(name, meta);
        item.append(avatar, content);

        item.onclick = () => {
            if (typeof window.selectProfileByName === "function") {
                window.selectProfileByName(profile.name);
            }

            renderStaffingProfiles();
            renderStaffingMedicalChart();
        };

        target.appendChild(item);
    });
}

function absenceCacheKey(profileName, keyDay) {
    return `${profileName}::${keyDay}`;
}

function absenceLabelFromType(type) {
    if (type === "professional_license") return "LM Profesional";
    if (type === "union_leave") return "Permiso Gremial";
    if (type === "unpaid_leave") return "Permiso sin Goce";
    if (type === "training") return "Capacitaci\u00f3n";
    if (type === "license") return "Licencia M\u00e9dica";
    if (type === "unjustified_absence") {
        return "Ausencia injustificada";
    }

    return type ? "Ausencia" : "";
}

function getProfileStaffingAbsence(profileName, keyDay, cache) {
    const cacheKey = absenceCacheKey(profileName, keyDay);

    if (cache?.has(cacheKey)) {
        return cache.get(cacheKey);
    }

    const admin = getJSON(`admin_${profileName}`, {});
    const legal = getJSON(`legal_${profileName}`, {});
    const comp = getJSON(`comp_${profileName}`, {});
    const absences = getJSON(`absences_${profileName}`, {});
    let absence = null;

    if (admin[keyDay] === 1) {
        absence = {
            code: "admin",
            kind: "full",
            label: "P. Administrativo"
        };
    } else if (admin[keyDay] === "0.5M") {
        absence = {
            code: "half_morning",
            kind: "half_morning",
            label: "1/2 ADM Ma\u00f1ana"
        };
    } else if (admin[keyDay] === "0.5T") {
        absence = {
            code: "half_afternoon",
            kind: "half_afternoon",
            label: "1/2 ADM Tarde"
        };
    } else if (admin[keyDay] === 0.5) {
        absence = {
            code: "half_unknown",
            kind: "half_unknown",
            label: "1/2 ADM"
        };
    } else if (legal[keyDay]) {
        absence = {
            code: "legal",
            kind: "full",
            label: "F. Legal"
        };
    } else if (comp[keyDay]) {
        absence = {
            code: "comp",
            kind: "full",
            label: "F. Compensatorio"
        };
    } else if (absences[keyDay]) {
        const type = getAbsenceType(absences[keyDay]);

        absence = {
            code: type,
            kind: "full",
            label: absenceLabelFromType(type)
        };
    }

    if (cache) {
        cache.set(cacheKey, absence);
    }

    return absence;
}

function getStaffingTurno(profile, y, m, d, options = {}) {
    const dayKey = key(y, m, d);

    return aplicarCambiosTurno(
        profile.name,
        dayKey,
        getTurnoProgramado(profile.name, dayKey),
        options
    );
}

function weekStartMonday(date) {
    const base = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );
    const day = base.getDay();
    const offset = day === 0 ? -6 : 1 - day;

    base.setDate(base.getDate() + offset);
    return base;
}

function staffingWeekDays(date = currentDate) {
    const start = weekStartMonday(date);

    return Array.from({ length: 7 }, (_, index) => {
        const day = new Date(start);
        day.setDate(start.getDate() + index);
        return day;
    });
}

function getStaffingWeekDate() {
    if (!staffingWeekDate) {
        staffingWeekDate = new Date(
            currentDate.getFullYear(),
            currentDate.getMonth(),
            currentDate.getDate()
        );
    }

    return staffingWeekDate;
}

function changeStaffingWeek(offset) {
    const next = new Date(getStaffingWeekDate());
    next.setDate(next.getDate() + offset * 7);
    staffingWeekDate = next;
    renderStaffingWeeklyCalendar();
}

function profileWeeklyShiftContext(
    profile,
    date,
    absenceCache,
    options = {}
) {
    const y = date.getFullYear();
    const m = date.getMonth();
    const d = date.getDate();
    const dayKey = key(y, m, d);
    const modality = getStaffingProfileModality(profile, dayKey);
    const isDiurno = modality === "diurno";
    const turno = getStaffingTurno(profile, y, m, d, options);
    const displaysAsLong =
        isDiurno &&
        worksStaffingLong(turno);
    const row = {
        modality:
            isDiurno && !displaysAsLong
                ? "diurno"
                : "4turno"
    };
    const beforeSegments = turnSegmentsForStaffing(row, turno);
    const absence = getProfileStaffingAbsence(
        profile.name,
        dayKey,
        absenceCache
    );
    const removedSegments =
        removeSegmentsByAbsence(absence, beforeSegments);
    const activeSegments = new Set(
        [...beforeSegments].filter(segment =>
            !removedSegments.has(segment)
        )
    );

    return {
        dayKey,
        isDiurno,
        displaysAsLong,
        turno,
        activeSegments,
        beforeSegments,
        removedSegments,
        absence
    };
}

function weeklySegmentsForShift(shiftKey, context, segments) {
    const source = [...segments];

    if (shiftKey === "diurno") {
        if (!context.isDiurno || context.displaysAsLong) return [];
        return source.filter(segment =>
            segment === STAFFING_SEGMENT.DAY_MORNING ||
            segment === STAFFING_SEGMENT.DAY_AFTERNOON
        );
    }

    if (shiftKey === "larga") {
        if (context.isDiurno && !context.displaysAsLong) return [];
        return source.filter(segment =>
            segment === STAFFING_SEGMENT.DAY_MORNING ||
            segment === STAFFING_SEGMENT.DAY_AFTERNOON
        );
    }

    if (
        shiftKey === "noche" &&
        source.includes(STAFFING_SEGMENT.NIGHT)
    ) {
        return [STAFFING_SEGMENT.NIGHT];
    }

    return [];
}

function profileWeeklyShiftSegments(profile, date, shiftKey, absenceCache) {
    const context = profileWeeklyShiftContext(
        profile,
        date,
        absenceCache
    );

    return weeklySegmentsForShift(
        shiftKey,
        context,
        context.activeSegments
    );
}

function weeklyProfileMeta(profile) {
    const group = getStaffingProfileGroupKey(profile);
    const estamento = normalizeStaffingEstamento(profile.estamento);
    const groupLabel = getStaffingGroupLabel(estamento, group);
    const profession = weeklyProfileProfession(profile);

    if (isProfessionBasedStaffing(estamento)) return groupLabel;
    if (profession === "Sin informacion") return estamento;

    return `${estamento} | ${profession}`;
}

function weeklyProfileProfession(profile) {
    return normalizeStaffingProfession(
        profile.profession,
        normalizeStaffingEstamento(profile.estamento)
    );
}

// Los filtros de la barra son chips COMBINABLES, pero su seleccion sigue
// viajando como un string -separado por comas- porque es lo que entra en la
// firma de la cache y en los overrides de render. "Todos"/"Todas" significa
// que no hay ninguno marcado, es decir, todo.
const WEEKLY_NO_ESTAMENTO = "__sin__";
const WEEKLY_ALL_LEAVES = "leaves";

function weeklyTokens(value, all) {
    const clean = String(value ?? all);

    return clean === all ? [] : clean.split(",").filter(Boolean);
}

/** Prende o apaga un chip y devuelve el valor nuevo del filtro. */
function weeklyToggleToken(value, token, all) {
    const tokens = new Set(weeklyTokens(value, all));

    if (tokens.has(token)) tokens.delete(token);
    else tokens.add(token);

    return tokens.size ? [...tokens].join(",") : all;
}

function weeklyProfileMatchesFilters(
    profile,
    roleFilter = "Todos",
    professionFilter = "Todas"
) {
    const profileEstamento =
        normalizeStaffingEstamento(profile.estamento);
    const roles = weeklyTokens(roleFilter, "Todos");
    // Quien tiene la ficha incompleta no cae en ningun estamento del
    // catalogo: sin un chip propio no habria forma de llegar a el.
    const knownEstamento =
        STAFFING_ESTAMENTOS.includes(profileEstamento);
    const roleMatches =
        !roles.length ||
        roles.includes(profileEstamento) ||
        (roles.includes(WEEKLY_NO_ESTAMENTO) && !knownEstamento);
    const professions = weeklyTokens(professionFilter, "Todas");
    const professionMatches =
        !professions.length ||
        professions.includes(weeklyProfileProfession(profile));

    return roleMatches && professionMatches;
}

/**
 * .Este estamento pasa los chips de estamento?
 *
 * Lo mismo que weeklyProfileMatchesFilters hace con un perfil, pero con un
 * estamento suelto: una carencia de rotativa no tiene ficha ni profesion.
 */
function weeklyRoleFilterAllows(estamento, roleFilter = "Todos") {
    const roles = weeklyTokens(roleFilter, "Todos");

    return !roles.length || roles.includes(estamento);
}

function weeklyAvailableProfessions(roleFilter) {
    return [...new Set(
        getProfiles()
            .filter(isProfileActive)
            .filter(profile =>
                weeklyProfileMatchesFilters(profile, roleFilter)
            )
            .map(weeklyProfileProfession)
    )].sort((a, b) => a.localeCompare(b, "es"));
}

function weeklyProfileNeedsReplacement(profile, keyDay, turno) {
    const maps = {
        admin: getJSON(`admin_${profile.name}`, {}),
        legal: getJSON(`legal_${profile.name}`, {}),
        comp: getJSON(`comp_${profile.name}`, {}),
        absences: getJSON(`absences_${profile.name}`, {})
    };

    return requiereReemplazoTurnoBase(
        keyDay,
        turno,
        maps.admin,
        maps.legal,
        maps.comp,
        maps.absences,
        getRotativa(profile.name).type
    ) &&
        !getReplacementForCoveredShift(profile.name, keyDay) &&
        !getInheritedReplacementContractForCoveredShift(
            profile.name,
            keyDay
        ) &&
        !isNoCoverageDay(profile.name, keyDay);
}

function profileWeeklyPendingReplacementSlot(
    profile,
    date,
    shiftKey,
    absenceCache
) {
    const context = profileWeeklyShiftContext(
        profile,
        date,
        absenceCache,
        { includeReplacements: false }
    );
    const segments = weeklySegmentsForShift(
        shiftKey,
        context,
        context.removedSegments
    );

    if (!segments.length) return null;
    if (
        !weeklyProfileNeedsReplacement(
            profile,
            context.dayKey,
            context.turno
        )
    ) {
        return null;
    }

    return {
        type: "replacement-slot",
        profile,
        keyDay: context.dayKey,
        segments,
        absence: context.absence
    };
}

const WEEKLY_SHIFTS = [
    { key: "diurno", label: "Diurno" },
    { key: "larga", label: "Larga" },
    { key: "noche", label: "Noche" }
];

const WEEKLY_LEAVE_ROWS = [
    { key: "license", label: "Licencia M\u00e9dica" },
    { key: "professional_license", label: "LM Profesional" },
    { key: "union_leave", label: "Permiso Gremial" },
    { key: "training", label: "Capacitaci\u00f3n" },
    { key: "admin", label: "P. Administrativo" },
    { key: "legal", label: "F. Legal" },
    { key: "comp", label: "F. Compensatorio" },
    { key: "half_morning", label: "1/2 ADM Ma\u00f1ana" },
    { key: "half_afternoon", label: "1/2 ADM Tarde" },
    { key: "unpaid_leave", label: "Permiso sin Goce" },
    { key: "unjustified_absence", label: "Ausencia injustificada" },
    { key: "hour_return", label: "Devoluci\u00f3n de Hora" }
];

/**
 * Deja del filtro de tipo solo lo que existe esta semana.
 *
 * Un tipo de ausencia marcado puede no tener a nadie la semana siguiente;
 * arrastrarlo dejaria la pantalla en blanco sin decir por que.
 */
function normalizeWeeklyTypeFilter(value, leaveRows = []) {
    const valid = new Set([
        WEEKLY_ALL_LEAVES,
        ...WEEKLY_SHIFTS.map(shift => `shift:${shift.key}`),
        ...leaveRows.map(row => `leave:${row.key}`)
    ]);
    const kept = weeklyTokens(value, "Todos")
        .filter(token => valid.has(token));

    return kept.length ? kept.join(",") : "Todos";
}

/**
 * Un chip del filtro. `tone` pinta el punto de color de los turnos; los de
 * estamento y profesion van sin punto, para que los dos grupos se
 * distingan de un vistazo.
 */
function weeklyChipHTML({ group, token, label, count, tone, active }) {
    return `
        <button
            class="staffing-weekly-chip${tone ? ` staffing-weekly-chip--${tone}` : " staffing-weekly-chip--plain"}"
            type="button"
            data-weekly-chip-group="${escapeHTML(group)}"
            data-weekly-chip="${escapeHTML(token)}"
            aria-pressed="${active ? "true" : "false"}"
        >
            ${tone ? `<i></i>` : ""}${escapeHTML(label)}${
                Number.isFinite(count)
                    ? `<span class="staffing-weekly-chip__count">${count}</span>`
                    : ""
            }
        </button>
    `;
}

function weeklyChipsRowHTML(label, chips) {
    if (!chips.length) return "";

    return `
        <span class="staffing-weekly-filter-label">${escapeHTML(label)}</span>
        <span class="staffing-weekly-chips">${chips.join("")}</span>
    `;
}

async function weeklyHolidayMap(days) {
    const years = [...new Set(
        days.map(day => day.getFullYear())
    )];
    const holidays = await Promise.all(
        years.map(year => fetchHolidays(year))
    );

    return Object.assign({}, ...holidays);
}

function weeklyIsInhabil(day, holidays) {
    return !isBusinessDay(day, holidays);
}

function staffingEstamentoOrder(profile) {
    const estamento = normalizeStaffingEstamento(profile?.estamento);
    const index = STAFFING_ESTAMENTOS.indexOf(estamento);

    return index === -1 ? STAFFING_ESTAMENTOS.length : index;
}

// Etiqueta corta del estamento para la linea de mezcla de la celda. El
// nombre completo no cabe: en una columna de 146px, "Profesional 3 ·
// Tecnico 3 · Administrativo 1" se parte en tres lineas.
const WEEKLY_ESTAMENTO_SHORT = {
    "Profesional": "Prof",
    "Técnico": "Téc",
    "Administrativo": "Adm",
    "Auxiliar": "Aux"
};

/**
 * Resumen de la celda: cuanta gente hay, como se reparte y que le falta.
 *
 * El hueco -"replacement-slot"- ya lo calculaba weeklyShiftProfiles: es una
 * ausencia sin reemplazo aplicado. Lo unico nuevo es contarlos y decirlo con
 * palabras, en vez de dejar que el supervisor cuente tarjetas.
 */
/**
 * De que grupo del 4to turno es esta celda: el que comparte la gente que
 * trabaja en ella. Se saca de los propios trabajadores y no del ciclo, para
 * que no haya dos formas distintas de contestar lo mismo.
 */
function weeklyCellGroup(people) {
    const counts = new Map();

    people.forEach(item => {
        if (!item.group) return;

        counts.set(item.group, (counts.get(item.group) || 0) + 1);
    });

    let best = "";
    let most = 0;

    counts.forEach((count, group) => {
        if (count > most) {
            most = count;
            best = group;
        }
    });

    return best;
}

function weeklyCellSummary(people, rotaMissing = 0) {
    const working = people.filter(item => item.type !== "replacement-slot");
    const gaps = people.filter(item => item.type === "replacement-slot");
    const covering = working.filter(item => item.covers?.length);
    const counts = new Map();

    working.forEach(item => {
        const estamento =
            normalizeStaffingEstamento(item.profile?.estamento);
        const label = WEEKLY_ESTAMENTO_SHORT[estamento] || "s/e";

        counts.set(label, (counts.get(label) || 0) + 1);
    });

    // En el orden del catalogo, y los sin estamento al final.
    const order = [
        ...STAFFING_ESTAMENTOS.map(estamento =>
            WEEKLY_ESTAMENTO_SHORT[estamento]
        ),
        "s/e"
    ];
    const mix = order
        .filter(label => counts.has(label))
        .map(label => `${counts.get(label)} ${label}`)
        .join(" · ");

    // Lo que falta hoy manda sobre la rotativa corta: una licencia es aguda y
    // se acaba, una rotativa incompleta es cronica y vuelve cada ciclo.
    const status = gaps.length
        ? {
            key: "gap",
            label: gaps.length === 1 ? "falta 1" : `faltan ${gaps.length}`
        }
        : rotaMissing
            ? { key: "rota", label: `rotativa −${rotaMissing}` }
            : covering.length
                ? { key: "cover", label: "cubierto" }
                : working.length
                    ? { key: "ok", label: "completo" }
                    : { key: "empty", label: "" };

    return { total: working.length, mix, status };
}

function weeklyShiftProfiles(
    date,
    shiftKey,
    absenceCache,
    roleFilter,
    professionFilter
) {
    const shiftKeyDay = key(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );
    // Se arma UNA vez por celda. Preguntarlo por persona obligaria a recorrer
    // la lista de reemplazos decenas de veces para el mismo dia.
    const coveredByWorker = getReplacementsByWorkerForDay(shiftKeyDay);
    // Con la fecha de HOY y no la de la celda: el grupo es del trabajador, no
    // del dia, y pedirlo por dia daria siete calculos completos por semana.
    const groupByWorker = getShiftGroupMap(currentDate);

    return getProfiles()
        .filter(isProfileActive)
        .filter(profile =>
            weeklyProfileMatchesFilters(
                profile,
                roleFilter,
                professionFilter
            )
        )
        .flatMap(profile => {
            const segments = profileWeeklyShiftSegments(
                profile,
                date,
                shiftKey,
                absenceCache
            );
            const replacementSlot =
                profileWeeklyPendingReplacementSlot(
                    profile,
                    date,
                    shiftKey,
                    absenceCache
                );
            const items = [];

            if (segments?.length) {
                items.push({
                    type: "profile",
                    profile,
                    segments,
                    covers: coveredByWorker.get(profile.name) || [],
                    group: groupByWorker.get(profile.name) || ""
                });
            }

            if (replacementSlot) {
                items.push(replacementSlot);
            }

            return items;
        })
        .sort((a, b) =>
            staffingEstamentoOrder(a.profile) -
                staffingEstamentoOrder(b.profile) ||
            a.profile.name.localeCompare(b.profile.name, "es") ||
            (a.type === "replacement-slot" ? 1 : -1)
        );
}

function weeklySegmentSummary(segments) {
    if (!segments?.length) return "";
    if (segments.includes(STAFFING_SEGMENT.NIGHT)) return "";

    const hasMorning =
        segments.includes(STAFFING_SEGMENT.DAY_MORNING);
    const hasAfternoon =
        segments.includes(STAFFING_SEGMENT.DAY_AFTERNOON);

    if (hasMorning && hasAfternoon) return "";
    if (hasMorning) return "AM";
    if (hasAfternoon) return "PM";

    return "";
}

function weeklyClassModifier(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/**
 * En que va la cobertura automatica de ese hueco.
 *
 * La campaña ya corre por etapas en el servidor, pero hasta ahora solo se veia
 * en Inicio, que es justo donde el supervisor no esta cuando planifica la
 * semana. Aca va en corto -los puntos y el tiempo que queda- con el detalle
 * completo en el titulo, porque la columna es angosta.
 */
function weeklyCampaignHTML(profileName, keyDay) {
    const campaign = getActiveCampaignForShift(profileName, keyDay);

    if (!campaign) return "";

    const done = campaign.steps
        .filter(step => step.ranAt || step.skipped).length;
    const current = [...campaign.steps].reverse().find(step => step.ranAt);
    const startAt = Date.parse(campaign.shiftStartAt);
    const left = Number.isFinite(startAt)
        ? formatCoverageTimeLeft(startAt - Date.now())
        : "";
    const dots = campaign.steps.map((step, index) => `
        <i class="${index < done ? "is-done" : ""}"></i>
    `).join("");

    return `
        <span class="staffing-weekly-slot__stage" title="${escapeHTML(campaignStatusLabel(campaign))}">
            <span class="staffing-weekly-slot__dots">${dots}</span>
            ${escapeHTML(current ? stageLabel(current) : "en curso")}${
                left ? ` · quedan ${escapeHTML(left)}` : ""
            }
        </span>
    `;
}

function renderWeeklyProfileChip(item) {
    if (item.type === "replacement-slot") {
        const label = item.absence?.label
            ? `Reemplazo pendiente por ${item.absence.label}`
            : "Reemplazo pendiente";

        return `
            <button class="staffing-weekly-replacement-slot" type="button" data-weekly-replacement-profile="${escapeHTML(item.profile.name)}" data-weekly-replacement-key="${escapeHTML(item.keyDay)}" title="${escapeHTML(label)}: ${escapeHTML(item.profile.name)}" aria-label="${escapeHTML(label)}: ${escapeHTML(item.profile.name)}">
                <span class="staffing-weekly-replacement-slot__badge" aria-hidden="true">!</span>
                <span class="staffing-weekly-slot__body">
                    <strong>Falta 1</strong>
                    <small>${escapeHTML(item.profile.name)}${
                        item.absence?.label ? ` · ${escapeHTML(item.absence.label)}` : ""
                    }</small>
                    ${weeklyCampaignHTML(item.profile.name, item.keyDay)}
                </span>
            </button>
        `;
    }

    const partial = weeklySegmentSummary(item.segments);
    const needsReplacement = item.needsReplacement;
    // Una letra basta para saber que grupo entra, y es lo que hace entendible
    // el cupo de rotativa: se ve que el grupo corto es el que esta en pantalla.
    const group = item.group
        ? `<span class="staffing-weekly-group" title="Grupo ${escapeHTML(item.group)} del 4° turno">${escapeHTML(item.group)}</span>`
        : "";
    const covers = item.covers?.length
        ? `<span class="staffing-weekly-covers" title="Cubre a ${
            escapeHTML(item.covers.join(", "))}">cubre</span>`
        : "";

    return `
        <span class="staffing-weekly-person${needsReplacement ? " staffing-weekly-person--needs-replacement" : ""}">
            ${group}
            <span class="staffing-weekly-person__body">
                <strong>${escapeHTML(item.profile.name)}</strong>
                <small>${escapeHTML(weeklyProfileMeta(item.profile))}${partial ? ` | ${escapeHTML(partial)}` : ""}</small>
            </span>
            ${covers}
            ${needsReplacement ? `
                <button class="staffing-weekly-replacement-alert" type="button" data-weekly-replacement-profile="${escapeHTML(item.profile.name)}" data-weekly-replacement-key="${escapeHTML(item.keyDay)}" title="Buscar reemplazo">
                    !
                </button>
            ` : ""}
        </span>
    `;
}

// El plural va a mano: "profesionals" y "auxiliars" no existen.
const WEEKLY_ESTAMENTO_PLURAL = {
    "Profesional": "profesionales",
    "Técnico": "técnicos",
    "Administrativo": "administrativos",
    "Auxiliar": "auxiliares"
};

function weeklyEstamentoPlural(estamento) {
    return WEEKLY_ESTAMENTO_PLURAL[estamento] ||
        `${String(estamento).toLowerCase()}s`;
}

function weeklyRotaMotive(estamento, group) {
    return `Completar rotativa de ${weeklyEstamentoPlural(estamento)} del grupo ${group}`;
}

/**
 * Cupo por rotativa incompleta: el grupo esta constituido con un trabajador
 * menos que el mejor dotado, asi que le falta uno CADA VEZ que entra.
 *
 * Va en ambar y no en rojo a proposito. Una licencia de hoy es aguda y se
 * acaba; una rotativa corta es cronica. Si las dos gritaran igual, la semana
 * se veria peor de lo que esta y el rojo dejaria de significar "esto hay que
 * resolverlo ahora".
 */
/**
 * Lo que le falta a ESTE turno para igualar al grupo mejor dotado.
 *
 * Se cuenta lo ASIGNADO al turno -quien trabaja mas quien falta con su hueco-
 * y no solo a los presentes: si no, un ausente contaria dos veces, una como
 * hueco de su ausencia y otra como carencia de rotativa.
 *
 * Contarlo aca y no en el padron del grupo es lo que hace que la casilla
 * DESAPAREZCA al cubrirla: el padron no cambia porque alguien tome un turno
 * extra, pero el turno si queda completo.
 */
// Codigos de turno de un registro de reemplazo que caen en cada turno del
// grupo (24 y 18 ocupan los dos).
const ROTA_SHIFT_CODES = {
    larga: new Set(["L", "24", "HM", "HT", "18"]),
    noche: new Set(["N", "24", "D+N", "18"])
};

/**
 * Quienes estan en ese turno SOLO por un turno extra con motivo de horas
 * extras ("Apoyo Clinico TC", "Calidad"...): vienen a otra tarea, asi que no
 * completan el grupo y el cupo de la Brecha sigue abierto. Quien vino a cubrir
 * el cupo (motivo "Completar rotativa de ...") si cuenta.
 */
function hheeMotiveWorkers(keyDay, shiftKey) {
    const codes = ROTA_SHIFT_CODES[shiftKey];
    const workers = new Set();

    if (!keyDay || !codes) return workers;

    const [year, month, day] = String(keyDay).split("-").map(Number);
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    getReplacements().forEach(record => {
        const reason = String(record?.reason || "").trim();

        if (
            record?.date === iso &&
            record.worker &&
            !record.replaced &&
            reason &&
            !/^Completar rotativa de /i.test(reason) &&
            codes.has(String(record.turno || "")) &&
            replacementActive(record)
        ) {
            workers.add(record.worker);
        }
    });

    return workers;
}

// El turno para medir la Brecha: sin quienes vinieron solo por un motivo de
// HHEE (ver hheeMotiveWorkers).
function rotaRoster(people, date, shiftKey) {
    const hheeOnly = hheeMotiveWorkers(
        key(date.getFullYear(), date.getMonth(), date.getDate()),
        shiftKey
    );

    return hheeOnly.size
        ? people.filter(item => !hheeOnly.has(item.profile?.name))
        : people;
}

// `date`: el dia de la casilla. Los grupos se comparan como eran ESE dia (ver
// getShiftGroupGaps), no como son hoy.
function weeklyRotaGapsForCell(group, people, date = currentDate) {
    if (!group) return [];

    return (getShiftGroupGaps(date).get(group) || [])
        .map(gap => {
            // La profesion viaja EN el cupo: en Profesional y Tecnico viene
            // cargada y hay que cruzarla tambien, porque tres enfermeras no
            // tapan la falta de un kinesiologo. En los estamentos que no se
            // abren llega vacia y se compara como siempre.
            const assigned = people.filter(item =>
                normalizeStaffingEstamento(item.profile?.estamento) ===
                    gap.estamento &&
                (
                    !gap.profession ||
                    String(item.profile?.profession || "").trim() ===
                        gap.profession
                )
            ).length;

            return {
                ...gap,
                count: assigned,
                missing: Math.max(0, gap.reference - assigned)
            };
        })
        .filter(gap => gap.missing > 0);
}

/**
 * Los turnos que entran cortos en los proximos dias, para el inicio.
 *
 * Solo Larga y Noche: el diurno no pertenece a ningun grupo del 4to turno.
 */
// El barrido de la brecha recorre `days` x 2 turnos x TODOS los perfiles, con
// sus ausencias. Medido el 2026-09-22 en la unidad de ~68 trabajadores, con la
// ventana de 30 dias de Inicio: ~10 s de hilo BLOQUEADO por barrido, y como
// Inicio se repinta con cada cambio de estado, siete pintados seguidos sumaban
// setenta segundos. Chrome llegaba a ofrecer cerrar la pagina.
//
// Se guarda por ventana y por dia de hoy, y se vacia junto al analisis del mes:
// lo que invalida a uno invalida al otro.
const ROTA_GAP_CACHE = new Map();

function rotaGapCacheKey(days, today) {
    return [
        days,
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
    ].join("|");
}

function rotaGapDate(today, offset) {
    return new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + offset
    );
}

/** Lo ya calculado, o null. Para pintar sin bloquear ni esperar. */
export function getCachedRotaGapShifts({
    days = 7,
    today = currentDate
} = {}) {
    return ROTA_GAP_CACHE.get(rotaGapCacheKey(days, today)) || null;
}

/**
 * Calcula el barrido CEDIENDO EL HILO entre dia y dia, y lo guarda.
 *
 * Devuelve null si los datos cambiaron mientras calculaba: el resultado a
 * medias mezclaria dos fotos, y quien pinte detras lo reintenta.
 */
export async function ensureRotaGapShifts({
    days = 7,
    today = currentDate
} = {}) {
    const cacheKey = rotaGapCacheKey(days, today);
    const cached = ROTA_GAP_CACHE.get(cacheKey);

    if (cached) return cached;

    const version = analizarMesCacheVersion;
    const absenceCache = new Map();
    const rows = [];
    const result = await runCooperativeRange(
        0,
        days - 1,
        offset => {
            rows.push(
                ...rotaGapRowsForDate(rotaGapDate(today, offset), absenceCache)
            );
        },
        { shouldContinue: () => version === analizarMesCacheVersion }
    );

    if (!result.completed) return null;

    ROTA_GAP_CACHE.set(cacheKey, rows);

    return rows;
}

export function getRotaGapShifts({
    days = 7,
    today = currentDate,
    absenceCache = new Map()
} = {}) {
    const rows = [];

    for (let offset = 0; offset < days; offset += 1) {
        rows.push(
            ...rotaGapRowsForDate(rotaGapDate(today, offset), absenceCache)
        );
    }

    return rows;
}

// Un dia del barrido. Vive aparte para que la version que cede el hilo y la
// de una tirada compartan EXACTAMENTE el mismo calculo.
function rotaGapRowsForDate(date, absenceCache) {
    const rows = [];

    {
        WEEKLY_SHIFTS
            .filter(shift => shift.key !== "diurno")
            .forEach(shift => {
                const people = weeklyShiftProfiles(
                    date,
                    shift.key,
                    absenceCache,
                    "Todos",
                    "Todas"
                );
                const group = weeklyCellGroup(people);

                weeklyRotaGapsForCell(
                    group,
                    rotaRoster(people, date, shift.key),
                    date
                ).forEach(gap => {
                    rows.push({
                        date,
                        keyDay: key(
                            date.getFullYear(),
                            date.getMonth(),
                            date.getDate()
                        ),
                        iso: localDateISO(date),
                        shiftKey: shift.key,
                        turnoLabel: shift.label,
                        turno: shift.key === "noche" ? TURNO.NOCHE : TURNO.LARGA,
                        group,
                        estamento: gap.estamento,
                        profession: gap.profession || "",
                        // Lo que se lee: la profesion donde el estamento se
                        // abre, y el estamento donde no.
                        label: gap.label || gap.estamento,
                        missing: gap.missing,
                        count: gap.count,
                        reference: gap.reference,
                        motive: weeklyRotaMotive(
                            gap.label || gap.estamento,
                            group
                        ),
                        reference_profile: weeklyRotaReference(
                            people,
                            group,
                            gap.estamento,
                            gap.profession
                        )
                    });
                });
            });
    }

    return rows;
}

function weeklyRotaReference(people, group, estamento, profession = "") {
    // Alguien del grupo que SI esta trabajando ese turno: sirve de molde para
    // los candidatos -"otro como Angelica"- y, por estar presente, no arrastra
    // capacitaciones ni medias jornadas que le cambiarian las horas al calculo.
    const working = people.filter(item =>
        item.type !== "replacement-slot" && item.group === group
    );
    const buscada = profession
        ? normalizeProfession(profession, estamento)
        : "";

    // Con profesion en el cupo, el molde TIENE que ser de esa profesion, y no
    // hay respaldo por estamento a proposito.
    //
    // Era el defecto: el filtro de candidatos del modal compara contra este
    // molde, asi que caer al estamento ofrecia enfermeras para un cupo de TM
    // Imagenologia. Y pasaba SIEMPRE, no en un caso raro: si el grupo tuviera
    // a alguien de esa profesion trabajando ese turno, no habria cupo.
    if (buscada) {
        const presente = working.find(item =>
            normalizeStaffingEstamento(item.profile?.estamento) === estamento &&
            normalizeProfession(item.profile?.profession, estamento) === buscada
        );

        if (presente) return presente.profile.name;

        const cualquiera = getProfiles()
            .filter(isProfileActive)
            .find(profile =>
                normalizeStaffingEstamento(profile.estamento) === estamento &&
                normalizeProfession(profile.profession, estamento) === buscada
            );

        // Sin nadie de esa profesion en la unidad no se ofrece a nadie: el
        // boton queda deshabilitado con su "no hay a quien parecerse", que es
        // mas honesto que proponer a quien no corresponde.
        return cualquiera?.name || "";
    }

    const sameEstamento = working.find(item =>
        normalizeStaffingEstamento(item.profile?.estamento) === estamento
    );

    if (sameEstamento) return sameEstamento.profile.name;
    if (working.length) return working[0].profile.name;

    // Grupo entero ausente: se cae a cualquier activo del estamento, que es
    // suficiente para saber quien puede cubrir.
    const anyone = getProfiles()
        .filter(isProfileActive)
        .find(profile =>
            normalizeStaffingEstamento(profile.estamento) === estamento
        );

    return anyone?.name || "";
}

function weeklyRotaGapHTML(gap, group, date, shift, people) {
    const keyDay = key(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );
    const turno = shift.key === "noche" ? TURNO.NOCHE : TURNO.LARGA;
    // La etiqueta es la profesion donde el estamento se abre, y el estamento
    // donde no. Los cupos de los arneses de prueba no la traen: por eso el
    // respaldo.
    const etiqueta = gap.label || gap.estamento;
    const motive = weeklyRotaMotive(etiqueta, group);
    const reference = weeklyRotaReference(
        people,
        group,
        gap.estamento,
        gap.profession
    );

    if (!reference) return "";

    return Array.from({ length: gap.missing }, () => `
        <button
            class="staffing-weekly-rota-gap"
            type="button"
            data-weekly-rota-group="${escapeHTML(group)}"
            data-weekly-rota-estamento="${escapeHTML(gap.estamento)}"
            data-weekly-rota-label="${escapeHTML(etiqueta)}"
            data-weekly-rota-reference="${escapeHTML(reference)}"
            data-weekly-rota-key="${escapeHTML(keyDay)}"
            data-weekly-rota-turno="${turno}"
            title="${escapeHTML(motive)}"
        >
            <span class="staffing-weekly-rota-gap__badge" aria-hidden="true">!</span>
            <span class="staffing-weekly-rota-gap__body">
                <strong>Falta 1 ${escapeHTML(etiqueta)}</strong>
                <small>Grupo ${escapeHTML(group)} · ${gap.count} de ${gap.reference} ${escapeHTML(weeklyEstamentoPlural(etiqueta))}</small>
            </span>
        </button>
    `).join("");
}

function renderStaffingWeeklyCell(
    date,
    shift,
    absenceCache,
    roleFilter,
    professionFilter,
    isInhabil,
    isToday = false,
    onlyTrouble = false
) {
    // La dotacion COMPLETA del turno, sin chips. Los filtros esconden gente,
    // no la sacan del turno: contar la carencia sobre la lista filtrada
    // inventaba huecos -al dejar solo Profesional, los tecnicos del turno
    // pasaban a valer cero y el grupo aparecia corto de tres.
    const roster = weeklyShiftProfiles(
        date,
        shift.key,
        absenceCache,
        "Todos",
        "Todas"
    );
    const people = roster.filter(item =>
        weeklyProfileMatchesFilters(
            item.profile,
            roleFilter,
            professionFilter
        )
    );
    // Carencias del grupo que entra hoy, solo en los turnos que trabaja.
    const cellGroup = shift.key === "diurno" ? "" : weeklyCellGroup(roster);
    // Se cuentan sobre el turno entero, pero solo se muestran las del
    // estamento que se esta mirando: con el chip de Profesional puesto, lo
    // que le falte al de tecnicos es ruido de otra columna.
    const rotaGaps = weeklyRotaGapsForCell(
        cellGroup,
        rotaRoster(roster, date, shift.key),
        date
    )
        .filter(gap => weeklyRoleFilterAllows(gap.estamento, roleFilter));
    const rotaMissing = rotaGaps.reduce(
        (total, gap) => total + gap.missing,
        0
    );
    const summary = weeklyCellSummary(people, rotaMissing);
    // Con el filtro puesto queda a la vista solo lo que falta. Mostrar tambien
    // al resto del turno seria el ruido que el filtro viene a sacar: si se
    // prendio para ver los huecos, los compañeros que si estan no aportan.
    const shownPeople = onlyTrouble
        ? people.filter(item => item.type === "replacement-slot")
        : people;

    // Fuera de foco la celda se encoge, no se esconde: con display:none la
    // rejilla correria las columnas y la semana perderia la alineacion.
    if (onlyTrouble && !["gap", "rota"].includes(summary.status.key)) {
        return `
            <article class="staffing-weekly-cell staffing-weekly-cell--${shift.key} staffing-weekly-cell--quiet${isToday ? " staffing-weekly-cell--today" : ""}">
                <span>&mdash;</span>
            </article>
        `;
    }

    return `
        <article class="staffing-weekly-cell staffing-weekly-cell--${shift.key}${isInhabil ? " staffing-weekly-cell--inhabil" : ""}${isToday ? " staffing-weekly-cell--today" : ""}${summary.status.key === "gap" ? " staffing-weekly-cell--gap" : ""}${summary.status.key === "rota" ? " staffing-weekly-cell--rota" : ""}${summary.status.key === "cover" ? " staffing-weekly-cell--covered" : ""}">
            <div class="staffing-weekly-cell__shift">
                <span>${escapeHTML(shift.label)}</span>
                ${
                    shift.key === "noche"
                        ? `
                            <svg class="staffing-weekly-cell__shift-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M21 12.79A9 9 0 1 1 11.21 3A7 7 0 0 0 21 12.79z"></path>
                            </svg>
                        `
                        : `
                            <svg class="staffing-weekly-cell__shift-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <circle cx="12" cy="12" r="4"></circle>
                                <path d="M12 2v2"></path>
                                <path d="M12 20v2"></path>
                                <path d="M4.93 4.93l1.41 1.41"></path>
                                <path d="M17.66 17.66l1.41 1.41"></path>
                                <path d="M2 12h2"></path>
                                <path d="M20 12h2"></path>
                                <path d="M6.34 17.66l-1.41 1.41"></path>
                                <path d="M17.66 6.34l1.41-1.41"></path>
                            </svg>
                        `
                }
                ${
                    summary.total || summary.status.key === "gap"
                        ? `
                            <span class="staffing-weekly-cell__count">
                                <b>${summary.total}</b>
                                <i class="is-${summary.status.key}">${escapeHTML(summary.status.label)}</i>
                            </span>
                        `
                        : ""
                }
            </div>
            ${
                summary.mix
                    ? `<div class="staffing-weekly-cell__mix">${escapeHTML(summary.mix)}</div>`
                    : ""
            }
            <div class="staffing-weekly-people">
                ${rotaGaps.map(gap =>
                    weeklyRotaGapHTML(gap, cellGroup, date, shift, roster)
                ).join("")}
                ${
                    shownPeople.length
                        ? shownPeople.map(renderWeeklyProfileChip).join("")
                        : (rotaGaps.length || onlyTrouble
                            ? ""
                            : `<span class="staffing-weekly-empty">Sin personal disponible</span>`)
                }
            </div>
        </article>
    `;
}

function weeklyLeaveProfiles(
    date,
    row,
    absenceCache,
    roleFilter,
    professionFilter
) {
    const keyDay = key(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );
    return getProfiles()
        .filter(isProfileActive)
        .filter(profile =>
            weeklyProfileMatchesFilters(
                profile,
                roleFilter,
                professionFilter
            )
        )
        .map(profile => {
            if (row.key === "hour_return") {
                return getHourReturn(profile.name, keyDay)
                    ? { profile, keyDay, needsReplacement: false }
                    : null;
            }

            const absence = getProfileStaffingAbsence(
                profile.name,
                keyDay,
                absenceCache
            );

            if (absence?.code !== row.key) return null;

            return {
                profile,
                keyDay,
                needsReplacement:
                    weeklyProfileNeedsReplacement(
                        profile,
                        keyDay,
                        getStaffingTurno(
                            profile,
                            date.getFullYear(),
                            date.getMonth(),
                            date.getDate(),
                            { includeReplacements: false }
                        )
                    )
            };
        })
        .filter(Boolean)
        .sort((a, b) =>
            staffingEstamentoOrder(a.profile) -
                staffingEstamentoOrder(b.profile) ||
            a.profile.name.localeCompare(b.profile.name, "es")
        );
}

function weeklyLeaveRows(
    days,
    absenceCache,
    roleFilter,
    professionFilter,
    options = {}
) {
    const forcedRowKey = options.rowKey || "";
    const sourceRows = forcedRowKey
        ? WEEKLY_LEAVE_ROWS.filter(row => row.key === forcedRowKey)
        : WEEKLY_LEAVE_ROWS;

    return sourceRows
        .map(row => ({
            ...row,
            days: days.map(day => ({
                date: day,
                people: weeklyLeaveProfiles(
                    day,
                    row,
                    absenceCache,
                    roleFilter,
                    professionFilter
                )
            }))
        }))
        .filter(row =>
            forcedRowKey ||
            row.days.some(day => day.people.length)
        );
}

function renderStaffingWeeklyLeaveCell(row, day, isInhabil) {
    const leaveClass = weeklyClassModifier(row.key);

    return `
        <article class="staffing-weekly-cell staffing-weekly-cell--leave${leaveClass ? ` staffing-weekly-cell--leave-${leaveClass}` : ""}${isInhabil ? " staffing-weekly-cell--inhabil" : ""}">
            <div class="staffing-weekly-cell__shift">${escapeHTML(row.label)}</div>
            <div class="staffing-weekly-people">
                ${
                    day.people.length
                        ? day.people.map(renderWeeklyProfileChip).join("")
                        : `<span class="staffing-weekly-empty">Sin registros</span>`
                }
            </div>
        </article>
    `;
}

function bindStaffingWeeklyScrollSync(target) {
    const dayRows = [
        ...target.querySelectorAll(
            ".staffing-weekly-days, .staffing-weekly-mobile-days"
        )
    ];
    const grid = target.querySelector(".staffing-weekly-grid");

    if (!dayRows.length || !grid) {
        return;
    }

    let syncing = false;
    const syncScroll = source => {
        if (syncing) {
            return;
        }

        syncing = true;
        const left = source.scrollLeft;
        [...dayRows, grid].forEach(element => {
            if (element !== source) {
                element.scrollLeft = left;
            }
        });
        window.requestAnimationFrame(() => {
            syncing = false;
        });
    };

    dayRows.forEach(row => {
        row.addEventListener("scroll", () => syncScroll(row), {
            passive: true
        });
    });
    grid.addEventListener("scroll", () => syncScroll(grid), {
        passive: true
    });
}

function bindStaffingWeeklyMobileSticky(target) {
    if (typeof staffingWeeklyStickyCleanup === "function") {
        staffingWeeklyStickyCleanup();
        staffingWeeklyStickyCleanup = null;
    }

    const header = target.querySelector(".staffing-weekly-mobile-days");
    if (!header) return;

    const placeholder = document.createElement("div");
    placeholder.className = "staffing-weekly-mobile-days-placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    header.before(placeholder);

    let frame = 0;

    const reset = () => {
        placeholder.style.height = "0px";
        header.classList.remove("staffing-weekly-mobile-days--fixed");
        header.style.removeProperty("top");
        header.style.removeProperty("left");
        header.style.removeProperty("width");
    };

    const topOffset = () => {
        const topbar = document.querySelector(".topbar");
        if (!topbar || window.innerWidth > 760) return 0;

        const style = window.getComputedStyle(topbar);
        if (style.position !== "sticky" && style.position !== "fixed") {
            return 0;
        }

        const rect = topbar.getBoundingClientRect();
        return rect.top <= 1 && rect.bottom > 0
            ? Math.round(rect.bottom)
            : 0;
    };

    const update = () => {
        frame = 0;

        if (
            !header.isConnected ||
            document.body.dataset.activeView !== "weekly" ||
            window.innerWidth > 760
        ) {
            reset();
            return;
        }

        const stickyTop = topOffset();
        const panelRect = target.getBoundingClientRect();
        const anchorRect = placeholder.getBoundingClientRect();
        const headerHeight = header.offsetHeight || 0;
        const shouldFix =
            anchorRect.top <= stickyTop &&
            panelRect.bottom > stickyTop + headerHeight + 8;

        if (!shouldFix) {
            reset();
            return;
        }

        const viewportWidth =
            document.documentElement.clientWidth || window.innerWidth;
        const left = Math.max(0, Math.round(panelRect.left));
        const width = Math.max(
            0,
            Math.min(Math.round(panelRect.width), viewportWidth - left)
        );

        placeholder.style.height = `${headerHeight}px`;
        header.classList.add("staffing-weekly-mobile-days--fixed");
        header.style.top = `${stickyTop}px`;
        header.style.left = `${left}px`;
        header.style.width = `${width}px`;
    };

    const requestUpdate = () => {
        if (!frame) {
            frame = window.requestAnimationFrame(update);
        }
    };

    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate, { passive: true });
    window.addEventListener("orientationchange", requestUpdate, {
        passive: true
    });

    staffingWeeklyStickyCleanup = () => {
        if (frame) {
            window.cancelAnimationFrame(frame);
            frame = 0;
        }
        window.removeEventListener("scroll", requestUpdate);
        window.removeEventListener("resize", requestUpdate);
        window.removeEventListener("orientationchange", requestUpdate);
        reset();
        placeholder.remove();
    };

    requestUpdate();
}

/**
 * Deja del filtro de profesion solo lo que sigue existiendo con los
 * estamentos marcados. Sin esto, marcar "Tecnico" con una profesion de
 * enfermeria puesta dejaria la pantalla vacia sin decir por que.
 */
function weeklyKeptProfessions(value, availableProfessions) {
    const kept = weeklyTokens(value, "Todas")
        .filter(name => availableProfessions.includes(name));

    return kept.length ? kept.join(",") : "Todas";
}

// La seleccion vive en el contenedor y no en los controles: los chips se
// vuelven a dibujar en cada pintada, y leerla de ellos la perderia.
function staffingWeeklyFilterState(target, overrides = {}) {
    const roleFilter = overrides.roleFilter ||
        target?.dataset?.staffingWeeklyRole ||
        "Todos";
    const currentProfessionFilter = overrides.professionFilter ||
        target?.dataset?.staffingWeeklyProfession ||
        "Todas";
    const availableProfessions =
        weeklyAvailableProfessions(roleFilter);
    const professionFilter = weeklyKeptProfessions(
        currentProfessionFilter,
        availableProfessions
    );
    const typeFilterValue = overrides.typeFilter ||
        target?.dataset?.staffingWeeklyType ||
        "Todos";
    const onlyTrouble = overrides.onlyTrouble !== undefined
        ? Boolean(overrides.onlyTrouble)
        : target?.dataset?.staffingWeeklyTrouble === "1";

    return {
        roleFilter,
        currentProfessionFilter,
        availableProfessions,
        professionFilter,
        typeFilterValue,
        onlyTrouble
    };
}

async function buildStaffingWeeklyCalendarView({
    weekDate = getStaffingWeekDate(),
    roleFilter = "Todos",
    currentProfessionFilter = "Todas",
    typeFilterValue = "Todos",
    onlyTrouble = false
} = {}) {
    const availableProfessions =
        weeklyAvailableProfessions(roleFilter);
    const professionFilter = weeklyKeptProfessions(
        currentProfessionFilter,
        availableProfessions
    );
    const days = staffingWeekDays(weekDate);
    const holidays = await weeklyHolidayMap(days);
    const absenceCache = new Map();
    const allLeaveRows = weeklyLeaveRows(
        days,
        absenceCache,
        roleFilter,
        professionFilter
    );
    const typeFilter = normalizeWeeklyTypeFilter(
        typeFilterValue,
        allLeaveRows
    );
    const typeTokens = weeklyTokens(typeFilter, "Todos");
    const pickedShifts = typeTokens.filter(token =>
        token.startsWith("shift:")
    );
    const pickedLeaves = typeTokens.filter(token =>
        token.startsWith("leave:")
    );
    const allLeavesPicked = typeTokens.includes(WEEKLY_ALL_LEAVES);
    const visibleShifts = WEEKLY_SHIFTS.filter(shift =>
        !typeTokens.length || pickedShifts.includes(`shift:${shift.key}`)
    );
    // Un tipo de ausencia marcado manda sobre el chip general: si alguien
    // pidio ver solo las licencias, no se le devuelven todas.
    const visibleLeaveRows = pickedLeaves.length
        ? allLeaveRows.filter(row =>
            pickedLeaves.includes(`leave:${row.key}`)
        )
        : (!typeTokens.length || allLeavesPicked)
            ? allLeaveRows
            : [];
    const todayKey = key(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        currentDate.getDate()
    );
    const weekRangeLabel =
        `${formatShortDate(days[0])} - ${formatShortDate(days[6])}`;
    const isCurrentWeek =
        staffingWeeklyStartISO(weekDate) ===
        staffingWeeklyStartISO(currentDate);
    const isTodayColumn = day => key(
        day.getFullYear(),
        day.getMonth(),
        day.getDate()
    ) === todayKey;
    const weeklyRowsHTML = `
        ${visibleShifts.map(shift =>
            days.map(day =>
                renderStaffingWeeklyCell(
                    day,
                    shift,
                    absenceCache,
                    roleFilter,
                    professionFilter,
                    weeklyIsInhabil(day, holidays),
                    isTodayColumn(day),
                    onlyTrouble
                )
            ).join("")
        ).join("")}
        ${(onlyTrouble ? [] : visibleLeaveRows).map(row =>
            row.days.map(day =>
                renderStaffingWeeklyLeaveCell(
                    row,
                    day,
                    weeklyIsInhabil(day.date, holidays)
                )
            ).join("")
        ).join("")}
    `;
    const weeklyEmptyHTML = `
        <div class="staffing-weekly-empty-state">
            Sin registros para el filtro seleccionado.
        </div>
    `;
    const dayHeadersHTML = days.map(day => `
        <div class="staffing-weekly-day${weeklyIsInhabil(day, holidays) ? " staffing-weekly-day--inhabil" : ""}${isTodayColumn(day) ? " staffing-weekly-day--today" : ""}">
            <strong>${escapeHTML(formatFullWeekday(day))} ${escapeHTML(formatShortDate(day))}</strong>
            ${isTodayColumn(day) ? `<span class="staffing-weekly-day__today">HOY</span>` : ""}
        </div>
    `).join("");
    const roleTokens = weeklyTokens(roleFilter, "Todos");
    const professionTokens = weeklyTokens(professionFilter, "Todas");
    const activeProfiles = getProfiles().filter(isProfileActive);
    const presentEstamentos = STAFFING_ESTAMENTOS.filter(estamento =>
        activeProfiles.some(profile =>
            normalizeStaffingEstamento(profile.estamento) === estamento
        )
    );
    const hasNoEstamento = activeProfiles.some(profile =>
        !STAFFING_ESTAMENTOS.includes(
            normalizeStaffingEstamento(profile.estamento)
        )
    );
    const shiftChips = WEEKLY_SHIFTS.map(shift => weeklyChipHTML({
        group: "type",
        token: `shift:${shift.key}`,
        label: shift.label,
        tone: shift.key,
        active: typeTokens.includes(`shift:${shift.key}`)
    }));

    if (allLeaveRows.length) {
        shiftChips.push(weeklyChipHTML({
            group: "type",
            token: WEEKLY_ALL_LEAVES,
            label: "Ausencias",
            tone: "leave",
            count: allLeaveRows.length,
            active: allLeavesPicked || Boolean(pickedLeaves.length)
        }));
    }

    // Los tipos de ausencia aparecen solo al pedir verlas: son varios y en la
    // vista de siempre no aportan. Asi no se pierde poder llegar a uno solo.
    const leaveChips = (allLeavesPicked || pickedLeaves.length)
        ? allLeaveRows.map(row => weeklyChipHTML({
            group: "type",
            token: `leave:${row.key}`,
            label: row.label,
            active: pickedLeaves.includes(`leave:${row.key}`)
        }))
        : [];
    const roleChips = [
        ...presentEstamentos.map(estamento => weeklyChipHTML({
            group: "role",
            token: estamento,
            label: estamento,
            active: roleTokens.includes(estamento)
        })),
        ...(hasNoEstamento
            ? [weeklyChipHTML({
                group: "role",
                token: WEEKLY_NO_ESTAMENTO,
                label: "Sin estamento",
                active: roleTokens.includes(WEEKLY_NO_ESTAMENTO)
            })]
            : [])
    ];
    // La profesion afina un estamento: mostrarla antes de elegir uno seria
    // una lista larga de la unidad entera.
    const professionChips = (roleTokens.length === 1 && availableProfessions.length > 1)
        ? availableProfessions.map(profession => weeklyChipHTML({
            group: "profession",
            token: profession,
            label: profession,
            active: professionTokens.includes(profession)
        }))
        : [];
    const html = `
            <div class="staffing-weekly-sticky">
                <div class="staffing-weekly-filters">
                    <div class="staffing-weekly-filter-grid">
                        ${weeklyChipsRowHTML("Turno", shiftChips)}
                        ${weeklyChipsRowHTML("Tipo de ausencia", leaveChips)}
                        ${weeklyChipsRowHTML("Estamento", roleChips)}
                        ${weeklyChipsRowHTML("Profesión", professionChips)}
                    </div>
                    <div class="staffing-weekly-side">
                        <div class="staffing-weekly-weeknav">
                            <button class="staffing-weekly-weeknav__arrow" type="button" data-staffing-week-prev
                                    aria-label="Semana anterior" title="Semana anterior">&lsaquo;</button>
                            <span class="staffing-weekly-weeknav__label">${escapeHTML(weekRangeLabel)}</span>
                            <button class="staffing-weekly-weeknav__arrow" type="button" data-staffing-week-next
                                    aria-label="Semana siguiente" title="Semana siguiente">&rsaquo;</button>
                        </div>
                        <div class="staffing-weekly-actions">
                            <button class="staffing-weekly-button" type="button" data-staffing-week-today
                                    aria-pressed="${isCurrentWeek ? "true" : "false"}">
                                Semana actual
                            </button>
                            <button class="staffing-weekly-button" type="button" data-staffing-only-trouble
                                    aria-pressed="${onlyTrouble ? "true" : "false"}">
                                <span class="staffing-weekly-button__badge" aria-hidden="true">!</span>
                                Solo con problemas
                            </button>
                        </div>
                    </div>
                </div>
                <div class="staffing-weekly-days">
                    ${dayHeadersHTML}
                </div>
            </div>
            <div class="staffing-weekly-mobile-days">
                ${dayHeadersHTML}
            </div>
            <div class="staffing-weekly-grid">
                ${weeklyRowsHTML.trim() || weeklyEmptyHTML}
            </div>
        `;
    const weekStartISO = staffingWeeklyStartISO(weekDate);
    const signature = staffingWeeklyCacheSignature({
        weekStartISO,
        roleFilter,
        professionFilter,
        typeFilter,
        onlyTrouble
    });

    return {
        html,
        signature,
        weekStartISO,
        roleFilter,
        professionFilter,
        typeFilter,
        onlyTrouble
    };
}

function activateStaffingWeeklyCalendar(target, view, options = {}) {
    target.innerHTML = view.html;
    target.dataset.staffingWeeklyWeekStart = view.weekStartISO || "";
    target.dataset.staffingWeeklySignature = view.signature || "";
    target.dataset.staffingWeeklyRole = view.roleFilter || "Todos";
    target.dataset.staffingWeeklyProfession = view.professionFilter || "Todas";
    target.dataset.staffingWeeklyType = view.typeFilter || "Todos";
    target.dataset.staffingWeeklyTrouble = view.onlyTrouble ? "1" : "0";
    target.dataset.staffingWeeklyState = options.state || "ready";
    target.setAttribute("aria-busy", options.busy ? "true" : "false");
    bindStaffingWeeklyScrollSync(target);
    bindStaffingWeeklyMobileSticky(target);

    target
        .querySelector("[data-staffing-week-prev]")
        ?.addEventListener("click", () => changeStaffingWeek(-1));
    target
        .querySelector("[data-staffing-week-next]")
        ?.addEventListener("click", () => changeStaffingWeek(1));
    target
        .querySelector("[data-staffing-week-today]")
        ?.addEventListener("click", () => {
            staffingWeekDate = weekStartMonday(currentDate);
            renderStaffingWeeklyCalendar();
        });
    target
        .querySelector("[data-staffing-only-trouble]")
        ?.addEventListener("click", () => {
            const active =
                target.dataset.staffingWeeklyTrouble === "1";

            renderStaffingWeeklyCalendar({ onlyTrouble: !active });
        });
    target
        .querySelectorAll("[data-weekly-chip]")
        .forEach(chip => {
            chip.addEventListener("click", () => {
                const group = chip.dataset.weeklyChipGroup;
                const token = chip.dataset.weeklyChip;

                if (group === "role") {
                    renderStaffingWeeklyCalendar({
                        roleFilter: weeklyToggleToken(
                            target.dataset.staffingWeeklyRole || "Todos",
                            token,
                            "Todos"
                        )
                    });
                    return;
                }

                if (group === "profession") {
                    renderStaffingWeeklyCalendar({
                        professionFilter: weeklyToggleToken(
                            target.dataset.staffingWeeklyProfession || "Todas",
                            token,
                            "Todas"
                        )
                    });
                    return;
                }

                renderStaffingWeeklyCalendar({
                    typeFilter: weeklyToggleToken(
                        target.dataset.staffingWeeklyType || "Todos",
                        token,
                        "Todos"
                    )
                });
            });
        });
    target
        .querySelectorAll("[data-weekly-rota-group]")
        .forEach(button => {
            button.addEventListener("click", event => {
                event.stopPropagation();

                if (typeof window.openReplacementDialog !== "function") {
                    return;
                }

                const estamento = button.dataset.weeklyRotaEstamento;
                const group = button.dataset.weeklyRotaGroup;
                // La etiqueta que se leyo EN el cupo. Sin esto el motivo que
                // quedaba registrado decia "profesionales" mientras el boton
                // que se apreto mostraba "Enfermeria".
                const etiqueta = button.dataset.weeklyRotaLabel || estamento;

                window.openReplacementDialog(
                    button.dataset.weeklyRotaReference,
                    button.dataset.weeklyRotaKey,
                    {
                        rota: {
                            group,
                            estamento,
                            label: etiqueta,
                            turno: Number(button.dataset.weeklyRotaTurno),
                            motive: weeklyRotaMotive(etiqueta, group)
                        }
                    }
                );
            });
        });
    target
        .querySelectorAll("[data-weekly-replacement-profile]")
        .forEach(button => {
            button.addEventListener("click", event => {
                event.stopPropagation();

                if (typeof window.openReplacementDialog !== "function") {
                    return;
                }

                window.openReplacementDialog(
                    button.dataset.weeklyReplacementProfile,
                    button.dataset.weeklyReplacementKey
                );
            });
        });
}

function staffingWeeklyPendingHTML(weekDate) {
    const days = staffingWeekDays(weekDate);
    const label = `${formatShortDate(days[0])} - ${formatShortDate(days[6])}`;

    return `
        <div class="staffing-weekly-empty-state">
            Actualizando calendario semanal ${escapeHTML(label)}...
        </div>
    `;
}

/**
 * Abre el Calendario Semanal en la semana de esa fecha.
 *
 * El cambio de vista lo hace el menu -se pulsa su boton- en vez de duplicar
 * aca la logica de mostrar y ocultar paneles; al entrar, la vista se pinta
 * sola con la semana que se acaba de fijar. Si el usuario no tiene ese menu,
 * el boton no existe y no pasa nada, que es lo correcto.
 */
export function showStaffingWeekFor(date) {
    staffingWeekDate = weekStartMonday(date);

    document
        .querySelector('.nav-tile[data-target="staffingWeeklyCalendar"]')
        ?.click();
}

export async function renderStaffingWeeklyCalendar(options = {}) {
    const target = document.getElementById("staffingWeeklyCalendar");
    if (!target) return;

    const requestId = ++staffingWeeklyRenderRequest;
    const weekDate = options.weekDate || getStaffingWeekDate();
    const filters = staffingWeeklyFilterState(target, options);
    const weekStartISO = staffingWeeklyStartISO(weekDate);
    const quickSignature = staffingWeeklyCacheSignature({
        weekStartISO,
        roleFilter: filters.roleFilter,
        professionFilter: filters.professionFilter,
        typeFilter: filters.typeFilterValue,
        onlyTrouble: filters.onlyTrouble
    });
    const cached = options.skipCache
        ? null
        : readStaffingWeeklyCache(quickSignature);

    if (cached) {
        activateStaffingWeeklyCalendar(
            target,
            {
                html: cached.html,
                weekStartISO
            },
            {
                state: "cached",
                busy: true
            }
        );
    } else if (
        target.dataset.staffingWeeklySignature &&
        target.dataset.staffingWeeklySignature !== quickSignature
    ) {
        target.dataset.staffingWeeklyWeekStart = weekStartISO;
        target.dataset.staffingWeeklySignature = quickSignature;
        target.dataset.staffingWeeklyState = "pending";
        target.setAttribute("aria-busy", "true");
        target.innerHTML = staffingWeeklyPendingHTML(weekDate);
    }

    const fresh = await buildStaffingWeeklyCalendarView({
        weekDate,
        roleFilter: filters.roleFilter,
        currentProfessionFilter: filters.currentProfessionFilter,
        typeFilterValue: filters.typeFilterValue,
        onlyTrouble: filters.onlyTrouble
    });

    if (requestId !== staffingWeeklyRenderRequest) return;

    writeStaffingWeeklyCache(fresh);
    activateStaffingWeeklyCalendar(target, fresh);
    scheduleStaffingWeeklyPreload({ delay: 900 });
}

function staffingWeeklyPreloadDelay(ms = 0) {
    return new Promise(resolve => {
        window.setTimeout(resolve, ms);
    });
}

async function preloadStaffingWeeklyCache({
    baseDate = currentDate
} = {}) {
    if (!getProfiles().length) return;

    const requestId = ++staffingWeeklyPreloadRequest;
    const baseStart = weekStartMonday(baseDate);

    for (
        let index = 0;
        index < STAFFING_WEEKLY_PRELOAD_OFFSETS.length;
        index++
    ) {
        if (requestId !== staffingWeeklyPreloadRequest) return;

        const offset = STAFFING_WEEKLY_PRELOAD_OFFSETS[index];
        const weekDate = addLocalDays(baseStart, offset * 7);
        const weekStartISO = staffingWeeklyStartISO(weekDate);
        const signature = staffingWeeklyCacheSignature({
            weekStartISO,
            roleFilter: "Todos",
            professionFilter: "Todas",
            typeFilter: "Todos"
        });

        if (!readStaffingWeeklyCache(signature)) {
            const view = await buildStaffingWeeklyCalendarView({
                weekDate,
                roleFilter: "Todos",
                currentProfessionFilter: "Todas",
                typeFilterValue: "Todos"
            });

            if (requestId !== staffingWeeklyPreloadRequest) return;

            writeStaffingWeeklyCache(view);
        }

        await staffingWeeklyPreloadDelay(index < 1 ? 0 : 120);
    }
}

export function scheduleStaffingWeeklyPreload(options = {}) {
    if (typeof window === "undefined") return;

    const delay = Number.isFinite(Number(options.delay))
        ? Number(options.delay)
        : 800;
    const sourceDate = options.baseDate instanceof Date
        ? options.baseDate
        : currentDate;
    const baseDate = new Date(
        sourceDate.getFullYear(),
        sourceDate.getMonth(),
        sourceDate.getDate()
    );

    clearTimeout(staffingWeeklyPreloadTimer);
    staffingWeeklyPreloadTimer = window.setTimeout(() => {
        staffingWeeklyPreloadTimer = 0;
        void preloadStaffingWeeklyCache({ baseDate });
    }, Math.max(0, delay));
}

// Cache de analizarMes: el calculo de dotacion (dias x requerimientos x
// perfiles) es pesado. Se memoiza por mes + firma de feriados y se invalida
// ante cualquier cambio de datos local o aplicacion de estado remoto.
const ANALIZAR_MES_CACHE = new Map();
let analizarMesCacheVersion = 0;

function holidaysSignature(holidays) {
    return Object.keys(holidays || {}).sort().join(",");
}

function clearAnalizarMesCache(event = null) {
    const keys = event?.detail?.keys || [];

    // La bitacora entraba por aqui y vaciaba el analisis del mes entero,
    // subiendo la version -lo que ademas ABORTA un analizarMesCooperative en
    // curso, el del publicador RRHH de 2do plano.
    if (onlyViewIrrelevantStateKeys(keys)) {
        return false;
    }

    ANALIZAR_MES_CACHE.clear();
    ROTA_GAP_CACHE.clear();
    analizarMesCacheVersion++;
    staffingWeeklyPreloadRequest++;
    clearTimeout(staffingWeeklyPreloadTimer);
    staffingWeeklyPreloadTimer = 0;
    clearStaffingWeeklyCache();
    return true;
}

if (typeof window !== "undefined") {
    // Lo que cambia en la unidad invalida el analisis en memoria y vuelve a
    // calentar el cache del calendario semanal. Antes esto ademas repintaba el
    // recuadro Resumen RRHH del menu Turnos; ese recuadro ya no existe, y el
    // Calendario Semanal se repinta por su propia via (refresh.js ->
    // renderStaffingAnalysis).
    window.addEventListener(
        "proturnos:persistenceChanged",
        event => {
            if (clearAnalizarMesCache(event)) {
                scheduleStaffingWeeklyPreload({ delay: 1400 });
            }
        }
    );
    window.addEventListener("proturnos:firebaseAppState", event => {
        const type = event.detail?.type;

        // `app-state-applied` es solo la hidratacion inicial. Lo que edita otra
        // sesion llega por los otros dos, y sin escucharlos el analisis seguia
        // saliendo del cache: no reflejaba el turno que acababan de cambiar.
        if (
            type !== "app-state-applied" &&
            type !== "app-state-entries-applied" &&
            type !== "app-state-module-applied"
        ) return;

        // El apply remoto escribe en silencio, asi que este es el unico aviso:
        // se reusa el mismo filtro de claves que en `persistenceChanged`.
        if (!clearAnalizarMesCache(event)) return;

        scheduleStaffingWeeklyPreload({ delay: 1200 });
    });
}

/**
 * "Turnos sin cubrir" de un dia: los turnos de trabajadores ausentes que siguen
 * sin cubrir, con la MISMA regla del "+XX" del inicio y del Calendario Mensual
 * (isShiftUncovered). Antes se media contra una dotacion minima que el
 * supervisor escribia a mano en Ajustes (Dotacion RRHH); ya no existe: las
 * ausencias, la Brecha y los cupos los detecta la app sola.
 *
 * Conserva la forma de siempre ({ dia, detalle: [{ tipo, cantidad, ... }] }) que
 * leen las estadisticas (dashboard.js) y el publicador del Dashboard RRHH:
 * `faltante` es el tramo de dia (Larga) y `noche` el de noche.
 */
function analizarDiaStaffing(profiles, year, month, d) {
    const keyDay = key(year, month, d);
    const detalle = [];

    profiles.forEach(profile => {
        if (!isShiftUncovered(profile.name, keyDay)) return;

        const turno = Number(getTurnoBase(profile.name, keyDay)) || TURNO.LIBRE;
        const push = (tipo, shiftLabel, cantidad) => detalle.push({
            tipo,
            estamento: normalizeStaffingEstamento(profile.estamento),
            profile: profile.name,
            shiftLabel,
            cantidad
        });

        if (
            turno === TURNO.TURNO24 ||
            turno === TURNO.DIURNO_NOCHE ||
            turno === TURNO.TURNO18
        ) {
            push("faltante", "Larga", 1);
            push("noche", "Noche", 1);
            return;
        }

        if (turno === TURNO.NOCHE) {
            push("noche", "Noche", 1);
            return;
        }

        if (turno === TURNO.MEDIA_MANANA || turno === TURNO.MEDIA_TARDE) {
            push("faltante", "Medio turno", 0.5);
            return;
        }

        push("faltante", turno === TURNO.DIURNO ? "Diurno" : "Larga", 1);
    });

    return { dia: d, detalle };
}

function staffingAnalysisProfiles() {
    return getProfiles().filter(isProfileActive);
}

export function analizarMes(year, month, holidays = {}){
    return measurePerformance(
        "staffing:analizar-mes",
        () => {
            const cacheKey = `${year}|${month}|${holidaysSignature(holidays)}`;
            const cachedResult = ANALIZAR_MES_CACHE.get(cacheKey);

            if (cachedResult) return cachedResult;

            const profiles = staffingAnalysisProfiles();
            const diasMes = new Date(year, month + 1, 0).getDate();
            const salida = [];

            for (let d = 1; d <= diasMes; d++) {
                salida.push(analizarDiaStaffing(profiles, year, month, d));
            }

            ANALIZAR_MES_CACHE.set(cacheKey, salida);

            return salida;
        },
        {
            year,
            month,
            profileCount: getProfiles().filter(isProfileActive).length
        }
    );
}

// La usa tambien el publicador RRHH de 2do plano: una tarea de fondo no
// puede bloquear el hilo, y la version de arriba recorre los 30 dias de una.
export async function analizarMesCooperative(
    year,
    month,
    holidays = {},
    shouldContinue = () => true
) {
    return measurePerformance(
        "staffing:analizar-mes-cooperative",
        async () => {
            const cacheKey = `${year}|${month}|${holidaysSignature(holidays)}`;
            const cachedResult = ANALIZAR_MES_CACHE.get(cacheKey);

            if (cachedResult) return cachedResult;

            const cacheVersion = analizarMesCacheVersion;
            const profiles = staffingAnalysisProfiles();
            const diasMes = new Date(year, month + 1, 0).getDate();
            const salida = [];
            const isCurrent = () =>
                cacheVersion === analizarMesCacheVersion && shouldContinue();

            const result = await runCooperativeRange(
                1,
                diasMes,
                d => {
                    salida.push(analizarDiaStaffing(profiles, year, month, d));
                },
                { shouldContinue: isCurrent }
            );

            if (!result.completed) return null;

            ANALIZAR_MES_CACHE.set(cacheKey, salida);
            return salida;
        },
        {
            year,
            month,
            profileCount: getProfiles().filter(isProfileActive).length
        },
        {
            asyncThreshold: 120
        }
    );
}

window.scheduleStaffingWeeklyPreload =
    scheduleStaffingWeeklyPreload;
window.renderStaffingMedicalChart = renderStaffingMedicalChart;
