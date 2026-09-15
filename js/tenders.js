import { escapeHTML } from "./htmlUtils.js";
import { getJSON, setJSON } from "./persistence.js";
import {
    ATTACHMENT_ACCEPT,
    attachmentStorageErrorMessage,
    deleteStoredAttachment,
    hasAttachmentContent,
    readAttachmentFiles
} from "./attachmentUtils.js";
import {
    forgetCachedAttachment,
    openCachedAttachment
} from "./attachmentCache.js";
import { getCurrentFirebaseUser } from "./firebaseClient.js";
import { canEditMenu } from "./workspacePermissions.js";
import { showAlert, showConfirm } from "./dialogs.js";
import {
    getMedicalEquipment,
    getMedicalEquipmentContracts,
    selectMedicalEquipment
} from "./medicalEquipment.js";

export const TENDERS_KEY = "tenders";
export const TENDER_RENEWAL_WARNING_DAYS = 120;

const MAX_TENDERS = 500;
const MAX_TEXT = 240;
const MAX_LONG_TEXT = 3000;
const BUDGET_WARNING_RATE = 0.8;

const STAGE_DEFS = [
    {
        id: "planning",
        label: "Planificacion y diseno",
        hint: "Necesidad, bases administrativas/tecnicas, presupuesto y cronograma."
    },
    {
        id: "publication",
        label: "Publicacion y convocatoria",
        hint: "Bases publicadas en Mercado Publico, visitas a terreno y plazo minimo."
    },
    {
        id: "questions",
        label: "Consultas y aclaraciones",
        hint: "Foro de preguntas, respuestas y anexos/modificaciones a las bases."
    },
    {
        id: "opening",
        label: "Presentacion y apertura",
        hint: "Cierre de recepcion, apertura electronica y registro de ofertas."
    },
    {
        id: "evaluation",
        label: "Evaluacion de ofertas",
        hint: "Comision evaluadora, pauta, acta e informe final."
    },
    {
        id: "award",
        label: "Adjudicacion y contratacion",
        hint: "Resolucion fundada, contrato, garantias y administrador del contrato."
    },
    {
        id: "execution",
        label: "Ejecucion y control",
        hint: "Recepcion conforme, multas, garantias, pagos, prorroga y cierre."
    }
];

const STATUS_DEFS = [
    ["planning", "Planificacion"],
    ["published", "Publicada"],
    ["awarded", "Adjudicada"],
    ["active", "Vigente"],
    ["renewal", "Renovacion"],
    ["closed", "Cerrada"]
];

const DOCUMENT_TYPES = [
    ["bases", "Bases"],
    ["administrative", "Bases administrativas"],
    ["technical", "Bases tecnicas"],
    ["resolution", "Resolucion"],
    ["contract", "Contrato"],
    ["guarantee", "Garantia"],
    ["invoice", "Factura"],
    ["report", "Informe/acta"],
    ["other", "Otro"]
];

const INCIDENT_TYPES = [
    ["breach", "Incumplimiento"],
    ["pendingInvoice", "Factura pendiente"],
    ["fine", "Multa/garantia"],
    ["provider", "Proveedor"],
    ["milestone", "Hito"],
    ["note", "Nota"]
];

const TONE_LABELS = {
    ok: "Al dia",
    warn: "Atencion",
    danger: "Urgente",
    info: "Info"
};

const ui = {
    tenderId: "",
    tab: "resumen",
    search: "",
    status: "all",
    service: "all"
};

let panelBound = false;
let busy = false;

function clampText(value, maxLength = MAX_TEXT) {
    return String(value || "").trim().slice(0, maxLength);
}

