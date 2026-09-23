// Botones de turno del menu Turnos: "Diurno", "Larga" y "Noche".
//
// El supervisor elige el turno en el boton y despues marca el dia, sin pasar por
// el switch de "Editar". Lo que este archivo fija es la regla que decide QUE
// casillas se iluminan y en que queda el dia al marcarlas, porque de ella cuelga
// todo lo demas: si iluminara una casilla que despues rechaza el guardado, el
// supervisor haria click y no pasaria nada.
//
// La regla no se reinventa: es la misma suma de turnos de la edicion directa
// (fusionarTurnos) limitada a los turnos que admite el dia. Por eso el caso que
// pidio el usuario -Diurno sobre un dia hábil con Noche deja D+N- sale solo.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(k) { return this.values.has(k) ? this.values.get(k) : null; }
    key(i) { return [...this.values.keys()][i] ?? null; }
    removeItem(k) { this.values.delete(k); }
    setItem(k, v) { this.values.set(k, String(v)); }
}

globalThis.localStorage = new MemoryStorage();

const { setJSON } = await import("../js/persistence.js");
const { getAddTurnResult } = await import("../js/turnEngine.js");
const { TURNO } = await import("../js/constants.js");
const {
    addPreassignment,
    getPreassignments,
    getPreassignmentTurnForWorker,
    setPreassignmentReason
} = await import("../js/preassignments.js");

const leer = async name => (await readFile(
    new URL(name, import.meta.url), "utf8"
)).replace(/\r\n/g, "\n");

const html = await leer("../index.html");
const css = await leer("../styles.css");
const main = await leer("../js/main.js");
const calendar = await leer("../js/calendar.js");

const NOMBRE = "Trabajadora";
// Julio 2026: el 1 cae miercoles. Lunes 6 (hábil), sabado 11 (no hábil).
const LUNES = "2026-6-6";
const SABADO = "2026-6-11";

function sembrar() {
    localStorage.clear();
    setJSON("profiles", [
        { name: NOMBRE, contractType: "Planta", estamento: "Profesional" }
    ]);
    setJSON("rotativa_" + NOMBRE, { type: "libre" });
}

beforeEach(sembrar);

// Atajo: pregunta por un dia con un turno ya puesto y otro elegido en el boton.
function poner(elegido, { actual = TURNO.LIBRE, base = actual, isHab = true, key = LUNES } = {}) {
    return getAddTurnResult(NOMBRE, key, elegido, isHab, {
        effectiveBaseTurn: base,
        actualState: actual,
        replacementTurn: TURNO.LIBRE
    });
}

/* ───────── El caso que pidio el usuario ───────── */

test("Diurno sobre un dia hábil con Noche deja D+N", () => {
    const r = poner(TURNO.DIURNO, { actual: TURNO.NOCHE });

    assert.equal(r.allowed, true);
    assert.equal(r.nextVisibleTurn, TURNO.DIURNO_NOCHE);
    assert.equal(r.nextStoredTurn, TURNO.DIURNO_NOCHE);
});

test("ese mismo dia, en fin de semana, NO se ilumina", () => {
    // D+N solo existe en dia hábil: en sabado el boton Diurno no debe ofrecer
    // esa casilla, o el supervisor marcaria un turno que el motor no admite.
    const r = poner(TURNO.DIURNO, { actual: TURNO.NOCHE, isHab: false, key: SABADO });

    assert.equal(r.allowed, false);
});

/* ───────── Dia libre: el turno entra tal cual ───────── */

test("en un dia libre cada boton pone su propio turno", () => {
    assert.deepEqual(
        [TURNO.DIURNO, TURNO.LARGA, TURNO.NOCHE].map(t => {
            const r = poner(t);
            return [r.allowed, r.nextVisibleTurn];
        }),
        [
            [true, TURNO.DIURNO],
            [true, TURNO.LARGA],
            [true, TURNO.NOCHE]
        ]
    );
});

