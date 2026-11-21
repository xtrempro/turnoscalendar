// Impresion diaria de la programacion: un dia, hoja carta vertical, tarea a la
// izquierda y asignados a la derecha.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
globalThis.window = Object.assign(new EventTarget(), {
    location: { hostname: "localhost", href: "http://localhost/" },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: id => clearTimeout(id),
    requestAnimationFrame: callback => setTimeout(callback, 0)
});
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

const { dayPrintDocumentHTML, dayPrintTitle } = await import("../js/taskSchedulePreview.js");

const day = (keyDay, weekday, dayNumber) => ({ keyDay, weekday, dayNumber, shortDate: "" });
const week = {
    weekStart: new Date(2026, 10, 16),
    days: [day("2026-10-16", "lunes", 16), day("2026-10-21", "sábado", 21)],
    sections: [{
        label: "Tareas diurnas",
        rows: [
            { title: "RESONADOR", detail: "Colación 12:45 hrs", cells: [{ workers: ["P.ARMIJO", "D.MARINAO"], note: "" }, { workers: ["J.VALENZUELA", "M.MELLA"], note: "", rowSpan: 2 }] },
            { title: "ESCANER", detail: "", cells: [{ workers: [], note: "" }, { workers: [], note: "", covered: true }] }
        ]
    }]
};
const events = {
    label: "Novedades de la semana",
    rows: [
        { title: "AUSENCIAS Y PERMISOS", detail: "", cells: [{ lines: ["A.SALGADO | Licencia Médica"], workers: [] }, { lines: [], workers: [] }] },
        { title: "CUMPLEAÑOS", detail: "", cells: [{ lines: [], workers: [] }, { lines: ["R.REYES"], workers: [] }] }
    ]
};

test("el titulo es la fecha completa del dia", () => {
    assert.equal(dayPrintTitle(week.days[0]), "Lunes, 16 de noviembre de 2026");
});

test("un dia sale vertical, con una columna de tareas y otra de asignados", () => {
    const html = dayPrintDocumentHTML(week, events, 0);

    assert.match(html, /@page \{ size: letter portrait;/);
    assert.match(html, /<th>TAREAS DIURNAS<\/th>\s*<th>Asignados<\/th>/);
    assert.match(html, /RESONADOR[\s\S]*Colación 12:45 hrs[\s\S]*tsp-day-name">P\.ARMIJO<\/span><span class="tsp-day-name">D\.MARINAO/);
    // Solo ese dia: nada del sabado.
    assert.doesNotMatch(html, /J\.VALENZUELA/);
    // Una tarea vacia se dice, no queda en blanco.
    assert.match(html, /ESCANER[\s\S]*Sin asignar/);
    // De las novedades, solo las que tienen algo ESE dia.
    assert.match(html, /A\.SALGADO \| Licencia Médica/);
    assert.doesNotMatch(html, /CUMPLEAÑOS/);
});

test("una casilla unida conserva el rowspan y no repite la lista", () => {
    const html = dayPrintDocumentHTML(week, events, 1);

    assert.match(html, /rowspan="2"[^>]*>[\s\S]*J\.VALENZUELA/);
    assert.equal((html.match(/J\.VALENZUELA/g) || []).length, 1);
    assert.match(html, /CUMPLEAÑOS[\s\S]*R\.REYES/);
    assert.doesNotMatch(html, /A\.SALGADO/);
});

test("el boton Impresion diaria esta junto a Imprimir y abre el menu de dias", async () => {
    const source = await readFile(new URL("../js/taskSchedulePreview.js", import.meta.url), "utf8");

    assert.match(source, /data-preview-print>\$\{PRINT_ICON\}Imprimir<\/button>\s*<span class="tsp-day-print" data-day-print-wrap>/);
    assert.match(source, /Impresión diaria<\/button>/);
    assert.match(source, /¿Qué día imprimir\?/);
    assert.match(source, /printDay\(Number\(option\.dataset\.dayPrint\)\)/);
});
