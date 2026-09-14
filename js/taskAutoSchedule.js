// Motor de la programacion automatica de tareas: sin estado, sin entorno.
//
// Aqui vive el QUE decide el reparto. Nada de localStorage, DOM ni relojes:
// todo entra por parametro y sale un plan que el que llama aplica -o no-.
// Existe separado de taskAssignments.js porque ese archivo ya es el panel
// entero y porque este reparto es lo unico que se puede probar de verdad en
// una prueba: se le da un historial de mentira y se mira a quien pone.
//
// La regla de negocio, en una linea: repartir al azar, pero NUNCA meter a
// alguien en una tarea que nunca ha hecho, y a los que hacen varias, irlos
// rotando entre ellas.
//
// Como se lee el historial (semanas ANTERIORES a la que se programa):
//
//   1. QUIEN puede ir a cada tarea. Solo entra quien ya aparecio en ella alguna
//      vez. Si nadie de esos esta de turno, la casilla se queda vacia a
//      proposito: es un hueco real que el supervisor tiene que ver, no una
//      invitacion a inventar una asignacion. Una tarea SIN historial no se
//      autorrellena.
//
//   2. CUANTOS van en cada casilla. Se mira cuanta gente llevo esa tarea ese
//      mismo dia de la semana y se toma el valor que mas se repite. Por eso
//      una tarea que los martes siempre estuvo vacia sigue vacia: su cupo es 0
//      y el motor ni la mira. Una sola aparicion de una persona en una tarea no
//      basta: eso puede ser una correccion puntual o una importacion rara, no
//      un patron. Cuando hay perfiles, tambien aprende la mezcla de estamentos
//      de ese cupo: si historicamente era 1 Profesional + 1 Tecnico, no lo
//      reemplaza por 2 Tecnicos solo porque habia disponibles.
//
//   3. LA ROTACION. Al que solo ha hecho una tarea se lo deja tranquilo en la
//      suya. Al que ha hecho varias se le sube el peso en la que hace mas
//      tiempo que no toca y se le baja en la que acaba de hacer, asi que a lo
//      largo de la semana va girando entre las suyas en vez de quedarse
//      clavado en una.
//
//   4. MULTITAREA EN UN MISMO TURNO. Por defecto una persona no se repite en
//      dos casillas del mismo turno y dia. Solo se permite cuando el historial
//      muestra repetidamente que esa misma persona suele cubrir juntas esas
//      tareas en el mismo turno. Aun asi, antes de repetir a alguien, se
//      intenta usar a quienes siguen disponibles sin tarea en ese turno.

import { keyToDate } from "./dateUtils.js";

// Cuantas semanas hacia atras se miran. Mas atras que esto el patron ya no
// describe como se trabaja hoy: la gente entra, sale y cambia de turno.
export const AUTO_SCHEDULE_HISTORY_WEEKS = 8;
// Cupo de una tarea sin historial: cero. La programacion automatica aprende
// de lo que ya ocurrio; una tarea que nadie ha hecho todavia queda para
// decision manual del supervisor.
export const AUTO_SCHEDULE_DEFAULT_HEADCOUNT = 0;
// Valor base para desempatar/modar cupos cuando SI hay historial presente.
const AUTO_SCHEDULE_FALLBACK_HEADCOUNT = 1;
// Techo del cupo aprendido. Protege de una semana rara del historial -una
// casilla fusionada, una jornada con todo el mundo dentro- que dejaria un cupo
// absurdo repitiendose para siempre.
export const AUTO_SCHEDULE_MAX_HEADCOUNT = 12;
// Cada cuanto tiene que aparecer una tarea en un dia para entender que ese dia
// se hace. Un tercio de los dias programados: por debajo de eso es una tarea
// que ese dia normalmente no va -MAMOGRAFIA los martes- y el cupo queda en 0.
export const AUTO_SCHEDULE_PRESENCE_RATE = 1 / 3;
// Minimo de veces que una persona debe haber hecho una tarea para que eso sea
// patron y no una aparicion aislada. Evita casos como una fila importada con un
// nombre accidental que despues se vuelve elegible para siempre.
export const AUTO_SCHEDULE_MIN_WORKER_TASK_DAYS = 2;
// Lo mismo para repetir a una persona en mas de una tarea del mismo turno: una
// coincidencia aislada no basta para aprender que ese doble rol es normal.
export const AUTO_SCHEDULE_MIN_MULTITASK_DAYS = 2;
// Minimo de dias para aprender que una tarea suele cubrirse con una condicion
// de turno concreta, por ejemplo rotativa diurno + turno real Larga.
export const AUTO_SCHEDULE_MIN_TURN_PATTERN_DAYS = 2;

const DAY_MS = 86400000;
// Piso del peso en el sorteo: con peso 0 la raiz 1/peso se va al infinito y el
// candidato deja de existir. Nadie elegible debe quedar en cero absoluto.
const MIN_WEIGHT = 0.0001;
// Cuanto pesa la afinidad (que parte del trabajo de esa persona es esta tarea).
// El 0.4 es el piso: el que hizo la tarea una sola vez sigue teniendo opcion.
const AFFINITY_FLOOR = 0.4;
// Cuanto pesa la antiguedad (hace cuanto que no hace ESTA tarea). Va de 0.5
// -recien hecha- a 1.5 -la que mas tiempo lleva sin tocar-.
const STALENESS_FLOOR = 0.5;
const STALENESS_RANGE = 1;
// Castigo por repetir la misma tarea dentro de la semana que se esta armando.
// Solo se le aplica al que tiene otras tareas donde ir.
const REPEAT_PENALTY = 0.6;
// Castigo por carga: cada casilla ya ganada en esta pasada baja un poco el
// peso, para que el reparto no se concentre en los mismos cuatro nombres.
const LOAD_PENALTY = 0.2;

/* ==========================================================================
   Lectura del historial
   ========================================================================== */

function cellParts(cellKey) {
    const [shift, taskId, keyDay] = String(cellKey || "").split("|");

    return { shift, taskId, keyDay };
}

function entryWorkers(entry) {
    return Array.isArray(entry?.workers)
        ? entry.workers.map(worker => String(worker || "").trim()).filter(Boolean)
        : [];
}

