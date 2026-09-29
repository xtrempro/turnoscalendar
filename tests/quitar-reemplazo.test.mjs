// "Quitar reemplazo" en el detalle de un permiso.
//
// Le quita el turno a quien lo estaba cubriendo SIN anular el permiso: el
// permiso sigue en pie y el turno vuelve a quedar pendiente de cobertura, con
// su alerta y en los resumenes del inicio. Al trabajador se le avisa por la
// aplicacion.
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

const eventos = [];

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: (event) => { eventos.push(event); return true; },
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost" }
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    // El registro de auditoria mira la vista activa para decidir si repinta.
    body: { dataset: {} }
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const {
    cancelReplacementById,
    getActiveReplacementsForCoveredShift,
    getCoveringWorkersForShift,
    getReplacementForCoveredShift
} = await import("../js/replacements.js");

const calendario = (await readFile(
    new URL("../js/calendar.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

const DIA = "2026-7-27";
const ISO = "2026-08-27";
const AUSENTE = "DANIELA VELARDE";

function sembrar(reemplazos) {
    localStorage.clear();
    eventos.length = 0;
    localStorage.setItem("replacements", JSON.stringify(reemplazos));
}

/* =========================================================
   Que reemplazos cubren el turno
========================================================= */

test("devuelve el reemplazo entero, no solo el nombre", () => {
    // Para anularlo hace falta su id; getCoveringWorkersForShift solo da
    // nombres.
    sembrar([
        { id: "r1", date: ISO, replaced: AUSENTE, worker: "TRABAJADOR 3" }
    ]);

    const activos = getActiveReplacementsForCoveredShift(AUSENTE, DIA);

    assert.equal(activos.length, 1);
    assert.equal(activos[0].id, "r1");
    assert.deepEqual(getCoveringWorkersForShift(AUSENTE, DIA), ["TRABAJADOR 3"]);
});

test("un turno repartido entre dos devuelve los dos", () => {
    // Un 24 se puede repartir. Si se quitara solo uno, el turno quedaria
    // cubierto a medias y sin alerta que lo delate.
    sembrar([
        { id: "r1", date: ISO, replaced: AUSENTE, worker: "UNO" },
        { id: "r2", date: ISO, replaced: AUSENTE, worker: "DOS" }
    ]);

    assert.equal(getActiveReplacementsForCoveredShift(AUSENTE, DIA).length, 2);
});

test("los ya anulados no cuentan", () => {
    sembrar([
        { id: "r1", date: ISO, replaced: AUSENTE, worker: "UNO", canceled: true }
    ]);

    assert.deepEqual(getActiveReplacementsForCoveredShift(AUSENTE, DIA), []);
});

test("no se mezcla con otro dia ni con otro trabajador", () => {
    sembrar([
        { id: "r1", date: "2026-08-28", replaced: AUSENTE, worker: "UNO" },
        { id: "r2", date: ISO, replaced: "OTRA PERSONA", worker: "DOS" }
    ]);

    assert.deepEqual(getActiveReplacementsForCoveredShift(AUSENTE, DIA), []);
});

/* =========================================================
   Al quitarlo, el turno vuelve a quedar pendiente
========================================================= */

test("el turno deja de estar cubierto", () => {
    // Es lo que hace reaparecer el signo de exclamacion: la alerta del
    // calendario exige !coveredReplacement.
    sembrar([
        { id: "r1", date: ISO, replaced: AUSENTE, worker: "TRABAJADOR 3" }
    ]);

    assert.ok(getReplacementForCoveredShift(AUSENTE, DIA));

    cancelReplacementById("r1", { reason: "coverage_removed" });

    assert.equal(getReplacementForCoveredShift(AUSENTE, DIA), null);
    assert.deepEqual(getActiveReplacementsForCoveredShift(AUSENTE, DIA), []);
});

test("se avisa al trabajador que dejo de cubrir", () => {
    // El aviso viaja en el evento, no en la solicitud enlazada: por eso
    // funciona tambien con un reemplazo asignado a mano, sin solicitud.
    sembrar([
        { id: "r1", date: ISO, replaced: AUSENTE, worker: "TRABAJADOR 3" }
    ]);

    cancelReplacementById("r1", { reason: "coverage_removed" });

    const aviso = eventos.find(
        evento => evento.detail?.metadata?.changeType === "replacement_canceled"
    );

    assert.ok(aviso, "no se emitio el aviso");
    assert.deepEqual(aviso.detail.metadata.notifyProfiles, ["TRABAJADOR 3"]);
    assert.equal(aviso.detail.metadata.title, "Reemplazo anulado");
});

test("anular un reemplazo que ya no esta no rompe nada", () => {
    sembrar([]);

    assert.equal(cancelReplacementById("r1"), null);
});

/* =========================================================
   El boton
========================================================= */

test("aparece solo cuando hay alguien cubriendo", () => {
    assert.match(
        calendario,
        /const dropCoverButton = coveringReplacements\.length/
    );
    assert.match(calendario, /data-action="drop-cover">Quitar reemplazo</);
});

test("se quitan TODOS los que cubrian, no solo el primero", () => {
    assert.match(
        calendario,
        /const quitados = coveringReplacements\s*\n\s*\.map\(replacement => cancelReplacementById\(replacement\.id, \{/
    );
});

test("avisa que el permiso se mantiene", () => {
    // Es la diferencia con "Anular permiso", que esta al lado: confundirlos
    // dejaria al trabajador sin permiso en vez de sin cobertura.
    assert.match(calendario, /El permiso de \$\{profile\} se mantiene/);
    assert.match(calendario, /volverá a quedar pendiente de cobertura/);
    assert.match(calendario, /confirmText: "Quitar reemplazo"/);
});

test("si ya no quedaba nada vigente, se avisa en vez de callar", () => {
    // Ni reemplazos por dia ni un dia de contrato que excluir.
    assert.match(calendario, /if \(!quitados\.length && !excluido\) \{/);
    assert.match(calendario, /Es posible que ya no este vigente/);
});

test("al terminar se repinta el calendario y el resumen", () => {
    // Sin esto la alerta no reaparece hasta el proximo repintado.
    assert.match(
        calendario,
        /button\.textContent = "Quitando\.\.\.";[\s\S]{0,4500}updateVisibleCalendarDays\(\{ updateSummary: true \}\)/
    );
});
