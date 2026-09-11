import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    buildTaskAutoScheduleHistory,
    headcountForCell,
    planTaskAutoSchedule
} from "../js/taskAutoSchedule.js";

// El boton de Programacion automatica reparte al azar, y lo que hay que
// comprobar es justamente lo que el azar NO puede hacer: meter a alguien en una
// tarea que nunca hizo, dejar a la misma persona clavada toda la semana en la
// misma, o inflar una casilla que siempre estuvo vacia.
//
// El azar entra por parametro (`rng`), asi que las pruebas corren con una
// sucesion fija y el resultado es el mismo siempre.

// Generador congruencial: sirve para que la prueba no dependa de Math.random.
function seededRng(seed = 7) {
    let state = seed >>> 0;

    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

// Agosto 2026: los lunes caen 3, 10, 17, 24 y 31.
const WEEKS = ["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24"];
const PLAN_WEEK = "2026-08-31";
const MONDAYS = ["2026-7-3", "2026-7-10", "2026-7-17", "2026-7-24"];
const PLAN_MONDAY = "2026-7-31";
const PLAN_TUESDAY = "2026-8-1"; // 1 de septiembre, martes
// Lunes a viernes de la semana que se programa.
const PLAN_DAYS = ["2026-7-31", "2026-8-1", "2026-8-2", "2026-8-3", "2026-8-4"];

function cell(entries) {
    return { workers: entries, note: "", removedDefaults: [] };
}

// Los cinco dias habiles de una semana del historial, en clave de calendario
// (`YYYY-M-D`, mes 0-based).
function weekdaysOf(weekIso) {
    const [year, month, day] = weekIso.split("-").map(Number);

    return Array.from({ length: 5 }, (_item, index) => {
        const date = new Date(year, month - 1, day + index);

        return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    });
}

// Historial de cuatro semanas, solo los LUNES:
//   RESONADOR  -> siempre 2 personas: Ana y Bruno
//   RAYOS      -> siempre 1 persona:  Bruno o Carla, alternandose
//   MAMOGRAFIA -> nunca nadie (la casilla no existe esos lunes)
// El resto de los dias se deja a proposito sin historial: asi se comprueba que
// el martes, donde nunca se programo nada, el cupo sale 0.
function baseHistory() {
    const entries = {};

    WEEKS.forEach((week, index) => {
        const day = MONDAYS[index];

        entries[week] = {
            [`day|resonador|${day}`]: cell(["Ana", "Bruno"]),
            [`day|rayos|${day}`]: cell([index % 2 ? "Carla" : "Bruno"])
        };
    });

    return entries;
}

// Historial de lunes a viernes: `porDia[tareaId](diaDeLaSemana)` devuelve
// quienes estuvieron en esa tarea ese dia.
function weekHistory(porDia) {
    const entries = {};

    WEEKS.forEach(week => {
        const cells = {};

        weekdaysOf(week).forEach((day, weekday) => {
            Object.entries(porDia).forEach(([taskId, names]) => {
                cells[`day|${taskId}|${day}`] = cell(names(weekday));
            });
        });
        entries[week] = cells;
    });

    return entries;
}

// RAYOS va los cinco dias de la semana; RESONADOR, solo los lunes. Sirve para
// comprobar que el cupo distingue "esta tarea ese dia no va" de "ese dia no se
// programo nada", que en los datos reales es la mitad de la semana.
function mixedHistory() {
    const entries = {};

    WEEKS.forEach(week => {
        const cells = {};

        weekdaysOf(week).forEach((day, weekday) => {
            cells[`day|rayos|${day}`] = cell(["Carla", "Bruno"]);

            if (weekday === 0) {
                cells[`day|resonador|${day}`] = cell(["Ana", "Bruno"]);
            }
        });
        entries[week] = cells;
    });

    return entries;
}

function planCells(candidates, { keyDay = PLAN_MONDAY, taskIds = null } = {}) {
    return (taskIds || ["resonador", "rayos", "mamografia"]).map(taskId => ({
        shift: "day",
        keyDay,
        taskId,
        taskIds: [taskId],
        candidates,
        blocked: []
    }));
}

test("nadie entra en una tarea que nunca ha hecho", () => {
    const history = buildTaskAutoScheduleHistory(baseHistory(), {
        beforeWeekKey: PLAN_WEEK
    });
    // Dario esta de turno pero no aparece en ninguna tarea del historial.
    const plan = planTaskAutoSchedule({
        cells: planCells(["Ana", "Bruno", "Carla", "Dario"]),
        history,
        rng: seededRng(11)
    });
    const resonador = plan.filled.find(item => item.taskId === "resonador");
    const rayos = plan.filled.find(item => item.taskId === "rayos");

    assert.deepEqual(resonador.workers.sort(), ["Ana", "Bruno"]);
    assert.ok(["Bruno", "Carla"].includes(rayos.workers[0]));
    assert.ok(
        !plan.workers.includes("Dario"),
        "Dario no tiene historial en ninguna tarea, asi que no puede ser asignado"
    );
    assert.equal(plan.filled.some(item => item.taskId === "mamografia"), false);
});

test("una tarea sin historial no acepta trabajadores al azar", () => {
    const history = buildTaskAutoScheduleHistory(baseHistory(), {
        beforeWeekKey: PLAN_WEEK
    });
    const plan = planTaskAutoSchedule({
        cells: planCells(["Ana", "Bruno", "Carla", "Dario"]),
        history,
        rng: seededRng(3)
    });
    const mamografia = plan.filled.find(item => item.taskId === "mamografia");

    assert.equal(mamografia, undefined);
    assert.ok(
        plan.skipped.some(item =>
            item.taskId === "mamografia" && item.reason === "sin-cupo"
        )
    );
});

test("el cupo sale del historial de ese dia de la semana", () => {
    const history = buildTaskAutoScheduleHistory(mixedHistory(), {
        beforeWeekKey: PLAN_WEEK
    });

    assert.equal(headcountForCell(history, "day", "resonador", PLAN_MONDAY), 2);
    assert.equal(headcountForCell(history, "day", "rayos", PLAN_MONDAY), 2);
    // Los martes SI se programaron, y en ninguno hubo nadie en RESONADOR: esa
    // tarea el martes no va.
    assert.equal(headcountForCell(history, "day", "resonador", PLAN_TUESDAY), 0);
    assert.equal(headcountForCell(history, "day", "rayos", PLAN_TUESDAY), 2);
});

test("el dia que nunca se programo no cuenta como dia vacio", () => {
    const history = buildTaskAutoScheduleHistory(mixedHistory(), {
        beforeWeekKey: PLAN_WEEK
    });

    // Ningun sabado del historial se programo. Sin patron de cantidad, la
    // automatica no inventa dotacion.
    assert.equal(headcountForCell(history, "day", "rayos", "2026-8-5"), 0);
});

test("la tarea que ese dia siempre estuvo vacia se queda vacia", () => {
    const history = buildTaskAutoScheduleHistory(mixedHistory(), {
        beforeWeekKey: PLAN_WEEK
    });
    const plan = planTaskAutoSchedule({
        cells: planCells(["Ana", "Bruno", "Carla"], { keyDay: PLAN_TUESDAY }),
        history,
        rng: seededRng(5)
    });

    assert.equal(
        plan.filled.filter(item => item.taskId === "resonador").length,
        0
    );
    assert.ok(
        plan.skipped.some(item =>
            item.taskId === "resonador" && item.reason === "sin-cupo"
        )
    );
});

test("una tarea nueva no arrastra los ceros de cuando no existia", () => {
    const entries = baseHistory();

    // ECOGRAFIA aparece recien en la ultima semana del historial.
    entries[WEEKS[3]][`day|ecografia|${MONDAYS[3]}`] = cell(["Ana", "Carla"]);

    const history = buildTaskAutoScheduleHistory(entries, {
        beforeWeekKey: PLAN_WEEK
    });

    // Sin el corte por primera semana, las tres semanas en que no existia
    // pesarian mas que la unica en que se uso y el cupo saldria 0.
    assert.equal(headcountForCell(history, "day", "ecografia", PLAN_MONDAY), 2);
});

test("puede asignar menos gente que el cupo historico si no alcanza el personal", () => {
    const history = buildTaskAutoScheduleHistory(
        weekHistory({
            rayos: () => ["Ana", "Bruno", "Carla"]
        }),
        { beforeWeekKey: PLAN_WEEK }
    );
    const plan = planTaskAutoSchedule({
        cells: [{
            shift: "day",
            keyDay: PLAN_MONDAY,
            taskId: "rayos",
            taskIds: ["rayos"],
            candidates: ["Ana", "Bruno"],
            blocked: []
        }],
        history,
        rng: seededRng(9)
    });

    assert.equal(headcountForCell(history, "day", "rayos", PLAN_MONDAY), 3);
    assert.equal(plan.filled[0].workers.length, 2);
    assert.equal(plan.filled[0].headcount, 3);
    assert.equal(plan.filled[0].short, 1);
});

test("el que hace varias tareas va rotando a lo largo de la semana", () => {
    // Eva y Gabriel hacen las dos tareas por igual, todos los dias. Sin
    // rotacion se quedarian los cinco dias clavados en la misma.
    const history = buildTaskAutoScheduleHistory(
        weekHistory({
            resonador: weekday => ["Ana", weekday % 2 ? "Eva" : "Gabriel"],
            rayos: weekday => ["Carla", weekday % 2 ? "Gabriel" : "Eva"]
        }),
        { beforeWeekKey: PLAN_WEEK }
    );
    // Solo Eva y Gabriel estan de turno: Ana y Carla no compiten por nada.
    const cells = PLAN_DAYS.flatMap(keyDay => planCells(
        ["Eva", "Gabriel"],
        { keyDay, taskIds: ["resonador", "rayos"] }
    ));
    const plan = planTaskAutoSchedule({
        cells,
        history,
        rng: seededRng(21)
    });
    const evaTasks = new Set(
        plan.filled
            .filter(item => item.workers.includes("Eva"))
            .map(item => item.taskId)
    );

    assert.equal(plan.filled.length, 10);
    assert.ok(
        evaTasks.size > 1,
        "Eva hace las dos tareas: tiene que aparecer en las dos durante la semana"
    );
});

test("el que solo hace una tarea se queda en la suya", () => {
    const history = buildTaskAutoScheduleHistory(
        weekHistory({
            resonador: () => ["Ana", "Eva"],
            rayos: () => ["Carla", "Eva"]
        }),
        { beforeWeekKey: PLAN_WEEK }
    );
    const cells = PLAN_DAYS.flatMap(keyDay => planCells(
        ["Ana", "Carla", "Eva"],
        { keyDay, taskIds: ["resonador", "rayos"] }
    ));
    const plan = planTaskAutoSchedule({ cells, history, rng: seededRng(31) });

    assert.equal(plan.filled.length, 10);
    // Ana solo ha hecho RESONADOR y Carla solo RAYOS: el castigo por repetir
    // no les aplica, asi que siguen apareciendo ahi todos los dias.
    plan.filled.forEach(item => {
        const expected = item.taskId === "resonador" ? "Ana" : "Carla";

        assert.ok(
            item.workers.includes(expected),
            `${expected} tiene que seguir en ${item.taskId}`
        );
    });
});

test("la casilla se queda sin cubrir antes que inventar una asignacion", () => {
    const history = buildTaskAutoScheduleHistory(baseHistory(), {
        beforeWeekKey: PLAN_WEEK
    });
    // Ese dia solo esta de turno gente sin historial en RESONADOR.
    const plan = planTaskAutoSchedule({
        cells: planCells(["Dario", "Elena"], { taskIds: ["resonador"] }),
        history,
        rng: seededRng(41)
    });

    assert.equal(plan.filled.length, 0);
    assert.deepEqual(plan.skipped, [{
        shift: "day",
        taskId: "resonador",
        keyDay: PLAN_MONDAY,
        reason: "sin-historial"
    }]);
});

test("nadie queda en dos tareas del mismo turno y dia", () => {
    const history = buildTaskAutoScheduleHistory(baseHistory(), {
        beforeWeekKey: PLAN_WEEK
    });
    const plan = planTaskAutoSchedule({
        cells: planCells(["Ana", "Bruno", "Carla"]),
        history,
        rng: seededRng(59)
    });
    const seen = new Set();

    plan.filled.forEach(item => {
        item.workers.forEach(name => {
            assert.ok(!seen.has(name), `${name} quedo en dos tareas el mismo dia`);
            seen.add(name);
        });
    });
});

test("el predefinido que el supervisor saco a mano no vuelve solo", () => {
    const history = buildTaskAutoScheduleHistory(baseHistory(), {
        beforeWeekKey: PLAN_WEEK
    });
    const plan = planTaskAutoSchedule({
        cells: [{
            shift: "day",
            keyDay: PLAN_MONDAY,
            taskId: "resonador",
            taskIds: ["resonador"],
            candidates: ["Ana", "Bruno", "Carla"],
            blocked: ["Ana"]
        }],
        history,
        rng: seededRng(67)
    });

    assert.ok(!plan.filled[0].workers.includes("Ana"));
});

test("sin historial ninguno no inventa programacion", () => {
    const history = buildTaskAutoScheduleHistory({}, {
        beforeWeekKey: PLAN_WEEK
    });
    const plan = planTaskAutoSchedule({
        cells: planCells(["Ana", "Bruno", "Carla", "Dario"]),
        history,
        rng: seededRng(73)
    });

    assert.equal(history.weeksSeen, 0);
    assert.equal(plan.assignments, 0);
    assert.equal(plan.filled.length, 0);
    assert.ok(plan.skipped.every(item => item.reason === "sin-cupo"));
});

test("la semana que se esta programando no es patron de si misma", () => {
    const entries = baseHistory();

    entries[PLAN_WEEK] = {
        [`day|resonador|${PLAN_MONDAY}`]: cell(["Dario", "Elena", "Fabian"])
    };

    const history = buildTaskAutoScheduleHistory(entries, {
        beforeWeekKey: PLAN_WEEK
    });

    assert.equal(headcountForCell(history, "day", "resonador", PLAN_MONDAY), 2);
    assert.ok(!history.tasks.get("resonador").has("Dario"));
});

test("la casilla fusionada suma el historial de las tareas que cubre", () => {
    const history = buildTaskAutoScheduleHistory(baseHistory(), {
        beforeWeekKey: PLAN_WEEK
    });
    const plan = planTaskAutoSchedule({
        cells: [{
            shift: "day",
            keyDay: PLAN_MONDAY,
            taskId: "resonador",
            taskIds: ["resonador", "rayos"],
            candidates: ["Ana", "Bruno", "Carla"],
            blocked: []
        }],
        history,
        rng: seededRng(83)
    });

    // Carla solo ha hecho RAYOS, pero la casilla tambien cubre RAYOS: entra.
    assert.equal(plan.filled[0].headcount, 2);
    plan.filled[0].workers.forEach(name => {
        assert.ok(["Ana", "Bruno", "Carla"].includes(name));
    });
});

test("el boton esta cableado en el panel", async () => {
    const source = await readFile(
        new URL("../js/taskAssignments.js", import.meta.url),
        "utf8"
    );

    assert.match(source, /data-task-auto-schedule/);
    assert.match(source, /runTaskAutoSchedule/);
    assert.match(source, /openTaskAutoSchedulePreviewDialog/);
    assert.match(source, /data-auto-schedule-regenerate/);
    assert.match(source, /data-auto-schedule-publish/);
    assert.match(source, /applyTaskAutoSchedulePlan/);
    assert.doesNotMatch(source, /showConfirm\(autoSchedulePlanSummary/);
    // El reparto solo rellena: si esto se pierde, el boton empieza a pisar lo
    // que el supervisor puso a mano.
    assert.match(source, /assignmentWorkers\(entry\)\.length/);
});
