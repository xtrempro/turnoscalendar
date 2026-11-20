// Reemplazos repartidos por mes (19-11-2026). El documento unico
// `stateModules/turnos/entries/replacements` rondaba 1 MiB; con la marca
// `replacementShards: "monthly-v1"` cada reemplazo va al documento de su mes, con
// el mismo storageKey. Invariante: un id vive en UN solo documento toda su vida;
// un reemplazo no cambia de mes.
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

function memoryStorage() {
    const values = new Map();
    return { values, get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
        getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key), clear: () => values.clear() };
}
globalThis.localStorage = memoryStorage();

const {
    groupPartialStateEntries,
    planPartialStateEntries,
    replacementShardDocKey
} = await import("../js/firebasePartialState.js");
const { normalizeQueuedStateEntries, commitPartialStateSlice, replacementShardKeysFor } = await import("../js/firebaseAppState.js");
const { stateModuleForKey } = await import("../js/firebaseStateModules.js");
const { applyEntry } = createRequire(import.meta.url)("../functions/lib/stateReader.js");

const r = (id, date, extra = {}) => ({ id, worker: "ANA", date, turno: "L", ...extra });
const SHARDED = new Set(["replacements"]);
const plan = (previous, next, shardedKeys = SHARDED) => planPartialStateEntries({
    keys: ["replacements"],
    changes: { replacements: { previous: JSON.stringify(previous), next: JSON.stringify(next) } },
    readRaw: () => null,
    moduleForKey: stateModuleForKey,
    shardedKeys
});

test("la marca de la unidad decide si se reparte", () => {
    assert.deepEqual([...replacementShardKeysFor({ replacementShards: "monthly-v1" })], ["replacements"]);
    assert.deepEqual([...replacementShardKeysFor({})], []);
    assert.deepEqual([...replacementShardKeysFor({ replacementShards: "otra" })], []);
});

test("cada elemento va al documento del mes de su fecha; sin fecha a 0000-00", () => {
    assert.equal(replacementShardDocKey(r("a", "2026-11-20")), "replacements__2026-11");
    assert.equal(replacementShardDocKey({ id: "b" }), "replacements__0000-00");
    // Ya no hay ancla: un campo shardMonth no cambia el documento.
    assert.equal(replacementShardDocKey(r("c", "2026-12-01", { shardMonth: "2026-11" })), "replacements__2026-12");

    const entries = plan([], [r("a", "2026-11-20"), r("b", "2026-10-03"), { id: "c" }]);
    assert.deepEqual(
        Object.fromEntries(entries.map(entry => [entry.itemKey, entry.docKey])),
        { a: "replacements__2026-11", b: "replacements__2026-10", c: "replacements__0000-00" }
    );
});

test("un borrado va al documento donde vivia el elemento", () => {
    const [entry] = plan([r("a", "2026-10-03")], []);

    assert.equal(entry.deleted, true);
    assert.equal(entry.docKey, "replacements__2026-10");
});

test("un reemplazo no cambia de mes: el cambio se rechaza, no queda en dos documentos", () => {
    assert.throws(() => plan([r("a", "2026-10-31")], [r("a", "2026-11-01")]),
        error => error.code === "whole-list-write-forbidden" && /no cambia de mes/.test(error.message));
    // Dentro del mismo mes, la misma fecha cambiada es una edicion normal.
    const [entry] = plan([r("a", "2026-10-30")], [r("a", "2026-10-31")]);
    assert.deepEqual([entry.itemKey, entry.docKey, entry.deleted], ["a", "replacements__2026-10", false]);
});

test("sin la marca todo sigue igual: sin docKey, un solo documento", () => {
    const entries = plan([], [r("a", "2026-11-20"), r("b", "2026-10-03")], new Set());

    assert.ok(entries.every(entry => !entry.docKey));
    assert.equal(groupPartialStateEntries(entries).length, 1);
});

test("se agrupa por documento y la cola conserva el documento de cada elemento", () => {
    const documents = groupPartialStateEntries(plan([], [r("a", "2026-11-20"), r("b", "2026-10-03"), r("c", "2026-11-02")]));

    assert.deepEqual(documents.map(document => document.docKey).sort(), ["replacements__2026-10", "replacements__2026-11"]);
    assert.ok(documents.every(document => document.storageKey === "replacements"));

    const requeued = normalizeQueuedStateEntries(documents);
    assert.deepEqual(
        Object.fromEntries(requeued.map(entry => [entry.itemKey, entry.docKey])),
        { a: "replacements__2026-11", b: "replacements__2026-10", c: "replacements__2026-11" }
    );
});