function weekdayOf(keyDay) {
    const date = keyToDate(keyDay);

    return Number.isNaN(date.getTime()) ? -1 : date.getDay();
}

function dayNumber(keyDay) {
    const date = keyToDate(keyDay);

    return Number.isNaN(date.getTime())
        ? 0
        : Math.floor(date.getTime() / DAY_MS);
}

function normalizedTaskIds(taskIds = []) {
    return [...new Set(
        (Array.isArray(taskIds) ? taskIds : [taskIds])
            .map(taskId => String(taskId || "").trim())
            .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, "es"));
}

function taskBundleSignature(taskIds = []) {
    return normalizedTaskIds(taskIds).join("\u001f");
}

function multitaskComboKey(shift, name, signature) {
    return `${String(shift || "")}|${String(name || "")}|${signature}`;
}

function taskSubsets(taskIds = []) {
    const ids = normalizedTaskIds(taskIds);
    const subsets = [];

    function visit(start, selected) {
        if (selected.length >= 2) subsets.push([...selected]);

        for (let index = start; index < ids.length; index += 1) {
            selected.push(ids[index]);
            visit(index + 1, selected);
            selected.pop();
        }
    }

    visit(0, []);

    return subsets;
}

function normalizeWorkerTaskMap(value) {
    const result = new Map();
    const entries = value instanceof Map
        ? [...value.entries()]
        : Object.entries(value || {});

    entries.forEach(([name, taskIds]) => {
        const cleanName = String(name || "").trim();
        const ids = taskIds instanceof Set
            ? [...taskIds]
            : Array.isArray(taskIds)
                ? taskIds
                : [taskIds];
        const normalized = normalizedTaskIds(ids);

        if (cleanName && normalized.length) {
            result.set(cleanName, new Set(normalized));
        }
    });

    return result;
}

function addWorkerTaskIds(target, name, taskIds) {
    const cleanName = String(name || "").trim();
    const ids = normalizedTaskIds(taskIds);

    if (!cleanName || !ids.length) return;

    const current = target.get(cleanName) || new Set();

    ids.forEach(taskId => current.add(taskId));
    target.set(cleanName, current);
}

function taskIdsForWorker(value, name) {
    return normalizeWorkerTaskMap(value).get(String(name || "").trim()) ||
        new Set();
}

