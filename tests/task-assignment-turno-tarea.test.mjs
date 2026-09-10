// El turno de la tarea: una tarea puede ir en los dos tableros -como hasta
// ahora-, solo en el diurno o solo en el de noche.
//
// Tres cosas que, si se rompen, no se quejan solas:
//
//   A. El turno viaja en `shiftScope`, y `shift` se sigue guardando como
//      "both". Un cliente sin actualizar lee "day" como "catalogo viejo, uno
//      por turno" y REESCRIBE el catalogo entero (migrateTaskCatalogIfNeeded).
//   B. Lo que va por indice -la fusion de casillas- mira la lista del TABLERO,
//      no el catalogo: con una tarea de noche en medio, la casilla de abajo de
//      una diurna es la de la siguiente diurna.
//   C. "Cada N turnos" en una tarea solo diurna cuenta solo turnos DIURNOS. Con
//      "cada turno" el trabajador queda predefinido todos los turnos que le
//      toque venir de dia, y sus noches no corren la cuenta.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { TURNO } from "../js/constants.js";

const src = await readFile(
    new URL("../js/taskAssignments.js", import.meta.url),
    "utf8"
);

function grab(source, name) {
    let start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `no se encontro ${name}`);
    if (source.slice(start - 7, start) === "export ") start -= 7;
    let paren = 0;
    let i = source.indexOf("(", start);
    for (; i < source.length; i += 1) {
        if (source[i] === "(") paren += 1;
        else if (source[i] === ")") { paren -= 1; if (!paren) { i += 1; break; } }
    }
    let depth = 0;
    for (let j = source.indexOf("{", i); j < source.length; j += 1) {
        if (source[j] === "{") depth += 1;
        else if (source[j] === "}") { depth -= 1; if (!depth) return source.slice(start, j + 1); }
    }
    throw new Error(`sin cierre: ${name}`);
}

const api = new Function(`
    const GENERIC_TASK_SHIFT = "both";
    const SHIFT_TYPES = ["day", "night"];
    ${grab(src, "normalizeTaskShiftScope")}
    ${grab(src, "taskShiftScope")}
    ${grab(src, "taskAppliesToShift")}
    ${grab(src, "tasksForShift")}
    ${grab(src, "oppositeShift")}
    ${grab(src, "assignmentKey")}
    ${grab(src, "getCellEntry")}
    ${grab(src, "mergedNextIdOf")}
    ${grab(src, "isMergedWithNext")}
    ${grab(src, "columnGroups")}
    ${grab(src, "shiftOrderForRule")}
    return {
        normalizeTaskShiftScope,
        taskAppliesToShift,
        tasksForShift,
        oppositeShift,
        columnGroups,
        shiftOrderForRule
    };
`)();

const CATALOGO = [
    { id: "t_dia", title: "Sala de yeso", shift: "both", shiftScope: "day" },
    { id: "t_noche", title: "Ronda nocturna", shift: "both", shiftScope: "night" },
    { id: "t_ambos", title: "Control de stock", shift: "both", shiftScope: "both" }
];

test("una tarea sin shiftScope sigue yendo en los dos tableros", () => {
    // Todo el catalogo en produccion es asi: sin el campo nuevo, la tarea es la
    // de siempre y se dibuja en los dos.
    const vieja = { id: "t", title: "X", shift: "both" };

    assert.equal(api.normalizeTaskShiftScope(undefined, "both"), "both");
    assert.equal(api.taskAppliesToShift(vieja, "day"), true);
    assert.equal(api.taskAppliesToShift(vieja, "night"), true);
});

test("un catalogo viejo hereda el turno con el que se guardo la tarea", () => {
    // Antes de que el catalogo fuera uno solo, la tarea vivia en el tablero de
    // su `shift`. Eso es exactamente lo que ahora significa `shiftScope`.
    assert.equal(api.normalizeTaskShiftScope(undefined, "night"), "night");
    assert.equal(api.normalizeTaskShiftScope("", "day"), "day");
    // Y cualquier valor raro cae en "los dos", que es lo que no pierde nada.
    assert.equal(api.normalizeTaskShiftScope("madrugada", "madrugada"), "both");
});

