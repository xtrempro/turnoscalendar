// La notificacion de turno extra dice a quien reemplaza el trabajador (o el
// motivo), y los resumenes de HH.EE cubren tambien los meses siguientes: un
// turno extra cargado para el mes proximo debe verse apenas se agrega.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const replacements = await readFile(
    new URL("../js/replacements.js", import.meta.url), "utf8"
);
const hoursReport = await readFile(
    new URL("../js/hoursReport.js", import.meta.url), "utf8"
);
const serverEngine = await readFile(
    new URL("../js/serverEngine.js", import.meta.url), "utf8"
);
// El bundle es un artefacto de build (gitignored): si no esta, no hay nada que
// validar; si esta, tiene que llevar el cambio antes de desplegar la function.
const engineBundle = await readFile(
    new URL("../functions/engine/engine.mjs", import.meta.url), "utf8"
).catch(() => "");

test("la notificacion arma el detalle del reemplazo o el motivo", () => {
    assert.match(replacements, /const extraShiftDetail = hasReplacedWorker/);
    assert.match(replacements, /"Cubres como prestamo a" : "Reemplazas a"\} \$\{data\.replaced\}/);
    assert.match(replacements, / por \$\{absenceType\}/);
    assert.match(replacements, /Motivo: \$\{String\(data\.reason \|\| absenceType\)\.trim\(\)\}/);
});

test("el detalle se adjunta al mensaje del turno extra", () => {
    assert.match(
        replacements,
        /Se agrego un turno extra para el \$\{formatNotificationDate\(record\.date\)\}\.`,\s*\n\s*extraShiftDetail\s*\n\s*\]\.filter\(Boolean\)\.join\(" "\)/
    );
});

test("buildWorkerHheeSummaries acepta meses hacia adelante", () => {
    const fn = hoursReport.match(
        /export async function buildWorkerHheeSummaries\([\s\S]*?\n}/
    )?.[0] || "";

    assert.notEqual(fn, "", "no se encontro buildWorkerHheeSummaries");
    assert.match(fn, /monthsForward = 0/);
    assert.match(fn, /offset <= monthsForward/);
    assert.match(fn, /today\.getMonth\(\) \+ offset/);
});

test("el engine publica los meses siguientes, no solo los pasados", () => {
    assert.match(serverEngine, /const OVERTIME_SUMMARY_MONTHS_FORWARD = 3;/);
    assert.match(
        serverEngine,
        /buildWorkerHheeSummaries\(\s*\n?\s*profile, OVERTIME_SUMMARY_MONTHS_BACK, OVERTIME_SUMMARY_MONTHS_FORWARD\s*\n?\s*\)/
    );
    // El bundle desplegado tiene que llevar el cambio: la Cloud Function corre
    // engine.mjs, no el fuente.
    if (!engineBundle) return;

    assert.match(engineBundle, /OVERTIME_SUMMARY_MONTHS_FORWARD = 3/);
    assert.match(engineBundle, /offset <= monthsForward/);
});
