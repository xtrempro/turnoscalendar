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

test("auditoria 4: dos cupos del grupo en la MISMA casilla cuentan como dos, igual que en el plan", async () => {
    const { rotationStillNeeded } = await import("../js/monthlyMagic.js");
    const { planMonth } = await import("../js/monthlyMagicPlan.js");
    const cupo = { group: "B", motive: "Completar rotativa de tecnicos del grupo B", turno: TURNO.LARGA, reference: "Molde" };
    const build = dayCountOn3 => ({
        rows: [1, 2, 3, 4].map(day => ({
            keyDay: `2026-9-${day}`,
            slots: {
                day: Array.from({ length: day === 3 ? dayCountOn3 : 3 }, (_, index) => ({ name: `P${day}-${index}` })),
                night: Array.from({ length: 3 }, (_, index) => ({ name: `Q${day}-${index}` }))
            },
            gaps: { day: [], night: [] },
            // El 3 de Dia: faltan dos del grupo B (dos cupos en la misma casilla).
            cupos: { day: day === 3 ? [cupo, { ...cupo }].slice(0, 3 - dayCountOn3) : [], night: [] }
        }))
    });
    const model = build(1);
    const plan = await planMonth(model, {
        tierOf: () => 3,
        canMoveSource: () => false,
        dayBlock: () => "",
        allowInverted: true,
        turnAt: () => TURNO.LIBRE,
        baseTurn: () => TURNO.LIBRE,
        neededTurnFor: () => TURNO.LARGA,
        extraHours: () => ({ d: 12, n: 0 }),
        diurnalLimit: 40,
        candidatesFor: async () => [],
        minStartKey: "2026-9-2",
        diurnoWorkers: () => ["Diurna"],
        firstTurnFor: () => ({ firstTurn: "larga", label: "Largo" }),
        affectedFrom: async () => []
    });
    const item = plan.rotations[0];

    assert.equal(item?.fills, 2, "el plan propone la rotativa por los dos cupos");
    assert.equal(rotationStillNeeded(model, item), true, "y al aplicar, sin cambios, sigue haciendo falta");
    // Otro supervisor cubre uno de los dos: queda un turno, ya no alcanza.
    assert.equal(rotationStillNeeded(build(2), item), false);
});

test("mover turnos: el mes del trabajador muestra lo marcado y se repinta al desmarcar", async () => {
    const { workerMonthHTML } = await import("../js/monthlyMagic.js");
    const source = await readFile(new URL("../js/monthlyMagic.js", import.meta.url), "utf8");

    setJSON(`data_Ana`, { "2026-11-4": TURNO.LARGA });

    const move = { name: "Ana", sourceKey: "2026-11-4", targetKey: "2026-11-2", destinationTurn: TURNO.LARGA };
    const marked = workerMonthHTML("Ana", new Date(2026, 11, 1), [move]);
    const unmarked = workerMonthHTML("Ana", new Date(2026, 11, 1), []);
    const cell = (html, day) => html.match(new RegExp(`<span class="mcal-wcal-day[^"]*"[^>]*>\\s*<b>${day}</b>`))?.[0] || "";

    assert.match(cell(marked, 2), /is-arriving/, "el 2 recibe la Larga");
    assert.match(cell(marked, 4), /is-leaving/, "el 4 queda libre");
    assert.doesNotMatch(cell(unmarked, 2), /is-arriving/);
    assert.match(cell(unmarked, 4), /has-turn/, "sin marcar, el 4 sigue con su Larga");
    // Al cambiar una casilla se repinta con lo marcado.
    assert.match(source, /calendar\.innerHTML = workerMonthHTML\(section\.dataset\.magicWorkerName \|\| "", month, checked\);/);
});

