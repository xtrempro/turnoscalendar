import {
    keyFromDate,
    toISODate,
    keyToDate as parseKey,
    parseISODate as parseInputDate,
    toInputDate,
    toMonthInputValue,
    parseMonthInputValue,
    normalizeStoredStart,
    inputDateToCalendarKey,
    calendarKeyToInputDate,
    compareISODate,
    isDateKeyOnOrAfter,
    formatDisplayDate,
    formatMonthHeading,
    monthSerial,
    nextMonthPeriod
} from "./dateUtils.js";
import { normalizeText, stripAccents, sanitizeDigits } from "./stringUtils.js";
import { escapeHTML } from "./htmlUtils.js";
import { formatRut, getRutValidationMessage } from "./rutUtils.js";
import { getEmailValidationMessage } from "./emailUtils.js";
import {
    getRotativaLabel,
    requiresRotationFirstTurn,
    requiresRotationStart,
    getRotationStartOptions,
    normalizeRotationFirstTurn,
    normalizeRotationFirstTurnForType,
    getRotationFirstTurnLabel,
    getRotationSequence,
    getRotationSelectionMonth
} from "./rotationUtils.js";
import {
    cloneReturnDate,
    timeNearReturnReference,
    formatReturnTime,
    formatReturnDateTime,
    roundReturnHours,
    returnHoursBetween,
    getSegmentReturnHours,
    getReturnSegmentId
} from "./hourReturnUtils.js";
import {
    formatClockMarkDate,
    formatClockMinute,
    clockSegmentsOverlap,
    findClockMarkEntry,
    findClockSegmentForKey,
    fallbackClockSegment,
    hasClockMarkRecordData,
    getClockMarkTimingFlags
} from "./clockMarkUtils.js";
import {
    ATTACHMENT_ACCEPT,
    deleteStoredAttachment,
    hasAttachmentContent,
    normalizeAttachmentFiles,
    openAttachmentFile,
    readAttachmentFiles
} from "./attachmentUtils.js";
import {
    formatSaldo,
    normalizeBalanceValue,
    withManualBalance
} from "./balanceUtils.js";
import {
    groupContinuousReplacementLeaveKeys,
    sortReplacementLeaveKeys
} from "./replacementLeaveGrouping.js";
import {
    buildReplacementContractCandidates,
    resolveReplacementContractSelection
} from "./replacementContractCandidates.js";
import {
    profileUsesProfession,
    formatProfession,
    replaceProfessionOptions
} from "./professionUtils.js";
import {
    formatHistoryDateTime,
    recordProfileContractHistory
} from "./contractHistoryUtils.js";
import {
    auditProfileSnapshot,
    describeProfileChanges
} from "./profileAuditUtils.js";
import {
    hheeReturnEffectivePeriod,
    futureHheeReturnTransferHours,
    getHheeMonthStats,
    setHoursReturnBalance,
    adjustHoursReturnBalance,
    hheeReturnEffectiveLabel,
    hheeReturnTransferPayload,
    syncHheeReturnTransferBalance
} from "./hheeReturnTransfer.js";
import {
    normalizeProfileSearch,
    getCalendarProfileSearchValue,
    findTopProfileSearchMatch
} from "./profileSearchUtils.js";
import {
    aplicarDiurnoDesde,
    aplicarCuartoTurnoDesde,
    aplicarTercerTurnoDesde
} from "./rotationApply.js";
import { freezePriorRotationSchedule } from "./rotationFreeze.js";
import {
    getClockActualState,
    buildClockMarkRecordsForProfile
} from "./clockMarkRecords.js";
import { printReportPreviewHTML } from "./reportPrint.js";
import {
    getRecordYear,
    renderRecordField,
    renderRecordEntry
} from "./profileRecordsView.js";
import {
    getViewForTarget,
    getTargetForActiveView,
    isAppTarget,
    targetFromHash,
    appTargetUrl
} from "./navigation.js";
import { initTheme } from "./theme.js";
import { initPwaInstall } from "./pwaInstall.js";
import { initSelfTestButton } from "./selfTest.js";
import { getPerfilActual, getDisplayedProfileData } from "./profileQueries.js";
import { validateProfileDraft } from "./profileValidation.js";
import {
    buildRotationStatus,
    buildEditorHint,
    renderProfileRotationStatus
} from "./profileRotationStatus.js";
import {
    getProfileLeaveHistory,
    getProfileLeaveHistoryYears
} from "./profileLeaveHistory.js";
import {
    activeLabel,
    yesNoLabel,
    getLicenseTypeLabel
} from "./labels.js";
import {
    PROFILE_MODE,
    PROFILE_BIRTH_DATE_DEFAULT,
    profileDraft,
    resetProfileDraft,
    isReplacementDraft,
    isHonorariaDraft,
    isProfileEditing,
    hasRotationChanged,
    getDraftUnitEntryDate,
    isBeforeDraftUnitEntryDate,
    rotationStartBeforeUnitEntryMessage,
    isUnitEntryDateEnabled,
    isFirstProfileRotationConfig,
    getRotationConfigDefaultStart,
    hasGradeValueChanged,
    loadDraftFromProfile,
    supportsLibreRotation,
    requiresReplacementContract
} from "./profileDraft.js";
import {
    prevMonth,
    nextMonth,
    currentDate,
    renderCalendar,
    goToCalendarMonth,
    setCalendarSelectionHandler,
    updateDayCell,
    updateDayCells,
    updateVisibleCalendarDays
} from "./calendar.js";
import {
    getAppFilters,
    setAppFilters,
    syncWorkersState
} from "./appState.js";
import {
    pushHistory,
    undo,
    redo,
    canUndo,
    canRedo
} from "./history.js";
import { refreshAll } from "./refresh.js";
import { scheduleIdleTask } from "./mainThreadScheduler.js";
import {
    initPerformanceMonitor,
    measurePerformance,
    recordPerformanceEvent,
    startPerformanceSpan
} from "./performanceMonitor.js";
import { DOM } from "./dom.js";
import { renderSwapPanel } from "./swapUI.js";
import {
    renderStaffingWeeklyCalendar,
    scrollInlineStaffingReportToToday,
    syncStaffingConfigForProfileChange
} from "./staffing.js";
import { renderTaskAssignmentsPanel } from "./taskAssignments.js";
import { renderKanbanBoard } from "./kanban.js";
import { renderAgendaPanel } from "./agenda.js";
import { renderDashboardPanel } from "./dashboard.js";
import { initSystemSettings } from "./systemSettings.js";
import { initPlansUI } from "./plansUI.js";
import {
    canAddActiveWorker,
    canDownloadReports,
    getCachedAccountUsage,
    getEffectivePlan,
    refreshAccountUsage
} from "./subscription.js";
import { initFirebaseShell } from "./firebaseShell.js";
import {
    ensureFirebaseTotpEnrollment,
    getCurrentFirebaseUser,
    isFirebaseSessionMfaVerified,
    signOutFirebase
} from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";
import {
    startFirebaseAppStateSync,
    stopFirebaseAppStateSync
} from "./firebaseAppState.js";
import {
    startFirebaseReplacementRequestSync,
    stopFirebaseReplacementRequestSync
} from "./firebaseReplacementRequests.js";
import {
    startFirebaseWorkerRequestSync,
    stopFirebaseWorkerRequestSync
} from "./firebaseWorkerRequests.js";
import {
    getWorkerAppLinkForProfile,
    notifyWorkerApp,
    scheduleWorkerAppDataPublish,
    startWorkerAppDataSync,
    stopWorkerAppDataSync
} from "./workerAppDataSync.js";
import {
    startWorkerAvailabilitySync,
    stopWorkerAvailabilitySync
} from "./workerAvailability.js";
import {
    cancelInterUnitLoan,
    startInterUnitLoanSync,
    stopInterUnitLoanSync
} from "./firebaseInterUnitLoans.js";
import {
    initSupervisorMessages,
    startSupervisorMessages,
    stopSupervisorMessages
} from "./supervisorMessages.js";
import {
    buildAssignedShiftReportPreviewHTML,
    buildDiurnoReportPreviewHTML,
    buildNoAssignmentReportPreviewHTML,
    buildReplacementReportPreviewHTML,
    exportAssignedShiftReport,
    exportDiurnoShiftReport,
    exportHoursReport,
    exportNoAssignmentShiftReport,
    exportReplacementShiftReport,
    isAssignedShiftReportProfile,
    isDiurnoReportProfile,
    isReplacementReportProfile
} from "./hoursReport.js";
import {
    initHoursCharts,
    renderHoursCharts
} from "./hoursCharts.js";
import { renderTimeline, updateTimelineCells } from "./timeline.js";
import { withBusyState } from "./busy.js";
import {
    addAuditLog,
    AUDIT_CATEGORY,
    renderAuditLogPanel
} from "./auditLog.js";
import {
    fetchHolidays,
    getCachedHolidays
} from "./holidays.js";
import { isBusinessDay } from "./calculations.js";
import { TURNO } from "./constants.js";
import {
    turnoLabel,
    aplicarClaseTurno,
    initTurnosSidePanelSync,
    syncTurnosSidePanelHeight
} from "./uiEngine.js";
import {
    aplicarCambiosTurno,
    getTurnoBase,
    getTurnoProgramado
} from "./turnEngine.js";
import { moveShiftTargetCombina24 } from "./rulesEngine.js";
import {
    calcularHorasMesPerfil,
    renderSummaryHTML
} from "./hoursEngine.js";
import { getRaw, setRaw, getJSON, setJSON } from "./persistence.js";
import {
    getProfileData,
    saveProfileData,
    getBaseProfileData,
    saveBaseProfileData,
    getBlockedDays,
    saveBlockedDays,
    getProfiles,
    saveProfiles,
    setCurrentProfile,
    getCurrentProfile,
    getShiftAssigned,
    getShiftAssignmentConfiguredState,
    recordShiftAssignmentChange,
    setShiftAssigned,
    getAdminDays,
    saveAdminDays,
    getLegalDays,
    saveLegalDays,
    getCompDays,
    saveCompDays,
    getAbsences,
    saveAbsences,
    updateProfile,
    getRotativa,
    saveRotativa,
    getManualLeaveBalances,
    saveManualLeaveBalances,
    getCarry,
    getSwaps,
    saveSwaps,
    isProfileActive,
    initializeGradeHistory,
    recordGradeHistoryChange,
    getGradeHistory,
    getContractHistory,
    addContractHistoryEntry,
    estamentoAllowsCustomProfession,
    getProfessionOptionsForEstamento,
    normalizeProfession,
    SIN_INFORMACION_PROFESSION,
    getTurnChangeConfig
} from "./storage.js";
import { cambioEstaAnulado } from "./swaps.js";
import {
    cancelFutureShiftMovesForWorker,
    registerShiftMove
} from "./shiftMoves.js";
import {
    cancelFutureReplacementsForWorker,
    renderReplacementLogHTML
} from "./replacements.js";
import {
    refreshWorkerRequestsNavBadge,
    renderWorkerRequestsPanel,
    setHheeReturnRequestHandler
} from "./workerRequests.js";
import {
    openWorkerAppInviteDialog,
    sendWorkerAppInviteEmail,
    unlinkWorkerAppForProfile
} from "./workerAppInvites.js";
import {
    createReplacementContractMemoTask,
    renderMemosPanel,
    updateMemosNavBadge
} from "./memos.js";
import {
    addReplacementContract,
    formatContractDate,
    getContractsForProfile,
    isHonorariaContractType,
    isReplacementContractType
} from "./contracts.js";
import {
    REPLACEMENT_ROTATION_MODE,
    normalizeReplacementRotationMode,
    replacementRotationModeLabel
} from "./replacementRotation.js";
import {
    canEditTarget,
    canViewTarget,
    firstViewableTarget,
    listWorkspaceMembersForPermissions,
    loadWorkspacePermissions,
    startWorkspacePermissionListener,
    stopWorkspacePermissionListener,
    workspaceRequiresMfa
} from "./workspacePermissions.js";
import {
    getClockMarks,
    saveClockMarks,
    getClockScheduleState,
    getScheduledSegmentsForProfile,
    openClockMarkDialog
} from "./clockMarks.js";
import {
    getHourReturn,
    getHourReturns,
    saveHourReturn,
    saveHourReturns
} from "./hourReturns.js";
import {
    calculateHheeReturnTransferHours,
    getHheeReturnTransfer,
    getHheeReturnTransfers,
    isHheeReturnTransferEnabled,
    saveHheeReturnTransfer
} from "./hourReturnTransfers.js";
import {
    totalAdministrativosUsados,
    aplicarAdministrativo,
    aplicarHalfAdministrativo,
    aplicarAusenciaInjustificada,
    aplicarLegal,
    aplicarComp,
    aplicarLicencia,
    existeBloque10Legal,
    validarCantidadLegalAnual
} from "./leaveEngine.js";
import {
    installAppDialogs,
    showConfirm,
    showPrompt
} from "./dialogs.js";

initPerformanceMonitor();
installAppDialogs();

let selectionMode = null;
let pendingRotationChange = null;
let pendingShiftMove = null;
let createAvailabilityBalances = null;
let adminCantidad = 0;
let compCantidad = 0;
let legalCantidad = 0;
let licenseCantidad = 0;
let licenseType = "license";
let availabilityEditMode = false;
let availabilityHistoryYear = new Date().getFullYear();
let availabilityHistoryProfile = "";
let profileRotationMiniDate = new Date();
let replacementContractMonthHint = "";
let profileHoursSummaryRequest = 0;
let clockMarksRenderRequest = 0;
let calendarDirectEditEnabled = false;
let reportsDetailRequest = 0;
let reportsMonthDate = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    1
);
let reportsMonthPicker = null;
let reportsMonthPickerYear = reportsMonthDate.getFullYear();
let reportsMonthPickerAnchor = null;
let reportsMonthPickerListenersBound = false;
let clockMarksMonthDate = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    1
);
let clockMarksMonthTouched = false;

const FOURTH_SHIFT_NO_ASSIGNMENT_REPORT_LABEL =
    "3er o 4\u00b0 Turno sin asignaci\u00f3n de turno";
const FOURTH_SHIFT_ASSIGNED_REPORT_LABEL =
    "3er o 4\u00b0 Turno con asignaci\u00f3n de turno";
const REPLACEMENT_REPORT_LABEL =
    "Contrato Reemplazo";
const DIURNO_REPORT_LABEL =
    "Rotativa Diurno";
const REPORT_MONTH_NAMES = [
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

function defaultCreateAvailabilityBalances() {
    return {
        legal: 15,
        comp: 10,
        admin: 6,
        hoursReturn: 0
    };
}

function syncProfileProfessionField(data, editing) {
    if (!DOM.profileProfessionSelect) return;

    const estamento = data.estamento || "";
    const allowsCustom =
        estamentoAllowsCustomProfession(estamento);
    const options = getProfessionOptionsForEstamento(estamento);
    const normalizedProfession = normalizeProfession(
        data.profession,
        estamento
    );

    replaceProfessionOptions(
        DOM.profileProfessionSelect,
        options
    );
    replaceProfessionOptions(
        DOM.profileProfessionOptions,
        getProfessionOptionsForEstamento("Administrativo")
    );

    DOM.profileProfessionSelect.classList.toggle(
        "hidden",
        allowsCustom
    );
    DOM.profileProfessionSelect.disabled =
        !editing || allowsCustom;
    DOM.profileProfessionSelect.value = normalizedProfession;

    if (
        !allowsCustom &&
        DOM.profileProfessionSelect.value !== normalizedProfession
    ) {
        DOM.profileProfessionSelect.value =
            SIN_INFORMACION_PROFESSION;
    }

    if (DOM.profileProfessionCustomInput) {
        DOM.profileProfessionCustomInput.classList.toggle(
            "hidden",
            !allowsCustom
        );
        DOM.profileProfessionCustomInput.disabled =
            !editing || !allowsCustom;
        DOM.profileProfessionCustomInput.value =
            normalizedProfession === SIN_INFORMACION_PROFESSION
                ? ""
                : normalizedProfession;
    }
}

function getProfileMetaLabel(profile) {
    const role = profile.estamento || "Sin estamento";

    if (!profileUsesProfession(profile)) {
        return role;
    }

    return `${role} | ${formatProfession(profile.profession)}`;
}


window.selectionMode = null;
window.pendingShiftMoveSourceKey = "";
window.pendingShiftMoveDestinationTurn = 0;
window.compCantidad = 0;
window.legalCantidad = 0;
window.licenseCantidad = 0;
window.licenseType = "license";
window.pushUndoState = pushHistory;
window.getProfileDraftSelectionKey = () =>
    inputDateToCalendarKey(
        isReplacementDraft()
            ? profileDraft.contractStart
            : profileDraft.rotationStart
    );

const HR_LOG_CONFIG = [
    {
        key: "academic",
        title: "Formacion academica",
        fields: [
            { name: "level", label: "Nivel" },
            { name: "institution", label: "Institucion" },
            { name: "degree", label: "Titulo/Grado obtenido" },
            { name: "year", label: "A\u00f1o de egreso", type: "number" }
        ],
        fileLabel: "Titulo PDF"
    },
    {
        key: "training",
        title: "Capacitaciones",
        fields: [
            { name: "name", label: "Nombre de la capacitacion" },
            { name: "hours", label: "Horas academicas", type: "number" },
            { name: "grade", label: "Nota obtenida" },
            { name: "date", label: "Fecha de realizacion", type: "date" }
        ],
        fileLabel: "Certificado PDF"
    },
    {
        key: "diplomas",
        title: "Diplomados",
        fields: [
            { name: "name", label: "Nombre del diplomado" },
            { name: "hours", label: "Horas academicas", type: "number" },
            { name: "grade", label: "Nota obtenida" },
            { name: "date", label: "Fecha de realizacion", type: "date" }
        ],
        fileLabel: "Certificado PDF"
    },
    {
        key: "experience",
        title: "Experiencia laboral previa",
        fields: [
            { name: "institution", label: "Institucion" },
            { name: "role", label: "Cargo" },
            { name: "start", label: "Fecha ingreso", type: "date" },
            { name: "end", label: "Fecha egreso", type: "date" },
            { name: "functions", label: "Funciones principales", type: "textarea" }
        ]
    },
    {
        key: "events",
        title: "Eventos",
        filterYear: true,
        fields: [
            { name: "date", label: "Fecha", type: "date" },
            { name: "detail", label: "Detalle", type: "textarea" }
        ]
    },
    {
        key: "merit",
        title: "Anotaciones de m\u00e9rito",
        filterYear: true,
        fields: [
            { name: "date", label: "Fecha", type: "date" },
            { name: "title", label: "T\u00edtulo de la anotaci\u00f3n" }
        ],
        fileLabel: "Archivo escaneado"
    },
    {
        key: "demerit",
        title: "Anotaciones de dem\u00e9rito",
        filterYear: true,
        fields: [
            { name: "date", label: "Fecha", type: "date" },
            { name: "title", label: "T\u00edtulo de la anotaci\u00f3n" }
        ],
        fileLabel: "Archivo escaneado"
    },
    {
        key: "performance",
        title: "Evaluaciones de desempe\u00f1o",
        filterYear: true,
        fields: [
            { name: "date", label: "Fecha", type: "date" },
            { name: "detail", label: "Detalle importante", type: "textarea" }
        ],
        fileLabel: "Calificacion escaneada"
    }
];

const recordYearFilters = {};
let cancelProfileSecondaryRender = null;
let profileSecondaryRenderRequest = 0;

function contarHabiles(
    obj,
    year = new Date().getFullYear(),
    holidays = getCachedHolidays(year)
) {
    let total = 0;

    Object.keys(obj).forEach(key => {
        if (!key.startsWith(year + "-")) return;

        const date = parseKey(key);

        if (isBusinessDay(date, holidays)) total++;
    });

    return total;
}


function getLeaveBalances(
    year = new Date().getFullYear(),
    holidays = getCachedHolidays(year),
    options = {}
) {
    const profileName =
        options.profileName || getCurrentProfile();
    const targetMonth =
        Number.isFinite(Number(options.month))
            ? Number(options.month)
            : Number(year) === currentDate.getFullYear()
                ? currentDate.getMonth()
                : null;
    const manual = getManualLeaveBalances(year, profileName);
    const calculated = {
        legal: Math.max(0, 15 - contarHabiles(getLegalDays(), year, holidays)),
        admin: Math.max(0, 6 - totalAdministrativosUsados(year)),
        comp: Math.max(0, 10 - contarHabiles(getCompDays(), year, holidays))
    };
    const hoursReturnTotal =
        withManualBalance(manual.hoursReturn, 0);
    const unavailableFutureHours =
        targetMonth === null
            ? 0
            : futureHheeReturnTransferHours(
                profileName,
                year,
                targetMonth
            );

    return {
        legal: normalizeLegalBalanceValue(
            withManualBalance(manual.legal, calculated.legal)
        ),
        admin: withManualBalance(manual.admin, calculated.admin),
        comp: withManualBalance(manual.comp, calculated.comp),
        hoursReturn: Math.max(
            0,
            normalizeBalanceValue(
                hoursReturnTotal - unavailableFutureHours
            )
        )
    };
}

const COMP_ENTITLEMENT_OPTIONS = [10, 20];

function normalizeLegalBalanceValue(value) {
    return Math.max(
        0,
        Math.floor(normalizeBalanceValue(value))
    );
}

function normalizeCompEntitlement(value) {
    const numeric = Number(value);

    return numeric > 10 ? 20 : 10;
}

function isCompensatoryBlockAmount(value) {
    return COMP_ENTITLEMENT_OPTIONS.includes(Number(value));
}

function compDaysUsedForYear(
    year = new Date().getFullYear(),
    holidays = getCachedHolidays(year)
) {
    return contarHabiles(getCompDays(), year, holidays);
}

function compEntitlementFromBalance(
    balance,
    year = new Date().getFullYear(),
    holidays = getCachedHolidays(year)
) {
    const used = compDaysUsedForYear(year, holidays);

    return normalizeCompEntitlement(
        normalizeBalanceValue(balance) + used
    );
}

function compBalanceFromEntitlement(
    entitlement,
    year = new Date().getFullYear(),
    holidays = getCachedHolidays(year)
) {
    const used = compDaysUsedForYear(year, holidays);
    const cleanEntitlement = normalizeCompEntitlement(entitlement);

    return Math.max(
        0,
        normalizeBalanceValue(cleanEntitlement - used)
    );
}

function compEntitlementOptionsHTML(selected, used = 0) {
    const cleanSelected = normalizeCompEntitlement(selected);

    return COMP_ENTITLEMENT_OPTIONS.map(value => `
        <option
            value="${value}"
            ${value === cleanSelected ? "selected" : ""}
            ${used > value ? "disabled" : ""}
        >
            ${value} d&iacute;as
        </option>
    `).join("");
}

function readCompBalanceFromInput(year = new Date().getFullYear()) {
    const input = document.getElementById("availabilityCompInput");

    if (!input) {
        return {
            hasInput: false,
            balance: undefined
        };
    }

    return {
        hasInput: true,
        balance: compBalanceFromEntitlement(input.value, year)
    };
}

function decrementManualBalance(
    field,
    amount,
    year = new Date().getFullYear()
) {
    const manual = getManualLeaveBalances(year);
    const currentValue = Number(manual[field]);

    if (!Number.isFinite(currentValue)) return;

    saveManualLeaveBalances(year, {
        ...manual,
        [field]: Math.max(
            0,
            normalizeBalanceValue(currentValue - amount)
        )
    });
}

function incrementManualBalance(
    field,
    amount,
    year = new Date().getFullYear()
) {
    const manual = getManualLeaveBalances(year);
    const currentValue = Number(manual[field]);

    if (!Number.isFinite(currentValue)) return;

    saveManualLeaveBalances(year, {
        ...manual,
        [field]: Math.max(
            0,
            normalizeBalanceValue(currentValue + amount)
        )
    });
}

// Devuelve el saldo manual del permiso anulado desde el LOG, en el ANIO y el
// TRABAJADOR del permiso (la anulacion puede ser de otro trabajador distinto al
// activo). Solo aplica si ese trabajador tiene saldo manual configurado; si es
// calculado, se restaura solo al quitar los dias.
const LEAVE_UNDO_BALANCE_FIELD = {
    admin: "admin",
    half_admin_morning: "admin",
    half_admin_afternoon: "admin",
    legal: "legal",
    comp: "comp"
};

function restoreLeaveBalanceFromUndo(detail = {}) {
    const field = LEAVE_UNDO_BALANCE_FIELD[detail.leaveType];
    const amount = Number(detail.leaveAmount) || 0;
    const year = Number(detail.leaveYear) || new Date().getFullYear();
    const profile = String(detail.profile || "") || getCurrentProfile();

    if (!field || amount <= 0 || !profile) return;

    const manual = getManualLeaveBalances(year, profile);
    const currentValue = Number(manual[field]);

    if (!Number.isFinite(currentValue)) return;

    saveManualLeaveBalances(year, {
        ...manual,
        [field]: Math.max(
            0,
            normalizeBalanceValue(currentValue + amount)
        )
    }, profile);
}

function syncRutValidity(showMessage = false) {
    const message = getRutValidationMessage(
        DOM.profileRutInput.value
    );

    DOM.profileRutInput.setCustomValidity(message);

    if (message && showMessage) {
        DOM.profileRutInput.reportValidity();
    }

    return !message;
}

function syncEmailValidity(showMessage = false) {
    const message = getEmailValidationMessage(
        DOM.profileEmailInput.value
    );

    DOM.profileEmailInput.setCustomValidity(message);

    if (message && showMessage) {
        DOM.profileEmailInput.reportValidity();
    }

    return !message;
}

// Muestra la "nube" de aviso mientras se escribe el correo; se oculta si el
// campo esta vacio o no se esta editando.
function updateProfileEmailHint() {
    if (!DOM.profileEmailHint) return;

    DOM.profileEmailHint.hidden =
        !isProfileEditing() ||
        !DOM.profileEmailInput.value.trim();
}

function hideProfileEmailHint() {
    if (DOM.profileEmailHint) {
        DOM.profileEmailHint.hidden = true;
    }
}

async function openAttachment(doc) {
    try {
        await openAttachmentFile(doc, { newTab: true });
    } catch (error) {
        alert(
            error?.message ||
            "No se pudo abrir el archivo adjunto."
        );
    }
}

function getProfileLogs(profileName) {
    const logs = getJSON(`hrLogs_${profileName}`, {});
    const normalized = {};

    HR_LOG_CONFIG.forEach(config => {
        normalized[config.key] = Array.isArray(logs[config.key])
            ? logs[config.key]
            : [];
    });

    return normalized;
}

function saveProfileLogs(profileName, logs) {
    if (!profileName) return;

    setJSON(`hrLogs_${profileName}`, logs || {});
}

function syncHoursMonthControls(forceChartMonth = false) {
    if (DOM.hheeMonthLabel) {
        DOM.hheeMonthLabel.textContent =
            formatMonthHeading(profileRotationMiniDate);
    }

    if (
        DOM.hheeChartMonth &&
        (
            forceChartMonth ||
            !DOM.hheeChartMonth.value
        )
    ) {
        DOM.hheeChartMonth.value =
            toMonthInputValue(profileRotationMiniDate);
    }
}

function setHoursMonthFromValue(value) {
    const nextDate = parseMonthInputValue(value);

    if (!nextDate) return;

    profileRotationMiniDate = nextDate;
    syncHoursMonthControls(true);
    renderDashboardState();
}

function changeHoursMonth(offset) {
    profileRotationMiniDate = new Date(
        profileRotationMiniDate.getFullYear(),
        profileRotationMiniDate.getMonth() + offset,
        1
    );

    syncHoursMonthControls(true);
    renderDashboardState();
}

window.setHoursMonthFromValue = setHoursMonthFromValue;

function syncClockMarksMonthFromCurrent(force = false) {
    if (!force && clockMarksMonthTouched) return;

    clockMarksMonthDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
    );
}

function renderClockMarksMonthControls() {
    if (DOM.clockMarksMonthLabel) {
        DOM.clockMarksMonthLabel.textContent =
            formatMonthHeading(clockMarksMonthDate);
    }
}

function changeClockMarksMonth(offset) {
    clockMarksMonthTouched = true;
    clockMarksMonthDate = new Date(
        clockMarksMonthDate.getFullYear(),
        clockMarksMonthDate.getMonth() + offset,
        1
    );

    renderClockMarksPanel();
}

function profileSupportsLibreRotation(profile = {}) {
    return (
        isReplacementContractType(profile.contractType) ||
        isHonorariaContractType(profile.contractType)
    );
}

function getCalendarRotationOptions(profile = {}) {
    const options = [
        { value: "3turno", label: "3er Turno" },
        { value: "4turno", label: "4to Turno" },
        { value: "diurno", label: "Diurno" }
    ];

    if (profileSupportsLibreRotation(profile)) {
        options.push({ value: "libre", label: "Libre" });
    }

    return options;
}

function getCalendarRotationDefaultState(profile) {
    const rotativa = getRotativa(profile?.name);
    const options = getCalendarRotationOptions(profile);
    const fallbackType = options[0]?.value || "4turno";
    const existingType = options.some(option =>
        option.value === rotativa.type
    )
        ? rotativa.type
        : fallbackType;

    return {
        type: existingType,
        firstTurn: normalizeRotationFirstTurnForType(
            existingType,
            rotativa.firstTurn
        )
    };
}

function syncProfileRotationOptions(data = profileDraft) {
    const select = DOM.profileRotationSelect;

    if (!select) return;

    const replacementContract = isReplacementDraft(data);
    const libreAllowed = supportsLibreRotation(data);
    const emptyOption = select.querySelector('option[value=""]');
    const libreOption = select.querySelector('option[value="libre"]');

    if (emptyOption) {
        emptyOption.textContent = replacementContract
            ? "Heredar rotativa del trabajador reemplazado"
            : "Seleccionar";
    }

    select
        .querySelectorAll(
            'option[value="3turno"], option[value="4turno"], option[value="diurno"]'
        )
        .forEach(option => {
            option.hidden = replacementContract;
            option.disabled = replacementContract;
        });

    if (libreOption) {
        libreOption.hidden = !libreAllowed;
        libreOption.disabled = !libreAllowed;
    }
}



function canModifyCurrentProfile() {
    if (!canEditTarget("calendarPanel")) {
        alert("Tu usuario tiene permiso solo de lectura en Turnos.");
        return false;
    }

    const profile = getPerfilActual();

    if (!profile || isProfileActive(profile)) {
        return true;
    }

    alert(
        "Este perfil esta desactivado. Reactivalo desde Perfil para cargar turnos, permisos o modificaciones de calendario."
    );
    return false;
}

function canEditCurrentProfileMenu() {
    if (canEditTarget("profileSection")) return true;

    alert("Tu usuario tiene permiso solo de lectura en Perfiles.");
    return false;
}

function renderContractHistory(profile) {
    if (!DOM.profileContractHistory) return;

    if (!profile || profileDraft.mode === PROFILE_MODE.CREATE) {
        DOM.profileContractHistory.innerHTML = `
            <div class="contract-history-empty">
                Guarda el perfil para ver su historial contractual.
            </div>
        `;
        return;
    }

    const gradeHistory = getGradeHistory(profile.name);
    const contractHistory = getContractHistory(profile.name);
    const replacementContracts = getContractsForProfile(profile.name);
    const gradeItems = gradeHistory
        .slice()
        .sort((a, b) => b.start.localeCompare(a.start))
        .map(entry => `
            <li>
                <strong>Desde ${escapeHTML(formatDisplayDate(entry.start))}</strong>
                <span>
                    ${escapeHTML(entry.estamento || "Sin estamento")} |
                    ${escapeHTML(entry.contractType || "Sin contrato")} |
                    Grado ${escapeHTML(entry.grade || "sin registro")}
                </span>
            </li>
        `)
        .join("");
    const changeItems = contractHistory
        .map(entry => `
            <li>
                <strong>${escapeHTML(formatHistoryDateTime(entry.createdAt))}</strong>
                ${entry.effectiveDate ? `
                    <small>Rige desde ${escapeHTML(formatDisplayDate(entry.effectiveDate))}</small>
                ` : ""}
                <span>
                    ${entry.changes.map(change => `
                        ${escapeHTML(change.label)}:
                        ${escapeHTML(change.from || "Sin dato")}
                        -> ${escapeHTML(change.to || "Sin dato")}
                    `).join("<br>")}
                </span>
            </li>
        `)
        .join("");
    const contractItems = replacementContracts
        .map(contract => `
            <li>
                <strong>
                    ${escapeHTML(formatContractDate(contract.start))}
                    -
                    ${escapeHTML(formatContractDate(contract.end))}
                </strong>
                ${contract.reason ? `
                    <span>Motivo: ${escapeHTML(contract.reason)}</span>
                ` : ""}
                <span>Reemplaza a: ${escapeHTML(contract.replaces)}</span>
            </li>
        `)
        .join("");

    DOM.profileContractHistory.innerHTML = `
        <div class="contract-history-head">
            <strong>Historial contractual</strong>
            <span>Vigencias y cambios anteriores del perfil.</span>
        </div>

        <div class="contract-history-grid">
            <section class="contract-history-section">
                <h4>Grados, contrato y estamento</h4>
                <ul>
                    ${gradeItems || `
                        <li class="contract-history-muted">
                            Sin vigencias anteriores registradas.
                        </li>
                    `}
                </ul>
            </section>

            <section class="contract-history-section">
                <h4>Cambios registrados</h4>
                <ul>
                    ${changeItems || `
                        <li class="contract-history-muted">
                            Aun no hay cambios contractuales historicos.
                        </li>
                    `}
                </ul>
            </section>

            <section class="contract-history-section">
                <h4>Contratos de reemplazo</h4>
                <ul>
                    ${contractItems || `
                        <li class="contract-history-muted">
                            Sin contratos de reemplazo registrados.
                        </li>
                    `}
                </ul>
            </section>
        </div>
    `;
}

function getProfileRotationState(profileName, key) {
    if (!profileName) return 0;

    return aplicarCambiosTurno(
        profileName,
        key,
        getTurnoProgramado(profileName, key)
    );
}

function getRotationModalMonth(type) {
    const defaultStart = getRotationConfigDefaultStart(type);
    const source =
        type === "reemplazo"
            ? profileDraft.contractStart ||
                replacementContractMonthHint ||
                profileDraft.rotationStart ||
                getDraftUnitEntryDate()
            : profileDraft.rotationStart ||
                defaultStart;
    const date = source
        ? parseInputDate(source)
        : new Date();

    if (Number.isNaN(date.getTime())) {
        return new Date();
    }

    return new Date(date.getFullYear(), date.getMonth(), 1);
}

