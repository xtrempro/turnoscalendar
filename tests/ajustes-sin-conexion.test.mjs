// Guardar Ajustes sin conexion.
//
// El 2026-10-14, en modo avion: "Guardar cambios" dejaba el modal abierto para
// siempre y al cerrar con la cruz aparecia "Hay cambios sin guardar". No era un
// error raro: la promesa de `updateDoc` de Firestore SOLO se resuelve cuando el
// servidor confirma, y sin conexion no se resuelve NUNCA (tampoco rechaza). El
// manejador la esperaba con `await`, asi que ni guardaba el resto de los
// ajustes, ni cerraba, ni explicaba nada.
//
// Estas pruebas EJECUTAN el guardado con un servidor de mentira que se queda
// callado, en vez de comprobar que el codigo mencione el plazo.

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

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
    removeEventListener() {}
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};

const { isInternalKey } = await import("../js/persistence.js");
const {
    MAX_PENDING_AGE_MS,
    PENDING_DOC_WRITES_KEY,
    flushPendingDocWrites,
    pendingDocWrites,
    updateDocSoon
} = await import("../js/pendingDocWrites.js");
const { setWorkspaceEstablishment } = await import("../js/workspaces.js");
const { saveWorkspaceMemberPermissions } = await import(
    "../js/workspacePermissions.js"
);

// Sin conexion la promesa no se resuelve ni se rechaza: se queda esperando.
const sinConexion = () => new Promise(() => {});

// Cerrar y volver a abrir el navegador: el SDK pierde lo que tenia encolado en
// memoria y solo queda la anotacion en localStorage.
let recargas = 0;

async function recargarPestana() {
    recargas += 1;

    return import(`../js/pendingDocWrites.js?recarga=${recargas}`);
}

const siguienteVuelta = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => localStorage.clear());

test("sin conexion, guardar NO se queda esperando al servidor", async () => {
    const envio = await updateDocSoon({
        path: "workspaces/ws-1",
        data: { establishment: "hospital-claudio-vicuna" },
        uid: "u1",
        waitMs: 20,
        write: sinConexion
    });

    // Que vuelva es lo que permite cerrar el modal.
    assert.equal(envio.confirmed, false);
});

test("lo que no alcanzo a salir queda anotado en este computador", async () => {
    // El SDK encola en memoria: si se cierra el navegador antes de reconectar,
    // ahi se pierde. La anotacion es lo que sobrevive.
    await updateDocSoon({
        path: "workspaces/ws-1",
        data: { establishment: "hospital-claudio-vicuna" },
        uid: "u1",
        waitMs: 20,
        write: sinConexion
    });

    const anotadas = pendingDocWrites();

    assert.equal(anotadas.length, 1);
    assert.equal(anotadas[0].path, "workspaces/ws-1");
    assert.equal(anotadas[0].data.establishment, "hospital-claudio-vicuna");
});

test("si cerraron el navegador sin conexion, sale al volver a entrar", async () => {
    await updateDocSoon({
        path: "workspaces/ws-1",
        data: { establishment: "hospital-claudio-vicuna" },
        uid: "u1",
        waitMs: 20,
        write: sinConexion
    });

    const recargada = await recargarPestana();
    const enviadas = [];

    recargada.flushPendingDocWrites("u1", {
        write: async entry => { enviadas.push(entry); }
    });
    await siguienteVuelta();

    assert.equal(enviadas.length, 1);
    assert.equal(enviadas[0].data.establishment, "hospital-claudio-vicuna");
    assert.deepEqual(recargada.pendingDocWrites(), []);
});

test("no se manda dos veces lo que el SDK todavia tiene en la mano", async () => {
    // Mientras la pestaña sigue abierta, Firestore la manda sola al reconectar:
    // reintentarla aqui seria escribir lo mismo dos veces.
    await updateDocSoon({
        path: "workspaces/ws-1",
        data: { establishment: "hospital-claudio-vicuna" },
        uid: "u1",
        waitMs: 20,
        write: sinConexion
    });

    const enviadas = [];

    flushPendingDocWrites("u1", {
        write: async entry => { enviadas.push(entry); }
    });
    await siguienteVuelta();

    assert.equal(enviadas.length, 0);
    assert.equal(pendingDocWrites().length, 1, "sigue esperando salir");
});

test("confirmada por el servidor, no queda nada anotado", async () => {
    const envio = await updateDocSoon({
        path: "workspaces/ws-1",
        data: { establishment: "hospital-claudio-vicuna" },
        uid: "u1",
        waitMs: 50,
        write: async () => {}
    });

    assert.equal(envio.confirmed, true);
    assert.deepEqual(pendingDocWrites(), []);
});

