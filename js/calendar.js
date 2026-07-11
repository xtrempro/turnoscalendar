import { escapeHTML } from "./htmlUtils.js";
import { showConfirm } from "./dialogs.js";
import {
    aplicarCambiosTurno,
    fusionarTurnos,
    getTurnoBase,
    getTurnoProgramado,
    siguienteTurnoValido
} from "./turnEngine.js";
import {
    calculateWorkerMonthTotals,
    calculateCarryOver
} from "./hoursEngine.js";
import {
    getProfileData,
    getBlockedDays,
    getCarry,
    saveProfileDayTurn,
    saveCarry,
    getAdminDays,
    getLegalDays,
    getAbsences,
    getCompDays,
    getShiftAssigned,
    getCurrentProfile,
    getProfiles,
    getRotativa,
    getReplacementRequestConfig,
    getTurnChangeConfig,
    getWorkerRequests,
    getReplacements,
    getSwaps,
    isProfileActive,
    profileCanCoverProfile,
    saveReplacements
} from "./storage.js";
import {
    tieneAusencia,
    requiereReemplazoTurnoBase,
    getTurnoExtraAgregado,
    esAusenciaInjustificada,
    getAbsenceType,
    obtenerLabelDia,
    aplicarClasesEspeciales,
    estaBloqueadoModo,
    getTurnoComponentes,
    restarTurnoCubierto,
    turnoDesdeComponentes,
    turnoExtraCubreTurno
} from "./rulesEngine.js";
import { fetchHolidays } from "./holidays.js";
import {
    isBusinessDay,
    isWeekend
} from "./calculations.js";
import {
    turnoLabel,
    aplicarClaseTurno
} from "./uiEngine.js";
import { getDayColorGradient } from "./dayColorBands.js";
import {
    cancelTimelineRender,
    renderTimeline,
    showTimelinePendingMonth,
    updateTimelineCells
} from "./timeline.js";
import {
    cededSwapTurnBlocks,
    cambioEstaAnulado,
    deshacerCambioTurno,
    getCambioTurnoCalendario,
    getCambiosTurnoCalendario,
    getSwapPerspective,
    swapCodeLabel
} from "./swaps.js";
import {
    getShiftMoveMarkers,
    getShiftMoves
} from "./shiftMoves.js";
import {
    getAbsenceLabelForProfileDate,
    getBackedTurnForWorker,
    getClockExtraBackupForWorker,
    buildReplacementRequestWhatsAppUrl,
    cancelReplacementRequest,
    createReplacementRequest,
    createReplacementRequests,
    expireReplacementRequests,
    getCoveringWorkersForShift,
    getPendingReplacementRequestsForShift,
    getReplacementForCoveredShift,
    getReplacementForWorkerShift,
    replacementActive,
    saveReplacement,
    turnoToCode,
    turnoReplacementLabel,
    workerHasAbsence
} from "./replacements.js";
import {
    hasContractForDate,
    isReplacementProfile
} from "./contracts.js";
import {
    getHonorariaExcessForKey,
    getHonorariaLimitMessage,
    getHonorariaMonthlySummary
} from "./honoraria.js";
import {
    addAuditLog,
    AUDIT_CATEGORY,
    getLeaveApplicationInfo,
    undoAuditLogEntry
} from "./auditLog.js";
import {
    getClockMarks,
    getClockExtraHours,
    hasClockExtra,
    hasSevereClockIncident,
    hasSimpleClockIncident
} from "./clockMarks.js";
import {
    getHourReturns,
    hourReturnCalendarLabel
} from "./hourReturns.js";
import { withBusyState } from "./busy.js";
import { rotationPositionLabel } from "./rotationUtils.js";
import {
    TURNO,
    TURNO_CLASS
} from "./constants.js";
import {
    getJSON,
    getRaw,
    listKeys,
    removeKey,
    setRaw
} from "./persistence.js";
import {
    getAppState,
    getWorkerCalendarState,
    resolveWorkerId,
    syncWorkersState,
    syncWorkerCalendarState,
    updateWorkerCalendarMaps
} from "./appState.js";
import {
    calendarKeyInMonth,
    clearCalendarCellRefs,
    diffCalendarRecordKeys,
    getCalendarCell,
    keysForCalendarRange,
    registerCalendarCell,
    replaceCalendarCell
} from "./calendarUpdates.js";
import { getActiveWorkspace } from "./workspaces.js";
import { createInterUnitLoan } from "./firebaseInterUnitLoans.js";
import {
    findCompatibleReplacementInLinkedUnits
} from "./linkedReplacementService.js";
import {
    getBlockedDayForProfile,
    getWorkerBlockedDays
} from "./workerAvailability.js";
import {
    acceptWorkerRequestById,
    rejectWorkerRequestById
} from "./workerRequests.js";
import { runCooperativeRange } from "./mainThreadScheduler.js";
import { searchReplacementsInWorker } from "./workerService.js";
import {
    measurePerformance,
    startPerformanceSpan
} from "./performanceMonitor.js";

export let currentDate = new Date();

const CALENDAR_AUDIT_DELAY_MS = 60000;
const CALENDAR_DIRECT_EDIT_REFRESH_DELAY_MS = 30000;
const CALENDAR_HEAVY_UPDATE_DELAY_MS = 450;
const CALENDAR_CACHE_VERSION = 1;
const CALENDAR_CACHE_PREFIX = "proturnos_ui_cache_calendar_";
const CALENDAR_CACHE_MAX_ENTRIES = 72;
const CALENDAR_CACHE_WRITE_DELAY_MS = 700;
const CALENDAR_PARTIAL_BATCH_SIZE = 5;
const CALENDAR_LARGE_PARTIAL_RATIO = 0.7;
const CALENDAR_LARGE_PARTIAL_MIN_DAYS = 21;
const CALENDAR_SUMMARY_USER_QUIET_MS = 15000;
const CALENDAR_SUMMARY_VISIBLE_RETRY_MS = 120000;
const calendarAuditTimers = new Map();
const calendarAuditDrafts = new Map();
let linkedReplacementStatus = "";
let calendarRenderRequest = 0;
let calendarNavigationRequest = 0;
let calendarHeavyUpdateRequest = 0;
let calendarHeavyUpdateTimer = 0;
let calendarDirectEditRefreshTimer = 0;
let calendarDirectEditRefreshRequest = 0;
let calendarDirectEditHistoryTimer = 0;
let calendarDirectEditHistoryOpen = false;
let calendarCacheWriteTimer = 0;
let calendarCacheWriteRequest = 0;
let calendarDashboardRefreshTimer = 0;
let calendarDashboardRefreshUsesIdle = false;
let replacementCandidateRequest = 0;
let calendarPickerYear = currentDate.getFullYear();
let calendarMonthPicker = null;
let delegatedCalendar = null;
let calendarSelectionHandler = null;
let lastCalendarView = null;
let pendingCalendarUpdateTimer = 0;
let pendingWorkerSummaryTimer = 0;
let pendingWorkerSummaryRequest = 0;
let calendarLastUserActivityAt = Date.now();
const pendingCalendarKeys = new Set();
const pendingStaffingKeys = new Set();
const calendarCellHandlers = new WeakMap();
const calendarMapSnapshots = new Map();
const calendarMemoryCache = new Map();

const CALENDAR_MONTH_NAMES = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre"
];

const PENDING_LEAVE_REQUEST_TYPES = new Set([
    "admin",
    "half_admin_morning",
    "half_admin_afternoon",
    "legal",
    "comp",
    "union_leave",
    "unpaid_leave"
]);

function calendarCacheHash(value) {
    let hash = 2166136261;
    const text = String(value || "");

    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
}

function calendarWorkspaceId() {
    return String(getActiveWorkspace?.()?.id || "local");
}

function calendarMonthKey(year, month) {
    return `${Number(year)}-${Number(month)}`;
}

function calendarTodaySignature() {
    const today = new Date();

    return key(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
    );
}

function calendarVisualSignature() {
    return [
        window.selectionMode || "",
        window.pendingShiftMoveSourceKey || "",
        window.pendingShiftMoveDestinationTurn || 0,
        window.pendingShiftMoveProgrammedTurn || 0,
        window.compCantidad || 0,
        window.legalCantidad || 0,
        window.licenseCantidad || 0,
        window.licenseType || "license",
        typeof window.getProfileDraftSelectionKey === "function"
            ? window.getProfileDraftSelectionKey()
            : "",
        calendarTodaySignature()
    ].join("\u001f");
}

function calendarViewSignature({
    workerId,
    profileName,
    year,
    month,
    activeProfileEnabled
}) {
    return [
        calendarWorkspaceId(),
        workerId || "",
        profileName || "",
        year,
        month,
        activeProfileEnabled ? "active" : "inactive",
        calendarVisualSignature()
    ].join("\u001e");
}

function calendarCacheKey(viewSignature) {
    return (
        CALENDAR_CACHE_PREFIX +
        `${CALENDAR_CACHE_VERSION}_` +
        calendarCacheHash(viewSignature)
    );
}