const REPLACEMENT_CONTRACT_LOOKBACK_MONTHS = 6;
const REPLACEMENT_CONTRACT_LEAVE_TYPES = {
    legal: "F. Legal",
    comp: "F. Compensatorios",
    license: "Licencia M\u00e9dica",
    professional_license: "LM Profesional",
    unpaid_leave: "Permiso sin Goce"
};

function replacementLeaveOptionId({
    profileName,
    type,
    start,
    end
}) {
    return [
        profileName,
        type,
        start,
        end
    ].map(part =>
        encodeURIComponent(String(part || ""))
    ).join("|");
}

function replacementLeaveCutoffISO() {
    const today = new Date();
    const cutoff = new Date(
        today.getFullYear(),
        today.getMonth() - REPLACEMENT_CONTRACT_LOOKBACK_MONTHS,
        today.getDate()
    );

    return toInputDate(cutoff);
}

function calendarKeysToReplacementLeaveOption({
    profileName,
    type,
    label,
    keys
}) {
    const sortedKeys = sortReplacementLeaveKeys(keys);

    if (!sortedKeys.length) return null;

    const start = calendarKeyToInputDate(sortedKeys[0]);
    const end = calendarKeyToInputDate(
        sortedKeys[sortedKeys.length - 1]
    );

    if (!start || !end) return null;

    const option = {
        id: "",
        profileName,
        type,
        label,
        start,
        end,
        keys: sortedKeys
    };

    option.id = replacementLeaveOptionId(option);

    return option;
}

function groupReplacementLeaveKeys({
    profileName,
    type,
    label,
    keys,
    businessContinuity = false
}) {
    const groups = groupContinuousReplacementLeaveKeys(
        keys,
        {
            businessContinuity,
            isBusinessDay: date => isBusinessDay(
                date,
                getCachedHolidays(date.getFullYear())
            )
        }
    );

    return groups
        .map(group => calendarKeysToReplacementLeaveOption({
            profileName,
            type,
            label,
            keys: group
        }))
        .filter(Boolean);
}

function normalizeReplacementAbsenceType(value) {
    if (!value) return "";

    if (typeof value === "object") {
        return String(value.type || "");
    }

    return String(value);
}

function isReplacementLeaveOptionUsed(option) {
    return getProfiles().some(profile =>
        getContractsForProfile(profile.name)
            .some(contract =>
                contract.leaveRef === option.id ||
                (
                    !contract.leaveRef &&
                    contract.replaces === option.profileName &&
                    contract.reason === option.label &&
                    contract.start === option.start &&
                    contract.end === option.end
                )
            )
    );
}

function getReplacementLeaveOptionsForProfile(profileName) {
    const profile = getProfiles().find(item =>
        item.name === profileName
    );

    if (!profile) return [];

    const cutoff = replacementLeaveCutoffISO();
    const legal = getJSON("legal_" + profile.name, {});
    const comp = getJSON("comp_" + profile.name, {});
    const absences = getJSON("absences_" + profile.name, {});
    const options = [
        ...groupReplacementLeaveKeys({
            profileName: profile.name,
            type: "legal",
            label: REPLACEMENT_CONTRACT_LEAVE_TYPES.legal,
            keys: Object.keys(legal).filter(key => legal[key]),
            businessContinuity: true
        }),
        ...groupReplacementLeaveKeys({
            profileName: profile.name,
            type: "comp",
            label: REPLACEMENT_CONTRACT_LEAVE_TYPES.comp,
            keys: Object.keys(comp).filter(key => comp[key]),
            businessContinuity: true
        })
    ];
    const absenceTypes = Object.keys(REPLACEMENT_CONTRACT_LEAVE_TYPES)
        .filter(type => type !== "legal" && type !== "comp");

    absenceTypes.forEach(type => {
        options.push(...groupReplacementLeaveKeys({
            profileName: profile.name,
            type,
            label: REPLACEMENT_CONTRACT_LEAVE_TYPES[type],
            keys: Object.keys(absences).filter(key =>
                normalizeReplacementAbsenceType(absences[key]) === type
            )
        }));
    });

    return options
        .filter(option => option.end >= cutoff)
        .filter(option => !isReplacementLeaveOptionUsed(option))
        .sort((a, b) =>
            b.start.localeCompare(a.start) ||
            a.label.localeCompare(b.label)
        );
}

function findReplacementLeaveOption(profileName, optionId) {
    return getReplacementLeaveOptionsForProfile(profileName)
        .find(option => option.id === optionId) || null;
}

function openRotationConfigModal(type = profileDraft.rotationType) {
    if (!isProfileEditing() || !type) return;

    const profile = getPerfilActual();
    const isReplacement = type === "reemplazo";
    const isHonoraria = !isReplacement && isHonorariaDraft();
    const defaultRotationStart =
        getRotationConfigDefaultStart(type);
    const state = {
        monthDate: getRotationModalMonth(type),
        rotationStart: isReplacement
            ? profileDraft.rotationStart
            : profileDraft.rotationStart || defaultRotationStart,
        firstTurn: normalizeRotationFirstTurnForType(
            type,
            profileDraft.rotationFirstTurn
        ),
        contractStart: profileDraft.contractStart,
        contractEnd: profileDraft.contractEnd,
        contractReplaces: profileDraft.contractReplaces || "",
        contractReason: profileDraft.contractReason || "",
        contractLeaveRef: profileDraft.contractLeaveRef || "",
        contractRotationMode: normalizeReplacementRotationMode(
            profileDraft.contractRotationMode,
            REPLACEMENT_ROTATION_MODE.INHERIT
        )
    };
    const backdrop = document.createElement("div");
    let monthPicker = null;
    let monthPickerAnchor = null;
    let monthPickerYear = state.monthDate.getFullYear();
    let monthPickerListenersBound = false;
    const handleRotationMonthPickerOutsideClick = () => {
        closeRotationMonthPicker();
    };
    const handleRotationMonthPickerKeydown = event => {
        if (event.key === "Escape") {
            closeRotationMonthPicker();
        }
    };

    backdrop.className = "turn-change-dialog-backdrop";
    document.body.appendChild(backdrop);

    const close = () => {
        closeRotationMonthPicker();
        if (monthPickerListenersBound) {
            monthPickerListenersBound = false;
            document.removeEventListener(
                "click",
                handleRotationMonthPickerOutsideClick
            );
            document.removeEventListener(
                "keydown",
                handleRotationMonthPickerKeydown
            );
            window.removeEventListener(
                "resize",
                positionRotationMonthPicker
            );
            window.removeEventListener(
                "scroll",
                positionRotationMonthPicker,
                true
            );
        }
        monthPicker?.remove();
        monthPicker = null;
        backdrop.remove();
    };
    const closeRotationMonthPicker = () => {
        if (!monthPicker) return;

        monthPicker.classList.add("hidden");
        monthPickerAnchor?.setAttribute("aria-expanded", "false");
        monthPickerAnchor = null;
    };
    const positionRotationMonthPicker = () => {
        if (
            !monthPickerAnchor ||
            !monthPicker ||
            monthPicker.classList.contains("hidden")
        ) {
            return;
        }

        const gap = 8;
        const edge = 12;
        const triggerRect = monthPickerAnchor.getBoundingClientRect();
        const pickerRect = monthPicker.getBoundingClientRect();
        const left = Math.min(
            Math.max(
                edge,
                triggerRect.left +
                    (triggerRect.width - pickerRect.width) / 2
            ),
            window.innerWidth - pickerRect.width - edge
        );
        const preferredTop = triggerRect.bottom + gap;
        const top =
            preferredTop + pickerRect.height <= window.innerHeight - edge
                ? preferredTop
                : Math.max(edge, triggerRect.top - pickerRect.height - gap);

        monthPicker.style.left = `${Math.round(left)}px`;
        monthPicker.style.top = `${Math.round(top)}px`;
    };
    const ensureRotationMonthPicker = () => {
        if (monthPicker) return;

        monthPicker = document.createElement("div");
        monthPicker.className = "calendar-month-picker hidden";
        monthPicker.setAttribute("role", "dialog");
        monthPicker.setAttribute(
            "aria-label",
            "Seleccionar mes y a\u00f1o de rotativa"
        );
        document.body.appendChild(monthPicker);

        monthPicker.addEventListener("click", event => {
            event.stopPropagation();
        });
        if (!monthPickerListenersBound) {
            monthPickerListenersBound = true;
            document.addEventListener(
                "click",
                handleRotationMonthPickerOutsideClick
            );
            document.addEventListener(
                "keydown",
                handleRotationMonthPickerKeydown
            );
            window.addEventListener("resize", positionRotationMonthPicker);
            window.addEventListener(
                "scroll",
                positionRotationMonthPicker,
                true
            );
        }
    };
    const renderRotationMonthPicker = () => {
        if (!monthPicker) return;

        const activeYear = state.monthDate.getFullYear();
        const activeMonth = state.monthDate.getMonth();

        monthPicker.innerHTML = `
            <div class="calendar-month-picker__year">
                <button class="calendar-month-picker__year-button" type="button" data-rotation-modal-year-step="-1" aria-label="A&#241;o anterior">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                </button>
                <strong>${monthPickerYear}</strong>
                <button class="calendar-month-picker__year-button" type="button" data-rotation-modal-year-step="1" aria-label="A&#241;o siguiente">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </button>
            </div>
            <div class="calendar-month-picker__months">
                ${REPORT_MONTH_NAMES.map((name, month) => `
                    <button
                        class="calendar-month-picker__month${monthPickerYear === activeYear && month === activeMonth ? " is-active" : ""}"
                        type="button"
                        data-rotation-modal-month="${month}"
                    >
                        ${name}
                    </button>
                `).join("")}
            </div>
        `;

        monthPicker
            .querySelectorAll("[data-rotation-modal-year-step]")
            .forEach(button => {
                button.onclick = event => {
                    event.stopPropagation();
                    monthPickerYear += Number(
                        button.dataset.rotationModalYearStep
                    );
                    renderRotationMonthPicker();
                    positionRotationMonthPicker();
                };
            });

        monthPicker
            .querySelectorAll("[data-rotation-modal-month]")
            .forEach(button => {
                button.onclick = event => {
                    event.stopPropagation();
                    state.monthDate = new Date(
                        monthPickerYear,
                        Number(button.dataset.rotationModalMonth),
                        1
                    );
                    closeRotationMonthPicker();
                    render();
                };
            });
    };
    const openRotationMonthPicker = trigger => {
        ensureRotationMonthPicker();

        if (
            monthPickerAnchor === trigger &&
            !monthPicker.classList.contains("hidden")
        ) {
            closeRotationMonthPicker();
            return;
        }

        monthPickerAnchor = trigger;
        monthPickerYear = state.monthDate.getFullYear();
        renderRotationMonthPicker();
        monthPicker.classList.remove("hidden");
        trigger.setAttribute("aria-expanded", "true");
        positionRotationMonthPicker();
    };
    const pickDate = key => {
        const selected = calendarKeyToInputDate(key);

        if (isReplacement) {
            return;
        } else {
            if (isBeforeDraftUnitEntryDate(selected)) {
                alert(rotationStartBeforeUnitEntryMessage(selected));
                return;
            }

            if (
                isHonoraria &&
                (
                    !profileDraft.honorariaStart ||
                    !profileDraft.honorariaEnd ||
                    compareISODate(selected, profileDraft.honorariaStart) < 0 ||
                    compareISODate(selected, profileDraft.honorariaEnd) > 0
                )
            ) {
                alert("Selecciona una fecha de inicio dentro de la vigencia del contrato de Honorarios.");
                return;
            }

            state.rotationStart = selected;
        }

        render();
    };
    const applyReplacementLeaveOptionToState = (
        leaveOption,
        options = {}
    ) => {
        if (!leaveOption) {
            state.contractLeaveRef = "";
            state.contractReason = "";
            state.contractStart = "";
            state.contractEnd = "";
            return;
        }

        state.contractLeaveRef = leaveOption.id;
        state.contractReason = leaveOption.label;
        state.contractStart = leaveOption.start;
        state.contractEnd = leaveOption.end;

        if (options.syncMonth !== false) {
            state.monthDate = parseInputDate(leaveOption.start);
        }
    };
    const save = () => {
        const targetField =
            backdrop.querySelector("[data-contract-replaces]");

        if (targetField) {
            state.contractReplaces = targetField.value;
        }

        const reasonField =
            backdrop.querySelector("[data-contract-leave-ref]");

        if (reasonField) {
            const leaveOption = findReplacementLeaveOption(
                state.contractReplaces,
                reasonField.value
            );

            if (leaveOption) {
                state.contractLeaveRef = leaveOption.id;
                state.contractReason = leaveOption.label;
                state.contractStart = leaveOption.start;
                state.contractEnd = leaveOption.end;
            }
        }

        if (isReplacement) {
            if (!state.contractReplaces.trim()) {
                alert("Debes indicar a quien reemplaza.");
                targetField?.focus();
                return;
            }

            const selectedLeave = findReplacementLeaveOption(
                state.contractReplaces,
                state.contractLeaveRef
            );

            if (!selectedLeave) {
                alert("Debes seleccionar un permiso/ausencia disponible para originar el contrato.");
                reasonField?.focus();
                return;
            }

            profileDraft.contractStart = selectedLeave.start;
            profileDraft.contractEnd = selectedLeave.end;
            profileDraft.contractReplaces =
                state.contractReplaces.trim();
            profileDraft.contractReason =
                selectedLeave.label;
            profileDraft.contractLeaveRef =
                selectedLeave.id;
            profileDraft.contractRotationMode =
                normalizeReplacementRotationMode(
                    state.contractRotationMode,
                    REPLACEMENT_ROTATION_MODE.INHERIT
                );
            profileDraft.rotationFirstTurn = "larga";
        } else {
            if (!state.rotationStart) {
                alert("Debes seleccionar desde que fecha comenzara la rotativa.");
                return;
            }

            if (isBeforeDraftUnitEntryDate(state.rotationStart)) {
                alert(rotationStartBeforeUnitEntryMessage(state.rotationStart));
                return;
            }

            profileDraft.rotationStart = state.rotationStart;
            profileDraft.rotationFirstTurn =
                requiresRotationFirstTurn(type)
                    ? normalizeRotationFirstTurnForType(
                        type,
                        state.firstTurn
                    )
                    : "larga";
            profileDraft.contractStart = "";
            profileDraft.contractEnd = "";
            profileDraft.contractReplaces = "";
            profileDraft.contractReason = "";
            profileDraft.contractLeaveRef = "";
            profileDraft.contractRotationMode =
                REPLACEMENT_ROTATION_MODE.INHERIT;
        }

        close();
        renderDashboardState();
    };
    // Previsualiza el turno de un dia: si ya se eligio fecha de inicio, los dias
    // desde esa fecha muestran la rotativa NUEVA (como quedaria al aplicarla);
    // los anteriores conservan el estado actual. Es solo visual: si no se acepta
    // el modal, no se escribe nada y se mantiene la rotativa anterior.
    const getModalPreviewTurn = (key, iso) => {
        if (isReplacement || !state.rotationStart) {
            return getProfileRotationState(profile?.name, key);
        }

        if (compareISODate(iso, state.rotationStart) < 0) {
            return getProfileRotationState(profile?.name, key);
        }

        const startDate = parseInputDate(state.rotationStart);
        const date = parseKey(key);

        // El motor aplica la rotativa solo dentro del anio del inicio.
        if (date.getFullYear() !== startDate.getFullYear()) {
            return TURNO.LIBRE;
        }

        if (type === "diurno") {
            const holidays = getCachedHolidays(date.getFullYear());
            return isBusinessDay(date, holidays) ? TURNO.DIURNO : TURNO.LIBRE;
        }

        if (type === "3turno" || type === "4turno") {
            const sequence = getRotationSequence(type, state.firstTurn);

            if (!sequence.length) return TURNO.LIBRE;

            const dayIndex = Math.round(
                (date - startDate) / 86400000
            );
            const index =
                ((dayIndex % sequence.length) + sequence.length) %
                sequence.length;

            return sequence[index];
        }

        return TURNO.LIBRE;
    };

    const renderCalendar = () => {
        const y = state.monthDate.getFullYear();
        const m = state.monthDate.getMonth();
        const first = (new Date(y, m, 1).getDay() + 6) % 7;
        const days = new Date(y, m + 1, 0).getDate();
        const selectedKey = inputDateToCalendarKey(
            isReplacement
                ? (
                    state.contractLeaveRef
                        ? state.contractStart
                        : ""
                )
                : state.rotationStart
        );
        const contractEndKey =
            inputDateToCalendarKey(
                isReplacement && !state.contractLeaveRef
                    ? ""
                    : state.contractEnd
            );
        const existingContracts =
            isReplacement && profile
                ? getContractsForProfile(profile.name)
                : [];
        let html = `
            <div class="profile-mini-weekdays">
                <span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span>
            </div>
            <div class="profile-mini-grid rotation-modal-grid">
        `;

        for (let i = 0; i < first; i++) {
            html += `<span class="profile-mini-spacer"></span>`;
        }

        for (let d = 1; d <= days; d++) {
            const key = `${y}-${m}-${d}`;
            const iso = calendarKeyToInputDate(key);
            const stateTurn = getModalPreviewTurn(key, iso);
            const existingContract = existingContracts.find(contract =>
                contract.start <= iso &&
                contract.end >= iso
            );
            const cell = document.createElement("button");
            const outsideHonorariaContract =
                isHonoraria &&
                (
                    !profileDraft.honorariaStart ||
                    !profileDraft.honorariaEnd ||
                    compareISODate(iso, profileDraft.honorariaStart) < 0 ||
                    compareISODate(iso, profileDraft.honorariaEnd) > 0
                );
            const beforeUnitEntry =
                !isReplacement &&
                isBeforeDraftUnitEntryDate(iso);

            cell.type = "button";
            cell.className = isReplacement
                ? "profile-mini-day"
                : "profile-mini-day is-pickable";
            cell.dataset.key = key;

            if (beforeUnitEntry) {
                cell.classList.add("is-contract-disabled");
                cell.disabled = true;
                cell.title =
                    `Anterior al ingreso a la unidad (${formatDisplayDate(getDraftUnitEntryDate())}).`;
            }

            if (outsideHonorariaContract) {
                cell.classList.add("is-contract-disabled");
                cell.disabled = true;
                cell.title = "Fuera de la vigencia del contrato de Honorarios.";
            }

            if (selectedKey === key) {
                cell.classList.add("is-selected");
            }

            if (isReplacement) {
                if (existingContract) {
                    cell.classList.add("has-existing-contract");
                    cell.title =
                        `Contrato vigente: ${formatContractDate(existingContract.start)} - ${formatContractDate(existingContract.end)} | Reemplaza a: ${existingContract.replaces}`;
                }

                if (contractEndKey === key) {
                    cell.classList.add("is-contract-end");
                }

                if (
                    state.contractLeaveRef &&
                    state.contractStart &&
                    state.contractEnd &&
                    iso >= state.contractStart &&
                    iso <= state.contractEnd
                ) {
                    cell.classList.add("is-contract-range");
                    cell.title =
                        `Nuevo Contrato: ${formatDisplayDate(state.contractStart)} al ${formatDisplayDate(state.contractEnd)} | Reemplaza a: ${state.contractReplaces || "sin trabajador"}`;
                }
            }

            aplicarClaseTurno(cell, stateTurn);
            cell.innerHTML = `
                <span>${d}</span>
                <small>${
                    isReplacement
                        ? (
                            state.contractLeaveRef &&
                            state.contractStart &&
                            state.contractEnd &&
                            iso >= state.contractStart &&
                            iso <= state.contractEnd
                        )
                            ? '<span class="contract-day-label contract-day-label--new">Nuevo Contrato</span>'
                            : existingContract
                                ? '<span class="contract-day-label contract-day-label--current">Contrato vigente</span>'
                            : ""
                        : turnoLabel(stateTurn)
                }</small>
            `;
            html += cell.outerHTML;
        }

        return `${html}</div>`;
    };
    const render = () => {
        closeRotationMonthPicker();

        const replacementCandidates = isReplacement
            ? buildReplacementContractCandidates({
                profiles: getProfiles(),
                replacementProfile: {
                    ...(profile || {}),
                    name: profileDraft.name || profile?.name || "",
                    estamento:
                        profileDraft.estamento ||
                        profile?.estamento ||
                        ""
                },
                getLeaveOptions:
                    getReplacementLeaveOptionsForProfile
            })
            : [];
        const currentTargetIsEligible =
            replacementCandidates.some(candidate =>
                candidate.profile.name === state.contractReplaces
            );
        const resolvedReplacementSelection = isReplacement
            ? resolveReplacementContractSelection(
                replacementCandidates,
                {
                    profileName: state.contractReplaces,
                    leaveId: currentTargetIsEligible
                        ? state.contractLeaveRef
                        : ""
                }
            )
            : { profileName: "", leaveOption: null };

        if (isReplacement) {
            const targetChanged =
                state.contractReplaces !==
                resolvedReplacementSelection.profileName;

            if (targetChanged) {
                applyReplacementLeaveOptionToState(null);
            }

            state.contractReplaces =
                resolvedReplacementSelection.profileName;

            if (
                resolvedReplacementSelection.leaveOption &&
                state.contractLeaveRef !==
                    resolvedReplacementSelection.leaveOption.id
            ) {
                applyReplacementLeaveOptionToState(
                    resolvedReplacementSelection.leaveOption
                );
            } else if (
                !resolvedReplacementSelection.leaveOption &&
                state.contractLeaveRef
            ) {
                applyReplacementLeaveOptionToState(null);
            }
        }

        const replacementProfiles = replacementCandidates.map(
            candidate => candidate.profile
        );
        const selectedReplacementCandidate =
            replacementCandidates.find(candidate =>
                candidate.profile.name === state.contractReplaces
            ) || null;
        const replacementLeaveOptions =
            selectedReplacementCandidate?.leaveOptions || [];
        const selectedLeaveOption = replacementLeaveOptions.find(option =>
            option.id === state.contractLeaveRef
        ) || null;

        const heading = state.monthDate.toLocaleString(
            "es-CL",
            {
                month: "long",
                year: "numeric"
            }
        );
        const title = isReplacement
            ? "Configurar contrato de reemplazo"
            : `Configurar ${getRotativaLabel(type)}`;
        const instructions = isReplacement
            ? "Selecciona a quien reemplaza y luego el permiso/ausencia que origina el reemplazo. El contrato tomara exactamente las mismas fechas."
            : isHonoraria
                ? `Selecciona el inicio de la rotativa dentro de la vigencia del contrato de Honorarios: ${formatDisplayDate(profileDraft.honorariaStart)} al ${formatDisplayDate(profileDraft.honorariaEnd)}.`
            : requiresRotationFirstTurn(type)
                ? "Selecciona desde que fecha se aplicara la rotativa y desde que punto de la secuencia comenzara."
                : "Selecciona desde que fecha se aplicara la rotativa escogida.";
        const startOptions =
            getRotationStartOptions(type)
                .map(option => `
                    <button class="rotation-start-option ${state.firstTurn === option.value ? "is-selected" : ""}" type="button" data-first-turn="${option.value}">
                        <span>${option.label}</span>
                        <small>${option.detail}</small>
                    </button>
                `)
                .join("");
        const hasReplacementTarget = Boolean(
            state.contractReplaces.trim()
        );
        const leaveOptionsHTML = replacementLeaveOptions.length
            ? replacementLeaveOptions
                .map(option => `
                    <option value="${escapeHTML(option.id)}" ${option.id === state.contractLeaveRef ? "selected" : ""}>
                        ${escapeHTML(option.label)} | ${escapeHTML(formatDisplayDate(option.start))} al ${escapeHTML(formatDisplayDate(option.end))}
                    </option>
                `)
                .join("")
            : `
                <option value="" disabled>
                    ${hasReplacementTarget
                        ? "Sin permisos disponibles en los ultimos 6 meses"
                        : "Selecciona primero a quien reemplaza"}
                </option>
            `;

        if (isReplacement && state.contractLeaveRef && !selectedLeaveOption) {
            state.contractLeaveRef = "";
            state.contractReason = "";
            state.contractStart = "";
            state.contractEnd = "";
        }

        backdrop.innerHTML = `
            <div class="turn-change-dialog rotation-config-dialog" role="dialog" aria-modal="true">
                <strong>${title}</strong>
                <p>${instructions}</p>

                ${requiresRotationFirstTurn(type) ? `
                    <div class="rotation-start-options" aria-label="Turno inicial">
                        ${startOptions}
                    </div>
                ` : ""}

                ${isReplacement ? `
                    <label class="rotation-contract-field">
                        <span>Reemplaza a</span>
                        <select data-contract-replaces>
                            <option value="" ${replacementProfiles.length ? "" : "disabled"}>
                                ${replacementProfiles.length
                                    ? "Seleccionar trabajador"
                                    : "Sin trabajadores compatibles con permisos disponibles"}
                            </option>
                            ${replacementProfiles
                                .map(item => `
                                    <option value="${escapeHTML(item.name)}" ${item.name === state.contractReplaces ? "selected" : ""}>
                                        ${escapeHTML(item.name)}
                                    </option>
                                `)
                                .join("")}
                        </select>
                    </label>

                    <label class="rotation-contract-field">
                        <span>Motivo del Reemplazo</span>
                        <select data-contract-leave-ref ${hasReplacementTarget && replacementLeaveOptions.length ? "" : "disabled"}>
                            <option value="">Seleccionar permiso disponible</option>
                            ${leaveOptionsHTML}
                        </select>
                    </label>

                    <label class="rotation-contract-field">
                        <span>Turnos durante el nuevo contrato</span>
                        <select data-contract-rotation-mode>
                            <option value="${REPLACEMENT_ROTATION_MODE.INHERIT}" ${state.contractRotationMode === REPLACEMENT_ROTATION_MODE.INHERIT ? "selected" : ""}>
                                Heredar turnos del trabajador reemplazado
                            </option>
                            <option value="${REPLACEMENT_ROTATION_MODE.FREE}" ${state.contractRotationMode === REPLACEMENT_ROTATION_MODE.FREE ? "selected" : ""}>
                                Libre, para agregar turnos manualmente
                            </option>
                        </select>
                    </label>
                ` : ""}

                <div class="profile-mini-head rotation-modal-head">
                    <button type="button" data-action="prev" aria-label="Mes anterior">&lt;</button>
                    <button class="profile-mini-month-trigger" type="button" data-action="pick-month" aria-label="Elegir mes y a&#241;o" aria-haspopup="dialog" aria-expanded="false">
                        ${escapeHTML(heading)}
                    </button>
                    <button type="button" data-action="next" aria-label="Mes siguiente">&gt;</button>
                </div>

                <div class="rotation-modal-calendar">
                    ${renderCalendar()}
                </div>

                <div class="profile-mini-help">
                    ${isReplacement
                        ? state.contractStart && state.contractEnd
                            ? `Contrato segun permiso seleccionado: ${formatDisplayDate(state.contractStart)} al ${formatDisplayDate(state.contractEnd)}${state.contractReason ? ` | ${escapeHTML(state.contractReason)}` : ""}. ${escapeHTML(replacementRotationModeLabel(state.contractRotationMode))}.`
                            : hasReplacementTarget
                                ? "Selecciona el permiso/ausencia que origina el reemplazo."
                                : "Selecciona a quien reemplaza para cargar sus permisos disponibles."
                        : state.rotationStart
                            ? `Fecha seleccionada: ${formatDisplayDate(state.rotationStart)}.`
                            : "Selecciona la fecha de inicio de la rotativa."}
                </div>

                <div class="turn-change-dialog__actions">
                    <button class="primary-button" type="button" data-action="save">Guardar</button>
                    <button class="secondary-button" type="button" data-action="cancel">Cancelar</button>
                </div>
            </div>
        `;

        backdrop
            .querySelector("[data-contract-replaces]")
            ?.addEventListener("change", event => {
                state.contractReplaces = event.target.value;
                state.contractLeaveRef = "";
                state.contractReason = "";
                state.contractStart = "";
                state.contractEnd = "";
                render();
            });

        if (isReplacement) {
            const validLeaveOptionIds = new Set(
                replacementLeaveOptions.map(option => option.id)
            );

            backdrop
                .querySelectorAll("[data-contract-leave-ref] option")
                .forEach(option => {
                    if (
                        option.value &&
                        !validLeaveOptionIds.has(option.value)
                    ) {
                        option.remove();
                    }
                });
        }

        backdrop
            .querySelector("[data-contract-rotation-mode]")
            ?.addEventListener("change", event => {
                state.contractRotationMode =
                    normalizeReplacementRotationMode(
                        event.target.value,
                        REPLACEMENT_ROTATION_MODE.INHERIT
                    );
                render();
            });

        backdrop
            .querySelector("[data-contract-leave-ref]")
            ?.addEventListener("change", event => {
                const leaveOption = findReplacementLeaveOption(
                    state.contractReplaces,
                    event.target.value
                );

                if (leaveOption) {
                    applyReplacementLeaveOptionToState(leaveOption);
                    render();
                    return;
                }

                applyReplacementLeaveOptionToState(null);
                render();
            });
    };

    backdrop.addEventListener("click", async event => {
        if (event.target === backdrop) {
            close();
            return;
        }

        const targetElement =
            event.target instanceof Element
                ? event.target
                : event.target.parentElement;
        const dayButton =
            targetElement?.closest(".profile-mini-day");
        if (dayButton?.dataset.key && !dayButton.disabled) {
            if (isReplacement) {
                return;
            }

            pickDate(dayButton.dataset.key);
            return;
        }

        const firstTurnButton =
            targetElement?.closest("[data-first-turn]");
        if (firstTurnButton) {
            state.firstTurn =
                normalizeRotationFirstTurnForType(
                    type,
                    firstTurnButton.dataset.firstTurn
                );
            render();
            return;
        }

        const actionButton =
            targetElement?.closest("[data-action]");
        const action = actionButton?.dataset.action;

        if (action === "prev" || action === "next") {
            state.monthDate = new Date(
                state.monthDate.getFullYear(),
                state.monthDate.getMonth() +
                    (action === "next" ? 1 : -1),
                1
            );
            render();
            return;
        }

        if (action === "pick-month") {
            event.stopPropagation();
            openRotationMonthPicker(actionButton);
            return;
        }

        if (action === "save") {
            save();
            return;
        }

        if (action === "cancel") {
            close();
        }
    });

    render();
}

function openCalendarRotationConfigModal() {
    if (!canModifyCurrentProfile()) return;

    const profile = getPerfilActual();

    if (!profile) {
        alert("Selecciona un trabajador antes de modificar la rotativa.");
        return;
    }

    const options = getCalendarRotationOptions(profile);
    const state = getCalendarRotationDefaultState(profile);
    const backdrop = document.createElement("div");

    backdrop.className = "turn-change-dialog-backdrop";
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    const render = () => {
        const startOptions =
            getRotationStartOptions(state.type)
                .map(option => `
                    <button class="rotation-start-option ${state.firstTurn === option.value ? "is-selected" : ""}" type="button" data-first-turn="${option.value}">
                        <span>${escapeHTML(option.label)}</span>
                        <small>${escapeHTML(option.detail)}</small>
                    </button>
                `)
                .join("");
        const selectedLabel =
            getRotativaLabel(state.type);
        const firstTurnText =
            requiresRotationFirstTurn(state.type)
                ? ` iniciando con ${getRotationFirstTurnLabel(state.firstTurn, state.type)}`
                : "";

        backdrop.innerHTML = `
            <div class="turn-change-dialog rotation-config-dialog calendar-rotation-dialog" role="dialog" aria-modal="true">
                <strong>Modificar rotativa</strong>
                <p>Selecciona la nueva rotativa. Luego elige la fecha de inicio directamente sobre el calendario.</p>

                <label class="rotation-contract-field">
                    <span>Nueva rotativa</span>
                    <select data-calendar-rotation-type>
                        ${options
                            .map(option => `
                                <option value="${option.value}" ${option.value === state.type ? "selected" : ""}>
                                    ${escapeHTML(option.label)}
                                </option>
                            `)
                            .join("")}
                    </select>
                </label>

                ${requiresRotationFirstTurn(state.type) ? `
                    <div class="rotation-start-options" aria-label="Punto de inicio de la rotativa">
                        ${startOptions}
                    </div>
                ` : ""}

                <div class="profile-mini-help">
                    Se aplicara ${escapeHTML(selectedLabel)}${escapeHTML(firstTurnText)} desde la fecha que selecciones.
                </div>

                <div class="turn-change-dialog__actions">
                    <button class="primary-button" type="button" data-action="pick-date">Elegir fecha</button>
                    <button class="secondary-button" type="button" data-action="cancel">Cancelar</button>
                </div>
            </div>
        `;
    };

    backdrop.addEventListener("change", event => {
        const field =
            event.target instanceof Element
                ? event.target.closest("[data-calendar-rotation-type]")
                : null;

        if (!field) return;

        state.type = field.value;
        state.firstTurn =
            requiresRotationFirstTurn(state.type)
                ? normalizeRotationFirstTurnForType(
                    state.type,
                    state.firstTurn
                )
                : "larga";
        render();
    });

    backdrop.addEventListener("click", async event => {
        if (event.target === backdrop) {
            close();
            return;
        }

        const targetElement =
            event.target instanceof Element
                ? event.target
                : event.target.parentElement;
        const firstTurnButton =
            targetElement?.closest("[data-first-turn]");

        if (firstTurnButton) {
            state.firstTurn =
                normalizeRotationFirstTurnForType(
                    state.type,
                    firstTurnButton.dataset.firstTurn
                );
            render();
            return;
        }

        const actionButton =
            targetElement?.closest("[data-action]");
        const action = actionButton?.dataset.action;

        if (action === "cancel") {
            close();
            return;
        }

        if (action === "pick-date") {
            pendingRotationChange = {
                type: state.type,
                firstTurn:
                    requiresRotationFirstTurn(state.type)
                        ? normalizeRotationFirstTurnForType(
                            state.type,
                            state.firstTurn
                        )
                        : "larga"
            };

            close();
            const visibleMonth =
                getRotationSelectionMonth(currentDate);

            await goToCalendarMonth(
                visibleMonth.year,
                visibleMonth.month,
                { deferHeavy: true }
            );
            activarModo(
                "rotation",
                `Modificar rotativa: selecciona en el calendario desde que dia comenzara ${getRotativaLabel(pendingRotationChange.type)}.`
            );
        }
    });

    render();
}