test("si el servidor la rechaza mientras miran la pantalla, se avisa", async () => {
    // Un rechazo (reglas, documento que ya no existe) NO es falta de conexion:
    // ahi si hay que cortar y decirlo, no cerrar como si se hubiera guardado.
    await assert.rejects(
        () => updateDocSoon({
            path: "workspaces/ws-1",
            data: { establishment: "hospital-claudio-vicuna" },
            uid: "u1",
            waitMs: 50,
            write: async () => { throw new Error("Missing permissions"); }
        }),
        /Missing permissions/
    );

    // Y no se reintenta: daria siempre lo mismo.
    assert.deepEqual(pendingDocWrites(), []);
});

test("un rechazo posterior llega por `pending`, con el modal ya cerrado", async () => {
    let rechazar = null;
    const envio = await updateDocSoon({
        path: "workspaces/ws-1",
        data: { establishment: "hospital-claudio-vicuna" },
        uid: "u1",
        waitMs: 20,
        write: () => new Promise((resolve, reject) => { rechazar = reject; })
    });

    assert.equal(envio.confirmed, false);

    rechazar(new Error("Missing permissions"));

    const error = await envio.pending;

    // Resuelve con el error en vez de rechazar: nadie esta obligado a esperarla
    // y un rechazo suelto seria un "unhandled rejection".
    assert.equal(error?.message, "Missing permissions");
});

test("la ultima gana: un reintento viejo no puede pisar un valor nuevo", async () => {
    // Guarda sin conexion, se arrepiente y guarda otra cosa. Si se reintentaran
    // las dos, el orden decidiria y podria quedar la primera.
    for (const establishment of ["otro-hospital", "hospital-claudio-vicuna"]) {
        await updateDocSoon({
            path: "workspaces/ws-1",
            data: { establishment },
            uid: "u1",
            waitMs: 20,
            write: sinConexion
        });
    }

    const recargada = await recargarPestana();
    const enviadas = [];

    recargada.flushPendingDocWrites("u1", {
        write: async entry => { enviadas.push(entry.data.establishment); }
    });
    await siguienteVuelta();

    assert.deepEqual(enviadas, ["hospital-claudio-vicuna"]);
});

