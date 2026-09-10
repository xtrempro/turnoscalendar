import { isoFromKey, keyFromDate, toISODate } from "./dateUtils.js";
import { normalizeText } from "./stringUtils.js";
import { buildSharedHomeTaskReminders } from "./homeSharedTasks.js";
// El registro de enlaces vive aparte para que replacements.js -y con el, el
// motor del servidor- pueda consultarlo sin arrastrar el cliente Firebase.
import {
    findProfileForLink,
    getWorkerAppLinkForProfile,
    getWorkerAppLinkList,
    getWorkerAppLinks,
    setWorkerAppLinks
} from "./workerAppLinks.js";
// Los constructores de los dos documentos livianos viven en un solo sitio, que
// es el MISMO que empaqueta la Cloud Function. Antes habia una copia aqui y
// otra en serverEngine.js, y cada campo nuevo habia que cablearlo dos veces.
import {
    buildLinkedWorkerDocuments,
    buildWorkerMessageDirectoryPayload,
    buildSwapCandidatePayload,
    workerLinkRecency,
    linkedDocChanged
} from "./serverLinkedDocs.js";
import { TURNO } from "./constants.js";
import {
    getCurrentFirebaseUser,
    getFirebaseServices
} from "./firebaseClient.js";
import {
    flushPendingFirebaseAppStateEntries
} from "./firebaseAppState.js";
import { getActiveWorkspace } from "./workspaces.js";
import { getJSON } from "./persistence.js";
import {
    getProfiles,
    getRotativa,
    getShiftAssigned,
    getManualLeaveBalances,
    isProfileActive,
    getTurnChangeConfig,
    getCompensationProfileAt,
    getGradeHistory
} from "./storage.js";
import {
    aplicarCambiosTurno,
    getTurnoBase,
    getTurnoProgramado
} from "./turnEngine.js";
import { turnoLabel } from "./uiEngine.js";
import {
    getTurnoExtraAgregado,
    obtenerLabelDia
} from "./rulesEngine.js";
import { heldLeaveKeys } from "./leaveHold.js";
import { canSwapProfiles, activeMonthlySwapCount, getCambioTurnoCalendario } from "./swaps.js";
import { getWorkerBlockedDays } from "./workerAvailability.js";
import {
    buildWorkerHheeMonthSummary,
    buildWorkerHheeSummaries,
    buildWorkerReportPreviewHTML,
    createAttendanceMarksReader
} from "./hoursReport.js";
import { fetchHolidays, getCachedHolidays } from "./holidays.js";
import { getTurnoColorConfig } from "./turnoColors.js";
import { withManualBalance } from "./balanceUtils.js";
import {
    getDayColorGradient,
    buildHexColorResolver
} from "./dayColorBands.js";
import {
    planWorkerLinkSnapshot,
    runCooperativeQueue
} from "./workerAppPublishQueue.js";
import {
    monthScheduleBounds,
    normalizeProfileTargets,
    splitDaysByMonth
} from "./workerAppMonths.js";
import { baseRenderDay } from "./rotationBase.js";
import {
    measurePerformance,
    recordPerformanceEvent,
    startPerformanceSpan
} from "./performanceMonitor.js";
import {
    buildCalendarChangeEventFromStorageMutation,
    flushCalendarChangeEvents,
    registerWorkerCalendarChange
} from "./calendarChangeEvents.js";
import { addTaskAssignmentsToSchedule } from "./taskAssignmentProjection.js";

// Publicacion "caliente": se agenda con margen para no competir con
// clicks/cambios de mes del calendario principal. La PWA puede navegar meses
// futuros; por eso materializamos el mes actual + 6 meses hacia delante.
const HOT_PUBLISH_DELAY_MS = 12000;
const CALENDAR_CHANGE_PUBLISH_DELAY_MS = 3000;
const INITIAL_PUBLISH_DELAY_MS = 5000;
const WORKER_APP_USER_QUIET_MS = 45000;
const WORKER_APP_ACTIVE_RETRY_MS = 8000;
const WORKER_APP_COLD_USER_QUIET_MS = 90000;
const WORKER_APP_VISIBLE_RETRY_MS = 60000;
const WORKER_APP_CALENDAR_VISIBLE_RETRY_MS = 120000;
const WORKER_APP_FOREGROUND_RESUME_COOLDOWN_MS = 180000;
// Documentos por lote al publicar los docs de los enlazados.
//
// OJO con subirlo. Estos documentos son grandes (el candidato lleva el calendario
// del trabajador y el universo de compatibilidad) y el limite que importa no es
// el de 500 operaciones sino los BYTES: con lotes de 50 el backend cerraba el
// stream con `resource-exhausted` y un solo commit llegaba a tardar 29 s,
// dejando detras hasta las escrituras de un unico documento. Es el mismo muro
// que ya documenta `publishSharedScheduleNow` ("Transaction too big").
const WORKER_DOC_BATCH_SIZE = 10;
// Los resumenes HH.EE son caros: se mantienen acotados (no crecen con la
// ventana del calendario).
const OVERTIME_SUMMARY_MONTHS_BACK = 2;
// v2: los resumenes ahora incluyen `extraShifts` (detalle por turno para la PWA).
const OVERTIME_SUMMARY_CACHE_VERSION = 2;
const COLD_OVERTIME_REFRESH_DELAY_MS = 45000;
const LEGAL_CONTINUOUS_BLOCK_DAYS = 10;
const HOT_CALENDAR_FUTURE_MONTH_COUNT = 6;
const WORKER_APP_PROJECTION_PROFILE_STATE_PREFIXES = [
    "data_",
    "baseData_",
    "blocked_",
    "admin_",
    "legal_",
    "comp_",
    "absences_",
    "rotativa_",
    "shift_",
    "shiftAssignmentHistory_",
    "gradeHistory_",
    "contractHistory_",
    "leaveBalances_",
    "hourReturns_",
    "clockMarks_",
    // La cobertura decide si un permiso ya puede viajar: sin estas dos, la Cloud
    // Function las leeria viejas y publicaria (o seguiria escondiendo) permisos
    // que aqui ya se resolvieron. Ver js/leaveHold.js.
    "noCoverage_",
    "leaveHold_"
];
const WORKER_APP_PROJECTION_GLOBAL_STATE_KEYS = [
    "profiles",
    "replacements",
    "swaps",
    "manualHolidays",
    "turnoColorConfig",
    "turnChangeConfig",
    "weekly_task_assignment_tasks",
    "weekly_task_assignment_entries",
    "weekly_task_assignment_updated"
];

// Claves de localStorage por-perfil que afectan lo que ve el trabajador. El
// sufijo tras el prefijo es el nombre del perfil (salvo `carry_<nombre>_<a>_<m>`).
const PROFILE_KEY_PREFIXES = [
    "data_",
    "baseData_",
    "blocked_",
    "admin_",
    "legal_",
    "comp_",
    "absences_",
    "rotativa_",
    "shift_",
    "shiftAssignmentHistory_",
    "leaveBalances_",
    "hourReturns_",
    "hheeReturnTransfers_",
    "clockMarks_",
    "gradeHistory_",
    "contractHistory_",
    "carry_",
    // Cubrir un turno (o marcarlo sin cobertura) puede LIBERAR un permiso que
    // estaba en espera: el calendario del trabajador cambia sin que cambie
    // ningun mapa de permisos. Ver js/leaveHold.js.
    "noCoverage_",
    "leaveHold_"
];

// Las claves globales se reconocen, pero no disparan una republicacion masiva:
// la accion que las origina debe indicar los perfiles realmente afectados.
const GLOBAL_RELEVANT_KEYS = new Set([
    "replacements",
    "swaps",
    "manualHolidays",
    "turnoColorConfig",
    "turnChangeConfig",
    "staffing_custom_reminders",
    "weekly_task_assignment_tasks",
    "weekly_task_assignment_entries",
    "weekly_task_assignment_updated",
    "gradeHourConfig",
    "profiles"
]);

let activeWorkspace = null;
let unsubscribeWorkerLinks = null;
let hotPublishTimer = null;
let hotPublishInFlight = false;
let hotPublishRequested = false;
let hotPublishNeedsLocalStateFlush = false;
// Claves globales pesadas que solo se vacian cuando cambiaron de verdad
// (hoy: el archivo del reloj). Se acumulan igual que dirtyProfileNames.
let hotPublishExtraStateKeys = new Set();
let workerLinksInitialized = false;
let syncGeneration = 0;
let workerAppLastUserActivityAt = Date.now();
let workerAppForegroundResumeBlockedUntil = 0;

// Solo se publican perfiles/UID marcados de forma explicita.
let dirtyProfileNames = new Set();
let dirtyWorkerUids = new Set();
const coldOvertimeRefreshTimers = new Map();
const coldOvertimeRefreshInFlight = new Set();
const coldReportsRefreshTimers = new Map();
const coldReportsRefreshInFlight = new Set();
const coldExceptionsRefreshTimers = new Map();
const coldExceptionsRefreshInFlight = new Set();

function normalizeRut(value) {
    return String(value || "")
        .replace(/[^0-9kK]/g, "")
        .toUpperCase();
}

function addDays(date, amount) {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return next;
}

function waitWorkerAppIdle(timeout = 1200) {
    return new Promise(resolve => {
        if (typeof window === "undefined") {
            resolve();
            return;
        }

        if (document.visibilityState === "hidden") {
            window.setTimeout(resolve, Math.min(1000, Number(timeout) || 1000));
            return;
        }

        if (typeof window.requestIdleCallback === "function") {
            window.requestIdleCallback(
                () => resolve(),
                { timeout: Math.max(300, Number(timeout) || 1200) }
            );
            return;
        }

        window.setTimeout(resolve, 80);
    });
}

function waitWorkerAppDelay(ms) {
    return new Promise(resolve =>
        setTimeout(resolve, Math.max(0, Number(ms) || 0))
    );
}

function markWorkerAppUserActivity() {
    workerAppLastUserActivityAt = Date.now();
}

