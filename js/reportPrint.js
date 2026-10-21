// Genera e imprime un reporte: abre una ventana nueva con el HTML del reporte y
// una hoja de estilos de impresion embebida, y dispara el dialogo de impresion.

import { escapeHTML } from "./htmlUtils.js";

function sanitizePrintHTML(value) {
    const template = document.createElement("template");
    template.innerHTML = String(value || "");

    template.content
        .querySelectorAll(
            "script, iframe, frame, object, embed, base, meta, link, form"
        )
        .forEach(element => element.remove());

    template.content.querySelectorAll("*").forEach(element => {
        Array.from(element.attributes).forEach(attribute => {
            const name = attribute.name.toLowerCase();
            const content = attribute.value.trim().toLowerCase();

            if (
                name.startsWith("on") ||
                name === "srcdoc" ||
                (
                    ["href", "src", "xlink:href", "formaction"].includes(name) &&
                    /^(?:javascript|vbscript):/.test(content)
                )
            ) {
                element.removeAttribute(attribute.name);
            }
        });
    });

    return template.innerHTML;
}

/**
 * Las imagenes con su direccion completa.
 *
 * En la ventana de impresion una ruta relativa ("img/logo.jpeg") se resuelve
 * contra la pagina; en el archivo de Word descargado no hay contra que
 * resolverla y el logo sale como un recuadro roto.
 *
 * @param {string} html
 * @param {string} baseURI
 * @returns {string}
 */
export function withAbsoluteImageSources(html, baseURI) {
    return String(html || "").replace(
        /(<img\b[^>]*?\ssrc=")(?!https?:|data:|\/\/)([^"]+)(")/gi,
        (match, before, src, after) => {
            try {
                return `${before}${new URL(src, baseURI).href}${after}`;
            } catch {
                return match;
            }
        }
    );
}

/**
 * Descarga el mismo reporte como documento de Word.
 *
 * Es el HTML del reporte envuelto para Word, no un .docx armado a mano: Word
 * abre ese formato desde hace veinte años conservando la tabla, los bordes y
 * los colores, y asi el documento descargado es EXACTAMENTE lo que se ve al
 * imprimir. Armar un .docx de verdad obligaria a reconstruir la tabla a mano y
 * a que los dos caminos se fueran pareciendo cada vez menos.
 *
 * La hoja va apaisada porque es como se imprime el Anexo (@page landscape).
 */