test("cada tablero muestra sus tareas y las de ambos turnos", () => {
    assert.deepEqual(
        api.tasksForShift(CATALOGO, "day").map(task => task.id),
        ["t_dia", "t_ambos"]
    );
    assert.deepEqual(
        api.tasksForShift(CATALOGO, "night").map(task => task.id),
        ["t_noche", "t_ambos"]
    );
});

test("quitar la tarea de un turno la deja en el otro", () => {
    assert.equal(api.oppositeShift("night"), "day");
    assert.equal(api.oppositeShift("day"), "night");
});

test("la fusion de casillas se mide contra la columna, no contra el catalogo", () => {
    // En el tablero diurno, la casilla de abajo de "Sala de yeso" es la de
    // "Control de stock": la tarea de noche del medio no esta ahi. Si la fusion
    // mirara el catalogo entero, el enlace apuntaria a la nocturna y no se
    // dibujaria unida ninguna.
    const assignments = {
        "day|t_dia|2026-8-1": {
            workers: ["ANA"],
            note: "",
            removedDefaults: [],
            mergedNextTaskId: "t_ambos"
        }
    };
    const grupos = api.columnGroups(assignments, "day", CATALOGO, "2026-8-1");

    assert.deepEqual(
        grupos.map(group => group.taskIds),
        [["t_dia", "t_ambos"]]
    );
    // Y el indice del grupo es el de la columna: la fila 0 del tablero diurno.
    assert.equal(grupos[0].start, 0);
});

test("la noche no ve la fusion de la columna diurna", () => {
    const assignments = {
        "day|t_dia|2026-8-1": {
            workers: [],
            note: "",
            removedDefaults: [],
            mergedNextTaskId: "t_ambos"
        }
    };
    const grupos = api.columnGroups(assignments, "night", CATALOGO, "2026-8-1");

    assert.deepEqual(
        grupos.map(group => group.taskIds),
        [["t_noche"], ["t_ambos"]]
    );
});

test("la secuencia de 'cada N turnos' cuenta solo los turnos del tablero", () => {
    assert.deepEqual(api.shiftOrderForRule(false, "both"), ["day", "night"]);
    assert.deepEqual(api.shiftOrderForRule(false, "day"), ["day"]);
    assert.deepEqual(api.shiftOrderForRule(false, "night"), ["night"]);
    // "Cada N turnos diurno habil" ya era solo diurna.
    assert.deepEqual(api.shiftOrderForRule(true, "night"), ["day"]);
});

test("el catalogo se guarda con shift 'both' y el turno aparte", () => {
    // Si `shift` saliera "day", un cliente sin actualizar lo tomaria por un
    // catalogo viejo y lo reescribiria entero.
    const guardar = grab(src, "saveTasks");

    assert.match(guardar, /shift: GENERIC_TASK_SHIFT/);
    assert.match(guardar, /shiftScope: taskShiftScope\(task\)/);

    const crear = grab(src, "addTask");

    assert.match(crear, /shift: GENERIC_TASK_SHIFT/);
    assert.match(crear, /shiftScope: normalizeTaskShiftScope\(shiftScope\)/);
});

test("el alta pregunta por el turno y llega marcado 'Ambos'", () => {
    const formulario = grab(src, "renderTaskScopeChoice");

    assert.match(formulario, /value: GENERIC_TASK_SHIFT, label: "Ambos"/);
    assert.match(formulario, /value: "day"/);
    assert.match(formulario, /value: "night"/);
    // El que no mire el selector obtiene la tarea de siempre.
    assert.match(formulario, /option\.value === GENERIC_TASK_SHIFT \? "checked" : ""/);

    const alta = src.slice(src.indexOf('querySelectorAll("[data-task-add-form]")'));

    assert.match(
        alta.slice(0, alta.indexOf("querySelectorAll", 40)),
        /addTask\(data\.get\("title"\), data\.get\("shiftScope"\)\)/
    );
});

