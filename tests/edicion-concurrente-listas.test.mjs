// Dos supervisores editando a la vez.
//
// El estado del entorno se sincroniza por CLAVE: cada clave es un documento
// aparte, asi que editar la asignacion de tareas y editar un calendario no
// compiten nunca. El choque solo existe dentro de una misma clave.
//
// Los calendarios ya viajaban partidos por dia. Las listas compartidas de la
// unidad -reemplazos, cambios de turno, preasignaciones, memos, bitacora- no:
// viajaban como UN valor, y el ultimo que escribia pisaba la lista entera. Dos
// supervisores registrando cosas DISTINTAS perdian una de las dos.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
    applyPartialStateEntry,
    groupPartialStateEntries,
    indexListById,
    isPartialStateMapKey,
    isSplittableList,
    mergePartialStateEntries,
    planListStateEntries,
    planPartialStateEntries
} = await import("../js/firebasePartialState.js");
const { stateModuleForKey } = await import("../js/firebaseStateModules.js");
// El servidor lee los mismos deltas con su propia copia (CommonJS).
const { applyEntry } = require("../functions/lib/stateReader.js");

/* ======================================================================
   Firestore de mentira: un documento por clave, con set(merge:true)
   ====================================================================== */

function crearFirestore() {
    const docs = new Map();

    return {
        docs,
        // merge:true funde los mapas en profundidad y reemplaza los escalares.
        set(id, payload) {
            const actual = docs.get(id) || {};
            const siguiente = { ...actual, ...payload };

            if (payload.items) {
                siguiente.items = { ...(actual.items || {}), ...payload.items };
            }
            if (payload.deletedItems) {
                siguiente.deletedItems = {
                    ...(actual.deletedItems || {}),
                    ...payload.deletedItems
                };
            }

            docs.set(id, siguiente);
        }
    };
}

/** Un supervisor edita su copia y sube lo que cambio. */
function subir(firestore, storageKey, antes, despues) {
    const entries = planPartialStateEntries({
        keys: [storageKey],
        changes: { [storageKey]: { previous: antes, next: despues } },
        readRaw: () => despues,
        moduleForKey: stateModuleForKey
    });

    groupPartialStateEntries(entries).forEach(grupo => {
        const payload = { storageKey: grupo.storageKey };

        if (Object.keys(grupo.items).length) {
            payload.items = grupo.items;
            payload.deletedItems = grupo.deletedItems;
            if (grupo.container) payload.container = grupo.container;
        }
        if (Object.prototype.hasOwnProperty.call(grupo, "value")) {
            payload.value = grupo.value;
            payload.deleted = grupo.deleted;
        }

        firestore.set(grupo.storageKey, payload);
    });

    return entries;
}

/** Lo que reconstruye un tercero: la base publicada mas los deltas. */
function leer(firestore, storageKey, base = "") {
    const doc = firestore.docs.get(storageKey);
    const snapshot = base ? { [storageKey]: base } : {};

    if (!doc) return snapshot[storageKey];

    // El valor entero antiguo va primero; los items lo parchean encima.
    if (Object.prototype.hasOwnProperty.call(doc, "value")) {
        applyPartialStateEntry(snapshot, {
            storageKey,
            itemKey: "",
            value: doc.value,
            deleted: doc.deleted === true
        });
    }

    const entries = Object.entries(doc.items || {}).map(([itemKey, value]) => ({
        storageKey,
        itemKey,
        container: doc.container || "",
        value,
        deleted: doc.deletedItems?.[itemKey] === true
    }));

    mergePartialStateEntries(snapshot, entries);

    return snapshot[storageKey];
}

const reemplazo = (id, worker, date) => ({ id, worker, date });

/* ======================================================================
   El caso que se perdia
   ====================================================================== */

