// "Transferir a otra unidad" en el perfil.
//
// Origen pide (unidad enlazada + fecha); destino acepta creando el perfil con
// el formulario de siempre; origen, al saberla aceptada, inactiva el perfil,
// vacia su calendario desde esa fecha y lo anota en el historial.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const leer = ruta => readFile(new URL(ruta, import.meta.url), "utf8");
const main = await leer("../js/main.js");
const shell = await leer("../js/firebaseShell.js");
const html = await leer("../index.html");
const reglas = await leer("../firebase.rules");

test("el perfil tiene el boton y abre el dialogo de transferencia", () => {
    assert.match(html, /id="workerTransferBtn"[^>]*>[\s\S]{0,700}Transferir a otra unidad<\/button>/);
    assert.match(main, /DOM\.workerTransferBtn\.onclick = \(\) =>\s*openWorkerTransferDialog\(getPerfilActual\(\)\);/);
});

test("el dialogo lista solo unidades con enlace aceptado y pide la fecha", () => {
    assert.match(main, /link\.status === "accepted"/);
    assert.match(main, /¿A qué unidad deseas transferir a \$\{profile\.name\}\?/);
    assert.match(main, /¿Desde qué fecha comienza \$\{profile\.name\} en \$\{targetName\}\?/);
    assert.match(main, /inputType: "date"/);
});

test("la unidad destino ve la solicitud y al aceptar crea el perfil", () => {
    assert.match(shell, /Trabajadores transferidos a tu unidad/);
    assert.match(shell, /await options\.onAcceptWorkerTransfer\?\.\(solicitud\);/);
    assert.match(main, /onAcceptWorkerTransfer: solicitud => acceptWorkerTransfer\(solicitud\)/);
    // Formulario de nuevo perfil con la rotativa por elegir desde esa fecha.
    assert.match(main, /startCreateMode\(\);[\s\S]{0,1200}rotationStart: inicio,\s*rotationType: "",/);
});

test("la transferencia se confirma al guardar el perfil nuevo", () => {
    assert.match(main, /const transferIntake = isCreating \? pendingTransferIntake : null;/);
    assert.match(main, /await confirmWorkerTransferAccepted\(transferIntake, nextName, \{/);
});

test("el origen aplica con el estado hidratado, una sola sesion, sin tocar el perfil abierto", () => {
    assert.match(main, /void watchAcceptedOutgoingTransfers\(/);
    assert.match(main, /if \(!await claimWorkerTransferApplication\(solicitud\.id\)\) continue;/);
    assert.match(main, /await withProfile\(name, \(\) =>\s*cleanupFutureSchedule\(parseInputDate\(startISO\)/);
    assert.match(main, /active: false,\s*unitExitDate: lastActiveDate/);
    assert.match(main, /summary: `Transferido a \$\{destino\}`/);
});

test("los saldos viajan: lo que queda mas lo que devuelve el vaciado", () => {
    assert.match(main, /const leaveBalances = await transferLeaveBalances\(profile\.name, startISO\);/);
    assert.match(main, /legal: saldos\.legal \+ contarHabiles\(desde\(getLegalDays\(\)\), year, holidays\)/);
    // En destino: el formulario los muestra y, si nadie los toca, se guardan exactos.
    assert.match(main, /createAvailabilityBalances = \{\s*\.\.\.defaultCreateAvailabilityBalances\(\),\s*\.\.\.saldos\.balances/);
    assert.match(main, /applyBalances: !transferBalancesTouched/);
    assert.match(main, /saveManualLeaveBalances\(saldos\.year, saldos\.balances, profileName\);/);
});

test("el origen NO desenlaza la app: la muda el servidor", () => {
    const aplicar = main.slice(
        main.indexOf("async function applyWorkerTransferAtSource"),
        main.indexOf("// ───────── Estado de enlace de la app del trabajador")
    );

    assert.doesNotMatch(aplicar, /unlinkWorkerAppForProfile/);
    // Arriba antes de aceptar: aceptar puede publicar su calendario en el acto.
    assert.match(main, /await sealCriticalProfileState\(\[profileName\], "worker-transfer"\);\s*\n\s*await respondWorkerTransfer\(/);
});

test("solo el servidor escribe las transferencias", () => {
    assert.match(
        reglas,
        /match \/workerTransferRequests\/\{requestId\} \{[\s\S]{0,300}allow create, update, delete: if false;/
    );
});

test("la transferencia llega al menu Solicitudes de la unidad destino", async () => {
    const solicitudes = await leer("../js/workerRequests.js");

    assert.match(solicitudes, /worker_transfer: "Transferencia de Trabajador"/);
    assert.match(solicitudes, /const transferRequests = await getWorkerTransferPanelRequests\(\);[\s\S]{0,300}\.\.\.transferRequests,/);
    assert.match(solicitudes, /item\.targetWorkspaceId === activeWorkspace\.id/);
    // En vivo, con el mismo aviso que los enlaces entre unidades.
    assert.match(solicitudes, /collection\(db, "workerTransferRequests"\),\s*firestoreModule\.where\("targetWorkspaceId", "==", workspaceId\)/);
    // Aceptar desde ahi abre el mismo formulario.
    assert.match(solicitudes, /new CustomEvent\("proturnos:acceptWorkerTransfer"/);
    assert.match(main, /addEventListener\("proturnos:acceptWorkerTransfer"/);
});

test("el origen informa los saldos reales tras vaciar, y el destino ajusta la diferencia", () => {
    assert.match(main, /const finales = await transferLeaveBalances\(name, startISO\);[\s\S]{0,120}await reportWorkerTransferBalances\(solicitud\.id, finales\);/);
    assert.match(main, /if \(!await claimWorkerTransferBalances\(solicitud\.id\)\) continue;/);
    assert.match(main, /const diferencia = Number\.isFinite\(enviado\)\s*\? final - enviado/);
});

test("al aceptar se pregunta la modalidad y se abre solo el modal de rotativa", () => {
    const aceptar = main.slice(
        main.indexOf("async function acceptWorkerTransfer"),
        main.indexOf('window.addEventListener("proturnos:acceptWorkerTransfer"')
    );

    assert.match(aceptar, /¿Qué modalidad seguirá \$\{nombre\} en esta unidad\?/);
    assert.match(aceptar, /\{ value: "3turno", label: "3er Turno" \},\s*\{ value: "4turno", label: "4° Turno" \},\s*\{ value: "diurno", label: "Diurno" \}/);
    // El mismo camino que el selector del perfil: abre el modal de fechas.
    assert.match(aceptar, /DOM\.profileRotationSelect\.value = modalidad;\s*handleRotationSelectionChange\(\);/);
});
