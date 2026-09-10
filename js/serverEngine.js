// Entry del motor de proyección para correr en el servidor (Cloud Function).
// esbuild lo bundlea a functions/engine/engine.mjs (ESM/Node) y se ejecuta con
// un shim de localStorage/window/document sembrado desde el estado del workspace.
//
// Importa SOLO módulos de cómputo (sin firebase-client). Las funciones de
// ensamblado se copian 1:1 de js/workerAppDataSync.js para garantizar paridad,
// pero computan TODO inline (sin la maquinaria de diferido/cold-refresh del
// cliente). Cuando el cliente deje de publicar, esta pasa a ser la única copia.

import {
    getTurnoBase,
    getTurnoProgramado,
    aplicarCambiosTurno
} from "./turnEngine.js";
import {
    getShiftAssigned,
    getRotativa,
    getManualLeaveBalances,
    getTurnChangeConfig,
    getProfiles,
    isProfileActive,
    getCompensationProfileAt,
    getGradeHistory
} from "./storage.js";
import { getTurnoExtraAgregado, obtenerLabelDia } from "./rulesEngine.js";
import { heldLeaveKeys } from "./leaveHold.js";
import { turnoLabel } from "./uiEngine.js";
import { getDayColorGradient, buildHexColorResolver } from "./dayColorBands.js";
import { getTurnoColorConfig } from "./turnoColors.js";
import { getCachedHolidays, fetchHolidays, clearHolidaysCache } from "./holidays.js";
import { toISODate, keyFromDate } from "./dateUtils.js";
import { TURNO } from "./constants.js";
import { getJSON } from "./persistence.js";
import { baseRenderDay } from "./rotationBase.js";
import { normalizeText } from "./stringUtils.js";
import { buildSharedHomeTaskReminders } from "./homeSharedTasks.js";
import { withManualBalance } from "./balanceUtils.js";
import { activeMonthlySwapCount, getCambioTurnoCalendario } from "./swaps.js";
import { addTaskAssignmentsToSchedule } from "./taskAssignmentProjection.js";
import {
    buildLinkedWorkerDocuments as buildLinkedWorkerDocumentsCore,
    seedLinkedDocsContext,
    linkedDocChanged,
    withoutVolatileFields
} from "./serverLinkedDocs.js";
import {
    buildWorkerHheeSummaries,
    buildWorkerHheeMonthSummary,
    buildWorkerReportPreviewHTML,
    buildWorkerClockMarkModifications,
    createAttendanceMarksReader
} from "./hoursReport.js";

const OVERTIME_SUMMARY_MONTHS_BACK = 2;
// Tambien se publican los meses siguientes: los turnos extra y reemplazos se
// cargan con anticipacion y deben verse en HH.EE apenas se agregan.
const OVERTIME_SUMMARY_MONTHS_FORWARD = 3;
// v2: los resumenes ahora incluyen extraShifts (detalle de turnos extra por mes).
const OVERTIME_SUMMARY_CACHE_VERSION = 2;
const LEGAL_CONTINUOUS_BLOCK_DAYS = 10;
const WORKER_APP_BASE_VERSION = 1;
const WORKER_APP_CONTRACT_PROFILE_VERSION = 2;
const EXCEPTIONS_MONTHS_BACK = 2;
const EXCEPTIONS_MONTHS_FORWARD = 12;
const HOT_CALENDAR_FUTURE_MONTH_COUNT = 6;

function addDays(date, amount) {
    const next = new Date(date);

    next.setDate(date.getDate() + amount);
    return next;
}

function schedulePublicationWeekStart(date = new Date()) {
    const base = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );
    const day = base.getDay();
    const diff = day === 0 ? -6 : 1 - day;

    base.setDate(base.getDate() + diff);
    return base;
}

function schedulePublicationWeekStartISO(date = new Date()) {
    return toISODate(schedulePublicationWeekStart(date));
}

function schedulePublicationWeekEndISO(date = new Date()) {
    return toISODate(addDays(schedulePublicationWeekStart(date), 6));
}

function schedulePublicationWeekDate(weekStartISO) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(weekStartISO || ""))
        ? new Date(`${weekStartISO}T00:00:00`)
        : null;
}

function normalizePublishedScheduleGridCell(cell) {
    if (cell && typeof cell === "object") {
        const text = String(cell.text || "").slice(0, 600);
        const rowSpan = Math.max(1, Math.min(80, Math.round(Number(cell.rowSpan) || 1)));
        return rowSpan > 1 ? { text, rowSpan } : text;
    }
    return String(cell == null ? "" : cell).slice(0, 600);
}

function normalizePublishedScheduleGridRow(row) {
    if (!row || typeof row !== "object") return null;
    const title = String(row.title || "").trim().slice(0, 200);
    const detail = String(row.detail || "").trim().slice(0, 200);

    if (row.fullWidth) {
        const fullText = String(row.fullText || "").slice(0, 3000);
        if (!title && !fullText) return null;
        return { title, detail, fullWidth: true, fullText };
    }

    const cells = Array.isArray(row.cells)
        ? row.cells.map(normalizePublishedScheduleGridCell).slice(0, 12)
        : [];
    const hasText = cells.some((c) => (typeof c === "string" ? c : c.text));
    if (!title && !hasText) return null;
    return { title, detail, cells };
}

