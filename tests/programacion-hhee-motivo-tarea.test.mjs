// El motivo de HHEE manda la tarea de ese dia.
//
// Pedido del usuario (2026-09-14): a los TM de Imagenologia se les agrega una
// Larga extra con motivo HHEE "Estacion de trabajo", y ese dia van a la tarea
// ESTACION DE TRABAJO. La programacion automatica tenia que aprenderlo, pero al
// probarla no asigno a nadie por su motivo.
//
// El motivo solo inclinaba el sorteo, y antes de llegar a pesar habia cuatro
// filtros que lo dejaban afuera. Cada prueba de aca reproduce uno:
//   - cupo 0: una tarea que depende de HHEE va pocos dias, y el cupo aprendido
//     de ese dia sale 0 -> la casilla ni se mira;
//   - experiencia: quien trae el motivo nunca hizo la tarea;
//   - tipo de turno: la tarea suele ir con turno regular y el de la Larga extra
//     no calza con esa firma;
//   - orden: otra tarea del dia se lo lleva antes.
// Y el calce motivo -> tarea solo se aprendia del historial: un motivo llamado
// igual que la tarea no contaba si no se habia visto dos veces.
//
// 2026-09-15: con los datos reales de Imagenologia, "Extension Apoyo Clinico Rx
// TC" -> APOYO TURNO no se aprendia. Quien viene a la extension hace su tarea
// de siempre Y APOYO TURNO, y contando tareas sueltas APOYO TURNO quedaba en 3
// de 9; ademas se mezclaba con "Apoyo Clinico TC", que va al ESCANER. Ahora se
// cuenta por dia, contra los dias sin ese motivo, y el motivo va exacto.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    buildTaskAutoScheduleHistory,
    extraReasonTaskAffinity,
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

// Agosto 2026, claves de calendario con el mes en base 0.
const WEEKS = ["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24"];
const MONDAYS = ["2026-7-3", "2026-7-10", "2026-7-17", "2026-7-24"];
const TUESDAYS = ["2026-7-4", "2026-7-11", "2026-7-18", "2026-7-25"];
const PLAN_WEEK = "2026-08-31";
const PLAN_MONDAY = "2026-7-31";

const TITLES = {
    estacion_trabajo: "ESTACIÓN DE TRABAJO",
    apoyo_turno: "APOYO TURNO",
    tac_urgencia: "TAC URGENCIA",
    escaner: "ESCANER"
};

function cell(workers) {
    return { workers, note: "", removedDefaults: [] };
}

// Un 4° turno en su Larga de siempre.
const REGULAR = {
    rotativaType: "4turno",
    baseTurn: TURNO.LARGA,
    actualTurn: TURNO.LARGA,
    extraTurn: TURNO.LIBRE,
    profession: "Tecnologia Medica",
    extraReason: ""
};

// Un diurno de libre con una Larga agregada, y el motivo HHEE que le anotaron.
function extra(reason = "") {
    return {
        rotativaType: "diurno",
        baseTurn: TURNO.LIBRE,
        actualTurn: TURNO.LARGA,
        extraTurn: TURNO.LARGA,
        profession: "Tecnologia Medica",
        extraReason: reason
    };
}

function history(entries, contexts = new Map()) {
    return buildTaskAutoScheduleHistory(entries, {
        beforeWeekKey: PLAN_WEEK,
        workerTurnContextForDay: (name, keyDay) =>
            contexts.get(`${name}|${keyDay}`) || {}
    });
}

function planCell(taskId, candidates, contexts, more = {}) {
    return {
        shift: "day",
        keyDay: PLAN_MONDAY,
        taskId,
        taskIds: [taskId],
        taskTitles: { [taskId]: TITLES[taskId] },
        candidates,
        candidateTurnContextByWorker: contexts,
        blocked: [],
        ...more
    };
}

function workersIn(plan, taskId) {
    return plan.filled.find(item => item.taskId === taskId)?.workers || [];
}

/* =========================================================
   Los cuatro filtros que lo dejaban afuera
========================================================= */

