// Una lista nunca se publica entera encima de la nube.
//
// Incidente del 2026-09-15, 13:38 UTC, Imagenologia. Un navegador con la lista
// local de reemplazos vacia asigno UN reemplazo y confirmo el guardado. La
// confirmacion (flushPendingFirebaseAppStateEntries) replanificaba las claves
// criticas desde cero, sin version anterior, y para una lista eso significaba
// mandar la copia local entera en `value`. Quedo 1 registro donde habia 492: se
// perdieron 341 reemplazos (248 activos) y el calendario se lleno de "!".
// Se repusieron desde PITR con scripts/rescatar-reemplazos.mjs.
//
// Dos arreglos, y cada uno basta por si solo para este caso:
//   A. El planificador: una lista cuyos elementos tienen id viaja SIEMPRE por
//      elemento. Sin version anterior, cada elemento es un alta y no se borra
//      nada. La lista entera queda solo para listas sin id (red de seguridad).
//   B. La confirmacion no replanifica listas desde cero: sus cambios reales ya
//      estaban en la cola.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    groupPartialStateEntries,
    mergePartialStateEntries,
    planListStateEntries,
    planPartialStateEntries
} from "../js/firebasePartialState.js";
import { stateModuleForKey } from "../js/firebaseStateModules.js";

function reemplazo(id, worker = "ANA", date = "2026-09-10") {
    return { id, worker, replaced: "PALOMA", date, turno: "L", canceled: false };
}

// El documento de la nube, con las dos caras: `value` (formato viejo, la lista
// entera) e `items` (por elemento). Se lee igual que la app.
function leerDocumento(documento) {
    const base = { moduleId: "turnos", storageKey: "replacements" };
    const entries = [];

    if (Object.prototype.hasOwnProperty.call(documento, "value")) {
        entries.push({ ...base, itemKey: "", value: documento.value, deleted: false });
    }

    Object.entries(documento.items || {}).forEach(([itemKey, value]) => {
        entries.push({
            ...base,
            itemKey,
            container: documento.container || "",
            value,
            deleted: documento.deletedItems?.[itemKey] === true
        });
    });

    return JSON.parse(mergePartialStateEntries({}, entries).replacements || "[]");
}

// Una escritura con merge, como setDoc(..., { merge: true }).
function escribir(documento, entries) {
    const [grupo] = groupPartialStateEntries(entries);
    const siguiente = { ...documento };

    if (!grupo) return siguiente;
    if (Object.prototype.hasOwnProperty.call(grupo, "value")) siguiente.value = grupo.value;
    if (Object.keys(grupo.items || {}).length) {
        siguiente.items = { ...(documento.items || {}), ...grupo.items };
        siguiente.deletedItems = { ...(documento.deletedItems || {}), ...grupo.deletedItems };
        if (grupo.container) siguiente.container = grupo.container;
    }

    return siguiente;
}

test("el incidente: lista local vacia + un reemplazo nuevo no borra los de la nube", () => {
    const enLaNube = Array.from({ length: 492 }, (_item, index) =>
        reemplazo(`r${index}`)
    );
    const documento = { value: JSON.stringify(enLaNube), items: {} };
    const nuevo = reemplazo("nuevo", "FELIPE", "2026-09-15");

    // Lo que planificaba la confirmacion: sin version anterior, la copia local.
    const entries = planPartialStateEntries({
        keys: ["replacements"],
        changes: {},
        readRaw: () => JSON.stringify([nuevo]),
        moduleForKey: stateModuleForKey
    });
    const despues = leerDocumento(escribir(documento, entries));

    assert.ok(entries.every(entry => entry.itemKey), "ninguna entrada con la lista entera");
    assert.equal(despues.length, 493);
    assert.ok(despues.some(item => item.id === "nuevo"));
});

test("sin version anterior, cada elemento es un alta y no se borra nada", () => {
    const entries = planListStateEntries({
        moduleId: "turnos",
        storageKey: "replacements",
        previousRaw: null,
        nextRaw: JSON.stringify([reemplazo("a"), reemplazo("b")])
    });

    assert.deepEqual(entries.map(entry => entry.itemKey), ["a", "b"]);
    assert.ok(entries.every(entry => entry.deleted === false));
    assert.ok(entries.every(entry => entry.container === "array"));
});

test("desde una lista vacia tambien viaja por elemento", () => {
    const entries = planListStateEntries({
        moduleId: "turnos",
        storageKey: "replacements",
        previousRaw: "[]",
        nextRaw: JSON.stringify([reemplazo("a")])
    });

    assert.deepEqual(entries.map(entry => [entry.itemKey, entry.deleted]), [["a", false]]);
});

test("vaciar una lista borra lo que se conocia, elemento por elemento", () => {
    const entries = planListStateEntries({
        moduleId: "turnos",
        storageKey: "replacements",
        previousRaw: JSON.stringify([reemplazo("a"), reemplazo("b")]),
        nextRaw: "[]"
    });

    assert.deepEqual(
        entries.map(entry => [entry.itemKey, entry.deleted]).sort(),
        [["a", true], ["b", true]]
    );
});

test("lo que otro agrego y esta sesion no conocia sobrevive a un vaciado", () => {
    const documento = {
        value: JSON.stringify([reemplazo("a")]),
        items: { b: JSON.stringify(reemplazo("b")) },
        container: "array"
    };
    const entries = planListStateEntries({
        moduleId: "turnos",
        storageKey: "replacements",
        previousRaw: JSON.stringify([reemplazo("a")]),
        nextRaw: "[]"
    });

    assert.deepEqual(leerDocumento(escribir(documento, entries)).map(item => item.id), ["b"]);
});

test("una lista sin id sigue viajando entera: es la red de seguridad", () => {
    assert.equal(
        planListStateEntries({
            moduleId: "turnos",
            storageKey: "replacements",
            previousRaw: null,
            nextRaw: JSON.stringify([{ worker: "ANA" }])
        }),
        null
    );
});

test("la confirmacion de guardado no replanifica listas desde cero", async () => {
    const source = (await readFile(
        new URL("../js/firebaseAppState.js", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");
    const flush = source.slice(
        source.indexOf("export async function flushPendingFirebaseAppStateEntries("),
        source.indexOf("\n}\n", source.indexOf("export async function flushPendingFirebaseAppStateEntries("))
    );

    assert.match(flush, /const planKeys = stateKeys\.filter\(key =>[\s\S]{0,160}!isStoredListRaw\(getRaw\(key, null\)\)/);
    assert.match(flush, /planPartialStateEntries\(\{\s*keys: planKeys,/);
    // Solo listas y nada pendiente: se confirma sin escribir.
    assert.match(flush, /reason: "already-synced"/);
});
