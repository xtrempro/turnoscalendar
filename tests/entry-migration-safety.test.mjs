import assert from "node:assert/strict";
import test from "node:test";
import {
    assessLegacyValueRemoval,
    compactEntryMaps,
    entryLogicalState
} from "../scripts/lib/entry-migration.mjs";

test("permite retirar value cuando todos los registros tienen item", () => {
    const data = {
        value: JSON.stringify([{ id: "a", value: 1 }, { id: "b", value: 2 }]),
        container: "array",
        items: {
            a: JSON.stringify({ id: "a", value: 1 }),
            b: JSON.stringify({ id: "b", value: 3 })
        },
        deletedItems: { a: false, b: false }
    };

    assert.equal(assessLegacyValueRemoval(data).safe, true);
});

test("bloquea el retiro si un registro vive solo en value", () => {
    const data = {
        value: JSON.stringify([{ id: "a" }, { id: "b" }]),
        container: "array",
        items: { a: JSON.stringify({ id: "a" }) },
        deletedItems: { a: false }
    };

    assert.equal(assessLegacyValueRemoval(data).safe, false);
});

test("una lapida cuenta como cobertura y la compactacion conserva el estado", () => {
    const data = {
        value: JSON.stringify([{ id: "a" }, { id: "b" }]),
        container: "array",
        items: { a: JSON.stringify({ id: "a" }), b: "null" },
        deletedItems: { a: false, b: true }
    };
    const before = entryLogicalState(data, true);
    const compacted = compactEntryMaps(data);
    const withoutLegacy = {
        container: "array",
        items: compacted.items,
        deletedItems: compacted.deletedItems
    };

    assert.equal(assessLegacyValueRemoval(data).safe, true);
    assert.deepEqual(entryLogicalState(withoutLegacy, true), before);
    assert.equal(compacted.removedTombstones, 1);
    assert.equal(compacted.removedFalseMarkers, 1);
});
