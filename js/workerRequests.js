import { keyFromDate } from "./dateUtils.js";
import { escapeHTML } from "./htmlUtils.js";
import { TURNO_LABEL } from "./constants.js";
import { pushHistory } from "./history.js";
import {
    AUDIT_CATEGORY,
    addAuditLog,
    getAuditLogs,
    undoAuditLogEntry
} from "./auditLog.js";
import {
    getCurrentFirebaseUser,
    getFirebaseServices,
    isFirebaseConfigured
} from "./firebaseClient.js";
import {
    acceptWorkspaceLink,
    chooseWorkspaceForLink,
    isOwnerPendingWorkspaceLink,
    listWorkspaceLinks,
    rejectWorkspaceLink,
    workspaceLinkDisplayName
} from "./firebaseLinkedUnits.js";
import {
    approveSupervisorInvitation,
    getActiveWorkspace,
    listSupervisorInvitations,
    rejectSupervisorInvitation
} from "./workspaces.js";
import { isWorkspaceOwner } from "./workspacePermissions.js";
import { cancelReplacementRequest } from "./replacements.js";
import { showConfirm } from "./dialogs.js";
import {
    formatInviteDate,
    showSupervisorInvitePermissionsDialog,
    supervisorInviteActor
} from "./supervisorInvitesUI.js";
import {
    getCurrentProfile,
    getManualLeaveBalances,
    getProfiles,
    getReplacementRequests,
    getWorkerRequests,
    saveManualLeaveBalances,
    saveWorkerRequests,
    setCurrentProfile
} from "./storage.js";
import {
    aplicarAdministrativo,
    aplicarComp,
    aplicarHalfAdministrativo,
    aplicarLegal,
    aplicarLicencia
} from "./leaveEngine.js";
import { createClockMemoTask } from "./memos.js";
import { openCachedAttachment } from "./attachmentCache.js";
import {
    canSwapProfiles,
    getSwapDateBlockReason,
    getSwapTurnState,
    registrarCambio
} from "./swaps.js";
import {
    getWorkerAppLinkForProfile,
    notifyWorkerApp
} from "./workerAppDataSync.js";
import { buildWorkerReportPreviewHTML } from "./hoursReport.js";
import { normalizeText } from "./stringUtils.js";

const REQUEST_TYPE_LABELS = {
    admin: "P. Administrativo",
    half_admin_morning: "1/2 ADM Ma\u00f1ana",
    half_admin_afternoon: "1/2 ADM Tarde",
    legal: "F. Legal",
    comp: "F. Compensatorio",
    union_leave: "Permiso Gremial",
    unpaid_leave: "Permiso sin Goce",
    missing_clock: "Olvido de Marcacion",
    clock_incident: "Incidencia en Marcacion",
    swap: "Cambio de Turno",
    replacement_request: "Turno Extra",
    hhee_return: "Devolución de Horas",
    leave_cancel: "Anulación de permiso",
    report_request: "Informe mensual",
    workspace_link: "Enlace de Unidad",
    supervisor_invite: "Acceso Supervisor",
    unknown: "Solicitud"
};

const MONTH_NAMES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

function monthLabelFromYearMonth(year, month) {
    const y = Number(year);
    const m = Number(month);

    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 0 || m > 11) {
        return "";
    }

    return `${MONTH_NAMES[m]} de ${y}`;
}

function formatReturnHours(value) {
    const parsed = Number(value) || 0;
    const rounded = Math.round(parsed * 100) / 100;

    return Number.isInteger(rounded)
        ? String(rounded)
        : String(rounded).replace(".", ",");
}

const STATUS_LABELS = {
    pending: "Pendiente",
    accepted: "Aceptada",
    rejected: "Rechazada",
    canceled: "Anulada",
    expired: "Expirada"
};

let selectedStatus = "pending";
let selectedMonth = monthValue();
let unsubscribeSupervisorInviteRequests = null;
let unsubscribeWorkspaceLinkRequests = [];
let activeSupervisorInviteWorkspaceId = "";
let supervisorInviteListenerVersion = 0;

// El traspaso de HH.EE a devolucion vive en main.js (depende de helpers de
// saldo y estadisticas que estan alli). main.js registra aqui el manejador para
// que aceptar una solicitud "hhee_return" active el traspaso del mes pedido.
let hheeReturnRequestHandler = null;

export function setHheeReturnRequestHandler(handler) {
    hheeReturnRequestHandler =
        typeof handler === "function" ? handler : null;
}

function parseISODate(value) {
    const match = String(value || "")
        .match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);

    if (!match) return null;

    return new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3])
    );
}

function isoFromDate(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function formatDate(value) {
    const date = parseISODate(value);

    if (!date) return "Sin fecha";

    return date.toLocaleDateString("es-CL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    });
}

function formatTimestamp(value) {
    const source = value?.toDate?.() || value;
    const date = new Date(source);

    if (Number.isNaN(date.getTime())) return "Sin fecha";

    return date.toLocaleString("es-CL", {
        dateStyle: "short",
        timeStyle: "short"
    });
}

function monthValue(date = new Date()) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0")
    ].join("-");
}

function requestMonthValue(request = {}) {
    const source =
        request.createdAt ||
        request.date ||
        request.changeDate ||
        request.returnDate;
    const date = source?.toDate?.() || new Date(source);

    if (Number.isNaN(date.getTime())) return "";

    return monthValue(date);
}

function filterRequestsBySelectedMonth(requests) {
    if (!selectedMonth) {
        selectedMonth = monthValue();
    }

    return requests.filter(request =>
        requestMonthValue(request) === selectedMonth
    );
}

function requestTypeLabel(type) {
    return REQUEST_TYPE_LABELS[type] || REQUEST_TYPE_LABELS.unknown;
}

function statusLabel(status) {
    return STATUS_LABELS[status] || status || "Pendiente";
}

function displayStatusLabel(request) {
    if (isSupervisorInviteRequest(request)) {
        return request.statusLabel || statusLabel(request.status);
    }

    if (isReplacementRequest(request) && request.status === "pending") {
        return "Enviada";
    }

    if (
        !isWorkspaceLinkRequest(request) &&
        request.source === "worker_app" &&
        request.status === "pending"
    ) {
        return "Solicitud recibida";
    }

    return statusLabel(request.status);
}

function timestampISO(value) {
    const date = value?.toDate?.() || new Date(value);

    if (!date || Number.isNaN(date.getTime())) {
        return new Date().toISOString();
    }

    return date.toISOString();
}

function isWorkspaceLinkRequest(request = {}) {
    return request.kind === "workspace_link";
}

function isSupervisorInviteRequest(request = {}) {
    return request.kind === "supervisor_invite";
}

function isReplacementRequest(request = {}) {
    return request.kind === "replacement_request";
}

function supervisorInvitePanelStatus(status) {
    if (status === "claimed") return "pending";
    if (status === "approved") return "accepted";
    if (status === "rejected") return "rejected";
    if (status === "revoked") return "canceled";
    if (status === "expired") return "expired";
    return "";
}

const CALENDAR_REVIEW_REQUEST_TYPES = new Set([
    "admin",
    "half_admin_morning",
    "half_admin_afternoon",
    "legal",
    "comp",
    "union_leave",
    "unpaid_leave"
]);

function requestCalendarDate(request = {}) {
    return (
        request.date ||
        request.startDate ||
        request.changeDate ||
        request.returnDate ||
        ""
    );
}

function canViewRequestInCalendar(request = {}) {
    return (
        request.status === "pending" &&
        CALENDAR_REVIEW_REQUEST_TYPES.has(request.type) &&
        Boolean(resolveProfileName(request)) &&
        Boolean(parseISODate(requestCalendarDate(request)))
    );
}

