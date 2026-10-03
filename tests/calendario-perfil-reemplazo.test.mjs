import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const calendar = await readFile(
    new URL("../js/calendar.js", import.meta.url),
    "utf8"
);

test("todo turno de un perfil Reemplazo lleva su leyenda", () => {
    assert.match(
        calendar,
        /isReplacementWorkDay \? \["Reemplazo"\] : \[\]/
    );
});

test("el hover enumera todos los titulares de contratos superpuestos", () => {
    assert.match(calendar, /getReplacementContractsForDate\(activeProfile, keyDay\)/);
    assert.match(
        calendar,
        /Reemplazo de \$\{replacementContractTargets\.join\(", "\)\}/
    );
});

test("la edicion trata la rotativa de Reemplazo como base Libre", () => {
    assert.match(
        calendar,
        /function getEditableCalendarBaseTurn\([\s\S]{0,220}if \(isReplacementProfile\(profileName, keyDay\)\) return TURNO\.LIBRE;/
    );
});

test("el respaldo conserva la base heredada del contrato de Reemplazo", () => {
    const start = calendar.indexOf("function getManualExtraTurn(");
    const end = calendar.indexOf("function getPendingManualExtraTurn(", start);
    const block = calendar.slice(start, end);

    assert.match(
        block,
        /const baseWithSwaps = getEditableBaseShift\(\s*profileName,\s*keyDay,\s*projectedBaseTurn\s*\)/
    );
    assert.doesNotMatch(block, /getEditableCalendarBaseTurn\(/);
});

test("un Reemplazo sin rotativa propia pinta sus tramos manuales como extra", () => {
    assert.match(
        calendar,
        /const manualExtra = Boolean\(\s*manualExtraTurn &&[\s\S]{0,180}\(shiftAssigned \|\| isReplacementWorkDay\)\s*\)/
    );
});
