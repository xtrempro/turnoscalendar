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

function montarSeleccionDeLista({
    profiles,
    showInactive,
    current,
    mode = "view",
    // Lo que el supervisor esta mirando a proposito, Y en que unidad. Vacio =
    // recien abierta la aplicacion: nadie eligio nada.
    mirando = "",
    mirandoEn = "ws-1",
    unidad = "ws-1"
}) {
    const bloque = extraer(
        "const profiles = syncWorkersState(getProfiles());",
        "const current = getCurrentProfile();"
    );
    let elegido = current;
    // Con la funcion REAL que decide que se ofrece: reimplementarla aqui seria
    // probar la copia de la regla y no la regla.
    const listable = extraer(
        "function selectableProfileList",
        "function renderProfiles"
    );
    const fabrica = new Function(
        "syncWorkersState",
        "getProfiles",
        "getAppFilters",
        "isProfileActive",
        "getCurrentProfile",
        "setCurrentProfile",
        "profileDraft",
        "PROFILE_MODE",
        "isWatchedInactiveProfile",
        `${listable} ${bloque} return null;`
    );

    fabrica(
        lista => lista,
        () => profiles,
        () => ({ showInactive }),
        perfil => perfil.active !== false,
        () => elegido,
        nombre => { elegido = nombre; },
        { mode },
        { VIEW: "view", CREATE: "create" },
        // La funcion REAL compara nombre Y unidad; aqui se le da el mismo
        // criterio con los datos de la prueba.
        nombre => Boolean(nombre) && nombre === mirando && unidad === mirandoEn
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
            current: "Ana",
            mirando: "Ana"
        }),
        "Ana"
    );
});

test("al volver a abrir la aplicacion, el inactivo ya no aparece solo", () => {
    // Lo que se mira a proposito no se guarda en ninguna parte, asi que al
    // recargar nadie lo esta mirando: el inactivo vuelve a estar solo para
    // quien lo busque o marque "ver inactivos".
    assert.equal(
        montarSeleccionDeLista({
            profiles: [ANA, BEATRIZ],
            showInactive: false,
            current: "Ana",
            mirando: ""
        }),
        "Beatriz"
    );
});

test("con 'ver inactivos' marcado se queda, lo mire quien lo mire", () => {
    assert.equal(
        montarSeleccionDeLista({
            profiles: [ANA, BEATRIZ],
            showInactive: true,
            current: "Ana",
            mirando: ""
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
        "watchInactiveProfile",
        `${seleccion} return selectProfileAfterSave;`
    );
    const elegidos = [];
    const mirados = [];

    fabrica(
        nombre => { elegidos.push(nombre); },
        nombre => { mirados.push(nombre); }
    )("Ana");

    assert.deepEqual(elegidos, ["Ana"]);
    // Y queda como "lo que se esta mirando", que es lo que impide que la lista
    // lo suelte si acaba de quedar inactivo.
    assert.deepEqual(mirados, ["Ana"]);
});

test("elegir un perfil a mano tambien cuenta como mirarlo", () => {
    // Buscarlo con la lupa es la otra forma de llegar a un inactivo, y si no
    // contara, la lista lo soltaria en el primer repintado.
    const seleccionar = extraer(
        "async function selectProfileByName",
        "window.selectProfileByName"
    );

    assert.match(
        seleccionar,
        /watchInactiveProfile\(profile\.name\);\s*\n\s*setCurrentProfile\(profile\.name\);/
    );
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

// --- Entrar a una unidad no abre a quien ya no trabaja ahi ---

test("al cambiar de unidad se abre el primero que la lista OFRECE", () => {
    // Antes tomaba el primero del estado, que puede estar inactivo: entrar a
    // una unidad abria el perfil de alguien que ya se fue, sin que nadie lo
    // hubiera buscado.
    const sincronizar = extraer(
        "function syncWorkspaceStateViews",
        "async function reloadAppToLatestVersion"
    );

    assert.match(
        sincronizar,
        /setCurrentProfile\(\s*selectableProfileList\(profiles\)\[0\]\?\.name \|\| null\s*\)/
    );
    assert.doesNotMatch(sincronizar, /setCurrentProfile\(profiles\[0\]\.name\)/);
});

test("la regla de que se ofrece esta escrita en un solo lugar", () => {
    // Dos lugares eligen "el primero" y tienen que elegir igual.
    const listable = extraer(
        "function selectableProfileList",
        "function renderProfiles"
    );

    assert.match(listable, /getAppFilters\("profiles"\)\.showInactive/);
    assert.match(listable, /showInactive \|\| isProfileActive\(profile\)/);

    const lista = extraer("function renderProfiles", "function hheeInitials");

    assert.match(lista, /const selectableProfiles = selectableProfileList\(profiles\)/);
});

test("la marca no viaja de una unidad a otra", () => {
    // Dos unidades del mismo hospital pueden tener a alguien que se llame
    // igual: con solo el nombre, cambiar de unidad dejaba abierto alla un
    // perfil inactivo que nadie busco.
    assert.equal(
        montarSeleccionDeLista({
            profiles: [ANA, BEATRIZ],
            showInactive: false,
            current: "Ana",
            mirando: "Ana",
            mirandoEn: "ws-origen",
            unidad: "ws-destino"
        }),
        "Beatriz"
    );
});

test("y en su propia unidad sigue valiendo", () => {
    assert.equal(
        montarSeleccionDeLista({
            profiles: [ANA, BEATRIZ],
            showInactive: false,
            current: "Ana",
            mirando: "Ana",
            mirandoEn: "ws-destino",
            unidad: "ws-destino"
        }),
        "Ana"
    );
});

test("la marca real solo vale en la unidad donde se puso", () => {
    // Las pruebas de arriba ejercitan el guard con un criterio propio; esta
    // ejecuta el criterio DE VERDAD.
    const marcar = extraer(
        "function watchInactiveProfile",
        "// Despues de guardar se sigue viendo"
    );
    let unidad = "ws-origen";
    const api = new Function(
        "getActiveWorkspace",
        `let watchedInactiveProfile = { workspaceId: "", name: "" };
         ${marcar}
         return { watchInactiveProfile, isWatchedInactiveProfile };`
    )(() => ({ id: unidad }));

    api.watchInactiveProfile("Ana");

    assert.equal(api.isWatchedInactiveProfile("Ana"), true);
    assert.equal(api.isWatchedInactiveProfile("Beatriz"), false);
    assert.equal(api.isWatchedInactiveProfile(""), false);

    unidad = "ws-destino";

    assert.equal(
        api.isWatchedInactiveProfile("Ana"),
        false,
        "en otra unidad no vale, aunque se llame igual"
    );
});

test("la marca real guarda unidad y nombre, y los compara juntos", () => {
    const marcar = extraer(
        "function watchInactiveProfile",
        "function isWatchedInactiveProfile"
    );
    const comparar = extraer(
        "function isWatchedInactiveProfile",
        "// Despues de guardar se sigue viendo"
    );

    assert.match(marcar, /workspaceId: getActiveWorkspace\(\)\?\.id \|\| ""/);
    assert.match(comparar, /watchedInactiveProfile\.name === name/);
    assert.match(
        comparar,
        /watchedInactiveProfile\.workspaceId === \(getActiveWorkspace\(\)\?\.id \|\| ""\)/
    );
});
