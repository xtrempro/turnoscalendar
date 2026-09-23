import { escapeHTML } from "./htmlUtils.js";

const number = value => Math.max(0, Number(value) || 0);

function formatHours(value) {
    const hours = number(value);
    return hours ? new Intl.NumberFormat("es-CL", {
        maximumFractionDigits: 2
    }).format(hours) : "";
}

function monthName(date) {
    return new Intl.DateTimeFormat("es-CL", {
        month: "long",
        year: "numeric"
    }).format(date).toLocaleUpperCase("es-CL");
}

function shiftSchedule(label) {
    const value = String(label || "").toLowerCase();
    if (value.includes("24")) return "08 A 08";
    if (value.includes("larga")) return "08 A 20";
    if (value.includes("noche")) return "20 A 08";
    if (value.includes("diurno")) return "08 A 17";
    return "";
}

export function hasCoverageAuthorizationOvertime(row) {
    return (row?.days || []).some(day => number(day.dayHours) + number(day.festiveHours) > 0);
}

function rotationChecks(rotationType, shiftAssigned) {
    const type = String(rotationType || "").toLowerCase();
    return {
        assigned: shiftAssigned ? "X" : "",
        unassigned: shiftAssigned ? "" : "X",
        third: type === "3turno" ? "X" : "",
        fourth: type === "4turno" ? "X" : "",
        daytime: type === "diurno" ? "X" : ""
    };
}

function pageHTML(row, monthDate) {
    const daysInMonth = new Date(
        monthDate.getFullYear(),
        monthDate.getMonth() + 1,
        0
    ).getDate();
    const byIso = new Map((row.days || []).map(day => [day.iso, day]));
    const checks = rotationChecks(row.rotationType, row.shiftAssigned);
    const body = [];
    let totalDay = 0;
    let totalFestive = 0;

    for (let day = 1; day <= 31; day += 1) {
        const iso = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const detail = day <= daysInMonth ? byIso.get(iso) || {} : {};
        const dayHours = number(detail.dayHours);
        const festiveHours = number(detail.festiveHours);
        totalDay += dayHours;
        totalFestive += festiveHours;
        body.push(`<tr>
            <td>${day}</td>
            <td>${escapeHTML(detail.baseShift || "")}</td>
            <td>${escapeHTML(detail.schedule || shiftSchedule(detail.programmedShift || detail.workedShift))}</td>
            <td>${formatHours(dayHours)}</td>
            <td>${formatHours(festiveHours)}</td>
            <td>${escapeHTML(detail.replacedName || detail.reason || "")}</td>
            <td>${escapeHTML(detail.replacedRut || "")}</td>
            <td>${escapeHTML(detail.motive || "")}</td>
        </tr>`);
    }

    return `<section class="coverage-annex">
        <header class="coverage-annex__institution">
            <img src="img/formato-anexo-tens-gobierno.jpeg" alt="Gobierno de Chile">
            <div>
                <p>MINISTERIO DE SALUD SERVICIO DE SALUD</p>
                <p>VALPARAISO - SAN ANTONIO</p>
                <p>HOSPITAL CLAUDIO VICUNA</p>
                <p>SUBDIRECCION DE GESTION Y DESARROLLO DE LAS PERSONAS.</p>
            </div>
        </header>
        <h1>MEMO - A N E X O&nbsp;&nbsp;&nbsp;2</h1>
        <h2>AUTORIZACION PARA CUBRIR TURNOS</h2>
        <p class="coverage-annex__date"><strong>FECHA:</strong> ${escapeHTML(monthName(monthDate))}</p>
        <div class="coverage-annex__meta">
            <span><strong>NOMBRE</strong> ${escapeHTML(row.name)}</span>
            <span><strong>RUT</strong> ${escapeHTML(row.rut || "")}</span>
            <span><strong>PLANTA</strong> ${escapeHTML(row.contractType || "")}</span>
            <span><strong>SERVICIO</strong> ${escapeHTML(row.unit || "")}</span>
            <span><strong>ESTAMENTO</strong> ${escapeHTML(row.estamento || "")}</span>
        </div>
        <table class="coverage-annex__checks"><tbody>
            <tr><th rowspan="2">Marca con una (X)</th><td>Sistema Turno c/asig.</td><td>${checks.assigned}</td><td>Tercer Turno</td><td>${checks.third}</td><td>Cuarto Turno</td><td>${checks.fourth}</td></tr>
            <tr><td>Sistema Turno s/asig.</td><td>${checks.unassigned}</td><td>Diurno</td><td>${checks.daytime}</td><td colspan="2"></td></tr>
        </tbody></table>
        <table class="coverage-annex__days">
            <colgroup>
                <col style="width:3%"><col style="width:8%"><col style="width:9%">
                <col style="width:5%"><col style="width:5%"><col style="width:23%">
                <col style="width:12%"><col style="width:35%">
            </colgroup>
            <thead><tr><th rowspan="2">DIA</th><th rowspan="2">ROTATIVA</th><th rowspan="2">HORARIO</th><th colspan="2">HORAS</th><th colspan="3">DATOS DEL FUNCIONARIO REEMPLAZO</th></tr>
            <tr><th>DIUR.</th><th>FEST.</th><th>NOMBRE</th><th>RUT</th><th>MOTIVO DEL REEMPLAZO</th></tr></thead>
            <tbody>${body.join("")}<tr class="coverage-annex__total"><td></td><td>TOTAL</td><td></td><td>${formatHours(totalDay)}</td><td>${formatHours(totalFestive)}</td><td colspan="3"></td></tr></tbody>
        </table>
        <footer><span>FIRMA FUNCIONARIO</span><span>FIRMA JEFE DE SERVICIO</span><span>FIRMA SUBDIRECCION</span></footer>
    </section>`;
}

