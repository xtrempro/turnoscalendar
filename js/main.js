import { keyFromDate, toISODate, keyToDate as parseKey, parseISODate as parseInputDate } from "./dateUtils.js";
import { normalizeText, stripAccents } from "./stringUtils.js";
import { escapeHTML } from "./htmlUtils.js";
import {
    prevMonth,
    nextMonth,
    currentDate,
    renderCalendar,
    goToCalendarMonth
} from "./calendar.js";
import {
    pushHistory,
    undo,
    redo,
    canUndo,
    canRedo
} from "./history.js";
import { refreshAll } from "./refresh.js";
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
import { initFirebaseShell } from "./firebaseShell.js";
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
import { renderTimeline } from "./timeline.js";
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
import { renderReplacementLogHTML } from "./replacements.js";
import {
    refreshWorkerRequestsNavBadge,
    renderWorkerRequestsPanel,
    startWorkerRequestsRealtimeSync,
    stopWorkerRequestsRealtimeSync
} from "./workerRequests.js";
import {
    openWorkerAppInviteDialog,
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
    canEditTarget,
    canViewTarget,
    firstViewableTarget,
    loadWorkspacePermissions,
    startWorkspacePermissionListener,
    stopWorkspacePermissionListener
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
    saveHourReturn
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

const PROFILE_MODE = {
    VIEW: "view",
    CREATE: "create",
    EDIT: "edit"
};

const THEME_KEY = "proturnos_theme";
const PROFILE_BIRTH_DATE_DEFAULT = "2000-01-01";

let selectionMode = null;
let pendingRotationChange = null;
let adminCantidad = 0;
let compCantidad = 0;
let legalCantidad = 0;
let licenseCantidad = 0;
let licenseType = "license";
let availabilityEditMode = false;
let profileRotationMiniDate = new Date();
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

const PROFESSION_LABELS = {
    [SIN_INFORMACION_PROFESSION]: "Sin informaci\u00f3n"
};

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

function profileUsesProfession(profile = {}) {
    return (
        profile.estamento === "Profesional" ||
        profile.estamento === "T\u00e9cnico"
    );
}

function formatProfession(value) {
    const clean = value || SIN_INFORMACION_PROFESSION;

    return PROFESSION_LABELS[clean] || clean;
}

function professionOptionElement(value) {
    const option = document.createElement("option");

    option.value = value;
    option.textContent = formatProfession(value);

    return option;
}

function replaceProfessionOptions(element, options = []) {
    if (!element) return;

    element.replaceChildren(
        ...options.map(professionOptionElement)
    );
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

const profileDraft = {
    mode: PROFILE_MODE.VIEW,
    originalName: "",
    originalRotationType: "",
    originalRotationStart: "",
    originalRotationFirstTurn: "larga",
    originalContractType: "",
    originalEstamento: "",
    originalGrade: "",
    name: "",
    email: "",
    rut: "",
    phone: "",
    birthDate: "",
    docs: [],
    active: true,
    unit: "",
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
    honorariaStart: "",
    honorariaEnd: "",
    honorariaHourlyRate: "",
    honorariaMaxMonthlyHours: "",
    unionLeaveEnabled: false,
    shiftAssigned: false
};

function isReplacementDraft(data = profileDraft) {
    return isReplacementContractType(data.contractType);
}

function isHonorariaDraft(data = profileDraft) {
    return isHonorariaContractType(data.contractType);
}

window.selectionMode = null;
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

function toInputDate(date){
    return toISODate(date);
}

function toMonthInputValue(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0")
    ].join("-");
}

function parseMonthInputValue(value) {
    const parts = String(value || "").split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]) - 1;

    if (!year || month < 0) return null;

    return new Date(year, month, 1);
}

function normalizeStoredStart(start){
    if (!start) return "";

    if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
        return start;
    }

    const date = new Date(start);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return toInputDate(date);
}

function inputDateToCalendarKey(value){
    if (!value) return "";

    const parts = value.split("-");

    if (parts.length !== 3) return "";

    return `${parts[0]}-${Number(parts[1]) - 1}-${Number(parts[2])}`;
}

function calendarKeyToInputDate(key){
    if (!key) return "";

    return toInputDate(parseKey(key));
}

function compareISODate(a, b) {
    return String(a || "").localeCompare(String(b || ""));
}

function isDateKeyOnOrAfter(key, startDate) {
    const date = parseKey(key);

    if (Number.isNaN(date.getTime())) return false;

    return date >= startDate;
}

