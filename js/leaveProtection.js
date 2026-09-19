// Que permisos NO puede reescribir una rotativa nueva.
//
// Al cambiar la rotativa desde una fecha, el calendario se reescribe de ahi en
// adelante, y con el se borraban TODOS los permisos posteriores. Eso partia en
// dos un bloque que venia corriendo -de 10 feriados legales quedaban 4- y
// devolvia al saldo solo el pedazo borrado, dejando el resto en el limbo.
//
// Vive aparte de main.js A PROPOSITO: es logica que BORRA datos de permisos, y
// dentro de main.js no hay forma de probarla, porque las pruebas leen ese
// archivo como texto en vez de importarlo.

import { keyToDate, isDateKeyOnOrAfter } from "./dateUtils.js";
import { getAbsenceType } from "./rulesEngine.js";

// No son un permiso que el supervisor rehaga a voluntad: son un hecho medico ya
// cursado. Una rotativa nueva no los borra, empiecen cuando empiecen.
export const PROTECTED_ABSENCE_TYPES = new Set([
    "license",
    "professional_license"
]);

function isNextDayKey(previousKey, key) {
    const date = keyToDate(previousKey);

    date.setDate(date.getDate() + 1);

    return date.getTime() === keyToDate(key).getTime();
}

/**
 * Las claves de permiso que una rotativa nueva NO debe reescribir.
 *
 * Son dos casos:
 *
 * 1. El bloque que queda A CABALLO de la fecha -empezo antes y sigue despues-
 *    se conserva ENTERO. El trabajador ya esta ausente esos dias; lo que cambia
 *    es el turno que habria hecho.
 * 2. Licencia Medica y LM Profesional no se sobreescriben nunca.
 *
 * En ambos casos no hace falta nada mas para que aparezca el "!": conservar la
 * clave basta, porque requiereReemplazoTurnoBase mira los mapas de permisos
 * junto al turno del dia y se evalua en vivo, de modo que vuelve a pedir
 * cobertura sobre el turno NUEVO.
 *
 * Un "bloque" son dias SEGUIDOS del mismo permiso, que es como los agrupa el
 * registro del perfil (fallbackRecords en profileLeaveHistory.js). No se usan
 * los registros de la bitacora: se recortan con el tiempo, y entonces un bloque
 * antiguo dejaria de reconocerse justo cuando hay que respetarlo.
 *
 * Un bloque que empieza EXACTAMENTE en la fecha del cambio no se protege: cae
 * entero bajo la rotativa nueva, asi que se rehace con ella.
 *
 * @param {{admin: Object, legal: Object, comp: Object, absences: Object}} maps
 *        Mapas de permisos por clave. La entrada `absences` se trata aparte,
 *        porque ahi conviven tipos distintos y solo las licencias se protegen.
 * @param {Date} startDate Desde cuando se reescribe el calendario.
 * @returns {Object<string, Set<string>>} Claves a conservar, UNA POR MAPA.
 *
 * Va separado por mapa a proposito. Con un solo conjunto de fechas, una
 * licencia del dia X impedia borrar el P. Administrativo del MISMO dia X:
 * la proteccion de un permiso se contagiaba a los otros tres.
 */
export function protectedLeaveKeys(maps, startDate) {
    const kept = {};

    Object.entries(maps || {}).forEach(([name, map]) => {
        const keys = new Set();

        // Se registra de inmediato: lo que se agregue despues muta este mismo
        // conjunto, incluido el barrido de licencias del final.
        kept[name] = keys;

        const ordered = Object.keys(map || {}).sort((left, right) =>
            keyToDate(left).getTime() - keyToDate(right).getTime()
        );
        // Dos permisos distintos pegados no son el mismo bloque: que una
        // licencia siga a un gremial no convierte al gremial en intocable.
        const sameBlock = name === "absences"
            ? (left, right) => getAbsenceType(left) === getAbsenceType(right)
            : () => true;
        let block = [];
        const flush = () => {
            if (
                block.length &&
                !isDateKeyOnOrAfter(block[0], startDate) &&
                isDateKeyOnOrAfter(block[block.length - 1], startDate)
            ) {
                block.forEach(key => keys.add(key));
            }

            block = [];
        };

        ordered.forEach(key => {
            const previous = block[block.length - 1];

            if (
                previous &&
                isNextDayKey(previous, key) &&
                sameBlock(map[previous], map[key])
            ) {
                block.push(key);
                return;
            }

            flush();
            block = [key];
        });
        flush();

        if (name !== "absences") return;

        ordered.forEach(key => {
            if (PROTECTED_ABSENCE_TYPES.has(getAbsenceType(map[key]))) {
                keys.add(key);
            }
        });
    });

    return kept;
}
