// Una ausencia de otra unidad tiene que producir el MISMO identificador que una
// propia.
//
// El servidor devuelve los dias crudos y el agrupado ocurre en el navegador,
// con estas funciones. Si una ausencia ajena se identificara con otra formula,
// el control de "esta ausencia ya esta ocupada" -que compara por ese id- se
// rompe sin que nadie lo note: la misma ausencia podria respaldar dos contratos
// en dos unidades distintas.
//
// Por eso estas funciones se movieron de main.js -que no es importable desde
// una prueba- a este modulo puro.
import test from "node:test";
import assert from "node:assert/strict";

const {
    REPLACEMENT_CONTRACT_LEAVE_TYPES,
    calendarKeysToReplacementLeaveOption,
    optionsFromLeaveKeysByType,
    replacementLeaveOptionId
} = await import("../js/replacementLeaveGrouping.js");

/** El mismo formato que usa el calendario: clave con mes en base 0. */
function toInputDate(key) {
    const [year, month, day] = String(key).split("-").map(Number);

    return [
        year,
        String(month + 1).padStart(2, "0"),
        String(day).padStart(2, "0")
    ].join("-");
}

// Sabado y domingo no son habiles; ademas, un feriado de prueba.
const FERIADO = "2026-8-18";
const isBusinessDay = date => {
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

    return date.getDay() !== 0 &&
        date.getDay() !== 6 &&
        key !== FERIADO;
};

/* =========================================================
   El identificador, que es lo que sostiene todo
========================================================= */

test("propia y ajena dan el MISMO id para el mismo permiso", () => {
    // Es la garantia central: no se comparan dos formulas parecidas, se usa
    // una sola funcion.
    const ajena = optionsFromLeaveKeysByType({
        profileName: "Ana Perez",
        leaveKeys: { license: ["2026-8-10", "2026-8-11"] },
        isBusinessDay,
        toInputDate
    })[0];
    const propia = calendarKeysToReplacementLeaveOption({
        profileName: "Ana Perez",
        type: "license",
        label: REPLACEMENT_CONTRACT_LEAVE_TYPES.license,
        keys: ["2026-8-10", "2026-8-11"],
        toInputDate
    });

    assert.equal(ajena.id, propia.id);
    assert.equal(ajena.label, "Licencia Médica");
    // Las claves llevan el mes en BASE 0: "2026-8-10" es el 10 de septiembre.
    assert.equal(ajena.start, "2026-09-10");
    assert.equal(ajena.end, "2026-09-11");
});

test("el id distingue trabajador, tipo y fechas", () => {
    const base = {
        profileName: "Ana",
        type: "legal",
        start: "2026-09-01",
        end: "2026-09-05"
    };
    const id = replacementLeaveOptionId(base);

    assert.notEqual(id, replacementLeaveOptionId({ ...base, profileName: "Bea" }));
    assert.notEqual(id, replacementLeaveOptionId({ ...base, type: "comp" }));
    assert.notEqual(id, replacementLeaveOptionId({ ...base, end: "2026-09-06" }));
});

test("un nombre con caracteres raros no rompe el id", () => {
    // Se codifica cada parte: un nombre con "|" partiria la clave en dos.
    const id = replacementLeaveOptionId({
        profileName: "Ana|Perez",
        type: "legal",
        start: "2026-09-01",
        end: "2026-09-05"
    });

    assert.equal(id.split("|").length, 4);
});

/* =========================================================
   El agrupado
========================================================= */

test("los feriados legales saltan fines de semana y feriados", () => {
    // Jueves 17 y lunes 21 de septiembre. En medio: el viernes 18, que arriba
    // declaramos feriado, mas sabado y domingo. Ninguno es habil, asi que los
    // dos dias pedidos son habiles CONSECUTIVOS y forman un solo rango.
    const opciones = optionsFromLeaveKeysByType({
        profileName: "Ana",
        leaveKeys: { legal: ["2026-8-17", "2026-8-21"] },
        isBusinessDay,
        toInputDate
    });

    assert.equal(opciones.length, 1);
    assert.equal(opciones[0].start, "2026-09-17");
    assert.equal(opciones[0].end, "2026-09-21");
});

test("una licencia NO salta inhabiles: se cuenta corrida", () => {
    // LAS MISMAS DOS FECHAS de la prueba anterior, y solo cambia el tipo. Una
    // licencia corre por dias calendario, asi que el fin de semana del medio
    // parte el rango en dos. El contraste es la regla.
    const opciones = optionsFromLeaveKeysByType({
        profileName: "Ana",
        leaveKeys: { license: ["2026-8-17", "2026-8-21"] },
        isBusinessDay,
        toInputDate
    });

    assert.equal(opciones.length, 2);
});

test("varios tipos conviven y cada uno trae su etiqueta", () => {
    const opciones = optionsFromLeaveKeysByType({
        profileName: "Ana",
        leaveKeys: {
            comp: ["2026-8-1"],
            unpaid_leave: ["2026-8-20"]
        },
        isBusinessDay,
        toInputDate
    });
    const etiquetas = opciones.map(option => option.label).sort();

    assert.deepEqual(etiquetas, ["F. Compensatorios", "Permiso sin Goce"]);
});

test("un tipo desconocido se ignora en vez de colarse sin etiqueta", () => {
    const opciones = optionsFromLeaveKeysByType({
        profileName: "Ana",
        leaveKeys: { vacaciones_marte: ["2026-8-1"] },
        isBusinessDay,
        toInputDate
    });

    assert.deepEqual(opciones, []);
});

test("sin trabajador o sin formateador no se inventa nada", () => {
    assert.deepEqual(
        optionsFromLeaveKeysByType({
            profileName: "",
            leaveKeys: { legal: ["2026-8-1"] },
            isBusinessDay,
            toInputDate
        }),
        []
    );
    assert.deepEqual(
        optionsFromLeaveKeysByType({
            profileName: "Ana",
            leaveKeys: { legal: ["2026-8-1"] },
            isBusinessDay
        }),
        []
    );
});
