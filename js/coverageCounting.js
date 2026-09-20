// Cuantas personas cubren un turno no es cuantos TURNOS se cubrieron.
//
// Un turno repartido entre varios deja un registro de reemplazo por persona.
// Contando registros, cinco personas tapando un mismo turno aparecen como cinco
// turnos de cobertura: infla el grafico de dotacion diaria del inicio, infla el
// detalle de ese grafico, e infla los totales del resumen RRHH -que ademas
// multiplica por las horas de un turno y prorratea el gasto en horas extras con
// esa cifra-.
//
// Lo que cuenta es el TURNO cubierto: un ausente, un dia, un turno. Quien lo
// haya hecho, y entre cuantos, es otra pregunta.
//
// Este modulo es puro y no importa nada a proposito: lo usan dashboard.js y
// rrhhSummaryPublisher.js, que viven solo en el navegador. Metiendolo en
// shiftCoverage.js o en replacements.js viajaria a los motores del servidor y
// obligaria a desplegar Cloud Functions por una cuenta que el servidor no hace.

/** Un reemplazo cuenta si no esta anulado y dice a quien cubre. */
function cuenta(record) {
    return Boolean(
        record &&
        !record.canceled &&
        record.replaced &&
        record.date
    );
}

/**
 * El turno que este reemplazo cubre: ausente + dia + turno.
 *
 * Sin el turno en la clave, un dia con dos ausencias del mismo trabajador
 * -un diurno y una noche- se contaria como una sola.
 */
export function coveredShiftKey(record) {
    if (!cuenta(record)) return "";

    return [
        String(record.replaced),
        String(record.date),
        String(record.turno ?? "")
    ].join("|");
}

/**
 * Cuantos TURNOS distintos quedaron cubiertos, sin importar entre cuantos.
 *
 * @param {Array} records reemplazos ya filtrados por mes/unidad si corresponde.
 */
export function distinctCoveredShifts(records = []) {
    const turnos = new Set();

    (records || []).forEach(record => {
        const key = coveredShiftKey(record);

        if (key) turnos.add(key);
    });

    return turnos.size;
}

/**
 * Por cada turno repartido, quien se queda representandolo y quien no.
 *
 * Devuelve el conjunto de trabajadores que NO deben sumar en un recuento por
 * persona, porque el turno que cubren ya lo esta representando otro. El primero
 * en el listado es el que se queda: da lo mismo cual sea, con tal de que sea
 * estable entre lecturas.
 *
 * @returns {Map<string, Set<string>>} fecha ISO -> nombres a no contar.
 */
export function extraCoverWorkersByDate(records = []) {
    const primero = new Map();
    const fuera = new Map();

    (records || []).forEach(record => {
        const key = coveredShiftKey(record);

        if (!key) return;

        const worker = String(record.worker || "");

        if (!worker) return;

        if (!primero.has(key)) {
            primero.set(key, worker);

            return;
        }

        // Ya hay alguien representando este turno.
        if (primero.get(key) === worker) return;

        const iso = String(record.date);

        if (!fuera.has(iso)) fuera.set(iso, new Set());

        fuera.get(iso).add(worker);
    });

    return fuera;
}

/**
 * "HH:MM" a minutos del dia, o null.
 *
 * Se repite aqui en vez de importarlo de calendar.js a proposito: este modulo
 * tiene que seguir siendo puro -calendar.js arrastra el DOM entero- y moverlo
 * en el otro sentido romperia los dos arneses de prueba que recortan esas
 * funciones del propio calendar.js. Son seis lineas y no tienen a donde
 * desviarse.
 */
function minutos(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());

    if (!match) return null;

    const hour = Number(match[1]);
    const minute = Number(match[2]);

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

    return (hour * 60) + minute;
}

/**
 * Las horas que aporta un reemplazo.
 *
 * Con tramo, lo que dura el tramo. SIN tramo, el turno completo: asi se
 * comportaron siempre los reemplazos guardados antes de que existiera el
 * reparto, y tienen que seguir valiendo lo mismo.
 *
 * @param {object} record reemplazo.
 * @param {number} horasTurno lo que dura un turno completo.
 */
export function coveredShiftHours(record, horasTurno) {
    const completo = Number(horasTurno) || 0;
    const desde = minutos(record?.coverFrom);
    const hasta = minutos(record?.coverUntil);

    if (desde === null || hasta === null) return completo;

    // Iguales = el turno entero (un 24), no cero. Y la noche da la vuelta.
    const span = ((hasta - desde + 1440) % 1440) || 1440;

    return span / 60;
}

/**
 * Agrupa los reemplazos por el turno que cubren.
 *
 * Util para mostrar "lo cubren N personas" sin volver a agrupar en cada
 * pantalla que lo necesite.
 *
 * @returns {Map<string, Array>} clave del turno -> sus reemplazos.
 */
export function coverersByShift(records = []) {
    const grupos = new Map();

    (records || []).forEach(record => {
        const key = coveredShiftKey(record);

        if (!key) return;

        if (!grupos.has(key)) grupos.set(key, []);

        grupos.get(key).push(record);
    });

    return grupos;
}
