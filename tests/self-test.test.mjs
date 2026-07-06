// Corre el mismo auto-test de reglas basicas que el boton del entorno de pruebas,
// pero en Node/CI, para que las reglas core queden cubiertas automaticamente.
import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
    constructor() {
        this.values = new Map();
    }

    get length() {
        return this.values.size;
    }

    clear() {
        this.values.clear();
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    key(index) {
        return [...this.values.keys()][index] ?? null;
    }

    removeItem(key) {
        this.values.delete(key);
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }
}

globalThis.localStorage = new MemoryStorage();
globalThis.document = {
    body: { dataset: {} },
    getElementById() {
        return null;
    },
    querySelector() {
        return null;
    },
    querySelectorAll() {
        return [];
    }
};

const { setJSON } = await import("../js/persistence.js");
// Feriados del anio de prueba para evitar el fetch de red en los permisos.
setJSON("holidaysCache_2026", { "2026-0-1": "Feriado" });

const { runBasicRulesSelfTest } = await import("../js/selfTest.js");

test("todas las auto-pruebas de reglas basicas pasan", async () => {
    const result = await runBasicRulesSelfTest();
    const failures = result.results
        .filter(item => !item.ok)
        .map(item => `- ${item.name}: ${item.error}`);

    assert.equal(
        result.failed,
        0,
        `Auto-pruebas con fallas (${result.failed}/${result.total}):\n${failures.join("\n")}`
    );
    assert.ok(result.total >= 8, "deberian correr varias pruebas");
});
