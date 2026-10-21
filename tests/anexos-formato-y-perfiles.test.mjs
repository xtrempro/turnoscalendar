// Los anexos imprimibles: a quien incluyen y como se descargan.
//
// Dos cosas pedidas el 2026-10-21:
//
//   1. Se imprimian perfiles ya desactivados. Mientras el perfil queda inactivo
//      sin fecha de salida -o con una anterior al mes-, el motor sigue
//      proyectando turnos desde su rotativa, y esas horas que nadie trabajo
//      terminaban en un anexo que alguien firma. Solo entra quien alcanzo a
//      estar en la unidad ese mes; cuantas horas tiene lo sigue decidiendo el
//      filtro de horas de cada anexo, asi que un reemplazo que trabajo una
//      hora entra por esa hora.
//
//   2. Los anexos solo se podian imprimir. Ahora preguntan el formato: PDF por
//      el dialogo de impresion, o Word para editarlos antes de firmarlos.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isAnnexMonthCandidate } from "../js/coverageAuthorizationRows.js";

const leer = ruta => readFile(new URL(ruta, import.meta.url), "utf8");

const main = await leer("../js/main.js");
const impresion = await leer("../js/reportPrint.js");

const OCTUBRE = new Date(2026, 9, 1);

test("un perfil activo siempre entra", () => {
    assert.equal(isAnnexMonthCandidate({ name: "Ana", active: true }, OCTUBRE), true);
    // Sin el campo tambien: los perfiles viejos no lo traen.
    assert.equal(isAnnexMonthCandidate({ name: "Ana" }, OCTUBRE), true);
});

test("el que se fue DENTRO del mes entra", () => {
    // Trabajo hasta el 9 de octubre: sus horas de octubre son reales.
    assert.equal(
        isAnnexMonthCandidate(
            { name: "Emilio", active: false, unitExitDate: "2026-10-09" },
            OCTUBRE
        ),
        true
    );
    // Y el que se va justo el primero, tambien.
    assert.equal(
        isAnnexMonthCandidate(
            { name: "Emilio", active: false, unitExitDate: "2026-10-01" },
            OCTUBRE
        ),
        true
    );
});

test("el que se fue ANTES del mes no entra", () => {
    assert.equal(
        isAnnexMonthCandidate(
            { name: "Bruno", active: false, unitExitDate: "2026-09-30" },
            OCTUBRE
        ),
        false
    );
});

test("el que se fue despues sigue entrando", () => {
    // Inactivado con fecha futura: en octubre todavia estaba.
    assert.equal(
        isAnnexMonthCandidate(
            { name: "Carla", active: false, unitExitDate: "2026-11-15" },
            OCTUBRE
        ),
        true
    );
});

test("un inactivo sin fecha de salida no entra", () => {
    // Es el caso que ensuciaba los anexos: sin fecha, la rotativa sigue
    // proyectando turnos para siempre y no hay con que acotarlos.
    assert.equal(
        isAnnexMonthCandidate({ name: "Dina", active: false }, OCTUBRE),
        false
    );
    assert.equal(
        isAnnexMonthCandidate(
            { name: "Dina", active: false, unitExitDate: "sin fecha" },
            OCTUBRE
        ),
        false
    );
});

test("los dos anexos aplican el filtro", () => {
    const tens = main.slice(
        main.indexOf("async function printTensConsolidatedReport("),
        main.indexOf("async function printCoverageAuthorizationReport(")
    );
    const cobertura = main.slice(
        main.indexOf("async function printCoverageAuthorizationReport("),
        main.indexOf("function decorateReportWorkerName(")
    );

    assert.match(tens, /isAnnexMonthCandidate\(profile, monthDate\)/);
    assert.match(cobertura, /isAnnexMonthCandidate\(profile, monthDate\) &&/);
});

test("los dos anexos preguntan el formato", () => {
    const tens = main.slice(
        main.indexOf("async function printTensConsolidatedReport("),
        main.indexOf("async function printCoverageAuthorizationReport(")
    );
    const cobertura = main.slice(
        main.indexOf("async function printCoverageAuthorizationReport("),
        main.indexOf("function decorateReportWorkerName(")
    );

    assert.match(tens, /await deliverReport\(/);
    assert.match(cobertura, /await deliverReport\(/);
    assert.doesNotMatch(tens, /printReportPreviewHTML\(/);
    assert.doesNotMatch(cobertura, /printReportPreviewHTML\(/);
});

test("el cuadro ofrece PDF y Word, y cerrar no descarga nada", () => {
    const entregar = main.slice(
        main.indexOf("async function deliverReport("),
        main.indexOf("async function printTensConsolidatedReport(")
    );

    assert.match(entregar, /value: "pdf"/);
    assert.match(entregar, /value: "word"/);
    assert.match(entregar, /if \(!formato\) return false;/);
    assert.match(entregar, /if \(formato === "word"\) return downloadReportAsWord\(html, title\);/);
    assert.match(entregar, /printReportPreviewHTML\(html, title\);/);
});

test("el Word lleva el mismo contenido que se imprime, y en horizontal", () => {
    const word = impresion.slice(
        impresion.indexOf("export function downloadReportAsWord("),
        impresion.indexOf("export function printReportPreviewHTML(")
    );

    // El MISMO html del reporte, saneado igual que al imprimir.
    assert.match(word, /sanitizePrintHTML\(html\)/);
    assert.match(word, /application\/msword/);
    assert.match(word, /mso-page-orientation: landscape/);
    assert.match(word, /\.doc`/);
    // Un nombre de archivo no puede traer los caracteres que Windows rechaza.
    assert.match(word, /replace\(\/\[\\\\\/:\*\?"<>\|\]\/g, "-"\)/);
});
