// Establecimientos: de esto depende que dos unidades se reconozcan para
// pedirse el traslado de un trabajador aunque no esten enlazadas.

import test from "node:test";
import assert from "node:assert/strict";

import {
    ESTABLISHMENTS,
    establishmentName,
    establishmentOptionsHTML,
    isKnownEstablishment,
    normalizeEstablishment,
    sameEstablishment
} from "../js/establishments.js";

test("se guarda el id y no el nombre", () => {
    // Renombrar un hospital no deberia romper las coincidencias ya guardadas.
    assert.equal(normalizeEstablishment("hospital-claudio-vicuna"), "hospital-claudio-vicuna");
    assert.equal(establishmentName("hospital-claudio-vicuna"), "Hospital Claudio Vicuña");
});

test("lo que no esta en la lista se guarda vacio", () => {
    // La deteccion compara establecimientos: aceptar texto libre haria convivir
    // "HCV" con "Hospital Claudio Vicuña" sin que coincidan, que es justo la
    // normalizacion que esto viene a resolver.
    assert.equal(normalizeEstablishment("HCV"), "");
    assert.equal(normalizeEstablishment("Hospital Claudio Vicuña"), "");
    assert.equal(normalizeEstablishment(""), "");
    assert.equal(normalizeEstablishment(null), "");
    assert.equal(isKnownEstablishment("hospital-cualquiera"), false);
});

test("dos unidades sin indicar NO comparten establecimiento", () => {
    // Es el caso que mas importa: sin esto, cualquier par de unidades sin
    // establecimiento se ofreceria traslados entre desconocidas.
    assert.equal(sameEstablishment("", ""), false);
    assert.equal(sameEstablishment(null, undefined), false);
    assert.equal(sameEstablishment("HCV", "HCV"), false);
});

test("dos unidades del mismo establecimiento si se reconocen", () => {
    assert.equal(
        sameEstablishment("hospital-claudio-vicuna", "hospital-claudio-vicuna"),
        true
    );
    assert.equal(
        sameEstablishment("hospital-claudio-vicuna", "otro-hospital"),
        false
    );
});

test("la lista siempre ofrece salir sin elegir", () => {
    // Quien no encuentre el suyo tiene que poder crear su unidad igual.
    const html = establishmentOptionsHTML();

    assert.match(html, /<option value=""\s+selected>Sin indicar<\/option>/);

    for (const item of ESTABLISHMENTS) {
        assert.ok(html.includes(`value="${item.id}"`), `falta ${item.id}`);
        assert.ok(html.includes(item.name), `falta el nombre de ${item.id}`);
    }
});

test("al editar, queda marcado el que ya tenia", () => {
    const html = establishmentOptionsHTML("hospital-claudio-vicuna");

    assert.match(html, /value="hospital-claudio-vicuna" selected/);
    assert.ok(
        !/<option value=""\s+selected>/.test(html),
        "no debe quedar marcado tambien Sin indicar"
    );
});

// --- El viaje del establecimiento hasta la pantalla ---
//
// Guardarlo funcionaba: el documento de la unidad quedaba bien. Pero al volver
// a abrir Ajustes decia "Sin indicar", porque esa pantalla NO lee el servidor:
// lee la copia local de la unidad activa, y el campo se perdia en el camino.
//
// Estas pruebas ejecutan ese viaje con un almacenamiento falso, en vez de
// comprobar que el codigo mencione el campo.

import { readFile } from "node:fs/promises";

const workspaces = await readFile(
    new URL("../js/workspaces.js", import.meta.url),
    "utf8"
);

function extraer(nombre) {
    const inicio = workspaces.indexOf(`function ${nombre}(`);

    assert.notEqual(inicio, -1, `no encontre ${nombre}`);

    let profundidad = 0;

    for (let i = workspaces.indexOf("{", inicio); i < workspaces.length; i += 1) {
        if (workspaces[i] === "{") profundidad += 1;
        else if (workspaces[i] === "}") {
            profundidad -= 1;
            if (!profundidad) return workspaces.slice(inicio, i + 1);
        }
    }

    throw new Error(`sin cierre: ${nombre}`);
}

// Monta las funciones reales sobre un almacen de mentira.
function montar() {
    const almacen = new Map();
    const fabrica = new Function(
        "ACTIVE_WORKSPACE_KEY",
        "getJSON",
        "setJSON",
        "normalizeEstablishment",
        `${extraer("workspaceLabel")}
         ${extraer("setActiveWorkspace")}
         ${extraer("getActiveWorkspace")}
         ${extraer("rememberActiveEstablishment")}
         return { setActiveWorkspace, getActiveWorkspace, rememberActiveEstablishment };`
    );

    // Guarda TEXTO y parsea al leer, como el almacenamiento de verdad: si
    // devolviera la misma referencia, mutar lo leido parecería guardar, y la
    // prueba taparía justo el error que busca.
    return fabrica(
        "activa",
        (clave, porDefecto) => (
            almacen.has(clave) ? JSON.parse(almacen.get(clave)) : porDefecto
        ),
        (clave, valor) => { almacen.set(clave, JSON.stringify(valor)); },
        normalizeEstablishment
    );
}

test("la copia local de la unidad conserva el establecimiento", () => {
    // Si se pierde aqui, Ajustes muestra "Sin indicar" aunque el servidor lo
    // tenga bien guardado.
    const api = montar();

    api.setActiveWorkspace({
        id: "ws-1",
        name: "SAMU",
        role: "owner",
        establishment: "hospital-claudio-vicuna"
    });

    assert.equal(
        api.getActiveWorkspace().establishment,
        "hospital-claudio-vicuna"
    );
});

test("guardar el establecimiento lo deja en la copia local", () => {
    // getActiveWorkspace() devuelve un objeto NUEVO cada vez: mutar lo que
    // devuelve no guardaba nada, y ese era el bug.
    const api = montar();

    api.setActiveWorkspace({ id: "ws-1", name: "SAMU", role: "owner" });

    assert.equal(api.getActiveWorkspace().establishment, "");

    api.rememberActiveEstablishment("hospital-claudio-vicuna");

    assert.equal(
        api.getActiveWorkspace().establishment,
        "hospital-claudio-vicuna"
    );
});

test("mutar lo que devuelve getActiveWorkspace no guarda nada", () => {
    // Es la forma exacta del bug: parecia que se guardaba.
    const api = montar();

    api.setActiveWorkspace({ id: "ws-1", name: "SAMU", role: "owner" });
    api.getActiveWorkspace().establishment = "hospital-claudio-vicuna";

    assert.equal(api.getActiveWorkspace().establishment, "");
});

test("un establecimiento desconocido no se cuela en la copia local", () => {
    const api = montar();

    api.setActiveWorkspace({
        id: "ws-1",
        name: "SAMU",
        role: "owner",
        establishment: "HCV a mano"
    });

    assert.equal(api.getActiveWorkspace().establishment, "");
});

test("el establecimiento viaja desde el documento de la unidad", () => {
    // Si no sale de ahi, nadie mas lo tiene: es la fuente.
    assert.match(workspaces, /establishment: normalizeEstablishment\(data\.establishment\)/);
});
