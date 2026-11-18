// Un turno extra MANUAL se agrega primero al calendario (edicion directa) y
// despues se le registra el motivo con addsShift: false: el registro es solo el
// respaldo, no proyecta el turno. Al pulsar "Anular reemplazo" se borraba el
// motivo pero el turno seguia puesto, asi que la casilla volvia a mostrar el "?"
// pidiendo motivo: en la practica no se anulaba nada.
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

const { cancelReplacementById, getHheeMonthRecords } =
    await import("../js/replacements.js");
const { getTurnoProgramado } = await import("../js/turnEngine.js");
const { TURNO } = await import("../js/constants.js");

const NAME = "Ana Rojas Campos";
const YEAR = 2026;
const MONTH = 7;
const DAY_KEY = "2026-7-4";
const DAY_ISO = "2026-08-04";
const RECORD_ID = "extra-1";

function seed({ baseTurn, calendarTurn, record }) {
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify([{
        id: "p-a",
        name: NAME,
        estamento: "Profesional",
        profession: "TM Imagenología",
        contractType: "Contrata",
        active: true
    }]));
    localStorage.setItem(`rotativa_${NAME}`, JSON.stringify({
        type: "4turno",
        start: "",
        firstTurn: "larga"
    }));
    localStorage.setItem(`shift_${NAME}`, JSON.stringify(true));
    localStorage.setItem(`baseData_${NAME}`, JSON.stringify({
        [DAY_KEY]: baseTurn
    }));
    // El turno extra ya esta en el calendario del trabajador.
    localStorage.setItem(`data_${NAME}`, JSON.stringify({
        [DAY_KEY]: calendarTurn
    }));
    localStorage.setItem("replacements", JSON.stringify([{
        id: RECORD_ID,
        worker: NAME,
        date: DAY_ISO,
        year: YEAR,
        month: MONTH,
        replaced: "",
        reason: "Apoyo Oncológico",
        absenceType: "Motivo manual",
        addsShift: false,
        ...record
    }]));
}

test("anular un turno extra manual devuelve la casilla a vacio", () => {
    seed({
        baseTurn: TURNO.LIBRE,
        calendarTurn: TURNO.LARGA,
        record: { turno: "L", source: "manual_extra" }
    });

    assert.equal(getTurnoProgramado(NAME, DAY_KEY), TURNO.LARGA);

    assert.ok(cancelReplacementById(RECORD_ID));

    assert.equal(
        getTurnoProgramado(NAME, DAY_KEY),
        TURNO.LIBRE,
        "el turno extra tiene que salir del calendario"
    );
});

test("anular deja de pedir el motivo con el signo de pregunta", () => {
    seed({
        baseTurn: TURNO.LIBRE,
        calendarTurn: TURNO.LARGA,
        record: { turno: "L", source: "manual_extra" }
    });

    cancelReplacementById(RECORD_ID);

    // Un turno extra sin respaldo aparece como registro "sin respaldo", que es
    // lo mismo que dibuja el "?" en la casilla. Al anular no debe quedar ninguno.
    const pendientes = getHheeMonthRecords(NAME, YEAR, MONTH, {})
        .filter(record => !record.backed);

    assert.deepEqual(pendientes, []);
});

test("sobre un turno base, anular devuelve al turno original", () => {
    // Base Larga + Noche extra = 24h. Al anular tiene que volver a Larga.
    seed({
        baseTurn: TURNO.LARGA,
        calendarTurn: TURNO.TURNO24,
        record: { turno: "N", source: "manual_extra" }
    });

    cancelReplacementById(RECORD_ID);

    assert.equal(getTurnoProgramado(NAME, DAY_KEY), TURNO.LARGA);
});

test("un respaldo de marcaje no toca el calendario", () => {
    // Sus horas vienen del reloj, no de un turno: no hay nada que quitar.
    seed({
        baseTurn: TURNO.LARGA,
        calendarTurn: TURNO.LARGA,
        record: {
            turno: "D",
            source: "clock_extra",
            clockLabel: "Marcaje reloj control",
            clockHours: { d: 3, n: 0 }
        }
    });

    cancelReplacementById(RECORD_ID);

    assert.equal(getTurnoProgramado(NAME, DAY_KEY), TURNO.LARGA);
});

test("un reemplazo real conserva el comportamiento anterior", () => {
    // Ese turno lo proyecta el propio registro (addsShift), asi que anularlo ya
    // lo quitaba; el calendario del trabajador no se toca.
    seed({
        baseTurn: TURNO.LIBRE,
        calendarTurn: TURNO.LIBRE,
        record: {
            turno: "N",
            source: "replacement",
            replaced: "Otra Trabajadora",
            addsShift: true
        }
    });

    cancelReplacementById(RECORD_ID);

    assert.equal(getTurnoProgramado(NAME, DAY_KEY), TURNO.LIBRE);
});

for (const [calendarTurn, recordTurn, expected] of [
    [TURNO.LARGA, "HT", TURNO.DIURNO],
    [TURNO.TURNO24, "HT", TURNO.DIURNO_NOCHE],
    [TURNO.TURNO24, "N", TURNO.LARGA],
    [TURNO.TURNO24, "L", TURNO.DIURNO_NOCHE],
    [TURNO.DIURNO_NOCHE, "N", TURNO.DIURNO]
]) {
    test(`anulacion individual sobre Diurno: ${calendarTurn} menos ${recordTurn} queda ${expected}`, () => {
        seed({baseTurn: TURNO.DIURNO, calendarTurn, record: {turno: recordTurn, source: "manual_extra"}});
        assert.ok(cancelReplacementById(RECORD_ID));
        assert.equal(getTurnoProgramado(NAME, DAY_KEY), expected);
    });
}

test("anular cobertura de un turno base trasladado conserva ese turno", () => {
    seed({baseTurn: TURNO.LARGA, calendarTurn: TURNO.LARGA,
        record: {turno: "L", source: "manual_extra", replaced: "Carla"}});
    assert.ok(cancelReplacementById(RECORD_ID));
    assert.equal(getTurnoProgramado(NAME, DAY_KEY), TURNO.LARGA);
});