test("el envio escribe en el documento del mes, con su campo shard", async () => {
    const written = [];
    const firestore = {
        collection: (_db, ...parts) => parts.join("/"),
        doc: (parent, id) => `${parent}/${id}`,
        serverTimestamp: () => "now",
        runTransaction: async (_db, callback) => callback({
            get: async () => ({ exists: () => false, data: () => ({}) }),
            set: (ref, payload) => written.push({ ref, payload })
        })
    };

    await commitPartialStateSlice({}, firestore, "ws", groupPartialStateEntries(plan([], [r("a", "2026-11-20")])));

    assert.equal(written.length, 1);
    assert.match(written[0].ref, /entries\/replacements__2026-11$/);
    assert.equal(written[0].payload.storageKey, "replacements");
    assert.equal(written[0].payload.shard, "2026-11");
    assert.ok(!("value" in written[0].payload));
});

test("el servidor junta los meses en una sola lista, con el orden de los documentos", () => {
    const state = {};
    const doc = (shard, items, deletedItems = {}) => ({
        moduleId: "turnos", storageKey: "replacements", container: "array", ...(shard ? { shard } : {}),
        items: Object.fromEntries(items.map(item => [item.id, JSON.stringify(item)])),
        deletedItems: { ...Object.fromEntries(items.map(item => [item.id, false])), ...deletedItems }
    });

    // Antiguo (ya vaciado por el corte), luego los meses en orden de id.
    [doc("", []), doc("2026-10", [r("b", "2026-10-03")]), doc("2026-11", [r("a", "2026-11-20"), r("x", "2026-11-21")], { x: true })]
        .forEach(entry => applyEntry(state, entry));

    assert.deepEqual(JSON.parse(state.replacements).map(item => item.id), ["b", "a"]);
});

// Reauditoria por mes, P2-1: la bitacora guarda `meta.replacementId`. Si el id
// cambiara al pasar de mes, anular desde LOG ya no lo encontraria.

// Los cambios de turno son siempre dentro del mismo mes (swapUI.js y
// workerRequests.js lo exigen): el respaldo que viaja con el turno conserva su
// id y su documento. La bitacora guarda ese id (meta.replacementId).
test("mover un respaldo dentro del mes conserva su id y su documento", async () => {
    const { setJSON, getJSON } = await import("../js/persistence.js");
    const { moveManualExtraBackup } = await import("../js/replacements.js");
    const before = [r("audit-r1", "2026-10-20", { worker: "ANA", source: "manual_extra", turno: "D" })];

    setJSON("replacements", before);
    moveManualExtraBackup("ANA", "2026-10-20", "2026-10-27", "D");
    const after = getJSON("replacements", []);

    assert.deepEqual(after.map(item => [item.id, item.date]), [["audit-r1", "2026-10-27"]]);
    assert.deepEqual(plan(before, after).map(entry => [entry.itemKey, entry.docKey]),
        [["audit-r1", "replacements__2026-10"]]);
});

test("los dos caminos de cambio de turno exigen el mismo mes", async () => {
    const swapUI = await readFile(new URL("../js/swapUI.js", import.meta.url), "utf8");
    const requests = await readFile(new URL("../js/workerRequests.js", import.meta.url), "utf8");

    assert.match(swapUI, /Ambas fechas deben pertenecer al mismo mes/);
    assert.match(requests, /deben pertenecer al mismo mes/);
});

// Una cobertura y la barrera de su dia viven en el mismo documento: el guard
// transaccional, que solo lee ese documento, la anula.
test("una cobertura y la barrera de su dia comparten documento y el guard la anula", async () => {
    const { guardReplacementEntryWithBarriers } = await import("../js/firebasePartialState.js");
    const coverage = r("coverage:2026-11-01:PALOMA:full", "2026-11-01", {
        worker: "ANA", replaced: "PALOMA", source: "manual_extra", turno: "D", leaveLogId: "log-1"
    });
    const barrier = { id: "leave-barrier:log-1:2026-11-01", source: "leave_cancellation_barrier",
        replaced: "PALOMA", date: "2026-11-01", leaveLogId: "log-1", canceled: true };

    assert.equal(replacementShardDocKey(coverage), replacementShardDocKey(barrier));
    const [document] = groupPartialStateEntries(plan([], [coverage]));
    const novemberDoc = { items: { [encodeURIComponent(barrier.id)]: JSON.stringify(barrier) } };
    const guarded = guardReplacementEntryWithBarriers(document, novemberDoc);

    assert.equal(JSON.parse(Object.values(guarded.items)[0]).canceled, true);
});