async function applyCalendarRotationChange(fecha) {
    const profile = getPerfilActual();
    const pending = pendingRotationChange;

    if (!profile || !pending) {
        clearSelectionMode(false);
        return;
    }

    const startISO = toInputDate(fecha);
    const type = pending.type;
    const unitEntryDate = isUnitEntryDateEnabled()
        ? normalizeStoredStart(profile.unitEntryDate || "")
        : "";
    const firstTurn =
        requiresRotationFirstTurn(type)
            ? normalizeRotationFirstTurnForType(type, pending.firstTurn)
            : "larga";

    if (
        type === "libre" &&
        !profileSupportsLibreRotation(profile)
    ) {
        alert("La rotativa Libre solo esta disponible para contratos Reemplazo u Honorarios.");
        return;
    }

    if (
        unitEntryDate &&
        startISO &&
        compareISODate(startISO, unitEntryDate) < 0
    ) {
        alert(
            rotationStartBeforeUnitEntryMessage(
                startISO,
                unitEntryDate
            )
        );
        return;
    }

    if (
        isHonorariaContractType(profile.contractType) &&
        (
            !profile.honorariaStart ||
            !profile.honorariaEnd ||
            compareISODate(startISO, profile.honorariaStart) < 0 ||
            compareISODate(startISO, profile.honorariaEnd) > 0
        )
    ) {
        alert("Selecciona una fecha dentro de la vigencia del contrato de Honorarios.");
        return;
    }

    pendingRotationChange = null;
    clearSelectionMode(false);

    await withBusyState(async () => {
        pushHistory();

        // Preserva el horario anterior a la fecha elegida antes de reubicar el
        // inicio de la rotativa (evita que se borren los turnos "hacia atras").
        freezePriorRotationSchedule(startISO);

        if (type === "libre") {
            saveRotativa({
                type,
                start: "",
                firstTurn: "larga"
            }, profile.name);
            await applyDraftRotation(type, startISO, "larga", {
                cleanupStart: startISO
            });
        } else {
            saveRotativa({
                type,
                start: startISO,
                firstTurn
            }, profile.name);
            await applyDraftRotation(type, startISO, firstTurn);
        }

        const rotationDateText =
            type === "libre"
                ? ` desde ${formatDisplayDate(startISO)}`
                : ` desde ${formatDisplayDate(startISO)}`;
        const firstTurnText =
            requiresRotationFirstTurn(type)
                ? ` iniciando con ${getRotationFirstTurnLabel(firstTurn, type)}`
                : "";

        addAuditLog(
            AUDIT_CATEGORY.CALENDAR,
            "Modifico rotativa desde calendario",
            `${profile.name}: ${getRotativaLabel(type)}${rotationDateText}${firstTurnText}.`,
            {
                profile: profile.name,
                date: startISO,
                rotationType: type,
                firstTurn
            }
        );
    }, {
        label: "Aplicando rotativa..."
    });
}

function requestGradeEffectiveDate(previousSnapshot, nextProfile) {
    return new Promise(resolve => {
        const backdrop = document.createElement("div");
        const defaultDate = toInputDate(new Date());
        const previousGrade = previousSnapshot?.grade || "sin grado";
        const nextGrade = nextProfile?.grade || "sin grado";
        const previousRole =
            previousSnapshot?.estamento || "sin estamento";
        const nextRole = nextProfile?.estamento || "sin estamento";

        backdrop.className = "turn-change-dialog-backdrop";
        document.body.appendChild(backdrop);

        const close = value => {
            backdrop.remove();
            resolve(value);
        };

        backdrop.innerHTML = `
            <div class="turn-change-dialog grade-effective-dialog" role="dialog" aria-modal="true">
                <strong>Vigencia del nuevo grado</strong>
                <p>
                    El grado/estamento cambiara de
                    <b>${escapeHTML(previousRole)} grado ${escapeHTML(previousGrade)}</b>
                    a
                    <b>${escapeHTML(nextRole)} grado ${escapeHTML(nextGrade)}</b>.
                    Indica desde que fecha se debe usar el nuevo valor hora para calcular HHEE.
                </p>

                <label class="rotation-contract-field">
                    <span>Fecha de inicio</span>
                    <input data-grade-effective-date type="date" value="${defaultDate}">
                </label>

                <div class="firebase-dialog-note">
                    Las horas extras anteriores a esta fecha mantendran el valor del grado anterior.
                </div>

                <div class="turn-change-dialog__actions">
                    <button class="primary-button" type="button" data-action="save">Guardar vigencia</button>
                    <button class="secondary-button" type="button" data-action="cancel">Cancelar</button>
                </div>
            </div>
        `;

        const dateInput =
            backdrop.querySelector("[data-grade-effective-date]");

        dateInput?.focus();

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) {
                close(null);
                return;
            }

            const action = event.target
                ?.closest?.("[data-action]")
                ?.dataset
                ?.action;

            if (!action) return;

            if (action === "cancel") {
                close(null);
                return;
            }

            const value = dateInput?.value || "";

            if (!value) {
                alert("Debes indicar la fecha de inicio del nuevo grado.");
                dateInput?.focus();
                return;
            }

            close(value);
        });
    });
}

function renderHheeReturnTransferControl(profile, year, month, stats) {
    if (!DOM.hheeReturnTransferToggle) return;

    if (!profile) {
        DOM.hheeReturnTransferToggle.checked = false;
        DOM.hheeReturnTransferToggle.disabled = true;
        if (DOM.hheeReturnTransferInfo) {
            DOM.hheeReturnTransferInfo.textContent =
                "Selecciona un colaborador para configurar el destino de sus HH.EE.";
        }
        return;
    }

    const enabled =
        isHheeReturnTransferEnabled(profile.name, year, month);
    const transferHours =
        calculateHheeReturnTransferHours(
            stats.hheeDiurnas,
            stats.hheeNocturnas
        );

    DOM.hheeReturnTransferToggle.checked = enabled;
    DOM.hheeReturnTransferToggle.disabled = false;

    if (DOM.hheeReturnTransferInfo) {
        const effectiveLabel =
            hheeReturnEffectiveLabel(year, month);

        DOM.hheeReturnTransferInfo.textContent = enabled
            ? `Mes traspasado: ${formatSaldo(transferHours)} hrs. disponibles desde ${effectiveLabel}.`
            : `Al activar: ${formatSaldo(transferHours)} hrs. ir\u00e1n a devoluci\u00f3n desde ${effectiveLabel}.`;
    }
}

async function handleHheeReturnTransferToggle() {
    const profile = getPerfilActual();

    if (!profile) return;

    const year = profileRotationMiniDate.getFullYear();
    const month = profileRotationMiniDate.getMonth();
    const holidays = await fetchHolidays(year);
    const stats = getHheeMonthStats(
        profile.name,
        year,
        month,
        holidays
    );
    const transferHours =
        calculateHheeReturnTransferHours(
            stats.hheeDiurnas,
            stats.hheeNocturnas
        );
    const existing =
        getHheeReturnTransfer(profile.name, year, month);
    const shouldEnable =
        Boolean(DOM.hheeReturnTransferToggle?.checked);
    const effective =
        existing
            ? hheeReturnEffectivePeriod({
                ...existing,
                year,
                month
            })
            : nextMonthPeriod(year, month);

    if (shouldEnable && transferHours <= 0) {
        alert("Este mes no tiene horas extras positivas para traspasar a devoluci\u00f3n.");
        renderProfileHoursSummary(profile);
        return;
    }

    pushHistory();

    if (shouldEnable) {
        const previousTransferred = existing?.enabled
            ? normalizeBalanceValue(existing.transferredHours)
            : 0;
        const manual =
            getManualLeaveBalances(effective.year, profile.name);
        const baseBalance = existing?.enabled
            ? normalizeBalanceValue(existing.baseBalance)
            : normalizeBalanceValue(manual.hoursReturn);

        adjustHoursReturnBalance(
            profile.name,
            effective.year,
            transferHours - previousTransferred
        );
        saveHheeReturnTransfer(
            profile.name,
            year,
            month,
            {
                ...existing,
                ...hheeReturnTransferPayload(stats, transferHours),
                enabled: true,
                baseBalance,
                effectiveYear: effective.year,
                effectiveMonth: effective.month
            }
        );

        addAuditLog(
            AUDIT_CATEGORY.LEAVE_ABSENCE,
            "Traspaso HH.EE a devoluci\u00f3n",
            `${profile.name}: ${formatSaldo(stats.hheeDiurnas)}h diurnas y ${formatSaldo(stats.hheeNocturnas)}h nocturnas generan ${formatSaldo(transferHours)} hrs. de devoluci\u00f3n desde ${hheeReturnEffectiveLabel(year, month)}.`,
            {
                profile: profile.name,
                year,
                month,
                transferHours,
                effectiveYear: effective.year,
                effectiveMonth: effective.month
            }
        );
    } else {
        const currentBalance = normalizeBalanceValue(
            getManualLeaveBalances(
                effective.year,
                profile.name
            ).hoursReturn
        );
        const baseBalance = Number.isFinite(
            Number(existing?.baseBalance)
        )
            ? normalizeBalanceValue(existing.baseBalance)
            : Math.max(
                0,
                currentBalance -
                    normalizeBalanceValue(existing?.transferredHours)
            );
        const nextBalance = Math.min(
            currentBalance,
            baseBalance
        );

        setHoursReturnBalance(
            profile.name,
            effective.year,
            nextBalance
        );
        saveHheeReturnTransfer(
            profile.name,
            year,
            month,
            {
                ...existing,
                ...hheeReturnTransferPayload(stats, 0),
                enabled: false,
                transferredHours: 0,
                baseBalance: nextBalance,
                effectiveYear: effective.year,
                effectiveMonth: effective.month
            }
        );

        addAuditLog(
            AUDIT_CATEGORY.LEAVE_ABSENCE,
            "Envio HH.EE a pago",
            `${profile.name}: las HH.EE de ${formatMonthHeading(profileRotationMiniDate)} vuelven a pago.`,
            {
                profile: profile.name,
                year,
                month
            }
        );
    }

    void renderProfileHoursSummary(profile);
    renderDisponibilidadVacaciones();
}

// Activa el traspaso de las HH.EE de un mes a devolucion para un colaborador.
// Es la misma logica del switch "Enviar HH.EE a devolucion" (rama enable de
// handleHheeReturnTransferToggle), reutilizada al aceptar una solicitud
// "hhee_return" enviada desde la app del trabajador. Es idempotente: si el mes
// ya estaba traspasado no vuelve a sumar el saldo.
async function enableHheeReturnTransferForMonth(profileName, year, month) {
    const name = String(profileName || "").trim();

    if (
        !name ||
        !Number.isFinite(Number(year)) ||
        !Number.isFinite(Number(month))
    ) {
        return {
            ok: false,
            message: "La solicitud de devolución no trae el mes o el colaborador."
        };
    }

    const holidays = await fetchHolidays(year);
    const stats = getHheeMonthStats(name, year, month, holidays);
    const transferHours = calculateHheeReturnTransferHours(
        stats.hheeDiurnas,
        stats.hheeNocturnas
    );

    if (transferHours <= 0) {
        return {
            ok: false,
            message: "Ese mes no tiene horas extras positivas para traspasar a devolución."
        };
    }

    const existing = getHheeReturnTransfer(name, year, month);

    if (existing?.enabled) {
        return {
            ok: true,
            alreadyEnabled: true,
            transferHours: normalizeBalanceValue(existing.transferredHours),
            effective: hheeReturnEffectivePeriod({ ...existing, year, month })
        };
    }

    const effective = existing
        ? hheeReturnEffectivePeriod({ ...existing, year, month })
        : nextMonthPeriod(year, month);
    const manual = getManualLeaveBalances(effective.year, name);
    const baseBalance = normalizeBalanceValue(manual.hoursReturn);

    pushHistory();

    adjustHoursReturnBalance(name, effective.year, transferHours);
    saveHheeReturnTransfer(
        name,
        year,
        month,
        {
            ...existing,
            ...hheeReturnTransferPayload(stats, transferHours),
            enabled: true,
            baseBalance,
            effectiveYear: effective.year,
            effectiveMonth: effective.month
        }
    );

    addAuditLog(
        AUDIT_CATEGORY.LEAVE_ABSENCE,
        "Traspaso HH.EE a devolución",
        `${name}: ${formatSaldo(stats.hheeDiurnas)}h diurnas y ${formatSaldo(stats.hheeNocturnas)}h nocturnas generan ${formatSaldo(transferHours)} hrs. de devolución desde ${hheeReturnEffectiveLabel(year, month)} (solicitud del trabajador).`,
        {
            profile: name,
            year,
            month,
            transferHours,
            effectiveYear: effective.year,
            effectiveMonth: effective.month,
            source: "worker_request"
        }
    );

    return { ok: true, transferHours, effective };
}

// Conecta la aceptacion de solicitudes "hhee_return" (app del trabajador) con la
// activacion del traspaso de HH.EE a devolucion, notificando luego al trabajador
// y re-publicando sus datos para que vea el cambio en su app.
setHheeReturnRequestHandler(async request => {
    const profileName = String(request?.profile || "").trim();
    const year = Number(request?.returnYear);
    const month = Number(request?.returnMonth);

    const result = await enableHheeReturnTransferForMonth(
        profileName,
        year,
        month
    );

    if (!result.ok) return result;

    const sourceLabel = formatMonthHeading(new Date(year, month, 1));
    const effectiveLabel = hheeReturnEffectiveLabel(year, month);

    void notifyWorkerApp(
        profileName,
        `Tu supervisor aceptó enviar tus HH.EE de ${sourceLabel} a devolución de horas. ` +
        `Dispones de ${formatSaldo(result.transferHours)} hrs. desde ${effectiveLabel}.`
    );

    scheduleWorkerAppDataPublish(300, profileName);
    if (profileName === getCurrentProfile()) {
        void renderProfileHoursSummary(getPerfilActual());
        renderDisponibilidadVacaciones();
    }

    return { ok: true };
});

async function renderProfileHoursSummary(profile = getPerfilActual()) {
    const summary = document.getElementById("summary");
    const records = DOM.hheeMonthlyRecords;

    if (!summary) return;

    if (!profile) {
        profileHoursSummaryRequest++;
        renderHheeReturnTransferControl(null);
        summary.innerHTML = `
            <div class="empty-state empty-state--compact">
                Selecciona un colaborador para ver sus horas extras.
            </div>
        `;
        if (records) {
            records.innerHTML = `
                <div class="empty-state empty-state--compact">
                    Selecciona un colaborador para ver los registros del mes.
                </div>
            `;
        }
        return;
    }

    const requestId = ++profileHoursSummaryRequest;
    const y = profileRotationMiniDate.getFullYear();
    const m = profileRotationMiniDate.getMonth();
    const monthLabel = profileRotationMiniDate.toLocaleString(
        "es-CL",
        {
            month: "long",
            year: "numeric"
        }
    );
    const holidays = await fetchHolidays(y);

    if (requestId !== profileHoursSummaryRequest) return;

    const stats = getHheeMonthStats(
        profile.name,
        y,
        m,
        holidays
    );

    syncHheeReturnTransferBalance(
        profile.name,
        y,
        m,
        stats
    );
    renderHheeReturnTransferControl(profile, y, m, stats);

    summary.innerHTML = renderSummaryHTML(stats);

    if (records) {
        records.innerHTML =
            renderReplacementLogHTML(profile.name, y, m, holidays);
    }
}

function renderProfileDocs(data, editing) {
    if (!DOM.profileDocsList) return;

    const docs = Array.isArray(data.docs) ? data.docs : [];

    if (!docs.length) {
        DOM.profileDocsList.innerHTML = `
            <div class="attachment-empty">
                Sin documentos adjuntos.
            </div>
        `;
        return;
    }

    DOM.profileDocsList.innerHTML = docs
        .map((doc, index) => `
            <div class="attachment-item">
                <span>
                    <strong>${escapeHTML(doc.name)}</strong>
                    <small>
                        ${doc.type ? escapeHTML(doc.type) : "Archivo"}
                        ${hasAttachmentContent(doc) ? "" : " | volver a adjuntar para visualizar"}
                    </small>
                </span>
                <span class="attachment-actions">
                    <button class="secondary-button attachment-view" type="button" data-doc-view="${index}" ${hasAttachmentContent(doc) ? "" : "disabled"}>
                        Ver
                    </button>
                ${editing ? `
                    <button class="ghost-button attachment-remove" type="button" data-doc-index="${index}">
                        Quitar
                    </button>
                ` : ""}
                </span>
            </div>
        `)
        .join("");

    DOM.profileDocsList
        .querySelectorAll("[data-doc-view]")
        .forEach(button => {
            button.onclick = async () => {
                const doc = docs[Number(button.dataset.docView)];
                await openAttachment(doc);
            };
        });

    DOM.profileDocsList
        .querySelectorAll("[data-doc-index]")
        .forEach(button => {
            button.onclick = () => {
                profileDraft.docs = profileDraft.docs.filter(
                    (_doc, index) =>
                        index !== Number(button.dataset.docIndex)
                );
                renderDashboardState();
            };
        });
}

function renderRecordCard(config, logs, editing) {
    const entries = logs[config.key] || [];
    const years = Array.from(
        new Set(entries.map(getRecordYear).filter(Boolean))
    ).sort((a, b) => b.localeCompare(a));
    const selectedYear = recordYearFilters[config.key] || "all";
    const filteredEntries =
        config.filterYear && selectedYear !== "all"
            ? entries.filter(entry =>
                getRecordYear(entry) === selectedYear
            )
            : entries;

    const filterHTML = config.filterYear
        ? `
            <label class="record-year-filter">
                <span>A&ntilde;o</span>
                <select data-record-filter="${config.key}">
                    <option value="all">Todos</option>
                    ${years.map(year => `
                        <option value="${year}" ${year === selectedYear ? "selected" : ""}>
                            ${year}
                        </option>
                    `).join("")}
                </select>
            </label>
        `
        : "";
    const fileHTML = config.fileLabel
        ? `
            <label class="record-field">
                <span>${config.fileLabel}</span>
                <input data-record-file type="file" accept="${ATTACHMENT_ACCEPT}">
            </label>
        `
        : "";

    return `
        <section class="record-card" data-record="${config.key}">
            <div class="record-card__head">
                <h4>${config.title}</h4>
                ${filterHTML}
            </div>

            ${editing ? `
                <div class="record-form">
                    ${config.fields.map(field =>
                        renderRecordField(field, config.key)
                    ).join("")}
                    ${fileHTML}
                    <button class="secondary-button record-add" type="button" data-record-add="${config.key}">
                        Agregar registro
                    </button>
                </div>
            ` : ""}

            <div class="record-list">
                ${filteredEntries.length
                    ? filteredEntries
                        .slice()
                        .reverse()
                        .map(entry => renderRecordEntry(config, entry))
                        .join("")
                    : `
                        <div class="empty-state empty-state--compact">
                            Sin registros.
                        </div>
                    `}
            </div>
        </section>
    `;
}

function addProfileRecord(profileName, config) {
    const card =
        DOM.profileRecordsPanel?.querySelector(
            `[data-record="${config.key}"]`
        );

    if (!card) return;

    const entry = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        createdAt: new Date().toISOString()
    };

    config.fields.forEach(field => {
        entry[field.name] =
            card.querySelector(`[data-field="${field.name}"]`)
                ?.value
                .trim() || "";
    });

    const file = card.querySelector("[data-record-file]")?.files?.[0];

    if (file) {
        try {
            entry.file = normalizeAttachmentFiles([file])[0];
        } catch (error) {
            alert(error?.planBlocked
                ? error.message
                : "No se pudo adjuntar el documento.");
            return;
        }
    }

    const hasData =
        config.fields.some(field => entry[field.name]) ||
        Boolean(entry.file);

    if (!hasData) {
        alert("Completa al menos un dato antes de agregar el registro.");
        return;
    }

    const logs = getProfileLogs(profileName);

    logs[config.key].push(entry);
    saveProfileLogs(profileName, logs);

    addAuditLog(
        AUDIT_CATEGORY.COLLABORATOR_UPDATED,
        "Agrego registro RRHH",
        `${profileName}: ${config.title}.`,
        {
            profile: profileName,
            recordType: config.key
        }
    );

    renderProfileRecords(getPerfilActual(), true);
}

function renderProfileRecords(profile, editing) {
    if (!DOM.profileRecordsPanel) return;

    if (!profile || profileDraft.mode === PROFILE_MODE.CREATE) {
        DOM.profileRecordsPanel.innerHTML = `
            <div class="empty-state empty-state--compact">
                Guarda el perfil para comenzar a registrar antecedentes RRHH.
            </div>
        `;
        return;
    }

    const logs = getProfileLogs(profile.name);

    DOM.profileRecordsPanel.innerHTML = HR_LOG_CONFIG
        .map(config => renderRecordCard(config, logs, editing))
        .join("");

    DOM.profileRecordsPanel
        .querySelectorAll("[data-record-filter]")
        .forEach(select => {
            select.onchange = () => {
                recordYearFilters[select.dataset.recordFilter] =
                    select.value;
                renderProfileRecords(profile, editing);
            };
        });

    DOM.profileRecordsPanel
        .querySelectorAll("[data-record-add]")
        .forEach(button => {
            button.onclick = () => {
                const config = HR_LOG_CONFIG.find(item =>
                    item.key === button.dataset.recordAdd
                );

                if (config) {
                    addProfileRecord(profile.name, config);
                }
            };
        });
}

function formatAvailabilityHistoryDate(key) {
    const [year, month, day] = String(key || "")
        .split("-")
        .map(Number);

    if (!year || !Number.isFinite(month) || !day) return "";

    return [
        String(day).padStart(2, "0"),
        String(month + 1).padStart(2, "0"),
        year
    ].join("-");
}

function availabilityHistoryHTML(profileName) {
    const currentYear = new Date().getFullYear();

    if (availabilityHistoryProfile !== profileName) {
        availabilityHistoryProfile = profileName;
        availabilityHistoryYear = currentYear;
    }

    const years = getProfileLeaveHistoryYears(
        profileName,
        currentYear
    );

    if (!years.includes(availabilityHistoryYear)) {
        availabilityHistoryYear = currentYear;
    }

    const records = getProfileLeaveHistory(
        profileName,
        availabilityHistoryYear
    );
    const yearOptions = years.map(year => `
        <option value="${year}" ${year === availabilityHistoryYear ? "selected" : ""}>
            ${year}
        </option>
    `).join("");
    const recordsHTML = records.length
        ? records.map(record => {
            const start = formatAvailabilityHistoryDate(record.startKey);
            const end = formatAvailabilityHistoryDate(record.endKey);
            const period = start === end
                ? start
                : `${start} al ${end}`;
            const amount = record.amount === null
                ? ""
                : `
                    <span class="availability-history__amount">
                        ${formatSaldo(record.amount)} ${record.amount === 1 ? "d\u00eda" : "d\u00edas"}
                    </span>
                `;

            return `
                <article class="availability-history__item">
                    <div>
                        <strong>${escapeHTML(record.label)}</strong>
                        <span>${escapeHTML(period)}</span>
                    </div>
                    ${amount}
                </article>
            `;
        }).join("")
        : `
            <div class="availability-history__empty">
                Sin vacaciones o ausencias registradas en ${availabilityHistoryYear}.
            </div>
        `;

    return `
        <section class="availability-history" aria-label="Registro de vacaciones y ausencias">
            <div class="availability-history__head">
                <strong>Registro de vacaciones / ausencias</strong>
                <label>
                    <span>A&ntilde;o</span>
                    <select id="availabilityHistoryYear" aria-label="A&ntilde;o del registro">
                        ${yearOptions}
                    </select>
                </label>
            </div>
            <div class="availability-history__list">
                ${recordsHTML}
            </div>
        </section>
    `;
}

function bindAvailabilityHistoryYear() {
    const input = document.getElementById("availabilityHistoryYear");

    if (!input) return;

    input.onchange = () => {
        const year = Number(input.value);

        if (!Number.isInteger(year)) return;

        availabilityHistoryYear = year;
        renderDisponibilidadVacaciones();
    };
}

function renderDisponibilidadVacaciones() {
    if (!DOM.availabilitySummary) return;

    const profile = getPerfilActual();
    const creating =
        profileDraft.mode === PROFILE_MODE.CREATE;

    if (!profile && !creating) {
        availabilityEditMode = false;
        availabilityHistoryProfile = "";

        DOM.availabilitySummary.innerHTML = `
            <div class="availability-empty">
                Selecciona un colaborador para ver sus saldos.
            </div>
        `;

        return;
    }

    const year = currentDate.getFullYear();
    const saldos = creating
        ? (
            createAvailabilityBalances ||
            defaultCreateAvailabilityBalances()
        )
        : getLeaveBalances(
            year,
            getCachedHolidays(year),
            {
                month: currentDate.getMonth(),
                profileName: profile.name
            }
        );
    const holidays = getCachedHolidays(year);
    const compUsed = creating
        ? 0
        : compDaysUsedForYear(year, holidays);
    const compEntitlement = compEntitlementFromBalance(
        saldos.comp,
        year,
        holidays
    );
    const showCompBalance = isProfileEditing()
        ? Boolean(profileDraft.shiftAssigned)
        : getShiftAssigned(profile.name, currentDate);
    const historyHTML = creating
        ? ""
        : availabilityHistoryHTML(profile.name);

    if (availabilityEditMode || creating) {
        DOM.availabilitySummary.innerHTML = `
            <div class="availability-list" style="--availability-columns: ${showCompBalance ? 4 : 3};">
                <label class="availability-item">
                    <span>FL</span>
                    <input id="availabilityLegalInput" type="number" min="0" step="1" value="${normalizeLegalBalanceValue(saldos.legal)}">
                </label>

                ${showCompBalance ? `
                    <label class="availability-item">
                        <span>FC anual</span>
                        <select id="availabilityCompInput">
                            ${compEntitlementOptionsHTML(compEntitlement, compUsed)}
                        </select>
                    </label>
                ` : ""}

                <label class="availability-item">
                    <span>ADM</span>
                    <input id="availabilityAdminInput" type="number" min="0" step="0.5" value="${saldos.admin}">
                </label>

                <label class="availability-item availability-item--wide">
                    <span>Horas para devoluci\u00f3n</span>
                    <input id="availabilityHoursReturnInput" type="number" min="0" step="0.5" value="${saldos.hoursReturn}">
                </label>
            </div>

            <div class="availability-note">
                ${creating
                    ? `Saldos iniciales del a\u00f1o ${year}. Puedes modificarlos antes de guardar.`
                    : `Editando saldos vigentes del a\u00f1o ${year}.`}
                FL solo admite d&iacute;as completos. FC anual solo puede ser 10 o 20 d&iacute;as.
            </div>

            ${historyHTML}
        `;

        if (creating) {
            createAvailabilityBalances = {
                ...defaultCreateAvailabilityBalances(),
                ...saldos
            };

            [
                ["availabilityLegalInput", "legal"],
                ["availabilityCompInput", "comp"],
                ["availabilityAdminInput", "admin"],
                ["availabilityHoursReturnInput", "hoursReturn"]
            ].forEach(([id, field]) => {
                const input = document.getElementById(id);

                if (!input) return;

                input.oninput = () => {
                    createAvailabilityBalances[field] =
                        input.value;
                };
                input.onchange = input.oninput;
            });
        }

        bindAvailabilityHistoryYear();

        return;
    }

    DOM.availabilitySummary.innerHTML = `
        <div class="availability-list" style="--availability-columns: ${showCompBalance ? 4 : 3};">
            <div class="availability-item">
                <span>FL</span>
                <strong>${formatSaldo(saldos.legal)} d&iacute;as</strong>
            </div>

            ${showCompBalance ? `
                <div class="availability-item">
                    <span>FC</span>
                    <strong>${formatSaldo(saldos.comp)} d&iacute;as</strong>
                </div>
            ` : ""}

            <div class="availability-item">
                <span>ADM</span>
                <strong>${formatSaldo(saldos.admin)} d&iacute;as</strong>
            </div>

            <div class="availability-item availability-item--wide">
                <span>Horas para devoluci\u00f3n</span>
                <strong>${formatSaldo(saldos.hoursReturn)} hrs.</strong>
            </div>
        </div>

        <div class="availability-note">
            Saldos vigentes del a\u00f1o ${year}.
        </div>

        ${historyHTML}
    `;

    bindAvailabilityHistoryYear();
}

function renderLeaveActionLabels() {
    const profile = getPerfilActual();
    const adminBase = "P. ADMINISTRATIVO";
    const compBase = "F. COMPENSATORIO";
    const legalBase = "F. LEGAL";
    const hoursReturnBase = "DEVOLUCI\u00d3N DE HORAS";

    if (!profile || !isProfileActive(profile)) {
        DOM.adminBtnLabel.textContent = adminBase;
        DOM.compBtnLabel.textContent = compBase;
        DOM.legalBtnLabel.textContent = legalBase;
        DOM.hoursReturnBtnLabel.textContent =
            `${hoursReturnBase} (0)`;
        DOM.adminBtn.disabled = true;
        DOM.halfAdminMorningBtn.disabled = true;
        DOM.halfAdminAfternoonBtn.disabled = true;
        DOM.compBtn.disabled = true;
        DOM.legalBtn.disabled = true;
        DOM.licenseBtn.disabled = true;
        DOM.professionalLicenseBtn.disabled = true;
        if (DOM.unionLeaveBtn) {
            DOM.unionLeaveBtn.disabled = true;
            DOM.unionLeaveBtn.classList.add("hidden");
        }
        DOM.unpaidLeaveBtn.disabled = true;
        DOM.hoursReturnBtn.disabled = true;
        DOM.unjustifiedAbsenceBtn.disabled = true;
        DOM.clockMarkBtn.disabled = true;
        DOM.moveShiftBtn.disabled = true;
        if (profile && !isProfileActive(profile)) {
            DOM.adminBtnLabel.textContent = `${adminBase} (inactivo)`;
            DOM.compBtnLabel.textContent = `${compBase} (inactivo)`;
            DOM.legalBtnLabel.textContent = `${legalBase} (inactivo)`;
            DOM.hoursReturnBtnLabel.textContent =
                `${hoursReturnBase} (inactivo)`;
        }

        return;
    }

    const balanceYear = currentDate.getFullYear();
    const saldos = getLeaveBalances(
        balanceYear,
        getCachedHolidays(balanceYear),
        {
            month: currentDate.getMonth(),
            profileName: profile.name
        }
    );
    const canUseUnionLeave =
        Boolean(profile.unionLeaveEnabled);

    DOM.adminBtnLabel.textContent =
        `${adminBase} (${formatSaldo(saldos.admin)})`;
    DOM.compBtnLabel.textContent =
        `${compBase} (${formatSaldo(saldos.comp)})`;
    DOM.legalBtnLabel.textContent =
        `${legalBase} (${formatSaldo(saldos.legal)})`;
    DOM.hoursReturnBtnLabel.textContent =
        `${hoursReturnBase} (${formatSaldo(saldos.hoursReturn)})`;

    DOM.adminBtn.disabled = saldos.admin <= 0;
    DOM.halfAdminMorningBtn.disabled = saldos.admin <= 0;
    DOM.halfAdminAfternoonBtn.disabled = saldos.admin <= 0;
    DOM.compBtn.disabled = saldos.comp <= 0;
    DOM.legalBtn.disabled = saldos.legal <= 0;
    DOM.licenseBtn.disabled = false;
    DOM.professionalLicenseBtn.disabled = false;
    if (DOM.unionLeaveBtn) {
        DOM.unionLeaveBtn.classList.toggle(
            "hidden",
            !canUseUnionLeave
        );
        DOM.unionLeaveBtn.disabled = !canUseUnionLeave;
    }
    DOM.unpaidLeaveBtn.disabled = false;
    DOM.hoursReturnBtn.disabled = saldos.hoursReturn <= 0;
    DOM.unjustifiedAbsenceBtn.disabled = false;
    DOM.clockMarkBtn.disabled = false;
    DOM.moveShiftBtn.disabled = false;
}

function syncEditRestrictedControls() {
    const calendarCanEdit = canEditTarget("calendarPanel");

    [
        DOM.adminBtn,
        DOM.halfAdminMorningBtn,
        DOM.halfAdminAfternoonBtn,
        DOM.legalBtn,
        DOM.compBtn,
        DOM.licenseBtn,
        DOM.professionalLicenseBtn,
        DOM.unionLeaveBtn,
        DOM.unpaidLeaveBtn,
        DOM.hoursReturnBtn,
        DOM.unjustifiedAbsenceBtn,
        DOM.clockMarkBtn,
        DOM.moveShiftBtn
    ].forEach(button => {
        if (!button) return;

        button.classList.toggle(
            "is-disabled",
            !calendarCanEdit
        );

        if (!calendarCanEdit) {
            button.disabled = true;
            button.title =
                "Tu usuario tiene permiso solo de lectura en Turnos.";
        } else {
            button.title = "";
        }
    });
}

function scheduleProfileSecondarySections(profile, data, editing) {
    cancelProfileSecondaryRender?.();

    const requestId = ++profileSecondaryRenderRequest;
    const expectedProfile = profile?.name || "";
    const expectedMode = profileDraft.mode;
    const dataSnapshot = { ...data };
    const containers = [
        DOM.profileContractHistory,
        DOM.profileRecordsPanel,
        DOM.availabilitySummary
    ].filter(Boolean);

    containers.forEach(container => {
        container.setAttribute("aria-busy", "true");
    });

    cancelProfileSecondaryRender = scheduleIdleTask(() => {
        cancelProfileSecondaryRender = null;

        if (
            requestId !== profileSecondaryRenderRequest ||
            document.body.dataset.activeView !== "profile" ||
            (getCurrentProfile() || "") !== expectedProfile ||
            profileDraft.mode !== expectedMode
        ) {
            return;
        }

        renderProfileRotationStatus(
            dataSnapshot,
            editing,
            openRotationConfigModal
        );
        renderContractHistory(profile);
        renderProfileRecords(profile, editing);
        renderDisponibilidadVacaciones();

        containers.forEach(container => {
            container.removeAttribute("aria-busy");
        });
    }, { timeout: 500 });
}

