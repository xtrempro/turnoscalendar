// "Ayuda para cubrir" del Calendario Mensual (js/monthlyMagicPlan.js): dejar
// todos los turnos de Titulares con la misma cantidad, gastando lo menos
// posible: primero emparejar Dia/Noche, despues mover turnos que sobran, y al
// final horas extras (menos HHEE, sin pasar el tope, grado mas alto). El 24
// invertido es ultimo recurso.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { TURNO } from "../js/constants.js";
import { planMonth, targetPerShift, movesByWorker } from "../js/monthlyMagicPlan.js";

const person = name => ({ name });

// Un mes de `days` dias con `base` personas por turno; `edit` ajusta filas.
function model(days, base, edit = () => {}) {
    const rows = [];

    for (let day = 1; day <= days; day++) {
        const row = {
            keyDay: `2026-9-${day}`,
            slots: {
                day: Array.from({ length: base }, (_, i) => person(`D${day}-${i}`)),
                night: Array.from({ length: base }, (_, i) => person(`N${day}-${i}`))
            },
            gaps: { day: [], night: [] },
            cupos: { day: [], night: [] }
        };

        edit(row, day);
        rows.push(row);
    }

    return { rows };
}

// Calendario de mentira: turno real por persona y dia.
function deps(turns = {}, extra = {}) {
    return {
        canMoveSource: () => true,
        targetBlock: () => "",
        turnAt: (name, keyDay) => turns[name]?.[keyDay] ?? TURNO.LIBRE,
        baseTurn: (name, keyDay) => turns[name]?.[keyDay] ?? TURNO.LIBRE,
        neededTurnFor: () => TURNO.LARGA,
        extraHours: (keyDay, turn) => (Number(turn) === TURNO.NOCHE ? { d: 4, n: 8 } : { d: 12, n: 0 }),
        diurnalLimit: 40,
        candidatesFor: async () => [],
        ...extra
    };
}

test("la meta es la cantidad mas frecuente contando ausentes y cupos", () => {
    const m = model(5, 3, (row, day) => {
        if (day === 2) {
            row.slots.day.pop();
            row.gaps.day.push({ name: "Ana" });
        }
        if (day === 3) row.slots.night.push(person("Extra"));
    });

    assert.equal(targetPerShift(m), 3);
});

test("1. sobra de Dia y falta de Noche el mismo dia: se empareja", async () => {
    const m = model(3, 3, (row, day) => {
        if (day === 2) {
            row.slots.day.push(person("Eduardo"));
            row.slots.night.pop();
        }
    });
    const turns = { Eduardo: { "2026-9-2": TURNO.LARGA } };
    const plan = await planMonth(m, deps(turns));

    assert.equal(plan.swaps.length, 1);
    assert.equal(plan.swaps[0].keyDay, "2026-9-2");
    assert.equal(plan.swaps[0].destinationTurn, TURNO.NOCHE);
    assert.deepEqual(plan.moves, []);
    assert.deepEqual(plan.covers, []);
});

test("2. un supernumerario se mueve a donde falta y cubre al ausente; evita el 24 invertido", async () => {
    const m = model(5, 3, (row, day) => {
        if (day === 1) row.slots.day.push(person("Xavier"), person("Yanet"));
        if (day === 4) {
            row.slots.day = row.slots.day.slice(0, 1);
            row.gaps.day.push({ name: "Ana" });
            row.cupos.day.push({ motive: "Completar rotativa", turno: TURNO.LARGA });
        }
    });
    // Xavier tiene Noche el 3: moverlo a la Larga del 4 seria un 24 invertido.
    const turns = {
        Xavier: { "2026-9-1": TURNO.LARGA, "2026-9-3": TURNO.NOCHE },
        Yanet: { "2026-9-1": TURNO.LARGA }
    };
    // Solo ellos dos tienen ese turno como base (los demas no se pueden mover).
    const plan = await planMonth(m, deps(turns, {
        canMoveSource: name => ["Xavier", "Yanet"].includes(name)
    }));

    assert.equal(plan.moves.length, 2);

    const [first, second] = plan.moves;

    assert.equal(first.name, "Yanet", "primero quien no queda en 24 invertido");
    assert.equal(first.targetKey, "2026-9-4");
    assert.equal(first.covers, "Ana", "cubre al ausente");
    assert.equal(first.inverted, false);
    assert.equal(second.name, "Xavier");
    assert.equal(second.inverted, true, "si no queda otra, va marcado");
    assert.equal(second.covers, "", "el segundo llena el cupo");
    assert.deepEqual(movesByWorker(plan.moves).map(group => group.name), ["Xavier", "Yanet"]);
});

