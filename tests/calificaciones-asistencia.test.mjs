// Calificaciones, Comportamiento funcionario (Asistencia y puntualidad): cada
// atraso o salida temprana se copia con su fecha, el turno de ese dia y por
// que estaba (a quien cubria o su motivo de HHEE).

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
    setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    click() {}, remove() {}, dataset: {}
};

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
    location: { hostname: "localhost", href: "http://localhost/" },
    matchMedia: () => ({ matches: false, addEventListener() {} })
};
globalThis.CustomEvent = class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };
globalThis.document = {
    addEventListener() {}, removeEventListener() {}, visibilityState: "hidden", hidden: true,
    body: noopEl, documentElement: noopEl, createElement: () => ({ ...noopEl }),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => []
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { setJSON } = await import("../js/persistence.js");
const { saveReplacement } = await import("../js/replacements.js");
const { attendanceEventLine } = await import("../js/qualifications.js");

test("el atraso se copia con su fecha, su turno y a quien cubria", () => {
    setJSON("profiles", [
        { name: "Ana Soto", estamento: "Profesional", active: true },
        { name: "Juan Perez", estamento: "Profesional", active: true }
    ]);
    setJSON("data_Ana Soto", { "2026-8-12": 1 });
    saveReplacement({ worker: "Ana Soto", replaced: "Juan Perez", keyDay: "2026-8-12", turno: 1 });

    assert.equal(
        attendanceEventLine("Ana Soto", {
            kind: "atraso",
            iso: "2026-09-12",
            detail: "12 min (entró 08:12, le tocaba 08:00)"
        }),
        "12/09/2026, Larga, cubria a Juan Perez: 12 min"
    );
});
