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

test("auditoria 2: si se cambia de unidad mientras espera un lote, los que faltan no se escriben", async () => {
    const { uploadRequestChunks } = await import("../js/firebaseReplacementRequests.js");
    const requests = Array.from({ length: 9 }, (_, index) => ({ id: `r${index}`, status: "pending" }));
    const writes = [];
    const synced = new Map();
    let current = true;

    const written = await uploadRequestChunks({
        workspaceId: "unidad-A",
        requests,
        synced,
        limit: 4,
        isCurrent: () => current,
        writeChunk: async (workspaceId, chunk) => {
            writes.push([workspaceId, chunk.map(item => item.id)]);
            // El usuario cambia de unidad mientras el primer commit espera.
            current = false;
        }
    });

    assert.equal(written, 0, "el lote que estaba en vuelo no se da por sincronizado");
    assert.deepEqual(writes, [["unidad-A", ["r0", "r1", "r2", "r3"]]], "nada mas, y nunca con otra unidad");
    assert.equal(synced.size, 0);
});

test("auditoria 2: sin cambio de unidad, sube todos los lotes con la unidad del comienzo", async () => {
    const { uploadRequestChunks } = await import("../js/firebaseReplacementRequests.js");
    const requests = Array.from({ length: 9 }, (_, index) => ({ id: `r${index}`, status: "pending" }));
    const units = new Set();
    const synced = new Map();
    const written = await uploadRequestChunks({
        workspaceId: "unidad-A",
        requests,
        synced,
        limit: 4,
        isCurrent: () => true,
        writeChunk: async workspaceId => units.add(workspaceId)
    });

    assert.equal(written, 3);
    assert.deepEqual([...units], ["unidad-A"]);
    assert.equal(synced.size, 9);
});

test("auditoria 2: dos pestañas que aplican la misma aceptacion de cupo dejan UN registro", () => {
    const request = createReplacementRequest({
        worker: "Ana", replaced: "", keyDay: "2026-9-3", turno: TURNO.LARGA,
        absenceType: MOTIVE, reason: MOTIVE, cupoKey: "k-1"
    });

    accept(request);

    // Las dos pestañas leen la misma lista (aceptada y sin aplicar).
    const snapshot = getJSON("replacementRequests", []);

    applyAcceptedReplacementRequests();
    setJSON("replacementRequests", snapshot);
    applyAcceptedReplacementRequests();

    const saved = getJSON("replacements", []);

    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, `req_${request.id}`);
});

test("auditoria 2: un movimiento o cambio de rotativa que dejo de hacer falta no se aplica", async () => {
    const { liveCounts, moveNoLongerNeeded, openGroupCells } = await import("../js/monthlyMagic.js");
    const source = await readFile(new URL("../js/monthlyMagic.js", import.meta.url), "utf8");
    const row = (day, dayCount, cupoGroup = "") => ({
        keyDay: `2026-9-${day}`,
        slots: {
            day: Array.from({ length: dayCount }, (_, index) => ({ name: `P${day}-${index}` })),
            night: Array.from({ length: 3 }, (_, index) => ({ name: `Q${day}-${index}` }))
        },
        cupos: { day: cupoGroup ? [{ group: cupoGroup }] : [], night: [] }
    });
    const m = { rows: [row(1, 4), row(2, 3), row(3, 2, "B"), row(4, 3)] };
    const counts = liveCounts(m);
    const move = { sourceKey: "2026-9-1", sourceSlot: "day", targetKey: "2026-9-3", targetSlot: "day" };

    assert.equal(moveNoLongerNeeded(move, counts, 3), "");
    // Otro supervisor cubrio el 3 mientras el modal estaba abierto.
    counts.set("2026-9-3|day", 3);
    assert.match(moveNoLongerNeeded(move, counts, 3), /destino ya está completo/);
    counts.set("2026-9-3|day", 2);
    counts.set("2026-9-1|day", 3);
    assert.match(moveNoLongerNeeded(move, counts, 3), /ya no sobra gente/);
    // Cambio de rotativa: el grupo B solo tiene cupo abierto el 3.
    assert.equal(openGroupCells(m, "B", "2026-9-2", 3), 1);
    assert.equal(openGroupCells(m, "B", "2026-9-4", 3), 0);
    // Y se usa al aplicar, con el mes recien leido.
    assert.match(source, /const liveTarget = targetPerShift\(live\);/);
    assert.match(source, /const stale = moveNoLongerNeeded\(move, counts, liveTarget\);/);
    assert.match(source, /if \(!rotationStillNeeded\(current, item\)\)/);
});