function attr(value) {
    return escapeHTML(String(value || "")).replace(/`/g, "&#096;");
}

function esc(value) {
    return escapeHTML(String(value || ""));
}

function makeId(prefix = "tender") {
    return globalThis.crypto?.randomUUID?.() ||
        `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeId(value, fallbackPrefix = "tender") {
    return String(value || "")
        .trim()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 90) || makeId(fallbackPrefix);
}

function isoDate(value) {
    const clean = clampText(value, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : "";
}

function dateAtNoon(iso) {
    const clean = isoDate(iso);
    const date = clean ? new Date(`${clean}T12:00:00`) : new Date();
    date.setHours(12, 0, 0, 0);
    return date;
}

function todayISO() {
    return dateAtNoon().toISOString().slice(0, 10);
}

function addDaysISO(iso, days) {
    const date = dateAtNoon(iso);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
}

function daysBetween(fromISO, toISO) {
    const from = dateAtNoon(fromISO);
    const to = dateAtNoon(toISO);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
    return Math.round((to - from) / 86400000);
}

function daysUntil(iso, today = todayISO()) {
    return isoDate(iso) ? daysBetween(today, iso) : null;
}

function formatDate(iso) {
    const clean = isoDate(String(iso || "").slice(0, 10));
    return clean ? `${clean.slice(8, 10)}-${clean.slice(5, 7)}-${clean.slice(0, 4)}` : "--";
}

function formatDateShort(iso) {
    const clean = isoDate(iso);
    return clean ? `${clean.slice(8, 10)}/${clean.slice(5, 7)}` : "--";
}

function amountNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
    const normalized = String(value || "")
        .replace(/[^\d,.-]/g, "")
        .replace(/\./g, "")
        .replace(",", ".");
    const number = Number(normalized);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function formatMoney(value, currency = "CLP") {
    const number = amountNumber(value);
    if (!number) return currency === "UF" ? "0 UF" : "$0";
    if (currency === "UF") {
        return `${number.toLocaleString("es-CL", { maximumFractionDigits: 2 })} UF`;
    }
    return number.toLocaleString("es-CL", {
        style: "currency",
        currency: "CLP",
        maximumFractionDigits: 0
    });
}

function formatPercent(value) {
    if (!Number.isFinite(value)) return "0%";
    return `${Math.round(value * 100)}%`;
}

function currentUserName() {
    const user = getCurrentFirebaseUser();
    return clampText(user?.displayName || user?.email || "Supervisor", 160);
}

function pick(list, value, fallback) {
    const clean = String(value || "");
    return list.some(([id]) => id === clean) ? clean : fallback;
}

function normalizeAttachment(attachment = {}) {
    const name = clampText(attachment.name, 240);
    const dataUrl = String(attachment.dataUrl || "");
    const storagePath = String(attachment.storagePath || "");
    const downloadURL = String(attachment.downloadURL || "");

    if (!name || (!dataUrl && !storagePath && !downloadURL)) return null;

    const normalized = {
        id: String(attachment.id || makeId("tender_file")),
        name,
        type: String(attachment.type || "application/octet-stream").toLowerCase(),
        size: Number(attachment.size) || 0,
        addedAt: String(attachment.addedAt || new Date().toISOString()),
        storagePath,
        downloadURL,
        dataUrl,
        uploadedByUid: String(attachment.uploadedByUid || ""),
        docType: pick(DOCUMENT_TYPES, attachment.docType, "other")
    };
    const expiresAt = isoDate(attachment.expiresAt);

    if (expiresAt) normalized.expiresAt = expiresAt;

    return normalized;
}

function normalizeAttachments(value = []) {
    return (Array.isArray(value) ? value : [])
        .map(normalizeAttachment)
        .filter(Boolean)
        .slice(0, 120);
}

function normalizeInvoice(item = {}) {
    const number = clampText(item.number || item.invoiceNumber, 120);
    const provider = clampText(item.provider, 180);
    const amount = amountNumber(item.amount);
    const issueDate = isoDate(item.issueDate || item.date);
    const dueDate = isoDate(item.dueDate);
    const paidAt = isoDate(item.paidAt);

    if (!number && !provider && !amount && !issueDate && !dueDate && !item.attachments?.length) {
        return null;
    }

    return {
        id: String(item.id || makeId("tender_invoice")),
        number,
        provider,
        amount,
        issueDate,
        dueDate,
        paidAt,
        status: paidAt ? "paid" : pick([
            ["pending", "Pendiente"],
            ["paid", "Pagada"],
            ["observed", "Observada"]
        ], item.status, "pending"),
        notes: clampText(item.notes, 900),
        attachments: normalizeAttachments(item.attachments),
        createdAt: String(item.createdAt || new Date().toISOString())
    };
}

function normalizeInvoices(value = []) {
    return (Array.isArray(value) ? value : [])
        .map(normalizeInvoice)
        .filter(Boolean)
        .slice(0, 200);
}

function normalizeIncident(item = {}) {
    const title = clampText(item.title, 160);
    const detail = clampText(item.detail || item.notes, MAX_LONG_TEXT);
    const date = isoDate(item.date) || todayISO();

    if (!title && !detail && !item.attachments?.length) return null;

    return {
        id: String(item.id || makeId("tender_incident")),
        type: pick(INCIDENT_TYPES, item.type, "note"),
        title: title || "Incidencia",
        detail,
        date,
        status: String(item.status || "open") === "closed" ? "closed" : "open",
        amount: amountNumber(item.amount),
        responsible: clampText(item.responsible, 160),
        attachments: normalizeAttachments(item.attachments),
        createdAt: String(item.createdAt || new Date().toISOString())
    };
}

function normalizeIncidents(value = []) {
    return (Array.isArray(value) ? value : [])
        .map(normalizeIncident)
        .filter(Boolean)
        .slice(0, 200);
}

function normalizeExtension(item = {}) {
    const from = isoDate(item.from || item.startDate);
    const to = isoDate(item.to || item.endDate);
    const resolution = clampText(item.resolution, 180);
    const reason = clampText(item.reason || item.detail, MAX_LONG_TEXT);

    if (!from && !to && !resolution && !reason && !item.attachments?.length) return null;

    return {
        id: String(item.id || makeId("tender_extension")),
        from,
        to,
        resolution,
        reason,
        amount: amountNumber(item.amount),
        attachments: normalizeAttachments(item.attachments),
        createdAt: String(item.createdAt || new Date().toISOString())
    };
}

function normalizeExtensions(value = []) {
    return (Array.isArray(value) ? value : [])
        .map(normalizeExtension)
        .filter(Boolean)
        .slice(0, 120);
}

function normalizeStages(value = {}) {
    const source = value && typeof value === "object" ? value : {};
    return STAGE_DEFS.reduce((map, stage) => {
        map[stage.id] = Boolean(source[stage.id]);
        return map;
    }, {});
}

function normalizeTender(item = {}) {
    const createdAt = String(item.createdAt || new Date().toISOString());
    const id = String(item.id || normalizeId(item.code || item.name, "tender"));

    return {
        id,
        code: clampText(item.code || item.tenderId, 120),
        name: clampText(item.name || item.title || "Licitacion sin nombre", 180),
        service: clampText(item.service || item.unit || "Servicio sin especificar", 160),
        provider: clampText(item.provider, 180),
        administrator: clampText(item.administrator, 180),
        status: pick(STATUS_DEFS, item.status, "planning"),
        startDate: isoDate(item.startDate),
        endDate: isoDate(item.endDate),
        renewalAlertDate: isoDate(item.renewalAlertDate),
        expirationMode: String(item.expirationMode || "date") === "budget" ? "budget" :
            String(item.expirationMode || "") === "dateOrBudget" ? "dateOrBudget" : "date",
        amount: amountNumber(item.amount),
        currency: String(item.currency || "CLP") === "UF" ? "UF" : "CLP",
        notes: clampText(item.notes, MAX_LONG_TEXT),
        legalNotes: clampText(item.legalNotes, MAX_LONG_TEXT),
        relatedMedicalContractId: String(item.relatedMedicalContractId || ""),
        previousTenderId: String(item.previousTenderId || ""),
        stages: normalizeStages(item.stages),
        documents: normalizeAttachments(item.documents || item.attachments),
        invoices: normalizeInvoices(item.invoices),
        incidents: normalizeIncidents(item.incidents),
        extensions: normalizeExtensions(item.extensions),
        createdAt,
        updatedAt: String(item.updatedAt || createdAt),
        updatedByUid: String(item.updatedByUid || "")
    };
}

export function normalizeTenders(value = []) {
    const seen = new Set();

    return (Array.isArray(value) ? value : [])
        .map(normalizeTender)
        .filter(item => item.id && !seen.has(item.id) && seen.add(item.id))
        .slice(0, MAX_TENDERS);
}

export function getTenders() {
    return normalizeTenders(getJSON(TENDERS_KEY, []));
}

function dispatchTendersChanged() {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("proturnos:tendersChanged"));
}

function stamp(item) {
    return {
        ...item,
        updatedAt: new Date().toISOString(),
        updatedByUid: getCurrentFirebaseUser()?.uid || ""
    };
}

function saveTenders(items) {
    const normalized = normalizeTenders(items);
    setJSON(TENDERS_KEY, normalized);
    dispatchTendersChanged();
    return normalized;
}

function upsertTender(item) {
    const normalized = normalizeTender(stamp(item));
    const current = getTenders();
    const exists = current.some(entry => entry.id === normalized.id);
    return saveTenders(exists
        ? current.map(entry => entry.id === normalized.id ? normalized : entry)
        : [...current, normalized]
    );
}

function updateTender(id, updater) {
    const current = getTenders();
    const index = current.findIndex(item => item.id === id);
    if (index < 0) return current;

    const next = [...current];
    next[index] = normalizeTender(stamp(updater(next[index])));
    return saveTenders(next);
}

function removeTender(id) {
    return saveTenders(getTenders().filter(item => item.id !== id));
}

export function selectTender(id, tab = "resumen") {
    ui.tenderId = String(id || "");
    ui.tab = ["resumen", "documentos", "facturas", "incidencias", "legal"].includes(tab)
        ? tab
        : "resumen";
}

function budgetSummary(tender) {
    const amount = amountNumber(tender.amount);
    const invoiced = tender.invoices.reduce((sum, invoice) => sum + amountNumber(invoice.amount), 0);
    const paid = tender.invoices
        .filter(invoice => invoice.status === "paid" || invoice.paidAt)
        .reduce((sum, invoice) => sum + amountNumber(invoice.amount), 0);
    const pending = tender.invoices
        .filter(invoice => invoice.status !== "paid" && !invoice.paidAt)
        .reduce((sum, invoice) => sum + amountNumber(invoice.amount), 0);
    const remaining = amount ? Math.max(0, amount - invoiced) : 0;
    const usedRate = amount ? Math.min(1, invoiced / amount) : 0;

    return { amount, invoiced, paid, pending, remaining, usedRate };
}

function stageProgress(tender) {
    const done = STAGE_DEFS.filter(stage => tender.stages[stage.id]).length;
    return { done, total: STAGE_DEFS.length, rate: done / STAGE_DEFS.length };
}

function tenderHealth(tender, today = todayISO()) {
    const days = daysUntil(tender.endDate, today);
    const budget = budgetSummary(tender);
    const budgetLimited = tender.expirationMode !== "date";
    const openIncidents = tender.incidents.filter(item => item.status !== "closed").length;

    if (tender.status === "closed") {
        return { tone: "info", label: "Cerrada", days, budget, openIncidents };
    }

    if (days !== null && days < 0) {
        return { tone: "danger", label: `Vencida hace ${-days} d`, days, budget, openIncidents };
    }

    if (budgetLimited && budget.amount && budget.remaining <= 0) {
        return { tone: "danger", label: "Presupuesto agotado", days, budget, openIncidents };
    }

    if (days !== null && days <= TENDER_RENEWAL_WARNING_DAYS) {
        return { tone: days <= 30 ? "danger" : "warn", label: `Vence en ${days} d`, days, budget, openIncidents };
    }

    if (budgetLimited && budget.amount && budget.usedRate >= BUDGET_WARNING_RATE) {
        return { tone: "warn", label: `Saldo ${formatPercent(1 - budget.usedRate)}`, days, budget, openIncidents };
    }

    if (openIncidents) {
        return { tone: "warn", label: `${openIncidents} incidencia(s)`, days, budget, openIncidents };
    }

    return { tone: "ok", label: tender.status === "planning" ? "En preparacion" : "Vigente", days, budget, openIncidents };
}

export function tenderRenewalKanbanCards(today = todayISO(), tenders = getTenders()) {
    const baseDate = isoDate(today) || todayISO();

    return normalizeTenders(tenders)
        .filter(tender => tender.status !== "closed")
        .map(tender => ({ tender, health: tenderHealth(tender, baseDate) }))
        .filter(({ tender, health }) => {
            const dateDue = health.days !== null && health.days <= TENDER_RENEWAL_WARNING_DAYS;
            const budgetDue = tender.expirationMode !== "date" &&
                health.budget.amount &&
                health.budget.usedRate >= BUDGET_WARNING_RATE;
            return dateDue || budgetDue;
        })
        .sort((a, b) =>
            (a.tender.endDate || "9999-12-31").localeCompare(b.tender.endDate || "9999-12-31") ||
            (b.health.budget.usedRate - a.health.budget.usedRate) ||
            a.tender.name.localeCompare(b.tender.name, "es")
        )
        .map(({ tender, health }) => {
            const dueDate = tender.endDate || addDaysISO(baseDate, 1);
            const budgetDue = tender.expirationMode !== "date" &&
                health.budget.amount &&
                health.budget.usedRate >= BUDGET_WARNING_RATE;
            return {
                id: `tender_renewal_${tender.id}_${dueDate}`,
                source: "tenderRenewal",
                auto: true,
                readOnly: true,
                status: "pending",
                color: budgetDue ? "yellow" : "coral",
                tenderId: tender.id,
                dueDate,
                title: budgetDue
                    ? `Revisar saldo de licitacion ${tender.name}: queda ${formatMoney(health.budget.remaining, tender.currency)}`
                    : `Trabajar renovacion de licitacion ${tender.name}, vence el ${formatDate(dueDate)}`,
                detail: [
                    tender.code ? `ID Mercado Publico: ${tender.code}` : "",
                    tender.service ? `Servicio: ${tender.service}` : "",
                    tender.provider ? `Proveedor: ${tender.provider}` : "",
                    tender.amount ? `Monto: ${formatMoney(tender.amount, tender.currency)}` : ""
                ].filter(Boolean).join("\n"),
                createdAt: `${baseDate}T00:00:00.000Z`,
                updatedAt: `${dueDate}T12:00:00.000Z`
            };
        });
}

function relatedMedicalLinks(tender) {
    const contracts = getMedicalEquipmentContracts();
    const equipment = getMedicalEquipment();
    const needleCode = tender.code.toLowerCase();
    const needleProvider = tender.provider.toLowerCase();

    return contracts
        .filter(contract => {
            if (tender.relatedMedicalContractId && contract.id === tender.relatedMedicalContractId) return true;
            const contractTenderId = String(contract.tenderId || "").toLowerCase();
            const provider = String(contract.provider || "").toLowerCase();
            return (needleCode && contractTenderId && contractTenderId === needleCode) ||
                (needleProvider && provider && provider === needleProvider);
        })
        .map(contract => ({
            ...contract,
            equipment: equipment.filter(item => item.contractId === contract.id)
        }));
}

function context() {
    const tenders = getTenders();
    if (ui.tenderId && !tenders.some(item => item.id === ui.tenderId)) {
        ui.tenderId = tenders[0]?.id || "";
    }
    if (!ui.tenderId && tenders.length) {
        ui.tenderId = tenders[0].id;
    }

    const today = todayISO();
    const services = [...new Set(tenders.map(item => item.service).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "es"));
    const filtered = tenders
        .filter(item => ui.status === "all" || item.status === ui.status)
        .filter(item => ui.service === "all" || item.service === ui.service)
        .filter(item => {
            const query = ui.search.toLowerCase();
            if (!query) return true;
            return [
                item.name,
                item.code,
                item.service,
                item.provider,
                item.administrator
            ].some(value => String(value || "").toLowerCase().includes(query));
        })
        .sort((a, b) => {
            const ah = tenderHealth(a, today);
            const bh = tenderHealth(b, today);
            const toneOrder = { danger: 0, warn: 1, info: 2, ok: 3 };
            return (toneOrder[ah.tone] - toneOrder[bh.tone]) ||
                (a.endDate || "9999-12-31").localeCompare(b.endDate || "9999-12-31") ||
                a.name.localeCompare(b.name, "es");
        });

    return {
        tenders,
        filtered,
        selected: tenders.find(item => item.id === ui.tenderId) || null,
        today,
        services,
        canEdit: canEditMenu("tenders")
    };
}

const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    file: '<path d="M6 3h9l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5"/><path d="M8 13h8M8 17h5"/>',
    briefcase: '<path d="M10 6V5a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v1"/><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 12h18"/><path d="M12 11v3"/>',
    invoice: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2Z"/><path d="M9 7h6M9 11h6M9 15h3"/>',
    alert: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    renew: '<path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/><path d="M3 12A9 9 0 0 1 18 5.3L21 8"/><path d="M21 3v5h-5"/>',
    equipment: '<rect x="4" y="4" width="16" height="11" rx="2"/><path d="M8 19h8M12 15v4"/><path d="M8 10h2l1.2-2.5L13.8 13l1.1-3H17"/>',
    calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'
};

