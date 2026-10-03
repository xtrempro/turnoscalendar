// Cubrir un cupo de la Brecha RRHH: el supervisor puede dejar un comentario
// (con sus propios motivos predefinidos, no los de horas extras) que queda en el reporte
// del trabajador. El motivo interno ("Completar rotativa de ...") no cambia:
// es el que deja a la persona con los TITULARES, nunca en una columna de
// motivo de HHEE.

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

const { setJSON, getJSON } = await import("../js/persistence.js");
const mensual = await import("../js/monthlyCalendar.js");
const { saveReplacement, isRotaGapMotive } = await import("../js/replacements.js");
const { addPreassignment, getPreassignments } = await import("../js/preassignments.js");
const { withCupoComment } = await import("../js/hoursReport.js");

const TM = "TM Imagenología";
const MOTIVE = "Completar rotativa de profesionales del grupo A";
const COMMENT = "Campana de Invierno";

beforeEach(() => {
    localStorage.clear();
    setJSON("profiles", [
        { name: "Juan Zapata", estamento: "Profesional", profession: TM, active: true },
        { name: "Pablo Ignacio Rojas Aravena", estamento: "Profesional", profession: TM, active: true }
    ]);
    setJSON("rotativa_Juan Zapata", { type: "4turno", start: "2026-10-01", firstTurn: "larga" });
    setJSON("rotativa_Pablo Ignacio Rojas Aravena", { type: "4turno", start: "2026-10-01", firstTurn: "libre" });
});

test("el motivo de un cupo se reconoce igual que en la Brecha (staffing.js)", () => {
    assert.equal(isRotaGapMotive(MOTIVE), true);
    assert.equal(isRotaGapMotive("  completar rotativa de tecnicos del grupo B"), true);
    assert.equal(isRotaGapMotive("Apoyo clinico TC"), false);
    assert.equal(isRotaGapMotive(""), false);
});

test("cubrir un cupo con comentario: queda con los titulares, no en una columna de HHEE", async () => {
    // Pablo libre el 1: cubre el cupo de la Brecha con una Larga.
    saveReplacement({
        worker: "Pablo Ignacio Rojas Aravena",
        keyDay: "2026-9-1",
        turno: 1,
        replaced: "",
        reason: MOTIVE,
        comment: COMMENT,
        source: "rota_gap"
    });

    const stored = getJSON("replacements", []).at(-1);

    assert.equal(stored.reason, MOTIVE, "el motivo interno no cambia");
    assert.equal(stored.comment, COMMENT, "el comentario va aparte");

    const mes = await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM);
    const uno = mes.rows[0];
    const pablo = uno.slots.day.find(person => person.name === "Pablo Ignacio Rojas Aravena");

    assert.ok(pablo, "esta con los titulares");
    assert.equal(pablo.brecha, true);
    assert.equal(pablo.covering, true, "en rojo, como quien completa la rotativa");
    assert.equal(pablo.coverDetail, `${MOTIVE} — ${COMMENT}`);
    assert.deepEqual(mes.extraColumns.day, [], "no abre una columna de motivo");
    assert.deepEqual(uno.extras.day, {});
    assert.ok(!mes.extraColumns.day.includes(COMMENT));
});

test("preasignar un cupo con comentario: el comentario se guarda y sigue con los titulares", async () => {
    addPreassignment({
        worker: "Pablo Ignacio Rojas Aravena",
        replaced: "",
        reason: MOTIVE,
        comment: COMMENT,
        keyDay: "2026-9-1",
        turno: 1
    });

    assert.equal(getPreassignments().at(-1).comment, COMMENT);

    const mes = await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM);
    const pablo = mes.rows[0].slots.day.find(person => person.name === "Pablo Ignacio Rojas Aravena");

    assert.ok(pablo?.preassigned);
    assert.equal(pablo.coverDetail, `${MOTIVE} — ${COMMENT}`);
    assert.deepEqual(mes.extraColumns.day, []);
});

test("confirmar un cupo preasignado (respaldo manual_extra) conserva motivo y comentario y sigue en titulares", async () => {
    // Lo que deja confirmStandalonePreassignment: el turno aplicado y su respaldo.
    setJSON("data_Pablo Ignacio Rojas Aravena", { "2026-9-1": 1 });
    saveReplacement({
        worker: "Pablo Ignacio Rojas Aravena",
        keyDay: "2026-9-1",
        turno: 1,
        reason: MOTIVE,
        comment: COMMENT,
        absenceType: "Motivo manual",
        source: "manual_extra",
        addsShift: false
    });

    const mes = await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM);
    const pablo = mes.rows[0].slots.day.find(person => person.name === "Pablo Ignacio Rojas Aravena");

    assert.ok(pablo?.brecha);
    assert.deepEqual(mes.extraColumns.day, []);
});

test("sin comentario todo sigue como antes", async () => {
    saveReplacement({
        worker: "Pablo Ignacio Rojas Aravena",
        keyDay: "2026-9-1",
        turno: 1,
        reason: MOTIVE,
        source: "rota_gap"
    });

    assert.equal(getJSON("replacements", []).at(-1).comment, "");

    const mes = await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM);
    const pablo = mes.rows[0].slots.day.find(person => person.name === "Pablo Ignacio Rojas Aravena");

    assert.equal(pablo.coverDetail, MOTIVE);
});

test("el comentario queda en el reporte del trabajador, junto al motivo", () => {
    assert.equal(withCupoComment(MOTIVE, { comment: COMMENT }), `${MOTIVE} — ${COMMENT}`);
    assert.equal(withCupoComment(MOTIVE, { comment: "" }), MOTIVE);
    assert.equal(withCupoComment("Sin detalle", {}), "Sin detalle");
});

