// Un motivo de HHEE escrito de varias formas es UN motivo: solo cambian
// mayusculas, tildes o espacios ("APOYO IMAGENOLOGIA - 2", "Apoyo
// Imagenología -2"). Se muestra una vez, con su forma mas usada, y al
// escribirlo de nuevo se guarda como el que ya existe.

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

const motives = await import("../js/motives.js");
const { setJSON, getJSON } = await import("../js/persistence.js");
const mensual = await import("../js/monthlyCalendar.js");
const { saveReplacement, setManualExtraReasons } = await import("../js/replacements.js");
const { addPreassignment, getPreassignments } = await import("../js/preassignments.js");

const TM = "TM Imagenología";
const PABLO = "Pablo Ignacio Rojas Aravena";
const JUAN = "Juan Zapata";
const VARIANTES = [
    "APOYO IMAGENOLOGIA - 2",
    "APOYO IMAGENOLOGIA -2",
    "Apoyo Imagenología -2",
    "APOYO IMAGENOLOGÍA -2"
];

beforeEach(() => {
    localStorage.clear();
    setJSON("profiles", [
        { name: JUAN, estamento: "Profesional", profession: TM, active: true },
        { name: PABLO, estamento: "Profesional", profession: TM, active: true }
    ]);
    setJSON(`rotativa_${JUAN}`, { type: "4turno", start: "2026-08-01", firstTurn: "larga" });
    setJSON(`rotativa_${PABLO}`, { type: "4turno", start: "2026-08-01", firstTurn: "libre" });
});

test("las cuatro formas de la captura son la misma clave", () => {
    const keys = new Set(VARIANTES.map(motives.motiveKey));

    assert.equal(keys.size, 1);
    assert.notEqual(motives.motiveKey("Apoyo Imagenología -3"), motives.motiveKey(VARIANTES[0]));
    assert.notEqual(motives.motiveKey("Apoyo TC"), motives.motiveKey("Apoyo TAC"));
});

test("se muestra la forma mas usada; a igual uso, la mejor escrita", () => {
    const canon = motives.buildMotiveCanon([
        "APOYO IMAGENOLOGIA -2",
        "APOYO IMAGENOLOGIA -2",
        "Apoyo Imagenología -2"
    ]);

    assert.equal(motives.canonicalMotive("apoyo imagenologia - 2", canon), "APOYO IMAGENOLOGIA -2");

    const empate = motives.buildMotiveCanon(VARIANTES);

    assert.equal(motives.canonicalMotive(VARIANTES[0], empate), "Apoyo Imagenología -2");
    assert.equal(motives.canonicalMotive("Otro motivo", empate), "Otro motivo");
});

test("lista sin repetidos y los motivos internos de la Brecha no se tocan", () => {
    assert.deepEqual(motives.uniqueMotives(["Calidad", "CALIDAD", " calidad ", "Ris Pacs"]), ["Calidad", "Ris Pacs"]);
    assert.equal(
        motives.motiveToSave("completar rotativa de profesionales del grupo A", [{ source: "rota_gap", reason: "Completar rotativa de profesionales del grupo A" }]),
        "completar rotativa de profesionales del grupo A"
    );
});

test("al guardar un motivo escrito distinto se usa el que ya existe", () => {
    saveReplacement({ worker: PABLO, keyDay: "2026-7-3", turno: 1, reason: "Apoyo Imagenología -2", source: "rota_gap" });
    saveReplacement({ worker: PABLO, keyDay: "2026-7-4", turno: 1, reason: "APOYO IMAGENOLOGIA - 2", source: "rota_gap" });

    assert.equal(getJSON("replacements", []).at(-1).reason, "Apoyo Imagenología -2");

    addPreassignment({ worker: PABLO, keyDay: "2026-7-10", turno: 1, reason: "apoyo imagenologia -2" });
    assert.equal(getPreassignments().at(-1).reason, "Apoyo Imagenología -2");

    // Un reemplazo de un ausente no lleva motivo de HHEE: no se toca.
    saveReplacement({ worker: PABLO, keyDay: "2026-7-11", turno: 1, replaced: JUAN, reason: "x", source: "replacement" });
    assert.equal(getJSON("replacements", []).at(-1).reason, "x");
});

test("renombrar sirve para corregir la escritura: no vuelve a la forma vieja", () => {
    saveReplacement({ id: "a", worker: PABLO, keyDay: "2026-7-3", turno: 1, reason: "APOYO IMAGENOLOGIA -2", source: "rota_gap" });
    saveReplacement({ id: "b", worker: PABLO, keyDay: "2026-7-4", turno: 1, reason: "APOYO IMAGENOLOGIA -2", source: "rota_gap" });

    const updated = setManualExtraReasons(["a", "b"], "Apoyo Imagenología -2");

    assert.deepEqual(updated.map(item => item.reason), ["Apoyo Imagenología -2", "Apoyo Imagenología -2"]);
});

test("Calendario Mensual: una sola columna y una sola entrada en el '+'", async () => {
    // Guardados con distintas formas (como quedaron antes de este cambio).
    setJSON("replacements", [
        { id: "1", worker: PABLO, date: "2026-08-03", turno: "L", reason: "APOYO IMAGENOLOGIA - 2", source: "rota_gap" },
        { id: "2", worker: PABLO, date: "2026-09-03", turno: "L", reason: "Apoyo Imagenología -2", source: "rota_gap" },
        { id: "3", worker: PABLO, date: "2026-09-07", turno: "L", reason: "APOYO IMAGENOLOGÍA -2", source: "rota_gap" },
        { id: "4", worker: PABLO, date: "2026-09-11", turno: "L", reason: "Apoyo Imagenología -2", source: "rota_gap" }
    ]);

    const historia = mensual.extraHistory(2026, 9, TM);

    assert.deepEqual(historia.day.map(item => item.reason), ["Apoyo Imagenología -2"]);
    assert.equal(historia.day[0].months, 2);

    const septiembre = await mensual.buildMonthlyCalendar(new Date(2026, 8, 1), TM);

    assert.deepEqual(septiembre.extraColumns.day, ["Apoyo Imagenología -2"], "antes eran dos columnas");
});
