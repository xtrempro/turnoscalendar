// Resumen de incidencias de marcaje del mes, en el inicio.
//
// Cuenta atrasos, marcas de entrada y de salida que faltan, llegadas tarde a
// turnos que no son la base, y salidas antes de hora.
//
// Sale de los MISMOS hechos que dibujan las celdas del reporte, para que el
// resumen y el reporte no puedan decir cosas distintas: si el reporte muestra
// una cruz, aqui hay un evento, y al reves.
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
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { dataset: {} }
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const {
    ATTENDANCE_INCIDENT_KINDS,
    attendanceIncidentContext,
    buildAttendanceIncidents
} = await import("../js/hoursReport.js");

const home = (await readFile(
    new URL("../js/home.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");
const importacion = (await readFile(
    new URL("../js/attendanceImport.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");
const estilos = (await readFile(
    new URL("../styles.css", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");
const principal = (await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

const NOMBRE = "TRABAJADOR DE PRUEBA";
const RUT = "17816632-8";
const A = 2026;
const M = 6; // julio: mes ya pasado, para que las cruces cuenten
const PERFIL = [{ name: NOMBRE, rut: RUT }];
const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));

function sembrarPerfil(nombre, base) {
    set(`rotativa_${nombre}`, {
        type: "4turno", start: "2026-07-01", firstTurn: "larga"
    });
    set(`shift_${nombre}`, true);
    set(`baseData_${nombre}`, base);
    set(`data_${nombre}`, base);
}

function sembrar(base, marcas) {
    localStorage.clear();
    sembrarPerfil(NOMBRE, base);
    set("attendanceMarks", { [RUT]: marcas });
}

const dia = (n) => `${A}-${M}-${n}`;
const iso = (n) => `2026-07-${String(n).padStart(2, "0")}`;

/* =========================================================
   Los tipos
========================================================= */

test("son los que pidio el usuario, en orden", () => {
    assert.deepEqual(
        ATTENDANCE_INCIDENT_KINDS.map(kind => kind.label),
        [
            "Atrasos",
            "Sin marcaje entrada",
            "Sin marcaje salida",
            "Entrada tardía",
            "Entrada anticipada",
            "Salida temprana",
            "Salida posterior",
            "Salida tardía",
            "Jornada incompleta",
            "Marcas sin justificar",
            "Marcaje en día libre"
        ]
    );
});

test("un atraso en turno base se cuenta como atraso", async () => {
    // Larga: entra 08:00. Marca 08:20 -> 20 minutos.
    sembrar(
        { [dia(6)]: 1 },
        { [iso(6)]: [{ time: "08:20", type: "in" }, { time: "20:00", type: "out" }] }
    );

    const { totals, events } = await buildAttendanceIncidents(
        PERFIL,
        new Date(A, M, 1)
    );
    const delDia = events.filter(evento => evento.iso === iso(6));

    assert.equal(totals.atraso, 1);
    assert.equal(delDia[0].kind, "atraso");
    assert.match(delDia[0].detail, /20 min/);
    assert.equal(delDia[0].profile, NOMBRE);
});

test("llegar tarde a un turno extra es entrada tardia, no atraso", async () => {
    // Base libre, hace una Noche extra y marca 20:30.
    localStorage.clear();
    set(`rotativa_${NOMBRE}`, {
        type: "4turno", start: "2026-07-01", firstTurn: "larga"
    });
    set(`shift_${NOMBRE}`, true);
    set(`baseData_${NOMBRE}`, { [dia(6)]: 0 });
    set(`data_${NOMBRE}`, { [dia(6)]: 2 });
    set("attendanceMarks", {
        [RUT]: {
            [iso(6)]: [{ time: "20:30", type: "in" }],
            [iso(7)]: [{ time: "08:00", type: "out" }]
        }
    });

    const { totals } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));

    assert.equal(totals.atraso, 0);
    assert.equal(totals.lateOnExtra, 1);
});

test("un turno sin marcas cuenta las dos que faltan", async () => {
    // El dia 6 no tiene marcas, pero el periodo SI esta cargado: hay marcas
    // el 3 y el 9, asi que la planilla de esos dias ya se subio y la falta del
    // 6 es real.
    sembrar({ [dia(6)]: 1 }, {
        [iso(3)]: [{ time: "08:00", type: "in" }],
        [iso(9)]: [{ time: "08:00", type: "in" }]
    });

    const { events } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));
    const delDia = events
        .filter(evento => evento.iso === iso(6))
        .map(evento => evento.kind)
        .sort();

    assert.deepEqual(delDia, ["missingEntry", "missingExit"]);
});

test("sin planilla cargada NO se inventan faltas de marcaje", async () => {
    // Los datos del reloj solo llegan al subir el .xls. Antes de eso, que no
    // haya marcas no dice nada del trabajador: dice que falta el archivo.
    // Sin esta regla, el resumen del mes en curso aparecia lleno de cruces.
    sembrar({ [dia(6)]: 1 }, {});

    const { totals } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));

    assert.equal(totals.missingEntry, 0);
    assert.equal(totals.missingExit, 0);
});

