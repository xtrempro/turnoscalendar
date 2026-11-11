// YESSICA JERIA (rotativa Diurno), 11-11-2026: un dia hace D+N y hay que
// sumarle la Larga de un ausente para que quede en 24h. No se podia: sumar una
// Larga a un D+N lo dejaba en D+N, asi que el boton Larga marcaba el dia como
// bloqueado y las sugerencias de reemplazo la descartaban ("no suma nada").
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
const { TURNO } = await import("../js/constants.js");
const { fusionarTurnos, getAddTurnResult } = await import("../js/turnEngine.js");
const { canCoverShift, isDiurnoLongCoverageCandidate } =
    await import("../js/replacementCandidates.js");
const { fusionarTurnos: fusionarPWA } = await import(
    "../../APP TurnoPlus/www/js/rotationEngine.js"
);

const NOMBRE = "YESSICA LISSETT JERIA BAHAMONDES";
// Miercoles 11-11-2026, dia habil.
const MIERCOLES = "2026-10-11";
const CONFIG = {
    allowTwentyFourHourShifts: true,
    allowInvertedTwentyFourHourShifts: true,
    allowDiurnoAfterTwentyFour: true
};

beforeEach(() => {
    localStorage.clear();
    setJSON("profiles", [
        { name: NOMBRE, contractType: "Planta", estamento: "Profesional" }
    ]);
    setJSON("rotativa_" + NOMBRE, { type: "diurno", start: "2026-01-05" });
    setJSON("turnChangeConfig", CONFIG);
});

test("D+N mas una Larga es un 24h, en la plataforma y en la PWA", () => {
    for (const fusionar of [fusionarTurnos, fusionarPWA]) {
        assert.equal(fusionar(TURNO.DIURNO_NOCHE, TURNO.LARGA), TURNO.TURNO24);
        assert.equal(fusionar(TURNO.LARGA, TURNO.DIURNO_NOCHE), TURNO.TURNO24);
        assert.equal(fusionar(TURNO.DIURNO_NOCHE, TURNO.TURNO24), TURNO.TURNO24);
        // Lo que ya cabia en el D+N lo sigue dejando igual.
        assert.equal(fusionar(TURNO.DIURNO_NOCHE, TURNO.DIURNO), TURNO.DIURNO_NOCHE);
        assert.equal(fusionar(TURNO.DIURNO_NOCHE, TURNO.NOCHE), TURNO.DIURNO_NOCHE);
    }
});

test("el boton Larga sobre un D+N de base Diurno lo deja en 24h", () => {
    const r = getAddTurnResult(NOMBRE, MIERCOLES, TURNO.LARGA, true, {
        effectiveBaseTurn: TURNO.DIURNO,
        actualState: TURNO.DIURNO_NOCHE,
        replacementTurn: TURNO.LIBRE
    });

    assert.equal(r.allowed, true);
    assert.equal(r.nextVisibleTurn, TURNO.TURNO24);
});

test("un Diurno en D+N es candidato para cubrir una Larga y suma solo la extension", () => {
    const date = new Date(2026, 10, 11);

    assert.equal(canCoverShift(TURNO.DIURNO_NOCHE, TURNO.LARGA, CONFIG), true);
    // Sin turnos 24 en la unidad no se le ofrece.
    assert.equal(
        canCoverShift(TURNO.DIURNO_NOCHE, TURNO.LARGA, {
            ...CONFIG,
            allowTwentyFourHourShifts: false
        }),
        false
    );
    assert.equal(
        isDiurnoLongCoverageCandidate(
            { name: NOMBRE },
            TURNO.DIURNO_NOCHE,
            TURNO.LARGA,
            date,
            []
        ),
        true
    );
});

test("recibir un 24h o un D+N ya armado no achica el dia", () => {
    for (const fusionar of [fusionarTurnos, fusionarPWA]) {
        for (const actual of [TURNO.LARGA, TURNO.NOCHE, TURNO.DIURNO, TURNO.DIURNO_NOCHE]) {
            assert.equal(fusionar(actual, TURNO.TURNO24), TURNO.TURNO24);
        }
        assert.equal(fusionar(TURNO.DIURNO, TURNO.DIURNO_NOCHE), TURNO.DIURNO_NOCHE);
        assert.equal(fusionar(TURNO.NOCHE, TURNO.DIURNO_NOCHE), TURNO.DIURNO_NOCHE);
    }
});