function ic(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.file}</svg>`;
}

function selectOptions(options, selected) {
    return options.map(([value, label]) =>
        `<option value="${attr(value)}" ${value === selected ? "selected" : ""}>${esc(label)}</option>`
    ).join("");
}

function statusLabel(value) {
    return STATUS_DEFS.find(([id]) => id === value)?.[1] || value;
}

function incidentTypeLabel(value) {
    return INCIDENT_TYPES.find(([id]) => id === value)?.[1] || "Nota";
}

function documentTypeLabel(value) {
    return DOCUMENT_TYPES.find(([id]) => id === value)?.[1] || "Otro";
}

function emptyStateHTML(ctx) {
    return `<div class="tnd-root">
        <section class="tnd-empty">
            <span class="tnd-empty__icon">${ic("briefcase")}</span>
            <strong>Licitaciones</strong>
            <p>Registra licitaciones por servicio, vigencia, presupuesto, facturas, documentos e incidencias. Las alertas de renovacion aparecen en Kanban 120 dias antes del vencimiento o cuando el presupuesto se esta agotando.</p>
            ${ctx.canEdit ? `<button class="tnd-btn tnd-btn--primary" type="button" data-tender-act="new">${ic("plus")}Trabajar nueva licitacion</button>` : ""}
        </section>
    </div>`;
}

function kpiHTML(ctx) {
    const health = ctx.tenders.map(item => tenderHealth(item, ctx.today));
    const active = ctx.tenders.filter(item => item.status !== "closed").length;
    const urgent = health.filter(item => item.tone === "danger").length;
    const warning = health.filter(item => item.tone === "warn").length;
    const budget = ctx.tenders.reduce((sum, item) => sum + amountNumber(item.amount), 0);
    const invoiced = ctx.tenders.reduce((sum, item) => sum + budgetSummary(item).invoiced, 0);

    return `<div class="tnd-kpis">
        <button class="tnd-kpi" type="button" data-tender-filter-status="all"><span>Licitaciones activas</span><strong>${active}</strong><small>${ctx.tenders.length} registradas</small></button>
        <button class="tnd-kpi tnd-kpi--danger" type="button" data-tender-filter-health="danger"><span>Urgentes</span><strong>${urgent}</strong><small>vencidas, 30 d o presupuesto agotado</small></button>
        <button class="tnd-kpi tnd-kpi--warn" type="button" data-tender-filter-health="warn"><span>En atencion</span><strong>${warning}</strong><small>120 dias, saldo bajo o incidencias</small></button>
        <div class="tnd-kpi"><span>Presupuesto usado</span><strong>${budget ? formatPercent(invoiced / budget) : "0%"}</strong><small>${formatMoney(invoiced)} de ${formatMoney(budget)}</small></div>
    </div>`;
}

function listHTML(ctx) {
    return `<aside class="tnd-list">
        <div class="tnd-list__tools">
            <input type="search" data-tender-search placeholder="Buscar licitacion, proveedor o servicio" value="${attr(ui.search)}">
            <div class="tnd-list__filters">
                <select data-tender-status-filter>
                    <option value="all" ${ui.status === "all" ? "selected" : ""}>Estados - Todos</option>
                    ${selectOptions(STATUS_DEFS, ui.status)}
                </select>
                <select data-tender-service-filter>
                    <option value="all" ${ui.service === "all" ? "selected" : ""}>Servicios - Todos</option>
                    ${ctx.services.map(service => `<option value="${attr(service)}" ${service === ui.service ? "selected" : ""}>${esc(service)}</option>`).join("")}
                </select>
            </div>
        </div>
        <div class="tnd-items">
            ${ctx.filtered.length ? ctx.filtered.map(tenderListItemHTML(ctx)).join("") : `<p class="tnd-hint">No hay licitaciones con esos filtros.</p>`}
        </div>
    </aside>`;
}

function tenderListItemHTML(ctx) {
    return tender => {
        const health = tenderHealth(tender, ctx.today);
        const budget = health.budget;
        const active = tender.id === ctx.selected?.id ? " is-active" : "";

        return `<button class="tnd-item${active}" type="button" data-tender-open="${attr(tender.id)}">
            <span class="tnd-item__top"><strong>${esc(tender.name)}</strong><i class="tnd-pill tnd-pill--${health.tone}">${esc(health.label)}</i></span>
            <span>${esc(tender.service)}${tender.provider ? ` · ${esc(tender.provider)}` : ""}</span>
            <span class="tnd-item__foot"><small>${tender.code ? `ID ${esc(tender.code)}` : statusLabel(tender.status)}</small><small>${tender.endDate ? `Hasta ${formatDate(tender.endDate)}` : "Sin termino"}</small></span>
            ${budget.amount ? `<span class="tnd-progress"><i style="width:${Math.min(100, budget.usedRate * 100)}%"></i></span>` : ""}
        </button>`;
    };
}

function tabsHTML(active) {
    const tabs = [
        ["resumen", "Resumen"],
        ["documentos", "Documentos"],
        ["facturas", "Facturas"],
        ["incidencias", "Incidencias"],
        ["legal", "Checklist legal"]
    ];

    return `<div class="tnd-tabs">${tabs.map(([id, label]) =>
        `<button type="button" class="${id === active ? "is-active" : ""}" data-tender-tab="${id}">${esc(label)}</button>`
    ).join("")}</div>`;
}

function selectedHeaderHTML(tender, ctx) {
    const health = tenderHealth(tender, ctx.today);
    const progress = stageProgress(tender);
    const edit = ctx.canEdit ? `<button class="tnd-btn tnd-btn--secondary" type="button" data-tender-act="edit">${ic("file")}Editar</button>` : "";
    const renew = ctx.canEdit ? `<button class="tnd-btn tnd-btn--primary" type="button" data-tender-act="renew">${ic("renew")}Renovar licitacion existente</button>` : "";

    return `<div class="tnd-detail__head">
        <div>
            <span class="tnd-kicker">${tender.code ? `ID Mercado Publico ${esc(tender.code)}` : esc(statusLabel(tender.status))}</span>
            <h2>${esc(tender.name)}</h2>
            <p>${esc(tender.service)}${tender.provider ? ` · ${esc(tender.provider)}` : ""}</p>
        </div>
        <span class="tnd-head__actions">
            <span class="tnd-pill tnd-pill--${health.tone}">${esc(TONE_LABELS[health.tone] || "Estado")} · ${esc(health.label)}</span>
            <span class="tnd-pill">Etapas ${progress.done}/${progress.total}</span>
            ${edit}
            ${renew}
        </span>
    </div>`;
}

function summaryHTML(tender, ctx) {
    const health = tenderHealth(tender, ctx.today);
    const budget = health.budget;
    const related = relatedMedicalLinks(tender);
    const alertDate = tender.endDate ? addDaysISO(tender.endDate, -TENDER_RENEWAL_WARNING_DAYS) : "";

    return `<div class="tnd-summary">
        <section class="tnd-sec">
            <div class="tnd-sec__h"><h3>Vigencia y presupuesto</h3><span class="tnd-pill tnd-pill--${health.tone}">${esc(health.label)}</span></div>
            <div class="tnd-grid2">
                ${infoBox("Inicio", formatDate(tender.startDate))}
                ${infoBox("Termino", formatDate(tender.endDate))}
                ${infoBox("Alerta Kanban", alertDate ? formatDate(alertDate) : "--")}
                ${infoBox("Modalidad", tender.expirationMode === "date" ? "Por plazo" : tender.expirationMode === "budget" ? "Por presupuesto" : "Plazo o presupuesto")}
            </div>
            <div class="tnd-budget">
                <div><span>Monto</span><strong>${formatMoney(budget.amount, tender.currency)}</strong></div>
                <div><span>Facturado</span><strong>${formatMoney(budget.invoiced, tender.currency)}</strong></div>
                <div><span>Saldo disponible</span><strong>${formatMoney(budget.remaining, tender.currency)}</strong></div>
                <div class="tnd-budget__bar"><i class="${budget.usedRate >= 1 ? "is-danger" : budget.usedRate >= BUDGET_WARNING_RATE ? "is-warn" : ""}" style="width:${Math.min(100, budget.usedRate * 100)}%"></i></div>
            </div>
        </section>
        <section class="tnd-sec">
            <div class="tnd-sec__h"><h3>Etapas</h3><span>${stageProgress(tender).done}/${STAGE_DEFS.length}</span></div>
            <div class="tnd-stages">${STAGE_DEFS.map(stage => stageHTML(stage, tender, ctx)).join("")}</div>
        </section>
        <section class="tnd-sec">
            <div class="tnd-sec__h"><h3>Incidencias y prorrogas</h3>${ctx.canEdit ? `<button class="tnd-link" type="button" data-tender-act="incident">${ic("plus")}Agregar incidencia</button>` : ""}</div>
            <div class="tnd-grid2">
                ${infoBox("Incidencias abiertas", String(tender.incidents.filter(item => item.status !== "closed").length))}
                ${infoBox("Prorrogas", String(tender.extensions.length))}
                ${infoBox("Facturas pendientes", formatMoney(budget.pending, tender.currency))}
                ${infoBox("Administrador", tender.administrator || "--")}
            </div>
        </section>
        <section class="tnd-sec">
            <div class="tnd-sec__h"><h3>Conversacion con Equipos Medicos</h3>${related.length ? `<span>${related.length} contrato(s)</span>` : ""}</div>
            ${related.length ? related.map(contract => `
                <button class="tnd-related" type="button" data-tender-medical-contract="${attr(contract.id)}">
                    <span>${ic("equipment")}</span>
                    <strong>${esc(contract.provider || "Contrato de mantencion")}</strong>
                    <small>${contract.endDate ? `Hasta ${formatDate(contract.endDate)}` : "Sin termino"} · ${contract.equipment.length} equipo(s)</small>
                </button>`).join("") : `<p class="tnd-hint">Cuando el ID Mercado Publico o proveedor coincida con un contrato de mantencion, aparece aqui para abrirlo directo desde Equipos Medicos.</p>`}
        </section>
        ${tender.notes ? `<section class="tnd-sec"><div class="tnd-sec__h"><h3>Notas internas</h3></div><p class="tnd-note">${esc(tender.notes)}</p></section>` : ""}
    </div>`;
}

function infoBox(label, value) {
    return `<div class="tnd-info"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function stageHTML(stage, tender, ctx) {
    const checked = tender.stages[stage.id];

    return `<label class="tnd-stage ${checked ? "is-done" : ""}">
        <input type="checkbox" data-tender-stage="${attr(stage.id)}" ${checked ? "checked" : ""} ${ctx.canEdit ? "" : "disabled"}>
        <span><strong>${esc(stage.label)}</strong><small>${esc(stage.hint)}</small></span>
    </label>`;
}