/* =========================================================
   El corte es la ultima planilla, no el reloj de la pared

   Si pasan dias sin subir el .xls, esos dias no generan faltas: no hay archivo
   que diga si marco o no. Se juzgan cuando llegue la planilla que los cubre.
========================================================= */

const cargadaEl = (...partes) =>
    set("attendanceMarksImportedAt", new Date(...partes).toISOString());

test("un turno que aun no terminaba al subir la planilla no cuenta", async () => {
    // El dia 6 tiene Larga (sale 20:00) y la planilla se subio ese mismo dia a
    // las 10: a esa hora no hay salida que exigir, ni entrada que reclamar.
    sembrar({ [dia(6)]: 1 }, {
        [iso(3)]: [{ time: "08:00", type: "in" }],
        [iso(9)]: [{ time: "08:00", type: "in" }]
    });
    cargadaEl(A, M, 6, 10, 0);

    const { events } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));

    assert.deepEqual(events.filter(evento => evento.iso === iso(6)), []);
});

test("y si cuenta cuando la planilla llego despues", async () => {
    sembrar({ [dia(6)]: 1 }, {
        [iso(3)]: [{ time: "08:00", type: "in" }],
        [iso(9)]: [{ time: "08:00", type: "in" }]
    });
    cargadaEl(A, M, 10, 9, 0);

    const { events } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));
    const delDia = events
        .filter(evento => evento.iso === iso(6))
        .map(evento => evento.kind)
        .sort();

    assert.deepEqual(delDia, ["missingEntry", "missingExit"]);
});

test("los dias posteriores a la carga quedan en espera", async () => {
    // Se subio el dia 6 a las 22; el turno del 7 no existe todavia para el
    // reloj y no puede faltarle nada.
    sembrar({ [dia(6)]: 1, [dia(7)]: 1 }, {
        [iso(3)]: [{ time: "08:00", type: "in" }],
        [iso(9)]: [{ time: "08:00", type: "in" }]
    });
    cargadaEl(A, M, 6, 22, 0);

    const { events } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));

    assert.deepEqual(events.filter(evento => evento.iso === iso(7)), []);
    // El del 6, que ya habia cerrado a las 20:00, si se cuenta.
    assert.ok(events.some(evento => evento.iso === iso(6)));
});

test("fuera del periodo cargado tampoco", async () => {
    // La planilla cubre hasta el dia 9; del 10 en adelante no sabemos nada
    // todavia, aunque la fecha ya haya pasado.
    sembrar({ [dia(9)]: 1, [dia(20)]: 1 }, {
        [iso(9)]: [{ time: "08:00", type: "in" }, { time: "20:00", type: "out" }]
    });

    const { events } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));

    assert.equal(
        events.filter(evento => evento.iso === iso(20)).length,
        0
    );
});

test("irse antes de hora es salida temprana", async () => {
    // Larga termina 20:00; se va 19:30.
    sembrar(
        { [dia(6)]: 1 },
        { [iso(6)]: [{ time: "08:00", type: "in" }, { time: "19:30", type: "out" }] }
    );

    const { totals } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));

    assert.equal(totals.earlyExit, 1);
    assert.equal(totals.atraso, 0);
});

test("marcar en un dia libre es una incidencia", async () => {
    // Vino a trabajar y su turno no quedo registrado en TurnoPlus: el reporte
    // muestra "Libre" en turno realizado y aun asi hay marcas.
    sembrar({ [dia(6)]: 1, [dia(7)]: 0 }, {
        [iso(6)]: [{ time: "08:00", type: "in" }, { time: "20:00", type: "out" }],
        [iso(7)]: [{ time: "19:49", type: "in" }, { time: "23:58", type: "out" }]
    });

    const { totals, events } = await buildAttendanceIncidents(
        PERFIL,
        new Date(A, M, 1)
    );
    const delDia = events.filter(evento => evento.iso === iso(7));

    assert.equal(totals.markOnFreeDay, 1);
    assert.equal(delDia[0].kind, "markOnFreeDay");
    assert.match(delDia[0].detail, /Entró 19:49 y salió 23:58/);
    assert.match(delDia[0].detail, /sin turno registrado/);
});

