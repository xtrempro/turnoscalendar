// Orden de las tarjetas del inicio, por administrador.
//
// Cada administrador arrastra las tarjetas con un clic sostenido y el orden
// queda en SU documento de usuario: no le cambia el inicio a los demas.
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
    visibilityState: "hidden", hidden: true,
    body: noopEl, documentElement: noopEl,
    createElement: () => ({ ...noopEl }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
};
globalThis.alert = () => {};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const {
    HOME_CARD_IDS,
    HOME_LAYOUT_DEFAULT,
    moveHomeCard,
    normalizeHomeLayout,
    receiveRemoteHomeLayout,
    toStoredHomeLayout
} = await import("../js/homeLayout.js");
const { DRAG_HANDLE_HTML, dropTarget, withDragHandle } =
    await import("../js/homeCardDrag.js");
const { getJSON } = await import("../js/persistence.js");

async function read(path) {
    return (await readFile(new URL(path, import.meta.url), "utf8"))
        .replace(/\r\n/g, "\n");
}

const home = await read("../js/home.js");
const homeLayout = await read("../js/homeLayout.js");
const drag = await read("../js/homeCardDrag.js");
const homeTasks = await read("../js/homeTasks.js");
const persistence = await read("../js/persistence.js");
const css = await read("../styles.css");

/* =========================================================
   El orden
========================================================= */

test("sin orden guardado, el de fabrica", () => {
    assert.deepEqual(
        normalizeHomeLayout(null),
        [
            ["tareas", "ausencias", "cambios"],
            ["solicitudes", "incidencias", "cumpleanos"],
            ["resumen", "minical", "cobertura", "brecha"]
        ]
    );
});

test("una tarjeta pasa a otra columna, delante de otra", () => {
    const next = moveHomeCard(null, "minical", 0, "ausencias");

    assert.deepEqual(next[0], ["tareas", "minical", "ausencias", "cambios"]);
    assert.deepEqual(next[2], ["resumen", "cobertura", "brecha"]);
});

test("soltada al final de una columna", () => {
    const next = moveHomeCard(null, "tareas", 1, null);

    assert.deepEqual(next[0], ["ausencias", "cambios"]);
    assert.deepEqual(next[1], ["solicitudes", "incidencias", "cumpleanos", "tareas"]);
});

test("dentro de su misma columna", () => {
    const next = moveHomeCard(null, "brecha", 2, "resumen");

    assert.deepEqual(next[2], ["brecha", "resumen", "minical", "cobertura"]);
});

test("una columna puede quedar vacia y volver a llenarse", () => {
    let layout = null;

    ["tareas", "ausencias", "cambios"].forEach(id => {
        layout = moveHomeCard(layout, id, 1, null);
    });

    assert.deepEqual(layout[0], []);

    layout = moveHomeCard(layout, "resumen", 0, null);

    assert.deepEqual(layout[0], ["resumen"]);
});

test("una tarjeta desconocida no se agrega", () => {
    assert.deepEqual(moveHomeCard(null, "otra", 0, null), normalizeHomeLayout(null));
});

test("un guardado viejo o dañado no pierde tarjetas", () => {
    // Sin el mini calendario (guardado de antes de que existiera), con una
    // tarjeta que ya no existe y una repetida.
    const layout = normalizeHomeLayout({
        col0: ["cobertura", "vieja", "tareas"],
        col1: ["tareas", "solicitudes"],
        col2: ["resumen"]
    });

    assert.deepEqual(layout[0], ["cobertura", "tareas", "ausencias", "cambios"]);
    assert.deepEqual(layout[1], ["solicitudes", "incidencias", "cumpleanos"]);
    // Las que faltaban vuelven a su columna de fabrica, al final.
    assert.deepEqual(layout[2], ["resumen", "minical", "brecha"]);
    // Cada tarjeta, exactamente una vez.
    assert.deepEqual(layout.flat().sort(), [...HOME_CARD_IDS].sort());
});