function uploadButtonHTML(action, label) {
    return `<label class="tnd-btn tnd-btn--secondary tnd-upload">${ic("plus")}${esc(label)}
        <input type="file" multiple accept="${ATTACHMENT_ACCEPT}" data-tender-upload="${attr(action)}">
    </label>`;
}

function fileRowsHTML(files, group, ctx, emptyText, extra = {}) {
    if (!files.length) return `<p class="tnd-hint">${esc(emptyText)}</p>`;

    return `<div class="tnd-files">${files.map(file => `<div class="tnd-file">
        <span class="tnd-file__ic">${ic("file")}</span>
        <span><strong>${esc(file.name)}</strong><small>${documentTypeLabel(file.docType)} · ${formatDate(file.addedAt)}</small></span>
        <span class="tnd-file__actions">
            <button class="tnd-link" type="button" data-tender-file-group="${attr(group)}" data-tender-file="${attr(file.id)}" ${extra.parentId ? `data-tender-parent="${attr(extra.parentId)}"` : ""}>Ver</button>
            ${ctx.canEdit ? `<button class="tnd-iconbtn" type="button" title="Quitar archivo" data-tender-act="delete-file" data-tender-file-group="${attr(group)}" data-tender-file="${attr(file.id)}" ${extra.parentId ? `data-tender-parent="${attr(extra.parentId)}"` : ""}>${ic("trash")}</button>` : ""}
        </span>
    </div>`).join("")}</div>`;
}