function renderDashboardState() {
    const profile = getPerfilActual();
    const data = getDisplayedProfileData();
    const profileCanEdit = canEditTarget("profileSection");
    const editing = isProfileEditing() && profileCanEdit;
    const activeView =
        document.body.dataset.activeView || "turnos";

    if (activeView !== "profile") {
        cancelProfileSecondaryRender?.();
        cancelProfileSecondaryRender = null;
        profileSecondaryRenderRequest++;
    }

    syncTopProfileSearch();

    if (activeView !== "profile") {
        if (activeView === "hours") {
            renderProfileHoursSummary(profile);
            renderHheeProfiles();
            syncHoursMonthControls(true);
            renderHoursCharts(profile);

            if (DOM.printHoursReportBtn) {
                DOM.printHoursReportBtn.disabled =
                    !profile ||
                    profileDraft.mode === PROFILE_MODE.CREATE;
            }
        }

        renderLeaveActionLabels();
        syncEditRestrictedControls();
        syncTurnosSidePanelHeight();
        updateHistoryNavState();
        updateTurnChangesNavState();
        syncWorkspacePermissionUI({ switchIfNeeded: false });
        return;
    }

    DOM.profileNameInput.value = data.name || "";
    DOM.profileEmailInput.value = data.email || "";
    syncEmailValidity(false);
    hideProfileEmailHint();
    DOM.profileRutInput.value = data.rut || "";
    syncRutValidity(false);
    DOM.profilePhoneInput.value = data.phone || "";
    delete DOM.profileBirthDateInput.dataset.birthDatePickerDefault;
    DOM.profileBirthDateInput.value = data.birthDate || "";
    const unitEntryDateEnabled = isUnitEntryDateEnabled();

    if (DOM.profileUnitEntryDateRow) {
        DOM.profileUnitEntryDateRow.hidden = !unitEntryDateEnabled;
        DOM.profileUnitEntryDateRow.classList.toggle(
            "hidden",
            !unitEntryDateEnabled
        );
    }

    DOM.profileUnitEntryDateInput.value =
        unitEntryDateEnabled ? data.unitEntryDate || "" : "";
    DOM.profileContractTypeSelect.value = data.contractType || "";
    DOM.profileRoleSelect.value = data.estamento || "";
    syncProfileProfessionField(data, editing);
    DOM.profileGradeSelect.value = data.grade || "";
    const isReplacementContract =
        isReplacementDraft(data);
    syncProfileRotationOptions(data);
    DOM.profileRotationSelect.value = data.rotationType || "";
    if (DOM.profileUnionLeaveInput) {
        DOM.profileUnionLeaveInput.checked =
            !isReplacementContract &&
            Boolean(data.unionLeaveEnabled);
    }
    DOM.checkbox.checked = Boolean(data.shiftAssigned);
    DOM.profileActiveToggle.checked = data.active !== false;

    DOM.profileNameInput.disabled = !editing;
    DOM.profileEmailInput.disabled = !editing;
    DOM.profileRutInput.disabled = !editing;
    DOM.profilePhoneInput.disabled = !editing;
    DOM.profileBirthDateInput.disabled = !editing;
    DOM.profileDocsInput.disabled = !editing;
    DOM.profileUnitEntryDateInput.disabled =
        !editing || !unitEntryDateEnabled;
    DOM.profileContractTypeSelect.disabled = !editing;
    DOM.profileRoleSelect.disabled = !editing;
    DOM.profileGradeSelect.disabled = !editing;
    DOM.profileRotationSelect.disabled = !editing;
    if (DOM.profileUnionLeaveInput) {
        DOM.profileUnionLeaveInput.disabled = !editing;
    }
    DOM.checkbox.disabled = !editing;
    DOM.profileActiveToggle.disabled = !editing;

    if (DOM.profileRotationRow) {
        DOM.profileRotationRow.classList.toggle(
            "hidden",
            isReplacementContract
        );
    }

    if (DOM.profileUnionLeaveRow) {
        DOM.profileUnionLeaveRow.classList.toggle(
            "hidden",
            isReplacementContract
        );
    }

    if (isReplacementContract && editing) {
        profileDraft.unionLeaveEnabled = false;
    }

    const canUseShiftAssignment =
        data.rotationType === "3turno" ||
        data.rotationType === "4turno";

    if (DOM.shiftAssignedRow) {
        DOM.shiftAssignedRow.classList.toggle(
            "hidden",
            !canUseShiftAssignment
        );
    }

    if (!canUseShiftAssignment) {
        DOM.checkbox.checked = false;
        if (editing) {
            profileDraft.shiftAssigned = false;
        }
    }

    const isHonorariaContract =
        isHonorariaDraft(data);

    if (DOM.replacementContractEditor) {
        DOM.replacementContractEditor.classList.toggle(
            "hidden",
            !isReplacementContract
        );
    }

    if (DOM.replacementTargetInput) {
        const targetOptions =
            document.getElementById("replacementTargetOptions");

        if (targetOptions) {
            targetOptions.innerHTML = getProfiles()
                .filter(item => item.name !== data.name)
                .map(item =>
                    `<option value="${escapeHTML(item.name)}"></option>`
                )
                .join("");
        }

        DOM.replacementTargetInput.value =
            data.contractReplaces || "";
        DOM.replacementTargetInput.disabled =
            true;
    }

    if (DOM.replacementReasonSelect) {
        DOM.replacementReasonSelect.innerHTML = `
            <option value="">Definir desde Nuevo Contrato</option>
            ${data.contractReason ? `
                <option value="${escapeHTML(data.contractReason)}">
                    ${escapeHTML(data.contractReason)}
                </option>
            ` : ""}
        `;
        DOM.replacementReasonSelect.value =
            data.contractReason || "";
        DOM.replacementReasonSelect.disabled =
            true;
    }

    if (DOM.replacementContractStatus) {
        if (!isReplacementContract) {
            DOM.replacementContractStatus.textContent = "";
        } else if (editing) {
            DOM.replacementContractStatus.textContent =
                data.contractStart && data.contractEnd
                    ? `Contrato seleccionado: ${formatDisplayDate(data.contractStart)} al ${formatDisplayDate(data.contractEnd)}${data.contractReason ? ` | Motivo: ${data.contractReason}` : ""}.`
                    : data.contractStart
                        ? `Inicio seleccionado: ${formatDisplayDate(data.contractStart)}. Falta marcar termino.`
                        : "Presione el botón para ingresar un nuevo contrato de reemplazo.";
        } else {
            const contracts = profile
                ? getContractsForProfile(profile.name)
                : [];

            DOM.replacementContractStatus.innerHTML = contracts.length
                ? contracts
                    .map(contract =>
                        `${escapeHTML(formatContractDate(contract.start))} - ${escapeHTML(formatContractDate(contract.end))}${contract.reason ? ` | ${escapeHTML(contract.reason)}` : ""} | ${escapeHTML(contract.replaces)} | ${escapeHTML(replacementRotationModeLabel(contract.rotationMode))}`
                    )
                    .join("<br>")
                : "Sin contratos registrados.";
        }
    }

    if (DOM.honorariaContractEditor) {
        DOM.honorariaContractEditor.classList.toggle(
            "hidden",
            !isHonorariaContract
        );
    }

    if (DOM.honorariaStartInput) {
        DOM.honorariaStartInput.value =
            data.honorariaStart || "";
        DOM.honorariaStartInput.disabled =
            !editing || !isHonorariaContract;
    }

    if (DOM.honorariaEndInput) {
        DOM.honorariaEndInput.value =
            data.honorariaEnd || "";
        DOM.honorariaEndInput.disabled =
            !editing || !isHonorariaContract;
    }

    if (DOM.honorariaHourlyRateInput) {
        DOM.honorariaHourlyRateInput.value =
            data.honorariaHourlyRate || "";
        DOM.honorariaHourlyRateInput.disabled =
            !editing || !isHonorariaContract;
    }

    if (DOM.honorariaMaxMonthlyHoursInput) {
        DOM.honorariaMaxMonthlyHoursInput.value =
            data.honorariaMaxMonthlyHours || "";
        DOM.honorariaMaxMonthlyHoursInput.disabled =
            !editing || !isHonorariaContract;
    }

    if (DOM.honorariaContractStatus) {
        DOM.honorariaContractStatus.textContent =
            isHonorariaContract
                ? data.honorariaStart && data.honorariaEnd
                    ? `La rotativa se mostrara solamente entre ${formatDisplayDate(data.honorariaStart)} y ${formatDisplayDate(data.honorariaEnd)}.`
                    : "Completa la vigencia para limitar la aplicacion de la rotativa."
                : "";
    }

    if (activeView === "profile") {
        renderProfileDocs(data, editing);
        scheduleProfileSecondarySections(profile, data, editing);
    }

    if (activeView === "hours") {
        renderProfileHoursSummary(profile);
        renderHheeProfiles();
    }

    if (DOM.profileEditorHint) {
        DOM.profileEditorHint.textContent =
            buildEditorHint(profile);
    }

    DOM.openCreateProfileBtn.textContent =
        profileDraft.mode === PROFILE_MODE.CREATE
            ? "GUARDAR"
            : "CREAR NUEVO";

    DOM.openEditProfileBtn.textContent =
        profileDraft.mode === PROFILE_MODE.EDIT
            ? "GUARDAR"
            : "EDITAR";

    DOM.openCreateProfileBtn.disabled =
        !profileCanEdit ||
        profileDraft.mode === PROFILE_MODE.EDIT;

    DOM.openEditProfileBtn.disabled =
        !profileCanEdit ||
        profileDraft.mode === PROFILE_MODE.CREATE ||
        (!profile && profileDraft.mode !== PROFILE_MODE.EDIT);

    if (DOM.workerAppInviteBtn) {
        const canInviteWorker =
            profileCanEdit &&
            Boolean(profile) &&
            profileDraft.mode === PROFILE_MODE.VIEW;
        const isWorkerLinked =
            Boolean(profile) && Boolean(getWorkerAppLinkForProfile(profile));

        DOM.workerAppInviteBtn.disabled = !canInviteWorker;
        DOM.workerAppInviteBtn.textContent = isWorkerLinked
            ? "ENLAZADO"
            : "ENLACE APP";
        DOM.workerAppInviteBtn.classList.toggle("is-linked", isWorkerLinked);
        DOM.workerAppInviteBtn.title = isWorkerLinked
            ? "El trabajador ya enlazo su app TurnoPlus. Puedes reenviar el enlace."
            : canInviteWorker
                ? "Enviar enlace para la app del trabajador"
                : "Selecciona un trabajador guardado para enviar el enlace";
    }

    syncHoursMonthControls(
        activeView === "hours"
    );

    if (DOM.printHoursReportBtn) {
        DOM.printHoursReportBtn.disabled =
            !profile || profileDraft.mode === PROFILE_MODE.CREATE;
    }

    renderLeaveActionLabels();
    syncEditRestrictedControls();

    syncTurnosSidePanelHeight();
    if (activeView === "hours") {
        renderHoursCharts(profile);
    }
    updateHistoryNavState();
    updateTurnChangesNavState();
    syncWorkspacePermissionUI({ switchIfNeeded: false });
}

window.renderDashboardState = renderDashboardState;

function renderBotones() {
    const hasProfile = Boolean(getCurrentProfile());
    const activeProfile = isProfileActive(getCurrentProfile());
    const shiftAssigned = isProfileEditing()
        ? Boolean(profileDraft.shiftAssigned)
        : getShiftAssigned();

    DOM.compBtn.classList.toggle(
        "hidden",
        !hasProfile || !activeProfile || !shiftAssigned
    );
    syncMoveShiftAvailability();

    updateHistoryNavState();
    updateTurnChangesNavState();
}

let historyToastTimer = null;

function getHistoryToast() {
    let toast = document.getElementById("historyActionToast");

    if (toast) return toast;

    toast = document.createElement("div");
    toast.id = "historyActionToast";
    toast.className = "history-action-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);

    return toast;
}

function showHistoryActionToast(result, type) {
    const toast = getHistoryToast();
    const title = type === "redo"
        ? "Rehacer"
        : "Deshacer";
    const fallback = type === "redo"
        ? "Se rehizo la ultima accion."
        : "Se deshizo la ultima accion.";
    const message =
        typeof result === "object" && result?.message
            ? result.message
            : fallback;

    toast.classList.remove(
        "history-action-toast--undo",
        "history-action-toast--redo",
        "is-visible"
    );
    toast.innerHTML = `
        <strong>${escapeHTML(title)}</strong>
        <span>${escapeHTML(message)}</span>
    `;

    void toast.offsetWidth;

    toast.classList.add(
        type === "redo"
            ? "history-action-toast--redo"
            : "history-action-toast--undo",
        "is-visible"
    );

    clearTimeout(historyToastTimer);
    historyToastTimer = setTimeout(() => {
        toast.classList.remove("is-visible");
    }, 5200);
}

// Toast generico no bloqueante para avisos breves (reemplaza alert() nativo).
// Se auto-cierra y tambien se cierra al hacer clic.
function showAppToast(message, options = {}) {
    const {
        title = "",
        variant = "info",
        duration = 4200
    } = options;

    let toast = document.getElementById("appToast");

    if (!toast) {
        toast = document.createElement("div");
        toast.id = "appToast";
        toast.className = "app-toast";
        toast.setAttribute("role", "status");
        toast.setAttribute("aria-live", "polite");
        toast.addEventListener("click", () => {
            toast.classList.remove("is-visible");
        });
        document.body.appendChild(toast);
    }

    toast.classList.remove(
        "is-visible",
        "app-toast--info",
        "app-toast--warn",
        "app-toast--success"
    );
    toast.innerHTML = `
        ${title ? `<strong>${escapeHTML(title)}</strong>` : ""}
        <span>${escapeHTML(message)}</span>
    `;

    void toast.offsetWidth;

    toast.classList.add(`app-toast--${variant}`, "is-visible");

    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
        toast.classList.remove("is-visible");
    }, duration);
}

function updateHistoryNavState() {
    if (DOM.undoBtn) {
        DOM.undoBtn.disabled = !canUndo();
        DOM.undoBtn.title = DOM.undoBtn.disabled
            ? "No hay acciones para deshacer."
            : "Deshacer ultima accion.";
    }

    if (DOM.redoBtn) {
        DOM.redoBtn.disabled = !canRedo();
        DOM.redoBtn.title = DOM.redoBtn.disabled
            ? "No hay acciones para rehacer."
            : "Rehacer ultima accion.";
    }
}

function updateTurnChangesNavState() {
    const button =
        document.getElementById("turnChangesNav") ||
        document.querySelector("[data-target='turnChangesView']");

    if (!button) return;

    const currentProfile = getCurrentProfile();
    const rotativa = currentProfile
        ? getRotativa(currentProfile)
        : { type: "" };
    const turnChangeConfig = getTurnChangeConfig();
    const permissionDisabled =
        !canViewTarget("turnChangesView");
    const disabled =
        permissionDisabled ||
        !turnChangeConfig.allowSwaps ||
        !currentProfile ||
        !isProfileActive(currentProfile) ||
        rotativa.type === "diurno";

    button.disabled = disabled;
    button.classList.toggle("is-disabled", disabled);
    button.title = disabled
        ? (
            permissionDisabled
                ? "Tu usuario no tiene permiso para ver Cambios de Turno."
                : !turnChangeConfig.allowSwaps
                ? "Cambios de turno desactivados en Ajustes del sistema."
                : "Cambios de turno no disponible para perfiles desactivados o con rotativa Diurno."
        )
        : "";

    if (
        disabled &&
        document.body.dataset.activeView === "swap"
    ) {
        setActiveShortcut(firstViewableTarget());
    }
}


function syncWorkspacePermissionUI(options = {}) {
    const shouldSwitch = options.switchIfNeeded !== false;

    document
        .querySelectorAll(".nav-tile[data-target]")
        .forEach(button => {
            if (button.classList.contains("nav-tile--action")) return;

            const allowed = canViewTarget(button.dataset.target);
            const wasLocked =
                button.dataset.permissionLocked === "true";

            button.classList.toggle(
                "is-permission-disabled",
                !allowed
            );
            button.dataset.permissionLocked =
                allowed ? "false" : "true";

            if (!allowed) {
                button.disabled = true;
                button.title =
                    "Tu usuario no tiene permiso para ver este menu.";
            } else if (wasLocked) {
                button.disabled = false;
                button.title = "";
            }
        });

    const activeTarget = getTargetForActiveView();

    if (shouldSwitch && !canViewTarget(activeTarget)) {
        const nextTarget = firstViewableTarget();
        if (nextTarget && nextTarget !== activeTarget) {
            setActiveShortcut(nextTarget);
            return;
        }
    }

    const canEditActive = canEditTarget(activeTarget);

    document.body.dataset.activeCanEdit =
        canEditActive ? "true" : "false";
    document.body.classList.toggle(
        "workspace-readonly",
        !canEditActive
    );

    window.workspaceCanEditTarget = canEditTarget;
}

function setDashboardView(view) {
    document.body.dataset.activeView = view;
    syncMobileTimelinePlacement();
    if (view !== "turnos") {
        setMobileLeaveOpen(false);
        setMobileStaffingOpen(false);
    }
    syncTurnosSidePanelHeight();
}

function setActiveShortcut(targetId, options = {}) {
    if (!canViewTarget(targetId)) {
        alert("Tu usuario no tiene permiso para ingresar a este menu.");
        syncWorkspacePermissionUI({ switchIfNeeded: false });
        return;
    }

    const previousView = document.body.dataset.activeView || "turnos";
    const nextView = getViewForTarget(targetId);
    const finishNavigation = startPerformanceSpan(
        "navigation:set-active-shortcut",
        {
            targetId,
            previousView,
            nextView
        }
    );

    try {
        if (nextView === "profile" && selectionMode) {
            clearSelectionMode(false);
        }

        setDashboardView(nextView);

        if (nextView === "hours") {
            renderDashboardState();
        }

        if (nextView === "profile") {
            renderDashboardState();
        }

        if (nextView === "log") {
            renderAuditLogPanel();
        }

        if (nextView === "requests") {
            renderWorkerRequestsPanel();
        }

        if (nextView === "memos") {
            renderMemosPanel();
        }

        if (nextView === "reports") {
            if (previousView === "turnos") {
                syncReportsMonthFromCurrent();
            }
            renderReportsProfiles({
                renderDetail: true
            });
        }

        if (nextView === "dashboard") {
            renderDashboardPanel();
        }

        if (nextView === "clockmarks") {
            syncClockMarksMonthFromCurrent();
            renderClockMarksPanel();
        }

        if (nextView === "swap") {
            renderSwapPanel();
        }

        if (nextView === "weekly") {
            renderStaffingWeeklyCalendar();
        }

        if (nextView === "timeline") {
            renderTimeline();
        }

        if (nextView === "tasks") {
            renderTaskAssignmentsPanel();
        }

        if (nextView === "kanban") {
            renderKanbanBoard();
        }

        if (nextView === "agenda") {
            renderAgendaPanel();
        }

        if (nextView === "turnos") {
            renderDashboardState();
            renderCalendar({ deferHeavy: true });
            requestAnimationFrame(scrollInlineStaffingReportToToday);
        }

        document
            .querySelectorAll(".nav-tile[data-target]")
            .forEach(button => {
                button.classList.toggle(
                    "is-active",
                    button.dataset.target === targetId
                );
            });

        syncWorkspacePermissionUI({ switchIfNeeded: false });
        syncAppNavigationHistory(
            targetId,
            options.historyMode || "push"
        );
    } finally {
        finishNavigation();
    }
}

const PROFILE_LIST_PAGE_SIZE = 30;
let profileListLimit = PROFILE_LIST_PAGE_SIZE;
let profileListSignature = "";

function renderProfiles(options = {}) {
    const profiles = syncWorkersState(getProfiles());
    const filters = getAppFilters("profiles");
    const showInactive = Boolean(filters.showInactive);
    const selectableProfiles = profiles.filter(profile =>
        showInactive || isProfileActive(profile)
    );

    if (
        profiles.length > 0 &&
        !profiles.some(
            profile => profile.name === getCurrentProfile()
        ) &&
        profileDraft.mode === PROFILE_MODE.VIEW
    ) {
        setCurrentProfile(selectableProfiles[0]?.name || null);
    }

    if (
        profileDraft.mode === PROFILE_MODE.VIEW &&
        getCurrentProfile() &&
        !selectableProfiles.some(profile =>
            profile.name === getCurrentProfile()
        )
    ) {
        setCurrentProfile(selectableProfiles[0]?.name || null);
    }

    const current = getCurrentProfile();
    const filtro = filters.role || "Todos";
    const query = normalizeProfileSearch(filters.query || "");

    DOM.profiles.replaceChildren();

    const visibles = profiles.filter(profile => {
        const matchActive =
            showInactive || isProfileActive(profile);
        const matchRole =
            filtro === "Todos" ||
            profile.estamento === filtro;

        const matchSearch =
            !query ||
            normalizeProfileSearch(profile.name).includes(query) ||
            normalizeProfileSearch(profile.estamento).includes(query) ||
            normalizeProfileSearch(formatProfession(profile.profession)).includes(query) ||
            normalizeProfileSearch(profile.email).includes(query) ||
            normalizeProfileSearch(profile.rut).includes(query);

        return matchActive && matchRole && matchSearch;
    });
    const nextSignature = [
        showInactive,
        filtro,
        query,
        visibles.map(profile => profile.name).join("\u001f")
    ].join("\u001e");

    if (nextSignature !== profileListSignature) {
        profileListSignature = nextSignature;
        profileListLimit = PROFILE_LIST_PAGE_SIZE;
    }

    const pagedProfiles = visibles.slice(0, profileListLimit);

    if (!visibles.length) {
        DOM.emptyProfiles.classList.remove("hidden");
        DOM.emptyProfiles.textContent = profiles.length
            ? "No hay resultados con ese filtro."
            : "Aun no hay colaboradores creados.";
    } else {
        DOM.emptyProfiles.classList.add("hidden");
    }

    const profilesFragment = document.createDocumentFragment();

    pagedProfiles.forEach(profile => {
        const item = document.createElement("div");
        item.className = "profile-item";
        item.dataset.action = "select-profile";
        item.dataset.profileName = profile.name;

        if (!isProfileActive(profile)) {
            item.classList.add("is-inactive");
        }

        if (
            profile.name === current &&
            profileDraft.mode !== PROFILE_MODE.CREATE
        ) {
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
        meta.textContent = isProfileActive(profile)
            ? getProfileMetaLabel(profile)
            : `${getProfileMetaLabel(profile)} | Desactivado`;

        content.append(name, meta);
        item.append(avatar, content);

        profilesFragment.appendChild(item);
    });

    if (pagedProfiles.length < visibles.length) {
        const loadMore = document.createElement("button");
        loadMore.type = "button";
        loadMore.className = "profile-list-more";
        loadMore.dataset.action = "load-more-profiles";
        loadMore.textContent =
            `Mostrar ${Math.min(PROFILE_LIST_PAGE_SIZE, visibles.length - pagedProfiles.length)} m\u00e1s`;
        profilesFragment.appendChild(loadMore);
    }

    DOM.profiles.appendChild(profilesFragment);

    if (options.dashboard !== false) {
        renderDashboardState();
    }
}

function renderHheeProfiles() {
    if (!DOM.hheeProfiles) return;

    const profiles = getProfiles();
    const showInactive =
        DOM.hheeShowInactiveProfiles?.checked ?? false;
    const current = getCurrentProfile();
    const filtro = DOM.hheeFilterRole?.value || "Todos";
    const query = normalizeProfileSearch(
        DOM.hheeProfileSearch?.value || ""
    );

    DOM.hheeProfiles.innerHTML = "";

    const visibles = profiles.filter(profile => {
        const matchActive =
            showInactive || isProfileActive(profile);
        const matchRole =
            filtro === "Todos" ||
            profile.estamento === filtro;
        const haystack = normalizeProfileSearch([
            profile.name,
            profile.estamento,
            formatProfession(profile.profession),
            profile.email,
            profile.rut
        ].join(" "));

        return matchActive &&
            matchRole &&
            (!query || haystack.includes(query));
    });

    if (DOM.hheeEmptyProfiles) {
        DOM.hheeEmptyProfiles.classList.toggle(
            "hidden",
            Boolean(visibles.length)
        );
        DOM.hheeEmptyProfiles.textContent = profiles.length
            ? "No hay resultados con ese filtro."
            : "Aun no hay colaboradores creados.";
    }

    visibles.forEach(profile => {
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
        meta.textContent = isProfileActive(profile)
            ? getProfileMetaLabel(profile)
            : `${getProfileMetaLabel(profile)} | Desactivado`;

        content.append(name, meta);
        item.append(avatar, content);

        item.onclick = () => selectProfileByName(profile.name);

        DOM.hheeProfiles.appendChild(item);
    });
}

function renderClockMarksProfiles() {
    if (!DOM.clockMarksProfiles) return;

    const profiles = getProfiles();
    const showInactive =
        DOM.clockMarksShowInactiveProfiles?.checked ?? false;
    const current = getCurrentProfile();
    const filtro = DOM.clockMarksFilterRole?.value || "Todos";
    const query = normalizeProfileSearch(
        DOM.clockMarksProfileSearch?.value || ""
    );

    DOM.clockMarksProfiles.innerHTML = "";

    const visibles = profiles.filter(profile => {
        const matchActive =
            showInactive || isProfileActive(profile);
        const matchRole =
            filtro === "Todos" ||
            profile.estamento === filtro;
        const haystack = normalizeProfileSearch([
            profile.name,
            profile.estamento,
            formatProfession(profile.profession),
            profile.email,
            profile.rut
        ].join(" "));

        return matchActive &&
            matchRole &&
            (!query || haystack.includes(query));
    });

    if (DOM.clockMarksEmptyProfiles) {
        DOM.clockMarksEmptyProfiles.classList.toggle(
            "hidden",
            Boolean(visibles.length)
        );
        DOM.clockMarksEmptyProfiles.textContent = profiles.length
            ? "No hay resultados con ese filtro."
            : "Aun no hay colaboradores creados.";
    }

    visibles.forEach(profile => {
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
        meta.textContent = isProfileActive(profile)
            ? getProfileMetaLabel(profile)
            : `${getProfileMetaLabel(profile)} | Desactivado`;

        content.append(name, meta);
        item.append(avatar, content);

        item.onclick = () => {
            selectProfileByName(profile.name, {
                scrollToTop: true
            });
            setActiveShortcut("clockMarksPanel");
        };

        DOM.clockMarksProfiles.appendChild(item);
    });
}

function isFourthShiftNoAssignmentProfile(
    profileName,
    monthDate = new Date()
) {
    if (!profileName) return false;

    const rotativa = getRotativa(profileName);

    return (
        rotativa.type === "3turno" ||
        rotativa.type === "4turno"
    ) &&
        !getShiftAssigned(profileName, monthDate);
}

function formatReportPlanillaTitle(date) {
    const month = date.toLocaleString("es-CL", {
        month: "long",
        year: "numeric"
    }).replace(/\s+de\s+/i, " ");

    return `PLANILLA ${month.toUpperCase()}`;
}

function getReportsMonthDate() {
    return new Date(
        reportsMonthDate.getFullYear(),
        reportsMonthDate.getMonth(),
        1
    );
}

function syncReportsMonthFromCurrent() {
    reportsMonthDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
    );
    reportsMonthPickerYear = reportsMonthDate.getFullYear();
}

function closeReportsMonthPicker() {
    if (!reportsMonthPicker) return;

    reportsMonthPicker.classList.add("hidden");
    reportsMonthPickerAnchor?.setAttribute("aria-expanded", "false");
    reportsMonthPickerAnchor = null;
}

function ensureReportsMonthPicker() {
    if (!reportsMonthPicker) {
        reportsMonthPicker = document.createElement("div");
        reportsMonthPicker.className =
            "calendar-month-picker hidden";
        reportsMonthPicker.setAttribute("role", "dialog");
        reportsMonthPicker.setAttribute(
            "aria-label",
            "Seleccionar mes y a\u00f1o del reporte"
        );
        document.body.appendChild(reportsMonthPicker);
    }

    if (reportsMonthPickerListenersBound) return;

    reportsMonthPickerListenersBound = true;
    document.addEventListener("click", closeReportsMonthPicker);
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closeReportsMonthPicker();
        }
    });
    window.addEventListener("resize", positionReportsMonthPicker);
    window.addEventListener(
        "scroll",
        positionReportsMonthPicker,
        true
    );
}

function positionReportsMonthPicker() {
    const trigger =
        reportsMonthPickerAnchor ||
        document.getElementById("reportMonthTrigger");

    if (
        !trigger ||
        !reportsMonthPicker ||
        reportsMonthPicker.classList.contains("hidden")
    ) {
        return;
    }

    const gap = 8;
    const edge = 12;
    const triggerRect = trigger.getBoundingClientRect();
    const pickerRect = reportsMonthPicker.getBoundingClientRect();
    const left = Math.min(
        Math.max(
            edge,
            triggerRect.left +
            (triggerRect.width - pickerRect.width) / 2
        ),
        window.innerWidth - pickerRect.width - edge
    );
    const preferredTop = triggerRect.bottom + gap;
    const top =
        preferredTop + pickerRect.height <= window.innerHeight - edge
            ? preferredTop
            : Math.max(edge, triggerRect.top - pickerRect.height - gap);

    reportsMonthPicker.style.left = `${Math.round(left)}px`;
    reportsMonthPicker.style.top = `${Math.round(top)}px`;
}

async function setReportsMonth(year, month) {
    reportsMonthDate = new Date(Number(year), Number(month), 1);
    reportsMonthPickerYear = reportsMonthDate.getFullYear();
    closeReportsMonthPicker();

    await withBusyState(
        () => renderReportsDetail(),
        { label: "Generando reporte..." }
    );
}

async function changeReportsMonth(step) {
    const next = getReportsMonthDate();
    next.setMonth(next.getMonth() + Number(step || 0));
    await setReportsMonth(next.getFullYear(), next.getMonth());
}

function renderReportsMonthPicker() {
    if (!reportsMonthPicker) return;

    const activeYear = reportsMonthDate.getFullYear();
    const activeMonth = reportsMonthDate.getMonth();

    reportsMonthPicker.innerHTML = `
        <div class="calendar-month-picker__year">
            <button class="calendar-month-picker__year-button" type="button" data-report-year-step="-1" aria-label="A&#241;o anterior">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
            </button>
            <strong>${reportsMonthPickerYear}</strong>
            <button class="calendar-month-picker__year-button" type="button" data-report-year-step="1" aria-label="A&#241;o siguiente">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </button>
        </div>
        <div class="calendar-month-picker__months">
            ${REPORT_MONTH_NAMES.map((name, month) => `
                <button
                    class="calendar-month-picker__month${reportsMonthPickerYear === activeYear && month === activeMonth ? " is-active" : ""}"
                    type="button"
                    data-report-month="${month}"
                >
                    ${name}
                </button>
            `).join("")}
        </div>
    `;

    reportsMonthPicker
        .querySelectorAll("[data-report-year-step]")
        .forEach(button => {
            button.onclick = event => {
                event.stopPropagation();
                reportsMonthPickerYear += Number(
                    button.dataset.reportYearStep
                );
                renderReportsMonthPicker();
                positionReportsMonthPicker();
            };
        });

    reportsMonthPicker
        .querySelectorAll("[data-report-month]")
        .forEach(button => {
            button.onclick = async event => {
                event.stopPropagation();
                await setReportsMonth(
                    reportsMonthPickerYear,
                    Number(button.dataset.reportMonth)
                );
            };
        });
}

function openReportsMonthPicker(trigger) {
    ensureReportsMonthPicker();

    if (
        reportsMonthPickerAnchor === trigger &&
        !reportsMonthPicker.classList.contains("hidden")
    ) {
        closeReportsMonthPicker();
        return;
    }

    reportsMonthPickerAnchor = trigger;
    reportsMonthPickerYear = reportsMonthDate.getFullYear();
    renderReportsMonthPicker();
    reportsMonthPicker.classList.remove("hidden");
    trigger.setAttribute("aria-expanded", "true");
    positionReportsMonthPicker();
}

function renderReportMonthControls() {
    if (!DOM.report4TurnoNoAssignmentTitle) return;

    closeReportsMonthPicker();

    DOM.report4TurnoNoAssignmentTitle.innerHTML = `
        <div class="report-monthbar">
            <button id="reportPrevMonth" class="report-month-button" type="button" aria-label="Mes anterior reporte">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
            </button>
            <button id="reportMonthTrigger" class="report-month-trigger" type="button" aria-label="Elegir mes y a&#241;o del reporte" aria-haspopup="dialog" aria-expanded="false">
                ${escapeHTML(formatReportPlanillaTitle(getReportsMonthDate()))}
            </button>
            <button id="reportNextMonth" class="report-month-button" type="button" aria-label="Mes siguiente reporte">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </button>
        </div>
    `;

    document.getElementById("reportPrevMonth")?.addEventListener(
        "click",
        () => changeReportsMonth(-1)
    );
    document.getElementById("reportNextMonth")?.addEventListener(
        "click",
        () => changeReportsMonth(1)
    );
    document.getElementById("reportMonthTrigger")?.addEventListener(
        "click",
        event => {
            event.stopPropagation();
            openReportsMonthPicker(event.currentTarget);
        }
    );
}

function buildSpecificReportPreviewHTML(profile, date) {
    if (isReplacementReportProfile(profile.name)) {
        return buildReplacementReportPreviewHTML(profile, date);
    }

    if (isDiurnoReportProfile(profile.name)) {
        return buildDiurnoReportPreviewHTML(profile, date);
    }

    if (isAssignedShiftReportProfile(profile.name, date)) {
        return buildAssignedShiftReportPreviewHTML(profile, date);
    }

    if (isFourthShiftNoAssignmentProfile(profile.name, date)) {
        return buildNoAssignmentReportPreviewHTML(profile, date);
    }

    return Promise.resolve("");
}

// Gate de plan para descargar/imprimir reportes (PDF y Excel). Si aun no hay
// datos de uso, no bloquea (evita castigar a cuentas pagas por cache frio) y
// refresca en segundo plano para la proxima vez.
function ensureCanDownloadReports() {
    if (!getCachedAccountUsage()) {
        void refreshAccountUsage();
        return true;
    }

    if (canDownloadReports()) return true;

    const plan = getEffectivePlan();

    alert(
        `La descarga de reportes (PDF y Excel) no esta disponible en el plan ${plan.name}. ` +
        "Mejora tu plan desde el boton de Planes en la barra superior para habilitarla."
    );
    return false;
}

async function printSpecificReportPdf(profile, date) {
    if (!profile?.name) {
        alert("Selecciona un trabajador para imprimir el reporte.");
        return;
    }

    if (!ensureCanDownloadReports()) return;

    try {
        const html = await buildSpecificReportPreviewHTML(profile, date);
        printReportPreviewHTML(
            html,
            `Reporte ${profile.name} ${formatReportPlanillaTitle(date)}`
        );
    } catch (error) {
        console.error(error);
        alert("No fue posible generar el PDF del reporte.");
    }
}