// Grilla estructurada de la programación (Excel -> grid) que viaja al trabajador.
function normalizePublishedScheduleGrid(value) {
    if (!value || typeof value !== "object") return null;
    const days = Array.isArray(value.days)
        ? value.days.map((d) => String(d || "").trim()).slice(0, 12)
        : [];
    const rows = Array.isArray(value.rows)
        ? value.rows.map(normalizePublishedScheduleGridRow).filter(Boolean).slice(0, 80)
        : [];
    if (!rows.length) return null;
    return {
        title: String(value.title || "").trim().slice(0, 240),
        weekLabel: String(value.weekLabel || "").trim().slice(0, 160),
        days,
        rows
    };
}

function normalizePublishedScheduleAttachment(value, fallbackWeekStart = null) {
    if (!value || typeof value !== "object") return null;

    const storagePath = String(value.storagePath || "").trim();
    const dataUrl = String(value.dataUrl || "").trim();
    const downloadURL = String(value.downloadURL || value.downloadUrl || "").trim();
    const ocr = normalizePublishedScheduleOcr(value.ocr);
    const ocrText = ocr?.status === "completed"
        ? String(ocr.text || "").trim()
        : "";
    const weekStart = fallbackWeekStart
        ? schedulePublicationWeekStart(fallbackWeekStart)
        : null;
    const weekStartISO = String(
        value.weekStartISO ||
        (weekStart ? schedulePublicationWeekStartISO(weekStart) : "")
    ).trim();
    const weekEndISO = String(
        value.weekEndISO ||
        (weekStart ? schedulePublicationWeekEndISO(weekStart) : "")
    ).trim();

    const grid = normalizePublishedScheduleGrid(value.grid);

    if (!storagePath && !dataUrl && !downloadURL && !grid) return null;

    return {
        id: String(value.id || "").trim(),
        name: String(value.name || "programacion").trim(),
        type: String(value.type || "").toLowerCase(),
        size: Number(value.size || 0),
        addedAt: String(value.addedAt || "").trim(),
        updatedAtISO: String(value.updatedAtISO || value.addedAt || "").trim(),
        storagePath,
        dataUrl: (storagePath || downloadURL || dataUrl.length > 800 * 1024)
            ? ""
            : dataUrl,
        downloadURL,
        uploadedByUid: String(value.uploadedByUid || "").trim(),
        mode: grid ? "grid" : (ocrText ? "ocr_text" : "image"),
        source: grid ? "supervisor_xlsx" : "supervisor_image",
        weekStartISO,
        weekEndISO,
        weekLabel: String(value.weekLabel || grid?.weekLabel || "").trim(),
        ocr,
        ocrText,
        text: ocrText,
        grid
    };
}

function normalizePublishedScheduleOcrWords(value) {
    if (!Array.isArray(value)) return [];

    const out = [];
    for (const word of value) {
        if (!word || typeof word !== "object") continue;
        const t = String(word.t || "").slice(0, 60);
        if (!t) continue;
        out.push({
            t,
            x: Number(word.x) || 0,
            y: Number(word.y) || 0,
            w: Number(word.w) || 0,
            h: Number(word.h) || 0
        });
        if (out.length >= 1500) break;
    }
    return out;
}

function normalizePublishedScheduleOcr(value) {
    if (!value || typeof value !== "object") return null;

    const status = String(value.status || "").trim();
    const text = String(value.text || "").trim();
    const error = String(value.error || "").trim();
    // La geometría del OCR (words) quedó obsoleta: el grid del Excel reemplaza la
    // reconstrucción por coordenadas, y publicar cientos de números por semana en
    // cada doc excedía el límite de commit de Firestore ("Transaction too big").
    const words = [];
    void normalizePublishedScheduleOcrWords;

    if (!status && !text && !error && !words.length) return null;

    return {
        status: status || (text ? "completed" : "failed"),
        engine: String(value.engine || "").trim(),
        source: String(value.source || "automatic_upload").trim(),
        reviewRequired: value.reviewRequired === true,
        requestedAtISO: String(value.requestedAtISO || "").trim(),
        extractedAtISO: String(value.extractedAtISO || "").trim(),
        // No publicar el texto OCR completo (hasta 30 KB/semana): con el grid del
        // Excel ya no se usa, y acumulado por semana inflaba el commit.
        text: "",
        textLength: 0,
        truncated: value.truncated === true,
        error,
        words
    };
}

function normalizePublishedScheduleAttachmentMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};

    return Object.fromEntries(
        Object.entries(value)
            .map(([weekStartISO, attachment]) => {
                const start = schedulePublicationWeekDate(weekStartISO);
                const normalized = normalizePublishedScheduleAttachment(
                    attachment,
                    start
                );
                const key = normalized?.weekStartISO || weekStartISO;

                return normalized && key ? [key, normalized] : null;
            })
            .filter(Boolean)
            .sort(([a], [b]) => a.localeCompare(b))
    );
}

function getPublishedScheduleAttachments() {
    const attachments = normalizePublishedScheduleAttachmentMap(
        getJSON("weekly_task_schedule_attachments", {})
    );
    const legacy = normalizePublishedScheduleAttachment(
        getJSON("weekly_task_schedule_attachment", null),
        schedulePublicationWeekStart(new Date())
    );

    if (legacy && !attachments[legacy.weekStartISO]) {
        attachments[legacy.weekStartISO] = legacy;
    }

    return attachments;
}

