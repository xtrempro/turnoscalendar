// Se mueve el turno de un trabajador y despues se le aplica un permiso a ese
// turno (F. Legal, administrativo, compensatorio, licencia...). El turno deberia
// poder cubrirse como cualquier otro, pero el "!" no aparecia y no habia por
// donde hacerlo.
//
// La regla SI lo detectaba: el traslado escribe el turno en `baseData` del dia
// destino, asi que `requiereReemplazoTurnoBase` da true. El problema era de
// pintado: `buildDayCell` usa `badges` EN LUGAR de `badge` cuando le llega con
// algo, y la insignia principal quedaba fuera de esa lista. Con un traslado
// presente, "TTMM" ocupaba el lugar y borraba el "!".
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const calendar = await read("../js/calendar.js");
const shiftMoves = await read("../js/shiftMoves.js");
const styles = await read("../styles.css");

const { SHIFT_MOVE_BADGE } = await import("../js/shiftMoves.js");
const { requiereReemplazoTurnoBase } = await import("../js/rulesEngine.js");

const TURNO = { LIBRE: 0, LARGA: 1, NOCHE: 2 };
const DIA = "2026-7-28";

test("un turno trasladado con permiso SI requiere reemplazo", () => {
    // El traslado deja el turno en el `baseData` del dia destino, asi que la
    // regla lo ve igual que a un turno de rotativa. Esto ya funcionaba: lo que
    // fallaba era mostrarlo.
    const legal = { [DIA]: true };

    assert.equal(
        requiereReemplazoTurnoBase(
            DIA,
            TURNO.NOCHE,
            {},
            legal,
            {},
            {},
            "4turno"
        ),
        true
    );
});

test("sin turno no hay nada que cubrir, aunque haya permiso", () => {
    // El dia ORIGEN del traslado queda en Libre: ahi no debe salir el "!".
    assert.equal(
        requiereReemplazoTurnoBase(
            DIA,
            TURNO.LIBRE,
            {},
            { [DIA]: true },
            {},
            {},
            "4turno"
        ),
        false
    );
});