test("dos supervisores registran reemplazos distintos y sobreviven los dos", () => {
    const firestore = crearFirestore();
    const original = JSON.stringify([reemplazo("r0", "YA-ESTABA", "2026-08-01")]);

    // Los dos parten de la misma copia y no se ven el uno al otro.
    subir(firestore, "replacements", original, JSON.stringify([
        reemplazo("r0", "YA-ESTABA", "2026-08-01"),
        reemplazo("r1", "ANA-cubre", "2026-08-25")
    ]));
    subir(firestore, "replacements", original, JSON.stringify([
        reemplazo("r0", "YA-ESTABA", "2026-08-01"),
        reemplazo("r2", "BETO-cubre", "2026-08-28")
    ]));

    const resultado = JSON.parse(leer(firestore, "replacements", original));

    assert.deepEqual(
        resultado.map(item => item.worker).sort(),
        ["ANA-cubre", "BETO-cubre", "YA-ESTABA"]
    );
});

test("el que ya estaba no se duplica ni se pierde", () => {
    const firestore = crearFirestore();
    const original = JSON.stringify([reemplazo("r0", "YA-ESTABA", "2026-08-01")]);

    subir(firestore, "replacements", original, JSON.stringify([
        reemplazo("r0", "YA-ESTABA", "2026-08-01"),
        reemplazo("r1", "ANA-cubre", "2026-08-25")
    ]));

    const resultado = JSON.parse(leer(firestore, "replacements", original));

    assert.equal(resultado.filter(item => item.id === "r0").length, 1);
});

test("editar y borrar elementos distintos tampoco se pisa", () => {
    const firestore = crearFirestore();
    const original = JSON.stringify([
        reemplazo("r1", "ANA", "2026-08-25"),
        reemplazo("r2", "BETO", "2026-08-28")
    ]);

    // Ana corrige el suyo; Beto borra el otro.
    subir(firestore, "replacements", original, JSON.stringify([
        reemplazo("r1", "ANA-corregida", "2026-08-25"),
        reemplazo("r2", "BETO", "2026-08-28")
    ]));
    subir(firestore, "replacements", original, JSON.stringify([
        reemplazo("r1", "ANA", "2026-08-25")
    ]));

    const resultado = JSON.parse(leer(firestore, "replacements", original));

    assert.deepEqual(resultado.map(item => item.id), ["r1"]);
    assert.equal(resultado[0].worker, "ANA-corregida", "la correccion sobrevive");
});

test("sobre el MISMO elemento gana el ultimo, como una casilla", () => {
    const firestore = crearFirestore();
    const original = JSON.stringify([reemplazo("r1", "ANA", "2026-08-25")]);

    subir(firestore, "replacements", original, JSON.stringify([
        reemplazo("r1", "VERSION-ANA", "2026-08-25")
    ]));
    subir(firestore, "replacements", original, JSON.stringify([
        reemplazo("r1", "VERSION-BETO", "2026-08-25")
    ]));

    const resultado = JSON.parse(leer(firestore, "replacements", original));

    assert.equal(resultado.length, 1);
    assert.equal(resultado[0].worker, "VERSION-BETO");
});

/* ======================================================================
   La red de seguridad: si no se reconoce la forma, se manda entera
   ====================================================================== */

test("una lista sin id no se parte: se comporta como antes", () => {
    const sinId = JSON.stringify([{ worker: "ANA" }, { worker: "BETO" }]);

    assert.equal(isSplittableList(sinId), false);
    assert.equal(indexListById(JSON.parse(sinId)), null);
    assert.equal(
        planListStateEntries({
            moduleId: "turnos",
            storageKey: "replacements",
            previousRaw: "[]",
            nextRaw: sinId
        }),
        null
    );
});

test("dos elementos con el mismo id tampoco se parten", () => {
    const repetido = JSON.stringify([
        reemplazo("r1", "ANA", "2026-08-25"),
        reemplazo("r1", "BETO", "2026-08-28")
    ]);

    assert.equal(isSplittableList(repetido), false);
});

test("un objeto se parte por sus claves, no viaja entero", () => {
    const firestore = crearFirestore();
    const antes = JSON.stringify({ allowSwaps: true, monthlySwapLimit: 2 });
    const entries = subir(
        firestore,
        "turnChangeConfig",
        antes,
        JSON.stringify({ allowSwaps: false, monthlySwapLimit: 2 })
    );

    assert.deepEqual(entries.map(entry => entry.itemKey), ["allowSwaps"]);
});