function parseCalendarCache(raw) {
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function readCalendarCache(cacheKey, {
    viewSignature,
    monthKey,
    workerId
}) {
    const payload = calendarMemoryCache.get(cacheKey) ||
        parseCalendarCache(getRaw(cacheKey, null));

    if (
        !payload ||
        payload.version !== CALENDAR_CACHE_VERSION ||
        payload.viewSignature !== viewSignature ||
        payload.monthKey !== monthKey ||
        payload.workerId !== workerId ||
        typeof payload.html !== "string"
    ) {
        return null;
    }

    calendarMemoryCache.set(cacheKey, payload);
    return payload;
}

function pruneCalendarCache() {
    const keys = listKeys(CALENDAR_CACHE_PREFIX);

    if (keys.length <= CALENDAR_CACHE_MAX_ENTRIES) return;

    keys
        .map(cacheKey => ({
            key: cacheKey,
            savedAt:
                Number(
                    calendarMemoryCache.get(cacheKey)?.savedAt ??
                    parseCalendarCache(getRaw(cacheKey, null))?.savedAt
                ) || 0
        }))
        .sort((a, b) => b.savedAt - a.savedAt)
        .slice(CALENDAR_CACHE_MAX_ENTRIES)
        .forEach(entry => {
            calendarMemoryCache.delete(entry.key);
            removeKey(entry.key);
        });
}

function writeCalendarCache(cacheKey, payload) {
    const next = {
        ...payload,
        version: CALENDAR_CACHE_VERSION,
        savedAt: Date.now()
    };

    calendarMemoryCache.set(cacheKey, next);

    try {
        measurePerformance(
            "calendar:write-html-cache",
            () => {
                setRaw(cacheKey, JSON.stringify(next));
                pruneCalendarCache();
            },
            {
                htmlLength: String(payload?.html || "").length,
                profileName: payload?.profileName || "",
                workerId: payload?.workerId || ""
            }
        );
    } catch {
        calendarMemoryCache.delete(cacheKey);
    }
}

function cancelScheduledCalendarCacheWrite() {
    clearTimeout(calendarCacheWriteTimer);
    calendarCacheWriteTimer = 0;
    calendarCacheWriteRequest++;
}

function clearCalendarCache() {
    cancelScheduledCalendarCacheWrite();
    calendarMemoryCache.clear();
    listKeys(CALENDAR_CACHE_PREFIX).forEach(removeKey);
}

function clearCalendarCacheForWorker(workerId) {
    if (!workerId) return;

    cancelScheduledCalendarCacheWrite();
    listKeys(CALENDAR_CACHE_PREFIX).forEach(cacheKey => {
        const payload = calendarMemoryCache.get(cacheKey) ||
            parseCalendarCache(getRaw(cacheKey, null));

        if (payload?.workerId === workerId) {
            calendarMemoryCache.delete(cacheKey);
            removeKey(cacheKey);
        }
    });
}

function registerCalendarCellsFromDOM(calendar) {
    clearCalendarCellRefs();
    calendar?.querySelectorAll(".day[data-date]").forEach(cell => {
        registerCalendarCell(
            cell.dataset.workerId,
            cell.dataset.keyDay,
            cell
        );
    });
}

function writeActiveCalendarCache(calendar = document.getElementById("calendar")) {
    if (!calendar || !lastCalendarView?.cacheKey) return;

    writeCalendarCache(lastCalendarView.cacheKey, {
        viewSignature: lastCalendarView.viewSignature,
        monthKey: lastCalendarView.monthKey,
        workerId: lastCalendarView.workerId,
        profileName: lastCalendarView.profileName,
        year: lastCalendarView.year,
        month: lastCalendarView.month,
        html: calendar.innerHTML,
        hasMultipleBadgeDays:
            calendar.classList.contains("has-multiple-badge-days")
    });
}

function scheduleActiveCalendarCacheWrite(
    calendar = document.getElementById("calendar"),
    {
        delay = CALENDAR_CACHE_WRITE_DELAY_MS
    } = {}
) {
    if (!calendar || !lastCalendarView?.cacheKey) return;

    const snapshot = {
        calendar,
        cacheKey: lastCalendarView.cacheKey,
        viewSignature: lastCalendarView.viewSignature,
        workerId: lastCalendarView.workerId,
        monthKey: lastCalendarView.monthKey
    };
    const requestId = ++calendarCacheWriteRequest;
    const setTimer =
        typeof window !== "undefined" && window.setTimeout
            ? window.setTimeout.bind(window)
            : setTimeout;

    clearTimeout(calendarCacheWriteTimer);
    calendarCacheWriteTimer = setTimer(async () => {
        calendarCacheWriteTimer = 0;

        await waitCalendarIdle(500);

        if (
            requestId !== calendarCacheWriteRequest ||
            !lastCalendarView ||
            lastCalendarView.calendar !== snapshot.calendar ||
            lastCalendarView.cacheKey !== snapshot.cacheKey ||
            lastCalendarView.viewSignature !== snapshot.viewSignature ||
            lastCalendarView.workerId !== snapshot.workerId ||
            lastCalendarView.monthKey !== snapshot.monthKey
        ) {
            return;
        }

        writeActiveCalendarCache(calendar);
    }, Math.max(0, Number(delay) || 0));
}

function activateCalendarCache(calendar, cached, {
    calendarPanel,
    workerId,
    profileName,
    year,
    month,
    days,
    holidays = {},
    cacheKey,
    viewSignature,
    monthKey
}) {
    calendar.innerHTML = cached.html;
    calendar.dataset.calendarState = "cached";
    calendar.setAttribute("aria-busy", "true");
    registerCalendarCellsFromDOM(calendar);
    calendar.classList.toggle(
        "has-multiple-badge-days",
        Boolean(cached.hasMultipleBadgeDays)
    );
    calendarPanel?.classList.toggle(
        "has-multiple-badge-days",
        Boolean(cached.hasMultipleBadgeDays)
    );
    lastCalendarView = {
        calendar,
        workerId,
        profileName,
        year,
        month,
        holidays,
        holidaysLoaded: false,
        days,
        cacheKey,
        viewSignature,
        monthKey
    };
}

function showCalendarBackgroundPending(calendar, {
    workerId,
    profileName,
    year,
    month,
    days,
    cacheKey,
    viewSignature,
    monthKey
}) {
    calendar.replaceChildren();
    calendar.dataset.calendarState = "background-loading";
    calendar.setAttribute("aria-busy", "true");
    clearCalendarCellRefs();
    lastCalendarView = {
        calendar,
        workerId,
        profileName,
        year,
        month,
        holidays: {},
        holidaysLoaded: false,
        days,
        cacheKey,
        viewSignature,
        monthKey
    };
}

function scheduleCalendarBackgroundFreshRender(options = {}) {
    const navigationRequest = Number(options.navigationRequest) || 0;
    const delay = options.cached ? 240 : 80;

    void (async () => {
        await waitCalendarIdle(delay);

        if (
            navigationRequest &&
            navigationRequest !== calendarNavigationRequest
        ) {
            return;
        }

        await renderCalendar({
            ...options,
            backgroundFresh: false,
            skipCache: true
        });
    })();
}

function calendarShiftAssignmentMonth(value = new Date()) {
    if (typeof value === "string") {
        const match = value.trim().match(/^(\d{4})-(\d{2})/);

        if (match) {
            return `${match[1]}-${match[2]}`;
        }
    }

    const date = value instanceof Date
        ? value
        : new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function calendarShiftAssignedResolver(profileName) {
    if (!profileName) return () => false;

    const legacyAssigned =
        Boolean(getJSON(`shift_${profileName}`, false));
    const rawHistory =
        getJSON(`shiftAssignmentHistory_${profileName}`, null);
    const source = rawHistory && typeof rawHistory === "object"
        ? rawHistory
        : {};
    const events = Array.isArray(source.events)
        ? source.events
            .map(event => ({
                month: calendarShiftAssignmentMonth(event?.month),
                assigned: event?.assigned === true
            }))
            .filter(event => event.month)
            .sort((a, b) => a.month.localeCompare(b.month))
        : [];
    const baseline = typeof source.baseline === "boolean"
        ? source.baseline
        : legacyAssigned;

    return date => {
        if (!events.length) return baseline;

        const targetMonth = calendarShiftAssignmentMonth(date);
        let assigned = baseline;

        events.forEach(event => {
            if (!targetMonth || event.month <= targetMonth) {
                assigned = event.assigned;
            }
        });

        return assigned;
    };
}

function buildCalendarReplacementIndex(profileName) {
    const byCoveredDate = new Map();
    const byWorkerDate = new Map();
    const clockExtraBackupByDate = new Map();
    const coveringWorkersByDate = new Map();

    getReplacements()
        .filter(replacementActive)
        .forEach(replacement => {
            const date = String(replacement?.date || "");

            if (!date) return;

            if (
                replacement.replaced === profileName &&
                !byCoveredDate.has(date)
            ) {
                byCoveredDate.set(date, replacement);
            }

            if (
                replacement.replaced === profileName &&
                replacement.worker
            ) {
                const workers = coveringWorkersByDate.get(date) || [];

                if (!workers.includes(replacement.worker)) {
                    workers.push(replacement.worker);
                    coveringWorkersByDate.set(date, workers);
                }
            }

            if (replacement.worker === profileName) {
                if (!byWorkerDate.has(date)) {
                    byWorkerDate.set(date, replacement);
                }

                if (
                    replacement.source === "clock_extra" &&
                    !clockExtraBackupByDate.has(date)
                ) {
                    clockExtraBackupByDate.set(date, replacement);
                }
            }
        });

    return {
        byCoveredDate,
        byWorkerDate,
        clockExtraBackupByDate,
        coveringWorkersByDate
    };
}

function isoToCalendarKeyDay(iso) {
    const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) return "";

    return `${Number(match[1])}-${Number(match[2]) - 1}-${Number(match[3])}`;
}

function isoInCalendarMonth(iso, year, month) {
    const match = String(iso || "").match(/^(\d{4})-(\d{2})-/);

    return Boolean(match) &&
        Number(match[1]) === Number(year) &&
        Number(match[2]) - 1 === Number(month);
}

function pushCalendarIndexItem(index, keyDay, item) {
    if (!keyDay || !item) return;

    const list = index.get(keyDay) || [];

    list.push(item);
    index.set(keyDay, list);
}

function buildCalendarTurnChangeIndex(profileName, year, month) {
    const index = new Map();

    getSwaps().forEach(swap => {
        if (
            !swap ||
            cambioEstaAnulado(swap) ||
            (swap.from !== profileName && swap.to !== profileName)
        ) {
            return;
        }

        const perspective = getSwapPerspective(swap, profileName);

        if (!perspective) return;

        if (
            !perspective.changeSkipped &&
            isoInCalendarMonth(perspective.changeDate, year, month)
        ) {
            pushCalendarIndexItem(
                index,
                isoToCalendarKeyDay(perspective.changeDate),
                {
                    swap,
                    perspective,
                    type: "change",
                    label: `CCTT ${perspective.changeTurnLabel}`.trim()
                }
            );
        }

        if (
            !perspective.returnSkipped &&
            isoInCalendarMonth(perspective.returnDate, year, month)
        ) {
            pushCalendarIndexItem(
                index,
                isoToCalendarKeyDay(perspective.returnDate),
                {
                    swap,
                    perspective,
                    type: "return",
                    label: `DDTT ${perspective.returnTurnLabel}`.trim()
                }
            );
        }
    });

    return index;
}

function buildCalendarShiftMoveIndex(profileName, year, month) {
    const index = new Map();

    getShiftMoves()
        .filter(move => move.profile === profileName)
        .forEach(move => {
            [
                move.sourceKey,
                move.targetKey
            ].forEach(keyDay => {
                if (!calendarKeyInMonth(keyDay, year, month)) return;

                pushCalendarIndexItem(index, keyDay, {
                    move,
                    role:
                        move.sourceKey === move.targetKey
                            ? "same"
                            : move.sourceKey === keyDay
                                ? "source"
                                : "target",
                    label: "TTMM"
                });
            });
        });

    return index;
}

function buildCalendarBlockedDayIndex(profileName) {
    const profileKey = String(profileName || "").trim();
    const index = new Map();

    if (!profileKey) return index;

    getWorkerBlockedDays()
        .filter(item => item.profileName === profileName)
        .forEach(item => {
            if (item.date) index.set(item.date, item);
        });

    return index;
}

function buildPendingLeaveRequestIndex(profileName, year, month, days) {
    const index = new Map();
    const requests = getWorkerRequests().filter(request =>
        request.status === "pending" &&
        request.profile === profileName &&
        PENDING_LEAVE_REQUEST_TYPES.has(request.type)
    );

    if (!requests.length) return index;

    for (let d = 1; d <= days; d++) {
        const keyDay = key(year, month, d);
        const iso = isoFromKeyDay(keyDay);
        const request = requests.find(item =>
            leaveRequestCoversISODate(item, iso)
        );

        if (request) index.set(keyDay, request);
    }

    return index;
}

function buildCalendarContractIndex(profileName, year, month, days) {
    const index = new Map();

    if (!isReplacementProfile(profileName)) return index;

    for (let d = 1; d <= days; d++) {
        const keyDay = key(year, month, d);

        index.set(keyDay, hasContractForDate(profileName, keyDay));
    }

    return index;
}

function clockMarkHasSevereIncident(mark) {
    if (!mark?.segments) return false;

    return Object.values(mark.segments).some(segment =>
        (segment?.missingEntry || segment?.missingExit) &&
        !segment?.rrhhPayApproved
    );
}

function clockMarkHasSimpleIncident(mark) {
    if (!mark?.segments || clockMarkHasSevereIncident(mark)) {
        return false;
    }

    return Object.values(mark.segments).some(segment =>
        (segment?.entryTime || segment?.exitTime) &&
        !segment?.rrhhPayApproved &&
        !segment?.discountWaived
    );
}

async function handleCalendarClick(event) {
    const cell = event.target.closest(".day[data-action='calendar-day']");

    if (!cell || !delegatedCalendar?.contains(cell)) return;

    const selectionWasActive = Boolean(window.selectionMode);

    if (calendarSelectionHandler) {
        const handled = await calendarSelectionHandler({
            event,
            cell,
            date: dateFromKeyDay(cell.dataset.keyDay)
        });

        if (selectionWasActive || handled === true) return;
    }

    const handler = calendarCellHandlers.get(cell);

    if (handler) {
        await handler(event);
        return;
    }

    await handleCalendarCellFallbackClick(cell, event);
}

function ensureCalendarDelegation(calendar) {
    if (!calendar || delegatedCalendar === calendar) return;

    delegatedCalendar?.removeEventListener("click", handleCalendarClick);
    delegatedCalendar = calendar;
    delegatedCalendar.addEventListener("click", handleCalendarClick);
}

async function handleCalendarCellFallbackClick(cell, event) {
    const activeProfile = getCurrentProfile();
    const keyDay = cell?.dataset?.keyDay || "";

    if (!activeProfile || !keyDay) return;

    const workers = getAppState().workers?.length
        ? getAppState().workers
        : getProfiles();
    const activeWorker = workers.find(worker =>
        worker.name === activeProfile
    ) || null;
    const activeProfileEnabled =
        isProfileActive(activeWorker || activeProfile);

    if (!activeProfileEnabled) {
        event.stopPropagation();
        alert("Este perfil esta desactivado. Reactivalo desde Perfil para modificar su calendario.");
        return;
    }

    const date = dateFromKeyDay(keyDay);
    const year = date.getFullYear();
    const month = date.getMonth();
    const holidays =
        lastCalendarView?.year === year &&
        lastCalendarView?.month === month &&
        lastCalendarView?.holidaysLoaded === true
            ? lastCalendarView.holidays || {}
            : await fetchHolidays(year);
    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();
    const absences = getAbsences();
    const data = getProfileData();
    const baseState = getTurnoBase(activeProfile, keyDay);
    const state = aplicarCambiosTurno(
        activeProfile,
        keyDay,
        getTurnoProgramado(activeProfile, keyDay)
    );
    const pendingLeaveRequest =
        getPendingLeaveRequestForDay(activeProfile, keyDay);

    if (
        pendingLeaveRequest &&
        !window.selectionMode
    ) {
        event.stopPropagation();
        return openPendingLeaveRequestDialog({
            request: pendingLeaveRequest,
            profile: activeProfile,
            keyDay,
            baseState
        });
    }

    const turnChangeMarkers =
        getCambiosTurnoCalendario(activeProfile, keyDay);
    const turnChangeMarker = turnChangeMarkers[0] || null;
    const turnChange = turnChangeMarker?.swap || null;
    const coveredReplacement =
        getReplacementForCoveredShift(activeProfile, keyDay);
    const replacementContractError =
        isReplacementProfile(activeProfile) &&
        state > 0 &&
        !hasContractForDate(activeProfile, keyDay);
    const honorariaSummary = getHonorariaMonthlySummary(
        activeProfile,
        year,
        month,
        holidays
    );
    const honorariaExcess =
        getHonorariaExcessForKey(honorariaSummary, keyDay);
    const severeClockIncident =
        hasSevereClockIncident(activeProfile, keyDay);
    const needsReplacement =
        requiereReemplazoTurnoBase(
            keyDay,
            baseState,
            admin,
            legal,
            comp,
            absences
        ) &&
        !coveredReplacement;
    const pendingManualExtra =
        getPendingManualExtraTurn(
            activeProfile,
            keyDay,
            data
        );
    const showExtraReason =
        !needsReplacement &&
        !turnChange &&
        !replacementContractError &&
        pendingManualExtra;
    const clockExtra =
        hasClockExtra(
            activeProfile,
            keyDay,
            date,
            state,
            holidays
        );
    const showClockExtraReason =
        clockExtra &&
        !getClockExtraBackupForWorker(activeProfile, keyDay);
    const badgeTarget = event.target.closest(".day-badge");

    if (replacementContractError && badgeTarget) {
        event.stopPropagation();
        window.startReplacementContractEdit?.(
            activeProfile,
            keyDay
        );
        return;
    }

    if (
        honorariaExcess &&
        !replacementContractError &&
        !severeClockIncident &&
        !needsReplacement &&
        badgeTarget
    ) {
        event.stopPropagation();
        alert(getHonorariaLimitMessage(honorariaSummary));
        return;
    }

    if (showExtraReason && badgeTarget) {
        event.stopPropagation();
        return openExtraReasonDialog(
            activeProfile,
            keyDay,
            showExtraReason
        );
    }

    if (showClockExtraReason && badgeTarget) {
        event.stopPropagation();
        return openClockExtraReasonDialog(
            activeProfile,
            keyDay,
            state
        );
    }

    if (turnChange || needsReplacement) {
        event.stopPropagation();
    }

    await clickDia(
        keyDay,
        isBusinessDay(date, holidays),
        admin,
        legal,
        comp,
        absences,
        {
            cell,
            date,
            holidays
        }
    );
}

export function setCalendarSelectionHandler(handler) {
    calendarSelectionHandler =
        typeof handler === "function" ? handler : null;
}

function closeCalendarMonthPicker() {
    if (!calendarMonthPicker) return;

    calendarMonthPicker.classList.add("hidden");
    document
        .getElementById("monthYear")
        ?.setAttribute("aria-expanded", "false");
}

function positionCalendarMonthPicker() {
    const trigger = document.getElementById("monthYear");

    if (
        !trigger ||
        !calendarMonthPicker ||
        calendarMonthPicker.classList.contains("hidden")
    ) {
        return;
    }

    const gap = 8;
    const edge = 12;
    const triggerRect = trigger.getBoundingClientRect();
    const pickerRect = calendarMonthPicker.getBoundingClientRect();
    const left = Math.min(
        Math.max(
            edge,
            triggerRect.left +
            (triggerRect.width - pickerRect.width) / 2
        ),
        window.innerWidth - pickerRect.width - edge
    );
    const preferredTop = triggerRect.bottom + gap;
    const top = preferredTop + pickerRect.height <= window.innerHeight - edge
        ? preferredTop
        : Math.max(edge, triggerRect.top - pickerRect.height - gap);

    calendarMonthPicker.style.left = `${Math.round(left)}px`;
    calendarMonthPicker.style.top = `${Math.round(top)}px`;
}

function renderCalendarMonthPicker() {
    if (!calendarMonthPicker) return;

    const activeYear = currentDate.getFullYear();
    const activeMonth = currentDate.getMonth();

    calendarMonthPicker.innerHTML = `
        <div class="calendar-month-picker__year">
            <button class="calendar-month-picker__year-button" type="button" data-calendar-year-step="-1" aria-label="A&#241;o anterior">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
            </button>
            <strong>${calendarPickerYear}</strong>
            <button class="calendar-month-picker__year-button" type="button" data-calendar-year-step="1" aria-label="A&#241;o siguiente">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </button>
        </div>
        <div class="calendar-month-picker__months">
            ${CALENDAR_MONTH_NAMES.map((name, month) => `
                <button
                    class="calendar-month-picker__month${calendarPickerYear === activeYear && month === activeMonth ? " is-active" : ""}"
                    type="button"
                    data-calendar-month="${month}"
                >
                    ${name}
                </button>
            `).join("")}
        </div>
    `;

    calendarMonthPicker
        .querySelectorAll("[data-calendar-year-step]")
        .forEach(button => {
            button.onclick = event => {
                event.stopPropagation();
                calendarPickerYear += Number(button.dataset.calendarYearStep);
                renderCalendarMonthPicker();
                positionCalendarMonthPicker();
            };
        });

    calendarMonthPicker
        .querySelectorAll("[data-calendar-month]")
        .forEach(button => {
            button.onclick = async event => {
                event.stopPropagation();
                await goToCalendarMonth(
                    calendarPickerYear,
                    Number(button.dataset.calendarMonth),
                    { deferHeavy: true }
                );
            };
        });
}

function setupCalendarMonthPicker(trigger) {
    if (!trigger || trigger.dataset.monthPickerBound === "true") {
        return;
    }

    trigger.dataset.monthPickerBound = "true";
    calendarMonthPicker = document.createElement("div");
    calendarMonthPicker.className =
        "calendar-month-picker hidden";
    calendarMonthPicker.setAttribute("role", "dialog");
    calendarMonthPicker.setAttribute(
        "aria-label",
        "Seleccionar mes y a\u00f1o"
    );
    document.body.appendChild(calendarMonthPicker);

    trigger.addEventListener("click", event => {
        event.stopPropagation();

        if (!calendarMonthPicker.classList.contains("hidden")) {
            closeCalendarMonthPicker();
            return;
        }

        calendarPickerYear = currentDate.getFullYear();
        renderCalendarMonthPicker();
        calendarMonthPicker.classList.remove("hidden");
        trigger.setAttribute("aria-expanded", "true");
        positionCalendarMonthPicker();
    });

    document.addEventListener("click", closeCalendarMonthPicker);
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closeCalendarMonthPicker();
        }
    });
    window.addEventListener("resize", positionCalendarMonthPicker);
    window.addEventListener(
        "scroll",
        positionCalendarMonthPicker,
        true
    );
}

function deferAfterPaint(callback) {
    if (typeof window === "undefined") {
        callback();
        return;
    }

    const run = () => window.setTimeout(callback, 0);

    if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(run);
        });
    } else {
        run();
    }
}

function deferCalendarDashboardRefresh() {
    if (typeof window === "undefined") return;
    if (typeof window.renderDashboardState !== "function") return;

    if (calendarDashboardRefreshTimer) {
        if (
            calendarDashboardRefreshUsesIdle &&
            typeof window.cancelIdleCallback === "function"
        ) {
            window.cancelIdleCallback(calendarDashboardRefreshTimer);
        } else {
            clearTimeout(calendarDashboardRefreshTimer);
        }
    }
    calendarDashboardRefreshUsesIdle = false;

    const run = () => {
        calendarDashboardRefreshTimer = 0;

        if (typeof window.renderDashboardState !== "function") return;
        window.renderDashboardState();
    };

    if (typeof window.requestIdleCallback === "function") {
        calendarDashboardRefreshUsesIdle = true;
        calendarDashboardRefreshTimer = window.requestIdleCallback(run, {
            timeout: 8000
        });
        return;
    }

    calendarDashboardRefreshTimer = window.setTimeout(run, 3000);
}

function waitCalendarIdle(timeout = 120) {
    return new Promise(resolve => {
        if (typeof window === "undefined") {
            resolve();
            return;
        }

        if (typeof window.requestIdleCallback === "function") {
            window.requestIdleCallback(
                () => resolve(),
                { timeout }
            );
            return;
        }

        window.setTimeout(resolve, Math.min(timeout, 80));
    });
}

function markCalendarUserActivity() {
    calendarLastUserActivityAt = Date.now();
}

function calendarHasPendingInput() {
    try {
        return Boolean(
            typeof navigator !== "undefined" &&
            navigator.scheduling &&
            typeof navigator.scheduling.isInputPending === "function" &&
            navigator.scheduling.isInputPending({ includeContinuous: true })
        );
    } catch (_error) {
        return false;
    }
}

function calendarInteractiveDelay(quietMs = CALENDAR_SUMMARY_USER_QUIET_MS) {
    if (typeof document === "undefined") return 0;
    if (document.visibilityState !== "visible") return 0;

    const activeView = document.body?.dataset?.activeView || "turnos";

    if (activeView !== "turnos" && activeView !== "timeline") return 0;

    if (calendarHasPendingInput()) {
        return CALENDAR_SUMMARY_VISIBLE_RETRY_MS;
    }

    const elapsed = Date.now() - calendarLastUserActivityAt;
    const remaining = Math.max(0, Number(quietMs) - elapsed);

    return remaining > 0 ? remaining : 0;
}

function cancelCalendarHeavyUpdates() {
    clearTimeout(calendarHeavyUpdateTimer);
    calendarHeavyUpdateTimer = 0;
    calendarHeavyUpdateRequest++;
    cancelTimelineRender();
}

function renderDeferredPanelError(elementId, message) {
    const div = document.getElementById(elementId);

    if (!div) return;

    div.setAttribute("aria-busy", "false");
    div.innerHTML = `
        <div class="empty-state empty-state--compact">
            ${message}
        </div>
    `;
}

async function runDeferredTimelineUpdate() {
    try {
        await measurePerformance(
            "timeline:deferred-render",
            () => renderTimeline(),
            {
                activeView: document.body.dataset.activeView || "turnos",
                year: currentDate.getFullYear(),
                month: currentDate.getMonth()
            }
        );
    } catch (error) {
        console.error("No se pudo actualizar el timeline", error);
        renderDeferredPanelError(
            "teamTimeline",
            "No se pudo cargar el timeline. Intenta cambiar de mes o recargar."
        );
    }
}

async function runDeferredStaffingUpdate() {
    if (typeof window.renderInlineStaffingAnalysis !== "function") return;

    try {
        await measurePerformance(
            "staffing:inline-deferred-render",
            () => window.renderInlineStaffingAnalysis(),
            {
                activeView: document.body.dataset.activeView || "turnos",
                year: currentDate.getFullYear(),
                month: currentDate.getMonth()
            }
        );
    } catch (error) {
        console.error("No se pudo actualizar el resumen RRHH", error);
        renderDeferredPanelError(
            "staffingReportInline",
            "No se pudo cargar el resumen RRHH. Intenta cambiar de mes o recargar."
        );
    }
}

function runCalendarHeavyUpdates(options = {}, context = null) {
    if (calendarDirectEditRefreshTimer) {
        cancelTimelineRender();
        return;
    }

    const requestId = ++calendarHeavyUpdateRequest;
    const update = async () => {
        const finishHeavyUpdate = startPerformanceSpan(
            "calendar:heavy-updates",
            {
                deferHeavy: options.deferHeavy === true,
                year: currentDate.getFullYear(),
                month: currentDate.getMonth(),
                activeView: document.body.dataset.activeView || "turnos"
            },
            {
                type: "async-span",
                threshold: 180
            }
        );

        calendarHeavyUpdateTimer = 0;

        try {
            if (requestId !== calendarHeavyUpdateRequest) {
                return;
            }

            await waitCalendarIdle(options.deferHeavy ? 900 : 300);

            if (requestId !== calendarHeavyUpdateRequest) {
                return;
            }

            let activeView =
                document.body.dataset.activeView || "turnos";

            if (
                activeView === "turnos" ||
                activeView === "timeline"
            ) {
                await runDeferredTimelineUpdate();
            }

            if (requestId !== calendarHeavyUpdateRequest) {
                return;
            }

            await waitCalendarIdle(500);

            if (requestId !== calendarHeavyUpdateRequest) {
                return;
            }

            if (
                context &&
                context.profile &&
                context.profile === getCurrentProfile() &&
                context.y === currentDate.getFullYear() &&
                context.m === currentDate.getMonth()
            ) {
                measurePerformance(
                    "calendar:calculate-carry-over",
                    () => {
                        const carryOut = calculateCarryOver(
                            context.profile,
                            context.y,
                            context.m,
                            context.days,
                            context.holidays,
                            context.data
                        );
                        const next = new Date(context.y, context.m + 1, 1);

                        saveCarry(
                            next.getFullYear(),
                            next.getMonth(),
                            carryOut
                        );
                    },
                    {
                        profile: context.profile,
                        year: context.y,
                        month: context.m
                    }
                );
            }

            if (requestId !== calendarHeavyUpdateRequest) {
                return;
            }

            await waitCalendarIdle(900);

            if (requestId !== calendarHeavyUpdateRequest) {
                return;
            }

            activeView =
                document.body.dataset.activeView || "turnos";

            if (
                activeView === "turnos" &&
                typeof window.renderInlineStaffingAnalysis === "function"
            ) {
                await runDeferredStaffingUpdate();
            }
        } finally {
            finishHeavyUpdate();
        }
    };

    if (options.deferHeavy) {
        cancelTimelineRender();
        clearTimeout(calendarHeavyUpdateTimer);
        calendarHeavyUpdateTimer = window.setTimeout(
            () => void update(),
            CALENDAR_HEAVY_UPDATE_DELAY_MS
        );
        return;
    }

    void update();
}

