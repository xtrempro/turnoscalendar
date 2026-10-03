// Recuperacion de horas por marcaje y su clasificacion. La recuperacion (atraso
// compensado con salida tardia) solo aplica a segmentos diurnos/larga; la noche
// no puede recuperar (cruza dos dias). Ademas, el reporte debe restar el deficit
// del marcaje a las HH.EE de un turno cubierto (salida temprana).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyClockMarkSegment } from "../js/clockMarkUtils.js";

const at = (y, m, d, h) => new Date(y, m, d, h, 0, 0, 0);
const opts = { isBaseOrSwap: true };

test("Larga 8-20 marcada 9->21: solo recuperacion (sin extra neta)", () => {
    const segment = {
        id: "larga",
        start: at(2026, 7, 13, 8),
        end: at(2026, 7, 13, 20)
    };
    const c = classifyClockMarkSegment(
        at(2026, 7, 13, 0),
        segment,
        { entryTime: "09:00", exitTime: "21:00" },
        opts
    );

    assert.equal(c.deficitMinutes, 60);
    assert.equal(c.extraMinutes, 60);
    assert.equal(c.recoveryMinutes, 60);
    assert.equal(c.netExtraMinutes, 0);
    assert.equal(c.isRecovery, true);
    assert.equal(c.isReduction, false);
});

test("Diurno lunes 8-17 marcado 9->19: recuperacion 1h + extra neta 1h", () => {
    // 2026-08-03 es lunes (fin diurno 17:00).
    const segment = {
        id: "diurno",
        start: at(2026, 7, 3, 8),
        end: at(2026, 7, 3, 17)
    };
    const c = classifyClockMarkSegment(
        at(2026, 7, 3, 0),
        segment,
        { entryTime: "09:00", exitTime: "19:00" },
        opts
    );

    assert.equal(c.deficitMinutes, 60);
    assert.equal(c.extraMinutes, 120);
    assert.equal(c.recoveryMinutes, 60);
    assert.equal(c.netExtraMinutes, 60);
    assert.equal(c.isRecovery, true);
});

test("Noche 20-8 corrida 1h: NO recupera (excluida), es reduccion + extra", () => {
    const segment = {
        id: "noche",
        start: at(2026, 7, 13, 20),
        end: at(2026, 7, 14, 8)
    };
    const c = classifyClockMarkSegment(
        at(2026, 7, 13, 0),
        segment,
        { entryTime: "21:00", exitTime: "09:00" },
        opts
    );

    assert.equal(c.deficitMinutes, 60);
    assert.equal(c.extraMinutes, 60);
    assert.equal(c.recoveryMinutes, 0);
    assert.equal(c.netExtraMinutes, 60);
    assert.equal(c.isReduction, true);
    assert.equal(c.isRecovery, false);
});

test("Larga 8-20 con solo salida 15:00: reduccion de jornada (deficit 5h)", () => {
    const segment = {
        id: "larga",
        start: at(2026, 7, 13, 8),
        end: at(2026, 7, 13, 20)
    };
    const c = classifyClockMarkSegment(
        at(2026, 7, 13, 0),
        segment,
        { exitTime: "15:00" },
        opts
    );

    assert.equal(c.deficitMinutes, 300);
    assert.equal(c.extraMinutes, 0);
    assert.equal(c.recoveryMinutes, 0);
    assert.equal(c.isReduction, true);
});

test("el reporte resta el deficit del marcaje sin recortarlo dentro del dia", async () => {
    const report = await readFile(
        new URL("../js/hoursReport.js", import.meta.url),
        "utf8"
    );
    const start = report.indexOf("function buildAssignedShiftDayRows(");
    assert.notEqual(start, -1);
    const body = report.slice(start, start + 4200);

    // Sin esto, una Larga cubierta con "Salida 15:00" mostraba 12 HH.EE en vez de 7.
    assert.match(body, /getClockDeficitHours\(/);
    // El recorte por dia (Math.max(0, ...)) perdia las horas programadas no
    // trabajadas que no cabian en el excedente de ESE dia: una Noche completa
    // ausente descontaba solo lo que alcanzaba a cubrir el excedente y el
    // reporte quedaba por encima del timeline. El detalle conserva todo el
    // descuento; el total mensual lo limita a cero el motor de horas.
    assert.match(body, /d: grossExtraHours\.d - clockDeficitHours\.d/);
    assert.match(body, /n: grossExtraHours\.n - clockDeficitHours\.n/);
    assert.doesNotMatch(body, /Math\.max\(0, grossExtraHours/);
});

test("clockMarkSummary usa 'a las', clasifica y reetiqueta el motivo", async () => {
    const report = await readFile(
        new URL("../js/hoursReport.js", import.meta.url),
        "utf8"
    );

    assert.match(report, /Entrada a las \$\{segmentMark\.entryTime\}/);
    assert.match(report, /Salida a las \$\{segmentMark\.exitTime\}/);
    assert.match(report, /classifyClockMarkSegment\(/);
    assert.match(report, /details\.push\("Recuperación de horas"\)/);
    // El motivo, mas el comentario de un cupo de la Brecha si lo tiene.
    assert.match(report, /Motivo horas extras: \$\{withCupoComment\(record\.reason/);
});

test("el '?' de horas extra usa el neto (extra - deficit), no el crudo", async () => {
    const [clock, calendar, timeline] = await Promise.all([
        readFile(new URL("../js/clockMarks.js", import.meta.url), "utf8"),
        readFile(new URL("../js/calendar.js", import.meta.url), "utf8"),
        readFile(new URL("../js/timeline.js", import.meta.url), "utf8")
    ]);

    // El neto resta el deficit al extra por banda (recuperacion no es hora extra).
    assert.match(clock, /export function getClockNetExtraHours/);
    assert.match(clock, /Math\.max\(0, extra\.d - deficit\.d\)/);
    assert.match(clock, /Math\.max\(0, extra\.n - deficit\.n\)/);
    assert.match(clock, /export function hasClockNetExtra/);

    // El badge y el modal del "?" usan las versiones netas (no las crudas).
    assert.match(calendar, /hasClockNetExtra\(/);
    assert.match(calendar, /getClockNetExtraHours\(/);
    assert.doesNotMatch(calendar, /\bhasClockExtra\(/);
    // El timeline tambien usa el neto para el badge "?".
    assert.match(timeline, /hasClockNetExtra\(/);
    assert.doesNotMatch(timeline, /\bhasClockExtra\(/);
});
