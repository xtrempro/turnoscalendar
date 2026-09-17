import { isoFromKey, keyFromISO, keyToDate as parseKey } from "./dateUtils.js";
import { stripAccents } from "./stringUtils.js";
import { escapeHTML } from "./htmlUtils.js";
import {
    getBaseProfileData,
    getManualLeaveBalances,
    getProfileData,
    getRotativa,
    getReportSignatureConfig,
    getShiftAssigned,
    getValorHora,
    getCompensationProfileAt,
    isProfileActive
} from "./storage.js";
import { fetchHolidays } from "./holidays.js";
import {
    AVERAGE_DIURNAL_WORKDAY_HOURS,
    diurnoExtraDayHoursWithHolidays
} from "./overtimeRules.js";
import { calcExtraHours } from "./calculations.js";
import {
    attendanceCoverage,
    attendanceMarkedRuts,
    CONTINUES_MARK,
    getAttendanceCells,
    isAttendanceCovered,
    normalizeRut
} from "./attendanceImport.js";
import {
    getWorkerScheduleAt,
    isFreeScheduleAt,
    workerEntryTime,
    workerExitTime
} from "./workerSchedule.js";
import {
    delayMinutes,
    earlyEntryMinutes,
    entryDelayForDay,
    exitDriftMinutes,
    formatDelayCell,
    isMarkMissing,
    minutesFromTime,
    SHIFT_DRIFT_ALERT_MINUTES,
    shiftEndsNextMorning,
    shiftHasSeparateSegments,
    shiftHasTwoParts,
    shiftStartsInTheMorning
} from "./attendanceDelay.js";
import {
    calcularExtraDiurnoProgramadoDia,
    calcularHorasMesPerfil
} from "./hoursEngine.js";
import {
    aplicarCambiosTurno,
    getTurnoBase,
    getTurnoProgramado,
    includesWorkDay
} from "./turnEngine.js";
import {
    getTurnoExtraAgregado,
    getAbsenceType,
    esAusenciaInjustificada
} from "./rulesEngine.js";
import {
    calcHours,
    calcCarry,
    isBusinessDay
} from "./calculations.js";
import { TURNO, TURNO_LABEL } from "./constants.js";
import {
    codeToTurno,
    getReplacementLogForWorkerMonth,
    getReplacementOvertimeHours,
    getReplacementRecordHours,
    getReplacementsForWorkerShift,
    turnoReplacementLabel
} from "./replacements.js";
import {
    cambioEstaAnulado,
    cambiosDelMes,
    getSwapPerspective
} from "./swaps.js";
import { getShiftMoveMarkers } from "./shiftMoves.js";
import {
    formatContractDate,
    getContractsForProfile,
    isHonorariaContractType,
    isReplacementContractType,
    isReplacementProfile
} from "./contracts.js";
import { REPLACEMENT_ROTATION_MODE } from "./replacementRotation.js";
import {
    coverWindowFromRecord,
    coverWindowLabel
} from "./shiftCoverage.js";
import { getActiveWorkspace } from "./workspaces.js";
import { getJSON } from "./persistence.js";
import {
    getClockExtraHours,
    getClockDeficitHours,
    getClockNetExtraHours,
    getClockMarks,
    getClockScheduleState,
    getScheduledSegmentsForProfile,
    getWorkedIntervalsForState,
    hasModifiedEntryTime,
    hasModifiedExitTime
} from "./clockMarks.js";
import {
    classifyClockMarkSegment,
    findClockMarkEntry
} from "./clockMarkUtils.js";

const UNBACKED_OVERTIME_DETAIL = "Horas sin respaldo registrado";
const SHIFT_MOVE_REPORT_DETAIL = "Turno base modificado";

function key(year, month, day) {
    return `${year}-${month}-${day}`;
}

