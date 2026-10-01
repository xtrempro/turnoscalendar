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

const { TURNO } = await import("../js/constants.js");
const { setJSON } = await import("../js/persistence.js");
const {
    getHonorariaExcessForKey,
    getHonorariaLimitMessage,
    getHonorariaMonthlySummary
} = await import("../js/honoraria.js");

const PROFILE = "Honorarios";
const YEAR = 2026;
const MONTH = 6;
const MONTHLY_LIMIT = 16;

function key(day) {
    return `${YEAR}-${MONTH}-${day}`;
}

function seedHonoraria(turns) {
    localStorage.clear();

    setJSON("profiles", [
        {
            name: PROFILE,
            contractType: "Honorarios",
            honorariaStart: "2026-07-01",
            honorariaEnd: "2026-07-31",
            honorariaHourlyRate: 10000,
            honorariaMaxMonthlyHours: MONTHLY_LIMIT
        }
    ]);
    setJSON("data_" + PROFILE, turns);
}

beforeEach(() => {
    localStorage.clear();
});

test("el tope de honorarios acumula semanas distintas dentro del mes", () => {
    seedHonoraria({
        [key(6)]: TURNO.DIURNO,
        [key(13)]: TURNO.DIURNO
    });

    const summary = getHonorariaMonthlySummary(
        PROFILE,
        YEAR,
        MONTH,
        {}
    );

    assert.equal(getHonorariaExcessForKey(summary, key(6)), null);
    assert.ok(getHonorariaExcessForKey(summary, key(13)));
    assert.match(
        getHonorariaLimitMessage(summary, key(13)),
        /este mes/
    );
    assert.doesNotMatch(getHonorariaLimitMessage(summary, key(13)), /semana/);
});

test("un limitPeriod semanal antiguo tambien se acumula por mes", () => {
    localStorage.clear();
    setJSON("profiles", [
        { name: PROFILE, contractType: "Honorarios" }
    ]);
    setJSON("honorariaContracts_" + PROFILE, [{
        id: "legacy-weekly",
        start: "2026-07-01",
        end: "2026-07-31",
        hourlyRate: 10000,
        maxHours: MONTHLY_LIMIT,
        limitPeriod: "weekly"
    }]);
    setJSON("data_" + PROFILE, {
        [key(6)]: TURNO.DIURNO,
        [key(13)]: TURNO.DIURNO
    });

    const summary = getHonorariaMonthlySummary(
        PROFILE,
        YEAR,
        MONTH,
        {}
    );

    assert.equal(summary.contract.limitPeriod, "monthly");
    assert.equal(getHonorariaExcessForKey(summary, key(6)), null);
    assert.ok(getHonorariaExcessForKey(summary, key(13)));
    assert.ok(summary.overtimeHours > 0);
});

test("los Diurnos realizados suman 9 horas de lunes a jueves y 8 el viernes", () => {
    seedHonoraria({
        [key(6)]: TURNO.DIURNO,
        [key(7)]: TURNO.DIURNO,
        [key(8)]: TURNO.DIURNO,
        [key(9)]: TURNO.DIURNO,
        [key(10)]: TURNO.DIURNO
    });

    const summary = getHonorariaMonthlySummary(
        PROFILE,
        YEAR,
        MONTH,
        {}
    );

    assert.equal(summary.assignedHours, 44);
    assert.equal(Number.isInteger(summary.assignedHours), true);
});

test("una Larga y una Noche realizadas suman 12 horas cada una", () => {
    seedHonoraria({
        [key(11)]: TURNO.LARGA,
        [key(12)]: TURNO.NOCHE
    });

    const summary = getHonorariaMonthlySummary(
        PROFILE,
        YEAR,
        MONTH,
        {}
    );

    assert.equal(summary.assignedHours, 24);
});

test("caso Mathias septiembre: el total correcto es 179 y excede 3 horas", () => {
    localStorage.clear();
    setJSON("profiles", [
        { name: PROFILE, contractType: "Honorarios" }
    ]);
    setJSON("honorariaContracts_" + PROFILE, [{
        id: "septiembre",
        start: "2026-09-01",
        end: "2026-09-30",
        hourlyRate: 3500,
        maxHours: 176,
        limitPeriod: "monthly"
    }]);
    const shifts = {};

    for (const day of [1, 2, 3, 4, 7, 8, 9, 14, 15, 16, 17, 21, 22, 23, 24]) {
        shifts[`2026-8-${day}`] = TURNO.DIURNO;
    }
    shifts["2026-8-6"] = TURNO.LARGA;
    shifts["2026-8-10"] = TURNO.DIURNO_NOCHE;
    shifts["2026-8-18"] = TURNO.NOCHE;
    setJSON("data_" + PROFILE, shifts);

    const summary = getHonorariaMonthlySummary(PROFILE, 2026, 8, {});

    assert.equal(summary.assignedHours, 179);
    assert.equal(summary.overtimeHours, 3);
    assert.match(getHonorariaLimitMessage(summary, "2026-8-24"), /179 horas/);
});