test("la tarea que depende de HHEE va aunque su cupo de ese dia sea 0", () => {
    // ESTACION DE TRABAJO solo se cubrio un lunes de cuatro: por historial su
    // cupo del lunes es 0. Pero hoy Ana trae una Larga extra justo para eso.
    const entries = {};

    WEEKS.forEach((week, index) => {
        entries[week] = {
            [`day|apoyo_turno|${MONDAYS[index]}`]: cell(["Bruno"]),
            ...(index === 0
                ? { [`day|estacion_trabajo|${MONDAYS[index]}`]: cell(["Eva"]) }
                : {})
        };
    });

    const contexts = { Ana: extra("Estación de trabajo"), Bruno: REGULAR };
    const plan = planTaskAutoSchedule({
        cells: [
            planCell("apoyo_turno", ["Ana", "Bruno"], contexts),
            planCell("estacion_trabajo", ["Ana", "Bruno"], contexts)
        ],
        history: history(entries),
        rng: seededRng(3)
    });

    assert.deepEqual(workersIn(plan, "estacion_trabajo"), ["Ana"]);
    assert.deepEqual(workersIn(plan, "apoyo_turno"), ["Bruno"]);
});

test("entra aunque nunca haya hecho la tarea: el motivo dice a que viene", () => {
    const entries = {};

    WEEKS.forEach((week, index) => {
        entries[week] = {
            [`day|estacion_trabajo|${MONDAYS[index]}`]: cell(["Eva"]),
            [`day|apoyo_turno|${MONDAYS[index]}`]: cell(["Bruno"])
        };
    });

    const contexts = { Ana: extra("Estación de trabajo"), Eva: REGULAR, Bruno: REGULAR };
    const plan = planTaskAutoSchedule({
        cells: [
            planCell("apoyo_turno", ["Ana", "Eva", "Bruno"], contexts),
            planCell("estacion_trabajo", ["Ana", "Eva", "Bruno"], contexts)
        ],
        history: history(entries),
        rng: seededRng(5)
    });

    assert.ok(workersIn(plan, "estacion_trabajo").includes("Ana"));
});

test("el tipo de turno habitual de la tarea no deja afuera al de la Larga extra", () => {
    // ESTACION DE TRABAJO los lunes siempre la hizo Eva con su turno regular:
    // el motor aprende esa firma de turno. Ana la hizo dos martes, sin motivo.
    const entries = {};
    const contexts = new Map();

    WEEKS.forEach((week, index) => {
        entries[week] = {
            [`day|estacion_trabajo|${MONDAYS[index]}`]: cell(["Eva"]),
            ...(index < 2
                ? { [`day|estacion_trabajo|${TUESDAYS[index]}`]: cell(["Ana"]) }
                : {})
        };
        contexts.set(`Eva|${MONDAYS[index]}`, REGULAR);
        contexts.set(`Ana|${TUESDAYS[index]}`, extra(""));
    });

    const planContexts = { Ana: extra("Estación de trabajo"), Eva: REGULAR };
    const plan = planTaskAutoSchedule({
        cells: [planCell("estacion_trabajo", ["Ana", "Eva"], planContexts)],
        history: history(entries, contexts),
        rng: seededRng(11)
    });

    assert.ok(workersIn(plan, "estacion_trabajo").includes("Ana"));
});

test("otra tarea del mismo dia no se la lleva antes", () => {
    // Ana es la unica con experiencia en APOYO TURNO. Sin prioridad, el reparto
    // la ponia ahi y ESTACION DE TRABAJO se la quedaba Eva.
    const entries = {};

    WEEKS.forEach((week, index) => {
        entries[week] = {
            [`day|apoyo_turno|${MONDAYS[index]}`]: cell(["Ana"]),
            [`day|estacion_trabajo|${MONDAYS[index]}`]: cell(["Eva"])
        };
    });

    const contexts = { Ana: extra("Estación de trabajo"), Eva: REGULAR };
    const plan = planTaskAutoSchedule({
        cells: [
            planCell("apoyo_turno", ["Ana", "Eva"], contexts),
            planCell("estacion_trabajo", ["Ana", "Eva"], contexts)
        ],
        history: history(entries),
        rng: seededRng(13)
    });

    assert.ok(workersIn(plan, "estacion_trabajo").includes("Ana"));
    assert.ok(!workersIn(plan, "apoyo_turno").includes("Ana"));
});

/* =========================================================
   Motivo aprendido y varias personas
========================================================= */

