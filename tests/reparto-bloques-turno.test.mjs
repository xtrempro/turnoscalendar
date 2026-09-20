// El turno como una tira continua de bloques.
//
// Antes el cuadro de horas guardaba una lista de tramos sueltos y validaba al
// final que no se pisaran. El usuario pidio otra cosa: que el traslape sea
// IMPOSIBLE de construir. Por eso el turno pasa a ser una tira continua de
// punta a punta, donde cada bloque termina exactamente donde empieza el
// siguiente y un hueco es un bloque mas, sin nombre.
//
// Los dos gestos son distintos a proposito:
//   - mover el limite entre dos bloques ARRASTRA al vecino (siguen pegados);
//   - atrasar la entrada de un bloque ABRE un hueco (el vecino no lo sigue).
//
// Todo se mide en minutos DESDE el inicio del turno: la noche cruza la
// medianoche y ahi "02:00" es posterior a "22:00".
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const calendar = (await readFile(
    new URL("../js/calendar.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

/** El cuerpo de una funcion, contando llaves. */
function cuerpo(nombre) {
    const start = calendar.indexOf(`function ${nombre}(`);

    assert.notEqual(start, -1, `no se encontro: ${nombre}`);

    const open = calendar.indexOf("{", start);
    let depth = 0;
    let end = open;

    for (; end < calendar.length; end += 1) {
        if (calendar[end] === "{") depth += 1;
        else if (calendar[end] === "}") {
            depth -= 1;

            if (!depth) break;
        }
    }

    return calendar.slice(start, end + 1);
}

const minimo = /const COVER_MIN_TRAMO = (\d+);/.exec(calendar);

assert.ok(minimo, "no se encontro COVER_MIN_TRAMO");

const PASO = Number(minimo[1]);
const modelo = new Function(`
    const COVER_MIN_TRAMO = ${PASO};
    ${cuerpo("coverTimeToMinutes")}
    ${cuerpo("coverMinutesToTime")}
    ${cuerpo("coverSpanMinutes")}
    ${cuerpo("coverShiftSegments")}
    ${cuerpo("coverFillGaps")}
    ${cuerpo("coverStepBoundary")}
    ${cuerpo("coverOpenGapBefore")}
    ${cuerpo("coverSegmentsToTramos")}
    ${cuerpo("coverSegmentsToGaps")}
    return {
        coverShiftSegments,
        coverFillGaps,
        coverStepBoundary,
        coverOpenGapBefore,
        coverSegmentsToTramos,
        coverSegmentsToGaps
    };
`)();

const LARGA = { from: "08:00", until: "20:00" };
const NOCHE = { from: "20:00", until: "08:00" };

/** Solo los limites, que es lo que importa al comparar. */
const limites = segments => segments.map(segment =>
    [segment.worker || "", segment.desde, segment.hasta]
);

/* =========================================================
   La tira de entrada
========================================================= */

test("dos personas parten el turno por la mitad", () => {
    assert.deepEqual(
        limites(modelo.coverShiftSegments(LARGA, ["Ana", "Bea"])),
        [["Ana", 0, 360], ["Bea", 360, 720]]
    );
});

test("tres lo parten en tres, y la tira no deja huecos", () => {
    const tira = modelo.coverShiftSegments(LARGA, ["Ana", "Bea", "Ceci"]);

    assert.deepEqual(
        limites(tira),
        [["Ana", 0, 240], ["Bea", 240, 480], ["Ceci", 480, 720]]
    );
    // Cada uno empieza donde termino el anterior: eso es lo que hace imposible
    // el traslape.
    tira.slice(1).forEach((segment, index) => {
        assert.equal(segment.desde, tira[index].hasta);
    });
});

test("si no alcanza para todos, no hay tira", () => {
    // Una hora entre tres son 20 minutos cada uno.
    assert.deepEqual(
        modelo.coverShiftSegments({ from: "08:00", until: "09:00" }, [
            "Ana",
            "Bea",
            "Ceci"
        ]),
        []
    );
});

/* =========================================================
   Mover el limite: el vecino SIGUE
========================================================= */

test("retroceder la salida del primero pega la entrada del segundo", () => {
    // El gesto que describio el usuario: no queda hueco entre medio.
    const tira = modelo.coverShiftSegments(LARGA, ["Ana", "Bea"]);
    const movida = modelo.coverStepBoundary(tira, 0, -1);

    assert.deepEqual(
        limites(movida),
        [["Ana", 0, 330], ["Bea", 330, 720]]
    );
});

test("adelantar la salida tambien arrastra al vecino", () => {
    const tira = modelo.coverShiftSegments(LARGA, ["Ana", "Bea"]);

    assert.deepEqual(
        limites(modelo.coverStepBoundary(tira, 0, 2)),
        [["Ana", 0, 420], ["Bea", 420, 720]]
    );
});

test("el limite no puede dejar a nadie por debajo del minimo", () => {
    const tira = [
        { worker: "Ana", desde: 0, hasta: 30 },
        { worker: "Bea", desde: 30, hasta: 720 }
    ];

    // Ana quedaria en cero.
    assert.deepEqual(limites(modelo.coverStepBoundary(tira, 0, -1)), limites(tira));

    const otra = [
        { worker: "Ana", desde: 0, hasta: 690 },
        { worker: "Bea", desde: 690, hasta: 720 }
    ];

    assert.deepEqual(limites(modelo.coverStepBoundary(otra, 0, 1)), limites(otra));
});

test("en el ultimo bloque no hay limite que mover", () => {
    const tira = modelo.coverShiftSegments(LARGA, ["Ana", "Bea"]);

    assert.deepEqual(limites(modelo.coverStepBoundary(tira, 1, 1)), limites(tira));
});

/* =========================================================
   Atrasar la entrada: se ABRE un hueco
========================================================= */

test("atrasar la entrada del segundo deja un hueco a la vista", () => {
    // El vecino NO lo sigue: esas horas no las hace nadie, y el hueco es un
    // bloque mas de la tira para poder decidir que hacer con el.
    const tira = modelo.coverShiftSegments(LARGA, ["Ana", "Bea"]);
    const conHueco = modelo.coverOpenGapBefore(tira, 1, 1);

    assert.deepEqual(
        limites(conHueco),
        [["Ana", 0, 360], ["", 360, 390], ["Bea", 390, 720]]
    );
});

test("adelantar la entrada se come el hueco y lo hace desaparecer", () => {
    const tira = [
        { worker: "Ana", desde: 0, hasta: 360 },
        { worker: "", desde: 360, hasta: 390 },
        { worker: "Bea", desde: 390, hasta: 720 }
    ];

    // Un bloque vacio de cero minutos seria ruido: se va.
    assert.deepEqual(
        limites(modelo.coverOpenGapBefore(tira, 2, -1)),
        [["Ana", 0, 360], ["Bea", 360, 720]]
    );
});

test("la entrada no puede pasar por encima de quien viene antes", () => {
    // Por encima del bloque con gente, el gesto seria mover el limite, que es
    // el otro boton y arrastra al vecino.
    const tira = modelo.coverShiftSegments(LARGA, ["Ana", "Bea"]);

    assert.deepEqual(limites(modelo.coverOpenGapBefore(tira, 1, -1)), limites(tira));
});

test("ni dejar al propio bloque por debajo del minimo", () => {
    const tira = [
        { worker: "Ana", desde: 0, hasta: 360 },
        { worker: "Bea", desde: 360, hasta: 390 }
    ];

    assert.deepEqual(limites(modelo.coverOpenGapBefore(tira, 1, 1)), limites(tira));
});

/* =========================================================
   La tira siempre cierra
========================================================= */

test("dos huecos seguidos se funden en uno", () => {
    // Dos bloques vacios pegados dirian lo mismo dos veces y pedirian dos
    // decisiones para una sola franja.
    const tira = modelo.coverFillGaps([
        { worker: "", desde: 0, hasta: 60 },
        { worker: "", desde: 60, hasta: 120 },
        { worker: "Ana", desde: 120, hasta: 720 }
    ]);

    assert.deepEqual(
        limites(tira),
        [["", 0, 60], ["", 60, 120], ["Ana", 120, 720]]
    );
});

test("donde dos bloques dejaron de tocarse aparece un hueco", () => {
    assert.deepEqual(
        limites(modelo.coverFillGaps([
            { worker: "Ana", desde: 0, hasta: 300 },
            { worker: "Bea", desde: 420, hasta: 720 }
        ])),
        [["Ana", 0, 300], ["", 300, 420], ["Bea", 420, 720]]
    );
});

/* =========================================================
   De vuelta a horas de reloj
========================================================= */

test("los bloques con gente vuelven a ser tramos", () => {
    const tira = modelo.coverShiftSegments(LARGA, ["Ana", "Bea"]);

    assert.deepEqual(modelo.coverSegmentsToTramos(tira, LARGA), [
        { worker: "Ana", from: "08:00", until: "14:00" },
        { worker: "Bea", from: "14:00", until: "20:00" }
    ]);
});

test("y en la noche las horas dan la vuelta a la medianoche", () => {
    const tira = modelo.coverShiftSegments(NOCHE, ["Ana", "Bea"]);

    assert.deepEqual(modelo.coverSegmentsToTramos(tira, NOCHE), [
        { worker: "Ana", from: "20:00", until: "02:00" },
        { worker: "Bea", from: "02:00", until: "08:00" }
    ]);
});

test("los huecos se pueden pedir aparte, para preguntar por ellos", () => {
    const tira = modelo.coverOpenGapBefore(
        modelo.coverShiftSegments(LARGA, ["Ana", "Bea"]),
        1,
        2
    );

    assert.deepEqual(modelo.coverSegmentsToGaps(tira, LARGA), [
        { from: "14:00", until: "15:00" }
    ]);
});

test("sin huecos no hay nada que preguntar", () => {
    const tira = modelo.coverShiftSegments(LARGA, ["Ana", "Bea"]);

    assert.deepEqual(modelo.coverSegmentsToGaps(tira, LARGA), []);
});
