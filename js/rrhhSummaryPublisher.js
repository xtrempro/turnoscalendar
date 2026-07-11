// ============================================================================
//  rrhhSummaryPublisher.js  —  va en turnoplus.cl (ProTurnos/js/)  [v4.1]
// ============================================================================
//
//  Publica un RESUMEN mensual pequeño por unidad para el Dashboard RRHH:
//     workspaces/{id}/rrhhSummaries/{YYYY-MM}
//
//  Reutiliza los motores REALES de la app (hoursEngine, staffing) en el
//  navegador, en segundo plano y en tiempo ocioso. A la nube solo viaja el doc
//  chico. Impacto en turnoplus.cl: mínimo (evento persistenceChanged + idle +
//  throttle 5 min + solo escribe si hubo cambios).
//
//  Costo de préstamos entre unidades (imputación origen→host):
//   - La unidad ORIGEN calcula el costo HHEE de cada turno que presta (tiene el
//     grado real del trabajador), lo DESCUENTA de su propio gasto y llama a la
//     Cloud Function attributeInterUnitCost para atribuirlo al host.
//   - La unidad HOST lee ese costo atribuido (de sus loanAssignments) y lo SUMA
//     a su propio gasto HHEE. Así el gasto se imputa donde se realiza el
//     reemplazo, aunque el reporte de horas lo emita el origen.
//
//  Supuesto acordado: cobertura estimada en horas (HORAS_POR_TURNO). El costo del
//  préstamo usa la fórmula estándar HHEE: horas × factor(1.25 diurno / 1.5 noche)
//  × valor hora del grado.
// ============================================================================

import { getFirebaseServices } from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";
import {
    getProfiles, getProfileData, getReplacements, isProfileActive, getGradeHourValue
} from "./storage.js";
import { calcularHorasMesPerfil } from "./hoursEngine.js";
import { analizarMes } from "./staffing.js";
import { fetchHolidays } from "./holidays.js";
import { isReplacementProfile, isReplacementContractType, isHonorariaContractType } from "./contracts.js";

const HORAS_POR_TURNO = 12;
const MIN_INTERVAL_MS = 5 * 60 * 1000;
const ESTAMENTOS = ["Profesional", "Técnico", "Administrativo", "Auxiliar"];
const INTER_UNIT_SOURCE = "inter_unit_loan";

// --------------------------------------------------------------- utilidades
const holidayCache = new Map();
async function holidaysForYear(year) {
    if (!holidayCache.has(year)) {
        try { holidayCache.set(year, await fetchHolidays(year)); } catch { holidayCache.set(year, []); }
    }
    return holidayCache.get(year);
}
function monthKey(year, month0) { return `${year}-${String(month0 + 1).padStart(2, "0")}`; }
function roleLabel(estamento) {
    const n = String(estamento || "").toLowerCase().normalize("NFD")
        .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
    if (n.includes("profesional")) return "Profesional";
    if (n.includes("tecnico") || n.includes("cnico")) return "Técnico";
    if (n.includes("auxiliar")) return "Auxiliar";
    if (n.includes("administrativo")) return "Administrativo";
    return "";
}
function parseISODateMonth(v) {
    const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? { year: Number(m[1]), month0: Number(m[2]) - 1 } : null;
}
function turnFactor(turnCode) { return /noche/i.test(String(turnCode || "")) ? 1.5 : 1.25; }
function idleYield() {
    return new Promise((resolve) => {
        if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout: 500 });
        else setTimeout(resolve, 0);
    });
}
const zeroEst = () => Object.fromEntries(ESTAMENTOS.map((e) => [e, 0]));

// ------------------------------------------------------------ cálculo (fiel)
function profileStats(profile, year, month0, days, holidays) {
    return calcularHorasMesPerfil(profile.name, year, month0, days, holidays,
        getProfileData(profile.name), {}, { d: 0, n: 0 });
}
function hheeCost(stats) {
    return Math.max(0, Number(stats.paymentDiurno) || 0) + Math.max(0, Number(stats.paymentNocturno) || 0);
}
function workedHours(stats) { return (Number(stats.totalD) || 0) + (Number(stats.totalN) || 0); }
function countMissingStaffingShifts(analysis) {
    return (Array.isArray(analysis) ? analysis : []).reduce((sum, day) =>
        sum + (day.detalle || []).filter((d) => d.tipo === "faltante" || d.tipo === "noche")
            .reduce((s, d) => s + Math.max(0, Number(d.cantidad) || 0), 0), 0);
}