function replacementRequestToPanelRequest(request = {}) {
    return {
        ...request,
        kind: "replacement_request",
        type: "replacement_request",
        profile: request.worker || "Trabajador",
        date: request.date || "",
        note: [
            request.turnoLabel
                ? `Turno solicitado: ${request.turnoLabel}`
                : "",
            request.replaced
                ? `Cubre a: ${request.replaced}`
                : "",
            request.absenceType
                ? `Motivo: ${request.absenceType}`
                : "",
            request.channel === "app"
                ? "Canal: app trabajador"
                : "Canal: WhatsApp"
        ].filter(Boolean).join(" | ")
    };
}

function requestDays(request, fallback = 1) {
    const days = Number(request.days);

    return Number.isFinite(days) && days > 0
        ? days
        : fallback;
}

function normalizeCompensatoryBlockAmount(value) {
    const amount = Number(value);

    if (amount === 10 || amount === 20) return amount;
    return 0;
}

function normalizeBalanceValue(value) {
    return Math.round(Number(value || 0) * 10) / 10;
}

function decrementManualBalance(profile, field, amount, year) {
    const manual = getManualLeaveBalances(year, profile);
    const currentValue = Number(manual[field]);

    if (!Number.isFinite(currentValue)) return;

    saveManualLeaveBalances(
        year,
        {
            ...manual,
            [field]: Math.max(
                0,
                normalizeBalanceValue(currentValue - amount)
            )
        },
        profile
    );
}

async function withProfile(profile, task) {
    const previousProfile = getCurrentProfile();

    setCurrentProfile(profile);

    try {
        return await task();
    } finally {
        setCurrentProfile(previousProfile);
    }
}

// Copia local (igual que en workerAppDataSync) para no arrastrar el lector de
// Excel de attendanceImport solo por normalizar un RUT.
function normalizeRut(value) {
    return String(value || "")
        .replace(/[^0-9kK]/g, "")
        .toUpperCase();
}

// El nombre que trae la solicitud es el que la PWA copio de workerLinks al
// enviarla, y puede estar desfasado del perfil real: si el perfil se renombro
// (o se corrigio un typo o el uso de mayusculas) despues de enlazar al
// trabajador, workerLinks.profileName se queda con el nombre viejo.
//
// Ese nombre NO se puede usar tal cual: todo el almacenamiento por trabajador
// se indexa por nombre ("legal_<NOMBRE>", "data_<NOMBRE>"...) y
// setCurrentProfile acepta cualquier texto, asi que aceptar una solicitud con
// el nombre viejo escribia el permiso en un perfil fantasma sin dar ningun
// error: quedaba en el LOG como aceptada y nunca aparecia en el calendario.
//
// Por eso resolvemos SIEMPRE contra los perfiles que existen, con la misma
// tolerancia que findProfileForLink (RUT primero, luego nombre normalizado), y
// devolvemos "" si no calza ninguno, para que quien aplique la solicitud falle
// con un mensaje visible en vez de escribir en el vacio.
function resolveProfileName(request) {
    const profiles = getProfiles();
    const requestedName = String(request.profile || "");

    if (requestedName) {
        const exactMatch = profiles.find(profile =>
            profile.name === requestedName
        );

        if (exactMatch) return exactMatch.name;
    }

    const requestedRut = normalizeRut(request.profileRut);

    if (requestedRut) {
        const rutMatch = profiles.find(profile =>
            normalizeRut(profile.rut) === requestedRut
        );

        if (rutMatch) return rutMatch.name;
    }

    if (requestedName) {
        const normalizedName = normalizeText(requestedName);
        const nameMatch = profiles.find(profile =>
            normalizeText(profile.name) === normalizedName
        );

        if (nameMatch) return nameMatch.name;
    }

    if (request.profileId) {
        return profiles.find(profile =>
            profile.id === request.profileId
        )?.name || "";
    }

    return "";
}

function requestNeedsDate(request) {
    return !["swap", "hhee_return", "report_request"].includes(request.type);
}

function invalidDateResult(request) {
    if (!requestNeedsDate(request)) {
        return null;
    }

    const date = parseISODate(request.date);

    if (!date) {
        return {
            ok: false,
            message: "La solicitud no tiene una fecha valida."
        };
    }

    return null;
}

const LEAVE_CANCEL_TYPES = new Set([
    "admin",
    "half_admin_morning",
    "half_admin_afternoon",
    "legal",
    "comp",
    "union_leave",
    "unpaid_leave"
]);

// Ubica el registro del LOG del permiso aplicado (perfil + fecha de inicio +
// tipo), para poder anularlo. Debe ser UNICO y no estar ya anulado; si hay 0 o
// varios coincidentes, se prefiere que el supervisor lo anule a mano (no se
// arriesga a revertir el permiso equivocado).
function leaveLogCoversDate(log, iso) {
    const start = String(log.meta?.date || "");
    if (!start) return false;

    const amount = Math.max(1, Math.ceil(Number(log.meta?.amount) || 1));
    const startTime = Date.parse(`${start}T00:00:00`);
    const target = Date.parse(`${iso}T00:00:00`);

    if (Number.isNaN(startTime) || Number.isNaN(target)) return false;

    // Rango en dias calendario desde el inicio. Aproximado para permisos por dias
    // habiles (legal/comp saltan fines de semana), por eso es solo un FALLBACK con
    // guarda de "exactamente uno".
    const endTime = startTime + (amount - 1) * 86400000;
    return target >= startTime && target <= endTime;
}

function findLeaveApplicationLog(profile, dayIso, leaveType) {
    const target = String(profile || "").trim().toLowerCase();
    const date = String(dayIso || "");
    const type = String(leaveType || "");

    if (!target || !date || !type) return null;

    const leaveLogs = getAuditLogs().filter(log =>
        log.category === AUDIT_CATEGORY.LEAVE_ABSENCE &&
        !log.canceledAt &&
        String(log.profile || log.meta?.profile || "").trim().toLowerCase() === target &&
        String(log.meta?.type || "") === type
    );

    // 1) Coincidencia exacta por fecha de inicio (permiso de un dia o su dia inicial).
    const exact = leaveLogs.filter(log => String(log.meta?.date || "") === date);
    if (exact.length === 1) return exact[0];

    // 2) Cobertura de rango: el trabajador toco un dia intermedio de un permiso
    //    multi-dia. Solo si hay exactamente un permiso que cubre ese dia.
    const covering = leaveLogs.filter(log => leaveLogCoversDate(log, date));
    if (covering.length === 1) return covering[0];

    return null;
}

// Anula un permiso YA aceptado a pedido del trabajador. Reutiliza la anulacion
// del LOG (undoAuditLogEntry): revierte el calendario del perfil correcto,
// restaura el saldo, cancela los reemplazos asociados y notifica + RE-PUBLICA la
// proyeccion de los afectados (via el listener proturnos:auditUndoApplied), para
// que el permiso desaparezca del calendario de la PWA del trabajador.
async function applyLeaveCancellation(request) {
    const profile = resolveProfileName(request);
    const leaveType = String(request.leaveType || "");

    if (!LEAVE_CANCEL_TYPES.has(leaveType)) {
        return {
            ok: false,
            message: "Tipo de permiso no valido para anular."
        };
    }

    const log = findLeaveApplicationLog(profile, request.date, leaveType);

    if (!log) {
        return {
            ok: false,
            message: "No se encontro el permiso aplicado para anularlo automaticamente (puede haberse anulado o modificado). Anulalo manualmente desde el LOG o el calendario."
        };
    }

    const result = await undoAuditLogEntry(log.id, { source: "worker_cancel" });

    if (!result?.ok) {
        return {
            ok: false,
            message: "No se pudo anular el permiso. Es posible que ya haya cambiado."
        };
    }

    // El permiso original queda "canceled" para que salga del listado de la PWA
    // del trabajador (su calendario y saldos ya se revirtieron via el LOG).
    if (request.originalRequestId) {
        saveUpdatedRequest(request.originalRequestId, {
            status: "canceled",
            canceledAt: new Date().toISOString(),
            canceledReason: "Anulado a pedido del trabajador"
        });
    }

    return { ok: true };
}

