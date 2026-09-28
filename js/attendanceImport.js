// Importacion de marcas del reloj control desde el Excel del sistema de
// asistencia.
//
// El archivo trae una fila por marca, con el RUT del trabajador, la fecha y
// hora, y si fue Entrada o Salida. Aca se convierte eso en un indice por RUT y
// fecha que el reporte consulta para llenar las columnas Entrada y Salida.
//
// El archivo se puede subir las veces que haga falta: cada marca trae un
// Checksum unico y se usa como identidad, asi que volver a cargar un periodo
// que se solapa con otro no duplica nada.

import { getJSON, setJSON } from "./persistence.js";
import { readXlsRows, dateFromExcelSerial } from "./xlsReader.js";
import { isXlsxFile, readXlsxRows } from "./xlsxReader.js";
import {
    groupMarkEvents,
    resolveShiftMarks,
    unexplainedMarkEvents
} from "./attendanceDelay.js";

const STORAGE_KEY = "attendanceMarks";
// Momento de la ULTIMA carga. Es el corte de lo que se puede juzgar: despues de
// esa hora no hay planilla que consultar (ver attendanceCoverage).
const IMPORTED_AT_KEY = "attendanceMarksImportedAt";

// Las dos claves que escribe la planilla del reloj. Se exportan porque quien
// pide la proyeccion del worker-app tiene que vaciarlas a Firestore ANTES de
// pedirla: si no, la Cloud Function calcula con las marcas viejas y al
// trabajador le falta la salida del turno en su telefono.
export const ATTENDANCE_STATE_KEYS = [STORAGE_KEY, IMPORTED_AT_KEY];

// Encabezados que se buscan, en minusculas y sin acentos. El sistema los puede
// traducir o reordenar, asi que las columnas se ubican por NOMBRE y nunca por
// posicion.
const COLUMN_ALIASES = {
    rut: ["rut", "run"],
    name: ["nombre", "trabajador", "funcionario"],
    timestamp: ["fecha/hora", "fecha hora", "fechahora", "fecha y hora", "fecha"],
    // Algunos relojes separan la hora en su propia columna ("Planilla de
    // Personal.xlsx": Fecha 24/09/2026 y Hora 07:45:19). Es opcional.
    time: ["hora", "hora registro", "hora marca", "hora de registro"],
    type: ["tipo registro", "tipo de registro", "tipo", "movimiento"],
    id: ["checksum", "id", "codigo registro"]
};

function stripAccents(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
}

/**
 * RUT sin puntos y con guion, en mayusculas: "17.816.632-8" -> "17816632-8".
 * Es la forma en que se compara con el RUT del perfil, que se escribe de
 * cualquier manera.
 */
export function normalizeRut(value) {
    const clean = String(value || "")
        .replace(/[^0-9kK]/g, "")
        .toUpperCase();

    if (clean.length < 2) return "";

    return `${clean.slice(0, -1)}-${clean.slice(-1)}`;
}

function toISODate(date) {
    return `${date.getFullYear()}-` +
        `${String(date.getMonth() + 1).padStart(2, "0")}-` +
        `${String(date.getDate()).padStart(2, "0")}`;
}

function toHHMM(date) {
    return `${String(date.getHours()).padStart(2, "0")}:` +
        `${String(date.getMinutes()).padStart(2, "0")}`;
}

// "Entrada" / "Salida", tolerando variantes del sistema de asistencia.
function normalizeMarkType(value) {
    const text = stripAccents(value);

    if (!text) return "";
    if (text.startsWith("entrada") || text === "in" || text === "e") return "in";
    if (text.startsWith("salida") || text === "out" || text === "s") return "out";

    return "";
}

/**
 * Ubica la fila de encabezado y mapea cada campo a su columna.
 *
 * El Excel trae titulo, rango de fechas y nombre de la empresa antes de la
 * tabla, asi que la fila de encabezado no es la primera.
 */
