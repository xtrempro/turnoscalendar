// Leer y volver a armar un .zip (un .docx es un zip de XML), sin dependencias.
//
// Sirve para rellenar una plantilla de Word en el navegador: se leen sus
// archivos, se cambia uno (word/document.xml) y se vuelve a empaquetar. Los
// archivos que no se tocan se copian con sus bytes comprimidos tal cual; solo
// el modificado se guarda sin comprimir (metodo 0), que Word acepta.

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

let crcTable = null;

export function crc32(bytes) {
    if (!crcTable) {
        crcTable = new Uint32Array(256);

        for (let n = 0; n < 256; n++) {
            let c = n;

            for (let k = 0; k < 8; k++) {
                c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            }

            crcTable[n] = c >>> 0;
        }
    }

    let crc = 0xffffffff;

    for (let index = 0; index < bytes.length; index++) {
        crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Archivos del zip en su orden, con sus bytes todavia comprimidos.
 * @param {ArrayBuffer|Uint8Array} buffer
 */
export function readZipEntries(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;

    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
        if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) {
            end = offset;
            break;
        }
    }

    if (end < 0) throw new Error("El archivo no es un .zip valido.");

    const count = view.getUint16(end + 10, true);
    let offset = view.getUint32(end + 16, true);
    const decoder = new TextDecoder();
    const entries = [];

    for (let index = 0; index < count; index++) {
        if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_ENTRY) break;

        const flags = view.getUint16(offset + 8, true);
        const method = view.getUint16(offset + 10, true);
        const time = view.getUint16(offset + 12, true);
        const date = view.getUint16(offset + 14, true);
        const crc = view.getUint32(offset + 16, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const size = view.getUint32(offset + 24, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localOffset = view.getUint32(offset + 42, true);
        const nameBytes = bytes.slice(offset + 46, offset + 46 + nameLength);
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const start = localOffset + 30 + localNameLength + localExtraLength;

        entries.push({
            name: decoder.decode(nameBytes),
            nameBytes,
            // El bit 3 (descriptor de datos) no se copia: los tamaños van en la
            // cabecera que se escribe de nuevo.
            flags: flags & ~0x0008,
            method,
            time,
            date,
            crc,
            compressedSize,
            size,
            data: bytes.slice(start, start + compressedSize)
        });
        offset += 46 + nameLength + extraLength + commentLength;
    }

    return entries;
}

/**
 * Texto de un archivo del zip (metodo 0 o deflate).
 */
export async function zipEntryText(entry) {
    if (!entry) return "";
    if (entry.method === 0) return new TextDecoder().decode(entry.data);
    if (entry.method !== 8) throw new Error("Compresion no soportada en el .zip.");

    const stream = new Blob([entry.data])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));

    return new Response(stream).text();
}

/**
 * Reemplaza el contenido de un archivo, guardandolo sin comprimir.
 */
export function replaceZipEntryText(entry, text) {
    const data = new TextEncoder().encode(text);

    return {
        ...entry,
        method: 0,
        crc: crc32(data),
        compressedSize: data.length,
        size: data.length,
        data
    };
}

/**
 * Vuelve a armar el zip con los archivos dados, en ese orden.
 * @returns {Uint8Array}
 */
export function writeZip(entries) {
    const locals = [];
    const centrals = [];
    let offset = 0;

    entries.forEach(entry => {
        const local = new Uint8Array(30 + entry.nameBytes.length);
        const lv = new DataView(local.buffer);

        lv.setUint32(0, LOCAL_HEADER, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, entry.flags, true);
        lv.setUint16(8, entry.method, true);
        lv.setUint16(10, entry.time, true);
        lv.setUint16(12, entry.date, true);
        lv.setUint32(14, entry.crc, true);
        lv.setUint32(18, entry.compressedSize, true);
        lv.setUint32(22, entry.size, true);
        lv.setUint16(26, entry.nameBytes.length, true);
        local.set(entry.nameBytes, 30);

        const central = new Uint8Array(46 + entry.nameBytes.length);
        const cv = new DataView(central.buffer);

        cv.setUint32(0, CENTRAL_DIRECTORY_ENTRY, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, entry.flags, true);
        cv.setUint16(10, entry.method, true);
        cv.setUint16(12, entry.time, true);
        cv.setUint16(14, entry.date, true);
        cv.setUint32(16, entry.crc, true);
        cv.setUint32(20, entry.compressedSize, true);
        cv.setUint32(24, entry.size, true);
        cv.setUint16(28, entry.nameBytes.length, true);
        cv.setUint32(42, offset, true);
        central.set(entry.nameBytes, 46);

        locals.push(local, entry.data);
        centrals.push(central);
        offset += local.length + entry.data.length;
    });

    const centralSize = centrals.reduce((total, part) => total + part.length, 0);
    const endRecord = new Uint8Array(22);
    const ev = new DataView(endRecord.buffer);

    ev.setUint32(0, END_OF_CENTRAL_DIRECTORY, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    const parts = [...locals, ...centrals, endRecord];
    const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let position = 0;

    parts.forEach(part => {
        out.set(part, position);
        position += part.length;
    });

    return out;
}

/**
 * Un archivo nuevo para writeZip, guardado sin comprimir. El nombre va en
 * UTF-8 (bit 11 de flags) para que las tildes se lean bien al descomprimir.
 */
export function storedZipEntry(name, bytes, when = new Date()) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const time =
        (when.getHours() << 11) |
        (when.getMinutes() << 5) |
        Math.floor(when.getSeconds() / 2);
    const date =
        ((Math.max(1980, when.getFullYear()) - 1980) << 9) |
        ((when.getMonth() + 1) << 5) |
        when.getDate();

    return {
        nameBytes: new TextEncoder().encode(String(name || "archivo")),
        flags: 0x0800,
        method: 0,
        time,
        date,
        crc: crc32(data),
        compressedSize: data.length,
        size: data.length,
        data
    };
}
