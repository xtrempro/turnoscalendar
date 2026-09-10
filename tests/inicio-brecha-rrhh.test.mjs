// "Brecha RRHH": los cargos que le faltan a cada turno, en el inicio.
//
// Un grupo del 4to turno puede estar constituido con menos gente que los otros
// tres: no es que alguien falte hoy, es que ese cargo NO EXISTE en la rotativa,
// y la carencia vuelve cada vez que ese grupo entra. La detecta Titulares de
// Turnos comparando los cuatro grupos.
//
// Aca se listan los turnos proximos que van a entrar cortos, para cubrirlos sin
// salir del inicio, con el mismo modal del calendario.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = async name => (await readFile(
    new URL(`../js/${name}`, import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

const home = await read("home.js");
const staffing = await read("staffing.js");

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
   Lo que falta se mide contra el turno, no contra el padron
   ====================================================================== */

const weeklyRotaGapsForCell = new Function(
    "getShiftGroupGaps",
    "currentDate",
    "normalizeStaffingEstamento",
    `${grab(staffing, "weeklyRotaGapsForCell")}\nreturn weeklyRotaGapsForCell;`
);

/** El grupo C con 2 tecnicos frente a los 3 del mejor dotado. */
const CARENCIA = [{ estamento: "Técnico", count: 2, reference: 3, missing: 1 }];

function faltan(gente) {
    return weeklyRotaGapsForCell(
        () => new Map([["C", CARENCIA]]),
        new Date(2026, 8, 1),
        value => String(value || "").trim()
    )("C", gente);
}

const tecnico = () => ({ type: "profile", profile: { estamento: "Técnico" } });
const ausente = () => ({
    type: "replacement-slot",
    profile: { estamento: "Técnico" }
});
const profesional = () => ({
    type: "profile",
    profile: { estamento: "Profesional" }
});

test("con la dotacion de siempre, falta uno", () => {
    const gaps = faltan([tecnico(), tecnico(), profesional()]);

    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].missing, 1);
    assert.equal(gaps[0].count, 2);
});

test("al cubrirlo, la carencia DESAPARECE", () => {
    // Era el defecto: salia del padron del grupo, y el padron no cambia porque
    // alguien tome un turno extra, asi que la casilla se quedaba ahi.
    assert.deepEqual(faltan([tecnico(), tecnico(), tecnico()]), []);
});

test("un ausente no cuenta dos veces", () => {
    // Ya tiene su propio hueco por la ausencia: si ademas engordara la brecha
    // de rotativa, el mismo turno pediria dos personas por una sola falta.
    const gaps = faltan([tecnico(), ausente(), profesional()]);

    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].missing, 1);
});

test("y si ademas falta el cargo, se piden los dos", () => {
    // Un tecnico asignado -el otro esta ausente con su hueco- contra tres de
    // referencia: faltan dos.
    const gaps = faltan([tecnico(), profesional()]);

    assert.equal(gaps[0].missing, 2);
});

test("quien cubre desde otro grupo tambien cuenta", () => {
    // El turno necesita tres tecnicos; de que grupo vengan da igual.
    assert.deepEqual(
        faltan([tecnico(), tecnico(), { type: "profile", profile: { estamento: "Técnico" }, group: "A" }]),
        []
    );
});

test("una celda sin grupo no tiene carencia de rotativa", () => {
    // El diurno no pertenece a ningun grupo del 4to turno.
    const sinGrupo = weeklyRotaGapsForCell(
        () => new Map([["C", CARENCIA]]),
        new Date(2026, 8, 1),
        value => String(value || "").trim()
    )("", [tecnico()]);

    assert.deepEqual(sinGrupo, []);
});

/* ======================================================================
   Los turnos que vienen
   ====================================================================== */

test("solo se miran Larga y Noche", () => {
    assert.match(
        grab(staffing, "getRotaGapShifts"),
        /\.filter\(shift => shift\.key !== "diurno"\)/
    );
});

test("la ventana mira un mes por delante", () => {
    // Lo pidio el usuario: con una semana solo se veia la carencia mas
    // inmediata, y para planificar la cobertura hacen falta las fechas de todo
    // el mes.
    assert.match(home, /const BRECHA_WINDOW_DAYS = 30;/);
    assert.match(
        grab(home, "getBrechaRows"),
        /se repite cada vez que ese grupo entra/
    );
});

test("y lo que no cabe se resume en una linea", () => {
    // Con un mes la MISMA carencia aparece en varias fechas: sin este tope el
    // recuadro se estira y deja de leerse.
    assert.match(home, /const BRECHA_MAX_ROWS = 8;/);
    assert.match(
        home,
        /rows\.slice\(0, BRECHA_MAX_ROWS\)/
    );
    assert.match(
        home,
        /y \$\{rows\.length - BRECHA_MAX_ROWS\} más en los próximos \$\{BRECHA_WINDOW_DAYS\} días\./
    );
});

