// Casillas unidas y el historial de la programacion automatica.
//
// Pedido del usuario (2026-09-15): en Imagenologia los dias inhabiles se unen
// las casillas porque entre los mismos trabajadores se reparten las tareas; se
// unen solo para que la programacion muestre quien esta de turno. Pero los
// trabajadores de una union viven en la PRIMERA tarea, y el historial leia solo
// esa: con datos reales, 15 personas -una auxiliar y varios tecnicos entre
// ellas- quedaron "elegibles" para RESONADOR solo por los fines de semana
// unidos, y aparecian como recomendadas. Las otras tareas de la union no
// recibian nada.
//
// Lo acordado: una union de mas de 2 tareas, o de mas del 20% de las del turno,
// no es patron de ninguna tarea (solo cuenta para otra union grande); una union
// de 2 tareas cuenta para las dos, por separado y juntas.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    buildTaskAutoScheduleHistory,
    canWorkerShareShiftTasks,
    isLooseTaskGroup,
    planTaskAutoSchedule,
    recommendTaskCandidates
} from "../js/taskAutoSchedule.js";

const WEEKS = ["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24"];
const PLAN_WEEK = "2026-08-31";
const PLAN_MONDAY = "2026-7-31";
const PLAN_SATURDAY = "2026-8-5";

// Lunes a domingo de una semana, en clave de calendario (mes 0-based).
function daysOf(weekIso) {
    const [year, month, day] = weekIso.split("-").map(Number);

    return Array.from({ length: 7 }, (_item, index) => {
        const date = new Date(year, month - 1, day + index);

        return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    });
}

function cell(workers, mergedNextTaskId = "") {
    return {
        workers,
        note: "",
        removedDefaults: [],
        ...(mergedNextTaskId ? { mergedNextTaskId } : {})
    };
}

// Lunes a viernes cada uno en lo suyo. El sabado, RESONADOR + RAYOS + ESCANER +
// AUX TURNO unidas con los que estan de turno: Ana (TM), Vero (auxiliar) y Tito,
// que solo viene los fines de semana.
function inhabilHistory() {
    const entries = {};

    WEEKS.forEach(week => {
        const days = daysOf(week);

        entries[week] = {};
        days.slice(0, 5).forEach(day => {
            entries[week][`day|resonador|${day}`] = cell(["Ana", "Bruno"]);
            entries[week][`day|rayos|${day}`] = cell(["Carla"]);
            entries[week][`day|aux_turno|${day}`] = cell(["Vero"]);
        });
        entries[week][`day|resonador|${days[5]}`] = cell(["Ana", "Vero", "Tito"], "rayos");
        entries[week][`day|rayos|${days[5]}`] = cell([], "escaner");
        entries[week][`day|escaner|${days[5]}`] = cell([], "aux_turno");
    });

    return buildTaskAutoScheduleHistory(entries, {
        beforeWeekKey: PLAN_WEEK,
        shiftTaskCounts: { day: 19, night: 2 }
    });
}

function planCell(taskIds, candidates, more = {}) {
    return {
        shift: "day",
        keyDay: PLAN_MONDAY,
        taskId: taskIds[0],
        taskIds,
        shiftTaskCount: 19,
        candidates,
        candidateTurnContextByWorker: {},
        existingTaskIdsByWorker: {},
        blocked: [],
        ...more
    };
}

test("la union del fin de semana no le da historial a la primera tarea", () => {
    const history = inhabilHistory();
    const recommended = recommendTaskCandidates({
        cell: planCell(["resonador"], ["Vero", "Tito", "Ana"]),
        history
    });

    // La auxiliar que estuvo en la union no aparece como opcion para RESONADOR.
    assert.deepEqual(recommended.map(item => item.name), ["Ana"]);
    assert.equal(history.tasks.get("resonador").has("Tito"), false);
    assert.equal(history.tasks.get("resonador").get("Vero"), undefined);
});

