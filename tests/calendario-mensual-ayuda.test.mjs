// "Ayuda para cubrir" del Calendario Mensual (js/monthlyMagicPlan.js): dejar
// todos los turnos de Titulares con la misma cantidad, gastando lo menos
// posible: primero emparejar Dia/Noche, despues mover turnos que sobran, y al
// final horas extras (menos HHEE, sin pasar el tope, grado mas alto). El 24
// invertido es ultimo recurso.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { TURNO } from "../js/constants.js";
import { planMonth, targetPerShift, movesByWorker, orderMovesForApply } from "../js/monthlyMagicPlan.js";

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
        tierOf: () => 3,
        canMoveSource: () => true,
        dayBlock: () => "",
        allowInverted: true,
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

test("el caso de EC: sus movimientos se encadenan y cubren los tres turnos que faltan", async () => {
    // Sobra EC la Noche del 1 y del 2 y la Larga del 5; faltan la Larga del 2
    // y las Noches del 3 y del 4.
    const m = model(6, 3, (row, day) => {
        if (day === 1 || day === 2) row.slots.night.push(person("EC"));
        if (day === 5) row.slots.day.push(person("EC"));
        if (day === 2) row.slots.day.pop();
        if (day === 3 || day === 4) {
            row.slots.night.pop();
            row.cupos.night.push({ motive: "Completar rotativa", turno: TURNO.NOCHE });
        }
    });
    const turns = { EC: { "2026-9-1": TURNO.NOCHE, "2026-9-2": TURNO.NOCHE, "2026-9-5": TURNO.LARGA } };
    const plan = await planMonth(m, deps(turns, {
        tierOf: name => (name === "EC" ? 1 : 3),
        canMoveSource: name => name === "EC"
    }));
    const targets = plan.moves.map(move => `${move.sourceKey}>${move.targetKey}:${move.destinationTurn}`).sort();

    assert.equal(plan.moves.length, 3);
    assert.ok(plan.moves.every(move => move.name === "EC" && !move.inverted));
    // La Larga del 2 se cubre con un turno de EC (su Noche del 2 pasa a Larga,
    // el mismo dia) y sus otros dos van a las Noches del 3 y del 4.
    assert.deepEqual(targets, [
        "2026-9-1>2026-9-3:2",
        "2026-9-2>2026-9-2:1",
        "2026-9-5>2026-9-4:2"
    ]);
    assert.deepEqual(plan.covers, [], "sin horas extras");
    assert.deepEqual(plan.surplus, []);
});

test("cascada: primero 3er turno, despues 4to de reemplazo, al final 4to contrata/planta", async () => {
    const m = model(3, 3, (row, day) => {
        if (day === 1) row.slots.day.push(person("Planta"), person("Reemplazo"));
        if (day === 3) row.slots.day.pop();
    });
    const turns = {
        Planta: { "2026-9-1": TURNO.LARGA },
        Reemplazo: { "2026-9-1": TURNO.LARGA }
    };
    const plan = await planMonth(m, deps(turns, {
        tierOf: name => ({ Planta: 3, Reemplazo: 2 })[name] || 0,
        canMoveSource: name => ["Planta", "Reemplazo"].includes(name)
    }));

    assert.equal(plan.moves.length, 1, "solo hacia falta uno");
    assert.equal(plan.moves[0].name, "Reemplazo");
    assert.equal(plan.moves[0].tier, 2);
    assert.deepEqual(movesByWorker(plan.moves).map(group => group.name), ["Reemplazo"]);
});

test("un movimiento nunca arma un 24 y el 24 invertido es ultimo recurso (o nada si la unidad no lo permite)", async () => {
    const build = () => model(5, 3, (row, day) => {
        if (day === 1) row.slots.day.push(person("Xavier"));
        if (day === 4) {
            row.slots.day.pop();
            row.cupos.day.push({ motive: "Completar rotativa", turno: TURNO.LARGA });
        }
    });
    // Xavier con Noche el 3: su Larga del 1 al 4 seria un 24 invertido.
    const turns = { Xavier: { "2026-9-1": TURNO.LARGA, "2026-9-3": TURNO.NOCHE } };
    const only = { canMoveSource: name => name === "Xavier" };
    const allowed = await planMonth(build(), deps(turns, only));

    assert.equal(allowed.moves.length, 1);
    assert.equal(allowed.moves[0].inverted, true, "marcado");

    const forbidden = await planMonth(build(), deps(turns, { ...only, allowInverted: false }));

    assert.equal(forbidden.moves.length, 0);
});

test("al aplicar, el movimiento que libera un dia va antes que el que llega a ese dia", () => {
    const llegaAl2 = { name: "EC", sourceKey: "2026-9-1", targetKey: "2026-9-2" };
    const dejaEl2 = { name: "EC", sourceKey: "2026-9-2", targetKey: "2026-9-3" };

    assert.deepEqual(orderMovesForApply([llegaAl2, dejaEl2]), [dejaEl2, llegaAl2]);
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
    // Al aplicar se repinta el calendario y se rehacen los consejos; los
    // movimientos van en el orden que permite encadenarlos.
    assert.match(source, /orderMovesForApply\(picked\("move"\)/);
    assert.match(source, /await onApplied\?\.\(\);[\s\S]*await recompute\(\);/);
    // Mover usa el mismo movimiento del calendario; cubrir al ausente movido
    // no agrega otro turno.
    assert.match(source, /window\.applyShiftMove\?\.\(/);
    assert.match(source, /source: "manual_extra",\s*addsShift: false/);
    assert.match(calendar, /data-mcal-magic/);
});
