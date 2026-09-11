// Impresiones del menu Equipos Medicos: el historial de fallas que se le
// entrega al tecnico cuando llega, la hoja de vida del equipo y el informe
// mensual de la unidad. Se imprime desde un iframe oculto, igual que la
// programacion semanal: una ventana emergente la bloquea el navegador.

import { escapeHTML } from "./htmlUtils.js";
import {
    CRITICALITY_LABELS,
    EQUIPMENT_STATUS,
    FAILURE_STATUS,
    MAINTENANCE_TYPE_LABELS,
    MONTHS_SHORT,
    SEVERITY_LABELS,
    daysUntil,
    formatDate,
    formatDuration,
    formatPercent,
    isOpenFailure,
    maintenanceState,
    plural
} from "./medicalEquipmentInsights.js";

export const SEVERITY_TONES = { low: "muted", medium: "notice", high: "warn", critical: "danger" };

const LIFE_EVENT_LABELS = {
    failure: "Falla",
    maintenance: "Mantención",
    document: "Documento",
    milestone: "Estado y contrato"
};

const PRINT_STYLES = `
@import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Sora:wght@600;700&display=swap");
@page { size: A4; margin: 14mm 12mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Plus Jakarta Sans", "Segoe UI", Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #112038; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.doc-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; padding-bottom: 8px; border-bottom: 2px solid #10498b; margin-bottom: 12px; }
.brand { font-family: Sora, "Plus Jakarta Sans", sans-serif; font-weight: 700; color: #10498b; font-size: 12pt; }
.brand span { color: #0f766e; }
.doc-meta { color: #66748b; font-size: 8.5pt; text-align: right; }
.kicker { color: #0f766e; font-size: 8pt; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
h1 { font-family: Sora, "Plus Jakarta Sans", sans-serif; font-size: 18pt; margin: 2px 0 4px; letter-spacing: -.01em; }
h2 { font-family: Sora, "Plus Jakarta Sans", sans-serif; font-size: 12.5pt; margin: 16px 0 8px; break-after: avoid; }
h3 { font-size: 11.5pt; margin: 0; }
.facts { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid #d5dce8; border-radius: 8px; overflow: hidden; margin: 10px 0; }
.facts div { padding: 6px 9px; border-right: 1px solid #d5dce8; border-bottom: 1px solid #d5dce8; }
.facts dt { font-size: 7.5pt; color: #66748b; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
.facts dd { margin: 0; font-weight: 700; }
.summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 8px 0 4px; }
.summary div { border: 1px solid #d5dce8; border-radius: 8px; padding: 6px 9px; }
.summary b { display: block; font-family: Sora, "Plus Jakarta Sans", sans-serif; font-size: 13pt; }
.summary span { font-size: 8pt; color: #30425c; font-weight: 700; }
.failure { border: 1px solid #d5dce8; border-radius: 10px; padding: 10px 12px; margin: 0 0 10px; }
.failure__head { break-inside: avoid; }
.failure__top { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
.tags { white-space: nowrap; }
.tag { display: inline-block; border: 1px solid currentColor; border-radius: 999px; padding: 0 7px; font-size: 8pt; font-weight: 800; margin-left: 4px; }
.tag.danger { color: #b91c1c; } .tag.warn { color: #9a4a0b; } .tag.ok { color: #15803d; } .tag.muted { color: #66748b; } .tag.notice { color: #0369a1; }
.by { color: #66748b; font-size: 8.5pt; font-weight: 600; margin-top: 2px; }
.detail { margin: 6px 0 0; }
.note, .repair { margin: 6px 0 0; padding: 6px 9px; border-radius: 6px; background: #f3f6fb; font-size: 9pt; }
.note b, .repair b { color: #10498b; }
.photos { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 8px; }
.photos figure { margin: 0; break-inside: avoid; border: 1px solid #d5dce8; border-radius: 8px; overflow: hidden; }
.photos img { display: block; width: 100%; max-height: 85mm; object-fit: contain; background: #f6f8fd; }
.photos figcaption { font-size: 7.5pt; color: #66748b; padding: 3px 6px; }
.noimg { padding: 14px 10px; font-size: 8.5pt; color: #66748b; }
.files { margin: 6px 0 0; font-size: 8.5pt; color: #30425c; }
table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 4px; }
th { text-align: left; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .05em; color: #66748b; border-bottom: 1.5px solid #10498b; padding: 5px 6px; }
td { border-bottom: 1px solid #e2e7f0; padding: 5px 6px; vertical-align: top; }
tr { break-inside: avoid; }
td .muted { color: #66748b; font-size: 8.5pt; }
.empty { color: #66748b; font-style: italic; }
.sign { margin-top: 34px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; break-inside: avoid; }
.sign div { border-top: 1px solid #112038; padding-top: 4px; font-size: 8.5pt; color: #30425c; text-align: center; }
.doc-foot { margin-top: 14px; padding-top: 6px; border-top: 1px solid #d5dce8; color: #66748b; font-size: 8pt; }
`;

