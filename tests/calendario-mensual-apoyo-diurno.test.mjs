// Calendario Mensual: un apoyo de Dia con motivo de HHEE puede venir a Larga,
// a Diurno o en un horario personalizado. Se pregunta antes de las sugerencias
// (partiendo del horario mas usado en ese motivo) y los que no son Larga ahora
// SE VEN en su columna (antes el Diurno no aparecia en ninguna).

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
const { addPreassignment } = await import("../js/preassignments.js");
const { TURNO } = await import("../js/constants.js");

const TM = "TM Imagenología";
const PABLO = "Pablo Ignacio Rojas Aravena";
const MOTIVO = "Apoyo Imagenologia -2";

beforeEach(() => {
    localStorage.clear();
    setJSON("profiles", [
        { name: "Juan Zapata", estamento: "Profesional", profession: TM, active: true },
        { name: PABLO, estamento: "Profesional", profession: TM, active: true }
    ]);
    setJSON("rotativa_Juan Zapata", { type: "4turno", start: "2026-10-01", firstTurn: "larga" });
    // Pablo libre el 1 de octubre.
    setJSON(`rotativa_${PABLO}`, { type: "4turno", start: "2026-10-01", firstTurn: "libre" });
});

const record = (date, turno, extra = {}) => ({
    id: `r_${date}_${turno}_${extra.coverFrom || ""}`,
    worker: PABLO,
    date,
    turno,
    reason: MOTIVO,
    source: "rota_gap",
    ...extra
});

test("horario predominante del motivo: el mas usado del mes y los 3 anteriores", () => {
    const month = new Date(2026, 9, 1);

    assert.deepEqual(
        mensual.predominantDaySchedule(MOTIVO, month, { replacements: [], preassignments: [] }),
        { kind: "larga" },
        "sin historia: Larga"
    );

    const replacements = [
        record("2026-08-03", "D", { coverFrom: "10:00", coverUntil: "15:00" }),
        record("2026-09-14", "D", { coverFrom: "10:00", coverUntil: "15:00" }),
        record("2026-10-05", "L"),
        // Otro motivo, una Noche, uno anulado y uno muy antiguo: no cuentan.
        { ...record("2026-10-06", "L"), reason: "Ris Pacs" },
        record("2026-10-07", "N"),
        record("2026-10-08", "L", { canceled: true }),
        record("2026-05-04", "L"),
        record("2026-04-04", "L")
    ];

    assert.deepEqual(
        mensual.predominantDaySchedule(MOTIVO, month, { replacements, preassignments: [] }),
        { kind: "custom", from: "10:00", until: "15:00" }
    );

    // Las preasignaciones tambien cuentan (turno numerico).
    const preassignments = [
        { worker: PABLO, date: "2026-10-09", turno: TURNO.DIURNO, reason: MOTIVO },
        { worker: PABLO, date: "2026-10-10", turno: TURNO.DIURNO, reason: MOTIVO },
        { worker: PABLO, date: "2026-10-11", turno: TURNO.DIURNO, reason: MOTIVO }
    ];

    assert.deepEqual(
        mensual.predominantDaySchedule(MOTIVO, month, { replacements, preassignments }),
        { kind: "diurno" }
    );
});

test("el horario elegido se guarda como Diurno o Larga, con su horario si es personalizado", () => {
    // 2026-10-05 lunes, 2026-10-09 viernes.
    assert.deepEqual(mensual.dayScheduleToShift({ kind: "larga" }, "2026-9-5"), { turno: TURNO.LARGA, window: null });
    assert.deepEqual(mensual.dayScheduleToShift({ kind: "diurno" }, "2026-9-5"), { turno: TURNO.DIURNO, window: null });
    assert.deepEqual(
        mensual.dayScheduleToShift({ kind: "custom", from: "10:00", until: "15:00" }, "2026-9-5"),
        { turno: TURNO.DIURNO, window: { from: "10:00", until: "15:00" } },
        "cabe en el Diurno"
    );
    assert.deepEqual(
        mensual.dayScheduleToShift({ kind: "custom", from: "09:00", until: "19:00" }, "2026-9-5"),
        { turno: TURNO.LARGA, window: { from: "09:00", until: "19:00" } },
        "pasa del Diurno: se apoya en la Larga"
    );
    assert.deepEqual(
        mensual.dayScheduleToShift({ kind: "custom", from: "08:00", until: "17:00" }, "2026-9-9"),
        { turno: TURNO.LARGA, window: { from: "08:00", until: "17:00" } },
        "el viernes el Diurno sale a las 16"
    );
    assert.deepEqual(
        mensual.dayScheduleToShift({ kind: "custom", from: "08:00", until: "20:00" }, "2026-9-5"),
        { turno: TURNO.LARGA, window: null },
        "justo la Larga"
    );
    assert.deepEqual(
        mensual.dayScheduleToShift({ kind: "custom", from: "08:00", until: "16:00" }, "2026-9-9"),
        { turno: TURNO.DIURNO, window: null },
        "justo el Diurno del viernes"
    );
});

