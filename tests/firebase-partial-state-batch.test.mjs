import assert from "node:assert/strict";
import test from "node:test";
import {
    applyPartialStateEntry,
    mergePartialStateEntries
} from "../js/firebasePartialState.js";

function sequential(snapshot, entries) {
    return entries.reduce(
        (state, entry) => applyPartialStateEntry(state, entry),
        { ...snapshot }
    );
}

test("hidratar una lista grande conserva el orden y los cambios legados", () => {
    const legacy = Array.from({ length: 250 }, (_, index) => ({
        id: `entry-${index}`,
        text: `old-${index}`
    }));
    const entries = [{
        storageKey: "auditLog",
        itemKey: "",
        value: JSON.stringify(legacy)
    }];

    for (let index = 0; index < 700; index++) {
        entries.push({
            storageKey: "auditLog",
            itemKey: `entry-${index}`,
            container: "array",
            value: JSON.stringify({ id: `entry-${index}`, text: `new-${index}` }),
            deleted: index % 11 === 0
        });
    }

    entries.push({
        storageKey: "auditLog",
        itemKey: "entry-11",
        container: "array",
        value: JSON.stringify({ id: "entry-11", text: "restored" })
    });

    const expected = sequential({}, entries);
    assert.deepEqual(mergePartialStateEntries({}, entries), expected);
});

test("una entrada invalida no cambia la serializacion existente", () => {
    const original = '[ { "id": "one" } ]';
    const entries = [{
        storageKey: "replacements",
        itemKey: "one",
        container: "array",
        value: "{invalid"
    }];

    assert.deepEqual(
        mergePartialStateEntries({ replacements: original }, entries),
        sequential({ replacements: original }, entries)
    );
});

test("las listas intercaladas con mapas y valores completos mantienen su resultado", () => {
    const entries = [
        { storageKey: "replacements", itemKey: "", value: '[{"id":"a"}]' },
        { storageKey: "replacements", itemKey: "a", container: "array", value: '{"id":"a","v":2}' },
        { storageKey: "replacements", itemKey: "b", container: "array", value: '{"id":"b"}' },
        { storageKey: "config", itemKey: "theme", value: '"light"' },
        { storageKey: "replacements", itemKey: "a", container: "array", deleted: true },
        { storageKey: "replacements", itemKey: "a", container: "array", value: '{"id":"a","v":3}' },
        { storageKey: "config", itemKey: "layout", value: '"compact"' }
    ];

    assert.deepEqual(mergePartialStateEntries({}, entries), sequential({}, entries));
});

test("hidratar mapas grandes conserva reemplazos y borrados por clave", () => {
    const entries = [{
        storageKey: "data_worker",
        itemKey: "",
        value: JSON.stringify({ 20260101: { shift: "day" } })
    }];

    for (let index = 0; index < 400; index++) {
        entries.push({
            storageKey: "data_worker",
            itemKey: `day-${index}`,
            value: JSON.stringify({ shift: `shift-${index}` }),
            deleted: index % 13 === 0
        });
    }

    entries.push({
        storageKey: "data_worker",
        itemKey: "day-13",
        value: '{"shift":"restored"}'
    });

    assert.deepEqual(mergePartialStateEntries({}, entries), sequential({}, entries));
});

test("los cambios mixtos conservan el mismo estado que la ruta individual", () => {
    let seed = 17;
    const random = () => {
        seed = (seed * 48271) % 2147483647;
        return seed / 2147483647;
    };
    const entries = [];

    for (let index = 0; index < 300; index++) {
        const storageKey = random() < 0.5 ? "list" : "map";
        const itemKey = `item-${Math.floor(random() * 35)}`;
        const deleted = random() < 0.2;
        entries.push({
            storageKey,
            itemKey,
            container: storageKey === "list" ? "array" : undefined,
            value: JSON.stringify(storageKey === "list"
                ? { id: itemKey, index }
                : { index }),
            deleted
        });
    }

    assert.deepEqual(mergePartialStateEntries({}, entries), sequential({}, entries));
});
