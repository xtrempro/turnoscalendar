// Un turno cubierto por un CONTRATO de reemplazo tambien esta cubierto en el
// inicio.
//
// Hay dos formas de cubrir el turno de un ausente: un reemplazo puntual -que
// deja un registro en `replacements`- y un contrato de reemplazo, donde el
// reemplazante HEREDA los turnos del ausente mientras dura el contrato y no hay
// registro puntual alguno.
//
// El calendario y el timeline miraban las dos; el inicio solo la primera, asi
// que un turno cubierto por contrato se quedaba en "sin cubrir" para siempre:
// no habia accion que lo sacara de ahi, porque no faltaba nada por hacer.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
const { TURNO } = await import("../js/constants.js");
const {
    addReplacementContract,
    getInheritedReplacementContractForCoveredShift
} = await import("../js/contracts.js");

const leer = async name => (await readFile(
    new URL(name, import.meta.url), "utf8"
)).replace(/\r\n/g, "\n");

const home = await leer("../js/home.js");
const calendar = await leer("../js/calendar.js");
const timeline = await leer("../js/timeline.js");

const TITULAR = "Titular";
const REEMPLAZO = "Reemplazante";
// El contrato va del 1 al 7 de julio de 2026.
const DIA_CUBIERTO = "2026-6-3";
const DIA_FUERA = "2026-6-20";

function sembrar() {
    localStorage.clear();
    setJSON("profiles", [
        { name: TITULAR, contractType: "Planta", estamento: "Profesional" },
        { name: REEMPLAZO, contractType: "Reemplazo", estamento: "Profesional" }
    ]);
    setJSON("rotativa_" + TITULAR, {
        type: "4turno",
        start: "2026-07-01",
        firstTurn: "larga"
    });
}

function contratar(rotationMode = "inherit") {
    addReplacementContract(REEMPLAZO, {
        start: "2026-07-01",
        end: "2026-07-07",
        replaces: TITULAR,
        reason: "Licencia",
        leaveRef: "lm-1",
        rotationMode
    });
}

beforeEach(sembrar);

/* =========================================================
   El turno queda cubierto por el contrato
========================================================= */

test("un contrato heredado cubre el turno del ausente", () => {
    contratar();

    const contrato = getInheritedReplacementContractForCoveredShift(
        TITULAR,
        DIA_CUBIERTO
    );

    assert.ok(contrato, "el contrato tiene que cubrir ese dia");
    assert.equal(contrato.worker, REEMPLAZO);
});

test("fuera de las fechas del contrato no cubre nada", () => {
    contratar();

    assert.equal(
        getInheritedReplacementContractForCoveredShift(TITULAR, DIA_FUERA),
        null
    );
});

test("un contrato en modo libre no cubre: no hereda los turnos", () => {
    // En modo libre el reemplazante no toma los turnos del ausente, asi que el
    // turno sigue necesitando cobertura de verdad.
    contratar("free");

    assert.equal(
        getInheritedReplacementContractForCoveredShift(TITULAR, DIA_CUBIERTO),
        null
    );
});

test("si al reemplazante le dejaron ese dia libre, tampoco cubre", () => {
    contratar();
    setJSON(`data_${REEMPLAZO}`, { [DIA_CUBIERTO]: TURNO.LIBRE });

    assert.equal(
        getInheritedReplacementContractForCoveredShift(TITULAR, DIA_CUBIERTO),
        null,
        "sin nadie trabajando ese dia el turno vuelve a estar sin cubrir"
    );
});

/* =========================================================
   Y el inicio lo mira
========================================================= */

test("el inicio considera el contrato al decidir si falta cobertura", () => {
    assert.match(
        home,
        /!getInheritedReplacementContractForCoveredShift\(name, keyDay\) &&/
    );
    assert.match(
        home,
        /import \{\s*\n\s*getInheritedReplacementContractForCoveredShift\s*\n\} from "\.\/contracts\.js";/
    );
});

test("la misma regla vale para los dos recuadros del inicio", () => {
    // "Ausencias del dia" cuenta los sin cubrir y la tarjeta "Cobertura de
    // turnos" lista los de los proximos 14 dias: las dos preguntan por la misma
    // funcion, asi que el arreglo alcanza a ambas.
    assert.match(home, /function isShiftUncovered\(name, keyDay\)/);
    assert.match(home, /if \(isShiftUncovered\(name, keyDay\)\) counts\[cat\]\.uncovered \+= 1;/);
    assert.match(
        home,
        /if \(!isShiftUncovered\(profile\.name, keyDay\)\) continue;/
    );
});

test("las tres superficies deciden lo mismo", () => {
    // Si una sola se olvida del contrato, vuelve a aparecer un turno "sin
    // cubrir" que en las otras dos figura cubierto.
    [
        [home, "el inicio"],
        [calendar, "el calendario"],
        [timeline, "el timeline"]
    ].forEach(([source, nombre]) => {
        assert.match(
            source,
            /getInheritedReplacementContractForCoveredShift|inheritedContractCoverage/,
            `${nombre} tiene que mirar el contrato de reemplazo`
        );
    });
});