test("un turno al que le faltan dos sale como dos filas", () => {
    // Cada fila es un cargo que cubrir, no un turno.
    assert.match(
        grab(home, "getBrechaRows"),
        /flatMap\(row => Array\.from\(\{ length: row\.missing \}/
    );
});

/* ======================================================================
   La tarjeta
   ====================================================================== */

test("está en el inicio, en la columna del turno", async () => {
    // Es una de las tarjetas del inicio, y el orden de fabrica la pone debajo
    // de la cobertura. Cada administrador puede moverla despues (homeLayout.js).
    assert.match(home, /\n    brecha: brechaWidget\n/);
    assert.match(
        await read("homeLayout.js"),
        /Object\.freeze\(\["resumen", "minical", "cobertura", "brecha"\]\)/
    );
});

test("se llama Brecha RRHH", () => {
    assert.match(grab(home, "brechaWidget"), /"Brecha RRHH"/);
});

test("el resumen cuenta cargos y turnos, que no son lo mismo", () => {
    // Un cargo faltante afecta a varios turnos de la semana.
    const body = grab(home, "brechaBody");

    assert.match(body, /Cargo faltante/);
    assert.match(body, /Turnos afectados/);
    assert.match(body, /cargos\.set\(clave, \(cargos\.get\(clave\) \|\| 0\) \+ 1\)/);
});

test("cuando los grupos estan parejos lo dice", () => {
    assert.match(
        grab(home, "brechaBody"),
        /Los cuatro grupos están parejos/
    );
});

test("la fila dice de que grupo es y cuantos tiene", () => {
    const row = grab(home, "brechaRow");

    assert.match(row, /Falta 1 \$\{esc\(row\.estamento\)\}/);
    assert.match(row, /Grupo \$\{esc\(row\.group\)\}:<\/b> \$\{row\.count\} de \$\{row\.reference\}/);
});

test("va en ambar, con el token del inicio", async () => {
    // No es que alguien falte hoy: es que el cargo no existe en la rotativa.
    const css = (await readFile(
        new URL("../styles.css", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    assert.ok(css.includes(
        ".hm-cob-status--brecha { background: var(--hm-warn-soft); color: var(--hm-warn); }"
    ));
});

/* ======================================================================
   Cubrir desde el inicio
   ====================================================================== */

test("el boton abre el mismo modal del calendario", () => {
    assert.match(home, /window\.openReplacementDialog\?\.\(/);
    assert.match(home, /data-hm="brecha-cubrir"/);
    assert.match(home, /turno: Number\(button\.dataset\.brechaTurno\)/);
});

test("con el mismo motivo que escribe el calendario semanal", () => {
    // Las dos superficies tienen que dejar el registro con el mismo texto.
    assert.match(home, /Completar rotativa de \$\{/);
    assert.match(home, /BRECHA_PLURAL\[estamento\]/);
    assert.match(staffing, /Completar rotativa de \$\{weeklyEstamentoPlural\(estamento\)\}/);
});

test("el plural va a mano en las dos", () => {
    assert.match(home, /"Auxiliar": "auxiliares"/);
    assert.match(staffing, /"Auxiliar": "auxiliares"/);
});

test("sin a quien parecerse, el boton no ofrece nada", () => {
    // El modal necesita un perfil de referencia para saber quien puede cubrir.
    assert.match(grab(home, "brechaRow"), /row\.reference_profile \? "" : "disabled/);
});

test("el segundo boton lleva al semanal, a la semana de ese turno", () => {
    // No al mes ni a hoy: a la semana en la que el cargo va a faltar.
    assert.match(home, /data-hm="brecha-semanal"/);
    assert.match(home, /showStaffingWeekFor\(new Date\(year, month - 1, day\)\)/);
    assert.match(staffing, /export function showStaffingWeekFor\(date\)/);
    assert.match(
        grab(staffing, "showStaffingWeekFor"),
        /staffingWeekDate = weekStartMonday\(date\)/
    );
});

test("el cambio de vista lo hace el menu, no una copia de su logica", () => {
    // Y si el usuario no tiene ese menu, el boton no existe y no pasa nada.
    assert.match(
        grab(staffing, "showStaffingWeekFor"),
        /\.nav-tile\[data-target="staffingWeeklyCalendar"\]/
    );
    assert.match(grab(staffing, "showStaffingWeekFor"), /\?\.click\(\)/);
});

test("los dos botones van uno sobre otro", async () => {
    const css = await readFile(
        new URL("../styles.css", import.meta.url),
        "utf8"
    );

    assert.match(home, /class="hm-cob-actions hm-cob-actions--stack"/);
    assert.ok(css.includes(".hm-cob-actions--stack { flex-direction: column; }"));
});

test("el detalle se pliega sin repintar el inicio entero", () => {
    assert.match(home, /function reRenderBrecha\(panel\)/);
    assert.match(grab(home, "reRenderBrecha"), /brecha-detail/);
    // Por el interruptor y no por la columna, que cambia con el ancho.
    assert.match(grab(home, "reRenderBrecha"), /closest\("\.hm-card"\)/);
});
