// Reactivar a un trabajador que estuvo inactivo.
//
// Al inactivarlo se pregunta hasta que dia vale su ultimo turno y el calendario
// se vacia desde ahi. Por eso volver a activarlo no puede ser solo marcar una
// casilla: quedaria activo con el calendario en blanco y nadie sabria desde
// cuando ni con que rotativa cuenta.
//
// Y si mientras tanto entro en otra unidad del establecimiento, hay dos
// caminos: pedir el traspaso -y entonces vuelve con sus saldos- o reactivarlo
// aqui igual, avisandole a esa unidad que desde tal fecha esta en dos lados.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const leer = (ruta) => readFile(new URL(ruta, import.meta.url), "utf8");

const main = await leer("../js/main.js");
const solicitudes = await leer("../js/workerRequests.js");
const puente = await leer("../js/workerUnitChangeNotices.js");
const servidor = await leer("../functions/workerUnitChangeNotice.js");

function extraer(fuente, nombre, largo = 3000) {
    const inicio = fuente.indexOf(`function ${nombre}(`);

    assert.notEqual(inicio, -1, `no encontre ${nombre}`);

    return fuente.slice(inicio, inicio + largo);
}

test("reactivar pregunta desde cuando y con que rotativa", () => {
    const resolver = extraer(main, "resolveProfileReactivation");

    assert.match(resolver, /askHandoverSchedule\(\)/);
    // Y lo elegido se aplica al borrador ANTES de leer la rotativa al guardar.
    assert.match(main, /profileDraft\.rotationStart = decision\.startDate;/);
    assert.match(main, /const isReactivating = isEditing && !wasActive && willBeActive;/);
});

test("la rotativa se configura con el cuadro de siempre", () => {
    // askHandoverSchedule abre openRotationConfigModal: el mismo cuadro que al
    // crear un perfil o al pedir un traspaso. Un segundo cuadro para lo mismo
    // es uno que algun dia deja de parecerse.
    const preguntas = extraer(main, "askHandoverSchedule");

    assert.match(preguntas, /openRotationConfigModal\(rotationType/);
});

test("si esta activo en otra unidad, primero se ofrece el traspaso", () => {
    // Asi vuelve con sus saldos de vacaciones en vez de empezar de cero otra
    // vez.
    const resolver = extraer(main, "resolveProfileReactivation");

    assert.match(resolver, /findWorkerInEstablishment\(limpio\)/);
    assert.match(resolver, /unidad\.active !== false/);
    assert.match(resolver, /value: "traspaso"/);
    assert.match(resolver, /requestHandoverFromUnits\(enOtras, limpio\)/);
});

test("pedido el traspaso, NO se reactiva todavia", () => {
    // Reactivarlo ahi dejaria a dos unidades contandolo como activo al mismo
    // tiempo; se reactiva cuando el traspaso llega.
    const resolver = extraer(main, "resolveProfileReactivation");

    assert.match(resolver, /handoverRequested: true/);
    assert.match(main, /if \(!decision \|\| decision\.handoverRequested\) return false;/);
});

test("el pedido de traspaso es UNO solo para los dos momentos", () => {
    // Ingresar a alguien de cero y reactivarlo piden lo mismo. Si cada uno
    // armara su pedido, un dia dejarian de pedir igual.
    assert.match(main, /async function requestHandoverFromUnits\(unidades, rut/);

    const usos = main.match(/requestHandoverFromUnits\(/g) || [];

    assert.equal(usos.length, 3, "la definicion y los dos que lo usan");
});

test("reactivar sin traspaso avisa a la otra unidad, con la fecha", () => {
    assert.match(main, /reportWorkerEnteredElsewhere\(\s*nextProfilePayload\.rut,\s*reactivationFrom\s*\)/);
    assert.match(puente, /activeFrom/);
    assert.match(servidor, /const activeFrom = cleanText\(request\.data\?\.activeFrom, 10\)/);
    // Y la tarjeta la muestra: es el dato que decide si el perfil de aqui
    // todavia tiene sentido.
    assert.match(solicitudes, /Activo allá desde/);
});

test("una fecha mal formada no entra al aviso", () => {
    // Se evalua la expresion de verdad, no su texto: escrita a mano es facil
    // que pierda las barras y quede /^d{4}-.../, que no calza NINGUNA fecha y
    // rechazaria todos los avisos. Ya paso.
    const m = servidor.match(/if \(activeFrom && !(\/[^\n]*?\/)\.test\(activeFrom\)\)/);

    assert.ok(m, "no encontre la validacion de la fecha");

    const re = eval(m[1]);

    assert.equal(re.test("2026-11-03"), true);
    assert.equal(re.test("manana"), false);
});

test("un traspaso sobre alguien que ya existe lo REACTIVA, no lo duplica", () => {
    // Si solo mirara si existe, al volver por traspaso el perfil se quedaria
    // inactivo y nadie lo notaria hasta que faltara en la planificacion.
    const aplicar = extraer(main, "applyIncomingHandoverTransfers", 3400);

    assert.match(aplicar, /const porReactivar = Boolean\(existente\) && !isProfileActive\(existente\)/);
    assert.match(aplicar, /reactivateProfileFromHandover\(solicitud, existente\)/);
});

test("reactivar por traspaso no vuelve a preguntar lo acordado", () => {
    const reactivar = extraer(main, "reactivateProfileFromHandover");

    assert.match(reactivar, /startEditMode\(\)/);
    assert.match(reactivar, /await guardarPerfil\(\)/);
    assert.match(reactivar, /pendingHandoverReactivation = \{/);
    // Y al guardar se respeta.
    assert.match(main, /if \(isReactivating && !pendingHandoverReactivation\)/);
    // La bandera se limpia pase lo que pase: si quedara puesta, la proxima
    // reactivacion a mano no preguntaria nada.
    assert.match(reactivar, /finally \{\s*pendingHandoverReactivation = null;/);
});

test("reactivar por traspaso no le avisa a quien ya lo sabe", () => {
    // Esa unidad acordo el traspaso: avisarle seria ruido.
    assert.match(main, /reactivationFrom = decision\.startDate;/);

    const reactivar = extraer(main, "reactivateProfileFromHandover");

    assert.doesNotMatch(reactivar, /reportWorkerEnteredElsewhere/);
});