test("se guarda sin arreglos dentro de arreglos", () => {
    // Firestore no los admite: las columnas van como un mapa.
    const layout = moveHomeCard(null, "minical", 0, null);
    const stored = toStoredHomeLayout(layout);

    assert.deepEqual(Object.keys(stored), ["col0", "col1", "col2"]);
    Object.values(stored).forEach(column => {
        assert.ok(column.every(id => typeof id === "string"));
    });
    assert.deepEqual(normalizeHomeLayout(stored), layout);
});

/* =========================================================
   De quien es el orden
========================================================= */

test("el orden es de cada administrador, no de la unidad", () => {
    // La copia local no viaja por el estado compartido...
    assert.match(persistence, /"homeLayout_",/);
    // ...y en la nube va a SU documento, el de sus tareas privadas.
    assert.match(
        homeLayout,
        /firestoreModule\.doc\(\s*\n\s*db, "users", user\.uid, "workspaces", workspace\.id\s*\n\s*\)/
    );
    assert.match(homeLayout, /\{ homeLayout: stored \},\s*\n\s*\{ merge: true \}/);
    // Lo trae el mismo listener que el de las tareas.
    assert.match(
        homeTasks,
        /receiveRemoteHomeLayout\(data\.homeLayout, currentUid, currentWid\);/
    );
});

test("lo que llega del servidor reemplaza la copia local y avisa una vez", () => {
    localStorage.clear();

    const avisos = [];
    const original = globalThis.window.dispatchEvent;

    globalThis.window.dispatchEvent = event => {
        avisos.push(event.type);
        return true;
    };

    try {
        const stored = toStoredHomeLayout(moveHomeCard(null, "brecha", 0, null));

        assert.equal(receiveRemoteHomeLayout(stored, "u1", "w1"), true);
        assert.deepEqual(getJSON("homeLayout_u1_w1", null), stored);
        // El eco de la propia escritura no repinta.
        assert.equal(receiveRemoteHomeLayout(stored, "u1", "w1"), false);
        // Sin orden en el servidor se respeta la copia local.
        assert.equal(receiveRemoteHomeLayout(undefined, "u1", "w1"), false);
        assert.deepEqual(getJSON("homeLayout_u1_w1", null), stored);
    } finally {
        globalThis.window.dispatchEvent = original;
    }

    assert.equal(
        avisos.filter(type => type === "proturnos:homeLayoutChanged").length,
        1
    );
});

