// "Asignar" en el tablero: primero a quienes pondria la programacion automatica,
// y en el hover las ultimas 5 tareas de cada persona.
//
// Pedido del usuario (2026-09-15): al abrir la lista de una casilla, que
// aparezcan arriba los que el algoritmo recomienda para esa tarea, como si se
// usara la programacion automatica; y que el hover de las opciones y de los
// chips ya asignados muestre las ultimas 5 tareas de cada uno.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    buildTaskAutoScheduleHistory,
    recommendTaskCandidates
} from "../js/taskAutoSchedule.js";

const WEEKS = ["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24"];
const PLAN_WEEK = "2026-08-31";
const PLAN_MONDAY = "2026-7-31";

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

// ESTACION DE TRABAJO: Eva casi siempre, Gabi los lunes.
// RESONADOR: Ana todos los dias; Bruno y Fede se turnan, y tambien RAYOS.
function history() {
    const entries = {};

    WEEKS.forEach(week => {
        entries[week] = {};
        weekdaysOf(week).forEach((day, dayIndex) => {
            entries[week][`day|estacion_trabajo|${day}`] = cell([
                dayIndex === 0 ? "Gabi" : "Eva"
            ]);
            entries[week][`day|resonador|${day}`] = cell(
                dayIndex % 2 ? ["Ana", "Bruno"] : ["Ana", "Fede"]
            );
            entries[week][`day|rayos|${day}`] = cell(
                dayIndex % 2 ? ["Fede"] : ["Bruno"]
            );
        });
    });

    return buildTaskAutoScheduleHistory(entries, { beforeWeekKey: PLAN_WEEK });
}

function planCell(taskId, candidates, more = {}) {
    return {
        shift: "day",
        keyDay: PLAN_MONDAY,
        taskId,
        taskIds: [taskId],
        taskTitles: { [taskId]: taskId === "estacion_trabajo" ? "ESTACIÓN DE TRABAJO" : taskId.toUpperCase() },
        candidates,
        candidateTurnContextByWorker: {},
        existingTaskIdsByWorker: {},
        blocked: [],
        ...more
    };
}

test("primero quien trae el motivo HHEE, despues quien tiene historial", () => {
    const recommended = recommendTaskCandidates({
        cell: planCell("estacion_trabajo", ["Carla", "Eva", "Gabi", "Ana"], {
            candidateTurnContextByWorker: {
                Ana: { extraReason: "Estación de trabajo" }
            },
            // A Gabi lo sacaron a mano de esta casilla.
            blocked: ["Gabi"]
        }),
        history: history()
    });

    // Carla nunca hizo la tarea: no es recomendacion, sigue en la lista comun.
    assert.deepEqual(recommended, [
        { name: "Ana", byExtraReason: true },
        { name: "Eva", byExtraReason: false }
    ]);
});

test("quien ya esta en otra tarea sin patron multitarea no se recomienda", () => {
    const recommended = recommendTaskCandidates({
        cell: planCell("estacion_trabajo", ["Eva", "Ana"], {
            candidateTurnContextByWorker: {
                Ana: { extraReason: "Estación de trabajo" }
            },
            existingTaskIdsByWorker: { Eva: ["resonador"], Ana: ["resonador"] }
        }),
        history: history()
    });

    // Eva nunca junto ESTACION con RESONADOR. A Ana su motivo si se la suma.
    assert.deepEqual(recommended.map(item => item.name), ["Ana"]);
});

test("entre los que tienen historial, primero el que mas la hace", () => {
    const recommended = recommendTaskCandidates({
        cell: planCell("resonador", ["Bruno", "Carla", "Fede", "Ana"]),
        history: history()
    });

    assert.equal(recommended[0]?.name, "Ana");
    assert.deepEqual(
        recommended.map(item => item.name).sort(),
        ["Ana", "Bruno", "Fede"]
    );
});

test("sin casilla no hay recomendacion", () => {
    assert.deepEqual(recommendTaskCandidates(), []);
});

/* =========================================================
   El panel
========================================================= */

const source = (await readFile(
    new URL("../js/taskAssignments.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");
const slice = (from, to) => source.slice(
    source.indexOf(from),
    source.indexOf(to, source.indexOf(from) + from.length)
);

test("la lista de Asignar pone arriba a los recomendados", () => {
    const picker = slice("function renderCellPickerMarkup(", "\nfunction ");

    assert.match(picker, /cellPickerRecommendations\(/);
    assert.match(picker, />Recomendados</);
    // Nadie desaparece de la lista por no estar recomendado.
    assert.match(picker, /Otros disponibles/);
});

test("la recomendacion usa el mismo motor que la programacion automatica", () => {
    const helper = slice("function cellPickerRecommendations(", "\nfunction ");

    assert.match(helper, /recommendTaskCandidates\(\{/);
    assert.match(helper, /history: cachedAutoScheduleHistory\(\)/);
    assert.match(helper, /existingTaskIdsByWorker: serializeWorkerTaskMap\(/);
    assert.match(helper, /blocked: assignmentRemovedDefaults\(entry\)/);
});

test("el historial de la recomendacion se guarda un rato y se descarta si cambian turnos o perfiles", () => {
    assert.match(source, /const AUTO_SCHEDULE_HISTORY_CACHE_MS = /);
    assert.match(
        source,
        /proturnos:persistenceChanged[\s\S]{0,400}key === ASSIGNMENTS_KEY[\s\S]{0,200}autoScheduleHistoryCache = null;/
    );
});

test("el hover de las opciones y de los chips muestra las ultimas 5 tareas", () => {
    const option = slice("function renderCellPickerOption(", "\nfunction ");
    const chip = slice("function renderWorkerChip(", "\nfunction ");

    assert.match(option, /title="\$\{escapeHTML\(autoScheduleWorkerHoverTitle\([\s\S]*?\{ untilDay: true \}/);
    assert.match(chip, /autoScheduleWorkerHoverTitle\([\s\S]*?\{ untilDay: true \}/);
});

test("en el tablero las ultimas tareas llegan hasta el dia anterior, no hasta la semana", () => {
    const hover = slice("function autoScheduleWorkerHoverTitle(", "\nfunction ");
    const recent = slice("function autoScheduleRecentWorkerTasks(", "\nfunction ");

    assert.match(hover, /untilDay\s*\?\s*parseKey\(keyDay\)\s*:\s*weekStartMonday\(parseKey\(keyDay\)\)/);
    assert.match(recent, /row\.time < cutoff/);
    assert.match(recent, /\.slice\(0, 5\)/);
});
