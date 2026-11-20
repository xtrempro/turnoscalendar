// El turno programado de quien tiene horario propio arranca y termina en SU hora.
//
// Caso real (Imagenologia, noviembre 2026): Macarena entra a las 8:40 y sale a
// las 17:40 de lunes a jueves. El supervisor le autoriza salir a las 19:40 -dos
// horas extra-, pero el turno programado seguia siendo el diurno general de
// 8:00 a 17:00: su entrada de las 8:40 se pintaba como atraso y una salida
// autorizada sin tocar la entrada contaba desde las 17:00.
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
const { saveWorkerSchedule } = await import("../js/workerSchedule.js");
const { getScheduledSegmentsForProfile } = await import("../js/clockMarks.js");
const { classifyClockMarkSegment } = await import("../js/clockMarkUtils.js");

const MACARENA = "MACARENA";
const OTRA = "OTRA";
const MIERCOLES = new Date(2026, 10, 18);
const VIERNES = new Date(2026, 10, 20);
const NOCHEBUENA = new Date(2026, 11, 24);

function hhmm(date) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function sembrar(horario) {
    localStorage.clear();
    saveWorkerSchedule(MACARENA, { periods: [{ from: "2026-08-01", ...horario }] });
}

function tramo(perfil, fecha, turno) {
    const keyDay = `${fecha.getFullYear()}-${fecha.getMonth()}-${fecha.getDate()}`;
    const segmentos = getScheduledSegmentsForProfile(perfil, keyDay, fecha, turno, {});

    assert.equal(segmentos.length, 1);
    return segmentos[0];
}

const DIURNO_MACARENA = { diurno: { entry: "08:40", exit: "17:40", exitFriday: "16:40" } };

test("el diurno programado de Macarena va de 8:40 a 17:40", () => {
    sembrar(DIURNO_MACARENA);
    const segmento = tramo(MACARENA, MIERCOLES, TURNO.DIURNO);

    assert.equal(hhmm(segmento.start), "08:40");
    assert.equal(hhmm(segmento.end), "17:40");
});

test("el viernes sale a su hora de viernes", () => {
    sembrar(DIURNO_MACARENA);
    const segmento = tramo(MACARENA, VIERNES, TURNO.DIURNO);

    assert.equal(hhmm(segmento.start), "08:40");
    assert.equal(hhmm(segmento.end), "16:40");
});

test("entrar 8:40 y salir 19:40 son 2 horas extra, sin atraso", () => {
    sembrar(DIURNO_MACARENA);
    const segmento = tramo(MACARENA, MIERCOLES, TURNO.DIURNO);
    const resultado = classifyClockMarkSegment(
        MIERCOLES,
        segmento,
        { entryTime: "08:40", exitTime: "19:40" },
        { isBaseOrSwap: true }
    );

    assert.equal(resultado.timing.lateEntry, false);
    assert.equal(resultado.deficitMinutes, 0);
    assert.equal(resultado.netExtraMinutes, 120);
});

test("cambiar solo la salida a 19:40 tambien son 2 horas, no 2:40", () => {
    sembrar(DIURNO_MACARENA);
    const segmento = tramo(MACARENA, MIERCOLES, TURNO.DIURNO);
    const resultado = classifyClockMarkSegment(
        MIERCOLES,
        segmento,
        { exitTime: "19:40" },
        { isBaseOrSwap: true }
    );

    assert.equal(resultado.netExtraMinutes, 120);
});

test("quien no tiene horario propio sigue con el diurno general", () => {
    sembrar(DIURNO_MACARENA);
    const segmento = tramo(OTRA, MIERCOLES, TURNO.DIURNO);

    assert.equal(hhmm(segmento.start), "08:00");
    assert.equal(hhmm(segmento.end), "17:00");
});

test("en jornada corta (24-12) la salida sigue siendo la de la jornada corta", () => {
    sembrar(DIURNO_MACARENA);
    const general = tramo(OTRA, NOCHEBUENA, TURNO.DIURNO);
    const propio = tramo(MACARENA, NOCHEBUENA, TURNO.DIURNO);

    assert.equal(hhmm(propio.start), "08:40");
    assert.equal(hhmm(propio.end), hhmm(general.end));
});

test("una Noche propia termina al dia siguiente", () => {
    sembrar({ noche: { entry: "19:30", exit: "07:30" } });
    const segmento = tramo(MACARENA, MIERCOLES, TURNO.NOCHE);

    assert.equal(hhmm(segmento.start), "19:30");
    assert.equal(hhmm(segmento.end), "07:30");
    assert.equal(segmento.end.getDate(), 19);
});

test("en un 24 se entra por la Larga propia y se sale por la Noche propia", () => {
    sembrar({ larga: { entry: "07:30", exit: "19:30" }, noche: { entry: "19:30", exit: "07:30" } });
    const segmento = tramo(MACARENA, MIERCOLES, TURNO.TURNO24);

    assert.equal(hhmm(segmento.start), "07:30");
    assert.equal(hhmm(segmento.end), "07:30");
    assert.equal(segmento.end.getDate(), 19);
});

test("el horario libre no corre las puntas", () => {
    localStorage.clear();
    saveWorkerSchedule(MACARENA, { periods: [{ from: "2026-08-01", free: true }] });
    const segmento = tramo(MACARENA, MIERCOLES, TURNO.DIURNO);

    assert.equal(hhmm(segmento.start), "08:00");
    assert.equal(hhmm(segmento.end), "17:00");
});