function getPublishedScheduleAttachment(
    start = new Date(),
    attachments = getPublishedScheduleAttachments()
) {
    return attachments[schedulePublicationWeekStartISO(start)] || null;
}

// ───────── Rango y meses ─────────

function hotScheduleRange(today = new Date()) {
    return {
        start: new Date(today.getFullYear(), today.getMonth(), 1),
        end: new Date(
            today.getFullYear(),
            today.getMonth() + HOT_CALENDAR_FUTURE_MONTH_COUNT + 1,
            0
        )
    };
}

function exceptionsScanRange(today = new Date()) {
    return {
        start: new Date(
            today.getFullYear(),
            today.getMonth() - EXCEPTIONS_MONTHS_BACK,
            1
        ),
        end: new Date(
            today.getFullYear(),
            today.getMonth() + EXCEPTIONS_MONTHS_FORWARD + 1,
            0
        )
    };
}

function listMonthsInRange(start, end) {
    const months = [];
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const last = new Date(end.getFullYear(), end.getMonth(), 1);

    while (cursor <= last) {
        months.push({
            year: cursor.getFullYear(),
            monthIndex: cursor.getMonth()
        });
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }

    return months;
}

// ───────── Días del calendario ─────────

function classNameForDay(state, hasLeave) {
    if (hasLeave) return "permiso";

    switch (Number(state) || TURNO.LIBRE) {
        case TURNO.LARGA: return "larga";
        case TURNO.NOCHE: return "noche";
        case TURNO.TURNO24: return "turno24";
        case TURNO.DIURNO: return "diurno";
        case TURNO.DIURNO_NOCHE: return "diurno-noche";
        case TURNO.MEDIA_MANANA:
        case TURNO.MEDIA_TARDE: return "half";
        case TURNO.TURNO18: return "turno18";
        default: return "libre";
    }
}

function omitLeaveKeys(map, keys) {
    const result = {};

    Object.entries(map || {}).forEach(([key, value]) => {
        if (!keys.has(key)) result[key] = value;
    });

    return result;
}

// Un permiso EN ESPERA DE COBERTURA no existe todavia para el trabajador: se
// quita de los mapas antes de calcular nada, y asi el dia, su etiqueta, su
// color, las excepciones y los saldos salen todos como si no se hubiera
// aplicado. Ver js/leaveHold.js.
// Copia identica en workerAppDataSync.js (motor duplicado).
function profileLeaveMaps(profileName) {
    const maps = {
        admin: getJSON("admin_" + profileName, {}),
        legal: getJSON("legal_" + profileName, {}),
        comp: getJSON("comp_" + profileName, {}),
        absences: getJSON("absences_" + profileName, {})
    };
    const held = heldLeaveKeys(profileName);

    if (!held.size) return maps;

    return {
        ...maps,
        admin: omitLeaveKeys(maps.admin, held),
        legal: omitLeaveKeys(maps.legal, held),
        comp: omitLeaveKeys(maps.comp, held)
    };
}

// Tipo de permiso CANCELABLE por el trabajador para un dia (mismos tipos que
// LEAVE_CANCEL_TYPES del supervisor). "" si el permiso no es cancelable (licencia
// medica, injustificada) o no hay permiso. Permite que la PWA ofrezca "Solicitar
// anulacion" sobre cualquier permiso del calendario, aunque lo haya aplicado el
// supervisor directamente (sin solicitud previa del trabajador).
function cancelableLeaveTypeForDay(maps, keyDay) {
    const adminVal = maps.admin[keyDay];
    if (adminVal) {
        if (adminVal === "0.5M") return "half_admin_morning";
        if (adminVal === "0.5T") return "half_admin_afternoon";
        return "admin";
    }
    if (maps.legal[keyDay]) return "legal";
    if (maps.comp[keyDay]) return "comp";
    const absence = maps.absences[keyDay];
    const absType = typeof absence === "string"
        ? absence
        : String(absence?.type || absence?.previousType || "");
    if (absType === "union_leave") return "union_leave";
    if (absType === "unpaid_leave") return "unpaid_leave";
    return "";
}

