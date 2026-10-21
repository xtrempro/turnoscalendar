// El motor publica clockMarkModifications (modificaciones de marcaje del supervisor:
// recuperacion / horas extra netas / reduccion por dia) para que la PWA del
// trabajador las muestre. clockMarkDayDetail arma el detalle estructurado por dia.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("../js/hoursReport.js", import.meta.url), "utf8");
const engineSrc = await readFile(new URL("../js/serverEngine.js", import.meta.url), "utf8");
const clockMarksSrc = await readFile(new URL("../js/clockMarks.js", import.meta.url), "utf8");
const mainSrc = await readFile(new URL("../js/main.js", import.meta.url), "utf8");

function grab(name) {
  const decl = `function ${name}(`;
  let start = src.indexOf(`export ${decl}`);
  if (start !== -1) start += "export ".length;
  else start = src.indexOf(decl);
  assert.notEqual(start, -1, `no se encontro ${name}`);
  // Saltar la lista de parametros (puede tener `= {}` por defecto) antes del cuerpo.
  let paren = 0, i = src.indexOf("(", start);
  for (; i < src.length; i += 1) { if (src[i] === "(") paren++; else if (src[i] === ")") { paren--; if (!paren) { i++; break; } } }
  let depth = 0;
  for (let j = src.indexOf("{", i); j < src.length; j += 1) {
    if (src[j] === "{") depth += 1;
    else if (src[j] === "}") { depth -= 1; if (!depth) return src.slice(start, j + 1); }
  }
  throw new Error(`sin cierre: ${name}`);
}

function buildDetail(env) {
  return new Function(...Object.keys(env), `${grab("clockMarkDayDetail")} return clockMarkDayDetail;`)(
    ...Object.values(env)
  );
}

const baseEnv = {
  getClockScheduleState: () => 1,
  getScheduledSegmentsForProfile: () => [{ start: 0, end: 100 }]
};

test("un dia con recuperacion Y horas extra trae ambas etiquetas + minutos", () => {
  const fn = buildDetail({
    ...baseEnv,
    getClockMarks: () => ({ K: { segments: [{}] } }),
    findClockMarkEntry: () => ({ value: { entryTime: "08:10", exitTime: "18:30" } }),
    classifyClockMarkSegment: () => ({ recoveryMinutes: 30, netExtraMinutes: 15, uncoveredMinutes: 0, isReduction: false })
  });
  const d = fn("Ana", "K", new Date(), 1, {});
  assert.equal(d.recoveryMinutes, 30);
  assert.equal(d.netExtraMinutes, 15);
  assert.equal(d.entryTime, "08:10");
  assert.equal(d.exitTime, "18:30");
  assert.deepEqual(d.badges, ["Recuperación de horas", "Genera horas extra"]);
});

test("solo reduccion (atraso sin recuperar)", () => {
  const fn = buildDetail({
    ...baseEnv,
    getClockMarks: () => ({ K: { segments: [{}] } }),
    findClockMarkEntry: () => ({ value: { exitTime: "07:20" } }),
    classifyClockMarkSegment: () => ({ recoveryMinutes: 0, netExtraMinutes: 0, uncoveredMinutes: 40, isReduction: true })
  });
  const d = fn("Ana", "K", new Date(), 2, {});
  assert.equal(d.uncoveredMinutes, 40);
  assert.deepEqual(d.badges, ["Reducción de jornada"]);
});

test("marca faltante -> Sin entrada / Sin salida", () => {
  const fn = buildDetail({
    ...baseEnv,
    getClockMarks: () => ({ K: { segments: [{}] } }),
    findClockMarkEntry: () => ({ value: { missingEntry: true, missingExit: true } }),
    classifyClockMarkSegment: () => ({ recoveryMinutes: 0, netExtraMinutes: 0, uncoveredMinutes: 0, isReduction: false })
  });
  const d = fn("Ana", "K", new Date(), 1, {});
  assert.equal(d.missingEntry, true);
  assert.equal(d.missingExit, true);
  assert.deepEqual(d.badges, ["Sin entrada", "Sin salida"]);
});

test("sin marca registrada -> null (no engorda la proyeccion)", () => {
  const fn = buildDetail({ ...baseEnv, getClockMarks: () => ({}), findClockMarkEntry: () => null, classifyClockMarkSegment: () => ({}) });
  assert.equal(fn("Ana", "K", new Date(), 1, {}), null);
});

test("el builder recorre los dias con marca (cubre meses futuros) y el motor publica", () => {
  assert.match(src, /export async function buildWorkerClockMarkModifications/);
  // Recorre las claves de getClockMarks (no un rango fijo de meses hacia atras),
  // asi cubre cualquier mes con marca, incl. futuros relativos a hoy. Antes el
  // rango fijo + `if (date > today) break;` dejaba esos dias sin detalle.
  assert.match(src, /getClockMarks\(profileName\)/);
  assert.match(src, /Object\.keys\(marks\)/);
  assert.doesNotMatch(src, /if \(date > today\) break;/);
  // serverEngine computa y publica el mapa junto a overtimeSummaries.
  assert.match(engineSrc, /buildWorkerClockMarkModifications/);
  assert.match(engineSrc, /clockMarkModifications,/);
});

