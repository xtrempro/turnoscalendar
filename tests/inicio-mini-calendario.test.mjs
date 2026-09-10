// Mini calendario del inicio: el mes de hoy de un vistazo, con hoy y los
// feriados marcados. Toda la tarjeta abre el calendario de tareas, por la misma
// puerta que la fecha del encabezado.
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

const { buildMiniCalendarCells } = await import("../js/home.js");

const home = (await readFile(new URL("../js/home.js", import.meta.url), "utf8"))
    .replace(/\r\n/g, "\n");

// Septiembre de 2026: el 1 cae martes. Los feriados se indexan como
// "año-mes(0)-dia", igual que en holidays.js.
const SEPTIEMBRE = 8;
const FERIADOS = {
    "2026-8-18": "Independencia Nacional",
    "2026-8-19": "Día de las Glorias del Ejército"
};
const HOY = new Date(2026, SEPTIEMBRE, 10);

function dia(cells, numero) {
    return cells.find(cell => cell && cell.day === numero);
}

test("el dia 1 cae en su columna, con la semana en lunes", () => {
    const cells = buildMiniCalendarCells(2026, SEPTIEMBRE, FERIADOS, HOY);

    // Martes: un solo hueco (el lunes) antes del dia 1.
    assert.equal(cells.filter(cell => cell === null).length, 1);
    assert.equal(cells[1].day, 1);
    assert.equal(cells.filter(Boolean).length, 30);
});

test("marca hoy, y solo hoy", () => {
    const cells = buildMiniCalendarCells(2026, SEPTIEMBRE, FERIADOS, HOY);

    assert.equal(dia(cells, 10).isToday, true);
    assert.equal(cells.filter(cell => cell?.isToday).length, 1);
});

test("marca los feriados con su nombre", () => {
    const cells = buildMiniCalendarCells(2026, SEPTIEMBRE, FERIADOS, HOY);

    assert.equal(dia(cells, 18).holiday, "Independencia Nacional");
    assert.equal(dia(cells, 19).holiday, "Día de las Glorias del Ejército");
    assert.equal(dia(cells, 17).holiday, "");
    assert.equal(cells.filter(cell => cell?.holiday).length, 2);
});

test("un feriado sin nombre igual se marca", () => {
    // Los feriados manuales o de una cache vieja pueden venir como `true`.
    const cells = buildMiniCalendarCells(2026, SEPTIEMBRE, { "2026-8-18": true }, HOY);

    assert.equal(dia(cells, 18).holiday, "Feriado");
});

test("en otro mes no hay dia de hoy", () => {
    const cells = buildMiniCalendarCells(2026, SEPTIEMBRE + 1, {}, HOY);

    assert.equal(cells.some(cell => cell?.isToday), false);
});

test("la tarjeta abre el calendario de tareas", () => {
    // Misma puerta que la fecha del encabezado: el clic y el teclado ya estan
    // cableados para todo lo que lleve data-hm="open-taskcal".
    assert.match(
        home,
        /class="hm-card hm-col-4 hm-minical" data-hm="open-taskcal" role="button" tabindex="0"/
    );
    assert.match(home, /panel\.querySelectorAll\('\[data-hm="open-taskcal"\]'\)/);
});

test("va en la columna del turno, debajo del resumen rapido", () => {
    assert.match(home, /\$\{resumenWidget\(\)\}\s*\n\s*\$\{miniCalendarWidget\(\)\}/);
});

test("cuando llegan los feriados, el mini calendario se repinta", () => {
    // Sin esto, el primer inicio del año mostraria el mes sin feriados hasta el
    // siguiente repintado.
    assert.match(
        home,
        /void ensureHolidaysLoaded\(year, \(\) => \{[\s\S]{0,320}reRenderMiniCalendar\(panel\);/
    );
});
