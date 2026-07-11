"use strict";

// ============================================================================
//  getRrhhDashboard — Cloud Function (v2 callable) — contrato v4
// ============================================================================
//
//  Va en turnoplus.cl (ProTurnos/functions/). Ver functions-src/README.md.
//  Usa Admin SDK: no requiere cambios en firebase.rules ni afecta la app.
//
//  Devuelve el contrato que consume js/dataSource.js:
//    { source, generatedAt, units, headcount, estamentos, contratos,
//      dotacionMatrix, months, series, ranking, prolongadas, flags }
//
//  REAL (server-side, sin motores):
//    - dotación (matriz estamento×contrato) + headcount   [profiles]
//    - licencias común vs profesional por unidad/mes       [absences_ license / professional_license]
//    - prolongadas 720d (solo común)                       [absences_ license]
//    - devolución de horas                                 [hourReturns_]
//  VÍA RESUMEN publicado por la app (rrhhSummaries/{YYYY-MM}), si existe:
//    - gasto HHEE $, gasto por estamento, honorarios, HHEE motivo manual
//    - cobertura (contrata/planta/reemplazo/otro/sinReemplazo)
//  Lo que no tenga resumen queda en 0 y marcado "unavailable" en flags.
//  NO se inventan datos.
// ============================================================================

const admin = require("firebase-admin");
const { logger } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = "southamerica-west1";
const ENFORCE_APP_CHECK = true;
const MAX_MONTHS = 24;
const MAX_UNITS = 40;
const ESTAMENTOS = ["Profesional", "Técnico", "Administrativo", "Auxiliar"];
const CONTRATOS = ["Contrata", "Planta", "Reemplazo", "Honorarios"];
const LONG_LEAVE_WINDOW_DAYS = 720;
const LONG_LEAVE_MIN = 150; // umbral inferior para aparecer en el seguimiento
const CLP_M = 1e6;

// --------------------------------------------------------------- utilidades
function clampMonths(v) { return Math.min(Math.max(Math.round(Number(v) || 24), 1), MAX_MONTHS); }

function buildMonths(count) {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    const labels = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const months = [];
    for (let i = count - 1; i >= 0; i--) {
        const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
        months.push({
            key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
            label: `${labels[d.getMonth()]} ${d.getFullYear()}`,
            year: d.getFullYear(), month: d.getMonth() // 0-based
        });
    }
    return months;
}

