// La X de una tarea se lleva por delante todas sus asignaciones. Antes borraba
// sin decir cuantas: el 2026-09-09 costo 600 nombres en Imagenologia. Y borrar
// para volver a crear con el mismo nombre PARECE un renombre y no lo es: la
// tarea nueva nace con otro id y las semanas pasadas quedan apuntando a una que
// ya no existe. Por eso el aviso trae la cifra y ofrece renombrar.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(
    new URL("../js/taskAssignments.js", import.meta.url),
    "utf8"
);
const dialogs = await readFile(
    new URL("../js/dialogs.js", import.meta.url),
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
    ${grab(src, "splitAssignmentKey")}
    ${grab(src, "asignacionesLabel")}
    ${grab(src, "semanasLabel")}
    ${grab(src, "taskAssignmentFootprint").replace(/^export /, "")}
    ${grab(src, "taskDeleteWarning").replace(/^export /, "")}
    ${grab(src, "taskShiftDeleteWarning").replace(/^export /, "")}
    return {
        taskAssignmentFootprint,
        taskDeleteWarning,
        taskShiftDeleteWarning
    };
`)();

const CELDA = (workers) => ({ workers, note: "", removedDefaults: [] });

const ASIGNACIONES = {
    "2026-08-24": {
        "day|task_a|2026-7-24": CELDA(["ANA", "BETO"]),
        "day|task_a|2026-7-25": CELDA(["ANA"]),
        "day|task_b|2026-7-24": CELDA(["CARLA"])
    },
    "2026-08-31": {
        "day|task_a|2026-7-31": CELDA(["ANA", "BETO", "CARLA"]),
        "day|task_a|2026-8-1": CELDA([]),
        "day|task_c|2026-8-1": CELDA(["DIEGO"])
    }
};

test("cuenta nombres, casillas y semanas de una tarea", () => {
    const huella = api.taskAssignmentFootprint("task_a", ASIGNACIONES);

    assert.deepEqual(huella, { names: 6, cells: 3, weeks: 2 });
});

test("una casilla sin nadie no cuenta como asignacion ni suma su semana", () => {
    // La casilla vacia de task_a en 2026-08-31 no debe inflar la cifra.
    const huella = api.taskAssignmentFootprint("task_c", ASIGNACIONES);

    assert.deepEqual(huella, { names: 1, cells: 1, weeks: 1 });
});

test("una tarea sin asignaciones da cero", () => {
    assert.deepEqual(
        api.taskAssignmentFootprint("task_z", ASIGNACIONES),
        { names: 0, cells: 0, weeks: 0 }
    );
});

test("el aviso dice cuantas asignaciones y en cuantas semanas", () => {
    const texto = api.taskDeleteWarning(
        "RESONADOR",
        api.taskAssignmentFootprint("task_a", ASIGNACIONES)
    );

    assert.match(texto, /RESONADOR/);
    assert.match(texto, /6 asignaciones/);
    assert.match(texto, /2 semanas/);
    // Y empuja al renombre, que es lo que casi siempre se queria hacer.
    assert.match(texto, /renombrala/i);
});

test("el aviso usa singular cuando corresponde", () => {
    const texto = api.taskDeleteWarning(
        "MAMOGRAFIA",
        api.taskAssignmentFootprint("task_c", ASIGNACIONES)
    );

    assert.match(texto, /1 asignacion en 1 semana/);
    assert.doesNotMatch(texto, /1 asignaciones/);
});

test("la huella se puede pedir de un solo turno", () => {
    const noche = api.taskAssignmentFootprint("task_a", ASIGNACIONES, "night");
    const dia = api.taskAssignmentFootprint("task_a", ASIGNACIONES, "day");

    // Todas las casillas del ejemplo son diurnas: quitarla de noche no se
    // lleva a nadie, y el aviso tiene que poder decirlo.
    assert.deepEqual(noche, { names: 0, cells: 0, weeks: 0 });
    assert.deepEqual(dia, { names: 6, cells: 3, weeks: 2 });
});

test("el aviso de una tarea en los dos turnos separa las dos salidas", () => {
    const texto = api.taskShiftDeleteWarning(
        "RESONADOR",
        "day",
        api.taskAssignmentFootprint("task_a", ASIGNACIONES),
        api.taskAssignmentFootprint("task_a", ASIGNACIONES, "day")
    );

    assert.match(texto, /esta en tareas diurnas y en tareas de noche/);
    // Lo que se lleva quitarla de ese turno...
    assert.match(texto, /Quitarla de las tareas diurnas borra 6 asignaciones/);
    // ...y lo que se lleva borrarla entera.
    assert.match(texto, /Eliminarla en ambos se lleva 6 asignaciones en 2 semanas/);
    assert.match(texto, /renombrala/i);
});

test("si en ese turno no hay nadie, el aviso lo dice en vez de amenazar", () => {
    const texto = api.taskShiftDeleteWarning(
        "RESONADOR",
        "night",
        api.taskAssignmentFootprint("task_a", ASIGNACIONES),
        api.taskAssignmentFootprint("task_a", ASIGNACIONES, "night")
    );

    assert.match(texto, /Quitarla de las tareas de noche no borra ninguna asignacion/);
});

test("sin asignaciones el aviso no amenaza con perder nada", () => {
    const texto = api.taskDeleteWarning("NUEVA", { names: 0, cells: 0, weeks: 0 });

    assert.match(texto, /no tiene asignaciones/);
    assert.doesNotMatch(texto, /se borran con ella/);
});

test("la X abre el dialogo con el nombre editable y las tres salidas", () => {
    // El cierre se busca A PARTIR del bloque: otros selectores del panel
    // aparecen ANTES en el archivo y daban un rango invertido (vacio).
    const desde = src.indexOf('querySelectorAll("[data-task-delete]")');
    const handler = src.slice(desde, src.indexOf('data-filter-group', desde));

    // Nombre editable, precargado con el actual.
    assert.match(handler, /inputLabel: "Nombre de la tarea"/);
    assert.match(handler, /value: task\.title/);
    // Renombrar es la accion principal; borrar, la de escape.
    assert.match(handler, /confirmText: "Renombrar"/);
    assert.match(handler, /text: enAmbos \? "Eliminar en ambos" : "Eliminar igual"/);
    assert.match(handler, /value: "delete",/);
    // Y la cifra viaja al aviso.
    assert.match(handler, /taskDeleteWarning\(task\.title, footprint\)/);
});

test("la tarea que va en los dos turnos ofrece quitarla de uno solo", () => {
    const desde = src.indexOf('querySelectorAll("[data-task-delete]")');
    const handler = src.slice(desde, src.indexOf('data-filter-group', desde));

    // La X se aprieta desde un tablero, y ese turno viaja en el boton.
    assert.match(handler, /dataset\.taskDeleteShift === "night"/);
    // La salida de en medio: la tarea sigue viva en el otro turno.
    assert.match(handler, /value: "delete-shift"/);
    assert.match(handler, /removeTaskFromShift\(taskId, shift\)/);
    // Y solo se ofrece si la tarea esta en los dos.
    assert.match(handler, /enAmbos\s*\n?\s*\? \[\{/);
});

test("renombrar al mismo nombre no publica nada", () => {
    // El cierre se busca A PARTIR del bloque: otros selectores del panel
    // aparecen ANTES en el archivo y daban un rango invertido (vacio).
    const desde = src.indexOf('querySelectorAll("[data-task-delete]")');
    const handler = src.slice(desde, src.indexOf('data-filter-group', desde));

    assert.match(handler, /nuevo === task\.title/);
});

test("el dialogo admite salidas ademas de aceptar y cancelar", () => {
    // Con extraActions el resultado pasa a ser un objeto { action, value }: sin
    // eso no se puede distinguir "borrar igual" de "renombrar".
    assert.match(dialogs, /extraActions = \[\]/);
    assert.match(dialogs, /finish\(\{ action, value: input \? input\.value : undefined \}\)/);
});

test("con tres salidas, el boton de aceptar NO se tine de rojo", () => {
    // La accion destructiva es una de las extra: si el tono del aviso tine
    // tambien el boton de aceptar, el camino seguro parece el peligroso.
    assert.match(
        dialogs,
        /destructive || (normalizedTone === "danger" && !hasExtras)/
    );
});

test("sin extraActions el dialogo sigue devolviendo lo de siempre", () => {
    // Los demas avisos de la app esperan booleano o texto: no se pueden romper.
    assert.match(dialogs, /if \(action === "cancel"\)/);
    assert.match(dialogs, /finish\(type === "prompt" \? input\.value : true\)/);
});