function keepCalendarDirectEditHistoryOpen(label) {
    if (
        !calendarDirectEditHistoryOpen &&
        typeof window.pushUndoState === "function"
    ) {
        window.pushUndoState(label);
    }

    calendarDirectEditHistoryOpen = true;
    clearTimeout(calendarDirectEditHistoryTimer);
    calendarDirectEditHistoryTimer = window.setTimeout(() => {
        calendarDirectEditHistoryOpen = false;
        calendarDirectEditHistoryTimer = 0;
    }, CALENDAR_DIRECT_EDIT_REFRESH_DELAY_MS);
}

function closeCalendarDirectEditHistory() {
    clearTimeout(calendarDirectEditHistoryTimer);
    calendarDirectEditHistoryTimer = 0;
    calendarDirectEditHistoryOpen = false;
}

function cancelCalendarDirectEditRefresh() {
    clearTimeout(calendarDirectEditRefreshTimer);
    calendarDirectEditRefreshTimer = 0;
    calendarDirectEditRefreshRequest++;
    calendarRenderRequest++;
    cancelCalendarHeavyUpdates();
    closeCalendarDirectEditHistory();
}

async function flushCalendarDirectEditRefresh(options = {}) {
    const expectedRequest =
        Number(options.requestId) || 0;
    const force = options.force === true;

    if (
        expectedRequest &&
        expectedRequest !== calendarDirectEditRefreshRequest
    ) {
        return;
    }

    if (!calendarDirectEditRefreshTimer && !force) return;

    clearTimeout(calendarDirectEditRefreshTimer);
    calendarDirectEditRefreshTimer = 0;
    calendarDirectEditRefreshRequest++;
    closeCalendarDirectEditHistory();
    await updateVisibleCalendarDays({ updateSummary: true });
}

function scheduleCalendarDirectEditRefresh(keyDay) {
    calendarDirectEditRefreshRequest++;
    queueCalendarDayUpdates([keyDay]);
}

window.flushCalendarDirectEditRefresh =
    flushCalendarDirectEditRefresh;

function key(y, m, d) {
    return `${y}-${m}-${d}`;
}

function dateFromKeyDay(keyDay) {
    const [year, month, day] = String(keyDay || "")
        .split("-")
        .map(Number);

    return new Date(year || 0, month || 0, day || 1);
}

function isoFromKeyDay(keyDay) {
    const date = dateFromKeyDay(keyDay);

    if (Number.isNaN(date.getTime())) return "";

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function visibleCalendarKeys() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();

    return Array.from(
        { length: days },
        (_item, index) => key(year, month, index + 1)
    );
}

function queueCalendarDayUpdates(keys = []) {
    keys.forEach(keyDay => {
        if (
            calendarKeyInMonth(
                keyDay,
                currentDate.getFullYear(),
                currentDate.getMonth()
            )
        ) {
            pendingCalendarKeys.add(keyDay);
            pendingStaffingKeys.add(keyDay);
        }
    });

    if (!pendingCalendarKeys.size || pendingCalendarUpdateTimer) return;

    const schedule = window.requestAnimationFrame ||
        (callback => window.setTimeout(callback, 16));

    pendingCalendarUpdateTimer = schedule(async () => {
        pendingCalendarUpdateTimer = 0;
        const changedKeys = [...pendingCalendarKeys];
        const staffingKeys = [...pendingStaffingKeys];
        pendingCalendarKeys.clear();
        pendingStaffingKeys.clear();

        if (changedKeys.length) {
            await renderCalendar({
                changedKeys,
                allowDuringDirectEdit: true,
                updateSummary: true
            });
        }

        if (
            staffingKeys.length &&
            typeof window.updateInlineStaffingDays === "function"
        ) {
            void window.updateInlineStaffingDays(staffingKeys);
        }
    });
}

function scheduleWorkerSummaryUpdate(workerId = getCurrentProfile()) {
    const requestId = ++pendingWorkerSummaryRequest;

    clearTimeout(pendingWorkerSummaryTimer);
    pendingWorkerSummaryTimer = window.setTimeout(async () => {
        pendingWorkerSummaryTimer = 0;
        await waitCalendarIdle(600);

        if (requestId !== pendingWorkerSummaryRequest) return;

        const interactiveDelay = calendarInteractiveDelay();

        if (interactiveDelay > 0) {
            pendingWorkerSummaryTimer = window.setTimeout(() => {
                if (requestId === pendingWorkerSummaryRequest) {
                    scheduleWorkerSummaryUpdate(workerId);
                }
            }, interactiveDelay);
            return;
        }

        measurePerformance(
            "calendar:update-worker-summary",
            () => updateWorkerSummary(workerId),
            {
                workerId: String(workerId || ""),
                profile: getCurrentProfile() || "",
                year: currentDate.getFullYear(),
                month: currentDate.getMonth()
            }
        );
    }, 260);
}

function calendarKeyFromDateInput(workerId, date) {
    if (date instanceof Date) {
        return key(date.getFullYear(), date.getMonth(), date.getDate());
    }

    const storedKey = String(date || "");

    if (getCalendarCell(workerId, storedKey)) return storedKey;

    const isoMatch = storedKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const parsed = isoMatch
        ? new Date(
            Number(isoMatch[1]),
            Number(isoMatch[2]) - 1,
            Number(isoMatch[3])
        )
        : new Date(date);

    return Number.isNaN(parsed.getTime())
        ? ""
        : key(
            parsed.getFullYear(),
            parsed.getMonth(),
            parsed.getDate()
        );
}

// Actualiza un conjunto de fechas en una sola pasada. Esto evita repetir la
// lectura del mes y el calculo del resumen cuando un evento cambia varios dias.
export async function updateDayCells(workerId, dates, options = {}) {
    const activeWorkerId = resolveWorkerId(getCurrentProfile());

    if (
        resolveWorkerId(workerId) !== activeWorkerId ||
        lastCalendarView?.workerId !== activeWorkerId ||
        lastCalendarView?.year !== currentDate.getFullYear() ||
        lastCalendarView?.month !== currentDate.getMonth()
    ) return false;

    const changedKeys = Array.from(new Set(
        (Array.isArray(dates) ? dates : [dates])
            .map(date => calendarKeyFromDateInput(activeWorkerId, date))
            .filter(keyDay => keyDay && calendarKeyInMonth(
                keyDay,
                currentDate.getFullYear(),
                currentDate.getMonth()
            ))
    ));

    if (!changedKeys.length) return false;

    changedKeys.forEach(keyDay => pendingCalendarKeys.delete(keyDay));

    await renderCalendar({
        changedKeys,
        allowDuringDirectEdit: true,
        updateSummary: options.updateSummary !== false
    });
    return true;
}

export async function updateDayCell(workerId, date) {
    return updateDayCells(workerId, [date]);
}

export async function updateDateRange(workerId, startDate, endDate) {
    const activeWorkerId = resolveWorkerId(getCurrentProfile());

    if (
        resolveWorkerId(workerId) !== activeWorkerId ||
        lastCalendarView?.workerId !== activeWorkerId ||
        lastCalendarView?.year !== currentDate.getFullYear() ||
        lastCalendarView?.month !== currentDate.getMonth()
    ) return false;

    const changedKeys = keysForCalendarRange(startDate, endDate)
        .filter(keyDay => calendarKeyInMonth(
            keyDay,
            currentDate.getFullYear(),
            currentDate.getMonth()
        ));

    if (!changedKeys.length) return false;

    changedKeys.forEach(keyDay => pendingCalendarKeys.delete(keyDay));

    await renderCalendar({
        changedKeys,
        allowDuringDirectEdit: true,
        updateSummary: true
    });
    return true;
}

export async function updateVisibleCalendarDays(options = {}) {
    const workerId = resolveWorkerId(getCurrentProfile());

    if (
        !workerId ||
        lastCalendarView?.workerId !== workerId ||
        lastCalendarView?.year !== currentDate.getFullYear() ||
        lastCalendarView?.month !== currentDate.getMonth()
    ) return false;

    visibleCalendarKeys().forEach(keyDay =>
        pendingCalendarKeys.delete(keyDay)
    );

    await renderCalendar({
        changedKeys: visibleCalendarKeys(),
        allowDuringDirectEdit: true,
        updateSummary: options.updateSummary === true,
        cooperative: options.cooperative === true,
        modeRefresh: options.modeRefresh === true
    });
    return true;
}

export function updateWorkerSummary(workerId = getCurrentProfile()) {
    const resolvedWorkerId = resolveWorkerId(workerId);
    const workerName = getCurrentProfile();
    const activeWorkerId = resolveWorkerId(workerName);
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    if (
        !resolvedWorkerId ||
        resolvedWorkerId !== activeWorkerId ||
        lastCalendarView?.workerId !== activeWorkerId ||
        lastCalendarView?.year !== year ||
        lastCalendarView?.month !== month
    ) return null;

    const days = new Date(year, month + 1, 0).getDate();
    const holidays = lastCalendarView?.holidays || {};
    const data = getProfileData(workerName);
    const stats = calculateWorkerMonthTotals(
        workerName,
        year,
        month,
        days,
        holidays,
        data,
        getBlockedDays(workerName),
        getCarry(year, month)
    );
    const carryOut = calculateCarryOver(
        workerName,
        year,
        month,
        days,
        holidays,
        data
    );
    const next = new Date(year, month + 1, 1);

    saveCarry(next.getFullYear(), next.getMonth(), carryOut);

    window.dispatchEvent(new CustomEvent("proturnos:workerMonthUpdated", {
        detail: {
            workerId: resolvedWorkerId,
            workerName,
            year,
            month,
            stats,
            carryOut
        }
    }));

    return stats;
}

export function updateVisibleWorkers() {
    window.dispatchEvent(new CustomEvent("proturnos:visibleWorkersUpdated", {
        detail: {
            year: currentDate.getFullYear(),
            month: currentDate.getMonth()
        }
    }));
}

function calendarStorageMaps(profileName) {
    return {
        [`data_${profileName}`]: getJSON(`data_${profileName}`, {}),
        [`admin_${profileName}`]: getJSON(`admin_${profileName}`, {}),
        [`legal_${profileName}`]: getJSON(`legal_${profileName}`, {}),
        [`comp_${profileName}`]: getJSON(`comp_${profileName}`, {}),
        [`absences_${profileName}`]: getJSON(`absences_${profileName}`, {}),
        [`blocked_${profileName}`]: getJSON(`blocked_${profileName}`, {}),
        [`hourReturns_${profileName}`]: getJSON(`hourReturns_${profileName}`, {}),
        [`clockMarks_${profileName}`]: getJSON(`clockMarks_${profileName}`, {})
    };
}

function syncCalendarMapSnapshots(profileName, maps = null) {
    const nextMaps = maps || calendarStorageMaps(profileName);

    Object.entries(nextMaps).forEach(([storageKey, value]) => {
        calendarMapSnapshots.set(storageKey, value || {});
    });
}

function syncCentralCalendarMaps(profileName) {
    const workerId = resolveWorkerId(profileName);

    updateWorkerCalendarMaps(workerId, {
        shifts: getJSON(`data_${profileName}`, {}),
        absences: {
            admin: getJSON(`admin_${profileName}`, {}),
            legal: getJSON(`legal_${profileName}`, {}),
            comp: getJSON(`comp_${profileName}`, {}),
            absences: getJSON(`absences_${profileName}`, {})
        }
    });
}

function storedDateToCalendarKey(value) {
    const text = String(value || "");
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (iso) {
        return key(
            Number(iso[1]),
            Number(iso[2]) - 1,
            Number(iso[3])
        );
    }

    return /^\d{4}-\d{1,2}-\d{1,2}$/.test(text)
        ? text
        : "";
}

function changedCollectionCalendarKeys(
    storageKey,
    change,
    profileName
) {
    if (!change || !("previous" in change) || !("next" in change)) {
        return null;
    }

    const parse = value => {
        try {
            const result = JSON.parse(value || "[]");
            return Array.isArray(result) ? result : [];
        } catch {
            return [];
        }
    };
    const previous = parse(change.previous);
    const next = parse(change.next);
    const itemId = (item, index) => String(
        item?.id || item?.requestId || `${index}:${JSON.stringify(item)}`
    );
    const previousById = new Map(
        previous.map((item, index) => [itemId(item, index), item])
    );
    const nextById = new Map(
        next.map((item, index) => [itemId(item, index), item])
    );
    const changed = [];

    new Set([...previousById.keys(), ...nextById.keys()])
        .forEach(id => {
            const before = previousById.get(id);
            const after = nextById.get(id);

            if (JSON.stringify(before) === JSON.stringify(after)) return;
            changed.push(after || before);
        });

    const keys = new Set();

    changed.forEach(item => {
        if (storageKey === "replacements") {
            if (
                item?.worker !== profileName &&
                item?.replaced !== profileName
            ) return;

            const keyDay = storedDateToCalendarKey(item?.keyDay);
            if (keyDay) keys.add(keyDay);
            return;
        }

        if (storageKey === "swaps") {
            if (
                item?.from !== profileName &&
                item?.to !== profileName
            ) return;

            [item?.fecha, item?.devolucion]
                .map(storedDateToCalendarKey)
                .filter(Boolean)
                .forEach(keyDay => keys.add(keyDay));
        }
    });

    return [...keys];
}

function handleCalendarPersistenceChange(event) {
    const profileName = getCurrentProfile();
    const changedStorageKeys = event?.detail?.keys;
    const storageChanges = event?.detail?.changes || {};

    if (
        !profileName ||
        !lastCalendarView ||
        !Array.isArray(changedStorageKeys)
    ) return;

    if (
        changedStorageKeys.length &&
        changedStorageKeys.every(storageKey =>
            String(storageKey || "").startsWith("proturnos_ui_cache_")
        )
    ) {
        return;
    }

    const profileMaps = calendarStorageMaps(profileName);
    const mapKeys = new Set(Object.keys(profileMaps));
    const fullWorkerKeys = new Set([
        `baseData_${profileName}`,
        `rotativa_${profileName}`,
        `shift_${profileName}`,
        `shiftAssignmentHistory_${profileName}`,
        `contractHistory_${profileName}`,
        `gradeHistory_${profileName}`
    ]);
    const sharedCalendarKeys = new Set([
        "profiles",
        "manualHolidays",
        "turnoColorConfig",
        "turnChangeConfig"
    ]);
    const changedDayKeys = new Set();
    let refreshVisibleMonth = false;
    let clearAllCalendarCaches = false;

    changedStorageKeys.forEach(storageKey => {
        if (mapKeys.has(storageKey)) {
            const previous = calendarMapSnapshots.get(storageKey) || {};
            const next = profileMaps[storageKey] || {};

            diffCalendarRecordKeys(previous, next)
                .forEach(keyDay => changedDayKeys.add(keyDay));
            calendarMapSnapshots.set(storageKey, next);
            return;
        }

        if (storageKey === "replacements" || storageKey === "swaps") {
            const collectionKeys = changedCollectionCalendarKeys(
                storageKey,
                storageChanges[storageKey],
                profileName
            );

            if (collectionKeys === null) {
                refreshVisibleMonth = true;
            } else {
                collectionKeys.forEach(keyDay =>
                    changedDayKeys.add(keyDay)
                );
            }
            return;
        }

        if (
            fullWorkerKeys.has(storageKey) ||
            sharedCalendarKeys.has(storageKey)
        ) {
            refreshVisibleMonth = true;
            if (storageKey === "profiles") {
                clearAllCalendarCaches = true;
            }
        }
    });

    if (!changedDayKeys.size && !refreshVisibleMonth) return;

    if (clearAllCalendarCaches) {
        clearCalendarCache();
    } else {
        clearCalendarCacheForWorker(resolveWorkerId(profileName));
    }

    syncCentralCalendarMaps(profileName);
    queueCalendarDayUpdates(
        refreshVisibleMonth
            ? visibleCalendarKeys()
            : [...changedDayKeys]
    );
}

if (typeof window !== "undefined") {
    window.addEventListener(
        "proturnos:persistenceChanged",
        handleCalendarPersistenceChange
    );
    window.addEventListener("proturnos:firebaseAppState", event => {
        if (event.detail?.type !== "app-state-entries-applied") return;

        handleCalendarPersistenceChange({
            detail: {
                keys: event.detail.keys || []
            }
        });
    });
}