// Turnos de cobertura del mes en ESTA unidad (host). Excluye manuales y présta-
// mos que ESTA unidad presta hacia afuera (esos cubren otra unidad).
function coverageShifts(year, month0, activeId) {
    const byName = new Map(getProfiles().map((p) => [String(p.name), p]));
    const out = { contrata: 0, planta: 0, reemplazo: 0, otro: 0, otroServicio: 0, manual: 0, covered: 0 };
    (getReplacements() || []).forEach((rep) => {
        if (!rep || rep.canceled) return;
        const when = parseISODateMonth(rep.date);
        if (!when || when.year !== year || when.month0 !== month0) return;

        if (rep.source === "manual_extra") { out.manual += 1; return; }

        if (rep.source === INTER_UNIT_SOURCE) {
            // Solo cuenta como cobertura recibida si ESTA unidad es el host.
            if (String(rep.hostWorkspaceId || "") === String(activeId || "")) { out.otroServicio += 1; out.covered += 1; }
            return;
        }

        const cover = byName.get(String(rep.worker || ""));
        const replaced = byName.get(String(rep.replaced || ""));
        const covEst = roleLabel(cover && cover.estamento);
        const repEst = roleLabel(replaced && replaced.estamento);
        out.covered += 1;
        if (covEst && repEst && covEst !== repEst) { out.otro += 1; return; }
        if (isReplacementProfile(String(rep.worker || "")) || (cover && isReplacementContractType(cover.contractType))) out.reemplazo += 1;
        else if (cover && String(cover.contractType || "").toLowerCase().includes("planta")) out.planta += 1;
        else out.contrata += 1;
    });
    return out;
}

// Préstamos que ESTA unidad presta hacia afuera (es la unidad ORIGEN). Calcula
// el costo HHEE con el grado real y devuelve el total, por estamento y por loan.
function loanOutCosts(year, month0, activeId) {
    const byName = new Map(getProfiles().map((p) => [String(p.name), p]));
    const res = { totalClp: 0, byEstamento: zeroEst(), perLoan: [] };
    (getReplacements() || []).forEach((rep) => {
        if (!rep || rep.canceled || rep.source !== INTER_UNIT_SOURCE) return;
        if (String(rep.workerWorkspaceId || "") !== String(activeId || "")) return; // no soy el origen
        const when = parseISODateMonth(rep.date);
        if (!when || when.year !== year || when.month0 !== month0) return;

        const worker = byName.get(String(rep.worker || ""));
        if (!worker) return;
        const est = roleLabel(worker.estamento);
        const valorHora = Number(getGradeHourValue(worker.estamento, worker.grade)) || 0;
        const cost = Math.round(HORAS_POR_TURNO * turnFactor(rep.turno) * valorHora);
        if (cost <= 0) return;

        res.totalClp += cost;
        if (est) res.byEstamento[est] += cost;
        const loanId = String(rep.interUnitLoanId || "");
        if (loanId) res.perLoan.push({ loanId, cost });
    });
    return res;
}

// Costos de préstamos que ESTA unidad RECIBE (es host), ya atribuidos por el
// origen a los docs loanAssignments (campo hheeCostClp). Lo lee de Firestore.
async function receivedLoanCosts(activeId, year, month0) {
    const res = { totalClp: 0, byEstamento: zeroEst() };
    try {
        const { db, firestoreModule } = await getFirebaseServices();
        const snap = await firestoreModule.getDocs(
            firestoreModule.collection(db, "workspaces", activeId, "loanAssignments"));
        snap.forEach((doc) => {
            const d = doc.data() || {};
            if (d.status !== "active") return;
            if (String(d.hostWorkspaceId || "") !== String(activeId || "")) return; // soy host
            const cost = Number(d.hheeCostClp) || 0;
            if (cost <= 0) return;
            const when = parseISODateMonth(d.date);
            if (!when || when.year !== year || when.month0 !== month0) return;
            res.totalClp += cost;
            const est = roleLabel(d.workerEstamento);
            if (est) res.byEstamento[est] += cost;
        });
    } catch (e) { console.warn("No se pudieron leer costos de préstamos recibidos.", e); }
    return res;
}

