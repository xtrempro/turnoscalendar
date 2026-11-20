// Quien NO puede cubrir un turno aparece en el cuadro de sugerencias al
// buscarlo por nombre, en rojo y con el motivo. El motivo sale de la MISMA
// funcion que descarta (replacementIneligibleReason): lo que se explica y lo
// que se filtra no pueden separarse.
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
globalThis.window = Object.assign(new EventTarget(), {
    location: { hostname: "localhost", href: "http://localhost/" },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: id => clearTimeout(id),
    requestAnimationFrame: callback => setTimeout(callback, 0)
});
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
const { TURNO } = await import("../js/constants.js");
const {
    buildReplacementCandidates,
    replacementIneligibleReason
} = await import("../js/replacementCandidates.js");
const { workerMonthHTML } = await import("../js/workerMonthCalendar.js");

const DIA = "2026-10-18"; // miercoles 18 de noviembre
const candidato = (currentState, extra = {}) => ({
    profile: { name: "ANA" },
    currentState,
    ...extra
});

test("quien ya tiene D+N no puede recibir un Diurno: ya lo incluye", () => {
    localStorage.clear();
    const motivo = replacementIneligibleReason(candidato(TURNO.DIURNO_NOCHE), DIA, TURNO.DIURNO, {});

    assert.match(motivo, /Ya tiene D\+N ese día, que incluye la Diurno/);
});

test("un Diurno que no puede extenderse no cubre una Larga", () => {
    localStorage.clear();
    const motivo = replacementIneligibleReason(candidato(TURNO.DIURNO), DIA, TURNO.LARGA, {});

    assert.match(motivo, /Está de Diurno ese día/);
});

test("Larga + Noche en una unidad sin 24 horas", () => {
    localStorage.clear();
    const motivo = replacementIneligibleReason(
        candidato(TURNO.LARGA),
        DIA,
        TURNO.NOCHE,
        { allowTwentyFourHourShifts: false }
    );

    assert.match(motivo, /quedaría en 24 h/);
});

test("con un permiso ese dia, el motivo es el permiso", () => {
    localStorage.clear();
    setJSON("admin_ANA", { [DIA]: 1 });

    assert.equal(
        replacementIneligibleReason(candidato(TURNO.LIBRE), DIA, TURNO.NOCHE, {}),
        "Tiene permiso administrativo ese día."
    );
});

test("libre y sin reparos: puede cubrir (sin motivo)", () => {
    localStorage.clear();

    assert.equal(replacementIneligibleReason(candidato(TURNO.LIBRE), DIA, TURNO.NOCHE, {}), "");
});

test("el barrido separa a los aptos de los no aptos, con su motivo", async () => {
    localStorage.clear();
    const perfil = name => ({ name, estamento: "Profesional", profession: "TM Imagenología", active: true });

    setJSON("profiles", [perfil("AUSENTE"), perfil("LIBRE UNO"), perfil("CON PERMISO")]);
    setJSON("admin_CON PERMISO", { [DIA]: 1 });

    const built = await buildReplacementCandidates("AUSENTE", DIA, {
        neededTurn: TURNO.NOCHE,
        runRange: async (from, to, step) => {
            for (let index = from; index <= to; index++) step(index);
            return { completed: true };
        }
    });

    assert.deepEqual(built.candidates.map(item => item.profile.name), ["LIBRE UNO"]);
    assert.deepEqual(
        built.ineligible.map(item => [item.profile.name, item.ineligibleReason]),
        [["CON PERMISO", "Tiene permiso administrativo ese día."]]
    );
});

test("el dia del turno parpadea entre el turno nuevo y el que tiene hoy", () => {
    localStorage.clear();
    const html = workerMonthHTML(
        "ANA",
        new Date(2026, 10, 1),
        [{ sourceKey: DIA, targetKey: DIA, destinationTurn: TURNO.NOCHE }],
        { blink: true }
    );

    assert.match(html, /is-blinking/);
    assert.match(html, /class="mcal-wcal-was"[^>]*><b>18<\/b><small>Libre<\/small>/);
    // Sin `blink`, como siempre.
    assert.doesNotMatch(
        workerMonthHTML("ANA", new Date(2026, 10, 1), [{ sourceKey: DIA, targetKey: DIA, destinationTurn: TURNO.NOCHE }]),
        /is-blinking/
    );
});
