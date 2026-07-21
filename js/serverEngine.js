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
    isProfileActive
} from "./storage.js";
import { getTurnoExtraAgregado, obtenerLabelDia } from "./rulesEngine.js";
import { turnoLabel } from "./uiEngine.js";
import { getDayColorGradient, buildHexColorResolver } from "./dayColorBands.js";
import { getTurnoColorConfig } from "./turnoColors.js";
import { getCachedHolidays, fetchHolidays, clearHolidaysCache } from "./holidays.js";
import { toISODate, keyFromDate } from "./dateUtils.js";
import { TURNO } from "./constants.js";
import { getJSON } from "./persistence.js";
import { baseRenderDay } from "./rotationBase.js";
import { normalizeText } from "./stringUtils.js";
import { withManualBalance } from "./balanceUtils.js";
import { activeMonthlySwapCount } from "./swaps.js";
import { addTaskAssignmentsToSchedule } from "./taskAssignmentProjection.js";
import {
    buildWorkerHheeSummaries,
    buildWorkerHheeMonthSummary,
    buildWorkerReportPreviewHTML
} from "./hoursReport.js";

const OVERTIME_SUMMARY_MONTHS_BACK = 2;
// v2: los resumenes ahora incluyen extraShifts (detalle de turnos extra por mes).
const OVERTIME_SUMMARY_CACHE_VERSION = 2;
const LEGAL_CONTINUOUS_BLOCK_DAYS = 10;
const WORKER_APP_BASE_VERSION = 1;
const EXCEPTIONS_MONTHS_BACK = 2;
const EXCEPTIONS_MONTHS_FORWARD = 12;
const HOT_CALENDAR_FUTURE_MONTH_COUNT = 6;

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

function profileLeaveMaps(profileName) {
    return {
        admin: getJSON("admin_" + profileName, {}),
        legal: getJSON("legal_" + profileName, {}),
        comp: getJSON("comp_" + profileName, {}),
        absences: getJSON("absences_" + profileName, {})
    };
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
            hasLeave
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
    const ctx = { maps, profileData, colorResolver, holidaysByYear: {} };

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
        Boolean(actual.isManualExtra) !== Boolean(base.isManualExtra)
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
            profile, OVERTIME_SUMMARY_MONTHS_BACK
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
    const legal = getJSON("legal_" + profileName, {});
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

function buildSupervisorReminders(profile) {
    const reminders = getJSON(STAFFING_REMINDERS_KEY, []);
    if (!Array.isArray(reminders)) return [];

    const role = profile?.estamento || "";

    return reminders
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
        }));
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

function buildMissingProfilePayload(link = {}, workspace = {}, profileName = "") {
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
        updatedAtISO: new Date().toISOString()
    };
}

// Computa la proyección COMPLETA de un trabajador (inline, sin diferido).
// Devuelve el mismo shape que el cliente producía (buildWorkerAppPayload),
// pero con overtime/reports/exceptions ya calculados (status "fresh").
export async function buildFullProjection(
    profileName,
    { link = {}, workspace = {} } = {},
    today = new Date()
) {
    const profile = getProfiles().find(item => item.name === profileName);

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
    const reportsByMonth = await buildWorkerReports(profile, today);
    const { exceptions, exceptionsStart, exceptionsEnd } =
        computeProfileExceptions(profile, today);

    return {
        uid: link.uid || "",
        workspaceId: workspace.id || "",
        workspaceName: workspace.name || link.workspaceName || "",
        profileName: profile.name || link.profileName || "",
        profileRut: profile.rut || link.profileRut || "",
        status: isProfileActive(profile) ? "active" : "inactive",
        worker: {
            name: profile.name || link.profileName || "",
            email: profile.email || link.workerEmail || "",
            phone: profile.phone || "",
            rut: profile.rut || "",
            role: profile.estamento || "",
            profession: profile.profession || "",
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
        supervisorReminders: buildSupervisorReminders(profile),
        overtimeSummaries,
        overtimeSummariesCacheVersion: OVERTIME_SUMMARY_CACHE_VERSION,
        overtimeSummariesStatus: "fresh",
        overtimeSummariesSource: "computed",
        reportsByMonth,
        reportsByMonthStatus: "fresh",
        swapLimit: buildSwapLimit(profile.name, today),
        updatedAtISO: new Date().toISOString()
    };
}

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
