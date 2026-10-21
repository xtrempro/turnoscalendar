// Alguien ingresado en otra unidad del establecimiento tiene que notarse en la
// unidad que ya lo tenia: en la campanita, y despues en su ficha.
//
// El aviso ya existia (functions/workerUnitChangeNotice.js), pero solo sonaba
// una vez y mandaba a Solicitudes. Quien abria la ficha del trabajador dos dias
// despues no veia nada: su perfil seguia activo, apareciendo en la
// planificacion, sin una sola senal de que esa persona ya estaba en otro lado.
//
// Y el aviso se perdia entero cuando algo fallaba despues de guardar el perfil:
// la llamada vivia al final del guardado, detras de la rotativa. El 2026-10-15
// un Web Worker que no cargo dejo a la otra unidad sin enterarse.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const leer = ruta => readFile(new URL(ruta, import.meta.url), "utf8");

const main = await leer("../js/main.js");
const campanita = await leer("../js/notificationsBell.js");
const estilos = await leer("../styles.css");
const html = await leer("../index.html");

function extraer(fuente, nombre) {
    const inicio = fuente.indexOf(`function ${nombre}(`);

    assert.notEqual(inicio, -1, `no encontre ${nombre}`);

    const asincrona = fuente.lastIndexOf("async function", inicio);
    const desde = asincrona === inicio - 6 ? asincrona : inicio;
    let parentesis = 0;
    let cuerpo = -1;

    for (let i = fuente.indexOf("(", inicio); i < fuente.length; i += 1) {
        if (fuente[i] === "(") parentesis += 1;
        else if (fuente[i] === ")") {
            parentesis -= 1;
            if (!parentesis) {
                cuerpo = fuente.indexOf("{", i);
                break;
            }
        }
    }

    assert.notEqual(cuerpo, -1, `no encontre el cuerpo de ${nombre}`);

    let profundidad = 0;

    for (let i = cuerpo; i < fuente.length; i += 1) {
        if (fuente[i] === "{") profundidad += 1;
        else if (fuente[i] === "}") {
            profundidad -= 1;
            if (!profundidad) return fuente.slice(desde, i + 1);
        }
    }

    throw new Error(`sin cierre: ${nombre}`);
}

// --- Un DOM de juguete, lo justo para pintar ---

function nodo(tag = "div") {
    return {
        tag,
        className: "",
        type: "",
        hidden: false,
        textContent: "",
        hijos: [],
        clases: new Set(),
        listeners: new Map(),
        classList: {
            add(clase) { this.duenio.clases.add(clase); },
            contains(clase) { return this.duenio.clases.has(clase); }
        },
        addEventListener(tipo, fn) { this.listeners.set(tipo, fn); },
        appendChild(hijo) { this.hijos.push(hijo); return hijo; },
        append(...nuevos) { this.hijos.push(...nuevos); },
        replaceChildren(...nuevos) { this.hijos = nuevos; },
        setAttribute() {},
        querySelector() { return null; },
        get texto() {
            return [this.textContent, ...this.hijos.map(hijo => hijo.texto)]
                .filter(Boolean)
                .join(" ");
        }
    };
}

function crearNodo(tag) {
    const creado = nodo(tag);

    creado.classList.duenio = creado;

    return creado;
}

const documentoFalso = { createElement: crearNodo };

const AVISO = {
    id: "wuc-1",
    workspaceId: "ws-samu",
    profileName: "Helena Flores Arias",
    profileRut: "310050075",
    uid: "",
    status: "pending"
};

// --- La campanita ---

function montarPanel({ avisos }) {
    const tocados = [];
    const lista = crearNodo("div");
    const fabrica = new Function(
        "bellPanelList",
        "bellPanel",
        "getBellNotices",
        "pendingWorkerRequests",
        "document",
        "noticeTimeLabel",
        "closeBellPanel",
        "onNoticeAction",
        `${extraer(campanita, "renderBellPanel")}
         return renderBellPanel;`
    );

    fabrica(
        lista,
        null,
        () => avisos,
        () => [],
        documentoFalso,
        () => "",
        () => { tocados.push("cerrado"); },
        accion => { tocados.push(accion); }
    )();

    return { lista, tocados };
}

