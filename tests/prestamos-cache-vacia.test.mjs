// Auditoria fase 0 de reemplazos (P2 preexistente) y revision del diseno (P2-1):
// los prestamos de la lista se proyectan SOLO desde la coleccion completa
// confirmada por el servidor. Un snapshot de cache no produce ningun cambio,
// porque cada cambio de la lista se publica a la nube.
import assert from "node:assert/strict";
import test from "node:test";

globalThis.localStorage = {
    values: new Map(),
    get length() { return this.values.size; },
    key(index) { return [...this.values.keys()][index] ?? null; },
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
    setItem(key, value) { this.values.set(key, String(value)); },
    removeItem(key) { this.values.delete(key); },
    clear() { this.values.clear(); }
};

const { planLoanAssignments } = await import("../js/firebaseInterUnitLoans.js");

const manual = { id: "manual-1", worker: "ANA", source: "manual_extra" };
const loan = { id: "interunit_loan-a", interUnitLoanId: "loan-a", source: "inter_unit_loan", worker: "BETO", date: "2026-11-20", turno: "L", canceled: false };
const snapshot = (docs, fromCache) => ({
    docs: docs.map(([id, data]) => ({ id, data: () => data })),
    metadata: { fromCache }
});
const active = (extra = {}) => ({ status: "active", workerName: "BETO", date: "2026-11-20", turnCode: "L", ...extra });

test("una cache vacia no retira prestamos", () => {
    const current = [manual, loan];

    assert.equal(planLoanAssignments(current, snapshot([], true)), current);
});

test("un canceled viejo de cache no borra un prestamo recreado con el mismo id", () => {
    // El servidor permite recrear el prestamo (mismo trabajador y fecha = mismo id).
    const current = [manual, loan];

    assert.equal(planLoanAssignments(current, snapshot([["loan-a", { status: "canceled" }]], true)), current);
});

test("un active viejo de cache no vuelve a poner un prestamo ya retirado", () => {
    const current = [manual];

    assert.equal(planLoanAssignments(current, snapshot([["loan-a", active()]], true)), current);
});

test("sin metadatos se trata como cache: no cambia nada", () => {
    const current = [loan];

    assert.equal(planLoanAssignments(current, { docs: [] }), current);
});

test("el servidor, con la coleccion completa, confirma altas, cambios y bajas", () => {
    assert.deepEqual(planLoanAssignments([manual, loan], snapshot([], false)).map(item => item.id), ["manual-1"]);
    assert.deepEqual(
        planLoanAssignments([manual, loan], snapshot([["loan-a", { status: "canceled" }]], false)).map(item => item.id),
        ["manual-1"]
    );

    const next = planLoanAssignments([manual, loan], snapshot([
        ["loan-a", active({ turnCode: "N" })],
        ["loan-b", active({ workerName: "CARLA" })]
    ], false));

    assert.deepEqual(next.map(item => item.id), ["manual-1", "interunit_loan-a", "interunit_loan-b"]);
    assert.equal(next[1].turno, "N", "se actualiza en su lugar");
});

test("recreado: el servidor lo trae activo de nuevo y vuelve a la lista una sola vez", () => {
    const next = planLoanAssignments([manual], snapshot([["loan-a", active()]], false));

    assert.deepEqual(next.map(item => item.id), ["manual-1", "interunit_loan-a"]);
});

test("los demas reemplazos nunca se tocan", () => {
    const next = planLoanAssignments([manual, loan], snapshot([], false));

    assert.equal(next[0], manual);
});
