// 11-11-2026: el Anexo 2 de quien NO tiene asignacion de turno listaba todos
// los turnos del mes, como el reporte de horas. El Anexo 2 autoriza horas
// extras: con o sin asignacion debe mostrar solo lo que excede el turno base
// de su rotativa, y no nombrar los cambios de turno.
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

const { buildWorkerHheeMonthSummary } = await import("../js/hoursReport.js");
const {
    buildCoverageAuthorizationRow,
    coverageAuthorizationTotals,
    withoutSwapDetail
} = await import("../js/coverageAuthorizationRows.js");
const { getTurnoBase } = await import("../js/turnEngine.js");
const { TURNO } = await import("../js/constants.js");

const NAME = "Camila Prueba";
const PROFILE = { name: NAME, estamento: "Técnico", contractType: "Contrata", active: true };
const MONTH = new Date(2026, 7, 1);
const dayKey = day => `2026-7-${day}`;
let extraDay = 0;

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify([{ id: "p-camila", ...PROFILE }]));
    // 4to turno SIN asignacion: la rotativa igual proyecta sus turnos base.
    localStorage.setItem(`shift_${NAME}`, JSON.stringify(false));
    localStorage.setItem(`rotativa_${NAME}`, JSON.stringify({
        type: "4turno",
        start: "2026-07-01",
        firstTurn: "larga"
    }));

    extraDay = 0;
    for (let day = 3; day <= 28 && !extraDay; day++) {
        if (Number(getTurnoBase(NAME, dayKey(day))) === TURNO.LIBRE) extraDay = day;
    }
    // Una Larga extra en un dia libre de su rotativa.
    localStorage.setItem(`data_${NAME}`, JSON.stringify({ [dayKey(extraDay)]: TURNO.LARGA }));
});

test("sin asignacion, el Anexo 2 lista solo el turno extra sobre la rotativa", async () => {
    assert.ok(extraDay, "la rotativa tiene dias libres");

    const row = await buildCoverageAuthorizationRow(PROFILE, MONTH, { profiles: [PROFILE], replacements: [] });
    const withHours = row.days.filter(day => day.dayHours + day.festiveHours > 0);

    assert.deepEqual(
        withHours.map(day => day.iso),
        [`2026-08-${String(extraDay).padStart(2, "0")}`],
        "solo el dia de la Larga extra"
    );
    assert.equal(coverageAuthorizationTotals(row).day + coverageAuthorizationTotals(row).festive, 12);
});

test("el reporte de horas sigue listando todos sus turnos", async () => {
    const summary = await buildWorkerHheeMonthSummary(PROFILE, MONTH);

    assert.equal(summary.detailScope, "all");
    assert.ok(summary.extraShifts.length > 1, "reporte: todos los turnos del mes");
});

test("el Anexo 2 no nombra los cambios de turno del dia", () => {
    assert.equal(
        withoutSwapDetail("Motivo horas extras: Estación de Trabajo | CCTT Noche con JUAN"),
        "Motivo horas extras: Estación de Trabajo"
    );
    assert.equal(withoutSwapDetail("DDTT Larga con ANA | Reemplaza a BETO por F. Legal"), "Reemplaza a BETO por F. Legal");
    assert.equal(withoutSwapDetail("CCTT Noche con JUAN"), "");
    assert.equal(withoutSwapDetail(undefined), "");
});