test("un motivo con otro nombre tambien manda si el historial lo relaciona", () => {
    // "Refuerzo urgencias" no se parece a TAC URGENCIA por el nombre, pero dos
    // martes la Larga extra con ese motivo termino en TAC URGENCIA.
    const entries = {};
    const contexts = new Map();

    WEEKS.forEach((week, index) => {
        entries[week] = {
            [`day|apoyo_turno|${MONDAYS[index]}`]: cell(["Bruno"]),
            ...(index < 2
                ? { [`day|tac_urgencia|${TUESDAYS[index]}`]: cell(["Ana"]) }
                : {})
        };
        contexts.set(`Ana|${TUESDAYS[index]}`, extra("Refuerzo urgencias"));
    });

    const planContexts = { Ana: extra("Refuerzo urgencias"), Bruno: REGULAR };
    const plan = planTaskAutoSchedule({
        cells: [
            planCell("apoyo_turno", ["Ana", "Bruno"], planContexts),
            planCell("tac_urgencia", ["Ana", "Bruno"], planContexts)
        ],
        history: history(entries, contexts),
        rng: seededRng(17)
    });

    assert.deepEqual(workersIn(plan, "tac_urgencia"), ["Ana"]);
});

test("si dos traen el mismo motivo, van los dos", () => {
    const entries = {};

    WEEKS.forEach((week, index) => {
        entries[week] = {
            [`day|apoyo_turno|${MONDAYS[index]}`]: cell(["Bruno"]),
            [`day|estacion_trabajo|${MONDAYS[index]}`]: cell(["Eva"])
        };
    });

    const contexts = {
        Ana: extra("Estación de trabajo"),
        Carla: extra("HHEE estacion de trabajo"),
        Bruno: REGULAR,
        Eva: REGULAR
    };
    const plan = planTaskAutoSchedule({
        cells: [
            planCell("apoyo_turno", ["Ana", "Carla", "Bruno", "Eva"], contexts),
            planCell("estacion_trabajo", ["Ana", "Carla", "Bruno", "Eva"], contexts)
        ],
        history: history(entries),
        rng: seededRng(19)
    });
    const station = workersIn(plan, "estacion_trabajo");

    assert.ok(station.includes("Ana"), station.join(", "));
    assert.ok(station.includes("Carla"), station.join(", "));
});

/* =========================================================
   Lo que no tiene que cambiar
========================================================= */

test("un motivo que no calza con ninguna tarea no fuerza nada", () => {
    const entries = {};

    WEEKS.forEach((week, index) => {
        entries[week] = {
            [`day|apoyo_turno|${MONDAYS[index]}`]: cell(["Bruno"]),
            ...(index === 0
                ? { [`day|estacion_trabajo|${MONDAYS[index]}`]: cell(["Eva"]) }
                : {})
        };
    });

    const contexts = { Ana: extra("Cobertura licencia médica"), Bruno: REGULAR };
    const plan = planTaskAutoSchedule({
        cells: [
            planCell("apoyo_turno", ["Ana", "Bruno"], contexts),
            planCell("estacion_trabajo", ["Ana", "Bruno"], contexts)
        ],
        history: history(entries),
        rng: seededRng(23)
    });

    // ESTACION sigue con cupo 0 los lunes y Ana no tiene por que ir.
    assert.deepEqual(workersIn(plan, "estacion_trabajo"), []);
    assert.ok(!plan.filled.some(item => item.workers.includes("Ana")));
});

test("quien fue sacado a mano de la casilla no vuelve por su motivo", () => {
    const entries = {};

    WEEKS.forEach((week, index) => {
        entries[week] = {
            [`day|apoyo_turno|${MONDAYS[index]}`]: cell(["Bruno"])
        };
    });

    const contexts = { Ana: extra("Estación de trabajo"), Bruno: REGULAR };
    const plan = planTaskAutoSchedule({
        cells: [
            planCell("apoyo_turno", ["Ana", "Bruno"], contexts),
            planCell("estacion_trabajo", ["Ana", "Bruno"], contexts, { blocked: ["Ana"] })
        ],
        history: history(entries),
        rng: seededRng(29)
    });

    assert.ok(!workersIn(plan, "estacion_trabajo").includes("Ana"));
});

