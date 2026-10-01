// Anular un permiso anula tambien el CONTRATO de reemplazo que nacio de el.
//
// Paso el 2026-10-01 (Urgencia Adulto de test): a Hugo se le puso un F. Legal y
// lo cubria Alan con un contrato de reemplazo. Al anular el F. Legal se
// cancelaron los reemplazos por dia, pero el contrato siguio vigente; al poner
// despues un P. Administrativo esos mismos dias, salio "cubierto" por Alan sin
// preguntar quien cubre. Un permiso nuevo tiene que volver a preguntar.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

const { setJSON, getJSON } = await import("../js/persistence.js");
const {
    cancelReplacementContractsForLeave,
    getInheritedReplacementContractForCoveredShift
} = await import("../js/contracts.js");

const HUGO = "Hugo Rojas Tapia";
const ALAN = "Alan Plaza Martinez";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

// Octubre 2026: el 1 es jueves. Claves del calendario con mes en base 0.
const key = day => `2026-9-${day}`;
const iso = day => `2026-10-${String(day).padStart(2, "0")}`;
// F. Legal de 10 dias habiles: 1-2, 5-9 y 12-14 de octubre.
const FL_DAYS = [1, 2, 5, 6, 7, 8, 9, 12, 13, 14];

function seed({ contract = {} } = {}) {
    globalThis.localStorage.clear();
    setJSON("profiles", [
        { name: HUGO, active: true },
        { name: ALAN, active: true, contractType: "reemplazo" }
    ]);
    setJSON(`legal_${HUGO}`, Object.fromEntries(FL_DAYS.map(day => [key(day), true])));
    setJSON(`replacementContracts_${ALAN}`, [{
        id: "c1",
        start: iso(1),
        end: iso(14),
        replaces: HUGO,
        reason: "F. Legal",
        leaveRef: `legal:${HUGO}:${iso(1)}:${iso(14)}`,
        leaveType: "legal",
        leaveStart: iso(1),
        leaveEnd: iso(14),
        ...contract
    }]);
}

// Lo que hace la anulacion: primero quita el permiso de los mapas, despues
// anula lo que dependia de el.
function cancelLegal(days) {
    const legal = getJSON(`legal_${HUGO}`, {});

    days.forEach(day => { delete legal[key(day)]; });
    setJSON(`legal_${HUGO}`, legal);

    return cancelReplacementContractsForLeave({
        profile: HUGO,
        leaveType: "legal",
        keys: days.map(key)
    });
}

beforeEach(() => seed());

test("antes de anular, el contrato cubre los dias del permiso", () => {
    assert.ok(getInheritedReplacementContractForCoveredShift(HUGO, key(9)));
});

test("anular el permiso entero elimina el contrato, aunque traiga fines de semana", () => {
    // El F. Legal cuenta habiles: el 3-4 y 10-11 no vienen en los dias anulados,
    // pero el contrato (corrido del 1 al 14) tampoco tiene razon de seguir.
    const result = cancelLegal(FL_DAYS);

    assert.deepEqual(result.map(item => item.action), ["removed"]);
    assert.deepEqual(getJSON(`replacementContracts_${ALAN}`, []), []);
});

test("despues de anular, un P. Administrativo el mismo dia NO sale cubierto por el contrato viejo", () => {
    cancelLegal(FL_DAYS);
    setJSON(`admin_${HUGO}`, { [key(9)]: 1 });

    // Sin contrato que lo cubra, el turno queda pendiente: se vuelve a
    // preguntar quien cubre.
    assert.equal(getInheritedReplacementContractForCoveredShift(HUGO, key(9)), null);
});

test("un permiso de OTRO tipo no mantiene vivo el contrato del permiso anulado", () => {
    setJSON(`admin_${HUGO}`, { [key(9)]: 1 });

    const result = cancelLegal(FL_DAYS);

    assert.deepEqual(result.map(item => item.action), ["removed"]);
    assert.equal(getInheritedReplacementContractForCoveredShift(HUGO, key(9)), null);
});

test("anular solo una parte excluye esos dias y el resto sigue cubierto", () => {
    const result = cancelLegal([8, 9]);

    assert.deepEqual(result.map(item => item.action), ["excluded"]);
    assert.deepEqual(result[0].dates, [iso(8), iso(9)]);
    assert.equal(getInheritedReplacementContractForCoveredShift(HUGO, key(9)), null);
    assert.ok(getInheritedReplacementContractForCoveredShift(HUGO, key(12)));
});

test("un contrato hecho a mano (sin permiso de origen) no se toca", () => {
    seed({ contract: { leaveRef: "", leaveType: "", leaveStart: "", leaveEnd: "" } });

    assert.deepEqual(cancelLegal(FL_DAYS), []);
    assert.equal(getJSON(`replacementContracts_${ALAN}`, []).length, 1);
});

test("un contrato por OTRO tipo de permiso (licencia) no se toca al anular el F. Legal", () => {
    seed({ contract: { leaveType: "license", reason: "Licencia Medica" } });

    assert.deepEqual(cancelLegal(FL_DAYS), []);
    assert.equal(getJSON(`replacementContracts_${ALAN}`, []).length, 1);
});

test("las dos vias de anulacion anulan el contrato", () => {
    const auditLog = read("../js/auditLog.js");
    const calendar = read("../js/calendar.js");

    // Anulacion desde el LOG (calendario, LOG y app del trabajador): despues de
    // cancelar los reemplazos por dia, el contrato.
    assert.match(
        auditLog,
        /cancelReplacementsForAbsence\(profile, removedKeys, log\);[\s\S]{0,400}cancelContractsForCanceledLeave\(\{\s*profile,\s*leaveType: type,\s*keys: removedKeys/
    );
    // Limpieza manual del calendario, despues de guardar los mapas.
    assert.match(
        calendar,
        /cancelContractsForCanceledLeave\(\{\s*profile: profileName,\s*leaveType: type,\s*keys: cancelKeys/
    );
    // Y el memorandum pendiente del contrato se va con el.
    assert.match(read("../js/memos.js"), /cancelReplacementContractMemos\(event\?\.detail\?\.canceledContracts/);
});
