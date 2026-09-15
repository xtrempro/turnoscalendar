import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// El modal ofrece "Todos" para asignar a alguien que ese dia no esta citado al
// turno. El saneado de la semana corre en CADA pintado: si ahi se filtrara por
// turno, guardar a esa persona y perderla serian el mismo gesto.

const readSource = () => readFile(
    new URL("../js/taskAssignments.js", import.meta.url),
    "utf8"
);

test("el saneado semanal solo quita a quien ese dia no puede trabajar", async () => {
    const source = await readSource();

    assert.match(
        source,
        /const availableWorkers = assignmentWorkers\(entry\)\s*\n\s*\.filter\(name => \{[\s\S]{0,260}!hasBlockingAbsence\(name, keyDay, shift\)/
    );
    // Y no vuelve a exigir estar citado al turno, que es lo que borraba en
    // silencio a los asignados desde "Todos".
    assert.doesNotMatch(
        source,
        /const availableWorkers = assignmentWorkers\(entry\)[\s\S]{0,320}isAvailableForShift/
    );
});

test("el saneado sigue soltando perfiles borrados o inactivos", async () => {
    const source = await readSource();

    assert.match(
        source,
        /const availableWorkers = assignmentWorkers\(entry\)[\s\S]{0,320}isProfileActive\(profile\)/
    );
});

test("las reglas de trabajador predefinido siguen exigiendo estar en turno", async () => {
    const source = await readSource();

    // Una regla automatica no debe meter a nadie en su dia libre: solo vale
    // cuando lo decide el supervisor a mano.
    assert.match(
        source,
        /function applyDefaultAssignments[\s\S]{0,900}!isAvailableForShift\(profile, keyDay, shift\)/
    );
});

test("el chip fuera de turno se marca en vez de esconderse", async () => {
    const source = await readSource();
    const styles = await readFile(
        new URL("../styles.css", import.meta.url),
        "utf8"
    );

    assert.match(source, /!isScheduledForShift\(profile, keyDay, task\.shift\)/);
    assert.match(source, /task-assignment-worker-chip--off-shift/);
    // Desde 2026-09-15 va en el title junto a las ultimas tareas, como texto.
    assert.match(source, /Fuera de su turno este día/);
    assert.match(
        styles,
        /\.task-assignment-worker-chip--off-shift \{[^}]*border-style: dashed;/
    );
});
