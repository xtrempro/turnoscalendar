import { getJSON, setJSON } from "./persistence.js";
import {
    getCurrentProfile,
    getProfiles,
    getReplacementRequests,
    getReplacements,
    saveReplacementRequests,
    saveReplacements
} from "./storage.js";
import { fetchHolidays } from "./holidays.js";
import { isBusinessDay } from "./calculations.js";
import { getCurrentFirebaseUser } from "./firebaseClient.js";

const KEY = "auditLog";
const MAX_LOGS = 1500;
let selectedMonth = "";
const selectedCategories = new Set();
let expandedLogId = "";

export const AUDIT_CATEGORY = {
    TURN_CHANGES: "turn_changes",
    OVERTIME: "overtime",
    LEAVE_ABSENCE: "leave_absence",
    CALENDAR: "calendar",
    COLLABORATOR_CREATED: "collaborator_created",
    COLLABORATOR_UPDATED: "collaborator_updated",
    PROFILE_STATUS: "profile_status",
    STAFFING: "staffing",
    SYSTEM_SETTINGS: "system_settings",
    WORKER_REQUESTS: "worker_requests"
};

const CATEGORY_DEFS = [
    {
        key: AUDIT_CATEGORY.TURN_CHANGES,
        title: "Cambios de Turno",
        tone: "orange"
    },
    {
        key: AUDIT_CATEGORY.OVERTIME,
        title: "Horas Extras",
        tone: "green"
    },
    {
        key: AUDIT_CATEGORY.LEAVE_ABSENCE,
        title: "Aplicacion de Vacaciones/Ausencias",
        tone: "cyan"
    },
    {
        key: AUDIT_CATEGORY.CALENDAR,
        title: "Modificaciones del Calendario",
        tone: "blue"
    },
    {
        key: AUDIT_CATEGORY.COLLABORATOR_CREATED,
        title: "Creacion de Nuevos Colaboradores",
        tone: "violet"
    },
    {
        key: AUDIT_CATEGORY.COLLABORATOR_UPDATED,
        title: "Modificacion de Datos de los Colaboradores",
        tone: "yellow"
    },
    {
        key: AUDIT_CATEGORY.PROFILE_STATUS,
        title: "Inactivacion y Reactivacion de Perfiles",
        tone: "red"
    },
    {
        key: AUDIT_CATEGORY.STAFFING,
        title: "Modificacion de Dotacion Requerida",
        tone: "muted"
    },
    {
        key: AUDIT_CATEGORY.SYSTEM_SETTINGS,
        title: "Ajustes del Sistema",
        tone: "blue"
    },
    {
        key: AUDIT_CATEGORY.WORKER_REQUESTS,
        title: "Solicitudes de Trabajadores",
        tone: "green"
    }
];

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function categoryDef(category) {
    return CATEGORY_DEFS.find(item => item.key === category) ||
        CATEGORY_DEFS[0];
}

function normalizeLogs(logs) {
    return Array.isArray(logs)
        ? logs.filter(log => log && log.createdAt)
        : [];
}

function formatTimestamp(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "Sin fecha";

    return [
        [
            String(date.getDate()).padStart(2, "0"),
            String(date.getMonth() + 1).padStart(2, "0"),
            date.getFullYear()
        ].join("-"),
        [
            String(date.getHours()).padStart(2, "0"),
            String(date.getMinutes()).padStart(2, "0"),
            String(date.getSeconds()).padStart(2, "0")
        ].join(":")
    ].join(" ");
}

function monthValue(date = new Date()) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0")
    ].join("-");
}

function logMonthValue(log) {
    const date = new Date(log.createdAt);

    if (Number.isNaN(date.getTime())) return "";

    return monthValue(date);
}

function isoToDateKey(value) {
    const match = String(value || "")
        .match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);

    if (!match) return "";

    return `${Number(match[1])}-${Number(match[2]) - 1}-${Number(match[3])}`;
}

function keyToDate(keyDay) {
    const [year, month, day] = String(keyDay || "")
        .split("-")
        .map(Number);

    if (
        !Number.isFinite(year) ||
        !Number.isFinite(month) ||
        !Number.isFinite(day)
    ) {
        return null;
    }

    return new Date(year, month, day);
}

