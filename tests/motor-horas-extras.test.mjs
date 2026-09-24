// Primera piedra del motor unico de horas extras.
//
// Hoy el mismo calculo vive en tres partes: hoursEngine.js (que ya alimenta al
// timeline, reportes, dashboard y el menu HHEE), el worker de proyeccion, y la
// PWA del trabajador, en otro repositorio. js/overtimeRules.js es el archivo
// donde se van a ir juntando las reglas, y este test lo protege de dos formas:
// verifica la regla en si, y verifica que la copia de la PWA sea IDENTICA.
//
// La regla que estrena el modulo: un turno diurno EXTRA vale 9 h de lunes a
// jueves y 8 h el viernes, no el promedio semanal de 8,8.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
    AVERAGE_DIURNAL_WORKDAY_HOURS,
    diurnoExtraDayHours,
    diurnoExtraDayHoursWithHolidays,
    roundMonthlyBusinessHours
} = await import("../js/overtimeRules.js");
const { calcExtraHours } = await import("../js/calculations.js");

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const RULES_PATH = "../js/overtimeRules.js";
const PWA_RULES_PATH =
    "../../APP TurnoPlus/www/js/overtimeRules.js";

// Agosto de 2026: el 24 es lunes, asi que 24..28 son lunes a viernes y 29/30
// son sabado y domingo.
const LUNES = new Date(2026, 7, 24);
const MARTES = new Date(2026, 7, 25);
const MIERCOLES = new Date(2026, 7, 26);
const JUEVES = new Date(2026, 7, 27);
const VIERNES = new Date(2026, 7, 28);
const SABADO = new Date(2026, 7, 29);
const DOMINGO = new Date(2026, 7, 30);

const habil = () => true;

/* =========================================================
   La regla
========================================================= */

test("de lunes a jueves un diurno extra vale 9 horas", () => {
    [LUNES, MARTES, MIERCOLES, JUEVES].forEach(date => {
        assert.equal(
            diurnoExtraDayHours(date, habil),
            9,
            `fallo el dia ${date.getDate()}`
        );
    });
});

test("el viernes vale 8 horas", () => {
    assert.equal(diurnoExtraDayHours(VIERNES, habil), 8);
});

test("D+N usa 9 horas diurnas de lunes a jueves y 8 el viernes", () => {
    const lunes = calcExtraHours(LUNES, 5, {});
    const viernes = calcExtraHours(VIERNES, 5, {});

    assert.equal(lunes.d - calcExtraHours(LUNES, 2, {}).d, 9);
    assert.equal(viernes.d - calcExtraHours(VIERNES, 2, {}).d, 8);
    assert.deepEqual(lunes, { d: 11, n: 10 });
    assert.deepEqual(viernes, { d: 9, n: 11 });
});

test("la semana suma 44 horas, que es de donde salia el promedio", () => {
    // 9+9+9+9+8 = 44; 44/5 = 8,8. El promedio servia para repartir la jornada
    // del mes, no para pagar un turno concreto.
    const semana = [LUNES, MARTES, MIERCOLES, JUEVES, VIERNES]
        .reduce((total, date) => total + diurnoExtraDayHours(date, habil), 0);

    assert.equal(semana, 44);
    assert.equal(semana / 5, AVERAGE_DIURNAL_WORKDAY_HOURS);
});

test("sabado y domingo no aportan horas diurnas", () => {
    // Aunque el clasificador dijera que si (habil), el fin de semana no tiene
    // jornada diurna asignada.
    assert.equal(diurnoExtraDayHours(SABADO, habil), 0);
    assert.equal(diurnoExtraDayHours(DOMINGO, habil), 0);
});

test("un feriado en dia de semana tampoco aporta", () => {
    // Clave de feriado del motor: "año-mes(0)-dia".
    const feriados = { "2026-7-25": "Feriado de prueba" };

    assert.equal(diurnoExtraDayHoursWithHolidays(MARTES, feriados), 0);
    // El dia siguiente, que no es feriado, sigue valiendo 9.
    assert.equal(diurnoExtraDayHoursWithHolidays(MIERCOLES, feriados), 9);
});

test("sin clasificador de dia habil solo manda el dia de la semana", () => {
    // Permite usar la regla en contextos que no tienen el mapa de feriados.
    assert.equal(diurnoExtraDayHours(MARTES), 9);
    assert.equal(diurnoExtraDayHours(VIERNES), 8);
    assert.equal(diurnoExtraDayHours(SABADO), 0);
});

/* =========================================================
   Base de horas habiles del mes
========================================================= */

test("la base del mes se redondea a hora entera", () => {
    // El caso de agosto de 2026: 19 dias habiles x 8,8 = 167,2 -> 167.
    assert.equal(roundMonthlyBusinessHours(167.2), 167);
    assert.equal(roundMonthlyBusinessHours(19 * 8.8), 167);
});

