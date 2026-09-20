// Preguntar no es trabajar: el estado "ocupado" no se sostiene durante un
// cuadro que espera una respuesta.
//
// El estado ocupado no es solo decorativo. El CSS le pone al body `cursor: wait
// !important` a TODO, y ademas `pointer-events: none` a los fondos de dialogo.
// Sostenerlo mientras un showConfirm espera produce dos cosas malas a la vez:
// el puntero dice "cargando" sobre un cuadro que justamente pide un clic, y en
// los cuadros que usan ese fondo los botones quedan realmente muertos.
//
// Lo reporto el usuario al agregar un turno a un trabajador a reemplazo sin
// contrato vigente: el aviso "Sin contrato vigente" salia con el puntero de
// cargando, dando a entender que habia que esperar.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const leer = async name => (await readFile(
    new URL(name, import.meta.url), "utf8"
)).replace(/\r\n/g, "\n");

const calendar = await leer("../js/calendar.js");
const styles = await leer("../styles.css");
const busy = await leer("../js/busy.js");

/** El cuerpo de una funcion flecha asignada a una constante. */
function cuerpoDe(nombre) {
    const start = calendar.indexOf(`const ${nombre} = async (`);

    assert.notEqual(start, -1, `no se encontro: ${nombre}`);

    const open = calendar.indexOf("{", calendar.indexOf(") =>", start));
    let depth = 0;
    let end = open;

    for (; end < calendar.length; end += 1) {
        if (calendar[end] === "{") depth += 1;
        else if (calendar[end] === "}") {
            depth -= 1;

            if (!depth) break;
        }
    }

    return calendar.slice(start, end + 1);
}

/* =========================================================
   Por que importa
========================================================= */

test("el estado ocupado bloquea el puntero y los clics", () => {
    // Si esto dejara de ser cierto, la regla de abajo perderia su motivo. Se
    // fija para que el porque quede escrito junto a la regla.
    assert.match(
        styles,
        /body\.app-is-busy,\s*\nbody\.app-is-busy \* \{\s*\n\s*cursor: wait !important;/
    );
    assert.match(
        styles,
        /body\.app-is-busy \.turn-change-dialog-backdrop \{\s*\n\s*pointer-events: none;/
    );
});

test("el estado ocupado se sostiene durante TODO el bloque", () => {
    // withBusyState solo suelta en el finally: no hay forma de pausarlo a la
    // mitad, asi que lo que espere una respuesta tiene que quedar fuera.
    assert.match(busy, /const endBusy = beginBusy\(/);
    assert.match(busy, /\} finally \{\s*\n\s*endBusy\(\);/);
});

/* =========================================================
   La regla
========================================================= */

test("la pregunta del contrato va ANTES de entrar en ocupado", () => {
    const cuerpo = cuerpoDe("applyCandidate");
    const pregunta = cuerpo.indexOf('title: "Sin contrato vigente"');
    const ocupado = cuerpo.indexOf("await withBusyState(");

    assert.ok(pregunta > 0, "sigue estando la pregunta del contrato");
    assert.ok(ocupado > 0, "sigue entrando en estado ocupado");
    assert.ok(
        pregunta < ocupado,
        "la pregunta tiene que resolverse antes de declararse ocupado"
    );
});

test("y si se desvia al editor de contrato, no llega a guardar nada", () => {
    const cuerpo = cuerpoDe("applyCandidate");

    assert.match(
        cuerpo,
        /window\.startReplacementContractEdit\?\.\([\s\S]{0,160}?\);\s*\n\s*return;/
    );
});

test("el punto de deshacer se registra despues de la pregunta", () => {
    // Desviarse al editor de contrato no es una accion que deshacer: si el
    // punto se registrara antes, quedaria una entrada por algo que no ocurrio.
    const cuerpo = cuerpoDe("applyCandidate");

    assert.ok(
        cuerpo.indexOf('title: "Sin contrato vigente"') <
            cuerpo.indexOf("window.pushUndoState"),
        "el undo va despues de la pregunta"
    );
});
