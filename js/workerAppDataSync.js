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
    buildWorkerHheeSummaries
} from "./hoursReport.js";
import { fetchHolidays, getCachedHolidays } from "./holidays.js";
import { getTurnoColorConfig } from "./turnoColors.js";
import { withManualBalance } from "./balanceUtils.js";
import {
    getDayColorGradient,
    buildHexColorResolver
} from "./dayColorBands.js";

const PUBLISH_DELAY_MS = 1200;
const INITIAL_PUBLISH_DELAY_MS = 2500;
const SCHEDULE_MONTHS_BACK = 2;
const SCHEDULE_MONTHS_FORWARD = 13;
const LEGAL_CONTINUOUS_BLOCK_DAYS = 10;

let activeWorkspace = null;
let unsubscribeWorkerLinks = null;
let publishTimer = null;
let publishInFlight = false;
let publishRequested = false;
let workerLinks = [];
let syncGeneration = 0;

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

function buildScheduleDays(profile) {
    const { start, end } = scheduleRange();
    const maps = profileLeaveMaps(profile.name);
    const profileData = getJSON("data_" + profile.name, {});
    const days = {};
    // Resolver de color en HEX (snapshot de los colores configurados) para que
    // la PWA pinte las mismas bandas que el calendario.
    const colorResolver = buildHexColorResolver(getTurnoColorConfig());
    const holidaysByYear = {};

    for (
        let cursor = new Date(start);
        cursor <= end;
        cursor = addDays(cursor, 1)
    ) {
        const iso = toISODate(cursor);
        const keyDay = keyFromDate(cursor);
        const cursorYear = cursor.getFullYear();
        if (!holidaysByYear[cursorYear]) {
            holidaysByYear[cursorYear] = getCachedHolidays(cursorYear);
        }
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
            holidaysByYear[cursorYear],
            maps.admin[keyDay],
            baseWithSwaps,
            {
                resolveColor: colorResolver,
                unbasedComponentsAreExtra: manualExtra,
                singleBandGradient: manualExtra
            }
        );

        days[iso] = {
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

    return {
        start: toISODate(start),
        end: toISODate(end),
        days
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
            SCHEDULE_MONTHS_BACK
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

export function scheduleWorkerAppDataPublish(delay = PUBLISH_DELAY_MS) {
    if (!activeWorkspace?.id || !workerLinks.length) return;

    clearTimeout(publishTimer);
    publishTimer = setTimeout(
        () => publishWorkerAppDataNow(),
        delay
    );
}

export async function publishWorkerAppDataNow() {
    if (!activeWorkspace?.id || !workerLinks.length) return;

    if (publishInFlight) {
        publishRequested = true;
        return;
    }

    publishInFlight = true;
    publishRequested = false;

    const generation = syncGeneration;
    const storedWorkspace = getActiveWorkspace() || {};
    const workspace = {
        ...storedWorkspace,
        ...activeWorkspace
    };
    const profiles = getProfiles();
    const linkedProfiles = workerLinks.map(link => ({
        link,
        profile: findProfileForLink(link, profiles)
    }));

    try {
        await Promise.all(
            linkedProfiles.map(async item => {
                const payload = item.profile
                    ? await buildWorkerAppPayload(item.link, item.profile, workspace)
                    : buildMissingProfilePayload(item.link, workspace);

                return writeWorkerAppData(
                    payload,
                    workspace.id,
                    item.link.uid
                );
            })
        );

        await writeWorkerSwapCandidates(
            linkedProfiles
                .filter(item => item.profile)
                .map(item => buildSwapCandidatePayload(
                    item.link,
                    item.profile,
                    workspace,
                    linkedProfiles
                )),
            workspace.id
        );

        await writeWorkerMessageDirectory(
            linkedProfiles.map(item => buildWorkerMessageDirectoryPayload(
                item.link,
                item.profile,
                workspace
            )),
            workspace.id
        );
    } catch (error) {
        console.warn(
            "No se pudo publicar datos para la app del trabajador.",
            error
        );
    } finally {
        publishInFlight = false;

        if (
            publishRequested &&
            generation === syncGeneration &&
            activeWorkspace?.id
        ) {
            scheduleWorkerAppDataPublish();
        }
    }
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

                workerLinks = snap.docs
                    .map(normalizeWorkerLink)
                    .filter(Boolean);

                if (typeof window !== "undefined") {
                    window.dispatchEvent(
                        new CustomEvent("proturnos:workerLinksChanged")
                    );
                }

                scheduleWorkerAppDataPublish(INITIAL_PUBLISH_DELAY_MS);
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
    clearTimeout(publishTimer);
    publishTimer = null;

    if (unsubscribeWorkerLinks) {
        unsubscribeWorkerLinks();
        unsubscribeWorkerLinks = null;
    }

    activeWorkspace = null;
    workerLinks = [];
    publishInFlight = false;
    publishRequested = false;
    syncGeneration++;
}

if (typeof window !== "undefined") {
    window.addEventListener("proturnos:persistenceChanged", () => {
        scheduleWorkerAppDataPublish();
    });

    window.addEventListener("proturnos:firebaseAppState", event => {
        if (event.detail?.type === "app-state-applied") {
            scheduleWorkerAppDataPublish(300);
        }
    });
}
