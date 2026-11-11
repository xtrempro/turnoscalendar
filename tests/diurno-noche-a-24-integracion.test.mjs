// Regresiones de integracion de D+N + Larga = 24h (auditoria 11-11-2026,
// reports/auditoria-dn24-2026-11-11.md). Con la suma nueva, dos rutas daban un
// resultado equivocado:
// - Un cambio de turno le entregaba una Larga a un Diurno en D+N: la
//   validacion lo leia como Diurno que se extiende a Larga y no miraba las
//   reglas del 24, pero al aplicarse quedaba en 24h.
// - Un D+N armado con un reemplazo de Noche, al recibir la cobertura de una
//   Larga, quedaba en Diurno: los reemplazos N + L dan 24 y Diurno + 24 caia
//   en "mezcla no valida".
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
globalThis.window = {
    dispatchEvent() {}, addEventListener() {}, removeEventListener() {},
    location: { hostname: "localhost" }
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    getElementById: () => null, querySelector: () => null,
    querySelectorAll: () => [], addEventListener() {},
    body: { dataset: {} }, documentElement: { dataset: {} }
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { setJSON } = await import("../js/persistence.js");
const { TURNO } = await import("../js/constants.js");
const { getSwapDateBlockReason } = await import("../js/swaps.js");
const { getActualState } = await import("../js/replacementCandidates.js");

// Miercoles 11-11-2026 y jueves 12-11-2026.
const DIA = "2026-10-11";
const SIGUIENTE = "2026-10-12";

function sembrar(config = {}, turnoDia = TURNO.DIURNO_NOCHE, replacements = []) {
    localStorage.clear();
    setJSON("profiles", [
        { name: "A", contractType: "Planta", estamento: "Profesional", active: true },
        { name: "B", contractType: "Planta", estamento: "Profesional", active: true }
    ]);
    setJSON("rotativa_A", { type: "4turno", start: "2026-01-05" });
    setJSON("rotativa_B", { type: "diurno", start: "2026-01-05" });
    setJSON("baseData_A", { [DIA]: TURNO.LARGA, [SIGUIENTE]: TURNO.LIBRE });
    setJSON("data_A", { [DIA]: TURNO.LARGA, [SIGUIENTE]: TURNO.LIBRE });
    setJSON("baseData_B", { [DIA]: TURNO.DIURNO, [SIGUIENTE]: TURNO.DIURNO });
    setJSON("data_B", { [DIA]: turnoDia, [SIGUIENTE]: TURNO.DIURNO });
    setJSON("turnChangeConfig", {
        allowSwaps: true,
        allowDifferentTurnTypes: true,
        allowTwentyFourHourShifts: true,
        allowInvertedTwentyFourHourShifts: true,
        allowDiurnoAfterTwentyFour: true,
        limitMonthlySwaps: false,
        ...config
    });
    setJSON("replacements", replacements);
}

const motivo = () =>
    getSwapDateBlockReason({ giver: "A", receiver: "B", keyDay: DIA });

test("cambio de turno: la Larga que deja en 24h a un D+N respeta 'sin turnos 24'", () => {
    sembrar({ allowTwentyFourHourShifts: false });

    assert.match(motivo(), /quedaria con turno 24/);
});

test("cambio de turno: la Larga que deja en 24h a un D+N respeta el Diurno post 24", () => {
    sembrar({ allowDiurnoAfterTwentyFour: false });

    assert.match(motivo(), /pegado a un turno 24/);
});

test("cambio de turno: con todo permitido el D+N si puede recibir la Larga", () => {
    sembrar();

    assert.equal(motivo(), "");
});

test("cambio de turno: un Diurno puro que recibe la Larga sigue sin exigir el 24", () => {
    sembrar({ allowTwentyFourHourShifts: false }, TURNO.DIURNO);

    assert.equal(motivo(), "");
});

test("D+N armado con reemplazo de Noche queda en 24h al cubrir la Larga", () => {
    const noche = {
        id: "noche", worker: "B", date: "2026-11-11", year: 2026, month: 10,
        turno: "N", reason: "Motivo noche", addsShift: true, canceled: false
    };
    const larga = {
        id: "larga", worker: "B", replaced: "A", date: "2026-11-11",
        year: 2026, month: 10, turno: "L", overtimeHours: { d: 3, n: 0 },
        diurnoLongCoverage: true, canceled: false
    };

    sembrar({}, TURNO.DIURNO, [noche]);
    assert.equal(getActualState("B", DIA), TURNO.DIURNO_NOCHE);

    setJSON("replacements", [noche, larga]);
    assert.equal(getActualState("B", DIA), TURNO.TURNO24);
});

// Segunda pasada de la auditoria: los dias VECINOS se leian con
// getSwapTurnState, que reduce un 24h o un D+N sobre base Diurno a Diurno.
for (const [nombre, vecino, turnoVecino] of [
    ["un 24h al dia siguiente", SIGUIENTE, TURNO.TURNO24],
    ["un D+N al dia siguiente", SIGUIENTE, TURNO.DIURNO_NOCHE],
    ["un D+N el dia anterior", "2026-10-10", TURNO.DIURNO_NOCHE]
]) {
    test(`cambio de turno: no deja armar el 24h con ${nombre}`, () => {
        sembrar();
        setJSON("baseData_B", {
            "2026-10-10": TURNO.DIURNO, [DIA]: TURNO.DIURNO, [SIGUIENTE]: TURNO.DIURNO
        });
        setJSON("data_B", {
            "2026-10-10": TURNO.DIURNO,
            [DIA]: TURNO.DIURNO_NOCHE,
            [SIGUIENTE]: TURNO.DIURNO,
            [vecino]: turnoVecino
        });

        assert.match(motivo(), /pegado a un turno 24/);
    });
}
