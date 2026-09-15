// Perfil de la tarea: en que condiciones se hace, no solo quien.
//
// Pedido del usuario (2026-09-15): APOYO TURNO (17:00 a 20:00) la hacen TM
// diurnos que ese dia tienen Larga. El jueves 24/9 nadie tenia Larga, y la
// programacion automatica igual puso a una TM de Diurno: el turno habitual solo
// daba preferencia, y si nadie calzaba iba cualquiera con historial. Pidio que
// sirva para otras unidades con otras dinamicas: que se aprenda del historial,
// rasgo por rasgo (estamento, profesion, rotativa, turno del dia).
//
// Y de paso: en la propuesta los trabajadores iban en el orden del reparto, no
// por jerarquia.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    buildTaskAutoScheduleHistory,
    planTaskAutoSchedule
} from "../js/taskAutoSchedule.js";
import { TURNO } from "../js/constants.js";

function seededRng(seed = 7) {
    let state = seed >>> 0;

    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

const WEEKS = ["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24"];
const PLAN_WEEK = "2026-08-31";
const PLAN_THURSDAY = "2026-8-3"; // jueves 3 de septiembre

// Lunes a viernes de una semana, en clave de calendario (mes 0-based).
function weekdaysOf(weekIso) {
    const [year, month, day] = weekIso.split("-").map(Number);

    return Array.from({ length: 5 }, (_item, index) => {
        const date = new Date(year, month - 1, day + index);

        return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    });
}

function cell(workers) {
    return { workers, note: "", removedDefaults: [] };
}

const TM = "TM Imagenología";
const LARGA = {
    rotativaType: "diurno",
    baseTurn: TURNO.DIURNO,
    actualTurn: TURNO.LARGA,
    extraTurn: TURNO.MEDIA_TARDE,
    profession: TM
};
const DIURNO = {
    rotativaType: "diurno",
    baseTurn: TURNO.DIURNO,
    actualTurn: TURNO.DIURNO,
    extraTurn: TURNO.LIBRE,
    profession: TM
};
const PEOPLE = ["Ana", "Bruno", "Carla"];

// Como en Imagenologia: los tres hacen RESONADOR todos los dias, y el que ese
// dia tiene Larga hace ademas APOYO TURNO.
function supportHistory(addToDay = () => {}) {
    const entries = {};
    const contexts = new Map();
    let turn = 0;

    WEEKS.forEach(week => {
        entries[week] = {};
        weekdaysOf(week).forEach(day => {
            const long = PEOPLE[turn % PEOPLE.length];

            turn += 1;
            entries[week][`day|resonador|${day}`] = cell([...PEOPLE]);
            entries[week][`day|apoyo_turno|${day}`] = cell([long]);
            PEOPLE.forEach(name => {
                contexts.set(`${name}|${day}`, name === long ? LARGA : DIURNO);
            });
            addToDay(day, entries[week], contexts);
        });
    });

    return buildTaskAutoScheduleHistory(entries, {
        beforeWeekKey: PLAN_WEEK,
        workerTurnContextForDay: (name, keyDay) =>
            contexts.get(`${name}|${keyDay}`) || {}
    });
}

function planCell(taskId, candidates, contexts, more = {}) {
    return {
        shift: "day",
        keyDay: PLAN_THURSDAY,
        taskId,
        taskIds: [taskId],
        candidates,
        candidateTurnContextByWorker: contexts,
        blocked: [],
        ...more
    };
}

function workersIn(plan, taskId) {
    return plan.filled.find(item => item.taskId === taskId)?.workers || [];
}

test("el dia que nadie tiene Larga, APOYO TURNO queda vacia", () => {
    const contexts = { Ana: DIURNO, Bruno: DIURNO, Carla: DIURNO };
    const plan = planTaskAutoSchedule({
        cells: [
            planCell("resonador", PEOPLE, contexts),
            planCell("apoyo_turno", PEOPLE, contexts)
        ],
        history: supportHistory(),
        rng: seededRng(3)
    });
    const skipped = plan.skipped.find(item => item.taskId === "apoyo_turno");

    assert.equal(workersIn(plan, "resonador").length, 3);
    assert.deepEqual(workersIn(plan, "apoyo_turno"), []);
    // Y la propuesta puede decir por que.
    assert.equal(skipped?.reason, "sin-perfil");
    assert.deepEqual(skipped.profile.actualTurn, [String(TURNO.LARGA)]);
});

test("si alguien tiene Larga ese dia, ese va", () => {
    const contexts = { Ana: DIURNO, Bruno: LARGA, Carla: DIURNO };
    const plan = planTaskAutoSchedule({
        cells: [
            planCell("resonador", PEOPLE, contexts),
            planCell("apoyo_turno", PEOPLE, contexts)
        ],
        history: supportHistory(),
        rng: seededRng(5)
    });

    assert.deepEqual(workersIn(plan, "apoyo_turno"), ["Bruno"]);
});

test("lo que comparte toda la unidad no se vuelve requisito", () => {
    const history = supportHistory();

    // Todos son TM diurnos: ser TM diurno no distingue a APOYO TURNO. La Larga
    // si: esas mismas personas, los dias que no la hacen, estan de Diurno.
    assert.deepEqual(
        Object.keys(history.taskProfiles.get("day|apoyo_turno").requires),
        ["actualTurn"]
    );
    // RESONADOR se hace con cualquier turno.
    assert.equal(history.taskProfiles.get("day|resonador"), undefined);
});

test("lo que no se sabe de la persona no la deja afuera", () => {
    const plan = planTaskAutoSchedule({
        cells: [planCell("apoyo_turno", ["Bruno"], {})],
        history: supportHistory(),
        rng: seededRng(7)
    });

    assert.deepEqual(workersIn(plan, "apoyo_turno"), ["Bruno"]);
});

test("quien siempre trabaja igual no le enseña un turno a su tarea", () => {
    // Sofia hace SUPERVISOR todos los dias y nunca otra cosa, siempre de
    // Diurno. No hay dias suyos con otro turno con que comparar: que la haga de
    // Diurno no prueba que la tarea lo pida.
    const history = supportHistory((day, weekEntries, contexts) => {
        weekEntries[`day|supervisor|${day}`] = cell(["Sofia"]);
        contexts.set(`Sofia|${day}`, DIURNO);
    });
    const plan = planTaskAutoSchedule({
        cells: [planCell("supervisor", ["Sofia"], { Sofia: LARGA })],
        history,
        rng: seededRng(9)
    });

    assert.equal(history.taskProfiles.get("day|supervisor"), undefined);
    assert.deepEqual(workersIn(plan, "supervisor"), ["Sofia"]);
});

test("una tarea solo de profesionales no se le da a un tecnico por dos dias sueltos", () => {
    const profiles = [
        { name: "Ana", estamento: "Profesional" },
        { name: "Bruno", estamento: "Profesional" },
        { name: "Tomas", estamento: "Técnico" },
        { name: "Uma", estamento: "Técnico" }
    ];
    const entries = {};

    WEEKS.forEach((week, weekIndex) => {
        entries[week] = {};
        weekdaysOf(week).forEach((day, dayIndex) => {
            // Dos jueves RIS/PACS la cubrio Tomas: 2 de 20 dias.
            const odd = dayIndex === 3 && weekIndex >= 2;

            entries[week][`day|ris_pacs|${day}`] = cell([
                odd ? "Tomas" : dayIndex % 2 ? "Bruno" : "Ana"
            ]);
            entries[week][`day|ecografo|${day}`] = cell(
                odd ? ["Uma"] : ["Tomas", "Uma"]
            );
        });
    });

    const history = buildTaskAutoScheduleHistory(entries, {
        beforeWeekKey: PLAN_WEEK,
        profiles
    });
    const plan = planTaskAutoSchedule({
        cells: [planCell("ris_pacs", ["Tomas"], {})],
        history,
        rng: seededRng(11)
    });
    const skipped = plan.skipped.find(item => item.taskId === "ris_pacs");

    assert.deepEqual(workersIn(plan, "ris_pacs"), []);
    assert.equal(skipped?.reason, "sin-perfil");
    assert.deepEqual(skipped.profile.estamento, ["Profesional"]);
});

test("sin historial suficiente no se exige ningun perfil", () => {
    const entries = {};
    const contexts = new Map();

    // Cinco dias-persona: menos de lo que hace falta para aprender.
    weekdaysOf(WEEKS[0]).forEach(day => {
        entries[WEEKS[0]] = entries[WEEKS[0]] || {};
        entries[WEEKS[0]][`day|apoyo_turno|${day}`] = cell(["Ana"]);
        contexts.set(`Ana|${day}`, LARGA);
    });

    const history = buildTaskAutoScheduleHistory(entries, {
        beforeWeekKey: PLAN_WEEK,
        workerTurnContextForDay: (name, keyDay) =>
            contexts.get(`${name}|${keyDay}`) || {}
    });

    assert.equal(history.taskProfiles.size, 0);
});

/* =========================================================
   El panel
========================================================= */

const source = (await readFile(
    new URL("../js/taskAssignments.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

test("la propuesta dice por que la casilla queda vacia", () => {
    assert.match(
        source,
        /function autoScheduleSkipSummary\(plan, tasks = \[\]\) \{[\s\S]*?item\.reason === "sin-perfil"/
    );
    assert.match(source, /nadie de turno ese día calza con quienes hacen la tarea/);
    assert.match(source, /\$\{autoScheduleSkipSummary\(plan, tasks\)\}/);
});

test("en la propuesta los trabajadores van por jerarquia", () => {
    // Profesionales, tecnicos, administrativos, auxiliares: como en el tablero.
    const gridCell = source.slice(
        source.indexOf("function autoSchedulePreviewGridCell("),
        source.indexOf("function autoSchedulePreviewGrid(")
    );

    assert.match(
        gridCell,
        /sortTaskWorkersByRole\(item\?\.workers \|\| \[\]\)\.map\(name =>/
    );
});