test("un Diurno de mas con motivo se ve en la columna del motivo, con una D", async () => {
    saveReplacement({
        worker: PABLO,
        keyDay: "2026-9-1",
        turno: TURNO.DIURNO,
        replaced: "",
        reason: MOTIVO,
        source: "rota_gap"
    });

    const mes = await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM);
    const apoyo = mes.rows[0].extras.day[MOTIVO]?.[0];

    assert.equal(apoyo?.name, PABLO, "antes no aparecia en ninguna columna");
    assert.equal(apoyo.half, "D");
    assert.ok(apoyo.extraId, "se puede arrastrar y quitar");
    assert.ok(!mes.rows[0].slots.day.some(person => person.name === PABLO), "no va con los titulares");
    assert.deepEqual(mes.extraColumns.day, [MOTIVO]);
    assert.deepEqual(mes.rows[0].extras.night, {}, "el Diurno no es de Noche");
});

test("un Diurno escrito en el calendario con su motivo (turno extra manual) tambien se ve", async () => {
    setJSON(`data_${PABLO}`, { "2026-9-1": TURNO.DIURNO });
    saveReplacement({
        worker: PABLO,
        keyDay: "2026-9-1",
        turno: TURNO.DIURNO,
        reason: MOTIVO,
        absenceType: "Motivo manual",
        source: "manual_extra",
        addsShift: false
    });

    const mes = await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM);

    assert.equal(mes.rows[0].extras.day[MOTIVO]?.[0]?.name, PABLO);
    assert.equal(mes.rows[0].extras.day[MOTIVO][0].half, "D");
});

test("un Diurno sin motivo, o el Diurno propio, sigue sin aparecer", async () => {
    setJSON(`data_${PABLO}`, { "2026-9-1": TURNO.DIURNO });

    const mes = await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM);

    assert.ok(!mes.rows[0].slots.day.some(person => person.name === PABLO));
    assert.deepEqual(mes.rows[0].extras.day, {});
});

test("un horario personalizado se ve con su horario bajo las iniciales", async () => {
    saveReplacement({
        worker: PABLO,
        keyDay: "2026-9-1",
        turno: TURNO.DIURNO,
        replaced: "",
        reason: MOTIVO,
        source: "rota_gap",
        coverFrom: "09:30",
        coverUntil: "15:00"
    });

    const mes = await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM);
    const apoyo = mes.rows[0].extras.day[MOTIVO]?.[0];

    assert.equal(apoyo?.half, "9:30–15");
});

test("un Diurno preasignado con motivo tambien va en Dia", async () => {
    addPreassignment({
        worker: PABLO,
        keyDay: "2026-9-1",
        turno: TURNO.DIURNO,
        reason: MOTIVO,
        coverFrom: "10:00",
        coverUntil: "14:00"
    });

    const mes = await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM);
    const apoyo = mes.rows[0].extras.day[MOTIVO]?.[0];

    assert.equal(apoyo?.preassigned, true);
    assert.equal(apoyo.half, "10–14");
});

test("se pregunta el turno solo de Dia, antes de las sugerencias, y el horario viaja hasta el marcaje", async () => {
    const source = await readFile(new URL("../js/monthlyCalendar.js", import.meta.url), "utf8");
    const calendar = await readFile(new URL("../js/calendar.js", import.meta.url), "utf8");
    const add = source.slice(source.indexOf("async function addToColumn("), source.indexOf("async function removeExtra("));

    assert.match(add, /slot === "day"\s*\? await askDaySchedule\(/);
    assert.match(add, /: \{ turno: TURNO\.NOCHE, window: null \}/, "la Noche va directo a 12 horas");
    assert.match(add, /if \(!shift\) return;\s*/);
    assert.ok(add.indexOf("askDaySchedule(") < add.indexOf("openReplacementDialog"));
    assert.match(add, /turno: shift\.turno,\s*window: shift\.window,/);

    // El cuadro de horario: Aceptar y la X, sin "Sin marcaje".
    const dialog = source.slice(source.indexOf("function openAcceptDialog("), source.indexOf("function showScheduleError("));

    assert.match(dialog, /data-mcal-schedule-close/);
    assert.match(dialog, />Aceptar</);
    assert.doesNotMatch(source, /Sin Marcaje/i);

    // calendar.js: el horario se guarda y se escribe en el marcaje.
    assert.match(calendar, /const rotaWindow = rota\?\.window\?\.from && rota\?\.window\?\.until/);
    assert.match(calendar, /const appliedWindow = options\.coverWindow \|\| coverWindow \|\| rotaWindow;/);
    assert.match(calendar, /\? \{ coverFrom: rotaWindow\.from, coverUntil: rotaWindow\.until \}/, "en la preasignacion");
    assert.match(calendar, /writeCoverWindowClockMark\(worker, keyDay, date, presetWindow, holidays\);/, "al confirmar la preasignacion");
});
