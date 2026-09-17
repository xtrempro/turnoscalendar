// Dos funcionarios cubriendo un mismo turno.
//
// A quien cubre un permiso se le puede recortar la jornada: entra a las 08:00 y
// se va a las 13:00 de una Larga que llega hasta las 20:00. Esas horas no las
// hace nadie, asi que el turno vuelve a pedir cobertura por ese tramo y se
// puede repartir con un segundo trabajador.
//
// Hasta ahora bastaba UN reemplazo para dar el turno por cubierto y apagar el
// "!". Lo que fija este archivo es la regla nueva -cubierto ENTERO- y que los
// reemplazos de siempre, que no llevan tramo, sigan cubriendo todo el turno.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
    coverWindowFromRecord,
    coverWindowLabel,
    coverageGapsForShift,
    coveredShiftIsComplete,
    normalizeCoverTime,
    shiftIsFullyCovered
} = await import("../js/shiftCoverage.js");

const leer = async name => (await readFile(
    new URL(name, import.meta.url), "utf8"
)).replace(/\r\n/g, "\n");

const LARGA = { from: "08:00", until: "20:00" };
const NOCHE = { from: "20:00", until: "08:00" };

const tramo = (from, until) => ({
    coverFrom: from,
    coverUntil: until,
    shiftFrom: LARGA.from,
    shiftUntil: LARGA.until
});

/* =========================================================
   La regla: cubierto ENTERO
========================================================= */

test("sin reemplazos el turno no esta cubierto", () => {
    assert.equal(shiftIsFullyCovered(LARGA, []), false);
});

test("un reemplazo SIN tramo cubre el turno entero", () => {
    // Es como se comportaron siempre: todos los reemplazos ya guardados no
    // llevan horario y tienen que seguir cubriendo todo.
    assert.equal(shiftIsFullyCovered(LARGA, [{ worker: "Tania" }]), true);
    assert.deepEqual(coverageGapsForShift(LARGA, [{ worker: "Tania" }]), []);
});

test("recortada la jornada, quedan horas sin cubrir", () => {
    const records = [tramo("08:00", "13:00")];

    assert.deepEqual(
        coverageGapsForShift(LARGA, records),
        [{ from: "13:00", until: "20:00" }]
    );
    assert.equal(shiftIsFullyCovered(LARGA, records), false);
});

test("con el segundo trabajador el turno queda cubierto", () => {
    const records = [tramo("08:00", "13:00"), tramo("13:00", "20:00")];

    assert.deepEqual(coverageGapsForShift(LARGA, records), []);
    assert.equal(shiftIsFullyCovered(LARGA, records), true);
});

test("dos tramos que se superponen tambien cubren", () => {
    const records = [tramo("08:00", "14:00"), tramo("13:00", "20:00")];

    assert.deepEqual(coverageGapsForShift(LARGA, records), []);
});

test("un hueco en medio se ve como tal", () => {
    const records = [tramo("08:00", "11:00"), tramo("15:00", "20:00")];

    assert.deepEqual(
        coverageGapsForShift(LARGA, records),
        [{ from: "11:00", until: "15:00" }]
    );
});

test("el turno de noche cruza la medianoche sin romperse", () => {
    // 20:00 a 08:00: el tramo cubierto termina a medianoche y lo que falta es
    // de 00:00 a 08:00, no un rango negativo.
    const records = [{
        coverFrom: "20:00",
        coverUntil: "00:00",
        shiftFrom: NOCHE.from,
        shiftUntil: NOCHE.until
    }];

    assert.deepEqual(
        coverageGapsForShift(NOCHE, records),
        [{ from: "00:00", until: "08:00" }]
    );
});

test("sin horario de turno conocido, cualquier reemplazo cubre", () => {
    // Un dato que falte nunca puede hacer aparecer un "!" que antes no estaba.
    assert.equal(shiftIsFullyCovered(null, [{ worker: "Tania" }]), true);
    assert.equal(coveredShiftIsComplete([{ worker: "Tania" }]), true);
});

test("la ventana del turno sale de los propios reemplazos", () => {
    assert.equal(coveredShiftIsComplete([tramo("08:00", "13:00")]), false);
    assert.equal(
        coveredShiftIsComplete([
            tramo("08:00", "13:00"),
            tramo("13:00", "20:00")
        ]),
        true
    );
});

/* =========================================================
   Lecturas y rotulos
========================================================= */

test("las horas se normalizan y lo invalido se descarta", () => {
    assert.equal(normalizeCoverTime("8:00"), "08:00");
    assert.equal(normalizeCoverTime("08:00"), "08:00");
    assert.equal(normalizeCoverTime("25:00"), "");
    assert.equal(normalizeCoverTime("ocho"), "");
    assert.equal(normalizeCoverTime(""), "");
});