function formatDate(value) {
    const iso = String(value || "").includes("-")
        ? value
        : isoFromKey(value);
    const parts = String(iso || "").split("-");

    if (parts.length !== 3) return value || "";

    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function displayReportText(value) {
    return String(value ?? "")
        .replace(/\bSin informacion\b/g, "Sin informaci\u00f3n");
}

function formatHour(value) {
    const number = Math.round((Number(value) || 0) * 100) / 100;

    if (Number.isInteger(number)) {
        return String(number);
    }

    return String(number).replace(".", ",");
}

function formatMoney(value) {
    return new Intl.NumberFormat("es-CL", {
        maximumFractionDigits: 0
    }).format(Number(value) || 0);
}

function safeFileName(value) {
    return stripAccents(String(value || "reporte"))
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function reportSignatureFooterHTML() {
    const lines = getReportSignatureConfig()
        .lines
        .map(line => String(line || "").trim())
        .filter(Boolean);

    if (!lines.length) return "";

    return `
        <footer class="report-signature-footer">
            ${lines.map(line => `<div>${escapeHTML(line)}</div>`).join("")}
        </footer>
    `;
}

async function fetchReportHolidays(year) {
    const [previous, current, next] = await Promise.all([
        fetchHolidays(year - 1),
        fetchHolidays(year),
        fetchHolidays(year + 1)
    ]);

    return {
        ...previous,
        ...current,
        ...next
    };
}

function rotationLabel(type) {
    if (type === "3turno") return "3er Turno";
    if (type === "4turno") return "4° Turno";
    if (type === "diurno") return "Diurno";
    if (type === "libre") return "Libre";
    if (type === "reemplazo") return "Reemplazo";

    return "Sin rotativa";
}

function reportKind(profileName, monthDate = new Date()) {
    const type = getRotativa(profileName).type;

    if (isReplacementProfile(profileName)) return "replacement";
    if (getShiftAssigned(profileName, monthDate) || type === "diurno") {
        return "extra-only";
    }

    return "shift-base";
}

function contractKindForType(contractType) {
    if (isHonorariaContractType(contractType)) return "honorario";
    if (isReplacementContractType(contractType)) return "reemplazo";
    if (contractType) return "planta_contrata";

    return "";
}

function isNoAssignmentShiftProfile(
    profileName,
    monthDate = new Date()
) {
    const type = getRotativa(profileName).type;

    return (
        (type === "3turno" || type === "4turno") &&
        !getShiftAssigned(profileName, monthDate)
    );
}

export function isAssignedShiftReportProfile(
    profileName,
    monthDate = new Date()
) {
    const type = getRotativa(profileName).type;

    return (
        (type === "3turno" || type === "4turno") &&
        getShiftAssigned(profileName, monthDate)
    );
}

export function isReplacementReportProfile(profileName) {
    return isReplacementProfile(profileName);
}

export function isDiurnoReportProfile(profileName) {
    return (
        !isReplacementProfile(profileName) &&
        getRotativa(profileName).type === "diurno"
    );
}

function turnoLabel(turno) {
    return TURNO_LABEL[Number(turno) || TURNO.LIBRE] || "Libre";
}

function monthLabel(date) {
    return date.toLocaleString("es-CL", {
        month: "long",
        year: "numeric"
    });
}

function getSwapDetail(profileName, keyDay, swaps) {
    const iso = isoFromKey(keyDay);
    const details = [];

    swaps.forEach(swap => {
        if (cambioEstaAnulado(swap)) return;

        const perspective = getSwapPerspective(swap, profileName);

        if (!perspective) return;

        if (
            !perspective.changeSkipped &&
            perspective.changeDate === iso
        ) {
            details.push(`CCTT ${perspective.changeTurnLabel} con ${perspective.counterpart}`);
        }

        if (
            !perspective.returnSkipped &&
            perspective.returnDate === iso
        ) {
            details.push(`DDTT ${perspective.returnTurnLabel} con ${perspective.counterpart}`);
        }
    });

    return details.join(" | ");
}

function replacementDetail(profileName, keyDay) {
    const records = getReplacementsForWorkerShift(profileName, keyDay);

    if (!records.length) return "";

    return records.map(record => {
        if (record.replaced) {
            // Cubriendo solo un TRAMO del turno, el detalle tiene que decir
            // cual: dos personas pueden repartirse una misma Larga, y "reemplaza
            // a Juan" no distingue quien hizo cada mitad.
            const window = coverWindowLabel(coverWindowFromRecord(record));

            return window
                ? `Cubre el permiso del turno ${turnoReplacementLabel(codeToTurno(record.turno))} de ${record.replaced} ${window}`
                : `Reemplaza a ${record.replaced} por ${record.absenceType || "ausencia"}`;
        }

        return `Motivo horas extras: ${record.reason || record.absenceType || "sin detalle"}`;
    }).join(" | ");
}

function shiftMoveDetail(profileName, keyDay) {
    return getShiftMoveMarkers(profileName, keyDay).length
        ? SHIFT_MOVE_REPORT_DETAIL
        : "";
}

function contractDetail(contracts, iso) {
    const contract = contracts.find(item =>
        item.start <= iso &&
        item.end >= iso
    );

    return contract
        ? `Contrato vigente: reemplaza a ${contract.replaces}`
        : "";
}

function activeContractsForMonth(profileName, year, month) {
    const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const monthEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, "0")}`;

    return getContractsForProfile(profileName).filter(contract =>
        contract.start <= monthEnd &&
        contract.end >= monthStart
    );
}

function rowHours(date, turno, holidays) {
    const hours = calcHours(date, Number(turno) || 0, holidays) || {
        d: 0,
        n: 0
    };

    return {
        d: formatHour(hours.d),
        n: formatHour(hours.n)
    };
}

// Horas de un turno hecho como EXTRA. No se toca numberHours porque sus otros
// llamadores valoran el turno REALIZADO, que no es lo mismo.
function extraNumberHours(date, turno, holidays) {
    const hours = calcExtraHours(date, Number(turno) || 0, holidays) || {
        d: 0,
        n: 0
    };

    return {
        d: Number(hours.d) || 0,
        n: Number(hours.n) || 0
    };
}

function numberHours(date, turno, holidays) {
    const hours = calcHours(date, Number(turno) || 0, holidays) || {
        d: 0,
        n: 0
    };

    return {
        d: Number(hours.d) || 0,
        n: Number(hours.n) || 0
    };
}

function localDateAt(base, hour, minute = 0) {
    return new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate(),
        hour,
        minute,
        0,
        0
    );
}

function nextClockClassificationBoundary(cursor, end) {
    const nextDay = localDateAt(cursor, 24);
    const candidates = [nextDay, end];

    [7, 21].forEach(hour => {
        const boundary = localDateAt(cursor, hour);

        if (boundary > cursor) {
            candidates.push(boundary);
        }
    });

    return candidates
        .filter(candidate => candidate > cursor)
        .sort((a, b) => a - b)[0] || end;
}

function isClockNocturnalSegment(cursor, holidays) {
    const day = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate()
    );

    if (!isBusinessDay(day, holidays)) {
        return true;
    }

    const hour = cursor.getHours() + cursor.getMinutes() / 60;
    return hour < 7 || hour >= 21;
}

function addClassifiedClockInterval(target, interval, holidays) {
    let cursor = new Date(interval.start);
    const end = new Date(interval.end);

    while (cursor < end) {
        const boundary = nextClockClassificationBoundary(cursor, end);
        const amount = (boundary - cursor) / 36e5;

        if (isClockNocturnalSegment(cursor, holidays)) {
            target.n += amount;
        } else {
            target.d += amount;
        }

        cursor = boundary;
    }
}

function intersectIntervals(a, b) {
    const start = new Date(Math.max(a.start.getTime(), b.start.getTime()));
    const end = new Date(Math.min(a.end.getTime(), b.end.getTime()));

    return end > start ? { start, end } : null;
}

function workedScheduledExtraHours(
    profileName,
    keyDay,
    date,
    actual,
    extraState,
    holidays
) {
    const workedIntervals = getWorkedIntervalsForState(
        profileName,
        keyDay,
        date,
        actual,
        holidays
    );
    const extraIntervals = getScheduledSegmentsForProfile(
        profileName,
        keyDay,
        date,
        extraState,
        holidays
    ).map(segment => ({
        start: segment.start,
        end: segment.end
    }));
    const total = { d: 0, n: 0 };

    workedIntervals.forEach(worked => {
        extraIntervals.forEach(extra => {
            const overlap = intersectIntervals(worked, extra);

            if (overlap) {
                addClassifiedClockInterval(total, overlap, holidays);
            }
        });
    });

    return {
        d: Math.round(total.d * 2) / 2,
        n: Math.round(total.n * 2) / 2
    };
}

function addNumericHours(target, source) {
    target.d += Number(source?.d) || 0;
    target.n += Number(source?.n) || 0;
}

function hasPositiveHours(hours = {}) {
    return (
        (Number(hours.d) || 0) > 0 ||
        (Number(hours.n) || 0) > 0
    );
}

function readProfileMap(prefix, profileName) {
    return getJSON(`${prefix}_${profileName}`, {});
}

function getReportMaps(profileName) {
    return {
        admin: readProfileMap("admin", profileName),
        legal: readProfileMap("legal", profileName),
        comp: readProfileMap("comp", profileName),
        absences: readProfileMap("absences", profileName)
    };
}

function absenceTypeLabel(type) {
    if (type === "professional_license") return "LM Profesional";
    if (type === "union_leave") return "Permiso Gremial";
    if (type === "unpaid_leave") return "Permiso sin goce";
    if (type === "unjustified_absence") return "Ausencia injustificada";
    if (type === "license") return "Licencia M\u00e9dica";

    return type ? "Ausencia" : "";
}

function dayAbsenceDetail(keyDay, maps) {
    if (maps.admin[keyDay] === 1) {
        return {
            label: "P. Administrativo",
            full: true,
            category: "admin"
        };
    }

    if (maps.admin[keyDay] === "0.5M") {
        return {
            label: "1/2 ADM Ma\u00f1ana",
            full: false,
            category: "half_admin",
            workState: TURNO.MEDIA_TARDE
        };
    }

    if (maps.admin[keyDay] === "0.5T") {
        return {
            label: "1/2 ADM Tarde",
            full: false,
            category: "half_admin",
            workState: TURNO.MEDIA_MANANA
        };
    }

    if (maps.admin[keyDay] === 0.5) {
        return {
            label: "1/2 ADM",
            full: false,
            category: "half_admin",
            workState: TURNO.LIBRE
        };
    }

    if (maps.legal[keyDay]) {
        return {
            label: "F. Legal",
            full: true,
            category: "legal"
        };
    }

    if (maps.comp[keyDay]) {
        return {
            label: "F. Compensatorio",
            full: true,
            category: "comp"
        };
    }

    if (maps.absences[keyDay]) {
        const type = getAbsenceType(maps.absences[keyDay]);

        return {
            label: absenceTypeLabel(type),
            full: true,
            category: type,
            type
        };
    }

    return null;
}

function actualStateForReport(profileName, data, keyDay) {
    return aplicarCambiosTurno(
        profileName,
        keyDay,
        getTurnoProgramado(profileName, keyDay)
    );
}

function movedBaseStateForReport(profileName, keyDay, fallbackBase) {
    if (isReplacementProfile(profileName)) {
        return fallbackBase;
    }

    const markers = getShiftMoveMarkers(profileName, keyDay);

    if (!markers.length) {
        return fallbackBase;
    }

    const marker = markers[markers.length - 1];
    const move = marker.move || {};

    if (marker.role === "source") {
        return TURNO.LIBRE;
    }

    if (
        move.combinedInto24 &&
        move.combinedBaseComplement
    ) {
        return TURNO.TURNO24;
    }

    return Number(move.destinationTurn) || fallbackBase;
}

// Cruz para el dia que se trabajo sin registro de entrada. Es un caracter y
// no un icono para que sobreviva al escapado del texto de la celda.
const MISSING_MARK = "\u2715";
const MISSING_ENTRY_TITLE = "No existe registro de entrada";
const MISSING_EXIT_TITLE = "No existe registro de salida";

/**
 * Hora de ingreso real del dia, tomada del horario programado.
 *
 * No hay una tabla propia de horarios: se usa la que ya define los segmentos de
 * cada turno, que es la misma que alimenta el boton de marcajes del reloj
 * control. Asi el 24h entra a las 8, el 18 horas a las 14, el D+N a las 8, un
 * 1/2 ADM a las 12:30 o a las 14:00 segun la rotativa, y una Extension horaria
 * a la hora que el supervisor le haya configurado a mano. Una sola fuente: si
 * cambia el horario de un turno, el atraso cambia con el.
 */
function scheduledEntryFromShift(profileName, keyDay, date, state, holidays) {
    const [first] = scheduledSegments(profileName, keyDay, date, state, holidays);

    if (!first?.start) return "";

    // De lo mas especifico a lo mas general:
    //
    // 1. la hora que el supervisor fijo para ESE dia con el boton de marcajes;
    // 2. el horario propio del trabajador, si tiene uno acordado;
    // 3. la hora del turno.
    //
    // Sin el paso 1, a quien le autorizaron entrar a las 10:00 se le contarian
    // las dos horas anteriores como atraso. Sin el 2, quien entra siempre a
    // las 8:40 apareceria llegando tarde todos los dias.
    const authorized = findClockMarkEntry(
        getClockMarks(profileName)[keyDay],
        first
    )?.value?.entryTime;

    return authorized
        || workerEntryTime(getWorkerScheduleAt(profileName, date), state)
        || formatClockTime(first.start);
}

/**
 * Hora a la que le corresponde terminar, del mismo horario programado.
 */
function scheduledExitFromShift(profileName, keyDay, date, state, holidays) {
    const segments = scheduledSegments(
        profileName,
        keyDay,
        date,
        state,
        holidays
    );
    const last = segments[segments.length - 1];

    if (!last?.end) return "";

    // Misma precedencia que la entrada. El horario propio puede tener una hora
    // distinta los viernes, que es cuando la jornada diurna termina antes.
    const authorized = findClockMarkEntry(
        getClockMarks(profileName)[keyDay],
        last
    )?.value?.exitTime;

    return authorized
        || workerExitTime(getWorkerScheduleAt(profileName, date), state, date)
        || formatClockTime(last.end);
}

/**
 * Las horas de entrada y de salida de CADA tramo del turno.
 *
 * scheduledEntryFromShift y scheduledExitFromShift miran solo las dos puntas
 * -la entrada del primer tramo y la salida del ultimo-, que es todo lo que
 * necesita un turno corrido. Un D+N no lo es: son dos presencias con horas de
 * por medio, se entra a las 8, se sale a las 17 -16 los viernes-, se vuelve a
 * las 20 y se cierra a las 8 de la manana siguiente. Medir solo las puntas
 * deja la frontera del medio sin revisar, y ahi es donde se ve al que en vez
 * de irse a las 17 se quedo de largo.
 *
 * Misma precedencia que las puntas, tramo por tramo: la hora que el supervisor
 * autorizo para ESE tramo, el horario propio del trabajador para ese tramo -su
 * clave es el id del tramo- y, si no hay ninguna, la hora del turno, que ya
 * trae el viernes mas corto.
 */
function scheduledBoundsFromShift(profileName, keyDay, date, state, holidays) {
    const marks = getClockMarks(profileName)[keyDay];
    const own = getWorkerScheduleAt(profileName, date);
    const viernes = date instanceof Date && date.getDay() === 5;

    return scheduledSegments(profileName, keyDay, date, state, holidays)
        .map(segment => {
            const authorized = findClockMarkEntry(marks, segment)?.value;
            const propio = own?.[segment.id];

            return {
                id: segment.id,
                label: segment.label,
                start: authorized?.entryTime
                    || propio?.entry
                    || formatClockTime(segment.start),
                end: authorized?.exitTime
                    || (viernes && propio?.exitFriday)
                    || propio?.exit
                    || formatClockTime(segment.end)
            };
        });
}

function scheduledSegments(profileName, keyDay, date, state, holidays) {
    return getScheduledSegmentsForProfile(
        profileName,
        keyDay,
        date,
        getClockScheduleState(profileName, keyDay, state),
        holidays
    );
}

function formatClockTime(date) {
    return `${String(date.getHours()).padStart(2, "0")}:`
        + `${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Comienzo del dia de hoy.
 *
 * Sirve para no marcar como "falta el registro" un dia que todavia no ocurre:
 * el reporte del mes en curso saldria lleno de cruces de manana en adelante.
 */
function startOfToday() {
    const now = new Date();

    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Asterisco de la salida traida desde el dia siguiente, para que se note que
// esa hora no se marco en la fecha de la fila.
const MOVED_EXIT_MARK = "*";
const MOVED_EXIT_TITLE = "Marcado el";
const ALL_MARKS_TITLE = "Marcas del turno:";

// Dia sin turno: no habia nada que marcar.
const IDLE_DAY_MARK = "-";

// El reloj registra lo que el trabajador aprieta, y a veces aprieta el boton
// equivocado. La marca vale igual -lo importante es que marco-, pero queda
// senalada para que se note que el registro no calza con lo que hizo.
const INCIDENT_MARK = "⚠";
const ENTRY_INCIDENT_TITLE = "Incidencia: marco salida en vez de entrada";
const EXIT_INCIDENT_TITLE = "Incidencia: marco entrada en vez de salida";
const EARLY_EXIT_TITLE = "Incidencia: salio antes de las";
const LATE_EXTRA_TITLE = "Incidencia: llego despues de las";
const EARLY_ENTRY_TITLE = "Incidencia: llego antes de las";
const LATE_EXIT_TITLE = "Incidencia: salio despues de las";

// Hay mas marcas de las que se ven. El numero es cuantas quedan escondidas:
// sin el, el aviso obliga a abrir el hover para saber si falta una o cuatro.
//
// Es un caracter y no un icono por lo mismo que la cruz: el texto de la celda
// se escapa y ademas se imprime.
const MORE_MARKS_MARK = "⋯";

/**
 * Clave del dia anterior, cruzando meses y anios.
 *
 * Hace falta para saber si anoche hubo un turno con noche: en ese caso la
 * primera salida de hoy es de ese turno y se muestra en SU fila, no en esta.
 */
/**
 * El dia siguiente, como fecha. Los horarios de turno se piden por fecha -el
 * viernes el diurno termina antes, y un feriado no tiene diurno-, asi que la
 * clave del dia siguiente no basta.
 */
function nextDayDate(date) {
    const next = new Date(date);

    next.setDate(next.getDate() + 1);

    return next;
}

function previousDayKey(keyDay) {
    const date = parseKey(keyDay);

    date.setDate(date.getDate() - 1);

    return key(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );
}

/**
 * Celdas de marcaje del reporte: Entrada, Salida y Atrasos.
 *
 * Van juntas a proposito. El atraso se mide contra el turno BASE con cambios ya
 * aplicados, que es lo que hace que un turno cambiado se mida en la fecha a la
 * que se movio y que un turno extra no genere atraso aunque se llegue tarde.
 */
/**
 * Los datos del dia que necesita el marcaje.
 *
 * Vive aparte porque lo usan los tres constructores de filas y ademas el
 * resumen de incidencias del inicio. Tenerlo repetido seria tener cuatro
 * criterios que se van separando de a poco.
 */
/**
 * Momento en que TERMINA el turno de ese dia, o null si no tiene hora conocida.
 * La noche y el 24 cierran a la manana siguiente.
 */
function shiftEndInstant(date, scheduledExit, workedShift) {
    const minutes = minutesFromTime(scheduledExit);

    if (minutes === null) return null;

    const end = new Date(date);

    if (shiftEndsNextMorning(workedShift)) {
        end.setDate(end.getDate() + 1);
    }

    end.setHours(0, minutes, 0, 0);

    return end;
}

/**
 * .Habia terminado este turno cuando se subio la ultima planilla?
 *
 * El corte no es "hoy": es la hora en que se cargo el ultimo archivo del reloj.
 * Lo que ocurrio despues no esta en ninguna planilla todavia, asi que contarlo
 * como marca que falta seria inventar una falta que solo dice que el archivo
 * no se ha subido. Si pasan cinco dias sin cargar nada, esos cinco dias no
 * generan faltas; se juzgan cuando llegue la planilla que los cubre.
 *
 * Sin momento guardado -planillas subidas antes de que se registrara- se cae al
 * criterio anterior: el dia que ya termino.
 */
function shiftEndedByLastImport(date, scheduledExit, workedShift, coverage, today) {
    const importedAt = coverage?.at ? new Date(coverage.at) : null;

    if (!importedAt || Number.isNaN(importedAt.getTime())) {
        return date < today;
    }

    const end = shiftEndInstant(date, scheduledExit, workedShift);

    // Sin hora de salida conocida se juzga el dia entero: cuenta si la carga
    // fue despues de ese dia.
    return end ? end <= importedAt : date < importedAt;
}

function attendanceDay(profileName, keyDay, date, holidays, data, day) {
    const scheduledExit = scheduledExitFromShift(
        profileName, keyDay, date, day.workedShift, holidays
    );

    return {
        baseShift: day.baseShift,
        extraShift: day.extraShift,
        workedShift: day.workedShift,
        absent: day.absent,
        // Un dia solo "ya paso" para el marcaje si el turno habia terminado
        // cuando se subio la ultima planilla, y ademas ese dia esta dentro del
        // periodo que ella cubre. Sin las dos cosas, la falta de una marca no
        // dice nada del trabajador: dice que el archivo todavia no esta.
        hasPassed: shiftEndedByLastImport(
            date, scheduledExit, day.workedShift, day.coverage, day.today
        ) && isAttendanceCovered(isoFromKey(keyDay), day.coverage),
        scheduledEntry: scheduledEntryFromShift(
            profileName, keyDay, date, day.workedShift, holidays
        ),
        baseScheduledEntry: scheduledEntryFromShift(
            profileName, keyDay, date, day.baseShift, holidays
        ),
        scheduledExit,
        scheduledBounds: scheduledBoundsFromShift(
            profileName, keyDay, date, day.workedShift, holidays
        ),
        exitMoved: hasModifiedExitTime(profileName, keyDay),
        entryMoved: hasModifiedEntryTime(profileName, keyDay),
        nextEntryMoved: hasModifiedEntryTime(profileName, nextDayKey(keyDay)),
        nextWorkedShift: actualStateForReport(
            profileName, data, nextDayKey(keyDay)
        ),
        // A que hora empieza el turno de MAÑANA. Sirve para saber hasta cuando
        // una marca del dia siguiente puede seguir siendo el cierre de este
        // turno: quien se queda de mas cierra pasado el mediodia, y sin esta
        // hora esa marca se quedaba alla desordenando el dia entero.
        nextScheduledEntry: scheduledEntryFromShift(
            profileName,
            nextDayKey(keyDay),
            nextDayDate(date),
            actualStateForReport(profileName, data, nextDayKey(keyDay)),
            holidays
        ),
        previousWorkedShift: actualStateForReport(
            profileName, data, previousDayKey(keyDay)
        ),
        // HORARIO LIBRE: no se le exige entrar ni salir a una hora determinada,
        // sino cumplir las horas de su jornada. Viaja con el dia porque el
        // acuerdo es por periodos: el mes pasado pudo no tenerlo.
        freeSchedule: isFreeScheduleAt(profileName, date),
        // Las horas que ese dia le exigen: 9 de lunes a jueves y 8 los viernes.
        // Un sabado, un domingo o un feriado dan 0 y por eso no se juzga.
        requiredMinutes: Math.round(
            diurnoExtraDayHoursWithHolidays(date, holidays) * 60
        )
    };
}

/**
 * Cuanto se corrio cada frontera del turno respecto de su hora.
 *
 * Un turno corrido tiene dos: cuando empieza y cuando termina. Un D+N tiene
 * cuatro, porque son dos presencias, y la del medio -irse a las 17 y volver a
 * las 20- es la que se escapaba: midiendo solo la entrada del primer tramo y
 * la salida del ultimo, quien en vez de irse a las 17:00 se quedaba de largo
 * hasta las 20:00 se veia igual que quien cumplio.
 *
 * Los tramos de la fila y los tramos programados solo se emparejan cuando son
 * la misma cantidad. Cuando no lo son, lo que se mide es la envolvente -la
 * entrada del primero contra la hora de ingreso y la salida del ultimo contra
 * la de termino-, que es justamente lo correcto para un turno continuo: un 24
 * es Larga + Noche pero el trabajador nunca se va, asi que marcar el traspaso
 * de las 20:00 no crea una frontera que haya que cumplir.
 *
 * @returns {Array<{start: string, end: string, early: number,
 *                  exit: number|null}>}
 */
function shiftBoundaryDrifts(cells, day) {
    const tramos = cells.segments || [];
    const bounds = day.scheduledBounds || [];
    const porTramo = bounds.length > 1 && bounds.length === tramos.length;
    const ultimo = tramos.length - 1;
    const cierraDeManana = shiftEndsNextMorning(day.workedShift);

    return tramos.map((tramo, indice) => {
        const start = porTramo ? bounds[indice].start : day.scheduledEntry;
        const end = porTramo ? bounds[indice].end : day.scheduledExit;
        // Solo el ULTIMO tramo puede cerrar a la manana siguiente. El diurno de
        // un D+N termina a las 17 del mismo dia, y darlo por nocturno le
        // sumaria un dia entero a la diferencia.
        const endsNextMorning = cierraDeManana && indice === ultimo;

        // La entrada de un tramo que no es el primero solo cuenta como
        // frontera propia cuando los tramos estan emparejados: en un turno
        // corrido no hay nada que marcar al pasar de un tramo al otro.
        const mideEntrada = indice === 0 || porTramo;
        const mideSalida = indice === ultimo || porTramo;

        return {
            start,
            end,
            // Emparejado significa que este tramo es una presencia propia, con
            // sus dos marcas obligatorias. En un turno corrido no lo es.
            paired: porTramo,
            label: porTramo ? bounds[indice].label : "",
            early: mideEntrada
                ? earlyEntryMinutes(tramo.entry?.time, start)
                : 0,
            late: mideEntrada
                ? delayMinutes(tramo.entry?.time, start)
                : 0,
            exit: mideSalida
                ? exitDriftMinutes(tramo.exit?.time, end, {
                    markIsNextDay: Boolean(tramo.exit?.iso),
                    endsNextMorning
                })
                : null
        };
    });
}

/**
 * Los tramos a los que les falta una marca, por su nombre.
 *
 * Un turno programado en dos tramos exige sus CUATRO marcas: en un D+N el
 * trabajador se va a las 17 y vuelve a las 20, asi que la salida del diurno y
 * la entrada de la noche son tan obligatorias como las de las puntas.
 *
 * Sin esta cuenta por tramo el dia se daba por completo: la celda de salida
 * traia la marca del OTRO tramo -"\n08:03"- y como no estaba vacia, no habia
 * cruz ni incidencia. Quien entraba a las 8 y no volvia a marcar hasta las 8
 * de la manana siguiente se veia igual que quien cumplio los dos tramos.
 *
 * Devuelve una entrada por tramo de la fila, en su mismo orden, para que la
 * cruz se pueda poner en la linea que le toca.
 *
 * @returns {Array<{label: string, entry: boolean, exit: boolean}>}
 */
function missingSegmentMarks(cells, drifts, esperado) {
    return (cells.segments || []).map((tramo, indice) => {
        const frontera = drifts[indice];
        const exigible = esperado && Boolean(frontera?.paired);

        return {
            label: frontera?.label || "",
            // Una flecha no es una marca que falte: el turno viene de largo -o
            // sigue de largo- y no habia nada que marcar.
            entry: exigible && !tramo.entry && !tramo.entryArrow,
            exit: exigible && !tramo.exit && !tramo.exitArrow
        };
    });
}

/**
 * Los nombres de los tramos a los que les falta esa marca.
 */
function missingPartLabels(missingParts, side) {
    return (missingParts || [])
        .filter(parte => parte[side])
        .map(parte => parte.label)
        .filter(Boolean);
}

// Cuanto se puede desviar un dia de horario libre antes de avisar.
//
// Es mas estrecho que el margen de una frontera de turno (60 min) porque aqui
// no se juzga una hora de llegada sino el total del dia, que el trabajador
// controla entero: media hora de mas ya son horas trabajadas sin registrar, y
// media hora de menos es jornada que quedo debiendo.
const FREE_SCHEDULE_ALERT_MINUTES = 30;

/**
 * Minutos efectivamente trabajados segun las marcas, sumando los tramos.
 *
 * Devuelve null cuando no se puede medir -falta una marca, o el tramo viene de
 * largo del dia anterior-, porque un dia a medio marcar no dice nada sobre las
 * horas cumplidas y ya tiene su propia incidencia.
 */
function workedMinutesFromCells(cells) {
    const segments = cells?.segments || [];

    if (!segments.length) return null;

    let total = 0;

    for (const segment of segments) {
        if (segment.entryArrow || segment.exitArrow) return null;

        const entry = minutesFromTime(segment.entry?.time);
        const exit = minutesFromTime(segment.exit?.time);

        if (entry === null || exit === null || exit <= entry) return null;

        total += exit - entry;
    }

    return total;
}

/**
 * Que paso con el marcaje de ese dia, antes de decidir como se dibuja.
 *
 * Es la unica fuente: de aqui salen tanto las celdas del reporte como el
 * resumen de incidencias del inicio, asi que los dos cuentan lo mismo.
 */
function attendanceDayFacts(profile, iso, day) {
    // Un dia con turno y sin ausencia que lo cubra: es lo unico que se puede
    // medir contra un horario.
    //
    // Sin turno no hay hora contra la cual comparar, y lo que se marque en un
    // dia libre es markOnFreeDay y no otra cosa. Con licencia, permiso o
    // feriado no se esperaba que marcara, que es la misma regla que ya aplica
    // el atraso.
    const medible = Number(day.workedShift) > TURNO.LIBRE && !day.absent;
    const cells = getAttendanceCells(profile.rut, iso, {
        endsNextMorning: shiftEndsNextMorning(day.workedShift),
        previousEndsNextMorning: shiftEndsNextMorning(day.previousWorkedShift),
        startsInTheMorning: shiftStartsInTheMorning(day.workedShift),
        nextStartsInTheMorning: shiftStartsInTheMorning(day.nextWorkedShift),
        splitSegments: shiftHasSeparateSegments(day.workedShift),
        // .Tiene este dia mas de un tramo de trabajo seguido?
        //
        // Lo es por composicion -un 24 es Larga + Noche, un 18 horas es
        // Extension + Noche- y tambien cuando el supervisor le corrio la hora
        // con el boton de marcajes. Una Noche a la que se le autorizo entrar a
        // las 12:00 son ocho horas de extension pegadas a la noche: el
        // trabajador no se va en el medio, pero el momento en que pasa de una
        // a la otra existe y lo puede marcar.
        //
        // En los tres casos vale lo mismo: si marco ese traspaso, la fila lo
        // muestra en sus dos lineas, y si no, no falta nada. Marcarlo no es una
        // anomalia (ver handoverInside en getAttendanceCells).
        canSplitOnMarks: shiftHasTwoParts(day.workedShift) ||
            day.entryMoved || day.exitMoved,
        entryMoved: day.entryMoved,
        nextEntryMoved: day.nextEntryMoved,
        workedShift: day.workedShift,
        scheduledEntry: day.scheduledEntry,
        nextScheduledEntry: day.nextScheduledEntry
    });
    // Con HORARIO LIBRE no hay hora de entrada ni de salida que cumplir, asi
    // que no se le miden atrasos ni fronteras corridas. Lo que se le exige son
    // las horas del dia, y eso se mide mas abajo.
    const libre = Boolean(medible && day.freeSchedule);
    const rawDelay = entryDelayForDay({
        baseShift: day.baseShift,
        extraShift: day.extraShift,
        workedShift: day.workedShift,
        // La entrada resuelta, no la que dice la etiqueta del reloj: si marco
        // "salida" al llegar, su atraso se mide igual.
        entryTime: cells.entrada,
        // La hora de ingreso sale del horario programado del turno base, no de
        // una tabla aparte: asi un 1/2 ADM se mide contra las 12:30 o las
        // 14:00 segun la rotativa, y un 24h contra las 8.
        entryOverride: day.baseScheduledEntry,
        absent: day.absent,
        // Una flecha no es una marca que falte: el turno viene de largo y no
        // habia nada que marcar, asi que ni cruz ni atraso.
        hasPassed: day.hasPassed && !cells.entryArrow
    });
    // El horario es libre; marcar no. La marca que falta se sigue exigiendo
    // igual, porque sin ella no hay forma de saber cuantas horas cumplio.
    const delay = libre ? { ...rawDelay, minutes: 0 } : rawDelay;

    // Contra que horas se miden las marcas. Las dos puntas se miden sobre las
    // MARCAS del tramo y no sobre el texto de la celda: un turno de dos tramos
    // apila dos horas en la misma celda ("20:00\n08:11") y leer eso como una
    // hora sola devuelve la de arriba, que en la salida es justamente la que
    // no cierra el turno.
    const drifts = shiftBoundaryDrifts(cells, day);
    // De todas las fronteras se reporta la PEOR de cada tipo, que es la que el
    // supervisor tiene que ir a mirar. Las demas van en el hover de la celda.
    const worstEarly = drifts
        .filter(item => item.early > 0)
        .sort((a, b) => b.early - a.early)[0] || null;
    const worstLate = drifts
        .filter(item => item.late > 0)
        .sort((a, b) => b.late - a.late)[0] || null;
    const worstExit = drifts
        .filter(item => item.exit !== null)
        .sort((a, b) => Math.abs(b.exit) - Math.abs(a.exit))[0] || null;
    const exitDrift = medible && !day.exitMoved && !libre
        ? worstExit?.exit ?? null
        : null;
    const earlyMinutes = medible && !day.entryMoved && !libre
        ? worstEarly?.early || 0
        : 0;
    // Las marcas que le faltan a un tramo del medio. Se exigen con el mismo
    // criterio que las de las puntas: solo cuando el turno ya habia terminado
    // al subir la ultima planilla, o serian faltas que solo dicen que el
    // archivo todavia no esta.
    const missingParts = missingSegmentMarks(
        cells,
        drifts,
        medible && day.hasPassed
    );
    // Lo unico que se le exige a un dia de horario libre: las horas. Se compara
    // lo trabajado con lo que ese dia pide -9 de lunes a jueves, 8 los viernes-
    // y solo cuando el dia ya termino y esta marcado entero.
    const freeWorkedMinutes = libre && day.hasPassed
        ? workedMinutesFromCells(cells)
        : null;
    const freeBalance = freeWorkedMinutes !== null && day.requiredMinutes > 0
        ? freeWorkedMinutes - day.requiredMinutes
        : null;

    return {
        cells,
        delay,
        // Las horas contra las que se midio la peor frontera de cada tipo, no
        // las del turno entero: en un D+N la salida que se paso de hora puede
        // ser la de las 17:00 del diurno y no la de las 08:00 de la noche. El
        // detalle de la incidencia las nombra, para que el supervisor sepa
        // contra que se esta comparando sin abrir el reporte.
        scheduledEntry: worstEarly?.start || day.scheduledEntry,
        lateScheduledEntry: worstLate?.start || day.scheduledEntry,
        scheduledExit: worstExit?.end || day.scheduledExit,
        earlyMinutes,
        exitDrift,
        // La salida lleva la misma cruz que la entrada cuando falta su registro.
        //
        // Estas dos siguen siendo de la CELDA entera -no hay ninguna hora- y
        // por eso la cruz se come la celda completa. Lo que le falta a un solo
        // tramo va en missingParts, que pone la cruz en su linea y deja la
        // hora del otro tramo a la vista.
        missingExit: isMarkMissing({
            mark: cells.salida,
            workedShift: day.workedShift,
            absent: day.absent,
            hasPassed: day.hasPassed && !cells.exitArrow
        }),
        missingParts,
        // Llego tarde a un turno que no es su base. No se mide atraso -los
        // atrasos son de la rotativa propia-, pero queda senalado.
        //
        // Se mira frontera por frontera y no la primera hora de la celda: en
        // un D+N con base Diurno, la noche es la parte que no es suya, y
        // volver a las 22:10 en vez de a las 20:00 es justamente lo que hay
        // que ver. Con una sola hora por celda esa llegada no se comparaba
        // contra nada.
        lateOnExtra: Boolean(!libre && !delay.minutes && worstLate),
        // Llego MUCHO antes de su hora. El caso que esto busca es el turno
        // extra o la extension horaria que se acordo de palabra y nadie
        // alcanzo a registrar: sin este aviso esas horas no aparecen en el
        // reporte y no se pagan.
        //
        // Se mide contra el turno REALIZADO, no contra el base, y por eso se
        // apaga sola en cuanto el supervisor registra lo que faltaba: al
        // pasar la Noche a 24h la hora de ingreso pasa a ser las 8 y la
        // diferencia desaparece. La otra forma de apagarla es autorizarle la
        // entrada a mano, que es justamente decir "asi estaba acordado".
        earlyEntry: earlyMinutes >= SHIFT_DRIFT_ALERT_MINUTES,
        // Se fue antes de la hora que le tocaba. No cuenta si el supervisor le
        // autorizo salir antes: esa reduccion esta permitida y ya queda
        // registrada como tal.
        earlyExit: Boolean(exitDrift !== null && exitDrift < 0),
        // Y se quedo mucho despues. Es el espejo de la entrada anticipada, con
        // el mismo margen: nadie marca su salida al minuto exacto, pero una
        // hora de mas ya es un tramo trabajado que no esta registrado.
        lateExit: Boolean(
            exitDrift !== null && exitDrift >= SHIFT_DRIFT_ALERT_MINUTES
        ),
        // Marcas que el turno no explica. La entrada anticipada y la salida
        // posterior cubren las dos puntas; esto cubre lo que pasa en medio,
        // que es como se ve un 24 anotado como Noche: la fila muestra las dos
        // puntas correctas y el traspaso de las 20:00 queda sin justificar.
        unexplainedMarks: Boolean(medible && cells.unexplained?.length),
        // Marco en un dia sin turno: vino a trabajar y su turno no quedo
        // registrado. Un permiso o una licencia no cuentan -el dia tiene su
        // motivo y el reporte lo dice-, solo el dia que figura Libre.
        markOnFreeDay: Boolean(
            (cells.entrada || cells.salida) &&
            Number(day.workedShift) <= TURNO.LIBRE &&
            !day.absent
        ),
        // Las dos del horario libre. Cuanto trabajo y cuanto le pedian van
        // tambien en los hechos, porque el detalle de la incidencia los nombra:
        // el supervisor decide mirando las cifras, no la etiqueta.
        freeSchedule: libre,
        freeWorkedMinutes,
        freeRequiredMinutes: libre ? day.requiredMinutes : 0,
        freeBalance,
        // Se quedo de mas. No es una falta: es un tramo trabajado que nadie
        // registro, y por eso el aviso pide ir a ver si corresponde pagarlo.
        freeLateExit: Boolean(
            freeBalance !== null && freeBalance >= FREE_SCHEDULE_ALERT_MINUTES
        ),
        // Y el espejo: se fue habiendo cumplido menos horas de las que el dia
        // le pedia. Con el mismo margen, porque nadie marca al minuto exacto.
        freeShortDay: Boolean(
            freeBalance !== null && freeBalance <= -FREE_SCHEDULE_ALERT_MINUTES
        )
    };
}

/**
 * Los tipos de incidencia de marcaje, en el orden en que se muestran.
 */
export const ATTENDANCE_INCIDENT_KINDS = [
    { key: "atraso", label: "Atrasos" },
    { key: "missingEntry", label: "Sin marcaje entrada" },
    { key: "missingExit", label: "Sin marcaje salida" },
    { key: "lateOnExtra", label: "Entrada tardía" },
    { key: "earlyEntry", label: "Entrada anticipada" },
    { key: "earlyExit", label: "Salida temprana" },
    { key: "lateExit", label: "Salida posterior" },
    { key: "freeLateExit", label: "Salida tardía" },
    { key: "freeShortDay", label: "Jornada incompleta" },
    { key: "unexplainedMarks", label: "Marcas sin justificar" },
    { key: "markOnFreeDay", label: "Marcaje en día libre" }
];

/**
 * Una diferencia de minutos dicha como se dice en voz alta.
 *
 * "719 min" no se lee: hay que dividirlo mentalmente para darse cuenta de que
 * son casi doce horas, que es justo el dato que hace saltar al supervisor.
 */
function formatDrift(minutes) {
    const total = Math.abs(Math.round(Number(minutes) || 0));
    const hours = Math.floor(total / 60);
    const rest = total % 60;

    if (!hours) return `${rest} min`;

    return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/**
 * Los momentos que el turno no explica, dichos por su hora.
 */
function unexplainedTimes(cells) {
    return (cells.unexplained || [])
        .map(event => event[0]?.time)
        .filter(Boolean)
        .join(", ");
}

function pushIncidents(events, profile, iso, facts) {
    const base = { profile: profile.name, iso };
    const { cells, delay } = facts;

    if (delay.minutes) {
        events.push({
            ...base,
            kind: "atraso",
            detail: `${delay.minutes} min (entró ${cells.entrada}, `
                + `le tocaba ${delay.scheduled})`
        });
    }

    // La cruz del reporte y la cuenta del inicio son lo mismo: si la fila
    // muestra una cruz, aqui hay un evento. Por eso al tramo del medio que se
    // quedo sin marca le corresponde su incidencia, y lleva el nombre del
    // tramo para que se sepa cual de las dos presencias del dia falta.
    const faltaEntrada = missingPartLabels(facts.missingParts, "entry");
    const faltaSalida = missingPartLabels(facts.missingParts, "exit");

    if (delay.missingEntry || faltaEntrada.length) {
        events.push({
            ...base,
            kind: "missingEntry",
            detail: faltaEntrada.length
                ? `No hay marca de entrada de ${faltaEntrada.join(" ni de ")}`
                : "No hay marca de entrada"
        });
    }

    if (facts.missingExit || faltaSalida.length) {
        events.push({
            ...base,
            kind: "missingExit",
            detail: faltaSalida.length
                ? `No hay marca de salida de ${faltaSalida.join(" ni de ")}`
                : "No hay marca de salida"
        });
    }

    if (facts.lateOnExtra) {
        events.push({
            ...base,
            kind: "lateOnExtra",
            detail: `Entró ${cells.entrada} en un turno que no es su base`
        });
    }

    if (facts.earlyEntry) {
        events.push({
            ...base,
            kind: "earlyEntry",
            detail: `Entró ${cells.entrada}, `
                + `${formatDrift(facts.earlyMinutes)} antes de las `
                + `${facts.scheduledEntry}. Revisar si falta registrarle un `
                + "turno extra o una extensión horaria"
        });
    }

    if (facts.earlyExit) {
        events.push({
            ...base,
            kind: "earlyExit",
            detail: `Salió ${cells.salida}`
        });
    }

    if (facts.lateExit) {
        events.push({
            ...base,
            kind: "lateExit",
            detail: `Salió ${cells.salida}, `
                + `${formatDrift(facts.exitDrift)} después de las `
                + `${facts.scheduledExit}. Revisar si falta registrarle un `
                + "turno extra o una extensión horaria"
        });
    }

    if (facts.freeLateExit || facts.freeShortDay) {
        const cumplio = formatDrift(facts.freeWorkedMinutes);
        const pedian = formatDrift(facts.freeRequiredMinutes);
        const diferencia = formatDrift(facts.freeBalance);

        events.push({
            ...base,
            kind: facts.freeLateExit ? "freeLateExit" : "freeShortDay",
            detail: facts.freeLateExit
                ? `Salió ${cells.salida}: trabajó ${cumplio} y su jornada es `
                    + `de ${pedian}, ${diferencia} de más. Revisar si `
                    + "corresponde modificar el marcaje y agregarle horas extras"
                : `Trabajó ${cumplio} y su jornada es de ${pedian}: quedó `
                    + `debiendo ${diferencia}`
        });
    }

    if (facts.unexplainedMarks) {
        const horas = unexplainedTimes(cells);

        events.push({
            ...base,
            kind: "unexplainedMarks",
            detail: `Marcó ${horas} y el turno registrado no lo explica. `
                + "Revisar si el turno realizado fue otro"
        });
    }

    if (facts.markOnFreeDay) {
        events.push({
            ...base,
            kind: "markOnFreeDay",
            detail: [
                cells.entrada ? `Entró ${cells.entrada}` : "",
                cells.salida
                    ? `${cells.entrada ? "salió" : "Salió"} ${cells.salida}`
                    : ""
            ].filter(Boolean).join(" y ") + " en un día sin turno registrado"
        });
    }
}

/**
 * Lector de marcas de un trabajador, dia por dia.
 *
 * Devuelve lo MISMO que muestran las celdas del reporte -con la salida del
 * turno de noche ya traida a su dia y las cruces de lo que falta-, para que el
 * trabajador vea en su aplicacion exactamente lo que ve el supervisor.
 *
 * Es una fabrica y no una funcion suelta porque lo caro se calcula una vez por
 * trabajador: sus datos, sus ausencias y el periodo que cubre el reloj.
 *
 * @param {{name: string, rut: string}} profile
 * @returns {(keyDay: string, date: Date, holidays: object) => object|null}
 */
export function createAttendanceMarksReader(profile) {
    const profileName = profile?.name;

    if (!profileName) return () => null;

    // Quien NUNCA tuvo una marca cargada no tiene faltas que mostrar: el reloj
    // no lo registra, y el periodo que cubre la planilla es de la unidad
    // entera, asi que sin esto su mes entero le aparece como marcaje faltante.
    // Es la misma regla del resumen de incidencias del supervisor.
    if (!attendanceMarkedRuts().has(normalizeRut(profile.rut))) {
        return () => null;
    }

    const data = getProfileData(profileName);
    const maps = getReportMaps(profileName);
    const coverage = attendanceCoverage();
    const today = startOfToday();

    return (keyDay, date, holidays) => {
        const iso = isoFromKey(keyDay);
        const baseWithSwaps = baseWithSwapsForReport(profileName, keyDay);
        const actual = actualStateForReport(profileName, data, keyDay);
        const absence = dayAbsenceDetail(keyDay, maps);
        const facts = attendanceDayFacts(
            profile,
            iso,
            attendanceDay(profileName, keyDay, date, holidays, data, {
                baseShift: baseWithSwaps,
                extraShift: getTurnoExtraAgregado(baseWithSwaps, actual),
                workedShift: actual,
                absent: Boolean(absence?.full),
                today,
                coverage
            })
        );
        const { cells, delay } = facts;
        // Las incidencias del dia salen del MISMO pushIncidents que alimenta el
        // recuadro del supervisor: si alla se cuenta una, aca viaja, y no hay
        // dos criterios que se vayan separando.
        const eventos = [];

        pushIncidents(eventos, profile, iso, facts);

        // La cruz de la marca que falta ya viaja en sus propios campos y la
        // aplicacion tiene su tarjeta para ella, asi que no se manda dos veces.
        const kinds = eventos
            .map(evento => evento.kind)
            .filter(kind => kind !== "missingEntry" && kind !== "missingExit");
        // La entrada y la salida que faltan se dicen del dia entero, aunque lo
        // que falte sea de un solo tramo: en el telefono la celda es una sola
        // y lo que importa es que ese turno tiene marcaje sin registrar.
        const missingEntry = delay.missingEntry ||
            missingPartLabels(facts.missingParts, "entry").length > 0;
        const missingExit = facts.missingExit ||
            missingPartLabels(facts.missingParts, "exit").length > 0;

        // Sin nada que decir no se manda nada: la proyeccion viaja a cada
        // telefono y un campo vacio por dia la engorda sin aportar.
        if (
            !cells.entrada && !cells.salida &&
            !missingEntry && !missingExit && !kinds.length
        ) {
            return null;
        }

        return {
            entrada: cells.entrada,
            salida: cells.salida,
            ...(missingEntry ? { missingEntry: true } : {}),
            ...(missingExit ? { missingExit: true } : {}),
            // Solo las claves, no el texto del supervisor: su detalle esta
            // escrito para quien tiene que ir a corregir el registro ("Revisar
            // si falta registrarle un turno extra"), no para el trabajador.
            ...(kinds.length ? { incidents: kinds } : {})
        };
    };
}

/**
 * Incidencias de marcaje de un mes, para los trabajadores de la unidad.
 *
 * Sale de los MISMOS hechos que dibujan las celdas del reporte
 * (attendanceDayFacts), asi que el resumen del inicio y el reporte no pueden
 * decir cosas distintas.
 *
 * Quedan fuera dos grupos, porque lo que se cuente de ellos no seria una
 * incidencia de nadie: los perfiles desactivados -ya no trabajan en la unidad-
 * y los que nunca tuvieron una marca cargada (ver attendanceMarkedRuts).
 *
 * @param {Array<{name: string, rut: string, active?: boolean}>} profiles
 * @param {Date} monthDate
 * @returns {Promise<{events: Array<Object>, totals: Object}>}
 */
export async function buildAttendanceIncidents(profiles, monthDate) {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchReportHolidays(year);
    const today = startOfToday();
    const coverage = attendanceCoverage();
    const marcados = attendanceMarkedRuts();
    const events = [];

    (profiles || []).forEach(profile => {
        const profileName = profile?.name;

        if (!profileName) return;
        if (!isProfileActive(profile)) return;
        if (!marcados.has(normalizeRut(profile.rut))) return;

        const data = getProfileData(profileName);
        const maps = getReportMaps(profileName);

        for (let day = 1; day <= days; day++) {
            const keyDay = key(year, month, day);
            const date = parseKey(keyDay);
            const baseWithSwaps = baseWithSwapsForReport(profileName, keyDay);
            const actual = actualStateForReport(profileName, data, keyDay);
            const absence = dayAbsenceDetail(keyDay, maps);

            pushIncidents(
                events,
                profile,
                isoFromKey(keyDay),
                attendanceDayFacts(
                    profile,
                    isoFromKey(keyDay),
                    attendanceDay(profileName, keyDay, date, holidays, data, {
                        baseShift: baseWithSwaps,
                        extraShift: getTurnoExtraAgregado(baseWithSwaps, actual),
                        workedShift: actual,
                        absent: Boolean(absence?.full),
                        today,
                        coverage
                    })
                )
            );
        }
    });

    const totals = {};

    ATTENDANCE_INCIDENT_KINDS.forEach(kind => {
        totals[kind.key] = 0;
    });
    events.forEach(event => {
        totals[event.kind] += 1;
    });

    return { events, totals };
}

/**
 * La fila del reporte del dia de la incidencia, con su vispera y su dia
 * siguiente.
 *
 * Una incidencia casi nunca se entiende sola: la entrada que falta un lunes se
 * explica con el turno de noche del domingo, y la salida que falta hoy aparece
 * en la fila de manana. Por eso el detalle del inicio abre las tres filas.
 *
 * Sale de attendanceReportCells, o sea de los mismos hechos que el reporte:
 * lo que se lee aqui es lo que se lee alla, sin una segunda version.
 *
 * @param {{name: string, rut: string}} profile
 * @param {string} iso dia de la incidencia
 * @returns {Promise<Array<{
 *   iso: string, turnoBase: string, turnoRealizado: string,
 *   atraso: string, entrada: string, salida: string
 * }>>}
 */
/**
 * Todas las marcas del reloj de UN dia, tal como las reparte el reporte.
 *
 * Es lo que necesita la casilla del calendario para mostrar el marcaje al
 * abrirla, y sale de los MISMOS hechos que dibujan la fila del reporte: la
 * salida de una noche viene ya traida al dia en que se entro, y las que la fila
 * resume -el traspaso de un 24, el doble apreton al salir- vienen tambien, que
 * es justamente lo que no se alcanza a ver en la tabla.
 *
 * @param {{name: string, rut: string}} profile
 * @param {string} keyDay clave interna del dia
 * @returns {Promise<{turno: string, entrada: string, salida: string,
 *   marks: Array<{time: string, type: string, iso: string}>}|null>}
 */
export async function attendanceDayMarks(profile, keyDay) {
    const profileName = profile?.name;

    if (!profileName || !keyDay) return null;

    const date = parseKey(keyDay);

    if (Number.isNaN(date.getTime())) return null;

    const holidays = await fetchReportHolidays(date.getFullYear());
    const data = getProfileData(profileName);
    const maps = getReportMaps(profileName);
    const baseWithSwaps = baseWithSwapsForReport(profileName, keyDay);
    const actual = actualStateForReport(profileName, data, keyDay);
    const absence = dayAbsenceDetail(keyDay, maps);
    const { cells } = attendanceDayFacts(
        profile,
        isoFromKey(keyDay),
        attendanceDay(profileName, keyDay, date, holidays, data, {
            baseShift: baseWithSwaps,
            extraShift: getTurnoExtraAgregado(baseWithSwaps, actual),
            workedShift: actual,
            absent: Boolean(absence?.full),
            today: startOfToday(),
            coverage: attendanceCoverage()
        })
    );

    if (!cells.marks?.length) return null;

    return {
        turno: absence?.label || turnoLabel(actual),
        entrada: cells.entrada,
        salida: cells.salida,
        marks: cells.marks.map(mark => ({
            time: mark.time,
            type: mark.type === "out" ? "out" : "in",
            iso: mark.iso || ""
        }))
    };
}

export async function attendanceIncidentContext(profile, iso) {
    const profileName = profile?.name;
    const centro = iso ? keyFromISO(iso) : "";

    if (!profileName || !centro) return [];

    // fetchReportHolidays ya trae el anio anterior y el siguiente, asi que la
    // vispera de un 1 de enero y el dia despues de un 31 de diciembre quedan
    // cubiertos con una sola consulta.
    const holidays = await fetchReportHolidays(parseKey(centro).getFullYear());
    const data = getProfileData(profileName);
    const maps = getReportMaps(profileName);
    const today = startOfToday();
    const coverage = attendanceCoverage();

    return [previousDayKey(centro), centro, nextDayKey(centro)].map(keyDay => {
        const date = parseKey(keyDay);
        const dayIso = isoFromKey(keyDay);
        const baseWithSwaps = baseWithSwapsForReport(profileName, keyDay);
        const actual = actualStateForReport(profileName, data, keyDay);
        const absence = dayAbsenceDetail(keyDay, maps);
        const cells = attendanceReportCells(
            profile,
            dayIso,
            attendanceDay(profileName, keyDay, date, holidays, data, {
                baseShift: baseWithSwaps,
                extraShift: getTurnoExtraAgregado(baseWithSwaps, actual),
                workedShift: actual,
                absent: Boolean(absence?.full),
                today,
                coverage
            })
        );

        return {
            iso: dayIso,
            turnoBase: turnoLabel(baseWithSwaps),
            turnoRealizado: absence?.label || turnoLabel(actual),
            atraso: cells.atrasos,
            entrada: cells.entrada,
            salida: cells.salida
        };
    });
}

function attendanceReportCells(profile, iso, day) {
    const {
        cells,
        delay,
        missingExit,
        lateOnExtra,
        earlyEntry,
        earlyExit,
        lateExit,
        missingParts,
        // Las horas de la frontera que se paso, que en un D+N no tienen por
        // que ser las del turno entero.
        scheduledEntry,
        lateScheduledEntry,
        scheduledExit
    } = attendanceDayFacts(profile, iso, day);
    const meta = {};
    // Los tramos a los que les falta SU marca. La celda entera no esta vacia
    // -el otro tramo si marco-, asi que no lleva la cruz completa: lleva la
    // cruz en su linea y el aviso en ambar, que es lo que se usa para una
    // celda que tiene horas validas y ademas un problema.
    const faltaEntrada = missingPartLabels(missingParts, "entry");
    const faltaSalida = missingPartLabels(missingParts, "exit");
    // De un turno solo se muestran la primera entrada y la ultima salida. Las
    // intermedias -salir y volver a entrar entre los dos tramos de un 24- no
    // se pierden: van al hover, para no llenar la tabla.
    const hidden = hiddenMarksTitle(cells);
    // El aviso de que hay mas marcas va SIEMPRE en la misma celda -la entrada,
    // que es donde empieza a leerse la fila- y no en la que le quede mas
    // cerca: un simbolo que aparece tan pronto a la izquierda como a la
    // derecha no se aprende nunca. Si la entrada es la cruz de "no hay
    // registro" no hay hora a la que pegarselo y pasa a la salida.
    const moreMarks = hidden ? moreMarksMark(cells) : "";
    const moreMarksOnEntry = Boolean(moreMarks) && !delay.missingEntry;
    const incidenciaEntrada =
        cells.entryIncident || lateOnExtra || earlyEntry || faltaEntrada.length;

    if (delay.missingEntry) {
        meta.entrada = {
            title: MISSING_ENTRY_TITLE,
            className: "report-cell--missing-entry"
        };
    } else if (incidenciaEntrada || hidden) {
        meta.entrada = {
            title: [
                faltaEntrada.length
                    ? `${MISSING_ENTRY_TITLE} de ${faltaEntrada.join(" ni de ")}`
                    : "",
                cells.entryIncident ? ENTRY_INCIDENT_TITLE : "",
                lateOnExtra
                    ? `${LATE_EXTRA_TITLE} ${lateScheduledEntry}`
                    : "",
                earlyEntry
                    ? `${EARLY_ENTRY_TITLE} ${scheduledEntry}`
                    : "",
                hidden
            ].filter(Boolean).join("\n"),
            className: incidenciaEntrada
                ? "report-cell--mark-incident"
                : "report-cell--more-marks"
        };
    }
    if (missingExit) {
        meta.salida = {
            title: MISSING_EXIT_TITLE,
            className: "report-cell--missing-entry"
        };
    } else if (
        cells.exitIncident || earlyExit || lateExit || faltaSalida.length ||
        cells.salidaFrom || hidden
    ) {
        const lines = [
            faltaSalida.length
                ? `${MISSING_EXIT_TITLE} de ${faltaSalida.join(" ni de ")}`
                : "",
            cells.exitIncident ? EXIT_INCIDENT_TITLE : "",
            earlyExit
                ? `${EARLY_EXIT_TITLE} ${scheduledExit}`
                : "",
            lateExit
                ? `${LATE_EXIT_TITLE} ${scheduledExit}`
                : "",
            cells.salidaFrom
                ? `${MOVED_EXIT_TITLE} ${formatDate(cells.salidaFrom)}`
                : "",
            hidden
        ].filter(Boolean);

        meta.salida = {
            title: lines.join("\n"),
            className: cells.exitIncident || earlyExit || lateExit ||
                faltaSalida.length
                ? "report-cell--mark-incident"
                : cells.salidaFrom
                    ? "report-cell--moved-exit"
                    : "report-cell--more-marks"
        };
    }

    // Un D+N ocupa dos lineas -diurno arriba, noche abajo- porque son dos
    // presencias con horas de por medio, no un turno corrido.
    if (cells.multiline) {
        ["entrada", "salida"].forEach(side => {
            meta[side] = {
                title: meta[side]?.title || "",
                className: [meta[side]?.className, "report-cell--stacked"]
                    .filter(Boolean)
                    .join(" ")
            };
        });
    }

    // Un dia sin turno no espera marcas. El guion lo dice; una celda en blanco
    // se lee como un dato que falta.
    const idle = Number(day.workedShift) <= TURNO.LIBRE;

    if (idle) {
        ["entrada", "salida"].forEach(side => {
            meta[side] = {
                title: meta[side]?.title || "",
                className: [meta[side]?.className, "report-cell--idle-day"]
                    .filter(Boolean)
                    .join(" ")
            };
        });
    }

    return {
        entrada: delay.missingEntry
            ? MISSING_MARK
            : orDash(
                withMarks(
                    markCellText(cells, "entry", missingParts),
                    (lateOnExtra || earlyEntry) &&
                        !cells.entryIncident && INCIDENT_MARK,
                    moreMarksOnEntry && moreMarks
                ),
                idle
            ),
        salida: missingExit
            ? MISSING_MARK
            : orDash(
                withMarks(
                    markCellText(cells, "exit", missingParts),
                    // El simbolo de "se corrio la salida" va una sola vez, al
                    // final: si ya lo puso la etiqueta equivocada, no se
                    // repite. Irse antes y quedarse de mas se excluyen.
                    (earlyExit || lateExit) &&
                        !cells.exitIncident && INCIDENT_MARK,
                    !moreMarksOnEntry && moreMarks
                ),
                idle
            ),
        atrasos: formatDelayCell(delay.minutes),
        ...(Object.keys(meta).length ? { __cells: meta } : {})
    };
}

/**
 * Guion para el dia sin turno que ademas no tiene marcas. Si llego a marcar
 * -por error o por un turno que no quedo registrado- se muestra lo que marco.
 */
function orDash(text, idle) {
    return !text && idle ? IDLE_DAY_MARK : text;
}

/**
 * Texto de la celda de marcaje: una linea por tramo del turno, con los
 * simbolos que le correspondan a cada una.
 */
function markCellText(cells, side, missingParts = []) {
    return (cells.segments || [])
        .map((segment, indice) => {
            if (segment[`${side}Arrow`]) return CONTINUES_MARK;

            const mark = segment[side];

            // La cruz del tramo al que le falta SU marca. Va en la linea del
            // tramo y no en la celda entera, para no tapar la hora del otro:
            // en un D+N sin las marcas del medio la salida se lee "✕ / 08:03",
            // que dice las dos cosas.
            if (!mark) return missingParts[indice]?.[side] ? MISSING_MARK : "";

            return withMarks(
                mark.time,
                segment[`${side}Incident`] && INCIDENT_MARK,
                mark.iso && MOVED_EXIT_MARK
            );
        })
        .join("\n")
        .replace(/\n+$/, "");
}

/**
 * Hora con los simbolos que le correspondan, si es que hay hora.
 */
function withMarks(time, ...symbols) {
    const shown = symbols.filter(Boolean);

    if (!time || !shown.length) return time;

    // Espacio duro: las celdas de marcaje se dibujan con `pre-line` para poder
    // apilar dos marcas, y con un espacio normal el asterisco de la salida
    // traida del dia siguiente se iba solo a la linea de abajo.
    return `${time}\u00a0${shown.join("\u00a0")}`;
}

/**
 * Detalle de todas las marcas del turno, para el hover, cuando la fila esconde
 * alguna. Si lo que se muestra ya es todo lo que hay, devuelve "".
 */
function hiddenMarksTitle(cells) {
    const marks = cells.marks || [];
    // Lo que se ve son las marcas de CADA tramo, no las celdas: un 24 con el
    // traspaso marcado muestra cuatro horas en dos lineas, y ahi no hay nada
    // escondido que avisar.
    const shown = (cells.segments || []).reduce(
        (total, segment) =>
            total + (segment.entry ? 1 : 0) + (segment.exit ? 1 : 0),
        0
    );

    if (marks.length <= shown) return "";

    // Cada marca dicha entera y bien separada de la siguiente: en un 24 son
    // cuatro, y de corrido no se distingue cual cierra un tramo y cual abre
    // el otro.
    return `${ALL_MARKS_TITLE} ${marks
        .map(mark =>
            `${mark.type === "out" ? "Salida" : "Entrada"} a las ${mark.time}`)
        .join("  |  ")}`;
}

/**
 * El aviso de que la celda esconde marcas, con cuantas esconde.
 *
 * El texto completo estaba desde siempre en el hover, pero la celda no lo
 * decia por ninguna parte: la unica senal era el cursor de ayuda, que hay que
 * ir a buscar sabiendo de antemano que hay algo. Un 24 anotado como Noche se
 * veia como una Noche impecable.
 */
function moreMarksMark(cells) {
    const shown = (cells.segments || []).reduce(
        (total, segment) =>
            total + (segment.entry ? 1 : 0) + (segment.exit ? 1 : 0),
        0
    );
    const escondidas = (cells.marks || []).length - shown;

    return escondidas > 0 ? `${MORE_MARKS_MARK}${escondidas}` : "";
}

function baseWithSwapsForReport(profileName, keyDay) {
    const baseWithSwaps = aplicarCambiosTurno(
        profileName,
        keyDay,
        getTurnoBase(profileName, keyDay),
        { includeReplacements: false }
    );

    return movedBaseStateForReport(
        profileName,
        keyDay,
        baseWithSwaps
    );
}

function reportCarryForBoundary(profileName, date, data, maps, holidays) {
    const keyDay = key(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );

    if (!includesWorkDay(profileName, keyDay)) {
        return { d: 0, n: 0 };
    }

    const absence = dayAbsenceDetail(keyDay, maps);

    if (absence?.full || esAusenciaInjustificada(maps.absences[keyDay])) {
        return { d: 0, n: 0 };
    }

    const state = actualStateForReport(profileName, data, keyDay);

    if (
        state !== TURNO.NOCHE &&
        state !== TURNO.TURNO24 &&
        state !== TURNO.DIURNO_NOCHE
    ) {
        return { d: 0, n: 0 };
    }

    const next = new Date(date);
    next.setDate(date.getDate() + 1);

    return isBusinessDay(next, holidays)
        ? { d: 1, n: 7 }
        : { d: 0, n: 8 };
}

function reportCarryIn(profileName, year, month, data, holidays) {
    const previous = new Date(year, month, 0);
    const maps = getReportMaps(profileName);

    return reportCarryForBoundary(
        profileName,
        previous,
        data,
        maps,
        holidays
    );
}

function reportCarryOut(profileName, year, month, days, data, holidays) {
    const maps = getReportMaps(profileName);

    return reportCarryForBoundary(
        profileName,
        new Date(year, month, days),
        data,
        maps,
        holidays
    );
}

function hasNightCarryComponent(turno) {
    const state = Number(turno) || TURNO.LIBRE;

    return (
        state === TURNO.NOCHE ||
        state === TURNO.TURNO24 ||
        state === TURNO.DIURNO_NOCHE ||
        state === TURNO.TURNO18
    );
}

function assignedExtraStateForDay(profileName, keyDay, data) {
    const baseWithSwaps =
        baseWithSwapsForReport(profileName, keyDay);
    const actual = actualStateForReport(profileName, data, keyDay);

    return getTurnoExtraAgregado(baseWithSwaps, actual);
}

function assignedCarryForBoundary(profileName, date, data, maps, holidays) {
    const keyDay = key(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );
    const absence = dayAbsenceDetail(keyDay, maps);

    if (absence?.full || esAusenciaInjustificada(maps.absences[keyDay])) {
        return { d: 0, n: 0 };
    }

    const extraState = assignedExtraStateForDay(
        profileName,
        keyDay,
        data
    );

    if (!hasNightCarryComponent(extraState)) {
        return { d: 0, n: 0 };
    }

    return calcCarry(date, extraState, holidays);
}

function assignedCarryIn(profileName, year, month, holidays) {
    const previous = new Date(year, month, 0);
    const previousData = getProfileData(profileName);
    const maps = getReportMaps(profileName);

    return assignedCarryForBoundary(
        profileName,
        previous,
        previousData,
        maps,
        holidays
    );
}

function assignedCarryOut(profileName, year, month, days, data, holidays) {
    const maps = getReportMaps(profileName);

    return assignedCarryForBoundary(
        profileName,
        new Date(year, month, days),
        data,
        maps,
        holidays
    );
}

function clockMarkSummary(profileName, keyDay, date, state, holidays = {}) {
    const mark = getClockMarks(profileName)[keyDay];

    if (!mark?.segments) return "";

    // Segmentos programados del turno (mismo criterio que el motor de horas), para
    // clasificar cada marca en recuperacion / reduccion segun sus tiempos reales.
    const scheduledState = getClockScheduleState(profileName, keyDay, state);
    const segments = getScheduledSegmentsForProfile(
        profileName,
        keyDay,
        date,
        scheduledState,
        holidays
    );
    const items = segments
        .map(segment => {
            const segmentMark = findClockMarkEntry(mark, segment)?.value;

            if (!segmentMark) return "";

            const details = [];

            if (segmentMark.missingEntry) details.push("Sin entrada");
            if (segmentMark.missingExit) details.push("Sin salida");
            if (segmentMark.entryTime) {
                details.push(`Entrada a las ${segmentMark.entryTime}`);
            }
            if (segmentMark.exitTime) {
                details.push(`Salida a las ${segmentMark.exitTime}`);
            }

            // Recuperacion (atraso compensado con salida tardia, solo diurno/larga)
            // o reduccion de jornada (atraso/salida temprana sin recuperar).
            const classification = classifyClockMarkSegment(
                date,
                segment,
                segmentMark,
                { isBaseOrSwap: true }
            );

            if (classification.recoveryMinutes > 0) {
                details.push("Recuperación de horas");
            } else if (classification.isReduction) {
                details.push("Reducción de jornada");
            }

            const note = segmentMark.adminNote || segmentMark.comments;

            return [
                details.join(" / "),
                note
            ].filter(Boolean).join(": ");
        })
        .filter(Boolean);

    return items.join(" | ");
}

// Detalle ESTRUCTURADO de las modificaciones de marcaje de un dia para la PWA del
// trabajador: entrada/salida, recuperacion, horas extra netas, reduccion y flags.
// Misma clasificacion que el supervisor (classifyClockMarkSegment) y el texto del
// reporte (clockMarkSummary). Devuelve null si ese dia no tiene marca registrada.
function clockMarkDayDetail(profileName, keyDay, date, state, holidays = {}) {
    const mark = getClockMarks(profileName)[keyDay];

    if (!mark?.segments) return null;

    const scheduledState = getClockScheduleState(profileName, keyDay, state);
    const segments = getScheduledSegmentsForProfile(
        profileName,
        keyDay,
        date,
        scheduledState,
        holidays
    );

    let recoveryMinutes = 0;
    let netExtraMinutes = 0;
    let uncoveredMinutes = 0;
    let missingEntry = false;
    let missingExit = false;
    let entryTime = "";
    let exitTime = "";
    let hasMark = false;
    const badges = [];
    const addBadge = value => {
        if (!badges.includes(value)) badges.push(value);
    };

    for (const segment of segments) {
        const segmentMark = findClockMarkEntry(mark, segment)?.value;

        if (!segmentMark) continue;

        hasMark = true;

        if (segmentMark.missingEntry) {
            missingEntry = true;
            addBadge("Sin entrada");
        }
        if (segmentMark.missingExit) {
            missingExit = true;
            addBadge("Sin salida");
        }
        if (segmentMark.entryTime && !entryTime) entryTime = segmentMark.entryTime;
        if (segmentMark.exitTime) exitTime = segmentMark.exitTime;

        const c = classifyClockMarkSegment(date, segment, segmentMark, {
            isBaseOrSwap: true
        });

        recoveryMinutes += c.recoveryMinutes;
        netExtraMinutes += c.netExtraMinutes;
        uncoveredMinutes += c.uncoveredMinutes;

        if (c.recoveryMinutes > 0) addBadge("Recuperación de horas");
        if (c.netExtraMinutes > 0) addBadge("Genera horas extra");
        if (c.isReduction) addBadge("Reducción de jornada");
    }

    if (!hasMark) return null;

    return {
        entryTime,
        exitTime,
        recoveryMinutes: Math.round(recoveryMinutes),
        netExtraMinutes: Math.round(netExtraMinutes),
        uncoveredMinutes: Math.round(uncoveredMinutes),
        missingEntry,
        missingExit,
        badges
    };
}

// Mapa { [iso]: detalle } de las modificaciones de marcaje del trabajador en los
// ultimos meses (mas el mes en curso). Se publica en la proyeccion para que la PWA
// muestre un badge por dia en el calendario y la seccion en "Marcajes".
export async function buildWorkerClockMarkModifications(profile) {
    if (!profile?.name) return {};

    const profileName = profile.name;
    const data = getProfileData(profileName);
    // Recorremos SOLO los dias que tienen marca registrada (getClockMarks), no un
    // rango fijo de meses relativo a "hoy". Las marcas se guardan unicamente en los
    // dias que el supervisor modifica (son dispersas), asi que esto es barato y —lo
    // importante— cubre CUALQUIER mes, incluidos los futuros relativos a hoy (una
    // modificacion cargada en un mes por venir, p. ej. en un escenario de prueba o
    // planificacion). El rango fijo hacia atras dejaba esos dias sin detalle aunque
    // el color por-dia ya apareciera desde la proyeccion de `days`.
    const marks = getClockMarks(profileName);
    const holidaysByYear = new Map();
    const result = {};

    for (const keyDay of Object.keys(marks)) {
        const date = parseKey(keyDay);

        if (Number.isNaN(date.getTime())) continue;

        const year = date.getFullYear();

        if (!holidaysByYear.has(year)) {
            holidaysByYear.set(year, await fetchHolidays(year));
        }

        const actual = actualStateForReport(profileName, data, keyDay);
        const detail = clockMarkDayDetail(
            profileName,
            keyDay,
            date,
            actual,
            holidaysByYear.get(year)
        );

        if (detail) result[isoFromKey(keyDay)] = detail;
    }

    return result;
}

function buildNoAssignmentDayRows(
    profile,
    year,
    month,
    days,
    holidays,
    options = {}
) {
    const profileName = profile.name;
    const data = getProfileData(profileName);
    const baseData = getBaseProfileData(profileName);
    const swaps = cambiosDelMes(year, month);
    const contracts = activeContractsForMonth(
        profileName,
        year,
        month
    );
    const maps = getReportMaps(profileName);
    const today = startOfToday();
    const coverage = attendanceCoverage();
    const rows = [];
    const rawTotals = { d: 0, n: 0 };

    for (let day = 1; day <= days; day++) {
        const keyDay = key(year, month, day);
        const iso = isoFromKey(keyDay);
        const date = parseKey(keyDay);
        const rawBase = getTurnoBase(profileName, keyDay);
        const contractIsRequired =
            options.contractOnly === true;
        const hasActiveContract =
            !contractIsRequired ||
            includesWorkDay(profileName, keyDay);

        if (!hasActiveContract) {
            rows.push({
                fecha: formatDate(iso),
                diaHabil: isBusinessDay(date, holidays) ? "S\u00ed" : "No",
                tipo: "Sin contrato",
                turnoBase: turnoLabel(rawBase),
                turnoConCambios: "-",
                turnoRealizado: "SIN CONTRATO",
                entrada: "",
                salida: "",
                atrasos: "",
                turnoExtra: "-",
                horasDiurnas: "-",
                horasNocturnas: "-",
                respaldo: "SIN CONTRATO"
            });
            continue;
        }

        const baseWithSwaps =
            baseWithSwapsForReport(profileName, keyDay);
        const actual = actualStateForReport(profileName, data, keyDay);
        const absence = dayAbsenceDetail(keyDay, maps);
        const workState = absence?.full
            ? TURNO.LIBRE
            : absence?.workState || actual;
        const baseHours = numberHours(date, workState, holidays);
        // Ajuste por incidencias de marcaje de reloj: se suma lo trabajado fuera
        // del turno (ingreso anticipado, salida tardia) y se descuenta lo
        // programado no trabajado (atraso, salida anticipada). Sin marca el
        // ajuste es 0 (turno realizado normal).
        const clockExtraHours = absence?.full
            ? { d: 0, n: 0 }
            : getClockExtraHours(profileName, keyDay, date, actual, holidays);
        const clockDeficitHours = absence?.full
            ? { d: 0, n: 0 }
            : getClockDeficitHours(profileName, keyDay, date, actual, holidays);
        const hours = {
            d: Math.max(0, baseHours.d + clockExtraHours.d - clockDeficitHours.d),
            n: Math.max(0, baseHours.n + clockExtraHours.n - clockDeficitHours.n)
        };
        const hasManualBase =
            Object.prototype.hasOwnProperty.call(baseData, keyDay) ||
            rawBase > TURNO.LIBRE;
        const swap = getSwapDetail(profileName, keyDay, swaps);
        const replacement = replacementDetail(profileName, keyDay);
        const shiftMove = shiftMoveDetail(profileName, keyDay);
        const contract = contractDetail(contracts, iso);
        const clock = clockMarkSummary(profileName, keyDay, date, actual, holidays);
        const details = [
            absence?.label,
            replacement,
            shiftMove,
            contract,
            swap,
            clock
        ].filter(Boolean).join(" | ");
        const extraState = getTurnoExtraAgregado(baseWithSwaps, actual);

        addNumericHours(rawTotals, hours);

        rows.push({
            fecha: formatDate(iso),
            diaHabil: isBusinessDay(date, holidays) ? "S\u00ed" : "No",
            tipo: shiftMove
                ? SHIFT_MOVE_REPORT_DETAIL
                : hasManualBase
                ? "Turno base"
                : "Turno registrado",
            turnoBase: turnoLabel(rawBase),
            turnoConCambios: turnoLabel(baseWithSwaps),
            turnoRealizado: absence?.label || turnoLabel(actual),
            ...attendanceReportCells(profile, iso, attendanceDay(profileName, keyDay, date, holidays, data, {
                baseShift: baseWithSwaps,
                extraShift: extraState,
                workedShift: actual,
                absent: Boolean(absence?.full),
                today,
                coverage
            })),
            turnoExtra: turnoLabel(extraState),
            horasDiurnas: formatHour(hours.d),
            horasNocturnas: formatHour(hours.n),
            respaldo: details || (
                Number(extraState) > TURNO.LIBRE
                    ? UNBACKED_OVERTIME_DETAIL
                    : ""
            )
        });
    }

    return {
        rows,
        rawTotals
    };
}

function formatExtraCell(value) {
    const number = Math.round((Number(value) || 0) * 100) / 100;

    return number ? formatHour(number) : "-";
}

function combineNumericHours(...sources) {
    return sources.reduce((total, source) => ({
        d: total.d + (Number(source?.d) || 0),
        n: total.n + (Number(source?.n) || 0)
    }), { d: 0, n: 0 });
}

function subtractNumericHours(base, subtraction) {
    return {
        d: (Number(base?.d) || 0) - (Number(subtraction?.d) || 0),
        n: (Number(base?.n) || 0) - (Number(subtraction?.n) || 0)
    };
}

function buildAssignedShiftDayRows(profile, year, month, days, holidays) {
    const profileName = profile.name;
    const isDiurno = isDiurnoReportProfile(profileName);
    const data = getProfileData(profileName);
    const swaps = cambiosDelMes(year, month);
    const contracts = activeContractsForMonth(
        profileName,
        year,
        month
    );
    const maps = getReportMaps(profileName);
    const today = startOfToday();
    const coverage = attendanceCoverage();
    const rows = [];
    const rawTotals = { d: 0, n: 0 };

    for (let day = 1; day <= days; day++) {
        const keyDay = key(year, month, day);
        const iso = isoFromKey(keyDay);
        const date = parseKey(keyDay);
        const rawBase = getTurnoBase(profileName, keyDay);
        const baseWithSwaps =
            baseWithSwapsForReport(profileName, keyDay);
        const actual = actualStateForReport(profileName, data, keyDay);
        const absence = dayAbsenceDetail(keyDay, maps);
        const extraState = absence?.full
            ? TURNO.LIBRE
            : getTurnoExtraAgregado(baseWithSwaps, actual);
        const shiftExtraHours = isDiurno
            ? calcularExtraDiurnoProgramadoDia(
                date,
                absence?.full ? TURNO.LIBRE : actual,
                holidays
            )
            : extraNumberHours(date, extraState, holidays);
        const clockExtraHours = absence?.full
            ? { d: 0, n: 0 }
            : getClockExtraHours(
                profileName,
                keyDay,
                date,
                actual,
                holidays
            );
        // Deficit por incidencia de marcaje (salida temprana / atraso): descuenta
        // lo programado no trabajado. Sin esto, un turno cubierto con salida
        // temprana mantenia las HH.EE del turno completo (p. ej. una Larga
        // cubierta con "Salida 15:00" mostraba 12 en vez de 7). Espeja el ajuste
        // de buildNoAssignmentDayRows y deja el reporte consistente con el motor.
        const clockDeficitHours = absence?.full
            ? { d: 0, n: 0 }
            : getClockDeficitHours(
                profileName,
                keyDay,
                date,
                actual,
                holidays
            );
        const grossExtraHours = combineNumericHours(
            shiftExtraHours,
            clockExtraHours
        );
        // SIN recorte a 0 por dia: el deficit de marcaje que un dia no alcanza
        // a absorber tiene que bajar el TOTAL del mes, igual que hace el motor
        // del timeline. Con el Math.max(0, ...) anterior, un turno base no
        // trabajado se perdia cuando ese dia no habia horas extra contra las
        // cuales restarlo (p. ej. una Noche completa no trabajada: solo se
        // descontaba lo que cabia en el excedente de ese dia y las horas
        // restantes desaparecian del reporte, dejandolo por encima del
        // timeline).
        const extraHours = {
            d: grossExtraHours.d - clockDeficitHours.d,
            n: grossExtraHours.n - clockDeficitHours.n
        };
        const swap = getSwapDetail(profileName, keyDay, swaps);
        const replacement = replacementDetail(profileName, keyDay);
        const shiftMove = shiftMoveDetail(profileName, keyDay);
        const contract = contractDetail(contracts, iso);
        const clock = clockMarkSummary(profileName, keyDay, date, actual, holidays);
        const details = [
            absence?.label,
            replacement,
            shiftMove,
            contract,
            swap,
            clock
        ].filter(Boolean).join(" | ");

        addNumericHours(rawTotals, extraHours);

        rows.push({
            fecha: formatDate(iso),
            diaHabil: isBusinessDay(date, holidays) ? "S\u00ed" : "No",
            turnoBase: turnoLabel(rawBase),
            turnoRealizado: absence?.label || turnoLabel(actual),
            ...attendanceReportCells(profile, iso, attendanceDay(profileName, keyDay, date, holidays, data, {
                baseShift: baseWithSwaps,
                extraShift: extraState,
                workedShift: actual,
                absent: Boolean(absence?.full),
                today,
                coverage
            })),
            hheeDiurnas: formatExtraCell(extraHours.d),
            hheeNocturnas: formatExtraCell(extraHours.n),
            respaldo: details || (
                hasPositiveHours(extraHours)
                    ? UNBACKED_OVERTIME_DETAIL
                    : ""
            )
        });
    }

    return {
        rows,
        rawTotals
    };
}

function buildDayRows(profile, year, month, days, holidays, kind) {
    const profileName = profile.name;
    const data = getProfileData(profileName);
    const baseData = getBaseProfileData(profileName);
    const maps = getReportMaps(profileName);
    const swaps = cambiosDelMes(year, month);
    const contracts = activeContractsForMonth(
        profileName,
        year,
        month
    );
    const today = startOfToday();
    const coverage = attendanceCoverage();
    const rows = [];

    for (let day = 1; day <= days; day++) {
        const keyDay = key(year, month, day);
        const iso = isoFromKey(keyDay);
        const date = parseKey(keyDay);
        const rawBase = getTurnoBase(profileName, keyDay);
        const baseWithSwaps =
            baseWithSwapsForReport(profileName, keyDay);
        const actual = actualStateForReport(
            profileName,
            data,
            keyDay
        );
        const extraState =
            getTurnoExtraAgregado(baseWithSwaps, actual);
        const hasManualBase =
            Object.prototype.hasOwnProperty.call(baseData, keyDay) ||
            rawBase > TURNO.LIBRE;
        const swap = getSwapDetail(profileName, keyDay, swaps);
        const replacement = replacementDetail(profileName, keyDay);
        const contract = contractDetail(contracts, iso);
        const details = [
            replacement,
            contract,
            swap
        ].filter(Boolean).join(" | ");
        // OJO: rowHours/formatHour devuelven STRINGS con coma decimal ("10,8").
        // La hora extra hay que SUMARLA en numerico (numberHours) y formatear
        // recien al final; sumar los strings concatenaba ("10" + 0 -> "100").
        const actualHoursNum = numberHours(date, actual, holidays);
        const scheduleExtraHoursNum = extraNumberHours(date, extraState, holidays);
        // Extension horaria por MODIFICACION DE MARCAJE: la hora extra NETA del
        // marcaje (excedente trabajado menos deficit; la parte recuperada no
        // cuenta) es una extension aunque el turno base no sea "extra". El motor
        // autoritativo ya la suma a las HH.EE del mes (getWorkedIntervalsForState);
        // sin esto quedaba contada en el total pero invisible en el detalle
        // "Turnos extra y extensiones horarias". Solo en el detalle de excedente
        // ("extra-only"): en "all"/"replacement" las horas ya son las realizadas.
        const isExtra = Number(extraState) > TURNO.LIBRE;
        const scheduledExtraWorkedHours =
            kind === "extra-only" && isExtra
                ? workedScheduledExtraHours(
                    profileName,
                    keyDay,
                    date,
                    actual,
                    extraState,
                    holidays
                )
                : scheduleExtraHoursNum;
        const clockExtraHours = kind === "extra-only"
            ? getClockNetExtraHours(profileName, keyDay, date, actual, holidays)
            : { d: 0, n: 0 };
        const scheduledExtraTotal =
            (Number(scheduleExtraHoursNum.d) || 0) +
            (Number(scheduleExtraHoursNum.n) || 0);
        const scheduledExtraWorkedTotal =
            (Number(scheduledExtraWorkedHours.d) || 0) +
            (Number(scheduledExtraWorkedHours.n) || 0);
        const isPartialExtra =
            kind === "extra-only" &&
            isExtra &&
            scheduledExtraTotal > 0.001 &&
            scheduledExtraWorkedTotal + 0.001 < scheduledExtraTotal;
        const actualHours = {
            d: formatHour(actualHoursNum.d),
            n: formatHour(actualHoursNum.n)
        };
        const extraHours = {
            d: formatHour(scheduledExtraWorkedHours.d + clockExtraHours.d),
            n: formatHour(scheduledExtraWorkedHours.n + clockExtraHours.n)
        };
        const hasClockExtension = clockExtraHours.d + clockExtraHours.n > 0.001;
        const hasReplacement =
            getReplacementsForWorkerShift(profileName, keyDay).length > 0;
        const shiftMove = shiftMoveDetail(profileName, keyDay);
        const include =
            kind === "extra-only"
                ? isExtra || hasClockExtension || hasReplacement || Boolean(shiftMove)
                : kind === "replacement"
                    ? actual || hasReplacement || contract || swap || shiftMove
                    : rawBase || baseWithSwaps || actual || hasReplacement || swap || shiftMove;

        if (!include) continue;

        rows.push({
            iso,
            // Turno extra "completo" cuando la base (con cambios) del dia era
            // LIBRE: todo el turno es extra. Si no, es una extension horaria.
            esCompleto: Number(baseWithSwaps) === TURNO.LIBRE && !isPartialExtra,
            esParcial: isPartialExtra,
            fecha: formatDate(iso),
            diaHabil: isBusinessDay(date, holidays) ? "S\u00ed" : "No",
            tipo: kind === "extra-only"
                ? shiftMove
                    ? SHIFT_MOVE_REPORT_DETAIL
                    : "Turno extra"
                : hasManualBase
                    ? "Turno base"
                    : "Turno registrado",
            turnoBase: turnoLabel(rawBase),
            turnoConCambios: turnoLabel(baseWithSwaps),
            turnoRealizado: turnoLabel(actual),
            ...attendanceReportCells(
                profile,
                iso,
                attendanceDay(profileName, keyDay, date, holidays, data, {
                    baseShift: baseWithSwaps,
                    extraShift: extraState,
                    workedShift: actual,
                    absent: Boolean(dayAbsenceDetail(keyDay, maps)?.full),
                    today,
                    coverage
                })
            ),
            turnoExtra: turnoLabel(extraState),
            horasDiurnas: kind === "extra-only"
                ? extraHours.d
                : actualHours.d,
            horasNocturnas: kind === "extra-only"
                ? extraHours.n
                : actualHours.n,
            respaldo: shiftMove || details || (
                isExtra
                    ? UNBACKED_OVERTIME_DETAIL
                    : hasClockExtension
                        ? "Extensión horaria por modificación de marcaje"
                        : ""
            )
        });
    }

    return rows;
}

function buildReplacementLogRows(profileName, year, month, holidays) {
    return getReplacementLogForWorkerMonth(profileName, year, month)
        .map(record => {
            const keyDay = keyFromISO(record.date);
            const date = parseKey(keyDay);
            const turno = codeToTurno(record.turno);
            // Mismo calculo que el panel de registros: un respaldo de marcaje
            // vale por el marcaje vigente. Con getReplacementOvertimeHours se
            // le atribuia la jornada completa del turno del respaldo (un
            // "Diurno" de 8,8 h para un excedente de 3 h) y, si el marcaje ya
            // no existia, horas que no estaban en ninguna parte.
            const hours = getReplacementRecordHours(
                record,
                keyDay,
                date,
                turno,
                holidays
            ) || { d: 0, n: 0 };

            return {
                fecha: formatDate(record.date),
                turno: turnoReplacementLabel(turno),
                diurnas: formatHour(hours.d),
                nocturnas: formatHour(hours.n),
                reemplaza: record.replaced || "",
                motivo: record.replaced
                    ? record.absenceType || "Ausencia"
                    : record.reason || record.absenceType || "Sin detalle"
            };
        });
}

function buildSwapRows(profileName, year, month) {
    return cambiosDelMes(year, month)
        .filter(swap =>
            swap.from === profileName ||
            swap.to === profileName
        )
        .map(swap => {
            const perspective =
                getSwapPerspective(swap, profileName);
            const fechaCambio =
                perspective && !perspective.changeSkipped
                    ? formatDate(perspective.changeDate)
                    : "";
            const fechaDevolucion =
                perspective && !perspective.returnSkipped
                    ? formatDate(perspective.returnDate)
                    : "";

            return {
                estado: cambioEstaAnulado(swap) ? "Anulado" : "Activo",
                entrega: profileName,
                recibe: perspective?.counterpart || "",
                fechaCambio,
                turnoCambio: perspective?.changeTurnLabel || "",
                fechaDevolucion,
                turnoDevolucion: perspective?.returnTurnLabel || ""
            };
        });
}

function buildContractRows(profileName, year, month) {
    return activeContractsForMonth(profileName, year, month)
        .map(contract => ({
            inicio: formatContractDate(contract.start),
            termino: formatContractDate(contract.end),
            reemplaza: contract.replaces,
            motivo: contract.reason || ""
        }));
}

function finiteBalance(value) {
    const numeric = Number(value);

    return Number.isFinite(numeric)
        ? Math.max(0, numeric)
        : null;
}

function leaveBalanceCategory(absence) {
    if (!absence) return "";

    if (
        absence.category === "admin" ||
        absence.category === "half_admin"
    ) {
        return "admin";
    }

    if (absence.category === "legal") return "legal";
    if (absence.category === "comp") return "comp";

    return "";
}

function leaveBalanceUsageForDay(keyDay, maps, holidays) {
    const date = parseKey(keyDay);
    const absence = dayAbsenceDetail(keyDay, maps);
    const category = leaveBalanceCategory(absence);

    if (!category) return null;

    return {
        category,
        amount: isBusinessDay(date, holidays)
            ? (absence.full ? 1 : 0.5)
            : 0
    };
}

function leaveBalanceKeysForYear(maps, year) {
    return [
        ...new Set([
            ...Object.keys(maps.admin),
            ...Object.keys(maps.legal),
            ...Object.keys(maps.comp)
        ])
    ]
        .filter(keyDay => parseKey(keyDay).getFullYear() === year)
        .sort((a, b) => parseKey(a) - parseKey(b));
}

function createPermissionBalanceTracker(
    profileName,
    year,
    month,
    maps,
    holidays
) {
    const manual = getManualLeaveBalances(year, profileName);
    const usedInYear = {
        admin: 0,
        legal: 0,
        comp: 0
    };
    const usedBeforeMonth = {
        admin: 0,
        legal: 0,
        comp: 0
    };
    const monthStart = new Date(year, month, 1);

    leaveBalanceKeysForYear(maps, year).forEach(keyDay => {
        const usage = leaveBalanceUsageForDay(
            keyDay,
            maps,
            holidays
        );

        if (!usage) return;

        usedInYear[usage.category] += usage.amount;

        if (parseKey(keyDay) < monthStart) {
            usedBeforeMonth[usage.category] += usage.amount;
        }
    });

    const currentBalances = {
        admin:
            finiteBalance(manual.admin) ??
            Math.max(0, 6 - usedInYear.admin),
        legal:
            finiteBalance(manual.legal) ??
            Math.max(0, 15 - usedInYear.legal),
        comp:
            finiteBalance(manual.comp) ??
            Math.max(0, 10 - usedInYear.comp)
    };
    const remaining = Object.fromEntries(
        Object.entries(currentBalances).map(([category, value]) => [
            category,
            value === null
                ? null
                : value +
                    usedInYear[category] -
                    usedBeforeMonth[category]
        ])
    );

    return {
        apply(absence, keyDay) {
            const category = leaveBalanceCategory(absence);

            if (!category || remaining[category] === null) return "";

            const usage = leaveBalanceUsageForDay(
                keyDay,
                maps,
                holidays
            );

            if (usage) {
                remaining[category] = Math.max(
                    0,
                    remaining[category] - usage.amount
                );
            }

            return formatHour(remaining[category]);
        }
    };
}

function nextDayKey(keyDay) {
    const date = parseKey(keyDay);

    date.setDate(date.getDate() + 1);

    return key(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );
}

function permissionGroupKey(absence) {
    return [
        absence?.category || "",
        absence?.type || "",
        absence?.label || ""
    ].join("|");
}

function appendPermissionSegment(rows, segment) {
    if (!segment) return;

    rows.push({
        inicio: formatDate(segment.startISO),
        termino: formatDate(segment.endISO),
        cantidad: formatHour(segment.amount),
        tipo: segment.label,
        nuevoSaldo: segment.nuevoSaldo
    });
}

function permissionRowsAndAdjustments(
    profileName,
    year,
    month,
    days,
    holidays,
    options = {}
) {
    const maps = getReportMaps(profileName);
    const rows = [];
    let currentSegment = null;
    const balanceTracker = createPermissionBalanceTracker(
        profileName,
        year,
        month,
        maps,
        holidays
    );
    const adjustments = {
        businessDays: 0,
        businessHours: 0,
        adminFullDays: 0,
        adminFullHours: 0,
        halfAdminCount: 0,
        halfAdminHours: 0,
        legalDays: 0,
        legalHours: 0,
        compDays: 0,
        compHours: 0,
        medicalBusinessDays: 0,
        medicalHours: 0,
        otherApprovedDays: 0,
        otherApprovedHours: 0
    };

    for (let day = 1; day <= days; day++) {
        const date = new Date(year, month, day);
        const keyDay = key(year, month, day);
        const iso = isoFromKey(keyDay);

        if (
            options.contractOnly === true &&
            !includesWorkDay(profileName, keyDay)
        ) {
            appendPermissionSegment(rows, currentSegment);
            currentSegment = null;
            continue;
        }

        const isBusiness = isBusinessDay(date, holidays);
        const absence = dayAbsenceDetail(keyDay, maps);

        if (isBusiness) {
            adjustments.businessDays += 1;
            adjustments.businessHours += AVERAGE_DIURNAL_WORKDAY_HOURS;
        }

        if (!absence) continue;

        const amount = absence.full ? 1 : 0.5;
        const groupKey = permissionGroupKey(absence);
        const nuevoSaldo = balanceTracker.apply(absence, keyDay);
        const hours = isBusiness
            ? (
                absence.full
                    ? AVERAGE_DIURNAL_WORKDAY_HOURS
                    : AVERAGE_DIURNAL_WORKDAY_HOURS / 2
            )
            : 0;

        if (absence.category === "admin" && isBusiness) {
            adjustments.adminFullDays += 1;
            adjustments.adminFullHours += hours;
        } else if (absence.category === "half_admin" && isBusiness) {
            adjustments.halfAdminCount += 1;
            adjustments.halfAdminHours += hours;
        } else if (absence.category === "legal" && isBusiness) {
            adjustments.legalDays += 1;
            adjustments.legalHours += hours;
        } else if (absence.category === "comp" && isBusiness) {
            adjustments.compDays += 1;
            adjustments.compHours += hours;
        } else if (
            (absence.type === "license" ||
                absence.type === "union_leave" ||
                absence.type === "professional_license") &&
            isBusiness
        ) {
            adjustments.medicalBusinessDays += 1;
            adjustments.medicalHours += hours;
        } else if (
            absence.full &&
            !esAusenciaInjustificada(maps.absences[keyDay]) &&
            isBusiness
        ) {
            adjustments.otherApprovedDays += 1;
            adjustments.otherApprovedHours += hours;
        }

        if (
            currentSegment &&
            currentSegment.groupKey === groupKey &&
            nextDayKey(currentSegment.endKey) === keyDay
        ) {
            currentSegment.endKey = keyDay;
            currentSegment.endISO = iso;
            currentSegment.amount += amount;
            currentSegment.nuevoSaldo = nuevoSaldo;
        } else {
            appendPermissionSegment(rows, currentSegment);
            currentSegment = {
                groupKey,
                startKey: keyDay,
                endKey: keyDay,
                startISO: iso,
                endISO: iso,
                amount,
                label: absence.label,
                nuevoSaldo
            };
        }
    }

    appendPermissionSegment(rows, currentSegment);

    return {
        rows,
        adjustments
    };
}

function buildClockRows(profileName, year, month) {
    const marks = getClockMarks(profileName);
    const rows = [];

    Object.entries(marks).forEach(([keyDay, mark]) => {
        const parsed = parseKey(keyDay);

        if (parsed.getFullYear() !== year || parsed.getMonth() !== month) {
            return;
        }

        Object.values(mark.segments || {}).forEach(segment => {
            const incidence = [
                segment.missingEntry ? "Sin entrada" : "",
                segment.missingExit ? "Sin salida" : "",
                segment.entryTime ? `Entrada ${segment.entryTime}` : "",
                segment.exitTime ? `Salida ${segment.exitTime}` : ""
            ].filter(Boolean).join(" / ");

            if (!incidence) return;

            rows.push({
                fecha: formatDate(isoFromKey(keyDay)),
                turno: segment.label || "",
                incidencia: incidence,
                comentario:
                    segment.adminNote ||
                    segment.comments ||
                    ""
            });
        });
    });

    return rows.sort((a, b) =>
        a.fecha.localeCompare(b.fecha)
    );
}

function buildNoAssignmentReportModel({
    profile,
    monthDate,
    holidays,
    stats,
    contractOnly = false
}) {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const data = getProfileData(profile.name);
    const dayDetail = buildNoAssignmentDayRows(
        profile,
        year,
        month,
        days,
        holidays,
        { contractOnly }
    );
    const carryIn = reportCarryIn(
        profile.name,
        year,
        month,
        data,
        holidays
    );
    const carryOut = reportCarryOut(
        profile.name,
        year,
        month,
        days,
        data,
        holidays
    );
    const totalD =
        dayDetail.rawTotals.d + carryIn.d - carryOut.d;
    const totalN =
        dayDetail.rawTotals.n + carryIn.n - carryOut.n;
    const permissions = permissionRowsAndAdjustments(
        profile.name,
        year,
        month,
        days,
        holidays,
        { contractOnly }
    );
    const valorHora = getValorHora(profile.name);
    const monthName = monthLabel(monthDate);

    return {
        profile,
        monthDate,
        year,
        month,
        monthName,
        stats,
        contractOnly,
        valorHora,
        rawDiurnas: dayDetail.rawTotals.d,
        rawNocturnas: dayDetail.rawTotals.n,
        carryIn,
        carryOut,
        totalD,
        totalN,
        totalWorked: totalD + totalN,
        adjustments: permissions.adjustments,
        permissionRows: permissions.rows,
        contractRows: contractOnly
            ? buildContractRows(profile.name, year, month)
            : [],
        swapRows: buildSwapRows(profile.name, year, month),
        clockRows: buildClockRows(profile.name, year, month),
        dayRows: [
            ...dayDetail.rows,
            {
                // Total BRUTO del mes: suma de las horas trabajadas en los dias
                // del mes, sin descontar las horas que se traspasan al mes
                // siguiente (ese ajuste de carry se detalla en el resumen).
                fecha: "Total bruto del mes",
                turnoBase: "",
                turnoRealizado: "",
                horasDiurnas: formatHour(dayDetail.rawTotals.d),
                horasNocturnas: formatHour(dayDetail.rawTotals.n),
                respaldo: ""
            }
        ]
    };
}

function buildAssignedShiftReportModel({
    profile,
    monthDate,
    holidays,
    stats
}) {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const data = getProfileData(profile.name);
    const dayDetail = buildAssignedShiftDayRows(
        profile,
        year,
        month,
        days,
        holidays
    );
    const carryIn = assignedCarryIn(
        profile.name,
        year,
        month,
        holidays
    );
    const carryOut = assignedCarryOut(
        profile.name,
        year,
        month,
        days,
        data,
        holidays
    );
    const currentMonthTotals = subtractNumericHours(
        dayDetail.rawTotals,
        carryOut
    );
    const totalD =
        dayDetail.rawTotals.d + carryIn.d - carryOut.d;
    const totalN =
        dayDetail.rawTotals.n + carryIn.n - carryOut.n;
    const permissions = permissionRowsAndAdjustments(
        profile.name,
        year,
        month,
        days,
        holidays
    );
    const valorHora = getValorHora(profile.name);
    const monthName = monthLabel(monthDate);
    return {
        profile,
        monthDate,
        year,
        month,
        monthName,
        stats,
        valorHora,
        rawDiurnas: dayDetail.rawTotals.d,
        rawNocturnas: dayDetail.rawTotals.n,
        currentMonthDiurnas: currentMonthTotals.d,
        currentMonthNocturnas: currentMonthTotals.n,
        carryIn,
        carryOut,
        totalD,
        totalN,
        paymentDiurno: stats.returnTransferEnabled
            ? 0
            : totalD * valorHora * 1.25,
        paymentNocturno: stats.returnTransferEnabled
            ? 0
            : totalN * valorHora * 1.5,
        permissionRows: permissions.rows,
        swapRows: buildSwapRows(profile.name, year, month),
        clockRows: buildClockRows(profile.name, year, month),
        dayRows: dayDetail.rows
    };
}

function table(title, columns, rows) {
    const body = rows.length
        ? rows.map(row => `
            <tr>
                ${columns.map(column => `
                    <td>${escapeHTML(displayReportText(row[column.key] ?? ""))}</td>
                `).join("")}
            </tr>
        `).join("")
        : `
            <tr>
                <td colspan="${columns.length}">Sin registros para este mes.</td>
            </tr>
        `;

    return `
        <h2>${escapeHTML(title)}</h2>
        <table>
            <thead>
                <tr>
                    ${columns.map(column => `<th>${escapeHTML(column.label)}</th>`).join("")}
                </tr>
            </thead>
            <tbody>${body}</tbody>
        </table>
    `;
}

/**
 * Una celda de las tablas del reporte.
 *
 * El texto va escapado, asi que una celda no puede traer marcado propio. Para
 * lo que necesita algo mas -hoy, la cruz de "sin entrada" y su explicacion al
 * pasar el mouse- la fila adjunta metadatos en `__cells`.
 */
function cellHTML(row, column) {
    const meta = row.__cells?.[column.key];
    const title = meta?.title
        ? ` title="${escapeHTML(meta.title)}"`
        : "";
    const className = meta?.className
        ? ` class="${escapeHTML(meta.className)}"`
        : "";
    const text = escapeHTML(displayReportText(row[column.key] ?? ""));

    return `
                    <td data-col="${escapeHTML(column.key)}"${className}${title}>${text}</td>
                `;
}

function reportTableRowsHTML(columns, rows, emptyText) {
    return rows.length
        ? rows.map(row => {
            const rowClass =
                row.diaHabil === "No"
                    ? ` class="report-row--inhabil"`
                    : "";

            return `
            <tr${rowClass}>
                ${columns.map(column => cellHTML(row, column)).join("")}
            </tr>
        `;
        }).join("")
        : `
            <tr>
                <td colspan="${columns.length}">${escapeHTML(emptyText)}</td>
            </tr>
        `;
}

function reportWorkerDataTable(title, columns, rows, emptyText) {
    const middle = Math.ceil(rows.length / 2);
    const groups = rows.length
        ? [rows.slice(0, middle), rows.slice(middle)]
        : [[]];

    return `
        <section class="report-section report-section--worker-data">
            <h4>${escapeHTML(title)}</h4>
            <div class="report-worker-data-grid">
                ${groups.map((group, index) => `
                    <div class="report-worker-data-column">
                        <div class="report-table-wrap">
                            <table class="report-table">
                                <thead>
                                    <tr>
                                        ${columns.map(column =>
                                            `<th data-col="${escapeHTML(column.key)}">${escapeHTML(column.label)}</th>`
                                        ).join("")}
                                    </tr>
                                </thead>
                                <tbody>${reportTableRowsHTML(columns, group, emptyText)}</tbody>
                            </table>
                        </div>
                    </div>
                `).join("")}
            </div>
        </section>
    `;
}

function reportTable(title, columns, rows, emptyText = "Sin registros para este mes.") {
    if (title === "Datos del trabajador") {
        return reportWorkerDataTable(
            title,
            columns,
            rows,
            emptyText
        );
    }

    const body = reportTableRowsHTML(columns, rows, emptyText);

    return `
        <section class="report-section">
            <h4>${escapeHTML(title)}</h4>
            <div class="report-table-wrap">
                <table class="report-table">
                    <thead>
                        <tr>
                            ${columns.map(column =>
                                `<th data-col="${escapeHTML(column.key)}">${escapeHTML(column.label)}</th>`
                            ).join("")}
                        </tr>
                    </thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
        </section>
    `;
}

function noAssignmentHoursRows(model) {
    return [
        {
            item: "Horas diurnas",
            signo: "(+)",
            valor: formatHour(model.rawDiurnas),
            item2: "Horas nocturnas",
            signo2: "(+)",
            valor2: formatHour(model.rawNocturnas)
        },
        {
            item: "Horas diurnas mes anterior",
            signo: "(+)",
            valor: formatHour(model.carryIn.d),
            item2: "Horas nocturnas mes anterior",
            signo2: "(+)",
            valor2: formatHour(model.carryIn.n)
        },
        {
            item: "Horas diurnas mes siguiente",
            signo: "(-)",
            valor: formatHour(model.carryOut.d),
            item2: "Horas nocturnas mes siguiente",
            signo2: "(-)",
            valor2: formatHour(model.carryOut.n)
        },
        {
            item: "Total Horas Diurnas",
            signo: "(=)",
            valor: formatHour(model.totalD),
            item2: "Total Horas Nocturnas",
            signo2: "(=)",
            valor2: formatHour(model.totalN)
        }
    ];
}

function noAssignmentBusinessRows(model) {
    const adj = model.adjustments;
    const rows = [
        {
            cantidad: formatHour(adj.businessDays),
            item: "D\u00edas h\u00e1biles trabajados",
            signo: "(+)",
            horas: formatHour(adj.businessHours)
        }
    ];

    const adjustmentRows = [
        ["adminFullDays", "adminFullHours", "P. Administrativos"],
        ["legalDays", "legalHours", "F. Legal"],
        ["halfAdminCount", "halfAdminHours", "1/2 ADM ma\u00f1ana/tarde"],
        ["medicalBusinessDays", "medicalHours", "Licencias m\u00e9dicas / LM Profesional en d\u00edas h\u00e1biles"]
    ];

    if (!model.contractOnly) {
        adjustmentRows.splice(
            2,
            0,
            ["compDays", "compHours", "F. Compensatorios"]
        );
        adjustmentRows.push([
            "otherApprovedDays",
            "otherApprovedHours",
            "Otros permisos aprobados"
        ]);
    }

    adjustmentRows.forEach(([countKey, hoursKey, label]) => {
        if (!adj[countKey]) return;

        rows.push({
            cantidad: formatHour(adj[countKey]),
            item: label,
            signo: "(-)",
            horas: formatHour(adj[hoursKey])
        });
    });

    rows.push({
        cantidad: "",
        item: `Total Horas h\u00e1biles de ${model.monthName}`,
        signo: "(=)",
        horas: formatHour(model.stats.horasHabiles)
    });

    return rows;
}

function formatReturnTransferValue(hours) {
    return `${formatHour(Math.max(0, Number(hours) || 0))}h`;
}

function noAssignmentExtraRows(model) {
    const returnTransferEnabled =
        Boolean(model.stats?.returnTransferEnabled);
    const dayReturnHours =
        Math.max(0, Number(model.stats?.hheeDiurnas) || 0) * 1.25;
    const nightReturnHours =
        Math.max(0, Number(model.stats?.hheeNocturnas) || 0) * 1.5;

    return [
        {
            item: `Horas h\u00e1biles ${model.monthName}`,
            valor: formatHour(model.stats.horasHabiles),
            item2: "HHEE Diurnas",
            valor2: formatHour(model.stats.hheeDiurnas)
        },
        {
            item: "Total horas realizadas",
            valor: formatHour(model.totalWorked),
            item2: "HHEE Nocturnas",
            valor2: formatHour(model.stats.hheeNocturnas)
        },
        {
            item: returnTransferEnabled
                ? "A devoluci\u00f3n diurna"
                : "Pago diurno estimado",
            valor: returnTransferEnabled
                ? formatReturnTransferValue(dayReturnHours)
                : `$${formatMoney(model.stats.paymentDiurno)}`,
            item2: returnTransferEnabled
                ? "A devoluci\u00f3n nocturna"
                : "Pago nocturno estimado",
            valor2: returnTransferEnabled
                ? formatReturnTransferValue(nightReturnHours)
                : `$${formatMoney(model.stats.paymentNocturno)}`
        }
    ];
}

function assignedShiftSummaryRows(model) {
    const returnTransferEnabled =
        Boolean(model.stats?.returnTransferEnabled);
    const dayReturnHours =
        Math.max(0, Number(model.totalD) || 0) * 1.25;
    const nightReturnHours =
        Math.max(0, Number(model.totalN) || 0) * 1.5;

    return [
        {
            item: "HHEE diurnas mes anterior",
            signo: "(+)",
            valor: formatHour(model.carryIn.d),
            item2: "HHEE nocturnas mes anterior",
            signo2: "(+)",
            valor2: formatHour(model.carryIn.n)
        },
        {
            item: "HHEE diurnas mes siguiente",
            signo: "(-)",
            valor: formatHour(model.carryOut.d),
            item2: "HHEE nocturnas mes siguiente",
            signo2: "(-)",
            valor2: formatHour(model.carryOut.n)
        },
        {
            item: "HHEE realizadas en mes actual",
            signo: "(+)",
            valor: formatHour(model.rawDiurnas),
            item2: "HHEE realizadas en mes actual",
            signo2: "(+)",
            valor2: formatHour(model.rawNocturnas)
        },
        {
            item: returnTransferEnabled
                ? "Total HHEE diurnas a devoluci\u00f3n"
                : "Total HHEE diurnas a pago",
            signo: "(=)",
            valor: formatHour(model.totalD),
            item2: returnTransferEnabled
                ? "Total HHEE nocturnas a devoluci\u00f3n"
                : "Total HHEE nocturnas a pago",
            signo2: "(=)",
            valor2: formatHour(model.totalN)
        },
        {
            item: returnTransferEnabled
                ? "A devoluci\u00f3n diurna"
                : "Pago extra diurno estimado",
            signo: "(=)",
            valor: returnTransferEnabled
                ? formatReturnTransferValue(dayReturnHours)
                : `$${formatMoney(model.paymentDiurno)}`,
            item2: returnTransferEnabled
                ? "A devoluci\u00f3n nocturna"
                : "Pago extra nocturno estimado",
            signo2: "(=)",
            valor2: returnTransferEnabled
                ? formatReturnTransferValue(nightReturnHours)
                : `$${formatMoney(model.paymentNocturno)}`
        }
    ];
}

function noAssignmentProfileRows(model) {
    const workspace = getActiveWorkspace();
    const replacementContract =
        isReplacementProfile(model.profile.name)
            ? activeContractsForMonth(
                model.profile.name,
                model.year,
                model.month
            )[0]
            : null;
    const rotativa = replacementContract
        ? (
            replacementContract.rotationMode ===
                REPLACEMENT_ROTATION_MODE.FREE ||
            (
                !replacementContract.rotationMode &&
                getRotativa(model.profile.name).type === "libre"
            )
        )
            ? { type: "libre" }
            : getRotativa(replacementContract.replaces)
        : getRotativa(model.profile.name);

    return [
        { campo: "Nombre", valor: model.profile.name },
        { campo: "RUT", valor: model.profile.rut || "Sin registro" },
        { campo: "Unidad", valor: workspace?.name || "Sin unidad activa" },
        { campo: "Contrato", valor: model.profile.contractType || "Sin registro" },
        { campo: "Grado", valor: model.profile.grade || "Sin registro" },
        { campo: "Asignaci\u00f3n de Turno", valor: getShiftAssigned(model.profile.name, model.monthDate) ? "S\u00cd" : "NO" },
        { campo: "Estamento", valor: model.profile.estamento || "Sin registro" },
        { campo: "Rotativa", valor: rotationLabel(rotativa.type) },
        { campo: "Profesi\u00f3n", valor: model.profile.profession || "Sin informaci\u00f3n" },
        { campo: "Valor Hora", valor: `$${formatMoney(model.valorHora)}` }
    ];
}

function buildNoAssignmentReportHTML(model) {
    return `
        <div class="no-assignment-report">
            <div class="report-title-strip">
                PLANILLA "${escapeHTML(model.monthName.toUpperCase())}"
            </div>
            ${reportTable("Datos del trabajador", [
                { key: "campo", label: "Campo" },
                { key: "valor", label: "Valor" }
            ], noAssignmentProfileRows(model))}
            ${model.contractRows?.length ? reportTable("Contratos", [
                { key: "inicio", label: "Fecha Inicio" },
                { key: "termino", label: "Fecha T\u00e9rmino" },
                { key: "reemplaza", label: "Reemplaza a" },
                { key: "motivo", label: "Motivo" }
            ], model.contractRows) : ""}
            ${reportTable("Horas del Mes", [
                { key: "item", label: "Concepto diurno" },
                { key: "signo", label: "" },
                { key: "valor", label: "Horas" },
                { key: "item2", label: "Concepto nocturno" },
                { key: "signo2", label: "" },
                { key: "valor2", label: "Horas" }
            ], noAssignmentHoursRows(model))}
            ${reportTable("Cálculo de Horas Hábiles", [
                { key: "cantidad", label: "Cantidad" },
                { key: "item", label: "Concepto" },
                { key: "signo", label: "" },
                { key: "horas", label: "Horas" }
            ], noAssignmentBusinessRows(model))}
            ${reportTable("Horas extras", [
                { key: "item", label: "Concepto" },
                { key: "valor", label: "Valor" },
                { key: "item2", label: "Concepto" },
                { key: "valor2", label: "Valor" }
            ], noAssignmentExtraRows(model))}
            ${reportTable("Permisos / Ausencias", [
                { key: "inicio", label: "Fecha Inicio" },
                { key: "termino", label: "Fecha T\u00e9rmino" },
                { key: "cantidad", label: "N° Solicitado" },
                { key: "tipo", label: "Tipo de permiso" },
                { key: "nuevoSaldo", label: "Nuevo Saldo" }
            ], model.permissionRows)}
            ${reportTable("Cambios de turno", [
                { key: "estado", label: "Estado" },
                { key: "entrega", label: "Entrega turno" },
                { key: "recibe", label: "Recibe turno" },
                { key: "fechaCambio", label: "Fecha cambio" },
                { key: "turnoCambio", label: "Turno cambio" },
                { key: "fechaDevolucion", label: "Fecha devoluci\u00f3n" },
                { key: "turnoDevolucion", label: "Turno devoluci\u00f3n" }
            ], model.swapRows)}
            ${reportTable("Registros de marcaje", [
                { key: "fecha", label: "Fecha" },
                { key: "turno", label: "Turno" },
                { key: "incidencia", label: "Tipo de Incidencia" },
                { key: "comentario", label: "Comentario" }
            ], model.clockRows)}
            ${reportTable("Detalle de turnos", [
                { key: "fecha", label: "Fecha" },
                { key: "turnoBase", label: "Turno Base" },
                { key: "turnoRealizado", label: "Turno realizado" },
                { key: "entrada", label: "Entrada" },
                { key: "salida", label: "Salida" },
                { key: "atrasos", label: "Atrasos" },
                { key: "horasDiurnas", label: "Horas diurnas" },
                { key: "horasNocturnas", label: "Horas nocturnas" },
                { key: "respaldo", label: "Detalles" }
            ], model.dayRows)}
            ${reportSignatureFooterHTML()}
        </div>
    `;
}

function buildAssignedShiftReportHTML(model) {
    return `
        <div class="no-assignment-report assigned-shift-report">
            <div class="report-title-strip">
                PLANILLA "${escapeHTML(model.monthName.toUpperCase())}"
            </div>
            ${reportTable("Datos del trabajador", [
                { key: "campo", label: "Campo" },
                { key: "valor", label: "Valor" }
            ], noAssignmentProfileRows(model))}
            ${reportTable("Resumen de horas extras", [
                { key: "item", label: "Concepto diurno" },
                { key: "signo", label: "" },
                { key: "valor", label: "Horas / Valor" },
                { key: "item2", label: "Concepto nocturno" },
                { key: "signo2", label: "" },
                { key: "valor2", label: "Horas / Valor" }
            ], assignedShiftSummaryRows(model))}
            ${reportTable("Permisos / Ausencias", [
                { key: "inicio", label: "Fecha Inicio" },
                { key: "termino", label: "Fecha T\u00e9rmino" },
                { key: "cantidad", label: "N° Solicitado" },
                { key: "tipo", label: "Tipo de permiso" },
                { key: "nuevoSaldo", label: "Nuevo Saldo" }
            ], model.permissionRows)}
            ${reportTable("Cambios de turno", [
                { key: "recibe", label: "Recibe turno" },
                { key: "fechaCambio", label: "Fecha cambio" },
                { key: "turnoCambio", label: "Turno cambio" },
                { key: "fechaDevolucion", label: "Fecha devoluci\u00f3n" },
                { key: "turnoDevolucion", label: "Turno devoluci\u00f3n" }
            ], model.swapRows)}
            ${reportTable("Registros de marcaje", [
                { key: "fecha", label: "Fecha" },
                { key: "turno", label: "Turno" },
                { key: "incidencia", label: "Tipo de Incidencia" },
                { key: "comentario", label: "Comentario" }
            ], model.clockRows)}
            ${reportTable("Detalle de turnos", [
                { key: "fecha", label: "Fecha" },
                { key: "turnoBase", label: "Turno Base" },
                { key: "turnoRealizado", label: "Turno realizado" },
                { key: "entrada", label: "Entrada" },
                { key: "salida", label: "Salida" },
                { key: "atrasos", label: "Atrasos" },
                { key: "hheeDiurnas", label: "HHEE diurnas" },
                { key: "hheeNocturnas", label: "HHEE nocturnas" },
                { key: "respaldo", label: "Detalles" }
            ], model.dayRows)}
            ${reportSignatureFooterHTML()}
        </div>
    `;
}

function noAssignmentWorkbookHTML(model) {
    return `
        <!doctype html>
        <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: Calibri, Arial, sans-serif; color: #111827; }
                    .report-title-strip { background: #0f172a; color: #fff; font-size: 18px; font-weight: 700; text-align: center; padding: 10px; }
                    h4 { margin: 14px 0 0; padding: 6px 8px; color: #fff; background: #1d6cff; font-size: 13px; text-transform: uppercase; }
                    table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
                    th { background: #dbeafe; color: #0f172a; font-weight: 700; }
                    th, td { border: 1px solid #94a3b8; padding: 5px 7px; vertical-align: top; font-size: 11px; }
                    td { mso-number-format:"\\@"; }
                    .report-worker-data-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
                    .report-worker-data-column { min-width: 0; }
                    .report-section--worker-data th:first-child,
                    .report-section--worker-data td:first-child { width: 1%; white-space: nowrap; padding-right: 22px; }
                    .report-row--inhabil td:first-child { background: #fee2e2; }
                    .report-signature-footer { width: 320px; margin: 72px 28px 0 auto; padding: 8px 0 0; border-top: 1px solid #1e2f4d; color: #1e2f4d; font-size: 11px; line-height: 1.3; text-align: center; }
                </style>
            </head>
            <body>${buildNoAssignmentReportHTML(model)}</body>
        </html>
    `;
}

function assignedShiftWorkbookHTML(model) {
    return `
        <!doctype html>
        <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: Calibri, Arial, sans-serif; color: #111827; }
                    .report-title-strip { background: #0f172a; color: #fff; font-size: 18px; font-weight: 700; text-align: center; padding: 10px; }
                    h4 { margin: 14px 0 0; padding: 6px 8px; color: #fff; background: #1d6cff; font-size: 13px; text-transform: uppercase; }
                    table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
                    th { background: #dbeafe; color: #0f172a; font-weight: 700; }
                    th, td { border: 1px solid #94a3b8; padding: 5px 7px; vertical-align: top; font-size: 11px; }
                    td { mso-number-format:"\\@"; }
                    .report-worker-data-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
                    .report-worker-data-column { min-width: 0; }
                    .report-section--worker-data th:first-child,
                    .report-section--worker-data td:first-child { width: 1%; white-space: nowrap; padding-right: 22px; }
                    .report-row--inhabil td:first-child { background: #fee2e2; }
                    .report-signature-footer { width: 320px; margin: 72px 28px 0 auto; padding: 8px 0 0; border-top: 1px solid #1e2f4d; color: #1e2f4d; font-size: 11px; line-height: 1.3; text-align: center; }
                </style>
            </head>
            <body>${buildAssignedShiftReportHTML(model)}</body>
        </html>
    `;
}

function getCalculationRows(stats, profileName) {
    const valorHora = getValorHora(profileName);
    const returnTransferEnabled =
        Boolean(stats.returnTransferEnabled);
    const pagoDiurno = Number.isFinite(Number(stats.paymentDiurno))
        ? Number(stats.paymentDiurno)
        : stats.hheeDiurnas * 1.25 * valorHora;
    const pagoNocturno = Number.isFinite(Number(stats.paymentNocturno))
        ? Number(stats.paymentNocturno)
        : stats.hheeNocturnas * 1.5 * valorHora;
    const dayReturnHours =
        Math.max(0, Number(stats.hheeDiurnas) || 0) * 1.25;
    const nightReturnHours =
        Math.max(0, Number(stats.hheeNocturnas) || 0) * 1.5;
    const modeLabel = stats.mode === "diurno"
        ? "Personal Diurno"
        : stats.mode === "assigned"
            ? "Rotativa con asignaci\u00f3n de turno"
            : "Rotativa sin asignaci\u00f3n / c\u00e1lculo agregado";
    const formula = stats.mode === "aggregate"
        ? "Base mensual ajustada - horas diurnas trabajadas; el remanente se cruza contra horas nocturnas."
        : "Se compara cada turno real contra la rotativa base y solo se contabiliza la diferencia.";

    return [
        { item: "Modo de c\u00e1lculo", valor: modeLabel },
        { item: "Formula aplicada", valor: formula },
        { item: "Horas diurnas trabajadas", valor: `${formatHour(stats.totalD)}h` },
        { item: "Horas nocturnas trabajadas", valor: `${formatHour(stats.totalN)}h` },
        { item: "Base h\u00e1bil ajustada del mes", valor: `${formatHour(stats.horasHabiles)}h` },
        { item: "HHEE diurnas redondeadas", valor: `${stats.hheeDiurnas}h` },
        { item: "HHEE nocturnas redondeadas", valor: `${stats.hheeNocturnas}h` },
        {
            item: "Destino de HH.EE del mes",
            valor: stats.returnTransferEnabled
                ? `Devoluci\u00f3n de horas (${formatHour(stats.returnTransferHours)}h generadas)`
                : "Pago"
        },
        { item: "Valor hora actual", valor: `$${formatMoney(valorHora)}` },
        { item: "Regla de valor hora", valor: "Se usa el grado vigente en la fecha de cada hora extra cuando existe historial." },
        {
            item: returnTransferEnabled
                ? "A devoluci\u00f3n diurna"
                : "Pago diurno estimado",
            valor: returnTransferEnabled
                ? formatReturnTransferValue(dayReturnHours)
                : `$${formatMoney(pagoDiurno)}`
        },
        {
            item: returnTransferEnabled
                ? "A devoluci\u00f3n nocturna"
                : "Pago nocturno estimado",
            valor: returnTransferEnabled
                ? formatReturnTransferValue(nightReturnHours)
                : `$${formatMoney(pagoNocturno)}`
        },
        { item: "Traspaso al mes siguiente", valor: `${formatHour(stats.carryOut?.d)}h diurnas / ${formatHour(stats.carryOut?.n)}h nocturnas` }
    ];
}

function buildWorkbookHTML({
    profile,
    monthDate,
    stats,
    dayRows,
    replacementRows,
    swapRows,
    contractRows
}) {
    const rotativa = getRotativa(profile.name);
    const title = `Reporte Horas Extras - ${profile.name} - ${monthLabel(monthDate)}`;
    const workspace = getActiveWorkspace();
    const workspaceUnit = workspace?.name || "Sin unidad activa";
    const profileRows = [
        { campo: "Nombre", valor: profile.name },
        { campo: "RUT", valor: profile.rut || "Sin registro" },
        { campo: "Unidad", valor: workspaceUnit },
        { campo: "Tipo de contrato", valor: profile.contractType || "Sin registro" },
        { campo: "Estamento", valor: profile.estamento || "Sin registro" },
        { campo: "Profesi\u00f3n", valor: profile.profession || "Sin informaci\u00f3n" },
        { campo: "Grado", valor: profile.grade || "Sin registro" },
        { campo: "Rotativa", valor: rotationLabel(rotativa.type) },
        { campo: "Asignaci\u00f3n de turno", valor: getShiftAssigned(profile.name, monthDate) ? "S\u00ed" : "No" },
        { campo: "Mes reportado", valor: monthLabel(monthDate) }
    ];

    return `
        <!doctype html>
        <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: Calibri, Arial, sans-serif; color: #111827; }
                    h1 { font-size: 22px; margin: 0 0 16px; }
                    h2 { font-size: 16px; margin: 22px 0 8px; }
                    table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
                    th { background: #dbeafe; color: #0f172a; font-weight: 700; }
                    th, td { border: 1px solid #9ca3af; padding: 7px 9px; vertical-align: top; }
                    .note { color: #475569; margin-bottom: 14px; }
                    .report-signature-footer { width: 320px; margin: 72px 28px 0 auto; padding: 8px 0 0; border-top: 1px solid #1e2f4d; color: #1e2f4d; font-size: 11px; line-height: 1.3; text-align: center; }
                </style>
            </head>
            <body>
                <h1>${escapeHTML(title)}</h1>
                <div class="note">
                    Archivo generado desde ProTurnos. Las horas del resumen aplican la misma regla de c\u00e1lculo que la vista de Horas Extras.
                </div>
                ${table("Datos del trabajador", [
                    { key: "campo", label: "Campo" },
                    { key: "valor", label: "Valor" }
                ], profileRows)}
                ${contractRows.length ? table("Contratos del mes", [
                    { key: "inicio", label: "Inicio" },
                    { key: "termino", label: "T\u00e9rmino" },
                    { key: "reemplaza", label: "Reemplaza a" }
                ], contractRows) : ""}
                ${table("Detalle mensual", [
                    { key: "fecha", label: "Fecha" },
                    { key: "diaHabil", label: "D\u00eda h\u00e1bil" },
                    { key: "tipo", label: "Tipo" },
                    { key: "turnoBase", label: "Turno base" },
                    { key: "turnoConCambios", label: "Base con CCTT" },
                    { key: "turnoRealizado", label: "Turno realizado" },
                    { key: "turnoExtra", label: "Turno extra" },
                    { key: "horasDiurnas", label: "Horas diurnas" },
                    { key: "horasNocturnas", label: "Horas nocturnas" },
                    { key: "respaldo", label: "Detalles" }
                ], dayRows)}
                ${table("Respaldos de horas extras", [
                    { key: "fecha", label: "Fecha" },
                    { key: "turno", label: "Turno" },
                    { key: "diurnas", label: "Horas diurnas" },
                    { key: "nocturnas", label: "Horas nocturnas" },
                    { key: "reemplaza", label: "Reemplaza a" },
                    { key: "motivo", label: "Motivo" }
                ], replacementRows)}
                ${table("Cambios de turno", [
                    { key: "estado", label: "Estado" },
                    { key: "entrega", label: "Entrega turno" },
                    { key: "recibe", label: "Recibe turno" },
                    { key: "fechaCambio", label: "Fecha cambio" },
                    { key: "turnoCambio", label: "Turno cambio" },
                    { key: "fechaDevolucion", label: "Fecha devoluci\u00f3n" },
                    { key: "turnoDevolucion", label: "Turno devoluci\u00f3n" }
                ], swapRows)}
                ${table("Detalle del c\u00e1lculo", [
                    { key: "item", label: "Item" },
                    { key: "valor", label: "Valor" }
                ], getCalculationRows(stats, profile.name))}
                ${reportSignatureFooterHTML()}
            </body>
        </html>
    `;
}

function downloadExcel(html, filename) {
    const blob = new Blob(["\ufeff", html], {
        type: "application/vnd.ms-excel;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

export async function buildNoAssignmentReportPreviewHTML(
    profile,
    monthDate = new Date()
) {
    if (!profile?.name || !isNoAssignmentShiftProfile(profile.name, monthDate)) {
        return "";
    }

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchReportHolidays(year);
    const data = getProfileData(profile.name);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        data,
        {},
        { d: 0, n: 0 }
    );
    const model = buildNoAssignmentReportModel({
        profile,
        monthDate,
        holidays,
        stats
    });

    return buildNoAssignmentReportHTML(model);
}

export async function buildReplacementReportPreviewHTML(
    profile,
    monthDate = new Date()
) {
    if (!profile?.name || !isReplacementReportProfile(profile.name)) {
        return "";
    }

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchReportHolidays(year);
    const data = getProfileData(profile.name);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        data,
        {},
        { d: 0, n: 0 }
    );
    const model = buildNoAssignmentReportModel({
        profile,
        monthDate,
        holidays,
        stats,
        contractOnly: true
    });

    return buildNoAssignmentReportHTML(model);
}

export async function buildAssignedShiftReportPreviewHTML(
    profile,
    monthDate = new Date()
) {
    if (!profile?.name || !isAssignedShiftReportProfile(profile.name, monthDate)) {
        return "";
    }

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchReportHolidays(year);
    const data = getProfileData(profile.name);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        data,
        {},
        { d: 0, n: 0 }
    );
    const model = buildAssignedShiftReportModel({
        profile,
        monthDate,
        holidays,
        stats
    });

    return buildAssignedShiftReportHTML(model);
}

export async function buildDiurnoReportPreviewHTML(
    profile,
    monthDate = new Date()
) {
    if (!profile?.name || !isDiurnoReportProfile(profile.name)) {
        return "";
    }

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchReportHolidays(year);
    const data = getProfileData(profile.name);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        data,
        {},
        { d: 0, n: 0 }
    );
    const model = stats.mode === "aggregate"
        ? buildNoAssignmentReportModel({
            profile,
            monthDate,
            holidays,
            stats
        })
        : buildAssignedShiftReportModel({
            profile,
            monthDate,
            holidays,
            stats
        });

    return stats.mode === "aggregate"
        ? buildNoAssignmentReportHTML(model)
        : buildAssignedShiftReportHTML(model);
}

// Reporte (HTML imprimible) del trabajador segun su tipo de perfil. Es el mismo
// que el supervisor previsualiza/imprime en turnoplus.cl; se usa para publicarlo
// a la app del trabajador y que pueda descargarlo en PDF.
export async function buildWorkerReportPreviewHTML(
    profile,
    monthDate = new Date()
) {
    if (!profile?.name) return "";

    if (isReplacementReportProfile(profile.name)) {
        return buildReplacementReportPreviewHTML(profile, monthDate);
    }

    if (isAssignedShiftReportProfile(profile.name)) {
        return buildAssignedShiftReportPreviewHTML(profile, monthDate);
    }

    if (isDiurnoReportProfile(profile.name)) {
        return buildDiurnoReportPreviewHTML(profile, monthDate);
    }

    if (isNoAssignmentShiftProfile(profile.name)) {
        return buildNoAssignmentReportPreviewHTML(profile, monthDate);
    }

    return "";
}

// Resumen HHEE autoritativo de un trabajador para un mes, usando el MISMO motor
// del reporte (turnos extra agregados manualmente, extensiones horarias y el
// arrastre de horas de noche entre meses). Devuelve totales crudos del mes y
// netos (con carryIn del mes anterior y carryOut al siguiente).
export async function buildWorkerHheeMonthSummary(
    profile,
    monthDate = new Date()
) {
    if (!profile?.name) return null;

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchReportHolidays(year);
    const data = getProfileData(profile.name);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        data,
        {},
        { d: 0, n: 0 }
    );
    const monthReferenceDate = new Date(year, month + 1, 0);
    const effectiveProfile =
        getCompensationProfileAt(profile.name, monthReferenceDate) ||
        profile;
    const effectiveContractType =
        effectiveProfile.contractType ||
        profile.contractType ||
        "";

    let model;

    if (isReplacementReportProfile(profile.name)) {
        model = buildNoAssignmentReportModel({
            profile,
            monthDate,
            holidays,
            stats,
            contractOnly: true
        });
    } else if (isAssignedShiftReportProfile(profile.name, monthDate)) {
        model = buildAssignedShiftReportModel({
            profile,
            monthDate,
            holidays,
            stats
        });
    } else if (isDiurnoReportProfile(profile.name)) {
        model = stats.mode === "aggregate"
            ? buildNoAssignmentReportModel({ profile, monthDate, holidays, stats })
            : buildAssignedShiftReportModel({ profile, monthDate, holidays, stats });
    } else {
        model = buildNoAssignmentReportModel({ profile, monthDate, holidays, stats });
    }

    // Las horas vienen formateadas con coma decimal ("10,8"); Number("10,8") es
    // NaN, así que las diurnas fraccionarias caían a 0. Normalizamos la coma.
    const num = value => {
        const parsed = Number(String(value).replace(",", "."));
        return Number.isFinite(parsed) ? parsed : 0;
    };

    // Detalle por turno para la PWA (seccion "Detalle de turnos"). Reemplazo
    // muestra TODOS sus turnos; el resto, solo los turnos extra (los que se
    // suman sobre la rotativa base, incluidas extensiones horarias).
    //
    // Excepcion: sin asignacion de turno y con rotativa de 3er/4to turno no hay
    // una base contra la cual medir "lo extra": todo lo que trabaja cuenta. Para
    // esos casos el detalle lista TODOS los turnos del mes (kind "all", que
    // ademas reporta las horas realmente trabajadas y no solo el excedente).
    const isReplacement = isReplacementReportProfile(profile.name);
    const rotativaType = String(getRotativa(profile.name)?.type || "")
        .trim()
        .toLowerCase();
    const showsAllShifts = !isReplacement &&
        !getShiftAssigned(profile.name, monthDate) &&
        (rotativaType === "3turno" || rotativaType === "4turno");
    const detailKind = isReplacement
        ? "replacement"
        : showsAllShifts
            ? "all"
            : "extra-only";
    const extraShifts = buildDayRows(profile, year, month, days, holidays, detailKind)
        .map(row => ({
            iso: row.iso,
            turno: row.turnoRealizado || row.turnoExtra || "",
            d: num(row.horasDiurnas),
            n: num(row.horasNocturnas),
            full: Boolean(row.esCompleto),
            partial: Boolean(row.esParcial),
            backing: String(row.respaldo || "")
        }))
        .filter(item => item.d + item.n > 0.001);
    // Una sola fuente para el total del mes: el motor de horas. Antes, en los
    // perfiles "extra-only" se recalculaba sumando el detalle de turnos, que no
    // arrastra los descuentos por marcaje que no caben en el dia; la tarjeta de
    // la PWA quedaba por encima del timeline y del reporte.
    const reportHheeDiurnas = num(stats.hheeDiurnas);
    const reportHheeNocturnas = num(stats.hheeNocturnas);
    const reportNetDiurnas = num(model.totalD);
    const reportNetNocturnas = num(model.totalN);

    return {
        year,
        month,
        contractType: effectiveContractType,
        effectiveContractType,
        contractKind: contractKindForType(effectiveContractType),
        extraShifts,
        // Que representa extraShifts, para que la PWA titule la seccion sin
        // tener que reconstruir esta regla: "all" = todos los turnos del mes.
        detailScope: showsAllShifts ? "all" : "extra",
        rawDiurnas: num(model.rawDiurnas),
        rawNocturnas: num(model.rawNocturnas),
        carryInD: num(model.carryIn?.d),
        carryInN: num(model.carryIn?.n),
        carryOutD: num(model.carryOut?.d),
        carryOutN: num(model.carryOut?.n),
        netDiurnas: reportNetDiurnas,
        netNocturnas: reportNetNocturnas,
        // HH.EE autoritativas publicadas a la PWA. En perfiles con asignacion
        // de turno, el detalle extraShifts ya descuenta reducciones de marcaje
        // sobre turnos extra programados; usar stats.hhee* o rawDiurnas podia
        // dejar la tarjeta mensual distinta del detalle visible.
        hheeDiurnas: reportHheeDiurnas,
        hheeNocturnas: reportHheeNocturnas,
        returnTransfer: Boolean(model.stats?.returnTransferEnabled)
    };
}

// Resumen HHEE de los ultimos `monthsBack`+1 meses (incluye el mes actual).
export async function buildWorkerHheeSummaries(
    profile,
    monthsBack = 5,
    monthsForward = 0
) {
    if (!profile?.name) return [];

    const today = new Date();
    const months = [];

    for (let offset = monthsBack; offset >= 0; offset -= 1) {
        months.push(new Date(today.getFullYear(), today.getMonth() - offset, 1));
    }

    // Meses futuros: un turno extra o reemplazo cargado para el mes siguiente
    // tambien tiene que verse en HH.EE, no solo al llegar ese mes.
    for (let offset = 1; offset <= monthsForward; offset += 1) {
        months.push(new Date(today.getFullYear(), today.getMonth() + offset, 1));
    }

    const summaries = await Promise.all(
        months.map(monthDate => buildWorkerHheeMonthSummary(profile, monthDate))
    );

    return summaries.filter(Boolean);
}

export async function exportNoAssignmentShiftReport(
    profile,
    monthDate = new Date()
) {
    if (!profile?.name) {
        alert("Selecciona un trabajador para descargar el reporte.");
        return;
    }

    if (!isNoAssignmentShiftProfile(profile.name, monthDate)) {
        alert("Este reporte solo aplica para 3er o 4\u00b0 turno sin Asignaci\u00f3n de Turno.");
        return;
    }

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchReportHolidays(year);
    const data = getProfileData(profile.name);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        data,
        {},
        { d: 0, n: 0 }
    );
    const model = buildNoAssignmentReportModel({
        profile,
        monthDate,
        holidays,
        stats
    });
    const filename = `Reporte_turno_sin_asignacion_${safeFileName(profile.name)}_${year}-${String(month + 1).padStart(2, "0")}.xls`;

    downloadExcel(noAssignmentWorkbookHTML(model), filename);
}

export async function exportReplacementShiftReport(
    profile,
    monthDate = new Date()
) {
    if (!profile?.name) {
        alert("Selecciona un trabajador para descargar el reporte.");
        return;
    }

    if (!isReplacementReportProfile(profile.name)) {
        alert("Este reporte solo aplica para trabajadores con contrato Reemplazo.");
        return;
    }

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchReportHolidays(year);
    const data = getProfileData(profile.name);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        data,
        {},
        { d: 0, n: 0 }
    );
    const model = buildNoAssignmentReportModel({
        profile,
        monthDate,
        holidays,
        stats,
        contractOnly: true
    });
    const filename = `Reporte_reemplazo_${safeFileName(profile.name)}_${year}-${String(month + 1).padStart(2, "0")}.xls`;

    downloadExcel(noAssignmentWorkbookHTML(model), filename);
}