test("el inicio se pinta con el orden guardado", () => {
    assert.match(home, /\$\{getHomeLayout\(\)\.map\(column => `/);
    assert.match(home, /return withDragHandle\(HOME_CARDS\[id\]\?\.\(\) \|\| "", id\);/);
    // Cada id del orden tiene su tarjeta.
    HOME_CARD_IDS.forEach(id => {
        assert.match(home, new RegExp(`\\n    ${id}: \\w+Widget,?\\n`), id);
    });
    assert.deepEqual(HOME_LAYOUT_DEFAULT.flat().length, HOME_CARD_IDS.length);
});

test("un cambio desde otro equipo no reordena en medio de un arrastre", () => {
    assert.match(
        home,
        /window\.addEventListener\(HOME_LAYOUT_EVENT, \(\) => \{[\s\S]{0,300}if \(isHomeCardDragActive\(\)\) return;/
    );
});

/* =========================================================
   El arrastre
========================================================= */

test("cada tarjeta lleva su id y la manija de cuatro puntos", () => {
    const html = withDragHandle(
        `\n        <div class="hm-card hm-col-4 hm-minical">\n            <div class="hm-head">Mes</div>\n        </div>`,
        "minical"
    );

    assert.match(
        html,
        /<div data-hm-card="minical" class="hm-card hm-col-4 hm-minical"><span class="hm-drag-handle" data-hm-drag-handle/
    );
    // El resto de la tarjeta queda igual.
    assert.match(html, /<div class="hm-head">Mes<\/div>\s*<\/div>$/);
    assert.equal((DRAG_HANDLE_HTML.match(/<circle /g) || []).length, 4);
    // Una tarjeta que hoy no se muestra sigue sin mostrarse.
    assert.equal(withDragHandle("", "brecha"), "");
});

test("se arrastra solo desde la manija, con la mano encima", () => {
    // El resto de la tarjeta sigue siendo lo que era: botones, texto, listas.
    assert.match(drag, /const handle = event\.target\.closest\?\.\("\[data-hm-drag-handle\]"\);/);
    // Un clic suelto sobre la manija no mueve nada: hay que moverse con el
    // clic apretado.
    assert.match(drag, /if \(moved > DRAG_START_PX\) \{/);
    assert.match(css, /\.hm-drag-handle \{[\s\S]{0,400}cursor: grab;/);
    assert.match(css, /body\.hm-arranging \* \{ cursor: grabbing !important;/);
    // Bajo 1100 px no se arrastra, asi que la manija ni se muestra.
    assert.match(css, /\.hm-drag-handle \{ display: none; \}\s*\n@media \(min-width: 1101px\)/);
});

test("solo con las tres columnas a la vista", () => {
    // Bajo 1100 px las pilas se disuelven y no hay columna donde soltar.
    assert.match(drag, /export const DRAG_MEDIA_QUERY = "\(min-width: 1101px\)";/);
    assert.match(
        css,
        /@media \(max-width: 1100px\) \{[\s\S]{0,400}\.hm-stack \{ display: contents; \}/
    );
});

test("soltar no termina en un clic sobre lo que quedo debajo", () => {
    assert.match(drag, /suppressClickUntil = Date\.now\(\) \+ CLICK_GUARD_MS;/);
});

test("Escape devuelve la tarjeta a su lugar sin guardar", () => {
    assert.match(drag, /if \(event\.key === "Escape"\) cancelDrag\(\);/);
    assert.match(
        drag,
        /function cancelDrag\(\) \{[\s\S]{0,200}originParent\.insertBefore\(card, originNext\);/
    );
});

function fakeCard(id, top, height = 100) {
    return {
        dataset: { hmCard: id },
        matches: selector => selector === "[data-hm-card]",
        getBoundingClientRect: () => ({ top, height })
    };
}

function fakeStack(left, right, cards) {
    return {
        classList: { contains: name => name === "hm-stack" },
        getBoundingClientRect: () => ({ left, right }),
        children: cards
    };
}

test("donde cae la tarjeta que se suelta", () => {
    const tareas = fakeCard("tareas", 0);
    const ausencias = fakeCard("ausencias", 120);
    const resumen = fakeCard("resumen", 0);
    const grid = {
        children: [
            fakeStack(0, 300, [tareas, ausencias]),
            fakeStack(316, 616, [resumen]),
            fakeStack(632, 932, [])
        ]
    };

    // Sobre la mitad de arriba de "tareas": delante de ella.
    assert.equal(dropTarget(grid, 100, 20).before, tareas);
    // Sobre la mitad de abajo de "tareas": delante de "ausencias".
    assert.equal(dropTarget(grid, 100, 80).before, ausencias);
    // Debajo de todo: al final de la columna.
    assert.equal(dropTarget(grid, 100, 400).before, null);
    // Entre dos columnas cuenta la mas cercana.
    assert.equal(dropTarget(grid, 310, 20).column, 1);
    // Una columna vacia recibe.
    assert.deepEqual(
        { column: dropTarget(grid, 700, 20).column, before: dropTarget(grid, 700, 20).before },
        { column: 2, before: null }
    );
    // La tarjeta que se arrastra no cuenta como vecina.
    assert.equal(dropTarget(grid, 100, 20, tareas).before, ausencias);
});

/* =========================================================
   Incidencias de marcaje
========================================================= */

test("incidencias de marcaje crece sin barra de scroll", () => {
    assert.match(home, /class="hm-listcol hm-inc-list" data-hm="inc-list"/);
    assert.doesNotMatch(css, /\.hm-inc-list\.hm-scroller/);
});