function workerAppHasPendingInput() {
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

function workerAppInteractiveDelay(quietMs = WORKER_APP_USER_QUIET_MS) {
    if (typeof document === "undefined") return 0;
    if (document.visibilityState !== "visible") return 0;

    const resumeDelay =
        workerAppForegroundResumeBlockedUntil - Date.now();

    if (resumeDelay > 0) {
        return Math.max(resumeDelay, WORKER_APP_ACTIVE_RETRY_MS);
    }

    // Escribir documentos PWA puede activar serializacion pesada de Firestore.
    // En foreground solo se agenda; al ocultar la pestaña se vacia la cola.
    const delay = Math.max(
        WORKER_APP_VISIBLE_RETRY_MS,
        WORKER_APP_ACTIVE_RETRY_MS,
        Number(quietMs) || WORKER_APP_USER_QUIET_MS
    );
    const activeView = document.body?.dataset?.activeView || "";

    if (activeView === "turnos" || activeView === "timeline") {
        return Math.max(delay, WORKER_APP_CALENDAR_VISIBLE_RETRY_MS);
    }

    return workerAppHasPendingInput()
        ? Math.max(delay, WORKER_APP_ACTIVE_RETRY_MS)
        : delay;
}

function recordWorkerAppPublishDeferred(delay, reason = "user-active") {
    recordPerformanceEvent("worker-app:publish-deferred", {
        type: "worker-app",
        reason,
        delay,
        dirtyProfiles: dirtyProfileNames.size,
        dirtyWorkers: dirtyWorkerUids.size
    });
}

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

// ───────── Helpers de meses ─────────
// Un mes se representa como { year, monthIndex } (monthIndex 0-based) y tiene un
// id estable `YYYY-MM` (1-based con padding) para cache y firmas.

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

function normalizeWorkerLink(docSnap) {
    const data = docSnap.data() || {};
    const uid = String(data.uid || docSnap.id || "").trim();

    if (!uid) return null;

    // Se considera enlazado por la EXISTENCIA del documento, igual que las
    // reglas de Firestore (workerLinkExists). Desenlazar elimina el documento,
    // por lo que aqui basta con que exista para tratar al trabajador como
    // enlazado (evita el estado inconsistente del status "unlinked").
    return {
        id: docSnap.id,
        ...data,
        uid,
        status: String(data.status || "active").trim()
    };
}

// Se reexportan para no tocar a los diez modulos que ya los importaban desde
// aqui; la implementacion vive en workerAppLinks.js.
export { getWorkerAppLinkForProfile, getWorkerAppLinks };

// Ubica el enlace de un perfil recien renombrado. Primero con la tolerancia
// habitual (RUT o nombre normalizado contra el perfil ya guardado con el nombre
// nuevo); si el perfil no tiene RUT y el nombre cambio de verdad, queda el
// nombre viejo del propio enlace como ultimo recurso.
function findWorkerLinkForRename(oldName, newName) {
    const direct = getWorkerAppLinkForProfile(newName);

    if (direct) return direct;

    const previous = normalizeText(oldName);

    if (!previous) return null;

    return getWorkerAppLinkList().find(link =>
        normalizeText(link.profileName) === previous
    ) || null;
}

/**
 * Copia el nombre nuevo del perfil al enlace del trabajador en Firestore.
 *
 * updateProfile migra todas las claves locales del trabajador, pero no puede
 * tocar Firestore: workerLinks/{uid}.profileName se quedaba con el nombre viejo
 * PARA SIEMPRE (proturnos:profileRenamed no tenia ni un listener). La PWA lee su
 * espejo users/{uid}/workerLinks/{ws} pero lo pisa con este documento canonico,
 * y copia ese profileName dentro de CADA solicitud que envia.
 *
 * Con el nombre viejo viajando en las solicitudes, aceptar un permiso lo
 * escribia en un perfil que no existe -el almacenamiento por trabajador se
 * indexa por nombre-, sin dar ningun error: quedaba aceptado en el LOG y jamas
 * aparecia en el calendario. resolveProfileName (workerRequests.js) ya tolera el
 * desfase; esto ademas lo evita de raiz.
 */
export async function syncWorkerLinkProfileName(oldName, newName) {
    const nextName = String(newName || "").trim();

    if (!nextName || nextName === String(oldName || "").trim()) return false;

    const link = findWorkerLinkForRename(oldName, nextName);
    const workspace = getActiveWorkspace();

    if (!link?.uid || !workspace?.id) return false;
    if (link.profileName === nextName) return false;

    try {
        const { db, firestoreModule } = await getFirebaseServices();

        await firestoreModule.setDoc(
            firestoreModule.doc(
                db,
                "workspaces",
                workspace.id,
                "workerLinks",
                link.uid
            ),
            {
                // Las reglas exigen que el uid siga en el documento resultante.
                uid: link.uid,
                profileName: nextName,
                updatedAt: firestoreModule.serverTimestamp()
            },
            { merge: true }
        );

        return true;
    } catch (error) {
        console.warn(
            "No se pudo actualizar el nombre del trabajador en su enlace.",
            error
        );
        return false;
    }
}

function notificationMessageId() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Envia una notificacion a la app del trabajador escribiendo un mensaje de
 * supervisor en su hilo (lo que dispara la push existente). Si el trabajador no
 * tiene la app enlazada, no hace nada y devuelve false.
 */
export async function notifyWorkerApp(profileName, text) {
    const message = String(text || "").trim();

    if (!profileName || !message) return false;

    const link = getWorkerAppLinkForProfile(profileName);
    const workspace = getActiveWorkspace();

    if (!link?.uid || !workspace?.id) return false;

    try {
        const user = getCurrentFirebaseUser();
        const { db, firestoreModule } = await getFirebaseServices();
        const threadRef = firestoreModule.doc(
            db,
            "workspaces",
            workspace.id,
            "workerMessages",
            link.uid
        );
        const messageRef = firestoreModule.doc(
            firestoreModule.collection(threadRef, "messages"),
            notificationMessageId()
        );
        const now = firestoreModule.serverTimestamp();

        await firestoreModule.writeBatch(db)
            .set(
                threadRef,
                {
                    uid: link.uid,
                    workspaceId: workspace.id,
                    workspaceName: workspace.name || link.workspaceName || "",
                    profileName: link.profileName || profileName,
                    profileRut: link.profileRut || "",
                    workerEmail: link.workerEmail || "",
                    lastMessage: message,
                    lastSender: "supervisor",
                    unreadForWorker: true,
                    unreadForSupervisor: false,
                    updatedAt: now
                },
                { merge: true }
            )
            .set(messageRef, {
                id: messageRef.id,
                workspaceId: workspace.id,
                workerUid: link.uid,
                profileName: link.profileName || profileName,
                profileRut: link.profileRut || "",
                text: message,
                sender: "supervisor",
                senderUid: user?.uid || "",
                senderName: user?.displayName || user?.email || "Supervisor",
                createdAt: now,
                readBySupervisor: true,
                readByWorker: false
            })
            .commit();

        return true;
    } catch (error) {
        console.warn("No se pudo notificar al trabajador.", error);
        return false;
    }
}

function classNameForDay(state, hasLeave) {
    if (hasLeave) return "permiso";

    switch (Number(state) || TURNO.LIBRE) {
        case TURNO.LARGA:
            return "larga";
        case TURNO.NOCHE:
            return "noche";
        case TURNO.TURNO24:
            return "turno24";
        case TURNO.DIURNO:
            return "diurno";
        case TURNO.DIURNO_NOCHE:
            return "diurno-noche";
        case TURNO.MEDIA_MANANA:
        case TURNO.MEDIA_TARDE:
            return "half";
        case TURNO.TURNO18:
            return "turno18";
        default:
            return "libre";
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
// Copia identica en serverEngine.js (motor duplicado).
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

// Calcula los dias de UN mes (objeto keyed por ISO). Reproduce la logica
// dia-a-dia original, acotada al mes pedido.
// Tipo de permiso CANCELABLE por el trabajador para un dia (mismos tipos que
// LEAVE_CANCEL_TYPES del supervisor). "" si no es cancelable o no hay permiso.
// Copia identica a la de serverEngine.js (motor duplicado).
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
        // Cambio de turno aplicado: CCTT (entrega su turno) / DDTT (lo devuelve),
        // el mismo marcador que muestra el calendario del supervisor. Debe ir tanto
        // aca (publicacion del cliente supervisor) como en serverEngine.js (Cloud
        // Function): son dos copias del motor.
        const swapMarker = getCambioTurnoCalendario(profile.name, keyDay);
        const programmedTurn = getTurnoProgramado(profile.name, keyDay);
        const actualTurn = aplicarCambiosTurno(
            profile.name,
            keyDay,
            programmedTurn
        );
        const baseTurn = getTurnoBase(profile.name, keyDay);
        const baseWithSwaps = aplicarCambiosTurno(
            profile.name,
            keyDay,
            baseTurn,
            { includeReplacements: false }
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
            getTurnoExtraAgregado(
                baseWithSwaps,
                programmedWithSwaps
            )
        );
        const visualLabel = obtenerLabelDia(
            keyDay,
            actualTurn,
            maps.admin,
            maps.legal,
            maps.comp,
            maps.absences,
            turnoLabel
        );
        const hasLeave = Boolean(
            maps.admin[keyDay] ||
            maps.legal[keyDay] ||
            maps.comp[keyDay] ||
            maps.absences[keyDay]
        );
        const label = turnoLabel(actualTurn) || "Libre";
        const colorGradient = getDayColorGradient(
            profile.name,
            keyDay,
            actualTurn,
            cursor,
            holidaysByYear[year],
            maps.admin[keyDay],
            baseWithSwaps,
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
            // PWA, incluso si lo aplico el supervisor). Solo cuando corresponde.
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
            // Solo cuando hay cambio, para no engordar la proyeccion.
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

// El navegador supervisor solo calcula el mes actual y el siguiente. Los meses
// historicos se materializan bajo demanda en la Cloud Function.
function computeProfileSchedule(profile) {
    const today = new Date();
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

function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }

    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map(key =>
            `${JSON.stringify(key)}:${stableStringify(value[key])}`
        ).join(",")}}`;
    }

    return JSON.stringify(value);
}

function hashText(value) {
    let hash = 2166136261;
    const text = String(value || "");

    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
}

function rawLocalStorageValue(key) {
    try {
        return window.localStorage.getItem(key);
    } catch (_error) {
        return null;
    }
}

function rawLocalStorageEntriesByPrefix(prefix) {
    try {
        return Object.keys(window.localStorage)
            .filter(key => key.startsWith(prefix))
            .sort()
            .map(key => [key, window.localStorage.getItem(key)]);
    } catch (_error) {
        return [];
    }
}

function buildOvertimeSummarySignature(profile, schedule) {
    const profileName = profile?.name || "";
    const today = new Date();
    const exactKeys = [
        "replacements",
        "swaps",
        "manualHolidays",
        "gradeHourConfig",
        "profiles",
        `data_${profileName}`,
        `baseData_${profileName}`,
        `admin_${profileName}`,
        `legal_${profileName}`,
        `comp_${profileName}`,
        `absences_${profileName}`,
        `rotativa_${profileName}`,
        `shift_${profileName}`,
        `shiftAssignmentHistory_${profileName}`,
        `leaveBalances_${profileName}`,
        `hourReturns_${profileName}`,
        `hheeReturnTransfers_${profileName}`,
        `clockMarks_${profileName}`,
        `gradeHistory_${profileName}`,
        `contractHistory_${profileName}`
    ];
    const manualExtraDays = Object.values(schedule?.days || {})
        .filter(day => day?.isManualExtra)
        .map(day => [
            day.iso || "",
            Number(day.turno) || 0,
            Number(day.baseTurn) || 0,
            Number(day.programmedTurn) || 0
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const payload = {
        version: OVERTIME_SUMMARY_CACHE_VERSION,
        window: {
            year: today.getFullYear(),
            month: today.getMonth(),
            monthsBack: OVERTIME_SUMMARY_MONTHS_BACK
        },
        profile: {
            name: profileName,
            rut: profile?.rut || "",
            role: profile?.estamento || "",
            profession: profile?.profession || "",
            active: isProfileActive(profile)
        },
        shiftAssigned: Boolean(getShiftAssigned(profileName)),
        rotativa: getRotativa(profileName),
        schedule: {
            start: schedule?.start || "",
            end: schedule?.end || "",
            manualExtraDays
        },
        storage: exactKeys.map(key => [key, rawLocalStorageValue(key)]),
        carry: rawLocalStorageEntriesByPrefix(`carry_${profileName}_`)
    };

    return hashText(stableStringify(payload));
}

// ───────── Excepciones (rediseno de sincronizacion) ─────────
// La PWA calcula la rotativa base para cualquier mes con la MISMA secuencia
// (rotationBase.js / rotationEngine.js). Aqui solo publicamos el mapa disperso
// de dias donde lo real difiere de esa base (cambios de turno, permisos,
// ediciones manuales, feriados en diurno, reemplazos...). El pasado mas antiguo
// que EXCEPTIONS_MONTHS_BACK es inmutable y queda cacheado en cada PWA; el
// futuro lejano lo calcula la PWA desde la secuencia.
const EXCEPTIONS_MONTHS_BACK = 2;
const EXCEPTIONS_MONTHS_FORWARD = 12;
const WORKER_APP_BASE_VERSION = 1;
const WORKER_APP_CONTRACT_PROFILE_VERSION = 2;
const WORKER_APP_MONTH_REPLACE_VERSION = 2;

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

function dayDiffersFromBase(actual, base) {
    return (
        (Number(actual.turno) || TURNO.LIBRE) !== (Number(base.turno) || TURNO.LIBRE) ||
        String(actual.displayLabel || "") !== String(base.displayLabel || "") ||
        String(actual.className || "") !== String(base.className || "") ||
        Boolean(actual.hasLeave) !== Boolean(base.hasLeave) ||
        Boolean(actual.isManualExtra) !== Boolean(base.isManualExtra) ||
        // Un dia con marcador CCTT/DDTT se publica como excepcion aunque el turno
        // coincida con la base.
        String(actual.swapMarker?.label || "") !== String(base.swapMarker?.label || "")
    );
}

// Recorre la ventana de barrido y devuelve solo los dias-excepcion (objeto-dia
// completo, con colorGradient) para que la PWA los superponga sobre su base.
function computeProfileExceptions(profile) {
    const rotativa = getRotativa(profile.name);
    const { start, end } = exceptionsScanRange();
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

function isBusinessDayForLegal(date, holidays) {
    const day = date.getDay();

    return day !== 0 &&
        day !== 6 &&
        !holidays[keyFromDate(date)];
}

async function hasContinuousLegalBlock(
    profileName,
    year,
    holidays = null
) {
    const legal = profileLeaveMaps(profileName).legal;
    const yearHolidays = holidays || await fetchHolidays(year);
    const cursor = new Date(year, 0, 1);
    let currentRun = 0;

    while (cursor.getFullYear() === year) {
        const key = keyFromDate(cursor);

        if (isBusinessDayForLegal(cursor, yearHolidays)) {
            currentRun = legal[key] ? currentRun + 1 : 0;

            if (currentRun >= LEGAL_CONTINUOUS_BLOCK_DAYS) {
                return true;
            }
        }

        cursor.setDate(cursor.getDate() + 1);
    }

    return false;
}

function dateFromCalendarKey(key) {
    const [year, month, day] = String(key || "")
        .split("-")
        .map(Number);

    if (!year || !month || !day) return null;

    return new Date(year, month - 1, day);
}

function usedBusinessDays(map, year, holidays) {
    return Object.keys(map || {}).reduce((total, key) => {
        if (!key.startsWith(`${year}-`)) return total;

        const date = dateFromCalendarKey(key);

        return date && isBusinessDayForLegal(date, holidays)
            ? total + 1
            : total;
    }, 0);
}

function usedAdministrativeDays(map, year) {
    return Object.entries(map || {}).reduce((total, [key, value]) => {
        if (!key.startsWith(`${year}-`)) return total;

        return total + (value === 1 ? 1 : 0.5);
    }, 0);
}

async function balancesForYear(profileName, year) {
    const maps = profileLeaveMaps(profileName);
    const holidays = await fetchHolidays(year);
    const manual = getManualLeaveBalances(year, profileName);
    const calculated = {
        legal: Math.max(
            0,
            15 - usedBusinessDays(maps.legal, year, holidays)
        ),
        admin: Math.max(
            0,
            6 - usedAdministrativeDays(maps.admin, year)
        ),
        comp: Math.max(
            0,
            10 - usedBusinessDays(maps.comp, year, holidays)
        )
    };
    const legalContinuousBlockTaken =
        await hasContinuousLegalBlock(profileName, year, holidays);

    return {
        year,
        balances: {
            legal: Math.max(
                0,
                Math.floor(
                    withManualBalance(manual.legal, calculated.legal)
                )
            ),
            admin: withManualBalance(manual.admin, calculated.admin),
            comp: withManualBalance(manual.comp, calculated.comp),
            hoursReturn: withManualBalance(manual.hoursReturn, 0)
        },
        legalReserveDays: LEGAL_CONTINUOUS_BLOCK_DAYS,
        legalContinuousBlockTaken,
        legalReserveRequired: !legalContinuousBlockTaken
    };
}

async function leaveBalancesByScheduleYear(profileName, schedule) {
    const startYear = Number(String(schedule.start || "").slice(0, 4));
    const endYear = Number(String(schedule.end || "").slice(0, 4));
    const currentYear = new Date().getFullYear();
    const firstYear = Number.isFinite(startYear)
        ? Math.min(startYear, currentYear)
        : currentYear;
    const lastYear = Number.isFinite(endYear)
        ? Math.max(endYear, currentYear)
        : currentYear;
    const years = [];

    for (let year = firstYear; year <= lastYear; year++) {
        years.push(year);
    }

    const payloads = await Promise.all(
        years.map(year => balancesForYear(profileName, year))
    );

    return Object.fromEntries(
        payloads.map(payload => [String(payload.year), payload])
    );
}

// Misma clave que usa staffing.js para los recordatorios del supervisor.
const STAFFING_REMINDERS_KEY = "staffing_custom_reminders";
const STAFFING_REMINDER_ESTAMENTO_PREFIX = "estamento:";
const STAFFING_RECURRENCE_TO_WORKER = {
    once: "Una sola vez",
    yearly: "Anual",
    monthly: "Mensual"
};

// Indica si un recordatorio del supervisor va dirigido al trabajador segun su
// estamento. "all"/"private" son solo para administradores (no se envian).
function staffingReminderTargetsProfile(reminder, profileRole) {
    const visibility = String(reminder?.visibility || "");

    if (visibility === "workers") return true;

    if (visibility.startsWith(STAFFING_REMINDER_ESTAMENTO_PREFIX)) {
        const target = normalizeText(
            visibility.slice(STAFFING_REMINDER_ESTAMENTO_PREFIX.length)
        );

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
                    STAFFING_RECURRENCE_TO_WORKER[reminder.recurrence] ||
                    "Una sola vez",
                source: "Supervisor"
            }))
        : [];

    return [
        ...fromReminders,
        ...buildSharedHomeTaskReminders(profile, today)
    ];
}

async function computeOvertimeSummaries(profile, schedule) {
    return measurePerformance(
        "worker-app:compute-overtime-summaries",
        async () => {
            try {
                const baseSummaries = await buildWorkerHheeSummaries(
                    profile,
                    OVERTIME_SUMMARY_MONTHS_BACK
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
                    /^\d{4}-\d{2}$/.test(monthKey) &&
                    !includedMonths.has(monthKey)
                )
        ));
        const manualExtraSummaries = await Promise.all(
            manualExtraMonths.map(monthKey => {
                const [year, month] = monthKey.split("-").map(Number);

                return buildWorkerHheeMonthSummary(
                    profile,
                    new Date(year, month - 1, 1)
                );
            })
        );

                return [...baseSummaries, ...manualExtraSummaries]
                    .filter(Boolean)
                    .sort((a, b) =>
                        Number(a.year) - Number(b.year) ||
                        Number(a.month) - Number(b.month)
                    );
            } catch (error) {
                console.warn(
                    "No se pudo calcular el resumen HHEE para la app del trabajador.",
                    error
                );
                return [];
            }
        },
        {
            profile: profile?.name || "",
            dayCount: Object.keys(schedule?.days || {}).length
        },
        {
            asyncThreshold: 120
        }
    );
}

function normalizeOvertimeSummaries(value) {
    return Array.isArray(value)
        ? value.filter(item =>
            item &&
            Number.isFinite(Number(item.year)) &&
            Number.isFinite(Number(item.month))
        )
        : [];
}

async function buildOvertimeSummaries(profile, schedule, previousPayload = null) {
    const signature = buildOvertimeSummarySignature(profile, schedule);
    const cachedSummaries = normalizeOvertimeSummaries(
        previousPayload?.overtimeSummaries
    );
    const previousSignature =
        previousPayload?.overtimeSummariesSignature || "";

    if (
        cachedSummaries.length &&
        previousSignature === signature &&
        Number(previousPayload?.overtimeSummariesCacheVersion || 0) ===
            OVERTIME_SUMMARY_CACHE_VERSION
    ) {
        return {
            summaries: cachedSummaries,
            signature,
            targetSignature: "",
            status: "fresh",
            source: "cache",
            refreshNeeded: false
        };
    }

    if (cachedSummaries.length) {
        return {
            summaries: cachedSummaries,
            signature: previousSignature,
            targetSignature: signature,
            status: "refreshing",
            source: "stale-cache",
            refreshNeeded: true
        };
    }

    const summaries = await computeOvertimeSummaries(profile, schedule);

    return {
        summaries,
        signature,
        targetSignature: "",
        status: "fresh",
        source: "computed",
        refreshNeeded: false
    };
}

// Reporte imprimible (HTML) por mes para la app del trabajador. Para no inflar
// el documento de Firestore ni gastar CPU, se generan AUTOMATICAMENTE solo el
// mes actual y el anterior. Los demas meses se entregan a pedido del trabajador
// (boton "Solicitar informe" en la PWA -> workerRequests type "report_request").
async function buildWorkerReports(profile) {
    return measurePerformance(
        "worker-app:build-reports",
        async () => {
            const reports = {};
            const today = new Date();
            const months = [
                new Date(today.getFullYear(), today.getMonth(), 1),
                new Date(today.getFullYear(), today.getMonth() - 1, 1)
            ];

            for (const date of months) {
                const year = date.getFullYear();
                const month = date.getMonth();

                try {
                    const html = await buildWorkerReportPreviewHTML(
                        profile,
                        new Date(year, month, 1)
                    );

                    if (html) reports[`${year}-${month}`] = html;
                } catch (error) {
                    console.warn(
                        "No se pudo construir el reporte para la app del trabajador.",
                        error
                    );
                }
            }

            return reports;
        },
        {
            profile: profile?.name || "",
            monthCount: 2
        },
        {
            asyncThreshold: 120
        }
    );
}

function buildSwapLimit(profileName) {
    const config = getTurnChangeConfig();
    const limit = Number(config.monthlySwapLimit) || 0;
    const now = new Date();
    const used = activeMonthlySwapCount(
        profileName,
        now.getFullYear(),
        now.getMonth()
    );

    return {
        enabled: config.limitMonthlySwaps === true && limit > 0,
        limit,
        used,
        year: now.getFullYear(),
        month: now.getMonth()
    };
}

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
    const grid = normalizePublishedScheduleGrid(value.grid);
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


// La programacion que ve el trabajador sale de la ASIGNACION DE TAREAS, no del
// Excel. La grilla la construye `taskAssignments.js`, que YA importa este
// modulo: importarlo de vuelta cerraria un ciclo, asi que el proveedor se
// registra al cargar en vez de importarse.
let taskScheduleGridProvider = null;

export function registerTaskScheduleGridProvider(provider) {
    taskScheduleGridProvider = typeof provider === "function" ? provider : null;
}

// Ventana de tres semanas: la anterior, la actual y la siguiente. Es lo que el
// trabajador consulta en la practica, y mantiene acotado un documento que se
// escribe entero en cada publicacion.
const TASK_SCHEDULE_PUBLISHED_WEEKS = [-1, 0, 1];

function taskScheduleAttachments() {
    if (!taskScheduleGridProvider) return [];

    const base = schedulePublicationWeekStart(new Date());

    return TASK_SCHEDULE_PUBLISHED_WEEKS.map(offset => {
        const start = new Date(base);

        start.setDate(start.getDate() + offset * 7);

        let grid = null;

        try {
            grid = taskScheduleGridProvider(start);
        } catch (error) {
            console.warn(
                "No se pudo armar la programacion de tareas para publicar.",
                error
            );
            return null;
        }

        if (!grid?.rows?.length) return null;

        return normalizePublishedScheduleAttachment({
            name: "Programación de tareas",
            grid: { days: grid.days, rows: grid.rows },
            updatedAtISO: grid.updatedAtISO,
            weekStartISO: schedulePublicationWeekStartISO(start)
        }, start);
    }).filter(Boolean);
}

// La UNICA programacion posible es la del tablero de tareas. Adjuntar un Excel
// dejo de existir, asi que ya no hay adjunto que mezclar ni al que caer.
function getPublishedScheduleAttachments() {
    const attachments = {};

    taskScheduleAttachments().forEach(entry => {
        attachments[entry.weekStartISO] = entry;
    });

    return attachments;
}

function getPublishedScheduleAttachment(
    start = new Date(),
    attachments = getPublishedScheduleAttachments()
) {
    return attachments[schedulePublicationWeekStartISO(start)] || null;
}

async function buildWorkerAppPayload(
    link,
    profile,
    workspace,
    previousPayload = null
) {
    return measurePerformance(
        "worker-app:build-payload",
        async () => {
            const schedule = measurePerformance(
                "worker-app:compute-schedule",
                () => computeProfileSchedule(profile),
                {
                    profile: profile?.name || ""
                }
            );
            const leaveBalancesByYear = await leaveBalancesByScheduleYear(
                profile.name,
                schedule
            );
            const currentYear = String(new Date().getFullYear());
            const leaveBalances = leaveBalancesByYear[currentYear];
            const cachedOvertimeSummaries =
                normalizeOvertimeSummaries(previousPayload?.overtimeSummaries);
            const overtimePayload = {
                summaries: cachedOvertimeSummaries,
                signature:
                    previousPayload?.overtimeSummariesSignature || "",
                targetSignature: "pending",
                status: cachedOvertimeSummaries.length
                    ? "refreshing"
                    : "pending",
                source: cachedOvertimeSummaries.length
                    ? "stale-cache"
                    : "deferred",
                updatedAtISO:
                    previousPayload?.overtimeSummariesUpdatedAtISO || ""
            };
            const reportsByMonth =
                previousPayload?.reportsByMonth &&
                typeof previousPayload.reportsByMonth === "object"
                    ? previousPayload.reportsByMonth
                    : {};
            const effectiveProfile =
                getCompensationProfileAt(profile.name, new Date()) ||
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
            const weeklyScheduleAttachments =
                getPublishedScheduleAttachments();
            const weeklyScheduleAttachment =
                getPublishedScheduleAttachment(
                    new Date(),
                    weeklyScheduleAttachments
                );
            const profession = profileText(
                profile.profession,
                profile.profesion,
                profile.jobTitle,
                profile.cargo
            );
            const contractTimeline =
                buildContractTimeline(profile);
            const previousExceptionsRange = exceptionsScanRange();
            const exceptionsJson = typeof previousPayload?.exceptionsJson === "string"
                ? previousPayload.exceptionsJson
                : "{}";
            const exceptionsCount = Number.isFinite(
                Number(previousPayload?.exceptionsCount)
            )
                ? Number(previousPayload.exceptionsCount)
                : 0;
            const exceptionsStart =
                previousPayload?.exceptionsStart ||
                toISODate(previousExceptionsRange.start);
            const exceptionsEnd =
                previousPayload?.exceptionsEnd ||
                toISODate(previousExceptionsRange.end);

            scheduleColdOvertimeSummaryRefresh({
                link,
                profile,
                workspace,
                schedule
            });
            scheduleColdWorkerReportsRefresh({
                link,
                profile,
                workspace
            });
            scheduleColdWorkerExceptionsRefresh({
                link,
                profile,
                workspace
            });

            return {
                uid: link.uid,
                workspaceId: workspace.id,
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
                    // Se publica para que la PWA sepa el tipo de contrato (p.ej.
                    // Honorarios no puede solicitar permisos ni tiene vacaciones).
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
                baseVersion: WORKER_APP_BASE_VERSION,
                contractProfileVersion: WORKER_APP_CONTRACT_PROFILE_VERSION,
                // Serializado a string: bajo setDoc({merge:true}) un string se reemplaza
                // entero, mientras que un mapa haria deep-merge y dejaria pegadas claves
                // de dias que ya dejaron de ser excepcion.
                exceptionsJson,
                exceptionsCount,
                exceptionsStart,
                exceptionsEnd,
                exceptionsStatus: "refreshing",
                leaveBalances,
                leaveBalancesByYear,
                scheduleStart: schedule.start,
                scheduleEnd: schedule.end,
                days: schedule.days,
                weeklyScheduleAttachment,
                weeklyScheduleAttachments,
                supervisorReminders: buildSupervisorReminders(profile),
                overtimeSummaries: overtimePayload.summaries,
                overtimeSummariesSignature: overtimePayload.signature,
                overtimeSummariesTargetSignature: overtimePayload.targetSignature,
                overtimeSummariesCacheVersion: OVERTIME_SUMMARY_CACHE_VERSION,
                overtimeSummariesStatus: overtimePayload.status,
                overtimeSummariesSource: overtimePayload.source,
                overtimeSummariesUpdatedAtISO:
                    overtimePayload.updatedAtISO,
                reportsByMonth,
                reportsByMonthStatus: "refreshing",
                swapLimit: buildSwapLimit(profile.name),
                updatedAtISO: new Date().toISOString()
            };
        },
        {
            profile: profile?.name || link?.profileName || "",
            workspaceId: workspace?.id || "",
            hasPreviousPayload: Boolean(previousPayload)
        },
        {
            asyncThreshold: 120
        }
    );
}

function buildMissingProfilePayload(link, workspace) {
    const weeklyScheduleAttachments = getPublishedScheduleAttachments();

    return {
        uid: link.uid,
        workspaceId: workspace.id,
        workspaceName: workspace.name || link.workspaceName || "",
        profileName: link.profileName || "",
        profileRut: link.profileRut || "",
        status: "profile_not_found",
        worker: {
            name: link.profileName || "Trabajador",
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

function monthDaysHash(days) {
    return hashText(stableStringify(days || {}));
}

function buildWorkerAppRootProjection(payload, availableMonths, monthHashes) {
    const {
        days: _days,
        reportsByMonth: _reportsByMonth,
        exceptionsJson: _exceptionsJson,
        ...rootPayload
    } = payload || {};

    return {
        ...rootPayload,
        calendarStorageVersion: 3,
        monthReplaceVersion: WORKER_APP_MONTH_REPLACE_VERSION,
        calendarStorageMode: "monthly",
        hasMonthlyCalendar: true,
        availableMonths,
        monthHashes,
        // Se interpreta en writeWorkerAppData con deleteField(). Mantener el
        // calendario completo en el documento raiz obliga a Firestore/IndexedDB
        // a reserializar un objeto grande en cada cambio pequeno.
        removeLegacyRootDays: true
    };
}

async function readWorkerAppData(workspaceId, uid) {
    if (!workspaceId || !uid) return null;

    try {
        const { db, firestoreModule } = await getFirebaseServices();
        const snap = await firestoreModule.getDoc(
            firestoreModule.doc(
                db,
                "workspaces",
                workspaceId,
                "workerAppData",
                uid
            )
        );

        return snap.exists() ? snap.data() : null;
    } catch (error) {
        console.warn("No se pudo leer cache workerAppData previa.", error);
        return null;
    }
}

async function writeWorkerAppData(payload, workspaceId, uid) {
    const { db, firestoreModule } = await getFirebaseServices();
    const {
        removeLegacyRootDays,
        ...storedPayload
    } = payload || {};
    const data = {
        ...storedPayload,
        updatedAt: firestoreModule.serverTimestamp()
    };

    if (removeLegacyRootDays && typeof firestoreModule.deleteField === "function") {
        data.days = firestoreModule.deleteField();
    }

    await measurePerformance(
        "worker-app:write-data",
        () => firestoreModule.setDoc(
            firestoreModule.doc(
                db,
                "workspaces",
                workspaceId,
                "workerAppData",
                uid
            ),
            data,
            { merge: true }
        ),
        {
            uid,
            profile: payload?.profileName || "",
            dayCount: payload?.dayCount || 0,
            compactRoot: Boolean(removeLegacyRootDays)
        },
        {
            asyncThreshold: 120
        }
    );
}

function coldOvertimeRefreshKey(workspaceId, uid) {
    return `${workspaceId}:${uid}`;
}

function coldWorkerRefreshKey(workspaceId, uid) {
    return `${workspaceId}:${uid}`;
}

function scheduleColdOvertimeSummaryRefresh({
    link,
    profile,
    workspace,
    schedule,
    targetSignature
}) {
    if (!link?.uid || !workspace?.id || !profile?.name) {
        return;
    }

    const key = coldOvertimeRefreshKey(workspace.id, link.uid);

    clearTimeout(coldOvertimeRefreshTimers.get(key));
    coldOvertimeRefreshTimers.set(
        key,
        setTimeout(() => {
            coldOvertimeRefreshTimers.delete(key);
            void refreshWorkerOvertimeSummariesCold({
                link,
                profile,
                workspace,
                schedule,
                targetSignature
            });
        }, COLD_OVERTIME_REFRESH_DELAY_MS)
    );
}

async function refreshWorkerOvertimeSummariesCold({
    link,
    profile,
    workspace,
    schedule,
    targetSignature
}) {
    const key = coldOvertimeRefreshKey(workspace.id, link.uid);

    if (coldOvertimeRefreshInFlight.has(key)) return;

    coldOvertimeRefreshInFlight.add(key);

    try {
        await waitWorkerAppIdle(2500);
        if (activeWorkspace?.id !== workspace.id) return;

        const deferDelay = workerAppInteractiveDelay(
            WORKER_APP_COLD_USER_QUIET_MS
        );

        if (deferDelay > 0) {
            recordWorkerAppPublishDeferred(deferDelay, "cold-hhee-user-active");
            scheduleColdOvertimeSummaryRefresh({
                link,
                profile,
                workspace,
                schedule,
                targetSignature
            });
            return;
        }

        const freshSchedule = computeProfileSchedule(profile);
        const currentSignature = buildOvertimeSummarySignature(
            profile,
            freshSchedule
        );

        if (targetSignature && currentSignature !== targetSignature) {
            scheduleColdOvertimeSummaryRefresh({
                link,
                profile,
                workspace,
                schedule: freshSchedule,
                targetSignature: currentSignature
            });
            return;
        }

        const summaries = await computeOvertimeSummaries(profile, freshSchedule);
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
                overtimeSummaries: summaries,
                overtimeSummariesSignature: currentSignature,
                overtimeSummariesTargetSignature: "",
                overtimeSummariesCacheVersion: OVERTIME_SUMMARY_CACHE_VERSION,
                overtimeSummariesStatus: "fresh",
                overtimeSummariesUpdatedAtISO: new Date().toISOString(),
                updatedAt: firestoreModule.serverTimestamp()
            },
            { merge: true }
        );
    } catch (error) {
        console.warn("No se pudo refrescar HHEE en segundo plano.", error);
    } finally {
        coldOvertimeRefreshInFlight.delete(key);
    }
}

function scheduleColdWorkerReportsRefresh({
    link,
    profile,
    workspace
}) {
    if (!link?.uid || !workspace?.id || !profile?.name) return;

    const key = coldWorkerRefreshKey(workspace.id, link.uid);

    clearTimeout(coldReportsRefreshTimers.get(key));
    coldReportsRefreshTimers.set(
        key,
        setTimeout(() => {
            coldReportsRefreshTimers.delete(key);
            void refreshWorkerReportsCold({
                link,
                profile,
                workspace
            });
        }, COLD_OVERTIME_REFRESH_DELAY_MS + 1800)
    );
}

async function refreshWorkerReportsCold({
    link,
    profile,
    workspace
}) {
    const key = coldWorkerRefreshKey(workspace.id, link.uid);

    if (coldReportsRefreshInFlight.has(key)) return;

    coldReportsRefreshInFlight.add(key);

    try {
        await waitWorkerAppIdle(3200);
        if (activeWorkspace?.id !== workspace.id) return;

        const deferDelay = workerAppInteractiveDelay(
            WORKER_APP_COLD_USER_QUIET_MS
        );

        if (deferDelay > 0) {
            recordWorkerAppPublishDeferred(deferDelay, "cold-reports-user-active");
            scheduleColdWorkerReportsRefresh({
                link,
                profile,
                workspace
            });
            return;
        }

        const reportsByMonth = await buildWorkerReports(profile);
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
                reportsByMonth,
                reportsByMonthStatus: "fresh",
                reportsByMonthUpdatedAtISO: new Date().toISOString(),
                updatedAt: firestoreModule.serverTimestamp()
            },
            { merge: true }
        );
    } catch (error) {
        console.warn(
            "No se pudieron refrescar reportes PWA en segundo plano.",
            error
        );
    } finally {
        coldReportsRefreshInFlight.delete(key);
    }
}

function scheduleColdWorkerExceptionsRefresh({
    link,
    profile,
    workspace
}) {
    if (!link?.uid || !workspace?.id || !profile?.name) return;

    const key = coldWorkerRefreshKey(workspace.id, link.uid);

    clearTimeout(coldExceptionsRefreshTimers.get(key));
    coldExceptionsRefreshTimers.set(
        key,
        setTimeout(() => {
            coldExceptionsRefreshTimers.delete(key);
            void refreshWorkerExceptionsCold({
                link,
                profile,
                workspace
            });
        }, COLD_OVERTIME_REFRESH_DELAY_MS + 3600)
    );
}

async function refreshWorkerExceptionsCold({
    link,
    profile,
    workspace
}) {
    const key = coldWorkerRefreshKey(workspace.id, link.uid);

    if (coldExceptionsRefreshInFlight.has(key)) return;

    coldExceptionsRefreshInFlight.add(key);

    try {
        await waitWorkerAppIdle(3600);
        if (activeWorkspace?.id !== workspace.id) return;

        const deferDelay = workerAppInteractiveDelay(
            WORKER_APP_COLD_USER_QUIET_MS
        );

        if (deferDelay > 0) {
            recordWorkerAppPublishDeferred(deferDelay, "cold-exceptions-user-active");
            scheduleColdWorkerExceptionsRefresh({
                link,
                profile,
                workspace
            });
            return;
        }

        const { exceptions, exceptionsStart, exceptionsEnd } =
            measurePerformance(
                "worker-app:compute-exceptions",
                () => computeProfileExceptions(profile),
                {
                    profile: profile?.name || ""
                }
            );
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
                exceptionsJson: JSON.stringify(exceptions),
                exceptionsCount: Object.keys(exceptions).length,
                exceptionsStart,
                exceptionsEnd,
                exceptionsStatus: "fresh",
                exceptionsUpdatedAtISO: new Date().toISOString(),
                updatedAt: firestoreModule.serverTimestamp()
            },
            { merge: true }
        );
    } catch (error) {
        console.warn(
            "No se pudieron refrescar excepciones PWA en segundo plano.",
            error
        );
    } finally {
        coldExceptionsRefreshInFlight.delete(key);
    }
}

async function writeWorkerAppMonths(
    payload,
    workspaceId,
    uid,
    previousMonthHashes = {}
) {
    const { db, firestoreModule } = await getFirebaseServices();
    const months = splitDaysByMonth(payload.days);
    const entries = Object.entries(months);
    const nextMonthHashes = {};

    for (const [index, [month, days]] of entries.entries()) {
        const deferDelay = workerAppInteractiveDelay();

        if (deferDelay > 0) {
            recordWorkerAppPublishDeferred(deferDelay, "month-write-user-active");
            return {
                monthHashes: nextMonthHashes,
                deferred: true,
                deferDelay
            };
        }

        const hash = monthDaysHash(days);
        nextMonthHashes[month] = hash;

        if (previousMonthHashes?.[month] === hash) {
            recordPerformanceEvent("worker-app:skip-month-write", {
                type: "worker-app",
                uid,
                month,
                profile: payload.profileName || "",
                reason: "unchanged-hash"
            });
            continue;
        }

        const bounds = monthScheduleBounds(days);

        await measurePerformance(
            "worker-app:write-month",
            () => firestoreModule.setDoc(
                firestoreModule.doc(
                    db,
                    "workspaces",
                    workspaceId,
                    "workerAppData",
                    uid,
                    "months",
                    month
                ),
                {
                    uid,
                    workspaceId,
                    month,
                    profileName: payload.profileName || "",
                    profileRut: payload.profileRut || "",
                    scheduleStart: bounds.start,
                    scheduleEnd: bounds.end,
                    days,
                    updatedAtISO: payload.updatedAtISO,
                    updatedAt: firestoreModule.serverTimestamp()
                }
            ),
            {
                uid,
                month,
                profile: payload.profileName || "",
                dayCount: Object.keys(days || {}).length,
                hash
            },
            {
                asyncThreshold: 120
            }
        );

        if (index < entries.length - 1) {
            await waitWorkerAppIdle(500);
        }
    }

    return {
        monthHashes: nextMonthHashes,
        deferred: false,
        deferDelay: 0
    };
}

async function writeWorkerAppProjection(
    payload,
    workspaceId,
    uid,
    previousPayload = null
) {
    const splitMonths = splitDaysByMonth(payload.days);
    const availableMonths = Object.keys(splitMonths).sort();
    const canTrustPreviousMonthHashes =
        Number(previousPayload?.monthReplaceVersion) ===
        WORKER_APP_MONTH_REPLACE_VERSION;
    const previousMonthHashes =
        canTrustPreviousMonthHashes &&
        previousPayload?.monthHashes &&
        typeof previousPayload.monthHashes === "object"
            ? previousPayload.monthHashes
            : {};
    const monthWriteResult = await writeWorkerAppMonths(
        payload,
        workspaceId,
        uid,
        previousMonthHashes
    );

    if (monthWriteResult.deferred) {
        return monthWriteResult;
    }

    const deferDelay = workerAppInteractiveDelay();

    if (deferDelay > 0) {
        recordWorkerAppPublishDeferred(deferDelay, "root-write-user-active");
        return {
            monthHashes: monthWriteResult.monthHashes,
            deferred: true,
            deferDelay
        };
    }

    await writeWorkerAppData(
        buildWorkerAppRootProjection(
            payload,
            availableMonths,
            monthWriteResult.monthHashes
        ),
        workspaceId,
        uid
    );

    return {
        monthHashes: monthWriteResult.monthHashes,
        deferred: false,
        deferDelay: 0
    };
}

// Publicar los docs de los enlazados de a UNO costaba una escritura por
// documento: con 66 enlazados eran ~132 `setDoc` y mas de 60 s de escritura por
// una sola edicion de turno, suficiente para que el SDK contestara
// `resource-exhausted: Write stream exhausted maximum allowed queued writes`.
// Aqui se agrupan. Mismos documentos y mismo contenido; lo que cambia es que
// viajan por lotes.
async function commitWorkerDocBatches(documents = [], workspaceId) {
    if (!documents.length || !workspaceId) return 0;

    const { db, firestoreModule } = await getFirebaseServices();
    let written = 0;

    for (
        let offset = 0;
        offset < documents.length;
        offset += WORKER_DOC_BATCH_SIZE
    ) {
        const slice = documents.slice(offset, offset + WORKER_DOC_BATCH_SIZE);
        const batch = firestoreModule.writeBatch(db);

        slice.forEach(({ collection, uid, payload }) => {
            batch.set(
                firestoreModule.doc(
                    db,
                    "workspaces",
                    workspaceId,
                    collection,
                    uid
                ),
                {
                    ...payload,
                    updatedAt: firestoreModule.serverTimestamp()
                },
                { merge: true }
            );
        });

        await measurePerformance(
            "worker-app:commit-worker-docs",
            () => batch.commit(),
            {
                documentCount: slice.length,
                collections: Array.from(
                    new Set(slice.map(item => item.collection))
                ).join(",")
            },
            {
                asyncThreshold: 120
            }
        );

        written += slice.length;

        // Se cede el hilo entre LOTES, no entre documentos.
        if (offset + WORKER_DOC_BATCH_SIZE < documents.length) {
            await waitWorkerAppIdle(300);
        }
    }

    return written;
}


// ───────── Deteccion de "sucios" desde detail.keys ─────────

function buildUnlinkedWorkerMessageDirectoryPayload(workspaceId, uid, data = {}) {
    return {
        uid,
        workspaceId,
        profileName: data.profileName || "",
        status: "unlinked",
        unlinkedAt: data.unlinkedAt || null,
        updatedAtISO: new Date().toISOString()
    };
}

async function markUnlinkedWorkerMessageDirectoryEntries(
    workspaceId,
    { activeUids = [], removedLinks = [], includeOrphans = false } = {}
) {
    if (!workspaceId) return;

    try {
        const { db, firestoreModule } = await getFirebaseServices();
        const activeSet = new Set(activeUids.map(String).filter(Boolean));
        const directoryRef = firestoreModule.collection(
            db,
            "workspaces",
            workspaceId,
            "workerMessageDirectory"
        );
        const byUid = new Map();

        removedLinks.forEach(link => {
            const uid = String(link?.uid || "").trim();
            if (!uid || activeSet.has(uid)) return;

            byUid.set(uid, buildUnlinkedWorkerMessageDirectoryPayload(
                workspaceId,
                uid,
                link
            ));
        });

        if (includeOrphans) {
            const snap = await firestoreModule.getDocs(directoryRef);

            snap.docs.forEach(docSnap => {
                const data = docSnap.data() || {};
                const uid = String(data.uid || docSnap.id || "").trim();
                if (!uid || activeSet.has(uid)) return;
                if (String(data.status || "active") !== "active") return;

                byUid.set(uid, buildUnlinkedWorkerMessageDirectoryPayload(
                    workspaceId,
                    uid,
                    data
                ));
            });
        }

        if (!byUid.size) return;

        const batch = firestoreModule.writeBatch(db);
        byUid.forEach((payload, uid) => {
            batch.set(
                firestoreModule.doc(
                    db,
                    "workspaces",
                    workspaceId,
                    "workerMessageDirectory",
                    uid
                ),
                {
                    ...payload,
                    unlinkedAt: firestoreModule.serverTimestamp(),
                    updatedAt: firestoreModule.serverTimestamp()
                }
            );
        });

        await batch.commit();
    } catch (error) {
        console.warn(
            "No se pudieron marcar directorios de mensajes desenlazados.",
            error
        );
    }
}

function resolveProfileName(remainder, profiles) {
    let best = null;

    for (const profile of profiles) {
        const name = profile?.name;

        if (!name) continue;

        if (remainder === name || remainder.startsWith(name + "_")) {
            if (!best || name.length > best.length) best = name;
        }
    }

    return best;
}

// Clasifica una clave cambiada: { all } global relevante, { profileName } por
// perfil, o { ignore } si no afecta lo que ve el trabajador.
function classifyChangedKey(key, profiles) {
    if (GLOBAL_RELEVANT_KEYS.has(key)) return { all: true };

    for (const prefix of PROFILE_KEY_PREFIXES) {
        if (!key.startsWith(prefix)) continue;

        const name = resolveProfileName(key.slice(prefix.length), profiles);

        return name ? { profileName: name } : { ignore: true };
    }

    return { ignore: true };
}

function shouldDeferDirectEditCalendarEvent(metadata) {
    return (
        metadata?.source === "main_calendar_manual_edit" &&
        typeof window !== "undefined" &&
        typeof window.calendarDirectEditEnabled === "function" &&
        window.calendarDirectEditEnabled()
    );
}

const HELDABLE_LEAVE_EVENT_SOURCES = new Set([
    "administrative_leave",
    "legal_leave",
    "compensatory_leave"
]);

// Un permiso EN ESPERA DE COBERTURA tampoco avisa. La notificacion sale despues,
// cuando el supervisor cubre uno de los turnos comprometidos y el bloque se
// libera (js/leaveHold.js -> releaseLeaveHoldsForCoverage). Solo se calla si
// TODOS los dias del cambio estan en espera: un permiso que ademas toca dias ya
// publicados si tiene que avisar.
function shouldSilenceHeldLeaveCalendarEvent(metadata, profileName) {
    if (!HELDABLE_LEAVE_EVENT_SOURCES.has(metadata?.source)) return false;

    const dates = metadata.affectedDates || [];

    if (!dates.length) return false;

    const held = new Set(
        [...heldLeaveKeys(profileName)].map(isoFromKey)
    );

    return dates.every(date => held.has(date));
}

function applyDirtyFromKeys(keys, changes = {}) {
    if (!activeWorkspace?.id || !getWorkerAppLinkList().length) return;
    if (!Array.isArray(keys) || !keys.length) return;

    const profiles = getProfiles();
    const linkedByName = new Map();

    linkedProfilePairs(profiles).forEach(item => {
        if (item.profile?.name && item.link?.uid) {
            linkedByName.set(item.profile.name, item);
        }
    });

    let relevant = false;
    let shouldPublishNow = false;

    for (const key of keys) {
        const result = classifyChangedKey(key, profiles);

        if (result.ignore) continue;

        if (result.all) {
            // Un cambio global no puede identificar con seguridad a los
            // afectados. El cliente que origina la accion debe marcar los
            // perfiles concretos; nunca se republican los 70 por este evento.
            continue;
        }

        if (result.profileName && linkedByName.has(result.profileName)) {
            // Solo se reacciona a cambios de trabajadores ENLAZADOS: si el
            // perfil no usa la PWA, no se gasta ningun recurso en publicarlo.
            dirtyProfileNames.add(result.profileName);
            const item = linkedByName.get(result.profileName);
            const metadata = buildCalendarChangeEventFromStorageMutation({
                storageKey: key,
                change: changes[key] || {}
            });

            if (shouldDeferDirectEditCalendarEvent(metadata)) {
                relevant = true;
                continue;
            }

            // El permiso en espera SI publica (asi `leaveHold_` llega a Firestore
            // antes de que la Cloud Function recalcule); lo unico que se calla es
            // el aviso al trabajador.
            if (!shouldSilenceHeldLeaveCalendarEvent(
                metadata,
                result.profileName
            )) {
                registerCalendarEventForLinkedProfile({
                    profile: item.profile,
                    link: item.link,
                    metadata,
                    entityId: key
                });
            }

            relevant = true;
            shouldPublishNow = true;
        }
    }

    if (!relevant || !shouldPublishNow) return;

    // La proyeccion ahora corre en servidor y este paso solo escribe un
    // marcador liviano. Para cambios de calendario no conviene esperar el
    // debounce largo: la PWA puede recibir la notificacion antes de que su
    // calendario quede actualizado.
    scheduleHotPublish(CALENDAR_CHANGE_PUBLISH_DELAY_MS);
}

function currentWorkspace() {
    const stored = getActiveWorkspace() || {};

    return { ...stored, ...activeWorkspace };
}

function linkedProfilePairs(profiles) {
    return getWorkerAppLinkList().map(link => ({
        link,
        profile: findProfileForLink(link, profiles)
    }));
}

function registerCalendarEventForLinkedProfile({
    profile,
    link,
    metadata,
    entityId = ""
}) {
    if (!profile?.name || !link?.uid || !metadata) return false;

    return registerWorkerCalendarChange({
        workspaceId: activeWorkspace?.id || "",
        workerId: profile.id || profile.name,
        profileName: profile.name,
        affectedUserId: link.uid,
        changeType: metadata.changeType,
        affectedDates: metadata.affectedDates || [],
        source: metadata.source,
        title: metadata.title,
        message: metadata.message,
        entityId
    });
}

// Trabajadores enlazados afectados por los cambios pendientes. Los NO enlazados
// nunca entran aqui (se itera solo workerLinks), por lo que no se gastan
// recursos en quienes no usan la PWA.
function dirtyLinkTargets(profiles) {
    const linked = linkedProfilePairs(profiles);

    return linked
        .map(item => {
            const workerDirty = dirtyWorkerUids.has(item.link.uid);
            const profileDirty = Boolean(
                item.profile &&
                dirtyProfileNames.has(item.profile.name)
            );

            return {
                ...item,
                workerDirty,
                profileDirty
            };
        })
        .filter(item => item.workerDirty || item.profileDirty);
}

function publishStillCurrent(generation, workspaceId) {
    return generation === syncGeneration &&
        activeWorkspace?.id === workspaceId;
}

function markDirtyTargetAgain(item) {
    if (!item) return;

    if (item.workerDirty && item.link?.uid) {
        dirtyWorkerUids.add(item.link.uid);
    }

    if (item.profileDirty && item.profile?.name) {
        dirtyProfileNames.add(item.profile.name);
    }
}

function deferWorkerAppItemIfForeground(item, reason = "foreground-during-publish") {
    const delay = workerAppInteractiveDelay();

    if (delay <= 0) return false;

    recordWorkerAppPublishDeferred(delay, reason);
    markDirtyTargetAgain(item);
    hotPublishRequested = true;
    return true;
}

// ───────── Publicacion caliente (mes actual + siguiente) ─────────

export function scheduleHotPublish(delay = HOT_PUBLISH_DELAY_MS) {
    if (!activeWorkspace?.id || !getWorkerAppLinkList().length) return;

    recordPerformanceEvent("worker-app:schedule-hot-publish", {
        type: "worker-app",
        delay,
        linkedCount: getWorkerAppLinkList().length,
        dirtyProfiles: dirtyProfileNames.size,
        dirtyWorkers: dirtyWorkerUids.size
    });
    clearTimeout(hotPublishTimer);
    hotPublishTimer = setTimeout(() => publishHotNow(), delay);
}

function workerAppProjectionStateKeysForProfiles(
    profileNames = [],
    extraKeys = []
) {
    const names = Array.from(new Set(
        (Array.isArray(profileNames) ? profileNames : [profileNames])
            .map(name => String(name || "").trim())
            .filter(Boolean)
    ));
    const keys = new Set(WORKER_APP_PROJECTION_GLOBAL_STATE_KEYS);

    names.forEach(name => {
        WORKER_APP_PROJECTION_PROFILE_STATE_PREFIXES.forEach(prefix => {
            keys.add(`${prefix}${name}`);
        });
    });

    // Claves globales que solo hay que vaciar cuando de verdad cambiaron. NO
    // van en WORKER_APP_PROJECTION_GLOBAL_STATE_KEYS a proposito: el vaciado
    // escribe TODAS las claves que recibe, cambien o no, y `attendanceMarks`
    // viaja entera (no esta troceada). Meterla en la lista fija reescribiria el
    // archivo del reloj completo en cada edicion de turno.
    (Array.isArray(extraKeys) ? extraKeys : [extraKeys])
        .map(key => String(key || "").trim())
        .filter(Boolean)
        .forEach(key => keys.add(key));

    return [...keys];
}

async function flushWorkerAppProjectionState(
    profileNames = [],
    extraKeys = []
) {
    const keys = workerAppProjectionStateKeysForProfiles(
        profileNames,
        extraKeys
    );

    if (!keys.length) return null;

    return flushPendingFirebaseAppStateEntries({
        keys,
        reason: "worker-app-projection"
    });
}

async function publishHotNow() {
    if (!activeWorkspace?.id || !getWorkerAppLinkList().length) return;

    // El cómputo de la proyección del worker-app se movió al servidor (Cloud
    // Function buildWorkerAppProjection). El navegador ya NO calcula ni escribe
    // workerAppData: solo deja un marcador con los perfiles afectados. El estado
    // crudo sincronizado (stateModules) alimenta al motor server-side, lo que
    // elimina del hilo principal los cálculos pesados que congelaban la UI.
    const profiles = getProfiles();
    const dirtyNames = new Set(dirtyProfileNames);

    dirtyWorkerUids.forEach(uid => {
        const link = getWorkerAppLinkList().find(item => item.uid === uid);
        const profile = link ? findProfileForLink(link, profiles) : null;
        if (profile?.name) dirtyNames.add(profile.name);
    });

    dirtyProfileNames = new Set();
    dirtyWorkerUids = new Set();
    const needsLocalStateFlush = hotPublishNeedsLocalStateFlush;
    const extraStateKeys = [...hotPublishExtraStateKeys];
    hotPublishRequested = false;
    hotPublishNeedsLocalStateFlush = false;
    hotPublishExtraStateKeys = new Set();

    // La programacion del workspace se publica SIEMPRE, antes del corte de
    // abajo: no depende de que haya perfiles sucios, y si dependiera, editar el
    // tablero sin tocar a nadie en particular no republicaria nada.
    void publishSharedScheduleNow();

    if (!dirtyNames.size) return;

    const requestWorkspace = currentWorkspace();

    try {
        if (needsLocalStateFlush) {
            await flushWorkerAppProjectionState([...dirtyNames], extraStateKeys);
        }

        const { db, firestoreModule } = await getFirebaseServices();
        const requestRef = firestoreModule.doc(
            firestoreModule.collection(
                db,
                "workspaces",
                requestWorkspace.id,
                "projectionRequests"
            )
        );

        await firestoreModule.setDoc(requestRef, {
            profiles: [...dirtyNames],
            requestedAt: firestoreModule.serverTimestamp()
        });

        recordPerformanceEvent("worker-app:request-projection", {
            type: "worker-app",
            workspaceId: requestWorkspace.id,
            profileCount: dirtyNames.size,
            linkedCount: getWorkerAppLinkList().length
        });
    } catch (error) {
        dirtyNames.forEach(name => dirtyProfileNames.add(name));
        hotPublishRequested = true;
        hotPublishNeedsLocalStateFlush =
            hotPublishNeedsLocalStateFlush || needsLocalStateFlush;
        extraStateKeys.forEach(key => hotPublishExtraStateKeys.add(key));
        console.warn(
            "No se pudo solicitar la proyeccion del worker-app.",
            error
        );
    }

    // El directorio de mensajes y los candidatos de cambio de turno se publican
    // aparte de la proyeccion. Se habian dejado de publicar al retirar el pipeline
    // hot legacy: sin ellos, el trabajador no aparece en Mensajes y
    // compatibleWorkerUids queda vacio.
    //
    // Se pasan los perfiles tocados: no son "pocos" como suponia el comentario
    // original. Con 66 enlazados, republicarlos todos por una edicion costaba
    // ~132 documentos y mas de 60 s, y terminaba tumbando el stream de escritura.
    void publishLinkedWorkerDocs(dirtyNames);
}

// La programacion es la MISMA para todo el workspace, asi que va en UN doc
// compartido (workspaces/{id}/published/schedule) en vez de duplicarla en el doc
// de cada trabajador: escribir N docs excedia el limite de commit de Firestore
// con muchos enlazados ("Transaction too big"). Asi es O(1). La PWA lo lee de
// ahi y no de otro lado.
//
// Se escribe SIN merge a proposito. `setDoc(..., { merge: true })` fusiona los
// mapas en PROFUNDIDAD, de modo que las semanas viejas del mapa se quedaban
// pegadas para siempre: por eso, tras quitar el Excel, en el telefono seguian
// apareciendo las programaciones anteriores en imagen. Reemplazar el documento
// es lo unico que las saca. Nadie mas escribe en el, asi que es seguro.
async function publishSharedScheduleNow() {
    if (!activeWorkspace?.id) return;

    const workspaceId = activeWorkspace.id;
    const weeklyScheduleAttachments = getPublishedScheduleAttachments();
    const currentWeekPayload = getPublishedScheduleAttachment(
        new Date(),
        weeklyScheduleAttachments
    );

    try {
        const { db, firestoreModule } = await getFirebaseServices();

        if (workspaceId !== activeWorkspace?.id) return;

        await firestoreModule.setDoc(
            firestoreModule.doc(
                db,
                "workspaces",
                workspaceId,
                "published",
                "schedule"
            ),
            {
                weeklyScheduleAttachment: currentWeekPayload || null,
                weeklyScheduleAttachments,
                updatedAtISO: new Date().toISOString(),
                updatedAt: firestoreModule.serverTimestamp()
            }
        );

        recordPerformanceEvent("worker-app:publish-schedule", {
            type: "worker-app",
            workspaceId,
            weekCount: Object.keys(weeklyScheduleAttachments).length
        });
        console.info(
            "[TurnoPlus] Programacion publicada al workspace:",
            Object.keys(weeklyScheduleAttachments).length,
            "semanas",
            Object.keys(weeklyScheduleAttachments)
        );
    } catch (error) {
        console.error(
            "[TurnoPlus] NO se pudo publicar la programacion del workspace.",
            error
        );
    }
}

// Publica, por cada trabajador ENLAZADO, los dos docs livianos que el navegador
// del supervisor debe mantener y que se habian dejado de publicar al retirar el
// pipeline hot legacy:
//  - workerMessageDirectory: para que aparezca en el listado de Mensajes de la PWA.
//  - workerSwapCandidates: compatibilidad (compatibleWorkerUids), su calendario
//    (days) y la config del 24, para el cambio de turno directo.
// Recencia de un enlace, para elegir la cuenta vigente cuando un mismo perfil
// tiene mas de un uid enlazado (dos cuentas).
// Retira los docs derivados de un uid duplicado (misma persona, otra cuenta): el
// directorio de mensajes queda "unlinked" y el candidato de cambio de turno pasa a
// inactivo, para que la PWA no lo liste ni lo ofrezca dos veces. No toca workerLinks
// (no desconecta la cuenta): si esa cuenta se usa, se re-publica sola.
async function retireDuplicateWorkerLinkDocs(uid, workspaceId) {
    if (!uid || !workspaceId) return;

    try {
        const { db, firestoreModule } = await getFirebaseServices();
        const now = firestoreModule.serverTimestamp();

        await firestoreModule.setDoc(
            firestoreModule.doc(db, "workspaces", workspaceId, "workerMessageDirectory", uid),
            { status: "unlinked", unlinkedAt: now, updatedAt: now },
            { merge: true }
        );
        await firestoreModule.setDoc(
            firestoreModule.doc(db, "workspaces", workspaceId, "workerSwapCandidates", uid),
            { status: "inactive", updatedAt: now },
            { merge: true }
        );
    } catch (error) {
        console.warn("No se pudo retirar el doc duplicado del trabajador.", error);
    }
}

// Se invoca con `void` desde dos sitios, y una corrida completa tarda segundos.
// Sin candado, dos ediciones seguidas dejaban DOS bucles escribiendo a la vez y
// la cola de escritura del SDK se desbordaba. Una edicion durante una corrida no
// se descarta: se encola UNA repeticion al terminar, porque el bucle republica
// desde el estado actual y una corrida en vuelo pudo leer datos viejos.
let linkedWorkerDocsRun = null;
let linkedWorkerDocsRerun = false;
// Objetivos acumulados para la proxima corrida. Sin acumular, una edicion de
// Bruno llegada mientras se publicaba a Ana se perderia: la repeticion saldria
// con los objetivos de Ana.
const linkedWorkerDocsPendingNames = new Set();
let linkedWorkerDocsPendingAll = false;

// Sin objetivos = publicacion completa (arranque, o quien no sabe a quien toco).
function publishLinkedWorkerDocs(targetNames = null) {
    if (targetNames?.size) {
        targetNames.forEach(name => linkedWorkerDocsPendingNames.add(name));
    } else {
        linkedWorkerDocsPendingAll = true;
    }

    if (linkedWorkerDocsRun) {
        linkedWorkerDocsRerun = true;
        return linkedWorkerDocsRun;
    }

    linkedWorkerDocsRun = (async () => {
        try {
            do {
                linkedWorkerDocsRerun = false;

                const all = linkedWorkerDocsPendingAll;
                const names = new Set(linkedWorkerDocsPendingNames);

                linkedWorkerDocsPendingAll = false;
                linkedWorkerDocsPendingNames.clear();

                await publishLinkedWorkerDocsNow(all ? null : names);
            } while (linkedWorkerDocsRerun);
        } finally {
            linkedWorkerDocsRun = null;
            linkedWorkerDocsRerun = false;
        }
    })();

    return linkedWorkerDocsRun;
}

// Editar el turno de Ana no cambia NI UN BYTE del documento de Bruno: su
// calendario es propio, y `canSwapProfiles` solo mira estamento, profesion,
// rotativa base y la config de cambios. Por eso se publica solo a quien cambio.
//
// Pero si cambia alguno de esos insumos -o entra/sale/se renombra un perfil- la
// lista `compatibleWorkerUids` de TODOS queda vieja. En vez de enumerar los
// caminos que lo provocan, se firma el insumo y se compara: si la firma cambio,
// se publica completo. Si aparece un criterio nuevo en `canSwapProfiles`, hay
// que agregarlo aqui o esa lista se quedara rancia.
function swapCompatibilitySignature(workspace, primaryProfiles) {
    const config = getTurnChangeConfig();

    return JSON.stringify([
        workspace.name || "",
        config.allowSwaps !== false,
        config.allowTwentyFourHourShifts !== false,
        config.allowInvertedTwentyFourHourShifts !== false,
        primaryProfiles
            .map(item => [
                item.link.uid,
                item.profile.name || "",
                item.profile.estamento || "",
                item.profile.profession || "",
                getRotativa(item.profile.name) || ""
            ].join("|"))
            .sort()
    ]);
}

let lastSwapCompatibilitySignature = "";

/**
 * Red de reparacion del arranque: comprueba que los documentos livianos que
 * publica el servidor esten y coincidan, y repone SOLO los que falten o
 * difieran.
 *
 * La comparacion ignora `updatedAtISO`, que cambia en cada armado aunque nada
 * mas lo haga: sin eso los 132 documentos se verian distintos siempre y no
 * habriamos ganado nada.
 */
async function verifyLinkedWorkerDocs() {
    const workspace = currentWorkspace();

    if (!workspace?.id || !getWorkerAppLinkList().length) return;

    try {
        const pending = await pendingLinkedWorkerDocs(workspace);

        recordPerformanceEvent("worker-app:verify-linked-docs", {
            type: "worker-app",
            pendingCount: pending.length
        });

        if (!pending.length) return;

        // Falta algo: el servidor no llego a publicar, o la unidad viene de
        // antes de que lo hiciera. Se repone solo lo que falta.
        await commitWorkerDocBatches(pending, workspace.id);
    } catch (error) {
        // Si la comprobacion falla se publica como antes: es la red, y una red
        // que no se puede comprobar tiene que tender a reponer.
        console.warn(
            "No se pudo comprobar los documentos de los enlazados; se republican.",
            error
        );
        void publishLinkedWorkerDocs();
    }
}

/** Los mismos documentos que arma el servidor, calculados aqui para comparar. */
function buildLinkedWorkerDocsForWorkspace(workspace) {
    return buildLinkedWorkerDocuments(
        workspace,
        getWorkerAppLinkList(),
        profile => computeProfileSchedule(profile)
    ).documents;
}

/** Documentos que el servidor no publico, o publico distinto. */
async function pendingLinkedWorkerDocs(workspace) {
    const documents = buildLinkedWorkerDocsForWorkspace(workspace);

    if (!documents.length) return [];

    const { db, firestoreModule } = await getFirebaseServices();
    const collections = [...new Set(documents.map(item => item.collection))];
    const stored = new Map();

    await Promise.all(collections.map(async name => {
        const snap = await firestoreModule.getDocs(
            firestoreModule.collection(db, "workspaces", workspace.id, name)
        );

        snap.forEach(docSnap => {
            stored.set(`${name}/${docSnap.id}`, docSnap.data() || null);
        });
    }));

    return documents.filter(({ collection, uid, payload }) =>
        linkedDocChanged(stored.get(`${collection}/${uid}`), payload)
    );
}

async function publishLinkedWorkerDocsNow(targetNames = null) {
    const workspace = currentWorkspace();

    if (!workspace?.id || !getWorkerAppLinkList().length) return;

    const profiles = getProfiles();
    const linkedProfiles = getWorkerAppLinkList()
        .map(link => ({ link, profile: findProfileForLink(link, profiles) }))
        .filter(item => item.profile && item.link?.uid);

    if (!linkedProfiles.length) return;

    // Un mismo perfil puede tener mas de un uid enlazado (la persona uso dos
    // cuentas). Se conserva SOLO el enlace mas reciente y se retiran los docs
    // derivados de los demas, para no listar/ofrecer a la persona dos veces.
    const primaryByProfile = new Map();
    linkedProfiles.forEach(item => {
        const key = normalizeText(item.profile.name);
        const existing = primaryByProfile.get(key);

        if (!existing || workerLinkRecency(item.link) >= workerLinkRecency(existing.link)) {
            primaryByProfile.set(key, item);
        }
    });

    const primaryProfiles = [...primaryByProfile.values()];
    const primaryUids = new Set(primaryProfiles.map(item => item.link.uid));
    const duplicates = linkedProfiles.filter(item => !primaryUids.has(item.link.uid));

    // El universo de compatibilidad se calcula SIEMPRE con todos (es lo que va
    // dentro de `compatibleWorkerUids`); lo que se acota es a quien se le
    // reescribe el documento.
    const signature = swapCompatibilitySignature(workspace, primaryProfiles);
    const compatibilityChanged = signature !== lastSwapCompatibilitySignature;
    const wanted = targetNames?.size && !compatibilityChanged
        ? new Set([...targetNames].map(normalizeText))
        : null;
    const targets = wanted
        ? primaryProfiles.filter(item =>
            wanted.has(normalizeText(item.profile.name))
        )
        : primaryProfiles;

    // Un objetivo que no empareja con ningun enlazado es NORMAL cuando se edita
    // el turno de alguien sin la PWA. Pero tambien seria el sintoma de que los
    // nombres no casan, y en ese caso la PWA dejaria de recibir los cambios sin
    // hacer ruido. Se registran para poder distinguirlo.
    const unmatched = wanted
        ? [...targetNames].filter(name =>
            !primaryProfiles.some(item =>
                normalizeText(item.profile.name) === normalizeText(name)
            )
        )
        : [];

    recordPerformanceEvent("worker-app:publish-linked-docs", {
        type: "worker-app",
        linkedCount: primaryProfiles.length,
        targetCount: targets.length,
        requestedCount: targetNames?.size || 0,
        unmatchedCount: unmatched.length,
        unmatched: unmatched.slice(0, 5).join(" | "),
        compatibilityChanged
    });

    if (!targets.length) return;

    // Se arman todos los documentos y despues se envian por lotes. El try/catch
    // sigue siendo por trabajador: un perfil que no se pueda armar no puede
    // llevarse por delante la publicacion de los demas.
    const documents = [];

    targets.forEach(item => {
        try {
            documents.push({
                collection: "workerMessageDirectory",
                uid: item.link.uid,
                payload: buildWorkerMessageDirectoryPayload(
                    item.link,
                    item.profile,
                    workspace,
                    new Date().toISOString()
                )
            });
        } catch (error) {
            console.warn(
                "No se pudo preparar el directorio de mensajes.",
                error
            );
        }

        try {
            documents.push({
                collection: "workerSwapCandidates",
                uid: item.link.uid,
                payload: buildSwapCandidatePayload(
                    item.link,
                    item.profile,
                    workspace,
                    // El universo de compatibilidad tambien va sin duplicados, para
                    // que compatibleWorkerUids no repita a la misma persona.
                    primaryProfiles,
                    new Date().toISOString(),
                    computeProfileSchedule(item.profile)
                )
            });
        } catch (error) {
            console.warn(
                "No se pudo preparar el candidato de cambio de turno.",
                error
            );
        }
    });

    try {
        await commitWorkerDocBatches(documents, workspace.id);

        // La firma se da por cubierta solo si la publicacion salio bien. Si
        // reventa, la proxima corrida vuelve a verla distinta y republica
        // completo, que es justo lo que hace falta.
        lastSwapCompatibilitySignature = signature;
    } catch (error) {
        console.warn(
            "No se pudieron publicar los documentos de los enlazados.",
            error
        );
    }

    // Los duplicados son raros (una persona con dos cuentas) y llevan
    // `serverTimestamp` propio en `unlinkedAt`, asi que se dejan por su camino.
    for (const item of duplicates) {
        await retireDuplicateWorkerLinkDocs(item.link.uid, workspace.id);
    }
}

// API publica: siempre exige perfiles concretos.

export function scheduleWorkerAppDataPublish(
    delay = HOT_PUBLISH_DELAY_MS,
    profileTargets = [],
    changeMetadata = null,
    options = {}
) {
    if (!activeWorkspace?.id || !getWorkerAppLinkList().length) return;

    const normalizedTargets = normalizeProfileTargets(profileTargets);

    normalizedTargets.forEach(name => dirtyProfileNames.add(name));

    if (changeMetadata || options?.requiresLocalStateFlush === true) {
        hotPublishNeedsLocalStateFlush = true;
    }

    if (Array.isArray(options?.stateKeys) && options.stateKeys.length) {
        options.stateKeys
            .map(key => String(key || "").trim())
            .filter(Boolean)
            .forEach(key => hotPublishExtraStateKeys.add(key));
        hotPublishNeedsLocalStateFlush = true;
    }

    if (changeMetadata) {
        const profiles = getProfiles();
        const linkedByName = new Map();
        const notifyProfileNames = Array.isArray(changeMetadata.notifyProfiles)
            ? new Set(normalizeProfileTargets(changeMetadata.notifyProfiles))
            : null;

        linkedProfilePairs(profiles).forEach(item => {
            if (item.profile?.name && item.link?.uid) {
                linkedByName.set(item.profile.name, item);
            }
        });

        normalizedTargets.forEach(name => {
            const item = linkedByName.get(name);

            if (!item) return;
            if (notifyProfileNames && !notifyProfileNames.has(name)) return;

            registerCalendarEventForLinkedProfile({
                profile: item.profile,
                link: item.link,
                metadata: changeMetadata,
                entityId: changeMetadata.entityId || ""
            });
        });
    }

    if (!dirtyProfileNames.size && !dirtyWorkerUids.size) return;

    recordPerformanceEvent("worker-app:schedule-data-publish", {
        type: "worker-app",
        delay,
        requestedTargets: Array.isArray(profileTargets)
            ? profileTargets.length
            : 1,
        linkedCount: getWorkerAppLinkList().length,
        dirtyProfiles: dirtyProfileNames.size,
        dirtyWorkers: dirtyWorkerUids.size
    });
    scheduleHotPublish(Math.min(delay, HOT_PUBLISH_DELAY_MS));

    if (changeMetadata && Number(delay) <= 0) {
        void flushCalendarChangeEvents();
    }
}

export async function publishWorkerAppDataNow(profileTargets = []) {
    normalizeProfileTargets(profileTargets)
        .forEach(name => dirtyProfileNames.add(name));

    await publishHotNow();
}


export async function startWorkerAppDataSync(workspace) {
    const workspaceId = String(workspace?.id || "").trim();

    if (
        activeWorkspace?.id === workspaceId &&
        unsubscribeWorkerLinks
    ) {
        return;
    }

    stopWorkerAppDataSync();

    if (!workspaceId) return;

    activeWorkspace = {
        id: workspaceId,
        name: workspace?.name || ""
    };
    syncGeneration++;

    const generation = syncGeneration;

    try {
        const { db, firestoreModule } = await getFirebaseServices();

        if (generation !== syncGeneration) return;

        unsubscribeWorkerLinks = firestoreModule.onSnapshot(
            firestoreModule.collection(
                db,
                "workspaces",
                workspaceId,
                "workerLinks"
            ),
            snap => {
                if (generation !== syncGeneration) return;

                const previousLinks = getWorkerAppLinkList();
                const nextLinks = snap.docs
                    .map(normalizeWorkerLink)
                    .filter(Boolean);
                const {
                    initial,
                    changedUids,
                    removedUids,
                    shouldPublish
                } = planWorkerLinkSnapshot(
                    previousLinks,
                    nextLinks,
                    workerLinksInitialized
                );

                setWorkerAppLinks(nextLinks);
                workerLinksInitialized = true;
                if (initial || removedUids.length) {
                    const previousByUid = new Map(
                        previousLinks.map(link => [link.uid, link])
                    );
                    void markUnlinkedWorkerMessageDirectoryEntries(
                        workspaceId,
                        {
                            activeUids: nextLinks.map(link => link.uid),
                            removedLinks: removedUids
                                .map(uid => previousByUid.get(uid) || { uid }),
                            includeOrphans: initial
                        }
                    );
                }
                recordPerformanceEvent("worker-app:links-snapshot", {
                    type: "worker-app",
                    initial,
                    linkCount: getWorkerAppLinkList().length,
                    changedCount: changedUids.length,
                    removedCount: removedUids.length,
                    shouldPublish
                });

                if (
                    typeof window !== "undefined" &&
                    (initial || changedUids.length || removedUids.length)
                ) {
                    window.dispatchEvent(
                        new CustomEvent("proturnos:workerLinksChanged", {
                            detail: {
                                initial,
                                changedUids,
                                removedUids,
                                count: getWorkerAppLinkList().length
                            }
                        })
                    );
                }

                // El primer snapshot NO regenera la proyeccion (pesada, server)
                // y tampoco reescribe los docs livianos: desde que los publica
                // la Cloud Function, aqui solo se COMPRUEBA que esten y esten
                // al dia, y se repone lo que falte.
                //
                // Sigue siendo la red de reparacion que motivo este bootstrap
                // -hubo un incidente en que se perdio la publicacion y los
                // trabajadores nuevos no salian en Mensajes-, pero en regimen
                // normal cuesta una lectura por coleccion en vez de 132
                // escrituras, que era lo que se llevaba ~54 s de cada arranque.
                if (initial) {
                    void verifyLinkedWorkerDocs();
                    // La programacion se republica al arrancar, no solo cuando
                    // el supervisor edita algo. Es UNA escritura O(1) por
                    // sesion, y es lo que hace que un documento publicado con
                    // el formato anterior se corrija solo en el telefono del
                    // trabajador, sin obligar a tocar el tablero.
                    void publishSharedScheduleNow();
                    return;
                }

                changedUids.forEach(uid => dirtyWorkerUids.add(uid));

                // Las altas y cambios publican solo sus propios documentos.
                // Una baja ya no es legible al desaparecer workerLinks/{uid}.
                if (shouldPublish) {
                    scheduleHotPublish(INITIAL_PUBLISH_DELAY_MS);
                }
            },
            error => {
                console.warn(
                    "No se pudo leer enlaces de app trabajador.",
                    error
                );
            }
        );
    } catch (error) {
        console.warn(
            "No se pudo iniciar sincronizacion de app trabajador.",
            error
        );
    }
}

export function stopWorkerAppDataSync() {
    clearTimeout(hotPublishTimer);
    hotPublishTimer = null;
    coldOvertimeRefreshTimers.forEach(timer => clearTimeout(timer));
    coldOvertimeRefreshTimers.clear();
    coldOvertimeRefreshInFlight.clear();
    coldReportsRefreshTimers.forEach(timer => clearTimeout(timer));
    coldReportsRefreshTimers.clear();
    coldReportsRefreshInFlight.clear();
    coldExceptionsRefreshTimers.forEach(timer => clearTimeout(timer));
    coldExceptionsRefreshTimers.clear();
    coldExceptionsRefreshInFlight.clear();

    if (unsubscribeWorkerLinks) {
        unsubscribeWorkerLinks();
        unsubscribeWorkerLinks = null;
    }

    activeWorkspace = null;
    setWorkerAppLinks([]);
    workerLinksInitialized = false;
    hotPublishInFlight = false;
    hotPublishRequested = false;
    workerAppForegroundResumeBlockedUntil = 0;
    dirtyProfileNames = new Set();
    dirtyWorkerUids = new Set();
    hotPublishExtraStateKeys = new Set();
    syncGeneration++;
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
            markWorkerAppUserActivity,
            { capture: true, passive: true }
        );
    });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            workerAppForegroundResumeBlockedUntil =
                Date.now() + WORKER_APP_FOREGROUND_RESUME_COOLDOWN_MS;

            if (hotPublishInFlight) {
                hotPublishRequested = true;
                recordWorkerAppPublishDeferred(
                    WORKER_APP_FOREGROUND_RESUME_COOLDOWN_MS,
                    "foreground-resume"
                );
            }
            return;
        }

        workerAppForegroundResumeBlockedUntil = 0;

        if (dirtyProfileNames.size || dirtyWorkerUids.size) {
            scheduleHotPublish(0);
        }
    });

    window.addEventListener("proturnos:persistenceChanged", event => {
        applyDirtyFromKeys(
            event?.detail?.keys,
            event?.detail?.changes || {}
        );
    });

    window.addEventListener("proturnos:profileRenamed", event => {
        void syncWorkerLinkProfileName(
            event?.detail?.oldName,
            event?.detail?.newName
        );
    });

    window.addEventListener("proturnos:calendarProfilesChanged", event => {
        const detail = event?.detail || {};

        scheduleWorkerAppDataPublish(
            Number(detail.delay) || 300,
            detail.profiles || [],
            detail.metadata || null
        );
    });

    window.flushCalendarChangeEvents = flushCalendarChangeEvents;
}
