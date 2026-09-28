// Incidencias de marcaje de UN trabajador, indexadas por dia.
//
// Son los errores que aparecen tras subir el reporte del reloj control -atrasos,
// entradas o salidas sin marca, marcas en dia libre- y que el inicio ya cuenta
// en su recuadro "Incidencias de marcaje". Aqui se guardan por dia para que la
// casilla del calendario pueda mostrarlos.
//
// NO son lo mismo que el icono de reloj que ya existe en el calendario: ese
// indica que el SUPERVISOR movio a mano la hora de entrada o salida. Estos son
// los errores que trajo el reporte.
//
// El calculo es el del reporte (buildAttendanceIncidents, js/hoursReport.js): no
// hay una segunda version de la regla, porque dos versiones acaban contando
// cosas distintas y el supervisor no sabe a cual creerle.
//
// El calendario pinta de forma sincronica, asi que aqui se cachea por
// (trabajador, mes): la casilla lee lo que haya y, cuando el calculo termina,
// avisa para repintar.

import { buildAttendanceIncidents } from "./hoursReport.js";
import { keyFromISO } from "./dateUtils.js";
import { getActiveWorkspace } from "./workspaces.js";

// Datos de los que dependen las incidencias. Si cambia alguno, lo calculado deja
// de valer: el turno del dia, sus permisos, el marcaje, la planilla del reloj o
// el horario propio del trabajador.
const INCIDENT_STATE_PREFIXES = [
    "data_",
    "baseData_",
    "admin_",
    "legal_",
    "comp_",
    "absences_",
    "clockMarks_",
    "rotativa_",
    "shift_",
    "shiftAssignmentHistory_"
];
const INCIDENT_STATE_KEYS = new Set([
    "swaps",
    "shiftMoves",
    "replacements",
    "attendanceMarks",
    "attendanceMarksImportedAt",
    "workerSchedules",
    "profiles",
    "manualHolidays",
    "turnChangeConfig"
]);

export function affectsAttendanceIncidents(keys = []) {
    return keys.some(key => {
        const cleanKey = String(key || "");

        return INCIDENT_STATE_KEYS.has(cleanKey) ||
            INCIDENT_STATE_PREFIXES.some(prefix => cleanKey.startsWith(prefix));
    });
}

const cache = new Map();
const pending = new Map();
let listeners = new Set();

// Con la unidad: el cambio de unidad vacia el estado local sin avisar, y un
// trabajador con el mismo nombre en otra unidad veria las marcas de este.
function cacheKey(profileName, year, month) {
    return `${getActiveWorkspace()?.id || ""}|${profileName}|${year}|${month}`;
}

/**
 * Las incidencias de un dia. Devuelve [] mientras el mes no este calculado: la
 * casilla se pinta sin marca y se repinta sola al terminar.
 */
export function getAttendanceIncidentsForDay(profileName, keyDay) {
    const parts = String(keyDay || "").split("-").map(Number);

    if (!profileName || parts.length !== 3) return [];

    const mes = cache.get(cacheKey(profileName, parts[0], parts[1]));

    return mes?.get(keyDay) || [];
}

export function hasAttendanceIncidentsForDay(profileName, keyDay) {
    return getAttendanceIncidentsForDay(profileName, keyDay).length > 0;
}

/**
 * Calcula el mes de un trabajador si todavia no esta. Al terminar avisa a quien
 * se haya suscrito, para que repinte.
 *
 * Un mismo mes pedido dos veces no se calcula dos veces: la segunda espera al
 * calculo en curso.
 */
export async function ensureAttendanceIncidentIndex(profile, year, month) {
    const profileName = profile?.name;

    if (!profileName) return false;

    const clave = cacheKey(profileName, year, month);

    if (cache.has(clave)) return false;
    if (pending.has(clave)) return pending.get(clave);

    const trabajo = (async () => {
        try {
            const { events } = await buildAttendanceIncidents(
                [profile],
                new Date(year, month, 1)
            );
            const porDia = new Map();

            events.forEach(event => {
                const keyDay = keyFromISO(event.iso);

                if (!keyDay) return;

                if (!porDia.has(keyDay)) porDia.set(keyDay, []);

                porDia.get(keyDay).push(event);
            });

            cache.set(clave, porDia);

            return true;
        } catch (error) {
            console.warn(
                "No se pudieron calcular las incidencias de marcaje del mes.",
                error
            );

            return false;
        } finally {
            pending.delete(clave);
        }
    })();

    pending.set(clave, trabajo);

    const cambio = await trabajo;

    if (cambio) {
        listeners.forEach(listener => {
            try {
                listener({ profileName, year, month });
            } catch (error) {
                // Un suscriptor que falla no puede dejar a los demas sin aviso.
            }
        });
    }

    return cambio;
}

/**
 * Tira lo calculado. Lo llama quien sabe que cambiaron los insumos (una planilla
 * nueva del reloj, un turno editado, un permiso): con el cache viejo la casilla
 * seguiria mostrando una incidencia que ya no existe.
 */
export function invalidateAttendanceIncidentIndex() {
    cache.clear();
}

export function onAttendanceIncidentIndexReady(listener) {
    if (typeof listener !== "function") return () => {};

    listeners.add(listener);

    return () => listeners.delete(listener);
}

// Lo que llega de otra sesion entra por el sync del estado; lo que se edita en
// esta, por el evento de persistencia. Los dos invalidan.
if (typeof window !== "undefined") {
    const alCambiar = keys => {
        if (!affectsAttendanceIncidents(keys)) return;

        invalidateAttendanceIncidentIndex();
    };

    window.addEventListener("proturnos:persistenceChanged", event => {
        alCambiar(event.detail?.keys || []);
    });
    window.addEventListener("proturnos:firebaseAppState", event => {
        if (event.detail?.type !== "app-state-entries-applied") return;

        alCambiar(event.detail.keys || []);
    });
}
