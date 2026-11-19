// Fase 0 de la migracion de reemplazos (auditoria GPT 19-11, P2-2).
//
// La lista `replacements` vive en UN documento de Firestore que ronda los
// 770 KB en `items`. Si una lista con un elemento sin id o con un id repetido
// no se podia partir, el planificador la mandaba ENTERA como `value`; con
// merge:true el documento llegaba a ~1,5 MB, sobre el limite de 1 MiB, y desde
// ahi no se guardaba ningun reemplazo. Tampoco debe poder borrarse como clave
// completa, ni el deshacer "restaurar" como vacia una lista que la foto no tenia.
import test, { beforeEach } from "node:test";
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

const {
    assertNoWholeListWrite,
    groupPartialStateEntries,
    planPartialStateEntries
} = await import("../js/firebasePartialState.js");
const { commitPartialStateSlice } = await import("../js/firebaseAppState.js");
const { stateModuleForKey } = await import("../js/firebaseStateModules.js");
const { getRaw, setJSON } = await import("../js/persistence.js");
const { replacementListProblem, saveReplacements, setCurrentProfile } = await import("../js/storage.js");
const { pushHistory, undo } = await import("../js/history.js");

const r = (id, extra = {}) => ({ id, worker: "ANA", date: "2026-11-20", turno: "L", ...extra });
const plan = (previous, next) => planPartialStateEntries({
    keys: ["replacements"],
    changes: { replacements: { previous: previous === undefined ? null : JSON.stringify(previous), next: JSON.stringify(next) } },
    readRaw: () => null,
    moduleForKey: stateModuleForKey
});
const forbidden = error => error.code === "whole-list-write-forbidden";

beforeEach(() => localStorage.clear());

test("una lista valida viaja por elemento y nunca con la clave entera", () => {
    const entries = plan([r("a")], [r("a", { turno: "N" }), r("b")]);

    assert.deepEqual(entries.map(entry => entry.itemKey).sort(), ["a", "b"]);
    assert.ok(entries.every(entry => entry.itemKey), "ninguna entrada de clave completa");
    assert.doesNotThrow(() => assertNoWholeListWrite(groupPartialStateEntries(entries)));
});

test("sin id, id repetido (nuevo o anterior) o no-lista: se rechaza, no cae a value", () => {
    assert.throws(() => plan([r("a")], [r("a"), { worker: "SIN ID" }]), forbidden);
    assert.throws(() => plan([r("a")], [r("a"), r("a", { turno: "N" })]), forbidden);
    assert.throws(() => plan([r("a"), r("a")], [r("a"), r("b")]), forbidden);
    assert.throws(() => plan([r("a")], { a: r("a") }), forbidden);
});

test("borrar la lista completa se rechaza; una ausencia local no publica nada", () => {
    assert.throws(() => planPartialStateEntries({
        keys: ["replacements"],
        changes: { replacements: { previous: JSON.stringify([r("a")]), next: null, removed: true } },
        readRaw: () => null,
        moduleForKey: stateModuleForKey
    }), forbidden);

    assert.deepEqual(planPartialStateEntries({
        keys: ["replacements"],
        changes: {},
        readRaw: () => null,
        moduleForKey: stateModuleForKey
    }), []);
});

test("ultima defensa: un documento con value o borrado entero no llega a Firestore", async () => {
    let transactions = 0;
    const firestore = {
        collection: (_db, ...parts) => parts.join("/"),
        doc: (parent, id) => `${parent}/${id}`,
        serverTimestamp: () => "now",
        runTransaction: async () => { transactions++; },
        writeBatch: () => { throw new Error("no debe usar respaldo sin lectura"); }
    };
    const whole = { moduleId: "turnos", storageKey: "replacements", value: JSON.stringify([r("a")]), deleted: false, items: {}, deletedItems: {} };
    const wiped = { moduleId: "turnos", storageKey: "replacements", value: null, deleted: true, items: {}, deletedItems: {} };

    for (const entry of [whole, wiped]) {
        await assert.rejects(commitPartialStateSlice({}, firestore, "ws", [entry]), forbidden);
    }
    // Una cola antigua con la clave entera (sin itemKey) tambien.
    assert.throws(() => assertNoWholeListWrite([{ storageKey: "replacements", itemKey: "", value: "[]" }]), forbidden);
    assert.equal(transactions, 0, "se rechaza antes de abrir la transaccion");

    // Las demas listas no cambian: pueden seguir usando la clave entera.
    assert.doesNotThrow(() => assertNoWholeListWrite([{ storageKey: "swaps", value: "[]" }]));
});