function normalizeTextKey(value) {
    return String(value || "")
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function profileStaffingGroup(profile = {}) {
    const raw = String(profile?.estamento || "").trim();
    const key = normalizeTextKey(raw);

    if (key === "profesional") return "Profesional";
    if (key === "tecnico") return "T\u00e9cnico";
    if (key === "administrativo") return "Administrativo";
    if (key === "auxiliar") return "Auxiliar";

    return raw;
}

function workerStaffingGroups(profiles = []) {
    const groups = new Map();

    if (!Array.isArray(profiles)) return groups;

    profiles.forEach(profile => {
        const name = String(profile?.name || "").trim();
        const group = profileStaffingGroup(profile);

        if (name && group) groups.set(name, group);
    });

    return groups;
}

function cleanTurnValue(value) {
    const numberValue = Number(value);

    return Number.isFinite(numberValue) ? String(numberValue) : "";
}

function normalizeTurnContext(context = {}) {
    return {
        rotativaType: normalizeTextKey(context.rotativaType || context.rotativa),
        baseTurn: cleanTurnValue(context.baseTurn ?? context.base),
        actualTurn: cleanTurnValue(
            context.actualTurn ?? context.actual ?? context.turn
        ),
        extraTurn: cleanTurnValue(context.extraTurn ?? context.extra),
        profession: normalizeTextKey(context.profession)
    };
}

function turnContextSignature(context = {}) {
    const normalized = normalizeTurnContext(context);
    const parts = [
        ["rotativa", normalized.rotativaType],
        ["base", normalized.baseTurn],
        ["actual", normalized.actualTurn],
        ["extra", normalized.extraTurn],
        ["profesion", normalized.profession]
    ]
        .filter(([, value]) => value !== "")
        .map(([key, value]) => `${key}:${value}`);

    return parts.length ? parts.join("|") : "";
}

function turnSignatureSlots(groups) {
    const slots = [];

    (Array.isArray(groups) ? groups : decodeGroupCounts(groups))
        .forEach(item => {
            for (let index = 0; index < item.count; index += 1) {
                slots.push(item.group);
            }
        });

    return slots;
}

function workerTurnContextFor(options, name, keyDay) {
    if (typeof options?.workerTurnContextForDay === "function") {
        return options.workerTurnContextForDay(name, keyDay) || {};
    }

    const contexts = options?.workerTurnContexts;
    const key = `${String(name || "").trim()}|${String(keyDay || "").trim()}`;

    if (contexts instanceof Map) return contexts.get(key) || {};

    return contexts?.[key] || {};
}

function candidateTurnContextFor(cell, name) {
    const contexts = cell?.candidateTurnContextByWorker ||
        cell?.candidateTurnContextsByWorker ||
        {};
    const cleanName = String(name || "").trim();

    if (contexts instanceof Map) return contexts.get(cleanName) || {};

    return contexts[cleanName] || {};
}

export function workerMatchesTurnSignature(context, signature) {
    const expected = String(signature || "").trim();

    return Boolean(expected && turnContextSignature(context) === expected);
}

function groupCountTotal(groups) {
    if (groups instanceof Map) {
        return [...groups.values()]
            .reduce((sum, value) => sum + Math.max(Number(value) || 0, 0), 0);
    }

    if (Array.isArray(groups)) {
        return groups.reduce(
            (sum, item) => sum + Math.max(Number(item?.count) || 0, 0),
            0
        );
    }

    return 0;
}

function encodeGroupCounts(groups) {
    const entries = [...(groups || new Map()).entries()]
        .map(([group, count]) => [String(group || "").trim(), Number(count) || 0])
        .filter(([group, count]) => group && count > 0)
        .sort((a, b) => a[0].localeCompare(b[0], "es"));

    return entries.length ? JSON.stringify(entries) : "";
}

function decodeGroupCounts(signature) {
    try {
        return JSON.parse(signature)
            .map(([group, count]) => ({
                group: String(group || "").trim(),
                count: Math.max(Number(count) || 0, 0)
            }))
            .filter(item => item.group && item.count > 0);
    } catch (_error) {
        return [];
    }
}

function weeksForCell(history, shift, taskId, keyDay) {
    const firstWeek = history?.taskFirstWeek?.get(taskId) || "";
    const weekday = weekdayOf(keyDay);

    if (!firstWeek) return [];

    return (history?.activeColumns?.get(`${shift}|${weekday}`) || [])
        .filter(week => week >= firstWeek);
}

/**
 * Resume las semanas anteriores en el patron que usa el reparto.
 *
 * @param {Object} entriesByWeek mapa `{ [semanaISO]: { [claveCasilla]: entry } }`
 *   tal cual se guarda; la clave de casilla es `turno|tareaId|dia`.
 * @param {Object} options
 * @param {string} options.beforeWeekKey semana que se va a programar, en ISO.
 *   Solo se leen las anteriores: la que se esta armando no es patron de si
 *   misma.
 * @param {number} options.weeks cuantas semanas hacia atras mirar.
 * @returns {Object} historial listo para `planTaskAutoSchedule`.
 */
export function buildTaskAutoScheduleHistory(entriesByWeek = {}, {
    beforeWeekKey = "",
    weeks = AUTO_SCHEDULE_HISTORY_WEEKS,
    profiles = [],
    workerTurnContextForDay = null,
    workerTurnContexts = null
} = {}) {
    const limit = String(beforeWeekKey || "");
    const weekKeys = Object.keys(entriesByWeek || {})
        .filter(key => !limit || key < limit)
        .sort()
        .slice(-Math.max(Number(weeks) || 0, 1));
    const workerGroups = workerStaffingGroups(profiles);
    // Quien hizo cada tarea: tareaId -> nombre -> { veces, ultimo dia }.
    const tasks = new Map();
    // Quien es cada persona en el conjunto: nombre -> { veces, tareas }.
    const workers = new Map();
    // Cuanta gente hubo en cada casilla, semana por semana. NO se resume aqui:
    // el cupo se calcula despues, cuando se sabe contra que semanas comparar.
    const counts = new Map();
    // Mezcla de estamentos en cada casilla historica:
    // semana + turno + tarea + dia -> estamento -> cantidad.
    const groupCounts = new Map();
    // Columnas del tablero que ESTUVIERON programadas: turno + dia de la
    // semana -> semanas en que ese dia tuvo gente en alguna tarea.
    //
    // Esta es la referencia contra la que se mide el cupo, y no la semana
    // entera. En los datos reales media semana viene a medio programar: si el
    // jueves no se toco, la ausencia de la tarea ese jueves no dice "esta
    // tarea el jueves va vacia", dice "ese jueves no se programo nada".
    // Contarlo como un cero dejaba el tablero entero en cupo 0.
    const activeColumns = new Map();
    // Primera semana en que se ve la tarea. Sin esto, una tarea creada hace dos
    // semanas arrastraria los ceros de las seis anteriores -cuando ni existia-
    // y su cupo saldria 0 para siempre.
    const taskFirstWeek = new Map();
    // Persona + turno + dia historico -> tareas que hizo juntas ese dia.
    // Se resume despues en combinaciones repetidas, porque con una sola tarea
    // por dia no hay nada especial que aprender.
    const workerDayTasks = new Map();
    // Mezcla de condiciones de turno en cada casilla historica. Permite
    // aprender casos como "APOYO TURNO lo toma un diurno con Larga agregada".
    const turnCounts = new Map();
    const contextOptions = { workerTurnContextForDay, workerTurnContexts };

    weekKeys.forEach(weekKey => {
        const week = entriesByWeek[weekKey];

        if (!week || typeof week !== "object") return;

        const columnsUsed = new Set();

        Object.entries(week).forEach(([cellKey, entry]) => {
            const { shift, taskId, keyDay } = cellParts(cellKey);
            const names = entryWorkers(entry);

            // Una casilla vacia NO se guarda: se borra de la clave. Por eso el
            // vacio no se lee aqui sino por ausencia, al calcular el cupo.
            if (!shift || !taskId || !keyDay || !names.length) return;

            columnsUsed.add(`${shift}|${weekdayOf(keyDay)}`);

            const first = taskFirstWeek.get(taskId);

            if (!first || weekKey < first) taskFirstWeek.set(taskId, weekKey);

            const countKey = `${weekKey}|${shift}|${taskId}|${weekdayOf(keyDay)}`;

            counts.set(
                countKey,
                Math.max(counts.get(countKey) || 0, names.length)
            );

            const task = tasks.get(taskId) || new Map();
            const day = dayNumber(keyDay);
            const cellGroups = new Map();
            const cellTurnSignatures = new Map();

            names.forEach(name => {
                const stat = task.get(name) || { days: 0, lastDay: 0 };
                const group = workerGroups.get(name) || "";
                const turnSignature = turnContextSignature(
                    workerTurnContextFor(contextOptions, name, keyDay)
                );

                stat.days += 1;
                stat.lastDay = Math.max(stat.lastDay, day);
                task.set(name, stat);

                const worker = workers.get(name) ||
                    { days: 0, taskIds: new Set() };

                worker.days += 1;
                worker.taskIds.add(taskId);
                workers.set(name, worker);

                const dayTaskKey = `${weekKey}|${shift}|${keyDay}|${name}`;
                const dayTasks = workerDayTasks.get(dayTaskKey) || {
                    shift,
                    name,
                    day,
                    taskIds: new Set()
                };

                dayTasks.taskIds.add(taskId);
                workerDayTasks.set(dayTaskKey, dayTasks);

                if (group) {
                    cellGroups.set(group, (cellGroups.get(group) || 0) + 1);
                }

                if (turnSignature) {
                    cellTurnSignatures.set(
                        turnSignature,
                        (cellTurnSignatures.get(turnSignature) || 0) + 1
                    );
                }
            });

            if (groupCountTotal(cellGroups) === names.length) {
                groupCounts.set(countKey, cellGroups);
            }

            if (groupCountTotal(cellTurnSignatures) === names.length) {
                turnCounts.set(countKey, cellTurnSignatures);
            }

            tasks.set(taskId, task);
        });

        columnsUsed.forEach(column => {
            const list = activeColumns.get(column) || [];

            list.push(weekKey);
            activeColumns.set(column, list);
        });
    });

    const multiTaskCombos = new Map();

    workerDayTasks.forEach(dayTasks => {
        if (!dayTasks?.taskIds || dayTasks.taskIds.size < 2) return;

        taskSubsets([...dayTasks.taskIds]).forEach(taskIds => {
            const signature = taskBundleSignature(taskIds);
            const key = multitaskComboKey(
                dayTasks.shift,
                dayTasks.name,
                signature
            );
            const current = multiTaskCombos.get(key) || {
                days: 0,
                lastDay: 0
            };

            current.days += 1;
            current.lastDay = Math.max(current.lastDay, dayTasks.day || 0);
            multiTaskCombos.set(key, current);
        });
    });

    return {
        weeksSeen: weekKeys.length,
        weekKeys,
        tasks,
        workers,
        counts,
        groupCounts,
        turnCounts,
        workerGroups,
        activeColumns,
        taskFirstWeek,
        multiTaskCombos
    };
}

/* ==========================================================================
   Cupo por casilla
   ========================================================================== */

/**
 * Cuanta gente lleva esa tarea ese dia de la semana, segun el historial.
 *
 * Son dos preguntas, no una:
 *
 *   1. ¿Esa tarea se usa ese dia? Se mide contra los dias que SI se
 *      programaron: de los ultimos ocho martes que alguien programo, ¿en
 *      cuantos hubo alguien en MAMOGRAFIA? Por debajo de un tercio se
 *      entiende que ese dia la tarea no va, y el cupo es 0.
 *   2. Si va, ¿con cuanta gente? El valor que MAS se repite entre los dias en
 *      que si hubo gente -no el promedio-: si fue tres semanas con tres
 *      personas y una con una, el patron es tres, y el promedio (2,5) no es
 *      una dotacion que haya existido nunca. Empate: gana el mayor, que es el
 *      que cubre.
 *
 * Los ceros solo cuentan para la pregunta 1. Mezclarlos en la 2 hundia el
 * cupo: con datos reales, media semana viene a medio programar y los dias que
 * nadie toco enterraban a los que si.
 *
 * @returns {number} 0 si esa tarea ese dia suele ir vacia.
 */
export function headcountForCell(history, shift, taskId, keyDay) {
    const weekday = weekdayOf(keyDay);
    const weeks = weeksForCell(history, shift, taskId, keyDay);

    // Tarea nueva, o columna que nunca se programo: no hay patron suficiente
    // para inventar dotacion.
    if (!weeks.length) return AUTO_SCHEDULE_DEFAULT_HEADCOUNT;

    const counts = new Map();
    let present = 0;

    weeks.forEach(week => {
        const value = history.counts.get(
            `${week}|${shift}|${taskId}|${weekday}`
        ) || 0;

        if (!value) return;

        present += 1;
        counts.set(value, (counts.get(value) || 0) + 1);
    });

    if (present / weeks.length < AUTO_SCHEDULE_PRESENCE_RATE) return 0;

    let best = AUTO_SCHEDULE_FALLBACK_HEADCOUNT;
    let bestTimes = -1;

    counts.forEach((times, value) => {
        if (times > bestTimes || (times === bestTimes && value > best)) {
            best = value;
            bestTimes = times;
        }
    });

    return Math.min(Math.max(best, 0), AUTO_SCHEDULE_MAX_HEADCOUNT);
}

export function presenceRateForCell(history, shift, taskId, keyDay) {
    const weekday = weekdayOf(keyDay);
    const weeks = weeksForCell(history, shift, taskId, keyDay);

    if (!weeks.length) return 0;

    const present = weeks.filter(week =>
        (history.counts.get(`${week}|${shift}|${taskId}|${weekday}`) || 0) > 0
    ).length;

    return present / weeks.length;
}

function fillPriorityForTaskIds(history, shift, taskIds, keyDay) {
    return Math.max(
        0,
        ...normalizedTaskIds(taskIds).map(taskId =>
            presenceRateForCell(history, shift, taskId, keyDay)
        )
    );
}

export function staffingForCell(history, shift, taskId, keyDay) {
    const headcount = headcountForCell(history, shift, taskId, keyDay);

    if (!headcount) return { headcount, groups: [] };

    const weekday = weekdayOf(keyDay);
    const weeks = weeksForCell(history, shift, taskId, keyDay);
    const signatures = new Map();

    weeks.forEach(week => {
        const countKey = `${week}|${shift}|${taskId}|${weekday}`;
        const value = history?.counts?.get(countKey) || 0;
        const groups = history?.groupCounts?.get(countKey);

        if (value !== headcount || groupCountTotal(groups) !== value) return;

        const signature = encodeGroupCounts(groups);

        if (!signature) return;

        signatures.set(signature, (signatures.get(signature) || 0) + 1);
    });

    let best = "";
    let bestTimes = -1;

    signatures.forEach((times, signature) => {
        if (
            times > bestTimes ||
            (times === bestTimes && signature.localeCompare(best, "es") < 0)
        ) {
            best = signature;
            bestTimes = times;
        }
    });

    const groups = best ? decodeGroupCounts(best) : [];

    return {
        headcount,
        groups: groupCountTotal(groups) === headcount ? groups : []
    };
}

function staffingForTaskIds(history, shift, taskIds, keyDay) {
    const options = taskIds.map(taskId => ({
        taskId,
        ...staffingForCell(history, shift, taskId, keyDay)
    }));
    const headcount = Math.max(...options.map(item => item.headcount), 0);
    const grouped = options
        .filter(item =>
            item.headcount === headcount &&
            groupCountTotal(item.groups) === headcount
        )
        .sort((a, b) =>
            b.groups.length - a.groups.length ||
            String(a.taskId).localeCompare(String(b.taskId), "es")
        )[0];

    return {
        headcount,
        groups: grouped?.groups || []
    };
}

function turnPatternForCell(history, shift, taskId, keyDay) {
    const headcount = headcountForCell(history, shift, taskId, keyDay);

    if (!headcount) return { headcount, signatures: [] };

    const weekday = weekdayOf(keyDay);
    const weeks = weeksForCell(history, shift, taskId, keyDay);
    const signatures = new Map();

    weeks.forEach(week => {
        const countKey = `${week}|${shift}|${taskId}|${weekday}`;
        const value = history?.counts?.get(countKey) || 0;
        const turns = history?.turnCounts?.get(countKey);

        if (value !== headcount || groupCountTotal(turns) !== value) return;

        const signature = encodeGroupCounts(turns);

        if (!signature) return;

        signatures.set(signature, (signatures.get(signature) || 0) + 1);
    });

    let best = "";
    let bestTimes = -1;
    let tiedBest = 0;

    signatures.forEach((times, signature) => {
        if (times > bestTimes) {
            best = signature;
            bestTimes = times;
            tiedBest = 1;
            return;
        }

        if (times === bestTimes) {
            tiedBest += 1;
        }
    });

    if (
        !best ||
        bestTimes < AUTO_SCHEDULE_MIN_TURN_PATTERN_DAYS ||
        tiedBest > 1
    ) {
        return { headcount, signatures: [] };
    }

    const decoded = decodeGroupCounts(best);

    return {
        headcount,
        signatures: groupCountTotal(decoded) === headcount
            ? turnSignatureSlots(decoded)
            : []
    };
}

function turnPatternForTaskIds(history, shift, taskIds, keyDay) {
    const options = taskIds.map(taskId => ({
        taskId,
        ...turnPatternForCell(history, shift, taskId, keyDay)
    }));
    const headcount = Math.max(...options.map(item => item.headcount), 0);
    const patterned = options
        .filter(item =>
            item.headcount === headcount &&
            item.signatures.length === headcount
        )
        .sort((a, b) =>
            String(a.taskId).localeCompare(String(b.taskId), "es")
        )[0];

    return {
        headcount,
        signatures: patterned?.signatures || []
    };
}

/* ==========================================================================
   Quien puede ir a cada tarea
   ========================================================================== */

function taskHistoryFor(history, taskIds) {
    const merged = new Map();

    taskIds.forEach(taskId => {
        const task = history?.tasks?.get(taskId);

        if (!task) return;

        task.forEach((stat, name) => {
            const current = merged.get(name) || { days: 0, lastDay: 0 };

            merged.set(name, {
                days: current.days + stat.days,
                lastDay: Math.max(current.lastDay, stat.lastDay)
            });
        });
    });

    [...merged.entries()].forEach(([name, stat]) => {
        if ((stat?.days || 0) < AUTO_SCHEDULE_MIN_WORKER_TASK_DAYS) {
            merged.delete(name);
        }
    });

    return merged;
}

export function canWorkerShareShiftTasks(history, {
    name = "",
    shift = "",
    currentTaskIds = [],
    taskIds = []
} = {}) {
    const cleanName = String(name || "").trim();
    const current = normalizedTaskIds(currentTaskIds);
    const next = normalizedTaskIds(taskIds);

    if (!cleanName || !shift || !next.length) return false;
    if (!current.length) return true;
    if (next.some(taskId => current.includes(taskId))) return false;

    const bundle = normalizedTaskIds([...current, ...next]);

    if (bundle.length <= 1) return true;

    const signature = taskBundleSignature(bundle);
    const stat = history?.multiTaskCombos?.get(
        multitaskComboKey(shift, cleanName, signature)
    );

    return (stat?.days || 0) >= AUTO_SCHEDULE_MIN_MULTITASK_DAYS;
}

function currentTaskIdsForCell(cell, name, taken = new Map()) {
    const current = new Set();

    taskIdsForWorker(cell?.existingTaskIdsByWorker, name)
        .forEach(taskId => current.add(taskId));
    (taken.get(String(name || "").trim()) || new Set())
        .forEach(taskId => current.add(taskId));

    return current;
}

function canCandidateUseCell(history, cell, name, taskIds, taken = new Map()) {
    return canWorkerShareShiftTasks(history, {
        name,
        shift: cell.shift,
        currentTaskIds: [...currentTaskIdsForCell(cell, name, taken)],
        taskIds
    });
}

function groupSlotsForCell(groups, cell, taskIds, history, taskWorkers, workerGroups) {
    const slots = [];

    groups.forEach(item => {
        for (let index = 0; index < item.count; index += 1) {
            slots.push(item.group);
        }
    });

    if (!slots.length) return [];

    const blocked = new Set((cell.blocked || []).map(name => String(name)));
    const reachByGroup = new Map();

    (cell.candidates || [])
        .map(name => String(name || "").trim())
        .filter(Boolean)
        .filter(name => !blocked.has(name) && taskWorkers.has(name))
        .filter(name => canCandidateUseCell(history, cell, name, taskIds))
        .forEach(name => {
            const group = workerGroups.get(name) || "";

            if (!group) return;

            reachByGroup.set(group, (reachByGroup.get(group) || 0) + 1);
        });

    return slots
        .map((group, index) => ({
            group,
            index,
            reach: reachByGroup.get(group) || 0
        }))
        .sort((a, b) => a.reach - b.reach || a.index - b.index)
        .map(item => item.group);
}

function groupReachForCell(groupSlots, cell, taskIds, history, taskWorkers, workerGroups) {
    if (!groupSlots.length) return 0;

    const required = new Set(groupSlots);
    const blocked = new Set((cell.blocked || []).map(name => String(name)));

    return (cell.candidates || [])
        .map(name => String(name || "").trim())
        .filter(Boolean)
        .filter(name => !blocked.has(name) && taskWorkers.has(name))
        .filter(name => canCandidateUseCell(history, cell, name, taskIds))
        .filter(name => required.has(workerGroups.get(name) || ""))
        .length;
}

function turnSlotsForCell(turnSignatures, cell, taskIds, history, taskWorkers) {
    if (!turnSignatures.length) return [];

    const blocked = new Set((cell.blocked || []).map(name => String(name)));
    const reachBySignature = new Map();

    (cell.candidates || [])
        .map(name => String(name || "").trim())
        .filter(Boolean)
        .filter(name => !blocked.has(name) && taskWorkers.has(name))
        .filter(name => canCandidateUseCell(history, cell, name, taskIds))
        .forEach(name => {
            const signature = turnContextSignature(
                candidateTurnContextFor(cell, name)
            );

            if (!signature) return;

            reachBySignature.set(
                signature,
                (reachBySignature.get(signature) || 0) + 1
            );
        });

    const usedBySignature = new Map();

    return turnSignatures
        .map((signature, index) => ({
            signature,
            index,
            reach: reachBySignature.get(signature) || 0
        }))
        .filter(item => {
            if (!item.reach) return false;

            const used = usedBySignature.get(item.signature) || 0;

            if (used >= item.reach) return false;

            usedBySignature.set(item.signature, used + 1);
            return true;
        })
        .sort((a, b) => a.reach - b.reach || a.index - b.index)
        .map(item => item.signature);
}

function fillAllEligibleCell(cell) {
    return cell?.fillAllEligible === true ||
        cell?.fillEligibleCandidates === true;
}

/* ==========================================================================
   Sorteo con peso
   ========================================================================== */

// Muestreo sin reemplazo proporcional al peso (Efraimidis-Spirakis): a cada
// candidato se le saca una llave `azar^(1/peso)` y ganan las mas altas. Es el
// azar que pidio el requerimiento, pero inclinado por el patron: el de siempre
// sale casi siempre, y el que hizo la tarea una vez sale de vez en cuando.
function drawWeighted(candidates, count, rng) {
    if (count <= 0) return [];

    return candidates
        .map(candidate => {
            const roll = rng();
            const value = roll > 0 && roll < 1 ? roll : 0.5;

            return {
                name: candidate.name,
                key: Math.pow(value, 1 / Math.max(candidate.weight, MIN_WEIGHT))
            };
        })
        .sort((a, b) => b.key - a.key)
        .slice(0, count)
        .map(candidate => candidate.name);
}

function lastDayOnTask(taskIndex, taskId, name) {
    return taskIndex?.get(taskId)?.get(name)?.lastDay || 0;
}

// Hace cuanto que esta persona no toca la tarea de esta casilla, medido contra
// la suya mas abandonada. 1 = es justo la que lleva mas tiempo sin hacer;
// cerca de 0 = la acaba de hacer.
function stalenessFor(name, { taskIndex, taskIds, planDay, stat }) {
    const idle = Math.max(planDay - (stat?.lastDay || 0), 0);
    let maxIdle = idle;

    taskIds.forEach(taskId => {
        maxIdle = Math.max(
            maxIdle,
            planDay - lastDayOnTask(taskIndex, taskId, name)
        );
    });

    return STALENESS_FLOOR + STALENESS_RANGE * (idle / Math.max(maxIdle, 1));
}

function candidateWeight(name, {
    taskWorkers,
    workerStats,
    taskIndex,
    planDay,
    runTotal,
    runOnTask,
}) {
    const load = 1 + runTotal * LOAD_PENALTY;

    const stat = taskWorkers.get(name);
    const worker = workerStats.get(name);
    const total = worker?.days || stat?.days || 1;
    const variety = worker?.taskIds?.size || 1;
    const affinity = AFFINITY_FLOOR + (stat?.days || 0) / total;

    // El que solo tiene UNA tarea no rota: no hay a donde moverlo, y castigarlo
    // por repetirla solo lograria dejar su casilla sin cubrir.
    if (variety <= 1) return affinity / load;

    const staleness = stalenessFor(name, {
        taskIndex,
        taskIds: [...worker.taskIds],
        planDay,
        stat
    });

    return affinity * staleness / ((1 + runOnTask * REPEAT_PENALTY) * load);
}

function candidatePoolForSlot(item, round, {
    stats,
    workerStats,
    taskIndex,
    workerGroups,
    taken,
    runTotals,
    runByTask,
    firstTaskOnly = false
}) {
    const { cell, taskIds, taskWorkers, groupSlots } = item;
    const blocked = new Set(
        (cell.blocked || []).map(name => String(name))
    );
    const planDay = dayNumber(cell.keyDay);
    const slotGroup = groupSlots[round] || "";
    const slotTurnSignature = item.turnSlots?.[round] || "";

    const pool = [...new Set(
        (cell.candidates || [])
            .map(name => String(name || "").trim())
            .filter(Boolean)
    )]
        .filter(name => !item.chosen.includes(name))
        .filter(name => !blocked.has(name))
        .filter(name => taskWorkers.has(name))
        .filter(name =>
            canCandidateUseCell(stats, cell, name, taskIds, taken)
        )
        .filter(name =>
            !slotGroup || workerGroups.get(name) === slotGroup
        )
        .filter(name =>
            !firstTaskOnly || !currentTaskIdsForCell(cell, name, taken).size
        );
    const turnMatchedPool = slotTurnSignature
        ? pool.filter(name =>
            workerMatchesTurnSignature(
                candidateTurnContextFor(cell, name),
                slotTurnSignature
            )
        )
        : [];

    return (turnMatchedPool.length ? turnMatchedPool : pool)
        .map(name => ({
            name,
            weight: candidateWeight(name, {
                taskWorkers,
                workerStats,
                taskIndex,
                planDay,
                runTotal: runTotals?.get(name) || 0,
                runOnTask: taskIds.reduce(
                    (sum, taskId) =>
                        sum + (runByTask?.get(`${taskId}|${name}`) || 0),
                    0
                )
            })
        }));
}

function seedTakenForCell(takenByDay, dayKey, cell) {
    const taken = takenByDay.get(dayKey) || new Map();

    takenByDay.set(dayKey, taken);
    normalizeWorkerTaskMap(cell.existingTaskIdsByWorker)
        .forEach((taskSet, name) => {
            addWorkerTaskIds(taken, name, [...taskSet]);
        });

    return taken;
}

function recordSlotAssignment({
    item,
    round,
    name,
    taken,
    touched,
    runTotals,
    runByTask
}) {
    item.slotAssignments[round] = name;
    item.chosen = item.slotAssignments.filter(Boolean);
    addWorkerTaskIds(taken, name, item.taskIds);
    touched.add(name);
    runTotals.set(name, (runTotals.get(name) || 0) + 1);
    item.taskIds.forEach(taskId => {
        const key = `${taskId}|${name}`;

        runByTask.set(key, (runByTask.get(key) || 0) + 1);
    });
}

function maximumSlotMatching(slotRows) {
    const matchByWorker = new Map();
    const matchBySlot = new Map();
    const order = slotRows
        .map((_slot, index) => index)
        .sort((left, right) =>
            slotRows[left].edges.length - slotRows[right].edges.length ||
            slotRows[left].order - slotRows[right].order
        );

    function trySlot(slotIndex, seenWorkers) {
        const row = slotRows[slotIndex];

        for (const edge of row.edges) {
            const name = edge.name;

            if (seenWorkers.has(name)) continue;
            seenWorkers.add(name);

            const previousSlot = matchByWorker.get(name);

            if (
                previousSlot === undefined ||
                trySlot(previousSlot, seenWorkers)
            ) {
                matchByWorker.set(name, slotIndex);
                matchBySlot.set(slotIndex, name);
                return true;
            }
        }

        return false;
    }

    order.forEach(slotIndex => {
        if (matchBySlot.has(slotIndex)) return;

        trySlot(slotIndex, new Set());
    });

    return matchBySlot;
}

function assignFirstTasksForDay({
    items,
    stats,
    workerStats,
    taskIndex,
    workerGroups,
    takenByDay,
    touched,
    runTotals,
    runByTask
}) {
    const dayKey = `${items[0]?.cell?.shift}|${items[0]?.cell?.keyDay}`;
    const taken = takenByDay.get(dayKey) || new Map();
    const rounds = Math.max(...items.map(item => item.headcount), 0);
    let assignments = 0;

    takenByDay.set(dayKey, taken);
    items.forEach(item => {
        seedTakenForCell(takenByDay, dayKey, item.cell);
    });

    for (let round = 0; round < rounds; round += 1) {
        const slots = [];

        items.forEach(item => {
            if (round >= item.headcount || item.slotAssignments[round]) return;

            slots.push({
                item,
                round,
                order: slots.length
            });
        });

        const slotRows = slots
            .map(slot => ({
                ...slot,
                edges: candidatePoolForSlot(slot.item, slot.round, {
                    stats,
                    workerStats,
                    taskIndex,
                    workerGroups,
                    taken,
                    runTotals,
                    runByTask,
                    firstTaskOnly: true
                })
            }))
            .filter(row => row.edges.length);
        const optionsByWorker = new Map();

        slotRows.forEach(row => {
            row.edges.forEach(edge => {
                optionsByWorker.set(
                    edge.name,
                    (optionsByWorker.get(edge.name) || 0) + 1
                );
            });
        });
        slotRows.forEach(row => {
            row.edges.sort((left, right) =>
                (optionsByWorker.get(left.name) || 0) -
                    (optionsByWorker.get(right.name) || 0) ||
                right.weight - left.weight ||
                left.name.localeCompare(right.name, "es")
            );
        });

        const matching = maximumSlotMatching(slotRows);

        [...matching.entries()]
            .sort(([left], [right]) =>
                slotRows[left].order - slotRows[right].order
            )
            .forEach(([slotIndex, name]) => {
                const slot = slotRows[slotIndex];

                if (!slot || slot.item.slotAssignments[slot.round]) return;

                recordSlotAssignment({
                    item: slot.item,
                    round: slot.round,
                    name,
                    taken,
                    touched,
                    runTotals,
                    runByTask
                });
                assignments += 1;
            });
    }

    return assignments;
}

/* ==========================================================================
   El reparto
   ========================================================================== */

/**
 * Reparte trabajadores en las casillas que se le entreguen.
 *
 * @param {Object} options
 * @param {Array} options.cells casillas a llenar. Cada una:
 *   `{ shift, keyDay, taskId, taskIds, candidates, existingTaskIdsByWorker, blocked, fillAllEligible }`.
 *   - `taskIds`: las tareas que cubre la casilla (una sola, o todas las del
 *     grupo si esta fusionada). El historial de todas suma para decidir quien
 *     puede entrar.
 *   - `candidates`: nombres que ESE dia y turno pueden trabajar. El motor no
 *     sabe de turnos ni de licencias; eso lo resuelve quien llama.
 *   - `existingTaskIdsByWorker`: tareas donde esa persona ya esta asignada en
 *     el mismo dia y turno. Solo se le agrega otra si hay patron multitarea.
 *   - `blocked`: nombres que no deben volver a esa casilla (un predefinido que
 *     el supervisor saco a mano).
 *   - `fillAllEligible`: llena hasta incluir a todos los candidatos elegibles
 *     por historial, pensado para casillas unidas de dias inhabiles.
 * @param {Object} options.history salida de `buildTaskAutoScheduleHistory`.
 * @param {Function} options.rng fuente de azar, inyectable para las pruebas.
 * @returns {{filled: Array, skipped: Array, assignments: number, workers: Array}}
 */
export function planTaskAutoSchedule({
    cells = [],
    history = null,
    rng = Math.random
} = {}) {
    const stats = history || buildTaskAutoScheduleHistory({});
    const workerStats = stats.workers || new Map();
    const workerGroups = stats.workerGroups || new Map();
    // Para medir la rotacion el peso tiene que saltar de una tarea a otra de la
    // misma persona, asi que necesita el indice por tarea a mano.
    const taskIndex = stats.tasks || new Map();
    // Tareas que lleva cada persona en el turno/dia que se esta armando. Si se
    // repite en otra casilla, tiene que calzar con un patron multitarea
    // aprendido del historial.
    const takenByDay = new Map();
    const runTotals = new Map();
    const runByTask = new Map();
    const filled = [];
    const skipped = [];
    const touched = new Set();
    let assignments = 0;

    const prepared = cells.map(cell => {
        const taskIds = cell.taskIds?.length ? cell.taskIds : [cell.taskId];
        const taskWorkers = taskHistoryFor(stats, taskIds);
        const staffing = staffingForTaskIds(
            stats,
            cell.shift,
            taskIds,
            cell.keyDay
        );
        const turnPattern = turnPatternForTaskIds(
            stats,
            cell.shift,
            taskIds,
            cell.keyDay
        );
        const groupSlots = groupSlotsForCell(
            staffing.groups,
            cell,
            taskIds,
            stats,
            taskWorkers,
            workerGroups
        );
        const turnSlots = turnSlotsForCell(
            turnPattern.signatures,
            cell,
            taskIds,
            stats,
            taskWorkers
        );
        const fillAllEligible = fillAllEligibleCell(cell);
        const blocked = new Set(
            (cell.blocked || []).map(name => String(name))
        );
        const historyReach = (cell.candidates || [])
            .map(name => String(name || "").trim())
            .filter(Boolean)
            .filter(name => !blocked.has(name) && taskWorkers.has(name))
            .length;
        const reach = (cell.candidates || [])
            .map(name => String(name || "").trim())
            .filter(Boolean)
            .filter(name => !blocked.has(name) && taskWorkers.has(name))
            .filter(name => canCandidateUseCell(stats, cell, name, taskIds))
            .length;
        const effectiveGroupSlots = fillAllEligible ? [] : groupSlots;
        const effectiveTurnSlots = fillAllEligible ? [] : turnSlots;
        const effectiveHeadcount = fillAllEligible ? reach : staffing.headcount;
        const fillPriority = fillPriorityForTaskIds(
            stats,
            cell.shift,
            taskIds,
            cell.keyDay
        );

        return {
            cell,
            taskIds,
            taskWorkers,
            headcount: effectiveHeadcount,
            fillAllEligible,
            fillPriority,
            groupSlots: effectiveGroupSlots,
            groupReach: groupReachForCell(
                effectiveGroupSlots,
                cell,
                taskIds,
                stats,
                taskWorkers,
                workerGroups
            ),
            // Cuantos podrian entrar hoy. Ordenar por esto es lo que evita que
            // una tarea con dos personas posibles se quede sin nadie porque
            // otra tarea, que podia elegir entre veinte, se los llevo.
            reach,
            // Desempate al azar entre casillas igual de apretadas. Sin esto el
            // orden del catalogo decide siempre lo mismo: al que solo alcanza
            // para una de dos tareas se lo lleva la que este mas arriba, y esa
            // persona no rota nunca, por mucho peso que se le calcule.
            jitter: rng(),
            chosen: [],
            turnSlots: effectiveTurnSlots,
            slotAssignments: Array(effectiveHeadcount).fill(""),
            historyReach
        };
    });

    const ordered = prepared
        .filter(item => item.headcount > 0)
        .sort((a, b) =>
            dayNumber(a.cell.keyDay) - dayNumber(b.cell.keyDay) ||
            String(a.cell.shift).localeCompare(String(b.cell.shift)) ||
            b.fillPriority - a.fillPriority ||
            a.reach - b.reach ||
            a.jitter - b.jitter
        );
    const orderedByDay = new Map();

    ordered.forEach(item => {
        const dayKey = `${item.cell.shift}|${item.cell.keyDay}`;
        const list = orderedByDay.get(dayKey) || [];

        list.push(item);
        orderedByDay.set(dayKey, list);
    });
    orderedByDay.forEach(items => {
        assignments += assignFirstTasksForDay({
            items,
            stats,
            workerStats,
            taskIndex,
            workerGroups,
            takenByDay,
            touched,
            runTotals,
            runByTask
        });
    });

    // Se reparte POR VUELTAS, no casilla por casilla hasta llenarla: primero
    // una persona a cada casilla, despues la segunda, y asi. Llenando de una
    // sola pasada, dos casillas que se pelean a la misma gente terminaban con
    // la primera completa y la segunda sin nadie; nadie programa asi.
    const rounds = Math.max(...ordered.map(item => item.headcount), 0);

    for (let round = 0; round < rounds; round += 1) {
        ordered.forEach(item => {
            const { cell, taskIds, taskWorkers, headcount, groupSlots } = item;

            if (item.slotAssignments[round] || headcount <= round) return;

            const dayKey = `${cell.shift}|${cell.keyDay}`;
            const taken = seedTakenForCell(takenByDay, dayKey, cell);
            const pool = candidatePoolForSlot(item, round, {
                stats,
                workerStats,
                taskIndex,
                workerGroups,
                taken,
                runTotals,
                runByTask
            });
            const workersWithoutTask = pool.filter(candidate =>
                !currentTaskIdsForCell(cell, candidate.name, taken).size
            );
            const drawPool = workersWithoutTask.length
                ? workersWithoutTask
                : pool;

            if (!drawPool.length) return;

            const [name] = drawWeighted(drawPool, 1, rng);

            recordSlotAssignment({
                item,
                round,
                name,
                taken,
                touched,
                runTotals,
                runByTask
            });
            assignments += 1;
        });
    }

    prepared.forEach(item => {
        const {
            cell,
            headcount,
            chosen,
            historyReach,
            groupReach,
            groupSlots,
            fillAllEligible,
            taskIds,
            turnSlots
        } = item;

        if (!headcount) {
            skipped.push({
                ...cellRef(cell),
                reason: fillAllEligible
                    ? reasonFor(cell, historyReach, groupReach, groupSlots.length)
                    : "sin-cupo"
            });
            return;
        }

        if (!chosen.length) {
            skipped.push({
                ...cellRef(cell),
                // Los tres motivos por los que una casilla se queda vacia son
                // distintos y el resumen los cuenta por separado:
                //   sin-turno     ese dia no habia nadie disponible;
                //   sin-historial los que habia nunca hicieron esta tarea;
                //   sin-estamento los que habia no calzan con la mezcla usual;
                //   sin-gente     si los habia, pero se los llevaron otras
                //                 casillas del mismo dia, o no tenian patron
                //                 multitarea para repetirse ahi.
                reason: reasonFor(
                    cell,
                    historyReach,
                    groupReach,
                    groupSlots.length
                )
            });
            return;
        }

        const chosenTurnSlots = item.slotAssignments
            .map((name, index) => name ? (turnSlots[index] || "") : null)
            .filter(value => value !== null);

        filled.push({
            ...cellRef(cell),
            taskIds,
            workers: chosen,
            headcount,
            turnSlots: chosenTurnSlots,
            // Una casilla que pedia tres y consiguio una no es un exito
            // callado: el resumen tiene que poder decirlo.
            short: Math.max(headcount - chosen.length, 0)
        });
    });

    return {
        filled,
        skipped,
        assignments,
        workers: [...touched]
    };
}

function cellRef(cell) {
    return {
        shift: cell.shift,
        taskId: cell.taskId,
        keyDay: cell.keyDay
    };
}

function reasonFor(cell, reach, groupReach = 0, hasGroupSlots = false) {
    if (!cell.candidates?.length) return "sin-turno";
    if (!reach) return "sin-historial";
    if (hasGroupSlots && !groupReach) return "sin-estamento";

    return "sin-gente";
}