function documentsHTML(tender, ctx) {
    return `<section class="tnd-sec">
        <div class="tnd-sec__h"><h3>Documentos de la licitacion</h3>${ctx.canEdit ? uploadButtonHTML("documents", "Adjuntar documentos") : ""}</div>
        <div class="tnd-doc-types">
            ${DOCUMENT_TYPES.map(([id, label]) => `<span>${esc(label)} <strong>${tender.documents.filter(file => file.docType === id).length}</strong></span>`).join("")}
        </div>
        ${fileRowsHTML(tender.documents, "documents", ctx, "Sin documentos. Adjunta bases, resoluciones, contrato, garantias, informes o anexos.")}
    </section>`;
}

function invoicesHTML(tender, ctx) {
    const budget = budgetSummary(tender);
    return `<section class="tnd-sec">
        <div class="tnd-sec__h"><h3>Facturas y saldo</h3>${ctx.canEdit ? `<button class="tnd-btn tnd-btn--primary" type="button" data-tender-act="invoice">${ic("plus")}Agregar factura</button>` : ""}</div>
        <div class="tnd-grid3">
            ${infoBox("Monto licitado", formatMoney(budget.amount, tender.currency))}
            ${infoBox("Facturado", formatMoney(budget.invoiced, tender.currency))}
            ${infoBox("Saldo disponible", formatMoney(budget.remaining, tender.currency))}
        </div>
        ${tender.invoices.length ? `<div class="tnd-tablewrap"><table class="tnd-table"><thead><tr><th>Factura</th><th>Fecha</th><th>Monto</th><th>Estado</th><th>Adjuntos</th><th></th></tr></thead><tbody>
            ${tender.invoices.map(invoice => `<tr>
                <td><strong>${esc(invoice.number || "Sin numero")}</strong><small>${esc(invoice.provider || tender.provider || "")}</small></td>
                <td>${formatDate(invoice.issueDate)}${invoice.dueDate ? `<small>Vence ${formatDate(invoice.dueDate)}</small>` : ""}</td>
                <td>${formatMoney(invoice.amount, tender.currency)}</td>
                <td><span class="tnd-pill tnd-pill--${invoice.status === "paid" ? "ok" : invoice.status === "observed" ? "danger" : "warn"}">${invoice.status === "paid" ? "Pagada" : invoice.status === "observed" ? "Observada" : "Pendiente"}</span></td>
                <td>${invoice.attachments.length ? `${invoice.attachments.length} archivo(s)` : "Sin respaldo"}</td>
                <td>${ctx.canEdit ? `<button class="tnd-iconbtn" type="button" title="Eliminar factura" data-tender-act="delete-invoice" data-tender-invoice="${attr(invoice.id)}">${ic("trash")}</button>` : ""}</td>
            </tr>
            ${invoice.attachments.length ? `<tr class="tnd-table__files"><td colspan="6">${fileRowsHTML(invoice.attachments, "invoice", ctx, "", { parentId: invoice.id })}</td></tr>` : ""}`).join("")}
        </tbody></table></div>` : `<p class="tnd-hint">Sin facturas registradas. Al adjuntarlas se calcula el saldo disponible de la licitacion.</p>`}
    </section>`;
}

function incidentsHTML(tender, ctx) {
    return `<section class="tnd-sec">
        <div class="tnd-sec__h">
            <h3>Eventos e incidencias</h3>
            <span>${tender.incidents.filter(item => item.status !== "closed").length} abiertas</span>
            ${ctx.canEdit ? `<button class="tnd-btn tnd-btn--primary" type="button" data-tender-act="incident">${ic("plus")}Agregar incidencia</button>` : ""}
        </div>
        ${tender.incidents.length ? `<div class="tnd-timeline">
            ${tender.incidents.map(item => `<article class="tnd-event tnd-event--${item.status === "closed" ? "closed" : "open"}">
                <div><span class="tnd-kicker">${formatDate(item.date)} · ${incidentTypeLabel(item.type)}</span><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></div>
                <aside>
                    ${item.amount ? `<span class="tnd-pill tnd-pill--warn">${formatMoney(item.amount, tender.currency)}</span>` : ""}
                    <span class="tnd-pill tnd-pill--${item.status === "closed" ? "ok" : "danger"}">${item.status === "closed" ? "Cerrada" : "Abierta"}</span>
                    ${ctx.canEdit ? `<button class="tnd-link" type="button" data-tender-act="toggle-incident" data-tender-incident="${attr(item.id)}">${item.status === "closed" ? "Reabrir" : "Cerrar"}</button>` : ""}
                    ${ctx.canEdit ? `<button class="tnd-iconbtn" type="button" title="Eliminar incidencia" data-tender-act="delete-incident" data-tender-incident="${attr(item.id)}">${ic("trash")}</button>` : ""}
                </aside>
                ${item.attachments.length ? `<div class="tnd-event__files">${fileRowsHTML(item.attachments, "incident", ctx, "", { parentId: item.id })}</div>` : ""}
            </article>`).join("")}
        </div>` : `<p class="tnd-hint">Sin eventos registrados. Usa este historial para dejar respaldo de incumplimientos, pagos pendientes, multas, cambios de plazo o comunicaciones importantes.</p>`}
        <div class="tnd-sec__h tnd-sec__h--mt"><h3>Prorrogas del contrato</h3>${ctx.canEdit ? `<button class="tnd-link" type="button" data-tender-act="extension">${ic("plus")}Agregar prorroga</button>` : ""}</div>
        ${tender.extensions.length ? `<div class="tnd-extension-list">${tender.extensions.map(ext => `<article class="tnd-extension">
            <strong>${formatDate(ext.from)} a ${formatDate(ext.to)}</strong>
            <span>${ext.resolution ? `Resolucion ${esc(ext.resolution)} · ` : ""}${formatMoney(ext.amount, tender.currency)}</span>
            <p>${esc(ext.reason)}</p>
            ${ext.attachments.length ? fileRowsHTML(ext.attachments, "extension", ctx, "", { parentId: ext.id }) : ""}
            ${ctx.canEdit ? `<button class="tnd-iconbtn" type="button" title="Eliminar prorroga" data-tender-act="delete-extension" data-tender-extension="${attr(ext.id)}">${ic("trash")}</button>` : ""}
        </article>`).join("")}</div>` : `<p class="tnd-hint">Sin prorrogas registradas.</p>`}
    </section>`;
}

function legalHTML(tender, ctx) {
    return `<div class="tnd-legal">
        <section class="tnd-sec">
            <div class="tnd-sec__h"><h3>Checklist operativo</h3><span>Recordatorios ChileCompra</span></div>
            <div class="tnd-checklist">
                ${legalReminderHTML("Publicar expediente completo", "Mantener bases, anexos, actas de comision, declaraciones de conflictos de interes, informe final y resolucion de adjudicacion en el expediente.")}
                ${legalReminderHTML("Garantias", "Definir monto, vigencia, glosa y moneda en las bases. Para servicios, si no se indica otro plazo, la garantia de fiel cumplimiento debe cubrir al menos 60 dias habiles despues del termino.")}
                ${legalReminderHTML("Modificaciones", "Evitar modificaciones que superen el 30% del monto original del contrato; registrar resoluciones y antecedentes.")}
                ${legalReminderHTML("Multas o termino anticipado", "Antes de aplicar sanciones, revisar bases/contrato, permitir descargos del proveedor y formalizar mediante resolucion fundada.")}
                ${legalReminderHTML("Cierre de contrato", "Registrar recepcion conforme, evaluacion del proveedor, multas, garantias y saldos pendientes antes de cerrar.")}
            </div>
        </section>
        <section class="tnd-sec">
            <div class="tnd-sec__h"><h3>Notas legales internas</h3>${ctx.canEdit ? `<button class="tnd-link" type="button" data-tender-act="legal-edit">${ic("file")}Editar nota</button>` : ""}</div>
            <p class="tnd-note">${tender.legalNotes ? esc(tender.legalNotes) : "Sin notas legales internas para esta licitacion."}</p>
        </section>
    </div>`;
}