test("redondea hacia el lado que corresponde", () => {
    assert.equal(roundMonthlyBusinessHours(167.4), 167);
    assert.equal(roundMonthlyBusinessHours(167.5), 168);
    assert.equal(roundMonthlyBusinessHours(167.6), 168);
    // Y un mes sin dias habiles no rompe nada.
    assert.equal(roundMonthlyBusinessHours(0), 0);
    assert.equal(roundMonthlyBusinessHours(undefined), 0);
});

test("el redondeo ocurre en el origen, no al mostrar", () => {
    // Si se redondeara solo en la vista, el informe diria 167 mientras las
    // horas extras se miden contra 167,2. La base sale ya redondeada del motor.
    return read("../js/hoursEngine.js").then(engine => {
        assert.match(
            engine,
            /return roundMonthlyBusinessHours\(Math\.max\(0, total\)\);/
        );
    });
});

test("la proyeccion usa la misma base redondeada", () => {
    return read("../js/workers/scheduleWorker.js").then(worker => {
        assert.match(
            worker,
            /businessHours: roundMonthlyBusinessHours\(totals\.base\)/
        );
    });
});

/* =========================================================
   Que nadie vuelva a calcularlo por su cuenta
========================================================= */

test("el motor de horas usa la regla, no un 8,8 suelto", async () => {
    const engine = await read("../js/hoursEngine.js");

    assert.match(
        engine,
        /diurnoExtraDayHours,[\s\S]{0,60}roundMonthlyBusinessHours[\s\S]{0,20}from "\.\/overtimeRules\.js";/
    );
    assert.match(
        engine,
        /d: diurnoExtraDayHours\(date, day => isBusinessDay\(day, holidays\)\)/
    );
});

test("las tres superficies del extra usan el mismo helper", async () => {
    // calcExtraHours es el unico lugar donde se decide cuanto vale un turno
    // hecho como extra. Si alguna volviera a calcHours, mostraria 8,8 mientras
    // las otras muestran 9, que es justo el bug que se corrigio.
    const [calculations, calendar, report, replacements] = await Promise.all([
        read("../js/calculations.js"),
        read("../js/replacementCandidates.js"),
        read("../js/hoursReport.js"),
        read("../js/replacements.js")
    ]);

    assert.match(calculations, /export function calcExtraHours\(date, state, h = \{\}\)/);
    assert.match(calculations, /diurnoExtraDayHours\(date, day => isBusinessDay\(day, h\)\)/);
    // Tope de la cobertura automatica.
    assert.match(calendar, /calcExtraHours\(date, Number\(neededTurn\), holidays \|\| \{\}\)/);
    // Reporte: solo el turno extra, no el realizado.
    assert.match(report, /function extraNumberHours\(date, turno, holidays\)/);
    assert.match(report, /calcExtraHours\(date, Number\(turno\) \|\| 0, holidays\)/);
    assert.match(report, /extraNumberHours\(date, extraState, holidays\)/);
    // Panel de registros de HH.EE.
    assert.match(replacements, /savedHours \|\| calcExtraHours\(date, turno, holidays\)/);
});

test("el worker de proyeccion ya no tiene el numero suelto", async () => {
    const worker = await read("../js/workers/scheduleWorker.js");

    assert.match(worker, /AVERAGE_DIURNAL_WORKDAY_HOURS/);
    // Sus tres usos son de la jornada PROMEDIO (turno programado y horas
    // contractuales esperadas): el valor no cambia, pero deja de estar escrito
    // a mano.
    assert.doesNotMatch(worker, /8\.8/);
});

/* =========================================================
   La copia de la PWA
========================================================= */

test("la PWA usa EXACTAMENTE el mismo archivo de reglas", async () => {
    // Son dos repositorios distintos, asi que la unica forma de que no diverjan
    // es que el archivo sea identico y que este test lo note si alguien toca
    // uno solo.
    const [aqui, pwa] = await Promise.all([
        read(RULES_PATH),
        read(PWA_RULES_PATH)
    ]);

    assert.equal(
        pwa,
        aqui,
        "js/overtimeRules.js y www/js/overtimeRules.js se separaron: " +
        "copia el de ProTurnos sobre el de la PWA."
    );
});

test("el archivo de reglas no depende de la app", async () => {
    // Es lo que permite copiarlo a la PWA y, mas adelante, correrlo en el
    // backend sin tocarle una linea.
    const source = await read(RULES_PATH);
    const imports = source.match(/^import .*/gm) || [];

    assert.deepEqual(imports, [], "overtimeRules.js no puede importar nada");

    // Se miran solo las lineas de codigo: el encabezado nombra a Firebase y al
    // DOM justamente para decir que no se pueden usar.
    const codigo = source
        .split("\n")
        .filter(line => !line.trim().startsWith("//"))
        .join("\n");

    assert.doesNotMatch(codigo, /localStorage|document\.|window\.|firebase/i);
});
