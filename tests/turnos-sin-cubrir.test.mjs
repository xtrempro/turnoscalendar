// "Turnos sin cubrir" del mes (estadisticas y Dashboard RRHH): ya no se mide
// contra una dotacion minima escrita a mano (Dotacion RRHH, retirada el
// 2026-09-30), sino con los turnos de ausentes que siguen sin cubrir: la misma
// regla del "+XX" del inicio y del Calendario Mensual.

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

const noopEl = {
    addEventListener() {}, removeEventListener() {}, appendChild() {},
    setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    click() {}, remove() {}, dataset: {}
};

globalThis.localStorage = new MemoryStorage();
// Eventos de verdad: un cambio de datos vacia el cache del analisis del mes.
globalThis.window = Object.assign(new EventTarget(), {
    location: { hostname: "localhost", href: "http://localhost/" },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: id => clearTimeout(id),
    requestAnimationFrame: callback => setTimeout(callback, 0)
});
globalThis.document = {
    addEventListener() {}, removeEventListener() {}, visibilityState: "hidden", hidden: true,
    body: noopEl, documentElement: noopEl, createElement: () => ({ ...noopEl }),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => []
};
globalThis.alert = () => {};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { setJSON } = await import("../js/persistence.js");
const { analizarMes, analizarMesCooperative } = await import("../js/staffing.js");
const { saveReplacement } = await import("../js/replacements.js");

const faltan = (mes, dia, tipo) => mes[dia - 1].detalle
    .filter(item => item.tipo === tipo)
    .reduce((total, item) => total + item.cantidad, 0);

beforeEach(() => {
    localStorage.clear();
    setJSON("profiles", [
        { name: "Juan Zapata", estamento: "Profesional", profession: "TM Imagenología", active: true },
        { name: "Karla Soto", estamento: "Profesional", profession: "TM Imagenología", active: true },
        { name: "Pablo Rojas", estamento: "Profesional", profession: "TM Imagenología", active: true }
    ]);
    // 4to turno: Juan Larga el 1, Karla Noche el 1, Pablo libre.
    setJSON("rotativa_Juan Zapata", { type: "4turno", start: "2026-11-01", firstTurn: "larga" });
    setJSON("rotativa_Karla Soto", { type: "4turno", start: "2026-11-01", firstTurn: "noche" });
    setJSON("rotativa_Pablo Rojas", { type: "4turno", start: "2026-11-01", firstTurn: "libre" });
});

test("sin ausencias no hay turnos sin cubrir (ya no hay minimos)", () => {
    const mes = analizarMes(2026, 10, {});

    assert.equal(mes.length, 30);
    assert.ok(mes.every(dia => dia.detalle.length === 0));
});

test("la Larga y la Noche de ausentes cuentan; cubierta deja de contar", async () => {
    setJSON("legal_Juan Zapata", { "2026-10-1": true });
    setJSON("absences_Karla Soto", { "2026-10-1": { type: "license" } });

    let mes = await analizarMesCooperative(2026, 10, {});

    assert.equal(faltan(mes, 1, "faltante"), 1);
    assert.equal(faltan(mes, 1, "noche"), 1);

    // Pablo (libre) cubre la Larga de Juan.
    saveReplacement({ worker: "Pablo Rojas", replaced: "Juan Zapata", keyDay: "2026-10-1", turno: 1 });
    mes = await analizarMesCooperative(2026, 10, {});

    assert.equal(faltan(mes, 1, "faltante"), 0);
    assert.equal(faltan(mes, 1, "noche"), 1);
});
