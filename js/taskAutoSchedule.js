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
//      y el motor ni la mira. La medida es contra los dias que SE PROGRAMARON,
//      no contra las semanas: media semana suele venir a medio programar, y un
//      jueves que nadie toco no es un jueves sin dotacion.
//
//   3. LA ROTACION. Al que solo ha hecho una tarea se lo deja tranquilo en la
//      suya. Al que ha hecho varias se le sube el peso en la que hace mas
//      tiempo que no toca y se le baja en la que acaba de hacer, asi que a lo
//      largo de la semana va girando entre las suyas en vez de quedarse
//      clavado en una.

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
        ? entry.workers.filter(Boolean).map(String)
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
    weeks = AUTO_SCHEDULE_HISTORY_WEEKS
} = {}) {
    const limit = String(beforeWeekKey || "");
    const weekKeys = Object.keys(entriesByWeek || {})
        .filter(key => !limit || key < limit)
        .sort()
        .slice(-Math.max(Number(weeks) || 0, 1));
    // Quien hizo cada tarea: tareaId -> nombre -> { veces, ultimo dia }.
    const tasks = new Map();
    // Quien es cada persona en el conjunto: nombre -> { veces, tareas }.
    const workers = new Map();
    // Cuanta gente hubo en cada casilla, semana por semana. NO se resume aqui:
    // el cupo se calcula despues, cuando se sabe contra que semanas comparar.
    const counts = new Map();
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

            names.forEach(name => {
                const stat = task.get(name) || { days: 0, lastDay: 0 };

                stat.days += 1;
                stat.lastDay = Math.max(stat.lastDay, day);
                task.set(name, stat);

                const worker = workers.get(name) ||
                    { days: 0, taskIds: new Set() };

                worker.days += 1;
                worker.taskIds.add(taskId);
                workers.set(name, worker);
            });
            tasks.set(taskId, task);
        });

        columnsUsed.forEach(column => {
            const list = activeColumns.get(column) || [];

            list.push(weekKey);
            activeColumns.set(column, list);
        });
    });

    return {
        weeksSeen: weekKeys.length,
        weekKeys,
        tasks,
        workers,
        counts,
        activeColumns,
        taskFirstWeek
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
    const firstWeek = history?.taskFirstWeek?.get(taskId) || "";
    const weekday = weekdayOf(keyDay);
    const weeks = (history?.activeColumns?.get(`${shift}|${weekday}`) || [])
        .filter(week => week >= firstWeek);

    // Tarea nueva, o columna que nunca se programo: no hay patron suficiente
    // para inventar dotacion.
    if (!firstWeek || !weeks.length) return AUTO_SCHEDULE_DEFAULT_HEADCOUNT;

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

    return merged;
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

/* ==========================================================================
   El reparto
   ========================================================================== */

/**
 * Reparte trabajadores en las casillas que se le entreguen.
 *
 * @param {Object} options
 * @param {Array} options.cells casillas a llenar. Cada una:
 *   `{ shift, keyDay, taskId, taskIds, candidates, blocked }`.
 *   - `taskIds`: las tareas que cubre la casilla (una sola, o todas las del
 *     grupo si esta fusionada). El historial de todas suma para decidir quien
 *     puede entrar.
 *   - `candidates`: nombres que ESE dia y turno pueden trabajar y no estan ya
 *     en otra tarea. El motor no sabe de turnos ni de licencias; eso lo
 *     resuelve quien llama.
 *   - `blocked`: nombres que no deben volver a esa casilla (un predefinido que
 *     el supervisor saco a mano).
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
    // Para medir la rotacion el peso tiene que saltar de una tarea a otra de la
    // misma persona, asi que necesita el indice por tarea a mano.
    const taskIndex = stats.tasks || new Map();
    // Una persona por turno y dia: si ya quedo en una tarea del lunes diurno,
    // no puede aparecer en otra del mismo lunes diurno.
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
        const headcount = Math.max(
            ...taskIds.map(taskId => headcountForCell(
                stats,
                cell.shift,
                taskId,
                cell.keyDay
            ))
        );

        return {
            cell,
            taskIds,
            taskWorkers,
            headcount,
            // Cuantos podrian entrar hoy. Ordenar por esto es lo que evita que
            // una tarea con dos personas posibles se quede sin nadie porque
            // otra tarea, que podia elegir entre veinte, se los llevo.
            reach: (cell.candidates || [])
                .filter(name => taskWorkers.has(name)).length,
            // Desempate al azar entre casillas igual de apretadas. Sin esto el
            // orden del catalogo decide siempre lo mismo: al que solo alcanza
            // para una de dos tareas se lo lleva la que este mas arriba, y esa
            // persona no rota nunca, por mucho peso que se le calcule.
            jitter: rng(),
            chosen: []
        };
    });

    const ordered = prepared
        .filter(item => item.headcount > 0)
        .sort((a, b) =>
            dayNumber(a.cell.keyDay) - dayNumber(b.cell.keyDay) ||
            String(a.cell.shift).localeCompare(String(b.cell.shift)) ||
            a.reach - b.reach ||
            a.jitter - b.jitter
        );
    // Se reparte POR VUELTAS, no casilla por casilla hasta llenarla: primero
    // una persona a cada casilla, despues la segunda, y asi. Llenando de una
    // sola pasada, dos casillas que se pelean a la misma gente terminaban con
    // la primera completa y la segunda sin nadie; nadie programa asi.
    const rounds = Math.max(...ordered.map(item => item.headcount), 0);

    for (let round = 0; round < rounds; round += 1) {
        ordered.forEach(item => {
            const { cell, taskIds, taskWorkers, headcount } = item;

            if (item.chosen.length > round || headcount <= round) return;

            const dayKey = `${cell.shift}|${cell.keyDay}`;
            const taken = takenByDay.get(dayKey) || new Set();

            takenByDay.set(dayKey, taken);

            const blocked = new Set(
                (cell.blocked || []).map(name => String(name))
            );
            const planDay = dayNumber(cell.keyDay);
            const pool = (cell.candidates || [])
                .map(name => String(name))
                .filter(name => !taken.has(name) && !blocked.has(name))
                .filter(name => taskWorkers.has(name))
                .map(name => ({
                    name,
                    weight: candidateWeight(name, {
                        taskWorkers,
                        workerStats,
                        taskIndex,
                        planDay,
                        runTotal: runTotals.get(name) || 0,
                        runOnTask: taskIds.reduce(
                            (sum, taskId) =>
                                sum + (runByTask.get(`${taskId}|${name}`) || 0),
                            0
                        )
                    })
                }));

            if (!pool.length) return;

            const [name] = drawWeighted(pool, 1, rng);

            item.chosen.push(name);
            taken.add(name);
            touched.add(name);
            runTotals.set(name, (runTotals.get(name) || 0) + 1);
            taskIds.forEach(taskId => {
                const key = `${taskId}|${name}`;

                runByTask.set(key, (runByTask.get(key) || 0) + 1);
            });
            assignments += 1;
        });
    }

    prepared.forEach(item => {
        const { cell, headcount, chosen, reach } = item;

        if (!headcount) {
            skipped.push({ ...cellRef(cell), reason: "sin-cupo" });
            return;
        }

        if (!chosen.length) {
            skipped.push({
                ...cellRef(cell),
                // Los tres motivos por los que una casilla se queda vacia son
                // distintos y el resumen los cuenta por separado:
                //   sin-turno     ese dia no habia nadie disponible;
                //   sin-historial los que habia nunca hicieron esta tarea;
                //   sin-gente     si los habia, pero se los llevaron otras
                //                 casillas del mismo dia.
                reason: reasonFor(cell, reach)
            });
            return;
        }

        filled.push({
            ...cellRef(cell),
            workers: chosen,
            headcount,
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

function reasonFor(cell, reach) {
    if (!cell.candidates?.length) return "sin-turno";

    return reach ? "sin-gente" : "sin-historial";
}
