// La planilla del reloj en .xlsx y con Fecha y Hora separadas.
//
// Imagenologia convencional baja el registro como "Planilla de Personal.xlsx":
// columnas RUN, Nombre, Fecha (texto 24/09/2026), Hora (texto 07:45:19) y Tipo
// (ENTRADA/SALIDA). El importador solo leia el .xls binario y una sola columna
// Fecha/Hora, asi que el archivo se rechazaba entero.

import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

globalThis.localStorage = {
    getItem() { return null; },
    setItem() {},
    removeItem() {}
};
globalThis.window = {
    location: { hostname: "localhost" },
    addEventListener() {},
    dispatchEvent() { return true; }
};

const { isXlsxFile, readXlsxRows } = await import("../js/xlsxReader.js");
const { parseAttendanceRows } = await import("../js/attendanceImport.js");

// Un zip minimo: cabecera local + datos por archivo, directorio central y fin.
function zip(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;

    Object.entries(files).forEach(([name, text], index) => {
        const nameBytes = Buffer.from(name);
        const raw = Buffer.from(text);
        // Uno guardado sin comprimir, para cubrir los dos metodos.
        const stored = index === 0;
        const data = stored ? raw : deflateRawSync(raw);
        const local = Buffer.alloc(30);

        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(stored ? 0 : 8, 8);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);

        const central = Buffer.alloc(46);

        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(stored ? 0 : 8, 10);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(raw.length, 24);
        central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt32LE(offset, 42);

        locals.push(local, nameBytes, data);
        centrals.push(central, nameBytes);
        offset += 30 + nameBytes.length + data.length;
    });

    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);

    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Object.keys(files).length, 8);
    end.writeUInt16LE(Object.keys(files).length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);

    const out = Buffer.concat([...locals, directory, end]);

    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

const strings = [
    "RUN", "Nombre", "Fecha", "Hora", "Tipo", "Reloj",
    "12850957-7", "ABARZUA RUIZ MARGARITA", "24/09/2026", "07:45:19", "ENTRADA",
    "APP M&#211;VIL", "SALIDA"
];

function planilla() {
    const si = strings.map(text => `<si><t>${text}</t></si>`).join("");
    const s = (ref, index) => `<c r="${ref}" t="s"><v>${index}</v></c>`;

    return zip({
        "[Content_Types].xml": "<Types/>",
        "xl/workbook.xml":
            '<workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels":
            '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
        "xl/sharedStrings.xml": `<sst>${si}</sst>`,
        "xl/worksheets/sheet1.xml": "<worksheet><sheetData>" +
            `<row r="1">${s("B1", 0)}${s("C1", 1)}${s("F1", 2)}${s("G1", 3)}${s("H1", 4)}${s("I1", 5)}</row>` +
            `<row r="2"><c r="A2"><v>5</v></c>${s("B2", 6)}${s("C2", 7)}${s("F2", 8)}${s("G2", 9)}${s("H2", 10)}${s("I2", 11)}<c r="J2" s="1"/></row>` +
            // Fecha como serial de Excel y hora como fraccion de dia.
            `<row r="3">${s("B3", 6)}<c r="F3"><v>46289</v></c><c r="G3"><v>0.7090277777777778</v></c>${s("H3", 12)}</row>` +
            "</sheetData></worksheet>"
    });
}

test("reconoce un .xlsx por su contenido", () => {
    assert.equal(isXlsxFile(planilla()), true);
    assert.equal(isXlsxFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]).buffer), false);
});

test("lee las celdas de la primera hoja en su columna", async () => {
    const rows = await readXlsxRows(planilla());

    assert.deepEqual(rows[0], [null, "RUN", "Nombre", null, null, "Fecha", "Hora", "Tipo", "Reloj"]);
    assert.equal(rows[1][0], 5);
    assert.equal(rows[1][8], "APP MÓVIL");
    assert.equal(rows[1].length, 10);
});

test("arma cada marca con la Fecha y la Hora de columnas separadas", async () => {
    const { marks, skipped } = parseAttendanceRows(await readXlsxRows(planilla()));

    assert.equal(skipped, 0);
    assert.deepEqual(marks.map(({ rut, date, time, type }) => ({ rut, date, time, type })), [
        { rut: "12850957-7", date: "2026-09-24", time: "07:45", type: "in" },
        { rut: "12850957-7", date: "2026-09-24", time: "17:01", type: "out" }
    ]);
});

test("la fecha en texto se lee dia primero, y la de EE.UU. solo si no cabe al reves", () => {
    const rows = [
        ["RUT", "Fecha/Hora", "Tipo"],
        ["1-9", "05/03/2026 08:10", "Entrada"],
        ["1-9", "03/25/2026 08:10", "Entrada"],
        ["1-9", "2026-03-06 08:10", "Entrada"]
    ];

    assert.deepEqual(
        parseAttendanceRows(rows).marks.map(mark => `${mark.date} ${mark.time}`),
        ["2026-03-05 08:10", "2026-03-25 08:10", "2026-03-06 08:10"]
    );
});