test("la insignia principal entra en la lista y no la desplaza TTMM", () => {
    // Este es el arreglo: sin el `badge` adelante, `buildDayCell` lo descartaba
    // por completo apenas hubiera un traslado, un cambio de turno o un "Pend.".
    assert.match(
        calendar,
        /const calendarBadges =\s*\n\s*Array\.from\(new Set\(\[\s*\n\s*\.\.\.\(badge \? \[badge\] : \[\]\),/
    );

    // Y sigue siendo `badges` lo que gana sobre `badge` en el pintado: por eso
    // la principal tiene que ir DENTRO de la lista, no al lado.
    assert.match(
        calendar,
        /const visibleBadges = Array\.isArray\(badges\)\s*\n\s*\? badges\.filter\(Boolean\)\s*\n\s*: \(badge \? \[badge\] : \[\]\);/
    );
});

test("la insignia principal va primero, antes que las secundarias", () => {
    // El "!" es la que exige una accion; TTMM y "Pend." solo informan.
    // Hasta el cierre de la lista y no a tantos caracteres: con una ventana
    // fija, agregar una insignia nueva empujaba el traslado fuera del trozo
    // examinado y la prueba fallaba sin que el orden hubiera cambiado.
    const inicio = calendar.indexOf("const calendarBadges =");
    const bloque = calendar.slice(
        inicio,
        calendar.indexOf("]));", inicio) + 4
    );

    assert.ok(
        bloque.indexOf("badge ? [badge]") <
            bloque.indexOf("shiftMoveMarkers.map"),
        "el badge principal debe listarse antes que el traslado"
    );
});

test("TTMM sale de una constante compartida, no de texto suelto", () => {
    // El estilo que la achica la busca por este mismo valor: con la cadena
    // repetida en dos archivos, cambiar uno dejaba el otro sin estilo.
    assert.equal(SHIFT_MOVE_BADGE, "TTMM");
    assert.match(shiftMoves, /export const SHIFT_MOVE_BADGE = "TTMM";/);
    assert.match(shiftMoves, /label: SHIFT_MOVE_BADGE/);
    assert.doesNotMatch(shiftMoves, /label: "TTMM"/);
});

test("una casilla con dos insignias conserva el alto de sus vecinas", () => {
    // Al sumar el "!" junto al TTMM, la casilla pasa a tener dos insignias y se
    // activa `has-multiple-badges`. Esa regla ademas la soltaba del alto de su
    // fila y quedaba visiblemente mas chica que las de al lado: parecia otro
    // tipo de dia. Solo debe apretar los espacios internos.
    const inicio = styles.indexOf(".day.has-multiple-badges {");
    const bloque = styles.slice(inicio, styles.indexOf("}", inicio) + 1);

    // La caja no se redefine: hereda alto, padding y el `space-between` de
    // `.day`, que es lo que apoya las insignias abajo. Redefinir cualquiera de
    // estas la desalinea de sus vecinas.
    assert.doesNotMatch(bloque, /min-height/);
    assert.doesNotMatch(bloque, /height: max-content/);
    assert.doesNotMatch(bloque, /align-self/);
    assert.doesNotMatch(bloque, /justify-content/);
    assert.doesNotMatch(bloque, /padding/);

    // Lo unico que de verdad hace falta.
    assert.match(bloque, /overflow: visible;/);
});

test("tampoco se suelta del alto en la vista responsive", () => {
    // La misma regla estaba repetida dentro de la media query de la vista de
    // turnos, deshaciendo el piso de 78px solo para esa casilla.
    assert.doesNotMatch(
        styles,
        /\.calendar-panel \.day\.has-multiple-badges \{\s*\n\s*min-height: auto;/
    );
    // El piso comun sigue existiendo para todas.
    assert.match(
        styles,
        /\.calendar-panel\.has-multiple-badge-days \.day \{\s*\n\s*min-height: 78px;/
    );
});

test("TTMM se pinta mas chica que el resto", () => {
    assert.match(
        calendar,
        /item === SHIFT_MOVE_BADGE\s*\n\s*\? "day-badge day-badge--move"/
    );
    assert.match(styles, /\.day-badge--move \{/);

    // Mas chica que la insignia base (0.65rem).
    const base = styles.match(/\.day-badge \{[\s\S]*?font-size: ([\d.]+)rem/);
    const move = styles.match(/\.day-badge--move \{[\s\S]*?font-size: ([\d.]+)rem/);

    assert.ok(base && move, "faltan los tamaños de fuente");
    assert.ok(
        Number(move[1]) < Number(base[1]),
        `TTMM (${move[1]}rem) debe ser menor que la base (${base[1]}rem)`
    );
});

test("compartiendo celda, TTMM sigue siendo mas chica que el \"!\"", () => {
    // En una casilla con dos insignias, `.day.has-multiple-badges .day-badge`
    // las igualaba a todas. TTMM solo informa; el "!" pide una accion, asi que
    // no pueden pesar lo mismo.
    const compartida = styles.match(
        /\.day\.has-multiple-badges \.day-badge \{[\s\S]*?font-size: ([\d.]+)rem/
    );
    const movida = styles.match(
        /\.day\.has-multiple-badges \.day-badge--move \{[\s\S]*?font-size: ([\d.]+)rem/
    );

    assert.ok(compartida && movida, "faltan los tamaños en celda compartida");
    assert.ok(
        Number(movida[1]) < Number(compartida[1]),
        `TTMM (${movida[1]}rem) debe ser menor que el resto (${compartida[1]}rem)`
    );

    // Y va DESPUES, o con la misma especificidad no ganaria.
    assert.ok(
        styles.indexOf(".day.has-multiple-badges .day-badge--move") >
            styles.indexOf(".day.has-multiple-badges .day-badge {"),
        "la regla de TTMM debe ir despues para ganar el desempate"
    );
});

test("el click en un turno trasladado sin cubrir va a la cobertura", () => {
    // El corto-circuito del traslado corria ANTES de saber si el turno
    // necesitaba cobertura, asi que apretar el "!" abria la ficha para anular
    // el movimiento y no habia forma de cubrirlo.
    assert.match(
        calendar,
        /if \(shiftMoveMarker && !pendingCoverage\) \{\s*\n\s*return openShiftMoveDetailDialog\(shiftMoveMarker\);/
    );

    // Y la condicion se calcula antes de esa bifurcacion.
    const posCoverage = calendar.indexOf("const pendingCoverage = dayNeedsReplacement(");
    const posDialog = calendar.indexOf("if (shiftMoveMarker && !pendingCoverage)");

    assert.ok(posCoverage !== -1 && posDialog !== -1);
    assert.ok(
        posCoverage < posDialog,
        "pendingCoverage debe calcularse antes de decidir el dialogo"
    );
});

test("la condicion de cobertura vive en un solo lugar", () => {
    // Estaba escrita dos veces -una en el render y otra dentro del click- y
    // ahora hace falta ANTES del corto-circuito del traslado. Duplicarla una
    // tercera vez era garantizar que se desalinearan.
    assert.match(calendar, /function dayNeedsReplacement\(/);
    assert.match(calendar, /const needsReplacement = pendingCoverage;/);

    // Una sola definicion del helper.
    assert.equal(
        (calendar.match(/function dayNeedsReplacement\(/g) || []).length,
        1
    );
});

test("cubierto el turno, deja de pedir cobertura en el inicio", async () => {
    // El widget de cobertura del inicio usa la MISMA regla que el calendario y
    // descuenta lo ya cubierto o preasignado, asi que un turno trasladado con
    // permiso entra en la cuenta y sale de ella al cubrirlo. Lo que se fija aca
    // es que siga apoyandose en esas condiciones y no en una lista propia.
    //
    // Se comprueba condicion por condicion y no la secuencia completa: fijar el
    // orden exacto hacia fallar esta prueba al AGREGAR una condicion -paso con
    // la del contrato de reemplazo- sin que nada se hubiera roto.
    const home = await read("../js/home.js");

    assert.match(
        home,
        /const requires = requiereReemplazoTurnoBase\(\s*\n\s*keyDay,\s*\n\s*getTurnoBase\(name, keyDay\)/
    );
    [
        // Cubierto ENTERO: un reemplazo al que le recortaron la jornada deja
        // horas sin nadie y el turno sigue pidiendo cobertura.
        "coveredShiftIsFullyCovered",
        // Un contrato de reemplazo cubre el turno sin dejar registro puntual.
        "getInheritedReplacementContractForCoveredShift",
        "getPreassignmentForCoveredShift",
        "isNoCoverageDay"
    ].forEach(condicion => {
        assert.match(
            home,
            new RegExp(`!${condicion}\\(name, keyDay\\)`),
            `el inicio tiene que descontar ${condicion}`
        );
    });
});
