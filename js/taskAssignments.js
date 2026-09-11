import { keyFromDate, keyToDate as parseKey } from "./dateUtils.js";
import { stripAccents } from "./stringUtils.js";
import { escapeHTML } from "./htmlUtils.js";
import { getJSON, getRaw, setJSON } from "./persistence.js";
import {
    getProfiles,
    isProfileActive
} from "./storage.js";
import {
    getCalendarProfileSearchOptionValues,
    getCalendarProfileSearchValue,
    normalizeProfileSearch
} from "./profileSearchUtils.js";
import { getTurnoBase, getTurnoReal } from "./turnEngine.js";
import { getAbsenceType } from "./rulesEngine.js";
import { getHourReturn } from "./hourReturns.js";
import { TURNO, TURNO_LABEL } from "./constants.js";
import { fetchHolidays, getCachedHolidays } from "./holidays.js";
import { isBusinessDay } from "./calculations.js";
import { showAlert, showConfirm, showPrompt } from "./dialogs.js";
import {
    buildTaskAutoScheduleHistory,
    planTaskAutoSchedule
} from "./taskAutoSchedule.js";
import {
    registerTaskScheduleGridProvider,
    scheduleWorkerAppDataPublish
} from "./workerAppDataSync.js";
import {
    getHalfAdminHalf,
    getPartialShiftWindow,
    partialShiftLabel
} from "./partialShift.js";
import { commemorativeDaysForDate } from "./commemorativeDays.js";
import { medicalEquipmentOutagesForRange } from "./medicalEquipment.js";
import { addAuditLog, AUDIT_CATEGORY } from "./auditLog.js";
import {
    accumulateWeekChanges,
    createWeekChangeAccumulator,
    describeWeekChanges,
    diffWeekAssignments
} from "./taskAssignmentAudit.js";
import { getActiveWorkspace } from "./workspaces.js";

const TASKS_KEY = "weekly_task_assignment_tasks";
const ASSIGNMENTS_KEY = "weekly_task_assignment_entries";
const TASK_SCHEDULE_UPDATED_KEY = "weekly_task_assignment_updated";
const TASK_ASSIGNMENT_PUBLISH_DELAY_MS = 3000;
const TASK_DETAIL_MAX_LENGTH = 240;
// Tras la ultima edicion deliberada de una semana, cuanto se espera para dejar UN
// resumen en la bitacora. Una sesion de edicion son decenas de clics, y cada
// entrada de bitacora es una escritura a la nube.
const TASK_AUDIT_QUIET_MS = 60000;

const SHIFT_CONFIG = {
    day: {
        label: "Tareas diurnas",
        shortLabel: "Diurno",
        className: "day"
    },
    night: {
        label: "Tareas de noche",
        shortLabel: "Noche",
        // Rotulo de la fila que junta a los que estan de turno sin tarea. Solo
        // la noche la tiene: de dia casi todos quedan en alguna tarea y la fila
        // seria una hilera de celdas vacias.
        dutyLabel: "TURNO DE NOCHE",
        className: "night"
    }
};
const SHIFT_TYPES = Object.keys(SHIFT_CONFIG);
const GENERIC_TASK_SHIFT = "both";
// En que tablero va la tarea: en los dos, solo en el diurno o solo en el de
// noche. Vive en `shiftScope` y NO en `shift`, que se sigue guardando como
// "both": para un cliente sin actualizar un `shift` distinto significa
// "catalogo viejo, uno por turno" y lo reescribe entero (migrateTaskCatalog).
const TASK_SHIFT_SCOPE_LABEL = {
    both: "Diurno y noche",
    day: "Solo diurno",
    night: "Solo noche"
};

let currentWeekStart = weekStartMonday(new Date());
let selectedRoles = null;
let selectedProfessions = null;
let openTaskFilterGroup = "";
let unbindTaskFilterOutside = null;
let draggedTask = null;
let draggedWorker = null;
let draggedMergePort = null;
let renderToken = 0;
// Cada tablero de turno se puede plegar para dejar el otro a pantalla completa.
let collapsedShifts = { day: false, night: false };
// Filtro de foco: deja visibles solo las casillas sin nadie asignado.
let onlyUncovered = false;
// Casilla con el selector rapido abierto: { shift, taskId, keyDay }. El nodo
// vive colgado del body -no de la casilla- porque el tablero recorta.
let openCellPicker = null;
let cellPickerNode = null;
let unbindCellPicker = null;
// Cambios deliberados de asignacion aun sin volcar a la bitacora, por semana, y
// la unidad donde se hicieron.
const pendingTaskAudits = new Map();
let taskAuditTimer = null;
let taskAuditWorkspaceId = "";




export function scheduleWeekStartISO(start = currentWeekStart) {
    return isoFromDate(weekStartMonday(start));
}


export function scheduleWeekLabel(start = currentWeekStart) {
    const weekStart = weekStartMonday(start);
    const weekEnd = addDays(weekStart, 6);

    return `Semana ${formatShortDate(weekStart)} al ${formatShortDate(weekEnd)}`;
}
























function normalizeText(value) {
    return stripAccents(String(value || "")).toLowerCase();
}

function isoFromDate(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function formatShortDate(date) {
    return date.toLocaleDateString("es-CL", {
        day: "2-digit",
        month: "2-digit"
    });
}

function formatWeekday(date) {
    return date.toLocaleDateString("es-CL", {
        weekday: "long"
    });
}

// En las grillas el dia va abreviado ("mie"): con el nombre completo la columna
// no baja de 155 px y el tablero de 8 columnas ya no cabe en pantalla. Los
// dialogos y el Excel siguen usando el nombre largo, donde sobra el ancho.
function formatWeekdayShort(date) {
    return date.toLocaleDateString("es-CL", {
        weekday: "short"
    }).replace(".", "");
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

function weekDays(start = currentWeekStart) {
    return Array.from({ length: 7 }, (_item, index) => {
        const day = new Date(start);

        day.setDate(start.getDate() + index);
        return day;
    });
}

function equipmentOutagesForDays(days) {
    if (!days.length) return [];

    return medicalEquipmentOutagesForRange(
        isoFromDate(days[0]),
        isoFromDate(days[days.length - 1])
    );
}

function outageMatchesDate(outage, iso) {
    const from = String(outage.startAt || outage.date || "").slice(0, 10);
    const to = String(outage.endAt || outage.date || from).slice(0, 10);

    return Boolean(from && to && from <= iso && to >= iso);
}

function outagesForTaskIdsDay(outages, taskIds, day) {
    const iso = isoFromDate(day);
    const ids = new Set((taskIds || []).map(String));
    const byId = new Map();

    (outages || []).forEach(outage => {
        const affected = Array.isArray(outage.taskIds)
            ? outage.taskIds.map(String)
            : [];

        if (!outageMatchesDate(outage, iso)) return;
        if (!affected.some(taskId => ids.has(taskId))) return;

        byId.set(outage.id, outage);
    });

    return [...byId.values()];
}

function outageTimeLabel(outage) {
    const start = String(outage.startAt || "").slice(11, 16);
    const end = String(outage.endAt || "").slice(11, 16);

    if (start && end) return `${start}-${end}`;
    if (start) return `desde ${start}`;
    if (end) return `hasta ${end}`;
    return "";
}

function outageScheduleNote(outages) {
    return (outages || []).map(outage => {
        // Un equipo marcado fuera de servicio bloquea sus tareas aunque nadie
        // haya registrado todavia la reparacion.
        if (outage.type === "outOfService") {
            return [
                "Tarea inactiva: equipo fuera de servicio",
                outage.equipmentName
            ].filter(Boolean).join(" - ");
        }

        const type = String(outage.type || "") === "corrective"
            ? "correctiva"
            : "preventiva";
        const time = outageTimeLabel(outage);

        return [
            `Tarea inactiva por mantencion ${type}`,
            outage.equipmentName,
            time
        ].filter(Boolean).join(" - ");
    }).join(" | ");
}

// El rotulo de la casilla cerrada. Dice lo que el hueco vacio no dice solo:
// que ahi no falta nadie, que es a proposito.
function renderClosedCellNote() {
    return `
        <div class="task-assignment-closed-note">
            <span>
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <rect x="5" y="11" width="14" height="9" rx="2"></rect>
                    <path d="M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11"></path>
                </svg>
                Cerrada
            </span>
            <small>Esta tarea no va este turno.</small>
        </div>
    `;
}

function renderTaskMaintenanceNote(outages) {
    if (!outages?.length) return "";

    return `
        <div class="task-assignment-maintenance-note">
            <span>${escapeHTML(outageScheduleNote(outages))}</span>
            <small>No se publica dotacion para esta celda.</small>
        </div>
    `;
}

function renderEquipmentOutageBanner(outages) {
    if (!outages.length) return "";

    const visible = outages.slice(0, 4);
    const rest = outages.length - visible.length;

    return `
        <section class="task-assignment-maintenance-banner">
            <strong>Mantenciones que bloquean tareas esta semana</strong>
            <div>
                ${visible.map(outage => `
                    <span>${escapeHTML(outage.equipmentName)}${outageTimeLabel(outage) ? ` &middot; ${escapeHTML(outageTimeLabel(outage))}` : ""}</span>
                `).join("")}
                ${rest > 0 ? `<span>+${rest} mas</span>` : ""}
            </div>
        </section>
    `;
}

function weekKey(start = currentWeekStart) {
    return isoFromDate(start);
}

async function holidayMapForDays(days) {
    const years = [...new Set(
        days.map(day => day.getFullYear())
    )];
    const maps = await Promise.all(
        years.map(year => fetchHolidays(year))
    );

    return Object.assign({}, ...maps);
}

function isInhabilDay(day, holidays = {}) {
    return !isBusinessDay(day, holidays);
}

function inhabilClass(day, holidays, className) {
    return isInhabilDay(day, holidays)
        ? ` ${className}`
        : "";
}

function addDays(date, amount) {
    const next = new Date(date);

    next.setDate(date.getDate() + amount);
    return next;
}

function normalizeTaskShift(value) {
    if (value === "night") return "night";
    if (value === GENERIC_TASK_SHIFT) return GENERIC_TASK_SHIFT;
    return "day";
}

// El turno propio de la tarea. Un catalogo viejo no trae `shiftScope`: ahi el
// alcance es el `shift` con el que se guardo, que es justo lo que significaba
// antes de que el catalogo pasara a ser uno solo para los dos tableros.
function normalizeTaskShiftScope(scope, legacyShift) {
    const value = scope === undefined || scope === null || scope === ""
        ? legacyShift
        : scope;

    if (value === "day" || value === "night") return value;

    return GENERIC_TASK_SHIFT;
}

function taskShiftScope(task) {
    return normalizeTaskShiftScope(task?.shiftScope, task?.shift);
}

function taskAppliesToShift(task, shift) {
    const scope = taskShiftScope(task);

    return scope === GENERIC_TASK_SHIFT || scope === shift;
}

// Las tareas que se dibujan en un tablero. Todo lo que va POR INDICE -fusionar
// casillas, arrastrar- tiene que mirar esta lista y no el catalogo entero: en
// el tablero diurno, la casilla de abajo de una es la de la siguiente tarea
// DIURNA, no la de la siguiente del catalogo.
function tasksForShift(tasks, shift) {
    return tasks.filter(task => taskAppliesToShift(task, shift));
}

// El otro turno, para cuando se quita la tarea de uno de los dos tableros.
function oppositeShift(shift) {
    return shift === "night" ? "day" : "night";
}

// El catalogo de tareas es unico para los dos tableros, pero el detalle es
// propio de cada turno: lo que se anota en diurna no debe aparecer en noche.
// `detail` (plano) es el formato viejo; se sigue escribiendo con el valor
// diurno para que un cliente sin actualizar no lea el campo vacio.
function normalizeTaskDetails(task) {
    const legacy = cleanTaskDetail(task?.detail);
    const stored = task?.details && typeof task.details === "object"
        ? task.details
        : null;

    return {
        day: stored ? cleanTaskDetail(stored.day) : legacy,
        night: stored ? cleanTaskDetail(stored.night) : ""
    };
}

function cleanTaskDetail(value) {
    return String(value || "").trim().slice(0, TASK_DETAIL_MAX_LENGTH);
}

function taskDetailForShift(task, shift) {
    const details = normalizeTaskDetails(task);

    return shift === "night"
        ? details.night
        : details.day;
}

function normalizeStoredTask(task, index) {
    const defaultWorkerRules = normalizeTaskDefaultRules(task);
    const details = normalizeTaskDetails(task);

    return {
        id: String(task?.id || `task_${Date.now()}_${index}`),
        shift: normalizeTaskShift(task?.shift),
        shiftScope: normalizeTaskShiftScope(task?.shiftScope, task?.shift),
        title: String(task?.title || "").trim(),
        details,
        detail: details.day,
        order: Number.isFinite(Number(task?.order))
            ? Number(task.order)
            : index,
        defaultWorkers: uniqueValues(
            defaultWorkerRules.map(rule => rule.workerName)
        ),
        defaultWorkerRules,
        createdAt: task?.createdAt || new Date().toISOString()
    };
}

function taskTitleKey(title) {
    return normalizeText(title).replace(/\s+/g, " ").trim();
}

function mergeAssignmentEntries(current = {}, next = {}) {
    const currentNote = String(current?.note || "").trim();
    const nextNote = String(next?.note || "").trim();
    const notes = uniqueValues([currentNote, nextNote]);

    return {
        workers: uniqueValues([
            ...assignmentWorkers(current),
            ...assignmentWorkers(next)
        ]),
        note: notes.join(" | "),
        removedDefaults: uniqueValues([
            ...assignmentRemovedDefaults(current),
            ...assignmentRemovedDefaults(next)
        ])
    };
}

function migrateAssignmentsToGenericTasks(taskIdMap) {
    if (![...taskIdMap.entries()].some(([from, to]) => from !== to)) return;

    const all = getAllAssignments();
    let changed = false;

    Object.entries(all).forEach(([week, assignments]) => {
        if (!assignments || typeof assignments !== "object") return;

        const nextAssignments = {};

        Object.entries(assignments).forEach(([cellKey, entry]) => {
            const { shift, taskId, keyDay } = splitAssignmentKey(cellKey);
            const nextTaskId = taskIdMap.get(taskId) || taskId;
            const nextKey = assignmentKey(shift, nextTaskId, keyDay);

            nextAssignments[nextKey] = mergeAssignmentEntries(
                nextAssignments[nextKey],
                entry
            );

            if (nextKey !== cellKey) changed = true;
        });

        all[week] = nextAssignments;
    });

    if (changed) setJSON(ASSIGNMENTS_KEY, all);
}

function migrateTaskCatalogIfNeeded(tasks) {
    const byTitle = new Map();

    tasks.forEach(task => {
        const key = taskTitleKey(task.title) || task.id;
        const items = byTitle.get(key) || [];

        items.push(task);
        byTitle.set(key, items);
    });

    const groups = [];

    byTitle.forEach(items => {
        const shifts = new Set(items.map(task => task.shift));

        if (items.length > 1 && shifts.size > 1) {
            groups.push(items);
            return;
        }

        items.forEach(task => groups.push([task]));
    });

    const needsMigration = tasks.some(task =>
        task.shift !== GENERIC_TASK_SHIFT
    ) || groups.some(group => group.length > 1);

    if (!needsMigration) return tasks;

    const taskIdMap = new Map();
    const migrated = groups.map(group => {
        const canonical = group.find(task => task.shift === GENERIC_TASK_SHIFT) ||
            group.find(task => task.shift === "day") ||
            group[0];
        // La misma tarea repetida en los dos turnos pasa a ser UNA que va en
        // los dos tableros. La que solo existia en uno conserva ese turno: es
        // lo que el catalogo viejo queria decir al guardarla ahi.
        const scopes = new Set(group.map(task => taskShiftScope(task)));
        const shiftScope = scopes.size > 1
            ? GENERIC_TASK_SHIFT
            : [...scopes][0] || GENERIC_TASK_SHIFT;
        const defaultWorkerRules = normalizeTaskDefaultRules({
            defaultWorkers: group.flatMap(task => task.defaultWorkers),
            defaultWorkerRules: group.flatMap(task =>
                taskDefaultRules(task)
            )
        });

        group.forEach(task => {
            taskIdMap.set(task.id, canonical.id);
        });

        return {
            ...canonical,
            shift: GENERIC_TASK_SHIFT,
            shiftScope,
            order: Math.min(...group.map(task => task.order)),
            defaultWorkers: uniqueValues(
                defaultWorkerRules.map(rule => rule.workerName)
            ),
            defaultWorkerRules,
            createdAt: group
                .map(task => task.createdAt)
                .sort()[0] || canonical.createdAt
        };
    }).sort((a, b) =>
        a.order - b.order ||
        a.title.localeCompare(b.title, "es")
    );

    saveTasks(migrated);
    migrateAssignmentsToGenericTasks(taskIdMap);
    return migrated.map((task, index) => ({
        ...task,
        order: index
    }));
}

function getTasks() {
    const raw = getJSON(TASKS_KEY, []);
    const tasks = (Array.isArray(raw) ? raw : [])
        .map(normalizeStoredTask)
        .filter(task => task.title);
    const migrated = migrateTaskCatalogIfNeeded(tasks);

    return migrated.sort((a, b) =>
        a.order - b.order ||
        a.title.localeCompare(b.title, "es")
    );
}

function saveTasks(tasks) {
    markTaskScheduleUpdated();
    setJSON(
        TASKS_KEY,
        tasks.map((task, index) => ({
            ...task,
            // `shift` sale SIEMPRE como "both" -formato viejo- y el turno de
            // verdad viaja en `shiftScope`. Un cliente sin actualizar dibuja la
            // tarea en los dos tableros, que es lo que hacia hasta ahora; si
            // aqui saliera "day" la tomaria por un catalogo viejo y lo
            // reescribiria entero.
            shift: GENERIC_TASK_SHIFT,
            shiftScope: taskShiftScope(task),
            order: index
        }))
    );
}

function getAllAssignments() {
    const raw = getJSON(ASSIGNMENTS_KEY, {});

    return raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw
        : {};
}

function taskAssignmentWorkerNamesForTask(taskId, allAssignments = getAllAssignments()) {
    const names = new Set();

    Object.values(allAssignments || {}).forEach(assignments => {
        if (!assignments || typeof assignments !== "object") return;

        Object.entries(assignments).forEach(([cellKey, entry]) => {
            if (splitAssignmentKey(cellKey).taskId !== taskId) return;

            assignmentWorkers(entry).forEach(name => names.add(name));
            assignmentRemovedDefaults(entry).forEach(name => names.add(name));
        });
    });

    return names;
}

function taskWorkerNames(task, allAssignments = getAllAssignments()) {
    const names = taskAssignmentWorkerNamesForTask(task?.id, allAssignments);

    taskDefaultRules(task).forEach(rule => {
        if (rule.workerName) names.add(rule.workerName);
    });

    return names;
}

function allTaskWorkerNames() {
    const allAssignments = getAllAssignments();
    const names = new Set();

    getTasks().forEach(task => {
        taskWorkerNames(task, allAssignments)
            .forEach(name => names.add(name));
    });

    return [...names];
}

function publishTaskAssignmentChanges(workerNames = null) {
    const names = Array.isArray(workerNames)
        ? workerNames
        : allTaskWorkerNames();

    if (!names.length) return;

    scheduleWorkerAppDataPublish(
        TASK_ASSIGNMENT_PUBLISH_DELAY_MS,
        names,
        null,
        { requiresLocalStateFlush: true }
    );
}




function getWeekAssignments(start = currentWeekStart) {
    const all = getAllAssignments();
    const value = all[weekKey(start)];

    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}

// Cuando el supervisor toco por ultima vez la programacion de esa semana. Es lo
// que se le muestra al trabajador para que sepa si lo que ve es reciente.
function markTaskScheduleUpdated(start = currentWeekStart) {
    const raw = getJSON(TASK_SCHEDULE_UPDATED_KEY, {});
    const map = raw && typeof raw === "object" && !Array.isArray(raw)
        ? { ...raw }
        : {};

    map[weekKey(start)] = new Date().toISOString();
    setJSON(TASK_SCHEDULE_UPDATED_KEY, map);
}

export function taskScheduleUpdatedAt(start = currentWeekStart) {
    const raw = getJSON(TASK_SCHEDULE_UPDATED_KEY, {});
    const value = raw && typeof raw === "object" ? raw[weekKey(start)] : "";

    return typeof value === "string" ? value : "";
}

// `touch: false` es para el saneado que corre en cada pintado: aplica reglas
// predefinidas y limpia restos, y si eso marcara la semana como modificada, la
// fecha saltaria sola con solo MIRAR el tablero. La marca es de ediciones
// deliberadas.
function saveWeekAssignments(assignments, start = currentWeekStart, { touch = true } = {}) {
    // Solo las ediciones deliberadas van a la bitacora: el saneado de cada
    // pintado guarda con touch: false, y eso no lo hizo nadie.
    const before = touch ? storedWeekAssignments(start) : null;
    const all = getAllAssignments();

    all[weekKey(start)] = assignments;
    setJSON(ASSIGNMENTS_KEY, all);

    if (touch) {
        markTaskScheduleUpdated(start);
        noteDeliberateWeekEdit(start, before, assignments);
    }
}

// La semana tal como esta GUARDADA, leida del texto y no de getJSON. La cache de
// persistence clona solo la raiz: las semanas son el MISMO objeto que quien
// llama ya modifico en su sitio antes de guardar. Leida por ahi, la foto de
// antes saldria igual a la de despues y la bitacora no veria ningun cambio.
function storedWeekAssignments(start = currentWeekStart) {
    try {
        const parsed = JSON.parse(getRaw(ASSIGNMENTS_KEY, "{}") || "{}");
        const week = parsed && typeof parsed === "object"
            ? parsed[weekKey(start)]
            : null;

        return week && typeof week === "object" && !Array.isArray(week)
            ? week
            : {};
    } catch {
        return {};
    }
}

function activeWorkspaceIdForAudit() {
    return String(getActiveWorkspace()?.id || "");
}

function auditDayLabel(keyDay) {
    const date = parseKey(keyDay);

    return Number.isNaN(date.getTime())
        ? keyDay
        : `${formatWeekdayShort(date)} ${date.getDate()}`;
}

function noteDeliberateWeekEdit(start, before, after) {
    const workspaceId = activeWorkspaceIdForAudit();

    // Lo pendiente es de la unidad donde se edito. Si entretanto se cambio de
    // unidad, volcarlo ahora lo dejaria en la bitacora de OTRA.
    if (taskAuditWorkspaceId && taskAuditWorkspaceId !== workspaceId) {
        pendingTaskAudits.clear();
    }

    taskAuditWorkspaceId = workspaceId;

    const key = weekKey(start);
    const pending = pendingTaskAudits.get(key) || {
        start: start instanceof Date ? new Date(start.getTime()) : new Date(start),
        changes: createWeekChangeAccumulator()
    };

    accumulateWeekChanges(pending.changes, diffWeekAssignments(before, after));
    pendingTaskAudits.set(key, pending);

    clearTimeout(taskAuditTimer);
    taskAuditTimer = setTimeout(flushTaskAssignmentAudit, TASK_AUDIT_QUIET_MS);
}

function flushTaskAssignmentAudit() {
    clearTimeout(taskAuditTimer);
    taskAuditTimer = null;

    if (!pendingTaskAudits.size) return;

    const pending = [...pendingTaskAudits.values()];
    const sameWorkspace = taskAuditWorkspaceId === activeWorkspaceIdForAudit();

    pendingTaskAudits.clear();

    // Se cambio de unidad antes del volcado: la bitacora local ya es la de la
    // otra. Mejor perder este resumen que dejarlo firmado en una unidad ajena.
    if (!sameWorkspace) return;

    const tasks = getTasks();
    const titleOf = taskId =>
        tasks.find(task => task.id === taskId)?.title || "(tarea eliminada)";

    pending.forEach(({ start, changes }) => {
        const summary = describeWeekChanges(changes, {
            taskTitle: titleOf,
            workerLabel: name => shortWorkerName(name) || name,
            dayLabel: auditDayLabel
        });

        if (!summary) return;

        addAuditLog(
            AUDIT_CATEGORY.TASKS,
            "Modificó la asignación de tareas",
            `${scheduleWeekLabel(start)}: ${summary.text}.`,
            {
                profile: "",
                week: scheduleWeekStartISO(start),
                ...summary.counts
            }
        );
    });
}

// Sin `profile`, addAuditLog firmaria con el perfil seleccionado en el
// calendario, y la entrada quedaria colgada de una trabajadora cualquiera.
function logTaskCatalogChange(action, details, meta = {}) {
    addAuditLog(AUDIT_CATEGORY.TASKS, action, details, { ...meta, profile: "" });
}

// Al ocultar o cerrar la pestana se vuelca lo pendiente: esperar el minuto de
// calma ahi seria perder el registro.
if (typeof document !== "undefined" && typeof window !== "undefined") {
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushTaskAssignmentAudit();
    });
    window.addEventListener("pagehide", () => flushTaskAssignmentAudit());
}

