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
// Limitacion conocida: el panel de Registros es por evento, asi que en perfiles
// diurnos y sin asignacion de turno (modos "diurno" y "aggregate") sigue sin
// coincidir con el motor -que ahi mide contra la jornada normal o contra las
// horas habiles del mes, no por turno-. Es una divergencia anterior a este
// cambio y no se cubre aqui.
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

const { calcularHorasMesPerfil } = await import("../js/hoursEngine.js");
const { buildWorkerHheeMonthSummary } = await import("../js/hoursReport.js");
const { getHheeMonthRecords } = await import("../js/replacements.js");
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
        panel: { d: round(panel.d), n: round(panel.n) }
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

test("el descuento puede dejar el mes en negativo", async () => {
    // Decision de negocio: no se recorta en cero. Un mes sin HH.EE en que ademas
    // se sale antes queda con saldo negativo y se arrastra a la vista.
    assertAgree(
        await surfaces({
            [`baseData_${NAME}`]: { [dayKey(17)]: TURNO.LARGA },
            [`data_${NAME}`]: { [dayKey(17)]: TURNO.LARGA },
            ...withMark(17, "larga", { exitTime: "19:00" })
        }),
        { d: -1, n: 0 }
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
