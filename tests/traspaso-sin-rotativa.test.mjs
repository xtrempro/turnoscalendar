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
    const pisos = [];
    const borrador = { rotationStart: "" };
    const fabrica = new Function(
        "isProfileEditing",
        "showChoice",
        "showPrompt",
        "showAlert",
        "transferTomorrowISO",
        "normalizeStoredStart",
        "compareISODate",
        "formatDisplayDate",
        "setRotationStartFloor",
        "profileDraft",
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
        (a, b) => (a < b ? -1 : a > b ? 1 : 0),
        iso => iso,
        (fecha = "", mensaje = "") => { pisos.push({ fecha, mensaje }); },
        borrador,
        (tipo, opciones) => {
            configuraciones.push(tipo);
            opciones.onSaved?.(rotativaGuardada);
            opciones.onClosed?.();
        },
        tipo => tipo === "3turno" || tipo === "4turno",
        tipo => (tipo === "4turno" ? "4° Turno" : "Libre"),
        () => "Larga"
    );

    return { pedir, preguntas, fechas, configuraciones, avisos, pisos, borrador };
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
    const pedidos = [];
    const fabrica = new Function(
        "showChoice",
        "askHandoverSchedule",
        "showConfirm",
        "formatDisplayDate",
        "normalizeStoredStart",
        "nextCalendarISO",
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
        async (opciones) => { pedidos.push(opciones); return rotativa; },
        async mensaje => { confirmaciones.push(mensaje); return true; },
        iso => iso,
        valor => String(valor || ""),
        iso => `${iso}+1`,
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

    return { pedir, confirmaciones, enviados, pedidos };
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

// --- Desde cuando se le puede hacer empezar aqui ---
//
// Si la otra unidad ya cerro su paso por alla -inactivo, con su ultimo dia
// decidido-, empezar aqui ese dia o antes vaciaria el calendario que ellos ya
// validaron. Y no tienen como oponerse: aceptar el pedido lo aplica.

function montarPiso() {
    const fabrica = new Function(
        "normalizeStoredStart",
        "compareISODate",
        "formatDisplayDate",
        "isBeforeDraftUnitEntryDate",
        "rotationStartBeforeUnitEntryMessage",
        `${extraer("setRotationStartFloor")}
         ${extraer("rotationStartBlockedMessage")}
         return { setRotationStartFloor, rotationStartBlockedMessage };`
    );

    return fabrica(
        valor => String(valor || ""),
        (a, b) => (a < b ? -1 : a > b ? 1 : 0),
        iso => iso,
        () => false,
        () => "antes del ingreso"
    );
}

test("sin piso, cualquier dia sirve", () => {
    const api = montarPiso();

    api.setRotationStartFloor();

    assert.equal(api.rotationStartBlockedMessage("2026-01-01"), "");
});

test("con piso, los dias anteriores quedan bloqueados y el piso no", () => {
    const api = montarPiso();

    api.setRotationStartFloor("2026-10-16", "su último día allá es el 15");

    assert.equal(api.rotationStartBlockedMessage("2026-10-15"), "su último día allá es el 15");
    assert.equal(api.rotationStartBlockedMessage("2026-10-16"), "");
    assert.equal(api.rotationStartBlockedMessage("2026-10-17"), "");
});

test("el piso se quita, no se queda puesto para la proxima rotativa", () => {
    // El mismo cuadro configura rotativas que no tienen nada que ver con un
    // traspaso: si el piso quedara, bloquearia fechas sin razon.
    const api = montarPiso();

    api.setRotationStartFloor("2026-10-16", "bloqueado");
    api.setRotationStartFloor();

    assert.equal(api.rotationStartBlockedMessage("2026-01-01"), "");
});

test("el ingreso a la unidad sigue mandando por su cuenta", () => {
    const fabrica = new Function(
        "normalizeStoredStart",
        "compareISODate",
        "formatDisplayDate",
        "isBeforeDraftUnitEntryDate",
        "rotationStartBeforeUnitEntryMessage",
        `${extraer("setRotationStartFloor")}
         ${extraer("rotationStartBlockedMessage")}
         return rotationStartBlockedMessage;`
    );
    const bloqueado = fabrica(
        valor => String(valor || ""),
        (a, b) => (a < b ? -1 : a > b ? 1 : 0),
        iso => iso,
        () => true,
        () => "antes del ingreso a la unidad"
    );

    assert.equal(bloqueado("2026-10-20"), "antes del ingreso a la unidad");
});

test("el cuadro de la rotativa se abre con piso y lo suelta al cerrarse", async () => {
    const { pedir, pisos, borrador } = montar({ modalidad: "4turno" });

    await pedir({
        minStart: "2026-10-16",
        minStartMessage: "En UCI su último día es el 15-10-2026."
    });

    // Uno al abrir con la fecha, y otro vacio al cerrar.
    assert.deepEqual(pisos, [
        { fecha: "2026-10-16", mensaje: "En UCI su último día es el 15-10-2026." },
        { fecha: "", mensaje: "" }
    ]);
    // Y el calendario abre en el primer dia posible, no en uno deshabilitado.
    assert.equal(borrador.rotationStart, "2026-10-16");
});

test("sin piso no se toca la fecha con que venia el borrador", async () => {
    const { pedir, pisos, borrador } = montar({ modalidad: "4turno" });

    borrador.rotationStart = "2026-01-01";
    await pedir();

    // Solo el reseteo al cerrar: ningun piso con fecha.
    assert.deepEqual(pisos.map(piso => piso.fecha), [""]);
    assert.equal(borrador.rotationStart, "2026-01-01");
});

test("sin rotativa, la fecha tampoco puede ser anterior al piso", async () => {
    const { pedir, avisos } = montar({
        modalidad: "libre",
        fecha: "2026-10-15"
    });

    assert.equal(
        await pedir({
            minStart: "2026-10-16",
            minStartMessage: "En UCI su último día es el 15-10-2026."
        }),
        null
    );
    assert.deepEqual(avisos, ["En UCI su último día es el 15-10-2026."]);
});

test("sin rotativa, el campo de fecha arranca en el primer dia posible", async () => {
    // Por defecto propone mañana, que con un piso puede ser una fecha que no
    // se puede elegir.
    const { pedir, fechas } = montar({
        modalidad: "libre",
        fecha: "2026-10-16"
    });

    await pedir({ minStart: "2026-10-16" });

    assert.equal(fechas[0].value, "2026-10-16");
});

test("el pedido deriva el piso del ultimo dia en la otra unidad", async () => {
    const { pedir, pedidos } = montarPedido({
        rotativa: {
            startDate: "2026-10-16",
            rotationType: "4turno",
            rotationFirstTurn: "larga",
            resumen: "4° Turno (Larga)"
        }
    });

    await pedir(
        [{
            workspaceId: "ws-1",
            workspaceName: "UCI",
            active: false,
            exitDate: "2026-10-15"
        }],
        "31.000.001-9"
    );

    // nextCalendarISO de mentira devuelve "<iso>+1": lo que importa es que el
    // piso salga del dia SIGUIENTE al ultimo trabajado, no del mismo.
    assert.equal(pedidos[0].minStart, "2026-10-15+1");
    assert.match(pedidos[0].minStartMessage, /UCI/);
});

test("si la otra unidad lo tiene activo, no hay piso", async () => {
    const { pedir, pedidos } = montarPedido({
        rotativa: {
            startDate: "2026-10-16",
            rotationType: "4turno",
            rotationFirstTurn: "larga",
            resumen: "4° Turno (Larga)"
        }
    });

    await pedir(
        [{ workspaceId: "ws-1", workspaceName: "UCI", active: true, exitDate: "" }],
        "31.000.001-9"
    );

    assert.equal(pedidos[0].minStart, "");
    assert.equal(pedidos[0].minStartMessage, "");
});

// --- Mover el inicio hacia adelante no deja turnos atras ---

test("al reactivar solo se limpia desde que se fue, no su historia", () => {
    // Tomar el inicio de su rotativa anterior -que puede ser de hace años-
    // borraba todo lo que esa persona trabajo aqui antes de irse.
    const guardar = extraer("guardarPerfil");
    const piso = guardar.slice(
        guardar.indexOf("const rotationClearBeforeStart ="),
        guardar.indexOf("clearBeforeStart: rotationClearBeforeStart")
    );

    assert.match(
        piso,
        /isReactivating[\s\S]{0,40}nextCalendarISO\([\s\S]{0,60}previousSnapshot\?\.unitExitDate/
    );
    // Y nunca desde el inicio de la rotativa anterior.
    assert.doesNotMatch(piso, /originalRotationStart/);
});

test("al crear, el piso es su ingreso a la unidad", () => {
    const guardar = extraer("guardarPerfil");
    const piso = guardar.slice(
        guardar.indexOf("const rotationClearBeforeStart ="),
        guardar.indexOf("clearBeforeStart: rotationClearBeforeStart")
    );

    assert.match(
        piso,
        /PROFILE_MODE\.CREATE[\s\S]{0,40}normalizeStoredStart\(nextUnitEntryDate\)/
    );
});

test("un perfil que sigue en la unidad no pierde su historia", () => {
    // Ahi lo anterior al inicio nuevo es lo que trabajo, y para acortar la
    // rotativa vigente hay un camino aparte.
    const guardar = extraer("guardarPerfil");
    const piso = guardar.slice(
        guardar.indexOf("const rotationClearBeforeStart ="),
        guardar.indexOf("clearBeforeStart: rotationClearBeforeStart")
    );

    // Editar un perfil activo cae en el caso vacio: no se limpia nada atras.
    assert.match(piso, /:\s*"";/);
});

test("la limpieza va desde el inicio viejo hasta el dia anterior al nuevo", () => {
    const aplicar = extraer("applyDraftRotation");

    assert.match(aplicar, /if \(options\.clearBeforeStart\)/);
    assert.match(aplicar, /const hasta = previousCalendarISO\(rotationStart\)/);
    assert.match(aplicar, /cleanupFutureSchedule\(desde, \{ endISO: hasta \}\)/);
    // Y nunca al reves: si el inicio nuevo es anterior, no hay nada que borrar.
    assert.match(
        aplicar,
        /compareISODate\(options\.clearBeforeStart, hasta\) <= 0/
    );
});
