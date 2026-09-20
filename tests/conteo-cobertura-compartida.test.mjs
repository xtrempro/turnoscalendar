// Cinco personas cubriendo un turno son UN turno cubierto, no cinco.
//
// Un turno repartido deja un registro de reemplazo por persona. Contando
// registros, el grafico de dotacion diaria del inicio marcaba cinco, su detalle
// tambien, y el resumen RRHH publicaba cinco turnos -que ademas multiplica por
// las horas de un turno y prorratea con esa cifra el gasto en horas extras-.
//
// Lo que se cuenta es el TURNO cubierto: un ausente, un dia, un turno.
import test from "node:test";
import assert from "node:assert/strict";

const {
    coveredShiftHours,
    coveredShiftKey,
    coverersByShift,
    distinctCoveredShifts,
    extraCoverWorkersByDate
} = await import("../js/coverageCounting.js");

const DIA = "2026-09-20";

/** Un reemplazo de los que deja el reparto de un turno. */
const rep = (worker, extra = {}) => ({
    worker,
    replaced: "Ausente",
    date: DIA,
    turno: 2,
    ...extra
});

/* =========================================================
   La clave del turno
========================================================= */

test("la clave es ausente, dia y turno", () => {
    assert.equal(coveredShiftKey(rep("Ana")), "Ausente|2026-09-20|2");
});

test("el turno va en la clave: un mismo dia puede tener dos", () => {
    // Sin el turno, un diurno y una noche del mismo ausente el mismo dia se
    // contarian como un solo turno cubierto.
    assert.notEqual(
        coveredShiftKey(rep("Ana", { turno: 2 })),
        coveredShiftKey(rep("Ana", { turno: 4 }))
    );
});

test("lo anulado y lo que no cubre a nadie no tienen clave", () => {
    // Un turno extra con motivo no cubre a ningun ausente: no es un turno
    // cubierto, es otra cosa.
    assert.equal(coveredShiftKey(rep("Ana", { canceled: true })), "");
    assert.equal(coveredShiftKey(rep("Ana", { replaced: "" })), "");
    assert.equal(coveredShiftKey(rep("Ana", { date: "" })), "");
    assert.equal(coveredShiftKey(null), "");
});

/* =========================================================
   El conteo
========================================================= */

test("cinco personas en un mismo turno cuentan UNO", () => {
    assert.equal(
        distinctCoveredShifts([
            rep("Ana"),
            rep("Bea"),
            rep("Carla"),
            rep("Dora"),
            rep("Eva")
        ]),
        1
    );
});

test("dos turnos distintos del mismo dia cuentan dos", () => {
    assert.equal(
        distinctCoveredShifts([
            rep("Ana", { turno: 2 }),
            rep("Bea", { turno: 4 })
        ]),
        2
    );
});

test("dos ausentes distintos cuentan dos", () => {
    assert.equal(
        distinctCoveredShifts([
            rep("Ana"),
            rep("Bea", { replaced: "Otro" })
        ]),
        2
    );
});

test("lo anulado no suma", () => {
    assert.equal(
        distinctCoveredShifts([
            rep("Ana", { canceled: true }),
            rep("Bea", { replaced: "Otro" })
        ]),
        1
    );
});

test("sin reemplazos no hay nada que contar", () => {
    assert.equal(distinctCoveredShifts([]), 0);
    assert.equal(distinctCoveredShifts(), 0);
});

/* =========================================================
   A quien NO contar en un recuento por persona
========================================================= */

test("del turno repartido, uno representa y el resto no suma", () => {
    // El grafico cuenta por perfil con turno ese dia. Para que cinco no sean
    // cinco, cuatro quedan fuera del recuento -pero siguen teniendo su turno,
    // su marcaje y sus horas: lo unico que cambia es la cuenta-.
    const fuera = extraCoverWorkersByDate([
        rep("Ana"),
        rep("Bea"),
        rep("Carla")
    ]);

    assert.deepEqual([...fuera.get(DIA)].sort(), ["Bea", "Carla"]);
});

