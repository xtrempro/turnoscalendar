// Dos reglas nuevas de Ajustes (2026-09-30):
//  1. El tope mensual de HHEE diurnas es editable (40 por norma).
//  2. Cubrir las devoluciones de tiempo: el turno del que alguien devuelve
//     horas pide cobertura por esas horas.

import test, { beforeEach } from "node:test";
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
globalThis.window = { dispatchEvent: () => true, addEventListener() {}, removeEventListener() {} };
globalThis.CustomEvent = class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };
const noopEl = { addEventListener() {}, removeEventListener() {}, appendChild() {}, setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {} };
globalThis.document = {
    addEventListener() {}, removeEventListener() {}, visibilityState: "hidden", hidden: true,
    body: noopEl, documentElement: noopEl, createElement: () => ({ ...noopEl }),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => []
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { setJSON } = await import("../js/persistence.js");
const { getReplacementRequestConfig, saveReplacementRequestConfig } = await import("../js/storage.js");
const { exceedsDiurnalOvertimeLimit, getMonthlyDiurnalOvertimeLimit } = await import("../js/replacementCandidates.js");
const { hourReturnWindows, hourReturnPendingCoverage } = await import("../js/hourReturnCoverage.js");
const { saveReplacement } = await import("../js/replacements.js");

beforeEach(() => localStorage.clear());

test("el tope de HHEE diurnas: 40 por omision, editable, y lo usan las sugerencias", () => {
    assert.equal(getReplacementRequestConfig().monthlyDiurnalOvertimeLimit, 40);
    assert.equal(getMonthlyDiurnalOvertimeLimit(), 40);

    saveReplacementRequestConfig({ ...getReplacementRequestConfig(), monthlyDiurnalOvertimeLimit: 30 });
    assert.equal(getMonthlyDiurnalOvertimeLimit(), 30);

    // 25 acumuladas + 8 de este turno: pasa 30, no pasa 40.
    const candidato = { hheeDiurnas: 25, overtimeHours: { d: 8, n: 0 } };

    assert.equal(exceedsDiurnalOvertimeLimit(candidato, new Date(2026, 8, 1), 1, {}), true);
    assert.equal(exceedsDiurnalOvertimeLimit(candidato, new Date(2026, 8, 1), 1, {}, 40), false);

    // Un valor invalido vuelve al de la norma.
    saveReplacementRequestConfig({ ...getReplacementRequestConfig(), monthlyDiurnalOvertimeLimit: -5 });
    assert.equal(getMonthlyDiurnalOvertimeLimit(), 40);
});

test("los tramos que devuelve: entra mas tarde, sale antes o el turno entero", () => {
    const base = { scheduledStart: "08:00", scheduledEnd: "20:00" };

    assert.deepEqual(hourReturnWindows({ ...base, entryTime: "11:00", exitTime: "20:00" }), [
        { from: "08:00", until: "11:00" }
    ]);
    assert.deepEqual(hourReturnWindows({ ...base, entryTime: "08:00", exitTime: "16:00" }), [
        { from: "16:00", until: "20:00" }
    ]);
    assert.deepEqual(hourReturnWindows({ ...base, fullTurn: true }), [
        { from: "08:00", until: "20:00" }
    ]);
});

test("con la opcion apagada una devolucion no pide cobertura; encendida si, hasta que se cubre", () => {
    setJSON("hourReturns_Ana", {
        "2026-8-10": { keyDay: "2026-8-10", scheduledStart: "08:00", scheduledEnd: "20:00", entryTime: "08:00", exitTime: "16:00", hours: 4 }
    });

    assert.equal(hourReturnPendingCoverage("Ana", "2026-8-10"), null);

    saveReplacementRequestConfig({ ...getReplacementRequestConfig(), allowHourReturnCoverage: true });

    const pendiente = hourReturnPendingCoverage("Ana", "2026-8-10");

    assert.deepEqual(pendiente.coverWindow, { from: "16:00", until: "20:00" });
    assert.deepEqual(pendiente.shiftWindow, { from: "08:00", until: "20:00" });

    // Bruno cubre esas horas (el registro que guarda el cuadro de sugerencias).
    saveReplacement({
        worker: "Bruno",
        replaced: "Ana",
        keyDay: "2026-8-10",
        turno: 1,
        coverFrom: "16:00",
        coverUntil: "20:00",
        shiftFrom: "08:00",
        shiftUntil: "20:00"
    });

    assert.equal(hourReturnPendingCoverage("Ana", "2026-8-10"), null);
});
