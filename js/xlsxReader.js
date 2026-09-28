// Lector minimo de Excel moderno (.xlsx: un zip de XML), para el navegador.
//
// Existe porque algunas unidades bajan el registro del reloj control ya
// guardado como .xlsx ("Planilla de Personal.xlsx" de Imagenologia
// convencional), y el lector de xlsReader.js solo entiende el .xls binario.
//
// Igual que aquel, devuelve las celdas en crudo -texto como texto, numeros como
// numeros- de la PRIMERA hoja del libro, y deja a quien llama decidir que
// columna es una fecha.
//
// Sin dependencias: el zip se recorre a mano y lo comprimido se abre con
// DecompressionStream("deflate-raw"), que traen los navegadores y Node 18+.

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;

export function isXlsxFile(buffer) {
    const bytes = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));

    return ZIP_MAGIC.every((byte, index) => bytes[index] === byte);
}

/**
 * Archivos del zip por nombre, todavia sin descomprimir.
 */
function zipEntries(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;

    // El fin del directorio central esta al final, detras de un comentario de
    // hasta 64 KB.
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
        if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) {
            end = offset;
            break;
        }
    }

    if (end < 0) throw new Error("El archivo .xlsx esta dañado o incompleto.");

    const count = view.getUint16(end + 10, true);
    let offset = view.getUint32(end + 16, true);
    const entries = new Map();
    const decoder = new TextDecoder();

    for (let index = 0; index < count; index++) {
        if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_ENTRY) break;

        const method = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localOffset = view.getUint32(offset + 42, true);
        const name = decoder.decode(
            bytes.subarray(offset + 46, offset + 46 + nameLength)
        );

        // Los datos empiezan tras la cabecera LOCAL, cuyo campo extra puede
        // medir distinto que el del directorio central.
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const start = localOffset + 30 + localNameLength + localExtraLength;

        entries.set(name, {
            method,
            data: bytes.subarray(start, start + compressedSize)
        });
        offset += 46 + nameLength + extraLength + commentLength;
    }

    return entries;
}

async function entryText(entries, name) {
    const entry = entries.get(name);

    if (!entry) return "";
    if (entry.method === 0) return new TextDecoder().decode(entry.data);
    if (entry.method !== 8) {
        throw new Error("El archivo .xlsx usa una compresion no soportada.");
    }

    const stream = new Blob([entry.data])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));

    return new Response(stream).text();
}

function decodeXml(text) {
    return String(text || "").replace(
        /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
        (_, code) => {
            const lower = code.toLowerCase();

            if (lower === "amp") return "&";
            if (lower === "lt") return "<";
            if (lower === "gt") return ">";
            if (lower === "quot") return "\"";
            if (lower === "apos") return "'";
            if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));

            return String.fromCodePoint(parseInt(lower.slice(1), 10));
        }
    );
}

// Todo el texto de un <si> o un <is>: un texto con formato viene partido en
// varios <r><t>, y la guia fonetica (<rPh>) no es parte del valor.
function richText(xml) {
    const sinFonetica = String(xml || "").replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
    let text = "";

    sinFonetica.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (_, value) => {
        text += decodeXml(value);
        return "";
    });

    return text;
}

function sharedStrings(xml) {
    const strings = [];

    String(xml || "").replace(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g, (_, body) => {
        strings.push(richText(body));
        return "";
    });

    return strings;
}

function attribute(tag, name) {
    const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);

    return match ? decodeXml(match[1]) : "";
}

function columnIndex(ref) {
    const letters = /^[A-Z]+/i.exec(String(ref || ""))?.[0].toUpperCase() || "";
    let index = 0;

    for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);

    return index - 1;
}

/**
 * Ruta de la primera hoja, segun el orden del libro y no el nombre del archivo.
 */
async function firstSheetPath(entries) {
    const workbook = await entryText(entries, "xl/workbook.xml");
    const sheetTag = /<sheet\b[^>]*>/.exec(workbook)?.[0] || "";
    const relId = attribute(sheetTag, "r:id");
    const rels = await entryText(entries, "xl/_rels/workbook.xml.rels");
    let target = "";

    rels.replace(/<Relationship\b[^>]*>/g, tag => {
        if (!target && attribute(tag, "Id") === relId) target = attribute(tag, "Target");
        return tag;
    });

    if (target) {
        const path = target.startsWith("/")
            ? target.slice(1)
            : `xl/${target.replace(/^\.\//, "")}`;

        if (entries.has(path)) return path;
    }

    return [...entries.keys()]
        .filter(name => /^xl\/worksheets\/[^/]+\.xml$/.test(name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0] || "";
}

/**
 * Filas de la primera hoja de un .xlsx.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<Array<Array<string|number|boolean|null>>>}
 */
export async function readXlsxRows(buffer) {
    const bytes = new Uint8Array(buffer);

    if (!isXlsxFile(buffer)) {
        throw new Error("El archivo no tiene el formato Excel esperado (.xlsx).");
    }

    const entries = zipEntries(bytes);
    const sheetPath = await firstSheetPath(entries);

    if (!sheetPath) throw new Error("El archivo .xlsx no trae ninguna hoja.");

    const strings = sharedStrings(await entryText(entries, "xl/sharedStrings.xml"));
    const sheet = await entryText(entries, sheetPath);
    const rows = [];
    let nextRow = 0;

    sheet.replace(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g, (_, attrs, body, emptyAttrs) => {
        const rowNumber = Number(attribute(attrs ?? emptyAttrs, "r")) || nextRow + 1;
        const row = [];
        let nextColumn = 0;

        nextRow = rowNumber;

        String(body || "").replace(
            /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g,
            (__, emptyCell, cellAttrs, cellBody) => {
                const attrsText = emptyCell ?? cellAttrs;
                const ref = attribute(attrsText, "r");
                const column = ref ? columnIndex(ref) : nextColumn;

                nextColumn = column + 1;

                if (emptyCell !== undefined) {
                    if (row[column] === undefined) row[column] = null;
                    return "";
                }

                const type = attribute(attrsText, "t");
                const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cellBody)?.[1];
                let value = null;

                if (type === "s") value = strings[Number(raw)] ?? "";
                else if (type === "inlineStr") value = richText(cellBody);
                else if (type === "str" || type === "e") value = decodeXml(raw ?? "");
                else if (type === "b") value = raw === "1";
                else if (raw !== undefined && raw !== "") {
                    const number = Number(raw);

                    value = Number.isFinite(number) ? number : decodeXml(raw);
                }

                row[column] = value;
                return "";
            }
        );

        for (let index = 0; index < row.length; index++) {
            if (row[index] === undefined) row[index] = null;
        }

        rows[rowNumber - 1] = row;
        return "";
    });

    for (let index = 0; index < rows.length; index++) {
        if (!rows[index]) rows[index] = [];
    }

    return rows;
}
