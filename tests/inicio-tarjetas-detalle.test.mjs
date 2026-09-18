// Las casillas del resumen abren el detalle de su tarjeta.
//
// Cobertura de turnos y Brecha RRHH mostraban dos casillas con el numero y la
// etiqueta -"Sin cubrir", "Preasignados"-, que es donde el ojo cae primero y
// donde se hace clic por instinto. Eran un <div> mudo: el detalle solo se
// alcanzaba por el switch "Ver detalles" de la cabecera.
//
// Las otras tarjetas del inicio ya se comportaban asi (absence-summary e
// inc-kind son botones), de modo que estas dos eran las que faltaban.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const leer = async name => (await readFile(
    new URL(name, import.meta.url), "utf8"
)).replace(/\r\n/g, "\n");

const home = await leer("../js/home.js");
const styles = await leer("../styles.css");

/** El cuerpo de una funcion, para no medir coincidencias de otra parte. */
function cuerpo(source, nombre) {
    const start = source.indexOf(`function ${nombre}(`);

    assert.notEqual(start, -1, `no se encontro: ${nombre}`);

    return source.slice(start, start + 1800);
}

/* =========================================================
   Las casillas son botones
========================================================= */

test("Cobertura: las dos casillas son botones con su gancho", () => {
    const body = cuerpo(home, "coberturaBody");

    assert.match(
        body,
        /<button class="hm-cob-chip hm-cob-chip--crit" type="button" data-hm="cob-chip">/
    );
    assert.match(
        body,
        /<button class="hm-cob-chip hm-cob-chip--accent" type="button" data-hm="cob-chip">/
    );
});

test("Brecha RRHH: lo mismo", () => {
    const body = cuerpo(home, "brechaBody");

    assert.match(
        body,
        /<button class="hm-cob-chip hm-cob-chip--warn" type="button" data-hm="brecha-chip">/
    );
    assert.match(
        body,
        /<button class="hm-cob-chip hm-cob-chip--accent" type="button" data-hm="brecha-chip">/
    );
});

test("ya no queda ninguna casilla muda", () => {
    // Un <div class="hm-cob-chip"> es exactamente el bug que se corrigio.
    assert.doesNotMatch(home, /<div class="hm-cob-chip/);
});

/* =========================================================
   Y abren lo mismo que el switch
========================================================= */

test("Cobertura: el clic abre el detalle y mueve el switch", () => {
    // El switch se mueve a mano porque la cabecera no se repinta: sin eso
    // quedaria en "apagado" con el detalle abierto, diciendo dos cosas
    // distintas sobre el mismo estado.
    assert.match(
        home,
        /panel\.querySelectorAll\('\[data-hm="cob-chip"\]'\)\.forEach\(chip => \{[\s\S]{0,260}coverageDetail = true;[\s\S]{0,120}detail\.checked = true;[\s\S]{0,120}reRenderCoverage\(panel\);/
    );
});

test("Brecha RRHH: el clic abre el detalle y mueve el switch", () => {
    assert.match(
        home,
        /panel\.querySelectorAll\('\[data-hm="brecha-chip"\]'\)\.forEach\(chip => \{[\s\S]{0,260}brechaDetail = true;[\s\S]{0,140}brechaSwitch\.checked = true;[\s\S]{0,120}reRenderBrecha\(panel\);/
    );
});

test("el enlace sobrevive a los plegados", () => {
    // reRenderCoverage NO rehace el DOM: solo alterna `hidden`. Por eso basta
    // enlazar una vez, como hace el resto del archivo. Si algun dia pasara a
    // repintar la tarjeta, habria que delegar o las casillas quedarian mudas
    // despues del primer clic.
    const render = cuerpo(home, "reRenderCoverage");

    assert.match(render, /summary\.hidden = coverageDetail;/);
    assert.match(render, /list\.hidden = !coverageDetail;/);
    assert.doesNotMatch(render, /innerHTML/);
});

/* =========================================================
   Que se vean como algo que se puede apretar
========================================================= */

test("el CSS trata la casilla como boton", () => {
    // Un boton no hereda fuente ni color, y en una columna flex se encogeria
    // al contenido sin el ancho completo.
    assert.match(styles, /\.hm-cob-chip \{[^}]*cursor: pointer;/);
    assert.match(styles, /\.hm-cob-chip \{[^}]*width: 100%;/);
    assert.match(styles, /\.hm-cob-chip \{[^}]*font: inherit;/);
    assert.match(styles, /\.hm-cob-chip:hover/);
});
