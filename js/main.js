import { prevMonth, nextMonth, currentDate } from "./calendar.js";
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
    renderStaffingPanel,
    renderStaffingWeeklyCalendar,
    scrollInlineStaffingReportToToday,
    syncStaffingConfigForProfileChange
} from "./staffing.js";
import { renderTaskAssignmentsPanel } from "./taskAssignments.js";
import { renderKanbanBoard } from "./kanban.js";
import { renderAgendaPanel } from "./agenda.js";
import { initSystemSettings } from "./systemSettings.js";
import { initFirebaseShell } from "./firebaseShell.js";
import {
    startFirebaseAppStateSync,
    stopFirebaseAppStateSync
} from "./firebaseAppState.js";
import {
    buildNoAssignmentReportPreviewHTML,
    exportHoursReport,
    exportNoAssignmentShiftReport
} from "./hoursReport.js";
import {
    initHoursCharts,
    renderHoursCharts
} from "./hoursCharts.js";
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
    renderWorkerRequestsPanel,
    startWorkerRequestsRealtimeSync,
    stopWorkerRequestsRealtimeSync
} from "./workerRequests.js";
import {
    createReplacementContractMemoTask,
    renderMemosPanel
} from "./memos.js";
import {
    addReplacementContract,
    formatContractDate,
    getContractsForProfile
} from "./contracts.js";
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
    validarCantidadLegalAnual
} from "./leaveEngine.js";

const PROFILE_MODE = {
    VIEW: "view",
    CREATE: "create",
    EDIT: "edit"
};

const THEME_KEY = "proturnos_theme";

let selectionMode = null;
let adminCantidad = 0;
let compCantidad = 0;
let legalCantidad = 0;
let licenseCantidad = 0;
let licenseType = "license";
let availabilityEditMode = false;
let profileRotationMiniDate = new Date();
let profileHoursSummaryRequest = 0;
let clockMarksRenderRequest = 0;
let reportsDetailRequest = 0;
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
    shiftAssigned: false
};

window.selectionMode = null;
window.compCantidad = 0;
window.licenseCantidad = 0;
window.licenseType = "license";
window.pushUndoState = pushHistory;
window.getProfileDraftSelectionKey = () =>
    inputDateToCalendarKey(
        profileDraft.rotationType === "reemplazo"
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
            { name: "year", label: "Ano de egreso", type: "number" }
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
        title: "Anotaciones de merito",
        filterYear: true,
        fields: [
            { name: "date", label: "Fecha", type: "date" },
            { name: "title", label: "Titulo de la anotacion" }
        ],
        fileLabel: "Archivo escaneado"
    },
    {
        key: "demerit",
        title: "Anotaciones de demerito",
        filterYear: true,
        fields: [
            { name: "date", label: "Fecha", type: "date" },
            { name: "title", label: "Titulo de la anotacion" }
        ],
        fileLabel: "Archivo escaneado"
    },
    {
        key: "performance",
        title: "Evaluaciones de desempeno",
        filterYear: true,
        fields: [
            { name: "date", label: "Fecha", type: "date" },
            { name: "detail", label: "Detalle importante", type: "textarea" }
        ],
        fileLabel: "Calificacion escaneada"
    }
];

const recordYearFilters = {};