test("el primero del listado es el que se queda", () => {
    const fuera = extraCoverWorkersByDate([rep("Ana"), rep("Bea")]);

    assert.ok(!fuera.get(DIA).has("Ana"), "Ana representa el turno");
    assert.ok(fuera.get(DIA).has("Bea"));
});

test("un turno con UN solo cubridor no saca a nadie", () => {
    const fuera = extraCoverWorkersByDate([
        rep("Ana"),
        rep("Bea", { replaced: "Otro" })
    ]);

    assert.equal(fuera.size, 0);
});

test("se agrupa por fecha, para poder preguntar dia a dia", () => {
    const fuera = extraCoverWorkersByDate([
        rep("Ana"),
        rep("Bea"),
        rep("Ana", { date: "2026-09-21" }),
        rep("Carla", { date: "2026-09-21" })
    ]);

    assert.deepEqual([...fuera.keys()].sort(), ["2026-09-20", "2026-09-21"]);
    assert.deepEqual([...fuera.get("2026-09-21")], ["Carla"]);
});

test("la misma persona dos veces en el mismo turno no se saca a si misma", () => {
    // Puede pasar si un tramo se guarda dos veces. Sacarla la borraria del
    // recuento por completo, que es peor que contarla una vez.
    const fuera = extraCoverWorkersByDate([rep("Ana"), rep("Ana")]);

    assert.equal(fuera.size, 0);
});

/* =========================================================
   Las horas que aporta cada uno
========================================================= */

test("sin tramo, un reemplazo vale el turno entero", () => {
    // Todos los reemplazos guardados antes de que existiera el reparto vienen
    // sin horario: tienen que seguir valiendo lo mismo que siempre.
    assert.equal(coveredShiftHours(rep("Ana"), 12), 12);
    assert.equal(coveredShiftHours(rep("Ana", { coverFrom: "08:00" }), 12), 12);
});

test("con tramo, vale lo que dura el tramo", () => {
    assert.equal(
        coveredShiftHours(
            rep("Ana", { coverFrom: "08:00", coverUntil: "14:00" }),
            12
        ),
        6
    );
});

test("las horas de un turno repartido suman el turno completo", () => {
    // Es la razon de ser de esto: el total publicado no puede crecer porque el
    // turno se haya repartido entre mas gente.
    const tramos = [
        rep("Ana", { coverFrom: "08:00", coverUntil: "12:00" }),
        rep("Bea", { coverFrom: "12:00", coverUntil: "16:00" }),
        rep("Ceci", { coverFrom: "16:00", coverUntil: "20:00" })
    ];
    const total = tramos.reduce(
        (suma, record) => suma + coveredShiftHours(record, 12),
        0
    );

    assert.equal(total, 12);
    // Y el turno sigue siendo uno solo.
    assert.equal(distinctCoveredShifts(tramos), 1);
});

test("un tramo de noche da la vuelta a la medianoche", () => {
    assert.equal(
        coveredShiftHours(
            rep("Ana", { coverFrom: "20:00", coverUntil: "02:00" }),
            12
        ),
        6
    );
});

test("entrada y salida iguales son el turno entero, no cero", () => {
    assert.equal(
        coveredShiftHours(
            rep("Ana", { coverFrom: "08:00", coverUntil: "08:00" }),
            12
        ),
        24
    );
});

/* =========================================================
   Agrupar para mostrar
========================================================= */

test("se pueden pedir los cubridores de cada turno", () => {
    const grupos = coverersByShift([
        rep("Ana"),
        rep("Bea"),
        rep("Carla", { replaced: "Otro" })
    ]);

    assert.equal(grupos.size, 2);
    assert.deepEqual(
        grupos.get("Ausente|2026-09-20|2").map(record => record.worker),
        ["Ana", "Bea"]
    );
});