async function renderReportsDetail() {
    if (!DOM.reportsSelectedInfo) return;

    const requestId = ++reportsDetailRequest;
    const profile = getPerfilActual();
    const reportDate = getReportsMonthDate();

    if (!profile) {
        closeReportsMonthPicker();
        DOM.reportsSelectedInfo.textContent =
            "Selecciona un colaborador para ver sus reportes disponibles.";
        DOM.report4TurnoNoAssignmentCard?.classList.add("hidden");
        if (DOM.report4TurnoNoAssignmentTitle) {
            DOM.report4TurnoNoAssignmentTitle.textContent = "";
        }
        if (DOM.report4TurnoNoAssignmentPreview) {
            DOM.report4TurnoNoAssignmentPreview.innerHTML = "";
        }
        DOM.reportsUnavailableHint?.classList.add("hidden");
        return;
    }

    const rotativa = getRotativa(profile.name);
    const hasShiftAssigned = getShiftAssigned(
        profile.name,
        reportDate
    );
    const replacementReport =
        isReplacementReportProfile(profile.name);
    const rotationStatus = replacementReport
        ? "Contrato Reemplazo | rotativa heredada"
        : [
            getRotativaLabel(rotativa.type),
            hasShiftAssigned
                ? "con asignaci\u00f3n de turno"
                : "sin asignaci\u00f3n de turno"
        ].join(" ");
    const canShowFourthShiftReport =
        isFourthShiftNoAssignmentProfile(profile.name, reportDate);
    const canShowAssignedShiftReport =
        isAssignedShiftReportProfile(profile.name, reportDate);
    const canShowReplacementReport =
        replacementReport;
    const canShowDiurnoReport =
        isDiurnoReportProfile(profile.name);
    const canShowSpecificReport =
        canShowFourthShiftReport ||
        canShowAssignedShiftReport ||
        canShowReplacementReport ||
        canShowDiurnoReport;

    DOM.reportsSelectedInfo.innerHTML = `
        <span>Trabajador seleccionado</span>
        <strong>${escapeHTML(profile.name)}</strong>
        <small>${escapeHTML(getProfileMetaLabel(profile))} | ${escapeHTML(rotationStatus)}</small>
    `;

    DOM.report4TurnoNoAssignmentCard?.classList.toggle(
        "hidden",
        !canShowSpecificReport
    );

    if (DOM.report4TurnoNoAssignmentTitle) {
        if (canShowSpecificReport) {
            renderReportMonthControls();
        } else {
            closeReportsMonthPicker();
            DOM.report4TurnoNoAssignmentTitle.textContent = "";
        }
    }

    if (DOM.downloadNoAssignmentReportBtn) {
        DOM.downloadNoAssignmentReportBtn.onclick = () => {
            if (!ensureCanDownloadReports()) return;

            return canShowReplacementReport
                ? exportReplacementShiftReport(profile, reportDate)
                : canShowDiurnoReport
                ? exportDiurnoShiftReport(profile, reportDate)
                : canShowAssignedShiftReport
                ? exportAssignedShiftReport(profile, reportDate)
                : exportNoAssignmentShiftReport(profile, reportDate);
        };
    }

    if (DOM.printReportPdfBtn) {
        DOM.printReportPdfBtn.onclick = () =>
            printSpecificReportPdf(profile, reportDate);
    }

    if (DOM.report4TurnoNoAssignmentPreview) {
        DOM.report4TurnoNoAssignmentPreview.innerHTML =
            canShowSpecificReport
                ? `<div class="empty-state empty-state--compact">Calculando detalle mensual...</div>`
                : "";
    }

    if (DOM.reportsUnavailableHint) {
        DOM.reportsUnavailableHint.classList.toggle(
            "hidden",
            canShowSpecificReport
        );
        DOM.reportsUnavailableHint.textContent =
            canShowSpecificReport
                ? ""
                : `No hay reportes espec\u00edficos para este perfil. Los archivos "${FOURTH_SHIFT_NO_ASSIGNMENT_REPORT_LABEL}", "${FOURTH_SHIFT_ASSIGNED_REPORT_LABEL}", "${REPLACEMENT_REPORT_LABEL}" y "${DIURNO_REPORT_LABEL}" aparecen cuando corresponden a la configuraci\u00f3n del trabajador.`;
    }

    if (!canShowSpecificReport || !DOM.report4TurnoNoAssignmentPreview) {
        return;
    }

    try {
        const html = await buildSpecificReportPreviewHTML(
            profile,
            reportDate
        );

        if (requestId !== reportsDetailRequest) return;

        DOM.report4TurnoNoAssignmentPreview.innerHTML =
            html || `<div class="empty-state empty-state--compact">No fue posible generar el detalle para este mes.</div>`;
    } catch (error) {
        if (requestId !== reportsDetailRequest) return;

        console.error(error);
        DOM.report4TurnoNoAssignmentPreview.innerHTML =
            `<div class="empty-state empty-state--compact">No fue posible generar el detalle del reporte.</div>`;
    }
}

async function renderReportsProfiles(options = {}) {
    if (!DOM.reportsProfiles) return;

    const profiles = getProfiles();
    const showInactive =
        DOM.reportsShowInactiveProfiles?.checked ?? false;
    const current = getCurrentProfile();
    const filtro = DOM.reportsFilterRole?.value || "Todos";
    const query = normalizeProfileSearch(
        DOM.reportsProfileSearch?.value || ""
    );

    DOM.reportsProfiles.innerHTML = "";

    const visibles = profiles.filter(profile => {
        const matchActive =
            showInactive || isProfileActive(profile);
        const matchRole =
            filtro === "Todos" ||
            profile.estamento === filtro;
        const haystack = normalizeProfileSearch([
            profile.name,
            profile.estamento,
            formatProfession(profile.profession),
            profile.email,
            profile.rut
        ].join(" "));

        return matchActive &&
            matchRole &&
            (!query || haystack.includes(query));
    });

    if (DOM.reportsEmptyProfiles) {
        DOM.reportsEmptyProfiles.classList.toggle(
            "hidden",
            Boolean(visibles.length)
        );
        DOM.reportsEmptyProfiles.textContent = profiles.length
            ? "No hay resultados con ese filtro."
            : "Aun no hay colaboradores creados.";
    }

    visibles.forEach(profile => {
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
        meta.textContent = isProfileActive(profile)
            ? getProfileMetaLabel(profile)
            : `${getProfileMetaLabel(profile)} | Desactivado`;

        content.append(name, meta);
        item.append(avatar, content);

        item.onclick = async () => {
            await withBusyState(async () => {
                selectProfileByName(profile.name, {
                    scrollToTop: true,
                    refresh: false
                });
                await renderReportsProfiles({
                    renderDetail: true
                });
            }, {
                label: "Generando reporte..."
            });
        };

        DOM.reportsProfiles.appendChild(item);
    });

    if (options.renderDetail) {
        await renderReportsDetail();
    }
}

function renderClockMarkRecord(record) {
    const timing = getClockMarkTimingFlags(
        record.date,
        record.segment,
        record.segmentMark
    );
    const isMissing =
        record.segmentMark.missingEntry ||
        record.segmentMark.missingExit;

    // Magnitudes (en minutos) de horas trabajadas de mas (ingreso antes /
    // salida despues) y de tiempo programado no trabajado (ingreso tarde /
    // salida antes). Solo aplica a segmentos del turno base/cambio.
    let extraMinutes = 0;
    let deficitMinutes = 0;

    if (record.isBaseOrSwap && !isMissing) {
        if (timing.entry) {
            const diff =
                (record.segment.start - timing.entry) / 60000;
            if (diff > 0) extraMinutes += diff;
            else deficitMinutes += -diff;
        }

        if (timing.exit) {
            const diff =
                (timing.exit - record.segment.end) / 60000;
            if (diff > 0) extraMinutes += diff;
            else deficitMinutes += -diff;
        }
    }

    // La recuperacion es la parte del tiempo extra que compensa el deficit.
    const recoveryMinutes = Math.min(extraMinutes, deficitMinutes);
    const netExtraMinutes = extraMinutes - recoveryMinutes;
    const uncoveredMinutes = deficitMinutes - recoveryMinutes;

    // Hay reduccion de jornada solo si la recuperacion NO cubre el deficit.
    const isReduction =
        record.isBaseOrSwap &&
        !isMissing &&
        uncoveredMinutes > 0;

    const classes = [
        "clockmark-record",
        isMissing ? "clockmark-record--severe" : "",
        isReduction ? "clockmark-record--warning" : "",
        record.segmentMark.rrhhPayApproved ||
        record.segmentMark.discountWaived
            ? "is-approved"
            : ""
    ].filter(Boolean).join(" ");
    const badges = [];

    if (record.segmentMark.missingEntry) {
        badges.push("Sin entrada");
    }

    if (record.segmentMark.missingExit) {
        badges.push("Sin salida");
    }

    if (isReduction) {
        // El atraso/salida temprana no alcanzo a recuperarse: solo reduccion.
        badges.push("Reducción de jornada");
    } else if (record.isBaseOrSwap && !isMissing) {
        // Segmento base/cambio sin deficit pendiente: puede recuperar el atraso
        // y/o generar horas extra (puede llevar ambas etiquetas).
        if (recoveryMinutes > 0) {
            badges.push("Recuperación de horas");
        }

        if (netExtraMinutes > 0) {
            badges.push("Genera horas extra");
        }
    } else if (!isMissing && (timing.earlyEntry || timing.lateExit)) {
        // Segmentos extra (fuera del turno): siempre generan horas extra.
        badges.push("Genera horas extra");
    }

    const details = [];

    if (record.segmentMark.entryTime) {
        details.push(
            `Entrada ${formatClockMinute(record.segment.start)} -> ${escapeHTML(record.segmentMark.entryTime)}`
        );
    }

    if (record.segmentMark.exitTime) {
        details.push(
            `Salida ${formatClockMinute(record.segment.end)} -> ${escapeHTML(record.segmentMark.exitTime)}`
        );
    }

    if (!details.length) {
        details.push(
            `${formatClockMinute(record.segment.start)} - ${formatClockMinute(record.segment.end)}`
        );
    }

    const clockDocuments =
        Array.isArray(record.segmentMark.documents)
            ? record.segmentMark.documents
            : [];

    return `
        <article class="${classes}"
            data-profile="${escapeHTML(record.profile.name)}"
            data-key-day="${escapeHTML(record.keyDay)}"
            data-segment-key="${escapeHTML(record.segmentKey)}">
            <div class="clockmark-record__main">
                <div>
                    <strong>${escapeHTML(record.profile.name)}</strong>
                    <span>${formatClockMarkDate(record.keyDay)} | ${escapeHTML(record.segment.label || turnoLabel(getClockActualState(record.profile.name, record.keyDay)))}</span>
                </div>

                <div class="clockmark-record__badges">
                    ${badges.map(badge =>
                        `<span>${escapeHTML(badge)}</span>`
                    ).join("")}
                </div>
            </div>

            <p class="clockmark-record__detail">
                ${details.join(" | ")}
            </p>

            ${isMissing ? `
                <label class="clockmark-check">
                    <input type="checkbox" data-clock-review="rrhhPayApproved" ${record.segmentMark.rrhhPayApproved ? "checked" : ""}>
                    <span>RRHH autoriza pago pese a falta de marcaje</span>
                </label>
            ` : ""}

            ${isReduction ? `
                <label class="clockmark-check">
                    <input type="checkbox" data-clock-review="discountWaived" ${record.segmentMark.discountWaived ? "checked" : ""}>
                    <span>No descontar horas por incidencia justificada</span>
                </label>

                <label class="clockmark-note">
                    <span>Nota administrativa</span>
                    <textarea data-clock-note rows="2" placeholder="Ej: El colaborador informa que llego a la hora, pero olvido registrar el marcaje.">${escapeHTML(record.segmentMark.adminNote || "")}</textarea>
                </label>
            ` : ""}

            <label class="clockmark-note">
                <span>Comentarios</span>
                <textarea data-clock-comments rows="2" placeholder="Ingresa comentarios del registro.">${escapeHTML(record.segmentMark.comments || "")}</textarea>
            </label>

            <div class="clockmark-documents">
                <label class="clockmark-file">
                    <span>Documentos</span>
                    <input data-clock-documents type="file" multiple accept="${ATTACHMENT_ACCEPT}">
                </label>

                <div class="attachment-list">
                    ${clockDocuments.length
                        ? clockDocuments.map((doc, index) => `
                            <div class="attachment-item">
                                <span>
                                    <strong>${escapeHTML(doc.name || "Documento")}</strong>
                                    <small>
                                        ${doc.type ? escapeHTML(doc.type) : "Archivo"}
                                        ${hasAttachmentContent(doc) ? "" : " | volver a adjuntar para visualizar"}
                                    </small>
                                </span>
                                <span class="attachment-actions">
                                    <button class="secondary-button attachment-view" type="button" data-clock-doc-view="${index}" ${hasAttachmentContent(doc) ? "" : "disabled"}>
                                        Ver
                                    </button>
                                    <button class="ghost-button attachment-remove" type="button" data-clock-doc-remove="${index}">
                                        Quitar
                                    </button>
                                </span>
                            </div>
                        `).join("")
                        : `
                            <div class="attachment-empty">
                                Sin documentos adjuntos.
                            </div>
                        `}
                </div>
            </div>
        </article>
    `;
}

function updateClockMarkReview(profileName, keyDay, segmentKey, patch) {
    const marks = getClockMarks(profileName);
    const dayMark = marks[keyDay] || { segments: {} };
    const currentSegment = dayMark.segments?.[segmentKey] || {};

    marks[keyDay] = {
        ...dayMark,
        segments: {
            ...(dayMark.segments || {}),
            [segmentKey]: {
                ...currentSegment,
                ...patch,
                reviewedAt: new Date().toISOString()
            }
        },
        updatedAt: new Date().toISOString()
    };

    saveClockMarks(profileName, marks);
}

async function renderClockMarksPanel() {
    if (!DOM.clockMarksPanel || !DOM.clockMarksList) return;

    renderClockMarksProfiles();
    renderClockMarksMonthControls();

    const requestId = ++clockMarksRenderRequest;
    const monthDate = new Date(
        clockMarksMonthDate.getFullYear(),
        clockMarksMonthDate.getMonth(),
        1
    );
    const holidays = await fetchHolidays(monthDate.getFullYear());

    if (requestId !== clockMarksRenderRequest) return;

    const showAll = Boolean(
        DOM.clockMarksAllWorkersToggle?.checked
    );
    const currentProfile = getCurrentProfile();
    const profiles = getProfiles()
        .filter(profile =>
            showAll || profile.name === currentProfile
        )
        .filter(profile => showAll || isProfileActive(profile));
    const records = profiles
        .flatMap(profile =>
            buildClockMarkRecordsForProfile(
                profile,
                monthDate,
                holidays
            )
        )
        .sort((a, b) =>
            a.date - b.date ||
            a.profile.name.localeCompare(b.profile.name)
        );

    if (DOM.clockMarksSubtitle) {
        DOM.clockMarksSubtitle.textContent =
            "Registros del mes de todos los colaboradores";
    }

    if (!records.length) {
        DOM.clockMarksList.innerHTML = `
            <div class="clockmarks-empty">
                No hay registros de marcaje para el filtro actual en ${formatMonthHeading(monthDate)}.
            </div>
        `;
        return;
    }

    DOM.clockMarksList.innerHTML =
        records.map(renderClockMarkRecord).join("");

    DOM.clockMarksList
        .querySelectorAll("[data-clock-review]")
        .forEach(input => {
            input.onchange = () => {
                const card = input.closest(".clockmark-record");

                updateClockMarkReview(
                    card.dataset.profile,
                    card.dataset.keyDay,
                    card.dataset.segmentKey,
                    {
                        [input.dataset.clockReview]: input.checked
                    }
                );

                addAuditLog(
                    AUDIT_CATEGORY.OVERTIME,
                    "Revision de marcaje",
                    `${card.dataset.profile} | ${formatClockMarkDate(card.dataset.keyDay)}: ${input.dataset.clockReview} ${input.checked ? "activado" : "desactivado"}.`,
                    { profile: card.dataset.profile }
                );
                void updateDayCell(
                    card.dataset.profile,
                    card.dataset.keyDay
                );
            };
        });

    DOM.clockMarksList
        .querySelectorAll("[data-clock-note]")
        .forEach(textarea => {
            textarea.onchange = () => {
                const card = textarea.closest(".clockmark-record");

                updateClockMarkReview(
                    card.dataset.profile,
                    card.dataset.keyDay,
                    card.dataset.segmentKey,
                    { adminNote: textarea.value.trim() }
                );

                addAuditLog(
                    AUDIT_CATEGORY.OVERTIME,
                    "Nota en incidencia de marcaje",
                    `${card.dataset.profile} | ${formatClockMarkDate(card.dataset.keyDay)}: se actualizo la nota administrativa.`,
                    { profile: card.dataset.profile }
                );
                renderClockMarksPanel();
            };
        });

    DOM.clockMarksList
        .querySelectorAll("[data-clock-comments]")
        .forEach(textarea => {
            textarea.onchange = () => {
                const card = textarea.closest(".clockmark-record");

                updateClockMarkReview(
                    card.dataset.profile,
                    card.dataset.keyDay,
                    card.dataset.segmentKey,
                    { comments: textarea.value.trim() }
                );

                addAuditLog(
                    AUDIT_CATEGORY.OVERTIME,
                    "Comentario en marcaje",
                    `${card.dataset.profile} | ${formatClockMarkDate(card.dataset.keyDay)}: se actualizo comentario del registro.`,
                    { profile: card.dataset.profile }
                );
                renderClockMarksPanel();
            };
        });

    DOM.clockMarksList
        .querySelectorAll("[data-clock-documents]")
        .forEach(input => {
            input.onchange = async () => {
                const card = input.closest(".clockmark-record");
                const marks = getClockMarks(card.dataset.profile);
                const currentDocuments =
                    marks[card.dataset.keyDay]
                        ?.segments?.[card.dataset.segmentKey]
                        ?.documents || [];
                let attachments;
                try {
                    attachments =
                        await readAttachmentFiles(input.files, {
                            moduleId: "clockmarks",
                            ownerId: card.dataset.profile,
                            recordId: [
                                card.dataset.keyDay,
                                card.dataset.segmentKey
                            ].join("_")
                        });
                } catch (error) {
                    alert(error?.planBlocked
                        ? error.message
                        : "No se pudo adjuntar el documento al marcaje.");
                    console.error(error);
                    return;
                }

                updateClockMarkReview(
                    card.dataset.profile,
                    card.dataset.keyDay,
                    card.dataset.segmentKey,
                    {
                        documents: [
                            ...currentDocuments,
                            ...attachments
                        ]
                    }
                );

                addAuditLog(
                    AUDIT_CATEGORY.OVERTIME,
                    "Adjunto documento a marcaje",
                    `${card.dataset.profile} | ${formatClockMarkDate(card.dataset.keyDay)}: ${attachments.length} documento(s) adjunto(s).`,
                    { profile: card.dataset.profile }
                );
                renderClockMarksPanel();
            };
        });

    DOM.clockMarksList
        .querySelectorAll("[data-clock-doc-view]")
        .forEach(button => {
            button.onclick = async () => {
                const card = button.closest(".clockmark-record");
                const marks = getClockMarks(card.dataset.profile);
                const doc =
                    marks[card.dataset.keyDay]
                        ?.segments?.[card.dataset.segmentKey]
                        ?.documents?.[Number(button.dataset.clockDocView)];

                await openAttachment(doc);
            };
        });

    DOM.clockMarksList
        .querySelectorAll("[data-clock-doc-remove]")
        .forEach(button => {
            button.onclick = async () => {
                const card = button.closest(".clockmark-record");
                const marks = getClockMarks(card.dataset.profile);
                const currentDocuments =
                    marks[card.dataset.keyDay]
                        ?.segments?.[card.dataset.segmentKey]
                        ?.documents || [];
                const indexToRemove =
                    Number(button.dataset.clockDocRemove);
                const removedDocument =
                    currentDocuments[indexToRemove];

                updateClockMarkReview(
                    card.dataset.profile,
                    card.dataset.keyDay,
                    card.dataset.segmentKey,
                    {
                        documents: currentDocuments.filter(
                            (_doc, index) =>
                                index !== indexToRemove
                        )
                    }
                );

                addAuditLog(
                    AUDIT_CATEGORY.OVERTIME,
                    "Quito documento de marcaje",
                    `${card.dataset.profile} | ${formatClockMarkDate(card.dataset.keyDay)}: se quito un documento adjunto.`,
                    { profile: card.dataset.profile }
                );
                await deleteStoredAttachment(removedDocument)
                    .catch(error => {
                        console.warn(
                            "No se pudo eliminar el adjunto remoto.",
                            error
                        );
                    });
                renderClockMarksPanel();
            };
        });
}

window.renderClockMarksPanel = renderClockMarksPanel;

function getTopSearchProfiles() {
    const showInactive =
        DOM.showInactiveProfiles?.checked ?? false;

    return getProfiles()
        .filter(profile =>
            showInactive || isProfileActive(profile)
        )
        .sort((a, b) =>
            a.name.localeCompare(b.name)
        );
}

function syncTopProfileSearch() {
    if (!DOM.topProfileSearchInput) return;

    const data = getDisplayedProfileData();
    const currentName =
        profileDraft.mode === PROFILE_MODE.CREATE
            ? ""
            : data.name || getCurrentProfile() || "";
    const profiles = getTopSearchProfiles();
    const currentProfile =
        profiles.find(profile => profile.name === currentName) ||
        (currentName ? { ...data, name: currentName } : null);

    if (document.activeElement !== DOM.topProfileSearchInput) {
        DOM.topProfileSearchInput.value = currentProfile
            ? getCalendarProfileSearchValue(currentProfile)
            : currentName;
    }

    if (!DOM.topProfileOptions) return;

    DOM.topProfileOptions.innerHTML = "";

    profiles.forEach(profile => {
        const option = document.createElement("option");
        option.value = getCalendarProfileSearchValue(profile);
        DOM.topProfileOptions.appendChild(option);
    });
}

function handleTopProfileSearch() {
    if (!DOM.topProfileSearchInput) return;

    const query = DOM.topProfileSearchInput.value.trim();

    if (!query) {
        syncTopProfileSearch();
        return;
    }

    const normalizedQuery = normalizeProfileSearch(query);
    const profiles = getTopSearchProfiles();
    const match = findTopProfileSearchMatch(
        normalizedQuery,
        profiles
    );

    if (!match) {
        showAppToast(
            "No se encontro un colaborador con ese nombre.",
            { title: "Sin resultados", variant: "warn" }
        );
        syncTopProfileSearch();
        DOM.topProfileSearchInput.focus();
        DOM.topProfileSearchInput.select();
        return;
    }

    DOM.topProfileSearchInput.value =
        getCalendarProfileSearchValue(match);
    selectProfileByName(match.name);
}

function selectProfileByName(profileName, options = {}) {
    const profile = getProfiles().find(item =>
        item.name === profileName
    );

    if (!profile) return;

    clearSelectionMode(false);
    resetProfileDraft();
    availabilityEditMode = false;
    profileDraft.mode = PROFILE_MODE.VIEW;
    setCurrentProfile(profile.name);
    renderProfiles({ dashboard: false });
    renderBotones();

    if (options.openProfile) {
        setActiveShortcut("profileSection");
    }

    if (options.openTurns) {
        setActiveShortcut("calendarPanel");
    }

    if (options.refresh !== false) {
        refreshAll();
    }

    if (options.scrollToTop) {
        requestAnimationFrame(() => {
            window.scrollTo({
                top: 0,
                behavior: "smooth"
            });
        });
    }
}

window.selectProfileByName = selectProfileByName;

function clearSelectionMode(shouldRefresh = true) {
    selectionMode = null;
    window.selectionMode = null;
    pendingRotationChange = null;
    pendingShiftMove = null;
    window.pendingShiftMoveSourceKey = "";
    window.pendingShiftMoveDestinationTurn = 0;
    compCantidad = 0;
    window.compCantidad = 0;
    legalCantidad = 0;
    window.legalCantidad = 0;
    licenseCantidad = 0;
    licenseType = "license";
    window.licenseCantidad = 0;
    window.licenseType = "license";

    document.body.classList.remove("mode-active");
    document.body.removeAttribute("data-mode");

    DOM.selectorInfo.classList.add("hidden");
    DOM.selectorInfo.innerHTML = "";
    DOM.adminInfo.classList.add("hidden");

    if (shouldRefresh) {
        void updateVisibleCalendarDays({
            updateSummary: true,
            cooperative: true,
            modeRefresh: true
        });
        // Refresca solo la fila del trabajador activo en el timeline (permisos,
        // feriados, rotativa, etc.) sin reconstruir todo el timeline.
        updateTimelineCells(getCurrentProfile());
        // Actualiza el saldo entre parentesis de los botones (P. Administrativo,
        // F. Legal, F. Compensatorio, etc.) inmediatamente tras aplicar.
        renderLeaveActionLabels();
    }
}

function scheduleModeCalendarRefresh() {
    const refresh = () => {
        void updateVisibleCalendarDays({
            cooperative: true,
            modeRefresh: true
        });
    };

    if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(refresh);
        return;
    }

    window.setTimeout(refresh, 0);
}

function activarModo(modo, texto) {
    if (!canModifyCurrentProfile()) return;

    selectionMode = modo;
    window.selectionMode = modo;

    document.body.classList.add("mode-active");
    document.body.dataset.mode = modo;

    DOM.selectorInfo.innerHTML = `
        <div class="mode-banner">
            <span>${texto}</span>
            <button id="cancelModeBtn" type="button">Cancelar</button>
        </div>
    `;

    DOM.selectorInfo.classList.remove("hidden");
    DOM.adminInfo.textContent =
        "Selecciona una fecha en el calendario para continuar.";
    DOM.adminInfo.classList.remove("hidden");

    document
        .getElementById("cancelModeBtn")
        .onclick = () => clearSelectionMode();

    scheduleModeCalendarRefresh();
}

function isStandaloneApp() {
    const standaloneMode = [
        "(display-mode: standalone)",
        "(display-mode: fullscreen)",
        "(display-mode: minimal-ui)"
    ].some(query => window.matchMedia?.(query).matches);

    return standaloneMode || window.navigator.standalone === true;
}

const MOVE_SHIFT_WEB_HOSTS = new Set([
    "calendarioturnos-7c4d9.web.app",
    "calendarioturnos-7c4d9.firebaseapp.com",
    "turnoplus-test-7c4d9.web.app",
    "turnoplus-test-7c4d9.firebaseapp.com"
]);

function isMoveShiftAvailable() {
    const hostname =
        String(window.location.hostname || "").toLowerCase();
    const isLocalDevelopment =
        !hostname ||
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1";
    const isTurnoPlusWebsite =
        hostname === "turnoplus.cl" ||
        hostname.endsWith(".turnoplus.cl");

    return (
        !isStandaloneApp() &&
        (
            isTurnoPlusWebsite ||
            MOVE_SHIFT_WEB_HOSTS.has(hostname) ||
            isLocalDevelopment
        )
    );
}

function syncMoveShiftAvailability() {
    if (!DOM.moveShiftBtn) return;

    const available = isMoveShiftAvailable();

    DOM.moveShiftBtn.classList.toggle("hidden", !available);
    DOM.moveShiftBtn.setAttribute(
        "aria-hidden",
        available ? "false" : "true"
    );
}

function shiftMoveTurnLabel(turn) {
    return Number(turn) === TURNO.NOCHE
        ? "Noche"
        : "Larga";
}

function shiftMoveDayBlockReason(
    profile,
    keyDay,
    {
        source = false,
        sourceKey = "",
        destinationTurn = 0
    } = {}
) {
    if (!profile || !keyDay) {
        return "No se pudo identificar el trabajador o la fecha.";
    }

    const baseTurn = Number(
        getTurnoBase(profile, keyDay)
    ) || TURNO.LIBRE;
    const programmedTurn = Number(
        getTurnoProgramado(profile, keyDay)
    ) || TURNO.LIBRE;
    const actualTurn = Number(
        aplicarCambiosTurno(
            profile,
            keyDay,
            programmedTurn
        )
    ) || TURNO.LIBRE;
    const admin = getAdminDays(profile);
    const legal = getLegalDays(profile);
    const comp = getCompDays(profile);
    const absences = getAbsences(profile);

    if (
        admin[keyDay] ||
        legal[keyDay] ||
        comp[keyDay] ||
        absences[keyDay]
    ) {
        return "La fecha tiene un permiso o ausencia aplicada.";
    }

    if (getHourReturn(profile, keyDay)) {
        return "La fecha tiene una devolucion de horas aplicada.";
    }

    if (getClockMarks(profile)[keyDay]) {
        return "La fecha ya tiene marcajes de reloj control.";
    }

    if (source) {
        if (
            baseTurn !== TURNO.LARGA &&
            baseTurn !== TURNO.NOCHE
        ) {
            return "Selecciona un turno base Larga o Noche.";
        }

        if (
            programmedTurn !== baseTurn ||
            actualTurn !== baseTurn
        ) {
            return "El turno tiene modificaciones, reemplazos o cambios de turno asociados.";
        }

        return "";
    }

    if (keyDay === sourceKey) {
        return "";
    }

    // El destino puede tener el turno complementario (Larga<->Noche): al juntarse
    // con el turno que se mueve forma un 24, asi que se permite.
    const combina24 = moveShiftTargetCombina24(
        destinationTurn,
        baseTurn,
        programmedTurn,
        actualTurn
    );

    if (
        !combina24 &&
        (
            baseTurn !== TURNO.LIBRE ||
            programmedTurn !== TURNO.LIBRE ||
            actualTurn !== TURNO.LIBRE
        )
    ) {
        return "El dia de destino ya tiene un turno o una modificacion de calendario.";
    }

    return "";
}

function openMoveShiftDialog({
    profile,
    sourceKey,
    sourceTurn
}) {
    return new Promise(resolve => {
        const backdrop = document.createElement("div");
        const sourceDate = parseKey(sourceKey);
        const displayDate = Number.isNaN(sourceDate.getTime())
            ? sourceKey
            : formatDisplayDate(toISODate(sourceDate));

        backdrop.className = "turn-change-dialog-backdrop";
        backdrop.innerHTML = `
            <form class="turn-change-dialog move-shift-dialog" role="dialog" aria-modal="true" aria-labelledby="moveShiftDialogTitle">
                <strong id="moveShiftDialogTitle">Mover turno base</strong>
                <p>
                    Seleccionaste el siguiente turno de ${escapeHTML(profile)}:
                </p>
                <div class="turn-change-dialog__meta">
                    ${escapeHTML(displayDate)} &middot; ${escapeHTML(shiftMoveTurnLabel(sourceTurn))}
                </div>
                <p>¿Con que horario se registrara en su nueva ubicacion?</p>
                <div class="move-shift-options">
                    <label class="move-shift-option">
                        <input
                            type="radio"
                            name="destinationTurn"
                            value="${TURNO.LARGA}"
                            ${Number(sourceTurn) === TURNO.LARGA ? "checked" : ""}
                        >
                        <span>Larga</span>
                    </label>
                    <label class="move-shift-option">
                        <input
                            type="radio"
                            name="destinationTurn"
                            value="${TURNO.NOCHE}"
                            ${Number(sourceTurn) === TURNO.NOCHE ? "checked" : ""}
                        >
                        <span>Noche</span>
                    </label>
                </div>
                <div class="turn-change-dialog__actions">
                    <button class="secondary-button" type="button" data-action="cancel">
                        Cancelar
                    </button>
                    <button class="primary-button" type="submit" disabled>
                        Continuar
                    </button>
                </div>
            </form>
        `;

        const form = backdrop.querySelector("form");
        const continueButton =
            form.querySelector("button[type='submit']");

        const close = value => {
            document.removeEventListener("keydown", onKeydown);
            backdrop.remove();
            resolve(value);
        };

        const onKeydown = event => {
            if (event.key === "Escape") {
                close(null);
            }
        };

        form
            .querySelectorAll("input[name='destinationTurn']")
            .forEach(input => {
                input.onchange = () => {
                    continueButton.disabled = false;
                };
            });

        form
            .querySelector("[data-action='cancel']")
            .onclick = () => close(null);

        form.onsubmit = event => {
            event.preventDefault();

            const selected = form.querySelector(
                "input[name='destinationTurn']:checked"
            );

            if (!selected) return;

            close(Number(selected.value));
        };

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) {
                close(null);
            }
        });

        document.addEventListener("keydown", onKeydown);
        document.body.appendChild(backdrop);
        continueButton.disabled = false;
        form
            .querySelector(
                "input[name='destinationTurn']:checked"
            )
            ?.focus();
    });
}

async function activarSelectorMoverTurno() {
    if (!isMoveShiftAvailable()) return;
    if (!canModifyCurrentProfile()) return;

    pendingShiftMove = null;
    window.pendingShiftMoveSourceKey = "";
    window.pendingShiftMoveDestinationTurn = 0;

    activarModo(
        "moveshiftsource",
        "Selecciona en el calendario el turno base Larga o Noche que deseas mover."
    );

    DOM.adminInfo.textContent =
        "Solo se habilitan turnos base sin permisos, marcajes, reemplazos ni cambios de turno asociados.";
}

async function handleMoveShiftSourceSelection(fecha) {
    const profile = getCurrentProfile();
    const sourceKey = keyFromDate(fecha);
    const blockReason = shiftMoveDayBlockReason(
        profile,
        sourceKey,
        { source: true }
    );

    if (blockReason) {
        alert(blockReason);
        return;
    }

    const sourceTurn = getTurnoBase(profile, sourceKey);
    const destinationTurn = await openMoveShiftDialog({
        profile,
        sourceKey,
        sourceTurn
    });

    if (!destinationTurn) {
        clearSelectionMode();
        return;
    }

    pendingShiftMove = {
        profile,
        sourceKey,
        sourceTurn,
        destinationTurn
    };
    window.pendingShiftMoveSourceKey = sourceKey;
    window.pendingShiftMoveDestinationTurn = destinationTurn;

    const complementoLabel = Number(destinationTurn) === TURNO.LARGA
        ? "Noche"
        : "Larga";

    activarModo(
        "moveshifttarget",
        `Selecciona el dia donde reubicaras el turno ${shiftMoveTurnLabel(destinationTurn)}. Puedes elegir un dia libre, un dia con turno ${complementoLabel} (se juntaran en un 24) o el mismo dia para cambiar solo el horario.`
    );

    DOM.adminInfo.textContent =
        `El destino debe estar libre o tener un turno ${complementoLabel} (base o extra) para formar un 24, sin permisos, marcajes ni otras modificaciones.`;
}

