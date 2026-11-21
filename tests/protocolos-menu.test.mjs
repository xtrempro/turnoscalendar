// Protocolos: menu propio aqui y en la PWA. Un protocolo es una informacion de
// categoria "protocolo" (mismo documento publicado, destinatarios,
// confirmaciones y archivos) con una SUBCATEGORIA libre que los agrupa.
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
    setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    click() {}, remove() {}, dataset: {}
};

globalThis.localStorage = new MemoryStorage();
globalThis.window = Object.assign(new EventTarget(), {
    location: { hostname: "localhost", href: "http://localhost/" },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: id => clearTimeout(id),
    requestAnimationFrame: callback => setTimeout(callback, 0)
});
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    visibilityState: "hidden", hidden: true,
    body: noopEl, documentElement: noopEl,
    createElement: () => ({ ...noopEl }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const {
    isProtocol,
    normalizeSubcategory,
    protocolSubcategories
} = await import("../js/informationsModel.js");
const {
    normalizeInformations,
    publicInformationsPayload
} = await import("../js/informations.js");

test("un protocolo es una informacion de categoria protocolo", () => {
    assert.equal(isProtocol({ category: "protocolo" }), true);
    assert.equal(isProtocol({ category: "PROTOCOLO" }), true);
    assert.equal(isProtocol({ category: "general" }), false);
    assert.equal(isProtocol({}), false);
});

test("la subcategoria se limpia y las repetidas se juntan", () => {
    assert.equal(normalizeSubcategory("  Radio   proteccion "), "Radio proteccion");
    assert.equal(normalizeSubcategory("x".repeat(90)).length, 60);
    assert.deepEqual(
        protocolSubcategories([
            { category: "protocolo", subcategory: "Urgencias" },
            { category: "protocolo", subcategory: "equipos" },
            { category: "protocolo", subcategory: "URGENCIAS" },
            { category: "protocolo", subcategory: "" },
            // Una informacion comun no aporta subcategorias.
            { category: "general", subcategory: "Turnos" }
        ]),
        ["equipos", "Urgencias"]
    );
});

test("la subcategoria se guarda solo en protocolos y viaja a la PWA", () => {
    const items = normalizeInformations([
        { id: "p1", title: "Contraste", body: "x", category: "protocolo", subcategory: " Resonancia " },
        { id: "i1", title: "Aviso", body: "y", category: "general", subcategory: "No va" }
    ]);
    const byId = Object.fromEntries(items.map(item => [item.id, item]));

    assert.equal(byId.p1.subcategory, "Resonancia");
    assert.equal(byId.i1.subcategory, "");

    const published = Object.fromEntries(publicInformationsPayload(items).map(item => [item.id, item]));

    assert.equal(published.p1.subcategory, "Resonancia");
    assert.equal(published.p1.category, "protocolo");
});

test("el tope de 200 descarta solo informaciones, nunca protocolos", () => {
    const day = index => new Date(Date.UTC(2026, 0, 1) + index * 3600000).toISOString();
    const raw = [
        // Protocolos MAS VIEJOS que cualquier informacion: con un tope comun serian los primeros en caer.
        ...Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, title: `P${i}`, body: "x", category: "protocolo", publishedAt: day(i) })),
        ...Array.from({ length: 205 }, (_, i) => ({ id: `i${i}`, title: `I${i}`, body: "y", category: "general", publishedAt: day(100 + i) }))
    ];
    const items = normalizeInformations(raw);
    const ids = new Set(items.map(item => item.id));

    assert.equal(items.filter(item => item.category === "protocolo").length, 3);
    assert.equal(items.filter(item => item.category !== "protocolo").length, 200);
    // Caen las 5 informaciones mas viejas.
    for (let i = 0; i < 5; i += 1) assert.equal(ids.has(`i${i}`), false);
    assert.equal(ids.has("i5"), true);
});

test("guardar fija el borrador y su menu: cambiar de menu durante la subida no publica en otro (P2-1)", async () => {
    const panel = (await read("../js/informations.js")).replace(/\r\n/g, "\n");
    const start = panel.indexOf("async function persistDraft(");
    const body = panel.slice(start, panel.indexOf("\nfunction findInformationAttachment(", start));
    const pinned = body.indexOf("const draft = composerDraft;");

    assert.ok(pinned > 0, "persistDraft fija el borrador");
    assert.match(body, /const draftSection = section;/);
    // Despues de fijarlo, nada vuelve a leer los globales que cambia useSection.
    assert.doesNotMatch(body.slice(pinned + "const draft = composerDraft;".length), /composerDraft|inProtocols\(\)/);
    assert.match(body, /category: draftSection === "protocols"/);
    assert.match(body, /finishSavedDraft\(draft, draftSection,/);
    // Y al cerrar solo se limpia ESE borrador, en su menu.
    assert.match(panel, /if \(saved && saved\.composerDraft === draft\)/);
    assert.match(panel, /if \(composerDraft === draft\)/);
});

test("una subcategoria llamada Todas no choca con el filtro del sistema (P3-1)", async () => {
    const panel = await read("../js/informations.js");

    assert.match(panel, /id: `sub:\$\{label\.toLowerCase\(\)\}`/);
    assert.match(panel, /\(sub \? `sub:\$\{sub\}` : NO_SUBCATEGORY\) !== categoryFilter/);
});

test("el menu Protocolos esta conectado, con el permiso de Informaciones", async () => {
    const [html, main, navigation, permissions, css, panel, functionsIndex] = await Promise.all([
        read("../index.html"),
        read("../js/main.js"),
        read("../js/navigation.js"),
        read("../js/workspacePermissions.js"),
        read("../styles.css"),
        read("../js/informations.js"),
        read("../functions/index.js")
    ]);

    assert.match(html, /data-target="protocolsPanel"[\s\S]{0,700}Protocolos/);
    assert.match(html, /<section id="protocolsPanel" class="panel informations-panel"><\/section>/);
    assert.match(navigation, /targetId === "protocolsPanel"[\s\S]{0,60}return "protocols";/);
    // Sin permiso propio: lo que se guarda es una informacion.
    assert.match(permissions, /protocolsPanel: "informations"/);
    assert.match(main, /nextView === "protocols"[\s\S]{0,80}renderProtocolsPanel\(\)/);
    assert.match(css, /body:not\(\[data-active-view="protocols"\]\) #protocolsPanel/);
    // Cada menu ve solo lo suyo, y Informaciones ya no ofrece la categoria.
    assert.match(panel, /inProtocols\(\) \? isProtocol\(item\) : !isProtocol\(item\)/);
    assert.match(panel, /category\.id !== PROTOCOL_CATEGORY/);
    // El aviso al telefono dice "Nuevo protocolo" y abre su pantalla.
    assert.match(functionsIndex, /const title = protocol \? "Nuevo protocolo" : "Nueva informacion";/);
    assert.match(functionsIndex, /const screen = protocol \? "protocolos" : "informaciones";/);
});