test("la propuesta dice quien quedo por su motivo HHEE", () => {
    const entries = {};

    WEEKS.forEach((week, index) => {
        entries[week] = {
            [`day|apoyo_turno|${MONDAYS[index]}`]: cell(["Bruno"])
        };
    });

    const contexts = { Ana: extra("Estación de trabajo"), Bruno: REGULAR };
    const plan = planTaskAutoSchedule({
        cells: [
            planCell("apoyo_turno", ["Ana", "Bruno"], contexts),
            planCell("estacion_trabajo", ["Ana", "Bruno"], contexts)
        ],
        history: history(entries),
        rng: seededRng(31)
    });
    const station = plan.filled.find(item => item.taskId === "estacion_trabajo");

    assert.deepEqual(station?.extraReasonWorkers, ["Ana"]);
});

/* =========================================================
   El panel le pasa al motor el nombre de cada tarea
========================================================= */

test("las casillas llevan el nombre de sus tareas, para calzarlo con el motivo", async () => {
    const source = (await readFile(
        new URL("../js/taskAssignments.js", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    assert.match(source, /taskTitles: autoScheduleTaskTitles\(tasks, group\.taskIds\),/);
    // El aviso va en las notas que SI muestra la propuesta. Al principio quedo
    // en autoSchedulePlanSummary, que nadie llama: el build la elimina y el
    // aviso no se veia.
    assert.match(
        source,
        /function autoScheduleSkipSummary\(plan\) \{[\s\S]{0,900}a la tarea que indica su motivo de HHEE/
    );
});

/* =========================================================
   Lo aprendido del historial, con el caso real (2026-09-15)
========================================================= */

// Como en Imagenologia: el que viene a la extension hace su tarea de siempre Y
// APOYO TURNO. Sus lunes con motivo: resonador+apoyo, rayos+apoyo,
// mamografia+apoyo, resonador solo. Sus martes, sin motivo, solo la de siempre.
const EXTENSION = "Extensión Apoyo Clínico Rx TC";

function extensionHistory(addToWeek = () => {}) {
    const entries = {};
    const contexts = new Map();
    const mondays = [
        ["resonador", "apoyo_turno"],
        ["rayos", "apoyo_turno"],
        ["mamografia", "apoyo_turno"],
        ["resonador"]
    ];
    const tuesdays = ["resonador", "rayos", "mamografia", "resonador"];

    WEEKS.forEach((week, index) => {
        entries[week] = {};
        mondays[index].forEach(taskId => {
            entries[week][`day|${taskId}|${MONDAYS[index]}`] = cell(["Seba"]);
        });
        entries[week][`day|${tuesdays[index]}|${TUESDAYS[index]}`] = cell(["Seba"]);
        contexts.set(`Seba|${MONDAYS[index]}`, extra(EXTENSION));
        contexts.set(`Seba|${TUESDAYS[index]}`, REGULAR);
        addToWeek(index, entries[week], contexts);
    });

    return { entries, contexts };
}

test("la extension va a APOYO TURNO aunque ese dia tambien haga su tarea de siempre", () => {
    // Contando tareas sueltas APOYO TURNO era 3 de 7 (43%) y no llegaba al 50%:
    // las de siempre la diluian. Por dia fue 3 de 4 lunes, y ningun martes sin
    // motivo. Y ese lunes ya esta en RAYOS, sin patron multitarea RAYOS + APOYO
    // TURNO: el motivo igual se la suma.
    const { entries, contexts } = extensionHistory();
    const planContexts = { Seba: extra(EXTENSION), Bruno: REGULAR };
    const plan = planTaskAutoSchedule({
        cells: [
            planCell("apoyo_turno", ["Seba", "Bruno"], planContexts, {
                existingTaskIdsByWorker: { Seba: ["rayos"] }
            })
        ],
        history: history(entries, contexts),
        rng: seededRng(37)
    });
    const support = plan.filled.find(item => item.taskId === "apoyo_turno");

    assert.ok(support?.workers.includes("Seba"), JSON.stringify(plan.filled));
    assert.deepEqual(support.extraReasonWorkers, ["Seba"]);
});

test("la tarea que hace igual con o sin motivo no es la del motivo", () => {
    const { entries, contexts } = extensionHistory();
    const learned = history(entries, contexts);

    // RESONADOR: 2 de 4 lunes con motivo, y 2 de 4 martes sin el.
    assert.equal(
        extraReasonTaskAffinity(learned, "day", ["resonador"], EXTENSION).matches,
        false
    );
    assert.equal(
        extraReasonTaskAffinity(learned, "day", ["apoyo_turno"], EXTENSION).matches,
        true
    );
    // Escrito con otras mayusculas y sin tildes es el mismo motivo.
    assert.equal(
        extraReasonTaskAffinity(learned, "day", ["apoyo_turno"], "extension apoyo clinico RX TC").matches,
        true
    );
    // Y en otro turno ese motivo no dice nada.
    assert.equal(
        extraReasonTaskAffinity(learned, "night", ["apoyo_turno"], EXTENSION).hasPattern,
        false
    );
});

test("motivos parecidos de la lista no se mezclan", () => {
    // "Apoyo Clinico TC" lleva al ESCANER. Por parecido de palabras era el
    // mismo motivo que la extension, y la extension terminaba en el ESCANER.
    const { entries, contexts } = extensionHistory((index, weekEntries, weekContexts) => {
        weekEntries[`day|escaner|${MONDAYS[index]}`] = cell(["Carla"]);
        weekEntries[`day|relevo|${TUESDAYS[index]}`] = cell(["Carla"]);
        weekContexts.set(`Carla|${MONDAYS[index]}`, extra("Apoyo Clinico TC"));
        weekContexts.set(`Carla|${TUESDAYS[index]}`, REGULAR);
    });
    const planContexts = { Seba: extra(EXTENSION), Carla: REGULAR };
    const plan = planTaskAutoSchedule({
        cells: [
            planCell("escaner", ["Seba", "Carla"], planContexts),
            planCell("apoyo_turno", ["Seba", "Carla"], planContexts)
        ],
        history: history(entries, contexts),
        rng: seededRng(39)
    });

    assert.ok(!workersIn(plan, "escaner").includes("Seba"));
    assert.ok(workersIn(plan, "apoyo_turno").includes("Seba"));
});

test("lo aprendido manda sobre el nombre del motivo", () => {
    // Dos lunes seguidos "Estacion de trabajo" termino en APOYO TURNO. El
    // nombre apunta a ESTACION DE TRABAJO, pero lo que se hace es otra cosa.
    const entries = {};
    const contexts = new Map();

    WEEKS.forEach((week, index) => {
        entries[week] = {
            [`day|estacion_trabajo|${MONDAYS[index]}`]: cell(["Eva"]),
            ...(index < 2
                ? { [`day|apoyo_turno|${MONDAYS[index]}`]: cell(["Ana"]) }
                : {})
        };
        contexts.set(`Ana|${MONDAYS[index]}`, extra("Estación de trabajo"));
    });

    const planContexts = { Ana: extra("Estación de trabajo"), Eva: REGULAR };
    const plan = planTaskAutoSchedule({
        cells: [
            planCell("apoyo_turno", ["Ana", "Eva"], planContexts),
            planCell("estacion_trabajo", ["Ana", "Eva"], planContexts)
        ],
        history: history(entries, contexts),
        rng: seededRng(41)
    });

    assert.ok(workersIn(plan, "apoyo_turno").includes("Ana"));
    assert.ok(!workersIn(plan, "estacion_trabajo").includes("Ana"));
});

test("renombrar la tarea no pierde lo aprendido: va por id", () => {
    const { entries, contexts } = extensionHistory();
    const plan = planTaskAutoSchedule({
        cells: [
            planCell("apoyo_turno", ["Seba"], { Seba: extra(EXTENSION) }, {
                taskTitles: { apoyo_turno: "REFUERZO DE LA TARDE" }
            })
        ],
        history: history(entries, contexts),
        rng: seededRng(43)
    });

    assert.deepEqual(workersIn(plan, "apoyo_turno"), ["Seba"]);
});

test("al publicar no se le vuelve a exigir tipo de turno ni patron multitarea", async () => {
    const source = (await readFile(
        new URL("../js/taskAssignments.js", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    assert.match(
        source,
        /const motiveWorkers = new Set\(item\.extraReasonWorkers \|\| \[\]\);/
    );
    assert.match(
        source,
        /const manual = edited \|\| manualWorkers\.has\(name\) \|\| motiveWorkers\.has\(name\);/
    );
    // Y si lo sacan de la propuesta, deja de contar en el aviso.
    assert.match(
        source,
        /const extraReasonWorkers = uniqueValues\(item\.extraReasonWorkers \|\| \[\]\)\s*\.filter\(name => workers\.includes\(name\)\);/
    );
});
