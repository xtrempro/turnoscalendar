import assert from "node:assert/strict";
import test from "node:test";
import {
    diffReplacementRecords,
    replacementRecordDocId,
    replacementRecordPayload,
    replacementRecordsFromDocuments,
    replacementRecordTombstone
} from "../js/replacementRecordStore.js";

test("cada reemplazo conserva un ID reversible como documento", () => {
    assert.equal(replacementRecordDocId("rep/uno"), "rep%2Funo");
    assert.equal(decodeURIComponent(replacementRecordDocId("rep/uno")), "rep/uno");
});

test("un documento activo conserva el registro completo", () => {
    const payload = replacementRecordPayload(
        { id: 123, worker: "ANA", date: "2026-09-24" },
        { revision: 4, updatedAtISO: "2026-09-24T12:00:00.000Z", clientId: "c1" }
    );

    assert.equal(payload.recordId, "123");
    assert.equal(payload.record.id, 123);
    assert.equal(payload.revision, 4);
    assert.equal(payload.deleted, false);
});

test("los borrados se representan con tombstones", () => {
    const tombstone = replacementRecordTombstone("r1", {
        revision: 2,
        updatedAtISO: "2026-09-24T12:00:00.000Z"
    });

    assert.equal(tombstone.deleted, true);
    assert.equal(tombstone.recordId, "r1");
    assert.equal("record" in tombstone, false);
});

test("la lectura ignora tombstones y conserva documentos activos", () => {
    assert.deepEqual(replacementRecordsFromDocuments([
        replacementRecordPayload({ id: "r1", worker: "ANA" }),
        replacementRecordTombstone("r2"),
        replacementRecordPayload({ id: "r3", worker: "BETO" })
    ]), [
        { id: "r1", worker: "ANA" },
        { id: "r3", worker: "BETO" }
    ]);
});

test("el diff escribe solo el registro cambiado y tombstonea el eliminado", () => {
    const result = diffReplacementRecords(
        [
            { id: "r1", worker: "ANA" },
            { id: "r2", worker: "BETO" }
        ],
        [
            { id: "r1", worker: "ANA", canceled: true },
            { id: "r3", worker: "CARLA" }
        ]
    );

    assert.deepEqual(result.upserts.map(item => item.id), ["r1", "r3"]);
    assert.deepEqual(result.deletedIds, ["r2"]);
});

test("el orden de propiedades no inventa escrituras", () => {
    const previous = [{
        id: "r1",
        worker: "Ana",
        hours: { day: 12, night: 0 }
    }];
    const next = [{
        hours: { night: 0, day: 12 },
        worker: "Ana",
        id: "r1"
    }];

    assert.deepEqual(diffReplacementRecords(previous, next), {
        upserts: [],
        deletedIds: []
    });
});

test("rechaza registros sin ID estable", () => {
    assert.throws(
        () => replacementRecordPayload({ worker: "ANA" }),
        /ID estable/
    );
});
