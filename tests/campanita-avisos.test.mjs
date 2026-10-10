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
    // oscuro encima del fondo oscuro.
    assert.match(estilos, /\.bell-panel \{[\s\S]{0,400}var\(--panel/);
    assert.match(estilos, /body\.theme-dark \.profile-rut-notice/);
});