function computeMonthDays(profile, month, ctx) {
    const { maps, profileData, colorResolver, holidaysByYear } = ctx;
    const { year, monthIndex } = month;
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const result = {};

    if (!holidaysByYear[year]) {
        holidaysByYear[year] = getCachedHolidays(year);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const cursor = new Date(year, monthIndex, day);
        const iso = toISODate(cursor);
        const keyDay = keyFromDate(cursor);
        // Cambio de turno aplicado: CCTT (cambia turno) el dia que entrega su turno
        // original, DDTT (devuelve turno) el dia que lo devuelve. Es el mismo
        // marcador que el calendario del supervisor, para que el trabajador
        // identifique en su PWA los dias de un cambio.
        const swapMarker = getCambioTurnoCalendario(profile.name, keyDay);
        const programmedTurn = getTurnoProgramado(profile.name, keyDay);
        const actualTurn = aplicarCambiosTurno(profile.name, keyDay, programmedTurn);
        const baseTurn = getTurnoBase(profile.name, keyDay);
        const baseWithSwaps = aplicarCambiosTurno(
            profile.name, keyDay, baseTurn, { includeReplacements: false }
        );
        const programmedWithSwaps = aplicarCambiosTurno(
            profile.name,
            keyDay,
            Object.prototype.hasOwnProperty.call(profileData, keyDay)
                ? Number(profileData[keyDay]) || TURNO.LIBRE
                : baseTurn,
            { includeReplacements: false }
        );
        const manualExtra = Boolean(
            getShiftAssigned(profile.name, cursor) &&
            getTurnoExtraAgregado(baseWithSwaps, programmedWithSwaps)
        );
        const visualLabel = obtenerLabelDia(
            keyDay, actualTurn,
            maps.admin, maps.legal, maps.comp, maps.absences,
            turnoLabel
        );
        const hasLeave = Boolean(
            maps.admin[keyDay] || maps.legal[keyDay] ||
            maps.comp[keyDay] || maps.absences[keyDay]
        );
        const label = turnoLabel(actualTurn) || "Libre";
        const colorGradient = getDayColorGradient(
            profile.name, keyDay, actualTurn, cursor,
            holidaysByYear[year], maps.admin[keyDay], baseWithSwaps,
            {
                resolveColor: colorResolver,
                unbasedComponentsAreExtra: manualExtra,
                singleBandGradient: manualExtra
            }
        );

        result[iso] = {
            iso,
            keyDay,
            turno: Number(actualTurn) || TURNO.LIBRE,
            programmedTurn: Number(programmedTurn) || TURNO.LIBRE,
            baseTurn: Number(baseTurn) || TURNO.LIBRE,
            label,
            displayLabel: visualLabel || label,
            className: classNameForDay(actualTurn, hasLeave),
            colorGradient: colorGradient || "",
            isManualExtra: manualExtra,
            hasLeave,
            // Tipo cancelable del permiso del dia (para "Solicitar anulacion" en la
            // PWA). Solo cuando corresponde, para no engordar la proyeccion.
            ...(hasLeave && cancelableLeaveTypeForDay(maps, keyDay)
                ? { leaveCancelType: cancelableLeaveTypeForDay(maps, keyDay) }
                : {}),
            // Marcas del reloj de ese turno, tal como las muestra el reporte:
            // con la salida de una noche ya traida a su dia. El trabajador las
            // ve al abrir el turno en su aplicacion.
            ...(ctx.readMarks
                ? (() => {
                    const marks = ctx.readMarks(
                        keyDay,
                        cursor,
                        holidaysByYear[year]
                    );

                    return marks ? { marks } : {};
                })()
                : {}),
            // Solo se incluye cuando hay cambio, para no engordar la proyeccion.
            // counterpart = el companero del cambio (para el detalle en la PWA).
            ...(swapMarker
                ? {
                    swapMarker: {
                        type: swapMarker.type,
                        label: swapMarker.label,
                        counterpart: swapMarker.perspective?.counterpart || ""
                    }
                }
                : {})
        };
    }

    return result;
}

// Feriados (legales + manuales del workspace) como fechas ISO, para que la PWA
// pueda marcar los dias inhabiles y calcular horas igual que el supervisor. La
// cache los guarda con clave "YYYY-M-D" y el mes 0-indexado.
function collectHolidayDates(years) {
    const isos = new Set();

    for (const year of years) {
        const map = getCachedHolidays(year) || {};

        for (const key of Object.keys(map)) {
            if (!map[key]) continue;

            const [y, m, d] = String(key).split("-").map(Number);

            if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
                continue;
            }

            isos.add(toISODate(new Date(y, m, d)));
        }
    }

    return [...isos].sort();
}

export function computeProfileSchedule(profile, today = new Date()) {
    const { start, end } = hotScheduleRange(today);
    const months = listMonthsInRange(start, end);
    const maps = profileLeaveMaps(profile.name);
    const profileData = getJSON("data_" + profile.name, {});
    const colorResolver = buildHexColorResolver(getTurnoColorConfig());
    const ctx = {
        maps,
        profileData,
        colorResolver,
        holidaysByYear: {},
        // Lo caro se calcula una vez por trabajador, no por dia.
        readMarks: createAttendanceMarksReader(profile)
    };

    const computedDays = {};
    months.forEach(month => {
        Object.assign(computedDays, computeMonthDays(profile, month, ctx));
    });

    return addTaskAssignmentsToSchedule(profile, {
        start: toISODate(start),
        end: toISODate(end),
        days: computedDays,
        partial: true
    });
}

// ───────── Excepciones ─────────

function dayDiffersFromBase(actual, base) {
    return (
        (Number(actual.turno) || TURNO.LIBRE) !== (Number(base.turno) || TURNO.LIBRE) ||
        String(actual.displayLabel || "") !== String(base.displayLabel || "") ||
        String(actual.className || "") !== String(base.className || "") ||
        Boolean(actual.hasLeave) !== Boolean(base.hasLeave) ||
        Boolean(actual.isManualExtra) !== Boolean(base.isManualExtra) ||
        // Un dia con marcador CCTT/DDTT debe publicarse como excepcion aunque el
        // turno coincida con la base (p.ej. cambio entre turnos del mismo tipo).
        String(actual.swapMarker?.label || "") !== String(base.swapMarker?.label || "")
    );
}