test("una sola marca en el dia libre tambien cuenta", async () => {
    sembrar({ [dia(6)]: 1, [dia(7)]: 0 }, {
        [iso(6)]: [{ time: "08:00", type: "in" }, { time: "20:00", type: "out" }],
        [iso(7)]: [{ time: "08:23", type: "out" }]
    });

    const { totals, events } = await buildAttendanceIncidents(
        PERFIL,
        new Date(A, M, 1)
    );
    const delDia = events.filter(evento => evento.iso === iso(7));

    assert.equal(totals.markOnFreeDay, 1);
    assert.match(delDia[0].detail, /^Salió 08:23/);
});

test("un dia libre SIN marcas no genera nada", async () => {
    // Es lo normal: la mayoria de los dias libres no tienen marcas y no deben
    // llenar el resumen.
    sembrar({ [dia(6)]: 1, [dia(7)]: 0 }, {
        [iso(6)]: [{ time: "08:00", type: "in" }, { time: "20:00", type: "out" }]
    });

    const { totals } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));

    assert.equal(totals.markOnFreeDay, 0);
});

test("un permiso no es un dia libre", async () => {
    // El reporte muestra "P. Administrativo" en turno realizado, no "Libre":
    // el dia ya tiene su motivo y no es un turno sin registrar.
    sembrar({ [dia(6)]: 1, [dia(7)]: 0 }, {
        [iso(6)]: [{ time: "08:00", type: "in" }, { time: "20:00", type: "out" }],
        [iso(7)]: [{ time: "09:10", type: "in" }]
    });
    set(`admin_${NOMBRE}`, { [dia(7)]: 1 });

    const { totals } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));

    assert.equal(totals.markOnFreeDay, 0);
});

test("un turno de verdad nunca cuenta como dia libre", async () => {
    // El dia 6 tiene Larga y sus dos marcas: es un turno normal.
    sembrar(
        { [dia(6)]: 1 },
        { [iso(6)]: [{ time: "08:00", type: "in" }, { time: "20:00", type: "out" }] }
    );

    const { totals } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));

    assert.equal(totals.markOnFreeDay, 0);
});

test("un dia sin problemas no genera nada", async () => {
    sembrar(
        { [dia(6)]: 1 },
        { [iso(6)]: [{ time: "07:58", type: "in" }, { time: "20:04", type: "out" }] }
    );

    const { events } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));

    assert.deepEqual(events.filter(evento => evento.iso === iso(6)), []);
});

test("cada evento dice de quien, de que dia y por que", async () => {
    // Es lo que hace util el detalle: sin el nombre y la fecha no se puede ir
    // a revisar el caso.
    sembrar(
        { [dia(6)]: 1 },
        { [iso(6)]: [{ time: "08:20", type: "in" }, { time: "20:00", type: "out" }] }
    );

    const { events } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));
    const delDia = events.filter(evento => evento.iso === iso(6));

    assert.equal(delDia.length, 1);
    assert.deepEqual(Object.keys(delDia[0]).sort(), [
        "detail", "iso", "kind", "profile"
    ]);
});

test("solo se mira el mes pedido", async () => {
    sembrar(
        { [dia(6)]: 1, [`${A}-${M + 1}-6`]: 1 },
        { [iso(6)]: [{ time: "08:20", type: "in" }] }
    );

    const julio = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));
    const agosto = await buildAttendanceIncidents(PERFIL, new Date(A, M + 1, 1));

    assert.ok(julio.events.some(evento => evento.iso === iso(6)));
    assert.ok(!agosto.events.some(evento => evento.iso === iso(6)));
});

test("sin trabajadores no falla ni inventa", async () => {
    localStorage.clear();

    const { events, totals } = await buildAttendanceIncidents(
        [],
        new Date(A, M, 1)
    );

    assert.deepEqual(events, []);
    ATTENDANCE_INCIDENT_KINDS.forEach(kind => {
        assert.equal(totals[kind.key], 0, kind.key);
    });
});