export async function exportAssignedShiftReport(
    profile,
    monthDate = new Date()
) {
    if (!profile?.name) {
        alert("Selecciona un trabajador para descargar el reporte.");
        return;
    }

    if (!isAssignedShiftReportProfile(profile.name, monthDate)) {
        alert("Este reporte solo aplica para 3er o 4\u00b0 turno con Asignaci\u00f3n de Turno.");
        return;
    }

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchReportHolidays(year);
    const data = getProfileData(profile.name);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        data,
        {},
        { d: 0, n: 0 }
    );
    const model = buildAssignedShiftReportModel({
        profile,
        monthDate,
        holidays,
        stats
    });
    const filename = `Reporte_turno_con_asignacion_${safeFileName(profile.name)}_${year}-${String(month + 1).padStart(2, "0")}.xls`;

    downloadExcel(assignedShiftWorkbookHTML(model), filename);
}

export async function exportDiurnoShiftReport(
    profile,
    monthDate = new Date()
) {
    if (!profile?.name) {
        alert("Selecciona un trabajador para descargar el reporte.");
        return;
    }

    if (!isDiurnoReportProfile(profile.name)) {
        alert("Este reporte solo aplica para trabajadores con rotativa Diurno.");
        return;
    }

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchReportHolidays(year);
    const data = getProfileData(profile.name);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        data,
        {},
        { d: 0, n: 0 }
    );
    const model = stats.mode === "aggregate"
        ? buildNoAssignmentReportModel({
            profile,
            monthDate,
            holidays,
            stats
        })
        : buildAssignedShiftReportModel({
            profile,
            monthDate,
            holidays,
            stats
        });
    const filename = `Reporte_diurno_${safeFileName(profile.name)}_${year}-${String(month + 1).padStart(2, "0")}.xls`;

    downloadExcel(
        stats.mode === "aggregate"
            ? noAssignmentWorkbookHTML(model)
            : assignedShiftWorkbookHTML(model),
        filename
    );
}

