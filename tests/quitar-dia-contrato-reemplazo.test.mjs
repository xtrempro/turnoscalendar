// Quien cubre por CONTRATO de reemplazo no salia en el detalle del permiso del
// ausente ("Cubre") ni se podia quitar: el contrato hereda los turnos sin dejar
// un registro por dia. Ahora aparece, y "Quitar reemplazo" le quita SOLO ese
// turno (excluye el dia del contrato) y conserva el resto.

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

const { setJSON, getJSON } = await import("../js/persistence.js");
const {
    addReplacementContract,
    excludeReplacementContractDate,
    getInheritedReplacementContractForCoveredShift
} = await import("../js/contracts.js");
const { getTurnoBase } = await import("../js/turnEngine.js");

const TITULAR = "Titular";
const REEMPLAZO = "Reemplazante";
const KEYS = [1, 2, 3, 4, 5, 6, 7].map(day => `2026-6-${day}`);

beforeEach(() => {
    globalThis.localStorage.clear();
    setJSON("profiles", [
        { name: TITULAR, contractType: "Planta", estamento: "Profesional" },
        { name: REEMPLAZO, contractType: "Reemplazo", estamento: "Profesional" }
    ]);
    setJSON("rotativa_" + TITULAR, { type: "4turno", start: "2026-07-01", firstTurn: "larga" });
    addReplacementContract(REEMPLAZO, {
        start: "2026-07-01",
        end: "2026-07-07",
        replaces: TITULAR,
        reason: "Licencia Médica",
        rotationMode: "inherit"
    });
});

test("el detalle encuentra el contrato que cubre el turno del ausente", () => {
    const contrato = getInheritedReplacementContractForCoveredShift(TITULAR, KEYS[0]);

    assert.equal(contrato?.worker, REEMPLAZO);
});

test("quitar un dia deja Libre ese dia al reemplazante y conserva el resto", () => {
    const antes = KEYS.map(key => getTurnoBase(REEMPLAZO, key));
    const contrato = getInheritedReplacementContractForCoveredShift(TITULAR, KEYS[0]);

    assert.equal(excludeReplacementContractDate(contrato, "2026-07-01"), true);

    const despues = KEYS.map(key => getTurnoBase(REEMPLAZO, key));

    assert.notEqual(antes[0], 0, "el primer dia tenia turno");
    assert.equal(despues[0], 0, "ese dia queda Libre");
    assert.deepEqual(despues.slice(1), antes.slice(1), "el resto del contrato sigue igual");
    // Y ese dia ya no cuenta como cubierto por el contrato: vuelve el "!".
    assert.equal(getInheritedReplacementContractForCoveredShift(TITULAR, KEYS[0]), null);
    assert.ok(getInheritedReplacementContractForCoveredShift(TITULAR, KEYS[1]));
});

test("no pierde otros contratos guardados, aunque esten incompletos", () => {
    const guardados = getJSON("replacementContracts_" + REEMPLAZO, []);

    // Uno incompleto (sin ausente): getContractsForProfile lo filtraria.
    setJSON("replacementContracts_" + REEMPLAZO, [
        ...guardados,
        { id: "viejo", start: "2026-01-01", end: "2026-01-05" }
    ]);

    const contrato = getInheritedReplacementContractForCoveredShift(TITULAR, KEYS[2]);

    excludeReplacementContractDate(contrato, "2026-07-03");

    const lista = getJSON("replacementContracts_" + REEMPLAZO, []);

    assert.equal(lista.length, 2);
    assert.ok(lista.some(item => item.id === "viejo"));
    assert.deepEqual(
        lista.find(item => item.replaces === TITULAR).excludedDates,
        ["2026-07-03"]
    );
});

test("el cuadro muestra quien cubre por contrato y lo deja quitar", async () => {
    const calendar = await readFile(new URL("../js/calendar.js", import.meta.url), "utf8");

    assert.match(calendar, /\$\{contractWorker\} \(contrato de reemplazo\)/);
    assert.match(calendar, /coveringReplacements\.length \|\| coveringContract/);
    assert.match(calendar, /excludeReplacementContractDate\(\s*coveringContract,\s*isoFromKeyDay\(keyDay\)\s*\)/);
    assert.match(calendar, /if \(!quitados\.length && !excluido\)/);
});
