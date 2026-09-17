import { TURNO, TURNO_LABEL } from "./constants.js";
import { isBusinessDay } from "./calculations.js";
import { getJSON, setJSON } from "./persistence.js";
import { getRotativa } from "./storage.js";
import { getHourReturn } from "./hourReturns.js";
import { createClockMemoTask } from "./memos.js";
import {
    cloneDate,
    dateAt,
    nextDateAt,
    parseTimeValue as parseTime,
    timeNearReference
} from "./timeUtils.js";
import { classifyClockMarkSegment } from "./clockMarkUtils.js";

const BLOCK_MINUTES = 30;

function storageKey(profile) {
    return `clockMarks_${profile}`;
}

function minutesBetween(start, end) {
    return Math.max(0, Math.round((end - start) / 60000));
}

function addMinutes(date, minutes) {
    const next = cloneDate(date);
    next.setMinutes(next.getMinutes() + minutes);
    return next;
}

function roundLateMinutes(minutes) {
    return Math.ceil(minutes / BLOCK_MINUTES) * BLOCK_MINUTES;
}

function roundExtraMinutes(minutes) {
    return Math.floor(minutes / BLOCK_MINUTES) * BLOCK_MINUTES;
}

// Dias de JORNADA CORTA por fiestas: la vispera del 18 de septiembre, la de
// Navidad y la de Ano Nuevo. Esos dias la jornada diurna se anticipa y termina
// 12:30 -y los viernes 12:00, como si a todos les dieran medio administrativo
// de tarde-.
//
// Van como "mes-dia" y sin ano porque son fechas fijas. Solo aplican en dia
// habil, que es lo que ya comprueba quien arma el tramo diurno.
const SHORT_DIURNO_DAYS = new Set(["9-17", "12-24", "12-31"]);

function isShortDiurnoDay(date) {
    return SHORT_DIURNO_DAYS.has(
        `${date.getMonth() + 1}-${date.getDate()}`
    );
}

/**
 * A que hora termina la jornada diurna de ese dia.
 *
 * Devuelve la fecha y no la hora suelta porque la jornada corta termina a las
 * 12:30, y una hora entera no alcanza para decirlo.
 */
function diurnoEndAt(date) {
    const isFriday = date.getDay() === 5;

    if (isShortDiurnoDay(date)) {
        return isFriday
            ? dateAt(date, 12)
            : dateAt(date, 12, 30);
    }

    return dateAt(date, isFriday ? 16 : 17);
}

function minDate(...dates) {
    return new Date(
        Math.min(...dates.map(date => date.getTime()))
    );
}

function maxDate(...dates) {
    return new Date(
        Math.max(...dates.map(date => date.getTime()))
    );
}

function hoursBetween(start, end) {
    return Math.max(0, (end - start) / 36e5);
}

function nextClassificationBoundary(cursor, end) {
    const candidates = [
        new Date(
            cursor.getFullYear(),
            cursor.getMonth(),
            cursor.getDate() + 1,
            0,
            0
        )
    ];

    [7, 21].forEach(hour => {
        const boundary = dateAt(cursor, hour);

        if (boundary > cursor) {
            candidates.push(boundary);
        }
    });

    candidates.push(end);

    return minDate(...candidates.filter(date => date > cursor));
}

function isNocturnalSegment(cursor, holidays) {
    const day = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate()
    );

    if (!isBusinessDay(day, holidays)) {
        return true;
    }

    const hour =
        cursor.getHours() + cursor.getMinutes() / 60;

    return hour < 7 || hour >= 21;
}

function classifyInterval(interval, holidays) {
    const total = { d: 0, n: 0 };
    let cursor = cloneDate(interval.start);

    while (cursor < interval.end) {
        const boundary =
            nextClassificationBoundary(cursor, interval.end);
        const amount = hoursBetween(cursor, boundary);

        if (isNocturnalSegment(cursor, holidays)) {
            total.n += amount;
        } else {
            total.d += amount;
        }

        cursor = boundary;
    }

    return total;
}

function addHours(target, source) {
    target.d += source.d;
    target.n += source.n;
}

function subtractOneInterval(source, blocker) {
    if (
        blocker.end <= source.start ||
        blocker.start >= source.end
    ) {
        return [source];
    }

    const pieces = [];

    if (blocker.start > source.start) {
        pieces.push({
            start: source.start,
            end: minDate(blocker.start, source.end)
        });
    }

    if (blocker.end < source.end) {
        pieces.push({
            start: maxDate(blocker.end, source.start),
            end: source.end
        });
    }

    return pieces.filter(piece => piece.end > piece.start);
}

function subtractIntervals(actualIntervals, baseIntervals) {
    let fragments = [...actualIntervals];

    baseIntervals.forEach(base => {
        fragments = fragments.flatMap(fragment =>
            subtractOneInterval(fragment, base)
        );
    });

    return fragments;
}

export function getClockMarks(profile) {
    if (!profile) return {};

    return getJSON(storageKey(profile), {});
}