function assignmentKey(shift, taskId, keyDay) {
    return `${shift}|${taskId}|${keyDay}`;
}

function splitAssignmentKey(value) {
    const [shift, taskId, keyDay] = String(value || "").split("|");

    return { shift, taskId, keyDay };
}

function profileProfession(profile) {
    return String(profile?.profession || "Sin informacion");
}

function uniqueValues(values) {
    return [...new Set(values.filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "es"));
}

function normalizeDefaultInterval(value) {
    const numberValue = Math.floor(Number(value));

    return Number.isFinite(numberValue) &&
        numberValue >= 1 &&
        numberValue <= 10
        ? numberValue
        : 1;
}

// Tope de las periodicidades "Cada N turnos diurno habil".
const MAX_HABIL_INTERVAL = 5;

function normalizeHabilInterval(value) {
    const numberValue = Math.floor(Number(value));

    return Number.isFinite(numberValue) &&
        numberValue >= 1 &&
        numberValue <= MAX_HABIL_INTERVAL
        ? numberValue
        : 1;
}

// La periodicidad se guarda como { interval, habilOnly }. En el <select> se
// codifica como "h<N>" para "Cada N turnos diurno habil" (la secuencia cuenta
// solo turnos diurnos en dias habiles) y "<N>" para las normales (todos los
// componentes de turno programados, diurnos y nocturnos).
function encodeIntervalValue(interval, habilOnly) {
    return habilOnly
        ? `h${normalizeHabilInterval(interval)}`
        : String(normalizeDefaultInterval(interval));
}

function parseIntervalValue(value) {
    const raw = String(value || "").trim().toLowerCase();

    if (raw.startsWith("h")) {
        return {
            interval: normalizeHabilInterval(raw.slice(1)),
            habilOnly: true
        };
    }

    return {
        interval: normalizeDefaultInterval(raw),
        habilOnly: false
    };
}

function isBusinessKeyDay(keyDay) {
    const date = parseKey(keyDay);

    if (!isValidDate(date)) return false;

    return isBusinessDay(date, getCachedHolidays(date.getFullYear()));
}

