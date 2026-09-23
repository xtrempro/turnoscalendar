import test from "node:test";
import assert from "node:assert/strict";

import {
    buildCoverageAuthorizationReportHTML,
    hasCoverageAuthorizationOvertime
} from "../js/coverageAuthorizationReport.js";

test("Anexo 2 incluye solo filas que tienen horas extraordinarias", () => {
    assert.equal(hasCoverageAuthorizationOvertime({ days: [] }), false);
    assert.equal(hasCoverageAuthorizationOvertime({
        days: [{ dayHours: 0, festiveHours: 0 }]
    }), false);
    assert.equal(hasCoverageAuthorizationOvertime({
        days: [{ dayHours: 0, festiveHours: 10 }]
    }), true);
});

test("Anexo 2 conserva el formato institucional y completa 31 dias", () => {
    const html = buildCoverageAuthorizationReportHTML([{
        name: "Ana Tecnica",
        rut: "12.345.678-5",
        contractType: "Contrata",
        unit: "Urgencia Adulto",
        estamento: "Tecnico",
        rotationType: "4turno",
        shiftAssigned: true,
        days: [{
            iso: "2027-04-03",
            baseShift: "Libre",
            workedShift: "Larga",
            dayHours: 12,
            festiveHours: 0,
            replacedName: "Paula Rojas",
            replacedRut: "11.111.111-1",
            motive: "F. Legal"
        }]
    }], new Date(2027, 3, 1));

    assert.match(html, /MEMO - A N E X O&nbsp;&nbsp;&nbsp;2/);
    assert.match(html, /AUTORIZACION PARA CUBRIR TURNOS/);
    assert.match(html, /ABRIL DE 2027/);
    assert.match(html, /Urgencia Adulto/);
    assert.match(html, /Paula Rojas/);
    assert.match(html, /11\.111\.111-1/);
    assert.match(html, /F\. Legal/);
    assert.match(html, /<td>31<\/td>/);
    assert.match(html, /<td>12<\/td>/);
    assert.match(html, /@page \{ size: legal portrait/);
    assert.match(html, /<th>DIUR\.<\/th><th>FEST\.<\/th>/);
});

test("Anexo 2 marca Diurno solo para la rotativa diurna", () => {
    const html = buildCoverageAuthorizationReportHTML([{
        name: "Ana Diurna",
        rotationType: "diurno",
        shiftAssigned: false,
        days: [{ iso: "2027-04-01", dayHours: 1 }]
    }], new Date(2027, 3, 1));

    assert.match(html, /<td>Diurno<\/td><td>X<\/td>/);
    assert.doesNotMatch(html, /<td>Tercer Turno<\/td><td>X<\/td>/);
    assert.doesNotMatch(html, /<td>Cuarto Turno<\/td><td>X<\/td>/);
});

test("Anexo 2 muestra rotativa, ausencia y horario programado todos los dias", () => {
    const html = buildCoverageAuthorizationReportHTML([{
        name: "Ana Rotativa",
        days: [
            {
                iso: "2027-04-01",
                baseShift: "24h",
                programmedShift: "24h",
                dayHours: 1
            },
            {
                iso: "2027-04-02",
                baseShift: "F. Legal",
                programmedShift: "Noche"
            },
            {
                iso: "2027-04-03",
                baseShift: "Libre",
                programmedShift: "Libre"
            }
        ]
    }], new Date(2027, 3, 1));

    assert.match(html, /<td>24h<\/td>\s*<td>08 A 08<\/td>/);
    assert.match(html, /<td>F\. Legal<\/td>\s*<td>20 A 08<\/td>/);
    assert.match(html, /<td>Libre<\/td>\s*<td><\/td>/);
});

test("Anexo 2 escapa datos provenientes de perfiles", () => {
    const html = buildCoverageAuthorizationReportHTML([{
        name: "<script>alert(1)</script>",
        days: [{ iso: "2027-01-01", dayHours: 1 }]
    }], new Date(2027, 0, 1));

    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
});
