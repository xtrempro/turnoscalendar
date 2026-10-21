// Tres tropiezos vistos en pruebas el 2026-10-21, todos del mismo rato:
//
//   1. "No se pudo revisar si ya está activo en otra unidad". La funcion no
//      pudo traer las claves de Google -"Error fetching Json Web Keys: socket
//      hang up"- y rechazo un token de App Check que estaba bien (auth VALID,
//      app INVALID). Un tropiezo de red contestaba la pregunta equivocada.
//
//   2. "Resultado reemplazado por una solicitud más reciente", dos veces, y el
//      cuadro de la rotativa seguia abierto. Guardar tarda -consulta el RUT,
//      conserva los turnos anteriores, aplica la rotativa- y apretarlo de
//      nuevo arrancaba un SEGUNDO guardado: los dos pedian la misma rotativa y
//      el primero quedaba reemplazado.
//
//   3. Ese "reemplazado" llegaba a la pantalla como si fuera un error del
//      guardado, cuando lo que significa es que otro guardado tomo el relevo.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const leer = ruta => readFile(new URL(ruta, import.meta.url), "utf8");

const main = await leer("../js/main.js");
const handovers = await leer("../js/workerHandovers.js");

function extraer(fuente, nombre) {
    const inicio = fuente.indexOf(`function ${nombre}(`);

    assert.notEqual(inicio, -1, `no encontre ${nombre}`);

    const asincrona = fuente.lastIndexOf("async function", inicio);
    const desde = asincrona === inicio - 6 ? asincrona : inicio;
    let parentesis = 0;
    let cuerpo = -1;

    for (let i = fuente.indexOf("(", inicio); i < fuente.length; i += 1) {
        if (fuente[i] === "(") parentesis += 1;
        else if (fuente[i] === ")") {
            parentesis -= 1;
            if (!parentesis) {
                cuerpo = fuente.indexOf("{", i);
                break;
            }
        }
    }

    assert.notEqual(cuerpo, -1, `no encontre el cuerpo de ${nombre}`);

    let profundidad = 0;

    for (let i = cuerpo; i < fuente.length; i += 1) {
        if (fuente[i] === "{") profundidad += 1;
        else if (fuente[i] === "}") {
            profundidad -= 1;
            if (!profundidad) return fuente.slice(desde, i + 1);
        }
    }

    throw new Error(`sin cierre: ${nombre}`);
}

// --- 1. La consulta del RUT reintenta lo que es del momento ---

function montarBusqueda({ respuestas }) {
    const intentos = [];
    const pendientes = [...respuestas];
    const fabrica = new Function(
        "getActiveWorkspace",
        "callFunction",
        "console",
        "setTimeout",
        `${extraer(handovers, "isTransientCallError")}
         const TRANSIENT_CALL_CODES = ${JSON.stringify([...(
             handovers
                 .slice(
                     handovers.indexOf("const TRANSIENT_CALL_CODES"),
                     handovers.indexOf("]);", handovers.indexOf("const TRANSIENT_CALL_CODES"))
                 )
                 .matchAll(/"([^"]+)"/g)
         )].map(m => m[1]))}.reduce((set, code) => set.add(code), new Set());
         const esperar = ms => new Promise(resolve => setTimeout(resolve, 0));
         ${extraer(handovers, "findWorkerInEstablishment")}
         return findWorkerInEstablishment;`
    );

    return {
        intentos,
        buscar: fabrica(
            () => ({ id: "ws-1" }),
            async datos => {
                intentos.push(datos);

                const siguiente = pendientes.shift();

                if (siguiente instanceof Error) throw siguiente;

                return siguiente;
            },
            { warn() {} },
            (fn) => fn()
        )
    };
}

function errorCon(code) {
    const error = new Error(`falla ${code}`);

    error.code = code;

    return error;
}

test("un tropiezo de App Check no se da por respuesta", async () => {
    const { buscar, intentos } = montarBusqueda({
        respuestas: [
            errorCon("functions/unauthenticated"),
            { establishment: "hospital", unidades: [{ workspaceId: "ws-2", active: true }] }
        ]
    });

    const resultado = await buscar("310050040");

    assert.equal(intentos.length, 2, "reintenta");
    assert.equal(resultado.unidades.length, 1);
});

test("reintenta hasta tres veces y despues si se rinde", async () => {
    const { buscar, intentos } = montarBusqueda({
        respuestas: [
            errorCon("functions/internal"),
            errorCon("functions/unavailable"),
            errorCon("functions/deadline-exceeded")
        ]
    });

    await assert.rejects(buscar("310050040"), /deadline-exceeded/);
    assert.equal(intentos.length, 3);
});

test("lo que no es del momento se levanta de inmediato", async () => {
    // Sin permiso para preguntar, reintentar solo hace perder el tiempo.
    const { buscar, intentos } = montarBusqueda({
        respuestas: [errorCon("functions/permission-denied")]
    });

    await assert.rejects(buscar("310050040"), /permission-denied/);
    assert.equal(intentos.length, 1);
});

test("si contesta a la primera, no reintenta nada", async () => {
    const { buscar, intentos } = montarBusqueda({
        respuestas: [{ establishment: "hospital", unidades: [] }]
    });

    await buscar("310050040");

    assert.equal(intentos.length, 1);
});

// --- 2. Un guardado a la vez ---

function montarGuardado() {
    const corridas = [];
    let terminar = () => {};
    const enCurso = new Promise(resolve => { terminar = resolve; });
    const fabrica = new Function(
        "saveProfileNow",
        `let profileSaveInFlight = null;
         ${extraer(main, "guardarPerfil")}
         return { guardar: guardarPerfil, ver: () => profileSaveInFlight };`
    );
    const { guardar, ver } = fabrica(async () => {
        corridas.push(Date.now());
        await enCurso;
        return true;
    });

    return { guardar, ver, corridas, terminar: () => terminar() };
}

test("apretar Guardar dos veces no arranca dos guardados", async () => {
    const { guardar, corridas, terminar } = montarGuardado();

    const primero = guardar();
    const segundo = guardar();

    assert.equal(corridas.length, 1, "el segundo clic no arranca otro");

    terminar();

    assert.equal(await primero, true);
    assert.equal(await segundo, true, "y recibe el mismo resultado");
});

test("terminado uno, el siguiente guardado si corre", async () => {
    const { guardar, corridas, terminar, ver } = montarGuardado();

    const primero = guardar();

    terminar();
    await primero;

    assert.equal(ver(), null, "deja de estar en curso");

    void guardar();

    assert.equal(corridas.length, 2);
});

// --- 3. Un relevo no es un error ---

test("el guardado reemplazado por otro no le grita a nadie", () => {
    const guardar = extraer(main, "saveProfileNow");
    const cierre = guardar.slice(guardar.lastIndexOf("} catch (error) {"));

    assert.match(cierre, /error\?\.name === "AbortError"/);
    // Primero el filtro, despues el alert de siempre.
    assert.ok(
        cierre.indexOf("AbortError") < cierre.indexOf("alert("),
        "el filtro va antes del aviso"
    );
    assert.match(cierre, /return false;/);
});
