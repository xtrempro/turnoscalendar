import { keyFromDate, toISODate } from "./dateUtils.js";
import { normalizeText } from "./stringUtils.js";
import { TURNO } from "./constants.js";
import {
    getCurrentFirebaseUser,
    getFirebaseServices
} from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";
import { getJSON } from "./persistence.js";
import {
    getProfiles,
    getRotativa,
    getShiftAssigned,
    getManualLeaveBalances,
    isProfileActive,
    getTurnChangeConfig
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
import { canSwapProfiles, activeMonthlySwapCount } from "./swaps.js";
import { getWorkerBlockedDays } from "./workerAvailability.js";
import {
    buildWorkerHheeMonthSummary,
    buildWorkerHheeSummaries,
    buildWorkerReportPreviewHTML
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

// Publicacion "caliente" (mes en curso + siguiente): se agenda con margen
// para no competir con clicks/cambios de mes del calendario principal.
const HOT_PUBLISH_DELAY_MS = 12000;
const INITIAL_PUBLISH_DELAY_MS = 5000;
const WORKER_APP_USER_QUIET_MS = 45000;
const WORKER_APP_ACTIVE_RETRY_MS = 8000;
const WORKER_APP_COLD_USER_QUIET_MS = 90000;
const WORKER_APP_VISIBLE_RETRY_MS = 60000;
const WORKER_APP_CALENDAR_VISIBLE_RETRY_MS = 120000;
const WORKER_APP_FOREGROUND_RESUME_COOLDOWN_MS = 180000;
// Los resumenes HH.EE son caros: se mantienen acotados (no crecen con la
// ventana del calendario).
const OVERTIME_SUMMARY_MONTHS_BACK = 2;
const OVERTIME_SUMMARY_CACHE_VERSION = 1;
const COLD_OVERTIME_REFRESH_DELAY_MS = 45000;
const LEGAL_CONTINUOUS_BLOCK_DAYS = 10;

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
    "carry_"
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
    "gradeHourConfig",
    "profiles"
]);

let activeWorkspace = null;
let unsubscribeWorkerLinks = null;
let hotPublishTimer = null;
let hotPublishInFlight = false;
let hotPublishRequested = false;
let workerLinks = [];
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
        end: new Date(today.getFullYear(), today.getMonth() + 2, 0)
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

function findProfileForLink(link, profiles) {
    const linkRut = normalizeRut(link.profileRut);
    const linkName = normalizeText(link.profileName);

    if (linkRut) {
        const rutMatch = profiles.find(profile =>
            normalizeRut(profile.rut) === linkRut
        );

        if (rutMatch) return rutMatch;
    }

    if (linkName) {
        const exactNameMatch = profiles.find(profile =>
            normalizeText(profile.name) === linkName
        );

        if (exactNameMatch) return exactNameMatch;
    }

    return null;
}

export function getWorkerAppLinkForProfile(profileOrName) {
    const profiles = getProfiles();
    const profile = typeof profileOrName === "string"
        ? profiles.find(item => item.name === profileOrName)
        : profileOrName;

    if (!profile) return null;

    return workerLinks.find(link => {
        const linkedProfile = findProfileForLink(link, profiles);

        return linkedProfile?.name === profile.name;
    }) || null;
}

export function getWorkerAppLinks() {
    const profiles = getProfiles();

    return workerLinks.map(link => ({
        ...link,
        profile: findProfileForLink(link, profiles)
    }));
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

function profileLeaveMaps(profileName) {
    return {
        admin: getJSON("admin_" + profileName, {}),
        legal: getJSON("legal_" + profileName, {}),
        comp: getJSON("comp_" + profileName, {}),
        absences: getJSON("absences_" + profileName, {})
    };
}

// Calcula los dias de UN mes (objeto keyed por ISO). Reproduce la logica
// dia-a-dia original, acotada al mes pedido.
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
            hasLeave
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
    const ctx = { maps, profileData, colorResolver, holidaysByYear: {} };

    const computedDays = {};
    months.forEach(month => {
        Object.assign(computedDays, computeMonthDays(profile, month, ctx));
    });

    return {
        start: toISODate(start),
        end: toISODate(end),
        days: computedDays,
        partial: true
    };
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
        Boolean(actual.isManualExtra) !== Boolean(base.isManualExtra)
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
    const legal = getJSON("legal_" + profileName, {});
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
                STAFFING_RECURRENCE_TO_WORKER[reminder.recurrence] ||
                "Una sola vez",
            source: "Supervisor"
        }));
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
                baseVersion: WORKER_APP_BASE_VERSION,
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

