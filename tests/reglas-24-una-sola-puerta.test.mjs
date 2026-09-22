// Las reglas del 24 se preguntan por las DOS o por ninguna.
//
// Son dos funciones distintas:
//
//   turnoBloqueadoPorTurno24           el 24 de un dia, y lo que no puede ir
//                                      pegado a un 24 el dia antes o el siguiente
//   turnoBloqueadoPorTurno24Invertido  Noche y, a la manana siguiente, algo que
//                                      empieza de dia. Cruza DOS dias, y es la
//                                      que gobierna "Permitir turnos de 24 horas
//                                      invertidos"
//
// El 2026-09-22 se exporto SOLO la primera y el cuadro de contrato de reemplazo
// la uso creyendo que era la regla entera: con Noche el dia 5 y libre el 6,
// heredaba una Larga el 6 en una unidad que tenia el invertido PROHIBIDO. La
// edicion directa del calendario si consultaba las dos, asi que el mismo turno
// se bloqueaba a mano y se colaba al heredar.
//
// De ahi `turnoBloqueadoPorReglas24`: una sola puerta, para que nadie de fuera
// pueda volver a preguntar por media regla.
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const motor = (await readFile(
    new URL("../js/turnEngine.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

test("la puerta unica esta exportada", () => {
    assert.match(
        motor,
        /export function turnoBloqueadoPorReglas24\(nombre, key, turno\)/
    );
});

test("y consulta las DOS reglas", () => {
    const start = motor.indexOf("export function turnoBloqueadoPorReglas24(");
    const cuerpo = motor.slice(start, motor.indexOf("\n}", start));

    assert.match(cuerpo, /turnoBloqueadoPorTurno24\(nombre, key, turno\)/);
    assert.match(
        cuerpo,
        /turnoBloqueadoPorTurno24Invertido\(nombre, key, turno\)/
    );
});

test("la mitad invertida NO se exporta", () => {
    // Exportarla invita a usar una sola, que es justo el defecto. La otra si
    // esta exportada desde antes, y la usa su propia prueba de unidad
    // (tests/diurno-post-24.test.mjs): eso es legitimo.
    assert.doesNotMatch(
        motor,
        /export function turnoBloqueadoPorTurno24Invertido\(/
    );
});

test("la edicion directa usa la MISMA puerta", () => {
    // Tenia su propia pareja de llamadas. Con dos copias, arreglar una deja la
    // otra atras: es como empezo esto.
    const start = motor.indexOf("const isBlocked =");

    assert.notEqual(start, -1, "ya no existe isBlocked");

    const cuerpo = motor.slice(start, motor.indexOf(";", start));

    assert.match(cuerpo, /turnoBloqueadoPorReglas24\(nombre, key, turno\)/);
    assert.doesNotMatch(cuerpo, /turnoBloqueadoPorTurno24Invertido/);
});

test("ningun modulo de produccion IMPORTA media regla", async () => {
    // El guardia de verdad: si alguien se trae una mitad, vuelve el defecto.
    // Se miran los imports, no las menciones: replacementCandidates.js la
    // nombra en un comentario porque reimplementa la regla a proposito, sobre
    // el estado comprometido en vez del programado.
    const dir = new URL("../js/", import.meta.url);
    const archivos = (await readdir(dir)).filter(n => n.endsWith(".js"));
    const culpables = [];

    for (const nombre of archivos) {
        if (nombre === "turnEngine.js") continue;

        const texto = await readFile(new URL(nombre, dir), "utf8");
        const imports = texto.match(/import \{[^}]*\} from "\.\/turnEngine\.js";/g) || [];

        if (imports.some(bloque =>
            /turnoBloqueadoPorTurno24/.test(bloque) ||
            /turnoBloqueadoPorTurno24Invertido/.test(bloque)
        )) {
            culpables.push(nombre);
        }
    }

    assert.deepEqual(
        culpables,
        [],
        "estos importan una sola de las dos reglas del 24"
    );
});
