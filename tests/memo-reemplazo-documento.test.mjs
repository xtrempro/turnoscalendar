// Cada contrato de reemplazo origina su memorandum "Contrato de reemplazo", y
// desde su visor se descarga el memorandum de solicitud de contrato relleno con
// el formato de la unidad (reports/memo-reemplazo.docx). UN reemplazo por
// memorandum: el formato admite varias vinetas, se deja una.

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

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
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

const form = await import("../js/replacementMemoForm.js");
const { readZipEntries, zipEntryText } = await import("../js/zipUtils.js");
const {
    createReplacementContractMemoTask,
    getMemos,
    replacementContractForMemo
} = await import("../js/memos.js");

const plantilla = await readFile(new URL("../reports/memo-reemplazo.docx", import.meta.url));

const CONTRATO = {
    id: "c-1",
    start: "2026-05-18",
    end: "2026-05-28",
    replaces: "Damiana Marinao",
    reason: "Licencia Médica"
};
const REEMPLAZANTE = {
    name: "Mathías Araya Cáceres",
    rut: "215145662",
    estamento: "Técnico",
    profession: "Técnico en imagenología"
};

function textoDe(xml) {
    return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
        .map(match => match[1])
        .join("");
}

test("los datos salen del contrato y del perfil del reemplazante", () => {
    assert.deepEqual(form.replacementMemoData(CONTRATO, REEMPLAZANTE, { unitName: "Imagenología" }), {
        unit: "Imagenología",
        reason: "licencia médica",
        estamento: "técnico",
        days: 11,
        start: "18.05.2026",
        end: "28.05.2026",
        replaced: "Damiana Marinao",
        name: "Mathías Araya Cáceres",
        rut: "21.514.566-2",
        profession: "Técnico en imagenología"
    });
});

test("el motivo se escribe como frase: feriado legal, no F. Legal", () => {
    assert.equal(form.replacementReasonPhrase("F. Legal"), "feriado legal");
    assert.equal(form.replacementReasonPhrase("F. Compensatorios"), "feriado compensatorio");
    assert.equal(form.replacementReasonPhrase("LM Profesional"), "licencia médica profesional");
    assert.equal(form.contractDays("2026-05-29", "2026-05-31"), 3);
});

test("el Word lleva UN reemplazo y conserva la plantilla", async () => {
    const datos = form.replacementMemoData(CONTRATO, REEMPLAZANTE, { unitName: "Urgencia & Adulto" });
    const bytes = await form.buildReplacementMemoDocx(plantilla, datos);
    const original = readZipEntries(plantilla);
    const relleno = readZipEntries(bytes);

    // Logos, estilos y demas archivos: byte a byte iguales.
    assert.deepEqual(relleno.map(entry => entry.name), original.map(entry => entry.name));
    relleno.forEach((entry, index) => {
        if (entry.name === "word/document.xml") return;
        assert.ok(Buffer.from(entry.data).equals(Buffer.from(original[index].data)), entry.name);
    });

    const xml = await zipEntryText(relleno.find(entry => entry.name === "word/document.xml"));
    const texto = textoDe(xml);

    assert.match(texto, /Urgencia &amp; Adulto/);
    assert.match(texto, /MATERIA: Reemplazo por licencia médica/);
    assert.match(texto, /reemplazo por licencia médica del estamento técnico debido al siguiente motivo:/);
    assert.match(texto, /Reemplazo por licencia médica por 11 días desde el 18\.05\.2026 al 28\.05\.2026\. Reemplazo por Damiana Marinao\./);
    assert.match(texto, /Se propone como reemplazo a Mathías Araya Cáceres, Rut N° 21\.514\.566-2, Profesión u oficio: Técnico en imagenología/);
    // Una sola vineta: los reemplazos del ejemplo original ya no estan.
    assert.doesNotMatch(texto, /Bastián|29\.05\.2026|Srta\./);
    assert.equal((xml.match(/Reemplazo por licencia médica por/g) || []).length, 1);
    assert.equal(form.replacementMemoFileName(datos), "Memo_reemplazo_Mathias_Araya_Caceres_18_05_2026.docx");
});

test("el memorandum del contrato encuentra su contrato, vigente o por el detalle", () => {
    localStorage.clear();
    createReplacementContractMemoTask({ profile: REEMPLAZANTE.name, contract: CONTRATO });

    const memo = getMemos()[0];

    // Vigente: el del perfil, por el id que va en el sourceId.
    assert.equal(
        replacementContractForMemo(memo, [{ ...CONTRATO, reason: "F. Legal" }]).reason,
        "F. Legal"
    );
    // Si ya no esta en el perfil, lo que quedo escrito en el detalle.
    assert.deepEqual(replacementContractForMemo(memo, []), {
        start: "2026-05-18",
        end: "2026-05-28",
        replaces: "Damiana Marinao",
        reason: "Licencia Médica"
    });
});

test("el visor del contrato ofrece descargar el memorandum", async () => {
    const memos = await readFile(new URL("../js/memos.js", import.meta.url), "utf8");

    assert.match(memos, /data-mem-act="download-replacement-memo"/);
    assert.match(memos, /case "download-replacement-memo":/);
    assert.match(memos, /Descargar memorándum de reemplazo/);
});
