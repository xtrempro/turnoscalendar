// Franjas de marcaje en la casilla. Un D+N tiene dos tramos (diurno y noche):
// la salida del Diurno y la entrada de la Noche van en el MEDIO de la casilla.
// Antes solo se miraban la entrada del primero y la salida del ultimo, asi que
// un Diurno que salia antes dentro de un D+N no se veia (las horas si lo
// descontaban) y parecia que agregar la Noche "borraba" el marcaje.

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
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost", href: "http://localhost/" }
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
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { setJSON } = await import("../js/persistence.js");
const { getDayColorGradient } = await import("../js/dayColorBands.js");
const { TURNO } = await import("../js/constants.js");

const NAME = "Nelson";
const KEY = "2026-9-1"; // jueves 1 de octubre de 2026
const DATE = new Date(2026, 9, 1);

// Colores de las bandas, de arriba hacia abajo.
function bands(gradient) {
    return [...String(gradient || "").matchAll(/var\(--([a-z0-9-]+)/g)].map(match => match[1]);
}

function withMark(segments) {
    setJSON(`clockMarks_${NAME}`, { [KEY]: { segments } });
}

beforeEach(() => {
    localStorage.clear();
    setJSON("profiles", [{ name: NAME, estamento: "Técnico", active: true }]);
});

test("D+N con salida temprana del Diurno: franja roja en el medio", () => {
    withMark({ diurno: { exitTime: "16:00" } });

    assert.deepEqual(
        bands(getDayColorGradient(NAME, KEY, TURNO.DIURNO_NOCHE, DATE, {}, null, TURNO.DIURNO)),
        ["turno-color-4", "color-reduction", "turno-color-2-extra"]
    );
});

test("D+N con la Noche corrida: entrada antes en el medio y salida tarde abajo", () => {
    withMark({ noche: { entryTime: "19:30", exitTime: "08:30" } });

    assert.deepEqual(
        bands(getDayColorGradient(NAME, KEY, TURNO.DIURNO_NOCHE, DATE, {}, null, TURNO.DIURNO)),
        ["turno-color-4", "color-extension", "turno-color-2-extra", "color-extension"]
    );
});

test("D+N con las dos modificaciones del medio: las dos franjas, mas angostas", () => {
    withMark({ diurno: { exitTime: "16:00" }, noche: { entryTime: "19:30", exitTime: "08:30" } });

    const gradient = getDayColorGradient(NAME, KEY, TURNO.DIURNO_NOCHE, DATE, {}, null, TURNO.DIURNO);

    assert.deepEqual(bands(gradient), [
        "turno-color-4", "color-reduction", "color-extension", "turno-color-2-extra", "color-extension"
    ]);
    assert.match(gradient, /color-reduction, #dc2626\) 35\.000% 45\.000%/, "10% cada una con mas de dos");
});

test("el Diurno solo sigue con su franja abajo", () => {
    withMark({ diurno: { exitTime: "16:00" } });

    assert.deepEqual(
        bands(getDayColorGradient(NAME, KEY, TURNO.DIURNO, DATE, {}, null, TURNO.DIURNO)),
        ["turno-color-4", "color-reduction"]
    );
});

test("un 24h (un solo tramo para dos colores) sigue con entrada arriba y salida abajo", () => {
    withMark({ turno24: { entryTime: "09:00", exitTime: "09:00" } });

    assert.deepEqual(
        bands(getDayColorGradient(NAME, KEY, TURNO.TURNO24, DATE, {}, null, TURNO.LARGA)),
        ["color-reduction", "turno-color-1", "turno-color-2-extra", "color-extension"]
    );
});
