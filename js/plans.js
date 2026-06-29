// Catalogo central de planes de suscripcion de TurnoPlus.
//
// Modulo SIN dependencias (solo constantes + helpers puros) para que lo puedan
// importar la UI de Planes, el gating de funciones, el checkout (Webpay /
// MercadoPago) y los cupones, sin acoplarse a Firestore ni a localStorage.
//
// Reglas de negocio confirmadas:
//  - La PWA del trabajador es siempre gratis; el cobro vive en la cuenta del
//    dueño (ownerUid) en ProTurnos y cubre todos sus entornos.
//  - El tope de "trabajadores activos" se cuenta como el TOTAL sumando todos los
//    entornos de la cuenta (los perfiles desactivados no cuentan).
//  - Precio mensual = precio anual / 10 (pagar el año = 2 meses de descuento).

// Relacion precio anual -> mensual (anual dividido por esta cantidad de meses).
export const ANNUAL_TO_MONTHLY_DIVISOR = 10;

// Correo para "Solicitar cotizacion" (>150 trabajadores).
// Nota: Gmail ignora los puntos, por lo que desarrollador.fs@gmail.com y
// desarrolladorfs@gmail.com llegan a la misma bandeja.
export const QUOTE_EMAIL = "desarrolladorfs@gmail.com";

// Sentinela de "ilimitado" para topes sin limite (entornos del Plan 3).
export const UNLIMITED = Infinity;

// Catalogo de planes en orden ascendente. `maxUnits`/`maxActiveWorkers` usan
// UNLIMITED cuando no hay tope. Los precios estan en CLP (entero, sin decimales).
export const PLAN_CATALOG = [
    {
        id: "free",
        name: "Gratis",
        rank: 0,
        maxActiveWorkers: 10,
        maxUnits: 1,
        priceAnnual: 0,
        priceMonthly: 0,
        allowAttachments: false,
        allowReportDownload: false
    },
    {
        id: "p1",
        name: "Plan 1",
        rank: 1,
        maxActiveWorkers: 30,
        maxUnits: 1,
        priceAnnual: 360000,
        priceMonthly: 36000,
        allowAttachments: true,
        allowReportDownload: true
    },
    {
        id: "p2",
        name: "Plan 2",
        rank: 2,
        maxActiveWorkers: 80,
        maxUnits: 2,
        priceAnnual: 890000,
        priceMonthly: 89000,
        allowAttachments: true,
        allowReportDownload: true
    },
    {
        id: "p3",
        name: "Plan 3",
        rank: 3,
        maxActiveWorkers: 150,
        maxUnits: UNLIMITED,
        priceAnnual: 1500000,
        priceMonthly: 150000,
        allowAttachments: true,
        allowReportDownload: true
    }
];

export const FREE_PLAN_ID = "free";
export const DEFAULT_PLAN_ID = FREE_PLAN_ID;
export const PERIODS = ["monthly", "annual"];

// Plan interno (NO se muestra como tier comprable) para cuentas heredadas al
// activar el gating: sin limites y con todas las funciones. Se asigna a las
// cuentas existentes (grandfathering) para no caparlas; al vencer la gracia
// vuelven a "free".
export const GRANDFATHERED_PLAN_ID = "grandfathered";
export const GRANDFATHERED_PLAN = {
    id: GRANDFATHERED_PLAN_ID,
    name: "Heredado",
    rank: 99,
    maxActiveWorkers: UNLIMITED,
    maxUnits: UNLIMITED,
    priceAnnual: 0,
    priceMonthly: 0,
    allowAttachments: true,
    allowReportDownload: true
};

// PLAN_CATALOG se mantiene como la lista mostrable; el plan heredado se incluye
// solo para resolver limites/gating, no para la UI de tiers.
const PLAN_BY_ID = new Map(
    [...PLAN_CATALOG, GRANDFATHERED_PLAN].map(plan => [plan.id, plan])
);

// Devuelve el plan por id; cae al plan gratis si el id es desconocido.
export function getPlan(planId) {
    return PLAN_BY_ID.get(String(planId || "")) || PLAN_BY_ID.get(FREE_PLAN_ID);
}

export function getPaidPlans() {
    return PLAN_CATALOG.filter(plan => plan.id !== FREE_PLAN_ID);
}

export function isUnlimited(value) {
    return value === UNLIMITED || value === Infinity;
}

// Precio segun periodo ("monthly" | "annual"). Devuelve CLP entero.
export function priceFor(planId, period) {
    const plan = getPlan(planId);
    return period === "annual" ? plan.priceAnnual : plan.priceMonthly;
}

// Formatea un monto CLP como "$360.000" (separador de miles con punto, es-CL).
export function formatCLP(amount) {
    const value = Math.round(Number(amount) || 0);
    return `$${value.toLocaleString("es-CL")}`;
}

// ----- Chequeos de limite -----

// true si la cantidad de trabajadores activos (total entre todos los entornos)
// esta dentro del tope del plan.
export function isWithinWorkerLimit(planId, activeWorkerCount) {
    const plan = getPlan(planId);
    if (isUnlimited(plan.maxActiveWorkers)) return true;
    return Number(activeWorkerCount || 0) <= plan.maxActiveWorkers;
}

// true si la cantidad de entornos esta dentro del tope del plan.
export function isWithinUnitLimit(planId, unitCount) {
    const plan = getPlan(planId);
    if (isUnlimited(plan.maxUnits)) return true;
    return Number(unitCount || 0) <= plan.maxUnits;
}

export function planAllowsAttachments(planId) {
    return Boolean(getPlan(planId).allowAttachments);
}

export function planAllowsReportDownload(planId) {
    return Boolean(getPlan(planId).allowReportDownload);
}

// Etiqueta legible del tope de trabajadores ("10", "150" o "Ilimitados").
export function workerLimitLabel(planId) {
    const plan = getPlan(planId);
    return isUnlimited(plan.maxActiveWorkers)
        ? "Ilimitados"
        : String(plan.maxActiveWorkers);
}

// Etiqueta legible del tope de entornos ("1", "2" o "Ilimitados").
export function unitLimitLabel(planId) {
    const plan = getPlan(planId);
    return isUnlimited(plan.maxUnits) ? "Ilimitados" : String(plan.maxUnits);
}

// El plan mas economico que cubre la cantidad pedida de trabajadores y entornos.
// Devuelve null si ningun plan alcanza (caso ">150": va a cotizacion).
export function smallestPlanFor(activeWorkerCount, unitCount) {
    return (
        PLAN_CATALOG.find(plan =>
            isWithinWorkerLimit(plan.id, activeWorkerCount) &&
            isWithinUnitLimit(plan.id, unitCount)
        ) || null
    );
}
