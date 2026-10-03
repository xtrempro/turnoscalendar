// "Ayuda para cubrir": al mover el turno de un titular a un dia donde hay un
// ausente sin cubrir, ese ausente queda CUBIERTO con un respaldo que no agrega
// turno (manual_extra, addsShift false). Es su propio turno movido: no puede
// sumarle horas extras.

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

const { setJSON, getJSON } = await import("../js/persistence.js");
const { saveReplacement } = await import("../js/replacements.js");
const { isShiftUncovered } = await import("../js/home.js");
const { calcularHorasMesPerfil } = await import("../js/hoursEngine.js");
const { TURNO } = await import("../js/constants.js");

const MOVER = "Eduardo Castro";
const ANA = "Ana Diaz";
const SOURCE = "2026-9-1";
const TARGET = "2026-9-4";

test("el turno movido cubre al ausente y no suma horas extras", () => {
    setJSON("profiles", [
        { name: MOVER, estamento: "Técnico", active: true },
        { name: ANA, estamento: "Técnico", active: true }
    ]);
    // 4to turno de los dos; Ana con feriado legal el 4 (su Larga).
    setJSON(`rotativa_${MOVER}`, { type: "4turno", start: "2026-10-01", firstTurn: "larga" });
    setJSON(`rotativa_${ANA}`, { type: "4turno", start: "2026-10-04", firstTurn: "larga" });
    setJSON(`shift_${MOVER}`, true);
    setJSON(`legal_${ANA}`, { [TARGET]: true });

    assert.equal(isShiftUncovered(ANA, TARGET), true, "parte sin cubrir");

    // Lo que deja applyShiftMove: la Larga del 1 pasa al 4 como turno base.
    const data = getJSON(`data_${MOVER}`, {});
    const baseData = getJSON(`baseData_${MOVER}`, {});

    data[SOURCE] = TURNO.LIBRE;
    baseData[SOURCE] = TURNO.LIBRE;
    data[TARGET] = TURNO.LARGA;
    baseData[TARGET] = TURNO.LARGA;
    setJSON(`data_${MOVER}`, data);
    setJSON(`baseData_${MOVER}`, baseData);

    const antes = calcularHorasMesPerfil(MOVER, 2026, 9, 31, {}, data, {}, { d: 0, n: 0 });

    saveReplacement({
        worker: MOVER,
        replaced: ANA,
        keyDay: TARGET,
        turno: TURNO.LARGA,
        source: "manual_extra",
        addsShift: false
    });

    const despues = calcularHorasMesPerfil(MOVER, 2026, 9, 31, {}, data, {}, { d: 0, n: 0 });

    assert.equal(isShiftUncovered(ANA, TARGET), false, "queda cubierta");
    assert.equal(despues.hheeDiurnas, antes.hheeDiurnas, "sin horas extras nuevas");
    assert.equal(despues.hheeNocturnas, antes.hheeNocturnas);
    assert.equal(despues.totalD, antes.totalD, "ni horas trabajadas de mas");
});
