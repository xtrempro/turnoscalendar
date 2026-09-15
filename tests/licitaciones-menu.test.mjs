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
    body: noopEl,
    documentElement: noopEl,
    createElement: () => ({ ...noopEl }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
};

async function read(path) {
    return readFile(new URL(path, import.meta.url), "utf8");
}

test("Licitaciones queda enganchado a menu, permisos, sync, adjuntos y Kanban", async () => {
    const [
        html,
        main,
        navigation,
        permissions,
        modules,
        attachments,
        firestoreRules,
        storageRules,
        css,
        kanban
    ] = await Promise.all([
        read("../index.html"),
        read("../js/main.js"),
        read("../js/navigation.js"),
        read("../js/workspacePermissions.js"),
        read("../js/firebaseStateModules.js"),
        read("../js/attachmentUtils.js"),
        read("../firebase.rules"),
        read("../storage.rules"),
        read("../styles.css"),
        read("../js/kanban.js")
    ]);

    const equipmentNavIndex = html.indexOf('data-target="medicalEquipmentPanel"');
    const tendersNavIndex = html.indexOf('data-target="tendersPanel"');
    const kanbanNavIndex = html.indexOf('data-target="kanbanPanel"');

    assert.match(html, /data-target="tendersPanel"[\s\S]{0,700}Licitaciones/);
    assert.ok(tendersNavIndex > equipmentNavIndex);
    assert.ok(kanbanNavIndex > tendersNavIndex);
    assert.match(html, /<section id="tendersPanel" class="panel tenders-panel"><\/section>/);
    assert.match(navigation, /targetId === "tendersPanel"[\s\S]{0,90}return "tenders";/);
    assert.match(main, /initTendersPanel/);
    assert.match(main, /renderTendersPanel/);
    assert.match(permissions, /key: "tenders"[\s\S]{0,120}target: "tendersPanel"/);
    assert.match(modules, /tenders:\s*\{\s*permission:\s*"tenders"\s*\}/);
    assert.match(modules, /\["tenders",\s*"tenders"\]/);
    assert.match(attachments, /"tenders"/);
    assert.match(firestoreRules, /moduleId == "tenders" && canViewMenu\(workspaceId, "tenders"\)/);
    assert.match(firestoreRules, /moduleId == "tenders" && canEditMenu\(workspaceId, "tenders"\)/);
    assert.match(storageRules, /tendersEnabledByDefault/);
    assert.match(css, /body:not\(\[data-active-view="tenders"\]\) #tendersPanel/);
    assert.match(css, /\.actionbar \.nav-tile\[data-target="tendersPanel"\]\s*\{[\s\S]{0,80}order:\s*14/);
    assert.match(kanban, /tenderRenewalKanbanCards\(today\)/);
    assert.match(kanban, /data-kanban-tender/);
});

test("Licitaciones queda activo para administradores legados con permiso completo", async () => {
    const { normalizeMenuPermissions } =
        await import("../js/workspacePermissions.js");

    const fullLegacy = normalizeMenuPermissions({
        profile: { view: true, edit: true },
        turnos: { view: true, edit: true },
        holders: { view: true, edit: true },
        swap: { view: true, edit: true },
        clockmarks: { view: true, edit: true },
        reports: { view: true, edit: true },
        requests: { view: true, edit: true },
        weekly: { view: true, edit: true },
        tasks: { view: true, edit: true },
        kanban: { view: true, edit: true },
        agenda: { view: true, edit: true },
        hours: { view: true, edit: true },
        memos: { view: true, edit: true },
        dashboard: { view: true, edit: true },
        log: { view: true, edit: true }
    });
    const explicitReadOnly = normalizeMenuPermissions({
        tenders: { view: true, edit: false }
    });
    const explicitOff = normalizeMenuPermissions({
        tenders: { view: false, edit: false }
    });

    assert.deepEqual(fullLegacy.tenders, { view: true, edit: true });
    assert.deepEqual(explicitReadOnly.tenders, { view: true, edit: false });
    assert.deepEqual(explicitOff.tenders, { view: false, edit: false });
});

test("Licitaciones genera tarjetas automaticas por vencimiento o saldo bajo", async () => {
    const { TENDERS_KEY, tenderRenewalKanbanCards } =
        await import("../js/tenders.js");
    const { setJSON } = await import("../js/persistence.js");
    const { getKanbanCardsForRender } = await import("../js/kanban.js");

    const near = {
        id: "lic-near",
        name: "Servicio scanner",
        service: "Imagenologia",
        provider: "Proveedor Uno",
        status: "active",
        endDate: "2027-01-13",
        amount: 1000000
    };
    const far = {
        id: "lic-far",
        name: "Servicio lejano",
        service: "Imagenologia",
        status: "active",
        endDate: "2027-01-14",
        amount: 1000000
    };
    const budget = {
        id: "lic-budget",
        name: "Insumos contraste",
        service: "Imagenologia",
        status: "active",
        expirationMode: "dateOrBudget",
        endDate: "2027-12-31",
        amount: 1000000,
        invoices: [{ id: "inv-1", number: "45", amount: 850000, status: "pending" }]
    };

    const cards = tenderRenewalKanbanCards("2026-09-15", [near, far, budget]);

    assert.deepEqual(cards.map(card => card.tenderId), ["lic-near", "lic-budget"]);
    assert.equal(cards[0].source, "tenderRenewal");
    assert.equal(cards[0].status, "pending");

    localStorage.clear();
    setJSON(TENDERS_KEY, [near]);
    const rendered = getKanbanCardsForRender([], "2026-09-15");
    assert.equal(rendered[0].id, "tender_renewal_lic-near_2027-01-13");
});