function addDaysISO(iso, offset) {
    const parts = String(iso || "").split("-").map(Number);
    const date = new Date(
        Number(parts[0]) || 0,
        (Number(parts[1]) || 1) - 1,
        Number(parts[2]) || 1
    );

    if (Number.isNaN(date.getTime())) return "";

    date.setDate(date.getDate() + Number(offset || 0));

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function pendingLeaveRequestLabel(type) {
    if (type === "admin") return "ADM";
    if (type === "half_admin_morning") return "1/2M";
    if (type === "half_admin_afternoon") return "1/2T";
    if (type === "legal") return "FL";
    if (type === "comp") return "FC";
    if (type === "union_leave") return "PG";
    if (type === "unpaid_leave") return "PSG";

    return "Permiso";
}

function pendingLeaveRequestLongLabel(type) {
    if (type === "admin") return "P. Administrativo";
    if (type === "half_admin_morning") return "1/2 ADM Ma\u00f1ana";
    if (type === "half_admin_afternoon") return "1/2 ADM Tarde";
    if (type === "legal") return "F. Legal";
    if (type === "comp") return "F. Compensatorio";
    if (type === "union_leave") return "Permiso Gremial";
    if (type === "unpaid_leave") return "Permiso sin Goce";

    return "Permiso";
}

function pendingLeaveRequestEndDate(request) {
    if (request.endDate) return request.endDate;

    const days = Math.max(
        1,
        Math.ceil(Number(request.days) || 1)
    );

    return addDaysISO(request.date, days - 1);
}

function leaveRequestCoversISODate(request, iso) {
    if (!request?.date || !iso) return false;

    const endDate = pendingLeaveRequestEndDate(request);

    return (
        String(iso) >= String(request.date) &&
        String(iso) <= String(endDate || request.date)
    );
}

function getPendingLeaveRequestForDay(profileName, keyDay) {
    const iso = isoFromKeyDay(keyDay);

    if (!profileName || !iso) return null;

    return getWorkerRequests().find(request =>
        request.status === "pending" &&
        request.profile === profileName &&
        PENDING_LEAVE_REQUEST_TYPES.has(request.type) &&
        leaveRequestCoversISODate(request, iso)
    ) || null;
}

function pendingLeaveHoverTitle(request, profileName, keyDay, baseState) {
    if (!request) return "";

    const start = request.date
        ? formatISODateForHover(request.date)
        : leaveDateLabelFromKey(keyDay);
    const end = pendingLeaveRequestEndDate(request);
    const baseLabel = turnoLabel(baseState) || "Libre";

    return [
        "Solicitud pendiente",
        `Trabajador: ${profileName}`,
        `Tipo: ${pendingLeaveRequestLongLabel(request.type)}`,
        `Inicio: ${start}`,
        end && end !== request.date
            ? `Termino: ${formatISODateForHover(end)}`
            : "",
        request.days ? `Dias: ${request.days}` : "",
        `Turno base: ${baseLabel}`,
        request.note ? `Detalle: ${request.note}` : ""
    ].filter(Boolean).join("\n");
}

function openPendingLeaveRequestDialog({
    request,
    profile,
    keyDay,
    baseState
}) {
    if (!request) return;

    const label = pendingLeaveRequestLongLabel(request.type);
    const start = request.date
        ? formatISODateForHover(request.date)
        : leaveDateLabelFromKey(keyDay);
    const end = pendingLeaveRequestEndDate(request);
    const baseLabel = turnoLabel(baseState) || "Libre";
    const canManage =
        typeof window.workspaceCanEditTarget !== "function" ||
        window.workspaceCanEditTarget("workerRequestsPanel");

    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog leave-request-dialog" role="dialog" aria-modal="true" aria-labelledby="pendingLeaveRequestTitle">
            <strong id="pendingLeaveRequestTitle">Solicitud pendiente</strong>
            <div class="leave-detail-rows">
                <div><span>Trabajador</span><b>${escapeHTML(profile)}</b></div>
                <div><span>Tipo</span><b>${escapeHTML(label)}</b></div>
                <div><span>Inicio</span><b>${escapeHTML(start)}</b></div>
                ${end && end !== request.date
                    ? `<div><span>T\u00e9rmino</span><b>${escapeHTML(formatISODateForHover(end))}</b></div>`
                    : ""}
                <div><span>D\u00edas</span><b>${escapeHTML(String(request.days || 1))}</b></div>
                <div><span>Turno base</span><b>${escapeHTML(baseLabel)}</b></div>
            </div>
            ${request.note
                ? `<p class="leave-detail-note">${escapeHTML(request.note)}</p>`
                : ""}
            ${canManage
                ? `
                    <div class="turn-change-dialog__actions">
                        <button class="primary-button" type="button" data-action="accept">Aceptar</button>
                        <button class="secondary-button" type="button" data-action="reject">Rechazar</button>
                        <button class="ghost-button" type="button" data-action="close">Cerrar</button>
                    </div>
                `
                : `
                    <p class="leave-detail-note">Tu usuario solo puede revisar esta solicitud.</p>
                    <div class="turn-change-dialog__actions">
                        <button class="ghost-button" type="button" data-action="close">Cerrar</button>
                    </div>
                `}
        </section>
    `;

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };
    const onKeydown = event => {
        if (event.key === "Escape") close();
    };
    const finish = async action => {
        const button = backdrop.querySelector(`[data-action='${action}']`);

        if (button) {
            button.disabled = true;
            button.textContent =
                action === "accept" ? "Aceptando..." : "Rechazando...";
        }

        const ok = action === "accept"
            ? await acceptWorkerRequestById(request.id)
            : await rejectWorkerRequestById(request.id);

        if (!ok) {
            if (button) {
                button.disabled = false;
                button.textContent =
                    action === "accept" ? "Aceptar" : "Rechazar";
            }
            return;
        }

        close();
        window.dispatchEvent(
            new CustomEvent("proturnos:workerRequestsChanged")
        );
        await updateDateRange(
            profile,
            request.date || isoFromKeyDay(keyDay),
            end || request.date || isoFromKeyDay(keyDay)
        );
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) close();
    });
    backdrop
        .querySelector("[data-action='close']")
        ?.addEventListener("click", close);
    backdrop
        .querySelector("[data-action='accept']")
        ?.addEventListener("click", () => void finish("accept"));
    backdrop
        .querySelector("[data-action='reject']")
        ?.addEventListener("click", () => void finish("reject"));

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
}

function scheduleCalendarAuditLog({
    profile,
    keyDay,
    previousTurn,
    nextTurn
}) {
    if (!profile || !keyDay) return;

    const id = `${profile}::${keyDay}`;
    const currentDraft =
        calendarAuditDrafts.get(id);
    const draft = {
        profile,
        keyDay,
        previousTurn: currentDraft
            ? currentDraft.previousTurn
            : previousTurn,
        nextTurn
    };

    calendarAuditDrafts.set(id, draft);

    if (calendarAuditTimers.has(id)) {
        clearTimeout(calendarAuditTimers.get(id));
    }

    calendarAuditTimers.set(
        id,
        setTimeout(() => {
            const finalDraft =
                calendarAuditDrafts.get(id);

            calendarAuditTimers.delete(id);
            calendarAuditDrafts.delete(id);

            if (!finalDraft) return;
            if (
                Number(finalDraft.previousTurn) ===
                Number(finalDraft.nextTurn)
            ) {
                return;
            }

            addAuditLog(
                AUDIT_CATEGORY.CALENDAR,
                "Modifico turno manualmente",
                `${finalDraft.profile}: ${finalDraft.keyDay} paso de ${turnoLabel(finalDraft.previousTurn) || "Libre"} a ${turnoLabel(finalDraft.nextTurn) || "Libre"}.`,
                {
                    profile: finalDraft.profile,
                    keyDay: finalDraft.keyDay,
                    previousTurn: finalDraft.previousTurn,
                    nextTurn: finalDraft.nextTurn,
                    delayed: true
                }
            );
        }, CALENDAR_AUDIT_DELAY_MS)
    );
}

function buildDayCell({
    day,
    month,
    year,
    keyDay,
    label,
    alternateLabel,
    badge,
    badges,
    title,
    isWeekendDay,
    isHoliday,
    isDraftSelected
}) {
    const div = document.createElement("div");

    div.classList.add("day");
    div.dataset.day = day;
    div.dataset.month = month;
    div.dataset.year = year;

    if (isWeekendDay) {
        div.classList.add("weekend");
    }

    if (isHoliday) {
        div.classList.add("holiday");
    }

    const today = new Date();
    if (
        today.getFullYear() === Number(year) &&
        today.getMonth() === Number(month) &&
        today.getDate() === Number(day)
    ) {
        div.classList.add("today");
    }

    if (isDraftSelected) {
        div.classList.add("draft-selected");
    }

    const visibleBadges = Array.isArray(badges)
        ? badges.filter(Boolean)
        : (badge ? [badge] : []);

    if (visibleBadges.length > 1) {
        div.classList.add("has-multiple-badges");
    }

    const badgeHTML = visibleBadges.length
        ? `
            <span class="day-badges">
                ${visibleBadges.map(item => `<span class="day-badge">${escapeHTML(item)}</span>`).join("")}
            </span>
        `
        : "";
    const labelHTML = alternateLabel
        ? `
            <span class="day-label day-label--alternating">
                <span class="day-label__primary">${escapeHTML(label || "")}</span>
                <span class="day-label__alternate">${escapeHTML(alternateLabel || "")}</span>
            </span>
        `
        : `<span class="day-label">${escapeHTML(label || "")}</span>`;

    div.innerHTML = `
        <span class="day-number">${day}</span>
        <span class="day-label-stack">
            ${labelHTML}
            ${badgeHTML}
        </span>
    `;

    if (title) {
        div.title = title;
    }

    return div;
}

function confirmUndoTurnChange(swap) {
    return new Promise(resolve => {
        const backdrop = document.createElement("div");

        backdrop.className = "turn-change-dialog-backdrop";
        backdrop.innerHTML = `
            <div class="turn-change-dialog" role="dialog" aria-modal="true" aria-labelledby="turnChangeDialogTitle">
                <strong id="turnChangeDialogTitle">Cambio de turno aplicado</strong>
                <p>
                    Para modificar el turno de este dia debes deshacer el cambio de turno aplicado.
                </p>
                <div class="turn-change-dialog__meta">
                    ${swap.from} -> ${swap.to}
                </div>
                <div class="turn-change-dialog__actions">
                    <button class="secondary-button" type="button" data-action="cancel">
                        Cancelar
                    </button>
                    <button class="primary-button" type="button" data-action="undo">
                        Deshacer
                    </button>
                </div>
            </div>
        `;

        const close = value => {
            document.removeEventListener("keydown", onKeydown);
            backdrop.remove();
            resolve(value);
        };

        const onKeydown = event => {
            if (event.key === "Escape") {
                close(false);
            }
        };

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) {
                close(false);
            }
        });

        backdrop
            .querySelector("[data-action='cancel']")
            .onclick = () => close(false);

        backdrop
            .querySelector("[data-action='undo']")
            .onclick = () => close(true);

        document.addEventListener("keydown", onKeydown);
        document.body.appendChild(backdrop);

        backdrop
            .querySelector("[data-action='undo']")
            .focus();
    });
}

async function handleTurnChangeDayClick(swap) {
    const shouldUndo =
        await confirmUndoTurnChange(swap);

    if (!shouldUndo) {
        return true;
    }

    if (typeof window.pushUndoState === "function") {
        window.pushUndoState("Deshacer cambio de turno");
    }

    deshacerCambioTurno(swap);
    await updateDayCell(getCurrentProfile(), swap.fecha);
    await updateDayCell(getCurrentProfile(), swap.devolucion);

    return true;
}

function sameRoleProfiles(profileName) {
    const profiles = getProfiles();
    const base = profiles.find(profile =>
        profile.name === profileName
    );

    if (!base || !isProfileActive(base)) return [];

    return profiles.filter(profile =>
        profile.name !== profileName &&
        isProfileActive(profile) &&
        profileCanCoverProfile(profile, base)
    );
}

function replacementScopeProfiles(profileName, scope = "compatible") {
    const profiles = getProfiles();
    const base = profiles.find(profile =>
        profile.name === profileName
    );

    if (!base || !isProfileActive(base)) return [];

    return profiles.filter(profile =>
        profile.name !== profileName &&
        isProfileActive(profile) &&
        (
            scope === "all-local" ||
            profileCanCoverProfile(profile, base)
        )
    );
}

function keyToISODate(keyDay) {
    const parts = String(keyDay || "").split("-");

    return `${parts[0]}-${String(Number(parts[1]) + 1).padStart(2, "0")}-${String(Number(parts[2])).padStart(2, "0")}`;
}

function formatISODateForHover(value) {
    const parts = String(value || "").split("-");

    if (parts.length !== 3) return String(value || "");

    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function formatISODateForSwapHover(value) {
    const parts = String(value || "")
        .split("-")
        .map(Number);

    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
        return formatISODateForHover(value);
    }

    return new Intl.DateTimeFormat(
        "es-CL",
        {
            day: "numeric",
            month: "long"
        }
    ).format(new Date(parts[0], parts[1] - 1, parts[2]));
}

function turnChangeHoverTitle(marker, profileName) {
    const swap = marker?.swap;
    const perspective = marker?.perspective;

    if (!swap) return "";

    if (perspective) {
        return [
            !perspective.changeSkipped &&
                `Cambia su turno base de ${perspective.changeTurnLabel} del ${formatISODateForSwapHover(perspective.changeDate)} con ${perspective.counterpart}`,
            !perspective.returnSkipped &&
                `Devuelve el turno el ${formatISODateForSwapHover(perspective.returnDate)} realizando ${perspective.returnTurnLabel}`
        ].filter(Boolean).join("\n");
    }

    return [
        `Cambio de turno: ${marker.label}`,
        `Trabajador seleccionado: ${profileName}`,
        `Entrega turno: ${swap.from}`,
        `Recibe turno: ${swap.to}`,
        `Fecha cambio: ${formatISODateForHover(swap.fecha)}`,
        `Turno cambio: ${swapCodeLabel(swap.turno)}`,
        `Fecha devoluci\u00f3n: ${formatISODateForHover(swap.devolucion)}`,
        `Turno devoluci\u00f3n: ${swapCodeLabel(swap.turnoDevuelto)}`
    ].filter(Boolean).join("\n");
}

function formatShiftMoveDate(keyDay) {
    const date = dateFromKeyDay(keyDay);

    if (Number.isNaN(date.getTime())) {
        return String(keyDay || "");
    }

    return new Intl.DateTimeFormat(
        "es-CL",
        {
            day: "numeric",
            month: "long",
            year: "numeric"
        }
    ).format(date);
}

function shiftMoveTurnLabel(turn) {
    return Number(turn) === TURNO.NOCHE
        ? "Noche"
        : "Larga";
}

function shiftMoveHoverTitle(marker) {
    const move = marker?.move;

    if (!move) return "";

    const detail = [
        "Turno modificado (TTMM)",
        `Trabajador: ${move.profile}`,
        `Origen: ${formatShiftMoveDate(move.sourceKey)} · ${shiftMoveTurnLabel(move.sourceTurn)}`,
        `Destino: ${formatShiftMoveDate(move.targetKey)} · ${shiftMoveTurnLabel(move.destinationTurn)}`
    ];

    if (marker.role === "source") {
        detail.push("Este dia quedo libre por el movimiento.");
    } else if (marker.role === "target") {
        detail.push("Este dia recibio el turno movido.");
    } else {
        detail.push("En este dia se modifico el horario del turno.");
    }

    return detail.join("\n");
}

function leaveTypeForDay(keyDay, admin, legal, comp, absences) {
    if (admin[keyDay] === 1) return "admin";
    if (admin[keyDay] === "0.5M") return "half_admin_morning";
    if (admin[keyDay] === "0.5T") return "half_admin_afternoon";
    if (admin[keyDay] === 0.5) return "half_admin";
    if (legal[keyDay]) return "legal";
    if (comp[keyDay]) return "comp";

    const absence = absences[keyDay];

    if (!absence) return "";

    return esAusenciaInjustificada(absence)
        ? "unjustified_absence"
        : getAbsenceType(absence);
}

function leaveLabelForType(type) {
    if (type === "admin") return "P. Administrativo";
    if (type === "half_admin_morning") return "1/2 ADM Ma\u00f1ana";
    if (type === "half_admin_afternoon") return "1/2 ADM Tarde";
    if (type === "half_admin") return "1/2 ADM";
    if (type === "legal") return "F. Legal";
    if (type === "comp") return "F. Compensatorio";
    if (type === "professional_license") return "LM Profesional";
    if (type === "union_leave") return "Permiso Gremial";
    if (type === "unpaid_leave") return "Permiso sin Goce";
    if (type === "unjustified_absence") return "Ausencia Injustificada";
    if (type === "license") return "Licencia Medica";

    return "Permiso/Ausencia";
}

function leaveSourceMapForType(type, admin, legal, comp, absences) {
    if (
        type === "admin" ||
        type === "half_admin_morning" ||
        type === "half_admin_afternoon" ||
        type === "half_admin"
    ) {
        return admin;
    }

    if (type === "legal") return legal;
    if (type === "comp") return comp;

    return absences;
}

function leaveApplicationHoverTitle(
    profileName,
    keyDay,
    admin,
    legal,
    comp,
    absences,
    coveringWorkers = null
) {
    const type = leaveTypeForDay(
        keyDay,
        admin,
        legal,
        comp,
        absences
    );

    if (!type) return "";

    const info = type === "half_admin"
        ? null
        : getLeaveApplicationInfo({
            profile: profileName,
            keyDay,
            type,
            sourceMap: leaveSourceMapForType(
                type,
                admin,
                legal,
                comp,
                absences
            )
        });

    const covering = Array.isArray(coveringWorkers)
        ? coveringWorkers
        : getCoveringWorkersForShift(profileName, keyDay);

    return [
        leaveLabelForType(type),
        `Aplicado: ${info?.createdAtLabel || "Sin registro"}`,
        `Usuario: ${info?.actorName || "No registrado"}`,
        covering.length ? `Cubre: ${covering.join(", ")}` : ""
    ].filter(Boolean).join("\n");
}

function leaveDateLabelFromKey(keyDay) {
    const [y, m, d] = String(keyDay || "").split("-").map(Number);
    const date = new Date(y, m, d);

    if (Number.isNaN(date.getTime())) return String(keyDay || "");

    return date.toLocaleDateString("es-CL", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric"
    });
}

function openLeaveDetailDialog({
    profile,
    keyDay,
    admin,
    legal,
    comp,
    absences
}) {
    const type = leaveTypeForDay(keyDay, admin, legal, comp, absences);

    if (!type) return;

    const label = leaveLabelForType(type);
    const info = type === "half_admin"
        ? null
        : getLeaveApplicationInfo({
            profile,
            keyDay,
            type,
            sourceMap: leaveSourceMapForType(
                type,
                admin,
                legal,
                comp,
                absences
            )
        });
    const canUndo = Boolean(info?.canUndo && info?.logId);
    const covering = getCoveringWorkersForShift(profile, keyDay);

    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog leave-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="leaveDetailTitle">
            <strong id="leaveDetailTitle">${escapeHTML(label)}</strong>
            <div class="leave-detail-rows">
                <div><span>Trabajador</span><b>${escapeHTML(profile)}</b></div>
                <div><span>Fecha</span><b>${escapeHTML(leaveDateLabelFromKey(keyDay))}</b></div>
                <div><span>Aplicado</span><b>${escapeHTML(info?.createdAtLabel || "Sin registro")}</b></div>
                <div><span>Por</span><b>${escapeHTML(info?.actorName || "No registrado")}</b></div>
                ${covering.length
                    ? `<div><span>Cubre</span><b>${escapeHTML(covering.join(", "))}</b></div>`
                    : ""}
            </div>
            <p class="leave-detail-note">
                ${canUndo
                    ? "Anular quitara el permiso/ausencia, cancelara los reemplazos asociados, notificara a los trabajadores afectados y dejara el registro del LOG marcado como anulado."
                    : "Este permiso no tiene un registro en el LOG que permita anularlo automaticamente."}
            </p>
            <div class="turn-change-dialog__actions">
                ${canUndo
                    ? `<button class="leave-detail-undo" type="button" data-action="undo">Anular permiso</button>`
                    : ""}
                <button class="ghost-button" type="button" data-action="close">Cerrar</button>
            </div>
        </section>
    `;

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };
    const onKeydown = event => {
        if (event.key === "Escape") close();
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) close();
    });
    backdrop
        .querySelector("[data-action='close']")
        ?.addEventListener("click", close);
    backdrop
        .querySelector("[data-action='undo']")
        ?.addEventListener("click", async event => {
            const button = event.currentTarget;
            const confirmed = await showConfirm(
                `Se anulará ${label} de ${profile}. También se cancelarán los reemplazos asociados y se notificará a los trabajadores.`,
                {
                    title: "Anular permiso",
                    tone: "danger",
                    confirmText: "Anular permiso",
                    destructive: true
                }
            );

            if (!confirmed) return;

            button.disabled = true;
            button.textContent = "Anulando...";

            try {
                const result = await undoAuditLogEntry(info.logId, {
                    source: "calendar"
                });

                if (!result?.ok) {
                    button.disabled = false;
                    button.textContent = "Anular permiso";
                    alert(
                        "No se pudo anular automaticamente. Es posible que el registro haya cambiado."
                    );
                    return;
                }

                close();
                await updateVisibleCalendarDays({
                    updateSummary: true
                });
            } catch (error) {
                console.error(error);
                button.disabled = false;
                button.textContent = "Anular permiso";
                alert("Ocurrio un error al anular el permiso.");
            }
        });

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
}

function previewDirectTurnChange(
    cell,
    nextTurn,
    date,
    holidays = {},
    options = {}
) {
    if (!cell) return;

    Object.values(TURNO_CLASS)
        .filter(Boolean)
        .forEach(className => {
            cell.classList.remove(className);
        });

    cell.classList.remove(
        "needs-extra-reason",
        "clock-extra-day",
        "clock-incident-day",
        "clock-severe-day",
        "manual-extra-day",
        "turno-split"
    );
    cell.style.removeProperty("background");

    aplicarClaseTurno(cell, nextTurn);

    if (options.manualExtra) {
        const gradient = getDayColorGradient(
            options.profileName,
            options.keyDay,
            nextTurn,
            date,
            holidays,
            null,
            options.baseTurn,
            {
                unbasedComponentsAreExtra: true,
                singleBandGradient: true
            }
        );

        cell.classList.add("manual-extra-day");

        if (gradient) {
            cell.style.setProperty(
                "background",
                gradient,
                "important"
            );
            cell.classList.add("turno-split");
        }
    }

    cell.classList.add("calendar-direct-edit-feedback");
    cell.dataset.directTurnState = String(nextTurn);

    const label = cell.querySelector(".day-label");
    if (label) {
        label.textContent = turnoLabel(nextTurn) || "";
    }

    cell.querySelectorAll(".day-badge").forEach(badge => {
        badge.remove();
    });

    window.setTimeout(() => {
        cell.classList.remove("calendar-direct-edit-feedback");
    }, 160);
}

