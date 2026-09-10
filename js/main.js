import {
    keyFromDate,
    keyFromISO,
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
import {
    ATTENDANCE_STATE_KEYS,
    importAttendanceFile,
    normalizeRut
} from "./attendanceImport.js";
import { installModalBackdropGuard } from "./modalBackdropGuard.js";
import { leaveTypeNeedsDocument } from "./leaveAttachments.js";
import { formatRut, getRutValidationMessage } from "./rutUtils.js";
import {
    findDuplicateEmailProfile,
    getEmailValidationMessage,
    normalizeEmailKey
} from "./emailUtils.js";
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
    getClockMarkTimingFlags,
    classifyClockMarkSegment
} from "./clockMarkUtils.js";
import {
    cloneDate,
    dateAt,
    formatTime,
    parseTimeValue
} from "./timeUtils.js";
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
    getCalendarProfileSearchOptionValues,
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
    CLIP_ICON,
    getRecordYear,
    renderRecordField,
    renderRecordEntry
} from "./profileRecordsView.js";
import {
    getViewForTarget,
    getViewTopTarget,
    getTargetForActiveView,
    isAppTarget,
    targetFromHash,
    appTargetUrl
} from "./navigation.js";
import { initTheme } from "./theme.js";
import { initPwaInstall } from "./pwaInstall.js";
import { registerSupervisorServiceWorker } from "./serviceWorkerRegistration.js";
import { isMoveShiftAvailable } from "./supervisorActionAvailability.js";
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
    hasContractTypeValueChanged,
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
    addTurnToDay,
    addPreassignedTurnToDay,
    openManualExtraReasonForDay,
    openPreassignmentReasonForDay,
    openReplacementSuggestionsForLeaveBlock,
    updateDayCell,
    updateDayCells,
    updateVisibleCalendarDays,
    getLeaveRecordDocumentButtons,
    openLeaveRecordDocuments
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
    syncStaffingConfigForProfileChange
} from "./staffing.js";
import { renderTaskAssignmentsPanel } from "./taskAssignments.js";
import { renderKanbanBoard } from "./kanban.js";
import { renderShiftHoldersPanel } from "./shiftHolders.js";
import { renderAgendaPanel } from "./agenda.js";
import { renderDashboardPanel } from "./dashboard.js";
import { renderHomePanel, refreshHomeTasks } from "./home.js";
import { scheduleSegmentsForRotativa } from "./workerSchedule.js";
import {
    openWorkerScheduleDialog,
    workerScheduleSummary
} from "./workerScheduleDialog.js";
import {
    fireHomeAlert,
    startHomeTasksSync,
    stopHomeTasksSync,
    startTaskAlertScheduler,
    stopTaskAlertScheduler
} from "./homeTasks.js";
// Se importa por su efecto: monta el aviso de "sin sincronizacion" y se
// suscribe solo. No exporta nada que main.js tenga que llamar.
import "./syncBanner.js";
import {
    formatCoverageTimeLeft,
    runAutoCoverageCycle,
    startAutoCoverageScheduler,
    stopAutoCoverageScheduler
} from "./autoCoverage.js";
import {
    startFirebaseAutoCoverageSync,
    stopFirebaseAutoCoverageSync
} from "./firebaseAutoCoverage.js";
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
    isFirebaseSessionMfaVerified,
    signOutFirebase
} from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";
import {
    flushPendingFirebaseAppStateEntries,
    startFirebaseAppStateSync,
    stopFirebaseAppStateSync
} from "./firebaseAppState.js";
import { startRrhhSummaryBackgroundPublisher } from "./rrhhSummaryPublisher.js";
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
    getLeaveApplicationInfo,
    renderAuditLogPanel
} from "./auditLog.js";
import {
    fetchHolidays,
    getCachedHolidays
} from "./holidays.js";
import { calcHours, isBusinessDay } from "./calculations.js";
import { TURNO } from "./constants.js";
import { getTurnoColorConfig } from "./turnoColors.js";
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
import {
    esTurnoCapacitacionValido,
    moveShiftConfigBlockReason,
    moveShiftTargetCombina24
} from "./rulesEngine.js";
import {
    calcularHorasMesPerfil,
    renderSummaryHTML
} from "./hoursEngine.js";
import { getRaw, setRaw, getJSON, setJSON, listKeys } from "./persistence.js";
import {
    getProfileData,
    saveProfileData,
    getValorHora,
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
    getContractTypeAt,
    addContractHistoryEntry,
    estamentoAllowsCustomProfession,
    getProfessionOptionsForEstamento,
    normalizeProfession,
    SIN_INFORMACION_PROFESSION,
    getTurnChangeConfig
} from "./storage.js";
import { cambioEstaAnulado } from "./swaps.js";
import {
    cancelShiftMovesForWorkerRange,
    cancelFutureShiftMovesForWorker,
    registerShiftMove
} from "./shiftMoves.js";
import {
    cancelReplacementById,
    cancelReplacementsForWorkerRange,
    cancelFutureReplacementsForWorker,
    getActiveCoveredReplacementsForProfileRange,
    renderReplacementLogHTML,
    getHheeMonthRecords
} from "./replacements.js";
import {
    refreshWorkerRequestsNavBadge,
    renderWorkerRequestsPanel,
    setHheeReturnRequestHandler,
    startSupervisorInviteRequestsListener,
    stopSupervisorInviteRequestsListener
} from "./workerRequests.js";
import { initNotificationsBell } from "./notificationsBell.js";
import { initPendingLeaveBlinkSync } from "./pendingLeaveBlinkSync.js";
import {
    WORKER_LINK_STATE,
    getWorkerLinkState,
    listWorkerLinkStates,
    openWorkerAppInviteDialog,
    refreshPendingWorkerInvites,
    sendWorkerAppInviteEmail,
    unlinkWorkerAppForProfile
} from "./workerAppInvites.js";
import {
    createReplacementContractMemoTask,
    renderMemosPanel,
    updateMemosNavBadge
} from "./memos.js";
import {
    initInformationsPanel,
    renderInformationsPanel
} from "./informations.js";
import {
    initMedicalEquipmentPanel,
    renderMedicalEquipmentPanel,
    startMedicalEquipmentReportSync,
    stopMedicalEquipmentReportSync
} from "./medicalEquipment.js";
import {
    initQualificationsPanel,
    renderQualificationsPanel
} from "./qualifications.js";
import {
    addReplacementContract,
    addHonorariaContract,
    removeHonorariaContract,
    updateHonorariaContract,
    getHonorariaContractsForProfile,
    clampContractRange,
    formatContractDate,
    getContractsForProfile,
    isHonorariaContractType,
    isHonorariaProfile,
    isOtherContractType,
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
    aplicarCapacitacion,
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
let profileAvailabilityDraftTouched = false;
let availabilityHistoryYear = new Date().getFullYear();
let availabilityHistoryProfile = "";
let profileRotationMiniDate = new Date();
let replacementContractMonthHint = "";
let profileHoursSummaryRequest = 0;
let clockMarksRenderRequest = 0;
let calendarDirectEditEnabled = false;
const CALENDAR_DIRECT_EDIT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
let calendarDirectEditIdleTimer = 0;
let calendarDirectEditInactivityBound = false;
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
        ],
        fileLabel: "Archivo de respaldo"
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
    // "Evaluaciones de desempeno" se retiro de la vista del perfil: ese
    // trabajo vive ahora en el menu Calificaciones, con su formulario, sus
    // plazos y su escaneado firmado. Tenerlo en los dos sitios invitaba a
    // escribir la evaluacion donde no correspondia.
    //
    // La CLAVE se conserva y `getProfileLogs` la sigue leyendo: los
    // registros que ya existan NO se borran, y Calificaciones los muestra
    // como antecedente del periodo, con su escaneado si lo tenian. Sacar
    // tambien la clave los habria dejado guardados y sin ninguna pantalla
    // que los abriera.
    {
        key: "performance",
        retired: true,
        title: "Evaluaciones de desempe\u00f1o",
        filterYear: true,
        fields: [
            { name: "date", label: "Fecha", type: "date" },
            { name: "detail", label: "Detalle importante", type: "textarea" }
        ],
        fileLabel: "Calificacion escaneada"
    }
];

// Las secciones que se DIBUJAN en el perfil. Las retiradas se quedan fuera
// de la vista pero siguen normalizandose al leer, para no perder lo que ya
// esta guardado.
const HR_LOG_SECTIONS = HR_LOG_CONFIG.filter(config => !config.retired);


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

const COMP_ENTITLEMENT_OPTIONS = [0, 10, 20];
const COMPENSATORY_BLOCK_AMOUNTS = [10, 20];

function normalizeLegalBalanceValue(value) {
    return Math.max(
        0,
        Math.floor(normalizeBalanceValue(value))
    );
}

function normalizeCompEntitlement(value) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric) || numeric <= 0) return 0;

    return numeric > 10 ? 20 : 10;
}