async function applyLeaveRequest(request, profile, date) {
    const year = date.getFullYear();
    let applied = false;
    let balanceField = "";
    let balanceAmount = 0;

    pushHistory();

    applied = await withProfile(profile, async () => {
        if (request.type === "admin") {
            const amount = requestDays(request, 1);
            balanceField = "admin";
            balanceAmount = amount;
            return aplicarAdministrativo(date, amount);
        }

        if (request.type === "half_admin_morning") {
            balanceField = "admin";
            balanceAmount = 0.5;
            return aplicarHalfAdministrativo(date, "M");
        }

        if (request.type === "half_admin_afternoon") {
            balanceField = "admin";
            balanceAmount = 0.5;
            return aplicarHalfAdministrativo(date, "T");
        }

        if (request.type === "legal") {
            const amount = requestDays(request, 1);
            balanceField = "legal";
            balanceAmount = amount;
            return aplicarLegal(date, amount);
        }

        if (request.type === "comp") {
            const manual = getManualLeaveBalances(year, profile);
            const availableBlock = normalizeCompensatoryBlockAmount(
                Number(manual.comp) > 0
                    ? Number(manual.comp)
                    : 10
            );
            const requestedBlock = normalizeCompensatoryBlockAmount(
                requestDays(request, availableBlock || 10)
            );
            const amount = requestedBlock || availableBlock;

            if (!amount) {
                return false;
            }

            balanceField = "comp";
            balanceAmount = amount;
            return aplicarComp(date, amount);
        }

        if (request.type === "unpaid_leave") {
            return aplicarLicencia(
                date,
                requestDays(request, 1),
                "unpaid_leave"
            );
        }

        if (request.type === "union_leave") {
            const selectedProfile = getProfiles().find(item =>
                item.name === profile
            );

            if (!selectedProfile?.unionLeaveEnabled) {
                return false;
            }

            return aplicarLicencia(
                date,
                requestDays(request, 1),
                "union_leave"
            );
        }

        return false;
    });

    if (!applied) {
        return {
            ok: false,
            message: "No se pudo aplicar la solicitud. Revisa saldos, reglas de calendario o bloqueos incompatibles."
        };
    }

    if (balanceField && balanceAmount > 0) {
        decrementManualBalance(
            profile,
            balanceField,
            balanceAmount,
            year
        );
    }

    return { ok: true };
}

function normalizeClockRequestDocuments(request = {}) {
    const source = Array.isArray(request.documents)
        ? request.documents
        : Array.isArray(request.attachments)
            ? request.attachments
            : [];

    return source
        .filter(doc => doc && typeof doc === "object")
        .slice(0, 10)
        .map((doc, index) => {
            const normalized = {
                id: String(doc.id || `worker_request_doc_${index + 1}`),
                name: String(doc.name || doc.fileName || `Adjunto ${index + 1}`)
            };
            const type = String(doc.type || doc.contentType || "");
            const addedAt = String(
                doc.addedAt ||
                doc.createdAt ||
                request.createdAt ||
                new Date().toISOString()
            );
            const uploadedByUid = String(
                doc.uploadedByUid ||
                request.createdByUid ||
                ""
            );
            const size = Number(doc.size);

            if (type) normalized.type = type;
            if (Number.isFinite(size) && size >= 0) normalized.size = size;
            if (addedAt) normalized.addedAt = addedAt;
            if (uploadedByUid) normalized.uploadedByUid = uploadedByUid;
            if (doc.storagePath) normalized.storagePath = String(doc.storagePath);
            if (doc.dataUrl) normalized.dataUrl = String(doc.dataUrl);
            if (doc.downloadURL || doc.downloadUrl) {
                normalized.downloadURL = String(
                    doc.downloadURL || doc.downloadUrl
                );
            }

            return normalized;
        })
        .filter(doc => doc.name && (doc.storagePath || doc.dataUrl));
}

async function applyClockRequest(request, profile, date) {
    const keyDay = keyFromDate(date);
    const side = String(request.side || request.missingSide || "")
        .toLowerCase();
    const missingEntry = Boolean(
        request.missingEntry ||
        side.includes("entrada") ||
        side.includes("entry") ||
        (request.type === "missing_clock" && !request.missingExit && !side)
    );
    const missingExit = Boolean(
        request.missingExit ||
        side.includes("salida") ||
        side.includes("exit") ||
        (request.type === "missing_clock" && !request.missingEntry && !side)
    );

    createClockMemoTask({
        profile,
        dateKey: keyDay,
        segmentId: request.segmentId || "incident",
        segmentLabel: request.shiftLabel || "Turno",
        missingEntry,
        missingExit,
        incident: request.type === "clock_incident",
        sourceDocuments: normalizeClockRequestDocuments(request)
    });

    return { ok: true };
}

function swapDateValue(request, ...keys) {
    for (const key of keys) {
        const value = request[key];
        const date = parseISODate(value);

        if (date) return isoFromDate(date);
    }

    return "";
}

function swapTurnCode(turno) {
    const value = Number(turno) || 0;

    if (value === 2) return "N";
    if (value === 1) return "L";

    return "";
}

async function applySwapRequest(request, profile) {
    const fecha = swapDateValue(
        request,
        "fecha",
        "changeDate",
        "date"
    );
    const devolucion = swapDateValue(
        request,
        "devolucion",
        "returnDate",
        "endDate"
    );
    const from = request.from || profile;
    const to =
        request.to ||
        request.targetProfile ||
        request.counterpart ||
        request.receiver ||
        "";

    if (!from || !to || !fecha || !devolucion) {
        return {
            ok: false,
            message: "La solicitud de cambio de turno no trae todos los datos necesarios."
        };
    }

    const date = parseISODate(fecha);
    const returnDate = parseISODate(devolucion);

    if (!date || !returnDate) {
        return {
            ok: false,
            message: "La solicitud de cambio de turno tiene fechas invalidas."
        };
    }

    if (
        date.getFullYear() !== returnDate.getFullYear() ||
        date.getMonth() !== returnDate.getMonth()
    ) {
        return {
            ok: false,
            message: "La fecha de cambio y devoluci\u00f3n deben pertenecer al mismo mes."
        };
    }

    if (!canSwapProfiles(from, to)) {
        return {
            ok: false,
            message: "Los trabajadores no cumplen la regla de compatibilidad para cambios de turno: revisa estamento, profesion y que no tengan la misma rotativa base (salvo dos rotativas Diurno, que si pueden intercambiar su dia de extension horaria)."
        };
    }

    const keyCambio = keyFromDate(date);
    const keyDevolucion = keyFromDate(returnDate);
    // El turno que la OTRA fecha devuelve. Sin el, la regla de "solo se permite
    // devolver el mismo tipo de turno" no se evalua -su guarda exige un turno
    // intercambiable y por omision llega 0-, asi que al aceptar una solicitud de
    // la app el ajuste de la unidad quedaba ignorado en silencio. El panel del
    // supervisor (js/swapUI.js) siempre lo paso; este camino no.
    const motivoCambio = getSwapDateBlockReason({
        giver: from,
        receiver: to,
        keyDay: keyCambio,
        requiredTurn: getSwapTurnState(to, keyDevolucion)
    });
    const motivoDevolucion = getSwapDateBlockReason({
        giver: to,
        receiver: from,
        keyDay: keyDevolucion,
        requiredTurn: getSwapTurnState(from, keyCambio)
    });

    if (motivoCambio) {
        return {
            ok: false,
            message: `No se puede aceptar la fecha de cambio: ${motivoCambio}`
        };
    }

    if (motivoDevolucion) {
        return {
            ok: false,
            message: `No se puede aceptar la fecha de devoluci\u00f3n: ${motivoDevolucion}`
        };
    }

    const turno = swapTurnCode(
        getSwapTurnState(from, keyCambio)
    );
    const turnoDevuelto = swapTurnCode(
        getSwapTurnState(to, keyDevolucion)
    );

    if (!turno || !turnoDevuelto) {
        return {
            ok: false,
            message: "El cambio solo puede registrarse con turnos Larga o Noche."
        };
    }

    registrarCambio({
        from,
        to,
        fecha,
        devolucion,
        turno,
        turnoDevuelto,
        year: date.getFullYear(),
        month: date.getMonth()
    });

    return { ok: true };
}

