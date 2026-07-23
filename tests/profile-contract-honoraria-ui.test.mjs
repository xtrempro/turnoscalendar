import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");

test("honorarios muestra rotativa despues del valor hora y usa tope semanal", () => {
    const hourlyRateIndex = html.indexOf("honorariaHourlyRateField");
    const rotationSlotIndex = html.indexOf("honorariaRotationSlot");
    const maxHoursIndex = html.indexOf("honorariaMaxMonthlyHoursField");

    assert.ok(hourlyRateIndex > -1);
    assert.ok(rotationSlotIndex > hourlyRateIndex);
    assert.ok(maxHoursIndex > rotationSlotIndex);
    assert.match(html, /M&aacute;ximo de horas semanales:/);
});

test("honorarios oculta grado, permiso gremial y asignacion de turno", () => {
    assert.match(html, /id="profileGradeRow"/);
    assert.match(main, /function contractBlocksGrade\(data = profileDraft\)[\s\S]*isHonorariaDraft\(data\)/);
    assert.match(main, /function contractBlocksUnionLeave\(data = profileDraft\)[\s\S]*isHonorariaDraft\(data\)/);
    assert.match(main, /function contractBlocksShiftAssignment\(data = profileDraft\)[\s\S]*isHonorariaDraft\(data\)/);
    assert.match(main, /grade: gradeBlocked \? "" : profileDraft\.grade/);
    assert.match(main, /const nextShiftAssigned =\s*!shiftAssignmentBlocked/);
});

test("otros es tipo de contrato y no usa grado, permiso gremial ni asignacion", () => {
    assert.match(html, /<option value="Otros">Otros<\/option>/);
    assert.match(main, /function contractBlocksGrade\(data = profileDraft\)[\s\S]*isOtherContractType\(data\.contractType\)/);
    assert.match(main, /function contractBlocksUnionLeave\(data = profileDraft\)[\s\S]*isOtherContractType\(data\.contractType\)/);
    assert.match(main, /function contractBlocksShiftAssignment\(data = profileDraft\)[\s\S]*isOtherContractType\(data\.contractType\)/);
});
