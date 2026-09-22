// Una sesión que NO puede leer el estado remoto no puede publicar el suyo.
//
// `waitingInitialState` bloquea las subidas, y el catch del arranque lo ponía en
// `false`: un fallo de lectura ABRÍA la compuerta. Eso convertía "no pude leer"
// en "puedo escribir", y es lo que dejó pasar el borrado de la programación de
// tareas del 2026-09-09, con dos días de reglas sin desplegar por medio.
//
// Las ediciones no se pierden con la compuerta cerrada: las tres compuertas de
// subida reencolan y salen cuando la lectura vuelve.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
    ESPERA_AVISO_SIN_CONEXION_MS,
    handleSyncStatus,
    handleBrowserConnectivity
} from "../js/syncBanner.js";

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
    // Se comprueba el ORDEN, no la distancia. Antes se exigia que las dos
    // lineas estuvieran a menos de 220 caracteres: al envolver el registro de
    // firmas en una sonda se separaron y el test fallo, sin que cambiara el
    // orden -que es lo unico que importa aqui-.
    const recuerda = src.indexOf("rememberAppliedStateEntries(initialEntries)");

    assert.notEqual(recuerda, -1, "ya no se registran las firmas iniciales");

    const abre = src.indexOf("waitingInitialState = false;", recuerda);

    assert.notEqual(abre, -1, "la compuerta no se abre despues de aplicar");
    assert.ok(
        recuerda < abre,
        "la compuerta se abre ANTES de registrar lo aplicado"
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
// pruebas comparten el MISMO falso: montar uno nuevo no lo reemplazaria. Por lo
// mismo, cada prueba termina con la conexion de vuelta.
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

// La espera del aviso de caida corre con reloj falso.
mock.timers.enable({ apis: ["setTimeout"] });
const esperar = ms => mock.timers.tick(ms);

test("el bloqueo aparece al tiro y se retira al aplicar el estado inicial", () => {
    handleSyncStatus({ type: "app-state-blocked", message: "sin sincronizacion" });

    // Sin esperar: el bloqueo SI deja cambios sin publicar.
    assert.equal(falso.textContent, "sin sincronizacion");
    assert.equal(falso.hidden, false);
    assert.match(falso.className, /is-blocked/);

    handleSyncStatus({ type: "app-state-applied", modules: ["turnos"] });

    assert.equal(falso.hidden, true);
});

test("una caida que dura se avisa aparte, y no bloquea", () => {
    handleSyncStatus({ type: "app-state-offline" });
    esperar(ESPERA_AVISO_SIN_CONEXION_MS);

    assert.equal(falso.hidden, false);
    assert.match(falso.className, /is-offline/);
    // El texto dice lo importante: los cambios NO se pierden.
    assert.match(falso.textContent, /se enviaran solos al reconectar/);

    handleSyncStatus({ type: "app-state-online" });
    assert.equal(falso.hidden, true, "la vuelta se avisa sin esperar");
});

test("un microcorte NO muestra el aviso", () => {
    // El canal de Firestore que se reabre, el wifi que se reengancha: el aviso
    // salia en cada uno y se leia como "se cae todo el rato".
    assert.ok(ESPERA_AVISO_SIN_CONEXION_MS >= 15 * 1000);

    handleSyncStatus({ type: "app-state-offline" });
    esperar(ESPERA_AVISO_SIN_CONEXION_MS - 1);
    assert.equal(falso.hidden, true);

    handleSyncStatus({ type: "app-state-online" });
    esperar(ESPERA_AVISO_SIN_CONEXION_MS);
    assert.equal(falso.hidden, true, "la espera se cancela al volver");
});

test("cada corte cuenta desde cero", () => {
    handleSyncStatus({ type: "app-state-offline" });
    esperar(ESPERA_AVISO_SIN_CONEXION_MS - 1000);
    handleSyncStatus({ type: "app-state-online" });

    handleSyncStatus({ type: "app-state-offline" });
    esperar(ESPERA_AVISO_SIN_CONEXION_MS - 1000);
    assert.equal(falso.hidden, true);

    esperar(1000);
    assert.equal(falso.hidden, false);

    handleSyncStatus({ type: "app-state-online" });
    assert.equal(falso.hidden, true);
});

test("la espera no se reinicia con cada senal de la misma caida", () => {
    handleBrowserConnectivity(false);
    esperar(20 * 1000);
    handleSyncStatus({ type: "app-state-offline" });
    // El navegador ya ve red, pero el servidor todavia no responde.
    handleBrowserConnectivity(true);
    esperar(ESPERA_AVISO_SIN_CONEXION_MS - 20 * 1000);

    assert.equal(falso.hidden, false, "lleva la espera completa sin conexion");

    handleSyncStatus({ type: "app-state-online" });
    assert.equal(falso.hidden, true);
});

test("aplicar estado NO retira el aviso de caida", () => {
    // Estando offline se aplican datos de la CACHE igual. Si eso retirara el
    // aviso, desapareceria justo cuando hace falta.
    handleSyncStatus({ type: "app-state-offline" });
    esperar(ESPERA_AVISO_SIN_CONEXION_MS);
    assert.equal(falso.hidden, false);

    handleSyncStatus({ type: "app-state-entries-applied", keys: ["x"] });
    assert.equal(falso.hidden, false, "la cache no prueba que haya servidor");

    handleSyncStatus({ type: "app-state-online" });
    assert.equal(falso.hidden, true);
});

test("el bloqueo manda sobre la caida", () => {
    handleSyncStatus({ type: "app-state-offline" });
    esperar(ESPERA_AVISO_SIN_CONEXION_MS);
    handleSyncStatus({ type: "app-state-blocked", message: "no se publica" });

    // Lo grave es que no se puede publicar: eso es lo que hay que leer.
    assert.equal(falso.textContent, "no se publica");
    assert.match(falso.className, /is-blocked/);

    handleSyncStatus({ type: "app-state-applied", modules: [] });
    assert.match(falso.className, /is-offline/, "sigue la caida, sin bloqueo");

    handleSyncStatus({ type: "app-state-online" });
    assert.equal(falso.hidden, true);
});

test("el navegador sin red avisa sin Firestore, con la misma espera", () => {
    handleBrowserConnectivity(false);
    esperar(ESPERA_AVISO_SIN_CONEXION_MS - 1);
    assert.equal(falso.hidden, true);

    esperar(1);
    assert.equal(falso.hidden, false);
    assert.match(falso.className, /is-offline/);

    handleBrowserConnectivity(true);
    assert.equal(falso.hidden, true);
});

test("que el navegador vea red no da por vuelto al servidor", () => {
    handleSyncStatus({ type: "app-state-offline" });
    esperar(ESPERA_AVISO_SIN_CONEXION_MS);

    handleBrowserConnectivity(true);
    assert.equal(falso.hidden, false);

    handleSyncStatus({ type: "app-state-online" });
    assert.equal(falso.hidden, true);
});

test("un error de un modulo suelto no toca el aviso", () => {
    handleSyncStatus({ type: "app-state-offline" });
    esperar(ESPERA_AVISO_SIN_CONEXION_MS);
    handleSyncStatus({ type: "app-state-error", moduleId: "tasks" });

    assert.equal(falso.hidden, false);
    handleSyncStatus({ type: "app-state-online" });
    assert.equal(falso.hidden, true);
});

test("la caida se detecta por fromCache, no por adivinanza", () => {
    // Firestore no avisa "me quede sin servidor": sigue sirviendo de su cache.
    assert.match(src, /function noteServerReachability\(moduleId, metadata\)/);
    assert.match(src, /const fromCache = metadata\?\.fromCache;/);
    // Solo se avisa en los CAMBIOS del agregado.
    assert.match(src, /allFromCache === servingFromCache\) return;/);
    // Y se lee ANTES del corte por snapshot vacio.
    assert.match(
        src,
        /noteServerReachability\(moduleId, snap\?\.metadata\);[\s\S]{0,400}const changes = typeof snap\.docChanges/
    );
});