test("pasar de Diurno a un grupo: un solo boton Aplicar, sin seleccionados", async () => {
    const { planHTML } = await import("../js/monthlyMagic.js");
    const html = planHTML({
        target: 3,
        moves: [],
        rotations: [{ name: "Diurna", group: "C", startKey: "2026-11-2", firstTurn: "larga", firstTurnLabel: "Largo", fills: 3, affected: [], alternatives: [] }],
        covers: [],
        waiting: [],
        unresolved: [],
        surplus: []
    }, "Diciembre 2026", new Date(2026, 11, 1));

    assert.match(html, /data-magic-apply="rotation:0" data-magic-only="all">Aplicar</);
    assert.doesNotMatch(html, /Aplicar seleccionados/);
    assert.doesNotMatch(html, /type="checkbox" data-magic-pick="rotation"/);
});

test("mover turno deja un comentario visible en Detalles del reporte", async () => {
    const { registerShiftMove, setShiftMoveComment, getShiftMoves } = await import("../js/shiftMoves.js");
    const report = await readFile(new URL("../js/hoursReport.js", import.meta.url), "utf8");
    const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");
    const mensual = await readFile(new URL("../js/monthlyCalendar.js", import.meta.url), "utf8");
    const magic = await import("../js/monthlyMagic.js");

    const move = registerShiftMove({ profile: "Ana", sourceKey: "2026-11-4", targetKey: "2026-11-2", sourceTurn: 1, destinationTurn: 1 });

    assert.equal(move.comment, "");
    setShiftMoveComment(move.id, " Solicitud del funcionario ");
    assert.equal(getShiftMoves().at(-1).comment, "Solicitud del funcionario");

    // En el reporte: "Turno base modificado: <comentario>".
    assert.match(report, /`\$\{SHIFT_MOVE_REPORT_DETAIL\}: \$\{comments\.join\(" \/ "\)\}`/);
    // Calendario principal y Mover del Calendario Mensual piden el comentario.
    assert.match(main, /void askShiftMoveComment\(result\.moveId, profile\);/);
    assert.match(mensual, /await window\.askShiftMoveComment\?\.\(result\.moveId, move\.name\);/);
    // La Ayuda para cubrir lo deja solo, segun a que se movio.
    assert.equal(magic.magicMoveComment({ covers: "Bea" }), "Se mueve rotativa para cubrir ausencia de Bea");
    assert.equal(magic.magicMoveComment({ cupo: true, cupoGroup: "C" }), "Se mueve rotativa para cubrir cupo del grupo C");
});

test("pasar de Diurno a un grupo se puede descartar por el mes", async () => {
    const magic = await import("../js/monthlyMagic.js");
    const december = new Date(2026, 11, 1);

    assert.equal(magic.isRotationDismissed(december, "Diurna", "C"), false);
    magic.dismissRotation(december, "C", new Date(2026, 11, 5));
    assert.equal(magic.isRotationDismissed(december, "Diurna", "C"), true);
    // Se descarta la OPCION del grupo: tampoco se propone a otra persona.
    assert.equal(magic.isRotationDismissed(december, "Otra persona", "C"), true);
    assert.equal(magic.isRotationDismissed(december, "Diurna", "D"), false, "solo ese grupo");
    assert.equal(magic.isRotationDismissed(new Date(2027, 0, 1), "Diurna", "C"), false, "solo ese mes");

    const html = magic.planHTML({
        target: 3, moves: [], covers: [], waiting: [], unresolved: [], surplus: [],
        rotations: [{ name: "Diurna", group: "C", startKey: "2026-11-2", firstTurn: "larga", firstTurnLabel: "Largo", fills: 3, affected: [], alternatives: [] }]
    }, "Diciembre 2026", december);

    assert.match(html, /data-magic-dismiss="rotation:0"[^>]*>Descartar opción/);
});

