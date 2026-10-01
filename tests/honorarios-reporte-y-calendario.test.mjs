// Honorarios: se le pagan solo las horas trabajadas.
//
// - Reporte: sin Anexo 1/2, sin grado ni asignacion de turno, sin resumen de
//   horas extras, permisos ni cambios de turno; detalle de turnos solo con el
//   turno realizado (sin turno base ni HHEE). En su lugar, las horas del
//   contrato contra las realizadas en el mes, en rojo si se pasa.
// - Calendario: ningun permiso, y un turno agregado nunca pide motivo ni a
//   quien cubre.
// - Un marcaje modificado cuenta: es como el supervisor recorta un exceso.

import test, { beforeEach } from "node:test";
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

const { setJSON } = await import("../js/persistence.js");
const { buildWorkerReportPreviewHTML } = await import("../js/hoursReport.js");
const { getHonorariaMonthlySummary } = await import("../js/honoraria.js");
const { TURNO } = await import("../js/constants.js");

const N = "Mathias";
const PROFILE = {
    name: N,
    rut: "215145662",
    contractType: "Honorarios",
    estamento: "Técnico",
    profession: "Técnico en Imagenología",
    active: true
};

beforeEach(() => {
    localStorage.clear();
    setJSON("profiles", [PROFILE]);
    setJSON("rotativa_" + N, { type: "diurno", start: "2026-10-01", firstTurn: "larga" });
    setJSON("honorariaContracts_" + N, [
        { id: "c1", start: "2026-10-01", end: "2026-10-31", hourlyRate: 3500, maxHours: 20, limitPeriod: "weekly" }
    ]);
    // Tres semanas distintas: el acumulado mensual (27 h) supera el tope de 20.
    setJSON("data_" + N, {
        "2026-9-5": TURNO.DIURNO,
        "2026-9-12": TURNO.DIURNO,
        "2026-9-19": TURNO.DIURNO
    });
});

test("el reporte deja solo lo que corresponde a honorarios", async () => {
    const html = await buildWorkerReportPreviewHTML(PROFILE, new Date(2026, 9, 1));

    assert.match(html, /honoraria-report/);
    assert.match(html, /Horas del contrato \(tope mensual\)/);
    assert.doesNotMatch(html, /tope semanal/);
    for (const quitado of [
        "Resumen de horas extras",
        "Permisos / Ausencias",
        "Cambios de turno",
        "Turno Base",
        "HHEE diurnas",
        "HHEE nocturnas",
        ">Detalles<",
        ">Grado<",
        "Asignación de Turno"
    ]) {
        assert.doesNotMatch(html, new RegExp(quitado.replace(/[()]/g, "\\$&")), quitado);
    }
    assert.match(html, /Turno realizado/);
    assert.match(html, /Valor Hora/);
});

test("el periodo que pasa el tope y sus dias van en rojo", async () => {
    const html = await buildWorkerReportPreviewHTML(PROFILE, new Date(2026, 9, 1));

    assert.match(html, /Mes de octubre de 2026/);
    assert.match(html, /class="report-row--excess"/);
    assert.match(html, /\(se pasa\)/);
    assert.match(html, /Se pasa del contrato/);
});

test("un marcaje recortado cuenta en las horas realizadas", async () => {
    const antes = getHonorariaMonthlySummary(N, 2026, 9, {}).assignedHours;

    // El supervisor recorta el primer Diurno: sale 4 horas antes.
    setJSON("clockMarks_" + N, {
        "2026-9-5": { segments: { diurno: { entryTime: "08:00", exitTime: "13:00" } } }
    });

    const despues = getHonorariaMonthlySummary(N, 2026, 9, {}).assignedHours;

    assert.ok(despues < antes, `${despues} debia ser menor que ${antes}`);
});

test("calendario: ningun permiso y un turno agregado nunca pide motivo", async () => {
    const leer = ruta => readFile(new URL(ruta, import.meta.url), "utf8");
    const [main, calendar, replacements] = await Promise.all([
        leer("../js/main.js"),
        leer("../js/calendar.js"),
        leer("../js/replacements.js")
    ]);

    for (const boton of ["compBtn", "licenseBtn", "professionalLicenseBtn", "unjustifiedAbsenceBtn"]) {
        assert.match(main, new RegExp(`DOM\\.${boton}\\.disabled = blocksLeaveBenefits`), boton);
    }
    assert.match(calendar, /if \(isHonorariaProfile\(profileName, keyDay\)\) return 0;/);
    assert.match(replacements, /if \(isHonorariaProfile\(profile, keyDay\)\) return 0;/);
    // Sin Anexo 1 ni 2 en el reporte.
    assert.match(main, /DOM\.printTensReportBtn\?\.classList\.toggle\("hidden", honorariaReport\)/);
});