async function linkedWorkspaceCandidates(
    profileName,
    keyDay,
    neededTurn
) {
    linkedReplacementStatus = "";

    const activeWorkspace = getActiveWorkspace();

    if (!activeWorkspace?.id) {
        linkedReplacementStatus =
            "Selecciona una unidad Firebase activa para buscar en unidades enlazadas.";
        return [];
    }

    const baseProfile = getProfiles().find(profile =>
        profile.name === profileName
    );

    if (!baseProfile) {
        linkedReplacementStatus =
            "No se encontro el perfil que requiere reemplazo.";
        return [];
    }

    const result = await findCompatibleReplacementInLinkedUnits({
        requesterWorkspaceId: activeWorkspace.id,
        date: keyToISODate(keyDay),
        turnCode: turnoToCode(neededTurn),
        targetProfile: {
            estamento: baseProfile.estamento,
            profession: baseProfile.profession
        }
    });
    const candidates = result.candidates.map(candidate => {
        const currentState =
            Number(candidate.availability.currentTurn) || TURNO.LIBRE;

        return {
            profile: {
                id: candidate.workerId,
                name: candidate.name,
                estamento: candidate.estamento,
                profession: candidate.profession,
                role: candidate.role
            },
            currentState,
            isFree: currentState === TURNO.LIBRE,
            isForced: false,
            isLinked: true,
            workspaceId: candidate.workspaceId,
            workspaceName: candidate.workspaceName || candidate.workspaceId,
            linkId: candidate.linkId,
            blockedDay: candidate.availability.blocked
                ? {
                    message:
                        "El trabajador marco esta fecha como no disponible para reemplazos."
                }
                : null,
            hheeDiurnas: 0,
            hheeNocturnas: 0,
            hhee: 0
        };
    });

    linkedReplacementStatus = result.message || (
        !candidates.length
            ? "No hay trabajadores compatibles y disponibles en las unidades enlazadas para esa fecha."
            : ""
    );

    return candidates.sort((a, b) =>
        a.workspaceName.localeCompare(b.workspaceName) ||
        a.profile.name.localeCompare(b.profile.name)
    );
}

function candidateMeta(profile) {
    const profession = profile.profession &&
        profile.profession !== "Sin informacion"
        ? ` | ${profile.profession}`
        : "";

    return `${profile.estamento || "Sin estamento"}${profession}`;
}

function formatCandidateHours(value) {
    const hours = Math.round((Number(value) || 0) * 2) / 2;

    return Number.isInteger(hours)
        ? String(hours)
        : String(hours).replace(".", ",");
}

function replacementCandidateCoverageAttrs(candidate) {
    const attrs = [];

    if (candidate.isDiurnoLongCoverage) {
        attrs.push(`data-diurno-long-coverage="true"`);
    }

    if (candidate.overtimeHours) {
        attrs.push(`data-overtime-day-hours="${Number(candidate.overtimeHours.d) || 0}"`);
        attrs.push(`data-overtime-night-hours="${Number(candidate.overtimeHours.n) || 0}"`);
    }

    return attrs.join(" ");
}

function replacementCandidateWarning(candidate) {
    if (!candidate?.blockedDay) return "";

    return candidate.blockedDay.message ||
        "El trabajador solicito no hacer reemplazos ni cambios de turno en esta fecha.";
}

function replacementCoverageFromDataset(dataset = {}) {
    const coverage = {};
    const hasCustomOvertime =
        dataset.overtimeDayHours !== undefined ||
        dataset.overtimeNightHours !== undefined;

    if (dataset.diurnoLongCoverage === "true") {
        coverage.diurnoLongCoverage = true;
    }

    if (hasCustomOvertime) {
        coverage.overtimeHours = {
            d: Number(dataset.overtimeDayHours) || 0,
            n: Number(dataset.overtimeNightHours) || 0
        };
    }

    if (
        !coverage.diurnoLongCoverage &&
        !coverage.overtimeHours
    ) {
        return {};
    }

    return coverage;
}

function getActualState(profileName, keyDay) {
    return aplicarCambiosTurno(
        profileName,
        keyDay,
        getTurnoProgramado(profileName, keyDay)
    );
}

// Etiqueta de posicion del candidato dentro del bloque consecutivo del mismo
// turno (p.ej. "Primer libre", "Segunda larga"). Cuenta hacia atras cuantos dias
// seguidos tiene el mismo estado que el dia objetivo. Solo aplica a rotativas de
// tercer y cuarto turno; en otras (diurno, etc.) devuelve "" para caer en la
// etiqueta previa.
function candidatePositionLabel(profileName, keyDay, currentState) {
    const rotationType = getRotativa(profileName).type;

    if (rotationType !== "3turno" && rotationType !== "4turno") {
        return "";
    }

    const parts = keyDay.split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    let position = 1;

    for (let back = 1; back <= 10; back++) {
        const previous = new Date(year, month, day - back);
        const previousKey =
            `${previous.getFullYear()}-${previous.getMonth()}-${previous.getDate()}`;

        if (getActualState(profileName, previousKey) !== currentState) {
            break;
        }

        position++;
    }

    return rotationPositionLabel(currentState, position);
}

// Texto de estado del candidato en la lista de reemplazos. Prioriza la posicion
// en la rotativa (3er/4to turno); el diurno se muestra como "Diurno" sin prefijo.
function candidateStateLabel(candidate, pendingRequest) {
    if (pendingRequest) return "Solicitud pendiente";
    if (candidate.positionLabel) return candidate.positionLabel;
    if (candidate.currentState === TURNO.DIURNO) return "Diurno";
    if (candidate.isFree) return "Libre ese dia";

    return `Turno actual: ${turnoReplacementLabel(candidate.currentState)}`;
}

function isHalfAdminValue(value) {
    return (
        value === "0.5M" ||
        value === "0.5T" ||
        value === 0.5
    );
}

function getHalfAdminCoverageTurn(profileName, keyDay) {
    const baseTurn = getTurnoBase(profileName, keyDay);

    if (baseTurn !== TURNO.LARGA) {
        return TURNO.LIBRE;
    }

    const admin = getJSON(`admin_${profileName}`, {});

    if (admin[keyDay] === "0.5M") {
        return TURNO.MEDIA_MANANA;
    }

    if (admin[keyDay] === "0.5T") {
        return TURNO.MEDIA_TARDE;
    }

    return TURNO.LIBRE;
}

function getReplacementNeededTurn(profileName, keyDay) {
    const admin = getJSON(`admin_${profileName}`, {});

    if (isHalfAdminValue(admin[keyDay])) {
        return getHalfAdminCoverageTurn(profileName, keyDay);
    }

    return getTurnoBase(profileName, keyDay);
}

function canCoverShift(
    currentState,
    neededTurn,
    config = getTurnChangeConfig(),
    options = {}
) {
    if (!neededTurn) return false;

    if (
        currentState === TURNO.DIURNO &&
        neededTurn === TURNO.LARGA
    ) {
        return options.allowDiurnoLongCoverage === true;
    }

    const merged = fusionarTurnos(
        currentState,
        neededTurn
    );

    if (merged === currentState) return false;

    if (
        merged === TURNO.TURNO24 &&
        config.allowTwentyFourHourShifts === false
    ) {
        return false;
    }

    return true;
}

function diurnoLongCoverageHours(date) {
    return {
        d: date.getDay() === 5 ? 4 : 3,
        n: 0
    };
}

function isHalfAdminAfternoonCoverage(profileName, keyDay, neededTurn) {
    if (neededTurn !== TURNO.MEDIA_TARDE) return false;

    const admin = getJSON(`admin_${profileName}`, {});

    return admin[keyDay] === "0.5T";
}

function halfAdminAfternoonCoverageHours(currentState, date) {
    if (
        currentState === TURNO.DIURNO ||
        currentState === TURNO.DIURNO_NOCHE
    ) {
        return diurnoLongCoverageHours(date);
    }

    return {
        d: 6,
        n: 0
    };
}

function isDiurnoLongCoverageCandidate(
    profile,
    currentState,
    neededTurn,
    date,
    holidays
) {
    return (
        getRotativa(profile.name).type === "diurno" &&
        currentState === TURNO.DIURNO &&
        neededTurn === TURNO.LARGA &&
        isBusinessDay(date, holidays)
    );
}

function getManualExtraTurn(
    profileName,
    keyDay,
    profileData
) {
    const baseWithSwaps = aplicarCambiosTurno(
        profileName,
        keyDay,
        getTurnoBase(profileName, keyDay),
        { includeReplacements: false }
    );
    const actualWithSwaps = aplicarCambiosTurno(
        profileName,
        keyDay,
        Object.prototype.hasOwnProperty.call(profileData, keyDay)
            ? Number(profileData[keyDay]) || 0
            : getTurnoBase(profileName, keyDay),
        { includeReplacements: false }
    );
    return getTurnoExtraAgregado(
        baseWithSwaps,
        actualWithSwaps
    );
}

function getPendingManualExtraTurn(
    profileName,
    keyDay,
    profileData
) {
    const extraTurn = getManualExtraTurn(
        profileName,
        keyDay,
        profileData
    );

    return restarTurnoCubierto(
        extraTurn,
        getBackedTurnForWorker(profileName, keyDay)
    );
}

function cancelManualExtraBackupsForTurnChange(
    profileName,
    keyDay,
    nextTurn
) {
    const iso = isoFromKeyDay(keyDay);
    const replacements = getReplacements();
    const now = new Date().toISOString();
    let canceledCount = 0;

    const nextReplacements = replacements.map(replacement => {
        if (
            replacement.canceled ||
            replacement.worker !== profileName ||
            replacement.date !== iso ||
            replacement.source !== "manual_extra"
        ) {
            return replacement;
        }

        canceledCount++;

        return {
            ...replacement,
            canceled: true,
            canceledAt: now,
            canceledBy: "Calendario",
            cancelReason: "manual_turn_changed"
        };
    });

    if (!canceledCount) return 0;

    saveReplacements(nextReplacements);
    addAuditLog(
        AUDIT_CATEGORY.OVERTIME,
        "Anulo respaldo de turno extra",
        `${profileName}: se quito el motivo/respaldo HHEE del ${iso} porque el turno manual fue modificado a ${turnoLabel(nextTurn) || "Libre"}.`,
        {
            profile: profileName,
            keyDay,
            date: iso,
            nextTurn,
            source: "manual_turn_changed",
            canceledCount
        }
    );

    return canceledCount;
}

async function getReplacementCandidates(
    profileName,
    keyDay,
    options = {}
) {
    const requestId = ++replacementCandidateRequest;
    const date = new Date(
        Number(keyDay.split("-")[0]),
        Number(keyDay.split("-")[1]),
        Number(keyDay.split("-")[2])
    );
    const y = date.getFullYear();
    const m = date.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const holidays = await fetchHolidays(y);
    const neededTurn =
        options.neededTurn ||
        getReplacementNeededTurn(profileName, keyDay);
    const isHalfAfternoonCoverage =
        isHalfAdminAfternoonCoverage(
            profileName,
            keyDay,
            neededTurn
        );
    const baseProfile = getProfiles().find(profile =>
        profile.name === profileName
    );
    const scope = options.scope || "compatible";

    if (scope === "linked") {
        const linked = await linkedWorkspaceCandidates(
            profileName,
            keyDay,
            neededTurn,
            {
                y,
                m,
                days,
                holidays
            }
        );

        return requestId === replacementCandidateRequest
            ? linked
            : null;
    }

    const scopeProfiles = replacementScopeProfiles(profileName, scope);
    const candidates = [];
    const progress = await runCooperativeRange(
        0,
        scopeProfiles.length - 1,
        index => {
            const profile = scopeProfiles[index];
            const currentState =
                getActualState(profile.name, keyDay);
            const isDiurnoLongCoverage =
                isDiurnoLongCoverageCandidate(
                    profile,
                    currentState,
                    neededTurn,
                    date,
                    holidays
                );
            const overtimeHours = isDiurnoLongCoverage
                ? diurnoLongCoverageHours(date)
                : isHalfAfternoonCoverage
                    ? halfAdminAfternoonCoverageHours(
                        currentState,
                        date
                    )
                    : null;
            const stats = calculateWorkerMonthTotals(
                profile.name,
                y,
                m,
                days,
                holidays,
                getProfileData(profile.name),
                {},
                { d: 0, n: 0 }
            );
            const hheeDiurnas = Number(stats.hheeDiurnas) || 0;
            const hheeNocturnas = Number(stats.hheeNocturnas) || 0;
            const blockedDay =
                getBlockedDayForProfile(profile.name, keyDay);

            candidates.push({
                profile,
                currentState,
                isFree: currentState === 0,
                positionLabel: candidatePositionLabel(
                    profile.name,
                    keyDay,
                    currentState
                ),
                isDiurnoLongCoverage,
                overtimeHours,
                isForced:
                    !profileCanCoverProfile(profile, baseProfile),
                blockedDay,
                hheeDiurnas,
                hheeNocturnas,
                hhee: hheeDiurnas + hheeNocturnas
            });
        }, {
            shouldContinue: () =>
                requestId === replacementCandidateRequest
        }
    );

    if (!progress.completed) return null;

    const eligible = candidates.filter(candidate =>
            !workerHasAbsence(candidate.profile.name, keyDay) &&
            !cededSwapTurnBlocks(
                candidate.profile.name,
                keyDay,
                neededTurn
            ) &&
            canCoverShift(
                candidate.currentState,
                neededTurn,
                getTurnChangeConfig(),
                {
                    allowDiurnoLongCoverage:
                        candidate.isDiurnoLongCoverage
                }
            )
        );
    try {
        const result = await searchReplacementsInWorker({
            mode: "turnoplus-prepared",
            candidates: eligible
        }, {
            channel: `replacement:${profileName}:${keyDay}`,
            timeoutMs: 15000
        });

        return requestId === replacementCandidateRequest
            ? result.candidates
            : null;
    } catch (error) {
        if (error?.name === "AbortError") return null;
        throw error;
    }
}

function replacementDialogHTML({
    profileName,
    keyDay,
    neededTurn,
    absenceType,
    candidates,
    scope,
    requestMode,
    pendingRequests,
    selectedRequestWorkers,
    linkedStatus = ""
}) {
    const replacementConfig = getReplacementRequestConfig();
    const allowLinkedSuggestions =
        replacementConfig.enableLinkedUnitSuggestions !== false;
    const allowCrossRoleSuggestions =
        replacementConfig.enableCrossRoleSuggestions !== false;
    const allowWorkerAcceptanceRequest =
        replacementConfig.enableWorkerAcceptanceRequest !== false;
    const forceMode =
        allowCrossRoleSuggestions && scope === "all-local";
    const linkedMode =
        allowLinkedSuggestions && scope === "linked";
    const isRequestMode =
        allowWorkerAcceptanceRequest &&
        !linkedMode &&
        requestMode;
    const pendingByWorker = new Map(
        (pendingRequests || []).map(request => [request.worker, request])
    );
    const selectedWorkers =
        selectedRequestWorkers || new Set();
    const availableWorkers = candidates
        .filter(candidate => !pendingByWorker.get(candidate.profile.name))
        .map(candidate => candidate.profile.name);
    const selectedCount = availableWorkers.filter(worker =>
        selectedWorkers.has(worker)
    ).length;
    const allSelected =
        Boolean(availableWorkers.length) &&
        selectedCount === availableWorkers.length;
    const items = candidates.length
        ? candidates.map((candidate, index) => {
            const pendingRequest =
                pendingByWorker.get(candidate.profile.name);
            const checked =
                selectedWorkers.has(candidate.profile.name);
            const warning = replacementCandidateWarning(candidate);
            const candidateHours = candidate.isLinked
                ? "<b>Disponible</b>"
                : `
                    <b>${formatCandidateHours(candidate.hhee)} HHEE</b>
                    <small class="replacement-candidate-hours">
                        D: ${formatCandidateHours(candidate.hheeDiurnas)}h · N: ${formatCandidateHours(candidate.hheeNocturnas)}h
                    </small>
                `;

            if (isRequestMode) {
                return `
                <label class="replacement-candidate replacement-candidate--request ${candidate.isForced ? "replacement-candidate--forced" : ""} ${candidate.blockedDay ? "replacement-candidate--worker-blocked" : ""} ${pendingRequest ? "is-disabled" : ""}">
                    <input
                        class="replacement-candidate-checkbox"
                        type="checkbox"
                        data-request-worker="${escapeHTML(candidate.profile.name)}"
                        ${replacementCandidateCoverageAttrs(candidate)}
                        ${checked ? "checked" : ""}
                        ${pendingRequest ? "disabled" : ""}
                    >
                    <span>
                        <strong>${escapeHTML(candidate.profile.name)}</strong>
                        <small>${escapeHTML(candidateMeta(candidate.profile))}</small>
                        ${candidate.isLinked ? `<small>Unidad: ${escapeHTML(candidate.workspaceName)}</small>` : ""}
                        <small>${escapeHTML(candidateStateLabel(candidate, pendingRequest))}</small>
                        ${warning ? `<small class="replacement-candidate-warning">${escapeHTML(warning)}</small>` : ""}
                    </span>
                    <span>
                        ${pendingRequest ? "<em>Pendiente</em>" : ""}
                        ${candidate.isLinked ? "<em>Unidad enlazada</em>" : ""}
                        ${candidate.isForced ? "<em>Forzado</em>" : ""}
                        ${candidate.blockedDay ? "<em>Dia bloqueado</em>" : ""}
                        ${candidateHours}
                    </span>
                </label>
                `;
            }

            const previousCandidate = candidates[index - 1];
            const unitHeading = candidate.isLinked && (
                !previousCandidate?.isLinked ||
                previousCandidate.workspaceId !== candidate.workspaceId
            )
                ? `
                    <div class="replacement-candidate-group-title">
                        ${escapeHTML(candidate.workspaceName || "Unidad enlazada")}
                    </div>
                `
                : "";

            return `
            ${unitHeading}
            <button
                class="replacement-candidate ${candidate.isForced ? "replacement-candidate--forced" : ""} ${candidate.isLinked ? "replacement-candidate--linked" : ""} ${candidate.blockedDay ? "replacement-candidate--worker-blocked" : ""} ${pendingRequest ? "is-disabled" : ""}"
                type="button"
                data-worker="${escapeHTML(candidate.profile.name)}"
                data-worker-profile-id="${escapeHTML(candidate.profile.id || "")}"
                data-worker-workspace-id="${escapeHTML(candidate.workspaceId || "")}"
                data-worker-workspace-name="${escapeHTML(candidate.workspaceName || "")}"
                data-worker-link-id="${escapeHTML(candidate.linkId || "")}"
                ${replacementCandidateCoverageAttrs(candidate)}
                ${pendingRequest ? "disabled" : ""}
            >
                <span>
                    <strong>${escapeHTML(candidate.profile.name)}</strong>
                    <small>${escapeHTML(candidateMeta(candidate.profile))}</small>
                    ${candidate.isLinked ? `<small>Unidad: ${escapeHTML(candidate.workspaceName)}</small>` : ""}
                    <small>${escapeHTML(candidateStateLabel(candidate, pendingRequest))}</small>
                    ${warning ? `<small class="replacement-candidate-warning">${escapeHTML(warning)}</small>` : ""}
                </span>
                <span>
                    ${pendingRequest ? "<em>Pendiente</em>" : ""}
                    ${candidate.isLinked ? "<em>Unidad enlazada</em>" : ""}
                    ${candidate.isForced ? "<em>Forzado</em>" : ""}
                    ${candidate.blockedDay ? "<em>Dia bloqueado</em>" : ""}
                    ${candidateHours}
                </span>
            </button>
            `;
        }).join("")
        : `
            <div class="empty-state empty-state--compact">
                ${escapeHTML(
                    linkedMode && linkedStatus
                        ? linkedStatus
                        : "No hay trabajadores disponibles para este reemplazo."
                )}
            </div>
        `;
    const pendingList = (pendingRequests || []).length
        ? `
            <div class="replacement-request-list">
                ${(pendingRequests || []).map(request => `
                    <article class="replacement-request-item">
                        <span>
                            <strong>${escapeHTML(request.worker)}</strong>
                            <small>Caduca: ${escapeHTML(new Date(request.expiresAt).toLocaleString("es-CL"))}</small>
                        </span>
                        <button class="ghost-button" type="button" data-cancel-request="${escapeHTML(request.id)}">
                            Anular
                        </button>
                    </article>
                `).join("")}
            </div>
        `
        : "";
    const bulkActions = isRequestMode
        ? `
            <div class="replacement-bulk-actions">
                <label>
                    <input type="checkbox" data-action="select-all-requests" ${allSelected ? "checked" : ""} ${availableWorkers.length ? "" : "disabled"}>
                    <span>Enviar solicitud a todos</span>
                </label>
                <button class="primary-button" type="button" data-action="send-selected-requests" ${selectedCount ? "" : "disabled"}>
                    Enviar a seleccionados (${selectedCount})
                </button>
            </div>
        `
        : "";
    const toolbarButtons = [
        allowCrossRoleSuggestions
            ? `
                <button class="secondary-button" type="button" data-action="toggle-force">
                    ${forceMode
                        ? "Volver a profesiones/estamentos compatibles"
                        : "Mostrar personal de otras profesiones y/o estamentos"
                    }
                </button>
            `
            : "",
        allowLinkedSuggestions
            ? `
                <button class="ghost-button" type="button" data-action="linked-units">
                    ${linkedMode
                        ? "Volver a personal de esta unidad"
                        : "Buscar reemplazo compatible en unidades enlazadas"
                    }
                </button>
            `
            : ""
    ].filter(Boolean).join("");

    return `
        <div class="turn-change-dialog replacement-dialog" role="dialog" aria-modal="true" aria-labelledby="replacementDialogTitle">
            <strong id="replacementDialogTitle">Seleccionar reemplazo</strong>
            <p>
                ${escapeHTML(profileName)} requiere cobertura para ${escapeHTML(turnoReplacementLabel(neededTurn))}
                por ${escapeHTML(absenceType)}.
            </p>
            ${toolbarButtons ? `
                <div class="replacement-dialog-toolbar">
                    ${toolbarButtons}
                </div>
            ` : ""}
            ${linkedMode ? `
                <div class="replacement-dialog-note">
                    Sugerencias de unidades enlazadas activas: se muestran trabajadores compatibles y disponibles segun su unidad. Al asignar, se registra como prestamo en ambas unidades.
                </div>
            ` : allowWorkerAcceptanceRequest ? `
            <label class="replacement-request-toggle">
                <input type="checkbox" data-action="request-mode" ${isRequestMode ? "checked" : ""}>
                <span>
                    <strong>Solicitar aceptacion al trabajador</strong>
                </span>
            </label>
            ` : ""}
            ${bulkActions}
            ${pendingList}
            ${forceMode ? `
                <div class="replacement-dialog-note">
                    Modo forzado activo: se muestran trabajadores disponibles aunque no coincidan por profesion o estamento.
                </div>
            ` : ""}
            <div class="replacement-candidate-list">
                ${items}
            </div>
            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="cancel">
                    Cancelar
                </button>
            </div>
        </div>
    `;
}

