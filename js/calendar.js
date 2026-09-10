import { escapeHTML } from "./htmlUtils.js";
import { showConfirm } from "./dialogs.js";
import {
    LEAVE_ATTACHMENT_ACCEPT,
    addLeaveAttachment,
    getLeaveAttachments,
    leaveTypeNeedsDocument,
    openLeaveAttachment,
    removeLeaveAttachment
} from "./leaveAttachments.js";
import {
    MEMO_ATTACHMENT_ACCEPT,
    addMemoDocument,
    findClockMemoForDay,
    findLeaveMemoForDay,
    getMemoDocuments,
    openMemoDocument,
    removeMemoDocument
} from "./memos.js";
import {
    aplicarCambiosTurno,
    fusionarTurnos,
    getProtectedDirectEditTurn,
    getAddTurnResult,
    getTurnoBase,
    getTurnoProgramado
} from "./turnEngine.js";
import {
    calculateWorkerMonthTotals,
    calculateCarryOver
} from "./hoursEngine.js";
import {
    getProfileData,
    saveProfileData,
    getBaseProfileData,
    saveBaseProfileData,
    getBlockedDays,
    saveBlockedDays,
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
    saveReplacements,
    isNoCoverageDay,
    getNoCoverageReason,
    setNoCoverageDay
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
    calcExtraHours,
    calcHours,
    isBusinessDay,
    isWeekend
} from "./calculations.js";
import {
    turnoLabel,
    aplicarClaseTurno
} from "./uiEngine.js";
import { getDayColorGradient } from "./dayColorBands.js";
import { getTurnoColorConfig } from "./turnoColors.js";
import {
    PENDING_LEAVE_REQUEST_TYPES,
    pendingLeaveRequestEndDate,
    leaveRequestCoversISODate,
    pendingLeaveColorValue
} from "./pendingLeaveRequests.js";
import {
    getPendingSwapRequestsForProfile,
    pendingSwapColorValue,
    pendingSwapLabel,
    pendingSwapLongLabel,
    pendingSwapRoleForDate
} from "./pendingSwapRequests.js";
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
    cancelShiftMoveById,
    getShiftMoveMarkers,
    getShiftMoves,
    SHIFT_MOVE_BADGE
} from "./shiftMoves.js";
import {
    getAbsenceLabelForProfileDate,
    getBackedTurnForWorker,
    getClockExtraBackupForWorker,
    buildReplacementRequestWhatsAppUrl,
    cancelPreassignment,
    cancelReplacementRequest,
    cancelReplacementById,
    codeToTurno,
    confirmPreassignment,
    createReplacementRequest,
    createReplacementRequests,
    expireReplacementRequests,
    buildPendingRequestIndex,
    getPendingRequestsFromIndex,
    formatRequestTimeLeft,
    getActiveReplacementsForCoveredShift,
    getCoveringWorkersForShift,
    getPendingReplacementRequestsForShift,
    getReplacementForCoveredShift,
    getReplacementForWorkerShift,
    getReplacementsForWorkerShift,
    replacementActive,
    saveReplacement,
    turnoToCode,
    turnoReplacementLabel,
    workerHasAbsence
} from "./replacements.js";
import {
    getHonorariaContractForDate,
    getInheritedReplacementContractForCoveredShift,
    hasContractForDate,
    isReplacementProfile
} from "./contracts.js";
import {
    getHonorariaExcessForKey,
    getHonorariaLimitMessage,
    getHonorariaMonthlySummary
} from "./honoraria.js";
import {
    actorLabelHTML,
    actorLabelText,
    addAuditLog,
    AUDIT_CATEGORY,
    getLeaveApplicationInfo,
    getClockMarkAuditInfo,
    getNoCoverageAuditInfo,
    getPreassignmentAuditInfo,
    getShiftMoveAuditInfo,
    getSwapAuditInfo,
    undoAuditLogEntry
} from "./auditLog.js";
import {
    addPreassignment,
    removePreassignment,
    setPreassignmentReason,
    getPreassignmentForCoveredShift,
    getPreassignmentForWorker,
    getPreassignmentTurnForWorker
} from "./preassignments.js";
import {
    releaseLeaveHoldsForCoverage,
    removeLeaveHoldKeys
} from "./leaveHold.js";
import {
    clearClockMark,
    clockMarkAppliesToTurn,
    getClockMarks,
    getClockNetExtraHours,
    getClockScheduleState,
    getScheduledSegmentsForProfile,
    hasClockNetExtra,
    hasSevereClockIncident,
    hasSimpleClockIncident
} from "./clockMarks.js";
import {
    classifyClockMarkSegment,
    findClockMarkEntry
} from "./clockMarkUtils.js";
import {
    getHourReturns,
    hourReturnCalendarLabel
} from "./hourReturns.js";
import { withBusyState } from "./busy.js";
import {
    ensureAttendanceIncidentIndex,
    getAttendanceIncidentsForDay,
    onAttendanceIncidentIndexReady
} from "./attendanceIncidentIndex.js";
import {
    ATTENDANCE_INCIDENT_KINDS,
    attendanceDayMarks
} from "./hoursReport.js";
import { getMarksFor } from "./attendanceImport.js";
import { rotationPositionLabel } from "./rotationUtils.js";
import {
    TURNO,
    TURNO_CLASS,
    TURNO_LABEL
} from "./constants.js";
import {
    getJSON,
    getRaw,
    listKeys,
    removeKey,
    setJSON,
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
import {
    cancelInterUnitLoan,
    createInterUnitLoan
} from "./firebaseInterUnitLoans.js";
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
import {
    buildReplacementCandidates,
    MAX_MONTHLY_DIURNAL_OVERTIME,
    canCoverShift,
    candidatePositionLabel,
    diurnoLongCoverageHours,
    exceedsDiurnalOvertimeLimit,
    getActualState,
    getReplacementNeededTurn,
    getTrainingCoverageHours,
    halfAdminAfternoonCoverageHours,
    isDiurnoLongCoverageCandidate,
    isHalfAdminAfternoonCoverage,
    nextDayMorningShiftAfterNight,
    preassignmentBlocksReplacementCandidate,
    replacementCreatesInvertedTwentyFour,
    replacementPriorityForCandidate,
    replacementScopeProfiles
} from "./replacementCandidates.js";
import {
    setAutoCoverageCandidateProvider,
    startAutoCoverage
} from "./autoCoverage.js";
import { runCooperativeRange } from "./mainThreadScheduler.js";
import {
    canEditTarget,
    canViewTarget,
    ensureCanEditTarget
} from "./workspacePermissions.js";
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
const MANUAL_EXTRA_REASON_PRESETS_KEY = "manualExtraReasonPresets";
const DEFAULT_MANUAL_EXTRA_REASON_PRESETS = [
    "Campa\u00f1a de Invierno",
    "Estaci\u00f3n de Trabajo",
    "Apoyo Oncol\u00f3gico",
    "Apoyo Pabell\u00f3n",
    "Operativo displasia de cadera"
];
// Lista aparte de la de turnos extra: los motivos son de otra naturaleza
// ("Dotacion completa" vs "Campana de Invierno") y mezclarlos ensuciaria las dos.
const NO_COVERAGE_REASON_PRESETS_KEY = "noCoverageReasonPresets";
const DEFAULT_NO_COVERAGE_REASON_PRESETS = [
    "Dotaci\u00f3n completa",
    "Dotaci\u00f3n cubierta por funcionario de 3er turno",
    "Turno sin demanda asistencial",
    "Cobertura resuelta con otra unidad"
];
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
const calendarDirectEditPendingChanges = new Map();
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

function calendarAdjacentTurnForMoveShift(
    profileName,
    keyDay,
    offset,
    sourceKey = ""
) {
    const date = dateFromKeyDay(keyDay);

    if (Number.isNaN(date.getTime())) return TURNO.LIBRE;

    date.setDate(date.getDate() + Number(offset || 0));

    const adjacentKey = key(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );

    if (
        adjacentKey === sourceKey &&
        adjacentKey !== keyDay
    ) {
        return TURNO.LIBRE;
    }

    return Number(
        aplicarCambiosTurno(
            profileName,
            adjacentKey,
            getTurnoProgramado(profileName, adjacentKey)
        )
    ) || TURNO.LIBRE;
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

// Mismo patron que el indice de permisos pendientes: se precomputa una vez por
// render en vez de consultar por casilla.
function buildPendingSwapRequestIndex(profileName, year, month, days) {
    const index = new Map();
    const requests = getPendingSwapRequestsForProfile(profileName);

    if (!requests.length) return index;

    for (let d = 1; d <= days; d++) {
        const keyDay = key(year, month, d);
        const iso = isoFromKeyDay(keyDay);

        for (const request of requests) {
            const role = pendingSwapRoleForDate(request, profileName, iso);

            if (!role) continue;

            index.set(keyDay, { request, role });
            break;
        }
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
    const shiftMoveMarkers =
        getShiftMoveMarkers(activeProfile, keyDay);
    const shiftMoveMarker = shiftMoveMarkers[0] || null;
    const coveredReplacement =
        getReplacementForCoveredShift(activeProfile, keyDay);
    const workerReplacement =
        getReplacementForWorkerShift(activeProfile, keyDay);
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
    // Sin turno no hay marcaje que revisar: la marca quedo huerfana al quitar el
    // turno y se ignora, para que el click vuelva a editar la casilla.
    const clockMarkApplies = clockMarkAppliesToTurn(state);
    const severeClockIncident =
        clockMarkApplies &&
        hasSevereClockIncident(activeProfile, keyDay);
    const clockMarkForDay = clockMarkApplies
        ? getClockMarks(activeProfile)[keyDay] || null
        : null;
    const simpleClockIncident =
        Boolean(clockMarkForDay) &&
        !severeClockIncident &&
        clockMarkHasSimpleIncident(clockMarkForDay);
    const inheritedContractCoverage =
        getInheritedReplacementContractForCoveredShift(
            activeProfile,
            keyDay
        );
    const needsReplacement =
        requiereReemplazoTurnoBase(
            keyDay,
            baseState,
            admin,
            legal,
            comp,
            absences,
            getRotativa(activeProfile).type
        ) &&
        !coveredReplacement &&
        !inheritedContractCoverage &&
        !isNoCoverageDay(activeProfile, keyDay);
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
        hasClockNetExtra(
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
        alert(getHonorariaLimitMessage(honorariaSummary, keyDay));
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

    // El icono de incidencia de marcaje abre SU detalle. Va primero: es una
    // insignia con accion propia y no debe caer en lo que hace el resto de la
    // casilla.
    if (event.target.closest("[data-attendance-incident]")) {
        event.stopPropagation();
        openAttendanceIncidentDialog(activeProfile, keyDay);
        return;
    }

    // Dia con marcaje modificado (icono de reloj): al presionarlo se abre el
    // detalle del marcaje. No aplica si aun falta el motivo de horas extra (badge
    // "?") ni durante un modo de seleccion (p. ej. marcaje/permisos).
    if (
        simpleClockIncident &&
        !showClockExtraReason &&
        !window.selectionMode
    ) {
        event.stopPropagation();
        return openClockMarkDetailDialog({
            profile: activeProfile,
            keyDay,
            date,
            state,
            holidays
        });
    }

    if (
        turnChange ||
        shiftMoveMarker ||
        needsReplacement ||
        workerReplacement
    ) {
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

function recordCalendarDirectEditChange({
    profileName,
    keyDay,
    previousTurn,
    nextTurn
} = {}) {
    if (
        !profileName ||
        !keyDay ||
        Number(previousTurn) === Number(nextTurn)
    ) {
        return;
    }

    const profileChanges =
        calendarDirectEditPendingChanges.get(profileName) || new Map();
    const previous = profileChanges.get(keyDay);

    profileChanges.set(keyDay, {
        keyDay,
        previousTurn:
            previous?.previousTurn ?? (Number(previousTurn) || TURNO.LIBRE),
        nextTurn: Number(nextTurn) || TURNO.LIBRE
    });
    calendarDirectEditPendingChanges.set(profileName, profileChanges);
}

function calendarDirectEditMessage(label, affectedDates = []) {
    if (!affectedDates.length) return `${label}. Revisa tu calendario actualizado.`;

    if (affectedDates.length === 1) {
        const match = String(affectedDates[0] || "")
            .match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const displayDate = match
            ? `${match[3]}-${match[2]}-${match[1]}`
            : affectedDates[0];

        return `${label} para el ${displayDate}.`;
    }

    return `${label} en ${affectedDates.length} días de tu calendario.`;
}

// Un dia solo cuenta como modificado si su turno quedo DISTINTO del que tenia
// al empezar la edicion. `recordCalendarDirectEditChange` descarta el click
// individual que no cambia nada, pero no el NETO de varios: el supervisor
// cicla una casilla -Larga, Noche, 24, Libre, Larga- y la deja como estaba, y
// esa entrada quedaba en el mapa con previousTurn === nextTurn. Al cerrar el
// switch se le avisaba al trabajador que le habian modificado el calendario
// cuando en realidad no habia cambiado nada.
function calendarDirectEditChangedKeys(changes) {
    return [...changes.keys()]
        .filter(keyDay => {
            const change = changes.get(keyDay);

            return (
                Number(change?.previousTurn) !== Number(change?.nextTurn)
            );
        })
        .sort();
}

function consumeCalendarDirectEditPendingChanges() {
    const batches = [...calendarDirectEditPendingChanges.entries()]
        .map(([profileName, changes]) => {
            const affectedKeys = calendarDirectEditChangedKeys(changes);
            const affectedDates = affectedKeys
                .map(keyDay => isoFromKeyDay(keyDay))
                .filter(Boolean);
            const bulk = affectedDates.length > 1;

            return {
                profileName,
                affectedKeys,
                affectedDates,
                changes: affectedKeys.map(keyDay => changes.get(keyDay)),
                metadata: {
                    changeType: bulk
                        ? "calendar_bulk_updated"
                        : "shift_updated",
                    source: "main_calendar_manual_edit",
                    title: bulk
                        ? "Tu calendario fue actualizado"
                        : "Tu turno fue modificado",
                    message: calendarDirectEditMessage(
                        bulk
                            ? "Se actualizaron turnos manuales"
                            : "Se modificó un turno",
                        affectedDates
                    ),
                    affectedDates,
                    entityId:
                        `direct_edit_${profileName}_${Date.now()}`
                }
            };
        })
        .filter(batch => batch.affectedDates.length);

    calendarDirectEditPendingChanges.clear();

    return batches;
}

function commitCalendarDirectEditPendingChanges() {
    const batches = consumeCalendarDirectEditPendingChanges();

    if (
        !batches.length ||
        typeof window === "undefined"
    ) {
        return batches;
    }

    batches.forEach(batch => {
        window.dispatchEvent(
            new CustomEvent("proturnos:calendarProfilesChanged", {
                detail: {
                    profiles: [batch.profileName],
                    metadata: batch.metadata,
                    delay: 0,
                    source: "calendar_direct_edit_commit"
                }
            })
        );
    });

    window.dispatchEvent(
        new CustomEvent("proturnos:calendarDirectEditCommitted", {
            detail: {
                batches
            }
        })
    );

    return batches;
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
    const refresh = options.refresh !== false;

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
    commitCalendarDirectEditPendingChanges();
    if (!refresh) return;
    await updateVisibleCalendarDays({ updateSummary: true });
}

function scheduleCalendarDirectEditRefresh(keyDay) {
    calendarDirectEditRefreshRequest++;
    queueCalendarDayUpdates([keyDay]);
}

window.flushCalendarDirectEditRefresh =
    flushCalendarDirectEditRefresh;
window.commitCalendarDirectEditPendingChanges =
    commitCalendarDirectEditPendingChanges;

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
        }
    });

    if (!pendingCalendarKeys.size || pendingCalendarUpdateTimer) return;

    const schedule = window.requestAnimationFrame ||
        (callback => window.setTimeout(callback, 16));

    pendingCalendarUpdateTimer = schedule(async () => {
        pendingCalendarUpdateTimer = 0;
        const changedKeys = [...pendingCalendarKeys];
        pendingCalendarKeys.clear();

        if (changedKeys.length) {
            await renderCalendar({
                changedKeys,
                allowDuringDirectEdit: true,
                updateSummary: true
            });
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

function pendingSwapHoverTitle(pendingSwap, profileName, state) {
    if (!pendingSwap) return "";

    const { request, role } = pendingSwap;
    const counterpart =
        (request.from === profileName ? request.to : request.from) ||
        request.targetProfile ||
        "Sin contraparte";
    const changeDate = request.fecha || request.date || "";
    const returnDate = request.devolucion || request.returnDate || "";

    return [
        "Cambio de turno pendiente de aprobacion",
        `Trabajador: ${profileName}`,
        `Con: ${counterpart}`,
        `${pendingSwapLongLabel(role)}: ${turnoLabel(state) || "Libre"}`,
        changeDate ? `Cambio: ${formatISODateForHover(changeDate)}` : "",
        returnDate ? `Devolucion: ${formatISODateForHover(returnDate)}` : "",
        request.detail ? `Detalle: ${request.detail}` : ""
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

// Logo documento+lapiz para marcar, en el calendario principal, los dias con un
// contrato de Honorarios vigente (indica que ese dia admite turnos).
const HONORARIA_CONTRACT_ICON = `
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v9.5"/>
        <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
        <path d="M10.42 12.61a2.1 2.1 0 1 1 2.97 2.97L7.95 21 4 22l.99-3.95 5.43-5.44Z"/>
    </svg>
`;

// Badge de "marcaje reloj control modificado": reemplaza el antiguo asterisco por
// un icono de reloj. Es un centinela (no texto visible) que buildDayCell detecta
// para renderizar el SVG en vez de escaparlo como texto.
const CLOCK_MARK_BADGE = "clock-mark";
// Incidencia que trajo el reporte del reloj (atraso, falta de marca, marca en
// dia libre). Es OTRA cosa que el reloj de al lado: ese dice que el supervisor
// movio la hora a mano; este, que la planilla del reloj trajo un error.
const ATTENDANCE_INCIDENT_BADGE = "attendance-incident";
const ATTENDANCE_INCIDENT_BADGE_ICON = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3.6 2.6 19.2a1.6 1.6 0 0 0 1.4 2.4h16a1.6 1.6 0 0 0 1.4-2.4z"/>
        <path d="M12 9.4v4.4"/>
        <path d="M12 17.6h.01"/>
    </svg>
`;
const CLOCK_MARK_BADGE_ICON = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5"/>
        <path d="M12 7.5V12l3 2"/>
    </svg>
`;

// Badge de "turno preasignado" (cobertura tentativa): pastilla con gradiente
// naranjo (via CSS) y tres puntos blancos. Reemplaza al "!" en la casilla del
// ausente y marca el turno tentativo del reemplazante. Centinela que buildDayCell
// detecta para rendir el SVG.
// Badge de "solicitud de cobertura enviada": celular, para distinguir de un
// vistazo el turno que ya salio a las PWA del que todavia no se pidio a nadie.
const REQUEST_PENDING_BADGE = "request-pending";
const REQUEST_PENDING_BADGE_ICON = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="5" y="2" width="14" height="20" rx="2.8"/>
        <path d="M10.6 4.7h2.8"/>
        <rect x="7.4" y="6.7" width="9.2" height="10.2" rx="1"/>
        <circle cx="12" cy="19.6" r="1.15"/>
    </svg>
`;

const PREASSIGN_BADGE = "preassign";
const PREASSIGN_BADGE_ICON = `
    <svg viewBox="0 0 24 10" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="5" r="2.3"/>
        <circle cx="12" cy="5" r="2.3"/>
        <circle cx="19" cy="5" r="2.3"/>
    </svg>
`;

// Icono del boton de opciones del modal de reemplazo (barras + triangulo hacia
// abajo): al presionarlo despliega el panel de opciones.
const REPLACEMENT_OPTIONS_ICON = `
    <svg viewBox="0 0 30 24" fill="none" aria-hidden="true">
        <g stroke="currentColor" stroke-width="2.8" stroke-linecap="round">
            <line x1="2" y1="5" x2="15" y2="5"/>
            <line x1="2" y1="12" x2="15" y2="12"/>
            <line x1="2" y1="19" x2="15" y2="19"/>
        </g>
        <path d="M19 8H28L23.5 15Z" fill="currentColor"/>
    </svg>
`;

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
    isDraftSelected,
    hasHonorariaContract,
    attendanceIncidentTitle
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

    if (hasHonorariaContract) {
        div.classList.add("honoraria-contract-day");
    }

    const contractMarkHTML = hasHonorariaContract
        ? `<span class="day-contract-mark" title="Contrato de honorarios vigente">${HONORARIA_CONTRACT_ICON}</span>`
        : "";

    const visibleBadges = Array.isArray(badges)
        ? badges.filter(Boolean)
        : (badge ? [badge] : []);

    if (visibleBadges.length > 1) {
        div.classList.add("has-multiple-badges");
    }

    const badgeHTML = visibleBadges.length
        ? `
            <span class="day-badges">
                ${visibleBadges.map(item => {
                    if (item === CLOCK_MARK_BADGE) {
                        return `<span class="day-badge day-badge--clock" title="Marcaje reloj control modificado">${CLOCK_MARK_BADGE_ICON}</span>`;
                    }

                    if (item === ATTENDANCE_INCIDENT_BADGE) {
                        return `<span class="day-badge day-badge--attendance-incident" title="${escapeHTML(attendanceIncidentTitle || "Incidencia de marcaje")}" data-attendance-incident="1">${ATTENDANCE_INCIDENT_BADGE_ICON}</span>`;
                    }

                    if (item === PREASSIGN_BADGE) {
                        return `<span class="day-badge day-badge--preassign" title="Turno preasignado (pendiente de confirmar)">${PREASSIGN_BADGE_ICON}</span>`;
                    }

                    if (item === REQUEST_PENDING_BADGE) {
                        return `<span class="day-badge day-badge--request" title="Solicitud de cobertura enviada: en espera de respuesta">${REQUEST_PENDING_BADGE_ICON}</span>`;
                    }

                    const className = item === "No disp."
                        ? "day-badge day-badge--worker-blocked"
                        : item === SHIFT_MOVE_BADGE
                            ? "day-badge day-badge--move"
                        : "day-badge";

                    return `<span class="${className}">${escapeHTML(item)}</span>`;
                }).join("")}
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
        ${contractMarkHTML}
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
                <ul class="turn-change-dialog__swap-detail">
                    ${swap.fecha ? `
                        <li>
                            <span>Entrega</span>
                            <strong>${escapeHTML(formatISODateForSwapHover(swap.fecha))} &middot; ${escapeHTML(swapCodeLabel(swap.turno))}</strong>
                        </li>
                    ` : ""}
                    ${swap.devolucion ? `
                        <li>
                            <span>Devuelve</span>
                            <strong>${escapeHTML(formatISODateForSwapHover(swap.devolucion))} &middot; ${escapeHTML(swapCodeLabel(swap.turnoDevuelto))}</strong>
                        </li>
                    ` : ""}
                    ${(() => {
                        // Quien lo registro. Sale del LOG, asi que un cambio
                        // anterior a esta pantalla -o cuyo log ya fue evicto-
                        // simplemente no muestra la fila, en vez de inventar.
                        const audit = getSwapAuditInfo(swap.id);

                        return audit ? `
                            <li>
                                <span>Registrado por</span>
                                <strong>${actorLabelHTML(audit)}</strong>
                            </li>
                        ` : "";
                    })()}
                </ul>
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

function replacementDetailDateLabel(value) {
    const match = String(value || "")
        .match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) return String(value || "");

    return new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3])
    ).toLocaleDateString(
        "es-CL",
        {
            weekday: "long",
            day: "2-digit",
            month: "long",
            year: "numeric"
        }
    );
}

function replacementDetailCreatedLabel(value) {
    const date = new Date(value || "");

    if (Number.isNaN(date.getTime())) return "Sin registro";

    return date.toLocaleString(
        "es-CL",
        {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        }
    );
}

function replacementDetailSourceLabel(replacement = {}) {
    if (replacement.isLoan || replacement.source === "inter_unit_loan") {
        return "Prestamo entre unidades";
    }

    const source = String(replacement.source || "");

    if (source === "manual_extra") return "Turno extra manual";
    if (source === "clock_extra") return "Horas extras por marcaje";
    if (source === "forced_replacement") return "Reemplazo forzado";
    if (source === "replacement_request") return "Solicitud aceptada";
    if (source === "forced_replacement_request") {
        return "Solicitud forzada aceptada";
    }

    return "Reemplazo de turno";
}

function replacementDetailHoursLabel(replacement = {}) {
    const hours =
        replacement.overtimeHours ||
        replacement.clockHours ||
        null;

    if (!hours) return "";

    if (typeof hours === "number") {
        return `${hours} h`;
    }

    const day = Number(hours.d) || 0;
    const night = Number(hours.n) || 0;

    if (!day && !night) return "";

    return `D: ${day} h · N: ${night} h`;
}

function replacementDetailTurnLabel(replacement = {}) {
    const turno = codeToTurno(replacement.turno);

    return turnoReplacementLabel(turno) ||
        replacement.turno ||
        "Sin turno";
}

function replacementDetailReasonLabel(replacement = {}) {
    const reason = String(replacement.reason || "").trim();
    const absenceType = String(replacement.absenceType || "").trim();

    return replacement.replaced
        ? (absenceType || reason || "Sin detalle")
        : (reason || absenceType || "Sin detalle");
}

function getReplacementDetailRecord(
    profileName,
    keyDay,
    replacementId = ""
) {
    if (replacementId) {
        const match = getReplacements().find(replacement =>
            replacementActive(replacement) &&
            String(replacement.id || "") === String(replacementId)
        );

        if (match) return match;
    }

    return getReplacementForWorkerShift(profileName, keyDay);
}

function replacementDetailTitle(replacement) {
    if (!replacement.replaced) return "Turno extra asignado";

    return replacement.isLoan
        ? "Prestamo asignado"
        : "Reemplazo asignado";
}

function replacementDetailRows(replacement, profileName) {
    return [
        ["Trabajador", replacement.worker || profileName],
        replacement.replaced
            ? [
                replacement.isLoan ? "Cubre a" : "Reemplaza a",
                replacement.replaced
            ]
            : null,
        ["Fecha", replacementDetailDateLabel(replacement.date)],
        ["Turno", replacementDetailTurnLabel(replacement)],
        [
            replacement.replaced ? "Ausencia" : "Motivo",
            replacementDetailReasonLabel(replacement)
        ],
        ["Origen", replacementDetailSourceLabel(replacement)],
        replacement.workerWorkspaceName
            ? ["Unidad origen", replacement.workerWorkspaceName]
            : null,
        replacement.hostWorkspaceName
            ? ["Unidad destino", replacement.hostWorkspaceName]
            : null,
        replacementDetailHoursLabel(replacement)
            ? ["HH.EE", replacementDetailHoursLabel(replacement)]
            : null,
        ["Registrado", replacementDetailCreatedLabel(replacement.createdAt)]
    ].filter(Boolean);
}

function replacementDetailRowsHTML(replacement, profileName) {
    return `
        <div class="leave-detail-rows replacement-detail-rows">
            ${replacementDetailRows(replacement, profileName)
                .map(([label, value]) => `
                    <div>
                        <span>${escapeHTML(label)}</span>
                        <b>${escapeHTML(value)}</b>
                    </div>
                `).join("")}
        </div>
    `;
}

/**
 * Detalle de los turnos asignados de un dia (reemplazos, prestamos y turnos
 * extra manuales).
 *
 * Un dia puede tener MAS DE UNO: un D+N con su Diurno y su Noche respaldados por
 * separado son dos registros. Antes se abria solo el primero, asi que el segundo
 * no habia forma de verlo ni de anularlo desde aqui. Cuando hay varios se listan
 * todos, cada uno con su propio "Anular reemplazo"; con uno solo, el cuadro se
 * ve igual que siempre.
 */
/* ======================================================
   Incidencias de marcaje en la casilla del calendario

   Son los errores que trajo el reporte del reloj control -atrasos, entradas o
   salidas sin marca, marcas en dia libre-, los mismos que cuenta el recuadro
   "Incidencias de marcaje" del inicio. El icono de reloj que ya existia dice
   otra cosa: que el supervisor movio la hora a mano.
====================================================== */

function attendanceIncidentLabel(kind) {
    return ATTENDANCE_INCIDENT_KINDS
        .find(item => item.key === kind)?.label || "Incidencia";
}

// Texto del tooltip: el detalle completo no cabe, pero los tipos si.
function attendanceIncidentSummary(incidents) {
    const tipos = Array.from(new Set(
        incidents.map(incident => attendanceIncidentLabel(incident.kind))
    ));

    return `Incidencia de marcaje: ${tipos.join(", ")}`;
}

/**
 * .Registro el reloj algo este dia?
 *
 * Se pregunta en el acto -sin esperar el calculo del mes- porque decide si el
 * click de la casilla abre el detalle o no hace nada. Mira las marcas PROPIAS
 * del dia: la salida de una noche vive en el dia siguiente, pero ese dia ya
 * tiene su incidencia si algo falta.
 */
function dayHasClockMarks(profileName, keyDay) {
    const rut = getProfiles()
        .find(profile => profile.name === profileName)?.rut;

    return Boolean(rut) &&
        getMarksFor(rut, isoFromKeyDay(keyDay)).length > 0;
}

/**
 * El marcaje de un dia: lo que el reloj registro y lo que se le encontro raro.
 *
 * Es un solo modal a proposito. La insignia de incidencia y el click de la
 * casilla llevaban a dos sitios distintos -uno con el problema y otro con las
 * horas- y para entender un dia habia que abrir los dos. Aqui la incidencia se
 * lee al lado de las marcas que la explican.
 *
 * @param {object} [options]
 * @param {boolean} [options.requireIncidents] no abrir si el dia no tiene
 *   ninguna. Lo usa la insignia, que solo existe cuando las hay.
 */
function openAttendanceIncidentDialog(
    profileName,
    keyDay,
    { requireIncidents = true } = {}
) {
    const incidents = getAttendanceIncidentsForDay(profileName, keyDay);

    if (requireIncidents && !incidents.length) return false;
    if (!incidents.length && !dayHasClockMarks(profileName, keyDay)) {
        return false;
    }

    const backdrop = document.createElement("div");

    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog attendance-incident-dialog" role="dialog" aria-modal="true" aria-labelledby="attendanceIncidentTitle">
            <strong id="attendanceIncidentTitle">Marcaje del día</strong>
            <p>
                ${escapeHTML(profileName)} &middot; ${escapeHTML(replacementDetailDateLabel(isoFromKeyDay(keyDay)))}
            </p>
            ${attendanceMarksSlotHTML()}
            ${incidents.length
                ? `<div class="attendance-incident-list">
                ${incidents.map(incident => `
                    <article class="attendance-incident-item">
                        <span class="attendance-incident-kind">${escapeHTML(attendanceIncidentLabel(incident.kind))}</span>
                        <p>${escapeHTML(incident.detail || "Sin detalle.")}</p>
                    </article>
                `).join("")}
            </div>`
                : ""}
            <p class="leave-detail-note">
                Salen del reporte del reloj control. Se corrigen subiendo una
                planilla nueva o ajustando el marcaje del dia.
            </p>
            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="cancel">
                    Cerrar
                </button>
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
        .querySelector("[data-action='cancel']")
        .onclick = close;

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
    backdrop.querySelector("[data-action='cancel']")?.focus();

    // Las marcas se leen aparte -hay que resolver feriados y turno- y entran
    // cuando estan. El modal ya esta abierto: con la incidencia a la vista, que
    // es lo que se venia a leer.
    //
    // Aqui el hueco se queda aunque no haya marcas: este cuadro es el del
    // marcaje, asi que "este dia no tiene marcas" ES la respuesta.
    void fillAttendanceMarks(backdrop, profileName, keyDay, {
        keepWhenEmpty: true
    });

    return true;
}

/**
 * El hueco donde entran las marcas del reloj de un dia.
 *
 * Lo ponen TODOS los cuadros que hablan de un dia de un trabajador -el permiso,
 * el turno extra, el traslado, la reserva, el marcaje modificado-, porque la
 * pregunta "y a que hora marco" aparece igual en todos. Antes las marcas solo
 * se veian en su propio cuadro, que es el que sale cuando el dia no tiene nada
 * mas que contar: justo los dias mas simples, donde menos falta hacian.
 *
 * Va vacio: lo llena fillAttendanceMarks cuando termina de leerlas, para no
 * retrasar la apertura del cuadro.
 */
function attendanceMarksSlotHTML() {
    return `
        <div class="attendance-marks" data-attendance-marks hidden>
            <div class="attendance-marks-loading">Buscando las marcas...</div>
        </div>`;
}

// Como se lee cada marca en el detalle. La etiqueta es la que apreto el
// trabajador, no la que el turno le asigna: aqui se muestra el registro tal
// cual, que es contra lo que el supervisor contrasta.
function attendanceMarkRowHTML(mark) {
    return `
        <div class="attendance-mark">
            <span>${mark.type === "out" ? "Salida" : "Entrada"}</span>
            <b>${escapeHTML(mark.time)}</b>
            ${mark.iso
                ? `<em>${escapeHTML(replacementDetailDateLabel(mark.iso))}</em>`
                : ""}
        </div>`;
}

/**
 * Llena el hueco de las marcas de un cuadro ya abierto.
 *
 * @param {object} [options]
 * @param {boolean} [options.keepWhenEmpty] dejarlo a la vista aunque el dia no
 *   tenga marcas. Lo usa el cuadro del marcaje, donde eso ES la respuesta; en
 *   los demas el hueco se queda oculto, porque una linea de "no tiene marcas"
 *   en cada permiso y cada turno extra es ruido en los dias en que el reloj
 *   todavia no trae nada.
 */
async function fillAttendanceMarks(
    backdrop,
    profileName,
    keyDay,
    { keepWhenEmpty = false } = {}
) {
    const host = backdrop.querySelector("[data-attendance-marks]");

    if (!host) return;

    try {
        const detail = await attendanceDayMarks(
            getProfiles().find(profile => profile.name === profileName),
            keyDay
        );

        // Se pudo cerrar mientras se buscaba.
        if (!host.isConnected) return;

        if (!detail?.marks?.length) {
            host.hidden = !keepWhenEmpty;
            host.innerHTML = `<div class="attendance-marks-loading">
                Este día no tiene marcas del reloj.
            </div>`;
            return;
        }

        host.hidden = false;
        host.innerHTML = `
            <div class="attendance-marks-turn">
                <span>Turno</span><b>${escapeHTML(detail.turno || "Libre")}</b>
            </div>
            ${detail.marks.map(attendanceMarkRowHTML).join("")}`;
    } catch (error) {
        console.warn("No se pudo leer el marcaje del dia.", error);

        if (!host.isConnected) return;

        host.hidden = !keepWhenEmpty;
        host.innerHTML = `<div class="attendance-marks-loading">
            No se pudo leer el marcaje de este día.
        </div>`;
    }
}

async function openReplacementDetailDialog(
    profileName,
    keyDay,
    replacementId = ""
) {
    // Con un id concreto se abre ESE registro (asi lo piden las insignias del
    // dia); sin id, se muestran todos los del dia.
    const records = replacementId
        ? [
            getReplacementDetailRecord(
                profileName,
                keyDay,
                replacementId
            )
        ].filter(Boolean)
        : getReplacementsForWorkerShift(profileName, keyDay);

    if (!records.length) return false;

    // Solo lectura en Turnos: el detalle sigue siendo consultable (es
    // informacion del turno), pero pierde la accion de anular.
    const canEdit = canEditTarget("calendarPanel");
    const multiple = records.length > 1;
    const backdrop = document.createElement("div");
    const title = multiple
        ? "Turnos asignados del dia"
        : replacementDetailTitle(records[0]);

    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog replacement-detail-dialog ${
            multiple ? "replacement-detail-dialog--multi" : ""
        }" role="dialog" aria-modal="true" aria-labelledby="replacementDetailTitle">
            <strong id="replacementDetailTitle">${escapeHTML(title)}</strong>
            ${canEdit ? `
            <p>
                ${multiple
                    ? "Este dia tiene mas de un turno asignado. Cada uno se anula por separado."
                    : "Para modificar este turno extra debes anular el reemplazo aplicado."}
            </p>
            ` : ""}
            ${multiple
                ? `
                <div class="replacement-detail-list">
                    ${records.map(replacement => `
                        <article class="replacement-detail-card">
                            <div class="replacement-detail-card__head">
                                <strong>${escapeHTML(replacementDetailTurnLabel(replacement))}</strong>
                                <small>${escapeHTML(replacementDetailTitle(replacement))}</small>
                            </div>
                            ${replacementDetailRowsHTML(replacement, profileName)}
                            ${canEdit ? `
                            <button
                                class="leave-detail-undo"
                                type="button"
                                data-action="undo"
                                data-replacement-id="${escapeHTML(String(replacement.id || ""))}"
                            >
                                Anular reemplazo
                            </button>
                            ` : ""}
                        </article>
                    `).join("")}
                </div>
                `
                : replacementDetailRowsHTML(records[0], profileName)}
            ${attendanceMarksSlotHTML()}
            ${canEdit ? `
            <p class="leave-detail-note">
                Al anularlo, se quitara este turno extra del calendario del trabajador que cubre y se actualizara la cobertura del trabajador reemplazado.
            </p>
            ` : ""}
            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="cancel">
                    ${canEdit ? "Cancelar" : "Cerrar"}
                </button>
                ${canEdit && !multiple ? `
                <button
                    class="leave-detail-undo"
                    type="button"
                    data-action="undo"
                    data-replacement-id="${escapeHTML(String(records[0].id || ""))}"
                >
                    Anular reemplazo
                </button>
                ` : ""}
            </div>
        </section>
    `;

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

    backdrop
        .querySelector("[data-action='cancel']")
        .onclick = close;

    backdrop
        .querySelectorAll("[data-action='undo']")
        .forEach(button => {
            const replacement = records.find(record =>
                String(record.id || "") === button.dataset.replacementId
            );

            if (!replacement) return;

            button.onclick = async () => {
                const confirmed = await showConfirm(
                    `Se anulara el reemplazo de ${replacement.worker} para el ${replacementDetailDateLabel(replacement.date)}.`,
                    {
                        title: "Anular reemplazo",
                        tone: "danger",
                        confirmText: "Anular reemplazo",
                        cancelText: "Volver",
                        destructive: true
                    }
                );

                if (!confirmed) return;

                await withBusyState(async () => {
                    if (typeof window.pushUndoState === "function") {
                        window.pushUndoState("Anular reemplazo");
                    }

                    if (replacement.isLoan && replacement.interUnitLoanId) {
                        await cancelInterUnitLoan(
                            replacement.interUnitLoanId,
                            replacement.hostWorkspaceId || ""
                        );
                    }

                    const canceled = cancelReplacementById(
                        replacement.id,
                        {
                            reason: "supervisor_canceled",
                            details: "Reemplazo anulado desde el calendario."
                        }
                    );

                    if (!canceled) {
                        alert("No se pudo anular el reemplazo. Es posible que ya haya cambiado.");
                        return;
                    }

                    close();

                    await updateDayCell(
                        canceled.worker || profileName,
                        canceled.date || keyDay
                    );

                    if (canceled.replaced) {
                        await updateDayCell(
                            canceled.replaced,
                            canceled.date || keyDay
                        );
                    }

                    updateTimelineCells(
                        canceled.worker || profileName,
                        [keyDay]
                    );

                    if (canceled.replaced) {
                        updateTimelineCells(
                            canceled.replaced,
                            [keyDay]
                        );
                    }

                    // Quedan mas turnos asignados ese dia: se vuelve a abrir el
                    // detalle con los que siguen vigentes, para poder anular el
                    // siguiente sin tener que buscar la casilla otra vez.
                    if (
                        multiple &&
                        getReplacementsForWorkerShift(profileName, keyDay).length
                    ) {
                        await openReplacementDetailDialog(profileName, keyDay);
                    }
                }, {
                    label: "Anulando reemplazo..."
                });
            };
        });

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
    backdrop
        .querySelector("[data-action='undo']")
        ?.focus();
    void fillAttendanceMarks(backdrop, profileName, keyDay);

    return true;
}

window.openReplacementDetailDialog = openReplacementDetailDialog;

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

function shiftMoveCreatedLabel(value) {
    const date = new Date(value || "");

    if (Number.isNaN(date.getTime())) return "Sin registro";

    return date.toLocaleString(
        "es-CL",
        {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        }
    );
}

function restoreShiftMoveValue(
    object,
    keyDay,
    hadValue,
    previousValue
) {
    if (hadValue) {
        object[keyDay] = previousValue;
    } else {
        delete object[keyDay];
    }
}

function fallbackUndoShiftMoveValues(move) {
    const complement = Number(move.destinationTurn) === TURNO.LARGA
        ? TURNO.NOCHE
        : TURNO.LARGA;

    return {
        sourceHadData: true,
        sourcePreviousData: Number(move.sourceTurn) || TURNO.LIBRE,
        sourceHadBase: true,
        sourcePreviousBase: Number(move.sourceTurn) || TURNO.LIBRE,
        sourceHadBlocked: true,
        sourcePreviousBlocked: true,
        targetHadData:
            move.targetKey === move.sourceKey ||
            move.combinedInto24 === true,
        targetPreviousData:
            move.targetKey === move.sourceKey
                ? Number(move.sourceTurn) || TURNO.LIBRE
                : move.combinedInto24
                    ? complement
                    : TURNO.LIBRE,
        targetHadBase:
            move.targetKey === move.sourceKey ||
            move.combinedBaseComplement === true,
        targetPreviousBase:
            move.targetKey === move.sourceKey
                ? Number(move.sourceTurn) || TURNO.LIBRE
                : move.combinedBaseComplement
                    ? complement
                    : TURNO.LIBRE,
        targetHadBlocked: true,
        targetPreviousBlocked: true
    };
}

function undoShiftMoveCalendarState(move) {
    const profile = move?.profile || "";

    if (!profile) return false;

    const undo = move.hasUndoSnapshot
        ? move
        : {
            ...move,
            ...fallbackUndoShiftMoveValues(move)
        };
    const data = getProfileData(profile);
    const baseData = getBaseProfileData(profile);
    const blocked = getBlockedDays(profile);

    restoreShiftMoveValue(
        data,
        move.sourceKey,
        undo.sourceHadData,
        Number(undo.sourcePreviousData) || TURNO.LIBRE
    );
    restoreShiftMoveValue(
        baseData,
        move.sourceKey,
        undo.sourceHadBase,
        Number(undo.sourcePreviousBase) || TURNO.LIBRE
    );
    restoreShiftMoveValue(
        blocked,
        move.sourceKey,
        undo.sourceHadBlocked,
        Boolean(undo.sourcePreviousBlocked)
    );

    if (move.targetKey !== move.sourceKey) {
        restoreShiftMoveValue(
            data,
            move.targetKey,
            undo.targetHadData,
            Number(undo.targetPreviousData) || TURNO.LIBRE
        );
        restoreShiftMoveValue(
            baseData,
            move.targetKey,
            undo.targetHadBase,
            Number(undo.targetPreviousBase) || TURNO.LIBRE
        );
        restoreShiftMoveValue(
            blocked,
            move.targetKey,
            undo.targetHadBlocked,
            Boolean(undo.targetPreviousBlocked)
        );
    }

    saveProfileData(data, profile);
    saveBaseProfileData(baseData, profile);
    saveBlockedDays(blocked, profile);

    return true;
}

async function openShiftMoveDetailDialog(marker) {
    const move = marker?.move || null;

    if (!move) return false;

    const details = [
        ["Trabajador", move.profile],
        ["Origen", formatShiftMoveDate(move.sourceKey)],
        ["Turno origen", shiftMoveTurnLabel(move.sourceTurn)],
        ["Destino", formatShiftMoveDate(move.targetKey)],
        ["Turno destino", shiftMoveTurnLabel(move.destinationTurn)],
        move.combinedInto24
            ? [
                "Combinacion",
                move.combinedBaseComplement
                    ? "Formo 24 con otro turno base"
                    : "Formo 24 con turno extra"
            ]
            : null,
        ["Registrado", shiftMoveCreatedLabel(move.createdAt)],
        // Quien lo hizo. Sale del LOG de auditoria, no del propio movimiento:
        // los traslados viejos no guardaron actor, y ahi cae en "No registrado"
        // en vez de mostrar un dato inventado.
        (() => {
            const audit = getShiftMoveAuditInfo(
                move.profile,
                move.sourceKey,
                move.targetKey
            );

            // El tercer elemento dice que el valor ya viene como HTML: el
            // correo del usuario va en su propia linea.
            return audit ? ["Movido por", actorLabelHTML(audit), true] : null;
        })()
    ].filter(Boolean);
    const backdrop = document.createElement("div");

    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog replacement-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="shiftMoveDetailTitle">
            <strong id="shiftMoveDetailTitle">Turno movido</strong>
            <p>
                Este dia tiene un movimiento de turno aplicado.
            </p>
            <div class="leave-detail-rows replacement-detail-rows">
                ${details.map(([label, value, isHTML]) => `
                    <div>
                        <span>${escapeHTML(label)}</span>
                        <b>${isHTML ? value : escapeHTML(value)}</b>
                    </div>
                `).join("")}
            </div>
            ${attendanceMarksSlotHTML()}
            <p class="leave-detail-note">
                Al anularlo se restauran el dia de origen y el dia de destino al estado previo al movimiento.
            </p>
            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="cancel">
                    Cancelar
                </button>
                <button class="leave-detail-undo" type="button" data-action="undo">
                    Anular movimiento
                </button>
            </div>
        </section>
    `;

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

    backdrop
        .querySelector("[data-action='cancel']")
        .onclick = close;

    backdrop
        .querySelector("[data-action='undo']")
        .onclick = async () => {
            const confirmed = await showConfirm(
                `Se anulara el movimiento de turno de ${move.profile}.`,
                {
                    title: "Anular movimiento",
                    tone: "danger",
                    confirmText: "Anular movimiento",
                    cancelText: "Volver",
                    destructive: true
                }
            );

            if (!confirmed) return;

            await withBusyState(async () => {
                if (typeof window.pushUndoState === "function") {
                    window.pushUndoState("Anular movimiento de turno");
                }

                const canceled = cancelShiftMoveById(move.id);

                if (!canceled) {
                    alert("No se pudo anular el movimiento. Es posible que ya haya cambiado.");
                    return;
                }

                undoShiftMoveCalendarState(move);

                addAuditLog(
                    AUDIT_CATEGORY.CALENDAR,
                    "Anulo movimiento de turno",
                    `${move.profile}: anulo el movimiento del ${formatShiftMoveDate(move.sourceKey)} al ${formatShiftMoveDate(move.targetKey)}.`,
                    {
                        profile: move.profile,
                        shiftMoveId: move.id,
                        sourceKey: move.sourceKey,
                        targetKey: move.targetKey
                    }
                );

                close();

                await updateDayCells(
                    move.profile,
                    [move.sourceKey, move.targetKey],
                    { updateSummary: true }
                );
                updateTimelineCells(
                    move.profile,
                    [move.sourceKey, move.targetKey]
                );
            }, {
                label: "Anulando movimiento..."
            });
        };

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
    backdrop
        .querySelector("[data-action='undo']")
        ?.focus();
    // El dia que se abrio, no los dos: el marcador dice si se pulso el origen
    // o el destino, y las marcas son de una fecha concreta.
    void fillAttendanceMarks(
        backdrop,
        move.profile,
        marker.role === "source" ? move.sourceKey : move.targetKey
    );

    return true;
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
    if (type === "training") return "Capacitaci\u00f3n";
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

function addCalendarDaysKey(keyDay, offset = 1) {
    const date = dateFromKeyDay(keyDay);

    if (Number.isNaN(date.getTime())) return "";

    date.setDate(date.getDate() + offset);
    return key(date.getFullYear(), date.getMonth(), date.getDate());
}

function leaveValueMatchesType(value, type) {
    if (!value) return false;

    if (type === "admin") return value === 1;
    if (type === "half_admin_morning") {
        return value === "0.5M" || value === 0.5;
    }
    if (type === "half_admin_afternoon") {
        return value === "0.5T" || value === 0.5;
    }
    if (type === "half_admin") return value === 0.5;
    if (type === "legal" || type === "comp") return Boolean(value);

    return esAusenciaInjustificada(value)
        ? type === "unjustified_absence"
        : getAbsenceType(value) === type;
}

function contiguousLeaveKeysForDay(sourceMap, type, keyDay) {
    if (
        !sourceMap ||
        typeof sourceMap !== "object" ||
        !leaveValueMatchesType(sourceMap[keyDay], type)
    ) {
        return [];
    }

    let start = keyDay;
    let previous = addCalendarDaysKey(start, -1);

    while (
        previous &&
        leaveValueMatchesType(sourceMap[previous], type)
    ) {
        start = previous;
        previous = addCalendarDaysKey(start, -1);
    }

    const keys = [];
    let cursor = start;
    let guard = 0;

    while (
        cursor &&
        guard < 750 &&
        leaveValueMatchesType(sourceMap[cursor], type)
    ) {
        keys.push(cursor);
        cursor = addCalendarDaysKey(cursor, 1);
        guard++;
    }

    return keys;
}

function leaveCancellationKeysForDay({
    sourceMap,
    type,
    keyDay,
    info = null
} = {}) {
    const explicitKeys = Array.isArray(info?.keys)
        ? info.keys.filter(key =>
            leaveValueMatchesType(sourceMap?.[key], type)
        )
        : [];

    if (explicitKeys.includes(keyDay)) return explicitKeys;

    return contiguousLeaveKeysForDay(sourceMap, type, keyDay);
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
        `Usuario: ${actorLabelText(info)}`,
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

/* =========================================================
   Documentos de respaldo de una casilla

   Un mismo cuadro sirve para adjuntar y para ver, porque son la misma pantalla
   en dos momentos distintos: si no hay documentos muestra el selector, y si los
   hay muestra la lista con la opcion de agregar otro.

   Lo usan dos origenes con el mismo aspecto: el respaldo de una licencia medica
   (que vive en leaveAttachments, atado al registro del LOG) y el documento de un
   memorandum (que vive en el propio memorandum y por eso se ve tambien desde el
   menu MEMOS). La diferencia queda en las funciones que se le pasan; el cuadro
   no sabe de cual de los dos se trata.
========================================================= */

function attachmentSizeLabel(size) {
    const bytes = Number(size) || 0;

    return bytes >= 1024 * 1024
        ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.max(Math.round(bytes / 1024), 1)} KB`;
}

function leaveAttachmentRowHTML(attachment) {
    return `
        <div class="leave-doc-row">
            <button class="leave-doc-open" type="button"
                data-open-leave-doc="${escapeHTML(String(attachment.id))}">
                <span>
                    <strong>${escapeHTML(attachment.name || "Documento")}</strong>
                    <small>${escapeHTML(attachmentSizeLabel(attachment.size))}</small>
                </span>
            </button>
            <button class="leave-doc-remove" type="button"
                data-remove-leave-doc="${escapeHTML(String(attachment.id))}"
                aria-label="Eliminar documento">&times;</button>
        </div>`;
}

/**
 * Cuadro de documentos de respaldo.
 *
 * @param {{
 *   profile: string,
 *   title?: string,
 *   canEdit?: boolean,
 *   accept: string,
 *   emptyText: string,
 *   note: string,
 *   removeQuestion: string,
 *   list: () => Array<Object>,
 *   add: (file: File) => Promise<any>,
 *   open: (attachment: Object) => Promise<any>,
 *   remove: (attachmentId: string) => Promise<any>,
 *   onClose?: () => void
 * }} options
 */
function openDocumentsDialog({
    profile,
    title = "Documento de respaldo",
    canEdit = true,
    accept,
    emptyText,
    note,
    removeQuestion,
    list,
    add,
    open,
    remove,
    onClose = null
}) {
    const backdrop = document.createElement("div");

    backdrop.className = "turn-change-dialog-backdrop";

    const render = () => {
        const attachments = list();

        backdrop.innerHTML = `
            <section class="turn-change-dialog leave-detail-dialog" role="dialog" aria-modal="true">
                <strong>${escapeHTML(title)}</strong>
                <div class="leave-detail-rows">
                    <div><span>Trabajador</span><b>${escapeHTML(profile)}</b></div>
                </div>
                ${attachments.length
                    ? `<div class="leave-doc-list">${attachments.map(leaveAttachmentRowHTML).join("")}</div>`
                    : `<p class="leave-detail-note">${escapeHTML(emptyText)}</p>`}
                ${canEdit ? `
                    <label class="leave-doc-add">
                        <input type="file" accept="${accept}" data-leave-doc-input>
                        <span>${attachments.length ? "Adjuntar otro documento" : "Adjuntar documento"}</span>
                    </label>
                    <p class="leave-detail-note">${escapeHTML(note)}</p>
                ` : ""}
                <div class="turn-change-dialog__actions">
                    <button class="ghost-button" type="button" data-action="close">Cerrar</button>
                </div>
            </section>
        `;
        bind();
    };

    // onClose lo usa quien abre el cuadro desde fuera del calendario (el
    // registro del perfil), para redibujar su boton con la cuenta nueva.
    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
        onClose?.();
    };
    const onKeydown = event => {
        if (event.key === "Escape") close();
    };

    function bind() {
        backdrop
            .querySelector("[data-action='close']")
            ?.addEventListener("click", close);

        const input = backdrop.querySelector("[data-leave-doc-input]");

        input?.addEventListener("change", async () => {
            const file = input.files?.[0];

            // Se limpia siempre: elegir DOS VECES el mismo archivo no dispara
            // "change" y parece que no pasa nada.
            input.value = "";

            if (!file) return;

            await withBusyState(async () => {
                try {
                    await add(file);
                    render();
                } catch (error) {
                    console.warn("No se pudo adjuntar el documento.", error);
                    alert(error?.message || "No se pudo adjuntar el documento.");
                }
            }, { label: "Subiendo documento..." });
        });

        backdrop
            .querySelectorAll("[data-open-leave-doc]")
            .forEach(button => {
                button.addEventListener("click", async () => {
                    const attachment = list().find(item =>
                        String(item.id) === button.dataset.openLeaveDoc
                    );

                    if (!attachment) return;

                    button.disabled = true;

                    try {
                        await open(attachment);
                    } catch (error) {
                        console.warn("No se pudo abrir el documento.", error);
                        alert(error?.message || "No se pudo abrir el documento.");
                    } finally {
                        button.disabled = false;
                    }
                });
            });

        backdrop
            .querySelectorAll("[data-remove-leave-doc]")
            .forEach(button => {
                button.addEventListener("click", async () => {
                    if (!canEdit) return;

                    const confirmed = await showConfirm(
                        removeQuestion,
                        {
                            title: "Eliminar documento",
                            confirmText: "Eliminar",
                            destructive: true
                        }
                    );

                    if (!confirmed) return;

                    try {
                        await remove(button.dataset.removeLeaveDoc);
                        render();
                    } catch (error) {
                        console.warn("No se pudo eliminar el documento.", error);
                        alert(error?.message || "No se pudo eliminar el documento.");
                    }
                });
            });
    }

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) close();
    });

    render();
    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
}

/**
 * Cuadro de respaldos de una licencia.
 *
 * @param {{profile: string, logId: string, title?: string, canEdit?: boolean, onClose?: () => void}} options
 */
function openLeaveDocumentsDialog({
    profile,
    logId,
    title = "Respaldo de la licencia",
    canEdit = true,
    onClose = null
}) {
    if (!profile || !logId) {
        alert(
            "Esta licencia no tiene un registro que permita asociarle documentos."
        );
        return;
    }

    openDocumentsDialog({
        profile,
        title,
        canEdit,
        accept: LEAVE_ATTACHMENT_ACCEPT,
        emptyText: "Aun no hay documentos adjuntos para esta licencia.",
        note:
            "Imagen o PDF, hasta 10 MB. El archivo queda guardado y se " +
            "puede volver a abrir desde aca.",
        removeQuestion: "¿Eliminar este documento de la licencia?",
        list: () => getLeaveAttachments(profile, logId),
        add: file => addLeaveAttachment(profile, logId, file),
        open: attachment => openLeaveAttachment(attachment),
        remove: attachmentId =>
            removeLeaveAttachment(profile, logId, attachmentId),
        onClose
    });
}

/**
 * Cuadro del documento de un memorandum.
 *
 * El documento es UNO para todo el permiso: se sube una vez y se ve desde
 * cualquiera de las casillas que abarca, y tambien desde el menu MEMOS. Por eso
 * lo que lo guarda es el memorandum y no el dia.
 *
 * @param {{profile: string, memoId: string, title?: string, canEdit?: boolean, onClose?: () => void}} options
 */
function openMemoDocumentsDialog({
    profile,
    memoId,
    title = "Documento del memorandum",
    canEdit = true,
    onClose = null
}) {
    if (!profile || !memoId) {
        alert(
            "Este permiso no tiene un memorandum al que asociarle documentos."
        );
        return;
    }

    openDocumentsDialog({
        profile,
        title,
        canEdit,
        accept: MEMO_ATTACHMENT_ACCEPT,
        emptyText: "Aun no hay documentos adjuntos para este memorandum.",
        note:
            "El documento queda asociado a todos los dias del permiso y " +
            "aparece tambien en el menu MEMOS.",
        removeQuestion:
            "¿Eliminar este documento del memorandum? Tambien dejara " +
            "de verse en las casillas del calendario.",
        list: () => getMemoDocuments(memoId),
        add: file => addMemoDocument(memoId, file),
        open: attachment => openMemoDocument(memoId, attachment.id),
        remove: documentId => removeMemoDocument(memoId, documentId),
        onClose
    });
}

window.openLeaveDocumentsDialog = openLeaveDocumentsDialog;
window.openMemoDocumentsDialog = openMemoDocumentsDialog;

function leaveMapsForProfile(profile) {
    return {
        admin: getJSON(`admin_${profile}`, {}),
        legal: getJSON(`legal_${profile}`, {}),
        comp: getJSON(`comp_${profile}`, {}),
        absences: getJSON(`absences_${profile}`, {})
    };
}

/**
 * A que documento de respaldo llega una casilla, y cuantos hay ya subidos.
 *
 * Son dos origenes distintos y ninguna casilla tiene los dos: una licencia
 * medica guarda su respaldo contra el registro del LOG que la aplico, y el
 * resto de los permisos lo guardan en el memorandum que se genero al
 * aplicarlos. Un permiso de 10 dias tiene UN memorandum, asi que las 10
 * casillas llegan al mismo documento.
 *
 * @param {string} profile
 * @param {string} keyDay
 * @param {{admin: Object, legal: Object, comp: Object, absences: Object}} [maps]
 * @returns {{kind: string, label: string, count: number, logId?: string, memoId?: string}|null}
 */
function dayDocumentsTarget(profile, keyDay, maps = null) {
    if (!profile || !keyDay) return null;

    const { admin, legal, comp, absences } =
        maps || leaveMapsForProfile(profile);
    const type = leaveTypeForDay(keyDay, admin, legal, comp, absences);

    if (!type) return null;

    if (leaveTypeNeedsDocument(type)) {
        // Recorrer el LOG solo aca: el resto de los permisos no lo necesita, y
        // este cuadro se vuelve a dibujar cada vez que se cambia el alcance de
        // las sugerencias de reemplazo.
        const info = getLeaveApplicationInfo({
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
        const logId = String(info?.logId || "");

        // Sin registro en el LOG no hay a que colgar el archivo: la licencia se
        // aplico antes del LOG actual o su registro fue evicto.
        if (!logId) return null;

        return {
            kind: "leave",
            label: leaveLabelForType(type),
            logId,
            count: getLeaveAttachments(profile, logId).length
        };
    }

    const memo = findLeaveMemoForDay({ profile, leaveType: type, keyDay });

    // Los permisos aplicados antes de que existieran los memorandum no tienen
    // a que asociar el documento; no se ofrece el boton.
    if (!memo) return null;

    return memoDocumentsTarget(memo, leaveLabelForType(type));
}

// El documento vive en el modulo MEMOS, no en el calendario: quien no puede ver
// ese menu tampoco puede leer el archivo (lo rechaza storage.rules), asi que el
// boton no se ofrece.
function memoDocumentsTarget(memo, fallbackLabel) {
    if (!memo || !canViewTarget("memosPanel")) return null;

    return {
        kind: "memo",
        label: memo.typeLabel || fallbackLabel,
        memoId: memo.id,
        count: memo.documents.length
    };
}

// El memorandum de un marcaje incompleto es de un dia solo, asi que se resuelve
// aparte del de los permisos.
function clockDocumentsTarget(profile, keyDay) {
    return memoDocumentsTarget(
        findClockMemoForDay({ profile, keyDay }),
        "Marcaje"
    );
}

// Un solo lugar decide el texto: los cuadros del calendario y el registro del
// perfil tienen que decir lo mismo del mismo permiso.
function documentsButtonLabel(target) {
    return target.count
        ? (target.count > 1 ? "Ver documentos" : "Ver documento")
        : "Adjuntar documento";
}

function documentsButtonHTML(target) {
    if (!target) return "";

    return `<button class="secondary-button" type="button" data-action="leave-docs">${documentsButtonLabel(target)}</button>`;
}

function openDocumentsForTarget(target, profile, { onClose = null } = {}) {
    if (!target) return;

    if (target.kind === "leave") {
        openLeaveDocumentsDialog({
            profile,
            logId: target.logId,
            title: `${target.label} · respaldo`,
            canEdit: canEditTarget("calendarPanel"),
            onClose
        });
        return;
    }

    openMemoDocumentsDialog({
        profile,
        memoId: target.memoId,
        title: `${target.label} · documento`,
        // El archivo se guarda en el memorandum: manda el permiso de MEMOS, no
        // el del calendario desde el que se abrio el cuadro.
        canEdit: canEditTarget("memosPanel"),
        onClose
    });
}

/* =========================================================
   Documentos desde el registro del perfil

   El registro de vacaciones/ausencias del perfil lista los mismos permisos que
   el calendario, y cada uno tiene que llegar al MISMO documento que sus
   casillas. Se resuelve con el primer dia del permiso, que es una casilla mas
   de ese permiso: da la misma licencia o el mismo memorandum, y hereda las
   mismas reglas (sin registro en el LOG o sin permiso de MEMOS, no hay boton).
========================================================= */

/**
 * Texto del boton de documentos de cada permiso del registro.
 *
 * @param {string} profile
 * @param {Array<string>} keyDays primer dia de cada permiso
 * @returns {Map<string, string>} solo los dias que tienen a donde colgar un
 *   documento
 */
export function getLeaveRecordDocumentButtons(profile, keyDays) {
    const maps = leaveMapsForProfile(profile);
    const buttons = new Map();

    keyDays.forEach(keyDay => {
        const target = dayDocumentsTarget(profile, keyDay, maps);

        if (!target) return;

        buttons.set(keyDay, documentsButtonLabel(target));
    });

    return buttons;
}

/**
 * Abre el cuadro de documentos del permiso que empieza en keyDay.
 *
 * El destino se vuelve a resolver al hacer click, como en el cuadro de
 * reemplazo: entre que se dibujo el registro y el click pudo llegar un
 * documento, o anularse el permiso, desde otra sesion.
 *
 * @param {string} profile
 * @param {string} keyDay
 * @param {{onClose?: () => void}} [options]
 */
export function openLeaveRecordDocuments(
    profile,
    keyDay,
    { onClose = null } = {}
) {
    const target = dayDocumentsTarget(profile, keyDay);

    // El permiso ya no tiene a donde colgar un documento: se redibuja el
    // registro y el boton desaparece.
    if (!target) {
        onClose?.();
        return;
    }

    openDocumentsForTarget(target, profile, { onClose });
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
    const noCoverage = isNoCoverageDay(profile, keyDay);
    const noCoverageInfo = noCoverage
        ? getNoCoverageAuditInfo(profile, keyDay)
        : null;
    const noCoverageReason = noCoverage
        ? getNoCoverageReason(profile, keyDay)
        : "";

    // Documento de respaldo: el de la licencia si es una licencia, y si no el
    // del memorandum que genero el permiso. El boton cambia segun si ya hay
    // algo adjunto, para que se vea de una que falta subirlo.
    const documentsTarget = dayDocumentsTarget(profile, keyDay, {
        admin,
        legal,
        comp,
        absences
    });
    const leaveDocsButton = documentsButtonHTML(documentsTarget);

    // Quitar la cobertura sin anular el permiso: el permiso sigue, pero el
    // turno vuelve a quedar pendiente de reemplazo.
    const coveringReplacements =
        getActiveReplacementsForCoveredShift(profile, keyDay);
    const dropCoverButton = coveringReplacements.length
        ? `<button class="secondary-button" type="button" data-action="drop-cover">Quitar reemplazo</button>`
        : "";

    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog leave-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="leaveDetailTitle">
            <strong id="leaveDetailTitle">${escapeHTML(label)}</strong>
            <div class="leave-detail-rows">
                <div><span>Trabajador</span><b>${escapeHTML(profile)}</b></div>
                <div><span>Fecha</span><b>${escapeHTML(leaveDateLabelFromKey(keyDay))}</b></div>
                <div><span>Aplicado</span><b>${escapeHTML(info?.createdAtLabel || "Sin registro")}</b></div>
                <div><span>Por</span><b>${actorLabelHTML(info)}</b></div>
                ${covering.length
                    ? `<div><span>Cubre</span><b>${escapeHTML(covering.join(", "))}</b></div>`
                    : ""}
            </div>
            ${noCoverage ? `
                <div class="leave-detail-nocoverage">
                    <strong>Marcado como "No requiere cobertura"</strong>
                    <div class="leave-detail-rows">
                        <div><span>Asignado</span><b>${escapeHTML(noCoverageInfo?.createdAtLabel || "Sin registro")}</b></div>
                        <div><span>Por</span><b>${actorLabelHTML(noCoverageInfo)}</b></div>
                        ${noCoverageReason
                            ? `<div><span>Motivo</span><b>${escapeHTML(noCoverageReason)}</b></div>`
                            : ""}
                    </div>
                    <p class="leave-detail-note">
                        "Sí requiere cobertura" revierte esta marca: vuelve a aparecer la alerta para asignar un reemplazo.
                    </p>
                </div>
            ` : `
                <p class="leave-detail-note">
                    ${canUndo
                        ? "Anular quitara el permiso/ausencia, cancelara los reemplazos asociados, notificara a los trabajadores afectados y dejara el registro del LOG marcado como anulado."
                        : "Este permiso no tiene un registro en el LOG que permita anularlo automaticamente."}
                </p>
            `}
            ${attendanceMarksSlotHTML()}
            <div class="turn-change-dialog__actions ${noCoverage ? "leave-detail-actions--stacked" : ""}">
                ${noCoverage
                    ? `<button class="primary-button" type="button" data-action="require-coverage">Sí requiere cobertura</button>`
                    : ""}
                ${canUndo
                    ? `<button class="leave-detail-undo" type="button" data-action="undo">Anular permiso</button>`
                    : ""}
                ${dropCoverButton}
                ${leaveDocsButton}
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
        .querySelector("[data-action='leave-docs']")
        ?.addEventListener("click", () => {
            close();
            openDocumentsForTarget(documentsTarget, profile);
        });
    backdrop
        .querySelector("[data-action='require-coverage']")
        ?.addEventListener("click", async () => {
            await withBusyState(async () => {
                if (typeof window.pushUndoState === "function") {
                    window.pushUndoState("Reactivar cobertura");
                }

                setNoCoverageDay(profile, keyDay, false);
                addAuditLog(
                    AUDIT_CATEGORY.CALENDAR,
                    "Reactivo cobertura",
                    `${profile}: ${keyDay} vuelve a requerir cobertura.`,
                    { profile, keyDay }
                );
                close();
                await updateDayCell(profile, keyDay);
                updateTimelineCells(profile, [keyDay]);
                await updateVisibleCalendarDays({ updateSummary: true });
            }, { label: "Guardando..." });
        });
    backdrop
        .querySelector("[data-action='drop-cover']")
        ?.addEventListener("click", async event => {
            const button = event.currentTarget;
            const quienes = coveringReplacements
                .map(replacement => String(replacement.worker || ""))
                .filter(Boolean);
            const confirmed = await showConfirm(
                `Se le quitará el turno a ${quienes.join(", ")} y se le avisará `
                + `por la aplicación. El permiso de ${profile} se mantiene, y `
                + "el turno volverá a quedar pendiente de cobertura.",
                {
                    title: "Quitar reemplazo",
                    tone: "danger",
                    confirmText: "Quitar reemplazo",
                    destructive: true
                }
            );

            if (!confirmed) return;

            button.disabled = true;
            button.textContent = "Quitando...";

            try {
                // Se quitan TODOS los que cubrian: dejar uno a medias deja el
                // turno cubierto en parte y sin la alerta que lo delata.
                const quitados = coveringReplacements
                    .map(replacement => cancelReplacementById(replacement.id, {
                        reason: "coverage_removed",
                        details:
                            `El supervisor quito la cobertura de ${profile} `
                            + `del ${leaveDateLabelFromKey(keyDay)}.`
                    }))
                    .filter(Boolean);

                if (!quitados.length) {
                    button.disabled = false;
                    button.textContent = "Quitar reemplazo";
                    alert(
                        "No se pudo quitar el reemplazo. Es posible que ya no este vigente."
                    );
                    return;
                }

                close();
                await updateVisibleCalendarDays({ updateSummary: true });
            } catch (error) {
                console.error(error);
                button.disabled = false;
                button.textContent = "Quitar reemplazo";
                alert("Ocurrio un error al quitar el reemplazo.");
            }
        });
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
    void fillAttendanceMarks(backdrop, profile, keyDay);
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
    const trainingCoverageHours =
        getTrainingCoverageHours(profileName, keyDay);

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
            hhee: 0,
            overtimeHours: trainingCoverageHours
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

    // Elegirlo respalda el turno que YA tiene, en vez de agregarle uno.
    if (candidate.backsPendingExtra) {
        attrs.push(`data-backs-pending-extra="true"`);
    }

    return attrs.join(" ");
}

function replacementCandidateWarning(candidate) {
    if (!candidate?.blockedDay) return "";

    return candidate.blockedDay.message ||
        "El trabajador solicito no hacer reemplazos ni cambios de turno en esta fecha.";
}

// Aviso corto que va pegado al estado del candidato ("Segundo libre", "Diurno").
function candidateNextDayShiftNote(candidate) {
    const turn = Number(candidate?.nextDayMorningShift) || TURNO.LIBRE;

    if (!turn) return "";

    return `Al día siguiente tiene turno ${turnoReplacementLabel(turn)}.`;
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


// Texto de estado del candidato en la lista de reemplazos. Prioriza la posicion
// en la rotativa (3er/4to turno); el diurno se muestra como "Diurno" sin prefijo.
function candidateStateLabel(candidate, pendingRequest) {
    if (pendingRequest) {
        // Lo que antes decia la lista separada de solicitudes enviadas, en la
        // misma tarjeta: a quien se le pidio y cuanto le queda.
        const left = formatRequestTimeLeft(pendingRequest.expiresAt);

        return left
            ? `Solicitud pendiente · queda ${left}`
            : "Solicitud pendiente";
    }

    if (candidate.positionLabel) return candidate.positionLabel;
    if (candidate.currentState === TURNO.DIURNO) return "Diurno";
    if (candidate.isFree) return "Libre ese dia";

    return `Turno actual: ${turnoReplacementLabel(candidate.currentState)}`;
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

        // Un respaldo SOLO se anula si el turno nuevo ya no contiene el tramo
        // que respaldaba. Antes se anulaban todos: agregar una Noche sobre un
        // Diurno que ya tenia su motivo (Diurno -> D+N) borraba ese motivo y el
        // modal volvia a pedirlo en blanco.
        if (
            turnoExtraCubreTurno(
                nextTurn,
                codeToTurno(replacement.turno)
            )
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

// Un marcaje pertenece al turno sobre el que se hizo. Si la edicion directa deja
// la casilla sin turno, la marca ya no describe nada; y si la casilla vuelve a
// tener turno despues de haber quedado libre, la marca vieja no puede quedar
// pegada al turno nuevo. En ambos casos se elimina.
function dropClockMarkForTurnChange(
    profileName,
    keyDay,
    previousTurn,
    nextTurn
) {
    if (
        clockMarkAppliesToTurn(previousTurn) &&
        clockMarkAppliesToTurn(nextTurn)
    ) {
        return false;
    }

    if (!clearClockMark(profileName, keyDay)) return false;

    addAuditLog(
        AUDIT_CATEGORY.CALENDAR,
        "Elimino marcaje de reloj control",
        `${profileName}: se borro el marcaje del ${keyDay} porque el turno paso de ${turnoLabel(previousTurn) || "Libre"} a ${turnoLabel(nextTurn) || "Libre"}.`,
        {
            profile: profileName,
            keyDay,
            previousTurn,
            nextTurn
        }
    );

    return true;
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

    // El calculo vive en replacementCandidates.js porque lo comparte con la
    // Cloud Function que hace avanzar la cobertura automatica. Aqui se le pasa
    // el recorrido cooperativo -que cede el hilo entre trabajador y trabajador
    // para no congelar la pagina- y el corte por peticion obsoleta.
    const built = await buildReplacementCandidates(profileName, keyDay, {
        neededTurn,
        scope,
        holidays,
        runRange: runCooperativeRange,
        shouldContinue: () => requestId === replacementCandidateRequest
    });

    if (!built.completed) return null;

    try {
        const result = await searchReplacementsInWorker({
            mode: "turnoplus-prepared",
            candidates: built.candidates
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


/**
 * Motor de candidatos para la cobertura automatica por etapas.
 *
 * autoCoverage.js lleva el reloj de las etapas pero no sabe calcular
 * candidatos: eso necesita el DOM, los feriados y el worker de busqueda, que
 * viven aca. Se lo entrega por este proveedor en vez de importarlo, para que el
 * modulo del reloj no dependa de calendar.js.
 *
 * Devuelve la lista COMPLETA (sin filtrar por etapa): cada candidato ya trae
 * `blockedDay`, `nextDayMorningShift`, `hhee` y `exceedsDiurnalLimit` medidos
 * contra el mes del turno, que es lo que las etapas necesitan para elegir.
 */
setAutoCoverageCandidateProvider(async (profileName, keyDay) => {
    const neededTurn = getReplacementNeededTurn(profileName, keyDay);

    // Ojo con la diferencia: `neededTurn` vacio significa que ya no hay nada
    // que cubrir y la campaña debe cerrarse, mientras que `null` significa que
    // el calculo quedo obsoleto y hay que reintentarlo. Devolver null en los dos
    // casos dejaba reintentando el barrido completo de la unidad cada minuto.
    if (!neededTurn) return { neededTurn: 0, candidates: [], absenceType: "" };

    const candidates = await getReplacementCandidates(profileName, keyDay);

    if (!candidates) return null;

    return {
        neededTurn,
        candidates,
        absenceType: getAbsenceLabelForProfileDate(profileName, keyDay)
    };
});

// El boton de la tarjeta de inicio. Ya no manda una tanda unica: abre la
// campaña por etapas de autoCoverage.js, que se encarga del resto.
window.runAutomaticCoverage = async (profileName, keyDay) => {
    const result = await startAutoCoverage(profileName, keyDay);

    if (result?.status === "ok") {
        await updateDayCell(profileName, keyDay);
        updateTimelineCells(profileName, [keyDay]);
    }

    return result;
};

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
    linkedStatus = "",
    optionsOpen = false,
    preassignMode = false,
    // Cupo por rotativa incompleta. Cambia el encabezado: no hay una persona
    // ausente que nombrar, sino un grupo al que le falta alguien.
    rota = null
}) {
    // Documento de respaldo, junto a "Anular permiso": si todavia no hay
    // documento el boton invita a subirlo, y si ya lo hay lo abre. Este modal es
    // el que se abre al clickear la casilla mientras el turno esta sin cubrir,
    // asi que sin esto el documento del permiso quedaba fuera de alcance
    // justamente en los dias que mas se consultan.
    const leaveDocsButton = documentsButtonHTML(
        dayDocumentsTarget(profileName, keyDay)
    );

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
            const nextDayNote = candidateNextDayShiftNote(candidate);
            // Sin este aviso, quien mira la lista no entiende por que esa
            // persona quedo al final.
            const limitNote = candidate.exceedsDiurnalLimit
                ? `Superaria las ${MAX_MONTHLY_DIURNAL_OVERTIME} h extras diurnas del mes.`
                : "";
            const candidateHours = candidate.isLinked
                ? "<b>Disponible</b>"
                : `
                    <b>${formatCandidateHours(candidate.hhee)} HHEE</b>
                    <small class="replacement-candidate-hours">
                        D: ${formatCandidateHours(candidate.hheeDiurnas)}h · N: ${formatCandidateHours(candidate.hheeNocturnas)}h
                    </small>
                `;

            // El boton de anular va como HERMANO de la tarjeta, no dentro: la
            // tarjeta es un <button> (o un <label>), y anidar un boton adentro
            // seria invalido y ademas dispararia el click de la tarjeta.
            const cancelButton = pendingRequest
                ? `<button class="replacement-candidate-cancel" type="button"
                    data-cancel-request="${escapeHTML(pendingRequest.id)}"
                    title="Anular la solicitud enviada a ${escapeHTML(candidate.profile.name)}">Anular</button>`
                : "";
            const openSlot = pendingRequest
                ? `<div class="replacement-candidate-slot">`
                : "";
            const closeSlot = pendingRequest
                ? `${cancelButton}</div>`
                : "";

            if (isRequestMode) {
                return `
                ${openSlot}
                <label class="replacement-candidate replacement-candidate--request ${candidate.isForced ? "replacement-candidate--forced" : ""} ${candidate.blockedDay ? "replacement-candidate--worker-blocked" : ""} ${nextDayNote ? "replacement-candidate--next-day-shift" : ""} ${limitNote ? "replacement-candidate--over-limit" : ""} ${candidate.backsPendingExtra ? "replacement-candidate--backs-extra" : ""} ${pendingRequest ? "is-disabled" : ""}">
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
                        <small class="replacement-candidate-state">
                            ${escapeHTML(candidateStateLabel(candidate, pendingRequest))}
                            ${nextDayNote ? `<span class="replacement-candidate-next-shift">${escapeHTML(nextDayNote)}</span>` : ""}
                            ${limitNote ? `<span class="replacement-candidate-over-limit">${escapeHTML(limitNote)}</span>` : ""}
                        </small>
                        ${warning ? `<small class="replacement-candidate-warning">${escapeHTML(warning)}</small>` : ""}
                    </span>
                    <span>
                        ${candidate.isLinked ? "<em>Unidad enlazada</em>" : ""}
                        ${candidate.isForced ? "<em>Forzado</em>" : ""}
                        ${candidate.blockedDay ? "<em>Dia bloqueado</em>" : ""}
                        ${candidateHours}
                    </span>
                </label>
                ${closeSlot}
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
            ${openSlot}
            <button
                class="replacement-candidate ${candidate.isForced ? "replacement-candidate--forced" : ""} ${candidate.isLinked ? "replacement-candidate--linked" : ""} ${candidate.blockedDay ? "replacement-candidate--worker-blocked" : ""} ${nextDayNote ? "replacement-candidate--next-day-shift" : ""} ${limitNote ? "replacement-candidate--over-limit" : ""} ${candidate.backsPendingExtra ? "replacement-candidate--backs-extra" : ""} ${pendingRequest ? "is-disabled" : ""}"
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
                    <small class="replacement-candidate-state">
                        ${escapeHTML(candidateStateLabel(candidate, pendingRequest))}
                        ${nextDayNote ? `<span class="replacement-candidate-next-shift">${escapeHTML(nextDayNote)}</span>` : ""}
                            ${limitNote ? `<span class="replacement-candidate-over-limit">${escapeHTML(limitNote)}</span>` : ""}
                    </small>
                    ${warning ? `<small class="replacement-candidate-warning">${escapeHTML(warning)}</small>` : ""}
                    ${candidate.backsPendingExtra
                        ? `<small class="replacement-candidate-backs-extra">
                            Ya tiene un turno agregado en esta fecha y todavía
                            sin motivo. Al elegirlo no se le suma otro: ese
                            turno queda respaldado con este permiso.
                        </small>`
                        : ""}
                </span>
                <span>
                    ${candidate.isLinked ? "<em>Unidad enlazada</em>" : ""}
                    ${candidate.isForced ? "<em>Forzado</em>" : ""}
                    ${candidate.blockedDay ? "<em>Dia bloqueado</em>" : ""}
                    ${candidateHours}
                </span>
            </button>
            ${closeSlot}
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
    // Las solicitudes enviadas NO llevan lista propia: cada una se muestra sobre
    // la tarjeta del candidato al que se le pidio, con su boton de anular. Antes
    // habia dos listas y el mismo trabajador aparecia dos veces.
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
    const scopeControls = [
        `
            <button
                class="replacement-segment ${(!forceMode && !linkedMode) ? "is-active" : ""}"
                type="button"
                data-action="scope-compatible"
                aria-pressed="${(!forceMode && !linkedMode) ? "true" : "false"}"
            >
                Compatibles
            </button>
        `,
        allowCrossRoleSuggestions
            ? `
                <button
                    class="replacement-segment ${forceMode ? "is-active" : ""}"
                    type="button"
                    data-action="toggle-force"
                    aria-pressed="${forceMode ? "true" : "false"}"
                >
                    Otras profesiones
                </button>
            `
            : "",
        allowLinkedSuggestions
            ? `
                <button
                    class="replacement-segment replacement-segment--green ${linkedMode ? "is-active" : ""}"
                    type="button"
                    data-action="linked-units"
                    aria-pressed="${linkedMode ? "true" : "false"}"
                >
                    Unidades enlazadas
                </button>
            `
            : ""
    ].filter(Boolean).join("");
    const assignmentControls = [
        `
            <button
                class="replacement-segment ${(!isRequestMode && !preassignMode) ? "is-active" : ""}"
                type="button"
                data-action="assignment-direct"
                aria-pressed="${(!isRequestMode && !preassignMode) ? "true" : "false"}"
            >
                Asignar ahora
            </button>
        `,
        (!linkedMode && allowWorkerAcceptanceRequest)
            ? `
                <button
                    class="replacement-segment replacement-segment--green ${isRequestMode ? "is-active" : ""}"
                    type="button"
                    data-action="request-mode"
                    aria-pressed="${isRequestMode ? "true" : "false"}"
                >
                    Solicitar aprobaci&oacute;n
                </button>
            `
            : "",
        `
            <button
                type="button"
                class="replacement-segment replacement-segment--amber ${preassignMode ? "is-active" : ""}"
                data-action="preassign-mode"
                aria-pressed="${preassignMode ? "true" : "false"}"
            >
                Preasignar
            </button>
        `
    ].filter(Boolean).join("");
    const optionControls = `
        <div class="replacement-option-row">
            <span class="replacement-option-label">Alcance</span>
            <div class="replacement-segmented">
                ${scopeControls}
            </div>
        </div>
        <div class="replacement-option-row">
            <span class="replacement-option-label">Asignaci&oacute;n</span>
            <div class="replacement-segmented">
                ${assignmentControls}
            </div>
        </div>
        <div class="replacement-coverage-exception ${preassignMode ? "is-disabled" : ""}">
            <span class="replacement-coverage-exception-copy">
                <strong>Excepci&oacute;n de cobertura</strong>
                <small>Oculta la alerta de este d&iacute;a cuando el turno no necesita reemplazo.</small>
            </span>
            <button class="replacement-coverage-button" type="button" data-action="no-coverage" ${preassignMode ? "disabled" : ""}>
                No requiere cobertura
            </button>
        </div>
    `;

    return `
        <div class="turn-change-dialog replacement-dialog" role="dialog" aria-modal="true" aria-labelledby="replacementDialogTitle">
            <div class="replacement-dialog-header">
                <strong id="replacementDialogTitle">Seleccionar reemplazo</strong>
                <button
                    class="replacement-options-icon ${optionsOpen ? "is-open" : ""}"
                    type="button"
                    data-action="toggle-options"
                    aria-expanded="${optionsOpen ? "true" : "false"}"
                    aria-label="Más opciones"
                    title="Más opciones"
                >
                    ${REPLACEMENT_OPTIONS_ICON}
                </button>
            </div>
            <p>
                ${
                    rota
                        ? `El grupo ${escapeHTML(rota.group)} requiere 1 ${escapeHTML(rota.estamento)} para ${escapeHTML(turnoReplacementLabel(neededTurn))}: su rotativa está incompleta frente a los demás grupos.`
                        : `${escapeHTML(profileName)} requiere cobertura para ${escapeHTML(turnoReplacementLabel(neededTurn))} por ${escapeHTML(absenceType)}.`
                }
            </p>
            <div class="replacement-options-panel ${optionsOpen ? "" : "is-hidden"}" data-options-panel>
                ${optionControls}
            </div>
            <input
                type="search"
                class="replacement-search is-hidden"
                data-replacement-search
                placeholder="Buscar reemplazo por nombre"
                autocomplete="off"
            >
            ${linkedMode ? `
                <div class="replacement-dialog-note">
                    Sugerencias de unidades enlazadas activas: se muestran trabajadores compatibles y disponibles segun su unidad. Al asignar, se registra como prestamo en ambas unidades.
                </div>
            ` : ""}
            ${bulkActions}

            ${forceMode ? `
                <div class="replacement-dialog-note">
                    Modo forzado activo: se muestran trabajadores disponibles aunque no coincidan por profesion o estamento.
                </div>
            ` : ""}
            <div class="replacement-candidate-list">
                ${items}
            </div>
            <div class="turn-change-dialog__actions replacement-dialog__actions">
                <button class="leave-detail-undo" type="button" data-action="cancel-leave">
                    Anular permiso
                </button>
                ${leaveDocsButton}
                <button class="secondary-button" type="button" data-action="cancel">
                    Cancelar
                </button>
            </div>
        </div>
    `;
}

// Anula el permiso/ausencia del trabajador ausente para ese dia y restablece su
// turno original. Reutiliza el mismo camino que el modal de detalle de permiso
// (undoAuditLogEntry): quita el permiso, cancela los reemplazos asociados y
// notifica a los afectados. Si el permiso no tiene un registro undoable en el
// LOG (p. ej. fue evicto por el limite de logs), limpia manualmente los mapas
// del dia para dejar igualmente el turno original.
async function cancelReplacedProfileLeave(profileName, keyDay) {
    const admin = getJSON(`admin_${profileName}`, {});
    const legal = getJSON(`legal_${profileName}`, {});
    const comp = getJSON(`comp_${profileName}`, {});
    const absences = getJSON(`absences_${profileName}`, {});
    const type = leaveTypeForDay(keyDay, admin, legal, comp, absences);

    if (!type) return { ok: false, reason: "no-leave" };

    const sourceMap = leaveSourceMapForType(
        type,
        admin,
        legal,
        comp,
        absences
    );
    const info = type === "half_admin"
        ? null
        : getLeaveApplicationInfo({
            profile: profileName,
            keyDay,
            type,
            sourceMap
        });
    const cancelKeys = leaveCancellationKeysForDay({
        sourceMap,
        type,
        keyDay,
        info
    });
    const cancelIsoDates = new Set(
        cancelKeys.map(keyToISODate).filter(Boolean)
    );

    // Captura ANTES de cancelar a todos los que cubren a este ausente: sus filas
    // del timeline deben recalcularse (turno cubierto + HH.EE). El undo del LOG
    // no siempre devuelve estos trabajadores, asi que no dependemos de su salida.
    const coveringBefore = new Set(
        getReplacements()
            .filter(replacement =>
                replacement &&
                !replacement.canceled &&
                replacement.replaced === profileName &&
                (
                    !cancelIsoDates.size ||
                    cancelIsoDates.has(replacement.date)
                )
            )
            .map(replacement => String(replacement.worker || "").trim())
            .filter(Boolean)
    );

    if (info?.canUndo && info?.logId) {
        const result = await undoAuditLogEntry(info.logId, {
            source: "calendar"
        });

        if (result?.ok) {
            // El permiso ya no existe: su espera de cobertura tampoco.
            removeLeaveHoldKeys(profileName, cancelKeys);

            // Trabajadores cuyos reemplazos se cancelaron: hay que refrescar sus
            // filas del timeline para quitar el turno cubierto y sus HH.EE. Se
            // unen los capturados antes y los que reporta el undo del LOG.
            const coveringWorkers = new Set(coveringBefore);

            (result.canceledReplacements || [])
                .map(replacement => String(replacement?.worker || "").trim())
                .filter(Boolean)
                .forEach(worker => coveringWorkers.add(worker));

            return { ok: true, type, coveringWorkers, keys: cancelKeys };
        }
        // Si el undo del LOG falla, cae a la limpieza manual de abajo.
    }

    // Limpieza manual: quita el permiso del mapa correspondiente en todo el
    // bloque aplicado, no solo en la casilla desde donde se abrio el modal.
    cancelKeys.forEach(dayKey => {
        if (leaveValueMatchesType(sourceMap[dayKey], type)) {
            delete sourceMap[dayKey];
        }
    });

    // El permiso ya no existe: su espera de cobertura tampoco.
    removeLeaveHoldKeys(profileName, cancelKeys);

    if (
        type === "admin" ||
        type === "half_admin_morning" ||
        type === "half_admin_afternoon" ||
        type === "half_admin"
    ) {
        setJSON(`admin_${profileName}`, admin);
    } else if (type === "legal") {
        setJSON(`legal_${profileName}`, legal);
    } else if (type === "comp") {
        setJSON(`comp_${profileName}`, comp);
    } else {
        setJSON(`absences_${profileName}`, absences);
    }

    // Si los dias ya no tienen ninguna ausencia, libera sus bloqueos.
    const blocked = getJSON(`blocked_${profileName}`, {});
    let changedBlocked = false;
    cancelKeys.forEach(dayKey => {
        if (
            blocked[dayKey] &&
            !admin[dayKey] &&
            !legal[dayKey] &&
            !comp[dayKey] &&
            !absences[dayKey]
        ) {
            delete blocked[dayKey];
            changedBlocked = true;
        }
    });

    if (changedBlocked) {
        setJSON(`blocked_${profileName}`, blocked);
    }

    // Sin LOG no se cancelan solos: anula los reemplazos que cubrian estos dias
    // del ausente y recopila a esos trabajadores para refrescar sus filas.
    const coveringWorkers = new Set(coveringBefore);
    const now = new Date().toISOString();
    let changedReplacements = false;
    const nextReplacements = getReplacements().map(replacement => {
        if (
            replacement &&
            !replacement.canceled &&
            replacement.replaced === profileName &&
            cancelIsoDates.has(replacement.date)
        ) {
            changedReplacements = true;

            const worker = String(replacement.worker || "").trim();
            if (worker) coveringWorkers.add(worker);

            return {
                ...replacement,
                canceled: true,
                canceledAt: now,
                cancelReason: "leave_absence_canceled"
            };
        }

        return replacement;
    });

    if (changedReplacements) saveReplacements(nextReplacements);

    return { ok: true, type, manual: true, coveringWorkers, keys: cancelKeys };
}

// Detalle de una solicitud de cobertura ya enviada: a quien se le pidio y
// cuanto le queda antes de caducar. Se abre desde el calendario, el timeline y
// la tarjeta de cobertura del inicio, que son las tres superficies donde
// aparece el celular de "en espera".
function openPendingRequestsDialog({ profile, keyDay }) {
    const requests = getPendingReplacementRequestsForShift(profile, keyDay);

    if (!requests.length) return;

    const canEdit = canEditTarget("calendarPanel");
    const backdrop = document.createElement("div");

    backdrop.className = "turn-change-dialog-backdrop";

    const rowsHTML = () => requests.map(request => {
        const left = formatRequestTimeLeft(request.expiresAt);

        return `
            <div class="request-wait-row" data-request-row="${escapeHTML(request.id)}">
                <span class="request-wait-worker">
                    <b>${escapeHTML(request.worker)}</b>
                    <small>${escapeHTML(
                        request.channel === "app"
                            ? "Enviada a su aplicación"
                            : "Enviada por WhatsApp"
                    )}</small>
                </span>
                <span class="request-wait-left ${left === "Expirada" ? "is-expired" : ""}"
                    data-request-left="${escapeHTML(request.id)}">${escapeHTML(left)}</span>
            </div>`;
    }).join("");

    backdrop.innerHTML = `
        <section class="turn-change-dialog leave-detail-dialog request-wait-dialog" role="dialog" aria-modal="true" aria-labelledby="requestWaitTitle">
            <strong id="requestWaitTitle">Solicitud de cobertura enviada</strong>
            <div class="leave-detail-rows">
                <div><span>Turno de</span><b>${escapeHTML(profile)}</b></div>
                <div><span>Fecha</span><b>${escapeHTML(leaveDateLabelFromKey(keyDay))}</b></div>
                <div><span>Turno</span><b>${escapeHTML(turnoReplacementLabel(codeToTurno(requests[0].turno)))}</b></div>
            </div>
            <p class="leave-detail-note">
                En espera de respuesta. El turno sigue sin cubrir hasta que alguien
                acepte; si nadie responde antes de que caduque, vuelve a quedar
                marcado como pendiente de cobertura ("!").
            </p>
            <div class="request-wait-list" data-request-list>${rowsHTML()}</div>
            <div class="turn-change-dialog__actions leave-detail-actions--stacked">
                ${canEdit ? `
                <button class="primary-button" type="button" data-action="suggestions">Ver sugerencias de reemplazo</button>
                ` : ""}
                <button class="ghost-button" type="button" data-action="close">Cerrar</button>
            </div>
        </section>
    `;

    // La cuenta regresiva se refresca sola: con 24 h de caducidad el modal
    // puede quedar abierto un buen rato.
    const ticker = setInterval(() => {
        requests.forEach(request => {
            const cell = backdrop.querySelector(
                `[data-request-left="${CSS.escape(request.id)}"]`
            );

            if (!cell) return;

            const left = formatRequestTimeLeft(request.expiresAt);

            cell.textContent = left;
            cell.classList.toggle("is-expired", left === "Expirada");
        });
    }, 30000);

    const close = () => {
        clearInterval(ticker);
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
        .querySelector("[data-action='suggestions']")
        ?.addEventListener("click", () => {
            close();
            void openReplacementDialog(profile, keyDay);
        });

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
}

window.openPendingRequestsDialog = openPendingRequestsDialog;

/**
 * @param {string} profileName Quien necesita cobertura. En un cupo de
 *   ROTATIVA nadie falta, asi que aqui viaja un integrante del grupo que
 *   sirve de molde para los candidatos: "otro como este".
 * @param {object} [options.rota] Cupo por rotativa incompleta:
 *   { group, estamento, turno, motive }. El reemplazo que salga de aqui no
 *   reemplaza a NADIE -es un turno extra con motivo-, que es algo que el
 *   registro ya sabe guardar.
 */
async function openReplacementDialog(profileName, keyDay, options = {}) {
    const rota = options.rota || null;
    const existing = rota
        ? null
        : getReplacementForCoveredShift(profileName, keyDay);

    if (existing || window.selectionMode) {
        return;
    }

    const neededTurn = rota
        ? rota.turno
        : getReplacementNeededTurn(profileName, keyDay);

    if (!neededTurn) {
        return;
    }

    if (!ensureCanEditTarget("calendarPanel")) {
        return;
    }

    const absenceType = rota
        ? rota.motive
        : getAbsenceLabelForProfileDate(profileName, keyDay);
    let scope = "compatible";
    let requestMode = false;
    let selectedRequestWorkers = new Set();
    let optionsOpen = false;
    let preassignMode = false;
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
            ...replacementCoverageFromDataset(button.dataset)
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
            ...replacementCoverageFromDataset(button.dataset)
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

        const optionsTrigger =
            backdrop.querySelector("[data-action='toggle-options']");
        const optionsPanel =
            backdrop.querySelector("[data-options-panel]");
        if (optionsTrigger && optionsPanel) {
            // Toggle directo del DOM (sin re-render): el estado se conserva en
            // optionsOpen para no cerrarse al recomputar candidatos (force/linked).
            optionsTrigger.onclick = () => {
                optionsOpen = !optionsOpen;
                optionsPanel.classList.toggle("is-hidden", !optionsOpen);
                optionsTrigger.classList.toggle("is-open", optionsOpen);
                optionsTrigger.setAttribute(
                    "aria-expanded",
                    optionsOpen ? "true" : "false"
                );
            };
        }

        // Filtro de busqueda: oculta los candidatos cuyo nombre no coincide.
        const searchInput =
            backdrop.querySelector("[data-replacement-search]");
        if (searchInput) {
            const normalize = value => String(value || "")
                .normalize("NFD")
                .replace(/[̀-ͯ]/g, "")
                .toLowerCase()
                .trim();

            searchInput.oninput = () => {
                const term = normalize(searchInput.value);

                backdrop
                    .querySelectorAll(".replacement-candidate")
                    .forEach(candidate => {
                        const name = normalize(
                            candidate.querySelector("strong")?.textContent
                        );

                        candidate.classList.toggle(
                            "is-search-hidden",
                            Boolean(term) && !name.includes(term)
                        );
                    });
            };
        }

        const noCoverageButton =
            backdrop.querySelector("[data-action='no-coverage']");
        if (noCoverageButton) {
            noCoverageButton.onclick = async () => {
                // Segundo modal: confirma y ademas deja registrado POR QUE no
                // necesita cobertura, con motivos predefinidos reutilizables.
                const result = await openNoCoverageReasonDialog(
                    profileName,
                    keyDay
                );

                if (!result) return;

                const reason = result.reason || "";

                await withBusyState(async () => {
                    if (typeof window.pushUndoState === "function") {
                        window.pushUndoState("Marcar sin cobertura");
                    }

                    setNoCoverageDay(profileName, keyDay, true, reason);
                    // Declarar que este turno no necesita reemplazo tambien
                    // resuelve la cobertura: libera el permiso que estaba en
                    // espera y lo manda a la PWA. Ver js/leaveHold.js.
                    releaseLeaveHoldsForCoverage(profileName);
                    addAuditLog(
                        AUDIT_CATEGORY.CALENDAR,
                        "Marco sin cobertura",
                        `${profileName}: marco el ${keyDay} como no requiere cobertura.${reason ? ` Motivo: ${reason}.` : ""}`,
                        { profile: profileName, keyDay }
                    );
                    close();
                    await updateDayCell(profileName, keyDay);
                    updateTimelineCells(profileName, [keyDay]);
                    await updateVisibleCalendarDays({ updateSummary: true });
                }, { label: "Guardando..." });
            };
        }

        const compatibleScopeButton =
            backdrop.querySelector("[data-action='scope-compatible']");
        if (compatibleScopeButton) {
            compatibleScopeButton.onclick = async () => {
                scope = "compatible";
                await renderContent();
            };
        }

        const leaveDocsBtn =
            backdrop.querySelector("[data-action='leave-docs']");
        if (leaveDocsBtn) {
            leaveDocsBtn.onclick = () => {
                const target = dayDocumentsTarget(profileName, keyDay);

                close();
                openDocumentsForTarget(target, profileName);
            };
        }

        const cancelLeaveButton =
            backdrop.querySelector("[data-action='cancel-leave']");
        if (cancelLeaveButton) {
            cancelLeaveButton.onclick = async () => {
                const label = absenceType || "el permiso";
                const confirmed = await showConfirm(
                    `Se anulará ${label} de ${profileName} y se restablecerá su turno original. También se cancelarán los reemplazos asociados y se notificará a los trabajadores.`,
                    {
                        title: "Anular permiso",
                        tone: "danger",
                        confirmText: "Anular permiso",
                        destructive: true
                    }
                );

                if (!confirmed) return;

                await withBusyState(async () => {
                    if (typeof window.pushUndoState === "function") {
                        window.pushUndoState("Anular permiso");
                    }

                    const result = await cancelReplacedProfileLeave(
                        profileName,
                        keyDay
                    );

                    if (!result?.ok) {
                        alert(
                            result?.reason === "no-leave"
                                ? "Este dia ya no tiene un permiso o ausencia que anular."
                                : "No se pudo anular el permiso."
                        );
                        return;
                    }

                    close();

                    // Refresca la fila completa (turnos + HH.EE) del ausente y de
                    // cada trabajador que dejo de cubrir, para que el timeline se
                    // actualice al instante sin cambiar de mes.
                    const affectedProfiles = new Set([
                        profileName,
                        ...(result.coveringWorkers || [])
                    ]);
                    const affectedKeys = Array.isArray(result.keys) &&
                        result.keys.length
                            ? result.keys
                            : [keyDay];

                    await Promise.all(
                        affectedKeys.map(dayKey =>
                            updateDayCell(profileName, dayKey)
                        )
                    );
                    affectedProfiles.forEach(worker => {
                        updateTimelineCells(worker);
                    });
                    await updateVisibleCalendarDays({ updateSummary: true });
                }, { label: "Anulando permiso..." });
            };
        }

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

        const assignmentDirectButton =
            backdrop.querySelector("[data-action='assignment-direct']");
        if (assignmentDirectButton) {
            assignmentDirectButton.onclick = async () => {
                requestMode = false;
                preassignMode = false;
                selectedRequestWorkers = new Set();
                await renderContent();
            };
        }

        const requestToggle =
            backdrop.querySelector("[data-action='request-mode']");
        if (requestToggle) {
            requestToggle.onclick = async () => {
                requestMode = !requestMode;
                // Aprobacion y preasignar son excluyentes.
                if (requestMode) preassignMode = false;
                selectedRequestWorkers = new Set();
                await renderContent();
            };
        }

        const preassignToggle =
            backdrop.querySelector("[data-action='preassign-mode']");
        if (preassignToggle) {
            preassignToggle.onclick = async () => {
                preassignMode = !preassignMode;
                // Al activar el estado intermedio, aprobacion y "no requiere
                // cobertura" no aplican en conjunto: se apagan.
                if (preassignMode) {
                    requestMode = false;
                    selectedRequestWorkers = new Set();
                }
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
                                preassignMode
                                    ? "Preasignar turno"
                                    : requestMode
                                        ? "Crear solicitud de reemplazo"
                                        : "Asignar reemplazo"
                            );
                        }

                        // Modo preasignar: reserva tentativa (no proyecta turno ni
                        // suma horas). Solo candidatos de esta unidad.
                        if (preassignMode) {
                            const coveringWorker = button.dataset.worker;

                            if (button.dataset.workerWorkspaceId) {
                                alert("La preasignación no está disponible para unidades enlazadas.");
                                return;
                            }

                            addPreassignment({
                                worker: coveringWorker,
                                replaced: profileName,
                                keyDay,
                                turno: neededTurn,
                                absenceType,
                                ...replacementCoverageFromDataset(
                                    button.dataset
                                )
                            });
                            addAuditLog(
                                AUDIT_CATEGORY.CALENDAR,
                                "Preasigno turno",
                                `${profileName}: ${coveringWorker} preasignado para el ${keyDay}.`,
                                { profile: profileName, keyDay }
                            );

                            close();
                            await updateDayCell(profileName, keyDay);
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
                            return;
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

                        const coveringWorker = button.dataset.worker;

                        // Reemplazante (tipo contrato reemplazo) sin contrato
                        // vigente ese dia: ofrecer crear un contrato usando el
                        // permiso del ausente como respaldo. Si dice que no, se
                        // asigna solo el turno y queda con la cruz de sin contrato.
                        if (
                            !button.dataset.workerWorkspaceId &&
                            coveringWorker &&
                            isReplacementProfile(coveringWorker) &&
                            !hasContractForDate(coveringWorker, keyDay)
                        ) {
                            const addContract = await showConfirm(
                                `${coveringWorker} no tiene un contrato de reemplazo vigente en esta fecha.\n\n¿Agregar un contrato usando el permiso de ${profileName} como respaldo? Si eliges "No", se asigna solo este turno y quedara marcado sin contrato.`,
                                {
                                    title: "Sin contrato vigente",
                                    tone: "warning",
                                    confirmText: "Agregar contrato",
                                    cancelText: "Solo este turno"
                                }
                            );

                            if (addContract) {
                                close();
                                window.startReplacementContractEdit?.(
                                    coveringWorker,
                                    keyDay,
                                    { replaced: profileName }
                                );
                                return;
                            }
                        }

                        if (button.dataset.workerWorkspaceId) {
                            await saveLinkedUnitReplacement(button);
                        } else if (button.dataset.backsPendingExtra === "true") {
                            // Ya tiene el turno puesto a mano y sin motivo: no
                            // se le suma otro -seria trabajarlo dos veces-, se
                            // respalda el que tiene con esta ausencia. Es el
                            // mismo registro que deja el cuadro de motivo al
                            // cruzarlo con un permiso, y por eso `addsShift`
                            // va en false.
                            saveReplacement({
                                worker: button.dataset.worker,
                                replaced: profileName,
                                keyDay,
                                turno: neededTurn,
                                absenceType,
                                source: "manual_extra",
                                addsShift: false,
                                ...replacementCoverageFromDataset(
                                    button.dataset
                                )
                            });
                            addAuditLog(
                                AUDIT_CATEGORY.CALENDAR,
                                "Respaldo un turno agregado",
                                `${profileName}: el turno que ${button.dataset.worker} `
                                + `ya tenia el ${keyDay} quedo respaldado con este permiso.`,
                                { profile: profileName, keyDay }
                            );
                        } else {
                            saveReplacement({
                                worker: button.dataset.worker,
                                // Un cupo de rotativa no reemplaza a nadie: es
                                // un turno extra, y el motivo va en `reason`.
                                replaced: rota ? "" : profileName,
                                reason: rota ? rota.motive : "",
                                keyDay,
                                turno: neededTurn,
                                absenceType: rota ? "" : absenceType,
                                source: rota
                                    ? "rota_gap"
                                    : scope === "all-local"
                                        ? "forced_replacement"
                                        : "replacement",
                                ...replacementCoverageFromDataset(
                                    button.dataset
                                )
                            });
                        }

                        close();

                        // En un cupo de rotativa no hay ausente que repintar.
                        if (!rota) await updateDayCell(profileName, keyDay);

                        // Actualiza solo las casillas afectadas del timeline (el
                        // trabajador ausente y quien lo cubre) sin reconstruirlo.
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
            optionsOpen,
            preassignMode,
            rota,
            linkedStatus: scope === "linked"
                ? linkedReplacementStatus
                : ""
        });

        bindActions();

        // El buscador solo aparece cuando el listado desborda (hay scroll). Se mide
        // tras insertar el DOM (el backdrop ya esta en el documento).
        const candidateList =
            backdrop.querySelector(".replacement-candidate-list");
        const searchBox =
            backdrop.querySelector("[data-replacement-search]");
        if (candidateList && searchBox) {
            const scrollable =
                candidateList.scrollHeight > candidateList.clientHeight + 4;
            searchBox.classList.toggle("is-hidden", !scrollable);
        }

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

function splitManualExtraReasonPresetText(value) {
    return String(value || "")
        .split(/\r?\n|;/)
        .map(item => item.trim())
        .filter(Boolean);
}

function normalizeManualExtraReasonPresets(values) {
    const seen = new Set();
    const source = Array.isArray(values)
        ? values
        : splitManualExtraReasonPresetText(values);

    return source
        .map(item => String(item || "").trim())
        .filter(Boolean)
        .filter(item => {
            const key = item.toLocaleLowerCase("es");

            if (seen.has(key)) return false;

            seen.add(key);
            return true;
        })
        .slice(0, 40);
}

function getReasonPresets(
    key = MANUAL_EXTRA_REASON_PRESETS_KEY,
    defaults = DEFAULT_MANUAL_EXTRA_REASON_PRESETS
) {
    return normalizeManualExtraReasonPresets(getJSON(key, defaults));
}

function saveReasonPresets(values, key = MANUAL_EXTRA_REASON_PRESETS_KEY) {
    setJSON(key, normalizeManualExtraReasonPresets(values));
}

function getManualExtraReasonPresets() {
    return getReasonPresets();
}

function saveManualExtraReasonPresets(values) {
    saveReasonPresets(values);
}

function getNoCoverageReasonPresets() {
    return getReasonPresets(
        NO_COVERAGE_REASON_PRESETS_KEY,
        DEFAULT_NO_COVERAGE_REASON_PRESETS
    );
}

function manualExtraReasonPresetButtonsHTML(sectionId) {
    const presets = getManualExtraReasonPresets();

    if (!presets.length) {
        return `
            <small data-manual-reason-presets-empty>
                Sin motivos predefinidos.
            </small>
        `;
    }

    return presets.map(preset => `
        <button
            class="ghost-button"
            type="button"
            data-manual-reason-preset="${escapeHTML(preset)}"
            data-section-id="${escapeHTML(sectionId)}"
        >
            ${escapeHTML(preset)}
        </button>
    `).join("");
}

function appendManualExtraReasonPreset(textarea, preset) {
    if (!textarea) return;

    const cleanPreset = String(preset || "").trim();

    if (!cleanPreset) return;

    const current = textarea.value.trim();
    const separator = current
        ? (/[,\n;]\s*$/.test(textarea.value) ? " " : ", ")
        : "";

    textarea.value = `${current}${separator}${cleanPreset}`;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();

    if (typeof textarea.setSelectionRange === "function") {
        const end = textarea.value.length;

        textarea.setSelectionRange(end, end);
    }
}

function openManualExtraReasonPresetsDialog(
    presetsKey = MANUAL_EXTRA_REASON_PRESETS_KEY,
    presets = getManualExtraReasonPresets()
) {
    return new Promise(resolve => {
        const backdrop = document.createElement("div");
        const previousFocus =
            document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
        let settled = false;

        backdrop.className = "turn-change-dialog-backdrop";
        backdrop.dataset.manualExtraReasonPresetsDialog = "true";
        backdrop.innerHTML = `
            <section class="turn-change-dialog replacement-dialog" role="dialog" aria-modal="true" aria-labelledby="manualExtraReasonPresetsTitle">
                <strong id="manualExtraReasonPresetsTitle">Motivos predefinidos</strong>
                <p>
                    Escribe un motivo por linea. Quedaran disponibles para todos
                    los administradores de este entorno.
                </p>
                <textarea rows="8" data-manual-reason-preset-list placeholder="Estacion de Trabajo&#10;Apoyo Oncologico">${escapeHTML(presets.join("\n"))}</textarea>
                <div class="turn-change-dialog__actions">
                    <button class="secondary-button" type="button" data-action="cancel-presets">
                        Cancelar
                    </button>
                    <button class="primary-button" type="button" data-action="save-presets">
                        Guardar motivos
                    </button>
                </div>
            </section>
        `;

        const finish = result => {
            if (settled) return;

            settled = true;
            document.removeEventListener("keydown", onKeydown, true);
            backdrop.remove();

            if (previousFocus?.isConnected) {
                previousFocus.focus();
            }

            resolve(result);
        };

        function onKeydown(event) {
            if (event.key !== "Escape") return;

            event.preventDefault();
            event.stopPropagation();
            finish(false);
        }

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) {
                finish(false);
            }
        });
        backdrop
            .querySelector("[data-action='cancel-presets']")
            .addEventListener("click", () => finish(false));
        backdrop
            .querySelector("[data-action='save-presets']")
            .addEventListener("click", () => {
                saveReasonPresets(
                    backdrop.querySelector("[data-manual-reason-preset-list]")
                        ?.value || "",
                    presetsKey
                );
                finish(true);
            });

        document.addEventListener("keydown", onKeydown, true);
        document.body.appendChild(backdrop);
        backdrop.querySelector("[data-manual-reason-preset-list]")?.focus();
    });
}

/**
 * Segundo paso de "No requiere cobertura": pide un comentario OPCIONAL que
 * explique por que ese turno no necesita reemplazo. Antes la marca quedaba muda
 * y meses despues nadie recordaba el criterio.
 *
 * Resuelve con { reason } al confirmar, o null si se cancela. Los motivos
 * predefinidos se editan con el lapiz, igual que los de turnos extra, pero en su
 * propia lista.
 */
function openNoCoverageReasonDialog(profileName, keyDay) {
    return new Promise(resolve => {
        const backdrop = document.createElement("div");
        const previousFocus =
            document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
        let settled = false;

        const presetsHTML = () => {
            const presets = getNoCoverageReasonPresets();

            if (!presets.length) {
                return `<small data-no-coverage-presets-empty>Sin motivos predefinidos.</small>`;
            }

            return presets.map(preset => `
                <button
                    class="ghost-button"
                    type="button"
                    data-no-coverage-preset="${escapeHTML(preset)}"
                >
                    ${escapeHTML(preset)}
                </button>
            `).join("");
        };

        backdrop.className = "turn-change-dialog-backdrop";
        backdrop.dataset.noCoverageReasonDialog = "true";
        backdrop.innerHTML = `
            <section class="turn-change-dialog replacement-dialog no-coverage-dialog" role="dialog" aria-modal="true" aria-labelledby="noCoverageReasonTitle">
                <strong id="noCoverageReasonTitle">No requiere cobertura</strong>
                <p>
                    Se ocultará la alerta de este día para ${escapeHTML(profileName)}
                    y no se volverá a pedir reemplazo. Puedes dejar un comentario
                    que explique por qué (opcional).
                </p>
                <div class="extra-reason-field">
                    <div class="overtime-backup-subsection__head">
                        <span>Comentario (opcional)</span>
                        <button
                            class="icon-button icon-button--small"
                            type="button"
                            data-action="edit-no-coverage-presets"
                            title="Editar motivos predefinidos"
                            aria-label="Editar motivos predefinidos"
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path d="M12 20h9"></path>
                                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
                            </svg>
                        </button>
                    </div>
                    <textarea
                        rows="3"
                        data-no-coverage-reason
                        placeholder="Ej: Dotación completa"
                    ></textarea>
                    <div class="replacement-dialog-toolbar" data-no-coverage-preset-list>
                        ${presetsHTML()}
                    </div>
                </div>
                <div class="turn-change-dialog__actions">
                    <button class="secondary-button" type="button" data-action="cancel">
                        Cancelar
                    </button>
                    <button class="primary-button" type="button" data-action="save">
                        No requiere cobertura
                    </button>
                </div>
            </section>
        `;

        const textarea = backdrop.querySelector("[data-no-coverage-reason]");
        const finish = result => {
            if (settled) return;

            settled = true;
            document.removeEventListener("keydown", onKeydown, true);
            backdrop.remove();

            if (previousFocus?.isConnected) {
                previousFocus.focus();
            }

            resolve(result);
        };

        function onKeydown(event) {
            if (event.key !== "Escape") return;

            event.preventDefault();
            event.stopPropagation();
            finish(null);
        }

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) finish(null);
        });
        backdrop
            .querySelector("[data-action='cancel']")
            ?.addEventListener("click", () => finish(null));
        backdrop
            .querySelector("[data-action='save']")
            ?.addEventListener("click", () => {
                finish({ reason: String(textarea?.value || "").trim() });
            });
        backdrop
            .querySelector("[data-action='edit-no-coverage-presets']")
            ?.addEventListener("click", async () => {
                const saved = await openManualExtraReasonPresetsDialog(
                    NO_COVERAGE_REASON_PRESETS_KEY,
                    getNoCoverageReasonPresets()
                );

                if (!saved) return;

                const host = backdrop.querySelector("[data-no-coverage-preset-list]");

                if (host) host.innerHTML = presetsHTML();
            });
        // Delegado: los botones se vuelven a pintar al editar la lista.
        backdrop.addEventListener("click", event => {
            const preset = event.target.closest("[data-no-coverage-preset]");

            if (!preset) return;

            appendManualExtraReasonPreset(
                textarea,
                preset.dataset.noCoveragePreset
            );
        });

        document.addEventListener("keydown", onKeydown, true);
        document.body.appendChild(backdrop);
        textarea?.focus();
    });
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
                        <small class="overtime-backup-state" data-section-state="${escapeHTML(section.id)}">Falta</small>
                    </div>
                    <div class="replacement-candidate-list">
                        ${items}
                    </div>
                    <div class="extra-reason-field">
                        <div class="overtime-backup-subsection__head">
                            <span>Motivo manual para ${escapeHTML(section.label)}</span>
                            <button
                                class="icon-button icon-button--small"
                                type="button"
                                data-manual-reason-presets-edit
                                title="Editar motivos predefinidos"
                                aria-label="Editar motivos predefinidos"
                            >
                                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                    <path d="M12 20h9"></path>
                                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
                                </svg>
                            </button>
                        </div>
                        <textarea rows="2" data-manual-reason="${escapeHTML(section.id)}" placeholder="Ej: Campana de Invierno, Estacion de Trabajo"></textarea>
                        <div class="replacement-dialog-toolbar" data-manual-reason-presets="${escapeHTML(section.id)}">
                            ${manualExtraReasonPresetButtonsHTML(section.id)}
                        </div>
                    </div>
                    <button
                        class="overtime-backup-skip"
                        type="button"
                        data-skip-section="${escapeHTML(section.id)}"
                        aria-pressed="false"
                    >
                        Sin motivo a&uacute;n
                    </button>
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
                    ${hasMultipleManualSections
                        ? "Este turno extra tiene DOS tramos y cada uno necesita su respaldo: asocialo a una ausencia compatible o escribe el motivo."
                        : "Puedes asociar el tramo a una ausencia compatible o escribir un motivo manual."}
                </p>
                <div class="overtime-backup-grid ${
                    hasMultipleManualSections ? "overtime-backup-grid--split" : ""
                }">
                    ${manualItems}
                </div>
            </section>
        `
        : "";

    return `
        <div class="turn-change-dialog replacement-dialog extra-reason-dialog overtime-backup-dialog ${
            hasMultipleManualSections ? "overtime-backup-dialog--split" : ""
        }" role="dialog" aria-modal="true" aria-labelledby="extraReasonDialogTitle">
            <strong id="extraReasonDialogTitle">Respaldar horas extras</strong>
            <p>
                ${profileName} tiene horas extras pendientes de respaldo.
                Completa ${savesMultipleBackups ? "las secciones" : "el motivo"} para validar el pago.
            </p>
            <div class="overtime-backup-body">
                ${clockSection}
                ${manualSection}
            </div>
            <div class="turn-change-dialog__actions overtime-backup-actions">
                ${hasManualSection ? `
                <button class="danger-button" type="button" data-action="remove-extra">
                    Quitar turno extra
                </button>
                ` : ""}
                <span class="overtime-backup-actions__spacer"></span>
                <button class="secondary-button" type="button" data-action="cancel">
                    Sin motivo a&uacute;n
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
        hasClockNetExtra(
            profileName,
            keyDay,
            date,
            actualState,
            holidays
        ) &&
        !getClockExtraBackupForWorker(profileName, keyDay);
    const clockHours = hasClockSection
        ? getClockNetExtraHours(
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

    if (!ensureCanEditTarget("calendarPanel")) {
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
    // Tramos que el supervisor aparto con "Sin motivo aun".
    const skippedSections = new Set();

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
        // Un tramo marcado "Sin motivo aun" no bloquea: se guarda lo que si tiene
        // respaldo y ese queda pendiente, con su "?" en la casilla.
        const missingManualBackup = manualBackups.find(backup =>
            !backup.selectedMatch &&
            !backup.reason &&
            !skippedSections.has(backup.section.id)
        );

        if (hasClockSection && !clockReason) {
            alert("Indica el motivo de las horas extras generadas por el marcaje.");
            backdrop.querySelector("[data-clock-reason]")?.focus();
            return;
        }

        if (pendingTurn && missingManualBackup) {
            const pendiente = backdrop.querySelector(
                `[data-manual-section="${missingManualBackup.section.id}"]`
            );

            // Se marca y se trae a la vista antes de avisar: con dos tramos, el
            // que falta puede ser el que quedo fuera de pantalla.
            pendiente?.classList.add("is-missing");
            pendiente?.scrollIntoView({ block: "nearest" });

            alert(`Falta respaldar el tramo ${missingManualBackup.section.label}: selecciona una ausencia compatible o escribe su motivo.`);
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

        manualBackups
            .filter(backup => backup.selectedMatch || backup.reason)
            .forEach(backup => {
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

        // Refresca la fila del timeline (casillas del dia + columna de HH.EE) del
        // trabajador que tomo el turno extra, sin reconstruir todo el timeline.
        updateTimelineCells(profileName, [keyDay]);
    };

    // "Falta" / "Listo" por tramo. Es lo que faltaba para darse cuenta de que
    // un turno extra de dos tramos necesita DOS respaldos: antes el modal
    // cortaba la informacion y el segundo tramo pasaba desapercibido hasta que
    // el guardado reclamaba por el.
    const setSectionState = (sectionId, done) => {
        const chip = backdrop
            .querySelector(`[data-section-state="${sectionId}"]`);

        if (!chip) return;

        const skipped = skippedSections.has(sectionId);

        chip.textContent = skipped
            ? "Sin motivo"
            : (done ? "Listo" : "Falta");
        chip.classList.toggle("is-done", done && !skipped);
        chip.classList.toggle("is-skipped", skipped);
    };

    // "Sin motivo aun" POR TRAMO: con un turno extra de dos tramos se puede
    // respaldar uno y dejar el otro pendiente. El boton del pie cierra sin
    // respaldar nada; este solo aparta este tramo.
    const bindSkipSectionButtons = () => {
        backdrop
            .querySelectorAll("[data-skip-section]")
            .forEach(button => {
                const sectionId = button.dataset.skipSection;

                button.onclick = () => {
                    const skipped = !skippedSections.has(sectionId);
                    const textarea = backdrop
                        .querySelector(`[data-manual-reason="${sectionId}"]`);

                    if (skipped) {
                        skippedSections.add(sectionId);
                        selectedMatches.delete(sectionId);

                        if (textarea) textarea.value = "";

                        backdrop
                            .querySelectorAll(
                                `[data-match-index][data-section-id="${sectionId}"]`
                            )
                            .forEach(item => {
                                item.classList.remove("is-selected");
                                item.setAttribute("aria-pressed", "false");
                            });
                    } else {
                        skippedSections.delete(sectionId);
                    }

                    button.setAttribute(
                        "aria-pressed",
                        skipped ? "true" : "false"
                    );
                    button.classList.toggle("is-active", skipped);
                    backdrop
                        .querySelector(`[data-manual-section="${sectionId}"]`)
                        ?.classList.toggle("is-skipped", skipped);

                    if (textarea) textarea.disabled = skipped;

                    setSectionState(sectionId, false);
                };
            });
    };

    bindSkipSectionButtons();

    const bindManualReasonPresetButtons = () => {
        backdrop
            .querySelectorAll("[data-manual-reason-preset]")
            .forEach(button => {
                button.onclick = () => {
                    const sectionId = button.dataset.sectionId;
                    const textarea = backdrop
                        .querySelector(`[data-manual-reason="${sectionId}"]`);

                    appendManualExtraReasonPreset(
                        textarea,
                        button.dataset.manualReasonPreset
                    );
                };
            });
    };

    const refreshManualReasonPresetButtons = () => {
        backdrop
            .querySelectorAll("[data-manual-reason-presets]")
            .forEach(container => {
                const sectionId = container.dataset.manualReasonPresets;

                container.innerHTML =
                    manualExtraReasonPresetButtonsHTML(sectionId);
            });

        bindManualReasonPresetButtons();
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) {
            close();
        }
    });

    // "Sin motivo aun": se cierra sin respaldar y el dia queda pidiendolo con su
    // "?". Se repinta la casilla al salir porque el modal puede haberse abierto
    // recien puesto el turno, antes de que el calendario mostrara la marca.
    backdrop
        .querySelector("[data-action='cancel']")
        .onclick = () => {
            close();
            void updateDayCell(profileName, dateFromKeyDay(keyDay));
        };

    // Quitar el turno extra desde aqui mismo: si el supervisor abrio el modal y
    // se dio cuenta de que el turno no iba, no tiene por que buscar otra via
    // para deshacerlo. Cierra el modal SIEMPRE que se confirma: dejarlo abierto
    // pidiendo el motivo de un turno que acaba de irse no tiene sentido.
    const removeExtraButton = backdrop
        .querySelector("[data-action='remove-extra']");

    if (removeExtraButton) {
        removeExtraButton.onclick = async () => {
            const confirmado = await showConfirm(
                `Se quitara el turno extra del ${replacementDetailDateLabel(isoFromKeyDay(keyDay))} y el dia volvera a su turno original.`,
                {
                    title: "Quitar turno extra",
                    tone: "danger",
                    confirmText: "Quitar turno extra",
                    cancelText: "Volver",
                    destructive: true
                }
            );

            if (!confirmado) return;

            close();

            if (typeof window.pushUndoState === "function") {
                window.pushUndoState("Quitar turno extra");
            }

            removeManualExtraTurn(profileName, keyDay);
        };
    }

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

                setSectionState(sectionId, true);
            };
        });

    backdrop
        .querySelectorAll("[data-manual-reason]")
        .forEach(textarea => {
            textarea.addEventListener("input", event => {
                const sectionId = event.target.dataset.manualReason;

                if (!event.target.value.trim()) {
                    // Borrar el motivo escrito deja el tramo sin respaldo otra
                    // vez, salvo que ya hubiera una ausencia elegida.
                    setSectionState(
                        sectionId,
                        selectedMatches.has(sectionId)
                    );
                    return;
                }

                setSectionState(sectionId, true);
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

    backdrop
        .querySelectorAll("[data-manual-reason-presets-edit]")
        .forEach(button => {
            button.onclick = async event => {
                event.preventDefault();
                event.stopPropagation();

                if (await openManualExtraReasonPresetsDialog()) {
                    refreshManualReasonPresetButtons();
                }
            };
        });

    bindManualReasonPresetButtons();

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

// Detalle por segmento del marcaje: entrada/salida reales + etiquetas de
// recuperacion / reduccion / horas extra (usa el mismo clasificador del reporte).
function clockDetailSegmentsHTML(profile, keyDay, date, state, holidays, mark) {
    const scheduledState = getClockScheduleState(profile, keyDay, state);
    const segments = getScheduledSegmentsForProfile(
        profile,
        keyDay,
        date,
        scheduledState,
        holidays
    );

    return segments
        .map(segment => {
            const segmentMark = findClockMarkEntry(mark, segment)?.value;

            if (!segmentMark) return "";

            const times = [];

            if (segmentMark.missingEntry) {
                times.push("Sin entrada");
            } else if (segmentMark.entryTime) {
                times.push(`Entrada a las ${segmentMark.entryTime}`);
            }

            if (segmentMark.missingExit) {
                times.push("Sin salida");
            } else if (segmentMark.exitTime) {
                times.push(`Salida a las ${segmentMark.exitTime}`);
            }

            const classification = classifyClockMarkSegment(
                date,
                segment,
                segmentMark,
                { isBaseOrSwap: true }
            );
            const tags = [];

            if (classification.recoveryMinutes > 0) {
                tags.push("Recuperación de horas");
            }

            if (classification.netExtraMinutes > 0) {
                tags.push("Genera horas extra");
            }

            if (classification.isReduction) {
                tags.push("Reducción de jornada");
            }

            return `
                <div class="clock-detail-segment">
                    <strong>${escapeHTML(segment.label || "Turno")}</strong>
                    ${times.length
                        ? `<span>${escapeHTML(times.join(" · "))}</span>`
                        : ""}
                    ${tags.length
                        ? `<span class="clock-detail-tags">${tags.map(tag =>
                            `<em>${escapeHTML(tag)}</em>`).join("")}</span>`
                        : ""}
                </div>
            `;
        })
        .filter(Boolean)
        .join("");
}

// Entrada desde fuera del calendario (panel de registros de HH.EE): resuelve
// por su cuenta la fecha, el turno realizado y los feriados del dia.
window.openClockMarkDetailForDate = async (profile, keyDay) => {
    if (!profile || !keyDay) return;

    const date = parseKey(keyDay);
    const holidays = await fetchHolidays(date.getFullYear());

    openClockMarkDetailDialog({
        profile,
        keyDay,
        date,
        state: aplicarCambiosTurno(
            profile,
            keyDay,
            getTurnoProgramado(profile, keyDay)
        ),
        holidays
    });
};

function openClockMarkDetailDialog({ profile, keyDay, date, state, holidays = {} }) {
    const mark = getClockMarks(profile)[keyDay];

    if (!mark?.segments) return;

    const audit = getClockMarkAuditInfo(profile, keyDay);
    const modifiedLabel = audit?.createdAtLabel ||
        (mark.updatedAt
            ? new Date(mark.updatedAt).toLocaleString("es-CL")
            : "Sin registro");
    const actorHTML = actorLabelHTML(audit);
    const segmentsHTML = clockDetailSegmentsHTML(
        profile,
        keyDay,
        date,
        state,
        holidays,
        mark
    );
    const reason = getClockExtraBackupForWorker(profile, keyDay)?.reason || "";
    // El marcaje puede haberse hecho SOBRE un turno extra. Son dos cosas
    // distintas -el turno extra y su motivo por un lado, la incidencia de
    // marcaje por otro- y este modal solo mostraba la segunda, asi que el motivo
    // del turno extra desaparecia al modificar el marcaje.
    const extraShift = getReplacementDetailRecord(profile, keyDay);
    const extraShiftHTML = extraShift
        ? `
            <div class="clock-detail-extra">
                <strong>${escapeHTML(
                    extraShift.replaced
                        ? (extraShift.isLoan ? "Prestamo asignado" : "Reemplazo asignado")
                        : "Turno extra asignado"
                )}</strong>
                <div class="clock-detail-rows">
                    <div><span>Turno</span><b>${escapeHTML(replacementDetailTurnLabel(extraShift))}</b></div>
                    ${extraShift.replaced
                        ? `<div><span>${escapeHTML(extraShift.isLoan ? "Cubre a" : "Reemplaza a")}</span><b>${escapeHTML(extraShift.replaced)}</b></div>`
                        : ""}
                    <div><span>${escapeHTML(extraShift.replaced ? "Ausencia" : "Motivo")}</span><b>${escapeHTML(replacementDetailReasonLabel(extraShift))}</b></div>
                    <div><span>Origen</span><b>${escapeHTML(replacementDetailSourceLabel(extraShift))}</b></div>
                </div>
            </div>
        `
        : "";

    // Documento del memorandum de marcaje incompleto. Es el mismo archivo que
    // se ve en el menu MEMOS: ahi se pide y desde aca se resuelve.
    const documentsTarget = clockDocumentsTarget(profile, keyDay);
    const memoDocsButton = documentsButtonHTML(documentsTarget);

    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog clock-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="clockDetailTitle">
            <strong id="clockDetailTitle">Marcaje reloj control</strong>
            <div class="clock-detail-rows">
                <div><span>Trabajador</span><b>${escapeHTML(profile)}</b></div>
                <div><span>Fecha</span><b>${escapeHTML(leaveDateLabelFromKey(keyDay))}</b></div>
                <div><span>Modificado</span><b>${escapeHTML(modifiedLabel)}</b></div>
                <div><span>Por</span><b>${actorHTML}</b></div>
            </div>
            <div class="clock-detail-segments">
                ${segmentsHTML || `<div class="clock-detail-segment"><span>Sin detalle de segmentos.</span></div>`}
            </div>
            ${reason
                ? `<p class="clock-detail-reason"><span>Motivo horas extras:</span> ${escapeHTML(reason)}</p>`
                : ""}
            ${extraShiftHTML}
            ${attendanceMarksSlotHTML()}
            <div class="turn-change-dialog__actions">
                <button class="primary-button" type="button" data-action="edit">Modificar marcaje</button>
                ${extraShift
                    ? `<button class="secondary-button" type="button" data-action="extra-shift">Ver turno extra</button>`
                    : ""}
                ${memoDocsButton}
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
        .querySelector("[data-action='edit']")
        ?.addEventListener("click", () => {
            close();
            window.openClockMarkEditorForDate?.(date);
        });
    // Con una incidencia de marcaje el click de la casilla abre este modal, asi
    // que el detalle del turno extra -y su anulacion- quedaba sin camino.
    backdrop
        .querySelector("[data-action='extra-shift']")
        ?.addEventListener("click", () => {
            close();
            void openReplacementDetailDialog(
                profile,
                keyDay,
                extraShift?.id || ""
            );
        });
    backdrop
        .querySelector("[data-action='leave-docs']")
        ?.addEventListener("click", () => {
            close();
            openDocumentsForTarget(documentsTarget, profile);
        });

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
    backdrop.querySelector("[data-action='edit']")?.focus();
    void fillAttendanceMarks(backdrop, profile, keyDay);
}

/**
 * Pide el motivo de horas extra de una reserva sin ausente.
 *
 * Es un cuadro propio y no el de respaldos porque ese guarda un respaldo
 * (`manual_extra`) del turno, y aqui el turno todavia no existe: lo unico que
 * hay que anotar es POR QUE se va a hacer. El motivo se queda en la reserva y
 * se convierte en respaldo al confirmarla.
 *
 * Se puede saltar: la reserva queda sin motivo, la casilla conserva su insignia
 * y desde ella se vuelve a este cuadro. Al confirmar, si sigue sin motivo, se
 * pregunta otra vez.
 *
 * @returns {Promise<boolean>} si se guardo un motivo
 */
function openPreassignmentReasonDialog({ profile, keyDay, preassignment }) {
    return new Promise(resolve => {
        const presets = getManualExtraReasonPresets();
        const backdrop = document.createElement("div");

        backdrop.className = "turn-change-dialog-backdrop";
        backdrop.innerHTML = `
            <section class="turn-change-dialog replacement-dialog" role="dialog" aria-modal="true" aria-labelledby="preassignReasonTitle">
                <strong id="preassignReasonTitle">Motivo del turno preasignado</strong>
                <div class="leave-detail-rows">
                    <div><span>Trabajador</span><b>${escapeHTML(profile)}</b></div>
                    <div><span>Turno</span><b>${escapeHTML(turnoReplacementLabel(preassignment.turno))}</b></div>
                    <div><span>Fecha</span><b>${escapeHTML(leaveDateLabelFromKey(keyDay))}</b></div>
                </div>
                ${presets.length
                    ? `<div class="replacement-candidate-list">
                        ${presets.map(preset => `
                            <button class="replacement-candidate" type="button" data-preset="${escapeHTML(preset)}">
                                <span>${escapeHTML(preset)}</span>
                            </button>
                        `).join("")}
                    </div>`
                    : ""}
                <label class="extra-reason-field">
                    <span>Motivo</span>
                    <textarea data-reason rows="3" placeholder="Por qué se hará este turno">${escapeHTML(preassignment.reason || "")}</textarea>
                </label>
                <p class="leave-detail-note">
                    Queda anotado en la reserva. Al confirmar el turno se guarda
                    como su motivo de horas extra; si lo dejas para después, se
                    vuelve a pedir en ese momento.
                </p>
                <div class="turn-change-dialog__actions">
                    <button class="primary-button" type="button" data-action="save">Guardar motivo</button>
                    <button class="ghost-button" type="button" data-action="later">Definir después</button>
                </div>
            </section>
        `;

        const campo = backdrop.querySelector("[data-reason]");
        const close = guardado => {
            document.removeEventListener("keydown", onKeydown);
            backdrop.remove();
            resolve(Boolean(guardado));
        };
        const onKeydown = event => {
            if (event.key === "Escape") close(false);
        };

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) close(false);
        });
        backdrop.querySelectorAll("[data-preset]").forEach(button => {
            button.addEventListener("click", () => {
                campo.value = button.dataset.preset;
                campo.focus();
            });
        });
        backdrop
            .querySelector("[data-action='later']")
            ?.addEventListener("click", () => close(false));
        backdrop
            .querySelector("[data-action='save']")
            ?.addEventListener("click", () => {
                const motivo = String(campo.value || "").trim();

                if (!motivo) {
                    alert("Escribe un motivo o usa \"Definir después\".");
                    return;
                }

                setPreassignmentReason(preassignment.id, motivo);
                addAuditLog(
                    AUDIT_CATEGORY.CALENDAR,
                    "Motivo de turno preasignado",
                    `${profile}: ${motivo} (${keyDay}).`,
                    { profile, keyDay }
                );
                close(true);
            });

        document.addEventListener("keydown", onKeydown);
        document.body.appendChild(backdrop);
        campo?.focus();
    });
}

/**
 * Pide el motivo del turno recien preasignado, si es que la reserva existe.
 *
 * Lo llama el boton al marcar el dia: el supervisor sabe POR QUE lo esta
 * reservando justo en ese momento, y dejarlo para despues es lo que hace que
 * casi nunca se complete.
 */
export async function openPreassignmentReasonForDay(profileName, keyDay) {
    const preassignment = getPreassignmentForWorker(profileName, keyDay);

    if (!preassignment || preassignment.replaced) return false;

    return openPreassignmentReasonDialog({
        profile: profileName,
        keyDay,
        preassignment
    });
}

/**
 * Confirma un turno preasignado que no cubre a nadie: lo aplica de verdad.
 *
 * Va por addTurnToDay -el mismo camino del boton normal- en vez de crear un
 * reemplazo: no hay ausente, asi que un reemplazo sin reemplazado seria un
 * registro que no describe lo que paso. Si el turno ya no cabe -el dia cambio
 * mientras la reserva esperaba- no se aplica nada y la reserva se queda, para
 * que el supervisor vea que sigue pendiente.
 */
async function confirmStandalonePreassignment(preassignment, keyDay) {
    const { worker, turno, id } = preassignment;
    const date = dateFromKeyDay(keyDay);
    const holidays = await fetchHolidays(date.getFullYear());

    window.pushUndoState?.("Confirmar turno preasignado");

    const aplicado = addTurnToDay(worker, keyDay, Number(turno) || 0, {
        date,
        holidays,
        isHab: isBusinessDay(date, holidays)
    });

    if (!aplicado) {
        alert(
            "Ese turno ya no cabe en el día. La reserva se mantiene: revisa el " +
            "día y vuelve a confirmar."
        );
        return;
    }

    removePreassignment(id);
    addAuditLog(
        AUDIT_CATEGORY.CALENDAR,
        "Confirmo turno preasignado",
        `${worker}: se aplico el turno preasignado del ${keyDay}.`,
        { profile: worker, keyDay }
    );

    const motivo = String(preassignment.reason || "").trim();

    // El motivo anotado en la reserva pasa a ser el respaldo del turno, que es
    // lo que el reporte de horas extra va a buscar. Asi, definido al
    // preasignar, al confirmar queda todo listo de una.
    if (motivo) {
        saveReplacement({
            worker,
            keyDay,
            turno: Number(turno) || 0,
            reason: motivo,
            absenceType: "Motivo manual",
            source: "manual_extra",
            addsShift: false
        });
        return;
    }

    // Y si se dejo para despues y sigue sin motivo, se pregunta ahora: es el
    // ultimo momento en que el turno todavia no cuenta horas sin respaldo.
    await openManualExtraReasonForDay(worker, keyDay);
}

// Modal de un turno PREASIGNADO (cobertura tentativa). Se abre al clickear la
// casilla del ausente o del reemplazante preasignado. Permite Confirmar (el
// trabajador acepto -> pasa a reemplazo real: proyecta + suma horas) o Cancelar
// (vuelve el "!").
function openPreassignmentDialog({ profile, keyDay }) {
    const preassignment =
        getPreassignmentForCoveredShift(profile, keyDay) ||
        getPreassignmentForWorker(profile, keyDay);

    if (!preassignment) return;

    // Solo lectura en Turnos: la reserva se puede consultar, pero no
    // confirmarse ni cancelarse.
    const canEdit = canEditTarget("calendarPanel");

    const { id, worker, replaced, turno, absenceType } = preassignment;
    const audit = getPreassignmentAuditInfo(replaced, keyDay);
    const preassignedLabel = audit?.createdAtLabel ||
        (preassignment.at
            ? new Date(preassignment.at).toLocaleString("es-CL")
            : "Sin registro");
    const actorHTML = actorLabelHTML(audit);

    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog leave-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="preassignDialogTitle">
            <strong id="preassignDialogTitle">Turno preasignado</strong>
            <div class="leave-detail-rows">
                ${replaced
                    ? `<div><span>Reemplaza a</span><b>${escapeHTML(replaced)}</b></div>
                <div><span>Reemplazante</span><b>${escapeHTML(worker)}</b></div>`
                    : `<div><span>Trabajador</span><b>${escapeHTML(worker)}</b></div>`}
                <div><span>Turno</span><b>${escapeHTML(turnoReplacementLabel(turno))}</b></div>
                <div><span>Fecha</span><b>${escapeHTML(leaveDateLabelFromKey(keyDay))}</b></div>
                <div><span>Preasignado</span><b>${escapeHTML(preassignedLabel)}</b></div>
                <div><span>Por</span><b>${actorHTML}</b></div>
                ${replaced
                    ? ""
                    : `<div><span>Motivo</span><b>${
                        preassignment.reason
                            ? escapeHTML(preassignment.reason)
                            : "<em>Sin definir</em>"
                    }</b></div>`}
            </div>
            <p class="leave-detail-note">
                ${replaced
                    ? `Reserva tentativa: aun no proyecta el turno ni suma horas. Confirma
                cuando el trabajador acepte; cancelar deja el turno pendiente de
                cobertura ("!").`
                    : `Reserva tentativa: el turno queda registrado aqui pero NO se
                publica a la aplicacion del trabajador, ni suma horas. Confirma
                para aplicarlo de verdad; cancelar lo borra y el dia vuelve a
                como estaba.`}
            </p>
            ${attendanceMarksSlotHTML()}
            <div class="turn-change-dialog__actions leave-detail-actions--stacked">
                ${canEdit ? `
                <button class="primary-button" type="button" data-action="confirm">Confirmar (el trabajador aceptó)</button>
                ${replaced
                    ? ""
                    : `<button class="secondary-button" type="button" data-action="reason">${
                        preassignment.reason ? "Cambiar motivo" : "Definir motivo"
                    }</button>`}
                <button class="leave-detail-undo" type="button" data-action="cancel-preassign">Cancelar preasignación</button>
                ` : ""}
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
    const refresh = async () => {
        await updateDayCell(replaced, keyDay);
        if (worker && worker !== replaced) {
            await updateDayCell(worker, keyDay);
        }
        updateTimelineCells(replaced, [keyDay]);
        if (worker) updateTimelineCells(worker, [keyDay]);
        await updateVisibleCalendarDays({ updateSummary: true });
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) close();
    });
    backdrop
        .querySelector("[data-action='close']")
        ?.addEventListener("click", close);
    backdrop
        .querySelector("[data-action='confirm']")
        ?.addEventListener("click", async () => {
            await withBusyState(async () => {
                if (replaced) {
                    // Pasa a reemplazo real (proyecta + suma horas), igual que
                    // el paso directo de asignar. La accion vive en
                    // replacements.js porque tambien la dispara la tarjeta de
                    // cobertura del inicio.
                    confirmPreassignment(preassignment);
                } else {
                    // Sin ausente no hay reemplazo que crear: el turno se
                    // aplica por el MISMO camino que el boton normal, que es
                    // de lo que este preasignado era la version tentativa.
                    await confirmStandalonePreassignment(preassignment, keyDay);
                }

                close();
                await refresh();
            }, { label: "Confirmando..." });
        });
    backdrop
        .querySelector("[data-action='reason']")
        ?.addEventListener("click", async () => {
            close();
            // Se reabre despues para que el motivo recien puesto se vea: el
            // cuadro se dibuja de una vez y no se refresca solo.
            await openPreassignmentReasonDialog({
                profile: worker,
                keyDay,
                preassignment
            });
            openPreassignmentDialog({ profile, keyDay });
        });
    backdrop
        .querySelector("[data-action='cancel-preassign']")
        ?.addEventListener("click", async () => {
            await withBusyState(async () => {
                cancelPreassignment(preassignment);
                close();
                await refresh();
            }, { label: "Cancelando..." });
        });

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
    backdrop.querySelector("[data-action='confirm']")?.focus();
    // El trabajador de la reserva, que en una cobertura no es el del calendario
    // abierto: las marcas son de quien va a hacer el turno.
    void fillAttendanceMarks(backdrop, worker, keyDay);
}

