// Calendario organizativo de tareas: se abre al hacer click en la fecha del
// encabezado del inicio ("Hoy es ...") y muestra, dia por dia, las tareas que
// anoto el supervisor. En una casilla no caben todas, asi que las que sobran se
// resumen en "+N mas" y el dia se abre en un segundo modal con el listado
// completo.
//
// Lo importante que se fija aca: el calendario usa la MISMA regla de
// recurrencia que dispara las alertas sonoras (isTaskActiveOn). Si se
// duplicara, el calendario mostraria una tarea un dia y el aviso sonaria otro.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) { this.values.set(key, String(value)); }
}

const noopEl = {
    addEventListener() {}, removeEventListener() {}, appendChild() {},
    setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} },
    click() {}, remove() {}, dataset: {}
};

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost" }
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    visibilityState: "hidden", hidden: true,
    body: noopEl, documentElement: noopEl,
    createElement: () => ({ ...noopEl }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
};
globalThis.alert = () => {};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const {
    buildRequestSummary,
    buildTaskCalendarCells,
    getTaskCalendarItemsForDay,
    getTasksForDay
} =
    await import("../js/home.js");
const { medicalEquipmentCalendarEventsForRange } =
    await import("../js/medicalEquipment.js");
const { applyDoneMap, isTaskActiveOn, isTaskDoneOn, toggleTaskDoneOn } =
    await import("../js/homeTasks.js");

const home = (await readFile(new URL("../js/home.js", import.meta.url), "utf8"))
    .replace(/\r\n/g, "\n");
const homeTasks = (await readFile(
    new URL("../js/homeTasks.js", import.meta.url), "utf8"
)).replace(/\r\n/g, "\n");
const persistence = (await readFile(
    new URL("../js/persistence.js", import.meta.url), "utf8"
)).replace(/\r\n/g, "\n");
const css = (await readFile(
    new URL("../styles.css", import.meta.url), "utf8"
)).replace(/\r\n/g, "\n");

// Agosto de 2026: el dia 1 cae sabado.
const ANIO = 2026;
const MES = 7;

const tarea = (extra) => ({
    id: extra.id || "x",
    name: extra.name || "Tarea",
    time: extra.time || "08:00",
    repeat: extra.repeat || "Diario",
    date: extra.date || "",
    alert: "Sin alerta",
    doneDate: extra.doneDate || "",
    ...extra
});

function celda(cells, dia) {
    return cells.find(cell => cell && cell.day === dia);
}

