// Widget Kanban en Inicio: el mismo tablero del menu, comprimido, y al
// presionarlo se abre el menu Kanban.
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

const { setJSON } = await import("../js/persistence.js");
const { getKanbanSummary } = await import("../js/kanban.js");
const { HOME_LAYOUT_DEFAULT } = await import("../js/homeLayout.js");
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("el resumen trae las mismas tarjetas del tablero, por columna", () => {
    setJSON("kanban_private_cards_workspace_local_local_user", [
        { id: "a", title: "Pedir insumos", status: "pending", color: "cyan", updatedAt: "2026-11-20T12:00:00Z" },
        { id: "b", title: "Revisar contrato", status: "progress", color: "coral" },
        { id: "c", title: "Informe mensual", status: "done", color: "green" },
        { id: "d", title: "Otra pendiente", status: "pending", color: "yellow" }
    ]);

    const summary = getKanbanSummary();

    assert.deepEqual(summary.map(column => column.label), ["Pendientes", "En Proceso", "Terminadas"]);
    assert.deepEqual(summary[0].cards.map(card => card.title), ["Pedir insumos", "Otra pendiente"]);
    assert.equal(summary[0].cards[0].color, "cyan");
    assert.deepEqual(summary[1].cards.map(card => card.title), ["Revisar contrato"]);
    assert.deepEqual(summary[2].cards.map(card => card.title), ["Informe mensual"]);
});

test("el widget esta en el inicio y al presionarlo abre el menu Kanban", async () => {
    const home = await read("../js/home.js");

    assert.ok(HOME_LAYOUT_DEFAULT.flat().includes("kanban"));
    assert.match(home, /\n    kanban: kanbanWidget\n/);
    // Solo para quien puede ver el menu.
    assert.match(home, /function kanbanWidget\(\) \{\s*if \(!canViewMenu\("kanban"\)\) return "";/);
    assert.match(home, /data-hm="kanban-open" role="button" tabindex="0"/);
    assert.match(home, /\.nav-tile\[data-target="kanbanPanel"\]'\)\?\.click\(\)/);
    // La manija de arrastre no navega.
    assert.match(home, /closest\?\.\("\.hm-drag-handle, \[data-hm-drag-handle\]"\)\) return;/);
});

test("comprimido: dos columnas y Terminadas a lo ancho", async () => {
    const css = await read("../styles.css");

    assert.match(css, /\.hm-kb-board \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    assert.match(css, /\.hm-kb-col--done \{ grid-column: 1 \/ -1; \}/);
});
