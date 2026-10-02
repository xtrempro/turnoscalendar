// Quien aplico un permiso (getLeaveApplicationInfo) mira la bitacora local y lo
// que se trajo de los fragmentos. Dos cosas que no pueden volver atras
// (auditoria del 2026-10-02 sobre 31cbe79):
//  - para un mismo registro manda la bitacora LOCAL: la copia del fragmento
//    puede venir atrasada y revivir un permiso ya anulado;
//  - la lista combinada va en cache, pero se rehace si cambia la bitacora o
//    llegan fragmentos (el timeline la consulta por cada casilla con permiso).
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
globalThis.window = new EventTarget();
globalThis.document = {
    body: { dataset: {} },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
};

const { setJSON } = await import("../js/persistence.js");
const { getLeaveApplicationInfo, AUDIT_CATEGORY } = await import("../js/auditLog.js");
const {
    cacheFirebaseAuditLogShardEntries,
    stopFirebaseAuditLogShardReader
} = await import("../js/firebaseAuditLogShardReader.js");

const PROFILE = "Hugo Rojas Tapia";
const DAY = "2026-9-8";

function legalLog(extra = {}) {
    return {
        id: "1790000000000_fl",
        category: AUDIT_CATEGORY.LEAVE_ABSENCE,
        action: "Aplicó F. Legal",
        profile: PROFILE,
        createdAt: "2026-10-01T21:36:44.162Z",
        meta: { profile: PROFILE, type: "legal", date: "2026-10-08", amount: 1, keys: [DAY] },
        ...extra
    };
}

const info = () => getLeaveApplicationInfo({ profile: PROFILE, keyDay: DAY, type: "legal" });

beforeEach(() => {
    globalThis.localStorage.clear();
    stopFirebaseAuditLogShardReader();
});

test("un permiso anulado en la bitacora local no revive por una copia atrasada del fragmento", () => {
    setJSON("auditLog", [legalLog({ canceledAt: "2026-10-01T21:41:08.779Z" })]);
    // El fragmento todavia no se entero de la anulacion.
    cacheFirebaseAuditLogShardEntries([legalLog()]);

    assert.equal(info(), null);
});

test("un permiso que solo queda en los fragmentos (podado de la local) se encuentra", () => {
    setJSON("auditLog", []);

    assert.equal(info(), null);

    cacheFirebaseAuditLogShardEntries([legalLog()]);

    assert.equal(info()?.logId, "1790000000000_fl", "la cache se rehizo al llegar el fragmento");
});

test("la cache se rehace cuando cambia la bitacora local", () => {
    setJSON("auditLog", [legalLog()]);

    assert.equal(info()?.logId, "1790000000000_fl");

    setJSON("auditLog", [legalLog({ canceledAt: "2026-10-01T21:41:08.779Z" })]);

    assert.equal(info(), null);
});