test("la fecha del encabezado abre el calendario", () => {
    assert.match(home, /class="hm-date" data-hm="open-taskcal" role="button" tabindex="0"/);
    // Y tambien con el teclado, no solo con el mouse.
    assert.match(home, /trigger\.addEventListener\("keydown"/);
});

test("la tarjeta de tareas diarias muestra SOLO las de hoy", () => {
    // Una tarea programada para el 27 no puede aparecer en el resumen del 20.
    // El bug era que la tarjeta listaba getHomeTasks() sin mirar la fecha.
    assert.match(home, /const tasks = getTasksForDay\(new Date\(\)\);/);
    assert.doesNotMatch(
        home,
        /function tasksListHTML\(\) \{[\s\S]{0,200}getHomeTasks\(\)/
    );
});

test("una tarea futura se ve en el calendario, no en la tarjeta", () => {
    // El 20 de agosto no la muestra; el 27, si.
    const task = tarea({
        id: "futura", repeat: "Una sola vez", date: "2026-08-27"
    });

    assert.equal(getTasksForDay(new Date(ANIO, MES, 20), [task]).length, 0);
    assert.equal(getTasksForDay(new Date(ANIO, MES, 27), [task]).length, 1);

    const cells = buildTaskCalendarCells(ANIO, MES, [task]);

    assert.equal(celda(cells, 20).tasks.length, 0);
    assert.deepEqual(celda(cells, 27).tasks.map(item => item.id), ["futura"]);
});

test("una tarea sin fecha de inicio no desaparece", () => {
    // Sin fecha no hay donde anclarla. Descartarla la sacaria de la tarjeta, del
    // calendario y de las alertas a la vez, sin dejar rastro para el usuario.
    const sinFecha = tarea({ id: "vieja", repeat: "Semanal", date: "" });

    assert.equal(isTaskActiveOn(sinFecha, new Date(ANIO, MES, 20)), true);
    assert.equal(getTasksForDay(new Date(ANIO, MES, 20), [sinFecha]).length, 1);
});

test("los accesos inferiores del inicio no se muestran", () => {
    assert.doesNotMatch(home, /Ver todas las tareas/);
    assert.doesNotMatch(home, /Ver todas las ausencias/);
    assert.doesNotMatch(home, /Ver calendario/);
    assert.doesNotMatch(home, /Ver todos los cambios/);
    assert.doesNotMatch(home, /Ir a cobertura de turnos/);
    assert.doesNotMatch(home, /tareas pendientes/);
    assert.doesNotMatch(home, /statCard\("amber", IC\.clipboard, "Pendientes"/);
    assert.doesNotMatch(home, /row\("warn", "Pendientes"/);
    assert.match(home, /Personal de d[ií]a/);
    assert.match(home, /Personal de noche/);
    assert.match(home, /dotacion\.dia/);
    assert.match(home, /dotacion\.noche/);
    assert.doesNotMatch(home, /hm-highlight/);
    assert.doesNotMatch(home, /Organizaci[oó]n hoy/);
    // La fecha del encabezado sigue siendo la puerta al calendario de tareas.
    assert.match(home, /panel\.querySelectorAll\('\[data-hm="open-taskcal"\]'\)/);
});

test("las ausencias del dia abren detalle y permiten verlas en calendario", () => {
    assert.match(home, /data-hm="absence-list"/);
    assert.match(home, /data-hm="absence-summary" data-absence-cat=/);
    assert.match(home, /data-hm="absence-modal"/);
    assert.match(home, /data-hm="absence-ver"/);
    assert.match(home, /VER EN CALENDARIO/);
    assert.match(home, /openAbsenceDetail\(panel, row\.dataset\.absenceCat\)/);
    assert.match(home, /profile: button\.dataset\.absenceProfile/);
    assert.match(home, /date: button\.dataset\.absenceIso/);
});

test("el inicio resume solicitudes pendientes por categoria", () => {
    const summary = buildRequestSummary([
        { id: "vac", status: "pending", type: "legal", profile: "Ana", date: "2026-08-22" },
        { id: "adm", status: "accepted", type: "admin", profile: "Beto", date: "2026-08-22" },
        { id: "swap", status: "pending", type: "swap", profile: "Carla", date: "2026-08-23" },
        { id: "clock", status: "pending", type: "clock_incident", profile: "Dani", date: "2026-08-24" },
        { id: "other", status: "pending", type: "hhee_return", profile: "Ema", date: "2026-08-25" }
    ]);

    assert.equal(summary.leave.length, 1);
    assert.equal(summary.swap.length, 1);
    assert.equal(summary.clock.length, 1);
    assert.equal(summary.total, 3);
    assert.match(home, /Resumen de solicitudes/);
    assert.match(home, /data-hm="req-detail"/);
    assert.match(home, /data-hm="req-open"/);
    assert.match(home, /data-hm="req-accept"/);
    assert.match(home, /data-hm="req-reject"/);
    assert.match(home, /acceptWorkerRequestById\(requestId\)/);
    assert.match(home, /rejectWorkerRequestById\(requestId\)/);
    assert.doesNotMatch(home, /hm-req-note/);
});

test("los cambios de turno del inicio abren detalle y se anulan con la logica del calendario", () => {
    assert.match(home, /data-hm="swap-detail"/);
    assert.match(home, /openHomeSwapDetailDialog\(swap\)/);
    assert.match(home, /Anular cambio/);
    assert.match(home, /deshacerCambioTurno\(targetSwap\)/);
    assert.match(home, /window\.pushUndoState\("Deshacer cambio de turno"\)/);
    assert.match(home, /const profiles = \[targetSwap\.from, targetSwap\.to\]/);
    assert.match(home, /dates\.map\(date => updateDayCell\(profile, date\)\)/);
    assert.doesNotMatch(home, /Â·/);
});

test("el dia 1 cae en su columna, con la semana en lunes", () => {
    const cells = buildTaskCalendarCells(ANIO, MES, []);

    // 1 de agosto de 2026 es sabado: sexta columna con la semana en lunes,
    // o sea 5 casillas en blanco antes.
    assert.equal(cells.filter(cell => cell === null).length, 5);
    assert.equal(cells[5].day, 1);
    // Agosto tiene 31 dias.
    assert.equal(cells.filter(Boolean).length, 31);
    assert.equal(cells.at(-1).day, 31);
});

test("cada recurrencia cae donde corresponde", () => {
    const tasks = [
        tarea({ id: "d", name: "Diaria", repeat: "Diario", date: "2026-08-01" }),
        // 2026-08-05 es miercoles.
        tarea({ id: "s", name: "Semanal", repeat: "Semanal", date: "2026-08-05" }),
        tarea({ id: "m", name: "Mensual", repeat: "Mensual", date: "2026-08-12" }),
        tarea({ id: "u", name: "Una vez", repeat: "Una sola vez", date: "2026-08-20" })
    ];
    const cells = buildTaskCalendarCells(ANIO, MES, tasks);
    const ids = dia => celda(cells, dia).tasks.map(task => task.id);

    // La diaria esta todos los dias desde su inicio.
    assert.ok(ids(1).includes("d"));
    assert.ok(ids(31).includes("d"));
    // La semanal, solo los miercoles.
    assert.deepEqual(
        cells.filter(Boolean)
            .filter(cell => cell.tasks.some(task => task.id === "s"))
            .map(cell => cell.day),
        [5, 12, 19, 26]
    );
    // La mensual, solo el 12.
    assert.ok(ids(12).includes("m"));
    assert.ok(!ids(13).includes("m"));
    // La de una sola vez, solo el 20.
    assert.deepEqual(ids(20).filter(id => id === "u"), ["u"]);
    assert.ok(!ids(21).includes("u"));
});

test("una tarea no aparece antes de su fecha de inicio", () => {
    const tasks = [tarea({ id: "d", repeat: "Diario", date: "2026-08-15" })];
    const cells = buildTaskCalendarCells(ANIO, MES, tasks);

    assert.equal(celda(cells, 14).tasks.length, 0);
    assert.equal(celda(cells, 15).tasks.length, 1);
});

test("las tareas del dia salen ordenadas por hora", () => {
    const tasks = [
        tarea({ id: "tarde", time: "18:00", repeat: "Diario" }),
        tarea({ id: "manana", time: "07:30", repeat: "Diario" }),
        tarea({ id: "medio", time: "12:00", repeat: "Diario" })
    ];

    assert.deepEqual(
        getTasksForDay(new Date(ANIO, MES, 10), tasks).map(task => task.id),
        ["manana", "medio", "tarde"]
    );
});

test("es la misma regla que la de las alertas sonoras", () => {
    // No una copia: si se duplicara, el calendario y el aviso se irian
    // separando con cada cambio de recurrencia.
    const task = tarea({ repeat: "Semanal", date: "2026-08-05" });
    const miercoles = new Date(ANIO, MES, 12);
    const jueves = new Date(ANIO, MES, 13);

    assert.equal(isTaskActiveOn(task, miercoles), true);
    assert.equal(getTasksForDay(miercoles, [task]).length, 1);
    assert.equal(isTaskActiveOn(task, jueves), false);
    assert.equal(getTasksForDay(jueves, [task]).length, 0);
});

test("lo que no cabe en la casilla se resume en +N mas", () => {
    // El limite por casilla y el resumen tienen que ser coherentes: el texto
    // "+N mas" cuenta exactamente lo que no se pinto.
    assert.match(home, /const TASKS_PER_CELL = 3;/);
    assert.match(home, /const extra = cell\.tasks\.length - TASKS_PER_CELL;/);
    assert.match(home, /slice\(0, TASKS_PER_CELL\)/);
    assert.match(home, /\$\{extra\} más/);
});

test("se puede abrir cualquier dia para agregar tareas", () => {
    // Un dia vacio tambien sirve: desde su listado se agrega una tarea nueva.
    assert.match(home, /const clickable = true;/);
    assert.match(home, /data-hm="taskcal-day" data-iso=/);
    assert.match(home, /const cell = event\.target\.closest\('\[data-hm="taskcal-day"\]'\);/);
});

test("el listado del dia se abre encima del calendario", () => {
    // Cerrar el listado deja el calendario abierto detras, no vuelve al inicio.
    assert.match(home, /hm-modal-backdrop--over" data-hm="dayTasks-modal"/);
    assert.match(
        home,
        /dayTasks\.addEventListener\("click"[\s\S]{0,220}dayTasks\.hidden = true;/
    );
});

test("el calendario se mueve de mes y siempre abre en el actual", () => {
    assert.match(home, /data-hm="tc-prev"/);
    assert.match(home, /data-hm="tc-next"/);
    // Entrar por "Hoy es ..." tiene que llevar al mes de hoy, no a donde quedo
    // la vez anterior.
    assert.match(
        home,
        /const openCalendar = \(\) => \{[\s\S]{0,320}taskCalYear = now\.getFullYear\(\);/
    );
});

/* =========================================================
   Periodicidad "Diario Hábil"
========================================================= */

// isBusinessDay indexa los feriados como "año-mes(0)-dia".
// El 21 de agosto de 2026 es viernes: aca se marca como feriado a proposito,
// para separar "no es habil por feriado" de "no es habil por fin de semana".
const FERIADOS = { "2026-7-21": "Feriado de prueba" };

test("Diario Hábil salta fines de semana y feriados", () => {
    const task = tarea({ repeat: "Diario Hábil", date: "2026-08-01" });
    const activo = dia => isTaskActiveOn(task, new Date(ANIO, MES, dia), FERIADOS);

    assert.equal(activo(20), true, "jueves habil");
    assert.equal(activo(21), false, "viernes feriado");
    assert.equal(activo(22), false, "sabado");
    assert.equal(activo(23), false, "domingo");
    assert.equal(activo(24), true, "lunes habil");
});

test("Diario Hábil cae solo en los habiles del mes", () => {
    const task = tarea({ id: "habil", repeat: "Diario Hábil", date: "2026-08-01" });
    const cells = buildTaskCalendarCells(ANIO, MES, [task], FERIADOS);
    const conTarea = cells.filter(Boolean)
        .filter(cell => cell.tasks.length)
        .map(cell => cell.day);

    // Agosto 2026 tiene 31 dias y empieza sabado: 10 de fin de semana y 21
    // habiles, menos el feriado del 21 = 20.
    assert.equal(conTarea.length, 20);
    assert.ok(!conTarea.includes(21), "el feriado queda fuera");
    assert.ok(!conTarea.includes(1), "el sabado 1 queda fuera");
    assert.ok(conTarea.includes(3), "el lunes 3 entra");
});

test("Diario Hábil es distinto de Diario", () => {
    // Si fueran lo mismo, la opcion nueva no serviria de nada.
    const habil = tarea({ repeat: "Diario Hábil", date: "2026-08-01" });
    const diario = tarea({ repeat: "Diario", date: "2026-08-01" });
    const sabado = new Date(ANIO, MES, 22);

    assert.equal(isTaskActiveOn(habil, sabado, FERIADOS), false);
    assert.equal(isTaskActiveOn(diario, sabado, FERIADOS), true);
});

test("la periodicidad nueva esta en el formulario", () => {
    assert.match(home, /"Diario Hábil"/);
    // Los dos formularios (agregar y modificar) salen de la misma lista, para
    // que no se pueda elegir en uno y no en el otro.
    assert.match(home, /data-hm="nt-repeat">\$\{optionsHTML\(REPEAT_OPTS, "Diario"\)\}/);
    assert.match(home, /data-hm="et-repeat">\$\{optionsHTML\(REPEAT_OPTS, "Diario"\)\}/);
});

/* =========================================================
   Visto de realizada, por dia
========================================================= */

test("marcar un dia no borra el visto de otro", () => {
    // Con una sola fecha de visto, cerrar el 27 borraba el del 26: en una tarea
    // que se repite, el calendario mostraria un solo dia hecho.
    let task = tarea({ repeat: "Diario", date: "2026-08-01" });

    task = toggleTaskDoneOn(task, "2026-08-26");
    task = toggleTaskDoneOn(task, "2026-08-27");

    assert.equal(isTaskDoneOn(task, "2026-08-26"), true);
    assert.equal(isTaskDoneOn(task, "2026-08-27"), true);
    assert.equal(isTaskDoneOn(task, "2026-08-28"), false);
});

test("volver a marcar el mismo dia lo desmarca", () => {
    let task = toggleTaskDoneOn(tarea({}), "2026-08-27");

    assert.equal(isTaskDoneOn(task, "2026-08-27"), true);

    task = toggleTaskDoneOn(task, "2026-08-27");

    assert.equal(isTaskDoneOn(task, "2026-08-27"), false);
});

test("el visto viejo de una sola fecha no se pierde", () => {
    // Las tareas guardadas antes traen doneDate (una fecha), no doneDates.
    const antigua = { id: "v", name: "Vieja", time: "08:00", repeat: "Diario", doneDate: "2026-08-26" };
    const migrada = toggleTaskDoneOn(antigua, "2026-08-27");

    assert.equal(isTaskDoneOn(migrada, "2026-08-26"), true);
    assert.equal(isTaskDoneOn(migrada, "2026-08-27"), true);
});

test("desde el calendario el visto se marca contra el dia abierto", () => {
    // No contra hoy: se cierra el 27 estando parado en el 20.
    assert.match(home, /toggleTaskDone\(toggle\.dataset\.id, openDayIso\)/);
    // Y en la tarjeta del inicio, contra hoy.
    assert.match(home, /toggleTaskDone\(toggle\.dataset\.id, todayISO\(\)\)/);
    // Ninguna de las dos superficies guarda la lista completa para marcar: eso
    // era lo que borraba el visto.
    assert.doesNotMatch(home, /toggleTaskDoneOn\(tasks\[index\]/);
});

test("desde el calendario se puede modificar la tarea", () => {
    // La misma via que la tarjeta del inicio: openTaskEdit.
    assert.match(home, /data-hm="dt-row" data-id=/);
    assert.match(home, /const editFromDay = id => \{[\s\S]{0,40}openTaskEdit\(panel, id\);/);
    // Y el modal de modificar tiene que quedar POR ENCIMA del listado del dia.
    assert.match(home, /hm-modal-backdrop--top" data-hm="task-edit-modal"/);
});

test("desde el calendario se puede agregar una tarea en el dia abierto", () => {
    // El signo + del listado abre el mismo modal de alta que la tarjeta diaria,
    // pero dejando precargada la fecha seleccionada en el calendario.
    assert.match(home, /data-hm="dt-add"/);
    assert.match(home, /openTaskAdd\(panel, openDayIso, \{ top: true \}\)/);
    assert.match(home, /modal\.querySelector\('\[data-hm="nt-date"\]'\)\.value = date \|\| todayISO\(\);/);
});

test("el calendario integra mantenimientos y vencimientos de equipos medicos", () => {
    const equipment = [{
        id: "rx-1",
        name: "Arco C",
        code: "AC-22",
        location: "Box 1",
        serviceActive: true,
        serviceProvider: "Servicio Tecnico",
        serviceUntil: "2026-09-20",
        nextMaintenanceAt: "2026-09-15",
        maintenances: [{
            id: "mant-1",
            type: "preventive",
            date: "2026-09-10",
            startAt: "2026-09-10T09:00",
            endAt: "2026-09-11T12:00",
            provider: "Servicio Tecnico",
            summary: "Preventivo",
            taskIds: []
        }]
    }];
    const events = medicalEquipmentCalendarEventsForRange(
        "2026-09-01",
        "2026-09-30",
        equipment
    );
    const cells = buildTaskCalendarCells(2026, 8, [], {}, events);

    assert.deepEqual(
        events.map(event => `${event.kind}:${event.date}`),
        [
            "maintenance:2026-09-10",
            "maintenance:2026-09-11",
            "nextMaintenance:2026-09-15",
            "serviceUntil:2026-09-20"
        ]
    );
    assert.equal(celda(cells, 10).tasks[0].source, "medicalEquipment");
    assert.equal(celda(cells, 15).tasks[0].name, "Próximo mantenimiento · Arco C");
    assert.equal(celda(cells, 20).tasks[0].name, "Vence servicio técnico · Arco C");
});

test("los eventos de equipos quedan visibles solo con ver y editar el menu", () => {
    assert.match(home, /canViewMenu\("medicalEquipment"\) && canEditMenu\("medicalEquipment"\)/);
    assert.match(home, /medicalEquipmentCalendarEventsForRange\(first, last\)/);
    assert.match(home, /medicalEquipmentCalendarEventsForRange\(iso, iso\)/);
    assert.match(home, /data-hm="dt-medeq-row"/);
    assert.match(home, /selectMedicalEquipment\(id\)/);
    assert.match(home, /proturnos:medicalEquipmentChanged/);
    assert.match(home, /MEDICAL_EQUIPMENT_KEY/);
});

test("las tareas y los eventos de equipos se ordenan juntos por hora", () => {
    const task = tarea({
        id: "tarde",
        name: "Tarea tarde",
        time: "18:00",
        repeat: "Una sola vez",
        date: "2026-09-10"
    });
    const events = medicalEquipmentCalendarEventsForRange(
        "2026-09-10",
        "2026-09-10",
        [{
            id: "eco-1",
            name: "Ecografo",
            maintenances: [{
                id: "mant-1",
                type: "corrective",
                date: "2026-09-10",
                startAt: "2026-09-10T08:00",
                endAt: "2026-09-10T09:00"
            }]
        }]
    );

    assert.deepEqual(
        getTaskCalendarItemsForDay(
            new Date(2026, 8, 10),
            [task],
            {},
            events
        ).map(item => item.source || item.id),
        ["medicalEquipment", "tarde"]
    );
});

test("modificar una tarea repinta las tres superficies", () => {
    // Tarjeta del dia, grilla del mes y listado del dia abierto muestran el
    // mismo dato: si solo se repintara una, las otras quedarian mintiendo.
    assert.match(
        home,
        /const refreshTasks = \(\) => \{[\s\S]{0,400}tasksListHTML\(\);[\s\S]{0,120}reRenderTaskCalendar\(panel\);[\s\S]{0,60}renderDayTasks\(panel\);/
    );
});

/* =========================================================
   El visto se guarda aparte de la lista
   ---------------------------------------------------------
   Bug: el supervisor marcaba una tarea diaria y horas despues volvia a
   aparecer sin hacer. El visto vivia DENTRO de la tarea, asi que se guardaba
   reescribiendo la lista entera; cualquier guardado hecho desde una copia
   vieja (la del arranque, antes de la primera respuesta del servidor, o la de
   otra pestaña) devolvia la lista sin el visto.
========================================================= */

test("el visto guardado aparte manda sobre la lista", () => {
    // La lista que llego es una copia VIEJA, sin el visto; homeTaskDone si lo
    // tiene. La tarea tiene que seguir marcada.
    const [tarea] = applyDoneMap(
        [{ id: "t1", name: "la del 20", time: "18:00", doneDates: [] }],
        { t1: ["2026-08-24"] }
    );

    assert.equal(isTaskDoneOn(tarea, "2026-08-24"), true);
});

test("una tarea sin visto aparte conserva el que traia adentro", () => {
    // Formato viejo: nunca se marco desde esta version, el visto vive dentro de
    // la tarea y no se puede perder al separarlo.
    const [tarea] = applyDoneMap(
        [{ id: "t1", name: "vieja", doneDate: "2026-08-20" }],
        {}
    );

    assert.equal(isTaskDoneOn(tarea, "2026-08-20"), true);
});

test("desmarcar gana aunque la lista siga trayendo el visto viejo", () => {
    const [tarea] = applyDoneMap(
        [{ id: "t1", name: "la del 20", doneDates: ["2026-08-24"] }],
        { t1: [] }
    );

    assert.equal(isTaskDoneOn(tarea, "2026-08-24"), false);
});

test("marcar el visto escribe solo ese dia de esa tarea", () => {
    // Con arrayUnion/arrayRemove dos pestañas no se pisan y ningun guardado de
    // la lista completa puede borrar un visto ya marcado.
    assert.match(homeTasks, /homeTaskDone: \{ \[id\]: value \}/);
    assert.match(homeTasks, /firestoreModule\.arrayUnion\(day\)/);
    assert.match(homeTasks, /firestoreModule\.arrayRemove\(day\)/);
});

test("marcar el visto no reescribe la lista completa", () => {
    // Era el nudo del bug: para poner un visto se subia el arreglo entero, asi
    // que una copia vieja se llevaba puestos los vistos que ya estaban.
    assert.match(
        homeTasks,
        /export async function toggleTaskDone\([\s\S]{0,1800}homeTaskDone: \{ \[id\]: value \}/
    );
    assert.doesNotMatch(
        homeTasks,
        /export async function toggleTaskDone\([\s\S]{0,2200}homeTasks: cache/
    );
});

test("la lista completa no se sube antes de la primera respuesta del servidor", () => {
    // Al abrir la app la copia local puede venir vieja o vaciada: subirla sin
    // esperar al servidor era la via por la que el visto volvia atras.
    assert.match(
        homeTasks,
        /export async function saveHomeTasks\([\s\S]{0,1200}await whenHydrated\(\);/
    );
    // Y la espera va ANTES de la unica escritura al documento del usuario.
    assert.match(
        homeTasks,
        /await whenHydrated\(\);[\s\S]{0,1400}firestoreModule\.setDoc\(ref, payload/
    );
});

test("guardar la lista no borra tareas que solo conoce el servidor", () => {
    // Una tarea solo desaparece si se pidio borrarla.
    assert.match(homeTasks, /const rescued = remoteTasks\.filter\(/);
    assert.match(homeTasks, /export async function deleteHomeTask\(taskId\)/);
    assert.match(home, /void deleteHomeTask\(editingTaskId\);/);
});

test("si la sincronizacion se cae, se vuelve a enganchar", () => {
    // Con el listener muerto la copia local se congela y el siguiente guardado
    // subiria datos viejos.
    assert.match(homeTasks, /scheduleResubscribe\(\);/);
    assert.match(homeTasks, /retryTimer = setTimeout\(/);
});

test("un visto que no se pudo guardar no queda marcado en pantalla", () => {
    // Si la escritura falla y la pantalla lo deja marcado, el supervisor lo da
    // por hecho y lo encuentra sin marcar mas tarde: es el mismo sintoma.
    assert.match(homeTasks, /const revertedMap = \{ \.\.\.doneMap \};/);
    assert.match(homeTasks, /revertedMap\[id\] = previousDates;/);
    assert.match(homeTasks, /applyLocal\(ownTasks, revertedMap\);/);
    assert.match(homeTasks, /showTasksIssue\("No se pudo guardar el visto/);
});

test("las tareas privadas no viajan por el estado compartido de la unidad", () => {
    // Son de UN usuario: en el estado compartido las verian los demas
    // supervisores y replaceLocalSnapshot podria borrarlas o devolverlas a una
    // version vieja. (Las COMPARTIDAS si viajan, pero por otra clave: ver
    // tests/inicio-tareas-compartidas.test.mjs.)
    assert.match(persistence, /"homeTasks_",/);
    assert.match(persistence, /"homeTasksDone_",/);
});

/* =========================================================
   Dias inhabiles y tamaño del calendario
========================================================= */

test("el calendario de tareas marca los dias inhabiles", () => {
    // Fin de semana y feriado: los dos son inhabiles y se pintan igual, en rojo
    // suave, como en el mini calendario del inicio.
    const cells = buildTaskCalendarCells(ANIO, MES, [], FERIADOS, []);
    const inhabil = dia => {
        const cell = celda(cells, dia);
        return cell.isWeekend || Boolean(cell.holiday);
    };

    assert.equal(inhabil(20), false, "jueves habil");
    assert.equal(inhabil(21), true, "viernes feriado");
    assert.equal(celda(cells, 21).holiday, "Feriado de prueba");
    assert.equal(inhabil(22), true, "sabado");
    assert.equal(inhabil(23), true, "domingo");
    assert.match(home, /const nonWorking = cell\.isWeekend \|\| cell\.holiday;/);
    assert.match(css, /\.hm-tc-cell\.is-nonworking \{/);
});

test("el calendario de tareas ocupa al menos un 30% mas", () => {
    // Era de 1040 px de ancho y casillas de 92 px de alto.
    assert.match(css, /\.hm-modal--taskcal \{ width: min\(1360px, 100%\);/);
    assert.match(
        css,
        /\.hm-modal--taskcal \.hm-tc-cell \{ min-height: clamp\(120px, 13vh, 150px\); \}/
    );
});
