// "Las casillas cambian solas": el calendario se repintaba una vez por MODULO.
//
// El estado del entorno viene partido en 13 modulos, cada uno con su listener y
// su propia lectura. El turno de UNA casilla se calcula con datos de tres de
// ellos (profile, turnos y swap), asi que mientras van llegando la interfaz
// alcanza a pintar mezclas incompletas: el turno sin el cambio de turno todavia
// aplicado, despues con el, despues con la base nueva.
//
// La barrera junta esos avisos en uno. Lo que NO puede hacer es diferir la
// aplicacion del estado: eso ensancharia la ventana en la que un cambio local se
// sube con una copia vieja y pisa el de otro supervisor.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) { this.values.set(key, String(value)); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost" }
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    visibilityState: "hidden", hidden: true,
    body: { dataset: {} },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
};

const { pendingStateModuleCount, settleDelay } =
    await import("../js/firebaseAppState.js");

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const appState = await read("../js/firebaseAppState.js");

/* ======================================================================
   El ritmo de la espera
   ====================================================================== */

test("mientras sigan llegando modulos, se sigue esperando", () => {
    // Cada modulo que llega renueva la espera corta: se repinta cuando dejan de
    // llegar, no una vez por cada uno.
    assert.equal(settleDelay(0), 400);
    assert.equal(settleDelay(100), 400);
    assert.equal(settleDelay(1000), 400);
});

test("pero hay un techo: la pantalla no se queda sin refrescar", () => {
    // En un entorno con edicion continua los modulos podrian no callarse nunca.
    assert.equal(settleDelay(2200), 300, "lo que falta para el techo");
    assert.equal(settleDelay(2500), 0, "se repinta ahora");
    assert.equal(settleDelay(9999), 0);
});

test("la espera nunca es negativa ni infinita", () => {
    assert.equal(settleDelay(-50), 400);
    assert.equal(settleDelay(NaN), 400);
    assert.ok(settleDelay(0) <= 2500);
});

test("arranca sin modulos en vuelo", () => {
    assert.equal(pendingStateModuleCount(), 0);
});

/* ======================================================================
   Lo que la barrera NO hace
   ====================================================================== */

test("el estado se guarda al llegar; lo que se retiene es el aviso", () => {
    // Es la propiedad que hay que conservar. Si se difiriera la aplicacion, un
    // cambio local podria subirse con una copia vieja y pisar el de otro.
    const bloque = appState.slice(
        appState.indexOf("async function applyRemoteModule("),
        appState.indexOf("async function applyInitialModules(")
    );
    const guardado = bloque.indexOf("replaceLocalSnapshotSubset");
    const aviso = bloque.indexOf("scheduleSettledNotify");

    assert.ok(guardado > -1, "sigue guardando el estado del modulo");
    assert.ok(aviso > -1, "y avisa por la barrera");
    assert.ok(guardado < aviso, "primero guarda, despues avisa");
    // Y la barrera no envuelve ninguna escritura.
    const barrera = appState.slice(
        appState.indexOf("function scheduleSettledNotify("),
        appState.indexOf("export function settleDelay(")
    );

    assert.doesNotMatch(barrera, /replaceLocalSnapshot|setItem|setJSON/);
});

test("la carga inicial no pasa por la barrera: ya viene completa", () => {
    // applyInitialModules junta los 13 modulos en una sola foto y la aplica de
    // una vez, asi que ahi no hay nada que juntar.
    // Acotado al CUERPO de la funcion. Antes eran los primeros 3000 caracteres
    // desde su nombre, y al instrumentar la hidratacion por modulo la llamada
    // quedo mas lejos: el test fallaba sin que cambiara nada de lo que vigila.
    const inicio = appState.indexOf("async function applyInitialModules(");

    assert.notEqual(inicio, -1);

    const abre = appState.indexOf("{", appState.indexOf(")", inicio));
    let depth = 0;
    let fin = abre;

    for (; fin < appState.length; fin += 1) {
        if (appState[fin] === "{") depth += 1;
        else if (appState[fin] === "}") {
            depth -= 1;

            if (!depth) break;
        }
    }

    assert.match(
        appState.slice(inicio, fin + 1),
        /onStateChanged\(mergedSnapshot\)/
    );
});

test("los cambios sueltos siguen llegando al instante", () => {
    // Un delta por dia es una edicion de verdad y tiene que verse enseguida; lo
    // que se junta son las recargas de modulo completo.
    assert.match(appState, /onStateChanged\(patch, \{\s*\n\s*partial: true/);
});

test("al cortar la sincronizacion no queda un repintado colgando", () => {
    assert.match(appState, /clearTimeout\(settleTimer\);\s*\n\s*settleTimer = null;/);
    assert.match(appState, /settledPending = false;/);
    assert.match(appState, /modulesApplying = 0;/);
});

test("el contador de modulos se suelta aunque el modulo falle", () => {
    // Sin el finally, un modulo que revienta dejaria el contador arriba para
    // siempre.
    const bloque = appState.slice(
        appState.indexOf("async function handleModuleSnapshot("),
        appState.indexOf("export function pendingStateModuleCount(")
    );

    assert.match(bloque, /modulesApplying \+= 1;/);
    assert.match(
        bloque,
        /\} finally \{\s*\n\s*modulesApplying = Math\.max\(0, modulesApplying - 1\);/
    );
});
