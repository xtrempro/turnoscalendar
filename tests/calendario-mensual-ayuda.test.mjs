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
        { name: "SinContrato", hheeD: 0, hheeN: 0, isFree: true, contractWarning: "replacement", grade: 25 }
    ];
    const plan = await planMonth(m, deps({}, { candidatesFor }));

    assert.equal(plan.covers.length, 1);
    assert.equal(plan.covers[0].worker, "PocoGrado18");
    assert.equal(plan.covers[0].replaced, "Bea");
    // Sin contrato vigente se puede, pero va despues de quienes si tienen.
    assert.deepEqual(plan.covers[0].alternatives.map(item => item.name), ["PocoGrado10", "Mucho", "SinContrato"], "Tope pasaria las 40 h");
    assert.equal(plan.covers[0].alternatives[2].contractWarning, "replacement");
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

test("horas extras: se pueden preasignar todas o solo las seleccionadas", async () => {
    const source = await readFile(new URL("../js/monthlyMagic.js", import.meta.url), "utf8");

    // Botones solo en el consejo de horas extras.
    assert.match(source, /data-magic-only="selected" data-magic-preassign[^>]*>Preasignar seleccionados/);
    assert.match(source, /data-magic-only="all" data-magic-preassign[^>]*>Preasignar todo/);
    assert.match(source, /"cover",\s*plan\.covers\.length,\s*\{\s*preassign: true,/);
    // La misma reserva del modal de sugerencias: un cupo lleva su motivo en
    // `reason`, una ausencia a quien cubre en `replaced`.
    assert.match(source, /if \(preassign\) \{\s*addPreassignment\(\{\s*worker,\s*replaced: item\.replaced \|\| "",\s*reason: item\.replaced \? "" : item\.cupo\?\.motive \|\| "",/);
    assert.match(source, /applyCover\(item, worker, \{ preassign, request \}\)/);
});

test("etapa 2: si a un grupo le falta gente en varios turnos, alguien de Diurno pasa a ese grupo", async () => {
    // Al grupo B le falta uno en la Larga del 3 y la Noche del 4 (y el 1, ya pasado).
    const m = model(6, 3, (row, day) => {
        const cupo = { group: "B", motive: "Completar rotativa de tecnicos del grupo B", turno: TURNO.LARGA, reference: "Molde" };

        if (day === 1 || day === 3) {
            row.slots.day.pop();
            row.cupos.day.push(cupo);
        }
        if (day === 4) {
            row.slots.night.pop();
            row.cupos.night.push({ ...cupo, turno: TURNO.NOCHE });
        }
    });
    let candidatesAsked = 0;
    const plan = await planMonth(m, deps({}, {
        minStartKey: "2026-9-2",
        diurnoWorkers: () => ["Con permisos", "Libre de todo"],
        firstTurnFor: (letter, keyDay) => (letter === "B" && keyDay === "2026-9-3" ? { firstTurn: "larga", label: "Largo" } : null),
        affectedFrom: async name => (name === "Con permisos" ? [{ label: "F. Legal", count: 3 }] : []),
        candidatesFor: async () => {
            candidatesAsked += 1;
            return [];
        }
    }));

    assert.equal(plan.rotations.length, 1);
    assert.deepEqual(
        plan.rotations[0].cells,
        [{ keyDay: "2026-9-3", slot: "day" }, { keyDay: "2026-9-4", slot: "night" }],
        "los turnos que cubriria"
    );
    assert.deepEqual(
        { ...plan.rotations[0], affected: undefined, cells: undefined },
        {
            type: "rotation",
            name: "Libre de todo",
            group: "B",
            startKey: "2026-9-3",
            firstTurn: "larga",
            firstTurnLabel: "Largo",
            fills: 2,
            affected: undefined,
            alternatives: ["Con permisos"],
            cells: undefined
        },
        "quien pierde menos, desde el primer cupo que no ya paso"
    );
    // El cupo del 1 ya paso: no se toca. Para los del 3 y 4 se buscan horas
    // extras igual (son la alternativa al cambio de rotativa); como nadie
    // puede, no quedan "sin solucion": los cubre el cambio.
    assert.equal(candidatesAsked, 2);
    assert.deepEqual(plan.unresolved, []);
});

test("etapa 2: el modal lo aplica con el mismo cambio de grupo de Titulares de Turnos", async () => {
    const source = await readFile(new URL("../js/monthlyMagic.js", import.meta.url), "utf8");
    const holders = await readFile(new URL("../js/shiftHolders.js", import.meta.url), "utf8");

    assert.match(holders, /export async function applyGroupChange\(\{ profile, startISO, firstTurn, toLetter \}\)/);
    assert.match(source, /await applyGroupChange\(\{\s*profile: item\.name,\s*startISO: isoOf\(item\.startKey\),\s*firstTurn: item\.firstTurn,\s*toLetter: item\.group\s*\}\)/);
    assert.match(source, /se reescribe su calendario y se pierden/);
});

test("un turno con solicitud pendiente en la app no se vuelve a proponer: queda esperando", async () => {
    const m = model(3, 3, (row, day) => {
        if (day === 2) {
            row.slots.day.pop();
            row.gaps.day.push({ name: "Bea" });
        }
    });
    let asked = 0;
    const plan = await planMonth(m, deps({}, {
        pendingRequestFor: ({ replaced, keyDay }) =>
            (replaced === "Bea" && keyDay === "2026-9-2" ? { worker: "Ana" } : null),
        candidatesFor: async () => {
            asked += 1;
            return [];
        }
    }));

    assert.deepEqual(plan.covers, []);
    assert.equal(asked, 0);
    assert.equal(plan.waiting.length, 1);
    assert.equal(plan.waiting[0].worker, "Ana");
    assert.deepEqual(plan.unresolved, []);
});

test("auditoria: nada del plan toca dias anteriores a manana", async () => {
    // Sobra gente el 1 y el 4; falta el 2 y el 5. Manana es el 3.
    const m = model(6, 3, (row, day) => {
        if (day === 1 || day === 4) row.slots.day.push(person(`X${day}`));
        if (day === 2 || day === 5) {
            row.slots.day.pop();
            row.gaps.day.push({ name: `Aus${day}` });
        }
    });
    const turns = { X1: { "2026-9-1": TURNO.LARGA }, X4: { "2026-9-4": TURNO.LARGA } };
    let asked = [];
    const plan = await planMonth(m, deps(turns, {
        minStartKey: "2026-9-3",
        canMoveSource: name => name.startsWith("X"),
        candidatesFor: async ({ keyDay }) => {
            asked.push(keyDay);
            return [];
        }
    }));

    // Solo X4 (el 4) se mueve, y solo hacia el 5.
    assert.deepEqual(plan.moves.map(move => `${move.name}:${move.sourceKey}>${move.targetKey}`), ["X4:2026-9-4>2026-9-5"]);
    assert.deepEqual(asked, [], "el 2 ya paso: no se pide a nadie");
    assert.deepEqual(plan.unresolved, []);
    assert.deepEqual(plan.surplus, [], "lo que sobra en un dia pasado no cuenta");
});

test("auditoria: al aplicar se revalida todo, de a uno, y las solicitudes de cupo esperan la marca", async () => {
    const source = await readFile(new URL("../js/monthlyMagic.js", import.meta.url), "utf8");

    // Revalidacion completa antes de cada cobertura.
    assert.match(source, /const blocked = await coverBlockReason\(item, worker, \{/);
    assert.match(source, /isShiftUncovered\(item\.replaced, item\.keyDay\)/);
    assert.match(source, /isCupoStillOpen\(item\.cupo\?\.motive \|\| "", item\.keyDay, item\.turn\)/);
    assert.match(source, /await buildReplacementCandidates\(reference, item\.keyDay,/);
    assert.match(source, /countsBatchHours \? batch\.hours\.get\(worker\) \|\| 0 : 0/);
    // Un consejo a la vez, todos los botones bloqueados, con try/finally.
    assert.match(source, /if \(!plan \|\| applying\) return;/);
    assert.match(source, /querySelectorAll\("\[data-magic-apply\]"\)\.forEach\(button => \{\s*button\.disabled = busy;/);
    assert.match(source, /\} finally \{\s*applying = false;\s*\}/);
    // Solicitudes de cupo: encendidas en test, apagadas en produccion.
    assert.match(source, /export const CUPO_APP_REQUESTS_IN_PRODUCTION = false;/);
    assert.match(source, /IS_TEST_ENVIRONMENT \|\| CUPO_APP_REQUESTS_IN_PRODUCTION/);
    // Diurno -> turno: sin contratos de reemplazo.
    assert.match(source, /!isHonorariaProfile\(name\) &&\s*!isReplacementProfile\(name\)/);
});

test("auditoria 2: el modal siempre sale del estado ocupado", async () => {
    const source = await readFile(new URL("../js/monthlyMagic.js", import.meta.url), "utf8");

    assert.match(source, /\} finally \{\s*\/\/ Siempre se sale del estado ocupado[^\n]*\n\s*setBusy\(false\);/);
});
