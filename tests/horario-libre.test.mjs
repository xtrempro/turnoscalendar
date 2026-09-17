// HORARIO LIBRE: no se le exige entrar ni salir a una hora determinada.
//
// Lo pidio el supervisor de Imagenologia convencional para si mismo. A un
// trabajador con rotativa diurna no siempre tiene sentido exigirle una hora de
// llegada: lo que se le exige es cumplir las horas de su jornada, que son 9 de
// lunes a jueves y 8 los viernes. Si entra a las 7 un lunes, puede irse a las
// 16 y esta cumpliendo.
//
// Por eso en esos dias no se le miden atrasos ni fronteras corridas. Lo que si
// se mira es el total del dia, en sus dos direcciones:
//   - se quedo de mas  -> salida tardia, para ver si corresponden horas extras;
//   - no alcanzo       -> jornada incompleta.
//
// Y lo que NO puede pasar: que esto se le aplique a alguien que no lo tiene.
// Viene apagado para todos.
import test from "node:test";
import assert from "node:assert/strict";

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

const { TURNO } = await import("../js/constants.js");
const {
    addWorkerSchedulePeriod,
    getWorkerSchedulePeriods,
    isFreeScheduleAt,
    normalizeWorkerSchedule
} = await import("../js/workerSchedule.js");
const {
    ATTENDANCE_INCIDENT_KINDS,
    buildAttendanceIncidents
} = await import("../js/hoursReport.js");

const NOMBRE = "TRABAJADOR DE PRUEBA";
const RUT = "17816632-8";
const A = 2026;
const M = 6; // julio: mes ya pasado, para que el dia se pueda juzgar
const PERFIL = [{ name: NOMBRE, rut: RUT }];

const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const dia = (n) => `${A}-${M}-${n}`;
const iso = (n) => `2026-07-${String(n).padStart(2, "0")}`;

// Un diurno normal entra 08:00 y sale 17:00 -16:00 los viernes-, o sea que su
// jornada YA son las 9 horas de lunes a jueves y las 8 del viernes.
const LUNES = 6;
const VIERNES = 10;

/**
 * Siembra un diurno con sus marcas. Con `libre` se le da horario libre desde
 * el 1 de julio.
 */
function sembrar({ turnos, marcas, libre = false }) {
    localStorage.clear();
    set(`rotativa_${NOMBRE}`, {
        type: "diurno", start: "2026-07-01", firstTurn: "larga"
    });
    set(`shift_${NOMBRE}`, true);
    set(`baseData_${NOMBRE}`, turnos);
    set(`data_${NOMBRE}`, turnos);
    set("attendanceMarks", { [RUT]: marcas });

    if (libre) {
        addWorkerSchedulePeriod(NOMBRE, { from: "2026-07-01", free: true });
    }
}

/** Un dia de diurno con su entrada y su salida. */
function jornada(numeroDeDia, entrada, salida) {
    return {
        turnos: { [dia(numeroDeDia)]: TURNO.DIURNO },
        marcas: {
            [iso(numeroDeDia)]: [
                { time: entrada, type: "in" },
                { time: salida, type: "out" }
            ]
        }
    };
}

async function incidenciasDe(numeroDeDia) {
    const { events } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));

    return events.filter(evento => evento.iso === iso(numeroDeDia));
}

const tipos = (eventos) => eventos.map(evento => evento.kind).sort();

/* =========================================================
   Los dias de la semana que se usan de ejemplo
========================================================= */

test("el 6 de julio de 2026 es lunes y el 10 es viernes", () => {
    // Todo lo que sigue depende de esto: 9 horas el lunes, 8 el viernes.
    assert.equal(new Date(A, M, LUNES).getDay(), 1);
    assert.equal(new Date(A, M, VIERNES).getDay(), 5);
});

/* =========================================================
   Lo que se guarda
========================================================= */

test("un periodo de horario libre se guarda aunque no tenga horas", () => {
    // Antes un periodo sin horas se descartaba por vacio. El horario libre es
    // justamente eso: un periodo sin ninguna hora que cumplir.
    localStorage.clear();

    assert.equal(
        addWorkerSchedulePeriod(NOMBRE, { from: "2026-07-01", free: true }),
        true
    );

    const periodos = getWorkerSchedulePeriods(NOMBRE);

    assert.equal(periodos.length, 1);
    assert.equal(periodos[0].free, true);
});

test("un periodo vacio SIN horario libre se sigue descartando", () => {
    // La regla vieja no se toco: un formulario a medio llenar no crea un
    // periodo.
    assert.deepEqual(
        normalizeWorkerSchedule({ periods: [{ from: "2026-07-01" }] }),
        {}
    );
});

