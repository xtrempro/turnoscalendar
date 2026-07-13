import {
    getCurrentFirebaseUser,
    getFirebaseServices
} from "./firebaseClient.js";
import { recordPerformanceEvent } from "./performanceMonitor.js";

const FLUSH_DELAY_MS = 2500;
const MAX_BATCH_SIZE = 25;
const MAX_AFFECTED_DATES = 120;
const EVENT_VERSION = 1;

let flushTimer = 0;
let retryTimer = 0;
let retryCount = 0;
const pendingEvents = new Map();

function randomId(prefix = "calendar_event") {
    if (globalThis.crypto?.randomUUID) {
        return `${prefix}_${globalThis.crypto.randomUUID()}`;
    }

    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function parseRawJSON(raw, fallback = {}) {
    if (raw === null || raw === undefined) return fallback;

    try {
        const parsed = JSON.parse(raw);

        return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function stableString(value) {
    if (value === undefined) return "";

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function localKeyToISO(value) {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

    if (!match) return "";

    const year = Number(match[1]);
    const rawMonth = match[2];
    const rawDay = match[3];
    const monthNumber = Number(rawMonth);
    const day = Number(rawDay);

    if (!year || !monthNumber && rawMonth !== "0" || !day) return "";

    // Las claves internas de calendario usan mes base 0 (`2026-6-18` =
    // 18/julio). Si viene con dos digitos, se asume ISO (`2026-07-18`).
    const isoMonth =
        rawMonth.length === 2 && monthNumber >= 1
            ? monthNumber
            : monthNumber + 1;

    if (isoMonth < 1 || isoMonth > 12) return "";

    return [
        String(year).padStart(4, "0"),
        String(isoMonth).padStart(2, "0"),
        String(day).padStart(2, "0")
    ].join("-");
}

export function normalizeAffectedDates(values = []) {
    return [...new Set(
        (Array.isArray(values) ? values : [values])
            .map(localKeyToISO)
            .filter(Boolean)
            .sort()
    )].slice(0, MAX_AFFECTED_DATES);
}

export function changedCalendarKeysFromRawMutation(change = {}) {
    const previous = parseRawJSON(change.previous, {});
    const next = parseRawJSON(change.next, {});
    const keys = new Set([
        ...Object.keys(previous),
        ...Object.keys(next)
    ]);

    return [...keys]
        .filter(key =>
            stableString(previous[key]) !== stableString(next[key])
        )
        .sort();
}

function mutationKind(change = {}) {
    const previous = parseRawJSON(change.previous, {});
    const next = parseRawJSON(change.next, {});
    const keys = changedCalendarKeysFromRawMutation(change);
    let added = 0;
    let removed = 0;
    let updated = 0;

    keys.forEach(key => {
        const before = previous[key];
        const after = next[key];
        const hadBefore =
            before !== undefined &&
            before !== null &&
            stableString(before) !== "0";
        const hasAfter =
            after !== undefined &&
            after !== null &&
            stableString(after) !== "0";

        if (!hadBefore && hasAfter) added++;
        else if (hadBefore && !hasAfter) removed++;
        else updated++;
    });

    if (keys.length > 1) return "bulk";
    if (added) return "added";
    if (removed) return "removed";
    if (updated) return "updated";
    return "updated";
}

function formatNotificationDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) return String(value || "");

    return `${match[3]}-${match[2]}-${match[1]}`;
}

function calendarMutationMessage(label, affectedDates = []) {
    if (!affectedDates.length) return `${label}. Revisa tu calendario actualizado.`;

    if (affectedDates.length === 1) {
        return `${label} para el ${formatNotificationDate(affectedDates[0])}.`;
    }

    return `${label} en ${affectedDates.length} dias de tu calendario.`;
}

function metadataForProfileStorageKey(storageKey, change = {}) {
    const key = String(storageKey || "");
    const affectedDates = normalizeAffectedDates(
        changedCalendarKeysFromRawMutation(change)
    );
    const kind = mutationKind(change);
    const bulk = kind === "bulk" || affectedDates.length > 1;

    if (key.startsWith("rotativa_")) {
        return {
            changeType: "rotation_changed",
            source: "rotation_generator",
            title: "Tu rotativa fue actualizada",
            message: "Se actualizo tu rotativa. Revisa tu calendario actualizado.",
            affectedDates: []
        };
    }

    if (key.startsWith("baseData_")) {
        return {
            changeType: bulk ? "calendar_bulk_updated" : "shift_updated",
            source: "rotation_generator",
            title: bulk
                ? "Tu calendario fue actualizado"
                : "Tu turno fue modificado",
            message: calendarMutationMessage(
                bulk
                    ? "Se actualizaron turnos base"
                    : "Se modifico un turno base",
                affectedDates
            ),
            affectedDates
        };
    }

    if (key.startsWith("data_")) {
        const changeType = bulk
            ? "calendar_bulk_updated"
            : kind === "removed"
                ? "shift_deleted"
                : kind === "added"
                    ? "shift_added"
                    : "shift_updated";

        return {
            changeType,
            source: "main_calendar_manual_edit",
            title:
                changeType === "shift_added"
                    ? "Nuevo turno en tu calendario"
                    : changeType === "shift_deleted"
                        ? "Se elimino un turno"
                        : "Tu calendario fue modificado",
            message: calendarMutationMessage(
                changeType === "shift_added"
                    ? "Se agrego un turno"
                    : changeType === "shift_deleted"
                        ? "Se elimino un turno"
                        : "Se modifico tu calendario",
                affectedDates
            ),
            affectedDates
        };
    }

    if (key.startsWith("admin_")) {
        return {
            changeType: "administrative_leave_accepted",
            source: "administrative_leave",
            title: "Permiso administrativo actualizado",
            message: calendarMutationMessage(
                "Tu permiso administrativo fue incorporado o modificado",
                affectedDates
            ),
            affectedDates
        };
    }

    if (key.startsWith("legal_")) {
        return {
            changeType: "legal_leave_added",
            source: "legal_leave",
            title: "Feriado legal actualizado",
            message: calendarMutationMessage(
                "Tu feriado legal fue incorporado o modificado",
                affectedDates
            ),
            affectedDates
        };
    }

    if (key.startsWith("comp_")) {
        return {
            changeType: "compensatory_leave_added",
            source: "compensatory_leave",
            title: "Compensatorio actualizado",
            message: calendarMutationMessage(
                "Tu feriado compensatorio fue incorporado o modificado",
                affectedDates
            ),
            affectedDates
        };
    }

    if (key.startsWith("absences_")) {
        return {
            changeType: "medical_leave_added",
            source: "medical_leave",
            title: "Ausencia o licencia actualizada",
            message: calendarMutationMessage(
                "Se actualizo una ausencia o licencia en tu calendario",
                affectedDates
            ),
            affectedDates
        };
    }

    if (
        key.startsWith("shift_") ||
        key.startsWith("shiftAssignmentHistory_")
    ) {
        return {
            changeType: "shift_assignment_changed",
            source: "supervisor_action",
            title: "Tu jornada fue actualizada",
            message: "Se actualizo informacion de tu jornada. Revisa tu calendario.",
            affectedDates
        };
    }

    if (
        key.startsWith("contractHistory_") ||
        key.startsWith("gradeHistory_")
    ) {
        return {
            changeType: "calendar_bulk_updated",
            source: "supervisor_action",
            title: "Tu calendario fue actualizado",
            message: "Se actualizo informacion contractual que puede afectar tu calendario.",
            affectedDates
        };
    }

    return null;
}

export function buildCalendarChangeEventFromStorageMutation({
    storageKey,
    change
} = {}) {
    return metadataForProfileStorageKey(storageKey, change);
}

function normalizeEvent(input = {}) {
    const workspaceId = String(input.workspaceId || "").trim();
    const affectedUserId = String(
        input.affectedUserId ||
        input.userId ||
        input.uid ||
        ""
    ).trim();
    const profileName = String(input.profileName || "").trim();

    if (!workspaceId || !affectedUserId) return null;

    const user = getCurrentFirebaseUser();
    const affectedDates = normalizeAffectedDates(input.affectedDates || []);
    const changeType = String(
        input.changeType || "calendar_bulk_updated"
    ).trim();
    const source = String(input.source || "supervisor_action").trim();
    const title = String(
        input.title || "Tu calendario fue modificado"
    ).trim().slice(0, 120);
    const message = String(
        input.message || "Revisa tu calendario actualizado en TurnoPlus."
    ).trim().slice(0, 300);

    return {
        eventId: String(input.eventId || randomId()).trim(),
        operationId: String(input.operationId || "").trim(),
        batchId: String(input.batchId || "").trim(),
        workspaceId,
        workerId: String(input.workerId || profileName || "").trim(),
        profileName,
        affectedUserId,
        changeType,
        affectedDates,
        createdBy: {
            uid: user?.uid || "",
            email: user?.email || "",
            name: user?.displayName || user?.email || ""
        },
        createdByUid: user?.uid || "",
        source,
        title,
        message,
        entityId: String(input.entityId || "").trim().slice(0, 180),
        version: EVENT_VERSION,
        status: "pending",
        clientCreatedAtISO: new Date().toISOString()
    };
}

function pendingKey(event) {
    return [
        event.workspaceId,
        event.affectedUserId,
        event.profileName,
        event.changeType,
        event.source,
        event.batchId,
        event.entityId,
        event.affectedDates.join(",")
    ].join("|");
}

function mergePendingEvent(previous, next) {
    const affectedDates = normalizeAffectedDates([
        ...previous.affectedDates,
        ...next.affectedDates
    ]);
    const merged = {
        ...previous,
        affectedDates,
        message:
            affectedDates.length > previous.affectedDates.length
                ? next.message
                : previous.message,
        clientCreatedAtISO: next.clientCreatedAtISO
    };

    if (affectedDates.length > 1) {
        merged.changeType = "calendar_bulk_updated";
        merged.title = "Tu calendario fue actualizado";
        merged.message =
            `Se actualizaron ${affectedDates.length} dias de tu calendario.`;
    }

    return merged;
}

function scheduleFlush() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
        void flushCalendarChangeEvents();
    }, FLUSH_DELAY_MS);
}

