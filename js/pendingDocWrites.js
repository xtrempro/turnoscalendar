// Escrituras directas a Firestore que no pueden quedarse esperando al servidor.
//
// Casi todo en esta app es local-first: se guarda en el navegador y se publica
// despues (ver js/firebaseAppState.js). Por eso el aviso de sin conexion puede
// prometer lo que promete: "tus cambios se guardan y se enviaran solos al
// reconectar".
//
// Dos cosas NO pasan por ahi y se escriben derecho en su documento: el
// establecimiento de la unidad (workspaces/{id}) y los permisos de cada
// supervisor (workspaces/{id}/members/{uid}). Y la promesa de `updateDoc` SOLO
// se resuelve cuando el servidor confirma: sin conexion no se resuelve NUNCA
// (no rechaza, se queda esperando). Ajustes la esperaba con un `await`, asi que
// "Guardar cambios" dejaba el modal colgado: no guardaba, no cerraba, no decia
// por que, y al intentar salir aparecia "Hay cambios sin guardar".
//
// Aqui la escritura se anota PRIMERO en este computador y se intenta despues.
// Si el servidor no confirma dentro del plazo, quien llamo puede seguir su
// camino (cerrar el modal) sabiendo que la escritura quedo encolada:
//
//   - el SDK de Firestore la manda solo al reconectar, mientras la pestaña siga
//     abierta;
//   - la anotacion local sobrevive a recargar o cerrar el navegador, que es lo
//     que el SDK no hace (esta app no activa la persistencia de Firestore), y
//     se reintenta al volver la conexion y al entrar a la unidad.
//
// La anotacion se guarda por documento y la ultima gana: un reintento viejo
// nunca puede pisar un valor nuevo del mismo campo.

import { getJSON, setJSON } from "./persistence.js";
import { getCurrentFirebaseUser, getFirebaseServices } from "./firebaseClient.js";

// Local de este computador: no viaja en el estado compartido de la unidad (ver
// INTERNAL_KEYS en js/persistence.js).
export const PENDING_DOC_WRITES_KEY = "proturnos_pending_doc_writes_v1";

// Cuanto se espera la confirmacion antes de dar la escritura por encolada. Con
// conexion, un updateDoc vuelve en decimas; sin conexion no vuelve nunca. El
// plazo existe solo para no colgar la pantalla, no para dar por fallida la
// escritura: la promesa sigue viva despues.
export const SERVER_ACK_MS = 4000;

// Una escritura que lleva una semana sin poder salir ya no vale la pena: el
// documento pudo cambiar muchas veces y reaplicarla seria pisar datos nuevos
// con una decision vieja.
export const MAX_PENDING_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const PENDIENTE = Symbol("pendiente");

let sequence = 0;
// Evita reenviar la misma anotacion cada vez que el navegador avisa "online".
const enVuelo = new Set();

function nextId() {
    sequence += 1;

    return `${Date.now()}-${sequence}`;
}

function readQueue() {
    const stored = getJSON(PENDING_DOC_WRITES_KEY, {});

    return stored && typeof stored === "object" && !Array.isArray(stored)
        ? stored
        : {};
}

function rememberWrite(entry) {
    const queue = readQueue();

    // Por documento, y la ultima gana: si alguien vuelve a guardar el mismo
    // campo, la anotacion anterior desaparece y no puede revivir despues.
    queue[entry.path] = entry;
    setJSON(PENDING_DOC_WRITES_KEY, queue);
}

function forgetWrite(entry) {
    const queue = readQueue();
    const stored = queue[entry?.path];

    // Si ya hay una escritura mas nueva para el mismo documento, no se toca.
    if (!stored || stored.id !== entry.id) return;

    delete queue[entry.path];
    setJSON(PENDING_DOC_WRITES_KEY, queue);
}