async function computeRrhhSummary(year, month0, activeId) {
    const days = new Date(year, month0 + 1, 0).getDate();
    const holidays = await holidaysForYear(year);

    const gastoPorEstamento = zeroEst();
    let hheeGastoClp = 0, honorariosClp = 0;

    const activos = getProfiles().filter((p) => p && isProfileActive(p));
    let i = 0;
    for (const profile of activos) {
        const stats = profileStats(profile, year, month0, days, holidays);
        const cost = hheeCost(stats);
        hheeGastoClp += cost;
        const label = roleLabel(profile.estamento);
        if (label) gastoPorEstamento[label] += cost;
        if (isHonorariaContractType(profile.contractType)) {
            honorariosClp += workedHours(stats) * (Number(profile.honorariaHourlyRate) || 0);
        }
        if (++i % 8 === 0) await idleYield();
    }

    // Préstamos prestados hacia afuera: descontar del origen.
    const out = loanOutCosts(year, month0, activeId);
    hheeGastoClp = Math.max(0, hheeGastoClp - out.totalClp);
    ESTAMENTOS.forEach((e) => { gastoPorEstamento[e] = Math.max(0, gastoPorEstamento[e] - out.byEstamento[e]); });

    // Préstamos recibidos: sumar al host el costo atribuido por el origen.
    const received = await receivedLoanCosts(activeId, year, month0);
    hheeGastoClp += received.totalClp;
    ESTAMENTOS.forEach((e) => { gastoPorEstamento[e] += received.byEstamento[e]; });

    const sinReemplazoTurnos = countMissingStaffingShifts(analizarMes(year, month0, holidays));
    const cov = coverageShifts(year, month0, activeId);
    const hheeManualClp = (cov.manual + cov.covered) > 0
        ? Math.round(hheeGastoClp * cov.manual / (cov.manual + cov.covered)) : 0;

    const summary = {
        month: monthKey(year, month0),
        hheeGastoClp: Math.round(hheeGastoClp),
        gastoPorEstamento: Object.fromEntries(ESTAMENTOS.map((e) => [e, Math.round(gastoPorEstamento[e])])),
        honorariosClp: Math.round(honorariosClp),
        hheeManualClp,
        contrata: cov.contrata * HORAS_POR_TURNO,
        planta: cov.planta * HORAS_POR_TURNO,
        reemplazo: cov.reemplazo * HORAS_POR_TURNO,
        otroEstamento: cov.otro * HORAS_POR_TURNO,
        otroServicio: cov.otroServicio * HORAS_POR_TURNO,
        sinReemplazo: sinReemplazoTurnos * HORAS_POR_TURNO,
        coverageUnit: "horas",
        horasPorTurno: HORAS_POR_TURNO
    };
    return { summary, loanOut: out };
}

// -------------------------------------------------------------- publicación
async function writeSummary(workspaceId, summary) {
    const { db, firestoreModule, auth } = await getFirebaseServices();
    const ref = firestoreModule.doc(db, "workspaces", workspaceId, "rrhhSummaries", summary.month);
    await firestoreModule.setDoc(ref, {
        ...summary,
        generatedAt: firestoreModule.serverTimestamp(),
        generatedByUid: (auth && auth.currentUser && auth.currentUser.uid) || null,
        source: "app"
    }, { merge: true });
}

async function attributeLoanCost(sourceWorkspaceId, loanId, hheeCostClp, month) {
    const { functions, functionsModule } = await getFirebaseServices();
    const callable = functionsModule.httpsCallable(functions, "attributeInterUnitCost");
    await callable({ sourceWorkspaceId, loanId, hheeCostClp, month });
}

export async function publishRrhhSummary(year, month0) {
    const workspace = getActiveWorkspace();
    if (!workspace || !workspace.id) return null;
    const { summary, loanOut } = await computeRrhhSummary(year, month0, workspace.id);
    await writeSummary(workspace.id, summary);
    // Atribuir el costo de cada préstamo prestado hacia afuera al host.
    for (const loan of loanOut.perLoan) {
        try { await attributeLoanCost(workspace.id, loan.loanId, loan.cost, summary.month); }
        catch (e) { console.warn("No se pudo atribuir costo de préstamo.", loan, e); }
    }
    return summary;
}

export async function publishRrhhSummaries({ monthsBack = 0 } = {}) {
    const now = new Date();
    const results = [];
    for (let i = 0; i <= monthsBack; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        try { results.push(await publishRrhhSummary(d.getFullYear(), d.getMonth())); }
        catch (e) { console.warn("No se pudo publicar resumen RRHH.", d, e); }
    }
    return results;
}

// ---------------------------------------------------- disparador en 2° plano
let dirty = true, lastRun = 0, running = false, started = false;
async function maybePublish() {
    if (running || !dirty || Date.now() - lastRun < MIN_INTERVAL_MS) return;
    const workspace = getActiveWorkspace();
    if (!workspace || !workspace.id) return;
    running = true;
    try {
        await idleYield();
        const now = new Date();
        await publishRrhhSummary(now.getFullYear(), now.getMonth());
        lastRun = Date.now(); dirty = false;
    } catch (e) { console.warn("Publicación RRHH en 2° plano falló; se reintentará.", e); }
    finally { running = false; }
}
export function startRrhhSummaryBackgroundPublisher() {
    if (started) return;
    started = true;
    window.addEventListener("proturnos:persistenceChanged", () => { dirty = true; });
    setInterval(() => { maybePublish(); }, 60 * 1000);
    setTimeout(() => { maybePublish(); }, 15 * 1000);
}
