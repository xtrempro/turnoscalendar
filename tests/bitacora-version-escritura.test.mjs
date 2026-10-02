// Version de escritura de la bitacora (js/auditLogVersion.js): cada registro
// nuevo lleva `writer: { schemaVersion, buildId }`, identico en el formato
// viejo y en los fragmentos; el build lo inyecta build.mjs automaticamente.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

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

const { addAuditLog, AUDIT_CATEGORY, getAuditLogs } = await import("../js/auditLog.js");
const { AUDIT_LOG_SCHEMA_VERSION, AUDIT_LOG_BUILD_ID, auditLogWriterMeta } = await import("../js/auditLogVersion.js");
const { diffAuditLogShardUpserts, groupAuditLogsByShard } = await import("../js/auditLogShardStore.js");
const { encodePartialStateItemKey } = await import("../js/firebasePartialState.js");
const { createBuildId, currentBuildId } = await import("../scripts/build-id.mjs");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// El fragmento guarda exactamente lo que escribe firebaseAuditLogShards.js:
// items[clave del id] = JSON.stringify(registro).
function shardItemsFor(previous, next) {
    const items = {};

    groupAuditLogsByShard(diffAuditLogShardUpserts(previous, next)).forEach(group => {
        group.logs.forEach(log => {
            items[encodePartialStateItemKey(log.id)] = JSON.stringify(log);
        });
    });

    return items;
}

test("un registro nuevo lleva version de esquema y de build", () => {
    localStorage.clear();

    const entry = addAuditLog(AUDIT_CATEGORY.CALENDAR, "Cambio de turno", "detalle", { profile: "ANA" });

    assert.deepEqual(entry.writer, { schemaVersion: AUDIT_LOG_SCHEMA_VERSION, buildId: AUDIT_LOG_BUILD_ID });
    assert.equal(AUDIT_LOG_SCHEMA_VERSION, 1, "version estable del esquema");
    // Sin empaquetar (pruebas) el build es "dev".
    assert.equal(AUDIT_LOG_BUILD_ID, "dev");
    assert.deepEqual(getAuditLogs().at(-1).writer, entry.writer, "queda en el formato viejo");
});

test("escritura dual: el fragmento guarda los MISMOS metadatos que el formato viejo", () => {
    localStorage.clear();

    const previous = getAuditLogs();
    const entry = addAuditLog(AUDIT_CATEGORY.CALENDAR, "Cambio de turno", "", { profile: "ANA" });
    const legacy = getAuditLogs();
    const items = shardItemsFor(previous, legacy);
    const stored = JSON.parse(items[encodePartialStateItemKey(entry.id)]);
    const legacyEntry = legacy.find(log => log.id === entry.id);

    assert.ok(stored, "el registro va a su fragmento");
    assert.deepEqual(stored.writer, legacyEntry.writer);
    assert.deepEqual(stored, legacyEntry, "el registro completo es identico en ambos formatos");
});

test("un registro reemplazado (mismo auditEntryId) conserva la version del build que lo reescribe", () => {
    localStorage.clear();

    const first = addAuditLog(AUDIT_CATEGORY.CALENDAR, "A", "", { profile: "ANA", auditEntryId: "fijo-1" });
    const second = addAuditLog(AUDIT_CATEGORY.CALENDAR, "B", "", { profile: "ANA", auditEntryId: "fijo-1" });

    assert.equal(first.id, second.id);
    assert.deepEqual(getAuditLogs().filter(log => log.id === "fijo-1").map(log => log.writer), [auditLogWriterMeta()]);
});

test("registros historicos sin metadatos se leen y se fragmentan igual, sin inventarles version", () => {
    localStorage.clear();

    const historical = {
        id: "1700000000000_viejo",
        category: AUDIT_CATEGORY.CALENDAR,
        action: "Cambio antiguo",
        details: "",
        profile: "ANA",
        createdAt: "2025-01-10T10:00:00.000Z",
        meta: {}
    };

    localStorage.setItem("auditLog", JSON.stringify([historical]));

    assert.deepEqual(getAuditLogs(), [historical], "se lee tal cual");

    const items = shardItemsFor([], [historical]);
    const stored = JSON.parse(items[encodePartialStateItemKey(historical.id)]);

    assert.equal(stored.writer, undefined, "no se le inventa version");
    assert.deepEqual(stored, historical);

    // Convive con uno nuevo: solo el nuevo lleva version.
    addAuditLog(AUDIT_CATEGORY.CALENDAR, "Nuevo", "", { profile: "ANA" });

    const logs = getAuditLogs();

    assert.equal(logs.find(log => log.id === historical.id).writer, undefined);
    assert.ok(logs.at(-1).writer);
});

test("build automatico: el id se genera solo y esbuild lo inyecta en el bundle", async () => {
    // Formato del id.
    assert.equal(
        createBuildId({ now: new Date("2026-10-02T15:43:07.123Z"), gitSha: "c78d032", dirty: false }),
        "20261002T154307Z-c78d032"
    );
    assert.equal(
        createBuildId({ now: new Date("2026-10-02T15:43:07.123Z"), gitSha: "c78d032", dirty: true }),
        "20261002T154307Z-c78d032-dirty"
    );
    assert.equal(createBuildId({ now: new Date("2026-10-02T15:43:07Z") }), "20261002T154307Z-nogit");
    assert.match(currentBuildId(), /^\d{8}T\d{6}Z-([0-9a-f]{4,12}(-dirty)?|nogit)$/);

    // build.mjs y build-engine.mjs lo generan y lo pasan a esbuild.
    const build = await readFile(path.join(ROOT, "build.mjs"), "utf8");
    const engine = await readFile(path.join(ROOT, "build-engine.mjs"), "utf8");

    assert.match(build, /const AUDIT_BUILD_ID = currentBuildId\(\);/);
    assert.match(build, /__TURNOPLUS_AUDIT_BUILD_ID__: JSON\.stringify\(AUDIT_BUILD_ID\)/);
    assert.match(engine, /__TURNOPLUS_AUDIT_BUILD_ID__: JSON\.stringify\(`server-\$\{currentBuildId\(\)\}`\)/);
    assert.equal((engine.match(/^\s+define,$/gm) || []).length, 3, "los tres bundles del servidor");

    // Empaquetado real con la misma definicion: el bundle lleva el id.
    const buildId = createBuildId({ now: new Date("2026-10-02T15:43:07Z"), gitSha: "abc1234" });
    const result = await esbuild.build({
        entryPoints: [path.join(ROOT, "js/auditLogVersion.js")],
        bundle: true,
        format: "esm",
        write: false,
        define: { __TURNOPLUS_AUDIT_BUILD_ID__: JSON.stringify(buildId) }
    });
    const code = result.outputFiles[0].text;
    const bundled = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

    assert.equal(bundled.AUDIT_LOG_BUILD_ID, buildId);
    assert.deepEqual(bundled.auditLogWriterMeta(), { schemaVersion: 1, buildId });
});

test("la version no se muestra en la app de supervisores", async () => {
    const source = await readFile(path.join(ROOT, "js/auditLog.js"), "utf8");
    const entryHtml = source.slice(source.indexOf("function entryHTML("), source.indexOf("export function getAuditLogs("));

    assert.ok(entryHtml.length > 0);
    assert.doesNotMatch(entryHtml, /writer|buildId|schemaVersion/);
    assert.doesNotMatch(await readFile(path.join(ROOT, "js/syncBanner.js"), "utf8"), /writer|buildId|schemaVersion/);
});
