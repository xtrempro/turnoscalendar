import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

const { imagesToPdf, jpegInfo } = await import("../js/imagesToPdf.js");
const { readZipEntries, storedZipEntry, writeZip } = await import("../js/zipUtils.js");
const { detectSheet, swapScanFileName } = await import("../js/swapScan.js");

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

// Un JPEG minimo: solo lo que lee jpegInfo (SOI + SOF0 de 3x2, 3 canales).
function fakeJpeg(components = 3) {
    return new Uint8Array([
        0xff, 0xd8,
        0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, components,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0xff, 0xd9
    ]);
}

test("jpegInfo lee tamano y canales del encabezado", () => {
    assert.deepEqual(jpegInfo(fakeJpeg()), { height: 2, width: 3, components: 3 });
    assert.equal(jpegInfo(new Uint8Array([1, 2, 3])), null);
});

test("imagesToPdf arma un PDF con una pagina por foto y una tabla xref valida", () => {
    const pdf = imagesToPdf([
        { bytes: fakeJpeg(3), width: 1200, height: 900 },
        { bytes: fakeJpeg(1), width: 900, height: 1200 }
    ]);
    const text = new TextDecoder("latin1").decode(pdf);

    assert.ok(text.startsWith("%PDF-1.4"));
    assert.ok(text.trimEnd().endsWith("%%EOF"));
    assert.match(text, /\/Type \/Pages \/Count 2/);
    assert.match(text, /\/ColorSpace \/DeviceRGB/);
    assert.match(text, /\/ColorSpace \/DeviceGray/);

    // Cada entrada del xref apunta al comienzo de su objeto.
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)[1]);
    const rows = text.slice(xrefAt).split("\n").slice(3)
        .filter(line => /^\d{10} 00000 n $/.test(line));

    assert.equal(rows.length, 2 + 2 * 3);
    rows.forEach((row, index) => {
        const offset = Number(row.slice(0, 10));

        assert.ok(text.startsWith(`${index + 1} 0 obj`, offset), `objeto ${index + 1}`);
    });

    assert.throws(() => imagesToPdf([]), /No hay paginas/);
});

test("detectSheet encuentra la hoja clara aunque el texto corte filas", () => {
    const width = 120;
    const height = 90;
    const gray = new Uint8ClampedArray(width * height).fill(40);

    for (let y = 9; y < 81; y++) {
        for (let x = 33; x < 89; x++) {
            // Renglones de texto oscuros cada 6 filas.
            const textLine = y % 6 === 0 && x < 80;

            gray[y * width + x] = textLine ? 30 : 240;
        }
    }

    const box = detectSheet(gray, width, height);

    assert.ok(box);
    assert.ok(Math.abs(box.x - 33 / width) < 0.02);
    assert.ok(Math.abs(box.y - 9 / height) < 0.03);
    assert.ok(Math.abs(box.w - 56 / width) < 0.03);
    assert.ok(Math.abs(box.h - 72 / height) < 0.04);

    // Sin fondo que la separe no hay nada que recortar.
    assert.equal(detectSheet(new Uint8ClampedArray(width * height).fill(230), width, height), null);
});

test("el nombre del escaneo lleva los apellidos y la fecha", () => {
    assert.equal(
        swapScanFileName({
            from: "Mathias Benjamin Araya Caceres",
            to: "Eduardo Felipe Castro Muñoz",
            fecha: "2026-09-10"
        }),
        "Anexo4_Araya-Castro_2026-09-10.pdf"
    );
});

test("storedZipEntry arma un zip que se vuelve a leer", () => {
    const bytes = new TextEncoder().encode("hola");
    const zip = writeZip([
        storedZipEntry("Anexo4_Muñoz.docx", bytes),
        storedZipEntry("otro.docx", bytes)
    ]);
    const entries = readZipEntries(zip);

    assert.deepEqual(entries.map(entry => entry.name), ["Anexo4_Muñoz.docx", "otro.docx"]);
    assert.deepEqual([...entries[0].data], [...bytes]);
});

test("el panel de cambios trae Anexo 4, escaneo y solicitudes de la app", () => {
    const ui = read("../js/swapUI.js");
    const swaps = read("../js/swaps.js");
    const memos = read("../js/memos.js");
    const requests = read("../js/workerRequests.js");

    // Registrar descarga su Anexo 4: registrarCambio devuelve el cambio.
    assert.match(swaps, /return swaps\[swaps\.length - 1\];/);
    assert.match(ui, /const swap = registrarCambio\(/);
    assert.match(ui, /await downloadSwapAnexo4\(swap\.id\)/);

    // Por firmar / firmado sale del documento del memorandum del cambio.
    assert.match(ui, /findSwapMemo\(swap\.id\)/);
    assert.match(ui, /openSwapScanDialog\(swap/);
    assert.match(memos, /export async function downloadSwapAnexo4Batch/);
    assert.match(memos, /export function ensureSwapMemo/);

    // Las solicitudes de cambio de la app se aprueban desde aqui...
    assert.match(ui, /getWorkerRequests\(\)\.filter\(isPendingSwapRequest\)/);
    assert.match(ui, /acceptWorkerRequestById\(button\.dataset\.requestId\)/);
    // ...y siguen en el menu Solicitudes (no se filtran por tipo alli).
    assert.match(requests, /swap: "Cambio de Turno"/);
    assert.match(requests, /if \(request\.type === "swap"\) \{\s*pushHistory\(\);\s*return applySwapRequest/);
});
