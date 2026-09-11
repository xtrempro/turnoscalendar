// Resumen, para la bitacora, de lo que cambio en la asignacion de tareas de una
// semana. No toca el DOM ni el almacenamiento: recibe fotos de la semana y
// devuelve texto, asi se puede probar ejecutandolo.
//
// Se compara CADA guardado deliberado contra lo que habia justo antes, y solo se
// acumulan esos cambios. Comparar una foto al empezar con otra al terminar
// meteria en la cuenta lo que el saneado automatico hizo entre medio -quitar a
// alguien porque otro supervisor le aplico un permiso- y quedaria firmado por
// quien estaba editando tareas.

const DEFAULT_MAX_ITEMS = 8;

function workersOf(entry) {
    return Array.isArray(entry?.workers)
        ? entry.workers.map(name => String(name || "").trim()).filter(Boolean)
        : [];
}

// `removedDefaults` no se compara a proposito: es contabilidad interna de las
// reglas de predefinido, no algo que el supervisor vea ni decida.
const FIELD_READERS = {
    merged: entry => String(entry?.mergedNextTaskId || ""),
    closed: entry => entry?.closed === true,
    note: entry => String(entry?.note || "").trim()
};

export function splitCellKey(cellKey) {
    const [shift = "", taskId = "", keyDay = ""] =
        String(cellKey || "").split("|");

    return { shift, taskId, keyDay };
}

// Diferencias de UN guardado.
export function diffWeekAssignments(before = {}, after = {}) {
    const workers = [];
    const fields = [];
    const cellKeys = new Set([
        ...Object.keys(before || {}),
        ...Object.keys(after || {})
    ]);

    cellKeys.forEach(cellKey => {
        const previous = before?.[cellKey];
        const next = after?.[cellKey];
        const previousWorkers = workersOf(previous);
        const nextWorkers = workersOf(next);

        previousWorkers
            .filter(worker => !nextWorkers.includes(worker))
            .forEach(worker => workers.push({ cellKey, worker, delta: -1 }));
        nextWorkers
            .filter(worker => !previousWorkers.includes(worker))
            .forEach(worker => workers.push({ cellKey, worker, delta: 1 }));

        Object.entries(FIELD_READERS).forEach(([field, read]) => {
            const from = read(previous);
            const to = read(next);

            if (from !== to) {
                fields.push({ cellKey, field, before: from, after: to });
            }
        });
    });

    return { workers, fields };
}

export function createWeekChangeAccumulator() {
    return { workers: new Map(), fields: new Map() };
}

// Suma un guardado a lo acumulado. Poner y sacar a la misma persona de la misma
// casilla se anulan; en los campos vale lo que tenia la casilla antes del primer
// guardado que la toco contra lo del ultimo, asi que ida y vuelta no deja rastro.
export function accumulateWeekChanges(accumulator, diff) {
    (diff?.workers || []).forEach(({ cellKey, worker, delta }) => {
        const id = `${cellKey}|${worker}`;
        const total = (accumulator.workers.get(id)?.delta || 0) + delta;

        if (total === 0) {
            accumulator.workers.delete(id);
            return;
        }

        accumulator.workers.set(id, { cellKey, worker, delta: total });
    });

    (diff?.fields || []).forEach(({ cellKey, field, before, after }) => {
        const id = `${cellKey}|${field}`;
        const first = accumulator.fields.has(id)
            ? accumulator.fields.get(id).before
            : before;

        if (first === after) {
            accumulator.fields.delete(id);
            return;
        }

        accumulator.fields.set(id, { cellKey, field, before: first, after });
    });

    return accumulator;
}

export function weekChangesAreEmpty(accumulator) {
    return !accumulator?.workers?.size && !accumulator?.fields?.size;
}

// La clave del dia es `YYYY-M-D` con el mes desde 0: ordena sin crear fechas.
function dayOrder(keyDay) {
    const [year, month, day] = String(keyDay || "").split("-").map(Number);

    return ((year || 0) * 12 + (month || 0)) * 31 + (day || 0);
}

