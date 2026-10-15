// La campanita del supervisor: avisos, no solo solicitudes.
//
// Un aviso es algo que YA paso y que nadie tiene que resolver -un traspaso
// aceptado, un turno que alguien acepto cubrir-. Antes la campanita llevaba
// derecho al menu Solicitudes, que para eso no sirve: ahi no hay nada que
// hacer y el aviso desaparecia sin haberse leido.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const leer = (ruta) => readFile(new URL(ruta, import.meta.url), "utf8");

const campanita = await leer("../js/notificationsBell.js");
const estilos = await leer("../styles.css");

test("la campanita abre un recuadro, no el menu de solicitudes", () => {
    const clic = campanita.slice(
        campanita.indexOf('bellButton.addEventListener("click"'),
        campanita.indexOf('bellButton.addEventListener("click"') + 700
    );

    assert.match(clic, /openBellPanel\(\)/);
    assert.match(clic, /closeBellPanel\(\)/);
    // Y ya no se lleva los avisos por delante al abrirla.
    assert.doesNotMatch(clic, /clearBellNotices\(\)/);
});

test("los avisos se marcan leidos a mano", () => {
    assert.match(campanita, /textContent = "Marcar leídas"/);
    assert.match(campanita, /clearBellNotices\(\);\s*\n\s*renderBellPanel\(\);/);
});

test("el menu de solicitudes sigue a un clic de distancia", () => {
    assert.match(campanita, /bell-panel__requests/);
    assert.match(campanita, /onOpenRequests\(\);/);
});

test("el recuadro se arma con nodos, no pegando HTML", () => {
    // Los avisos llevan nombres de personas y de unidades, que vienen del
    // estado compartido: como marcado no son de fiar.
    const render = campanita.slice(
        campanita.indexOf("function renderBellPanel("),
        campanita.indexOf("function bellPanelIsOpen(")
    );

    assert.match(render, /textContent =/);
    assert.doesNotMatch(render, /innerHTML/);
});

test("un turno aceptado por la app se vuelve aviso", () => {
    const avisar = campanita.slice(
        campanita.indexOf("function noticeAcceptedCovers("),
        campanita.indexOf("function noticeTimeLabel(")
    );

    assert.match(avisar, /aceptó cubrir un turno/);
    assert.match(avisar, /knownAcceptedCoverIds\.has\(id\)/);
});

test("lo que ya estaba aceptado al entrar no genera avisos viejos", () => {
    // Sin esto, abrir la unidad soltaria un aviso por cada turno cubierto
    // hace semanas.
    const sembrar = campanita.slice(
        campanita.indexOf("function loadSeenCoverIds("),
        campanita.indexOf("function noticeAcceptedCovers(")
    );

    assert.match(sembrar, /if \(!Array\.isArray\(guardado\)\)/);
    assert.match(sembrar, /setJSON\(SEEN_COVERS_KEY, actuales\)/);
});

test("una aceptacion ocurrida con el navegador cerrado igual avisa", () => {
    // Lo visto se guarda, no se recalcula al arrancar: si se recalculara, lo
    // que paso mientras nadie miraba se daria por visto -justo lo que mas
    // importa saber-.
    assert.match(campanita, /const SEEN_COVERS_KEY = "bellSeenCovers";/);
    assert.match(campanita, /knownAcceptedCoverIds = loadSeenCoverIds\(\);/);
    assert.match(campanita, /setJSON\(SEEN_COVERS_KEY, vistas\);/);
});

test("la campanita escucha tambien el sync de coberturas", () => {
    // Las coberturas tienen su propio evento: escuchando solo el de
    // solicitudes, que alguien acepte cubrir un turno no la despertaba.
    assert.match(
        campanita,
        /addEventListener\(\s*"proturnos:replacementRequestsChanged",\s*scheduleRefresh\s*\)/
    );
});

test("un aviso creado dentro del refresco no se llama a si mismo", () => {
    // pushNotice guarda y nada mas; el que refresca es addBellNotice. Si el
    // de adentro refrescara, volveria a entrar al refresco sin parar.
    const empujar = campanita.slice(
        campanita.indexOf("function pushNotice("),
        campanita.indexOf("export function addBellNotice(")
    );

    assert.doesNotMatch(empujar, /scheduleRefresh\(\)/);
    assert.match(campanita, /if \(pushNotice\(notice\)\) scheduleRefresh\(\);/);
});