export function saveClockMarks(profile, marks) {
    if (!profile) return;

    setJSON(storageKey(profile), marks || {});

    // Republicar la proyección del trabajador: modificar un marcaje (recuperación
    // de horas / horas extra / reducción) debe reflejarse en la PWA. El guardado
    // local no dispara el rebuild por sí solo, así que avisamos a quien orquesta la
    // publicación. La hidratación desde Firestore escribe el storage directo (no
    // pasa por aquí), por eso esto no genera un bucle.
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
        window.dispatchEvent(new CustomEvent("proturnos:clockMarksChanged", {
            detail: { profile }
        }));
    }
}

export function getClockMark(profile, keyDay) {
    return getClockMarks(profile)[keyDay] || null;
}

export function hasClockMark(profile, keyDay) {
    const mark = getClockMark(profile, keyDay);

    return Boolean(
        mark &&
        mark.segments &&
        Object.keys(mark.segments).length
    );
}

/**
 * .Hay un turno al que este marcaje pueda pertenecer?
 *
 * Un marcaje se registra SOBRE el turno del dia: sus horas se comparan contra
 * el horario de ese turno. Si despues le quitan el turno a la casilla, la marca
 * queda huerfana -no hay horario contra el cual compararla- y el editor la
 * rechaza ("Selecciona un dia que tenga turno para modificar sus marcajes").
 * Mientras el reloj siguiera apareciendo, la casilla quedaba secuestrada: el
 * click abria el detalle en vez de editar, asi que no se podia ni sacar el
 * icono ni volver a asignar un turno.
 *
 * @param {number|string} state Turno efectivo del dia (con cambios/reemplazos).
 * @returns {boolean}
 */
export function clockMarkAppliesToTurn(state) {
    return (Number(state) || TURNO.LIBRE) !== TURNO.LIBRE;
}

/**
 * Borra el marcaje de un dia. Se usa cuando la casilla se queda sin turno (la
 * marca ya no describe nada) o cuando vuelve a tener uno despues de haber
 * quedado libre, para que el marcaje viejo no reaparezca pegado al turno nuevo.
 *
 * @param {string} profile
 * @param {string} keyDay
 * @returns {boolean} true si habia algo que borrar.
 */
export function clearClockMark(profile, keyDay) {
    if (!profile || !keyDay) return false;

    const marks = getClockMarks(profile);

    if (!marks[keyDay]) return false;

    delete marks[keyDay];
    saveClockMarks(profile, marks);

    return true;
}

export function getClockScheduleState(profile, keyDay, state) {
    const admin = getJSON(`admin_${profile}`, {});

    if (admin[keyDay] === "0.5M") {
        return TURNO.MEDIA_TARDE;
    }

    if (admin[keyDay] === "0.5T") {
        return TURNO.MEDIA_MANANA;
    }

    return Number(state) || TURNO.LIBRE;
}

/**
 * .Se parte la jornada de este trabajador a las 14:00?
 *
 * Un 1/2 ADM es la mitad de la jornada, asi que donde queda el corte depende de
 * cuanto dura el turno base, y eso lo fija la ROTATIVA:
 *
 * - 3er y 4to turno tienen base Larga, de 08:00 a 20:00. La mitad son 6 horas,
 *   asi que el corte va a las 14:00.
 * - Diurno es de 08:00 a 17:00 (16:00 los viernes). La mitad son 4,5 horas y el
 *   corte va a las 12:30 (12:00 los viernes).
 *
 * Antes esto ademas exigia tener asignacion de turno, y por eso un trabajador
 * de 3er o 4to turno SIN asignacion salia con el corte del diurno: entrando a
 * las 12:30 en vez de las 14:00, y retirandose a las 12:30 en vez de las 14:00
 * en un 1/2 ADM tarde. La asignacion no cambia la duracion de su turno base.
 */
function usesAssignedHalfAdminSchedule(profile) {
    return ["3turno", "4turno"].includes(getRotativa(profile).type);
}

function halfAdminDiurnoSplit(date) {
    const friday = date.getDay() === 5;

    return {
        morningEndHour: friday ? 12 : 12,
        morningEndMinute: friday ? 0 : 30,
        afternoonStartHour: friday ? 12 : 12,
        afternoonStartMinute: friday ? 0 : 30,
        endHour: friday ? 16 : 17
    };
}

function getHalfAdminScheduledSegments(profile, keyDay, date) {
    const admin = getJSON(`admin_${profile}`, {});
    const assignedSchedule = usesAssignedHalfAdminSchedule(profile);

    if (admin[keyDay] === "0.5M") {
        const split = halfAdminDiurnoSplit(date);

        return [{
            id: "half_admin_morning",
            label: "1/2 ADM Ma\u00f1ana",
            start: assignedSchedule
                ? dateAt(date, 14)
                : dateAt(
                    date,
                    split.afternoonStartHour,
                    split.afternoonStartMinute
                ),
            end: dateAt(
                date,
                assignedSchedule ? 20 : split.endHour
            )
        }];
    }

    if (admin[keyDay] === "0.5T") {
        const split = halfAdminDiurnoSplit(date);

        return [{
            id: "half_admin_afternoon",
            label: "1/2 ADM Tarde",
            start: dateAt(date, 8),
            end: assignedSchedule
                ? dateAt(date, 14)
                : dateAt(
                    date,
                    split.morningEndHour,
                    split.morningEndMinute
                )
        }];
    }

    return null;
}

