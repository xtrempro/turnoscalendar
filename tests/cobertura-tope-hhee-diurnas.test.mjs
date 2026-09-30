// La cobertura automatica no le ofrece un turno a quien superaria las 40 horas
// extras DIURNAS del mes si lo acepta: seria pedirle que acepte algo que
// despues no se le puede pagar.
//
// El caso del usuario: un turno que suma 10 h diurnas y 2 nocturnas.
//   - Trabajador A lleva 30 diurnas y 50 nocturnas -> quedaria en 40. Le llega.
//   - Trabajador B lleva 32 diurnas y 25 nocturnas -> quedaria en 42. No le
//     llega, aunque tenga MENOS nocturnas acumuladas que A.
//
// Las nocturnas no entran en el tope: el filtro mira solo la columna diurna.
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
    location: { hostname: "localhost" },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
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
const {
    MAX_MONTHLY_DIURNAL_OVERTIME,
    coverageOvertimeHours,
    exceedsDiurnalOvertimeLimit
} = await import("../js/replacementCandidates.js");
const { TURNO } = await import("../js/constants.js");

const calendar = (await readFile(
    new URL("../js/replacementCandidates.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");
const home = (await readFile(
    new URL("../js/home.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");
// El reparto de las etapas (y con el, el filtro del tope) es puro y vive
// aparte: lo comparten el navegador y la Cloud Function.
const autoCoverage = (await readFile(
    new URL("../js/autoCoveragePlan.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

// Lunes 24 de agosto de 2026, dia habil.
const HABIL = new Date(2026, 7, 24);

const candidato = (hheeDiurnas, hheeNocturnas, overtimeHours = null) => ({
    profile: { name: "X" },
    hheeDiurnas,
    hheeNocturnas,
    overtimeHours
});

test("el tope es de 40 horas extras diurnas", () => {
    assert.equal(MAX_MONTHLY_DIURNAL_OVERTIME, 40);
});

test("el caso del ejemplo: pasa A, no pasa B", () => {
    // Turno que suma 10 diurnas y 2 nocturnas.
    const turno = { d: 10, n: 2 };
    const A = candidato(30, 50, turno);
    const B = candidato(32, 25, turno);

    assert.equal(
        exceedsDiurnalOvertimeLimit(A, HABIL, TURNO.NOCHE, {}),
        false,
        "A queda justo en 40"
    );
    assert.equal(
        exceedsDiurnalOvertimeLimit(B, HABIL, TURNO.NOCHE, {}),
        true,
        "B quedaria en 42"
    );
});

test("quedar EXACTAMENTE en 40 esta permitido", () => {
    // El limite es "superar", no "alcanzar".
    const justo = candidato(35, 0, { d: 5, n: 0 });
    const unPoquitoMas = candidato(35, 0, { d: 5.5, n: 0 });

    assert.equal(exceedsDiurnalOvertimeLimit(justo, HABIL, TURNO.NOCHE, {}), false);
    assert.equal(exceedsDiurnalOvertimeLimit(unPoquitoMas, HABIL, TURNO.NOCHE, {}), true);
});

test("las nocturnas no cuentan para el tope", () => {
    // Un trabajador con 200 nocturnas acumuladas sigue siendo elegible si sus
    // diurnas caben.
    const muchasNocturnas = candidato(2, 200, { d: 3, n: 12 });

    assert.equal(
        exceedsDiurnalOvertimeLimit(muchasNocturnas, HABIL, TURNO.NOCHE, {}),
        false
    );
});

test("sin horas parciales se usa el turno completo", () => {
    // overtimeHours solo viene en las coberturas parciales (capacitacion,
    // diurno cubriendo larga, media tarde). Para el resto, el turno entero es
    // hora extra.
    const sinParcial = candidato(0, 0);
    const larga = coverageOvertimeHours(sinParcial, HABIL, TURNO.LARGA, {});

    // Turno Larga en dia habil: 12 diurnas.
    assert.equal(larga.d, 12);
    assert.equal(larga.n, 0);
    // Con 30 acumuladas, 12 mas se pasa de 40.
    assert.equal(
        exceedsDiurnalOvertimeLimit(candidato(30, 0), HABIL, TURNO.LARGA, {}),
        true
    );
    assert.equal(
        exceedsDiurnalOvertimeLimit(candidato(28, 0), HABIL, TURNO.LARGA, {}),
        false
    );
});

test("una cobertura parcial usa SUS horas, no las del turno", () => {
    // Un diurno que cubre una larga suma 3 h (4 los viernes), no las 12 del
    // turno completo.
    const parcial = candidato(38, 0, { d: 3, n: 0 });

    assert.deepEqual(
        coverageOvertimeHours(parcial, HABIL, TURNO.LARGA, {}),
        { d: 3, n: 0 }
    );
    // 38 + 3 = 41: se pasa igual, pero por 3 y no por 12.
    assert.equal(exceedsDiurnalOvertimeLimit(parcial, HABIL, TURNO.LARGA, {}), true);
    assert.equal(
        exceedsDiurnalOvertimeLimit(candidato(37, 0, { d: 3, n: 0 }), HABIL, TURNO.LARGA, {}),
        false
    );
});

test("una noche de dia habil si gasta cupo diurno", () => {
    // No es toda nocturna: el motor reparte la noche del lunes habil en 2 h
    // diurnas y 10 nocturnas. El tope tiene que contar esas 2, no cero.
    const noche = coverageOvertimeHours(candidato(0, 0), HABIL, TURNO.NOCHE, {});

    assert.deepEqual(noche, { d: 2, n: 10 });
    assert.equal(
        exceedsDiurnalOvertimeLimit(candidato(39, 0), HABIL, TURNO.NOCHE, {}),
        true,
        "39 + 2 = 41"
    );
    assert.equal(
        exceedsDiurnalOvertimeLimit(candidato(38, 0), HABIL, TURNO.NOCHE, {}),
        false,
        "38 + 2 = 40, justo en el tope"
    );
});

test("una noche de sabado es toda nocturna y no gasta cupo", () => {
    // Sabado 22 de agosto de 2026: el dia entero cuenta como nocturno.
    const SABADO = new Date(2026, 7, 22);
    const noche = coverageOvertimeHours(candidato(0, 0), SABADO, TURNO.NOCHE, {});

    assert.deepEqual(noche, { d: 0, n: 12 });
    // Aunque venga con 39 diurnas acumuladas, esta noche no lo pasa del tope.
    assert.equal(
        exceedsDiurnalOvertimeLimit(candidato(39, 0), SABADO, TURNO.NOCHE, {}),
        false
    );
});

test("el filtro corre en la cobertura automatica", () => {
    // El calculo sigue en calendar.js, donde cada candidato se arma con el mes
    // DEL TURNO a cubrir.
    assert.match(
        calendar,
        /exceedsDiurnalLimit: exceedsDiurnalOvertimeLimit\(/
    );
    // Y la campaña por etapas lo aplica en TODAS las etapas, incluida la
    // masiva: es la unica regla que la solicitud masiva no levanta.
    assert.match(autoCoverage, /!candidate\.exceedsDiurnalLimit/);
    assert.match(
        autoCoverage,
        /if \(step\?\.kind === "mass"\) return base;/
    );
    // El supervisor tiene que poder saber cuantos quedaron fuera por el tope.
    assert.match(autoCoverage, /const overLimit = \(candidates \|\| \[\]\)\.filter/);
});

test("el supervisor se entera de por que no les llego", () => {
    // "Nadie puede cubrir" y "todos pasarian el tope" se resuelven distinto:
    // el segundo se arregla repartiendo el turno, no buscando mas gente.
    // El tope es el de la unidad (Ajustes; 40 por norma), no un 40 fijo.
    assert.match(home, /superarían las \$\{getReplacementRequestConfig\(\)\.monthlyDiurnalOvertimeLimit\} horas extras diurnas del mes/);
});