/* =========================================================
   Quien entra en la cuenta
========================================================= */

const OTRO = "TRABAJADORA SIN RELOJ";
const RUT_OTRO = "12345678-5";
const jornada = {
    [iso(6)]: [{ time: "08:00", type: "in" }, { time: "20:00", type: "out" }]
};

test("un perfil desactivado no cuenta", async () => {
    // El supervisor desactiva a quien deja la unidad. Sus dias siguen
    // guardados, pero ya no son incidencias de nadie.
    sembrar(
        { [dia(6)]: 1 },
        { [iso(6)]: [{ time: "08:20", type: "in" }, { time: "20:00", type: "out" }] }
    );

    const { totals, events } = await buildAttendanceIncidents(
        [{ name: NOMBRE, rut: RUT, active: false }],
        new Date(A, M, 1)
    );

    assert.equal(totals.atraso, 0);
    assert.deepEqual(events, []);
});

test("quien nunca tuvo una marca no aparece", async () => {
    // Si no viene en el .xls, el reloj no lo registra: sus dias sin marca no
    // son una falta suya. Sin esto, el periodo cargado por SUS companeros le
    // llenaba el resumen de cruces.
    sembrar({ [dia(6)]: 1 }, jornada);
    sembrarPerfil(OTRO, { [dia(6)]: 1 });

    const { events } = await buildAttendanceIncidents(
        [{ name: NOMBRE, rut: RUT }, { name: OTRO, rut: RUT_OTRO }],
        new Date(A, M, 1)
    );

    assert.deepEqual(events.filter(evento => evento.profile === OTRO), []);
});

test("con una marca de cualquier mes ya entra, y no sale mas", async () => {
    // Basta que el reloj lo haya registrado una vez -aunque sea en junio-:
    // desde ahi, que la planilla nueva no lo traiga SI es un dato de el.
    sembrar({ [dia(6)]: 1 }, jornada);
    sembrarPerfil(OTRO, { [dia(6)]: 1 });
    set("attendanceMarks", {
        [RUT]: jornada,
        [RUT_OTRO]: { "2026-06-15": [{ time: "08:00", type: "in" }] }
    });

    const { events } = await buildAttendanceIncidents(
        [{ name: NOMBRE, rut: RUT }, { name: OTRO, rut: RUT_OTRO }],
        new Date(A, M, 1)
    );
    const delOtro = events
        .filter(evento => evento.profile === OTRO && evento.iso === iso(6))
        .map(evento => evento.kind)
        .sort();

    assert.deepEqual(delOtro, ["missingEntry", "missingExit"]);
});

test("un RUT con la fecha vacia no es una marca", async () => {
    // El almacen puede quedar con el RUT y ninguna marca dentro; eso sigue
    // siendo un trabajador que el reloj nunca registro.
    sembrar({ [dia(6)]: 1 }, jornada);
    sembrarPerfil(OTRO, { [dia(6)]: 1 });
    set("attendanceMarks", { [RUT]: jornada, [RUT_OTRO]: { [iso(6)]: [] } });

    const { events } = await buildAttendanceIncidents(
        [{ name: NOMBRE, rut: RUT }, { name: OTRO, rut: RUT_OTRO }],
        new Date(A, M, 1)
    );

    assert.deepEqual(events.filter(evento => evento.profile === OTRO), []);
});

/* =========================================================
   El detalle de una incidencia
========================================================= */

test("abre la vispera, el dia y el dia siguiente", async () => {
    // Un turno no termina donde termina la fecha: la vispera y el dia
    // siguiente son la mitad de la explicacion de lo que se esta mirando.
    sembrar({ [dia(5)]: 0, [dia(6)]: 1, [dia(7)]: 2 }, {
        [iso(6)]: [{ time: "08:20", type: "in" }, { time: "20:00", type: "out" }]
    });

    const dias = await attendanceIncidentContext(
        { name: NOMBRE, rut: RUT },
        iso(6)
    );

    assert.deepEqual(dias.map(item => item.iso), [iso(5), iso(6), iso(7)]);
});