function handleMoveShiftTargetSelection(fecha) {
    const move = pendingShiftMove;
    const profile = getCurrentProfile();

    if (!move || move.profile !== profile) {
        alert("El trabajador seleccionado cambio. Inicia nuevamente Mover Turno.");
        clearSelectionMode();
        return;
    }

    const targetKey = keyFromDate(fecha);
    const sourceReason = shiftMoveDayBlockReason(
        profile,
        move.sourceKey,
        { source: true }
    );

    if (sourceReason) {
        alert(`El turno de origen ya no esta disponible: ${sourceReason}`);
        clearSelectionMode();
        return;
    }

    const targetReason = shiftMoveDayBlockReason(
        profile,
        targetKey,
        {
            sourceKey: move.sourceKey,
            destinationTurn: move.destinationTurn
        }
    );

    if (targetReason) {
        alert(targetReason);
        return;
    }

    if (
        targetKey === move.sourceKey &&
        Number(move.destinationTurn) === Number(move.sourceTurn)
    ) {
        alert("Selecciona otro dia o cambia el horario del turno.");
        return;
    }

    pushHistory();

    const data = getProfileData(profile);
    const baseData = getBaseProfileData(profile);
    const blocked = getBlockedDays(profile);

    // Estado del destino ANTES de mover, para detectar si el turno se junta con
    // un turno complementario existente formando un 24.
    const targetBase = Number(
        getTurnoBase(profile, targetKey)
    ) || TURNO.LIBRE;
    const targetProgrammed = Number(
        getTurnoProgramado(profile, targetKey)
    ) || TURNO.LIBRE;
    const targetActual = Number(
        aplicarCambiosTurno(profile, targetKey, targetProgrammed)
    ) || TURNO.LIBRE;
    const combina24 =
        targetKey !== move.sourceKey &&
        moveShiftTargetCombina24(
            move.destinationTurn,
            targetBase,
            targetProgrammed,
            targetActual
        );
    // Complemento base => dos turnos base => 24 base (sin HHEE).
    // Complemento extra (base libre) => turno base movido + extra => 24 con HHEE.
    const complementoEsBase = combina24 && targetBase !== TURNO.LIBRE;

    if (targetKey !== move.sourceKey) {
        data[move.sourceKey] = TURNO.LIBRE;
        baseData[move.sourceKey] = TURNO.LIBRE;
        blocked[move.sourceKey] = true;
    }

    if (combina24) {
        data[targetKey] = TURNO.TURNO24;
        baseData[targetKey] = complementoEsBase
            ? TURNO.TURNO24
            : move.destinationTurn;
    } else {
        data[targetKey] = move.destinationTurn;
        baseData[targetKey] = move.destinationTurn;
    }
    blocked[targetKey] = true;

    saveProfileData(data, profile);
    saveBaseProfileData(baseData, profile);
    saveBlockedDays(blocked, profile);
    registerShiftMove({
        profile,
        sourceKey: move.sourceKey,
        targetKey,
        sourceTurn: move.sourceTurn,
        destinationTurn: move.destinationTurn
    });

    const sourceDate = parseKey(move.sourceKey);
    const targetDate = parseKey(targetKey);
    const sourceLabel = Number.isNaN(sourceDate.getTime())
        ? move.sourceKey
        : formatDisplayDate(toISODate(sourceDate));
    const targetLabel = Number.isNaN(targetDate.getTime())
        ? targetKey
        : formatDisplayDate(toISODate(targetDate));

    const auditDescription = (() => {
        if (targetKey === move.sourceKey) {
            return `${profile}: cambio el turno base del ${sourceLabel} de ${shiftMoveTurnLabel(move.sourceTurn)} a ${shiftMoveTurnLabel(move.destinationTurn)}.`;
        }

        const base = `${profile}: movio el turno base ${shiftMoveTurnLabel(move.sourceTurn)} del ${sourceLabel} al ${targetLabel} como ${shiftMoveTurnLabel(move.destinationTurn)}`;

        if (combina24) {
            return `${base}, juntandose con el turno ${shiftMoveTurnLabel(targetProgrammed)} existente y formando un 24 (${complementoEsBase ? "dos turnos base" : "turno base + extra"}).`;
        }

        return `${base}.`;
    })();

    addAuditLog(
        AUDIT_CATEGORY.CALENDAR,
        "Movio turno base",
        auditDescription,
        {
            profile,
            sourceKey: move.sourceKey,
            targetKey,
            sourceTurn: move.sourceTurn,
            destinationTurn: move.destinationTurn,
            combinedInto24: combina24,
            combinedBaseComplement: complementoEsBase
        }
    );

    clearSelectionMode();
}

function startCreateMode() {
    if (!canEditCurrentProfileMenu()) return;

    clearSelectionMode(false);
    resetProfileDraft();
    availabilityEditMode = true;
    createAvailabilityBalances =
        defaultCreateAvailabilityBalances();
    profileRotationMiniDate = new Date();

    profileDraft.mode = PROFILE_MODE.CREATE;
    setCurrentProfile(null);

    renderProfiles();
    renderBotones();
    refreshAll();
    setActiveShortcut("profileSection");
    DOM.profileNameInput.focus();
}

function startEditMode() {
    if (!canEditCurrentProfileMenu()) return;

    const profile = getPerfilActual();
    if (!profile) return;

    clearSelectionMode(false);
    createAvailabilityBalances = null;
    availabilityEditMode = true;
    loadDraftFromProfile(profile);
    profileRotationMiniDate = profileDraft.rotationStart
        ? parseInputDate(profileDraft.rotationStart)
        : new Date();
    profileDraft.mode = PROFILE_MODE.EDIT;

    renderDashboardState();
    renderBotones();
    refreshAll();
    setActiveShortcut("profileSection");
    DOM.profileNameInput.focus();
    DOM.profileNameInput.select();
}

function startReplacementContractEdit(profileName, keyDay) {
    if (!canEditCurrentProfileMenu()) return;

    const profile = getProfiles().find(item =>
        item.name === profileName
    );

    if (!profile) return;

    clearSelectionMode(false);
    availabilityEditMode = false;
    setCurrentProfile(profileName);
    loadDraftFromProfile(profile);
    profileDraft.mode = PROFILE_MODE.EDIT;
    profileDraft.contractType = "Reemplazo";
    profileDraft.rotationType =
        profileDraft.rotationType === "libre"
            ? "libre"
            : "";
    profileDraft.rotationStart = "";
    profileDraft.shiftAssigned = false;
    replacementContractMonthHint =
        calendarKeyToInputDate(keyDay);
    profileDraft.contractStart = "";
    profileDraft.contractEnd = "";
    profileDraft.contractReplaces = "";
    profileDraft.contractReason = "";
    profileDraft.contractLeaveRef = "";
    profileDraft.contractRotationMode =
        REPLACEMENT_ROTATION_MODE.INHERIT;
    profileRotationMiniDate = parseKey(keyDay);

    renderProfiles();
    renderBotones();
    refreshAll();
    setActiveShortcut("profileSection");

    openRotationConfigModal("reemplazo");
}

window.startReplacementContractEdit =
    startReplacementContractEdit;

function exitProfileMode(selectedName = getCurrentProfile()) {
    clearSelectionMode(false);
    resetProfileDraft();
    availabilityEditMode = false;
    createAvailabilityBalances = null;
    profileDraft.mode = PROFILE_MODE.VIEW;

    setCurrentProfile(selectedName || null);
    renderProfiles();
    renderBotones();
}

function handleRotationSelectionChange() {
    if (!isProfileEditing()) return;

    profileDraft.rotationType =
        DOM.profileRotationSelect.value;
    if (
        profileDraft.rotationType !== "3turno" &&
        profileDraft.rotationType !== "4turno"
    ) {
        profileDraft.shiftAssigned = false;
    }
    profileDraft.rotationStart = "";
    profileDraft.rotationFirstTurn = "larga";

    if (!isReplacementDraft()) {
        profileDraft.contractStart = "";
        profileDraft.contractEnd = "";
        profileDraft.contractReplaces = "";
        profileDraft.contractReason = "";
        profileDraft.contractLeaveRef = "";
    }

    if (!profileDraft.rotationType) {
        clearSelectionMode(false);
        refreshAll();
        return;
    }

    renderDashboardState();
    setActiveShortcut("profileSection");

    if (profileDraft.rotationType === "libre") {
        return;
    }

    // La fecha de ingreso a la unidad ya NO es obligatoria para configurar la
    // rotativa. Si existe, el calendario de la rotativa se abre en esa fecha
    // (getRotationConfigDefaultStart); si no, se abre en el mes actual.
    if (
        isHonorariaDraft() &&
        (
            !profileDraft.honorariaStart ||
            !profileDraft.honorariaEnd
        )
    ) {
        alert("Completa primero las fechas del contrato de Honorarios para configurar la rotativa.");
        return;
    }

    replacementContractMonthHint = "";
    openRotationConfigModal(profileDraft.rotationType);
}

function validateDraft() {
    const result = validateProfileDraft();

    if (result.ok) return true;

    alert(result.message);

    if (result.focusRut) {
        DOM.profileRutInput.focus();
        DOM.profileRutInput.select();
        syncRutValidity(true);
    }

    if (result.focusEmail) {
        DOM.profileEmailInput.focus();
        DOM.profileEmailInput.select();
        syncEmailValidity(true);
    }

    return false;
}

function normalizeProfileEmailKey(value) {
    return String(value || "").trim().toLowerCase();
}

async function workspaceMemberEmailKeys() {
    const keys = new Set();
    const currentUser = getCurrentFirebaseUser();
    const currentUserEmail = normalizeProfileEmailKey(currentUser?.email);

    if (currentUserEmail) {
        keys.add(currentUserEmail);
    }

    const workspace = getActiveWorkspace();

    if (!workspace?.id) return keys;

    try {
        const members = await listWorkspaceMembersForPermissions(workspace);

        members.forEach(member => {
            const email = normalizeProfileEmailKey(member.email);

            if (email) keys.add(email);
        });
    } catch (error) {
        console.warn(
            "No se pudo validar correos de administradores de la unidad.",
            error
        );
    }

    return keys;
}

async function validateProfileEmailPolicy({
    nextEmailKey,
    nextName,
    originalName = ""
}) {
    if (!nextEmailKey) return true;

    const duplicateProfile = getProfiles().find(profile =>
        profile.name !== originalName &&
        normalizeProfileEmailKey(profile.email) === nextEmailKey
    );

    if (!duplicateProfile) return true;

    const privilegedEmails = await workspaceMemberEmailKeys();

    if (privilegedEmails.has(nextEmailKey)) {
        return true;
    }

    alert(
        `Ya existe un trabajador creado con ese correo (${duplicateProfile.name}). Cada trabajador debe tener un correo distinto.`
    );

    return false;
}

async function validateProfileSavePreflight({
    isCreating,
    isEditing,
    nextName,
    nextEmailKey
}) {
    const profiles = getProfiles();
    const originalName = isEditing
        ? profileDraft.originalName
        : "";
    const nameExists = profiles.some(profile =>
        profile.name !== originalName &&
        profile.name === nextName
    );

    if ((isCreating || isEditing) && nameExists) {
        alert("Ese perfil ya existe.");
        return false;
    }

    return validateProfileEmailPolicy({
        nextEmailKey,
        nextName,
        originalName
    });
}

function futureKeys(map, startDate) {
    return Object.keys(map || {}).filter(key =>
        isDateKeyOnOrAfter(key, startDate)
    );
}

function calendarKeyToSafeISO(key) {
    const date = parseKey(key);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return toISODate(date);
}

function firstStoredTurnDateForProfile(profileName) {
    if (!profileName) return "";

    const candidates = [];
    const collect = map => {
        Object.entries(map || {}).forEach(([key, value]) => {
            if ((Number(value) || TURNO.LIBRE) <= TURNO.LIBRE) {
                return;
            }

            const iso = calendarKeyToSafeISO(key);

            if (iso) {
                candidates.push(iso);
            }
        });
    };

    collect(getBaseProfileData(profileName));
    collect(getProfileData(profileName));

    return candidates.sort(compareISODate)[0] || "";
}

async function firstRotationTurnDate(
    rotationType,
    rotationStart,
    firstTurn = "larga"
) {
    const startISO = normalizeStoredStart(rotationStart);

    if (!startISO || !requiresRotationStart(rotationType)) {
        return "";
    }

    if (rotationType === "diurno") {
        const startDate = parseInputDate(startISO);
        const holidays = await fetchHolidays(startDate.getFullYear());
        const day = new Date(startDate);

        while (day.getFullYear() === startDate.getFullYear()) {
            if (isBusinessDay(day, holidays)) {
                return toISODate(day);
            }

            day.setDate(day.getDate() + 1);
        }

        return startISO;
    }

    const sequence = getRotationSequence(rotationType, firstTurn);

    if (!sequence.length) {
        return startISO;
    }

    const firstTurnOffset = sequence.findIndex(turn =>
        (Number(turn) || TURNO.LIBRE) > TURNO.LIBRE
    );

    if (firstTurnOffset <= 0) {
        return startISO;
    }

    const date = parseInputDate(startISO);
    date.setDate(date.getDate() + firstTurnOffset);

    return toISODate(date);
}

async function inferProfileUnitEntryDate({
    profileNames = [],
    rotationType = "",
    rotationStart = "",
    rotationFirstTurn = "larga"
} = {}) {
    const storedDates = [
        ...new Set(profileNames.filter(Boolean))
    ]
        .map(firstStoredTurnDateForProfile)
        .filter(Boolean)
        .sort(compareISODate);

    if (storedDates.length) {
        return storedDates[0];
    }

    return firstRotationTurnDate(
        rotationType,
        rotationStart,
        rotationFirstTurn
    );
}

function pushReturnKey(target, key) {
    const year = key.split("-")[0];

    if (!target[year]) target[year] = [];

    target[year].push(key);
}

async function countBusinessKeys(keys) {
    const holidaysByYear = {};
    let total = 0;

    for (const key of keys) {
        const date = parseKey(key);
        const year = date.getFullYear();

        if (!holidaysByYear[year]) {
            holidaysByYear[year] = await fetchHolidays(year);
        }

        if (isBusinessDay(date, holidaysByYear[year])) {
            total++;
        }
    }

    return total;
}

async function returnBusinessBalances(field, keysByYear) {
    for (const [year, keys] of Object.entries(keysByYear)) {
        const total = await countBusinessKeys(keys);
        incrementManualBalance(field, total, Number(year));
    }
}

function returnAdminBalances(amountByYear) {
    Object.entries(amountByYear).forEach(([year, amount]) => {
        incrementManualBalance("admin", amount, Number(year));
    });
}

function cleanupFutureSwaps(profileName, startISO) {
    const nextSwaps = [];

    getSwaps().forEach(swap => {
        if (cambioEstaAnulado(swap)) {
            nextSwaps.push(swap);
            return;
        }

        if (
            swap.from !== profileName &&
            swap.to !== profileName
        ) {
            nextSwaps.push(swap);
            return;
        }

        const skipFecha =
            Boolean(swap.skipFecha) ||
            (
                swap.fecha &&
                compareISODate(swap.fecha, startISO) >= 0
            );
        const skipDevolucion =
            Boolean(swap.skipDevolucion) ||
            (
                swap.devolucion &&
                compareISODate(swap.devolucion, startISO) >= 0
            );

        if (skipFecha && skipDevolucion) {
            return;
        }

        nextSwaps.push({
            ...swap,
            skipFecha,
            skipDevolucion
        });
    });

    saveSwaps(nextSwaps);
}

async function cleanupFutureSchedule(startDate) {
    const profileName = getCurrentProfile();

    if (!profileName) return;

    const data = getProfileData();
    const baseData = getBaseProfileData();
    const blocked = getBlockedDays();
    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();
    const absences = getAbsences();
    const hourReturns = getHourReturns(profileName);
    const returnedLegal = {};
    const returnedComp = {};
    const returnedAdmin = {};
    const startISO = toISODate(startDate);

    futureKeys(data, startDate).forEach(key => {
        delete data[key];
    });

    futureKeys(baseData, startDate).forEach(key => {
        delete baseData[key];
    });

    futureKeys(blocked, startDate).forEach(key => {
        delete blocked[key];
    });

    futureKeys(legal, startDate).forEach(key => {
        delete legal[key];
        pushReturnKey(returnedLegal, key);
    });

    futureKeys(comp, startDate).forEach(key => {
        delete comp[key];
        pushReturnKey(returnedComp, key);
    });

    futureKeys(admin, startDate).forEach(key => {
        const amount = admin[key] === 1 ? 1 : 0.5;
        const year = key.split("-")[0];

        delete admin[key];
        returnedAdmin[year] =
            (returnedAdmin[year] || 0) + amount;
    });

    futureKeys(absences, startDate).forEach(key => {
        delete absences[key];
    });

    futureKeys(hourReturns, startDate).forEach(key => {
        delete hourReturns[key];
    });

    cleanupFutureSwaps(profileName, startISO);
    cancelFutureShiftMovesForWorker(profileName, startDate);
    cancelFutureReplacementsForWorker(profileName, startISO, {
        reason: "rotation_reset",
        details:
            "Turno extra anulado al aplicar una nueva rotativa desde esta fecha."
    });

    await returnBusinessBalances("legal", returnedLegal);
    await returnBusinessBalances("comp", returnedComp);
    returnAdminBalances(returnedAdmin);

    saveProfileData(data);
    saveBaseProfileData(baseData);
    saveBlockedDays(blocked);
    saveAdminDays(admin);
    saveLegalDays(legal);
    saveCompDays(comp);
    saveAbsences(absences);
    saveHourReturns(profileName, hourReturns);
}

async function applyDraftRotation(
    rotationType,
    rotationStart,
    firstTurn = "larga",
    options = {}
) {
    if (rotationType === "libre") {
        if (options.cleanupStart) {
            await cleanupFutureSchedule(
                parseInputDate(options.cleanupStart)
            );
        }

        refreshAll();
        return;
    }

    const startDate = parseInputDate(rotationStart);

    await cleanupFutureSchedule(startDate);

    if (rotationType === "reemplazo") {
        refreshAll();
        return;
    }

    if (rotationType === "diurno") {
        await aplicarDiurnoDesde(startDate);
        return;
    }

    if (rotationType === "3turno") {
        await aplicarTercerTurnoDesde(startDate, firstTurn);
        return;
    }

    await aplicarCuartoTurnoDesde(startDate, firstTurn);
}

async function requestShiftAssignmentEffectiveMonth(assigned) {
    const action = assigned
        ? "comienza a aplicarse"
        : "deja de aplicarse";
    const title = assigned
        ? "Inicio de asignacion de turno"
        : "Termino de asignacion de turno";

    while (true) {
        const value = await showPrompt(
            `Selecciona el mes desde el cual ${action} la asignacion de turno. El cambio regira desde el dia 1 de ese mes.`,
            {
                title,
                tone: assigned ? "info" : "warning",
                inputType: "month",
                inputLabel: assigned
                    ? "Mes de inicio"
                    : "Primer mes sin asignacion",
                value: toMonthInputValue(new Date()),
                confirmText: "Guardar vigencia"
            }
        );

        if (value === null) return "";

        const month = String(value || "").trim();

        if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
            return month;
        }

        alert("Selecciona un mes valido para la vigencia.");
    }
}

async function guardarPerfil() {
    if (!canEditCurrentProfileMenu()) return;
    if (!validateDraft()) return;

    const isCreating =
        profileDraft.mode === PROFILE_MODE.CREATE;
    const isEditing =
        profileDraft.mode === PROFILE_MODE.EDIT;

    // Gate de plan: impide AGREGAR un trabajador activo mas alla del limite del
    // plan (conteo autoritativo de activos entre todos los entornos del dueno).
    // No bloquea desactivar ni editar trabajadores que ya estaban activos.
    const willBeActive = profileDraft.active !== false;
    const wasActive = isEditing
        ? isProfileActive(profileDraft.originalName)
        : false;

    if (willBeActive && !wasActive) {
        await refreshAccountUsage({ force: true });

        if (!canAddActiveWorker()) {
            const plan = getEffectivePlan();

            alert(
                `Alcanzaste el limite de tu plan ${plan.name} ` +
                `(${plan.maxActiveWorkers} trabajadores activos en total entre tus unidades). ` +
                "Para activar mas, mejora tu plan desde el boton de Planes en la barra superior, " +
                "o desactiva a otro trabajador."
            );
            return;
        }
    }

    const previousSnapshot = isEditing
        ? auditProfileSnapshot(profileDraft.originalName)
        : null;
    const nextName = profileDraft.name.trim();
    const nextEstamento = profileDraft.estamento;
    const nextProfession = normalizeProfession(
        profileDraft.profession,
        nextEstamento
    );
    const replacementContract =
        isReplacementDraft();
    const nextRotationType = replacementContract
        ? (
            profileDraft.originalRotationType === "libre"
                ? "libre"
                : ""
        )
        : profileDraft.rotationType;
    const nextShiftAssigned =
        (
            nextRotationType === "3turno" ||
            nextRotationType === "4turno"
        ) &&
        Boolean(profileDraft.shiftAssigned);
    const previousShiftAssigned = isEditing
        ? getShiftAssignmentConfiguredState(
            profileDraft.originalName
        )
        : false;
    const shiftAssignmentChanged =
        previousShiftAssigned !== nextShiftAssigned;
    const nextRotationStart =
        replacementContract ||
        nextRotationType === "libre"
            ? ""
            : profileDraft.rotationStart;
    const nextRotationFirstTurn =
        normalizeRotationFirstTurnForType(
            nextRotationType,
            profileDraft.rotationFirstTurn
        );
    const nextUnitEntryDate = isUnitEntryDateEnabled()
        ? (
            normalizeStoredStart(profileDraft.unitEntryDate) ||
            await inferProfileUnitEntryDate({
                profileNames: [
                    profileDraft.originalName,
                    nextName
                ],
                rotationType: nextRotationType,
                rotationStart: nextRotationStart,
                rotationFirstTurn: nextRotationFirstTurn
            })
        )
        : "";
    const nextProfilePayload = {
        name: nextName,
        email: profileDraft.email.trim(),
        rut: formatRut(profileDraft.rut),
        phone: sanitizeDigits(profileDraft.phone, 8),
        birthDate: profileDraft.birthDate,
        docs: Array.isArray(profileDraft.docs)
            ? [...profileDraft.docs]
            : [],
        active: profileDraft.active !== false,
        unitEntryDate: nextUnitEntryDate,
        contractType: profileDraft.contractType,
        honorariaStart: isHonorariaDraft()
            ? profileDraft.honorariaStart
            : "",
        honorariaEnd: isHonorariaDraft()
            ? profileDraft.honorariaEnd
            : "",
        honorariaHourlyRate: isHonorariaDraft()
            ? Number(profileDraft.honorariaHourlyRate) || 0
            : 0,
        honorariaMaxMonthlyHours: isHonorariaDraft()
            ? Number(profileDraft.honorariaMaxMonthlyHours) || 0
            : 0,
        unionLeaveEnabled:
            !replacementContract &&
            Boolean(profileDraft.unionLeaveEnabled),
        estamento: nextEstamento,
        profession: nextProfession,
        grade: profileDraft.grade
    };
    const nextEmailKey =
        nextProfilePayload.email.toLowerCase();
    const previousEmailKey = String(
        previousSnapshot?.email || ""
    ).trim().toLowerCase();
    const emailChanged =
        isEditing &&
        nextEmailKey !== previousEmailKey;
    const previousWorkerAppLink =
        emailChanged && nextEmailKey
            ? getWorkerAppLinkForProfile(
                profileDraft.originalName
            )
            : null;
    const shouldReplaceWorkerAppLink =
        Boolean(
            previousWorkerAppLink?.uid &&
            nextEmailKey &&
            nextProfilePayload.active
        );
    const shouldSendAutomaticWorkerInvite =
        Boolean(nextEmailKey) &&
        nextProfilePayload.active &&
        (
            isCreating ||
            emailChanged
        );
    const shouldApplyRotation =
        !replacementContract &&
        (
            profileDraft.mode === PROFILE_MODE.CREATE ||
            hasRotationChanged()
        );
    const rotationCleanupStart =
        nextRotationType === "libre" &&
        isHonorariaDraft()
            ? profileDraft.honorariaStart
            : "";
    const shouldSaveReplacementContract =
        replacementContract &&
        requiresReplacementContract();
    const nextSnapshot = {
        ...nextProfilePayload,
        shiftAssigned: nextShiftAssigned,
        rotativa: {
            type: nextRotationType,
            start: nextRotationStart,
            firstTurn: nextRotationFirstTurn
        }
    };
    let gradeEffectiveDate = "";
    let shiftAssignmentEffectiveMonth = "";

    if (
        !await validateProfileSavePreflight({
            isCreating,
            isEditing,
            nextName,
            nextEmailKey
        })
    ) {
        return;
    }

    if (shiftAssignmentChanged) {
        shiftAssignmentEffectiveMonth =
            await requestShiftAssignmentEffectiveMonth(
                nextShiftAssigned
            );

        if (!shiftAssignmentEffectiveMonth) {
            return;
        }
    }

    if (isEditing && hasGradeValueChanged()) {
        gradeEffectiveDate =
            await requestGradeEffectiveDate(
                previousSnapshot,
                nextProfilePayload
            );

        if (!gradeEffectiveDate) {
            return;
        }
    }

    if (
        shouldReplaceWorkerAppLink &&
        !await showConfirm(
            `Al modificar el correo de ${nextName}, se desenlazará la PWA asociada a ${previousSnapshot.email || "su correo anterior"}.\n\nEl funcionario deberá volver a enlazarse con la invitación que se enviará a ${nextProfilePayload.email}.`,
            {
                title: "Cambiar correo enlazado",
                tone: "warning",
                confirmText: "Cambiar y reenlazar"
            }
        )
    ) {
        return;
    }

    let automaticInviteResult = null;

    try {
        if (shouldReplaceWorkerAppLink) {
            automaticInviteResult =
                await sendWorkerAppInviteEmail({
                    ...nextProfilePayload,
                    name: nextName
                }, {
                    replaceLink: previousWorkerAppLink
                });

            if (!automaticInviteResult.sent) {
                throw new Error(
                    "No se pudo reemplazar el enlace de la PWA. El correo no fue modificado y la cuenta anterior conserva su acceso."
                );
            }
        }

        if (isCreating) {
            const profiles = getProfiles();

            if (
                profiles.some(
                    profile => profile.name === nextName
                )
            ) {
                alert("Ese perfil ya existe.");
                return;
            }

            profiles.push(nextProfilePayload);

            saveProfiles(profiles);
            setCurrentProfile(nextName);
            initializeGradeHistory(
                nextName,
                nextProfilePayload,
                nextRotationStart ||
                    nextUnitEntryDate ||
                    toInputDate(new Date())
            );
        }

        if (isEditing) {
            updateProfile(
                profileDraft.originalName,
                nextProfilePayload
            );

            setCurrentProfile(nextName);

            if (gradeEffectiveDate) {
                recordGradeHistoryChange(
                    nextName,
                    previousSnapshot,
                    nextProfilePayload,
                    gradeEffectiveDate
                );
            }

            recordProfileContractHistory(
                nextName,
                previousSnapshot,
                nextSnapshot,
                gradeEffectiveDate
            );
        }

        if (shiftAssignmentChanged) {
            recordShiftAssignmentChange(
                nextShiftAssigned,
                shiftAssignmentEffectiveMonth,
                nextName
            );
            addAuditLog(
                AUDIT_CATEGORY.COLLABORATOR_UPDATED,
                nextShiftAssigned
                    ? "Programo asignacion de turno"
                    : "Programo termino de asignacion de turno",
                `${nextName}: asignacion de turno ${nextShiftAssigned ? "activa" : "inactiva"} desde ${shiftAssignmentEffectiveMonth}.`,
                {
                    profile: nextName,
                    assigned: nextShiftAssigned,
                    effectiveMonth: shiftAssignmentEffectiveMonth
                }
            );
        } else if (isCreating) {
            setShiftAssigned(false, nextName);
        }
        saveRotativa({
            type: nextRotationType,
            start: nextRotationStart,
            firstTurn: nextRotationFirstTurn
        });

        if (isEditing) {
            syncStaffingConfigForProfileChange(
                previousSnapshot,
                nextSnapshot
            );
        }

        if (shouldSaveReplacementContract) {
            const replacementContract = addReplacementContract(nextName, {
                start: profileDraft.contractStart,
                end: profileDraft.contractEnd,
                replaces:
                    profileDraft.contractReplaces.trim(),
                reason: profileDraft.contractReason,
                leaveRef: profileDraft.contractLeaveRef,
                leaveType: profileDraft.contractReason,
                leaveStart: profileDraft.contractStart,
                leaveEnd: profileDraft.contractEnd,
                rotationMode: profileDraft.contractRotationMode
            });

            createReplacementContractMemoTask({
                profile: nextName,
                contract: replacementContract
            });
        }

        if (
            (isCreating || isEditing) &&
            availabilityEditMode
        ) {
            saveAvailabilityBalancesFromInputs(nextName);
        }

        if (isCreating) {
            addAuditLog(
                AUDIT_CATEGORY.COLLABORATOR_CREATED,
                "Creo nuevo colaborador",
                `${nextName} (${nextEstamento}) con rotativa ${getRotativaLabel(nextRotationType)}.`,
                { profile: nextName }
            );
        }

        if (isEditing) {
            addAuditLog(
                AUDIT_CATEGORY.COLLABORATOR_UPDATED,
                "Modifico datos del colaborador",
                `${profileDraft.originalName} -> ${nextName}. ${describeProfileChanges(previousSnapshot, nextSnapshot)}`,
                { profile: nextName }
            );

            if (
                previousSnapshot &&
                previousSnapshot.active !== nextProfilePayload.active
            ) {
                addAuditLog(
                    AUDIT_CATEGORY.PROFILE_STATUS,
                    nextProfilePayload.active
                        ? "Reactivo perfil"
                        : "Inactivo perfil",
                    `${nextName} quedo ${activeLabel(nextProfilePayload.active)}.`,
                    { profile: nextName }
                );

                if (!nextProfilePayload.active) {
                    void unlinkWorkerAppForProfile(nextName);
                }
            }
        }

        if (
            shouldSendAutomaticWorkerInvite &&
            !automaticInviteResult
        ) {
            automaticInviteResult =
                await sendWorkerAppInviteEmail({
                    ...nextProfilePayload,
                    name: nextName
                }, {
                    ignoreExistingLink:
                        shouldReplaceWorkerAppLink
                });

            if (automaticInviteResult.sent) {
                addAuditLog(
                    AUDIT_CATEGORY.COLLABORATOR_UPDATED,
                    "Envio invitacion app trabajador",
                    `${nextName}: se envio automaticamente la invitacion de enlace a ${automaticInviteResult.email}.`,
                    {
                        profile: nextName,
                        email: automaticInviteResult.email,
                        automatic: true
                    }
                );
            }
        }

        if (
            shouldReplaceWorkerAppLink &&
            automaticInviteResult?.sent
        ) {
            addAuditLog(
                AUDIT_CATEGORY.COLLABORATOR_UPDATED,
                "Reemplazo enlace app trabajador",
                `${nextName}: se revoco el enlace asociado a ${previousSnapshot.email || "correo anterior"} y se envio una nueva invitacion para ${nextProfilePayload.email}.`,
                {
                    profile: nextName,
                    previousEmail:
                        previousSnapshot.email || "",
                    email: nextProfilePayload.email,
                    previousWorkerUid:
                        previousWorkerAppLink.uid || ""
                }
            );
        }

        exitProfileMode(nextName);
        if (shouldApplyRotation) {
            await applyDraftRotation(
                nextRotationType,
                nextRotationStart,
                nextRotationFirstTurn,
                {
                    cleanupStart: rotationCleanupStart
                }
            );

            const rotationDateText = nextRotationStart
                ? ` desde ${formatDisplayDate(nextRotationStart)}`
                : "";
            const rotationAuditSuffix =
                nextRotationType === "libre"
                    ? ". Calendario base libre para carga manual."
                    : ". Se limpiaron programaciones futuras desde esa fecha.";

            addAuditLog(
                AUDIT_CATEGORY.CALENDAR,
                "Aplic\u00f3 rotativa base",
                `${nextName}: ${getRotativaLabel(nextRotationType)}${rotationDateText}${requiresRotationFirstTurn(nextRotationType) ? ` iniciando con ${getRotationFirstTurnLabel(nextRotationFirstTurn, nextRotationType)}` : ""}${rotationAuditSuffix}`,
                {
                    profile: nextName,
                    date: nextRotationStart,
                    rotationType: nextRotationType,
                    firstTurn: nextRotationFirstTurn
                }
            );
        }
        refreshAll();
        scheduleWorkerAppDataPublish(300, nextName);

        if (automaticInviteResult?.status === "error") {
            alert(
                `El perfil de ${nextName} se guardo, pero no se pudo enviar la invitacion al correo ${nextProfilePayload.email}. Puedes reintentarlo con ENLACE APP.`
            );
        }
    } catch (error) {
        alert(
            error.message ||
            "No se pudo guardar el colaborador."
        );
    }
}

function handleAvailabilityEdit() {
    const profile = getPerfilActual();

    if (!profile) return;
    if (!isProfileActive(profile)) {
        alert("No se pueden editar saldos en un perfil desactivado.");
        return;
    }

    if (!availabilityEditMode) {
        availabilityEditMode = true;
        renderDisponibilidadVacaciones();
        document
            .getElementById("availabilityLegalInput")
            ?.focus();
        return;
    }

    const year = new Date().getFullYear();
    const balances = {
        legal: normalizeLegalBalanceValue(
            document.getElementById("availabilityLegalInput")?.value
        ),
        admin: normalizeBalanceValue(
            document.getElementById("availabilityAdminInput")?.value
        ),
        hoursReturn: normalizeBalanceValue(
            document.getElementById("availabilityHoursReturnInput")?.value
        )
    };
    const compBalance =
        readCompBalanceFromInput(year);

    if (compBalance.hasInput) {
        balances.comp = compBalance.balance;
    }

    saveManualLeaveBalances(year, balances, profile.name);
    addAuditLog(
        AUDIT_CATEGORY.LEAVE_ABSENCE,
        "Modifico saldos de vacaciones",
        `${profile.name}: FL ${formatSaldo(balances.legal)}, ADM ${formatSaldo(balances.admin)}${balances.comp !== undefined ? `, FC ${formatSaldo(balances.comp)}` : ""}, Devolucion de horas ${formatSaldo(balances.hoursReturn)}.`,
        {
            profile: profile.name,
            year
        }
    );

    availabilityEditMode = false;
    renderDisponibilidadVacaciones();

    if (document.body.dataset.activeView === "hours") {
        void renderProfileHoursSummary(profile);
    }

    scheduleWorkerAppDataPublish(300, profile.name);
}