test("un aviso que lleva a alguna parte se pinta como boton", () => {
    const { lista } = montarPanel({
        avisos: [{
            id: "cambio-unidad:wuc-1",
            title: "Helena Flores Arias está activa en otra unidad",
            detail: "Abre su perfil.",
            action: { kind: "profile", profile: "Helena Flores Arias" }
        }]
    });

    assert.equal(lista.hijos.length, 1);
    assert.equal(lista.hijos[0].tag, "button");
    assert.equal(lista.hijos[0].type, "button");
    assert.ok(lista.hijos[0].clases.has("bell-notice--link"));
});

test("tocarlo cierra el recuadro y entrega su destino", () => {
    const accion = { kind: "profile", profile: "Helena Flores Arias", rut: "310050075" };
    const { lista, tocados } = montarPanel({
        avisos: [{ id: "cambio-unidad:wuc-1", title: "Aviso", action: accion }]
    });

    lista.hijos[0].listeners.get("click")();

    assert.deepEqual(tocados, ["cerrado", accion]);
});

test("un aviso sin destino sigue siendo un parrafo que no se puede tocar", () => {
    const { lista } = montarPanel({
        avisos: [{ id: "otro", title: "Aviso de siempre" }]
    });

    assert.equal(lista.hijos[0].tag, "article");
    assert.equal(lista.hijos[0].listeners.size, 0);
});

test("el destino se guarda con el aviso", () => {
    // Los avisos viven en el navegador: el destino tiene que sobrevivir a
    // recargar la pagina, y por eso es un dato y no una funcion.
    const guardados = [];
    const fabrica = new Function(
        "getBellNotices",
        "setJSON",
        "NOTICES_KEY",
        "MAX_NOTICES",
        "noticeActionKey",
        `${extraer(campanita, "pushNotice")}
         return pushNotice;`
    );
    const accion = { kind: "profile", profile: "Helena Flores Arias" };
    let actuales = [];
    const push = fabrica(
        () => actuales,
        (clave, valor) => { actuales = valor; guardados.push(valor); },
        "bellNotices",
        20,
        valor => (valor ? JSON.stringify(valor) : "")
    );

    assert.equal(push({ id: "a", title: "Hola", action: accion }), true);
    assert.deepEqual(guardados[0][0].action, accion);

    // El mismo aviso otra vez no se reescribe...
    assert.equal(push({ id: "a", title: "Hola", action: accion }), false);

    // ...pero si cambia adonde lleva, si.
    assert.equal(
        push({ id: "a", title: "Hola", action: { kind: "profile", profile: "Otra" } }),
        true
    );
    assert.equal(guardados.at(-1)[0].action.profile, "Otra");
});

// --- El aviso en la ficha ---

function montarFicha({ avisos, perfil, modo = "view" }) {
    const host = crearNodo("section");
    const fabrica = new Function(
        "document",
        "profileDraft",
        "PROFILE_MODE",
        "getPerfilActual",
        "movedWorkerNotices",
        "normalizeRut",
        `${extraer(main, "movedWorkerNoticeFor")}
         ${extraer(main, "movedWorkerNoticeText")}
         ${extraer(main, "renderProfileOtherUnitAlert")}
         return renderProfileOtherUnitAlert;`
    );

    fabrica(
        {
            ...documentoFalso,
            getElementById: id => (id === "profileOtherUnitAlert" ? host : null)
        },
        { mode: modo },
        { CREATE: "create", EDIT: "edit", VIEW: "view" },
        () => perfil,
        avisos,
        valor => String(valor || "").replace(/[^0-9kK]/g, "").toUpperCase()
    )();

    return host;
}