// ---------------------------------------------------------------------------
// La proyeccion a la PWA del trabajador: es la que decide que tarea ve cada uno
// en su dia, y corre igual en el navegador y en la Cloud Function.
// ---------------------------------------------------------------------------

function createMemoryStorage() {
    const entries = new Map();

    return {
        get length() {
            return entries.size;
        },
        clear() {
            entries.clear();
        },
        getItem(key) {
            const cleanKey = String(key);

            return entries.has(cleanKey) ? entries.get(cleanKey) : null;
        },
        key(index) {
            return Array.from(entries.keys())[index] || null;
        },
        removeItem(key) {
            entries.delete(String(key));
        },
        setItem(key, value) {
            entries.set(String(key), String(value));
        }
    };
}

function setJSON(key, value) {
    globalThis.localStorage.setItem(key, JSON.stringify(value));
}

// Lunes a viernes: dia, noche, dia, noche, dia.
function semanaDeAna() {
    setJSON("baseData_Ana", {
        "2026-6-20": TURNO.LARGA,
        "2026-6-21": TURNO.NOCHE,
        "2026-6-22": TURNO.LARGA,
        "2026-6-23": TURNO.NOCHE,
        "2026-6-24": TURNO.LARGA
    });
}

function scheduleForWeek() {
    return {
        days: {
            "2026-07-20": { iso: "2026-07-20" },
            "2026-07-21": { iso: "2026-07-21" },
            "2026-07-22": { iso: "2026-07-22" },
            "2026-07-23": { iso: "2026-07-23" },
            "2026-07-24": { iso: "2026-07-24" }
        }
    };
}

function taskTitles(projected, iso) {
    return projected.days[iso].taskAssignments?.map(item => item.title) || [];
}

test("una tarea solo diurna no aparece en las noches del trabajador", async () => {
    globalThis.localStorage = createMemoryStorage();

    const {
        addTaskAssignmentsToSchedule,
        TASK_ASSIGNMENT_ENTRIES_KEY,
        TASK_ASSIGNMENT_TASKS_KEY
    } = await import("../js/taskAssignmentProjection.js");

    semanaDeAna();
    setJSON(TASK_ASSIGNMENT_ENTRIES_KEY, {});
    setJSON(TASK_ASSIGNMENT_TASKS_KEY, [
        {
            id: "task_dia",
            shift: "both",
            shiftScope: "day",
            title: "Sala de yeso",
            order: 1,
            defaultWorkerRules: [{
                workerName: "Ana",
                interval: 1,
                anchorKeyDay: "2026-6-20",
                habilOnly: false
            }]
        },
        {
            id: "task_noche",
            shift: "both",
            shiftScope: "night",
            title: "Ronda nocturna",
            order: 2,
            defaultWorkerRules: [{
                workerName: "Ana",
                interval: 1,
                anchorKeyDay: "2026-6-20",
                habilOnly: false
            }]
        }
    ]);

    const projected = addTaskAssignmentsToSchedule(
        { name: "Ana" },
        scheduleForWeek()
    );

    // "Cada turno" en una tarea diurna es TODOS los turnos que le toque venir
    // de dia.
    assert.deepEqual(taskTitles(projected, "2026-07-20"), ["Sala de yeso"]);
    assert.deepEqual(taskTitles(projected, "2026-07-22"), ["Sala de yeso"]);
    assert.deepEqual(taskTitles(projected, "2026-07-24"), ["Sala de yeso"]);
    // Y las noches son de la otra.
    assert.deepEqual(taskTitles(projected, "2026-07-21"), ["Ronda nocturna"]);
    assert.deepEqual(taskTitles(projected, "2026-07-23"), ["Ronda nocturna"]);
});

