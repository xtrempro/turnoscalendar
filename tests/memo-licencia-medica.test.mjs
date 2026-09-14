// La licencia medica aparece en Memorandum, y el boton para quitar a mano.
//
// La licencia ya tenia su respaldo: se adjunta desde la casilla del calendario
// y queda colgado del registro del LOG que la aplico (leaveAttachments). El
// memorandum de la licencia NO guarda una copia: muestra esos mismos archivos.
// Asi lo que se adjunta en un lado se ve en el otro.
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
    body: { dataset: {}, classList: { add() {}, remove() {}, contains: () => false } },
    documentElement: { dataset: {}, classList: { add() {}, remove() {}, contains: () => false } },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, dataset: {}, appendChild() {} })
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const {
    cancelLeaveMemos,
    createLeaveMemoTask,
    getMemoById,
    getMemos,
    removePendingMemo
} = await import("../js/memos.js");
const insights = await import("../js/memosInsights.js");

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const PROFILE = "CAMILA ANDREA ROJAS MENA";
const LOG_ID = "1757000000000_licencia";
const KEYS = ["2026-8-14", "2026-8-15", "2026-8-16"];

function aplicarLicencia() {
    return createLeaveMemoTask({
        profile: PROFILE,
        typeLabel: "Licencia médica",
        amount: KEYS.length,
        startKey: KEYS[0],
        endKey: KEYS[KEYS.length - 1],
        sourceType: "license",
        keys: KEYS,
        logId: LOG_ID
    });
}

// Lo que deja addLeaveAttachment al adjuntar desde la casilla del calendario.
function adjuntarEnLaCasilla() {
    localStorage.setItem("leaveAttachments", JSON.stringify({
        [`${PROFILE}|${LOG_ID}`]: [{
            id: "lic1",
            name: "licencia.pdf",
            type: "application/pdf",
            size: 1000,
            storagePath: "workspaces/w/attachments/leaves/p/l/lic1",
            addedAt: "2026-09-15T10:00:00.000Z"
        }]
    }));
}

/* =========================================================
   La licencia medica en Memorandum
========================================================= */

test("aplicar una licencia medica deja su memorandum pendiente", () => {
    localStorage.clear();
    aplicarLicencia();

    const memo = getMemos()[0];

    assert.equal(memo.leaveType, "license");
    assert.equal(memo.logId, LOG_ID);
    assert.equal(insights.memoKind(memo), "leave");
    assert.equal(insights.memoStatus(memo), "pending");
    assert.deepEqual(insights.memoFacts(memo)[0], { label: "Cantidad", value: "3 días" });
});

test("lo adjuntado en la casilla del calendario se ve en el memorandum y lo deja realizado", () => {
    localStorage.clear();
    const memo = aplicarLicencia();

    adjuntarEnLaCasilla();

    const visto = getMemoById(memo.id);

    assert.equal(visto.documents.length, 1);
    assert.equal(visto.documents[0].name, "licencia.pdf");
    assert.equal(visto.documents[0].attachedAt, "2026-09-15T10:00:00.000Z");
    assert.equal(insights.memoStatus(visto), "done");
});

test("el archivo de la licencia no se copia dentro del memorandum", () => {
    // Si se copiara, eliminarlo desde la casilla dejaria la copia viva aca.
    localStorage.clear();
    aplicarLicencia();
    adjuntarEnLaCasilla();

    // Cualquier escritura de memorandum (aca, otro permiso) reescribe la lista.
    createLeaveMemoTask({
        profile: PROFILE,
        typeLabel: "F. Legal",
        amount: 1,
        startKey: "2026-8-20",
        endKey: "2026-8-20",
        sourceType: "legal",
        keys: ["2026-8-20"]
    });

    const guardada = JSON.parse(localStorage.getItem("memos"))
        .find(memo => memo.leaveType === "license");

    assert.deepEqual(guardada.documents, []);
    assert.equal(getMemos().find(memo => memo.leaveType === "license").documents.length, 1);
});

test("anular la licencia quita su memorandum si aun no tiene documento", () => {
    localStorage.clear();
    aplicarLicencia();

    assert.equal(cancelLeaveMemos({ profile: PROFILE, leaveType: "license", keys: KEYS }).length, 1);
    assert.equal(getMemos().length, 0);
});

test("con la licencia ya adjunta, anularla no borra el memorandum", () => {
    localStorage.clear();
    aplicarLicencia();
    adjuntarEnLaCasilla();

    assert.equal(cancelLeaveMemos({ profile: PROFILE, leaveType: "license", keys: KEYS }).length, 0);
    assert.equal(getMemos().length, 1);
});

/* =========================================================
   Quitar a mano
========================================================= */

test("un memorandum sin documento se puede quitar a mano", () => {
    localStorage.clear();
    const memo = aplicarLicencia();

    assert.equal(removePendingMemo(memo.id), true);
    assert.equal(getMemos().length, 0);
});

test("con documento adjunto no se puede quitar: primero se elimina el documento", () => {
    localStorage.clear();
    const memo = aplicarLicencia();

    adjuntarEnLaCasilla();

    assert.equal(removePendingMemo(memo.id), false);
    assert.equal(getMemos().length, 1);
});

test("el visor ofrece quitarlo solo cuando no hay documento, y pide confirmacion", async () => {
    const memos = await read("../js/memos.js");

    assert.match(memos, /\$\{documents\.length \? "" : `<button class="mem-link mem-link--danger" type="button" data-mem-act="remove-memo"/);
    assert.match(memos, /case "remove-memo": \{/);
    assert.match(memos, /title: "Quitar memorándum",\n\s*confirmText: "Quitar",/);
});

/* =========================================================
   Donde se engancha
========================================================= */

test("al aplicar la licencia se crea el memorandum con el id de su registro", async () => {
    const leaveEngine = await read("../js/leaveEngine.js");
    const auditLog = await read("../js/auditLog.js");

    assert.match(leaveEngine, /const applicationLog = addAuditLog\(/);
    assert.match(
        leaveEngine,
        /if \(\(type === "license" \|\| type === "professional_license"\) && applicationLog\?\.id\) \{[\s\S]{0,400}logId: applicationLog\.id/
    );
    // addAuditLog tiene que devolver el registro para que haya id.
    assert.match(auditLog, /return entry;\n\}\n\nexport async function undoAuditLogEntry/);
});

test("adjuntar o quitar en Memorandum escribe en el respaldo de la licencia", async () => {
    const memos = await read("../js/memos.js");

    assert.match(memos, /if \(isLicenseMemo\(target\)\) \{\n\s*const attachment = await addLeaveAttachment\(/);
    assert.match(memos, /if \(isLicenseMemo\(target\)\) \{\n\s*const removed = await removeLeaveAttachment\(/);
});

test("adjuntar desde la casilla actualiza el menu Memorandum", async () => {
    const leaveAttachments = await read("../js/leaveAttachments.js");

    assert.match(leaveAttachments, /window\.dispatchEvent\(new CustomEvent\("proturnos:memosChanged"\)\)/);
    assert.equal(leaveAttachments.match(/notifyMemos\(\);/g)?.length, 2);
});