async function applyWorkerRequest(request) {
    const profile = resolveProfileName(request);

    if (!profile) {
        return {
            ok: false,
            message: "No se pudo identificar el perfil asociado a la solicitud."
        };
    }

    if (request.type === "report_request") {
        return applyReportRequest(request, profile);
    }

    if (request.type === "leave_cancel") {
        return applyLeaveCancellation(request);
    }

    const invalidDate = invalidDateResult(request);

    if (invalidDate) return invalidDate;

    const date = parseISODate(request.date);

    if (
        [
            "admin",
            "half_admin_morning",
            "half_admin_afternoon",
            "legal",
            "comp",
            "union_leave",
            "unpaid_leave"
        ].includes(request.type)
    ) {
        return applyLeaveRequest(request, profile, date);
    }

    if (
        request.type === "missing_clock" ||
        request.type === "clock_incident"
    ) {
        pushHistory();
        return applyClockRequest(request, profile, date);
    }

    if (request.type === "swap") {
        pushHistory();
        return applySwapRequest(request, profile);
    }

    if (request.type === "hhee_return") {
        if (!hheeReturnRequestHandler) {
            return {
                ok: false,
                message: "El modulo de devolucion de horas no esta disponible."
            };
        }

        return hheeReturnRequestHandler(request, profile);
    }

    return {
        ok: false,
        message: "Tipo de solicitud no reconocido."
    };
}

// Genera el informe mensual pedido por el trabajador y lo publica en su
// documento workerAppData.reportsByMonth (merge: conserva los meses ya
// presentes). El motor de informes corre en el navegador de la unidad, por eso
// la entrega es diferida: ocurre cuando esta app procesa la solicitud.
async function applyReportRequest(request, profileName) {
    const profile = getProfiles().find(item => item.name === profileName);

    if (!profile) {
        return {
            ok: false,
            message: "No se encontro el perfil para generar el informe."
        };
    }

    const year = Number(request.reportYear);
    const month = Number(request.reportMonth);

    if (
        !Number.isFinite(year) ||
        !Number.isFinite(month) ||
        month < 0 ||
        month > 11
    ) {
        return {
            ok: false,
            message: "La solicitud de informe no indica un mes valido."
        };
    }

    const link = getWorkerAppLinkForProfile(profileName);
    const workspace = getActiveWorkspace();

    if (!link?.uid || !workspace?.id) {
        return {
            ok: false,
            message: "El trabajador no tiene la app enlazada."
        };
    }

    let html = "";

    try {
        html = await buildWorkerReportPreviewHTML(
            profile,
            new Date(year, month, 1)
        );
    } catch (error) {
        console.warn("No se pudo generar el informe solicitado.", error);

        return {
            ok: false,
            message: "No se pudo generar el informe del mes solicitado."
        };
    }

    if (!html) {
        return {
            ok: false,
            message: "No hay datos para generar el informe de ese mes."
        };
    }

    try {
        const { db, firestoreModule } = await getFirebaseServices();

        await firestoreModule.setDoc(
            firestoreModule.doc(
                db,
                "workspaces",
                workspace.id,
                "workerAppData",
                link.uid
            ),
            {
                reportsByMonth: { [`${year}-${month}`]: html },
                updatedAt: firestoreModule.serverTimestamp()
            },
            { merge: true }
        );
    } catch (error) {
        console.warn("No se pudo publicar el informe solicitado.", error);

        return {
            ok: false,
            message: "No se pudo publicar el informe generado."
        };
    }

    const monthLabel = monthLabelFromYearMonth(year, month);

    void notifyWorkerApp(
        profileName,
        `Tu informe${monthLabel ? ` de ${monthLabel}` : ""} ya está disponible para descargar en la app.`
    );

    return { ok: true, monthLabel };
}

// Procesa automaticamente las solicitudes de informe pendientes en cuanto
// llegan (mientras la app de la unidad este abierta). Idempotente: marca cada
// solicitud como aceptada/rechazada para no reprocesarla.
const reportRequestsInFlight = new Set();

export async function processPendingReportRequests() {
    const pending = getWorkerRequests().filter(request =>
        request?.type === "report_request" &&
        request.status === "pending"
    );

    for (const request of pending) {
        if (reportRequestsInFlight.has(request.id)) continue;

        reportRequestsInFlight.add(request.id);

        try {
            const profileName = resolveProfileName(request);

            if (!profileName) {
                saveUpdatedRequest(request.id, {
                    status: "rejected",
                    rejectedAt: new Date().toISOString(),
                    rejectReason: "No se pudo identificar el perfil del informe."
                });
                continue;
            }

            const result = await applyReportRequest(request, profileName);

            if (result.ok) {
                saveUpdatedRequest(request.id, {
                    status: "accepted",
                    acceptedAt: new Date().toISOString(),
                    appliedAt: new Date().toISOString()
                });

                addAuditLog(
                    AUDIT_CATEGORY.WORKER_REQUESTS,
                    "Genero informe solicitado",
                    `${profileName}: informe de ${result.monthLabel || "mes solicitado"}.`,
                    {
                        profile: profileName,
                        requestId: request.id,
                        requestType: request.type
                    }
                );
            } else {
                saveUpdatedRequest(request.id, {
                    status: "rejected",
                    rejectedAt: new Date().toISOString(),
                    rejectReason: result.message
                });

                void notifyWorkerApp(
                    profileName,
                    `No se pudo preparar tu informe solicitado: ${result.message}`
                );
            }
        } catch (error) {
            console.warn("No se pudo procesar la solicitud de informe.", error);
        } finally {
            reportRequestsInFlight.delete(request.id);
        }
    }
}

if (typeof window !== "undefined") {
    window.addEventListener("proturnos:workerRequestsChanged", () => {
        void processPendingReportRequests();
    });
}

function saveUpdatedRequest(requestId, patch) {
    const requests = getWorkerRequests().map(request =>
        request.id === requestId
            ? {
                ...request,
                ...patch,
                updatedAt: new Date().toISOString()
            }
            : request
    );

    saveWorkerRequests(requests);
}

