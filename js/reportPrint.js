// Genera e imprime un reporte: abre una ventana nueva con el HTML del reporte y
// una hoja de estilos de impresion embebida, y dispara el dialogo de impresion.

import { escapeHTML } from "./htmlUtils.js";

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
    printWindow.document.write(`
        <!doctype html>
        <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
                    ${html}
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
