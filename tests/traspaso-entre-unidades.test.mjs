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

function extraer(fuente, nombre, largo = 2600) {
    const inicio = fuente.indexOf(`function ${nombre}(`);

    assert.notEqual(inicio, -1, `no encontre ${nombre}`);

    return fuente.slice(inicio, inicio + largo);
}

test("al pedir se eligen la fecha y la rotativa", () => {
    const preguntas = extraer(main, "askHandoverSchedule");

    assert.match(preguntas, /inputType: "date"/);
    assert.match(preguntas, /requiresRotationFirstTurn\(rotationType\)/);
    assert.match(preguntas, /getRotationStartOptions\(rotationType\)/);
    // Y viajan en el pedido.
    assert.match(main, /startDate: rotativa\.startDate/);
    assert.match(main, /rotationType: rotativa\.rotationType/);
    assert.match(main, /rotationFirstTurn: rotativa\.rotationFirstTurn/);
});

test("las opciones de la secuencia salen de rotationUtils, no escritas a mano", () => {
    // Si se copiaran aqui, el dia que cambie una secuencia el pedido pediria
    // un punto de partida que ya no existe.
    const preguntas = extraer(main, "askHandoverSchedule");

    assert.doesNotMatch(preguntas, /Iniciar con/);
    assert.match(main, /getRotationStartOptions/);
});

test("enviar el pedido descarta el perfil a medio escribir", () => {
    // Si quedara abierto, cambiar de pestaña preguntaria "continuar sin
    // guardar" por un registro que ya no hay que crear: lo trae el traspaso.
    const pedir = extraer(main, "askWorkerHandover", 4200);

    assert.match(pedir, /discardProfileDraftChangesBeforeLeaving\(\)/);
    assert.match(pedir, /hideProfileRutNotice\(\)/);
});

test("aceptar NO vuelve a preguntar la fecha: usa la del pedido", () => {
    const aceptar = extraer(main, "startWorkerHandover", 3200);

    assert.match(aceptar, /normalizeStoredStart\(String\(detail\?\.startDate \|\| ""\)\)/);
    // Nada de volver a pedirla.
    assert.doesNotMatch(aceptar, /showPrompt/);
    assert.doesNotMatch(aceptar, /sendWorkerTransfer/);
});

test("aceptar manda lo mismo que una transferencia normal", () => {
    const aceptar = extraer(main, "startWorkerHandover", 3200);

    assert.match(aceptar, /profile: await transferProfilePayload\(profile, startISO\)/);
});

test("un pedido sin fecha no se puede aceptar", () => {
    // Los que quedaron de antes de que la fecha fuera parte del pedido.
    const aceptar = extraer(main, "startWorkerHandover", 3200);

    assert.match(aceptar, /test\(startISO\)/);
    assert.match(aceptar, /no trae la fecha en que comienza/);
});

test("quien pidio crea el perfil solo, y una sola sesion", () => {
    const aplicar = extraer(main, "applyIncomingHandoverTransfers", 2600);

    assert.match(aplicar, /if \(!await claimWorkerTransferIntake\(solicitud\.id\)\) continue;/);
    assert.match(aplicar, /createProfileFromHandover\(solicitud, nombre\)/);
    // Y se entera por la campanita.
    assert.match(aplicar, /noticeHandoverApplied\(solicitud, nombre\)/);
});

test("no se mete en medio de un perfil a medio editar", () => {
    const aplicar = extraer(main, "applyIncomingHandoverTransfers", 2600);

    assert.match(
        aplicar,
        /isProfileEditing\(\) \|\| hasUnsavedProfileDraftChanges\(\)/
    );
});

test("el perfil se crea por el camino de siempre, con la rotativa pedida", () => {
    const crear = extraer(main, "createProfileFromHandover", 2600);

    // Un solo camino de guardado: asi la rotativa, los saldos y la bitacora
    // salen igual que si lo hubiera guardado una persona.
    assert.match(crear, /await guardarPerfil\(\)/);
    assert.match(crear, /rotationType: String\(rotativa\.type \|\| ""\)/);
    assert.match(crear, /rotationFirstTurn: String\(rotativa\.firstTurn \|\| "larga"\)/);
    assert.match(crear, /transferredLeaveBalances\(solicitud\)/);
});

test("si crear el perfil falla, no se queda callado", () => {
    // El traspaso ya quedo reclamado: nadie mas va a intentarlo, asi que
    // callarlo dejaria a la persona sin perfil y sin que nadie se entere.
    const aplicar = extraer(main, "applyIncomingHandoverTransfers", 2600);

    assert.match(aplicar, /traspaso-fallido:/);
    assert.match(aplicar, /addBellNotice\(/);
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
