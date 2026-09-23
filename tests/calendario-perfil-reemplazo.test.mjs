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
        /isReplacementProfile\(profileName, keyDay\)\s*\n\s*\? TURNO\.LIBRE\s*\n\s*: projectedBaseTurn/
    );
});
