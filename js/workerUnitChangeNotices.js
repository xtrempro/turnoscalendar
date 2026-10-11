// Avisos de que un trabajador se enlazo en otra unidad.
//
// Envoltorios delgados de la function (functions/workerUnitChangeNotice.js),
// como js/workerHandovers.js. La function ya solto el enlace de esta unidad -su
// aplicacion dejo de mostrar este calendario- y dejo este aviso para que su
// supervisor decida que hacer con el perfil.
//
// Lo que NO hace la function, a proposito: inactivar el perfil. Esa decision es
// del supervisor, que puede saber cosas que el sistema no -que se fue a cubrir
// dos meses y vuelve, que arrastra horas pendientes-. Por eso llega como una
// tarjeta con un boton.

import { getFirebaseServices } from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";

const COLLECTION = "workerUnitChangeNotices";

async function callFunction(name, payload) {
    const { functions, functionsModule } = await getFirebaseServices();
    const callable = functionsModule.httpsCallable(functions, name);
    const result = await callable(payload);

    return result.data;
}

/**
 * Se ingreso de cero a alguien cuyo RUT ya estaba en otra unidad del
 * establecimiento: avisarle a esa unidad.
 *
 * Las unidades las vuelve a buscar el servidor. Si se le mandara la lista desde
 * aqui, cualquiera podria dejarle una tarjeta a una unidad que nada tiene que
 * ver con esa persona.
 */
export async function reportWorkerEnteredHere(rut, activeFrom = "") {
    const workspace = getActiveWorkspace();

    if (!workspace?.id || !rut) return { notified: 0 };

    return callFunction("reportWorkerEnteredHere", {
        workspaceId: workspace.id,
        rut,
        // Al reactivar a alguien se sabe desde cuando vuelve a estar activo, y
        // esa fecha es justo lo que la otra unidad necesita para decidir.
        activeFrom
    });
}

/**
 * Los avisos dirigidos a la unidad activa.
 */
export async function listWorkerUnitChangeNotices() {
    const workspace = getActiveWorkspace();

    if (!workspace?.id) return [];

    const { db, firestoreModule } = await getFirebaseServices();
    const snap = await firestoreModule.getDocs(firestoreModule.query(
        firestoreModule.collection(db, COLLECTION),
        firestoreModule.where("workspaceId", "==", workspace.id)
    ));

    return snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
}

let stopNoticesListener = null;
let noticesGeneration = 0;

/**
 * Los avisos pendientes de esta unidad, en vivo.
 *
 * Hace falta un oyente propio y no basta con cargarlos al abrir el panel: el
 * aviso tiene que sonar en la campanita cuando llega, no cuando a alguien se le
 * ocurre mirar Solicitudes.
 */
export async function watchWorkerUnitChangeNotices(workspace, onPending) {
    stopWatchingWorkerUnitChangeNotices();

    if (!workspace?.id || typeof onPending !== "function") return;

    const generation = noticesGeneration;
    const { db, firestoreModule } = await getFirebaseServices();

    if (generation !== noticesGeneration) return;

    stopNoticesListener = firestoreModule.onSnapshot(
        firestoreModule.query(
            firestoreModule.collection(db, COLLECTION),
            firestoreModule.where("workspaceId", "==", workspace.id),
            firestoreModule.where("status", "==", "pending")
        ),
        snap => {
            onPending(
                snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
            );
        },
        error => {
            console.warn("No se pudieron leer los avisos de cambio de unidad.", error);
        }
    );
}

export function stopWatchingWorkerUnitChangeNotices() {
    noticesGeneration++;
    stopNoticesListener?.();
    stopNoticesListener = null;
}

/**
 * Cierra el aviso. `deactivated` dice si el perfil se desactivo o si el
 * supervisor decidio dejarlo activo; en los dos casos la tarjeta se va, porque
 * lo que no corresponde es que se quede ahi para siempre.
 */
export async function resolveWorkerUnitChangeNotice({ noticeId, deactivated }) {
    const workspace = getActiveWorkspace();

    if (!workspace?.id) {
        throw new Error("Selecciona una unidad antes de continuar.");
    }

    return callFunction("resolveWorkerUnitChangeNotice", {
        workspaceId: workspace.id,
        noticeId,
        deactivated
    });
}
