// Repartir un turno entre VARIOS desde el modal de sugerencias.
//
// Para poner a mas de una persona en un mismo turno habia que hacer un rodeo:
// asignar al primero, irse a SU calendario, recortarle el marcaje y recien ahi
// el aviso ofrecia buscar al segundo. Tres pantallas para una sola decision, y
// solo servia para dos.
//
// Con el ajuste de la unidad encendido, las filas del modal pasan a ser
// casillas y nada se guarda hasta apretar "Aceptar": se eligen los que sean y
// se reparte el turno en partes iguales.
//
// La regla de fondo: el turno es una TIRA CONTINUA de bloques, y los relojes se
// mueven de media hora en media hora. Por eso el traslape no se valida, es
// IMPOSIBLE de construir. La aritmetica de esa tira vive en
// tests/reparto-bloques-turno.test.mjs; aqui se fija el cableado del cuadro.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const leer = async name => (await readFile(
    new URL(name, import.meta.url), "utf8"
)).replace(/\r\n/g, "\n");

const calendar = await leer("../js/calendar.js");
const styles = await leer("../styles.css");

/** El cuerpo de una funcion, contando llaves. */
function cuerpo(nombre) {
    const start = calendar.indexOf(`function ${nombre}(`);

    assert.notEqual(start, -1, `no se encontro: ${nombre}`);

    // El cuerpo empieza DESPUES de la lista de parametros. Si la firma
    // destructura -openCoverSplitDialog({ workers, ... })- el primer "{" es el
    // del parametro y el conteo de llaves cerraba ahi mismo, devolviendo solo
    // la firma. Con eso, un `doesNotMatch` sobre el "cuerpo" pasaba siempre sin
    // mirar nada.
    const abreParen = calendar.indexOf("(", start);
    let parens = 0;
    let cierraParen = abreParen;

    for (; cierraParen < calendar.length; cierraParen += 1) {
        if (calendar[cierraParen] === "(") parens += 1;
        else if (calendar[cierraParen] === ")") {
            parens -= 1;

            if (!parens) break;
        }
    }

    const open = calendar.indexOf("{", cierraParen);
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
   Cuando aplica
========================================================= */

test("lo enciende el ajuste de la unidad, no otra cosa", () => {
    assert.match(
        calendar,
        /const splitMode =\s*\n\s*getTurnChangeConfig\(\)\.allowSplitShiftCoverage === true;/
    );
});

test("es excluyente con los otros modos y con el tramo suelto", () => {
    // En solicitar y en preasignar una casilla marcada ya significa otra cosa.
    // Y viniendo a tapar un hueco, las horas que faltan ya estan decididas:
    // elegir a varios repartiria el hueco, no el turno. En un cupo de rotativa
    // no hay nadie ausente de quien repartir el turno.
    assert.match(
        calendar,
        /const isSplitMode =\s*\n\s*splitMode &&\s*\n\s*!isRequestMode &&\s*\n\s*!preassignMode &&\s*\n\s*!coverWindow &&\s*\n\s*!rota;/
    );
});

/* =========================================================
   Sin tope de personas
========================================================= */

test("ya no hay tope de dos", () => {
    // El limite real es el reloj: a cada uno le tiene que quedar al menos el
    // minimo, y eso lo decide la tira, que es la unica que conoce el largo del
    // turno.
    assert.doesNotMatch(calendar, /selectedCoverWorkers\.size >= 2/);
    assert.doesNotMatch(calendar, /se reparte entre 2 trabajadores como máximo/);
});

test("la tira se arma para TANTOS como se eligieron", () => {
    assert.match(
        calendar,
        /let segments = coverShiftSegments\(shiftWindow, workers\);/
    );
});

test("si no alcanza para todos, lo dice y no abre el cuadro", () => {
    assert.match(
        calendar,
        /deja tramos de menos de \$\{COVER_MIN_TRAMO\} minutos/
    );
});

/* =========================================================
   Las filas del modal pasan a ser casillas
========================================================= */

test("la fila del reparto es una casilla, no un boton", () => {
    assert.match(calendar, /data-cover-worker="\$\{escapeHTML\(candidate\.profile\.name\)\}"/);
    assert.match(calendar, /class="replacement-candidate-checkbox"/);
});

test("y lleva los mismos data-* que el boton de asignar directo", () => {
    // El guardado reusa los mismos ayudantes, que solo leen el dataset y no
    // les importa de que elemento cuelgue. Sin el id de la unidad enlazada, por
    // ejemplo, un prestamo se guardaria como si fuera gente de la casa.
    const fila = calendar.slice(
        calendar.indexOf("if (isSplitMode) {"),
        calendar.indexOf("if (isRequestMode) {")
    );

    assert.match(fila, /data-worker="/);
    assert.match(fila, /data-worker-profile-id="/);
    assert.match(fila, /data-worker-workspace-id="/);
    assert.match(fila, /data-worker-link-id="/);
    assert.match(fila, /replacementCandidateCoverageAttrs\(candidate\)/);
});

test("el clic directo quedo acotado a los BOTONES", () => {
    // Esta es la trampa del cambio: la casilla lleva `data-worker` para que los
    // ayudantes la lean igual, y con el selector a secas marcarla disparaba la
    // asignacion directa y cerraba el cuadro -justo lo que este modo evita-.
    assert.match(calendar, /querySelectorAll\("button\[data-worker\]"\)/);
    assert.doesNotMatch(calendar, /querySelectorAll\("\[data-worker\]"\)/);
});

/* =========================================================
   El boton de aceptar
========================================================= */

test("existe solo en este modo y cuenta a los elegidos", () => {
    assert.match(calendar, /const acceptSplitButton = isSplitMode/);
    assert.match(calendar, /data-action="accept-split"/);
    assert.match(calendar, /Aceptar \(\$\{coverSelectedCount\}\)/);
});

test("en cero no se puede apretar", () => {
    assert.match(
        calendar,
        /data-action="accept-split" \$\{coverSelectedCount \? "" : "disabled"\}/
    );
});

test("va DESPUES del boton de enviar solicitudes", () => {
    // El pie del modal tiene una prueba que exige que el de enviar sea el
    // primero (tests/modal-reemplazo-solicitud.test.mjs). Y no puede ir en un
    // div propio: tests/modal-reemplazo-cerrar.test.mjs recorta el pie hasta el
    // primer </div> y perderia de vista las acciones del permiso.
    assert.match(
        calendar,
        /\$\{sendSelectedButton\}\s*\n\s*\$\{acceptSplitButton\}\s*\n\s*\$\{rota \? "" : leaveActions\}/
    );
});

/* =========================================================
   Los relojes se mueven a pasos, no se escriben
========================================================= */

test("ya no se tipea una hora", () => {
    // Escribir a mano es lo que permitia construir un traslape. El cuadro dejo
    // de tener campos de hora: solo botones de media hora.
    const dialogo = cuerpo("openCoverSplitDialog");

    assert.doesNotMatch(dialogo, /type="time"/);
    assert.match(styles, /\.cover-split-step \{/);
});

test("la SALIDA arrastra al vecino", () => {
    // Los dos siguen pegados: por aqui no se puede abrir un hueco.
    assert.match(
        calendar,
        /segments = coverStepBoundary\(\s*\n\s*segments,\s*\n\s*Number\(boton\.dataset\.coverLimite\),/
    );
});

test("la ENTRADA se despega y abre el hueco", () => {
    assert.match(
        calendar,
        /segments = coverOpenGapBefore\(\s*\n\s*segments,\s*\n\s*Number\(boton\.dataset\.coverEntrada\),/
    );
});

test("en el ultimo bloque no hay salida que mover", () => {
    // Mover el limite del ultimo seria mover el fin del turno, que no es de
    // este cuadro.
    assert.match(
        calendar,
        /\$\{paso\("limite", index, -1, index < segments\.length - 1\)\}/
    );
});

/* =========================================================
   El hueco es un bloque mas
========================================================= */

test("el hueco se ve, con sus horas", () => {
    assert.match(calendar, /class="cover-split-row cover-split-row--gap/);
    assert.match(
        calendar,
        /Sin cubrir de \$\{escapeHTML\(hora\(segment\.desde\)\)\} a \$\{escapeHTML\(hora\(segment\.hasta\)\)\}/
    );
});

test("y lleva encima las dos decisiones posibles", () => {
    assert.match(calendar, /data-cover-fill="\$\{index\}"/);
    assert.match(calendar, /data-cover-nocov="\$\{index\}"/);
});

test("elegir a alguien para el hueco VUELVE al mismo cuadro", () => {
    // Nada se guarda: el bloque queda ocupado y se sigue ajustando el turno
    // completo antes de confirmar. Lo eligio el usuario asi.
    assert.match(calendar, /const elegido = await pickWorker\?\.\(/);
    assert.match(calendar, /segments\[index\]\.worker = elegido;/);
    assert.match(
        calendar,
        /function openCoverWorkerPicker\(nombres\)/
    );
    assert.match(calendar, /data-cover-pick="\$\{escapeHTML\(nombre\)\}"/);
});

test("al selector no se le ofrece a quien ya esta en la tira", () => {
    assert.match(
        calendar,
        /!yaPuestos\.includes\(nombre\) &&/
    );
});

test("ni gente de unidades enlazadas, que no admite tramos", () => {
    assert.match(
        calendar,
        /!porNombre\.get\(nombre\)\.dataset\.workerWorkspaceId/
    );
});

/* =========================================================
   Intercambiar: boton, toque y arrastre
========================================================= */

test("lo que se mueve es la PERSONA, no las horas", () => {
    // Los relojes son casillas fijas: lo que permutan las tres formas de
    // intercambiar es quien esta en cada bloque.
    const dialogo = cuerpo("openCoverSplitDialog");

    assert.match(dialogo, /uno\.worker = otro\.worker;/);
    assert.match(dialogo, /otro\.worker = nombre;/);
});

test("el boton de intercambiar aparece SOLO cuando son dos", () => {
    // Con tres o mas, "intercambiar" no dice a quien con quien: ahi el camino
    // es tomar uno y soltarlo sobre otro. Se cuentan los bloques CON gente: un
    // hueco no es alguien con quien permutar.
    assert.match(
        calendar,
        /segments\.filter\(segment => segment\.worker\)\.length === 2/
    );
});

test("tocar un nombre y luego otro los permuta", () => {
    // Es el UNICO camino que funciona en el celular: el arrastre del navegador
    // no existe en pantallas tactiles.
    assert.match(calendar, /data-cover-take="\$\{index\}"/);
    assert.match(calendar, /intercambiar\(tomado, index\);/);
});

test("y arrastrar hace lo mismo, en el computador", () => {
    assert.match(calendar, /draggable="true"/);
    assert.match(calendar, /row\.ondragstart = event => \{/);
    assert.match(calendar, /row\.ondrop = event => \{/);
});

/* =========================================================
   Lo que pasa al aceptar
========================================================= */

test("con uno solo cubre el turno entero, como siempre", () => {
    // No hay nada que repartir ni horas que pedir: es el camino de toda la
    // vida, y por eso pasa por el MISMO aplicador.
    assert.match(
        calendar,
        /if \(elegidos\.length === 1\) \{\s*\n\s*await applyCandidate\(elegidos\[0\]\);/
    );
});

test("la ventana a repartir sale del TURNO, no de la ficha del ausente", () => {
    // El ausente justamente no trabaja ese dia: leer sus segmentos daria el
    // permiso, no la franja que hay que cubrir.
    assert.match(
        calendar,
        /windowFromIntervals\(\s*\n\s*getScheduledSegmentsForState\(date, neededTurn, holidays\)\s*\n\s*\)/
    );
});

test("el guardado busca a cada uno por NOMBRE, no por posicion", () => {
    // Desde el cuadro se puede sumar gente para un hueco, asi que la lista que
    // vuelve ya no calza uno a uno con las casillas marcadas. Emparejarlas por
    // indice le habria guardado a alguien el tramo de otro.
    assert.match(calendar, /const porNombre = new Map\(/);
    assert.match(calendar, /const input = porNombre\.get\(tramo\.worker\);/);
});

test("cada uno guarda su propio tramo", () => {
    assert.match(
        calendar,
        /await applyCandidate\(input, \{\s*\n\s*coverWindow: \{\s*\n\s*from: tramo\.from,\s*\n\s*until: tramo\.until/
    );
});

test("el cuadro se cierra UNA vez, con el ultimo", () => {
    // Cerrando con el primero, los demas se quedaban sin guardar.
    assert.match(calendar, /deferClose: index < tramos\.length - 1/);
    assert.match(calendar, /if \(!options\.deferClose\) close\(\);/);
});

test("volver no guarda nada", () => {
    assert.match(calendar, /if \(!reparto\) return;/);
});

test("las unidades enlazadas quedan fuera del reparto por horas", () => {
    // Un prestamo entre unidades se registra en las dos y su creacion no lleva
    // tramo. Antes que guardarlo mal, se dice que no se puede -mismo criterio
    // que la preasignacion-.
    assert.match(
        calendar,
        /El reparto por horas no está disponible para trabajadores de unidades enlazadas\./
    );
});

test("queda registrado quien cubre que tramo", () => {
    assert.match(calendar, /"Repartio un turno entre varios"/);
});

/* =========================================================
   Por cada hueco se decide
========================================================= */

test("lo resuelto EN el cuadro no se vuelve a preguntar", () => {
    // El supervisor ya dijo que esas horas no necesitan a nadie.
    assert.match(
        calendar,
        /reparto\.gaps\s*\n\s*\.filter\(gap => gap\.noCoverage\)/
    );
    assert.match(calendar, /setNoCoverageDay\(\s*\n\s*profileName,\s*\n\s*keyDay,\s*\n\s*true,/);
});

test("y por lo que quedo sin decidir, se pregunta", () => {
    assert.match(
        calendar,
        /async function askCoverageForRemainingGaps\(profileName, keyDay, shiftWindow\)/
    );
    assert.match(
        calendar,
        /await askCoverageForRemainingGaps\(\s*\n\s*profileName,\s*\n\s*keyDay,\s*\n\s*shiftWindow\s*\n\s*\)/
    );
});

test("con las MISMAS tres salidas del aviso del marcaje", () => {
    const bloque = cuerpo("askCoverageForRemainingGaps");

    assert.match(bloque, /confirmText: "Buscar quién puede cubrir"/);
    assert.match(bloque, /cancelText: "Decidir más tarde"/);
    assert.match(bloque, /\{ text: "No requiere cobertura", value: "no-coverage" \}/);
    // Marcarlo sin cobertura tambien libera el permiso hacia la PWA.
    assert.match(bloque, /releaseLeaveHoldsForCoverage\(profileName\);/);
});

test("al abrir las sugerencias del hueco, deja de preguntar", () => {
    // Ese cuadro toma el control del tramo: encadenar otra pregunta encima
    // dejaria dos modales peleando.
    const bloque = cuerpo("askCoverageForRemainingGaps");

    assert.match(
        bloque,
        /await openReplacementDialog\(profileName, keyDay, \{\s*\n\s*coverWindow: gap,\s*\n\s*shiftWindow\s*\n\s*\}\);\s*\n\s*return;/
    );
});

/* =========================================================
   Que se pueda usar en el celular
========================================================= */

test("el cuadro se adapta a una pantalla angosta", () => {
    assert.match(styles, /\.cover-split-row \{/);
    assert.match(styles, /\.cover-split-worker \{/);
    assert.match(styles, /\.cover-split-row--gap \{/);
    assert.match(
        styles,
        /@media \(max-width: 480px\) \{\s*\n\s*\.cover-split-row \{/
    );
});