test("un tramo a medio escribir no cuenta como tramo", () => {
    // Con una sola punta no se puede medir nada: el reemplazo cubre el turno
    // entero, que es lo seguro.
    assert.equal(coverWindowFromRecord({ coverFrom: "08:00" }), null);
    assert.equal(coverWindowFromRecord({}), null);
    assert.deepEqual(
        coverWindowFromRecord({ coverFrom: "8:00", coverUntil: "13:00" }),
        { from: "08:00", until: "13:00" }
    );
});

test("el rotulo dice desde y hasta", () => {
    assert.equal(
        coverWindowLabel({ from: "08:00", until: "13:00" }),
        "desde las 08:00 hasta las 13:00"
    );
    assert.equal(coverWindowLabel(null), "");
});

/* =========================================================
   El ajuste de la unidad
========================================================= */

test("el ajuste existe, apagado por omision", async () => {
    const storage = await leer("../js/storage.js");

    assert.match(storage, /allowSplitShiftCoverage: false,/);
    assert.match(
        storage,
        /allowSplitShiftCoverage:\s*\n\s*config\.allowSplitShiftCoverage === true,/
    );
});

test("y se ve en Configuracion, pestaña Turnos", async () => {
    const settings = await leer("../js/systemSettings.js");

    assert.match(settings, /id: "settingsAllowSplitShiftCoverage"/);
    assert.match(
        settings,
        /title: "Permitir cubrir un mismo turno con 2 funcionarios"/
    );
    assert.match(settings, /checked: config\.allowSplitShiftCoverage/);
    assert.match(
        settings,
        /allowSplitShiftCoverage:\s*\n\s*hasInput\("settingsAllowSplitShiftCoverage"\)/
    );
});

/* =========================================================
   El cableado
========================================================= */

test("sin el ajuste no se ofrece nada", async () => {
    const calendar = await leer("../js/calendar.js");
    const bloque = calendar.slice(
        calendar.indexOf("export async function offerSplitShiftCoverage(")
    ).slice(0, 600);

    assert.match(
        bloque,
        /if \(!getTurnChangeConfig\(\)\.allowSplitShiftCoverage\) return false;/
    );
});

test("se pregunta al guardar el marcaje, con tres salidas", async () => {
    const [calendar, main] = await Promise.all([
        leer("../js/calendar.js"),
        leer("../js/main.js")
    ]);

    // El enganche: despues de guardar el marcaje del turno extra.
    assert.match(
        main,
        /await offerSplitShiftCoverage\(profile, keyDay, fecha, holidays\);/
    );
    assert.match(calendar, /title: "Horas del turno sin cubrir"/);
    assert.match(calendar, /confirmText: "Buscar quién puede cubrir"/);
    assert.match(calendar, /cancelText: "Decidir más tarde"/);
    assert.match(
        calendar,
        /\{ text: "No requiere cobertura", value: "no-coverage" \}/
    );
});

