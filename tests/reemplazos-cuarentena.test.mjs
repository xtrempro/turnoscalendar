// Auditoria fase 0, P2-3: una entrada de la cola que el servidor nunca aceptaria
// (la lista de reemplazos entera) se reintentaba sin fin y, con la pestana
// visible (un documento por vuelta), postergaba a los cambios sanos de atras.
// Ahora se aparta, se avisa y el resto se envia en la misma vuelta.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Se empaqueta el modulo real con accesos al estado privado; la cola, el
// planificador y el envio son los de verdad. Solo se sustituyen servicios y timers.
const source = await readFile(new URL("../js/firebaseAppState.js", import.meta.url), "utf8");
const bundled = await build({
    stdin: {
        contents: source + `
export const testState = {
  setup(services, workspace = "ws") { stopFirebaseAppStateSync(); activeWorkspaceId = workspace; servicesCache = services; waitingInitialState = false; applyingRemoteState = false; entryLastUserActivityAt = 0; },
  // Encolado hace un minuto: ya vencio la espera por quietud de la pestana visible.
  seed(entries) { queueGroupedPartialStateEntries(entries); pendingEntriesOldestAt = Date.now() - 60000; },
  flush: flushPartialStateEntries,
  pending() { return [...pendingStateEntries.values()].map(entry => entry.storageKey); },
  clearTimers() { clearTimeout(entrySyncTimer); entrySyncTimer = null; }
};`,
        resolveDir: fileURLToPath(new URL("../js/", import.meta.url)),
        sourcefile: "firebaseAppState.js"
    },
    bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent"
});
const live = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function memoryStorage() {
    const values = new Map();
    return { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
        getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}

function fakeFirestore() {
    const written = [];
    return {
        written,
        module: {
            collection: (_db, ...parts) => parts.join("/"),
            doc: (parent, id) => `${parent}/${id}`,
            serverTimestamp: () => "now",
            runTransaction: async (_db, callback) => callback({
                get: async () => ({ exists: () => false, data: () => ({}) }),
                set: (ref, payload) => written.push({ ref, payload })
            }),
            writeBatch: () => { throw new Error("sin respaldo"); }
        }
    };
}

function environment(t, visibility, workspace = `ws-${++workspaceSequence}`) {
    globalThis.localStorage = memoryStorage();
    const events = [];
    globalThis.window = { dispatchEvent: event => { events.push(event.detail); return true; }, addEventListener() {} };
    globalThis.document = { visibilityState: visibility, activeElement: null, querySelector: () => null, body: { dataset: {} } };
    t.after(() => { live.testState.clearTimers(); delete globalThis.window; delete globalThis.document; });

    const fs = fakeFirestore();
    live.testState.setup({ db: {}, firestoreModule: fs.module }, workspace);
    return { fs, events, workspace };
}
// Cada prueba en su unidad: la cuarentena es por unidad y dura hasta recargar.
let workspaceSequence = 0;

for (const visibility of ["visible", "hidden"]) {
    test(`pestana ${visibility}: la lista entera se aparta y el cambio sano se envia en la misma vuelta`, async t => {
        const { fs, events, workspace } = environment(t, visibility);
        live.testState.seed([
            { moduleId: "turnos", storageKey: "replacements", itemKey: "", value: "[]", deleted: false },
            { moduleId: "turnos", storageKey: "data_ANA", itemKey: "2026-11-20", value: "2", deleted: false }
        ]);

        await live.testState.flush();

        assert.deepEqual(fs.written.map(write => write.payload.storageKey), ["data_ANA"], "el sano se envia");
        assert.deepEqual(live.testState.pending(), [], "nada vuelve a la cola");
        assert.deepEqual(live.getQuarantinedFirebaseStateEntries().filter(entry => entry.workspaceId === workspace).map(entry => entry.storageKey), ["replacements"], "la intencion no se pierde");

        const rejected = events.filter(detail => detail?.type === "app-state-rejected");
        assert.equal(rejected.length, 1);
        assert.deepEqual(rejected[0].keys, ["replacements"]);

        // Otra vuelta no la reintenta.
        await live.testState.flush();
        assert.equal(fs.written.length, 1);
        assert.equal(events.filter(detail => detail?.type === "app-state-rejected").length, 1);
    });
}

test("un reemplazo por elemento en la misma cola sigue viajando", async t => {
    const { fs } = environment(t, "hidden");
    live.testState.seed([
        { moduleId: "turnos", storageKey: "replacements", itemKey: "", value: "[]", deleted: false },
        { moduleId: "turnos", storageKey: "replacements", itemKey: "r1", container: "array", value: JSON.stringify({ id: "r1" }), deleted: false }
    ]);

    await live.testState.flush();

    assert.equal(fs.written.length, 1);
    assert.deepEqual(Object.keys(fs.written[0].payload.items), ["r1"]);
    assert.ok(!("value" in fs.written[0].payload));
});

// Reauditoria fase 0: el guardado manual confirmaba "already-synced" una clave
// cuyo cambio acababa de apartar sin enviar.
const wholeList = { moduleId: "turnos", storageKey: "replacements", itemKey: "", value: "[]", deleted: false };
const healthy = { moduleId: "turnos", storageKey: "data_ANA", itemKey: "2026-11-20", value: "2", deleted: false };
const validList = () => localStorage.setItem("replacements", JSON.stringify([{ id: "r1" }]));

test("flush manual con solo la entrada prohibida: rechazo explicito, nunca already-synced", async t => {
    const { fs } = environment(t, "hidden");
    validList();
    live.testState.seed([wholeList]);

    const result = await live.flushPendingFirebaseAppStateEntries({ keys: ["replacements"] });

    assert.equal(result.flushed, false);
    assert.equal(result.reason, "rejected-entries");
    assert.deepEqual(result.rejectedKeys, ["replacements"]);
    assert.equal(fs.written.length, 0);
    assert.equal(live.getQuarantinedFirebaseStateEntries().filter(entry => entry.storageKey === "replacements").length >= 1, true);
});

test("flush manual mezclado: lo sano se envia y el resultado igual informa la clave apartada", async t => {
    const { fs } = environment(t, "hidden");
    validList();
    live.testState.seed([wholeList, healthy]);

    const result = await live.flushPendingFirebaseAppStateEntries({ keys: ["replacements", "data_ANA"] });

    assert.equal(result.flushed, false);
    assert.deepEqual(result.rejectedKeys, ["replacements"]);
    assert.deepEqual(fs.written.map(write => write.payload.storageKey), ["data_ANA"]);
    assert.deepEqual(live.testState.pending(), []);
});

test("una cuarentena hecha antes por la vuelta automatica tambien impide confirmar esa clave", async t => {
    const { fs } = environment(t, "hidden");
    validList();
    live.testState.seed([wholeList]);
    await live.testState.flush();

    const result = await live.flushPendingFirebaseAppStateEntries({ keys: ["replacements"] });

    assert.equal(result.reason, "rejected-entries");
    assert.equal(fs.written.length, 0);
});

test("confirmar otra clave no se bloquea por la cuarentena de replacements", async t => {
    const { fs } = environment(t, "hidden");
    validList();
    live.testState.seed([wholeList]);
    await live.testState.flush();
    live.testState.seed([healthy]);

    const result = await live.flushPendingFirebaseAppStateEntries({ keys: ["data_ANA"] });

    assert.equal(result.flushed, true);
    assert.deepEqual(fs.written.map(write => write.payload.storageKey), ["data_ANA"]);
});

test("la cuarentena de otra unidad no bloquea el guardado de esta", async t => {
    environment(t, "hidden", "unidad-a");
    validList();
    live.testState.seed([wholeList]);
    await live.testState.flush();

    const { fs } = environment(t, "hidden", "unidad-b");
    validList();
    const result = await live.flushPendingFirebaseAppStateEntries({ keys: ["replacements"] });

    assert.notEqual(result.reason, "rejected-entries");
    assert.equal(result.flushed, true);
    assert.equal(fs.written.length, 0);
});
