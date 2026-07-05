import { keyFromDate } from "./dateUtils.js";
import { escapeHTML } from "./htmlUtils.js";
import { TURNO_LABEL } from "./constants.js";
import { pushHistory } from "./history.js";
import {
    AUDIT_CATEGORY,
    addAuditLog
} from "./auditLog.js";
import {
    getCurrentFirebaseUser,
    getFirebaseServices,
    isFirebaseConfigured
} from "./firebaseClient.js";
import {
    acceptWorkspaceLink,
    listWorkspaceLinks,
    rejectWorkspaceLink
} from "./firebaseLinkedUnits.js";
import { fetchHolidays } from "./holidays.js";
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
import { getTurnoReal } from "./turnEngine.js";
import {
    getClockMarks,
    getScheduledSegmentsForState,
    saveClockMarks
} from "./clockMarks.js";
import { createClockMemoTask } from "./memos.js";
import {
    canSwapProfiles,
    getSwapDateBlockReason,
    getSwapTurnState,
    registrarCambio
} from "./swaps.js";
import { getActiveWorkspace } from "./workspaces.js";
import {
    getWorkerAppLinkForProfile,
    notifyWorkerApp
} from "./workerAppDataSync.js";
import { buildWorkerReportPreviewHTML } from "./hoursReport.js";

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
    report_request: "Informe mensual",
    workspace_link: "Enlace de Unidad",
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

