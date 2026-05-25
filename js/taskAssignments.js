import { getJSON, setJSON } from "./persistence.js";
import {
    getProfileData,
    getProfiles,
    isProfileActive
} from "./storage.js";
import { aplicarCambiosTurno } from "./turnEngine.js";
import { getAbsenceType } from "./rulesEngine.js";
import { getHourReturn } from "./hourReturns.js";
import { TURNO, TURNO_LABEL } from "./constants.js";

const TASKS_KEY = "weekly_task_assignment_tasks";
const ASSIGNMENTS_KEY = "weekly_task_assignment_entries";

const SHIFT_CONFIG = {
    day: {
        label: "Tareas diurnas",
        shortLabel: "Diurno",
        className: "day"
    },
    night: {
        label: "Tareas de noche",
        shortLabel: "Noche",
        className: "night"
    }
};

let currentWeekStart = weekStartMonday(new Date());
let selectedRoles = null;
let selectedProfessions = null;
let draggedTask = null;
let draggedWorker = null;

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function normalizeText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function keyFromDate(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function parseKey(keyDay) {
    const [year, month, day] = String(keyDay || "")
        .split("-")
        .map(Number);

    return new Date(year, month, day);
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

function weekKey(start = currentWeekStart) {
    return isoFromDate(start);
}

function addDays(date, amount) {
    const next = new Date(date);

    next.setDate(date.getDate() + amount);
    return next;
}

function getTasks() {
    const raw = getJSON(TASKS_KEY, []);

    return (Array.isArray(raw) ? raw : [])
        .map((task, index) => {
            const defaultWorkers = Array.isArray(task?.defaultWorkers)
                ? task.defaultWorkers
                : [task?.defaultWorker];

            return {
                id: String(task?.id || `task_${Date.now()}_${index}`),
                shift: task?.shift === "night" ? "night" : "day",
                title: String(task?.title || "").trim(),
                order: Number.isFinite(Number(task?.order))
                    ? Number(task.order)
                    : index,
                defaultWorkers: uniqueValues(
                    defaultWorkers.map(worker =>
                        String(worker || "").trim()
                    )
                ),
                createdAt: task?.createdAt || new Date().toISOString()
            };
        })
        .filter(task => task.title)
        .sort((a, b) =>
            a.shift.localeCompare(b.shift) ||
            a.order - b.order ||
            a.title.localeCompare(b.title, "es")
        );
}

function saveTasks(tasks) {
    setJSON(
        TASKS_KEY,
        tasks.map((task, index) => ({
            ...task,
            order: index
        }))
    );
}

function tasksForShift(shift) {
    return getTasks()
        .filter(task => task.shift === shift)
        .sort((a, b) => a.order - b.order);
}

function getAllAssignments() {
    const raw = getJSON(ASSIGNMENTS_KEY, {});

    return raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw
        : {};
}

function getWeekAssignments(start = currentWeekStart) {
    const all = getAllAssignments();
    const value = all[weekKey(start)];

    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}

function saveWeekAssignments(assignments, start = currentWeekStart) {
    const all = getAllAssignments();

    all[weekKey(start)] = assignments;
    setJSON(ASSIGNMENTS_KEY, all);
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
    const data = getProfileData(profile.name);

    return aplicarCambiosTurno(
        profile.name,
        keyDay,
        Number(data[keyDay]) || TURNO.LIBRE
    );
}

function readMap(prefix, profileName) {
    return getJSON(`${prefix}_${profileName}`, {});
}

function absenceLabelForType(type) {
    if (type === "license") return "Licencia Medica";
    if (type === "professional_license") return "LM Profesional";
    if (type === "unpaid_leave") return "Permiso sin Goce";
    if (type === "unjustified_absence") return "Ausencia injustificada";

    return "Ausencia";
}

function absenceDetail(profileName, keyDay) {
    const admin = readMap("admin", profileName);
    const legal = readMap("legal", profileName);
    const comp = readMap("comp", profileName);
    const absences = readMap("absences", profileName);

    if (admin[keyDay] === 1) return "P. Administrativo";
    if (admin[keyDay] === "0.5M") return "1/2 ADM Manana";
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

function hasBlockingAbsence(profileName, keyDay) {
    return Boolean(absenceDetail(profileName, keyDay));
}

function isAvailableForShift(profile, keyDay, shift) {
    if (!profile || !isProfileActive(profile)) return false;
    if (hasBlockingAbsence(profile.name, keyDay)) return false;

    const state = getProfileShift(profile, keyDay);

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

function assignmentWorkers(entry) {
    return Array.isArray(entry?.workers)
        ? entry.workers.filter(Boolean)
        : [];
}

function taskDefaultWorkers(task) {
    return Array.isArray(task?.defaultWorkers)
        ? task.defaultWorkers.filter(Boolean)
        : [];
}

function applyDefaultAssignments(days, tasks, assignments) {
    let changed = false;

    tasks.forEach(task => {
        taskDefaultWorkers(task).forEach(defaultWorker => {
            const profile = profileByName(defaultWorker);

            if (!profile) return;

            days.forEach(day => {
                const keyDay = keyFromDate(day);

                if (!isAvailableForShift(profile, keyDay, task.shift)) return;

                const cellKey = assignmentKey(task.shift, task.id, keyDay);
                const entry = getCellEntry(
                    assignments,
                    task.shift,
                    task.id,
                    keyDay
                );
                const workers = assignmentWorkers(entry);

                if (workers.includes(defaultWorker)) return;

                assignments[cellKey] = {
                    ...entry,
                    workers: [...workers, defaultWorker]
                };
                changed = true;
            });
        });
    });

    return changed;
}

function cleanAssignmentsForWeek(days, tasks) {
    const assignments = getWeekAssignments();
    const taskIds = new Set(tasks.map(task => task.id));
    let changed = false;

    Object.entries(assignments).forEach(([cellKey, entry]) => {
        const { shift, taskId, keyDay } = splitAssignmentKey(cellKey);

        if (!taskIds.has(taskId)) {
            delete assignments[cellKey];
            changed = true;
            return;
        }

        if (!days.some(day => keyFromDate(day) === keyDay)) return;

        const availableWorkers = assignmentWorkers(entry)
            .filter(name => {
                const profile = profileByName(name);

                return isAvailableForShift(profile, keyDay, shift);
            });

        if (
            availableWorkers.length !== assignmentWorkers(entry).length
        ) {
            changed = true;
            if (availableWorkers.length || entry?.note) {
                assignments[cellKey] = {
                    ...entry,
                    workers: availableWorkers
                };
            } else {
                delete assignments[cellKey];
            }
        }
    });

    if (applyDefaultAssignments(days, tasks, assignments)) {
        changed = true;
    }

    if (changed) saveWeekAssignments(assignments);
    return assignments;
}

function getCellEntry(assignments, shift, taskId, keyDay) {
    return assignments[assignmentKey(shift, taskId, keyDay)] || {
        workers: [],
        note: ""
    };
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

function candidateProfiles(shift, keyDay, roles, professions) {
    return getProfiles()
        .filter(isProfileActive)
        .filter(profile => profileMatchesFilters(
            profile,
            roles,
            professions
        ))
        .filter(profile => isAvailableForShift(profile, keyDay, shift))
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function renderFilterChips(name, options, selected, action) {
    return `
        <div class="task-assignment-filter-list" data-filter-group="${escapeHTML(action)}">
            ${options.map(option => `
                <label class="task-assignment-filter-chip">
                    <input type="checkbox" name="${escapeHTML(name)}" value="${escapeHTML(option)}" ${selectionMatches(option, selected) ? "checked" : ""}>
                    <span>${escapeHTML(option)}</span>
                </label>
            `).join("")}
        </div>
    `;
}

function selectedValues(root, selector, options) {
    const values = [...root.querySelectorAll(selector)]
        .filter(input => input.checked)
        .map(input => input.value);

    return values.length === options.length ? null : values;
}

function birthdayProfiles(date) {
    const month = date.getMonth();
    const day = date.getDate();

    return getProfiles()
        .filter(isProfileActive)
        .filter(profile => profileMatchesFilters(
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

function absenceProfiles(date) {
    const keyDay = keyFromDate(date);

    return getProfiles()
        .filter(isProfileActive)
        .filter(profile => profileMatchesFilters(
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

function renderWorkerChip(profileName, task, keyDay) {
    const profile = profileByName(profileName);

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

    return `
        <span class="task-assignment-worker-chip" draggable="true" data-worker-drag="${escapeHTML(profileName)}" data-worker-task="${escapeHTML(task.id)}" data-worker-shift="${escapeHTML(task.shift)}" data-worker-day="${escapeHTML(keyDay)}" title="Arrastrar a otra tarea del mismo turno y d&iacute;a">
            ${escapeHTML(profileName)}
        </span>
    `;
}

function renderAssignmentCell(assignments, task, day) {
    const keyDay = keyFromDate(day);
    const entry = getCellEntry(
        assignments,
        task.shift,
        task.id,
        keyDay
    );
    const workers = assignmentWorkers(entry)
        .map(profileName => renderWorkerChip(profileName, task, keyDay))
        .filter(Boolean);

    return `
        <div class="task-assignment-cell" data-task-cell="${escapeHTML(task.id)}" data-shift="${escapeHTML(task.shift)}" data-day="${escapeHTML(keyDay)}">
            <button class="task-assignment-add" type="button" title="Asignar trabajadores">
                +
            </button>
            <div class="task-assignment-cell-workers">
                ${workers.join("")}
            </div>
            ${entry.note ? `<p>${escapeHTML(entry.note)}</p>` : ""}
        </div>
    `;
}

function renderTaskControl(task) {
    const configClass = taskDefaultWorkers(task).length
        ? " is-configured"
        : "";

    return `
        <div class="task-assignment-task-card" draggable="true" data-task-drag="${escapeHTML(task.id)}" data-shift="${escapeHTML(task.shift)}">
            <div class="task-assignment-task-card__top">
                <span class="task-assignment-drag" aria-hidden="true">::</span>
                <span class="task-assignment-task-actions">
                    <button class="ghost-button task-assignment-config${configClass}" type="button" data-task-config="${escapeHTML(task.id)}" title="Configurar tarea" aria-label="Configurar tarea">
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <circle cx="12" cy="12" r="3.2"></circle>
                            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 0 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.3 7A2 2 0 0 1 7.1 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 0 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1a2 2 0 0 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z"></path>
                        </svg>
                    </button>
                    <button class="ghost-button task-assignment-delete" type="button" data-task-delete="${escapeHTML(task.id)}" title="Eliminar tarea">
                        &times;
                    </button>
                </span>
            </div>
            <input type="text" value="${escapeHTML(task.title)}" data-task-title="${escapeHTML(task.id)}" aria-label="Nombre de tarea">
        </div>
    `;
}

function renderBoard(shift, tasks, days, assignments) {
    const config = SHIFT_CONFIG[shift];
    const sectionTasks = tasks.filter(task => task.shift === shift);

    return `
        <section class="task-assignment-section task-assignment-section--${escapeHTML(config.className)}">
            <div class="task-assignment-board">
                <div class="task-assignment-task-head">
                    <strong>${escapeHTML(config.label)}</strong>
                    <form class="task-assignment-task-form" data-task-add-form="${escapeHTML(shift)}" autocomplete="off">
                        <input name="title" type="text" maxlength="80" placeholder="Nueva tarea">
                        <button class="task-assignment-task-add" type="submit" aria-label="Agregar tarea">+</button>
                    </form>
                </div>
                ${days.map(day => `
                    <div class="task-assignment-day-head">
                        <strong>${escapeHTML(formatWeekday(day))}</strong>
                        <span>${escapeHTML(formatShortDate(day))}</span>
                    </div>
                `).join("")}
                ${
                    sectionTasks.length
                        ? sectionTasks.map(task => `
                            <div class="task-assignment-task-cell" data-task-drop="${escapeHTML(task.id)}" data-shift="${escapeHTML(shift)}">
                                ${renderTaskControl(task)}
                            </div>
                            ${days.map(day =>
                                renderAssignmentCell(
                                    assignments,
                                    task,
                                    day
                                )
                            ).join("")}
                        `).join("")
                        : `
                            <div class="task-assignment-empty-row">
                                Sin tareas ${shift === "day" ? "diurnas" : "de noche"}.
                            </div>
                        `
                }
            </div>
        </section>
    `;
}

function renderEventsBoard(days) {
    return `
        <section class="task-assignment-events">
            <div class="task-assignment-events-grid">
                <div class="task-assignment-events-head">
                    Permisos / Ausencias / Cumplea&ntilde;os
                </div>
                ${days.map(day => {
                    const absences = absenceProfiles(day);
                    const birthdays = birthdayProfiles(day);

                    return `
                        <div class="task-assignment-event-day">
                            <strong>${escapeHTML(formatWeekday(day))}</strong>
                            <span>${escapeHTML(formatShortDate(day))}</span>
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

function renderShell() {
    const days = weekDays();
    const tasks = getTasks();
    const assignments = cleanAssignmentsForWeek(days, tasks);
    const roles = availableRoles();
    const professions = availableProfessions();

    return `
        <div class="task-assignment-shell">
            <div class="section-head section-head--with-action task-assignment-head">
                <span class="section-head__title">
                    <h3>Asignaci&oacute;n de Tareas</h3>
                    <span class="staffing-weekly-range">
                        ${escapeHTML(formatShortDate(days[0]))} al ${escapeHTML(formatShortDate(days[6]))}
                    </span>
                </span>
                <span class="task-assignment-toolbar">
                    <button class="secondary-button secondary-button--small" type="button" data-task-week-prev>Anterior</button>
                    <button class="secondary-button secondary-button--small" type="button" data-task-week-current>Semana actual</button>
                    <button class="secondary-button secondary-button--small" type="button" data-task-week-next>Siguiente</button>
                    <button class="primary-button secondary-button--small" type="button" data-task-export>Descargar Excel</button>
                </span>
            </div>
            <section class="task-assignment-view-filters">
                <div>
                    <strong>Estamentos</strong>
                    ${renderFilterChips("taskRole", roles, selectedRoles, "roles")}
                </div>
                <div>
                    <strong>Profesiones</strong>
                    ${renderFilterChips("taskProfession", professions, selectedProfessions, "professions")}
                </div>
            </section>
            ${renderBoard("day", tasks, days, assignments)}
            ${renderBoard("night", tasks, days, assignments)}
            ${renderEventsBoard(days)}
        </div>
    `;
}

function addTask(shift, title) {
    const cleanTitle = String(title || "").trim();

    if (!cleanTitle) return;

    const tasks = getTasks();
    const order = tasks.filter(task => task.shift === shift).length;

    tasks.push({
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        shift,
        title: cleanTitle,
        order,
        createdAt: new Date().toISOString()
    });

    saveTasks(tasks);
}

function updateTaskTitle(taskId, title) {
    const cleanTitle = String(title || "").trim();

    if (!cleanTitle) return;

    saveTasks(
        getTasks().map(task =>
            task.id === taskId
                ? { ...task, title: cleanTitle }
                : task
        )
    );
}

function updateTaskDefaultWorkers(taskId, workerNames) {
    saveTasks(
        getTasks().map(task =>
            task.id === taskId
                ? {
                    ...task,
                    defaultWorkers: uniqueValues(
                        workerNames.map(worker =>
                            String(worker || "").trim()
                        )
                    )
                }
                : task
        )
    );
}

function deleteTask(taskId) {
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
}

function reorderTask(draggedId, targetId, shift) {
    if (!draggedId || !targetId || draggedId === targetId) return;

    const tasks = getTasks();
    const sameShift = tasks.filter(task => task.shift === shift);
    const other = tasks.filter(task => task.shift !== shift);
    const from = sameShift.findIndex(task => task.id === draggedId);
    const to = sameShift.findIndex(task => task.id === targetId);

    if (from === -1 || to === -1) return;

    const [moved] = sameShift.splice(from, 1);
    sameShift.splice(to, 0, moved);
    saveTasks([...other, ...sameShift]);
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
        payload?.workerName &&
        payload?.shift === cell.dataset.shift &&
        payload?.keyDay === cell.dataset.day &&
        payload?.taskId !== cell.dataset.taskCell
    );
}

function persistEntryOrDelete(assignments, cellKey, entry) {
    const workers = assignmentWorkers(entry);
    const note = String(entry?.note || "").trim();

    if (workers.length || note) {
        assignments[cellKey] = {
            workers,
            note
        };
        return;
    }

    delete assignments[cellKey];
}

function moveWorkerAssignment(payload, targetCell) {
    if (!canMoveWorkerToCell(targetCell, payload)) return false;

    const assignments = getWeekAssignments();
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

    persistEntryOrDelete(assignments, fromKey, {
        ...fromEntry,
        workers: fromWorkers.filter(name => name !== payload.workerName)
    });

    persistEntryOrDelete(assignments, toKey, {
        ...toEntry,
        workers: toWorkers.includes(payload.workerName)
            ? toWorkers
            : [...toWorkers, payload.workerName]
    });

    saveWeekAssignments(assignments);
    return true;
}

function openTaskConfigDialog(taskId) {
    const task = getTasks().find(item => item.id === taskId);
    if (!task) return;

    const selectedWorkers = new Set(taskDefaultWorkers(task));
    const profiles = getProfiles()
        .filter(isProfileActive)
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
    const backdrop = document.createElement("div");
    const close = () => backdrop.remove();

    backdrop.className = "task-assignment-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="task-assignment-dialog task-assignment-config-dialog">
            <div class="task-assignment-dialog__head">
                <div>
                    <h3>${escapeHTML(task.title)}</h3>
                    <span>Trabajadores preestablecidos</span>
                </div>
                <button class="icon-button" type="button" data-dialog-close aria-label="Cerrar">&times;</button>
            </div>
            <div class="task-assignment-default-worker-field">
                <span>Trabajadores</span>
                <div class="task-assignment-default-worker-list">
                    ${profiles.length
                        ? profiles.map(profile => `
                            <label class="task-assignment-candidate">
                                <input type="checkbox" data-default-worker value="${escapeHTML(profile.name)}" ${selectedWorkers.has(profile.name) ? "checked" : ""}>
                                <span>
                                    <strong>${escapeHTML(profile.name)}</strong>
                                    <small>${escapeHTML(profile.estamento || "Sin estamento")} | ${escapeHTML(profileProfession(profile))}</small>
                                </span>
                            </label>
                        `).join("")
                        : `<div class="empty-state empty-state--compact">Sin trabajadores activos.</div>`}
                </div>
            </div>
            <div class="task-assignment-dialog__actions">
                <button class="secondary-button" type="button" data-dialog-cancel>Cancelar</button>
                <button class="primary-button" type="button" data-dialog-save>Guardar</button>
            </div>
        </section>
    `;

    document.body.appendChild(backdrop);
    backdrop.querySelector("[data-dialog-close]")?.addEventListener("click", close);
    backdrop.querySelector("[data-dialog-cancel]")?.addEventListener("click", close);
    backdrop.querySelector("[data-dialog-save]")?.addEventListener("click", () => {
        updateTaskDefaultWorkers(
            task.id,
            [...backdrop.querySelectorAll("[data-default-worker]:checked")]
                .map(input => input.value)
        );
        close();
        renderTaskAssignmentsPanel();
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
    root.querySelector("[data-task-export]")?.addEventListener("click", exportTaskAssignmentsExcel);

    root
        .querySelectorAll("[data-task-add-form]")
        .forEach(form => {
            form.onsubmit = event => {
                event.preventDefault();
                addTask(form.dataset.taskAddForm, new FormData(form).get("title"));
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
        .querySelectorAll("[data-task-delete]")
        .forEach(button => {
            button.onclick = () => {
                if (!confirm("Eliminar esta tarea y sus asignaciones?")) return;
                deleteTask(button.dataset.taskDelete);
                renderTaskAssignmentsPanel();
            };
        });

    root
        .querySelectorAll("[data-task-config]")
        .forEach(button => {
            button.onclick = () => {
                openTaskConfigDialog(button.dataset.taskConfig);
            };
        });

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
                    target.dataset.taskDrop,
                    target.dataset.shift
                );
                renderTaskAssignmentsPanel();
            };
        });

    root
        .querySelectorAll("[data-worker-drag]")
        .forEach(chip => {
            chip.ondragstart = event => {
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
        .querySelectorAll("[data-task-cell]")
        .forEach(cell => {
            cell.querySelector(".task-assignment-add")?.addEventListener(
                "click",
                () => openAssignmentDialog({
                    shift: cell.dataset.shift,
                    taskId: cell.dataset.taskCell,
                    keyDay: cell.dataset.day
                })
            );
            cell.ondragover = event => {
                if (!canMoveWorkerToCell(cell, draggedWorker)) return;

                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                cell.classList.add("is-drag-over");
            };
            cell.ondragleave = () => {
                cell.classList.remove("is-drag-over");
            };
            cell.ondrop = event => {
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
        ?.addEventListener("change", () => {
            selectedRoles = selectedValues(
                root,
                "[name='taskRole']",
                roleOptions
            );
            renderTaskAssignmentsPanel();
        });

    root
        .querySelector("[data-filter-group='professions']")
        ?.addEventListener("change", () => {
            selectedProfessions = selectedValues(
                root,
                "[name='taskProfession']",
                professionOptions
            );
            renderTaskAssignmentsPanel();
        });
}

function renderDialogCandidate(
    profile,
    assignments,
    shift,
    keyDay,
    taskId,
    selectedWorkers
) {
    const busy = workerHasOtherTask(
        assignments,
        profile.name,
        shift,
        keyDay,
        taskId
    );

    return `
        <label class="task-assignment-candidate ${busy ? "is-busy" : "is-free"}">
            <input type="checkbox" value="${escapeHTML(profile.name)}" ${selectedWorkers.has(profile.name) ? "checked" : ""}>
            <span>
                <strong>${escapeHTML(profile.name)}</strong>
                <small>${escapeHTML(profile.estamento || "Sin estamento")} | ${escapeHTML(profileProfession(profile))} | ${escapeHTML(TURNO_LABEL[getProfileShift(profile, keyDay)] || "")}</small>
            </span>
        </label>
    `;
}

function openAssignmentDialog({ shift, taskId, keyDay }) {
    const task = getTasks().find(item => item.id === taskId);
    if (!task) return;

    const assignments = getWeekAssignments();
    const cellKey = assignmentKey(shift, taskId, keyDay);
    const entry = assignments[cellKey] || { workers: [], note: "" };
    const selectedWorkers = new Set(assignmentWorkers(entry));
    const roles = availableRoles();
    const professions = availableProfessions();
    let dialogRoles = null;
    let dialogProfessions = null;
    let note = entry.note || "";
    const backdrop = document.createElement("div");

    backdrop.className = "task-assignment-dialog-backdrop";
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    const collectDialogFilters = () => {
        dialogRoles = selectedValues(
            backdrop,
            "[name='dialogTaskRole']",
            roles
        );
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
    };
    const render = () => {
        const candidates = candidateProfiles(
            shift,
            keyDay,
            dialogRoles,
            dialogProfessions
        );
        const date = parseKey(keyDay);

        backdrop.innerHTML = `
            <section class="task-assignment-dialog">
                <div class="task-assignment-dialog__head">
                    <div>
                        <h3>${escapeHTML(task.title)}</h3>
                        <span>${escapeHTML(SHIFT_CONFIG[shift].shortLabel)} | ${escapeHTML(formatWeekday(date))} ${escapeHTML(formatShortDate(date))}</span>
                    </div>
                    <button class="icon-button" type="button" data-dialog-close aria-label="Cerrar">&times;</button>
                </div>
                <div class="task-assignment-dialog__filters">
                    <div>
                        <strong>Estamento</strong>
                        ${renderFilterChips("dialogTaskRole", roles, dialogRoles, "dialog-roles")}
                    </div>
                    <div>
                        <strong>Profesi&oacute;n</strong>
                        ${renderFilterChips("dialogTaskProfession", professions, dialogProfessions, "dialog-professions")}
                    </div>
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
                                    selectedWorkers
                                )
                            ).join("")
                            : `<div class="empty-state empty-state--compact">Sin personal disponible para este turno.</div>`
                    }
                </div>
                <label class="task-assignment-note-field">
                    <span>Comentario</span>
                    <textarea data-task-note rows="3" placeholder="Ej: Equipo en mantenimiento de 10 a 17 horas.">${escapeHTML(note)}</textarea>
                </label>
                <div class="task-assignment-dialog__actions">
                    <button class="secondary-button" type="button" data-dialog-cancel>Cancelar</button>
                    <button class="primary-button" type="button" data-dialog-save>Guardar</button>
                </div>
            </section>
        `;

        backdrop.querySelector("[data-dialog-close]")?.addEventListener("click", close);
        backdrop.querySelector("[data-dialog-cancel]")?.addEventListener("click", close);
        backdrop.querySelector("[data-dialog-save]")?.addEventListener("click", () => {
            collectVisibleWorkers();
            const nextWorkers = [...selectedWorkers];
            const nextNote = note.trim();

            if (nextWorkers.length || nextNote) {
                assignments[cellKey] = {
                    workers: nextWorkers,
                    note: nextNote
                };
            } else {
                delete assignments[cellKey];
            }

            saveWeekAssignments(assignments);
            close();
            renderTaskAssignmentsPanel();
        });

        backdrop
            .querySelectorAll("[name='dialogTaskRole'], [name='dialogTaskProfession']")
            .forEach(input => {
                input.addEventListener("change", () => {
                    collectVisibleWorkers();
                    collectDialogFilters();
                    render();
                });
            });
    };

    render();
}

function cellExcelText(assignments, shift, taskId, day) {
    const entry = getCellEntry(
        assignments,
        shift,
        taskId,
        keyFromDate(day)
    );
    const workers = assignmentWorkers(entry).join(", ");

    return [workers, entry.note].filter(Boolean).join(" | ");
}

function excelTableForShift(shift, tasks, days, assignments) {
    const title = SHIFT_CONFIG[shift].label;
    const rows = tasks.filter(task => task.shift === shift);

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
                        ${days.map(day => `<td>${escapeHTML(cellExcelText(assignments, shift, task.id, day))}</td>`).join("")}
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
                            .map(profile => `${profile.name} | Cumpleanos`);

                        return `<td>${escapeHTML([...absences, ...birthdays].join(" / "))}</td>`;
                    }).join("")}
                </tr>
            </tbody>
        </table>
    `;
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
                <h1>Asignacion de Tareas - ${escapeHTML(formatShortDate(days[0]))} al ${escapeHTML(formatShortDate(days[6]))}</h1>
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

export function renderTaskAssignmentsPanel() {
    const root = document.getElementById("taskAssignmentsPanel");

    if (!root) return;

    root.innerHTML = renderShell();
    bindShellEvents(root);
}
