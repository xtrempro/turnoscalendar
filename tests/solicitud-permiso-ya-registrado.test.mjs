// EDUARDO CASTRO, 11-11-2026: el supervisor le aplico a mano un P.
// Administrativo el 07-11 y, tres minutos despues, el pidio el mismo dia por la
// PWA. "Aceptar" fallaba (no cabe un administrativo sobre otro) y la unica
// salida era rechazarla. Ahora, si el permiso ya esta registrado IGUAL, se
// ofrece cerrarla como aceptada sin aplicarlo de nuevo ni descontar saldo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) { this.values.set(key, String(value)); }
}

const noopEl = {
    addEventListener() {}, removeEventListener() {}, appendChild() {},
    setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    click() {}, remove() {}, dataset: {}
};

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost", href: "http://localhost/" },
    matchMedia: () => ({ matches: false, addEventListener() {} })
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    visibilityState: "hidden", hidden: true,
    body: noopEl, documentElement: noopEl,
    createElement: () => ({ ...noopEl }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
};
globalThis.alert = () => {};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { isAdminLeaveAlreadyApplied } = await import("../js/workerRequests.js");

const ADMIN_EDUARDO = { "2026-10-7": 1, "2026-9-18": 1 };

test("el administrativo del 07-11 de Eduardo ya esta registrado", () => {
    assert.equal(
        isAdminLeaveAlreadyApplied({ type: "admin", date: "2026-11-07", days: 1 }, ADMIN_EDUARDO),
        true
    );
});

test("no lo da por registrado si falta un dia, es otro dia u otro tipo", () => {
    assert.equal(isAdminLeaveAlreadyApplied({ type: "admin", date: "2026-11-07", days: 2 }, ADMIN_EDUARDO), false);
    assert.equal(isAdminLeaveAlreadyApplied({ type: "admin", date: "2026-11-08", days: 1 }, ADMIN_EDUARDO), false);
    assert.equal(isAdminLeaveAlreadyApplied({ type: "legal", date: "2026-11-07", days: 1 }, ADMIN_EDUARDO), false);
    assert.equal(isAdminLeaveAlreadyApplied({ type: "admin", date: "", days: 1 }, ADMIN_EDUARDO), false);
    // Una media jornada registrada no equivale a un dia completo pedido.
    assert.equal(isAdminLeaveAlreadyApplied({ type: "admin", date: "2026-11-07", days: 1 }, { "2026-10-7": "0.5M" }), false);
});

test("las medias jornadas calzan solo con la misma mitad", () => {
    const admin = { "2026-10-7": "0.5M" };

    assert.equal(isAdminLeaveAlreadyApplied({ type: "half_admin_morning", date: "2026-11-07" }, admin), true);
    assert.equal(isAdminLeaveAlreadyApplied({ type: "half_admin_afternoon", date: "2026-11-07" }, admin), false);
    assert.equal(isAdminLeaveAlreadyApplied({ type: "half_admin_morning", date: "2026-11-07" }, ADMIN_EDUARDO), false);
});

// Ejecuta el acceptRequest REAL; lo remoto (claim, Firestore, dialogos) se
// sustituye por memoria. `duringDialog` corre mientras el dialogo esta abierto.
const source = await readFile(new URL("../js/workerRequests.js", import.meta.url), "utf8");
const acceptSource = source.slice(
    source.indexOf("async function acceptRequest("),
    source.indexOf("async function rejectRequest(")
);

async function accept({ admin, confirm = true, duringDialog = () => {} }) {
    const state = { admin, applyCalls: 0, patch: null, released: false, alerts: [], dialogs: [] };
    const context = vm.createContext({
        console, Date, Boolean, window: globalThis.window, CustomEvent,
        isAdminLeaveAlreadyApplied,
        resolveProfileName: () => "EDUARDO",
        getJSON: () => state.admin,
        requestTypeLabel: type => type,
        formatDate: value => value,
        requestDetailsHTML: () => "",
        showConfirm: async (message, options) => {
            state.dialogs.push(options?.confirmText);
            duringDialog(state);
            return confirm;
        },
        claimWorkerRequestResolution: async () => ({ claimed: true, token: "t" }),
        releaseWorkerRequestResolution: async () => { state.released = true; },
        finishWorkerRequestResolution: async (id, token, patch) => { state.patch = patch; return true; },
        applyWorkerRequest: async () => { state.applyCalls++; return { ok: true }; },
        saveUpdatedRequest() {}, notifyWorkerApp() {}, addAuditLog() {},
        AUDIT_CATEGORY: { WORKER_REQUESTS: "worker_requests" },
        alert: message => state.alerts.push(message)
    });

    vm.runInContext(`${acceptSource}; globalThis.run = acceptRequest;`, context);
    state.result = await context.run({ id: "r1", type: "admin", date: "2026-11-07", days: 1 });

    return state;
}

test("aceptar un permiso ya registrado lo cierra como aceptado sin aplicarlo", async () => {
    const state = await accept({ admin: { ...ADMIN_EDUARDO } });

    assert.equal(state.result, true);
    assert.deepEqual(state.dialogs, ["Marcar como aceptada"]);
    assert.equal(state.applyCalls, 0, "no se vuelve a aplicar ni descontar");
    assert.equal(state.patch?.status, "accepted");
});

test("si el permiso desaparece mientras se confirma, no queda aceptada", async () => {
    const state = await accept({
        admin: { ...ADMIN_EDUARDO },
        duringDialog: current => { current.admin = {}; }
    });

    assert.equal(state.result, false);
    assert.equal(state.patch, null, "no se escribe accepted");
    assert.equal(state.applyCalls, 0, "tampoco se aplica por su cuenta");
    assert.equal(state.released, true, "la solicitud queda libre para otro intento");
    assert.equal(state.alerts.length, 1);
});

test("volver en el dialogo no reserva ni aplica nada", async () => {
    const state = await accept({ admin: { ...ADMIN_EDUARDO }, confirm: false });

    assert.equal(state.result, false);
    assert.equal(state.patch, null);
    assert.equal(state.applyCalls, 0);
});

test("sin permiso registrado, aceptar aplica como siempre", async () => {
    const state = await accept({ admin: {} });

    assert.equal(state.result, true);
    assert.deepEqual(state.dialogs, [], "no pregunta nada");
    assert.equal(state.applyCalls, 1);
});