function requestDetailsHTML(request) {
    const pieces = [];

    if (isSupervisorInviteRequest(request)) {
        pieces.push(`Solicitante: ${request.profile || "Supervisor"}`);

        if (request.claimedByEmail) {
            pieces.push(`Correo: ${request.claimedByEmail}`);
        }

        if (request.expiresAt && request.status === "pending") {
            pieces.push(`Vence: ${formatInviteDate(request.expiresAt)}`);
        }

        return pieces.join(" | ");
    }

    if (isWorkspaceLinkRequest(request)) {
        pieces.push(`Unidad solicitante: ${request.fromWorkspaceName || "Sin nombre"}`);

        if (request.fromWorkspaceId) {
            pieces.push(`ID: ${request.fromWorkspaceId}`);
        }

        if (request.expectedWorkspaceName) {
            pieces.push(`Espera enlazar: ${request.expectedWorkspaceName}`);
        }

        if (request.needsWorkspaceChoice && request.status === "pending") {
            pieces.push("Eliges tu unidad al aceptar");
        }

        return pieces.join(" | ");
    }

    if (isReplacementRequest(request)) {
        if (request.date) {
            pieces.push(`Fecha: ${formatDate(request.date)}`);
        }

        if (request.turnoLabel) {
            pieces.push(`Turno: ${request.turnoLabel}`);
        }

        if (request.replaced) {
            pieces.push(`Cubre a: ${request.replaced}`);
        }

        if (request.expiresAt && request.status === "pending") {
            pieces.push(`Caduca: ${formatTimestamp(request.expiresAt)}`);
        }

        return pieces.join(" | ");
    }

    if (request.type === "hhee_return") {
        const monthLabel = monthLabelFromYearMonth(
            request.returnYear,
            request.returnMonth
        );
        const nextLabel = monthLabelFromYearMonth(
            Number(request.returnMonth) === 11
                ? Number(request.returnYear) + 1
                : Number(request.returnYear),
            Number(request.returnMonth) === 11
                ? 0
                : Number(request.returnMonth) + 1
        );

        if (monthLabel) {
            pieces.push(`HH.EE de ${monthLabel}`);
        }

        pieces.push(
            `Netas: ${formatReturnHours(request.netTotal)} h ` +
            `(${formatReturnHours(request.netDay)} diurnas, ` +
            `${formatReturnHours(request.netNight)} nocturnas)`
        );

        if (nextLabel) {
            pieces.push(`Disponibles desde ${nextLabel}`);
        }

        return pieces.join(" | ");
    }

    if (request.type === "report_request") {
        const monthLabel = monthLabelFromYearMonth(
            request.reportYear,
            request.reportMonth
        );

        pieces.push(`Informe de ${monthLabel || "mes solicitado"}`);

        return pieces.join(" | ");
    }

    if (request.type === "leave_cancel") {
        pieces.push(`Anular: ${requestTypeLabel(request.leaveType) || "permiso"}`);
        if (request.date) pieces.push(`Desde: ${formatDate(request.date)}`);
        if (request.endDate) pieces.push(`Hasta: ${formatDate(request.endDate)}`);
        if (request.days) pieces.push(`${request.days} día(s)`);

        return pieces.join(" | ");
    }

    if (request.date) {
        pieces.push(`Fecha: ${formatDate(request.date)}`);
    }

    if (request.endDate) {
        pieces.push(`T\u00e9rmino: ${formatDate(request.endDate)}`);
    }

    if (request.days) {
        pieces.push(`${request.days} d\u00eda(s)`);
    }

    if (
        request.type === "missing_clock" ||
        request.type === "clock_incident"
    ) {
        const documentCount = normalizeClockRequestDocuments(request).length;

        if (documentCount) {
            pieces.push(`${documentCount} adjunto(s)`);
        }
    }

    if (request.type === "swap") {
        const to =
            request.to ||
            request.targetProfile ||
            request.counterpart ||
            "Sin contraparte";
        const returnDate =
            request.devolucion ||
            request.returnDate ||
            request.endDate;

        pieces.push(`Con: ${to}`);
        if (returnDate) {
            pieces.push(`Devolucion: ${formatDate(returnDate)}`);
        }
    }

    return pieces.length
        ? pieces.join(" | ")
        : "Sin detalle adicional";
}

function requestCardHTML(request) {
    const pending = request.status === "pending" &&
        !isReplacementRequest(request);
    const title = isWorkspaceLinkRequest(request)
        ? request.fromWorkspaceName || "Unidad solicitante"
        : isSupervisorInviteRequest(request)
            ? request.profile || "Supervisor"
            : isReplacementRequest(request)
                ? request.worker || "Trabajador"
                : request.profile || "Sin trabajador";
    const statusText = displayStatusLabel(request);
    const acceptLabel = isSupervisorInviteRequest(request)
        ? "Aprobar"
        : "Aceptar";
    const documents = (
        request.type === "missing_clock" ||
        request.type === "clock_incident"
    )
        ? normalizeClockRequestDocuments(request)
        : [];

    return `
        <article class="worker-request-card worker-request-card--${escapeHTML(request.status)}">
            <div class="worker-request-card__main">
                <div>
                    <span class="worker-request-type">
                        ${escapeHTML(requestTypeLabel(request.type))}
                    </span>
                    <h4>${escapeHTML(title)}</h4>
                    <p>${escapeHTML(requestDetailsHTML(request))}</p>
                    ${request.note
                        ? `<small>${escapeHTML(request.note)}</small>`
                        : ""}
                    ${request.rejectReason
                        ? `<small class="worker-request-reject-note">Motivo rechazo: ${escapeHTML(request.rejectReason)}</small>`
                        : ""}
                    ${documents.length ? `
                        <div class="worker-request-documents">
                            ${documents.map(document => `
                                <div class="worker-request-document">
                                    <span>${escapeHTML(document.name)}</span>
                                    <span class="worker-request-document__actions">
                                        <button class="secondary-button secondary-button--small" type="button" data-worker-request-document="view" data-request-id="${escapeHTML(request.id)}" data-document-id="${escapeHTML(document.id)}">Ver</button>
                                        <button class="secondary-button secondary-button--small" type="button" data-worker-request-document="download" data-request-id="${escapeHTML(request.id)}" data-document-id="${escapeHTML(document.id)}">Descargar</button>
                                    </span>
                                </div>
                            `).join("")}
                        </div>
                    ` : ""}
                </div>

                <div class="worker-request-card__meta">
                    <span class="worker-request-status worker-request-status--${escapeHTML(request.status)}">
                        ${escapeHTML(statusText)}
                    </span>
                    <time>${escapeHTML(formatTimestamp(request.createdAt))}</time>
                </div>
            </div>

            ${isReplacementRequest(request) && request.status === "pending"
                ? `
                    <div class="worker-request-actions">
                        <button class="secondary-button secondary-button--small" type="button" data-worker-request-action="cancel-replacement" data-request-id="${escapeHTML(request.id)}">
                            Anular solicitud
                        </button>
                    </div>
                `
                : ""}

            ${pending
                ? `
                    <div class="worker-request-actions">
                        <button class="primary-button secondary-button--small" type="button" data-worker-request-action="accept" data-request-id="${escapeHTML(request.id)}">
                            ${escapeHTML(acceptLabel)}
                        </button>
                        <button class="secondary-button secondary-button--small" type="button" data-worker-request-action="reject" data-request-id="${escapeHTML(request.id)}">
                            Rechazar
                        </button>
                        ${canViewRequestInCalendar(request)
                            ? `
                                <button class="secondary-button secondary-button--small" type="button" data-worker-request-action="view-calendar" data-request-id="${escapeHTML(request.id)}">
                                    Ver en calendario
                                </button>
                            `
                            : ""}
                    </div>
                `
                : ""}
        </article>
    `;
}