async function openReplacementDialog(profileName, keyDay) {
    const existing = getReplacementForCoveredShift(
        profileName,
        keyDay
    );

    if (existing || window.selectionMode) {
        return;
    }

    const neededTurn = getReplacementNeededTurn(
        profileName,
        keyDay
    );

    if (!neededTurn) {
        return;
    }

    const absenceType =
        getAbsenceLabelForProfileDate(profileName, keyDay);
    let scope = "compatible";
    let requestMode = false;
    let selectedRequestWorkers = new Set();
    const normalizeReplacementDialogState = () => {
        const replacementConfig = getReplacementRequestConfig();

        if (
            scope === "linked" &&
            replacementConfig.enableLinkedUnitSuggestions === false
        ) {
            scope = "compatible";
        }

        if (
            scope === "all-local" &&
            replacementConfig.enableCrossRoleSuggestions === false
        ) {
            scope = "compatible";
        }

        if (
            scope === "linked" ||
            replacementConfig.enableWorkerAcceptanceRequest === false
        ) {
            requestMode = false;
            selectedRequestWorkers = new Set();
        }
    };
    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";

    const saveLinkedUnitReplacement = async button => {
        const workerWorkspaceId =
            button.dataset.workerWorkspaceId || "";
        const workerWorkspaceName =
            button.dataset.workerWorkspaceName || "";
        const workerProfileId =
            button.dataset.workerProfileId || "";
        const linkId = button.dataset.workerLinkId || "";
        const worker = button.dataset.worker || "";
        const activeWorkspace = getActiveWorkspace();
        const replacedProfile = getProfiles().find(profile =>
            profile.name === profileName
        );

        if (
            !workerWorkspaceId ||
            !workerProfileId ||
            !worker ||
            !activeWorkspace?.id
        ) {
            throw new Error(
                "No se pudo identificar la unidad enlazada del trabajador."
            );
        }

        const result = await createInterUnitLoan({
            linkId,
            sourceWorkspaceId: workerWorkspaceId,
            hostWorkspaceId: activeWorkspace?.id || "",
            workerProfileId,
            replacedProfileId: replacedProfile?.id || "",
            replacedProfileName: profileName,
            targetEstamento: replacedProfile?.estamento || "",
            targetProfession: replacedProfile?.profession || "",
            date: keyToISODate(keyDay),
            turnCode: turnoToCode(neededTurn),
            absenceType,
        });

        saveReplacement({
            id: `interunit_${result.loanId}`,
            interUnitLoanId: result.loanId,
            worker,
            replaced: profileName,
            keyDay,
            turno: neededTurn,
            absenceType,
            source: "inter_unit_loan",
            isLoan: true,
            workerWorkspaceId,
            workerWorkspaceName,
            hostWorkspaceId: activeWorkspace?.id || "",
            hostWorkspaceName: activeWorkspace?.name || "",
        });
    };

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };

    const onKeydown = event => {
        if (event.key === "Escape") {
            close();
        }
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) {
            close();
        }
    });

    const bindActions = () => {
        backdrop
            .querySelector("[data-action='cancel']")
            .onclick = close;

        const toggleForceButton =
            backdrop.querySelector("[data-action='toggle-force']");
        if (toggleForceButton) {
            toggleForceButton.onclick = async () => {
                scope = scope === "all-local"
                    ? "compatible"
                    : "all-local";
                await renderContent();
            };
        }

        const linkedUnitsButton =
            backdrop.querySelector("[data-action='linked-units']");
        if (linkedUnitsButton) {
            linkedUnitsButton.onclick = async () => {
                scope = scope === "linked"
                    ? "compatible"
                    : "linked";
                requestMode = false;
                selectedRequestWorkers = new Set();
                await renderContent();
            };
        }

        const requestToggle =
            backdrop.querySelector("[data-action='request-mode']");
        if (requestToggle) {
            requestToggle.onchange = async () => {
                requestMode = requestToggle.checked;
                selectedRequestWorkers = new Set();
                await renderContent();
            };
        }

        const updateBulkControls = () => {
            const inputs = [
                ...backdrop.querySelectorAll("[data-request-worker]")
            ];
            const availableInputs = inputs.filter(input =>
                !input.disabled
            );
            const selectedCount = availableInputs.filter(input =>
                input.checked
            ).length;
            const selectAll =
                backdrop.querySelector("[data-action='select-all-requests']");
            const sendButton =
                backdrop.querySelector("[data-action='send-selected-requests']");

            if (selectAll) {
                selectAll.checked =
                    Boolean(availableInputs.length) &&
                    selectedCount === availableInputs.length;
            }

            if (sendButton) {
                sendButton.disabled = selectedCount === 0;
                sendButton.textContent =
                    `Enviar a seleccionados (${selectedCount})`;
            }
        };

        backdrop
            .querySelectorAll("[data-request-worker]")
            .forEach(input => {
                input.onchange = () => {
                    if (input.checked) {
                        selectedRequestWorkers.add(
                            input.dataset.requestWorker
                        );
                    } else {
                        selectedRequestWorkers.delete(
                            input.dataset.requestWorker
                        );
                    }

                    updateBulkControls();
                };
            });

        const selectAllRequests =
            backdrop.querySelector("[data-action='select-all-requests']");
        if (selectAllRequests) {
            selectAllRequests.onchange = () => {
                backdrop
                    .querySelectorAll("[data-request-worker]")
                    .forEach(input => {
                        if (input.disabled) return;

                        input.checked = selectAllRequests.checked;

                        if (input.checked) {
                            selectedRequestWorkers.add(
                                input.dataset.requestWorker
                            );
                        } else {
                            selectedRequestWorkers.delete(
                                input.dataset.requestWorker
                            );
                        }
                    });

                updateBulkControls();
            };
        }

        const sendSelectedRequests =
            backdrop.querySelector("[data-action='send-selected-requests']");
        if (sendSelectedRequests) {
            sendSelectedRequests.onclick = async () => {
                const selectedInputs = [
                    ...backdrop.querySelectorAll("[data-request-worker]")
                ].filter(input =>
                    input.checked &&
                    selectedRequestWorkers.has(
                        input.dataset.requestWorker
                    )
                );
                const workers = selectedInputs.map(input =>
                    input.dataset.requestWorker
                );
                const diurnoLongInputs = selectedInputs.filter(input =>
                    input.dataset.diurnoLongCoverage === "true"
                );
                const workerCoverage = Object.fromEntries(
                    selectedInputs.map(input => [
                        input.dataset.requestWorker,
                        replacementCoverageFromDataset(input.dataset)
                    ])
                );

                if (!workers.length) {
                    alert("Selecciona al menos un trabajador para enviar la solicitud.");
                    return;
                }

                if (typeof window.pushUndoState === "function") {
                    window.pushUndoState("Crear solicitud masiva de reemplazo");
                }

                const requests = createReplacementRequests(
                    {
                        replaced: profileName,
                        keyDay,
                        turno: neededTurn,
                        absenceType,
                        scope,
                        source: scope === "all-local"
                            ? "forced_replacement_request"
                            : "replacement_request",
                        diurnoLongCoverageWorkers:
                            diurnoLongInputs.map(input =>
                                input.dataset.requestWorker
                            ),
                        diurnoLongCoverageHours:
                            replacementCoverageFromDataset(
                                diurnoLongInputs[0]?.dataset
                            ).overtimeHours,
                        workerCoverage
                    },
                    workers
                );
                const whatsappRequests = requests.filter(request =>
                    request.channel === "whatsapp"
                );
                const missingPhones = whatsappRequests.filter(request =>
                    !buildReplacementRequestWhatsAppUrl(request)
                );

                whatsappRequests
                    .map(buildReplacementRequestWhatsAppUrl)
                    .filter(Boolean)
                    .forEach(url => {
                        window.open(url, "_blank", "noopener");
                    });

                if (missingPhones.length) {
                    alert(
                        `${missingPhones.length} solicitud(es) quedaron pendientes, pero sin celular registrado para preparar WhatsApp.`
                    );
                }

                selectedRequestWorkers = new Set();
                await renderContent();
            };
        }

        backdrop
            .querySelectorAll("[data-cancel-request]")
            .forEach(button => {
                button.onclick = async () => {
                    cancelReplacementRequest(
                        button.dataset.cancelRequest,
                        "admin"
                    );
                    await renderContent();
                };
            });

        backdrop
            .querySelectorAll("[data-worker]")
            .forEach(button => {
                button.onclick = async () => {
                    if (button.disabled) return;

                    await withBusyState(async () => {
                        if (typeof window.pushUndoState === "function") {
                            window.pushUndoState(
                                requestMode
                                    ? "Crear solicitud de reemplazo"
                                    : "Asignar reemplazo"
                            );
                        }

                        if (
                            requestMode &&
                            getReplacementRequestConfig()
                                .enableWorkerAcceptanceRequest !== false
                        ) {
                            const request = createReplacementRequest({
                                worker: button.dataset.worker,
                                replaced: profileName,
                                keyDay,
                                turno: neededTurn,
                                absenceType,
                                scope,
                                source: scope === "all-local"
                                    ? "forced_replacement_request"
                                    : "replacement_request",
                                ...replacementCoverageFromDataset(
                                    button.dataset
                                )
                            });
                            const whatsappUrl =
                                buildReplacementRequestWhatsAppUrl(request);

                            if (request.channel === "whatsapp") {
                                if (whatsappUrl) {
                                    window.open(
                                        whatsappUrl,
                                        "_blank",
                                        "noopener"
                                    );
                                } else {
                                    alert(
                                        "La solicitud quedo pendiente, pero este trabajador no tiene celular registrado para preparar el WhatsApp."
                                    );
                                }
                            }

                            await renderContent();
                            return;
                        }

                        if (button.dataset.workerWorkspaceId) {
                            await saveLinkedUnitReplacement(button);
                        } else {
                            saveReplacement({
                                worker: button.dataset.worker,
                                replaced: profileName,
                                keyDay,
                                turno: neededTurn,
                                absenceType,
                                source: scope === "all-local"
                                    ? "forced_replacement"
                                    : "replacement",
                                ...replacementCoverageFromDataset(
                                    button.dataset
                                )
                            });
                        }

                        close();
                        await updateDayCell(profileName, keyDay);

                        // Actualiza solo las casillas afectadas del timeline (el
                        // trabajador ausente y quien lo cubre) sin reconstruirlo.
                        const coveringWorker = button.dataset.worker;

                        if (
                            coveringWorker &&
                            coveringWorker !== profileName
                        ) {
                            await updateDayCell(coveringWorker, keyDay);
                        }

                        updateTimelineCells(profileName, [keyDay]);

                        if (coveringWorker) {
                            updateTimelineCells(coveringWorker, [keyDay]);
                        }
                    }, {
                        label: requestMode
                            ? "Creando solicitud..."
                            : "Guardando reemplazo..."
                    });
                };
            });
    };

    const renderContent = async () => withBusyState(async () => {
        normalizeReplacementDialogState();
        expireReplacementRequests();

        const candidates =
            await getReplacementCandidates(
                profileName,
                keyDay,
                { scope }
            );
        if (!candidates) return;
        const pendingRequests =
            getPendingReplacementRequestsForShift(
                profileName,
                keyDay,
                neededTurn
            );
        const pendingWorkers = new Set(
            pendingRequests.map(request => request.worker)
        );
        const selectableWorkers = new Set(
            candidates
                .map(candidate => candidate.profile.name)
                .filter(worker => !pendingWorkers.has(worker))
        );

        selectedRequestWorkers = new Set(
            [...selectedRequestWorkers].filter(worker =>
                selectableWorkers.has(worker)
            )
        );

        backdrop.innerHTML = replacementDialogHTML({
            profileName,
            keyDay,
            neededTurn,
            absenceType,
            candidates,
            scope,
            requestMode,
            pendingRequests,
            selectedRequestWorkers,
            linkedStatus: scope === "linked"
                ? linkedReplacementStatus
                : ""
        });

        bindActions();

        (
            backdrop.querySelector(".replacement-candidate") ||
            backdrop.querySelector("[data-action='cancel']")
        )?.focus();
    }, {
        label: "Calculando sugerencias..."
    });

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
    await renderContent();
}

window.openReplacementDialog = openReplacementDialog;

function getExtraReasonMatches(
    profileName,
    keyDay,
    pendingTurn
) {
    return sameRoleProfiles(profileName)
        .map(profile => {
            const coveredTurn = getReplacementNeededTurn(
                profile.name,
                keyDay
            );

            return {
                profile,
                coveredTurn,
                absenceType:
                    getAbsenceLabelForProfileDate(
                        profile.name,
                        keyDay
                    ),
                exactMatch:
                    Number(coveredTurn) === Number(pendingTurn)
            };
        })
        .filter(match =>
            workerHasAbsence(match.profile.name, keyDay) &&
            !getReplacementForCoveredShift(
                match.profile.name,
                keyDay
            ) &&
            turnoExtraCubreTurno(
                pendingTurn,
                match.coveredTurn
            )
        )
        .sort((a, b) => {
            if (a.exactMatch !== b.exactMatch) {
                return a.exactMatch ? -1 : 1;
            }

            return a.profile.name.localeCompare(b.profile.name);
        });
}

function getManualBackupSections(pendingTurn, matchesByTurn) {
    return getTurnoComponentes(pendingTurn)
        .map(component => {
            const turn = turnoDesdeComponentes([component]);

            return {
                id: component,
                turn,
                label: turnoReplacementLabel(turn),
                matches: matchesByTurn.get(turn) || []
            };
        })
        .filter(section => section.turn);
}

function formatClockHoursForDialog(hours) {
    const d = Math.round((Number(hours?.d) || 0) * 2) / 2;
    const n = Math.round((Number(hours?.n) || 0) * 2) / 2;
    const parts = [];

    if (d) parts.push(`${d}h diurnas`);
    if (n) parts.push(`${n}h nocturnas`);

    return parts.length ? parts.join(" / ") : "0h";
}

