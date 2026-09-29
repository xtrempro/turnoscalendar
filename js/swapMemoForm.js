// Anexo 4: "Formulario unico de solicitud de cambio de turno", relleno.
//
// Cada cambio de turno origina un memorandum que la unidad envia a Personal en
// ese formulario. Aqui se rellena la plantilla oficial (reports/
// anexo4-cambio-turno.docx) con los datos del cambio, para imprimirla, firmarla
// y adjuntarla despues en Memorandum. El MOTIVO y las firmas quedan en blanco:
// TurnoPlus no registra el motivo, lo escribe a mano el propio trabajador.
//
// Sin DOM: se prueba en Node con la plantilla real.

import {
    readZipEntries,
    replaceZipEntryText,
    writeZip,
    zipEntryText
} from "./zipUtils.js";

export const ANEXO4_TEMPLATE_URL = "reports/anexo4-cambio-turno.docx";
const DOCUMENT_PATH = "word/document.xml";

function pad2(value) {
    return String(value).padStart(2, "0");
}

function isoParts(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));

    return match ? match.slice(1).map(Number) : null;
}

export function formatAnexoDate(iso) {
    const parts = isoParts(iso);

    return parts ? `${pad2(parts[2])}/${pad2(parts[1])}/${parts[0]}` : "";
}

function isFriday(iso) {
    const parts = isoParts(iso);

    return parts
        ? new Date(parts[0], parts[1] - 1, parts[2]).getDay() === 5
        : false;
}

// El mismo horario estandar que el inicio (home.js standardSchedule), por el
// codigo con que se guarda un cambio de turno (swaps.js swapCodeLabel).
export function swapShiftSchedule(code, iso) {
    const diurnoEnd = isFriday(iso) ? "16:00" : "17:00";

    switch (String(code || "")) {
        case "L": return "08:00 a 20:00";
        case "N": return "20:00 a 08:00";
        case "24": return "08:00 a 08:00";
        case "D": return `08:00 a ${diurnoEnd}`;
        case "D+N": return `08:00 a ${diurnoEnd} y 20:00 a 08:00`;
        case "HM": return "08:00 a 14:00";
        case "HT": return "14:00 a 20:00";
        case "18": return "14:00 a 08:00";
        default: return "";
    }
}

function shiftLabel(code) {
    const labels = {
        L: "Larga",
        N: "Noche",
        "24": "24h",
        D: "Diurno",
        "D+N": "D+N",
        HM: "1/2 Mañana",
        HT: "1/2 Tarde",
        "18": "18 horas"
    };

    return labels[String(code || "")] || String(code || "");
}

// La columna del RUT es angosta: con puntos, "15.123.456-7" se partia en dos
// lineas justo en el guion. Sin puntos y con guion que no corta (U+2011) cabe
// entero.
export function formatAnexoRut(value) {
    const clean = String(value || "").replace(/[^0-9kK]/g, "").toUpperCase();

    if (clean.length < 2) return String(value || "").trim();

    return `${clean.slice(0, -1)}‑${clean.slice(-1)}`;
}

