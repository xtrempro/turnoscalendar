// Solicitud a la app por un CUPO de la Brecha (Ayuda para cubrir del
// Calendario Mensual): no reemplaza a nadie, lleva el motivo del cupo y una
// clave propia. Si el trabajador la acepta, queda el mismo registro que cubrir
// el cupo desde el modal (rota_gap con el motivo), y una aceptacion de un cupo
// no se confunde con otro cupo ni con un reemplazo del mismo dia.

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
    location: { hostname: "localhost", href: "http://localhost/" }
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
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { setJSON, getJSON } = await import("../js/persistence.js");
const {
    applyAcceptedReplacementRequests,
    createReplacementRequest,
    saveReplacement
} = await import("../js/replacements.js");
const { TURNO } = await import("../js/constants.js");

const MOTIVE = "Completar rotativa de tecnicos del grupo B";

beforeEach(() => {
    localStorage.clear();
    setJSON("profiles", [
        { name: "Ana", estamento: "Técnico", active: true, mobileAppUid: "uid-ana" },
        { name: "Beto", estamento: "Técnico", active: true, mobileAppUid: "uid-beto" }
    ]);
});

function accept(request) {
    const requests = getJSON("replacementRequests", []).map(item =>
        item.id === request.id ? { ...item, status: "accepted", acceptedAt: new Date().toISOString() } : item
    );

    setJSON("replacementRequests", requests);
}

test("aceptada por la app, la solicitud de un cupo deja el turno con el motivo del cupo", () => {
    const request = createReplacementRequest({
        worker: "Ana",
        replaced: "",
        keyDay: "2026-9-3",
        turno: TURNO.LARGA,
        absenceType: MOTIVE,
        reason: MOTIVE,
        cupoKey: `${MOTIVE}|2026-9-3|day|0`
    });

    assert.equal(request.reason, MOTIVE);
    assert.equal(request.absenceType, MOTIVE, "es lo que la app muestra como motivo");

    accept(request);
    assert.equal(applyAcceptedReplacementRequests(), true);

    const saved = getJSON("replacements", []).at(-1);

    assert.equal(saved.worker, "Ana");
    assert.equal(saved.replaced, "");
    assert.equal(saved.reason, MOTIVE);
    assert.equal(saved.source, "rota_gap");
    assert.equal(saved.requestId, request.id);
    assert.equal(getJSON("replacementRequests", []).at(-1).appliedAt !== "", true);
});

test("dos cupos del mismo dia y turno son dos turnos: aceptar uno no tapa el otro", () => {
    // Ya hay alguien en un cupo ese dia (rota_gap sin reemplazado).
    saveReplacement({ worker: "Beto", replaced: "", reason: MOTIVE, keyDay: "2026-9-3", turno: TURNO.LARGA, source: "rota_gap" });

    const request = createReplacementRequest({
        worker: "Ana",
        replaced: "",
        keyDay: "2026-9-3",
        turno: TURNO.LARGA,
        absenceType: MOTIVE,
        reason: MOTIVE,
        cupoKey: `${MOTIVE}|2026-9-3|day|1`
    });

    accept(request);
    applyAcceptedReplacementRequests();

    const replacements = getJSON("replacements", []).filter(item => item.date === "2026-10-03");

    assert.deepEqual(replacements.map(item => item.worker).sort(), ["Ana", "Beto"]);
});

test("la Ayuda envia la solicitud solo a quien tiene la app, y lo pendiente queda esperando", async () => {
    const source = await readFile(new URL("../js/monthlyMagic.js", import.meta.url), "utf8");
    const plan = await readFile(new URL("../js/monthlyMagicPlan.js", import.meta.url), "utf8");

    assert.match(source, /data-magic-request[^>]*>Enviar solicitud seleccionados/);
    assert.match(source, /data-magic-request[^>]*>Enviar solicitud a todos/);
    assert.match(source, /enableWorkerAcceptanceRequest !== false/);
    assert.match(source, /if \(created\.channel !== "app"\) \{\s*cancelReplacementRequest\(created\.id, "admin"\);/);
    assert.match(source, /Esperando respuesta en la app/);
    assert.match(plan, /const pending = deps\.pendingRequestFor\?\.\(/);
});

test("auditoria: si el cupo ya lo cubrio alguien mientras esperaba, la aceptacion se descarta", async () => {
    const { setCupoOpenChecker } = await import("../js/replacements.js");

    setCupoOpenChecker(() => false);

    try {
        const request = createReplacementRequest({
            worker: "Ana",
            replaced: "",
            keyDay: "2026-9-3",
            turno: TURNO.LARGA,
            absenceType: MOTIVE,
            reason: MOTIVE,
            cupoKey: `${MOTIVE}|2026-9-3|day|0`
        });

        accept(request);
        assert.equal(applyAcceptedReplacementRequests(), true);
        assert.deepEqual(getJSON("replacements", []), [], "no se cubre dos veces");

        const stored = getJSON("replacementRequests", []).at(-1);

        assert.equal(stored.status, "superseded");
        assert.equal(stored.supersededReason, "cupo_cubierto");
    } finally {
        setCupoOpenChecker(null);
    }
});

test("auditoria: la cobertura aplicada guarda la clave del cupo", () => {
    const request = createReplacementRequest({
        worker: "Ana", replaced: "", keyDay: "2026-9-3", turno: TURNO.LARGA,
        absenceType: MOTIVE, reason: MOTIVE, cupoKey: "k-1"
    });

    accept(request);
    applyAcceptedReplacementRequests();
    assert.equal(getJSON("replacements", []).at(-1).cupoKey, "k-1");
});

test("auditoria: solo se suben las solicitudes que cambiaron, en lotes de a lo mas 400", async () => {
    const { pendingRequestUploads, requestSignature } = await import("../js/firebaseReplacementRequests.js");
    const requests = Array.from({ length: 900 }, (_, index) => ({ id: `r${index}`, status: "pending" }));
    const synced = new Map(requests.slice(0, 850).map(request => [request.id, requestSignature(request)]));

    // 850 ya estan en la nube tal cual; cambia una de ellas.
    requests[3] = { ...requests[3], status: "accepted" };

    const batches = pendingRequestUploads(requests, synced, 400);

    assert.deepEqual(batches.map(batch => batch.length), [51]);
    assert.equal(batches[0][0].id, "r3");
    assert.deepEqual(pendingRequestUploads(requests, new Map(), 400).map(batch => batch.length), [400, 400, 100]);
    // La fecha del servidor no cuenta como cambio.
    assert.equal(requestSignature({ id: "a", updatedAt: 1 }), requestSignature({ id: "a", updatedAt: 2 }));
});