function extraReasonDialogHTML({
    profileName,
    pendingTurn,
    manualSections,
    clockHours,
    hasClockSection
}) {
    const hasManualSection = Boolean(pendingTurn);
    const hasMultipleManualSections =
        (manualSections || []).length > 1;
    const savesMultipleBackups =
        hasMultipleManualSections ||
        (hasClockSection && hasManualSection);
    const manualItems = (manualSections || [])
        .map(section => {
            const items = section.matches.length
                ? section.matches.map((match, index) => `
                    <button
                        class="replacement-candidate"
                        type="button"
                        data-section-id="${escapeHTML(section.id)}"
                        data-match-index="${index}"
                    >
                        <span>
                            <strong>${escapeHTML(match.profile.name)}</strong>
                            <small>${escapeHTML(match.absenceType)} | ${escapeHTML(turnoReplacementLabel(match.coveredTurn))}</small>
                        </span>
                        <span>${match.exactMatch ? "Coincide" : "Parcial"}</span>
                    </button>
                `).join("")
                : `
                    <div class="empty-state empty-state--compact">
                        No hay vacaciones o licencias compatibles con este tramo.
                    </div>
                `;

            return `
                <div class="overtime-backup-subsection" data-manual-section="${escapeHTML(section.id)}">
                    <div class="overtime-backup-subsection__head">
                        <span>${escapeHTML(section.label)}</span>
                    </div>
                    <div class="replacement-candidate-list">
                        ${items}
                    </div>
                    <label class="extra-reason-field">
                        <span>Motivo manual para ${escapeHTML(section.label)}</span>
                        <textarea rows="3" data-manual-reason="${escapeHTML(section.id)}" placeholder="Ej: Campana de Invierno, Estacion de Trabajo"></textarea>
                    </label>
                </div>
            `;
        })
        .join("");
    const clockSection = hasClockSection
        ? `
            <section class="overtime-backup-section" data-section="clock">
                <div class="overtime-backup-section__head">
                    <span>Horas por marcaje modificado</span>
                    <small>${formatClockHoursForDialog(clockHours)}</small>
                </div>
                <p>
                    Respalda las horas extras generadas por modificar la entrada
                    o salida del turno.
                </p>
                <label class="extra-reason-field">
                    <span>Motivo del marcaje</span>
                    <textarea rows="3" data-clock-reason placeholder="Ej: Apoyo previo al turno, continuidad de atencion, emergencia del servicio"></textarea>
                </label>
            </section>
        `
        : "";
    const manualSection = hasManualSection
        ? `
            <section class="overtime-backup-section" data-section="manual">
                <div class="overtime-backup-section__head">
                    <span>Turno extra agregado</span>
                    <small>${turnoReplacementLabel(pendingTurn)}</small>
                </div>
                <p>
                    Puedes asociar cada tramo a una ausencia compatible o escribir
                    un motivo manual por separado.
                </p>
                ${manualItems}
            </section>
        `
        : "";

    return `
        <div class="turn-change-dialog replacement-dialog extra-reason-dialog overtime-backup-dialog" role="dialog" aria-modal="true" aria-labelledby="extraReasonDialogTitle">
            <strong id="extraReasonDialogTitle">Respaldar horas extras</strong>
            <p>
                ${profileName} tiene horas extras pendientes de respaldo.
                Completa ${savesMultipleBackups ? "las secciones" : "el motivo"} para validar el pago.
            </p>
            ${clockSection}
            ${manualSection}
            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="cancel">
                    Cancelar
                </button>
                <button class="primary-button" type="button" data-action="save-reason">
                    ${savesMultipleBackups ? "Guardar respaldos" : "Guardar motivo"}
                </button>
            </div>
        </div>
    `;
}

async function openExtraReasonDialog(
    profileName,
    keyDay,
    pendingTurn,
    options = {}
) {
    if ((!pendingTurn && !options.forceClock) || window.selectionMode) {
        return;
    }

    const profileData = getProfileData(profileName);
    const actualState = options.state ||
        aplicarCambiosTurno(
            profileName,
            keyDay,
            getTurnoProgramado(profileName, keyDay)
        );
    const [year, month, day] = String(keyDay)
        .split("-")
        .map(Number);
    const date = new Date(year, month, day);
    const holidays = await fetchHolidays(year);
    const hasClockSection =
        hasClockExtra(
            profileName,
            keyDay,
            date,
            actualState,
            holidays
        ) &&
        !getClockExtraBackupForWorker(profileName, keyDay);
    const clockHours = hasClockSection
        ? getClockExtraHours(
            profileName,
            keyDay,
            date,
            actualState,
            holidays
        )
        : null;

    if (!pendingTurn && !hasClockSection) {
        return;
    }

    const matchesByTurn = new Map();
    const manualSections = pendingTurn
        ? getManualBackupSections(pendingTurn, matchesByTurn)
        : [];

    if (pendingTurn) {
        manualSections.forEach(section => {
            const matches = getExtraReasonMatches(
                profileName,
                keyDay,
                section.turn
            );

            matchesByTurn.set(section.turn, matches);
            section.matches = matches;
        });
    }

    const backdrop = document.createElement("div");
    const selectedMatches = new Map();

    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = extraReasonDialogHTML({
        profileName,
        pendingTurn,
        manualSections,
        clockHours,
        hasClockSection
    });

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };

    const onKeydown = event => {
        if (event.key === "Escape") {
            close();
        }
    };

    const saveBackups = async () => {
        const clockReason = backdrop
            .querySelector("[data-clock-reason]")
            ?.value
            .trim() || "";
        const manualBackups = manualSections.map(section => {
            const selectedIndex = selectedMatches.get(section.id);
            const selectedMatch = selectedIndex !== undefined
                ? section.matches[selectedIndex]
                : null;
            const reason = backdrop
                .querySelector(`[data-manual-reason="${section.id}"]`)
                ?.value
                .trim() || "";

            return {
                section,
                selectedMatch,
                reason
            };
        });
        const missingManualBackup = manualBackups.find(backup =>
            !backup.selectedMatch && !backup.reason
        );

        if (hasClockSection && !clockReason) {
            alert("Indica el motivo de las horas extras generadas por el marcaje.");
            backdrop.querySelector("[data-clock-reason]")?.focus();
            return;
        }

        if (pendingTurn && missingManualBackup) {
            alert(`Selecciona una ausencia compatible o escribe el motivo del turno ${missingManualBackup.section.label}.`);
            backdrop
                .querySelector(`[data-manual-reason="${missingManualBackup.section.id}"]`)
                ?.focus();
            return;
        }

        if (typeof window.pushUndoState === "function") {
            window.pushUndoState("Respaldar horas extras");
        }

        if (hasClockSection) {
            saveReplacement({
                worker: profileName,
                keyDay,
                turno: actualState,
                reason: clockReason,
                absenceType: "Marcaje reloj control",
                source: "clock_extra",
                addsShift: false,
                clockLabel: "Marcaje reloj control",
                clockHours
            });
        }

        manualBackups.forEach(backup => {
            saveReplacement({
                worker: profileName,
                keyDay,
                turno: backup.selectedMatch
                    ? backup.selectedMatch.coveredTurn
                    : backup.section.turn,
                replaced: backup.selectedMatch?.profile.name || "",
                reason: backup.selectedMatch ? "" : backup.reason,
                absenceType: backup.selectedMatch
                    ? backup.selectedMatch.absenceType
                    : "Motivo manual",
                source: "manual_extra",
                addsShift: false
            });
        });

        close();
        await updateDayCell(profileName, keyDay);
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) {
            close();
        }
    });

    backdrop
        .querySelector("[data-action='cancel']")
        .onclick = close;

    backdrop
        .querySelectorAll("[data-match-index]")
        .forEach(button => {
            button.onclick = () => {
                const sectionId = button.dataset.sectionId;

                selectedMatches.set(
                    sectionId,
                    Number(button.dataset.matchIndex)
                );

                backdrop
                    .querySelectorAll(
                        `[data-match-index][data-section-id="${sectionId}"]`
                    )
                    .forEach(item => {
                        const selected =
                            Number(item.dataset.matchIndex) ===
                            selectedMatches.get(sectionId);

                        item.classList.toggle("is-selected", selected);
                        item.setAttribute(
                            "aria-pressed",
                            selected ? "true" : "false"
                        );
                    });

                const manualTextarea = backdrop
                    .querySelector(`[data-manual-reason="${sectionId}"]`);

                if (manualTextarea) {
                    manualTextarea.value = "";
                }
            };
        });

    backdrop
        .querySelectorAll("[data-manual-reason]")
        .forEach(textarea => {
            textarea.addEventListener("input", event => {
                if (!event.target.value.trim()) return;

                const sectionId = event.target.dataset.manualReason;

                selectedMatches.delete(sectionId);
                backdrop
                    .querySelectorAll(
                        `[data-match-index][data-section-id="${sectionId}"]`
                    )
                    .forEach(item => {
                        item.classList.remove("is-selected");
                        item.setAttribute("aria-pressed", "false");
                    });
            });
        });

    backdrop
        .querySelector("[data-action='save-reason']")
        .onclick = saveBackups;

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);

    (
        backdrop.querySelector("[data-clock-reason]") ||
        backdrop.querySelector("[data-match-index]") ||
        backdrop.querySelector("[data-manual-reason]")
    )?.focus();
}

window.openExtraReasonDialog = openExtraReasonDialog;

async function openClockExtraReasonDialog(
    profileName,
    keyDay,
    state
) {
    return openExtraReasonDialog(profileName, keyDay, 0, {
        forceClock: true,
        state
    });
}

window.openClockExtraReasonDialog = openClockExtraReasonDialog;

async function clickDia(
    keyDay,
    isHab,
    admin,
    legal,
    comp,
    absences,
    options = {}
) {
    if (
        typeof window.workspaceCanEditTarget === "function" &&
        !window.workspaceCanEditTarget("calendarPanel")
    ) {
        return true;
    }

    const profileName = getCurrentProfile();

    if (!isProfileActive(profileName)) {
        alert("Este perfil esta desactivado. Reactivalo desde Perfil para modificar su calendario.");
        return true;
    }

    const turnChange =
        getCambioTurnoCalendario(profileName, keyDay)?.swap;

    if (turnChange) {
        return handleTurnChangeDayClick(turnChange);
    }

    if (window.selectionMode === "halfadmin") return;
    if (window.selectionMode) return;

    const replacementNeededTurn =
        getReplacementNeededTurn(profileName, keyDay);
    const needsReplacement =
        Boolean(replacementNeededTurn) &&
        requiereReemplazoTurnoBase(
            keyDay,
            getTurnoBase(profileName, keyDay),
            admin,
            legal,
            comp,
            absences
        ) &&
        !getReplacementForCoveredShift(
            profileName,
            keyDay
        );

    if (needsReplacement) {
        return openReplacementDialog(
            profileName,
            keyDay
        );
    }

    if (
        tieneAusencia(
            keyDay,
            admin,
            legal,
            comp,
            absences
        )
    ) {
        openLeaveDetailDialog({
            profile: profileName,
            keyDay,
            admin,
            legal,
            comp,
            absences
        });
        return;
    }

    const directEditEnabled =
        typeof window.calendarDirectEditEnabled === "function"
            ? window.calendarDirectEditEnabled()
            : true;

    if (!directEditEnabled) {
        return;
    }

    const baseTurno = getTurnoBase(
        profileName,
        keyDay
    );
    const previewState = Number(
        options.cell?.dataset.directTurnState
    );
    const currentState = Number.isFinite(previewState)
        ? previewState
        : getActualState(profileName, keyDay);
    const nuevo = siguienteTurnoValido(
        profileName,
        keyDay,
        currentState,
        isHab,
        {
            baseTurno
        }
    );
    const effectiveBaseTurn = aplicarCambiosTurno(
        profileName,
        keyDay,
        baseTurno,
        { includeReplacements: false }
    );
    const manualExtra = Boolean(
        getShiftAssigned(
            profileName,
            options.date || dateFromKeyDay(keyDay)
        ) &&
        getTurnoExtraAgregado(effectiveBaseTurn, nuevo)
    );

    previewDirectTurnChange(
        options.cell,
        nuevo,
        options.date || dateFromKeyDay(keyDay),
        options.holidays || {},
        {
            profileName,
            keyDay,
            baseTurn: effectiveBaseTurn,
            manualExtra
        }
    );

    keepCalendarDirectEditHistoryOpen(
        `Edicion directa de turnos desde ${keyDay}`
    );
    if (Number(nuevo) !== Number(currentState)) {
        cancelManualExtraBackupsForTurnChange(
            profileName,
            keyDay,
            nuevo
        );
    }
    saveProfileDayTurn(keyDay, nuevo, profileName);
    scheduleCalendarAuditLog({
        profile: profileName,
        keyDay,
        previousTurn: currentState,
        nextTurn: nuevo
    });
    scheduleCalendarDirectEditRefresh(keyDay);
}