function getRawScheduledSegmentsForProfile(
    profile,
    keyDay,
    date,
    state,
    holidays = {}
) {
    const halfAdminSegments =
        getHalfAdminScheduledSegments(profile, keyDay, date);

    if (halfAdminSegments) {
        return halfAdminSegments;
    }

    return getScheduledSegmentsForState(
        date,
        state,
        holidays
    );
}

function hourReturnMatchesSegment(record, segment, segments) {
    if (!record) return false;

    if (!record.segmentId) {
        return segments.length === 1;
    }

    return String(record.segmentId) === String(segment.id);
}

function applyHourReturnToSegments(
    profile,
    keyDay,
    date,
    segments
) {
    const record = getHourReturn(profile, keyDay);

    if (!record) {
        return segments;
    }

    return segments
        .map(segment => {
            if (!hourReturnMatchesSegment(record, segment, segments)) {
                return segment;
            }

            if (record.fullTurn) {
                return null;
            }

            const entry = record.entryTime
                ? timeNearReference(
                    date,
                    record.entryTime,
                    segment.start
                )
                : null;
            const exit = record.exitTime
                ? timeNearReference(
                    date,
                    record.exitTime,
                    segment.end
                )
                : null;
            const start = entry
                ? maxDate(segment.start, entry)
                : cloneDate(segment.start);
            const end = exit
                ? minDate(segment.end, exit)
                : cloneDate(segment.end);

            if (end <= start) return null;

            return {
                ...segment,
                start,
                end,
                hourReturn: record
            };
        })
        .filter(Boolean);
}

function getHourReturnPermissionIntervals(
    profile,
    keyDay,
    date,
    state,
    holidays = {}
) {
    const record = getHourReturn(profile, keyDay);

    if (!record) return [];

    const rawSegments = getRawScheduledSegmentsForProfile(
        profile,
        keyDay,
        date,
        state,
        holidays
    );
    const adjustedSegments = applyHourReturnToSegments(
        profile,
        keyDay,
        date,
        rawSegments
    );

    return rawSegments
        .filter(segment =>
            hourReturnMatchesSegment(record, segment, rawSegments)
        )
        .flatMap(segment => {
            const baseInterval = {
                start: segment.start,
                end: segment.end
            };

            if (record.fullTurn) {
                return [baseInterval];
            }

            const workedInterval = adjustedSegments
                .filter(item => item.id === segment.id)
                .map(item => ({
                    start: item.start,
                    end: item.end
                }));

            return subtractIntervals(
                [baseInterval],
                workedInterval
            );
        });
}

function getHalfAdminPermissionIntervals(
    profile,
    keyDay,
    date,
    state,
    holidays = {}
) {
    const admin = getJSON(`admin_${profile}`, {});

    if (admin[keyDay] !== "0.5M" && admin[keyDay] !== "0.5T") {
        return [];
    }

    const workedSegments =
        getHalfAdminScheduledSegments(profile, keyDay, date);
    const baseSegments = getScheduledSegmentsForState(
        date,
        state,
        holidays
    );

    if (!workedSegments || !baseSegments.length) return [];

    return subtractIntervals(
        baseSegments.map(segment => ({
            start: segment.start,
            end: segment.end
        })),
        workedSegments.map(segment => ({
            start: segment.start,
            end: segment.end
        }))
    );
}

function getNonExtraPermissionIntervals(
    profile,
    keyDay,
    date,
    state,
    holidays = {}
) {
    return [
        ...getHalfAdminPermissionIntervals(
            profile,
            keyDay,
            date,
            state,
            holidays
        ),
        ...getHourReturnPermissionIntervals(
            profile,
            keyDay,
            date,
            state,
            holidays
        )
    ];
}

export function getScheduledSegmentsForProfile(
    profile,
    keyDay,
    date,
    state,
    holidays = {}
) {
    return applyHourReturnToSegments(
        profile,
        keyDay,
        date,
        getRawScheduledSegmentsForProfile(
            profile,
            keyDay,
            date,
            state,
            holidays
        )
    );
}

export function getScheduledSegmentsForState(date, state, holidays = {}) {
    const turno = Number(state) || TURNO.LIBRE;

    if (turno === TURNO.LIBRE) return [];

    if (turno === TURNO.LARGA) {
        return [{
            id: "larga",
            label: "Larga",
            start: dateAt(date, 8),
            end: dateAt(date, 20)
        }];
    }

    if (turno === TURNO.NOCHE) {
        return [{
            id: "noche",
            label: "Noche",
            start: dateAt(date, 20),
            end: nextDateAt(date, 8)
        }];
    }

    if (turno === TURNO.TURNO24) {
        return [{
            id: "turno24",
            label: TURNO_LABEL[TURNO.TURNO24],
            start: dateAt(date, 8),
            end: nextDateAt(date, 8)
        }];
    }

    if (turno === TURNO.DIURNO) {
        if (!isBusinessDay(date, holidays)) return [];

        return [{
            id: "diurno",
            label: "Diurno",
            start: dateAt(date, 8),
            end: diurnoEndAt(date)
        }];
    }

    if (turno === TURNO.DIURNO_NOCHE) {
        const segments = [];

        if (isBusinessDay(date, holidays)) {
            segments.push({
                id: "diurno",
                label: "Diurno",
                start: dateAt(date, 8),
                end: diurnoEndAt(date)
            });
        }

        segments.push({
            id: "noche",
            label: "Noche",
            start: dateAt(date, 20),
            end: nextDateAt(date, 8)
        });

        return segments;
    }

    if (turno === TURNO.MEDIA_MANANA) {
        return [{
            id: "half_morning",
            label: "1/2 ADM Ma\u00f1ana",
            start: dateAt(date, 8),
            end: dateAt(date, 14)
        }];
    }

    if (turno === TURNO.MEDIA_TARDE) {
        return [{
            id: "half_afternoon",
            label: "1/2 ADM Tarde",
            start: dateAt(date, 14),
            end: dateAt(date, 20)
        }];
    }

    if (turno === TURNO.TURNO18) {
        return [{
            id: "turno18",
            label: "18 horas",
            start: dateAt(date, 14),
            end: nextDateAt(date, 8)
        }];
    }

    return [];
}

