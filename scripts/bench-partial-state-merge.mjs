import { performance } from "node:perf_hooks";
import {
    applyPartialStateEntry,
    mergePartialStateEntries
} from "../js/firebasePartialState.js";

const legacy = Array.from({ length: 250 }, (_, index) => ({
    id: `entry-${index}`,
    text: "old".repeat(30)
}));
const entries = [{
    storageKey: "auditLog",
    itemKey: "",
    value: JSON.stringify(legacy)
}];

for (let index = 0; index < 833; index++) {
    entries.push({
        storageKey: "auditLog",
        itemKey: `entry-${index}`,
        container: "array",
        value: JSON.stringify({
            id: `entry-${index}`,
            text: "new".repeat(30)
        }),
        deleted: index % 9 === 0
    });
}

const startedSequential = performance.now();
const sequential = entries.reduce(
    (state, entry) => applyPartialStateEntry(state, entry),
    {}
);
const sequentialMs = performance.now() - startedSequential;

const startedBatch = performance.now();
const batched = mergePartialStateEntries({}, entries);
const batchedMs = performance.now() - startedBatch;

if (sequential.auditLog !== batched.auditLog) {
    throw new Error("El resultado del lote difiere de la aplicacion individual.");
}

console.log({
    kind: "list",
    entries: entries.length,
    sequentialMs: Math.round(sequentialMs),
    batchedMs: Math.round(batchedMs),
    speedup: Math.round(sequentialMs / batchedMs)
});

const mapEntries = Array.from({ length: 400 }, (_, index) => ({
    storageKey: "data_worker",
    itemKey: `day-${index}`,
    value: JSON.stringify({ shift: `shift-${index}` }),
    deleted: index % 13 === 0
}));

const startedMapSequential = performance.now();
const mapSequential = mapEntries.reduce(
    (state, entry) => applyPartialStateEntry(state, entry),
    {}
);
const mapSequentialMs = performance.now() - startedMapSequential;

const startedMapBatch = performance.now();
const mapBatched = mergePartialStateEntries({}, mapEntries);
const mapBatchedMs = performance.now() - startedMapBatch;

if (mapSequential.data_worker !== mapBatched.data_worker) {
    throw new Error("El mapa del lote difiere de la aplicacion individual.");
}

console.log({
    kind: "map",
    entries: mapEntries.length,
    sequentialMs: Math.round(mapSequentialMs),
    batchedMs: Math.round(mapBatchedMs),
    speedup: Math.round(mapSequentialMs / mapBatchedMs)
});