export function findHeader(rows) {
    for (let index = 0; index < Math.min(rows.length, 40); index++) {
        const row = rows[index] || [];
        const headers = row.map(stripAccents);
        const columns = {};

        Object.entries(COLUMN_ALIASES).forEach(([field, aliases]) => {
            const column = headers.findIndex(header =>
                header && aliases.includes(header)
            );

            if (column >= 0) columns[field] = column;
        });

        // Con RUT y fecha/hora ya se puede trabajar; lo demas es opcional.
        if (columns.rut !== undefined && columns.timestamp !== undefined) {
            return { row: index, columns };
        }
    }

    return null;
}

// "24/09/2026", "24-09-2026 07:45:19" o "2026-09-24 07:45". Hora local.
function dateFromText(text) {
    const value = String(text || "").trim();
    const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
        .exec(value);

    if (local) {
        let [, day, month, year, hours = 0, minutes = 0, seconds = 0] = local;

        // Formato de EE.UU. (mes primero): se reconoce cuando no cabe al reves.
        if (Number(month) > 12 && Number(day) <= 12) [day, month] = [month, day];

        return new Date(
            Number(year), Number(month) - 1, Number(day),
            Number(hours), Number(minutes), Number(seconds)
        );
    }

    return value ? new Date(value.replace(" ", "T")) : null;
}

// Segundos desde la medianoche: fraccion de dia de Excel o texto "07:45:19".
function secondsOfDay(value) {
    if (typeof value === "number") {
        return Number.isFinite(value)
            ? Math.round((value - Math.floor(value)) * 86400)
            : null;
    }

    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(value || "").trim());

    return match
        ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0)
        : null;
}

/**
 * Momento de una marca. La fecha viaja como numero de serie de Excel o como
 * texto; la hora, en la misma celda o -si el archivo la separa- en `rawTime`.
 */
function markDate(raw, rawTime) {
    const date = typeof raw === "number"
        ? dateFromExcelSerial(raw)
        : (raw ? dateFromText(raw) : null);

    if (!date || Number.isNaN(date.getTime()) || rawTime === undefined) return date;

    const seconds = secondsOfDay(rawTime);

    if (seconds === null) return null;

    return new Date(
        date.getFullYear(), date.getMonth(), date.getDate(),
        0, 0, seconds
    );
}

/**
 * Convierte las filas del Excel en marcas normalizadas.
 * @returns {{marks: Array<Object>, skipped: number}}
 */
export function parseAttendanceRows(rows) {
    const header = findHeader(rows);

    if (!header) {
        throw new Error(
            "No se encontraron las columnas RUT y Fecha/Hora en el archivo. " +
            "Revisa que sea el informe de registros de asistencia."
        );
    }

    const { columns } = header;
    const marks = [];
    let skipped = 0;

    for (let index = header.row + 1; index < rows.length; index++) {
        const row = rows[index] || [];
        const rut = normalizeRut(row[columns.rut]);
        const date = markDate(
            row[columns.timestamp],
            columns.time === undefined ? undefined : row[columns.time]
        );

        if (!rut || !date || Number.isNaN(date.getTime())) {
            skipped++;
            continue;
        }

        marks.push({
            rut,
            name: String(row[columns.name] ?? "").replace(/\s+/g, " ").trim(),
            date: toISODate(date),
            time: toHHMM(date),
            type: normalizeMarkType(row[columns.type]),
            id: String(row[columns.id] ?? "").trim()
        });
    }

    return { marks, skipped };
}

export function getAttendanceMarks() {
    const stored = getJSON(STORAGE_KEY, {});

    return stored && typeof stored === "object" ? stored : {};
}

export function saveAttendanceMarks(marks) {
    setJSON(STORAGE_KEY, marks || {});
}

/**
 * Cuando se subio la ultima planilla del reloj.
 * @returns {string} ISO con hora, o "" si nunca se guardo
 */
export function attendanceImportedAt() {
    const stored = getJSON(IMPORTED_AT_KEY, "");

    return typeof stored === "string" ? stored : "";
}

// Identidad de una marca. El Checksum del reloj es unico por marca; si el
// archivo no lo trajera, se compone con hora y tipo, que para un mismo
// trabajador y dia tampoco se repiten.
function markIdentity(mark) {
    return mark.id || `${mark.time}|${mark.type}`;
}

/**
 * Guarda las marcas nuevas y descarta las que ya estaban.
 *
 * @param {Array<Object>} marks
 * @returns {{added: number, duplicated: number, workers: number, dates: string[]}}
 */