test("guardar un marcaje republica la proyeccion del trabajador (con flush de estado)", () => {
  // Sin esto, modificar un marcaje NO regeneraba la proyeccion: el detalle
  // (recuperacion / horas extra / reduccion) no aparecia en la PWA hasta que
  // alguna otra edicion del perfil disparaba un projectionRequest.
  assert.match(
    clockMarksSrc,
    /dispatchEvent\(\s*new CustomEvent\("proturnos:clockMarksChanged"/
  );
  // main.js escucha el evento y republica forzando el flush del estado
  // (clockMarks_<perfil>) antes del projectionRequest, para que
  // buildWorkerAppProjection recompute con el marcaje fresco.
  assert.match(
    mainSrc,
    /addEventListener\("proturnos:clockMarksChanged"[\s\S]*?scheduleWorkerAppDataPublish\([\s\S]*?requiresLocalStateFlush: true/
  );
});

test("el detalle de turnos extra incluye la extension horaria por marcaje", () => {
  // buildDayRows ("extra-only") suma la hora extra NETA del marcaje como una
  // extension, aunque el turno base no sea "extra". El total ya la cuenta
  // (getWorkedIntervalsForState); esto la hace visible en el detalle HH.EE.
  const rows = grab("buildDayRows");
  assert.match(rows, /getClockNetExtraHours\(profileName, keyDay, date, actual, holidays\)/);
  assert.match(rows, /hasClockExtension/);
  // Se incluye el dia por la extension aunque no sea turno extra ni reemplazo.
  assert.match(rows, /isExtra \|\| hasClockExtension \|\| hasReplacement/);
});

test("las horas del detalle se suman en numerico y descuentan reducciones de marcaje", () => {
  // rowHours/formatHour devuelven strings con coma ("10,8"); sumar la hora extra
  // como string concatenaba: "10" + 0 -> "100" (D+N mostraba 0/100). La suma debe
  // ser numerica (numberHours) y recien despues formatear. Si un turno extra no se
  // trabaja completo por marcaje, se publican las horas realmente trabajadas.
  const rows = grab("buildDayRows");
  // extraNumberHours, no numberHours: un turno EXTRA se valora con la regla del
  // extra (un diurno vale 9 h de lunes a jueves y 8 el viernes), mientras que el
  // turno realizado sigue valorandose con la jornada promedio.
  assert.match(rows, /extraNumberHours\(date, extraState, holidays\)/);
  assert.match(rows, /workedScheduledExtraHours\(/);
  // La suma lleva ademas el descuento de la jornada diurna que no se trabajo
  // (ver hhee-superficies-coinciden): en diurno la cuenta parte del turno
  // programado, asi que lo no trabajado se resta aqui.
  assert.match(
    rows,
    /scheduledExtraWorkedHours\.n \+\s*\n\s*clockExtraHours\.n -\s*\n\s*diurnoDeficitHours\.n/
  );
  assert.match(rows, /isPartialExtra/);
  assert.match(src, /partial: Boolean\(row\.esParcial\)/);
  assert.doesNotMatch(rows, /formatHour\(scheduleExtraHours\.n \+ clockExtraHours\.n\)/);
  // El parseo de vuelta normaliza la coma decimal (si no, "10,8" -> NaN -> 0).
  assert.match(src, /Number\(String\(value\)\.replace\(",", "\."\)\)/);
});

test("el resumen mensual PWA publica el total del motor, no una suma propia", () => {
  // La tarjeta superior de la PWA lee overtimeSummaries[*].hheeDiurnas/
  // hheeNocturnas. Recalcularlas sumando el detalle de turnos ("extra-only")
  // dejaba fuera los descuentos por marcaje que no caben en el excedente del
  // dia, asi que la PWA quedaba por encima del timeline y del reporte. El
  // numero del mes tiene que salir del motor de horas, que es el unico
  // autoritativo.
  const summary = grab("buildWorkerHheeMonthSummary");
  assert.match(summary, /const reportHheeDiurnas = num\(stats\.hheeDiurnas\);/);
  assert.match(summary, /const reportHheeNocturnas = num\(stats\.hheeNocturnas\);/);
  assert.match(summary, /const reportNetDiurnas = num\(model\.totalD\);/);
  assert.match(summary, /const reportNetNocturnas = num\(model\.totalN\);/);
  assert.match(summary, /netDiurnas: reportNetDiurnas/);
  assert.match(summary, /netNocturnas: reportNetNocturnas/);
  assert.match(summary, /hheeDiurnas: reportHheeDiurnas/);
  assert.match(summary, /hheeNocturnas: reportHheeNocturnas/);
  assert.doesNotMatch(summary, /roundSummaryHour\(extraShiftTotals/);
});
