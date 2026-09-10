// El motor EMPAQUETADO corre de verdad en Node y arma los dos documentos.
//
// Las pruebas que leen el codigo fuente no atrapan lo que rompe aqui: una
// dependencia que el shim de `localStorage` no cubre, un import que en el bundle
// queda en TDZ, o `canSwapProfiles` leyendo un estado que en el servidor no
// existe. Esto se ejecuta contra `functions/engine/engine.mjs`, que es
// exactamente lo que sube a la nube.
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

const BUNDLE = new URL("../functions/engine/engine.mjs", import.meta.url);

// El bundle se genera en el predeploy y esta gitignored: si no esta, no hay
// nada que probar (y decirlo es mejor que fingir que paso).
const hayBundle = existsSync(BUNDLE);

function instalarGlobales() {
    const noopEl = {
        addEventListener() {}, removeEventListener() {}, appendChild() {},
        setAttribute() {}, style: {}, classList: { add() {}, remove() {} },
        click() {}, remove() {}
    };

    globalThis.window = globalThis.window || {
        dispatchEvent: () => true,
        addEventListener() {},
        removeEventListener() {}
    };
    globalThis.CustomEvent = globalThis.CustomEvent || class CustomEvent {
        constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    };
    globalThis.document = globalThis.document || {
        addEventListener() {}, removeEventListener() {},
        visibilityState: "hidden", hidden: true,
        body: noopEl, documentElement: noopEl,
        createElement: () => ({ ...noopEl }),
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => []
    };
    globalThis.window.document = globalThis.document;
}

function memoria(seed = {}) {
    const map = new Map();

    Object.entries(seed).forEach(([key, value]) => {
        map.set(key, typeof value === "string" ? value : JSON.stringify(value));
    });

    return {
        get length() { return map.size; },
        clear() { map.clear(); },
        getItem(key) { return map.has(key) ? map.get(key) : null; },
        key(index) { return [...map.keys()][index] ?? null; },
        removeItem(key) { map.delete(key); },
        setItem(key, value) { map.set(key, String(value)); }
    };
}

// Dos TM de Imagenologia con rotativas distintas: compatibles para cambio de
// turno. Y una tercera de otro estamento, que no debe salir compatible.
const ESTADO = {
    profiles: [
        { id: "p1", name: "ANA PEREZ", rut: "1-9", estamento: "TM", profession: "TM Imagenologia", active: true },
        { id: "p2", name: "BETO SOTO", rut: "2-7", estamento: "TM", profession: "TM Imagenologia", active: true },
        { id: "p3", name: "CARLA DIAZ", rut: "3-5", estamento: "Auxiliar", profession: "Auxiliar", active: true }
    ],
    rotativas: { "ANA PEREZ": "A", "BETO SOTO": "B", "CARLA DIAZ": "A" },
    turnChangeConfig: { allowSwaps: true, allowTwentyFourHourShifts: true }
};

const LINKS = [
    { uid: "uid-ana", profileName: "ANA PEREZ", profileRut: "1-9", updatedAtISO: "2026-09-01T00:00:00.000Z" },
    { uid: "uid-beto", profileName: "BETO SOTO", profileRut: "2-7", updatedAtISO: "2026-09-01T00:00:00.000Z" },
    { uid: "uid-carla", profileName: "CARLA DIAZ", profileRut: "3-5", updatedAtISO: "2026-09-01T00:00:00.000Z" }
];

