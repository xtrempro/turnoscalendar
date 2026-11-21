// Visor de la asignacion de tareas con el formato de la programacion publicada.
//
// El supervisor arma las tareas en un tablero de tarjetas, pero lo que la gente
// termina leyendo -y lo que ve el trabajador cuando se sube el Excel de la
// programacion- es una tabla de una fila por tarea y una columna por dia. Este
// modulo dibuja esa misma tabla con los datos del tablero, para poder revisar
// como va a quedar sin tener que exportar nada.
//
// Solo LEE. Se reusan las clases del visor de programacion publicada
// (.ws-table, .ws-role, .ws-cell) a proposito: el ensayo y el resultado final
// tienen que verse iguales, y asi hay una sola hoja de estilos que mantener.

import { escapeHTML } from "./htmlUtils.js";
import {
    getTaskScheduleWeek,
    getTaskScheduleWeekEvents,
    goToTaskScheduleToday,
    moveTaskScheduleWeek
} from "./taskAssignments.js";
import { weekHeading } from "./weeklySchedulePreview.js";
import { getJSON, setJSON } from "./persistence.js";

const PALETTE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8H16a5 5 0 0 0 5-5c0-3.9-4-6.7-9-6.7Z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7" r="1.2"/><circle cx="15" cy="8" r="1.2"/></svg>`;
const SHUFFLE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 4l3 3-3 3"/><path d="M17 14l3 3-3 3"/><path d="M4 7h4l8 10h4"/><path d="M4 17h4l2.5-3"/></svg>`;
const PRINT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"/><path d="M6 18H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2"/><rect x="6" y="14" width="12" height="7" rx="1"/></svg>`;
const TABLE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14.5h18M9 9v11M15 9v11"/></svg>`;

let backdrop = null;

// 0 = blanco y negro. Cualquier otro valor es la semilla de la tanda de colores
// actual: las filas derivan su tono de ella, asi que barajar es cambiarla.
//
// Se GUARDA, y ademas se sincroniza con el resto de la unidad (ver
// firebaseStateModules.js). La programacion se imprime y se comparte, asi que
// los colores son una decision de la unidad y no del navegador que la abrio:
// antes se perdian al recargar y cada supervisor veia la tabla de otro color.
const COLOR_SEED_KEY = "taskScheduleColorSeed";

function getColorSeed() {
    const stored = Number(getJSON(COLOR_SEED_KEY, 0));

    return Number.isFinite(stored) && stored > 0 ? stored : 0;
}

function saveColorSeed(seed) {
    setJSON(COLOR_SEED_KEY, Number(seed) || 0);
}

// Tono por fila a partir de la semilla. El angulo aureo reparte los tonos de
// modo que dos filas seguidas nunca caen en el mismo color, que es justo lo que
// arruinaria una tabla de veinte filas si los tonos salieran al azar puro.
function rowHue(index) {
    return Math.round((getColorSeed() + index * 137.508) % 360);
}

// Pastel claro para las celdas y un paso mas saturado para la columna del
// nombre, como en la programacion que arma el supervisor a mano.
function rowTint(index) {
    if (!getColorSeed()) return "";

    return `background: hsl(${rowHue(index)}, 72%, 89%); color: #111827;`;
}

function rowLabelTint(index) {
    if (!getColorSeed()) return "";

    return `background: hsl(${rowHue(index)}, 66%, 80%); color: #111827;`;
}

function shuffleColors() {
    // Se evita el 0, que significa blanco y negro.
    saveColorSeed(1 + Math.floor(Math.random() * 3599));
    render();
}

function clearColors() {
    saveColorSeed(0);
    render();
}

// Los nombres van pegados con guion, igual que en la programacion que publica
// el supervisor: "J.CORNEJO-B.ESCOBAR-A.SALGADO". El comentario de la celda,
// si lo hay, baja a su propia linea.
function cellHTML(cell) {
    const lines = [];

    // `lines` son renglones ya listos, uno por novedad. Los nombres de las
    // tareas siguen viajando en `workers` y se juntan con guiones en UN
    // renglon, que es como se leen en la programacion.
    if (cell.lines?.length) lines.push(...cell.lines);
    if (cell.workers?.length) lines.push(cell.workers.join("-"));
    if (cell.note) lines.push(cell.note);

    return lines.length
        ? lines.map(line => escapeHTML(line)).join("<br>")
        : "&nbsp;";
}

