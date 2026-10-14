// Pedir el traspaso de alguien que todavia no tiene rotativa.
//
// Un reemplazo entra antes de que se sepa en que turno va a quedar. Hasta el
// 2026-10-14 el pedido obligaba a elegir una de las tres rotativas y, enseguida,
// el dia desde el que empieza esa rotativa: no habia forma de decir "todavia no
// se", y elegir una cualquiera le dejaba el calendario lleno de turnos que
// despues habia que borrar.
//
// "Sin definir aun" usa la rotativa "libre", que ya es la que la app entiende
// como calendario base vacio: asi el perfil que se crea al otro lado no necesita
// aprender nada nuevo.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
);

function extraer(nombre) {
    const inicio = main.indexOf(`function ${nombre}(`);

    assert.notEqual(inicio, -1, `no encontre ${nombre}`);

    const asincrona = main.lastIndexOf("async function", inicio);
    const desde = asincrona === inicio - 6 ? asincrona : inicio;
    // El cuerpo empieza DESPUES de los parametros: un parametro con llaves
    // -{ discardDraft = false } = {}- cortaba la funcion por la mitad.
    let parentesis = 0;
    let cuerpo = -1;

    for (let i = main.indexOf("(", inicio); i < main.length; i += 1) {
        if (main[i] === "(") parentesis += 1;
        else if (main[i] === ")") {
            parentesis -= 1;
            if (!parentesis) {
                cuerpo = main.indexOf("{", i);
                break;
            }
        }
    }

    assert.notEqual(cuerpo, -1, `no encontre el cuerpo de ${nombre}`);

    let profundidad = 0;

    for (let i = cuerpo; i < main.length; i += 1) {
        if (main[i] === "{") profundidad += 1;
        else if (main[i] === "}") {
            profundidad -= 1;
            if (!profundidad) return main.slice(desde, i + 1);
        }
    }

    throw new Error(`sin cierre: ${nombre}`);
}

// El valor de verdad, no una copia: si manana "libre" cambiara, estas pruebas
// seguirian probando lo que el cuadro usa.
const CONSTANTE_SIN_ROTATIVA = main.match(
    /const HANDOVER_SIN_ROTATIVA = "[^"]+";/
)?.[0];

assert.ok(CONSTANTE_SIN_ROTATIVA, "no encontre HANDOVER_SIN_ROTATIVA");
assert.match(CONSTANTE_SIN_ROTATIVA, /"libre"/);

// Las dos funciones reales del cuadro, sobre dependencias de mentira.
function montar({
    modalidad = "libre",
    fecha = "2026-11-03",
    rotativaGuardada = { rotationStart: "2026-11-03", rotationFirstTurn: "larga" }
} = {}) {
    const preguntas = [];
    const fechas = [];
    const configuraciones = [];
    const avisos = [];
    const fabrica = new Function(
        "isProfileEditing",
        "showChoice",
        "showPrompt",
        "showAlert",
        "transferTomorrowISO",
        "normalizeStoredStart",
        "openRotationConfigModal",
        "requiresRotationFirstTurn",
        "getRotativaLabel",
        "getRotationFirstTurnLabel",
        `${CONSTANTE_SIN_ROTATIVA}
         ${extraer("askHandoverStartDate")}
         ${extraer("askHandoverSchedule")}
         return askHandoverSchedule;`
    );
    const pedir = fabrica(
        () => true,
        async (mensaje, opciones) => {
            preguntas.push(opciones);
            return modalidad;
        },
        async (mensaje, opciones) => {
            fechas.push({ mensaje, ...opciones });
            return fecha;
        },
        async mensaje => { avisos.push(mensaje); },
        () => "2026-10-15",
        valor => String(valor || ""),
        (tipo, opciones) => {
            configuraciones.push(tipo);
            opciones.onSaved?.(rotativaGuardada);
            opciones.onClosed?.();
        },
        tipo => tipo === "3turno" || tipo === "4turno",
        tipo => (tipo === "4turno" ? "4° Turno" : "Libre"),
        () => "Larga"
    );

    return { pedir, preguntas, fechas, configuraciones, avisos };
}

test("el cuadro ofrece 'Sin definir aún' junto a las rotativas", async () => {
    const { pedir, preguntas } = montar();

    await pedir();

    const opciones = preguntas[0].choices.map(opcion => opcion.value);

    assert.deepEqual(opciones, ["3turno", "4turno", "diurno", "libre"]);
    assert.equal(preguntas[0].choices[3].label, "Sin definir aún");
    // Que se entienda que no es una rotativa mas.
    assert.match(preguntas[0].choices[3].hint, /calendario queda libre/);
});

test("sin rotativa NO se abre el cuadro de configurarla", async () => {
    // Preguntar "desde cuando empieza la rotativa" cuando no hay ninguna no
    // significa nada, y es lo que llenaba el calendario de turnos de mas.
    const { pedir, configuraciones } = montar({ modalidad: "libre" });

    await pedir();

    assert.deepEqual(configuraciones, []);
});

test("sin rotativa se pregunta igual desde que dia es de esta unidad", async () => {
    // No es la fecha de una rotativa: es la que usa la otra unidad para vaciar
    // su calendario y mudarle la app. Sin ella no hay pedido que mandar.
    const { pedir, fechas } = montar({ modalidad: "libre" });
    const acordado = await pedir();

    assert.equal(fechas.length, 1);
    assert.equal(fechas[0].inputType, "date");
    assert.deepEqual(acordado, {
        startDate: "2026-11-03",
        rotationType: "libre",
        rotationFirstTurn: "",
        resumen: ""
    });
});

