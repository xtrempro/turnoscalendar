// Calendario Mensual: por dia, quien esta de Dia y de Noche (3er/4to turno),
// con las iniciales de la unidad, en rojo quien cubre, "+XX" el turno de un
// ausente sin cubrir, y un filtro de profesion a la vez.

import test, { beforeEach } from "node:test";
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
    setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    click() {}, remove() {}, dataset: {}
};

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost", href: "http://localhost/" },
    matchMedia: () => ({ matches: false, addEventListener() {} })
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

const { setJSON } = await import("../js/persistence.js");
const mensual = await import("../js/monthlyCalendar.js");
const { saveReplacement } = await import("../js/replacements.js");

// Profesiones reales de la app (storage.js normaliza las que no reconoce).
const TM = "TM Imagenología";
const TENS = "Técnico en Enfermería";

beforeEach(() => {
    localStorage.clear();
    setJSON("profiles", [
        { name: "Juan Zapata", estamento: "Profesional", profession: TM, active: true },
        { name: "Karla Andrea Soto", estamento: "Profesional", profession: TM, active: true },
        { name: "Pablo Ignacio Rojas Aravena", estamento: "Profesional", profession: TM, active: true },
        { name: "Ana Paz Diaz", estamento: "Técnico", profession: TENS, active: true }
    ]);
    // Los cuatro en 4to turno, en grupos distintos.
    [
        ["Juan Zapata", "larga"],
        ["Karla Andrea Soto", "noche"],
        ["Pablo Ignacio Rojas Aravena", "libre"],
        ["Ana Paz Diaz", "larga"]
    ].forEach(([name, firstTurn]) => {
        setJSON("rotativa_" + name, { type: "4turno", start: "2026-10-01", firstTurn });
    });
});

test("iniciales con la regla de la unidad", () => {
    assert.equal(mensual.workerInitials("Juan Zapata"), "JZ");
    assert.equal(mensual.workerInitials("Karla Andrea Soto"), "KA");
    assert.equal(mensual.workerInitials("Pablo Ignacio Rojas Aravena"), "PR");
    assert.equal(mensual.workerInitials("Ana Maria Paz Diaz Soto"), "AD");
    assert.equal(mensual.workerInitials("Ana Maria Paz Diaz Soto Lara"), "AS");
    // Dos con las mismas iniciales: se distinguen con la segunda letra.
    const mapa = mensual.initialsMap(["Juan Vega", "Jose Vera"]);

    assert.notEqual(mapa.get("Juan Vega"), mapa.get("Jose Vera"));
});

test("dia y noche con quien corresponde, solo de la profesion elegida", async () => {
    const mes = await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM);
    const uno = mes.rows[0];

    assert.equal(mes.rows.length, 31);
    assert.deepEqual(uno.slots.day.map(p => p.initials), ["JZ"]);
    assert.deepEqual(uno.slots.night.map(p => p.initials), ["KA"]);
    // El filtro no suma: la TENS no aparece.
    const todos = mes.rows.flatMap(row => [...row.slots.day, ...row.slots.night]);

    assert.ok(todos.every(p => p.name !== "Ana Paz Diaz"));
    assert.deepEqual(
        [...mensual.monthlyGroups(new Date(2026, 9, 1))].sort(),
        [TENS, TM].sort()
    );
});

test("un ausente sin cubrir es un hueco; quien lo cubre va en rojo", async () => {
    // Juan con feriado legal el 1: su Larga queda sin cubrir.
    setJSON("legal_Juan Zapata", { "2026-9-1": true });

    let uno = (await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM)).rows[0];

    assert.deepEqual(uno.slots.day, []);
    assert.deepEqual(uno.gaps.day.map(g => g.initials), ["JZ"]);

    // Pablo (libre ese dia) lo cubre.
    saveReplacement({
        worker: "Pablo Ignacio Rojas Aravena",
        replaced: "Juan Zapata",
        keyDay: "2026-9-1",
        turno: 1
    });

    uno = (await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM)).rows[0];

    assert.deepEqual(uno.gaps.day, []);
    assert.deepEqual(
        uno.slots.day.map(p => [p.initials, p.covering]),
        [["PR", true]]
    );
});

test("el menu existe, va con el permiso de Turnos y filtra de a una profesion", async () => {
    const leer = ruta => readFile(new URL(ruta, import.meta.url), "utf8");
    const [html, navegacion, permisos, fuente] = await Promise.all([
        leer("../index.html"),
        leer("../js/navigation.js"),
        leer("../js/workspacePermissions.js"),
        leer("../js/monthlyCalendar.js")
    ]);

    assert.match(html, /data-target="monthlyCalendarPanel"[\s\S]{0,900}Calendario Mensual/);
    assert.match(navegacion, /targetId === "monthlyCalendarPanel"\) \{\s*return "monthly";/);
    assert.match(permisos, /monthlyCalendarPanel: "turnos"/);
    assert.match(fuente, /if \(!groups\.includes\(ui\.group\)\) ui\.group = groups\[0\] \|\| "";/);
});
