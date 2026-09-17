// La rotativa incompleta llega al Calendario Semanal.
//
// Titulares de Turnos ya sabe que un grupo puede estar constituido con un
// trabajador menos que los otros tres. Esa carencia no es un dato de otra
// pantalla: al grupo le falta alguien CADA VEZ que entra, asi que aparece como
// casilla en cada turno que le toca, y el ! abre el modal de siempre.
//
// Lo que sale de ahi no reemplaza a NADIE: es un turno extra con motivo, que es
// algo que el registro ya sabia guardar.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = async name => (await readFile(
    new URL(`../js/${name}`, import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

const staffing = await read("staffing.js");
const calendar = await read("calendar.js");
const holders = await read("shiftHolders.js");

/** Extrae una funcion por llaves equilibradas, saltando los parametros. */
function grab(source, name) {
    const start = source.search(
        new RegExp(`^(?:async )?(?:export )?function ${name}\\(`, "m")
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

/* ======================================================================
   El motivo
   ====================================================================== */

const { weeklyRotaMotive } = new Function(`
    ${staffing.slice(
        staffing.indexOf("const WEEKLY_ESTAMENTO_PLURAL"),
        staffing.indexOf("/**\n * Cupo por rotativa incompleta")
    )}
    return { weeklyRotaMotive };
`)();

test("el motivo dice que estamento falta y a que grupo", () => {
    assert.equal(
        weeklyRotaMotive("Técnico", "C"),
        "Completar rotativa de técnicos del grupo C"
    );
});

test("el plural va a mano", () => {
    // "profesionals" y "auxiliars" no existen.
    assert.equal(
        weeklyRotaMotive("Profesional", "A"),
        "Completar rotativa de profesionales del grupo A"
    );
    assert.equal(
        weeklyRotaMotive("Auxiliar", "B"),
        "Completar rotativa de auxiliares del grupo B"
    );
    assert.equal(
        weeklyRotaMotive("Administrativo", "D"),
        "Completar rotativa de administrativos del grupo D"
    );
});

test("un estamento fuera del catalogo no revienta", () => {
    assert.equal(
        weeklyRotaMotive("Matrona", "C"),
        "Completar rotativa de matronas del grupo C"
    );
});

/* ======================================================================
   De que grupo es la celda
   ====================================================================== */

const weeklyCellGroup = new Function(
    `${grab(staffing, "weeklyCellGroup")}\nreturn weeklyCellGroup;`
)();

const gente = (...grupos) => grupos.map(group => ({
    type: "profile",
    group,
    profile: { name: `x${Math.random()}` }
}));

test("la celda es del grupo que comparte su gente", () => {
    assert.equal(weeklyCellGroup(gente("C", "C", "C")), "C");
});

test("quien no hace 4to turno no la define", () => {
    // Los diurnos no tienen letra: no se cuelan como grupo de la celda.
    assert.equal(weeklyCellGroup(gente("", "", "C", "C")), "C");
});

test("una celda sin nadie de 4to turno no tiene grupo", () => {
    assert.equal(weeklyCellGroup(gente("", "")), "");
    assert.equal(weeklyCellGroup([]), "");
});

test("manda el grupo mayoritario", () => {
    // Alguien puede estar de reemplazo desde otro grupo; eso no cambia de
    // quien es el turno.
    assert.equal(weeklyCellGroup(gente("C", "C", "C", "A")), "C");
});

/* ======================================================================
   El estado de la celda
   ====================================================================== */

const weeklyCellSummary = new Function(
    "normalizeStaffingEstamento",
    "STAFFING_ESTAMENTOS",
    "WEEKLY_ESTAMENTO_SHORT",
    `${grab(staffing, "weeklyCellSummary")}\nreturn weeklyCellSummary;`
)(
    value => String(value || "").trim(),
    ["Profesional", "Técnico", "Administrativo", "Auxiliar"],
    { "Técnico": "Téc", "Profesional": "Prof" }
);

const trabaja = () => ({ type: "profile", profile: { estamento: "Técnico" } });
const hueco = () => ({ type: "replacement-slot", profile: { estamento: "Técnico" } });

test("una rotativa corta se dice en la celda", () => {
    const summary = weeklyCellSummary([trabaja(), trabaja()], 1);

    assert.equal(summary.status.key, "rota");
    assert.equal(summary.status.label, "rotativa −1");
});

test("lo que falta HOY manda sobre la rotativa corta", () => {
    // Una licencia es aguda y se acaba; una rotativa incompleta es cronica.
    const summary = weeklyCellSummary([trabaja(), hueco()], 1);

    assert.equal(summary.status.key, "gap");
});

test("y la rotativa manda sobre lo ya cubierto", () => {
    const cubierto = {
        type: "profile",
        profile: { estamento: "Técnico" },
        covers: ["Alguien"]
    };
    const summary = weeklyCellSummary([trabaja(), cubierto], 1);

    assert.equal(summary.status.key, "rota");
});

test("sin carencia, la celda sigue como antes", () => {
    assert.equal(weeklyCellSummary([trabaja()], 0).status.key, "ok");
    // Y el argumento es opcional: las celdas de diurno no lo pasan.
    assert.equal(weeklyCellSummary([trabaja()]).status.key, "ok");
});

/* ======================================================================
   A quien se parece el que falta
   ====================================================================== */

test("el molde es alguien del grupo que SI esta trabajando", () => {
    // El modal necesita un perfil de referencia para saber quien puede
    // cubrir. Se elige a uno presente para que no arrastre capacitaciones ni
    // medias jornadas que le cambiarian las horas al calculo.
    const fuente = grab(staffing, "weeklyRotaReference");

    assert.match(fuente, /item\.type !== "replacement-slot" && item\.group === group/);
    assert.match(fuente, /if \(sameEstamento\) return sameEstamento\.profile\.name;/);
    // Y si el grupo entero esta ausente, cualquier activo del estamento.
    assert.match(fuente, /getProfiles\(\)\s*\n\s*\.filter\(isProfileActive\)/);
});

test("sin molde no se dibuja la casilla", () => {
    // Sin referencia el modal no sabria a quien ofrecer.
    assert.match(grab(staffing, "weeklyRotaGapHTML"), /if \(!reference\) return "";/);
});

/* ======================================================================
   La casilla
   ====================================================================== */

test("solo en los turnos que ese grupo trabaja", () => {
    // El diurno no pertenece a ningun grupo del 4to turno.
    assert.match(
        staffing,
        /const cellGroup = shift\.key === "diurno" \? "" : weeklyCellGroup\(roster\)/
    );
});

/* ======================================================================
   Los chips de estamento no inventan carencias
   ====================================================================== */

/** El cuerpo de una funcion en una sola linea, para leerlo de corrido. */
const seguido = name => grab(staffing, name).replace(/\s+/g, " ");

const weeklyRotaGapsForCell = new Function(
    "getShiftGroupGaps",
    "currentDate",
    "normalizeStaffingEstamento",
    `${grab(staffing, "weeklyRotaGapsForCell")}\nreturn weeklyRotaGapsForCell;`
)(
    // Al grupo C le faltaria un tecnico si entrara con menos de tres.
    () => new Map([["C", [{ estamento: "Técnico", reference: 3 }]]]),
    new Date(2026, 8, 1),
    value => String(value || "").trim()
);

const turnoCompleto = [
    ...Array.from({ length: 6 }, () => ({
        type: "profile",
        group: "C",
        profile: { estamento: "Profesional" }
    })),
    ...Array.from({ length: 3 }, () => ({
        type: "profile",
        group: "C",
        profile: { estamento: "Técnico" }
    }))
];

test("el turno completo no tiene carencia", () => {
    assert.deepEqual(weeklyRotaGapsForCell("C", turnoCompleto), []);
});

test("mirar solo un estamento NO deja al turno corto de los otros", () => {
    // El chip esconde gente, no la saca del turno. Contando sobre la lista ya
    // filtrada, los tres tecnicos del turno valian cero y el mismo turno de
    // arriba aparecia con tres casillas de "Falta 1 Técnico".
    const soloProfesionales = turnoCompleto.filter(item =>
        item.profile.estamento === "Profesional"
    );

    assert.equal(weeklyRotaGapsForCell("C", soloProfesionales).length, 1);
    assert.equal(weeklyRotaGapsForCell("C", soloProfesionales)[0].missing, 3);
    // Por eso la celda cuenta sobre la dotacion entera y no sobre lo visible.
    assert.match(
        seguido("renderStaffingWeeklyCell"),
        /const roster = weeklyShiftProfiles\( date, shift\.key, absenceCache, "Todos", "Todas" \);/
    );
    assert.match(
        grab(staffing, "renderStaffingWeeklyCell"),
        /weeklyRotaGapsForCell\(cellGroup, roster\)/
    );
});

test("lo que se ve sigue siendo lo filtrado", () => {
    // La dotacion entera es para contar; las tarjetas siguen saliendo del
    // filtro, que es para lo que el supervisor lo prendio.
    assert.match(
        seguido("renderStaffingWeeklyCell"),
        /const people = roster\.filter\(item => weeklyProfileMatchesFilters\( item\.profile, roleFilter, professionFilter \) \);/
    );
});

const weeklyRoleFilterAllows = new Function(`
    ${grab(staffing, "weeklyTokens")}
    ${grab(staffing, "weeklyRoleFilterAllows")}
    return weeklyRoleFilterAllows;
`)();

test("una carencia real solo se muestra en su propio estamento", () => {
    // Sin chips, todo; con el de Profesional puesto, lo que le falte al de
    // tecnicos es ruido de otra columna.
    assert.equal(weeklyRoleFilterAllows("Técnico", "Todos"), true);
    assert.equal(weeklyRoleFilterAllows("Técnico", "Técnico"), true);
    assert.equal(weeklyRoleFilterAllows("Técnico", "Profesional"), false);
    // Los chips son combinables.
    assert.equal(
        weeklyRoleFilterAllows("Técnico", "Profesional,Técnico"),
        true
    );
    assert.match(
        grab(staffing, "renderStaffingWeeklyCell"),
        /\.filter\(gap => weeklyRoleFilterAllows\(gap\.estamento, roleFilter\)\)/
    );
});

test("el inicio pide la dotacion entera, como siempre", () => {
    // getRotaGapShifts ya contaba sobre el turno completo: es de ahi que la
    // celda se habia desviado.
    assert.match(
        seguido("getRotaGapShifts"),
        /absenceCache, "Todos", "Todas"/
    );
});

test("se dibuja una casilla por cada trabajador que falta", () => {
    assert.match(
        grab(staffing, "weeklyRotaGapHTML"),
        /Array\.from\(\{ length: gap\.missing \}/
    );
});

test("la casilla dice cuantos tiene el grupo y cuantos el mejor dotado", () => {
    assert.match(
        grab(staffing, "weeklyRotaGapHTML"),
        /Grupo \$\{escapeHTML\(group\)\} · \$\{gap\.count\} de \$\{gap\.reference\}/
    );
});

test("va en ambar y el hueco por ausencia en rojo", async () => {
    // Una licencia de hoy es aguda y se acaba; una rotativa corta es cronica y
    // vuelve cada ciclo. Si las dos gritaran igual, la semana se veria peor de
    // lo que esta y el rojo dejaria de significar "esto hay que resolverlo
    // ahora".
    const css = (await readFile(
        new URL("../styles.css", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    const rota = css.slice(
        css.indexOf(".staffing-weekly-rota-gap__badge {"),
        css.indexOf("}", css.indexOf(".staffing-weekly-rota-gap__badge {"))
    );
    const ausencia = css.slice(
        css.indexOf(".staffing-weekly-replacement-alert {"),
        css.indexOf("}", css.indexOf(".staffing-weekly-replacement-alert {"))
    );

    assert.match(rota, /background: #b45309;/);
    assert.match(ausencia, /background: #ef4444;/);
});

/* ======================================================================
   La carencia sale de Titulares
   ====================================================================== */

test("es la misma comparacion del tablero, no una copia", () => {
    assert.match(holders, /export function getShiftGroupGaps\(today = new Date\(\)\)/);
    assert.match(grab(holders, "getShiftGroupGaps"), /buildEstamentoGaps\(columns\)/);
});

test("se guarda junto al mapa de grupos", () => {
    // Sale de el y se invalida con lo mismo.
    assert.match(grab(holders, "getShiftGroupGaps"), /if \(groupMapMemo\.gaps\) return groupMapMemo\.gaps;/);
    assert.match(holders, /groupMapMemo = \{ key: memoKey, map, gaps: null \}/);
});

/* ======================================================================
   El modal
   ====================================================================== */

test("el dialogo aprendio una segunda puerta de entrada", () => {
    assert.match(
        calendar,
        /async function openReplacementDialog\(profileName, keyDay, options = \{\}\)/
    );
    assert.match(calendar, /const rota = options\.rota \|\| null;/);
});

test("un cupo de rotativa no busca una ausencia que no existe", () => {
    // Nadie falto: el grupo esta constituido con uno menos.
    //
    // La otra via que corta por lo mismo es el tramo (`coverWindow`): al cubrir
    // las horas que quedaron sin nadie, el reemplazo que ya existe es
    // justamente el que dejo el hueco y no puede bloquear el cuadro.
    //
    // Y la tercera: un turno cubierto a MEDIAS. Ahi el tramo no llega por
    // parametro -se aprieta el "!" del dia- y el reemplazo parcial tampoco
    // puede bloquear, o el badge promete algo que el click no cumple.
    assert.match(
        calendar,
        /const existing = \(\s*\n\s*rota \|\|\s*\n\s*coverWindow \|\|\s*\n\s*!coveredShiftIsFullyCovered\(profileName, keyDay\)\s*\n\s*\)\s*\n\s*\? null\s*\n\s*: getReplacementForCoveredShift\(profileName, keyDay\)/
    );
    assert.match(
        calendar,
        /const neededTurn = rota\s*\n\s*\? rota\.turno/
    );
    assert.match(calendar, /const absenceType = rota\s*\n\s*\? rota\.motive/);
});

test("el modal explica de que grupo se trata", () => {
    assert.match(
        calendar,
        /El grupo \$\{escapeHTML\(rota\.group\)\} requiere 1 \$\{escapeHTML\(rota\.estamento\)\}/
    );
});

test("lo que se guarda es un turno extra, no un reemplazo de alguien", () => {
    // El registro ya sabia guardar un turno extra sin reemplazado, con el
    // motivo en `reason`.
    assert.match(calendar, /replaced: rota \? "" : profileName,/);
    assert.match(calendar, /reason: rota \? rota\.motive : "",/);
    assert.match(calendar, /source: rota\s*\n\s*\? "rota_gap"/);
});

test("el motivo NO se guarda como tipo de ausencia", () => {
    // `absenceType` describe la ausencia que se cubre; aqui no hay ninguna, y
    // ponerlo ensuciaria los reportes que agrupan por tipo.
    assert.match(calendar, /absenceType: rota \? "" : absenceType,/);
});

test("al aplicarlo no se repinta un ausente que no existe", () => {
    assert.match(calendar, /if \(!rota\) await updateDayCell\(profileName, keyDay\)/);
});

test("el ! de la casilla abre ese modal con el motivo escrito", () => {
    assert.match(staffing, /querySelectorAll\("\[data-weekly-rota-group\]"\)/);
    assert.match(staffing, /motive: weeklyRotaMotive\(estamento, group\)/);
    assert.match(staffing, /turno: Number\(button\.dataset\.weeklyRotaTurno\)/);
});

test("los cupos de rotativa cuentan como problema", () => {
    assert.match(
        staffing,
        /if \(onlyTrouble && !\["gap", "rota"\]\.includes\(summary\.status\.key\)\)/
    );
});

test("la casilla tiene estilo propio y su franja", async () => {
    const css = (await readFile(
        new URL("../styles.css", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    assert.ok(css.includes(".staffing-weekly-rota-gap {"));
    assert.ok(css.includes("border: 1px dashed rgba(180, 83, 9, 0.5)"));
    assert.ok(css.includes(".staffing-weekly-cell--rota::before { background: #b45309; }"));
    // La franja necesita el bloque compartido, o no se dibuja nada.
    assert.ok(css.includes(".staffing-weekly-cell--rota::before,"));
});