const HELENA = { name: "Helena Flores Arias", rut: "31.005.007-5", active: true };

test("la ficha avisa que esta activo en otra unidad", () => {
    const host = montarFicha({ avisos: [AVISO], perfil: HELENA });

    assert.equal(host.hidden, false);
    assert.match(host.texto, /activo en otra unidad del establecimiento/i);
    assert.match(host.texto, /Lo ingresaron en otra unidad/);
    assert.match(host.texto, /desactiva su perfil/);
});

test("si se enlazo alla, lo dice sin inventar que tiene la app", () => {
    const host = montarFicha({
        avisos: [{ ...AVISO, uid: "uid-1" }],
        perfil: HELENA
    });

    assert.match(host.texto, /Enlazó su aplicación en otra unidad/);
    assert.doesNotMatch(host.texto, /Lo ingresaron/);
});

test("otro trabajador no hereda el aviso", () => {
    const host = montarFicha({
        avisos: [AVISO],
        perfil: { name: "Bruno Rojas", rut: "31.000.002-7" }
    });

    assert.equal(host.hidden, true);
    assert.deepEqual(host.hijos, []);
});

test("un aviso ya resuelto no se sigue mostrando", () => {
    const host = montarFicha({
        avisos: [{ ...AVISO, status: "done" }],
        perfil: HELENA
    });

    assert.equal(host.hidden, true);
});

test("el RUT manda sobre el nombre: un tocayo no dispara el aviso", () => {
    const host = montarFicha({
        avisos: [AVISO],
        perfil: { name: "Helena Flores Arias", rut: "9.999.999-9" }
    });

    assert.equal(host.hidden, true);
});

test("mientras se crea un perfil no sale ningun aviso", () => {
    const host = montarFicha({
        avisos: [AVISO],
        perfil: HELENA,
        modo: "create"
    });

    assert.equal(host.hidden, true);
});

// --- De la campanita a la ficha ---

function montarApertura({ perfiles }) {
    const abiertos = [];
    const alertas = [];
    const menus = [];
    const fabrica = new Function(
        "getProfiles",
        "normalizeRut",
        "showAlert",
        "selectProfileByName",
        "setActiveShortcut",
        `${extraer(main, "openBellNoticeTarget")}
         return openBellNoticeTarget;`
    );

    return {
        abiertos,
        alertas,
        menus,
        abrir: fabrica(
            () => perfiles,
            valor => String(valor || "").replace(/[^0-9kK]/g, "").toUpperCase(),
            async mensaje => { alertas.push(mensaje); },
            async (nombre, opciones) => { abiertos.push({ nombre, opciones }); return true; },
            async destino => { menus.push(destino); return true; }
        )
    };
}

test("tocar el aviso abre la ficha de esa persona", () => {
    const { abrir, abiertos } = montarApertura({ perfiles: [HELENA] });

    return abrir({
        kind: "profile",
        profile: "Helena Flores Arias",
        rut: "310050075"
    }).then(() => {
        assert.deepEqual(abiertos, [{
            nombre: "Helena Flores Arias",
            opciones: { openProfile: true, scrollToTop: true }
        }]);
    });
});

test("si la renombraron, igual la encuentra por RUT", async () => {
    const { abrir, abiertos } = montarApertura({
        perfiles: [{ name: "Helena Flores A.", rut: "31.005.007-5" }]
    });

    await abrir({ kind: "profile", profile: "Helena Flores Arias", rut: "310050075" });

    assert.equal(abiertos[0].nombre, "Helena Flores A.");
});

test("si ya no esta en la unidad, lo dice en vez de abrir cualquier cosa", async () => {
    const { abrir, abiertos, alertas } = montarApertura({ perfiles: [] });

    await abrir({ kind: "profile", profile: "Helena Flores Arias", rut: "310050075" });

    assert.deepEqual(abiertos, []);
    assert.match(alertas[0], /ya no tiene perfil en esta unidad/);
});

