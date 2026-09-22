// El publicador RRHH de 2do plano no debe secuestrar el hilo ni reintentar solo.
//
// Medido el 2026-09-21 en la unidad de ~68 trabajadores: `staffing:analizar-mes`
// costaba 2,9 s de hilo principal BLOQUEADO por llamada, y aparecia dos veces en
// dos minutos. Dos defectos encadenados:
//
//  1. Llamaba a la `analizarMes` bloqueante, que recorre los 30 dias de una, en
//     vez de la cooperativa que cede el hilo entre dia y dia.
//  2. El freno de MIN_INTERVAL_MS solo avanzaba CUANDO LA PUBLICACION TENIA
//     EXITO. Con las escrituras fallando -el stream saturado- `lastRun` no se
//     movia y `dirty` seguia en true, asi que el temporizador de 60 s volvia a
//     recalcular el mes completo cada minuto, para siempre.
//
// El (2) es el que se prueba de verdad aqui, ejecutando `maybePublish`. El resto
// se fija sobre el codigo fuente: tocan Firestore y no se pueden correr.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const publicador = (await readFile(
    new URL("../js/rrhhSummaryPublisher.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

const staffing = (await readFile(
    new URL("../js/staffing.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

/** El cuerpo de una funcion, conservando el `async` si lo tiene. */
function cuerpo(fuente, nombre) {
    let start = fuente.indexOf("async function " + nombre + "(");

    if (start === -1) start = fuente.indexOf("function " + nombre + "(");

    assert.notEqual(start, -1, "no se encontro: " + nombre);

    const abre = fuente.indexOf("(", start);
    let parens = 0;
    let cierra = abre;

    for (; cierra < fuente.length; cierra += 1) {
        if (fuente[cierra] === "(") parens += 1;
        else if (fuente[cierra] === ")") {
            parens -= 1;

            if (!parens) break;
        }
    }

    const open = fuente.indexOf("{", cierra);
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

/**
 * Arma `maybePublish` con sus dependencias inyectadas. Las tres variables de
 * modulo -dirty, lastRun, running- se declaran DENTRO de la fabrica para que el
 * cuerpo las escriba de verdad y el test pueda leerlas entre llamadas.
 */
function construir({ inicial = {}, publicar } = {}) {
    const preludio =
        "let dirty = inicial.dirty, lastRun = inicial.lastRun, running = false;\n";
    const epilogo =
        "\nreturn { maybePublish, estado: function () {" +
        " return { dirty: dirty, lastRun: lastRun, running: running }; } };";
    const fabrica = new Function(
        "MIN_INTERVAL_MS",
        "getActiveWorkspace",
        "idleYield",
        "publishRrhhSummary",
        "inicial",
        preludio + cuerpo(publicador, "maybePublish") + epilogo
    );

    return fabrica(
        5 * 60 * 1000,
        () => ({ id: "ws1" }),
        () => Promise.resolve(),
        publicar,
        { dirty: true, lastRun: 0, ...inicial }
    );
}

/* =========================================================
   El defecto principal: un fallo no debe reintentar cada minuto
========================================================= */

test("una publicacion que FALLA igual mueve el freno", async () => {
    let veces = 0;
    const armado = construir({
        publicar: async () => {
            veces += 1;
            throw new Error("resource-exhausted");
        }
    });

    await armado.maybePublish();

    assert.equal(veces, 1);
    assert.ok(
        armado.estado().lastRun > 0,
        "el freno tiene que avanzar aunque la escritura sea rechazada"
    );
});

test("y por eso el tick del minuto siguiente NO recalcula el mes", async () => {
    // Este es el bug medido: 2,9 s de bloqueo cada 60 s mientras el stream
    // estuviera saturado.
    let veces = 0;
    const armado = construir({
        publicar: async () => {
            veces += 1;
            throw new Error("resource-exhausted");
        }
    });

    await armado.maybePublish();
    await armado.maybePublish();
    await armado.maybePublish();

    assert.equal(veces, 1, "el freno de 5 minutos tiene que frenar los reintentos");
});

test("un fallo deja el resumen SUCIO, para reintentarlo cuando toque", async () => {
    const armado = construir({
        publicar: async () => { throw new Error("red caida"); }
    });

    await armado.maybePublish();

    assert.equal(armado.estado().dirty, true);
});

/* =========================================================
   El camino bueno y el abandono
========================================================= */

test("una publicacion con exito deja el resumen limpio", async () => {
    const armado = construir({
        publicar: async () => ({ month: "2026-09" })
    });

    await armado.maybePublish();

    assert.equal(armado.estado().dirty, false);
    assert.ok(armado.estado().lastRun > 0);
});

test("si el analisis se abandono (null), sigue sucio pese a no fallar", async () => {
    // publishRrhhSummary devuelve null cuando el mes se calculo a medias: no hay
    // nada publicado, asi que no puede darse por limpio.
    const armado = construir({
        publicar: async () => null
    });

    await armado.maybePublish();

    assert.equal(armado.estado().dirty, true);
    assert.ok(
        armado.estado().lastRun > 0,
        "pero el freno avanza igual, o volveria a intentarlo en 60 s"
    );
});

test("dentro del freno no se publica, ni estando sucio", async () => {
    let veces = 0;
    const armado = construir({
        inicial: { dirty: true, lastRun: Date.now() },
        publicar: async () => {
            veces += 1;
            return { month: "2026-09" };
        }
    });

    await armado.maybePublish();

    assert.equal(veces, 0);
});

test("limpio no se publica aunque el freno ya paso", async () => {
    let veces = 0;
    const armado = construir({
        inicial: { dirty: false, lastRun: 0 },
        publicar: async () => {
            veces += 1;
            return { month: "2026-09" };
        }
    });

    await armado.maybePublish();

    assert.equal(veces, 0);
});

/* =========================================================
   El cableado: la variante que cede el hilo
========================================================= */

test("el publicador usa la variante COOPERATIVA", () => {
    assert.match(
        publicador,
        /import \{ analizarMesCooperative \} from "\.\/staffing\.js";/
    );
    assert.match(
        publicador,
        /const staffingMes = await analizarMesCooperative\(year, month0, holidays\);/
    );
});

test("y no queda ni rastro de la bloqueante", () => {
    // Referenciarla sin importarla compila igual y revienta al publicar.
    assert.doesNotMatch(publicador, /\banalizarMes\(/);
    assert.doesNotMatch(publicador, /import \{ analizarMes \}/);
});

test("la cooperativa esta exportada", () => {
    assert.match(staffing, /export async function analizarMesCooperative\(/);
});

test("la bloqueante sigue exportada: la usa el dashboard", () => {
    assert.match(staffing, /export function analizarMes\(/);
});

/* =========================================================
   Un analisis a medias no se publica
========================================================= */

test("si el mes vuelve null, no se arma resumen", () => {
    assert.match(publicador, /if \(!staffingMes\) return null;/);
});

test("y publishRrhhSummary no escribe con un computo abandonado", () => {
    // Desestructurar null reventaria; y escribir un resumen a medias publicaria
    // una cifra falsa de turnos sin cubrir.
    assert.match(
        publicador,
        /const computed = await computeRrhhSummary\(year, month0, workspace\.id\);/
    );
    assert.match(publicador, /if \(!computed\) return null;/);
    assert.match(
        publicador,
        /const \{ summary, loanOut \} = computed;/
    );
});
