// Pedir a otra unidad del establecimiento el traspaso de un trabajador.
//
// La diferencia con una transferencia normal, y lo que estas pruebas cuidan:
// la fecha y la rotativa las elige QUIEN PIDE, al pedir. De eso depende todo lo
// demas: como ya esta decidido, aceptar cierra el asunto -no manda una
// solicitud de vuelta- y la unidad que pidio crea el perfil sola, sin que nadie
// apriete nada. Si alguna de esas piezas se rompe, el sintoma no es un error:
// es una persona esperando a que alguien acepte algo que ya acepto.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const leer = (ruta) => readFile(new URL(ruta, import.meta.url), "utf8");

const main = await leer("../js/main.js");
const solicitudes = await leer("../js/workerRequests.js");
const campanita = await leer("../js/notificationsBell.js");
const puente = await leer("../js/workerHandovers.js");
const servidorTransferencias = await leer("../functions/workerTransferRequests.js");

// La funcion COMPLETA, por llaves. Antes se cortaba a tantos caracteres del
// nombre, y cada vez que una funcion crecia las pruebas empezaban a fallar por
// mirar media funcion, no porque algo se hubiera roto.
function extraer(fuente, nombre) {
    const inicio = fuente.indexOf(`function ${nombre}(`);

    assert.notEqual(inicio, -1, `no encontre ${nombre}`);

    // El cuerpo empieza despues de los parametros: uno con llaves
    // -{ discardDraft = false } = {}- cortaria la funcion por la mitad.
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
            if (!profundidad) return fuente.slice(inicio, i + 1);
        }
    }

    throw new Error(`sin cierre: ${nombre}`);
}

