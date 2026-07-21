import { keyFromDate, keyToDate as parseKey } from "./dateUtils.js";
import { getJSON } from "./persistence.js";
import { getTurnoReal } from "./turnEngine.js";
import { getCachedHolidays } from "./holidays.js";
import { isBusinessDay } from "./calculations.js";
import { TURNO } from "./constants.js";

export const TASK_ASSIGNMENT_TASKS_KEY = "weekly_task_assignment_tasks";
export const TASK_ASSIGNMENT_ENTRIES_KEY = "weekly_task_assignment_entries";

const GENERIC_TASK_SHIFT = "both";
const SHIFT_TYPES = ["day", "night"];
const SHIFT_LABELS = {
    day: "Diurno",
    night: "Noche"
};
const MAX_HABIL_INTERVAL = 5;

function normalizeDefaultInterval(value) {
    const numberValue = Math.floor(Number(value));

    return Number.isFinite(numberValue) &&
        numberValue >= 1 &&
        numberValue <= 10
        ? numberValue
        : 1;
}

function normalizeHabilInterval(value) {
    const numberValue = Math.floor(Number(value));

    return Number.isFinite(numberValue) &&
        numberValue >= 1 &&
        numberValue <= MAX_HABIL_INTERVAL
        ? numberValue
        : 1;
}

function normalizeTaskShift(value) {
    if (value === "night") return "night";
    if (value === GENERIC_TASK_SHIFT) return GENERIC_TASK_SHIFT;
    return "day";
}

function uniqueValues(values) {
    return [...new Set(values.filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "es"));
}

function normalizeTaskDefaultRules(task) {
    const rules = new Map();
    const defaultWorkers = Array.isArray(task?.defaultWorkers)
        ? task.defaultWorkers
        : [task?.defaultWorker];
    const addRule = (
        workerName,
        interval = 1,
        anchorKeyDay = "",
        habilOnly = false
    ) => {
        const cleanWorker = String(workerName || "").trim();

        if (!cleanWorker) return;

        rules.set(cleanWorker, {
            workerName: cleanWorker,
            interval: habilOnly
                ? normalizeHabilInterval(interval)
                : normalizeDefaultInterval(interval),
            anchorKeyDay: String(anchorKeyDay || ""),
            habilOnly: Boolean(habilOnly)
        });
    };

    defaultWorkers.forEach(worker => addRule(worker));

    if (Array.isArray(task?.defaultWorkerRules)) {
        task.defaultWorkerRules.forEach(rule => {
            addRule(
                rule?.workerName || rule?.worker || rule?.name,
                rule?.interval,
                rule?.anchorKeyDay || rule?.anchor || rule?.startKeyDay,
                rule?.habilOnly === true || rule?.habil === true
            );
        });
    }

    return [...rules.values()].sort((a, b) =>
        a.workerName.localeCompare(b.workerName, "es")
    );
}

function getTaskCatalog() {
    const raw = getJSON(TASK_ASSIGNMENT_TASKS_KEY, []);

    return (Array.isArray(raw) ? raw : [])
        .map((task, index) => {
            const defaultWorkerRules = normalizeTaskDefaultRules(task);

            return {
                id: String(task?.id || `task_${index}`),
                shift: normalizeTaskShift(task?.shift),
                title: String(task?.title || "").trim(),
                order: Number.isFinite(Number(task?.order))
                    ? Number(task.order)
                    : index,
                defaultWorkerRules
            };
        })
        .filter(task => task.id && task.title)
        .sort((a, b) =>
            a.order - b.order ||
            a.title.localeCompare(b.title, "es")
        );
}

function getAllTaskAssignmentEntries() {
    const raw = getJSON(TASK_ASSIGNMENT_ENTRIES_KEY, {});

    return raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw
        : {};
}

function assignmentKey(shift, taskId, keyDay) {
    return `${shift}|${taskId}|${keyDay}`;
}