function keyFromDate(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function parseKey(key) {
    const parts = key.split("-");
    return new Date(
        Number(parts[0]),
        Number(parts[1]),
        Number(parts[2])
    );
}

function parseInputDate(value){
    const parts = value.split("-");
    return new Date(
        Number(parts[0]),
        Number(parts[1]) - 1,
        Number(parts[2])
    );
}

function toISODate(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

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

function getLeaveBalances(
    year = new Date().getFullYear(),
    holidays = getCachedHolidays(year)
) {
    const manual = getManualLeaveBalances(year);
    const calculated = {
        legal: Math.max(0, 15 - contarHabiles(getLegalDays(), year, holidays)),
        admin: Math.max(0, 6 - totalAdministrativosUsados()),
        comp: contarHabiles(getCompDays(), year, holidays)
    };

    return {
        legal: withManualBalance(manual.legal, calculated.legal),
        admin: withManualBalance(manual.admin, calculated.admin),
        comp: withManualBalance(manual.comp, calculated.comp),
        hoursReturn: withManualBalance(manual.hoursReturn, 0)
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

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
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
    if (type === "reemplazo") return "Reemplazo";
    return "Sin rotativa";
}

function requiresRotationFirstTurn(type) {
    return type === "3turno" || type === "4turno";
}

function normalizeRotationFirstTurn(value) {
    return String(value || "").toLowerCase() === "noche"
        ? "noche"
        : "larga";
}

function getRotationFirstTurnLabel(value) {
    return normalizeRotationFirstTurn(value) === "noche"
        ? "Noche"
        : "Larga";
}

function getRotationSequence(type, firstTurn = "larga") {
    const startsWithNight =
        normalizeRotationFirstTurn(firstTurn) === "noche";

    if (type === "3turno") {
        return startsWithNight
            ? [2, 2, 0, 0, 1, 1]
            : [1, 1, 2, 2, 0, 0];
    }

    if (type === "4turno") {
        return startsWithNight
            ? [2, 0, 0, 1]
            : [1, 2, 0, 0];
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
        ["estamento", "estamento"],
        ["profession", "profesion"],
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
    const profile = getPerfilActual();

    if (!profile || isProfileActive(profile)) {
        return true;
    }

    alert(
        "Este perfil esta desactivado. Reactivalo desde Perfil para cargar turnos, permisos o modificaciones de calendario."
    );
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
    profileDraft.birthDate = "";
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
    profileDraft.shiftAssigned = false;
}

function loadDraftFromProfile(profile){
    const rotativa = getRotativa(profile.name);
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
    profileDraft.contractType = profile.contractType || "";
    profileDraft.estamento = profile.estamento || "";
    profileDraft.profession = normalizeProfession(
        profile.profession,
        profileDraft.estamento
    );
    profileDraft.grade = String(profile.grade || "");
    profileDraft.rotationType = rotativa.type || "";
    profileDraft.rotationStart = rotationStart;
    profileDraft.rotationFirstTurn =
        normalizeRotationFirstTurn(rotativa.firstTurn);
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
            shiftAssigned: false
        };
    }

    const rotativa = getRotativa(profile.name);

    return {
        name: profile.name,
        email: profile.email || "",
        rut: profile.rut || "",
        phone: profile.phone || "",
        birthDate: profile.birthDate || "",
        docs: Array.isArray(profile.docs) ? profile.docs : [],
        active: isProfileActive(profile),
        unitEntryDate: profile.unitEntryDate || "",
        contractType: profile.contractType || "",
        estamento: profile.estamento,
        profession: profile.profession || "Sin informacion",
        grade: String(profile.grade || ""),
        rotationType: rotativa.type || "",
        rotationStart: normalizeStoredStart(rotativa.start),
        rotationFirstTurn: normalizeRotationFirstTurn(rotativa.firstTurn),
        contractStart: "",
        contractEnd: "",
        contractReplaces: "",
        contractReason: "",
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
            ? `, iniciando con ${getRotationFirstTurnLabel(data.rotationFirstTurn)}`
            : "";

    return `${prefix}${getRotativaLabel(data.rotationType)}${startText}${firstTurnText}.`;
}

function buildRotationStatus(data){
    if (data.rotationType === "reemplazo") {
        if (profileDraft.mode === PROFILE_MODE.VIEW) {
            const profile = getPerfilActual();
            const contracts = profile
                ? getContractsForProfile(profile.name)
                : [];

            if (!contracts.length) {
                return "Rotativa Reemplazo sin contratos registrados.";
            }

            return `Rotativa Reemplazo con ${contracts.length} contrato(s) registrado(s).`;
        }

        if (!data.contractStart) {
            return "Presione el botón para ingresar un nuevo contrato de reemplazo.";
        }

        if (!data.contractEnd) {
            return `Inicio de contrato: ${formatDisplayDate(data.contractStart)}. Falta definir termino en el modal.`;
        }

        return `Contrato de reemplazo: ${formatDisplayDate(data.contractStart)} al ${formatDisplayDate(data.contractEnd)}${data.contractReason ? ` | Motivo: ${data.contractReason}` : ""}.`;
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
        if (profileDraft.rotationType === "reemplazo") {
            return "Completa nombre, estamento, periodo de contrato y a quien reemplaza antes de guardar.";
        }

        return "Completa nombre, estamento, rotativa y configura en el modal desde que fecha inicia antes de guardar.";
    }

    if (profileDraft.mode === PROFILE_MODE.EDIT) {
        if (profileDraft.rotationType === "reemplazo") {
            return "Puedes actualizar los datos del trabajador o agregar un nuevo contrato de reemplazo indicando inicio, termino y a quien reemplaza.";
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

    const canConfigure =
        editing && Boolean(data.rotationType);

    DOM.profileRotationStatus.classList.toggle(
        "profile-status-note--with-action",
        canConfigure
    );

    DOM.profileRotationStatus.innerHTML = `
        <span>${escapeHTML(buildRotationStatus(data))}</span>
        ${canConfigure ? `
            <button id="openRotationConfigBtn" class="profile-status-action" type="button">
                ${data.rotationType === "reemplazo" ? "Nuevo Contrato" : "Configurar rotativa"}
            </button>
        ` : ""}
    `;

    document
        .getElementById("openRotationConfigBtn")
        ?.addEventListener("click", () => {
            openRotationConfigModal(data.rotationType);
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
        normalizeRotationFirstTurn(rotativa?.firstTurn);
    const startText = start
        ? ` desde ${formatDisplayDate(start)}`
        : "";
    const firstTurnText =
        requiresRotationFirstTurn(type) && start
            ? `, inicia con ${getRotationFirstTurnLabel(firstTurn)}`
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
            label: "Profesion"
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
    const source =
        type === "reemplazo"
            ? profileDraft.contractStart ||
                profileDraft.rotationStart
            : profileDraft.rotationStart;
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
    const state = {
        monthDate: getRotationModalMonth(type),
        rotationStart: profileDraft.rotationStart,
        firstTurn: normalizeRotationFirstTurn(
            profileDraft.rotationFirstTurn
        ),
        contractStart: profileDraft.contractStart,
        contractEnd: profileDraft.contractEnd,
        contractReplaces: profileDraft.contractReplaces || "",
        contractReason: profileDraft.contractReason || ""
    };
    const backdrop = document.createElement("div");

    backdrop.className = "turn-change-dialog-backdrop";
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
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
            profileDraft.rotationStart = state.contractStart;
            profileDraft.rotationFirstTurn = "larga";
        } else {
            if (!state.rotationStart) {
                alert("Debes seleccionar desde que fecha comenzara la rotativa.");
                return;
            }

            profileDraft.rotationStart = state.rotationStart;
            profileDraft.rotationFirstTurn =
                requiresRotationFirstTurn(type)
                    ? normalizeRotationFirstTurn(state.firstTurn)
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

            cell.type = "button";
            cell.className = "profile-mini-day is-pickable";
            cell.dataset.key = key;

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
            : requiresRotationFirstTurn(type)
                ? "Selecciona desde que fecha se aplicara la rotativa y si la secuencia comienza con turno Larga o Noche."
                : "Selecciona desde que fecha se aplicara la rotativa escogida.";

        backdrop.innerHTML = `
            <div class="turn-change-dialog rotation-config-dialog" role="dialog" aria-modal="true">
                <strong>${title}</strong>
                <p>${instructions}</p>

                ${requiresRotationFirstTurn(type) ? `
                    <div class="rotation-start-options" aria-label="Turno inicial">
                        <button class="rotation-start-option ${state.firstTurn === "larga" ? "is-selected" : ""}" type="button" data-first-turn="larga">
                            <span>Larga</span>
                            <small>Iniciar con turno de dia</small>
                        </button>
                        <button class="rotation-start-option ${state.firstTurn === "noche" ? "is-selected" : ""}" type="button" data-first-turn="noche">
                            <span>Noche</span>
                            <small>Iniciar con turno nocturno</small>
                        </button>
                    </div>
                ` : ""}

                ${isReplacement ? `
                    <label class="rotation-contract-field">
                        <span>Reemplaza a</span>
                        <input data-contract-replaces type="text" value="${escapeHTML(state.contractReplaces)}" placeholder="Nombre del trabajador reemplazado">
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
                    <strong>${heading}</strong>
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

    backdrop.addEventListener("click", event => {
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
        if (dayButton?.dataset.key) {
            pickDate(dayButton.dataset.key);
            return;
        }

        const firstTurnButton =
            targetElement?.closest("[data-first-turn]");
        if (firstTurnButton) {
            state.firstTurn =
                normalizeRotationFirstTurn(
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

    if (delta) {
        adjustHoursReturnBalance(profileName, year, delta);
    }

    saveHheeReturnTransfer(
        profileName,
        year,
        month,
        {
            ...existing,
            ...hheeReturnTransferPayload(stats, transferredHours),
            enabled: true
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
        DOM.hheeReturnTransferInfo.textContent = enabled
            ? `Mes traspasado: ${formatSaldo(transferHours)} hrs. se suman a devolucion.`
            : `Al activar: ${formatSaldo(transferHours)} hrs. iran a devolucion en vez de pago.`;
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

    if (shouldEnable && transferHours <= 0) {
        alert("Este mes no tiene horas extras positivas para traspasar a devolucion.");
        renderProfileHoursSummary(profile);
        return;
    }

    pushHistory();

    if (shouldEnable) {
        const previousTransferred = existing?.enabled
            ? normalizeBalanceValue(existing.transferredHours)
            : 0;
        const manual =
            getManualLeaveBalances(year, profile.name);
        const baseBalance = existing?.enabled
            ? normalizeBalanceValue(existing.baseBalance)
            : normalizeBalanceValue(manual.hoursReturn);

        adjustHoursReturnBalance(
            profile.name,
            year,
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
                baseBalance
            }
        );

        addAuditLog(
            AUDIT_CATEGORY.LEAVE_ABSENCE,
            "Traspaso HH.EE a devolucion",
            `${profile.name}: ${formatSaldo(stats.hheeDiurnas)}h diurnas y ${formatSaldo(stats.hheeNocturnas)}h nocturnas generan ${formatSaldo(transferHours)} hrs. de devolucion.`,
            {
                profile: profile.name,
                year,
                month,
                transferHours
            }
        );
    } else {
        const currentBalance = normalizeBalanceValue(
            getManualLeaveBalances(year, profile.name).hoursReturn
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
            year,
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
                baseBalance: nextBalance
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
    renderDashboardState();
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

    summary.innerHTML = `
        <div class="summary-context">
            Mes HH.EE visualizado: ${monthLabel}
        </div>
        ${renderSummaryHTML(stats)}
    `;

    if (records) {
        records.innerHTML = `
            <div class="hhee-records-context">
                ${escapeHTML(profile.name)} | ${monthLabel}
            </div>
            ${renderReplacementLogHTML(profile.name, y, m, holidays)}
        `;
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
    const isReplacementRotation =
        displayedRotationType === "reemplazo";
    const selectedKey = inputDateToCalendarKey(
        isReplacementRotation
            ? profileDraft.contractStart
            : profileDraft.rotationStart
    );
    const contractEndKey =
        inputDateToCalendarKey(profileDraft.contractEnd);
    const editing = isProfileEditing();
    const canPick = editing && Boolean(displayedRotationType);
    const existingContracts =
        isReplacementRotation && profile
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

        if (selectedKey === key) {
            cell.classList.add("is-selected");
        }

        if (isReplacementRotation) {
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

        if (canPick) {
            cell.classList.add("is-pickable");
        } else {
            cell.disabled = true;
        }

        aplicarClaseTurno(cell, state);
        cell.innerHTML = `
            <span>${d}</span>
            <small>${
                isReplacementRotation
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
                    isReplacementRotation
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
                if (profileDraft.rotationType === "reemplazo") {
                    handleContractDatePick(button.dataset.key);
                    return;
                }

                const date = parseKey(button.dataset.key);

                profileDraft.rotationStart = toInputDate(date);
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
                <span>Ano</span>
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

    const saldos = getLeaveBalances();
    const year = new Date().getFullYear();
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
                Editando saldos vigentes del ano ${year}.
            </div>
        `;

        return;
    }

    DOM.availabilitySummary.innerHTML = `
        <div class="availability-list" style="--availability-columns: ${showCompBalance ? 4 : 3};">
            <div class="availability-item">
                <span>FL</span>
                <strong>${formatSaldo(saldos.legal)} dias</strong>
            </div>

            ${showCompBalance ? `
                <div class="availability-item">
                    <span>FC</span>
                    <strong>${formatSaldo(saldos.comp)} reg.</strong>
                </div>
            ` : ""}

            <div class="availability-item">
                <span>ADM</span>
                <strong>${formatSaldo(saldos.admin)} dias</strong>
            </div>

            <div class="availability-item availability-item--wide">
                <span>Horas para devoluci\u00f3n</span>
                <strong>${formatSaldo(saldos.hoursReturn)} hrs.</strong>
            </div>
        </div>

        <div class="availability-note">
            Saldos vigentes del ano ${year}.
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

    const saldos = getLeaveBalances();

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
    DOM.unpaidLeaveBtn.disabled = false;
    DOM.hoursReturnBtn.disabled = saldos.hoursReturn <= 0;
    DOM.unjustifiedAbsenceBtn.disabled = false;
    DOM.clockMarkBtn.disabled = false;
}

function renderDashboardState() {
    const profile = getPerfilActual();
    const data = getDisplayedProfileData();
    const editing = isProfileEditing();

    syncTopProfileSearch();

    DOM.profileNameInput.value = data.name || "";
    DOM.profileEmailInput.value = data.email || "";
    DOM.profileRutInput.value = data.rut || "";
    syncRutValidity(false);
    DOM.profilePhoneInput.value = data.phone || "";
    DOM.profileBirthDateInput.value = data.birthDate || "";
    DOM.profileUnitEntryDateInput.value = data.unitEntryDate || "";
    DOM.profileContractTypeSelect.value = data.contractType || "";
    DOM.profileRoleSelect.value = data.estamento || "";
    syncProfileProfessionField(data, editing);
    DOM.profileGradeSelect.value = data.grade || "";
    DOM.profileRotationSelect.value = data.rotationType || "";
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

    const isReplacementRotation =
        data.rotationType === "reemplazo";

    if (DOM.replacementContractEditor) {
        DOM.replacementContractEditor.classList.toggle(
            "hidden",
            !isReplacementRotation
        );
    }

    if (DOM.replacementTargetInput) {
        DOM.replacementTargetInput.value =
            data.contractReplaces || "";
        DOM.replacementTargetInput.disabled =
            !editing || !isReplacementRotation;
    }

    if (DOM.replacementReasonSelect) {
        DOM.replacementReasonSelect.value =
            data.contractReason || "";
        DOM.replacementReasonSelect.disabled =
            !editing || !isReplacementRotation;
    }

    if (DOM.replacementContractStatus) {
        if (!isReplacementRotation) {
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

    renderProfileRotationStatus(data, editing);
    renderContractHistory(profile);
    renderProfileHoursSummary(profile);
    renderProfileDocs(data, editing);
    renderProfileRecords(profile, editing);
    renderHheeProfiles();
    renderReportsProfiles();

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
        profileDraft.mode === PROFILE_MODE.EDIT;

    DOM.openEditProfileBtn.disabled =
        profileDraft.mode === PROFILE_MODE.CREATE ||
        (!profile && profileDraft.mode !== PROFILE_MODE.EDIT);

    syncHoursMonthControls(
        document.body.dataset.activeView === "hours"
    );

    if (DOM.printHoursReportBtn) {
        DOM.printHoursReportBtn.disabled =
            !profile || profileDraft.mode === PROFILE_MODE.CREATE;
    }

    renderLeaveActionLabels();
    renderDisponibilidadVacaciones();
    if (typeof window.renderStaffingMedicalChart === "function") {
        window.renderStaffingMedicalChart();
    }
    syncTurnosSidePanelHeight();
    if (document.body.dataset.activeView === "hours") {
        renderHoursCharts(profile);
    }
    updateHistoryNavState();
    updateTurnChangesNavState();
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
    const disabled =
        !turnChangeConfig.allowSwaps ||
        !currentProfile ||
        !isProfileActive(currentProfile) ||
        rotativa.type === "diurno";

    button.disabled = disabled;
    button.classList.toggle("is-disabled", disabled);
    button.title = disabled
        ? (
            !turnChangeConfig.allowSwaps
                ? "Cambios de turno desactivados en Ajustes del sistema."
                : "Cambios de turno no disponible para perfiles desactivados o con rotativa Diurno."
        )
        : "";

    if (
        disabled &&
        document.body.dataset.activeView === "swap"
    ) {
        setActiveShortcut("calendarPanel");
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

    if (targetId === "clockMarksPanel") {
        return "clockmarks";
    }

    if (targetId === "auditLogPanel") {
        return "log";
    }

    if (targetId === "staffingPanel") {
        return "staffing";
    }

    if (targetId === "staffingWeeklyCalendar") {
        return "weekly";
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

function setDashboardView(view) {
    document.body.dataset.activeView = view;
    syncTurnosSidePanelHeight();
}

function setActiveShortcut(targetId) {
    const nextView = getViewForTarget(targetId);

    if (nextView === "profile" && selectionMode) {
        clearSelectionMode(false);
    }

    setDashboardView(nextView);

    if (nextView === "hours") {
        syncHoursMonthControls(true);
        renderHheeProfiles();
        renderHoursCharts(getPerfilActual());
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
        renderReportsProfiles();
    }

    if (nextView === "clockmarks") {
        syncClockMarksMonthFromCurrent();
        renderClockMarksPanel();
    }

    if (nextView === "staffing") {
        renderStaffingPanel();
    }

    if (nextView === "weekly") {
        renderStaffingWeeklyCalendar();
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
}

function renderProfiles() {
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
    const query =
        DOM.profileSearch.value
            .trim()
            .toLowerCase();

    DOM.profiles.innerHTML = "";

    const visibles = profiles.filter(profile => {
        const matchActive =
            showInactive || isProfileActive(profile);
        const matchRole =
            filtro === "Todos" ||
            profile.estamento === filtro;

        const matchSearch =
            !query ||
            profile.name.toLowerCase().includes(query) ||
            profile.estamento.toLowerCase().includes(query) ||
            formatProfession(profile.profession).toLowerCase().includes(query) ||
            String(profile.email || "").toLowerCase().includes(query) ||
            String(profile.rut || "").toLowerCase().includes(query);

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

    renderDashboardState();
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
    });

    return `PLANILLA "${month.toUpperCase()}"`;
}

async function renderReportsDetail() {
    if (!DOM.reportsSelectedInfo) return;

    const requestId = ++reportsDetailRequest;
    const profile = getPerfilActual();

    if (!profile) {
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
    const rotationStatus = [
        getRotativaLabel(rotativa.type),
        hasShiftAssigned
            ? "con asignaci\u00f3n de turno"
            : "sin asignaci\u00f3n de turno"
    ].join(" ");
    const canShowFourthShiftReport =
        isFourthShiftNoAssignmentProfile(profile.name);

    DOM.reportsSelectedInfo.innerHTML = `
        <span>Trabajador seleccionado</span>
        <strong>${escapeHTML(profile.name)}</strong>
        <small>${escapeHTML(getProfileMetaLabel(profile))} | ${escapeHTML(rotationStatus)}</small>
    `;

    DOM.report4TurnoNoAssignmentCard?.classList.toggle(
        "hidden",
        !canShowFourthShiftReport
    );

    if (DOM.report4TurnoNoAssignmentTitle) {
        DOM.report4TurnoNoAssignmentTitle.textContent =
            canShowFourthShiftReport
                ? formatReportPlanillaTitle(currentDate)
                : "";
    }

    if (DOM.downloadNoAssignmentReportBtn) {
        DOM.downloadNoAssignmentReportBtn.onclick = () =>
            exportNoAssignmentShiftReport(profile, currentDate);
    }

    if (DOM.report4TurnoNoAssignmentPreview) {
        DOM.report4TurnoNoAssignmentPreview.innerHTML =
            canShowFourthShiftReport
                ? `<div class="empty-state empty-state--compact">Calculando detalle mensual...</div>`
                : "";
    }

    if (DOM.reportsUnavailableHint) {
        DOM.reportsUnavailableHint.classList.toggle(
            "hidden",
            canShowFourthShiftReport
        );
        DOM.reportsUnavailableHint.textContent =
            canShowFourthShiftReport
                ? ""
                : `No hay reportes espec\u00edficos para este perfil. El archivo "${FOURTH_SHIFT_NO_ASSIGNMENT_REPORT_LABEL}" aparece cuando el trabajador tiene rotativa 3er o 4\u00b0 Turno y no tiene Asignaci\u00f3n de Turno.`;
    }

    if (!canShowFourthShiftReport || !DOM.report4TurnoNoAssignmentPreview) {
        return;
    }

    try {
        const html = await buildNoAssignmentReportPreviewHTML(
            profile,
            currentDate
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

function renderReportsProfiles() {
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

        item.onclick = () => {
            selectProfileByName(profile.name, {
                scrollToTop: true
            });
            setActiveShortcut("reportsPanel");
            renderReportsProfiles();
        };

        DOM.reportsProfiles.appendChild(item);
    });

    renderReportsDetail();
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
        DOM.clockMarksSubtitle.textContent = showAll
            ? `Mostrando registros de todos los colaboradores en ${formatMonthHeading(monthDate)}.`
            : currentProfile
                ? `Mostrando registros de ${currentProfile} en ${formatMonthHeading(monthDate)}.`
                : "Selecciona un colaborador para revisar sus marcajes.";
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
    return String(value || "")
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
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
    renderProfiles();
    renderBotones();

    if (options.openProfile) {
        setActiveShortcut("profileSection");
    }

    if (options.openTurns) {
        setActiveShortcut("calendarPanel");
    }

    refreshAll();

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
    compCantidad = 0;
    window.compCantidad = 0;
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
    const profile = getProfiles().find(item =>
        item.name === profileName
    );

    if (!profile) return;

    clearSelectionMode(false);
    availabilityEditMode = false;
    setCurrentProfile(profileName);
    loadDraftFromProfile(profile);
    profileDraft.mode = PROFILE_MODE.EDIT;
    profileDraft.rotationType = "reemplazo";
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
    profileDraft.contractStart = "";
    profileDraft.contractEnd = "";
    profileDraft.contractReplaces = "";
    profileDraft.contractReason = "";

    if (!profileDraft.rotationType) {
        clearSelectionMode(false);
        renderDashboardState();
        refreshAll();
        return;
    }

    renderDashboardState();
    setActiveShortcut("profileSection");
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
    if (profileDraft.rotationType !== "reemplazo") {
        return false;
    }

    if (profileDraft.mode === PROFILE_MODE.CREATE) {
        return true;
    }

    if (hasRotationChanged()) {
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
    const requiresRotationStart =
        profileDraft.mode === PROFILE_MODE.CREATE ||
        hasRotationChanged();
    const rutMessage =
        getRutValidationMessage(profileDraft.rut);

    if (!profileDraft.name.trim()) missing.push("nombre");
    if (!profileDraft.estamento) missing.push("estamento");
    if (!profileDraft.rotationType) missing.push("rotativa");
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

    if (
        profileDraft.rotationType !== "reemplazo" &&
        requiresRotationStart &&
        !profileDraft.rotationStart
    ) {
        missing.push("fecha de inicio de rotativa");
    }

    if (
        profileDraft.rotationType !== "reemplazo" &&
        requiresRotationStart &&
        requiresRotationFirstTurn(profileDraft.rotationType) &&
        !profileDraft.rotationFirstTurn
    ) {
        missing.push("turno inicial de rotativa");
    }

    if (
        profileDraft.rotationType === "reemplazo" &&
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
    firstTurn = "larga"
) {
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
    const nextRotationType =
        profileDraft.rotationType;
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
        estamento: nextEstamento,
        profession: nextProfession,
        grade: profileDraft.grade
    };
    const nextRotationStart =
        nextRotationType === "reemplazo"
            ? (
                profileDraft.contractStart ||
                profileDraft.rotationStart
            )
            : profileDraft.rotationStart;
    const nextRotationFirstTurn =
        normalizeRotationFirstTurn(profileDraft.rotationFirstTurn);
    const shouldApplyRotation =
        profileDraft.mode === PROFILE_MODE.CREATE ||
        hasRotationChanged();
    const shouldSaveReplacementContract =
        nextRotationType === "reemplazo" &&
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
            }
        }

        exitProfileMode(nextName);
        if (shouldApplyRotation) {
            await applyDraftRotation(
                nextRotationType,
                nextRotationStart,
                nextRotationFirstTurn
            );

            addAuditLog(
                AUDIT_CATEGORY.CALENDAR,
                "Aplico rotativa base",
                `${nextName}: ${getRotativaLabel(nextRotationType)} desde ${formatDisplayDate(nextRotationStart)}${requiresRotationFirstTurn(nextRotationType) ? ` iniciando con ${getRotationFirstTurnLabel(nextRotationFirstTurn)}` : ""}. Se limpiaron programaciones futuras desde esa fecha.`,
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
        alert("No quedan dias de feriado legal.");
        return;
    }

    const cantidad = await openAmountDialog({
        title: "F. Legal",
        subtitle: "Indica cuantos dias de feriado legal deseas cargar.",
        label: "Dias de F. Legal",
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

    activarModo(
        "legal",
        "Selecciona un dia habil para iniciar el feriado legal. Los dias inhabiles y ausencias incompatibles quedaran bloqueados."
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
        `Selecciona un dia habil para iniciar el bloque completo de ${formatSaldo(cantidad)} F. Compensatorio. Deben haber pasado 90 dias corridos desde el ultimo F. Legal.`
    );
}

function getLicenseTypeLabel(type) {
    if (type === "professional_license") return "LM Profesional";
    if (type === "unpaid_leave") return "Permiso sin Goce";
    return "Licencia Medica";
}

function openAmountDialog({
    title,
    subtitle,
    label = "Cantidad de dias",
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
                ? "Cubrir todo el turno con devolucion de horas."
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
                alert("Modifica la entrada o salida para usar horas de devolucion.");
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

    const label = getLicenseTypeLabel(type);
    const cantidad = await openAmountDialog({
        title: label,
        subtitle: "Indica cuantos dias corridos dura la ausencia.",
        label: "Dias corridos",
        confirmText: "Continuar"
    });

    if (!cantidad || cantidad <= 0) return;

    licenseCantidad = cantidad;
    licenseType = type;
    window.licenseCantidad = cantidad;
    window.licenseType = type;

    activarModo(
        "license",
        `Selecciona el inicio de ${getLicenseTypeLabel(type)}. Se contara en dias corridos.`
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
            `Saldo insuficiente. El saldo disponible (${formatSaldo(saldo)}) solo permite aplicar 1/2 ADM Manana o 1/2 ADM Tarde.`
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
    const saldo = getLeaveBalances(year, holidays).hoursReturn;

    if (saldo <= 0) {
        alert("No hay horas disponibles para devolucion.");
        return;
    }

    activarModo(
        "hoursreturn",
        `Selecciona un turno base para aplicar devolucion de horas. Saldo disponible: ${formatSaldo(saldo)} hrs.`
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
        "Solo quedan habilitados los dias con turno real del trabajador. Puedes marcar varios turnos y presionar Cancelar para terminar.";
}

function activarSelectorMarcajeReloj() {
    if (!canModifyCurrentProfile()) return;

    activarModo(
        "clockmark",
        "Selecciona en el calendario el turno donde modificaras el marcaje de entrada o salida."
    );

    DOM.adminInfo.textContent =
        "Solo quedan habilitados los dias con turno real y sin vacaciones o ausencias.";
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
        alert("Selecciona un dia con turno base para aplicar la devolucion de horas.");
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
        alert("Este turno ya tiene una devolucion de horas aplicada.");
        clearSelectionMode();
        return;
    }

    const balance =
        getLeaveBalances(fecha.getFullYear(), holidays).hoursReturn;

    if (balance <= 0) {
        alert("No hay horas disponibles para devolucion.");
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
        "Aplico devolucion de horas",
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
        alert("Selecciona un dia que tenga turno para modificar sus marcajes.");
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

    DOM.profileBirthDateInput.onchange = () => {
        if (!isProfileEditing()) return;
        profileDraft.birthDate = DOM.profileBirthDateInput.value;
    };

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
    };

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
        "staffingShowInactiveProfiles",
        "swapShowInactiveProfiles",
        "clockMarksShowInactiveProfiles"
    ].forEach(id => {
        const input = document.getElementById(id);

        if (input) {
            input.checked = false;
        }
    });
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
                const target = document.getElementById(
                    button.dataset.target
                );

                if (!target) return;

                setActiveShortcut(button.dataset.target);
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
DOM.unpaidLeaveBtn.onclick =
    () => activarSelectorLicencia("unpaid_leave");
DOM.hoursReturnBtn.onclick = activarSelectorDevolucionHoras;
DOM.unjustifiedAbsenceBtn.onclick =
    activarSelectorAusenciaInjustificada;
DOM.clockMarkBtn.onclick = activarSelectorMarcajeReloj;

DOM.prevBtn.onclick = prevMonth;
DOM.nextBtn.onclick = nextMonth;

DOM.undoBtn.onclick = () => {
    if (undo()) {
        addAuditLog(
            AUDIT_CATEGORY.CALENDAR,
            "Deshizo ultima accion",
            "El usuario revirtio el ultimo cambio guardado en el historial."
        );
        refreshAll();
    }
};

DOM.redoBtn.onclick = () => {
    if (redo()) {
        addAuditLog(
            AUDIT_CATEGORY.CALENDAR,
            "Rehizo ultima accion",
            "El usuario reaplico el ultimo cambio revertido en el historial."
        );
        refreshAll();
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
                "No se pudo aplicar esta ausencia. Una Licencia Medica solo puede reemplazarse por una LM Profesional y viceversa; el Permiso sin Goce no puede superponerse sobre licencias existentes."
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
                "No se pudo aplicar la ausencia injustificada. Solo puede marcarse sobre dias con turno real y sin permisos, feriados o licencias ya cargadas."
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
                "No se pudo aplicar el F. Compensatorio. Debe iniciar en un dia habil, haber pasado 90 dias corridos desde el ultimo F. Legal y el bloque completo no puede cruzarse con licencias, feriados legales, permisos administrativos, medios ADM, permisos sin goce u otros bloqueos incompatibles."
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
                "No se pudo aplicar el F. Legal en esa fecha. Revisa que el inicio sea habil, que hayan pasado 90 dias desde el ultimo F. Compensatorio y que el rango no tenga ausencias incompatibles."
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
    renderWorkerRequestsPanel();
    refreshAll();
    renderDashboardState();
});

window.addEventListener("proturnos:memosChanged", () => {
    renderMemosPanel();
});

window.addEventListener("proturnos:auditUndoApplied", () => {
    refreshAll();
    renderStaffingPanel();
    renderDashboardState();
});

initTheme();
initTurnosSidePanelSync();
initSystemSettings({
    button: DOM.systemSettingsBtn,
    onSaved: () => {
        refreshAll();
        renderStaffingPanel();
        renderDashboardState();
    }
});
initFirebaseShell({
    userChip: DOM.authUserChip,
    userName: DOM.authUserName,
    onAuthChange: user => {
        if (!user) {
            stopFirebaseAppStateSync();
        }

        if (document.body.dataset.activeView === "kanban") {
            renderKanbanBoard();
        }
    },
    onWorkspaceChange: workspace => {
        if (workspace?.id) {
            startWorkerRequestsRealtimeSync(workspace);
            startFirebaseAppStateSync(workspace, {
                onChange: () => {
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

                    renderProfiles();
                    renderBotones();
                    renderSwapPanel();
                    renderWorkerRequestsPanel();
                    renderMemosPanel();
                    renderStaffingPanel();
                    if (document.body.dataset.activeView === "tasks") {
                        renderTaskAssignmentsPanel();
                    }
                    if (document.body.dataset.activeView === "kanban") {
                        renderKanbanBoard();
                    }
                    refreshAll();
                    renderDashboardState();
                }
            });
        } else {
            stopWorkerRequestsRealtimeSync();
            stopFirebaseAppStateSync();
        }

        refreshAll();
        if (document.body.dataset.activeView === "tasks") {
            renderTaskAssignmentsPanel();
        }
        if (document.body.dataset.activeView === "kanban") {
            renderKanbanBoard();
        }
        renderDashboardState();
    }
});
bindProfileForm();
initializeInactiveProfileToggles();
bindShellInteractions();
initHoursCharts(getPerfilActual);
renderStaffingPanel();
renderSwapPanel();
renderWorkerRequestsPanel();
renderMemosPanel();
renderProfiles();
renderBotones();

if (getProfiles().length > 0) {
    setActiveShortcut("calendarPanel");
    refreshAll();
} else {
    setActiveShortcut("profileSection");
    renderDashboardState();
    refreshAll();
}