test("con una rotativa de verdad, el camino es el de siempre", async () => {
    const { pedir, fechas, configuraciones } = montar({ modalidad: "4turno" });
    const acordado = await pedir();

    assert.deepEqual(configuraciones, ["4turno"], "se configura la rotativa");
    assert.deepEqual(fechas, [], "y la fecha sale de ahi, no de otra pregunta");
    assert.equal(acordado.rotationType, "4turno");
    assert.equal(acordado.startDate, "2026-11-03");
    assert.match(acordado.resumen, /4° Turno/);
});

test("cancelar la fecha cancela el pedido", async () => {
    const { pedir } = montar({ modalidad: "libre", fecha: null });

    assert.equal(await pedir(), null);
});

test("una fecha invalida no se manda: se avisa y se corta", async () => {
    const { pedir, avisos } = montar({ modalidad: "libre", fecha: "mañana" });

    assert.equal(await pedir(), null);
    assert.equal(avisos.length, 1);
});

test("cerrar el cuadro de la modalidad no pregunta nada mas", async () => {
    const { pedir, fechas, configuraciones } = montar({ modalidad: "" });

    assert.equal(await pedir(), null);
    assert.deepEqual(fechas, []);
    assert.deepEqual(configuraciones, []);
});

// --- Lo que se le dice a quien pide ---

function montarPedido({ rotativa }) {
    const confirmaciones = [];
    const enviados = [];
    const fabrica = new Function(
        "showChoice",
        "askHandoverSchedule",
        "showConfirm",
        "formatDisplayDate",
        "requestWorkerHandover",
        "getCurrentActor",
        "addAuditLog",
        "AUDIT_CATEGORY",
        "forgetRutLookup",
        "discardProfileDraftChangesBeforeLeaving",
        "showAlert",
        "console",
        "alert",
        `${extraer("requestHandoverFromUnits")}
         return requestHandoverFromUnits;`
    );
    const pedir = fabrica(
        async () => "",
        async () => rotativa,
        async mensaje => { confirmaciones.push(mensaje); return true; },
        iso => iso,
        async datos => { enviados.push(datos); return { created: true }; },
        () => ({ name: "Supervisora" }),
        () => {},
        { COLLABORATOR_UPDATED: "collaborator" },
        () => {},
        () => {},
        async () => {},
        { warn() {} },
        () => {}
    );

    return { pedir, confirmaciones, enviados };
}

const URGENCIA = [{ workspaceId: "ws-1", workspaceName: "Urgencia Adulto" }];

test("al confirmar sin rotativa, la frase sigue siendo una frase", async () => {
    // "Comenzaría aquí el 03-11-2026, en ." era lo que salia al dejar el
    // resumen vacio dentro de la frase de siempre.
    const { pedir, confirmaciones } = montarPedido({
        rotativa: {
            startDate: "2026-11-03",
            rotationType: "libre",
            rotationFirstTurn: "",
            resumen: ""
        }
    });

    await pedir(URGENCIA, "31.000.001-9");

    assert.match(
        confirmaciones[0],
        /Comenzaría aquí el 2026-11-03, con su calendario libre hasta que definas su rotativa\./
    );
});

test("con rotativa, la confirmacion la nombra", async () => {
    const { pedir, confirmaciones } = montarPedido({
        rotativa: {
            startDate: "2026-11-03",
            rotationType: "4turno",
            rotationFirstTurn: "larga",
            resumen: "4° Turno (Larga)"
        }
    });

    await pedir(URGENCIA, "31.000.001-9");

    assert.match(confirmaciones[0], /Comenzaría aquí el 2026-11-03, en 4° Turno \(Larga\)\./);
});

test("la rotativa acordada viaja en el pedido tal cual", async () => {
    const { pedir, enviados } = montarPedido({
        rotativa: {
            startDate: "2026-11-03",
            rotationType: "libre",
            rotationFirstTurn: "",
            resumen: ""
        }
    });

    await pedir(URGENCIA, "31.000.001-9");

    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].rotationType, "libre");
    assert.equal(enviados[0].rotationFirstTurn, "");
    assert.equal(enviados[0].startDate, "2026-11-03");
});

// --- Que "libre" signifique calendario vacio en los dos lados ---

test("la rotativa libre no pide fecha de inicio ni genera turnos", async () => {
    const { requiresRotationStart } = await import("../js/rotationUtils.js");
    const { rotationProducesTurns } = await import("../js/rotationCatalog.js");

    // Si pidiera fecha, el perfil que llega por el traspaso no pasaria la
    // validacion; si generara turnos, el calendario no quedaria libre.
    assert.equal(requiresRotationStart("libre"), false);
    assert.equal(rotationProducesTurns("libre"), false);
    assert.equal(rotationProducesTurns("4turno"), true);
});

test("al guardar, una rotativa libre no se queda con una fecha de inicio", async () => {
    // guardarPerfil la borra a proposito: una fecha de inicio sin rotativa que
    // empezar reaparece despues como "desde el ..." en la ficha.
    const guardar = extraer("guardarPerfil");

    assert.match(
        guardar,
        /nextRotationType === "libre"\s*\?\s*""\s*:\s*profileDraft\.rotationStart/
    );
});