test("el recuadro sigue el tema claro y el oscuro", () => {
    // Con colores fijos, en tema oscuro quedaria un recuadro claro con texto
    // oscuro encima del fondo oscuro. Le paso lo mismo al aviso del RUT, que
    // hoy ya no es una tarjeta sino un cuadro de dialogo: esos toman el tema
    // de las variables y por eso no necesitan una regla aparte.
    assert.match(estilos, /\.bell-panel \{[\s\S]{0,400}var\(--panel/);
    assert.match(estilos, /\.app-dialog \{[\s\S]{0,600}var\(--panel\)/);
});

// --- Un pedido de traspaso tambien se canta ---
//
// En Solicitudes ya salia, pero eso no sirve para enterarse: el pedido llega
// desde otra unidad y aqui no pasa nada hasta que alguien entra a mirar. Al
// otro lado hay alguien esperando para terminar de ingresar a una persona.

const principal = await leer("../js/main.js");
const traspasos = await leer("../js/workerHandovers.js");
const solicitudes = await leer("../js/workerRequests.js");

function extraer(fuente, nombre) {
    const inicio = fuente.indexOf(`function ${nombre}(`);

    assert.notEqual(inicio, -1, `no encontre ${nombre}`);

    let parentesis = 0;
    let cuerpo = -1;

    for (let i = fuente.indexOf("(", inicio); i < fuente.length; i += 1) {
        if (fuente[i] === "(") parentesis += 1;
        else if (fuente[i] === ")") {
            parentesis -= 1;
            if (!parentesis) { cuerpo = fuente.indexOf("{", i); break; }
        }
    }

    let profundidad = 0;

    for (let i = cuerpo; i < fuente.length; i += 1) {
        if (fuente[i] === "{") profundidad += 1;
        else if (fuente[i] === "}") {
            profundidad -= 1;
            if (!profundidad) return fuente.slice(inicio, i + 1);
        }
    }

    throw new Error(`sin cierre: ${nombre}`);
}

test("hay un oyente de los pedidos que esta unidad debe responder", () => {
    // Sin el, la campanita solo se enteraba al abrir Solicitudes, que es justo
    // lo que no pasa cuando nadie sabe que hay algo que mirar.
    const observar = extraer(traspasos, "watchIncomingHandoverRequests");

    assert.match(observar, /where\("sourceWorkspaceId", "==", workspace\.id\)/);
    // Trae todos los de esta unidad y separa en el cliente: los que todavia se
    // pueden responder, y los retirados para quitar el aviso que ya no sirve.
    // Reparte en dos: lo que todavia se puede responder y lo que ya no
    // -retirado, resuelto o caducado-.
    assert.match(observar, /emitRequests\(onPending\)/);

    const repartir = extraer(traspasos, "emitRequests");

    assert.match(repartir, /handoverRequestIsUsable\(item, ahora\)/);
    assert.match(repartir, /!handoverRequestIsUsable\(item, ahora\)/);
    // La caducidad no produce evento: se programa una vuelta para cuando venza.
    assert.match(repartir, /expiryTimer = setTimeout\(/);
    // Y "usable" es la MISMA regla del servidor: pendiente y sin caducar.
    const usable = extraer(traspasos, "handoverRequestIsUsable");

    assert.match(usable, /!== "pending"\) return false/);
    assert.match(usable, /return !expira \|\| expira > ahora/);
    // Y se suelta al cambiar de unidad.
    assert.match(traspasos, /export function stopWatchingIncomingHandoverRequests/);
    assert.match(principal, /stopWatchingIncomingHandoverRequests\(\);/);
});

test("cada pedido pendiente deja un aviso en la campanita", () => {
    const avisar = extraer(principal, "noticeHandoverRequests");

    assert.match(avisar, /addBellNotice\(/);
    // Un id por pedido: el aviso no se repite en cada repintado.
    // El pedido trae RUT y no nombre, pero esta unidad si puede nombrarla.
    assert.match(avisar, /normalizeRut\(item\.rut\) === rut/);
    assert.match(avisar, /const avisoId = handoverNoticeId\(pedido\)/);
    assert.match(avisar, /requestingWorkspaceName/);
});

test("el badge de Solicitudes cuenta lo mismo que muestra el panel", () => {
    // El panel listaba pedidos de traspaso, solicitudes de acceso por RUT y
    // avisos de cambio de unidad que el badge no contaba: quedaban sin anunciar.
    const badge = extraer(solicitudes, "refreshWorkerRequestsNavBadge");

    for (const fuente of [
        "getWorkerHandoverPanelRequests",
        "getWorkerJoinRequests",
        "getWorkerUnitChangeNotices"
    ]) {
        assert.ok(badge.includes(fuente), `al badge le falta ${fuente}`);
    }
});

test("quitar un aviso que dejo de ser cierto", () => {
    // Un aviso manda a hacer algo: si eso ya no esta, dejarlo puesto manda a
    // buscar lo que no existe.
    const quitar = extraer(campanita, "removeBellNotice");

    assert.match(quitar, /filter\(item => item\?\.id !== clave\)/);
    // Sin el, no se repinta de mas.
    assert.match(quitar, /if \(quedan\.length === previos\.length\) return false;/);
    assert.match(quitar, /scheduleRefresh\(\)/);
});

// --- Un aviso que cambio tiene que decir lo nuevo (auditoria 2026-10-15) ---

// Los avisos de verdad, sobre un almacenamiento de mentira: comprobar que el
// codigo "menciona" el reemplazo no habria visto si de verdad reescribe.
class MemoriaFalsa {
    constructor() { this.valores = new Map(); }
    get length() { return this.valores.size; }
    clear() { this.valores.clear(); }
    getItem(clave) { return this.valores.has(clave) ? this.valores.get(clave) : null; }
    key(indice) { return [...this.valores.keys()][indice] ?? null; }
    removeItem(clave) { this.valores.delete(clave); }
    setItem(clave, valor) { this.valores.set(clave, String(valor)); }
}

globalThis.localStorage = new MemoriaFalsa();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {}
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};

const bell = await import("../js/notificationsBell.js");

test("el aviso reescrito dice lo nuevo y conserva cuando llego", async () => {
    bell.clearBellNotices();
    bell.addBellNotice({
        id: "pedido-traspaso:whr_a_b_1:111",
        title: "SAMU pide el traspaso de Ana",
        detail: "Comenzaría allá el 06-10-2026."
    });

    const [primero] = bell.getBellNotices();

    bell.addBellNotice({
        id: "pedido-traspaso:whr_a_b_1:111",
        title: "SAMU pide el traspaso de Ana",
        detail: "Comenzaría allá el 20-10-2026."
    });

    const avisos = bell.getBellNotices();

    assert.equal(avisos.length, 1, "no se duplica");
    assert.match(avisos[0].detail, /20-10-2026/);
    assert.equal(avisos[0].createdAt, primero.createdAt, "sigue siendo el mismo");
});

test("un pedido nuevo en el mismo documento es otro aviso", async () => {
    bell.clearBellNotices();
    bell.addBellNotice({
        id: "pedido-traspaso:whr_a_b_1:111",
        title: "SAMU pide el traspaso de Ana",
        detail: "Comenzaría allá el 06-10-2026."
    });
    bell.addBellNotice({
        id: "pedido-traspaso:whr_a_b_1:222",
        title: "SAMU pide el traspaso de Ana",
        detail: "Comenzaría allá el 20-11-2026."
    });

    assert.equal(bell.getBellNotices().length, 2);
});

test("quitar un aviso saca solo ese", async () => {
    bell.clearBellNotices();
    bell.addBellNotice({ id: "uno", title: "Uno" });
    bell.addBellNotice({ id: "dos", title: "Dos" });

    assert.equal(bell.removeBellNotice("uno"), true);
    assert.deepEqual(bell.getBellNotices().map(item => item.id), ["dos"]);
    // Y quitar lo que no esta no hace nada.
    assert.equal(bell.removeBellNotice("uno"), false);
});

test("un aviso con el mismo id se reescribe si cambio lo que dice", () => {
    // El documento del pedido se reusa: con el id a secas, el aviso se quedaba
    // con la fecha del pedido anterior.
    const empujar = extraer(campanita, "pushNotice");

    assert.match(empujar, /const anterior = previos\.find\(item => item\?\.id === clave\)/);
    // Si no cambio nada, no se toca ni se repinta.
    assert.match(
        empujar,
        /anterior\.title === aviso\.title &&\s*\n\s*anterior\.detail === aviso\.detail\s*\n\s*\) \{\s*\n\s*return false;/
    );
    // Y al reescribir conserva cuando llego.
    assert.match(empujar, /createdAt: item\.createdAt \|\| aviso\.createdAt/);
});

test("un pedido nuevo en el mismo documento suena como nuevo", () => {
    // El id del aviso lleva cuando se pidio: sin eso, el segundo pedido entre
    // las mismas unidades se tomaba por repetido y no sonaba.
    const idDelAviso = extraer(principal, "handoverNoticeId");

    assert.match(idDelAviso, /pedido\?\.createdAt/);
    assert.match(idDelAviso, /`\$\{prefijo\}:\$\{pedido\?\.id\}:\$\{marca\}`/);
    // El mismo esquema para el aviso de rechazo.
    assert.match(
        principal,
        /handoverNoticeId\(pedido, "traspaso-rechazado"\)/
    );

    // Lo usan los dos lados: el que avisa y el que quita el aviso.
    const avisar = extraer(principal, "noticeHandoverRequests");
    const olvidar = extraer(principal, "forgetHandoverRequestNotices");

    assert.match(avisar, /const avisoId = handoverNoticeId\(pedido\)/);
    // Por prefijo, no por generacion: ver la prueba de mas abajo.
    assert.match(olvidar, /removeBellNoticesByPrefix\(`pedido-traspaso:/);
});

test("un pedido nuevo deja UN aviso, no dos del mismo documento", async () => {
    // El documento se reusa entre las mismas unidades. Si la sesion no vio la
    // resolucion del anterior, su aviso seguia guardado al lado del nuevo: dos
    // cuadros diciendo "acéptalo o recházalo" con fechas distintas.
    bell.clearBellNotices();
    bell.addBellNotice({
        id: "pedido-traspaso:whr_a_b_1:111",
        title: "SAMU pide el traspaso de Ana",
        detail: "Comenzaría allá el 06-10-2026."
    });

    assert.equal(
        bell.removeBellNoticesByPrefix(
            "pedido-traspaso:whr_a_b_1:",
            "pedido-traspaso:whr_a_b_1:222"
        ),
        1
    );

    bell.addBellNotice({
        id: "pedido-traspaso:whr_a_b_1:222",
        title: "SAMU pide el traspaso de Ana",
        detail: "Comenzaría allá el 20-11-2026."
    });

    const avisos = bell.getBellNotices();

    assert.equal(avisos.length, 1);
    assert.match(avisos[0].detail, /20-11-2026/);
});

test("quitar por prefijo respeta el que se quiere conservar y lo ajeno", () => {
    bell.clearBellNotices();
    bell.addBellNotice({ id: "pedido-traspaso:doc-1:111", title: "Viejo" });
    bell.addBellNotice({ id: "pedido-traspaso:doc-1:222", title: "Nuevo" });
    bell.addBellNotice({ id: "pedido-traspaso:doc-2:111", title: "Otro doc" });
    bell.addBellNotice({ id: "traspaso-rechazado:doc-1:111", title: "Rechazo" });

    assert.equal(
        bell.removeBellNoticesByPrefix(
            "pedido-traspaso:doc-1:",
            "pedido-traspaso:doc-1:222"
        ),
        1
    );
    assert.deepEqual(
        bell.getBellNotices().map(item => item.id).sort(),
        [
            "pedido-traspaso:doc-1:222",
            "pedido-traspaso:doc-2:111",
            "traspaso-rechazado:doc-1:111"
        ]
    );
    // Sin nada que sacar, no escribe ni repinta.
    assert.equal(bell.removeBellNoticesByPrefix("pedido-traspaso:doc-9:"), 0);
});

test("el aviso de entrada y el de rechazo sueltan sus generaciones viejas", () => {
    const avisar = extraer(principal, "noticeHandoverRequests");
    const rechazo = extraer(principal, "noticeRejectedHandovers");

    assert.match(
        avisar,
        /removeBellNoticesByPrefix\(`pedido-traspaso:\$\{pedido\.id\}:`, avisoId\)/
    );
    assert.match(
        rechazo,
        /removeBellNoticesByPrefix\(`traspaso-rechazado:\$\{pedido\.id\}:`, avisoId\)/
    );
});

test("cuando el documento deja de admitir respuesta, se van TODOS sus avisos", () => {
    // La sesion estuvo desconectada mientras se pidio de nuevo y se retiro:
    // vuelve viendo solo la ultima generacion. Quitando el id exacto, el aviso
    // de la anterior se quedaba invitando a responder algo que ya no esta.
    bell.clearBellNotices();
    bell.addBellNotice({
        id: "pedido-traspaso:whr_a_b_1:111",
        title: "SAMU pide el traspaso de Ana",
        detail: "Comenzaría allá el 06-10-2026."
    });
    bell.addBellNotice({
        id: "pedido-traspaso:whr_a_b_1:222",
        title: "SAMU pide el traspaso de Ana",
        detail: "Comenzaría allá el 20-11-2026."
    });
    bell.addBellNotice({ id: "pedido-traspaso:otro-doc:111", title: "Otro" });

    // Sin conservar ninguna: el documento ya no admite respuesta.
    assert.equal(
        bell.removeBellNoticesByPrefix("pedido-traspaso:whr_a_b_1:"),
        2
    );
    assert.deepEqual(
        bell.getBellNotices().map(item => item.id),
        ["pedido-traspaso:otro-doc:111"]
    );
});

test("retirar un pedido suelta el documento entero, no una generacion", () => {
    const olvidar = extraer(principal, "forgetHandoverRequestNotices");

    assert.match(
        olvidar,
        /removeBellNoticesByPrefix\(`pedido-traspaso:\$\{pedido\.id\}:`\)/
    );
    // Y sin conservar ninguna: ya no hay nada que responder ahi.
    assert.doesNotMatch(olvidar, /avisoId/);
});