test("rige por periodos, igual que un horario con horas", () => {
    // Importa porque es un acuerdo que empieza un dia: los meses ya revisados
    // no se recalculan como si siempre hubiera sido libre.
    localStorage.clear();
    addWorkerSchedulePeriod(NOMBRE, { from: "2026-07-01", free: true });

    assert.equal(isFreeScheduleAt(NOMBRE, new Date(A, 5, 30)), false);
    assert.equal(isFreeScheduleAt(NOMBRE, new Date(A, M, LUNES)), true);
});

test("viene apagado para todos", () => {
    // Lo pidio una persona. Nadie mas puede quedar con atrasos sin medir por
    // un valor por omision.
    localStorage.clear();

    assert.equal(isFreeScheduleAt(NOMBRE, new Date(A, M, LUNES)), false);
    assert.equal(isFreeScheduleAt("CUALQUIERA", new Date(A, M, LUNES)), false);
});

/* =========================================================
   El ejemplo del usuario: entra a las 7, se va a las 16
========================================================= */

test("entrar a las 7 y salir a las 16 un lunes es cumplir", async () => {
    // Nueve horas justas. Sin horario libre esto seria entrada anticipada -una
    // hora antes de las 08:00- y salida temprana.
    sembrar({ ...jornada(LUNES, "07:00", "16:00"), libre: true });

    assert.deepEqual(await incidenciasDe(LUNES), []);
});

test("y sin horario libre ese mismo dia SI genera incidencias", async () => {
    // Es el contraste que prueba que lo que cambia es la funcion nueva, y no
    // que el dia no se estuviera midiendo.
    sembrar({ ...jornada(LUNES, "07:00", "16:00"), libre: false });

    const delDia = await incidenciasDe(LUNES);

    assert.ok(
        delDia.some(evento => evento.kind === "earlyEntry"),
        "llego una hora antes de las 08:00"
    );
});

test("no se le cuentan atrasos", async () => {
    // Llegar a las 10:00 con jornada de 9 horas y quedarse hasta las 19:00 es
    // cumplir: no hay hora de entrada que incumplir.
    sembrar({ ...jornada(LUNES, "10:00", "19:00"), libre: true });

    assert.deepEqual(await incidenciasDe(LUNES), []);
});

test("y sin horario libre, llegar a las 10:00 es un atraso", async () => {
    sembrar({ ...jornada(LUNES, "10:00", "19:00"), libre: false });

    const delDia = await incidenciasDe(LUNES);

    assert.ok(delDia.some(evento => evento.kind === "atraso"));
});

/* =========================================================
   Se quedo de mas: la alerta de salida tardia
========================================================= */

test("salir a las 18 habiendo entrado a las 7 avisa salida tardia", async () => {
    // El ejemplo textual del usuario: entro a las 7, tenia que cumplir 9 horas
    // -hasta las 16- y el reloj lo registra saliendo a las 18.
    sembrar({ ...jornada(LUNES, "07:00", "18:00"), libre: true });

    const delDia = await incidenciasDe(LUNES);
    const tardia = delDia.find(evento => evento.kind === "freeLateExit");

    assert.ok(tardia, "once horas trabajadas contra una jornada de nueve");
    assert.match(tardia.detail, /Salió 18:00/);
    assert.match(tardia.detail, /trabajó 11 h/);
    assert.match(tardia.detail, /su jornada es de 9 h/);
    assert.match(tardia.detail, /2 h de más/);
});

test("el aviso dice para que sirve: revisar si corresponden horas extras", async () => {
    // Sin eso es un reproche. Lo que el supervisor tiene que decidir es si
    // modifica el marcaje y le agrega las horas extras de ese dia.
    sembrar({ ...jornada(LUNES, "07:00", "18:00"), libre: true });

    const tardia = (await incidenciasDe(LUNES))
        .find(evento => evento.kind === "freeLateExit");

    assert.match(tardia.detail, /modificar el marcaje y agregarle horas extras/);
});

/* =========================================================
   No alcanzo: la jornada incompleta
========================================================= */

test("quedarse corto avisa jornada incompleta", async () => {
    // Siete horas contra las nueve que pide el lunes.
    sembrar({ ...jornada(LUNES, "08:00", "15:00"), libre: true });

    const delDia = await incidenciasDe(LUNES);
    const corta = delDia.find(evento => evento.kind === "freeShortDay");

    assert.ok(corta, "cumplio siete horas de nueve");
    assert.match(corta.detail, /trabajó 7 h/i);
    assert.match(corta.detail, /quedó debiendo 2 h/);
});