function legalReminderHTML(title, text) {
    return `<article class="tnd-reminder">
        <span>${ic("check")}</span>
        <div><strong>${esc(title)}</strong><p>${esc(text)}</p></div>
    </article>`;
}

function detailHTML(ctx) {
    const tender = ctx.selected;

    if (!tender) {
        return `<main class="tnd-detail"><div class="tnd-empty"><strong>No hay licitacion seleccionada</strong></div></main>`;
    }

    const body = ui.tab === "documentos"
        ? documentsHTML(tender, ctx)
        : ui.tab === "facturas"
            ? invoicesHTML(tender, ctx)
            : ui.tab === "incidencias"
                ? incidentsHTML(tender, ctx)
                : ui.tab === "legal"
                    ? legalHTML(tender, ctx)
                    : summaryHTML(tender, ctx);

    return `<main class="tnd-detail">
        ${selectedHeaderHTML(tender, ctx)}
        ${tabsHTML(ui.tab)}
        ${body}
    </main>`;
}

function renderShell(ctx) {
    if (!ctx.tenders.length) return emptyStateHTML(ctx);

    return `<div class="tnd-root">
        <header class="tnd-head">
            <div><span class="tnd-kicker">Gestion contractual</span><h1>Licitaciones</h1></div>
            <div class="tnd-head__actions">
                ${ctx.canEdit ? `<button class="tnd-btn tnd-btn--primary" type="button" data-tender-act="new">${ic("plus")}Trabajar nueva licitacion</button>` : ""}
                ${ctx.canEdit ? `<button class="tnd-btn tnd-btn--secondary" type="button" data-tender-act="renew" ${ctx.selected ? "" : "disabled"}>${ic("renew")}Renovar existente</button>` : ""}
            </div>
        </header>
        ${kpiHTML(ctx)}
        <div class="tnd-layout">
            ${listHTML(ctx)}
            ${detailHTML(ctx)}
        </div>
    </div>`;
}

export function renderTendersPanel() {
    const root = document.getElementById("tendersPanel");
    if (!root) return;

    const ctx = context();
    root.innerHTML = renderShell(ctx);
    bindPanelEvents(root);
}

function renderSoon() {
    if (document.body?.dataset?.activeView === "tenders") {
        renderTendersPanel();
    }
}

function bindPanelEvents(root) {
    root.querySelectorAll("[data-tender-open]").forEach(button => {
        button.onclick = () => {
            selectTender(button.dataset.tenderOpen, ui.tab);
            renderTendersPanel();
        };
    });

    root.querySelectorAll("[data-tender-tab]").forEach(button => {
        button.onclick = () => {
            ui.tab = button.dataset.tenderTab;
            renderTendersPanel();
        };
    });

    root.querySelectorAll("[data-tender-search]").forEach(input => {
        input.oninput = () => {
            ui.search = input.value;
            renderTendersPanel();
        };
    });

    root.querySelectorAll("[data-tender-status-filter]").forEach(select => {
        select.onchange = () => {
            ui.status = select.value;
            renderTendersPanel();
        };
    });

    root.querySelectorAll("[data-tender-service-filter]").forEach(select => {
        select.onchange = () => {
            ui.service = select.value;
            renderTendersPanel();
        };
    });

    root.querySelectorAll("[data-tender-stage]").forEach(input => {
        input.onchange = () => {
            const tender = context().selected;
            if (!tender || !canEditMenu("tenders")) return;
            updateTender(tender.id, item => ({
                ...item,
                stages: {
                    ...item.stages,
                    [input.dataset.tenderStage]: input.checked
                }
            }));
            renderTendersPanel();
        };
    });

    root.querySelectorAll("[data-tender-upload]").forEach(input => {
        input.onchange = () => {
            void handleAttachmentUpload(input.dataset.tenderUpload, input.files);
            input.value = "";
        };
    });

    root.querySelectorAll("[data-tender-file-group]").forEach(button => {
        button.onclick = () => {
            const tender = context().selected;
            const file = findAttachment(tender, button.dataset.tenderFileGroup, button.dataset.tenderFile, button.dataset.tenderParent);
            if (!file) return;
            openCachedAttachment(file).catch(error => showAlert(
                attachmentStorageErrorMessage(error, "abrir"),
                { title: "No se pudo abrir el adjunto", tone: "danger" }
            ));
        };
    });

    root.querySelectorAll("[data-tender-medical-contract]").forEach(button => {
        button.onclick = () => openRelatedMedicalContract(button.dataset.tenderMedicalContract);
    });

    root.querySelectorAll("[data-tender-filter-status]").forEach(button => {
        button.onclick = () => {
            ui.status = button.dataset.tenderFilterStatus || "all";
            renderTendersPanel();
        };
    });

    root.querySelectorAll("[data-tender-filter-health]").forEach(button => {
        button.onclick = () => {
            const tone = button.dataset.tenderFilterHealth;
            const match = context().tenders.find(item => tenderHealth(item).tone === tone);
            if (match) selectTender(match.id, "resumen");
            renderTendersPanel();
        };
    });

    root.querySelectorAll("[data-tender-act]").forEach(button => {
        button.onclick = () => handleAction(button);
    });
}

async function handleAction(button) {
    const action = button.dataset.tenderAct;
    const tender = context().selected;

    if (!canEditMenu("tenders") && !["open-file"].includes(action)) return;

    if (action === "new") return openTenderDialog();
    if (action === "edit" && tender) return openTenderDialog(tender);
    if (action === "renew" && tender) return openTenderDialog(tender, "renew");
    if (action === "invoice" && tender) return openInvoiceDialog(tender);
    if (action === "incident" && tender) return openIncidentDialog(tender);
    if (action === "extension" && tender) return openExtensionDialog(tender);
    if (action === "legal-edit" && tender) return openLegalDialog(tender);

    if (action === "delete-file" && tender) {
        return deleteAttachment(tender, button.dataset.tenderFileGroup, button.dataset.tenderFile, button.dataset.tenderParent);
    }

    if (action === "delete-invoice" && tender) {
        if (!await showConfirm("La factura y sus adjuntos se quitaran de esta licitacion.", {
            title: "Eliminar factura",
            tone: "danger",
            confirmText: "Eliminar",
            destructive: true
        })) return;
        updateTender(tender.id, item => ({
            ...item,
            invoices: item.invoices.filter(invoice => invoice.id !== button.dataset.tenderInvoice)
        }));
        return renderTendersPanel();
    }

    if (action === "toggle-incident" && tender) {
        updateTender(tender.id, item => ({
            ...item,
            incidents: item.incidents.map(incident => incident.id === button.dataset.tenderIncident
                ? { ...incident, status: incident.status === "closed" ? "open" : "closed" }
                : incident
            )
        }));
        return renderTendersPanel();
    }

    if (action === "delete-incident" && tender) {
        if (!await showConfirm("La incidencia se quitara del historial.", {
            title: "Eliminar incidencia",
            tone: "danger",
            confirmText: "Eliminar",
            destructive: true
        })) return;
        updateTender(tender.id, item => ({
            ...item,
            incidents: item.incidents.filter(incident => incident.id !== button.dataset.tenderIncident)
        }));
        return renderTendersPanel();
    }

    if (action === "delete-extension" && tender) {
        if (!await showConfirm("La prorroga se quitara de esta licitacion.", {
            title: "Eliminar prorroga",
            tone: "danger",
            confirmText: "Eliminar",
            destructive: true
        })) return;
        updateTender(tender.id, item => ({
            ...item,
            extensions: item.extensions.filter(extension => extension.id !== button.dataset.tenderExtension)
        }));
        return renderTendersPanel();
    }
}

function openRelatedMedicalContract(contractId) {
    const contract = getMedicalEquipmentContracts().find(item => item.id === contractId);
    const equipment = getMedicalEquipment().find(item => item.contractId === contractId);
    if (!contract || !equipment) return;
    selectMedicalEquipment(equipment.id, "contrato");
    document.querySelector('.nav-tile[data-target="medicalEquipmentPanel"]')?.click();
}

