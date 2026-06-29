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

// Publicacion "caliente" (mes en curso + siguiente): frecuente y barata.
const HOT_PUBLISH_DELAY_MS = 1200;
// Publicacion "fria" (ventana completa de 24 meses + reportes + saldos): diferida.
const COLD_PUBLISH_DELAY_MS = 5 * 60 * 1000;
const INITIAL_PUBLISH_DELAY_MS = 2500;
// Ventana del calendario que ve el trabajador en la PWA: 12 meses atras + el
// mes actual + 12 meses adelante (>= 24 meses, segun lo pedido).
const SCHEDULE_MONTHS_BACK = 12;
const SCHEDULE_MONTHS_FORWARD = 13;
// Los resumenes HH.EE son caros: se mantienen acotados (no crecen con la
// ventana del calendario).
const OVERTIME_SUMMARY_MONTHS_BACK = 2;
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

// Claves globales que afectan a TODOS los trabajadores enlazados.
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

const PWA_RELEVANT_STATE_MODULES = new Set([
    "profile",
    "turnos",
    "clockmarks",
    "swap",
    "hours",
    "weekly"
]);

let activeWorkspace = null;
let unsubscribeWorkerLinks = null;
let hotPublishTimer = null;
let coldPublishTimer = null;
let coldPublishInFlight = false;
let coldPublishRequested = false;
let workerLinks = [];
let workerLinksInitialized = false;
let syncGeneration = 0;

// Perfiles cuyos datos cambiaron desde la ultima publicacion fria. Si
// `dirtyAll` esta activo, se republican todos los enlazados.
let dirtyProfileNames = new Set();
let dirtyWorkerUids = new Set();
let dirtyAll = false;

// Cache en memoria del calendario calculado por perfil, para no recomputar 24
// meses en cada cambio. Clave: nombre de perfil.
//   scheduleCache.get(name) = { start, end, days, signatures: { global, months } }
const scheduleCache = new Map();

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

function scheduleRange(today = new Date()) {
    return {
        start: new Date(
            today.getFullYear(),
            today.getMonth() - SCHEDULE_MONTHS_BACK,
            1
        ),
        end: new Date(
            today.getFullYear(),
            today.getMonth() + SCHEDULE_MONTHS_FORWARD,
            0
        )
    };
}

// ───────── Helpers de meses ─────────
// Un mes se representa como { year, monthIndex } (monthIndex 0-based) y tiene un
// id estable `YYYY-MM` (1-based con padding) para cache y firmas.