test("un dia no puede ser largo y corto a la vez", async () => {
    sembrar({ ...jornada(LUNES, "08:00", "15:00"), libre: true });

    assert.deepEqual(tipos(await incidenciasDe(LUNES)), ["freeShortDay"]);
});

/* =========================================================
   El viernes son 8 horas, no 9
========================================================= */

test("el viernes se cumple con 8 horas", async () => {
    sembrar({ ...jornada(VIERNES, "08:00", "16:00"), libre: true });

    assert.deepEqual(await incidenciasDe(VIERNES), []);
});

test("y nueve horas un viernes son una hora de mas", async () => {
    // El mismo horario que un lunes es impecable, el viernes sobra una hora.
    sembrar({ ...jornada(VIERNES, "08:00", "17:00"), libre: true });

    const tardia = (await incidenciasDe(VIERNES))
        .find(evento => evento.kind === "freeLateExit");

    assert.ok(tardia, "el viernes la jornada es de 8 horas");
    assert.match(tardia.detail, /su jornada es de 8 h/);
    assert.match(tardia.detail, /1 h de más/);
});

/* =========================================================
   El margen

   Una alerta que suena todos los dias no se lee: nadie marca al minuto exacto.
========================================================= */

test("veinte minutos de mas no son nada", async () => {
    sembrar({ ...jornada(LUNES, "08:00", "17:20"), libre: true });

    assert.deepEqual(await incidenciasDe(LUNES), []);
});

test("media hora ya avisa", async () => {
    sembrar({ ...jornada(LUNES, "08:00", "17:30"), libre: true });

    assert.deepEqual(tipos(await incidenciasDe(LUNES)), ["freeLateExit"]);
});

test("y media hora de menos tambien", async () => {
    sembrar({ ...jornada(LUNES, "08:00", "16:30"), libre: true });

    assert.deepEqual(tipos(await incidenciasDe(LUNES)), ["freeShortDay"]);
});

/* =========================================================
   Lo que el horario libre NO apaga
========================================================= */

test("marcar sigue siendo obligatorio", async () => {
    // El horario es libre; el registro no. Sin marcas no hay forma de saber si
    // cumplio las horas, asi que la falta se sigue contando.
    sembrar({
        turnos: { [dia(LUNES)]: TURNO.DIURNO },
        marcas: {
            [iso(3)]: [{ time: "08:00", type: "in" }],
            [iso(9)]: [{ time: "08:00", type: "in" }]
        },
        libre: true
    });

    assert.deepEqual(
        tipos(await incidenciasDe(LUNES)),
        ["missingEntry", "missingExit"]
    );
});

test("con una sola marca no se inventa una jornada incompleta", async () => {
    // Un dia a medio marcar no dice nada sobre las horas cumplidas: ya tiene
    // su propia cruz y contarle ademas la jornada corta seria contarlo dos
    // veces por lo mismo.
    sembrar({
        turnos: { [dia(LUNES)]: TURNO.DIURNO },
        marcas: {
            [iso(LUNES)]: [{ time: "08:00", type: "in" }],
            [iso(9)]: [{ time: "08:00", type: "in" }]
        },
        libre: true
    });

    const delDia = await incidenciasDe(LUNES);

    assert.ok(delDia.some(evento => evento.kind === "missingExit"));
    assert.equal(
        delDia.filter(evento => evento.kind === "freeShortDay").length,
        0
    );
});

test("un dia libre sigue siendo un dia libre", async () => {
    // Sin turno no hay jornada que cumplir: lo que marque ahi es marcaje en
    // dia libre, igual que para cualquiera.
    sembrar({
        turnos: { [dia(LUNES)]: TURNO.DIURNO, [dia(7)]: TURNO.LIBRE },
        marcas: {
            [iso(LUNES)]: [
                { time: "08:00", type: "in" },
                { time: "17:00", type: "out" }
            ],
            [iso(7)]: [{ time: "09:10", type: "in" }]
        },
        libre: true
    });

    const delDia = await incidenciasDe(7);

    assert.ok(delDia.some(evento => evento.kind === "markOnFreeDay"));
});

/* =========================================================
   Los tipos nuevos
========================================================= */

test("los dos tipos entran al recuadro del inicio", () => {
    // Es lo que los hace contables y abribles desde el inicio y el calendario,
    // que resuelven la etiqueta desde esta misma lista.
    const claves = ATTENDANCE_INCIDENT_KINDS.map(kind => kind.key);

    assert.ok(claves.includes("freeLateExit"), "salida tardia");
    assert.ok(claves.includes("freeShortDay"), "jornada incompleta");
});
