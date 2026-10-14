// Ver un perfil inactivo.
//
// Al inactivar a alguien y guardar, la vista saltaba al primer perfil activo:
// el supervisor terminaba mirando a otra persona justo cuando queria ver el
// resultado de lo que acababa de hacer. Eran DOS saltos distintos, y por eso
// cambiar solo uno no alcanzaba:
//
//   1. selectProfileAfterSave elegia a proposito otro perfil activo;
//   2. renderProfiles, ademas, soltaba al perfil elegido cuando el filtro de la
//      lista no lo mostraba, y un inactivo no se lista salvo que se pida.
//
// Y como quedarse ahi solo sirve si se nota, la vista del perfil inactivo se
// pinta en gris.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
);

function extraer(desde, hasta) {
    const inicio = source.indexOf(desde);

    assert.notEqual(inicio, -1, `no encontre ${desde}`);

    const fin = source.indexOf(hasta, inicio);

    assert.notEqual(fin, -1, `no encontre ${hasta}`);

    return source.slice(inicio, fin);
}

// --- A quien se esta mirando despues de guardar ---

function montarSeleccionDeLista({ profiles, showInactive, current, mode = "view" }) {
    const bloque = extraer(
        "const profiles = syncWorkersState(getProfiles());",
        "const current = getCurrentProfile();"
    );
    let elegido = current;
    const fabrica = new Function(
        "syncWorkersState",
        "getProfiles",
        "getAppFilters",
        "isProfileActive",
        "getCurrentProfile",
        "setCurrentProfile",
        "profileDraft",
        "PROFILE_MODE",
        `${bloque} return null;`
    );

    fabrica(
        lista => lista,
        () => profiles,
        () => ({ showInactive }),
        perfil => perfil.active !== false,
        () => elegido,
        nombre => { elegido = nombre; },
        { mode },
        { VIEW: "view", CREATE: "create" }
    );

    return elegido;
}

const ANA = { name: "Ana", active: false };
const BEATRIZ = { name: "Beatriz", active: true };

test("el perfil recien inactivado se sigue viendo, aunque la lista no lo muestre", () => {
    assert.equal(
        montarSeleccionDeLista({
            profiles: [ANA, BEATRIZ],
            showInactive: false,
            current: "Ana"
        }),
        "Ana"
    );
});

test("tampoco se suelta cuando la lista si muestra los inactivos", () => {
    assert.equal(
        montarSeleccionDeLista({
            profiles: [ANA, BEATRIZ],
            showInactive: true,
            current: "Ana"
        }),
        "Ana"
    );
});

test("un perfil que ya no existe si se suelta, y toma uno listable", () => {
    // Esto es lo que no se puede perder al dejar de saltar: si el perfil se
    // borro, quedarse apuntando a el dejaria la vista en la nada.
    assert.equal(
        montarSeleccionDeLista({
            profiles: [BEATRIZ],
            showInactive: false,
            current: "Ana"
        }),
        "Beatriz"
    );
});

test("si no queda ningun perfil listable, no se inventa uno", () => {
    assert.equal(
        montarSeleccionDeLista({
            profiles: [ANA],
            showInactive: false,
            current: "Carlos"
        }),
        null
    );
});

test("editando un perfil nuevo, la lista no cambia a quien se esta mirando", () => {
    assert.equal(
        montarSeleccionDeLista({
            profiles: [ANA, BEATRIZ],
            showInactive: false,
            current: "Ana",
            mode: "create"
        }),
        "Ana"
    );
});

test("al guardar se vuelve al perfil guardado, sin mirar si quedo activo", () => {
    const seleccion = extraer(
        "function selectProfileAfterSave",
        "function normalizeProfileDraftText"
    );
    const fabrica = new Function(
        "setCurrentProfile",
        `${seleccion} return selectProfileAfterSave;`
    );
    const elegidos = [];

    fabrica(nombre => { elegidos.push(nombre); })("Ana");

    assert.deepEqual(elegidos, ["Ana"]);
});

// --- Que se note que esta inactivo ---

function montarMarca() {
    const marca = extraer(
        "function markInactiveProfileView",
        "function renderProfileHero"
    );
    const clases = new Set();
    const fabrica = new Function(
        "document",
        `${marca} return markInactiveProfileView;`
    );

    return {
        clases,
        marcar: fabrica({
            querySelector: selector => (
                selector === ".profile-view-layout"
                    ? {
                        classList: {
                            toggle: (nombre, encendido) => {
                                if (encendido) clases.add(nombre);
                                else clases.delete(nombre);
                            }
                        }
                    }
                    : null
            )
        })
    };
}

test("la vista se marca y se desmarca segun el perfil", () => {
    const { clases, marcar } = montarMarca();

    marcar(true);
    assert.equal(clases.has("pf-inactive"), true);

    marcar(false);
    assert.equal(clases.has("pf-inactive"), false);
});

test("sin perfil elegido la vista no queda marcada de antes", () => {
    // El hero se vacia por un camino aparte: si no se desmarcara ahi, la
    // pantalla "Selecciona un trabajador" quedaria gris.
    const hero = extraer("function renderProfileHero", "function renderProfileKpis");
    const sinPerfil = hero.slice(
        hero.indexOf("if (!profile && !creating)"),
        hero.indexOf("avatar.textContent = pfInitials")
    );

    assert.match(sinPerfil, /markInactiveProfileView\(false\)/);
    assert.match(hero, /markInactiveProfileView\(!active\)/);
});

test("el CSS despinta las tarjetas del perfil inactivo", async () => {
    const css = await readFile(
        new URL("../styles.css", import.meta.url),
        "utf8"
    );
    const bloque = css.slice(
        css.indexOf(".pf-v2.pf-inactive"),
        css.indexOf("}", css.indexOf(".pf-v2.pf-inactive"))
    );

    // Las tarjetas de colores, el avatar, los iconos y los graficos.
    for (const pieza of [
        ".pf-av",
        ".pf-kpi",
        ".pf-card-ico",
        ".pf-mini-head .ci",
        ".pf-vac",
        ".pf-spark",
        ".pf-tdist"
    ]) {
        assert.ok(
            bloque.includes(`.pf-v2.pf-inactive ${pieza}`),
            `falta despintar ${pieza}`
        );
    }

    assert.match(css, /\.pf-v2\.pf-inactive[\s\S]{0,400}filter: grayscale\(1\);/);
});