function adjustedSegment(baseDate, segment, mark) {
    if (!mark) return {
        start: cloneDate(segment.start),
        end: cloneDate(segment.end)
    };

    if (mark.rrhhPayApproved || mark.discountWaived) {
        return {
            start: cloneDate(segment.start),
            end: cloneDate(segment.end)
        };
    }

    if (mark.missingEntry || mark.missingExit) {
        return null;
    }

    let start = cloneDate(segment.start);
    let end = cloneDate(segment.end);

    if (mark.entryTime) {
        const entry = timeNearReference(
            baseDate,
            mark.entryTime,
            segment.start
        );

        if (entry) {
            if (entry > segment.start) {
                start = addMinutes(
                    segment.start,
                    roundLateMinutes(
                        minutesBetween(segment.start, entry)
                    )
                );
            } else if (entry < segment.start) {
                start = addMinutes(
                    segment.start,
                    -roundExtraMinutes(
                        minutesBetween(entry, segment.start)
                    )
                );
            }
        }
    }

    if (mark.exitTime) {
        const exit = timeNearReference(
            baseDate,
            mark.exitTime,
            segment.end
        );

        if (exit) {
            if (exit < segment.end) {
                end = addMinutes(
                    segment.end,
                    -roundLateMinutes(
                        minutesBetween(exit, segment.end)
                    )
                );
            } else if (exit > segment.end) {
                end = addMinutes(
                    segment.end,
                    roundExtraMinutes(
                        minutesBetween(segment.end, exit)
                    )
                );
            }
        }
    }

    if (end <= start) return null;

    return { start, end };
}

function getSegmentMark(mark, segment) {
    if (!mark?.segments) return null;

    const aliases = {
        half_admin_morning: ["half_afternoon"],
        half_admin_afternoon: ["half_morning"]
    };

    return mark.segments[segment.id] ||
        (aliases[segment.id] || [])
            .map(alias => mark.segments[alias])
            .find(Boolean) ||
        null;
}

export function getWorkedIntervalsForState(
    profile,
    keyDay,
    date,
    state,
    holidays = {}
) {
    const mark = getClockMark(profile, keyDay);
    const scheduledState = getClockScheduleState(
        profile,
        keyDay,
        state
    );
    const segments = getScheduledSegmentsForProfile(
        profile,
        keyDay,
        date,
        scheduledState,
        holidays
    );

    if (!mark) {
        return segments.map(segment => ({
            start: cloneDate(segment.start),
            end: cloneDate(segment.end)
        }));
    }

    return segments
        .map(segment =>
            adjustedSegment(
                date,
                segment,
                getSegmentMark(mark, segment)
            )
        )
        .filter(Boolean);
}

export function hasClockExtra(profile, keyDay, date, state, holidays = {}) {
    const extra = getClockExtraHours(
        profile,
        keyDay,
        date,
        state,
        holidays
    );

    return Boolean(extra.d || extra.n);
}

export function getClockExtraHours(
    profile,
    keyDay,
    date,
    state,
    holidays = {}
) {
    const scheduledState = getClockScheduleState(
        profile,
        keyDay,
        state
    );
    const scheduled = getScheduledSegmentsForProfile(
        profile,
        keyDay,
        date,
        scheduledState,
        holidays
    ).map(segment => ({
        start: segment.start,
        end: segment.end
    }));
    const nonExtraIntervals = [
        ...scheduled,
        ...getNonExtraPermissionIntervals(
            profile,
            keyDay,
            date,
            Number(state) || TURNO.LIBRE,
            holidays
        )
    ];
    const worked = getWorkedIntervalsForState(
        profile,
        keyDay,
        date,
        state,
        holidays
    );
    const extraIntervals = subtractIntervals(
        worked,
        nonExtraIntervals
    );
    const total = { d: 0, n: 0 };

    extraIntervals.forEach(interval => {
        addHours(total, classifyInterval(interval, holidays));
    });

    return {
        d: Math.round(total.d * 2) / 2,
        n: Math.round(total.n * 2) / 2
    };
}

