import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Un catalogo de tareas vacio NO autoriza a borrar la programacion.
//
// El saneado semanal corre en CADA pintado del tablero, y tambien al publicar
// a la PWA (taskScheduleGrid -> getTaskScheduleWeek -> cleanAssignmentsForWeek,
// con una ventana de tres semanas). Trataba como huerfana toda casilla cuyo
// taskId no estuviera en el catalogo, asi que con el catalogo vacio -no bajo
// todavia de la nube, sesion recien abierta, o se perdio- borraba la semana
// entera y sincronizaba el vacio al resto de las sesiones. Paso en produccion
// el 2026-09-03 en la unidad Imagenologia.

const readSource = () => readFile(
    new URL("../js/taskAssignments.js", import.meta.url),
    "utf8"
);

test("sin catalogo, el saneado no toca ni guarda nada", async () => {
    const source = await readSource();

    // El guardia va ANTES de recorrer las casillas: si quedara despues, el
    // recorrido ya habria borrado.
    assert.match(
        source,
        /function cleanAssignmentsForWeek\([\s\S]{0,900}if \(!tasks\.length\) return assignments;/
    );

    // Acotado al cuerpo de la funcion: el mismo recorrido aparece antes en la
    // migracion de asignaciones, y un indexOf suelto encontraria ese.
    const body = source.slice(
        source.indexOf("function cleanAssignmentsForWeek(")
    );
    const guard = body.indexOf("if (!tasks.length) return assignments;");
    const loop = body.indexOf("Object.entries(assignments).forEach(([cellKey, entry]) => {");

    assert.ok(guard !== -1 && loop !== -1);
    assert.ok(guard < loop, "el guardia debe ir antes del recorrido de casillas");
});

test("una casilla sin tarea en el catalogo queda inerte, no se borra", async () => {
    const source = await readSource();

    // Con la sincronizacion por elemento el catalogo puede llegar a medias: la
    // tarea que falta no es necesariamente la que se elimino.
    assert.match(source, /if \(!taskIds\.has\(taskId\)\) return;/);
    assert.doesNotMatch(
        source,
        /if \(!taskIds\.has\(taskId\)\) \{\s*\n\s*delete assignments\[cellKey\];/
    );
});

test("quien borra una tarea de verdad sigue limpiando sus casillas", async () => {
    const source = await readSource();

    // El saneado ya no borra huerfanas, asi que deleteTask es el unico camino:
    // si esto se cayera, las casillas quedarian para siempre.
    //
    // La ventana es holgada a proposito: desde el 2026-09-10 deleteTask mide la
    // huella de la tarea ANTES de borrarla (para la bitacora), y con 600 el test
    // se caia por la distancia sin que cambiara nada de lo que protege.
    assert.match(
        source,
        /function deleteTask\(taskId\)[\s\S]{0,1200}delete all\[week\]\[cellKey\];/
    );
});