test("auditoria 3: dos inicios A/B con Firebase lento: solo queda escuchando la unidad B", async () => {
    const sync = await import("../js/firebaseReplacementRequests.js");
    const listened = [];
    const releases = [];
    const firestoreModule = {
        collection: (db, ...path) => path.join("/"),
        onSnapshot: (ref, onNext) => {
            listened.push({ ref, onNext });
            return () => {};
        }
    };

    // Cada inicio espera a que se le responda a mano.
    sync.setReplacementRequestServicesForTests(() =>
        new Promise(resolve => releases.push(() => resolve({ db: {}, firestoreModule })))
    );

    try {
        const startA = sync.startFirebaseReplacementRequestSync({ id: "A" });

        // Mientras A espera, se abre la unidad B.
        sync.setReplacementRequestServicesForTests(async () => ({ db: {}, firestoreModule }));
        await sync.startFirebaseReplacementRequestSync({ id: "B" });

        // Ahora responde Firebase al inicio viejo de A.
        releases.forEach(release => release());
        await startA;

        assert.deepEqual(listened.map(item => item.ref), ["workspaces/B/replacementRequests"], "A no instala su listener tarde");
    } finally {
        sync.stopFirebaseReplacementRequestSync();
        sync.setReplacementRequestServicesForTests(null);
    }
});

test("auditoria 3: una entrega tardia del listener de otra unidad se ignora", async () => {
    const sync = await import("../js/firebaseReplacementRequests.js");
    const listened = [];
    const firestoreModule = {
        collection: (db, ...path) => path.join("/"),
        onSnapshot: (ref, onNext) => {
            listened.push({ ref, onNext });
            return () => {};
        }
    };

    sync.setReplacementRequestServicesForTests(async () => ({ db: {}, firestoreModule }));

    try {
        await sync.startFirebaseReplacementRequestSync({ id: "A" });
        await sync.startFirebaseReplacementRequestSync({ id: "B" });

        // Llega tarde un snapshot del listener de A con una solicitud de A.
        listened[0].onNext({ docs: [{ data: () => ({ id: "de-A", status: "pending", createdAt: "x" }) }] });

        assert.deepEqual(getJSON("replacementRequests", []).map(item => item.id), [], "no entra a la unidad B");
    } finally {
        sync.stopFirebaseReplacementRequestSync();
        sync.setReplacementRequestServicesForTests(null);
    }
});

test("auditoria 3: el cambio de rotativa se revalida con la meta de ahora y al menos 2 turnos", async () => {
    const { rotationStillNeeded } = await import("../js/monthlyMagic.js");
    const row = (day, dayCount, cupo = false) => ({
        keyDay: `2026-9-${day}`,
        slots: {
            day: Array.from({ length: dayCount }, (_, index) => ({ name: `P${day}-${index}` })),
            night: Array.from({ length: 3 }, (_, index) => ({ name: `Q${day}-${index}` }))
        },
        gaps: { day: [], night: [] },
        cupos: { day: cupo ? [{ group: "B" }] : [], night: [] }
    });
    const item = { group: "B", startKey: "2026-9-2" };

    // Dos turnos del grupo B sin cubrir desde el 2: sigue haciendo falta.
    assert.equal(rotationStillNeeded({ rows: [row(1, 3), row(2, 2, true), row(3, 3), row(4, 2, true)] }, item), true);
    // Otro supervisor cubrio uno: queda uno solo, ya no alcanza para cambiar la rotativa.
    assert.equal(rotationStillNeeded({ rows: [row(1, 3), row(2, 3), row(3, 3), row(4, 2, true)] }, item), false);
});