// Horas programadas que NO se trabajaron por una incidencia de marcaje (ingreso
// con atraso, salida anticipada o marca faltante), excluyendo lo cubierto por un
// permiso. Es el espejo de getClockExtraHours: si no hay marca, lo trabajado
// equivale a lo programado y el deficit es 0.
export function getClockDeficitHours(
    profile,
    keyDay,
    date,
    state,
    holidays = {}
) {
    const scheduledState = getClockScheduleState(
        profile,
        keyDay,
        state
    );
    const scheduled = getScheduledSegmentsForProfile(
        profile,
        keyDay,
        date,
        scheduledState,
        holidays
    ).map(segment => ({
        start: segment.start,
        end: segment.end
    }));
    const worked = getWorkedIntervalsForState(
        profile,
        keyDay,
        date,
        state,
        holidays
    );
    const permissionIntervals = getNonExtraPermissionIntervals(
        profile,
        keyDay,
        date,
        Number(state) || TURNO.LIBRE,
        holidays
    );
    const deficitIntervals = subtractIntervals(
        subtractIntervals(scheduled, worked),
        permissionIntervals
    );
    const total = { d: 0, n: 0 };

    deficitIntervals.forEach(interval => {
        addHours(total, classifyInterval(interval, holidays));
    });

    return {
        d: Math.round(total.d * 2) / 2,
        n: Math.round(total.n * 2) / 2
    };
}

// Horas extra NETAS del marcaje: el excedente trabajado menos el deficit. Es el
// espejo de la "Recuperacion de horas": si el atraso se compensa con la salida
// tardia (turnos diurnos/larga), esa parte NO es hora extra y no requiere
// motivo. Se resta por banda (d/n); en la noche el excedente (manana, diurno) y
// el deficit (tarde, nocturno) caen en bandas distintas, asi que no se
// compensan entre si (la noche no recupera). Coincide con la HH.EE del reporte.
export function getClockNetExtraHours(profile, keyDay, date, state, holidays = {}) {
    const extra = getClockExtraHours(profile, keyDay, date, state, holidays);
    const deficit = getClockDeficitHours(profile, keyDay, date, state, holidays);

    return {
        d: Math.max(0, extra.d - deficit.d),
        n: Math.max(0, extra.n - deficit.n)
    };
}

export function hasClockNetExtra(profile, keyDay, date, state, holidays = {}) {
    const net = getClockNetExtraHours(profile, keyDay, date, state, holidays);

    return Boolean(net.d || net.n);
}

export function hasSevereClockIncident(profile, keyDay) {
    const mark = getClockMark(profile, keyDay);

    if (!mark?.segments) return false;

    return Object.values(mark.segments).some(segment =>
        (segment?.missingEntry || segment?.missingExit) &&
        !segment?.rrhhPayApproved
    );
}

/**
 * .Se movio a mano la hora de entrada de este dia?
 *
 * Importa para la continuidad entre turnos. Una noche termina a las 8 y el
 * turno de la manana empieza a las 8, asi que normalmente el trabajador sigue
 * de largo y no hay nada que marcar. Pero si el supervisor le autorizo entrar
 * mas tarde -por ejemplo a las 13:00-, la jornada se parte: el trabajador tuvo
 * que marcar la salida de su noche, irse, y volver a marcar su entrada. Ahi las
 * dos marcas son obligatorias y no corresponde la flecha de continuidad.
 *
 * @param {string} profile
 * @param {string} keyDay
 * @returns {boolean}
 */
export function hasModifiedEntryTime(profile, keyDay) {
    const mark = getClockMark(profile, keyDay);

    if (!mark?.segments) return false;

    return Object.values(mark.segments).some(segment => segment?.entryTime);
}

/**
 * .Se movio a mano la hora de salida de este dia?
 *
 * Si el supervisor autorizo salir antes -una reduccion de jornada-, irse
 * temprano no es una incidencia: estaba permitido.
 */
export function hasModifiedExitTime(profile, keyDay) {
    const mark = getClockMark(profile, keyDay);

    if (!mark?.segments) return false;

    return Object.values(mark.segments).some(segment => segment?.exitTime);
}

export function hasSimpleClockIncident(profile, keyDay) {
    const mark = getClockMark(profile, keyDay);

    if (!mark?.segments || hasSevereClockIncident(profile, keyDay)) {
        return false;
    }

    return Object.values(mark.segments).some(segment =>
        (segment?.entryTime || segment?.exitTime) &&
        !segment?.rrhhPayApproved &&
        !segment?.discountWaived
    );
}

function formatSegmentTime(date) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function timePartsFromDate(date) {
    return {
        hour: String(date.getHours()).padStart(2, "0"),
        minute: String(date.getMinutes()).padStart(2, "0")
    };
}

function timePartsFromMark(value, fallback) {
    const parsed = parseTime(value);

    if (!parsed) return timePartsFromDate(fallback);

    return {
        hour: String(parsed.hour).padStart(2, "0"),
        minute: String(parsed.minute).padStart(2, "0")
    };
}

