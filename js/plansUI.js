// UI de Planes y suscripcion (modal abierto desde el boton del topbar).
//
// Muestra los tiers, el uso autoritativo de la cuenta y el plan vigente; permite
// canjear cupones (cualquier dueno) y, si el usuario es admin, crear y gestionar
// cupones. El pago en linea (Webpay) llega en la Fase 2.

import { escapeHTML } from "./htmlUtils.js";
import {
    PLAN_CATALOG,
    QUOTE_EMAIL,
    formatCLP,
    getPaidPlans,
    getPlan,
    unitLimitLabel,
    workerLimitLabel
} from "./plans.js";
import {
    createCoupon,
    createWebpayTransaction,
    getCachedAccountUsage,
    getEffectivePlanId,
    getPendingDiscount,
    isAdminUser,
    listCoupons,
    redeemCoupon,
    redirectToWebpay,
    refreshAccountUsage,
    setCouponActive
} from "./subscription.js";

let activeBackdrop = null;
let couponsCache = [];

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

function formatDateMs(ms) {
    if (!ms) return "";

    return new Date(ms).toLocaleDateString("es-CL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    });
}

function usageSummaryHTML(usage, effectivePlanId) {
    const plan = getPlan(effectivePlanId);

    if (!usage) {
        return `
            <p class="plans-usage plans-usage--muted">
                Inicia sesion en una unidad para ver el uso de tu cuenta.
            </p>
        `;
    }

    const periodEnd = formatDateMs(usage.currentPeriodEnd);
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
                    <strong>${usage.activeWorkers} / ${escapeHTML(workerLimitLabel(effectivePlanId))}</strong>
                    <span>Trabajadores activos</span>
                </div>
                <div>
                    <strong>${usage.entornos} / ${escapeHTML(unitLimitLabel(effectivePlanId))}</strong>
                    <span>Unidades</span>
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
        `<strong>${escapeHTML(unitLimitLabel(plan.id))}</strong> ${plan.maxUnits === 1 ? "unidad" : "unidades"}`,
        plan.allowAttachments ? "Adjuntar archivos" : "Sin adjuntar archivos",
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
            : `
                <div class="plan-card-cta-row">
                    <button class="primary-button" type="button" data-action="subscribe" data-plan="${plan.id}" data-period="monthly">Pagar mensual</button>
                    <button class="secondary-button" type="button" data-action="subscribe" data-plan="${plan.id}" data-period="annual">Pagar anual</button>
                </div>
                <p class="plan-card-status" data-subscribe-status="${plan.id}"></p>`;

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

function redeemRowHTML(usage) {
    const discount = getPendingDiscount();
    const discountNote = discount
        ? `<p class="plans-coupon-note">Tienes un descuento guardado (cupon ${escapeHTML(discount.code)}) que se aplicara al suscribirte.</p>`
        : "";

    return `
        <div class="plans-coupon">
            <label for="couponCodeInput"><strong>¿Tienes un cupon?</strong></label>
            <div class="plans-coupon-row">
                <input id="couponCodeInput" type="text" autocomplete="off" placeholder="CODIGO" ${usage ? "" : "disabled"}>
                <button class="secondary-button" type="button" data-action="redeem-coupon" ${usage ? "" : "disabled"}>Aplicar cupon</button>
            </div>
            <p class="plans-coupon-status" data-coupon-status></p>
            ${discountNote}
        </div>
    `;
}

function quoteRowHTML() {
    const subject = encodeURIComponent("Cotizacion TurnoPlus (mas de 150 trabajadores)");
    const body = encodeURIComponent(
        "Hola, necesito una cotizacion para mas de 150 trabajadores activos.\n\n" +
        "Cantidad aproximada de trabajadores:\n" +
        "Cantidad de unidades:\n" +
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

function couponRowHTML(coupon) {
    const detail = coupon.type === "access"
        ? `Acceso ${escapeHTML(getPlan(coupon.plan).name)} · ${coupon.durationDays} dias`
        : coupon.percentOff > 0
            ? `Descuento ${coupon.percentOff}%`
            : `Descuento ${escapeHTML(formatCLP(coupon.amountOff))}`;
    const uses = coupon.maxRedemptions > 0
        ? `${coupon.redemptionsCount}/${coupon.maxRedemptions}`
        : `${coupon.redemptionsCount}/∞`;
    const expiry = coupon.expiresAt ? `vence ${escapeHTML(formatDateMs(coupon.expiresAt))}` : "sin vencimiento";

    return `
        <article class="coupon-row ${coupon.active ? "" : "is-inactive"}">
            <div class="coupon-row-main">
                <strong>${escapeHTML(coupon.code)}</strong>
                <span>${detail} · usos ${uses} · ${expiry}</span>
            </div>
            <button class="secondary-button secondary-button--small" type="button" data-action="toggle-coupon" data-coupon-code="${escapeHTML(coupon.code)}" data-coupon-active="${coupon.active ? "false" : "true"}">
                ${coupon.active ? "Desactivar" : "Activar"}
            </button>
        </article>
    `;
}

function adminSectionHTML() {
    const planOptions = getPaidPlans()
        .map(plan => `<option value="${plan.id}">${escapeHTML(plan.name)}</option>`)
        .join("");

    return `
        <details class="plans-admin" open>
            <summary>Administrar cupones (admin)</summary>

            <div class="plans-admin-form">
                <div class="plans-admin-grid">
                    <label>Tipo
                        <select id="couponType">
                            <option value="access">Acceso a plan</option>
                            <option value="discount">Descuento</option>
                        </select>
                    </label>
                    <label>Plan
                        <select id="couponPlan">${planOptions}</select>
                    </label>
                    <label>Dias de acceso
                        <input id="couponDuration" type="number" min="0" value="30">
                    </label>
                    <label>% descuento
                        <input id="couponPercent" type="number" min="0" max="100" value="0">
                    </label>
                    <label>Monto descuento (CLP)
                        <input id="couponAmount" type="number" min="0" value="0">
                    </label>
                    <label>Usos maximos (0 = ilimitado)
                        <input id="couponMax" type="number" min="0" value="1">
                    </label>
                    <label>Vence en (dias, 0 = nunca)
                        <input id="couponExpires" type="number" min="0" value="0">
                    </label>
                    <label>Codigo (opcional)
                        <input id="couponCode" type="text" autocomplete="off" placeholder="Auto">
                    </label>
                </div>
                <button class="primary-button" type="button" data-action="create-coupon">Crear cupon</button>
                <p class="plans-coupon-status" data-admin-status></p>
            </div>

            <div class="plans-admin-list">
                ${couponsCache.length
                    ? couponsCache.map(couponRowHTML).join("")
                    : `<p class="plans-coupon-note">Aun no hay cupones.</p>`}
            </div>
        </details>
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

            ${redeemRowHTML(usage)}

            ${quoteRowHTML()}

            ${isAdminUser() ? adminSectionHTML() : ""}

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

function setStatus(selector, message, isError) {
    const el = activeBackdrop?.querySelector(selector);
    if (!el) return;

    el.textContent = message || "";
    el.classList.toggle("is-error", Boolean(isError));
    el.classList.toggle("is-ok", Boolean(message) && !isError);
}

async function handleRedeem(button) {
    const input = activeBackdrop?.querySelector("#couponCodeInput");
    const code = String(input?.value || "").trim();

    if (!code) {
        setStatus("[data-coupon-status]", "Ingresa un codigo.", true);
        return;
    }

    button.disabled = true;
    setStatus("[data-coupon-status]", "Aplicando cupon...", false);

    try {
        const result = await redeemCoupon(code);
        const message = result.type === "discount"
            ? "Descuento aplicado. Se usara al suscribirte."
            : `Cupon aplicado: ${getPlan(result.plan).name}.`;

        // Repinta con el uso ya refrescado (refleja el nuevo plan/descuento).
        paintModal(getCachedAccountUsage());
        setStatus("[data-coupon-status]", message, false);
    } catch (error) {
        setStatus(
            "[data-coupon-status]",
            error?.message || "No se pudo aplicar el cupon.",
            true
        );
        button.disabled = false;
    }
}

async function handleCreateCoupon(button) {
    const value = id => activeBackdrop?.querySelector(id)?.value;
    const input = {
        type: value("#couponType"),
        plan: value("#couponPlan"),
        durationDays: Number(value("#couponDuration")) || 0,
        percentOff: Number(value("#couponPercent")) || 0,
        amountOff: Number(value("#couponAmount")) || 0,
        maxRedemptions: Number(value("#couponMax")) || 0,
        expiresInDays: Number(value("#couponExpires")) || 0,
        code: value("#couponCode") || ""
    };

    button.disabled = true;
    setStatus("[data-admin-status]", "Creando cupon...", false);

    try {
        const result = await createCoupon(input);
        couponsCache = await listCoupons();
        paintModal(getCachedAccountUsage());
        setStatus("[data-admin-status]", `Cupon creado: ${result.code}`, false);
    } catch (error) {
        setStatus(
            "[data-admin-status]",
            error?.message || "No se pudo crear el cupon.",
            true
        );
        button.disabled = false;
    }
}

async function handleToggleCoupon(button) {
    const code = button.dataset.couponCode;
    const active = button.dataset.couponActive === "true";

    button.disabled = true;

    try {
        await setCouponActive(code, active);
        couponsCache = await listCoupons();
        paintModal(getCachedAccountUsage());
    } catch (error) {
        setStatus("[data-admin-status]", error?.message || "No se pudo actualizar el cupon.", true);
        button.disabled = false;
    }
}

async function handleSubscribe(button) {
    const plan = button.dataset.plan;
    const period = button.dataset.period;
    const statusSel = `[data-subscribe-status="${plan}"]`;

    activeBackdrop
        ?.querySelectorAll(`[data-action="subscribe"][data-plan="${plan}"]`)
        .forEach(btn => {
            btn.disabled = true;
        });
    setStatus(statusSel, "Redirigiendo a Webpay...", false);

    try {
        const { token, url } = await createWebpayTransaction(plan, period);

        if (!token || !url) {
            throw new Error("Respuesta de pago invalida.");
        }

        redirectToWebpay(url, token);
    } catch (error) {
        setStatus(statusSel, error?.message || "No se pudo iniciar el pago.", true);
        activeBackdrop
            ?.querySelectorAll(`[data-action="subscribe"][data-plan="${plan}"]`)
            .forEach(btn => {
                btn.disabled = false;
            });
    }
}

function onBackdropClick(event) {
    if (event.target === activeBackdrop) {
        closeModal();
        return;
    }

    const actionEl = event.target?.closest?.("[data-action]");
    const action = actionEl?.dataset?.action;

    if (action === "close") {
        closeModal();
    } else if (action === "redeem-coupon") {
        handleRedeem(actionEl);
    } else if (action === "create-coupon") {
        handleCreateCoupon(actionEl);
    } else if (action === "toggle-coupon") {
        handleToggleCoupon(actionEl);
    } else if (action === "subscribe") {
        handleSubscribe(actionEl);
    }
}

async function openPlansModal() {
    closeModal();
    couponsCache = [];

    activeBackdrop = document.createElement("div");
    activeBackdrop.className = "turn-change-dialog-backdrop plans-backdrop";
    document.body.appendChild(activeBackdrop);

    activeBackdrop.addEventListener("click", onBackdropClick);
    document.addEventListener("keydown", onKeydown);

    // Pinta de inmediato con lo que haya en cache y refresca el uso autoritativo.
    paintModal(getCachedAccountUsage());

    const usage = await refreshAccountUsage({ force: true });
    if (activeBackdrop) paintModal(usage);

    // Carga la lista de cupones solo para admins, luego repinta.
    if (isAdminUser()) {
        try {
            couponsCache = await listCoupons();
            if (activeBackdrop) paintModal(getCachedAccountUsage());
        } catch (error) {
            console.warn("No se pudieron cargar los cupones.", error);
        }
    }
}

export function initPlansUI({ button } = {}) {
    if (!button) return;

    button.addEventListener("click", () => {
        openPlansModal();
    });
}
