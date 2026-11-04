// FRANCISCA OLAVE, 29-10-2026: Diurno que se quedo 24h (extension con motivo
// "Calidad" + Noche cubriendo la Licencia Medica de Paloma Armijo).
//
// Dos fallas juntas dejaban el "?" para siempre:
// - Lo extra de un Diurno -> 24h salia como el 24h entero (Larga + Noche): el
//   modal pedia un tramo "Larga" y cada guardado sumaba otro "Calidad".
// - La cobertura de la Noche se guardo sin leaveLogId (el LOG de la licencia
//   estaba archivado) y la barrera de una LM Profesional anulada esos mismos
//   dias, minutos antes de poner la licencia correcta, la anulaba en la
//   transaccion.
import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) { this.values.set(key, String(value)); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost" }
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    body: { dataset: {}, classList: { add() {}, remove() {}, contains: () => false } },
    documentElement: { dataset: {}, classList: { add() {}, remove() {}, contains: () => false } },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, dataset: {}, appendChild() {} })
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { TURNO } = await import("../js/constants.js");
const { turnoExtraSinRespaldo } = await import("../js/rulesEngine.js");
const { encodePartialStateItemKey, guardReplacementEntryWithBarriers } =
    await import("../js/firebasePartialState.js");
const { addAuditLog, AUDIT_CATEGORY } = await import("../js/auditLog.js");
const { getReplacements, saveReplacements } = await import("../js/storage.js");

const PALOMA = "PALOMA IGNACIA ARMIJO JIMENEZ";

test("un Diurno que se queda 24h pide respaldar la extension y la Noche", () => {
    const { DIURNO, TURNO24, TURNO18, MEDIA_TARDE, NOCHE, LIBRE } = TURNO;

    assert.equal(turnoExtraSinRespaldo(DIURNO, TURNO24, LIBRE), TURNO18);
    // Con la extension respaldada solo queda la Noche, y con las dos, nada.
    assert.equal(turnoExtraSinRespaldo(DIURNO, TURNO24, MEDIA_TARDE), NOCHE);
    assert.equal(turnoExtraSinRespaldo(DIURNO, TURNO24, TURNO18), LIBRE);
});

test("los dias que ya se respaldaron con una Larga no vuelven a pedir motivo", () => {
    const { DIURNO, TURNO24, LARGA, NOCHE, LIBRE } = TURNO;

    assert.equal(turnoExtraSinRespaldo(DIURNO, TURNO24, LARGA), NOCHE);
    assert.equal(turnoExtraSinRespaldo(DIURNO, TURNO24, TURNO24), LIBRE);
    assert.equal(turnoExtraSinRespaldo(DIURNO, LARGA, LARGA), LIBRE);
});

test("los demas turnos agregados piden lo mismo que antes", () => {
    const { LIBRE, LARGA, NOCHE, TURNO24, DIURNO, DIURNO_NOCHE } = TURNO;

    assert.equal(turnoExtraSinRespaldo(LIBRE, TURNO24, LIBRE), TURNO24);
    assert.equal(turnoExtraSinRespaldo(LIBRE, TURNO24, LARGA), NOCHE);
    assert.equal(turnoExtraSinRespaldo(LARGA, TURNO24, LIBRE), NOCHE);
    assert.equal(turnoExtraSinRespaldo(DIURNO, DIURNO_NOCHE, LIBRE), NOCHE);
});

function guard(coverage, barrier) {
    const itemKey = encodePartialStateItemKey(coverage.id);
    const guarded = guardReplacementEntryWithBarriers(
        {
            storageKey: "replacements",
            items: { [itemKey]: JSON.stringify(coverage) }
        },
        {
            items: {
                [encodePartialStateItemKey(barrier.id)]: JSON.stringify(barrier)
            }
        }
    );

    return JSON.parse(guarded.items[itemKey]);
}

const coverage = {
    id: `coverage:2026-10-29:${PALOMA}:full`,
    worker: "FRANCISCA ANASTASSIA OLAVE SALINAS",
    replaced: PALOMA,
    date: "2026-10-29",
    leaveLogId: "",
    canceled: false
};
const barrier = {
    id: "leave-barrier:lm-profesional:2026-10-29",
    source: "leave_cancellation_barrier",
    replaced: PALOMA,
    date: "2026-10-29",
    leaveLogId: "lm-profesional",
    canceled: true,
    canceledAt: "2026-10-19T19:50:26.262Z"
};

test("una barrera superada por otro permiso no anula una cobertura sin leaveLogId", () => {
    assert.equal(
        guard(coverage, { ...barrier, supersededByLeaveLogId: "licencia" }).canceled,
        false
    );
});

test("sin permiso nuevo, la barrera sigue anulando la cobertura sin leaveLogId", () => {
    assert.equal(guard(coverage, barrier).canceled, true);
});

test("superada o no, sigue anulando la cobertura del permiso anulado", () => {
    assert.equal(
        guard(
            { ...coverage, leaveLogId: "lm-profesional" },
            { ...barrier, supersededByLeaveLogId: "licencia" }
        ).canceled,
        true
    );
});

test("aplicar un permiso sobre esos dias deja superada su barrera", () => {
    saveReplacements([
        barrier,
        { ...barrier, id: "leave-barrier:lm-profesional:2026-11-10", date: "2026-11-10" }
    ]);

    addAuditLog(
        AUDIT_CATEGORY.LEAVE_ABSENCE,
        "Aplicó Licencia Médica",
        `${PALOMA}: 15 día(s) corridos desde 20/10/2026.`,
        {
            profile: PALOMA,
            type: "license",
            date: "2026-10-20",
            amount: 15,
            keys: ["2026-9-29", "2026-9-30"],
            auditEntryId: "licencia"
        }
    );

    const byId = new Map(getReplacements().map(item => [item.id, item]));

    assert.equal(byId.get(barrier.id).supersededByLeaveLogId, "licencia");
    // Un dia fuera del permiso nuevo conserva su barrera.
    assert.equal(
        byId.get("leave-barrier:lm-profesional:2026-11-10").supersededByLeaveLogId,
        undefined
    );
});