function isReplacementRequest(request = {}) {
    return request.kind === "replacement_request";
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

function resolveProfileName(request) {
    if (request.profile) return request.profile;

    const profiles = getProfiles();

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

function normalizeClockSegment(segment = {}) {
    const normalized = {};

    if (segment.missingEntry) normalized.missingEntry = true;
    if (segment.missingExit) normalized.missingExit = true;
    if (segment.entryTime) normalized.entryTime = String(segment.entryTime);
    if (segment.exitTime) normalized.exitTime = String(segment.exitTime);

    return normalized;
}

function clockSegmentLabel(segments, segmentId) {
    const segment = segments.find(item => item.id === segmentId);

    if (!segment) return "Turno";
    if (segment.label) return `Turno ${segment.label}`;

    return "Turno";
}

async function applyClockRequest(request, profile, date) {
    const keyDay = keyFromDate(date);
    const state =
        Number(request.state || request.turno || request.shiftState) ||
        getTurnoReal(profile, keyDay);
    const holidays = await fetchHolidays(date.getFullYear());
    const segments =
        getScheduledSegmentsForState(date, state, holidays);

    if (!segments.length) {
        return {
            ok: false,
            message: "No hay un turno valido para registrar marcaje en esa fecha."
        };
    }

    const marks = getClockMarks(profile);
    const mark = {
        segments: {},
        updatedAt: new Date().toISOString(),
        workerRequestId: request.id,
        source: "worker_request"
    };
    const incomingSegments =
        request.clockMark?.segments ||
        request.mark?.segments ||
        request.segments ||
        null;

    if (incomingSegments && typeof incomingSegments === "object") {
        Object.entries(incomingSegments).forEach(([segmentId, segment]) => {
            const normalized = normalizeClockSegment(segment);

            if (Object.keys(normalized).length) {
                mark.segments[segmentId] = normalized;
            }
        });
    } else if (request.type === "missing_clock") {
        const side = String(request.side || request.missingSide || "")
            .toLowerCase();
        const missingEntry =
            request.missingEntry ||
            side.includes("entrada") ||
            side.includes("entry") ||
            (!request.missingExit && !side);
        const missingExit =
            request.missingExit ||
            side.includes("salida") ||
            side.includes("exit") ||
            (!request.missingEntry && !side);

        segments.forEach(segment => {
            mark.segments[segment.id] = {
                ...(missingEntry ? { missingEntry: true } : {}),
                ...(missingExit ? { missingExit: true } : {})
            };
        });
    } else {
        const targetSegment =
            segments.find(segment => segment.id === request.segmentId) ||
            segments[0];
        const normalized = normalizeClockSegment({
            entryTime: request.entryTime,
            exitTime: request.exitTime,
            missingEntry: request.missingEntry,
            missingExit: request.missingExit
        });

        if (Object.keys(normalized).length) {
            mark.segments[targetSegment.id] = normalized;
        }
    }

    if (!Object.keys(mark.segments).length) {
        return {
            ok: false,
            message: "La solicitud de marcaje no trae datos suficientes para aplicarla."
        };
    }

    marks[keyDay] = mark;
    saveClockMarks(profile, marks);
    Object.entries(mark.segments).forEach(([segmentId, segment]) => {
        if (!segment.missingEntry && !segment.missingExit) return;

        createClockMemoTask({
            profile,
            dateKey: keyDay,
            segmentId,
            segmentLabel: clockSegmentLabel(segments, segmentId),
            missingEntry: Boolean(segment.missingEntry),
            missingExit: Boolean(segment.missingExit)
        });
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
            message: "Los trabajadores no cumplen la regla de compatibilidad para cambios de turno: revisa estamento, profesion y que no tengan la misma rotativa base."
        };
    }

    const keyCambio = keyFromDate(date);
    const keyDevolucion = keyFromDate(returnDate);
    const motivoCambio = getSwapDateBlockReason({
        giver: from,
        receiver: to,
        keyDay: keyCambio
    });
    const motivoDevolucion = getSwapDateBlockReason({
        giver: to,
        receiver: from,
        keyDay: keyDevolucion
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

    if (isWorkspaceLinkRequest(request)) {
        pieces.push(`Unidad solicitante: ${request.fromWorkspaceName || "Sin nombre"}`);

        if (request.fromWorkspaceId) {
            pieces.push(`ID: ${request.fromWorkspaceId}`);
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

    if (request.date) {
        pieces.push(`Fecha: ${formatDate(request.date)}`);
    }

    if (request.endDate) {
        pieces.push(`T\u00e9rmino: ${formatDate(request.endDate)}`);
    }

    if (request.days) {
        pieces.push(`${request.days} d\u00eda(s)`);
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
        : isReplacementRequest(request)
            ? request.worker || "Trabajador"
            : request.profile || "Sin trabajador";
    const statusText = displayStatusLabel(request);

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
                </div>

                <div class="worker-request-card__meta">
                    <span class="worker-request-status worker-request-status--${escapeHTML(request.status)}">
                        ${escapeHTML(statusText)}
                    </span>
                    <time>${escapeHTML(formatTimestamp(request.createdAt))}</time>
                </div>
            </div>

            ${pending
                ? `
                    <div class="worker-request-actions">
                        <button class="primary-button secondary-button--small" type="button" data-worker-request-action="accept" data-request-id="${escapeHTML(request.id)}">
                            Aceptar
                        </button>
                        <button class="secondary-button secondary-button--small" type="button" data-worker-request-action="reject" data-request-id="${escapeHTML(request.id)}">
                            Rechazar
                        </button>
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
    const pending = [
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
                link.toWorkspaceId === activeWorkspace.id &&
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
                profile: link.fromWorkspaceName || link.fromWorkspaceId,
                fromWorkspaceId: link.fromWorkspaceId || "",
                fromWorkspaceName:
                    link.fromWorkspaceName ||
                    link.fromWorkspaceId ||
                    "Unidad solicitante",
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

    saveUpdatedRequest(request.id, {
        status: "accepted",
        acceptedAt: new Date().toISOString(),
        appliedAt: new Date().toISOString()
    });

    addAuditLog(
        AUDIT_CATEGORY.WORKER_REQUESTS,
        "Acepto solicitud de trabajador",
        `${request.profile}: ${requestTypeLabel(request.type)} (${requestDetailsHTML(request)}).`,
        {
            profile: request.profile,
            requestId: request.id,
            requestType: request.type
        }
    );

    return true;
}

async function rejectRequest(request) {
    const reason = await showRejectDialog(request);

    if (!reason) return false;

    saveUpdatedRequest(request.id, {
        status: "rejected",
        rejectedAt: new Date().toISOString(),
        rejectReason: reason
    });

    if (request.type === "hhee_return" && request.profile) {
        const monthLabel = monthLabelFromYearMonth(
            request.returnYear,
            request.returnMonth
        );

        void notifyWorkerApp(
            request.profile,
            `Tu supervisor no aprobó tu solicitud de devolución de horas${monthLabel ? ` de ${monthLabel}` : ""}. Motivo: ${reason}.`
        );
    }

    addAuditLog(
        AUDIT_CATEGORY.WORKER_REQUESTS,
        "Rechazo solicitud de trabajador",
        `${request.profile}: ${requestTypeLabel(request.type)}. Motivo: ${reason}.`,
        {
            profile: request.profile,
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
    await acceptWorkspaceLink(request.linkId);

    addAuditLog(
        AUDIT_CATEGORY.WORKER_REQUESTS,
        "Acepto enlace entre unidades",
        `${request.fromWorkspaceName}: solicitud de enlace aceptada.`,
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
    const allRequests = [
        ...linkRequests,
        ...workerRequests,
        ...replacementRequests
    ];
    const requests = filterRequestsBySelectedMonth(allRequests);
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
                    Revisa y gestiona solicitudes de trabajadores y enlaces entre unidades.
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

            button.disabled = true;

            const accepting =
                button.dataset.workerRequestAction === "accept";

            if (isWorkspaceLinkRequest(request)) {
                if (accepting) {
                    await acceptWorkspaceLinkRequest(request);
                } else {
                    await rejectWorkspaceLinkRequest(request);
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
}