test("quien estuvo en esas uniones sigue entrando a la union del fin de semana", () => {
    // Tito solo viene los fines de semana: sin esto, la programacion de un
    // sabado unido lo dejaria afuera.
    const plan = planTaskAutoSchedule({
        cells: [planCell(
            ["resonador", "rayos", "escaner", "aux_turno"],
            ["Ana", "Vero", "Tito", "Sin Historial"],
            { keyDay: PLAN_SATURDAY, fillAllEligible: true }
        )],
        history: inhabilHistory(),
        rng: () => 0.5
    });
    const workers = plan.filled[0]?.workers || [];

    assert.ok(workers.includes("Tito"), workers.join(", "));
    assert.ok(workers.includes("Vero"), workers.join(", "));
    assert.ok(!workers.includes("Sin Historial"));
});

function pairHistory({ shift = "day", first = "rx1", second = "rx2", shiftTaskCounts = { day: 19, night: 2 } } = {}) {
    const entries = {};

    WEEKS.forEach(week => {
        const monday = daysOf(week)[0];

        entries[week] = {
            [`${shift}|${first}|${monday}`]: cell(["Diego"], second)
        };
    });

    return buildTaskAutoScheduleHistory(entries, {
        beforeWeekKey: PLAN_WEEK,
        shiftTaskCounts
    });
}

test("dos tareas unidas cuentan para las dos, por separado y juntas", () => {
    const history = pairHistory();
    const names = taskIds => recommendTaskCandidates({
        cell: planCell(taskIds, ["Diego"]),
        history
    }).map(item => item.name);

    // Antes solo contaba para RX1, la de arriba.
    assert.deepEqual(names(["rx2"]), ["Diego"]);
    assert.deepEqual(names(["rx1"]), ["Diego"]);
    assert.deepEqual(names(["rx1", "rx2"]), ["Diego"]);
});

test("una union no cuenta como hacer dos tareas a la vez", () => {
    assert.equal(
        canWorkerShareShiftTasks(pairHistory(), {
            name: "Diego",
            shift: "day",
            currentTaskIds: ["rx1"],
            taskIds: ["rx2"]
        }),
        false
    );
});

test("en un turno de pocas tareas, unir dos ya es mas del 20%", () => {
    // La noche de Imagenologia tiene 2 tareas: unirlas es unir el turno entero.
    const history = pairHistory({ shift: "night", first: "turno_noche", second: "aux_noche" });

    assert.equal(history.tasks.has("turno_noche"), false);
    assert.equal(history.looseGroupWorkers.get("night").has("Diego"), true);
});

test("que union es suelta", () => {
    assert.equal(isLooseTaskGroup(1, 2), false, "una casilla sola no es union");
    assert.equal(isLooseTaskGroup(2, 19), false);
    assert.equal(isLooseTaskGroup(3, 19), true);
    assert.equal(isLooseTaskGroup(2, 5), true, "2 de 5 es 40%");
    assert.equal(isLooseTaskGroup(2), false, "sin saber el total, solo el tope");
    assert.equal(isLooseTaskGroup(3), true);
});

test("el panel le pasa al motor cuantas tareas tiene cada turno", async () => {
    const source = (await readFile(
        new URL("../js/taskAssignments.js", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    assert.equal(
        (source.match(/shiftTaskCounts: autoScheduleShiftTaskCounts\((tasks|getTasks\(\))\),/g) || []).length,
        3,
        "los tres historiales: propuesta, publicar y recomendacion"
    );
    assert.equal(
        (source.match(/shiftTaskCount: tasksForShift\(tasks, shift\)\.length,/g) || []).length,
        2,
        "las casillas de la propuesta y la de Asignar"
    );
    // En el hover, una union grande no se nombra por su primera tarea.
    assert.match(source, /Casillas unidas \(\$\{taskIds\.length\} tareas\)/);
});
