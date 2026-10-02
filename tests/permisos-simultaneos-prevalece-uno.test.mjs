// Dos supervisores aplican permisos DISTINTOS al mismo trabajador el mismo dia
// casi a la vez: prevalece el que se aplico primero y el segundo lo anula la
// sesion que lo aplico (js/leaveConflicts.js).
//
// Paso el 2026-10-01 en test: un F. Legal y un F. Compensatorio a Amanda con
// 0,6 s de diferencia quedaron LOS DOS guardados sobre los dias 6 al 20.
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
const alerts = [];
globalThis.window.alert = message => alerts.push(String(message));
globalThis.alert = globalThis.window.alert;
globalThis.document = {
    body: { dataset: {} },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
};

const { setJSON, getJSON } = await import("../js/persistence.js");
const { addAuditLog, AUDIT_CATEGORY, getAuditLogs } = await import("../js/auditLog.js");
const {
    leaveConflictWinner,
    otherLeaveTypesOnDay,
    resolveOwnLeaveConflicts,
    findUnresolvedLeaveConflicts,
    RACE_WINDOW_MS
} = await import("../js/leaveConflicts.js");

const AMANDA = "Amanda Rojas Herrera";
const DAY = "2026-9-6";

// El permiso que aplico OTRA sesion: llega por la sincronizacion, con su
// registro en la bitacora.
function otherSessionLegal(createdAt) {
    setJSON(`legal_${AMANDA}`, { [DAY]: true });
    setJSON("auditLog", [
        ...getJSON("auditLog", []),
        {
            id: "otra-sesion-legal",
            category: AUDIT_CATEGORY.LEAVE_ABSENCE,
            action: "Aplicó F. Legal",
            profile: AMANDA,
            createdAt,
            meta: { profile: AMANDA, type: "legal", date: "2026-10-06", amount: 1, keys: [DAY] }
        }
    ]);
}

// El permiso que aplico ESTA sesion.
function thisSessionAdmin() {
    setJSON(`admin_${AMANDA}`, { [DAY]: 1 });

    return addAuditLog(
        AUDIT_CATEGORY.LEAVE_ABSENCE,
        "Aplicó P. Administrativo",
        `${AMANDA}: 1 día.`,
        { profile: AMANDA, type: "admin", date: "2026-10-06", amount: 1, keys: [DAY] }
    );
}

beforeEach(() => {
    globalThis.localStorage.clear();
    alerts.length = 0;
    setJSON("profiles", [{ name: AMANDA, active: true }]);
});

test("gana el aplicado primero; en el mismo milisegundo, el de id menor", () => {
    const at = "2026-10-01T23:58:01.000Z";

    assert.equal(leaveConflictWinner({ id: "b", createdAt: "2026-10-01T23:58:01.743Z" }, { id: "a", createdAt: "2026-10-01T23:58:01.119Z" }), "other");
    assert.equal(leaveConflictWinner({ id: "a", createdAt: "2026-10-01T23:58:01.119Z" }, { id: "b", createdAt: "2026-10-01T23:58:01.743Z" }), "mine");
    assert.equal(leaveConflictWinner({ id: "b", createdAt: at }, { id: "a", createdAt: at }), "other");
    assert.equal(leaveConflictWinner({ id: "a", createdAt: at }, { id: "b", createdAt: at }), "mine");
});

test("fuera de la ventana no es una carrera: no se toca", () => {
    const later = new Date(Date.parse("2026-10-01T23:58:01.000Z") + RACE_WINDOW_MS + 1000).toISOString();

    assert.equal(leaveConflictWinner({ id: "b", createdAt: later }, { id: "a", createdAt: "2026-10-01T23:58:01.000Z" }), "none");
});

test("ve los permisos de OTROS mapas del mismo dia, no el propio", () => {
    const maps = { admin: { [DAY]: 1 }, legal: { [DAY]: true }, comp: {}, absences: {} };

    assert.deepEqual(otherLeaveTypesOnDay(maps, DAY, "admin"), ["legal"]);
    assert.deepEqual(otherLeaveTypesOnDay(maps, DAY, "legal"), ["admin"]);
    assert.deepEqual(otherLeaveTypesOnDay(maps, "2026-9-7", "legal"), []);
});

test("si el ajeno se aplico ANTES, esta sesion anula el suyo y queda uno solo", async () => {
    otherSessionLegal(new Date(Date.now() - 600).toISOString());
    const mine = thisSessionAdmin();

    const undone = await resolveOwnLeaveConflicts();

    assert.deepEqual(undone.map(item => item.log.id), [mine.id]);
    assert.equal(getJSON(`admin_${AMANDA}`, {})[DAY], undefined, "se quito el P. Administrativo");
    assert.equal(getJSON(`legal_${AMANDA}`, {})[DAY], true, "el F. Legal sigue");
    assert.ok(getAuditLogs().find(log => log.id === mine.id)?.canceledAt, "su registro queda anulado");
    assert.match(alerts.join("\n"), /antes que tú/);
});

test("si el propio se aplico ANTES, no se anula nada (lo anula la otra sesion)", async () => {
    const mine = thisSessionAdmin();
    otherSessionLegal(new Date(Date.parse(mine.createdAt) + 600).toISOString());

    const undone = await resolveOwnLeaveConflicts();

    assert.deepEqual(undone, []);
    assert.equal(getJSON(`admin_${AMANDA}`, {})[DAY], 1);
    assert.equal(alerts.length, 0);
});

test("un permiso puesto mucho despues de otro no es carrera: no se anula", async () => {
    otherSessionLegal(new Date(Date.now() - RACE_WINDOW_MS - 60000).toISOString());
    thisSessionAdmin();

    assert.deepEqual(await resolveOwnLeaveConflicts(), []);
    assert.equal(getJSON(`admin_${AMANDA}`, {})[DAY], 1);
});

test("respaldo: un choque que nadie resolvio se detecta pasado el margen", () => {
    const t0 = Date.parse("2026-10-01T23:58:01.000Z");

    setJSON(`legal_${AMANDA}`, { [DAY]: true });
    setJSON(`comp_${AMANDA}`, { [DAY]: true });
    setJSON("auditLog", [
        { id: "x1", category: AUDIT_CATEGORY.LEAVE_ABSENCE, action: "Aplicó F. Legal", profile: AMANDA, createdAt: new Date(t0).toISOString(), meta: { profile: AMANDA, type: "legal", date: "2026-10-06", amount: 1, keys: [DAY] } },
        { id: "x2", category: AUDIT_CATEGORY.LEAVE_ABSENCE, action: "Aplicó F. Compensatorio", profile: AMANDA, createdAt: new Date(t0 + 600).toISOString(), meta: { profile: AMANDA, type: "comp", date: "2026-10-06", amount: 1, keys: [DAY] } }
    ]);

    // Antes del margen se espera a que la sesion que lo aplico lo resuelva.
    assert.deepEqual(findUnresolvedLeaveConflicts(t0 + 10000), []);

    const found = findUnresolvedLeaveConflicts(t0 + 5 * 60000);

    assert.equal(found.length, 1);
    assert.deepEqual(found[0].types.sort(), ["comp", "legal"]);
});