function statusButtonHTML(status, label, count) {
    return `
        <button class="worker-request-filter ${selectedStatus === status ? "is-active" : ""}" type="button" data-worker-request-status="${status}">
            ${label} <span>${count}</span>
        </button>
    `;
}

function updateRequestsNavBadge(count) {
    const tile = document.querySelector(
        ".nav-tile[data-target='workerRequestsPanel']"
    );

    if (!tile) return;

    let badge = tile.querySelector(".nav-alert-badge");

    if (!count) {
        badge?.remove();
        tile.removeAttribute("data-alert-count");
        return;
    }

    if (!badge) {
        badge = document.createElement("span");
        badge.className = "nav-alert-badge";
        tile.appendChild(badge);
    }

    badge.textContent = count > 99 ? "99+" : String(count);
    tile.dataset.alertCount = String(count);
}

export async function refreshWorkerRequestsNavBadge() {
    const workerRequests = getWorkerRequests();
    const replacementRequests = getReplacementRequests()
        .map(replacementRequestToPanelRequest);
    const linkRequests = await getWorkspaceLinkRequests();
    const supervisorInviteRequests =
        await getSupervisorInviteRequests();
    const pending = [
        ...supervisorInviteRequests,
        ...linkRequests,
        ...workerRequests,
        ...replacementRequests
    ].filter(request => request.status === "pending");

    updateRequestsNavBadge(pending.length);
}

async function getWorkspaceLinkRequests() {
    if (
        !isFirebaseConfigured() ||
        !getCurrentFirebaseUser() ||
        !getActiveWorkspace()?.id
    ) {
        return [];
    }

    const activeWorkspace = getActiveWorkspace();

    try {
        const links = await listWorkspaceLinks(activeWorkspace);

        return links
            .filter(link =>
                (
                    link.toWorkspaceId === activeWorkspace.id ||
                    isOwnerPendingWorkspaceLink(link)
                ) &&
                ["pending", "accepted", "rejected"].includes(
                    link.status || "pending"
                )
            )
            .map(link => ({
                kind: "workspace_link",
                id: `workspace_link:${link.id}`,
                linkId: link.id,
                type: "workspace_link",
                status: link.status || "pending",
                profile: workspaceLinkDisplayName(link, activeWorkspace),
                fromWorkspaceId: link.fromWorkspaceId || "",
                fromWorkspaceName:
                    workspaceLinkDisplayName(link, activeWorkspace),
                // Solicitud que llego por el correo del owner: todavia no tiene
                // unidad destino, se elige al aceptar.
                needsWorkspaceChoice: isOwnerPendingWorkspaceLink(link),
                expectedWorkspaceName: link.expectedWorkspaceName || "",
                note:
                    link.status === "pending"
                        ? "Solicita enlazarse a esta unidad para gestionar prestamos entre unidades."
                        : "",
                rejectReason: link.rejectReason || "",
                createdAt: timestampISO(
                    link.createdAt ||
                    link.updatedAt ||
                    new Date()
                )
            }));
    } catch (error) {
        console.warn(
            "No se pudieron cargar solicitudes de enlace entre unidades.",
            error
        );
        return [];
    }
}

function supervisorInviteRequestStatusLabel(status) {
    if (status === "claimed") return "Pendiente de aprobacion";
    if (status === "approved") return "Aprobada";
    if (status === "rejected") return "Rechazada";
    if (status === "revoked") return "Revocada";
    if (status === "expired") return "Vencida";
    return statusLabel(supervisorInvitePanelStatus(status));
}

function supervisorInviteToPanelRequest(invite, workspace) {
    const panelStatus = supervisorInvitePanelStatus(invite.status);

    if (!panelStatus) return null;

    const actor = supervisorInviteActor(invite);

    return {
        kind: "supervisor_invite",
        id: `supervisor_invite:${invite.id}`,
        inviteId: invite.id,
        workspaceId: workspace.id,
        type: "supervisor_invite",
        status: panelStatus,
        statusLabel: supervisorInviteRequestStatusLabel(invite.status),
        sourceStatus: invite.status || "",
        profile: actor,
        claimedByEmail: invite.claimedByEmail || "",
        permissions: invite.permissions || invite.finalPermissions || {},
        note:
            invite.status === "claimed"
                ? "Solicita acceso como supervisor a esta unidad."
                : "",
        rejectReason: invite.rejectReason || "",
        expiresAt: invite.expiresAt || "",
        createdAt: timestampISO(
            invite.claimedAt ||
            invite.updatedAt ||
            invite.createdAt ||
            new Date()
        )
    };
}

async function getSupervisorInviteRequests() {
    const activeWorkspace = getActiveWorkspace();

    if (
        !isFirebaseConfigured() ||
        !getCurrentFirebaseUser() ||
        !activeWorkspace?.id ||
        (
            activeWorkspace.role &&
            activeWorkspace.role !== "owner"
        ) ||
        !isWorkspaceOwner()
    ) {
        return [];
    }

    try {
        const invites =
            await listSupervisorInvitations(activeWorkspace.id);

        return invites
            .map(invite =>
                supervisorInviteToPanelRequest(invite, activeWorkspace)
            )
            .filter(Boolean);
    } catch (error) {
        console.warn(
            "No se pudieron cargar solicitudes de supervisor.",
            error
        );
        return [];
    }
}

export function stopSupervisorInviteRequestsListener() {
    supervisorInviteListenerVersion += 1;

    if (unsubscribeSupervisorInviteRequests) {
        unsubscribeSupervisorInviteRequests();
        unsubscribeSupervisorInviteRequests = null;
    }

    unsubscribeWorkspaceLinkRequests.forEach(unsubscribe => {
        unsubscribe?.();
    });
    unsubscribeWorkspaceLinkRequests = [];
    activeSupervisorInviteWorkspaceId = "";
}

export async function startSupervisorInviteRequestsListener(
    workspace = getActiveWorkspace()
) {
    const workspaceId = workspace?.id || "";

    if (
        !workspaceId ||
        !isFirebaseConfigured() ||
        !getCurrentFirebaseUser() ||
        (
            workspace.role &&
            workspace.role !== "owner"
        ) ||
        !isWorkspaceOwner()
    ) {
        stopSupervisorInviteRequestsListener();
        return;
    }

    if (
        activeSupervisorInviteWorkspaceId === workspaceId &&
        unsubscribeSupervisorInviteRequests
    ) {
        return;
    }

    stopSupervisorInviteRequestsListener();
    activeSupervisorInviteWorkspaceId = workspaceId;
    supervisorInviteListenerVersion += 1;

    const listenerVersion = supervisorInviteListenerVersion;

    try {
        const { db, firestoreModule } = await getFirebaseServices();
        const user = getCurrentFirebaseUser();
        const collectionRef = firestoreModule.collection(
            db,
            "workspaces",
            workspaceId,
            "supervisorInvites"
        );

        if (
            listenerVersion !== supervisorInviteListenerVersion ||
            activeSupervisorInviteWorkspaceId !== workspaceId
        ) {
            return;
        }

        unsubscribeSupervisorInviteRequests = firestoreModule.onSnapshot(
            collectionRef,
            () => {
                window.dispatchEvent(
                    new CustomEvent("proturnos:workerRequestsChanged")
                );
            },
            error => {
                console.warn(
                    "No se pudo sincronizar solicitudes de supervisor.",
                    error
                );
            }
        );
        const workspaceLinksRef = firestoreModule.collection(
            db,
            "workspaceLinks"
        );
        const workspaceLinkQueries = [
            firestoreModule.query(
                workspaceLinksRef,
                firestoreModule.where("toWorkspaceId", "==", workspaceId)
            )
        ];

        if (user?.uid) {
            workspaceLinkQueries.push(
                firestoreModule.query(
                    workspaceLinksRef,
                    firestoreModule.where("toOwnerUid", "==", user.uid)
                )
            );
        }

        unsubscribeWorkspaceLinkRequests = workspaceLinkQueries.map(queryRef =>
            firestoreModule.onSnapshot(
                queryRef,
                () => {
                    window.dispatchEvent(
                        new CustomEvent("proturnos:workerRequestsChanged")
                    );
                },
                error => {
                    console.warn(
                        "No se pudo sincronizar solicitudes de enlace entre unidades.",
                        error
                    );
                }
            )
        );
    } catch (error) {
        console.warn(
            "No se pudo iniciar sincronizacion de solicitudes de supervisor.",
            error
        );
        stopSupervisorInviteRequestsListener();
    }
}

