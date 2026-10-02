import assert from "node:assert/strict";
import test from "node:test";
import {
    auditLogDisplayMonth,
    auditLogShardLocation,
    auditLogShardDayRangeForDisplayMonth,
    auditLogShardLocationFromId,
    auditLogTimestampFromId,
    auditLogUtcMonth,
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

test("la fecha del fragmento usa UTC incluso si el ISO trae hora de Chile", () => {
    const location = auditLogShardLocation(log(
        "a",
        "2026-09-30T22:30:00-03:00"
    ));

    assert.equal(location.day, "2026-10-01");
    assert.equal(location.month, "2026-10");
    assert.equal(auditLogUtcMonth("2026-09-30T22:30:00-03:00"), "2026-10");
});

test("el mes visible usa hora de Chile sin mover el fragmento UTC", () => {
    const createdAt = "2026-10-01T01:30:00.000Z";
    const location = auditLogShardLocation(log("a", createdAt));

    assert.equal(location.month, "2026-10");
    assert.equal(auditLogDisplayMonth(createdAt), "2026-09");
    assert.deepEqual(
        auditLogShardDayRangeForDisplayMonth("2026-09"),
        {
            startDay: "2026-09-01",
            endDayExclusive: "2026-10-02"
        }
    );
});

test("el rango chileno funciona al cambiar de ano", () => {
    assert.deepEqual(
        auditLogShardDayRangeForDisplayMonth("2026-12"),
        {
            startDay: "2026-12-01",
            endDayExclusive: "2027-01-02"
        }
    );
    assert.equal(auditLogShardDayRangeForDisplayMonth("2026-13"), null);
});

test("un id normal permite ubicar un solo documento sin conocer createdAt", () => {
    const timestamp = Date.parse("2026-10-01T01:30:00.000Z");
    const id = `${timestamp}_abc123`;
    const location = auditLogShardLocationFromId(id);

    assert.equal(auditLogTimestampFromId(id), "2026-10-01T01:30:00.000Z");
    assert.equal(location.day, "2026-10-01");
    assert.match(location.documentId, /^2026-10-01_[0-3]$/);
});

test("un id determinista exige createdAt como respaldo", () => {
    const id = "memo_leave_cancel_abc_12";

    assert.equal(auditLogShardLocationFromId(id), null);
    assert.equal(
        auditLogShardLocationFromId(
            id,
            "2026-10-01T01:30:00.000Z"
        ).day,
        "2026-10-01"
    );
});

test("la fecha deducida del id manda y createdAt respalda ids deterministas", () => {
    const id = `${Date.parse("2026-09-30T23:59:59.999Z")}_limite`;

    assert.equal(
        auditLogShardLocationFromId(
            id,
            "2026-10-01T00:00:00.001Z"
        ).day,
        "2026-09-30"
    );
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
