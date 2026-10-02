// Vistos buenos de horas de un mes (workspaces/{ws}/hoursValidations, que solo
// escribe la Cloud Function approveMonthlyHours). Un listener por la unidad y
// el mes que mira el supervisor en el menu Horas extras; al cambiar de mes o
// de unidad se suelta el anterior.

import { getFirebaseServices } from "./firebaseClient.js";

let current = {
    key: "",
    docs: [],
    loaded: false,
    error: null,
    unsubscribe: null
};

export function stopHoursValidationsWatch() {
    current.unsubscribe?.();
    current = { key: "", docs: [], loaded: false, error: null, unsubscribe: null };
}

/**
 * Empieza (o mantiene) la escucha del mes. `onChange` se llama con cada
 * cambio. Devuelve lo que haya hasta ahora: { loaded, docs, error }.
 *
 * @param {string} monthKey "AAAA-MM"
 */
export function watchHoursValidations(workspaceId, monthKey, onChange) {
    const key = `${workspaceId}|${monthKey}`;

    if (!workspaceId || !monthKey) return { loaded: true, docs: [], error: null };
    if (current.key === key) return current;

    stopHoursValidationsWatch();
    current.key = key;

    const watching = current;

    void (async () => {
        try {
            const { db, firestoreModule } = await getFirebaseServices();

            if (current !== watching) return;

            watching.unsubscribe = firestoreModule.onSnapshot(
                firestoreModule.query(
                    firestoreModule.collection(db, "workspaces", workspaceId, "hoursValidations"),
                    firestoreModule.where("monthKey", "==", monthKey)
                ),
                snapshot => {
                    if (current !== watching) return;

                    watching.docs = snapshot.docs.map(doc => doc.data()).filter(Boolean);
                    watching.loaded = true;
                    watching.error = null;
                    onChange?.();
                },
                error => {
                    if (current !== watching) return;

                    console.warn("No se pudieron leer los vistos buenos de horas.", error);
                    watching.loaded = true;
                    watching.error = error;
                    onChange?.();
                }
            );
        } catch (error) {
            if (current !== watching) return;

            watching.loaded = true;
            watching.error = error;
            onChange?.();
        }
    })();

    return current;
}