window.openPreassignmentDialog = openPreassignmentDialog;

// Si ese dia hay un turno sin cubrir. Se extrajo del cuerpo de `clickDia`
// porque ahora hace falta ANTES, para decidir a que dialogo lleva el click.
function dayNeedsReplacement(
    profileName,
    keyDay,
    admin,
    legal,
    comp,
    absences
) {
    return (
        Boolean(getReplacementNeededTurn(profileName, keyDay)) &&
        requiereReemplazoTurnoBase(
            keyDay,
            getTurnoBase(profileName, keyDay),
            admin,
            legal,
            comp,
            absences,
            getRotativa(profileName).type
        ) &&
        !getReplacementForCoveredShift(profileName, keyDay) &&
        !getInheritedReplacementContractForCoveredShift(profileName, keyDay) &&
        !isNoCoverageDay(profileName, keyDay)
    );
}

/**
 * Abre las sugerencias de reemplazo sobre el PRIMER turno que un permiso recien
 * aplicado dejo descubierto. El calendario lo llama al aplicar un
 * P. Administrativo: resolver ese turno -asignando a alguien o marcandolo sin
 * cobertura- es justo lo que libera el permiso hacia la PWA (js/leaveHold.js),
 * asi que la accion que falta se ofrece en el acto y no queda para despues.
 *
 * @returns {Promise<boolean>} si se abrio el modal.
 */