export function registerWorkerCalendarChange(input = {}) {
    const event = normalizeEvent(input);

    if (!event) return false;

    const key = pendingKey(event);
    const previous = pendingEvents.get(key);

    pendingEvents.set(
        key,
        previous ? mergePendingEvent(previous, event) : event
    );
    scheduleFlush();
    return true;
}

async function writeEventBatch(events) {
    const { db, firestoreModule } = await getFirebaseServices();
    const batch = firestoreModule.writeBatch(db);
    const now = firestoreModule.serverTimestamp();

    events.forEach(event => {
        const ref = firestoreModule.doc(
            db,
            "workspaces",
            event.workspaceId,
            "calendarEvents",
            event.eventId
        );

        batch.set(ref, {
            ...event,
            createdAt: now
        });
    });

    await batch.commit();
}

export async function flushCalendarChangeEvents() {
    clearTimeout(flushTimer);
    flushTimer = 0;

    const events = [...pendingEvents.values()];

    if (!events.length) return { written: 0 };

    pendingEvents.clear();

    try {
        for (
            let offset = 0;
            offset < events.length;
            offset += MAX_BATCH_SIZE
        ) {
            await writeEventBatch(
                events.slice(offset, offset + MAX_BATCH_SIZE)
            );
        }

        retryCount = 0;
        recordPerformanceEvent("calendar-events:registered", {
            type: "calendar-events",
            count: events.length
        });

        return { written: events.length };
    } catch (error) {
        events.forEach(event => {
            pendingEvents.set(pendingKey(event), event);
        });

        retryCount += 1;
        clearTimeout(retryTimer);

        if (retryCount <= 3) {
            retryTimer = setTimeout(() => {
                void flushCalendarChangeEvents();
            }, Math.min(30000, 2000 * retryCount));
        }

        console.warn(
            "No se pudieron registrar eventos de calendario.",
            error
        );
        recordPerformanceEvent("calendar-events:register-failed", {
            type: "calendar-events",
            count: events.length,
            retryCount,
            error: error?.message || String(error)
        });

        return {
            written: 0,
            error: error?.message || String(error)
        };
    }
}