test("'cada 2 turnos' en una tarea diurna salta al otro turno DIURNO", async () => {
    globalThis.localStorage = createMemoryStorage();

    const {
        addTaskAssignmentsToSchedule,
        TASK_ASSIGNMENT_ENTRIES_KEY,
        TASK_ASSIGNMENT_TASKS_KEY
    } = await import("../js/taskAssignmentProjection.js");

    semanaDeAna();
    setJSON(TASK_ASSIGNMENT_ENTRIES_KEY, {});
    setJSON(TASK_ASSIGNMENT_TASKS_KEY, [{
        id: "task_dia",
        shift: "both",
        shiftScope: "day",
        title: "Sala de yeso",
        order: 1,
        defaultWorkerRules: [{
            workerName: "Ana",
            interval: 2,
            anchorKeyDay: "2026-6-20",
            habilOnly: false
        }]
    }]);

    const projected = addTaskAssignmentsToSchedule(
        { name: "Ana" },
        scheduleForWeek()
    );

    // Turnos diurnos de Ana: 20, 22 y 24. Uno de cada dos: el 20 y el 24. Si
    // las noches del medio contaran -como cuando la tarea va en los dos
    // tableros- le habria tocado el 22 en vez del 24.
    assert.deepEqual(taskTitles(projected, "2026-07-20"), ["Sala de yeso"]);
    assert.deepEqual(taskTitles(projected, "2026-07-22"), []);
    assert.deepEqual(taskTitles(projected, "2026-07-24"), ["Sala de yeso"]);
});

test("la tarea de los dos turnos sigue contando dias y noches", async () => {
    globalThis.localStorage = createMemoryStorage();

    const {
        addTaskAssignmentsToSchedule,
        TASK_ASSIGNMENT_ENTRIES_KEY,
        TASK_ASSIGNMENT_TASKS_KEY
    } = await import("../js/taskAssignmentProjection.js");

    semanaDeAna();
    setJSON(TASK_ASSIGNMENT_ENTRIES_KEY, {});
    setJSON(TASK_ASSIGNMENT_TASKS_KEY, [{
        id: "task_ambos",
        shift: "both",
        title: "Control de stock",
        order: 1,
        defaultWorkerRules: [{
            workerName: "Ana",
            interval: 2,
            anchorKeyDay: "2026-6-20",
            habilOnly: false
        }]
    }]);

    const projected = addTaskAssignmentsToSchedule(
        { name: "Ana" },
        scheduleForWeek()
    );

    // Turnos de Ana en orden: 20 dia, 21 noche, 22 dia, 23 noche, 24 dia. Uno
    // de cada dos son el 1o, el 3o y el 5o.
    assert.deepEqual(taskTitles(projected, "2026-07-20"), ["Control de stock"]);
    assert.deepEqual(taskTitles(projected, "2026-07-21"), []);
    assert.deepEqual(taskTitles(projected, "2026-07-22"), ["Control de stock"]);
    assert.deepEqual(taskTitles(projected, "2026-07-23"), []);
    assert.deepEqual(taskTitles(projected, "2026-07-24"), ["Control de stock"]);
});

test("la casilla puesta a mano en el turno que la tarea ya no tiene no viaja", async () => {
    globalThis.localStorage = createMemoryStorage();

    const {
        addTaskAssignmentsToSchedule,
        TASK_ASSIGNMENT_ENTRIES_KEY,
        TASK_ASSIGNMENT_TASKS_KEY
    } = await import("../js/taskAssignmentProjection.js");

    semanaDeAna();
    // Casilla nocturna sobreviviente de cuando la tarea iba en los dos
    // tableros: el turno de la tarea manda por sobre lo que quedo escrito.
    setJSON(TASK_ASSIGNMENT_ENTRIES_KEY, {
        "2026-07-20": {
            "night|task_dia|2026-6-21": {
                workers: ["Ana"],
                note: "",
                removedDefaults: []
            }
        }
    });
    setJSON(TASK_ASSIGNMENT_TASKS_KEY, [{
        id: "task_dia",
        shift: "both",
        shiftScope: "day",
        title: "Sala de yeso",
        order: 1,
        defaultWorkerRules: []
    }]);

    const projected = addTaskAssignmentsToSchedule(
        { name: "Ana" },
        scheduleForWeek()
    );

    assert.deepEqual(taskTitles(projected, "2026-07-21"), []);
});
