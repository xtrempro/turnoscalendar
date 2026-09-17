// Grafico del dashboard: HH.EE por trabajador de una profesion, mes a mes.
// Trabajadores en el eje X, horas en el eje Y, apiladas en diurnas y nocturnas
// (la altura total es la suma, que es lo que se compara entre personas).
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
    buildOvertimeByWorkerRows,
    overtimeProfessionFilters,
    renderOvertimeByWorker
} =
    await import("../js/dashboard.js");
const { TURNO } = await import("../js/constants.js");

const YEAR = 2026;
const MONTH = 7;
const PROFESSION = "TM Imagenología";

function seed() {
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify([
        { id: "p-1", name: "Ana Perez", estamento: "Profesional", profession: PROFESSION, active: true },
        { id: "p-2", name: "Bruno Soto Vera", estamento: "Profesional", profession: PROFESSION, active: true },
        // Otra profesion: no debe aparecer.
        { id: "p-3", name: "Carla Diaz", estamento: "Técnico", profession: "Técnico en Imagenología", active: true },
        // Inactiva: tampoco.
        { id: "p-4", name: "Dora Rojas", estamento: "Profesional", profession: PROFESSION, active: false },
        { id: "p-5", name: "Eduardo Admin Ruiz", estamento: "Administrativo", profession: "Tecnico en Administracion de Empresas", active: true },
        { id: "p-6", name: "Fabian Auxiliar Lagos", estamento: "Auxiliar", profession: "Auxiliar de Servicio", active: true },
        { id: "p-7", name: "Gala Sin Dato", estamento: "Profesional", profession: "Sin informacion", active: true }
    ]));

    [
        "Ana Perez", "Bruno Soto Vera", "Carla Diaz", "Dora Rojas",
        "Eduardo Admin Ruiz", "Fabian Auxiliar Lagos", "Gala Sin Dato"
    ].forEach(name => {
        localStorage.setItem(`shift_${name}`, JSON.stringify(true));
        localStorage.setItem(`rotativa_${name}`, JSON.stringify({
            type: "4turno", start: "", firstTurn: "larga"
        }));
        localStorage.setItem(`baseData_${name}`, JSON.stringify({}));
        localStorage.setItem(`data_${name}`, JSON.stringify({}));
    });

    // Ana: una Larga extra un lunes (12 h diurnas).
    localStorage.setItem("data_Ana Perez", JSON.stringify({
        "2026-7-17": TURNO.LARGA
    }));
    // Bruno: una Larga extra un sabado (12 h nocturnas: dia no habil).
    localStorage.setItem("data_Bruno Soto Vera", JSON.stringify({
        "2026-7-1": TURNO.LARGA
    }));
    localStorage.setItem("data_Eduardo Admin Ruiz", JSON.stringify({
        "2026-7-17": TURNO.LARGA
    }));
    localStorage.setItem("data_Fabian Auxiliar Lagos", JSON.stringify({
        "2026-7-17": TURNO.LARGA
    }));
}

test("agrupa auxiliares y administrativos, pero conserva las demas profesiones", () => {
    seed();

    const filters = overtimeProfessionFilters();
    const labels = filters.map(filter => filter.label);

    assert.equal(filters[0].label, PROFESSION);
    assert.equal(labels.includes("Administrativo"), true);
    assert.equal(labels.includes("Auxiliares"), true);
    assert.equal(labels.includes("Técnico en Imagenología"), true);
    assert.equal(labels.includes("Tecnico en Administracion de Empresas"), false);
    assert.equal(labels.includes("Auxiliar de Servicio"), false);
});

test("los filtros agrupados incluyen a todo su estamento", async () => {
    seed();

    const administrativeRows = await buildOvertimeByWorkerRows(
        "role:administrativo", YEAR, MONTH
    );
    const auxiliaryRows = await buildOvertimeByWorkerRows(
        "role:auxiliar", YEAR, MONTH
    );

    assert.deepEqual(administrativeRows.map(row => row.name), ["Eduardo Admin Ruiz"]);
    assert.deepEqual(auxiliaryRows.map(row => row.name), ["Fabian Auxiliar Lagos"]);
});

