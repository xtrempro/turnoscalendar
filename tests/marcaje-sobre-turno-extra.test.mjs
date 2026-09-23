// Un dia puede tener las dos cosas a la vez: un turno extra con su motivo, y una
// incidencia de marcaje sobre ese mismo turno. Con la incidencia presente el
// click de la casilla abre el modal del marcaje, que no decia nada del turno
// extra; y en el hover el motivo del turno tapaba la advertencia del marcaje.
// Una informacion no puede sobreescribir a la otra.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const calendar = (await readFile(
    new URL("../js/calendar.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

function block(signature, length = 3200) {
    const start = calendar.indexOf(signature);

    assert.notEqual(start, -1, `no se encontro: ${signature}`);

    return calendar.slice(start, start + length);
}

test("el hover muestra el motivo del turno extra Y la incidencia", () => {
    // Antes: `return replacementTitle || warning;` -> el motivo tapaba el aviso.
    assert.doesNotMatch(calendar, /return replacementTitle \|\| warning;/);
    assert.match(
        calendar,
        /return \[\s*replacementContractTitle,\s*replacementTitle,\s*warning\s*\]\s*\n\s*\.filter\(Boolean\)\s*\n\s*\.join\("\\n"\);/
    );
});

test("el modal del marcaje incluye el bloque del turno extra", () => {
    const dialog = block("function openClockMarkDetailDialog(", 4200);

    assert.match(dialog, /const extraShift = getReplacementDetailRecord\(profile, keyDay\);/);
    assert.match(dialog, /clock-detail-extra/);
    // Con los mismos datos que el modal del turno extra.
    assert.match(dialog, /replacementDetailTurnLabel\(extraShift\)/);
    assert.match(dialog, /replacementDetailReasonLabel\(extraShift\)/);
    assert.match(dialog, /replacementDetailSourceLabel\(extraShift\)/);
    // Y distingue reemplazo de turno extra suelto.
    assert.match(dialog, /extraShift\.replaced[\s\S]{0,120}Reemplazo asignado/);
    assert.match(dialog, /Turno extra asignado/);
});

test("el bloque solo aparece si ese dia tiene turno extra", () => {
    const dialog = block("function openClockMarkDetailDialog(", 4200);

    assert.match(dialog, /const extraShiftHTML = extraShift\s*\n\s*\?/);
    assert.match(dialog, /\$\{extraShiftHTML\}/);
});

test("desde el marcaje se puede llegar al detalle del turno extra", () => {
    // Con incidencia, el click de la casilla abre este modal: sin este boton la
    // anulacion del turno extra quedaba sin camino.
    const dialog = block("function openClockMarkDetailDialog(", 5200);

    assert.match(dialog, /data-action="extra-shift"/);
    assert.match(
        dialog,
        /\[data-action='extra-shift'\][\s\S]{0,220}openReplacementDetailDialog\(\s*\n?\s*profile,\s*\n?\s*keyDay,\s*\n?\s*extraShift\?\.id/
    );
});

test("el motivo del respaldo de marcaje sigue mostrandose aparte", () => {
    const dialog = block("function openClockMarkDetailDialog(", 4200);

    // Son dos motivos distintos: el del excedente por marcaje y el del turno
    // extra. Ninguno reemplaza al otro.
    assert.match(dialog, /getClockExtraBackupForWorker\(profile, keyDay\)\?\.reason/);
    assert.match(dialog, /clock-detail-reason/);
});