test("la asignacion de tareas tambien se parte: dos supervisores no se pisan", () => {
    // Es el ejemplo que preocupaba: guarda un objeto, no una lista.
    const firestore = crearFirestore();
    const CLAVE = "weekly_task_assignment_entries";
    const original = JSON.stringify({ "sem1": { tarea: "A" } });

    subir(firestore, CLAVE, original, JSON.stringify({
        "sem1": { tarea: "A" },
        "sem2": { tarea: "ANA" }
    }));
    subir(firestore, CLAVE, original, JSON.stringify({
        "sem1": { tarea: "A" },
        "sem3": { tarea: "BETO" }
    }));

    const resultado = JSON.parse(leer(firestore, CLAVE, original));

    assert.deepEqual(Object.keys(resultado).sort(), ["sem1", "sem2", "sem3"]);
    assert.equal(resultado.sem2.tarea, "ANA");
    assert.equal(resultado.sem3.tarea, "BETO");
});

test("un valor escalar no se parte: no hay nada que partir", () => {
    const firestore = crearFirestore();
    const entries = subir(
        firestore,
        "weekly_task_assignment_updated",
        JSON.stringify("2026-08-01T10:00:00Z"),
        JSON.stringify("2026-08-31T10:00:00Z")
    );

    assert.equal(entries.length, 1);
    assert.equal(entries[0].itemKey, "");
});

test("borrar la clave entera sigue borrandola", () => {
    const entries = planPartialStateEntries({
        keys: ["replacements"],
        changes: {
            replacements: {
                previous: JSON.stringify([reemplazo("r1", "ANA", "x")]),
                next: null,
                removed: true
            }
        },
        readRaw: () => null,
        moduleForKey: stateModuleForKey
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].itemKey, "");
    assert.equal(entries[0].deleted, true);
});

test("los calendarios siguen partiendose por dia, no por lista", () => {
    assert.equal(isPartialStateMapKey("data_ANA"), true);
    assert.equal(isPartialStateMapKey("replacements"), false);

    const entries = planPartialStateEntries({
        keys: ["data_ANA"],
        changes: {
            data_ANA: {
                previous: JSON.stringify({ "2026-7-20": 1 }),
                next: JSON.stringify({ "2026-7-20": 1, "2026-7-25": 2 })
            }
        },
        readRaw: () => null,
        moduleForKey: stateModuleForKey
    });

    assert.deepEqual(entries.map(entry => entry.itemKey), ["2026-7-25"]);
    assert.equal(entries[0].container, undefined, "un dia no es una lista");
});

/* ======================================================================
   Migracion: documentos que ya traian el valor entero
   ====================================================================== */

test("el valor entero antiguo se aplica antes que los items nuevos", () => {
    // Un documento escrito por la version anterior conserva su `value`: merge no
    // borra campos. Ignorarlo perderia lo que solo viviera ahi.
    const snapshot = {};
    const doc = {
        value: JSON.stringify([reemplazo("viejo", "DE-ANTES", "2026-08-01")]),
        container: "array",
        items: {
            nuevo: JSON.stringify(reemplazo("nuevo", "DE-AHORA", "2026-08-25"))
        },
        deletedItems: {}
    };

    applyPartialStateEntry(snapshot, {
        storageKey: "replacements",
        itemKey: "",
        value: doc.value
    });
    mergePartialStateEntries(snapshot, [{
        storageKey: "replacements",
        itemKey: "nuevo",
        container: "array",
        value: doc.items.nuevo
    }]);

    assert.deepEqual(
        JSON.parse(snapshot.replacements).map(item => item.worker),
        ["DE-ANTES", "DE-AHORA"]
    );
});

/* ======================================================================
   El servidor tiene que reconstruir lo mismo
   ====================================================================== */

