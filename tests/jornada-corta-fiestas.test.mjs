// Jornada corta por fiestas: 17 de septiembre, 24 y 31 de diciembre.
//
// Esos tres dias -visperas del 18, de Navidad y de Ano Nuevo- la jornada diurna
// se anticipa: termina a las 12:30, y los VIERNES a las 12:00, como si a todos
// les dieran medio administrativo de tarde. Sin esta regla, al adjuntar las
// marcaciones el reporte acusaba salidas tempranas que no eran tales.
//
// Rige para todo turno diurno, sea cual sea la rotativa -tambien el tramo
// diurno de un D+N- y en todas las unidades: son fechas nacionales fijas.
//
// Las horas NO cambian: calcDiurno reparte 8,8 en cualquier dia habil, igual
// que ya hacia con el viernes que sale a las 16:00. Lo que cambia es el horario
// contra el que se miden las marcas.
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
    removeEventListener() {}
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    body: { dataset: {} },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
};

const {
    getScheduledSegmentsForState
} = await import("../js/clockMarks.js");
const { calcDiurno } = await import("../js/calculations.js");
const { TURNO } = await import("../js/constants.js");

/** "08:00" del Date que devuelve el motor. */
const hhmm = date => [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0")
].join(":");

/** El unico tramo diurno de ese dia, o null. */
function tramoDiurno(date, state = TURNO.DIURNO) {
    const segments = getScheduledSegmentsForState(date, state, {});

    return segments.find(segment => segment.id === "diurno") || null;
}

/* =========================================================
   Las fechas, comprobadas por el propio test
========================================================= */

const J17SEP = new Date(2026, 8, 17);
const J24DIC = new Date(2026, 11, 24);
const J31DIC = new Date(2026, 11, 31);
const V24DIC = new Date(2027, 11, 24);
const LUNES = new Date(2026, 8, 14);
const VIERNES = new Date(2026, 8, 11);
const DOMINGO24DIC = new Date(2028, 11, 24);

test("las fechas de prueba caen donde creo que caen", () => {
    // Si esta prueba falla, las demas estan midiendo otra cosa.
    assert.equal(J17SEP.getDay(), 4, "17-09-2026 deberia ser jueves");
    assert.equal(J24DIC.getDay(), 4, "24-12-2026 deberia ser jueves");
    assert.equal(J31DIC.getDay(), 4, "31-12-2026 deberia ser jueves");
    assert.equal(V24DIC.getDay(), 5, "24-12-2027 deberia ser viernes");
    assert.equal(LUNES.getDay(), 1);
    assert.equal(VIERNES.getDay(), 5);
    assert.equal(DOMINGO24DIC.getDay(), 0, "24-12-2028 deberia ser domingo");
});

/* =========================================================
   La jornada corta
========================================================= */

test("los tres dias terminan a las 12:30", () => {
    [J17SEP, J24DIC, J31DIC].forEach(date => {
        const tramo = tramoDiurno(date);

        assert.ok(tramo, `${date.toDateString()} deberia tener tramo diurno`);
        assert.equal(hhmm(tramo.start), "08:00");
        assert.equal(hhmm(tramo.end), "12:30", date.toDateString());
    });
});

test("y si caen en viernes, a las 12:00", () => {
    const tramo = tramoDiurno(V24DIC);

    assert.equal(hhmm(tramo.start), "08:00");
    assert.equal(hhmm(tramo.end), "12:00");
});

test("un dia normal no cambia", () => {
    // El resto del ano sigue igual: 17:00, y 16:00 los viernes.
    assert.equal(hhmm(tramoDiurno(LUNES).end), "17:00");
    assert.equal(hhmm(tramoDiurno(VIERNES).end), "16:00");
});

test("en dia inhabil no hay jornada que acortar", () => {
    // El 24 de diciembre de 2028 cae domingo: no hay tramo diurno, como
    // cualquier otro domingo.
    assert.deepEqual(
        getScheduledSegmentsForState(DOMINGO24DIC, TURNO.DIURNO, {}),
        []
    );
});

test("solo esos tres dias, no la visperas ni los feriados mismos", () => {
    // El 18 de septiembre y el 25 de diciembre son feriados: no tienen jornada.
    // El 16 de septiembre y el 23 de diciembre son dias normales.
    assert.equal(hhmm(tramoDiurno(new Date(2026, 8, 16)).end), "17:00");
    assert.equal(hhmm(tramoDiurno(new Date(2026, 11, 23)).end), "17:00");
});

/* =========================================================
   Alcance: todo turno diurno
========================================================= */

test("el tramo diurno de un D+N tambien se acorta", () => {
    // Lo decidio el usuario: la regla es del TURNO, no de la rotativa.
    const tramo = tramoDiurno(J24DIC, TURNO.DIURNO_NOCHE);

    assert.equal(hhmm(tramo.end), "12:30");
});

test("la noche de ese D+N no se toca", () => {
    const segments = getScheduledSegmentsForState(
        J24DIC,
        TURNO.DIURNO_NOCHE,
        {}
    );
    const noche = segments.find(segment => segment.id === "noche");

    assert.equal(hhmm(noche.start), "20:00");
    assert.equal(hhmm(noche.end), "08:00");
});

test("una Larga de ese dia sigue entera", () => {
    // La jornada corta es del diurno. Quien hace una Larga la hace completa.
    const [larga] = getScheduledSegmentsForState(J24DIC, TURNO.LARGA, {});

    assert.equal(hhmm(larga.start), "08:00");
    assert.equal(hhmm(larga.end), "20:00");
});

/* =========================================================
   Las horas no cambian
========================================================= */

test("el reparto de horas del mes sigue siendo 8,8", () => {
    // Igual que el viernes, que ya salia a las 16:00 y tampoco descontaba. El
    // 8,8 es el promedio con que se reparte la jornada contractual, no la
    // duracion del dia.
    assert.deepEqual(calcDiurno(J24DIC, {}), { d: 8.8, n: 0 });
    assert.deepEqual(calcDiurno(LUNES, {}), { d: 8.8, n: 0 });
});