function timestampToISO(value) {
    if (!value) return "";

    const date = typeof value === "number" ? new Date(value) : new Date(String(value));

    if (Number.isNaN(date.getTime())) return "";

    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * Los datos del formulario para un cambio de turno.
 *
 * Quien CEDE (`from`) es el funcionario; su companero (`to`) es el
 * "funcionario cambio". El turno original es el que cede en `fecha`; el turno
 * cambio, el que hace en su lugar en `devolucion`.
 *
 * @param {object} swap registro de la clave `swaps`
 * @param {{unitName?: string, rutFor?: (name: string) => string, requestedAt?: string|number}} context
 */
export function anexo4Data(swap = {}, context = {}) {
    const rutFor = typeof context.rutFor === "function" ? context.rutFor : () => "";
    const day = (iso, code, skipped) => skipped || !iso
        ? ""
        : [formatAnexoDate(iso), shiftLabel(code)].filter(Boolean).join("\n");
    const schedule = (iso, code, skipped) => skipped || !iso
        ? ""
        : swapShiftSchedule(code, iso);

    return {
        unit: String(context.unitName || ""),
        requestDate: formatAnexoDate(
            timestampToISO(context.requestedAt) || timestampToISO(Number(swap.id))
        ),
        rut: formatAnexoRut(rutFor(swap.from)),
        name: String(swap.from || ""),
        counterpartRut: formatAnexoRut(rutFor(swap.to)),
        counterpartName: String(swap.to || ""),
        originalDay: day(swap.fecha, swap.turno, swap.skipFecha),
        originalSchedule: schedule(swap.fecha, swap.turno, swap.skipFecha),
        changeDay: day(swap.devolucion, swap.turnoDevuelto, swap.skipDevolucion),
        changeSchedule: schedule(swap.devolucion, swap.turnoDevuelto, swap.skipDevolucion)
    };
}

function escapeXml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Deja `text` como unico contenido del primer parrafo de una celda, con el
 * formato de letra de ese parrafo (sin negrita ni subrayado: es un dato, no un
 * rotulo).
 */
function fillCell(cellXml, text, { size = "" } = {}) {
    const paragraph = /<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/.exec(cellXml);

    if (!paragraph) return cellXml;

    const source = paragraph[0];
    const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(source)?.[0] || "";
    const markRPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(pPr)?.[1] || "";
    let runRPr = markRPr
        .replace(/<w:b\/>|<w:bCs\/>|<w:u\b[^>]*\/>/g, "");

    if (size) {
        runRPr = runRPr
            .replace(/<w:sz w:val="\d+"\/>/, `<w:sz w:val="${size}"/>`)
            .replace(/<w:szCs w:val="\d+"\/>/, `<w:szCs w:val="${size}"/>`);
    }

    const open = /^<w:p\b[^>]*?(\/?)>/.exec(source);
    const openTag = open[0].replace(/\/>$/, ">");
    // Un salto de linea en el texto es un salto de linea en la celda: asi la
    // fecha y el tipo de turno quedan en dos lineas limpias, sin que la celda
    // parta la fecha donde le acomode.
    const run = text
        ? `<w:r><w:rPr>${runRPr}</w:rPr>${String(text)
            .split("\n")
            .map(line => `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`)
            .join("<w:br/>")}</w:r>`
        : "";

    return cellXml.replace(source, `${openTag}${pPr}${run}</w:p>`);
}

function cellsOf(rowXml) {
    return [...rowXml.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map(match => match[0]);
}

function rowsOf(tableXml) {
    return [...tableXml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map(match => match[0]);
}

function fillRow(rowXml, values, options = {}) {
    let result = rowXml;

    cellsOf(rowXml).forEach((cell, index) => {
        if (values[index] === undefined) return;

        result = result.replace(cell, fillCell(cell, values[index], options));
    });

    return result;
}

/* ---------- Ajustes de formato sobre la plantilla ----------

   La plantilla original tiene la tabla del detalle al 116 % del ancho util y
   corrida a la izquierda, margenes de ~2,8 cm y 17 parrafos vacios al final:
   segun el visor, el RUT y las fechas se partian en dos lineas y el formulario
   pasaba a una segunda hoja. Se corrige al generarlo; el archivo oficial no se
   toca. Pagina oficio: 12240 de ancho, en twips (1 cm = 567). */

const PAGE_MARGIN = { top: 1000, right: 850, bottom: 1000, left: 850, header: 500, footer: 500 };
// Suma = 12240 - 850 - 850 = 10540: la tabla ocupa exacto el ancho util.
const DETAIL_COLUMNS = [1250, 1800, 1250, 1800, 1200, 1020, 1200, 1020];
const DETAIL_FONT_SIZE = "18"; // 9 pt, en medios puntos

function withPageMargins(xml) {
    return xml.replace(/<w:pgMar\b[^>]*\/>/, () =>
        `<w:pgMar w:top="${PAGE_MARGIN.top}" w:right="${PAGE_MARGIN.right}" ` +
        `w:bottom="${PAGE_MARGIN.bottom}" w:left="${PAGE_MARGIN.left}" ` +
        `w:header="${PAGE_MARGIN.header}" w:footer="${PAGE_MARGIN.footer}" w:gutter="0"/>`
    );
}

function withDetailColumns(tableXml) {
    let cellIndex = 0;

    return tableXml
        .replace(/<w:tblW\b[^>]*\/>/, `<w:tblW w:w="${DETAIL_COLUMNS.reduce((a, b) => a + b, 0)}" w:type="dxa"/>`)
        .replace(/<w:tblInd\b[^>]*\/>/, `<w:tblInd w:w="0" w:type="dxa"/><w:tblLayout w:type="fixed"/>`)
        .replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/, () =>
            `<w:tblGrid>${DETAIL_COLUMNS.map(width => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>`
        )
        .replace(/<w:tcW\b[^>]*\/>/g, () => {
            const width = DETAIL_COLUMNS[cellIndex % DETAIL_COLUMNS.length];

            cellIndex++;
            return `<w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="center"/>`;
        })
        // Filas mas bajas: la plantilla las fija altas para escribir a mano.
        .replace(/<w:trHeight w:val="\d+"\/>/g, `<w:trHeight w:val="600"/>`);
}

function paragraphText(paragraphXml) {
    return [...paragraphXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
        .map(match => match[1])
        .join("")
        .trim();
}

// Tras la "Nota" final no queda nada que imprimir: esos parrafos vacios eran
// los que abrian una segunda hoja. Antes de la nota se dejan dos de aire.
function withoutTrailingBlankParagraphs(xml) {
    const noteIndex = xml.lastIndexOf("Nota:");

    if (noteIndex < 0) return xml;

    const noteStart = xml.lastIndexOf("<w:p ", noteIndex);
    const noteEnd = xml.indexOf("</w:p>", noteIndex) + "</w:p>".length;
    const before = xml.slice(0, noteStart);
    const note = xml.slice(noteStart, noteEnd);
    const after = xml.slice(noteEnd).replace(
        /<w:p\b[^>]*?(?:\/>|>[\s\S]*?<\/w:p>)/g,
        paragraph => paragraphText(paragraph) ? paragraph : ""
    );
    const trimmedBefore = before.replace(
        /((?:<w:p\b[^>]*?(?:\/>|>(?:(?!<w:p[ >])[\s\S])*?<\/w:p>))+)$/,
        blanks => {
            const paragraphs = blanks.match(/<w:p\b[^>]*?(?:\/>|>(?:(?!<w:p[ >])[\s\S])*?<\/w:p>)/g) || [];

            if (paragraphs.some(paragraph => paragraphText(paragraph))) return blanks;

            return paragraphs.slice(0, 2).join("");
        }
    );

    return `${trimmedBefore}${note}${after}`;
}

/**
 * El document.xml de la plantilla con los datos puestos.
 *
 * Tabla 1: fila 1 "UNIDAD / SERVICIO", fila 2 "FECHA DE SOLICITUD" (su
 * "____/____/ ____" se reemplaza). Tabla 2: la fila 2, bajo los 8 rotulos.
 */
export function fillAnexo4DocumentXml(xml, data) {
    const tables = [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map(match => match[0]);

    if (tables.length < 2) {
        throw new Error("La plantilla del Anexo 4 no tiene la forma esperada.");
    }

    const [general, detail] = tables;
    const generalRows = rowsOf(general);
    let filledGeneral = general
        .replace(generalRows[0], fillRow(generalRows[0], [undefined, data.unit]))
        .replace(generalRows[1], fillRow(generalRows[1], [undefined, data.requestDate || "____/____/ ____"]));
    const detailRows = rowsOf(detail);
    const filledDetail = withDetailColumns(detail.replace(
        detailRows[1],
        fillRow(detailRows[1], [
            data.rut,
            data.name,
            data.counterpartRut,
            data.counterpartName,
            data.originalDay,
            data.originalSchedule,
            data.changeDay,
            data.changeSchedule
        ], { size: DETAIL_FONT_SIZE })
    ));

    return withoutTrailingBlankParagraphs(withPageMargins(
        xml.replace(general, filledGeneral).replace(detail, filledDetail)
    ));
}

/**
 * El .docx relleno, listo para descargar.
 * @param {ArrayBuffer|Uint8Array} templateBytes
 * @returns {Promise<Uint8Array>}
 */
export async function buildAnexo4Docx(templateBytes, data) {
    const entries = readZipEntries(templateBytes);
    const index = entries.findIndex(entry => entry.name === DOCUMENT_PATH);

    if (index < 0) throw new Error("La plantilla del Anexo 4 esta dañada.");

    const xml = await zipEntryText(entries[index]);

    entries[index] = replaceZipEntryText(
        entries[index],
        fillAnexo4DocumentXml(xml, data)
    );

    return writeZip(entries);
}

export function anexo4FileName(data = {}) {
    const clean = value => String(value || "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    const day = clean(String(data.originalDay || "").split(/\s/)[0]);

    return `Anexo4_cambio_turno_${clean(data.name)}${day ? `_${day}` : ""}.docx`;
}