function keyToISO(keyDay) {
    const date = keyToDate(keyDay);

    if (!date) return "";

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function formatISODate(value) {
    const match = String(value || "")
        .match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

    if (!match) return value || "";

    return [
        String(Number(match[3])).padStart(2, "0"),
        String(Number(match[2])).padStart(2, "0"),
        match[1]
    ].join("-");
}

function formatDatesInText(value) {
    return String(value || "").replace(
        /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g,
        (_match, year, month, day) =>
            `${String(Number(day)).padStart(2, "0")}-${String(Number(month)).padStart(2, "0")}-${year}`
    );
}

function keyFromDate(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function addDaysKey(keyDay, offset = 1) {
    const date = keyToDate(keyDay);

    if (!date) return "";

    date.setDate(date.getDate() + offset);
    return keyFromDate(date);
}

function profileMapKey(prefix, profile) {
    return `${prefix}_${profile}`;
}

function getProfileMap(prefix, profile) {
    return getJSON(profileMapKey(prefix, profile), {});
}

function saveProfileMap(prefix, profile, map) {
    setJSON(profileMapKey(prefix, profile), map);
}

function getCurrentActorLabel() {
    const user = getCurrentFirebaseUser();

    return user?.displayName ||
        user?.email ||
        document.getElementById("authUserName")?.textContent?.trim() ||
        getCurrentProfile() ||
        "Usuario";
}

function getCurrentActor() {
    const user = getCurrentFirebaseUser();
    const name = getCurrentActorLabel();

    return {
        name,
        email: user?.email || "",
        uid: user?.uid || ""
    };
}

function logActorName(log) {
    return String(
        log?.actor?.name ||
        log?.actorName ||
        log?.createdBy ||
        log?.meta?.actorName ||
        ""
    ).trim();
}

function getProfileByName(profileName) {
    return getProfiles().find(profile =>
        profile.name === profileName
    ) || null;
}

function hasWorkerApp(profile = {}) {
    return Boolean(
        profile.appUid ||
        profile.mobileAppUid ||
        profile.workerAppUid
    );
}

function queueWorkerNotification(profileName, message, meta = {}) {
    if (!profileName || !message) return;

    const profile = getProfileByName(profileName);
    const notifications = getJSON("workerNotifications", []);
    const channel = hasWorkerApp(profile)
        ? "app"
        : "whatsapp";

    notifications.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        profile: profileName,
        profileId: profile?.id || "",
        channel,
        phone: profile?.phone || "",
        message,
        status: channel === "app" ? "app_pending" : "whatsapp_pending",
        createdAt: new Date().toISOString(),
        meta: {
            ...meta
        }
    });

    setJSON(
        "workerNotifications",
        notifications.slice(-1000)
    );
}

function getLeaveUndoType(log) {
    const metaType = String(log?.meta?.type || "").trim();
    const action = String(log?.action || "").toLowerCase();

    if (metaType) return metaType;
    if (
        action.includes("1/2 adm") &&
        (action.includes("manana") || action.includes("mañana"))
    ) {
        return "half_admin_morning";
    }
    if (action.includes("1/2 adm") && action.includes("tarde")) {
        return "half_admin_afternoon";
    }
    if (action.includes("p. administrativo")) return "admin";
    if (action.includes("f. legal")) return "legal";
    if (action.includes("f. compensatorio")) return "comp";
    if (action.includes("lm profesional")) return "professional_license";
    if (action.includes("permiso gremial")) return "union_leave";
    if (action.includes("permiso sin goce")) return "unpaid_leave";
    if (action.includes("ausencia injustificada")) {
        return "unjustified_absence";
    }
    if (action.includes("licencia")) return "license";

    return "";
}

function canUndoAuditLog(log) {
    if (log?.canceledAt) return false;

    if (log?.category === AUDIT_CATEGORY.LEAVE_ABSENCE) {
        return Boolean(
            log?.profile &&
            log?.meta?.date &&
            getLeaveUndoType(log)
        );
    }

    if (log?.category === AUDIT_CATEGORY.OVERTIME) {
        return Boolean(log?.meta?.replacementId);
    }

    return false;
}

function updateLog(logId, updater) {
    const logs = getAuditLogs();
    const nextLogs = logs.map(log =>
        log.id === logId ? updater(log) : log
    );

    setJSON(KEY, nextLogs.slice(-MAX_LOGS));
}

