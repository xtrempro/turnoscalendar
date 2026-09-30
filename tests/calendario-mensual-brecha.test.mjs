// Calendario Mensual y Brecha RRHH: los cupos van en Titulares. Va en su propio
// archivo porque staffing.js guarda en memoria perfiles y el barrido de la
// Brecha, y solo los vacia con eventos que las pruebas no reenvian: junto a las
// demas pruebas del mes calcularia con los perfiles de otra prueba.

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

const noopEl = {
    addEventListener() {}, removeEventListener() {}, appendChild() {},
    setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    click() {}, remove() {}, dataset: {}
};

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost", href: "http://localhost/" },
    matchMedia: () => ({ matches: false, addEventListener() {} })
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

const { setJSON } = await import("../js/persistence.js");
const mensual = await import("../js/monthlyCalendar.js");
const { saveReplacement } = await import("../js/replacements.js");

// Profesiones reales de la app (storage.js normaliza las que no reconoce).
const TM = "TM Imagenología";
const TENS = "Técnico en Enfermería";

test("los cupos de la Brecha RRHH van en Titulares; quien lo cubre, en rojo con ellos", async () => {
    // Cuatro grupos de 4to turno desfasados un dia: A, B y C con dos TM; al D
    // le falta uno.
    const personas = [];

    ["2026-10-01", "2026-09-30", "2026-09-29", "2026-09-28"].forEach((start, grupo) => {
        const cuantos = grupo === 3 ? 1 : 2;

        for (let i = 0; i < cuantos; i++) {
            personas.push({ name: `Tm${grupo}${i} Apellido`, start, estamento: "Profesional", profession: TM });
        }
        personas.push({ name: `Tens${grupo} Apellido`, start, estamento: "Técnico", profession: TENS });
    });
    setJSON("profiles", personas.map(({ start, ...perfil }) => ({ ...perfil, active: true })));
    personas.forEach(p => setJSON("rotativa_" + p.name, { type: "4turno", start: p.start, firstTurn: "larga" }));

    // Noviembre: ninguna otra prueba lo calcula, asi que el barrido de la
    // Brecha (que queda en cache hasta un cambio de datos) es de este fixture.
    let mes = await mensual.buildMonthlyCalendar(new Date(2026, 10, 1), TM);
    const dia = mes.rows[2];

    // El 3 de noviembre el grupo D esta de Larga con un TM de menos.
    assert.equal(dia.cupos.day.length, 1);
    assert.equal(dia.cupos.day[0].group, "D");
    assert.equal(dia.cupos.day[0].reference, "Tm30 Apellido");

    // Lo que guarda el CUBRIR del cupo (modo rota del modal de sugerencias).
    saveReplacement({
        worker: "Tm00 Apellido",
        replaced: "",
        reason: dia.cupos.day[0].motive,
        keyDay: "2026-10-3",
        turno: 1,
        absenceType: "",
        source: "rota_gap"
    });
    mes = await mensual.buildMonthlyCalendar(new Date(2026, 10, 1), TM);

    const cubre = mes.rows[2].slots.day.find(p => p.name === "Tm00 Apellido");

    assert.ok(cubre?.covering && cubre.brecha);
    assert.deepEqual(mes.extraColumns.day, []);
});