function monthId({ year, monthIndex }) {
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

// Prefijo ISO `YYYY-MM-` (1-based padded) para agrupar `days` por mes.
function isoMonthPrefix({ year, monthIndex }) {
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}-`;
}

// Prefijo de clave de calendario `YYYY-M-` (0-based sin padding) para cortar los
// mapas de turnos/permisos por mes.
function calendarMonthPrefix({ year, monthIndex }) {
    return `${year}-${monthIndex}-`;
}

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

function hotMonthIds(today = new Date()) {
    const current = { year: today.getFullYear(), monthIndex: today.getMonth() };
    const nextDate = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const next = { year: nextDate.getFullYear(), monthIndex: nextDate.getMonth() };

    return new Set([monthId(current), monthId(next)]);
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

// Firma barata del "slice" mensual de los mapas por-perfil. Si no cambia entre
// publicaciones, ese mes se reutiliza de cache sin recomputar.
function monthSliceSignature(month, maps, profileData) {
    const prefix = calendarMonthPrefix(month);
    const pick = (map) =>
        Object.keys(map || {})
            .filter(key => key.startsWith(prefix))
            .sort()
            .map(key => `${key}=${map[key]}`)
            .join(",");

    return [
        pick(profileData),
        pick(maps.admin),
        pick(maps.legal),
        pick(maps.comp),
        pick(maps.absences)
    ].join("|");
}

// Firma "global" del perfil: estructura que afecta a TODOS sus meses (rotativa,
// asignacion, base, bloqueos, reemplazos, cambios, feriados, colores). Si
// cambia, se recomputan todos los meses del perfil.
function globalProfileSignature(profileName) {
    const replacements = getJSON("replacements", []);
    const ownReplacements = Array.isArray(replacements)
        ? replacements.filter(item =>
            item?.worker === profileName || item?.replaced === profileName
        )
        : replacements;

    return JSON.stringify({
        rotativa: getRotativa(profileName),
        shift: getShiftAssigned(profileName),
        base: getJSON("baseData_" + profileName, {}),
        shiftHistory: getJSON("shiftAssignmentHistory_" + profileName, {}),
        blocked: getJSON("blocked_" + profileName, {}),
        hourReturns: getJSON("hourReturns_" + profileName, {}),
        replacements: ownReplacements,
        swaps: getJSON("swaps", []),
        turnChange: getTurnChangeConfig(),
        holidays: getJSON("manualHolidays", {}),
        colors: getTurnoColorConfig()
    });
}

/**
 * Calcula el calendario del perfil reutilizando cache por mes.
 * @param {object} options
 * @param {"hot"|"full"} options.mode  "hot" devuelve solo mes actual + siguiente
 *   (para escritura parcial); "full" devuelve los 24 meses.
 * @returns {{ start, end, days, partial }}
 */
function computeProfileSchedule(profile, { mode = "full" } = {}) {
    const today = new Date();
    const { start, end } = scheduleRange(today);
    const months = listMonthsInRange(start, end);
    const hotIds = hotMonthIds(today);
    const maps = profileLeaveMaps(profile.name);
    const profileData = getJSON("data_" + profile.name, {});
    const colorResolver = buildHexColorResolver(getTurnoColorConfig());
    const ctx = { maps, profileData, colorResolver, holidaysByYear: {} };

    const globalSig = globalProfileSignature(profile.name);
    const monthSigs = {};
    months.forEach(month => {
        monthSigs[monthId(month)] = monthSliceSignature(month, maps, profileData);
    });

    const cached = scheduleCache.get(profile.name);
    const globalChanged = !cached || cached.signatures.global !== globalSig;

    const monthsToCompute = months.filter(month => {
        const id = monthId(month);

        if (mode === "hot") return hotIds.has(id);
        if (globalChanged) return true;
        if (!cached.days) return true;

        return hotIds.has(id) ||
            cached.signatures.months[id] !== monthSigs[id];
    });

    const computedDays = {};
    monthsToCompute.forEach(month => {
        Object.assign(computedDays, computeMonthDays(profile, month, ctx));
    });

    if (mode === "hot") {
        // Actualiza solo los meses calientes en la cache (si ya existe una base
        // completa y la firma global no cambio; de lo contrario lo hara la
        // publicacion fria).
        if (cached?.days && !globalChanged) {
            const mergedMonths = { ...cached.signatures.months };
            monthsToCompute.forEach(month => {
                mergedMonths[monthId(month)] = monthSigs[monthId(month)];
            });
            scheduleCache.set(profile.name, {
                start: toISODate(start),
                end: toISODate(end),
                days: { ...cached.days, ...computedDays },
                signatures: { global: globalSig, months: mergedMonths }
            });
        }

        return {
            start: toISODate(start),
            end: toISODate(end),
            days: computedDays,
            partial: true
        };
    }

    // mode === "full": reutiliza de cache los meses no recomputados.
    const days = {};
    const recomputedIds = new Set(monthsToCompute.map(monthId));

    months.forEach(month => {
        const id = monthId(month);

        if (recomputedIds.has(id)) return;
        if (!cached?.days) return;

        const prefix = isoMonthPrefix(month);
        Object.entries(cached.days).forEach(([iso, value]) => {
            if (iso.startsWith(prefix)) days[iso] = value;
        });
    });

    Object.assign(days, computedDays);

    scheduleCache.set(profile.name, {
        start: toISODate(start),
        end: toISODate(end),
        days,
        signatures: { global: globalSig, months: monthSigs }
    });

    return {
        start: toISODate(start),
        end: toISODate(end),
        days,
        partial: false
    };
}

function buildScheduleDays(profile) {
    const schedule = computeProfileSchedule(profile, { mode: "full" });

    return {
        start: schedule.start,
        end: schedule.end,
        days: schedule.days
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

async function buildOvertimeSummaries(profile, schedule) {
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
}

// Reporte imprimible (HTML) por mes para la app del trabajador. Para no inflar
// el documento de Firestore ni gastar CPU, se generan AUTOMATICAMENTE solo el
// mes actual y el anterior. Los demas meses se entregan a pedido del trabajador
// (boton "Solicitar informe" en la PWA -> workerRequests type "report_request").
async function buildWorkerReports(profile) {
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

async function buildWorkerAppPayload(link, profile, workspace) {
    const schedule = buildScheduleDays(profile);
    const leaveBalancesByYear = await leaveBalancesByScheduleYear(
        profile.name,
        schedule
    );
    const currentYear = String(new Date().getFullYear());
    const leaveBalances = leaveBalancesByYear[currentYear];
    const overtimeSummaries = await buildOvertimeSummaries(
        profile,
        schedule
    );
    const reportsByMonth = await buildWorkerReports(profile);

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
        leaveBalances,
        leaveBalancesByYear,
        scheduleStart: schedule.start,
        scheduleEnd: schedule.end,
        days: schedule.days,
        supervisorReminders: buildSupervisorReminders(profile),
        overtimeSummaries,
        reportsByMonth,
        swapLimit: buildSwapLimit(profile.name),
        updatedAtISO: new Date().toISOString()
    };
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

function buildSwapCandidatePayload(link, profile, workspace, linkedProfiles) {
    const schedule = buildScheduleDays(profile);
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
        scheduleStart: schedule.start,
        scheduleEnd: schedule.end,
        days: schedule.days,
        updatedAtISO: new Date().toISOString()
    };
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

    await firestoreModule.setDoc(
        firestoreModule.doc(
            db,
            "workspaces",
            workspaceId,
            "workerAppData",
            uid
        ),
        {
            ...payload,
            updatedAt: firestoreModule.serverTimestamp()
        },
        { merge: true }
    );
}

// Escritura "caliente": solo los dias del mes en curso + siguiente. Firestore
// hace deep-merge del mapa `days`, por lo que los meses frios NO se reescriben.
async function writeWorkerAppHotDays(workspaceId, uid, partialDays) {
    const { db, firestoreModule } = await getFirebaseServices();

    await firestoreModule.setDoc(
        firestoreModule.doc(
            db,
            "workspaces",
            workspaceId,
            "workerAppData",
            uid
        ),
        {
            days: partialDays,
            updatedAtISO: new Date().toISOString(),
            updatedAt: firestoreModule.serverTimestamp()
        },
        { merge: true }
    );
}

async function writeWorkerSwapCandidates(payloads, workspaceId) {
    const { db, firestoreModule } = await getFirebaseServices();
    const collectionRef = firestoreModule.collection(
        db,
        "workspaces",
        workspaceId,
        "workerSwapCandidates"
    );
    const snap = await firestoreModule.getDocs(collectionRef);
    const batch = firestoreModule.writeBatch(db);
    const nextIds = new Set(payloads.map(payload => payload.uid));

    snap.docs.forEach(docSnap => {
        if (!nextIds.has(docSnap.id)) {
            batch.delete(docSnap.ref);
        }
    });

    payloads.forEach(payload => {
        batch.set(
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
        );
    });

    await batch.commit();
}

async function writeWorkerMessageDirectory(payloads, workspaceId) {
    const { db, firestoreModule } = await getFirebaseServices();
    const collectionRef = firestoreModule.collection(
        db,
        "workspaces",
        workspaceId,
        "workerMessageDirectory"
    );
    const snap = await firestoreModule.getDocs(collectionRef);
    const batch = firestoreModule.writeBatch(db);
    const nextIds = new Set(payloads.map(payload => payload.uid));

    snap.docs.forEach(docSnap => {
        if (!nextIds.has(docSnap.id)) {
            batch.delete(docSnap.ref);
        }
    });

    payloads.forEach(payload => {
        batch.set(
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
        );
    });

    await batch.commit();
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
            dirtyAll = true;
            relevant = true;
        } else if (result.profileName && linkedNames.has(result.profileName)) {
            // Solo se reacciona a cambios de trabajadores ENLAZADOS: si el
            // perfil no usa la PWA, no se gasta ningun recurso en publicarlo.
            dirtyProfileNames.add(result.profileName);
            relevant = true;
        }
    }

    if (!relevant) return;

    scheduleHotPublish();
    scheduleColdPublish();
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

    if (dirtyAll) return linked;

    return linked.filter(item =>
        dirtyWorkerUids.has(item.link.uid) ||
        (item.profile && dirtyProfileNames.has(item.profile.name))
    );
}

function publishStillCurrent(generation, workspaceId) {
    return generation === syncGeneration &&
        activeWorkspace?.id === workspaceId;
}

// ───────── Publicacion caliente (mes actual + siguiente) ─────────

export function scheduleHotPublish(delay = HOT_PUBLISH_DELAY_MS) {
    if (!activeWorkspace?.id || !workerLinks.length) return;

    clearTimeout(hotPublishTimer);
    hotPublishTimer = setTimeout(() => publishHotNow(), delay);
}

async function publishHotNow() {
    if (!activeWorkspace?.id || !workerLinks.length) return;

    const generation = syncGeneration;
    const workspace = currentWorkspace();
    const profiles = getProfiles();
    const targets = dirtyLinkTargets(profiles);
    const shouldContinue = () =>
        publishStillCurrent(generation, workspace.id);

    try {
        await runCooperativeQueue(targets, async item => {
            if (!item.profile) return;

            // Solo escritura parcial si ya existe una base completa publicada
            // (cache poblada por una publicacion fria). Si no, deja que la fria
            // cree el documento completo para no dejarlo a medias.
            if (!scheduleCache.has(item.profile.name)) return;

            const partial = computeProfileSchedule(item.profile, { mode: "hot" });

            if (partial?.days && Object.keys(partial.days).length) {
                await writeWorkerAppHotDays(
                    workspace.id,
                    item.link.uid,
                    partial.days
                );
            }
        }, { shouldContinue });
    } catch (error) {
        console.warn(
            "No se pudo publicar la actualizacion caliente del trabajador.",
            error
        );
    }
}

// ───────── Publicacion fria / completa (24 meses + reportes) ─────────

export function scheduleColdPublish(delay = COLD_PUBLISH_DELAY_MS) {
    if (!activeWorkspace?.id || !workerLinks.length) return;

    clearTimeout(coldPublishTimer);
    coldPublishTimer = setTimeout(() => publishColdNow(), delay);
}

async function publishColdNow() {
    if (!activeWorkspace?.id || !workerLinks.length) return;

    if (coldPublishInFlight) {
        coldPublishRequested = true;
        return;
    }

    coldPublishInFlight = true;
    coldPublishRequested = false;

    const generation = syncGeneration;
    const workspace = currentWorkspace();
    const profiles = getProfiles();
    const targets = dirtyLinkTargets(profiles);
    const linkedProfiles = linkedProfilePairs(profiles);
    const publishingAll = dirtyAll;
    const shouldContinue = () =>
        publishStillCurrent(generation, workspace.id);

    // Se limpian los "sucios" ahora: cualquier cambio durante la publicacion
    // vuelve a marcar y reprograma.
    dirtyAll = false;
    dirtyProfileNames = new Set();
    dirtyWorkerUids = new Set();

    try {
        const dataResult = await runCooperativeQueue(
            targets,
            async item => {
                const payload = item.profile
                    ? await buildWorkerAppPayload(
                        item.link,
                        item.profile,
                        workspace
                    )
                    : buildMissingProfilePayload(item.link, workspace);

                await writeWorkerAppData(
                    payload,
                    workspace.id,
                    item.link.uid
                );
            },
            { shouldContinue }
        );

        if (!dataResult.completed) return;

        const swapCandidatePayloads = [];
        const candidateResult = await runCooperativeQueue(
            linkedProfiles.filter(item => item.profile),
            item => {
                swapCandidatePayloads.push(buildSwapCandidatePayload(
                    item.link,
                    item.profile,
                    workspace,
                    linkedProfiles
                ));
            },
            { shouldContinue }
        );

        if (!candidateResult.completed) return;

        await writeWorkerSwapCandidates(swapCandidatePayloads, workspace.id);

        if (!shouldContinue()) return;

        const messageDirectoryPayloads = [];
        const directoryResult = await runCooperativeQueue(
            linkedProfiles,
            item => {
                messageDirectoryPayloads.push(buildWorkerMessageDirectoryPayload(
                    item.link,
                    item.profile,
                    workspace
                ));
            },
            { shouldContinue }
        );

        if (!directoryResult.completed) return;

        await writeWorkerMessageDirectory(
            messageDirectoryPayloads,
            workspace.id
        );
    } catch (error) {
        if (shouldContinue()) {
            if (publishingAll) {
                dirtyAll = true;
            } else {
                targets.forEach(item => dirtyWorkerUids.add(item.link.uid));
            }

            coldPublishRequested = true;
        }

        console.warn(
            "No se pudo publicar datos para la app del trabajador.",
            error
        );
    } finally {
        // Una cola antigua puede terminar despues de cambiar de entorno. En
        // ese caso no debe alterar el estado de la cola del entorno nuevo.
        if (generation === syncGeneration) {
            coldPublishInFlight = false;

            if (coldPublishRequested && activeWorkspace?.id) {
                scheduleColdPublish();
            }
        }
    }
}

// API publica historica. Si persistenceChanged ya identifico perfiles concretos,
// conserva ese conjunto en vez de ampliarlo a todos los enlaces.
export function scheduleWorkerAppDataPublish(delay = HOT_PUBLISH_DELAY_MS) {
    if (!activeWorkspace?.id || !workerLinks.length) return;

    if (!dirtyProfileNames.size && !dirtyWorkerUids.size) {
        dirtyAll = true;
    }

    scheduleHotPublish(Math.min(delay, HOT_PUBLISH_DELAY_MS));
    scheduleColdPublish(delay);
}

export async function publishWorkerAppDataNow() {
    dirtyAll = true;
    await publishColdNow();
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

                // Altas/cambios publican solo sus documentos. Las bajas no
                // tienen documento destino, pero requieren limpiar directorios
                // y candidatos de intercambio.
                if (shouldPublish) {
                    scheduleColdPublish(INITIAL_PUBLISH_DELAY_MS);
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
    clearTimeout(coldPublishTimer);
    hotPublishTimer = null;
    coldPublishTimer = null;

    if (unsubscribeWorkerLinks) {
        unsubscribeWorkerLinks();
        unsubscribeWorkerLinks = null;
    }

    activeWorkspace = null;
    workerLinks = [];
    workerLinksInitialized = false;
    coldPublishInFlight = false;
    coldPublishRequested = false;
    dirtyAll = false;
    dirtyProfileNames = new Set();
    dirtyWorkerUids = new Set();
    scheduleCache.clear();
    syncGeneration++;
}

if (typeof window !== "undefined") {
    window.addEventListener("proturnos:persistenceChanged", event => {
        applyDirtyFromKeys(event?.detail?.keys);
    });

    window.addEventListener("proturnos:firebaseAppState", event => {
        const detail = event.detail || {};

        // `app-state-applied` es el snapshot inicial y no representa una
        // modificacion nueva. Solo se publica ante modulos posteriores que sí
        // afectan lo que ve el trabajador.
        if (
            detail.type !== "app-state-module-applied" ||
            !PWA_RELEVANT_STATE_MODULES.has(detail.moduleId)
        ) return;

        dirtyAll = true;
        scheduleHotPublish(300);
        scheduleColdPublish();
    });
}