function segmentTitle(segment) {
    if (segment.id === "diurno") return "Turno Diurno";
    if (segment.id === "noche") return "Turno Noche";
    if (segment.id === "larga") return "Turno Larga";
    if (segment.id === "turno24") return "Turno 24";
    if (segment.id === "turno18") return "Turno 18 horas";
    if (segment.id === "half_morning") return "1/2 ADM Ma\u00f1ana";
    if (segment.id === "half_afternoon") return "1/2 ADM Tarde";
    if (segment.id === "half_admin_morning") return "1/2 ADM Ma\u00f1ana";
    if (segment.id === "half_admin_afternoon") return "1/2 ADM Tarde";

    return `Turno ${segment.label}`;
}

function clockIncidentTimeDetail({
    side,
    actual,
    scheduled
}) {
    if (!actual || !scheduled) return "";

    const actualLabel = formatSegmentTime(actual);
    const scheduledLabel = formatSegmentTime(scheduled);

    if (actual.getTime() === scheduled.getTime()) {
        return `${side} ${actualLabel}`;
    }

    const isEntry = side === "Entrada";
    const isAfter = actual > scheduled;
    const minutes = isAfter
        ? minutesBetween(scheduled, actual)
        : minutesBetween(actual, scheduled);
    const incident = isEntry
        ? (
            isAfter
                ? `${minutes} min de atraso`
                : `${minutes} min anticipada`
        )
        : (
            isAfter
                ? `${minutes} min posterior`
                : `${minutes} min anticipada`
        );

    return `${side} ${actualLabel} (${incident}; programada ${scheduledLabel})`;
}

export function getClockIncidentDetail(
    profile,
    keyDay,
    date,
    state,
    holidays = {}
) {
    const mark = getClockMark(profile, keyDay);

    if (!mark?.segments) return "";

    const scheduledState = getClockScheduleState(
        profile,
        keyDay,
        state
    );
    const scheduledSegments = getScheduledSegmentsForProfile(
        profile,
        keyDay,
        date,
        scheduledState,
        holidays
    );
    const usedMarks = new Set();
    const details = [];

    scheduledSegments.forEach(segment => {
        const segmentMark = getSegmentMark(mark, segment);

        if (!segmentMark) return;

        usedMarks.add(segmentMark);

        const hasMissing = Boolean(
            segmentMark.missingEntry ||
            segmentMark.missingExit
        );

        if (
            segmentMark.rrhhPayApproved ||
            (!hasMissing && segmentMark.discountWaived)
        ) {
            return;
        }

        const incidentParts = [];

        if (segmentMark.missingEntry) {
            incidentParts.push("Sin marcaje de entrada");
        } else if (segmentMark.entryTime) {
            incidentParts.push(
                clockIncidentTimeDetail({
                    side: "Entrada",
                    actual: timeNearReference(
                        date,
                        segmentMark.entryTime,
                        segment.start
                    ),
                    scheduled: segment.start
                })
            );
        }

        if (segmentMark.missingExit) {
            incidentParts.push("Sin marcaje de salida");
        } else if (segmentMark.exitTime) {
            incidentParts.push(
                clockIncidentTimeDetail({
                    side: "Salida",
                    actual: timeNearReference(
                        date,
                        segmentMark.exitTime,
                        segment.end
                    ),
                    scheduled: segment.end
                })
            );
        }

        const note = String(
            segmentMark.adminNote ||
            segmentMark.comments ||
            ""
        ).trim();

        if (note) {
            incidentParts.push(`Comentario: ${note}`);
        }

        if (incidentParts.length) {
            details.push(
                `${segmentTitle(segment)}: ${incidentParts.filter(Boolean).join("; ")}`
            );
        }
    });

    Object.entries(mark.segments)
        .filter(([, segmentMark]) =>
            segmentMark &&
            !usedMarks.has(segmentMark) &&
            !segmentMark.rrhhPayApproved
        )
        .forEach(([segmentKey, segmentMark]) => {
            const incidentParts = [];

            if (segmentMark.missingEntry) {
                incidentParts.push("Sin marcaje de entrada");
            } else if (segmentMark.entryTime) {
                incidentParts.push(`Entrada ${segmentMark.entryTime}`);
            }

            if (segmentMark.missingExit) {
                incidentParts.push("Sin marcaje de salida");
            } else if (segmentMark.exitTime) {
                incidentParts.push(`Salida ${segmentMark.exitTime}`);
            }

            if (incidentParts.length) {
                details.push(
                    `${segmentKey.replace(/_/g, " ")}: ${incidentParts.join("; ")}`
                );
            }
        });

    return details.join("\n");
}

function clockTimeColumnHTML({
    segment,
    side,
    label,
    currentSegmentMark
}) {
    const isEntry = side === "entry";
    const fallback = isEntry ? segment.start : segment.end;
    const storedValue = isEntry
        ? currentSegmentMark.entryTime
        : currentSegmentMark.exitTime;
    const missing = Boolean(
        isEntry
            ? currentSegmentMark.missingEntry
            : currentSegmentMark.missingExit
    );
    const time = timePartsFromMark(storedValue, fallback);

    return `
        <div class="clock-mark-column">
            <span>${label}</span>
            <div class="clock-time-inputs">
                <input
                    class="clock-time-number"
                    type="number"
                    min="0"
                    max="23"
                    step="1"
                    inputmode="numeric"
                    value="${time.hour}"
                    aria-label="${label} hora"
                    data-segment="${segment.id}"
                    data-side="${side}"
                    data-unit="hour"
                >
                <span>:</span>
                <input
                    class="clock-time-number"
                    type="number"
                    min="0"
                    max="59"
                    step="1"
                    inputmode="numeric"
                    value="${time.minute}"
                    aria-label="${label} minutos"
                    data-segment="${segment.id}"
                    data-side="${side}"
                    data-unit="minute"
                >
            </div>
            <button
                class="clock-missing-button ${missing ? "is-active" : ""}"
                type="button"
                data-missing-toggle
                data-segment="${segment.id}"
                data-side="${side}"
                data-active="${missing ? "true" : "false"}"
                aria-pressed="${missing ? "true" : "false"}"
            >
                Sin Marcaje <span>X</span>
            </button>
        </div>
    `;
}