function assignmentWorkers(entry) {
    return Array.isArray(entry?.workers)
        ? entry.workers.map(item => String(item || "").trim()).filter(Boolean)
        : [];
}

function assignmentRemovedDefaults(entry) {
    return uniqueValues(
        Array.isArray(entry?.removedDefaults)
            ? entry.removedDefaults.map(item => String(item || "").trim())
            : []
    );
}

function isoFromDate(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function dateFromISO(iso) {
    const [year, month, day] = String(iso || "").split("-").map(Number);

    if (!year || !month || !day) return null;

    return new Date(year, month - 1, day);
}

function weekStartMonday(date) {
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

function weekKeyForDate(date) {
    return isoFromDate(weekStartMonday(date));
}

function entryForCell(allEntries, shift, taskId, keyDay) {
    const date = parseKey(keyDay);
    const week = weekKeyForDate(date);

    return allEntries?.[week]?.[assignmentKey(shift, taskId, keyDay)] || null;
}

function isValidDate(date) {
    return date instanceof Date && !Number.isNaN(date.getTime());
}

function shiftOrderForRule(habilOnly) {
    return habilOnly ? ["day"] : SHIFT_TYPES;
}

function turnScheduledForShift(turn, shift) {
    const state = Number(turn) || TURNO.LIBRE;

    if (shift === "day") {
        return [
            TURNO.LARGA,
            TURNO.DIURNO,
            TURNO.TURNO24,
            TURNO.DIURNO_NOCHE
        ].includes(state);
    }

    return [
        TURNO.NOCHE,
        TURNO.TURNO24,
        TURNO.DIURNO_NOCHE,
        TURNO.TURNO18
    ].includes(state);
}

function isScheduledForShift(profileName, keyDay, shift) {
    return turnScheduledForShift(getTurnoReal(profileName, keyDay), shift);
}

function hasBlockingAbsence(profileName, keyDay) {
    const admin = getJSON(`admin_${profileName}`, {});
    const legal = getJSON(`legal_${profileName}`, {});
    const comp = getJSON(`comp_${profileName}`, {});
    const absences = getJSON(`absences_${profileName}`, {});
    const hourReturns = getJSON(`hourReturns_${profileName}`, {});

    return Boolean(
        admin[keyDay] ||
        legal[keyDay] ||
        comp[keyDay] ||
        absences[keyDay] ||
        hourReturns[keyDay]
    );
}

function isAvailableForShift(profileName, keyDay, shift) {
    return isScheduledForShift(profileName, keyDay, shift) &&
        !hasBlockingAbsence(profileName, keyDay);
}

function isBusinessKeyDay(keyDay) {
    const date = parseKey(keyDay);

    if (!isValidDate(date)) return false;

    return isBusinessDay(date, getCachedHolidays(date.getFullYear()));
}

function countScheduledTurns(
    profileName,
    targetShift,
    startDate,
    endDate,
    habilOnly = false
) {
    if (!isValidDate(startDate) || !isValidDate(endDate)) return 0;
    if (endDate < startDate) return 0;
    if (habilOnly && targetShift !== "day") return 0;

    const cursor = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        startDate.getDate()
    );
    const end = new Date(
        endDate.getFullYear(),
        endDate.getMonth(),
        endDate.getDate()
    );
    const targetKey = keyFromDate(end);
    const shifts = shiftOrderForRule(habilOnly);
    let count = 0;

    while (cursor <= end) {
        const keyDay = keyFromDate(cursor);
        const isTargetDay = keyDay === targetKey;

        for (const shift of shifts) {
            if (
                isScheduledForShift(profileName, keyDay, shift) &&
                (
                    !habilOnly ||
                    isBusinessDay(
                        cursor,
                        getCachedHolidays(cursor.getFullYear())
                    )
                )
            ) {
                count += 1;
            }

            if (isTargetDay && shift === targetShift) {
                return count;
            }
        }

        cursor.setDate(cursor.getDate() + 1);
    }

    return count;
}

function shouldApplyDefaultRule(rule, profileName, keyDay, shift) {
    if (!isAvailableForShift(profileName, keyDay, shift)) return false;

    const habilOnly = rule?.habilOnly === true;

    if (habilOnly && shift !== "day") return false;
    if (habilOnly && !isBusinessKeyDay(keyDay)) return false;

    const interval = habilOnly
        ? normalizeHabilInterval(rule?.interval)
        : normalizeDefaultInterval(rule?.interval);

    if (interval <= 1) return true;

    const anchor = parseKey(rule?.anchorKeyDay);
    const target = parseKey(keyDay);

    if (!isValidDate(anchor) || !isValidDate(target)) return false;

    const scheduledCount = countScheduledTurns(
        profileName,
        shift,
        anchor,
        target,
        habilOnly
    );

    return scheduledCount > 0 && (scheduledCount - 1) % interval === 0;
}

function taskAppliesToShift(task, shift) {
    return task.shift === GENERIC_TASK_SHIFT || task.shift === shift;
}

function defaultTaskTargetsWorker(task, profileName, keyDay, shift) {
    if (!taskAppliesToShift(task, shift)) return false;

    return task.defaultWorkerRules.some(rule =>
        rule.workerName === profileName &&
        shouldApplyDefaultRule(rule, profileName, keyDay, shift)
    );
}

function dayTaskAssignments(profileName, keyDay, tasks, allEntries) {
    const items = [];

    SHIFT_TYPES.forEach(shift => {
        if (!isAvailableForShift(profileName, keyDay, shift)) return;

        tasks.forEach(task => {
            if (!taskAppliesToShift(task, shift)) return;

            const entry = entryForCell(allEntries, shift, task.id, keyDay);
            const workers = assignmentWorkers(entry);
            const removedDefaults = assignmentRemovedDefaults(entry);
            const isManual = workers.includes(profileName);
            const isDefault = !removedDefaults.includes(profileName) &&
                defaultTaskTargetsWorker(task, profileName, keyDay, shift);

            if (!isManual && !isDefault) return;

            items.push({
                id: task.id,
                title: task.title,
                shift,
                shiftLabel: SHIFT_LABELS[shift],
                source: isManual ? "manual" : "default",
                order: task.order
            });
        });
    });

    const byTitle = new Map();

    items
        .sort((a, b) =>
            a.order - b.order ||
            SHIFT_TYPES.indexOf(a.shift) - SHIFT_TYPES.indexOf(b.shift) ||
            a.title.localeCompare(b.title, "es")
        )
        .forEach(item => {
            const key = item.title.toLocaleLowerCase("es").trim();
            const current = byTitle.get(key);

            if (!current) {
                byTitle.set(key, item);
                return;
            }

            if (current.shift !== item.shift) {
                byTitle.set(key, {
                    ...current,
                    shift: "both",
                    shiftLabel: "Diurno y noche"
                });
            }
        });

    return [...byTitle.values()].map(({ order: _order, ...item }) => item);
}

export function addTaskAssignmentsToSchedule(profile, schedule) {
    const profileName = String(profile?.name || "").trim();

    if (!profileName || !schedule?.days || typeof schedule.days !== "object") {
        return schedule;
    }

    const tasks = getTaskCatalog();

    if (!tasks.length) return schedule;

    const allEntries = getAllTaskAssignmentEntries();

    Object.values(schedule.days).forEach(day => {
        const isoDate = day?.iso ? dateFromISO(day.iso) : null;
        const keyDay = day?.keyDay || (
            isoDate ? keyFromDate(isoDate) : ""
        );

        if (!keyDay) return;

        const taskAssignments = dayTaskAssignments(
            profileName,
            keyDay,
            tasks,
            allEntries
        );

        if (taskAssignments.length) {
            day.taskAssignments = taskAssignments;
        } else if (day.taskAssignments) {
            delete day.taskAssignments;
        }
    });

    return schedule;
}
