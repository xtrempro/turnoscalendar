// El cuadro de contrato tiene que dejar llegar al boton de Guardar.
//
// Reportado al probar en test el 2026-09-22: el cuadro se cortaba abajo y los
// botones del pie no aparecian. Medido con Edge headless contra el CSS
// anterior: `pie_visible: false`, `boton_guardar_clickable: false`,
// `cuerpo_se_desplaza: false`. El boton era inalcanzable.
//
// La causa: `.rotation-config-dialog` ya daba `max-height` y `overflow: auto`,
// pero `.rc-dialog` -declarada despues, y por tanto ganadora- puso
// `overflow: hidden` para recortar las esquinas redondeadas. Eso mato el
// desplazamiento y dejo el alto limitado: el contenido sobrante se recortaba
// sin ninguna forma de llegar a el.
//
// Ahora el cuadro es una columna flex: cabecera y pie fijos, y lo que se
// desplaza es el cuerpo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const styles = (await readFile(
    new URL("../styles.css", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

/** El cuerpo de una regla CSS por su selector exacto. */
function regla(selector) {
    const start = styles.indexOf(`\n${selector} {`);

    assert.notEqual(start, -1, `no se encontro la regla: ${selector}`);

    const open = styles.indexOf("{", start);

    return styles.slice(open + 1, styles.indexOf("}", open));
}

test("el cuadro no crece mas que la pantalla", () => {
    assert.match(regla(".rc-dialog"), /max-height:\s*min\(/);
});

test("y es una columna: cabecera y pie NO se desplazan", () => {
    const cuerpo = regla(".rc-dialog");

    assert.match(cuerpo, /display:\s*flex/);
    assert.match(cuerpo, /flex-direction:\s*column/);
    assert.match(regla(".rc-head,\n.rc-foot"), /flex:\s*none/);
});

test("lo que se desplaza es el CUERPO", () => {
    const cuerpo = regla(".rc-body");

    assert.match(cuerpo, /overflow:\s*auto/);
    // Sin esto un hijo de flex no encoge por debajo de su contenido y el pie
    // se vuelve a ir fuera de la pantalla.
    assert.match(cuerpo, /min-height:\s*0/);
});

test("el `hidden` del navegador no puede perder contra una clase", () => {
    // `[hidden]` del agente de usuario pierde en especificidad contra cualquier
    // clase que fije `display`, y aqui lo fijan `rc-why`, `rc-jump`, `rc-bands`
    // y `rc-legend`. Sin esta regla, el recuadro de explicacion VACIO se veia
    // como una franja roja al pie del calendario aunque no hubiera pendientes.
    assert.match(
        regla(".rc-dialog [hidden]"),
        /display:\s*none\s*!important/
    );
});

test("las clases del cuadro siguen fijando display, que es lo que lo motiva", () => {
    // Si algun dia dejaran de hacerlo, la regla de arriba sobraria. Mientras
    // tanto documenta por que existe.
    ["\\.rc-why", "\\.rc-jump", "\\.rc-bands", "\\.rc-legend"].forEach(sel => {
        assert.match(
            styles,
            new RegExp(`\\n${sel} \\{[^}]*display:`),
            `${sel} ya no fija display`
        );
    });
});
