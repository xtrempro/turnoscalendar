// Dotacion y estado de cobertura de cada celda del Calendario Semanal.
//
// La pantalla decia QUIEN trabaja cada dia, pero para saber CUANTOS habia que
// contar tarjetas, y el unico aviso era un signo de admiracion que no decia ni
// cuantos faltaban ni si alguien ya lo habia resuelto.
//
// Ahora la celda lleva su dotacion, la mezcla por estamento -no da lo mismo que
// los siete sean todos tecnicos- y uno de cuatro estados.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (await readFile(
    new URL("../js/staffing.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

/** Extrae una funcion por llaves equilibradas, saltando los parametros. */
function grab(name) {
    const start = source.search(
        new RegExp(`^(?:async )?function ${name}\\(`, "m")
    );

    assert.notEqual(start, -1, `no se encontro: ${name}`);

    let depth = 0;
    let i = source.indexOf("(", start);

    for (; i < source.length; i += 1) {
        if (source[i] === "(") depth += 1;
        else if (source[i] === ")") {
            depth -= 1;
            if (!depth) break;
        }
    }

    depth = 0;

    for (i = source.indexOf("{", i); i < source.length; i += 1) {
        if (source[i] === "{") depth += 1;
        else if (source[i] === "}") {
            depth -= 1;
            if (!depth) return source.slice(start, i + 1);
        }
    }

    throw new Error(`sin cierre: ${name}`);
}

// El cuerpo real de la funcion, con sus dependencias inyectadas: lo que se
// prueba es el conteo, el orden y el estado, no la normalizacion de texto.
const weeklyCellSummary = new Function(
    "normalizeStaffingEstamento",
    "STAFFING_ESTAMENTOS",
    "WEEKLY_ESTAMENTO_SHORT",
    `${grab("weeklyCellSummary")}\nreturn weeklyCellSummary;`
)(
    value => String(value || "").trim(),
    ["Profesional", "Técnico", "Administrativo", "Auxiliar"],
    {
        "Profesional": "Prof",
        "Técnico": "Téc",
        "Administrativo": "Adm",
        "Auxiliar": "Aux"
    }
);

/** Alguien trabajando el turno. */
const trabaja = (estamento, covers = []) => ({
    type: "profile",
    profile: { name: `${estamento} ${Math.random()}`, estamento },
    covers
});

/** Un hueco: ausencia sin reemplazo aplicado. */
const hueco = estamento => ({
    type: "replacement-slot",
    profile: { name: "Ausente", estamento }
});

/* ======================================================================
   Cuanta gente hay
   ====================================================================== */

test("la celda dice cuantos trabajan", () => {
    const summary = weeklyCellSummary([
        trabaja("Profesional"),
        trabaja("Profesional"),
        trabaja("Técnico")
    ]);

    assert.equal(summary.total, 3);
});

test("los huecos no cuentan como gente", () => {
    // Son justamente los que NO estan.
    const summary = weeklyCellSummary([
        trabaja("Técnico"),
        hueco("Técnico"),
        hueco("Técnico")
    ]);

    assert.equal(summary.total, 1);
});

test("una celda vacia no inventa nada", () => {
    const summary = weeklyCellSummary([]);

    assert.equal(summary.total, 0);
    assert.equal(summary.mix, "");
    assert.equal(summary.status.key, "empty");
    assert.equal(summary.status.label, "");
});

/* ======================================================================
   Como se reparte
   ====================================================================== */

test("la mezcla va en el orden del listado", () => {
    const summary = weeklyCellSummary([
        trabaja("Auxiliar"),
        trabaja("Administrativo"),
        trabaja("Técnico"),
        trabaja("Profesional")
    ]);

    assert.equal(summary.mix, "1 Prof · 1 Téc · 1 Adm · 1 Aux");
});

test("no aparece el estamento que no hay", () => {
    const summary = weeklyCellSummary([
        trabaja("Profesional"),
        trabaja("Profesional"),
        trabaja("Técnico")
    ]);

    assert.equal(summary.mix, "2 Prof · 1 Téc");
});

test("quien no tiene estamento registrado va al final", () => {
    // Es una ficha incompleta, no un cargo: no se mezcla con los demas ni
    // desaparece de la cuenta.
    const summary = weeklyCellSummary([
        trabaja(""),
        trabaja("Profesional"),
        trabaja("Técnico")
    ]);

    assert.equal(summary.mix, "1 Prof · 1 Téc · 1 s/e");
    assert.equal(summary.total, 3);
});

test("un estamento fuera del catalogo tambien", () => {
    const summary = weeklyCellSummary([
        trabaja("Matrona"),
        trabaja("Técnico")
    ]);

    assert.equal(summary.mix, "1 Téc · 1 s/e");
});

/* ======================================================================
   En que estado esta
   ====================================================================== */

test("sin ausencias, completo", () => {
    const summary = weeklyCellSummary([
        trabaja("Profesional"),
        trabaja("Técnico")
    ]);

    assert.equal(summary.status.key, "ok");
    assert.equal(summary.status.label, "completo");
});

test("con un hueco dice cuantos faltan", () => {
    const summary = weeklyCellSummary([
        trabaja("Técnico"),
        hueco("Técnico")
    ]);

    assert.equal(summary.status.key, "gap");
    assert.equal(summary.status.label, "falta 1");
});

test("y en plural cuando son varios", () => {
    const summary = weeklyCellSummary([
        trabaja("Técnico"),
        hueco("Técnico"),
        hueco("Profesional")
    ]);

    assert.equal(summary.status.label, "faltan 2");
});

test("si alguien tomo el reemplazo, cubierto", () => {
    // Tiene la misma gente que uno completo, pero ya costo una gestion y
    // conviene que se note.
    const summary = weeklyCellSummary([
        trabaja("Técnico"),
        trabaja("Técnico", ["Reinaldo Reyes"])
    ]);

    assert.equal(summary.status.key, "cover");
    assert.equal(summary.status.label, "cubierto");
});

test("un hueco manda sobre un cubierto", () => {
    // Lo que falta pesa mas que lo ya resuelto: es lo que hay que hacer.
    const summary = weeklyCellSummary([
        trabaja("Técnico", ["Alguien"]),
        hueco("Técnico")
    ]);

    assert.equal(summary.status.key, "gap");
});

/* ======================================================================
   Que este cableado
   ====================================================================== */

test("se sabe a quien cubre cada quien", async () => {
    // El indice se arma UNA vez por celda: preguntarlo por persona obligaria a
    // recorrer los cientos de reemplazos de la unidad decenas de veces para el
    // mismo dia.
    assert.match(
        source,
        /const coveredByWorker = getReplacementsByWorkerForDay\(shiftKeyDay\);/
    );
    assert.match(source, /covers: coveredByWorker\.get\(profile\.name\) \|\| \[\]/);
    assert.match(
        source,
        /getReplacementsByWorkerForDay,?\n(?:\s+\w+,?\n)*\} from "\.\/replacements\.js"/
    );

    const replacements = await readFile(
        new URL("../js/replacements.js", import.meta.url),
        "utf8"
    );

    assert.match(
        replacements,
        /export function getReplacementsByWorkerForDay\(keyDay\)/
    );
    // Solo los vigentes, y solo los de ese dia.
    assert.match(replacements, /!replacementActive\(replacement\) \|\|/);
});