function blockedDatesForProfile(profileName) {
    const profileKey = normalizeText(profileName);

    if (!profileKey) return [];

    return getWorkerBlockedDays()
        .filter(item =>
            normalizeText(item.profileName) === profileKey &&
            item.status !== "canceled" &&
            item.status !== "deleted" &&
            item.status !== "inactive"
        )
        .map(item => item.date)
        .filter(Boolean)
        .sort();
}

function buildSwapCandidatePayload(
    link,
    profile,
    workspace,
    linkedProfiles,
    schedule = null
) {
    const resolvedSchedule = schedule || computeProfileSchedule(profile);
    const compatibleWorkerUids = linkedProfiles
        .filter(item =>
            item.link.uid !== link.uid &&
            item.profile &&
            canSwapProfiles(profile.name, item.profile.name)
        )
        .map(item => item.link.uid);

    return {
        uid: link.uid,
        workspaceId: workspace.id,
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
            active: isProfileActive(profile)
        },
        rotativa: getRotativa(profile.name),
        shiftAssigned: Boolean(getShiftAssigned(profile.name)),
        compatibleWorkerUids,
        blockedDayDates: blockedDatesForProfile(profile.name),
        scheduleStart: resolvedSchedule.start,
        scheduleEnd: resolvedSchedule.end,
        days: resolvedSchedule.days,
        updatedAtISO: new Date().toISOString()
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

function buildWorkerMessageDirectoryPayload(link, profile, workspace) {
    const active = profile ? isProfileActive(profile) : false;

    return {
        uid: link.uid,
        workspaceId: workspace.id,
        workspaceName: workspace.name || link.workspaceName || "",
        profileName: profile?.name || link.profileName || "",
        profileRut: profile?.rut || link.profileRut || "",
        status: profile ? (active ? "active" : "inactive") : "profile_not_found",
        worker: {
            name: profile?.name || link.profileName || "Trabajador",
            email: profile?.email || link.workerEmail || "",
            phone: profile?.phone || "",
            rut: profile?.rut || link.profileRut || "",
            role: profile?.estamento || "",
            profession: profile?.profession || "",
            unit: workspace.name || link.workspaceName || "",
            active
        },
        updatedAtISO: new Date().toISOString()
    };
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
                },
                { merge: true }
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
    const previousMonthHashes =
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

async function writeWorkerSwapCandidate(payload, workspaceId) {
    const { db, firestoreModule } = await getFirebaseServices();

    await measurePerformance(
        "worker-app:write-swap-candidate",
        () => firestoreModule.setDoc(
            firestoreModule.doc(
                db,
                "workspaces",
                workspaceId,
                "workerSwapCandidates",
                payload.uid
            ),
            {
                ...payload,
                updatedAt: firestoreModule.serverTimestamp()
            },
            { merge: true }
        ),
        {
            uid: payload?.uid || "",
            profile: payload?.profileName || "",
            compatibleCount:
                payload?.compatibleWorkerUids?.length || 0
        },
        {
            asyncThreshold: 120
        }
    );
}

async function writeWorkerMessageDirectoryEntry(payload, workspaceId) {
    const { db, firestoreModule } = await getFirebaseServices();

    await measurePerformance(
        "worker-app:write-directory",
        () => firestoreModule.setDoc(
            firestoreModule.doc(
                db,
                "workspaces",
                workspaceId,
                "workerMessageDirectory",
                payload.uid
            ),
            {
                ...payload,
                updatedAt: firestoreModule.serverTimestamp()
            },
            { merge: true }
        ),
        {
            uid: payload?.uid || "",
            profile: payload?.profileName || ""
        },
        {
            asyncThreshold: 120
        }
    );
}

// ───────── Deteccion de "sucios" desde detail.keys ─────────

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

function applyDirtyFromKeys(keys) {
    if (!activeWorkspace?.id || !workerLinks.length) return;
    if (!Array.isArray(keys) || !keys.length) return;

    const profiles = getProfiles();
    const linkedNames = new Set(
        linkedProfilePairs(profiles)
            .map(item => item.profile?.name)
            .filter(Boolean)
    );
    let relevant = false;

    for (const key of keys) {
        const result = classifyChangedKey(key, profiles);

        if (result.ignore) continue;

        if (result.all) {
            // Un cambio global no puede identificar con seguridad a los
            // afectados. El cliente que origina la accion debe marcar los
            // perfiles concretos; nunca se republican los 70 por este evento.
            continue;
        }

        if (result.profileName && linkedNames.has(result.profileName)) {
            // Solo se reacciona a cambios de trabajadores ENLAZADOS: si el
            // perfil no usa la PWA, no se gasta ningun recurso en publicarlo.
            dirtyProfileNames.add(result.profileName);
            relevant = true;
        }
    }

    if (!relevant) return;

    scheduleHotPublish();
}

function currentWorkspace() {
    const stored = getActiveWorkspace() || {};

    return { ...stored, ...activeWorkspace };
}

function linkedProfilePairs(profiles) {
    return workerLinks.map(link => ({
        link,
        profile: findProfileForLink(link, profiles)
    }));
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
    if (!activeWorkspace?.id || !workerLinks.length) return;

    recordPerformanceEvent("worker-app:schedule-hot-publish", {
        type: "worker-app",
        delay,
        linkedCount: workerLinks.length,
        dirtyProfiles: dirtyProfileNames.size,
        dirtyWorkers: dirtyWorkerUids.size
    });
    clearTimeout(hotPublishTimer);
    hotPublishTimer = setTimeout(() => publishHotNow(), delay);
}

async function publishHotNow() {
    if (!activeWorkspace?.id || !workerLinks.length) return;

    if (!dirtyProfileNames.size && !dirtyWorkerUids.size) {
        hotPublishRequested = false;
        return;
    }

    const interactiveDelay = workerAppInteractiveDelay();

    if (interactiveDelay > 0) {
        recordWorkerAppPublishDeferred(interactiveDelay);
        scheduleHotPublish(interactiveDelay);
        return;
    }

    if (hotPublishInFlight) {
        hotPublishRequested = true;
        return;
    }

    hotPublishInFlight = true;
    hotPublishRequested = false;
    const generation = syncGeneration;
    const workspace = currentWorkspace();
    const profiles = getProfiles();
    const targets = dirtyLinkTargets(profiles);
    const linkedProfiles = linkedProfilePairs(profiles);
    const shouldContinue = () =>
        publishStillCurrent(generation, workspace.id);
    const shouldKeepPublishing = () =>
        shouldContinue() && workerAppInteractiveDelay(2500) === 0;
    const finishPublish = startPerformanceSpan(
        "worker-app:publish-hot",
        {
            workspaceId: workspace.id,
            targetCount: targets.length,
            linkedCount: workerLinks.length,
            profileCount: profiles.length
        },
        {
            type: "async-span",
            threshold: 120
        }
    );

    dirtyProfileNames = new Set();
    dirtyWorkerUids = new Set();
    let queueResult = {
        completed: true,
        processed: 0
    };

    try {
        await waitWorkerAppIdle(1800);
        if (!shouldContinue()) return;

        queueResult = await runCooperativeQueue(targets, async item => {
            await waitWorkerAppIdle(900);
            if (!shouldContinue()) return;
            if (deferWorkerAppItemIfForeground(item, "foreground-before-read")) {
                return;
            }

            const previousPayload = item.profile
                ? await readWorkerAppData(workspace.id, item.link.uid)
                : null;
            if (deferWorkerAppItemIfForeground(item, "foreground-after-read")) {
                return;
            }
            const payload = item.profile
                ? await buildWorkerAppPayload(
                    item.link,
                    item.profile,
                    workspace,
                    previousPayload
                )
                : buildMissingProfilePayload(item.link, workspace);
            if (deferWorkerAppItemIfForeground(item, "foreground-before-write")) {
                return;
            }
            const projectionResult = await writeWorkerAppProjection(
                payload,
                workspace.id,
                item.link.uid,
                previousPayload
            );

            if (projectionResult?.deferred) {
                markDirtyTargetAgain(item);
                hotPublishRequested = true;
                return;
            }

            if (item.workerDirty) {
                const directoryDelay = workerAppInteractiveDelay();

                if (directoryDelay > 0) {
                    recordWorkerAppPublishDeferred(
                        directoryDelay,
                        "directory-write-user-active"
                    );
                    markDirtyTargetAgain(item);
                    hotPublishRequested = true;
                    return;
                }

                await waitWorkerAppIdle(500);
                await writeWorkerMessageDirectoryEntry(
                    buildWorkerMessageDirectoryPayload(
                        item.link,
                        item.profile,
                        workspace
                    ),
                    workspace.id
                );
            } else {
                recordPerformanceEvent("worker-app:skip-directory-write", {
                    type: "worker-app",
                    uid: item.link.uid,
                    profile: item.profile?.name || item.link.profileName || "",
                    reason: "schedule-only-change"
                });
            }

            if (item.profile) {
                const swapDelay = workerAppInteractiveDelay();

                if (swapDelay > 0) {
                    recordWorkerAppPublishDeferred(
                        swapDelay,
                        "swap-candidate-user-active"
                    );
                    markDirtyTargetAgain(item);
                    hotPublishRequested = true;
                    return;
                }

                await waitWorkerAppIdle(500);
                await writeWorkerSwapCandidate(
                    buildSwapCandidatePayload(
                        item.link,
                        item.profile,
                        workspace,
                        linkedProfiles,
                        {
                            start: payload.scheduleStart,
                            end: payload.scheduleEnd,
                            days: payload.days
                        }
                    ),
                    workspace.id
                );
            }
        }, { shouldContinue: shouldKeepPublishing });

        if (!queueResult.completed) {
            targets
                .slice(queueResult.processed)
                .forEach(markDirtyTargetAgain);
            hotPublishRequested = true;
        }
    } catch (error) {
        if (shouldContinue()) {
            targets.forEach(markDirtyTargetAgain);
            hotPublishRequested = true;
        }

        console.warn(
            "No se pudo publicar la actualizacion caliente del trabajador.",
            error
        );
    } finally {
        if (generation === syncGeneration) {
            hotPublishInFlight = false;

            if (hotPublishRequested && activeWorkspace?.id) {
                scheduleHotPublish();
            }
        }
        finishPublish({
            requestedAgain: hotPublishRequested,
            completed: shouldContinue()
        });
    }
}

// API publica: siempre exige perfiles concretos.

export function scheduleWorkerAppDataPublish(
    delay = HOT_PUBLISH_DELAY_MS,
    profileTargets = []
) {
    if (!activeWorkspace?.id || !workerLinks.length) return;

    normalizeProfileTargets(profileTargets)
        .forEach(name => dirtyProfileNames.add(name));

    if (!dirtyProfileNames.size && !dirtyWorkerUids.size) return;

    recordPerformanceEvent("worker-app:schedule-data-publish", {
        type: "worker-app",
        delay,
        requestedTargets: Array.isArray(profileTargets)
            ? profileTargets.length
            : 1,
        linkedCount: workerLinks.length,
        dirtyProfiles: dirtyProfileNames.size,
        dirtyWorkers: dirtyWorkerUids.size
    });
    scheduleHotPublish(Math.min(delay, HOT_PUBLISH_DELAY_MS));
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

                const previousLinks = workerLinks;
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

                workerLinks = nextLinks;
                workerLinksInitialized = true;
                recordPerformanceEvent("worker-app:links-snapshot", {
                    type: "worker-app",
                    initial,
                    linkCount: workerLinks.length,
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
                                count: workerLinks.length
                            }
                        })
                    );
                }

                // El primer snapshot es solo lectura: abrir un entorno no debe
                // regenerar los datos PWA de todos sus trabajadores.
                if (initial) return;

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
    workerLinks = [];
    workerLinksInitialized = false;
    hotPublishInFlight = false;
    hotPublishRequested = false;
    workerAppForegroundResumeBlockedUntil = 0;
    dirtyProfileNames = new Set();
    dirtyWorkerUids = new Set();
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
        applyDirtyFromKeys(event?.detail?.keys);
    });
}
