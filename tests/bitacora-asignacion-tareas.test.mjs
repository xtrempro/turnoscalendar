// La asignacion de tareas no dejaba rastro en la bitacora. El 2026-09-10 un
// supervisor combino casillas y saco gente de la semana del 14-sep, otra
// administradora lo deshizo media hora despues, y para saber quien habia sido
// hubo que ir a la nube con Point-in-Time Recovery y cruzar ids de navegador.
//
// Estas pruebas EJECUTAN el resumen: el diff, la acumulacion entre guardados y
// el texto que queda en la bitacora.
import test from "node:test";
import assert from "node:assert/strict";
import {
    accumulateWeekChanges,
    createWeekChangeAccumulator,
    describeWeekChanges,
    diffWeekAssignments,
    weekChangesAreEmpty
} from "../js/taskAssignmentAudit.js";

const TITLES = {
    RES: "RESONADOR",
    RMR: "RM RELEVO",
    ECO: "ECÓGRAFO",
    APO: "APOYO TURNO",
    RX1: "RAYOS 1"
};
const DAYS = {
    "2026-8-18": "vie 18",
    "2026-8-19": "sáb 19",
    "2026-8-20": "dom 20"
};
const labels = {
    taskTitle: id => TITLES[id] || id,
    dayLabel: key => DAYS[key] || key,
    workerLabel: name => name
};

function summarize(...saves) {
    const acc = createWeekChangeAccumulator();

    saves.forEach(([before, after]) =>
        accumulateWeekChanges(acc, diffWeekAssignments(before, after))
    );

    return describeWeekChanges(acc, labels);
}

test("el diff ve personas, combinaciones, cierres y notas, y no removedDefaults", () => {
    const diff = diffWeekAssignments(
        {
            "day|RES|2026-8-18": { workers: ["ANA"], note: "" },
            "day|RMR|2026-8-18": { workers: ["LUIS"], removedDefaults: ["X"] }
        },
        {
            "day|RES|2026-8-18": { workers: [], mergedNextTaskId: "RMR", note: "ojo" },
            "day|RMR|2026-8-18": { workers: ["LUIS", "ANA"], removedDefaults: [] },
            "day|RX1|2026-8-19": { workers: [], closed: true }
        }
    );

    assert.deepEqual(
        diff.workers.map(item => `${item.delta} ${item.worker} ${item.cellKey}`).sort(),
        ["-1 ANA day|RES|2026-8-18", "1 ANA day|RMR|2026-8-18"]
    );
    assert.deepEqual(
        diff.fields.map(item => `${item.field} ${item.cellKey}`).sort(),
        ["closed day|RX1|2026-8-19", "merged day|RES|2026-8-18", "note day|RES|2026-8-18"]
    );
});

test("ida y vuelta no deja rastro", () => {
    const vacia = {};
    const conAna = { "day|RES|2026-8-18": { workers: ["ANA"] } };
    const combinada = { "day|RES|2026-8-18": { workers: [], mergedNextTaskId: "RMR" } };

    assert.equal(summarize([vacia, conAna], [conAna, vacia]), null);
    assert.equal(summarize([vacia, combinada], [combinada, vacia]), null);
});

test("combinar sube a la gente a la casilla de arriba: se cuenta como movimiento", () => {
    const resumen = summarize([
        {
            "day|RES|2026-8-18": { workers: [] },
            "day|RMR|2026-8-18": { workers: ["ANA"] }
        },
        {
            "day|RES|2026-8-18": { workers: ["ANA"], mergedNextTaskId: "RMR" },
            "day|RMR|2026-8-18": { workers: [] }
        }
    ]);

    assert.equal(
        resumen.text,
        "movió a ANA de RM RELEVO a RESONADOR (vie 18); combinó casillas (vie 18)"
    );
    assert.equal(resumen.counts.moved, 1);
    assert.equal(resumen.counts.removed, 0);
    assert.equal(resumen.counts.added, 0);
});

test("lo mismo en varios dias va en una sola frase, en orden", () => {
    const antes = {
        "day|ECO|2026-8-20": { workers: ["NICOLE"] },
        "day|ECO|2026-8-18": { workers: ["NICOLE"] },
        "day|ECO|2026-8-19": { workers: ["NICOLE"] }
    };

    assert.equal(
        summarize([antes, {}]).text,
        "quitó a NICOLE de ECÓGRAFO (vie 18, sáb 19, dom 20)"
    );
});

// El caso que motivo esto: el saneado automatico corre en cada pintado y puede
// quitar a alguien (por ejemplo, porque otro supervisor le aplico un permiso).
// Pasa ENTRE dos guardados deliberados, y no lo hizo quien edita tareas.
test("lo que cambia entre dos guardados no se le atribuye a nadie", () => {
    const resumen = summarize(
        // 1er guardado: saca a W. Z sigue.
        [{ "day|RES|2026-8-18": { workers: ["W", "Z"] } },
            { "day|RES|2026-8-18": { workers: ["Z"] } }],
        // (el saneado saca a Z; el 2o guardado ya parte sin el)
        [{ "day|RES|2026-8-18": { workers: [] } },
            { "day|RES|2026-8-18": { workers: ["Q"] } }]
    );

    assert.equal(resumen.text, "quitó a W de RESONADOR (vie 18); puso a Q en RESONADOR (vie 18)");
    assert.doesNotMatch(resumen.text, /Z/);
});