export async function exportHoursReport(profile, monthDate = new Date()) {
    if (!profile?.name) {
        alert("Selecciona un trabajador para imprimir el reporte.");
        return;
    }

    if (isReplacementReportProfile(profile.name)) {
        await exportReplacementShiftReport(profile, monthDate);
        return;
    }

    if (isDiurnoReportProfile(profile.name)) {
        await exportDiurnoShiftReport(profile, monthDate);
        return;
    }

    if (isNoAssignmentShiftProfile(profile.name, monthDate)) {
        await exportNoAssignmentShiftReport(profile, monthDate);
        return;
    }

    if (isAssignedShiftReportProfile(profile.name, monthDate)) {
        await exportAssignedShiftReport(profile, monthDate);
        return;
    }

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchHolidays(year);
    const data = getProfileData(profile.name);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        data,
        {},
        { d: 0, n: 0 }
    );
    const kind = reportKind(profile.name, monthDate);
    const dayRows = buildDayRows(
        profile,
        year,
        month,
        days,
        holidays,
        kind
    );
    const replacementRows = buildReplacementLogRows(
        profile.name,
        year,
        month,
        holidays
    );
    const swapRows = buildSwapRows(profile.name, year, month);
    const contractRows = kind === "replacement"
        ? buildContractRows(profile.name, year, month)
        : [];
    const html = buildWorkbookHTML({
        profile,
        monthDate,
        stats,
        dayRows,
        replacementRows,
        swapRows,
        contractRows
    });
    const filename = `HHEE_${safeFileName(profile.name)}_${year}-${String(month + 1).padStart(2, "0")}.xls`;

    downloadExcel(html, filename);
}
