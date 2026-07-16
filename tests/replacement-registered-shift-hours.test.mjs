// Reemplazos: las horas hábiles del mes suman los días hábiles con contrato
// vigente (8,8 por día) Y también los días en que el supervisor registró un
// turno en el calendario aunque no hubiese contrato vigente ese día.
// Escenario del usuario: contrato Lun-Mié (8,8x3); + turno de noche el jueves
// (8,8x4); + turno el miércoles de la semana siguiente (8,8x5).
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(k) { return this.values.has(k) ? this.values.get(k) : null; }
    key(i) { return [...this.values.keys()][i] ?? null; }
    removeItem(k) { this.values.delete(k); }
    setItem(k, v) { this.values.set(k, String(v)); }
}

globalThis.localStorage = new MemoryStorage();

const { setJSON } = await import("../js/persistence.js");
const { calcularHorasMesPerfil } = await import("../js/hoursEngine.js");
const { TURNO } = await import("../js/constants.js");

const PROFILE = "Reemplazante";
const REPLACED = "Titular";
// Julio 2026 (mes 0-indexado = 6). Sin feriados en la ventana usada.
const YEAR = 2026;
const MONTH = 6;
const DAYS = new Date(YEAR, MONTH + 1, 0).getDate();

function iso(day) {
    return `${YEAR}-${String(MONTH + 1).padStart(2, "0")}-` +
        String(day).padStart(2, "0");
}

function dataKey(day) {
    return `${YEAR}-${MONTH}-${day}`;
}

// Primer lunes de julio 2026 tal que quepan Lun..(+9) dentro del mes.
function firstMonday() {
    for (let d = 1; d <= DAYS - 9; d++) {
        if (new Date(YEAR, MONTH, d).getDay() === 1) return d;
    }
    throw new Error("sin lunes disponible");
}

const MON = firstMonday();
const TUE = MON + 1;
const WED = MON + 2;
const THU = MON + 3;         // jueves fuera del contrato
const NEXT_WED = MON + 9;    // miércoles de la semana siguiente

function seedReplacement({ contractEndDay, overrides = {} }) {
    localStorage.clear();

    setJSON("profiles", [
        { name: REPLACED, contractType: "Planta", estamento: "" },
        { name: PROFILE, contractType: "Reemplazo", estamento: "" }
    ]);

    // Contrato vigente Lun..contractEndDay reemplazando al titular.
    setJSON("replacementContracts_" + PROFILE, [
        {
            id: "c1",
            start: iso(MON),
            end: iso(contractEndDay),
            replaces: REPLACED
        }
    ]);

    // Turnos registrados por el supervisor (overrides del calendario).
    setJSON("data_" + PROFILE, overrides);
}

function horasHabiles() {
    const stats = calcularHorasMesPerfil(
        PROFILE,
        YEAR,
        MONTH,
        DAYS,
        {},                       // sin feriados
        localStorage.getItem("data_" + PROFILE)
            ? JSON.parse(localStorage.getItem("data_" + PROFILE))
            : {},
        {},                       // blocked
        { d: 0, n: 0 }            // carry-in
    );
    return stats.horasHabiles;
}

beforeEach(() => {
    delete globalThis.window;
    localStorage.clear();
});

test("solo contrato Lun-Mié => 8,8 x 3", () => {
    seedReplacement({ contractEndDay: WED });
    assert.equal(horasHabiles(), Math.round(8.8 * 3 * 10) / 10);
});

test("contrato Lun-Mié + turno de noche el jueves => 8,8 x 4", () => {
    seedReplacement({
        contractEndDay: WED,
        overrides: { [dataKey(THU)]: TURNO.NOCHE }
    });
    assert.equal(horasHabiles(), Math.round(8.8 * 4 * 10) / 10);
});

test("además un turno el miércoles siguiente => 8,8 x 5", () => {
    seedReplacement({
        contractEndDay: WED,
        overrides: {
            [dataKey(THU)]: TURNO.NOCHE,
            [dataKey(NEXT_WED)]: TURNO.DIURNO
        }
    });
    assert.equal(horasHabiles(), Math.round(8.8 * 5 * 10) / 10);
});

test("un LIBRE registrado fuera del contrato NO suma jornada", () => {
    seedReplacement({
        contractEndDay: WED,
        overrides: { [dataKey(THU)]: TURNO.LIBRE }
    });
    assert.equal(horasHabiles(), Math.round(8.8 * 3 * 10) / 10);
});
