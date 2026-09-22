import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Lo que el trabajador abre en "Programación" es la asignacion de tareas del
// supervisor, no el Excel. Viaja en el documento COMPARTIDO del workspace, que
// ya se publica de forma diferida.

const readSync = () => readFile(
    new URL("../js/workerAppDataSync.js", import.meta.url),
    "utf8"
);
const readTasks = () => readFile(
    new URL("../js/taskAssignments.js", import.meta.url),
    "utf8"
);

/**
 * El cuerpo de una funcion del fuente.
 *
 * Antes esto se comprobaba con una ventana de N caracteres desde el nombre de
 * la funcion. Eso ata el test al LARGO del codigo: al agregarle a
 * publishSharedScheduleNow la deteccion de cambios, el setDoc quedo mas lejos y
 * el test fallo sin que cambiara nada de lo que vigila. Y en la asercion
 * negativa era peor: si la ventana crece hasta la funcion siguiente, el test
 * falla por un `merge: true` que no es el suyo.
 */
function cuerpoDe(fuente, nombre) {
    const start = fuente.indexOf("async function " + nombre + "(");

    assert.notEqual(start, -1, "no se encontro: " + nombre);

    const open = fuente.indexOf("{", fuente.indexOf(")", start));
    let depth = 0;
    let end = open;

    for (; end < fuente.length; end += 1) {
        if (fuente[end] === "{") depth += 1;
        else if (fuente[end] === "}") {
            depth -= 1;

            if (!depth) break;
        }
    }

    return fuente.slice(start, end + 1);
}

test("la grilla de tareas se suma a lo que se publica", async () => {
    const sync = await readSync();

    assert.match(sync, /function taskScheduleAttachments\(\)/);
    assert.match(
        sync,
        /taskScheduleAttachments\(\)\.forEach\(entry => \{\s*\n\s*attachments\[entry\.weekStartISO\] = entry;/
    );
});

test("no queda ningun adjunto de Excel al que caer", async () => {
    const sync = await readSync();

    // Adjuntar Excel se elimino: si volviera a mezclarse un adjunto aca, el
    // trabajador podria terminar viendo una programacion que no es la del
    // tablero.
    assert.doesNotMatch(sync, /weekly_task_schedule_attachment/);
    assert.doesNotMatch(sync, /attachments\[legacy\.weekStartISO\]/);
    assert.match(
        sync,
        /function getPublishedScheduleAttachments\(\) \{[\s\S]{0,400}taskScheduleAttachments\(\)\.forEach/
    );
});

test("se publica una ventana acotada de semanas", async () => {
    const sync = await readSync();

    // El documento se escribe entero en cada publicacion: publicar todas las
    // semanas de la historia lo haria crecer sin techo.
    assert.match(sync, /const TASK_SCHEDULE_PUBLISHED_WEEKS = \[-1, 0, 1\];/);
});

test("el proveedor se registra en vez de importarse, para no cerrar un ciclo", async () => {
    const sync = await readSync();
    const tasks = await readTasks();

    // `taskAssignments` YA importa `workerAppDataSync`: importarlo de vuelta
    // cerraria un ciclo de imports.
    assert.match(sync, /export function registerTaskScheduleGridProvider\(provider\)/);
    assert.doesNotMatch(sync, /from "\.\/taskAssignments\.js"/);
    assert.match(tasks, /registerTaskScheduleGridProvider\(taskScheduleGrid\);/);
});

test("si la grilla falla, la publicacion no se cae", async () => {
    const sync = await readSync();

    // Publicar es lo que mantiene al dia el telefono del trabajador: un error
    // armando una semana no puede tumbar el resto del payload.
    assert.match(
        sync,
        /try \{\s*\n\s*grid = taskScheduleGridProvider\(start\);\s*\n\s*\} catch \(error\) \{/
    );
});

test("la publicacion sigue siendo diferida y agrupada", async () => {
    const tasks = await readTasks();
    const sync = await readSync();

    // Los cambios manuales reprograman el mismo temporizador, asi que una
    // tanda de ediciones sale en UNA publicacion.
    assert.match(tasks, /const TASK_ASSIGNMENT_PUBLISH_DELAY_MS = 3000;/);
    assert.match(
        sync,
        /clearTimeout\(hotPublishTimer\);\s*\n\s*hotPublishTimer = setTimeout\(\(\) => publishHotNow\(\), delay\);/
    );
});

test("la programacion automatica se publica solo al aceptar la propuesta", async () => {
    const tasks = await readTasks();
    const applyStart = tasks.indexOf("function applyTaskAutoSchedulePlan");
    const applyEnd = tasks.indexOf(
        "function openTaskAutoSchedulePreviewDialog",
        applyStart
    );
    const applySource = tasks.slice(applyStart, applyEnd);

    assert.match(tasks, /openTaskAutoSchedulePreviewDialog/);
    assert.match(tasks, /data-auto-schedule-regenerate/);
    assert.match(tasks, /data-auto-schedule-publish/);
    assert.ok(applyStart >= 0 && applyEnd > applyStart);
    assert.match(applySource, /saveWeekAssignments\(next\);/);
    assert.match(applySource, /publishTaskAssignmentChanges/);
    assert.doesNotMatch(tasks, /showConfirm\(autoSchedulePlanSummary/);
});

test("el documento compartido se reemplaza, no se fusiona", async () => {
    const sync = await readSync();

    // `setDoc(..., { merge: true })` fusiona los mapas en PROFUNDIDAD: las
    // semanas viejas del mapa se quedaban pegadas para siempre, y tras quitar
    // el Excel seguian apareciendo en el telefono las programaciones anteriores
    // en imagen. Reemplazar el documento es lo unico que las saca.
    const cuerpo = cuerpoDe(sync, "publishSharedScheduleNow");

    // Que el cuerpo traiga el setDoc es ademas la garantia de que el corte no
    // salio vacio: sin esto, el doesNotMatch de abajo pasaria en falso.
    assert.match(cuerpo, /"published",\s*\n\s*"schedule"/);
    assert.doesNotMatch(cuerpo, /merge:\s*true/);
});

test("la programacion se republica al arrancar y en cada publicacion", async () => {
    const sync = await readSync();

    // Sin la del arranque, un workspace con el documento en el formato anterior
    // se quedaria mostrando lo viejo hasta que alguien editara el tablero.
    assert.match(sync, /void publishSharedScheduleNow\(\);/);
    assert.match(
        sync,
        /if \(initial\) \{[\s\S]*?void publishSharedScheduleNow\(\);[\s\S]*?return;/
    );
});
