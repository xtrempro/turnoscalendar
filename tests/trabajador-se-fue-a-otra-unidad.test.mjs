// Un trabajador se enlazo en otra unidad porque alla lo ingresaron de cero.
//
// Lo que estas pruebas cuidan es el reparto: hay dos cosas que el sistema SI
// hace solo -soltar el enlace viejo, para que su aplicacion no siga mostrando
// una unidad donde ya no trabaja, y avisarle a esa unidad- y una que NO hace
// solo: inactivar el perfil, que es decision del supervisor. Si eso se
// mezclara, o el trabajador perderia el perfil sin que nadie lo decida, o la
// unidad seguiria planificando con alguien que ya no esta.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const leer = (ruta) => readFile(new URL(ruta, import.meta.url), "utf8");

const main = await leer("../js/main.js");
const solicitudes = await leer("../js/workerRequests.js");
const puente = await leer("../js/workerUnitChangeNotices.js");
const servidor = await leer("../functions/workerUnitChangeNotice.js");
const reglas = await leer("../firebase.rules");

test("el enlace viejo se suelta cuando acepta la invitacion de la unidad nueva", () => {
    // No al crearle el perfil: entre eso y la invitacion pueden pasar dias, y
    // ahi se quedaria sin ninguna aplicacion.
    assert.match(servidor, /if \(!linkIsActive\(despues\) \|\| linkIsActive\(antes\)\) return;/);
    assert.match(servidor, /batch\.delete\(workspaceRef\.collection\("workerLinks"\)\.doc\(uid\)\)/);
    assert.match(servidor, /unlinkedBy: "worker_moved_unit"/);
});

test("inactivar el perfil NO lo hace el servidor", () => {
    // Es la decision del supervisor: puede saber que vuelve.
    assert.doesNotMatch(servidor, /active: false/);
    assert.match(servidor, /status: PENDING/);
});

test("el aviso y el enlace suelto se escriben juntos", () => {
    // Si quedara el enlace suelto sin la tarjeta, la unidad perderia al
    // trabajador de su aplicacion sin que nadie le explicara por que.
    const soltar = servidor.slice(
        servidor.indexOf("async function releaseWorkerFromUnit("),
        servidor.indexOf("async function notifyWorkerUnitChangeHandler(")
    );

    assert.match(soltar, /const batch = db\.batch\(\);/);
    assert.match(soltar, /NOTICES_COLLECTION\)\.doc\(noticeId\)/);
    assert.match(soltar, /await batch\.commit\(\);/);
});

test("el aviso no dice a que unidad se fue", () => {
    assert.match(servidor, /newWorkspaceName: ""/);
});

test("solo el servidor escribe los avisos, y solo los lee su unidad", () => {
    assert.match(
        reglas,
        /match \/workerUnitChangeNotices\/\{noticeId\} \{[\s\S]{0,260}allow create, update, delete: if false;/
    );
    assert.match(reglas, /canManageProfiles\(resource\.data\.workspaceId\)/);
});

test("la tarjeta ofrece desactivar, no aceptar", () => {
    assert.match(solicitudes, /worker_unit_change: "Trabajador en otra unidad"/);
    assert.match(solicitudes, /\? "Desactivar perfil"/);
    assert.match(solicitudes, /isWorkerUnitChangeNotice\(request\) \? "Dejarlo activo"/);
});

test("desactivar pasa por el camino de siempre y deja constancia", () => {
    const desactivar = main.slice(
        main.indexOf("async function deactivateMovedWorker("),
        main.indexOf("async function cerrarAvisoDeCambioDeUnidad(")
    );

    assert.match(desactivar, /updateProfile\(profile\.name, \{/);
    assert.match(desactivar, /active: false/);
    assert.match(desactivar, /addContractHistoryEntry\(profile\.name/);
    assert.match(desactivar, /addAuditLog\(/);
});

test("un perfil que ya no esta igual cierra el aviso", () => {
    // Pudo eliminarse o renombrarse: dejar la tarjeta ahi para siempre no
    // ayuda a nadie.
    const desactivar = main.slice(
        main.indexOf("async function deactivateMovedWorker("),
        main.indexOf("async function cerrarAvisoDeCambioDeUnidad(")
    );

    assert.match(desactivar, /if \(!profile\) \{/);
    assert.match(desactivar, /cerrarAvisoDeCambioDeUnidad\(noticeId, false\)/);
});

test("el aviso suena en la campanita al llegar", () => {
    // Y no cuando a alguien se le ocurre mirar Solicitudes.
    assert.match(puente, /export async function watchWorkerUnitChangeNotices/);
    assert.match(main, /void watchWorkerUnitChangeNotices\(/);
    assert.match(main, /stopWatchingWorkerUnitChangeNotices\(\);/);

    const avisar = main.slice(
        main.indexOf("function noticeMovedWorkers("),
        main.indexOf("function noticeMovedWorkers(") + 700
    );

    assert.match(avisar, /addBellNotice\(/);
    assert.match(avisar, /Revísalo en Solicitudes/);
});

test("el cliente nunca marca el aviso por su cuenta", () => {
    // Lo cierra una callable: si el cliente pudiera escribirlo, podria cerrar
    // el de otra unidad.
    assert.match(puente, /callFunction\("resolveWorkerUnitChangeNotice"/);
    assert.doesNotMatch(puente, /setDoc|updateDoc/);
});

test("el aviso tambien sale por RUT, sin depender de la app", () => {
    // El camino del enlace solo se dispara si el trabajador tiene la
    // aplicacion, y la mayoria no la tiene: en esos casos la unidad vieja no
    // se enteraba nunca, y su perfil se quedaba activo en la planificacion.
    assert.match(servidor, /async function reportWorkerEnteredHereHandler/);
    assert.match(servidor, /findWorkerUnitsInEstablishment\(db, workspaceId, rut\)/);
    assert.match(puente, /callFunction\("reportWorkerEnteredHere"/);
});

test("avisar es parte de guardar el perfil nuevo", () => {
    const guardar = main.slice(
        main.indexOf("if (isCreating && !transferIntake) {"),
        main.indexOf("if (isCreating && !transferIntake) {") + 300
    );

    assert.match(guardar, /reportWorkerEnteredElsewhere\(nextProfilePayload\.rut\)/);
});

test("una transferencia no vuelve a avisar", () => {
    // Ese camino ya inactiva el perfil en origen por su cuenta.
    assert.match(main, /if \(isCreating && !transferIntake\) \{/);
});

test("las unidades a avisar las decide el servidor", () => {
    // Si se confiara en la lista que manda el cliente, cualquiera podria
    // dejarle una tarjeta a una unidad que nada tiene que ver.
    const puenteRut = puente.slice(
        puente.indexOf("export async function reportWorkerEnteredHere"),
        puente.indexOf("export async function reportWorkerEnteredHere") + 600
    );

    assert.doesNotMatch(puenteRut, /unidades/);
    assert.match(puenteRut, /workspaceId: workspace\.id,\s*\n\s*rut/);
});