async function handleAttachmentUpload(group, files) {
    const tender = context().selected;
    if (!tender || busy) return;

    busy = true;
    try {
        const uploaded = await readAttachmentFiles(files, {
            moduleId: "tenders",
            ownerId: tender.id,
            recordId: group || "documents"
        });
        const normalized = uploaded.map(file => normalizeAttachment({
            ...file,
            docType: group === "documents" ? "other" : "invoice"
        })).filter(Boolean);

        updateTender(tender.id, item => ({
            ...item,
            documents: [...item.documents, ...normalized]
        }));
        renderTendersPanel();
    } catch (error) {
        await showAlert(attachmentStorageErrorMessage(error, "subir"), {
            title: "No se pudo adjuntar",
            tone: "danger"
        });
    } finally {
        busy = false;
    }
}

function findAttachment(tender, group, fileId, parentId = "") {
    if (!tender) return null;
    if (group === "documents") {
        return tender.documents.find(file => file.id === fileId) || null;
    }
    if (group === "invoice") {
        return tender.invoices.find(item => item.id === parentId)?.attachments.find(file => file.id === fileId) || null;
    }
    if (group === "incident") {
        return tender.incidents.find(item => item.id === parentId)?.attachments.find(file => file.id === fileId) || null;
    }
    if (group === "extension") {
        return tender.extensions.find(item => item.id === parentId)?.attachments.find(file => file.id === fileId) || null;
    }
    return null;
}

async function deleteAttachment(tender, group, fileId, parentId = "") {
    const file = findAttachment(tender, group, fileId, parentId);
    if (!file) return;
    if (!await showConfirm("El archivo se quitara de esta licitacion.", {
        title: "Quitar archivo",
        tone: "danger",
        confirmText: "Quitar",
        destructive: true
    })) return;

    try {
        if (hasAttachmentContent(file)) {
            await deleteStoredAttachment(file);
            forgetCachedAttachment(file);
        }
    } catch (error) {
        await showAlert(attachmentStorageErrorMessage(error, "eliminar"), {
            title: "No se pudo eliminar del almacenamiento",
            tone: "warning"
        });
    }

    updateTender(tender.id, item => {
        if (group === "documents") {
            return { ...item, documents: item.documents.filter(file => file.id !== fileId) };
        }
        if (group === "invoice") {
            return {
                ...item,
                invoices: item.invoices.map(invoice => invoice.id === parentId
                    ? { ...invoice, attachments: invoice.attachments.filter(file => file.id !== fileId) }
                    : invoice
                )
            };
        }
        if (group === "incident") {
            return {
                ...item,
                incidents: item.incidents.map(incident => incident.id === parentId
                    ? { ...incident, attachments: incident.attachments.filter(file => file.id !== fileId) }
                    : incident
                )
            };
        }
        if (group === "extension") {
            return {
                ...item,
                extensions: item.extensions.map(extension => extension.id === parentId
                    ? { ...extension, attachments: extension.attachments.filter(file => file.id !== fileId) }
                    : extension
                )
            };
        }
        return item;
    });
    renderTendersPanel();
}

function dialogShell(title, body, actions, attrs = "") {
    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop tnd-dialog-backdrop";
    backdrop.innerHTML = `<form class="turn-change-dialog tnd-dialog" ${attrs} autocomplete="off">
        <div class="tnd-dialog__head">
            <strong>${esc(title)}</strong>
            <button class="tnd-iconbtn" type="button" data-dialog-cancel aria-label="Cerrar">${ic("x")}</button>
        </div>
        ${body}
        <div class="turn-change-dialog__actions">${actions}</div>
    </form>`;
    document.body.appendChild(backdrop);
    backdrop.querySelectorAll("[data-dialog-cancel]").forEach(button => {
        button.addEventListener("click", () => backdrop.remove());
    });
    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) backdrop.remove();
    });
    return backdrop;
}

function openTenderDialog(tender = null, mode = "edit") {
    const isRenew = mode === "renew";
    const source = tender || normalizeTender({});
    const title = isRenew
        ? "Renovar licitacion existente"
        : tender ? "Editar licitacion" : "Trabajar nueva licitacion";
    const nextStart = isRenew && source.endDate ? addDaysISO(source.endDate, 1) : source.startDate;
    const body = `<div class="tnd-formgrid">
        <label><span>Nombre</span><input name="name" maxlength="180" required value="${attr(isRenew ? `${source.name} - renovacion` : source.name === "Licitacion sin nombre" ? "" : source.name)}"></label>
        <label><span>ID Mercado Publico</span><input name="code" maxlength="120" value="${attr(isRenew ? "" : source.code)}"></label>
        <label><span>Servicio</span><input name="service" maxlength="160" required value="${attr(source.service === "Servicio sin especificar" ? "" : source.service)}"></label>
        <label><span>Proveedor</span><input name="provider" maxlength="180" value="${attr(isRenew ? "" : source.provider)}"></label>
        <label><span>Estado</span><select name="status">${selectOptions(STATUS_DEFS, isRenew ? "renewal" : source.status)}</select></label>
        <label><span>Administrador del contrato</span><input name="administrator" maxlength="180" value="${attr(source.administrator)}"></label>
        <label><span>Fecha inicio</span><input name="startDate" type="date" value="${attr(nextStart)}"></label>
        <label><span>Fecha termino</span><input name="endDate" type="date" value="${attr(isRenew ? "" : source.endDate)}"></label>
        <label><span>Monto</span><input name="amount" inputmode="numeric" value="${attr(isRenew ? "" : source.amount)}"></label>
        <label><span>Moneda</span><select name="currency"><option value="CLP" ${source.currency !== "UF" ? "selected" : ""}>CLP</option><option value="UF" ${source.currency === "UF" ? "selected" : ""}>UF</option></select></label>
        <label><span>Tipo de vencimiento</span><select name="expirationMode">
            <option value="date" ${source.expirationMode === "date" ? "selected" : ""}>Por plazo</option>
            <option value="budget" ${source.expirationMode === "budget" ? "selected" : ""}>Por presupuesto</option>
            <option value="dateOrBudget" ${source.expirationMode === "dateOrBudget" ? "selected" : ""}>Plazo o presupuesto</option>
        </select></label>
        <label><span>Contrato Equipos Medicos relacionado</span><select name="relatedMedicalContractId">
            <option value="">Sin relacion directa</option>
            ${getMedicalEquipmentContracts().map(contract => `<option value="${attr(contract.id)}" ${contract.id === source.relatedMedicalContractId ? "selected" : ""}>${esc(contract.provider || "Contrato")} ${contract.tenderId ? `- ${esc(contract.tenderId)}` : ""}</option>`).join("")}
        </select></label>
        <label class="tnd-formgrid__full"><span>Notas</span><textarea name="notes" maxlength="${MAX_LONG_TEXT}" rows="4">${esc(source.notes)}</textarea></label>
    </div>`;
    const backdrop = dialogShell(title, body, `
        <button class="secondary-button" type="button" data-dialog-cancel>Cancelar</button>
        <button class="primary-button" type="submit">${isRenew ? "Crear renovacion" : "Guardar"}</button>
    `, "data-tender-form");

    backdrop.querySelector("form").onsubmit = event => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget).entries());
        const tenderId = isRenew
            ? makeId("tender")
            : tender?.id || makeId("tender");
        const base = isRenew
            ? {
                id: tenderId,
                previousTenderId: source.id,
                stages: normalizeStages({ planning: true }),
                documents: [],
                invoices: [],
                incidents: [{
                    id: makeId("tender_incident"),
                    type: "milestone",
                    title: "Renovacion iniciada",
                    detail: `Proceso creado a partir de ${source.name}.`,
                    date: todayISO(),
                    status: "open",
                    amount: 0,
                    responsible: currentUserName(),
                    attachments: [],
                    createdAt: new Date().toISOString()
                }],
                extensions: []
            }
            : tender || { id: tenderId, stages: normalizeStages({ planning: true }) };
        upsertTender({
            ...base,
            name: data.name,
            code: data.code,
            service: data.service,
            provider: data.provider,
            status: data.status,
            administrator: data.administrator,
            startDate: data.startDate,
            endDate: data.endDate,
            amount: amountNumber(data.amount),
            currency: data.currency,
            expirationMode: data.expirationMode,
            relatedMedicalContractId: data.relatedMedicalContractId,
            notes: data.notes
        });
        selectTender(tenderId, "resumen");
        backdrop.remove();
        renderTendersPanel();
    };
}

