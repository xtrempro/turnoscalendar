// Las HH.EE del mes se mostraban en cuatro lugares con cuatro formulas: el
// timeline/KPIs (motor de horas), el reporte de turno asignado, el resumen que
// se publica a la PWA y el panel "Registros HH.EE del mes". Divergian cuando un
// marcaje dejaba horas programadas sin trabajar: el motor las restaba del total
// del mes y los otros tres las recortaban dentro del dia (Math.max(0, ...)), asi
// que las horas que no cabian en el excedente de ESE dia desaparecian.
//
// Este test corre los motores REALES sobre los mismos datos y exige que las tres
// superficies calculables entreguen el mismo numero.
//
// La divergencia de los perfiles DIURNOS ya no es una limitacion conocida: al
// final del archivo se exige que las cuatro superficies -motor, panel, detalle
// publicado y Anexo 2- cuenten igual una extension de jornada. Sigue fuera el
// modo "aggregate" (sin asignacion de turno), que mide contra las horas
// habiles del mes y no por turno.
import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) { this.values.set(key, String(value)); }
}

const noopEl = {
    addEventListener() {}, removeEventListener() {}, appendChild() {},
    setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} },
    click() {}, remove() {}, dataset: {}
};

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost" }
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    visibilityState: "hidden", hidden: true,
    body: noopEl, documentElement: noopEl,
    createElement: () => ({ ...noopEl }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
};
globalThis.alert = () => {};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const {
    applyMonthlyOvertimeAdjustments,
    calcularHorasMesPerfil,
    calculateAggregateExtras
} = await import("../js/hoursEngine.js");
const {
    buildNoAssignmentReportPreviewHTML,
    buildWorkerHheeMonthSummary
} = await import("../js/hoursReport.js");
const { getHheeMonthRecords } = await import("../js/replacements.js");
const { buildCoverageAuthorizationRow } = await import("../js/coverageAuthorizationRows.js");
const { TURNO } = await import("../js/constants.js");

const YEAR = 2026;
const MONTH = 7;
const DAYS = 31;
const NAME = "Ana";
const HOLIDAYS = {};
const PROFILE = {
    name: NAME,
    estamento: "Profesional",
    active: true,
    contractType: "Titular"
};

const dayKey = day => `${YEAR}-${MONTH}-${day}`;
const round = value => Math.round((Number(value) || 0) * 10) / 10;

// Turno con marcaje: un solo dia con entrada/salida reales distintas del horario.
const withMark = (day, segment, times) => ({
    [`clockMarks_${NAME}`]: { [dayKey(day)]: { segments: { [segment]: times } } }
});

function seed(state) {
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify([{ id: "p-ana", ...PROFILE }]));
    localStorage.setItem(`shift_${NAME}`, JSON.stringify(true));
    localStorage.setItem(`rotativa_${NAME}`, JSON.stringify({
        type: "4turno",
        start: "",
        firstTurn: "larga"
    }));
    Object.entries(state).forEach(([key, value]) => {
        localStorage.setItem(key, JSON.stringify(value));
    });
}

async function surfaces(state) {
    seed(state);

    const data = JSON.parse(localStorage.getItem(`data_${NAME}`) || "{}");
    const stats = calcularHorasMesPerfil(
        NAME, YEAR, MONTH, DAYS, HOLIDAYS, data, {}, { d: 0, n: 0 }
    );
    const pwa = await buildWorkerHheeMonthSummary(
        PROFILE,
        new Date(YEAR, MONTH, 1)
    );
    const panel = getHheeMonthRecords(NAME, YEAR, MONTH, HOLIDAYS)
        .reduce((total, record) => ({
            d: total.d + record.d,
            n: total.n + record.n
        }), { d: 0, n: 0 });

    return {
        motor: { d: round(stats.hheeDiurnas), n: round(stats.hheeNocturnas) },
        pwa: { d: round(pwa?.hheeDiurnas), n: round(pwa?.hheeNocturnas) },
        // El panel conserva la linea negativa "Descuento por marcaje" como
        // detalle, pero su total mensual tampoco puede bajar de cero.
        panel: {
            d: round(Math.max(0, panel.d)),
            n: round(Math.max(0, panel.n))
        }
    };
}

function assertAgree(result, expected) {
    assert.deepEqual(result.motor, expected, "motor de horas (timeline y KPIs)");
    assert.deepEqual(result.pwa, expected, "resumen publicado a la PWA");
    assert.deepEqual(result.panel, expected, "panel Registros HH.EE del mes");
}

