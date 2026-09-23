import assert from "node:assert/strict";
import test from "node:test";
import {
    buildTensConsolidatedReportHTML,
    isTensReportProfile,
    tensShiftTypeLabel
} from "../js/tensReport.js";

test("incluye a todo el estamento Tecnico sin depender de la profesion", () => {
    assert.equal(isTensReportProfile({
        estamento: "Técnico",
        profession: "Técnico en Enfermería"
    }), true);
    assert.equal(isTensReportProfile({
        estamento: "TENS",
        profession: "Enfermería"
    }), true);
    assert.equal(isTensReportProfile({
        estamento: "Técnico",
        profession: "Técnico en Imagenología"
    }), true);
    assert.equal(isTensReportProfile({
        estamento: "Profesional",
        profession: "Técnico en Enfermería"
    }), false);
});

test("describe el tipo de turno y su asignacion", () => {
    assert.equal(tensShiftTypeLabel("4turno", true), "4° turno con asignación");
    assert.equal(tensShiftTypeLabel("4turno", false), "4° turno sin asignación");
    assert.equal(tensShiftTypeLabel("diurno", false), "TENS diurno");
});

test("el anexo conserva campos y columnas del formato exigido", () => {
    const html = buildTensConsolidatedReportHTML([{
        name: "Ana <Rojas>",
        grade: "20",
        dayHours: 38,
        festiveHours: 12,
        returnTransfer: false,
        shiftType: "4° turno sin asignación"
    }], new Date(2026, 8, 1));

    assert.match(html, /MEMO - A N E X O/);
    assert.match(html, /MES:<\/strong> SEPTIEMBRE/);
    assert.match(html, /HRS\.<br>DIURNAS/);
    assert.match(html, /HRS\.<br>FESTIVAS/);
    assert.match(html, /RETRIBUCION<br>PAGO/);
    assert.match(html, /Ana &lt;Rojas&gt;/);
    assert.match(html, />38<\/td>/);
    assert.match(html, />12<\/td>/);
    assert.match(html, /4° turno sin asignación/);
});

test("marca descanso en vez de pago cuando las horas se devuelven", () => {
    const html = buildTensConsolidatedReportHTML([{
        name: "TENS Uno",
        grade: "18",
        dayHours: 4,
        festiveHours: 0,
        returnTransfer: true,
        shiftType: "TENS diurno"
    }], new Date(2026, 8, 1));
    const row = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] || "";

    assert.match(row, /<td>X<\/td>\s*<td><\/td>/);
});