test("de cada dia dice turno, atraso y marcas", async () => {
    sembrar({ [dia(5)]: 0, [dia(6)]: 1, [dia(7)]: 2 }, {
        [iso(6)]: [{ time: "08:20", type: "in" }, { time: "20:00", type: "out" }]
    });

    const [vispera, elDia, siguiente] = await attendanceIncidentContext(
        { name: NOMBRE, rut: RUT },
        iso(6)
    );

    assert.equal(elDia.turnoBase, "Larga");
    assert.equal(elDia.turnoRealizado, "Larga");
    assert.equal(elDia.atraso, "20 min");
    assert.match(elDia.entrada, /08:20/);
    assert.match(elDia.salida, /20:00/);
    assert.equal(vispera.turnoRealizado, "Libre");
    assert.equal(siguiente.turnoBase, "Noche");
});

test("la vispera del dia 1 es del mes anterior", async () => {
    // Los feriados se piden con el anio del dia mirado, y esa consulta ya
    // trae el anterior y el siguiente: un 1 de enero no se queda sin vispera.
    sembrar({ [dia(1)]: 1 }, {
        [iso(1)]: [{ time: "08:00", type: "in" }]
    });

    const dias = await attendanceIncidentContext(
        { name: NOMBRE, rut: RUT },
        iso(1)
    );

    assert.deepEqual(
        dias.map(item => item.iso),
        ["2026-06-30", iso(1), iso(2)]
    );
});

test("sin trabajador o sin fecha no devuelve nada", async () => {
    sembrar({ [dia(6)]: 1 }, {});

    assert.deepEqual(await attendanceIncidentContext(null, iso(6)), []);
    assert.deepEqual(
        await attendanceIncidentContext({ name: NOMBRE, rut: RUT }, ""),
        []
    );
});

/* =========================================================
   El recuadro
========================================================= */

test("se puede avanzar y retroceder de mes", () => {
    assert.match(home, /data-hm="inc-prev"/);
    assert.match(home, /data-hm="inc-next"/);
    assert.match(home, /paso\.dataset\.hm === "inc-next" \? 1 : -1/);
});

test("el calculo no bloquea el inicio", () => {
    // Recorrer el mes de todos los trabajadores toma del orden de 100 ms con
    // una unidad completa: el inicio aparece y el resultado entra despues.
    assert.match(home, /Revisando el mes\.\.\./);
    assert.match(home, /void cargarIncidencias\(panel\);/);
});

test("lo calculado se descarta al subir una planilla nueva", () => {
    // Los datos del reloj solo cambian ahi, asi que no hace falta recalcular a
    // cada rato: basta con enterarse cuando cambian.
    assert.match(home, /"proturnos:attendanceMarksChanged", "proturnos:clockMarksChanged"/);
    assert.match(home, /incidenciasCache = null;/);
});

test("lo calculado se descarta al desactivar un perfil", () => {
    // Desactivar a alguien lo saca del resumen. Sin esto, sus incidencias
    // seguian a la vista hasta cambiar de mes o recargar la pagina.
    assert.match(home, /"proturnos:profilesSaved"/);
});