test("no manda lo que dejo otra persona en este computador", async () => {
    await updateDocSoon({
        path: "workspaces/ws-1",
        data: { establishment: "hospital-claudio-vicuna" },
        uid: "otro-supervisor",
        waitMs: 20,
        write: sinConexion
    });

    const enviadas = [];

    flushPendingDocWrites("u1", {
        write: async entry => { enviadas.push(entry); }
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(enviadas.length, 0);
    assert.equal(pendingDocWrites().length, 1, "sigue siendo de su dueño");
});

test("una escritura de hace semanas se descarta en vez de revivir", async () => {
    await updateDocSoon({
        path: "workspaces/ws-1",
        data: { establishment: "hospital-claudio-vicuna" },
        uid: "u1",
        waitMs: 20,
        write: sinConexion
    });

    const cola = JSON.parse(localStorage.getItem(PENDING_DOC_WRITES_KEY));

    cola["workspaces/ws-1"].savedAtMs = Date.now() - MAX_PENDING_AGE_MS - 1;
    localStorage.setItem(PENDING_DOC_WRITES_KEY, JSON.stringify(cola));

    const enviadas = [];

    flushPendingDocWrites("u1", {
        write: async entry => { enviadas.push(entry); }
    });

    assert.equal(enviadas.length, 0);
    assert.deepEqual(pendingDocWrites(), []);
});

test("la cola es de este computador y no viaja en el estado de la unidad", () => {
    // Si viajara, otro supervisor reintentaria escrituras que no son suyas.
    assert.equal(isInternalKey(PENDING_DOC_WRITES_KEY), true);
});

test("el establecimiento se escribe en el documento de la unidad", async () => {
    const envio = await setWorkspaceEstablishment(
        "ws-1",
        "hospital-claudio-vicuna",
        { uid: "u1", waitMs: 20, write: sinConexion }
    );

    assert.equal(envio.confirmed, false);

    const anotada = pendingDocWrites()[0];

    assert.equal(anotada.path, "workspaces/ws-1");
    assert.equal(anotada.data.establishment, "hospital-claudio-vicuna");
    assert.deepEqual(anotada.timestampFields, ["updatedAt"]);
});

test("un establecimiento que no esta en la lista no llega al servidor", async () => {
    await setWorkspaceEstablishment(
        "ws-1",
        "HCV escrito a mano",
        { uid: "u1", waitMs: 20, write: sinConexion }
    );

    assert.equal(pendingDocWrites()[0].data.establishment, "");
});

test("los permisos se escriben en el documento del supervisor", async () => {
    const envio = await saveWorkspaceMemberPermissions(
        "ws-1",
        "uid-supervisor",
        { turnos: { view: true, edit: true } },
        { uid: "u1", waitMs: 20, write: sinConexion }
    );

    assert.equal(envio.confirmed, false);

    const anotada = pendingDocWrites()[0];

    assert.equal(anotada.path, "workspaces/ws-1/members/uid-supervisor");
    assert.deepEqual(anotada.data.permissions.turnos, { view: true, edit: true });
    assert.deepEqual(anotada.timestampFields, ["permissionsUpdatedAt"]);
});

// --- Lo que se ve mientras la escritura espera ---
//
// Al volver a entrar, la unidad se relee del servidor, que todavia tiene el
// establecimiento de antes. Mostrarlo seria deshacer en pantalla algo que la
// persona ya guardo.

const shell = await readFile(
    new URL("../js/firebaseShell.js", import.meta.url),
    "utf8"
);

function montarPendiente() {
    const inicio = shell.indexOf("function pendingEstablishment(");

    assert.notEqual(inicio, -1, "no encontre pendingEstablishment");

    const fin = shell.indexOf("\n}", inicio) + 2;
    const fabrica = new Function(
        "pendingDocWrites",
        `${shell.slice(inicio, fin)}
         return pendingEstablishment;`
    );

    return fabrica(pendingDocWrites);
}

test("mientras espera salir, la pantalla muestra lo que la persona guardo", async () => {
    await updateDocSoon({
        path: "workspaces/ws-1",
        data: { establishment: "hospital-claudio-vicuna" },
        uid: "u1",
        waitMs: 20,
        write: sinConexion
    });

    assert.equal(montarPendiente()("ws-1"), "hospital-claudio-vicuna");
    assert.equal(montarPendiente()("ws-2"), undefined, "otra unidad no se toca");
});

test("'Sin indicar' guardado sin conexion tampoco se deshace en pantalla", async () => {
    // Vacio es un valor valido, y confundirlo con "no hay nada esperando"
    // devolveria en pantalla el establecimiento que acaban de quitar.
    await updateDocSoon({
        path: "workspaces/ws-1",
        data: { establishment: "" },
        uid: "u1",
        waitMs: 20,
        write: sinConexion
    });

    assert.equal(montarPendiente()("ws-1"), "");
});

// --- El aviso cuando el rechazo llega tarde ---
//
// El modal ya se cerro, pero callar dejaria a la persona creyendo que guardo.

import { readFile } from "node:fs/promises";

const settings = await readFile(
    new URL("../js/systemSettings.js", import.meta.url),
    "utf8"
);

function extraer(nombre) {
    const inicio = settings.indexOf(`function ${nombre}(`);

    assert.notEqual(inicio, -1, `no encontre ${nombre}`);

    let profundidad = 0;

    for (let i = settings.indexOf("{", inicio); i < settings.length; i += 1) {
        if (settings[i] === "{") profundidad += 1;
        else if (settings[i] === "}") {
            profundidad -= 1;
            if (!profundidad) return settings.slice(inicio, i + 1);
        }
    }

    throw new Error(`sin cierre: ${nombre}`);
}

function montarAviso() {
    const avisos = [];
    const fabrica = new Function(
        "showAlert",
        "console",
        `${extraer("avisarSiElServidorRechaza")}
         return avisarSiElServidorRechaza;`
    );

    return {
        avisos,
        avisar: fabrica(
            mensaje => { avisos.push(mensaje); },
            { error() {} }
        )
    };
}

test("lo que salio bien no molesta con avisos", async () => {
    const { avisar, avisos } = montarAviso();

    avisar({ confirmed: true }, "El establecimiento");
    avisar(
        { confirmed: false, pending: Promise.resolve(null) },
        "El establecimiento"
    );
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(avisos, []);
});

test("si el servidor la rechaza despues, se dice que quedo sin guardar", async () => {
    const { avisar, avisos } = montarAviso();

    avisar(
        {
            confirmed: false,
            pending: Promise.resolve(new Error("Missing permissions"))
        },
        "El establecimiento"
    );
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /El establecimiento/);
    assert.match(avisos[0], /Missing permissions/);
});