test("un dia libre de fin de semana admite Larga y Noche, pero no Diurno", () => {
    const opciones = { isHab: false, key: SABADO };

    assert.equal(poner(TURNO.LARGA, opciones).allowed, true);
    assert.equal(poner(TURNO.NOCHE, opciones).allowed, true);
    // El ciclo de la edicion directa tampoco ofrece Diurno en dia no hábil.
    assert.equal(poner(TURNO.DIURNO, opciones).allowed, false);
});

/* ───────── Sumas sobre un turno ya puesto ───────── */

test("Noche sobre Larga deja 24h", () => {
    const r = poner(TURNO.NOCHE, { actual: TURNO.LARGA });

    assert.equal(r.allowed, true);
    assert.equal(r.nextVisibleTurn, TURNO.TURNO24);
});

test("Larga sobre un Diurno extiende la jornada a Larga", () => {
    const r = poner(TURNO.LARGA, { actual: TURNO.DIURNO });

    assert.equal(r.allowed, true);
    assert.equal(r.nextVisibleTurn, TURNO.LARGA);
});

test("el turno que ya esta puesto no ilumina su casilla", () => {
    // Sin esto la casilla se iluminaria y el click no haria nada visible.
    assert.equal(poner(TURNO.DIURNO, { actual: TURNO.DIURNO }).allowed, false);
    assert.equal(poner(TURNO.NOCHE, { actual: TURNO.NOCHE }).allowed, false);
    assert.equal(poner(TURNO.LARGA, { actual: TURNO.LARGA }).allowed, false);
});

test("un dia cerrado en 24h o D+N no admite nada mas", () => {
    [TURNO.TURNO24, TURNO.DIURNO_NOCHE].forEach(actual => {
        [TURNO.DIURNO, TURNO.LARGA, TURNO.NOCHE].forEach(elegido => {
            assert.equal(
                poner(elegido, { actual }).allowed,
                false,
                `${elegido} sobre ${actual}`
            );
        });
    });
});

/* ───────── El 24h respeta su interruptor ───────── */

test("sin turnos de 24h permitidos, Noche sobre Larga no se ofrece", () => {
    setJSON("turnChangeConfig", { allowTwentyFourHourShifts: false });

    assert.equal(poner(TURNO.NOCHE, { actual: TURNO.LARGA }).allowed, false);
});

/* ───────── Cableado ───────── */

test("los tres botones viven en el espacio del menu Turnos", () => {
    const panel = html.slice(
        html.indexOf('id="turnosSidePanel"'),
        html.indexOf("</section>", html.indexOf('id="turnosSidePanel"'))
    );

    assert.match(panel, /data-add-turn="diurno"/);
    assert.match(panel, /data-add-turn="larga"/);
    assert.match(panel, /data-add-turn="noche"/);
});