test("el aviso lo emite quien guarda las marcas", () => {
    // Asi cubre cualquier via que cargue marcas, no solo el boton de importar.
    assert.match(importacion, /proturnos:attendanceMarksChanged/);
    assert.match(importacion, /if \(added\) \{/);
});

test("solo se recalcula si el inicio esta a la vista", () => {
    assert.match(home, /document\.body\.dataset\.activeView === "home"/);
});

test("no se recalcula el mismo mes dos veces", () => {
    assert.match(
        home,
        /if \(incidenciasCache\?\.key === incidenciasMesKey\(incidenciasMes\)\) \{/
    );
});

test("cambiar de mes rapido no pinta un resultado viejo", () => {
    // Sin esto, el mes que tarda mas en calcularse pisa al que se pidio
    // despues.
    assert.match(home, /const requestId = \+\+incidenciasRequest;/);
    assert.match(home, /if \(requestId !== incidenciasRequest\) return;/);
});

test("las cinco filas se muestran aunque esten en cero", () => {
    // Ver un 0 al lado de "Sin marcaje entrada" dice algo; que la fila
    // desaparezca, no.
    assert.match(home, /\$\{cantidad \? "" : "disabled"\}/);
});

test("cada tipo abre su detalle", () => {
    assert.match(home, /data-hm="inc-kind"/);
    assert.match(home, /function incidenciasDetalleHTML\(kind\)/);
    assert.match(home, /evento\.kind === kind/);
    assert.match(home, /data-hm="inc-modal"/);
});

test("cada fila del detalle se abre y se cierra", () => {
    // El reporte entra como HERMANO de la fila, no dentro: asi empuja hacia
    // abajo a las incidencias que siguen y queda entre esta y la siguiente.
    // Cerrarlo lo quita y las filas se vuelven a juntar.
    assert.match(home, /data-hm="inc-row"/);
    assert.match(home, /fila\.after\(caja\);/);
    assert.match(home, /caja\.remove\(\);/);
    assert.match(home, /aria-expanded="false"/);
});

test("y se abre de a una: al abrir otra, la anterior se cierra", () => {
    // Con varias abiertas la lista se estira y hay que acordarse de cerrar la
    // anterior a mano para volver a verla entera.
    assert.match(home, /function cerrarIncidenciasAbiertas\(lista\)/);
    assert.match(
        home,
        /cerrarIncidenciasAbiertas\(fila\.parentElement\);\s*\n\s*\n\s*if \(abierto\) return;/
    );
    // La fila y su detalle son hermanos, asi que al quitar la caja hay que
    // devolverle a la fila su aria-expanded o el lector de pantalla la sigue
    // anunciando desplegada.
    assert.match(
        home,
        /caja\.previousElementSibling\?\.setAttribute\("aria-expanded", "false"\);/
    );
});

test("el rayado no se corre al abrir una fila", () => {
    // Entre dos filas puede quedar abierto un reporte, que es otro elemento:
    // contando por tipo, las rayas siguen alternando igual.
    assert.match(estilos, /\.hm-inc-row:nth-of-type\(odd\)/);
});

test("el detalle trae las columnas del reporte", () => {
    assert.match(home, /\["turnoBase", "Turno base"\]/);
    assert.match(home, /\["turnoRealizado", "Turno realizado"\]/);
    assert.match(home, /\["atraso", "Atraso"\]/);
    assert.match(home, /\["entrada", "Entrada"\]/);
    assert.match(home, /\["salida", "Salida"\]/);
});

test("desde el detalle se salta al calendario y al reporte", () => {
    // Los dos botones van bajo el resumen de los tres dias y llevan al mismo
    // trabajador, en el mes de la incidencia.
    assert.match(home, /data-hm="inc-cal"/);
    assert.match(home, /data-hm="inc-report"/);
    assert.match(home, /VER CALENDARIO<\/button>/);
    assert.match(home, /IR AL REPORTE<\/button>/);
    assert.match(home, /"proturnos:viewWorkerRequestInCalendar"/);
    assert.match(home, /"proturnos:viewWorkerReport"/);
    assert.match(home, /data-profile="\$\{esc\(evento\.profile\)\}"/);
    assert.match(home, /data-iso="\$\{esc\(evento\.iso\)\}"/);
});

test("el reporte se abre en el mes de la incidencia", () => {
    // Sin fijar el mes ANTES de entrar, Reportes se dibuja con el mes que
    // quedo abierto la ultima vez y el supervisor no ve el dia que pidio.
    const salto = principal.slice(
        principal.indexOf(`"proturnos:viewWorkerReport"`)
    );
    const fijaMes = salto.indexOf("reportsMonthDate = new Date(");
    const abre = salto.indexOf(`setActiveShortcut("reportsPanel")`);

    assert.ok(fijaMes > 0 && abre > 0);
    assert.ok(fijaMes < abre, "el mes se fija antes de abrir Reportes");
    assert.match(salto.slice(0, abre), /selectProfileByName\(profileName/);
});

test("desde la tarjeta se adjunta el registro del reloj", () => {
    // Es el MISMO input que el de Reportes: una sola forma de leer el .xls,
    // con su misma proteccion contra repetir marcas que ya estaban.
    assert.match(home, /data-hm="inc-import"/);
    assert.match(home, /ADJUNTAR REGISTRO<\/button>/);
    assert.match(
        home,
        /document\.getElementById\("attendanceImportInput"\)\?\.click\(\);/
    );
    assert.match(principal, /const input = DOM\.attendanceImportInput;/);
});

test("adjuntar desde el inicio tambien avisa como resulto", () => {
    // El texto de estado vive bajo el boton de Reportes, que desde el inicio
    // no se ve: ahi el mismo aviso sale como toast.
    assert.match(
        principal,
        /if \(document\.body\.dataset\.activeView !== "reports"\) \{/
    );
    assert.match(principal, /title: "Registros del reloj"/);
});

test("el detalle va ordenado por fecha", () => {
    assert.match(
        home,
        /\.sort\(\(a, b\) => a\.iso\.localeCompare\(b\.iso\) \|\|/
    );
});
