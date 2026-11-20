// El que ya tiene el turno puesto a mano y sin motivo tambien es candidato.
//
// Caso real: se le agrega un turno a mano a X y nadie anota por que, asi que su
// casilla queda con el "?". Despues se aplica un permiso a otro trabajador y se
// buscan sugerencias: X no aparecia, porque ya tiene ese turno y no hay nada
// que sumarle.
//
// Pero es justamente por eso que sirve. El turno ya esta puesto y lo unico que
// le falta es el motivo, que es este permiso. Elegirlo NO le agrega otro turno
// -seria trabajar la misma jornada dos veces-: enlaza el que tiene con esta
// ausencia.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(k) { return this.values.has(k) ? this.values.get(k) : null; }
    key(i) { return [...this.values.keys()][i] ?? null; }
    removeItem(k) { this.values.delete(k); }
    setItem(k, v) { this.values.set(k, String(v)); }
}

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
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { dataset: {} }
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { setJSON } = await import("../js/persistence.js");
const { TURNO } = await import("../js/constants.js");
const { saveReplacements } = await import("../js/storage.js");
const { pendingManualExtraCoversTurn, canCoverShift } =
    await import("../js/replacementCandidates.js");

const leer = async name => (await readFile(
    new URL(name, import.meta.url), "utf8"
)).replace(/\r\n/g, "\n");

const calendar = await leer("../js/calendar.js");
const candidatos = await leer("../js/replacementCandidates.js");
const css = await leer("../styles.css");

const X = "TRABAJADOR X";
const DIA = "2026-8-10";
const ISO = "2026-09-10";

/**
 * Siembra a X con una Larga puesta A MANO sobre un dia que su rotativa deja
 * libre. `baseData` es lo que dicta la rotativa; `data`, lo que hay de verdad.
 */
function sembrarTurnoManual({ backed = null } = {}) {
    localStorage.clear();
    setJSON("profiles", [
        { name: X, contractType: "Planta", estamento: "Técnico" }
    ]);
    setJSON(`rotativa_${X}`, { type: "libre" });
    setJSON(`baseData_${X}`, { [DIA]: TURNO.LIBRE });
    setJSON(`data_${X}`, { [DIA]: TURNO.LARGA });

    if (backed) saveReplacements([backed]);
}

const respaldo = (turno = "L") => ({
    id: "r1",
    worker: X,
    replaced: "",
    reason: "Apoyo TAC",
    source: "manual_extra",
    addsShift: false,
    date: ISO,
    turno,
    year: 2026,
    month: 8,
    canceled: false
});

/* ───────── El motor ───────── */

test("un turno agregado a mano y sin motivo cuenta como candidato", () => {
    sembrarTurnoManual();

    assert.equal(pendingManualExtraCoversTurn(X, DIA, TURNO.LARGA), true);
});

test("pero canCoverShift por si solo lo seguiria descartando", () => {
    // Es el motivo por el que no aparecia: ya tiene ese turno, asi que
    // fusionarlo no cambia nada y no hay turno que agregar.
    assert.equal(canCoverShift(TURNO.LARGA, TURNO.LARGA), false);
});

test("si el turno YA tiene respaldo, deja de ofrecerse", () => {
    // El turno esta justificado: volver a usarlo cubriria dos ausencias con la
    // misma jornada.
    sembrarTurnoManual({ backed: respaldo("L") });

    assert.equal(pendingManualExtraCoversTurn(X, DIA, TURNO.LARGA), false);
});

test("un respaldo de OTRO turno no lo tapa", () => {
    // Respaldada la Noche de un 24, la Larga sigue pendiente.
    localStorage.clear();
    setJSON("profiles", [
        { name: X, contractType: "Planta", estamento: "Técnico" }
    ]);
    setJSON(`rotativa_${X}`, { type: "libre" });
    setJSON(`baseData_${X}`, { [DIA]: TURNO.LIBRE });
    setJSON(`data_${X}`, { [DIA]: TURNO.TURNO24 });
    saveReplacements([respaldo("N")]);

    assert.equal(pendingManualExtraCoversTurn(X, DIA, TURNO.LARGA), true);
});

test("un dia sin turno no tiene nada que respaldar", () => {
    localStorage.clear();
    setJSON("profiles", [
        { name: X, contractType: "Planta", estamento: "Técnico" }
    ]);
    setJSON(`rotativa_${X}`, { type: "libre" });
    setJSON(`data_${X}`, { [DIA]: TURNO.LIBRE });

    assert.equal(pendingManualExtraCoversTurn(X, DIA, TURNO.LARGA), false);
});

test("y un turno que no cubre el que se necesita, tampoco", () => {
    // Tiene una Larga agregada y se busca quien haga una Noche: su Larga no
    // sirve para eso, y ofrecerla seria ofrecer un turno que no cubre nada.
    sembrarTurnoManual();

    assert.equal(pendingManualExtraCoversTurn(X, DIA, TURNO.NOCHE), false);
});

test("y no revienta con datos incompletos", () => {
    assert.equal(pendingManualExtraCoversTurn("", DIA, TURNO.LARGA), false);
    assert.equal(pendingManualExtraCoversTurn(X, "", TURNO.LARGA), false);
    assert.equal(pendingManualExtraCoversTurn(X, DIA, 0), false);
});

/* ───────── La lista lo deja pasar ───────── */

test("el filtro de elegibles lo acepta aunque canCoverShift diga que no", () => {
    assert.match(
        candidatos,
        /if \(candidate\.backsPendingExtra\) return "";\s*\n\s*if \(canCoverShift\(/
    );
    assert.match(candidatos, /backsPendingExtra: pendingManualExtraCoversTurn\(/);
});

/* ───────── La tarjeta ───────── */

test("la tarjeta se marca en celeste suave", () => {
    assert.match(
        calendar,
        /\$\{candidate\.backsPendingExtra \? "replacement-candidate--backs-extra" : ""\}/
    );
    assert.match(css, /\.replacement-candidate--backs-extra \{/);
    // Celeste, no ambar: no es un reparo, es el mejor candidato del dia.
    assert.match(css, /rgba\(56, 189, 248, 0\.16\)/);
});

test("y explica por que esta ahi", () => {
    assert.match(calendar, /Ya tiene un turno agregado en esta fecha y todavía/);
    assert.match(calendar, /ese\s*\n\s*turno queda respaldado con este permiso/);
    assert.match(css, /\.replacement-candidate-backs-extra \{/);
});

/* ───────── Elegirlo respalda, no agrega ───────── */

test("al elegirlo NO se le suma otro turno", () => {
    // `addsShift: false` es lo que lo distingue de un reemplazo normal: el
    // turno ya esta en su calendario y este registro solo lo justifica.
    const bloque = calendar.slice(
        calendar.indexOf('button.dataset.backsPendingExtra === "true"')
    ).slice(0, 1200);

    assert.match(bloque, /source: "manual_extra"/);
    assert.match(bloque, /addsShift: false/);
    assert.match(bloque, /replaced: profileName/);
    assert.match(bloque, /absenceType/);
});

test("el dato viaja del candidato al boton", () => {
    assert.match(calendar, /data-backs-pending-extra="true"/);
});

test("queda en la bitacora, porque no es un reemplazo cualquiera", () => {
    assert.match(calendar, /"Respaldo un turno agregado"/);
});
