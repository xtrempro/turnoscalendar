// Copia local vieja o muy distinta de la del servidor: barra de carga y sin
// edicion hasta aplicar la version del servidor.
//
// Pedido del usuario (2026-09-15), el dia en que un navegador con la lista de
// reemplazos vacia publico 1 registro encima de 492 y la bitacora de ese equipo
// dejo de llegar: "si un computador lleva mas de 1 dia sin conectarse o si la
// info del servidor discrepa en varios puntos respecto a su copia local, que
// aparezca una barra de cargando y que no permita hacer cambios hasta traer la
// ultima version del servidor".
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    LAST_SERVER_SYNC_KEY,
    isRemoteDiscrepant,
    isSyncStale,
    measureRemoteDiscrepancy,
    readLastServerSync,
    writeLastServerSync
} from "../js/syncFreshness.js";
import { isInternalKey } from "../js/persistence.js";

const HOUR = 3600e3;
const NOW = Date.parse("2026-09-15T15:00:00Z");

/* =========================================================
   Hace cuanto
========================================================= */

test("mas de un dia sin traer datos del servidor es copia vieja", () => {
    assert.equal(isSyncStale(new Date(NOW - 23 * HOUR).toISOString(), NOW), false);
    assert.equal(isSyncStale(new Date(NOW - 25 * HOUR).toISOString(), NOW), true);
});

test("un computador que nunca trajo datos del servidor tambien", () => {
    assert.equal(isSyncStale("", NOW), true);
    assert.equal(isSyncStale("basura", NOW), true);
});

test("el ultimo contacto se guarda por unidad y no viaja a la nube", () => {
    const store = new Map();
    const readRaw = key => store.has(key) ? store.get(key) : null;
    const writeRaw = (key, value) => store.set(key, value);

    writeLastServerSync(readRaw, writeRaw, "unidadA", NOW);
    writeLastServerSync(readRaw, writeRaw, "unidadB", NOW - 30 * HOUR);

    assert.equal(readLastServerSync(readRaw, "unidadA"), new Date(NOW).toISOString());
    assert.equal(isSyncStale(readLastServerSync(readRaw, "unidadB"), NOW), true);
    assert.equal(isInternalKey(LAST_SERVER_SYNC_KEY), true);
});

/* =========================================================
   Cuanto discrepa
========================================================= */

const reemplazo = (id, worker = "ANA") => ({ id, worker, date: "2026-09-10" });
const itemDeLista = (storageKey, record) => ({
    moduleId: "turnos",
    storageKey,
    itemKey: record.id,
    container: "array",
    value: JSON.stringify(record),
    deleted: false
});

test("el eco de lo que este computador acaba de subir no es discrepancia", () => {
    const local = { replacements: JSON.stringify([reemplazo("a"), reemplazo("b")]) };
    const medida = measureRemoteDiscrepancy(
        [itemDeLista("replacements", reemplazo("a")), itemDeLista("replacements", reemplazo("b"))],
        key => local[key] ?? null
    );

    assert.deepEqual(medida, { entryCount: 0, keyCount: 0, missingKeys: 0 });
});

test("los mismos registros en otro orden tampoco", () => {
    // El `value` viejo con los items encima: mismo contenido, otro orden.
    const local = { replacements: JSON.stringify([reemplazo("b"), reemplazo("a")]) };
    const medida = measureRemoteDiscrepancy([
        {
            moduleId: "turnos",
            storageKey: "replacements",
            itemKey: "",
            value: JSON.stringify([reemplazo("a")]),
            deleted: false
        },
        itemDeLista("replacements", reemplazo("b"))
    ], key => local[key] ?? null);

    assert.equal(medida.keyCount, 0);
});

test("un cambio normal de otro supervisor no bloquea", () => {
    const local = { replacements: JSON.stringify([reemplazo("a")]) };
    const medida = measureRemoteDiscrepancy(
        [itemDeLista("replacements", reemplazo("a", "BETO"))],
        key => local[key] ?? null
    );

    assert.deepEqual(medida, { entryCount: 1, keyCount: 1, missingKeys: 0 });
    assert.equal(isRemoteDiscrepant(medida), false);
});

test("claves que la copia local ni tiene: dos ya bloquean", () => {
    // Justo lo que tenia el equipo del incidente: sin reemplazos ni bitacora.
    const medida = measureRemoteDiscrepancy([
        itemDeLista("replacements", reemplazo("a")),
        {
            moduleId: "log",
            storageKey: "auditLog",
            itemKey: "l1",
            container: "array",
            value: JSON.stringify({ id: "l1" }),
            deleted: false
        }
    ], () => null);

    assert.equal(medida.missingKeys, 2);
    assert.equal(isRemoteDiscrepant(medida), true);
});

