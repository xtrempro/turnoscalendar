// Un permiso anulado se lleva su memorandum pendiente.
//
// Antes, al anular un feriado legal o un administrativo, el memorandum que
// pedia su documento se quedaba en la lista para siempre: se le seguia
// cobrando al trabajador un papel de un permiso que ya no existia.
import test from "node:test";
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
// Con body y documentElement: quitar un memorandum deja registro en la
// bitacora, y addAuditLog lee el dataset de la pagina.
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

const {
    cancelLeaveMemos,
    createLeaveMemoTask,
    getMemos
} = await import("../js/memos.js");

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const PROFILE = "ALAN RUFINO PLAZA MARTINEZ";
const OTRO = "GERALDINE DAYANE GONZALEZ GOMEZ";

// Las claves del calendario llevan el mes en base 0: "2026-9-6" es el 6 de
// octubre de 2026.
function aplicar(sourceType, typeLabel, keys, profile = PROFILE) {
    return createLeaveMemoTask({
        profile,
        typeLabel,
        amount: keys.length,
        startKey: keys[0],
        endKey: keys[keys.length - 1],
        sourceType,
        keys
    });
}

test("anular el permiso quita su memorandum pendiente", () => {
    localStorage.clear();
    aplicar("legal", "F. Legal", ["2026-9-6", "2026-9-7"]);

    const removed = cancelLeaveMemos({
        profile: PROFILE,
        leaveType: "legal",
        keys: ["2026-9-6", "2026-9-7"]
    });

    assert.equal(removed.length, 1);
    assert.equal(getMemos().length, 0);
});

test("no toca otro permiso del mismo dia ni el de otra persona", () => {
    localStorage.clear();
    aplicar("legal", "F. Legal", ["2026-9-6"]);
    aplicar("admin", "P. Administrativo", ["2026-9-6"]);
    aplicar("legal", "F. Legal", ["2026-9-6"], OTRO);

    cancelLeaveMemos({ profile: PROFILE, leaveType: "legal", keys: ["2026-9-6"] });

    const quedan = getMemos().map(memo => `${memo.profile}|${memo.typeLabel}`).sort();

    assert.deepEqual(quedan, [
        `${PROFILE}|P. Administrativo`,
        `${OTRO}|F. Legal`
    ]);
});

test("si ya tenia el documento adjunto, el memorandum se queda", () => {
    // Borrarlo eliminaria el archivo de Storage; si la anulacion fue un error,
    // se perderia el documento.
    localStorage.clear();
    const memo = aplicar("admin", "P. Administrativo", ["2026-9-9"]);
    const guardados = JSON.parse(localStorage.getItem("memos"));

    guardados[0].documents = [{
        id: "d1",
        name: "ResEx.pdf",
        type: "application/pdf",
        storagePath: "workspaces/w/attachments/memos/x/memo-documents/d1"
    }];
    localStorage.setItem("memos", JSON.stringify(guardados));

    const removed = cancelLeaveMemos({ profile: PROFILE, leaveType: "admin", keys: ["2026-9-9"] });

    assert.equal(removed.length, 0);
    assert.equal(getMemos()[0].id, memo.id);
});

test("si se anulan solo algunos dias, el memorandum queda con los otros", () => {
    localStorage.clear();
    aplicar("comp", "F. Compensatorio", ["2026-8-27", "2026-8-28", "2026-8-29"]);

    const removed = cancelLeaveMemos({ profile: PROFILE, leaveType: "comp", keys: ["2026-8-27"] });
    const memo = getMemos()[0];

    assert.equal(removed.length, 0);
    assert.deepEqual(memo.keys, ["2026-8-28", "2026-8-29"]);
    assert.equal(memo.startKey, "2026-8-28");
    assert.equal(memo.endKey, "2026-8-29");
});

test("el medio administrativo se anula aunque llegue con el tipo viejo", () => {
    localStorage.clear();
    aplicar("half_admin_morning", "1/2 ADM Mañana", ["2026-8-14"]);

    const removed = cancelLeaveMemos({ profile: PROFILE, leaveType: "half_admin", keys: ["2026-8-14"] });

    assert.equal(removed.length, 1);
    assert.equal(getMemos().length, 0);
});

test("un memorandum viejo, sin los dias guardados, se reconoce por su rango", () => {
    localStorage.clear();
    localStorage.setItem("memos", JSON.stringify([{
        id: "memo_viejo",
        sourceId: `leave:legal:${PROFILE}:2026-8-14:2026-8-18:5`,
        profile: PROFILE,
        typeLabel: "F. Legal",
        startKey: "2026-8-14",
        endKey: "2026-8-18",
        createdAt: "2026-08-31T12:00:00.000Z",
        documents: []
    }]));

    const removed = cancelLeaveMemos({
        profile: PROFILE,
        leaveType: "legal",
        keys: ["2026-8-14", "2026-8-15", "2026-8-16"]
    });

    assert.equal(removed.length, 1);
    assert.equal(getMemos().length, 0);
});

test("sin dias anulados no se toca nada", () => {
    localStorage.clear();
    aplicar("legal", "F. Legal", ["2026-9-6"]);

    assert.deepEqual(cancelLeaveMemos({ profile: PROFILE, leaveType: "legal", keys: [] }), []);
    assert.equal(getMemos().length, 1);
});

/* =========================================================
   Los caminos por los que se anula un permiso
========================================================= */

test("la anulacion desde el LOG avisa a memos por evento", async () => {
    // "Anular permiso" del calendario, "Deshacer" del LOG y la anulacion que
    // pide el trabajador pasan todos por undoLeaveAbsenceLog.
    const auditLog = await read("../js/auditLog.js");
    const memos = await read("../js/memos.js");

    assert.match(auditLog, /window\.dispatchEvent\(new CustomEvent\("proturnos:leaveCanceled"/);
    assert.match(auditLog, /detail: \{ profile, leaveType: type, keys: removedKeys, logId: log\.id \}/);
    assert.match(memos, /window\.addEventListener\("proturnos:leaveCanceled", event => \{\n\s*cancelLeaveMemos\(event\?\.detail \|\| \{\}\);/);
});

test("la limpieza manual del calendario tambien quita el memorandum", async () => {
    const calendar = await read("../js/calendar.js");

    assert.match(calendar, /cancelLeaveMemos\(\{ profile: profileName, leaveType: type, keys: cancelKeys \}\);/);
});