export async function openReplacementSuggestionsForLeaveBlock(
    profileName,
    keys = []
) {
    if (!profileName) return false;

    const admin = getJSON(`admin_${profileName}`, {});
    const legal = getJSON(`legal_${profileName}`, {});
    const comp = getJSON(`comp_${profileName}`, {});
    const absences = getJSON(`absences_${profileName}`, {});
    const pending = (Array.isArray(keys) ? keys : [keys])
        .map(key => String(key || "").trim())
        .filter(Boolean)
        .find(keyDay => dayNeedsReplacement(
            profileName,
            keyDay,
            admin,
            legal,
            comp,
            absences
        ));

    if (!pending) return false;

    await openReplacementDialog(profileName, pending);

    return true;
}

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

    const shiftMoveMarker =
        getShiftMoveMarkers(profileName, keyDay)[0] || null;
    // Un turno trasladado al que despues se le aplico un permiso necesita
    // cubrirse, y eso MANDA sobre el detalle del traslado: apretar el "!" tiene
    // que llevar a buscar quien lo cubra, no a la ficha para anular el
    // movimiento. Sin esto el corto-circuito de abajo se comia el click y el
    // turno no habia forma de cubrirlo.
    //
    // El traslado no queda inalcanzable: su dia de ORIGEN lleva el mismo
    // marcador y ahi no hay nada que cubrir, asi que desde alli se anula.
    const pendingCoverage = dayNeedsReplacement(
        profileName,
        keyDay,
        admin,
        legal,
        comp,
        absences
    );

    if (shiftMoveMarker && !pendingCoverage) {
        return openShiftMoveDetailDialog(shiftMoveMarker);
    }

    const workerReplacement =
        getReplacementForWorkerShift(profileName, keyDay);
    const directEditEnabled =
        typeof window.calendarDirectEditEnabled === "function"
            ? window.calendarDirectEditEnabled()
            : true;

    if (workerReplacement && !directEditEnabled) {
        return openReplacementDetailDialog(
            profileName,
            keyDay,
            workerReplacement.id || ""
        );
    }

    if (window.selectionMode === "halfadmin") return;
    if (window.selectionMode) return;

    // Ya se calculo arriba, para decidir si el click iba al detalle del
    // traslado o a cubrir el turno.
    const needsReplacement = pendingCoverage;

    // Turno preasignado (del ausente o del reemplazante): abre el modal de
    // confirmar/cancelar en vez del de reemplazo.
    if (
        getPreassignmentForCoveredShift(profileName, keyDay) ||
        getPreassignmentForWorker(profileName, keyDay)
    ) {
        return openPreassignmentDialog({ profile: profileName, keyDay });
    }

    if (needsReplacement) {
        // Si ya salio la solicitud, lo primero que se necesita saber es a quien
        // se le pidio y cuanto queda; desde ahi se llega al cuadro de
        // sugerencias si hace falta insistir.
        if (getPendingReplacementRequestsForShift(profileName, keyDay).length) {
            return openPendingRequestsDialog({ profile: profileName, keyDay });
        }

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

    if (!directEditEnabled) {
        // Con el switch de "Editar" apagado este click no hacia nada. Si el dia
        // tiene un turno puesto A MANO es la ocasion de ofrecer quitarlo: hasta
        // ahora habia que encender el switch y dar vueltas al ciclo hasta volver
        // al turno original.
        if (manualExtraForDay(profileName, keyDay).extra) {
            await offerManualExtraRemoval(profileName, keyDay, options);
            return;
        }

        // Y si no hay nada que quitar, el calendario esta en modo consulta: se
        // abre lo que el reloj registro ese dia. Va aqui y no con el switch
        // encendido a proposito, porque ahi el click CICLA el turno y quedarse
        // sin esa via seria peor que no tener el detalle.
        openAttendanceIncidentDialog(profileName, keyDay, {
            requireIncidents: false
        });
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
    const effectiveBaseTurn = aplicarCambiosTurno(
        profileName,
        keyDay,
        baseTurno,
        { includeReplacements: false }
    );
    const directEditTurn = getProtectedDirectEditTurn(
        profileName,
        keyDay,
        currentState,
        isHab,
        { effectiveBaseTurn }
    );
    const nuevo = directEditTurn.nextVisibleTurn;
    const turnToStore = directEditTurn.nextStoredTurn;
    const protectedBaseTurn = directEditTurn.protectedBaseTurn;

    if (Number(nuevo) === Number(currentState)) {
        event.stopPropagation();
        return;
    }

    commitCalendarTurnChange({
        profileName,
        keyDay,
        currentState,
        nextTurn: nuevo,
        turnToStore,
        baseTurn: protectedBaseTurn || effectiveBaseTurn,
        cell: options.cell,
        date: options.date || dateFromKeyDay(keyDay),
        holidays: options.holidays || {},
        historyLabel: `Edicion directa de turnos desde ${keyDay}`
    });
}

/**
 * Guarda UN cambio de turno hecho desde el calendario: lo pinta al instante,
 * abre la ventana de historial, limpia lo que el turno anterior dejaba colgando
 * (respaldos de turno extra y marcas del reloj), guarda y programa el repintado
 * y la bitacora.
 *
 * Lo usan los dos caminos que cambian un turno desde la casilla: la edicion
 * directa -que CICLA por los turnos posibles- y los botones de turno del menu
 * Turnos -donde el supervisor ya eligio cual quiere-. Vive en un solo sitio
 * porque olvidar uno de estos pasos en una de las dos vias deja basura que solo
 * se nota mucho despues: una marca de reloj sobre un turno que ya no existe, o
 * un cambio que no llega a la bitacora.
 */
function commitCalendarTurnChange({
    profileName,
    keyDay,
    currentState,
    nextTurn,
    turnToStore,
    baseTurn,
    cell,
    date,
    holidays = {},
    historyLabel
}) {
    const manualExtra = Boolean(
        getShiftAssigned(profileName, date) &&
        getTurnoExtraAgregado(baseTurn, nextTurn)
    );

    previewDirectTurnChange(
        cell,
        nextTurn,
        date,
        holidays,
        {
            profileName,
            keyDay,
            baseTurn,
            manualExtra
        }
    );

    keepCalendarDirectEditHistoryOpen(historyLabel);

    if (Number(nextTurn) !== Number(currentState)) {
        cancelManualExtraBackupsForTurnChange(
            profileName,
            keyDay,
            nextTurn
        );
        dropClockMarkForTurnChange(
            profileName,
            keyDay,
            currentState,
            nextTurn
        );
    }

    saveProfileDayTurn(keyDay, turnToStore, profileName);
    recordCalendarDirectEditChange({
        profileName,
        keyDay,
        previousTurn: currentState,
        nextTurn
    });
    scheduleCalendarAuditLog({
        profile: profileName,
        keyDay,
        previousTurn: currentState,
        nextTurn
    });
    scheduleCalendarDirectEditRefresh(keyDay);
}

/* ======================================================
   Botones de turno del menu Turnos (Diurno / Larga / Noche)

   El supervisor elige el turno en un boton y despues marca la casilla, sin
   pasar por el switch de "Editar". Son dos preguntas y las dos las contesta
   getAddTurnResult, en el motor: si el turno CABE en ese dia -eso decide que
   casillas se iluminan- y en que queda el dia al ponerlo.
====================================================== */

/**
 * Si a esta casilla se le puede agregar el turno elegido. Suma a la regla del
 * motor lo que el motor no ve: un dia con permiso, ausencia o devolucion de
 * horas no se toca desde aqui, se maneja en su propio cuadro.
 */
export function canAddTurnToDay(profileName, keyDay, turnoElegido, context = {}) {
    if (!profileName || !turnoElegido) return false;

    const {
        isHab = true,
        admin = {},
        legal = {},
        comp = {},
        absences = {},
        hourReturns = {},
        actualState
    } = context;

    if (
        tieneAusencia(keyDay, admin, legal, comp, absences) ||
        hourReturns?.[keyDay]
    ) {
        return false;
    }

    const baseTurno = getTurnoBase(profileName, keyDay);
    const effectiveBaseTurn = aplicarCambiosTurno(
        profileName,
        keyDay,
        baseTurno,
        { includeReplacements: false }
    );

    return getAddTurnResult(
        profileName,
        keyDay,
        turnoElegido,
        isHab,
        {
            effectiveBaseTurn,
            actualState: Number.isFinite(Number(actualState))
                ? actualState
                : getActualState(profileName, keyDay)
        }
    ).allowed;
}

/**
 * Lo que el dia tiene puesto A MANO por sobre su turno base: el "turno extra".
 * `extra` es TURNO.LIBRE cuando el dia esta tal como lo dejo la rotativa.
 */
function manualExtraForDay(profileName, keyDay) {
    const baseTurno = getTurnoBase(profileName, keyDay);
    const effectiveBaseTurn = aplicarCambiosTurno(
        profileName,
        keyDay,
        baseTurno,
        { includeReplacements: false }
    );
    const actual = getActualState(profileName, keyDay);

    return {
        effectiveBaseTurn,
        actual,
        extra: getTurnoExtraAgregado(effectiveBaseTurn, actual)
    };
}

/**
 * Ofrece quitar el turno extra de un dia y devolver la casilla a su estado
 * original. Es el atajo a lo que hoy hay que hacer dando vueltas al ciclo de la
 * edicion directa hasta volver al turno de la rotativa.
 */
async function offerManualExtraRemoval(profileName, keyDay, options = {}) {
    const { effectiveBaseTurn, actual, extra } =
        manualExtraForDay(profileName, keyDay);

    if (!extra) return false;

    const etiqueta = turno => TURNO_LABEL[Number(turno) || 0] || "Libre";
    const confirmado = await showConfirm(
        `Este dia tiene un turno agregado a mano.\n\n` +
        `Turno base: ${etiqueta(effectiveBaseTurn)}\n` +
        `Con el extra: ${etiqueta(actual)}\n` +
        `Se quitara: ${etiqueta(extra)}\n\n` +
        `La casilla vuelve a su estado original.`,
        {
            title: "Quitar turno extra",
            tone: "danger",
            confirmText: "Quitar turno extra",
            cancelText: "Volver",
            destructive: true
        }
    );

    if (!confirmado) return false;

    return removeManualExtraTurn(profileName, keyDay, options);
}

/**
 * Devuelve el dia a su turno base, quitando lo que se le agrego a mano. Es a lo
 * que se llegaba dando vueltas al ciclo de la edicion directa.
 *
 * Lo llaman los dos sitios desde donde se puede quitar: el cuadro que sale al
 * hacer click en la casilla y el boton del modal de respaldo de horas extras.
 */
function removeManualExtraTurn(profileName, keyDay, options = {}) {
    const { effectiveBaseTurn, actual, extra } =
        manualExtraForDay(profileName, keyDay);

    if (!extra) return false;

    commitCalendarTurnChange({
        profileName,
        keyDay,
        currentState: actual,
        nextTurn: effectiveBaseTurn,
        turnToStore: effectiveBaseTurn,
        baseTurn: effectiveBaseTurn,
        cell: options.cell,
        date: options.date || dateFromKeyDay(keyDay),
        holidays: options.holidays || {},
        historyLabel: `Turno extra quitado en ${keyDay}`
    });

    return true;
}

/**
 * Abre el modal de respaldo del turno extra de un dia, si lo tiene pendiente.
 * Se usa al agregar un turno con los botones: el motivo se pide en el momento,
 * que es cuando el supervisor sabe por que lo puso.
 */
export async function openManualExtraReasonForDay(profileName, keyDay) {
    const pendiente = getPendingManualExtraTurn(
        profileName,
        keyDay,
        getProfileData(profileName)
    );

    if (!pendiente) return false;

    await openExtraReasonDialog(profileName, keyDay, pendiente);

    return true;
}

/**
 * Pone el turno elegido en un dia. Devuelve false -sin tocar nada- si ese dia no
 * lo admite: la casilla ya viene deshabilitada, pero el guardado no se fia de
 * una clase del DOM.
 */
export function addTurnToDay(profileName, keyDay, turnoElegido, options = {}) {
    if (!profileName || !turnoElegido) return false;

    const date = options.date || dateFromKeyDay(keyDay);
    const isHab = options.isHab !== false;
    const baseTurno = getTurnoBase(profileName, keyDay);
    const currentState = getActualState(profileName, keyDay);
    const effectiveBaseTurn = aplicarCambiosTurno(
        profileName,
        keyDay,
        baseTurno,
        { includeReplacements: false }
    );
    const result = getAddTurnResult(
        profileName,
        keyDay,
        turnoElegido,
        isHab,
        { effectiveBaseTurn, actualState: currentState }
    );

    if (!result.allowed) return false;

    commitCalendarTurnChange({
        profileName,
        keyDay,
        currentState,
        nextTurn: result.nextVisibleTurn,
        turnToStore: result.nextStoredTurn,
        baseTurn: result.protectedBaseTurn || effectiveBaseTurn,
        cell: options.cell,
        date,
        holidays: options.holidays || {},
        historyLabel: `Turno agregado desde el boton en ${keyDay}`
    });

    return true;
}

/**
 * Deja un turno PREASIGNADO en un dia: se pinta la casilla y no se publica.
 *
 * Es el gemelo tentativo de addTurnToDay y usa su MISMA regla para decidir si
 * el turno cabe: una casilla que se ilumina para el boton normal se ilumina
 * para este, y al reves. Lo que cambia es donde se guarda -en
 * `preassignments`, que ni el motor de horas ni la proyeccion miran- asi que
 * el turno queda registrado para el supervisor y el telefono del trabajador no
 * se entera hasta que se confirme.
 *
 * Es la misma reserva que ya se hacia desde el cuadro de sugerencias de
 * reemplazo, sin un ausente a quien cubrir: aqui no se esta tapando el turno de
 * nadie, solo anotando el que este trabajador haria.
 */
export function addPreassignedTurnToDay(
    profileName,
    keyDay,
    turnoElegido,
    options = {}
) {
    if (!profileName || !turnoElegido) return false;

    const isHab = options.isHab !== false;
    const effectiveBaseTurn = aplicarCambiosTurno(
        profileName,
        keyDay,
        getTurnoBase(profileName, keyDay),
        { includeReplacements: false }
    );
    const result = getAddTurnResult(
        profileName,
        keyDay,
        turnoElegido,
        isHab,
        {
            effectiveBaseTurn,
            actualState: getActualState(profileName, keyDay)
        }
    );

    if (!result.allowed) return false;

    addPreassignment({
        worker: profileName,
        // Sin ausente: no cubre a nadie, es el turno de este trabajador.
        replaced: "",
        keyDay,
        turno: turnoElegido
    });
    addAuditLog(
        AUDIT_CATEGORY.CALENDAR,
        "Preasigno turno",
        `${profileName}: ${turnoLabel(turnoElegido)} preasignado para el ${keyDay}, sin publicar a la aplicacion.`,
        { profile: profileName, keyDay }
    );

    return true;
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
    const turnChangeConfig = getTurnChangeConfig();
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
    // Una sola pasada para el mes: el barrido de caducidad tambien escribe, y
    // no puede correr una vez por casilla.
    const pendingRequestIndex = buildPendingRequestIndex();
    const turnChangeIndex =
        buildCalendarTurnChangeIndex(activeProfile, y, m);
    const shiftMoveIndex =
        buildCalendarShiftMoveIndex(activeProfile, y, m);
    const blockedDayIndex =
        buildCalendarBlockedDayIndex(activeProfile);
    const pendingLeaveIndex =
        buildPendingLeaveRequestIndex(activeProfile, y, m, days);
    const pendingSwapIndex =
        buildPendingSwapRequestIndex(activeProfile, y, m, days);
    const contractIndex =
        buildCalendarContractIndex(activeProfile, y, m, days);
    const honorariaSummary = getHonorariaMonthlySummary(
        activeProfile,
        y,
        m,
        holidays
    );
    const turnChangeReturnColorEnabled =
        Boolean(getTurnoColorConfig().turnChangeReturn);
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
        // Un permiso pendiente y un cambio pendiente sobre el mismo dia: manda
        // el permiso, que es el que puede dejar el turno sin cubrir.
        const pendingSwap = pendingLeaveRequest
            ? null
            : (pendingSwapIndex.get(keyDay) || null);

        const state = aplicarCambiosTurno(
            activeProfile,
            keyDay,
            getTurnoProgramado(activeProfile, keyDay)
        );

        // Preasignaciones: del ausente (reemplaza el "!") y de este perfil como
        // reemplazante tentativo (muestra el turno extra sin proyectarlo).
        const preassignedCovered = Boolean(
            getPreassignmentForCoveredShift(activeProfile, keyDay)
        );
        const preassignedWorker = getPreassignmentForWorker(
            activeProfile,
            keyDay
        );
        // El turno tentativo se SUMA al que el dia ya tiene, con la misma regla
        // que la edicion directa: preasignar una Noche sobre una Larga muestra
        // 24h. Antes solo se pintaba en un dia libre, asi que preasignar sobre
        // un dia con turno no se veia por ninguna parte. Sigue siendo solo
        // pintura: no toca getTurnoReal, ni las horas, ni la proyeccion.
        const preassignDisplayTurn = preassignedWorker
            ? turnoDesdeComponentes([
                ...getTurnoComponentes(Number(state) || TURNO.LIBRE),
                ...getTurnoComponentes(
                    getPreassignmentTurnForWorker(activeProfile, keyDay)
                )
            ])
            : TURNO.LIBRE;

        const date = new Date(y, m, d);
        const isWeekendDay = isWeekend(date);
        const isHoliday = holidays[keyDay];
        const isHab = isBusinessDay(date, holidays);
        const isoDay = isoFromKeyDay(keyDay);
        const honorariaContractDay =
            Boolean(getHonorariaContractForDate(activeProfile, isoDay));
        const shiftAssigned = shiftAssignedForDate(date);

        const turnChangeMarkers =
            turnChangeIndex.get(keyDay) || [];
        const turnChangeMarker = turnChangeMarkers[0] || null;
        const shiftMoveMarkers =
            shiftMoveIndex.get(keyDay) || [];
        const hourReturn = hourReturns[keyDay] || null;
        const label = preassignDisplayTurn
            ? turnoLabel(preassignDisplayTurn)
            : hourReturn
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
        const inheritedContractCoverage =
            getInheritedReplacementContractForCoveredShift(
                activeProfile,
                keyDay
            );
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
        // El marcaje se hizo sobre el turno del dia. Si despues le quitaron el
        // turno, la marca quedo huerfana: no se dibuja el reloj (no hay turno
        // que modificar) y la casilla vuelve a ser editable.
        const clockMark = clockMarkAppliesToTurn(state)
            ? clockMarks[keyDay] || null
            : null;
        const severeClockIncident =
            clockMarkHasSevereIncident(clockMark);
        const simpleClockIncident =
            !severeClockIncident &&
            clockMarkHasSimpleIncident(clockMark);
        const clockExtra =
            clockMark &&
            hasClockNetExtra(
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
                absences,
                activeRotativa.type
            ) &&
            !coveredReplacement &&
            !inheritedContractCoverage &&
            !isNoCoverageDay(activeProfile, keyDay);
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
        // Solicitudes ya enviadas a las PWA para este turno. Cambian el "!" de
        // "sin cubrir" por el celular de "en espera": no es lo mismo un turno
        // que nadie ha pedido que uno que ya salio a los telefonos.
        const pendingRequests = needsReplacement
            ? getPendingRequestsFromIndex(
                pendingRequestIndex,
                activeProfile,
                isoDay
            )
            : [];
        const badge = replacementContractError
            ? "X"
            : severeClockIncident
                ? "!!!"
                : preassignedCovered
                    ? PREASSIGN_BADGE
                : pendingRequests.length
                    ? REQUEST_PENDING_BADGE
                : needsReplacement
                    ? "!"
                : preassignedWorker
                    ? PREASSIGN_BADGE
                    : showHonorariaLimitBadge
                        ? "!"
                    : showExtraReason || showClockExtraReason
                    ? "?"
                    : simpleClockIncident
                        ? CLOCK_MARK_BADGE
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
        // La insignia PRINCIPAL va primero y siempre. `buildDayCell` usa
        // `badges` en lugar de `badge` cuando viene con algo, asi que dejarla
        // fuera la borraba: un turno movido al que despues se le aplica un
        // permiso mostraba solo "TTMM" y perdia el "!" de sin cubrir, con lo
        // que no habia por donde cubrirlo aunque el turno lo necesitara.
        // Incidencias que trajo el reporte del reloj. Van SIEMPRE, ademas de la
        // insignia principal: un dia sin cubrir que ademas quedo sin marca de
        // salida necesita mostrar las dos cosas.
        const attendanceIncidents = getAttendanceIncidentsForDay(
            activeProfile,
            keyDay
        );
        const attendanceIncidentTitle = attendanceIncidents.length
            ? attendanceIncidentSummary(attendanceIncidents)
            : "";
        const calendarBadges =
            Array.from(new Set([
                ...(badge ? [badge] : []),
                ...(pendingLeaveRequest ? ["Pend."] : []),
                ...(workerBlockedDay ? ["No disp."] : []),
                ...(attendanceIncidents.length
                    ? [ATTENDANCE_INCIDENT_BADGE]
                    : []),
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
                : pendingSwap
                ? pendingSwapLabel(pendingSwap.role)
                : "",
            badge,
            badges: calendarBadges.length
                ? calendarBadges
                : undefined,
            attendanceIncidentTitle,
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

                const suffix = pendingRequests.length
                    ? ` | Solicitud de cobertura enviada a ${pendingRequests.length} ` +
                      `trabajador${pendingRequests.length === 1 ? "" : "es"}: en espera de respuesta`
                    : needsReplacement
                    ? " | Requiere reemplazo de turno base"
                    : workerBlockedDay
                        ? ` | ${workerBlockedDay.message}`
                    : honorariaExcess
                        ? ` | ${getHonorariaLimitMessage(honorariaSummary, keyDay)}`
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

                    // Un dia puede tener las dos cosas a la vez: el motivo del
                    // turno extra y una incidencia de marcaje sobre ese mismo
                    // turno. Antes el motivo tapaba la advertencia, asi que el
                    // marcaje modificado quedaba invisible en el hover.
                    return [replacementTitle, warning]
                        .filter(Boolean)
                        .join("\n");
                })();

                return [
                    pendingLeaveHoverTitle(
                        pendingLeaveRequest,
                        activeProfile,
                        keyDay,
                        baseState
                    ),
                    pendingSwapHoverTitle(
                        pendingSwap,
                        activeProfile,
                        state
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
                ),
            hasHonorariaContract: honorariaContractDay
        });

        div.dataset.keyDay = keyDay;
        div.dataset.date = isoFromKeyDay(keyDay);
        div.dataset.workerId = activeWorkerId;
        div.dataset.action = "calendar-day";

        // CCTT (cambio) y DDTT (devolucion) caen en dias distintos: se marca el tipo
        // para que sus etiquetas lleven colores diferentes.
        const hasReturnMarker =
            turnChangeMarkers.some(marker => marker.type === "return");
        const hasChangeMarker =
            turnChangeMarkers.some(marker => marker.type === "change");
        // Dia de devolucion con color personalizado por el supervisor.
        const returnCustomColor =
            hasReturnMarker && turnChangeReturnColorEnabled;

        if (turnChangeMarker) {
            div.classList.add("turn-change-day");
            div.dataset.swapId = String(
                turnChangeMarker.swap.id
            );

            if (hasChangeMarker) {
                div.classList.add("turn-change-day--change");
            }

            if (hasReturnMarker) {
                div.classList.add("turn-change-day--return");
            }
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
            // El parpadeo alterna el color del turno (fondo de la celda) con el
            // color del permiso solicitado (overlay), en sincronia con el nombre.
            div.style.setProperty(
                "--pending-leave-color",
                pendingLeaveColorValue(pendingLeaveRequest.type)
            );
            const pendingOverlay = document.createElement("span");
            pendingOverlay.className = "pending-leave-color-overlay";
            pendingOverlay.setAttribute("aria-hidden", "true");
            div.insertBefore(pendingOverlay, div.firstChild);
        }

        if (pendingSwap) {
            // Se reutiliza la maquinaria de parpadeo de los permisos: mismas
            // clases, mismo periodo y mismo sincronizador de fase, asi los dos
            // tipos de solicitud parpadean juntos en vez de desfasados. Lo unico
            // propio es el color y la clase que marca de que solicitud se trata.
            div.classList.add("pending-leave-request-day");
            div.classList.add("pending-swap-request-day");
            div.dataset.workerRequestId = pendingSwap.request.id;
            div.style.setProperty(
                "--pending-leave-color",
                pendingSwapColorValue()
            );
            const pendingOverlay = document.createElement("span");
            pendingOverlay.className = "pending-leave-color-overlay";
            pendingOverlay.setAttribute("aria-hidden", "true");
            div.insertBefore(pendingOverlay, div.firstChild);
        }

        if (!activeProfileEnabled) {
            div.classList.add("inactive-profile-day");
        }

        if (needsReplacement && !preassignedCovered) {
            div.classList.add("needs-replacement");
        }

        if (preassignedCovered || preassignedWorker) {
            div.classList.add("preassign-day");
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

        const isTrainingDay =
            getAbsenceType(absences[keyDay]) === "training";
        const dayColorGradient = isTrainingDay
            ? null
            : getDayColorGradient(
                activeProfile,
                keyDay,
                state,
                date,
                holidays,
                admin[keyDay],
                baseState,
                {
                    unbasedComponentsAreExtra: manualExtra,
                    singleBandGradient: manualExtra,
                    // En un dia de devolucion con color personalizado, la mitad DDTT
                    // (componente extra del 24h) se pinta con ese color.
                    extraColorOverride: returnCustomColor
                        ? "var(--color-turn-change-return)"
                        : undefined
                }
            );

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
            dayColorGradient
        );

        // Dia de devolucion de UN solo color (no 24h): se pinta la celda completa con
        // el color personalizado (el 24h ya se resolvio via extraColorOverride).
        if (returnCustomColor && !dayColorGradient) {
            div.classList.add("turn-change-return-day");
        }

        const bloqueado = estaBloqueadoModo(
            window.selectionMode,
            keyDay,
            (
                window.selectionMode === "admin" ||
                window.selectionMode === "training" ||
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
                    getTurnoProgramado(activeProfile, keyDay),
                moveShiftPreviousTurn:
                    calendarAdjacentTurnForMoveShift(
                        activeProfile,
                        keyDay,
                        -1,
                        window.pendingShiftMoveSourceKey || ""
                    ),
                moveShiftNextTurn:
                    calendarAdjacentTurnForMoveShift(
                        activeProfile,
                        keyDay,
                        1,
                        window.pendingShiftMoveSourceKey || ""
                    ),
                allowTwentyFourHourShifts:
                    turnChangeConfig.allowTwentyFourHourShifts,
                allowInvertedTwentyFourHourShifts:
                    turnChangeConfig.allowInvertedTwentyFourHourShifts
            }
        );

        // Los botones de turno traen su propia regla: se ilumina la casilla
        // donde ESE turno cabe. La respuesta sale del mismo sitio que la usada
        // al aplicarlo, para que no se pueda iluminar una casilla que despues
        // rechaza el guardado.
        const addTurnBlocked =
            window.selectionMode === "addturn" &&
            !canAddTurnToDay(
                activeProfile,
                keyDay,
                Number(window.pendingAddTurn) || 0,
                {
                    isHab,
                    admin,
                    legal,
                    comp,
                    absences,
                    hourReturns,
                    actualState: state
                }
            );

        if (window.selectionMode || !activeProfileEnabled) {
            div.classList.add(
                bloqueado || addTurnBlocked || !activeProfileEnabled
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
                alert(getHonorariaLimitMessage(honorariaSummary, keyDay));
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

            // El icono de incidencia de marcaje abre SU detalle.
            if (event.target.closest("[data-attendance-incident]")) {
                event.stopPropagation();
                openAttendanceIncidentDialog(activeProfile, keyDay);
                return;
            }

            // Dia con marcaje modificado (icono de reloj): abre el detalle del
            // marcaje. No aplica si falta el motivo de horas extra (badge "?") ni
            // durante un modo de seleccion.
            if (
                simpleClockIncident &&
                !showClockExtraReason &&
                !window.selectionMode
            ) {
                event.stopPropagation();
                return openClockMarkDetailDialog({
                    profile: activeProfile,
                    keyDay,
                    date,
                    state,
                    holidays
                });
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

    // Las incidencias del reporte se calculan aparte y NO bloquean el pintado:
    // la casilla sale sin el icono y, cuando el mes termina de calcularse, el
    // aviso del indice repinta los dias visibles.
    void ensureAttendanceIncidentIndex(
        getProfiles().find(profile => profile.name === activeProfile),
        y,
        m
    );

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

    if (
        typeof window !== "undefined" &&
        typeof window.disableCalendarDirectEditMode === "function"
    ) {
        await window.disableCalendarDirectEditMode({
            flush: true,
            refresh: false,
            reason: "month-change"
        });
    }

    cancelCalendarHeavyUpdates();
    cancelCalendarDirectEditRefresh();
    closeCalendarMonthPicker();
    currentDate.setFullYear(Number(year), Number(month), 1);
    showTimelinePendingMonth(
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

// Cuando el indice de incidencias termina un mes, los dias visibles se repintan
// para que aparezca su icono. Solo avisa cuando calculo algo nuevo, asi que no
// se realimenta con el propio repintado.
if (typeof window !== "undefined") {
    onAttendanceIncidentIndexReady(({ profileName, year, month }) => {
        if (
            profileName !== getCurrentProfile() ||
            year !== currentDate.getFullYear() ||
            month !== currentDate.getMonth()
        ) return;

        void updateVisibleCalendarDays({ cooperative: true });
    });
}