test("solo trae los trabajadores activos de la profesion pedida", async () => {
    seed();

    const rows = await buildOvertimeByWorkerRows(PROFESSION, YEAR, MONTH);

    assert.deepEqual(
        rows.map(row => row.name).sort(),
        ["Ana Perez", "Bruno Soto Vera"]
    );
});

test("separa diurnas y nocturnas y suma el total", async () => {
    seed();

    const rows = await buildOvertimeByWorkerRows(PROFESSION, YEAR, MONTH);
    const ana = rows.find(row => row.name === "Ana Perez");
    const bruno = rows.find(row => row.name === "Bruno Soto Vera");

    // Lunes: la Larga es toda diurna. Sabado: dia no habil, toda nocturna.
    assert.deepEqual(
        { d: ana.day, n: ana.night, total: ana.total },
        { d: 12, n: 0, total: 12 }
    );
    assert.deepEqual(
        { d: bruno.day, n: bruno.night, total: bruno.total },
        { d: 0, n: 12, total: 12 }
    );
});

test("ordena de mayor a menor total", async () => {
    seed();
    localStorage.setItem("data_Ana Perez", JSON.stringify({
        "2026-7-17": TURNO.LARGA,
        "2026-7-19": TURNO.LARGA
    }));

    const rows = await buildOvertimeByWorkerRows(PROFESSION, YEAR, MONTH);

    assert.equal(rows[0].name, "Ana Perez");
    assert.equal(rows[0].total > rows[1].total, true);
});

test("el eje X usa nombre corto y el nombre completo va en el tooltip", async () => {
    seed();

    const rows = await buildOvertimeByWorkerRows(PROFESSION, YEAR, MONTH);
    const bruno = rows.find(row => row.name === "Bruno Soto Vera");

    assert.equal(bruno.shortName, "B. Soto");

    const chart = renderOvertimeByWorker(rows);

    assert.match(chart, /<small>B\. Soto<\/small>/);
    assert.match(chart, /title="Bruno Soto Vera: 12 h totales/);
});

test("el grafico apila las dos series y no toca el techo del eje", () => {
    const chart = renderOvertimeByWorker([
        { name: "Ana", shortName: "Ana", day: 14, night: 22, total: 36 }
    ]);

    // Con maximo 36 el eje sube a 40 (paso 10): la barra queda al 90%.
    assert.match(chart, /overtime-stack" style="height:90%/);
    assert.match(chart, /overtime-night" style="height:61\./);
    assert.match(chart, /overtime-day" style="height:38\./);
    // Leyenda para dos series y total visible.
    assert.match(chart, /HH\.EE diurnas/);
    assert.match(chart, /HH\.EE nocturnas/);
    assert.match(chart, /Total 36 h/);
});

test("no dibuja segmentos de una serie en cero", () => {
    const chart = renderOvertimeByWorker([
        { name: "Ana", shortName: "Ana", day: 12, night: 0, total: 12 }
    ]);

    assert.match(chart, /overtime-day/);
    assert.doesNotMatch(chart, /overtime-night" style/);
});

test("estados vacios distinguen sin trabajadores de sin horas", () => {
    assert.match(
        renderOvertimeByWorker([]),
        /No hay trabajadores activos con esta profesión/
    );
    assert.match(
        renderOvertimeByWorker([
            { name: "Ana", shortName: "Ana", day: 0, night: 0, total: 0 }
        ]),
        /Sin horas extras registradas en este mes/
    );
});

test("los controles filtran por profesion y navegan por mes", async () => {
    const dashboard = (await readFile(
        new URL("../js/dashboard.js", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    assert.match(dashboard, /data-dashboard-overtime-profession/);
    assert.match(dashboard, /data-dashboard-overtime-month="-1"/);
    assert.match(dashboard, /data-dashboard-overtime-month="1"/);
    // El mes se mueve con Date para que diciembre salte de año.
    assert.match(
        dashboard,
        /const next = new Date\(\s*\n\s*dashboardState\.overtimeYear,\s*\n\s*dashboardState\.overtimeMonth \+ step/
    );
    // Solo se calcula la profesion elegida: recorrer toda la unidad es lo que
    // hizo desactivar otros graficos por lentos.
    assert.match(dashboard, /profileMatchesOvertimeFilter\(profile, filter\)/);
    assert.match(dashboard, /role:administrativo/);
    assert.match(dashboard, /role:auxiliar/);
});
