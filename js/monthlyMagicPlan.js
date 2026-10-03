// Ayuda para cubrir el mes (Calendario Mensual): un plan para dejar todos los
// turnos de Titulares con la MISMA cantidad de gente, gastando lo menos posible.
//
// En orden, y cada paso cuenta con que los anteriores se aplican:
//   1. Emparejar Dia y Noche el mismo dia: si un tramo sobra y el otro falta,
//      el turno de un titular pasa de Larga a Noche (o al reves).
//   2. Mover turnos: un titular que sobra en un turno (supernumerario) se mueve
//      a un turno al que le falta gente, en otro dia del mes. Si alli hay un
//      ausente sin cubrir, lo cubre (sin horas extras: es su propio turno).
//   3. Cubrir con horas extras lo que siga faltando (ausencias y cupos de la
//      Brecha): primero quien tiene menos horas extras en el mes, sin pasar el
//      tope mensual, y despues el de grado mas alto (su hora extra cuesta menos).
// El 24 invertido se evita siempre: solo aparece si no hay otra salida, y
// marcado.
//
// No lee ni escribe nada por su cuenta: todo llega por `deps`, para que el
// mismo plan se pueda probar sin la pagina.

import { TURNO } from "./constants.js";
import { moveShiftCreatesInvertedTwentyFour } from "./rulesEngine.js";

export const SLOT_TURN = { day: TURNO.LARGA, night: TURNO.NOCHE };

// Tramos de Titulares que ocupa un turno (los mismos del Calendario Mensual).
export function slotsOfTurn(turn) {
    const value = Number(turn) || TURNO.LIBRE;

    if (value === TURNO.LARGA || value === TURNO.MEDIA_MANANA || value === TURNO.MEDIA_TARDE) return ["day"];
    if (value === TURNO.NOCHE || value === TURNO.DIURNO_NOCHE) return ["night"];
    if (value === TURNO.TURNO24 || value === TURNO.TURNO18) return ["day", "night"];
    return [];
}

