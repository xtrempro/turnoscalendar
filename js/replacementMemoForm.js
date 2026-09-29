// Memorandum de solicitud de contrato por reemplazo, relleno.
//
// Cada contrato de reemplazo origina un memorandum que la unidad envia a
// Gestion de las Personas. Aqui se rellena el formato de la unidad (reports/
// memo-reemplazo.docx) con los datos del contrato, para imprimirlo, firmarlo y
// adjuntarlo en Memorandum.
//
// UN reemplazo por memorandum: el formato admite varios (una vineta por
// reemplazo), pero en TurnoPlus cada contrato es su propio memorandum y asi se
// sigue cual esta hecho y cual no. Se deja una sola vineta.
//
// Sin DOM: se prueba en Node con la plantilla real.

import {
    readZipEntries,
    replaceZipEntryText,
    writeZip,
    zipEntryText
} from "./zipUtils.js";

export const REPLACEMENT_MEMO_TEMPLATE_URL = "reports/memo-reemplazo.docx";
const DOCUMENT_PATH = "word/document.xml";

// El motivo como se lee en la frase "reemplazo por ___". El contrato guarda la
// etiqueta corta del permiso (replacementLeaveGrouping.js).
const REASON_PHRASES = {
    "f. legal": "feriado legal",
    "f. compensatorios": "feriado compensatorio",
    "f. compensatorio": "feriado compensatorio",
    "licencia médica": "licencia médica",
    "lm profesional": "licencia médica profesional",
    "permiso sin goce": "permiso sin goce de remuneraciones"
};

export function replacementReasonPhrase(reason) {
    const clean = String(reason || "").trim();

    if (!clean) return "ausencia";

    return REASON_PHRASES[clean.toLowerCase()] || clean.toLowerCase();
}

function isoParts(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));

    return match ? match.slice(1).map(Number) : null;
}

function pad2(value) {
    return String(value).padStart(2, "0");
}

// "18.05.2026", como en el formato de la unidad.
export function formatMemoDate(iso) {
    const parts = isoParts(iso);

    return parts ? `${pad2(parts[2])}.${pad2(parts[1])}.${parts[0]}` : "";
}

// Dias corridos, contando el primero y el ultimo (18 al 28 = 11 dias).
export function contractDays(startISO, endISO) {
    const start = isoParts(startISO);
    const end = isoParts(endISO);

    if (!start || !end) return 0;

    const ms = Date.UTC(end[0], end[1] - 1, end[2]) - Date.UTC(start[0], start[1] - 1, start[2]);

    return Math.max(0, Math.round(ms / 86400000) + 1);
}

// "21.514.566-2".
export function formatMemoRut(value) {
    const clean = String(value || "").replace(/[^0-9kK]/g, "").toUpperCase();

    if (clean.length < 2) return String(value || "").trim();

    const body = clean.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

    return `${body}-${clean.slice(-1)}`;
}

/**
 * Los datos del memorandum para un contrato de reemplazo.
 *
 * @param {{start: string, end: string, replaces: string, reason?: string}} contract
 * @param {{name: string, rut?: string, estamento?: string, profession?: string}} worker el reemplazante
 * @param {{unitName?: string}} context
 */
export function replacementMemoData(contract = {}, worker = {}, context = {}) {
    const profession = String(worker.profession || "").trim();
    const estamento = String(worker.estamento || "").trim();

    return {
        unit: String(context.unitName || ""),
        reason: replacementReasonPhrase(contract.reason),
        estamento: estamento.toLowerCase(),
        days: contractDays(contract.start, contract.end),
        start: formatMemoDate(contract.start),
        end: formatMemoDate(contract.end),
        replaced: String(contract.replaces || "").trim(),
        name: String(worker.name || "").trim(),
        rut: formatMemoRut(worker.rut),
        profession: profession && !/^sin informaci/i.test(profession)
            ? profession
            : estamento
    };
}

