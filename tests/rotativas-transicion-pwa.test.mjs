// Rotativas personalizadas y la PWA vieja: una app anterior a v327 (o el
// Android empaquetado) no entiende `rotativa.definition` y calcula la base
// antigua. Los dias que la rotativa personalizada explica tienen que seguir
// viajando como excepcion; si no, esa app los mostraria libres. Para las
// rotativas de sistema nada cambia.

import test from "node:test";
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
globalThis.window = { dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, location: { hostname: "localhost" } };
globalThis.CustomEvent = class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };

const { saveRotationCatalog, getRotationCatalog } = await import("../js/rotationCatalog.js");
const { baseRenderDay, buildPortableRotativa, dayIsProjectionException } = await import("../js/rotationBase.js");
const { TURNO } = await import("../js/constants.js");

// Una rotativa personalizada: Larga, Larga, Libre.
const catalog = getRotationCatalog();

saveRotationCatalog({
    ...catalog,
    rotations: [
        ...catalog.rotations,
        { id: "larga-larga-libre", name: "Larga larga libre", mode: "sequence", pattern: ["larga", "larga", "libre"], active: true, builtin: false }
    ]
});

const custom = { type: "larga-larga-libre", start: "2026-10-01", firstTurn: "position:0" };
const builtin = { type: "4turno", start: "2026-10-01", firstTurn: "larga" };

test("con rotativa personalizada, sus dias de trabajo viajan aunque la base nueva los explique", () => {
    const portable = buildPortableRotativa(custom);
    const iso = "2026-10-01";
    // El dia real coincide con la base nueva (Larga de su rotativa).
    const day = baseRenderDay(portable, iso);

    assert.equal(day.turno, TURNO.LARGA);
    assert.equal(dayIsProjectionException(day, portable, custom, iso), true, "la PWA vieja calcula Libre: tiene que viajar");

    // Un dia libre de la rotativa coincide con las dos bases: no viaja.
    const free = baseRenderDay(portable, "2026-10-03");

    assert.equal(free.turno, TURNO.LIBRE);
    assert.equal(dayIsProjectionException(free, portable, custom, "2026-10-03"), false);
});

test("las rotativas de sistema no cambian: viaja solo lo que difiere de su base", () => {
    const portable = buildPortableRotativa(builtin);
    const day = baseRenderDay(portable, "2026-10-01");

    assert.equal(portable.definition, undefined);
    assert.equal(dayIsProjectionException(day, portable, builtin, "2026-10-01"), false);
});

test("la posicion inicial viaja resuelta, aunque la rotativa guarde un alias antiguo", () => {
    const portable = buildPortableRotativa({ ...custom, firstTurn: "larga2" });

    assert.equal(portable.firstTurn, "position:1");
});