export function downloadReportAsWord(html, title) {
    if (!html) {
        alert("No fue posible generar el reporte.");
        return false;
    }

    // Word no entiende CSS grid ni posicionados, y las rutas relativas de las
    // imagenes se rompen al abrir el archivo descargado. Se traduce lo justo
    // para que el documento se vea como el impreso: el logo con su direccion
    // completa, el encabezado institucional en dos columnas de tabla y la
    // barra institucional al pie en vez de flotando.
    const safeHTML = withAbsoluteImageSources(
        sanitizePrintHTML(html),
        document.baseURI
    );
    const nombre = `${String(title || "Reporte").replace(/[\\/:*?"<>|]/g, "-")}.doc`;
    const documento = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office"
              xmlns:w="urn:schemas-microsoft-com:office:word"
              xmlns="http://www.w3.org/TR/REC-html40">
            <head>
                <meta charset="UTF-8">
                <title>${escapeHTML(title || "Reporte")}</title>
                <style>
                    @page {
                        size: A4 landscape;
                        mso-page-orientation: landscape;
                        margin: 12mm;
                    }
                    body {
                        font-family: Arial, sans-serif;
                        font-size: 10pt;
                        color: #111827;
                    }
                    table {
                        border-collapse: collapse;
                        width: 100%;
                    }
                    th, td {
                        border: 1px solid #94a3b8;
                        padding: 3px 5px;
                        font-size: 9pt;
                        vertical-align: middle;
                    }
                    thead th {
                        background: #e2e8f0;
                    }

                    /* Lo que Word no sabe hacer, traducido a lo que si sabe. */
                    .tens-annex,
                    .tens-annex__institution,
                    .tens-annex__meta,
                    .tens-annex__functions {
                        display: block;
                        min-height: 0;
                    }
                    .tens-annex__institution img {
                        float: left;
                        width: 105px;
                        margin: 0 14px 6px 0;
                    }
                    .tens-annex__institution p {
                        margin: 0 0 2px;
                        font-size: 8pt;
                    }
                    .tens-annex h1 {
                        clear: both;
                        padding-top: 10px;
                    }
                    .tens-annex table {
                        font-size: 8pt;
                    }
                    .tens-annex th,
                    .tens-annex td {
                        border: 1px solid #000;
                        padding: 3px;
                    }
                    /* Flotando se cruzaba sobre la tabla: en Word va al final,
                       que es donde se ve en el impreso. */
                    .tens-annex__footer-rule {
                        position: static;
                        display: block;
                        width: 100%;
                        height: 3px;
                        margin-top: 24px;
                        background: #006cb7;
                    }
                    .tens-annex__footer-rule span { display: none; }
                    .tens-annex--new-page {
                        page-break-before: always;
                        mso-break-type: page-break;
                    }
                </style>
            </head>
            <body>${safeHTML}</body>
        </html>
    `;
    const url = URL.createObjectURL(new Blob(
        ["﻿", documento],
        { type: "application/msword" }
    ));
    const link = document.createElement("a");

    link.href = url;
    link.download = nombre;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    return true;
}

export function printReportPreviewHTML(html, title) {
    if (!html) {
        alert("No fue posible generar el reporte para imprimir.");
        return;
    }

    const printWindow = window.open(
        "",
        "_blank",
        "width=1100,height=800"
    );

    if (!printWindow) {
        alert("Permite las ventanas emergentes para imprimir el reporte.");
        return;
    }

    printWindow.document.open();
    const safeHTML = sanitizePrintHTML(html);

    printWindow.document.write(`
        <!doctype html>
        <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta name="referrer" content="no-referrer">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; base-uri 'none'; form-action 'none'">
                <title>${escapeHTML(title || "Reporte")}</title>
                <link rel="stylesheet" href="styles.css">
                <style>
                    :root {
                        --accent: #1d6cff;
                        --panel: #ffffff;
                        --panel-alt: #ffffff;
                        --field: #ffffff;
                        --border: #e5e7eb;
                        --text: #0f172a;
                        --text-soft: #1e2f4d;
                        --text-muted: #64748b;
                    }

                    *,
                    *::before,
                    *::after {
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                        color-adjust: exact !important;
                    }

                    html,
                    body {
                        width: 100%;
                        min-height: 100%;
                        margin: 0;
                        background: #ffffff !important;
                        color: #111827 !important;
                    }

                    body::before,
                    body::after {
                        display: none !important;
                    }

                    .report-print-page {
                        max-width: 1180px;
                        margin: 0 auto;
                        padding: 18px;
                        box-sizing: border-box;
                        background: #ffffff;
                    }

                    .report-print-page .report-title-strip {
                        display: block;
                    }

                    .report-print-page .no-assignment-report {
                        display: grid;
                        gap: 12px;
                    }

                    .report-print-page .report-title-strip {
                        padding: 10px 12px;
                        border-radius: 12px;
                        background: #0f172a !important;
                        color: #ffffff !important;
                        font-weight: 900;
                        text-align: center;
                    }

                    .report-print-page .report-section {
                        display: grid;
                        gap: 6px;
                        min-width: 0;
                    }

                    .report-print-page .report-section h4 {
                        margin: 0;
                        padding: 7px 10px;
                        border-radius: 10px;
                        background: #1d6cff !important;
                        color: #ffffff !important;
                        font-size: 0.82rem;
                        text-transform: uppercase;
                    }

                    .report-print-page .report-table-wrap {
                        overflow: visible;
                        border-radius: 12px;
                        border: 1px solid #e5e7eb;
                        background: #ffffff !important;
                    }

                    .report-print-page .report-table {
                        width: 100%;
                        border-collapse: collapse;
                        font-size: 0.8rem;
                    }

                    .report-print-page .report-table th,
                    .report-print-page .report-table td {
                        padding: 7px 8px;
                        border: 1px solid #e5e7eb;
                        text-align: left;
                        vertical-align: top;
                    }

                    .report-print-page .report-table th {
                        background: #dbeafe !important;
                        color: #0f172a !important;
                        font-weight: 800;
                    }

                    .report-print-page .report-table td {
                        background: #ffffff !important;
                        color: #1e2f4d !important;
                    }

                    .report-print-page .report-worker-data-grid {
                        display: grid !important;
                        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                        gap: 12px !important;
                    }

                    .report-print-page .report-worker-data-column {
                        min-width: 0;
                    }

                    .report-print-page .report-section--worker-data .report-table {
                        min-width: 0;
                    }

                    .report-print-page .report-section--worker-data .report-table th:first-child,
                    .report-print-page .report-section--worker-data .report-table td:first-child {
                        width: 1%;
                        padding-right: 22px;
                        white-space: nowrap;
                    }

                    .report-print-page .report-row--inhabil td:first-child {
                        background: #fee2e2 !important;
                    }

                    .report-print-page .report-signature-footer {
                        justify-self: end;
                        width: min(320px, 42%);
                        min-width: 240px;
                        margin-top: 24mm;
                        margin-right: 10mm;
                        padding: 2mm 0 0;
                        border-top: 1px solid #1e2f4d;
                        color: #1e2f4d !important;
                        font-size: 0.78rem;
                        font-weight: 650;
                        line-height: 1.3;
                        text-align: center;
                        break-inside: avoid;
                        page-break-inside: avoid;
                    }

                    @media print {
                        @page {
                            size: A4 landscape;
                            margin: 12mm;
                        }

                        html,
                        body {
                            width: auto;
                            min-height: 0;
                            padding: 0 !important;
                        }

                        .report-print-page {
                            max-width: none;
                            width: 100%;
                            padding: 4mm;
                            box-sizing: border-box;
                            -webkit-box-decoration-break: clone;
                            box-decoration-break: clone;
                        }

                        .report-print-page .no-assignment-report {
                            gap: 8px;
                        }

                        .report-print-page .report-section {
                            break-inside: auto;
                            page-break-inside: auto;
                        }

                        .report-print-page .report-section h4 {
                            break-after: avoid;
                            page-break-after: avoid;
                        }

                        .report-print-page .report-table-wrap {
                            break-inside: auto;
                            page-break-inside: auto;
                        }

                        .report-print-page .report-worker-data-grid {
                            display: grid !important;
                            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                        }

                        .report-print-page .report-table {
                            page-break-inside: auto;
                        }

                        .report-print-page .report-table tr {
                            break-inside: avoid;
                            page-break-inside: avoid;
                        }
                    }
                </style>
            </head>
            <body class="theme-light">
                <main class="report-print-page">
                    ${safeHTML}
                </main>
            </body>
        </html>
    `);
    printWindow.document.close();

    const runPrint = () => {
        printWindow.focus();
        printWindow.print();
    };

    if (printWindow.document.readyState === "complete") {
        window.setTimeout(runPrint, 300);
    } else {
        printWindow.addEventListener("load", () =>
            window.setTimeout(runPrint, 300),
            { once: true }
        );
    }
}