function openLegalDialog(tender) {
    const backdrop = dialogShell("Notas legales internas", `
        <label class="tnd-field"><span>Notas</span><textarea name="legalNotes" maxlength="${MAX_LONG_TEXT}" rows="8">${esc(tender.legalNotes)}</textarea></label>
    `, `
        <button class="secondary-button" type="button" data-dialog-cancel>Cancelar</button>
        <button class="primary-button" type="submit">Guardar</button>
    `, "data-tender-legal-form");

    backdrop.querySelector("form").onsubmit = event => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget).entries());
        updateTender(tender.id, item => ({ ...item, legalNotes: data.legalNotes }));
        backdrop.remove();
        renderTendersPanel();
    };
}

function openInvoiceDialog(tender) {
    const body = `<div class="tnd-formgrid">
        <label><span>Numero factura</span><input name="number" maxlength="120"></label>
        <label><span>Proveedor</span><input name="provider" maxlength="180" value="${attr(tender.provider)}"></label>
        <label><span>Monto</span><input name="amount" required inputmode="numeric"></label>
        <label><span>Fecha emision</span><input name="issueDate" type="date" value="${todayISO()}"></label>
        <label><span>Fecha vencimiento pago</span><input name="dueDate" type="date"></label>
        <label><span>Estado</span><select name="status"><option value="pending">Pendiente</option><option value="paid">Pagada</option><option value="observed">Observada</option></select></label>
        <label class="tnd-formgrid__full"><span>Notas</span><textarea name="notes" maxlength="900" rows="3"></textarea></label>
        <label class="tnd-formgrid__full"><span>Adjuntos</span><input name="attachments" type="file" multiple accept="${ATTACHMENT_ACCEPT}"></label>
    </div>`;
    const backdrop = dialogShell("Agregar factura", body, `
        <button class="secondary-button" type="button" data-dialog-cancel>Cancelar</button>
        <button class="primary-button" type="submit">Guardar factura</button>
    `, "data-tender-invoice-form");

    backdrop.querySelector("form").onsubmit = event => {
        event.preventDefault();
        void saveInvoiceFromForm(event.currentTarget, tender, backdrop);
    };
}

async function saveInvoiceFromForm(form, tender, backdrop) {
    if (busy) return;
    busy = true;
    try {
        const data = Object.fromEntries(new FormData(form).entries());
        const invoiceId = makeId("tender_invoice");
        const attachments = form.elements.attachments?.files?.length
            ? await readAttachmentFiles(form.elements.attachments.files, {
                moduleId: "tenders",
                ownerId: tender.id,
                recordId: invoiceId
            })
            : [];
        const invoice = normalizeInvoice({
            id: invoiceId,
            ...data,
            attachments: attachments.map(file => ({ ...file, docType: "invoice" }))
        });
        updateTender(tender.id, item => ({ ...item, invoices: [...item.invoices, invoice] }));
        backdrop.remove();
        ui.tab = "facturas";
        renderTendersPanel();
    } catch (error) {
        await showAlert(attachmentStorageErrorMessage(error, "subir"), {
            title: "No se pudo guardar la factura",
            tone: "danger"
        });
    } finally {
        busy = false;
    }
}

function openIncidentDialog(tender) {
    const body = `<div class="tnd-formgrid">
        <label><span>Tipo</span><select name="type">${selectOptions(INCIDENT_TYPES, "breach")}</select></label>
        <label><span>Fecha</span><input name="date" type="date" value="${todayISO()}"></label>
        <label class="tnd-formgrid__full"><span>Titulo</span><input name="title" maxlength="160" required></label>
        <label><span>Monto asociado</span><input name="amount" inputmode="numeric"></label>
        <label><span>Responsable</span><input name="responsible" maxlength="160" value="${attr(currentUserName())}"></label>
        <label class="tnd-formgrid__full"><span>Detalle</span><textarea name="detail" maxlength="${MAX_LONG_TEXT}" rows="4"></textarea></label>
        <label class="tnd-formgrid__full"><span>Adjuntos</span><input name="attachments" type="file" multiple accept="${ATTACHMENT_ACCEPT}"></label>
    </div>`;
    const backdrop = dialogShell("Agregar incidencia", body, `
        <button class="secondary-button" type="button" data-dialog-cancel>Cancelar</button>
        <button class="primary-button" type="submit">Guardar incidencia</button>
    `, "data-tender-incident-form");

    backdrop.querySelector("form").onsubmit = event => {
        event.preventDefault();
        void saveIncidentFromForm(event.currentTarget, tender, backdrop);
    };
}

async function saveIncidentFromForm(form, tender, backdrop) {
    if (busy) return;
    busy = true;
    try {
        const data = Object.fromEntries(new FormData(form).entries());
        const incidentId = makeId("tender_incident");
        const attachments = form.elements.attachments?.files?.length
            ? await readAttachmentFiles(form.elements.attachments.files, {
                moduleId: "tenders",
                ownerId: tender.id,
                recordId: incidentId
            })
            : [];
        const incident = normalizeIncident({
            id: incidentId,
            ...data,
            attachments
        });
        updateTender(tender.id, item => ({ ...item, incidents: [...item.incidents, incident] }));
        backdrop.remove();
        ui.tab = "incidencias";
        renderTendersPanel();
    } catch (error) {
        await showAlert(attachmentStorageErrorMessage(error, "subir"), {
            title: "No se pudo guardar la incidencia",
            tone: "danger"
        });
    } finally {
        busy = false;
    }
}

function openExtensionDialog(tender) {
    const body = `<div class="tnd-formgrid">
        <label><span>Desde</span><input name="from" type="date" value="${attr(tender.endDate ? addDaysISO(tender.endDate, 1) : "")}"></label>
        <label><span>Hasta</span><input name="to" type="date"></label>
        <label><span>Resolucion</span><input name="resolution" maxlength="180"></label>
        <label><span>Monto adicional</span><input name="amount" inputmode="numeric"></label>
        <label class="tnd-formgrid__full"><span>Motivo</span><textarea name="reason" maxlength="${MAX_LONG_TEXT}" rows="4"></textarea></label>
        <label class="tnd-formgrid__full"><span>Adjuntos</span><input name="attachments" type="file" multiple accept="${ATTACHMENT_ACCEPT}"></label>
    </div>`;
    const backdrop = dialogShell("Agregar prorroga", body, `
        <button class="secondary-button" type="button" data-dialog-cancel>Cancelar</button>
        <button class="primary-button" type="submit">Guardar prorroga</button>
    `, "data-tender-extension-form");

    backdrop.querySelector("form").onsubmit = event => {
        event.preventDefault();
        void saveExtensionFromForm(event.currentTarget, tender, backdrop);
    };
}

async function saveExtensionFromForm(form, tender, backdrop) {
    if (busy) return;
    busy = true;
    try {
        const data = Object.fromEntries(new FormData(form).entries());
        const extensionId = makeId("tender_extension");
        const attachments = form.elements.attachments?.files?.length
            ? await readAttachmentFiles(form.elements.attachments.files, {
                moduleId: "tenders",
                ownerId: tender.id,
                recordId: extensionId
            })
            : [];
        const extension = normalizeExtension({
            id: extensionId,
            ...data,
            attachments
        });
        updateTender(tender.id, item => ({
            ...item,
            endDate: extension.to || item.endDate,
            amount: item.amount + amountNumber(extension.amount),
            extensions: [...item.extensions, extension]
        }));
        backdrop.remove();
        ui.tab = "incidencias";
        renderTendersPanel();
    } catch (error) {
        await showAlert(attachmentStorageErrorMessage(error, "subir"), {
            title: "No se pudo guardar la prorroga",
            tone: "danger"
        });
    } finally {
        busy = false;
    }
}

export function initTendersPanel() {
    if (panelBound || typeof window === "undefined") return;
    panelBound = true;
    window.addEventListener("proturnos:persistenceChanged", event => {
        const keys = event?.detail?.keys;
        if (Array.isArray(keys) && keys.length && !keys.includes(TENDERS_KEY)) return;
        renderSoon();
    });
    window.addEventListener("proturnos:workspacePermissionsChanged", renderSoon);
}