function normalizeTaskDefaultRules(task) {
    const rules = new Map();
    const defaultWorkers = Array.isArray(task?.defaultWorkers)
        ? task.defaultWorkers
        : [task?.defaultWorker];
    const addRule = (workerName, interval = 1, anchorKeyDay = "", habilOnly = false) => {
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

function availableRoles() {
    return uniqueValues(
        getProfiles()
            .filter(isProfileActive)
            .map(profile => profile.estamento || "Sin estamento")
    );
}

function availableProfessions() {
    return uniqueValues(
        getProfiles()
            .filter(isProfileActive)
            .map(profileProfession)
    );
}

function selectionMatches(value, selected) {
    return !selected || selected.includes(value);
}

function profileMatchesFilters(profile, roles, professions) {
    return selectionMatches(
        profile.estamento || "Sin estamento",
        roles
    ) &&
        selectionMatches(profileProfession(profile), professions);
}

function profileByName(name) {
    return getProfiles().find(profile => profile.name === name) || null;
}

function getProfileShift(profile, keyDay) {
    return getTurnoReal(profile.name, keyDay);
}

function readMap(prefix, profileName) {
    return getJSON(`${prefix}_${profileName}`, {});
}

function absenceLabelForType(type) {
    if (type === "license") return "Licencia M\u00e9dica";
    if (type === "professional_license") return "LM Profesional";
    if (type === "union_leave") return "Permiso Gremial";
    if (type === "unpaid_leave") return "Permiso sin Goce";
    if (type === "training") return "Capacitaci\u00f3n";
    if (type === "unjustified_absence") return "Ausencia injustificada";

    return "Ausencia";
}

function absenceDetail(profileName, keyDay) {
    const admin = readMap("admin", profileName);
    const legal = readMap("legal", profileName);
    const comp = readMap("comp", profileName);
    const absences = readMap("absences", profileName);

    if (admin[keyDay] === 1) return "P. Administrativo";
    if (admin[keyDay] === "0.5M") return "1/2 ADM Ma\u00f1ana";
    if (admin[keyDay] === "0.5T") return "1/2 ADM Tarde";
    if (admin[keyDay] === 0.5) return "1/2 ADM";
    if (legal[keyDay]) return "F. Legal";
    if (comp[keyDay]) return "F. Compensatorio";
    if (absences[keyDay]) {
        return absenceLabelForType(getAbsenceType(absences[keyDay]));
    }
    if (getHourReturn(profileName, keyDay)) {
        return "Devolucion de Hora";
    }

    return "";
}

// Un 1/2 ADM NO borra al trabajador del tablero diurno: viene a trabajar la
// mitad de la jornada, y el chip lo rotula con su franja ("hasta las 14:00" /
// "desde las 14:00"). El turno de noche es un bloque que el medio permiso no
// parte, asi que ahi sigue contando como ausencia.
function hasBlockingAbsence(profileName, keyDay, shift = "") {
    if (shift === "day" && getHalfAdminHalf(profileName, keyDay)) return false;

    return Boolean(absenceDetail(profileName, keyDay));
}

function turnScheduledForShift(turn, shift) {
    const state = Number(turn) || TURNO.LIBRE;

    if (shift === "day") {
        return [
            TURNO.LARGA,
            TURNO.DIURNO,
            TURNO.TURNO24,
            TURNO.DIURNO_NOCHE,
            // Medias jornadas y extension horaria: son tramos DIURNOS (08:00 a
            // 14:00 o 14:00 a 20:00). El de 18 horas es la extension pegada a
            // la noche, asi que ese dia esta citado en los dos tableros.
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

function isScheduledForShift(profile, keyDay, shift) {
    if (!profile || !isProfileActive(profile)) return false;

    return turnScheduledForShift(getProfileShift(profile, keyDay), shift);
}

function isBaseScheduledForShift(profile, keyDay, shift) {
    if (!profile || !isProfileActive(profile)) return false;

    return turnScheduledForShift(getTurnoBase(profile.name, keyDay), shift);
}

function isAvailableForShift(profile, keyDay, shift) {
    if (!isScheduledForShift(profile, keyDay, shift)) return false;
    return !hasBlockingAbsence(profile.name, keyDay, shift);
}

function assignmentWorkers(entry) {
    return Array.isArray(entry?.workers)
        ? entry.workers.filter(Boolean)
        : [];
}

function assignmentRemovedDefaults(entry) {
    return uniqueValues(
        Array.isArray(entry?.removedDefaults)
            ? entry.removedDefaults.map(worker =>
                String(worker || "").trim()
            )
            : []
    );
}

// Casilla CERRADA: esa tarea ese dia y ese turno no va. No admite gente -ni a
// mano, ni por regla de predefinido, ni por programacion automatica- y no
// cuenta como hueco sin cubrir. Es lo mismo que hace el mantenimiento de un
// equipo, pero decidido a mano y para una sola casilla.
function assignmentClosed(entry) {
    return entry?.closed === true;
}

// Si la casilla esta resuelta para la barra de cobertura del dia. Lo esta con
// gente dentro, pero TAMBIEN cuando ese turno no va -equipo en mantenimiento o
// cerrada a mano-: si eso contara como pendiente, el aviso de "sin cubrir"
// pediria tapar algo que se decidio no hacer.
function cellIsSettled(entry, outages = []) {
    return Boolean(
        outages.length ||
        assignmentClosed(entry) ||
        assignmentWorkers(entry).length
    );
}

function taskDefaultWorkers(task) {
    return taskDefaultRules(task).map(rule => rule.workerName);
}

function taskDefaultRules(task) {
    return Array.isArray(task?.defaultWorkerRules)
        ? task.defaultWorkerRules
        : normalizeTaskDefaultRules(task);
}

function isValidDate(date) {
    return date instanceof Date && !Number.isNaN(date.getTime());
}

// Los turnos que cuenta la secuencia de "cada N turnos". Si la tarea va en un
// solo tablero, "turno" es turno DE ESE TABLERO: para una tarea solo diurna,
// las noches del trabajador no cuentan ni corren la cuenta. Asi "cada turno"
// en una tarea diurna es "todos los turnos que le toque venir de dia".
function shiftOrderForRule(habilOnly, scope = GENERIC_TASK_SHIFT) {
    if (habilOnly) return ["day"];
    if (scope === "day" || scope === "night") return [scope];

    return SHIFT_TYPES;
}

function countBaseScheduledTurns(
    profile,
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
                isBaseScheduledForShift(profile, keyDay, shift) &&
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
    profile,
    keyDay,
    shift,
    scope = GENERIC_TASK_SHIFT
) {
    if (!isBaseScheduledForShift(profile, keyDay, shift)) return false;
    if (hasBlockingAbsence(profile.name, keyDay, shift)) return false;

    const habilOnly = rule?.habilOnly === true;

    // "Cada N turnos diurno habil": solo aplica al tablero diurno y la
    // secuencia ignora noches, dias libres e inhabiles.
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
        profile,
        shift,
        anchor,
        target,
        habilOnly,
        scope
    );

    return scheduledCount > 0 && (scheduledCount - 1) % interval === 0;
}

function defaultWorkersForCell(task, keyDay, shift = task.shift) {
    // Una tarea que no va en ese tablero no tiene predefinidos ahi, aunque la
    // regla del trabajador siga guardada: el turno de la tarea manda.
    if (!taskAppliesToShift(task, shift)) return [];

    const scope = taskShiftScope(task);

    return taskDefaultRules(task)
        .filter(rule => {
            const profile = profileByName(rule.workerName);

            return shouldApplyDefaultRule(
                rule,
                profile,
                keyDay,
                shift,
                scope
            ) && isAvailableForShift(profile, keyDay, shift);
        })
        .map(rule => rule.workerName);
}

function applyDefaultAssignments(days, tasks, assignments) {
    let changed = false;

    tasks.forEach(task => {
        SHIFT_TYPES.forEach(shift => {
            if (!taskAppliesToShift(task, shift)) return;

            const scope = taskShiftScope(task);

            taskDefaultRules(task).forEach(rule => {
                const profile = profileByName(rule.workerName);

                if (!profile) return;

                days.forEach(day => {
                    const keyDay = keyFromDate(day);

                    if (
                        !shouldApplyDefaultRule(
                            rule,
                            profile,
                            keyDay,
                            shift,
                            scope
                        ) ||
                        !isAvailableForShift(profile, keyDay, shift)
                    ) return;

                    // Si la casilla esta fusionada, el predefinido entra en
                    // la de arriba del grupo: es la unica que se dibuja.
                    const group = groupForTask(
                        assignments,
                        shift,
                        tasks,
                        task.id,
                        keyDay
                    );
                    const ownerId = group?.taskIds[0] || task.id;
                    const cellKey = assignmentKey(shift, ownerId, keyDay);
                    const entry = getCellEntry(
                        assignments,
                        shift,
                        ownerId,
                        keyDay
                    );
                    const workers = assignmentWorkers(entry);
                    const removedDefaults = assignmentRemovedDefaults(entry);

                    // La casilla cerrada no se llena sola: es lo que la
                    // distingue de una vacia.
                    if (assignmentClosed(entry)) return;

                    if (
                        workers.includes(rule.workerName) ||
                        removedDefaults.includes(rule.workerName)
                    ) return;

                    assignments[cellKey] = {
                        ...entry,
                        workers: [...workers, rule.workerName]
                    };
                    changed = true;
                });
            });
        });
    });

    return changed;
}

function cleanAssignmentsForWeek(days, tasks, start = currentWeekStart) {
    const assignments = getWeekAssignments(start);

    // Un catalogo VACIO no autoriza a borrar nada.
    //
    // El catalogo puede venir vacio porque el modulo `tasks` todavia no bajo
    // de la nube, porque la sesion recien arranca, o porque se perdio. En los 3
    // casos, seguir adelante trataria TODAS las casillas como huerfanas: el
    // saneado corre en cada pintado, asi que abrir el menu -o publicar a la
    // PWA, que pasa por aca con tres semanas- borraba la programacion y
    // sincronizaba el vacio al resto de las sesiones. Sin catalogo no hay nada
    // que sanear.
    if (!tasks.length) return assignments;

    const taskIds = new Set(tasks.map(task => task.id));
    // El catalogo de cada tablero, que es contra el que se mide la fusion: la
    // tarea de abajo es la siguiente DE ESE TURNO.
    const shiftTasks = {
        day: tasksForShift(tasks, "day"),
        night: tasksForShift(tasks, "night")
    };
    let changed = false;

    Object.entries(assignments).forEach(([cellKey, entry]) => {
        const { shift, taskId, keyDay } = splitAssignmentKey(cellKey);

        // Casilla de una tarea que ya no esta en el catalogo. NO se borra: con
        // la sincronizacion por elemento el catalogo puede llegar a medias, y
        // el que falta todavia no es el que se elimino. Quedan inertes -el
        // tablero recorre las tareas, no las casillas, asi que no se dibujan- y
        // quien borra una tarea de verdad ya limpia las suyas en deleteTask().
        if (!taskIds.has(taskId)) return;

        // El enlace apunta por id: si la tarea de abajo ya no es esa -se
        // reordeno o se borro- la fusion deja de tener sentido.
        if (entry?.mergedNextTaskId) {
            const board = shiftTasks[shift] || tasks;
            const index = board.findIndex(task => task.id === taskId);
            const next = board[index + 1];

            if (!next || next.id !== entry.mergedNextTaskId) {
                changed = true;
                persistEntryOrDelete(assignments, cellKey, {
                    ...entry,
                    mergedNextTaskId: ""
                });
            }
        }

        if (!days.some(day => keyFromDate(day) === keyDay)) return;

        // Aqui solo se quita a quien ese dia NO PUEDE trabajar: licencia,
        // permiso, ausencia, o un perfil que ya no existe o quedo inactivo.
        //
        // Estar libre del turno NO basta para quitarlo. El modal ofrece
        // deliberadamente "Todos" para asignar a alguien fuera de su turno
        // (`includeWorkersWithoutShift`), y este saneado corre en cada
        // pintado: si tambien filtrara por turno, guardar a esa persona y
        // perderla serian el mismo gesto, sin aviso ninguno. Se queda
        // asignada y el chip se marca como fuera de turno.
        const availableWorkers = assignmentWorkers(entry)
            .filter(name => {
                const profile = profileByName(name);

                return Boolean(profile) &&
                    isProfileActive(profile) &&
                    !hasBlockingAbsence(name, keyDay, shift);
            });

        if (
            availableWorkers.length !== assignmentWorkers(entry).length
        ) {
            changed = true;
            persistEntryOrDelete(assignments, cellKey, {
                ...entry,
                workers: availableWorkers
            });
        }
    });

    if (applyDefaultAssignments(days, tasks, assignments)) {
        changed = true;
    }

    if (changed) saveWeekAssignments(assignments, start, { touch: false });
    return assignments;
}

function getCellEntry(assignments, shift, taskId, keyDay) {
    return assignments[assignmentKey(shift, taskId, keyDay)] || {
        workers: [],
        note: "",
        removedDefaults: [],
        mergedNextTaskId: ""
    };
}

// ---------------------------------------------------------------------------
// Fusion de casillas dentro de una columna (mismo turno y mismo dia).
//
// El enlace se guarda en la casilla de ARRIBA y apunta POR ID a la tarea de
// abajo. Guardar el id -y no un simple "va unida con la siguiente"- es lo que
// deja que la fusion se invalide sola cuando el supervisor reordena o borra
// tareas: si la de abajo ya no es esa, el enlace se ignora y despues se limpia.
//
// Un grupo es una cadena maxima de enlaces. Los trabajadores viven todos en la
// casilla de arriba del grupo, que es la unica que se dibuja; las de abajo no
// se emiten y su fila la ocupa la de arriba.
// ---------------------------------------------------------------------------

function mergedNextIdOf(assignments, shift, taskId, keyDay) {
    return String(
        getCellEntry(assignments, shift, taskId, keyDay).mergedNextTaskId || ""
    );
}

function isMergedWithNext(assignments, shift, tasks, index, keyDay) {
    const current = tasks[index];
    const next = tasks[index + 1];

    if (!current || !next) return false;

    return mergedNextIdOf(assignments, shift, current.id, keyDay) === next.id;
}

// Los indices de los grupos son los de la COLUMNA -la lista de tareas de ese
// tablero-, no los del catalogo: filtrar aqui es lo que deja que cualquiera
// llame con el catalogo entero y siga cuadrando con lo que se dibuja.
function columnGroups(assignments, shift, tasks, keyDay) {
    const column = tasksForShift(tasks, shift);
    const groups = [];
    let current = null;

    column.forEach((task, index) => {
        if (!current) current = { start: index, taskIds: [task.id] };

        if (isMergedWithNext(assignments, shift, column, index, keyDay)) {
            current.taskIds.push(column[index + 1].id);
            return;
        }

        groups.push(current);
        current = null;
    });

    if (current) groups.push(current);

    return groups;
}

function groupForTask(assignments, shift, tasks, taskId, keyDay) {
    return columnGroups(assignments, shift, tasks, keyDay)
        .find(group => group.taskIds.includes(taskId)) || null;
}

// Al fusionar, los trabajadores de las casillas de abajo suben a la de arriba,
// que pasa a ser la unica visible. Si se quedaran donde estan desaparecerian de
// la vista sin haberse borrado.
function collapseGroupWorkers(assignments, shift, tasks, taskId, keyDay) {
    const group = groupForTask(assignments, shift, tasks, taskId, keyDay);

    if (!group || group.taskIds.length < 2) return;

    const [ownerId, ...others] = group.taskIds;
    const owner = getCellEntry(assignments, shift, ownerId, keyDay);
    const workers = [...assignmentWorkers(owner)];
    const notes = [String(owner.note || "").trim()];
    const removed = [...assignmentRemovedDefaults(owner)];

    others.forEach(id => {
        const entry = getCellEntry(assignments, shift, id, keyDay);

        workers.push(...assignmentWorkers(entry));
        notes.push(String(entry.note || "").trim());
        removed.push(...assignmentRemovedDefaults(entry));

        persistEntryOrDelete(assignments, assignmentKey(shift, id, keyDay), {
            workers: [],
            note: "",
            removedDefaults: [],
            mergedNextTaskId: entry.mergedNextTaskId
        });
    });

    persistEntryOrDelete(assignments, assignmentKey(shift, ownerId, keyDay), {
        ...owner,
        workers: uniqueValues(workers),
        note: uniqueValues(notes).join(" | "),
        removedDefaults: uniqueValues(removed),
        // Una casilla cerrada nunca tiene gente dentro. Si al fusionar sube
        // alguien de las de abajo, el grupo se abre: si no, la casilla diria
        // "Cerrada" y mostraria a los que subieron al mismo tiempo.
        closed: assignmentClosed(owner) && !workers.length
    });
}

function groupOwnerEntry(assignments, shift, tasks, taskId, keyDay) {
    const group = groupForTask(assignments, shift, tasks, taskId, keyDay);

    return getCellEntry(assignments, shift, group?.taskIds[0] || taskId, keyDay);
}

// Une el tramo [startIndex..endIndex] enlazando cada casilla con la siguiente.
// Al terminar, `collapseGroupWorkers` sube a todos los trabajadores del tramo a
// la casilla de arriba, que es la unica que se dibuja.
function mergeCellRange(shift, keyDay, startIndex, endIndex) {
    const assignments = getWeekAssignments();
    // Los indices vienen del tablero, asi que la lista tiene que ser la de ese
    // tablero: en el catalogo entero apuntarian a otra tarea.
    const tasks = tasksForShift(getTasks(), shift);

    if (
        startIndex < 0 ||
        endIndex >= tasks.length ||
        endIndex <= startIndex
    ) return false;

    for (let index = startIndex; index < endIndex; index += 1) {
        persistEntryOrDelete(
            assignments,
            assignmentKey(shift, tasks[index].id, keyDay),
            {
                ...getCellEntry(assignments, shift, tasks[index].id, keyDay),
                mergedNextTaskId: tasks[index + 1].id
            }
        );
    }

    collapseGroupWorkers(
        assignments,
        shift,
        tasks,
        tasks[startIndex].id,
        keyDay
    );
    saveWeekAssignments(assignments);
    publishTaskAssignmentChanges();
    return true;
}

// Al separar, los trabajadores no se mueven: ya estaban todos en la casilla de
// arriba, que es justo donde el supervisor los espera para repartirlos a mano.
function splitCellGroup(shift, keyDay, taskId) {
    const assignments = getWeekAssignments();
    const tasks = getTasks();
    const group = groupForTask(assignments, shift, tasks, taskId, keyDay);

    if (!group || group.taskIds.length < 2) return false;

    group.taskIds.forEach(id => {
        persistEntryOrDelete(assignments, assignmentKey(shift, id, keyDay), {
            ...getCellEntry(assignments, shift, id, keyDay),
            mergedNextTaskId: ""
        });
    });
    saveWeekAssignments(assignments);
    publishTaskAssignmentChanges();
    return true;
}

function workerHasOtherTask(
    assignments,
    workerName,
    shift,
    keyDay,
    taskId
) {
    return Object.entries(assignments).some(([cellKey, entry]) => {
        const parts = splitAssignmentKey(cellKey);

        return parts.shift === shift &&
            parts.keyDay === keyDay &&
            parts.taskId !== taskId &&
            assignmentWorkers(entry).includes(workerName);
    });
}

function profileShiftLabel(profile, keyDay) {
    return TURNO_LABEL[getProfileShift(profile, keyDay)] || "Libre";
}

function profileMatchesWorkerSearch(profile, keyDay, query) {
    const normalizedQuery = normalizeProfileSearch(query);

    if (!normalizedQuery) return true;

    return [
        profile.name,
        profile.estamento,
        profileProfession(profile),
        profileShiftLabel(profile, keyDay),
        getCalendarProfileSearchValue(profile)
    ]
        .map(normalizeProfileSearch)
        .some(value => value.includes(normalizedQuery));
}

function isAssignableCandidate(profile, keyDay, shift, includeWorkersWithoutShift) {
    if (!profile || !isProfileActive(profile)) return false;
    if (hasBlockingAbsence(profile.name, keyDay, shift)) return false;

    return includeWorkersWithoutShift ||
        turnScheduledForShift(getProfileShift(profile, keyDay), shift);
}

function candidateProfiles(
    shift,
    keyDay,
    roles,
    professions,
    {
        includeWorkersWithoutShift = false,
        query = ""
    } = {}
) {
    return getProfiles()
        .filter(isProfileActive)
        .filter(profile => profileMatchesFilters(
            profile,
            roles,
            professions
        ))
        .filter(profile => isAssignableCandidate(
            profile,
            keyDay,
            shift,
            includeWorkersWithoutShift
        ))
        .filter(profile => profileMatchesWorkerSearch(
            profile,
            keyDay,
            query
        ))
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function renderDialogWorkerOptions(candidates) {
    const used = new Set();

    return candidates
        .flatMap(profile =>
            getCalendarProfileSearchOptionValues(profile)
                .map(value => {
                    if (!value || used.has(value)) return "";

                    used.add(value);

                    const searchValue =
                        getCalendarProfileSearchValue(profile);
                    const label = value !== searchValue
                        ? ` label="${escapeHTML(searchValue)}"`
                        : "";

                    return `<option value="${escapeHTML(value)}"${label}></option>`;
                })
        )
        .join("");
}

function filterSummaryLabel(options, selected) {
    if (!selected || selected.length === options.length) {
        return "Todos";
    }

    if (!selected.length) {
        return "Sin selecci\u00f3n";
    }

    if (selected.length === 1) {
        return selected[0];
    }

    return `${selected.length} seleccionados`;
}

function renderMultiSelectFilter(
    name,
    options,
    selected,
    action,
    openAction = openTaskFilterGroup,
    prefix = ""
) {
    const normalizedSelected = selected || options;
    const isOpen = openAction === action;
    const isFiltered = Boolean(selected);

    return `
        <details class="task-assignment-multiselect${isFiltered ? " is-filtered" : ""}" data-filter-group="${escapeHTML(action)}" ${isOpen ? "open" : ""}>
            <summary>
                <span>${prefix ? `${escapeHTML(prefix)} &middot; ` : ""}${escapeHTML(filterSummaryLabel(options, selected))}</span>
                <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                    <path d="M5 7.5 10 12.5 15 7.5"></path>
                </svg>
            </summary>
            <div class="task-assignment-multiselect__menu">
                <label class="task-assignment-multiselect__option task-assignment-multiselect__option--all">
                    <input type="checkbox" data-multiselect-select-all data-multiselect-name="${escapeHTML(name)}" ${normalizedSelected.length === options.length ? "checked" : ""}>
                    <span>Seleccionar todo</span>
                </label>
                ${options.map(option => `
                    <label class="task-assignment-multiselect__option">
                        <input type="checkbox" name="${escapeHTML(name)}" value="${escapeHTML(option)}" ${normalizedSelected.includes(option) ? "checked" : ""}>
                        <span>${escapeHTML(option)}</span>
                    </label>
                `).join("")}
            </div>
        </details>
    `;
}

function selectedValues(root, selector, options) {
    const values = [...root.querySelectorAll(selector)]
        .filter(input => input.checked)
        .map(input => input.value);

    return values.length === options.length ? null : values;
}

function syncMultiSelectSelectAll(control) {
    const selectAll =
        control?.querySelector("[data-multiselect-select-all]");
    const options = [...(
        control?.querySelectorAll(
            "input[type='checkbox']:not([data-multiselect-select-all])"
        ) || []
    )];

    if (!selectAll) return;

    const checkedCount =
        options.filter(input => input.checked).length;

    selectAll.checked =
        options.length > 0 && checkedCount === options.length;
    selectAll.indeterminate =
        checkedCount > 0 && checkedCount < options.length;
}

function handleMultiSelectSelectAllChange(event) {
    const target = event?.target;
    const control = target instanceof Element
        ? target.closest(".task-assignment-multiselect")
        : null;

    if (!control) return;

    if (target?.matches?.("[data-multiselect-select-all]")) {
        const nextChecked = Boolean(target.checked);

        control
            .querySelectorAll(
                "input[type='checkbox']:not([data-multiselect-select-all])"
            )
            .forEach(input => {
                input.checked = nextChecked;
            });
    }

    syncMultiSelectSelectAll(control);
}

function closeMultiSelectsOutside(root, event, clearOpenGroup) {
    const target = event?.target;

    root
        .querySelectorAll(".task-assignment-multiselect[open]")
        .forEach(control => {
            if (target && control.contains(target)) return;
            control.open = false;
        });

    if (
        root.querySelector(".task-assignment-multiselect[open]")
    ) {
        return;
    }

    clearOpenGroup();
}

function bindMultiSelectOutsideClose(root, clearOpenGroup) {
    const handlePointerDown = event => {
        closeMultiSelectsOutside(root, event, clearOpenGroup);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
        document.removeEventListener(
            "pointerdown",
            handlePointerDown,
            true
        );
    };
}

function birthdayProfiles(date, { filtered = true } = {}) {
    const month = date.getMonth();
    const day = date.getDate();

    return getProfiles()
        .filter(isProfileActive)
        .filter(profile => !filtered || profileMatchesFilters(
            profile,
            selectedRoles,
            selectedProfessions
        ))
        .filter(profile => {
            const raw = String(profile.birthDate || "");
            const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);

            return match &&
                Number(match[2]) - 1 === month &&
                Number(match[3]) === day;
        })
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function absenceProfiles(date, { filtered = true } = {}) {
    const keyDay = keyFromDate(date);

    return getProfiles()
        .filter(isProfileActive)
        .filter(profile => !filtered || profileMatchesFilters(
            profile,
            selectedRoles,
            selectedProfessions
        ))
        .map(profile => ({
            profile,
            label: absenceDetail(profile.name, keyDay)
        }))
        .filter(item => item.label)
        .sort((a, b) =>
            a.profile.name.localeCompare(b.profile.name, "es")
        );
}

// En el tablero el chip muestra el nombre abreviado para que quepan mas
// trabajadores por celda: inicial del primer nombre + primer apellido. En los
// nombres de los perfiles el primer apellido es la penultima palabra (3
// palabras -> la 2a, 4 -> la 3a, 5 -> la 4a, 6 -> la 5a). El nombre completo
// se conserva en los data-* y en el title del chip.
function workerNameParts(fullName) {
    const words = String(fullName || "").trim().split(/\s+/).filter(Boolean);

    if (!words.length) return null;
    if (words.length === 1) return { first: words[0], surname: "" };

    return {
        first: words[0],
        surname: words.length >= 3 ? words[words.length - 2] : words[1]
    };
}

function shortWorkerName(fullName, { compact = false } = {}) {
    const parts = workerNameParts(fullName);

    if (!parts) return "";
    if (!parts.surname) return parts.first;

    // La tabla publicada encadena los nombres con guion ("J.CORNEJO-B.ESCOBAR")
    // y ahi el espacio despues del punto se lee como separacion entre personas.
    return `${parts.first.charAt(0)}.${compact ? "" : " "}${parts.surname}`;
}

// El nombre como sale en la programacion publicada (visor, hoja impresa y PWA).
// Quien viene solo un tramo del dia -1/2 ADM o extension horaria- lleva su
// franja pegada al nombre: la programacion se lee sin el tablero al lado, y
// "esta en la tarea" y "esta toda la jornada" no son lo mismo.
function scheduleWorkerName(profileName, keyDay, shift) {
    const name = shortWorkerName(profileName, { compact: true });

    if (!name) return "";

    const partial = partialShiftText(
        profileName,
        keyDay,
        shift,
        { compact: true }
    );

    return partial ? `${name} (${partial})` : name;
}

// Iniciales del avatar del chip: inicial del nombre + inicial del primer
// apellido, las mismas dos letras que se leen en el chip abreviado.
function workerInitials(fullName) {
    const parts = workerNameParts(fullName);

    if (!parts) return "";
    if (!parts.surname) return parts.first.charAt(0).toUpperCase();

    return `${parts.first.charAt(0)}${parts.surname.charAt(0)}`.toUpperCase();
}

// El tono del avatar se deriva del nombre, no de la posicion en la lista: asi
// una misma persona conserva su color entre semanas, turnos y tableros. Todos
// comparten luminosidad y croma y solo cambian de matiz, para que ninguno pese
// mas que otro ni compita con el color de marca.
function workerAvatarTone(fullName) {
    const name = stripAccents(String(fullName || "")).toUpperCase();
    let hash = 0;

    for (let index = 0; index < name.length; index += 1) {
        hash = (hash * 31 + name.charCodeAt(index)) % 360;
    }

    return `oklch(0.58 0.10 ${hash})`;
}

// La franja parcial de ese trabajador ese dia, ya rotulada: media jornada por
// 1/2 ADM o el tramo diurno de una extension horaria. Vacia cuando viene la
// jornada completa.
function partialShiftText(profileName, keyDay, shift, { compact = false } = {}) {
    return partialShiftLabel(
        getPartialShiftWindow(profileName, keyDay, shift),
        { compact }
    );
}

function renderWorkerAvatar(profileName) {
    return `<span class="task-assignment-worker-avatar" style="background: ${workerAvatarTone(profileName)};" aria-hidden="true">${escapeHTML(workerInitials(profileName))}</span>`;
}

function renderWorkerChip(profileName, task, keyDay) {
    const profile = profileByName(profileName);
    const configuredClass = taskDefaultWorkers(task).includes(profileName)
        ? " is-configured"
        : "";

    if (
        profile &&
        !profileMatchesFilters(
            profile,
            selectedRoles,
            selectedProfessions
        )
    ) {
        return "";
    }

    // Asignado aunque ese dia no le toca el turno: se hace a proposito desde
    // "Todos" del modal, asi que no se oculta ni se borra, pero tampoco puede
    // pasar por una asignacion normal.
    const offShift = Boolean(profile) &&
        !isScheduledForShift(profile, keyDay, task.shift);
    const offShiftClass = offShift
        ? " task-assignment-worker-chip--off-shift"
        : "";
    const offShiftHint = offShift
        ? " | Fuera de su turno este d&iacute;a"
        : "";
    // Media jornada o extension horaria: el trabajador SI esta en la tarea,
    // pero solo un tramo del dia. La etiqueta va junto al nombre para que el
    // supervisor no tenga que abrir nada para saber hasta -o desde- cuando
    // cuenta con el.
    // En el chip va la forma corta -"hasta 14:00"-: la casilla mide 116px y el
    // nombre se recorta con puntos suspensivos antes que la hora. La forma
    // larga queda en el title, junto al nombre completo.
    const partial = partialShiftText(
        profileName,
        keyDay,
        task.shift,
        { compact: true }
    );
    const partialHint = partial
        ? ` | ${partialShiftText(profileName, keyDay, task.shift)}`
        : "";

    return `
        <span class="task-assignment-worker-chip${configuredClass}${offShiftClass}" draggable="true" data-worker-drag="${escapeHTML(profileName)}" data-worker-task="${escapeHTML(task.id)}" data-worker-shift="${escapeHTML(task.shift)}" data-worker-day="${escapeHTML(keyDay)}" title="${escapeHTML(profileName)}${offShiftHint}${escapeHTML(partialHint)} | Arrastrar a otra tarea del mismo turno y d&iacute;a">
            ${renderWorkerAvatar(profileName)}
            <span class="task-assignment-worker-chip__name">${escapeHTML(shortWorkerName(profileName))}</span>
            ${partial ? `<span class="task-assignment-worker-chip__when">${escapeHTML(partial)}</span>` : ""}
            <button class="task-assignment-worker-edit${configuredClass}" type="button" data-worker-default-config="${escapeHTML(profileName)}" data-worker-task="${escapeHTML(task.id)}" data-worker-shift="${escapeHTML(task.shift)}" data-worker-day="${escapeHTML(keyDay)}" title="Editar trabajador predefinido" aria-label="Editar trabajador predefinido">
                &#9998;
            </button>
        </span>
    `;
}

// Los puntos del borde izquierdo son el gesto para fusionar: se arrastra el de
// abajo de una casilla hasta el de arriba de la siguiente (o al reves). Cuando
// el grupo ya esta fusionado, el punto de arriba y el de abajo quedan unidos por
// una linea, y esa linea es el boton para separarlo.
function renderMergePorts(task, keyDay, { taskIndex, size, taskCount }) {
    const shift = escapeHTML(task.shift);
    const day = escapeHTML(keyDay);
    const hasBelow = taskIndex + size < taskCount;
    const merged = size > 1;

    // Un solo punto por casilla, en el borde de abajo. Antes habia dos -arriba
    // y abajo- y la columna se llenaba de puntos sin que el segundo aportara
    // nada: el gesto se puede hacer entero desde uno, arrastrandolo hacia
    // abajo o hacia arriba.
    return `
        ${merged ? `
            <button class="task-assignment-merge-line" type="button" data-merge-split="${escapeHTML(task.id)}" data-shift="${shift}" data-day="${day}" title="Separar las casillas" aria-label="Separar las casillas"></button>
        ` : ""}
        ${hasBelow ? `
            <span class="task-assignment-merge-port task-assignment-merge-port--bottom" draggable="true" data-merge-port="bottom" data-merge-task="${escapeHTML(task.lastTaskId || task.id)}" data-shift="${shift}" data-day="${day}" title="Arrastrar hasta otra casilla de la columna para unir todo el tramo"></span>
        ` : ""}
    `;
}

// ---------------------------------------------------------------------------
// Selector rapido de la casilla.
//
// El caso normal -sumar o sacar a una persona- no merece un modal: se resuelve
// en un panel flotante anclado a la casilla. El modal completo sigue existiendo
// para lo demas (buscador, libres del dia, comentario) y se alcanza desde aqui.
//
// El nodo cuelga del BODY y no de la casilla porque el tablero scrollea en
// horizontal, y un `overflow-x: auto` recorta tambien en vertical: dentro de la
// grilla el panel quedaria cortado por el borde del tablero.
// ---------------------------------------------------------------------------

function isCellPickerOpen(shift, taskId, keyDay) {
    return Boolean(openCellPicker) &&
        openCellPicker.shift === shift &&
        openCellPicker.taskId === taskId &&
        openCellPicker.keyDay === keyDay;
}

function destroyCellPickerNode() {
    if (unbindCellPicker) {
        unbindCellPicker();
        unbindCellPicker = null;
    }

    if (cellPickerNode) {
        cellPickerNode.remove();
        cellPickerNode = null;
    }
}

function closeCellPicker() {
    openCellPicker = null;
    destroyCellPickerNode();
}

function setCellWorkers(shift, taskId, keyDay, nextWorkers) {
    const assignments = getWeekAssignments();
    const tasks = getTasks();
    const task = tasks.find(item => item.id === taskId);

    if (!task) return;

    const cellKey = assignmentKey(shift, taskId, keyDay);
    const entry = assignments[cellKey] || {};
    const previousWorkers = assignmentWorkers(entry);
    // Sacar a alguien que venia de una regla predefinida no basta con quitarlo
    // de la lista: hay que anotarlo como quitado o la regla lo repone sola.
    const removedDefaults = defaultWorkersForCell(task, keyDay, shift)
        .filter(worker => !nextWorkers.includes(worker));

    persistEntryOrDelete(assignments, cellKey, {
        workers: nextWorkers,
        note: entry.note || "",
        removedDefaults,
        // Misma invariante que en la fusion: cerrada y con gente dentro no es
        // un estado que la casilla sepa dibujar.
        closed: assignmentClosed(entry) && !nextWorkers.length,
        mergedNextTaskId: entry.mergedNextTaskId
    });

    saveWeekAssignments(assignments);
    publishTaskAssignmentChanges(uniqueValues([
        ...previousWorkers,
        ...nextWorkers,
        ...removedDefaults
    ]));
}

// Cerrar la casilla: esa tarea ese dia no va. Se lleva por delante a quien
// estuviera dentro -por eso quien pregunta avisa antes- y no hace falta anotar
// nada en `removedDefaults`: mientras este cerrada, las reglas de predefinido
// ni la miran. Al abrirla vuelven solas en el siguiente pintado.
function setCellClosed(shift, taskId, keyDay, closed) {
    const assignments = getWeekAssignments();
    const cellKey = assignmentKey(shift, taskId, keyDay);
    const entry = getCellEntry(assignments, shift, taskId, keyDay);

    if (assignmentClosed(entry) === Boolean(closed)) return false;

    const previousWorkers = assignmentWorkers(entry);

    persistEntryOrDelete(assignments, cellKey, {
        ...entry,
        workers: closed ? [] : previousWorkers,
        removedDefaults: closed ? [] : assignmentRemovedDefaults(entry),
        closed: Boolean(closed)
    });

    saveWeekAssignments(assignments);
    publishTaskAssignmentChanges(previousWorkers);
    return true;
}

function renderCellPickerMarkup(shift, taskId, keyDay) {
    const assignments = getWeekAssignments();
    const tasks = getTasks();
    const task = tasks.find(item => item.id === taskId);

    if (!task) return "";

    const title = mergedGroupTitle(assignments, shift, tasks, taskId, keyDay) ||
        task.title;
    const date = parseKey(keyDay);
    const entry = getCellEntry(assignments, shift, taskId, keyDay);
    const assigned = assignmentWorkers(entry);
    // Quien ya esta en OTRA tarea de este mismo turno y dia sigue siendo
    // elegible -mover gente entre tareas es normal- pero baja al final de la
    // lista y se pinta en ambar, para que no compita con quien esta libre.
    const candidates = candidateProfiles(
        shift,
        keyDay,
        selectedRoles,
        selectedProfessions
    )
        .filter(profile => !assigned.includes(profile.name))
        .map(profile => ({
            profile,
            otherTask: workerOtherTaskTitle(
                assignments,
                tasks,
                profile.name,
                shift,
                keyDay,
                taskId
            )
        }));
    const orderedCandidates = [
        ...candidates.filter(item => !item.otherTask),
        ...candidates.filter(item => item.otherTask)
    ];

    return `
        <div class="task-assignment-picker__head">
            <div>
                <strong>${escapeHTML(title)}</strong>
                <span>${escapeHTML(SHIFT_CONFIG[shift].shortLabel)} | ${escapeHTML(formatWeekday(date))} ${escapeHTML(formatShortDate(date))}</span>
            </div>
            <button class="task-assignment-picker__close" type="button" data-picker-close aria-label="Cerrar">&times;</button>
        </div>
        ${
            assigned.length
                ? `
                    <div class="task-assignment-picker__assigned">
                        ${assigned.map(name => `
                            <div class="task-assignment-picker__row">
                                ${renderWorkerAvatar(name)}
                                <span class="task-assignment-picker__name">${escapeHTML(name)}</span>
                                <button class="task-assignment-picker__remove" type="button" data-picker-remove="${escapeHTML(name)}" title="Quitar de la tarea" aria-label="Quitar de la tarea">&times;</button>
                            </div>
                        `).join("")}
                    </div>
                `
                : ""
        }
        <div class="task-assignment-picker__label">Disponibles</div>
        <div class="task-assignment-picker__list">
            ${
                orderedCandidates.length
                    ? orderedCandidates.map(({ profile, otherTask }) => {
                        const partial = partialShiftText(
                            profile.name,
                            keyDay,
                            shift
                        );

                        return `
                            <button class="task-assignment-picker__option${otherTask ? " task-assignment-picker__option--busy" : ""}" type="button" data-picker-add="${escapeHTML(profile.name)}">
                                ${renderWorkerAvatar(profile.name)}
                                <span>
                                    <strong>${escapeHTML(profile.name)}</strong>
                                    <small>${escapeHTML(profileProfession(profile))} | ${otherTask ? `Ya en ${escapeHTML(otherTask)}` : escapeHTML(profileShiftLabel(profile, keyDay))}${partial ? ` &middot; ${escapeHTML(partial)}` : ""}</small>
                                </span>
                            </button>
                        `;
                    }).join("")
                    : `<p class="task-assignment-picker__empty">Sin personal disponible para este turno.</p>`
            }
        </div>
        <div class="task-assignment-picker__foot">
            <button class="task-assignment-picker__more" type="button" data-picker-more>M&aacute;s opciones</button>
            <button class="task-assignment-picker__close-cell" type="button" data-picker-close-cell title="Esa tarea no va en este turno: la casilla deja de admitir gente y de contar como hueco">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <rect x="5" y="11" width="14" height="9" rx="2"></rect>
                    <path d="M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11"></path>
                </svg>
                Cerrar casilla
            </button>
        </div>
    `;
}

// El ancla es el BOTON "Asignar", no la casilla. Una casilla fusionada puede
// medir cientos de pixeles de alto, y anclar a su borde inferior mandaba el
// panel al fondo de la pagina, lejos de donde el supervisor hizo clic.
function positionCellPicker(anchor, node) {
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    let left = rect.left;

    if (left + width > window.innerWidth - margin) {
        left = rect.right - width;
    }
    if (left < margin) left = margin;

    let top = rect.bottom + 6;

    // Si abajo no cabe, se abre hacia arriba antes que salirse de la pantalla.
    if (top + height > window.innerHeight - margin) {
        const above = rect.top - height - 6;

        top = above >= margin
            ? above
            : Math.max(margin, window.innerHeight - height - margin);
    }

    node.style.left = `${Math.round(left)}px`;
    node.style.top = `${Math.round(top)}px`;
}

function bindCellPickerEvents(node, { shift, taskId, keyDay }) {
    const dismiss = () => {
        closeCellPicker();
        renderTaskAssignmentsPanel();
    };
    const workersNow = () => assignmentWorkers(
        getCellEntry(getWeekAssignments(), shift, taskId, keyDay)
    );

    node
        .querySelector("[data-picker-close]")
        ?.addEventListener("click", dismiss);

    node
        .querySelectorAll("[data-picker-add]")
        .forEach(button => {
            button.addEventListener("click", () => {
                const name = button.dataset.pickerAdd;
                const current = workersNow();

                if (current.includes(name)) return;

                setCellWorkers(shift, taskId, keyDay, [...current, name]);
                renderTaskAssignmentsPanel();
            });
        });

    node
        .querySelectorAll("[data-picker-remove]")
        .forEach(button => {
            button.addEventListener("click", () => {
                const name = button.dataset.pickerRemove;

                setCellWorkers(
                    shift,
                    taskId,
                    keyDay,
                    workersNow().filter(worker => worker !== name)
                );
                renderTaskAssignmentsPanel();
            });
        });

    node
        .querySelector("[data-picker-more]")
        ?.addEventListener("click", () => {
            closeCellPicker();
            openAssignmentDialog({ shift, taskId, keyDay });
            renderTaskAssignmentsPanel();
        });

    node
        .querySelector("[data-picker-close-cell]")
        ?.addEventListener("click", async () => {
            const current = workersNow();

            closeCellPicker();

            // Cerrar con gente dentro los saca de la casilla. Es lo que se
            // quiere -la tarea ese turno no va- pero no puede pasar de callado.
            if (
                current.length &&
                !await showConfirm(
                    current.length === 1
                        ? `${current[0]} queda fuera de esta casilla al cerrarla.`
                        : `Las ${current.length} personas asignadas quedan fuera de esta casilla al cerrarla.`,
                    {
                        title: "Cerrar casilla",
                        confirmText: "Cerrar igual",
                        tone: "warning"
                    }
                )
            ) {
                renderTaskAssignmentsPanel();
                return;
            }

            setCellClosed(shift, taskId, keyDay, true);
            renderTaskAssignmentsPanel();
        });

    const onPointerDown = event => {
        if (node.contains(event.target)) return;

        // El boton de la casilla alterna el panel por su cuenta. Si lo
        // cerraramos aqui, su click posterior lo volveria a abrir y nunca se
        // podria cerrar con el mismo boton que lo abrio.
        if (
            event.target instanceof Element &&
            event.target.closest("[data-cell-assign]")
        ) {
            return;
        }

        dismiss();
    };
    const onKeyDown = event => {
        if (event.key !== "Escape") return;
        dismiss();
    };
    // Al scrollear el tablero el panel dejaria de apuntar a su casilla, asi que
    // se cierra antes de quedar descolgado. El scroll de su PROPIA lista no
    // cuenta: en fase de captura tambien llega aqui, y cerraria el panel al
    // recorrer los candidatos.
    const onScroll = event => {
        if (event.target instanceof Node && node.contains(event.target)) return;
        dismiss();
    };

    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", onScroll, true);

    unbindCellPicker = () => {
        document.removeEventListener("mousedown", onPointerDown, true);
        document.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("resize", dismiss);
        window.removeEventListener("scroll", onScroll, true);
    };
}

function syncCellPicker(root) {
    destroyCellPickerNode();

    if (!openCellPicker) return;

    const { shift, taskId, keyDay } = openCellPicker;
    const cell = root.querySelector(
        `[data-task-cell="${taskId}"][data-shift="${shift}"][data-day="${keyDay}"]`
    );

    // Sin casilla -tarea borrada, semana cambiada-, con el panel oculto tras
    // un cambio de vista o bloqueada -por mantenimiento o cerrada a mano-, el
    // panel flotante no tiene a que anclarse.
    if (
        !cell ||
        !cell.getBoundingClientRect().width ||
        cell.dataset.cellBlocked === "true"
    ) {
        openCellPicker = null;
        return;
    }

    const markup = renderCellPickerMarkup(shift, taskId, keyDay);

    if (!markup) {
        openCellPicker = null;
        return;
    }

    const node = document.createElement("div");

    node.className = "task-assignment-picker";
    node.innerHTML = markup;
    document.body.appendChild(node);
    cellPickerNode = node;
    positionCellPicker(
        cell.querySelector("[data-cell-assign]") || cell,
        node
    );
    bindCellPickerEvents(node, { shift, taskId, keyDay });
}

function renderAssignmentCell(assignments, task, day, holidays, placement) {
    const keyDay = keyFromDate(day);
    const entry = getCellEntry(
        assignments,
        task.shift,
        task.id,
        keyDay
    );
    const assigned = assignmentWorkers(entry);
    const workers = assigned
        .map(profileName => renderWorkerChip(profileName, task, keyDay))
        .filter(Boolean);
    const { dayIndex, taskIndex, size } = placement;
    const outages = Array.isArray(placement.outages)
        ? placement.outages
        : [];
    const maintenanceBlocked = outages.length > 0;
    const closed = assignmentClosed(entry);
    // Las dos razones por las que una casilla no admite gente: el equipo en
    // mantenimiento y el cierre a mano. Lo que las mira -arrastrar, el selector
    // rapido- no necesita saber cual de las dos es.
    const blocked = maintenanceBlocked || closed;
    // Fila y columna explicitas: con una casilla que ocupa varias filas, dejar
    // que la grilla las acomode sola correria las de abajo de lugar.
    const area = `grid-column: ${dayIndex + 2}; grid-row: ${taskIndex + 2} / span ${size};`;
    // "Sin cubrir" mira la asignacion real, no la filtrada: los filtros de
    // estamento y profesion son de vista y no deben inventar huecos.
    const uncovered = !assigned.length;
    const picking = isCellPickerOpen(task.shift, task.id, keyDay);
    const classes = [
        "task-assignment-cell",
        size > 1 ? " task-assignment-cell--merged" : "",
        inhabilClass(day, holidays, "task-assignment-cell--inhabil"),
        uncovered && !blocked ? " task-assignment-cell--uncovered" : "",
        maintenanceBlocked ? " task-assignment-cell--maintenance" : "",
        closed ? " task-assignment-cell--closed" : "",
        picking ? " task-assignment-cell--picking" : "",
        onlyUncovered && (!uncovered || blocked) && !picking
            ? " task-assignment-cell--dimmed"
            : ""
    ].join("");

    return `
        <div class="${classes}" style="${area}" data-task-cell="${escapeHTML(task.id)}" data-shift="${escapeHTML(task.shift)}" data-day="${escapeHTML(keyDay)}" data-merge-size="${size}" ${blocked ? 'data-cell-blocked="true"' : ""} ${maintenanceBlocked ? 'data-maintenance-blocked="true"' : ""}>
            ${size > 1 ? `
                <span class="task-assignment-cell-tag">
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M9.5 14.5 14.5 9.5"></path>
                        <path d="M7 11 5 13a3.5 3.5 0 0 0 5 5l2-2"></path>
                        <path d="M17 13l2-2a3.5 3.5 0 0 0-5-5l-2 2"></path>
                    </svg>
                    Casillas unidas
                </span>
            ` : ""}
            <div class="task-assignment-cell-workers">
                ${workers.join("")}
            </div>
            ${renderTaskMaintenanceNote(outages)}
            ${closed ? renderClosedCellNote() : ""}
            <button class="task-assignment-add" type="button" data-cell-assign title="${blocked ? "Casilla cerrada: no admite trabajadores" : assigned.length ? "Agregar trabajadores" : "Asignar trabajadores"}" ${blocked ? "disabled" : ""}>
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M12 5.5v13"></path>
                    <path d="M5.5 12h13"></path>
                </svg>
                <span>${blocked ? "Cerrada" : assigned.length ? "Agregar" : "Asignar"}</span>
            </button>
            ${
                closed
                    ? `
                        <button class="task-assignment-reopen" type="button" data-cell-open title="Volver a abrir la casilla">
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <rect x="5" y="11" width="14" height="9" rx="2"></rect>
                                <path d="M8.5 11V7.8a3.5 3.5 0 0 1 6.8-1.2"></path>
                            </svg>
                            Abrir
                        </button>
                    `
                    : ""
            }
            ${entry.note ? `<p>${escapeHTML(entry.note)}</p>` : ""}
            ${renderMergePorts(task, keyDay, placement)}
        </div>
    `;
}

// El turno de la tarea, en la tarjeta: sol, luna, o los dos. Es tambien el
// boton para cambiarlo, porque si no la unica forma de devolver al otro
// tablero una tarea que se quito de ahi seria crearla de nuevo -y una tarea
// nueva nace con otro id, sin el historial de la que reemplaza.
function renderTaskShiftScopeButton(task) {
    const scope = taskShiftScope(task);
    const shifts = scope === GENERIC_TASK_SHIFT ? SHIFT_TYPES : [scope];
    const label = TASK_SHIFT_SCOPE_LABEL[scope];

    return `
        <button class="ghost-button task-assignment-task-shift task-assignment-task-shift--${escapeHTML(scope)}" type="button" data-task-shift-scope="${escapeHTML(task.id)}" title="${escapeHTML(label)} | Cambiar los turnos de la tarea" aria-label="${escapeHTML(label)}. Cambiar los turnos de la tarea">
            ${shifts.map(item => renderShiftIcon(item)).join("")}
        </button>
    `;
}

function renderTaskControl(task) {
    return `
        <div class="task-assignment-task-card" draggable="true" data-task-drag="${escapeHTML(task.id)}" data-shift="${escapeHTML(task.shift)}">
            <div class="task-assignment-task-card__top">
                <span class="task-assignment-drag" aria-hidden="true">::</span>
                <span class="task-assignment-task-actions">
                    ${renderTaskShiftScopeButton(task)}
                    <button class="ghost-button task-assignment-delete" type="button" data-task-delete="${escapeHTML(task.id)}" data-task-delete-shift="${escapeHTML(task.shift)}" title="Eliminar tarea">
                        &times;
                    </button>
                </span>
            </div>
            <input type="text" value="${escapeHTML(task.title)}" data-task-title="${escapeHTML(task.id)}" aria-label="Nombre de tarea">
            <input class="task-assignment-task-detail" type="text" maxlength="${TASK_DETAIL_MAX_LENGTH}" value="${escapeHTML(taskDetailForShift(task, task.shift))}" data-task-detail="${escapeHTML(task.id)}" data-task-detail-shift="${escapeHTML(task.shift)}" placeholder="Detalle" aria-label="Detalle de tarea">
        </div>
    `;
}

function taskForShift(task, shift) {
    return {
        ...task,
        shift
    };
}

// Al crear la tarea hay que decir en que turnos va. Sale marcado "Ambos", que
// es lo que hacian todas hasta ahora: quien no se fije en el selector obtiene
// exactamente la tarea de siempre.
function renderTaskScopeChoice() {
    const options = [
        { value: GENERIC_TASK_SHIFT, label: "Ambos", hint: "En los dos tableros" },
        { value: "day", label: "D&iacute;a", hint: "Solo en tareas diurnas" },
        { value: "night", label: "Noche", hint: "Solo en tareas de noche" }
    ];

    return `
        <div class="task-assignment-scope-choice" role="radiogroup" aria-label="Turnos de la tarea nueva">
            ${options.map(option => `
                <label class="task-assignment-scope-option" title="${option.hint}">
                    <input type="radio" name="shiftScope" value="${escapeHTML(option.value)}" ${option.value === GENERIC_TASK_SHIFT ? "checked" : ""}>
                    <span>${option.label}</span>
                </label>
            `).join("")}
        </div>
    `;
}

function renderTaskAddForm() {
    return `
        <form class="task-assignment-global-task-form" data-task-add-form autocomplete="off">
            <div class="task-assignment-task-form">
                <svg class="task-assignment-task-form__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M12 5.5v13"></path>
                    <path d="M5.5 12h13"></path>
                </svg>
                <input name="title" type="text" maxlength="80" placeholder="Nueva tarea (ej: Revisar insumos)" aria-label="Nueva tarea">
                ${renderTaskScopeChoice()}
                <button class="task-assignment-task-add" type="submit">Agregar</button>
            </div>
        </form>
    `;
}


// Permisos, ausencias y cumpleanos del dia, agrupados por motivo. En el
// encabezado interesa el motivo y cuanta gente, no la lista de nombres: los
// nombres siguen completos en la fila de Novedades.
function dayFlags(day) {
    const absences = new Map();

    absenceProfiles(day).forEach(item => {
        absences.set(item.label, (absences.get(item.label) || 0) + 1);
    });

    const flags = [...absences.entries()].map(([label, count]) => ({
        kind: "absence",
        label,
        count
    }));
    const birthdays = birthdayProfiles(day).length;

    if (birthdays) {
        flags.push({
            kind: "birthday",
            label: "Cumpleaños",
            count: birthdays
        });
    }

    return flags;
}

function renderDayFlags(day) {
    const flags = dayFlags(day);

    if (!flags.length) return "";

    const shown = flags.slice(0, 2);
    const rest = flags.length - shown.length;

    return `
        <div class="task-assignment-day-flags">
            ${shown.map(flag => `
                <span class="task-assignment-day-flag task-assignment-day-flag--${escapeHTML(flag.kind)}" title="${escapeHTML(flag.label)}">
                    ${escapeHTML(flag.label)}${flag.count > 1 ? ` ${flag.count}` : ""}
                </span>
            `).join("")}
            ${rest > 0 ? `<span class="task-assignment-day-flag task-assignment-day-flag--rest">+${rest}</span>` : ""}
        </div>
    `;
}

// La barra fina bajo la fecha es la cobertura del turno ese dia: cuantas
// casillas de la columna tienen a alguien. Es lo que el supervisor busca de un
// vistazo antes de mirar casilla por casilla.
function renderDayHead(day, column, holidays, dayIndex, withFlags) {
    const percent = column.total
        ? Math.round((column.done / column.total) * 100)
        : 0;
    const level = percent >= 100
        ? "full"
        : (percent >= 60 ? "mid" : "low");

    return `
        <div class="task-assignment-day-head${inhabilClass(day, holidays, "task-assignment-day-head--inhabil")}" style="grid-column: ${dayIndex + 2}; grid-row: 1;">
            <div class="task-assignment-day-head__top">
                <strong>${escapeHTML(formatWeekdayShort(day))}</strong>
                <span>${escapeHTML(formatShortDate(day))}</span>
                <em class="task-assignment-day-percent task-assignment-day-percent--${level}">${percent}%</em>
            </div>
            <div class="task-assignment-day-meter task-assignment-day-meter--${level}">
                <span style="width: ${percent}%;"></span>
            </div>
            ${withFlags ? renderDayFlags(day) : ""}
        </div>
    `;
}

function renderShiftIcon(shift) {
    if (shift === "night") {
        return `
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.4 8.4 0 1 0 20 14.5Z"></path>
            </svg>
        `;
    }

    return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="4"></circle>
            <path d="M12 2.5v2"></path>
            <path d="M12 19.5v2"></path>
            <path d="M4.2 4.2l1.4 1.4"></path>
            <path d="M18.4 18.4l1.4 1.4"></path>
            <path d="M2.5 12h2"></path>
            <path d="M19.5 12h2"></path>
            <path d="M4.2 19.8l1.4-1.4"></path>
            <path d="M18.4 5.6l1.4-1.4"></path>
        </svg>
    `;
}

// Quien esta de turno ese dia y no quedo en NINGUNA tarea. No es una tarea de
// verdad: es el resto, y se muestra para que nadie de turno desaparezca de la
// vista solo por no tener puesto asignado.
function unassignedOnShift(shift, keyDay, tasks, assignments) {
    const assigned = new Set();

    // Solo las tareas de ESTE tablero: una casilla que quedo escrita en el
    // turno que la tarea ya no tiene no puede dar por repartido a nadie.
    tasksForShift(tasks, shift).forEach(task => {
        assignmentWorkers(
            getCellEntry(assignments, shift, task.id, keyDay)
        ).forEach(name => assigned.add(name));
    });

    return getProfiles()
        .filter(isProfileActive)
        .filter(profile => profileMatchesFilters(
            profile,
            selectedRoles,
            selectedProfessions
        ))
        .filter(profile => !assigned.has(profile.name))
        .filter(profile => isAvailableForShift(profile, keyDay, shift))
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function renderBoard(shift, tasks, days, assignments, holidays = {}, equipmentOutages = []) {
    const config = SHIFT_CONFIG[shift];
    const sectionTasks = tasksForShift(tasks, shift)
        .map(task => taskForShift(task, shift));
    // Cada dia se agrupa por su cuenta: la misma tarea puede ir fusionada el
    // sabado y suelta el lunes.
    const columns = days.map(day => {
        const keyDay = keyFromDate(day);
        const groups = columnGroups(assignments, shift, tasks, keyDay);
        const owner = new Map();
        const covered = new Set();
        let done = 0;
        let total = 0;
        let people = 0;
        let uncovered = 0;

        groups.forEach(group => {
            owner.set(group.start, group);
            const groupOutages = outagesForTaskIdsDay(
                equipmentOutages,
                group.taskIds,
                day
            );

            for (let offset = 1; offset < group.taskIds.length; offset += 1) {
                covered.add(group.start + offset);
            }

            // La casilla fusionada cuenta por las filas que ocupa: si cubre dos
            // tareas, cubrir la casilla cubre las dos.
            const size = group.taskIds.length;
            const groupEntry = getCellEntry(
                assignments,
                shift,
                group.taskIds[0],
                keyDay
            );
            const workers = assignmentWorkers(groupEntry);

            total += size;
            people += workers.length;

            if (cellIsSettled(groupEntry, groupOutages)) {
                done += size;
            } else {
                uncovered += 1;
            }
        });

        return { day, owner, covered, done, total, people, uncovered };
    });
    const totals = columns.reduce(
        (sum, column) => ({
            people: sum.people + column.people,
            uncovered: sum.uncovered + column.uncovered
        }),
        { people: 0, uncovered: 0 }
    );
    const collapsed = Boolean(collapsedShifts[shift]);

    return `
        <section class="task-assignment-section task-assignment-section--${escapeHTML(config.className)}${collapsed ? " is-collapsed" : ""}">
            <div class="task-assignment-section-head">
                <button class="task-assignment-section-toggle" type="button" data-shift-toggle="${escapeHTML(shift)}" aria-expanded="${collapsed ? "false" : "true"}" title="${collapsed ? "Mostrar" : "Ocultar"} ${escapeHTML(config.label)}">
                    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                        <path d="M5 7.5 10 12.5 15 7.5"></path>
                    </svg>
                </button>
                <span class="task-assignment-section-icon">${renderShiftIcon(shift)}</span>
                <strong class="task-assignment-section-title">${escapeHTML(config.label)}</strong>
                <span class="task-assignment-section-metric">
                    ${sectionTasks.length} ${sectionTasks.length === 1 ? "tarea" : "tareas"} &middot; ${totals.people} ${totals.people === 1 ? "asignaci&oacute;n" : "asignaciones"}
                </span>
                ${
                    totals.uncovered
                        ? `
                            <button class="task-assignment-section-gap${onlyUncovered ? " is-on" : ""}" type="button" data-only-uncovered title="Ver solo las casillas sin cubrir">
                                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                    <circle cx="12" cy="12" r="9"></circle>
                                    <path d="M12 8v5"></path>
                                    <path d="M12 16.4h.01"></path>
                                </svg>
                                ${totals.uncovered} sin cubrir
                            </button>
                        `
                        : ""
                }
            </div>
            <div class="task-assignment-board"${collapsed ? " hidden" : ""}>
                <div class="task-assignment-task-head task-assignment-task-head--label" style="grid-column: 1; grid-row: 1;">
                    Tareas
                </div>
                ${columns.map((column, dayIndex) => renderDayHead(
                    column.day,
                    column,
                    holidays,
                    dayIndex,
                    shift === "day"
                )).join("")}
                ${
                    sectionTasks.length
                        ? sectionTasks.map((task, taskIndex) => `
                            <div class="task-assignment-task-cell" style="grid-column: 1; grid-row: ${taskIndex + 2};" data-task-drop="${escapeHTML(task.id)}" data-shift="${escapeHTML(shift)}">
                                ${renderTaskControl(task)}
                            </div>
                            ${columns.map((column, dayIndex) => {
                                if (column.covered.has(taskIndex)) return "";

                                const group = column.owner.get(taskIndex);
                                const size = group?.taskIds.length || 1;

                                return renderAssignmentCell(
                                    assignments,
                                    {
                                        ...task,
                                        lastTaskId: group
                                            ? group.taskIds[size - 1]
                                            : task.id
                                    },
                                    column.day,
                                    holidays,
                                    {
                                        dayIndex,
                                        taskIndex,
                                        size,
                                        taskCount: sectionTasks.length,
                                        outages: outagesForTaskIdsDay(
                                            equipmentOutages,
                                            group?.taskIds || [task.id],
                                            column.day
                                        )
                                    }
                                );
                            }).join("")}
                        `).join("")
                        : `
                            <div class="task-assignment-empty-row" style="grid-column: 1 / -1; grid-row: 2;">
                                Sin tareas registradas.
                            </div>
                        `
                }
            </div>
        </section>
    `;
}

function renderEventsBoard(days, holidays = {}) {
    return `
        <section class="task-assignment-events">
            <div class="task-assignment-section-head">
                <span class="task-assignment-section-icon task-assignment-section-icon--events">
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M12 3v3"></path>
                        <path d="M6 21h12a1 1 0 0 0 1-1v-6a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3v6a1 1 0 0 0 1 1Z"></path>
                        <path d="M5 16c1.6 0 1.6 1.4 3.2 1.4S9.8 16 11.4 16s1.6 1.4 3.2 1.4S16.2 16 17.8 16"></path>
                    </svg>
                </span>
                <strong class="task-assignment-section-title">Novedades de la semana</strong>
                <span class="task-assignment-section-metric">Permisos &middot; Ausencias &middot; Cumplea&ntilde;os</span>
            </div>
            <div class="task-assignment-events-grid">
                <div class="task-assignment-events-head">
                    Registros
                </div>
                ${days.map(day => {
                    const absences = absenceProfiles(day);
                    const birthdays = birthdayProfiles(day);

                    return `
                        <div class="task-assignment-event-day${inhabilClass(day, holidays, "task-assignment-event-day--inhabil")}">
                            <div class="task-assignment-event-date">
                                <strong>${escapeHTML(formatWeekdayShort(day))}</strong>
                                <span>${escapeHTML(formatShortDate(day))}</span>
                            </div>
                            <div class="task-assignment-event-list">
                                ${absences.map(item => `
                                    <span class="task-assignment-event task-assignment-event--absence">
                                        ${escapeHTML(item.profile.name)} | ${escapeHTML(item.label)}
                                    </span>
                                `).join("")}
                                ${birthdays.map(profile => `
                                    <span class="task-assignment-event task-assignment-event--birthday">
                                        ${escapeHTML(profile.name)} | Cumplea&ntilde;os
                                    </span>
                                `).join("")}
                                ${!absences.length && !birthdays.length ? `<span class="task-assignment-event-empty">Sin registros</span>` : ""}
                            </div>
                        </div>
                    `;
                }).join("")}
            </div>
        </section>
    `;
}

const MONTH_LABELS = [
    "ene", "feb", "mar", "abr", "may", "jun",
    "jul", "ago", "sep", "oct", "nov", "dic"
];

// El rango de la semana es el dato que ordena todo el panel, asi que se escribe
// entero: "24 - 30 ago 2026", y con los dos meses cuando la semana los cruza.
function weekRangeLabel(days) {
    const first = days[0];
    const last = days[days.length - 1];

    if (first.getMonth() === last.getMonth()) {
        return `${first.getDate()} - ${last.getDate()} ${MONTH_LABELS[first.getMonth()]} ${first.getFullYear()}`;
    }

    return `${first.getDate()} ${MONTH_LABELS[first.getMonth()]} - ${last.getDate()} ${MONTH_LABELS[last.getMonth()]} ${last.getFullYear()}`;
}

function isCurrentWeek() {
    return weekKey(currentWeekStart) === weekKey(weekStartMonday(new Date()));
}

// Numero de semana ISO: la semana 1 es la que contiene el primer jueves del
// anio. Va sobre el rango de fechas para no repetirlo con otras palabras.
function isoWeekNumber(date) {
    const thursdayOf = value => {
        const day = new Date(
            value.getFullYear(),
            value.getMonth(),
            value.getDate()
        );

        day.setDate(day.getDate() + 3 - ((day.getDay() + 6) % 7));
        return day;
    };
    const target = thursdayOf(date);
    const firstThursday = thursdayOf(new Date(target.getFullYear(), 0, 4));

    return 1 + Math.round(
        (target.getTime() - firstThursday.getTime()) / (7 * 86400000)
    );
}

function renderShell(holidays = {}) {
    const days = weekDays();
    const tasks = getTasks();
    const assignments = cleanAssignmentsForWeek(days, tasks);
    const equipmentOutages = equipmentOutagesForDays(days);
    const roles = availableRoles();
    const professions = availableProfessions();
    const current = isCurrentWeek();

    return `
        <div class="task-assignment-shell">
            <section class="task-assignment-topbar">
                <div class="task-assignment-identity">
                    <span class="task-assignment-identity__icon">
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <rect x="3" y="4" width="18" height="17" rx="3"></rect>
                            <path d="M8 2.5v4"></path>
                            <path d="M16 2.5v4"></path>
                            <path d="M3 9h18"></path>
                            <path d="m7 14 1.5 1.5L11 13"></path>
                            <path d="M13.5 14h3.5"></path>
                            <path d="M13.5 17h3.5"></path>
                        </svg>
                    </span>
                    <div>
                        <strong>Asignaci&oacute;n de Tareas</strong>
                        <span>${tasks.length} ${tasks.length === 1 ? "tarea" : "tareas"} &middot; 7 d&iacute;as</span>
                    </div>
                </div>

                <div class="task-assignment-weeknav">
                    <button class="task-assignment-weeknav__step" type="button" data-task-week-prev title="Semana anterior" aria-label="Semana anterior">
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="m14 6-6 6 6 6"></path>
                        </svg>
                    </button>
                    <div class="task-assignment-weeknav__label">
                        <span>Semana ${isoWeekNumber(days[0])}</span>
                        <strong>${escapeHTML(weekRangeLabel(days))}</strong>
                    </div>
                    <button class="task-assignment-weeknav__step" type="button" data-task-week-next title="Semana siguiente" aria-label="Semana siguiente">
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="m10 6 6 6-6 6"></path>
                        </svg>
                    </button>
                    <button class="task-assignment-weeknav__today${current ? " is-on" : ""}" type="button" data-task-week-current>Hoy</button>
                </div>

                <div class="task-assignment-topbar__actions">
                    <button class="task-assignment-action task-assignment-action--auto" type="button" data-task-auto-schedule title="Reparte a los que est&aacute;n de turno en las casillas vac&iacute;as, siguiendo lo que muestran las semanas anteriores">
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M12 3.2 13.6 8l4.8 1.6-4.8 1.6L12 16l-1.6-4.8L5.6 9.6 10.4 8Z"></path>
                            <path d="M18.4 15.2 19 17l1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6Z"></path>
                        </svg>
                        Programaci&oacute;n autom&aacute;tica
                    </button>
                    <button class="task-assignment-action" type="button" data-task-schedule-preview>Ver programaci&oacute;n</button>
                    <button class="task-assignment-action task-assignment-action--primary" type="button" data-task-export>
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M12 3v12"></path>
                            <path d="m7.5 10.5 4.5 4.5 4.5-4.5"></path>
                            <path d="M4 20h16"></path>
                        </svg>
                        Excel
                    </button>
                </div>
            </section>

            <section class="task-assignment-controls">
                <div class="task-assignment-view-filters">
                    ${renderMultiSelectFilter("taskRole", roles, selectedRoles, "roles", openTaskFilterGroup, "Estamentos")}
                    ${renderMultiSelectFilter("taskProfession", professions, selectedProfessions, "professions", openTaskFilterGroup, "Profesiones")}
                    <button class="task-assignment-gap-filter${onlyUncovered ? " is-on" : ""}" type="button" data-only-uncovered>
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z"></path>
                            <path d="M12 8v5"></path>
                            <path d="M12 16.4h.01"></path>
                        </svg>
                        Solo sin cubrir
                    </button>
                </div>
                ${renderTaskAddForm()}
            </section>
            ${renderEquipmentOutageBanner(equipmentOutages)}
            ${renderBoard("day", tasks, days, assignments, holidays, equipmentOutages)}
            ${renderBoard("night", tasks, days, assignments, holidays, equipmentOutages)}
            ${renderEventsBoard(days, holidays)}
        </div>
    `;
}

function addTask(title, shiftScope = GENERIC_TASK_SHIFT) {
    const cleanTitle = String(title || "").trim();

    if (!cleanTitle) return;

    const tasks = getTasks();
    const order = tasks.length;

    tasks.push({
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        shift: GENERIC_TASK_SHIFT,
        shiftScope: normalizeTaskShiftScope(shiftScope),
        title: cleanTitle,
        details: { day: "", night: "" },
        detail: "",
        order,
        createdAt: new Date().toISOString()
    });

    saveTasks(tasks);
    logTaskCatalogChange(
        "Creó una tarea",
        `"${cleanTitle}" (${TASK_SHIFT_SCOPE_LABEL[normalizeTaskShiftScope(shiftScope)] || "Diurno y noche"}).`
    );
}

function updateTaskTitle(taskId, title) {
    const cleanTitle = String(title || "").trim();

    if (!cleanTitle) return;

    const currentTask = getTasks().find(task => task.id === taskId);
    const affectedWorkers = currentTask
        ? [...taskWorkerNames(currentTask)]
        : [];

    saveTasks(
        getTasks().map(task =>
            task.id === taskId
                ? { ...task, title: cleanTitle }
                : task
        )
    );
    publishTaskAssignmentChanges(affectedWorkers);

    if (currentTask && currentTask.title !== cleanTitle) {
        logTaskCatalogChange(
            "Renombró una tarea",
            `"${currentTask.title}" pasó a llamarse "${cleanTitle}".`
        );
    }
}

function updateTaskDetail(taskId, shift, detail) {
    const cleanShift = shift === "night" ? "night" : "day";
    const cleanDetail = cleanTaskDetail(detail);
    const currentTask = getTasks().find(task => task.id === taskId);

    if (
        !currentTask ||
        taskDetailForShift(currentTask, cleanShift) === cleanDetail
    ) {
        return;
    }

    saveTasks(
        getTasks().map(task => {
            if (task.id !== taskId) return task;

            const details = {
                ...normalizeTaskDetails(task),
                [cleanShift]: cleanDetail
            };

            return { ...task, details, detail: details.day };
        })
    );
    logTaskCatalogChange(
        "Editó el detalle de una tarea",
        `"${currentTask.title}"${cleanShift === "night" ? " de noche" : ""}: ${cleanDetail ? `"${cleanDetail}"` : "sin detalle"}.`
    );
}

function workerDefaultRule(task, workerName) {
    return taskDefaultRules(task)
        .find(rule => rule.workerName === workerName) || null;
}

function taskWithDefaultWorkerRule(
    task,
    workerName,
    enabled,
    interval,
    anchorKeyDay,
    habilOnly = false
) {
    const defaultWorkerRules = normalizeTaskDefaultRules({
        defaultWorkers: [],
        defaultWorkerRules: [
            ...taskDefaultRules(task)
                .filter(rule => rule.workerName !== workerName),
            ...(enabled
                ? [{
                    workerName,
                    interval,
                    anchorKeyDay,
                    habilOnly: Boolean(habilOnly)
                }]
                : [])
        ]
    });

    return {
        ...task,
        defaultWorkerRules,
        defaultWorkers: uniqueValues(
            defaultWorkerRules.map(rule => rule.workerName)
        )
    };
}

function updateTaskDefaultWorkerRule(
    taskId,
    workerName,
    enabled,
    interval,
    anchorKeyDay,
    habilOnly = false
) {
    const cleanWorker = String(workerName || "").trim();

    if (!cleanWorker) return;

    const task = getTasks().find(item => item.id === taskId);
    const affectedWorkers = task
        ? [...taskWorkerNames(task), cleanWorker]
        : [cleanWorker];

    saveTasks(
        getTasks().map(task =>
            task.id === taskId
                ? taskWithDefaultWorkerRule(
                    task,
                    cleanWorker,
                    enabled,
                    interval,
                    anchorKeyDay,
                    habilOnly
                )
                : task
        )
    );
    publishTaskAssignmentChanges(affectedWorkers);

    if (task) {
        logTaskCatalogChange(
            "Cambió un trabajador predefinido",
            `${shortWorkerName(cleanWorker) || cleanWorker} ${enabled ? "queda como predefinido en" : "deja de ser predefinido en"} "${task.title}".`
        );
    }
}

function clearRemovedDefaultForCell(shift, taskId, keyDay, workerName) {
    const assignments = getWeekAssignments();
    const cellKey = assignmentKey(shift, taskId, keyDay);
    const entry = assignments[cellKey];

    if (!entry) return;

    const removedDefaults = assignmentRemovedDefaults(entry)
        .filter(name => name !== workerName);

    if (removedDefaults.length === assignmentRemovedDefaults(entry).length) {
        return;
    }

    persistEntryOrDelete(assignments, cellKey, {
        ...entry,
        removedDefaults
    });
    saveWeekAssignments(assignments);
    publishTaskAssignmentChanges([workerName]);
}

function syncWorkerDefaultForCurrentWeek(taskId, workerName, preserveKeyDay) {
    const task = getTasks().find(item => item.id === taskId);
    const assignments = getWeekAssignments();
    let changed = false;

    if (!task) return;

    SHIFT_TYPES.forEach(shift => {
        weekDays().forEach(day => {
            const keyDay = keyFromDate(day);

            if (keyDay === preserveKeyDay) return;

            const cellKey = assignmentKey(shift, task.id, keyDay);
            const entry = getCellEntry(
                assignments,
                shift,
                task.id,
                keyDay
            );
            const workers = assignmentWorkers(entry);
            const removedDefaults = assignmentRemovedDefaults(entry);
            const shouldApply = defaultWorkersForCell(task, keyDay, shift)
                .includes(workerName);
            const nextWorkers = shouldApply
                ? uniqueValues([...workers, workerName])
                : workers.filter(name => name !== workerName);
            const nextRemovedDefaults = shouldApply
                ? removedDefaults.filter(name => name !== workerName)
                : removedDefaults;

            if (
                nextWorkers.length === workers.length &&
                nextWorkers.every((name, index) => name === workers[index]) &&
                nextRemovedDefaults.length === removedDefaults.length &&
                nextRemovedDefaults.every((name, index) =>
                    name === removedDefaults[index]
                )
            ) return;

            persistEntryOrDelete(assignments, cellKey, {
                ...entry,
                workers: nextWorkers,
                removedDefaults: nextRemovedDefaults
            });
            changed = true;
        });
    });

    if (changed) saveWeekAssignments(assignments);
}

// Las periodicidades que se ofrecen dependen del turno de la tarea: en una
// tarea solo diurna "cada turno" es cada turno QUE LE TOQUE DE DIA -sus noches
// no entran en la cuenta-, y el rotulo tiene que decirlo. En una de solo noche
// no se ofrece la serie de turnos diurnos habiles, que ahi no aplica a nada.
function renderDefaultIntervalOptions(selectedValue, scope = GENERIC_TASK_SHIFT) {
    const selected = String(selectedValue || "1");
    const turno = scope === "day"
        ? { one: "Cada turno diurno", many: "turnos diurnos" }
        : (scope === "night"
            ? { one: "Cada turno de noche", many: "turnos de noche" }
            : { one: "Cada turno", many: "turnos" });
    const normalOptions = Array.from({ length: 10 }, (_item, index) => {
        const value = String(index + 1);
        const label = value === "1"
            ? turno.one
            : `Cada ${value} ${turno.many}`;

        return `
            <option value="${value}" ${value === selected ? "selected" : ""}>
                ${escapeHTML(label)}
            </option>
        `;
    });

    const habilOptions = scope === "night" ? [] : Array.from(
        { length: MAX_HABIL_INTERVAL },
        (_item, index) => {
            const n = index + 1;
            const value = `h${n}`;
            const label = n === 1
                ? "Cada turno diurno hábil"
                : `Cada ${n} turnos diurno hábil`;

            return `
                <option value="${value}" ${value === selected ? "selected" : ""}>
                    ${escapeHTML(label)}
                </option>
            `;
        }
    );

    return [...normalOptions, ...habilOptions].join("");
}

export function taskAssignmentFootprint(taskId, assignments, shift = "") {
    const all = assignments || getAllAssignments();
    const weeks = new Set();
    let cells = 0;
    let names = 0;

    Object.entries(all || {}).forEach(([week, cellsOfWeek]) => {
        Object.entries(cellsOfWeek || {}).forEach(([cellKey, entry]) => {
            const parts = splitAssignmentKey(cellKey);

            if (parts.taskId !== taskId) return;
            // Con turno, la cuenta es la de ESE tablero: es lo que se lleva
            // quitar la tarea de ahi y dejarla en el otro.
            if (shift && parts.shift !== shift) return;

            const cuantos = (entry?.workers || []).filter(Boolean).length;

            if (!cuantos) return;

            weeks.add(week);
            cells += 1;
            names += cuantos;
        });
    });

    return { names, cells, weeks: weeks.size };
}

function asignacionesLabel(count) {
    return count === 1 ? "1 asignacion" : `${count} asignaciones`;
}

function semanasLabel(count) {
    return count === 1 ? "1 semana" : `${count} semanas`;
}

// El texto del aviso. Aparte de la funcion que pregunta para poder probarlo sin
// DOM: la cifra es lo unico que evita que la X se apriete a ciegas.
export function taskDeleteWarning(title, footprint) {
    const nombre = String(title || "esta tarea").trim() || "esta tarea";

    if (!footprint.names) {
        return `"${nombre}" no tiene asignaciones. Se eliminara la tarea.`;
    }

    return `"${nombre}" tiene ${asignacionesLabel(footprint.names)} en ${semanasLabel(footprint.weeks)}. ` +
        "Si la eliminas se borran con ella, y no se pueden deshacer. " +
        "Si solo cambio de nombre, renombrala: asi conserva su historial.";
}

// La tarea que va en los DOS tableros no se puede borrar a secas: la X puede
// querer decir "esta tarea ya no va" o "de noche no se hace". El aviso dice
// cuanto se lleva cada salida, no solo el total.
export function taskShiftDeleteWarning(
    title,
    shift,
    footprint,
    shiftFootprint
) {
    const nombre = String(title || "esta tarea").trim() || "esta tarea";
    const turno = shift === "night" ? "las tareas de noche" : "las tareas diurnas";
    const soloEste = shiftFootprint.names
        ? `Quitarla de ${turno} borra ${asignacionesLabel(shiftFootprint.names)} de ese turno; en el otro sigue igual.`
        : `Quitarla de ${turno} no borra ninguna asignacion: ahi no hay nadie repartido.`;
    const ambos = footprint.names
        ? `Eliminarla en ambos se lleva ${asignacionesLabel(footprint.names)} en ${semanasLabel(footprint.weeks)}, y no se puede deshacer.`
        : "Eliminarla en ambos la saca del catalogo.";

    return `"${nombre}" esta en tareas diurnas y en tareas de noche. ` +
        `${soloEste} ${ambos} ` +
        "Si solo cambio de nombre, renombrala: asi conserva su historial.";
}

// El aviso del boton de turnos de la tarjeta. Dejarla en un solo turno la saca
// del otro tablero con todo lo repartido ahi, asi que las dos cifras tienen que
// estar a la vista ANTES de elegir.
export function taskShiftScopeMessage(title, scope, footprints) {
    const nombre = String(title || "esta tarea").trim() || "esta tarea";
    const actual = TASK_SHIFT_SCOPE_LABEL[scope] || TASK_SHIFT_SCOPE_LABEL.both;

    return `"${nombre}" va hoy en: ${actual.toLowerCase()}. ` +
        `Repartido en tareas diurnas: ${asignacionesLabel(footprints.day.names)}; ` +
        `en tareas de noche: ${asignacionesLabel(footprints.night.names)}. ` +
        "Dejarla en un solo turno borra lo repartido en el otro, y no se puede deshacer.";
}

function deleteTask(taskId) {
    const task = getTasks().find(item => item.id === taskId);
    const affectedWorkers = task ? [...taskWorkerNames(task)] : [];
    // La huella se mide ANTES: borrar la tarea se lleva sus casillas de todas las
    // semanas, y es lo que la bitacora tiene que poder contar despues. El
    // 2026-09-09 se borraron 18 tareas una a una y no quedo rastro de nada.
    const footprint = taskAssignmentFootprint(taskId, getAllAssignments());

    saveTasks(getTasks().filter(task => task.id !== taskId));

    const all = getAllAssignments();
    Object.keys(all).forEach(week => {
        Object.keys(all[week] || {}).forEach(cellKey => {
            if (splitAssignmentKey(cellKey).taskId === taskId) {
                delete all[week][cellKey];
            }
        });
    });
    setJSON(ASSIGNMENTS_KEY, all);
    publishTaskAssignmentChanges(affectedWorkers);

    if (task) {
        logTaskCatalogChange(
            "Eliminó una tarea",
            footprint.names
                ? `"${task.title}". Se borraron ${asignacionesLabel(footprint.names)} en ${semanasLabel(footprint.weeks)}.`
                : `"${task.title}". No tenía asignaciones.`,
            { removedAssignments: footprint.names, weeks: footprint.weeks }
        );
    }
}

// Cambiar en que turnos va la tarea. Salir de un tablero SE LLEVA las casillas
// de ese turno -no hay donde dibujarlas- y por eso quien pregunta tiene que
// avisar antes cuanta gente hay repartida ahi. Las del otro turno no se tocan:
// la tarea es la misma, con su id y su historial.
function setTaskShiftScope(taskId, nextScope) {
    const tasks = getTasks();
    const task = tasks.find(item => item.id === taskId);
    const scope = normalizeTaskShiftScope(nextScope);

    if (!task || taskShiftScope(task) === scope) return false;

    const dropped = SHIFT_TYPES.filter(shift =>
        taskAppliesToShift(task, shift) &&
        !taskAppliesToShift({ shiftScope: scope }, shift)
    );
    const affectedWorkers = [...taskWorkerNames(task)];
    // Lo que se va a llevar, medido ANTES de borrarlo.
    const droppedNames = dropped.reduce(
        (total, shift) =>
            total + taskAssignmentFootprint(taskId, getAllAssignments(), shift).names,
        0
    );

    saveTasks(tasks.map(item =>
        item.id === taskId
            ? { ...item, shiftScope: scope }
            : item
    ));

    if (dropped.length) {
        const all = getAllAssignments();

        Object.keys(all).forEach(week => {
            Object.keys(all[week] || {}).forEach(cellKey => {
                const parts = splitAssignmentKey(cellKey);

                if (
                    parts.taskId === taskId &&
                    dropped.includes(parts.shift)
                ) {
                    delete all[week][cellKey];
                }
            });
        });
        setJSON(ASSIGNMENTS_KEY, all);
    }

    publishTaskAssignmentChanges(affectedWorkers);
    logTaskCatalogChange(
        "Cambió el turno de una tarea",
        `"${task.title}": ${TASK_SHIFT_SCOPE_LABEL[taskShiftScope(task)] || "Diurno y noche"} → ${TASK_SHIFT_SCOPE_LABEL[scope] || scope}.` +
            (droppedNames ? ` Se borraron ${asignacionesLabel(droppedNames)}.` : "")
    );
    return true;
}

function removeTaskFromShift(taskId, shift) {
    return setTaskShiftScope(taskId, oppositeShift(shift));
}

function reorderTask(draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return;

    const tasks = getTasks();
    const from = tasks.findIndex(task => task.id === draggedId);
    const to = tasks.findIndex(task => task.id === targetId);

    if (from === -1 || to === -1) return;

    const [moved] = tasks.splice(from, 1);
    tasks.splice(to, 0, moved);
    saveTasks(tasks);
    publishTaskAssignmentChanges();
    // Reordenar puede deshacer combinaciones: la fusion enlaza cada casilla con
    // la tarea de ABAJO por id, y si abajo queda otra, el saneado la separa.
    logTaskCatalogChange(
        "Cambió el orden de las tareas",
        `"${moved.title}" pasó al lugar ${to + 1} de ${tasks.length}.`
    );
}

function readDraggedWorker(event) {
    if (draggedWorker) return draggedWorker;

    const raw = event.dataTransfer?.getData(
        "application/x-proturnos-task-worker"
    );

    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);

        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

function canMoveWorkerToCell(cell, payload) {
    return Boolean(
        cell.dataset.cellBlocked !== "true" &&
        payload?.workerName &&
        payload?.shift === cell.dataset.shift &&
        payload?.keyDay === cell.dataset.day &&
        payload?.taskId !== cell.dataset.taskCell
    );
}

function persistEntryOrDelete(assignments, cellKey, entry) {
    const workers = assignmentWorkers(entry);
    const note = String(entry?.note || "").trim();
    const removedDefaults = assignmentRemovedDefaults(entry);
    // Una casilla fusionada sigue existiendo aunque este vacia: el enlace vive
    // en ella y borrarla desharia la fusion sola.
    const mergedNextTaskId = String(entry?.mergedNextTaskId || "");
    // Y una casilla CERRADA tambien: vacia es justo como tiene que estar, y si
    // se borrara el cierre se perderia en el siguiente pintado.
    const closed = assignmentClosed(entry);

    if (
        workers.length ||
        note ||
        removedDefaults.length ||
        mergedNextTaskId ||
        closed
    ) {
        assignments[cellKey] = {
            workers,
            note,
            removedDefaults,
            ...(closed ? { closed: true } : {}),
            ...(mergedNextTaskId ? { mergedNextTaskId } : {})
        };
        return;
    }

    delete assignments[cellKey];
}

function moveWorkerAssignment(payload, targetCell) {
    if (!canMoveWorkerToCell(targetCell, payload)) return false;

    const assignments = getWeekAssignments();
    const tasks = getTasks();
    const sourceTask = tasks.find(task => task.id === payload.taskId);
    const fromKey = assignmentKey(
        payload.shift,
        payload.taskId,
        payload.keyDay
    );
    const toKey = assignmentKey(
        targetCell.dataset.shift,
        targetCell.dataset.taskCell,
        targetCell.dataset.day
    );
    const fromEntry = getCellEntry(
        assignments,
        payload.shift,
        payload.taskId,
        payload.keyDay
    );
    const fromWorkers = assignmentWorkers(fromEntry);

    if (!fromWorkers.includes(payload.workerName)) return false;

    const toEntry = getCellEntry(
        assignments,
        targetCell.dataset.shift,
        targetCell.dataset.taskCell,
        targetCell.dataset.day
    );
    const toWorkers = assignmentWorkers(toEntry);
    const sourceRemovedDefaults = assignmentRemovedDefaults(fromEntry);
    const sourceDefaults = sourceTask
        ? defaultWorkersForCell(sourceTask, payload.keyDay, payload.shift)
        : [];
    const nextSourceRemovedDefaults = sourceDefaults.includes(
        payload.workerName
    )
        ? uniqueValues([...sourceRemovedDefaults, payload.workerName])
        : sourceRemovedDefaults;

    persistEntryOrDelete(assignments, fromKey, {
        ...fromEntry,
        workers: fromWorkers.filter(name => name !== payload.workerName),
        removedDefaults: nextSourceRemovedDefaults
    });

    persistEntryOrDelete(assignments, toKey, {
        ...toEntry,
        workers: toWorkers.includes(payload.workerName)
            ? toWorkers
            : [...toWorkers, payload.workerName],
        removedDefaults: assignmentRemovedDefaults(toEntry)
            .filter(name => name !== payload.workerName)
    });

    saveWeekAssignments(assignments);
    publishTaskAssignmentChanges([payload.workerName]);
    return true;
}

function openWorkerDefaultDialog({ taskId, workerName, shift, keyDay }) {
    const task = getTasks().find(item => item.id === taskId);
    const cleanWorker = String(workerName || "").trim();

    if (!task || !cleanWorker) return;

    const date = parseKey(keyDay);
    const rule = workerDefaultRule(task, cleanWorker);
    const backdrop = document.createElement("div");
    const close = () => backdrop.remove();

    backdrop.className = "task-assignment-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="task-assignment-dialog task-assignment-worker-default-dialog">
            <div class="task-assignment-dialog__head">
                <div>
                    <h3>${escapeHTML(cleanWorker)}</h3>
                    <span>${escapeHTML(task.title)} | ${escapeHTML(formatWeekday(date))} ${escapeHTML(formatShortDate(date))}</span>
                </div>
                <button class="icon-button" type="button" data-dialog-close aria-label="Cerrar">&times;</button>
            </div>
            <label class="task-assignment-worker-default-toggle">
                <input type="checkbox" data-worker-default-enabled checked>
                <span>Predefinido para esta tarea</span>
            </label>
            <label class="task-assignment-worker-default-field">
                <span>Periodicidad</span>
                <select data-worker-default-interval>
                    ${renderDefaultIntervalOptions(
                        encodeIntervalValue(rule?.interval || 1, rule?.habilOnly === true),
                        taskShiftScope(task)
                    )}
                </select>
            </label>
            <div class="task-assignment-dialog__actions">
                <button class="secondary-button" type="button" data-dialog-cancel>Cancelar</button>
                <button class="primary-button" type="button" data-dialog-save>Guardar</button>
            </div>
        </section>
    `;

    document.body.appendChild(backdrop);

    const enabledInput = backdrop.querySelector("[data-worker-default-enabled]");
    const intervalSelect = backdrop.querySelector("[data-worker-default-interval]");
    const syncState = () => {
        intervalSelect.disabled = !enabledInput.checked;
    };

    enabledInput.addEventListener("change", syncState);
    syncState();

    backdrop.querySelector("[data-dialog-close]")?.addEventListener("click", close);
    backdrop.querySelector("[data-dialog-cancel]")?.addEventListener("click", close);
    backdrop.querySelector("[data-dialog-save]")?.addEventListener("click", () => {
        const parsedInterval = parseIntervalValue(intervalSelect.value);

        updateTaskDefaultWorkerRule(
            task.id,
            cleanWorker,
            enabledInput.checked,
            parsedInterval.interval,
            keyDay,
            parsedInterval.habilOnly
        );
        syncWorkerDefaultForCurrentWeek(task.id, cleanWorker, keyDay);

        if (enabledInput.checked) {
            clearRemovedDefaultForCell(
                shift,
                task.id,
                keyDay,
                cleanWorker
            );
        }

        close();
        renderTaskAssignmentsPanel();
    });
}


// Dos puntos se pueden unir solo si son de la misma columna y de casillas
// pegadas: uno tiene que ser el borde de abajo de una y el otro el borde de
// arriba de la que sigue en el catalogo. Da igual desde cual se arrastre.
// Del punto arrastrado a la casilla donde se suelta: se unen TODAS las filas
// del tramo, no solo las dos puntas. Da igual el sentido -hacia abajo o hacia
// arriba-, y si alguna punta ya era un grupo fusionado, el tramo se estira
// para cubrirlo entero en vez de partirlo.
function mergeRangeFor(from, to) {
    if (!from || !to) return null;
    if (from.shift !== to.shift || from.day !== to.day) return null;

    const tasks = tasksForShift(getTasks(), from.shift);
    const assignments = getWeekAssignments();
    const sourceIndex = tasks.findIndex(task => task.id === from.mergeTask);
    const targetIndex = tasks.findIndex(task => task.id === to.mergeTask);

    if (sourceIndex === -1 || targetIndex === -1) return null;

    const spanOf = index => {
        const group = groupForTask(
            assignments,
            from.shift,
            tasks,
            tasks[index].id,
            from.day
        );

        if (!group) return { start: index, end: index };

        return {
            start: group.start,
            end: group.start + group.taskIds.length - 1
        };
    };
    const source = spanOf(sourceIndex);
    const target = spanOf(targetIndex);
    const startIndex = Math.min(source.start, target.start);
    const endIndex = Math.max(source.end, target.end);

    // Soltar sobre la misma casilla no une nada...
    if (endIndex <= startIndex) return null;

    // ...y soltar dentro del grupo del que salio el punto, tampoco: el tramo
    // seria el que ya existe, y preguntar por eso solo confunde.
    if (source.start === target.start && source.end === target.end) return null;

    return {
        shift: from.shift,
        keyDay: from.day,
        startIndex,
        endIndex,
        count: endIndex - startIndex + 1
    };
}

async function confirmMergeCells(range) {
    if (!range) return;

    const message = range.count > 2
        ? `Las ${range.count} casillas del tramo quedaran unidas y compartiran los mismos trabajadores.`
        : "Las dos casillas quedaran unidas y compartiran los mismos trabajadores.";

    if (
        !await showConfirm(message, {
            title: "Combinar casillas",
            confirmText: "Combinar"
        })
    ) {
        return;
    }

    if (
        mergeCellRange(
            range.shift,
            range.keyDay,
            range.startIndex,
            range.endIndex
        )
    ) {
        renderTaskAssignmentsPanel();
    }
}

async function confirmSplitCells(shift, keyDay, taskId) {
    if (
        !await showConfirm(
            "Las casillas se separaran y todos los trabajadores quedaran en la de arriba.",
            {
                title: "Separar casillas",
                confirmText: "Separar"
            }
        )
    ) {
        return;
    }

    if (splitCellGroup(shift, keyDay, taskId)) {
        renderTaskAssignmentsPanel();
    }
}

// La casilla entera es el blanco. Con un solo punto ya no hay que probar dos
// bordes: el tramo se deduce de la fila donde se suelta.
function mergeRangeForCell(cell) {
    return mergeRangeFor(draggedMergePort, {
        shift: cell.dataset.shift,
        day: cell.dataset.day,
        mergeTask: cell.dataset.taskCell
    });
}

function bindMergeEvents(root) {
    root
        .querySelectorAll("[data-merge-port]")
        .forEach(port => {
            port.ondragstart = event => {
                // El chip de trabajador y la tarjeta de tarea tambien son
                // arrastrables: sin esto el gesto lo tomaria la de mas afuera.
                event.stopPropagation();
                draggedMergePort = { ...port.dataset };
                event.dataTransfer.effectAllowed = "link";
                event.dataTransfer.setData("text/plain", "merge-port");
                port.classList.add("is-dragging");
            };
            port.ondragend = () => {
                draggedMergePort = null;
                port.classList.remove("is-dragging");
                root
                    .querySelectorAll(".is-merge-target")
                    .forEach(node => node.classList.remove("is-merge-target"));
            };
            port.ondragover = event => {
                if (!mergeRangeFor(draggedMergePort, port.dataset)) return;

                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "link";
                port.classList.add("is-merge-target");
            };
            port.ondragleave = () => {
                port.classList.remove("is-merge-target");
            };
            port.ondrop = event => {
                const range = mergeRangeFor(draggedMergePort, port.dataset);

                port.classList.remove("is-merge-target");

                if (!range) return;

                event.preventDefault();
                event.stopPropagation();
                draggedMergePort = null;
                void confirmMergeCells(range);
            };
        });

    root
        .querySelectorAll("[data-merge-split]")
        .forEach(line => {
            line.onclick = () => {
                void confirmSplitCells(
                    line.dataset.shift,
                    line.dataset.day,
                    line.dataset.mergeSplit
                );
            };
        });
}

function bindShellEvents(root) {
    const roleOptions = availableRoles();
    const professionOptions = availableProfessions();

    root.querySelector("[data-task-week-prev]")?.addEventListener("click", () => {
        currentWeekStart = addDays(currentWeekStart, -7);
        renderTaskAssignmentsPanel();
    });
    root.querySelector("[data-task-week-next]")?.addEventListener("click", () => {
        currentWeekStart = addDays(currentWeekStart, 7);
        renderTaskAssignmentsPanel();
    });
    root.querySelector("[data-task-week-current]")?.addEventListener("click", () => {
        currentWeekStart = weekStartMonday(new Date());
        renderTaskAssignmentsPanel();
    });
    root
        .querySelectorAll("[data-shift-toggle]")
        .forEach(button => {
            button.addEventListener("click", () => {
                const shift = button.dataset.shiftToggle;

                collapsedShifts = {
                    ...collapsedShifts,
                    [shift]: !collapsedShifts[shift]
                };
                closeCellPicker();
                renderTaskAssignmentsPanel();
            });
        });

    root
        .querySelectorAll("[data-only-uncovered]")
        .forEach(button => {
            button.addEventListener("click", () => {
                onlyUncovered = !onlyUncovered;
                closeCellPicker();
                renderTaskAssignmentsPanel();
            });
        });

    bindMergeEvents(root);
    root
        .querySelector("[data-task-auto-schedule]")
        ?.addEventListener("click", async event => {
            const button = event.currentTarget;

            // El reparto recorre los 7 dias y los dos turnos: sin bloquear el
            // boton, un doble clic lanza dos veces el mismo dialogo.
            if (button.disabled) return;

            button.disabled = true;
            try {
                await runTaskAutoSchedule();
            } finally {
                button.disabled = false;
            }
        });
    root.querySelector("[data-task-export]")?.addEventListener("click", exportTaskAssignmentsExcel);
    root.querySelector("[data-task-schedule-preview]")?.addEventListener("click", async () => {
        const { openTaskSchedulePreview } = await import("./taskSchedulePreview.js");

        openTaskSchedulePreview();
    });

    root
        .querySelectorAll("[data-task-add-form]")
        .forEach(form => {
            form.onsubmit = event => {
                const data = new FormData(form);

                event.preventDefault();
                addTask(data.get("title"), data.get("shiftScope"));
                renderTaskAssignmentsPanel();
            };
        });

    root
        .querySelectorAll("[data-task-title]")
        .forEach(input => {
            input.onchange = () => {
                updateTaskTitle(input.dataset.taskTitle, input.value);
                renderTaskAssignmentsPanel();
            };
        });

    root
        .querySelectorAll("[data-task-detail]")
        .forEach(input => {
            input.onchange = () => {
                updateTaskDetail(
                    input.dataset.taskDetail,
                    input.dataset.taskDetailShift,
                    input.value
                );
                input.value = cleanTaskDetail(input.value);
            };
        });

    root
        .querySelectorAll("[data-task-delete]")
        .forEach(button => {
            button.onclick = async () => {
                const taskId = button.dataset.taskDelete;
                const task = getTasks().find(item => item.id === taskId);

                if (!task) return;

                const all = getAllAssignments();
                const footprint = taskAssignmentFootprint(taskId, all);
                // La X se aprieta desde UN tablero. Si la tarea esta en los
                // dos, borrarla entera no es lo unico que se puede querer: casi
                // siempre lo que sobra es la tarea en ESE turno.
                const shift = button.dataset.taskDeleteShift === "night"
                    ? "night"
                    : "day";
                const enAmbos = taskShiftScope(task) === GENERIC_TASK_SHIFT;
                const shiftFootprint = taskAssignmentFootprint(
                    taskId,
                    all,
                    shift
                );
                // Borrar y volver a crear con el mismo nombre parece un
                // renombre y no lo es: la tarea nueva nace con otro id y las
                // semanas pasadas quedan apuntando a una que ya no existe. Por
                // eso el nombre viene editable, para que renombrar sea el
                // camino corto y borrar el que cuesta.
                const answer = await showPrompt(
                    enAmbos
                        ? taskShiftDeleteWarning(
                            task.title,
                            shift,
                            footprint,
                            shiftFootprint
                        )
                        : taskDeleteWarning(task.title, footprint),
                    {
                        title: "Eliminar tarea",
                        tone: "danger",
                        inputLabel: "Nombre de la tarea",
                        value: task.title,
                        confirmText: "Renombrar",
                        cancelText: "Cancelar",
                        extraActions: [
                            ...(enAmbos
                                ? [{
                                    text: shift === "night"
                                        ? "Quitar de tareas de noche"
                                        : "Quitar de tareas diurnas",
                                    value: "delete-shift",
                                    tone: "danger"
                                }]
                                : []),
                            {
                                text: enAmbos ? "Eliminar en ambos" : "Eliminar igual",
                                value: "delete",
                                tone: "danger"
                            }
                        ]
                    }
                );

                if (!answer || answer.action === "cancel") return;

                if (answer.action === "delete-shift") {
                    removeTaskFromShift(taskId, shift);
                    renderTaskAssignmentsPanel();
                    return;
                }

                if (answer.action === "delete") {
                    deleteTask(taskId);
                    renderTaskAssignmentsPanel();
                    return;
                }

                const nuevo = String(answer.value || "").trim();

                if (!nuevo || nuevo === task.title) return;

                updateTaskTitle(taskId, nuevo);
                renderTaskAssignmentsPanel();
            };
        });

    root
        .querySelectorAll("[data-task-shift-scope]")
        .forEach(button => {
            button.onclick = async () => {
                const taskId = button.dataset.taskShiftScope;
                const task = getTasks().find(item => item.id === taskId);

                if (!task) return;

                const all = getAllAssignments();
                const answer = await showConfirm(
                    taskShiftScopeMessage(task.title, taskShiftScope(task), {
                        day: taskAssignmentFootprint(taskId, all, "day"),
                        night: taskAssignmentFootprint(taskId, all, "night")
                    }),
                    {
                        title: "Turnos de la tarea",
                        tone: "warning",
                        confirmText: "Diurno y noche",
                        cancelText: "Cancelar",
                        extraActions: [
                            { text: "Solo diurno", value: "day", tone: "danger" },
                            { text: "Solo noche", value: "night", tone: "danger" }
                        ]
                    }
                );

                if (!answer || answer.action === "cancel") return;

                const scope = answer.action === "confirm"
                    ? GENERIC_TASK_SHIFT
                    : answer.action;

                if (setTaskShiftScope(taskId, scope)) {
                    renderTaskAssignmentsPanel();
                }
            };
        });

    root
        .querySelectorAll(".task-assignment-multiselect[data-filter-group]")
        .forEach(control => {
            syncMultiSelectSelectAll(control);
            control.addEventListener("toggle", () => {
                if (control.open) {
                    openTaskFilterGroup = control.dataset.filterGroup;
                } else if (
                    openTaskFilterGroup === control.dataset.filterGroup
                ) {
                    openTaskFilterGroup = "";
                }
            });
        });

    if (unbindTaskFilterOutside) {
        unbindTaskFilterOutside();
    }
    unbindTaskFilterOutside = bindMultiSelectOutsideClose(
        root,
        () => {
            openTaskFilterGroup = "";
        }
    );

    root
        .querySelectorAll("[data-task-drag]")
        .forEach(card => {
            card.ondragstart = event => {
                draggedWorker = null;
                draggedTask = {
                    id: card.dataset.taskDrag,
                    shift: card.dataset.shift
                };
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", draggedTask.id);
            };
            card.ondragend = () => {
                draggedTask = null;
            };
        });

    root
        .querySelectorAll("[data-task-drop]")
        .forEach(target => {
            target.ondragover = event => {
                if (
                    !draggedTask ||
                    draggedTask.shift !== target.dataset.shift
                ) {
                    return;
                }

                event.preventDefault();
                target.classList.add("is-drag-over");
            };
            target.ondragleave = () => {
                target.classList.remove("is-drag-over");
            };
            target.ondrop = event => {
                if (
                    !draggedTask ||
                    draggedTask.shift !== target.dataset.shift
                ) {
                    return;
                }

                event.preventDefault();
                target.classList.remove("is-drag-over");
                reorderTask(
                    draggedTask?.id || event.dataTransfer.getData("text/plain"),
                    target.dataset.taskDrop
                );
                renderTaskAssignmentsPanel();
            };
        });

    root
        .querySelectorAll("[data-worker-drag]")
        .forEach(chip => {
            chip.ondragstart = event => {
                if (
                    event.target instanceof Element &&
                    event.target.closest("[data-worker-default-config]")
                ) {
                    event.preventDefault();
                    return;
                }

                draggedTask = null;
                draggedWorker = {
                    workerName: chip.dataset.workerDrag,
                    taskId: chip.dataset.workerTask,
                    shift: chip.dataset.workerShift,
                    keyDay: chip.dataset.workerDay
                };
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                    "application/x-proturnos-task-worker",
                    JSON.stringify(draggedWorker)
                );
                event.dataTransfer.setData(
                    "text/plain",
                    draggedWorker.workerName
                );
                chip.classList.add("is-dragging");
            };
            chip.ondragend = () => {
                chip.classList.remove("is-dragging");
                draggedWorker = null;
            };
        });

    root
        .querySelectorAll("[data-worker-default-config]")
        .forEach(button => {
            button.addEventListener("click", event => {
                event.preventDefault();
                event.stopPropagation();
                openWorkerDefaultDialog({
                    workerName: button.dataset.workerDefaultConfig,
                    taskId: button.dataset.workerTask,
                    shift: button.dataset.workerShift,
                    keyDay: button.dataset.workerDay
                });
            });
            button.addEventListener("dragstart", event => {
                event.preventDefault();
            });
        });

    root
        .querySelectorAll("[data-task-cell]")
        .forEach(cell => {
            // La casilla cerrada tiene su propio boton para volver a abrirla:
            // el de asignar esta deshabilitado, asi que desde ahi no se puede.
            cell.querySelector("[data-cell-open]")?.addEventListener(
                "click",
                event => {
                    event.stopPropagation();
                    setCellClosed(
                        cell.dataset.shift,
                        cell.dataset.taskCell,
                        cell.dataset.day,
                        false
                    );
                    renderTaskAssignmentsPanel();
                }
            );

            cell.querySelector("[data-cell-assign]")?.addEventListener(
                "click",
                event => {
                    event.stopPropagation();

                    if (
                        cell.dataset.cellBlocked === "true" ||
                        event.currentTarget.disabled
                    ) {
                        closeCellPicker();
                        return;
                    }

                    const target = {
                        shift: cell.dataset.shift,
                        taskId: cell.dataset.taskCell,
                        keyDay: cell.dataset.day
                    };
                    const wasOpen = isCellPickerOpen(
                        target.shift,
                        target.taskId,
                        target.keyDay
                    );

                    closeCellPicker();
                    if (!wasOpen) openCellPicker = target;
                    renderTaskAssignmentsPanel();
                }
            );
            cell.ondragover = event => {
                // El punto se comprueba PRIMERO: mientras se arrastra uno no
                // hay trabajador en vuelo, y acertarle al circulo solo seria
                // pedir demasiada punteria.
                if (draggedMergePort) {
                    if (!mergeRangeForCell(cell)) return;

                    event.preventDefault();
                    event.dataTransfer.dropEffect = "link";
                    cell.classList.add("is-merge-target");
                    return;
                }

                if (!canMoveWorkerToCell(cell, draggedWorker)) return;

                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                cell.classList.add("is-drag-over");
            };
            cell.ondragleave = () => {
                cell.classList.remove("is-drag-over");
                cell.classList.remove("is-merge-target");
            };
            cell.ondrop = event => {
                cell.classList.remove("is-merge-target");

                if (draggedMergePort) {
                    const range = mergeRangeForCell(cell);

                    if (!range) return;

                    event.preventDefault();
                    draggedMergePort = null;
                    void confirmMergeCells(range);
                    return;
                }

                const payload = readDraggedWorker(event);

                cell.classList.remove("is-drag-over");

                if (!canMoveWorkerToCell(cell, payload)) return;

                event.preventDefault();

                if (moveWorkerAssignment(payload, cell)) {
                    draggedWorker = null;
                    renderTaskAssignmentsPanel();
                }
            };
        });

    root
        .querySelector("[data-filter-group='roles']")
        ?.addEventListener("change", event => {
            handleMultiSelectSelectAllChange(event);
            openTaskFilterGroup = "roles";
            selectedRoles = selectedValues(
                root,
                "[name='taskRole']",
                roleOptions
            );
            renderTaskAssignmentsPanel();
        });

    root
        .querySelector("[data-filter-group='professions']")
        ?.addEventListener("change", event => {
            handleMultiSelectSelectAllChange(event);
            openTaskFilterGroup = "professions";
            selectedProfessions = selectedValues(
                root,
                "[name='taskProfession']",
                professionOptions
            );
            renderTaskAssignmentsPanel();
        });
}

// Copia la asignacion recien guardada a los dias que quedan de la semana.
//
// Es deliberadamente conservadora: solo escribe donde no hay fusion -el grupo
// fusionado tiene su propia casilla duena y su propio criterio- y solo con las
// personas que ese dia estan realmente en el turno y sin permiso. Repetir a
// ciegas terminaria asignando a alguien que ese dia libra o esta con licencia.
function repeatAssignmentForWeek(
    assignments,
    tasks,
    shift,
    taskId,
    keyDay,
    workers
) {
    const days = weekDays();
    const startIndex = days.findIndex(day => keyFromDate(day) === keyDay);
    const task = tasks.find(item => item.id === taskId);

    if (startIndex < 0 || !task) return [];

    const touched = [];

    days.slice(startIndex + 1).forEach(day => {
        const nextKey = keyFromDate(day);
        const group = groupForTask(assignments, shift, tasks, taskId, nextKey);

        if (group && group.taskIds.length > 1) return;

        const available = workers.filter(name => {
            const profile = profileByName(name);

            return profile && isAvailableForShift(profile, nextKey, shift);
        });

        if (!available.length) return;

        const cellKey = assignmentKey(shift, taskId, nextKey);
        const entry = assignments[cellKey] || {};

        persistEntryOrDelete(assignments, cellKey, {
            workers: available,
            note: entry.note || "",
            removedDefaults: defaultWorkersForCell(task, nextKey, shift)
                .filter(worker => !available.includes(worker)),
            mergedNextTaskId: entry.mergedNextTaskId
        });
        touched.push(...available, ...assignmentWorkers(entry));
    });

    return touched;
}

// Cuando el candidato ya esta en otra tarea del mismo turno y dia, el nombre de
// esa tarea vale mas que un simple "ocupado": dice de donde habria que sacarlo.
function workerOtherTaskTitle(
    assignments,
    tasks,
    workerName,
    shift,
    keyDay,
    taskId
) {
    const hit = Object.entries(assignments).find(([cellKey, entry]) => {
        const parts = splitAssignmentKey(cellKey);

        return parts.shift === shift &&
            parts.keyDay === keyDay &&
            parts.taskId !== taskId &&
            assignmentWorkers(entry).includes(workerName);
    });

    if (!hit) return "";

    const otherId = splitAssignmentKey(hit[0]).taskId;

    return tasks.find(task => task.id === otherId)?.title || "En otra tarea";
}

function renderDialogCandidate(
    profile,
    assignments,
    shift,
    keyDay,
    taskId,
    selectedWorkers,
    tasks = getTasks()
) {
    const otherTask = workerOtherTaskTitle(
        assignments,
        tasks,
        profile.name,
        shift,
        keyDay,
        taskId
    );
    const checked = selectedWorkers.has(profile.name);
    const partial = partialShiftText(profile.name, keyDay, shift);

    return `
        <label class="task-assignment-candidate ${otherTask ? "is-busy" : "is-free"}${checked ? " is-checked" : ""}">
            <input type="checkbox" value="${escapeHTML(profile.name)}" ${checked ? "checked" : ""}>
            ${renderWorkerAvatar(profile.name)}
            <span>
                <strong>${escapeHTML(profile.name)}</strong>
                <small>${escapeHTML(profile.estamento || "Sin estamento")} | ${escapeHTML(profileProfession(profile))}</small>
            </span>
            <em class="task-assignment-candidate__state">${escapeHTML(otherTask || profileShiftLabel(profile, keyDay))}</em>
            ${partial ? `<em class="task-assignment-candidate__when">${escapeHTML(partial)}</em>` : ""}
        </label>
    `;
}

function mergedGroupTitle(assignments, shift, tasks, taskId, keyDay) {
    const group = groupForTask(assignments, shift, tasks, taskId, keyDay);

    if (!group || group.taskIds.length < 2) return "";

    return group.taskIds
        .map(id => tasks.find(task => task.id === id)?.title || "")
        .filter(Boolean)
        .join(" + ");
}

function openAssignmentDialog({ shift, taskId, keyDay }) {
    const tasks = getTasks();
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;

    const assignments = getWeekAssignments();
    const dialogTitle = mergedGroupTitle(
        assignments,
        shift,
        tasks,
        taskId,
        keyDay
    ) || task.title;
    const cellKey = assignmentKey(shift, taskId, keyDay);
    const entry = assignments[cellKey] || { workers: [], note: "" };
    const selectedWorkers = new Set(assignmentWorkers(entry));
    const professions = availableProfessions();
    let dialogProfessions = null;
    let openDialogFilterGroup = "";
    let unbindDialogFilterOutside = null;
    let workerSearch = "";
    let includeWorkersWithoutShift = false;
    let repeatRestOfWeek = false;
    let note = entry.note || "";
    const backdrop = document.createElement("div");

    backdrop.className = "task-assignment-dialog-backdrop";
    document.body.appendChild(backdrop);

    const close = () => {
        if (unbindDialogFilterOutside) {
            unbindDialogFilterOutside();
            unbindDialogFilterOutside = null;
        }
        backdrop.remove();
    };
    const collectDialogFilters = () => {
        dialogProfessions = selectedValues(
            backdrop,
            "[name='dialogTaskProfession']",
            professions
        );
    };
    const collectVisibleWorkers = () => {
        backdrop
            .querySelectorAll("[data-candidate-list] input")
            .forEach(input => {
                if (input.checked) {
                    selectedWorkers.add(input.value);
                } else {
                    selectedWorkers.delete(input.value);
                }
            });
        note = backdrop.querySelector("[data-task-note]")?.value || "";
        workerSearch = backdrop
            .querySelector("[data-dialog-worker-search]")
            ?.value || "";
        repeatRestOfWeek = Boolean(
            backdrop
                .querySelector("[data-dialog-repeat-week]")
                ?.checked
        );
    };
    const selectedStripMarkup = () => `
        <span class="task-assignment-dialog__selected-label">En esta tarea &middot; ${selectedWorkers.size}</span>
        <div class="task-assignment-dialog__chips">
            ${
                selectedWorkers.size
                    ? [...selectedWorkers].map(name => `
                        <span class="task-assignment-dialog__chip">
                            ${renderWorkerAvatar(name)}
                            <span>${escapeHTML(name)}</span>
                            <button type="button" data-selected-drop="${escapeHTML(name)}" title="Quitar de la tarea" aria-label="Quitar de la tarea">&times;</button>
                        </span>
                    `).join("")
                    : `<span class="task-assignment-dialog__chips-empty">Nadie asignado todav&iacute;a</span>`
            }
        </div>
    `;
    // La cabecera de seleccionados y el contador del boton se refrescan solos
    // al marcar una casilla: repintar el dialogo entero perderia el foco y el
    // scroll de la lista.
    const syncSelection = () => {
        const strip = backdrop.querySelector("[data-selected-strip]");

        if (strip) {
            strip.innerHTML = selectedStripMarkup();
            bindSelectedChips();
        }

        const save = backdrop.querySelector("[data-dialog-save]");

        if (save) save.textContent = `Guardar (${selectedWorkers.size})`;

        backdrop
            .querySelectorAll("[data-candidate-list] .task-assignment-candidate")
            .forEach(label => {
                label.classList.toggle(
                    "is-checked",
                    Boolean(label.querySelector("input")?.checked)
                );
            });
    };
    const bindSelectedChips = () => {
        backdrop
            .querySelectorAll("[data-selected-drop]")
            .forEach(button => {
                button.addEventListener("click", () => {
                    const name = button.dataset.selectedDrop;

                    selectedWorkers.delete(name);
                    [...backdrop.querySelectorAll("[data-candidate-list] input")]
                        .filter(input => input.value === name)
                        .forEach(input => {
                            input.checked = false;
                        });
                    syncSelection();
                });
            });
    };
    const render = () => {
        const allCandidates = candidateProfiles(
            shift,
            keyDay,
            null,
            dialogProfessions,
            { includeWorkersWithoutShift }
        );
        const candidates = allCandidates.filter(profile =>
            profileMatchesWorkerSearch(
                profile,
                keyDay,
                workerSearch
            )
        );
        const date = parseKey(keyDay);

        backdrop.innerHTML = `
            <section class="task-assignment-dialog">
                <div class="task-assignment-dialog__head">
                    <div>
                        <h3>
                            ${escapeHTML(dialogTitle)}
                            <em class="task-assignment-shift-badge task-assignment-shift-badge--${escapeHTML(shift)}">${escapeHTML(SHIFT_CONFIG[shift].shortLabel)}</em>
                        </h3>
                        <span>${escapeHTML(formatWeekday(date))} ${escapeHTML(formatShortDate(date))}</span>
                    </div>
                    <button class="icon-button" type="button" data-dialog-close aria-label="Cerrar">&times;</button>
                </div>
                <div class="task-assignment-dialog__selected" data-selected-strip>
                    ${selectedStripMarkup()}
                </div>
                <div class="task-assignment-dialog__filters">
                    <form class="profile-viewer task-assignment-worker-search" data-dialog-worker-search-form autocomplete="off">
                        <div class="profile-viewer__field">
                            <input
                                data-dialog-worker-search
                                type="search"
                                list="taskAssignmentWorkerOptions"
                                placeholder="Buscar por nombre o profesi&oacute;n"
                                value="${escapeHTML(workerSearch)}"
                            >
                            <button class="profile-viewer__button" type="submit" aria-label="Buscar trabajador">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="11" cy="11" r="7"></circle>
                                    <path d="M21 21l-4.35-4.35"></path>
                                </svg>
                            </button>
                        </div>
                        <datalist id="taskAssignmentWorkerOptions">
                            ${renderDialogWorkerOptions(allCandidates)}
                        </datalist>
                    </form>
                    <div class="task-assignment-scope">
                        <button class="task-assignment-scope__option${includeWorkersWithoutShift ? "" : " is-on"}" type="button" data-dialog-scope="shift">Del turno</button>
                        <button class="task-assignment-scope__option${includeWorkersWithoutShift ? " is-on" : ""}" type="button" data-dialog-scope="all">Todos</button>
                    </div>
                    ${renderMultiSelectFilter("dialogTaskProfession", professions, dialogProfessions, "dialog-professions", openDialogFilterGroup, "Profesión")}
                </div>
                <div class="task-assignment-candidates" data-candidate-list>
                    ${
                        candidates.length
                            ? candidates.map(profile =>
                                renderDialogCandidate(
                                    profile,
                                    assignments,
                                    shift,
                                    keyDay,
                                    taskId,
                                    selectedWorkers,
                                    tasks
                                )
                            ).join("")
                            : `<div class="empty-state empty-state--compact">Sin personal disponible para este turno.</div>`
                    }
                </div>
                <label class="task-assignment-note-field">
                    <span>Comentario de la casilla</span>
                    <textarea data-task-note rows="2" placeholder="Ej: Equipo en mantenimiento de 10 a 17 horas.">${escapeHTML(note)}</textarea>
                </label>
                <div class="task-assignment-dialog__actions">
                    <label class="task-assignment-repeat-toggle">
                        <input type="checkbox" data-dialog-repeat-week ${repeatRestOfWeek ? "checked" : ""}>
                        <span>Repetir el resto de la semana</span>
                    </label>
                    <button class="secondary-button" type="button" data-dialog-cancel>Cancelar</button>
                    <button class="primary-button" type="button" data-dialog-save>Guardar (${selectedWorkers.size})</button>
                </div>
            </section>
        `;

        backdrop.querySelector("[data-dialog-close]")?.addEventListener("click", close);
        backdrop.querySelector("[data-dialog-cancel]")?.addEventListener("click", close);
        backdrop
            .querySelector("[data-dialog-worker-search-form]")
            ?.addEventListener("submit", event => {
                event.preventDefault();
                collectVisibleWorkers();
                render();
            });
        const searchInput =
            backdrop.querySelector("[data-dialog-worker-search]");

        if (searchInput) {
            searchInput.addEventListener("input", () => {
                collectVisibleWorkers();
                render();
                const nextInput =
                    backdrop.querySelector("[data-dialog-worker-search]");

                if (nextInput) {
                    nextInput.focus();
                    const end = nextInput.value.length;
                    nextInput.setSelectionRange(end, end);
                }
            });
        }
        bindSelectedChips();
        syncSelection();

        backdrop
            .querySelector("[data-candidate-list]")
            ?.addEventListener("change", () => {
                collectVisibleWorkers();
                syncSelection();
            });

        backdrop
            .querySelectorAll("[data-dialog-scope]")
            .forEach(button => {
                button.addEventListener("click", () => {
                    const next = button.dataset.dialogScope === "all";

                    if (next === includeWorkersWithoutShift) return;

                    collectVisibleWorkers();
                    includeWorkersWithoutShift = next;
                    render();
                });
            });
        backdrop
            .querySelectorAll(".task-assignment-multiselect[data-filter-group]")
            .forEach(control => {
                syncMultiSelectSelectAll(control);
                control.addEventListener("toggle", () => {
                    if (control.open) {
                        openDialogFilterGroup = control.dataset.filterGroup;
                    } else if (
                        openDialogFilterGroup ===
                        control.dataset.filterGroup
                    ) {
                        openDialogFilterGroup = "";
                    }
                });
            });
        if (unbindDialogFilterOutside) {
            unbindDialogFilterOutside();
        }
        unbindDialogFilterOutside = bindMultiSelectOutsideClose(
            backdrop,
            () => {
                openDialogFilterGroup = "";
            }
        );
        backdrop.querySelector("[data-dialog-save]")?.addEventListener("click", () => {
            const previousWorkers = assignmentWorkers(entry);
            collectVisibleWorkers();
            const nextWorkers = [...selectedWorkers];
            const nextNote = note.trim();
            const nextRemovedDefaults = defaultWorkersForCell(task, keyDay, shift)
                .filter(worker => !selectedWorkers.has(worker));

            persistEntryOrDelete(assignments, cellKey, {
                workers: nextWorkers,
                note: nextNote,
                removedDefaults: nextRemovedDefaults,
                mergedNextTaskId: assignments[cellKey]?.mergedNextTaskId
            });

            const repeated = repeatRestOfWeek
                ? repeatAssignmentForWeek(
                    assignments,
                    tasks,
                    shift,
                    taskId,
                    keyDay,
                    nextWorkers
                )
                : [];

            saveWeekAssignments(assignments);
            publishTaskAssignmentChanges(uniqueValues([
                ...previousWorkers,
                ...nextWorkers,
                ...nextRemovedDefaults,
                ...repeated
            ]));
            close();
            renderTaskAssignmentsPanel();
        });

        backdrop
            .querySelector("[data-filter-group='dialog-professions']")
            ?.addEventListener("change", event => {
                handleMultiSelectSelectAllChange(event);
                openDialogFilterGroup = "dialog-professions";
                collectVisibleWorkers();
                collectDialogFilters();
                render();
            });
    };

    render();
}

function cellExcelText(assignments, shift, taskId, day, tasks, equipmentOutages = []) {
    const group = groupForTask(
        assignments,
        shift,
        tasks,
        taskId,
        keyFromDate(day)
    );
    const outages = outagesForTaskIdsDay(
        equipmentOutages,
        group?.taskIds || [taskId],
        day
    );

    if (outages.length) return outageScheduleNote(outages);

    const entry = groupOwnerEntry(
        assignments,
        shift,
        tasks,
        taskId,
        keyFromDate(day)
    );

    if (assignmentClosed(entry)) return "CERRADA";

    const workers = assignmentWorkers(entry)
        .map(name => {
            const partial = partialShiftText(
                name,
                keyFromDate(day),
                shift,
                { compact: true }
            );

            return partial ? `${name} (${partial})` : name;
        })
        .join(", ");

    return [workers, entry.note].filter(Boolean).join(" | ");
}

function excelTableForShift(shift, tasks, days, assignments) {
    const title = SHIFT_CONFIG[shift].label;
    const rows = tasksForShift(tasks, shift)
        .map(task => taskForShift(task, shift));
    const equipmentOutages = equipmentOutagesForDays(days);

    return `
        <h2>${escapeHTML(title)}</h2>
        <table>
            <thead>
                <tr>
                    <th>Tarea</th>
                    ${days.map(day => `<th>${escapeHTML(formatWeekday(day))} ${escapeHTML(formatShortDate(day))}</th>`).join("")}
                </tr>
            </thead>
            <tbody>
                ${rows.map(task => `
                    <tr>
                        <td>${escapeHTML(task.title)}</td>
                        ${days.map(day => `<td>${escapeHTML(cellExcelText(assignments, shift, task.id, day, tasks, equipmentOutages))}</td>`).join("")}
                    </tr>
                `).join("") || `<tr><td colspan="8">Sin tareas</td></tr>`}
            </tbody>
        </table>
    `;
}

function eventsExcelTable(days) {
    return `
        <h2>Permisos / Ausencias / Cumplea&ntilde;os</h2>
        <table>
            <thead>
                <tr>
                    ${days.map(day => `<th>${escapeHTML(formatWeekday(day))} ${escapeHTML(formatShortDate(day))}</th>`).join("")}
                </tr>
            </thead>
            <tbody>
                <tr>
                    ${days.map(day => {
                        const absences = absenceProfiles(day)
                            .map(item => `${item.profile.name} | ${item.label}`);
                        const birthdays = birthdayProfiles(day)
                            .map(profile => `${profile.name} | Cumplea\u00f1os`);

                        return `<td>${escapeHTML([...absences, ...birthdays].join(" / "))}</td>`;
                    }).join("")}
                </tr>
            </tbody>
        </table>
    `;
}

// La asignacion de tareas vista como la programacion que lee el trabajador:
// una fila por tarea y una columna por dia. Devuelve datos planos para que el
// visor (taskSchedulePreview.js) solo se ocupe de dibujar.
//
// Se omiten las tareas sin nadie asignado en toda la semana y los turnos que
// quedan enteros vacios: en el tablero las filas vacias sirven para soltar
// trabajadores, pero en la tabla publicada solo son ruido.
export function getTaskScheduleWeek(start = currentWeekStart) {
    const days = weekDays(start);
    const tasks = getTasks();
    const assignments = cleanAssignmentsForWeek(days, tasks, start);
    const equipmentOutages = equipmentOutagesForDays(days);

    let sections = SHIFT_TYPES.map(shift => ({
        shift,
        label: SHIFT_CONFIG[shift].label,
        rows: tasksForShift(tasks, shift)
            .map(task => taskForShift(task, shift))
            .map(task => ({
                taskId: task.id,
                title: task.title,
                detail: taskDetailForShift(task, shift),
                cells: days.map(day => {
                    const group = groupForTask(
                        assignments,
                        shift,
                        tasks,
                        task.id,
                        keyFromDate(day)
                    );
                    const outages = outagesForTaskIdsDay(
                        equipmentOutages,
                        group?.taskIds || [task.id],
                        day
                    );

                    if (outages.length) {
                        return {
                            workers: [],
                            note: outageScheduleNote(outages),
                            inactive: true
                        };
                    }

                    // Casilla fusionada: los trabajadores viven en la de arriba
                    // del grupo, pero son de todas sus tareas.
                    const entry = groupOwnerEntry(
                        assignments,
                        shift,
                        tasks,
                        task.id,
                        keyFromDate(day)
                    );

                    if (assignmentClosed(entry)) {
                        return {
                            workers: [],
                            note: "Cerrada",
                            inactive: true,
                            closed: true
                        };
                    }

                    return {
                        workers: assignmentWorkers(entry)
                            .map(name => scheduleWorkerName(
                                name,
                                keyFromDate(day),
                                shift
                            ))
                            .filter(Boolean),
                        note: String(entry.note || "").trim()
                    };
                })
            }))
            .filter(row =>
                row.cells.some(cell =>
                    cell.workers.length ||
                    // Una casilla cerrada NO basta para publicar la fila: si la
                    // tarea no tiene a nadie en toda la semana, siete
                    // "Cerrada" seguidos son ruido, no informacion.
                    (cell.note && !cell.closed)
                )
            )
    }));

    // La programacion cierra el turno con una fila que junta a quien esta de
    // turno esa noche y no quedo en ninguna tarea. Va SOLO aca, no en el
    // tablero: al supervisor que reparte le estorba, pero quien lee la
    // programacion necesita ver a todos los que estan citados.
    //
    // No es una tarea: se agrega despues de armar las filas reales, para que no
    // entre en la fusion de casillas ni en ningun recuento.
    sections.forEach(section => {
        const dutyLabel = SHIFT_CONFIG[section.shift].dutyLabel;

        if (!dutyLabel) return;

        const cells = days.map(day => ({
            workers: unassignedOnShift(
                section.shift,
                keyFromDate(day),
                tasks,
                assignments
            ).map(profile => shortWorkerName(profile.name, { compact: true })),
            note: ""
        }));

        if (!cells.some(cell => cell.workers.length)) return;

        // Va ARRIBA de las tareas del turno: primero quienes estan citados esa
        // noche y despues como se reparten. Leida al reves -las tareas y al
        // final la lista de todos- se entiende peor, y ademas dejaba a AUX
        // TURNO encima de TURNO DE NOCHE, que es lo contrario de como se lee.
        section.rows.unshift({
            taskId: `duty_${section.shift}`,
            title: dutyLabel,
            detail: "",
            cells
        });
    });

    sections = sections.filter(section => section.rows.length);

    // Las casillas que el supervisor unio en el tablero se dibujan tambien
    // unidas aca: una sola celda para todo el grupo, con el rowspan de sus
    // tareas. Si no, la misma lista de gente se repetiria fila por fila y no se
    // entenderia que es un solo puesto compartido.
    sections.forEach(section => {
        days.forEach((day, dayIndex) => {
            columnGroups(assignments, section.shift, tasks, keyFromDate(day))
                .filter(group => group.taskIds.length > 1)
                .forEach(group => {
                    const indexes = group.taskIds
                        .map(id => section.rows.findIndex(
                            row => row.taskId === id
                        ))
                        .filter(index => index !== -1);

                    // Las filas de un grupo son contiguas por construccion; si
                    // alguna vez no lo fueran, el rowspan pisaria celdas de
                    // otras tareas, asi que se deja sin fusionar.
                    const contiguas = indexes.length > 1 &&
                        indexes[indexes.length - 1] - indexes[0] ===
                            indexes.length - 1;

                    if (!contiguas) return;

                    section.rows[indexes[0]].cells[dayIndex].rowSpan =
                        indexes.length;
                    indexes.slice(1).forEach(index => {
                        section.rows[index].cells[dayIndex].covered = true;
                    });
                });
        });
    });

    return {
        weekStart: new Date(start),
        days: days.map(day => ({
            keyDay: keyFromDate(day),
            weekday: formatWeekday(day),
            shortDate: formatShortDate(day),
            dayNumber: day.getDate()
        })),
        sections
    };
}

// La programacion de tareas, con la MISMA forma de `grid` que ya renderizan el
// widget de Inicio y la PWA del trabajador (`{days, rows:[{title, detail,
// cells}]}`, con `{text, rowSpan}` para las casillas fusionadas).
//
// Reusar esa forma es deliberado: las dos superficies ya saben dibujarla, asi
// que pasar de mostrar el Excel a mostrar esto no les cambia una linea de
// render. El nombre del turno viaja como fila `fullWidth`, que es como esas
// tablas ya separan bloques.
// Semanas (ISO del lunes) que tienen algo repartido. Es lo que reemplaza a la
// lista de semanas con Excel adjunto: ahora "tener programacion" es "tener
// tareas asignadas".
// Si esa semana tiene algo repartido. Es la pregunta correcta para decidir si
// hay programacion que mostrar: la marca de ultima edicion NO sirve, porque
// solo existe desde que se empezo a escribir y las semanas anteriores quedarian
// invisibles hasta que alguien las tocara.
export function taskScheduleHasAssignments(start = currentWeekStart) {
    const week = getAllAssignments()[weekKey(start)];

    return Boolean(week && Object.keys(week).length);
}

/**
 * Las novedades de la semana -ausencias y permisos, cumpleanos y efemerides-
 * con la MISMA forma que una seccion de la programacion, para que el visor y la
 * hoja impresa la dibujen con el mismo codigo que las tablas de tareas.
 *
 * Deliberadamente NO entra en getTaskScheduleWeek(): esa sale publicada a la
 * PWA del trabajador, y ahi estarian las licencias y permisos de toda la unidad
 * en el telefono de cualquiera. Esto es del supervisor.
 *
 * Tampoco aplica los filtros de estamento y profesion del tablero: la
 * programacion impresa muestra a todos, igual que las filas de tareas.
 *
 * @returns {{label: string, rows: Array}|null} null si la semana no tiene ninguna novedad
 */
export function getTaskScheduleWeekEvents(start = currentWeekStart) {
    const days = weekDays(start);
    const definitions = [
        {
            title: "AUSENCIAS Y PERMISOS",
            // Nombre abreviado, como en las filas de tareas: la columna de un
            // dia mide 12% de la hoja, y un nombre completo por novedad
            // estiraria la fila hasta sacar la tabla de la pagina.
            linesFor: day => absenceProfiles(day, { filtered: false })
                .map(item =>
                    `${shortWorkerName(item.profile.name, { compact: true })}` +
                    ` | ${item.label}`
                )
        },
        {
            title: "CUMPLEAÑOS",
            linesFor: day => birthdayProfiles(day, { filtered: false })
                .map(profile =>
                    shortWorkerName(profile.name, { compact: true })
                )
        },
        {
            title: "EFEMÉRIDES",
            linesFor: day => commemorativeDaysForDate(day)
        }
    ];
    const rows = definitions
        .map(definition => ({
            title: definition.title,
            detail: "",
            cells: days.map(day => ({
                lines: definition.linesFor(day),
                workers: [],
                note: ""
            }))
        }))
        // Una fila sin nada en los siete dias no se dibuja: en una semana sin
        // cumpleanos, la fila vacia solo gasta un renglon de la hoja.
        .filter(row => row.cells.some(cell => cell.lines.length));

    return rows.length
        ? { label: "Novedades de la semana", rows }
        : null;
}

export function taskScheduleWeeks() {
    const all = getAllAssignments();

    return Object.keys(all).filter(key =>
        all[key] && Object.keys(all[key]).length
    );
}

export function taskScheduleGrid(start = currentWeekStart) {
    const week = getTaskScheduleWeek(start);
    const rows = [];

    week.sections.forEach(section => {
        rows.push({
            title: "",
            detail: "",
            fullWidth: true,
            fullText: section.label.toUpperCase()
        });

        section.rows.forEach(row => {
            rows.push({
                title: row.title,
                detail: row.detail,
                // Las tapadas por un rowspan NO se emiten: el renderer lleva su
                // propia cuenta de columnas ocupadas y se correrian todas.
                cells: row.cells
                    .filter(cell => !cell.covered)
                    .map(cell => {
                        const text = [
                            cell.workers.join("-"),
                            cell.note
                        ].filter(Boolean).join("\n");

                        return cell.rowSpan > 1
                            ? { text, rowSpan: cell.rowSpan }
                            : text;
                    })
            });
        });
    });

    return {
        days: week.days.map(day =>
            `${day.weekday.toUpperCase()} ${day.dayNumber}`
        ),
        rows,
        updatedAtISO: taskScheduleUpdatedAt(start)
    };
}

export function moveTaskScheduleWeek(offsetDays) {
    currentWeekStart = addDays(currentWeekStart, offsetDays);
    return renderTaskAssignmentsPanel();
}

export function goToTaskScheduleToday() {
    currentWeekStart = weekStartMonday(new Date());
    return renderTaskAssignmentsPanel();
}

// ---------------------------------------------------------------------------
// Programacion automatica.
//
// El QUE decide el reparto vive en taskAutoSchedule.js, que no sabe de turnos,
// licencias ni almacenamiento. Aqui se arma lo que ese motor necesita -quien
// puede trabajar cada dia, que casillas estan vacias- y se aplica lo que
// devuelve.
//
// SOLO RELLENA. Cada chip que el supervisor puso a mano se queda donde esta:
// el motor ni siquiera recibe esas casillas. Por eso apretar el boton dos
// veces seguidas no rehace nada, solo completa lo que falte.
// ---------------------------------------------------------------------------

// Los que ese dia y turno pueden trabajar y todavia no estan en ninguna tarea.
// El motor reparte entre estos, y el que ya tiene tarea no vuelve a entrar en
// el sorteo: nadie termina en dos casillas del mismo dia.
function autoScheduleCandidates(assignments, tasks, shift, keyDay) {
    const busy = new Set();

    tasksForShift(tasks, shift).forEach(task => {
        assignmentWorkers(
            getCellEntry(assignments, shift, task.id, keyDay)
        ).forEach(name => busy.add(name));
    });

    return getProfiles()
        .filter(isProfileActive)
        .filter(profile => !busy.has(profile.name))
        .filter(profile => isAvailableForShift(profile, keyDay, shift))
        .map(profile => profile.name);
}

function autoScheduleCells(days, tasks, assignments) {
    const cells = [];
    const equipmentOutages = equipmentOutagesForDays(days);

    SHIFT_TYPES.forEach(shift => {
        days.forEach(day => {
            const keyDay = keyFromDate(day);
            const candidates = autoScheduleCandidates(
                assignments,
                tasks,
                shift,
                keyDay
            );

            // Las casillas fusionadas van una sola vez, por la de arriba, que
            // es donde viven los trabajadores del grupo.
            columnGroups(assignments, shift, tasks, keyDay).forEach(group => {
                const taskId = group.taskIds[0];
                const outages = outagesForTaskIdsDay(
                    equipmentOutages,
                    group.taskIds,
                    day
                );
                const entry = getCellEntry(assignments, shift, taskId, keyDay);

                if (outages.length) return;
                // La casilla cerrada no es una casilla vacia que haya que
                // llenar: el reparto automatico ni la mira.
                if (assignmentClosed(entry)) return;
                if (assignmentWorkers(entry).length) return;

                cells.push({
                    shift,
                    keyDay,
                    taskId,
                    taskIds: group.taskIds,
                    candidates,
                    // Un predefinido que el supervisor saco a mano de ESTA
                    // casilla no puede volver por la puerta de atras.
                    blocked: assignmentRemovedDefaults(entry)
                });
            });
        });
    });

    return cells;
}

function countSkipped(plan, ...reasons) {
    return plan.skipped.filter(item => reasons.includes(item.reason)).length;
}

function autoSchedulePlanSummary(plan, days) {
    const cells = plan.filled.length;
    const shortCells = plan.filled.filter(item => item.short).length;
    // "sin-cupo" no se cuenta: no es un hueco, es la tarea que ese dia no va.
    const noHistory = countSkipped(plan, "sin-historial", "sin-turno");
    const takenElsewhere = countSkipped(plan, "sin-gente");
    const lines = [
        `Se repartirán ${plan.assignments} ${plan.assignments === 1 ? "persona" : "personas"} en ${cells} ${cells === 1 ? "casilla vacía" : "casillas vacías"} de la semana del ${formatShortDate(days[0])} al ${formatShortDate(days[6])}.`,
        "",
        "El reparto es al azar entre los que están de turno, pero solo entra quien ya ha hecho esa tarea en semanas anteriores, y a los que hacen varias se les va cambiando la tarea a lo largo de la semana.",
        "",
        "Lo que ya está asignado no se toca."
    ];

    if (noHistory || takenElsewhere || shortCells) lines.push("");

    if (noHistory) {
        lines.push(
            `${noHistory} ${noHistory === 1 ? "casilla queda" : "casillas quedan"} sin cubrir: ese día no hay nadie de turno que haya hecho esa tarea antes.`
        );
    }

    if (takenElsewhere) {
        lines.push(
            `${takenElsewhere} ${takenElsewhere === 1 ? "casilla queda" : "casillas quedan"} sin cubrir: los que podían ya quedaron en otra tarea ese día.`
        );
    }

    if (shortCells) {
        lines.push(
            `${shortCells} ${shortCells === 1 ? "casilla queda" : "casillas quedan"} con menos gente de la habitual.`
        );
    }

    return lines.join("\n");
}

async function runTaskAutoSchedule() {
    const days = weekDays();
    const tasks = getTasks();

    if (!tasks.length) {
        await showAlert(
            "No hay tareas en el catálogo para programar.",
            { title: "Programación automática", tone: "warning" }
        );
        return;
    }

    const assignments = cleanAssignmentsForWeek(days, tasks);
    const cells = autoScheduleCells(days, tasks, assignments);

    if (!cells.length) {
        await showAlert(
            "Esta semana no tiene casillas vacías: ya está toda programada.",
            { title: "Programación automática", tone: "info" }
        );
        return;
    }

    const plan = planTaskAutoSchedule({
        cells,
        history: buildTaskAutoScheduleHistory(getAllAssignments(), {
            beforeWeekKey: weekKey()
        })
    });

    if (!plan.assignments) {
        await showAlert(
            "No quedó nadie para repartir: los que están de turno esos días o ya tienen tarea, o nunca han trabajado en las que faltan por cubrir.",
            { title: "Programación automática", tone: "warning" }
        );
        return;
    }

    if (
        !await showConfirm(autoSchedulePlanSummary(plan, days), {
            title: "Programación automática",
            tone: "info",
            confirmText: "Repartir"
        })
    ) {
        return;
    }

    // Se relee: el dialogo estuvo abierto y otra sesion pudo llenar alguna de
    // estas casillas mientras tanto. La que ya tenga gente se respeta.
    const next = getWeekAssignments();

    plan.filled.forEach(item => {
        const cellKey = assignmentKey(item.shift, item.taskId, item.keyDay);
        const entry = next[cellKey] || {};

        if (assignmentWorkers(entry).length) return;

        persistEntryOrDelete(next, cellKey, {
            workers: item.workers,
            note: entry.note || "",
            removedDefaults: assignmentRemovedDefaults(entry),
            mergedNextTaskId: entry.mergedNextTaskId
        });
    });

    saveWeekAssignments(next);
    publishTaskAssignmentChanges(plan.workers);
    closeCellPicker();
    renderTaskAssignmentsPanel();
}

function exportTaskAssignmentsExcel() {
    const days = weekDays();
    const tasks = getTasks();
    const assignments = cleanAssignmentsForWeek(days, tasks);
    const html = `
        <!doctype html>
        <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: Calibri, Arial, sans-serif; color: #111827; }
                    h1 { font-size: 18px; }
                    h2 { padding: 7px 9px; color: #fff; background: #1d6cff; font-size: 13px; }
                    table { border-collapse: collapse; width: 100%; margin-bottom: 14px; }
                    th { background: #dbeafe; color: #0f172a; font-weight: 700; }
                    th, td { border: 1px solid #94a3b8; padding: 6px 8px; vertical-align: top; font-size: 11px; mso-number-format:"\\@"; }
                </style>
            </head>
            <body>
                <h1>Asignaci\u00f3n de Tareas - ${escapeHTML(formatShortDate(days[0]))} al ${escapeHTML(formatShortDate(days[6]))}</h1>
                ${excelTableForShift("day", tasks, days, assignments)}
                ${excelTableForShift("night", tasks, days, assignments)}
                ${eventsExcelTable(days)}
            </body>
        </html>
    `;
    const blob = new Blob([html], {
        type: "application/vnd.ms-excel;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `asignacion_tareas_${weekKey()}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function renderTaskAssignmentsPanel() {
    const root = document.getElementById("taskAssignmentsPanel");

    if (!root) return;

    const token = ++renderToken;
    const days = weekDays();
    const holidays = await holidayMapForDays(days);

    if (token !== renderToken) return;

    root.innerHTML = renderShell(holidays);
    bindShellEvents(root);
    // El selector rapido vive fuera del panel, asi que hay que volver a
    // colgarlo -y reanclarlo a su casilla- despues de cada pintado.
    syncCellPicker(root);
}

// Le entrega a la publicacion la grilla de la semana que pida. Se registra en
// vez de importarse al reves porque este modulo YA importa el de publicacion, y
// hacerlo mutuo cerraria un ciclo de imports.
registerTaskScheduleGridProvider(taskScheduleGrid);