test("navegador y servidor reconstruyen la lista igual", () => {
    // La Cloud Function de cobertura automatica y la proyeccion a la PWA leen
    // `replacements` por su cuenta: si el servidor no entendiera los items,
    // leeria una lista incompleta y ofreceria turnos ya cubiertos.
    const base = JSON.stringify([reemplazo("r0", "YA-ESTABA", "2026-08-01")]);
    const items = {
        r1: JSON.stringify(reemplazo("r1", "ANA", "2026-08-25")),
        r2: JSON.stringify(reemplazo("r2", "BETO", "2026-08-28"))
    };

    // Cliente
    const cliente = { replacements: base };

    mergePartialStateEntries(cliente, Object.entries(items).map(([id, value]) => ({
        storageKey: "replacements",
        itemKey: id,
        container: "array",
        value
    })));

    // Servidor
    const servidor = { replacements: base };

    applyEntry(servidor, {
        storageKey: "replacements",
        container: "array",
        items,
        deletedItems: {}
    });

    assert.deepEqual(
        JSON.parse(cliente.replacements),
        JSON.parse(servidor.replacements)
    );
    assert.deepEqual(
        JSON.parse(servidor.replacements).map(item => item.worker),
        ["YA-ESTABA", "ANA", "BETO"]
    );
});

test("el servidor tambien borra elementos y respeta el valor antiguo", () => {
    const servidor = {
        replacements: JSON.stringify([
            reemplazo("r1", "ANA", "2026-08-25"),
            reemplazo("r2", "BETO", "2026-08-28")
        ])
    };

    applyEntry(servidor, {
        storageKey: "replacements",
        container: "array",
        items: {},
        deletedItems: { r2: true }
    });

    assert.deepEqual(
        JSON.parse(servidor.replacements).map(item => item.id),
        ["r1"]
    );

    // Y un documento migrado: primero el valor entero, despues los items.
    const migrado = {};

    applyEntry(migrado, {
        storageKey: "replacements",
        container: "array",
        value: JSON.stringify([reemplazo("viejo", "DE-ANTES", "2026-08-01")]),
        items: { nuevo: JSON.stringify(reemplazo("nuevo", "DE-AHORA", "2026-08-25")) },
        deletedItems: {}
    });

    assert.deepEqual(
        JSON.parse(migrado.replacements).map(item => item.worker),
        ["DE-ANTES", "DE-AHORA"]
    );
});

test("el servidor sigue leyendo los mapas por dia como siempre", () => {
    const servidor = { data_ANA: JSON.stringify({ "2026-7-20": 1 }) };

    applyEntry(servidor, {
        storageKey: "data_ANA",
        items: { "2026-7-25": "2" },
        deletedItems: {}
    });

    assert.deepEqual(
        JSON.parse(servidor.data_ANA),
        { "2026-7-20": 1, "2026-7-25": 2 }
    );
});

/* ======================================================================
   Una lista NUNCA se convierte en objeto
   ====================================================================== */

// Esto rompio produccion: normalizeQueuedStateEntries descartaba el marcador de
// contenedor, asi que al reaplicar un cambio local pendiente la lista se
// parcheaba como si fuera un mapa. `swaps` pasaba de [] a {} y todo lo que la
// recorre reventaba: el calendario no pintaba una sola casilla.

test("sin el marcador, la forma real del dato manda", () => {
    const snapshot = {
        replacements: JSON.stringify([reemplazo("r1", "ANA", "2026-08-25")])
    };

    // Entry SIN container, como llegaba despues de pasar por la cola.
    applyPartialStateEntry(snapshot, {
        storageKey: "replacements",
        itemKey: "r2",
        value: JSON.stringify(reemplazo("r2", "BETO", "2026-08-28"))
    });

    const resultado = JSON.parse(snapshot.replacements);

    assert.ok(Array.isArray(resultado), "sigue siendo una lista");
    assert.deepEqual(resultado.map(item => item.id), ["r1", "r2"]);
});

test("la cola conserva el marcador de contenedor", async () => {
    const { normalizeQueuedStateEntries } =
        await import("../js/firebaseAppState.js");
    const [entry] = normalizeQueuedStateEntries([{
        moduleId: "turnos",
        storageKey: "replacements",
        container: "array",
        items: { r1: JSON.stringify(reemplazo("r1", "ANA", "2026-08-25")) },
        deletedItems: {}
    }]);

    assert.equal(entry.container, "array");

    // Y tambien en el camino del valor entero.
    const [suelto] = normalizeQueuedStateEntries([{
        moduleId: "turnos",
        storageKey: "replacements",
        itemKey: "r1",
        container: "array",
        value: JSON.stringify(reemplazo("r1", "ANA", "2026-08-25"))
    }]);

    assert.equal(suelto.container, "array");
});

