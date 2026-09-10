import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// La fila "TURNO DE NOCHE" junta a quien esta de turno esa noche y no quedo en
// ninguna tarea. Vive SOLO en la programacion -el visor y la hoja impresa-, no
// en el tablero: al supervisor que reparte le estorba, pero quien lee la
// programacion necesita ver a todos los que estan citados.

const readSource = () => readFile(
    new URL("../js/taskAssignments.js", import.meta.url),
    "utf8"
);
const readStyles = () => readFile(
    new URL("../styles.css", import.meta.url),
    "utf8"
);

test("la fila no existe en el tablero", async () => {
    const source = await readSource();
    const styles = await readStyles();

    // Ni markup ni estilos en el panel: si reaparecieran, la fila volveria a
    // dibujarse donde el usuario pidio que NO estuviera.
    assert.doesNotMatch(source, /renderDutyRow/);
    assert.doesNotMatch(source, /renderDutyChip/);
    assert.doesNotMatch(source, /task-assignment-duty/);
    assert.doesNotMatch(styles, /task-assignment-duty/);
    assert.doesNotMatch(styles, /task-assignment-worker-chip--duty/);
});

test("la fila se agrega al armar la programacion", async () => {
    const source = await readSource();

    assert.match(source, /dutyLabel: "TURNO DE NOCHE"/);

    // El cuerpo de getTaskScheduleWeek, acotado por la funcion exportada que
    // sigue. Antes esto se medida en caracteres desde el nombre de la funcion
    // ("los primeros 4000"), y cualquier linea que se agregara dentro dejaba la
    // fila fuera de la ventana: la prueba fallaba sin que nada se hubiera roto.
    const desde = source.indexOf("export function getTaskScheduleWeek");
    const hasta = source.indexOf("export function", desde + 20);

    assert.ok(desde !== -1 && hasta !== -1);
    assert.match(
        source.slice(desde, hasta),
        /section\.rows\.unshift\(\{\s*\n\s*taskId: `duty_\$\{section\.shift\}`,\s*\n\s*title: dutyLabel,/
    );
});

test("y va ARRIBA de las tareas del turno", async () => {
    const source = await readSource();

    // Primero quienes estan citados esa noche y despues como se reparten. Al
    // reves -las tareas y al final la lista de todos- se lee peor, y ademas
    // dejaba a AUX TURNO encima de TURNO DE NOCHE.
    assert.match(source, /section\.rows\.unshift\(\{/);
    assert.doesNotMatch(source, /section\.rows\.push\(\{\s*\n\s*taskId: `duty_/);
});

test("solo la noche declara la fila", async () => {
    const source = await readSource();

    assert.match(source, /const dutyLabel = SHIFT_CONFIG\[section\.shift\]\.dutyLabel;\s*\n\s*\n\s*if \(!dutyLabel\) return;/);
    assert.doesNotMatch(
        source,
        /label: "Tareas diurnas",[\s\S]{0,160}dutyLabel/
    );
});

test("junta a los de turno que no estan en ninguna tarea", async () => {
    const source = await readSource();

    assert.match(source, /function unassignedOnShift\(shift, keyDay, tasks, assignments\)/);
    assert.match(source, /\.filter\(profile => !assigned\.has\(profile\.name\)\)/);
    // De turno de verdad: citado ese dia y sin permiso que lo bloquee.
    assert.match(
        source,
        /\.filter\(profile => isAvailableForShift\(profile, keyDay, shift\)\)/
    );
});

test("los nombres van en el mismo formato que el resto de la programacion", async () => {
    const source = await readSource();

    assert.match(
        source,
        /\.map\(profile => shortWorkerName\(profile\.name, \{ compact: true \}\)\)/
    );
});

test("se agrega despues de las filas reales, fuera de la fusion de casillas", async () => {
    const source = await readSource();

    // Va primera en la lista, pero se AGREGA al final, cuando las filas reales
    // ya estan armadas: si entrara antes, la fusion de casillas la tomaria por
    // una tarea y le calcularia rowspans que no le corresponden. La fusion
    // busca por id, asi que colarla al principio no le corre los indices.
    const insert = source.indexOf("section.rows.unshift({");
    const merge = source.indexOf("columnGroups(assignments, section.shift, tasks, keyFromDate(day))");

    assert.ok(insert !== -1 && merge !== -1);
    assert.ok(insert < merge, "la fila debe agregarse antes del calculo de rowspan");
});

test("si nadie queda suelto, la fila no aparece", async () => {
    const source = await readSource();

    assert.match(source, /if \(!cells\.some\(cell => cell\.workers\.length\)\) return;/);
});