// El que cubre un turno no depende de la posicion en la lista, que cambia segun
// como llego cada cambio a la sesion (en sitio, al final, o por orden de claves
// al hidratar).
test("el reemplazo que se muestra para un turno cubierto no depende del orden de la lista", async () => {
    const { setJSON } = await import("../js/persistence.js");
    const { getReplacementForCoveredShift } = await import("../js/replacements.js");
    const { keyFromISO } = await import("../js/dateUtils.js");
    const ana = r("cov-ana", "2026-11-01", { worker: "ANA", replaced: "PALOMA", source: "manual_extra", turno: "D" });
    const beto = r("cov-beto", "2026-11-01", { worker: "BETO", replaced: "PALOMA", source: "replacement", turno: "D" });
    const day = keyFromISO("2026-11-01");

    setJSON("replacements", [ana, beto]);
    assert.equal(getReplacementForCoveredShift("PALOMA", day)?.id, "cov-ana");
    setJSON("replacements", [beto, ana]);
    assert.equal(getReplacementForCoveredShift("PALOMA", day)?.id, "cov-ana");
    setJSON("replacements", [beto, { ...ana, canceled: true }]);
    assert.equal(getReplacementForCoveredShift("PALOMA", day)?.id, "cov-beto");
});

// ---- Cola real ----
const source = await readFile(new URL("../js/firebaseAppState.js", import.meta.url), "utf8");
const bundled = await build({
    stdin: {
        contents: source + `
export const testState = {
  setup(services, workspace = "ws-mes") { stopFirebaseAppStateSync(); activeWorkspaceId = workspace; shardedStateKeys = new Set(["replacements"]); servicesCache = services; waitingInitialState = false; applyingRemoteState = false; entryLastUserActivityAt = 0; },
  seed(entries) { queueGroupedPartialStateEntries(entries); pendingEntriesOldestAt = Date.now() - 60000; },
  flush: flushPartialStateEntries,
  pending() { return [...pendingStateEntries.values()]; },
  stop() { stopFirebaseAppStateSync(); },
  clearTimers() { clearTimeout(entrySyncTimer); entrySyncTimer = null; }
};`,
        resolveDir: fileURLToPath(new URL("../js/", import.meta.url)),
        sourcefile: "firebaseAppState.js"
    },
    bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent"
});
const live = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

test("si falla un mes, solo ese vuelve a la cola: el otro queda confirmado", async t => {
    globalThis.window = { dispatchEvent: () => true, addEventListener() {} };
    globalThis.document = { visibilityState: "hidden", activeElement: null, querySelector: () => null, body: { dataset: {} } };
    t.after(() => { live.testState.clearTimers(); delete globalThis.window; delete globalThis.document; });

    const written = [];
    live.testState.setup({ db: {}, firestoreModule: {
        collection: (_db, ...parts) => parts.join("/"),
        doc: (parent, id) => `${parent}/${id}`,
        serverTimestamp: () => "now",
        runTransaction: async (_db, callback) => callback({
            get: async () => ({ exists: () => false, data: () => ({}) }),
            set: (ref, payload) => {
                if (ref.endsWith("2026-10")) throw Object.assign(new Error("sin red"), { code: "unavailable" });
                written.push(ref);
            }
        })
    } });
    live.testState.seed(plan([], [r("a", "2026-11-20"), r("b", "2026-10-03")]));

    await live.testState.flush();

    assert.deepEqual(written.map(ref => ref.split("/").pop()), ["replacements__2026-11"]);
    assert.deepEqual(live.testState.pending().map(entry => [entry.itemKey, entry.docKey]), [["b", "replacements__2026-10"]]);
});


test("cola real: un cambio de mes que llegara a la cola se aparta sin escribir nada", async t => {
    globalThis.window = { dispatchEvent: () => true, addEventListener() {} };
    globalThis.document = { visibilityState: "hidden", activeElement: null, querySelector: () => null, body: { dataset: {} } };
    t.after(() => { live.testState.clearTimers(); delete globalThis.window; delete globalThis.document; });

    const events = [];
    globalThis.window.dispatchEvent = event => { events.push(event?.detail); return true; };
    live.testState.setup({ db: {}, firestoreModule: {} }, "ws-rechazo");
    live.queueFirebasePersistenceChanges({ keys: ["replacements"], changes: { replacements: {
        previous: JSON.stringify([r("a", "2026-10-31")]),
        next: JSON.stringify([r("a", "2026-11-01")])
    } } });

    assert.equal(live.testState.pending().length, 0, "no se encola");
    assert.ok(events.some(detail => detail?.type === "app-state-error" && detail.keys?.includes("replacements")),
        "avisa que el cambio sigue solo en el equipo");
});