test("un mapa por dia sigue siendo un mapa", () => {
    // La guarda mira la forma real: un calendario no es lista y no debe
    // tratarse como tal.
    const snapshot = { data_ANA: JSON.stringify({ "2026-7-20": 1 }) };

    applyPartialStateEntry(snapshot, {
        storageKey: "data_ANA",
        itemKey: "2026-7-25",
        value: "2"
    });

    const resultado = JSON.parse(snapshot.data_ANA);

    assert.ok(!Array.isArray(resultado));
    assert.deepEqual(resultado, { "2026-7-20": 1, "2026-7-25": 2 });
});

test("una clave que todavia no existe no se rompe", () => {
    const snapshot = {};

    applyPartialStateEntry(snapshot, {
        storageKey: "replacements",
        itemKey: "r1",
        container: "array",
        value: JSON.stringify(reemplazo("r1", "ANA", "2026-08-25"))
    });

    assert.ok(Array.isArray(JSON.parse(snapshot.replacements)));
});

/* ======================================================================
   Areas distintas nunca compiten
   ====================================================================== */

test("asignacion de tareas y calendario son documentos distintos", () => {
    // Es la pregunta del usuario: no hay forma de que se pisen, porque el
    // reparto es por clave y cada clave es su propio documento.
    const firestore = crearFirestore();

    subir(
        firestore,
        "weekly_task_assignment_entries",
        JSON.stringify({ a: 1 }),
        JSON.stringify({ a: 2 })
    );
    subir(
        firestore,
        "data_ANA",
        JSON.stringify({ "2026-7-20": 1 }),
        JSON.stringify({ "2026-7-20": 1, "2026-7-25": 2 })
    );

    assert.deepEqual(
        [...firestore.docs.keys()].sort(),
        ["data_ANA", "weekly_task_assignment_entries"]
    );
    assert.notEqual(
        stateModuleForKey("weekly_task_assignment_entries"),
        stateModuleForKey("data_ANA")
    );
});

/* ======================================================================
   Lectura tolerante: una lista rota no deja la pantalla en blanco
   ====================================================================== */

test("una lista que quedo como objeto se recupera al leerla", async () => {
    // Es lo que dejo la aplicacion inutilizable: `swaps` convertido en mapa,
    // y getSwaps devolviendo un objeto sobre el que .some() revienta. Los
    // registros siguen ahi, solo cambio el envase.
    const { asRecordList } = await import("../js/storage.js");
    const corrupto = {
        r1: reemplazo("r1", "ANA", "2026-08-25"),
        r2: reemplazo("r2", "BETO", "2026-08-28")
    };
    const recuperado = asRecordList(corrupto);

    assert.ok(Array.isArray(recuperado));
    assert.deepEqual(recuperado.map(item => item.worker), ["ANA", "BETO"]);
});

test("una lista sana pasa intacta", async () => {
    const { asRecordList } = await import("../js/storage.js");
    const sana = [reemplazo("r1", "ANA", "2026-08-25")];

    assert.equal(asRecordList(sana), sana);
});

test("un valor sin sentido devuelve lista vacia, no una excepcion", async () => {
    // Una pantalla en blanco es mucho peor que un dato raro.
    const { asRecordList } = await import("../js/storage.js");

    ["basura", 42, null, undefined, true].forEach(valor => {
        assert.deepEqual(asRecordList(valor), []);
    });
});

/* ======================================================================
   El camino REAL, de punta a punta
   ====================================================================== */

// Esta es la prueba que faltaba y que habria atrapado el incidente. Las otras
// ejercitaban las piezas por separado con un Firestore simulado; el fallo vivia
// en la COLA, que ninguna tocaba: normalizeQueuedStateEntries descartaba el
// marcador de contenedor, y al reaplicar el cambio local pendiente la lista se
// convertia en objeto.
//
// Aqui se recorre la cadena completa tal como corre en el navegador:
//   editar -> planPartialStateEntries -> cola (normalize) -> reaplicar