test("los listeners avisan tambien cuando SOLO cambia la conexion", () => {
    // Sin includeMetadataChanges, Firestore no entrega el paso de cache a
    // servidor si no cambia un dato: la vuelta llegaba con el siguiente cambio
    // de alguien, y el aviso de caida se quedaba pegado mientras tanto.
    assert.match(
        src,
        /moduleEntriesCollection\(\s*db,[\s\S]{0,700}\{ includeMetadataChanges: true \},\s*snap => handleEntriesSnapshot\(/
    );
    // Un listener caido no puede quedar votando con su ultimo estado.
    assert.match(src, /servingFromCacheByModule\.delete\(moduleId\)/);
    assert.match(
        src,
        /export function stopFirebaseAppStateSync\(\) \{[\s\S]{0,200}servingFromCacheByModule\.clear\(\);/
    );
});

// El agregado, ejecutado: la misma funcion de la app con su estado aislado.
function reachability() {
    const fuente = src.slice(
        src.indexOf("function noteServerReachability("),
        src.indexOf("function dispatchStatus(")
    );

    return new Function(`
        const servingFromCacheByModule = new Map();
        let servingFromCache = null;
        const avisos = [];
        function dispatchStatus(detail) { avisos.push(detail.type); }
        ${fuente}
        return { note: noteServerReachability, avisos };
    `)();
}

test("un modulo rezagado en cache NO hace parpadear el aviso", () => {
    const { note, avisos } = reachability();

    note("turnos", { fromCache: false });
    note("tasks", { fromCache: false });
    // Al reconectar, un modulo tarda en volver mientras los otros ya volvieron
    // y siguen trayendo cambios: antes cada snapshot volteaba el indicador.
    note("memos", { fromCache: true });
    note("turnos", { fromCache: false });
    note("memos", { fromCache: true });
    note("tasks", { fromCache: false });
    note("memos", { fromCache: false });

    assert.deepEqual(avisos, ["app-state-online"]);
});

test("la caida real deja a TODOS en cache, y basta uno de vuelta", () => {
    const { note, avisos } = reachability();

    note("turnos", { fromCache: false });
    note("tasks", { fromCache: false });
    note("turnos", { fromCache: true });
    assert.deepEqual(avisos, ["app-state-online"]);

    note("tasks", { fromCache: true });
    assert.deepEqual(avisos, ["app-state-online", "app-state-offline"]);

    // Repetir el mismo estado no vuelve a avisar.
    note("tasks", { fromCache: true });
    note("tasks", { fromCache: false });
    assert.deepEqual(avisos, [
        "app-state-online",
        "app-state-offline",
        "app-state-online"
    ]);
});

test("un snapshot sin metadata no cuenta como voto", () => {
    const { note, avisos } = reachability();

    note("turnos", undefined);
    note("turnos", { fromCache: "si" });
    assert.deepEqual(avisos, []);
});

test("el aviso esta montado en la app y tiene estilo", () => {
    assert.match(main, /import "\.\/syncBanner\.js";/);
    assert.match(banner, /proturnos:firebaseAppState/);
    assert.match(banner, /addEventListener\("offline"/);
    assert.match(estilos, /\.sync-blocked-banner \{/);
    assert.match(estilos, /\.sync-blocked-banner\.is-offline \{/);
});