test("la tarjeta de quien cubre lo dice, y a quien", () => {
    assert.match(source, /class="staffing-weekly-covers" title="Cubre a \$\{/);
});

test("la celda pinta su dotacion y su estado", () => {
    assert.match(source, /class="staffing-weekly-cell__count"/);
    assert.match(source, /<i class="is-\$\{summary\.status\.key\}"/);
    assert.match(source, /class="staffing-weekly-cell__mix"/);
    // La franja de color solo cuando hay algo que decir.
    assert.match(source, /staffing-weekly-cell--gap/);
    assert.match(source, /staffing-weekly-cell--covered/);
});

test("hoy se distingue en el encabezado y en las celdas", () => {
    assert.match(source, /staffing-weekly-day--today/);
    assert.match(source, /class="staffing-weekly-day__today">HOY</);
    assert.match(source, /staffing-weekly-cell--today/);
    // Se compara contra la fecha del equipo, no contra la semana pedida.
    assert.match(source, /const todayKey = key\(\s*\n\s*currentDate\.getFullYear\(\)/);
});

test("la celda tiene la fila nueva para la mezcla", async () => {
    const css = (await readFile(
        new URL("../styles.css", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    assert.ok(css.includes("grid-template-rows: auto auto minmax(82px, 1fr);"));
    assert.ok(css.includes(".staffing-weekly-cell__count i.is-gap"));
    assert.ok(css.includes(".staffing-weekly-cell__count i.is-cover"));
    assert.ok(css.includes(".staffing-weekly-cell__count i.is-ok"));
    assert.ok(css.includes(".staffing-weekly-day--today"));
});