function esc(value) {
    return escapeHTML(value);
}

export function isPrintableImage(attachment) {
    const type = String(attachment?.type || "").toLowerCase();
    const name = String(attachment?.name || "").toLowerCase();

    // HEIC (fotos de iPhone) no se dibuja en Chrome ni en Edge.
    if (/heic|heif/.test(type) || /\.(heic|heif)$/.test(name)) return false;

    return type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/.test(name);
}

function shell({ title, kicker, heading, unitName, printedBy, printedAt, body }) {
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>${PRINT_STYLES}</style>
</head>
<body>
<header class="doc-head">
<div class="brand">Turno<span>Plus</span> · Equipos Médicos</div>
<div class="doc-meta">${esc(unitName || "")}<br>Impreso el ${esc(printedAt)}${printedBy ? ` por ${esc(printedBy)}` : ""}</div>
</header>
${kicker ? `<div class="kicker">${esc(kicker)}</div>` : ""}
<h1>${esc(heading)}</h1>
${body}
<footer class="doc-foot">Documento generado desde TurnoPlus${unitName ? ` · ${esc(unitName)}` : ""} · ${esc(printedAt)}</footer>
</body>
</html>`;
}

function equipmentKicker(equipment) {
    return [equipment.equipmentType, CRITICALITY_LABELS[equipment.criticality]]
        .filter(Boolean)
        .join(" · ") || "Equipo médico";
}

function equipmentFacts(snapshot) {
    const { equipment, contract } = snapshot;
    const contact = contract?.contacts?.[0];
    const facts = [
        ["Marca y modelo", [equipment.brand, equipment.model].filter(Boolean).join(" ") || "—"],
        ["Código inventario", equipment.code || "—"],
        ["N° de serie", equipment.serialNumber || "—"],
        ["Ubicación", equipment.location || "—"],
        ["Estado", EQUIPMENT_STATUS[equipment.status]?.label || "—"],
        ["Instalación", formatDate(equipment.installedAt)],
        [
            "Servicio técnico",
            contract
                ? `${contract.provider || "Sin proveedor"}${contract.tenderId ? ` · ${contract.tenderId}` : ""}`
                : "Sin contrato"
        ],
        ["Vigencia del contrato", contract?.endDate ? `Hasta ${formatDate(contract.endDate)}` : "—"],
        [
            "Contacto del proveedor",
            contact ? [contact.name, contact.phone, contact.email].filter(Boolean).join(" · ") : "—"
        ]
    ];

    return `<dl class="facts">${facts.map(([label, value]) =>
        `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`
    ).join("")}</dl>`;
}

function failureBlock(failure, imageUrls, now) {
    const status = FAILURE_STATUS[failure.status];
    const images = failure.attachments.filter(isPrintableImage);
    const others = failure.attachments.filter(file => !isPrintableImage(file));
    const repair = failure.maintenance;
    const ongoing = repair && maintenanceState(repair, now) === "ongoing";
    let repairLine = "";

    if (repair) {
        repairLine = `<p class="repair"><b>${ongoing ? "En reparación" : "Reparación"}:</b> ` +
            `${esc(MAINTENANCE_TYPE_LABELS[repair.type])} del ${formatDate(repair.date)}` +
            `${repair.provider ? ` · ${esc(repair.provider)}` : ""}` +
            `${repair.technician ? ` · ${esc(repair.technician)}` : ""}` +
            `${repair.summary ? ` — ${esc(repair.summary)}` : ""}` +
            `${!ongoing && failure.repairHours !== null ? ` · ${formatDuration(failure.repairHours)} hasta volver a operar` : ""}</p>`;
    } else if (failure.status === "resolved" && failure.resolvedAt) {
        repairLine = `<p class="repair"><b>Resuelta</b> el ${formatDate(failure.resolvedAt)} sin intervención técnica registrada.</p>`;
    }

    return `<article class="failure">
<div class="failure__head">
<div class="failure__top">
<h3>${esc(failure.title)}</h3>
<div class="tags"><span class="tag ${SEVERITY_TONES[failure.severity]}">Gravedad ${esc(SEVERITY_LABELS[failure.severity].toLowerCase())}</span><span class="tag ${status.tone}">${esc(status.label)}</span></div>
</div>
<div class="by">${formatDate(failure.date)}${failure.time ? ` ${esc(failure.time)}` : ""} · informada por ${esc(failure.reportedByName)} ${failure.channel === "PWA" ? "desde la app de trabajadores" : "por supervisión"}${failure.outOfService ? " · el equipo quedó fuera de servicio" : ""}</div>
${failure.detail ? `<p class="detail">${esc(failure.detail)}</p>` : ""}
${failure.note ? `<p class="note"><b>Nota de supervisión:</b> ${esc(failure.note)}</p>` : ""}
${repairLine}
</div>
${images.length ? `<div class="photos">${images.map(file => {
        const url = imageUrls.get(file.id);
        return `<figure>${url
            ? `<img src="${esc(url)}" alt="${esc(file.name)}">`
            : `<div class="noimg">No se pudo obtener esta imagen. Ábrela desde TurnoPlus.</div>`}<figcaption>${esc(file.name)}</figcaption></figure>`;
    }).join("")}</div>` : ""}
${others.length ? `<p class="files">Otros adjuntos (se abren desde TurnoPlus): ${others.map(file => esc(file.name)).join(" · ")}</p>` : ""}
</article>`;
}

export function failureHistoryPrintHTML({ snapshot, unitName, printedBy, printedAt, now, imageUrls = new Map() }) {
    const { equipment, failures, metrics } = snapshot;
    const open = failures.filter(isOpenFailure).length;
    const summary = `<div class="summary">
<div><b>${failures.length}</b><span>Fallas registradas</span></div>
<div><b>${open}</b><span>Abiertas hoy</span></div>
<div><b>${metrics.failures12}</b><span>En los últimos 12 meses</span></div>
<div><b>${metrics.mttr !== null ? formatDuration(metrics.mttr) : "—"}</b><span>Tiempo medio de reparación</span></div>
</div>`;
    const recurrent = metrics.recurrent.length
        ? `<p class="note"><b>Fallas que se repiten:</b> ${metrics.recurrent.map(group =>
            `«${esc(group.title)}» ${group.count} veces (${group.dates.map(formatDate).join(", ")})`
        ).join(" · ")}</p>`
        : "";
    const list = failures.length
        ? failures.map(failure => failureBlock(failure, imageUrls, now)).join("")
        : `<p class="empty">Este equipo no tiene fallas registradas.</p>`;

    return shell({
        title: `Historial de fallas · ${equipment.name}`,
        kicker: `Historial de fallas · ${equipmentKicker(equipment)}`,
        heading: equipment.name,
        unitName,
        printedBy,
        printedAt,
        body: `${equipmentFacts(snapshot)}${summary}${recurrent}
<h2>Registro de fallas (${failures.length})</h2>
${list}
<div class="sign"><div>Supervisión</div><div>Recibido por (servicio técnico)</div></div>`
    });
}

export function lifeSheetPrintHTML({ snapshot, events, unitName, printedBy, printedAt }) {
    const years = [...new Set(events.map(event => event.date.slice(0, 4)))];
    const body = years.length
        ? years.map(year => `<h2>${year}</h2>
<table>
<thead><tr><th style="width:21mm">Fecha</th><th style="width:30mm">Tipo</th><th>Registro</th></tr></thead>
<tbody>${events.filter(event => event.date.startsWith(year)).map(event => `<tr>
<td>${formatDate(event.date)}</td>
<td>${esc(LIFE_EVENT_LABELS[event.type] || "")}</td>
<td><b>${esc(event.title)}</b>${event.detail ? `<br><span class="muted">${esc(event.detail)}</span>` : ""}</td>
</tr>`).join("")}</tbody>
</table>`).join("")
        : `<p class="empty">Todavía no hay registros para este equipo.</p>`;

    return shell({
        title: `Hoja de vida · ${snapshot.equipment.name}`,
        kicker: `Hoja de vida · ${equipmentKicker(snapshot.equipment)}`,
        heading: snapshot.equipment.name,
        unitName,
        printedBy,
        printedAt,
        body: `${equipmentFacts(snapshot)}${body}`
    });
}

export function unitReportPrintHTML({ snapshots, kpis, queue, monthly, unitName, printedBy, printedAt, today }) {
    const active = snapshots.filter(item => item.equipment.status !== "inactive");
    const byName = new Map(snapshots.map(item => [item.equipment.id, item.equipment.name]));
    const upcoming = active
        .filter(item => item.equipment.nextMaintenanceAt && daysUntil(item.equipment.nextMaintenanceAt, today) <= 60)
        .sort((a, b) => a.equipment.nextMaintenanceAt.localeCompare(b.equipment.nextMaintenanceAt));
    const contracts = [...new Map(
        active.filter(item => item.contract).map(item => [item.contract.id, item])
    ).values()];
    const table = (head, rows, empty) => rows.length
        ? `<table><thead><tr>${head.map(cell => `<th>${esc(cell)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`
        : `<p class="empty">${esc(empty)}</p>`;

    const body = `
<div class="summary">${kpis.map(kpi => `<div><b>${kpi.value}${kpi.of ? `/${kpi.of}` : ""}</b><span>${esc(kpi.label)}</span></div>`).join("")}</div>
<h2>Qué hay que resolver (${queue.length})</h2>
${table(["Equipo", "Aviso", "Detalle"], queue.map(alert => `<tr><td>${esc(byName.get(alert.equipmentId) || "")}</td><td><b>${esc(alert.title)}</b></td><td>${esc(alert.text)}</td></tr>`), "Sin pendientes.")}
<h2>Fallas informadas por mes</h2>
${table(["Mes", "Fallas", "Abiertas", "Equipos"], monthly.map(item => {
        const [year, month] = item.month.split("-");
        return `<tr><td>${MONTHS_SHORT[Number(month) - 1]} ${year}</td><td>${item.count}</td><td>${item.open}</td><td>${esc(item.equipmentNames.join(", "))}</td></tr>`;
    }), "Sin fallas.")}
<h2>Horas fuera de servicio · últimos 12 meses</h2>
${table(["Equipo", "Horas", "Disponibilidad"], [...active].sort((a, b) => b.metrics.downtime - a.metrics.downtime).map(item =>
        `<tr><td>${esc(item.equipment.name)}</td><td>${item.metrics.downtime} h</td><td>${formatPercent(item.metrics.availability)}</td></tr>`
    ), "Sin equipos.")}
<h2>Próximas preventivas</h2>
${table(["Fecha", "Equipo", "Proveedor", "Estado"], upcoming.map(item => {
        const days = daysUntil(item.equipment.nextMaintenanceAt, today);
        return `<tr><td>${formatDate(item.equipment.nextMaintenanceAt)}</td><td>${esc(item.equipment.name)}</td><td>${esc(item.contract?.provider || "Sin proveedor")}</td><td>${days < 0 ? `Vencida hace ${plural(-days, "día", "días")}` : item.equipment.nextMaintenanceConfirmed ? "Confirmada" : "Por confirmar"}</td></tr>`;
    }), "Sin preventivas en los próximos 60 días.")}
<h2>Contratos de mantención</h2>
${table(["Proveedor", "ID Mercado Público", "Equipos", "Término"], contracts.map(item => {
        const contract = item.contract;
        return `<tr><td>${esc(contract.provider || "—")}</td><td>${esc(contract.tenderId || "—")}</td><td>${esc(item.contractEquipment.map(equipment => equipment.name).join(", "))}</td><td>${contract.endDate ? `${formatDate(contract.endDate)} (${plural(daysUntil(contract.endDate, today), "día", "días")})` : "Sin fecha"}</td></tr>`;
    }), "Sin contratos registrados.")}`;

    return shell({
        title: `Informe de equipos médicos · ${unitName || ""}`,
        kicker: "Informe de la unidad",
        heading: "Equipos Médicos",
        unitName,
        printedBy,
        printedAt,
        body
    });
}

// Imprime un documento completo. Espera las fotos (y las fuentes) antes de
// abrir el dialogo: si no, el tecnico recibe el historial con los recuadros
// vacios. Una foto que no carga se reemplaza por un aviso, no por un hueco.
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

        const waitImage = img => new Promise(done => {
            const fail = () => {
                const note = doc.createElement("div");
                note.className = "noimg";
                note.textContent = "No se pudo cargar esta imagen al imprimir. Ábrela desde TurnoPlus.";
                img.replaceWith(note);
                done();
            };

            if (img.complete) {
                if (img.naturalWidth) done();
                else fail();
                return;
            }

            img.addEventListener("load", () => done(), { once: true });
            img.addEventListener("error", fail, { once: true });
        });
        const ready = Promise.all([
            ...[...doc.images].map(waitImage),
            doc.fonts?.ready || Promise.resolve()
        ]);
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