test("cada salida hace lo suyo", async () => {
    const calendar = await leer("../js/calendar.js");

    // "No requiere cobertura" apaga el "!" y libera el permiso.
    assert.match(calendar, /setNoCoverageDay\(replaced, keyDay, true,/);
    assert.match(calendar, /releaseLeaveHoldsForCoverage\(replaced\);/);
    // "Buscar quien puede cubrir" abre las sugerencias para el TRAMO.
    assert.match(
        calendar,
        /await openReplacementDialog\(replaced, keyDay, \{\s*\n\s*coverWindow: gap,/
    );
    // "Decidir mas tarde" no hace nada: el "!" se queda.
    assert.match(calendar, /if \(action !== "confirm"\) return false;/);
});

test("el tramo cubierto queda anotado en el reemplazo", async () => {
    const [calendar, replacements] = await Promise.all([
        leer("../js/calendar.js"),
        leer("../js/replacements.js")
    ]);

    assert.match(
        replacements,
        /export function setReplacementCoverWindow\(replacementId, window = \{\}\)/
    );
    assert.match(calendar, /setReplacementCoverWindow\(covering\.id, sameWindow/);
    // Y al elegir al segundo, su reemplazo nace con el tramo.
    assert.match(calendar, /\.\.\.coverWindowPayload/);
});

test("el segundo trabajador queda con el horario del tramo", async () => {
    const calendar = await leer("../js/calendar.js");

    assert.match(
        calendar,
        /function writeCoverWindowClockMark\(worker, keyDay, date, window, holidays\)/
    );
    assert.match(calendar, /if \(coverWindow\) \{\s*\n\s*writeCoverWindowClockMark\(/);
});

test("el reemplazo que dejo el hueco no bloquea las sugerencias", async () => {
    // Sin esto, el cuadro se negaba a abrir: ya existia un reemplazo del turno.
    //
    // No basta con eximir el caso en que el tramo llega por parametro: al
    // apretar el "!" no llega ninguno, y ahi el cuadro volvia a negarse. Por eso
    // la guarda mide cubierto ENTERO, que es la misma regla del badge.
    const calendar = await leer("../js/calendar.js");

    assert.match(
        calendar,
        /const existing = \(\s*\n\s*rota \|\|\s*\n\s*coverWindow \|\|\s*\n\s*!coveredShiftIsFullyCovered\(profileName, keyDay\)\s*\n\s*\)\s*\n\s*\? null/
    );
});

/* =========================================================
   Donde tiene que verse
========================================================= */

test("las siete superficies miden cubierto ENTERO", async () => {
    // Si una sola se queda con la regla vieja, un turno a medio cubrir aparece
    // resuelto en un lado y pendiente en el otro.
    const archivos = await Promise.all([
        "../js/calendar.js",
        "../js/timeline.js",
        "../js/home.js",
        "../js/autoCoverage.js",
        "../js/serverAutoCoverage.js"
    ].map(leer));

    archivos.forEach((source, index) => {
        assert.match(
            source,
            /coveredShiftIsFullyCovered\(|coveredShiftIsComplete\(/,
            `el archivo ${index} tiene que usar la regla nueva`
        );
    });

    // El motor de permisos tambien: mientras queden horas sin cubrir, el
    // permiso sigue escondido para el trabajador.
    const leaveHold = await leer("../js/leaveHold.js");

    assert.match(leaveHold, /coveredShiftIsComplete\(/);
    assert.match(
        leaveHold,
        /const takenByReplacement = coveredShiftIsComplete\(/
    );
});

/* =========================================================
   Que el aviso lleve a alguna parte

   Las dos salidas que ofrecen buscar a un segundo trabajador terminaban en
   nada: el modal se cerraba y no se abria el de sugerencias.
========================================================= */

test("la seleccion se limpia ANTES de ofrecer el reparto", async () => {
    // openReplacementDialog no se abre con un modo de seleccion activo. Como
    // el marcaje se guarda dentro de una seleccion y esta se limpiaba al final,
    // elegir "Buscar quien puede cubrir" no mostraba nada.
    const main = await leer("../js/main.js");
    // Se mide DESDE que el cuadro de marcajes resuelve: mas arriba hay otro
    // clearSelectionMode -el de la salida temprana, cuando el dia no tiene
    // turno- que no es el que decide esto y haria pasar la prueba de balde.
    const bloque = main.slice(
        main.indexOf("const saved = await openClockMarkDialog(")
    );
    const limpia = bloque.indexOf("clearSelectionMode();");
    const ofrece = bloque.indexOf("await offerSplitShiftCoverage(");

    assert.ok(limpia > 0 && ofrece > 0, "las dos llamadas siguen ahi");
    assert.ok(
        limpia < ofrece,
        "la seleccion se limpia antes de ofrecer el reparto"
    );
});

test("el cuadro sigue abortando si hay una seleccion activa", async () => {
    // La guarda no se quita: lo que se corrigio es QUIEN la deja activa.
    const calendar = await leer("../js/calendar.js");

    assert.match(calendar, /if \(existing \|\| window\.selectionMode\) \{/);
});

test("apretar el '!' de un turno a medias busca quien tape el TRAMO", async () => {
    // Sin el tramo, el reemplazo del segundo nace sin horario, y un reemplazo
    // sin horario cubre el turno entero: el dia se daria por resuelto con las
    // mismas horas sin nadie.
    const calendar = await leer("../js/calendar.js");

    assert.match(
        calendar,
        /const pendingGap = coverageGapsForShift\(\s*\n\s*coveredShiftWindow,\s*\n\s*coveredRecords\s*\n\s*\)\[0\] \|\| null;/
    );
    assert.match(
        calendar,
        /pendingGap\s*\n\s*\? \{ coverWindow: pendingGap, shiftWindow: coveredShiftWindow \}\s*\n\s*: \{\}/
    );
});

test("el reporte dice que tramo cubrio", async () => {
    const report = await leer("../js/hoursReport.js");

    assert.match(
        report,
        /`Cubre el permiso del turno \$\{turnoReplacementLabel\(codeToTurno\(record\.turno\)\)\} de \$\{record\.replaced\} \$\{window\}`/
    );
    // Sin tramo, el detalle de siempre.
    assert.match(report, /: `Reemplaza a \$\{record\.replaced\} por/);
});