function showRejectDialog(request) {
    return new Promise(resolve => {
        const backdrop = document.createElement("div");

        backdrop.className = "turn-change-dialog-backdrop";
        backdrop.innerHTML = `
            <form class="turn-change-dialog worker-request-reject-dialog" role="dialog" aria-modal="true">
                <strong>Rechazar solicitud</strong>
                <p>
                    Indica el motivo del rechazo para que quede registrado en la bitacora.
                </p>
                <label class="worker-request-textarea">
                    <span>Motivo</span>
                    <textarea rows="4" placeholder="Ej: saldo insuficiente, fecha no disponible, requiere correccion..."></textarea>
                </label>
                <div class="turn-change-dialog__actions">
                    <button class="primary-button" type="submit">Guardar rechazo</button>
                    <button class="secondary-button" type="button" data-action="cancel">Cancelar</button>
                </div>
            </form>
        `;

        const close = value => {
            backdrop.remove();
            resolve(value);
        };
        const form = backdrop.querySelector("form");
        const textarea = backdrop.querySelector("textarea");

        form.onsubmit = event => {
            event.preventDefault();

            const reason = textarea.value.trim();

            if (!reason) {
                textarea.focus();
                return;
            }

            close(reason);
        };

        backdrop.querySelector("[data-action='cancel']").onclick =
            () => close("");
        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) close("");
        });

        document.body.appendChild(backdrop);
        textarea.focus();
    });
}

async function acceptRequest(request) {
    const result = await applyWorkerRequest(request);

    if (!result.ok) {
        alert(result.message);
        return false;
    }

    // El nombre resuelto, no el que viajo en la solicitud: el LOG se filtra y se
    // anula por perfil, y notifyWorkerApp busca el enlace por nombre exacto.
    const profileName = resolveProfileName(request) || request.profile;

    saveUpdatedRequest(request.id, {
        status: "accepted",
        acceptedAt: new Date().toISOString(),
        appliedAt: new Date().toISOString()
    });

    if (request.type === "leave_cancel" && profileName) {
        void notifyWorkerApp(
            profileName,
            `Tu supervisor aprobó la anulación de tu ${requestTypeLabel(request.leaveType) || "permiso"}. Se restauraron tus saldos.`
        );
    }

    addAuditLog(
        AUDIT_CATEGORY.WORKER_REQUESTS,
        "Acepto solicitud de trabajador",
        `${profileName}: ${requestTypeLabel(request.type)} (${requestDetailsHTML(request)}).`,
        {
            profile: profileName,
            requestId: request.id,
            requestType: request.type
        }
    );

    if (
        request.type === "missing_clock" ||
        request.type === "clock_incident"
    ) {
        window.dispatchEvent(new CustomEvent("proturnos:openMemos"));
    }

    return true;
}

async function rejectRequest(request) {
    const reason = await showRejectDialog(request);

    if (!reason) return false;

    const profileName = resolveProfileName(request) || request.profile;

    saveUpdatedRequest(request.id, {
        status: "rejected",
        rejectedAt: new Date().toISOString(),
        rejectReason: reason
    });

    if (request.type === "hhee_return" && profileName) {
        const monthLabel = monthLabelFromYearMonth(
            request.returnYear,
            request.returnMonth
        );

        void notifyWorkerApp(
            profileName,
            `Tu supervisor no aprobó tu solicitud de devolución de horas${monthLabel ? ` de ${monthLabel}` : ""}. Motivo: ${reason}.`
        );
    }

    if (request.type === "leave_cancel" && profileName) {
        void notifyWorkerApp(
            profileName,
            `Tu supervisor no aprobó la anulación de tu ${requestTypeLabel(request.leaveType) || "permiso"}. Motivo: ${reason}.`
        );
    }

    addAuditLog(
        AUDIT_CATEGORY.WORKER_REQUESTS,
        "Rechazo solicitud de trabajador",
        `${profileName}: ${requestTypeLabel(request.type)}. Motivo: ${reason}.`,
        {
            profile: profileName,
            requestId: request.id,
            requestType: request.type
        }
    );

    return true;
}

export async function acceptWorkerRequestById(requestId) {
    const request = getWorkerRequests().find(item =>
        item.id === requestId
    );

    if (!request || request.status !== "pending") {
        alert("Esta solicitud ya no esta pendiente.");
        return false;
    }

    return acceptRequest(request);
}

export async function rejectWorkerRequestById(requestId) {
    const request = getWorkerRequests().find(item =>
        item.id === requestId
    );

    if (!request || request.status !== "pending") {
        alert("Esta solicitud ya no esta pendiente.");
        return false;
    }

    return rejectRequest(request);
}

async function acceptWorkspaceLinkRequest(request) {
    // La solicitud llego por el correo del owner, que puede tener varias
    // unidades: se le pregunta a cual enlazar en vez de amarrarla en silencio a
    // la que tenga activa.
    const target = request.needsWorkspaceChoice
        ? await chooseWorkspaceForLink({
            fromWorkspaceId: request.fromWorkspaceId,
            fromWorkspaceName: request.fromWorkspaceName,
            expectedWorkspaceName: request.expectedWorkspaceName
        })
        : null;

    if (request.needsWorkspaceChoice && !target) return;

    await acceptWorkspaceLink(request.linkId, target);

    addAuditLog(
        AUDIT_CATEGORY.WORKER_REQUESTS,
        "Acepto enlace entre unidades",
        `${request.fromWorkspaceName}: solicitud de enlace aceptada` +
            (target?.name ? ` con la unidad ${target.name}.` : "."),
        {
            requestId: request.linkId,
            requestType: "workspace_link",
            workspaceId: request.fromWorkspaceId
        }
    );
}

async function rejectWorkspaceLinkRequest(request) {
    const reason = await showRejectDialog(request);

    if (!reason) return;

    await rejectWorkspaceLink(request.linkId, reason);

    addAuditLog(
        AUDIT_CATEGORY.WORKER_REQUESTS,
        "Rechazo enlace entre unidades",
        `${request.fromWorkspaceName}: solicitud de enlace rechazada. Motivo: ${reason}.`,
        {
            requestId: request.linkId,
            requestType: "workspace_link",
            workspaceId: request.fromWorkspaceId
        }
    );
}

async function approveSupervisorInviteRequest(request) {
    const permissions =
        await showSupervisorInvitePermissionsDialog({
            title: "Aprobar supervisor",
            message:
                `Revisa los permisos para ${request.profile || "este supervisor"} antes de aprobar el acceso.`,
            confirmText: "Aprobar",
            permissions: request.permissions || {}
        });

    if (!permissions) return false;

    await approveSupervisorInvitation(
        request.workspaceId,
        request.inviteId,
        permissions
    );

    addAuditLog(
        AUDIT_CATEGORY.WORKER_REQUESTS,
        "Aprobo solicitud de supervisor",
        `${request.profile}: acceso supervisor aprobado.`,
        {
            requestId: request.inviteId,
            requestType: "supervisor_invite",
            workspaceId: request.workspaceId
        }
    );

    return true;
}

