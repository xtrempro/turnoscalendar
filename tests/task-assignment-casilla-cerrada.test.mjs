// Cerrar una casilla: esa tarea, ese dia y ese turno, no va.
//
// Cuatro cosas que, si se rompen, no se quejan solas:
//
//   A. La casilla cerrada esta VACIA, y una casilla vacia se borra al guardar.
//      Sin excepcion explicita, el cierre se pierde en el siguiente pintado.
//   B. No se llena sola: ni por regla de predefinido, ni por programacion
//      automatica. El saneado corre en CADA pintado, asi que un predefinido
//      volveria a entrar solo.
//   C. No cuenta como hueco en el aviso de "sin cubrir": es lo que la
//      distingue de una casilla vacia de verdad.
//   D. La PWA del trabajador tampoco la muestra. Y esto NO se arregla dejando
//      la casilla vacia: el predefinido no se lee de la casilla, se recalcula
//      de la regla del catalogo, asi que la proyeccion tiene que mirar el
//      cierre por su cuenta.
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
    ${grab(src, "uniqueValues")}
    ${grab(src, "assignmentWorkers")}
    ${grab(src, "assignmentRemovedDefaults")}
    ${grab(src, "assignmentClosed")}
    ${grab(src, "cellIsSettled")}
    ${grab(src, "persistEntryOrDelete")}
    return {
        assignmentClosed,
        cellIsSettled,
        persistEntryOrDelete
    };
