import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { TURNO } from "../js/constants.js";

class MemoryStorage {
    constructor() {
        this.values = new Map();
    }

    get length() {
        return this.values.size;
    }

    clear() {
        this.values.clear();
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    key(index) {
        return [...this.values.keys()][index] ?? null;
    }

    removeItem(key) {
        this.values.delete(key);
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }
}

globalThis.localStorage = new MemoryStorage();

const {
    getShiftMoveMarkers,
    getShiftMoves,
    registerShiftMove
} = await import("../js/shiftMoves.js");

const PROFILE = "Ana Rojas";
const SOURCE = "2026-6-10";
const TARGET = "2026-6-12";

beforeEach(() => {
    globalThis.localStorage.clear();
});

test("el movimiento inverso vuelve el turno a base y elimina TTMM", () => {
    const first = registerShiftMove({
        profile: PROFILE,
        sourceKey: SOURCE,
        targetKey: TARGET,
        sourceTurn: TURNO.LARGA,
        destinationTurn: TURNO.LARGA
    });

    assert.ok(first);
    assert.equal(getShiftMoveMarkers(PROFILE, SOURCE).length, 1);
    assert.equal(getShiftMoveMarkers(PROFILE, TARGET).length, 1);

    const reverse = registerShiftMove({
        profile: PROFILE,
        sourceKey: TARGET,
        targetKey: SOURCE,
        sourceTurn: TURNO.LARGA,
        destinationTurn: TURNO.LARGA
    });

    assert.equal(reverse, null);
    assert.deepEqual(getShiftMoves(), []);
    assert.deepEqual(getShiftMoveMarkers(PROFILE, SOURCE), []);
    assert.deepEqual(getShiftMoveMarkers(PROFILE, TARGET), []);
});

test("un cambio de horario que vuelve al horario original no conserva TTMM", () => {
    registerShiftMove({
        profile: PROFILE,
        sourceKey: SOURCE,
        targetKey: SOURCE,
        sourceTurn: TURNO.LARGA,
        destinationTurn: TURNO.NOCHE
    });

    assert.equal(getShiftMoveMarkers(PROFILE, SOURCE).length, 1);

    registerShiftMove({
        profile: PROFILE,
        sourceKey: SOURCE,
        targetKey: SOURCE,
        sourceTurn: TURNO.NOCHE,
        destinationTurn: TURNO.LARGA
    });

    assert.deepEqual(getShiftMoves(), []);
    assert.deepEqual(getShiftMoveMarkers(PROFILE, SOURCE), []);
});

test("compacta pares inversos que ya estaban guardados", () => {
    globalThis.localStorage.setItem(
        "shiftMoves",
        JSON.stringify([
            {
                profile: PROFILE,
                sourceKey: SOURCE,
                targetKey: TARGET,
                sourceTurn: TURNO.LARGA,
                destinationTurn: TURNO.NOCHE
            },
            {
                profile: PROFILE,
                sourceKey: TARGET,
                targetKey: SOURCE,
                sourceTurn: TURNO.NOCHE,
                destinationTurn: TURNO.LARGA
            }
        ])
    );
    globalThis.localStorage.setItem("shiftMovesAuditMigrationV1", "1");

    assert.deepEqual(getShiftMoves(), []);
    assert.equal(
        globalThis.localStorage.getItem("shiftMoves"),
        "[]"
    );
});

test("no compacta movimientos inversos si el primero formo un 24", () => {
    registerShiftMove({
        profile: PROFILE,
        sourceKey: SOURCE,
        targetKey: TARGET,
        sourceTurn: TURNO.LARGA,
        destinationTurn: TURNO.LARGA,
        combinedInto24: true
    });

    registerShiftMove({
        profile: PROFILE,
        sourceKey: TARGET,
        targetKey: SOURCE,
        sourceTurn: TURNO.LARGA,
        destinationTurn: TURNO.LARGA
    });

    assert.equal(getShiftMoves().length, 2);
});

/* ======================================================================
   La migracion no puede darse por hecha sin haber visto la bitacora

   Desde que `log` no viaja en el arranque (0,85 MB de puro registro, ver
   DEFERRED_STATE_MODULES en js/firebaseAppState.js), `getShiftMoves` puede
   correr con la bitacora vacia. La bandera se escribia SIN CONDICION: eso daba
   la migracion por cumplida para siempre y esos "Movio turno base" no se
   migraban nunca. Silencioso y en una sola direccion.
   ====================================================================== */

const BANDERA = "shiftMovesAuditMigrationV1";

const UN_MOVIMIENTO = JSON.stringify([{
    id: "log-1",
    action: "Movio turno base",
    profile: "Ana",
    createdAt: "2026-09-01T10:00:00.000Z",
    meta: {
        profile: "Ana",
        sourceKey: "2026-8-1",
        targetKey: "2026-8-2",
        sourceTurn: TURNO.LARGA,
        destinationTurn: TURNO.LARGA
    }
}]);

test("con la bitacora sin llegar, la migracion NO se marca como hecha", () => {
    globalThis.localStorage.setItem("auditLog", "[]");

    getShiftMoves();

    assert.equal(
        globalThis.localStorage.getItem(BANDERA),
        null,
        "se dio por migrada una bitacora que ni siquiera se pudo mirar"
    );
});

test("y cuando la bitacora llega, migra de verdad", () => {
    // El caso completo: primero se arranca sin bitacora, despues llega.
    globalThis.localStorage.setItem("auditLog", "[]");
    getShiftMoves();

    globalThis.localStorage.setItem("auditLog", UN_MOVIMIENTO);

    const moves = getShiftMoves();

    assert.equal(moves.length, 1, "el movimiento de la bitacora no se migro");
    assert.equal(moves[0].profile, "Ana");
});

test("con bitacora de verdad, la migracion si se marca", () => {
    // O se repetiria en cada llamada para siempre.
    globalThis.localStorage.setItem("auditLog", UN_MOVIMIENTO);

    getShiftMoves();

    assert.equal(globalThis.localStorage.getItem(BANDERA), "1");
});
