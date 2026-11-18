// Deltas locales de asignacion. Firestore sigue guardando semanas completas,
// pero SOLO la transaccion materializa la semana sobre su ultima version.
// Los parches no se guardan en Firestore y los lectores existentes no cambian.
export const TASK_ASSIGNMENTS_KEY = "weekly_task_assignment_entries";
export const TASK_ASSIGNMENT_WRITER_SCHEMA_VERSION = 2;
const MEMBERSHIP_FIELDS = new Set(["workers", "removedDefaults"]);

function object(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value : {};
}

function parse(raw) {
    if (raw === null || raw === undefined) return {};
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("La asignacion de tareas no contiene un objeto valido.");
    }
    return value;
}

function equal(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function members(value) {
    return Array.isArray(value) ? value : [];
}

export function diffTaskAssignmentWeek(before = {}, after = {}) {
    const patch = {};
    for (const cell of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const previous = object(before[cell]);
        const next = object(after[cell]);
        const fields = {};
        for (const field of new Set([...Object.keys(previous), ...Object.keys(next)])) {
            if (MEMBERSHIP_FIELDS.has(field)) {
                const oldMembers = new Set(members(previous[field]));
                const newMembers = new Set(members(next[field]));
                const changes = Object.fromEntries(
                    [...new Set([...oldMembers, ...newMembers])]
                        .filter(name => oldMembers.has(name) !== newMembers.has(name))
                        .map(name => [name, newMembers.has(name)])
                );
                if (Object.keys(changes).length ||
                    (!Object.hasOwn(previous, field) && Object.hasOwn(next, field))) {
                    fields[field] = { members: changes };
                }
            } else if (!equal(previous[field], next[field])) {
                fields[field] = Object.hasOwn(next, field)
                    ? { value: next[field] } : { removed: true };
            }
        }
        if (Object.keys(fields).length) patch[cell] = fields;
    }
    return patch;
}

// Cada operacion fija un campo o la pertenencia de UNA persona. Componer por
// ultima operacion hace los reintentos idempotentes y conserva retiros reales.
export function composeTaskAssignmentPatches(earlier = {}, later = {}) {
    const result = { ...earlier };
    for (const [cell, fields] of Object.entries(later)) {
        const merged = { ...result[cell] };
        for (const [field, operation] of Object.entries(fields)) {
            merged[field] = operation.members
                ? { members: { ...merged[field]?.members, ...operation.members } }
                : operation;
        }
        result[cell] = merged;
    }
    return result;
}

// Un acuse antiguo no puede llevarse una edicion posterior. Solo se retiran
// las operaciones que aun coinciden con lo que ese envio confirmo.
export function acknowledgeTaskAssignmentPatch(pending = {}, sent = {}) {
    const result = {};
    for (const [cell, fields] of Object.entries(pending)) {
        const remaining = {};
        for (const [field, operation] of Object.entries(fields)) {
            const confirmed = sent[cell]?.[field];
            if (operation.members) {
                const changes = Object.fromEntries(Object.entries(operation.members)
                    .filter(([name, present]) => confirmed?.members?.[name] !== present));
                if (Object.keys(changes).length || !confirmed?.members) {
                    remaining[field] = { members: changes };
                }
            } else if (!equal(operation, confirmed)) {
                remaining[field] = operation;
            }
        }
        if (Object.keys(remaining).length) result[cell] = remaining;
    }
    return result;
}

export function applyTaskAssignmentPatch(week = {}, patch = {}) {
    const result = Object.fromEntries(Object.entries(object(week)).map(([key, entry]) => [key, { ...entry }]));
    for (const [cell, fields] of Object.entries(patch)) {
        const next = { ...object(result[cell]) };
        for (const [field, operation] of Object.entries(fields)) {
            if (operation.members) {
                continue; // Se resuelven contra el grupo DESPUES de sus enlaces.
            } else if (operation.removed) {
                delete next[field];
            } else {
                next[field] = operation.value;
            }
        }
        // Las casillas sin contenido no deben dejar basura al retirar a la
        // ultima persona. Una nota, cierre o fusion concurrentes se conservan.
        result[cell] = next;
    }
    const parents = taskAssignmentParents(result);
    const ownerOf = key => { while (parents.has(key)) key = parents.get(key); return key; };
    const grouped = {};
    for (const [key, fields] of Object.entries(patch)) {
        const owner = ownerOf(key);
        grouped[owner] ||= {};
        for (const [field, operation] of Object.entries(fields)) {
            if (!operation.members) continue;
            grouped[owner][field] ||= {};
            for (const [name, present] of Object.entries(operation.members)) {
                // Mover a la dueña implica alta arriba + retiro abajo en UN
                // delta. El traslado no debe cancelar su propia incorporacion.
                grouped[owner][field][name] = grouped[owner][field][name] === true || present;
            }
        }
    }
    for (const [owner, fields] of Object.entries(grouped)) {
        for (const [field, changes] of Object.entries(fields)) {
            const names = [...new Set(Object.entries(result).filter(([key]) => ownerOf(key) === owner)
                .flatMap(([, entry]) => members(entry[field])))].filter(name => changes[name] !== false);
            for (const [name, present] of Object.entries(changes)) if (present && !names.includes(name)) names.push(name);
            result[owner][field] = names;
            for (const [key, entry] of Object.entries(result)) {
                if (key !== owner && ownerOf(key) === owner && Object.hasOwn(entry, field)) entry[field] = [];
            }
        }
    }
    for (const [key, entry] of Object.entries(result)) {
        if (!Object.values(entry).some(value => Array.isArray(value) ? value.length > 0 : Boolean(value))) delete result[key];
    }
    return normalizeTaskAssignmentWeek(result);
}

// La materializacion debe conservar las invariantes de la grilla, incluso si
// el cierre/fusion y un alta llegaron desde sesiones distintas. Se prioriza
// que la persona siga visible: una casilla con gente queda abierta.
function taskAssignmentParents(result) {
    const parents = new Map();
    for (const [key, entry] of Object.entries(result)) {
        const [shift, taskId, day, ...extra] = key.split("|");
        if (!shift || !taskId || !day || extra.length || !entry.mergedNextTaskId) continue;
        const target = `${shift}|${entry.mergedNextTaskId}|${day}`;
        if (target === key || parents.has(target)) {
            // Un ciclo/enlace ambiguo no debe esconder casillas.
            delete entry.mergedNextTaskId;
            continue;
        }
        let cursor = key;
        const seen = new Set([target]);
        while (parents.has(cursor) && !seen.has(cursor)) { seen.add(cursor); cursor = parents.get(cursor); }
        if (seen.has(cursor)) { delete entry.mergedNextTaskId; continue; }
        parents.set(target, key);
    }
    return parents;
}

export function normalizeTaskAssignmentWeek(week = {}) {
    const result = Object.fromEntries(Object.entries(object(week)).map(([key, entry]) => [key, { ...entry }]));
    const parents = taskAssignmentParents(result);
    for (const [key, entry] of Object.entries(result)) {
        let owner = key;
        while (parents.has(owner)) owner = parents.get(owner);
        if (owner !== key) {
            const root = result[owner];
            for (const field of MEMBERSHIP_FIELDS) {
                root[field] = [...new Set([...members(root[field]), ...members(entry[field])])];
                if (Object.hasOwn(entry, field)) entry[field] = [];
            }
            const notes = [...new Set([root.note, entry.note].flatMap(value => String(value || "").split(" | "))
                .map(value => value.trim()).filter(Boolean))];
            if (notes.length) root.note = notes.join(" | ");
            if (entry.note) entry.note = "";
        }
    }
    for (const entry of Object.values(result)) {
        if (members(entry.workers).length && entry.closed === true) entry.closed = false;
    }
    return result;
}

export function planTaskAssignmentEntries({ moduleId, previousRaw, nextRaw }) {
    // Ante JSON corrupto no se interpreta "vacio" y no se planean borrados.
    const before = parse(previousRaw);
    const after = parse(nextRaw);
    const entries = [];
    for (const week of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const taskPatch = diffTaskAssignmentWeek(object(before[week]), object(after[week]));
        if (!Object.keys(taskPatch).length) continue;
        entries.push({
            moduleId,
            storageKey: TASK_ASSIGNMENTS_KEY,
            itemKey: week,
            value: JSON.stringify(object(after[week])),
            deleted: false,
            taskPatch
        });
    }
    return entries;
}

export function mergeTaskAssignmentEntries(earlier, later) {
    if (!earlier?.taskPatch || !later?.taskPatch) return later;
    return { ...later, taskPatch: composeTaskAssignmentPatches(earlier.taskPatch, later.taskPatch) };
}

export function guardTaskAssignmentEntry(entry, current = {}) {
    if (entry.storageKey !== TASK_ASSIGNMENTS_KEY) return entry;
    // Nunca volver al reemplazo de la semana si se pierde el delta en una cola.
    if (!entry.taskPatches) throw new Error("La asignacion de tareas requiere sus cambios por casilla.");
    const base = current.deleted === true ? {} : parse(current.value);
    const items = { ...entry.items };
    const deletedItems = { ...entry.deletedItems };
    for (const [encodedWeek, patch] of Object.entries(entry.taskPatches)) {
        const week = decodeURIComponent(encodedWeek);
        let latest;
        if (current.deletedItems?.[encodedWeek] === true) latest = {};
        else if (Object.hasOwn(current.items || {}, encodedWeek)) latest = parse(current.items[encodedWeek]);
        else if (Object.hasOwn(base, week)) latest = object(base[week]);
        // Compatibilidad: primera entrada de una semana que solo vivia en los
        // chunks antiguos. Si existe un item remoto, manda SIEMPRE ese item.
        else latest = parse(entry.items?.[encodedWeek]);
        items[encodedWeek] = JSON.stringify(applyTaskAssignmentPatch(latest, patch));
        deletedItems[encodedWeek] = false;
    }
    return { ...entry, items, deletedItems };
}