test("saveReplacements rechaza antes de tocar el almacenamiento local", () => {
    setJSON("replacements", [r("a")]);
    const before = getRaw("replacements");

    assert.match(replacementListProblem([r("a"), {}]), /sin identificador/);
    assert.match(replacementListProblem([r("a"), r("a")]), /repetido/);
    assert.equal(replacementListProblem([r("a"), r("b")]), "");

    assert.throws(() => saveReplacements([r("a"), r("a")]), error => error.code === "replacement-list-invalid");
    assert.throws(() => saveReplacements([{ worker: "SIN ID" }]), error => error.code === "replacement-list-invalid");
    assert.equal(getRaw("replacements"), before, "la lista local no cambio");

    saveReplacements([r("a"), r("b")]);
    assert.equal(JSON.parse(getRaw("replacements")).length, 2);
});

test("deshacer no restaura como vacia una lista que la foto no tenia", () => {
    setJSON("profiles", [{ name: "ANA" }]);
    setCurrentProfile("ANA");
    localStorage.removeItem("replacements");

    // Foto tomada antes de que la lista se hidratara: no tiene `replacements`.
    pushHistory();
    setJSON("replacements", [r("a"), r("b")]);

    assert.ok(undo()?.ok);
    assert.equal(JSON.parse(getRaw("replacements")).length, 2, "no la vacio");
});

// ---- Auditoria de la fase 0 (reports/auditoria-fase0-reemplazos-2026-11-19.md)

test("P3-1: el envio solo acepta documentos agrupados; un value en la raiz se rechaza aunque traiga itemKey", () => {
    assert.throws(() => assertNoWholeListWrite([
        { moduleId: "turnos", storageKey: "replacements", itemKey: "a", value: "[]", deleted: false }
    ]), forbidden);
    assert.doesNotThrow(() => assertNoWholeListWrite([
        { moduleId: "turnos", storageKey: "replacements", items: { a: "{}" }, deletedItems: { a: false } }
    ]));
});

test("P2-1: con la copia local danada, un guardado valido se rechaza a la vista y no la toca", () => {
    setJSON("replacements", [r("a"), r("a")]);
    const before = getRaw("replacements");

    assert.throws(() => saveReplacements([r("a"), r("b")]), error =>
        error.code === "replacement-list-invalid" && /copia de este equipo/.test(error.message));
    assert.equal(getRaw("replacements"), before);
});

test("P2-1: si el planificador rechaza, se emite app-state-rejected (lo muestra el aviso)", async () => {
    const { queueFirebasePersistenceChanges } = await import("../js/firebaseAppState.js");
    const events = [];
    const previous = globalThis.window;

    globalThis.window = { dispatchEvent: event => { events.push(event.detail); return true; } };
    try {
        queueFirebasePersistenceChanges({
            keys: ["replacements"],
            changes: { replacements: { previous: JSON.stringify([r("a"), r("a")]), next: JSON.stringify([r("a"), r("b")]) } }
        });
    } finally {
        if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
    }

    const rejected = events.find(detail => detail?.type === "app-state-rejected");
    assert.ok(rejected, "hay aviso visible");
    assert.deepEqual(rejected.keys, ["replacements"]);
});

test("P2-2: una licencia con la copia de reemplazos danada no toca nada", async () => {
    const { aplicarLicencia } = await import("../js/leaveEngine.js");
    const marks = { "2026-11-20": { segments: { diurno: { exitTime: "16:00" } } } };

    setJSON("profiles", [{ name: "ANA", id: "ana" }]);
    setCurrentProfile("ANA");
    setJSON("replacements", [r("a"), r("a")]);
    setJSON("clockMarks_ANA", marks);
    const snapshot = new Map(localStorage.values);

    await assert.rejects(aplicarLicencia(new Date(2026, 10, 20), 1), error => error.code === "replacement-list-invalid");
    assert.deepEqual(new Map(localStorage.values), snapshot, "ni horarios, ni ausencias, ni respaldos, ni bitacora");
});
