// Al agregar un contrato de reemplazo, su periodo no debe superponerse con otro
// contrato vigente del mismo trabajador (por otro justificativo): empieza justo
// despues del contrato previo y/o termina justo antes del siguiente.
import test from "node:test";
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

const { clampContractRange } = await import("../js/contracts.js");

test("sin contratos existentes deja el rango intacto", () => {
    assert.deepEqual(
        clampContractRange("2026-07-01", "2026-07-06", []),
        { start: "2026-07-01", end: "2026-07-06" }
    );
});

test("un contrato que cubre el inicio empuja el nuevo inicio al dia siguiente", () => {
    const existing = [{ start: "2026-07-01", end: "2026-07-03" }];

    assert.deepEqual(
        clampContractRange("2026-07-01", "2026-07-06", existing),
        { start: "2026-07-04", end: "2026-07-06" }
    );
});

test("un contrato que empieza dentro recorta el final al dia anterior", () => {
    const existing = [{ start: "2026-07-04", end: "2026-07-08" }];

    assert.deepEqual(
        clampContractRange("2026-07-01", "2026-07-06", existing),
        { start: "2026-07-01", end: "2026-07-03" }
    );
});

test("rango totalmente cubierto por otro contrato devuelve null", () => {
    const existing = [{ start: "2026-07-01", end: "2026-07-10" }];

    assert.equal(
        clampContractRange("2026-07-02", "2026-07-05", existing),
        null
    );
});

test("contrato existente sin traslape no modifica el rango", () => {
    const existing = [{ start: "2026-06-01", end: "2026-06-20" }];

    assert.deepEqual(
        clampContractRange("2026-07-10", "2026-07-15", existing),
        { start: "2026-07-10", end: "2026-07-15" }
    );
});

test("recorta contra el previo y el siguiente a la vez", () => {
    const existing = [
        { start: "2026-07-01", end: "2026-07-02" },
        { start: "2026-07-05", end: "2026-07-09" }
    ];

    // Rango pedido 07-01..07-08: el previo empuja el inicio a 07-03 y el
    // siguiente (07-05) recorta el fin a 07-04.
    assert.deepEqual(
        clampContractRange("2026-07-01", "2026-07-08", existing),
        { start: "2026-07-03", end: "2026-07-04" }
    );
});