export function mergeAttendanceMarks(marks) {
    const store = getAttendanceMarks();
    const dates = new Set();
    const workers = new Set();
    // TODOS los RUT del archivo, no solo los que traen marcas nuevas.
    //
    // Una marca puede estar guardada localmente desde una importacion anterior y
    // no haber llegado nunca a la proyeccion del trabajador. Si solo se
    // republicaban los del lote nuevo, esa marca no se recuperaba en ninguna
    // carga posterior: quedaba correcta en el reporte del supervisor y ausente
    // en el telefono para siempre. La planilla es la verdad para todos los que
    // vienen en ella, no solo para los que cambiaron.
    const fileRuts = new Set();
    let added = 0;
    let duplicated = 0;

    marks.forEach(mark => {
        fileRuts.add(mark.rut);

        const byDate = store[mark.rut] || (store[mark.rut] = {});
        const list = byDate[mark.date] || (byDate[mark.date] = []);
        const identity = markIdentity(mark);

        if (list.some(existing => markIdentity(existing) === identity)) {
            duplicated++;
            return;
        }

        list.push({
            time: mark.time,
            type: mark.type,
            id: mark.id
        });
        list.sort((a, b) => a.time.localeCompare(b.time));
        added++;
        dates.add(mark.date);
        workers.add(mark.rut);
    });

    if (added) {
        saveAttendanceMarks(store);
        // La hora de la carga, no la del ultimo marcaje: es hasta donde se
        // puede decir que falto una marca.
        setJSON(IMPORTED_AT_KEY, new Date().toISOString());

        // Los datos del reloj solo cambian al subir una planilla. Quien tenga
        // algo calculado sobre ellos -el resumen de incidencias del inicio- se
        // entera aqui, y asi no necesita rehacer la cuenta a cada rato.
        if (typeof window !== "undefined" && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent(
                "proturnos:attendanceMarksChanged",
                {
                    detail: {
                        added,
                        dates: [...dates].sort(),
                        // Los RUT que trajo el archivo. Con ellos se republica
                        // solo a esos trabajadores, en vez de a la unidad
                        // entera.
                        ruts: [...fileRuts]
                    }
                }
            ));
        }
    }

    return {
        added,
        duplicated,
        workers: workers.size,
        dates: [...dates].sort()
    };
}

/**
 * Primer y ultimo dia con marcas cargadas.
 *
 * Es el periodo del que SI tenemos datos del reloj. Fuera de el, que no haya
 * una marca no dice nada: lo mas probable es que la planilla de esos dias aun
 * no se haya subido. Sin esta distincion, todos los dias posteriores a la
 * ultima carga apareceran como "sin marcaje" y el resumen quedaria lleno de
 * incidencias inventadas.
 *
 * Recorre todo el almacen, asi que conviene calcularlo UNA vez por reporte y
 * pasarlo, no por dia.
 *
 * Ademas viaja `at`: el momento en que se subio la ultima planilla. El periodo
 * dice que DIAS se cargaron; `at` dice hasta que HORA se puede juzgar lo que
 * falta (ver attendanceDay en hoursReport.js).
 *
 * @returns {{from: string, to: string, at: string}} ISO, o cadenas vacias
 */
export function attendanceCoverage() {
    let from = "";
    let to = "";

    Object.values(getAttendanceMarks()).forEach(byDate => {
        Object.entries(byDate || {}).forEach(([iso, marks]) => {
            if (!Array.isArray(marks) || !marks.length) return;
            if (!from || iso < from) from = iso;
            if (!to || iso > to) to = iso;
        });
    });

    return { from, to, at: attendanceImportedAt() };
}

/**
 * RUT de los trabajadores que ALGUNA VEZ tuvieron una marca cargada.
 *
 * Quien nunca vino en una planilla no tiene incidencias que mostrar: no llego
 * tarde ni le falta un marcaje, es que el reloj no lo registra. Con la primera
 * marca -del mes que sea- entra a la cuenta y ya no sale, aunque los archivos
 * siguientes no lo traigan: desde ahi, que falte SI es un dato de el.
 *
 * Recorre todo el almacen, asi que conviene calcularlo UNA vez por reporte.
 *
 * @returns {Set<string>} RUT normalizados
 */
