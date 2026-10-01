// A honorarios la jornada se pacta dia a dia: el supervisor tiene que poder
// dejar un dia SIN turno desde la edicion directa del calendario. El ciclo de
// clicks excluia el vacio siempre que el dia tuviera turno base
// (disallowLibre = baseTurno > LIBRE), asi que se recorrian las opciones y
// siempre se volvia al turno original sin poder vaciarlo.
import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) { this.values.set(key, String(value)); }
}

globalThis.localStorage = new MemoryStorage();

const { getProtectedDirectEditTurn, getTurnoBase, getTurnoProgramado } =
    await import("../js/turnEngine.js");
const { saveProfileDayTurn } = await import("../js/storage.js");
const { TURNO } = await import("../js/constants.js");

const HONORARIA = "Ana Honorarios";
const PLANTA = "Bruno Planta";
const DAY = "2026-7-14";
const ISO_START = "2026-08-01";
const ISO_END = "2026-08-31";

function seed(baseTurn) {
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify([
        {
            id: "p-a",
            name: HONORARIA,
            estamento: "Profesional",
            contractType: "Honorarios",
            active: true
        },
        {
            id: "p-b",
            name: PLANTA,
            estamento: "Profesional",
            contractType: "Planta",
            active: true
        }
    ]));
    [HONORARIA, PLANTA].forEach(name => {
        localStorage.setItem(`baseData_${name}`, JSON.stringify({
            [DAY]: baseTurn
        }));
        localStorage.setItem(`rotativa_${name}`, JSON.stringify({
            type: "4turno",
            start: "",
            firstTurn: "larga"
        }));
    });
    localStorage.setItem(`honorariaContracts_${HONORARIA}`, JSON.stringify([{
        id: "hc-1",
        start: ISO_START,
        end: ISO_END,
        maxHours: 44,
        limitPeriod: "monthly"
    }]));
}

// Recorre el ciclo de clicks de la edicion directa hasta volver al inicio.
function clickCycle(profileName, baseTurn, maxClicks = 8) {
    seed(baseTurn);

    const sequence = [];
    let current = getTurnoBase(profileName, DAY);
    const start = current;

    for (let click = 0; click < maxClicks; click++) {
        const next = getProtectedDirectEditTurn(
            profileName,
            DAY,
            current,
            true,
            { effectiveBaseTurn: getTurnoBase(profileName, DAY) }
        ).nextVisibleTurn;

        sequence.push(next);
        current = next;

        if (next === start) break;
    }

    return sequence;
}

test("honorarios: el ciclo pasa por vacio y vuelve al turno inicial", () => {
    const sequence = clickCycle(HONORARIA, TURNO.LARGA);

    assert.equal(
        sequence.includes(TURNO.LIBRE),
        true,
        "el vacio tiene que estar en el ciclo"
    );
    // Larga -> 24h -> vacio -> Larga: el vacio va al final, antes de volver.
    assert.deepEqual(sequence, [TURNO.TURNO24, TURNO.LIBRE, TURNO.LARGA]);
});

test("honorarios: un turno sin alternativas igual se puede vaciar", () => {
    // Base 24h no tiene otro turno al que cambiar; antes el click no hacia nada.
    const sequence = clickCycle(HONORARIA, TURNO.TURNO24);

    assert.deepEqual(sequence, [TURNO.LIBRE, TURNO.TURNO24]);
});

test("honorarios: el dia vacio queda guardado y no vuelve al base", () => {
    seed(TURNO.LARGA);

    assert.equal(getTurnoBase(HONORARIA, DAY), TURNO.LARGA);

    saveProfileDayTurn(DAY, TURNO.LIBRE, HONORARIA);

    assert.equal(
        getTurnoProgramado(HONORARIA, DAY),
        TURNO.LIBRE,
        "el 0 explicito manda sobre el turno base"
    );
});

test("el resto de los contratos conserva la proteccion del turno base", () => {
    const sequence = clickCycle(PLANTA, TURNO.LARGA);

    assert.equal(
        sequence.includes(TURNO.LIBRE),
        false,
        "sin honorarios el turno base no se borra desde el calendario"
    );
    assert.deepEqual(sequence, [TURNO.TURNO24, TURNO.LARGA]);
});

test("con un reemplazo asignado el vacio sigue protegido", () => {
    seed(TURNO.LARGA);

    const result = getProtectedDirectEditTurn(
        HONORARIA,
        DAY,
        TURNO.TURNO24,
        true,
        {
            effectiveBaseTurn: TURNO.LARGA,
            // Ese turno se anula desde su propio cuadro, no vaciando la casilla.
            replacementTurn: TURNO.NOCHE
        }
    );

    assert.notEqual(result.nextVisibleTurn, TURNO.LIBRE);
});
