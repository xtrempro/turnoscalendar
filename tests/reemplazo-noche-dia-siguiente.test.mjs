// Al cubrir una noche, un candidato que al dia siguiente entra por la mañana
// encadena la jornada sin dormir (la noche termina 08:00 y el turno siguiente
// parte 08:00). No se bloquea -a veces es la unica opcion- pero la tarjeta de
// sugerencias tiene que advertirlo antes de asignar.
import test from "node:test";
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

// El motor de candidatos se movio a js/replacementCandidates.js: lo comparten
// el navegador y la Cloud Function que hace avanzar la cobertura automatica.
const { nextDayMorningShiftAfterNight } =
    await import("../js/replacementCandidates.js");
const { TURNO } = await import("../js/constants.js");

const NAME = "Candidato";
const DAY = "2026-7-10";
const NEXT = "2026-7-11";

function seed(nextDayTurn) {
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify([{
        id: "p-c",
        name: NAME,
        estamento: "Profesional",
        profession: "TM Imagenología",
        active: true
    }]));
    localStorage.setItem(`baseData_${NAME}`, JSON.stringify({
        [DAY]: TURNO.LIBRE,
        [NEXT]: nextDayTurn
    }));
    localStorage.setItem(`data_${NAME}`, JSON.stringify({
        [DAY]: TURNO.LIBRE,
        [NEXT]: nextDayTurn
    }));
}

function shiftAfterNight(nextDayTurn, neededTurn = TURNO.NOCHE) {
    seed(nextDayTurn);

    return nextDayMorningShiftAfterNight(NAME, DAY, neededTurn);
}

test("advierte cuando al dia siguiente hay Larga", () => {
    assert.equal(shiftAfterNight(TURNO.LARGA), TURNO.LARGA);
});

test("advierte cuando al dia siguiente hay Diurno", () => {
    assert.equal(shiftAfterNight(TURNO.DIURNO), TURNO.DIURNO);
});

test("no advierte si el dia siguiente esta libre", () => {
    assert.equal(shiftAfterNight(TURNO.LIBRE), TURNO.LIBRE);
});

test("no advierte si al dia siguiente hay otra Noche", () => {
    // Entra a las 20:00: alcanza a dormir.
    assert.equal(shiftAfterNight(TURNO.NOCHE), TURNO.LIBRE);
});

test("no advierte con media tarde: entra a las 14:00", () => {
    assert.equal(shiftAfterNight(TURNO.MEDIA_TARDE), TURNO.LIBRE);
});

test("solo aplica cuando lo que se cubre incluye noche", () => {
    // Cubrir una Larga y tener Larga al dia siguiente no encadena nada.
    assert.equal(shiftAfterNight(TURNO.LARGA, TURNO.LARGA), TURNO.LIBRE);
    assert.equal(shiftAfterNight(TURNO.LARGA, TURNO.DIURNO), TURNO.LIBRE);
    // Un 24 o un Turno 18 tambien terminan de madrugada.
    assert.equal(shiftAfterNight(TURNO.LARGA, TURNO.TURNO24), TURNO.LARGA);
    assert.equal(shiftAfterNight(TURNO.LARGA, TURNO.TURNO18), TURNO.LARGA);
});

test("sin perfil ni fecha no revienta", () => {
    assert.equal(nextDayMorningShiftAfterNight("", DAY, TURNO.NOCHE), TURNO.LIBRE);
    assert.equal(nextDayMorningShiftAfterNight(NAME, "", TURNO.NOCHE), TURNO.LIBRE);
});

test("la tarjeta pinta el aviso y el fondo de advertencia", async () => {
    const calendar = (await readFile(
        new URL("../js/calendar.js", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    // El aviso va pegado al estado ("Segundo libre", "Diurno"), no en otra linea.
    assert.match(
        calendar,
        /replacement-candidate-state">\n\s*\$\{escapeHTML\(candidateStateLabel[\s\S]{0,200}?replacement-candidate-next-shift/
    );
    assert.match(calendar, /Al día siguiente tiene turno \$\{turnoReplacementLabel\(turn\)\}\./);
    // Y en TODAS las tarjetas, que hoy son tres: sugerencia directa, modo
    // solicitud y reparto del turno entre dos. El numero es un sustituto de
    // "todas": al agregar una cuarta forma de listar candidatos, el aviso tiene
    // que ir tambien ahi y este conteo es lo que lo recuerda.
    assert.equal(
        calendar.split("replacement-candidate--next-day-shift").length - 1,
        3
    );
    assert.equal(
        calendar.split("replacement-candidate-next-shift\">").length - 1,
        3
    );
});