function formatDisplayDate(value){
    if (!value) return "";

    const parts = value.split("-");

    if (parts.length !== 3) return value;

    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

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

function formatSaldo(value) {
    const rounded =
        Math.round((Number(value) || 0) * 100) / 100;

    return Number.isInteger(rounded)
        ? String(rounded)
        : String(rounded).replace(".", ",");
}

function formatMonthHeading(date) {
    return date.toLocaleString(
        "es-CL",
        {
            month: "long",
            year: "numeric"
        }
    ).toUpperCase();
}

function normalizeBalanceValue(value) {
    const numeric = Number(
        String(value ?? "").replace(",", ".")
    );

    if (!Number.isFinite(numeric)) return 0;

    return Math.max(0, Math.round(numeric * 100) / 100);
}

function withManualBalance(
    manualValue,
    fallbackValue
) {
    const numeric = Number(manualValue);

    return Number.isFinite(numeric)
        ? Math.max(0, numeric)
        : fallbackValue;
}

function monthSerial(year, month) {
    return Number(year) * 12 + Number(month);
}

function nextMonthPeriod(year, month) {
    const date = new Date(
        Number(year),
        Number(month) + 1,
        1
    );

    return {
        year: date.getFullYear(),
        month: date.getMonth()
    };
}

function hheeReturnEffectivePeriod(record = {}) {
    const effectiveYear = Number(record.effectiveYear);
    const effectiveMonth = Number(record.effectiveMonth);

    if (
        Number.isFinite(effectiveYear) &&
        Number.isFinite(effectiveMonth)
    ) {
        return {
            year: effectiveYear,
            month: effectiveMonth
        };
    }

    return nextMonthPeriod(record.year, record.month);
}

function hasStoredHheeReturnEffectivePeriod(record = {}) {
    return (
        Number.isFinite(Number(record.effectiveYear)) &&
        Number.isFinite(Number(record.effectiveMonth))
    );
}

function futureHheeReturnTransferHours(
    profileName,
    year,
    month
) {
    if (
        !profileName ||
        !Number.isFinite(Number(year)) ||
        !Number.isFinite(Number(month))
    ) {
        return 0;
    }

    const targetSerial = monthSerial(year, month);

    return Object.values(getHheeReturnTransfers(profileName))
        .filter(record => record?.enabled)
        .reduce((sum, record) => {
            const effective =
                hheeReturnEffectivePeriod(record);

            const appliesToYear =
                Number(effective.year) === Number(year) ||
                (
                    !hasStoredHheeReturnEffectivePeriod(record) &&
                    Number(record.year) === Number(year)
                );

            if (
                !appliesToYear ||
                monthSerial(effective.year, effective.month) <=
                    targetSerial
            ) {
                return sum;
            }

            return sum +
                normalizeBalanceValue(record.transferredHours);
        }, 0);
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
        legal: withManualBalance(manual.legal, calculated.legal),
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

function sanitizeDigits(value, maxLength = Infinity) {
    return String(value || "")
        .replace(/\D/g, "")
        .slice(0, maxLength);
}

function formatRut(value) {
    const raw = String(value || "")
        .replace(/[^0-9kK]/g, "")
        .toUpperCase();

    if (raw.length <= 1) return raw;

    const body = raw.slice(0, -1);
    const verifier = raw.slice(-1);
    const dotted = body
        .split("")
        .reverse()
        .join("")
        .match(/.{1,3}/g)
        .join(".")
        .split("")
        .reverse()
        .join("");

    return `${dotted}-${verifier}`;
}

function cleanRutForValidation(value) {
    return String(value || "")
        .replace(/\./g, "")
        .replace(/\s+/g, "")
        .toUpperCase();
}

function validarRut(rutCompleto) {
    const cleaned = cleanRutForValidation(rutCompleto);

    if (!/^[0-9]+-[0-9K]{1}$/.test(cleaned)) return false;

    const [rut, dv] = cleaned.split("-");
    let suma = 0;
    let multiplo = 2;

    for (let i = rut.length - 1; i >= 0; i--) {
        suma += Number(rut.charAt(i)) * multiplo;
        multiplo = multiplo < 7 ? multiplo + 1 : 2;
    }

    let dvEsperado = 11 - (suma % 11);
    dvEsperado =
        dvEsperado === 11
            ? "0"
            : dvEsperado === 10
                ? "K"
                : String(dvEsperado);

    return dv === dvEsperado;
}

function getRutValidationMessage(value) {
    const rut = String(value || "").trim();

    if (!rut) return "";
    if (validarRut(rut)) return "";

    return "El RUT ingresado no es valido. Revisa el numero y el digito verificador.";
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

function normalizeAttachmentFiles(files) {
    return Array.from(files || []).map(file => ({
        id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name: file.name,
        type: file.type || "",
        size: file.size || 0,
        addedAt: new Date().toISOString()
    }));
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

async function readAttachmentFiles(files) {
    const list = Array.from(files || []);
    const attachments = [];

    for (const file of list) {
        attachments.push({
            ...normalizeAttachmentFiles([file])[0],
            dataUrl: await readFileAsDataURL(file)
        });
    }

    return attachments;
}

function dataUrlToBlob(dataUrl) {
    const [header, data] = String(dataUrl || "").split(",");
    const mimeMatch = header.match(/data:([^;]+);base64/);
    const mime = mimeMatch?.[1] || "application/octet-stream";
    const binary = atob(data || "");
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return new Blob([bytes], { type: mime });
}

function openAttachment(doc) {
    if (!doc?.dataUrl) {
        alert(
            "Este adjunto se registro antes de guardar el contenido del archivo. Debes quitarlo y volver a adjuntarlo para poder visualizarlo."
        );
        return;
    }

    const url = URL.createObjectURL(dataUrlToBlob(doc.dataUrl));
    const opened = window.open(url, "_blank", "noopener");

    if (!opened) {
        alert("El navegador bloqueo la ventana emergente. Permite pop-ups para visualizar el documento.");
    }

    setTimeout(() => URL.revokeObjectURL(url), 60000);
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

function getRecordYear(entry) {
    const source = entry.date || entry.start || "";

    return source ? String(source).slice(0, 4) : "";
}

function renderAttachmentName(entry) {
    return entry?.file?.name
        ? `<small>Clip: ${escapeHTML(entry.file.name)}</small>`
        : "";
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

function getRotativaLabel(type){
    if (type === "3turno") return "3er Turno";
    if (type === "4turno") return "4° Turno";
    if (type === "diurno") return "Diurno";
    if (type === "libre") return "Libre";
    if (type === "reemplazo") return "Reemplazo";
    return "Sin rotativa";
}

function requiresRotationFirstTurn(type) {
    return type === "3turno" || type === "4turno";
}

function requiresRotationStart(type) {
    return Boolean(type) && type !== "libre";
}

function getRotationStartOptions(type) {
    if (type === "3turno") {
        return [
            {
                value: "larga",
                label: "Iniciar con primer Largo",
                summary: "primer Largo",
                detail: "Iniciar con el primer turno Largo"
            },
            {
                value: "larga2",
                label: "Iniciar con segundo Largo",
                summary: "segundo Largo",
                detail: "Iniciar con el segundo turno Largo"
            },
            {
                value: "noche",
                label: "Iniciar con primera Noche",
                summary: "primera Noche",
                detail: "Iniciar con la primera Noche"
            },
            {
                value: "noche2",
                label: "Iniciar con segunda Noche",
                summary: "segunda Noche",
                detail: "Iniciar con la segunda Noche"
            },
            {
                value: "libre1",
                label: "Iniciar con primer Libre",
                summary: "primer Libre",
                detail: "Iniciar con el primer Libre"
            },
            {
                value: "libre2",
                label: "Iniciar con segundo Libre",
                summary: "segundo Libre",
                detail: "Iniciar con el segundo Libre"
            }
        ];
    }

    if (type === "4turno") {
        return [
            {
                value: "larga",
                label: "Iniciar con Largo",
                summary: "Largo",
                detail: "Iniciar con turno Largo"
            },
            {
                value: "noche",
                label: "Iniciar con Noche",
                summary: "Noche",
                detail: "Iniciar con turno Noche"
            },
            {
                value: "libre1",
                label: "Iniciar con primer Libre",
                summary: "primer Libre",
                detail: "Iniciar con el primer Libre"
            },
            {
                value: "libre2",
                label: "Iniciar con segundo Libre",
                summary: "segundo Libre",
                detail: "Iniciar con el segundo Libre"
            }
        ];
    }

    return [];
}

function supportsLibreRotation(data = profileDraft) {
    return isReplacementDraft(data) || isHonorariaDraft(data);
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

function normalizeRotationFirstTurn(value) {
    const normalized = stripAccents(String(value || "")).toLowerCase();

    if (
        normalized === "larga2" ||
        normalized === "largo2" ||
        normalized === "segunda larga" ||
        normalized === "segundo largo" ||
        normalized === "2 larga" ||
        normalized === "2 largo"
    ) {
        return "larga2";
    }

    if (
        normalized === "noche2" ||
        normalized === "segunda noche" ||
        normalized === "2 noche"
    ) {
        return "noche2";
    }

    if (
        normalized === "libre2" ||
        normalized === "segundo libre" ||
        normalized === "segunda libre" ||
        normalized === "2 libre"
    ) {
        return "libre2";
    }

    if (
        normalized === "libre" ||
        normalized === "libre1" ||
        normalized === "primer libre" ||
        normalized === "primera libre" ||
        normalized === "1 libre"
    ) {
        return "libre1";
    }

    return normalized === "noche"
        ? "noche"
        : "larga";
}

function normalizeRotationFirstTurnForType(type, value) {
    const normalized = normalizeRotationFirstTurn(value);
    const options = getRotationStartOptions(type);

    if (!options.length) return normalized;

    return options.some(option => option.value === normalized)
        ? normalized
        : options[0].value;
}

function getRotationFirstTurnLabel(value, type = "") {
    const normalized = normalizeRotationFirstTurnForType(type, value);
    const option = getRotationStartOptions(type)
        .find(item => item.value === normalized);

    if (option) return option.summary || option.label;

    if (normalized === "larga2") return "segundo Largo";
    if (normalized === "noche") return "primera Noche";
    if (normalized === "noche2") return "segunda Noche";
    if (normalized === "libre1") return "primer Libre";
    if (normalized === "libre2") return "segundo Libre";

    return "primer Largo";
}

function rotateRotationSequence(sequence, startIndex) {
    return [
        ...sequence.slice(startIndex),
        ...sequence.slice(0, startIndex)
    ];
}

function rotationStartIndex(type, firstTurn = "larga") {
    const normalized =
        normalizeRotationFirstTurnForType(type, firstTurn);

    if (type === "3turno") {
        if (normalized === "larga2") return 1;
        if (normalized === "noche") return 2;
        if (normalized === "noche2") return 3;
        if (normalized === "libre1") return 4;
        if (normalized === "libre2") return 5;

        return 0;
    }

    if (type === "4turno") {
        if (normalized === "noche") return 1;
        if (normalized === "libre1") return 2;
        if (normalized === "libre2") return 3;

        return 0;
    }

    return 0;
}

function getRotationSequence(type, firstTurn = "larga") {
    if (type === "3turno") {
        return rotateRotationSequence(
            [1, 1, 2, 2, 0, 0],
            rotationStartIndex(type, firstTurn)
        );
    }

    if (type === "4turno") {
        return rotateRotationSequence(
            [1, 2, 0, 0],
            rotationStartIndex(type, firstTurn)
        );
    }

    return [];
}

function activeLabel(value) {
    return value ? "activo" : "desactivado";
}

function yesNoLabel(value) {
    return value ? "si" : "no";
}

function auditProfileSnapshot(profileName) {
    const profile = getProfiles().find(
        item => item.name === profileName
    );

    if (!profile) return null;

    return {
        ...profile,
        shiftAssigned: getShiftAssigned(profileName),
        rotativa: getRotativa(profileName)
    };
}

function describeProfileChanges(before, after) {
    if (!before) return "Ficha inicial creada.";

    const changes = [];
    const fields = [
        ["name", "nombre"],
        ["email", "correo"],
        ["rut", "RUT"],
        ["phone", "celular"],
        ["birthDate", "fecha de nacimiento"],
        ["unitEntryDate", "fecha de ingreso"],
        ["contractType", "tipo de contrato"],
        ["honorariaStart", "inicio contrato honorarios"],
        ["honorariaEnd", "termino contrato honorarios"],
        ["honorariaHourlyRate", "valor hora honorarios"],
        ["honorariaMaxMonthlyHours", "maximo mensual honorarios"],
        ["estamento", "estamento"],
        ["profession", "profesion"],
        ["unionLeaveEnabled", "permiso gremial"],
        ["grade", "grado"]
    ];

    fields.forEach(([key, label]) => {
        if (String(before[key] || "") !== String(after[key] || "")) {
            changes.push(label);
        }
    });

    if (Boolean(before.shiftAssigned) !== Boolean(after.shiftAssigned)) {
        changes.push("asignacion de turno");
    }

    if (
        String(before.rotativa?.type || "") !== String(after.rotativa?.type || "") ||
        String(before.rotativa?.start || "") !== String(after.rotativa?.start || "") ||
        normalizeRotationFirstTurn(before.rotativa?.firstTurn) !==
            normalizeRotationFirstTurn(after.rotativa?.firstTurn)
    ) {
        changes.push("rotativa actual");
    }

    if ((before.docs?.length || 0) !== (after.docs?.length || 0)) {
        changes.push("documentos adjuntos");
    }

    if (before.active !== after.active) {
        changes.push("estado del perfil");
    }

    return changes.length
        ? `Campos modificados: ${changes.join(", ")}.`
        : "Se guardo la ficha sin cambios detectados.";
}

function isProfileEditing(){
    return profileDraft.mode !== PROFILE_MODE.VIEW;
}

function getPerfilActual() {
    const current = getCurrentProfile();
    return getProfiles().find(
        profile => profile.name === current
    ) || null;
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

function clearDraftValues(){
    profileDraft.originalName = "";
    profileDraft.originalRotationType = "";
    profileDraft.originalRotationStart = "";
    profileDraft.originalRotationFirstTurn = "larga";
    profileDraft.originalContractType = "";
    profileDraft.originalEstamento = "";
    profileDraft.originalGrade = "";
    profileDraft.name = "";
    profileDraft.email = "";
    profileDraft.rut = "";
    profileDraft.phone = "";
    profileDraft.birthDate = PROFILE_BIRTH_DATE_DEFAULT;
    profileDraft.docs = [];
    profileDraft.active = true;
    profileDraft.unit = "";
    profileDraft.unitEntryDate = "";
    profileDraft.contractType = "";
    profileDraft.estamento = "";
    profileDraft.profession = "Sin informacion";
    profileDraft.grade = "";
    profileDraft.rotationType = "";
    profileDraft.rotationStart = "";
    profileDraft.rotationFirstTurn = "larga";
    profileDraft.contractStart = "";
    profileDraft.contractEnd = "";
    profileDraft.contractReplaces = "";
    profileDraft.contractReason = "";
    profileDraft.honorariaStart = "";
    profileDraft.honorariaEnd = "";
    profileDraft.honorariaHourlyRate = "";
    profileDraft.honorariaMaxMonthlyHours = "";
    profileDraft.unionLeaveEnabled = false;
    profileDraft.shiftAssigned = false;
}

function loadDraftFromProfile(profile){
    const rotativa = getRotativa(profile.name);
    const legacyReplacement =
        rotativa.type === "reemplazo";
    const rotationStart =
        normalizeStoredStart(rotativa.start);

    profileDraft.originalName = profile.name;
    profileDraft.originalRotationType =
        rotativa.type || "";
    profileDraft.originalRotationStart =
        rotationStart;
    profileDraft.originalRotationFirstTurn =
        normalizeRotationFirstTurn(rotativa.firstTurn);
    profileDraft.originalContractType = profile.contractType || "";
    profileDraft.originalEstamento = profile.estamento || "";
    profileDraft.originalGrade = String(profile.grade || "");
    profileDraft.name = profile.name;
    profileDraft.email = profile.email || "";
    profileDraft.rut = profile.rut || "";
    profileDraft.phone = profile.phone || "";
    profileDraft.birthDate = profile.birthDate || "";
    profileDraft.docs = Array.isArray(profile.docs)
        ? [...profile.docs]
        : [];
    profileDraft.active = isProfileActive(profile);
    profileDraft.unit = "";
    profileDraft.unitEntryDate = profile.unitEntryDate || "";
    profileDraft.contractType = legacyReplacement
        ? "Reemplazo"
        : profile.contractType || "";
    profileDraft.estamento = profile.estamento || "";
    profileDraft.unionLeaveEnabled =
        Boolean(profile.unionLeaveEnabled);
    profileDraft.profession = normalizeProfession(
        profile.profession,
        profileDraft.estamento
    );
    profileDraft.grade = String(profile.grade || "");
    profileDraft.rotationType = legacyReplacement
        ? ""
        : rotativa.type || "";
    profileDraft.rotationStart = legacyReplacement
        ? ""
        : rotationStart;
    profileDraft.rotationFirstTurn =
        normalizeRotationFirstTurn(rotativa.firstTurn);
    profileDraft.honorariaStart = profile.honorariaStart || "";
    profileDraft.honorariaEnd = profile.honorariaEnd || "";
    profileDraft.honorariaHourlyRate =
        String(profile.honorariaHourlyRate || "");
    profileDraft.honorariaMaxMonthlyHours =
        String(profile.honorariaMaxMonthlyHours || "");
    profileDraft.shiftAssigned = getShiftAssigned(profile.name);
}

function hasRotationChanged() {
    if (profileDraft.mode !== PROFILE_MODE.EDIT) {
        return false;
    }

    return (
        profileDraft.rotationType !==
            profileDraft.originalRotationType ||
        normalizeStoredStart(profileDraft.rotationStart) !==
            normalizeStoredStart(
                profileDraft.originalRotationStart
            ) ||
        (
            requiresRotationFirstTurn(profileDraft.rotationType) &&
            normalizeRotationFirstTurn(profileDraft.rotationFirstTurn) !==
                normalizeRotationFirstTurn(
                    profileDraft.originalRotationFirstTurn
                )
        )
    );
}

function getDraftUnitEntryDate() {
    return normalizeStoredStart(profileDraft.unitEntryDate || "");
}

function isBeforeDraftUnitEntryDate(value) {
    const unitEntryDate = getDraftUnitEntryDate();

    return Boolean(
        value &&
        unitEntryDate &&
        compareISODate(value, unitEntryDate) < 0
    );
}

function rotationStartBeforeUnitEntryMessage(
    value,
    unitEntryDate = getDraftUnitEntryDate()
) {
    return `La rotativa no puede comenzar el ${formatDisplayDate(value)} porque la fecha de ingreso a la unidad es ${formatDisplayDate(unitEntryDate)}.`;
}

function shouldRequireUnitEntryForRotation() {
    return Boolean(
        !isReplacementDraft() &&
        requiresRotationStart(profileDraft.rotationType) &&
        (
            profileDraft.mode === PROFILE_MODE.CREATE ||
            hasRotationChanged()
        )
    );
}

function isFirstProfileRotationConfig(type = profileDraft.rotationType) {
    if (profileDraft.mode === PROFILE_MODE.CREATE) {
        return true;
    }

    if (profileDraft.mode !== PROFILE_MODE.EDIT) {
        return !profileDraft.rotationStart;
    }

    return (
        !profileDraft.originalRotationType ||
        (
            requiresRotationStart(profileDraft.originalRotationType) &&
            !profileDraft.originalRotationStart
        )
    );
}

function getRotationConfigDefaultStart(type = profileDraft.rotationType) {
    if (!requiresRotationStart(type)) {
        return "";
    }

    const unitEntryDate = getDraftUnitEntryDate();
    const candidate = isFirstProfileRotationConfig(type)
        ? unitEntryDate
        : toInputDate(new Date());

    if (
        unitEntryDate &&
        candidate &&
        compareISODate(candidate, unitEntryDate) < 0
    ) {
        return unitEntryDate;
    }

    return candidate;
}

function hasGradeValueChanged() {
    if (profileDraft.mode !== PROFILE_MODE.EDIT) {
        return false;
    }

    return (
        String(profileDraft.grade || "") !==
            String(profileDraft.originalGrade || "") ||
        String(profileDraft.estamento || "") !==
            String(profileDraft.originalEstamento || "")
    );
}

function getDisplayedProfileData(){
    const profile = getPerfilActual();

    if (profileDraft.mode === PROFILE_MODE.CREATE) {
        return {
            name: profileDraft.name,
            email: profileDraft.email,
            rut: profileDraft.rut,
            phone: profileDraft.phone,
            birthDate: profileDraft.birthDate,
            docs: profileDraft.docs,
            active: profileDraft.active,
            unitEntryDate: profileDraft.unitEntryDate,
            contractType: profileDraft.contractType,
            estamento: profileDraft.estamento,
            profession: profileDraft.profession,
            grade: profileDraft.grade,
            rotationType: profileDraft.rotationType,
            rotationStart: profileDraft.rotationStart,
            rotationFirstTurn: profileDraft.rotationFirstTurn,
            contractStart: profileDraft.contractStart,
            contractEnd: profileDraft.contractEnd,
            contractReplaces: profileDraft.contractReplaces,
            contractReason: profileDraft.contractReason,
            honorariaStart: profileDraft.honorariaStart,
            honorariaEnd: profileDraft.honorariaEnd,
            honorariaHourlyRate: profileDraft.honorariaHourlyRate,
            honorariaMaxMonthlyHours: profileDraft.honorariaMaxMonthlyHours,
            unionLeaveEnabled: profileDraft.unionLeaveEnabled,
            shiftAssigned: profileDraft.shiftAssigned
        };
    }

    if (profileDraft.mode === PROFILE_MODE.EDIT) {
        return {
            name: profileDraft.name,
            email: profileDraft.email,
            rut: profileDraft.rut,
            phone: profileDraft.phone,
            birthDate: profileDraft.birthDate,
            docs: profileDraft.docs,
            active: profileDraft.active,
            unitEntryDate: profileDraft.unitEntryDate,
            contractType: profileDraft.contractType,
            estamento: profileDraft.estamento,
            profession: profileDraft.profession,
            grade: profileDraft.grade,
            rotationType: profileDraft.rotationType,
            rotationStart: profileDraft.rotationStart,
            rotationFirstTurn: profileDraft.rotationFirstTurn,
            contractStart: profileDraft.contractStart,
            contractEnd: profileDraft.contractEnd,
            contractReplaces: profileDraft.contractReplaces,
            contractReason: profileDraft.contractReason,
            honorariaStart: profileDraft.honorariaStart,
            honorariaEnd: profileDraft.honorariaEnd,
            honorariaHourlyRate: profileDraft.honorariaHourlyRate,
            honorariaMaxMonthlyHours: profileDraft.honorariaMaxMonthlyHours,
            unionLeaveEnabled: profileDraft.unionLeaveEnabled,
            shiftAssigned: profileDraft.shiftAssigned
        };
    }

    if (!profile) {
        return {
            name: "",
            email: "",
            rut: "",
            phone: "",
            birthDate: "",
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
            honorariaStart: "",
            honorariaEnd: "",
            honorariaHourlyRate: "",
            honorariaMaxMonthlyHours: "",
            unionLeaveEnabled: false,
            shiftAssigned: false
        };
    }

    const rotativa = getRotativa(profile.name);
    const legacyReplacement =
        rotativa.type === "reemplazo";

    return {
        name: profile.name,
        email: profile.email || "",
        rut: profile.rut || "",
        phone: profile.phone || "",
        birthDate: profile.birthDate || "",
        docs: Array.isArray(profile.docs) ? profile.docs : [],
        active: isProfileActive(profile),
        unitEntryDate: profile.unitEntryDate || "",
        contractType: legacyReplacement
            ? "Reemplazo"
            : profile.contractType || "",
        estamento: profile.estamento,
        profession: profile.profession || "Sin informacion",
        grade: String(profile.grade || ""),
        rotationType: legacyReplacement
            ? ""
            : rotativa.type || "",
        rotationStart: legacyReplacement
            ? ""
            : normalizeStoredStart(rotativa.start),
        rotationFirstTurn: normalizeRotationFirstTurn(rotativa.firstTurn),
        contractStart: "",
        contractEnd: "",
        contractReplaces: "",
        contractReason: "",
        honorariaStart: profile.honorariaStart || "",
        honorariaEnd: profile.honorariaEnd || "",
        honorariaHourlyRate: String(profile.honorariaHourlyRate || ""),
        honorariaMaxMonthlyHours: String(profile.honorariaMaxMonthlyHours || ""),
        unionLeaveEnabled: Boolean(profile.unionLeaveEnabled),
        shiftAssigned: getShiftAssigned(profile.name)
    };
}

function formatRotationStartSummary(data, prefix = "") {
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

function buildRotationStatus(data){
    if (isReplacementDraft(data)) {
        const freeRotation = data.rotationType === "libre";

        if (profileDraft.mode === PROFILE_MODE.VIEW) {
            const profile = getPerfilActual();
            const contracts = profile
                ? getContractsForProfile(profile.name)
                : [];

            if (!contracts.length) {
                return "Contrato Reemplazo sin periodos registrados.";
            }

            return freeRotation
                ? `Contrato Reemplazo con ${contracts.length} periodo(s) registrado(s). Rotativa Libre: calendario disponible para carga manual.`
                : `Contrato Reemplazo con ${contracts.length} periodo(s) registrado(s). La rotativa se hereda del trabajador reemplazado.`;
        }

        if (!data.contractStart) {
            return "Presione el botón para ingresar un nuevo contrato de reemplazo.";
        }

        if (!data.contractEnd) {
            return `Inicio de contrato: ${formatDisplayDate(data.contractStart)}. Falta definir termino en el modal.`;
        }

        return `Contrato de reemplazo: ${formatDisplayDate(data.contractStart)} al ${formatDisplayDate(data.contractEnd)}${data.contractReason ? ` | Motivo: ${data.contractReason}` : ""}.${freeRotation ? " Rotativa Libre: calendario disponible para carga manual." : ""}`;
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

function buildEditorHint(profile){
    if (profileDraft.mode === PROFILE_MODE.CREATE) {
        if (isReplacementDraft()) {
            return "Completa nombre, estamento, periodo de contrato y a quien reemplaza antes de guardar.";
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

function renderProfileRotationStatus(data, editing) {
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
            openRotationConfigModal(
                replacementContract
                    ? "reemplazo"
                    : data.rotationType
            );
        });
}

function formatHistoryDateTime(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value || "";
    }

    return date.toLocaleString("es-CL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function formatHistoryValue(field, value) {
    if (field === "profession") {
        return formatProfession(value);
    }

    if (field === "rotation") {
        return formatRotationValue(value);
    }

    if (field === "grade") {
        return value ? `Grado ${value}` : "Sin grado";
    }

    if (field === "contractType") {
        return value || "Sin contrato";
    }

    if (field === "estamento") {
        return value || "Sin estamento";
    }

    return value || "Sin dato";
}

function formatRotationValue(rotativa = {}) {
    const type = rotativa?.type || "";
    const start = normalizeStoredStart(rotativa?.start || "");
    const firstTurn =
        normalizeRotationFirstTurnForType(
            type,
            rotativa?.firstTurn
        );
    const startText = start
        ? ` desde ${formatDisplayDate(start)}`
        : "";
    const firstTurnText =
        requiresRotationFirstTurn(type) && start
            ? `, inicia con ${getRotationFirstTurnLabel(firstTurn, type)}`
            : "";

    return `${getRotativaLabel(type)}${startText}${firstTurnText}`;
}

function contractHistoryChanges(
    previousSnapshot,
    nextSnapshot,
    gradeEffectiveDate
) {
    if (!previousSnapshot || !nextSnapshot) return [];

    const fieldConfig = [
        {
            key: "contractType",
            label: "Tipo de contrato",
            effectiveDate: gradeEffectiveDate
        },
        {
            key: "estamento",
            label: "Estamento",
            effectiveDate: gradeEffectiveDate
        },
        {
            key: "profession",
            label: "Profesi\u00f3n"
        },
        {
            key: "grade",
            label: "Grado",
            effectiveDate: gradeEffectiveDate
        }
    ];

    const changes = fieldConfig
        .filter(config =>
            String(previousSnapshot[config.key] || "") !==
            String(nextSnapshot[config.key] || "")
        )
        .map(config => ({
            field: config.key,
            label: config.label,
            from: formatHistoryValue(
                config.key,
                previousSnapshot[config.key]
            ),
            to: formatHistoryValue(
                config.key,
                nextSnapshot[config.key]
            ),
            effectiveDate: config.effectiveDate || ""
        }));

    const previousRotation = previousSnapshot.rotativa || {};
    const nextRotation = nextSnapshot.rotativa || {};
    const rotationChanged =
        String(previousRotation.type || "") !==
            String(nextRotation.type || "") ||
        normalizeStoredStart(previousRotation.start || "") !==
            normalizeStoredStart(nextRotation.start || "") ||
        normalizeRotationFirstTurn(previousRotation.firstTurn) !==
            normalizeRotationFirstTurn(nextRotation.firstTurn);

    if (rotationChanged) {
        changes.push({
            field: "rotation",
            label: "Rotativa",
            from: formatHistoryValue("rotation", previousRotation),
            to: formatHistoryValue("rotation", nextRotation),
            effectiveDate:
                normalizeStoredStart(nextRotation.start || "") || ""
        });
    }

    return changes;
}

function recordProfileContractHistory(
    profileName,
    previousSnapshot,
    nextSnapshot,
    gradeEffectiveDate
) {
    const changes = contractHistoryChanges(
        previousSnapshot,
        nextSnapshot,
        gradeEffectiveDate
    );

    if (!changes.length) return;

    addContractHistoryEntry(profileName, {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        effectiveDate:
            gradeEffectiveDate ||
            changes.find(change => change.effectiveDate)
                ?.effectiveDate ||
            "",
        summary: "Cambio de datos contractuales",
        changes
    });
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

function handleContractDatePick(key) {
    const selected = calendarKeyToInputDate(key);

    if (
        !profileDraft.contractStart ||
        (
            profileDraft.contractStart &&
            profileDraft.contractEnd
        ) ||
        compareISODate(selected, profileDraft.contractStart) < 0
    ) {
        profileDraft.contractStart = selected;
        profileDraft.contractEnd = "";
        renderDashboardState();
        return;
    }

    profileDraft.contractEnd = selected;
    renderDashboardState();
}

function getRotationModalMonth(type) {
    const defaultStart = getRotationConfigDefaultStart(type);
    const source =
        type === "reemplazo"
            ? profileDraft.contractStart ||
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
        contractReason: profileDraft.contractReason || ""
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
            if (
                !state.contractStart ||
                state.contractEnd ||
                compareISODate(selected, state.contractStart) < 0
            ) {
                state.contractStart = selected;
                state.contractEnd = "";
            } else {
                state.contractEnd = selected;
            }
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
    const save = () => {
        const targetField =
            backdrop.querySelector("[data-contract-replaces]");

        if (targetField) {
            state.contractReplaces = targetField.value;
        }

        const reasonField =
            backdrop.querySelector("[data-contract-reason]");

        if (reasonField) {
            state.contractReason = reasonField.value;
        }

        if (isReplacement) {
            if (!state.contractStart || !state.contractEnd) {
                alert("Debes seleccionar inicio y termino del contrato.");
                return;
            }

            if (!state.contractReplaces.trim()) {
                alert("Debes indicar a quien reemplaza.");
                targetField?.focus();
                return;
            }

            if (!state.contractReason) {
                alert("Debes seleccionar el motivo del reemplazo.");
                reasonField?.focus();
                return;
            }

            profileDraft.contractStart = state.contractStart;
            profileDraft.contractEnd = state.contractEnd;
            profileDraft.contractReplaces =
                state.contractReplaces.trim();
            profileDraft.contractReason =
                state.contractReason;
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
        }

        close();
        renderDashboardState();
    };
    const renderCalendar = () => {
        const y = state.monthDate.getFullYear();
        const m = state.monthDate.getMonth();
        const first = (new Date(y, m, 1).getDay() + 6) % 7;
        const days = new Date(y, m + 1, 0).getDate();
        const selectedKey = inputDateToCalendarKey(
            isReplacement
                ? state.contractStart
                : state.rotationStart
        );
        const contractEndKey =
            inputDateToCalendarKey(state.contractEnd);
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
            const stateTurn = getProfileRotationState(
                profile?.name,
                key
            );
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
            cell.className = "profile-mini-day is-pickable";
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
                    state.contractStart &&
                    state.contractEnd &&
                    iso >= state.contractStart &&
                    iso <= state.contractEnd
                ) {
                    cell.classList.add("is-contract-range");
                }
            }

            aplicarClaseTurno(cell, stateTurn);
            cell.innerHTML = `
                <span>${d}</span>
                <small>${
                    isReplacement
                        ? existingContract
                            ? "Vigente"
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
            ? "Selecciona inicio y termino del contrato. Si el periodo cruza de mes, usa las flechas para navegar."
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
                        <input data-contract-replaces type="text" list="rotationReplacementTargetOptions" value="${escapeHTML(state.contractReplaces)}" placeholder="Nombre del trabajador reemplazado">
                        <datalist id="rotationReplacementTargetOptions">
                            ${getProfiles()
                                .filter(item => item.name !== profileDraft.name)
                                .map(item => `<option value="${escapeHTML(item.name)}"></option>`)
                                .join("")}
                        </datalist>
                    </label>

                    <label class="rotation-contract-field">
                        <span>Motivo del Reemplazo</span>
                        <select data-contract-reason>
                            <option value="">Seleccionar</option>
                            <option value="Licencia Médica" ${state.contractReason === "Licencia Médica" ? "selected" : ""}>Licencia Médica</option>
                            <option value="F. Legal" ${state.contractReason === "F. Legal" ? "selected" : ""}>F. Legal</option>
                            <option value="F. Compensatorios" ${state.contractReason === "F. Compensatorios" ? "selected" : ""}>F. Compensatorios</option>
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
                            ? `Contrato seleccionado: ${formatDisplayDate(state.contractStart)} al ${formatDisplayDate(state.contractEnd)}.`
                            : state.contractStart
                                ? `Inicio seleccionado: ${formatDisplayDate(state.contractStart)}. Selecciona termino.`
                                : "Selecciona el inicio del contrato."
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
            ?.addEventListener("input", event => {
                state.contractReplaces = event.target.value;
            });

        backdrop
            .querySelector("[data-contract-reason]")
            ?.addEventListener("change", event => {
                state.contractReason = event.target.value;
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
            const today = new Date();

            await goToCalendarMonth(
                today.getFullYear(),
                today.getMonth(),
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
    const unitEntryDate =
        normalizeStoredStart(profile.unitEntryDate || "");
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

function getHheeMonthStats(profileName, year, month, holidays) {
    const days = new Date(year, month + 1, 0).getDate();

    return calcularHorasMesPerfil(
        profileName,
        year,
        month,
        days,
        holidays,
        getProfileData(profileName),
        {},
        getCarry(year, month)
    );
}

function setHoursReturnBalance(profileName, year, value) {
    const manual = getManualLeaveBalances(year, profileName);

    saveManualLeaveBalances(
        year,
        {
            ...manual,
            hoursReturn: normalizeBalanceValue(value)
        },
        profileName
    );
}

function adjustHoursReturnBalance(profileName, year, delta) {
    const manual = getManualLeaveBalances(year, profileName);
    const current = normalizeBalanceValue(manual.hoursReturn);

    setHoursReturnBalance(
        profileName,
        year,
        Math.max(0, current + Number(delta || 0))
    );
}

function hheeReturnEffectiveLabel(year, month) {
    const effective = nextMonthPeriod(year, month);

    return formatMonthHeading(
        new Date(effective.year, effective.month, 1)
    );
}

function roundSignedHours(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function hheeReturnTransferPayload(stats, transferredHours) {
    return {
        transferredHours,
        hheeDiurnas: Math.max(0, Number(stats.hheeDiurnas) || 0),
        hheeNocturnas: Math.max(0, Number(stats.hheeNocturnas) || 0)
    };
}

function syncHheeReturnTransferBalance(profileName, year, month, stats) {
    const existing =
        getHheeReturnTransfer(profileName, year, month);

    if (!existing?.enabled) return;
    const effective =
        hheeReturnEffectivePeriod({
            ...existing,
            year,
            month
        });
    const hasStoredEffective =
        hasStoredHheeReturnEffectivePeriod(existing);

    const transferredHours =
        calculateHheeReturnTransferHours(
            stats.hheeDiurnas,
            stats.hheeNocturnas
        );
    const previousTransferred =
        normalizeBalanceValue(existing.transferredHours);
    const delta = roundSignedHours(
        transferredHours - previousTransferred
    );

    if (!hasStoredEffective && Number(effective.year) !== Number(year)) {
        adjustHoursReturnBalance(
            profileName,
            year,
            -previousTransferred
        );
        adjustHoursReturnBalance(
            profileName,
            effective.year,
            previousTransferred
        );
    }

    if (delta) {
        adjustHoursReturnBalance(
            profileName,
            effective.year,
            delta
        );
    }

    saveHheeReturnTransfer(
        profileName,
        year,
        month,
        {
            ...existing,
            ...hheeReturnTransferPayload(stats, transferredHours),
            enabled: true,
            effectiveYear: effective.year,
            effectiveMonth: effective.month
        }
    );
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

    refreshAll();
}

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

function renderProfileRotationMiniCalendar() {
    if (!DOM.profileRotationMiniCalendar) return;

    const y = profileRotationMiniDate.getFullYear();
    const m = profileRotationMiniDate.getMonth();
    const first = (new Date(y, m, 1).getDay() + 6) % 7;
    const days = new Date(y, m + 1, 0).getDate();
    const profile = getPerfilActual();
    const displayedRotationType = isProfileEditing()
        ? profileDraft.rotationType
        : getRotativa(profile?.name).type;
    const isReplacementContract =
        isProfileEditing()
            ? isReplacementDraft()
            : isReplacementContractType(
                profile?.contractType
            ) ||
                displayedRotationType === "reemplazo";
    const isHonorariaContract =
        isProfileEditing()
            ? isHonorariaDraft()
            : isHonorariaContractType(profile?.contractType);
    const selectedKey = inputDateToCalendarKey(
        isReplacementContract
            ? profileDraft.contractStart
            : profileDraft.rotationStart
    );
    const contractEndKey =
        inputDateToCalendarKey(profileDraft.contractEnd);
    const editing = isProfileEditing();
    const canPick =
        editing &&
        (
            isReplacementContract ||
            requiresRotationStart(displayedRotationType)
        );
    const existingContracts =
        isReplacementContract && profile
            ? getContractsForProfile(profile.name)
            : [];

    let html = `
        <div class="profile-mini-head">
            <button id="profileMiniPrev" type="button" aria-label="Mes anterior">&lt;</button>
            <strong>${profileRotationMiniDate.toLocaleString("es-CL", {
                month: "long",
                year: "numeric"
            })}</strong>
            <button id="profileMiniNext" type="button" aria-label="Mes siguiente">&gt;</button>
        </div>

        <div class="profile-mini-weekdays">
            <span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span>
        </div>

        <div class="profile-mini-grid">
    `;

    for (let i = 0; i < first; i++) {
        html += `<span class="profile-mini-spacer"></span>`;
    }

    for (let d = 1; d <= days; d++) {
        const key = `${y}-${m}-${d}`;
        const iso = calendarKeyToInputDate(key);
        const state = getProfileRotationState(profile?.name, key);
        const existingContract = existingContracts.find(contract =>
            contract.start <= iso &&
            contract.end >= iso
        );
        const cell = document.createElement("button");

        cell.type = "button";
        cell.className = "profile-mini-day";
        cell.dataset.key = key;
        const outsideHonorariaContract =
            isHonorariaContract &&
            (
                !profileDraft.honorariaStart ||
                !profileDraft.honorariaEnd ||
                compareISODate(iso, profileDraft.honorariaStart) < 0 ||
                compareISODate(iso, profileDraft.honorariaEnd) > 0
            );
        const beforeUnitEntry =
            !isReplacementContract &&
            isBeforeDraftUnitEntryDate(iso);

        if (selectedKey === key) {
            cell.classList.add("is-selected");
        }

        if (isReplacementContract) {
            if (existingContract) {
                cell.classList.add("has-existing-contract");
                cell.title =
                    `Contrato vigente: ${formatContractDate(existingContract.start)} - ${formatContractDate(existingContract.end)} | Reemplaza a: ${existingContract.replaces}`;
            }

            if (contractEndKey === key) {
                cell.classList.add("is-contract-end");
            }

            const draftContractRange = Boolean(
                profileDraft.contractStart &&
                profileDraft.contractEnd &&
                iso >= profileDraft.contractStart &&
                iso <= profileDraft.contractEnd
            );

            if (draftContractRange) {
                cell.classList.add("is-contract-range");
            }
        }

        if (canPick && !outsideHonorariaContract && !beforeUnitEntry) {
            cell.classList.add("is-pickable");
        } else {
            cell.disabled = true;
        }

        if (beforeUnitEntry) {
            cell.classList.add("is-contract-disabled");
            cell.title =
                `Anterior al ingreso a la unidad (${formatDisplayDate(getDraftUnitEntryDate())}).`;
        }

        if (outsideHonorariaContract) {
            cell.classList.add("is-contract-disabled");
            cell.title = "Fuera de la vigencia del contrato de Honorarios.";
        }

        aplicarClaseTurno(cell, state);
        cell.innerHTML = `
            <span>${d}</span>
            <small>${
                isReplacementContract
                    ? (
                        existingContract
                            ? "Vigente"
                            : cell.classList.contains("is-contract-range")
                                ? "Nuevo"
                                : ""
                    )
                    : turnoLabel(state)
            }</small>
        `;

        html += cell.outerHTML;
    }

    html += `
        </div>
        <p class="profile-mini-help">
            ${canPick
                ? (
                    isReplacementContract
                        ? "Selecciona inicio y termino del contrato de reemplazo."
                        : "Selecciona aqui desde que fecha se aplicara la rotativa escogida."
                )
                : "Presiona Crear Nuevo o Editar y escoge una rotativa para seleccionar fecha."}
        </p>
    `;

    DOM.profileRotationMiniCalendar.innerHTML = html;

    document.getElementById("profileMiniPrev").onclick = () => {
        profileRotationMiniDate.setMonth(
            profileRotationMiniDate.getMonth() - 1
        );
        renderDashboardState();
    };

    document.getElementById("profileMiniNext").onclick = () => {
        profileRotationMiniDate.setMonth(
            profileRotationMiniDate.getMonth() + 1
        );
        renderDashboardState();
    };

    DOM.profileRotationMiniCalendar
        .querySelectorAll(".profile-mini-day.is-pickable")
        .forEach(button => {
            button.onclick = () => {
                if (isReplacementDraft()) {
                    handleContractDatePick(button.dataset.key);
                    return;
                }

                const date = parseKey(button.dataset.key);
                const startISO = toInputDate(date);

                if (isBeforeDraftUnitEntryDate(startISO)) {
                    alert(rotationStartBeforeUnitEntryMessage(startISO));
                    return;
                }

                profileDraft.rotationStart = startISO;
                renderDashboardState();
            };
        });
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
                        ${doc.dataUrl ? "" : " | volver a adjuntar para visualizar"}
                    </small>
                </span>
                <span class="attachment-actions">
                    <button class="secondary-button attachment-view" type="button" data-doc-view="${index}" ${doc.dataUrl ? "" : "disabled"}>
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
            button.onclick = () => {
                const doc = docs[Number(button.dataset.docView)];
                openAttachment(doc);
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

function renderRecordField(field, recordKey) {
    const id = `${recordKey}_${field.name}`;

    if (field.type === "textarea") {
        return `
            <label class="record-field record-field--wide">
                <span>${field.label}</span>
                <textarea id="${id}" data-field="${field.name}" rows="3"></textarea>
            </label>
        `;
    }

    return `
        <label class="record-field">
            <span>${field.label}</span>
            <input id="${id}" data-field="${field.name}" type="${field.type || "text"}">
        </label>
    `;
}

function renderRecordEntry(config, entry) {
    const values = config.fields
        .map(field => {
            const value = entry[field.name];
            const displayValue =
                field.type === "date" && value
                    ? formatDisplayDate(value)
                    : value;

            return `
                <span>
                    <strong>${field.label}:</strong>
                    ${escapeHTML(displayValue || "Sin dato")}
                </span>
            `;
        })
        .join("");

    return `
        <article class="record-item">
            <div class="record-item__values">
                ${values}
            </div>
            ${renderAttachmentName(entry)}
        </article>
    `;
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
                <input data-record-file type="file" accept="application/pdf,image/*">
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
        entry.file = normalizeAttachmentFiles([file])[0];
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

function renderDisponibilidadVacaciones() {
    if (!DOM.availabilitySummary) return;

    const profile = getPerfilActual();

    if (!profile) {
        availabilityEditMode = false;

        DOM.availabilitySummary.innerHTML = `
            <div class="availability-empty">
                Selecciona un colaborador para ver sus saldos.
            </div>
        `;

        return;
    }

    const year = currentDate.getFullYear();
    const saldos = getLeaveBalances(
        year,
        getCachedHolidays(year),
        {
            month: currentDate.getMonth(),
            profileName: profile.name
        }
    );
    const showCompBalance = isProfileEditing()
        ? Boolean(profileDraft.shiftAssigned)
        : getShiftAssigned(profile.name);

    if (availabilityEditMode) {
        DOM.availabilitySummary.innerHTML = `
            <div class="availability-list" style="--availability-columns: ${showCompBalance ? 4 : 3};">
                <label class="availability-item">
                    <span>FL</span>
                    <input id="availabilityLegalInput" type="number" min="0" step="0.5" value="${saldos.legal}">
                </label>

                ${showCompBalance ? `
                    <label class="availability-item">
                        <span>FC</span>
                        <input id="availabilityCompInput" type="number" min="0" step="1" value="${saldos.comp}">
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
                Editando saldos vigentes del a\u00f1o ${year}.
            </div>
        `;

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
    `;
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
        DOM.clockMarkBtn
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

function renderDashboardState() {
    const profile = getPerfilActual();
    const data = getDisplayedProfileData();
    const profileCanEdit = canEditTarget("profileSection");
    const editing = isProfileEditing() && profileCanEdit;
    const activeView =
        document.body.dataset.activeView || "turnos";

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
    DOM.profileRutInput.value = data.rut || "";
    syncRutValidity(false);
    DOM.profilePhoneInput.value = data.phone || "";
    delete DOM.profileBirthDateInput.dataset.birthDatePickerDefault;
    DOM.profileBirthDateInput.value = data.birthDate || "";
    DOM.profileUnitEntryDateInput.value = data.unitEntryDate || "";
    DOM.profileContractTypeSelect.value = data.contractType || "";
    DOM.profileRoleSelect.value = data.estamento || "";
    syncProfileProfessionField(data, editing);
    DOM.profileGradeSelect.value = data.grade || "";
    syncProfileRotationOptions(data);
    DOM.profileRotationSelect.value = data.rotationType || "";
    if (DOM.profileUnionLeaveInput) {
        DOM.profileUnionLeaveInput.checked =
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
    DOM.profileUnitEntryDateInput.disabled = !editing;
    DOM.profileContractTypeSelect.disabled = !editing;
    DOM.profileRoleSelect.disabled = !editing;
    DOM.profileGradeSelect.disabled = !editing;
    DOM.profileRotationSelect.disabled = !editing;
    if (DOM.profileUnionLeaveInput) {
        DOM.profileUnionLeaveInput.disabled = !editing;
    }
    DOM.checkbox.disabled = !editing;
    DOM.profileActiveToggle.disabled = !editing;

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

    const isReplacementContract =
        isReplacementDraft(data);
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
            !editing || !isReplacementContract;
    }

    if (DOM.replacementReasonSelect) {
        DOM.replacementReasonSelect.value =
            data.contractReason || "";
        DOM.replacementReasonSelect.disabled =
            !editing || !isReplacementContract;
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
                        `${formatContractDate(contract.start)} - ${formatContractDate(contract.end)}${contract.reason ? ` | ${contract.reason}` : ""} | ${contract.replaces}`
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
        renderProfileRotationStatus(data, editing);
        renderContractHistory(profile);
        renderProfileDocs(data, editing);
        renderProfileRecords(profile, editing);
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

    if (activeView === "profile") {
        renderDisponibilidadVacaciones();
    }

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

function getViewForTarget(targetId) {
    if (
        targetId === "profileSection" ||
        targetId === "availabilitySummary"
    ) {
        return "profile";
    }

    if (targetId === "hoursPanel") {
        return "hours";
    }

    if (targetId === "turnChangesView") {
        return "swap";
    }

    if (targetId === "workerRequestsPanel") {
        return "requests";
    }

    if (targetId === "memosPanel") {
        return "memos";
    }

    if (targetId === "reportsPanel") {
        return "reports";
    }

    if (targetId === "dashboardPanel") {
        return "dashboard";
    }

    if (targetId === "clockMarksPanel") {
        return "clockmarks";
    }

    if (targetId === "auditLogPanel") {
        return "log";
    }

    if (targetId === "staffingWeeklyCalendar") {
        return "weekly";
    }

    if (targetId === "timelinePanel") {
        return "timeline";
    }

    if (targetId === "taskAssignmentsPanel") {
        return "tasks";
    }

    if (targetId === "kanbanPanel") {
        return "kanban";
    }

    if (targetId === "agendaPanel") {
        return "agenda";
    }

    return "turnos";
}

function getTargetForActiveView() {
    const activeView = document.body.dataset.activeView || "turnos";
    const activeTile = Array.from(
        document.querySelectorAll(".nav-tile[data-target]")
    ).find(button =>
        getViewForTarget(button.dataset.target) === activeView &&
        !button.classList.contains("nav-tile--action")
    );

    return activeTile?.dataset.target || "calendarPanel";
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
}

function renderProfiles(options = {}) {
    const profiles = getProfiles();
    const showInactive =
        DOM.showInactiveProfiles?.checked ?? false;
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
    const filtro = DOM.filterRole.value;
    const query = normalizeProfileSearch(DOM.profileSearch.value);

    DOM.profiles.innerHTML = "";

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

    if (!visibles.length) {
        DOM.emptyProfiles.classList.remove("hidden");
        DOM.emptyProfiles.textContent = profiles.length
            ? "No hay resultados con ese filtro."
            : "Aun no hay colaboradores creados.";
    } else {
        DOM.emptyProfiles.classList.add("hidden");
    }

    visibles.forEach(profile => {
        const item = document.createElement("div");
        item.className = "profile-item";

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

        item.onclick = () => selectProfileByName(profile.name);

        DOM.profiles.appendChild(item);
    });

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

function isFourthShiftNoAssignmentProfile(profileName) {
    if (!profileName) return false;

    const rotativa = getRotativa(profileName);

    return (
        rotativa.type === "3turno" ||
        rotativa.type === "4turno"
    ) &&
        !getShiftAssigned(profileName);
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

    if (isAssignedShiftReportProfile(profile.name)) {
        return buildAssignedShiftReportPreviewHTML(profile, date);
    }

    if (isFourthShiftNoAssignmentProfile(profile.name)) {
        return buildNoAssignmentReportPreviewHTML(profile, date);
    }

    return Promise.resolve("");
}

function printReportPreviewHTML(html, title) {
    if (!html) {
        alert("No fue posible generar el reporte para imprimir.");
        return;
    }

    const printWindow = window.open(
        "",
        "_blank",
        "width=1100,height=800"
    );

    if (!printWindow) {
        alert("Permite las ventanas emergentes para imprimir el reporte.");
        return;
    }

    printWindow.document.open();
    printWindow.document.write(`
        <!doctype html>
        <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${escapeHTML(title || "Reporte")}</title>
                <link rel="stylesheet" href="styles.css">
                <style>
                    :root {
                        --accent: #1d6cff;
                        --panel: #ffffff;
                        --panel-alt: #ffffff;
                        --field: #ffffff;
                        --border: #e5e7eb;
                        --text: #0f172a;
                        --text-soft: #1e2f4d;
                        --text-muted: #64748b;
                    }

                    *,
                    *::before,
                    *::after {
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                        color-adjust: exact !important;
                    }

                    html,
                    body {
                        width: 100%;
                        min-height: 100%;
                        margin: 0;
                        background: #ffffff !important;
                        color: #111827 !important;
                    }

                    body::before,
                    body::after {
                        display: none !important;
                    }

                    .report-print-page {
                        max-width: 1180px;
                        margin: 0 auto;
                        padding: 18px;
                        box-sizing: border-box;
                        background: #ffffff;
                    }

                    .report-print-page .report-title-strip {
                        display: block;
                    }

                    .report-print-page .no-assignment-report {
                        display: grid;
                        gap: 12px;
                    }

                    .report-print-page .report-title-strip {
                        padding: 10px 12px;
                        border-radius: 12px;
                        background: #0f172a !important;
                        color: #ffffff !important;
                        font-weight: 900;
                        text-align: center;
                    }

                    .report-print-page .report-section {
                        display: grid;
                        gap: 6px;
                        min-width: 0;
                    }

                    .report-print-page .report-section h4 {
                        margin: 0;
                        padding: 7px 10px;
                        border-radius: 10px;
                        background: #1d6cff !important;
                        color: #ffffff !important;
                        font-size: 0.82rem;
                        text-transform: uppercase;
                    }

                    .report-print-page .report-table-wrap {
                        overflow: visible;
                        border-radius: 12px;
                        border: 1px solid #e5e7eb;
                        background: #ffffff !important;
                    }

                    .report-print-page .report-table {
                        width: 100%;
                        border-collapse: collapse;
                        font-size: 0.8rem;
                    }

                    .report-print-page .report-table th,
                    .report-print-page .report-table td {
                        padding: 7px 8px;
                        border: 1px solid #e5e7eb;
                        text-align: left;
                        vertical-align: top;
                    }

                    .report-print-page .report-table th {
                        background: #dbeafe !important;
                        color: #0f172a !important;
                        font-weight: 800;
                    }

                    .report-print-page .report-table td {
                        background: #ffffff !important;
                        color: #1e2f4d !important;
                    }

                    .report-print-page .report-worker-data-grid {
                        display: grid !important;
                        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                        gap: 12px !important;
                    }

                    .report-print-page .report-worker-data-column {
                        min-width: 0;
                    }

                    .report-print-page .report-section--worker-data .report-table {
                        min-width: 0;
                    }

                    .report-print-page .report-section--worker-data .report-table th:first-child,
                    .report-print-page .report-section--worker-data .report-table td:first-child {
                        width: 1%;
                        padding-right: 22px;
                        white-space: nowrap;
                    }

                    .report-print-page .report-row--inhabil td:first-child {
                        background: #fee2e2 !important;
                    }

                    .report-print-page .report-signature-footer {
                        justify-self: end;
                        width: min(320px, 42%);
                        min-width: 240px;
                        margin-top: 24mm;
                        margin-right: 10mm;
                        padding: 2mm 0 0;
                        border-top: 1px solid #1e2f4d;
                        color: #1e2f4d !important;
                        font-size: 0.78rem;
                        font-weight: 650;
                        line-height: 1.3;
                        text-align: center;
                        break-inside: avoid;
                        page-break-inside: avoid;
                    }

                    @media print {
                        @page {
                            size: A4 landscape;
                            margin: 12mm;
                        }

                        html,
                        body {
                            width: auto;
                            min-height: 0;
                            padding: 0 !important;
                        }

                        .report-print-page {
                            max-width: none;
                            width: 100%;
                            padding: 4mm;
                            box-sizing: border-box;
                            -webkit-box-decoration-break: clone;
                            box-decoration-break: clone;
                        }

                        .report-print-page .no-assignment-report {
                            gap: 8px;
                        }

                        .report-print-page .report-section {
                            break-inside: auto;
                            page-break-inside: auto;
                        }

                        .report-print-page .report-section h4 {
                            break-after: avoid;
                            page-break-after: avoid;
                        }

                        .report-print-page .report-table-wrap {
                            break-inside: auto;
                            page-break-inside: auto;
                        }

                        .report-print-page .report-worker-data-grid {
                            display: grid !important;
                            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                        }

                        .report-print-page .report-table {
                            page-break-inside: auto;
                        }

                        .report-print-page .report-table tr {
                            break-inside: avoid;
                            page-break-inside: avoid;
                        }
                    }
                </style>
            </head>
            <body class="theme-light">
                <main class="report-print-page">
                    ${html}
                </main>
            </body>
        </html>
    `);
    printWindow.document.close();

    const runPrint = () => {
        printWindow.focus();
        printWindow.print();
    };

    if (printWindow.document.readyState === "complete") {
        window.setTimeout(runPrint, 300);
    } else {
        printWindow.addEventListener("load", () =>
            window.setTimeout(runPrint, 300),
            { once: true }
        );
    }
}

async function printSpecificReportPdf(profile, date) {
    if (!profile?.name) {
        alert("Selecciona un trabajador para imprimir el reporte.");
        return;
    }

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
    const hasShiftAssigned = getShiftAssigned(profile.name);
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
        isFourthShiftNoAssignmentProfile(profile.name);
    const canShowAssignedShiftReport =
        isAssignedShiftReportProfile(profile.name);
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
        DOM.downloadNoAssignmentReportBtn.onclick = () =>
            canShowReplacementReport
                ? exportReplacementShiftReport(profile, reportDate)
                : canShowDiurnoReport
                ? exportDiurnoShiftReport(profile, reportDate)
                : canShowAssignedShiftReport
                ? exportAssignedShiftReport(profile, reportDate)
                : exportNoAssignmentShiftReport(profile, reportDate);
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

function formatClockMarkDate(keyDay) {
    return formatDisplayDate(calendarKeyToInputDate(keyDay));
}

function formatClockMinute(date) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function parseClockTimeValue(value) {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);

    if (!match) return null;

    const hour = Number(match[1]);
    const minute = Number(match[2]);

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return null;
    }

    return { hour, minute };
}

function clockDateAt(base, hour, minute = 0) {
    return new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate(),
        hour,
        minute
    );
}

function clockTimeNearReference(baseDate, value, reference) {
    const parsed = parseClockTimeValue(value);

    if (!parsed) return null;

    const same = clockDateAt(
        baseDate,
        parsed.hour,
        parsed.minute
    );
    const next = new Date(same);
    next.setDate(next.getDate() + 1);
    const previous = new Date(same);
    previous.setDate(previous.getDate() - 1);

    return [same, next, previous].sort((a, b) =>
        Math.abs(a - reference) - Math.abs(b - reference)
    )[0];
}

function clockSegmentsOverlap(a, b) {
    return a.start < b.end && b.start < a.end;
}

function findClockMarkEntry(mark, segment) {
    if (!mark?.segments || !segment) return null;

    const aliases = {
        half_admin_morning: ["half_afternoon"],
        half_admin_afternoon: ["half_morning"],
        half_morning: ["half_admin_afternoon"],
        half_afternoon: ["half_admin_morning"]
    };
    const keys = [segment.id, ...(aliases[segment.id] || [])];
    const key = keys.find(item => mark.segments[item]);

    return key
        ? { key, value: mark.segments[key] }
        : null;
}

function findClockSegmentForKey(segmentKey, segments) {
    const aliases = {
        half_admin_morning: ["half_afternoon"],
        half_admin_afternoon: ["half_morning"],
        half_morning: ["half_admin_afternoon"],
        half_afternoon: ["half_admin_morning"]
    };

    return segments.find(segment =>
        segment.id === segmentKey ||
        (aliases[segmentKey] || []).includes(segment.id)
    ) || null;
}

function fallbackClockSegment(date, segmentKey) {
    return {
        id: segmentKey,
        label: segmentKey
            .replace(/_/g, " ")
            .replace(/\b\w/g, char => char.toUpperCase()),
        start: clockDateAt(date, 0),
        end: clockDateAt(date, 0)
    };
}

function hasClockMarkRecordData(segmentMark) {
    return Boolean(
        segmentMark?.entryTime ||
        segmentMark?.exitTime ||
        segmentMark?.missingEntry ||
        segmentMark?.missingExit
    );
}

function getClockMarkTimingFlags(date, segment, segmentMark) {
    const entry = segmentMark?.entryTime
        ? clockTimeNearReference(
            date,
            segmentMark.entryTime,
            segment.start
        )
        : null;
    const exit = segmentMark?.exitTime
        ? clockTimeNearReference(
            date,
            segmentMark.exitTime,
            segment.end
        )
        : null;

    return {
        entry,
        exit,
        lateEntry: Boolean(entry && entry > segment.start),
        earlyEntry: Boolean(entry && entry < segment.start),
        earlyExit: Boolean(exit && exit < segment.end),
        lateExit: Boolean(exit && exit > segment.end)
    };
}

function getClockActualState(profileName, keyDay) {
    const data = getProfileData(profileName);
    const hasData =
        Object.prototype.hasOwnProperty.call(data, keyDay);
    const rawState = hasData
        ? Number(data[keyDay]) || TURNO.LIBRE
        : getTurnoBase(profileName, keyDay);

    return aplicarCambiosTurno(
        profileName,
        keyDay,
        rawState
    );
}

function getClockBaseState(profileName, keyDay) {
    return aplicarCambiosTurno(
        profileName,
        keyDay,
        getTurnoBase(profileName, keyDay),
        { includeReplacements: false }
    );
}

function isClockBaseOrSwapSegment(
    profileName,
    keyDay,
    date,
    segment,
    holidays
) {
    const baseState = getClockBaseState(profileName, keyDay);
    const scheduledBaseState = getClockScheduleState(
        profileName,
        keyDay,
        baseState
    );
    const baseSegments = getScheduledSegmentsForProfile(
        profileName,
        keyDay,
        date,
        scheduledBaseState,
        holidays
    );

    return baseSegments.some(base =>
        base.id === segment.id ||
        clockSegmentsOverlap(base, segment)
    );
}

function buildClockMarkRecordsForProfile(profile, monthDate, holidays) {
    const records = [];
    const y = monthDate.getFullYear();
    const m = monthDate.getMonth();
    const marks = getClockMarks(profile.name);

    Object.entries(marks).forEach(([keyDay, dayMark]) => {
        const date = parseKey(keyDay);

        if (
            Number.isNaN(date.getTime()) ||
            date.getFullYear() !== y ||
            date.getMonth() !== m ||
            !dayMark?.segments
        ) {
            return;
        }

        const actualState = getClockActualState(
            profile.name,
            keyDay
        );
        const scheduledState = getClockScheduleState(
            profile.name,
            keyDay,
            actualState
        );
        const scheduledSegments = getScheduledSegmentsForProfile(
            profile.name,
            keyDay,
            date,
            scheduledState,
            holidays
        );
        const consumed = new Set();

        scheduledSegments.forEach(segment => {
            const entry = findClockMarkEntry(dayMark, segment);

            if (!entry || !hasClockMarkRecordData(entry.value)) {
                return;
            }

            consumed.add(entry.key);
            records.push({
                profile,
                keyDay,
                date,
                segment,
                segmentKey: entry.key,
                segmentMark: entry.value,
                isBaseOrSwap: isClockBaseOrSwapSegment(
                    profile.name,
                    keyDay,
                    date,
                    segment,
                    holidays
                )
            });
        });

        Object.entries(dayMark.segments)
            .filter(([segmentKey, segmentMark]) =>
                !consumed.has(segmentKey) &&
                hasClockMarkRecordData(segmentMark)
            )
            .forEach(([segmentKey, segmentMark]) => {
                const segment =
                    findClockSegmentForKey(
                        segmentKey,
                        scheduledSegments
                    ) ||
                    fallbackClockSegment(date, segmentKey);

                records.push({
                    profile,
                    keyDay,
                    date,
                    segment,
                    segmentKey,
                    segmentMark,
                    isBaseOrSwap: isClockBaseOrSwapSegment(
                        profile.name,
                        keyDay,
                        date,
                        segment,
                        holidays
                    )
                });
            });
    });

    return records;
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
    const isReduction =
        record.isBaseOrSwap &&
        !isMissing &&
        (timing.lateEntry || timing.earlyExit);
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
        badges.push("Reduccion de jornada");
    }

    if (timing.earlyEntry || timing.lateExit) {
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
                    <input data-clock-documents type="file" multiple>
                </label>

                <div class="attachment-list">
                    ${clockDocuments.length
                        ? clockDocuments.map((doc, index) => `
                            <div class="attachment-item">
                                <span>
                                    <strong>${escapeHTML(doc.name || "Documento")}</strong>
                                    <small>
                                        ${doc.type ? escapeHTML(doc.type) : "Archivo"}
                                        ${doc.dataUrl ? "" : " | volver a adjuntar para visualizar"}
                                    </small>
                                </span>
                                <span class="attachment-actions">
                                    <button class="secondary-button attachment-view" type="button" data-clock-doc-view="${index}" ${doc.dataUrl ? "" : "disabled"}>
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
                refreshAll();
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
                const attachments =
                    await readAttachmentFiles(input.files);

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
            button.onclick = () => {
                const card = button.closest(".clockmark-record");
                const marks = getClockMarks(card.dataset.profile);
                const doc =
                    marks[card.dataset.keyDay]
                        ?.segments?.[card.dataset.segmentKey]
                        ?.documents?.[Number(button.dataset.clockDocView)];

                openAttachment(doc);
            };
        });

    DOM.clockMarksList
        .querySelectorAll("[data-clock-doc-remove]")
        .forEach(button => {
            button.onclick = () => {
                const card = button.closest(".clockmark-record");
                const marks = getClockMarks(card.dataset.profile);
                const currentDocuments =
                    marks[card.dataset.keyDay]
                        ?.segments?.[card.dataset.segmentKey]
                        ?.documents || [];
                const indexToRemove =
                    Number(button.dataset.clockDocRemove);

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
                renderClockMarksPanel();
            };
        });
}

window.renderClockMarksPanel = renderClockMarksPanel;

function normalizeProfileSearch(value) {
    return normalizeText(value);
}

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

function getCalendarProfileDetail(profile = {}) {
    const estamento = profile.estamento || "Sin estamento";
    const profession = normalizeProfession(
        profile.profession,
        estamento
    );

    return profession === SIN_INFORMACION_PROFESSION
        ? estamento
        : formatProfession(profession);
}

function getCalendarProfileSearchValue(profile = {}) {
    const name = String(profile.name || "").trim();
    const separator = "   |   ";

    if (!name) return "";

    return `${name}${separator}${getCalendarProfileDetail(profile)}`;
}

function getCalendarProfileSearchKeys(profile = {}) {
    return [
        profile.name,
        getCalendarProfileSearchValue(profile)
    ]
        .map(normalizeProfileSearch)
        .filter(Boolean);
}

function findTopProfileSearchMatch(query, profiles) {
    const normalizedQuery = normalizeProfileSearch(query);

    const matchesBy = predicate =>
        profiles.find(profile =>
            getCalendarProfileSearchKeys(profile).some(predicate)
        );

    return (
        matchesBy(value => value === normalizedQuery) ||
        matchesBy(value => value.startsWith(normalizedQuery)) ||
        matchesBy(value => value.includes(normalizedQuery))
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
        alert("No se encontro un colaborador con ese nombre.");
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
    clearDraftValues();
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
        refreshAll();
    }
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

    refreshAll();
}

function startCreateMode() {
    if (!canEditCurrentProfileMenu()) return;

    clearSelectionMode(false);
    clearDraftValues();
    availabilityEditMode = false;
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
    profileDraft.contractStart =
        calendarKeyToInputDate(keyDay);
    profileDraft.contractEnd = "";
    profileDraft.contractReplaces = "";
    profileDraft.contractReason = "";
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
    clearDraftValues();
    availabilityEditMode = false;
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

    if (
        requiresRotationStart(profileDraft.rotationType) &&
        !getDraftUnitEntryDate()
    ) {
        alert("Ingresa primero la fecha de ingreso a la unidad para configurar la rotativa.");
        profileDraft.rotationType = "";
        profileDraft.rotationStart = "";
        profileDraft.rotationFirstTurn = "larga";
        DOM.profileRotationSelect.value = "";
        renderDashboardState();
        return;
    }

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

    openRotationConfigModal(profileDraft.rotationType);
}

function hasPendingReplacementContract() {
    return Boolean(
        profileDraft.contractStart ||
        profileDraft.contractEnd ||
        profileDraft.contractReplaces.trim() ||
        profileDraft.contractReason
    );
}

function requiresReplacementContract() {
    if (!isReplacementDraft()) {
        return false;
    }

    if (profileDraft.mode === PROFILE_MODE.CREATE) {
        return true;
    }

    if (hasPendingReplacementContract()) {
        return true;
    }

    const existingContracts =
        getContractsForProfile(
            profileDraft.originalName || getCurrentProfile()
        );

    return existingContracts.length === 0;
}

function validateDraft() {
    const missing = [];
    const shouldRequireRotationStart =
        (
            profileDraft.mode === PROFILE_MODE.CREATE ||
            hasRotationChanged()
        ) &&
        requiresRotationStart(profileDraft.rotationType);
    const rutMessage =
        getRutValidationMessage(profileDraft.rut);

    if (!profileDraft.name.trim()) missing.push("nombre");
    if (!profileDraft.estamento) missing.push("estamento");
    if (
        shouldRequireUnitEntryForRotation() &&
        !getDraftUnitEntryDate()
    ) {
        missing.push("fecha de ingreso a la unidad");
    }
    if (
        profileDraft.rotationType === "libre" &&
        !supportsLibreRotation()
    ) {
        alert("La rotativa Libre solo esta disponible para contratos Reemplazo u Honorarios.");
        return false;
    }

    if (!isReplacementDraft() && !profileDraft.rotationType) {
        missing.push("rotativa");
    }
    if (requiresReplacementContract()) {
        if (!profileDraft.contractStart) {
            missing.push("inicio de contrato");
        }

        if (!profileDraft.contractEnd) {
            missing.push("termino de contrato");
        }

        if (!profileDraft.contractReplaces.trim()) {
            missing.push("a quien reemplaza");
        }

        if (!profileDraft.contractReason) {
            missing.push("motivo del reemplazo");
        }
    }

    if (isHonorariaDraft()) {
        if (!profileDraft.honorariaStart) {
            missing.push("inicio del contrato de Honorarios");
        }

        if (!profileDraft.honorariaEnd) {
            missing.push("termino del contrato de Honorarios");
        }

        if (!(Number(profileDraft.honorariaHourlyRate) > 0)) {
            missing.push("valor de la hora");
        }

        if (!(Number(profileDraft.honorariaMaxMonthlyHours) > 0)) {
            missing.push("maximo de horas mensuales");
        }
    }

    if (
        !isReplacementDraft() &&
        shouldRequireRotationStart &&
        !profileDraft.rotationStart
    ) {
        missing.push("fecha de inicio de rotativa");
    }

    if (
        !isReplacementDraft() &&
        shouldRequireRotationStart &&
        requiresRotationFirstTurn(profileDraft.rotationType) &&
        !profileDraft.rotationFirstTurn
    ) {
        missing.push("turno inicial de rotativa");
    }

    if (
        !isReplacementDraft() &&
        profileDraft.rotationStart &&
        isBeforeDraftUnitEntryDate(profileDraft.rotationStart)
    ) {
        alert(rotationStartBeforeUnitEntryMessage(profileDraft.rotationStart));
        return false;
    }

    if (
        isReplacementDraft() &&
        profileDraft.contractStart &&
        profileDraft.contractEnd &&
        compareISODate(
            profileDraft.contractEnd,
            profileDraft.contractStart
        ) < 0
    ) {
        alert("La fecha de termino del contrato no puede ser anterior al inicio.");
        return false;
    }

    if (
        isHonorariaDraft() &&
        profileDraft.honorariaStart &&
        profileDraft.honorariaEnd &&
        compareISODate(
            profileDraft.honorariaEnd,
            profileDraft.honorariaStart
        ) < 0
    ) {
        alert("La fecha de termino del contrato de Honorarios no puede ser anterior al inicio.");
        return false;
    }

    if (
        isHonorariaDraft() &&
        profileDraft.honorariaStart &&
        profileDraft.honorariaEnd &&
        profileDraft.rotationStart &&
        (
            compareISODate(
                profileDraft.rotationStart,
                profileDraft.honorariaStart
            ) < 0 ||
            compareISODate(
                profileDraft.rotationStart,
                profileDraft.honorariaEnd
            ) > 0
        )
    ) {
        alert("La rotativa del trabajador a Honorarios debe comenzar dentro de la vigencia del contrato.");
        return false;
    }

    if (
        isReplacementDraft() &&
        profileDraft.contractReplaces.trim()
    ) {
        const targetName =
            profileDraft.contractReplaces.trim();

        if (targetName === profileDraft.name.trim()) {
            alert("Un trabajador no puede reemplazarse a si mismo.");
            return false;
        }

        if (
            !getProfiles().some(profile =>
                profile.name === targetName
            )
        ) {
            alert("El trabajador reemplazado debe existir en el listado de perfiles.");
            return false;
        }
    }

    if (rutMessage) {
        alert(rutMessage);
        DOM.profileRutInput.focus();
        DOM.profileRutInput.select();
        syncRutValidity(true);
        return false;
    }

    if (!missing.length) {
        return true;
    }

    alert(
        `Falta completar: ${missing.join(", ")}.`
    );
    return false;
}

function futureKeys(map, startDate) {
    return Object.keys(map || {}).filter(key =>
        isDateKeyOnOrAfter(key, startDate)
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

    cleanupFutureSwaps(profileName, startISO);

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
}

async function aplicarDiurnoDesde(fecha) {
    if (!getCurrentProfile()) return;

    const data = getProfileData();
    const baseData = getBaseProfileData();
    const blocked = getBlockedDays();

    const year = fecha.getFullYear();
    const holidays = await fetchHolidays(year);

    let day = new Date(fecha);

    while (day.getFullYear() === year) {
        const key = keyFromDate(day);

        delete data[key];
        delete baseData[key];
        delete blocked[key];

        if (isBusinessDay(day, holidays)) {
            data[key] = 4;
            baseData[key] = 4;
            blocked[key] = true;
        }

        day.setDate(day.getDate() + 1);
    }

    saveProfileData(data);
    saveBaseProfileData(baseData);
    saveBlockedDays(blocked);
    refreshAll();
}

function aplicarRotativaSecuencialDesde(fecha, secuencia) {
    if (!getCurrentProfile()) return;

    const data = getProfileData();
    const baseData = getBaseProfileData();
    const blocked = getBlockedDays();

    let day = new Date(fecha);
    const year = day.getFullYear();

    while (day.getFullYear() === year) {
        for (let i = 0; i < secuencia.length; i++) {
            const key = keyFromDate(day);
            const turno = secuencia[i];

            delete data[key];
            delete baseData[key];
            delete blocked[key];

            if (turno) {
                data[key] = turno;
                baseData[key] = turno;
                blocked[key] = true;
            }

            day.setDate(day.getDate() + 1);
        }
    }

    saveProfileData(data);
    saveBaseProfileData(baseData);
    saveBlockedDays(blocked);
    refreshAll();
}

function aplicarCuartoTurnoDesde(fecha, firstTurn = "larga") {
    aplicarRotativaSecuencialDesde(
        fecha,
        getRotationSequence("4turno", firstTurn)
    );
}

function aplicarTercerTurnoDesde(fecha, firstTurn = "larga") {
    aplicarRotativaSecuencialDesde(
        fecha,
        getRotationSequence("3turno", firstTurn)
    );
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
        aplicarTercerTurnoDesde(startDate, firstTurn);
        return;
    }

    aplicarCuartoTurnoDesde(startDate, firstTurn);
}

async function guardarPerfil() {
    if (!canEditCurrentProfileMenu()) return;
    if (!validateDraft()) return;

    const isCreating =
        profileDraft.mode === PROFILE_MODE.CREATE;
    const isEditing =
        profileDraft.mode === PROFILE_MODE.EDIT;
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
    const nextRotationType =
        replacementContract &&
        profileDraft.rotationType !== "libre"
            ? ""
            : profileDraft.rotationType;
    const nextShiftAssigned =
        (
            nextRotationType === "3turno" ||
            nextRotationType === "4turno"
        ) &&
        Boolean(profileDraft.shiftAssigned);
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
        unitEntryDate: profileDraft.unitEntryDate,
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
        unionLeaveEnabled: Boolean(profileDraft.unionLeaveEnabled),
        estamento: nextEstamento,
        profession: nextProfession,
        grade: profileDraft.grade
    };
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
    const shouldApplyRotation =
        (
            !replacementContract ||
            nextRotationType === "libre"
        ) &&
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

    try {
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
                    profileDraft.unitEntryDate ||
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

        setShiftAssigned(nextShiftAssigned);
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
                reason: profileDraft.contractReason
            });

            createReplacementContractMemoTask({
                profile: nextName,
                contract: replacementContract
            });
        }

        if (isEditing && availabilityEditMode) {
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
        legal: normalizeBalanceValue(
            document.getElementById("availabilityLegalInput")?.value
        ),
        admin: normalizeBalanceValue(
            document.getElementById("availabilityAdminInput")?.value
        ),
        hoursReturn: normalizeBalanceValue(
            document.getElementById("availabilityHoursReturnInput")?.value
        )
    };
    const compInput =
        document.getElementById("availabilityCompInput");

    if (compInput) {
        balances.comp = normalizeBalanceValue(compInput.value);
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
    refreshAll();
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
        legal: normalizeBalanceValue(legalInput.value),
        admin: normalizeBalanceValue(adminInput.value),
        hoursReturn: normalizeBalanceValue(hoursReturnInput.value)
    };
    const compInput =
        document.getElementById("availabilityCompInput");

    if (compInput) {
        balances.comp = normalizeBalanceValue(compInput.value);
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

    if (!Number.isInteger(cantidad)) {
        alert("El saldo de F. Compensatorio debe ser un numero entero para aplicar el bloque completo.");
        return;
    }

    if (!getShiftAssigned()) {
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

function getLicenseTypeLabel(type) {
    if (type === "professional_license") return "LM Profesional";
    if (type === "union_leave") return "Permiso Gremial";
    if (type === "unpaid_leave") return "Permiso sin Goce";
    return "Licencia M\u00e9dica";
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

function cloneReturnDate(date) {
    return new Date(date.getTime());
}

function dateAtReturn(base, hour, minutes = 0) {
    return new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate(),
        hour,
        minutes
    );
}

function nextDateAtReturn(base, hour, minutes = 0) {
    const date = dateAtReturn(base, hour, minutes);
    date.setDate(date.getDate() + 1);
    return date;
}

function parseReturnTime(value) {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);

    if (!match) return null;

    const hour = Number(match[1]);
    const minute = Number(match[2]);

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return null;
    }

    return { hour, minute };
}

function timeNearReturnReference(baseDate, value, reference) {
    const parsed = parseReturnTime(value);

    if (!parsed) return null;

    const candidates = [
        dateAtReturn(baseDate, parsed.hour, parsed.minute),
        nextDateAtReturn(baseDate, parsed.hour, parsed.minute)
    ];
    const previous =
        dateAtReturn(baseDate, parsed.hour, parsed.minute);

    previous.setDate(previous.getDate() - 1);
    candidates.push(previous);

    return candidates.sort((a, b) =>
        Math.abs(a - reference) - Math.abs(b - reference)
    )[0];
}

function formatReturnTime(date) {
    return [
        String(date.getHours()).padStart(2, "0"),
        String(date.getMinutes()).padStart(2, "0")
    ].join(":");
}

function formatReturnDateTime(date) {
    return `${formatReturnTime(date)} hrs.`;
}

function roundReturnHours(value) {
    return Math.max(
        0,
        Math.round((Number(value) || 0) * 10) / 10
    );
}

function returnHoursBetween(start, end) {
    return roundReturnHours(
        Math.max(0, (end - start) / 36e5)
    );
}

function getSegmentReturnHours(segment) {
    return returnHoursBetween(segment.start, segment.end);
}

function getReturnSegmentId(segment, index) {
    return String(segment.id || `segment_${index}`);
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
            : getShiftAssigned()
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

function applyTheme(theme) {
    document.body.classList.remove("theme-light", "theme-dark");
    document.body.classList.add(`theme-${theme}`);
    DOM.themeToggle.setAttribute(
        "aria-pressed",
        theme === "dark" ? "true" : "false"
    );
}

function initTheme() {
    const savedTheme = getRaw(THEME_KEY, "");
    const prefersLight =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: light)").matches;

    const initialTheme =
        savedTheme || (prefersLight ? "light" : "dark");

    applyTheme(initialTheme);

    DOM.themeToggle.onclick = () => {
        const nextTheme =
            document.body.classList.contains("theme-dark")
                ? "light"
                : "dark";

        setRaw(THEME_KEY, nextTheme);
        applyTheme(nextTheme);
    };
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
                await readAttachmentFiles(DOM.profileDocsInput.files);

            profileDraft.docs = [
                ...profileDraft.docs,
                ...attachments
            ];
            DOM.profileDocsInput.value = "";
            renderDashboardState();
        } catch {
            alert("No se pudo leer el archivo adjunto. Intenta nuevamente con otro documento.");
        }
    };

    DOM.profileUnitEntryDateInput.onchange = () => {
        if (!isProfileEditing()) return;
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
        } else {
            profileDraft.contractStart = "";
            profileDraft.contractEnd = "";
            profileDraft.contractReplaces = "";
            profileDraft.contractReason = "";
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

    DOM.checkbox.onchange = () => {
        if (isProfileEditing()) {
            profileDraft.shiftAssigned =
                DOM.checkbox.checked;
            renderBotones();
            return;
        }

        if (!getCurrentProfile()) return;

        setShiftAssigned(DOM.checkbox.checked);
        addAuditLog(
            AUDIT_CATEGORY.COLLABORATOR_UPDATED,
            "Modifico asignacion de turno",
            `${getCurrentProfile()}: asignacion de turno ${yesNoLabel(DOM.checkbox.checked)}.`,
            { profile: getCurrentProfile() }
        );
        renderBotones();
        refreshAll();
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
        DOM.printHoursReportBtn.onclick = () =>
            exportHoursReport(
                getPerfilActual(),
                profileRotationMiniDate
            );
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

function isAppTarget(targetId) {
    return Boolean(
        targetId &&
        document.getElementById(targetId) &&
        Array.from(
            document.querySelectorAll(".nav-tile[data-target]")
        ).some(button => button.dataset.target === targetId)
    );
}

function targetFromHash() {
    const value = decodeURIComponent(
        String(window.location.hash || "").replace(/^#/, "")
    );

    return isAppTarget(value) ? value : "";
}

function appTargetUrl(targetId) {
    const url = new URL(window.location.href);
    url.hash = targetId;
    return `${url.pathname}${url.search}${url.hash}`;
}

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
    DOM.filterRole.onchange = renderProfiles;
    DOM.profileSearch.oninput = renderProfiles;
    if (DOM.showInactiveProfiles) {
        DOM.showInactiveProfiles.onchange = renderProfiles;
    }

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

document.addEventListener("click", async event => {
    const celda = event.target.closest(".day");
    if (!celda) return;

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

    const fecha = new Date(
        Number(celda.dataset.year),
        Number(celda.dataset.month),
        Number(celda.dataset.day)
    );

    if (selectionMode === "rotation") {
        await applyCalendarRotationChange(fecha);
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
        pushHistory();
        const aplicado = await aplicarLicencia(
            fecha,
            licenseCantidad,
            licenseType
        );

        if (!aplicado) {
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
            aplicarAusenciaInjustificada(fecha);

        if (!aplicado) {
            alert(
                "No se pudo aplicar la ausencia injustificada. Solo puede marcarse sobre d\u00edas con turno real y sin permisos, feriados o licencias ya cargadas."
            );
            return;
        }

        refreshAll();
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

    refreshAll();
});

window.addEventListener("proturnos:replacementRequestsChanged", () => {
    if (document.body.dataset.activeView === "requests") {
        renderWorkerRequestsPanel();
    } else {
        refreshWorkerRequestsNavBadge();
    }

    refreshAll();
});

window.addEventListener("proturnos:memosChanged", () => {
    if (document.body.dataset.activeView === "memos") {
        renderMemosPanel();
    } else {
        updateMemosNavBadge();
    }
});

window.addEventListener("proturnos:auditUndoApplied", event => {
    refreshAll();
    notifyWorkersOfAuditUndo(event.detail || {});
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

window.addEventListener("proturnos:workerLinksChanged", () => {
    renderDashboardState();
});

function syncWorkspaceStateViews() {
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
}

initTheme();
initTurnosSidePanelSync();
initSystemSettings({
    button: DOM.systemSettingsBtn,
    onSaved: () => {
        refreshAll();
    }
});
initSupervisorMessages({
    button: DOM.floatingMessagesBtn,
    badge: DOM.floatingMessagesBadge
});
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
            await startWorkspacePermissionListener(workspace, () => {
                syncWorkspacePermissionUI();
                syncCalendarDirectEditToggle();
                renderDashboardState();
            });
            startWorkerRequestsRealtimeSync(workspace);
            startWorkerAppDataSync(workspace);
            startWorkerAvailabilitySync(workspace, {
                onChange: () => {
                    refreshAll();
                    scheduleWorkerAppDataPublish(300);
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
            startFirebaseAppStateSync(workspace, {
                onChange: () => {
                    syncWorkspaceStateViews();
                    scheduleWorkerAppDataPublish(300);
                }
            });
        } else {
            stopWorkerRequestsRealtimeSync();
            stopFirebaseReplacementRequestSync();
            stopFirebaseWorkerRequestSync();
            stopWorkerAppDataSync();
            stopWorkerAvailabilitySync();
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