test("una clave vacia que no estaba no cuenta como hueco", () => {
    const medida = measureRemoteDiscrepancy([
        { moduleId: "turnos", storageKey: "noCoverage_ANA", itemKey: "", value: "{}", deleted: false },
        { moduleId: "turnos", storageKey: "leaveHold_ANA", itemKey: "", value: "{}", deleted: false }
    ], () => null);

    assert.equal(medida.missingKeys, 0);
    assert.equal(isRemoteDiscrepant(medida), false);
});

test("muchas claves distintas si bloquean", () => {
    const local = {};
    const entries = Array.from({ length: 8 }, (_item, index) => {
        local[`data_P${index}`] = JSON.stringify({ "2026-8-1": 1 });

        return {
            moduleId: "turnos",
            storageKey: `data_P${index}`,
            itemKey: "2026-8-1",
            value: "2",
            deleted: false
        };
    });

    assert.equal(
        isRemoteDiscrepant(measureRemoteDiscrepancy(entries, key => local[key] ?? null)),
        true
    );
});

/* =========================================================
   La barra
========================================================= */

test("la barra aparece, no deja escribir y se retira", async () => {
    const nodes = [];
    const fakeNode = () => {
        const node = {
            children: [],
            hidden: false,
            textContent: "",
            className: "",
            isConnected: true,
            setAttribute() {},
            append(...children) { this.children.push(...children); },
            appendChild(child) { this.children.push(child); },
            addEventListener() {},
            contains: () => false
        };

        nodes.push(node);
        return node;
    };

    globalThis.document = {
        body: { append() {} },
        createElement: fakeNode,
        getElementById: () => null
    };

    const { handleSyncStatus, shouldBlockKey } = await import("../js/syncBanner.js");

    handleSyncStatus({ type: "app-state-lock", reason: "stale" });

    const overlay = nodes.find(node => node.className === "sync-lock-overlay");
    const [title] = overlay.children[0].children;

    assert.equal(overlay.hidden, false);
    assert.match(title.textContent, /última versión/);
    assert.equal(shouldBlockKey({ key: "a" }), true);
    // Recargar sigue funcionando.
    assert.equal(shouldBlockKey({ key: "F5" }), false);
    assert.equal(shouldBlockKey({ key: "r", ctrlKey: true }), false);

    handleSyncStatus({ type: "app-state-unlock" });

    assert.equal(overlay.hidden, true);
    assert.equal(shouldBlockKey({ key: "a" }), false);
});

/* =========================================================
   El cableado en la sincronizacion
========================================================= */

const appState = (await readFile(
    new URL("../js/firebaseAppState.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");
const styles = (await readFile(
    new URL("../styles.css", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

test("al arrancar con copia de mas de un dia se bloquea y manda el servidor", () => {
    assert.match(appState, /staleStart = localCopyIsStale\(workspaceId\);\s*if \(staleStart\) lockAppState\("stale"\);/);
    assert.match(
        appState,
        /if \(staleStart\) \{\s*pendingStateEntries\.clear\(\);\s*localDirtyStateEntries\.clear\(\);\s*\}\s*mergeLocalDirtyStateEntries\(mergedSnapshot\);/
    );
    assert.match(
        appState,
        /onStateChanged\(mergedSnapshot\);\s*\/\/[^\n]*\n\s*markServerSync\(\{ force: true \}\);\s*staleStart = false;\s*releaseLockWhenApplied\(\);/
    );
});

test("lo que llega distinto en varios puntos bloquea y se aplica sin espera", () => {
    assert.match(appState, /if \(discrepant\) lockAppState\("discrepancy"\);/);
    assert.match(appState, /scheduleRemoteStateApply\(discrepant \? 0 : firebaseRemoteApplyDelay\(\)\);/);
    assert.match(appState, /const delay = stateLockReason \? 0 : firebaseRemoteApplyDelay\(\);/);
});

test("que el documento del modulo no exista ya no vacia la copia local", () => {
    const bloque = appState.slice(
        appState.indexOf("async function handleModuleSnapshot("),
        appState.indexOf("export function pendingStateModuleCount(")
    );

    assert.doesNotMatch(bloque, /replaceLocalSnapshotSubset/);
    assert.doesNotMatch(bloque, /clear-module-subset|preserve-local-module-subset/);
});

test("al volver al computador tras mas de un dia se confirma con el servidor", () => {
    assert.match(appState, /async function confirmServerFreshness\(\)/);
    assert.match(appState, /getDocFromServer/);
    assert.match(appState, /window\.addEventListener\("online", \(\) => \{\s*void confirmServerFreshness\(\);/);
});

test("la barra tiene estilo y respeta el movimiento reducido", () => {
    assert.match(styles, /\.sync-lock-overlay \{/);
    assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{\s*\.sync-lock-bar span/);
});
