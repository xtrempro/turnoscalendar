// Cobertura PARCIAL de un turno: dos funcionarios cubriendo un mismo turno.
//
// Un permiso deja el turno del ausente descubierto y alguien lo cubre. Hasta
// ahora bastaba UN reemplazo para dar el turno por cubierto y apagar el "!".
// Pero al reemplazante se le puede recortar la jornada -entra a las 08:00 y se
// va a las 13:00 de una Larga que va hasta las 20:00-, y entonces quedan horas
// que nadie hace: el turno vuelve a necesitar cobertura por el tramo que falta,
// y ese tramo puede tomarlo un segundo trabajador.
//
// Cada reemplazo puede traer estampado el tramo que cubre. Un reemplazo SIN
// tramo cubre el turno entero, que es como se comportaron siempre: por eso
// todos los registros anteriores siguen valiendo tal cual.
//
// Vive aparte y sin DOM a proposito, porque esta regla la corren tres lados:
// el navegador (calendario, timeline e inicio), el motor de proyeccion del
// servidor -que la consulta a traves de js/leaveHold.js para decidir si el
// permiso ya puede viajar a la PWA- y la cobertura automatica por etapas. Por
// eso NO importa js/clockMarks.js, que es todo DOM: las horas efectivas se
// calculan en el navegador y se estampan aqui como texto.

const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const MINUTES_PER_DAY = 24 * 60;