function escapeXml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function textOf(paragraphXml) {
    return [...paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
        .map(match => match[1])
        .join("");
}

function run(text, rPr = "") {
    return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

// El parrafo con su formato (pPr) y un solo texto, con la letra de su primer
// fragmento de texto.
function paragraphWithText(paragraphXml, text) {
    const open = /^<w:p\b[^>]*>/.exec(paragraphXml)[0];
    const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(paragraphXml)?.[0] || "";
    const firstRun = /<w:r>(?:<w:rPr>([\s\S]*?)<\/w:rPr>)?<w:t\b/.exec(paragraphXml);

    return `${open}${pPr}${run(text, firstRun?.[1] || "")}</w:p>`;
}

/**
 * El document.xml de la plantilla con los datos puestos.
 */
export function fillReplacementMemoXml(xml, data) {
    const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
        .map(match => ({ xml: match[0], text: textOf(match[0]).trim() }));
    const find = predicate => paragraphs.findIndex(predicate);
    const header = find(item => item.text.startsWith("Servicio de Salud"));
    const unit = paragraphs.findIndex((item, index) => index > header && item.text);
    const materia = find(item => item.text.startsWith("MATERIA:"));
    const body = find(item => item.text.startsWith("Por intermedio"));
    const proposal = find(item => item.text.startsWith("Se propone"));

    if ([header, unit, materia, body, proposal].some(index => index < 0) || proposal <= body + 1) {
        throw new Error("La plantilla del memorándum de reemplazo no tiene la forma esperada.");
    }

    const bullets = paragraphs.slice(body + 1, proposal);
    // La ultima vineta es la que trae la sangria colgante: el texto largo se
    // alinea bajo el texto y no bajo el check.
    const bullet = bullets[bullets.length - 1].xml;
    const tabRunEnd = bullet.indexOf("<w:tab/></w:r>");

    if (tabRunEnd < 0) {
        throw new Error("La plantilla del memorándum de reemplazo no tiene la viñeta esperada.");
    }

    const reason = data.reason;
    const newBullet = bullet.slice(0, tabRunEnd + "<w:tab/></w:r>".length) +
        run(
            `Reemplazo por ${reason} por ${data.days} ${data.days === 1 ? "día" : "días"} ` +
            // "Reemplazo por <quien se ausenta>", como lo escribe la unidad. Sin
            // Sr./Srta.: TurnoPlus no registra el sexo de la persona.
            `desde el ${data.start} al ${data.end}. Reemplazo por ${data.replaced}.`,
            "<w:b/>"
        ) +
        "</w:p>";
    const proposalXml = paragraphs[proposal].xml;
    const proposalOpen = /^<w:p\b[^>]*>/.exec(proposalXml)[0];
    const proposalPPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(proposalXml)?.[0] || "";
    const newProposal = `${proposalOpen}${proposalPPr}` +
        run("Se propone como reemplazo a ") +
        run(`${data.name}${data.rut ? `, Rut N° ${data.rut}` : ""}, `, "<w:b/>") +
        run(
            `Profesión u oficio: ${data.profession || "—"}, quien cumple con las disposiciones ` +
            "administrativas y sanitarias necesarias para el proceso de contratación y acreditación en calidad."
        ) +
        "</w:p>";

    const replacements = new Map([
        [unit, paragraphWithText(paragraphs[unit].xml, data.unit)],
        [materia, paragraphWithText(paragraphs[materia].xml, `MATERIA: Reemplazo por ${reason}`)],
        [body, paragraphWithText(
            paragraphs[body].xml,
            "Por intermedio del presente y junto con saludarle, me dirijo a Ud. con el fin de solicitar " +
            `contrato por reemplazo por ${reason}${data.estamento ? ` del estamento ${data.estamento}` : ""} ` +
            "debido al siguiente motivo:"
        )],
        [proposal, newProposal]
    ]);

    bullets.forEach((_, offset) => {
        const index = body + 1 + offset;

        replacements.set(index, index === proposal - 1 ? newBullet : "");
    });

    let result = "";
    let cursor = 0;

    [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].forEach((match, index) => {
        result += xml.slice(cursor, match.index);
        result += replacements.has(index) ? replacements.get(index) : match[0];
        cursor = match.index + match[0].length;
    });

    return result + xml.slice(cursor);
}

/**
 * El .docx relleno, listo para descargar.
 * @returns {Promise<Uint8Array>}
 */
export async function buildReplacementMemoDocx(templateBytes, data) {
    const entries = readZipEntries(templateBytes);
    const index = entries.findIndex(entry => entry.name === DOCUMENT_PATH);

    if (index < 0) throw new Error("La plantilla del memorándum de reemplazo está dañada.");

    const xml = await zipEntryText(entries[index]);

    entries[index] = replaceZipEntryText(entries[index], fillReplacementMemoXml(xml, data));

    return writeZip(entries);
}

export function replacementMemoFileName(data = {}) {
    const clean = value => String(value || "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    return `Memo_reemplazo_${clean(data.name)}_${clean(data.start)}.docx`;
}