test("y se ven igual que los de la columna de al lado", () => {
    // Las dos columnas del menu Turnos son la misma cosa -elegir algo y marcar
    // un dia-, asi que se leen como una sola lista: misma clase, misma caja y
    // el mismo hueco de 24px para el icono. Con dos formatos distintos parecian
    // dos controles que funcionan distinto.
    const panel = html.slice(
        html.indexOf('id="turnosSidePanel"'),
        html.indexOf("</section>", html.indexOf('id="turnosSidePanel"'))
    );

    assert.match(panel, /class="legend-list add-turn-panel"/);
    ["diurno", "larga", "noche"].forEach(turno => {
        assert.match(
            panel,
            new RegExp(`class="legend-action add-turn-button add-turn-button--${turno}"`)
        );
    });
    // El punto de color se centra DENTRO del hueco del icono en vez de
    // ocuparlo, o las etiquetas de las dos columnas quedarian desalineadas.
    assert.match(panel, /class="legend-dot add-turn-button__dot"/);
    assert.match(css, /\.add-turn-button__dot::before \{/);
});

test("sin titulo ni instrucciones encima", () => {
    // Los pidio fuera el usuario: la columna de al lado tampoco los tiene y el
    // texto separaba dos listas que son lo mismo.
    const panel = html.slice(
        html.indexOf('id="turnosSidePanel"'),
        html.indexOf("</section>", html.indexOf('id="turnosSidePanel"'))
    );

    assert.doesNotMatch(panel, /add-turn-panel__title|add-turn-panel__hint/);
    assert.doesNotMatch(css, /\.add-turn-panel__title|\.add-turn-panel__hint/);
});

test("el turno armado se sigue notando", () => {
    // Al compartir caja con los de permisos, el borde de "armado" es lo unico
    // que distingue el boton elegido.
    assert.match(css, /\.add-turn-button\.is-armed \{/);
    assert.match(css, /border-color: var\(--add-turn-color, var\(--accent\)\);/);
});

test("un boton pone un turno y despues el modo se apaga solo", () => {
    // Lo eligio el usuario: dejar el modo armado invita a marcar un dia sin
    // querer.
    assert.match(
        main,
        /async function handleAddTurnSelection\([\s\S]{0,900}\/\/ Un boton, un turno\.\s*\r?\n\s*clearSelectionMode\(\);/
    );
});

test("la casilla que se ilumina y el turno que se guarda salen del mismo sitio", () => {
    // Si el pintado usara una regla propia, podria iluminar una casilla que el
    // guardado despues rechaza.
    assert.match(calendar, /export function canAddTurnToDay\(/);
    assert.match(calendar, /export function addTurnToDay\(/);
    assert.match(
        calendar,
        /function canAddTurnToDay\([\s\S]{0,1200}return getAddTurnResult\(/
    );
    assert.match(
        calendar,
        /function addTurnToDay\([\s\S]{0,1200}getAddTurnResult\(/
    );
    assert.match(calendar, /if \(!result\.allowed\) return false;/);
});

test("un dia con permiso o devolucion de horas no se toca desde el boton", () => {
    assert.match(
        calendar,
        /function canAddTurnToDay\([\s\S]{0,900}tieneAusencia\(keyDay, admin, legal, comp, absences\) \|\|\s*\r?\n\s*hourReturns\?\.\[keyDay\]/
    );
});

test("guardar el turno pasa por el mismo sitio que la edicion directa", () => {
    // La cola de guardado (bitacora, respaldos de turno extra, marcas del reloj)
    // vive en una sola funcion: duplicarla dejaria basura en una de las dos vias.
    assert.match(calendar, /function commitCalendarTurnChange\(\{/);
    assert.match(calendar, /commitCalendarTurnChange\(\{[\s\S]{0,400}historyLabel: `Edicion directa/);
    assert.match(calendar, /commitCalendarTurnChange\(\{[\s\S]{0,400}historyLabel: `Turno agregado/);
});

/* ───────── Un turno manual reemplaza a otro turno manual ───────── */

test("Diurno reemplaza a una Larga puesta a mano", () => {
    // Diurno y Larga ocupan el mismo hueco del dia: no se suman, se reemplazan.
    const r = poner(TURNO.DIURNO, { actual: TURNO.LARGA, base: TURNO.LIBRE });

    assert.equal(r.allowed, true);
    assert.equal(r.nextVisibleTurn, TURNO.DIURNO);
});

test("Larga reemplaza a un Diurno puesto a mano", () => {
    const r = poner(TURNO.LARGA, { actual: TURNO.DIURNO, base: TURNO.LIBRE });

    assert.equal(r.allowed, true);
    assert.equal(r.nextVisibleTurn, TURNO.LARGA);
});

test("sobre una Larga de la ROTATIVA, el Diurno no hace nada", () => {
    // El turno base no se toca desde el calendario: es lo que protege tambien
    // la edicion directa.
    const r = poner(TURNO.DIURNO, { actual: TURNO.LARGA, base: TURNO.LARGA });

    assert.equal(r.allowed, false);
});

test("el reemplazo respeta el turno base y solo cambia lo manual", () => {
    // Dia de Noche por rotativa con un Diurno agregado a mano (D+N): al apretar
    // Larga se reemplaza SOLO el Diurno, la Noche de la rotativa se queda.
    const r = poner(TURNO.LARGA, {
        actual: TURNO.DIURNO_NOCHE,
        base: TURNO.NOCHE
    });

    assert.equal(r.allowed, true);
    assert.equal(r.nextVisibleTurn, TURNO.TURNO24);
});

test("la Noche sigue sumandose a una Larga manual en vez de reemplazarla", () => {
    // Noche y Larga NO ocupan el mismo hueco: ahi la suma sigue mandando.
    const r = poner(TURNO.NOCHE, { actual: TURNO.LARGA, base: TURNO.LIBRE });

    assert.equal(r.allowed, true);
    assert.equal(r.nextVisibleTurn, TURNO.TURNO24);
});

/* ───────── Quitar el turno extra desde la casilla ───────── */

test("con el switch de Editar apagado, la casilla ofrece quitar el turno extra", () => {
    // Ese click no hacia nada: era el hueco natural para el atajo. Con el switch
    // encendido se sigue ciclando como siempre.
    assert.match(
        calendar,
        /if \(!directEditEnabled\) \{[\s\S]{0,420}await offerManualExtraRemoval\(profileName, keyDay, options\);\s*\n\s*return;/
    );
});

test("solo se ofrece si el dia tiene algo puesto a mano", () => {
    assert.match(calendar, /function manualExtraForDay\(profileName, keyDay\)/);
    assert.match(calendar, /extra: getTurnoExtraAgregado\(effectiveBaseTurn, actual\)/);
    assert.match(
        calendar,
        /manualExtraForDay\(profileName, keyDay\);\s*\n\s*\n\s*if \(!extra\) return false;/
    );
});

test("quitar el extra devuelve la casilla a su turno base", () => {
    // Es lo mismo a lo que se llegaba dando vueltas al ciclo: el turno de la
    // rotativa, sin lo agregado a mano.
    assert.match(
        calendar,
        /nextTurn: effectiveBaseTurn,\s*\n\s*turnToStore: effectiveBaseTurn,/
    );
    // Y pasa por la misma cola de guardado que todo lo demas.
    assert.match(
        calendar,
        /function removeManualExtraTurn\([\s\S]{0,600}commitCalendarTurnChange\(\{/
    );
    assert.match(calendar, /historyLabel: `Turno extra quitado en \$\{keyDay\}`/);
});

test("el cuadro dice que se quita y pide confirmacion", () => {
    assert.match(calendar, /title: "Quitar turno extra"/);
    assert.match(calendar, /confirmText: "Quitar turno extra"/);
    assert.match(calendar, /if \(!confirmado\) return false;/);
});

/* ───────── El motivo se pide al momento de agregar el turno ───────── */

test("al agregar un turno se abre el modal de respaldo", () => {
    // Si el motivo se deja para despues hay que ir a buscar la casilla con el
    // "?" y casi nunca se completa.
    assert.match(
        main,
        /clearSelectionMode\(\);[\s\S]{0,1200}await openManualExtraReasonForDay\(profile, keyDay\);/
    );
    // Un turno PREASIGNADO pide el suyo por su propio camino: el de respaldos
    // guarda un respaldo del turno, y ahi el turno todavia no existe.
    assert.match(
        main,
        /if \(preasignar\) \{[\s\S]{0,700}await openPreassignmentReasonForDay\(profile, keyDay\);\s*\n\s*return;/
    );
    // Se abre DESPUES de apagar el modo: el modal no sale mientras haya una
    // seleccion activa (openExtraReasonDialog corta con window.selectionMode).
    assert.match(calendar, /if \(\(!pendingTurn && !options\.forceClock\) \|\| window\.selectionMode\)/);
});

test("el modal solo se abre si quedo un extra pendiente de respaldo", () => {
    assert.match(calendar, /export async function openManualExtraReasonForDay\(/);
    assert.match(
        calendar,
        /openManualExtraReasonForDay\([\s\S]{0,400}getPendingManualExtraTurn\([\s\S]{0,200}if \(!pendiente\) return false;/
    );
});

/* ───────── Quitar el extra tambien desde el modal ───────── */

test("el modal de respaldo trae el boton de quitar el turno extra", () => {
    assert.match(calendar, /data-action="remove-extra"/);
    // Solo cuando hay un turno extra agregado: sin el, no hay nada que quitar.
    assert.match(
        calendar,
        /\$\{hasManualSection \? `\s*\n\s*<button class="danger-button" type="button" data-action="remove-extra">/
    );
});

test("los dos caminos de quitar el extra usan la misma funcion", () => {
    assert.match(calendar, /function removeManualExtraTurn\(profileName, keyDay, options = \{\}\)/);
    // El cuadro que sale al hacer click en la casilla.
    assert.match(
        calendar,
        /if \(!confirmado\) return false;\s*\n\s*\n\s*return removeManualExtraTurn\(profileName, keyDay, options\);/
    );
    // Y el boton del modal.
    assert.match(
        calendar,
        /removeExtraButton\.onclick = async \(\) => \{[\s\S]{0,900}removeManualExtraTurn\(profileName, keyDay\);/
    );
});

test("quitar desde el modal cierra, pide confirmacion y se puede deshacer", () => {
    assert.match(
        calendar,
        /removeExtraButton\.onclick = async \(\) => \{[\s\S]{0,600}if \(!confirmado\) return;\s*\n\s*\n\s*close\(\);/
    );
    assert.match(
        calendar,
        /removeExtraButton\.onclick = async \(\) => \{[\s\S]{0,900}window\.pushUndoState\("Quitar turno extra"\)/
    );
});

// El cuerpo de openExtraReasonDialog, para poder exigir que algo viva DENTRO de
// ese modal y no en cualquier parte del archivo.
const SALTO = String.fromCharCode(10);

function cuerpoDelModalDeRespaldo() {
    const inicio = calendar.indexOf("async function openExtraReasonDialog(");

    assert.notEqual(inicio, -1, "no se encontro openExtraReasonDialog");

    const siguiente = calendar.indexOf(SALTO + "async function ", inicio + 1);
    const otra = calendar.indexOf(SALTO + "function ", inicio + 1);
    const fin = Math.min(
        siguiente === -1 ? calendar.length : siguiente,
        otra === -1 ? calendar.length : otra
    );

    return calendar.slice(inicio, fin);
}

test("el boton de quitar esta cableado DENTRO del modal de respaldo", () => {
    // Este es el error que hubo: el cableado cayo en el primer
    // "[data-action='cancel']" del archivo -el cuadro de reemplazos- y el boton
    // del modal quedo sin manejador, asi que al pulsarlo no pasaba nada.
    const modal = cuerpoDelModalDeRespaldo();

    assert.match(modal, /\[data-action='remove-extra'\]/);
    assert.match(modal, /removeManualExtraTurn\(profileName, keyDay\)/);

    // Y en ningun otro cuadro del archivo.
    const fuera = calendar.split(modal).join("");

    assert.doesNotMatch(fuera, /data-action='remove-extra'/);
});

test("quitar el turno extra cierra el modal", () => {
    // Dejarlo abierto pidiendo el motivo de un turno que acaba de irse fue justo
    // lo que se vio en pantalla.
    assert.match(
        cuerpoDelModalDeRespaldo(),
        /if \(!confirmado\) return;[\s\S]{0,20}close\(\);/
    );
});

test("cerrar sin motivo deja el dia pidiendolo", () => {
    assert.match(calendar, /Sin motivo a&uacute;n/);
    // Se repinta la casilla al salir: el modal pudo abrirse recien puesto el
    // turno, antes de que el calendario mostrara el "?".
    assert.match(
        cuerpoDelModalDeRespaldo(),
        /data-action='cancel'[\s\S]{0,80}close\(\);[\s\S]{0,40}void updateDayCell\(profileName, dateFromKeyDay\(keyDay\)\);/
    );
});

/* ───────── Respaldos que ya estaban puestos ───────── */

test("agregar otro tramo no borra el motivo del que ya estaba", () => {
    // Era el sintoma: con un Diurno ya respaldado, agregar la Noche (Diurno ->
    // D+N) anulaba TODOS los respaldos del dia y el modal volvia a pedir el
    // motivo del Diurno en blanco.
    assert.match(
        calendar,
        /function cancelManualExtraBackupsForTurnChange\([\s\S]{0,1200}turnoExtraCubreTurno\(\s*\n\s*nextTurn,/
    );
    assert.match(
        calendar,
        /turnoExtraCubreTurno\([\s\S]{0,120}codeToTurno\(replacement.turno\)[\s\S]{0,40}return replacement;/
    );
});

/* ───────── "Sin motivo aun" por tramo ───────── */

test("cada tramo tiene su propio Sin motivo aun", () => {
    assert.match(calendar, /data-skip-section="\${escapeHTML\(section.id\)}"/);
    assert.match(calendar, /const skippedSections = new Set\(\);/);
});

test("un tramo apartado no bloquea el guardado del otro", () => {
    assert.match(
        calendar,
        /const missingManualBackup = manualBackups.find\(backup =>[\s\S]{0,220}!skippedSections.has\(backup.section.id\)/
    );
});

test("solo se guarda el tramo que si tiene respaldo", () => {
    // Sin este filtro, el tramo apartado se guardaria con motivo vacio y el dia
    // dejaria de pedirlo.
    assert.match(
        calendar,
        /manualBackups\s*\n\s*.filter\(backup => backup.selectedMatch \|\| backup.reason\)/
    );
});

/* ───────── Detalle de un dia con DOS turnos extra ───────── */

test("el detalle muestra TODOS los turnos asignados del dia", () => {
    // Un D+N con su Diurno y su Noche respaldados por separado son dos
    // registros. Antes se abria solo el primero -[0] de la lista- y el segundo
    // no habia forma de verlo ni de anularlo desde el calendario.
    assert.match(
        calendar,
        /const records = replacementId[\s\S]{0,320}: getReplacementsForWorkerShift\(profileName, keyDay\);/
    );
    assert.match(calendar, /const multiple = records.length > 1;/);
});

test("cada turno del dia trae su propio Anular reemplazo", () => {
    assert.match(calendar, /data-replacement-id="\${escapeHTML\(String\(replacement.id \|\| ""\)\)}"/);
    // El manejador se ata por registro, no uno global.
    assert.match(
        calendar,
        /querySelectorAll\("\[data-action='undo'\]"\)[\s\S]{0,200}const replacement = records.find\(record =>/
    );
});

test("con un solo turno el cuadro se ve igual que siempre", () => {
    // El boton de anular sigue en el pie cuando hay uno solo.
    assert.match(calendar, /\${canEdit && !multiple \? `/);
    assert.match(
        calendar,
        /: replacementDetailRowsHTML\(records\[0\], profileName\)/
    );
});

test("tras anular uno, el detalle se reabre con los que quedan", () => {
    // Si no, habria que volver a buscar la casilla para anular el segundo.
    assert.match(
        calendar,
        /if \([\s\S]{0,120}multiple &&[\s\S]{0,120}getReplacementsForWorkerShift\(profileName, keyDay\).length[\s\S]{0,80}openReplacementDetailDialog\(profileName, keyDay\);/
    );
});

/* =========================================================
   Los mismos turnos, pero PREASIGNADOS

   "DIURNO/LARGA/NOCHE PREASIGNADO" ponen el mismo turno que sus gemelos, pero
   como reserva: la casilla se pinta y el turno NO viaja a la aplicacion del
   trabajador hasta que se confirme. Es la misma reserva que ya se hacia desde
   el cuadro de sugerencias de reemplazo, sin un ausente a quien cubrir.
========================================================= */

test("los tres botones preasignados viven junto a los otros tres", () => {
    const panel = html.slice(
        html.indexOf('id="turnosSidePanel"'),
        html.indexOf("</section>", html.indexOf('id="turnosSidePanel"'))
    );

    assert.match(panel, /data-add-turn="diurno-pre"/);
    assert.match(panel, /data-add-turn="larga-pre"/);
    assert.match(panel, /data-add-turn="noche-pre"/);
    assert.match(panel, />DIURNO PREASIGNADO</);
    assert.match(panel, />LARGA PREASIGNADO</);
    assert.match(panel, />NOCHE PREASIGNADO</);
});

test("se distinguen de los otros sin leer la etiqueta", () => {
    // Uno debajo del otro y con el mismo color, la etiqueta seria lo unico que
    // los separa. El punto hueco dice "reservado, no puesto".
    assert.match(css, /\.add-turn-button--pre \.add-turn-button__dot::before \{/);
    assert.match(css, /box-shadow: inset 0 0 0 2\.5px var\(--add-turn-color, var\(--muted\)\);/);
});

test("el turno preasignado NO se publica: se guarda aparte", () => {
    // preassignments vive fuera de los reemplazos a proposito, para que ni el
    // motor de horas ni la proyeccion lo vean.
    assert.match(calendar, /export function addPreassignedTurnToDay\(/);
    assert.match(calendar, /addPreassignment\(\{[\s\S]{0,220}replaced: "",/);
    assert.match(main, /addPreassignedTurnToDay\(profile, keyDay, turno, \{/);
});

test("cabe donde cabria el turno de verdad, ni mas ni menos", () => {
    // Sale del MISMO getAddTurnResult que usa el boton normal: una casilla que
    // se ilumina para uno se ilumina para el otro, o el supervisor veria
    // iluminada una casilla que despues rechaza la reserva.
    const bloque = calendar.slice(
        calendar.indexOf("export function addPreassignedTurnToDay(")
    ).slice(0, 1600);

    assert.match(bloque, /const result = getAddTurnResult\(/);
    assert.match(bloque, /if \(!result\.allowed\) return false;/);
});

test("el boton armado no se confunde con el de su mismo turno", () => {
    // "Noche" y "Noche preasignado" ponen el mismo turno: sin mirar tambien el
    // modo, apretar uno marcaba los dos.
    assert.match(main, /const armadoPre = Boolean\(window\.pendingAddTurnPreassign\);/);
    assert.match(
        main,
        /const activo = opcion\.turno === armado &&\s*\n\s*Boolean\(opcion\.preassign\) === armadoPre;/
    );
    // Y al apagar cualquier modo de seleccion se limpia con lo demas.
    assert.match(main, /window\.pendingAddTurnPreassign = false;/);
});

test("la casilla preasignada se pinta sumando al turno del dia", () => {
    // Antes solo se pintaba en un dia LIBRE, asi que preasignar sobre un dia
    // con turno no se veia por ninguna parte. Sigue siendo solo pintura.
    assert.match(
        calendar,
        /const preassignDisplayTurn = preassignedWorker\s*\n\s*\? turnoDesdeComponentes\(\[/
    );
});

test("dos preasignaciones sueltas del mismo dia no se pisan", () => {
    // El filtro por (ausente, dia) borraba la de OTRO trabajador cuando no hay
    // ausente: todas comparten `replaced` vacio.
    localStorage.clear();

    addPreassignment({ worker: "Ana", replaced: "", keyDay: "2026-7-13", turno: TURNO.NOCHE });
    addPreassignment({ worker: "Bruno", replaced: "", keyDay: "2026-7-13", turno: TURNO.NOCHE });

    assert.equal(getPreassignments().length, 2);
});

test("pero el mismo turno del mismo dia no se duplica", () => {
    localStorage.clear();

    addPreassignment({ worker: "Ana", replaced: "", keyDay: "2026-7-13", turno: TURNO.NOCHE });
    addPreassignment({ worker: "Ana", replaced: "", keyDay: "2026-7-13", turno: TURNO.NOCHE });

    assert.equal(getPreassignments().length, 1);
});

test("y dos turnos distintos del mismo dia conviven y se suman", () => {
    localStorage.clear();

    addPreassignment({ worker: "Ana", replaced: "", keyDay: "2026-7-13", turno: TURNO.LARGA });
    addPreassignment({ worker: "Ana", replaced: "", keyDay: "2026-7-13", turno: TURNO.NOCHE });

    assert.equal(getPreassignments().length, 2);
    assert.equal(
        getPreassignmentTurnForWorker("Ana", "2026-7-13"),
        TURNO.TURNO24
    );
});

test("confirmar un preasignado sin ausente aplica el turno de verdad", () => {
    // Un reemplazo sin reemplazado seria un registro que no describe lo que
    // paso: se aplica por el mismo camino que el boton normal.
    assert.match(calendar, /async function confirmStandalonePreassignment\(/);
    assert.match(calendar, /const aplicado = addTurnToDay\(worker, keyDay, Number\(turno\) \|\| 0, \{/);
    assert.match(calendar, /removePreassignment\(id\);/);
    // Y si el dia cambio mientras esperaba, la reserva se queda.
    assert.match(calendar, /if \(!aplicado\) \{[\s\S]{0,220}return;/);
});

test("el modal no habla de un reemplazado que no existe", () => {
    assert.match(calendar, /\$\{replaced\s*\n\s*\? `<div><span>Reemplaza a<\/span>/);
    assert.match(calendar, /NO se\s*\n\s*publica a la aplicacion del trabajador/);
});

/* =========================================================
   El motivo de horas extra de una reserva

   Se pide al preasignar -que es cuando el supervisor sabe por que lo hace-, se
   puede dejar para despues, y al confirmar el turno se convierte en su
   respaldo. Si sigue sin motivo, se vuelve a preguntar en ese momento.
========================================================= */

test("el motivo vive en la reserva, no como respaldo del turno", () => {
    // El respaldo (`manual_extra`) es de un turno que todavia no existe.
    localStorage.clear();

    const reserva = addPreassignment({
        worker: "Ana",
        replaced: "",
        keyDay: "2026-7-13",
        turno: TURNO.NOCHE,
        reason: "Apoyo urgencia"
    });

    assert.equal(reserva.reason, "Apoyo urgencia");
    assert.equal(getPreassignments()[0].reason, "Apoyo urgencia");
});

test("se puede crear sin motivo y definirlo despues", () => {
    localStorage.clear();

    const reserva = addPreassignment({
        worker: "Ana",
        replaced: "",
        keyDay: "2026-7-13",
        turno: TURNO.NOCHE
    });

    assert.equal(reserva.reason, "");
    assert.equal(setPreassignmentReason(reserva.id, "  Apoyo TAC  "), true);
    assert.equal(getPreassignments()[0].reason, "Apoyo TAC");
    // Una reserva que ya no existe no revienta.
    assert.equal(setPreassignmentReason("no-existe", "x"), false);
});

test("se pregunta al preasignar, con los mismos motivos guardados", () => {
    assert.match(calendar, /function openPreassignmentReasonDialog\(\{ profile, keyDay, preassignment \}\)/);
    assert.match(calendar, /export async function openPreassignmentReasonForDay\(/);
    assert.match(calendar, /const presets = getManualExtraReasonPresets\(\);/);
    // Y se puede salir sin poner nada.
    assert.match(calendar, /data-action="later">Definir después</);
});

test("desde la casilla se vuelve al motivo si quedo pendiente", () => {
    assert.match(calendar, /data-action="reason">\$\{\s*\n?\s*preassignment\.reason \? "Cambiar motivo" : "Definir motivo"/);
    assert.match(calendar, /<div><span>Motivo<\/span><b>\$\{/);
    assert.match(calendar, /<em>Sin definir<\/em>/);
});

test("al confirmar, el motivo anotado pasa a ser el respaldo del turno", () => {
    const bloque = calendar.slice(
        calendar.indexOf("async function confirmStandalonePreassignment(")
    ).slice(0, 2200);

    assert.match(bloque, /const motivo = String\(preassignment\.reason \|\| ""\)\.trim\(\);/);
    assert.match(bloque, /if \(motivo\) \{[\s\S]{0,320}source: "manual_extra"/);
    // Y si se dejo para despues y sigue sin motivo, se pregunta ahi.
    assert.match(bloque, /await openManualExtraReasonForDay\(worker, keyDay\);/);
});

test("el respaldo del preasignado no agrega un turno por su cuenta", () => {
    // El turno ya lo puso addTurnToDay; este registro solo lo justifica.
    const bloque = calendar.slice(
        calendar.indexOf("async function confirmStandalonePreassignment(")
    ).slice(0, 2200);

    assert.match(bloque, /addsShift: false/);
});