test("un destino que no se entiende no hace nada", async () => {
    const { abrir, abiertos, alertas, menus } = montarApertura({
        perfiles: [HELENA]
    });

    await abrir({ kind: "otra-cosa" });

    assert.deepEqual(abiertos, []);
    assert.deepEqual(alertas, []);
    assert.deepEqual(menus, []);
});

test("el aviso que manda a Solicitudes lleva hasta ahi", async () => {
    const { abrir, menus, abiertos } = montarApertura({ perfiles: [HELENA] });

    await abrir({ kind: "requests" });

    assert.deepEqual(menus, ["workerRequestsPanel"]);
    assert.deepEqual(abiertos, []);
});

test("los avisos de traspaso dicen adonde llevan", () => {
    // Un aviso que dice "acéptalo en Solicitudes" y no lleva ahi obliga a
    // recordar el nombre y buscarlo a mano.
    const pedidos = extraer(main, "noticeHandoverRequests");
    const rechazos = extraer(main, "noticeRejectedHandovers");
    const aMano = extraer(main, "noticeHandoverNeedsHand");
    const aplicado = extraer(main, "noticeHandoverApplied");

    assert.match(pedidos, /action: \{ kind: "requests" \}/);
    assert.match(rechazos, /action: \{ kind: "requests" \}/);
    assert.match(aMano, /action: \{ kind: "requests" \}/);
    // Ese ya no tiene nada que responder: el perfil existe y se va a su ficha.
    assert.match(aplicado, /action: \{ kind: "profile", profile: String\(nombre \|\| ""\) \}/);
});

// --- El aviso a la otra unidad no depende de lo que venga despues ---

test("se avisa apenas el perfil queda escrito, antes de la rotativa", () => {
    const guardar = extraer(main, "saveProfileNow");
    const avisa = guardar.indexOf("reportWorkerEnteredElsewhere(nextProfilePayload.rut)");
    const rotativa = guardar.indexOf("if (shouldApplyRotation) {");

    assert.notEqual(avisa, -1);
    assert.notEqual(rotativa, -1);
    // Al reves, cualquier falla de la rotativa se llevaba el aviso por delante.
    assert.ok(
        avisa < rotativa,
        "el aviso a la otra unidad tiene que salir antes de aplicar la rotativa"
    );
});

test("el aviso vive mientras dura la unidad, y se vacia al cambiarla", () => {
    assert.match(main, /setMovedWorkerNotices\(\[\]\);\s*\n\s*void watchWorkerUnitChangeNotices\(/);
    assert.match(main, /setMovedWorkerNotices\(pendientes\);\s*\n\s*noticeMovedWorkers\(pendientes\);/);
});

test("la campanita manda a la ficha y no a Solicitudes", () => {
    const avisos = [];
    const fabrica = new Function(
        "addBellNotice",
        `${extraer(main, "movedWorkerNoticeText")}
         ${extraer(main, "noticeMovedWorkers")}
         return noticeMovedWorkers;`
    );

    fabrica(aviso => { avisos.push(aviso); })([AVISO]);

    assert.equal(avisos.length, 1);
    assert.equal(avisos[0].id, "cambio-unidad:wuc-1");
    assert.match(avisos[0].title, /Helena Flores Arias está activo en otra unidad/);
    assert.match(avisos[0].detail, /Abre su perfil/);
    assert.doesNotMatch(avisos[0].detail, /Revísalo en Solicitudes/);
    // El destino viaja en `action`: es lo que la campanita sabe leer.
    assert.deepEqual(avisos[0].action, {
        kind: "profile",
        profile: "Helena Flores Arias",
        rut: "310050075"
    });
});

test("la ficha tiene donde pintar el aviso, y el aviso tiene estilo", () => {
    assert.match(html, /id="profileOtherUnitAlert" class="pf-alert" hidden/);
    assert.match(estilos, /\.pf-alert \{/);
    assert.match(estilos, /\.bell-notice--link \{/);
});