async function rejectSupervisorInviteRequest(request) {
    const reason = await showRejectDialog(request);

    if (!reason) return false;

    await rejectSupervisorInvitation(
        request.workspaceId,
        request.inviteId,
        reason
    );

    addAuditLog(
        AUDIT_CATEGORY.WORKER_REQUESTS,
        "Rechazo solicitud de supervisor",
        `${request.profile}: acceso supervisor rechazado. Motivo: ${reason}.`,
        {
            requestId: request.inviteId,
            requestType: "supervisor_invite",
            workspaceId: request.workspaceId
        }
    );

    return true;
}

export async function renderWorkerRequestsPanel() {
    const panel = document.getElementById("workerRequestsPanel");

    if (!panel) return;

    if (!selectedMonth) {
        selectedMonth = monthValue();
    }

    const workerRequests = getWorkerRequests();
    const replacementRequests = getReplacementRequests()
        .map(replacementRequestToPanelRequest);
    const linkRequests = await getWorkspaceLinkRequests();
    const supervisorInviteRequests =
        await getSupervisorInviteRequests();
    const allRequests = [
        ...supervisorInviteRequests,
        ...linkRequests,
        ...workerRequests,
        ...replacementRequests
    ];
    // Las PENDIENTES se muestran SIEMPRE, sin importar el mes seleccionado: una
    // solicitud de anulacion se archiva por su fecha de creacion (hoy), que puede
    // no coincidir con el mes del permiso; antes quedaba invisible aunque el badge
    // la contara. Las resueltas siguen filtradas por mes.
    const monthRequests = filterRequestsBySelectedMonth(allRequests);
    const requests = [
        ...allRequests.filter(request =>
            request.status === "pending" && !monthRequests.includes(request)
        ),
        ...monthRequests
    ];
    const allPending = allRequests.filter(request =>
        request.status === "pending"
    );
    const pending = requests.filter(request =>
        request.status === "pending"
    );
    const resolved = requests.filter(request =>
        request.status !== "pending"
    );
    const visible = selectedStatus === "all"
        ? requests
        : requests.filter(request => request.status === selectedStatus);

    updateRequestsNavBadge(allPending.length);

    panel.innerHTML = `
        <div class="section-head section-head--with-action">
            <span class="section-head__title">
                <h3>Solicitudes</h3>
                <small>
                    Revisa solicitudes de trabajadores, supervisores y enlaces entre unidades.
                </small>
            </span>
            <div class="worker-request-head-actions">
                <label class="audit-month-filter">
                    <span>Mes</span>
                    <input id="workerRequestMonthFilter" type="month" value="${escapeHTML(selectedMonth)}">
                </label>
                <span class="worker-request-counter">
                    ${pending.length} pendiente(s) del mes
                </span>
            </div>
        </div>

        <div class="worker-request-filters">
            ${statusButtonHTML("pending", "Pendientes", pending.length)}
            ${statusButtonHTML("accepted", "Aceptadas", requests.filter(request => request.status === "accepted").length)}
            ${statusButtonHTML("rejected", "Rechazadas", requests.filter(request => request.status === "rejected").length)}
            ${statusButtonHTML("canceled", "Anuladas", requests.filter(request => request.status === "canceled").length)}
            ${statusButtonHTML("expired", "Expiradas", requests.filter(request => request.status === "expired").length)}
            ${statusButtonHTML("all", "Todas", requests.length)}
        </div>

        <div class="worker-request-list">
            ${visible.length
                ? visible.map(requestCardHTML).join("")
                : `
                    <div class="empty-state empty-state--compact">
                        ${selectedStatus === "pending"
                            ? "No hay solicitudes pendientes en este mes."
                            : "No hay solicitudes para este filtro en este mes."}
                    </div>
                `}
        </div>

        ${resolved.length
            ? `<p class="worker-request-footnote">Las solicitudes aceptadas o rechazadas quedan disponibles para auditoria y sincronizacion con la app movil.</p>`
            : ""}
    `;

    const monthFilter = document.getElementById("workerRequestMonthFilter");

    if (monthFilter) {
        monthFilter.onchange = () => {
            selectedMonth = monthFilter.value || monthValue();
            renderWorkerRequestsPanel();
        };
    }

    panel.querySelectorAll("[data-worker-request-status]").forEach(button => {
        button.onclick = () => {
            selectedStatus = button.dataset.workerRequestStatus || "pending";
            renderWorkerRequestsPanel();
        };
    });

    panel.querySelectorAll("[data-worker-request-action]").forEach(button => {
        button.onclick = async () => {
            const latestWorkerRequests = getWorkerRequests();
            const request = requests.find(item =>
                item.id === button.dataset.requestId
            ) || latestWorkerRequests.find(item =>
                item.id === button.dataset.requestId
            );

            if (!request || request.status !== "pending") return;

            const action = button.dataset.workerRequestAction || "";

            if (action === "cancel-replacement") {
                // Anular la solicitud enviada: la escribe cancelReplacementRequest
                // y el sync la sube, con lo que desaparece de la PWA del
                // trabajador y el turno vuelve a quedar pendiente de cobertura.
                const confirmed = await showConfirm(
                    `¿Anular la solicitud de cobertura enviada a ${request.worker}?`,
                    {
                        title: "Anular solicitud",
                        confirmText: "Anular",
                        cancelText: "Volver",
                        destructive: true
                    }
                );

                if (!confirmed) return;

                button.disabled = true;
                cancelReplacementRequest(request.id);
                await renderWorkerRequestsPanel();
                window.dispatchEvent(
                    new CustomEvent("proturnos:workerRequestsChanged")
                );
                return;
            }

            if (action === "view-calendar") {
                window.dispatchEvent(
                    new CustomEvent("proturnos:viewWorkerRequestInCalendar", {
                        detail: {
                            requestId: request.id,
                            profile: resolveProfileName(request),
                            date: requestCalendarDate(request)
                        }
                    })
                );
                return;
            }

            button.disabled = true;

            const accepting = action === "accept";

            if (isWorkspaceLinkRequest(request)) {
                if (accepting) {
                    await acceptWorkspaceLinkRequest(request);
                } else {
                    await rejectWorkspaceLinkRequest(request);
                }
            } else if (isSupervisorInviteRequest(request)) {
                if (accepting) {
                    await approveSupervisorInviteRequest(request);
                } else {
                    await rejectSupervisorInviteRequest(request);
                }
            } else if (accepting) {
                await acceptRequest(request);
            } else {
                await rejectRequest(request);
            }

            await renderWorkerRequestsPanel();
            window.dispatchEvent(
                new CustomEvent("proturnos:workerRequestsChanged")
            );
        };
    });

    panel.querySelectorAll("[data-worker-request-document]").forEach(button => {
        button.onclick = async () => {
            const request = requests.find(item =>
                item.id === button.dataset.requestId
            );
            const document = normalizeClockRequestDocuments(request).find(item =>
                item.id === button.dataset.documentId
            );

            if (!document) return;

            try {
                await openCachedAttachment(document, {
                    newTab: button.dataset.workerRequestDocument === "view"
                });
            } catch (error) {
                alert(error?.message || "No se pudo abrir el archivo adjunto.");
            }
        };
    });
}