function clockSegmentHTML(segment, currentMark) {
    const currentSegmentMark =
        getSegmentMark(currentMark, segment) || {};

    return `
        <section class="clock-mark-segment">
            <h3>${segmentTitle(segment)}</h3>
            <div class="clock-mark-row">
                ${clockTimeColumnHTML({
                    segment,
                    side: "entry",
                    label: "Entrada",
                    currentSegmentMark
                })}
                ${clockTimeColumnHTML({
                    segment,
                    side: "exit",
                    label: "Salida",
                    currentSegmentMark
                })}
            </div>
            <p class="clock-mark-segment__status" data-segment-status="${segment.id}" hidden></p>
        </section>
    `;
}

// Mensaje por segmento segun los tiempos actuales del dialogo: recuperacion de
// horas (atraso compensado con salida tardia, solo diurno/larga), horas extra
// generadas y/o reduccion de jornada. Se recalcula en vivo al editar.
function clockSegmentStatusLabel(date, segment, dialog) {
    const missingEntry = isMissingInDialog(dialog, segment, "entry");
    const missingExit = isMissingInDialog(dialog, segment, "exit");
    const segmentMark = {
        missingEntry,
        missingExit,
        entryTime: missingEntry
            ? ""
            : readTimeFromDialog(dialog, segment, "entry"),
        exitTime: missingExit
            ? ""
            : readTimeFromDialog(dialog, segment, "exit")
    };
    const classification = classifyClockMarkSegment(
        date,
        segment,
        segmentMark,
        { isBaseOrSwap: true }
    );
    const labels = [];

    if (classification.recoveryMinutes > 0) {
        labels.push("Recuperación de horas");
    }

    if (classification.netExtraMinutes > 0) {
        labels.push("Genera horas extra");
    }

    if (classification.isReduction) {
        labels.push("Reducción de jornada");
    }

    return labels.join(" · ");
}

function updateClockSegmentStatuses(dialog, segments, date) {
    segments.forEach(segment => {
        const element = dialog.querySelector(
            `[data-segment-status="${segment.id}"]`
        );

        if (!element) return;

        const label = clockSegmentStatusLabel(date, segment, dialog);

        element.textContent = label;
        element.hidden = !label;
    });
}

function setMissingState(dialog, button, active) {
    const segmentId = button.dataset.segment;
    const side = button.dataset.side;
    const inputs = dialog.querySelectorAll(
        `[data-segment="${segmentId}"][data-side="${side}"][data-unit]`
    );

    button.dataset.active = active ? "true" : "false";
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.classList.toggle("is-active", active);

    inputs.forEach(input => {
        input.disabled = active;
    });
}

function syncMissingButtons(dialog) {
    dialog
        .querySelectorAll("[data-missing-toggle]")
        .forEach(button => {
            setMissingState(
                dialog,
                button,
                button.dataset.active === "true"
            );
        });
}

function clockMarkDialogHTML({
    profile,
    state,
    segments,
    currentMark
}) {
    const split = segments.length > 1;
    const visibleState = getClockScheduleState(
        profile,
        currentMark?.keyDay || "",
        state
    );

    return `
        <form class="turn-change-dialog clock-mark-dialog ${split ? "clock-mark-dialog--split" : "clock-mark-dialog--simple"}" role="dialog" aria-modal="true">
            <strong>Marcajes reloj control</strong>
            <p>
                ${profile} | ${TURNO_LABEL[Number(visibleState) || 0] || "Turno"}
            </p>

            <div class="clock-mark-segments">
                ${segments
                    .map(segment =>
                        clockSegmentHTML(segment, currentMark)
                    )
                    .join("")}
            </div>

            <div class="turn-change-dialog__actions">
                <button class="primary-button" type="submit">
                    Guardar
                </button>
                <button class="secondary-button" type="button" data-action="cancel">
                    Cancelar
                </button>
            </div>
        </form>
    `;
}