function saveAvailabilityBalancesFromInputs(profileName) {
    const legalInput =
        document.getElementById("availabilityLegalInput");
    const adminInput =
        document.getElementById("availabilityAdminInput");
    const hoursReturnInput =
        document.getElementById("availabilityHoursReturnInput");

    if (!profileName || !legalInput || !adminInput || !hoursReturnInput) {
        return false;
    }

    const year = new Date().getFullYear();
    const previous = getManualLeaveBalances(year, profileName);
    const balances = {
        legal: normalizeLegalBalanceValue(legalInput.value),
        admin: normalizeBalanceValue(adminInput.value),
        hoursReturn: normalizeBalanceValue(hoursReturnInput.value)
    };
    const compBalance =
        readCompBalanceFromInput(year);

    if (compBalance.hasInput) {
        balances.comp = compBalance.balance;
    } else if (
        profileDraft.mode === PROFILE_MODE.CREATE &&
        createAvailabilityBalances
    ) {
        balances.comp = compBalanceFromEntitlement(
            createAvailabilityBalances.comp,
            year
        );
    }

    const changed =
        Number(previous.legal) !== Number(balances.legal) ||
        Number(previous.admin) !== Number(balances.admin) ||
        Number(previous.hoursReturn || 0) !==
            Number(balances.hoursReturn) ||
        (
            balances.comp !== undefined &&
            Number(previous.comp) !== Number(balances.comp)
        );

    saveManualLeaveBalances(year, balances, profileName);

    if (changed) {
        addAuditLog(
            AUDIT_CATEGORY.LEAVE_ABSENCE,
            "Modifico saldos de vacaciones",
            `${profileName}: FL ${formatSaldo(balances.legal)}, ADM ${formatSaldo(balances.admin)}${balances.comp !== undefined ? `, FC ${formatSaldo(balances.comp)}` : ""}, Devolucion de horas ${formatSaldo(balances.hoursReturn)}.`,
            {
                profile: profileName,
                year
            }
        );
    }

    return changed;
}

async function activarSelectorLegal() {
    if (!canModifyCurrentProfile()) return;

    const year = new Date().getFullYear();
    const holidays = await fetchHolidays(year);
    const saldo = getLeaveBalances(year, holidays).legal;

    if (saldo <= 0) {
        alert("No quedan d\u00edas de feriado legal.");
        return;
    }

    const debeAplicarBloque10 =
        Number(saldo) === 10 &&
        !await existeBloque10Legal(year);

    if (debeAplicarBloque10) {
        legalCantidad = 10;
        window.legalCantidad = 10;

        activarModo(
            "legal",
            "Selecciona un d\u00eda h\u00e1bil para iniciar el bloque continuo obligatorio de 10 d\u00edas de F. Legal. Los d\u00edas inh\u00e1biles y ausencias incompatibles quedar\u00e1n bloqueados."
        );
        return;
    }

    const cantidad = await openAmountDialog({
        title: "F. Legal",
        subtitle: "Indica cu\u00e1ntos d\u00edas de feriado legal deseas cargar.",
        label: "D\u00edas de F. Legal",
        max: saldo,
        confirmText: "Continuar"
    });

    if (!cantidad || cantidad <= 0) return;

    const validacion =
        await validarCantidadLegalAnual(cantidad, year);

    if (!validacion.ok) {
        alert(validacion.message);
        return;
    }

    legalCantidad = cantidad;
    window.legalCantidad = cantidad;

    activarModo(
        "legal",
        "Selecciona un d\u00eda h\u00e1bil para iniciar el feriado legal. Los d\u00edas inh\u00e1biles y ausencias incompatibles quedar\u00e1n bloqueados."
    );
}

function activarSelectorComp() {
    if (!canModifyCurrentProfile()) return;

    const saldo = getLeaveBalances().comp;
    const cantidad = Number(saldo);

    if (saldo <= 0) {
        alert("No quedan feriados compensatorios disponibles.");
        return;
    }

    if (
        !Number.isInteger(cantidad) ||
        !isCompensatoryBlockAmount(cantidad)
    ) {
        alert("El F. Compensatorio solo se puede aplicar como bloque completo de 10 o 20 dias habiles. Ajusta el cupo anual en el perfil del trabajador si corresponde.");
        return;
    }

    if (!getShiftAssigned(getCurrentProfile(), currentDate)) {
        alert("Solo disponible con asignacion de turno activa.");
        return;
    }

    compCantidad = cantidad;
    window.compCantidad = cantidad;

    activarModo(
        "comp",
        `Selecciona un d\u00eda h\u00e1bil para iniciar el bloque completo de ${formatSaldo(cantidad)} F. Compensatorio. Deben haber pasado 90 d\u00edas corridos desde el \u00faltimo F. Legal.`
    );
}

function openAmountDialog({
    title,
    subtitle,
    label = "Cantidad de d\u00edas",
    max = null,
    min = 1,
    step = 1,
    confirmText = "Continuar"
}) {
    return new Promise(resolve => {
        const backdrop = document.createElement("div");
        const maxAttribute = max !== null
            ? `max="${Number(max)}"`
            : "";
        const hint = max !== null
            ? `<small>Disponibles: ${formatSaldo(max)}</small>`
            : "";

        backdrop.className = "turn-change-dialog-backdrop";
        backdrop.innerHTML = `
            <form class="turn-change-dialog amount-dialog" role="dialog" aria-modal="true">
                <strong>${title}</strong>
                <p>${subtitle}</p>
                <label class="amount-dialog-field">
                    <span>${label}</span>
                    <input
                        name="amount"
                        type="number"
                        min="${Number(min)}"
                        step="${Number(step)}"
                        ${maxAttribute}
                        required
                    >
                    ${hint}
                </label>
                <div class="turn-change-dialog__actions">
                    <button class="primary-button" type="submit">
                        ${confirmText}
                    </button>
                    <button class="secondary-button" type="button" data-action="cancel">
                        Cancelar
                    </button>
                </div>
            </form>
        `;

        const dialog = backdrop.querySelector("form");
        const input = dialog.querySelector("[name='amount']");
        const close = value => {
            document.removeEventListener("keydown", onKeydown);
            backdrop.remove();
            resolve(value);
        };
        const onKeydown = event => {
            if (event.key === "Escape") {
                close(null);
            }
        };

        dialog
            .querySelector("[data-action='cancel']")
            .onclick = () => close(null);

        dialog.onsubmit = event => {
            event.preventDefault();

            const value = Number(input.value);

            if (!value || value < Number(min)) {
                alert("Ingresa una cantidad valida.");
                input.focus();
                return;
            }

            if (max !== null && value > Number(max)) {
                alert(`La cantidad no puede superar el saldo disponible (${formatSaldo(max)}).`);
                input.focus();
                return;
            }

            close(value);
        };

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) {
                close(null);
            }
        });

        document.addEventListener("keydown", onKeydown);
        document.body.appendChild(backdrop);
        input.focus();
    });
}

function buildHourReturnRecord({
    profile,
    keyDay,
    segment,
    fullTurn,
    entry,
    exit,
    hours
}) {
    return {
        profile,
        keyDay,
        segmentId: String(segment.id || ""),
        segmentLabel: segment.label || turnoLabel(getTurnoBase(profile, keyDay)),
        fullTurn,
        entryTime: fullTurn ? "" : formatReturnTime(entry),
        exitTime: fullTurn ? "" : formatReturnTime(exit),
        scheduledStart: formatReturnTime(segment.start),
        scheduledEnd: formatReturnTime(segment.end),
        hours: roundReturnHours(hours)
    };
}

function openHoursReturnDialog({
    profile,
    keyDay,
    date,
    segments,
    balance
}) {
    return new Promise(resolve => {
        const normalizedSegments = segments.map((segment, index) => ({
            ...segment,
            id: getReturnSegmentId(segment, index)
        }));
        const backdrop = document.createElement("div");

        backdrop.className = "turn-change-dialog-backdrop";
        backdrop.innerHTML = `
            <form class="turn-change-dialog hours-return-dialog" role="dialog" aria-modal="true">
                <strong>Devoluci&oacute;n de horas</strong>
                <p>
                    Ajusta solo la entrada o salida del turno seleccionado.
                    Saldo disponible: ${formatSaldo(balance)} hrs.
                </p>

                ${normalizedSegments.length > 1 ? `
                    <label class="hours-return-field">
                        <span>Turno</span>
                        <select name="segment">
                            ${normalizedSegments.map(segment => `
                                <option value="${escapeHTML(segment.id)}">
                                    ${escapeHTML(segment.label || "Turno")}
                                </option>
                            `).join("")}
                        </select>
                    </label>
                ` : `
                    <input name="segment" type="hidden" value="${escapeHTML(normalizedSegments[0].id)}">
                `}

                <div class="hours-return-summary" data-summary></div>

                <div class="hours-return-row">
                    <label class="hours-return-field">
                        <span>Entrada</span>
                        <input name="entryTime" type="time" required>
                    </label>
                    <label class="hours-return-field">
                        <span>Salida</span>
                        <input name="exitTime" type="time" required>
                    </label>
                </div>

                <div class="hours-return-result" data-result>
                    Horas a devolver: 0
                </div>

                <button class="hours-return-full-button" type="button" data-action="full-turn">
                    Todo el Turno
                </button>

                <div class="turn-change-dialog__actions">
                    <button class="primary-button" type="submit">
                        Aplicar
                    </button>
                    <button class="secondary-button" type="button" data-action="cancel">
                        Cancelar
                    </button>
                </div>
            </form>
        `;

        const dialog = backdrop.querySelector("form");
        const segmentInput = dialog.elements.segment;
        const entryInput = dialog.elements.entryTime;
        const exitInput = dialog.elements.exitTime;
        const summary = dialog.querySelector("[data-summary]");
        const result = dialog.querySelector("[data-result]");
        const fullButton =
            dialog.querySelector("[data-action='full-turn']");

        const getSelectedSegment = () => {
            const selectedId = segmentInput.value;

            return normalizedSegments.find(segment =>
                segment.id === selectedId
            ) || normalizedSegments[0];
        };

        const close = value => {
            document.removeEventListener("keydown", onKeydown);
            backdrop.remove();
            resolve(value);
        };

        const onKeydown = event => {
            if (event.key === "Escape") {
                close(null);
            }
        };

        const computeCurrent = ({ silent = true } = {}) => {
            const segment = getSelectedSegment();
            const entry = timeNearReturnReference(
                date,
                entryInput.value,
                segment.start
            );
            const exit = timeNearReturnReference(
                date,
                exitInput.value,
                segment.end
            );

            if (!entry || !exit) {
                return null;
            }

            if (entry < segment.start) {
                if (!silent) {
                    alert("La entrada no puede ser anterior al horario del turno.");
                    entryInput.focus();
                }
                return null;
            }

            if (exit > segment.end) {
                if (!silent) {
                    alert("La salida no puede ser posterior al horario del turno.");
                    exitInput.focus();
                }
                return null;
            }

            if (entry > exit) {
                if (!silent) {
                    alert("La entrada no puede quedar despues de la salida.");
                    entryInput.focus();
                }
                return null;
            }

            const fullHours = getSegmentReturnHours(segment);
            const hours = roundReturnHours(
                returnHoursBetween(segment.start, entry) +
                returnHoursBetween(exit, segment.end)
            );
            const fullTurn = hours >= fullHours;

            return {
                segment,
                entry,
                exit,
                fullHours,
                hours,
                fullTurn
            };
        };

        const syncDialog = () => {
            const segment = getSelectedSegment();
            const fullHours = getSegmentReturnHours(segment);
            const enoughForFullTurn =
                Number(balance) >= Number(fullHours);
            const current = computeCurrent();

            summary.innerHTML = `
                <span>${escapeHTML(segment.label || "Turno")}</span>
                <strong>
                    ${formatReturnDateTime(segment.start)}
                    -
                    ${formatReturnDateTime(segment.end)}
                </strong>
                <small>Duraci&oacute;n: ${formatSaldo(fullHours)} hrs.</small>
            `;

            fullButton.disabled = !enoughForFullTurn;
            fullButton.title = enoughForFullTurn
                ? "Cubrir todo el turno con devoluci\u00f3n de horas."
                : "Saldo insuficiente para cubrir todo el turno.";

            if (!current) {
                result.textContent = "Horas a devolver: 0";
                result.classList.remove("is-invalid");
                return;
            }

            result.textContent =
                `Horas a devolver: ${formatSaldo(current.hours)} de ${formatSaldo(balance)} hrs.`;
            result.classList.toggle(
                "is-invalid",
                current.hours > balance
            );
        };

        const syncSegmentDefaults = () => {
            const segment = getSelectedSegment();

            entryInput.value = formatReturnTime(segment.start);
            exitInput.value = formatReturnTime(segment.end);
            syncDialog();
        };

        dialog
            .querySelector("[data-action='cancel']")
            .onclick = () => close(null);

        fullButton.onclick = () => {
            const segment = getSelectedSegment();
            const fullHours = getSegmentReturnHours(segment);

            if (balance < fullHours) return;

            close(buildHourReturnRecord({
                profile,
                keyDay,
                segment,
                fullTurn: true,
                entry: cloneReturnDate(segment.end),
                exit: cloneReturnDate(segment.start),
                hours: fullHours
            }));
        };

        dialog.onsubmit = event => {
            event.preventDefault();

            const current = computeCurrent({ silent: false });

            if (!current) return;

            if (current.hours <= 0) {
                alert("Modifica la entrada o salida para usar horas de devoluci\u00f3n.");
                entryInput.focus();
                return;
            }

            if (current.hours > balance) {
                alert(
                    `No puedes usar mas horas que el saldo disponible (${formatSaldo(balance)} hrs.).`
                );
                entryInput.focus();
                return;
            }

            close(buildHourReturnRecord({
                profile,
                keyDay,
                segment: current.segment,
                fullTurn: current.fullTurn,
                entry: current.entry,
                exit: current.exit,
                hours: current.hours
            }));
        };

        if (segmentInput) {
            segmentInput.onchange = syncSegmentDefaults;
        }

        entryInput.oninput = syncDialog;
        exitInput.oninput = syncDialog;

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) {
                close(null);
            }
        });

        document.addEventListener("keydown", onKeydown);
        document.body.appendChild(backdrop);
        syncSegmentDefaults();
        entryInput.focus();
    });
}

async function activarSelectorLicencia(type = "license") {
    if (!canModifyCurrentProfile()) return;

    if (
        type === "union_leave" &&
        !getPerfilActual()?.unionLeaveEnabled
    ) {
        alert("Este trabajador no tiene habilitado Permiso Gremial en su perfil.");
        return;
    }

    const label = getLicenseTypeLabel(type);
    const cantidad = await openAmountDialog({
        title: label,
        subtitle: "Indica cu\u00e1ntos d\u00edas corridos dura la ausencia.",
        label: "D\u00edas corridos",
        confirmText: "Continuar"
    });

    if (!cantidad || cantidad <= 0) return;

    licenseCantidad = cantidad;
    licenseType = type;
    window.licenseCantidad = cantidad;
    window.licenseType = type;

    activarModo(
        "license",
        `Selecciona el inicio de ${getLicenseTypeLabel(type)}. Se contar\u00e1 en d\u00edas corridos.`
    );
}

function activarSelectorAdmin() {
    if (!canModifyCurrentProfile()) return;

    const saldo = getLeaveBalances().admin;

    if (saldo <= 0) {
        alert("Ya se utilizaron los 6 permisos administrativos.");
        return;
    }

    if (saldo < 1) {
        alert(
            `Saldo insuficiente. El saldo disponible (${formatSaldo(saldo)}) solo permite aplicar 1/2 ADM Ma\u00f1ana o 1/2 ADM Tarde.`
        );
        return;
    }

    adminCantidad = 1;

    activarModo(
        "admin",
        getRotativa(getCurrentProfile()).type === "diurno"
            ? "Selecciona un turno Diurno en dia habil para el permiso administrativo."
            : getShiftAssigned(getCurrentProfile(), currentDate)
                ? "Selecciona un turno Larga o Noche valido para el permiso administrativo."
                : "Selecciona un turno Larga o Noche en dia habil para el permiso administrativo."
    );
}

function activarSelectorHalfAdmin(tipo) {
    if (!canModifyCurrentProfile()) return;

    if (getLeaveBalances().admin <= 0) {
        alert("No quedan permisos administrativos disponibles.");
        return;
    }

    window.halfAdminTipo = tipo;

    activarModo(
        "halfadmin",
        tipo === "M"
            ? "Selecciona el medio dia administrativo de manana"
            : "Selecciona el medio dia administrativo de tarde"
    );
}

async function activarSelectorDevolucionHoras() {
    if (!canModifyCurrentProfile()) return;

    const year = currentDate.getFullYear();
    const holidays = await fetchHolidays(year);
    const saldo = getLeaveBalances(
        year,
        holidays,
        {
            month: currentDate.getMonth(),
            profileName: getCurrentProfile()
        }
    ).hoursReturn;

    if (saldo <= 0) {
        alert("No hay horas disponibles para devoluci\u00f3n.");
        return;
    }

    activarModo(
        "hoursreturn",
        `Selecciona un turno base para aplicar devoluci\u00f3n de horas. Saldo disponible: ${formatSaldo(saldo)} hrs.`
    );

    DOM.adminInfo.textContent =
        "Solo quedan habilitados turnos base sin permisos, licencias, feriados, ausencias ni devoluciones ya aplicadas.";
}

function activarSelectorAusenciaInjustificada() {
    if (!canModifyCurrentProfile()) return;

    activarModo(
        "unjustified",
        "Selecciona uno por uno los turnos donde se aplicara la ausencia injustificada."
    );

    DOM.adminInfo.textContent =
        "Solo quedan habilitados los d\u00edas con turno real del trabajador. Puedes marcar varios turnos y presionar Cancelar para terminar.";
}

function activarSelectorMarcajeReloj() {
    if (!canModifyCurrentProfile()) return;

    activarModo(
        "clockmark",
        "Selecciona en el calendario el turno donde modificaras el marcaje de entrada o salida."
    );

    DOM.adminInfo.textContent =
        "Solo quedan habilitados los d\u00edas con turno real y sin vacaciones o ausencias.";
}

async function handleHoursReturnSelection(fecha) {
    const profile = getCurrentProfile();
    const keyDay = keyFromDate(fecha);
    const holidays = await fetchHolidays(fecha.getFullYear());
    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();
    const absences = getAbsences();
    const baseState = getTurnoBase(profile, keyDay);

    if (!Number(baseState)) {
        alert("Selecciona un d\u00eda con turno base para aplicar la devoluci\u00f3n de horas.");
        clearSelectionMode();
        return;
    }

    if (
        admin[keyDay] ||
        legal[keyDay] ||
        comp[keyDay] ||
        absences[keyDay]
    ) {
        alert("Este turno ya tiene un permiso, licencia, feriado o ausencia aplicada.");
        clearSelectionMode();
        return;
    }

    if (getHourReturn(profile, keyDay)) {
        alert("Este turno ya tiene una devoluci\u00f3n de horas aplicada.");
        clearSelectionMode();
        return;
    }

    const balance =
        getLeaveBalances(
            fecha.getFullYear(),
            holidays,
            {
                month: fecha.getMonth(),
                profileName: profile
            }
        ).hoursReturn;

    if (balance <= 0) {
        alert("No hay horas disponibles para devoluci\u00f3n.");
        clearSelectionMode();
        return;
    }

    const segments = getScheduledSegmentsForProfile(
        profile,
        keyDay,
        fecha,
        baseState,
        holidays
    ).filter(segment => segment.start < segment.end);

    if (!segments.length) {
        alert("No hay un horario de turno disponible para esta fecha.");
        clearSelectionMode();
        return;
    }

    const record = await openHoursReturnDialog({
        profile,
        keyDay,
        date: fecha,
        segments,
        balance
    });

    if (!record) {
        clearSelectionMode();
        return;
    }

    pushHistory();
    saveHourReturn(profile, keyDay, record);
    decrementManualBalance(
        "hoursReturn",
        record.hours,
        fecha.getFullYear()
    );

    addAuditLog(
        AUDIT_CATEGORY.LEAVE_ABSENCE,
        "Aplic\u00f3 devoluci\u00f3n de horas",
        `${profile}: ${record.fullTurn ? "Devoluci\u00f3n" : "Dev. Parcial"} de ${formatSaldo(record.hours)} hrs. el ${formatDisplayDate(toISODate(fecha))}.`,
        {
            profile,
            keyDay,
            hours: record.hours,
            fullTurn: record.fullTurn
        }
    );

    clearSelectionMode();
}

async function handleClockMarkSelection(fecha) {
    const profile = getCurrentProfile();
    const keyDay = keyFromDate(fecha);
    const data = getProfileData();
    const holidays = await fetchHolidays(fecha.getFullYear());
    const state = aplicarCambiosTurno(
        profile,
        keyDay,
        getTurnoProgramado(profile, keyDay)
    );

    if (!state) {
        alert("Selecciona un d\u00eda que tenga turno para modificar sus marcajes.");
        clearSelectionMode();
        return;
    }

    pushHistory();

    const saved = await openClockMarkDialog({
        profile,
        keyDay,
        date: fecha,
        state,
        holidays
    });

    if (saved) {
        addAuditLog(
            AUDIT_CATEGORY.CALENDAR,
            "Modifico marcaje reloj control",
            `${profile}: modifico marcajes del ${keyDay}.`,
            {
                profile,
                keyDay
            }
        );
    }

    clearSelectionMode();
}

function primeBirthDatePickerDefault() {
    const field = DOM.profileBirthDateInput;

    if (
        !field ||
        !isProfileEditing() ||
        field.disabled ||
        field.value ||
        profileDraft.birthDate
    ) {
        return;
    }

    field.value = PROFILE_BIRTH_DATE_DEFAULT;
    field.dataset.birthDatePickerDefault = "true";
}

function commitBirthDateInput() {
    if (!isProfileEditing()) return;

    delete DOM.profileBirthDateInput.dataset.birthDatePickerDefault;
    profileDraft.birthDate = DOM.profileBirthDateInput.value;
}

function clearUnusedBirthDatePickerDefault() {
    const field = DOM.profileBirthDateInput;

    if (
        field?.dataset.birthDatePickerDefault === "true" &&
        !profileDraft.birthDate &&
        field.value === PROFILE_BIRTH_DATE_DEFAULT
    ) {
        field.value = "";
    }

    delete field?.dataset.birthDatePickerDefault;
}

function bindProfileForm() {
    DOM.profileNameInput.oninput = () => {
        if (!isProfileEditing()) return;
        profileDraft.name = DOM.profileNameInput.value;
    };

    DOM.profileEmailInput.oninput = () => {
        if (!isProfileEditing()) return;
        profileDraft.email = DOM.profileEmailInput.value.trim();
        updateProfileEmailHint();
        syncEmailValidity(false);
    };

    DOM.profileEmailInput.onfocus = () => {
        if (!isProfileEditing()) return;
        updateProfileEmailHint();
    };

    DOM.profileEmailInput.onblur = () => {
        if (!isProfileEditing()) return;
        hideProfileEmailHint();
        syncEmailValidity(true);
    };

    DOM.profileRutInput.oninput = () => {
        if (!isProfileEditing()) return;
        const formatted = formatRut(DOM.profileRutInput.value);
        DOM.profileRutInput.value = formatted;
        profileDraft.rut = formatted;
        syncRutValidity(false);
    };

    DOM.profileRutInput.onblur = () => {
        if (!isProfileEditing()) return;
        syncRutValidity(true);
    };

    DOM.profilePhoneInput.oninput = () => {
        if (!isProfileEditing()) return;
        const phone = sanitizeDigits(DOM.profilePhoneInput.value, 8);
        DOM.profilePhoneInput.value = phone;
        profileDraft.phone = phone;
    };

    DOM.profileBirthDateInput.onpointerdown =
        primeBirthDatePickerDefault;
    DOM.profileBirthDateInput.onfocus =
        primeBirthDatePickerDefault;
    DOM.profileBirthDateInput.oninput =
        commitBirthDateInput;
    DOM.profileBirthDateInput.onchange =
        commitBirthDateInput;
    DOM.profileBirthDateInput.onblur =
        clearUnusedBirthDatePickerDefault;

    DOM.profileDocsInput.onchange = async () => {
        if (!isProfileEditing()) return;

        try {
            const attachments =
                await readAttachmentFiles(
                    DOM.profileDocsInput.files,
                    {
                        moduleId: "profile",
                        ownerId:
                            profileDraft.id ||
                            profileDraft.name ||
                            "new-profile",
                        recordId: "profile-documents"
                    }
                );

            profileDraft.docs = [
                ...profileDraft.docs,
                ...attachments
            ];
            DOM.profileDocsInput.value = "";
            renderDashboardState();
        } catch (error) {
            alert(error?.planBlocked
                ? error.message
                : "No se pudo leer el archivo adjunto. Intenta nuevamente con otro documento.");
        }
    };

    DOM.profileUnitEntryDateInput.onchange = () => {
        if (!isProfileEditing() || !isUnitEntryDateEnabled()) return;
        profileDraft.unitEntryDate =
            DOM.profileUnitEntryDateInput.value;
    };

    DOM.profileContractTypeSelect.onchange = () => {
        if (!isProfileEditing()) return;
        profileDraft.contractType =
            DOM.profileContractTypeSelect.value;

        if (isReplacementDraft()) {
            profileDraft.rotationType = "";
            profileDraft.rotationStart = "";
            profileDraft.rotationFirstTurn = "larga";
            profileDraft.shiftAssigned = false;
            profileDraft.unionLeaveEnabled = false;
            profileDraft.contractRotationMode =
                REPLACEMENT_ROTATION_MODE.INHERIT;
        } else {
            profileDraft.contractStart = "";
            profileDraft.contractEnd = "";
            profileDraft.contractReplaces = "";
            profileDraft.contractReason = "";
            profileDraft.contractLeaveRef = "";
            profileDraft.contractRotationMode =
                REPLACEMENT_ROTATION_MODE.INHERIT;
        }

        if (!isHonorariaDraft()) {
            profileDraft.honorariaStart = "";
            profileDraft.honorariaEnd = "";
            profileDraft.honorariaHourlyRate = "";
            profileDraft.honorariaMaxMonthlyHours = "";
        }

        if (
            profileDraft.rotationType === "libre" &&
            !supportsLibreRotation()
        ) {
            profileDraft.rotationType = "";
            profileDraft.rotationStart = "";
            profileDraft.rotationFirstTurn = "larga";
        }

        renderDashboardState();
    };

    if (DOM.profileUnionLeaveInput) {
        DOM.profileUnionLeaveInput.onchange = () => {
            if (!isProfileEditing()) return;

            profileDraft.unionLeaveEnabled =
                DOM.profileUnionLeaveInput.checked;
            renderBotones();
        };
    }

    DOM.profileRoleSelect.onchange = () => {
        if (!isProfileEditing()) return;
        profileDraft.estamento =
            DOM.profileRoleSelect.value;
        profileDraft.profession = normalizeProfession(
            profileDraft.profession,
            profileDraft.estamento
        );
        renderDashboardState();
    };

    DOM.profileProfessionSelect.onchange = () => {
        if (!isProfileEditing()) return;
        profileDraft.profession = normalizeProfession(
            DOM.profileProfessionSelect.value,
            profileDraft.estamento
        );
    };

    if (DOM.profileProfessionCustomInput) {
        DOM.profileProfessionCustomInput.oninput = () => {
            if (!isProfileEditing()) return;
            profileDraft.profession = normalizeProfession(
                DOM.profileProfessionCustomInput.value,
                profileDraft.estamento
            );
        };

        DOM.profileProfessionCustomInput.onchange = () => {
            if (!isProfileEditing()) return;
            profileDraft.profession = normalizeProfession(
                DOM.profileProfessionCustomInput.value,
                profileDraft.estamento
            );
            renderDashboardState();
        };
    }

    DOM.profileGradeSelect.onchange = () => {
        if (!isProfileEditing()) return;
        profileDraft.grade = DOM.profileGradeSelect.value;
    };

    DOM.profileRotationSelect.onchange =
        handleRotationSelectionChange;

    if (DOM.replacementTargetInput) {
        DOM.replacementTargetInput.oninput = () => {
            if (!isProfileEditing()) return;

            profileDraft.contractReplaces =
                DOM.replacementTargetInput.value;
        };
    }

    if (DOM.replacementReasonSelect) {
        DOM.replacementReasonSelect.onchange = () => {
            if (!isProfileEditing()) return;

            profileDraft.contractReason =
                DOM.replacementReasonSelect.value;
            renderDashboardState();
        };
    }

    if (DOM.honorariaStartInput) {
        DOM.honorariaStartInput.onchange = () => {
            if (!isProfileEditing()) return;

            profileDraft.honorariaStart =
                DOM.honorariaStartInput.value;
            renderDashboardState();
        };
    }

    if (DOM.honorariaEndInput) {
        DOM.honorariaEndInput.onchange = () => {
            if (!isProfileEditing()) return;

            profileDraft.honorariaEnd =
                DOM.honorariaEndInput.value;
            renderDashboardState();
        };
    }

    if (DOM.honorariaHourlyRateInput) {
        DOM.honorariaHourlyRateInput.oninput = () => {
            if (!isProfileEditing()) return;

            profileDraft.honorariaHourlyRate =
                DOM.honorariaHourlyRateInput.value;
        };
    }

    if (DOM.honorariaMaxMonthlyHoursInput) {
        DOM.honorariaMaxMonthlyHoursInput.oninput = () => {
            if (!isProfileEditing()) return;

            profileDraft.honorariaMaxMonthlyHours =
                DOM.honorariaMaxMonthlyHoursInput.value;
        };
    }

    DOM.checkbox.onchange = async () => {
        if (isProfileEditing()) {
            profileDraft.shiftAssigned =
                DOM.checkbox.checked;
            renderBotones();
            renderDisponibilidadVacaciones();
            return;
        }

        if (!getCurrentProfile()) return;

        const profileName = getCurrentProfile();
        const previous = getShiftAssignmentConfiguredState(
            profileName
        );
        const next = DOM.checkbox.checked;

        if (previous === next) return;

        const effectiveMonth =
            await requestShiftAssignmentEffectiveMonth(next);

        if (!effectiveMonth) {
            DOM.checkbox.checked = previous;
            return;
        }

        recordShiftAssignmentChange(
            next,
            effectiveMonth,
            profileName
        );
        addAuditLog(
            AUDIT_CATEGORY.COLLABORATOR_UPDATED,
            next
                ? "Programo asignacion de turno"
                : "Programo termino de asignacion de turno",
            `${profileName}: asignacion de turno ${next ? "activa" : "inactiva"} desde ${effectiveMonth}.`,
            {
                profile: profileName,
                assigned: next,
                effectiveMonth
            }
        );
        renderBotones();
        renderDisponibilidadVacaciones();
        void updateVisibleCalendarDays({ updateSummary: true });
    };

    DOM.profileActiveToggle.onchange = () => {
        if (isProfileEditing()) {
            profileDraft.active =
                DOM.profileActiveToggle.checked;
            return;
        }

        DOM.profileActiveToggle.checked =
            getPerfilActual()
                ? isProfileActive(getPerfilActual())
                : false;
    };

    DOM.openCreateProfileBtn.onclick = async () => {
        if (profileDraft.mode === PROFILE_MODE.CREATE) {
            await guardarPerfil();
            return;
        }

        startCreateMode();
    };

    DOM.openEditProfileBtn.onclick = async () => {
        if (profileDraft.mode === PROFILE_MODE.EDIT) {
            await guardarPerfil();
            return;
        }

        startEditMode();
    };

    if (DOM.workerAppInviteBtn) {
        DOM.workerAppInviteBtn.onclick = () =>
            openWorkerAppInviteDialog(getPerfilActual());
    }

    if (DOM.availabilityEditBtn) {
        DOM.availabilityEditBtn.onclick = handleAvailabilityEdit;
    }

    if (DOM.printHoursReportBtn) {
        DOM.printHoursReportBtn.onclick = () => {
            if (!ensureCanDownloadReports()) return;

            exportHoursReport(
                getPerfilActual(),
                profileRotationMiniDate
            );
        };
    }

    if (DOM.hheePrevMonthBtn) {
        DOM.hheePrevMonthBtn.onclick = () =>
            changeHoursMonth(-1);
    }

    if (DOM.hheeNextMonthBtn) {
        DOM.hheeNextMonthBtn.onclick = () =>
            changeHoursMonth(1);
    }

    if (DOM.hheeReturnTransferToggle) {
        DOM.hheeReturnTransferToggle.onchange =
            handleHheeReturnTransferToggle;
    }

    if (DOM.clockMarksPrevMonthBtn) {
        DOM.clockMarksPrevMonthBtn.onclick = () =>
            changeClockMarksMonth(-1);
    }

    if (DOM.clockMarksNextMonthBtn) {
        DOM.clockMarksNextMonthBtn.onclick = () =>
            changeClockMarksMonth(1);
    }
}

function initializeInactiveProfileToggles() {
    [
        "showInactiveProfiles",
        "hheeShowInactiveProfiles",
        "reportsShowInactiveProfiles",
        "swapShowInactiveProfiles",
        "clockMarksShowInactiveProfiles"
    ].forEach(id => {
        const input = document.getElementById(id);

        if (input) {
            input.checked = false;
        }
    });
}

const MOBILE_LAYOUT_QUERY = "(max-width: 760px)";
let appNavigationHistoryReady = false;
let appNavigationHistoryBound = false;

function syncAppNavigationHistory(targetId, mode = "push") {
    if (!window.history || !isAppTarget(targetId)) return;

    const state = {
        ...(window.history.state || {}),
        proTurnosTarget: targetId
    };
    const url = appTargetUrl(targetId);
    const currentTarget = window.history.state?.proTurnosTarget;

    if (!appNavigationHistoryReady || mode === "replace") {
        window.history.replaceState(state, "", url);
        appNavigationHistoryReady = true;
        return;
    }

    if (mode === "none" || currentTarget === targetId) {
        return;
    }

    window.history.pushState(state, "", url);
}