function isCompensatoryBlockAmount(value) {
    return COMPENSATORY_BLOCK_AMOUNTS.includes(Number(value));
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

// Guarda de idempotencia: cada anulacion de permiso (logId unico) restaura el
// saldo manual UNA sola vez. Sin esto, si el evento auditUndoApplied llegara a
// dispararse dos veces para la misma anulacion (doble click / doble listener),
// el saldo se sumaria dos veces (p. ej. 13 -> 26 -> 39).
const restoredBalanceLogIds = new Set();

function restoreLeaveBalanceFromUndo(detail = {}) {
    const field = LEAVE_UNDO_BALANCE_FIELD[detail.leaveType];
    const amount = Number(detail.leaveAmount) || 0;
    const year = Number(detail.leaveYear) || new Date().getFullYear();
    const profile = String(detail.profile || "") || getCurrentProfile();

    if (!field || amount <= 0 || !profile) return;

    const logId = String(detail.logId || "");

    if (logId) {
        if (restoredBalanceLogIds.has(logId)) return;
        restoredBalanceLogIds.add(logId);
    }

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
    const formatMessage = getEmailValidationMessage(
        DOM.profileEmailInput.value
    );
    const duplicateMessage = formatMessage || !isProfileEditing()
        ? ""
        : getProfileEmailDuplicateMessage(
            DOM.profileEmailInput.value,
            profileDraft.mode === PROFILE_MODE.EDIT
                ? profileDraft.originalName
                : ""
        );
    const message = formatMessage || duplicateMessage;

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

function contractBlocksUnionLeave(data = profileDraft) {
    return (
        isReplacementDraft(data) ||
        isHonorariaDraft(data) ||
        isOtherContractType(data.contractType)
    );
}

function contractBlocksGrade(data = profileDraft) {
    return (
        isHonorariaDraft(data) ||
        isOtherContractType(data.contractType)
    );
}

function contractBlocksShiftAssignment(data = profileDraft) {
    return (
        isReplacementDraft(data) ||
        isHonorariaDraft(data) ||
        isOtherContractType(data.contractType)
    );
}

// Honorarios no tiene vacaciones ni permisos administrativos/legales/sin goce: se
// oculta el recuadro de "Vacaciones Disponibles" y se deshabilitan esos permisos
// tanto en el calendario del supervisor como en la PWA del trabajador.
function contractBlocksLeaveBenefits(data = profileDraft) {
    return isHonorariaDraft(data);
}

// Nombre bajo el que se guardan/leen los contratos de Honorarios: al crear es el
// nombre tipeado; al editar, el perfil actual guardado.
function honorariaContractProfileName() {
    if (profileDraft.mode === PROFILE_MODE.CREATE) {
        return String(profileDraft.name || "").trim();
    }

    return getCurrentProfile() ||
        profileDraft.originalName ||
        String(profileDraft.name || "").trim();
}

// Verdadero si algun contrato de Honorarios del trabajador cubre esa fecha ISO.
function honorariaContractCoversISO(iso) {
    if (!iso) return false;

    return getHonorariaContractsForProfile(honorariaContractProfileName())
        .some(contract =>
            contract.start <= iso &&
            contract.end >= iso
        );
}

const HONORARIA_EDIT_ICON = `
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>
    </svg>
`;

function renderHonorariaContractList(profileName) {
    if (!DOM.honorariaContractList) return;

    const contracts = profileName
        ? getHonorariaContractsForProfile(profileName)
        : [];
    const editing = isProfileEditing();

    if (!contracts.length) {
        DOM.honorariaContractList.innerHTML =
            `<div class="honoraria-contract-empty">Sin contratos de honorarios. Agrega el primero abajo.</div>`;
        return;
    }

    DOM.honorariaContractList.innerHTML = contracts
        .map(contract => `
            <div class="honoraria-contract-item">
                <div class="honoraria-contract-item-info">
                    <strong>${escapeHTML(formatDisplayDate(contract.start))} al ${escapeHTML(formatDisplayDate(contract.end))}</strong>
                    <small>Valor hora $${escapeHTML(String(contract.hourlyRate))} · Tope ${escapeHTML(String(contract.maxHours))} ${contract.limitPeriod === "monthly" ? "h/mes" : "h/sem"}</small>
                </div>
                ${editing
                    ? `<div class="honoraria-contract-actions">
                        <button type="button" class="honoraria-contract-edit" data-honoraria-edit="${escapeHTML(contract.id)}" title="Editar contrato" aria-label="Editar contrato">${HONORARIA_EDIT_ICON}</button>
                        <button type="button" class="honoraria-contract-remove" data-honoraria-remove="${escapeHTML(contract.id)}" title="Eliminar contrato" aria-label="Eliminar contrato">&times;</button>
                    </div>`
                    : ""}
            </div>
        `)
        .join("");
}

function placeProfileRotationRow(isHonorariaContract) {
    const row = DOM.profileRotationRow;

    if (!row) return;

    if (
        isHonorariaContract &&
        DOM.honorariaRotationSlot?.parentNode
    ) {
        DOM.honorariaRotationSlot.after(row);
        return;
    }

    if (DOM.profileRotationAnchor?.parentNode) {
        DOM.profileRotationAnchor.after(row);
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

const CRITICAL_PROFILE_STATE_PREFIXES = [
    "data_",
    "baseData_",
    "blocked_",
    "admin_",
    "legal_",
    "comp_",
    "absences_",
    "hourReturns_",
    "hheeReturnTransfers_",
    "leaveBalances_",
    "rotativa_",
    "shift_",
    "shiftAssignmentHistory_",
    "gradeHistory_",
    "contractHistory_",
    "replacementContracts_",
    "clockMarks_",
    "hrLogs_"
];

const CRITICAL_PROFILE_GLOBAL_KEYS = [
    "profiles",
    "auditLog",
    "replacements",
    "swaps",
    "shiftMoves",
    "memos",
    "replacementRequests",
    "workerRequests",
    "staffing_config",
    "staffing_applicants",
    "staffing_custom_reminders"
];

function criticalProfileStateKeys(profileNames = [], extraKeys = []) {
    const keys = new Set([
        ...CRITICAL_PROFILE_GLOBAL_KEYS,
        ...extraKeys
    ]);

    [...new Set(
        (Array.isArray(profileNames) ? profileNames : [profileNames])
            .map(name => String(name || "").trim())
            .filter(Boolean)
    )].forEach(name => {
        CRITICAL_PROFILE_STATE_PREFIXES.forEach(prefix => {
            keys.add(`${prefix}${name}`);
        });

        listKeys(`carry_${name}_`).forEach(key => keys.add(key));
    });

    return [...keys];
}

async function sealCriticalProfileState(profileNames, reason = "profile-save") {
    const workspace = getActiveWorkspace();

    if (!workspace?.id) {
        throw new Error(
            "No se pudo confirmar el guardado: no hay una unidad Firebase activa."
        );
    }

    const result = await flushPendingFirebaseAppStateEntries({
        keys: criticalProfileStateKeys(profileNames),
        reason
    });

    if (!result?.flushed) {
        throw new Error(
            `No se pudo confirmar el guardado en Firebase (${result?.reason || "sin respuesta"}). Intenta nuevamente antes de recargar.`
        );
    }

    return result;
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

    const timeline = [];
    gradeHistory.forEach(entry => {
        timeline.push({
            sort: String(entry.start || ""),
            date: formatDisplayDate(entry.start),
            title: `Grado ${entry.grade || "sin registro"}`,
            badge: "Grado",
            dot: "g",
            sub: [entry.estamento, entry.contractType].filter(Boolean).join(" · ")
        });
    });
    contractHistory.forEach(entry => {
        timeline.push({
            sort: String(entry.effectiveDate || entry.createdAt || ""),
            date: entry.effectiveDate
                ? formatDisplayDate(entry.effectiveDate)
                : formatHistoryDateTime(entry.createdAt),
            title: "Cambio contractual",
            badge: "Cambio",
            dot: "a",
            sub: (entry.changes || [])
                .map(change => `${change.label}: ${change.from || "—"} → ${change.to || "—"}`)
                .join(" · ")
        });
    });
    replacementContracts.forEach(contract => {
        timeline.push({
            sort: String(contract.start || ""),
            date: `${formatContractDate(contract.start)} - ${formatContractDate(contract.end)}`,
            title: "Contrato de reemplazo",
            badge: "Reemplazo",
            dot: "p",
            sub: [
                `Reemplaza a ${contract.replaces || "—"}`,
                contract.reason || ""
            ].filter(Boolean).join(" · ")
        });
    });

    timeline.sort((a, b) => b.sort.localeCompare(a.sort));

    if (!timeline.length) {
        DOM.profileContractHistory.innerHTML = `
            <div class="contract-history-empty">
                Sin historial registrado todavía.
            </div>
        `;
        return;
    }

    DOM.profileContractHistory.innerHTML = `
        <div class="pf-tl">
            ${timeline.map(item => `
                <div class="pf-tl-item">
                    <span class="pf-tl-dot ${item.dot}"></span>
                    <div class="pf-tl-body">
                        <div class="pf-tl-top">
                            <b>${escapeHTML(item.title)}</b>
                            <span class="pf-tl-badge">${escapeHTML(item.badge)}</span>
                            <time>${escapeHTML(item.date)}</time>
                        </div>
                        ${item.sub ? `<p>${escapeHTML(item.sub)}</p>` : ""}
                    </div>
                </div>
            `).join("")}
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

async function resolveReplacementContractCoverageConflicts({
    replacementWorker,
    replaced,
    start,
    end,
    rotationMode
}) {
    const mode = normalizeReplacementRotationMode(
        rotationMode,
        REPLACEMENT_ROTATION_MODE.INHERIT
    );

    if (mode !== REPLACEMENT_ROTATION_MODE.INHERIT) {
        return {
            cancelExisting: false,
            conflicts: []
        };
    }

    const conflicts =
        getActiveCoveredReplacementsForProfileRange(
            replaced,
            start,
            end
        )
            .filter(replacement =>
                replacement.worker !== replacementWorker
            );

    if (!conflicts.length) {
        return {
            cancelExisting: false,
            conflicts: []
        };
    }

    const workerPreview = [...new Set(
        conflicts
            .map(replacement => replacement.worker)
            .filter(Boolean)
    )]
        .slice(0, 4)
        .join(", ");
    const datePreview = conflicts
        .slice(0, 4)
        .map(replacement => formatDisplayDate(replacement.date))
        .join(", ");
    const extraCount = Math.max(0, conflicts.length - 4);
    const cancelExisting = await showConfirm(
        `Ya existen ${conflicts.length} turno(s) de ${replaced} cubierto(s) por otro trabajador${workerPreview ? ` (${workerPreview})` : ""} dentro del contrato seleccionado${datePreview ? `: ${datePreview}${extraCount ? ` y ${extraCount} mas` : ""}` : ""}.\n\nSi anulas esos reemplazos, ${replacementWorker} heredara tambien esos turnos. Si los conservas, ${replacementWorker} heredara solo los turnos restantes.`,
        {
            title: "Turnos ya cubiertos",
            tone: "warning",
            confirmText: "Anular y asignar",
            cancelText: "Conservar existentes"
        }
    );

    return {
        cancelExisting,
        conflicts
    };
}

function applyReplacementContractCoverageDecision(
    replacementWorker,
    decision
) {
    const conflicts = decision?.conflicts || [];

    if (!replacementWorker || !conflicts.length) return;

    if (decision.cancelExisting) {
        conflicts.forEach(replacement => {
            cancelReplacementById(replacement.id, {
                reason: "replacement_contract_inherited",
                details: `Reemplazo anulado al asignar contrato heredado a ${replacementWorker}.`,
                canceledBy: "Contrato Reemplazo"
            });
        });
        return;
    }

    const data = getProfileData(replacementWorker);
    let changed = false;

    conflicts.forEach(replacement => {
        const keyDay = keyFromISO(replacement.date);

        if (
            keyDay &&
            !Object.prototype.hasOwnProperty.call(data, keyDay)
        ) {
            data[keyDay] = TURNO.LIBRE;
            changed = true;
        }
    });

    if (changed) {
        saveProfileData(data, replacementWorker);
    }
}

async function saveReplacementContractFromDraft(
    profileName,
    {
        audit = false,
        memo = true
    } = {}
) {
    const replacementWorker = String(profileName || "").trim();
    const replaced = profileDraft.contractReplaces.trim();
    const requestedStart = profileDraft.contractStart;
    const requestedEnd = profileDraft.contractEnd;
    const rotationMode = normalizeReplacementRotationMode(
        profileDraft.contractRotationMode,
        REPLACEMENT_ROTATION_MODE.INHERIT
    );

    if (
        !replacementWorker ||
        !replaced ||
        !requestedStart ||
        !requestedEnd ||
        !requiresReplacementContract()
    ) {
        return null;
    }

    const clampedRange = clampContractRange(
        requestedStart,
        requestedEnd,
        getContractsForProfile(replacementWorker)
    );

    if (!clampedRange) {
        alert(
            `El periodo del permiso ya esta cubierto por otro contrato de ${replacementWorker}. No se creo un contrato nuevo.`
        );
        return null;
    }

    const start = clampedRange.start;
    const end = clampedRange.end;

    if (start !== requestedStart || end !== requestedEnd) {
        alert(
            `Para no superponer contratos de ${replacementWorker}, el nuevo contrato se ajusto al periodo libre: ${formatDisplayDate(start)} al ${formatDisplayDate(end)}.`
        );
    }

    const coverageDecision =
        await resolveReplacementContractCoverageConflicts({
            replacementWorker,
            replaced,
            start,
            end,
            rotationMode
        });
    const replacementContract = addReplacementContract(
        replacementWorker,
        {
            start,
            end,
            replaces: replaced,
            reason: profileDraft.contractReason,
            leaveRef: profileDraft.contractLeaveRef,
            leaveType: profileDraft.contractReason,
            leaveStart: start,
            leaveEnd: end,
            rotationMode
        }
    );

    applyReplacementContractCoverageDecision(
        replacementWorker,
        coverageDecision
    );

    if (memo) {
        createReplacementContractMemoTask({
            profile: replacementWorker,
            contract: replacementContract
        });
    }

    if (audit) {
        addAuditLog(
            AUDIT_CATEGORY.COLLABORATOR_UPDATED,
            "Agrego contrato de reemplazo",
            `${replacementWorker}: reemplaza a ${replaced} desde ${formatDisplayDate(start)} hasta ${formatDisplayDate(end)}.`,
            {
                profile: replacementWorker,
                replaces: replaced,
                start,
                end,
                contractId: replacementContract.id
            }
        );
    }

    scheduleWorkerAppDataPublish(300, replacementWorker);
    scheduleWorkerAppDataPublish(300, replaced);
    [...new Set(
        (coverageDecision.conflicts || [])
            .map(replacement => replacement.worker)
            .filter(Boolean)
    )].forEach(worker =>
        scheduleWorkerAppDataPublish(300, worker)
    );

    return replacementContract;
}

function openRotationConfigModal(
    type = profileDraft.rotationType,
    options = {}
) {
    if (!isProfileEditing() || !type) return;

    const profile = getPerfilActual();
    const isReplacement = type === "reemplazo";
    const quickContractSave =
        isReplacement && Boolean(options.quickContractSave);
    // Abierto desde la cruz del calendario (o desde sugerencias de reemplazo):
    // solo se ofrecen trabajadores cuyo permiso/ausencia cubre ESA fecha. Desde
    // el perfil no llega sourceKeyDay -> se listan todos (flujo actual).
    const contractCoverISO = options.sourceKeyDay
        ? calendarKeyToInputDate(options.sourceKeyDay)
        : "";
    const quickCancelProfile =
        String(options.previousProfileName || "").trim();
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
    const cancelModal = () => {
        const selectedName =
            profileDraft.name ||
            profile?.name ||
            getCurrentProfile();

        close();

        if (quickContractSave) {
            replacementContractMonthHint = "";
            exitProfileMode(quickCancelProfile || selectedName);
        }
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
                !honorariaContractCoversISO(selected)
            ) {
                alert("Selecciona una fecha de inicio dentro de la vigencia de un contrato de Honorarios.");
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
    const save = async () => {
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

            if (quickContractSave) {
                try {
                    const savedContract =
                        await saveReplacementContractFromDraft(
                            profileDraft.name ||
                                profile?.name ||
                                getCurrentProfile(),
                            {
                                audit: true,
                                memo: true
                            }
                        );

                    if (!savedContract) {
                        alert("No se pudo guardar el contrato de reemplazo.");
                        return;
                    }

                    const selectedName =
                        profileDraft.name ||
                        profile?.name ||
                        getCurrentProfile();

                    close();
                    replacementContractMonthHint = "";
                    exitProfileMode(selectedName);
                    refreshAll();
                    return;
                } catch (error) {
                    alert(
                        error.message ||
                        "No se pudo guardar el contrato de reemplazo."
                    );
                    return;
                }
            }
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
                !honorariaContractCoversISO(iso);
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
                    getReplacementLeaveOptionsForProfile,
                coverISO: contractCoverISO
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
                ? "Selecciona el inicio de la rotativa dentro de la vigencia de un contrato de Honorarios."
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
            cancelModal();
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
            await save();
            return;
        }

        if (action === "cancel") {
            cancelModal();
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
    const effectiveContractType =
        getContractTypeAt(profile.name, startISO) ||
        profile.contractType;
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
        isHonorariaContractType(effectiveContractType) &&
        !getHonorariaContractsForProfile(profile.name).some(contract =>
            contract.start <= startISO &&
            contract.end >= startISO
        )
    ) {
        // Sin contrato vigente esa fecha: modal interactivo para crear (o extender)
        // un contrato de Honorarios sobre el calendario. Al guardarlo se reaplica la
        // rotativa desde el inicio del contrato; si se cancela, se conserva el modo
        // de seleccion para elegir otra fecha.
        const savedContract = await openHonorariaContractModal({
            profileName: profile.name,
            startISO
        });

        if (!savedContract) return;

        await applyCalendarRotationChange(
            parseInputDate(savedContract.start)
        );

        return;
    }

    const overlapDecision = await requestRotationOverlapDecision({
        profileName: profile.name,
        requestedType: type,
        requestedStart: startISO,
        requestedFirstTurn: firstTurn,
        currentRotation: getRotativa(profile.name)
    });

    if (!overlapDecision) {
        return;
    }

    pendingRotationChange = null;
    clearSelectionMode(false);

    await withBusyState(async () => {
        pushHistory();

        if (overlapDecision.mode === "limit") {
            await applyDraftRotation(type, startISO, firstTurn, {
                cleanupStart: type === "libre" ? startISO : "",
                endISO: overlapDecision.endISO
            });
        } else {
            // Preserva el horario anterior a la fecha elegida antes de reubicar el
            // inicio de la rotativa (evita que se borren los turnos "hacia atras").
            // En Honorarios NO se congela: el motor base computa todo anclado al
            // primer contrato, y congelar dejaria turnos explicitos que se mezclarian
            // con la rotativa nueva.
            if (!isHonorariaContractType(effectiveContractType)) {
                freezePriorRotationSchedule(startISO);
            }

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
        }

        const rotationDateText =
            overlapDecision.mode === "limit"
                ? ` desde ${formatDisplayDate(startISO)} hasta ${formatDisplayDate(overlapDecision.endISO)}`
                : ` desde ${formatDisplayDate(startISO)}`;
        const firstTurnText =
            requiresRotationFirstTurn(type)
                ? ` iniciando con ${getRotationFirstTurnLabel(firstTurn, type)}`
                : "";
        const actionLabel =
            overlapDecision.mode === "limit"
                ? "Aplic\u00f3 rotativa historica desde calendario"
                : "Modifico rotativa desde calendario";

        addAuditLog(
            AUDIT_CATEGORY.CALENDAR,
            actionLabel,
            `${profile.name}: ${getRotativaLabel(type)}${rotationDateText}${firstTurnText}.`,
            {
                profile: profile.name,
                date: startISO,
                endDate: overlapDecision.endISO,
                rotationType: type,
                firstTurn,
                mode: overlapDecision.mode
            }
        );
        await sealCriticalProfileState(
            [profile.name],
            "calendar-rotation-save"
        );
    }, {
        label: "Aplicando y confirmando rotativa..."
    });
}

// Vigencia de un cambio de grado, estamento o tipo de contrato.
//
// Va a MES CERRADO, igual que la asignacion de turno. Antes se pedia una fecha
// libre y un grado podia empezar a mitad de mes, lo que partia el mes en dos
// valores hora distintos y hacia imposible cuadrar el pago: los valores por
// grado tambien se definen por rangos de meses.
//
// Devuelve el dia 1 del mes elegido (o "" si se cancela), porque el historial
// guarda fechas completas.
async function requestGradeEffectiveDate(previousSnapshot, nextProfile) {
    const previousContract = previousSnapshot?.contractType || "sin contrato";
    const nextContract = nextProfile?.contractType || "sin contrato";
    const previousGrade = previousSnapshot?.grade || "sin grado";
    const nextGrade = nextProfile?.grade || "sin grado";
    const previousRole = previousSnapshot?.estamento || "sin estamento";
    const nextRole = nextProfile?.estamento || "sin estamento";
    const contractChanged = String(previousContract) !== String(nextContract);
    const title = contractChanged
        ? "Vigencia del nuevo contrato"
        : "Vigencia del nuevo grado";
    const previousLabel = [
        previousContract,
        previousRole,
        `grado ${previousGrade}`
    ].filter(Boolean).join(" | ");
    const nextLabel = [
        nextContract,
        nextRole,
        `grado ${nextGrade}`
    ].filter(Boolean).join(" | ");
    const note = contractChanged
        ? "Los meses anteriores mantendran el tipo de contrato previo."
        : "Los meses anteriores mantendran el valor del grado anterior.";

    while (true) {
        const value = await showPrompt(
            `${contractChanged ? "El tipo de contrato" : "El grado/estamento"} ` +
            `cambiara de "${previousLabel}" a "${nextLabel}".\n\n` +
            "Selecciona el mes desde el cual rige la nueva condicion. " +
            `El cambio regira desde el dia 1 de ese mes. ${note}`,
            {
                title,
                tone: "info",
                inputType: "month",
                inputLabel: "Mes de inicio",
                value: toMonthInputValue(new Date()),
                confirmText: "Guardar vigencia"
            }
        );

        if (value === null) return "";

        const month = String(value || "").trim();

        if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
            return `${month}-01`;
        }

        alert("Selecciona un mes valido para la vigencia.");
    }
}

// Carga del informe del reloj control. Llena las columnas Entrada y Salida del
// detalle de turnos, buscando cada marca por RUT.
// Las fechas del resumen se muestran como se leen en Chile. Internamente
// viajan en ISO, que es lo que ordena bien, pero eso no tiene por que verse.
// Tras aplicar una licencia medica, ofrece adjuntar su respaldo.
//
// Solo para los tipos que lo llevan: un permiso administrativo o un feriado
// legal no tienen documento que adjuntar.
async function offerLeaveDocumentPrompt(fecha) {
    if (!leaveTypeNeedsDocument(licenseType)) return;

    // getPerfilActual devuelve el perfil entero, no el nombre. Usarlo tal cual
    // comparaba "[object Object]" contra el LOG y este aviso tampoco salia.
    const profile = getPerfilActual()?.name || "";
    const keyDay = keyFromDate(fecha);
    // getLeaveApplicationInfo recibe un objeto: pasarle los argumentos sueltos
    // devolvia siempre null y este aviso no salia nunca.
    const info = getLeaveApplicationInfo({
        profile,
        keyDay,
        type: licenseType,
        sourceMap: getJSON(`absences_${profile}`, {})
    });
    const logId = String(info?.logId || "");

    // Sin registro en el LOG no hay a que asociar el documento.
    if (!profile || !logId) return;

    const label = licenseType === "professional_license"
        ? "LM Profesional"
        : "Licencia Medica";
    const confirmed = await showConfirm(
        `Se aplico la ${label} de ${profile}. ` +
        "¿Quieres adjuntar el documento de respaldo ahora?",
        {
            title: "Respaldo de la licencia",
            confirmText: "Adjuntar documento",
            cancelText: "Ahora no"
        }
    );

    if (!confirmed) return;

    window.openLeaveDocumentsDialog?.({
        profile,
        logId,
        title: `${label} · respaldo`
    });
}

function formatImportDate(iso) {
    const [year, month, day] = String(iso || "").split("-");

    return year && month && day
        ? `${day}/${month}/${year}`
        : String(iso || "");
}

function bindAttendanceImport() {
    const input = DOM.attendanceImportInput;
    const status = DOM.attendanceImportStatus;

    if (!input || input.dataset.bound === "1") return;

    input.dataset.bound = "1";
    input.addEventListener("change", async () => {
        const file = input.files?.[0];

        // Se limpia siempre: si no, volver a elegir el MISMO archivo no dispara
        // "change" y parece que la app se quedo pegada.
        input.value = "";

        if (!file) return;

        const show = (text, tone) => {
            // El mismo aviso, donde se lo pueda ver. En Reportes va bajo el
            // boton; si el archivo se adjunto desde el inicio, ese texto no
            // esta a la vista y el aviso sale como toast.
            if (document.body.dataset.activeView !== "reports") {
                showAppToast(text, {
                    title: "Registros del reloj",
                    variant: tone === "ok"
                        ? "success"
                        : tone === "error"
                            ? "warn"
                            : "info"
                });
            }

            if (!status) return;

            status.textContent = text;
            status.className = `attendance-import__status attendance-import__status--${tone}`;
        };

        show(`Leyendo ${file.name}...`, "info");

        try {
            const result = await importAttendanceFile(file);
            const partes = [
                `${result.added} marca(s) nueva(s)`,
                result.duplicated
                    ? `${result.duplicated} ya estaban`
                    : "",
                result.workers
                    ? `${result.workers} trabajador(es)`
                    : "",
                result.dates.length
                    ? `del ${formatImportDate(result.dates[0])} ` +
                      `al ${formatImportDate(result.dates.at(-1))}`
                    : ""
            ].filter(Boolean);

            show(partes.join(" · "), result.added ? "ok" : "info");
            refreshAll();
        } catch (error) {
            console.warn("No se pudo importar el registro de asistencia.", error);
            show(
                error?.message || "No se pudo leer el archivo.",
                "error"
            );
        }
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
        hheeRecordsCache = [];
        clearHheeExtras();
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

    // Comparativa vs. mes anterior (para el chip del resumen).
    const prevBase = new Date(y, m - 1, 1);
    const prevY = prevBase.getFullYear();
    const prevM = prevBase.getMonth();
    const prevHolidays = prevY === y ? holidays : await fetchHolidays(prevY);

    if (requestId !== profileHoursSummaryRequest) return;

    const prevStats = getHheeMonthStats(profile.name, prevY, prevM, prevHolidays);
    const curTotalHours =
        (Number(stats.hheeDiurnas) || 0) + (Number(stats.hheeNocturnas) || 0);
    const prevTotalHours =
        (Number(prevStats.hheeDiurnas) || 0) + (Number(prevStats.hheeNocturnas) || 0);
    const deltaHours = curTotalHours - prevTotalHours;
    const prevLabel = prevBase.toLocaleString("es-CL", { month: "long" });

    summary.innerHTML = renderSummaryHTML(stats, { deltaHours, prevLabel });

    renderHheeKpis(profile, y, m, stats, holidays);

    hheeRecordsProfileName = profile.name;
    hheeRecordsCache = getHheeMonthRecords(profile.name, y, m, holidays);
    renderHheeRecordsList();
}

let hheeRecordsCache = [];
let hheeOnlyMissing = false;
let hheeRecordsProfileName = "";

const HHEE_KPI_PAY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>`;
const HHEE_KPI_YEAR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V9M10 19V4M16 19v-7M22 19H2"></path></svg>`;
const HHEE_KPI_BANK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M4 21V10l8-5 8 5v11M9 21v-6h6v6"></path></svg>`;
const HHEE_KPI_DIST_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>`;
const HHEE_RESP_OK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>`;
const HHEE_RESP_MISSING_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16h.01"></path></svg>`;

function fmtHheeHours(value) {
    const n = Math.round((Number(value) || 0) * 10) / 10;
    return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}

function clearHheeExtras() {
    const kpis = document.getElementById("hheeKpis");
    if (kpis) kpis.innerHTML = "";

    const bar = document.getElementById("hheeRespBar");
    const txt = document.getElementById("hheeRespTxt");
    if (bar) bar.style.width = "0%";
    if (txt) txt.textContent = "0 de 0";
}

function renderHheeKpis(profile, year, month, stats, holidays) {
    const host = document.getElementById("hheeKpis");
    if (!host) return;

    const currency = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
    const enabled = stats.returnTransferEnabled;

    const monthHours =
        (Number(stats.hheeDiurnas) || 0) + (Number(stats.hheeNocturnas) || 0);
    const monthPago =
        (Number(stats.paymentDiurno) || 0) + (Number(stats.paymentNocturno) || 0);

    // Acumulado del anio (enero..mes actual del anio seleccionado).
    let yearHours = 0;
    let yearPago = 0;
    for (let mm = 0; mm <= month; mm++) {
        const s = mm === month
            ? stats
            : getHheeMonthStats(profile.name, year, mm, holidays);
        yearHours += (Number(s.hheeDiurnas) || 0) + (Number(s.hheeNocturnas) || 0);
        yearPago += (Number(s.paymentDiurno) || 0) + (Number(s.paymentNocturno) || 0);
    }

    const bankHours = normalizeBalanceValue(
        getManualLeaveBalances(year, profile.name).hoursReturn
    );

    const nightPct = monthHours > 0
        ? Math.round(((Number(stats.hheeNocturnas) || 0) / monthHours) * 100)
        : 0;
    const dayPct = monthHours > 0 ? 100 - nightPct : 0;

    const yearMoney = yearPago >= 1e6
        ? `$${(yearPago / 1e6).toFixed(2).replace(".", ",")}M`
        : `$${currency.format(yearPago)}`;

    host.innerHTML = `
        <div class="hh-kpi kpi-pay">
            <span class="k-ico">${HHEE_KPI_PAY_ICON}</span>
            <div class="k-lbl">Total del mes</div>
            <div class="k-val">${enabled ? `${fmtHheeHours(monthHours)} h` : `$${currency.format(monthPago)}`}</div>
            <div class="k-sub">${enabled ? "a devolución" : `${fmtHheeHours(monthHours)} h extraordinarias`}</div>
        </div>
        <div class="hh-kpi kpi-year">
            <span class="k-ico">${HHEE_KPI_YEAR_ICON}</span>
            <div class="k-lbl">Acumulado ${year}</div>
            <div class="k-val">${fmtHheeHours(yearHours)} h</div>
            <div class="k-sub">${yearMoney} en el año</div>
        </div>
        <div class="hh-kpi kpi-bank">
            <span class="k-ico">${HHEE_KPI_BANK_ICON}</span>
            <div class="k-lbl">Banco de devolución</div>
            <div class="k-val">${fmtHheeHours(bankHours)} h</div>
            <div class="k-sub">disponibles para tomar</div>
        </div>
        <div class="hh-kpi kpi-dist">
            <span class="k-ico">${HHEE_KPI_DIST_ICON}</span>
            <div class="k-lbl">Distribución</div>
            <div class="k-val">${nightPct}%</div>
            <div class="k-sub">nocturnas · ${dayPct}% diurnas</div>
        </div>
    `;
}

function renderHheeRecordsList() {
    const host = DOM.hheeMonthlyRecords;
    if (!host) return;

    const all = hheeRecordsCache;
    const events = all.filter((r) => !r.adjustment);
    const total = events.length;
    const backedCount = events.filter((r) => r.backed).length;

    const bar = document.getElementById("hheeRespBar");
    const txt = document.getElementById("hheeRespTxt");
    if (bar) bar.style.width = total ? `${Math.round((backedCount / total) * 100)}%` : "0%";
    if (txt) txt.textContent = `${backedCount} de ${total}`;

    if (!all.length) {
        host.innerHTML = `<div class="hh-rec-empty">Sin registros de HHEE en este mes.</div>`;
        return;
    }

    const rows = all.filter((r) => !hheeOnlyMissing || !r.backed);

    if (!rows.length) {
        host.innerHTML = `<div class="hh-rec-empty">Todos los registros del mes tienen respaldo.</div>`;
        return;
    }

    host.innerHTML = `<div class="hh-rec-list">${rows.map((r, index) => {
        const negative = r.adjustment ? " hh-hchip-neg" : "";
        const chips = [
            r.d ? `<span class="hh-hchip hh-hchip-d${negative}">${fmtHheeHours(r.d)} h diurnas</span>` : "",
            r.n ? `<span class="hh-hchip hh-hchip-n${negative}">${fmtHheeHours(r.n)} h nocturnas</span>` : ""
        ].join("");
        const resp = r.adjustment
            ? `<span class="hh-resp adjust">${HHEE_RESP_MISSING_ICON} Descuento</span>`
            : r.backed
                ? `<span class="hh-resp ok">${HHEE_RESP_OK_ICON} Con respaldo</span>`
                : `<span class="hh-resp missing">${HHEE_RESP_MISSING_ICON} Sin respaldo</span>`;

        // La fecha abre el cuadro que corresponde a ese registro: asignar el
        // respaldo que falta, ver o corregir el marcaje, o anular el turno
        // extra. Antes habia que ir al calendario, buscar el dia y clickear la
        // casilla.
        const action = hheeRecordActionTitle(r);

        return `
            <div class="hh-rec${r.adjustment ? " is-adjustment" : r.backed ? "" : " is-missing"}">
                <button
                    class="hh-rec__date hh-rec__date--action"
                    type="button"
                    data-hhee-record-index="${index}"
                    title="${escapeHTML(action)}"
                    aria-label="${escapeHTML(`${r.dateLabel}: ${action}`)}"
                ><strong>${escapeHTML(r.day)}</strong><small>${escapeHTML(r.monthShort)}</small></button>
                <span class="hh-turno ${r.badgeClass}">${escapeHTML(r.label)}</span>
                <div class="hh-rec__hours">${chips}</div>
                <span class="hh-rec__spacer"></span>
                ${resp}
                <small class="hh-rec__detail">${escapeHTML(r.detail)}</small>
            </div>`;
    }).join("")}</div>`;

    host.querySelectorAll("[data-hhee-record-index]").forEach((button) => {
        button.onclick = () =>
            openHheeRecordAction(rows[Number(button.dataset.hheeRecordIndex)]);
    });
}

// Que ofrece la fecha de cada registro, segun lo que le falta a ese dia.
function hheeRecordActionTitle(record) {
    if (record?.kind === "pending-manual" || record?.kind === "pending-clock") {
        return "Asignar el respaldo de estas horas extras";
    }

    if (record?.kind === "clock-backing" || record?.kind === "deficit") {
        return "Ver o modificar el marcaje de este día";
    }

    return "Ver el turno extra y anularlo si corresponde";
}

async function openHheeRecordAction(record) {
    const profileName = hheeRecordsProfileName;
    const keyDay = record?.keyDay || "";

    if (!profileName || !keyDay) return;

    if (record.kind === "pending-manual") {
        await window.openExtraReasonDialog?.(
            profileName,
            keyDay,
            Number(record.pendingTurn) || 0
        );
        return;
    }

    if (record.kind === "pending-clock") {
        await window.openClockExtraReasonDialog?.(
            profileName,
            keyDay,
            Number(record.state) || 0
        );
        return;
    }

    if (record.kind === "clock-backing" || record.kind === "deficit") {
        // El detalle del marcaje lleva dentro el boton para modificarlo.
        window.openClockMarkDetailForDate?.(profileName, keyDay);
        return;
    }

    await window.openReplacementDetailDialog?.(
        profileName,
        keyDay,
        record.replacementId || ""
    );
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

const HR_LOG_ICON_SVG = {
    academic: `<path d="M22 10 12 5 2 10l10 5 10-5z"></path><path d="M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5"></path>`,
    training: `<path d="M12 2 2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5M2 12l10 5 10-5"></path>`,
    diplomas: `<circle cx="12" cy="8" r="6"></circle><path d="M8.5 13 7 22l5-3 5 3-1.5-9"></path>`,
    experience: `<rect x="2" y="7" width="20" height="14" rx="2"></rect><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"></path>`,
    events: `<rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18"></path>`,
    merit: `<path d="M12 2 15 9l7 .5-5.3 4.7L18.5 22 12 18l-6.5 4 1.8-7.8L2 9.5 9 9z"></path>`,
    demerit: `<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path><path d="M12 9v4M12 17h.01"></path>`,
    performance: `<path d="M9 11l3 3 8-8"></path><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"></path>`
};
const HR_LOG_ICON_CLASS = {
    academic: "blue",
    training: "green",
    diplomas: "purple",
    experience: "amber",
    events: "blue",
    merit: "green",
    demerit: "amber",
    performance: "teal"
};
const PF_REC_EDIT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>`;

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

    const iconSvg = HR_LOG_ICON_SVG[config.key] || "";
    const iconClass = HR_LOG_ICON_CLASS[config.key] || "blue";
    const pencil = editing
        ? ""
        : `<button class="pf-rec-edit" type="button" data-record-editmode aria-label="Editar ${escapeHTML(config.title)}" title="Editar / agregar">${PF_REC_EDIT_ICON}</button>`;
    const balanceHTML = config.key === "merit"
        ? `
            <div class="pf-rec-bal">
                <span class="pos"><b>${(logs.merit || []).length}</b> Mérito</span>
                <span class="neg"><b>${(logs.demerit || []).length}</b> Demérito</span>
            </div>
        `
        : "";

    return `
        <section class="record-card" data-record="${config.key}">
            <div class="pf-rec-head">
                <span class="pf-rec-ico ${iconClass}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${iconSvg}</svg></span>
                <h4>${escapeHTML(config.title)}</h4>
                <span class="pf-rec-spacer"></span>
                ${filterHTML}
                <span class="pf-rec-count${entries.length ? "" : " zero"}">${entries.length}</span>
                ${pencil}
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

            ${balanceHTML}

            <div class="record-list">
                ${filteredEntries.length
                    ? filteredEntries
                        .slice()
                        .reverse()
                        .map(entry => renderRecordEntry(config, entry))
                        .join("")
                    : `
                        <div class="pf-rec-empty">
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

    const totalRecords = HR_LOG_SECTIONS.reduce(
        (sum, config) => sum + (logs[config.key] || []).length,
        0
    );
    const totalEl = document.getElementById("profileRecordsTotal");
    if (totalEl) {
        totalEl.textContent = `${totalRecords} ${totalRecords === 1 ? "registro" : "registros"}`;
    }

    DOM.profileRecordsPanel.innerHTML = HR_LOG_SECTIONS
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
                const config = HR_LOG_SECTIONS.find(item =>
                    item.key === button.dataset.recordAdd
                );

                if (config) {
                    addProfileRecord(profile.name, config);
                }
            };
        });

    DOM.profileRecordsPanel
        .querySelectorAll("[data-record-editmode]")
        .forEach(button => {
            button.onclick = () => startEditMode();
        });

    // Abrir el archivo adjunto de un registro. Vale para todos los recuadros
    // del perfil -evaluaciones, capacitaciones, titulos, experiencia...-, porque
    // todos pintan sus entradas con el mismo renderRecordEntry.
    DOM.profileRecordsPanel
        .querySelectorAll("[data-record-attachment]")
        .forEach(button => {
            button.onclick = async () => {
                const logs = getProfileLogs(profile.name);
                const entry = (logs[button.dataset.recordKey] || []).find(item =>
                    String(item.id) === button.dataset.recordAttachment
                );

                if (!entry?.file) return;

                button.disabled = true;

                try {
                    await openAttachmentFile(entry.file, { newTab: true });
                } catch (error) {
                    console.warn("No se pudo abrir el adjunto del registro.", error);
                    alert(error.message || "No se pudo abrir el archivo adjunto.");
                } finally {
                    button.disabled = false;
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

function pfLeaveColor(label) {
    const l = String(label || "").toLowerCase();
    if (l.includes("legal")) return "var(--green)";
    if (l.includes("administrativo")) return "var(--accent)";
    if (l.includes("licencia")) return "var(--red)";
    if (l.includes("compensatorio")) return "var(--yellow)";
    if (l.includes("goce")) return "var(--purple)";
    if (l.includes("devoluci")) return "var(--teal)";
    return "var(--muted)";
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
    const totalsByLabel = new Map();
    records.forEach(record => {
        if (record.amount === null) return;
        totalsByLabel.set(
            record.label,
            (totalsByLabel.get(record.label) || 0) + (Number(record.amount) || 0)
        );
    });
    const summaryHTML = totalsByLabel.size
        ? `
            <div class="pf-leave-sum">
                ${Array.from(totalsByLabel.entries()).map(([label, total]) => `
                    <span><span class="d" style="background:${pfLeaveColor(label)}"></span> ${escapeHTML(label)} <b>${formatSaldo(total)} ${total === 1 ? "d\u00eda" : "d\u00edas"}</b></span>
                `).join("")}
            </div>
        `
        : "";

    // Cada permiso ofrece el mismo documento que sus casillas del calendario:
    // la licencia medica su respaldo, y el resto el de su memorandum.
    const documentButtons = getLeaveRecordDocumentButtons(
        profileName,
        records.map(record => record.startKey)
    );

    const rowsHTML = records.length
        ? `
            <div class="pf-leave-grid">
                ${records.map(record => {
                    const start = formatAvailabilityHistoryDate(record.startKey);
                    const end = formatAvailabilityHistoryDate(record.endKey);
                    const period = start === end ? start : `${start} al ${end}`;
                    const days = record.amount === null
                        ? ""
                        : `<span class="ldays">${formatSaldo(record.amount)} ${record.amount === 1 ? "d\u00eda" : "d\u00edas"}</span>`;

                    const docsLabel = documentButtons.get(record.startKey);
                    const docsButton = docsLabel
                        ? `<button class="pf-rec-clip pf-leave-docs" type="button" data-leave-record-docs="${escapeHTML(record.startKey)}">${CLIP_ICON}${escapeHTML(docsLabel)}</button>`
                        : "";

                    return `
                        <div class="pf-leave-item" style="border-left-color:${pfLeaveColor(record.label)}">
                            <div class="lx">
                                <b>${escapeHTML(record.label)}</b>
                                <small>${escapeHTML(period)}</small>
                            </div>
                            ${days}
                            ${docsButton}
                        </div>
                    `;
                }).join("")}
            </div>
        `
        : `
            <div class="pf-leave-empty">
                Sin vacaciones o ausencias registradas en ${availabilityHistoryYear}.
            </div>
        `;

    return `
        <section class="pf-leave" aria-label="Registro de vacaciones y ausencias">
            <div class="pf-leave-head">
                <strong>Registro de vacaciones / ausencias</strong>
                <label class="pf-leave-year">
                    <span>A&ntilde;o</span>
                    <select id="availabilityHistoryYear" aria-label="A&ntilde;o del registro">
                        ${yearOptions}
                    </select>
                </label>
            </div>
            ${summaryHTML}
            ${rowsHTML}
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

// El registro de vacaciones/ausencias vive en su propia tarjeta full-width
// (separada del recuadro de Vacaciones), como el mockup.
function setLeaveHistoryHTML(html) {
    const card = document.getElementById("profileLeaveCard");
    const host = document.getElementById("profileLeaveHistory");

    if (card) card.classList.toggle("hidden", !html);
    if (host) host.innerHTML = html || "";
    if (html) {
        bindAvailabilityHistoryYear();
        bindLeaveRecordDocuments(host);
    }
}

// Cada permiso del registro abre el mismo cuadro de documentos que su casilla
// del calendario. Al cerrarlo se redibuja solo el registro, no el recuadro de
// saldos, que puede estar a medio editar: si se subio el primer documento, el
// boton pasa de "Adjuntar documento" a "Ver documento".
function bindLeaveRecordDocuments(host) {
    const profileName = availabilityHistoryProfile;

    host
        ?.querySelectorAll("[data-leave-record-docs]")
        .forEach(button => {
            button.onclick = () => {
                openLeaveRecordDocuments(
                    profileName,
                    button.dataset.leaveRecordDocs,
                    {
                        onClose: () => {
                            if (getPerfilActual()?.name !== profileName) return;
                            setLeaveHistoryHTML(
                                availabilityHistoryHTML(profileName)
                            );
                        }
                    }
                );
            };
        });
}

function renderDisponibilidadVacaciones() {
    if (!DOM.availabilitySummary) return;

    const profile = getPerfilActual();
    const creating =
        profileDraft.mode === PROFILE_MODE.CREATE;
    // Honorarios no tiene vacaciones ni permisos: se oculta todo el recuadro.
    const blocksLeaveBenefits = creating
        ? contractBlocksLeaveBenefits(profileDraft)
        : contractBlocksLeaveBenefits(profile || {});

    if (DOM.profileAvailabilityCard) {
        DOM.profileAvailabilityCard.classList.toggle(
            "hidden",
            blocksLeaveBenefits
        );
    }

    if (blocksLeaveBenefits) {
        availabilityEditMode = false;
        setLeaveHistoryHTML("");
        return;
    }

    if (!profile && !creating) {
        availabilityEditMode = false;
        availabilityHistoryProfile = "";
        setLeaveHistoryHTML("");

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
    const shiftAssignmentAvailable =
        creating
            ? !contractBlocksShiftAssignment(profileDraft)
            : !contractBlocksShiftAssignment(profile || {});
    const showCompBalance =
        shiftAssignmentAvailable &&
        (
            isProfileEditing()
                ? Boolean(profileDraft.shiftAssigned)
                : getShiftAssigned(profile.name, currentDate)
        );
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
                FL solo admite d&iacute;as completos. FC anual puede ser 0, 10 o 20 d&iacute;as.
            </div>
        `;

        if (creating) {
            createAvailabilityBalances = {
                ...defaultCreateAvailabilityBalances(),
                ...saldos
            };
        }

        [
            ["availabilityLegalInput", "legal"],
            ["availabilityCompInput", "comp"],
            ["availabilityAdminInput", "admin"],
            ["availabilityHoursReturnInput", "hoursReturn"]
        ].forEach(([id, field]) => {
            const input = document.getElementById(id);

            if (!input) return;

            input.oninput = () => {
                profileAvailabilityDraftTouched = true;
                if (creating) {
                    createAvailabilityBalances[field] =
                        input.value;
                }
            };
            input.onchange = input.oninput;
        });

        setLeaveHistoryHTML(historyHTML);

        return;
    }

    // Donut de vacaciones en DIAS: disponibles (todos los tipos agrupados) vs
    // usados (dias tomados este anio). No considera horas de devolucion.
    const legalDays = Number(saldos.legal) || 0;
    const compDays = showCompBalance ? (Number(saldos.comp) || 0) : 0;
    const adminDays = Number(saldos.admin) || 0;
    const disponibles = legalDays + compDays + adminDays;

    const leaveYear = creating
        ? []
        : getProfileLeaveHistory(profile.name, year);
    let usedAdmin = 0;
    let usedTotal = 0;
    leaveYear.forEach(record => {
        if (record.amount == null) return;
        const label = String(record.label || "").toLowerCase();
        const amount = Number(record.amount) || 0;
        if (
            label.includes("legal") ||
            label.includes("compensatorio") ||
            label.includes("administrativo")
        ) {
            usedTotal += amount;
            if (label.includes("administrativo")) usedAdmin += amount;
        }
    });
    const totalDays = disponibles + usedTotal;
    const adminEntitlement = adminDays + usedAdmin;

    const DONUT_C = 97.389;
    const dispLen = totalDays > 0 ? (disponibles / totalDays) * DONUT_C : 0;
    const donutArcs = totalDays > 0
        ? `<circle cx="21" cy="21" r="15.5" fill="none" stroke="var(--green)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${dispLen.toFixed(2)} ${(DONUT_C - dispLen).toFixed(2)}" stroke-dashoffset="0" transform="rotate(-90 21 21)"></circle>`
        : "";

    const legendRow = (color, label, value) => `
        <div class="row"><span class="d" style="background:${color}"></span> ${label} <b>${value}</b></div>
    `;

    DOM.availabilitySummary.innerHTML = `
        <div class="pf-vac">
            <div class="pf-donut">
                <svg viewBox="0 0 42 42" width="122" height="122">
                    <circle cx="21" cy="21" r="15.5" fill="none" stroke="var(--panel-hover)" stroke-width="6"></circle>
                    ${donutArcs}
                </svg>
                <div class="pf-donut-center"><b>${formatSaldo(disponibles)}</b><small>de ${formatSaldo(totalDays)} d\u00edas</small></div>
            </div>
            <div class="pf-vac-legend">
                ${legendRow("var(--green)", "Disponibles", `${formatSaldo(disponibles)} d`)}
                ${legendRow("var(--panel-hover)", "Usados", `${formatSaldo(usedTotal)} d`)}
                ${legendRow("var(--blue)", "Administrativos", `${formatSaldo(usedAdmin)} / ${formatSaldo(adminEntitlement)} d`)}
            </div>
        </div>

        <div class="availability-note">
            Saldos vigentes del a\u00f1o ${year}.
        </div>
    `;

    setLeaveHistoryHTML(historyHTML);
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
        if (DOM.trainingBtn) DOM.trainingBtn.disabled = true;
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
    const effectiveProfile = {
        ...profile,
        contractType:
            getContractTypeAt(profile.name, currentDate) ||
            profile.contractType
    };
    const canUseUnionLeave =
        Boolean(profile.unionLeaveEnabled) &&
        !isReplacementContractType(effectiveProfile.contractType) &&
        !isHonorariaContractType(effectiveProfile.contractType) &&
        !isOtherContractType(effectiveProfile.contractType);
    // Honorarios no puede tomar P. Administrativo, 1/2 ADM, F. Legal ni permiso sin
    // goce: esos botones quedan deshabilitados.
    const blocksLeaveBenefits =
        contractBlocksLeaveBenefits(effectiveProfile);

    DOM.adminBtnLabel.textContent =
        `${adminBase} (${formatSaldo(saldos.admin)})`;
    DOM.compBtnLabel.textContent =
        `${compBase} (${formatSaldo(saldos.comp)})`;
    DOM.legalBtnLabel.textContent =
        `${legalBase} (${formatSaldo(saldos.legal)})`;
    DOM.hoursReturnBtnLabel.textContent =
        `${hoursReturnBase} (${formatSaldo(saldos.hoursReturn)})`;

    DOM.adminBtn.disabled = blocksLeaveBenefits || saldos.admin <= 0;
    DOM.halfAdminMorningBtn.disabled = blocksLeaveBenefits || saldos.admin <= 0;
    DOM.halfAdminAfternoonBtn.disabled = blocksLeaveBenefits || saldos.admin <= 0;
    DOM.compBtn.disabled = saldos.comp <= 0;
    DOM.legalBtn.disabled = blocksLeaveBenefits || saldos.legal <= 0;
    DOM.licenseBtn.disabled = false;
    DOM.professionalLicenseBtn.disabled = false;
    if (DOM.unionLeaveBtn) {
        DOM.unionLeaveBtn.classList.toggle(
            "hidden",
            !canUseUnionLeave
        );
        DOM.unionLeaveBtn.disabled = !canUseUnionLeave;
    }
    DOM.unpaidLeaveBtn.disabled = blocksLeaveBenefits;
    DOM.hoursReturnBtn.disabled = saldos.hoursReturn <= 0;
    DOM.unjustifiedAbsenceBtn.disabled = false;
    DOM.clockMarkBtn.disabled = false;
    if (DOM.trainingBtn) DOM.trainingBtn.disabled = false;
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
        DOM.trainingBtn,
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
        renderProfileKpis(profile, dataSnapshot);
        renderProfileHheeCard(profile);
        renderProfileTurnosCard(profile);

        containers.forEach(container => {
            container.removeAttribute("aria-busy");
        });
    }, { timeout: 500 });
}

// ===== Perfil: hero, KPIs y mini-graficos (rediseno) =====
const PF_MESES_SHORT = [
    "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"
];
const PF_ROTATION_LABEL = {
    "3turno": "3.er turno",
    "4turno": "4.º turno",
    "diurno": "Diurno",
    "libre": "Libre"
};
const PF_ICON_CLOCK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>`;
const PF_ICON_PALM = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22s4-8 10-8 10 8 10 8"></path><path d="M12 14V6"></path><path d="M12 6c1.5-3 5-3 6-1-2 2-6 1-6 1z"></path></svg>`;
const PF_ICON_MONEY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>`;
const PF_ICON_DOC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg>`;
const PF_ICON_TREND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"></path><path d="M7 14l4-4 3 3 5-6"></path></svg>`;
const PF_ICON_MOON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>`;
const PF_BTN_PLUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"></path></svg>`;
const PF_BTN_PENCIL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>`;
const PF_BTN_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>`;
const PF_BTN_LINK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"></path><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"></path></svg>`;

function pfInitials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "–";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function pfMonthYear(date) {
    if (!date || Number.isNaN(date.getTime())) return "";
    return `${String(date.getMonth() + 1).padStart(2, "0")}-${date.getFullYear()}`;
}

function pfSeniority(unitEntryDate) {
    if (!unitEntryDate) return null;
    const start = parseInputDate(unitEntryDate);
    if (!start || Number.isNaN(start.getTime())) return null;
    const now = new Date();
    let months =
        (now.getFullYear() - start.getFullYear()) * 12 +
        (now.getMonth() - start.getMonth());
    if (now.getDate() < start.getDate()) months -= 1;
    if (months < 0) months = 0;
    return { years: Math.floor(months / 12), months: months % 12, start };
}

function pfAge(birthDate) {
    if (!birthDate) return null;
    const b = parseInputDate(birthDate);
    if (!b || Number.isNaN(b.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - b.getFullYear();
    const md = now.getMonth() - b.getMonth();
    if (md < 0 || (md === 0 && now.getDate() < b.getDate())) age -= 1;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let next = new Date(now.getFullYear(), b.getMonth(), b.getDate());
    if (next < today) next = new Date(now.getFullYear() + 1, b.getMonth(), b.getDate());
    const daysToBirthday = Math.round((next - today) / 86400000);
    return { age: Math.max(0, age), daysToBirthday };
}

function renderProfileHero(profile, data) {
    const avatar = document.getElementById("profileHeroAvatar");
    const nameEl = document.getElementById("profileHeroName");
    const subEl = document.getElementById("profileHeroSub");
    const pillsEl = document.getElementById("profileHeroPills");
    if (!avatar || !nameEl || !subEl || !pillsEl) return;

    const creating = profileDraft.mode === PROFILE_MODE.CREATE;

    if (!profile && !creating) {
        avatar.textContent = "–";
        nameEl.textContent = "Selecciona un trabajador";
        subEl.textContent = "";
        pillsEl.innerHTML = "";
        return;
    }

    avatar.textContent = pfInitials(data.name);
    nameEl.textContent = data.name || (creating ? "Nuevo perfil" : "Sin nombre");

    const age = pfAge(data.birthDate);
    const subParts = [
        data.rut ? `RUT ${data.rut}` : "",
        data.estamento,
        formatProfession(data.profession),
        data.grade ? `Grado ${data.grade}` : "",
        age ? `${age.age} años` : ""
    ].filter(Boolean);
    subEl.textContent = subParts.join(" · ");

    const active = creating ? true : isProfileActive(profile);
    const assigned = creating
        ? Boolean(profileDraft.shiftAssigned)
        : getShiftAssigned(data.name, currentDate);
    const rotationLabel = data.rotation
        ? (PF_ROTATION_LABEL[data.rotation] || data.rotation)
        : "";

    const pills = [];
    pills.push(active
        ? `<span class="pf-pill ok"><span class="d"></span> Activo</span>`
        : `<span class="pf-pill off"><span class="d"></span> Inactivo</span>`);
    const rotChip = [rotationLabel, assigned ? "con asignación" : ""]
        .filter(Boolean).join(" · ");
    if (rotChip) {
        pills.push(`<span class="pf-pill accent">${escapeHTML(rotChip)}</span>`);
    }
    if (data.contractType) {
        pills.push(`<span class="pf-pill purple">${escapeHTML(data.contractType)}</span>`);
    }
    const sen = pfSeniority(data.unitEntryDate);
    if (sen) {
        pills.push(`<span class="pf-pill">Ingreso ${escapeHTML(pfMonthYear(sen.start))}</span>`);
    }
    if (age && age.daysToBirthday <= 30) {
        pills.push(`<span class="pf-pill amber">🎂 cumpleaños en ${age.daysToBirthday} días</span>`);
    }
    pillsEl.innerHTML = pills.join("");
}

function renderProfileKpis(profile, data) {
    const host = document.getElementById("profileKpis");
    if (!host) return;

    const creating = profileDraft.mode === PROFILE_MODE.CREATE;
    if (!profile && !creating) {
        host.innerHTML = "";
        return;
    }

    const currency = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const holidays = getCachedHolidays(year);

    const sen = pfSeniority(data.unitEntryDate);
    const antiVal = sen ? `${sen.years} a ${sen.months} m` : "—";
    const antiSub = sen ? `desde ${pfMonthYear(sen.start)}` : "sin fecha de ingreso";

    const blocksLeave = creating
        ? contractBlocksLeaveBenefits(profileDraft)
        : contractBlocksLeaveBenefits(profile || {});
    let vacVal;
    let vacSub;
    if (blocksLeave) {
        vacVal = "N/A";
        vacSub = "honorarios sin feriado";
    } else {
        const saldos = creating
            ? (createAvailabilityBalances || defaultCreateAvailabilityBalances())
            : getLeaveBalances(year, holidays, { month, profileName: data.name });
        const legal = Number(saldos.legal) || 0;
        const admin = Number(saldos.admin) || 0;
        const comp = Number(saldos.comp) || 0;
        vacVal = `${formatSaldo(legal + admin + comp)} d`;
        vacSub = `FL ${formatSaldo(legal)} · ADM ${formatSaldo(admin)}`;
    }

    let hheeVal = "—";
    let hheeSub = "sin datos del mes";
    if (!creating && data.name) {
        const stats = getHheeMonthStats(data.name, year, month, holidays);
        const hh = (Number(stats.hheeDiurnas) || 0) + (Number(stats.hheeNocturnas) || 0);
        const pago = (Number(stats.paymentDiurno) || 0) + (Number(stats.paymentNocturno) || 0);
        hheeVal = `${fmtHheeHours(hh)} h`;
        hheeSub = `$${currency.format(pago)} estimado`;
    }

    const docs = Array.isArray(data.docs) ? data.docs.length : 0;
    const docSub = docs === 1 ? "1 adjunto" : `${docs} adjuntos`;

    host.innerHTML = `
        <div class="pf-kpi pf-kpi--anti">
            <span class="k-ico">${PF_ICON_CLOCK}</span>
            <div class="k-lbl">Antigüedad en la unidad</div>
            <div class="k-val">${antiVal}</div>
            <div class="k-sub">${escapeHTML(antiSub)}</div>
        </div>
        <div class="pf-kpi pf-kpi--vac">
            <span class="k-ico">${PF_ICON_PALM}</span>
            <div class="k-lbl">Vacaciones disponibles</div>
            <div class="k-val">${escapeHTML(vacVal)}</div>
            <div class="k-sub">${escapeHTML(vacSub)}</div>
        </div>
        <div class="pf-kpi pf-kpi--hhee">
            <span class="k-ico">${PF_ICON_MONEY}</span>
            <div class="k-lbl">HH.EE del mes</div>
            <div class="k-val">${escapeHTML(hheeVal)}</div>
            <div class="k-sub">${escapeHTML(hheeSub)}</div>
        </div>
        <div class="pf-kpi pf-kpi--doc">
            <span class="k-ico">${PF_ICON_DOC}</span>
            <div class="k-lbl">Documentos</div>
            <div class="k-val">${docs}</div>
            <div class="k-sub">${escapeHTML(docSub)}</div>
        </div>
    `;
}

function renderProfileHheeCard(profile) {
    const host = document.getElementById("profileHheeCard");
    if (!host) return;

    const creating = profileDraft.mode === PROFILE_MODE.CREATE;
    if (!profile || creating) {
        host.innerHTML = `
            <div class="pf-mini-head"><span class="ci amber">${PF_ICON_TREND}</span><h3>HH.EE &mdash; 6 meses</h3></div>
            <div class="pf-empty">Guarda el perfil para ver la tendencia.</div>
        `;
        return;
    }

    const base = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const rows = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
        const stats = getHheeMonthStats(
            profile.name,
            d.getFullYear(),
            d.getMonth(),
            getCachedHolidays(d.getFullYear())
        );
        rows.push({
            label: PF_MESES_SHORT[d.getMonth()],
            value: (Number(stats.hheeDiurnas) || 0) + (Number(stats.hheeNocturnas) || 0)
        });
    }

    const values = rows.map((r) => r.value);
    const max = Math.max(1, ...values);
    const min = Math.min(0, ...values);
    const span = Math.max(1, max - min);
    const W = 300;
    const H = 80;
    const pad = 6;
    const stepX = (W - pad * 2) / (rows.length - 1);
    const pts = values.map((v, i) => [
        pad + i * stepX,
        pad + (H - pad * 2) * (1 - (v - min) / span)
    ]);
    const line = pts
        .map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1))
        .join(" ");
    const area = `${line} L ${W - pad} ${H - pad} L ${pad} ${H - pad} Z`;
    const last = pts[pts.length - 1];

    host.innerHTML = `
        <div class="pf-mini-head">
            <span class="ci amber">${PF_ICON_TREND}</span>
            <h3>HH.EE &mdash; 6 meses</h3>
            <span class="pf-mini-badge">${fmtHheeHours(values[values.length - 1])} h este mes</span>
        </div>
        <svg class="pf-spark" viewBox="0 0 300 80" preserveAspectRatio="none">
            <defs><linearGradient id="pfSparkGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--yellow)" stop-opacity="0.35"></stop><stop offset="1" stop-color="var(--yellow)" stop-opacity="0"></stop></linearGradient></defs>
            <path d="${area}" fill="url(#pfSparkGrad)"></path>
            <path d="${line}" fill="none" stroke="var(--yellow)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>
            <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.4" fill="var(--yellow)"></circle>
        </svg>
        <div class="pf-spark-x">${rows.map((r) => `<span>${r.label}</span>`).join("")}</div>
    `;
}

function renderProfileTurnosCard(profile) {
    const host = document.getElementById("profileTurnosCard");
    if (!host) return;

    const creating = profileDraft.mode === PROFILE_MODE.CREATE;
    if (!profile || creating) {
        host.innerHTML = `
            <div class="pf-mini-head"><span class="ci teal">${PF_ICON_MOON}</span><h3>Turnos del mes</h3></div>
            <div class="pf-empty">Guarda el perfil para ver los turnos.</div>
        `;
        return;
    }

    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    let diurnos = 0;
    let noches = 0;
    let libres = 0;
    for (let day = 1; day <= days; day++) {
        const code = Number(getProfileRotationState(profile.name, `${y}-${m}-${day}`)) || 0;
        if (code === 0) libres += 1;
        else if (code === 2) noches += 1;
        else diurnos += 1;
    }
    const max = Math.max(1, diurnos, noches, libres);
    const bar = (value, color) =>
        `<div class="bar"><i style="width:${Math.round((value / max) * 100)}%;background:${color}"></i></div>`;

    host.innerHTML = `
        <div class="pf-mini-head"><span class="ci teal">${PF_ICON_MOON}</span><h3>Turnos del mes</h3></div>
        <div class="pf-tdist">
            <div class="seg">${bar(diurnos, "var(--pf-diurna)")}<div class="n" style="color:var(--pf-diurna)">${diurnos}</div><div class="t">Diurnos</div></div>
            <div class="seg">${bar(noches, "var(--pf-nocturna)")}<div class="n" style="color:var(--pf-nocturna)">${noches}</div><div class="t">Noches</div></div>
            <div class="seg">${bar(libres, "var(--pf-libre)")}<div class="n" style="color:var(--pf-libre)">${libres}</div><div class="t">Libres</div></div>
        </div>
    `;
}

function exportProfileFichaPdf() {
    const profile = getPerfilActual();
    const data = getDisplayedProfileData();
    if (!profile || !data.name) return;

    const age = pfAge(data.birthDate);
    const sen = pfSeniority(data.unitEntryDate);
    const rotationLabel = data.rotation
        ? (PF_ROTATION_LABEL[data.rotation] || data.rotation)
        : "—";
    const row = (label, value) =>
        `<tr><th>${escapeHTML(label)}</th><td>${escapeHTML(value || "—")}</td></tr>`;

    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
        <title>Ficha ${escapeHTML(data.name)}</title>
        <style>
            body{font-family:"Segoe UI",system-ui,sans-serif;color:#1b2536;margin:28px;}
            h1{font-size:20px;margin:0 0 2px;}
            .sub{color:#66738a;font-size:12px;margin:0 0 18px;}
            h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#1f63c7;margin:18px 0 6px;border-bottom:1px solid #e6ebf4;padding-bottom:4px;}
            table{width:100%;border-collapse:collapse;font-size:12.5px;}
            th{text-align:left;width:190px;color:#66738a;font-weight:600;padding:4px 8px 4px 0;vertical-align:top;}
            td{padding:4px 0;}
            @media print{body{margin:12mm;}}
        </style></head><body>
        <h1>${escapeHTML(data.name)}</h1>
        <p class="sub">Ficha del trabajador &middot; generada ${new Date().toLocaleDateString("es-CL")}</p>
        <h2>Datos personales</h2>
        <table>
            ${row("RUT", data.rut)}
            ${row("Correo", data.email)}
            ${row("Celular", data.phone ? `+569 ${data.phone}` : "")}
            ${row("Fecha de nacimiento", data.birthDate)}
            ${row("Edad", age ? `${age.age} años` : "")}
        </table>
        <h2>Datos contractuales</h2>
        <table>
            ${row("Tipo de contrato", data.contractType)}
            ${row("Estamento", data.estamento)}
            ${row("Profesión", formatProfession(data.profession))}
            ${row("Grado", data.grade)}
            ${row("Rotativa", rotationLabel)}
            ${row("Ingreso a la unidad", data.unitEntryDate)}
            ${row("Antigüedad", sen ? `${sen.years} años ${sen.months} meses` : "")}
        </table>
        </body></html>`;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
}

/**
 * Fila del horario propio en el perfil.
 *
 * Solo aparece cuando la rotativa tiene tramos configurables: un trabajador sin
 * rotativa, o de reemplazo, no tiene contra que definirlo.
 */
function renderProfileScheduleRow(profile) {
    const row = document.getElementById("profileScheduleRow");
    const summary = document.getElementById("profileScheduleSummary");

    if (!row || !summary) return;

    const name = profile?.name || "";
    const configurable = name &&
        scheduleSegmentsForRotativa(getRotativa(name).type).length > 0;

    row.classList.toggle("hidden", !configurable);

    if (!configurable) return;

    const resumen = workerScheduleSummary(name);

    summary.textContent = resumen || "Usa el horario del turno";
    summary.classList.toggle("pf-schedule-custom", Boolean(resumen));

    const boton = document.getElementById("profileScheduleBtn");

    if (!boton) return;

    // Se reemplaza el nodo para no acumular manejadores: el perfil se repinta
    // muchas veces y cada repintado volveria a enlazar el mismo boton.
    const nuevo = boton.cloneNode(true);

    boton.replaceWith(nuevo);
    nuevo.addEventListener("click", async () => {
        const guardado = await openWorkerScheduleDialog(name);

        if (!guardado) return;

        addAuditLog(
            AUDIT_CATEGORY.CALENDAR,
            "Modifico horario propio",
            `${name}: ${workerScheduleSummary(name) || "sin horario propio"}.`,
            { profile: name }
        );
        renderProfileScheduleRow(profile);
        // El horario propio cambia los atrasos y las incidencias de todo el
        // historial, asi que lo ya calculado deja de valer.
        window.dispatchEvent(new CustomEvent("proturnos:clockMarksChanged", {
            detail: { profile: name }
        }));
        refreshAll();
    });
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
            renderHheeSelectedHeader(profile);
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
    const isReplacementContract =
        isReplacementDraft(data);
    const isHonorariaContract =
        isHonorariaDraft(data);
    const unionLeaveBlocked =
        contractBlocksUnionLeave(data);
    const gradeBlocked =
        contractBlocksGrade(data);
    const shiftAssignmentBlocked =
        contractBlocksShiftAssignment(data);
    placeProfileRotationRow(isHonorariaContract);
    DOM.profileGradeSelect.value =
        gradeBlocked ? "" : data.grade || "";
    syncProfileRotationOptions(data);
    DOM.profileRotationSelect.value = data.rotationType || "";
    if (DOM.profileUnionLeaveInput) {
        DOM.profileUnionLeaveInput.checked =
            !unionLeaveBlocked &&
            Boolean(data.unionLeaveEnabled);
    }
    DOM.checkbox.checked =
        !shiftAssignmentBlocked &&
        Boolean(data.shiftAssigned);
    DOM.profileActiveToggle.checked = data.active !== false;

    DOM.profileNameInput.disabled = !editing;
    DOM.profileEmailInput.disabled = !editing;
    // El RUT ya guardado no se puede modificar: es el ancla de identidad del
    // trabajador (mantiene datos y respaldo aunque cambie su correo). Solo es
    // editable al crear el perfil o si un perfil antiguo aun no tiene RUT.
    const rutAlreadySet = Boolean(String(data.rut || "").trim());
    DOM.profileRutInput.disabled = !editing || rutAlreadySet;
    DOM.profilePhoneInput.disabled = !editing;
    DOM.profileBirthDateInput.disabled = !editing;
    DOM.profileDocsInput.disabled = !editing;
    DOM.profileUnitEntryDateInput.disabled =
        !editing || !unitEntryDateEnabled;
    DOM.profileContractTypeSelect.disabled = !editing;
    DOM.profileRoleSelect.disabled = !editing;
    DOM.profileGradeSelect.disabled = !editing || gradeBlocked;
    DOM.profileRotationSelect.disabled = !editing;
    if (DOM.profileUnionLeaveInput) {
        DOM.profileUnionLeaveInput.disabled =
            !editing || unionLeaveBlocked;
    }
    DOM.checkbox.disabled = !editing;
    DOM.profileActiveToggle.disabled = !editing;

    const profileActiveRow = document.getElementById("profileActiveRow");
    if (profileActiveRow) {
        profileActiveRow.classList.toggle("hidden", !editing);
    }

    if (DOM.profileRotationRow) {
        DOM.profileRotationRow.classList.toggle(
            "hidden",
            isReplacementContract
        );
    }

    if (DOM.profileGradeRow) {
        DOM.profileGradeRow.classList.toggle(
            "hidden",
            gradeBlocked
        );
    }

    if (DOM.profileUnionLeaveRow) {
        DOM.profileUnionLeaveRow.classList.toggle(
            "hidden",
            unionLeaveBlocked
        );
    }

    if (unionLeaveBlocked && editing) {
        profileDraft.unionLeaveEnabled = false;
    }

    if (gradeBlocked && editing) {
        profileDraft.grade = "";
    }

    const canUseShiftAssignment =
        !shiftAssignmentBlocked &&
        (
            data.rotationType === "3turno" ||
            data.rotationType === "4turno"
        );

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

    // Rotativa: mostrar "· desde MM-YYYY" junto al campo y ocultar la nota de
    // estado en modo ver (salvo honorarios/reemplazo, que llevan info util ahi).
    const rotationSince = document.getElementById("profileRotationSince");
    if (rotationSince) {
        rotationSince.textContent =
            (!editing && data.rotationStart && data.rotationType && data.rotationType !== "libre")
                ? `· desde ${pfMonthYear(parseInputDate(data.rotationStart))}`
                : "";
    }
    if (DOM.profileRotationStatus) {
        DOM.profileRotationStatus.classList.toggle(
            "hidden",
            !editing && !isHonorariaContract && !isReplacementContract
        );
    }

    renderProfileScheduleRow(profile);

    // Condiciones como chips (modo ver): se ocultan los toggles y se muestran
    // los chips; en edicion, al reves (los toggles vuelven segun su logica).
    const conditionsRow = document.getElementById("profileConditionsRow");
    const conditionsView = document.getElementById("profileConditionsView");
    const showConditionChips =
        !editing &&
        Boolean(profile) &&
        profileDraft.mode === PROFILE_MODE.VIEW &&
        !isHonorariaContract &&
        !isReplacementContract;
    if (showConditionChips && conditionsRow && conditionsView) {
        if (DOM.shiftAssignedRow) DOM.shiftAssignedRow.classList.add("hidden");
        if (DOM.profileUnionLeaveRow) DOM.profileUnionLeaveRow.classList.add("hidden");

        const chips = [];
        const assigned = canUseShiftAssignment && Boolean(data.shiftAssigned);
        chips.push(assigned
            ? `<span class="pf-cond on">${PF_BTN_CHECK} Asignación de turno</span>`
            : `<span class="pf-cond off">Sin asignación de turno</span>`);
        if (!unionLeaveBlocked) {
            chips.push(`<span class="pf-cond">Permiso gremial: ${data.unionLeaveEnabled ? "sí" : "no"}</span>`);
        }
        const valorHora = getValorHora(profile.name);
        if (valorHora) {
            chips.push(`<span class="pf-cond">Valor hora <b>$${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(valorHora)}</b></span>`);
        }
        conditionsView.innerHTML = chips.join("");
        conditionsRow.classList.remove("hidden");
    } else if (conditionsRow) {
        conditionsRow.classList.add("hidden");
    }

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

    if (DOM.honorariaAddContractBtn) {
        DOM.honorariaAddContractBtn.disabled =
            !editing || !isHonorariaContract;
    }

    if (isHonorariaContract) {
        renderHonorariaContractList(honorariaContractProfileName());
    }

    if (DOM.honorariaContractStatus) {
        DOM.honorariaContractStatus.textContent =
            isHonorariaContract
                ? "La rotativa se aplica solo dentro de la vigencia de un contrato. Los turnos fuera de todo contrato quedan libres."
                : "";
    }

    if (activeView === "profile") {
        renderProfileHero(profile, data);
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

    DOM.openCreateProfileBtn.innerHTML =
        profileDraft.mode === PROFILE_MODE.CREATE
            ? `${PF_BTN_CHECK} Guardar`
            : `${PF_BTN_PLUS} Nuevo perfil`;

    DOM.openEditProfileBtn.innerHTML =
        profileDraft.mode === PROFILE_MODE.EDIT
            ? `${PF_BTN_CHECK} Guardar`
            : `${PF_BTN_PENCIL} Editar`;

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
        // Tres estados: enlazado, invitado pendiente y sin invitar. Antes los dos
        // ultimos se veian igual, asi que una invitacion que el trabajador nunca
        // abrio pasaba por "no lo hemos invitado" y quedaba fuera de la
        // mensajeria y de los cambios de turno sin que nadie lo notara.
        const { state, invite } = profile
            ? getWorkerLinkState(profile)
            : { state: WORKER_LINK_STATE.NONE, invite: null };
        const isWorkerLinked = state === WORKER_LINK_STATE.LINKED;
        const isInvitePending = state === WORKER_LINK_STATE.PENDING;

        DOM.workerAppInviteBtn.disabled = !canInviteWorker;
        DOM.workerAppInviteBtn.innerHTML = isWorkerLinked
            ? `${PF_BTN_LINK} Enlazado`
            : isInvitePending
                ? `${PF_BTN_LINK} Invitado`
                : `${PF_BTN_LINK} Enlace app`;
        DOM.workerAppInviteBtn.classList.toggle("is-linked", isWorkerLinked);
        DOM.workerAppInviteBtn.classList.toggle(
            "is-invite-pending",
            isInvitePending
        );
        DOM.workerAppInviteBtn.title = isWorkerLinked
            ? "El trabajador ya enlazo su app TurnoPlus. Puedes reenviar el enlace."
            : isInvitePending
                ? `Invitacion enviada el ${workerInviteDateLabel(invite)} y aun sin usar. El trabajador debe abrir el enlace e iniciar sesion con el correo invitado.`
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
    const turnChangeConfig = getTurnChangeConfig();
    const permissionDisabled =
        !canViewTarget("turnChangesView");
    // Los Diurno tambien entran: intercambian su dia de extension horaria, y
    // solo con otro Diurno (lo decide canSwapProfiles, igual que en la PWA).
    const disabled =
        permissionDisabled ||
        !turnChangeConfig.allowSwaps ||
        !currentProfile ||
        !isProfileActive(currentProfile);

    button.disabled = disabled;
    button.classList.toggle("is-disabled", disabled);
    button.title = disabled
        ? (
            permissionDisabled
                ? "Tu usuario no tiene permiso para ver Cambios de Turno."
                : !turnChangeConfig.allowSwaps
                ? "Cambios de turno desactivados en Ajustes del sistema."
                : "Cambios de turno no disponible para perfiles desactivados."
        )
        : "";

    if (
        disabled &&
        document.body.dataset.activeView === "swap"
    ) {
        void setActiveShortcut(firstViewableTarget());
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
            void setActiveShortcut(nextTarget);
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
    }
    syncTurnosSidePanelHeight();
}

async function setActiveShortcut(targetId, options = {}) {
    if (!canViewTarget(targetId)) {
        alert("Tu usuario no tiene permiso para ingresar a este menu.");
        syncWorkspacePermissionUI({ switchIfNeeded: false });
        return false;
    }

    const previousView = document.body.dataset.activeView || "turnos";
    const nextView = getViewForTarget(targetId);

    if (
        options.skipProfileDraftGuard !== true &&
        previousView === "profile" &&
        nextView !== "profile" &&
        !await confirmProfileDraftBeforeLeaving()
    ) {
        return false;
    }

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

        if (nextView === "home") {
            renderHomePanel();
        }

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

        if (nextView === "informations") {
            renderInformationsPanel();
        }

        if (nextView === "medicalEquipment") {
            renderMedicalEquipmentPanel();
        }

        if (nextView === "qualifications") {
            renderQualificationsPanel();
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

        if (nextView === "holders") {
            void renderShiftHoldersPanel();
        }

        if (nextView === "agenda") {
            renderAgendaPanel();
        }

        if (nextView === "turnos") {
            renderDashboardState();
            renderCalendar({ deferHeavy: true });
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
        return true;
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

function hheeInitials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function renderHheeSelectedHeader(profile) {
    const host = document.getElementById("hheeSelected");
    if (!host) return;

    const lupa = `<button class="profile-name-search" type="button" data-action="open-hhee-search" aria-label="Buscar trabajador" title="Buscar / cambiar trabajador"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.35-4.35"></path></svg></button>`;

    if (!profile) {
        host.innerHTML = `
            <span class="hh-av">?</span>
            <div class="hh-who__text">
                <strong>Selecciona un trabajador ${lupa}</strong>
                <p></p>
            </div>
        `;
        return;
    }

    const subtitleParts = [
        profile.estamento,
        formatProfession(profile.profession),
        getShiftAssigned(profile.name)
            ? "4.º turno con asignación"
            : "Sin asignación de turno"
    ].filter(Boolean);

    host.innerHTML = `
        <span class="hh-av">${escapeHTML(hheeInitials(profile.name))}</span>
        <div class="hh-who__text">
            <strong>${escapeHTML(profile.name)} ${lupa}</strong>
            <p>${escapeHTML(subtitleParts.join(" · "))}</p>
        </div>
    `;
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

        item.onclick = () => {
            void selectProfileByName(profile.name);
            document.getElementById("hheeSearchModal")?.setAttribute("hidden", "");
        };

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

        item.onclick = async () => {
            const selected = await selectProfileByName(profile.name, {
                scrollToTop: true
            });

            if (!selected) return;

            // Al elegir desde la lupa, mostrar ese trabajador (no "ver todos")
            // y cerrar el modal de búsqueda.
            if (DOM.clockMarksAllWorkersToggle) {
                DOM.clockMarksAllWorkersToggle.checked = false;
            }
            document.getElementById("clockMarksSearchModal")?.setAttribute("hidden", "");

            await setActiveShortcut("clockMarksPanel");
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

// Inyecta la lupa (buscar/cambiar trabajador) y negrita al final del nombre en
// la tabla "Datos del trabajador" del preview. La lupa se oculta al imprimir.
function decorateReportWorkerName() {
    const preview = DOM.report4TurnoNoAssignmentPreview;
    if (!preview) return;

    const rows = preview.querySelectorAll(
        ".report-section--worker-data tbody tr"
    );
    for (const row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 2 && cells[0].textContent.trim() === "Nombre") {
            cells[1].classList.add("report-name-value");
            cells[1].insertAdjacentHTML(
                "beforeend",
                ` <button class="profile-name-search report-name-search" type="button" data-action="open-reports-search" aria-label="Buscar trabajador" title="Buscar / cambiar trabajador"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.35-4.35"></path></svg></button>`
            );
            break;
        }
    }
}

async function renderReportsDetail() {
    if (!DOM.reportsSelectedInfo) return;

    const requestId = ++reportsDetailRequest;
    const profile = getPerfilActual();
    const reportDate = getReportsMonthDate();

    const reportsSearchLupa =
        `<button class="profile-name-search" type="button" data-action="open-reports-search" aria-label="Buscar trabajador" title="Buscar / cambiar trabajador"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.35-4.35"></path></svg></button>`;

    if (!profile) {
        closeReportsMonthPicker();
        DOM.reportsSelectedInfo.classList.remove("hidden");
        DOM.reportsSelectedInfo.innerHTML = `
            <div class="reports-selected">
                <div class="reports-selected__name">
                    <strong>Selecciona un trabajador</strong>
                    ${reportsSearchLupa}
                </div>
                <small>Usa la lupa para buscar y ver sus reportes.</small>
            </div>
        `;
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

    // Con trabajador seleccionado, la lupa va junto al nombre en la tabla
    // "Datos del trabajador" (se inyecta tras render). El encabezado auxiliar
    // solo se usa como fallback cuando no hay trabajador.
    DOM.reportsSelectedInfo.classList.add("hidden");
    DOM.reportsSelectedInfo.innerHTML = "";

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

    bindAttendanceImport();

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
        decorateReportWorkerName();
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
                const selected = await selectProfileByName(profile.name, {
                    scrollToTop: true,
                    refresh: false
                });

                if (!selected) return;

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
    // Clasificacion compartida (extra/deficit/recuperacion/reduccion). La
    // recuperacion solo aplica a segmentos diurnos/larga; en noche/24 el atraso
    // es reduccion y el excedente es hora extra por separado.
    const {
        timing,
        isMissing,
        recoveryMinutes,
        netExtraMinutes,
        isReduction
    } = classifyClockMarkSegment(
        record.date,
        record.segment,
        record.segmentMark,
        { isBaseOrSwap: record.isBaseOrSwap }
    );

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

    const clockMarksSelectedHost =
        document.getElementById("clockMarksSelected");
    if (clockMarksSelectedHost) {
        const selectedLabel = showAll
            ? "Todos los colaboradores"
            : (currentProfile || "Selecciona un trabajador");
        clockMarksSelectedHost.innerHTML = `
            <strong>${escapeHTML(selectedLabel)}</strong>
            <button class="profile-name-search" type="button" data-action="open-clockmarks-search" aria-label="Buscar trabajador" title="Buscar / cambiar trabajador"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.35-4.35"></path></svg></button>
        `;
    }
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

// refreshAll repinta la vista activa; el reporte necesita este puente para
// enterarse de que cambiaron las marcas o el marcaje autorizado. Sin el, las
// horas recien cargadas solo aparecian al cambiar de mes y volver.
window.renderReportsDetail = renderReportsDetail;

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
        const searchValue = getCalendarProfileSearchValue(profile);
        getCalendarProfileSearchOptionValues(profile)
            .forEach(value => {
                const option = document.createElement("option");
                option.value = value;

                if (value !== searchValue) {
                    option.label = searchValue;
                }

                DOM.topProfileOptions.appendChild(option);
            });
    });
}

async function handleTopProfileSearch() {
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
    if (await selectProfileByName(match.name)) {
        DOM.topProfileSearchInput.blur();
    } else {
        syncTopProfileSearch();
    }
}

async function selectProfileByName(profileName, options = {}) {
    let profile = getProfiles().find(item =>
        item.name === profileName
    );

    if (!profile) return false;

    const sameStoredProfile =
        profile.name === getCurrentProfile() &&
        profileDraft.mode !== PROFILE_MODE.CREATE;
    const profileInactive = !isProfileActive(profile);

    if (
        options.skipProfileDraftGuard !== true &&
        isProfileEditing() &&
        (
            !sameStoredProfile ||
            hasUnsavedProfileDraftChanges()
        )
    ) {
        if (!await confirmProfileDraftBeforeLeaving()) {
            return false;
        }

        profile = getProfiles().find(item =>
            item.name === profileName
        );

        if (!profile) return true;
    }

    if (
        sameStoredProfile &&
        !profileInactive &&
        !options.openProfile &&
        !options.openTurns &&
        !hasUnsavedProfileDraftChanges()
    ) {
        return true;
    }

    void disableCalendarDirectEditMode({
        flush: true,
        refresh: false,
        reason: "profile-change"
    });
    clearSelectionMode(false);
    resetProfileDraft();
    availabilityEditMode = false;
    profileDraft.mode = PROFILE_MODE.VIEW;
    setCurrentProfile(profile.name);
    renderProfiles({ dashboard: false });
    renderBotones();

    const openProfile = options.openProfile || profileInactive;
    const openTurns = options.openTurns && !profileInactive;

    if (openProfile) {
        if (!await setActiveShortcut("profileSection")) {
            return false;
        }
    }

    if (openTurns) {
        if (!await setActiveShortcut("calendarPanel")) {
            return false;
        }
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

    return true;
}

window.selectProfileByName = selectProfileByName;

// Lo usa el inicio para avisar el resultado de la cobertura automatica.
window.showAppToast = showAppToast;

function parseCalendarJumpDate(value) {
    const match = String(value || "")
        .match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);

    if (!match) return null;

    return {
        year: Number(match[1]),
        month: Number(match[2]) - 1
    };
}

window.addEventListener(
    "proturnos:viewWorkerRequestInCalendar",
    async event => {
        const profileName = String(event.detail?.profile || "").trim();
        const target = parseCalendarJumpDate(event.detail?.date);

        if (!profileName || !target) {
            showAppToast(
                "No se pudo abrir la solicitud en el calendario.",
                { title: "Solicitud incompleta", variant: "warn" }
            );
            return;
        }

        if (!getProfiles().some(profile => profile.name === profileName)) {
            showAppToast(
                "El trabajador de esta solicitud ya no existe en el entorno.",
                { title: "Perfil no encontrado", variant: "warn" }
            );
            return;
        }

        currentDate.setFullYear(target.year, target.month, 1);
        const selected = await selectProfileByName(profileName, {
            refresh: false,
            openTurns: false
        });

        if (!selected) return;

        if (!await setActiveShortcut("calendarPanel")) {
            return;
        }

        requestAnimationFrame(() => {
            document.getElementById("calendarPanel")?.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        });
    }
);

/**
 * Abrir el reporte de un trabajador en el mes de un dia dado.
 *
 * Lo usa el detalle de incidencias del inicio: la incidencia es de un dia
 * concreto, asi que el reporte tiene que salir en SU mes y no en el que quedo
 * abierto la ultima vez que se miro un reporte.
 */
window.addEventListener(
    "proturnos:viewWorkerReport",
    async event => {
        const profileName = String(event.detail?.profile || "").trim();
        const target = parseCalendarJumpDate(event.detail?.date);

        if (!profileName || !target) {
            showAppToast(
                "No se pudo abrir el reporte de ese día.",
                { title: "Dato incompleto", variant: "warn" }
            );
            return;
        }

        if (!getProfiles().some(profile => profile.name === profileName)) {
            showAppToast(
                "Ese trabajador ya no existe en el entorno.",
                { title: "Perfil no encontrado", variant: "warn" }
            );
            return;
        }

        const selected = await selectProfileByName(profileName, {
            refresh: false,
            openTurns: false
        });

        if (!selected) return;

        // El mes se fija ANTES de entrar: al abrir Reportes se dibuja el
        // detalle, y tiene que salir ya con el mes de la incidencia.
        reportsMonthDate = new Date(target.year, target.month, 1);
        reportsMonthPickerYear = target.year;

        if (!await setActiveShortcut("reportsPanel")) {
            return;
        }

        requestAnimationFrame(() => {
            document.getElementById("reportsPanel")?.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        });
    }
);

function clearSelectionMode(shouldRefresh = true) {
    selectionMode = null;
    window.selectionMode = null;
    pendingRotationChange = null;
    pendingShiftMove = null;
    window.pendingAddTurn = 0;
    window.pendingAddTurnPreassign = false;
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
    syncAddTurnButtons();

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

function offsetCalendarKey(keyDay, offset) {
    const date = parseKey(keyDay);

    if (Number.isNaN(date.getTime())) return "";

    date.setDate(date.getDate() + Number(offset || 0));

    return keyFromDate(date);
}

function getShiftMoveAdjacentTurn(profile, targetKey, sourceKey, offset) {
    const adjacentKey = offsetCalendarKey(targetKey, offset);

    if (!adjacentKey) return TURNO.LIBRE;

    if (
        adjacentKey === sourceKey &&
        adjacentKey !== targetKey
    ) {
        return TURNO.LIBRE;
    }

    return Number(
        aplicarCambiosTurno(
            profile,
            adjacentKey,
            getTurnoProgramado(profile, adjacentKey)
        )
    ) || TURNO.LIBRE;
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
    const config = getTurnChangeConfig();

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

    const previousTurn = getShiftMoveAdjacentTurn(
        profile,
        keyDay,
        sourceKey,
        -1
    );
    const nextTurn = getShiftMoveAdjacentTurn(
        profile,
        keyDay,
        sourceKey,
        1
    );

    if (keyDay === sourceKey) {
        return moveShiftConfigBlockReason({
            projectedTurn: destinationTurn,
            previousTurn,
            nextTurn,
            allowTwentyFourHourShifts:
                config.allowTwentyFourHourShifts,
            allowInvertedTwentyFourHourShifts:
                config.allowInvertedTwentyFourHourShifts
        });
    }

    // El destino puede tener el turno complementario (Larga<->Noche): al juntarse
    // con el turno que se mueve forma un 24, asi que se permite.
    const combina24 = moveShiftTargetCombina24(
        destinationTurn,
        baseTurn,
        programmedTurn,
        actualTurn
    );
    const projectedTurn = combina24
        ? TURNO.TURNO24
        : Number(destinationTurn) || TURNO.LIBRE;
    const configBlockReason = moveShiftConfigBlockReason({
        combines24: combina24,
        projectedTurn,
        previousTurn,
        nextTurn,
        allowTwentyFourHourShifts:
            config.allowTwentyFourHourShifts,
        allowInvertedTwentyFourHourShifts:
            config.allowInvertedTwentyFourHourShifts
    });

    if (configBlockReason) {
        return configBlockReason;
    }

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
    const hasOwn = (object, prop) =>
        Object.prototype.hasOwnProperty.call(object, prop);
    const moveUndoSnapshot = {
        sourceHadData: hasOwn(data, move.sourceKey),
        sourcePreviousData: Number(data[move.sourceKey]) || TURNO.LIBRE,
        sourceHadBase: hasOwn(baseData, move.sourceKey),
        sourcePreviousBase: Number(baseData[move.sourceKey]) || TURNO.LIBRE,
        sourceHadBlocked: hasOwn(blocked, move.sourceKey),
        sourcePreviousBlocked: Boolean(blocked[move.sourceKey]),
        targetHadData: hasOwn(data, targetKey),
        targetPreviousData: Number(data[targetKey]) || TURNO.LIBRE,
        targetHadBase: hasOwn(baseData, targetKey),
        targetPreviousBase: Number(baseData[targetKey]) || TURNO.LIBRE,
        targetHadBlocked: hasOwn(blocked, targetKey),
        targetPreviousBlocked: Boolean(blocked[targetKey])
    };

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
        destinationTurn: move.destinationTurn,
        hasUndoSnapshot: true,
        combinedInto24: combina24,
        combinedBaseComplement: complementoEsBase,
        ...moveUndoSnapshot
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
    updateHistoryNavState();
}

function startCreateMode() {
    if (!canEditCurrentProfileMenu()) return;

    clearSelectionMode(false);
    resetProfileDraft();
    profileAvailabilityDraftTouched = false;
    availabilityEditMode = true;
    createAvailabilityBalances =
        defaultCreateAvailabilityBalances();
    profileRotationMiniDate = new Date();

    profileDraft.mode = PROFILE_MODE.CREATE;
    setCurrentProfile(null);

    renderProfiles();
    renderBotones();
    refreshAll();
    void setActiveShortcut("profileSection", {
        skipProfileDraftGuard: true
    });
    DOM.profileNameInput.focus();
}

function startEditMode() {
    if (!canEditCurrentProfileMenu()) return;

    const profile = getPerfilActual();
    if (!profile) return;

    clearSelectionMode(false);
    createAvailabilityBalances = null;
    profileAvailabilityDraftTouched = false;
    availabilityEditMode = true;
    loadDraftFromProfile(profile);
    profileRotationMiniDate = profileDraft.rotationStart
        ? parseInputDate(profileDraft.rotationStart)
        : new Date();
    profileDraft.mode = PROFILE_MODE.EDIT;

    renderDashboardState();
    renderBotones();
    refreshAll();
    void setActiveShortcut("profileSection", {
        skipProfileDraftGuard: true
    });
    // No se enfoca el nombre: al pulsar "Editar" el supervisor debe quedarse en
    // el mismo punto (puede querer modificar otra area), sin scroll ni foco
    // automatico. En cambio, crear un perfil nuevo si enfoca el nombre.
}

// Abre la ficha de un trabajador de Honorarios en modo edicion con el formulario
// de nuevo contrato prellenado con la fecha clickeada como inicio (flujo desde el
// calendario cuando se aplica una rotativa fuera de todo contrato vigente).
// El rango [start, end] se cruza con contratos existentes: se pregunta si extender
// el que ya existe (conservando su valor hora y tope) o crear uno distinto (que se
// recorta para no solaparse). Devuelve "extend" | "create" | "cancel".
function requestHonorariaOverlapDecision(overlapping) {
    return new Promise(resolve => {
        const backdrop = document.createElement("div");

        backdrop.className = "turn-change-dialog-backdrop";
        document.body.appendChild(backdrop);

        const close = value => {
            backdrop.remove();
            resolve(value);
        };
        const items = overlapping
            .map(contract => `
                <li>
                    ${escapeHTML(formatContractDate(contract.start))} al ${escapeHTML(formatContractDate(contract.end))}
                    <span class="honoraria-overlap-meta">
                        $${Number(contract.hourlyRate || 0).toLocaleString("es-CL")}/h ·
                        tope ${Number(contract.maxHours || 0)} ${contract.limitPeriod === "monthly" ? "h/mes" : "h/sem"}
                    </span>
                </li>
            `)
            .join("");

        backdrop.innerHTML = `
            <div class="turn-change-dialog honoraria-overlap-dialog" role="dialog" aria-modal="true">
                <strong>El rango se cruza con otro contrato</strong>
                <p>
                    El per&iacute;odo elegido se superpone con
                    ${overlapping.length === 1 ? "un contrato ya existente" : "contratos ya existentes"}:
                </p>
                <ul class="honoraria-overlap-list">${items}</ul>
                <p>&iquest;Qu&eacute; deseas hacer?</p>
                <div class="turn-change-dialog__actions honoraria-overlap-actions">
                    <button class="primary-button" type="button" data-action="extend">
                        Extender ese contrato
                    </button>
                    <button class="secondary-button" type="button" data-action="create">
                        Crear un contrato distinto
                    </button>
                    <button class="ghost-button" type="button" data-action="cancel">
                        Cancelar
                    </button>
                </div>
            </div>
        `;

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) {
                close("cancel");
                return;
            }

            const action = event.target
                .closest("[data-action]")
                ?.dataset.action;

            if (action) {
                close(action);
            }
        });
    });
}

// Modal interactivo para crear (o extender) un contrato de Honorarios desde el
// calendario principal. El inicio arranca en el dia clickeado (flecha verde ->);
// al hacer click en un dia posterior se fija el termino (flecha azul <-) y en uno
// anterior se mueve el inicio. Permite valor hora, tope y su periodo (semanal o
// mensual). Los contratos NUNCA se solapan: si el rango toca otro, se pregunta si
// extenderlo o crear uno recortado. Devuelve el contrato guardado, o null.
function openHonorariaContractModal({ profileName, startISO = "", contractId = "" }) {
    return new Promise(resolve => {
        const existingContracts =
            getHonorariaContractsForProfile(profileName);
        // En modo edicion se precargan los datos del contrato; el guardado ACTUALIZA
        // ese contrato (no crea uno nuevo) y valida que no se cruce con otros.
        const editingContract = contractId
            ? existingContracts.find(item => item.id === contractId) || null
            : null;
        const editing = Boolean(editingContract);
        // startISO puede venir vacio (desde el perfil): el supervisor elige el
        // inicio en el calendario y el modal abre en el mes actual. Desde el
        // calendario de turnos llega prellenado. parseInputDate("") devuelve una
        // fecha invalida (no null), asi que hay que validarla explicitamente.
        const parsedStart = parseInputDate(editingContract?.start || startISO);
        const state = {
            monthDate:
                parsedStart && !Number.isNaN(parsedStart.getTime())
                    ? parsedStart
                    : new Date(),
            start: editingContract?.start || startISO || "",
            end: editingContract?.end || "",
            hourlyRate: editingContract ? String(editingContract.hourlyRate || "") : "",
            maxHours: editingContract ? String(editingContract.maxHours || "") : "",
            limitPeriod: editingContract?.limitPeriod === "monthly" ? "monthly" : "weekly"
        };
        const backdrop = document.createElement("div");

        backdrop.className = "turn-change-dialog-backdrop";
        document.body.appendChild(backdrop);

        let settled = false;
        const close = value => {
            if (settled) return;
            settled = true;
            backdrop.remove();
            resolve(value);
        };

        const renderCalendar = () => {
            const y = state.monthDate.getFullYear();
            const m = state.monthDate.getMonth();
            const first = (new Date(y, m, 1).getDay() + 6) % 7;
            const days = new Date(y, m + 1, 0).getDate();
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
                const existing = existingContracts.find(contract =>
                    contract.start <= iso && contract.end >= iso
                );
                const isStart = iso === state.start;
                const isEnd = Boolean(state.end) && iso === state.end;
                const inRange =
                    Boolean(state.end) &&
                    iso > state.start &&
                    iso < state.end;
                const classes = ["profile-mini-day", "is-pickable"];

                if (existing) classes.push("has-existing-contract");
                if (inRange) classes.push("is-contract-range");
                if (isStart) classes.push("is-contract-start");
                if (isEnd) classes.push("is-contract-end");

                const marker = isStart
                    ? '<span class="contract-arrow contract-arrow--start">&rarr;</span>'
                    : isEnd
                        ? '<span class="contract-arrow contract-arrow--end">&larr;</span>'
                        : existing
                            ? '<span class="contract-day-label contract-day-label--current">Contrato</span>'
                            : "";
                const title = existing
                    ? `Contrato existente: ${formatContractDate(existing.start)} al ${formatContractDate(existing.end)}`
                    : "";

                html += `
                    <button type="button" class="${classes.join(" ")}" data-key="${key}" title="${escapeHTML(title)}">
                        <span>${d}</span>
                        <small>${marker}</small>
                    </button>
                `;
            }

            return `${html}</div>`;
        };
        const render = () => {
            const heading = state.monthDate.toLocaleString("es-CL", {
                month: "long",
                year: "numeric"
            });
            const rangeText = !state.start
                ? "Selecciona el inicio del contrato en el calendario."
                : state.end
                    ? `Contrato: ${formatDisplayDate(state.start)} al ${formatDisplayDate(state.end)}.`
                    : `Inicio: ${formatDisplayDate(state.start)}. Selecciona la fecha de t&eacute;rmino en el calendario.`;

            backdrop.innerHTML = `
                <div class="turn-change-dialog rotation-config-dialog honoraria-contract-dialog" role="dialog" aria-modal="true">
                    <strong>${editing ? "Editar contrato de Honorarios" : "Nuevo contrato de Honorarios"}</strong>
                    <p>${escapeHTML(profileName)}: elige el inicio (<span class="contract-arrow contract-arrow--start">&rarr;</span>) y el t&eacute;rmino (<span class="contract-arrow contract-arrow--end">&larr;</span>) del contrato en el calendario. Haz click en un d&iacute;a posterior para fijar el t&eacute;rmino, o en uno anterior para mover el inicio.</p>

                    <div class="profile-mini-head rotation-modal-head">
                        <button type="button" data-action="prev" aria-label="Mes anterior">&lt;</button>
                        <span class="honoraria-contract-month">${escapeHTML(heading)}</span>
                        <button type="button" data-action="next" aria-label="Mes siguiente">&gt;</button>
                    </div>

                    <div class="rotation-modal-calendar">
                        ${renderCalendar()}
                    </div>

                    <div class="profile-mini-help">${rangeText}</div>

                    <div class="honoraria-contract-fields">
                        <label class="rotation-contract-field">
                            <span>Valor hora</span>
                            <input type="number" min="0" step="1" inputmode="numeric" data-honoraria-rate value="${escapeHTML(state.hourlyRate)}" placeholder="0">
                        </label>

                        <label class="rotation-contract-field">
                            <span>M&aacute;ximo de horas</span>
                            <div class="honoraria-max-hours-cell">
                                <input type="number" min="0" step="1" inputmode="numeric" data-honoraria-max value="${escapeHTML(state.maxHours)}" placeholder="0">
                                <div class="period-toggle period-toggle--honoraria-modal" role="group" aria-label="Periodo del tope de horas" data-period-toggle>
                                    <button type="button" class="period-toggle-option ${state.limitPeriod === "weekly" ? "is-active" : ""}" data-period="weekly" aria-pressed="${state.limitPeriod === "weekly"}">Semanal</button>
                                    <button type="button" class="period-toggle-option ${state.limitPeriod === "monthly" ? "is-active" : ""}" data-period="monthly" aria-pressed="${state.limitPeriod === "monthly"}">Mensual</button>
                                </div>
                            </div>
                        </label>
                    </div>

                    <div class="turn-change-dialog__actions">
                        <button class="primary-button" type="button" data-action="save">${editing ? "Guardar cambios" : "Guardar contrato"}</button>
                        <button class="secondary-button" type="button" data-action="cancel">Cancelar</button>
                    </div>
                </div>
            `;
        };
        const pickDate = key => {
            const iso = calendarKeyToInputDate(key);

            if (!iso) return;

            if (!state.start) {
                // Sin inicio aun (no venia prellenado): el primer click lo fija.
                state.start = iso;
            } else if (compareISODate(iso, state.start) < 0) {
                state.start = iso;

                if (state.end && compareISODate(state.end, state.start) <= 0) {
                    state.end = "";
                }
            } else if (compareISODate(iso, state.start) > 0) {
                state.end = iso;
            } else {
                // Click sobre el inicio: reinicia el termino.
                state.end = "";
            }

            render();
        };
        const save = async () => {
            const hourlyRate = Number(state.hourlyRate) || 0;
            const maxHours = Number(state.maxHours) || 0;

            if (!state.start) {
                alert("Selecciona la fecha de inicio del contrato en el calendario.");
                return;
            }

            if (!state.end) {
                alert("Selecciona la fecha de término del contrato en el calendario.");
                return;
            }

            if (!(hourlyRate > 0)) {
                alert("Ingresa el valor hora del contrato.");
                return;
            }

            if (!(maxHours > 0)) {
                alert("Ingresa el máximo de horas del contrato.");
                return;
            }

            // Edicion: se actualiza el contrato existente. No debe cruzarse con los
            // demas (se excluye a si mismo de la comprobacion).
            if (editing) {
                const crosses = existingContracts.some(contract =>
                    contract.id !== contractId &&
                    contract.start <= state.end &&
                    contract.end >= state.start
                );

                if (crosses) {
                    alert("El nuevo rango se cruza con otro contrato. Ajusta las fechas para que no se solapen.");
                    return;
                }

                close(updateHonorariaContract(profileName, contractId, {
                    start: state.start,
                    end: state.end,
                    hourlyRate,
                    maxHours,
                    limitPeriod: state.limitPeriod
                }));
                return;
            }

            const overlapping = existingContracts.filter(contract =>
                contract.start <= state.end && contract.end >= state.start
            );
            let saved = null;

            if (overlapping.length) {
                const decision =
                    await requestHonorariaOverlapDecision(overlapping);

                if (decision === "cancel" || !decision) return;

                if (decision === "extend") {
                    const target = overlapping[0];
                    const others = existingContracts.filter(contract =>
                        contract.id !== target.id
                    );
                    const unionStart =
                        target.start < state.start ? target.start : state.start;
                    const unionEnd =
                        target.end > state.end ? target.end : state.end;
                    const clamped =
                        clampContractRange(unionStart, unionEnd, others) ||
                        { start: unionStart, end: unionEnd };

                    saved = updateHonorariaContract(profileName, target.id, {
                        start: clamped.start,
                        end: clamped.end
                    });
                } else {
                    const clamped = clampContractRange(
                        state.start,
                        state.end,
                        existingContracts
                    );

                    if (!clamped) {
                        alert("No queda ningún día libre para el nuevo contrato sin solaparse con los existentes.");
                        return;
                    }

                    saved = addHonorariaContract(profileName, {
                        start: clamped.start,
                        end: clamped.end,
                        hourlyRate,
                        maxHours,
                        limitPeriod: state.limitPeriod
                    });
                }
            } else {
                saved = addHonorariaContract(profileName, {
                    start: state.start,
                    end: state.end,
                    hourlyRate,
                    maxHours,
                    limitPeriod: state.limitPeriod
                });
            }

            close(saved);
        };

        backdrop.addEventListener("input", event => {
            const target =
                event.target instanceof Element ? event.target : null;

            if (!target) return;

            if (target.matches("[data-honoraria-rate]")) {
                state.hourlyRate = target.value;
            } else if (target.matches("[data-honoraria-max]")) {
                state.maxHours = target.value;
            }
        });

        backdrop.addEventListener("click", async event => {
            if (event.target === backdrop) {
                close(null);
                return;
            }

            const targetElement =
                event.target instanceof Element
                    ? event.target
                    : event.target.parentElement;

            const periodButton =
                targetElement?.closest("[data-period]");

            if (periodButton) {
                state.limitPeriod =
                    periodButton.dataset.period === "monthly"
                        ? "monthly"
                        : "weekly";
                render();
                return;
            }

            const dayButton =
                targetElement?.closest(".profile-mini-day");

            if (dayButton?.dataset.key && !dayButton.disabled) {
                pickDate(dayButton.dataset.key);
                return;
            }

            const action =
                targetElement?.closest("[data-action]")?.dataset.action;

            if (action === "prev" || action === "next") {
                state.monthDate = new Date(
                    state.monthDate.getFullYear(),
                    state.monthDate.getMonth() + (action === "next" ? 1 : -1),
                    1
                );
                render();
                return;
            }

            if (action === "save") {
                await save();
                return;
            }

            if (action === "cancel") {
                close(null);
            }
        });

        render();
    });
}

// `prefill.replaced` (opcional): al llegar desde las sugerencias de reemplazo se
// preselecciona a quien reemplaza y su permiso que cubre `keyDay`, para usarlo
// como respaldo del contrato del reemplazante.
function startReplacementContractEdit(profileName, keyDay, prefill = {}) {
    if (!canEditCurrentProfileMenu()) return;

    const previousProfileName = getCurrentProfile();
    const profile = getProfiles().find(item =>
        item.name === profileName
    );

    if (!profile) return;

    const replaced = String(prefill.replaced || "").trim();
    let prefillLeaveRef = "";

    if (replaced) {
        const coverISO = calendarKeyToInputDate(keyDay);
        const leaveOption = getReplacementLeaveOptionsForProfile(replaced)
            .find(option =>
                option.start <= coverISO &&
                option.end >= coverISO
            );
        prefillLeaveRef = leaveOption?.id || "";
    }

    clearSelectionMode(false);
    availabilityEditMode = false;
    profileAvailabilityDraftTouched = false;
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
    profileDraft.contractReplaces = replaced;
    profileDraft.contractReason = "";
    profileDraft.contractLeaveRef = prefillLeaveRef;
    profileDraft.contractRotationMode =
        REPLACEMENT_ROTATION_MODE.INHERIT;
    profileRotationMiniDate = parseKey(keyDay);

    renderDashboardState();
    openRotationConfigModal("reemplazo", {
        quickContractSave: true,
        previousProfileName,
        sourceProfileName: profileName,
        sourceKeyDay: keyDay
    });
}

window.startReplacementContractEdit =
    startReplacementContractEdit;

// ───────── Estado de enlace de la app del trabajador ─────────

function workerInviteDateLabel(invite) {
    const raw = invite?.createdAt;
    const iso = typeof raw?.toDate === "function"
        ? raw.toDate().toISOString()
        : String(raw || invite?.createdAtISO || "");
    const date = new Date(iso);

    if (Number.isNaN(date.getTime())) return "fecha desconocida";

    return date.toLocaleDateString("es-CL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    });
}

function workerInviteAgeLabel(invitedAtMs) {
    if (!invitedAtMs) return "";

    const days = Math.floor((Date.now() - invitedAtMs) / 86400000);

    if (days <= 0) return "hoy";
    if (days === 1) return "hace 1 día";

    return `hace ${days} días`;
}

// Panel de pendientes: sin la app enlazada el trabajador no aparece en la
// mensajeria ni como candidato de cambio de turno, y hasta ahora eso solo se
// notaba cuando alguien lo echaba de menos. Aqui se ve de una vez quien quedo a
// medias y hace cuanto.
function openWorkerLinkStatusPanel() {
    const rows = listWorkerLinkStates();
    const pending = rows.filter(row => row.state === WORKER_LINK_STATE.PENDING);
    const missing = rows.filter(row => row.state === WORKER_LINK_STATE.NONE);
    const linked = rows.filter(row => row.state === WORKER_LINK_STATE.LINKED);

    const badge = row => {
        if (row.state === WORKER_LINK_STATE.LINKED) {
            return `<span class="wl-badge wl-badge--linked">Enlazado</span>`;
        }

        if (row.state === WORKER_LINK_STATE.PENDING) {
            const age = workerInviteAgeLabel(row.invitedAtMs);

            return `<span class="wl-badge wl-badge--pending">Invitado ${escapeHTML(workerInviteDateLabel(row.invite))}${age ? ` · ${escapeHTML(age)}` : ""}</span>`;
        }

        return `<span class="wl-badge wl-badge--none">Sin invitar</span>`;
    };

    const rowHTML = row => `
        <div class="wl-row wl-row--${escapeHTML(row.state)}">
            <div class="wl-row__name">
                <b>${escapeHTML(row.profile.name)}</b>
                <small>${escapeHTML(row.profile.profession || row.profile.estamento || "")}</small>
            </div>
            ${badge(row)}
        </div>
    `;

    const section = (title, items, empty) => `
        <h4 class="wl-section">${escapeHTML(title)} <span>${items.length}</span></h4>
        ${items.length
            ? items.map(rowHTML).join("")
            : `<p class="wl-empty">${escapeHTML(empty)}</p>`}
    `;

    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog worker-link-status-dialog" role="dialog" aria-modal="true" aria-labelledby="workerLinkStatusTitle">
            <strong id="workerLinkStatusTitle">Enlaces de la app del trabajador</strong>
            <p class="wl-intro">
                Sin la app enlazada el trabajador no aparece en la mensajería ni
                como opción para cambios de turno. Estos son los ${rows.length}
                perfiles activos de la unidad.
            </p>
            <div class="wl-list">
                ${section("Sin invitar", missing, "Todos los perfiles activos tienen invitación.")}
                ${section("Invitados, pendientes de abrir el enlace", pending, "No hay invitaciones sin usar.")}
                ${section("Enlazados", linked, "Aún no hay trabajadores enlazados.")}
            </div>
            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="close">Cerrar</button>
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

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
}

function exitProfileMode(selectedName = getCurrentProfile()) {
    clearSelectionMode(false);
    resetProfileDraft();
    profileAvailabilityDraftTouched = false;
    availabilityEditMode = false;
    createAvailabilityBalances = null;
    profileDraft.mode = PROFILE_MODE.VIEW;

    setCurrentProfile(selectedName || null);
    renderProfiles();
    renderBotones();
}

function activeProfileNameAfterSave(savedName, savedProfile = {}) {
    if (savedProfile.active !== false) return savedName;

    return getProfiles()
        .find(profile =>
            profile.name !== savedName &&
            isProfileActive(profile)
        )?.name || "";
}

function selectProfileAfterSave(savedName, savedProfile = {}) {
    const selectedName =
        activeProfileNameAfterSave(savedName, savedProfile);

    setCurrentProfile(selectedName || null);
}

function normalizeProfileDraftText(value) {
    return String(value || "").trim();
}

function normalizeProfileDraftDocs(docs) {
    return JSON.stringify(Array.isArray(docs) ? docs : []);
}

function profileDraftComparisonSnapshot(data = {}) {
    const rotationType = normalizeProfileDraftText(data.rotationType);
    const estamento = normalizeProfileDraftText(data.estamento);

    return {
        name: normalizeProfileDraftText(data.name),
        email: normalizeProfileDraftText(data.email),
        rut: formatRut(data.rut),
        phone: sanitizeDigits(data.phone, 8),
        birthDate: normalizeStoredStart(data.birthDate || ""),
        docs: normalizeProfileDraftDocs(data.docs),
        active: data.active !== false,
        unitEntryDate: isUnitEntryDateEnabled()
            ? normalizeStoredStart(data.unitEntryDate || "")
            : "",
        contractType: normalizeProfileDraftText(data.contractType),
        estamento,
        profession: normalizeProfession(data.profession, estamento),
        grade: String(data.grade || ""),
        rotationType,
        rotationStart: normalizeStoredStart(data.rotationStart || ""),
        rotationFirstTurn: normalizeRotationFirstTurnForType(
            rotationType,
            data.rotationFirstTurn || "larga"
        ),
        contractStart: normalizeStoredStart(data.contractStart || ""),
        contractEnd: normalizeStoredStart(data.contractEnd || ""),
        contractReplaces: normalizeProfileDraftText(data.contractReplaces),
        contractReason: normalizeProfileDraftText(data.contractReason),
        contractLeaveRef: normalizeProfileDraftText(data.contractLeaveRef),
        contractRotationMode:
            normalizeProfileDraftText(data.contractRotationMode) ||
            "inherit",
        honorariaStart: normalizeStoredStart(data.honorariaStart || ""),
        honorariaEnd: normalizeStoredStart(data.honorariaEnd || ""),
        honorariaHourlyRate: String(data.honorariaHourlyRate || ""),
        honorariaMaxMonthlyHours:
            String(data.honorariaMaxMonthlyHours || ""),
        unionLeaveEnabled: Boolean(data.unionLeaveEnabled),
        shiftAssigned: Boolean(data.shiftAssigned)
    };
}

function savedProfileComparisonSnapshot(profile) {
    const rotativa = getRotativa(profile.name);
    const legacyReplacement = rotativa.type === "reemplazo";

    return profileDraftComparisonSnapshot({
        name: profile.name,
        email: profile.email || "",
        rut: profile.rut || "",
        phone: profile.phone || "",
        birthDate: profile.birthDate || "",
        docs: profile.docs,
        active: isProfileActive(profile),
        unitEntryDate: isUnitEntryDateEnabled()
            ? profile.unitEntryDate || ""
            : "",
        contractType: legacyReplacement
            ? "Reemplazo"
            : profile.contractType || "",
        estamento: profile.estamento || "",
        profession: profile.profession || "Sin informacion",
        grade: String(profile.grade || ""),
        rotationType: legacyReplacement
            ? ""
            : rotativa.type || "",
        rotationStart: legacyReplacement
            ? ""
            : rotativa.start || "",
        rotationFirstTurn: rotativa.firstTurn || "larga",
        contractStart: "",
        contractEnd: "",
        contractReplaces: "",
        contractReason: "",
        contractLeaveRef: "",
        contractRotationMode: "inherit",
        honorariaStart: profile.honorariaStart || "",
        honorariaEnd: profile.honorariaEnd || "",
        honorariaHourlyRate: String(profile.honorariaHourlyRate || ""),
        honorariaMaxMonthlyHours:
            String(profile.honorariaMaxMonthlyHours || ""),
        unionLeaveEnabled: Boolean(profile.unionLeaveEnabled),
        shiftAssigned:
            getShiftAssignmentConfiguredState(profile.name)
    });
}

function emptyCreateProfileComparisonSnapshot() {
    return profileDraftComparisonSnapshot({
        name: "",
        email: "",
        rut: "",
        phone: "",
        birthDate: PROFILE_BIRTH_DATE_DEFAULT,
        docs: [],
        active: true,
        unitEntryDate: "",
        contractType: "",
        estamento: "",
        profession: "Sin informacion",
        grade: "",
        rotationType: "",
        rotationStart: "",
        rotationFirstTurn: "larga",
        contractStart: "",
        contractEnd: "",
        contractReplaces: "",
        contractReason: "",
        contractLeaveRef: "",
        contractRotationMode: "inherit",
        honorariaStart: "",
        honorariaEnd: "",
        honorariaHourlyRate: "",
        honorariaMaxMonthlyHours: "",
        unionLeaveEnabled: false,
        shiftAssigned: false
    });
}

function hasCreateAvailabilityDraftChanged() {
    const defaults = defaultCreateAvailabilityBalances();
    const balances = {
        ...defaults,
        ...(createAvailabilityBalances || {})
    };

    return (
        normalizeLegalBalanceValue(balances.legal) !==
            defaults.legal ||
        normalizeCompEntitlement(balances.comp) !==
            defaults.comp ||
        normalizeBalanceValue(balances.admin) !==
            defaults.admin ||
        normalizeBalanceValue(balances.hoursReturn) !==
            defaults.hoursReturn
    );
}

function hasUnsavedProfileDraftChanges() {
    if (!isProfileEditing()) return false;
    if (profileAvailabilityDraftTouched) return true;

    if (profileDraft.mode === PROFILE_MODE.CREATE) {
        return (
            JSON.stringify(profileDraftComparisonSnapshot(profileDraft)) !==
                JSON.stringify(emptyCreateProfileComparisonSnapshot()) ||
            hasCreateAvailabilityDraftChanged()
        );
    }

    if (profileDraft.mode !== PROFILE_MODE.EDIT) {
        return false;
    }

    const profile = getProfiles().find(item =>
        item.name === profileDraft.originalName
    ) || getPerfilActual();

    if (!profile) return true;

    return JSON.stringify(profileDraftComparisonSnapshot(profileDraft)) !==
        JSON.stringify(savedProfileComparisonSnapshot(profile));
}

function discardProfileDraftChangesBeforeLeaving() {
    const selectedName =
        profileDraft.mode === PROFILE_MODE.CREATE
            ? getCurrentProfile()
            : profileDraft.originalName || getCurrentProfile();

    exitProfileMode(selectedName);
    renderDashboardState();
}

async function confirmProfileDraftBeforeLeaving() {
    if (!isProfileEditing()) return true;

    if (!hasUnsavedProfileDraftChanges()) {
        discardProfileDraftChangesBeforeLeaving();
        return true;
    }

    const label =
        profileDraft.name?.trim() ||
        profileDraft.originalName ||
        "este perfil";
    const shouldSave = await showConfirm(
        `Hay cambios sin guardar en ${label}. Si continuas sin guardar, se descartara el borrador actual.`,
        {
            title: "Cambios sin guardar",
            tone: "warning",
            confirmText: "Guardar cambios",
            cancelText: "Continuar sin guardar"
        }
    );

    if (shouldSave) {
        return await guardarPerfil() === true;
    }

    discardProfileDraftChangesBeforeLeaving();
    return true;
}

function handleRotationSelectionChange() {
    if (!isProfileEditing()) return;

    profileDraft.rotationType =
        DOM.profileRotationSelect.value;
    if (
        contractBlocksShiftAssignment() ||
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
    void setActiveShortcut("profileSection", {
        skipProfileDraftGuard: true
    });

    if (profileDraft.rotationType === "libre") {
        return;
    }

    // La fecha de ingreso a la unidad ya NO es obligatoria para configurar la
    // rotativa. Si existe, el calendario de la rotativa se abre en esa fecha
    // (getRotationConfigDefaultStart); si no, se abre en el mes actual.
    if (
        isHonorariaDraft() &&
        getHonorariaContractsForProfile(honorariaContractProfileName())
            .length === 0
    ) {
        alert("Agrega primero un contrato de Honorarios para configurar la rotativa.");
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

function getProfileEmailDuplicateMessage(email, originalName = "") {
    const duplicateProfile = findDuplicateEmailProfile(
        getProfiles(),
        email,
        originalName
    );

    return duplicateProfile
        ? `Ya existe un trabajador creado con ese correo (${duplicateProfile.name}). Cada trabajador debe tener un correo distinto dentro de la unidad.`
        : "";
}

async function validateProfileEmailPolicy({
    nextEmailKey,
    nextName,
    originalName = ""
}) {
    if (!nextEmailKey) return true;

    const message = getProfileEmailDuplicateMessage(
        nextEmailKey,
        originalName
    );

    if (!message) {
        return true;
    }

    alert(message);

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

function keyWithinScheduleWindow(key, startDate, endISO = "") {
    if (!isDateKeyOnOrAfter(key, startDate)) return false;

    if (!endISO) return true;

    const iso = calendarKeyToInputDate(key);

    return Boolean(iso) && compareISODate(iso, endISO) <= 0;
}

function scheduleWindowKeys(map, startDate, endISO = "") {
    if (!endISO) return futureKeys(map, startDate);

    return Object.keys(map || {}).filter(key =>
        keyWithinScheduleWindow(key, startDate, endISO)
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

function previousISODate(value) {
    const date = parseInputDate(value);

    if (Number.isNaN(date.getTime())) return "";

    date.setDate(date.getDate() - 1);

    return toISODate(date);
}

function getRotationOverlapWindow({
    requestedStart = "",
    currentRotation = {}
} = {}) {
    const startISO = normalizeStoredStart(requestedStart);
    const currentStart = normalizeStoredStart(currentRotation?.start || "");

    if (
        !startISO ||
        !currentStart ||
        compareISODate(startISO, currentStart) >= 0
    ) {
        return null;
    }

    const endISO = previousISODate(currentStart);

    if (!endISO || compareISODate(startISO, endISO) > 0) {
        return null;
    }

    return {
        currentStart,
        endISO
    };
}

function requestRotationOverlapDecision({
    profileName = "",
    requestedType = "",
    requestedStart = "",
    requestedFirstTurn = "larga",
    currentRotation = {}
} = {}) {
    const overlap = getRotationOverlapWindow({
        requestedStart,
        currentRotation
    });

    if (!overlap) {
        return Promise.resolve({
            mode: "replace",
            endISO: "",
            currentStart: ""
        });
    }

    return new Promise(resolve => {
        const backdrop = document.createElement("div");
        const currentType = currentRotation?.type || "";
        const firstTurnText =
            requiresRotationFirstTurn(requestedType)
                ? ` iniciando con ${getRotationFirstTurnLabel(requestedFirstTurn, requestedType)}`
                : "";

        backdrop.className = "turn-change-dialog-backdrop";
        backdrop.innerHTML = `
            <div class="turn-change-dialog rotation-config-dialog" role="dialog" aria-modal="true">
                <strong>Ya existe una rotativa vigente</strong>
                <p>
                    ${escapeHTML(profileName)} ya tiene una rotativa
                    ${escapeHTML(getRotativaLabel(currentType))}
                    aplicada desde el
                    <b>${escapeHTML(formatDisplayDate(overlap.currentStart))}</b>.
                </p>
                <p>
                    La nueva rotativa
                    <b>${escapeHTML(getRotativaLabel(requestedType))}${escapeHTML(firstTurnText)}</b>
                    fue seleccionada desde el
                    <b>${escapeHTML(formatDisplayDate(requestedStart))}</b>.
                </p>
                <div class="firebase-dialog-note">
                    Puedes reemplazar la rotativa vigente, lo que resetea el calendario del trabajador desde
                    ${escapeHTML(formatDisplayDate(requestedStart))}, anulando turnos extras, cambios de turno,
                    permisos y ausencias de ese tramo; o aplicarla solo hasta el
                    ${escapeHTML(formatDisplayDate(overlap.endISO))}, sin pisar la rotativa que comienza el
                    ${escapeHTML(formatDisplayDate(overlap.currentStart))}.
                </div>
                <div class="turn-change-dialog__actions">
                    <button class="leave-detail-undo" type="button" data-action="replace">
                        Reemplazar rotativa vigente
                    </button>
                    <button class="primary-button" type="button" data-action="limit">
                        Aplicar hasta ${escapeHTML(formatDisplayDate(overlap.endISO))}
                    </button>
                    <button class="secondary-button" type="button" data-action="cancel">
                        Cancelar
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
                close(null);
            }
        };

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

            close({
                mode: action === "limit" ? "limit" : "replace",
                endISO: action === "limit" ? overlap.endISO : "",
                currentStart: overlap.currentStart
            });
        });

        document.addEventListener("keydown", onKeydown);
        document.body.appendChild(backdrop);
        backdrop
            .querySelector("[data-action='limit']")
            ?.focus();
    });
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

function isoWithinScheduleWindow(iso, startISO, endISO = "") {
    return Boolean(iso) &&
        compareISODate(iso, startISO) >= 0 &&
        (
            !endISO ||
            compareISODate(iso, endISO) <= 0
        );
}

function cleanupFutureSwaps(profileName, startISO, endISO = "") {
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
            isoWithinScheduleWindow(swap.fecha, startISO, endISO);
        const skipDevolucion =
            Boolean(swap.skipDevolucion) ||
            isoWithinScheduleWindow(swap.devolucion, startISO, endISO);

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

async function cleanupFutureSchedule(startDate, options = {}) {
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
    const endISO = normalizeStoredStart(options.endISO || "");

    scheduleWindowKeys(data, startDate, endISO).forEach(key => {
        delete data[key];
    });

    scheduleWindowKeys(baseData, startDate, endISO).forEach(key => {
        delete baseData[key];
    });

    scheduleWindowKeys(blocked, startDate, endISO).forEach(key => {
        delete blocked[key];
    });

    scheduleWindowKeys(legal, startDate, endISO).forEach(key => {
        delete legal[key];
        pushReturnKey(returnedLegal, key);
    });

    scheduleWindowKeys(comp, startDate, endISO).forEach(key => {
        delete comp[key];
        pushReturnKey(returnedComp, key);
    });

    scheduleWindowKeys(admin, startDate, endISO).forEach(key => {
        const amount = admin[key] === 1 ? 1 : 0.5;
        const year = key.split("-")[0];

        delete admin[key];
        returnedAdmin[year] =
            (returnedAdmin[year] || 0) + amount;
    });

    scheduleWindowKeys(absences, startDate, endISO).forEach(key => {
        delete absences[key];
    });

    scheduleWindowKeys(hourReturns, startDate, endISO).forEach(key => {
        delete hourReturns[key];
    });

    cleanupFutureSwaps(profileName, startISO, endISO);

    if (endISO) {
        cancelShiftMovesForWorkerRange(profileName, startDate, endISO);
        cancelReplacementsForWorkerRange(profileName, startISO, endISO, {
            reason: "rotation_reset",
            details:
                "Turno extra anulado al aplicar una nueva rotativa dentro de este periodo."
        });
    } else {
        cancelFutureShiftMovesForWorker(profileName, startDate);
        cancelFutureReplacementsForWorker(profileName, startISO, {
            reason: "rotation_reset",
            details:
                "Turno extra anulado al aplicar una nueva rotativa desde esta fecha."
        });
    }

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
    // Honorarios: la rotativa se escribe como turnos EXPLICITOS desde la fecha
    // elegida hasta el fin del contrato que la contiene (el motor base no computa
    // honorarios, para no mezclar anclas). Se acota el rango al contrato para no
    // pintar dias fuera de el y para preservar los dias anteriores del contrato.
    const rotationProfileName = getCurrentProfile();
    const isHonoraria =
        Boolean(rotationProfileName) &&
        isHonorariaProfile(rotationProfileName);
    let endISO = options.endISO || "";

    if (isHonoraria && rotationStart) {
        const contract = getHonorariaContractsForProfile(rotationProfileName)
            .find(item =>
                item.start <= rotationStart && item.end >= rotationStart
            );

        if (contract?.end) {
            endISO = endISO
                ? (compareISODate(endISO, contract.end) <= 0
                    ? endISO
                    : contract.end)
                : contract.end;
        }
    }

    if (rotationType === "libre") {
        if (options.cleanupStart) {
            await cleanupFutureSchedule(
                parseInputDate(options.cleanupStart),
                { endISO }
            );
        }

        refreshAll();
        return;
    }

    const startDate = parseInputDate(rotationStart);

    await cleanupFutureSchedule(startDate, { endISO });

    if (rotationType === "reemplazo") {
        refreshAll();
        return;
    }

    if (rotationType === "diurno") {
        await aplicarDiurnoDesde(startDate, { endISO });
        return;
    }

    if (rotationType === "3turno") {
        await aplicarTercerTurnoDesde(startDate, firstTurn, { endISO });
        return;
    }

    await aplicarCuartoTurnoDesde(startDate, firstTurn, { endISO });
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

// Resuelve el caso en que el correo que se intenta usar sigue asociado a otro
// perfil aunque su ficha se vea vacia (dato residual tras "quitar" el correo).
// Devuelve false solo si el usuario cancela; si libera el correo lo quita de ese
// otro perfil para poder reutilizarlo. Debe correr ANTES de la validacion
// sincronica, que si no bloquearia con "ya existe un trabajador con ese correo".
async function resolveDuplicateEmailBeforeSave() {
    const emailKey = normalizeEmailKey(profileDraft.email);

    if (!emailKey || getEmailValidationMessage(profileDraft.email)) {
        return true;
    }

    const originalName =
        profileDraft.mode === PROFILE_MODE.EDIT
            ? profileDraft.originalName
            : "";
    const duplicateProfile = findDuplicateEmailProfile(
        getProfiles(),
        emailKey,
        originalName
    );

    if (!duplicateProfile) return true;

    const link = getWorkerAppLinkForProfile(duplicateProfile.name);

    if (link?.uid) {
        alert(
            `El correo pertenece a ${duplicateProfile.name}, que tiene la PWA enlazada. Desenlaza esa cuenta desde su perfil antes de reutilizar el correo.`
        );
        return false;
    }

    const freeEmail = await showConfirm(
        `El correo ya figura en el perfil de ${duplicateProfile.name} (aunque su ficha se vea vacia por un dato residual).\n\n¿Quitar el correo de ${duplicateProfile.name} para usarlo aqui?`,
        {
            title: "Correo en uso",
            tone: "warning",
            confirmText: "Quitar y usar aqui",
            cancelText: "Cancelar"
        }
    );

    if (!freeEmail) return false;

    updateProfile(duplicateProfile.name, {
        ...duplicateProfile,
        email: ""
    });
    addAuditLog(
        AUDIT_CATEGORY.COLLABORATOR_UPDATED,
        "Libero correo de colaborador",
        `Se quito el correo de ${duplicateProfile.name} para reutilizarlo.`,
        { profile: duplicateProfile.name }
    );

    return true;
}

async function guardarPerfil() {
    if (!canEditCurrentProfileMenu()) return false;
    if (!await resolveDuplicateEmailBeforeSave()) return false;
    if (!validateDraft()) return false;

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
            return false;
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
    const honorariaContract =
        isHonorariaDraft();
    const gradeBlocked =
        contractBlocksGrade();
    const shiftAssignmentBlocked =
        contractBlocksShiftAssignment();
    const nextRotationType = replacementContract
        ? (
            profileDraft.originalRotationType === "libre"
                ? "libre"
                : ""
        )
        : profileDraft.rotationType;
    const nextShiftAssigned =
        !shiftAssignmentBlocked &&
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
    const contractTypeChanged =
        isEditing && hasContractTypeValueChanged();
    const compensationValuesChanged =
        isEditing &&
        (
            hasGradeValueChanged() ||
            contractTypeChanged
        );
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
        // Los contratos de Honorarios viven en honorariaContracts_{nombre} (lista),
        // no en el perfil. No se escriben aqui para no pisar los campos legados de
        // perfiles existentes (se preservan por el spread de updateProfile hasta
        // que se migran al agregar el primer contrato en la lista).
        unionLeaveEnabled:
            !contractBlocksUnionLeave() &&
            Boolean(profileDraft.unionLeaveEnabled),
        estamento: nextEstamento,
        profession: nextProfession,
        grade: gradeBlocked ? "" : profileDraft.grade
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
            ? (getHonorariaContractsForProfile(
                honorariaContractProfileName()
            )[0]?.start || "")
            : "";
    const shouldSaveReplacementContract =
        replacementContract &&
        requiresReplacementContract();
    let effectiveRotationType = nextRotationType;
    let effectiveRotationStart = nextRotationStart;
    let effectiveRotationFirstTurn = nextRotationFirstTurn;
    let rotationOverlapDecision = {
        mode: "replace",
        endISO: "",
        currentStart: ""
    };
    let nextSnapshot = {
        ...nextProfilePayload,
        shiftAssigned: nextShiftAssigned,
        rotativa: {
            type: nextRotationType,
            start: nextRotationStart,
            firstTurn: nextRotationFirstTurn
        }
    };
    let compensationEffectiveDate = "";
    let shiftAssignmentEffectiveMonth = "";

    if (
        !await validateProfileSavePreflight({
            isCreating,
            isEditing,
            nextName,
            nextEmailKey
        })
    ) {
        return false;
    }

    if (shiftAssignmentChanged) {
        shiftAssignmentEffectiveMonth =
            await requestShiftAssignmentEffectiveMonth(
                nextShiftAssigned
            );

        if (!shiftAssignmentEffectiveMonth) {
            return false;
        }
    }

    if (compensationValuesChanged) {
        compensationEffectiveDate =
            await requestGradeEffectiveDate(
                previousSnapshot,
                nextProfilePayload
            );

        if (!compensationEffectiveDate) {
            return false;
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
        return false;
    }

    if (
        shouldApplyRotation &&
        isEditing &&
        nextRotationStart
    ) {
        rotationOverlapDecision =
            await requestRotationOverlapDecision({
                profileName: nextName,
                requestedType: nextRotationType,
                requestedStart: nextRotationStart,
                requestedFirstTurn: nextRotationFirstTurn,
                currentRotation: previousSnapshot?.rotativa || {}
            });

        if (!rotationOverlapDecision) {
            return false;
        }

        if (rotationOverlapDecision.mode === "limit") {
            const preservedRotation =
                previousSnapshot?.rotativa || {};

            effectiveRotationType =
                preservedRotation.type || nextRotationType;
            effectiveRotationStart =
                normalizeStoredStart(preservedRotation.start || "");
            effectiveRotationFirstTurn =
                normalizeRotationFirstTurnForType(
                    effectiveRotationType,
                    preservedRotation.firstTurn ||
                        nextRotationFirstTurn
                );
            nextSnapshot = {
                ...nextSnapshot,
                rotativa: {
                    type: effectiveRotationType,
                    start: effectiveRotationStart,
                    firstTurn: effectiveRotationFirstTurn
                }
            };
        }
    }

    let automaticInviteResult = null;
    const profileSaveSealNames = [
        nextName,
        isEditing ? profileDraft.originalName : "",
        shouldSaveReplacementContract
            ? profileDraft.contractReplaces
            : ""
    ].filter(Boolean);

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
                return false;
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

            if (compensationEffectiveDate) {
                recordGradeHistoryChange(
                    nextName,
                    previousSnapshot,
                    nextProfilePayload,
                    compensationEffectiveDate
                );
            }

            recordProfileContractHistory(
                nextName,
                previousSnapshot,
                nextSnapshot,
                compensationEffectiveDate
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
            type: effectiveRotationType,
            start: effectiveRotationStart,
            firstTurn: effectiveRotationFirstTurn
        });

        if (isEditing) {
            syncStaffingConfigForProfileChange(
                previousSnapshot,
                nextSnapshot
            );
        }

        if (shouldSaveReplacementContract) {
            await saveReplacementContractFromDraft(nextName, {
                audit: false,
                memo: true
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
                `${nextName} (${nextEstamento}) con rotativa ${getRotativaLabel(effectiveRotationType)}.`,
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
                    cleanupStart: rotationCleanupStart,
                    endISO: rotationOverlapDecision.endISO
                }
            );

            const rotationDateText =
                rotationOverlapDecision.mode === "limit"
                    ? ` desde ${formatDisplayDate(nextRotationStart)} hasta ${formatDisplayDate(rotationOverlapDecision.endISO)}`
                    : nextRotationStart
                        ? ` desde ${formatDisplayDate(nextRotationStart)}`
                        : "";
            const rotationAuditSuffix =
                rotationOverlapDecision.mode === "limit"
                    ? `. Se mantuvo la rotativa vigente desde ${formatDisplayDate(rotationOverlapDecision.currentStart)}.`
                    : nextRotationType === "libre"
                        ? ". Calendario base libre para carga manual."
                        : ". Se limpiaron programaciones futuras desde esa fecha.";
            const rotationAuditAction =
                rotationOverlapDecision.mode === "limit"
                    ? "Aplic\u00f3 rotativa historica"
                    : "Aplic\u00f3 rotativa base";

            addAuditLog(
                AUDIT_CATEGORY.CALENDAR,
                rotationAuditAction,
                `${nextName}: ${getRotativaLabel(nextRotationType)}${rotationDateText}${requiresRotationFirstTurn(nextRotationType) ? ` iniciando con ${getRotationFirstTurnLabel(nextRotationFirstTurn, nextRotationType)}` : ""}${rotationAuditSuffix}`,
                {
                    profile: nextName,
                    date: nextRotationStart,
                    endDate: rotationOverlapDecision.endISO,
                    rotationType: nextRotationType,
                    firstTurn: nextRotationFirstTurn,
                    mode: rotationOverlapDecision.mode
                }
            );
        }
        await withBusyState(
            () => sealCriticalProfileState(
                profileSaveSealNames,
                "profile-save"
            ),
            {
                label: "Confirmando guardado..."
            }
        );
        selectProfileAfterSave(nextName, nextProfilePayload);
        renderProfiles({ dashboard: false });
        renderBotones();
        refreshAll();
        scheduleWorkerAppDataPublish(300, nextName);

        if (automaticInviteResult?.status === "error") {
            alert(
                `El perfil de ${nextName} se guardo, pero no se pudo enviar la invitacion al correo ${nextProfilePayload.email}. Puedes reintentarlo con ENLACE APP.`
            );
        }
        return true;
    } catch (error) {
        alert(
            error.message ||
            "No se pudo guardar el colaborador."
        );
        return false;
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

function activarSelectorCapacitacion() {
    if (!canModifyCurrentProfile()) return;

    activarModo(
        "training",
        "Selecciona el turno diurno donde el trabajador asistira a capacitacion."
    );

    DOM.adminInfo.textContent =
        "Solo quedan habilitados turnos Larga o Diurno sin permisos, licencias, ausencias ni devoluciones.";
}

function compareDateMinute(left, right) {
    return Math.round(left.getTime() / 60000) -
        Math.round(right.getTime() / 60000);
}

function sameMinute(left, right) {
    return compareDateMinute(left, right) === 0;
}

function minDate(...dates) {
    return new Date(Math.min(...dates.map(date => date.getTime())));
}

function maxDate(...dates) {
    return new Date(Math.max(...dates.map(date => date.getTime())));
}

function trainingIntervalFromTimes(
    date,
    startTime,
    endTime,
    scheduledStart = null,
    scheduledEnd = null
) {
    const start = parseTimeValue(startTime);
    const end = parseTimeValue(endTime);

    if (!start || !end) return null;

    const startDate = dateAt(date, start.hour, start.minute);
    const endDate = dateAt(date, end.hour, end.minute);
    const crossesMidnight =
        scheduledStart &&
        scheduledEnd &&
        scheduledEnd > scheduledStart &&
        scheduledEnd.getDate() !== scheduledStart.getDate();

    if (crossesMidnight && startDate < scheduledStart) {
        const nextStart = cloneDate(startDate);

        nextStart.setDate(nextStart.getDate() + 1);

        if (nextStart >= scheduledStart && nextStart < scheduledEnd) {
            startDate.setDate(startDate.getDate() + 1);
        }
    }

    if (endDate <= startDate) {
        endDate.setDate(endDate.getDate() + 1);
    }

    return {
        start: startDate,
        end: endDate
    };
}

function trainingIntersections(interval, segments) {
    return segments
        .map(segment => ({
            start: maxDate(interval.start, segment.start),
            end: minDate(interval.end, segment.end)
        }))
        .filter(item => item.end > item.start);
}

function trainingBoundaryAfter(cursor, end) {
    const candidates = [
        new Date(
            cursor.getFullYear(),
            cursor.getMonth(),
            cursor.getDate() + 1,
            0,
            0
        ),
        dateAt(cursor, 7),
        dateAt(cursor, 21),
        end
    ].filter(date => date > cursor);

    return minDate(...candidates);
}

function trainingHourBucket(cursor, holidays) {
    const day = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate()
    );
    const hour = cursor.getHours() + cursor.getMinutes() / 60;

    return !isBusinessDay(day, holidays) || hour < 7 || hour >= 21
        ? "n"
        : "d";
}

function roundTrainingHours(value) {
    return Math.round((Number(value) || 0) * 2) / 2;
}

function classifyTrainingIntervals(intervals, holidays) {
    const total = { d: 0, n: 0 };

    intervals.forEach(interval => {
        let cursor = cloneDate(interval.start);

        while (cursor < interval.end) {
            const boundary = trainingBoundaryAfter(cursor, interval.end);
            const amount = Math.max(0, (boundary - cursor) / 36e5);

            total[trainingHourBucket(cursor, holidays)] += amount;
            cursor = boundary;
        }
    });

    return {
        d: roundTrainingHours(total.d),
        n: roundTrainingHours(total.n)
    };
}

function formatTrainingHours(value) {
    const rounded = roundTrainingHours(value);

    return Number.isInteger(rounded)
        ? String(rounded)
        : String(rounded).replace(".", ",");
}

function buildTrainingRecord({
    date,
    state,
    holidays,
    segments,
    startTime,
    endTime
}) {
    const scheduledStart = segments[0]?.start;
    const scheduledEnd = segments[segments.length - 1]?.end;
    const interval = trainingIntervalFromTimes(
        date,
        startTime,
        endTime,
        scheduledStart,
        scheduledEnd
    );

    if (!interval) {
        return { error: "Ingresa una hora de inicio y termino valida." };
    }

    if (
        !scheduledStart ||
        !scheduledEnd ||
        interval.start < scheduledStart ||
        interval.end > scheduledEnd
    ) {
        return {
            error: "La capacitacion debe quedar dentro de la jornada programada."
        };
    }

    const intersections = trainingIntersections(interval, segments);

    if (!intersections.length) {
        return {
            error: "El tramo seleccionado no cruza horas trabajadas de la jornada."
        };
    }

    const fullSchedule =
        sameMinute(interval.start, scheduledStart) &&
        sameMinute(interval.end, scheduledEnd);
    const overtimeHours = fullSchedule
        ? calcHours(date, Number(state) || TURNO.LIBRE, holidays)
        : classifyTrainingIntervals(intersections, holidays);

    return {
        record: {
            type: "training",
            startTime,
            endTime,
            scheduledStart: formatTime(scheduledStart),
            scheduledEnd: formatTime(scheduledEnd),
            overtimeHours
        }
    };
}

function openTrainingDialog({
    profile,
    keyDay,
    date,
    state,
    holidays,
    segments
}) {
    return new Promise(resolve => {
        const scheduledStart = segments[0]?.start;
        const scheduledEnd = segments[segments.length - 1]?.end;
        const backdrop = document.createElement("div");

        backdrop.className = "turn-change-dialog-backdrop";
        backdrop.innerHTML = `
            <form class="turn-change-dialog clock-mark-dialog training-dialog" role="dialog" aria-modal="true">
                <strong>Capacitaci&oacute;n</strong>
                <p>
                    ${escapeHTML(profile)} | ${escapeHTML(turnoLabel(state) || "Turno")}
                </p>
                <div class="training-time-grid">
                    <label>
                        <span>Desde</span>
                        <input name="startTime" type="time" step="300" required value="${escapeHTML(formatTime(scheduledStart))}">
                    </label>
                    <label>
                        <span>Hasta</span>
                        <input name="endTime" type="time" step="300" required value="${escapeHTML(formatTime(scheduledEnd))}">
                    </label>
                </div>
                <p class="training-dialog-summary" data-training-summary></p>
                <div class="turn-change-dialog__actions">
                    <button class="primary-button" type="submit">
                        Guardar
                    </button>
                    <button class="secondary-button" type="button" data-action="cancel">
                        Cancelar
                    </button>
                </div>
            </form>
        `;

        const dialog = backdrop.querySelector("form");
        const startInput = dialog.querySelector("[name='startTime']");
        const endInput = dialog.querySelector("[name='endTime']");
        const summary = dialog.querySelector("[data-training-summary]");
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
        const currentRecord = () => buildTrainingRecord({
            date,
            state,
            holidays,
            segments,
            startTime: startInput.value,
            endTime: endInput.value
        });
        const syncSummary = () => {
            const result = currentRecord();

            if (result.error) {
                summary.textContent = result.error;
                summary.classList.add("is-error");
                return;
            }

            const hours = result.record.overtimeHours;

            summary.classList.remove("is-error");
            summary.textContent =
                `Reemplazo: ${formatTrainingHours(hours.d)} h diurnas / ` +
                `${formatTrainingHours(hours.n)} h nocturnas.`;
        };

        startInput.addEventListener("input", syncSummary);
        endInput.addEventListener("input", syncSummary);

        dialog
            .querySelector("[data-action='cancel']")
            .onclick = () => close(null);

        dialog.onsubmit = event => {
            event.preventDefault();

            const result = currentRecord();

            if (result.error) {
                alert(result.error);
                return;
            }

            close(result.record);
        };

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) {
                close(null);
            }
        });

        document.addEventListener("keydown", onKeydown);
        document.body.appendChild(backdrop);
        syncSummary();
        startInput.focus();
    });
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

/* ======================================================
   Botones de turno del menu Turnos (Diurno / Larga / Noche)

   Ahorran el switch de "Editar": se elige el turno en el boton y se marca el
   dia. El calendario ya dejo habilitadas SOLO las casillas donde ese turno cabe
   (canAddTurnToDay), asi que aqui basta con aplicarlo. Un boton pone un turno:
   despues el modo se apaga solo, para no dejarlo armado sin querer.
====================================================== */

// Cada boton con su turno. Los "-pre" ponen el MISMO turno pero como reserva:
// se pinta la casilla y no se publica a la aplicacion del trabajador hasta que
// se confirme (ver addPreassignedTurnToDay).
const ADD_TURN_OPTIONS = {
    diurno: { turno: TURNO.DIURNO, label: "Diurno" },
    larga: { turno: TURNO.LARGA, label: "Larga" },
    noche: { turno: TURNO.NOCHE, label: "Noche" },
    "diurno-pre": {
        turno: TURNO.DIURNO,
        label: "Diurno preasignado",
        preassign: true
    },
    "larga-pre": {
        turno: TURNO.LARGA,
        label: "Larga preasignado",
        preassign: true
    },
    "noche-pre": {
        turno: TURNO.NOCHE,
        label: "Noche preasignado",
        preassign: true
    }
};

function syncAddTurnButtons() {
    const armado = window.selectionMode === "addturn"
        ? Number(window.pendingAddTurn) || 0
        : 0;
    // El turno solo no basta para saber cual boton esta armado: "Noche" y
    // "Noche preasignado" ponen el mismo, y sin esto se marcaban los dos.
    const armadoPre = Boolean(window.pendingAddTurnPreassign);
    // El punto del boton lleva el color CONFIGURADO del turno, no uno fijo en
    // el CSS: la unidad puede cambiarlos, y el boton tiene que leerse como la
    // casilla que va a pintar.
    const colores = getTurnoColorConfig().base;

    document
        .querySelectorAll("[data-add-turn]")
        .forEach(button => {
            const opcion = ADD_TURN_OPTIONS[button.dataset.addTurn];

            if (!opcion) return;

            const activo = opcion.turno === armado &&
                Boolean(opcion.preassign) === armadoPre;

            button.style.setProperty(
                "--add-turn-color",
                colores[opcion.turno] || ""
            );
            button.classList.toggle("is-armed", activo);
            button.setAttribute("aria-pressed", activo ? "true" : "false");
        });
}

async function handleAddTurnSelection(fecha) {
    const profile = getCurrentProfile();
    const keyDay = keyFromDate(fecha);
    const turno = Number(window.pendingAddTurn) || 0;

    if (!profile || !turno) {
        clearSelectionMode();
        return;
    }

    const holidays = await fetchHolidays(fecha.getFullYear());
    const preasignar = Boolean(window.pendingAddTurnPreassign);

    pushHistory();

    const aplicado = preasignar
        ? addPreassignedTurnToDay(profile, keyDay, turno, {
            isHab: isBusinessDay(fecha, holidays)
        })
        : addTurnToDay(profile, keyDay, turno, {
            date: fecha,
            holidays,
            isHab: isBusinessDay(fecha, holidays)
        });

    // Un boton, un turno.
    clearSelectionMode();

    if (!aplicado) {
        alert("Ese turno no se puede agregar en este dia.");
        return;
    }

    // Repintar a mano, porque una reserva no pasa por commitCalendarTurnChange.
    if (preasignar) {
        await updateDayCell(profile, keyDay);
        await updateVisibleCalendarDays({ updateSummary: true });
        // El motivo se pide AQUI por lo mismo que en el turno normal: es cuando
        // el supervisor sabe por que lo esta reservando. Se puede dejar para
        // despues -desde la insignia de la casilla- y si al confirmar sigue sin
        // motivo, se vuelve a preguntar.
        await openPreassignmentReasonForDay(profile, keyDay);
        return;
    }

    // El motivo se pide AQUI, recien puesto el turno: es cuando el supervisor
    // sabe por que lo agrego. Si se deja para despues hay que ir a buscar la
    // casilla con el "?" y casi nunca se completa. El modal se abre despues de
    // apagar el modo porque no sale mientras haya una seleccion activa.
    await openManualExtraReasonForDay(profile, keyDay);
}

function activarModoAgregarTurno(clave) {
    const opcion = ADD_TURN_OPTIONS[clave];

    if (!opcion) return;

    // Apretar el mismo boton otra vez apaga el modo: es la salida mas a mano,
    // sin ir hasta "Cancelar".
    if (
        window.selectionMode === "addturn" &&
        Number(window.pendingAddTurn) === opcion.turno &&
        Boolean(window.pendingAddTurnPreassign) === Boolean(opcion.preassign)
    ) {
        clearSelectionMode();
        return;
    }

    window.pendingAddTurn = opcion.turno;
    window.pendingAddTurnPreassign = Boolean(opcion.preassign);
    activarModo(
        "addturn",
        opcion.preassign
            ? `Preasignando ${opcion.label.replace(" preasignado", "")}`
            : `Agregando turno ${opcion.label}`
    );

    if (!window.selectionMode) {
        // activarModo se planta si el perfil no se puede modificar.
        window.pendingAddTurn = 0;
        window.pendingAddTurnPreassign = false;
    }

    syncAddTurnButtons();
}

async function handleTrainingSelection(fecha) {
    const profile = getCurrentProfile();
    const keyDay = keyFromDate(fecha);
    const holidays = await fetchHolidays(fecha.getFullYear());
    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();
    const absences = getAbsences();
    const state = getTurnoBase(profile, keyDay);

    if (!esTurnoCapacitacionValido(state)) {
        alert("Selecciona un turno diurno (Larga o Diurno) para registrar capacitacion.");
        clearSelectionMode();
        return;
    }

    if (
        admin[keyDay] ||
        legal[keyDay] ||
        comp[keyDay] ||
        absences[keyDay] ||
        getHourReturn(profile, keyDay)
    ) {
        alert("Este turno ya tiene un permiso, licencia, feriado, ausencia o devolucion aplicada.");
        clearSelectionMode();
        return;
    }

    const segments = getScheduledSegmentsForProfile(
        profile,
        keyDay,
        fecha,
        state,
        holidays
    ).filter(segment => segment.start < segment.end);

    if (!segments.length) {
        alert("No hay un horario de turno disponible para esta fecha.");
        clearSelectionMode();
        return;
    }

    const record = await openTrainingDialog({
        profile,
        keyDay,
        date: fecha,
        state,
        holidays,
        segments
    });

    if (!record) {
        clearSelectionMode();
        return;
    }

    const applied = await aplicarCapacitacion(
        fecha,
        record,
        {
            beforeMutation: () => pushHistory()
        }
    );

    if (applied === false) {
        alert("No se pudo registrar la capacitacion en ese turno.");
    }

    clearSelectionMode();
}

// Permite abrir el editor de marcaje para una fecha desde fuera del modo de
// seleccion (p. ej. el boton "Modificar marcaje" del modal de detalle).
window.openClockMarkEditorForDate = handleClockMarkSelection;

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

        if (contractBlocksUnionLeave()) {
            profileDraft.unionLeaveEnabled = false;
        }

        if (contractBlocksGrade()) {
            profileDraft.grade = "";
        }

        if (contractBlocksShiftAssignment()) {
            profileDraft.shiftAssigned = false;
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
            if (contractBlocksUnionLeave()) {
                profileDraft.unionLeaveEnabled = false;
                DOM.profileUnionLeaveInput.checked = false;
                return;
            }

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
        if (contractBlocksGrade()) {
            profileDraft.grade = "";
            return;
        }
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

    if (DOM.honorariaAddContractBtn) {
        DOM.honorariaAddContractBtn.onclick = async () => {
            if (!isProfileEditing()) return;

            const profileName = honorariaContractProfileName();

            if (!profileName) {
                alert("Indica primero el nombre del trabajador.");
                return;
            }

            // Mismo modal que en el calendario, sin fecha prellenada: el supervisor
            // elige inicio y termino sobre el calendario.
            const saved = await openHonorariaContractModal({ profileName });

            if (saved) {
                renderDashboardState();
                refreshAll();
            }
        };
    }

    if (DOM.honorariaContractList) {
        DOM.honorariaContractList.onclick = async event => {
            if (!isProfileEditing()) return;

            const profileName = honorariaContractProfileName();

            if (!profileName) return;

            const editButton =
                event.target.closest("[data-honoraria-edit]");

            if (editButton) {
                const saved = await openHonorariaContractModal({
                    profileName,
                    contractId: editButton.dataset.honorariaEdit
                });

                if (saved) {
                    renderDashboardState();
                    refreshAll();
                }

                return;
            }

            const button = event.target.closest("[data-honoraria-remove]");

            if (!button) return;

            if (!await showConfirm(
                "¿Eliminar este contrato de honorarios?",
                {
                    title: "Eliminar contrato",
                    tone: "warning",
                    confirmText: "Eliminar",
                    cancelText: "Cancelar"
                }
            )) {
                return;
            }

            removeHonorariaContract(
                profileName,
                button.dataset.honorariaRemove
            );
            renderDashboardState();
            refreshAll();
        };
    }

    DOM.checkbox.onchange = async () => {
        if (isProfileEditing()) {
            if (contractBlocksShiftAssignment()) {
                profileDraft.shiftAssigned = false;
                DOM.checkbox.checked = false;
                return;
            }

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

    if (DOM.workerLinkStatusBtn) {
        DOM.workerLinkStatusBtn.onclick = openWorkerLinkStatusPanel;
    }

    const profileExportPdfBtn = document.getElementById("profileExportPdfBtn");
    if (profileExportPdfBtn) {
        profileExportPdfBtn.onclick = exportProfileFichaPdf;
    }

    document.querySelectorAll("[data-profile-edit]").forEach(btn => {
        btn.onclick = () => startEditMode();
    });

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

    const hheeOnlyMissingToggle = document.getElementById("hheeOnlyMissing");
    if (hheeOnlyMissingToggle) {
        hheeOnlyMissingToggle.onchange = () => {
            hheeOnlyMissing = hheeOnlyMissingToggle.checked;
            renderHheeRecordsList();
        };
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
    window.addEventListener("popstate", async event => {
        const targetId =
            event.state?.proTurnosTarget ||
            targetFromHash() ||
            firstViewableTarget();
        const nextTarget =
            isAppTarget(targetId) && canViewTarget(targetId)
                ? targetId
                : firstViewableTarget();

        if (nextTarget) {
            const navigated = await setActiveShortcut(nextTarget, {
                historyMode: "none"
            });

            if (!navigated) {
                syncAppNavigationHistory(
                    getTargetForActiveView(),
                    "replace"
                );
            }
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
    const sidePanel = document.getElementById("turnosSidePanel");
    const primaryGrid = document.querySelector(".primary-grid");

    if (!timelinePanel) {
        return;
    }

    if (isMobileLayout()) {
        if (sidePanel && timelinePanel.previousElementSibling !== sidePanel) {
            sidePanel.after(timelinePanel);
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

function isCalendarDirectEditEnabled() {
    return calendarDirectEditEnabled;
}

window.calendarDirectEditEnabled = isCalendarDirectEditEnabled;

function clearCalendarDirectEditIdleTimer() {
    clearTimeout(calendarDirectEditIdleTimer);
    calendarDirectEditIdleTimer = 0;
}

function scheduleCalendarDirectEditIdleTimer() {
    clearCalendarDirectEditIdleTimer();

    if (!calendarDirectEditEnabled) return;

    calendarDirectEditIdleTimer = window.setTimeout(() => {
        void disableCalendarDirectEditMode({
            flush: true,
            refresh: true,
            reason: "inactivity-timeout"
        });
        showAppToast(
            "El modo edicion se cerro por inactividad y se enviaron los cambios pendientes.",
            { title: "Edicion confirmada", variant: "info" }
        );
    }, CALENDAR_DIRECT_EDIT_IDLE_TIMEOUT_MS);
}

function noteCalendarDirectEditActivity() {
    if (!calendarDirectEditEnabled) return;

    scheduleCalendarDirectEditIdleTimer();
}

function bindCalendarDirectEditInactivityWatcher() {
    if (calendarDirectEditInactivityBound) return;

    calendarDirectEditInactivityBound = true;

    [
        "pointerdown",
        "keydown",
        "wheel",
        "touchstart",
        "input"
    ].forEach(eventName => {
        window.addEventListener(
            eventName,
            noteCalendarDirectEditActivity,
            { capture: true, passive: true }
        );
    });

    const commitBeforeExit = () => {
        if (!calendarDirectEditEnabled) return;

        calendarDirectEditEnabled = false;
        clearCalendarDirectEditIdleTimer();
        syncCalendarDirectEditToggle();
        window.commitCalendarDirectEditPendingChanges?.();
        window.flushCalendarChangeEvents?.();
    };

    window.addEventListener("pagehide", commitBeforeExit);
    window.addEventListener("beforeunload", commitBeforeExit);
}

async function disableCalendarDirectEditMode(options = {}) {
    if (!calendarDirectEditEnabled) {
        syncCalendarDirectEditToggle();
        return false;
    }

    calendarDirectEditEnabled = false;
    clearCalendarDirectEditIdleTimer();
    syncCalendarDirectEditToggle();

    if (options.flush !== false) {
        await window.flushCalendarDirectEditRefresh?.({
            force: true,
            refresh: options.refresh !== false,
            reason: options.reason || "direct-edit-disabled"
        });
    }

    return true;
}

window.disableCalendarDirectEditMode = disableCalendarDirectEditMode;

function syncCalendarDirectEditToggle() {
    if (!DOM.calendarDirectEditToggle) return;

    const canEditCalendar = canEditTarget("calendarPanel");
    if (!canEditCalendar) {
        calendarDirectEditEnabled = false;
        clearCalendarDirectEditIdleTimer();
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

    bindCalendarDirectEditInactivityWatcher();
    syncCalendarDirectEditToggle();
    DOM.calendarDirectEditToggle.onchange = () => {
        calendarDirectEditEnabled =
            DOM.calendarDirectEditToggle.checked;
        syncCalendarDirectEditToggle();

        if (calendarDirectEditEnabled) {
            scheduleCalendarDirectEditIdleTimer();
        } else {
            clearCalendarDirectEditIdleTimer();
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

    // Búsqueda de trabajador en modal (lupa junto al nombre en Perfiles).
    const profileSearchModal =
        document.getElementById("profileSearchModal");
    const profileSearchBtn =
        document.getElementById("profileSearchBtn");
    const closeProfileSearch = () => {
        if (profileSearchModal) profileSearchModal.hidden = true;
    };
    if (profileSearchModal && profileSearchBtn) {
        profileSearchBtn.onclick = () => {
            profileSearchModal.hidden = false;
            renderProfiles();
            DOM.profileSearch?.focus();
        };
        profileSearchModal.addEventListener("click", event => {
            if (
                event.target === profileSearchModal ||
                event.target.closest('[data-action="close-profile-search"]')
            ) {
                closeProfileSearch();
            }
        });
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && !profileSearchModal.hidden) {
                closeProfileSearch();
            }
        });
    }

    DOM.profiles.onclick = event => {
        const action = event.target.closest("[data-action]");
        if (!action || !DOM.profiles.contains(action)) return;

        if (action.dataset.action === "select-profile") {
            void selectProfileByName(action.dataset.profileName);
            closeProfileSearch();
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

    // HHEE: buscar/cambiar trabajador en modal (lupa junto al nombre).
    const hheeSearchModal = document.getElementById("hheeSearchModal");
    if (hheeSearchModal) {
        document.addEventListener("click", event => {
            if (event.target.closest('[data-action="open-hhee-search"]')) {
                hheeSearchModal.hidden = false;
                renderHheeProfiles();
                DOM.hheeProfileSearch?.focus();
            }
        });
        hheeSearchModal.addEventListener("click", event => {
            if (
                event.target === hheeSearchModal ||
                event.target.closest('[data-action="close-hhee-search"]')
            ) {
                hheeSearchModal.hidden = true;
            }
        });
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && !hheeSearchModal.hidden) {
                hheeSearchModal.hidden = true;
            }
        });
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

    // Reportes: buscar/cambiar trabajador en modal (lupa junto al nombre).
    const reportsSearchModal =
        document.getElementById("reportsSearchModal");
    const closeReportsSearch = () => {
        if (reportsSearchModal) reportsSearchModal.hidden = true;
    };
    if (reportsSearchModal) {
        // La lupa se rerenderiza con el detalle (tabla o fallback): delegación.
        document.addEventListener("click", event => {
            if (event.target.closest('[data-action="open-reports-search"]')) {
                reportsSearchModal.hidden = false;
                void renderReportsProfiles();
                DOM.reportsProfileSearch?.focus();
            }
        });
        reportsSearchModal.addEventListener("click", event => {
            if (
                event.target === reportsSearchModal ||
                event.target.closest('[data-action="close-reports-search"]')
            ) {
                closeReportsSearch();
            }
        });
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && !reportsSearchModal.hidden) {
                closeReportsSearch();
            }
        });
    }
    if (DOM.reportsProfiles) {
        DOM.reportsProfiles.addEventListener("click", event => {
            if (event.target.closest(".profile-item")) closeReportsSearch();
        });
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

    // Marcajes: buscar/cambiar trabajador en modal (lupa junto al mes).
    const clockMarksSearchModal =
        document.getElementById("clockMarksSearchModal");
    if (clockMarksSearchModal) {
        document.addEventListener("click", event => {
            if (event.target.closest('[data-action="open-clockmarks-search"]')) {
                clockMarksSearchModal.hidden = false;
                renderClockMarksProfiles();
                DOM.clockMarksProfileSearch?.focus();
            }
        });
        clockMarksSearchModal.addEventListener("click", event => {
            if (
                event.target === clockMarksSearchModal ||
                event.target.closest('[data-action="close-clockmarks-search"]')
            ) {
                clockMarksSearchModal.hidden = true;
            }
        });
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && !clockMarksSearchModal.hidden) {
                clockMarksSearchModal.hidden = true;
            }
        });
    }

    if (DOM.topProfileSearchForm) {
        DOM.topProfileSearchForm.onsubmit = event => {
            event.preventDefault();
            void handleTopProfileSearch();
        };
    }

    if (DOM.topProfileSearchInput) {
        DOM.topProfileSearchInput.onchange = () => {
            void handleTopProfileSearch();
        };
        // Al enfocar se limpia para escribir directo; si se abandona sin elegir,
        // se restaura el trabajador actual.
        DOM.topProfileSearchInput.onfocus = () => {
            DOM.topProfileSearchInput.value = "";
        };
        DOM.topProfileSearchInput.onblur = () => {
            if (!DOM.topProfileSearchInput.value.trim()) {
                syncTopProfileSearch();
            }
        };
    }

    document
        .querySelectorAll(".nav-tile[data-target]")
        .forEach(button => {
            button.onclick = async () => {
                if (button.disabled || button.dataset.permissionLocked === "true") {
                    return;
                }

                const target = document.getElementById(
                    button.dataset.target
                );

                if (!target) return;

                const navigated = await setActiveShortcut(
                    button.dataset.target
                );

                if (!navigated) return;

                setMobileMenuOpen(false);

                // Cada menu se entra desde arriba: no siempre el tile apunta
                // al primer recuadro de su vista (ver getViewTopTarget).
                const inicio = document.getElementById(
                    getViewTopTarget(button.dataset.target)
                ) || target;

                inicio.scrollIntoView({
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
if (DOM.trainingBtn) {
    DOM.trainingBtn.onclick = activarSelectorCapacitacion;
}
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

document
    .querySelectorAll("[data-add-turn]")
    .forEach(button => {
        button.onclick = () => {
            activarModoAgregarTurno(button.dataset.addTurn);
        };
    });

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

// Dias corridos que ocupa un P. Administrativo aplicado desde el calendario.
// Avanza dia a dia sin saltar fines de semana, igual que aplicarAdministrativo:
// son las mismas claves que quedaron a la espera de cobertura.
function leaveBlockKeys(fecha, cantidad) {
    const keys = [];
    const cursor = new Date(fecha);
    const total = Math.max(1, Number(cantidad) || 1);

    for (let i = 0; i < total; i++) {
        keys.push(keyFromDate(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }

    return keys;
}

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

    if (selectionMode === "addturn") {
        await handleAddTurnSelection(fecha);
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

    if (selectionMode === "training") {
        await handleTrainingSelection(fecha);
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
        } else {
            // Se pregunta por el respaldo AQUI, recien aplicada la licencia: es
            // el momento en que el supervisor tiene el documento a mano. Si se
            // deja para despues, casi nunca se sube.
            await offerLeaveDocumentPrompt(fecha);
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
        const aplicado = await aplicarComp(fecha, compCantidad, {
            holdUntilCovered: true
        });

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
            await aplicarLegal(fecha, legalCantidad, {
                holdUntilCovered: true
            });

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

        const profile = getCurrentProfile();
        const cantidad = adminCantidad;
        const aplicado =
            await aplicarAdministrativo(fecha, cantidad, {
                holdUntilCovered: true
            });

        if (aplicado) {
            decrementManualBalance(
                "admin",
                cantidad,
                fecha.getFullYear()
            );
        }

        clearSelectionMode();

        if (aplicado) {
            // El permiso queda en espera hasta que se cubra uno de sus turnos
            // (js/leaveHold.js): las sugerencias se abren aqui mismo para que el
            // supervisor resuelva la cobertura sin tener que volver al dia.
            await openReplacementSuggestionsForLeaveBlock(
                profile,
                leaveBlockKeys(fecha, cantidad)
            );
        }

        return;
    }

});

window.addEventListener("proturnos:workerRequestsChanged", () => {
    if (document.body.dataset.activeView === "requests") {
        renderWorkerRequestsPanel();
    } else {
        refreshWorkerRequestsNavBadge();
        if (document.body.dataset.activeView === "home") {
            renderHomePanel();
        }
    }

    void updateVisibleCalendarDays({ updateSummary: true });

    // Una solicitud pendiente hace parpadear el dia tambien en el timeline. Su
    // cache ya se limpia por `persistenceChanged`, pero si el supervisor esta
    // parado en esa vista nadie le pedia repintar: la solicitud recien llegada
    // no aparecia hasta cambiar de mes o de menu.
    if (document.body.dataset.activeView === "timeline") {
        void renderTimeline({ skipCache: true });
    }
});

// Al modificar un marcaje (recuperación de horas / horas extra / reducción), el
// motor server-side debe recomputar clockMarkModifications para la PWA. El guardado
// local no dispara el rebuild, así que forzamos el flush del estado
// (clockMarks_<perfil>) antes del projectionRequest para que
// buildWorkerAppProjection vea el marcaje fresco.
// Subir una planilla del reloj cambia lo que ve el trabajador en su
// aplicacion, asi que hay que republicarselo. Solo a los que venian en el
// archivo: republicar la unidad entera por una planilla de tres personas es
// trabajo y escrituras de mas.
window.addEventListener("proturnos:attendanceMarksChanged", event => {
    const ruts = new Set(
        (event.detail?.ruts || []).map(rut => normalizeRut(rut)).filter(Boolean)
    );

    if (!ruts.size) return;

    const names = getProfiles()
        .filter(profile => ruts.has(normalizeRut(profile.rut)))
        .map(profile => profile.name);

    if (names.length) {
        // `stateKeys` es lo que hacia falta: el vaciado previo a pedir la
        // proyeccion solo cubria las claves POR PERFIL (`clockMarks_<nombre>`) y
        // un puñado de globales, y la planilla del reloj no es ninguna de esas
        // -escribe la global `attendanceMarks`-. La Cloud Function calculaba
        // entonces con las marcas viejas: al trabajador le llegaba la entrada y
        // no la salida, y solo se arreglaba si algo mas volvia a tocarlo.
        scheduleWorkerAppDataPublish(300, names, null, {
            requiresLocalStateFlush: true,
            stateKeys: ATTENDANCE_STATE_KEYS
        });
    }
});

window.addEventListener("proturnos:clockMarksChanged", event => {
    const profile = event.detail?.profile;

    if (profile) {
        scheduleWorkerAppDataPublish(300, profile, null, {
            requiresLocalStateFlush: true
        });
    }

    // El reporte usa el marcaje autorizado para medir el atraso y para decidir
    // si una salida temprana es incidencia. Si esta a la vista hay que
    // repintarlo; si no, ya se arma al entrar. Va aqui y no en el dialogo
    // porque asi cubre cualquier via que modifique un marcaje.
    if (document.body.dataset.activeView === "reports") {
        void renderReportsDetail();
    }
});

window.addEventListener("proturnos:replacementRequestsChanged", () => {
    if (document.body.dataset.activeView === "requests") {
        renderWorkerRequestsPanel();
    } else {
        refreshWorkerRequestsNavBadge();
    }

    void updateVisibleCalendarDays({ updateSummary: true });

    // Si alguien acepto, el turno quedo cubierto: el barrido cierra la campaña
    // y caduca lo que siguiera vivo en los otros telefonos sin esperar al
    // proximo tic del reloj.
    void runAutoCoverageCycle();
});

// La alerta del punto D: suena y deja el aviso a la vista aunque el supervisor
// este en otra pagina del app. El recuadro con el detalle lo pinta el inicio.
window.addEventListener("proturnos:autoCoverageAlert", event => {
    const campaign = event.detail?.campaign;

    if (!campaign) return;

    const msLeft = campaign.shiftStartAt
        ? new Date(campaign.shiftStartAt).getTime() - Date.now()
        : NaN;
    const left = formatCoverageTimeLeft(msLeft);

    fireHomeAlert(
        "Cobertura sin respuesta",
        `${campaign.turnoLabel || "Turno"} de ${campaign.replaced} el ${campaign.date}: nadie aceptó la cobertura automática${left ? `. Queda ${left}` : ""}.`
    );
});

// Una etapa que avanza o una campaña que se cierra cambia el recuadro de
// alerta y el estado del boton de la tarjeta de cobertura.
window.addEventListener("proturnos:autoCoverageChanged", () => {
    if (document.body.dataset.activeView === "home") {
        renderHomePanel();
    }
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

    // Refresca tambien las filas del timeline de quienes dejaron de cubrir: sin
    // esto su turno extra desaparecia pero el resumen de HH.EE quedaba con el
    // valor anterior (servido del resumen publicado) hasta cambiar de mes.
    const affectedReplacementWorkers = new Set(
        canceledReplacements
            .map(replacement => String(replacement?.worker || "").trim())
            .filter(Boolean)
    );
    affectedReplacementWorkers.forEach(worker => updateTimelineCells(worker));

    // Re-publica la proyeccion de los afectados. Sin esto, tras anular un permiso
    // (p.ej. a pedido del trabajador) el dia seguia PINTADO con el permiso en la
    // PWA aunque el calendario del supervisor ya lo habia quitado. Cubre al dueno
    // del permiso y a quienes se les anulo el reemplazo asociado.
    if (detail.profile) scheduleWorkerAppDataPublish(300, detail.profile);
    affectedReplacementWorkers.forEach(worker =>
        scheduleWorkerAppDataPublish(300, worker)
    );

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
                `Se anuló tu turno extra del ${date} (${turn}) porque se aplicó ${label}.`
            );

            if (
                replacement.replaced &&
                replacement.replaced !== replacement.worker
            ) {
                void notifyWorkerApp(
                    replacement.replaced,
                    `Se anuló la cobertura de ${replacement.worker} para el ${date} (${turn}) porque se aplicó ${label}.`
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
            `Tu supervisor anuló ${leaveLabel}. Revisa tu calendario actualizado en la app.`
        );
    }

    canceledReplacements.forEach(replacement => {
        if (!replacement?.worker) return;

        const date = replacement.date || "la fecha asignada";
        const turn = replacement.turno || "turno";
        const reason = isLeave && profile
            ? ` porque se anuló ${leaveLabel} de ${profile}`
            : "";

        void notifyWorkerApp(
            replacement.worker,
            `Se anuló tu turno extra del ${date} (${turn})${reason}.`
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

// El estado "Invitado" del boton de enlace sale de la cache de invitaciones
// pendientes: cuando cambia hay que repintar la ficha.
window.addEventListener("proturnos:workerInvitesChanged", () => {
    scheduleWorkspaceUiRefresh();
});

// Resolver un registro desde el panel de HH.EE (asignar respaldo, anular un
// turno extra) cambia esa misma lista: se repinta para que la fila refleje el
// nuevo estado sin salir de la pantalla.
window.addEventListener("proturnos:calendarProfilesChanged", () => {
    if (document.body.dataset.activeView !== "hours") return;

    void renderProfileHoursSummary(getPerfilActual());
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
        (active.tagName === "SELECT" ||
            active.tagName === "BUTTON" ||
            active.tagName === "TEXTAREA" ||
            active.isContentEditable)
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
            if (document.body.dataset.activeView === "medicalEquipment") {
                renderMedicalEquipmentPanel();
            }
            if (document.body.dataset.activeView === "qualifications") {
                renderQualificationsPanel();
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

registerSupervisorServiceWorker();

// "Actualizar": desregistra el service worker, limpia las caches y recarga para
// traer la ultima version desplegada (evita el cache viejo del SW). Al recargar,
// la app vuelve a bajar los turnos desde Firebase.
let appReloadInFlight = false;

async function reloadAppToLatestVersion(button = null) {
    if (appReloadInFlight) return;

    appReloadInFlight = true;

    if (button) {
        button.disabled = true;
        button.classList.add("is-spinning");
    }

    try {
        if (navigator.serviceWorker?.getRegistrations) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(
                regs.map(reg => reg.unregister().catch(() => {}))
            );
        }
    } catch (error) { /* sin SW: se ignora */ }

    try {
        if (window.caches?.keys) {
            const keys = await caches.keys();
            await Promise.all(
                keys.map(key => caches.delete(key).catch(() => {}))
            );
        }
    } catch (error) { /* sin Cache API: se ignora */ }

    window.location.reload();
}

const appReloadBtn = document.getElementById("appReloadBtn");
if (appReloadBtn) {
    appReloadBtn.onclick = () => reloadAppToLatestVersion(appReloadBtn);
}

// El logo hace lo mismo que el boton: es el gesto que la gente intenta primero
// cuando algo se ve desactualizado.
const appBrandReload = document.getElementById("appBrandReload");
if (appBrandReload) {
    appBrandReload.addEventListener("click", () => {
        appBrandReload.classList.add("is-reloading");
        void reloadAppToLatestVersion();
    });
    appBrandReload.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;

        event.preventDefault();
        appBrandReload.classList.add("is-reloading");
        void reloadAppToLatestVersion();
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
            stopSupervisorInviteRequestsListener();
            stopMedicalEquipmentReportSync();
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
            // Y las invitaciones pendientes, que alimentan el estado "Invitado".
            void refreshPendingWorkerInvites(workspace);

            await startWorkspacePermissionListener(workspace, () => {
                syncWorkspacePermissionUI();
                syncCalendarDirectEditToggle();
                renderDashboardState();
                void startSupervisorInviteRequestsListener(workspace);
                void startMedicalEquipmentReportSync(workspace, {
                    onChange: () => {
                        if (document.body.dataset.activeView === "medicalEquipment") {
                            renderMedicalEquipmentPanel();
                        }
                    }
                });

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
            // Publica en segundo plano el resumen RRHH del mes para el Dashboard.
            startRrhhSummaryBackgroundPublisher();

            // Tareas del home (por usuario) + alertas sonoras.
            startHomeTasksSync(workspace, () => {
                refreshHomeTasks();
            });
            startTaskAlertScheduler();
            // Campañas de cobertura automatica. Las etapas las hace avanzar la
            // Cloud Function advanceAutoCoverage; aca solo se escuchan los
            // cambios y se corre el barrido de cierre, que no calcula nada.
            void startFirebaseAutoCoverageSync(workspace, {
                onChange: () => {
                    if (document.body.dataset.activeView === "home") {
                        renderHomePanel();
                    }
                }
            });
            startAutoCoverageScheduler();
        } else {
            stopFirebaseReplacementRequestSync();
            stopFirebaseWorkerRequestSync();
            stopWorkerAppDataSync();
            stopWorkerAvailabilitySync();
            stopInterUnitLoanSync();
            stopSupervisorMessages();
            stopFirebaseAppStateSync();
            stopSupervisorInviteRequestsListener();
            stopMedicalEquipmentReportSync();
            stopWorkspacePermissionListener();
            stopHomeTasksSync();
            stopTaskAlertScheduler();
            stopAutoCoverageScheduler();
            stopFirebaseAutoCoverageSync();
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
        if (document.body.dataset.activeView === "medicalEquipment") {
            renderMedicalEquipmentPanel();
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
initInformationsPanel();
initMedicalEquipmentPanel();
initQualificationsPanel();
refreshWorkerRequestsNavBadge();
initNotificationsBell({
    onOpen: () => { void setActiveShortcut("workerRequestsPanel"); }
});
initPendingLeaveBlinkSync();
// Un modal no se cierra si el mouse se suelta sobre su fondo pero el arrastre
// empezo adentro (seleccionar texto en un campo, por ejemplo).
installModalBackdropGuard();
renderProfiles({ dashboard: false });
renderBotones();
bindAppNavigationHistory();

const hasProfilesAtStartup = getProfiles().length > 0;
const startupTarget = hasProfilesAtStartup
    ? targetFromHash() || "homePanel"
    : "profileSection";

void setActiveShortcut(startupTarget, { historyMode: "replace" });
