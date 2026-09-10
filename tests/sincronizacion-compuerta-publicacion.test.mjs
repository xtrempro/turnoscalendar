// Una sesión que NO puede leer el estado remoto no puede publicar el suyo.
//
// `waitingInitialState` bloquea las subidas, y el catch del arranque lo ponía en
// `false`: un fallo de lectura ABRÍA la compuerta. Eso convertía "no pude leer"
// en "puedo escribir", y es lo que dejó pasar el borrado de la programación de
// tareas del 2026-09-09, con dos días de reglas sin desplegar por medio.
//
// Las ediciones no se pierden con la compuerta cerrada: las tres compuertas de
// subida reencolan y salen cuando la lectura vuelve.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { handleSyncStatus } from "../js/syncBanner.js";

const src = await readFile(
    new URL("../js/firebaseAppState.js", import.meta.url),
    "utf8"
);
const banner = await readFile(
    new URL("../js/syncBanner.js", import.meta.url),
    "utf8"
);
const main = await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
);
const estilos = await readFile(
    new URL("../styles.css", import.meta.url),
    "utf8"
);

const arranque = src.slice(
    src.indexOf("export async function startFirebaseAppStateSync(")
);
// El de FUERA es el que precede al `finally` que suelta `stateSyncStarting`;
// dentro hay otro por modulo, del arreglo del modulo denegado.
const finFinally = arranque.indexOf("stateSyncStarting = false;");
const captura = arranque.slice(
    arranque.lastIndexOf("} catch (error) {", finFinally),
    finFinally
);

test("el fallo del arranque NO abre la compuerta de publicacion", () => {
    // La linea exacta que causo el incidente.
    assert.doesNotMatch(
        captura,
        /waitingInitialState = false/,
        "un arranque fallido volvia a permitir publicar"
    );
});

test("la compuerta se abre solo cuando el estado inicial SI se aplico", () => {
    assert.match(
        src,
        /rememberAppliedStateEntries\(initialEntries\);[\s\S]{0,220}waitingInitialState = false;/
    );
});

test("un arranque fallido reintenta, o la sesion quedaria muda", () => {
    assert.match(captura, /scheduleInitialStateRetry\(workspace, options\)/);
    assert.match(src, /function scheduleInitialStateRetry\(/);
});

test("el reintento espera cada vez mas, con techo", () => {
    const fn = src.slice(
        src.indexOf("function scheduleInitialStateRetry("),
        src.indexOf("export async function startFirebaseAppStateSync(")
    );

    assert.match(fn, /initialStateRetryDelay \* 2/);
    assert.match(fn, /INITIAL_STATE_RETRY_MAX_MS/);
    // Y no se apila mas de un reintento.
    assert.match(fn, /if \(!workspaceId \|\| initialStateRetryTimer\) return;/);
});

test("la espera acumulada solo se olvida cuando la lectura funciona", () => {
    // `startFirebaseAppStateSync` llama a `stop` al empezar: si el reinicio de
    // la espera viviera ahi, el backoff se quedaria en el primer valor.
    const limpiar = src.slice(
        src.indexOf("function clearInitialStateRetry("),
        src.indexOf("function scheduleInitialStateRetry(")
    );

    assert.doesNotMatch(limpiar, /initialStateRetryDelay = INITIAL_STATE_RETRY_MS/);
    assert.match(
        src,
        /clearInitialStateRetry\(\);\s*\n\s*initialStateRetryDelay = INITIAL_STATE_RETRY_MS;\s*\n\s*waitingInitialState = false;/
    );
});

test("el reintento no insiste si ya arranco o se cambio de unidad", () => {
    const fn = src.slice(
        src.indexOf("function scheduleInitialStateRetry("),
        src.indexOf("export async function startFirebaseAppStateSync(")
    );

    assert.match(fn, /activeWorkspaceId !== workspaceId \|\| unsubscribeState/);
});

test("el bloqueo se avisa por el canal de estado, no solo por consola", () => {
    // Estuvo dos dias fallando con un console.warn como unica senal.
    assert.match(captura, /type: "app-state-blocked"/);
    assert.match(captura, /retryInMs: initialStateRetryDelay/);
});

// El banner recuerda su nodo entre llamadas (es estado de modulo), asi que las
// dos pruebas comparten el MISMO falso: montar uno nuevo no lo reemplazaria.
const falso = {
    _oculto: true,
    get hidden() { return this._oculto; },
    set hidden(valor) { this._oculto = valor; },
    textContent: "",
    isConnected: true,
    setAttribute() {},
    append() {}
};

globalThis.document = {
    getElementById: () => falso,
    createElement: () => falso,
    body: { append() {} }
};

test("el aviso aparece al bloquearse y se retira al sincronizar", () => {
    handleSyncStatus({ type: "app-state-blocked", message: "sin conexion" });

    assert.equal(falso.textContent, "sin conexion");
    assert.equal(falso.hidden, false);

    handleSyncStatus({ type: "app-state-applied", modules: ["turnos"] });

    assert.equal(falso.hidden, true);
});

test("un evento cualquiera no retira el aviso", () => {
    handleSyncStatus({ type: "app-state-blocked", message: "sin conexion" });
    assert.equal(falso.hidden, false);

    // Un error de un modulo suelto no significa que la sincronizacion volvio.
    handleSyncStatus({ type: "app-state-error", moduleId: "tasks" });
    assert.equal(falso.hidden, false);

    // Y las entradas por elemento si la retiran: son estado remoto llegando.
    handleSyncStatus({ type: "app-state-entries-applied", keys: ["x"] });
    assert.equal(falso.hidden, true);
});

test("el aviso esta montado en la app y tiene estilo", () => {
    assert.match(main, /import "\.\/syncBanner\.js";/);
    assert.match(banner, /proturnos:firebaseAppState/);
    assert.match(estilos, /\.sync-blocked-banner \{/);
});
