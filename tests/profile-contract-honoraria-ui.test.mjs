import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");

test("honorarios lista contratos y agrega via modal (sin campos inline)", () => {
    const listIndex = html.indexOf("honorariaContractList");
    const addBtnIndex = html.indexOf("honorariaAddContractBtn");

    assert.ok(listIndex > -1);
    assert.ok(addBtnIndex > listIndex);
    // El formulario ya no tiene campos inline: el contrato se crea con el modal.
    assert.ok(!html.includes("honorariaHourlyRateField"));
    assert.ok(!html.includes("honorariaMaxMonthlyHoursField"));
    assert.ok(!html.includes("honorariaStartField"));
    // El boton abre el mismo modal interactivo del calendario.
    assert.match(
        main,
        /honorariaAddContractBtn\.onclick[\s\S]{0,500}openHonorariaContractModal/
    );
    assert.match(main, /L&iacute;mite de horas mensuales/);
    assert.doesNotMatch(main, /data-period="weekly"/);
    assert.doesNotMatch(main, />Semanal<\/button>/);
    assert.match(main, /limitPeriod: "monthly"/);
});

test("honorarios oculta grado, permiso gremial y asignacion de turno", () => {
    assert.match(html, /id="profileGradeRow"/);
    assert.match(main, /function contractBlocksGrade\(data = profileDraft\)[\s\S]*isHonorariaDraft\(data\)/);
    assert.match(main, /function contractBlocksUnionLeave\(data = profileDraft\)[\s\S]*isHonorariaDraft\(data\)/);
    assert.match(main, /function contractBlocksShiftAssignment\(data = profileDraft\)[\s\S]*isHonorariaDraft\(data\)/);
    assert.match(main, /grade: gradeBlocked \? "" : profileDraft\.grade/);
    assert.match(main, /const nextShiftAssigned =\s*!shiftAssignmentBlocked/);
});

test("honorarios oculta vacaciones y bloquea permisos admin/legal/sin goce", () => {
    assert.match(html, /id="profileAvailabilityCard"/);
    assert.match(
        main,
        /function contractBlocksLeaveBenefits\(data = profileDraft\)[\s\S]{0,160}isHonorariaDraft\(data\)/
    );
    // El recuadro de vacaciones se oculta para honorarios.
    assert.match(
        main,
        /profileAvailabilityCard[\s\S]{0,160}blocksLeaveBenefits/
    );
    // Los botones de permiso quedan deshabilitados.
    assert.match(main, /adminBtn\.disabled = blocksLeaveBenefits/);
    assert.match(main, /halfAdminMorningBtn\.disabled = blocksLeaveBenefits/);
    assert.match(main, /halfAdminAfternoonBtn\.disabled = blocksLeaveBenefits/);
    assert.match(main, /legalBtn\.disabled = blocksLeaveBenefits/);
    assert.match(main, /unpaidLeaveBtn\.disabled = blocksLeaveBenefits/);
});

test("otros es tipo de contrato y no usa grado, permiso gremial ni asignacion", () => {
    assert.match(html, /<option value="Otros">Otros<\/option>/);
    assert.match(main, /function contractBlocksGrade\(data = profileDraft\)[\s\S]*isOtherContractType\(data\.contractType\)/);
    assert.match(main, /function contractBlocksUnionLeave\(data = profileDraft\)[\s\S]*isOtherContractType\(data\.contractType\)/);
    assert.match(main, /function contractBlocksShiftAssignment\(data = profileDraft\)[\s\S]*isOtherContractType\(data\.contractType\)/);
});