/** "8:00" -> "08:00". Devuelve "" si no es una hora valida. */
export function normalizeCoverTime(value) {
    const match = TIME_PATTERN.exec(String(value || "").trim());

    if (!match) return "";

    return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function toMinutes(time) {
    const clean = normalizeCoverTime(time);

    if (!clean) return null;

    const [hours, minutes] = clean.split(":").map(Number);

    return hours * 60 + minutes;
}

/**
 * Tramo en minutos contados DESDE el inicio del turno.
 *
 * Un turno de noche cruza la medianoche (20:00 a 08:00), asi que una hora
 * "menor" que el inicio cae al dia siguiente. Medir todo desde el inicio del
 * turno evita tener que arrastrar fechas.
 */
function spanFromShiftStart(shiftStartMinutes, from, until) {
    const start = toMinutes(from);
    const end = toMinutes(until);

    if (start === null || end === null) return null;

    const offset = minutes => {
        const diff = minutes - shiftStartMinutes;

        return diff < 0 ? diff + MINUTES_PER_DAY : diff;
    };
    const startOffset = offset(start);
    // Un tramo que termina justo en el inicio del turno dura el dia entero, no
    // cero: es el caso de la noche completa (20:00 a 20:00 no existe, pero
    // 20:00 a 08:00 da 720 y 08:00 a 08:00 del turno de noche daria 0).
    const endOffset = offset(end) || (end === start ? 0 : MINUTES_PER_DAY);

    if (endOffset <= startOffset) return null;

    return { start: startOffset, end: endOffset };
}

/** La ventana del turno: {from, until} en texto, o null. */
export function shiftWindowFromRecord(record = {}) {
    const from = normalizeCoverTime(record.shiftFrom);
    const until = normalizeCoverTime(record.shiftUntil);

    return from && until ? { from, until } : null;
}

/**
 * El tramo que cubre este reemplazo, o null si cubre el turno entero.
 *
 * Sin tramo estampado el reemplazo cubre todo: asi se comportaron siempre los
 * reemplazos y asi siguen comportandose los que ya estaban guardados.
 */
export function coverWindowFromRecord(record = {}) {
    const from = normalizeCoverTime(record.coverFrom);
    const until = normalizeCoverTime(record.coverUntil);

    return from && until ? { from, until } : null;
}

function mergeSpans(spans) {
    const sorted = [...spans].sort((a, b) => a.start - b.start);
    const merged = [];

    sorted.forEach(span => {
        const last = merged[merged.length - 1];

        if (last && span.start <= last.end) {
            last.end = Math.max(last.end, span.end);
            return;
        }

        merged.push({ ...span });
    });

    return merged;
}

function minutesToTime(shiftStartMinutes, offset) {
    const total = (shiftStartMinutes + offset) % MINUTES_PER_DAY;
    const hours = Math.floor(total / 60);
    const minutes = total % 60;

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Los tramos del turno que NADIE cubre.
 *
 * @param {{from: string, until: string}} shiftWindow horario del turno.
 * @param {Array<Object>} records reemplazos vigentes de ese turno.
 * @returns {Array<{from: string, until: string}>} vacio si esta cubierto entero.
 */
export function coverageGapsForShift(shiftWindow, records = []) {
    const shiftStart = toMinutes(shiftWindow?.from);
    const shift = shiftStart === null
        ? null
        : spanFromShiftStart(
            shiftStart,
            shiftWindow.from,
            shiftWindow.until
        );

    if (!shift) return [];

    const list = Array.isArray(records) ? records : [];

    // Un solo reemplazo sin tramo ya cubre el turno completo.
    if (list.some(record => record && !coverWindowFromRecord(record))) {
        return [];
    }

    const covered = mergeSpans(
        list
            .map(record => {
                const window = coverWindowFromRecord(record);

                return window
                    ? spanFromShiftStart(
                        shiftStart,
                        window.from,
                        window.until
                    )
                    : null;
            })
            .filter(Boolean)
    );
    const gaps = [];
    let cursor = shift.start;

    covered.forEach(span => {
        if (span.end <= shift.start || span.start >= shift.end) return;

        const start = Math.max(span.start, shift.start);
        const end = Math.min(span.end, shift.end);

        if (start > cursor) {
            gaps.push({ start: cursor, end: start });
        }

        cursor = Math.max(cursor, end);
    });

    if (cursor < shift.end) {
        gaps.push({ start: cursor, end: shift.end });
    }

    return gaps.map(gap => ({
        from: minutesToTime(shiftStart, gap.start),
        until: minutesToTime(shiftStart, gap.end)
    }));
}

/**
 * .Los reemplazos cubren el turno entero?
 *
 * Sin horario de turno conocido se responde como siempre: cualquier reemplazo
 * vigente lo da por cubierto. Asi, un dato que falte nunca hace aparecer un "!"
 * que antes no estaba.
 */
export function shiftIsFullyCovered(shiftWindow, records = []) {
    const list = (Array.isArray(records) ? records : []).filter(Boolean);

    if (!list.length) return false;
    if (!shiftWindow?.from || !shiftWindow?.until) return true;

    return coverageGapsForShift(shiftWindow, list).length === 0;
}

/**
 * La ventana del turno segun los propios reemplazos.
 *
 * Solo los reemplazos PARCIALES la traen estampada. Si ninguno la trae, no hay
 * contra que medir y la cobertura se comporta como siempre.
 */
export function shiftWindowFromRecords(records = []) {
    return (Array.isArray(records) ? records : [])
        .map(record => shiftWindowFromRecord(record || {}))
        .find(Boolean) || null;
}

/**
 * .Este turno quedo cubierto ENTERO por los reemplazos que tiene?
 *
 * Es la pregunta que reemplaza al viejo "tiene algun reemplazo": mientras
 * queden horas sin nadie, el turno sigue necesitando cobertura.
 */
export function coveredShiftIsComplete(records = []) {
    return shiftIsFullyCovered(
        shiftWindowFromRecords(records),
        records
    );
}

/** Los tramos sin cubrir de un turno, leyendo la ventana de los reemplazos. */
export function coverageGapsFromRecords(records = [], shiftWindow = null) {
    return coverageGapsForShift(
        shiftWindow || shiftWindowFromRecords(records),
        records
    );
}

/** "desde las 08:00 hasta las 13:00" */
export function coverWindowLabel(window) {
    const from = normalizeCoverTime(window?.from);
    const until = normalizeCoverTime(window?.until);

    if (!from || !until) return "";

    return `desde las ${from} hasta las ${until}`;
}