test("de noche se dice, porque la misma tarea esta en los dos tableros", () => {
    const resumen = summarize([
        {},
        { "night|RX1|2026-8-18": { workers: ["ANA"] }, "day|RX1|2026-8-19": { workers: [], closed: true } }
    ]);

    assert.equal(resumen.text, "puso a ANA en RAYOS 1 de noche (vie 18); cerró RAYOS 1 (sáb 19)");
});

test("con muchos cambios se corta y dice cuantos faltan", () => {
    const antes = {};
    const despues = {};

    ["A", "B", "C", "D"].forEach(worker => {
        despues[`day|RES|2026-8-18`] = {
            workers: [...(despues["day|RES|2026-8-18"]?.workers || []), worker]
        };
    });
    despues["day|ECO|2026-8-19"] = { workers: ["E"] };

    const acc = createWeekChangeAccumulator();

    accumulateWeekChanges(acc, diffWeekAssignments(antes, despues));

    const resumen = describeWeekChanges(acc, { ...labels, maxItems: 2 });

    assert.match(resumen.text, /; y 3 cambios más$/);
    assert.equal(resumen.counts.added, 5);
});

test("sin cambios netos no hay nada que registrar", () => {
    const acc = createWeekChangeAccumulator();

    assert.ok(weekChangesAreEmpty(acc));
    assert.equal(describeWeekChanges(acc, labels), null);
});

// --- El pegamento en taskAssignments.js --------------------------------------
// Esto no se puede ejecutar en Node (el modulo pinta el tablero), asi que se
// fija en el fuente lo que decide QUE se registra y DONDE.
import { readFile } from "node:fs/promises";

const tasksSrc = await readFile(
    new URL("../js/taskAssignments.js", import.meta.url),
    "utf8"
);
const auditSrc = await readFile(
    new URL("../js/auditLog.js", import.meta.url),
    "utf8"
);

function grab(name) {
    const start = tasksSrc.indexOf(`function ${name}(`);

    assert.notEqual(start, -1, `no se encontro ${name}`);

    let depth = 0;

    for (let i = tasksSrc.indexOf("{", tasksSrc.indexOf(")", start)); i < tasksSrc.length; i += 1) {
        if (tasksSrc[i] === "{") depth += 1;
        else if (tasksSrc[i] === "}") {
            depth -= 1;
            if (!depth) return tasksSrc.slice(start, i + 1);
        }
    }

    throw new Error(`sin cierre: ${name}`);
}

test("solo las ediciones deliberadas llegan a la bitacora", () => {
    const fn = grab("saveWeekAssignments");

    assert.match(fn, /function saveWeekAssignments\(assignments, start = currentWeekStart, \{ touch = true \} = \{\}\)/);
    assert.match(fn, /const before = touch \? storedWeekAssignments\(start\) : null;/);
    assert.match(fn, /if \(touch\) \{[\s\S]{0,160}noteDeliberateWeekEdit\(start, before, assignments\)/);
    // El saneado sigue guardando con touch: false, asi que no firma nada.
    assert.match(tasksSrc, /if \(changed\) saveWeekAssignments\(assignments, start, \{ touch: false \}\)/);
});

// La cache de persistence clona solo la raiz: las semanas son el mismo objeto
// que quien llama ya modifico. Leida con getJSON, la foto de antes saldria igual
// a la de despues y el resumen quedaria siempre vacio, sin ningun error.
test("la foto de antes sale del texto guardado, no de la cache", () => {
    const fn = grab("storedWeekAssignments");

    assert.match(fn, /JSON\.parse\(getRaw\(ASSIGNMENTS_KEY/);
    assert.doesNotMatch(fn, /getJSON|getAllAssignments|getWeekAssignments/);
});

test("un resumen por semana, sin perfil, y nunca en otra unidad", () => {
    const flush = grab("flushTaskAssignmentAudit");

    assert.match(flush, /AUDIT_CATEGORY\.TASKS/);
    assert.match(flush, /profile: ""/);
    assert.match(flush, /taskAuditWorkspaceId === activeWorkspaceIdForAudit\(\)/);
    assert.match(grab("logTaskCatalogChange"), /profile: ""/);
    // Al ocultar o cerrar la pestana se vuelca: esperar el minuto de calma ahi
    // seria perder el registro.
    assert.match(tasksSrc, /visibilityState === "hidden"\) flushTaskAssignmentAudit\(\)/);
    assert.match(tasksSrc, /addEventListener\("pagehide"/);
});

test("borrar una tarea deja constancia de lo que se llevo", () => {
    const fn = grab("deleteTask");
    const footprintAt = fn.indexOf("taskAssignmentFootprint(taskId, getAllAssignments())");
    const saveAt = fn.indexOf("saveTasks(");

    assert.ok(footprintAt !== -1 && footprintAt < saveAt, "la huella se mide antes de borrar");
    assert.match(fn, /logTaskCatalogChange\(\s*"Eliminó una tarea"/);
});

test("el resto del catalogo tambien firma", () => {
    [
        ["addTask", "Creó una tarea"],
        ["updateTaskTitle", "Renombró una tarea"],
        ["updateTaskDetail", "Editó el detalle de una tarea"],
        ["updateTaskDefaultWorkerRule", "Cambió un trabajador predefinido"],
        ["setTaskShiftScope", "Cambió el turno de una tarea"],
        ["reorderTask", "Cambió el orden de las tareas"]
    ].forEach(([name, action]) => {
        assert.ok(grab(name).includes(`"${action}"`), `${name} no firma`);
    });
});

test("la bitacora tiene la categoria de tareas", () => {
    assert.match(auditSrc, /TASKS: "tasks"/);
    assert.match(auditSrc, /key: AUDIT_CATEGORY\.TASKS,\s*title: "Asignacion de Tareas"/);
});