export function attendanceMarkedRuts() {
    const ruts = new Set();

    Object.entries(getAttendanceMarks()).forEach(([rut, byDate]) => {
        const rutKey = normalizeRut(rut);

        if (!rutKey) return;

        const tieneAlguna = Object.values(byDate || {}).some(marks =>
            Array.isArray(marks) && marks.length
        );

        if (tieneAlguna) ruts.add(rutKey);
    });

    return ruts;
}

/**
 * .Hay datos del reloj para ese dia?
 */
export function isAttendanceCovered(iso, coverage) {
    return Boolean(coverage?.from) &&
        String(iso) >= coverage.from &&
        String(iso) <= coverage.to;
}

/**
 * Marcas de un trabajador en una fecha.
 * @param {string} rut
 * @param {string} iso
 * @returns {Array<{time: string, type: string}>}
 */
export function getMarksFor(rut, iso) {
    const key = normalizeRut(rut);

    if (!key) return [];

    return getAttendanceMarks()[key]?.[iso] || [];
}

/**
 * Horas de entrada y de salida de un dia, listas para la celda del reporte.
 *
 * De cada momento del turno se muestra la PRIMERA marca: si marco dos veces al
 * llegar, o dos veces al salir, vale la primera de cada tanda, que es la hora
 * en que efectivamente entro o se fue. Lo demas -incluido lo que marque en
 * mitad de un 24- no se pierde: viaja en `marks` para el hover.
 *
 * Cual marca fue la llegada y cual la salida lo decide el turno, no la etiqueta
 * del reloj: ver resolveShiftMarks. Cuando la etiqueta no calza, se avisa en
 * `entryIncident` / `exitIncident`.
 *
 * @param {string} rut
 * @param {string} iso
 * @param {object} [options]
 * @param {boolean} [options.endsNextMorning] el turno cierra al dia siguiente
 * @param {boolean} [options.previousEndsNextMorning] anoche hubo turno con noche
 * @param {number} [options.workedShift] turno realizado ese dia
 * @param {string} [options.scheduledEntry] hora de ingreso del turno
 */
export function getAttendanceCells(rut, iso, options = {}) {
    const {
        endsNextMorning = false,
        previousEndsNextMorning = false
    } = options;
    const {
        startsInTheMorning = false,
        nextStartsInTheMorning = false,
        splitSegments = false,
        canSplitOnMarks = false,
        entryMoved = false,
        nextEntryMoved = false,
        workedShift,
        scheduledEntry,
        nextScheduledEntry
    } = options;
    const { marks, previousClosed } = shiftMarksFor(rut, iso, {
        endsNextMorning,
        previousEndsNextMorning,
        startsInTheMorning,
        nextStartsInTheMorning,
        scheduledEntry,
        nextScheduledEntry
    });
    const closing = marks.find(mark => mark.iso) || null;
    // Un D+N va siempre en dos tramos: son dos presencias con horas de por
    // medio. Un 24 o un 18 horas son continuos y se resumen en uno, salvo que
    // el trabajador haya marcado el traspaso: si lo marco, se muestran los dos.
    const marcoElTraspaso =
        canSplitOnMarks &&
        marks.filter(mark => !mark.iso).length >= 3;
    const segments = (splitSegments || marcoElTraspaso)
        ? splitShiftSegments(marks, closing)
        : [singleShiftSegment(marks, closing, {
            endsNextMorning,
            workedShift,
            scheduledEntry
        })];
    const first = segments[0];
    const last = segments[segments.length - 1];

    // Viene de un turno de noche que nadie cerro y hoy entra por la manana: no
    // hubo que marcar, siguio de largo. Lo mismo al reves con la salida.
    //
    // Salvo que la entrada se haya movido a mano: si al trabajador le
    // autorizaron entrar mas tarde, la jornada se parte y las dos marcas pasan
    // a ser obligatorias. Ahi no hay continuidad que mostrar, hay marcas que
    // faltan, y corresponde la cruz.
    first.entryArrow = Boolean(
        previousEndsNextMorning &&
        !previousClosed &&
        startsInTheMorning &&
        !entryMoved &&
        !first.entry
    );
    last.exitArrow = Boolean(
        endsNextMorning &&
        !closing &&
        nextStartsInTheMorning &&
        !nextEntryMoved
    );

    return {
        entrada: cellText(segments, "entry"),
        salida: cellText(segments, "exit"),
        ...(closing ? { salidaFrom: closing.iso } : {}),
        entryIncident: segments.some(segment => segment.entryIncident),
        exitIncident: segments.some(segment => segment.exitIncident),
        entryArrow: first.entryArrow,
        exitArrow: last.exitArrow,
        multiline: segments.length > 1,
        segments,
        marks,
        // Los momentos que el turno no explica. Van aqui y no en el reporte
        // porque de aqui salen las dos cosas que los usan: el aviso de la
        // celda y la incidencia del inicio.
        unexplained: unexplainedMarkEvents(
            marks,
            segments.flatMap(segment => [segment.entry, segment.exit]),
            {
                // Un 24 o un 18 horas son de dos tramos pero continuos: el
                // traspaso se puede marcar y no es una anomalia. Un D+N no
                // entra: sus dos tramos son presencias separadas, y entre una
                // y otra no hay nada que marcar.
                handoverInside: canSplitOnMarks && !splitSegments
            }
        )
    };
}

