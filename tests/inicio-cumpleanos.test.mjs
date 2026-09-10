// Tarjeta de cumpleaños del mes en el inicio, y aviso en el Resumen rapido
// cuando alguien cumple HOY. La fecha de nacimiento se guarda en dos formatos
// distintos segun cuando se cargo el perfil (YYYY-MM-DD y DD-MM-YYYY), asi que
// se reusa birthDateParts de staffing en vez de escribir una segunda lectura.
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

const { getMonthBirthdays } = await import("../js/home.js");
const { birthDateParts } = await import("../js/staffing.js");

// 19 de agosto de 2026.
const HOY = new Date(2026, 7, 19);

function seed() {
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify([
        // Formato ISO, ya paso.
        { id: "1", name: "Ana Perez", active: true, birthDate: "1990-08-01" },
        // Formato DD-MM-YYYY, es hoy.
        { id: "2", name: "Bruno Soto", active: true, birthDate: "19-08-1997" },
        // Todavia no llega.
        { id: "3", name: "Carla Diaz", active: true, birthDate: "1988-08-25" },
        // Otro mes: no aparece.
        { id: "4", name: "Dora Rojas", active: true, birthDate: "1992-09-03" },
        // Inactiva: no aparece.
        { id: "5", name: "Elena Muro", active: false, birthDate: "1991-08-10" },
        // Sin fecha: no aparece.
        { id: "6", name: "Fabian Vera", active: true, birthDate: "" }
    ]));
}

test("lista solo los cumpleaños del mes, de activos y con fecha", () => {
    seed();

    assert.deepEqual(
        getMonthBirthdays(HOY, HOY).map(item => item.name),
        ["Ana Perez", "Bruno Soto", "Carla Diaz"]
    );
});

test("ordena por dia del mes", () => {
    seed();

    assert.deepEqual(
        getMonthBirthdays(HOY, HOY).map(item => item.day),
        [1, 19, 25]
    );
});

test("marca el de hoy y los que ya pasaron", () => {
    seed();

    const rows = getMonthBirthdays(HOY, HOY);
    const byName = Object.fromEntries(rows.map(row => [row.name, row]));

    assert.equal(byName["Bruno Soto"].isToday, true);
    assert.equal(byName["Ana Perez"].isPast, true);
    assert.equal(byName["Carla Diaz"].isPast, false);
    assert.equal(byName["Carla Diaz"].isToday, false);
});

test("calcula la edad que cumple en ambos formatos de fecha", () => {
    seed();

    const byName = Object.fromEntries(
        getMonthBirthdays(HOY, HOY).map(row => [row.name, row])
    );

    assert.equal(byName["Ana Perez"].turns, 36);
    // DD-MM-YYYY tiene que dar lo mismo que ISO.
    assert.equal(byName["Bruno Soto"].turns, 29);
});

test("un año no anterior al actual no muestra edad", () => {
    // Perfiles cargados con el año en blanco o con el año en curso como relleno:
    // "cumple 0" seria peor que no decir nada, asi que turns queda en 0 y la
    // tarjeta omite la linea.
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify([
        { id: "1", name: "Relleno Actual", active: true, birthDate: "2026-08-05" },
        { id: "2", name: "Futuro Raro", active: true, birthDate: "2030-08-06" }
    ]));

    const rows = getMonthBirthdays(HOY, HOY);

    assert.deepEqual(rows.map(row => row.turns), [0, 0]);
});

test("la tarjeta y el aviso del resumen estan cableados", async () => {
    const home = (await readFile(
        new URL("../js/home.js", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    assert.match(home, /function cumpleanosWidget\(\)/);
    // Es una de las tarjetas del inicio (el orden lo decide cada administrador).
    assert.match(home, /\n    cumpleanos: cumpleanosWidget,\n/);
    assert.match(home, /Cumpleaños de <span data-hm="bday-month">/);
    // Estado vacio propio.
    assert.match(home, /Sin cumpleaños en \$\{esc\(monthName\.toLowerCase\(\)\)\}/);

    // El resumen rapido solo pinta la fila el dia que corresponde.
    assert.match(
        home,
        /const birthdaysToday = getMonthBirthdays\(\)\.filter\(item => item\.isToday\);/
    );
    assert.match(home, /\$\{birthdaysToday\.length\s*\n\s*\?/);
    assert.match(home, /hm-sum--bday/);

    // Flechas de mes y repintado solo de la tarjeta (no de todo el panel).
    assert.match(home, /data-hm="bday-prev"/);
    assert.match(home, /data-hm="bday-next"/);
    assert.match(home, /function reRenderBirthdays\(panel\)/);
    assert.match(
        home,
        /const next = new Date\(birthdayYear, birthdayMonth \+ step, 1\);/
    );
});

test("al navegar a otro mes ningun dia se marca como hoy", () => {
    // El 19 existe en varios meses: sin comparar contra la fecha REAL, navegar a
    // septiembre habria pintado el dia 19 como "Hoy".
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify([
        { id: "1", name: "Ana Agosto", active: true, birthDate: "1990-08-19" },
        { id: "2", name: "Bruno Septiembre", active: true, birthDate: "1990-09-19" }
    ]));

    const agosto = getMonthBirthdays(new Date(2026, 7, 1), HOY);
    const septiembre = getMonthBirthdays(new Date(2026, 8, 1), HOY);

    assert.equal(agosto[0].isToday, true, "en el mes actual si");
    assert.equal(septiembre[0].isToday, false, "en otro mes no");
});

test("los meses ya pasados quedan todos atenuados", () => {
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify([
        { id: "1", name: "Ana Julio", active: true, birthDate: "1990-07-28" }
    ]));

    const julio = getMonthBirthdays(new Date(2026, 6, 1), HOY);
    const septiembre = getMonthBirthdays(new Date(2026, 8, 1), HOY);

    assert.equal(julio[0].isPast, true);
    assert.equal(septiembre.length, 0);

    // Y un año anterior tambien cuenta como pasado.
    const agosto2025 = getMonthBirthdays(new Date(2025, 6, 1), HOY);

    assert.equal(agosto2025[0].isPast, true);
});
