// Un trabajador a reemplazo que toma UN turno de un ausente con mas dias en el
// mismo permiso: se pregunta si cubre solo ese turno o hereda todos.
//
// Antes, si ya tenia un contrato vigente (por otro ausente), se asignaba solo
// el turno elegido sin preguntar. Y si el permiso caia entero dentro de su
// contrato, el editor avisaba "ya esta cubierto" y no heredaba nada.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const leer = ruta => readFile(new URL(ruta, import.meta.url), "utf8");
const calendar = await leer("../js/calendar.js");
const main = await leer("../js/main.js");

const pregunta = calendar.slice(
    calendar.indexOf("async function askInheritReplacementTurns"),
    calendar.indexOf("function getExtraReasonMatches(")
);

test("solo pregunta si hay mas turnos del mismo permiso que heredar", () => {
    assert.match(pregunta, /!isReplacementProfile\(worker\)/);
    // Ya lo cubre un contrato por ese mismo ausente: nada que preguntar.
    assert.match(pregunta, /\.some\(contract => contract\.replaces === replaced\)/);
    // Permiso de un solo dia: no hay nada mas que heredar.
    assert.match(pregunta, /if \(!span \|\| span\.start === span\.end\) return false;/);
    assert.match(pregunta, /confirmText: "Heredar sus turnos",\s*cancelText: "Solo este turno"/);
});

test("desde las sugerencias: con contrato vigente pregunta y hereda con el editor", () => {
    assert.match(
        calendar,
        /hasContractForDate\(coveringWorker, keyDay\) &&\s*await askInheritReplacementTurns\(\{\s*worker: coveringWorker,\s*replaced: profileName,\s*keyDay\s*\}\)\s*\) \{\s*close\(\);\s*window\.startReplacementContractEdit\?\.\(/
    );
});

test("desde un turno agregado a mano: el contrato se abre SIN ese dia", () => {
    // El turno ya esta escrito y respaldado: heredarlo otra vez lo sumaria dos
    // veces.
    assert.match(calendar, /excludedDates: \[isoFromKeyDay\(keyDay\)\]/);
    assert.match(main, /profileDraft\.contractExcludedDates = Array\.isArray\(prefill\.excludedDates\)/);
});

test("un permiso dentro del contrato vigente hereda sus turnos como reemplazos", () => {
    const recorte = main.slice(
        main.indexOf("if (!clampedRange) {"),
        main.indexOf("const start = clampedRange.start;")
    );

    assert.match(recorte, /dia\.estado === "heredado"/);
    assert.match(recorte, /source: "replacement_contract_overlap"/);
    assert.match(recorte, /return inherited\.length \? \{ overlapOnly: true, inherited: inherited\.length \} : null;/);
});