function bindAppNavigationHistory() {
    if (appNavigationHistoryBound) return;

    appNavigationHistoryBound = true;
    window.addEventListener("popstate", event => {
        const targetId =
            event.state?.proTurnosTarget ||
            targetFromHash() ||
            firstViewableTarget();
        const nextTarget =
            isAppTarget(targetId) && canViewTarget(targetId)
                ? targetId
                : firstViewableTarget();

        if (nextTarget) {
            setActiveShortcut(nextTarget, { historyMode: "none" });
        }
    });
}

function isMobileLayout() {
    return (
        window.matchMedia &&
        window.matchMedia(MOBILE_LAYOUT_QUERY).matches
    );
}

function syncMobileTimelinePlacement() {
    const timelinePanel = document.getElementById("timelinePanel");
    const staffingPanel = document.getElementById("staffingReportPanel");
    const primaryGrid = document.querySelector(".primary-grid");

    if (!timelinePanel) {
        return;
    }

    if (isMobileLayout()) {
        if (staffingPanel && timelinePanel.previousElementSibling !== staffingPanel) {
            staffingPanel.after(timelinePanel);
        }
        return;
    }

    if (primaryGrid && timelinePanel.previousElementSibling !== primaryGrid) {
        primaryGrid.after(timelinePanel);
    }
}

function setMobileMenuOpen(open) {
    const shouldOpen = Boolean(open && isMobileLayout());
    document.body.classList.toggle("mobile-menu-open", shouldOpen);

    if (DOM.mobileMenuToggle) {
        DOM.mobileMenuToggle.setAttribute(
            "aria-expanded",
            shouldOpen ? "true" : "false"
        );
        DOM.mobileMenuToggle.setAttribute(
            "aria-label",
            shouldOpen ? "Cerrar menu" : "Abrir menu"
        );
    }
}

function setMobileLeaveOpen(open) {
    const shouldOpen =
        Boolean(open && isMobileLayout()) &&
        document.body.dataset.activeView === "turnos";

    document.body.classList.toggle("mobile-leave-open", shouldOpen);

    if (DOM.mobileLeaveToggle) {
        DOM.mobileLeaveToggle.setAttribute(
            "aria-expanded",
            shouldOpen ? "true" : "false"
        );
    }
}

function setMobileStaffingOpen(open) {
    const shouldOpen =
        Boolean(open && isMobileLayout()) &&
        document.body.dataset.activeView === "turnos";

    document.body.classList.toggle("mobile-staffing-open", shouldOpen);

    if (DOM.mobileStaffingToggle) {
        DOM.mobileStaffingToggle.setAttribute(
            "aria-expanded",
            shouldOpen ? "true" : "false"
        );
    }
}

function isCalendarDirectEditEnabled() {
    return calendarDirectEditEnabled;
}

window.calendarDirectEditEnabled = isCalendarDirectEditEnabled;

function syncCalendarDirectEditToggle() {
    if (!DOM.calendarDirectEditToggle) return;

    const canEditCalendar = canEditTarget("calendarPanel");
    if (!canEditCalendar) {
        calendarDirectEditEnabled = false;
    }

    const enabled = canEditCalendar && isCalendarDirectEditEnabled();
    DOM.calendarDirectEditToggle.checked = enabled;
    DOM.calendarDirectEditToggle.disabled = !canEditCalendar;
    document.body.classList.toggle(
        "calendar-direct-edit-off",
        !enabled
    );
}

function bindCalendarDirectEditToggle() {
    if (!DOM.calendarDirectEditToggle) return;

    syncCalendarDirectEditToggle();
    DOM.calendarDirectEditToggle.onchange = () => {
        calendarDirectEditEnabled =
            DOM.calendarDirectEditToggle.checked;
        syncCalendarDirectEditToggle();

        if (!calendarDirectEditEnabled) {
            window.flushCalendarDirectEditRefresh?.({
                force: true
            });
        }
    };
}

function bindMobileCalendarSwipe() {
    const calendar = DOM.calendar;
    if (!calendar) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let suppressNextCalendarClick = false;

    const canSwipeCalendar = () =>
        isMobileLayout() &&
        document.body.dataset.activeView === "turnos";

    calendar.addEventListener(
        "touchstart",
        event => {
            if (!canSwipeCalendar() || event.touches.length !== 1) {
                tracking = false;
                return;
            }

            const touch = event.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            tracking = true;
        },
        { passive: true }
    );

    calendar.addEventListener(
        "touchend",
        event => {
            if (!tracking || !canSwipeCalendar()) return;

            tracking = false;
            const touch = event.changedTouches[0];
            if (!touch) return;

            const deltaX = touch.clientX - startX;
            const deltaY = touch.clientY - startY;
            const horizontal = Math.abs(deltaX);
            const vertical = Math.abs(deltaY);

            if (horizontal < 55 || horizontal < vertical * 1.35) {
                return;
            }

            event.preventDefault();
            suppressNextCalendarClick = true;

            if (deltaX > 0) {
                prevMonth({ deferHeavy: true });
            } else {
                nextMonth({ deferHeavy: true });
            }

            window.setTimeout(() => {
                suppressNextCalendarClick = false;
            }, 350);
        },
        { passive: false }
    );

    calendar.addEventListener(
        "click",
        event => {
            if (!suppressNextCalendarClick) return;

            event.preventDefault();
            event.stopPropagation();
            suppressNextCalendarClick = false;
        },
        true
    );
}

function bindMobileShellInteractions() {
    if (DOM.mobileMenuToggle) {
        DOM.mobileMenuToggle.onclick = event => {
            event.stopPropagation();
            setMobileMenuOpen(
                !document.body.classList.contains("mobile-menu-open")
            );
        };
    }

    if (DOM.mobileLeaveToggle) {
        DOM.mobileLeaveToggle.onclick = () => {
            setMobileLeaveOpen(
                !document.body.classList.contains("mobile-leave-open")
            );
        };
    }

    if (DOM.mobileStaffingToggle) {
        DOM.mobileStaffingToggle.onclick = () => {
            setMobileStaffingOpen(
                !document.body.classList.contains("mobile-staffing-open")
            );
        };
    }

    const leavePanel = document.getElementById("leavePanel");
    if (leavePanel) {
        leavePanel.addEventListener("click", event => {
            const selected = event.target.closest(".legend-action");
            if (!selected || selected.disabled || !isMobileLayout()) return;

            setMobileLeaveOpen(false);
            requestAnimationFrame(() => {
                document.getElementById("calendarPanel")?.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });
            });
        });
    }

    document.addEventListener("click", event => {
        if (
            !isMobileLayout() ||
            !document.body.classList.contains("mobile-menu-open")
        ) {
            return;
        }

        const actionbar = document.getElementById("mainNavigation");
        const clickedMenu =
            DOM.mobileMenuToggle?.contains(event.target) ||
            actionbar?.contains(event.target);

        if (!clickedMenu) {
            setMobileMenuOpen(false);
        }
    });

    window.addEventListener("resize", () => {
        syncMobileTimelinePlacement();

        if (!isMobileLayout()) {
            setMobileMenuOpen(false);
            setMobileLeaveOpen(false);
            setMobileStaffingOpen(false);
        }
    });

    bindMobileCalendarSwipe();
}

function bindShellInteractions() {
    const syncProfileFilters = () => {
        setAppFilters("profiles", {
            role: DOM.filterRole?.value || "Todos",
            query: DOM.profileSearch?.value || "",
            showInactive:
                DOM.showInactiveProfiles?.checked ?? false
        });
        renderProfiles();
    };

    setAppFilters("profiles", {
        role: DOM.filterRole?.value || "Todos",
        query: DOM.profileSearch?.value || "",
        showInactive: DOM.showInactiveProfiles?.checked ?? false
    });

    DOM.filterRole.onchange = syncProfileFilters;
    DOM.profileSearch.oninput = syncProfileFilters;
    if (DOM.showInactiveProfiles) {
        DOM.showInactiveProfiles.onchange = syncProfileFilters;
    }

    DOM.profiles.onclick = event => {
        const action = event.target.closest("[data-action]");
        if (!action || !DOM.profiles.contains(action)) return;

        if (action.dataset.action === "select-profile") {
            selectProfileByName(action.dataset.profileName);
            return;
        }

        if (action.dataset.action === "load-more-profiles") {
            profileListLimit += PROFILE_LIST_PAGE_SIZE;
            renderProfiles();
        }
    };

    if (DOM.hheeFilterRole) {
        DOM.hheeFilterRole.onchange = renderHheeProfiles;
    }

    if (DOM.hheeProfileSearch) {
        DOM.hheeProfileSearch.oninput = renderHheeProfiles;
    }

    if (DOM.hheeShowInactiveProfiles) {
        DOM.hheeShowInactiveProfiles.onchange = renderHheeProfiles;
    }

    if (DOM.reportsFilterRole) {
        DOM.reportsFilterRole.onchange = renderReportsProfiles;
    }

    if (DOM.reportsProfileSearch) {
        DOM.reportsProfileSearch.oninput = renderReportsProfiles;
    }

    if (DOM.reportsShowInactiveProfiles) {
        DOM.reportsShowInactiveProfiles.onchange =
            renderReportsProfiles;
    }

    if (DOM.clockMarksFilterRole) {
        DOM.clockMarksFilterRole.onchange = () => {
            renderClockMarksProfiles();
            renderClockMarksPanel();
        };
    }

    if (DOM.clockMarksProfileSearch) {
        DOM.clockMarksProfileSearch.oninput =
            renderClockMarksProfiles;
    }

    if (DOM.clockMarksShowInactiveProfiles) {
        DOM.clockMarksShowInactiveProfiles.onchange =
            renderClockMarksProfiles;
    }

    if (DOM.clockMarksAllWorkersToggle) {
        DOM.clockMarksAllWorkersToggle.onchange =
            renderClockMarksPanel;
    }

    if (DOM.topProfileSearchForm) {
        DOM.topProfileSearchForm.onsubmit = event => {
            event.preventDefault();
            handleTopProfileSearch();
        };
    }

    if (DOM.topProfileSearchInput) {
        DOM.topProfileSearchInput.onchange =
            handleTopProfileSearch;
        DOM.topProfileSearchInput.onfocus = () =>
            DOM.topProfileSearchInput.select();
    }

    document
        .querySelectorAll(".nav-tile[data-target]")
        .forEach(button => {
            button.onclick = () => {
                if (button.disabled || button.dataset.permissionLocked === "true") {
                    return;
                }

                const target = document.getElementById(
                    button.dataset.target
                );

                if (!target) return;

                setActiveShortcut(button.dataset.target);
                setMobileMenuOpen(false);
                target.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });
            };
        });

    document
        .querySelectorAll("[data-editor-mode]")
        .forEach(button => {
            button.onclick = () => startEditMode();
        });

    bindMobileShellInteractions();
    bindCalendarDirectEditToggle();
}

DOM.adminBtn.onclick = activarSelectorAdmin;
DOM.halfAdminMorningBtn.onclick =
    () => activarSelectorHalfAdmin("M");
DOM.halfAdminAfternoonBtn.onclick =
    () => activarSelectorHalfAdmin("T");
DOM.legalBtn.onclick = activarSelectorLegal;
DOM.compBtn.onclick = activarSelectorComp;
DOM.licenseBtn.onclick = () => activarSelectorLicencia("license");
DOM.professionalLicenseBtn.onclick =
    () => activarSelectorLicencia("professional_license");
if (DOM.unionLeaveBtn) {
    DOM.unionLeaveBtn.onclick =
        () => activarSelectorLicencia("union_leave");
}
DOM.unpaidLeaveBtn.onclick =
    () => activarSelectorLicencia("unpaid_leave");
DOM.hoursReturnBtn.onclick = activarSelectorDevolucionHoras;
DOM.unjustifiedAbsenceBtn.onclick =
    activarSelectorAusenciaInjustificada;
DOM.clockMarkBtn.onclick = activarSelectorMarcajeReloj;
DOM.moveShiftBtn.onclick = activarSelectorMoverTurno;
syncMoveShiftAvailability();

[
    "(display-mode: standalone)",
    "(display-mode: fullscreen)",
    "(display-mode: minimal-ui)"
].forEach(query => {
    const media = window.matchMedia?.(query);

    if (media?.addEventListener) {
        media.addEventListener(
            "change",
            syncMoveShiftAvailability
        );
    }
});

DOM.prevBtn.onclick = () => prevMonth({ deferHeavy: true });
DOM.nextBtn.onclick = () => nextMonth({ deferHeavy: true });
if (DOM.calendarRotationButton) {
    DOM.calendarRotationButton.onclick =
        openCalendarRotationConfigModal;
}

DOM.undoBtn.onclick = () => {
    const result = undo();

    if (result) {
        addAuditLog(
            AUDIT_CATEGORY.CALENDAR,
            "Deshizo \u00faltima acci\u00f3n",
            "El usuario revirti\u00f3 el \u00faltimo cambio guardado en el historial."
        );
        refreshAll();
        showHistoryActionToast(result, "undo");
    }
};

DOM.redoBtn.onclick = () => {
    const result = redo();

    if (result) {
        addAuditLog(
            AUDIT_CATEGORY.CALENDAR,
            "Rehizo \u00faltima acci\u00f3n",
            "El usuario reaplic\u00f3 el \u00faltimo cambio revertido en el historial."
        );
        refreshAll();
        showHistoryActionToast(result, "redo");
    }
};

setCalendarSelectionHandler(async ({ cell: celda, date: fecha }) => {
    if (selectionMode && !canModifyCurrentProfile()) {
        clearSelectionMode(false);
        return;
    }

    if (
        selectionMode &&
        celda.classList.contains("mpa-disabled")
    ) {
        return;
    }

    if (selectionMode === "rotation") {
        await applyCalendarRotationChange(fecha);
        return;
    }

    if (selectionMode === "moveshiftsource") {
        await handleMoveShiftSourceSelection(fecha);
        return;
    }

    if (selectionMode === "moveshifttarget") {
        handleMoveShiftTargetSelection(fecha);
        return;
    }

    if (selectionMode === "hoursreturn") {
        await handleHoursReturnSelection(fecha);
        return;
    }

    if (selectionMode === "clockmark") {
        await handleClockMarkSelection(fecha);
        return;
    }

    if (selectionMode === "license") {
        const aplicado = await aplicarLicencia(
            fecha,
            licenseCantidad,
            licenseType,
            {
                beforeMutation: () => pushHistory()
            }
        );

        if (aplicado === false) {
            alert(
                "No se pudo aplicar esta ausencia. Licencia M\u00e9dica, LM Profesional y Permiso Gremial solo pueden reemplazarse entre s\u00ed; el Permiso sin Goce no puede superponerse sobre licencias existentes."
            );
        }

        clearSelectionMode();
        return;
    }

    if (selectionMode === "unjustified") {
        pushHistory();
        const aplicado =
            await aplicarAusenciaInjustificada(fecha);

        if (!aplicado) {
            alert(
                "No se pudo aplicar la ausencia injustificada. Solo puede marcarse sobre d\u00edas con turno real y sin permisos, feriados o licencias ya cargadas."
            );
            return;
        }

        await updateDayCell(getCurrentProfile(), fecha);
        return;
    }

    if (selectionMode === "comp") {
        pushHistory();
        const aplicado = await aplicarComp(fecha, compCantidad);

        if (aplicado) {
            decrementManualBalance(
                "comp",
                compCantidad,
                fecha.getFullYear()
            );
        } else {
            alert(
                "No se pudo aplicar el F. Compensatorio. Debe iniciar en un d\u00eda h\u00e1bil, finalizar dentro del mismo a\u00f1o, respetar el saldo disponible, haber pasado 90 d\u00edas corridos desde el \u00faltimo F. Legal y no cruzarse con licencias, feriados legales, permisos administrativos, medios ADM, permisos sin goce u otros bloqueos incompatibles."
            );
        }

        clearSelectionMode();
        return;
    }

    if (selectionMode === "legal") {
        pushHistory();
        const aplicado =
            await aplicarLegal(fecha, legalCantidad);

        if (!aplicado) {
            alert(
                "No se pudo aplicar el F. Legal en esa fecha. Revisa que el inicio sea h\u00e1bil, que el bloque finalice dentro del mismo a\u00f1o y que el rango no tenga ausencias incompatibles."
            );
        } else {
            decrementManualBalance(
                "legal",
                legalCantidad,
                fecha.getFullYear()
            );
        }

        clearSelectionMode();
        return;
    }

    if (selectionMode === "halfadmin") {
        pushHistory();
        const aplicado = await aplicarHalfAdministrativo(
            fecha,
            window.halfAdminTipo || "M"
        );

        if (aplicado) {
            decrementManualBalance(
                "admin",
                0.5,
                fecha.getFullYear()
            );
        }

        clearSelectionMode();
        return;
    }

    if (selectionMode === "admin") {
        pushHistory();
        const aplicado =
            await aplicarAdministrativo(fecha, adminCantidad);

        if (aplicado) {
            decrementManualBalance(
                "admin",
                adminCantidad,
                fecha.getFullYear()
            );
        }

        clearSelectionMode();
        return;
    }

});

window.addEventListener("proturnos:workerRequestsChanged", () => {
    if (document.body.dataset.activeView === "requests") {
        renderWorkerRequestsPanel();
    } else {
        refreshWorkerRequestsNavBadge();
    }

    void updateVisibleCalendarDays({ updateSummary: true });
});

window.addEventListener("proturnos:replacementRequestsChanged", () => {
    if (document.body.dataset.activeView === "requests") {
        renderWorkerRequestsPanel();
    } else {
        refreshWorkerRequestsNavBadge();
    }

    void updateVisibleCalendarDays({ updateSummary: true });
});

window.addEventListener("proturnos:memosChanged", () => {
    if (document.body.dataset.activeView === "memos") {
        renderMemosPanel();
    } else {
        updateMemosNavBadge();
    }
});

function cancelLinkedInterUnitLoans(canceledReplacements = []) {
    canceledReplacements.forEach(replacement => {
        if (!replacement?.interUnitLoanId) return;

        void cancelInterUnitLoan(
            replacement.interUnitLoanId,
            getActiveWorkspace()?.id || ""
        ).catch(error => {
            console.warn(
                "No se pudo anular el prestamo entre unidades.",
                error
            );
        });
    });
}

window.addEventListener("proturnos:auditUndoApplied", event => {
    const detail = event.detail || {};
    const canceledReplacements = detail.canceledReplacements || [];

    cancelLinkedInterUnitLoans(canceledReplacements);

    // Devuelve el saldo del permiso anulado para que el numero entre parentesis
    // vuelva de inmediato.
    restoreLeaveBalanceFromUndo(detail);

    if (!detail.profile || detail.profile === getCurrentProfile()) {
        void updateVisibleCalendarDays({ updateSummary: true });
        updateTimelineCells(detail.profile || getCurrentProfile());
        // Refresca el saldo entre parentesis de los botones inmediatamente.
        renderLeaveActionLabels();
    }

    notifyWorkersOfAuditUndo(detail);
});

window.addEventListener(
    "proturnos:leaveScheduleConflictsCanceled",
    event => {
        const detail = event.detail || {};
        const canceledReplacements = Array.isArray(
            detail.canceledReplacements
        )
            ? detail.canceledReplacements
            : [];
        const label = String(detail.label || "una licencia medica");

        cancelLinkedInterUnitLoans(canceledReplacements);

        canceledReplacements.forEach(replacement => {
            if (!replacement?.worker) return;

            const date = replacement.date || "la fecha asignada";
            const turn = replacement.turno || "turno";

            void notifyWorkerApp(
                replacement.worker,
                `Se anulo tu turno extra del ${date} (${turn}) porque se aplico ${label}.`
            );

            if (
                replacement.replaced &&
                replacement.replaced !== replacement.worker
            ) {
                void notifyWorkerApp(
                    replacement.replaced,
                    `Se anulo la cobertura de ${replacement.worker} para el ${date} (${turn}) porque se aplico ${label}.`
                );
            }
        });
    }
);

window.addEventListener("proturnos:interUnitLoansChanged", () => {
    void updateVisibleCalendarDays({ updateSummary: true });
});

const LEAVE_CANCELLATION_LABELS = {
    admin: "el permiso administrativo",
    half_admin_morning: "el 1/2 administrativo (manana)",
    half_admin_afternoon: "el 1/2 administrativo (tarde)",
    half_admin: "el 1/2 administrativo",
    legal: "el feriado legal",
    comp: "el compensatorio",
    license: "la licencia medica",
    professional_license: "la LM profesional",
    union_leave: "el permiso gremial",
    unpaid_leave: "el permiso sin goce",
    unjustified_absence: "la ausencia injustificada"
};

function notifyWorkersOfAuditUndo(detail) {
    const canceledReplacements = Array.isArray(detail.canceledReplacements)
        ? detail.canceledReplacements
        : [];
    const isLeave = detail.category === "leave_absence";
    const profile = String(detail.profile || "");
    const leaveLabel =
        LEAVE_CANCELLATION_LABELS[detail.leaveType] || "tu permiso/ausencia";

    if (isLeave && profile) {
        void notifyWorkerApp(
            profile,
            `Tu supervisor anulo ${leaveLabel}. Revisa tu calendario actualizado en la app.`
        );
    }

    canceledReplacements.forEach(replacement => {
        if (!replacement?.worker) return;

        const date = replacement.date || "la fecha asignada";
        const turn = replacement.turno || "turno";
        const reason = isLeave && profile
            ? ` porque se anulo ${leaveLabel} de ${profile}`
            : "";

        void notifyWorkerApp(
            replacement.worker,
            `Se anulo tu turno extra del ${date} (${turn})${reason}.`
        );
    });
}

// Maneja el retorno de Webpay (?webpay=ok|error|abort): avisa, refresca el
// plan/uso y limpia el parametro de la URL.
function handleWebpayReturn() {
    const params = new URLSearchParams(location.search);
    const status = params.get("webpay");

    if (!status) return;

    params.delete("webpay");
    const clean = location.pathname + (params.toString() ? `?${params}` : "");
    history.replaceState(null, "", clean);

    if (status === "ok") {
        void refreshAccountUsage({ force: true });
        alert("¡Pago aprobado! Tu suscripcion quedo activa.");
    } else if (status === "abort") {
        alert("Pago cancelado.");
    } else {
        alert("El pago no se completo. Si el problema persiste, intenta nuevamente.");
    }
}

window.addEventListener("proturnos:workerLinksChanged", () => {
    scheduleWorkspaceUiRefresh();
});

// Atajos de teclado globales para modales: Escape cierra/cancela y Enter
// (sin Shift) acciona el boton principal (aceptar/enviar). Cubre los modales
// del programa, que usan estos backdrops.
const MODAL_BACKDROP_SELECTOR =
    ".turn-change-dialog-backdrop, .task-assignment-dialog-backdrop";

function topmostModalBackdrop() {
    const backdrops = document.querySelectorAll(MODAL_BACKDROP_SELECTOR);

    return backdrops.length ? backdrops[backdrops.length - 1] : null;
}

document.addEventListener("keydown", event => {
    if (event.key !== "Escape" && event.key !== "Enter") return;

    const backdrop = topmostModalBackdrop();

    if (!backdrop) return;

    if (event.key === "Escape") {
        const cancelButton =
            backdrop.querySelector(
                "[data-action='cancel'], [data-action='close']"
            ) ||
            backdrop.querySelector(".ghost-button, .secondary-button");

        if (cancelButton) {
            event.preventDefault();
            cancelButton.click();
        }

        // Si no hay boton reconocible, se deja que el handler propio del
        // modal (p. ej. el chat) maneje el Escape sin forzar la limpieza.
        return;
    }

    // Enter: si otro handler ya lo trato (p. ej. el chat), no duplicar.
    // Shift+Enter conserva el salto de linea.
    if (event.shiftKey || event.defaultPrevented) return;

    const active = document.activeElement;

    if (
        active &&
        (active.tagName === "SELECT" || active.tagName === "BUTTON")
    ) {
        return;
    }

    const primaryButton =
        backdrop.querySelector(".primary-button:not(:disabled)") ||
        backdrop.querySelector("button[type='submit']:not(:disabled)");

    if (!primaryButton) return;

    event.preventDefault();
    primaryButton.click();
});

let workspaceUiRefreshTimer = 0;
let workspaceStateSyncRequested = false;
let workspaceUiRefreshIdleHandle = 0;

function runWorkspaceRefreshWhenIdle(callback, timeout = 1800) {
    if (
        typeof window.requestIdleCallback === "function" &&
        document.visibilityState === "visible"
    ) {
        if (
            workspaceUiRefreshIdleHandle &&
            typeof window.cancelIdleCallback === "function"
        ) {
            window.cancelIdleCallback(workspaceUiRefreshIdleHandle);
        }

        workspaceUiRefreshIdleHandle = window.requestIdleCallback(() => {
            workspaceUiRefreshIdleHandle = 0;
            callback();
        }, {
            timeout
        });
        return;
    }

    callback();
}

function scheduleWorkspaceUiRefresh(options = {}) {
    workspaceStateSyncRequested =
        workspaceStateSyncRequested || options.syncState === true;

    clearTimeout(workspaceUiRefreshTimer);
    const activeView = document.body.dataset.activeView || "turnos";
    const delay =
        options.syncState === true &&
        (activeView === "turnos" || activeView === "timeline")
            ? 900
            : 60;

    workspaceUiRefreshTimer = window.setTimeout(() => {
        runWorkspaceRefreshWhenIdle(() => {
            measurePerformance(
                "workspace:deferred-ui-refresh",
                () => {
                workspaceUiRefreshTimer = 0;

                const syncState = workspaceStateSyncRequested;
                workspaceStateSyncRequested = false;

                if (syncState) {
                    syncWorkspaceStateViews();
                } else {
                    // Los enlaces de la PWA solo cambian controles del perfil activo;
                    // no alteran las celdas ni justifican reconstruir el calendario.
                    renderDashboardState();
                    renderBotones();
                }
            },
                {
                    syncState: workspaceStateSyncRequested,
                    activeView: document.body.dataset.activeView || "turnos"
                }
            );
        });
    }, delay);
}

function syncWorkspaceStateViews() {
    return measurePerformance(
        "workspace:sync-state-views",
        () => {
            const profiles = getProfiles();
            const current = getCurrentProfile();

            if (
                profiles.length &&
                !profiles.some(profile =>
                    profile.name === current
                )
            ) {
                setCurrentProfile(profiles[0].name);
            }

            if (!profiles.length) {
                setCurrentProfile(null);
            }

            renderProfiles({ dashboard: false });
            renderBotones();
            if (
                document.body.dataset.activeView ===
                "requests"
            ) {
                renderWorkerRequestsPanel();
            } else {
                refreshWorkerRequestsNavBadge();
            }
            if (document.body.dataset.activeView === "tasks") {
                renderTaskAssignmentsPanel();
            }
            if (document.body.dataset.activeView === "kanban") {
                renderKanbanBoard();
            }
            refreshAll();
        },
        {
            profileCount: getProfiles().length,
            activeView: document.body.dataset.activeView || "turnos"
        }
    );
}

initTheme();
initPwaInstall({
    buttons: [
        document.getElementById("pwaInstallBtn"),
        document.getElementById("pwaInstallGateBtn")
    ]
});

// Boton flotante de auto-pruebas (solo aparece en el entorno de pruebas).
initSelfTestButton();

// Service Worker: cachea el shell para reaperturas instantaneas y offline basico.
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
}

initTurnosSidePanelSync();
initSystemSettings({
    button: DOM.systemSettingsBtn,
    onSaved: () => {
        refreshAll();
    }
});
initPlansUI({ button: DOM.plansBtn });
handleWebpayReturn();
initSupervisorMessages({
    button: DOM.floatingMessagesBtn,
    badge: DOM.floatingMessagesBadge
});

let workspaceMfaPromise = null;

async function enforceWorkspaceMfa(workspace) {
    if (!workspace?.id || !workspaceRequiresMfa()) return true;
    if (await isFirebaseSessionMfaVerified()) return true;
    if (workspaceMfaPromise) return workspaceMfaPromise;

    workspaceMfaPromise = ensureFirebaseTotpEnrollment({
        reason:
            "Tu cuenta tiene permisos de propietario o supervisor. Para acceder a esta unidad debes activar la verificacion TOTP."
    }).finally(() => {
        workspaceMfaPromise = null;
    });

    return workspaceMfaPromise;
}

initFirebaseShell({
    userChip: DOM.authUserChip,
    userName: DOM.authUserName,
    onAuthChange: async user => {
        if (!user) {
            stopFirebaseAppStateSync();
            stopFirebaseReplacementRequestSync();
            stopFirebaseWorkerRequestSync();
            stopWorkerAppDataSync();
            stopWorkerAvailabilitySync();
            stopInterUnitLoanSync();
            stopSupervisorMessages();
            stopWorkspacePermissionListener();
        }

        await loadWorkspacePermissions();

        syncWorkspacePermissionUI();
        syncCalendarDirectEditToggle();

        if (document.body.dataset.activeView === "kanban") {
            renderKanbanBoard();
        }
    },
    onWorkspaceChange: async workspace => {
        if (workspace?.id) {
            recordPerformanceEvent("firebase:workspace-change", {
                type: "workspace",
                workspaceId: workspace.id,
                workspaceName: workspace.name || ""
            });
            // Refresca el uso/plan autoritativo para tener listo el gating.
            void refreshAccountUsage({ force: true });

            await startWorkspacePermissionListener(workspace, () => {
                syncWorkspacePermissionUI();
                syncCalendarDirectEditToggle();
                renderDashboardState();

                if (workspaceRequiresMfa()) {
                    enforceWorkspaceMfa(workspace).catch(async error => {
                        console.warn(
                            "La sesion privilegiada no completo MFA.",
                            error
                        );
                        await signOutFirebase();
                    });
                }
            });

            try {
                await enforceWorkspaceMfa(workspace);
            } catch (error) {
                await signOutFirebase();
                throw error;
            }

            void measurePerformance(
                "worker-app:start-sync",
                () => startWorkerAppDataSync(workspace),
                {
                    workspaceId: workspace.id,
                    workspaceName: workspace.name || ""
                }
            );
            startInterUnitLoanSync(workspace);
            let workerAvailabilityInitialized = false;
            let workerAvailabilitySnapshot = new Map();
            startWorkerAvailabilitySync(workspace, {
                onChange: blockedDays => {
                    const nextSnapshot = new Map(
                        (Array.isArray(blockedDays) ? blockedDays : []).map(item => [
                            String(item.id || `${item.profileName}|${item.date}`),
                            {
                                profileName: String(item.profileName || ""),
                                date: String(item.date || ""),
                                signature: JSON.stringify(item)
                            }
                        ])
                    );
                    const changedProfiles = new Set();
                    const changedDatesForActiveWorker = new Set();
                    const activeProfileName = getCurrentProfile();
                    const allKeys = new Set([
                        ...workerAvailabilitySnapshot.keys(),
                        ...nextSnapshot.keys()
                    ]);

                    allKeys.forEach(key => {
                        const previous = workerAvailabilitySnapshot.get(key);
                        const next = nextSnapshot.get(key);

                        if (previous?.signature === next?.signature) return;

                        const profileName =
                            next?.profileName || previous?.profileName;
                        const date = next?.date || previous?.date;

                        if (profileName) changedProfiles.add(profileName);
                        if (profileName === activeProfileName && date) {
                            changedDatesForActiveWorker.add(date);
                        }
                    });

                    // El primer snapshot solo hidrata la interfaz. Publicar
                    // aqui regeneraba los datos de todos los trabajadores al
                    // abrir el entorno.
                    if (workerAvailabilityInitialized) {
                        scheduleWorkerAppDataPublish(
                            300,
                            [...changedProfiles]
                        );
                    }

                    if (changedDatesForActiveWorker.size) {
                        void updateDayCells(
                            activeProfileName,
                            [...changedDatesForActiveWorker],
                            { updateSummary: false }
                        );
                    }

                    workerAvailabilitySnapshot = nextSnapshot;
                    workerAvailabilityInitialized = true;
                }
            });
            startSupervisorMessages(workspace);
            startFirebaseWorkerRequestSync(workspace, {
                onChange: () => {
                    window.dispatchEvent(
                        new CustomEvent("proturnos:workerRequestsChanged")
                    );
                }
            });
            startFirebaseReplacementRequestSync(workspace, {
                onChange: () => {
                    window.dispatchEvent(
                        new CustomEvent("proturnos:replacementRequestsChanged")
                    );
                }
            });
            void measurePerformance(
                "firebase-app-state:start-sync",
                () => startFirebaseAppStateSync(workspace, {
                    onChange: (_snapshot, detail = {}) => {
                        measurePerformance(
                            "firebase-app-state:on-change-ui",
                            () => {
                                if (detail.partial === true) {
                                    if (detail.keys?.includes("profiles")) {
                                        renderProfiles({ dashboard: false });
                                    }
                                    renderBotones();
                                } else {
                                    scheduleWorkspaceUiRefresh({
                                        syncState: true
                                    });
                                }
                            },
                            {
                                partial: detail.partial === true,
                                keyCount: Array.isArray(detail.keys)
                                    ? detail.keys.length
                                    : 0
                            }
                        );
                    }
                }),
                {
                    workspaceId: workspace.id,
                    workspaceName: workspace.name || ""
                }
            );
        } else {
            stopFirebaseReplacementRequestSync();
            stopFirebaseWorkerRequestSync();
            stopWorkerAppDataSync();
            stopWorkerAvailabilitySync();
            stopInterUnitLoanSync();
            stopSupervisorMessages();
            stopFirebaseAppStateSync();
            stopWorkspacePermissionListener();
            await loadWorkspacePermissions(workspace);
            syncWorkspacePermissionUI();
            syncCalendarDirectEditToggle();
        }

        syncWorkspaceStateViews();
        if (document.body.dataset.activeView === "tasks") {
            renderTaskAssignmentsPanel();
        }
        if (document.body.dataset.activeView === "kanban") {
            renderKanbanBoard();
        }
    }
});
bindProfileForm();
initializeInactiveProfileToggles();
bindShellInteractions();
loadWorkspacePermissions()
    .then(() => {
        syncWorkspacePermissionUI();
        syncCalendarDirectEditToggle();
        renderDashboardState();
    })
    .catch(error => {
        console.warn("No se pudieron cargar permisos del entorno.", error);
    });
initHoursCharts(getPerfilActual);
updateMemosNavBadge();
refreshWorkerRequestsNavBadge();
renderProfiles({ dashboard: false });
renderBotones();
bindAppNavigationHistory();

const hasProfilesAtStartup = getProfiles().length > 0;
const startupTarget = hasProfilesAtStartup
    ? targetFromHash() || "calendarPanel"
    : "profileSection";

setActiveShortcut(startupTarget, { historyMode: "replace" });