// Turno base el 17 (Larga) y turno extra el 18 (Larga sobre dia libre).
const BASE = {
    [`baseData_${NAME}`]: { [dayKey(17)]: TURNO.LARGA, [dayKey(18)]: TURNO.LIBRE },
    [`data_${NAME}`]: { [dayKey(17)]: TURNO.LARGA, [dayKey(18)]: TURNO.LARGA }
};

test("sin marcajes, el turno extra completo cuenta igual en las tres", async () => {
    assertAgree(await surfaces(BASE), { d: 12, n: 0 });
});

test("salir 1 h antes del turno BASE descuenta de las HH.EE del mes", async () => {
    // Este era el caso roto: el motor restaba la hora y el reporte, la PWA y el
    // panel la perdian porque ese dia no tenia HH.EE contra las cuales restarla.
    assertAgree(
        await surfaces({ ...BASE, ...withMark(17, "larga", { exitTime: "19:00" }) }),
        { d: 11, n: 0 }
    );
});

test("llegar 1 h tarde al turno base descuenta igual que salir antes", async () => {
    assertAgree(
        await surfaces({ ...BASE, ...withMark(17, "larga", { entryTime: "09:00" }) }),
        { d: 11, n: 0 }
    );
});

test("salir 1 h antes del turno EXTRA descuenta esa hora", async () => {
    assertAgree(
        await surfaces({ ...BASE, ...withMark(18, "larga", { exitTime: "19:00" }) }),
        { d: 11, n: 0 }
    );
});

test("el descuento nunca deja las HH.EE del mes en negativo", async () => {
    // El deficit queda visible en el detalle del marcaje, pero no constituye
    // una deuda de horas extras ni puede producir un pago negativo.
    assertAgree(
        await surfaces({
            [`baseData_${NAME}`]: { [dayKey(17)]: TURNO.LARGA },
            [`data_${NAME}`]: { [dayKey(17)]: TURNO.LARGA },
            ...withMark(17, "larga", { exitTime: "19:00" })
        }),
        { d: 0, n: 0 }
    );
});

test("Natalia: el modo agregado usa la base mensual sin doble descuento", () => {
    const initial = calculateAggregateExtras(99, 101, 141);

    assert.deepEqual(initial, {
        hheeDiurnas: 0,
        hheeNocturnas: 59
    });
    assert.deepEqual(
        applyMonthlyOvertimeAdjustments({
            mode: "aggregate",
            hheeDiurnas: initial.hheeDiurnas,
            hheeNocturnas: initial.hheeNocturnas,
            clockAbsences: { d: 16, n: 23 }
        }),
        { d: 0, n: 59 }
    );
});

test("la valorizacion agregada tampoco vuelve a agregar deficits", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) =>
        readFile(new URL("../js/hoursEngine.js", import.meta.url), "utf8")
    );
    const start = source.indexOf("function calculatePaymentSegments(");
    const end = source.indexOf("function calculatePreviousCarryIn(", start);
    const block = source.slice(start, end);

    assert.match(block, /if \(mode === "aggregate"\) return segments;/);
    assert.ok(
        block.indexOf('if (mode === "aggregate") return segments;') <
        block.indexOf("...calculateClockAbsenceSegments(")
    );
});

test("salir despues del turno base suma excedente, no descuento", async () => {
    assertAgree(
        await surfaces({
            [`baseData_${NAME}`]: { [dayKey(17)]: TURNO.LARGA },
            [`data_${NAME}`]: { [dayKey(17)]: TURNO.LARGA },
            ...withMark(17, "larga", { exitTime: "21:00" })
        }),
        { d: 1, n: 0 }
    );
});

test("salir 1 h antes de una Noche descuenta en la banda que corresponde", async () => {
    assertAgree(
        await surfaces({
            [`baseData_${NAME}`]: { [dayKey(17)]: TURNO.NOCHE, [dayKey(18)]: TURNO.LIBRE },
            [`data_${NAME}`]: { [dayKey(17)]: TURNO.NOCHE, [dayKey(18)]: TURNO.LARGA },
            ...withMark(17, "noche", { exitTime: "07:00" })
        }),
        { d: 11, n: 0 }
    );
});

test("un turno 24 h que termina 1 h antes descuenta sobre el extra", async () => {
    assertAgree(
        await surfaces({
            [`baseData_${NAME}`]: { [dayKey(19)]: TURNO.LARGA },
            [`data_${NAME}`]: { [dayKey(19)]: TURNO.TURNO24 },
            ...withMark(19, "turno24", { exitTime: "07:00" })
        }),
        { d: 1, n: 10 }
    );
});

