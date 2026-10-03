// Trabajador con asignacion de turno al que se le quitan turnos base y se le
// asignan otros: las horas extras son lo que SOBRA del total respecto de su
// rotativa. Si faltan Noches pero sobran Largas (o al reves), lo que falta en
// una banda descuenta la otra; el mes nunca queda en negativo.
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
    setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} },
    click() {}, remove() {}, dataset: {}
};

globalThis.localStorage = new MemoryStorage();
globalThis.window = { dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, location: { hostname: "localhost" } };
globalThis.CustomEvent = class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    visibilityState: "hidden", hidden: true,
    body: noopEl, documentElement: noopEl,
    createElement: () => ({ ...noopEl }),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => []
};
globalThis.alert = () => {};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { applyMonthlyOvertimeAdjustments, calcularHorasMesPerfil } = await import("../js/hoursEngine.js");
const { TURNO } = await import("../js/constants.js");

const NAME = "Eduardo";
const YEAR = 2026;
const MONTH = 7;
const key = day => `${YEAR}-${MONTH}-${day}`;

test("una banda en deficit descuenta la otra (se compara el total)", () => {
    // Faltan 24 h nocturnas, sobran 48 h diurnas: sobran 24 h en total.
    assert.deepEqual(
        applyMonthlyOvertimeAdjustments({ mode: "assigned", hheeDiurnas: 48, hheeNocturnas: 0, baseShiftRemovals: { d: 0, n: 24 } }),
        { d: 24, n: 0 }
    );
    // Al reves: faltan diurnas, sobran nocturnas.
    assert.deepEqual(
        applyMonthlyOvertimeAdjustments({ mode: "assigned", hheeDiurnas: 0, hheeNocturnas: 30, baseShiftRemovals: { d: 12, n: 0 } }),
        { d: 0, n: 18 }
    );
    // Faltan mas de las que sobran: cero, nunca negativo.
    assert.deepEqual(
        applyMonthlyOvertimeAdjustments({ mode: "assigned", hheeDiurnas: 12, hheeNocturnas: 0, baseShiftRemovals: { d: 0, n: 24 } }),
        { d: 0, n: 0 }
    );
    // Las dos positivas: sin cambios.
    assert.deepEqual(
        applyMonthlyOvertimeAdjustments({ mode: "assigned", hheeDiurnas: 34, hheeNocturnas: 2 }),
        { d: 34, n: 2 }
    );
});

test("motor real: quitan 2 Noches base y hace 3 Largas -> sobra 1 turno (12 h)", async () => {
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify([{ id: "p-edu", name: NAME, estamento: "Técnico", active: true, contractType: "Planta" }]));
    localStorage.setItem(`shift_${NAME}`, JSON.stringify(true));
    // 3er turno desde el 1 de agosto: L L N N libre libre libre (como Eduardo).
    // Base: Noche el 3 y el 4; libres el 5, 6 y 12 (el 7 es Larga base).
    localStorage.setItem(`rotativa_${NAME}`, JSON.stringify({ type: "3turno", start: "2026-08-01", firstTurn: "larga" }));
    // Se quitan las dos Noches y se le asignan tres Largas en sus dias libres.
    const data = {
        [key(3)]: TURNO.LIBRE,
        [key(4)]: TURNO.LIBRE,
        [key(5)]: TURNO.LARGA,
        [key(6)]: TURNO.LARGA,
        [key(12)]: TURNO.LARGA
    };
    localStorage.setItem(`data_${NAME}`, JSON.stringify(data));
    localStorage.setItem(`baseShiftRemovals_${NAME}`, JSON.stringify({
        [key(3)]: { turn: TURNO.NOCHE, removedAt: "2026-08-01T10:00:00Z" },
        [key(4)]: { turn: TURNO.NOCHE, removedAt: "2026-08-01T10:00:00Z" }
    }));

    const stats = calcularHorasMesPerfil(NAME, YEAR, MONTH, 31, {}, data, {}, { d: 0, n: 0 });

    assert.equal(stats.mode, "assigned");
    assert.equal(stats.hheeDiurnas + stats.hheeNocturnas, 12, "3 Largas (36 h) menos 2 Noches base (24 h)");
    assert.ok(stats.hheeDiurnas >= 0 && stats.hheeNocturnas >= 0);
    assert.ok(stats.paymentDiurno >= 0 && stats.paymentNocturno >= 0);
});
