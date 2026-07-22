// Un contrato de reemplazo debe heredar el turno base EFECTIVO del trabajador
// reemplazado. Antes se heredaba solo su rotativa CALCULADA, asi que si sus
// turnos venian de baseData_ (turnos base asignados) el reemplazante se quedaba
// sin turnos (o con los turnos equivocados).
import test, { beforeEach } from "node:test";
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

const { setJSON } = await import("../js/persistence.js");
const { addReplacementContract } = await import("../js/contracts.js");
const { getTurnoBase } = await import("../js/turnEngine.js");

const TITULAR = "Titular";
const REEMPLAZO = "Reemplazante";
const KEYS = [1, 2, 3, 4, 5, 6, 7].map(day => `2026-6-${day}`);

function seedProfiles(extra = []) {
    setJSON("profiles", [
        { name: TITULAR, contractType: "Planta", estamento: "Profesional" },
        { name: REEMPLAZO, contractType: "Reemplazo", estamento: "Profesional" },
        ...extra
    ]);
}

function addContract(worker, replaces) {
    addReplacementContract(worker, {
        start: "2026-07-01",
        end: "2026-07-07",
        replaces,
        reason: "Licencia",
        leaveRef: `lm-${worker}`,
        rotationMode: "inherit"
    });
}

function turnos(profile) {
    return KEYS.map(key => getTurnoBase(profile, key));
}

beforeEach(() => {
    globalThis.localStorage.clear();
});

test("hereda los turnos de una rotativa calculada", () => {
    seedProfiles();
    setJSON("rotativa_" + TITULAR, {
        type: "4turno",
        start: "2026-07-01",
        firstTurn: "larga"
    });
    addContract(REEMPLAZO, TITULAR);

    assert.deepEqual(turnos(REEMPLAZO), turnos(TITULAR));
    // Y no queda todo en libre.
    assert.ok(turnos(REEMPLAZO).some(turno => turno !== 0));
});

test("hereda los turnos base asignados (baseData_), no solo la rotativa", () => {
    seedProfiles();
    setJSON("rotativa_" + TITULAR, {
        type: "4turno",
        start: "2026-07-01",
        firstTurn: "larga"
    });
    // Turnos base asignados que sobrescriben la rotativa del titular.
    setJSON("baseData_" + TITULAR, Object.fromEntries(
        KEYS.map(key => [key, 2])
    ));
    addContract(REEMPLAZO, TITULAR);

    assert.deepEqual(turnos(TITULAR), [2, 2, 2, 2, 2, 2, 2]);
    assert.deepEqual(turnos(REEMPLAZO), turnos(TITULAR));
});

test("una cadena de reemplazos no entra en recursion infinita", () => {
    const SEGUNDO = "SegundoReemplazo";

    seedProfiles([
        { name: SEGUNDO, contractType: "Reemplazo", estamento: "Profesional" }
    ]);
    setJSON("rotativa_" + TITULAR, {
        type: "4turno",
        start: "2026-07-01",
        firstTurn: "larga"
    });
    addContract(REEMPLAZO, TITULAR);
    addContract(SEGUNDO, REEMPLAZO);

    assert.deepEqual(turnos(SEGUNDO), turnos(TITULAR));
});

test("un contrato en modo libre no hereda turnos", () => {
    seedProfiles();
    setJSON("rotativa_" + TITULAR, {
        type: "4turno",
        start: "2026-07-01",
        firstTurn: "larga"
    });
    addReplacementContract(REEMPLAZO, {
        start: "2026-07-01",
        end: "2026-07-07",
        replaces: TITULAR,
        reason: "Licencia",
        leaveRef: "lm-free",
        rotationMode: "free"
    });

    assert.deepEqual(turnos(REEMPLAZO), [0, 0, 0, 0, 0, 0, 0]);
});
