// Cada cambio de turno origina un memorandum con el Anexo 4 ("Formulario unico
// de solicitud de cambio de turno") relleno para imprimir, firmar y adjuntar.
// El motivo queda en blanco: lo escribe a mano el trabajador.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) { this.values.set(key, String(value)); }
}

// Oyentes de verdad: la creacion del memorandum viaja por evento.
const listeners = new Map();

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent(event) {
        (listeners.get(event.type) || []).forEach(listener => listener(event));
        return true;
    },
    addEventListener(type, listener) {
        listeners.set(type, [...(listeners.get(type) || []), listener]);
    },
    removeEventListener() {},
    location: { hostname: "localhost" }
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    body: { dataset: {}, classList: { add() {}, remove() {}, contains: () => false } },
    addEventListener() {}, removeEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, dataset: {}, appendChild() {} })
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const form = await import("../js/swapMemoForm.js");
const { readZipEntries, zipEntryText } = await import("../js/zipUtils.js");
const insights = await import("../js/memosInsights.js");
const { getMemos } = await import("../js/memos.js");
const { registrarCambio, deshacerCambioTurno } = await import("../js/swaps.js");
const { getSwaps } = await import("../js/storage.js");

const plantilla = await readFile(new URL("../reports/anexo4-cambio-turno.docx", import.meta.url));

const CAMBIO = {
    id: Date.parse("2026-09-29T15:00:00"),
    from: "Gabriel Rojas Bustos",
    to: "Maria Fuentes",
    fecha: "2026-10-02",
    turno: "L",
    devolucion: "2026-10-09",
    turnoDevuelto: "N"
};

test("los datos salen del cambio: quien cede, su companero y los dos turnos", () => {
    const datos = form.anexo4Data(CAMBIO, {
        unitName: "Urgencia Adulto",
        rutFor: name => ({ "Gabriel Rojas Bustos": "15.123.456-7", "Maria Fuentes": "17654321k" })[name]
    });

    assert.deepEqual(datos, {
        unit: "Urgencia Adulto",
        requestDate: "29/09/2026",
        rut: "15123456‑7",
        name: "Gabriel Rojas Bustos",
        counterpartRut: "17654321‑K",
        counterpartName: "Maria Fuentes",
        originalDay: "02/10/2026\nLarga",
        originalSchedule: "08:00 a 20:00",
        changeDay: "09/10/2026\nNoche",
        changeSchedule: "20:00 a 08:00"
    });
});

test("el Diurno del viernes sale a las 16:00", () => {
    assert.equal(form.swapShiftSchedule("D", "2026-10-02"), "08:00 a 16:00");
    assert.equal(form.swapShiftSchedule("D", "2026-10-01"), "08:00 a 17:00");
});

test("el Word relleno conserva la plantilla y trae los datos en su lugar", async () => {
    const datos = form.anexo4Data(CAMBIO, { unitName: "Urgencia & Adulto" });
    const bytes = await form.buildAnexo4Docx(plantilla, datos);
    const original = readZipEntries(plantilla);
    const relleno = readZipEntries(bytes);

    // Mismos archivos, y todos menos document.xml byte a byte iguales: logos,
    // encabezado, pie y estilos oficiales intactos.
    assert.deepEqual(relleno.map(entry => entry.name), original.map(entry => entry.name));
    relleno.forEach((entry, index) => {
        if (entry.name === "word/document.xml") return;
        assert.ok(Buffer.from(entry.data).equals(Buffer.from(original[index].data)), entry.name);
    });

    const xml = await zipEntryText(relleno.find(entry => entry.name === "word/document.xml"));

    assert.match(xml, /<w:t xml:space="preserve">Urgencia &amp; Adulto<\/w:t>/);
    assert.match(xml, /<w:t xml:space="preserve">29\/09\/2026<\/w:t>/);
    assert.doesNotMatch(xml, /____\/____\/ ____/);
    // Fecha y turno en dos lineas: la celda no parte la fecha.
    assert.match(xml, /<w:t xml:space="preserve">02\/10\/2026<\/w:t><w:br\/><w:t xml:space="preserve">Larga<\/w:t>/);
    // Una hoja: margenes de 1,5 cm, la tabla al ancho util con columnas fijas
    // y sin los parrafos vacios que habia tras la nota final.
    assert.match(xml, /<w:pgMar w:top="1000" w:right="850" w:bottom="1000" w:left="850"/);
    assert.match(xml, /<w:tblW w:w="10540" w:type="dxa"\/><w:tblInd w:w="0" w:type="dxa"\/><w:tblLayout w:type="fixed"\/>/);
    assert.match(xml, /Nota:[\s\S]*?<\/w:p>(<w:sectPr|<\/w:body>)/);
    assert.match(xml, /<w:t xml:space="preserve">20:00 a 08:00<\/w:t>/);
    // El motivo sigue en blanco, para escribirlo a mano.
    assert.match(xml, /III\. MOTIVO DE LA SOLICITUD[\s\S]{0,4000}_{40,}/);
    assert.equal(form.anexo4FileName(datos), "Anexo4_cambio_turno_Gabriel_Rojas_Bustos_02_10_2026.docx");
});

test("registrar un cambio origina su memorandum, y anularlo lo quita", () => {
    localStorage.clear();
    registrarCambio({ ...CAMBIO, year: 2026, month: 9 });

    const swap = getSwaps()[0];
    const memo = getMemos().find(item => item.sourceId === `swap:${swap.id}`);

    assert.ok(memo, "no se creo el memorandum del cambio");
    assert.equal(memo.profile, "Gabriel Rojas Bustos");
    assert.equal(memo.typeLabel, "Cambio de turno");
    assert.equal(insights.memoKind(memo), "swap");
    assert.deepEqual(
        insights.memoFacts(memo).map(fact => fact.value),
        ["Maria Fuentes", "02-10-2026 Larga", "09-10-2026 Noche"]
    );

    deshacerCambioTurno(swap);

    assert.equal(getMemos().some(item => item.sourceId === `swap:${swap.id}`), false);
});

test("un memorandum con el formulario ya adjunto no se borra al anular", () => {
    localStorage.clear();
    registrarCambio({ ...CAMBIO, year: 2026, month: 9 });

    const swap = getSwaps()[0];
    const memos = JSON.parse(localStorage.getItem("memos"));

    memos[0].documents = [{ id: "d1", name: "anexo4.pdf", dataUrl: "data:application/pdf;base64,AA==" }];
    localStorage.setItem("memos", JSON.stringify(memos));

    deshacerCambioTurno(swap);

    assert.equal(getMemos().some(item => item.sourceId === `swap:${swap.id}`), true);
});

test("el visor ofrece descargar el formulario", async () => {
    const memos = await readFile(new URL("../js/memos.js", import.meta.url), "utf8");

    assert.match(memos, /data-mem-act="download-anexo4"/);
    assert.match(memos, /case "download-anexo4":/);
    assert.match(memos, /Descargar formulario \(Anexo 4\)/);
});