function computeProfileExceptions(profile, today = new Date()) {
    const rotativa = getRotativa(profile.name);
    const { start, end } = exceptionsScanRange(today);
    const months = listMonthsInRange(start, end);
    const maps = profileLeaveMaps(profile.name);
    const profileData = getJSON("data_" + profile.name, {});
    const colorResolver = buildHexColorResolver(getTurnoColorConfig());
    const ctx = { maps, profileData, colorResolver, holidaysByYear: {} };

    const exceptions = {};

    months.forEach(month => {
        const days = computeMonthDays(profile, month, ctx);

        Object.entries(days).forEach(([iso, day]) => {
            if (dayDiffersFromBase(day, baseRenderDay(rotativa, iso))) {
                exceptions[iso] = day;
            }
        });
    });

    return {
        exceptions,
        exceptionsStart: toISODate(start),
        exceptionsEnd: toISODate(end)
    };
}

// ───────── Resumen HHEE ─────────

async function computeOvertimeSummaries(profile, schedule) {
    try {
        const baseSummaries = await buildWorkerHheeSummaries(
            profile, OVERTIME_SUMMARY_MONTHS_BACK, OVERTIME_SUMMARY_MONTHS_FORWARD
        );
        const includedMonths = new Set(
            baseSummaries.map(item =>
                `${item.year}-${String(item.month + 1).padStart(2, "0")}`
            )
        );
        const manualExtraMonths = Array.from(new Set(
            Object.values(schedule?.days || {})
                .filter(day => day?.isManualExtra)
                .map(day => String(day.iso || "").slice(0, 7))
                .filter(monthKey =>
                    /^\d{4}-\d{2}$/.test(monthKey) && !includedMonths.has(monthKey)
                )
        ));
        const manualExtraSummaries = await Promise.all(
            manualExtraMonths.map(monthKey => {
                const [year, month] = monthKey.split("-").map(Number);
                return buildWorkerHheeMonthSummary(profile, new Date(year, month - 1, 1));
            })
        );

        return [...baseSummaries, ...manualExtraSummaries]
            .filter(Boolean)
            .sort((a, b) =>
                Number(a.year) - Number(b.year) || Number(a.month) - Number(b.month)
            );
    } catch (error) {
        console.warn("No se pudo calcular el resumen HHEE (servidor).", error);
        return [];
    }
}

// ───────── Reportes imprimibles (mes actual + anterior) ─────────

async function buildWorkerReports(profile, today = new Date()) {
    const reports = {};
    const months = [
        new Date(today.getFullYear(), today.getMonth(), 1),
        new Date(today.getFullYear(), today.getMonth() - 1, 1)
    ];

    for (const date of months) {
        const year = date.getFullYear();
        const month = date.getMonth();

        try {
            const html = await buildWorkerReportPreviewHTML(profile, new Date(year, month, 1));
            if (html) reports[`${year}-${month}`] = html;
        } catch (error) {
            console.warn("No se pudo construir el reporte (servidor).", error);
        }
    }

    return reports;
}

// ───────── Saldos de permisos por año ─────────

function isBusinessDayForLegal(date, holidays) {
    const day = date.getDay();
    return day !== 0 && day !== 6 && !holidays[keyFromDate(date)];
}

function dateFromCalendarKey(key) {
    const [year, month, day] = String(key || "").split("-").map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
}

function usedBusinessDays(map, year, holidays) {
    return Object.keys(map || {}).reduce((total, key) => {
        if (!key.startsWith(`${year}-`)) return total;
        const date = dateFromCalendarKey(key);
        return date && isBusinessDayForLegal(date, holidays) ? total + 1 : total;
    }, 0);
}

function usedAdministrativeDays(map, year) {
    return Object.entries(map || {}).reduce((total, [key, value]) => {
        if (!key.startsWith(`${year}-`)) return total;
        return total + (value === 1 ? 1 : 0.5);
    }, 0);
}

function hasContinuousLegalBlock(profileName, year, holidays) {
    const legal = profileLeaveMaps(profileName).legal;
    const cursor = new Date(year, 0, 1);
    let currentRun = 0;

    while (cursor.getFullYear() === year) {
        const key = keyFromDate(cursor);
        if (isBusinessDayForLegal(cursor, holidays)) {
            currentRun = legal[key] ? currentRun + 1 : 0;
            if (currentRun >= LEGAL_CONTINUOUS_BLOCK_DAYS) return true;
        }
        cursor.setDate(cursor.getDate() + 1);
    }

    return false;
}

async function balancesForYear(profileName, year) {
    const maps = profileLeaveMaps(profileName);
    const holidays = await fetchHolidays(year);
    const manual = getManualLeaveBalances(year, profileName);
    const calculated = {
        legal: Math.max(0, 15 - usedBusinessDays(maps.legal, year, holidays)),
        admin: Math.max(0, 6 - usedAdministrativeDays(maps.admin, year)),
        comp: Math.max(0, 10 - usedBusinessDays(maps.comp, year, holidays))
    };
    const legalContinuousBlockTaken = hasContinuousLegalBlock(profileName, year, holidays);

    return {
        year,
        balances: {
            legal: Math.max(0, Math.floor(withManualBalance(manual.legal, calculated.legal))),
            admin: withManualBalance(manual.admin, calculated.admin),
            comp: withManualBalance(manual.comp, calculated.comp),
            hoursReturn: withManualBalance(manual.hoursReturn, 0)
        },
        legalReserveDays: LEGAL_CONTINUOUS_BLOCK_DAYS,
        legalContinuousBlockTaken,
        legalReserveRequired: !legalContinuousBlockTaken
    };
}