test("un Diurno extra con salida 1 h antes vale 9 - 1 = 8", async () => {
    // El 31 de agosto de 2026 es lunes: un diurno extra vale 9 h. Antes valia
    // 8,8 (el promedio de la semana) y este caso daba 7,8.
    const result = await surfaces({
        [`baseData_${NAME}`]: { [dayKey(31)]: TURNO.LIBRE },
        [`data_${NAME}`]: { [dayKey(31)]: TURNO.DIURNO },
        ...withMark(31, "diurno", { exitTime: "16:00" })
    });

    // El panel lleva el detalle exacto: 9 del turno y -1 del descuento.
    assert.deepEqual(result.panel, { d: 8, n: 0 });
    // Lo que NO puede volver a pasar es el resultado de hace tiempo, 9 diurnas
    // + 3 NOCTURNAS: se arrastraba una Noche que el turno no tenia
    // -getWorkedIntervalsForState con TURNO.NOCHE devuelve el horario completo
    // si no hay marca de ese segmento-, sumando 20:00-24:00 inventadas.
    assert.deepEqual(result.motor, { d: 8, n: 0 });
    assert.deepEqual(result.pwa, { d: 8, n: 0 });
});

test("un Diurno+Noche extra si mide su parte nocturna", async () => {
    // El caso que la rama con marcaje SI tenia que cubrir: aqui la Noche existe
    // de verdad, asi que sus horas cuentan (20:00-24:00 dentro del mes).
    const result = await surfaces({
        [`baseData_${NAME}`]: { [dayKey(31)]: TURNO.LIBRE },
        [`data_${NAME}`]: { [dayKey(31)]: TURNO.DIURNO_NOCHE },
        ...withMark(31, "diurno", { exitTime: "16:00" })
    });

    assert.equal(result.motor.n > 0, true, "la parte nocturna real no se pierde");
});

test("el detalle D+N valoriza el diurno por el dia real, no a 8,8", async () => {
    const day = 25; // Martes 25-08-2026.
    seed({
        [`shift_${NAME}`]: false,
        [`baseData_${NAME}`]: { [dayKey(day)]: TURNO.NOCHE },
        [`data_${NAME}`]: { [dayKey(day)]: TURNO.DIURNO_NOCHE }
    });

    const summary = await buildWorkerHheeMonthSummary(
        PROFILE,
        new Date(YEAR, MONTH, 1)
    );
    const detail = summary.extraShifts.find(item =>
        item.iso === "2026-08-25"
    );

    assert.equal(detail.d, 11, "9 h del Diurno + 2 h diurnas de la Noche");
    assert.equal(detail.n, 10);
});

test("el reporte sin asignacion tampoco muestra 10,8 para un D+N martes", async () => {
    const day = 25;
    seed({
        [`shift_${NAME}`]: false,
        [`baseData_${NAME}`]: { [dayKey(day)]: TURNO.NOCHE },
        [`data_${NAME}`]: { [dayKey(day)]: TURNO.DIURNO_NOCHE }
    });

    const html = await buildNoAssignmentReportPreviewHTML(
        PROFILE,
        new Date(YEAR, MONTH, 1)
    );
    const row = html.match(/25-08-2026[\s\S]*?<\/tr>/)?.[0] || "";

    assert.match(row, />11<\/td>/);
    assert.doesNotMatch(row, />10,8<\/td>/);
});

test("el D+N del 08-09 con marcajes reales tampoco vuelve a 10,8", async () => {
    const keyDay = "2026-8-8";
    seed({
        [`shift_${NAME}`]: false,
        [`baseData_${NAME}`]: { [keyDay]: TURNO.NOCHE },
        [`data_${NAME}`]: { [keyDay]: TURNO.DIURNO_NOCHE },
        [`clockMarks_${NAME}`]: {
            [keyDay]: {
                segments: {
                    diurno: { entryTime: "08:03", exitTime: "17:04" },
                    noche: { entryTime: "19:57", exitTime: "08:03" }
                }
            }
        }
    });

    const html = await buildNoAssignmentReportPreviewHTML(
        PROFILE,
        new Date(2026, 8, 1)
    );
    const row = html.split("</tr>").find(fragment =>
        fragment.includes("08-09-2026") &&
        fragment.includes('data-col="horasDiurnas"')
    ) || "";

    assert.match(row, />11<\/td>/);
    assert.doesNotMatch(row, />10,8<\/td>/);
});

test("un dia con permiso aprobado no genera descuento aunque haya marcaje", async () => {
    // Las horas no trabajadas ya estan justificadas por el feriado legal.
    assertAgree(
        await surfaces({
            ...BASE,
            [`legal_${NAME}`]: { [dayKey(17)]: 1 },
            ...withMark(17, "larga", { exitTime: "19:00" })
        }),
        { d: 12, n: 0 }
    );
});

