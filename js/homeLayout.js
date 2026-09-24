// Orden de las tarjetas del inicio, por administrador.
//
// Cada administrador arrastra las tarjetas a su gusto (ver homeCardDrag.js) y
// el orden queda en SU documento, users/{uid}/workspaces/{wid}: el mismo de sus
// tareas privadas, que las reglas dejan leer y escribir solo a su dueño. No
// viaja por el estado compartido de la unidad, asi que no le cambia el inicio a
// nadie mas. La copia local (clave "homeLayout_", excluida del estado
// compartido en persistence.js) da el primer pintado sin esperar al servidor.
//
// Firestore no admite arreglos dentro de arreglos, asi que las columnas se
// guardan como un mapa: { col0: [...], col1: [...], col2: [...] }.

import {
    getFirebaseServices,
    getCurrentFirebaseUser
} from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";
import { getJSON, setJSON } from "./persistence.js";

// Las tres pilas del tablero, en el orden de fabrica. Una tarjeta nueva se
// agrega aca, en la columna donde debe aparecer para quien nunca movio nada.
export const HOME_LAYOUT_DEFAULT = Object.freeze([
    Object.freeze(["tareas", "ausencias", "cambios"]),
    Object.freeze(["solicitudes", "incidencias", "cumpleanos"]),
    Object.freeze(["resumen", "minical", "cobertura", "brecha"])
]);

export const HOME_CARD_IDS = Object.freeze(HOME_LAYOUT_DEFAULT.flat());

// Llego un orden distinto desde el servidor (otro equipo del mismo usuario).
export const HOME_LAYOUT_EVENT = "proturnos:homeLayoutChanged";

function rawColumns(value) {
    if (Array.isArray(value)) return value;

    if (value && typeof value === "object") {
        return HOME_LAYOUT_DEFAULT.map((_, index) => value[`col${index}`]);
    }

    return null;
}

/**
 * Columnas limpias: cada tarjeta conocida aparece exactamente una vez.
 *
 * Acepta el mapa guardado ({ col0, col1, col2 }) o un arreglo de columnas.
 * Lo que no se reconoce (una tarjeta que ya no existe, una repetida) se
 * descarta, y una tarjeta que el guardado no conoce -una nueva, o un guardado
 * de antes de que existiera- aparece al final de su columna de fabrica en vez
 * de desaparecer.
 *
 * @param {Object|Array|null} value
 * @returns {Array<Array<string>>}
 */
export function normalizeHomeLayout(value) {
    const raw = rawColumns(value);

    if (!raw) return HOME_LAYOUT_DEFAULT.map(column => [...column]);

    const seen = new Set();
    const columns = HOME_LAYOUT_DEFAULT.map((_, index) => {
        const list = Array.isArray(raw[index]) ? raw[index] : [];

        return list.map(String).filter(id => {
            if (!HOME_CARD_IDS.includes(id) || seen.has(id)) return false;

            seen.add(id);
            return true;
        });
    });

    HOME_LAYOUT_DEFAULT.forEach((column, index) => {
        column.forEach(id => {
            if (seen.has(id)) return;

            columns[index].push(id);
            seen.add(id);
        });
    });

    return columns;
}

/**
 * Mueve una tarjeta a una columna, delante de otra (o al final si `beforeId`
 * no se da o no esta en esa columna).
 *
 * Se aplica sobre el orden guardado y no sobre lo que se ve: una tarjeta que
 * hoy no se muestra (por permisos, por ejemplo) conserva su lugar.
 */
export function moveHomeCard(layout, cardId, toColumn, beforeId = null) {
    const id = String(cardId || "");
    const columns = normalizeHomeLayout(layout);

    if (!HOME_CARD_IDS.includes(id) || !columns[toColumn]) return columns;

    const next = columns.map(column => column.filter(item => item !== id));
    const target = next[toColumn];
    const index = beforeId ? target.indexOf(String(beforeId)) : -1;

    if (index === -1) {
        target.push(id);
    } else {
        target.splice(index, 0, id);
    }

    return next;
}

export function toStoredHomeLayout(layout) {
    return normalizeHomeLayout(layout).reduce((stored, column, index) => {
        stored[`col${index}`] = column;
        return stored;
    }, {});
}

export function sameHomeLayout(a, b) {
    return JSON.stringify(normalizeHomeLayout(a)) ===
        JSON.stringify(normalizeHomeLayout(b));
}

function layoutKey(uid, wid) {
    return uid && wid ? `homeLayout_${uid}_${wid}` : "homeLayout_local";
}

function currentKey() {
    return layoutKey(
        getCurrentFirebaseUser()?.uid || "",
        getActiveWorkspace()?.id || ""
    );
}

/** El orden de quien esta mirando. */
export function getHomeLayout() {
    return normalizeHomeLayout(getJSON(currentKey(), null));
}

/**
 * Guarda el orden en la copia local (al instante) y en el documento del
 * usuario.
 */
export async function saveHomeLayout(layout) {
    const stored = toStoredHomeLayout(layout);

    setJSON(currentKey(), stored);

    const user = getCurrentFirebaseUser();
    const workspace = getActiveWorkspace();

    if (!user?.uid || !workspace?.id) return;

    try {
        const { db, firestoreModule } = await getFirebaseServices();

        await firestoreModule.setDoc(
            firestoreModule.doc(
                db, "users", user.uid, "workspaces", workspace.id
            ),
            { homeLayout: stored },
            { merge: true }
        );
    } catch (error) {
        console.warn("No se pudo guardar el orden del inicio.", error);
    }
}

/**
 * Lo que trae el documento del usuario. Si es distinto de la copia local, la
 * reemplaza y avisa para repintar.
 *
 * Sin orden en el servidor (el usuario nunca movio nada) se respeta la copia
 * local: puede ser un orden recien guardado que el servidor aun no confirma.
 *
 * @returns {boolean} si cambio algo
 */
export function receiveRemoteHomeLayout(stored, uid, wid) {
    if (!stored || typeof stored !== "object") return false;

    const key = layoutKey(uid, wid);

    if (sameHomeLayout(getJSON(key, null), stored)) return false;

    setJSON(key, toStoredHomeLayout(stored));

    if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
        window.dispatchEvent(new CustomEvent(HOME_LAYOUT_EVENT));
    }

    return true;
}
