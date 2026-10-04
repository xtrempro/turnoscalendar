// Ayuda para cubrir el mes (Calendario Mensual): un plan para dejar todos los
// turnos de Titulares con la MISMA cantidad de gente, gastando lo menos posible.
//
// En orden, y cada paso cuenta con que los anteriores se aplican:
//   1. Mover turnos: el turno de un titular que sobra (supernumerario) pasa a
//      un turno al que le falta gente, otro dia o el mismo (de Larga a Noche).
//      Va en CASCADA por tipo de trabajador: primero los de 3er turno, despues
//      los de 4to turno con contrato de reemplazo y al final los de 4to turno a
//      contrata o planta. Los movimientos de una misma persona se encadenan
//      (su Noche del 2 pasa al 3 y deja libre el 2 para su Noche del 1): se
//      validan contra el calendario YA modificado por el plan. Si en el destino
//      hay un ausente sin cubrir, lo cubre (sin horas extras: es su turno).
//   2. Pasar a turno a alguien de rotativa diurna: si a un grupo del 4to turno
//      le sigue faltando gente en varios turnos, una persona de la profesion
//      que hace Diurno entra a ese grupo desde el primero (cambio de rotativa).
//   3. Cubrir con horas extras lo que siga faltando (ausencias y cupos de la
//      Brecha): primero quien tiene menos horas extras en el mes, sin pasar el
//      tope mensual, y despues el de grado mas alto (su hora extra cuesta menos).
// El 24 invertido se evita siempre: solo aparece si no hay otra salida (y la
// unidad lo permite), marcado. Un movimiento nunca arma un 24.
//
// No lee ni escribe nada por su cuenta: todo llega por `deps`, para que el
// mismo plan se pueda probar sin la pagina.

import { TURNO } from "./constants.js";
import { moveShiftCreatesInvertedTwentyFour } from "./rulesEngine.js";

export const SLOT_TURN = { day: TURNO.LARGA, night: TURNO.NOCHE };

// Desde cuantos turnos sin cubrir de un mismo grupo conviene pasar a alguien
// de Diurno a ese grupo (con uno solo, una hora extra es menos invasivo).
export const ROTATION_MIN_CELLS = 2;

// Cascada: quien se mueve primero.
export const MOVE_TIERS = [
    { id: 1, label: "3er turno" },
    { id: 2, label: "4to turno con contrato de reemplazo" },
    { id: 3, label: "4to turno a contrata o planta" }
];

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
 * Orden para aplicar los movimientos de una persona: el que libera un dia va
 * antes que el que llega a ese dia (si no, el segundo encontraria el dia
 * ocupado y armaria un 24).
 */
export function orderMovesForApply(moves) {
    const pending = [...(moves || [])];
    const ordered = [];

    while (pending.length) {
        const index = pending.findIndex(move => !pending.some(other =>
            other !== move &&
            other.name === move.name &&
            other.sourceKey === move.targetKey &&
            other.sourceKey !== other.targetKey
        ));
        const next = pending.splice(index === -1 ? 0 : index, 1)[0];

        ordered.push(next);
    }

    return ordered;
}

/**
 * @param {Object} model   el del Calendario Mensual (buildMonthlyCalendar)
 * @param {Object} deps
 *   tierOf(name, keyDay)       1 | 2 | 3 (cascada) o 0 si no se mueve
 *   canMoveSource(name, keyDay) su turno base L/N, sin cambios ni marcajes
 *   dayBlock(name, keyDay)     "" o motivo (permiso, ausencia, marcaje...)
 *   allowInverted              la unidad permite el 24 invertido
 *   turnAt(name, keyDay)       turno real del dia (numero)
 *   baseTurn(name, keyDay)
 *   neededTurnFor(absentName, keyDay)
 *   candidatesFor({ reference, keyDay, turn }) -> Promise<[{ name, hheeD,
 *       hheeN, isFree, blockedDay, isForced, isLinked, needsContract, grade }]>
 *   extraHours(keyDay, turn) -> { d, n } que suma cubrirlo
 *   diurnalLimit               tope mensual de horas extras diurnas
 *   shouldContinue()           false para cortar (cambio de mes)
 *   diurnoWorkers()            (opcional) quienes hacen Diurno en la profesion
 *   firstTurnFor(letter, keyDay) -> { firstTurn, label } para entrar al grupo
 *   affectedFrom(name, keyDay) -> Promise<[{ label, count }]> lo que se pierde
 *   minStartKey                el primer dia en que se puede cambiar (manana)
 *   pendingRequestFor({ replaced, keyDay, turn, cupoKey }) -> solicitud
 *                              pendiente en la app de alguien, o null
 */