test("al pedir se eligen la fecha y la rotativa", () => {
    const preguntas = extraer(main, "askHandoverSchedule");

    assert.match(preguntas, /showChoice\(/);
    assert.match(preguntas, /openRotationConfigModal\(rotationType/);
    assert.match(preguntas, /startDate: elegido\.rotationStart/);
    // Y viajan en el pedido.
    assert.match(main, /startDate: rotativa\.startDate/);
    assert.match(main, /rotationType: rotativa\.rotationType/);
    assert.match(main, /rotationFirstTurn: rotativa\.rotationFirstTurn/);
});

test("la rotativa se configura con el cuadro de siempre, no con otro", () => {
    // Un segundo cuadro para configurar una rotativa seria uno que algun dia
    // deja de parecerse al primero.
    const preguntas = extraer(main, "askHandoverSchedule");

    assert.doesNotMatch(preguntas, /Iniciar con/);
    assert.doesNotMatch(preguntas, /inputType: "date"/);
    assert.match(preguntas, /openRotationConfigModal\(/);
    // El cuadro avisa cuando se guarda y cuando se cierra, incluso si no
    // llego a abrirse: si no, quien lo espera se cuelga.
    assert.match(main, /options\.onSaved\?\.\(\{/);
    assert.match(main, /options\.onClosed\?\.\(\);/);
});

test("una modalidad sin secuencia no manda un primer turno inventado", () => {
    const preguntas = extraer(main, "askHandoverSchedule");

    assert.match(preguntas, /requiresRotationFirstTurn\(rotationType\)/);
});

test("enviar el pedido descarta el perfil a medio escribir", () => {
    // Si quedara abierto, cambiar de pestaña preguntaria "continuar sin
    // guardar" por un registro que ya no hay que crear: lo trae el traspaso.
    // Lo hace requestHandoverFromUnits, donde termina el camino del pedido.
    const pedir = extraer(main, "requestHandoverFromUnits");

    assert.match(pedir, /discardProfileDraftChangesBeforeLeaving\(\)/);
    assert.match(pedir, /forgetRutLookup\(\)/);
});

test("aceptar NO vuelve a preguntar la fecha: usa la del pedido", () => {
    const aceptar = extraer(main, "startWorkerHandover");

    assert.match(aceptar, /normalizeStoredStart\(String\(detail\?\.startDate \|\| ""\)\)/);
    // Nada de volver a pedirla.
    assert.doesNotMatch(aceptar, /showPrompt/);
    assert.doesNotMatch(aceptar, /sendWorkerTransfer/);
});

test("aceptar manda lo mismo que una transferencia normal", () => {
    const aceptar = extraer(main, "startWorkerHandover");

    // Con la fecha ACORDADA, que puede no ser la pedida: la ultima palabra la
    // tiene esta unidad, que es la que entrega (ver resolveHandoverStartDate).
    assert.match(aceptar, /profile: await transferProfilePayload\(profile, acordada\)/);
    assert.match(aceptar, /startDate: acordada/);
});

test("un pedido sin fecha no se puede aceptar", () => {
    // Los que quedaron de antes de que la fecha fuera parte del pedido.
    const aceptar = extraer(main, "startWorkerHandover");

    assert.match(aceptar, /test\(startISO\)/);
    assert.match(aceptar, /no trae la fecha en que comienza/);
});

test("quien pidio crea el perfil solo, y una sola sesion", () => {
    const aplicar = extraer(main, "applyIncomingHandoverTransfers");

    assert.match(aplicar, /if \(!await claimWorkerTransferIntake\(solicitud\.id\)\) continue;/);
    assert.match(aplicar, /createProfileFromHandover\(solicitud, nombre\)/);
    // Y se entera por la campanita.
    assert.match(aplicar, /noticeHandoverApplied\(solicitud, nombre\)/);
});

test("no se mete en medio de un perfil a medio editar", () => {
    const aplicar = extraer(main, "applyIncomingHandoverTransfers");

    assert.match(
        aplicar,
        /isProfileEditing\(\) \|\| hasUnsavedProfileDraftChanges\(\)/
    );
});

test("el perfil se crea por el camino de siempre, con la rotativa pedida", () => {
    const crear = extraer(main, "createProfileFromHandover");

    // Un solo camino de guardado: asi la rotativa, los saldos y la bitacora
    // salen igual que si lo hubiera guardado una persona.
    assert.match(crear, /await guardarPerfil\(\)/);
    assert.match(crear, /rotationType: String\(rotativa\.type \|\| ""\)/);
    assert.match(crear, /rotationFirstTurn: String\(rotativa\.firstTurn \|\| "larga"\)/);
    assert.match(crear, /transferredLeaveBalances\(solicitud\)/);
});

test("si crear el perfil falla, el traspaso vuelve a la cola", () => {
    // Es lo que evita que un traspaso quede consumido para siempre: el claim
    // ya lo tomo, asi que sin soltarlo nadie volveria a intentarlo y la
    // persona se quedaria sin perfil.
    const aplicar = extraer(main, "applyIncomingHandoverTransfers");

    assert.match(aplicar, /await releaseWorkerTransferIntake\(solicitud\.id\)/);
    assert.match(aplicar, /traspaso-fallido:/);
    assert.match(aplicar, /addBellNotice\(/);
});

test("solo lo suelta quien lo tomo", () => {
    // Si cualquiera pudiera soltarlo, una sesion devolveria a la cola un
    // traspaso que otra esta aplicando, y terminarian creando dos perfiles.
    // Lo que se suelta es la RESERVA; lo ya confirmado tiene su perfil creado.
    assert.match(
        servidorTransferencias,
        /solicitud\.targetIntakeClaimedByUid !== uid/
    );
});

test("el traspaso se confirma DESPUES de que el perfil existe", () => {
    // Antes, tomarlo y darlo por aplicado eran lo mismo: una sesion que se
    // cortaba antes de guardar consumia el traspaso para siempre y la persona
    // se quedaba sin perfil, sin que nadie volviera a intentarlo.
    const aplicar = extraer(main, "applyIncomingHandoverTransfers");
    const crear = aplicar.indexOf("createProfileFromHandover(solicitud, nombre)");
    const confirmar = aplicar.indexOf("confirmWorkerTransferIntake(solicitud.id)");

    assert.notEqual(crear, -1);
    assert.notEqual(confirmar, -1);
    assert.ok(confirmar > crear, "confirmar va despues de crear el perfil");
});

test("un perfil abierto no deja el traspaso esperando a una recarga", () => {
    // El oyente no vuelve a hablar solo: el documento ya no cambia. Sin un
    // reintento al cerrar el perfil, "se reintenta al cerrarlo" dependia de
    // recargar la unidad.
    assert.match(main, /function retryHandoverIntakes\(\)/);
    assert.match(main, /pendingHandoverIntakes = pendientes;/);

    const salir = main.slice(main.indexOf("function exitProfileMode("));

    assert.match(salir.slice(0, 700), /retryHandoverIntakes\(\);/);
});

test("el oyente del destino se enciende y se apaga con la unidad", () => {
    assert.match(main, /void watchIncomingHandoverTransfers\(/);
    assert.match(main, /stopWatchingIncomingHandoverTransfers\(\);/);
});

test("la campanita cuenta los avisos y los limpia al abrirla", () => {
    assert.match(campanita, /export function addBellNotice/);
    assert.match(campanita, /currentIds\.add\(`aviso:\$\{notice\.id\}`\)/);
    assert.match(campanita, /clearBellNotices\(\);/);
});

test("el panel muestra la fecha y la rotativa que se pidieron", () => {
    assert.match(solicitudes, /Comienza: \$\{formatDate\(request\.startDate\)\}/);
    assert.match(solicitudes, /function handoverRotationLabel/);
});

test("la tarjeta ya no promete una segunda solicitud", () => {
    // Antes decia que al aceptar se enviaba una transferencia que habia que
    // aceptar del otro lado. Ahora no hay segundo paso.
    assert.match(solicitudes, /No tendrán que aceptar nada más/);
    assert.match(solicitudes, /su perfil ya se creó en esta unidad/);
});

test("la transferencia del traspaso no sale como una tarjeta mas", () => {
    // Quien pidio no tiene que aceptarla, y su tarjeta de traspaso ya cuenta
    // lo mismo. Dos tarjetas para un solo hecho hacen dudar de si falta algo.
    assert.match(solicitudes, /!item\.handoverRequestId/);
});

test("aceptar lleva el perfil; el cliente nunca manda el id de una transferencia", () => {
    // La transferencia la crea el servidor: si el cliente pudiera nombrarla,
    // podria apuntar un pedido a una transferencia que no le corresponde.
    assert.match(puente, /profile = null/);
    assert.doesNotMatch(puente, /transferRequestId/);
});
