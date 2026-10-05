// Unidad de practica: datos ficticios que dejan cosas por hacer en el mes en
// curso (ausencias sin cubrir, cupos de la Brecha, horas extras con motivo), y
// que se cargan UNA vez con las funciones de la app.

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
    setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    click() {}, remove() {}, dataset: {}
};

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    setTimeout: () => 0,
    clearTimeout() {},
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost", href: "http://localhost/" }
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
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const practice = await import("../js/practiceUnit.js");
const seed = await import("../js/practiceSeed.js");
const mensual = await import("../js/monthlyCalendar.js");
const { calcularHorasMesPerfil } = await import("../js/hoursEngine.js");
const { fetchHolidays } = await import("../js/holidays.js");

const TODAY = new Date(2026, 9, 5);
const WORKSPACE = { id: "practice_sup1", practice: true };

beforeEach(() => localStorage.clear());

test("son ~28 trabajadores ficticios, con RUT valido y correos que no existen", () => {
    const profiles = seed.practiceProfiles();

    assert.equal(profiles.length, 28);
    assert.equal(new Set(profiles.map(item => item.name)).size, 28, "nombres unicos");
    assert.ok(profiles.every(item => item.email.endsWith("@ejemplo.invalid")));
    assert.ok(profiles.every(item => /^\d{2}\.\d{3}\.\d{3}-[\dK]$/.test(item.rut)));
    assert.ok(profiles.every(item => item.practice === true));
});

test("se llena una sola vez, despues de hidratar, y deja cosas por hacer en el mes", async () => {
    assert.equal(practice.seedPracticeUnitIfEmpty(WORKSPACE, { today: TODAY }), true);
    assert.equal(practice.seedPracticeUnitIfEmpty(WORKSPACE, { today: TODAY }), false, "la segunda vez no toca nada");
    assert.equal(practice.seedPracticeUnitIfEmpty({ id: "real1" }, { today: TODAY }), false, "nunca en una unidad real");

    await fetchHolidays(2026);

    const month = new Date(2026, 9, 1);
    const enfermeria = await mensual.buildMonthlyCalendar(month, "Enfermería");
    const tens = await mensual.buildMonthlyCalendar(month, "Técnico en Enfermería");
    const count = (model, field) => model.rows.reduce((sum, row) => sum + row[field].day.length + row[field].night.length, 0);

    assert.ok(count(enfermeria, "gaps") > 0, "la licencia deja turnos sin cubrir");
    assert.ok(count(tens, "gaps") > 0, "el feriado legal tambien");
    assert.ok(count(tens, "cupos") > 0, "el grupo corto de tecnicos da cupos en la Brecha");
    assert.deepEqual(enfermeria.extraColumns.day, ["Apoyo Urgencia"], "horas extras con motivo");

    const replacements = JSON.parse(localStorage.getItem("replacements") || "[]");

    assert.ok(replacements.some(item => item.source === "replacement" && item.replaced), "hay reemplazos hechos");
});

test("el motor de horas calcula a todos sin errores", async () => {
    practice.seedPracticeUnitIfEmpty(WORKSPACE, { today: TODAY });

    const holidays = await fetchHolidays(2026);

    for (const profile of seed.practiceProfiles()) {
        const stats = calcularHorasMesPerfil(profile.name, 2026, 9, 31, holidays, JSON.parse(localStorage.getItem(`data_${profile.name}`) || "{}"), {}, { d: 0, n: 0 });

        assert.ok(Number.isFinite(stats.totalD), profile.name);
    }
});

test("las fechas siguen al dia de hoy: otro mes, otra vez cosas por hacer", () => {
    const march = seed.buildPracticeBaseState({ today: new Date(2027, 2, 10) });
    const licencia = JSON.parse(march[`absences_${seed.practiceProfiles()[0].name}`]);

    assert.ok(Object.keys(licencia).every(key => key.startsWith("2027-2-")), "licencia en marzo de 2027");
    assert.match(march[`rotativa_${seed.practiceProfiles()[0].name}`], /"start":"2027-01-01"/);
});

test("solo la piden supervisores/administradores de una unidad real, una vez", async () => {
    const calls = [];
    const call = async name => { calls.push(name); return { workspaceId: "practice_sup1", created: true }; };

    assert.equal(await practice.ensurePracticeUnit([], call), null, "sin unidades (un trabajador de la PWA)");
    assert.equal(await practice.ensurePracticeUnit([{ id: "practice_sup1", practice: true }], call), null);
    assert.equal(await practice.ensurePracticeUnit([{ id: "real1" }, { id: "practice_sup1" }], call), null, "ya la tiene");
    assert.deepEqual(await practice.ensurePracticeUnit([{ id: "real1" }], call), { workspaceId: "practice_sup1", created: true });
    assert.deepEqual(calls, ["ensurePracticeWorkspace"]);
});

test("lo que sale hacia afuera se bloquea solo en la unidad de practica", () => {
    assert.match(practice.practiceBlockReason(WORKSPACE, "invitar trabajadores a la app"), /unidad de práctica/);
    assert.equal(practice.practiceBlockReason({ id: "real1" }, "invitar"), "");
    assert.equal(practice.isPracticeWorkspace({ id: "practice_x" }), true, "tambien por el id");
});