export async function planMonth(model, deps) {
    const target = targetPerShift(model);
    const rows = model?.rows || [];
    const rowByKey = new Map(rows.map(row => [row.keyDay, row]));
    const count = new Map();
    const overlay = new Map();
    const plannedHours = new Map();
    const claimedGaps = new Set();
    // Dias que ya movio o recibio cada persona: no se vuelven a mover.
    const touched = new Map();
    const moves = [];
    const covers = [];
    const unresolved = [];
    // Turnos con una solicitud pendiente en la app de alguien.
    const waiting = [];

    rows.forEach(row => {
        ["day", "night"].forEach(slot => count.set(cellId(row.keyDay, slot), row.slots?.[slot]?.length || 0));
    });

    // Nada del plan toca un dia anterior a `minStartKey` (manana): ni el
    // origen ni el destino de un movimiento, ni una hora extra, ni un cambio de
    // rotativa. Un turno ya hecho no se reescribe.
    const actionableRows = rows.filter(row =>
        !deps.minStartKey || dayIndex(row.keyDay) >= dayIndex(deps.minStartKey)
    );

    const turnAt = (name, keyDay) => {
        const planned = overlay.get(name)?.get(keyDay);

        return planned !== undefined ? planned : Number(deps.turnAt(name, keyDay)) || TURNO.LIBRE;
    };
    const setTurn = (name, keyDay, turn) => {
        if (!overlay.has(name)) overlay.set(name, new Map());
        overlay.get(name).set(keyDay, turn);
    };
    const touch = (name, keyDay) => {
        if (!touched.has(name)) touched.set(name, new Set());
        touched.get(name).add(keyDay);
    };
    const isTouched = (name, keyDay) => Boolean(touched.get(name)?.has(keyDay));
    // Contra el calendario CON el plan: el dia de origen ya quedo libre.
    const inverted = (name, keyDay, turn, freedKey = "") => {
        const around = offset => {
            const key = offsetKey(keyDay, offset);

            return key === freedKey ? TURNO.LIBRE : turnAt(name, key);
        };

        return moveShiftCreatesInvertedTwentyFour(turn, around(-1), around(1));
    };
    const cellCount = (keyDay, slot) => count.get(cellId(keyDay, slot)) || 0;
    const bump = (keyDay, slot, delta) => count.set(cellId(keyDay, slot), cellCount(keyDay, slot) + delta);
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

    if (!target) return { target, moves, rotations: [], covers, waiting, unresolved, surplus: [] };

    // El mejor destino para el turno de `name` que sobra en (sourceKey, slot).
    function bestTarget(name, sourceKey, slot) {
        const sourceTurn = Number(deps.baseTurn(name, sourceKey)) || SLOT_TURN[slot];
        let best = null;

        for (const row of actionableRows) {
            for (const targetSlot of ["day", "night"]) {
                if (cellCount(row.keyDay, targetSlot) >= target) continue;

                const targetKey = row.keyDay;
                const sameDay = targetKey === sourceKey;
                const destinationTurn = SLOT_TURN[targetSlot];

                if (sameDay && targetSlot === slot) continue;
                // El destino tiene que quedar libre para esa persona: nunca un 24.
                if (!sameDay && turnAt(name, targetKey) !== TURNO.LIBRE) continue;
                if (!sameDay && isTouched(name, targetKey)) continue;
                if (!sameDay && deps.dayBlock(name, targetKey)) continue;

                const isInverted = inverted(name, targetKey, destinationTurn, sourceKey);

                if (isInverted && !deps.allowInverted) continue;

                const backed =
                    (row.gaps?.[targetSlot]?.length || 0) +
                    (row.cupos?.[targetSlot]?.length || 0) > 0;
                const score =
                    (isInverted ? 1000 : 0) +
                    Math.abs(dayIndex(targetKey) - dayIndex(sourceKey)) +
                    (backed ? 0 : 3) +
                    (sourceTurn !== destinationTurn ? 1 : 0);

                if (!best || score < best.score) {
                    best = { score, sourceTurn, targetKey, targetSlot, destinationTurn, inverted: isInverted };
                }
            }
        }

        return best;
    }

    // 1. Mover turnos, en cascada; varias vueltas porque un movimiento libera
    // dias que habilitan otros de la misma persona.
    for (const tier of MOVE_TIERS) {
        let changed = true;
        let passes = 0;

        while (changed && passes < 8) {
            changed = false;
            passes += 1;

            for (const row of actionableRows) {
                for (const slot of ["day", "night"]) {
                    while (cellCount(row.keyDay, slot) > target) {
                        if (deps.shouldContinue && !deps.shouldContinue()) return null;

                        let best = null;

                        for (const person of row.slots?.[slot] || []) {
                            const name = person.name;

                            if (!isOwnShift(person)) continue;
                            if (deps.tierOf(name, row.keyDay) !== tier.id) continue;
                            if (isTouched(name, row.keyDay)) continue;
                            if (turnAt(name, row.keyDay) !== (Number(deps.baseTurn(name, row.keyDay)) || TURNO.LIBRE)) continue;
                            if (!deps.canMoveSource(name, row.keyDay)) continue;

                            const option = bestTarget(name, row.keyDay, slot);

                            if (option && (!best || option.score < best.score || (option.score === best.score && name < best.name))) {
                                best = { ...option, name };
                            }
                        }

                        if (!best) break;

                        moves.push({
                            type: "move",
                            tier: tier.id,
                            name: best.name,
                            sourceKey: row.keyDay,
                            sourceSlot: slot,
                            sourceTurn: best.sourceTurn,
                            targetKey: best.targetKey,
                            targetSlot: best.targetSlot,
                            destinationTurn: best.destinationTurn,
                            sameDay: best.targetKey === row.keyDay,
                            covers: claimGap(best.targetKey, best.targetSlot, best.destinationTurn),
                            cupo: !rowByKey.get(best.targetKey)?.gaps?.[best.targetSlot]?.length &&
                                Boolean(rowByKey.get(best.targetKey)?.cupos?.[best.targetSlot]?.length),
                            cupoGroup: String(rowByKey.get(best.targetKey)?.cupos?.[best.targetSlot]?.[0]?.group || ""),
                            inverted: best.inverted
                        });

                        if (best.targetKey !== row.keyDay) setTurn(best.name, row.keyDay, TURNO.LIBRE);
                        setTurn(best.name, best.targetKey, best.destinationTurn);
                        touch(best.name, row.keyDay);
                        touch(best.name, best.targetKey);
                        bump(row.keyDay, slot, -1);
                        bump(best.targetKey, best.targetSlot, 1);
                        changed = true;
                    }
                }
            }
        }
    }

    // 2. Pasar a turno a alguien de rotativa diurna: si a un grupo del 4to
    // turno le sigue faltando gente en varios turnos del mes, una persona de
    // la misma profesion que hace Diurno entra a ese grupo desde el primero
    // de esos turnos (cambio de rotativa, no horas extras). Una persona por
    // grupo, y nunca en una fecha ya pasada.
    const claimedCupos = new Map();
    const rotations = [];

    if (deps.diurnoWorkers) {
        const byGroup = new Map();

        actionableRows.forEach(row => {
            if (deps.minStartKey && dayIndex(row.keyDay) < dayIndex(deps.minStartKey)) return;

            ["day", "night"].forEach(slot => {
                const missing = target - cellCount(row.keyDay, slot);

                (row.cupos?.[slot] || []).slice(0, Math.max(0, missing)).forEach(cupo => {
                    const letter = String(cupo.group || "").trim();

                    if (!letter) return;
                    if (!byGroup.has(letter)) byGroup.set(letter, []);
                    byGroup.get(letter).push({ keyDay: row.keyDay, slot });
                });
            });
        });

        const available = [...(deps.diurnoWorkers() || [])];

        for (const [letter, cells] of [...byGroup.entries()].sort((a, b) => b[1].length - a[1].length)) {
            if (cells.length < ROTATION_MIN_CELLS || !available.length) continue;

            const startKey = cells[0].keyDay;
            const first = deps.firstTurnFor(letter, startKey);

            if (!first) continue;

            const ranked = [];

            // Las que el supervisor descarto este mes para este grupo, no.
            for (const name of available.filter(item => !deps.isRotationDismissed?.(item, letter))) {
                const affected = await deps.affectedFrom(name, startKey);

                ranked.push({
                    name,
                    affected,
                    lost: (affected || []).reduce((sum, item) => sum + (Number(item.count) || 0), 0)
                });
            }

            ranked.sort((a, b) => a.lost - b.lost || a.name.localeCompare(b.name));

            const pick = ranked[0];

            if (!pick) continue;

            available.splice(available.indexOf(pick.name), 1);
            rotations.push({
                type: "rotation",
                name: pick.name,
                group: letter,
                startKey,
                firstTurn: first.firstTurn,
                firstTurnLabel: first.label,
                fills: cells.length,
                affected: pick.affected || [],
                alternatives: ranked.slice(1, 4).map(item => item.name),
                cells
            });
            // Los cupos NO se dan por cubiertos: las horas extras siguen
            // apareciendo para esos turnos, como alternativa al cambio de
            // rotativa (marcadas, ver `alsoByRotation`).
        }
    }

    // Turnos que cubriria un cambio de rotativa propuesto (por grupo).
    const rotationCells = new Map();

    rotations.forEach(rotation => (rotation.cells || []).forEach(cell => {
        rotationCells.set(`${cellId(cell.keyDay, cell.slot)}|${rotation.group}`, rotation.name);
    }));

    // 3. Horas extras para lo que siga faltando.

    for (const row of actionableRows) {
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
                // La clave de ESTE cupo (puede haber dos el mismo turno): la
                // usa la solicitud a la app para no confundirlos.
                const cupoKey = cupo ? `${cupo.motive}|${row.keyDay}|${slot}|${cupoIndex}` : "";

                if (gap) claimedGaps.add(cellId(row.keyDay, gap.name));
                else claimedCupos.set(cellId(row.keyDay, slot), cupoIndex + 1);

                // Ya se le pidio a alguien desde la app: se espera su respuesta.
                const pending = deps.pendingRequestFor?.({
                    replaced: gap?.name || "",
                    keyDay: row.keyDay,
                    turn,
                    cupoKey
                });

                if (pending) {
                    waiting.push({
                        keyDay: row.keyDay,
                        slot,
                        turn,
                        replaced: gap?.name || "",
                        cupo: cupo || null,
                        worker: pending.worker
                    });
                    slots.forEach(item => bump(row.keyDay, item, 1));
                    continue;
                }

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
                        // Libre tambien con el plan (no le llega un turno movido).
                        turnAt(candidate.name, row.keyDay) === TURNO.LIBRE &&
                        !isTouched(candidate.name, row.keyDay)
                    )
                    .map(candidate => {
                        const planned = plannedHours.get(candidate.name) || { d: 0, n: 0 };
                        const hheeD = (Number(candidate.hheeD) || 0) + planned.d;
                        const hhee = hheeD + (Number(candidate.hheeN) || 0) + planned.n;

                        return {
                            ...candidate,
                            // Sus horas diurnas del mes SIN lo que este mismo plan
                            // ya le reparte: el modal suma lo que quede marcado.
                            baseD: Number(candidate.hheeD) || 0,
                            hheeD,
                            hhee,
                            overLimit: hheeD + (Number(adding.d) || 0) > deps.diurnalLimit,
                            inverted: inverted(candidate.name, row.keyDay, turn)
                        };
                    })
                    .filter(candidate => !candidate.overLimit && (!candidate.inverted || deps.allowInverted))
                    .sort((a, b) =>
                        Number(a.inverted) - Number(b.inverted) ||
                        a.hhee - b.hhee ||
                        (Number(b.grade) || 0) - (Number(a.grade) || 0) ||
                        a.name.localeCompare(b.name)
                    );
                const pick = ranked[0];

                // Nadie por horas extras, pero lo cubre un cambio de rotativa
                // propuesto: no es "sin solucion".
                if (!pick && cupo && rotationCells.has(`${cellId(row.keyDay, slot)}|${String(cupo.group || "")}`)) {
                    slots.forEach(item => bump(row.keyDay, item, 1));
                    continue;
                }

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
                    baseD: pick.baseD,
                    // Horas diurnas que suma este turno a quien lo cubra.
                    addD: Number(adding.d) || 0,
                    grade: pick.grade,
                    inverted: pick.inverted,
                    replaced: gap?.name || "",
                    cupo: cupo || null,
                    cupoKey,
                    alternatives: ranked.slice(1, 4).map(item => ({ name: item.name, hhee: item.hhee, baseD: item.baseD, grade: item.grade }))
                });

                const planned = plannedHours.get(pick.name) || { d: 0, n: 0 };

                plannedHours.set(pick.name, { d: planned.d + (Number(adding.d) || 0), n: planned.n + (Number(adding.n) || 0) });
                setTurn(pick.name, row.keyDay, turn);
                touch(pick.name, row.keyDay);
                slots.forEach(item => bump(row.keyDay, item, 1));
            }
        }
    }

    // Las horas extras de un turno que tambien cubriria un cambio de rotativa
    // propuesto: es la alternativa; si se aplica el cambio, salen de la lista.
    covers.forEach(cover => {
        const group = String(cover.cupo?.group || "");

        if (!group) return;

        cover.alsoByRotation = rotationCells.get(`${cellId(cover.keyDay, cover.slot)}|${group}`) || "";
    });

    const surplus = actionableRows.flatMap(row => ["day", "night"]
        .filter(slot => cellCount(row.keyDay, slot) > target)
        .map(slot => ({ keyDay: row.keyDay, slot, extra: cellCount(row.keyDay, slot) - target })));

    return { target, moves, rotations, covers, waiting, unresolved, surplus };
}

/**
 * Los movimientos agrupados por persona, en el orden de la cascada (3er
 * turno, 4to turno de reemplazo, 4to turno contrata/planta) y, dentro, de mas
 * a menos movimientos.
 */
export function movesByWorker(moves) {
    const groups = new Map();

    (moves || []).forEach(move => {
        if (!groups.has(move.name)) groups.set(move.name, { name: move.name, tier: move.tier, items: [] });
        groups.get(move.name).items.push(move);
    });

    return [...groups.values()]
        .map(group => ({
            ...group,
            items: [...group.items].sort((a, b) => dayIndex(a.sourceKey) - dayIndex(b.sourceKey))
        }))
        .sort((a, b) =>
            (a.tier || 9) - (b.tier || 9) ||
            b.items.length - a.items.length ||
            a.name.localeCompare(b.name)
        );
}