function cleanBlockedDays(profile, keys) {
    const blocked = getProfileMap("blocked", profile);
    const admin = getProfileMap("admin", profile);
    const legal = getProfileMap("legal", profile);
    const comp = getProfileMap("comp", profile);
    const absences = getProfileMap("absences", profile);

    keys.forEach(keyDay => {
        if (
            !admin[keyDay] &&
            !legal[keyDay] &&
            !comp[keyDay] &&
            !absences[keyDay]
        ) {
            delete blocked[keyDay];
        }
    });

    saveProfileMap("blocked", profile, blocked);
}

function removeAdminLog(profile, startKey, type, amount) {
    const admin = getProfileMap("admin", profile);
    const removed = [];

    if (type === "half_admin_morning" || type === "half_admin_afternoon") {
        const expected =
            type === "half_admin_morning" ? "0.5M" : "0.5T";

        if (admin[startKey] === expected || admin[startKey] === 0.5) {
            delete admin[startKey];
            removed.push(startKey);
        }
    } else {
        const days = Math.max(1, Math.round(Number(amount) || 1));
        let keyDay = startKey;

        for (let i = 0; i < days; i++) {
            if (admin[keyDay] === 1) {
                delete admin[keyDay];
                removed.push(keyDay);
            }

            keyDay = addDaysKey(keyDay, 1);
        }
    }

    if (!removed.length) return [];

    saveProfileMap("admin", profile, admin);
    cleanBlockedDays(profile, removed);
    return removed;
}

async function removeBusinessBlock(profile, prefix, startKey, amount) {
    const map = getProfileMap(prefix, profile);
    const removed = [];
    const target = Math.max(1, Math.round(Number(amount) || 1));
    let counted = 0;
    let keyDay = startKey;
    let guard = 0;
    const holidayCache = new Map();

    while (counted < target && guard < 370) {
        const date = keyToDate(keyDay);

        if (!date || !map[keyDay]) break;

        if (!holidayCache.has(date.getFullYear())) {
            holidayCache.set(
                date.getFullYear(),
                await fetchHolidays(date.getFullYear())
            );
        }

        delete map[keyDay];
        removed.push(keyDay);

        if (
            isBusinessDay(
                date,
                holidayCache.get(date.getFullYear())
            )
        ) {
            counted++;
        }

        keyDay = addDaysKey(keyDay, 1);
        guard++;
    }

    if (!removed.length) return [];

    saveProfileMap(prefix, profile, map);
    cleanBlockedDays(profile, removed);
    return removed;
}

function absenceTypeOf(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    return String(value.type || value.previousType || "");
}

function removeAbsenceBlock(profile, startKey, amount, type) {
    const absences = getProfileMap("absences", profile);
    const removed = [];
    const days = Math.max(1, Math.round(Number(amount) || 1));
    let keyDay = startKey;

    for (let i = 0; i < days; i++) {
        if (absenceTypeOf(absences[keyDay]) === type) {
            delete absences[keyDay];
            removed.push(keyDay);
        }

        keyDay = addDaysKey(keyDay, 1);
    }

    if (!removed.length) return [];

    saveProfileMap("absences", profile, absences);
    cleanBlockedDays(profile, removed);
    return removed;
}

async function undoLeaveAbsenceLog(log) {
    const profile = String(log.profile || log.meta?.profile || "");
    const startKey = isoToDateKey(log.meta?.date);
    const type = getLeaveUndoType(log);
    const amount = Number(log.meta?.amount || 1);

    if (!profile || !startKey || !type) {
        return { ok: false, canceledReplacements: [] };
    }

    let removedKeys = [];

    if (
        type === "admin" ||
        type === "half_admin_morning" ||
        type === "half_admin_afternoon"
    ) {
        removedKeys = removeAdminLog(profile, startKey, type, amount);
    } else if (type === "legal") {
        removedKeys = await removeBusinessBlock(
            profile,
            "legal",
            startKey,
            amount
        );
    } else if (type === "comp") {
        removedKeys = await removeBusinessBlock(
            profile,
            "comp",
            startKey,
            amount
        );
    } else if (
        type === "license" ||
        type === "union_leave" ||
        type === "professional_license" ||
        type === "unpaid_leave" ||
        type === "unjustified_absence"
    ) {
        removedKeys = removeAbsenceBlock(
            profile,
            startKey,
            amount,
            type
        );
    }

    if (!removedKeys.length) {
        return { ok: false, canceledReplacements: [] };
    }

    const canceledReplacements =
        cancelReplacementsForAbsence(profile, removedKeys, log);

    queueWorkerNotification(
        profile,
        `Se anulo ${log.action || "una ausencia/permiso"} desde el sistema. Revisa tu calendario actualizado.`,
        {
            source: "audit_undo",
            logId: log.id,
            type: "leave_absence_canceled"
        }
    );

    return {
        ok: true,
        canceledReplacements
    };
}