function readTimeFromDialog(dialog, segment, side) {
    const hourInput = dialog.querySelector(
        `[data-segment="${segment.id}"][data-side="${side}"][data-unit="hour"]`
    );
    const minuteInput = dialog.querySelector(
        `[data-segment="${segment.id}"][data-side="${side}"][data-unit="minute"]`
    );
    const hour = Number(hourInput?.value);
    const minute = Number(minuteInput?.value);

    if (
        !Number.isInteger(hour) ||
        !Number.isInteger(minute) ||
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59
    ) {
        return null;
    }

    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function isMissingInDialog(dialog, segment, side) {
    return dialog.querySelector(
        `[data-missing-toggle][data-segment="${segment.id}"][data-side="${side}"]`
    )?.dataset.active === "true";
}

function turn24ExceedsMaximum(baseDate, segment, segmentMark) {
    if (segment.id !== "turno24") return false;

    const adjusted = adjustedSegment(
        baseDate,
        segment,
        segmentMark
    );

    if (!adjusted) return false;

    return adjusted.start < segment.start ||
        adjusted.end > segment.end;
}

function cleanEmptySegments(mark) {
    Object.keys(mark.segments).forEach(segmentId => {
        const segment = mark.segments[segmentId];

        if (
            !segment.entryTime &&
            !segment.exitTime &&
            !segment.missingEntry &&
            !segment.missingExit
        ) {
            delete mark.segments[segmentId];
        }
    });

    return mark;
}

export function openClockMarkDialog({
    profile,
    keyDay,
    date,
    state,
    holidays = {}
}) {
    return new Promise(resolve => {
        const scheduledState = getClockScheduleState(
            profile,
            keyDay,
            state
        );
        const segments = getScheduledSegmentsForProfile(
            profile,
            keyDay,
            date,
            scheduledState,
            holidays
        );

        if (!segments.length) {
            alert("No hay un turno valido para modificar marcajes en ese dia.");
            resolve(false);
            return;
        }

        const currentMark =
            getClockMark(profile, keyDay) || { segments: {} };
        const backdrop = document.createElement("div");

        backdrop.className = "turn-change-dialog-backdrop";
        backdrop.innerHTML = clockMarkDialogHTML({
            profile,
            state: scheduledState,
            segments,
            currentMark: {
                ...currentMark,
                keyDay
            }
        });

        const dialog = backdrop.querySelector("form");
        const close = value => {
            document.removeEventListener("keydown", onKeydown);
            backdrop.remove();
            resolve(value);
        };
        const onKeydown = event => {
            if (event.key === "Escape") {
                close(false);
            }
        };

        dialog
            .querySelectorAll("[data-missing-toggle]")
            .forEach(button => {
                button.onclick = () => {
                    setMissingState(
                        dialog,
                        button,
                        button.dataset.active !== "true"
                    );
                    updateClockSegmentStatuses(dialog, segments, date);
                };
            });

        dialog
            .querySelectorAll(".clock-time-number")
            .forEach(input => {
                input.addEventListener("input", () => {
                    updateClockSegmentStatuses(dialog, segments, date);
                });
            });

        dialog
            .querySelector("[data-action='cancel']")
            .onclick = () => close(false);

        dialog.onsubmit = event => {
            event.preventDefault();

            const marks = getClockMarks(profile);
            const mark = { segments: {} };
            const memoSegments = [];

            for (const segment of segments) {
                const segmentMark = {};
                const missingEntry =
                    isMissingInDialog(dialog, segment, "entry");
                const missingExit =
                    isMissingInDialog(dialog, segment, "exit");
                const entryTime =
                    readTimeFromDialog(dialog, segment, "entry");
                const exitTime =
                    readTimeFromDialog(dialog, segment, "exit");

                if (!missingEntry && !entryTime) {
                    alert(`Ingresa una hora de entrada valida para ${segment.label}.`);
                    return;
                }

                if (!missingExit && !exitTime) {
                    alert(`Ingresa una hora de salida valida para ${segment.label}.`);
                    return;
                }

                if (missingEntry) {
                    segmentMark.missingEntry = true;
                } else if (entryTime !== formatSegmentTime(segment.start)) {
                    segmentMark.entryTime = entryTime;
                }

                if (missingExit) {
                    segmentMark.missingExit = true;
                } else if (exitTime !== formatSegmentTime(segment.end)) {
                    segmentMark.exitTime = exitTime;
                }

                if (missingEntry || missingExit) {
                    memoSegments.push({
                        segmentId: segment.id,
                        segmentLabel: segmentTitle(segment),
                        missingEntry,
                        missingExit
                    });
                }

                if (turn24ExceedsMaximum(date, segment, segmentMark)) {
                    alert("Un turno 24 no puede superar 24 horas. No es posible adelantar la entrada ni retrasar la salida de este turno.");
                    return;
                }

                if (Object.keys(segmentMark).length) {
                    mark.segments[segment.id] = segmentMark;
                }
            }

            if (Object.keys(mark.segments).length) {
                mark.updatedAt = new Date().toISOString();
                marks[keyDay] = cleanEmptySegments(mark);
            } else {
                delete marks[keyDay];
            }

            saveClockMarks(profile, marks);
            memoSegments.forEach(segment => {
                createClockMemoTask({
                    profile,
                    dateKey: keyDay,
                    ...segment
                });
            });
            close(true);
        };

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) {
                close(false);
            }
        });

        document.addEventListener("keydown", onKeydown);
        document.body.appendChild(backdrop);
        syncMissingButtons(dialog);
        updateClockSegmentStatuses(dialog, segments, date);
        dialog.querySelector(".clock-time-number:not(:disabled)")?.focus();
    });
}