`)();

// --- A. el cierre sobrevive al guardado -------------------------------------

test("una casilla cerrada y vacia NO se borra al guardar", () => {
    const assignments = {};

    api.persistEntryOrDelete(assignments, "day|t1|2026-8-1", {
        workers: [],
        note: "",
        removedDefaults: [],
        closed: true
    });

    assert.deepEqual(assignments["day|t1|2026-8-1"], {
        workers: [],
        note: "",
        removedDefaults: [],
        closed: true
    });
});

test("una casilla vacia SIN cerrar se sigue borrando", () => {
    const assignments = { "day|t1|2026-8-1": { workers: ["ANA"] } };

    api.persistEntryOrDelete(assignments, "day|t1|2026-8-1", {
        workers: [],
        note: "",
        removedDefaults: []
    });

    assert.equal(Object.hasOwn(assignments, "day|t1|2026-8-1"), false);
});

test("el cierre convive con la fusion de casillas", () => {
    const assignments = {};

    api.persistEntryOrDelete(assignments, "day|t1|2026-8-1", {
        workers: [],
        note: "",
        removedDefaults: [],
        closed: true,
        mergedNextTaskId: "t2"
    });

    assert.equal(assignments["day|t1|2026-8-1"].closed, true);
    assert.equal(assignments["day|t1|2026-8-1"].mergedNextTaskId, "t2");
});

test("cerrada y con gente dentro no es un estado posible", () => {
    // La casilla dibuja "Cerrada" o dibuja los chips, no las dos cosas. Los dos
    // caminos por los que podria entrar gente a una cerrada -fusionar y
    // reescribir la lista- la abren.
    const fusion = grab(src, "collapseGroupWorkers");
    const escribir = grab(src, "setCellWorkers");

    assert.match(fusion, /closed: assignmentClosed\(owner\) && !workers\.length/);
    assert.match(
        escribir,
        /closed: assignmentClosed\(entry\) && !nextWorkers\.length/
    );
});

// --- C. no es un hueco ------------------------------------------------------

test("la casilla cerrada cuenta como resuelta, no como hueco", () => {
    const cerrada = { workers: [], note: "", removedDefaults: [], closed: true };
    const vacia = { workers: [], note: "", removedDefaults: [] };
    const conGente = { workers: ["ANA"], note: "", removedDefaults: [] };

    assert.equal(api.cellIsSettled(cerrada, []), true);
    assert.equal(api.cellIsSettled(vacia, []), false);
    assert.equal(api.cellIsSettled(conGente, []), true);
    // Y el equipo en mantenimiento sigue contando igual que antes.
    assert.equal(api.cellIsSettled(vacia, [{ id: "eq1" }]), true);
});

// --- B. no se llena sola ----------------------------------------------------

test("el reparto automatico no mira las casillas cerradas", () => {
    const fuente = grab(src, "autoScheduleCells");

    assert.match(fuente, /if \(assignmentClosed\(entry\)\) return;/);
    // Y el guardia va ANTES de anotar la casilla como candidata.
    assert.ok(
        fuente.indexOf("assignmentClosed(entry)") < fuente.indexOf("cells.push"),
        "el guardia tiene que ir antes de encolar la casilla"
    );
});

test("las reglas de predefinido no llenan una casilla cerrada", () => {
    const fuente = grab(src, "applyDefaultAssignments");

    assert.match(fuente, /if \(assignmentClosed\(entry\)\) return;/);
    assert.ok(
        fuente.indexOf("assignmentClosed(entry)") <
            fuente.indexOf("assignments[cellKey] ="),
        "el guardia tiene que ir antes de escribir la casilla"
    );
});

// --- la superficie: cerrar y volver a abrir ---------------------------------

test("cerrar vive en el selector de la casilla y abrir en la casilla", () => {
    // Cerrar es poco frecuente: va en el pie del selector. Abrir tiene que
    // estar en la casilla, porque con el boton de asignar deshabilitado el
    // selector ya no se puede abrir.
    assert.match(src, /data-picker-close-cell/);
    assert.match(src, /data-cell-open/);
    assert.match(src, /setCellClosed\(shift, taskId, keyDay, true\)/);
    assert.match(src, /setCellClosed\(\s*cell\.dataset\.shift/);
});

test("cerrar con gente dentro avisa antes de sacarla", () => {
    const desde = src.indexOf('querySelector("[data-picker-close-cell]")');
    const handler = src.slice(desde, desde + 1400);

    assert.match(handler, /current\.length &&/);
    assert.match(handler, /showConfirm\(/);
    assert.match(handler, /queda fuera de esta casilla al cerrarla/);
});

test("la casilla cerrada no admite gente arrastrada", () => {
    // El flag es comun con el mantenimiento de equipos: lo que bloquea no
    // necesita saber cual de las dos razones es.
    assert.match(src, /const blocked = maintenanceBlocked \|\| closed;/);
    assert.match(src, /blocked \? 'data-cell-blocked="true"' : ""/);
    assert.match(src, /cell\.dataset\.cellBlocked !== "true" &&/);
});

// --- D. la PWA del trabajador ----------------------------------------------

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

function scheduleForWeek() {
    return {
        days: {
            "2026-07-20": { iso: "2026-07-20" },
            "2026-07-21": { iso: "2026-07-21" },
            "2026-07-22": { iso: "2026-07-22" }
        }
    };
}

function taskTitles(projected, iso) {
    return projected.days[iso].taskAssignments?.map(item => item.title) || [];
}

async function proyectar(entries) {
    globalThis.localStorage = createMemoryStorage();

    const {
        addTaskAssignmentsToSchedule,
        TASK_ASSIGNMENT_ENTRIES_KEY,
        TASK_ASSIGNMENT_TASKS_KEY
    } = await import("../js/taskAssignmentProjection.js");

    setJSON("baseData_Ana", {
        "2026-6-20": TURNO.LARGA,
        "2026-6-21": TURNO.LARGA,
        "2026-6-22": TURNO.LARGA
    });
    setJSON(TASK_ASSIGNMENT_ENTRIES_KEY, entries);
    setJSON(TASK_ASSIGNMENT_TASKS_KEY, [{
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
    }]);

    return addTaskAssignmentsToSchedule({ name: "Ana" }, scheduleForWeek());
}

test("el predefinido NO llega al telefono en el dia que la casilla esta cerrada", async () => {
    const projected = await proyectar({
        "2026-07-20": {
            // Cerrada y vacia: sin el guardia, la regla del catalogo la
            // repondria igual, porque el predefinido no se lee de la casilla.
            "day|task_dia|2026-6-21": {
                workers: [],
                note: "",
                removedDefaults: [],
                closed: true
            }
        }
    });

    assert.deepEqual(taskTitles(projected, "2026-07-20"), ["Sala de yeso"]);
    assert.deepEqual(taskTitles(projected, "2026-07-21"), []);
    assert.deepEqual(taskTitles(projected, "2026-07-22"), ["Sala de yeso"]);
});

test("una casilla cerrada tampoco publica a quien quedo escrito dentro", async () => {
    const projected = await proyectar({
        "2026-07-20": {
            "day|task_dia|2026-6-21": {
                workers: ["Ana"],
                note: "",
                removedDefaults: [],
                closed: true
            }
        }
    });

    assert.deepEqual(taskTitles(projected, "2026-07-21"), []);
});