test("el plan no propone a quien se descarto, y ofrece horas extras como alternativa", async () => {
    const { planMonth } = await import("../js/monthlyMagicPlan.js");
    const cupo = { group: "B", motive: "Completar rotativa de tecnicos del grupo B", turno: TURNO.LARGA, reference: "Molde" };
    const model = {
        rows: [1, 2, 3, 4].map(day => ({
            keyDay: `2026-9-${day}`,
            slots: {
                day: Array.from({ length: day >= 3 ? 2 : 3 }, (_, index) => ({ name: `P${day}-${index}` })),
                night: Array.from({ length: 3 }, (_, index) => ({ name: `Q${day}-${index}` }))
            },
            gaps: { day: [], night: [] },
            cupos: { day: day >= 3 ? [cupo] : [], night: [] }
        }))
    };
    const deps = dismissed => ({
        tierOf: () => 3, canMoveSource: () => false, dayBlock: () => "", allowInverted: true,
        turnAt: () => TURNO.LIBRE, baseTurn: () => TURNO.LIBRE, neededTurnFor: () => TURNO.LARGA,
        extraHours: () => ({ d: 12, n: 0 }), diurnalLimit: 40,
        candidatesFor: async () => [{ name: "Libre", hheeD: 0, hheeN: 0, isFree: true, grade: 20 }],
        minStartKey: "2026-9-2",
        diurnoWorkers: () => ["Diurna"],
        isRotationDismissed: name => dismissed.includes(name),
        firstTurnFor: () => ({ firstTurn: "larga", label: "Largo" }),
        affectedFrom: async () => []
    });

    const withRotation = await planMonth(model, deps([]));

    assert.equal(withRotation.rotations.length, 1);
    assert.equal(withRotation.covers.length, 2, "las horas extras siguen apareciendo");
    assert.ok(withRotation.covers.every(cover => cover.alsoByRotation === "Diurna"), "marcadas como alternativa");

    const dismissed = await planMonth(model, deps(["Diurna"]));

    assert.equal(dismissed.rotations.length, 0);
    assert.equal(dismissed.covers.length, 2);
    assert.ok(dismissed.covers.every(cover => !cover.alsoByRotation));
});

test("hotfix: guardar el comentario vuelve a publicar a ese trabajador vaciando shiftMoves", async () => {
    const { commitShiftMoveComment } = await import("../js/shiftMoveComment.js");
    const { registerShiftMove, setShiftMoveComment, getShiftMoves } = await import("../js/shiftMoves.js");
    const published = [];
    const publish = (...args) => published.push(args);
    const move = registerShiftMove({ profile: "Ana", sourceKey: "2026-11-4", targetKey: "2026-11-2", sourceTurn: 1, destinationTurn: 1 });

    assert.equal(commitShiftMoveComment({ moveId: move.id, profile: "Ana", comment: "Solicitud del funcionario" }, { setComment: setShiftMoveComment, publish }), true);
    assert.equal(getShiftMoves().at(-1).comment, "Solicitud del funcionario");
    assert.deepEqual(published, [[0, "Ana", null, { requiresLocalStateFlush: true, stateKeys: ["shiftMoves"] }]]);

    // Sin comentario, o si el movimiento ya no existe: no se publica nada.
    published.length = 0;
    assert.equal(commitShiftMoveComment({ moveId: move.id, profile: "Ana", comment: "" }, { setComment: setShiftMoveComment, publish }), false);
    assert.equal(commitShiftMoveComment({ moveId: "no-existe", profile: "Ana", comment: "x" }, { setComment: setShiftMoveComment, publish }), false);
    assert.deepEqual(published, []);
});

test("hotfix: los descartes de meses viejos se podan al guardar uno nuevo", async () => {
    const magic = await import("../js/monthlyMagic.js");

    setJSON("magicDismissedRotations", {
        "2024-0": ["*|A"],
        "2026-5": ["*|B"],
        "2026-11": ["Diurna|C"]
    });
    magic.dismissRotation(new Date(2026, 11, 1), "D", new Date(2026, 11, 5));

    const stored = getJSON("magicDismissedRotations", {});

    assert.deepEqual(Object.keys(stored).sort(), ["2026-11", "2026-5"], "2024 queda fuera de los 12 meses");
    assert.deepEqual(stored["2026-11"], ["Diurna|C", "*|D"]);
    // Lo guardado con el formato anterior (persona|grupo) se sigue respetando.
    assert.equal(magic.isRotationDismissed(new Date(2026, 11, 1), "Diurna", "C"), true);
});