async function leaveBalancesByScheduleYear(profileName, schedule, today = new Date()) {
    const startYear = Number(String(schedule.start || "").slice(0, 4));
    const endYear = Number(String(schedule.end || "").slice(0, 4));
    const currentYear = today.getFullYear();
    const firstYear = Number.isFinite(startYear) ? Math.min(startYear, currentYear) : currentYear;
    const lastYear = Number.isFinite(endYear) ? Math.max(endYear, currentYear) : currentYear;
    const years = [];

    for (let year = firstYear; year <= lastYear; year++) years.push(year);

    const payloads = await Promise.all(years.map(year => balancesForYear(profileName, year)));

    return Object.fromEntries(payloads.map(payload => [String(payload.year), payload]));
}

// ───────── Recordatorios del supervisor ─────────

const STAFFING_REMINDERS_KEY = "staffing_custom_reminders";
const STAFFING_REMINDER_ESTAMENTO_PREFIX = "estamento:";
const STAFFING_RECURRENCE_TO_WORKER = {
    once: "Una sola vez",
    yearly: "Anual",
    monthly: "Mensual"
};

function staffingReminderTargetsProfile(reminder, profileRole) {
    const visibility = String(reminder?.visibility || "");
    if (visibility === "workers") return true;

    if (visibility.startsWith(STAFFING_REMINDER_ESTAMENTO_PREFIX)) {
        const target = normalizeText(visibility.slice(STAFFING_REMINDER_ESTAMENTO_PREFIX.length));
        return Boolean(target) && normalizeText(profileRole) === target;
    }

    return false;
}

// Al calendario del trabajador llegan DOS cosas por este canal: los
// recordatorios del resumen RRHH y las tareas diarias del inicio que el
// supervisor comparta con los trabajadores (js/homeSharedTasks.js).
function buildSupervisorReminders(profile, today = new Date()) {
    const reminders = getJSON(STAFFING_REMINDERS_KEY, []);
    const role = profile?.estamento || "";
    const fromReminders = Array.isArray(reminders)
        ? reminders
            .filter(reminder => reminder?.dateISO && reminder?.description)
            .filter(reminder => staffingReminderTargetsProfile(reminder, role))
            .map(reminder => ({
                id: String(reminder.id || ""),
                date: String(reminder.dateISO || ""),
                title: String(reminder.description || "").trim(),
                description: "Recordatorio enviado por el supervisor.",
                periodicity:
                    STAFFING_RECURRENCE_TO_WORKER[reminder.recurrence] || "Una sola vez",
                source: "Supervisor"
            }))
        : [];

    return [
        ...fromReminders,
        ...buildSharedHomeTaskReminders(profile, today)
    ];
}

// ───────── Cumpleaños de compañeros ─────────

// Los mismos cumpleaños que ve el supervisor en el resumen de RRHH, para el
// calendario del trabajador. Se recurren cada año (periodicidad Anual en la
// PWA). Se usa un año de referencia fijo para NO exponer la edad.
const BIRTHDAY_REFERENCE_YEAR = 2000;

function birthdayMonthDay(value) {
    const source = String(value || "").trim();
    let match = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return { month: Number(match[2]), day: Number(match[3]) };

    match = source.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (match) return { month: Number(match[2]), day: Number(match[1]) };

    return null;
}

function birthdayFirstName(name) {
    return String(name || "").trim().split(/\s+/)[0] || "Compañero";
}

function buildBirthdayReminders(currentProfileName = "") {
    const selfKey = normalizeText(currentProfileName);

    // Se incluye el propio cumpleaños (antes se excluia): el trabajador tambien
    // debe verlo en su calendario. Se marca con self para que la PWA lo muestre
    // como "Tu cumpleaños".
    return getProfiles()
        .filter(isProfileActive)
        .map(profile => {
            const parts = birthdayMonthDay(profile.birthDate);

            if (
                !parts ||
                parts.month < 1 || parts.month > 12 ||
                parts.day < 1 || parts.day > 31
            ) {
                return null;
            }

            const date = [
                BIRTHDAY_REFERENCE_YEAR,
                String(parts.month).padStart(2, "0"),
                String(parts.day).padStart(2, "0")
            ].join("-");

            return {
                id: `bday_${normalizeText(profile.name)}_${parts.month}_${parts.day}`,
                date,
                // Primer nombre para el titulo/calendario; nombre completo para la
                // descripcion ("Cumpleaños de ...") en la PWA.
                name: birthdayFirstName(profile.name),
                fullName: String(profile.name || "").trim(),
                self: normalizeText(profile.name) === selfKey
            };
        })
        .filter(Boolean);
}

function buildSwapLimit(profileName, today = new Date()) {
    const config = getTurnChangeConfig();
    const limit = Number(config.monthlySwapLimit) || 0;
    const used = activeMonthlySwapCount(profileName, today.getFullYear(), today.getMonth());

    return {
        enabled: config.limitMonthlySwaps === true && limit > 0,
        limit,
        used,
        year: today.getFullYear(),
        month: today.getMonth()
    };
}

