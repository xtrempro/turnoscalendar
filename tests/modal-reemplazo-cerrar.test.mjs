// El modal "Seleccionar reemplazo" se cierra con una cruz, no con un boton.
//
// El pie tenia cuatro botones y uno de ellos, "Cancelar", solo servia para
// cerrar: ocupaba una casilla entera del footer al lado de acciones que si
// hacen algo (anular el permiso, marcarlo sin cobertura, adjuntar documento).
// Paso a ser una cruz en la cabecera, que es como cierran el resto de los
// cuadros del proyecto.
//
// Quitarlo no era solo borrar el boton: el enlace del clic y el respaldo del
// foco apuntaban a el por selector, asi que habia que reapuntar los dos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const calendar = await readFile(
    new URL("../js/calendar.js", import.meta.url),
    "utf8"
);
const styles = await readFile(
    new URL("../styles.css", import.meta.url),
    "utf8"
);

/** El grupo de controles de la cabecera, y solo ese. */
function headerActions() {
    const start = calendar.indexOf(
        '<div class="replacement-dialog-header-actions">'
    );

    assert.notEqual(start, -1, "no se encontro el grupo de la cabecera");

    return calendar.slice(start, calendar.indexOf("</div>", start));
}

/** El bloque de acciones del pie de ESTE modal, y solo ese. */
function footer() {
    const start = calendar.indexOf(
        '<div class="turn-change-dialog__actions replacement-dialog__actions">'
    );

    assert.notEqual(start, -1, "no se encontro el pie del modal");

    return calendar.slice(start, calendar.indexOf("</div>", start));
}

/* =========================================================
   La cruz
========================================================= */

test("la cabecera lleva una cruz para cerrar", () => {
    assert.match(
        calendar,
        /class="replacement-dialog-close"\s*\n\s*type="button"\s*\n\s*data-action="close"\s*\n\s*aria-label="Cerrar"/
    );
});

test("usa el mismo idioma de cierre que el resto del proyecto", () => {
    // &times; con aria-label="Cerrar" es lo que usan home, agenda, tareas y
    // las busquedas de perfil. No se inventa uno nuevo para este cuadro.
    assert.match(calendar, /aria-label="Cerrar"\s*\n\s*title="Cerrar"\s*\n\s*>&times;<\/button>/);
});

test("convive con el boton de mas opciones, agrupados a la derecha", () => {
    // La cabecera es un flex con el titulo a la izquierda: sin agruparlos, el
    // space-between habria separado los dos controles.
    //
    // Se mira el BLOQUE, no la distancia entre un atributo y otro: medir
    // caracteres hacia romperse la prueba en cuanto alguien agregara un
    // atributo al boton de en medio, sin que nada estuviera mal.
    const controles = headerActions();

    assert.match(controles, /data-action="toggle-options"/);
    assert.match(controles, /data-action="close"/);
    // Y en ese orden: la cruz va al extremo.
    assert.ok(
        controles.indexOf('data-action="toggle-options"') <
            controles.indexOf('data-action="close"'),
        "la cruz deberia ir despues del boton de mas opciones"
    );
    assert.match(
        styles,
        /\.replacement-dialog-header-actions \{[^}]*display: flex;/
    );
    assert.match(styles, /\.replacement-dialog-close \{/);
});

/* =========================================================
   Y "Cancelar" ya no esta
========================================================= */

test("el pie ya no trae el boton Cancelar", () => {
    // Acotado al pie de ESTE modal: data-action="cancel" sigue siendo legitimo
    // en los otros cuadros del mismo archivo.
    const acciones = footer();

    assert.doesNotMatch(acciones, /Cancelar/);
    assert.doesNotMatch(acciones, /data-action="cancel"/);
    // Lo que si debe seguir estando.
    assert.match(acciones, /data-action="cancel-leave"/);
    assert.match(acciones, /data-action="no-coverage"/);
});

/* =========================================================
   Lo que se habria roto en silencio
========================================================= */

test("el clic de cerrar quedo reapuntado a la cruz", () => {
    // Esta linea NO lleva `?.`: si la cruz desapareciera del marcado, revienta
    // aqui en vez de dejar un modal que no se puede cerrar.
    assert.match(
        calendar,
        /backdrop\s*\n\s*\.querySelector\("\[data-action='close'\]"\)\s*\n\s*\.onclick = close;/
    );
});

test("y el respaldo del foco tambien", () => {
    // Cuando no hay ningun candidato que enfocar, el foco cae en la cruz.
    assert.match(
        calendar,
        /backdrop\.querySelector\("\.replacement-candidate"\) \|\|\s*\n\s*backdrop\.querySelector\("\[data-action='close'\]"\)/
    );
});

/* =========================================================
   El pie impar
========================================================= */

test("el ultimo boton no deja un hueco si queda solo", () => {
    // Con "Cancelar" eran cuatro y el grid de 2 columnas calzaba justo. Con
    // tres, el ultimo quedaba solo en su fila ocupando media casilla.
    assert.match(
        styles,
        /\.replacement-dialog__actions > :last-child:nth-child\(odd\) \{\s*\n\s*grid-column: 1 \/ -1;/
    );
});