function normalizeType(value) {
    const t = String(value || "").trim().toLowerCase().normalize("NFD")
        .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (t.includes("gremial")) return "union_leave";
    if (t === "medical_license") return "license";
    return t;
}
function absenceType(v) {
    if (!v) return "";
    if (typeof v === "string") return normalizeType(v);
    return normalizeType(v.type || v.kind || v.code || v.label || v.name);
}
function roleLabel(estamento) {
    const n = String(estamento || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
    if (n.includes("profesional")) return "Profesional";
    if (n.includes("tecnico") || n.includes("cnico")) return "Técnico";
    if (n.includes("auxiliar")) return "Auxiliar";
    if (n.includes("administrativo")) return "Administrativo";
    return "";
}
function contractBucket(contractType) {
    const n = String(contractType || "").toLowerCase();
    if (n.includes("planta")) return "Planta";
    if (n.includes("reempla")) return "Reemplazo";
    if (n.includes("honorar")) return "Honorarios";
    return "Contrata"; // Contrata, Otro o vacío → Contrata (fallback)
}
function parseStateKey(key) {
    const m = String(key || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    return { year: Number(m[1]), month0: Number(m[2]), day: Number(m[3]) };
}

async function readStateModule(workspaceId, moduleId) {
    const snap = await db.collection("workspaces").doc(workspaceId)
        .collection("stateModules").doc(moduleId).collection("chunks").get();
    if (snap.empty) return {};
    const text = snap.docs
        .map((d) => ({ index: Number(d.data().index) || 0, text: String(d.data().text || "") }))
        .sort((a, b) => a.index - b.index).map((c) => c.text).join("");
    try { return text ? JSON.parse(text) : {}; }
    catch (e) { logger.warn("stateModule inválido", { workspaceId, moduleId, message: e.message }); return {}; }
}

// ------------------------------------------------------- permisos / unidades
function canViewDashboard(member) {
    if (!member) return false;
    if (member.role === "owner") return true;
    const p = member.permissions || {};
    const view = (k) => p[k] && p[k].view === true;
    return view("dashboard") || view("hours") || view("turnos") || view("reports");
}
async function listAccessibleUnits(uid) {
    const memberships = await db.collection("users").doc(uid).collection("workspaces").get();
    const units = [];
    for (const md of memberships.docs.slice(0, MAX_UNITS)) {
        const workspaceId = md.id;
        const [wDoc, mDoc] = await Promise.all([
            db.collection("workspaces").doc(workspaceId).get(),
            db.collection("workspaces").doc(workspaceId).collection("members").doc(uid).get()
        ]);
        if (!wDoc.exists) continue;
        if (!canViewDashboard(mDoc.exists ? mDoc.data() : null)) continue;
        units.push({ id: workspaceId, name: String(wDoc.data().name || workspaceId) });
    }
    units.sort((a, b) => a.name.localeCompare(b.name, "es"));
    return units;
}

// --------------------------------------------------------- cálculo por unidad
function emptyMonth() {
    return {
        licenciasComun: 0, licenciasProfesional: 0,
        gastoUnidad: 0, gastoEstamento: ESTAMENTOS.map(() => 0),
        honorarios: 0, motivoManual: 0, devolucion: 0,
        contrata: 0, planta: 0, reemplazo: 0, otro: 0, otroServicio: 0, sinReemplazo: 0
    };
}

async function computeUnit(unit, months, monthKeyToIdx) {
    const [profileSnap, turnosSnap, hoursSnap, summaryDocs] = await Promise.all([
        readStateModule(unit.id, "profile"),
        readStateModule(unit.id, "turnos"),
        readStateModule(unit.id, "hours"),
        db.getAll(...months.map((m) =>
            db.collection("workspaces").doc(unit.id).collection("rrhhSummaries").doc(m.key)))
    ]);

    let profiles = [];
    try { profiles = JSON.parse(profileSnap.profiles || "[]"); } catch { profiles = []; }
    const activos = profiles.filter((p) => p && p.active !== false);

    // --- Dotación (matriz estamento × contrato) + headcount ---
    const dotacion = ESTAMENTOS.map(() => CONTRATOS.map(() => 0));
    activos.forEach((p) => {
        const ei = ESTAMENTOS.indexOf(roleLabel(p.estamento));
        if (ei < 0) return;
        const ci = CONTRATOS.indexOf(contractBucket(p.contractType));
        dotacion[ei][ci] += 1;
    });
    const headcount = activos.length;

    // --- Series por mes (init) ---
    const series = {};
    months.forEach((_, mi) => { series[mi] = emptyMonth(); });

    // --- Licencias común/profesional + ranking + prolongadas (recorre absences 1 vez) ---
    const rankingByMonth = {}; months.forEach((m) => { rankingByMonth[m.key] = new Map(); });
    const estamentoByName = new Map(profiles.map((p) => [String((p && p.name) || ""), roleLabel(p && p.estamento)]));
    const longLeave = new Map(); // name -> {comun, prof}
    const now = new Date();
    const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - LONG_LEAVE_WINDOW_DAYS);

    profiles.forEach((profile) => {
        const name = String((profile && profile.name) || "");
        if (!name) return;
        const absences = turnosSnap[`absences_${name}`] || {};
        Object.entries(absences).forEach(([key, value]) => {
            const parsed = parseStateKey(key);
            if (!parsed) return;
            const type = absenceType(value);
            const isComun = type === "license";
            const isProf = type === "professional_license";
            if (!isComun && !isProf) return;

            // Series por mes solicitado
            const mkey = `${parsed.year}-${String(parsed.month0 + 1).padStart(2, "0")}`;
            const mi = monthKeyToIdx.get(mkey);
            if (mi !== undefined) {
                if (isComun) series[mi].licenciasComun += 1; else series[mi].licenciasProfesional += 1;
                const rk = rankingByMonth[months[mi].key];
                rk.set(name, (rk.get(name) || 0) + 1);
            }

            // Prolongadas: ventana móvil 720 días
            const dayDate = new Date(parsed.year, parsed.month0, parsed.day);
            if (dayDate >= windowStart && dayDate <= now) {
                if (!longLeave.has(name)) longLeave.set(name, { comun: 0, prof: 0 });
                const rec = longLeave.get(name);
                if (isComun) rec.comun += 1; else rec.prof += 1;
            }
        });
    });

    // --- Devolución de horas por mes (hourReturns_) ---
    profiles.forEach((profile) => {
        const name = String((profile && profile.name) || "");
        if (!name) return;
        const records = hoursSnap[`hourReturns_${name}`] || {};
        Object.values(records).forEach((record) => {
            const parsed = parseStateKey(record && record.keyDay);
            if (!parsed) return;
            const mkey = `${parsed.year}-${String(parsed.month0 + 1).padStart(2, "0")}`;
            const mi = monthKeyToIdx.get(mkey);
            if (mi === undefined) return;
            series[mi].devolucion += Number(record && record.hours) || 0;
        });
    });
    months.forEach((_, mi) => { series[mi].devolucion = Math.round(series[mi].devolucion); });

    // --- Fusión de resúmenes mensuales (rrhhSummaries) ---
    const coverage = { hhee: 0, cobertura: 0, total: months.length };
    summaryDocs.forEach((doc, mi) => {
        if (!doc.exists) return;
        const s = doc.data() || {};
        if (Number.isFinite(Number(s.hheeGastoClp))) {
            series[mi].gastoUnidad = +(Number(s.hheeGastoClp) / CLP_M).toFixed(1);
            const g = s.gastoPorEstamento || {};
            series[mi].gastoEstamento = ESTAMENTOS.map((e) => +((Number(g[e]) || 0) / CLP_M).toFixed(2));
            series[mi].honorarios = +((Number(s.honorariosClp) || 0) / CLP_M).toFixed(1);
            series[mi].motivoManual = +((Number(s.hheeManualClp) || 0) / CLP_M).toFixed(1);
            coverage.hhee += 1;
        }
        const hasCob = ["contrata", "planta", "reemplazo", "otroEstamento", "otroServicio", "sinReemplazo"]
            .some((k) => Number.isFinite(Number(s[k])));
        if (hasCob) {
            series[mi].contrata = Number(s.contrata) || 0;
            series[mi].planta = Number(s.planta) || 0;
            series[mi].reemplazo = Number(s.reemplazo) || 0;
            series[mi].otro = Number(s.otroEstamento) || 0;
            series[mi].otroServicio = Number(s.otroServicio) || 0;
            series[mi].sinReemplazo = Number(s.sinReemplazo) || 0;
            coverage.cobertura += 1;
        }
    });

    // Ranking → arrays
    const ranking = {};
    months.forEach((m) => {
        ranking[m.key] = [...rankingByMonth[m.key].entries()]
            .map(([name, dias]) => ({ name, estamento: estamentoByName.get(name) || "", unit: unit.name, dias }))
            .sort((a, b) => b.dias - a.dias).slice(0, 8);
    });

    // Prolongadas (>= umbral inferior sobre común)
    const prolongadas = [...longLeave.entries()]
        .map(([name, rec]) => ({
            name, unit: unit.name, estamento: estamentoByName.get(name) || "",
            diasComun: rec.comun, diasProfesional: rec.prof
        }))
        .filter((p) => p.diasComun >= LONG_LEAVE_MIN)
        .sort((a, b) => b.diasComun - a.diasComun);

    return { series, ranking, dotacion, headcount, prolongadas, coverage };
}

// -------------------------------------------------------------- la callable
const getRrhhDashboard = onCall(
    { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 180, memory: "512MiB" },
    async (request) => {
        if (!request.auth || !request.auth.uid) {
            throw new HttpsError("unauthenticated", "Inicia sesión para ver el dashboard.");
        }
        const months = buildMonths(clampMonths(request.data && request.data.months));
        const monthKeyToIdx = new Map(months.map((m, i) => [m.key, i]));
        const uid = request.auth.uid;

        let units;
        try { units = await listAccessibleUnits(uid); }
        catch (e) { logger.error("No se pudieron listar unidades.", e); throw new HttpsError("internal", "No se pudieron cargar tus unidades."); }
        if (units.length === 0) {
            throw new HttpsError("permission-denied", "Tu cuenta no tiene unidades con permiso de dashboard/turnos/horas.");
        }

        const series = {};
        const ranking = {};
        const dotacionMatrix = [];
        const headcount = [];
        let prolongadas = [];
        const cov = { hhee: 0, cobertura: 0, total: 0 };

        for (let u = 0; u < units.length; u++) {
            const unit = units[u];
            try {
                const r = await computeUnit(unit, months, monthKeyToIdx);
                series[u] = r.series;
                ranking[unit.id] = r.ranking;
                dotacionMatrix[u] = r.dotacion;
                headcount[u] = r.headcount;
                prolongadas = prolongadas.concat(r.prolongadas);
                cov.hhee += r.coverage.hhee; cov.cobertura += r.coverage.cobertura; cov.total += r.coverage.total;
            } catch (e) {
                logger.warn("Unidad omitida.", { unitId: unit.id, message: e.message });
                series[u] = {}; ranking[unit.id] = {}; dotacionMatrix[u] = ESTAMENTOS.map(() => CONTRATOS.map(() => 0)); headcount[u] = 0;
            }
        }
        prolongadas.sort((a, b) => b.diasComun - a.diasComun);

        const covFlag = (have) => cov.total === 0 || have === 0 ? "unavailable" : have >= cov.total ? "real" : "partial";
        const flags = {
            dotacion: "real", licencias: "real", prolongadas: "real", devolucion: "real",
            hheeGasto: covFlag(cov.hhee), gastoEstamento: covFlag(cov.hhee),
            honorarios: covFlag(cov.hhee), motivoManual: covFlag(cov.hhee),
            cobertura: covFlag(cov.cobertura)
        };
        const anyUnavailable = Object.values(flags).some((v) => v !== "real");

        return {
            source: anyUnavailable ? "partial" : "real",
            generatedAt: new Date().toISOString(),
            units, headcount, estamentos: ESTAMENTOS, contratos: CONTRATOS,
            dotacionMatrix, months, series, ranking, prolongadas, flags
        };
    }
);

module.exports = { getRrhhDashboard };
