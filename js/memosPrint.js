// El listado de memorandum que se lleva a personal: quien debe que documento,
// desde cuando, y espacio para firmar la recepcion.
//
// Se imprime desde un iframe oculto, igual que el historial de fallas: una
// ventana emergente la bloquea el navegador.

import { escapeHTML } from "./htmlUtils.js";
import {
    MEMO_KINDS,
    MEMO_STATES,
    formatISO,
    groupByWorker,
    memoAmountLabel,
    memoDaysOld,
    memoIsOverdue,
    memoKind,
    memoRangeLabel,
    memoStatus,
    plural,
    timestampISO
} from "./memosInsights.js";

const PRINT_STYLES = `
@page { size: A4; margin: 14mm 12mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Plus Jakarta Sans", "Segoe UI", Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #112038; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.doc-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; padding-bottom: 8px; border-bottom: 2px solid #10498b; margin-bottom: 12px; }
.brand { font-weight: 700; color: #10498b; font-size: 12pt; }
.brand span { color: #0f766e; }
.doc-meta { color: #66748b; font-size: 8.5pt; text-align: right; }
.kicker { color: #0f766e; font-size: 8pt; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
h1 { font-size: 18pt; margin: 2px 0 4px; letter-spacing: -.01em; }
h2 { font-size: 11.5pt; margin: 14px 0 4px; break-after: avoid; }
h2 small { font-weight: 600; color: #66748b; font-size: 8.5pt; margin-left: 6px; }
.summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 10px 0 4px; }
.summary div { border: 1px solid #d5dce8; border-radius: 8px; padding: 6px 9px; }
.summary b { display: block; font-size: 13pt; }
.summary span { font-size: 8pt; color: #30425c; font-weight: 700; }
table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 2px; }
th { text-align: left; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .05em; color: #66748b; border-bottom: 1.5px solid #10498b; padding: 5px 6px; }
td { border-bottom: 1px solid #e2e7f0; padding: 5px 6px; vertical-align: top; }
tr { break-inside: avoid; }
td .muted { color: #66748b; font-size: 8.5pt; }
.tag { display: inline-block; border: 1px solid currentColor; border-radius: 999px; padding: 0 7px; font-size: 8pt; font-weight: 800; }
.tag.danger { color: #b91c1c; } .tag.warn { color: #9a4a0b; } .tag.ok { color: #15803d; }
.sign { margin-top: 26px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; break-inside: avoid; }
.sign div { border-top: 1px solid #112038; padding-top: 4px; font-size: 8.5pt; color: #30425c; text-align: center; }
.empty { color: #66748b; font-style: italic; }
.doc-foot { margin-top: 14px; padding-top: 6px; border-top: 1px solid #d5dce8; color: #66748b; font-size: 8pt; }
`;

function esc(value) {
    return escapeHTML(value);
}

function rowHTML(memo, today) {
    const state = MEMO_STATES[memoStatus(memo)];
    const overdue = memoIsOverdue(memo, today);
    const age = memoDaysOld(memo, today);
    const documents = Array.isArray(memo.documents) ? memo.documents : [];
    const resolution = documents.find(item => item.resolution)?.resolution || "";

    return `<tr>
        <td>${esc(memo.typeLabel || MEMO_KINDS[memoKind(memo)].label)}<div class="muted">${esc(memoAmountLabel(memo))}</div></td>
        <td>${esc(memoRangeLabel(memo))}</td>
        <td>${esc(formatISO(timestampISO(memo.createdAt)))}<div class="muted">${age > 0 ? `hace ${plural(age, "día", "días")}` : "hoy"}</div></td>
        <td><span class="tag ${overdue ? "danger" : state.tone}">${esc(overdue ? `${age} días sin documento` : state.label)}</span></td>
        <td>${resolution
            ? `Res. exenta N° ${esc(resolution)}`
            : memo.requestedAt
                ? `<span class="muted">Se lo pedí el ${esc(formatISO(timestampISO(memo.requestedAt)))}</span>`
                : `<span class="muted">—</span>`}</td>
    </tr>`;
}

/**
 * Hoja con los memorandum agrupados por trabajador.
 *
 * @param {{memos: Array, today: string, unitName: string, printedBy: string,
 *   printedAt: string, title: string, subtitle: string}} options
 * @returns {string}
 */
export function memoListPrintHTML({
    memos = [],
    today = "",
    unitName = "",
    printedBy = "",
    printedAt = "",
    title = "Memorándums pendientes",
    subtitle = ""
} = {}) {
    const groups = groupByWorker(memos);
    const pending = memos.filter(memo => memoStatus(memo) === "pending").length;
    const overdue = memos.filter(memo => memoIsOverdue(memo, today)).length;
    const body = groups.length
        ? groups.map(group => `
            <h2>${esc(group.name)}<small>${esc(plural(group.memos.length, "memorándum", "memorándums"))}${group.pending ? ` · ${group.pending} sin documento` : ""}</small></h2>
            <table>
                <thead><tr><th>Tipo</th><th>Fechas</th><th>Creado</th><th>Estado</th><th>Documento</th></tr></thead>
                <tbody>${group.memos.map(memo => rowHTML(memo, today)).join("")}</tbody>
            </table>`).join("")
        : `<p class="empty">No hay memorándums en este filtro.</p>`;

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>${PRINT_STYLES}</style>
</head>
<body>
<header class="doc-head">
<div class="brand">Turno<span>Plus</span> · Memorándum</div>
<div class="doc-meta">${esc(unitName)}<br>Impreso el ${esc(printedAt)}${printedBy ? ` por ${esc(printedBy)}` : ""}</div>
</header>
<div class="kicker">Documentos del personal</div>
<h1>${esc(title)}</h1>
${subtitle ? `<p>${esc(subtitle)}</p>` : ""}
<div class="summary">
<div><b>${memos.length}</b><span>Memorándums</span></div>
<div><b>${pending}</b><span>Sin documento</span></div>
<div><b>${overdue}</b><span>Atrasados</span></div>
<div><b>${groups.length}</b><span>Trabajadores</span></div>
</div>
${body}
<div class="sign">
<div>Entrega · TurnoPlus</div>
<div>Recibe · Personal</div>
</div>
<footer class="doc-foot">Documento generado desde TurnoPlus${unitName ? ` · ${esc(unitName)}` : ""} · ${esc(printedAt)}</footer>
</body>
</html>`;
}

/**
 * Imprime un documento desde un iframe oculto.
 *
 * @param {string} html
 * @returns {Promise<boolean>}
 */
export function printDocument(html, { timeoutMs = 15000 } = {}) {
    return new Promise(resolve => {
        const frame = document.createElement("iframe");

        frame.setAttribute("aria-hidden", "true");
        frame.setAttribute("title", "Documento para imprimir");
        frame.style.cssText =
            "position:fixed; right:0; bottom:0; width:0; height:0; border:0; visibility:hidden;";
        document.body.appendChild(frame);

        const view = frame.contentWindow;
        const doc = view?.document;
        let removed = false;
        const remove = () => {
            if (removed) return;
            removed = true;
            frame.remove();
        };

        if (!doc) {
            remove();
            resolve(false);
            return;
        }

        doc.open();
        doc.write(html);
        doc.close();
        view.onafterprint = remove;

        const ready = doc.fonts?.ready || Promise.resolve();
        const limit = new Promise(done => setTimeout(done, timeoutMs));

        Promise.race([ready, limit]).then(() => {
            setTimeout(() => {
                view.focus();
                view.print();
                setTimeout(remove, 60000);
                resolve(true);
            }, 60);
        });
    });
}