test("el cuadro se pide solo al cubrir un CUPO, fuera del estado ocupado, y el comentario viaja al guardar", async () => {
    const calendar = await readFile(new URL("../js/calendar.js", import.meta.url), "utf8");
    const report = await readFile(new URL("../js/hoursReport.js", import.meta.url), "utf8");
    const ask = calendar.indexOf("const answer = await openCupoCoverReasonDialog(");
    const busy = calendar.indexOf("await withBusyState(async () => {", ask);

    assert.ok(ask > 0 && busy > ask, "se pregunta antes de entrar al estado ocupado");
    assert.match(calendar.slice(ask - 400, ask), /isRotaGapMotive\(rota\.motive\)/, "solo para cupos de la Brecha, no para columnas de motivo");
    assert.match(calendar.slice(ask, busy), /if \(answer === null\) return;/, "cancelar no cubre nada");
    assert.match(calendar, /comment: rota \? cupoComment : "",\s*keyDay,/, "preasignacion");
    assert.match(calendar, /comment: rota \? cupoComment : "",\s*keyDay,\s*turno: neededTurn,\s*absenceType: rota \? "" : absenceType,\s*source: rota/, "cobertura directa");
    assert.match(calendar, /comment: String\(preassignment\.comment \|\| ""\)\.trim\(\),\s*absenceType: "Motivo manual"/, "al confirmar la preasignacion");
    // Motivos PROPIOS de los cupos (no los de horas extras), con sus dos de
    // partida, editables y compartidos entre supervisores de la unidad.
    const dialog = calendar.slice(
        calendar.indexOf("export function openCupoCoverReasonDialog"),
        calendar.indexOf("function openShiftAttendanceDialog(")
    );

    assert.match(calendar, /CUPO_COVER_REASON_PRESETS_KEY = "cupoCoverReasonPresets"/);
    assert.match(calendar, /"Cubre cupo disponible por renuncia de funcionario",\s*"Cubre cupo disponible por funcionario que se cambia de unidad"/);
    assert.match(dialog, /getCupoCoverReasonPresets\(\)/);
    assert.doesNotMatch(dialog, /getManualExtraReasonPresets/);
    assert.match(dialog, /openManualExtraReasonPresetsDialog\(\s*CUPO_COVER_REASON_PRESETS_KEY,\s*getCupoCoverReasonPresets\(\)\s*\)/);

    const modules = await readFile(new URL("../js/firebaseStateModules.js", import.meta.url), "utf8");

    assert.match(modules, /\["cupoCoverReasonPresets", "turnos"\]/);
    // El reporte del trabajador (detalle del dia y registro de reemplazos).
    assert.equal((report.match(/withCupoComment\(record\.reason/g) || []).length, 2);
});

test("soltar en un +Cupo a alguien de una columna de motivo: pasa a titulares con su comentario", async () => {
    const { setManualExtraReason } = await import("../js/replacements.js");

    saveReplacement({
        worker: "Pablo Ignacio Rojas Aravena",
        keyDay: "2026-9-1",
        turno: 1,
        replaced: "",
        reason: "Apoyo clinico TC",
        source: "rota_gap"
    });

    const antes = await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM);
    const apoyo = antes.rows[0].extras.day["Apoyo clinico TC"]?.[0];

    assert.ok(apoyo?.extraId, "parte en la columna de su motivo");
    assert.ok(setManualExtraReason(apoyo.extraId, MOTIVE, { comment: ` ${COMMENT} ` }));

    const stored = getJSON("replacements", []).at(-1);

    assert.equal(stored.reason, MOTIVE);
    assert.equal(stored.comment, COMMENT);

    const despues = await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM);
    const pablo = despues.rows[0].slots.day.find(person => person.name === "Pablo Ignacio Rojas Aravena");

    assert.equal(pablo?.brecha, true, "con los titulares, como quien cubre el cupo");
    assert.equal(pablo.coverDetail, `${MOTIVE} — ${COMMENT}`);
    assert.deepEqual(despues.rows[0].extras.day, {}, "sale de la columna de motivo");

    // Mover entre columnas de motivo (sin options) no toca el comentario.
    assert.ok(setManualExtraReason(apoyo.extraId, "Ris Pacs"));
    assert.equal(getJSON("replacements", []).at(-1).comment, COMMENT);
});

test("el arrastre a un +Cupo pide el mismo cuadro y cancelar no cambia nada", async () => {
    const source = await readFile(new URL("../js/monthlyCalendar.js", import.meta.url), "utf8");
    const calendar = await readFile(new URL("../js/calendar.js", import.meta.url), "utf8");
    const drop = source.slice(source.indexOf("async function dropOnCupo("), source.indexOf("async function onDrop("));

    assert.match(calendar, /window\.openCupoCoverReasonDialog = options => openCupoCoverReasonDialog\(options\);/);
    assert.match(source, /function cupoDropFor\(event\)[\s\S]*?data-mcal-col="titulares"[\s\S]*?cupos\?\.\[dragState\.slot\]\?\.\[0\]/);
    assert.match(drop, /window\.openCupoCoverReasonDialog\?\.\(/);
    assert.match(drop, /if \(comment === null \|\| comment === undefined\) return;\s*pushHistory\(\);/);
    assert.match(drop, /setManualExtraReason\(moving\.extraId, cupo\.motive, \{ comment \}\)/);
});
