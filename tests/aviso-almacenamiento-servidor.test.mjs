// El aviso de la revision diaria del almacenamiento (checkStorageHealth) llega
// al dueno dentro de la app: es el respaldo si el correo no funciona (auditoria
// de GPT sobre 64ff856, 2026-10-02).
import test from "node:test";
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

const { serverStorageNoticeText } = await import("../js/storageHealthNotice.js");
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("sin avisos vigentes no hay texto", () => {
    assert.equal(serverStorageNoticeText({}), "");
    assert.equal(serverStorageNoticeText({ documents: [], audits: [] }), "");
});

test("muestra el documento mas lleno, con los dias al 85 % si los hay", () => {
    const text = serverStorageNoticeText({
        documents: [
            { storageKey: "attendanceMarks", percent: 72.1, level: "warning", daysToCritical: null },
            { storageKey: "auditLog", percent: 86.4, level: "critical", daysToCritical: 0 },
            { storageKey: "replacements", percent: 74, level: "warning", daysToCritical: 40 }
        ]
    });

    assert.match(text, /^Almacenamiento crítico \(86\.4%\): la bitácora se acerca a su límite\./);
    assert.match(text, /Contacta a soporte\.$/);
});

test("avisa diferencias entre formatos y lo que no se pudo leer", () => {
    const text = serverStorageNoticeText({
        audits: [
            { kind: "auditLog", issues: 3, unreadable: false },
            { kind: "replacements", issues: 1, unreadable: true }
        ]
    });

    assert.match(text, /3 diferencia\(s\) en la bitácora/);
    assert.match(text, /no se pudo leer los reemplazos/);
});

test("la regla deja leer su estado solo al dueno, y nadie puede escribirlo", () => {
    const rules = read("../firebase.rules");

    assert.match(
        rules,
        /match \/storageHealthUnits\/\{workspaceId\} \{\s*allow read: if isOwner\(workspaceId\);\s*allow write: if false;\s*\}/
    );
});

test("la app lo carga al abrir la unidad y el banner lo muestra aparte de la alerta local", () => {
    const main = read("../js/main.js");
    const banner = read("../js/syncBanner.js");

    assert.match(main, /void loadServerStorageNotice\(workspace\);/);
    assert.match(main, /clearServerStorageNotice\(\);/);
    assert.match(banner, /if \(tipo === "server-storage-health"\) \{\s*serverStorageMessage = String\(detail\.message \|\| ""\);/);
    // La alerta local apagandose ("healthy") no tapa la del servidor.
    assert.match(banner, /if \(serverStorageMessage\) \{\s*node\.textContent = serverStorageMessage;/);
});