export function buildCoverageAuthorizationReportHTML(rows, monthDate) {
    const pages = (Array.isArray(rows) ? rows : [])
        .filter(hasCoverageAuthorizationOvertime)
        .map(row => pageHTML(row, monthDate))
        .join("");

    return `<style>
        @page { size: legal portrait; margin: 12mm 14mm 14mm; }
        .coverage-annex { box-sizing:border-box; min-height:325mm; color:#000; background:#fff; font:7.5pt Arial,sans-serif; page-break-after:always; }
        .coverage-annex:last-child { page-break-after:auto; }
        .coverage-annex__institution { display:grid; grid-template-columns:27mm 1fr; gap:4mm; align-items:start; margin-bottom:3mm; font-size:7pt; }
        .coverage-annex__institution img { width:25mm; height:auto; }
        .coverage-annex__institution p { margin:0 0 .6mm; }
        .coverage-annex h1,.coverage-annex h2 { margin:0; text-align:center; font-weight:700; }
        .coverage-annex h1 { font-size:11pt; letter-spacing:0; }
        .coverage-annex h2 { margin-top:1mm; font-size:10pt; }
        .coverage-annex__date { margin:3mm 0 2mm; text-align:right; }
        .coverage-annex__meta { display:flex; flex-wrap:wrap; gap:1.5mm 5mm; margin-bottom:2mm; border-bottom:1px solid #000; padding-bottom:1mm; }
        .coverage-annex table { width:100%; border-collapse:collapse; table-layout:fixed; }
        .coverage-annex th,.coverage-annex td { border:1px solid #000; padding:.45mm .6mm; text-align:center; vertical-align:middle; overflow-wrap:anywhere; }
        .coverage-annex__checks { margin-bottom:1.5mm; }
        .coverage-annex__days thead tr:first-child th:nth-child(-n+3),
        .coverage-annex__days thead tr:nth-child(2) th:not(:last-child) { white-space:nowrap; overflow-wrap:normal; }
        .coverage-annex__days tbody tr { height:5.6mm; }.coverage-annex__total { font-weight:700; }
        .coverage-annex footer { display:grid; grid-template-columns:repeat(3,1fr); gap:8mm; margin-top:12mm; text-align:center; }
        .coverage-annex footer span { border-top:1px solid #000; padding-top:1.5mm; }
        @media print { .report-print-page { max-width:none!important; padding:0!important; } }
    </style>${pages}`;
}
