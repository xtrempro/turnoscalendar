// El modo "Solicitar aprobacion" reparte sus dos controles.
//
// La casilla de "enviar solicitud a todos" vivia junto al boton de enviar en un
// recuadro propio, metido entre el buscador y la lista de candidatos. Eso
// partia el modal en dos y dejaba el boton de enviar lejos del resto de
// botones. Ahora la casilla acompaña al buscador, en su misma fila, y el boton
// baja con los demas al final.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const leer = async name => (await readFile(
    new URL(name, import.meta.url), "utf8"
)).replace(/\r\n/g, "\n");

const calendar = await leer("../js/calendar.js");

test("la casilla de enviar a todos va en la fila del buscador", () => {
    assert.match(
        calendar,
        /<div class="replacement-search-row">\s*\n\s*<input\s*\n\s*type="search"/
    );
    assert.match(calendar, /\$\{sendAllCheckbox\}\s*\n\s*<\/div>/);
});

test("el buscador se oculta solo EL, no la fila entera", () => {
    // El buscador aparece unicamente cuando la lista desborda. Si el is-hidden
    // cayera sobre la fila, la casilla desapareceria junto con el justo en las
    // listas cortas, que son la mayoria.
    assert.match(calendar, /class="replacement-search is-hidden"/);
    assert.match(
        calendar,
        /searchBox\.classList\.toggle\("is-hidden", !scrollable\);/
    );
});

test("el boton de enviar baja con los demas botones", () => {
    assert.match(
        calendar,
        /<div class="turn-change-dialog__actions replacement-dialog__actions">\s*\n\s*\$\{sendSelectedButton\}/
    );
});

test("las dos piezas solo existen en modo solicitud", () => {
    assert.match(calendar, /const sendAllCheckbox = isRequestMode/);
    assert.match(calendar, /const sendSelectedButton = isRequestMode/);
});

test("el recuadro viejo ya no existe, ni su CSS", async () => {
    // Una clase muerta en una hoja de 27 mil lineas es ruido que despues nadie
    // se atreve a tocar.
    const estilos = await leer("../styles.css");

    assert.doesNotMatch(calendar, /replacement-bulk-actions/);
    assert.doesNotMatch(estilos, /replacement-bulk-actions/);
});

test("moverlos de sitio no rompe sus enlaces", () => {
    // Se buscan por ATRIBUTO, asi que cambiarlos de lugar en el DOM no afecta
    // a los manejadores. Por eso este cambio no toco una linea de eventos.
    assert.match(
        calendar,
        /querySelector\("\[data-action='select-all-requests'\]"\)/
    );
    assert.match(
        calendar,
        /querySelector\("\[data-action='send-selected-requests'\]"\)/
    );
});