test("el bundle del servidor arma los dos documentos por enlazado", { skip: !hayBundle && "falta functions/engine/engine.mjs (npm run build)" }, async () => {
    instalarGlobales();
    globalThis.localStorage = memoria(ESTADO);

    const engine = await import(pathToFileURL(BUNDLE.pathname.replace(/^\//, "")).href);

    engine.seedLinkedDocsContext({ blockedDays: [] });

    const built = engine.buildLinkedWorkerDocuments(
        { id: "ws", name: "Imagenologia" },
        LINKS,
        "2026-09-10T01:00:00.000Z"
    );

    // Tres enlazados x dos documentos.
    assert.equal(built.documents.length, 6);
    assert.equal(built.failed.length, 0, JSON.stringify(built.failed));
    assert.deepEqual(built.duplicates, []);
    assert.deepEqual(built.unmatchedLinks, []);

    const colecciones = new Set(built.documents.map(item => item.collection));
    assert.deepEqual(
        [...colecciones].sort(),
        ["workerMessageDirectory", "workerSwapCandidates"]
    );
});

test("canSwapProfiles corre en el servidor y respeta el estamento", { skip: !hayBundle && "falta el bundle" }, async () => {
    instalarGlobales();
    globalThis.localStorage = memoria(ESTADO);

    const engine = await import(pathToFileURL(BUNDLE.pathname.replace(/^\//, "")).href);

    engine.seedLinkedDocsContext({ blockedDays: [] });

    const built = engine.buildLinkedWorkerDocuments(
        { id: "ws", name: "Imagenologia" },
        LINKS,
        "2026-09-10T01:00:00.000Z"
    );
    const candidatoDe = (uid) => built.documents.find(item =>
        item.collection === "workerSwapCandidates" && item.uid === uid
    ).payload;

    // Este era "el hueco real" del plan: canSwapProfiles vivia solo en el
    // cliente. Dos TM con rotativa distinta son compatibles entre si.
    assert.deepEqual(candidatoDe("uid-ana").compatibleWorkerUids, ["uid-beto"]);
    assert.deepEqual(candidatoDe("uid-beto").compatibleWorkerUids, ["uid-ana"]);
    // La auxiliar no es compatible con ningun TM.
    assert.deepEqual(candidatoDe("uid-carla").compatibleWorkerUids, []);
});

test("en el servidor, un Diurno solo es compatible con otro Diurno", { skip: !hayBundle && "falta el bundle" }, async () => {
    // La PWA solo ofrece los colegas que el servidor pone en
    // `compatibleWorkerUids`, y el backend rechaza el cambio si el par no esta
    // ahi. Si el bundle quedara con la regla vieja, un Diurno seguiria viendo a
    // un 4to turno en el telefono aunque el supervisor ya no pudiera registrarlo.
    instalarGlobales();
    globalThis.localStorage = memoria({
        profiles: [
            { id: "d1", name: "DANI DIURNO", rut: "4-3", estamento: "TM", profession: "TM Imagenologia", active: true },
            { id: "d2", name: "EVA DIURNO", rut: "5-1", estamento: "TM", profession: "TM Imagenologia", active: true },
            { id: "r1", name: "FEDE CUARTO", rut: "6-K", estamento: "TM", profession: "TM Imagenologia", active: true }
        ],
        "rotativa_DANI DIURNO": { type: "diurno", start: "2026-01-01" },
        "rotativa_EVA DIURNO": { type: "diurno", start: "2026-01-01" },
        "rotativa_FEDE CUARTO": { type: "4turno", start: "2026-01-01" },
        turnChangeConfig: { allowSwaps: true, allowTwentyFourHourShifts: true }
    });

    const engine = await import(pathToFileURL(BUNDLE.pathname.replace(/^\//, "")).href);

    engine.seedLinkedDocsContext({ blockedDays: [] });

    const built = engine.buildLinkedWorkerDocuments(
        { id: "ws", name: "Imagenologia" },
        [
            { uid: "uid-dani", profileName: "DANI DIURNO", profileRut: "4-3", updatedAtISO: "2026-09-01T00:00:00.000Z" },
            { uid: "uid-eva", profileName: "EVA DIURNO", profileRut: "5-1", updatedAtISO: "2026-09-01T00:00:00.000Z" },
            { uid: "uid-fede", profileName: "FEDE CUARTO", profileRut: "6-K", updatedAtISO: "2026-09-01T00:00:00.000Z" }
        ],
        "2026-09-10T01:00:00.000Z"
    );
    const candidatoDe = (uid) => built.documents.find(item =>
        item.collection === "workerSwapCandidates" && item.uid === uid
    ).payload;

    assert.deepEqual(candidatoDe("uid-dani").compatibleWorkerUids, ["uid-eva"]);
    assert.deepEqual(candidatoDe("uid-eva").compatibleWorkerUids, ["uid-dani"]);
    assert.deepEqual(candidatoDe("uid-fede").compatibleWorkerUids, []);
});

test("el sello de la corrida es UNO solo para todos los documentos", { skip: !hayBundle && "falta el bundle" }, async () => {
    // Si cada documento se sellara con su propio `new Date()`, dos corridas
    // seguidas no se podrian comparar entre si.
    instalarGlobales();
    globalThis.localStorage = memoria(ESTADO);

    const engine = await import(pathToFileURL(BUNDLE.pathname.replace(/^\//, "")).href);

    engine.seedLinkedDocsContext({ blockedDays: [] });

    const built = engine.buildLinkedWorkerDocuments(
        { id: "ws", name: "Imagenologia" },
        LINKS,
        "2026-09-10T01:00:00.000Z"
    );

    const sellos = new Set(built.documents.map(item => item.payload.updatedAtISO));

    assert.deepEqual([...sellos], ["2026-09-10T01:00:00.000Z"]);
});

test("dos corridas seguidas producen documentos equivalentes", { skip: !hayBundle && "falta el bundle" }, async () => {
    // Es la propiedad de la que depende toda la mejora: si el servidor no
    // produjera dos veces lo mismo, el comparador escribiria los 132 documentos
    // en cada corrida.
    instalarGlobales();
    globalThis.localStorage = memoria(ESTADO);

    const engine = await import(pathToFileURL(BUNDLE.pathname.replace(/^\//, "")).href);

    engine.seedLinkedDocsContext({ blockedDays: [] });

    const uno = engine.buildLinkedWorkerDocuments(
        { id: "ws", name: "Imagenologia" }, LINKS, "2026-09-10T01:00:00.000Z"
    );
    const dos = engine.buildLinkedWorkerDocuments(
        { id: "ws", name: "Imagenologia" }, LINKS, "2026-09-10T09:45:00.000Z"
    );

    uno.documents.forEach((item, index) => {
        assert.equal(
            engine.linkedDocChanged(item.payload, dos.documents[index].payload),
            false,
            `${item.collection}/${item.uid} cambio entre dos corridas identicas`
        );
    });
});