/**
 * Texto de una celda: una linea por tramo, en el orden en que ocurrieron.
 */
function cellText(segments, side) {
    return segments
        .map(segment => segment[`${side}Arrow`]
            ? CONTINUES_MARK
            : segment[side]?.time || "")
        .join("\n")
        .replace(/\n+$/, "");
}

/**
 * Un turno de un solo tramo.
 */
function singleShiftSegment(marks, closing, context) {
    const resolved = resolveShiftMarks(marks, context);

    return {
        entry: resolved.entry,
        exit: resolved.exit,
        entryIncident: resolved.entryIncident,
        exitIncident: resolved.exitIncident,
        entryArrow: false,
        exitArrow: false
    };
}

/**
 * Los dos tramos de un D+N o de un 24 con el traspaso marcado.
 *
 * La llegada es el primer momento del dia. Todo lo que venga despues es el
 * traspaso de un tramo al otro, y ahi cual cierra y cual abre lo dice el boton
 * que apreto, no el orden: en un 24 el trabajador sale y vuelve a entrar en el
 * mismo minuto, las marcas se guardan sin segundos y el archivo las puede
 * traer en cualquier orden. El cierre de la noche es siempre la marca traida
 * del dia siguiente, este donde este en la lista.
 *
 * No se usan horas de corte: aguanta que el trabajador se equivoque de boton,
 * que es justamente lo que no se puede dar por bueno.
 */
function splitShiftSegments(marks, closing) {
    const own = marks.filter(mark => !mark.iso);
    const events = groupMarkEvents(own);
    // La llegada sale del primer momento: si marco dos veces al llegar, esas
    // dos son una sola llegada, vale la primera y ninguna de las dos puede ser
    // despues el traspaso.
    const entry = events[0]?.[0] || null;
    const tras = events.slice(1).flat();
    const exit = tras.find(mark => mark.type === "out") || tras[0] || null;
    const resto = tras.filter(mark => mark !== exit);
    const second = resto.find(mark => mark.type === "in") || resto[0] || null;
    const segment = (from, to) => ({
        entry: from || null,
        exit: to || null,
        entryIncident: Boolean(from) && from.type === "out",
        exitIncident: Boolean(to) && to.type !== "out",
        entryArrow: false,
        exitArrow: false
    });

    return [
        segment(entry, exit),
        segment(second, closing)
    ];
}

// Una salida antes del mediodia solo puede cerrar el turno de anoche: ningun
// turno de los que se usan termina tan temprano. Sirve para no confundirla con
// la salida propia del dia, que es a las 17 o a las 20.
const MORNING_EXIT_LIMIT = "12:00";

// Flecha de continuidad: el turno sigue en el turno de al lado sin que haya
// nada que marcar. La noche termina a las 8 y el turno de la manana empieza a
// las 8, asi que el trabajador nunca sale.
export const CONTINUES_MARK = "→";

