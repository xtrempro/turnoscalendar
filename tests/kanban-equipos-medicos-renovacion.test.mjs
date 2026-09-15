import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
    setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} },
    click() {}, remove() {}, dataset: {}
};

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
    body: noopEl, documentElement: noopEl,
    createElement: () => ({ ...noopEl }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
};

const { setJSON } = await import("../js/persistence.js");
const {
    MEDICAL_EQUIPMENT_KEY,
    medicalEquipmentContractRenewalKanbanCards
} = await import("../js/medicalEquipment.js");
const { getKanbanCardsForRender } = await import("../js/kanban.js");

const equipment = (extra = {}) => ({
    id: extra.id || "eq-1",
    name: extra.name || "Tomógrafo",
    code: extra.code || "TM-01",
    status: extra.status || "operational",
    serviceProvider: extra.serviceProvider || "Servicio Clínico",
    serviceUntil: extra.serviceUntil || "2026-12-08",
    ...extra
});

test("Equipos Medicos crea tarjeta pendiente cuando faltan 120 dias para renovar", () => {
    const cards = medicalEquipmentContractRenewalKanbanCards("2026-09-08", [
        equipment({ id: "near", name: "Tomógrafo", serviceUntil: "2027-01-06" }),
        equipment({ id: "far", name: "Ecógrafo", serviceUntil: "2027-01-07" })
    ]);

    assert.equal(cards.length, 1);
    assert.equal(cards[0].status, "pending");
    assert.equal(cards[0].source, "medicalEquipmentRenewal");
    assert.equal(cards[0].equipmentId, "near");
    assert.equal(
        cards[0].title,
        "Renovar contrato de mantenimiento del equipo Tomógrafo, la vigencia del contrato dura hasta 06/01/2027"
    );
});

test("la tarjeta automatica se mezcla con el Kanban en Pendientes", () => {
    localStorage.clear();
    setJSON(MEDICAL_EQUIPMENT_KEY, [
        equipment({ id: "rx-1", name: "Rayos X", serviceUntil: "2027-01-06" })
    ]);

    const cards = getKanbanCardsForRender([
        {
            id: "manual-1",
            title: "Revisar acta",
            detail: "",
            status: "done",
            color: "green",
            createdAt: "2026-09-01T10:00:00.000Z",
            updatedAt: "2026-09-01T10:00:00.000Z"
        }
    ], "2026-09-08");

    assert.deepEqual(
        cards.map(card => [card.id, card.status]),
        [
            ["manual-1", "done"],
            ["medical_contract_rx-1_2027-01-06", "pending"]
        ]
    );
});

test("las tarjetas automaticas de renovacion no se editan como manuales", async () => {
    const source = await readFile(new URL("../js/kanban.js", import.meta.url), "utf8");

    assert.match(source, /data-kanban-auto-card/);
    assert.match(source, /data-kanban-medical-equipment/);
    assert.match(source, /getKanbanCardsForRender\(\)/);
    assert.match(source, /medicalEquipmentContractRenewalKanbanCards\(today\)/);
    assert.doesNotMatch(source, /data-kanban-auto-card[\s\S]{0,120}data-kanban-edit/);
});
