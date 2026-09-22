// La programacion no se reescribe si no cambio.
//
// `publishHotNow` llama a `publishSharedScheduleNow` en CADA publicacion, no
// solo cuando la programacion cambia, y el documento lleva las TRES rejillas
// semanales enteras (semanas -1, 0 y +1).
//
// Por que importa mas de lo que parece: el pipeline de escritura de Firestore
// admite DIEZ lotes sin confirmar (MAX_PENDING_WRITES en @firebase/firestore,
// verificado en node_modules). No hacen falta miles de escrituras para agotarlo;
// bastan una docena cuando cada confirmacion tarda segundos. Medido el
// 2026-09-22 en la unidad de ~68 trabajadores: ~39 documentos en ~12 lotes, y
// aun asi salia `resource-exhausted` y un commit de UN documento tardaba 45 s
// porque el SDK ya estaba en backoff maximo.
//
// Se ejecuta la funcion de verdad, cortada del fuente con sus dependencias
// inyectadas: lo que hay que demostrar es que NO escribe, y eso no se ve en el
// texto del codigo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sync = (await readFile(
    new URL("../js/workerAppDataSync.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

/**
 * Corta la firma de modulo MAS la funcion, porque `lastPublishedSchedule` vive
 * fuera de ella y es justo el estado que se quiere probar.
 */
function fuenteConEstado() {
    const start = sync.indexOf("let lastPublishedSchedule");

    assert.notEqual(start, -1, "no se encontro lastPublishedSchedule");

    const fn = sync.indexOf("async function publishSharedScheduleNow(", start);

    assert.notEqual(fn, -1, "la firma no esta junto a la funcion");

    const open = sync.indexOf("{", sync.indexOf(")", fn));
    let depth = 0;
    let end = open;

    for (; end < sync.length; end += 1) {
        if (sync[end] === "{") depth += 1;
        else if (sync[end] === "}") {
            depth -= 1;

            if (!depth) break;
        }
    }

    return sync.slice(start, end + 1);
}

function construir({ adjuntos, fallar = false } = {}) {
    const llamadas = { escrituras: [], eventos: [] };
    let actuales = adjuntos;
    const fabrica = new Function(
        "activeWorkspace",
        "getPublishedScheduleAttachments",
        "getPublishedScheduleAttachment",
        "getFirebaseServices",
        "recordPerformanceEvent",
        "console",
        "llamadas",
        "estado",
        fuenteConEstado() + "\nreturn publishSharedScheduleNow;"
    );
    const firestoreModule = {
        doc: (...partes) => partes.slice(1).join("/"),
        setDoc: async (ref, payload) => {
            if (estado.fallar) throw new Error("resource-exhausted");
            llamadas.escrituras.push({ ref, payload });
        },
        serverTimestamp: () => "SERVER_TS"
    };
    const estado = { fallar };
    const publicar = fabrica(
        { id: "ws1" },
        () => actuales,
        (fecha, mapa) => mapa["2026-09-21"] || null,
        async () => ({ db: {}, firestoreModule }),
        (label, detail) => llamadas.eventos.push({ label, detail }),
        { info() {}, error() {}, warn() {} },
        llamadas,
        estado
    );

    return {
        publicar,
        llamadas,
        estado,
        cambiar(siguiente) { actuales = siguiente; }
    };
}

const SEMANA = {
    "2026-09-21": { weekStartISO: "2026-09-21", rows: [{ tarea: "RX", turno: "dia" }] }
};

/* =========================================================
   Lo que motiva el arreglo
========================================================= */

test("la primera publicacion escribe", async () => {
    const t = construir({ adjuntos: SEMANA });

    await t.publicar();

    assert.equal(t.llamadas.escrituras.length, 1);
});

test("la segunda, con lo mismo, NO escribe", async () => {
    const t = construir({ adjuntos: SEMANA });

    await t.publicar();
    await t.publicar();
    await t.publicar();

    assert.equal(
        t.llamadas.escrituras.length,
        1,
        "reescribir un documento identico ocupa una de las diez ranuras"
    );
});

test("pero si la programacion cambia, SI escribe", async () => {
    const t = construir({ adjuntos: SEMANA });

    await t.publicar();
    t.cambiar({
        "2026-09-21": {
            weekStartISO: "2026-09-21",
            rows: [{ tarea: "RX", turno: "noche" }]
        }
    });
    await t.publicar();

    assert.equal(t.llamadas.escrituras.length, 2);
});

test("agregar una semana tambien cuenta como cambio", async () => {
    const t = construir({ adjuntos: SEMANA });

    await t.publicar();
    t.cambiar({
        ...SEMANA,
        "2026-09-28": { weekStartISO: "2026-09-28", rows: [{ tarea: "TAC" }] }
    });
    await t.publicar();

    assert.equal(t.llamadas.escrituras.length, 2);
});

/* =========================================================
   Los bordes que lo harian inutil o peligroso
========================================================= */

test("las marcas de tiempo NO cuentan como cambio", async () => {
    // Si `updatedAtISO` entrara en la comparacion, el documento se veria
    // distinto SIEMPRE y la deteccion no serviria de nada.
    const t = construir({ adjuntos: SEMANA });

    await t.publicar();
    await t.publicar();

    assert.equal(t.llamadas.escrituras.length, 1);
    assert.equal(t.llamadas.escrituras[0].payload.updatedAt, "SERVER_TS");
    assert.ok(t.llamadas.escrituras[0].payload.updatedAtISO);
});

test("una escritura que FALLA no se da por publicada", async () => {
    // Si la firma se guardara antes de confirmar, un `resource-exhausted` dejaria
    // la programacion sin publicar y nadie volveria a intentarlo.
    const t = construir({ adjuntos: SEMANA, fallar: true });

    await t.publicar();

    assert.equal(t.llamadas.escrituras.length, 0);

    t.estado.fallar = false;
    await t.publicar();

    assert.equal(
        t.llamadas.escrituras.length,
        1,
        "tras el fallo hay que reintentar, no saltarselo"
    );
});

test("el contenido publicado es el mismo de siempre", async () => {
    const t = construir({ adjuntos: SEMANA });

    await t.publicar();

    const payload = t.llamadas.escrituras[0].payload;

    assert.deepEqual(payload.weeklyScheduleAttachments, SEMANA);
    assert.deepEqual(payload.weeklyScheduleAttachment, SEMANA["2026-09-21"]);
});

test("se anota el ahorro, para poder medirlo", async () => {
    const t = construir({ adjuntos: SEMANA });

    await t.publicar();
    await t.publicar();

    const etiquetas = t.llamadas.eventos.map(e => e.label);

    assert.ok(etiquetas.includes("worker-app:publish-schedule"));
    assert.ok(etiquetas.includes("worker-app:publish-schedule-sin-cambios"));
});

/* =========================================================
   La firma va atada a su unidad
========================================================= */

test("la firma no vale para otra unidad", () => {
    // Dos unidades pueden tener programaciones identicas; publicar en una no
    // puede dar por publicada la otra.
    const fuente = fuenteConEstado();

    assert.match(fuente, /lastPublishedSchedule\.workspaceId === workspaceId/);
    assert.match(fuente, /lastPublishedSchedule = \{ workspaceId, signature \}/);
});

test("arranca vacia, asi que la primera de cada sesion se publica igual", () => {
    // Es la que corrige en el telefono un documento con el formato anterior sin
    // obligar a tocar el tablero.
    assert.match(
        fuenteConEstado(),
        /let lastPublishedSchedule = \{ workspaceId: "", signature: "" \};/
    );
});
