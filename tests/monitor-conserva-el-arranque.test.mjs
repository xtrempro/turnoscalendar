// La cola de eventos del monitor no puede tirar el ARRANQUE.
//
// Descartaba por antiguedad, y una sola carga genera mas de 140 tareas largas:
// los eventos del arranque -los mas valiosos para diagnosticar una carga lenta-
// eran los primeros en desaparecer.
//
// El 2026-09-22 eso costo dos rondas de diagnostico. `start-sync` marcaba 53 s y
// las fases medidas sumaban 9: parecia haber un hueco de 44 s en la hidratacion.
// No lo habia. Las fases `servicios` y `documentos` SI se habian medido, y la
// cola las habia desalojado antes de que nadie las leyera. Dos tandas de sondas
// persiguiendo un artefacto de la herramienta.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fuente = (await readFile(
    new URL("../js/performanceMonitor.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

function cuerpo(nombre) {
    const start = fuente.indexOf("function " + nombre + "(");

    assert.notEqual(start, -1, "no se encontro: " + nombre);

    const open = fuente.indexOf("{", fuente.indexOf(")", start));
    let depth = 0;
    let end = open;

    for (; end < fuente.length; end += 1) {
        if (fuente[end] === "{") depth += 1;
        else if (fuente[end] === "}") {
            depth -= 1;

            if (!depth) break;
        }
    }

    return fuente.slice(start, end + 1);
}

const MAX = Number(
    fuente.match(/const PERF_MAX_EVENTS = (\d+);/)[1]
);
const PRIMEROS = Number(
    fuente.match(/const PERF_KEEP_FIRST = (\d+);/)[1]
);

const trimEvents = new Function(
    "PERF_MAX_EVENTS",
    "PERF_KEEP_FIRST",
    cuerpo("trimEvents") + "\nreturn trimEvents;"
)(MAX, PRIMEROS);

/** Una lista de n eventos, numerados para poder seguirles la pista. */
const lista = n => Array.from({ length: n }, (_, i) => i);

test("por debajo del tope no se toca nada", () => {
    const corta = lista(MAX);

    assert.deepEqual(trimEvents(corta), corta);
});

test("pasado el tope se conserva el ARRANQUE", () => {
    const salida = trimEvents(lista(MAX * 3));

    // Los primeros son los del arranque: la carga que se quiere diagnosticar.
    assert.deepEqual(salida.slice(0, PRIMEROS), lista(PRIMEROS));
});

test("y tambien lo mas RECIENTE, que es lo que esta pasando ahora", () => {
    const total = MAX * 3;
    const salida = trimEvents(lista(total));

    assert.equal(salida[salida.length - 1], total - 1);
});

test("lo que se tira es el MEDIO, y se respeta el tope", () => {
    const salida = trimEvents(lista(MAX * 3));

    assert.equal(salida.length, MAX);
});

test("el arranque sobrevive por muchos eventos que lleguen despues", () => {
    // Es el caso real: una sesion larga no puede borrar como arranco.
    const salida = trimEvents(lista(MAX * 50));

    assert.equal(salida[0], 0);
    assert.equal(salida[PRIMEROS - 1], PRIMEROS - 1);
});

test("nada raro revienta la cola", () => {
    assert.deepEqual(trimEvents(null), []);
    assert.deepEqual(trimEvents(undefined), []);
    assert.deepEqual(trimEvents([]), []);
});

test("se reserva para el arranque bastante menos que el tope", () => {
    // Si PERF_KEEP_FIRST se acercara a PERF_MAX_EVENTS, la cola dejaria de
    // seguir lo reciente y el monitor solo veria el pasado.
    assert.ok(
        PRIMEROS * 4 <= MAX,
        "la reserva del arranque se esta comiendo la cola"
    );
});

test("las tres podas usan la MISMA funcion", () => {
    // Cargar de localStorage y persistir tenian su propio `slice(-MAX)`: con uno
    // solo que quedara, el arranque se perderia igual al recargar.
    assert.doesNotMatch(fuente, /slice\(-PERF_MAX_EVENTS\)/);
    assert.equal(
        (fuente.match(/trimEvents\(/g) || []).length >= 4,
        true,
        "alguna de las tres podas no pasa por trimEvents"
    );
});
