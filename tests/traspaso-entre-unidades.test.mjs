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

    assert.match(aplicar, /const testigo = await claimWorkerTransferIntake\(solicitud\.id\)/);
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

    assert.match(aplicar, /await releaseWorkerTransferIntake\(solicitud\.id, testigo\)/);
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
    const confirmar = aplicar.indexOf("confirmWorkerTransferIntake(");

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

test("una reserva ajena se reintenta sola al vencer", () => {
    // El servidor deja retomarla pasados los diez minutos, pero el tiempo no
    // produce un cambio en el documento: sin un temporizador, la pestaña
    // abierta espera un evento que no llega y el traspaso queda para la
    // proxima recarga.
    const aplicar = extraer(main, "applyIncomingHandoverTransfers");
    const programar = extraer(main, "scheduleHandoverIntakeRetry");

    // Se programa cuando la reserva es de otra sesion...
    assert.match(
        aplicar,
        /if \(!testigo\) \{[\s\S]{0,400}scheduleHandoverIntakeRetry\(\)/
    );
    // ...y tambien si no se pudo confirmar despues de crear el perfil.
    assert.match(
        aplicar,
        /No se pudo confirmar el traspaso[\s\S]{0,200}scheduleHandoverIntakeRetry\(\)/
    );

    // Un solo temporizador, y mas largo que el plazo del servidor: si fuera
    // mas corto, reintentaria contra una reserva todavia viva.
    assert.match(programar, /clearTimeout\(handoverIntakeRetryTimer\)/);
    assert.match(programar, /applyIncomingHandoverTransfers\(pendingHandoverIntakes\)/);

    const plazoCliente = Number(
        main.match(/HANDOVER_INTAKE_RETRY_MS = (\d+) \* 60 \* 1000/)?.[1]
    );

    assert.ok(plazoCliente > 10, `el reintento (${plazoCliente} min) debe pasar los 10 del servidor`);
});

test("el testigo de la reserva viaja a confirmar y a soltar", () => {
    // Sin el, una pestaña del mismo supervisor confirmaba o soltaba la reserva
    // que habia tomado la otra.
    const aplicar = extraer(main, "applyIncomingHandoverTransfers");

    assert.match(aplicar, /const testigo = await claimWorkerTransferIntake\(solicitud\.id\)/);
    assert.match(aplicar, /confirmWorkerTransferIntake\(\s*solicitud\.id,\s*testigo/);
    assert.match(aplicar, /releaseWorkerTransferIntake\(solicitud\.id, testigo\)/);
});

// --- Tercera vuelta de la auditoria (2026-10-14) ---

test("quien llega se reconoce por su RUT, no por su nombre", () => {
    // Con el nombre, un homonimo ACTIVO hacia que el traspaso se diera por
    // aplicado sin crear a nadie: la persona desaparecia. Y uno INACTIVO era
    // peor: se reactivaba a otro y se le cargaban los saldos del que venia.
    const aplicar = extraer(main, "applyIncomingHandoverTransfers");

    assert.match(
        aplicar,
        /normalizeRut\(item\.rut\) === rut/
    );
    assert.doesNotMatch(aplicar, /find\(item => item\.name === nombre\)/);
});

test("sin RUT no se adivina: se pide a mano", () => {
    const aplicar = extraer(main, "applyIncomingHandoverTransfers");

    assert.match(aplicar, /if \(!rut\) \{[\s\S]{0,300}noticeHandoverNeedsHand\(/);
});

test("un nombre ya ocupado se avisa en vez de pisar al otro perfil", () => {
    // Los perfiles se identifican por nombre dentro de la unidad: crear el que
    // llega pisaria al que ya estaba.
    const aplicar = extraer(main, "applyIncomingHandoverTransfers");

    assert.match(aplicar, /const homonimo = !existente &&/);
    assert.match(aplicar, /perfiles\.some\(item => item\.name === nombre\)/);
    assert.match(aplicar, /if \(homonimo\) \{[\s\S]{0,400}noticeHandoverNeedsHand\(/);

    // Y sin tomar la reserva: el claim viene despues de estas dos salidas.
    const homonimo = aplicar.indexOf("if (homonimo)");
    const claim = aplicar.indexOf("claimWorkerTransferIntake(solicitud.id)");

    assert.ok(homonimo < claim, "se avisa antes de tomar el traspaso");
});

test("si falla crear Y liberar, igual se reintenta", () => {
    // Ahi no queda nada escrito que despierte al oyente: la reserva vence en
    // silencio y la pestaña se quedaria esperando.
    const aplicar = extraer(main, "applyIncomingHandoverTransfers");
    const fallo = aplicar.slice(
        aplicar.indexOf("No se pudo crear el perfil del traspaso.")
    );

    assert.match(fallo, /scheduleHandoverIntakeRetry\(\)/);
    assert.match(fallo, /traspaso-fallido:/);
});

test("al confirmar se manda el nombre con que quedo AQUI", () => {
    // Si existia con otro nombre, mandar el de origen deja el enlace de su
    // aplicacion apuntando a un perfil que no existe.
    const aplicar = extraer(main, "applyIncomingHandoverTransfers");

    assert.match(
        aplicar,
        /confirmWorkerTransferIntake\(\s*solicitud\.id,\s*testigo,\s*existente\?\.name \|\| nombre\s*\)/
    );
});

// --- Aceptar a alguien que ya estaba inactivo aqui ---

test("no se promete inactivar a quien ya estaba inactivo", () => {
    // Su calendario se vacio el dia que se fue: decirle que "quedara inactivo"
    // hacia dudar de si aceptar deshacia algo.
    const aceptar = extraer(main, "startWorkerHandover");

    assert.match(aceptar, /const yaInactivo = isProfileActive\(profile\)/);
    assert.match(aceptar, /normalizeStoredStart\(profile\.unitExitDate \|\| ""\)/);
    // El cuadro de confirmar y el de exito dicen desde cuando lo estaba.
    assert.match(aceptar, /Aquí ya estaba inactivo: su último día fue el/);
    assert.match(aceptar, /Aquí seguía inactivo desde el/);
});

test("aceptar un traspaso no deja dos cuadros diciendo lo mismo", () => {
    // La transferencia que nace del traspaso la escucha esta misma unidad: sin
    // esto salia tambien el aviso de "la otra unidad acepto", al reves y
    // repetido.
    const aplicar = extraer(main, "applyWorkerTransferAtSource");

    assert.match(aplicar, /if \(!solicitud\.handoverRequestId\) \{[\s\S]{0,600}Transferencia aplicada/);
});

test("al aplicar no se reinactiva a quien ya estaba inactivo", () => {
    const aplicar = extraer(main, "applyWorkerTransferAtSource");

    assert.match(aplicar, /const yaEstabaInactivo = !isProfileActive\(profile\)/);
    assert.match(aplicar, /if \(!yaEstabaInactivo\) \{\s*\n\s*updateProfile\(/);
});

test("la tarjeta de Solicitudes tambien lo dice", async () => {
    const panel = await (await import("node:fs/promises")).readFile(
        new URL("../js/workerRequests.js", import.meta.url),
        "utf8"
    );
    const nota = extraer(panel, "handoverNote");

    assert.match(nota, /Aquí ya estaba inactivo: su último día fue el/);
    // Con las dos fechas y la unidad que lo recibe.
    assert.match(nota, /formatDate\(startDate\)/);
    assert.match(panel, /function handoverExitDate\(rut\)/);
});

// --- Retirar un pedido no lo hace desaparecer de la otra unidad ---

test("un pedido retirado queda en Anuladas, no se borra de la vista", async () => {
    // En la otra unidad el pedido estaba a la vista: desaparecer sin mas deja a
    // alguien preguntandose si lo respondio o se lo imagino.
    const panel = await (await import("node:fs/promises")).readFile(
        new URL("../js/workerRequests.js", import.meta.url),
        "utf8"
    );
    const cargar = extraer(panel, "getWorkerHandoverPanelRequests");

    assert.match(
        cargar,
        /\["pending", "accepted", "rejected", "canceled", "expired"\]/
    );

    // Y la tarjeta dice quien lo retiro, distinto para cada lado.
    const nota = extraer(panel, "handoverNote");

    assert.match(nota, /if \(status === "canceled"\)/);
    assert.match(nota, /retiró el pedido: no hay nada que responder/);
    assert.match(nota, /Retiraste el pedido/);

    // El filtro "Anuladas" del panel usa ese mismo estado.
    assert.match(panel, /statusButtonHTML\("canceled", "Anuladas"/);
});

test("el aviso de la campanita si se va cuando retiran el pedido", async () => {
    // La tarjeta se queda para contar lo que paso; el aviso mandaba a aceptar
    // o rechazar algo que ya no esta.
    const traspasos = await (await import("node:fs/promises")).readFile(
        new URL("../js/workerHandovers.js", import.meta.url),
        "utf8"
    );
    const observar = extraer(traspasos, "watchIncomingHandoverRequests");

    assert.match(observar, /handoverRequestIsUsable\(item\)/);
    assert.match(observar, /item\.status === "canceled"/);

    const olvidar = extraer(main, "forgetHandoverRequestNotices");

    // Con el MISMO id que se uso al avisar, que lleva cuando se pidio.
    assert.match(olvidar, /removeBellNotice\(handoverNoticeId\(pedido\)\)/);

    // Y lo llama el oyente: la funcion sola no quita ningun aviso.
    assert.match(
        main,
        /\(pendientes, retirados\) => \{[\s\S]{0,300}noticeHandoverRequests\(pendientes\);[\s\S]{0,120}forgetHandoverRequestNotices\(retirados\);/
    );
});

// --- Un rechazo tiene que llegar a alguna parte ---

test("la campanita avisa cuando rechazan el traspaso que pediste", async () => {
    // Aceptar se nota solo -el perfil aparece-; un rechazo no deja rastro, y
    // mientras tanto la persona sigue sin ingresar.
    const traspasos = await (await import("node:fs/promises")).readFile(
        new URL("../js/workerHandovers.js", import.meta.url),
        "utf8"
    );
    const observar = extraer(traspasos, "watchOwnHandoverRequests");

    assert.match(observar, /where\("requestingWorkspaceId", "==", workspace\.id\)/);
    assert.match(observar, /where\("status", "==", "rejected"\)/);

    const avisar = extraer(main, "noticeRejectedHandovers");

    assert.match(avisar, /id: `traspaso-rechazado:\$\{pedido\.id\}`/);
    assert.match(avisar, /rechazó el traspaso que pediste/);
    // Con el motivo, si lo escribieron.
    assert.match(avisar, /pedido\.rejectReason/);
    assert.match(main, /noticeRejectedHandovers\(rechazados\);/);
    assert.match(main, /stopWatchingOwnHandoverRequests\(\);/);
});

test("y la tarjeta de Solicitudes muestra ese motivo", async () => {
    const panel = await (await import("node:fs/promises")).readFile(
        new URL("../js/workerRequests.js", import.meta.url),
        "utf8"
    );
    const nota = extraer(panel, "handoverNote");

    assert.match(nota, /No lo aceptaron: "\$\{rejectReason\}"/);
    // El motivo sale del pedido, no de otra parte.
    assert.match(panel, /String\(item\.rejectReason \|\| ""\)\.trim\(\)/);
    // Y se pregunta al rechazar.
    assert.match(panel, /¿Por qué rechazas el pedido de/);
});

test("un pedido caducado no se ofrece para responder", async () => {
    // El servidor ya no deja resolverlo: mostrarlo como pendiente invitaba a
    // apretar Aceptar para recibir un error.
    const panel = await (await import("node:fs/promises")).readFile(
        new URL("../js/workerRequests.js", import.meta.url),
        "utf8"
    );
    const cargar = extraer(panel, "getWorkerHandoverPanelRequests");

    assert.match(cargar, /!handoverRequestIsUsable\(item\)/);
    assert.match(cargar, /status: caducado \? "expired" : item\.status/);

    const nota = extraer(panel, "handoverNote");

    assert.match(nota, /caducó sin respuesta/);
});

test("aceptar con una fecha anterior a su salida dice lo que se pierde", async () => {
    // Quien entrega puede aceptar desde la fecha pedida aunque sea anterior a
    // su ultimo dia: ahi SI se vacia calendario, y decir "no cambia nada"
    // mentia.
    const aceptar = extraer(main, "startWorkerHandover");

    assert.match(
        aceptar,
        /yaInactivo && compareISODate\(acordada, yaInactivo\) <= 0/
    );
    assert.match(aceptar, /pierdes lo que tuviera entre el/);
    // Y el otro caso sigue diciendo que no cambia nada.
    assert.match(aceptar, /Al aceptar no cambia nada de eso/);
});
