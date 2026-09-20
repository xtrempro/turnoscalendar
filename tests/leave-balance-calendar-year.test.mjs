import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mainSrc = await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
);

function functionBody(name) {
    const match = new RegExp(
        `(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`
    ).exec(mainSrc);

    assert.ok(match, `No se encontro la funcion ${name}.`);

    let depth = 0;
    const start = match.index + match[0].length - 1;

    for (let index = start; index < mainSrc.length; index++) {
        const char = mainSrc[index];

        if (char === "{") depth++;
        if (char === "}") depth--;

        if (depth === 0) {
            return mainSrc.slice(start + 1, index);
        }
    }

    assert.fail(`No se pudo leer el cuerpo de ${name}.`);
}

test("los saldos del calendario usan el anio visible, no el anio real", () => {
    const legal = functionBody("activarSelectorLegal");
    const comp = functionBody("activarSelectorComp");
    const admin = functionBody("activarSelectorAdmin");
    const halfAdmin = functionBody("activarSelectorHalfAdmin");

    assert.match(legal, /const year = currentDate\.getFullYear\(\);/);
    assert.match(legal, /getCalendarLeaveBalances\(holidays\)\.legal/);
    assert.doesNotMatch(legal, /new Date\(\)\.getFullYear\(\)/);

    assert.match(comp, /const year = currentDate\.getFullYear\(\);/);
    assert.match(comp, /getCalendarLeaveBalances\(holidays\)\.comp/);
    assert.doesNotMatch(comp, /new Date\(\)\.getFullYear\(\)/);

    assert.match(admin, /getCalendarLeaveBalances\(\)\.admin/);
    assert.doesNotMatch(admin, /getLeaveBalances\(\)\.admin/);
    assert.match(halfAdmin, /getCalendarLeaveBalances\(\)\.admin/);
    assert.doesNotMatch(halfAdmin, /getLeaveBalances\(\)\.admin/);
});

test("la edicion de saldos guarda en el mismo anio que muestra el perfil", () => {
    const edit = functionBody("handleAvailabilityEdit");
    const save = functionBody("saveAvailabilityBalancesFromInputs");

    assert.match(edit, /const year = currentDate\.getFullYear\(\);/);
    assert.doesNotMatch(edit, /const year = new Date\(\)\.getFullYear\(\);/);

    assert.match(save, /const year = currentDate\.getFullYear\(\);/);
    assert.doesNotMatch(save, /const year = new Date\(\)\.getFullYear\(\);/);
});
