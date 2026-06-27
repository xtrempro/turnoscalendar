import assert from "node:assert/strict";
import test from "node:test";

class MemoryStorage {
    constructor() {
        this.items = new Map();
    }

    getItem(key) {
        return this.items.has(key) ? this.items.get(key) : null;
    }

    setItem(key, value) {
        this.items.set(key, String(value));
    }

    removeItem(key) {
        this.items.delete(key);
    }

    key(index) {
        return Array.from(this.items.keys())[index] ?? null;
    }

    get length() {
        return this.items.size;
    }
}

globalThis.localStorage = new MemoryStorage();

const {
    getShiftAssigned,
    getShiftAssignmentConfiguredState,
    recordShiftAssignmentChange,
    setShiftAssigned
} = await import("../js/storage.js");

test("aplica la asignacion desde el primer dia del mes elegido", () => {
    setShiftAssigned(false, "Ana");
    recordShiftAssignmentChange(true, "2026-07", "Ana");

    assert.equal(
        getShiftAssigned("Ana", new Date(2026, 5, 30)),
        false
    );
    assert.equal(
        getShiftAssigned("Ana", new Date(2026, 6, 1)),
        true
    );
});

test("permite retirar la asignacion desde otro mes", () => {
    recordShiftAssignmentChange(false, "2027-01", "Ana");

    assert.equal(
        getShiftAssigned("Ana", new Date(2026, 11, 31)),
        true
    );
    assert.equal(
        getShiftAssigned("Ana", new Date(2027, 0, 1)),
        false
    );
    assert.equal(
        getShiftAssignmentConfiguredState("Ana"),
        false
    );
});

test("mantiene compatibilidad con perfiles antiguos sin historial", () => {
    setShiftAssigned(true, "Perfil antiguo");

    assert.equal(
        getShiftAssigned("Perfil antiguo", new Date(2020, 0, 1)),
        true
    );
    assert.equal(
        getShiftAssigned("Perfil antiguo", new Date(2030, 0, 1)),
        true
    );
});