test("el camino completo deja la lista como lista, no como objeto", async () => {
    const { normalizeQueuedStateEntries } =
        await import("../js/firebaseAppState.js");

    const antes = JSON.stringify([reemplazo("s1", "AMBAR", "2026-09-01")]);
    const despues = JSON.stringify([
        reemplazo("s1", "AMBAR", "2026-09-01"),
        reemplazo("s2", "SEBASTIAN", "2026-09-04")
    ]);

    // 1. El supervisor edita.
    const planeadas = planPartialStateEntries({
        keys: ["swaps"],
        changes: { swaps: { previous: antes, next: despues } },
        readRaw: () => despues,
        moduleForKey: stateModuleForKey
    });

    // 2. Pasan por la cola, que es donde se perdia el marcador.
    const enCola = normalizeQueuedStateEntries(planeadas);

    // 3. Se reaplican sobre el estado, como hace mergeLocalDirtyStateEntries
    //    cada vez que llega un modulo.
    const snapshot = { swaps: antes };

    mergePartialStateEntries(snapshot, enCola);

    const resultado = JSON.parse(snapshot.swaps);

    assert.ok(
        Array.isArray(resultado),
        "la lista no puede volverse objeto al pasar por la cola"
    );
    assert.deepEqual(
        resultado.map(item => item.worker),
        ["AMBAR", "SEBASTIAN"]
    );
});

test("y lo mismo para un objeto, que debe seguir siendo objeto", async () => {
    const { normalizeQueuedStateEntries } =
        await import("../js/firebaseAppState.js");

    const antes = JSON.stringify({ allowSwaps: true, monthlySwapLimit: 2 });
    const despues = JSON.stringify({ allowSwaps: false, monthlySwapLimit: 2 });
    const enCola = normalizeQueuedStateEntries(planPartialStateEntries({
        keys: ["turnChangeConfig"],
        changes: { turnChangeConfig: { previous: antes, next: despues } },
        readRaw: () => despues,
        moduleForKey: stateModuleForKey
    }));
    const snapshot = { turnChangeConfig: antes };

    mergePartialStateEntries(snapshot, enCola);

    const resultado = JSON.parse(snapshot.turnChangeConfig);

    assert.ok(!Array.isArray(resultado));
    assert.deepEqual(resultado, { allowSwaps: false, monthlySwapLimit: 2 });
});

test("el documento que sube la cola conserva el marcador", async () => {
    // Sin esto, otro equipo leeria los elementos sin saber que son una lista.
    const { normalizeQueuedStateEntries } =
        await import("../js/firebaseAppState.js");
    const planeadas = planPartialStateEntries({
        keys: ["swaps"],
        changes: {
            swaps: {
                previous: JSON.stringify([reemplazo("s1", "AMBAR", "2026-09-01")]),
                next: JSON.stringify([
                    reemplazo("s1", "AMBAR", "2026-09-01"),
                    reemplazo("s2", "SEBASTIAN", "2026-09-04")
                ])
            }
        },
        readRaw: () => "",
        moduleForKey: stateModuleForKey
    });
    const [documento] = groupPartialStateEntries(
        normalizeQueuedStateEntries(planeadas)
    );

    assert.equal(documento.container, "array");
});

test("una lista que nace vacia tambien viaja por elemento", () => {
    // Hasta el 2026-09-15 una lista vacia -o sin version anterior- subia el
    // primer elemento como valor COMPLETO. Con una copia local incompleta eso
    // pisaba la lista de la nube: asi se perdieron 343 reemplazos de
    // Imagenologia (ver tests/reemplazos-lista-entera.test.mjs). Ahora cada
    // elemento es un alta, y nada de lo que habia se toca.
    const entries = planPartialStateEntries({
        keys: ["swaps"],
        changes: {
            swaps: {
                previous: JSON.stringify([]),
                next: JSON.stringify([reemplazo("s1", "AMBAR", "2026-09-01")])
            }
        },
        readRaw: () => "",
        moduleForKey: stateModuleForKey
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].itemKey, "s1", "va como elemento, no como valor entero");
    assert.equal(entries[0].container, "array");
    assert.equal(entries[0].deleted, false);
});