function cancelReplacementsForAbsence(profile, removedKeys, sourceLog) {
    const isoDates = new Set(
        removedKeys.map(keyToISO).filter(Boolean)
    );
    const now = new Date().toISOString();
    const actor = getCurrentActorLabel();
    const canceled = [];
    const nextReplacements = getReplacements().map(replacement => {
        if (
            !replacement ||
            replacement.canceled ||
            replacement.replaced !== profile ||
            !isoDates.has(replacement.date)
        ) {
            return replacement;
        }

        const nextReplacement = {
            ...replacement,
            canceled: true,
            canceledAt: now,
            canceledBy: actor,
            cancelReason: "leave_absence_canceled",
            cancellationDetails:
                `Asociado a anulacion desde LOG: ${sourceLog.action || "permiso/ausencia"}.`
        };

        canceled.push(nextReplacement);
        return nextReplacement;
    });

    if (!canceled.length) return [];

    saveReplacements(nextReplacements);
    cancelLinkedReplacementRequests(canceled, sourceLog);

    canceled.forEach(replacement => {
        const date = replacement.date || "fecha sin detalle";
        const turn = replacement.turno || "turno";

        queueWorkerNotification(
            replacement.worker,
            `Se anularon las horas extras del ${formatISODate(date)} (${turn}) porque se anulo el permiso/ausencia de ${profile}.`,
            {
                source: "audit_undo",
                logId: sourceLog.id,
                replacementId: replacement.id,
                type: "overtime_canceled"
            }
        );
    });

    return canceled;
}

function cancelReplacementFromLog(log) {
    const replacementId = String(log?.meta?.replacementId || "");

    if (!replacementId) {
        return { ok: false, canceledReplacements: [] };
    }

    const now = new Date().toISOString();
    const actor = getCurrentActorLabel();
    const canceled = [];
    const nextReplacements = getReplacements().map(replacement => {
        if (
            !replacement ||
            replacement.canceled ||
            String(replacement.id) !== replacementId
        ) {
            return replacement;
        }

        const nextReplacement = {
            ...replacement,
            canceled: true,
            canceledAt: now,
            canceledBy: actor,
            cancelReason: "overtime_canceled_from_log",
            cancellationDetails:
                `Horas extras anuladas desde LOG: ${log.action || ""}.`
        };

        canceled.push(nextReplacement);
        return nextReplacement;
    });

    if (!canceled.length) {
        return { ok: false, canceledReplacements: [] };
    }

    saveReplacements(nextReplacements);
    cancelLinkedReplacementRequests(canceled, log);

    canceled.forEach(replacement => {
        const date = replacement.date || "fecha sin detalle";
        const turn = replacement.turno || "turno";

        queueWorkerNotification(
            replacement.worker,
            `Se anularon tus horas extras del ${formatISODate(date)} (${turn}). Revisa tu calendario actualizado.`,
            {
                source: "audit_undo",
                logId: log.id,
                replacementId: replacement.id,
                type: "overtime_canceled"
            }
        );

        if (replacement.replaced) {
            queueWorkerNotification(
                replacement.replaced,
                `Se anulo la cobertura de ${replacement.worker} para el ${formatISODate(date)} (${turn}).`,
                {
                    source: "audit_undo",
                    logId: log.id,
                    replacementId: replacement.id,
                    type: "replacement_canceled"
                }
            );
        }
    });

    return {
        ok: true,
        canceledReplacements: canceled
    };
}

function cancelLinkedReplacementRequests(replacements, sourceLog) {
    const requestIds = new Set();
    const groupIds = new Set();

    replacements.forEach(replacement => {
        if (replacement.requestId) {
            requestIds.add(String(replacement.requestId));
        }

        if (replacement.requestGroupId) {
            groupIds.add(String(replacement.requestGroupId));
        }
    });

    if (!requestIds.size && !groupIds.size) return;

    const now = new Date().toISOString();
    let changed = false;
    const requests = getReplacementRequests().map(request => {
        const belongsToCanceledReplacement =
            requestIds.has(String(request.id)) ||
            groupIds.has(String(request.groupId || request.id));

        if (!belongsToCanceledReplacement) return request;

        changed = true;
        return {
            ...request,
            status: "canceled",
            canceledAt: now,
            cancellationReason:
                `Asociada a anulacion desde LOG: ${sourceLog.action || "registro"}.`
        };
    });

    if (changed) {
        saveReplacementRequests(requests);
    }
}

