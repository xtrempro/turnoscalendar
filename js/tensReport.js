import { escapeHTML } from "./htmlUtils.js";
import { stripAccents } from "./stringUtils.js";

function normalized(value) {
    return stripAccents(String(value || "")).trim().toLowerCase();
}

export function isTensReportProfile(profile) {
    const estamento = normalized(profile?.estamento);

    return estamento === "tecnico" || estamento === "tens";
}

export function tensShiftTypeLabel(rotationType, shiftAssigned) {
    const type = normalized(rotationType);

    if (type === "4turno") {
        return `4° turno ${shiftAssigned ? "con" : "sin"} asignación`;
    }

    if (type === "3turno") {
        return `3° turno ${shiftAssigned ? "con" : "sin"} asignación`;
    }

    if (type === "diurno") return "TENS diurno";
    if (type === "reemplazo") return "Reemplazo";
    return "Turno libre";
}

function formatHours(value) {
    const number = Math.max(0, Number(value) || 0);

    return new Intl.NumberFormat("es-CL", {
        maximumFractionDigits: 2
    }).format(number);
}

function monthName(date) {
    return new Intl.DateTimeFormat("es-CL", { month: "long" })
        .format(date)
        .toLocaleUpperCase("es-CL");
}

export function buildTensConsolidatedReportHTML(rows, monthDate) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const body = safeRows.map(row => `
        <tr>
            <td>${escapeHTML(row.name)}</td>
            <td>${escapeHTML(row.grade || "")}</td>
            <td>${formatHours(row.dayHours)}</td>
            <td>${formatHours(row.festiveHours)}</td>
            <td>${row.returnTransfer ? "X" : ""}</td>
            <td>${row.returnTransfer ? "" : "X"}</td>
            <td>${escapeHTML(row.shiftType)}</td>
        </tr>
    `).join("");

    return `
        <style>
            @page { size: Letter portrait; margin: 25mm 28mm 27mm 27mm; }
            .tens-annex {
                position: relative;
                box-sizing: border-box;
                min-height: 225mm;
                padding: 0;
                color: #000;
                background: #fff;
                font-family: Arial, Helvetica, sans-serif;
                font-size: 9pt;
                line-height: 1.18;
            }
            .tens-annex__institution {
                display: grid;
                grid-template-columns: 31mm minmax(0, 1fr);
                gap: 5mm;
                align-items: start;
                margin-bottom: 8mm;
                font-family: Calibri, Arial, sans-serif;
                font-size: 8pt;
                line-height: 1.2;
            }
            .tens-annex__institution img {
                display: block;
                width: 28mm;
                height: auto;
            }
            .tens-annex__institution p { margin: 0 0 1mm; }
            .tens-annex__institution p:last-child { text-decoration: underline; }
            .tens-annex h1,
            .tens-annex h2 {
                margin: 0;
                color: #000;
                text-align: center;
                font-family: Arial, Helvetica, sans-serif;
                font-weight: 700;
            }
            .tens-annex h1 { font-size: 12pt; letter-spacing: 4pt; }
            .tens-annex h2 { margin-top: 2mm; font-size: 10pt; }
            .tens-annex__meta { margin: 7mm 0 5mm; }
            .tens-annex__meta p { margin: 0 0 1.5mm; }
            .tens-annex__intro { margin: 0 0 4mm; text-align: justify; }
            .tens-annex__functions { margin: 0 0 5mm; padding-left: 6mm; }
            .tens-annex__functions strong {
                display: block;
                margin: 0 0 2mm;
                text-align: center;
            }
            .tens-annex__functions p { margin: 0 0 1.5mm; }
            .tens-annex__detail { margin: 0 0 2mm; font-weight: 700; }
            .tens-annex table {
                width: 100%;
                table-layout: fixed;
                border-collapse: collapse;
                font-size: 7.4pt;
            }
            .tens-annex th,
            .tens-annex td {
                padding: 1.2mm 1mm;
                border: 1px solid #000;
                color: #000;
                background: #fff;
                text-align: center;
                vertical-align: middle;
                overflow-wrap: anywhere;
            }
            .tens-annex th { font-weight: 700; }
            .tens-annex th:nth-child(1), .tens-annex td:nth-child(1) { width: 25%; text-align: left; }
            .tens-annex th:nth-child(2), .tens-annex td:nth-child(2) { width: 7%; }
            .tens-annex th:nth-child(3), .tens-annex td:nth-child(3),
            .tens-annex th:nth-child(4), .tens-annex td:nth-child(4) { width: 10%; }
            .tens-annex th:nth-child(5), .tens-annex td:nth-child(5),
            .tens-annex th:nth-child(6), .tens-annex td:nth-child(6) { width: 12%; }
            .tens-annex th:nth-child(7), .tens-annex td:nth-child(7) { width: 24%; }
            .tens-annex__note { margin: 3mm 0 0; font-size: 8pt; }
            .tens-annex__footer-rule {
                position: fixed;
                right: 28mm;
                bottom: 13mm;
                left: 27mm;
                display: grid;
                grid-template-columns: 74% 26%;
                height: 1.2mm;
            }
            .tens-annex__footer-rule span:first-child { background: #006cb7; }
            .tens-annex__footer-rule span:last-child { background: #ef3340; }
            @media print {
                .report-print-page { max-width: none !important; padding: 0 !important; }
                .tens-annex { break-inside: avoid; page-break-inside: avoid; }
            }
        </style>
        <section class="tens-annex">
            <header class="tens-annex__institution">
                <img src="img/formato-anexo-tens-gobierno.jpeg" alt="Gobierno de Chile">
                <div>
                    <p>MINISTERIO DE SALUD SERVICIO DE SALUD</p>
                    <p>VALPARAÍSO – SAN ANTONIO</p>
                    <p>HOSPITAL CLAUDIO VICUÑA</p>
                    <p>SUBDIRECCION DE GESTION Y DESARROLLO DE LAS PERSONAS.</p>
                    <p>GESTION DE PERSONAS- AREA ASISTENCIA Y HORAS EXTRAS</p>
                </div>
            </header>
            <h1>MEMO - A N E X O&nbsp;&nbsp;&nbsp;1</h1>
            <h2>SOLICITUD Y AUTORIZACION DE TRABAJOS EXTRAORDINARIOS TENS IMAGENOLOGÍA</h2>
            <div class="tens-annex__meta">
                <p><strong>JEFE SOLICITANTE:</strong> DRA. BERNARDITA FAUNDEZ PUMARINO</p>
                <p><strong>UNIDAD:</strong> IMAGENOLOGÍA</p>
                <p><strong>MES:</strong> ${escapeHTML(monthName(monthDate))}</p>
            </div>
            <p class="tens-annex__intro">Solicito a Ud. autorización para realizar trabajos extraordinarios en horario diurno, nocturno y sábado, domingos y festivos, de acuerdo a necesidades del Servicio, para realizar las siguientes funciones:</p>
            <div class="tens-annex__functions">
                <strong>TENS CON ASIGNACION DE TURNO CUARTO TURNO, CUARTO TURNO SIN ASIGNACIÓN Y TENS DIURNOS</strong>
                <p>Cobertura de ausencias derivadas de feriados legales, administrativos y licencias médicas, conforme a las necesidades del servicio.</p>
                <p>Apoyo clínico durante la ejecución de exámenes de tomografía computada (TAC), en calidad de técnico extra, conforme a las necesidades operativas del Servicio de Imagenología.</p>
            </div>
            <p class="tens-annex__detail">DETALLE:</p>
            <table>
                <thead>
                    <tr>
                        <th>FUNCIONARIO</th>
                        <th>GRADO</th>
                        <th>HRS.<br>DIURNAS</th>
                        <th>HRS.<br>FESTIVAS</th>
                        <th>RETRIBUCION<br>DESCANSO<br>(marca X)</th>
                        <th>RETRIBUCION<br>PAGO<br>(marca X)</th>
                        <th>Tipo de turno</th>
                    </tr>
                </thead>
                <tbody>${body}</tbody>
            </table>
            <p class="tens-annex__note">El máximo de horas extraordinarias diurnas será de 40 Hrs. por funcionario al mes.</p>
            <div class="tens-annex__footer-rule"><span></span><span></span></div>
        </section>
    `;
}