// ───────── Ensamblado del payload completo ─────────

function profileText(...values) {
    for (const value of values) {
        const text = String(value ?? "").trim();
        if (text) return text;
    }

    return "";
}

function profileContractTypeValue(profile = {}) {
    return profileText(
        profile.effectiveContractType,
        profile.contractType,
        profile.scheduledContractType,
        profile.tipoContrato,
        profile.contract,
        profile.contrato,
        profile.calidad,
        profile.calidadJuridica,
        profile.legalQuality,
        profile.employmentType
    );
}

function profileGradeValue(profile = {}) {
    return profileText(
        profile.effectiveGrade,
        profile.grade,
        profile.grado,
        profile.contractGrade,
        profile.workerGrade
    );
}

function profileEstamentoValue(profile = {}) {
    return profileText(
        profile.estamento,
        profile.role,
        profile.staffGroup,
        profile.staffType,
        profile.category,
        profile.categoria
    );
}

function contractTimelinePayload({ start, contractType, estamento, grade }) {
    return {
        start,
        contractType,
        effectiveContractType: contractType,
        tipoContrato: contractType,
        estamento,
        role: estamento,
        grade,
        grado: grade,
        contractGrade: grade,
        effectiveGrade: grade
    };
}

function buildContractTimeline(profile = {}) {
    const profileName = profile?.name || "";
    const baseline = contractTimelinePayload({
        start: "1900-01-01",
        contractType: profileContractTypeValue(profile),
        estamento: profileEstamentoValue(profile),
        grade: profileGradeValue(profile)
    });
    const byStart = new Map([[baseline.start, baseline]]);

    getGradeHistory(profileName).forEach(entry => {
        byStart.set(entry.start, contractTimelinePayload({
            start: entry.start,
            contractType: profileContractTypeValue(entry),
            estamento: profileEstamentoValue(entry),
            grade: profileGradeValue(entry)
        }));
    });

    return [...byStart.values()]
        .filter(entry =>
            entry.start &&
            (
                entry.contractType ||
                entry.estamento ||
                entry.grade
            )
        )
        .sort((a, b) => a.start.localeCompare(b.start));
}

function buildMissingProfilePayload(link = {}, workspace = {}, profileName = "") {
    const weeklyScheduleAttachments = getPublishedScheduleAttachments();

    return {
        uid: link.uid || "",
        workspaceId: workspace.id || "",
        workspaceName: workspace.name || link.workspaceName || "",
        profileName: link.profileName || profileName || "",
        profileRut: link.profileRut || "",
        status: "profile_not_found",
        worker: {
            name: link.profileName || profileName || "Trabajador",
            email: link.workerEmail || "",
            rut: link.profileRut || "",
            role: "",
            profession: "",
            unit: workspace.name || link.workspaceName || "",
            unitEntryDate: "",
            active: false
        },
        scheduleStart: "",
        scheduleEnd: "",
        days: {},
        weeklyScheduleAttachment: getPublishedScheduleAttachment(
            new Date(),
            weeklyScheduleAttachments
        ),
        weeklyScheduleAttachments,
        updatedAtISO: new Date().toISOString()
    };
}

// Computa la proyección COMPLETA de un trabajador (inline, sin diferido).
// Devuelve el mismo shape que el cliente producía (buildWorkerAppPayload),
// pero con overtime/reports/exceptions ya calculados (status "fresh").
function normalizeProjectionRut(value) {
    return String(value || "").replace(/[^0-9kK]/g, "").toUpperCase();
}

function resolveProjectionProfile(profileName, link = {}) {
    const profiles = getProfiles();
    const linkRut = normalizeProjectionRut(link.profileRut);

    if (linkRut) {
        const rutMatch = profiles.find(profile =>
            normalizeProjectionRut(profile.rut) === linkRut
        );

        if (rutMatch) return rutMatch;
    }

    const normalizedName = normalizeText(profileName);

    if (normalizedName) {
        const nameMatch = profiles.find(profile =>
            normalizeText(profile.name) === normalizedName
        );

        if (nameMatch) return nameMatch;
    }

    const linkName = normalizeText(link.profileName);

    if (linkName && linkName !== normalizedName) {
        return profiles.find(profile =>
            normalizeText(profile.name) === linkName
        ) || null;
    }

    return null;
}

