import assert from "node:assert/strict";
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

const noop = () => {};
const noopEl = {
    addEventListener: noop,
    removeEventListener: noop,
    appendChild: noop,
    setAttribute: noop,
    style: {},
    dataset: {},
    classList: { add: noop, remove: noop, toggle: noop },
    click: noop,
    remove: noop
};

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    localStorage,
    dispatchEvent: () => true,
    addEventListener: noop,
    removeEventListener: noop,
    location: { hostname: "localhost" }
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    addEventListener: noop,
    removeEventListener: noop,
    visibilityState: "hidden",
    hidden: true,
    body: noopEl,
    documentElement: noopEl,
    createElement: () => ({ ...noopEl }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
};
globalThis.alert = noop;

const { calcularHorasMesPerfil } = await import("../js/hoursEngine.js");
const { TURNO } = await import("../js/constants.js");

function seedProfile(name, rotativa, data = {}) {
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify([{
        id: `profile-${name}`,
        name,
        active: true,
        contractType: "Titular"
    }]));
    localStorage.setItem(`rotativa_${name}`, JSON.stringify(rotativa));
    localStorage.setItem(`data_${name}`, JSON.stringify(data));
}

test("un Diurno conserva la base mensual de 8,8 aunque incluya jornada corta", () => {
    const name = "Diurno base";
    seedProfile(name, {
        type: "diurno",
        start: "2026-09-01",
        firstTurn: "larga"
    });
    const holidays = { "2026-8-18": "Independencia Nacional" };
    const stats = calcularHorasMesPerfil(
        name,
        2026,
        8,
        30,
        holidays,
        {},
        {},
        { d: 0, n: 0 }
    );

    // La base contractual conserva 8,8 por dia. El total realizado mantiene el
    // valor historico de HEAD: la jornada corta no lo reduce a 181,5.
    assert.equal(stats.mode, "diurno");
    assert.equal(stats.horasHabiles, 185);
    assert.equal(stats.totalD, 186);
});

test("el modo agregado conserva el valor historico de un Diurno en jornada corta", () => {
    const name = "Mathias agregado";
    const data = { "2026-8-17": TURNO.DIURNO };
    seedProfile(name, {
        type: "4turno",
        // La rotativa comienza despues del mes para aislar el turno realizado.
        start: "2026-10-01",
        firstTurn: "larga"
    }, data);
    localStorage.setItem(
        `baseData_${name}`,
        JSON.stringify({ "2026-8-17": TURNO.LIBRE })
    );

    const stats = calcularHorasMesPerfil(
        name,
        2026,
        8,
        30,
        {},
        data,
        {},
        { d: 0, n: 0 }
    );

    assert.equal(stats.mode, "aggregate");
    assert.equal(stats.totalD, 9);
    assert.equal(stats.totalN, 0);
});