test("3. horas extras: menos HHEE primero, despues grado mas alto, sin pasar el tope", async () => {
    const m = model(3, 3, (row, day) => {
        if (day === 2) {
            row.slots.day.pop();
            row.gaps.day.push({ name: "Bea" });
        }
    });
    const candidatesFor = async () => [
        { name: "Mucho", hheeD: 20, hheeN: 0, isFree: true, grade: 20 },
        { name: "PocoGrado10", hheeD: 4, hheeN: 0, isFree: true, grade: 10 },
        { name: "PocoGrado18", hheeD: 4, hheeN: 0, isFree: true, grade: 18 },
        { name: "Tope", hheeD: 30, hheeN: 0, isFree: true, grade: 25 },
        { name: "Ocupado", hheeD: 0, hheeN: 0, isFree: false, grade: 25 },
        { name: "SinContrato", hheeD: 0, hheeN: 0, isFree: true, needsContract: true, grade: 25 }
    ];
    const plan = await planMonth(m, deps({}, { candidatesFor }));

    assert.equal(plan.covers.length, 1);
    assert.equal(plan.covers[0].worker, "PocoGrado18");
    assert.equal(plan.covers[0].replaced, "Bea");
    assert.deepEqual(plan.covers[0].alternatives.map(item => item.name), ["PocoGrado10", "Mucho"], "Tope pasaria las 40 h");
});

test("3. las horas planificadas cuentan: no se le carga todo al mismo", async () => {
    const m = model(3, 3, row => {
        row.slots.day.pop();
        row.gaps.day.push({ name: `Aus-${row.keyDay}` });
    });
    const candidatesFor = async () => [
        { name: "Ana", hheeD: 0, hheeN: 0, isFree: true, grade: 10 },
        { name: "Beto", hheeD: 6, hheeN: 0, isFree: true, grade: 10 }
    ];
    const plan = await planMonth(m, deps({}, { candidatesFor }));

    // Ana (0) el 1; Beto (6 < 12) el 2; el 3 tienen 12 y 18: Ana otra vez,
    // pero el 2 seria vecino del 1... y no lo es del 3.
    assert.deepEqual(plan.covers.map(item => item.worker), ["Ana", "Beto", "Ana"]);
});

test("lo que no tiene respaldo queda sin solucion, a la vista", async () => {
    const m = model(2, 3, (row, day) => {
        if (day === 2) row.slots.night.pop();
    });
    const plan = await planMonth(m, deps());

    assert.equal(plan.unresolved.length, 1);
    assert.equal(plan.unresolved[0].slot, "night");
});

test("el modal: consejos numerados, detalle, aplicar seleccionados o todo, y recalcula", async () => {
    const source = await readFile(new URL("../js/monthlyMagic.js", import.meta.url), "utf8");
    const calendar = await readFile(new URL("../js/monthlyCalendar.js", import.meta.url), "utf8");

    assert.match(source, /<summary>Ver detalle/);
    assert.match(source, /data-magic-only="selected">Aplicar seleccionados/);
    assert.match(source, /data-magic-only="all">Aplicar todo/);
    // Al aplicar se repinta el calendario y se rehacen los consejos.
    assert.match(source, /await onApplied\?\.\(\);[\s\S]*await recompute\(\);/);
    // Mover usa el mismo movimiento del calendario; cubrir al ausente movido
    // no agrega otro turno.
    assert.match(source, /window\.applyShiftMove\?\.\(/);
    assert.match(source, /source: "manual_extra",\s*addsShift: false/);
    assert.match(calendar, /data-mcal-magic/);
});
