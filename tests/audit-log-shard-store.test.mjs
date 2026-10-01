import assert from "node:assert/strict";
import test from "node:test";
import {
    auditLogShardLocation,
    auditLogsFromShardDocuments,
    diffAuditLogShardUpserts,
    groupAuditLogsByShard
} from "../js/auditLogShardStore.js";

const log = (id, createdAt, details = "") => ({ id, createdAt, details });

test("cada registro cae en un fragmento diario estable", () => {
    const first = auditLogShardLocation(log("a", "2026-10-01T10:00:00.000Z"));
    const second = auditLogShardLocation(log("a", "2026-10-01T10:00:00.000Z"));

    assert.deepEqual(first, second);
    assert.equal(first.month, "2026-10");
    assert.match(first.documentId, /^2026-10-01_[0-3]$/);
});

test("solo escribe altas y modificaciones; la poda no borra el archivo", () => {
    const previous = [
        log("a", "2026-10-01T10:00:00.000Z"),
        log("b", "2026-10-01T11:00:00.000Z")
    ];
    const next = [
        log("b", "2026-10-01T11:00:00.000Z", "actualizado"),
        log("c", "2026-10-02T09:00:00.000Z")
    ];

    assert.deepEqual(
        diffAuditLogShardUpserts(previous, next).map(item => item.id),
        ["b", "c"]
    );
});

test("agrupa y reconstruye los fragmentos sin duplicar IDs", () => {
    const logs = [
        log("a", "2026-10-01T10:00:00.000Z"),
        log("b", "2026-10-01T11:00:00.000Z"),
        log("c", "2026-10-02T09:00:00.000Z")
    ];
    const groups = groupAuditLogsByShard(logs);
    const documents = groups.map(group => ({
        items: Object.fromEntries(group.logs.map(item => [
            encodeURIComponent(item.id),
            JSON.stringify(item)
        ]))
    }));

    assert.deepEqual(
        auditLogsFromShardDocuments(documents).map(item => item.id),
        ["a", "b", "c"]
    );
});
