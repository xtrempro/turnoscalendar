// UI de Planes y suscripcion (modal abierto desde el boton del topbar).
//
// Paso 2b: muestra los tiers, el uso autoritativo de la cuenta y el plan
// vigente. Todavia SIN pagos (el checkout con Webpay llega en la Fase 2): los
// botones de suscribir quedan como "disponible pronto" y el caso >150
// trabajadores abre un correo de cotizacion.

import { escapeHTML } from "./htmlUtils.js";
import {
    PLAN_CATALOG,
    QUOTE_EMAIL,
    formatCLP,
    getPlan,
    unitLimitLabel,
    workerLimitLabel
} from "./plans.js";
import {
    getCachedAccountUsage,
    getEffectivePlanId,
    refreshAccountUsage
} from "./subscription.js";

let activeBackdrop = null;

function closeModal() {
    if (activeBackdrop) {
        activeBackdrop.remove();
        activeBackdrop = null;
    }

    document.removeEventListener("keydown", onKeydown);
}

function onKeydown(event) {
    if (event.key === "Escape") closeModal();
}

function usageSummaryHTML(usage, effectivePlanId) {
    const plan = getPlan(effectivePlanId);

    if (!usage) {
        return `
            <p class="plans-usage plans-usage--muted">
                Inicia sesion en un entorno para ver el uso de tu cuenta.
            </p>
        `;
    }

    const workerLimit = workerLimitLabel(effectivePlanId);
    const unitLimit = unitLimitLabel(effectivePlanId);
    const periodEnd = usage.currentPeriodEnd
        ? new Date(usage.currentPeriodEnd).toLocaleDateString("es-CL", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        })
        : "";
    const expiryNote = usage.expired
        ? `<span class="plans-usage-flag plans-usage-flag--expired">Suscripcion vencida</span>`
        : periodEnd
            ? `<span class="plans-usage-flag">Vigente hasta ${escapeHTML(periodEnd)}</span>`
            : "";

    return `
        <div class="plans-usage">
            <div class="plans-usage-plan">
                <span>Tu plan</span>
                <strong>${escapeHTML(plan.name)}</strong>
                ${expiryNote}
            </div>
            <div class="plans-usage-metrics">
                <div>
                    <strong>${usage.activeWorkers} / ${escapeHTML(workerLimit)}</strong>
                    <span>Trabajadores activos</span>
                </div>
                <div>
                    <strong>${usage.entornos} / ${escapeHTML(unitLimit)}</strong>
                    <span>Entornos</span>
                </div>
            </div>
        </div>
    `;
}

function planCardHTML(plan, effectivePlanId) {
    const isCurrent = plan.id === effectivePlanId;
    const isFree = plan.id === "free";
    const features = [
        `Hasta <strong>${escapeHTML(workerLimitLabel(plan.id))}</strong> trabajadores activos`,
        `<strong>${escapeHTML(unitLimitLabel(plan.id))}</strong> ${plan.maxUnits === 1 ? "entorno" : "entornos"}`,
        plan.allowAttachments
            ? "Adjuntar archivos"
            : "Sin adjuntar archivos",
        plan.allowReportDownload
            ? "Descarga de reportes (PDF y Excel)"
            : "Sin descarga de reportes"
    ];

    const priceHTML = isFree
        ? `<div class="plan-card-price"><strong>Gratis</strong></div>`
        : `
            <div class="plan-card-price">
                <strong>${escapeHTML(formatCLP(plan.priceMonthly))}</strong>
                <span>/ mes</span>
            </div>
            <div class="plan-card-price-annual">
                o ${escapeHTML(formatCLP(plan.priceAnnual))} / año
            </div>
        `;

    const action = isCurrent
        ? `<div class="plan-card-current">Tu plan actual</div>`
        : isFree
            ? ""
            : `<button class="primary-button plan-card-cta" type="button" disabled title="Disponible al habilitar el pago en linea">Suscribirse (pronto)</button>`;

    return `
        <article class="plan-card ${isCurrent ? "is-current" : ""}">
            <header class="plan-card-head">
                <h4>${escapeHTML(plan.name)}</h4>
                ${isCurrent ? `<span class="plan-card-badge">Actual</span>` : ""}
            </header>
            ${priceHTML}
            <ul class="plan-card-features">
                ${features.map(item => `<li>${item}</li>`).join("")}
            </ul>
            ${action}
        </article>
    `;
}

function quoteRowHTML() {
    const subject = encodeURIComponent("Cotizacion TurnoPlus (mas de 150 trabajadores)");
    const body = encodeURIComponent(
        "Hola, necesito una cotizacion para mas de 150 trabajadores activos.\n\n" +
        "Cantidad aproximada de trabajadores:\n" +
        "Cantidad de entornos:\n" +
        "Institucion:\n"
    );

    return `
        <div class="plans-quote">
            <div>
                <strong>¿Mas de 150 trabajadores?</strong>
                <span>Te preparamos una cotizacion a medida.</span>
            </div>
            <a class="secondary-button" href="mailto:${escapeHTML(QUOTE_EMAIL)}?subject=${subject}&body=${body}">
                Solicitar cotizacion
            </a>
        </div>
    `;
}

function renderModalContent(usage) {
    const effectivePlanId = getEffectivePlanId();

    return `
        <div class="plans-dialog" role="dialog" aria-modal="true" aria-labelledby="plansDialogTitle">
            <header class="plans-dialog-head">
                <h3 id="plansDialogTitle">Planes y suscripcion</h3>
                <button class="icon-button plans-dialog-close" type="button" data-action="close" aria-label="Cerrar">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                        <line x1="6" y1="18" x2="18" y2="6"></line>
                    </svg>
                </button>
            </header>

            ${usageSummaryHTML(usage, effectivePlanId)}

            <div class="plans-grid">
                ${PLAN_CATALOG.map(plan => planCardHTML(plan, effectivePlanId)).join("")}
            </div>

            ${quoteRowHTML()}

            <p class="plans-footnote">
                La app del trabajador es siempre gratis. El pago en linea (Webpay) se
                habilita en la proxima etapa.
            </p>
        </div>
    `;
}

function paintModal(usage) {
    if (!activeBackdrop) return;
    activeBackdrop.innerHTML = renderModalContent(usage);
}

async function openPlansModal() {
    closeModal();

    activeBackdrop = document.createElement("div");
    activeBackdrop.className = "turn-change-dialog-backdrop plans-backdrop";
    document.body.appendChild(activeBackdrop);

    activeBackdrop.addEventListener("click", event => {
        if (event.target === activeBackdrop) {
            closeModal();
            return;
        }

        if (event.target?.closest?.("[data-action='close']")) {
            closeModal();
        }
    });

    document.addEventListener("keydown", onKeydown);

    // Pinta de inmediato con lo que haya en cache y refresca el uso autoritativo.
    paintModal(getCachedAccountUsage());

    const usage = await refreshAccountUsage({ force: true });

    // Si el modal sigue abierto, repinta con el dato fresco.
    if (activeBackdrop) paintModal(usage);
}

export function initPlansUI({ button } = {}) {
    if (!button) return;

    button.addEventListener("click", () => {
        openPlansModal();
    });
}
