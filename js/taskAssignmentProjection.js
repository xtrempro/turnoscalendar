import { keyFromDate, keyToDate as parseKey } from "./dateUtils.js";
import { getJSON } from "./persistence.js";
import { getTurnoBase, getTurnoReal } from "./turnEngine.js";
import { getCachedHolidays } from "./holidays.js";
import { isBusinessDay } from "./calculations.js";
import { TURNO } from "./constants.js";
import { getHalfAdminHalf } from "./partialShift.js";

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

// En que tableros va la tarea (js/taskAssignments.js): "both", "day" o
// "night". Un catalogo viejo no trae `shiftScope` y ahi manda el `shift` con
// el que se guardo, que significaba lo mismo.
function normalizeTaskShiftScope(scope, legacyShift) {
    const value = scope === undefined || scope === null || scope === ""
        ? legacyShift
        : scope;

    if (value === "day" || value === "night") return value;

    return GENERIC_TASK_SHIFT;
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
                shiftScope: normalizeTaskShiftScope(
                    task?.shiftScope,
                    task?.shift
                ),
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

// Casillas fusionadas: el enlace vive en la de arriba y apunta por id a la de
// abajo, que tiene que ser la siguiente del catalogo. Los trabajadores estan
// todos en la de arriba, asi que para cada tarea del grupo hay que ir a
// buscarlos ahi.
function mergedGroupFor(allEntries, shift, catalog, taskId, keyDay) {
    const tasks = tasksForShift(catalog, shift);
    const index = tasks.findIndex(task => task.id === taskId);

    if (index === -1) return { ownerId: taskId, size: 1 };

    let start = index;

    while (start > 0) {
        const previous = tasks[start - 1];
        const entry = entryForCell(allEntries, shift, previous.id, keyDay);

        if (entry?.mergedNextTaskId !== tasks[start].id) break;

        start -= 1;
    }

    let end = start;

    for (;;) {
        const entry = entryForCell(allEntries, shift, tasks[end].id, keyDay);
        const next = tasks[end + 1];

        if (!next || entry?.mergedNextTaskId !== next.id) break;

        end += 1;
    }

    return { ownerId: tasks[start].id, size: end - start + 1 };
}

function isValidDate(date) {
    return date instanceof Date && !Number.isNaN(date.getTime());
}

// Mismo criterio que el tablero del supervisor: con la tarea en un solo
// tablero, la secuencia de "cada N turnos" cuenta solo los turnos de ESE
// tablero.
function shiftOrderForRule(habilOnly, scope = GENERIC_TASK_SHIFT) {
    if (habilOnly) return ["day"];
    if (scope === "day" || scope === "night") return [scope];

    return SHIFT_TYPES;
}

function turnScheduledForShift(turn, shift) {
    const state = Number(turn) || TURNO.LIBRE;

    if (shift === "day") {
        return [
            TURNO.LARGA,
            TURNO.DIURNO,
            TURNO.TURNO24,
            TURNO.DIURNO_NOCHE,
            // Medias jornadas y extension horaria: son tramos DIURNOS. El de 18
            // horas es la extension pegada a la noche, asi que ese dia el
            // trabajador esta citado en los dos turnos.
            TURNO.MEDIA_MANANA,
            TURNO.MEDIA_TARDE,
            TURNO.TURNO18
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

function isBaseScheduledForShift(profileName, keyDay, shift) {
    return turnScheduledForShift(getTurnoBase(profileName, keyDay), shift);
}

// Mismo criterio que el tablero del supervisor (js/taskAssignments.js): un
// 1/2 ADM no borra las tareas del dia, porque el trabajador viene igual media
// jornada. La noche no se parte, asi que ahi sigue bloqueando.
function hasBlockingAbsence(profileName, keyDay, shift = "") {
    if (shift === "day" && getHalfAdminHalf(profileName, keyDay)) return false;

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
        !hasBlockingAbsence(profileName, keyDay, shift);
}

function isBusinessKeyDay(keyDay) {
    const date = parseKey(keyDay);

    if (!isValidDate(date)) return false;

    return isBusinessDay(date, getCachedHolidays(date.getFullYear()));
}

function countBaseScheduledTurns(
    profileName,
    targetShift,
    startDate,
    endDate,
    habilOnly = false,
    scope = GENERIC_TASK_SHIFT
) {
    if (!isValidDate(startDate) || !isValidDate(endDate)) return 0;
    if (endDate < startDate) return 0;
    if (!shiftOrderForRule(habilOnly, scope).includes(targetShift)) return 0;

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
    const shifts = shiftOrderForRule(habilOnly, scope);
    let count = 0;

    while (cursor <= end) {
        const keyDay = keyFromDate(cursor);
        const isTargetDay = keyDay === targetKey;

        for (const shift of shifts) {
            if (
                isBaseScheduledForShift(profileName, keyDay, shift) &&
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

function shouldApplyDefaultRule(
    rule,
    profileName,
    keyDay,
    shift,
    scope = GENERIC_TASK_SHIFT
) {
    if (!isBaseScheduledForShift(profileName, keyDay, shift)) return false;
    if (hasBlockingAbsence(profileName, keyDay, shift)) return false;

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

    const scheduledCount = countBaseScheduledTurns(
        profileName,
        shift,
        anchor,
        target,
        habilOnly,
        scope
    );

    return scheduledCount > 0 && (scheduledCount - 1) % interval === 0;
}

function taskAppliesToShift(task, shift) {
    const scope = normalizeTaskShiftScope(task?.shiftScope, task?.shift);

    return scope === GENERIC_TASK_SHIFT || scope === shift;
}

// La columna de un tablero: lo que va por indice -la fusion de casillas- mira
// esta lista y no el catalogo entero, igual que en el tablero del supervisor.
function tasksForShift(tasks, shift) {
    return tasks.filter(task => taskAppliesToShift(task, shift));
}

function defaultTaskTargetsWorker(task, profileName, keyDay, shift) {
    if (!taskAppliesToShift(task, shift)) return false;

    return task.defaultWorkerRules.some(rule =>
        rule.workerName === profileName &&
        shouldApplyDefaultRule(
            rule,
            profileName,
            keyDay,
            shift,
            normalizeTaskShiftScope(task?.shiftScope, task?.shift)
        )
    );
}

function dayTaskAssignments(profileName, keyDay, tasks, allEntries) {
    const items = [];

    SHIFT_TYPES.forEach(shift => {
        if (!isAvailableForShift(profileName, keyDay, shift)) return;

        tasks.forEach(task => {
            if (!taskAppliesToShift(task, shift)) return;

            const group = mergedGroupFor(
                allEntries,
                shift,
                tasks,
                task.id,
                keyDay
            );

            // Con tres o mas tareas fusionadas no se manda ninguna al
            // calendario del trabajador: no caben en la casilla del dia. Las ve
            // igual al abrir la programacion de la semana.
            if (group.size > 2) return;

            const entry = entryForCell(
                allEntries,
                shift,
                group.ownerId,
                keyDay
            );
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

// El catalogo de tareas y las asignaciones de todas las semanas, leidos UNA
// vez para reusarlos en varias consultas seguidas. El modal de dotacion
// pregunta por cada trabajador del dia; sin esto releeria y volveria a parsear
// los mismos dos blobs una vez por persona.
export function buildTaskAssignmentContext() {
    return {
        tasks: getTaskCatalog(),
        allEntries: getAllTaskAssignmentEntries()
    };
}

/**
 * Las tareas de un trabajador en un dia: las que el supervisor le puso a mano
 * en el tablero y las que le tocan por regla predefinida.
 *
 * Es la MISMA cuenta que se proyecta a la PWA del trabajador (misma funcion
 * interna), asi que lo que ve el supervisor en el inicio es exactamente lo que
 * ve el trabajador en su telefono.
 *
 * @param {string} profileName
 * @param {string} keyDay clave interna `YYYY-M-D` (mes 0-based)
 * @param {{tasks: Array, allEntries: Object}} [context]
 * @returns {Array<{id: string, title: string, shift: string, shiftLabel: string, source: string}>}
 */
export function getDayTaskAssignments(
    profileName,
    keyDay,
    context = buildTaskAssignmentContext()
) {
    const name = String(profileName || "").trim();
    const tasks = Array.isArray(context?.tasks) ? context.tasks : [];

    if (!name || !keyDay || !tasks.length) return [];

    return dayTaskAssignments(name, keyDay, tasks, context?.allEntries || {});
}

function clearTaskAssignmentsFromSchedule(schedule) {
    Object.values(schedule?.days || {}).forEach(day => {
        if (day && typeof day === "object" && day.taskAssignments) {
            delete day.taskAssignments;
        }
    });

    return schedule;
}

export function addTaskAssignmentsToSchedule(profile, schedule) {
    const profileName = String(profile?.name || "").trim();

    if (!schedule?.days || typeof schedule.days !== "object") {
        return schedule;
    }

    if (!profileName) return clearTaskAssignmentsFromSchedule(schedule);

    const tasks = getTaskCatalog();

    if (!tasks.length) return clearTaskAssignmentsFromSchedule(schedule);

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