// Una casilla fusionada se emite UNA vez, en la fila de su tarea de arriba,
// con el rowspan de todo el grupo; las filas que quedan tapadas no vuelven a
// emitir esa columna o se correrian todas de lugar.
function rowCellsHTML(row, rowIndex = 0) {
    const tint = rowTint(rowIndex);

    return row.cells.map(cell => {
        if (cell.covered) return "";

        if (cell.rowSpan > 1) {
            return `<td class="ws-cell tsp-cell--merged" rowspan="${cell.rowSpan}" style="${tint}">${cellHTML(cell)}</td>`;
        }

        return `<td class="ws-cell" style="${tint}">${cellHTML(cell)}</td>`;
    }).join("");
}

function sectionHTML(section, days) {
    const rows = section.rows.map((row, rowIndex) => `
        <tr class="${getColorSeed() ? "tsp-row--tinted" : ""}">
            <th scope="row" class="ws-role" style="${rowLabelTint(rowIndex)}">
                <strong>${escapeHTML(row.title)}</strong>
                ${row.detail ? `<span>${escapeHTML(row.detail)}</span>` : ""}
            </th>
            ${rowCellsHTML(row, rowIndex)}
        </tr>`).join("");

    return `
        <section class="tsp-section">
            <h4 class="tsp-section-title">${escapeHTML(section.label)}</h4>
            <div class="ws-table-scroll" role="region" aria-label="${escapeHTML(section.label)}" tabindex="0">
                <table class="ws-table">
                    <thead>
                        <tr>
                            <th class="ws-role"></th>
                            ${days.map(day => `<th>${escapeHTML(day.weekday.toUpperCase())} ${escapeHTML(String(day.dayNumber))}</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </section>`;
}

function bodyHTML(week, events) {
    // Las novedades van DEBAJO de las tareas, y se muestran aunque la semana no
    // tenga nada repartido: quien abre la programacion de una semana vacia
    // igual necesita ver quien esta con permiso.
    const eventsHTML = events ? sectionHTML(events, week.days) : "";

    if (!week.sections.length) {
        return `<div class="ws-empty">Todavía no hay trabajadores asignados en esta semana.</div>${eventsHTML}`;
    }

    return week.sections
        .map(section => sectionHTML(section, week.days))
        .join("") + eventsHTML;
}

// ---------------------------------------------------------------------------
// Impresion en hoja carta.
//
// Se arma un documento aparte en vez de imprimir el modal: la tabla del visor
// vive dentro de un backdrop con scroll y sombras, y lo que se necesita en
// papel es otra cosa -tinta minima, letra chica, la hoja entera aprovechada-.
//
// `@page { margin: 0 }` quita el margen de pagina del navegador. El aire de
// 5 mm del body NO es un margen de adorno: casi ninguna impresora imprime al
// borde fisico, y sin ese colchon la primera y la ultima columna salen
// cortadas.
//
// Si la tabla no cabe, `thead { display: table-header-group }` hace que el
// navegador repita los titulos de las columnas en cada hoja.
// ---------------------------------------------------------------------------

const PRINT_STYLES = `
    @page { size: letter landscape; margin: 0; }

    * { box-sizing: border-box; }

    *,
    *::before,
    *::after {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    html, body { margin: 0; padding: 0; background: #fff; }

    /* Todo lo de abajo esta apretado a proposito: el objetivo es que la semana
       entera quepa en UNA hoja. Los valores salen de medir la programacion
       real -unas 20 tareas diurnas mas las de noche- y no de un gusto
       tipografico. Si se agrandan, vuelven las dos hojas. */
    body {
        padding: 4mm;
        color: #111827;
        font-family: "Plus Jakarta Sans", "Segoe UI", Arial, sans-serif;
        font-size: 7.5pt;
        line-height: 1.15;
    }

    h1 {
        margin: 0 0 1.5mm;
        font-size: 10pt;
        font-weight: 800;
        letter-spacing: -0.01em;
    }

    .tsp-print-section { margin-bottom: 2.5mm; }

    table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
    }

    /* Repite los titulos de las columnas en cada hoja. */
    thead { display: table-header-group; }

    tr {
        break-inside: avoid;
        page-break-inside: avoid;
    }

    th, td {
        border: 0.5pt solid #94a3b8;
        padding: 1.5pt 3pt;
        vertical-align: top;
        overflow-wrap: anywhere;
    }

    thead th {
        background: #0f172a;
        color: #fff;
        font-size: 6.5pt;
        font-weight: 800;
        letter-spacing: 0.03em;
        text-align: left;
        text-transform: uppercase;
    }

    /* Primera celda del encabezado: es el nombre del turno, no un rotulo de
       columna, asi que se le da algo mas de peso. */
    thead th.tsp-print-section-name {
        font-size: 7pt;
        letter-spacing: 0.05em;
    }

    tbody th {
        text-align: left;
        font-size: 7pt;
        font-weight: 800;
        background: #f1f5f9;
    }

    tbody th span {
        display: block;
        font-size: 5.5pt;
        font-weight: 600;
        line-height: 1.1;
        color: #475569;
    }

    col.tsp-print-col--task { width: 14%; }
    col.tsp-print-col--day { width: 12.28%; }

    .tsp-print-empty { color: #64748b; font-style: italic; }
`;

function printTableHTML(section, days) {
    const rows = section.rows.map((row, rowIndex) => `
        <tr>
            <th scope="row" style="${rowLabelTint(rowIndex)}">
                ${escapeHTML(row.title)}
                ${row.detail ? `<span>${escapeHTML(row.detail)}</span>` : ""}
            </th>
            ${rowCellsHTML(row, rowIndex)}
        </tr>`).join("");

    // El nombre del turno vive en la primera celda del encabezado en vez de en
    // un titulo aparte: ese titulo costaba dos renglones por seccion y decia lo
    // mismo que la columna que encabeza.
    return `
        <section class="tsp-print-section">
            <table>
                <colgroup>
                    <col class="tsp-print-col--task">
                    ${days.map(() => `<col class="tsp-print-col--day">`).join("")}
                </colgroup>
                <thead>
                    <tr>
                        <th class="tsp-print-section-name">${escapeHTML(section.label.toUpperCase())}</th>
                        ${days.map(day => `<th>${escapeHTML(day.weekday.toUpperCase())} ${escapeHTML(String(day.dayNumber))}</th>`).join("")}
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </section>`;
}

function printDocumentHTML(week, events) {
    const title = `Programación · ${weekHeading(week.weekStart)}`;
    const tables = week.sections.length
        ? week.sections
            .map(section => printTableHTML(section, week.days))
            .join("")
        : `<p class="tsp-print-empty">Todavía no hay trabajadores asignados en esta semana.</p>`;
    const body = tables + (events ? printTableHTML(events, week.days) : "");

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapeHTML(title)}</title>
<style>${PRINT_STYLES}</style>
</head>
<body>
<h1>${escapeHTML(title)}</h1>
${body}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Impresion diaria: UN dia en hoja carta vertical, tarea a la izquierda y
// quienes la cubren a la derecha.
//
// Sale de la MISMA semana que la impresion completa (getTaskScheduleWeek), asi
// que las casillas unidas, la fila de quien esta de turno sin tarea y las
// novedades son las mismas; solo cambia que se toma una columna.
//
// Con la hoja entera para un dia sobra espacio, y se usa en legibilidad: letra
// de 11 pt y cada nombre como una ficha propia en lugar de "A-B-C" pegados.
// ---------------------------------------------------------------------------

const DAY_PRINT_STYLES = `
    @page { size: letter portrait; margin: 0; }

    * { box-sizing: border-box; }

    *,
    *::before,
    *::after {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    html, body { margin: 0; padding: 0; background: #fff; }

    /* 10 mm de aire: casi ninguna impresora llega al borde fisico. */
    body {
        padding: 10mm 12mm;
        color: #111827;
        font-family: "Plus Jakarta Sans", "Segoe UI", Arial, sans-serif;
        font-size: 11pt;
        line-height: 1.3;
    }

    /* En pantalla (el iframe oculto) la pagina se mide al ancho de la hoja,
       para que el ajuste de abajo calcule el mismo alto que saldra impreso. */
    @media screen { html { width: 216mm; } }

    header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 6mm;
        margin-bottom: 5mm;
        padding-bottom: 3mm;
        border-bottom: 1.5pt solid #0f172a;
    }

    h1 {
        margin: 0;
        font-size: 18pt;
        font-weight: 800;
        letter-spacing: -0.01em;
    }

    header span {
        font-size: 10pt;
        font-weight: 700;
        color: #475569;
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }

    .tsp-day-section { margin-bottom: 5mm; }

    table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
    }

    thead { display: table-header-group; }

    tr {
        break-inside: avoid;
        page-break-inside: avoid;
    }

    th, td {
        border: 0.6pt solid #94a3b8;
        padding: 1.6mm 3mm;
        vertical-align: middle;
        overflow-wrap: anywhere;
    }

    thead th {
        background: #0f172a;
        color: #fff;
        font-size: 9pt;
        font-weight: 800;
        letter-spacing: 0.05em;
        text-align: left;
        text-transform: uppercase;
    }

    tbody th {
        text-align: left;
        font-size: 11pt;
        font-weight: 800;
        background: #f1f5f9;
    }

    tbody th span {
        display: block;
        margin-top: 0.5mm;
        font-size: 8.5pt;
        font-weight: 600;
        color: #475569;
    }

    col.tsp-day-col--task { width: 32%; }
    col.tsp-day-col--people { width: 68%; }

    .tsp-day-names {
        display: flex;
        flex-wrap: wrap;
        gap: 1.5mm 2mm;
    }

    .tsp-day-name {
        padding: 0.3mm 2mm;
        border: 0.6pt solid #cbd5e1;
        border-radius: 1.5mm;
        background: rgba(255, 255, 255, 0.75);
        font-weight: 700;
        white-space: nowrap;
    }

    .tsp-day-line { display: block; font-weight: 600; }
    .tsp-day-line + .tsp-day-line { margin-top: 1mm; }

    .tsp-day-note {
        display: block;
        margin-top: 1.2mm;
        font-size: 9.5pt;
        font-style: italic;
        color: #334155;
    }

    .tsp-day-merged { border-left: 2pt solid #0f172a; }

    .tsp-day-empty { color: #94a3b8; font-style: italic; }
`;

// Un dia normal cabe en una hoja; uno con muchas tareas se achica lo justo
// para caber, sin bajar de 70 % (mas chico ya no se lee: ahi mejor dos hojas).
// Corre DENTRO del documento impreso, asi que mide lo mismo que se imprime.
const FIT_ONE_PAGE_SCRIPT = `(function () {
    var page = 279.4 * 96 / 25.4 - 6;
    var height = document.documentElement.scrollHeight;
    if (height > page) document.body.style.zoom = String(Math.max(0.7, page / height));
})();`;

function dayDate(day) {
    const [year, month, date] = String(day.keyDay || "").split("-").map(Number);

    return new Date(year, month, date);
}

export function dayPrintTitle(day) {
    const text = dayDate(day).toLocaleDateString("es-CL", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    });

    return text.charAt(0).toUpperCase() + text.slice(1);
}

function dayCellHTML(cell) {
    const parts = [];

    if (cell.lines?.length) {
        parts.push(cell.lines
            .map(line => `<span class="tsp-day-line">${escapeHTML(line)}</span>`)
            .join(""));
    }
    if (cell.workers?.length) {
        parts.push(`<div class="tsp-day-names">${cell.workers
            .map(name => `<span class="tsp-day-name">${escapeHTML(name)}</span>`)
            .join("")}</div>`);
    }
    if (cell.note) {
        parts.push(`<span class="tsp-day-note">${escapeHTML(cell.note)}</span>`);
    }

    return parts.length
        ? parts.join("")
        : `<span class="tsp-day-empty">Sin asignar</span>`;
}

// Una seccion, solo con la columna del dia. Las casillas unidas conservan su
// rowspan: en el dia inhabil todas las tareas suelen ser UN puesto, y asi se
// ve como tal y no como la misma lista repetida en cada fila.
function dayTableHTML(section, dayIndex, { skipEmpty = false } = {}) {
    const rows = section.rows
        .map((row, rowIndex) => ({ row, rowIndex, cell: row.cells[dayIndex] || {} }))
        .filter(({ cell }) => !skipEmpty ||
            cell.lines?.length || cell.workers?.length || cell.note);

    if (!rows.length) return "";

    const body = rows.map(({ row, rowIndex, cell }) => {
        const tint = rowTint(rowIndex);
        const people = cell.covered
            ? ""
            : cell.rowSpan > 1
                ? `<td class="tsp-day-merged" rowspan="${cell.rowSpan}" style="${tint}">${dayCellHTML(cell)}</td>`
                : `<td style="${tint}">${dayCellHTML(cell)}</td>`;

        return `
        <tr>
            <th scope="row" style="${rowLabelTint(rowIndex)}">
                ${escapeHTML(row.title)}
                ${row.detail ? `<span>${escapeHTML(row.detail)}</span>` : ""}
            </th>
            ${people}
        </tr>`;
    }).join("");

    return `
        <section class="tsp-day-section">
            <table>
                <colgroup>
                    <col class="tsp-day-col--task">
                    <col class="tsp-day-col--people">
                </colgroup>
                <thead>
                    <tr>
                        <th>${escapeHTML(section.label.toUpperCase())}</th>
                        <th>Asignados</th>
                    </tr>
                </thead>
                <tbody>${body}</tbody>
            </table>
        </section>`;
}

export function dayPrintDocumentHTML(week, events, dayIndex) {
    const day = week.days[dayIndex];
    const title = dayPrintTitle(day);
    const tables = week.sections.length
        ? week.sections.map(section => dayTableHTML(section, dayIndex)).join("")
        : `<p class="tsp-day-empty">Todavía no hay trabajadores asignados en esta semana.</p>`;
    // De las novedades solo van las que tienen algo ESE dia.
    const eventsHTML = events
        ? dayTableHTML({ ...events, label: "Novedades del día" }, dayIndex, { skipEmpty: true })
        : "";

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapeHTML(`Programación · ${title}`)}</title>
<style>${DAY_PRINT_STYLES}</style>
</head>
<body>
<header><h1>${escapeHTML(title)}</h1><span>Programación diaria</span></header>
${tables}${eventsHTML}
<script>${FIT_ONE_PAGE_SCRIPT}</script>
</body>
</html>`;
}

// Se imprime desde un iframe oculto y no desde `window.open`: una ventana
// emergente la bloquea el navegador por defecto y obligaria a explicarle al
// supervisor como habilitarla.
function printSchedule() {
    printHTML(printDocumentHTML(getTaskScheduleWeek(), getTaskScheduleWeekEvents()));
}

function printDay(dayIndex) {
    const week = getTaskScheduleWeek();

    if (!week.days[dayIndex]) return;
    printHTML(dayPrintDocumentHTML(week, getTaskScheduleWeekEvents(), dayIndex));
}

function printHTML(html) {
    const frame = document.createElement("iframe");

    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("title", "Programación para imprimir");
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
        return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    // Se retira despues de imprimir, no de inmediato: quitar el iframe
    // mientras el dialogo sigue abierto cancela la impresion. El plazo largo
    // es la red de seguridad para cuando el navegador no dispara afterprint.
    view.onafterprint = remove;

    // NO se usa `frame.onload`: al insertar el iframe el navegador dispara un
    // `load` por el about:blank inicial, y ahi todavia no hay nada escrito, asi
    // que se imprimiria una hoja en blanco. El documento se escribe entero de
    // una vez y no carga nada externo, de modo que basta con ceder un turno del
    // event loop tras `close()`.
    setTimeout(() => {
        view.focus();
        view.print();
        setTimeout(remove, 60000);
    }, 0);
}

// En blanco y negro basta un boton. Con color ya puestos, aparecen los dos que
// de verdad hacen falta: barajar otra vez y volver atras. Asi la cabecera no
// carga un boton "B/N" que no hace nada cuando ya se esta en blanco y negro.
function colorControlsHTML() {
    if (!getColorSeed()) {
        return `<button class="hm-btn-secondary tsp-color" type="button" data-preview-color title="Pintar cada tarea de un color">${PALETTE_ICON}Color</button>`;
    }

    return `
        <button class="hm-btn-secondary tsp-color" type="button" data-preview-color title="Cambiar la tanda de colores">${SHUFFLE_ICON}Otros colores</button>
        <button class="hm-btn-secondary tsp-color" type="button" data-preview-mono title="Volver a blanco y negro">B/N</button>`;
}

function render() {
    if (!backdrop) return;

    const week = getTaskScheduleWeek();

    backdrop.querySelector("[data-preview-heading]").textContent =
        weekHeading(week.weekStart);
    backdrop.querySelector("[data-preview-body]").innerHTML =
        bodyHTML(week, getTaskScheduleWeekEvents());

    const controls = backdrop.querySelector("[data-color-controls]");

    controls.innerHTML = colorControlsHTML();
    controls
        .querySelector("[data-preview-color]")
        ?.addEventListener("click", shuffleColors);
    controls
        .querySelector("[data-preview-mono]")
        ?.addEventListener("click", clearColors);
}

// Selector del dia para la impresion diaria: un menu bajo el boton con los
// siete dias de la semana que se esta mirando.
function dayMenu() {
    return backdrop?.querySelector("[data-day-print-menu]") || null;
}

function dayMenuOpen() {
    const menu = dayMenu();

    return Boolean(menu && !menu.hidden);
}

function closeDayMenu() {
    const menu = dayMenu();

    if (!menu) return;
    menu.hidden = true;
    backdrop
        .querySelector("[data-day-print-toggle]")
        ?.setAttribute("aria-expanded", "false");
}

function openDayMenu() {
    const menu = dayMenu();

    if (!menu) return;

    const week = getTaskScheduleWeek();

    menu.innerHTML = `
        <p class="tsp-day-menu-title">¿Qué día imprimir?</p>
        ${week.days.map((day, index) => `
            <button type="button" role="menuitem" data-day-print="${index}">
                <strong>${escapeHTML(day.weekday.charAt(0).toUpperCase() + day.weekday.slice(1))}</strong>
                <span>${escapeHTML(day.shortDate || String(day.dayNumber))}</span>
            </button>`).join("")}`;
    menu.hidden = false;
    backdrop
        .querySelector("[data-day-print-toggle]")
        ?.setAttribute("aria-expanded", "true");
    menu.querySelector("[data-day-print]")?.focus();
}

function onDocumentClick(event) {
    if (!dayMenuOpen()) return;
    if (event.target.closest?.("[data-day-print-wrap]")) return;
    closeDayMenu();
}

function close() {
    if (!backdrop) return;

    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("click", onDocumentClick, true);
    backdrop.remove();
    backdrop = null;
}

function onKeyDown(event) {
    if (event.key !== "Escape") return;

    // Escape cierra primero el menu de dias, y recien despues el visor.
    if (dayMenuOpen()) {
        closeDayMenu();
        return;
    }
    close();
}

// La semana se mueve en el tablero, no solo en el visor: asi lo que se esta
// mirando aca y lo que queda abierto detras son siempre la misma semana.
function navigate(action) {
    if (action === "today") {
        goToTaskScheduleToday();
    } else {
        moveTaskScheduleWeek(action === "prev" ? -7 : 7);
    }

    render();
}

export function openTaskSchedulePreview() {
    close();

    backdrop = document.createElement("div");
    backdrop.className = "hm-modal-backdrop tsp-backdrop";
    backdrop.innerHTML = `
        <div class="hm-modal hm-modal--weekly" role="dialog" aria-modal="true" aria-label="Programación de tareas">
            <div class="hm-modal-head">
                <span class="hm-modal-ico">${TABLE_ICON}</span>
                <h3>Programación · <span data-preview-heading></span></h3>
                <div class="hm-bday-nav">
                    <button type="button" data-preview-nav="prev" aria-label="Semana anterior">&#8249;</button>
                    <button type="button" data-preview-nav="next" aria-label="Semana siguiente">&#8250;</button>
                </div>
                <button class="hm-btn-secondary hm-ws-today" type="button" data-preview-nav="today">Hoy</button>
                <span class="tsp-color-controls" data-color-controls></span>
                <button class="hm-btn-secondary tsp-print" type="button" data-preview-print>${PRINT_ICON}Imprimir</button>
                <span class="tsp-day-print" data-day-print-wrap>
                    <button class="hm-btn-secondary tsp-print" type="button" data-day-print-toggle aria-haspopup="true" aria-expanded="false">${PRINT_ICON}Impresión diaria</button>
                    <div class="tsp-day-menu" data-day-print-menu role="menu" aria-label="Día a imprimir" hidden></div>
                </span>
                <button class="hm-modal-close" type="button" data-preview-close aria-label="Cerrar">&times;</button>
            </div>
            <div class="hm-modal-body" data-preview-body></div>
        </div>`;

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) close();
    });
    backdrop
        .querySelector("[data-preview-close]")
        .addEventListener("click", close);
    backdrop
        .querySelector("[data-preview-print]")
        .addEventListener("click", printSchedule);
    backdrop
        .querySelector("[data-day-print-toggle]")
        .addEventListener("click", () => {
            if (dayMenuOpen()) closeDayMenu();
            else openDayMenu();
        });
    backdrop
        .querySelector("[data-day-print-menu]")
        .addEventListener("click", event => {
            const option = event.target.closest("[data-day-print]");

            if (!option) return;
            closeDayMenu();
            printDay(Number(option.dataset.dayPrint));
        });
    backdrop
        .querySelectorAll("[data-preview-nav]")
        .forEach(button => {
            button.addEventListener("click", () => {
                closeDayMenu();
                navigate(button.dataset.previewNav);
            });
        });

    document.body.appendChild(backdrop);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onDocumentClick, true);
    render();
}
