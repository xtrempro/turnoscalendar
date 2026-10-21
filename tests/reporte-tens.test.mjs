import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    ANNEX_ONE_GROUPS,
    annexOneGroupFor,
    buildAnnexOneDocumentHTML,
    buildTensConsolidatedReportHTML,
    isTensConsolidatedCandidate,
    isTensReportProfile,
    tensShiftTypeLabel
} from "../js/tensReport.js";

const main = readFileSync("js/main.js", "utf8");

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

test("excluye del consolidado a los tecnicos a honorarios", () => {
    const profile = {
        estamento: "Técnico",
        profession: "Técnico en Enfermería"
    };

    assert.equal(isTensConsolidatedCandidate(profile, "Honorarios"), false);
    assert.equal(isTensConsolidatedCandidate(profile, "Contrata"), true);
    assert.equal(isTensConsolidatedCandidate(profile, "Planta"), true);
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

test("usa como jefe solicitante el nombre configurado en el pie de firma", () => {
    const html = buildTensConsolidatedReportHTML(
        [],
        new Date(2026, 8, 1),
        { requesterName: "Jefa <Unidad>" }
    );

    assert.match(
        html,
        /JEFE SOLICITANTE:<\/strong> Jefa &lt;Unidad&gt;/
    );
    assert.doesNotMatch(html, /BERNARDITA FAUNDEZ/);
});

test("Informes propone el pie de firma como jefe solicitante, y deja cambiarlo", () => {
    // El nombre sale del pie de firma, pero el cuadro de descarga lo deja
    // corregir: con una subrogancia, quien solicita no es quien firma.
    assert.match(main, /const firmante = getReportSignatureConfig\(\)\.lines\?\.\[0\] \|\| "";/);
    assert.match(main, /inputLabel: "Jefe solicitante"/);
    assert.match(
        main,
        /buildAnnexOneDocumentHTML\(sections, monthDate, \{[\s\S]{0,120}requesterName: requesterName \|\| firmante/
    );
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

// --- Una hoja por estamento ---
//
// El Anexo 1 se imprimia solo para el estamento tecnico. El resto del personal
// hace horas extraordinarias igual y su autorizacion se armaba a mano. Ahora el
// mismo boton trae las cuatro hojas, cada una con su tabla y en su pagina.

test("los cuatro estamentos tienen hoja", () => {
    assert.deepEqual(
        ANNEX_ONE_GROUPS.map(group => group.key),
        ["tecnico", "profesional", "auxiliar", "administrativo"]
    );
});

test("cada perfil cae en la hoja de su estamento", () => {
    assert.equal(annexOneGroupFor({ estamento: "Técnico" })?.key, "tecnico");
    // Como se haya escrito: con acento, sin acento, o como "TENS".
    assert.equal(annexOneGroupFor({ estamento: "tecnico" })?.key, "tecnico");
    assert.equal(annexOneGroupFor({ estamento: "TENS" })?.key, "tecnico");
    assert.equal(annexOneGroupFor({ estamento: "Profesional" })?.key, "profesional");
    assert.equal(annexOneGroupFor({ estamento: "Auxiliar" })?.key, "auxiliar");
    assert.equal(annexOneGroupFor({ estamento: "Administrativo" })?.key, "administrativo");
    // Sin estamento no hay hoja donde ponerlo.
    assert.equal(annexOneGroupFor({ estamento: "" }), null);
    assert.equal(annexOneGroupFor({}), null);
});

const UNA_FILA = {
    name: "ANA PEREZ",
    grade: "18",
    dayHours: 4,
    festiveHours: 0,
    returnTransfer: false,
    shiftType: "4° turno con asignación"
};

test("el documento trae una hoja por estamento CON horas", () => {
    const html = buildAnnexOneDocumentHTML(
        [
            { group: ANNEX_ONE_GROUPS[0], rows: [UNA_FILA] },
            // Sin horas: esa hoja no se imprime.
            { group: ANNEX_ONE_GROUPS[1], rows: [] },
            { group: ANNEX_ONE_GROUPS[2], rows: [{ ...UNA_FILA, name: "LUIS SOTO" }] }
        ],
        new Date(2026, 9, 1)
    );

    assert.match(html, /EXTRAORDINARIOS TENS IMAGENOLOG/);
    assert.match(html, /EXTRAORDINARIOS AUXILIARES IMAGENOLOG/);
    assert.doesNotMatch(html, /PROFESIONALES IMAGENOLOG/);
    // La segunda hoja empieza en pagina nueva; la primera no.
    assert.equal(
        (html.match(/class="tens-annex tens-annex--new-page"/g) || []).length,
        1
    );
    assert.match(html, /class="tens-annex">/);
    assert.match(html, /ANA PEREZ/);
    assert.match(html, /LUIS SOTO/);
});

test("sin horas en ningun estamento no hay documento", () => {
    assert.equal(
        buildAnnexOneDocumentHTML(
            [{ group: ANNEX_ONE_GROUPS[0], rows: [] }],
            new Date(2026, 9, 1)
        ),
        ""
    );
    assert.equal(buildAnnexOneDocumentHTML([], new Date(2026, 9, 1)), "");
});

test("el tipo de turno nombra al estamento de la hoja", () => {
    assert.equal(tensShiftTypeLabel("diurno", false), "TENS diurno");
    assert.equal(tensShiftTypeLabel("diurno", false, "Auxiliar"), "Auxiliar diurno");
    // Los turnos con numero no llevan estamento.
    assert.equal(tensShiftTypeLabel("4turno", true, "Profesional"), "4° turno con asignación");
});

test("la barra institucional va al pie de la hoja, no flotando", () => {
    // Con position:fixed se cruzaba sobre las ultimas filas de la tabla.
    const html = buildAnnexOneDocumentHTML(
        [{ group: ANNEX_ONE_GROUPS[0], rows: [UNA_FILA] }],
        new Date(2026, 9, 1)
    );
    const regla = html.slice(
        html.indexOf(".tens-annex__footer-rule {"),
        html.indexOf("}", html.indexOf(".tens-annex__footer-rule {"))
    );

    assert.match(regla, /position: absolute;/);
    assert.doesNotMatch(regla, /position: fixed;/);
    assert.match(regla, /bottom: 3mm;/);
});