/**
 * Marcas de un dia, ordenadas y normalizadas.
 */
function ownMarksFor(rut, iso) {
    return getMarksFor(rut, iso)
        .map(mark => ({
            time: String(mark.time || ""),
            type: mark.type === "out" ? "out" : "in"
        }))
        .filter(mark => mark.time)
        .sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * La marca con que se cerro un turno de noche, entre las marcas de la manana
 * siguiente.
 *
 * Tiene que ser de la manana: ningun turno de los que se usan termina antes del
 * mediodia, asi que una marca temprana no puede ser la salida propia del dia.
 *
 * Que la etiqueta importe o no depende de la PROGRAMACION de esa manana:
 *
 * - si ese dia no empieza turno por la manana (libre, o una noche), la marca
 *   temprana solo puede ser el cierre de la noche, diga entrada o salida. Es el
 *   caso de quien se equivoca de boton al salir;
 * - si ese dia SI empieza turno por la manana, una "entrada" temprana es su
 *   llegada y no el cierre de la noche. Ahi la etiqueta es lo unico que las
 *   distingue, asi que se respeta.
 */
function morningClosing(marks, { labelMatters, shiftStart = "" }) {
    return marks.find(mark =>
        (
            mark.time < MORNING_EXIT_LIMIT &&
            (!labelMatters || mark.type === "out")
        ) ||
        closesLateBeforeShift(mark, shiftStart)
    ) || null;
}

/**
 * .Es esta una salida de anoche marcada tarde, pasado el mediodia?
 *
 * El corte del mediodia da por hecho que el turno se cierra a su hora, y a
 * veces no: quien hace un 24 que termina a las 8 y se queda hasta las 12:58
 * deja su cierre fuera de la ventana. Ahi esa marca se quedaba en el dia
 * siguiente y lo desordenaba entero: pasaba por ser la llegada al turno de esa
 * noche -"marco salida en vez de entrada", "llego siete horas antes"- mientras
 * el 24 de la vispera quedaba sin salida.
 *
 * Lo que la delata es lo que apreto. Una marca de SALIDA no puede ser una
 * llegada, asi que si ademas ocurre ANTES de que empiece el turno de hoy no es
 * de hoy: hoy todavia no empezaba. Solo puede cerrar lo de anoche.
 *
 * Hace falta conocer la hora de hoy para acotarla. Sin turno hoy -un dia libre-
 * no hay con que acotar, y se deja como estaba: la marca queda en el dia y se
 * ve como marcaje en dia libre, que al menos la pone a la vista.
 */
function closesLateBeforeShift(mark, shiftStart) {
    return Boolean(
        shiftStart &&
        mark.type === "out" &&
        mark.time < shiftStart
    );
}

/**
 * Todas las marcas del momento en que se cerro el turno de anoche.
 *
 * No basta con la primera. Quien aprieta dos veces al salir -o aprieta el boton
 * equivocado y corrige en el acto- deja DOS marcas de una sola salida, y
 * llevarse solo una dejaba la otra suelta en el dia siguiente: si ese dia era
 * libre, aparecia como "marcaje en dia libre", como si hubiera venido a
 * trabajar. Son el mismo momento y van juntas a la fila de la noche, donde se
 * cuentan en el ⋯ y se nombran en el hover.
 *
 * Con turno por la manana solo se lleva las SALIDAS: ahi la etiqueta es lo
 * unico que separa el cierre de anoche de la llegada de hoy, y las dos caen
 * dentro del mismo momento -la noche termina a las 8 y la manana empieza a las
 * 8-. Sin turno de manana no hay llegada posible y el momento entero es el
 * cierre, diga lo que diga cada boton.
 */
function morningClosingEvent(marks, { labelMatters, shiftStart = "" }) {
    const closing = morningClosing(marks, { labelMatters, shiftStart });

    if (!closing) return [];

    const evento = groupMarkEvents(marks)
        .find(grupo => grupo.includes(closing)) || [closing];

    // Con turno de manana la etiqueta separa el cierre de la llegada, y una
    // salida tardia se lleva solo las salidas por la misma razon: lo que venga
    // etiquetado como entrada ya no es de anoche.
    return labelMatters || closesLateBeforeShift(closing, shiftStart)
        ? evento.filter(mark => mark.type === "out")
        : evento;
}

/**
 * Marcas que pertenecen al turno que empieza en `iso`, en orden.
 *
 * Un turno no cabe siempre dentro de su fecha: el que lleva noche se cierra a
 * la manana siguiente, y esa salida el reloj la deja en el dia siguiente.
 */
function shiftMarksFor(rut, iso, options) {
    const {
        endsNextMorning,
        previousEndsNextMorning,
        startsInTheMorning,
        nextStartsInTheMorning,
        scheduledEntry,
        nextScheduledEntry
    } = options;
    const own = ownMarksFor(rut, iso);
    // Las marcas con que cerro el turno de anoche se muestran en SU fila;
    // dejarlas aqui tambien las contaria dos veces.
    const previous = previousEndsNextMorning
        ? morningClosingEvent(own, {
            labelMatters: startsInTheMorning,
            shiftStart: scheduledEntry
        })
        : [];
    const marks = previous.length
        ? own.filter(mark => !previous.includes(mark))
        : own;
    const previousClosed = previous.length > 0;

    if (!endsNextMorning) return { marks, previousClosed };

    const nextIso = shiftIsoDay(iso, 1);
    const cierre = morningClosingEvent(ownMarksFor(rut, nextIso), {
        labelMatters: nextStartsInTheMorning,
        shiftStart: nextScheduledEntry
    });

    // Van al final y NO se reordenan: son del dia siguiente, asi que
    // cronologicamente cierran la lista aunque su hora sea menor que las de la
    // tarde. La primera es la salida; las demas son el mismo momento y quedan
    // para el ⋯ y el hover.
    return {
        previousClosed,
        marks: cierre.length
            ? [...marks, ...cierre.map(mark => ({ ...mark, iso: nextIso }))]
            : marks
    };
}

/**
 * Corre una fecha ISO la cantidad de dias indicada, cruzando mes y anio.
 */
function shiftIsoDay(iso, days) {
    const [year, month, day] = String(iso).split("-").map(Number);
    const date = new Date(year, (month || 1) - 1, (day || 1) + days);

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

/**
 * Horas de salida de un dia, de la mas temprana a la mas tardia.
 */
function exitTimes(rut, iso) {
    return getMarksFor(rut, iso)
        .filter(mark => mark.type === "out")
        .map(mark => String(mark.time || ""))
        .filter(Boolean)
        .sort();
}

/**
 * Hora de la marca de entrada de un dia, para medir el atraso.
 *
 * Usa el MISMO criterio que la celda "Entrada" del reporte (todo lo que no sea
 * salida) y se queda con la mas temprana: es la llegada. Si las dos no
 * coincidieran, la columna Atrasos contradiria a la de al lado.
 *
 * @param {string} rut
 * @param {string} iso
 * @returns {string} "HH:MM", o "" si ese dia no tiene entrada
 */
export function getEntryMarkTime(rut, iso) {
    const times = getMarksFor(rut, iso)
        .filter(mark => mark.type !== "out")
        .map(mark => String(mark.time || ""))
        .filter(Boolean)
        .sort();

    return times[0] || "";
}

/**
 * Lee un archivo del reloj control y guarda sus marcas.
 * @param {File} file
 */
export async function importAttendanceFile(file) {
    if (!file) throw new Error("Selecciona el archivo del reloj control.");

    const name = String(file.name || "").toLowerCase();

    if (!name.endsWith(".xls") && !name.endsWith(".xlsx")) {
        throw new Error("El registro de asistencia debe ser un archivo Excel.");
    }

    const buffer = await file.arrayBuffer();
    // Por el contenido y no por la extension: un .xls renombrado a .xlsx (o al
    // reves) se lee igual.
    const rows = isXlsxFile(buffer)
        ? await readXlsxRows(buffer)
        : readXlsRows(buffer);
    const { marks, skipped } = parseAttendanceRows(rows);

    if (!marks.length) {
        throw new Error("El archivo no trae marcas de asistencia legibles.");
    }

    return { ...mergeAttendanceMarks(marks), skipped, total: marks.length };
}