// --- Jornada diurna que se estira ---
//
// La divergencia que este archivo daba por conocida: en perfiles diurnos el
// panel media la extension (3 h de lunes a jueves, 4 el viernes) y el detalle
// por dia le atribuia el bloque entero de media tarde, 6 h. Ese detalle es el
// que alimenta el Anexo 2 y el resumen que ve el trabajador, asi que la unidad
// imprimia 6 donde el motor contaba 3.
//
// Ahora las cuatro superficies hacen la MISMA cuenta: lo trabajado menos su
// jornada normal.

const DIURNA = "Diurna";
const DIURNA_PROFILE = {
    name: DIURNA,
    estamento: "Profesional",
    active: true,
    contractType: "Contrata"
};
const OCTUBRE = 9;
const diurnaKey = day => `${YEAR}-${OCTUBRE}-${day}`;
const diurnaIso = day => `${YEAR}-10-${String(day).padStart(2, "0")}`;

function seedDiurna(extensiones) {
    const base = {};

    for (let day = 1; day <= 31; day += 1) {
        const fecha = new Date(YEAR, OCTUBRE, day);

        if (![0, 6].includes(fecha.getDay())) base[diurnaKey(day)] = TURNO.DIURNO;
    }

    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify([{ id: "p-diurna", ...DIURNA_PROFILE }]));
    localStorage.setItem(`rotativa_${DIURNA}`, JSON.stringify({
        type: "diurno",
        start: `${YEAR}-10-01`,
        firstTurn: "larga"
    }));
    localStorage.setItem(`shift_${DIURNA}`, JSON.stringify(false));
    localStorage.setItem(`baseData_${DIURNA}`, JSON.stringify(base));
    localStorage.setItem(`data_${DIURNA}`, JSON.stringify(base));
    // "Extension horaria": se queda hasta las 20:00 (turno HT sobre su diurno).
    localStorage.setItem("replacements", JSON.stringify(
        extensiones.map((day, index) => ({
            id: `ext-${index}`,
            worker: DIURNA,
            date: diurnaIso(day),
            year: YEAR,
            month: OCTUBRE,
            turno: "HT",
            reason: "Extension",
            coverFrom: "08:00",
            coverUntil: "20:00"
        }))
    ));
}

async function diurnaSurfaces(extensiones) {
    seedDiurna(extensiones);

    const data = JSON.parse(localStorage.getItem(`data_${DIURNA}`));
    const stats = calcularHorasMesPerfil(
        DIURNA, YEAR, OCTUBRE, 31, HOLIDAYS, data, {}, { d: 0, n: 0 }
    );
    const panel = getHheeMonthRecords(DIURNA, YEAR, OCTUBRE, HOLIDAYS);
    const resumen = await buildWorkerHheeMonthSummary(
        DIURNA_PROFILE,
        new Date(YEAR, OCTUBRE, 1)
    );
    const anexo = await buildCoverageAuthorizationRow(
        DIURNA_PROFILE,
        new Date(YEAR, OCTUBRE, 1)
    );

    return {
        motor: round(stats.hheeDiurnas),
        panel: panel.map(record => [record.date, round(record.d)]),
        detalle: (resumen.extraShifts || []).map(item => [item.iso, round(item.d)]),
        anexo: (anexo.days || []).map(day => [day.iso, round(day.dayHours)])
    };
}

test("la extension de un diurno vale 3 h de lunes a jueves y 4 el viernes", async () => {
    // Jueves 8 y viernes 16 de octubre de 2026.
    const visto = await diurnaSurfaces([8, 16]);
    const esperado = [[diurnaIso(8), 3], [diurnaIso(16), 4]];

    assert.equal(visto.motor, 7, "motor de horas");
    assert.deepEqual(visto.panel, esperado, "panel Registros HH.EE");
    assert.deepEqual(visto.detalle, esperado, "detalle publicado a la PWA");
    assert.deepEqual(visto.anexo, esperado, "Anexo 2");
});

test("el Anexo 2 suma lo mismo que el motor del mes", async () => {
    const visto = await diurnaSurfaces([5, 6, 7, 8, 9]);

    assert.equal(
        visto.anexo.reduce((total, [, horas]) => total + horas, 0),
        visto.motor
    );
    // Lunes a jueves 3 y viernes 4.
    assert.deepEqual(
        visto.anexo.map(([, horas]) => horas),
        [3, 3, 3, 3, 4]
    );
});