async function renderCalendarImpl(options = {}) {
    if (
        calendarDirectEditRefreshTimer &&
        options.allowDuringDirectEdit !== true
    ) {
        return;
    }

    const cal = document.getElementById("calendar");
    const monthYear = document.getElementById("monthYear");
    const renderRequest = ++calendarRenderRequest;

    if (!cal) return;

    ensureCalendarDelegation(cal);

    const calendarPanel = cal.closest(".calendar-panel");
    const activeProfile = getCurrentProfile();
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    const days =
        new Date(y, m + 1, 0).getDate();
    const rawRequestedKeys = new Set(
        Array.isArray(options.changedKeys)
            ? options.changedKeys
            : []
    );
    const largePartialRefresh = Boolean(
        rawRequestedKeys.size >= Math.max(
            CALENDAR_LARGE_PARTIAL_MIN_DAYS,
            Math.ceil(days * CALENDAR_LARGE_PARTIAL_RATIO)
        ) &&
        lastCalendarView?.calendar === cal &&
        lastCalendarView?.workerId === resolveWorkerId(activeProfile) &&
        lastCalendarView?.year === y &&
        lastCalendarView?.month === m
    );
    const effectiveOptions = largePartialRefresh
        ? {
            ...options,
            changedKeys: undefined,
            deferHeavy: true,
            updateSummary: false
        }
        : options;
    const cachedWorkers = getAppState().workers;
    const workers =
        Array.isArray(effectiveOptions.changedKeys) && cachedWorkers.length
            ? cachedWorkers
            : getProfiles();
    const activeWorker = workers.find(worker =>
        worker.name === activeProfile
    ) || null;
    const activeWorkerId = String(
        activeWorker?.id || resolveWorkerId(activeProfile)
    );
    const activeProfileEnabled =
        isProfileActive(activeWorker || activeProfile);
    const monthKey = calendarMonthKey(y, m);
    const viewSignature = activeProfile
        ? calendarViewSignature({
            workerId: activeWorkerId,
            profileName: activeProfile,
            year: y,
            month: m,
            activeProfileEnabled
        })
        : "";
    const cacheKey = viewSignature
        ? calendarCacheKey(viewSignature)
        : "";
    const requestedKeys = new Set(
        Array.isArray(effectiveOptions.changedKeys)
            ? effectiveOptions.changedKeys
            : []
    );
    const partialRender = Boolean(
        requestedKeys.size &&
        lastCalendarView?.calendar === cal &&
        lastCalendarView?.workerId === activeWorkerId &&
        lastCalendarView?.year === y &&
        lastCalendarView?.month === m
    );

    if (partialRender && effectiveOptions.modeRefresh === true) {
        cal.dataset.calendarState = "refreshing-mode";
        cal.setAttribute("aria-busy", "true");
    }

    if (!partialRender) {
        syncWorkersState(workers);
        cal.classList.remove("has-multiple-badge-days");
        calendarPanel?.classList.remove("has-multiple-badge-days");
    }

    if (monthYear && !partialRender) {
        monthYear.innerText = currentDate.toLocaleString(
            "es-CL",
            {
                month: "long",
                year: "numeric"
            }
        );
        setupCalendarMonthPicker(monthYear);
    }

    const first =
        (new Date(y, m, 1).getDay() + 6) % 7;
    const draftKey =
        typeof window.getProfileDraftSelectionKey === "function"
            ? window.getProfileDraftSelectionKey()
            : "";
    const cachedCalendar =
        !partialRender &&
        activeProfile &&
        !effectiveOptions.skipCache
            ? readCalendarCache(cacheKey, {
                viewSignature,
                monthKey,
                workerId: activeWorkerId
            })
            : null;

    if (cachedCalendar) {
        activateCalendarCache(cal, cachedCalendar, {
            calendarPanel,
            workerId: activeWorkerId,
            profileName: activeProfile,
            year: y,
            month: m,
            days,
            cacheKey,
            viewSignature,
            monthKey
        });
        if (effectiveOptions.backgroundFresh === true) {
            scheduleCalendarBackgroundFreshRender({
                ...effectiveOptions,
                navigationRequest: effectiveOptions.navigationRequest,
                cached: true
            });
            return {
                cached: true,
                backgroundFresh: true
            };
        }
    } else if (!partialRender) {
        cal.dataset.calendarState = "loading";
        cal.setAttribute("aria-busy", "true");

        if (effectiveOptions.backgroundFresh === true) {
            showCalendarBackgroundPending(cal, {
                workerId: activeWorkerId,
                profileName: activeProfile,
                year: y,
                month: m,
                days,
                cacheKey,
                viewSignature,
                monthKey
            });
            scheduleCalendarBackgroundFreshRender({
                ...effectiveOptions,
                navigationRequest: effectiveOptions.navigationRequest,
                cached: false
            });
            return {
                cached: false,
                backgroundFresh: true
            };
        }
    }

    if (cachedCalendar) {
        await waitCalendarIdle(120);
    }

    const holidays = await fetchHolidays(y);

    if (renderRequest !== calendarRenderRequest) return;

    const fragment = document.createDocumentFragment();
    let hasMultipleBadgeDays = false;

    if (!partialRender) {
        for (let i = 0; i < first; i++) {
            const spacer = document.createElement("div");
            spacer.className = "calendar-spacer";
            fragment.appendChild(spacer);
        }
    }

    if (!activeProfile) {
        for (let d = 1; d <= days; d++) {
            const keyDay = key(y, m, d);
            const date = new Date(y, m, d);

            const div = buildDayCell({
                day: d,
                month: m,
                year: y,
                keyDay,
                label: "",
                title: "Selecciona una fecha para la nueva rotativa.",
                isWeekendDay: isWeekend(date),
                isHoliday: Boolean(holidays[keyDay]),
                isDraftSelected: draftKey === keyDay
            });

            div.dataset.keyDay = keyDay;
            div.dataset.date = isoFromKeyDay(keyDay);
            div.dataset.workerId = "";
            div.dataset.action = "calendar-day";

            fragment.appendChild(div);
        }

        cal.replaceChildren(fragment);
        registerCalendarCellsFromDOM(cal);
        cal.dataset.calendarState = "ready";
        cal.setAttribute("aria-busy", "false");
        lastCalendarView = {
            calendar: cal,
            workerId: "",
            year: y,
            month: m,
            holidaysLoaded: true
        };

        runCalendarHeavyUpdates(effectiveOptions);

        return;
    }

    const finishWorkerContext = startPerformanceSpan(
        "calendar:prepare-worker-context",
        {
            profile: activeProfile,
            year: y,
            month: m,
            partialRender
        }
    );
    const storedMaps = {
        shifts: getProfileData(),
        admin: getAdminDays(),
        legal: getLegalDays(),
        comp: getCompDays(),
        absences: getAbsences()
    };
    const activeRotativa = getRotativa(activeProfile);
    const shiftAssignedForDate =
        calendarShiftAssignedResolver(activeProfile);
    const centralCalendar = syncWorkerCalendarState({
        worker: activeWorker || activeProfile,
        year: y,
        month: m,
        shifts: storedMaps.shifts,
        absences: {
            admin: storedMaps.admin,
            legal: storedMaps.legal,
            comp: storedMaps.comp,
            absences: storedMaps.absences
        },
        configuration: {
            rotativa: activeRotativa,
            shiftAssigned: shiftAssignedForDate(new Date())
        }
    });
    const workerCalendarState = getWorkerCalendarState(
        centralCalendar.workerId
    );
    const data = workerCalendarState.shifts;
    const admin = workerCalendarState.absences.admin;
    const legal = workerCalendarState.absences.legal;
    const comp = workerCalendarState.absences.comp;
    const absences = workerCalendarState.absences.absences;
    const hourReturns = getHourReturns(activeProfile);
    const clockMarks = getClockMarks(activeProfile);
    const replacementIndex =
        buildCalendarReplacementIndex(activeProfile);
    const turnChangeIndex =
        buildCalendarTurnChangeIndex(activeProfile, y, m);
    const shiftMoveIndex =
        buildCalendarShiftMoveIndex(activeProfile, y, m);
    const blockedDayIndex =
        buildCalendarBlockedDayIndex(activeProfile);
    const pendingLeaveIndex =
        buildPendingLeaveRequestIndex(activeProfile, y, m, days);
    const contractIndex =
        buildCalendarContractIndex(activeProfile, y, m, days);
    const honorariaSummary = getHonorariaMonthlySummary(
        activeProfile,
        y,
        m,
        holidays
    );
    finishWorkerContext({
        days,
        workerId: activeWorkerId
    });
    const cooperativePartialRender =
        partialRender && effectiveOptions.cooperative === true;
    let partialProcessed = 0;
    const finishBuildDays = startPerformanceSpan(
        "calendar:build-day-cells",
        {
            profile: activeProfile,
            year: y,
            month: m,
            days,
            partialRender
        }
    );

    for (let d = 1; d <= days; d++) {
        const keyDay = key(y, m, d);

        if (partialRender && !requestedKeys.has(keyDay)) {
            continue;
        }

        const baseState = getTurnoBase(activeProfile, keyDay);
        const pendingLeaveRequest =
            pendingLeaveIndex.get(keyDay) || null;
        const pendingLeaveLabel =
            pendingLeaveRequest
                ? pendingLeaveRequestLabel(pendingLeaveRequest.type)
                : "";
        const pendingLeaveBaseLabel =
            pendingLeaveRequest
                ? turnoLabel(baseState) || "Libre"
                : "";

        const state = aplicarCambiosTurno(
            activeProfile,
            keyDay,
            getTurnoProgramado(activeProfile, keyDay)
        );

        const date = new Date(y, m, d);
        const isWeekendDay = isWeekend(date);
        const isHoliday = holidays[keyDay];
        const isHab = isBusinessDay(date, holidays);
        const isoDay = isoFromKeyDay(keyDay);
        const shiftAssigned = shiftAssignedForDate(date);

        const turnChangeMarkers =
            turnChangeIndex.get(keyDay) || [];
        const turnChangeMarker = turnChangeMarkers[0] || null;
        const shiftMoveMarkers =
            shiftMoveIndex.get(keyDay) || [];
        const hourReturn = hourReturns[keyDay] || null;
        const label = hourReturn
            ? hourReturnCalendarLabel(hourReturn)
            : (
                pendingLeaveRequest
                    ? pendingLeaveLabel
                    : obtenerLabelDia(
                        keyDay,
                        state,
                        admin,
                        legal,
                        comp,
                        absences,
                        turnoLabel
                )
            );
        const turnChange = turnChangeMarker?.swap || null;
        const coveredReplacement =
            replacementIndex.byCoveredDate.get(isoDay) || null;
        const workerReplacement =
            replacementIndex.byWorkerDate.get(isoDay) || null;
        const replacementContractError =
            isReplacementProfile(activeProfile) &&
            state > 0 &&
            contractIndex.get(keyDay) === false;
        const pendingManualExtra =
            getPendingManualExtraTurn(
                activeProfile,
                keyDay,
                data
            );
        const manualExtra = Boolean(
            shiftAssigned &&
            getManualExtraTurn(
                activeProfile,
                keyDay,
                data
            )
        );
        const clockMark = clockMarks[keyDay] || null;
        const severeClockIncident =
            clockMarkHasSevereIncident(clockMark);
        const simpleClockIncident =
            !severeClockIncident &&
            clockMarkHasSimpleIncident(clockMark);
        const clockExtra =
            clockMark &&
            hasClockExtra(
                activeProfile,
                keyDay,
                date,
                state,
                holidays
            );
        const showClockExtraReason =
            clockExtra &&
            !replacementIndex.clockExtraBackupByDate.get(isoDay);
        const showTurnChangeBadge =
            Boolean(turnChange) &&
            state > 0 &&
            label === turnoLabel(state);
        const needsReplacement =
            requiereReemplazoTurnoBase(
                keyDay,
                baseState,
                admin,
                legal,
                comp,
                absences
            ) &&
            !coveredReplacement;
        const showExtraReason =
            !needsReplacement &&
            !turnChange &&
            !replacementContractError &&
            pendingManualExtra;
        const honorariaExcess =
            getHonorariaExcessForKey(
                honorariaSummary,
                keyDay
            );
        const showHonorariaLimitBadge =
            Boolean(honorariaExcess) &&
            !replacementContractError &&
            !severeClockIncident &&
            !needsReplacement;
        const badge = replacementContractError
            ? "X"
            : severeClockIncident
                ? "!!!"
                : needsReplacement
                    ? "!"
                    : showHonorariaLimitBadge
                        ? "!"
                    : showExtraReason || showClockExtraReason
                    ? "?"
                    : simpleClockIncident
                        ? "*"
                        : workerReplacement
                            ? (
                                workerReplacement.isLoan
                                    ? "Prestamo"
                                    : (workerReplacement.reason ? "Motivo" : "Reemplazo")
                            )
                            : (
                                turnChangeMarker?.label ||
                                (showTurnChangeBadge ? "CCTT" : "")
                            );
        const replacementTitle = workerReplacement
            ? (
                workerReplacement.replaced
                    ? `${workerReplacement.isLoan ? "Prestamo cubriendo a" : "Reemplazo de"} ${workerReplacement.replaced} por ${workerReplacement.absenceType || "ausencia"}.`
                    : `Motivo HHEE: ${workerReplacement.reason || workerReplacement.absenceType || "sin detalle"}.`
            )
            : "";
        const turnChangeTitle = Array.from(new Set(
            turnChangeMarkers
                .map(marker => turnChangeHoverTitle(marker, activeProfile))
                .filter(Boolean)
        )).join("\n\n");
        const shiftMoveTitle = Array.from(new Set(
            shiftMoveMarkers
                .map(shiftMoveHoverTitle)
                .filter(Boolean)
        )).join("\n\n");
        const workerBlockedDay =
            blockedDayIndex.get(isoDay) ||
            getBlockedDayForProfile(activeProfile, keyDay);
        const calendarBadges =
            Array.from(new Set([
                ...(pendingLeaveRequest ? ["Pend."] : []),
                ...(workerBlockedDay ? ["No disp."] : []),
                ...turnChangeMarkers.map(marker => marker.label),
                ...shiftMoveMarkers.map(marker => marker.label)
            ]));

        if (calendarBadges.length > 1) {
            hasMultipleBadgeDays = true;
        }

        const div = buildDayCell({
            day: d,
            month: m,
            year: y,
            keyDay,
            label,
            alternateLabel: pendingLeaveRequest
                ? pendingLeaveBaseLabel
                : "",
            badge,
            badges: calendarBadges.length
                ? calendarBadges
                : undefined,
            title: (() => {
                const leaveTitle = leaveApplicationHoverTitle(
                    activeProfile,
                    keyDay,
                    admin,
                    legal,
                    comp,
                    absences,
                    replacementIndex.coveringWorkersByDate.get(isoDay) || []
                );

                const suffix = needsReplacement
                    ? " | Requiere reemplazo de turno base"
                    : workerBlockedDay
                        ? ` | ${workerBlockedDay.message}`
                    : honorariaExcess
                        ? ` | ${getHonorariaLimitMessage(honorariaSummary)}`
                    : showExtraReason
                        ? " | Requiere motivo de horas extras"
                        : showClockExtraReason
                            ? " | Requiere motivo por horas extras de marcaje"
                            : severeClockIncident
                                ? " | Incidencia grave de marcaje"
                                : simpleClockIncident
                                    ? " | Incidencia de marcaje"
                        : replacementContractError
                            ? " | No tiene contrato vigente en la fecha seleccionada"
                            : "";

                const baseTitle = (() => {
                    if (!activeProfileEnabled) {
                        return "Perfil desactivado: calendario solo lectura.";
                    }

                    if (replacementContractError) {
                        return "No tiene contrato vigente en la fecha seleccionada.";
                    }

                    // Ya no se muestran las HHEE (Diurnas/Nocturnas) en el hover;
                    // se conservan solo las advertencias del dia si las hay.
                    const warning = suffix.replace(/^\s*\|\s*/, "");

                    return replacementTitle || warning;
                })();

                return [
                    pendingLeaveHoverTitle(
                        pendingLeaveRequest,
                        activeProfile,
                        keyDay,
                        baseState
                    ),
                    turnChangeTitle,
                    shiftMoveTitle,
                    baseTitle,
                    leaveTitle
                ].filter(Boolean).join("\n");
            })(),
            isWeekendDay,
            isHoliday: Boolean(isHoliday),
            isDraftSelected:
                draftKey === keyDay ||
                (
                    window.selectionMode === "moveshifttarget" &&
                    window.pendingShiftMoveSourceKey === keyDay
                )
        });

        div.dataset.keyDay = keyDay;
        div.dataset.date = isoFromKeyDay(keyDay);
        div.dataset.workerId = activeWorkerId;
        div.dataset.action = "calendar-day";

        if (turnChangeMarker) {
            div.classList.add("turn-change-day");
            div.dataset.swapId = String(
                turnChangeMarker.swap.id
            );
        }

        if (shiftMoveMarkers.length) {
            div.classList.add("shift-move-day");
        }

        if (workerBlockedDay) {
            div.classList.add("worker-blocked-day");
        }

        if (pendingLeaveRequest) {
            div.classList.add("pending-leave-request-day");
            div.dataset.workerRequestId = pendingLeaveRequest.id;
        }

        if (!activeProfileEnabled) {
            div.classList.add("inactive-profile-day");
        }

        if (needsReplacement) {
            div.classList.add("needs-replacement");
        }

        if (honorariaExcess) {
            div.classList.add("honoraria-limit-day");
        }

        if (showExtraReason) {
            div.classList.add("needs-extra-reason");
        }

        if (showClockExtraReason) {
            div.classList.add("needs-extra-reason");
            div.classList.add("clock-extra-day");
        }

        if (severeClockIncident) {
            div.classList.add("clock-severe-day");
        } else if (simpleClockIncident) {
            div.classList.add("clock-incident-day");
        }

        if (replacementContractError) {
            div.classList.add("contract-error-day");
        }

        if (workerReplacement) {
            div.classList.add("replacement-day");
        }

        if (manualExtra) {
            div.classList.add("manual-extra-day");
        }

        if (hourReturn) {
            div.classList.add("hours-return-day");
            if (!hourReturn.fullTurn) {
                div.classList.add("hours-return-day--partial");
            }
        }

        aplicarClasesEspeciales(
            div,
            keyDay,
            state,
            isHab,
            isWeekendDay,
            isHoliday,
            admin,
            legal,
            comp,
            absences,
            aplicarClaseTurno,
            baseState,
            getDayColorGradient(
                activeProfile,
                keyDay,
                state,
                date,
                holidays,
                admin[keyDay],
                baseState,
                {
                    unbasedComponentsAreExtra: manualExtra,
                    singleBandGradient: manualExtra
                }
            )
        );

        const bloqueado = estaBloqueadoModo(
            window.selectionMode,
            keyDay,
            (
                window.selectionMode === "admin" ||
                window.selectionMode === "hoursreturn" ||
                window.selectionMode === "moveshiftsource" ||
                window.selectionMode === "moveshifttarget"
            )
                ? baseState
                : state,
            isHab,
            admin,
            legal,
            comp,
            absences,
            shiftAssigned,
            {
                compCantidad: window.compCantidad || 0,
                legalCantidad: window.legalCantidad || 0,
                licenseCantidad: window.licenseCantidad || 0,
                licenseType: window.licenseType || "license",
                rotativa: activeRotativa,
                holidays,
                hourReturns,
                actualState: state,
                moveShiftSourceKey:
                    window.pendingShiftMoveSourceKey || "",
                moveShiftDestinationTurn:
                    window.pendingShiftMoveDestinationTurn || 0,
                moveShiftProgrammedTurn:
                    getTurnoProgramado(activeProfile, keyDay)
            }
        );

        if (window.selectionMode || !activeProfileEnabled) {
            div.classList.add(
                bloqueado || !activeProfileEnabled
                    ? "mpa-disabled"
                    : "mpa-enabled"
            );
        }

        calendarCellHandlers.set(div, async event => {
            if (!activeProfileEnabled) {
                event.stopPropagation();
                alert("Este perfil esta desactivado. Reactivalo desde Perfil para modificar su calendario.");
                return;
            }

            if (
                pendingLeaveRequest &&
                !window.selectionMode
            ) {
                event.stopPropagation();
                return openPendingLeaveRequestDialog({
                    request: pendingLeaveRequest,
                    profile: activeProfile,
                    keyDay,
                    baseState
                });
            }

            if (
                replacementContractError &&
                event.target.closest(".day-badge")
            ) {
                event.stopPropagation();
                window.startReplacementContractEdit?.(
                    activeProfile,
                    keyDay
                );
                return;
            }

            if (
                showHonorariaLimitBadge &&
                event.target.closest(".day-badge")
            ) {
                event.stopPropagation();
                alert(getHonorariaLimitMessage(honorariaSummary));
                return;
            }

            if (
                showExtraReason &&
                event.target.closest(".day-badge")
            ) {
                event.stopPropagation();
                return openExtraReasonDialog(
                    activeProfile,
                    keyDay,
                    showExtraReason
                );
            }

            if (
                showClockExtraReason &&
                event.target.closest(".day-badge")
            ) {
                event.stopPropagation();
                return openClockExtraReasonDialog(
                    activeProfile,
                    keyDay,
                    state
                );
            }

            if (
                turnChange ||
                needsReplacement
            ) {
                event.stopPropagation();
            }

            await clickDia(
                keyDay,
                isHab,
                admin,
                legal,
                comp,
                absences,
                {
                    cell: div,
                    date,
                    holidays
                }
            );
        });

        if (partialRender) {
            if (!replaceCalendarCell(activeWorkerId, keyDay, div)) {
                return renderCalendar({
                    ...effectiveOptions,
                    changedKeys: undefined,
                    allowDuringDirectEdit: true
                });
            }

            partialProcessed++;

            if (
                cooperativePartialRender &&
                partialProcessed % CALENDAR_PARTIAL_BATCH_SIZE === 0
            ) {
                await waitCalendarIdle(60);

                if (renderRequest !== calendarRenderRequest) return;
            }
        } else {
            fragment.appendChild(div);
        }
    }
    finishBuildDays({
        processed: partialRender ? partialProcessed : days
    });

    if (!partialRender) {
        measurePerformance(
            "calendar:commit-dom",
            () => {
                cal.replaceChildren(fragment);
                registerCalendarCellsFromDOM(cal);
                cal.dataset.calendarState = "ready";
                cal.setAttribute("aria-busy", "false");
                lastCalendarView = {
                    calendar: cal,
                    workerId: activeWorkerId,
                    profileName: activeProfile,
                    year: y,
                    month: m,
                    holidays,
                    holidaysLoaded: true,
                    days,
                    cacheKey,
                    viewSignature,
                    monthKey
                };
            },
            {
                profile: activeProfile,
                year: y,
                month: m,
                days
            }
        );
    } else {
        cal.dataset.calendarState = "ready";
        cal.setAttribute("aria-busy", "false");
    }
    const monthHasMultipleBadges = partialRender
        ? Boolean(cal.querySelector(".day.has-multiple-badges"))
        : hasMultipleBadgeDays;

    cal.classList.toggle(
        "has-multiple-badge-days",
        monthHasMultipleBadges
    );
    calendarPanel?.classList.toggle(
        "has-multiple-badge-days",
        monthHasMultipleBadges
    );

    syncCalendarMapSnapshots(activeProfile);
    scheduleActiveCalendarCacheWrite(cal, {
        delay: partialRender
            ? CALENDAR_CACHE_WRITE_DELAY_MS
            : 120
    });

    if (partialRender) {
        if (effectiveOptions.updateSummary === true) {
            scheduleWorkerSummaryUpdate(activeWorkerId);
        }
        return;
    }

    runCalendarHeavyUpdates(effectiveOptions, {
        profile: activeProfile,
        y,
        m,
        days,
        holidays,
        data
    });
}

export async function renderCalendar(options = {}) {
    return measurePerformance(
        "calendar:render",
        () => renderCalendarImpl(options),
        {
            year: currentDate.getFullYear(),
            month: currentDate.getMonth(),
            changedKeys: Array.isArray(options.changedKeys)
                ? options.changedKeys.length
                : 0,
            deferHeavy: options.deferHeavy === true,
            backgroundFresh: options.backgroundFresh === true,
            skipCache: options.skipCache === true
        },
        {
            asyncThreshold: 120
        }
    );
}

function syncShellPanels(options = {}) {
    const sync = () => {
        if (
            options.navigationRequest &&
            options.navigationRequest !== calendarNavigationRequest
        ) {
            return;
        }

        if (
            document.body.dataset.activeView === "swap" &&
            typeof window.renderSwapPanel === "function"
        ) {
            window.renderSwapPanel();
        }

        if (
            document.body.dataset.activeView === "dashboard" &&
            typeof window.renderDashboardState === "function"
        ) {
            window.renderDashboardState();
        } else {
            deferCalendarDashboardRefresh();
        }
    };

    if (options.deferHeavy) {
        deferAfterPaint(sync);
        return;
    }

    sync();
}

export async function goToCalendarMonth(year, month, options = {}) {
    const navigationRequest = ++calendarNavigationRequest;
    const renderOptions = {
        ...options,
        deferHeavy: true,
        backgroundFresh: options.backgroundFresh !== false,
        navigationRequest
    };
    const finishMonthNavigation = startPerformanceSpan(
        "calendar:go-to-month",
        {
            year: Number(year),
            month: Number(month),
            backgroundFresh: renderOptions.backgroundFresh
        }
    );

    cancelCalendarHeavyUpdates();
    cancelCalendarDirectEditRefresh();
    closeCalendarMonthPicker();
    currentDate.setFullYear(Number(year), Number(month), 1);
    showTimelinePendingMonth(
        currentDate.getFullYear(),
        currentDate.getMonth()
    );
    window.showInlineStaffingPendingMonth?.(
        currentDate.getFullYear(),
        currentDate.getMonth()
    );
    window.scheduleStaffingWeeklyPreload?.({ delay: 900 });
    const renderPromise = renderCalendar(renderOptions);

    if (renderOptions.backgroundFresh) {
        syncShellPanels(renderOptions);
        void renderPromise;
        finishMonthNavigation({
            returnedWithBackgroundFresh: true
        });
        return;
    }

    await renderPromise;

    if (navigationRequest !== calendarNavigationRequest) {
        finishMonthNavigation({
            cancelled: true
        });
        return;
    }

    syncShellPanels(renderOptions);
    finishMonthNavigation({
        returnedWithBackgroundFresh: false
    });
}

export async function prevMonth(options = {}) {
    const target = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() - 1,
        1
    );

    await goToCalendarMonth(
        target.getFullYear(),
        target.getMonth(),
        options
    );
}

export async function nextMonth(options = {}) {
    const target = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        1
    );

    await goToCalendarMonth(
        target.getFullYear(),
        target.getMonth(),
        options
    );
}

if (typeof window !== "undefined") {
    [
        "pointerdown",
        "keydown",
        "wheel",
        "touchstart",
        "input"
    ].forEach(eventName => {
        window.addEventListener(
            eventName,
            markCalendarUserActivity,
            { capture: true, passive: true }
        );
    });
}
