// Regla del detalle de turnos que consume la PWA: sin asignacion de turno y con
// rotativa de 3er/4to turno no hay base contra la cual medir "lo extra", asi que
// el resumen mensual publica TODOS los turnos del mes (kind "all", horas reales)
// y marca detailScope: "all" para que la PWA titule "Turnos realizados".
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const hoursReport = await readFile(
    new URL("../js/hoursReport.js", import.meta.url),
    "utf8"
);
const summary = hoursReport.match(
    /export async function buildWorkerHheeMonthSummary\([\s\S]*?\n}/
)?.[0] || "";

test("la excepcion exige sin asignacion Y rotativa de 3er/4to turno", () => {
    assert.notEqual(summary, "", "no se encontro buildWorkerHheeMonthSummary");
    assert.match(summary, /getShiftAssigned\(profile\.name, monthDate\)/);
    assert.match(summary, /3turno/);
    assert.match(summary, /4turno/);
    // Debe ser negacion de la asignacion: aplica a quien NO la tiene.
    assert.match(summary, /!getShiftAssigned/);
});

test("esos trabajadores usan el detalle completo, no solo los extra", () => {
    assert.match(summary, /showsAllShifts[\s\S]*?\?\s*"all"[\s\S]*?:\s*"extra-only"/);
    // Reemplazo conserva su propio modo.
    assert.match(summary, /isReplacement[\s\S]*?\?\s*"replacement"/);
});

test("el resumen publica detailScope para que la PWA titule la seccion", () => {
    assert.match(summary, /detailScope: showsAllShifts \? "all" : "extra"/);
});

test("el kind \"all\" de buildDayRows reporta horas trabajadas, no el excedente", () => {
    const rows = hoursReport.match(/function buildDayRows\([\s\S]*?\n}/)?.[0] || "";

    assert.notEqual(rows, "", "no se encontro buildDayRows");
    // Solo "extra-only" usa las horas extra; el resto usa las reales.
    assert.match(rows, /horasDiurnas: kind === "extra-only"\s*\?\s*extraHours\.d\s*:\s*actualHours\.d/);
    assert.match(rows, /horasNocturnas: kind === "extra-only"\s*\?\s*extraHours\.n\s*:\s*actualHours\.n/);
});