function sortedLogs() {
    return getAuditLogs()
        .slice()
        .sort((a, b) =>
            String(b.createdAt).localeCompare(String(a.createdAt))
        );
}

function latestForCategory(logs, category) {
    return logs.find(log => log.category === category) || null;
}

function summaryCardHTML(logs, def) {
    const count =
        logs.filter(log => log.category === def.key).length;
    const latest = latestForCategory(logs, def.key);
    const isActive = selectedCategories.has(def.key);

    return `
        <button class="audit-summary-card audit-summary-card--${def.tone} ${isActive ? "is-active" : ""}" type="button" data-audit-category="${escapeHTML(def.key)}" aria-pressed="${isActive ? "true" : "false"}">
            <span>${escapeHTML(def.title)}</span>
            <strong>${count}</strong>
            <small>
                ${latest
                    ? `Ultimo: ${escapeHTML(formatTimestamp(latest.createdAt))}`
                    : "Sin registros"}
            </small>
        </button>
    `;
}

function canceledInfoHTML(log) {
    if (!log.canceledAt) return "";

    return `
        <div class="audit-entry__canceled">
            Anulado por ${escapeHTML(log.canceledBy || "Usuario")}
            el ${escapeHTML(formatTimestamp(log.canceledAt))}.
            ${log.cancellationDetails
                ? `<span>${escapeHTML(log.cancellationDetails)}</span>`
                : ""}
        </div>
    `;
}

function undoPanelHTML(log) {
    if (log.canceledAt) return "";
    if (expandedLogId !== log.id) return "";

    if (!canUndoAuditLog(log)) {
        return `
            <div class="audit-entry__actions">
                <small>
                    Este registro no tiene una anulacion automatica disponible.
                </small>
            </div>
        `;
    }

    const buttonText =
        log.category === AUDIT_CATEGORY.OVERTIME
            ? "Anular horas extras"
            : "Deshacer accion";

    return `
        <div class="audit-entry__actions">
            <button class="secondary-button secondary-button--small" type="button" data-audit-undo="${escapeHTML(log.id)}">
                ${buttonText}
            </button>
            <small>
                La accion se marcara como anulada y no desaparecera del log.
            </small>
        </div>
    `;
}

function entryHTML(log) {
    const def = categoryDef(log.category);
    const isExpanded = expandedLogId === log.id;
    const actorName = logActorName(log);

    return `
        <article class="audit-entry ${log.canceledAt ? "is-canceled" : ""} ${isExpanded ? "is-expanded" : ""}" data-audit-entry-id="${escapeHTML(log.id)}">
            <div class="audit-entry__head">
                <span class="audit-chip audit-chip--${def.tone}">
                    ${escapeHTML(def.title)}
                </span>
                <time>${escapeHTML(formatTimestamp(log.createdAt))}</time>
            </div>
            <strong>${escapeHTML(log.action)}</strong>
            ${log.details ? `<p>${escapeHTML(formatDatesInText(log.details))}</p>` : ""}
            <small>Usuario: ${escapeHTML(actorName || "No registrado")}</small>
            ${canceledInfoHTML(log)}
            ${undoPanelHTML(log)}
        </article>
    `;
}

function filterLogsBySelectedMonth(logs) {
    if (!selectedMonth) {
        selectedMonth = monthValue();
    }

    return logs.filter(log =>
        logMonthValue(log) === selectedMonth
    );
}

export function getAuditCategories() {
    return CATEGORY_DEFS.map(item => ({ ...item }));
}

export function getAuditLogs() {
    return normalizeLogs(getJSON(KEY, []));
}

