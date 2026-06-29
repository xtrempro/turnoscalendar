// Estado de suscripcion de la cuenta (lado cliente).
//
// Lee el uso AUTORITATIVO desde la Cloud Function `getAccountUsage` (que suma
// los trabajadores activos de todos los entornos del dueño y entrega el plan
// vigente) y lo combina con el catalogo de planes (plans.js) para resolver
// limites y gating de funciones.
//
// La PWA del trabajador no usa este modulo: el cobro y los limites son de la
// cuenta del dueño en ProTurnos.

import {
    getCurrentFirebaseUser,
    getFirebaseServices
} from "./firebaseClient.js";
import {
    getPlan,
    isWithinUnitLimit,
    isWithinWorkerLimit,
    planAllowsAttachments,
    planAllowsReportDownload
} from "./plans.js";

const CACHE_TTL_MS = 60000;

// Admin(s) que pueden crear/gestionar cupones. Solo para mostrar la UI; la
// seguridad real la imponen las Cloud Functions. Gmail ignora puntos y +alias.
const ADMIN_EMAILS = ["desarrolladorfs@gmail.com"];

let cachedUsage = null;
let usageFetchedAt = 0;
let inFlight = null;

function normalizeEmailForAdmin(email) {
    const clean = String(email || "").trim().toLowerCase();
    const at = clean.indexOf("@");

    if (at < 0) return clean;

    let local = clean.slice(0, at);
    const domain = clean.slice(at + 1);

    if (domain === "gmail.com" || domain === "googlemail.com") {
        local = local.replace(/\./g, "").split("+")[0];
        return `${local}@gmail.com`;
    }

    return clean;
}

async function callFunction(name, payload = {}) {
    const { functions, functionsModule } = await getFirebaseServices();
    const callable = functionsModule.httpsCallable(functions, name);
    const result = await callable(payload);

    return result?.data || {};
}

function normalizeUsage(data = {}) {
    return {
        plan: typeof data.plan === "string" ? data.plan : "free",
        effectivePlan:
            typeof data.effectivePlan === "string"
                ? data.effectivePlan
                : "free",
        period: data.period === "annual" || data.period === "monthly"
            ? data.period
            : null,
        currentPeriodEnd: Number(data.currentPeriodEnd) || null,
        source: typeof data.source === "string" ? data.source : null,
        couponCode: typeof data.couponCode === "string" ? data.couponCode : null,
        pendingDiscount:
            data.pendingDiscount && typeof data.pendingDiscount === "object"
                ? data.pendingDiscount
                : null,
        expired: Boolean(data.expired),
        activeWorkers: Number(data.activeWorkers) || 0,
        entornos: Number(data.entornos) || 0,
        generatedAt: Number(data.generatedAt) || Date.now()
    };
}

// Devuelve el ultimo uso conocido sin disparar una nueva consulta.
export function getCachedAccountUsage() {
    return cachedUsage;
}

// Consulta el uso autoritativo. Usa cache de CACHE_TTL_MS salvo `force`.
// Nunca lanza: ante error conserva el ultimo valor conocido.
export async function refreshAccountUsage({ force = false } = {}) {
    if (!getCurrentFirebaseUser()) {
        cachedUsage = null;
        usageFetchedAt = 0;
        return null;
    }

    if (
        !force &&
        cachedUsage &&
        Date.now() - usageFetchedAt < CACHE_TTL_MS
    ) {
        return cachedUsage;
    }

    if (inFlight) return inFlight;

    inFlight = (async () => {
        try {
            const { functions, functionsModule } = await getFirebaseServices();
            const callable = functionsModule.httpsCallable(
                functions,
                "getAccountUsage"
            );
            const result = await callable({});

            cachedUsage = normalizeUsage(result?.data || {});
            usageFetchedAt = Date.now();
            return cachedUsage;
        } catch (error) {
            console.warn("No se pudo obtener el uso de la cuenta.", error);
            return cachedUsage;
        } finally {
            inFlight = null;
        }
    })();

    return inFlight;
}

export function clearAccountUsageCache() {
    cachedUsage = null;
    usageFetchedAt = 0;
    inFlight = null;
}

// ----- Plan efectivo y gating -----

// Id del plan vigente (free si no hay datos o la suscripcion esta vencida).
export function getEffectivePlanId() {
    return cachedUsage?.effectivePlan || "free";
}

export function getEffectivePlan() {
    return getPlan(getEffectivePlanId());
}

export function planIsExpired() {
    return Boolean(cachedUsage?.expired);
}

export function canUseAttachments() {
    return planAllowsAttachments(getEffectivePlanId());
}

export function canDownloadReports() {
    return planAllowsReportDownload(getEffectivePlanId());
}

// true si todavia se puede tener un trabajador activo mas (conteo autoritativo
// + 1). Sin datos cargados aun, no bloquea (se revalida al refrescar el uso).
export function canAddActiveWorker() {
    if (!cachedUsage) return true;
    return isWithinWorkerLimit(
        getEffectivePlanId(),
        cachedUsage.activeWorkers + 1
    );
}

export function canAddUnit() {
    if (!cachedUsage) return true;
    return isWithinUnitLimit(getEffectivePlanId(), cachedUsage.entornos + 1);
}

export function getPendingDiscount() {
    return cachedUsage?.pendingDiscount || null;
}

// ----- Cupones -----

// Solo para visibilidad de UI; la seguridad la imponen las Cloud Functions.
export function isAdminUser() {
    const email = getCurrentFirebaseUser()?.email;

    if (!email) return false;

    const normalized = normalizeEmailForAdmin(email);

    return ADMIN_EMAILS.some(
        (adminEmail) => normalizeEmailForAdmin(adminEmail) === normalized
    );
}

// Canjea un cupon (cualquier dueno). Lanza con el mensaje del servidor si falla;
// al exito refresca el uso para reflejar el nuevo plan/descuento.
export async function redeemCoupon(code) {
    const data = await callFunction("redeemCoupon", {
        code: String(code || "").trim().toUpperCase()
    });

    clearAccountUsageCache();
    await refreshAccountUsage({ force: true });

    return data;
}

// Admin: crear / listar / activar-desactivar cupones.
export async function createCoupon(input = {}) {
    return callFunction("createCoupon", input);
}

export async function listCoupons() {
    const data = await callFunction("listCoupons");
    return Array.isArray(data.coupons) ? data.coupons : [];
}

export async function setCouponActive(code, active) {
    return callFunction("setCouponActive", {
        code: String(code || "").trim().toUpperCase(),
        active: Boolean(active)
    });
}
