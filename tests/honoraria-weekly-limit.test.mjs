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