export async function buildFullProjection(
    profileName,
    { link = {}, workspace = {} } = {},
    today = new Date()
) {
    const profile = resolveProjectionProfile(profileName, link);

    if (!profile) {
        return buildMissingProfilePayload(link, workspace, profileName);
    }

    // getCachedHolidays (usado en computeMonthDays) lee la cache de módulo, que es
    // síncrona: hay que calentarla con fetchHolidays antes de computar los días.
    const baseYear = today.getFullYear();
    await Promise.all(
        [baseYear - 1, baseYear, baseYear + 1, baseYear + 2]
            .map(year => fetchHolidays(year))
    );

    const schedule = computeProfileSchedule(profile, today);
    const leaveBalancesByYear = await leaveBalancesByScheduleYear(profile.name, schedule, today);
    const leaveBalances = leaveBalancesByYear[String(today.getFullYear())];
    const overtimeSummaries = await computeOvertimeSummaries(profile, schedule);
    const clockMarkModifications = await buildWorkerClockMarkModifications(profile);
    const reportsByMonth = await buildWorkerReports(profile, today);
    const { exceptions, exceptionsStart, exceptionsEnd } =
        computeProfileExceptions(profile, today);
    const effectiveProfile =
        getCompensationProfileAt(profile.name, today) ||
        profile;
    const effectiveContractType =
        profileContractTypeValue(effectiveProfile) ||
        profileContractTypeValue(profile);
    const scheduledContractType = profileContractTypeValue(profile);
    const effectiveGrade =
        profileGradeValue(effectiveProfile) ||
        profileGradeValue(profile);
    const effectiveEstamento =
        profileEstamentoValue(effectiveProfile) ||
        profileEstamentoValue(profile);
    const profession = profileText(
        profile.profession,
        profile.profesion,
        profile.jobTitle,
        profile.cargo
    );
    const contractTimeline =
        buildContractTimeline(profile);
    const weeklyScheduleAttachments = getPublishedScheduleAttachments();

    return {
        uid: link.uid || "",
        workspaceId: workspace.id || "",
        workspaceName: workspace.name || link.workspaceName || "",
        profileName: profile.name || link.profileName || "",
        profileRut: profile.rut || link.profileRut || "",
        status: isProfileActive(profile) ? "active" : "inactive",
        contractType: effectiveContractType,
        effectiveContractType,
        scheduledContractType,
        tipoContrato: effectiveContractType,
        contrato: effectiveContractType,
        currentContractType: effectiveContractType,
        grade: effectiveGrade,
        grado: effectiveGrade,
        contractGrade: effectiveGrade,
        effectiveGrade,
        estamento: effectiveEstamento,
        profession,
        contractTimeline,
        worker: {
            name: profile.name || link.profileName || "",
            email: profile.email || link.workerEmail || "",
            phone: profile.phone || "",
            rut: profile.rut || "",
            role: effectiveEstamento,
            estamento: effectiveEstamento,
            profession,
            grade: effectiveGrade,
            grado: effectiveGrade,
            contractGrade: effectiveGrade,
            effectiveGrade,
            contractType: effectiveContractType,
            effectiveContractType,
            scheduledContractType,
            tipoContrato: effectiveContractType,
            contrato: effectiveContractType,
            currentContractType: effectiveContractType,
            contractTimeline,
            unit: workspace.name || link.workspaceName || "",
            unitEntryDate: "",
            active: isProfileActive(profile)
        },
        rotativa: getRotativa(profile.name),
        shiftAssigned: Boolean(getShiftAssigned(profile.name)),
        holidays: collectHolidayDates([
            baseYear - 1, baseYear, baseYear + 1, baseYear + 2
        ]),
        baseVersion: WORKER_APP_BASE_VERSION,
        contractProfileVersion: WORKER_APP_CONTRACT_PROFILE_VERSION,
        exceptionsJson: JSON.stringify(exceptions),
        exceptionsCount: Object.keys(exceptions).length,
        exceptionsStart,
        exceptionsEnd,
        exceptionsStatus: "fresh",
        leaveBalances,
        leaveBalancesByYear,
        scheduleStart: schedule.start,
        scheduleEnd: schedule.end,
        days: schedule.days,
        weeklyScheduleAttachment: getPublishedScheduleAttachment(
            today,
            weeklyScheduleAttachments
        ),
        weeklyScheduleAttachments,
        supervisorReminders: buildSupervisorReminders(profile, today),
        birthdays: buildBirthdayReminders(profile.name),
        overtimeSummaries,
        overtimeSummariesCacheVersion: OVERTIME_SUMMARY_CACHE_VERSION,
        overtimeSummariesStatus: "fresh",
        overtimeSummariesSource: "computed",
        // Modificaciones de marcaje del supervisor (recuperacion / horas extra /
        // reduccion) por dia, para el badge del calendario y la seccion "Marcajes".
        clockMarkModifications,
        reportsByMonth,
        reportsByMonthStatus: "fresh",
        swapLimit: buildSwapLimit(profile.name, today),
        updatedAtISO: new Date().toISOString()
    };
}

// Los dos documentos livianos de cada enlazado (directorio de mensajes y
// candidato de cambio de turno). Viven en su propio módulo, sin conocer el
// motor; aquí se les inyecta el cálculo de agenda para que la banda de días que
// viaja a la PWA sea EXACTAMENTE la misma que la de la proyección.
export function buildLinkedWorkerDocuments(workspace, links, nowISO) {
    return buildLinkedWorkerDocumentsCore(
        workspace,
        links,
        profile => computeProfileSchedule(profile),
        nowISO
    );
}

export { seedLinkedDocsContext, linkedDocChanged, withoutVolatileFields };

// Re-exportado para que el harness pueda resetear la cache de feriados de módulo
// entre invocaciones (evita arrastrar feriados manuales de otro workspace).
export { clearHolidaysCache };

export {
    computeMonthDays,
    computeProfileExceptions,
    computeOvertimeSummaries,
    buildWorkerReports,
    leaveBalancesByScheduleYear,
    hotScheduleRange,
    exceptionsScanRange
};