export function offsetKey(keyDay, offset) {
    const [y, m, d] = String(keyDay).split("-").map(Number);
    const date = new Date(y, m, d + offset);

    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayIndex(keyDay) {
    const [y, m, d] = String(keyDay).split("-").map(Number);

    return Math.round(new Date(y, m, d).getTime() / 86400000);
}

const cellId = (keyDay, slot) => `${keyDay}|${slot}`;

/**
 * La meta: cuantos deberia haber en cada turno. Es la cantidad mas frecuente
 * del mes contando a los presentes, a los ausentes (su turno es parte de la
 * dotacion) y los cupos de la Brecha. Empate: la mayor.
 */
export function targetPerShift(model) {
    const tally = new Map();

    (model?.rows || []).forEach(row => {
        ["day", "night"].forEach(slot => {
            const expected =
                (row.slots?.[slot]?.length || 0) +
                (row.gaps?.[slot]?.length || 0) +
                (row.cupos?.[slot]?.length || 0);

            if (expected > 0) tally.set(expected, (tally.get(expected) || 0) + 1);
        });
    });

    const best = [...tally.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];

    return best ? best[0] : 0;
}

// Quien esta en SU turno y se podria mover (no cubre, no es apoyo ni preasignado).
function isOwnShift(person) {
    return Boolean(person) &&
        !person.covering &&
        !person.extraReason &&
        !person.brecha &&
        !person.preassigned;
}

/**
 * @param {Object} model   el del Calendario Mensual (buildMonthlyCalendar)
 * @param {Object} deps
 *   canMoveSource(name, keyDay)                      -> bool
 *   targetBlock(name, keyDay, { sourceKey, destinationTurn }) -> "" o motivo
 *   turnAt(name, keyDay)  turno real del dia (numero)
 *   baseTurn(name, keyDay)
 *   neededTurnFor(absentName, keyDay)                -> turno a cubrir
 *   candidatesFor({ reference, keyDay, turn })       -> Promise<[{ name,
 *       hheeD, hheeN, isFree, blockedDay, isForced, isLinked, needsContract,
 *       grade }]>
 *   extraHours(keyDay, turn) -> { d, n } que suma cubrirlo
 *   diurnalLimit  tope mensual de horas extras diurnas
 *   shouldContinue()  false para cortar (cambio de mes)
 */
export async function planMonth(model, deps) {
    const target = targetPerShift(model);
    const rows = model?.rows || [];
    const rowByKey = new Map(rows.map(row => [row.keyDay, row]));
    const count = new Map();
    const overlay = new Map();
    const busy = new Map();
    const plannedHours = new Map();
    const claimedGaps = new Set();
    const usedPeople = new Set();
    const swaps = [];
    const moves = [];
    const covers = [];
    const unresolved = [];

    rows.forEach(row => {
        ["day", "night"].forEach(slot => count.set(cellId(row.keyDay, slot), row.slots?.[slot]?.length || 0));
    });

    const plannedTurn = (name, keyDay) => overlay.get(name)?.get(keyDay);
    const turnAt = (name, keyDay, ignoreKey = "") => {
        if (keyDay === ignoreKey) return TURNO.LIBRE;

        const planned = plannedTurn(name, keyDay);

        return planned !== undefined ? planned : Number(deps.turnAt(name, keyDay)) || TURNO.LIBRE;
    };
    const setTurn = (name, keyDay, turn) => {
        if (!overlay.has(name)) overlay.set(name, new Map());
        overlay.get(name).set(keyDay, turn);
    };
    const markBusy = (name, keyDay) => {
        if (!busy.has(name)) busy.set(name, new Set());
        busy.get(name).add(keyDay);
    };
    // Un plan que toca el mismo dia o uno vecino del mismo trabajador se deja
    // para la siguiente vuelta: las reglas (24, 24 invertido) se miden contra
    // el calendario de hoy, no contra el plan.
    const near = (name, keyDay) => {
        const days = busy.get(name);

        return Boolean(days) && [-1, 0, 1].some(offset => days.has(offsetKey(keyDay, offset)));
    };
    const inverted = (name, keyDay, turn, ignoreKey = "") =>
        moveShiftCreatesInvertedTwentyFour(
            turn,
            turnAt(name, offsetKey(keyDay, -1), ignoreKey),
            turnAt(name, offsetKey(keyDay, 1), ignoreKey)
        );
    const cellCount = (keyDay, slot) => count.get(cellId(keyDay, slot)) || 0;
    const bump = (keyDay, slot, delta) => count.set(cellId(keyDay, slot), cellCount(keyDay, slot) + delta);
    const movable = (row, slot) => (row.slots?.[slot] || []).filter(person =>
        isOwnShift(person) &&
        !usedPeople.has(cellId(row.keyDay, person.name)) &&
        !near(person.name, row.keyDay) &&
        deps.canMoveSource(person.name, row.keyDay)
    );
    // El ausente sin cubrir de ese turno que quedaria cubierto con `turn`.
    const claimGap = (keyDay, slot, turn) => {
        const row = rowByKey.get(keyDay);
        const gap = (row?.gaps?.[slot] || []).find(item =>
            !claimedGaps.has(cellId(keyDay, item.name)) &&
            Number(deps.neededTurnFor(item.name, keyDay)) === Number(turn)
        );

        if (!gap) return "";

        claimedGaps.add(cellId(keyDay, gap.name));
        return gap.name;
    };

    if (!target) return { target, swaps, moves, covers, unresolved, surplus: [], deficit: [] };

    // 1. Emparejar Dia y Noche el mismo dia.
    rows.forEach(row => {
        [["day", "night"], ["night", "day"]].forEach(([from, to]) => {
            while (cellCount(row.keyDay, from) > target && cellCount(row.keyDay, to) < target) {
                const destinationTurn = SLOT_TURN[to];
                const options = movable(row, from)
                    .filter(person => !deps.targetBlock(person.name, row.keyDay, {
                        sourceKey: row.keyDay,
                        destinationTurn
                    }))
                    .map(person => ({ person, inverted: inverted(person.name, row.keyDay, destinationTurn) }))
                    .sort((a, b) => Number(a.inverted) - Number(b.inverted) || a.person.name.localeCompare(b.person.name));
                const pick = options[0];

                if (!pick) break;

                const name = pick.person.name;

                swaps.push({
                    type: "swap",
                    name,
                    keyDay: row.keyDay,
                    sourceTurn: Number(deps.baseTurn(name, row.keyDay)) || SLOT_TURN[from],
                    destinationTurn,
                    covers: claimGap(row.keyDay, to, destinationTurn),
                    inverted: pick.inverted
                });
                usedPeople.add(cellId(row.keyDay, name));
                setTurn(name, row.keyDay, destinationTurn);
                markBusy(name, row.keyDay);
                bump(row.keyDay, from, -1);
                bump(row.keyDay, to, 1);
            }
        });
    });

    // 2. Mover turnos de donde sobran a donde faltan.
    const deficitCells = () => rows.flatMap(row => ["day", "night"]
        .filter(slot => cellCount(row.keyDay, slot) < target)
        .map(slot => ({ row, slot })));

    for (const row of rows) {
        for (const slot of ["day", "night"]) {
            while (cellCount(row.keyDay, slot) > target) {
                if (deps.shouldContinue && !deps.shouldContinue()) return null;

                let best = null;

                for (const person of movable(row, slot)) {
                    const name = person.name;
                    const sourceTurn = Number(deps.baseTurn(name, row.keyDay)) || SLOT_TURN[slot];

                    for (const cell of deficitCells()) {
                        const targetKey = cell.row.keyDay;

                        if (targetKey === row.keyDay) continue;
                        if (turnAt(name, targetKey) !== TURNO.LIBRE) continue;
                        if ((Number(deps.baseTurn(name, targetKey)) || TURNO.LIBRE) !== TURNO.LIBRE) continue;
                        if (near(name, targetKey)) continue;

                        const destinationTurn = SLOT_TURN[cell.slot];

                        if (deps.targetBlock(name, targetKey, { sourceKey: row.keyDay, destinationTurn })) continue;

                        const isInverted = inverted(name, targetKey, destinationTurn, row.keyDay);
                        const backed =
                            (cell.row.gaps?.[cell.slot]?.length || 0) +
                            (cell.row.cupos?.[cell.slot]?.length || 0) > 0;
                        const score =
                            (isInverted ? 1000 : 0) +
                            Math.abs(dayIndex(targetKey) - dayIndex(row.keyDay)) +
                            (backed ? 0 : 3) +
                            (sourceTurn !== destinationTurn ? 2 : 0);

                        if (!best || score < best.score) {
                            best = { score, name, sourceTurn, targetKey, slot: cell.slot, destinationTurn, inverted: isInverted };
                        }
                    }
                }

                if (!best) break;

                moves.push({
                    type: "move",
                    name: best.name,
                    sourceKey: row.keyDay,
                    sourceSlot: slot,
                    sourceTurn: best.sourceTurn,
                    targetKey: best.targetKey,
                    targetSlot: best.slot,
                    destinationTurn: best.destinationTurn,
                    covers: claimGap(best.targetKey, best.slot, best.destinationTurn),
                    cupo: !rowByKey.get(best.targetKey)?.gaps?.[best.slot]?.length &&
                        Boolean(rowByKey.get(best.targetKey)?.cupos?.[best.slot]?.length),
                    inverted: best.inverted
                });
                usedPeople.add(cellId(row.keyDay, best.name));
                setTurn(best.name, row.keyDay, TURNO.LIBRE);
                setTurn(best.name, best.targetKey, best.destinationTurn);
                markBusy(best.name, row.keyDay);
                markBusy(best.name, best.targetKey);
                bump(row.keyDay, slot, -1);
                bump(best.targetKey, best.slot, 1);
            }
        }
    }

    // 3. Horas extras para lo que siga faltando.
    const claimedCupos = new Map();

    for (const row of rows) {
        for (const slot of ["day", "night"]) {
            while (cellCount(row.keyDay, slot) < target) {
                if (deps.shouldContinue && !deps.shouldContinue()) return null;

                // Que falta: un ausente sin cubrir, o un cupo de la Brecha.
                const gap = (row.gaps?.[slot] || []).find(item => !claimedGaps.has(cellId(row.keyDay, item.name)));
                const cupoIndex = claimedCupos.get(cellId(row.keyDay, slot)) || 0;
                const cupo = !gap ? row.cupos?.[slot]?.[cupoIndex] : null;

                if (!gap && !cupo) {
                    unresolved.push({ keyDay: row.keyDay, slot, missing: target - cellCount(row.keyDay, slot), reason: "Falta gente sin ausencia ni cupo que respalde horas extras." });
                    break;
                }

                const turn = gap
                    ? Number(deps.neededTurnFor(gap.name, row.keyDay)) || SLOT_TURN[slot]
                    : Number(cupo.turno) || SLOT_TURN[slot];
                const slots = slotsOfTurn(turn).length ? slotsOfTurn(turn) : [slot];
                const reference = gap ? gap.name : cupo.reference;

                if (gap) claimedGaps.add(cellId(row.keyDay, gap.name));
                else claimedCupos.set(cellId(row.keyDay, slot), cupoIndex + 1);

                const adding = deps.extraHours(row.keyDay, turn) || { d: 0, n: 0 };
                const raw = reference
                    ? await deps.candidatesFor({ reference, keyDay: row.keyDay, turn })
                    : [];
                const ranked = (raw || [])
                    .filter(candidate =>
                        candidate.isFree &&
                        !candidate.isForced &&
                        !candidate.isLinked &&
                        !candidate.blockedDay &&
                        !candidate.needsContract &&
                        turnAt(candidate.name, row.keyDay) === TURNO.LIBRE &&
                        !near(candidate.name, row.keyDay)
                    )
                    .map(candidate => {
                        const planned = plannedHours.get(candidate.name) || { d: 0, n: 0 };
                        const hheeD = (Number(candidate.hheeD) || 0) + planned.d;
                        const hhee = hheeD + (Number(candidate.hheeN) || 0) + planned.n;

                        return {
                            ...candidate,
                            hheeD,
                            hhee,
                            overLimit: hheeD + (Number(adding.d) || 0) > deps.diurnalLimit,
                            inverted: inverted(candidate.name, row.keyDay, turn)
                        };
                    })
                    .filter(candidate => !candidate.overLimit)
                    .sort((a, b) =>
                        Number(a.inverted) - Number(b.inverted) ||
                        a.hhee - b.hhee ||
                        (Number(b.grade) || 0) - (Number(a.grade) || 0) ||
                        a.name.localeCompare(b.name)
                    );
                const pick = ranked[0];

                if (!pick) {
                    unresolved.push({
                        keyDay: row.keyDay,
                        slot,
                        missing: 1,
                        replaced: gap?.name || "",
                        cupo: Boolean(cupo),
                        reason: "Nadie disponible sin pasar el tope de horas extras ni chocar con sus turnos."
                    });
                    slots.forEach(item => bump(row.keyDay, item, 1));
                    continue;
                }

                covers.push({
                    type: "cover",
                    keyDay: row.keyDay,
                    slot,
                    turn,
                    worker: pick.name,
                    hhee: pick.hhee,
                    grade: pick.grade,
                    inverted: pick.inverted,
                    replaced: gap?.name || "",
                    cupo: cupo || null,
                    alternatives: ranked.slice(1, 4).map(item => ({ name: item.name, hhee: item.hhee, grade: item.grade }))
                });

                const planned = plannedHours.get(pick.name) || { d: 0, n: 0 };

                plannedHours.set(pick.name, { d: planned.d + (Number(adding.d) || 0), n: planned.n + (Number(adding.n) || 0) });
                setTurn(pick.name, row.keyDay, turn);
                markBusy(pick.name, row.keyDay);
                slots.forEach(item => bump(row.keyDay, item, 1));
            }
        }
    }

    const surplus = rows.flatMap(row => ["day", "night"]
        .filter(slot => cellCount(row.keyDay, slot) > target)
        .map(slot => ({ keyDay: row.keyDay, slot, extra: cellCount(row.keyDay, slot) - target })));

    return { target, swaps, moves, covers, unresolved, surplus };
}

/** Los movimientos agrupados por trabajador (consejo "Mover N turnos de X"). */
export function movesByWorker(moves) {
    const groups = new Map();

    (moves || []).forEach(move => {
        if (!groups.has(move.name)) groups.set(move.name, []);
        groups.get(move.name).push(move);
    });

    return [...groups.entries()]
        .map(([name, items]) => ({ name, items }))
        .sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
}