// Junta las frases que solo difieren en el dia: "quito a N. DOMINGUEZ de
// ECOGRAFO (vie 18, sab 19)" en vez de una por dia.
function groupedPhrases(items, baseOf, dayLabel) {
    const groups = new Map();

    items.forEach(item => {
        const base = baseOf(item);
        const group = groups.get(base) || {
            base,
            days: new Set(),
            first: dayOrder(item.keyDay)
        };

        group.days.add(item.keyDay);
        group.first = Math.min(group.first, dayOrder(item.keyDay));
        groups.set(base, group);
    });

    return [...groups.values()]
        .sort((a, b) => a.first - b.first)
        .map(group => {
            const days = [...group.days]
                .sort((a, b) => dayOrder(a) - dayOrder(b))
                .map(dayLabel);

            return `${group.base} (${days.join(", ")})`;
        });
}

export function describeWeekChanges(accumulator, {
    taskTitle = taskId => taskId,
    workerLabel = worker => worker,
    dayLabel = keyDay => keyDay,
    maxItems = DEFAULT_MAX_ITEMS
} = {}) {
    if (!accumulator || weekChangesAreEmpty(accumulator)) return null;

    const removed = [];
    const added = [];

    accumulator.workers.forEach(({ cellKey, worker, delta }) => {
        (delta < 0 ? removed : added).push({ ...splitCellKey(cellKey), worker });
    });

    // Sacar a alguien de una casilla y ponerlo en otra del mismo dia y turno es
    // UN movimiento: arrastrarlo, o combinar casillas, que sube a todos a la de
    // arriba. Contado como "quito" + "puso" parece que hubo dos decisiones.
    const moves = [];

    for (let index = removed.length - 1; index >= 0; index -= 1) {
        const out = removed[index];
        const match = added.findIndex(item =>
            item.worker === out.worker &&
            item.shift === out.shift &&
            item.keyDay === out.keyDay &&
            item.taskId !== out.taskId
        );

        if (match === -1) continue;

        const [into] = added.splice(match, 1);

        removed.splice(index, 1);
        moves.push({ ...out, toTaskId: into.taskId });
    }

    const fields = { merged: [], split: [], closed: [], opened: [], note: [] };

    accumulator.fields.forEach(({ cellKey, field, after }) => {
        const cell = splitCellKey(cellKey);

        if (field === "merged") {
            (after ? fields.merged : fields.split).push(cell);
        } else if (field === "closed") {
            (after ? fields.closed : fields.opened).push(cell);
        } else {
            fields.note.push(cell);
        }
    });

    // La misma tarea puede estar en los dos tableros: de noche se dice.
    const task = (taskId, shift) =>
        `${taskTitle(taskId)}${shift === "night" ? " de noche" : ""}`;
    const onBoard = (text, shift) =>
        shift === "night" ? `${text} de noche` : text;
    const who = worker => workerLabel(worker);

    const phrases = [
        ...groupedPhrases(
            moves,
            item => `movió a ${who(item.worker)} de ${task(item.taskId, item.shift)} a ${task(item.toTaskId, item.shift)}`,
            dayLabel
        ),
        ...groupedPhrases(
            removed,
            item => `quitó a ${who(item.worker)} de ${task(item.taskId, item.shift)}`,
            dayLabel
        ),
        ...groupedPhrases(
            added,
            item => `puso a ${who(item.worker)} en ${task(item.taskId, item.shift)}`,
            dayLabel
        ),
        ...groupedPhrases(
            fields.merged,
            item => onBoard("combinó casillas", item.shift),
            dayLabel
        ),
        ...groupedPhrases(
            fields.split,
            item => onBoard("separó casillas", item.shift),
            dayLabel
        ),
        ...groupedPhrases(
            fields.closed,
            item => `cerró ${task(item.taskId, item.shift)}`,
            dayLabel
        ),
        ...groupedPhrases(
            fields.opened,
            item => `abrió ${task(item.taskId, item.shift)}`,
            dayLabel
        ),
        ...groupedPhrases(
            fields.note,
            item => `editó la nota de ${task(item.taskId, item.shift)}`,
            dayLabel
        )
    ];

    const shown = phrases.slice(0, Math.max(1, maxItems));
    const rest = phrases.length - shown.length;
    const text = rest > 0
        ? `${shown.join("; ")}; y ${rest} cambio${rest === 1 ? "" : "s"} más`
        : shown.join("; ");

    return {
        text,
        counts: {
            moved: moves.length,
            removed: removed.length,
            added: added.length,
            merged: fields.merged.length,
            split: fields.split.length,
            closed: fields.closed.length,
            opened: fields.opened.length,
            notes: fields.note.length
        }
    };
}