export function addAuditLog(category, action, details = "", meta = {}) {
    const def = categoryDef(category);
    const logs = getAuditLogs();
    const actor = getCurrentActor();
    const entry = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        category: def.key,
        action: String(action || def.title),
        details: String(details || ""),
        profile:
            meta.profile !== undefined
                ? String(meta.profile || "")
                : (getCurrentProfile() || ""),
        createdAt: new Date().toISOString(),
        actor,
        actorName: actor.name,
        meta: {
            ...meta,
            actorName: meta.actorName || actor.name,
            actorEmail: meta.actorEmail || actor.email,
            actorUid: meta.actorUid || actor.uid
        }
    };

    logs.push(entry);
    setJSON(KEY, logs.slice(-MAX_LOGS));

    if (document.body.dataset.activeView === "log") {
        renderAuditLogPanel();
    }
}

async function undoAuditLogEntry(logId) {
    const log = getAuditLogs().find(item => item.id === logId);

    if (!log || !canUndoAuditLog(log)) return false;

    const result = log.category === AUDIT_CATEGORY.OVERTIME
        ? cancelReplacementFromLog(log)
        : await undoLeaveAbsenceLog(log);

    if (!result?.ok) return false;

    updateLog(logId, entry => ({
        ...entry,
        canceledAt: new Date().toISOString(),
        canceledBy: getCurrentActorLabel(),
        cancellationDetails: result.canceledReplacements?.length
            ? `Accion anulada desde el menu LOG. Se anularon ${result.canceledReplacements.length} reemplazo(s)/HHEE asociado(s).`
            : "Accion anulada desde el menu LOG."
    }));

    window.dispatchEvent(
        new CustomEvent("proturnos:auditUndoApplied", {
            detail: { logId }
        })
    );

    return true;
}

export function renderAuditLogPanel() {
    const box = document.getElementById("auditLogPanel");
    if (!box) return;

    if (!selectedMonth) {
        selectedMonth = monthValue();
    }

    const allLogs = sortedLogs();
    const logs = filterLogsBySelectedMonth(allLogs);
    const activeCategories = Array.from(selectedCategories);
    const visibleLogs = activeCategories.length
        ? logs.filter(log => selectedCategories.has(log.category))
        : logs;

    box.innerHTML = `
        <div class="section-head section-head--with-action">
            <span class="section-head__title">
                <h3>LOG / Bitacora de Modificaciones</h3>
            </span>

            <label class="audit-month-filter">
                <span>Mes</span>
                <input id="auditMonthFilter" type="month" value="${escapeHTML(selectedMonth)}">
            </label>
        </div>

        <div class="audit-summary-grid">
            ${CATEGORY_DEFS.map(def =>
                summaryCardHTML(logs, def)
            ).join("")}
        </div>

        <div class="audit-feed">
            <div class="audit-feed__head">
                <h4>Detalle de registros</h4>
                <span>${visibleLogs.length} de ${logs.length} registros del mes</span>
            </div>
            ${visibleLogs.length
                ? visibleLogs.map(entryHTML).join("")
                : `
                    <div class="empty-state empty-state--compact">
                        ${activeCategories.length
                            ? "No hay registros para las tarjetas seleccionadas en este mes."
                            : "Aun no hay modificaciones registradas."}
                    </div>
                `}
        </div>
    `;

    const filter = document.getElementById("auditMonthFilter");

    if (filter) {
        filter.onchange = () => {
            selectedMonth = filter.value || monthValue();
            renderAuditLogPanel();
        };
    }

    box.querySelectorAll("[data-audit-category]").forEach(card => {
        card.onclick = () => {
            const category = card.dataset.auditCategory;

            if (!category) return;

            if (selectedCategories.has(category)) {
                selectedCategories.delete(category);
            } else {
                selectedCategories.add(category);
            }

            renderAuditLogPanel();
        };
    });

    box.querySelectorAll("[data-audit-entry-id]").forEach(entry => {
        entry.onclick = event => {
            if (event.target.closest("button")) return;

            const logId = entry.dataset.auditEntryId;
            expandedLogId = expandedLogId === logId ? "" : logId;
            renderAuditLogPanel();
        };
    });

    box.querySelectorAll("[data-audit-undo]").forEach(button => {
        button.onclick = async event => {
            event.stopPropagation();

            const confirmed = window.confirm(
                "Deseas deshacer esta accion? El registro quedara marcado como anulado."
            );

            if (!confirmed) return;

            const ok = await undoAuditLogEntry(button.dataset.auditUndo);

            if (!ok) {
                window.alert(
                    "No se pudo anular automaticamente. Es posible que la accion ya no exista en el calendario o haya sido modificada despues."
                );
            }

            renderAuditLogPanel();
        };
    });
}

window.renderAuditLogPanel = renderAuditLogPanel;