test("horas extras: avisa en vivo si con lo marcado alguien pasa el tope o queda con dos turnos el dia", async () => {
    const { coverWarnings } = await import("../js/monthlyMagic.js");
    const row = (index, worker, keyDay, baseD, addD = 12) => ({ index, worker, baseD, item: { keyDay, addD } });

    // Ana lleva 20 h diurnas: con dos Largas (12 + 12) llega a 44 > 40.
    const warnings = coverWarnings([
        row(0, "Ana", "2026-11-2", 20),
        row(1, "Ana", "2026-11-5", 20),
        row(2, "Beto", "2026-11-2", 0)
    ], 40);

    assert.match(warnings.get(0), /Ana quedaría con 44 h diurnas \(tope 40\)/);
    assert.match(warnings.get(1), /tope 40/);
    assert.equal(warnings.has(2), false);

    // Cambiar la fila 1 a Beto apaga el aviso de Ana; pero Beto queda con dos el 2.
    const after = coverWarnings([
        row(0, "Ana", "2026-11-2", 20),
        row(1, "Beto", "2026-11-2", 0),
        row(2, "Beto", "2026-11-2", 0)
    ], 40);

    assert.equal(after.has(0), false);
    assert.match(after.get(1), /dos turnos/);
});

test("horas extras: el calendario del elegido al pasar el mouse marca sus turnos extra", async () => {
    const { workerMonthHTML } = await import("../js/monthlyMagic.js");
    const source = await readFile(new URL("../js/monthlyMagic.js", import.meta.url), "utf8");
    const html = workerMonthHTML("Ana", new Date(2026, 11, 1), [
        { sourceKey: "2026-11-9", targetKey: "2026-11-9", destinationTurn: TURNO.LARGA }
    ], { title: "Ana: su mes con los turnos extra marcados" });

    assert.match(html, /Ana: su mes con los turnos extra marcados/);
    assert.match(html, /mcal-wcal-day has-turn is-arriving"[^>]*>\s*<b>9<\/b>/);
    assert.doesNotMatch(html, /mcal-wcal-day[^"]*is-leaving/, "un turno extra no deja ningun dia libre");
    assert.match(source, /backdrop\.addEventListener\("mouseover", event => \{\s*const select = event\.target\.closest\?\.\("\[data-magic-worker\]"\);/);
});

test("horas extras: reemplazo u honorarios sin contrato vigente se pueden elegir, con advertencia", async () => {
    const { coverWarnings, contractWarningText } = await import("../js/monthlyMagic.js");
    const source = await readFile(new URL("../js/monthlyMagic.js", import.meta.url), "utf8");
    const row = (index, worker, contractWarning) => ({ index, worker, baseD: 0, contractWarning, item: { keyDay: `2026-11-${index + 2}`, addD: 12 } });
    const warnings = coverWarnings([
        row(0, "Rita", "replacement"),
        row(1, "Hugo", "honoraria"),
        row(2, "Ana", "")
    ], 40);

    assert.match(warnings.get(0), /Rita es de reemplazo y no tiene contrato vigente/);
    assert.match(warnings.get(1), /Hugo es de honorarios y no tiene contrato a honorarios/);
    assert.equal(warnings.has(2), false);
    assert.equal(contractWarningText("", "Ana", "2026-11-2"), "");
    // Ya no se bloquea al aplicar por falta de contrato.
    assert.doesNotMatch(source, /no tiene contrato vigente el \$\{when\}/);
});
