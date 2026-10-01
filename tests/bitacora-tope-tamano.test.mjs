// La bitacora viaja a Firestore como UN solo valor y las reglas lo limitan a
// 900.000 caracteres (firebase.rules, entries: value.size() <= 900000).
//
// Con el tope por cantidad solamente (1500 entradas), una unidad activa llegaba
// al limite de tamaño mucho antes: se midio 899.568 caracteres en produccion,
// el 99,95% del tope. Ahi cualquier guardado que sumara una entrada se
// rechazaba con "Missing or insufficient permissions", y como la bitacora viaja
// en la misma tanda que el resto del cambio, arrastraba lo demas: el cambio
// quedaba en el equipo y no llegaba nunca a los otros supervisores.
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
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    body: { dataset: {} },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
};

const { trimAuditLogs } = await import("../js/auditLog.js");

// El tope que exige la regla de Firestore.
const TOPE_REGLA = 900000;

const entrada = (i, largo = 600) => ({
    id: `log_${i}`,
    category: "turnos",
    action: "Registro cambio de turno",
    details: "x".repeat(largo),
    createdAt: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T10:00:00.000Z`
});

test("una bitacora chica pasa intacta", () => {
    const logs = Array.from({ length: 10 }, (_, i) => entrada(i, 50));

    assert.deepEqual(trimAuditLogs(logs), logs);
});

test("se respeta el tope de cantidad", () => {
    const logs = Array.from({ length: 1800 }, (_, i) => entrada(i, 10));
    const trimmed = trimAuditLogs(logs);

    assert.ok(trimmed.length <= 1500);
    // Se bota lo mas viejo: sobrevive el final.
    assert.equal(trimmed[trimmed.length - 1].id, "log_1799");
});

test("y ahora tambien el tope de tamaño", () => {
    // 1500 entradas de 700 caracteres son ~1,05 MB: pasaban el tope de cantidad
    // pero reventaban la regla.
    const logs = Array.from({ length: 1500 }, (_, i) => entrada(i, 700));

    assert.ok(
        JSON.stringify(logs).length > TOPE_REGLA,
        "el caso de prueba tiene que exceder el tope"
    );

    const trimmed = trimAuditLogs(logs);
    const size = JSON.stringify(trimmed).length;

    assert.ok(
        size <= TOPE_REGLA,
        `quedo en ${size}, sobre el tope de la regla`
    );
    // Y con holgura, para que entren varias entradas antes de la proxima poda.
    assert.ok(size <= 450000, `quedo en ${size}, sin margen`);
});

test("lo que sobrevive es lo mas reciente", () => {
    const logs = Array.from({ length: 1500 }, (_, i) => entrada(i, 700));
    const trimmed = trimAuditLogs(logs);

    assert.equal(trimmed[trimmed.length - 1].id, "log_1499");
    // Y no queda nada de lo mas viejo.
    assert.equal(trimmed.some(log => log.id === "log_0"), false);
});

test("una sola entrada enorme no deja la bitacora vacia", () => {
    // Se conserva al menos una: perder el ultimo registro seria peor que
    // pasarse del tope, y la regla igual lo rechazaria solo a el.
    const logs = [entrada(0, 2000000)];

    assert.equal(trimAuditLogs(logs).length, 1);
});

test("con entradas de tamaño mezclado tambien queda bajo el tope", () => {
    const logs = Array.from({ length: 1200 }, (_, i) =>
        entrada(i, i % 7 === 0 ? 4000 : 300)
    );
    const trimmed = trimAuditLogs(logs);

    assert.ok(JSON.stringify(trimmed).length <= 450000);
    assert.ok(trimmed.length > 0);
});

test("una lista vacia o rota no revienta", () => {
    assert.deepEqual(trimAuditLogs([]), []);
    assert.deepEqual(trimAuditLogs(null), []);
    assert.deepEqual(trimAuditLogs(undefined), []);
});

test("todos los guardados de la bitacora podan por tamaño", async () => {
    // Todos los sitios que guardan deben pasar por el mismo tope: si alguno se
    // quedara sin podar por tamaño, volveria a llevar la clave al tope.
    const source = (await readFile(
        new URL("../js/auditLog.js", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    assert.doesNotMatch(source, /setJSON\(KEY, [^)]*slice\(-MAX_LOGS\)\)/);
    assert.equal((source.match(/setJSON\(KEY, trimLogs\(/g) || []).length, 4);
});

test("el tope de la prueba es el mismo que exige la regla", async () => {
    // Si alguien cambia la regla, esta prueba tiene que enterarse.
    const rules = await readFile(
        new URL("../firebase.rules", import.meta.url),
        "utf8"
    );

    assert.match(rules, /value\.size\(\) <= 900000/);
});