async function firestoreWrite(entry) {
    const parts = String(entry?.path || "")
        .split("/")
        .filter(Boolean);

    if (parts.length < 2 || parts.length % 2 !== 0) {
        throw new Error(`Ruta de documento invalida: ${entry?.path}`);
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const payload = { ...(entry.data || {}) };

    // La marca de tiempo del servidor no se puede guardar en el navegador: se
    // vuelve a pedir en cada intento, y queda la del momento en que sale.
    for (const field of entry.timestampFields || []) {
        payload[field] = firestoreModule.serverTimestamp();
    }

    await firestoreModule.updateDoc(
        firestoreModule.doc(db, ...parts),
        payload
    );
}

// Manda la escritura y limpia la anotacion cuando el servidor confirma. Nunca
// rechaza: resuelve con `null` si quedo guardada, o con el error si el servidor
// la rechazo. Asi puede quedar suelta sin convertirse en un rechazo sin dueño.
function startWrite(entry, write) {
    enVuelo.add(entry.id);

    return write(entry).then(
        () => {
            enVuelo.delete(entry.id);
            forgetWrite(entry);

            return null;
        },
        error => {
            enVuelo.delete(entry.id);

            // Rechazo del servidor (reglas, documento que ya no existe): no es
            // falta de conexion y reintentarlo daria siempre lo mismo.
            forgetWrite(entry);

            return error;
        }
    );
}

/**
 * Escribe campos en un documento sin colgarse esperando al servidor.
 *
 * Devuelve `{ confirmed, pending }`:
 *   confirmed true   el servidor ya la acepto;
 *   confirmed false  quedo encolada, y `pending` resuelve con `null` cuando
 *                    salga o con el error si la rechazan.
 *
 * Lanza solo si el servidor la rechaza DENTRO del plazo, que es cuando todavia
 * se le puede decir a la persona "no se guardo" mientras mira la pantalla.
 */
export async function updateDocSoon({
    path,
    data,
    timestampFields = [],
    uid = getCurrentFirebaseUser()?.uid || "",
    waitMs = SERVER_ACK_MS,
    write = firestoreWrite
}) {
    const entry = {
        id: nextId(),
        path: String(path || ""),
        data: data || {},
        timestampFields,
        uid,
        savedAtMs: Date.now()
    };

    rememberWrite(entry);

    const sending = startWrite(entry, write);
    let timer = null;
    const deadline = new Promise(resolve => {
        timer = setTimeout(() => resolve(PENDIENTE), waitMs);
    });
    const result = await Promise.race([sending, deadline]);

    clearTimeout(timer);

    if (result === PENDIENTE) {
        return { confirmed: false, pending: sending };
    }

    if (result) throw result;

    return { confirmed: true, pending: Promise.resolve(null) };
}

/**
 * Reintenta lo que quedo anotado. Se llama al volver la conexion y al entrar a
 * la unidad. No espera a que salgan: solo las vuelve a mandar.
 */
export function flushPendingDocWrites(
    uid = getCurrentFirebaseUser()?.uid || "",
    { write = firestoreWrite } = {}
) {
    const queue = readQueue();
    const now = Date.now();
    let sent = 0;
    let kept = 0;

    for (const [key, entry] of Object.entries(queue)) {
        if (!entry?.id || !entry?.path) {
            const limpia = readQueue();

            delete limpia[key];
            setJSON(PENDING_DOC_WRITES_KEY, limpia);
            continue;
        }

        if (now - (entry.savedAtMs || 0) > MAX_PENDING_AGE_MS) {
            forgetWrite(entry);
            continue;
        }

        // De otra persona que uso este computador: no es nuestra para mandarla.
        if (entry.uid && uid && entry.uid !== uid) {
            kept += 1;
            continue;
        }

        if (enVuelo.has(entry.id)) {
            kept += 1;
            continue;
        }

        startWrite(entry, write).then(error => {
            if (error) console.error("Escritura pendiente rechazada", entry.path, error);
        });
        sent += 1;
    }

    return { sent, kept };
}

export function pendingDocWrites() {
    return Object.values(readQueue());
}

if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
        flushPendingDocWrites();
    });
}
