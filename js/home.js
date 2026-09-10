// Home / "Inicio": resumen diario del supervisor. Vista de agregacion que
// reune modulos ya existentes (dotacion, ausencias, cambios, cobertura,
// mensajes). Este primer incremento cablea el saludo, la fecha, el nombre del
// supervisor (pie de firma) y la unidad; el resto de los widgets se muestran con
// datos de ejemplo y se cablearan a su modulo en los siguientes pasos.
//
// IMPORTANTE: todas las clases van con prefijo "hm-" para no colisionar con el
// CSS global del app (que ya usa .panel, .list, .count, .stat, etc.).

import { escapeHTML } from "./htmlUtils.js";
import { getCurrentFirebaseUser } from "./firebaseClient.js";
import {
    canEditAnyMenu,
    canEditMenu,
    canViewMenu,
    isWorkspaceOwner
} from "./workspacePermissions.js";
import {
    getAdminDisplayName,
    getReportSignatureConfig,
    getProfiles,
    isProfileActive,
    isNoCoverageDay,
    getRotativa,
    getShiftAssigned,
    getWorkerRequests
} from "./storage.js";
import { getJSON } from "./persistence.js";
import { keyFromDate, keyFromISO, isoFromKey } from "./dateUtils.js";
import { getTurnoBase, getTurnoReal } from "./turnEngine.js";
import {
    requiereReemplazoTurnoBase,
    getAbsenceType,
    esAusenciaInjustificada,
    restarTurnoCubierto,
    turnoExtraCubreTurno
} from "./rulesEngine.js";
import {
    cancelPreassignment,
    confirmPreassignment,
    getReplacementForCoveredShift,
    buildPendingRequestIndex,
    getPendingRequestsFromIndex
} from "./replacements.js";
import {
    getPreassignmentForCoveredShift,
    getPreassignments
} from "./preassignments.js";
import { refreshAll } from "./refresh.js";
import { updateDayCell, updateVisibleCalendarDays } from "./calendar.js";
import { updateTimelineCells } from "./timeline.js";
import {
    birthDateParts,
    getRotaGapShifts,
    showStaffingWeekFor
} from "./staffing.js";
import {
    cambiosDelMes,
    cambioEstaAnulado,
    deshacerCambioTurno,
    swapCodeLabel
} from "./swaps.js";
import { TURNO_LABEL, ESTAMENTO, TURNO } from "./constants.js";
import {
    canEditHomeTask,
    getHomeTasks,
    saveHomeTasks,
    deleteHomeTask,
    isTaskActiveOn,
    isTaskDoneOn,
    toggleTaskDone
} from "./homeTasks.js";
import {
    HOME_LAYOUT_EVENT,
    getHomeLayout,
    moveHomeCard,
    sameHomeLayout,
    saveHomeLayout
} from "./homeLayout.js";
import {
    enableHomeCardDrag,
    isHomeCardDragActive,
    withDragHandle
} from "./homeCardDrag.js";
import {
    homeTaskVisibilityBadge,
    homeTaskVisibilityLabel,
    isSharedHomeTask
} from "./homeSharedTasks.js";
import {
    acceptWorkerRequestById,
    rejectWorkerRequestById
} from "./workerRequests.js";
import { fetchHolidays, getCachedHolidays } from "./holidays.js";
// La misma definicion de dia habil que usa el resto del app (fin de semana o
// feriado), para que el calendario del modal no invente su propio criterio.
import { isBusinessDay } from "./calculations.js";
import { getActiveWorkspace } from "./workspaces.js";
import {
    affectsAttendanceIncidents,
    invalidateAttendanceIncidentIndex
} from "./attendanceIncidentIndex.js";
import {
    addDays as addScheduleDays,
    publishedWeeksOfMonth,
    weekHeading,
    weekStartMonday,
    weeklyScheduleBody
} from "./weeklySchedulePreview.js";
import { openAttachmentFile } from "./attachmentUtils.js";
import {
    goToTaskScheduleToday,
    taskScheduleHasAssignments,
    taskScheduleUpdatedAt
} from "./taskAssignments.js";
import {
    buildTaskAssignmentContext,
    getDayTaskAssignments
} from "./taskAssignmentProjection.js";
import {
    ATTENDANCE_INCIDENT_KINDS,
    attendanceIncidentContext,
    buildAttendanceIncidents
} from "./hoursReport.js";
import {
    MEDICAL_EQUIPMENT_KEY,
    medicalEquipmentCalendarEventsForRange,
    selectMedicalEquipment
} from "./medicalEquipment.js";
import {
    campaignStatusLabel,
    formatCoverageTimeLeft,
    getAutoCoverageAlerts,
    getAutoCoverageCampaigns,
    getCampaignRecipients
} from "./autoCoverage.js";

// Nombre por defecto para entornos que aun no tienen "Nombre del supervisor"
// cargado al crearse (entornos de prueba previos al requerimiento).
const SUPERVISOR_FALLBACK = "Cristian Morales";

const DIAS = [
    "Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"
];
const MESES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

// Las tareas se leen/guardan por usuario en Firestore (ver homeTasks.js).
const REPEAT_OPTS = [
    "Una sola vez", "Diario", "Diario Hábil", "Semanal", "Mensual",
    "Trimestral", "Cuatrimestral", "Anual"
];
const ALERT_OPTS = [
    "Sin alerta", "Al momento", "5 minutos antes", "15 minutos antes", "30 minutos antes", "1 hora antes"
];
// Con quien se comparte una tarea. Son las mismas opciones que tenian los
// recordatorios del resumen RRHH -de ahi vienen-, con la diferencia de que aca
// la primera y la de por defecto es "sólo yo": una tarea diaria es de quien la
// escribe mientras no diga lo contrario.
const VISIBILITY_OPTS = [
    ["private", "Sólo yo (sólo quien la crea)"],
    ["all", "Todos los usuarios administradores de la unidad"],
    ["workers", "Todos los trabajadores"],
    ...ESTAMENTO.map(estamento => [
        `estamento:${estamento}`,
        `Trabajadores: ${estamento}`
    ])
];
const REQUEST_LEAVE_TYPES = new Set([
    "",
    "admin",
    "half_admin_morning",
    "half_admin_afternoon",
    "legal",
    "comp",
    "union_leave",
    "unpaid_leave",
    "leave_cancel"
]);
const REQUEST_CLOCK_TYPES = new Set(["missing_clock", "clock_incident"]);
const REQUEST_TYPE_LABELS = {
    admin: "P. Administrativo",
    half_admin_morning: "1/2 ADM Mañana",
    half_admin_afternoon: "1/2 ADM Tarde",
    legal: "F. Legal",
    comp: "F. Compensatorio",
    union_leave: "Permiso Gremial",
    unpaid_leave: "Permiso sin Goce",
    leave_cancel: "Anulación de permiso",
    missing_clock: "Olvido de marcación",
    clock_incident: "Incidencia de marcaje",
    swap: "Cambio de turno",
    unknown: "Solicitud"
};
let editingTaskId = "";

function optionsHTML(opts, selected) {
    return opts.map(o => `<option ${o === selected ? "selected" : ""}>${esc(o)}</option>`).join("");
}

function visibilityOptionsHTML(selected = "private") {
    return VISIBILITY_OPTS
        .map(([value, label]) => `<option value="${esc(value)}"${
            value === selected ? " selected" : ""
        }>${esc(label)}</option>`)
        .join("");
}

function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Mes visible en la tarjeta de cumpleaños. Arranca en el actual y se mueve con
// las flechas; se conserva entre repintados del panel.
let birthdayYear = new Date().getFullYear();
let birthdayMonth = new Date().getMonth();

// Semana visible en el visor de programacion. Arranca en la de hoy.
let weeklyScheduleWeek = weekStartMonday(new Date());

// Calendario organizativo de tareas (se abre desde la fecha del encabezado).
let taskCalYear = new Date().getFullYear();
let taskCalMonth = new Date().getMonth();

// Mes visible en el mini calendario del inicio. Arranca en el actual, se mueve
// con sus flechas y se conserva entre repintados, como el de cumpleanos.
let miniCalYear = new Date().getFullYear();
let miniCalMonth = new Date().getMonth();

// Mes visible del calendario de ausencias (independiente del de tareas).
let absCalYear = new Date().getFullYear();
let absCalMonth = new Date().getMonth();
// Dia abierto en el detalle de ausencias.
let openAbsenceIso = "";

let coverageDetail = false;
let requestsDetail = false;
// Datos de cobertura calculados una vez por render (para no recalcular al
// alternar el switch de detalles).
let coverageData = { uncovered: [], preassigned: [] };

// Nombre para el saludo del inicio.
//
// Antes devolvia SIEMPRE la firma del supervisor, asi que un administrador
// invitado entraba y veia el nombre de otra persona. Ahora cada usuario ve el
// suyo: primero el nombre que el supervisor le puso en Ajustes, despues el de
// su propia cuenta, y solo el dueño de la unidad cae en la firma.
function getSupervisorName() {
    const user = getCurrentFirebaseUser();
    const asignado = getAdminDisplayName(user?.email);

    if (asignado) return asignado;

    if (!isWorkspaceOwner() && user) {
        const propio = String(user.displayName || "").trim();

        if (propio) return propio;
    }

    const line = String(getReportSignatureConfig().lines?.[0] || "").trim();

    return line || SUPERVISOR_FALLBACK;
}

function getUnitName() {
    return String(getActiveWorkspace()?.name || "tu unidad").trim() || "tu unidad";
}

// ---- Ausencias del día (datos reales) ----
// Categorias en orden de despliegue. tone e icon se resuelven en ausenciasWidget.
const ABSENCE_CATS = [
    { key: "legal", label: "Feriado Legal", tone: "crit", icon: "sun" },
    { key: "comp", label: "F. Compensatorio", tone: "good", icon: "palm" },
    { key: "admin", label: "P. Administrativo", tone: "info", icon: "file" },
    { key: "license", label: "Licencia Médica", tone: "info", icon: "file" },
    { key: "professional_license", label: "L.M. Profesional", tone: "info", icon: "file" },
    { key: "union_leave", label: "Permiso Gremial", tone: "good", icon: "palm" },
    { key: "unpaid_leave", label: "Permiso sin Goce", tone: "warn", icon: "file" },
    { key: "unjustified_absence", label: "Ausencia Injustificada", tone: "crit", icon: "alertTri" }
];

function profileMap(prefix, name) {
    return getJSON(`${prefix}_${name}`, {});
}

// Los cuatro mapas de ausencias de un perfil. Se leen UNA vez y se recorren por
// dia: el calendario del mes pregunta por 30 dias, y releerlos en cada uno
// multiplica por 30 el trabajo sin cambiar el resultado.
function absenceMapsFor(name) {
    return {
        legal: profileMap("legal", name),
        comp: profileMap("comp", name),
        admin: profileMap("admin", name),
        absences: profileMap("absences", name)
    };
}

// Clasifica la ausencia de un perfil en un dia a una de las categorias, o "".
function classifyAbsenceFrom(maps, keyDay) {
    if (maps.legal[keyDay]) return "legal";
    if (maps.comp[keyDay]) return "comp";
    if (maps.admin[keyDay]) return "admin";

    const absence = maps.absences[keyDay];
    if (!absence) return "";

    const type = getAbsenceType(absence);
    if (type === "professional_license") return "professional_license";
    if (type === "union_leave") return "union_leave";
    if (type === "unpaid_leave") return "unpaid_leave";
    if (type === "unjustified_absence" || esAusenciaInjustificada(absence)) {
        return "unjustified_absence";
    }
    return "license";
}

function classifyAbsence(name, keyDay) {
    return classifyAbsenceFrom(absenceMapsFor(name), keyDay);
}

// Un turno queda "sin cubrir": el turno base requiere reemplazo por la ausencia
// y no hay reemplazo activo, ni preasignacion, ni marca "no requiere cobertura".
// Misma logica que el badge "!" del calendario.
function isShiftUncovered(name, keyDay) {
    const admin = profileMap("admin", name);
    const legal = profileMap("legal", name);
    const comp = profileMap("comp", name);
    const absences = profileMap("absences", name);

    // Corto-circuito barato: sin ausencia ese dia no hay nada que cubrir.
    if (!admin[keyDay] && !legal[keyDay] && !comp[keyDay] && !absences[keyDay]) {
        return false;
    }

    const requires = requiereReemplazoTurnoBase(
        keyDay,
        getTurnoBase(name, keyDay),
        admin,
        legal,
        comp,
        absences,
        getRotativa(name).type
    );
    if (!requires) return false;

    return (
        !getReplacementForCoveredShift(name, keyDay) &&
        !getPreassignmentForCoveredShift(name, keyDay) &&
        !isNoCoverageDay(name, keyDay)
    );
}

function getTodayAbsences() {
    const keyDay = keyFromDate(new Date());
    const counts = {};

    getProfiles().forEach(profile => {
        if (!isProfileActive(profile)) return;

        const name = profile.name;
        const cat = classifyAbsence(name, keyDay);
        if (!cat) return;

        if (!counts[cat]) counts[cat] = { total: 0, uncovered: 0 };
        counts[cat].total += 1;
        if (isShiftUncovered(name, keyDay)) counts[cat].uncovered += 1;
    });

    return ABSENCE_CATS
        .filter(cat => counts[cat.key])
        .map(cat => ({ ...cat, ...counts[cat.key] }));
}

function getTodayAbsenceDetails(categoryKey) {
    const today = new Date();
    const keyDay = keyFromDate(today);
    const iso = isoFromKey(keyDay);
    const category = ABSENCE_CATS.find(cat => cat.key === categoryKey);

    if (!category) {
        return { category: null, rows: [], keyDay, iso, dateLabel: shortDateFromDate(today) };
    }

    const rows = getProfiles()
        .filter(isProfileActive)
        .map(profile => {
            const name = profile.name;
            if (classifyAbsence(name, keyDay) !== categoryKey) return null;

            const turno = Number(getTurnoBase(name, keyDay));
            const meta = [profile.estamento, profile.profession]
                .filter(Boolean)
                .join(" · ");
            const uncovered = isShiftUncovered(name, keyDay);

            return {
                name,
                meta: meta || "Sin estamento",
                keyDay,
                iso,
                dateLabel: shortDateFromDate(today),
                absenceLabel: absenceLabelForDay(name, keyDay) || category.label,
                turnoLabel: turno > 0 ? (TURNO_LABEL[turno] || "Turno") : "Libre",
                turnoClass: turnoCssClass(turno),
                uncovered
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, "es"));

    return { category, rows, keyDay, iso, dateLabel: shortDateFromDate(today) };
}

/* ---- Calendario de ausencias del mes ----

   El recuadro "Ausencias del dia" responde por HOY. Este calendario contesta la
   otra pregunta que se hace a diario: como viene el mes. Cada casilla lista las
   ausencias de ese dia y, en cada una, si el turno que se perdio era de dia o de
   noche -que es lo que decide a quien hay que llamar para cubrir-.
*/

// Si el turno ausente ocupaba el dia, la noche o ambos. Se decide con las mismas
// reglas de composicion del motor y no con una lista de turnos escrita a mano,
// para que un 24h o un D+N no queden clasificados a medias.
function absenceShiftKind(turno) {
    const code = Number(turno) || 0;

    if (!code) return "libre";

    const cubreNoche = turnoExtraCubreTurno(code, TURNO.NOCHE);
    const tieneDia = restarTurnoCubierto(code, TURNO.NOCHE) !== TURNO.LIBRE;

    if (cubreNoche && tieneDia) return "ambos";
    if (cubreNoche) return "noche";

    return "dia";
}

const ABSENCE_SHIFT_LABEL = {
    dia: "Día",
    noche: "Noche",
    ambos: "Día y noche",
    libre: "Libre"
};

export function absenceShiftLabel(kind) {
    return ABSENCE_SHIFT_LABEL[kind] || "";
}

/**
 * Las casillas del mes con las ausencias de cada dia. null = hueco antes del
 * dia 1, para que el 1 caiga en su columna (la semana parte el lunes).
 */
export function buildAbsenceCalendarCells(year, month) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    const cells = new Array(lead).fill(null);
    // Un perfil, una lectura de sus mapas para todo el mes.
    const perfiles = getProfiles()
        .filter(isProfileActive)
        .map(profile => ({
            profile,
            maps: absenceMapsFor(profile.name)
        }));

    for (let day = 1; day <= daysInMonth; day += 1) {
        const date = new Date(year, month, day);
        const keyDay = keyFromDate(date);
        const items = perfiles
            .map(({ profile, maps }) => {
                const categoria = classifyAbsenceFrom(maps, keyDay);

                if (!categoria) return null;

                const cat = ABSENCE_CATS.find(item => item.key === categoria);
                const turno = Number(getTurnoBase(profile.name, keyDay));

                return {
                    name: profile.name,
                    categoryKey: categoria,
                    label: absenceLabelForDay(profile.name, keyDay) ||
                        cat?.label ||
                        "Ausencia",
                    tone: cat?.tone || "info",
                    kind: absenceShiftKind(turno),
                    turnoLabel: turno > 0
                        ? (TURNO_LABEL[turno] || "Turno")
                        : "Libre"
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.name.localeCompare(b.name, "es"));

        cells.push({
            day,
            iso: isoFromDate(date),
            keyDay,
            items
        });
    }

    return cells;
}

// ---- Cambios de turno (datos reales) ----
const MESES_ABR = [
    "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"
];
const DIAS_ABR = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function formatShortDate(iso) {
    const parts = String(iso || "").split("-");
    if (parts.length !== 3) return String(iso || "");
    const day = Number(parts[2]);
    const monthIndex = Number(parts[1]) - 1;
    return `${day} ${MESES_ABR[monthIndex] || ""}`.trim();
}

function formatSwapDetailDate(iso) {
    const parts = String(iso || "").split("-");

    if (parts.length !== 3) return String(iso || "");

    const day = Number(parts[2]);
    const monthIndex = Number(parts[1]) - 1;
    const year = Number(parts[0]);

    return [day, MESES_ABR[monthIndex], year]
        .filter(Boolean)
        .join(" ");
}

function shortName(full) {
    return String(full || "").split(/\s+/).filter(Boolean).slice(0, 2).join(" ");
}

function homeSwapTurnLabel(turno) {
    const numeric = Number(turno);

    return TURNO_LABEL[numeric] || swapCodeLabel(turno);
}

// Cambios de turno activos del mes en curso.
function getMonthSwaps() {
    const now = new Date();
    return cambiosDelMes(now.getFullYear(), now.getMonth())
        .filter(swap => !cambioEstaAnulado(swap));
}

// ---- Dotación en servicio hoy, por estamento (datos reales) ----
// Un perfil está "en servicio hoy" si tiene turno real (> Libre) y no está de
// ausencia/permiso hoy. Los reemplazos ya vienen incluidos en getTurnoReal.
// ---- Horario (entrada/salida) por trabajador en servicio hoy ----
function pad2(n) { return String(n).padStart(2, "0"); }
function hm(h, m = 0) { return `${pad2(h)}:${pad2(m)}`; }

// Horario estándar según el turno del día. El fin del Diurno depende del día
// (viernes 16:00, resto 17:00). Devuelve { dia, noche } con etiquetas o null.
function standardSchedule(base, date) {
    const diurnoEnd = date.getDay() === 5 ? 16 : 17;
    switch (base) {
        case TURNO.LARGA:        return { dia: "08:00 a 20:00", noche: null };
        case TURNO.NOCHE:        return { dia: null, noche: "20:00 a 08:00" };
        case TURNO.TURNO24:      return { dia: "08:00 a 20:00", noche: "20:00 a 08:00" };
        case TURNO.DIURNO:       return { dia: `08:00 a ${hm(diurnoEnd)}`, noche: null };
        case TURNO.DIURNO_NOCHE: return { dia: `08:00 a ${hm(diurnoEnd)}`, noche: "20:00 a 08:00" };
        case TURNO.MEDIA_MANANA: return { dia: "08:00 a 14:00", noche: null };
        case TURNO.MEDIA_TARDE:  return { dia: "14:00 a 20:00", noche: null };
        case TURNO.TURNO18:      return { dia: "14:00 a 20:00", noche: "20:00 a 08:00" };
        default:                 return { dia: null, noche: null };
    }
}

// Horario con 1/2 ADM (permiso parcial administrativo), según reglas de RRHH:
// - 1/2 ADM Mañana (0.5M): el trabajador entra más tarde y trabaja la tarde.
//     · con asignación de turno: 14:00 a 20:00.
//     · sin asignación: entra 12:30 (viernes 12:00); sale 20:00 si es Larga,
//       o 17:00 (viernes 16:00) si es Diurno.
// - 1/2 ADM Tarde (0.5T): trabaja la mañana y se retira antes.
//     · con asignación de turno: 08:00 a 14:00.
//     · sin asignación: 08:00 a 12:30.
function halfAdminSchedule(base, half, date, assigned) {
    const friday = date.getDay() === 5;

    if (half === "0.5M") {
        if (assigned) return { dia: "14:00 a 20:00", noche: null };
        const entry = friday ? "12:00" : "12:30";
        const exit = base === TURNO.LARGA
            ? "20:00"
            : (friday ? "16:00" : "17:00");
        return { dia: `${entry} a ${exit}`, noche: null };
    }

    // 0.5T
    if (assigned) return { dia: "08:00 a 14:00", noche: null };
    return { dia: "08:00 a 12:30", noche: null };
}

// Horario real de un trabajador hoy, o null si no está en servicio (libre o con
// ausencia/permiso completo). El 1/2 ADM se considera media jornada trabajada.
function serviceScheduleToday(profile, keyDay, date) {
    const name = profile.name;

    if (profileMap("legal", name)[keyDay]) return null;
    if (profileMap("comp", name)[keyDay]) return null;
    if (profileMap("absences", name)[keyDay]) return null;

    const adminVal = profileMap("admin", name)[keyDay];
    const half = (adminVal === "0.5M" || adminVal === "0.5T") ? adminVal : null;
    if (adminVal && !half) return null; // administrativo completo → libre

    const base = Number(getTurnoReal(name, keyDay));
    if (base <= 0) return null;

    const sched = half
        ? halfAdminSchedule(base, half, date, getShiftAssigned(name))
        : standardSchedule(base, date);

    return (sched.dia || sched.noche) ? sched : null;
}

// Minutos desde medianoche de un "HH:MM". Sirve para ordenar por tramo horario
// sin depender del texto.
function serviceTimeMinutes(value) {
    const [hours, minutes] = String(value || "").split(":").map(Number);

    return Number.isFinite(hours)
        ? hours * 60 + (Number(minutes) || 0)
        : 0;
}

// Orden de la lista de un turno: PRIMERO agrupa a quienes entran y salen a la
// misma hora, y dentro de cada grupo va alfabetico.
//
// Antes era solo alfabetico y los horarios quedaban entreverados: en el turno de
// dia se mezclaba quien sale a las 20:00 con quien sale a las 17:00, y no se
// podia ver de un vistazo cuanta gente cubre la tarde.
//
// Los grupos van por hora de ENTRADA ascendente y, a igual entrada, por hora de
// SALIDA descendente: la jornada mas larga primero. Asi en el turno de dia
// quedan arriba los de 08:00 a 20:00 y al final los de 08:00 a 17:00 (16:00 los
// viernes). En el de noche todos comparten "20:00 a 08:00", asi que el desempate
// alfabetico es el unico que se aplica.
function compareServiceRows(a, b) {
    const [entryA = "", exitA = ""] = String(a.time || "").split(" a ");
    const [entryB = "", exitB = ""] = String(b.time || "").split(" a ");

    return (
        serviceTimeMinutes(entryA) - serviceTimeMinutes(entryB) ||
        serviceTimeMinutes(exitB) - serviceTimeMinutes(exitA) ||
        a.name.localeCompare(b.name)
    );
}

// Detalle de dotación por estamento: listas de trabajadores de día y de noche
// (con su horario). Un mismo trabajador puede aparecer en ambos (24h/D+N/18h).
//
// El dia es un parametro y no "hoy" fijo porque el modal de dotacion se mueve
// con flechas y con un calendario: la misma cuenta sirve para cualquier fecha.
export function getDotacionDetalle(date = new Date()) {
    const keyDay = keyFromDate(date);
    const byEstamento = {};
    // Una sola lectura del catalogo de tareas para todo el dia, en vez de una
    // por trabajador.
    const taskContext = buildTaskAssignmentContext();

    getProfiles().forEach(profile => {
        if (!isProfileActive(profile)) return;
        const sched = serviceScheduleToday(profile, keyDay, date);
        if (!sched) return;

        // Las tareas del dia se reparten por turno: las diurnas acompanan al
        // trabajador en la columna de dia y las nocturnas en la de noche. Una
        // tarea "both" -la misma tarea en los dos turnos- va en las dos.
        const tareas = getDayTaskAssignments(profile.name, keyDay, taskContext);
        const tareasDe = turno => tareas
            .filter(item => item.shift === turno || item.shift === "both")
            .map(item => item.title);

        const est = profile.estamento || "Otros";
        if (!byEstamento[est]) byEstamento[est] = { dia: [], noche: [] };
        if (sched.dia) {
            byEstamento[est].dia.push({
                name: profile.name,
                time: sched.dia,
                tasks: tareasDe("day")
            });
        }
        if (sched.noche) {
            byEstamento[est].noche.push({
                name: profile.name,
                time: sched.noche,
                tasks: tareasDe("night")
            });
        }
    });

    const canonicalOrder = est => {
        const index = ESTAMENTO.indexOf(est);
        return index === -1 ? ESTAMENTO.length : index;
    };
    const estamentos = Object.keys(byEstamento)
        .sort((a, b) => canonicalOrder(a) - canonicalOrder(b) || a.localeCompare(b));

    estamentos.forEach(est => {
        byEstamento[est].dia.sort(compareServiceRows);
        byEstamento[est].noche.sort(compareServiceRows);
    });

    return { byEstamento, estamentos };
}

// Conteos por estamento (día/noche) derivados del detalle, para las stat cards.
function getDotacionHoy() {
    const det = getDotacionDetalle();
    const byEstamento = {};
    let total = 0;
    let dia = 0;
    let noche = 0;

    det.estamentos.forEach(est => {
        const e = det.byEstamento[est];
        byEstamento[est] = { dia: e.dia.length, noche: e.noche.length };
        dia += e.dia.length;
        noche += e.noche.length;
        const unique = new Set([
            ...e.dia.map(x => x.name),
            ...e.noche.map(x => x.name)
        ]);
        total += unique.size;
    });

    return { byEstamento, estamentos: det.estamentos, total, dia, noche };
}

// ---- Cobertura de turnos (datos reales) ----
const COVERAGE_WINDOW_DAYS = 14;   // ventana hacia adelante para turnos sin cubrir
const COVERAGE_MAX_ROWS = 8;

function shortDateFromDate(date) {
    return `${DIAS_ABR[date.getDay()]} ${date.getDate()} ${MESES_ABR[date.getMonth()]}`;
}

function shortDateFromISO(iso) {
    const parts = String(iso || "").split("-");
    if (parts.length !== 3) return String(iso || "");
    return shortDateFromDate(
        new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
    );
}

function turnoCssClass(code) {
    switch (Number(code)) {
        case 1: return "larga";
        case 2: return "noche";
        case 3: return "noche";
        case 4: return "diurno";
        case 5: return "noche";
        case 6: return "media-m";
        case 7: return "media-t";
        case 8: return "noche";
        default: return "larga";
    }
}

function absenceLabelForDay(name, keyDay) {
    const cat = classifyAbsence(name, keyDay);
    return ABSENCE_CATS.find(c => c.key === cat)?.label || "";
}

// Colegas del mismo estamento (y profesion) libres ese dia y sin ausencia.
// Heuristica de disponibilidad (la compatibilidad fina de 24h/contrato vive en
// el modal de reemplazo del calendario).
function getAvailableCandidates(replacedProfile, keyDay) {
    const estamento = replacedProfile.estamento;
    const profession = replacedProfile.profession;

    return getProfiles()
        .filter(candidate =>
            isProfileActive(candidate) &&
            candidate.name !== replacedProfile.name &&
            candidate.estamento === estamento &&
            (!profession || candidate.profession === profession) &&
            Number(getTurnoReal(candidate.name, keyDay)) === 0 &&
            !classifyAbsence(candidate.name, keyDay)
        )
        .map(candidate => candidate.name);
}

function getUncoveredShifts() {
    const today = new Date();
    const profiles = getProfiles().filter(isProfileActive);
    const rows = [];
    // Una sola pasada para toda la ventana de cobertura.
    const pendingRequestIndex = buildPendingRequestIndex();
    // Igual que el indice de solicitudes: preguntar campaña por campaña
    // releeria el almacen una vez por casilla de la ventana de 14 dias.
    const campaignIndex = new Map(
        getAutoCoverageCampaigns()
            .filter(campaign => campaign.status === "active")
            .map(campaign => [
                `${campaign.replaced}|${campaign.keyDay}`,
                campaign
            ])
    );

    for (let offset = 0; offset < COVERAGE_WINDOW_DAYS; offset++) {
        const date = new Date(
            today.getFullYear(),
            today.getMonth(),
            today.getDate() + offset
        );
        const keyDay = keyFromDate(date);

        for (const profile of profiles) {
            if (!isShiftUncovered(profile.name, keyDay)) continue;

            const turno = Number(getTurnoBase(profile.name, keyDay));
            rows.push({
                dateLabel: shortDateFromDate(date),
                turnoLabel: TURNO_LABEL[turno] || "Turno",
                turnoClass: turnoCssClass(turno),
                origin: profile.name,
                // Para "Ver en calendario" y "Cobertura automatica".
                keyDay,
                iso: isoFromKey(keyDay),
                reason: absenceLabelForDay(profile.name, keyDay),
                candidates: getAvailableCandidates(profile, keyDay).slice(0, 3),
                // Solicitudes ya enviadas a las PWA: el turno pasa de "sin
                // cubrir" a "en espera".
                pendingRequests: getPendingRequestsFromIndex(
                    pendingRequestIndex,
                    profile.name,
                    isoFromKey(keyDay)
                ),
                // Campaña de cobertura automatica en curso, si la hay: es lo
                // que convierte el boton en "en curso" y explica en que etapa
                // va el envio.
                campaign: campaignIndex.get(`${profile.name}|${keyDay}`) || null
            });

            if (rows.length >= COVERAGE_MAX_ROWS) return rows;
        }
    }

    return rows;
}

function getPreassignedShifts() {
    return getPreassignments()
        .slice()
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map(record => ({
            dateLabel: shortDateFromISO(record.date),
            turnoLabel: TURNO_LABEL[Number(record.turno)] || "Turno",
            turnoClass: turnoCssClass(record.turno),
            id: record.id,
            origin: record.replaced,
            reason: record.absenceType || "",
            assigned: record.worker
        }));
}

function getCoverageData() {
    return {
        uncovered: getUncoveredShifts(),
        preassigned: getPreassignedShifts()
    };
}

function todayLabel() {
    const d = new Date();
    return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

function esc(value) {
    return escapeHTML(String(value));
}

// ---- SVG helpers (stroke-based, al estilo de los iconos del app) ----
const IC = {
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    clipboard: '<path d="M9 5h6M9 5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2M12 11v4M12 8h.01"/>',
    checkClip: '<path d="M9 11l2 2 4-4"/><rect x="3" y="4" width="18" height="17" rx="2"/>',
    swap: '<path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4"/>',
    shield: '<path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    bars: '<path d="M4 19V9M10 19V4M16 19v-6M20 19H2"/>',
    megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1v.17a2 2 0 1 1-4 0V21a1.7 1.7 0 0 0-1.4-1.6 1.7 1.7 0 0 0-1 .34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1H2.83a2 2 0 1 1 0-4H3a1.7 1.7 0 0 0 1.6-1.4 1.7 1.7 0 0 0-.34-1l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 4V2.83a2 2 0 1 1 4 0V3a1.7 1.7 0 0 0 1.6 1.4 1.7 1.7 0 0 0 1-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14.5h18M9 9v11M15 9v11"/>',
    phone: '<rect x="5" y="2" width="14" height="20" rx="2.8"/><path d="M10.6 4.7h2.8"/><rect x="7.4" y="6.7" width="9.2" height="10.2" rx="1"/><circle cx="12" cy="19.6" r="1.15"/>',
    cake: '<path d="M4 21h16v-7a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3z"/><path d="M4 16c1.5 1 2.5 1 4 0s2.5-1 4 0 2.5 1 4 0 2.5-1 4 0"/><path d="M12 8V5M9 8V6M15 8V6"/>',
    palm: '<path d="M12 2a7 7 0 0 1 7 7c0 4-7 13-7 13S5 13 5 9a7 7 0 0 1 7-7z"/>',
    sun: '<path d="M17 8c0-3-2-5-5-5S7 5 7 8c0 6-3 8-3 8h16s-3-2-3-8"/><path d="M12 3V1"/>',
    file: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 8v6M9 11h6"/>',
    alertTri: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'
};

function svg(paths, extra = "") {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra}>${paths}</svg>`;
}

const DN_SUN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>`;
const DN_MOON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>`;

function statCard(tone, icon, label, value, sub) {
    return `
        <article class="hm-stat hm-stat--${tone}">
            <span class="hm-stat-icon">${svg(icon)}</span>
            <div class="hm-stat-label">${esc(label)}</div>
            <div class="hm-stat-value">${value}</div>
            <div class="hm-stat-sub">${esc(sub)}</div>
            <span class="hm-stat-go">${svg(IC.arrowRight, 'stroke-width="2.4"')}</span>
        </article>`;
}

// Tarjeta de dotación por estamento: muestra cuántos hay de día y de noche
// (sin total). Los turnos que cubren ambos periodos suman en los dos.
function dotacionCard(tone, label, dia, noche) {
    return `
        <article class="hm-stat hm-stat--${tone}" data-hm="dotacion" data-est="${esc(label)}" role="button" tabindex="0" title="Ver trabajadores en servicio">
            <span class="hm-stat-icon">${svg(IC.users)}</span>
            <div class="hm-stat-label">${esc(label)}</div>
            <div class="hm-dn2">
                <div class="hm-dn2-item">
                    <span class="hm-dn2-ico">${DN_SUN}</span>
                    <div class="hm-dn2-txt"><b>${dia}</b><small>de día</small></div>
                </div>
                <div class="hm-dn2-item">
                    <span class="hm-dn2-ico">${DN_MOON}</span>
                    <div class="hm-dn2-txt"><b>${noche}</b><small>de noche</small></div>
                </div>
            </div>
            <span class="hm-stat-go">${svg(IC.arrowRight, 'stroke-width="2.4"')}</span>
        </article>`;
}

/**
 * Semanas con programacion: la actual y la siguiente.
 *
 * Devuelve solo las que tienen tareas repartidas. Si la lista queda vacia no
 * hay nada que mostrar, y el widget no se dibuja.
 */
function programacionSemanas() {
    const estaSemana = weekStartMonday(new Date());

    return [
        { label: "Esta semana", start: estaSemana },
        { label: "Próxima semana", start: addScheduleDays(estaSemana, 7) }
    ]
        .map(semana => {
            // La condicion es TENER TAREAS, no tener fecha de edicion: la marca
            // solo existe desde que se empezo a escribir, y condicionar el
            // widget a ella dejaba invisible toda la programacion anterior.
            if (!taskScheduleHasAssignments(semana.start)) return null;

            return {
                label: semana.label,
                ...actualizacion(taskScheduleUpdatedAt(semana.start))
            };
        })
        .filter(Boolean);
}

/**
 * Cuando se actualizo por ultima vez esa programacion. La fecha va en la
 * tarjeta y la hora exacta en el title, para no apretar la tarjeta.
 */
function actualizacion(updatedAtISO) {
    const fecha = new Date(updatedAtISO || "");

    if (Number.isNaN(fecha.getTime())) {
        return { fecha: "sin fecha", exacta: "Sin fecha de actualización" };
    }

    return {
        fecha: fecha.toLocaleDateString("es-CL", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }),
        exacta: `Actualizada el ${fecha.toLocaleString("es-CL", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        })}`
    };
}

/**
 * Widget de programacion semanal. Reemplaza al boton del encabezado y solo
 * aparece cuando hay alguna semana publicada: sin nada adjunto, un acceso que
 * lleva a una pantalla vacia solo estorba.
 */
function programacionWidget() {
    const semanas = programacionSemanas();

    if (!semanas.length) return "";

    return `
        <article class="hm-stat hm-stat--teal" data-hm="open-weekly" role="button"
            tabindex="0" title="Ver la programación semanal publicada">
            <span class="hm-stat-icon">${svg(IC.table)}</span>
            <div class="hm-stat-label">Programación semanal</div>
            <div class="hm-weeks">
                ${semanas.map(semana => `
                    <div class="hm-week" title="${esc(semana.exacta)}">
                        <b>${esc(semana.label)}</b>
                        <small>${esc(semana.fecha)}</small>
                    </div>`).join("")}
            </div>
            <span class="hm-stat-go">${svg(IC.arrowRight, 'stroke-width="2.4"')}</span>
        </article>`;
}

/**
 * Recordatorios de RRHH que rotan en el inicio.
 *
 * Son las reglas que mas se preguntan y que no estan a la vista en ninguna
 * pantalla: el orden de FC y FL, en que dias se puede pedir cada permiso, y a
 * que hora entra quien pide medio administrativo.
 */
const NOTAS_RRHH = [
    "💡 Recuerda: el orden recomendado es FC primero y luego FL.",
    "⏳ Si solicitas FL primero, deberán pasar 90 días desde el último FL para poder solicitar FC.",
    "⏰ Los atrasos solo se miden en los turnos base, no en los turnos extra.",
    "🚫 Si un funcionario solicita un PA, no puede hacer ningún turno ese día, ni siquiera noche.",
    "📅 Los funcionarios sin asignación de turno no pueden solicitar PA en días inhábiles.",
    "📦 Los FC se pueden acumular por razones de buen servicio.",
    "🗓️ Si acumulas los FC, deberás tomar el bloque completo al año siguiente: los 20 días continuos.",
    "🔟 Cada año hay que reservar un bloque de 10 FL continuos; el resto se puede parcializar.",
    "❌ No se puede pedir un FL en un día inhábil.",
    "▶️ Los FL y los FC deben comenzar siempre en un día hábil.",
    "✅ Los PA sí pueden pedirse en días inhábiles, siempre que el funcionario tenga asignación de turno.",
    "🕛 Los 1/2 PA de mañana permiten que el funcionario ingrese a la mitad de su jornada.",
    "🕧 Un funcionario diurno que pide 1/2 PA mañana marca su entrada a las 12:30 (12:00 los viernes).",
    "🕑 Un funcionario de turno que pide 1/2 PA mañana marca su entrada a las 14:00."
];

// Lo justo para leer la nota mas larga sin quedarse esperando la siguiente.
const NOTA_MS = 6000;

// El ciclo vive fuera del render: cada repintado reemplaza el panel entero, y
// un intervalo del render anterior se quedaria escribiendo en nodos ya sueltos.
let notasTimer = null;

/**
 * Arranca la rotacion de notas. Se detiene con el mouse encima, para poder
 * terminar de leer una nota larga sin que se escape.
 */
function iniciarNotas(panel) {
    if (notasTimer) {
        clearInterval(notasTimer);
        notasTimer = null;
    }

    const tarjeta = panel.querySelector('[data-hm="notas"]');
    const texto = tarjeta?.querySelector('[data-hm="nota"]');

    if (!tarjeta || !texto) return;

    let detenido = false;

    tarjeta.addEventListener("mouseenter", () => { detenido = true; });
    tarjeta.addEventListener("mouseleave", () => { detenido = false; });

    notasTimer = setInterval(() => {
        if (detenido || !texto.isConnected) return;

        const siguiente =
            (Number(tarjeta.dataset.index) + 1) % NOTAS_RRHH.length;

        tarjeta.dataset.index = String(siguiente);
        texto.classList.add("is-fading");

        window.setTimeout(() => {
            texto.textContent = NOTAS_RRHH[siguiente];
            texto.classList.remove("is-fading");
        }, 200);
    }, NOTA_MS);
}

function notasWidget() {
    // Arranca en una nota al azar: entrando y saliendo del inicio, empezar
    // siempre por la primera haria que las ultimas no se vieran nunca.
    const inicio = Math.floor(Math.random() * NOTAS_RRHH.length);

    return `
        <article class="hm-stat hm-stat--indigo hm-notas" data-hm="notas"
            data-index="${inicio}" title="Pasa el mouse para que no cambie">
            <span class="hm-stat-icon">${svg(IC.megaphone)}</span>
            <div class="hm-stat-label">¿Sabías que...?</div>
            <p class="hm-nota" data-hm="nota">${esc(NOTAS_RRHH[inicio])}</p>
        </article>`;
}

// Stat cards: una tarjeta por estamento en servicio hoy (colores en ciclo),
// y al final la programacion semanal si esta publicada.
function statsSection() {
    const dot = getDotacionHoy();
    const tones = ["violet", "blue", "green", "amber"];
    const dotacion = dot.estamentos.length
        ? dot.estamentos.map((est, i) => {
            const e = dot.byEstamento[est];
            return dotacionCard(tones[i % tones.length], est, e.dia, e.noche);
        }).join("")
        : statCard("violet", IC.users, "En servicio hoy", 0, "sin dotación hoy");

    return dotacion + programacionWidget() + notasWidget();
}

function panelHead(icon, title, extra = "") {
    return `
        <div class="hm-head">
            <span class="hm-head-icon">${svg(icon)}</span>
            <h3>${title}</h3>
            ${extra}
        </div>`;
}

// ---- Widgets ----
/**
 * Si este usuario puede crear, modificar o compartir tareas.
 *
 * Un miembro de solo lectura -el que no puede editar NINGUN menu de la unidad-
 * no las escribe: ve las que le compartieron y marca su propio visto, que es
 * suyo y vive en su documento. El inicio no tiene menu con permiso propio, asi
 * que la pregunta es "puede editar algo", que es la misma que hacen las reglas
 * para el modulo compartido.
 */
function canAuthorTasks() {
    return canEditAnyMenu();
}

// Las dos condiciones juntas: poder escribir en la unidad y, si la tarea es
// compartida, ser quien la creo. Es LA pregunta que hacen tanto el modal como
// los botones de guardar y eliminar.
function canModifyTask(task) {
    return canAuthorTasks() && canEditHomeTask(task);
}

// Marca de "esta tarea no es solo mia". Sin ella, una tarea de otro
// administrador se ve igual que una propia y no se entiende por que no se puede
// editar.
function taskShareBadgeHTML(task) {
    if (!isSharedHomeTask(task)) return "";

    const detail = canEditHomeTask(task)
        ? homeTaskVisibilityLabel(task.visibility)
        : `${homeTaskVisibilityLabel(task.visibility)} · la comparte ${taskAuthorName(task)}`;

    return `<span class="hm-task-share" title="${esc(detail)}">${
        esc(homeTaskVisibilityBadge(task.visibility))
    }</span>`;
}

function taskRowHTML(t) {
    const done = isTaskDoneOn(t, todayISO());
    return `
        <div class="hm-task ${done ? "is-done" : ""}" data-hm="task-row" data-id="${esc(t.id)}" role="button" tabindex="0" title="Modificar tarea">
            <button class="hm-task-check" type="button" data-hm="task-toggle" data-id="${esc(t.id)}" aria-pressed="${done ? "true" : "false"}" aria-label="Marcar como realizada">${svg(IC.check, 'stroke-width="3"')}</button>
            <span class="hm-task-name">${esc(t.name)}${taskShareBadgeHTML(t)}</span>
            <span class="hm-task-time">${esc(t.time)}</span>
        </div>`;
}

function tasksListHTML() {
    // Solo las de HOY: una tarea programada para el 27 no tiene nada que hacer
    // en el resumen del 20. Se filtra con la misma regla que usan el calendario
    // y las alertas, no con una comparacion propia.
    const tasks = getTasksForDay(new Date());

    if (!tasks.length) {
        return canAuthorTasks()
            ? `<div class="hm-empty">Sin tareas para hoy. Agrégalas con el botón + o revisa el calendario.</div>`
            : `<div class="hm-empty">Sin tareas para hoy.</div>`;
    }

    return tasks.map(taskRowHTML).join("");
}

function tareasWidget() {
    // Sin el boton no hay por donde agregar: al de solo lectura no se le ofrece
    // una accion que despues se le va a negar.
    const addBtn = canAuthorTasks()
        ? `<button class="hm-gear" type="button" data-hm="tasks-add" aria-label="Agregar tarea" title="Agregar tarea">${svg(IC.plus, 'stroke-width="2.4"')}</button>`
        : "";
    return `
        <div class="hm-card hm-col-4">
            ${panelHead(IC.checkClip, "Tareas diarias", addBtn)}
            <div class="hm-listcol hm-tasks-list hm-scroller" data-hm="tasks-list">${tasksListHTML()}</div>
        </div>`;
}

function requestTypeLabel(type) {
    return REQUEST_TYPE_LABELS[type] || REQUEST_TYPE_LABELS.unknown;
}

function requestSummaryGroup(request = {}) {
    const type = String(request.type || "");

    if (REQUEST_LEAVE_TYPES.has(type)) return "leave";
    if (type === "swap") return "swap";
    if (REQUEST_CLOCK_TYPES.has(type)) return "clock";

    return "";
}

export function buildRequestSummary(requests = getWorkerRequests()) {
    const summary = {
        leave: [],
        swap: [],
        clock: [],
        total: 0,
        pending: []
    };

    (Array.isArray(requests) ? requests : []).forEach(request => {
        if (request?.status !== "pending") return;

        const group = requestSummaryGroup(request);
        if (!group) return;

        summary[group].push(request);
        summary.pending.push({ ...request, group });
    });

    summary.pending.sort((a, b) =>
        String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    );
    summary.total = summary.pending.length;

    return summary;
}

function requestPrimaryDate(request = {}) {
    return (
        request.date ||
        request.changeDate ||
        request.fecha ||
        request.startDate ||
        request.returnDate ||
        request.devolucion ||
        ""
    );
}

function requestSummaryDateLabel(request = {}) {
    const iso = requestPrimaryDate(request);

    return iso ? shortDateFromISO(iso) : "Sin fecha";
}

function requestDocumentCount(request = {}) {
    const documents = Array.isArray(request.documents)
        ? request.documents
        : Array.isArray(request.attachments)
            ? request.attachments
            : [];

    return documents.length;
}

function requestSummaryMeta(request = {}) {
    const pieces = [];
    const date = requestPrimaryDate(request);

    if (date) pieces.push(`Fecha: ${shortDateFromISO(date)}`);
    if (request.endDate && request.endDate !== date) {
        pieces.push(`Hasta: ${shortDateFromISO(request.endDate)}`);
    }
    if (request.days) pieces.push(`${request.days} día(s)`);

    if (request.type === "swap") {
        const counterpart =
            request.to ||
            request.targetProfile ||
            request.counterpart ||
            request.receiver ||
            "";
        const returnDate =
            request.devolucion ||
            request.returnDate ||
            request.endDate ||
            "";

        if (counterpart) pieces.push(`Con: ${counterpart}`);
        if (returnDate) pieces.push(`Devuelve: ${shortDateFromISO(returnDate)}`);
    }

    if (REQUEST_CLOCK_TYPES.has(String(request.type || ""))) {
        const docs = requestDocumentCount(request);

        if (docs) pieces.push(`${docs} adjunto(s)`);
    }

    return pieces.join(" · ");
}

function requestSummaryChipHTML(tone, icon, count, label) {
    return `
        <div class="hm-req-chip hm-req-chip--${tone}">
            <span class="hm-req-chip-ico">${svg(icon)}</span>
            <span>
                <span class="hm-req-chip-num">${count}</span>
                <span class="hm-req-chip-lbl">${label}</span>
            </span>
        </div>`;
}

function requestSummaryRowHTML(request) {
    const groupLabel = request.group === "leave"
        ? "Permiso"
        : request.group === "swap"
            ? "Cambio"
            : "Marcaje";
    const meta = requestSummaryMeta(request);

    return `
        <div class="hm-req-row hm-req-row--${esc(request.group)}" data-request-id="${esc(request.id || "")}">
            <div class="hm-req-top">
                <span class="hm-req-type">${esc(groupLabel)}</span>
                <span class="hm-req-worker">${esc(request.profile || "Sin trabajador")}</span>
                <span class="hm-req-date">${esc(requestSummaryDateLabel(request))}</span>
            </div>
            <div class="hm-req-meta">
                <b>${esc(requestTypeLabel(request.type))}</b>${meta ? ` · ${esc(meta)}` : ""}
            </div>
            <div class="hm-cob-actions hm-req-row-actions">
                <button class="hm-cob-btn hm-cob-btn--confirm" type="button"
                    data-hm="req-accept" data-request-id="${esc(request.id || "")}">ACEPTAR</button>
                <button class="hm-cob-btn hm-cob-btn--cancel" type="button"
                    data-hm="req-reject" data-request-id="${esc(request.id || "")}">RECHAZAR</button>
            </div>
        </div>`;
}

function solicitudesWidget() {
    const summary = buildRequestSummary();
    const list = summary.pending.length
        ? summary.pending.map(requestSummaryRowHTML).join("")
        : `<div class="hm-empty">Sin solicitudes pendientes.</div>`;

    return `
        <div class="hm-card hm-col-4">
            ${panelHead(
                IC.megaphone,
                "Resumen de solicitudes",
                `<label class="hm-toggle hm-head-toggle"><input type="checkbox" data-hm="req-detail" ${requestsDetail ? "checked" : ""}> Ver detalles</label>
                <span class="hm-count">${summary.total}</span>`
            )}
            <div class="hm-req-summary" ${requestsDetail ? "hidden" : ""}>
                ${requestSummaryChipHTML("leave", IC.file, summary.leave.length, "Vacaciones / permisos")}
                ${requestSummaryChipHTML("swap", IC.swap, summary.swap.length, "Cambios de turno")}
                ${requestSummaryChipHTML("clock", IC.clock, summary.clock.length, "Incidencias marcaje")}
            </div>
            <div class="hm-req-list hm-scroller" ${requestsDetail ? "" : "hidden"}>
                ${list}
                <div class="hm-req-actions">
                    <button class="hm-cob-btn hm-cob-btn--ver" type="button" data-hm="req-open">REVISAR SOLICITUDES</button>
                </div>
            </div>
        </div>`;
}

/* =========================================================
   Calendario organizativo de tareas

   Se abre al hacer click en la fecha del encabezado ("Hoy es ..."). Pinta el mes
   con las tareas que caen en cada dia segun su recurrencia, usando la MISMA
   regla que dispara las alertas (isTaskActiveOn), para que el calendario y el
   aviso sonoro nunca digan cosas distintas.

   En una casilla no caben todas las tareas de un dia: se muestran las primeras
   y el resto queda como "+N mas". Al abrir el dia se ve el listado completo.
========================================================= */

// Cuantas tareas alcanzan a mostrarse dentro de una casilla.
const TASKS_PER_CELL = 3;

// La semana parte el lunes.
const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function getTasksForDay(date, tasks = getHomeTasks(), holidays) {
    return tasks
        .filter(task => isTaskActiveOn(task, date, holidays))
        .sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

function canViewMedicalEquipmentCalendarEvents() {
    return canViewMenu("medicalEquipment") && canEditMenu("medicalEquipment");
}

function calendarItemSortKey(item) {
    return String(item?.sortTime || item?.time || "");
}

function getMedicalEquipmentEventsForCalendarMonth(year, month) {
    if (!canViewMedicalEquipmentCalendarEvents()) return [];

    const first = isoFromDate(new Date(year, month, 1));
    const last = isoFromDate(new Date(year, month + 1, 0));

    return medicalEquipmentCalendarEventsForRange(first, last);
}

export function getTaskCalendarItemsForDay(
    date,
    tasks = getHomeTasks(),
    holidays,
    calendarEvents = []
) {
    const iso = isoFromDate(date);
    const events = (Array.isArray(calendarEvents) ? calendarEvents : [])
        .filter(item => item?.source === "medicalEquipment" && item.date === iso);

    return [...getTasksForDay(date, tasks, holidays), ...events]
        .sort((a, b) =>
            calendarItemSortKey(a).localeCompare(calendarItemSortKey(b)) ||
            String(a?.name || "").localeCompare(String(b?.name || ""), "es")
        );
}

// Las casillas del mes, con los blancos iniciales para que el dia 1 caiga en su
// columna. null = casilla vacia antes del dia 1.
// Nombre del feriado de un dia, o "" si no es feriado. Un feriado manual o de
// una cache vieja puede venir como `true`, sin nombre: igual cuenta. Lo usan
// el calendario de tareas y el mini calendario del inicio.
function holidayNameFor(holidays, year, month, day) {
    const holiday = holidays?.[`${year}-${month}-${day}`];

    if (!holiday) return "";

    return typeof holiday === "string" ? holiday : "Feriado";
}

export function buildTaskCalendarCells(
    year,
    month,
    tasks = getHomeTasks(),
    holidays = getCachedHolidays(year),
    calendarEvents = getMedicalEquipmentEventsForCalendarMonth(year, month)
) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // getDay() da 0 en domingo; con la semana en lunes, domingo es la columna 6.
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    const cells = new Array(lead).fill(null);

    for (let day = 1; day <= daysInMonth; day += 1) {
        const date = new Date(year, month, day);

        cells.push({
            day,
            iso: isoFromDate(date),
            isWeekend: date.getDay() === 0 || date.getDay() === 6,
            holiday: holidayNameFor(holidays, year, month, day),
            tasks: getTaskCalendarItemsForDay(date, tasks, holidays, calendarEvents)
        });
    }

    return cells;
}

function isoFromDate(date) {
    return `${date.getFullYear()}` +
        `-${String(date.getMonth() + 1).padStart(2, "0")}` +
        `-${String(date.getDate()).padStart(2, "0")}`;
}

function dateLabelFromISO(iso) {
    const [year, month, day] = String(iso).split("-").map(Number);
    const date = new Date(year, month - 1, day);

    return `${DIAS[date.getDay()]}, ${day} de ${MESES[month - 1]} de ${year}`;
}

function isMedicalEquipmentCalendarItem(item) {
    return item?.source === "medicalEquipment";
}

function taskChipHTML(task, iso) {
    if (isMedicalEquipmentCalendarItem(task)) {
        const detail = [task.time, task.name, task.detail]
            .filter(Boolean)
            .join(" · ");

        return `
        <span class="hm-tc-chip hm-tc-chip--medeq hm-tc-chip--${esc(task.tone || "equipment")}" title="${esc(detail)}">
            <b>${esc(task.time)}</b>${esc(task.name)}
        </span>`;
    }

    const done = isTaskDoneOn(task, iso);

    return `
        <span class="hm-tc-chip ${done ? "is-done" : ""}" title="${esc(`${task.time} · ${task.name}`)}">
            <b>${esc(task.time)}</b>${esc(task.name)}
        </span>`;
}

function taskCalendarCellHTML(cell, todayIso) {
    if (!cell) return `<div class="hm-tc-cell hm-tc-cell--blank"></div>`;

    const isToday = cell.iso === todayIso;
    const extra = cell.tasks.length - TASKS_PER_CELL;
    // Todos los dias reales se pueden abrir: aunque no tengan tareas, desde el
    // listado del dia se pueden crear nuevas con el boton +.
    const clickable = true;
    // Fin de semana y feriado se pintan igual: los dos son inhabiles. El nombre
    // del feriado va en el title.
    const nonWorking = cell.isWeekend || cell.holiday;
    const attrs = ` role="button" tabindex="0" data-hm="taskcal-day" data-iso="${esc(cell.iso)}"` +
        ` title="${esc(cell.holiday ? `${cell.holiday} · Abrir tareas del día` : "Abrir tareas del día")}"`;

    return `
        <div class="hm-tc-cell ${isToday ? "is-today" : ""} ${nonWorking ? "is-nonworking" : ""} ${clickable ? "is-clickable" : ""}"${attrs}>
            <span class="hm-tc-day">${cell.day}</span>
            <div class="hm-tc-chips">
                ${cell.tasks.slice(0, TASKS_PER_CELL).map(task => taskChipHTML(task, cell.iso)).join("")}
                ${extra > 0 ? `<span class="hm-tc-more">+${extra} más</span>` : ""}
            </div>
        </div>`;
}

function taskCalendarBody() {
    const cells = buildTaskCalendarCells(taskCalYear, taskCalMonth);
    const todayIso = todayISO();
    const total = cells.reduce(
        (sum, cell) => sum + (cell ? cell.tasks.length : 0),
        0
    );

    return {
        heading: `${MESES[taskCalMonth]} ${taskCalYear}`,
        total,
        grid: `
            ${DIAS_SEMANA.map((day, index) => `<div class="hm-tc-dow ${index >= 5 ? "is-weekend" : ""}">${day}</div>`).join("")}
            ${cells.map(cell => taskCalendarCellHTML(cell, todayIso)).join("")}`
    };
}

// Cuantas ausencias caben en una casilla del mes antes de resumir el resto.
const ABSENCES_PER_CELL = 3;

// Nombre corto para la casilla: nombre y primer apellido. El completo va en el
// title y en el listado del dia.
function shortWorkerName(name) {
    return String(name || "").trim().split(/\s+/).slice(0, 2).join(" ");
}

const ABSENCE_KIND_MARK = {
    dia: "D",
    noche: "N",
    ambos: "DN",
    libre: "L"
};

function absenceChipHTML(item) {
    const detalle = `${item.name} · ${item.label} · ${absenceShiftLabel(item.kind)}`;

    return `
        <span class="hm-ac-chip hm-ac-chip--${esc(item.kind)}" title="${esc(detalle)}">
            <b>${esc(ABSENCE_KIND_MARK[item.kind] || "")}</b>
            <span>${esc(shortWorkerName(item.name))}</span>
        </span>`;
}

function absenceCalendarCellHTML(cell, todayIso) {
    if (!cell) return `<div class="hm-tc-cell hm-tc-cell--blank"></div>`;

    const extra = cell.items.length - ABSENCES_PER_CELL;
    const abrible = cell.items.length > 0;

    return `
        <div class="hm-tc-cell ${cell.iso === todayIso ? "is-today" : ""} ${
            abrible ? "is-clickable" : ""
        }"${
            abrible
                ? ` role="button" tabindex="0" data-hm="abscal-day" data-iso="${esc(cell.iso)}" title="Ver las ausencias del día"`
                : ""
        }>
            <span class="hm-tc-day">${cell.day}</span>
            <div class="hm-tc-chips">
                ${cell.items.slice(0, ABSENCES_PER_CELL).map(absenceChipHTML).join("")}
                ${extra > 0 ? `<span class="hm-tc-more">+${extra} más</span>` : ""}
            </div>
        </div>`;
}

function absenceCalendarBody() {
    const cells = buildAbsenceCalendarCells(absCalYear, absCalMonth);
    const todayIso = todayISO();
    const total = cells.reduce(
        (sum, cell) => sum + (cell ? cell.items.length : 0),
        0
    );

    return {
        heading: `${MESES[absCalMonth]} ${absCalYear}`,
        total,
        grid: `
            ${DIAS_SEMANA.map(day => `<div class="hm-tc-dow">${day}</div>`).join("")}
            ${cells.map(cell => absenceCalendarCellHTML(cell, todayIso)).join("")}`
    };
}

function absenceCalendarModal() {
    const { heading, total, grid } = absenceCalendarBody();

    return `
        <div class="hm-modal-backdrop" data-hm="abscal-modal" hidden>
            <div class="hm-modal hm-modal--taskcal" role="dialog" aria-modal="true" aria-label="Calendario de ausencias">
                <div class="hm-modal-head">
                    <span class="hm-modal-ico">${svg(IC.users)}</span>
                    <h3>Ausencias · <span data-hm="ac-month">${esc(heading)}</span></h3>
                    <div class="hm-bday-nav">
                        <button type="button" data-hm="ac-prev" aria-label="Mes anterior">&#8249;</button>
                        <button type="button" data-hm="ac-next" aria-label="Mes siguiente">&#8250;</button>
                    </div>
                    <span class="hm-count" data-hm="ac-count">${total}</span>
                    <button class="hm-modal-close" type="button" data-hm="close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="hm-modal-body">
                    <div class="hm-ac-legend">
                        <span class="hm-ac-chip hm-ac-chip--dia"><b>D</b><span>Turno de día</span></span>
                        <span class="hm-ac-chip hm-ac-chip--noche"><b>N</b><span>Turno de noche</span></span>
                        <span class="hm-ac-chip hm-ac-chip--ambos"><b>DN</b><span>Día y noche</span></span>
                    </div>
                    <div class="hm-tc-grid" data-hm="ac-grid">${grid}</div>
                </div>
            </div>
        </div>`;
}

// Listado completo de un dia, para cuando las ausencias no caben en la casilla.
function dayAbsencesModal() {
    return `
        <div class="hm-modal-backdrop hm-modal-backdrop--over" data-hm="dayAbs-modal" hidden>
            <div class="hm-modal" role="dialog" aria-modal="true" aria-label="Ausencias del día">
                <div class="hm-modal-head">
                    <span class="hm-modal-ico">${svg(IC.users)}</span>
                    <h3 data-hm="da-title">Ausencias del día</h3>
                    <button class="hm-modal-close" type="button" data-hm="close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="hm-modal-body" data-hm="da-body"></div>
            </div>
        </div>`;
}

function renderDayAbsences(panel) {
    const modal = panel.querySelector('[data-hm="dayAbs-modal"]');

    if (!modal || !openAbsenceIso) return;

    const [year, month, day] = String(openAbsenceIso).split("-").map(Number);
    const cell = buildAbsenceCalendarCells(year, month - 1)
        .find(item => item && item.day === day);
    const items = cell?.items || [];

    modal.querySelector('[data-hm="da-title"]').textContent =
        dateLabelFromISO(openAbsenceIso);
    modal.querySelector('[data-hm="da-body"]').innerHTML = items.length
        ? `<div class="hm-listcol">${items.map(item => `
            <div class="hm-kv hm-kv--static">
                <span class="hm-kv-ico hm-${esc(item.tone)}">${svg(IC.user)}</span>
                <span class="hm-kv-name">
                    ${esc(item.name)}
                    <small>${esc(item.label)}</small>
                </span>
                <span class="hm-kv-right">
                    <span class="hm-ac-chip hm-ac-chip--${esc(item.kind)}">
                        <b>${esc(ABSENCE_KIND_MARK[item.kind] || "")}</b>
                        <span>${esc(absenceShiftLabel(item.kind))}</span>
                    </span>
                </span>
            </div>`).join("")}</div>`
        : `<div class="hm-empty">Sin ausencias este día.</div>`;
}

function openDayAbsences(panel, iso) {
    const modal = panel.querySelector('[data-hm="dayAbs-modal"]');

    if (!modal) return;

    openAbsenceIso = iso;
    renderDayAbsences(panel);
    modal.hidden = false;
}

function reRenderAbsenceCalendar(panel) {
    const modal = panel.querySelector('[data-hm="abscal-modal"]');

    if (!modal) return;

    const { heading, total, grid } = absenceCalendarBody();

    modal.querySelector('[data-hm="ac-month"]').textContent = heading;
    modal.querySelector('[data-hm="ac-count"]').textContent = total;
    modal.querySelector('[data-hm="ac-grid"]').innerHTML = grid;
}

function taskCalendarModal() {
    const { heading, total, grid } = taskCalendarBody();

    return `
        <div class="hm-modal-backdrop" data-hm="taskcal-modal" hidden>
            <div class="hm-modal hm-modal--taskcal" role="dialog" aria-modal="true" aria-label="Calendario de tareas">
                <div class="hm-modal-head">
                    <span class="hm-modal-ico">${svg(IC.calendar)}</span>
                    <h3>Calendario de tareas · <span data-hm="tc-month">${esc(heading)}</span></h3>
                    <div class="hm-bday-nav">
                        <button type="button" data-hm="tc-prev" aria-label="Mes anterior">&#8249;</button>
                        <button type="button" data-hm="tc-next" aria-label="Mes siguiente">&#8250;</button>
                    </div>
                    <span class="hm-count" data-hm="tc-count">${total}</span>
                    <button class="hm-modal-close" type="button" data-hm="close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="hm-modal-body">
                    <div class="hm-tc-grid" data-hm="tc-grid">${grid}</div>
                </div>
            </div>
        </div>`;
}

// Segundo modal: el listado completo de un dia, para cuando las tareas no caben
// en la casilla.
function dayTasksModal() {
    return `
        <div class="hm-modal-backdrop hm-modal-backdrop--over" data-hm="dayTasks-modal" hidden>
            <div class="hm-modal" role="dialog" aria-modal="true" aria-label="Tareas del día">
                <div class="hm-modal-head">
                    <span class="hm-modal-ico">${svg(IC.checkClip)}</span>
                    <h3 data-hm="dt-title">Tareas del día</h3>
                    ${canAuthorTasks() ? `<button class="hm-modal-action" type="button" data-hm="dt-add"
                        aria-label="Agregar tarea" title="Agregar tarea">${svg(IC.plus, 'stroke-width="2.4"')}</button>` : ""}
                    <button class="hm-modal-close" type="button" data-hm="close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="hm-modal-body" data-hm="dt-body"></div>
            </div>
        </div>`;
}

function dayMedicalEquipmentRowHTML(event) {
    const detail = event.detail
        ? `<small>${esc(event.detail)}</small>`
        : "";

    return `
        <div class="hm-dt-row hm-dt-row--medeq" data-hm="dt-medeq-row"
            data-equipment-id="${esc(event.equipmentId || "")}" role="button"
            tabindex="0" title="Ver en Equipos Médicos">
            <span class="hm-dt-time hm-dt-time--medeq">${esc(event.time)}</span>
            <span class="hm-dt-name">${esc(event.name)}${detail}</span>
            <span class="hm-dt-repeat hm-dt-repeat--medeq">Equipos Médicos</span>
        </div>`;
}

function dayTaskRowHTML(task, iso) {
    if (isMedicalEquipmentCalendarItem(task)) {
        return dayMedicalEquipmentRowHTML(task);
    }

    const done = isTaskDoneOn(task, iso);

    return `
        <div class="hm-dt-row ${done ? "is-done" : ""}" data-hm="dt-row" data-id="${esc(task.id)}"
            role="button" tabindex="0" title="Modificar tarea">
            <button class="hm-task-check" type="button" data-hm="dt-toggle" data-id="${esc(task.id)}"
                aria-pressed="${done ? "true" : "false"}" aria-label="Marcar como realizada">${svg(IC.check, 'stroke-width="3"')}</button>
            <span class="hm-dt-time">${esc(task.time)}</span>
            <span class="hm-dt-name">${esc(task.name)}${taskShareBadgeHTML(task)}</span>
            <span class="hm-dt-repeat">${esc(task.repeat)}</span>
        </div>`;
}

// El dia abierto en el listado. Al modificar o marcar una tarea hay que
// repintarlo, y el modal no guarda su propia fecha.
let openDayIso = "";

function renderDayTasks(panel) {
    const modal = panel.querySelector('[data-hm="dayTasks-modal"]');
    if (!modal || !openDayIso) return;

    const iso = openDayIso;
    const [year, month, day] = String(iso).split("-").map(Number);
    const calendarEvents = canViewMedicalEquipmentCalendarEvents()
        ? medicalEquipmentCalendarEventsForRange(iso, iso)
        : [];
    const tasks = getTaskCalendarItemsForDay(
        new Date(year, month - 1, day),
        getHomeTasks(),
        getCachedHolidays(year),
        calendarEvents
    );

    modal.querySelector('[data-hm="dt-title"]').textContent = dateLabelFromISO(iso);
    modal.querySelector('[data-hm="dt-body"]').innerHTML = tasks.length
        ? `<div class="hm-dt-list">${tasks.map(task => dayTaskRowHTML(task, iso)).join("")}</div>`
        : `<div class="hm-empty">Sin tareas para este día.</div>`;
}

function openDayTasks(panel, iso) {
    const modal = panel.querySelector('[data-hm="dayTasks-modal"]');
    if (!modal) return;

    openDayIso = iso;
    renderDayTasks(panel);
    modal.hidden = false;
}

// "Diario Hábil" depende de los feriados del año que se esta mirando, y la
// primera vez vienen de red. Se pinta con lo que haya en cache y se repinta al
// llegar, en vez de dejar el calendario esperando.
async function ensureHolidaysLoaded(year, onReady) {
    if (Object.keys(getCachedHolidays(year)).length) return;

    try {
        await fetchHolidays(year);
        onReady();
    } catch (error) {
        console.warn("No se pudieron cargar los feriados del calendario.", error);
    }
}

function reRenderTaskCalendar(panel) {
    const { heading, total, grid } = taskCalendarBody();
    const month = panel.querySelector('[data-hm="tc-month"]');
    const count = panel.querySelector('[data-hm="tc-count"]');
    const host = panel.querySelector('[data-hm="tc-grid"]');

    if (month) month.textContent = heading;
    if (count) count.textContent = total;
    if (host) host.innerHTML = grid;
}

/* =========================================================
   Incidencias de marcaje del mes
========================================================= */

// Mes que se esta mirando y lo ultimo calculado. Recorrer el mes de todos los
// trabajadores toma del orden de 100 ms con una unidad completa, asi que no se
// rehace en cada repintado del inicio: se calcula una vez por mes y se guarda.
let incidenciasMes = new Date();
let incidenciasCache = null;
let incidenciasRequest = 0;

// Claves cuyo cambio altera lo que cuenta como incidencia de marcaje. La lista
// se guarda calculada -tarda- pero estaba indexada SOLO por mes: una vez
// calculado un mes no se volvia a calcular pasara lo que pasara con los datos.
// Aplicar un cambio de turno dejaba al trabajador Libre ese dia y la incidencia
// seguia listada, porque el detalle se recalcula al abrirlo y la lista no.
/**
 * Tira la lista guardada de incidencias. La siguiente pintada la recalcula.
 */
export function invalidateAttendanceIncidents() {
    incidenciasCache = null;
}

if (typeof window !== "undefined") {
    const alCambiarEstado = event => {
        if (!affectsAttendanceIncidents(event.detail?.keys || [])) return;

        invalidateAttendanceIncidents();

        // Solo se repinta si el inicio esta a la vista; si no, ya se recalcula
        // al entrar.
        if (document.body?.dataset?.activeView === "home") {
            const panel = document.getElementById("homePanel");

            if (panel) void cargarIncidencias(panel);
        }
    };

    window.addEventListener("proturnos:persistenceChanged", alCambiarEstado);
    // Los cambios que llegan de otro supervisor entran por aqui.
    window.addEventListener("proturnos:firebaseAppState", event => {
        if (event.detail?.type !== "app-state-entries-applied") return;

        alCambiarEstado({ detail: { keys: event.detail.keys || [] } });
    });
}
// Lo que se esta listando en el modal, en el orden en que se ve: la fila
// abierta se ubica por su posicion en esta lista.
let incidenciasDetalle = [];

/**
 * Lo calculado deja de valer cuando cambian los datos de los que salio: las
 * marcas del reloj -que solo cambian al subir una planilla-, el marcaje
 * autorizado, que mueve la hora de ingreso y de salida, y los perfiles, porque
 * desactivar a alguien lo saca de la cuenta.
 */
if (typeof window !== "undefined") {
    [
        "proturnos:attendanceMarksChanged", "proturnos:clockMarksChanged",
        "proturnos:profilesSaved"
    ].forEach(evento => {
        window.addEventListener(evento, () => {
            incidenciasCache = null;

            const panel = document.getElementById("homePanel");

            if (panel && document.body.dataset.activeView === "home") {
                void cargarIncidencias(panel);
            }
        });
    });
}

function incidenciasMesLabel(date) {
    const texto = date.toLocaleDateString("es-CL", {
        month: "long",
        year: "numeric"
    });

    return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function incidenciasMesKey(date) {
    return `${date.getFullYear()}-${date.getMonth()}`;
}

/**
 * El mes tal como va DENTRO del titulo ("Incidencias de marcaje de Agosto").
 *
 * Es la misma forma que usan los cumpleanos, y ahorra la fila que antes
 * repetia el mes debajo del encabezado. El año solo aparece cuando no es el
 * actual: navegando por el mes propio, repetirlo siempre es ruido.
 *
 * incidenciasMesLabel() sigue existiendo para el titulo del modal, donde el
 * mes va suelto y si necesita el año completo.
 */
function incidenciasMesTitulo(date) {
    const mes = MESES[date.getMonth()];

    return date.getFullYear() === new Date().getFullYear()
        ? mes
        : `${mes} ${date.getFullYear()}`;
}

function incidenciasWidget() {
    return `
        <div class="hm-card hm-col-4">
            ${panelHead(
                IC.clipboard,
                `Incidencias de marcaje de <span data-hm="inc-month">${esc(incidenciasMesTitulo(incidenciasMes))}</span>`,
                `<div class="hm-bday-nav">
                    <button type="button" data-hm="inc-prev" aria-label="Mes anterior">&#8249;</button>
                    <button type="button" data-hm="inc-next" aria-label="Mes siguiente">&#8250;</button>
                </div>`
            )}
            <div class="hm-listcol hm-inc-list" data-hm="inc-list">
                <div class="hm-empty">Revisando el mes...</div>
            </div>
            <div class="hm-inc-import">
                <button class="hm-cob-btn hm-cob-btn--ver" type="button"
                    data-hm="inc-import">ADJUNTAR REGISTRO</button>
            </div>
        </div>`;
}

function incidenciasListHTML(totals) {
    const total = ATTENDANCE_INCIDENT_KINDS
        .reduce((suma, kind) => suma + (totals[kind.key] || 0), 0);

    if (!total) {
        return `<div class="hm-empty">Sin incidencias de marcaje este mes.</div>`;
    }

    // Se listan todas siempre, incluso en cero: ver un "0" al lado de "Sin
    // marcaje entrada" dice algo; que la fila desaparezca, no.
    return ATTENDANCE_INCIDENT_KINDS.map(kind => {
        const cantidad = totals[kind.key] || 0;

        return `
            <button class="hm-kv" type="button" data-hm="inc-kind"
                data-kind="${esc(kind.key)}" ${cantidad ? "" : "disabled"}>
                <span class="hm-kv-name">${esc(kind.label)}</span>
                <span class="hm-kv-right">
                    <span class="hm-kv-num ${cantidad ? "hm-amber" : ""}">${cantidad}</span>
                </span>
            </button>`;
    }).join("");
}

/**
 * Calcula las incidencias del mes en curso y pinta el recuadro.
 *
 * Va aparte del render porque tarda: el inicio aparece de inmediato con
 * "Revisando el mes..." y el resultado entra cuando esta.
 */
async function cargarIncidencias(panel) {
    const lista = panel.querySelector('[data-hm="inc-list"]');
    const mes = panel.querySelector('[data-hm="inc-month"]');

    if (!lista) return;

    if (mes) mes.textContent = incidenciasMesTitulo(incidenciasMes);

    if (incidenciasCache?.key === incidenciasMesKey(incidenciasMes)) {
        lista.innerHTML = incidenciasListHTML(incidenciasCache.totals);
        return;
    }

    const requestId = ++incidenciasRequest;

    lista.innerHTML = `<div class="hm-empty">Revisando el mes...</div>`;

    try {
        const resultado = await buildAttendanceIncidents(
            getProfiles(),
            incidenciasMes
        );

        // Si mientras tanto se cambio de mes, manda el ultimo pedido.
        if (requestId !== incidenciasRequest) return;

        incidenciasCache = {
            key: incidenciasMesKey(incidenciasMes),
            ...resultado
        };
        lista.innerHTML = incidenciasListHTML(resultado.totals);
        refrescarDetalleIncidencias(panel);
    } catch (error) {
        if (requestId !== incidenciasRequest) return;

        console.warn("No se pudieron calcular las incidencias.", error);
        lista.innerHTML =
            `<div class="hm-empty">No se pudieron calcular las incidencias.</div>`;
    }
}

/**
 * Si el cuadro de detalle esta abierto, se repinta con lo recien calculado. Sin
 * esto seguiria mostrando la incidencia que acaba de dejar de existir.
 */
function refrescarDetalleIncidencias(panel) {
    const modal = panel.querySelector('[data-hm="inc-modal"]');

    if (!modal || modal.hidden) return;

    const cuerpo = modal.querySelector('[data-hm="inc-body"]');
    const kind = cuerpo?.dataset.kind;

    if (!cuerpo || !kind) return;

    cuerpo.innerHTML = incidenciasDetalleHTML(kind);
}

function incidenciasDetalleHTML(kind) {
    incidenciasDetalle = (incidenciasCache?.events || [])
        .filter(evento => evento.kind === kind)
        .sort((a, b) => a.iso.localeCompare(b.iso) ||
            a.profile.localeCompare(b.profile));

    if (!incidenciasDetalle.length) {
        return `<div class="hm-empty">Sin eventos de este tipo.</div>`;
    }

    // Cada fila es un boton: al presionarla se abre debajo el reporte de esos
    // dias, y al volver a presionarla se cierra.
    return `
        <div class="hm-inc-detail">
            ${incidenciasDetalle.map((evento, indice) => `
                <button class="hm-inc-row" type="button" data-hm="inc-row"
                    data-idx="${indice}" aria-expanded="false">
                    <b>${esc(evento.profile)}</b>
                    <span class="hm-inc-date">${esc(formatIncidentDate(evento.iso))}</span>
                    <small>${esc(evento.detail)}</small>
                </button>`).join("")}
        </div>`;
}

// Lo que se muestra de cada dia, en el orden de las columnas del reporte.
const INC_CTX_COLS = [
    ["turnoBase", "Turno base"],
    ["turnoRealizado", "Turno realizado"],
    ["atraso", "Atraso"],
    ["entrada", "Entrada"],
    ["salida", "Salida"]
];

/**
 * Cierra los detalles que estuvieran abiertos, con su fila.
 *
 * La fila y su detalle son hermanos, asi que cerrar es quitar la caja y
 * devolverle a la fila su aria-expanded: si se quita la caja sin mas, el lector
 * de pantalla sigue anunciando la fila como desplegada.
 */
function cerrarIncidenciasAbiertas(lista) {
    lista?.querySelectorAll(".hm-inc-ctx").forEach(caja => {
        caja.previousElementSibling?.setAttribute("aria-expanded", "false");
        caja.remove();
    });
}

/**
 * Abre -o cierra- el reporte de esos dias bajo la fila de la incidencia.
 *
 * El detalle entra como hermano de la fila, no dentro de ella: asi empuja
 * hacia abajo a las incidencias que siguen y queda entre la que se revisa y
 * la siguiente, que es como se pidio. Cerrar es quitarlo y las filas se
 * vuelven a juntar.
 */
async function alternarIncidenciaDetalle(fila) {
    const abierto = fila.nextElementSibling?.classList.contains("hm-inc-ctx");

    // Se abre de a uno. Con varios abiertos la lista se estira y hay que
    // acordarse de cerrar el anterior a mano para volver a verla entera; lo que
    // se compara casi siempre es una incidencia con la siguiente, no dos que
    // quedaron lejos.
    cerrarIncidenciasAbiertas(fila.parentElement);

    if (abierto) return;

    const evento = incidenciasDetalle[Number(fila.dataset.idx)];

    if (!evento) return;

    const caja = document.createElement("div");

    caja.className = "hm-inc-ctx";
    caja.innerHTML = `<div class="hm-empty">Buscando el reporte...</div>`;
    fila.after(caja);
    fila.setAttribute("aria-expanded", "true");

    try {
        const dias = await attendanceIncidentContext(
            getProfiles().find(perfil => perfil.name === evento.profile),
            evento.iso
        );

        // Se pudo cerrar mientras se buscaba.
        if (!caja.isConnected) return;

        caja.innerHTML = incidenciaContextoHTML(dias, evento);
    } catch (error) {
        console.warn("No se pudo abrir el reporte de la incidencia.", error);

        if (caja.isConnected) {
            caja.innerHTML =
                `<div class="hm-empty">No se pudo abrir el reporte de esos días.</div>`;
        }
    }
}

/**
 * El dia de la incidencia entre su vispera y su dia siguiente.
 *
 * Los tres dias van juntos porque un turno no termina donde termina la fecha:
 * la entrada que falta un lunes se explica con la noche del domingo, y la
 * salida que falta hoy aparece en la fila de manana.
 */
function incidenciaContextoHTML(dias, evento) {
    if (!dias?.length) {
        return `<div class="hm-empty">Sin datos de esos días.</div>`;
    }

    const donde = `data-profile="${esc(evento.profile)}" data-iso="${esc(evento.iso)}"`;

    return `
        <div class="hm-inc-ctx-scroll">
            <table class="hm-inc-ctx-table">
                <thead>
                    <tr>
                        <th scope="col">Día</th>
                        ${INC_CTX_COLS.map(([, etiqueta]) =>
                            `<th scope="col">${esc(etiqueta)}</th>`).join("")}
                    </tr>
                </thead>
                <tbody>
                    ${dias.map(dia => `
                        <tr${dia.iso === evento.iso ? ` class="is-incident"` : ""}>
                            <th scope="row">${esc(incidenciaDiaLabel(dia.iso))}</th>
                            ${INC_CTX_COLS.map(([campo]) =>
                                `<td>${celdaReporte(dia[campo])}</td>`).join("")}
                        </tr>`).join("")}
                </tbody>
            </table>
        </div>
        <div class="hm-cob-actions">
            <button class="hm-cob-btn hm-cob-btn--ver" type="button"
                data-hm="inc-cal" ${donde}>VER CALENDARIO</button>
            <button class="hm-cob-btn hm-cob-btn--ver" type="button"
                data-hm="inc-report" ${donde}>IR AL REPORTE</button>
        </div>`;
}

/**
 * "Lun 10/08". El dia de la semana es lo que hace legible la fila: una noche
 * de sabado no se lee igual que una de martes.
 */
function incidenciaDiaLabel(iso) {
    const [year, month, day] = String(iso).split("-");
    const fecha = new Date(Number(year), Number(month) - 1, Number(day));

    return `${DIAS_ABR[fecha.getDay()]} ${day}/${month}`;
}

/**
 * Una celda del reporte. Puede traer dos lineas -un D+N marca dos veces- y
 * viene vacia cuando ese dia no tenia nada que mostrar.
 */
function celdaReporte(valor) {
    const texto = String(valor ?? "").trim();

    return texto ? esc(texto).replace(/\n/g, "<br>") : "—";
}

function formatIncidentDate(iso) {
    const [year, month, day] = String(iso).split("-");

    return `${day}/${month}/${year}`;
}

function ausenciasWidget() {
    const items = getTodayAbsences();
    const body = items.length
        ? items.map(item => {
            const chip = item.uncovered > 0
                ? `<span class="hm-uncov">${item.uncovered} sin cubrir</span>`
                : "";
            return `
                <button class="hm-kv" type="button" data-hm="absence-summary" data-absence-cat="${esc(item.key)}">
                    <span class="hm-kv-ico hm-${item.tone}">${svg(IC[item.icon])}</span>
                    <span class="hm-kv-name">${esc(item.label)}</span>
                    <span class="hm-kv-right">${chip}<span class="hm-kv-num hm-${item.tone}">${item.total}</span></span>
                </button>`;
        }).join("")
        : `<div class="hm-empty">Sin ausencias registradas hoy.</div>`;
    const calBtn = `<button class="hm-gear" type="button" data-hm="abscal-open" aria-label="Ver el mes de ausencias" title="Ver el mes de ausencias">${svg(IC.calendar)}</button>`;

    return `
        <div class="hm-card hm-col-4">
            ${panelHead(IC.users, "Ausencias del día", calBtn)}
            <div class="hm-listcol" data-hm="absence-list">${body}</div>
        </div>`;
}

function absenceDetailRowHTML(item) {
    const status = item.uncovered
        ? '<span class="hm-cob-status hm-cob-status--sincubrir">Sin cubrir</span>'
        : '<span class="hm-cob-status hm-cob-status--preasignado">Cubierto</span>';

    return `
        <div class="hm-cob-row hm-absence-detail-row">
            <div class="hm-cob-top">
                <span class="hm-turno hm-turno--${item.turnoClass}">${esc(item.turnoLabel)}</span>
                <span class="hm-cob-date hm-absence-worker">${esc(item.name)}</span>
                ${status}
            </div>
            <div class="hm-cob-meta"><b>${esc(item.absenceLabel)}:</b> ${esc(item.dateLabel)}</div>
            <div class="hm-cob-meta"><b>Detalle:</b> ${esc(item.meta)}</div>
            <div class="hm-cob-actions">
                <button class="hm-cob-btn hm-cob-btn--ver" type="button"
                    data-hm="absence-ver" data-absence-profile="${esc(item.name)}"
                    data-absence-iso="${esc(item.iso)}">VER EN CALENDARIO</button>
            </div>
        </div>`;
}

/* =========================================================
   Programacion semanal publicada

   Hasta ahora solo se veia en la PWA del trabajador: el menu de tareas la sube
   pero no la dibuja. Aca se muestra igual que la ve el trabajador, sin poder
   editarla, y con las semanas del mes a mano para no ir de a una buscando cual
   tiene algo publicado.
========================================================= */

function weeklyScheduleModal() {
    return `
        <div class="hm-modal-backdrop" data-hm="weekly-modal" hidden>
            <div class="hm-modal hm-modal--weekly" role="dialog" aria-modal="true" aria-label="Programación semanal">
                <div class="hm-modal-head">
                    <span class="hm-modal-ico">${svg(IC.table)}</span>
                    <h3>Programación · <span data-hm="ws-heading"></span></h3>
                    <div class="hm-bday-nav">
                        <button type="button" data-hm="ws-prev" aria-label="Semana anterior">&#8249;</button>
                        <button type="button" data-hm="ws-next" aria-label="Semana siguiente">&#8250;</button>
                    </div>
                    <button class="hm-btn-secondary hm-ws-today" type="button" data-hm="ws-today">Hoy</button>
                    <button class="hm-modal-close" type="button" data-hm="close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="hm-ws-weeks" data-hm="ws-weeks"></div>
                <div class="hm-modal-body" data-hm="ws-body"></div>
            </div>
        </div>`;
}

// Atajos a las semanas del mes que SI tienen programacion. Sin esto habria que
// avanzar de a una para descubrir cuales estan publicadas.
function weeklyScheduleWeeksHTML() {
    const semanas = publishedWeeksOfMonth(weeklyScheduleWeek);
    const actual = weeklyScheduleWeek.getTime();

    if (!semanas.length) {
        return `<span class="hm-ws-weeks-empty">Sin programación publicada este mes.</span>`;
    }

    return semanas.map(week => `
        <button class="hm-ws-week ${week.getTime() === actual ? "is-active" : ""}"
            type="button" data-hm="ws-week" data-week="${week.getTime()}">
            ${week.getDate()} ${MESES_ABR[week.getMonth()]}
        </button>
    `).join("");
}

function renderWeeklySchedule(panel) {
    const modal = panel.querySelector('[data-hm="weekly-modal"]');

    if (!modal) return;

    modal.querySelector('[data-hm="ws-heading"]').textContent =
        weekHeading(weeklyScheduleWeek);
    modal.querySelector('[data-hm="ws-weeks"]').innerHTML =
        weeklyScheduleWeeksHTML();
    modal.querySelector('[data-hm="ws-body"]').innerHTML =
        weeklyScheduleBody(weeklyScheduleWeek);
}



function showWeeklySchedule(panel) {
    const modal = panel.querySelector('[data-hm="weekly-modal"]');

    if (!modal) return;

    renderWeeklySchedule(panel);
    modal.hidden = false;
}

function absenceModal() {
    return `
        <div class="hm-modal-backdrop" data-hm="absence-modal" hidden>
            <div class="hm-modal hm-modal--absence" role="dialog" aria-modal="true" aria-label="Detalle de ausencias">
                <div class="hm-modal-head">
                    <span class="hm-modal-ico">${svg(IC.users)}</span>
                    <h3 data-hm="absence-title">Ausencias del dia</h3>
                    <button class="hm-modal-close" type="button" data-hm="close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="hm-modal-body" data-hm="absence-body"></div>
            </div>
        </div>`;
}

function openAbsenceDetail(panel, categoryKey) {
    const detail = getTodayAbsenceDetails(categoryKey);
    const modal = panel.querySelector('[data-hm="absence-modal"]');
    if (!modal) return;

    const title = detail.category
        ? `${detail.category.label} · ${detail.rows.length}`
        : "Ausencias del dia";
    modal.querySelector('[data-hm="absence-title"]').textContent = title;
    modal.querySelector('[data-hm="absence-body"]').innerHTML = detail.rows.length
        ? `<div class="hm-absence-detail-list">${detail.rows.map(absenceDetailRowHTML).join("")}</div>`
        : `<div class="hm-dot-empty">Sin trabajadores con esta ausencia hoy.</div>`;
    modal.hidden = false;
}

// ---- Cumpleaños del mes ----
// Se reusa birthDateParts de staffing (acepta YYYY-MM-DD y DD-MM-YYYY) para no
// tener dos lecturas distintas de la misma fecha.
export function getMonthBirthdays(reference = new Date(), now = new Date()) {
    const month = reference.getMonth();
    const year = reference.getFullYear();
    // "Hoy" y "ya paso" son relativos a la fecha REAL, no al mes que se esta
    // mirando: al navegar a otro mes ningun dia debe marcarse como hoy.
    const isCurrentMonth =
        now.getMonth() === month &&
        now.getFullYear() === year;
    const isPastMonth =
        year < now.getFullYear() ||
        (year === now.getFullYear() && month < now.getMonth());
    const today = now.getDate();

    return getProfiles()
        .filter(isProfileActive)
        .map(profile => {
            const parts = birthDateParts(profile.birthDate);

            if (!parts || parts.month !== month) return null;

            // La edad solo se muestra si la fecha trae año.
            const bornYear = Number(
                String(profile.birthDate || "").match(/(\d{4})/)?.[1]
            );
            const turns = bornYear && bornYear < year
                ? year - bornYear
                : 0;

            return {
                name: profile.name,
                day: parts.day,
                turns,
                isToday: isCurrentMonth && parts.day === today,
                isPast: isPastMonth ||
                    (isCurrentMonth && parts.day < today)
            };
        })
        .filter(Boolean)
        .sort((a, b) =>
            a.day - b.day ||
            a.name.localeCompare(b.name, "es")
        );
}

function birthdaysBody() {
    const reference = new Date(birthdayYear, birthdayMonth, 1);
    const birthdays = getMonthBirthdays(reference);
    const monthName = MESES[birthdayMonth];
    const now = new Date();
    // El año solo se muestra cuando no es el actual, para no repetirlo siempre.
    const heading = birthdayYear === now.getFullYear()
        ? monthName
        : `${monthName} ${birthdayYear}`;
    const list = birthdays.length
        ? birthdays.map(item => `
            <div class="hm-bday ${item.isToday ? "is-today" : ""} ${item.isPast ? "is-past" : ""}">
                <span class="hm-bday-day">${item.day}</span>
                <span class="hm-bday-name">
                    <strong>${esc(item.name)}</strong>
                    ${item.turns ? `<small>cumple ${item.turns}</small>` : ""}
                </span>
                ${item.isToday ? `<span class="hm-bday-today">Hoy</span>` : ""}
            </div>`).join("")
        : `<div class="hm-empty">Sin cumpleaños en ${esc(monthName.toLowerCase())}.</div>`;

    return { heading, count: birthdays.length, list };
}

function cumpleanosWidget() {
    const { heading, count, list } = birthdaysBody();

    return `
        <div class="hm-card hm-col-4">
            ${panelHead(
                IC.cake,
                `Cumpleaños de <span data-hm="bday-month">${esc(heading)}</span>`,
                // Las flechas van pegadas al mes; el contador conserva su
                // margin-left:auto y sigue alineado a la derecha.
                `<div class="hm-bday-nav">
                    <button type="button" data-hm="bday-prev" aria-label="Mes anterior">&#8249;</button>
                    <button type="button" data-hm="bday-next" aria-label="Mes siguiente">&#8250;</button>
                </div>
                <span class="hm-count" data-hm="bday-count">${count}</span>`
            )}
            <div class="hm-listcol hm-bday-list hm-scroller" data-hm="bday-list">${list}</div>
        </div>`;
}

function resumenWidget() {
    const swapCount = getMonthSwaps().length;
    const dotacion = getDotacionHoy();
    // Si hoy cumple alguien, el resumen lo dice; si no, la fila no aparece.
    const birthdaysToday = getMonthBirthdays().filter(item => item.isToday);
    function row(tone, name, val) {
        return `<div class="hm-sum hm-sum--${tone}"><span>${name}</span><span class="hm-sum-val">${val}</span></div>`;
    }
    return `
        <div class="hm-card hm-col-4">
            ${panelHead(IC.bars, "Resumen rápido")}
            <div class="hm-listcol hm-listcol--gap">
                ${row("good", "En servicio hoy", dotacion.total)}
                ${row("info", "Personal de día", dotacion.dia)}
                ${row("night", "Personal de noche", dotacion.noche)}
                ${row("accent", "Cambios de turno", swapCount)}
                ${birthdaysToday.length
                    ? `<div class="hm-sum hm-sum--bday" title="${esc(birthdaysToday.map(item => item.name).join(", "))}">
                        <span>🎂 ${esc(birthdaysToday.map(item => item.name).join(", "))}</span>
                        <span class="hm-sum-val">Hoy</span>
                    </div>`
                    : ""}
            </div>
        </div>`;
}

/* Mini calendario: un mes de un vistazo, con hoy, los fines de semana y los
   feriados marcados. Se mueve de mes con sus flechas. No lleva tareas -para
   eso esta el calendario grande-: la grilla es una puerta a el, y lo abre en
   el mes que se esta mirando. */

/**
 * Casillas del mini calendario: `null` para los huecos antes del dia 1 (la
 * semana arranca en lunes, como el calendario de tareas) y un objeto por dia.
 *
 * @param {number} year
 * @param {number} month 0-11
 * @param {Object} holidays mapa "año-mes(0)-dia" -> nombre (o true)
 * @param {Date} [today]
 * @returns {Array<null|{day: number, isToday: boolean, isWeekend: boolean, holiday: string}>}
 */
export function buildMiniCalendarCells(year, month, holidays = {}, today = new Date()) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    const cells = new Array(lead).fill(null);
    const isCurrentMonth =
        today.getFullYear() === year && today.getMonth() === month;

    for (let day = 1; day <= daysInMonth; day += 1) {
        const weekday = new Date(year, month, day).getDay();

        cells.push({
            day,
            isToday: isCurrentMonth && today.getDate() === day,
            isWeekend: weekday === 0 || weekday === 6,
            holiday: holidayNameFor(holidays, year, month, day)
        });
    }

    return cells;
}

function miniCalendarHeading() {
    return `${MESES[miniCalMonth]} ${miniCalYear}`;
}

function miniCalendarGridHTML() {
    const cells = buildMiniCalendarCells(
        miniCalYear,
        miniCalMonth,
        getCachedHolidays(miniCalYear)
    );

    return `
        ${DIAS_SEMANA.map((day, index) => `<span class="hm-minical-dow ${index >= 5 ? "is-weekend" : ""}">${esc(day.charAt(0))}</span>`).join("")}
        ${cells.map(cell => cell
            ? `<span class="hm-minical-day ${cell.isToday ? "is-today" : ""} ${cell.isWeekend ? "is-weekend" : ""} ${cell.holiday ? "is-holiday" : ""}"${cell.holiday ? ` title="${esc(cell.holiday)}"` : ""}>${cell.day}</span>`
            : `<span class="hm-minical-day hm-minical-day--blank" aria-hidden="true"></span>`
        ).join("")}`;
}

// Las flechas no pueden estar dentro de lo que abre el calendario de tareas:
// cambiar de mes lo abriria. Por eso la puerta es la grilla (con la leyenda),
// no la tarjeta entera.
function miniCalendarWidget() {
    return `
        <div class="hm-card hm-col-4 hm-minical">
            ${panelHead(
                IC.calendar,
                `<span data-hm="minical-month">${esc(miniCalendarHeading())}</span>`,
                `<div class="hm-bday-nav">
                    <button type="button" data-hm="minical-prev" aria-label="Mes anterior">&#8249;</button>
                    <button type="button" data-hm="minical-next" aria-label="Mes siguiente">&#8250;</button>
                </div>`
            )}
            <div class="hm-minical-open" data-hm="open-taskcal" data-taskcal-from="minical"
                role="button" tabindex="0" title="Ver el calendario de tareas">
                <div class="hm-minical-grid" data-hm="minical-grid">${miniCalendarGridHTML()}</div>
                <div class="hm-minical-legend">
                    <span class="hm-minical-key hm-minical-key--today">Hoy</span>
                    <span class="hm-minical-key hm-minical-key--holiday">Inhábiles</span>
                </div>
            </div>
        </div>`;
}

// Solo el mes y la grilla: la tarjeta conserva sus listeners (abrir el
// calendario de tareas y cambiar de mes).
function reRenderMiniCalendar(panel) {
    const month = panel.querySelector('[data-hm="minical-month"]');
    const grid = panel.querySelector('[data-hm="minical-grid"]');

    if (month) month.textContent = miniCalendarHeading();
    if (grid) grid.innerHTML = miniCalendarGridHTML();
}

function cambiosWidget() {
    const swaps = getMonthSwaps();
    const body = swaps.length
        ? swaps.slice(0, 6).map(swap => {
            const turno = homeSwapTurnLabel(swap.turno);
            const meta = [turno, formatShortDate(swap.fecha)].filter(Boolean).join(" · ");
            return `
                <button class="hm-swap" type="button" data-hm="swap-detail" data-swap-id="${esc(swap.id || "")}">
                    <span class="hm-swap-tag">${esc(shortName(swap.from))}</span>
                    <span class="hm-swap-arrow">${svg(IC.arrowRight, 'stroke-width="2.2"')}</span>
                    <span class="hm-swap-tag">${esc(shortName(swap.to))}</span>
                    <span class="hm-swap-count">${esc(meta)}</span>
                </button>`;
        }).join("")
        : `<div class="hm-empty">Sin cambios de turno este mes.</div>`;
    return `
        <div class="hm-card hm-col-4">
            ${panelHead(IC.swap, "Cambios de turno", `<span class="hm-count">${swaps.length}</span>`)}
            <div class="hm-listcol">${body}</div>
        </div>`;
}

function swapDetailItemHTML(label, date, turn, skipped) {
    const turnLabel = homeSwapTurnLabel(turn);
    const value = skipped
        ? "Sin movimiento en calendario"
        : [formatSwapDetailDate(date), turnLabel].filter(Boolean).join(" - ");

    return `
        <li>
            <span>${esc(label)}</span>
            <strong>${esc(value || "Sin dato")}</strong>
        </li>`;
}

function openHomeSwapDetailDialog(swap) {
    if (!swap) return;

    const backdrop = document.createElement("div");

    backdrop.className = "turn-change-dialog-backdrop hm-swap-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog hm-swap-dialog" role="dialog" aria-modal="true" aria-labelledby="homeSwapDetailTitle">
            <strong id="homeSwapDetailTitle">Cambio de turno aplicado</strong>
            <p>
                Revisa el detalle del cambio antes de anularlo.
            </p>
            <div class="turn-change-dialog__meta hm-swap-dialog__meta">
                <span>${esc(swap.from || "Sin trabajador")}</span>
                <span class="hm-swap-dialog__arrow">${svg(IC.arrowRight, 'stroke-width="2.2"')}</span>
                <span>${esc(swap.to || "Sin trabajador")}</span>
            </div>
            <ul class="turn-change-dialog__swap-detail">
                ${swapDetailItemHTML("Entrega", swap.fecha, swap.turno, Boolean(swap.skipFecha))}
                ${swapDetailItemHTML("Devuelve", swap.devolucion, swap.turnoDevuelto, Boolean(swap.skipDevolucion))}
            </ul>
            <p class="leave-detail-note hm-swap-dialog__note">
                Al anularlo se restauran los dias de ambos trabajadores a su turno original.
            </p>
            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="cancel">
                    Cancelar
                </button>
                <button class="leave-detail-undo" type="button" data-action="undo">
                    Anular cambio
                </button>
            </div>
        </section>`;

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };

    const onKeydown = event => {
        if (event.key === "Escape") {
            close();
        }
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) {
            close();
        }
    });

    backdrop
        .querySelector("[data-action='cancel']")
        ?.addEventListener("click", close);

    backdrop
        .querySelector("[data-action='undo']")
        ?.addEventListener("click", async event => {
            const targetSwap = getMonthSwaps().find(item =>
                String(item.id || "") === String(swap.id || "")
            );

            event.currentTarget.disabled = true;

            if (!targetSwap) {
                alert("Este cambio ya no esta disponible para anular.");
                close();
                renderHomePanel();
                return;
            }

            if (typeof window.pushUndoState === "function") {
                window.pushUndoState("Deshacer cambio de turno");
            }

            deshacerCambioTurno(targetSwap);

            const dates = [targetSwap.fecha, targetSwap.devolucion]
                .filter(Boolean);
            const profiles = [targetSwap.from, targetSwap.to]
                .filter(Boolean);
            const keys = dates
                .map(keyFromISO)
                .filter(key => key && !key.includes("NaN"));

            await Promise.all(
                profiles.flatMap(profile =>
                    dates.map(date => updateDayCell(profile, date))
                )
            );

            profiles.forEach(profile => {
                updateTimelineCells(profile, keys);
            });
            await updateVisibleCalendarDays({ updateSummary: true });

            close();
            refreshAll();
            renderHomePanel();
        });

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
    backdrop.querySelector("[data-action='undo']")?.focus();
}

function coberturaRow(item, kind) {
    // El turno cuya solicitud ya salio a las PWA no esta "sin cubrir": esta en
    // espera de respuesta. El celular es el mismo marcador del calendario y del
    // timeline, para que las tres superficies digan lo mismo.
    const waiting = kind === "sincubrir" && (item.pendingRequests?.length || 0) > 0;
    // La campaña por etapas sigue viva aunque en este momento no haya ninguna
    // solicitud pendiente: entre la caducidad de una oleada y el envio de la
    // siguiente pasan horas, y el boton no debe volver a habilitarse ahi.
    const campaign = kind === "sincubrir" ? (item.campaign || null) : null;
    const status = waiting
        ? `<button class="hm-cob-status hm-cob-status--espera" type="button"
                data-hm="cob-espera" data-cob-profile="${esc(item.origin)}" data-cob-key="${esc(item.keyDay)}"
                title="Ver a quién se le envió y cuánto queda">${svg(IC.phone, 'stroke-width="1.7"')}En espera..</button>`
        : kind === "sincubrir"
            ? '<span class="hm-cob-status hm-cob-status--sincubrir">Sin cubrir</span>'
            : '<span class="hm-cob-status hm-cob-status--preasignado">Preasignado</span>';
    const stageNote = campaign
        ? `<div class="hm-cob-meta hm-cob-meta--stage">${esc(
            campaignStatusLabel(campaign)
        )}</div>`
        : "";
    const third = waiting
        ? `<div class="hm-cob-meta"><b>Solicitud enviada a:</b> ${esc(
            item.pendingRequests.map(request => request.worker).join(", ")
        )}</div>`
        : kind === "sincubrir"
        ? (item.candidates.length
            ? `<div class="hm-cob-meta"><b>Podría cubrir:</b> ${esc(item.candidates.join(", "))}</div>`
            : '<div class="hm-cob-meta"><span class="hm-cob-none">Sin candidatos disponibles</span></div>')
        : `<div class="hm-cob-meta"><b>Preasignado:</b> ${esc(item.assigned)}</div>`;
    const reason = item.reason ? ` · ${esc(item.reason)}` : "";
    // Los preasignados se resuelven desde aca sin pasar por el calendario: son
    // las mismas dos acciones del modal del turno preasignado.
    const actions = kind === "preasignado" && item.id
        ? `
            <div class="hm-cob-actions">
                <button class="hm-cob-btn hm-cob-btn--confirm" type="button" data-hm="cob-confirm" data-preassign-id="${esc(item.id)}">CONFIRMAR</button>
                <button class="hm-cob-btn hm-cob-btn--cancel" type="button" data-hm="cob-cancel" data-preassign-id="${esc(item.id)}">CANCELAR</button>
            </div>`
        : kind === "sincubrir" && item.keyDay
            ? `
            <div class="hm-cob-actions">
                <button class="hm-cob-btn hm-cob-btn--ver" type="button" data-hm="cob-ver" data-cob-profile="${esc(item.origin)}" data-cob-iso="${esc(item.iso)}">VER EN CALENDARIO</button>
                <button class="hm-cob-btn hm-cob-btn--auto" type="button" data-hm="cob-auto"
                    data-cob-profile="${esc(item.origin)}" data-cob-key="${esc(item.keyDay)}"
                    ${campaign
                        ? `disabled title="La cobertura automática ya está en curso. Sigue sola hasta que alguien acepte el turno o hasta la alerta al supervisor."`
                        : waiting
                            ? `disabled title="Ya se envió la solicitud. Se habilita cuando caduque o cuando alguien acepte el turno."`
                            : ""}>${
                    campaign
                        ? "COBERTURA EN CURSO"
                        : waiting
                            ? "SOLICITUD ENVIADA"
                            : "COBERTURA AUTOMÁTICA"}</button>
            </div>`
            : "";
    return `
        <div class="hm-cob-row">
            <div class="hm-cob-top">
                <span class="hm-turno hm-turno--${item.turnoClass}">${esc(item.turnoLabel)}</span>
                <span class="hm-cob-date">${esc(item.dateLabel)}</span>
                ${status}
            </div>
            <div class="hm-cob-meta"><b>Origina:</b> ${esc(item.origin)}${reason}</div>
            ${third}
            ${stageNote}
            ${actions}
        </div>`;
}

// ---- Alerta de cobertura sin respuesta (punto D del requerimiento) ----
//
// Es el aviso que se levanta cuando la cobertura automatica agoto sus etapas y
// el turno sigue sin nadie. Va como banda propia sobre el tablero y no dentro
// de la tarjeta de cobertura: la tarjeta se puede tener plegada en "resumen" y
// una alarma que se puede esconder no es una alarma.
function coverageAlertCardHTML(alert) {
    const left = formatCoverageTimeLeft(alert.msLeft);
    const origin = alert.absenceType
        ? `${alert.replaced} · ${alert.absenceType}`
        : alert.replaced;

    return `
        <article class="hm-cobalert" role="alert" data-hm="cobalert" data-cob-campaign="${esc(alert.id)}">
            <span class="hm-cobalert-ico">${svg(IC.alertTri)}</span>
            <div class="hm-cobalert-main">
                <strong class="hm-cobalert-title">Turno sin cubrir: nadie aceptó la cobertura automática</strong>
                <div class="hm-cobalert-shift">
                    <span class="hm-turno hm-turno--${turnoCssClass(alert.turno)}">${esc(alert.turnoLabel || "Turno")}</span>
                    <span class="hm-cobalert-date">${esc(shortDateFromISO(alert.date))}</span>
                    <span class="hm-cobalert-origin">${esc(origin)}</span>
                </div>
                <div class="hm-cobalert-left">Queda <b>${esc(left)}</b> para cubrirlo.</div>
            </div>
            <div class="hm-cobalert-actions">
                <button class="hm-cob-btn hm-cob-btn--ver" type="button" data-hm="cobalert-ver"
                    data-cob-profile="${esc(alert.replaced)}" data-cob-iso="${esc(alert.date)}">VER EN CALENDARIO</button>
                <button class="hm-cob-btn hm-cob-btn--auto" type="button" data-hm="cobalert-who"
                    data-cob-campaign="${esc(alert.id)}">VER QUIÉNES RECIBIERON LA SOLICITUD</button>
            </div>
        </article>`;
}

function coverageAlertsHTML() {
    return getAutoCoverageAlerts().map(coverageAlertCardHTML).join("");
}

function coverageRecipientsModal() {
    return `
        <div class="hm-modal-backdrop" data-hm="cobwho-modal" hidden>
            <div class="hm-modal hm-modal--absence" role="dialog" aria-modal="true" aria-label="Destinatarios de la cobertura">
                <div class="hm-modal-head">
                    <span class="hm-modal-ico">${svg(IC.phone)}</span>
                    <h3 data-hm="cobwho-title">Solicitudes de cobertura enviadas</h3>
                    <button class="hm-modal-close" type="button" data-hm="close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="hm-modal-body" data-hm="cobwho-body"></div>
            </div>
        </div>`;
}

const COVERAGE_REQUEST_STATUS = {
    pending: "Pendiente",
    accepted: "Aceptada",
    rejected: "Rechazada",
    expired: "Caducada",
    superseded: "Caducada (la tomó otro)",
    canceled: "Anulada"
};

function openCoverageRecipients(panel, campaignId) {
    const modal = panel.querySelector('[data-hm="cobwho-modal"]');

    if (!modal) return;

    const waves = getCampaignRecipients(campaignId);
    const body = waves.length
        ? waves.map(wave => `
            <div class="hm-cobwho-wave">
                <div class="hm-cobwho-wave-head">
                    <b>Etapa ${wave.stage}</b>
                    <span>${esc(wave.label)}</span>
                    <span class="hm-cobwho-when">${esc(shortDateTime(wave.sentAt))}</span>
                </div>
                <ul class="hm-cobwho-list">
                    ${wave.workers.map(worker => `
                        <li>
                            <span class="hm-cobwho-name">${esc(worker.worker)}</span>
                            <span class="hm-cobwho-chan">${esc(
                                worker.channel === "app"
                                    ? "Aplicación"
                                    : "WhatsApp"
                            )}</span>
                            <span class="hm-cobwho-state hm-cobwho-state--${esc(worker.status)}">${esc(
                                COVERAGE_REQUEST_STATUS[worker.status] || worker.status
                            )}</span>
                        </li>`).join("")}
                </ul>
            </div>`).join("")
        : `<div class="hm-dot-empty">Todavía no salió ninguna solicitud de esta cobertura.</div>`;

    modal.querySelector('[data-hm="cobwho-body"]').innerHTML = body;
    modal.hidden = false;
}

function shortDateTime(iso) {
    const date = new Date(iso);

    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleString("es-CL", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function coberturaBody() {
    const { uncovered, preassigned } = coverageData;
    const total = uncovered.length + preassigned.length;

    const summary =
        `<div class="hm-cob-chip hm-cob-chip--crit"><span class="hm-cob-chip-ico">${svg(IC.alertTri)}</span><span><span class="hm-cob-chip-num">${uncovered.length}</span><span class="hm-cob-chip-lbl">Sin cubrir</span></span></div>` +
        `<div class="hm-cob-chip hm-cob-chip--accent"><span class="hm-cob-chip-ico">${svg(IC.clock)}</span><span><span class="hm-cob-chip-num">${preassigned.length}</span><span class="hm-cob-chip-lbl">Preasignados</span></span></div>`;

    let list =
        uncovered.map(i => coberturaRow(i, "sincubrir")).join("") +
        preassigned.map(i => coberturaRow(i, "preasignado")).join("");
    if (!list) {
        list = `<div class="hm-empty">Sin turnos por cubrir ni preasignados.</div>`;
    }

    return { total, summary, list };
}

/* ==========================================================================
   Brecha RRHH

   Un grupo del 4to turno puede estar constituido con menos gente que los
   otros: no es que alguien falte hoy, es que ese cargo no existe en la
   rotativa. La carencia la detecta Titulares de Turnos comparando los cuatro
   grupos, y aparece CADA VEZ que ese grupo entra.

   Aca se listan los turnos proximos que van a entrar cortos, para poder
   cubrirlos sin salir del inicio.
   ========================================================================== */

// El plural va a mano: "profesionals" y "auxiliars" no existen. Es el mismo
// motivo que escribe el calendario semanal, para que las dos superficies
// dejen el registro con el mismo texto.
const BRECHA_PLURAL = {
    "Profesional": "profesionales",
    "Técnico": "técnicos",
    "Administrativo": "administrativos",
    "Auxiliar": "auxiliares"
};

const BRECHA_WINDOW_DAYS = 30;
const BRECHA_MAX_ROWS = 8;

let brechaDetail = false;

function getBrechaRows() {
    // Un mes por delante. La carencia no es una falta puntual -es un cargo que
    // no existe en el grupo-, asi que se repite cada vez que ese grupo entra y
    // la lista trae la MISMA fila en varias fechas. Es a proposito: son las
    // fechas concretas en las que va a faltar, que es lo que se necesita para
    // planificar la cobertura con tiempo.
    //
    // Lo que evita que el recuadro se vuelva ilegible es BRECHA_MAX_ROWS: se
    // ven las primeras y el resto se resume en una linea.
    return getRotaGapShifts({ days: BRECHA_WINDOW_DAYS })
        .flatMap(row => Array.from({ length: row.missing }, () => row));
}

function brechaRow(row) {
    return `
        <div class="hm-cob-row">
            <div class="hm-cob-top">
                <span class="hm-turno hm-turno--${row.shiftKey === "noche" ? "noche" : "larga"}">${esc(row.turnoLabel)}</span>
                <span class="hm-cob-date">${esc(shortDateFromDate(row.date))}</span>
                <span class="hm-cob-status hm-cob-status--brecha">Falta 1 ${esc(row.estamento)}</span>
            </div>
            <div class="hm-cob-meta">
                <b>Grupo ${esc(row.group)}:</b> ${row.count} de ${row.reference} ${esc(row.estamento.toLowerCase())}
            </div>
            <div class="hm-cob-actions hm-cob-actions--stack">
                <button class="hm-cob-btn hm-cob-btn--ver" type="button" data-hm="brecha-cubrir"
                    data-brecha-reference="${esc(row.reference_profile)}"
                    data-brecha-key="${esc(row.keyDay)}"
                    data-brecha-group="${esc(row.group)}"
                    data-brecha-estamento="${esc(row.estamento)}"
                    data-brecha-turno="${row.turno}"
                    ${row.reference_profile ? "" : "disabled title=\"No hay a quién parecerse: la unidad no tiene a nadie de ese estamento.\""}>CUBRIR</button>
                <button class="hm-cob-btn hm-cob-btn--auto" type="button" data-hm="brecha-semanal"
                    data-brecha-iso="${esc(row.iso)}"
                    title="Abre el Calendario Semanal en la semana de este turno">VER CALENDARIO SEMANAL</button>
            </div>
        </div>`;
}

function brechaBody() {
    const rows = getBrechaRows();
    const cargos = new Map();

    rows.forEach(row => {
        const clave = `${row.group}|${row.estamento}`;

        cargos.set(clave, (cargos.get(clave) || 0) + 1);
    });

    const summary =
        `<div class="hm-cob-chip hm-cob-chip--warn"><span class="hm-cob-chip-ico">${svg(IC.users)}</span><span><span class="hm-cob-chip-num">${cargos.size}</span><span class="hm-cob-chip-lbl">${cargos.size === 1 ? "Cargo faltante" : "Cargos faltantes"}</span></span></div>` +
        `<div class="hm-cob-chip hm-cob-chip--accent"><span class="hm-cob-chip-ico">${svg(IC.calendar)}</span><span><span class="hm-cob-chip-num">${rows.length}</span><span class="hm-cob-chip-lbl">Turnos afectados</span></span></div>`;

    const list = rows.length
        ? rows.slice(0, BRECHA_MAX_ROWS).map(brechaRow).join("") +
            (rows.length > BRECHA_MAX_ROWS
                ? `<div class="hm-cob-meta hm-cob-more">y ${rows.length - BRECHA_MAX_ROWS} más en los próximos ${BRECHA_WINDOW_DAYS} días.</div>`
                : "")
        : `<div class="hm-empty">Los cuatro grupos están parejos.</div>`;

    return { total: rows.length, summary, list };
}

function brechaWidget() {
    const { total, summary, list } = brechaBody();

    return `
        <div class="hm-card hm-col-4">
            ${panelHead(
                IC.users,
                "Brecha RRHH",
                `<label class="hm-toggle hm-head-toggle"><input type="checkbox" data-hm="brecha-detail" ${brechaDetail ? "checked" : ""}> Ver detalles</label>
                <span class="hm-count">${total}</span>`
            )}
            <div class="hm-cob-summary" ${brechaDetail ? "hidden" : ""}>${summary}</div>
            <div class="hm-cob-list hm-scroller" ${brechaDetail ? "" : "hidden"}>${list}</div>
        </div>`;
}

function coberturaWidget() {
    coverageData = getCoverageData();
    const { total, summary, list } = coberturaBody();
    return `
        <div class="hm-card hm-col-4">
            ${panelHead(
                IC.shield,
                "Cobertura de turnos",
                `<label class="hm-toggle hm-head-toggle"><input type="checkbox" data-hm="cob-detail" ${coverageDetail ? "checked" : ""}> Ver detalles</label>
                <span class="hm-count">${total}</span>`
            )}
            <div class="hm-cob-summary" ${coverageDetail ? "hidden" : ""}>${summary}</div>
            <div class="hm-cob-list hm-scroller" ${coverageDetail ? "" : "hidden"}>${list}</div>
        </div>`;
}

function tasksModal() {
    return `
        <div class="hm-modal-backdrop" data-hm="tasks-modal" hidden>
            <div class="hm-modal" role="dialog" aria-modal="true" aria-label="Agregar tarea">
                <div class="hm-modal-head">
                    <span class="hm-modal-ico">${svg(IC.plus, 'stroke-width="2.4"')}</span>
                    <h3>Agregar tarea</h3>
                    <button class="hm-modal-close" type="button" data-hm="close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="hm-modal-body">
                    <div class="hm-form-grid">
                        <label class="hm-full">Nombre de la tarea
                            <input type="text" data-hm="nt-name" placeholder="Ej: Revisión de agenda y asignación de turnos">
                        </label>
                        <label>Fecha de inicio <input type="date" data-hm="nt-date" value="${todayISO()}"></label>
                        <label>Horario <input type="time" data-hm="nt-time" value="08:00"></label>
                        <label>Repetir
                            <select data-hm="nt-repeat">${optionsHTML(REPEAT_OPTS, "Diario")}</select>
                        </label>
                        <label>Alerta
                            <select data-hm="nt-alert">
                                <option>Sin alerta</option>
                                <option>Al momento</option>
                                <option>5 minutos antes</option>
                                <option selected>15 minutos antes</option>
                                <option>30 minutos antes</option>
                                <option>1 hora antes</option>
                            </select>
                        </label>
                        <label class="hm-full">Visibilidad
                            <select data-hm="nt-visibility">${visibilityOptionsHTML()}</select>
                            <small class="hm-field-note">Compartida, la ven todos los administradores de la unidad; dirigida a trabajadores, les llega además al calendario de su teléfono.</small>
                        </label>
                    </div>
                </div>
                <div class="hm-modal-foot">
                    <button class="hm-btn-secondary" type="button" data-hm="close">Cancelar</button>
                    <button class="hm-btn-primary" type="button" data-hm="add-task">Agregar tarea</button>
                </div>
            </div>
        </div>`;
}

function taskEditModal() {
    return `
        <div class="hm-modal-backdrop hm-modal-backdrop--top" data-hm="task-edit-modal" hidden>
            <div class="hm-modal" role="dialog" aria-modal="true" aria-label="Modificar tarea">
                <div class="hm-modal-head">
                    <span class="hm-modal-ico">${svg(IC.edit)}</span>
                    <h3>Modificar tarea</h3>
                    <button class="hm-modal-close" type="button" data-hm="close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="hm-modal-body">
                    <div class="hm-form-grid">
                        <label class="hm-full">Nombre de la tarea
                            <input type="text" data-hm="et-name" placeholder="Nombre de la tarea">
                        </label>
                        <label>Fecha de inicio <input type="date" data-hm="et-date"></label>
                        <label>Horario <input type="time" data-hm="et-time"></label>
                        <label>Repetir <select data-hm="et-repeat">${optionsHTML(REPEAT_OPTS, "Diario")}</select></label>
                        <label>Alerta <select data-hm="et-alert">${optionsHTML(ALERT_OPTS, "Sin alerta")}</select></label>
                        <label class="hm-full">Visibilidad
                            <select data-hm="et-visibility">${visibilityOptionsHTML()}</select>
                        </label>
                    </div>
                    <div class="hm-field-note" data-hm="et-shared-note" hidden></div>
                </div>
                <div class="hm-modal-foot hm-modal-foot--split">
                    <button class="hm-btn-danger" type="button" data-hm="delete-task">${svg(IC.trash, 'stroke-width="2"')} Eliminar tarea</button>
                    <div>
                        <button class="hm-btn-secondary" type="button" data-hm="close">Cancelar</button>
                        <button class="hm-btn-primary" type="button" data-hm="save-task">Guardar cambios</button>
                    </div>
                </div>
            </div>
        </div>`;
}

// ---- Modal de dotación (trabajadores en servicio: día / noche + horario) ----
// Fila de un trabajador en servicio. Las tareas que le asigno el supervisor
// -a mano o por regla predefinida- van en una segunda linea: son las mismas que
// el trabajador ve en su telefono, y aca evitan tener que ir al tablero de
// tareas para saber quien esta haciendo que.
function dotRowHTML(x) {
    const tasks = Array.isArray(x.tasks) ? x.tasks : [];
    const tasksHTML = tasks.length
        ? `<div class="hm-dot-tasks">${tasks
            .map(title => `<span class="hm-dot-task">${esc(title)}</span>`)
            .join("")}</div>`
        : "";

    return `<div class="hm-dot-row"><span class="hm-dot-name">${esc(x.name)}</span>` +
        `<span class="hm-dot-time">${esc(x.time)}</span>${tasksHTML}</div>`;
}

function dotColumnHTML(icon, title, list) {
    return `
        <div class="hm-dot-col">
            <div class="hm-dot-colhead">${icon}<span>${title}</span><b>${list.length}</b></div>
            <div class="hm-dot-list">
                ${list.length ? list.map(dotRowHTML).join("") : `<div class="hm-dot-empty">Sin trabajadores.</div>`}
            </div>
        </div>`;
}

function dotBodyHTML(e) {
    return `
        <div class="hm-dot-cols">
            ${dotColumnHTML(DN_SUN, "De día", e.dia)}
            ${dotColumnHTML(DN_MOON, "De noche", e.noche)}
        </div>`;
}

// Chips para saltar de estamento sin cerrar el modal. Antes habia que cerrarlo,
// apretar otra tarjeta y volver a buscar la fecha: la fecha elegida se perdia en
// cada salto, que es lo caro cuando se esta mirando un dia puntual.
//
// Se listan TODOS los estamentos con gente ese dia, no solo el abierto, y el
// conteo va en el chip para no tener que entrar a cada uno para saber si hay
// alguien. Un estamento que ese dia no tiene a nadie no aparece: el detalle se
// arma solo con quienes estan en servicio.
function dotEstChipsHTML(estamentos, byEstamento, activo) {
    if (estamentos.length <= 1) return "";

    return `
        <div class="hm-dot-chips" role="tablist" aria-label="Estamento">
            ${estamentos.map(est => {
                const detalle = byEstamento[est] || { dia: [], noche: [] };
                const total = detalle.dia.length + detalle.noche.length;
                const activa = est === activo;

                return `<button type="button" class="hm-dot-chip${activa ? " is-active" : ""}"
                    data-hm="dot-est" data-est="${esc(est)}" role="tab"
                    aria-selected="${activa ? "true" : "false"}">${esc(est)}<b>${total}</b></button>`;
            }).join("")}
        </div>`;
}

// ---- Calendario para saltar a otra fecha desde el modal de dotacion ----
//
// Es un mes compacto, dentro del propio modal: elegir "el jueves que viene" a
// punta de flechas es tedioso, y abrir el calendario grande del app obligaria a
// salir de la vista de dotacion y volver.
function dotPickerHTML(view, selectedIso) {
    const year = view.getFullYear();
    const month = view.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // getDay() da 0 en domingo; con la semana en lunes, domingo es la columna 6.
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    const todayIso = todayISO();
    // Feriados ya cargados de ese año. Si aun no llegaron, quedan solo los fines
    // de semana marcados: es informacion de apoyo, no bloquea elegir el dia.
    const holidays = getCachedHolidays(year);
    const cells = new Array(lead).fill('<span class="hm-dp-cell hm-dp-cell--blank"></span>');

    for (let day = 1; day <= daysInMonth; day += 1) {
        const date = new Date(year, month, day);
        const iso = isoFromDate(date);
        const marks = [
            iso === selectedIso ? "is-sel" : "",
            iso === todayIso ? "is-today" : "",
            // Inhabil = fin de semana o feriado. Se pinta en rojo suave para
            // ubicar de un vistazo los dias con dotacion distinta.
            isBusinessDay(date, holidays) ? "" : "is-inhabil"
        ].join(" ").trim();

        cells.push(
            `<button type="button" class="hm-dp-cell ${marks}" data-hm="dot-day"` +
            ` data-iso="${esc(iso)}" aria-pressed="${iso === selectedIso ? "true" : "false"}">${day}</button>`
        );
    }

    return `
        <div class="hm-dp">
            <div class="hm-dp-head">
                <button type="button" data-hm="dot-pm-prev" aria-label="Mes anterior">&#8249;</button>
                <strong>${esc(`${MESES[month]} ${year}`)}</strong>
                <button type="button" data-hm="dot-pm-next" aria-label="Mes siguiente">&#8250;</button>
                <button type="button" class="hm-dp-today" data-hm="dot-today">Hoy</button>
            </div>
            <div class="hm-dp-grid">
                ${DIAS_SEMANA.map(day => `<span class="hm-dp-dow">${day}</span>`).join("")}
                ${cells.join("")}
            </div>
        </div>`;
}

function dotacionModal() {
    return `
        <div class="hm-modal-backdrop" data-hm="inc-modal" hidden>
            <div class="hm-modal hm-modal--dotacion" role="dialog" aria-modal="true" aria-label="Detalle de incidencias">
                <div class="hm-modal-head">
                    <span class="hm-modal-ico">${svg(IC.clipboard)}</span>
                    <h3 data-hm="inc-title">Incidencias</h3>
                    <button class="hm-modal-close" type="button" data-hm="close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="hm-modal-body" data-hm="inc-body"></div>
            </div>
        </div>
        <div class="hm-modal-backdrop" data-hm="dotacion-modal" hidden>
            <div class="hm-modal hm-modal--dotacion" role="dialog" aria-modal="true"
                aria-label="Trabajadores en servicio" tabindex="-1">
                <div class="hm-modal-head">
                    <span class="hm-modal-ico">${svg(IC.users)}</span>
                    <h3 data-hm="dot-title">En servicio hoy</h3>
                    <div class="hm-bday-nav">
                        <button type="button" data-hm="dot-prev" aria-label="Día anterior" title="Día anterior">&#8249;</button>
                        <button type="button" data-hm="dot-next" aria-label="Día siguiente" title="Día siguiente">&#8250;</button>
                    </div>
                    <!--
                        El calendario cuelga del PROPIO boton, no del cuerpo del
                        modal: asi nace de donde se lo apreto y se superpone a la
                        info en vez de empujarla hacia abajo. El ancla es este
                        contenedor relativo.
                    -->
                    <div class="hm-dp-anchor">
                        <button class="hm-modal-action" type="button" data-hm="dot-cal"
                            aria-label="Elegir fecha" title="Elegir otra fecha">${svg(IC.calendar)}</button>
                        <div class="hm-dp-pop" data-hm="dot-picker" hidden></div>
                    </div>
                    <button class="hm-modal-close" type="button" data-hm="close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="hm-modal-body">
                    <div data-hm="dot-body"></div>
                </div>
            </div>
        </div>`;
}

// Estado del modal de dotacion: el estamento abierto, el dia que se esta
// mirando y el mes que muestra el calendario. Vive fuera del modal porque el
// contenido se repinta entero en cada salto de dia.
let dotacionEst = "";
let dotacionDate = new Date();
let dotacionPickerMonth = new Date();
let dotacionPickerOpen = false;

function firstOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function dateFromISO(iso) {
    const [year, month, day] = String(iso).split("-").map(Number);
    return new Date(year, month - 1, day);
}

function dotDateLabel(date) {
    return `${DIAS[date.getDay()]} ${date.getDate()} de ${MESES[date.getMonth()]}`;
}

function renderDotacion(panel) {
    const modal = panel.querySelector('[data-hm="dotacion-modal"]');
    if (!modal) return;

    const detalle = getDotacionDetalle(dotacionDate);
    const e = detalle.byEstamento[dotacionEst];
    const esHoy = keyFromDate(dotacionDate) === keyFromDate(new Date());
    const picker = modal.querySelector('[data-hm="dot-picker"]');
    const chips = dotEstChipsHTML(
        detalle.estamentos,
        detalle.byEstamento,
        dotacionEst
    );

    modal.querySelector('[data-hm="dot-title"]').textContent = esHoy
        ? `${dotacionEst} · en servicio hoy`
        : `${dotacionEst} · en servicio el ${dotDateLabel(dotacionDate)}`;
    modal.querySelector('[data-hm="dot-body"]').innerHTML = chips + (e
        ? dotBodyHTML(e)
        : `<div class="hm-dot-empty">Sin trabajadores en servicio.</div>`);

    picker.innerHTML = dotacionPickerOpen
        ? dotPickerHTML(dotacionPickerMonth, isoFromDate(dotacionDate))
        : "";
    picker.hidden = !dotacionPickerOpen;

    // Los feriados del año que se esta mirando pueden no estar en cache todavia
    // (sobre todo al saltar de año con las flechas). Se pinta con lo que haya
    // -solo fines de semana- y se repinta al llegar, en vez de dejar el
    // calendario esperando o marcando de menos para siempre.
    if (dotacionPickerOpen) {
        void ensureHolidaysLoaded(
            dotacionPickerMonth.getFullYear(),
            () => {
                if (dotacionPickerOpen) renderDotacion(panel);
            }
        );
    }

    // Repintar el calendario borra el boton que se acaba de apretar y con el se
    // va el foco: sin esto, tras elegir un dia las flechas del teclado ya no
    // mueven nada.
    const dialog = modal.querySelector(".hm-modal");

    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
}

// Abre siempre en hoy y con el calendario cerrado, no donde quedo la vez
// anterior: la tarjeta que se acaba de apretar cuenta el dia de hoy.
function openDotacion(panel, est) {
    const modal = panel.querySelector('[data-hm="dotacion-modal"]');
    if (!modal) return;

    dotacionEst = est;
    dotacionDate = new Date();
    dotacionPickerMonth = firstOfMonth(dotacionDate);
    dotacionPickerOpen = false;

    modal.hidden = false;
    renderDotacion(panel);
    modal.querySelector(".hm-modal")?.focus();
}

// Las tarjetas que se pueden reordenar, por el id con que se guarda el orden
// (ver HOME_LAYOUT_DEFAULT en homeLayout.js).
const HOME_CARDS = {
    tareas: tareasWidget,
    ausencias: ausenciasWidget,
    cambios: cambiosWidget,
    solicitudes: solicitudesWidget,
    incidencias: incidenciasWidget,
    cumpleanos: cumpleanosWidget,
    resumen: resumenWidget,
    minical: miniCalendarWidget,
    cobertura: coberturaWidget,
    brecha: brechaWidget
};

// Cada tarjeta lleva su id en la raiz (lo que se arrastra y lo que dice que
// tarjeta se solto) y la manija de cuatro puntos. Una tarjeta que hoy no se
// muestra devuelve "".
function homeCardHTML(id) {
    return withDragHandle(HOME_CARDS[id]?.() || "", id);
}

function wireHomeCardOrder(panel) {
    enableHomeCardDrag(
        panel.querySelector('[data-hm="grid"]'),
        ({ cardId, column, beforeId, card }) => {
            const current = getHomeLayout();
            const next = moveHomeCard(current, cardId, column, beforeId);

            if (!sameHomeLayout(current, next)) void saveHomeLayout(next);

            // Si el inicio se repinto mientras se arrastraba, lo que se solto
            // ya no esta en pantalla: se vuelve a pintar con el orden nuevo.
            if (!card.isConnected) renderHomePanel();
        }
    );
}

function homeHTML() {
    const supervisor = esc(getSupervisorName());
    const unit = esc(getUnitName());
    return `
        <div class="hm-root">
            <section class="hm-hero">
                <div class="hm-greet">
                    <h1>¡Hola, ${supervisor}! 👋</h1>
                    <p>Este es tu resumen diario de ${unit}.</p>
                    <div class="hm-date" data-hm="open-taskcal" role="button" tabindex="0"
                        title="Ver el calendario de tareas">
                        <span class="hm-date-ico">${svg(IC.calendar)}</span>
                        <span><small>Hoy es</small><strong>${esc(todayLabel())}</strong></span>
                        <span class="hm-date-go">${svg(IC.chevron, 'stroke-width="2.4"')}</span>
                    </div>
                </div>
            </section>

            <section class="hm-stats">
                ${statsSection()}
            </section>

            <section class="hm-alertband" data-hm="cobalert-band">${coverageAlertsHTML()}</section>

            <!--
                Tres PILAS, no tres filas. Cada tarjeta se apoya directamente en
                la de arriba de su columna: si "Tareas diarias" tiene una sola
                tarea, "Ausencias del dia" sube hasta pegarse a ella, y si
                manana tiene diez, la empuja hacia abajo.

                Con filas, la altura la imponia la tarjeta mas alta de la fila y
                las cortas quedaban con medio panel en blanco debajo esperando a
                la vecina. Por eso el orden de lectura del DOM es por columna y
                no por fila.

                El orden de fabrica esta en HOME_LAYOUT_DEFAULT (homeLayout.js):
                  Columna 1 (el dia):  tareas -> ausencias -> cambios
                  Columna 2 (el mes):  solicitudes -> marcaje -> cumpleanos
                  Columna 3 (el turno): resumen -> mini calendario -> cobertura
                                        -> brecha
                Cada administrador lo cambia arrastrando las tarjetas desde su
                manija de cuatro puntos (ver homeCardDrag.js) y el suyo queda
                en su propio documento de usuario.

                Abajo de 1100px las pilas se disuelven (display: contents) y las
                tarjetas vuelven a repartirse solas en la grilla de 12.
            -->
            <section class="hm-grid" data-hm="grid">
                ${getHomeLayout().map(column => `
                    <div class="hm-stack">${column.map(homeCardHTML).join("")}</div>`).join("")}
            </section>

        </div>
        ${tasksModal()}
        ${taskEditModal()}
        ${dotacionModal()}
        ${absenceModal()}
        ${weeklyScheduleModal()}
        ${taskCalendarModal()}
        ${dayTasksModal()}
        ${absenceCalendarModal()}
        ${dayAbsencesModal()}
        ${coverageRecipientsModal()}`;
}

// ---- Interactividad ----
function openTaskAdd(panel, date = todayISO(), options = {}) {
    const modal = panel.querySelector('[data-hm="tasks-modal"]');
    if (!modal || !canAuthorTasks()) return;

    modal.classList.toggle("hm-modal-backdrop--top", Boolean(options.top));
    modal.querySelector('[data-hm="nt-name"]').value = "";
    modal.querySelector('[data-hm="nt-date"]').value = date || todayISO();
    modal.querySelector('[data-hm="nt-time"]').value = "08:00";
    modal.querySelector('[data-hm="nt-repeat"]').value = "Diario";
    modal.querySelector('[data-hm="nt-alert"]').value = "15 minutos antes";
    modal.querySelector('[data-hm="nt-visibility"]').value = "private";
    modal.hidden = false;
    modal.querySelector('[data-hm="nt-name"]')?.focus();
}

// Quien comparte la tarea, con el nombre que el supervisor le puso a esa cuenta
// (el de Google puede ser un alias que nadie reconoce).
function taskAuthorName(task) {
    return getAdminDisplayName(task?.createdByEmail) ||
        task?.createdByName ||
        task?.createdByEmail ||
        "otro administrador";
}

function openMedicalEquipmentFromTaskCalendar(equipmentId) {
    const id = String(equipmentId || "");

    if (!id) return;

    selectMedicalEquipment(id);
    document
        .querySelector('.nav-tile[data-target="medicalEquipmentPanel"]')
        ?.click();
}

function openTaskEdit(panel, id) {
    const task = getHomeTasks().find(t => t.id === id);
    if (!task) return;
    const modal = panel.querySelector('[data-hm="task-edit-modal"]');
    if (!modal) return;

    editingTaskId = id;
    modal.querySelector('[data-hm="et-name"]').value = task.name || "";
    modal.querySelector('[data-hm="et-date"]').value = task.date || "";
    modal.querySelector('[data-hm="et-time"]').value = task.time || "08:00";
    modal.querySelector('[data-hm="et-repeat"]').value = task.repeat || "Diario";
    modal.querySelector('[data-hm="et-alert"]').value = task.alert || "Sin alerta";
    modal.querySelector('[data-hm="et-visibility"]').value =
        task.visibility || "private";

    // Dos motivos para abrirlo de solo lectura: el usuario no puede escribir
    // nada en la unidad, o la tarea es de otro (una compartida la edita o borra
    // SOLO quien la creo). Marcar el visto si que pueden los dos: es de cada uno
    // y vive en su documento.
    const readOnlyUser = !canAuthorTasks();
    const editable = canModifyTask(task);
    const note = modal.querySelector('[data-hm="et-shared-note"]');

    modal.querySelectorAll("input, select").forEach(field => {
        field.disabled = !editable;
    });
    modal.querySelectorAll('[data-hm="save-task"], [data-hm="delete-task"]')
        .forEach(button => { button.hidden = !editable; });

    if (note) {
        note.hidden = editable;
        note.textContent = editable
            ? ""
            : (readOnlyUser
                ? "Tu usuario tiene permiso solo de lectura: puedes marcarla como realizada, pero no modificarla."
                : `Compartida por ${taskAuthorName(task)}: solo puedes marcarla como realizada.`);
    }

    modal.hidden = false;
}

function wire(panel) {
    wireHomeCardOrder(panel);

    const tasksList = panel.querySelector('[data-hm="tasks-list"]');
    const refreshTasks = () => {
        // Las tres superficies muestran las mismas tareas: la tarjeta del dia,
        // la grilla del mes y el listado del dia abierto. Modificar una tarea
        // desde cualquiera tiene que verse en las otras dos.
        if (tasksList) tasksList.innerHTML = tasksListHTML();
        reRenderTaskCalendar(panel);
        renderDayTasks(panel);
    };

    // --- Tareas: visto (toggle realizada) + click en la fila (modificar) ---
    if (tasksList) {
        tasksList.addEventListener("click", event => {
            const toggle = event.target.closest('[data-hm="task-toggle"]');
            if (toggle) {
                // El visto se guarda solo (toggleTaskDone escribe ese dia de esa
                // tarea, no la lista entera) y pinta al instante.
                void toggleTaskDone(toggle.dataset.id, todayISO());
                refreshTasks();
                return;
            }
            const row = event.target.closest('[data-hm="task-row"]');
            if (row) openTaskEdit(panel, row.dataset.id);
        });
        tasksList.addEventListener("keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") return;
            const row = event.target.closest('[data-hm="task-row"]');
            if (!row) return;
            event.preventDefault();
            openTaskEdit(panel, row.dataset.id);
        });
    }

    // --- Tareas: modal para MODIFICAR / eliminar (click en la tarea) ---
    const editModal = panel.querySelector('[data-hm="task-edit-modal"]');
    if (editModal) {
        editModal.addEventListener("click", event => {
            if (event.target === editModal || event.target.closest('[data-hm="close"]')) {
                editModal.hidden = true;
                return;
            }
            if (event.target.closest('[data-hm="save-task"]')) {
                if (!editingTaskId) return;
                const nameInput = editModal.querySelector('[data-hm="et-name"]');
                const name = String(nameInput.value || "").trim();
                if (!name) { nameInput.focus(); return; }
                const tasks = getHomeTasks();
                const task = tasks.find(t => t.id === editingTaskId);
                // El boton esta oculto para quien no puede, pero la guarda va
                // igual: la tarea es de toda la unidad y ni un click sintetico
                // ni un usuario de solo lectura pueden reescribirla.
                if (task && canModifyTask(task)) {
                    task.name = name;
                    task.date = editModal.querySelector('[data-hm="et-date"]').value;
                    task.time = editModal.querySelector('[data-hm="et-time"]').value || "08:00";
                    task.repeat = editModal.querySelector('[data-hm="et-repeat"]').value;
                    task.alert = editModal.querySelector('[data-hm="et-alert"]').value;
                    task.visibility = editModal.querySelector('[data-hm="et-visibility"]').value;
                    tasks.sort((a, b) => a.time.localeCompare(b.time));
                    saveHomeTasks(tasks);
                    refreshTasks();
                }
                editModal.hidden = true;
                return;
            }
            if (event.target.closest('[data-hm="delete-task"]')) {
                const task = getHomeTasks().find(t => t.id === editingTaskId);

                if (task && canModifyTask(task)) {
                    // Borrar es la UNICA via por la que una tarea desaparece del
                    // documento: guardar una lista sin ella no la borra.
                    void deleteHomeTask(editingTaskId);
                    refreshTasks();
                }
                editModal.hidden = true;
            }
        });
    }

    // --- Tareas: modal para AGREGAR tareas (icono +) ---
    const modal = panel.querySelector('[data-hm="tasks-modal"]');
    const addOpen = panel.querySelector('[data-hm="tasks-add"]');
    if (addOpen && modal) {
        const closeTaskAdd = () => {
            modal.hidden = true;
            modal.classList.remove("hm-modal-backdrop--top");
        };

        addOpen.addEventListener("click", () => openTaskAdd(panel));
        modal.addEventListener("click", event => {
            if (event.target === modal || event.target.closest('[data-hm="close"]')) {
                closeTaskAdd();
                return;
            }
            if (event.target.closest('[data-hm="add-task"]')) {
                if (!canAuthorTasks()) { closeTaskAdd(); return; }
                const nameInput = modal.querySelector('[data-hm="nt-name"]');
                const name = String(nameInput.value || "").trim();
                if (!name) { nameInput.focus(); return; }
                const tasks = getHomeTasks();
                tasks.push({
                    name,
                    time: modal.querySelector('[data-hm="nt-time"]').value || "08:00",
                    repeat: modal.querySelector('[data-hm="nt-repeat"]').value,
                    date: modal.querySelector('[data-hm="nt-date"]').value,
                    alert: modal.querySelector('[data-hm="nt-alert"]').value,
                    visibility: modal.querySelector('[data-hm="nt-visibility"]').value,
                    doneDates: []
                });
                tasks.sort((a, b) => a.time.localeCompare(b.time));
                saveHomeTasks(tasks);
                refreshTasks();
                closeTaskAdd();
            }
        });
    }

    // --- Dotación: click en una stat card -> modal con día/noche + horario ---
    const stats = panel.querySelector(".hm-stats");
    const dotModal = panel.querySelector('[data-hm="dotacion-modal"]');
    iniciarNotas(panel);
    void cargarIncidencias(panel);

    // --- Incidencias de marcaje: navegacion por mes y detalle por tipo ---
    const incCard = panel.querySelector('[data-hm="inc-list"]')?.closest(".hm-card");
    const incModal = panel.querySelector('[data-hm="inc-modal"]');

    incCard?.addEventListener("click", event => {
        const paso = event.target.closest('[data-hm="inc-prev"], [data-hm="inc-next"]');

        if (paso) {
            const salto = paso.dataset.hm === "inc-next" ? 1 : -1;

            incidenciasMes = new Date(
                incidenciasMes.getFullYear(),
                incidenciasMes.getMonth() + salto,
                1
            );
            void cargarIncidencias(panel);
            return;
        }

        // Cargar el .xls del reloj sin ir a Reportes. Se aprieta el MISMO
        // input que hay alla: una sola forma de cargar el archivo, con su
        // misma lectura, su mismo aviso y su misma proteccion contra repetir
        // marcas que ya estaban.
        if (event.target.closest('[data-hm="inc-import"]')) {
            document.getElementById("attendanceImportInput")?.click();
            return;
        }

        const tipo = event.target.closest('[data-hm="inc-kind"]');

        if (!tipo || !incModal) return;

        const kind = tipo.dataset.kind;
        const label = ATTENDANCE_INCIDENT_KINDS
            .find(item => item.key === kind)?.label || "Incidencias";

        panel.querySelector('[data-hm="inc-title"]').textContent =
            `${label} · ${incidenciasMesLabel(incidenciasMes)}`;
        const cuerpo = panel.querySelector('[data-hm="inc-body"]');

        // Queda anotado para poder repintarlo si los datos cambian mientras
        // esta abierto.
        cuerpo.dataset.kind = kind;
        cuerpo.innerHTML = incidenciasDetalleHTML(kind);
        incModal.hidden = false;
    });

    incModal?.addEventListener("click", event => {
        if (event.target === incModal || event.target.closest('[data-hm="close"]')) {
            incModal.hidden = true;
            return;
        }

        // Ir a ver el caso completo: el calendario y el reporte se abren en el
        // trabajador y en el mes de la incidencia, no donde quedaron la ultima
        // vez que se miraron.
        const salto = event.target
            .closest('[data-hm="inc-cal"], [data-hm="inc-report"]');

        if (salto) {
            incModal.hidden = true;
            window.dispatchEvent(new CustomEvent(
                salto.dataset.hm === "inc-cal"
                    ? "proturnos:viewWorkerRequestInCalendar"
                    : "proturnos:viewWorkerReport",
                {
                    detail: {
                        profile: salto.dataset.profile,
                        date: salto.dataset.iso
                    }
                }
            ));
            return;
        }

        const fila = event.target.closest('[data-hm="inc-row"]');

        if (fila) void alternarIncidenciaDetalle(fila);
    });

    // La programacion semanal es otra tarjeta de la misma fila, asi que
    // comparte estos manejadores y con eso hereda el soporte de teclado.
    const abrirTarjeta = (target) => {
        const dotacion = target.closest('[data-hm="dotacion"]');

        if (dotacion) {
            openDotacion(panel, dotacion.dataset.est);
            return true;
        }

        if (target.closest('[data-hm="open-weekly"]')) {
            openWeeklySchedule(panel);
            return true;
        }

        return false;
    };

    if (stats) {
        stats.addEventListener("click", event => {
            abrirTarjeta(event.target);
        });
        stats.addEventListener("keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") return;
            if (abrirTarjeta(event.target)) event.preventDefault();
        });
    }
    if (dotModal) {
        // Saltar de dia sin cerrar el modal: flechas del encabezado, calendario
        // del mes, o las flechas del teclado.
        const irADia = (date, { cerrarCalendario = false } = {}) => {
            dotacionDate = date;
            dotacionPickerMonth = firstOfMonth(date);
            if (cerrarCalendario) dotacionPickerOpen = false;
            renderDotacion(panel);
        };

        dotModal.addEventListener("click", event => {
            const target = event.target;

            if (target === dotModal || target.closest('[data-hm="close"]')) {
                dotModal.hidden = true;
                return;
            }

            const paso = target.closest('[data-hm="dot-prev"], [data-hm="dot-next"]');

            if (paso) {
                irADia(addDays(dotacionDate, paso.dataset.hm === "dot-next" ? 1 : -1));
                return;
            }

            // Cambiar de estamento CONSERVA la fecha y el calendario como
            // estan: es justamente lo que se perdia al tener que cerrar el
            // modal y abrir otra tarjeta.
            const chip = target.closest('[data-hm="dot-est"]');

            if (chip) {
                dotacionEst = chip.dataset.est;
                renderDotacion(panel);
                return;
            }

            if (target.closest('[data-hm="dot-cal"]')) {
                dotacionPickerOpen = !dotacionPickerOpen;
                dotacionPickerMonth = firstOfMonth(dotacionDate);
                renderDotacion(panel);
                return;
            }

            // El mes del calendario se mueve solo; el dia mirado no cambia
            // hasta que se elija una casilla.
            const mes = target.closest('[data-hm="dot-pm-prev"], [data-hm="dot-pm-next"]');

            if (mes) {
                const salto = mes.dataset.hm === "dot-pm-next" ? 1 : -1;
                dotacionPickerMonth = new Date(
                    dotacionPickerMonth.getFullYear(),
                    dotacionPickerMonth.getMonth() + salto,
                    1
                );
                renderDotacion(panel);
                return;
            }

            if (target.closest('[data-hm="dot-today"]')) {
                irADia(new Date());
                return;
            }

            const dia = target.closest('[data-hm="dot-day"]');

            if (dia) {
                irADia(dateFromISO(dia.dataset.iso), { cerrarCalendario: true });
                return;
            }

            // Ahora que se superpone a la lista, un click en cualquier otro
            // lado lo cierra: dejarlo abierto tapando los trabajadores es
            // justamente lo que se venia a evitar. Antes no hacia falta, porque
            // empujaba la info hacia abajo en vez de cubrirla.
            if (dotacionPickerOpen && !target.closest('[data-hm="dot-picker"]')) {
                dotacionPickerOpen = false;
                renderDotacion(panel);
            }
        });

        dotModal.addEventListener("keydown", event => {
            if (dotModal.hidden) return;

            if (event.key === "Escape") {
                dotModal.hidden = true;
                return;
            }

            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

            event.preventDefault();
            irADia(addDays(dotacionDate, event.key === "ArrowRight" ? 1 : -1));
        });
    }

    // --- Programacion semanal publicada ---
    const weeklyModal = panel.querySelector('[data-hm="weekly-modal"]');

    // El acceso vive en la fila de widgets y lo enlaza el manejador de esa
    // fila; aqui solo queda que hace al abrirse.
    async function openWeeklySchedule() {
        // La MISMA tabla que se ve desde Asignacion de tareas, con sus colores
        // y su boton de imprimir. El inicio tenia su propio visor y las dos
        // superficies mostraban la misma semana de dos formas distintas: quien
        // entraba por aqui no veia los colores con los que se reparte impresa.
        //
        // Abre en la semana de hoy, no donde quedo la vez anterior.
        goToTaskScheduleToday();

        const { openTaskSchedulePreview } =
            await import("./taskSchedulePreview.js");

        openTaskSchedulePreview();
    }

    if (weeklyModal) {
        const irASemana = (week) => {
            weeklyScheduleWeek = week;
            renderWeeklySchedule(panel);
        };

        weeklyModal.addEventListener("click", event => {
            if (
                event.target === weeklyModal ||
                event.target.closest('[data-hm="close"]')
            ) {
                weeklyModal.hidden = true;
                return;
            }

            const paso = event.target.closest('[data-hm="ws-prev"], [data-hm="ws-next"]');

            if (paso) {
                // De a una semana: es la unidad en que se publica. Avanzando se
                // cruza de mes solo, y el titulo dice en cual se esta.
                irASemana(addScheduleDays(
                    weeklyScheduleWeek,
                    paso.dataset.hm === "ws-next" ? 7 : -7
                ));
                return;
            }

            if (event.target.closest('[data-hm="ws-today"]')) {
                irASemana(weekStartMonday(new Date()));
                return;
            }

            const semana = event.target.closest('[data-hm="ws-week"]');

            if (semana) {
                irASemana(new Date(Number(semana.dataset.week)));
            }
        });
    }

    // --- Ausencias: calendario del mes (icono del encabezado) ---
    const absCal = panel.querySelector('[data-hm="abscal-modal"]');
    const dayAbs = panel.querySelector('[data-hm="dayAbs-modal"]');

    panel
        .querySelector('[data-hm="abscal-open"]')
        ?.addEventListener("click", () => {
            if (!absCal) return;

            reRenderAbsenceCalendar(panel);
            absCal.hidden = false;
        });

    if (absCal) {
        absCal.addEventListener("click", event => {
            if (
                event.target === absCal ||
                event.target.closest('[data-hm="close"]')
            ) {
                absCal.hidden = true;
                if (dayAbs) dayAbs.hidden = true;
                return;
            }

            const nav = event.target.closest(
                '[data-hm="ac-prev"], [data-hm="ac-next"]'
            );

            if (nav) {
                const step = nav.dataset.hm === "ac-next" ? 1 : -1;
                // Con Date, diciembre -> enero salta de año solo.
                const next = new Date(absCalYear, absCalMonth + step, 1);

                absCalYear = next.getFullYear();
                absCalMonth = next.getMonth();
                reRenderAbsenceCalendar(panel);
                return;
            }

            const cell = event.target.closest('[data-hm="abscal-day"]');

            if (cell) openDayAbsences(panel, cell.dataset.iso);
        });
        absCal.addEventListener("keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") return;

            const cell = event.target.closest('[data-hm="abscal-day"]');

            if (!cell) return;

            event.preventDefault();
            openDayAbsences(panel, cell.dataset.iso);
        });
    }

    if (dayAbs) {
        dayAbs.addEventListener("click", event => {
            if (
                event.target === dayAbs ||
                event.target.closest('[data-hm="close"]')
            ) {
                dayAbs.hidden = true;
            }
        });
    }

    // --- Ausencias: click en la tarjeta -> modal con trabajadores y acceso al calendario ---
    const absenceList = panel.querySelector('[data-hm="absence-list"]');
    const absenceModalEl = panel.querySelector('[data-hm="absence-modal"]');
    if (absenceList) {
        absenceList.addEventListener("click", event => {
            const row = event.target.closest('[data-hm="absence-summary"]');
            if (!row) return;
            openAbsenceDetail(panel, row.dataset.absenceCat);
        });
    }
    if (absenceModalEl) {
        absenceModalEl.addEventListener("click", event => {
            const button = event.target.closest('[data-hm="absence-ver"]');
            if (button) {
                absenceModalEl.hidden = true;
                window.dispatchEvent(
                    new CustomEvent("proturnos:viewWorkerRequestInCalendar", {
                        detail: {
                            profile: button.dataset.absenceProfile,
                            date: button.dataset.absenceIso
                        }
                    })
                );
                return;
            }

            if (event.target === absenceModalEl || event.target.closest('[data-hm="close"]')) {
                absenceModalEl.hidden = true;
            }
        });
    }

    panel.querySelectorAll('[data-hm="swap-detail"]').forEach(button => {
        button.addEventListener("click", () => {
            const swap = getMonthSwaps().find(item =>
                String(item.id || "") === String(button.dataset.swapId || "")
            );

            if (!swap) {
                renderHomePanel();
                return;
            }

            openHomeSwapDetailDialog(swap);
        });
    });

    // --- Brecha RRHH: plegar el detalle ---
    const brechaSwitch = panel.querySelector('[data-hm="brecha-detail"]');

    if (brechaSwitch) {
        brechaSwitch.addEventListener("change", () => {
            brechaDetail = brechaSwitch.checked;
            reRenderBrecha(panel);
        });
    }

    // --- Brecha RRHH: cubrir el cargo sin salir del inicio ---
    //
    // Abre el mismo modal de sugerencias del calendario, en su modo de cupo de
    // rotativa: lo que salga de ahi es un turno extra con motivo, no el
    // reemplazo de una persona ausente.
    panel.querySelectorAll('[data-hm="brecha-cubrir"]').forEach(button => {
        button.addEventListener("click", () => {
            const estamento = button.dataset.brechaEstamento;
            const group = button.dataset.brechaGroup;

            window.openReplacementDialog?.(
                button.dataset.brechaReference,
                button.dataset.brechaKey,
                {
                    rota: {
                        group,
                        estamento,
                        turno: Number(button.dataset.brechaTurno),
                        motive: `Completar rotativa de ${
                            BRECHA_PLURAL[estamento] || `${estamento.toLowerCase()}s`
                        } del grupo ${group}`
                    }
                }
            );
        });
    });

    // --- Brecha RRHH: ver la semana de ese turno ---
    panel.querySelectorAll('[data-hm="brecha-semanal"]').forEach(button => {
        button.addEventListener("click", () => {
            const [year, month, day] = String(button.dataset.brechaIso)
                .split("-")
                .map(Number);

            showStaffingWeekFor(new Date(year, month - 1, day));
        });
    });

    // --- Cobertura: ver el dia en el calendario ---
    panel.querySelectorAll('[data-hm="cob-ver"]').forEach(button => {
        button.addEventListener("click", () => {
            // Mismo evento que usa "ver en el calendario" de las solicitudes:
            // salta al mes, selecciona al trabajador y abre Turnos.
            window.dispatchEvent(
                new CustomEvent("proturnos:viewWorkerRequestInCalendar", {
                    detail: {
                        profile: button.dataset.cobProfile,
                        date: button.dataset.cobIso
                    }
                })
            );
        });
    });

    // --- Cobertura: detalle de la solicitud ya enviada ---
    panel.querySelectorAll('[data-hm="cob-espera"]').forEach(button => {
        button.addEventListener("click", () => {
            window.openPendingRequestsDialog?.({
                profile: button.dataset.cobProfile,
                keyDay: button.dataset.cobKey
            });
        });
    });

    // --- Cobertura: solicitud masiva a los candidatos con la app enlazada ---
    panel.querySelectorAll('[data-hm="cob-auto"]').forEach(button => {
        button.addEventListener("click", async () => {
            const label = button.textContent;

            button.disabled = true;
            button.textContent = "ENVIANDO...";

            try {
                const result = await window.runAutomaticCoverage?.(
                    button.dataset.cobProfile,
                    button.dataset.cobKey
                );

                announceAutomaticCoverage(result);
            } catch (error) {
                console.warn("No se pudo enviar la cobertura automatica.", error);
                announceAutomaticCoverage({ status: "error" });
            } finally {
                button.disabled = false;
                button.textContent = label;
            }

            renderHomePanel();
        });
    });

    // --- Alerta de cobertura: las dos acciones del recuadro ---
    panel.querySelectorAll('[data-hm="cobalert-ver"]').forEach(button => {
        button.addEventListener("click", () => {
            window.dispatchEvent(
                new CustomEvent("proturnos:viewWorkerRequestInCalendar", {
                    detail: {
                        profile: button.dataset.cobProfile,
                        date: button.dataset.cobIso
                    }
                })
            );
        });
    });

    panel.querySelectorAll('[data-hm="cobalert-who"]').forEach(button => {
        button.addEventListener("click", () => {
            openCoverageRecipients(panel, button.dataset.cobCampaign);
        });
    });

    // --- Calendario de tareas: se abre desde la fecha del encabezado ---
    const taskCal = panel.querySelector('[data-hm="taskcal-modal"]');
    const dayTasks = panel.querySelector('[data-hm="dayTasks-modal"]');

    if (taskCal) {
        const showTaskCalendar = () => {
            reRenderTaskCalendar(panel);
            taskCal.hidden = false;
            void ensureHolidaysLoaded(
                taskCalYear,
                () => reRenderTaskCalendar(panel)
            );
        };
        const openCalendar = () => {
            // Siempre abre en el mes de hoy, no donde quedo la vez anterior:
            // se entra por "Hoy es ...".
            const now = new Date();

            taskCalYear = now.getFullYear();
            taskCalMonth = now.getMonth();
            showTaskCalendar();
        };
        // El mini calendario abre en el mes que se esta mirando en el: si se
        // avanzo a octubre, lo que se quiere ver son las tareas de octubre.
        const openCalendarAtMiniMonth = () => {
            taskCalYear = miniCalYear;
            taskCalMonth = miniCalMonth;
            showTaskCalendar();
        };

        // Dos puertas al mismo calendario: la fecha del encabezado y la grilla
        // del mini calendario.
        panel.querySelectorAll('[data-hm="open-taskcal"]').forEach(trigger => {
            const open = trigger.dataset.taskcalFrom === "minical"
                ? openCalendarAtMiniMonth
                : openCalendar;

            trigger.addEventListener("click", open);
            trigger.addEventListener("keydown", event => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                open();
            });
        });
    }

    // --- Mini calendario: avanzar y retroceder de mes ---
    panel
        .querySelectorAll('[data-hm="minical-prev"], [data-hm="minical-next"]')
        .forEach(button => {
            button.addEventListener("click", () => {
                const step = button.dataset.hm === "minical-next" ? 1 : -1;
                // Con Date, diciembre -> enero salta de año solo.
                const next = new Date(miniCalYear, miniCalMonth + step, 1);

                miniCalYear = next.getFullYear();
                miniCalMonth = next.getMonth();
                reRenderMiniCalendar(panel);
                // Un año nuevo trae sus propios feriados.
                void ensureHolidaysLoaded(
                    miniCalYear,
                    () => reRenderMiniCalendar(panel)
                );
            });
        });

    if (taskCal) {
        taskCal.addEventListener("click", event => {
            if (event.target === taskCal || event.target.closest('[data-hm="close"]')) {
                taskCal.hidden = true;
                if (dayTasks) dayTasks.hidden = true;
                return;
            }

            const nav = event.target.closest('[data-hm="tc-prev"], [data-hm="tc-next"]');

            if (nav) {
                const step = nav.dataset.hm === "tc-next" ? 1 : -1;
                // Con Date, diciembre -> enero salta de año solo.
                const next = new Date(taskCalYear, taskCalMonth + step, 1);

                taskCalYear = next.getFullYear();
                taskCalMonth = next.getMonth();
                reRenderTaskCalendar(panel);
                void ensureHolidaysLoaded(
                    taskCalYear,
                    () => reRenderTaskCalendar(panel)
                );
                return;
            }

            const cell = event.target.closest('[data-hm="taskcal-day"]');

            if (cell) openDayTasks(panel, cell.dataset.iso);
        });
        taskCal.addEventListener("keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") return;

            const cell = event.target.closest('[data-hm="taskcal-day"]');

            if (!cell) return;

            event.preventDefault();
            openDayTasks(panel, cell.dataset.iso);
        });
    }

    if (dayTasks) {
        const editFromDay = id => {
            openTaskEdit(panel, id);
            // El listado queda abierto detras: al guardar se vuelve al dia.
        };
        const addFromDay = () => {
            if (!openDayIso) return;
            openTaskAdd(panel, openDayIso, { top: true });
        };

        dayTasks.addEventListener("click", event => {
            // Cerrar el listado del dia deja el calendario abierto detras.
            if (event.target === dayTasks || event.target.closest('[data-hm="close"]')) {
                dayTasks.hidden = true;
                openDayIso = "";
                return;
            }

            if (event.target.closest('[data-hm="dt-add"]')) {
                addFromDay();
                return;
            }

            const equipmentRow = event.target.closest('[data-hm="dt-medeq-row"]');

            if (equipmentRow) {
                openMedicalEquipmentFromTaskCalendar(equipmentRow.dataset.equipmentId);
                return;
            }

            const toggle = event.target.closest('[data-hm="dt-toggle"]');

            if (toggle) {
                // El visto se marca CONTRA EL DIA ABIERTO, no contra hoy: desde
                // el calendario se cierra el 27 estando parado en el 20.
                void toggleTaskDone(toggle.dataset.id, openDayIso);
                refreshTasks();
                return;
            }

            const row = event.target.closest('[data-hm="dt-row"]');

            if (row) editFromDay(row.dataset.id);
        });
        dayTasks.addEventListener("keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") return;

            const equipmentRow = event.target.closest('[data-hm="dt-medeq-row"]');

            if (equipmentRow) {
                event.preventDefault();
                openMedicalEquipmentFromTaskCalendar(equipmentRow.dataset.equipmentId);
                return;
            }

            const row = event.target.closest('[data-hm="dt-row"]');

            if (!row) return;

            event.preventDefault();
            editFromDay(row.dataset.id);
        });
    }

    // --- Cumpleaños: navegar de mes en mes sin repintar todo el panel ---
    panel.querySelectorAll('[data-hm="bday-prev"], [data-hm="bday-next"]')
        .forEach(button => {
            button.addEventListener("click", () => {
                const step = button.dataset.hm === "bday-next" ? 1 : -1;
                // Con Date, diciembre -> enero salta de año solo.
                const next = new Date(birthdayYear, birthdayMonth + step, 1);

                birthdayYear = next.getFullYear();
                birthdayMonth = next.getMonth();
                reRenderBirthdays(panel);
            });
        });

    // --- Cobertura: switch de detalles (siempre muestra sin cubrir + preasignados) ---
    const detail = panel.querySelector('[data-hm="cob-detail"]');
    if (detail) {
        detail.addEventListener("change", () => {
            coverageDetail = detail.checked;
            reRenderCoverage(panel);
        });
    }

    const requestDetail = panel.querySelector('[data-hm="req-detail"]');
    if (requestDetail) {
        requestDetail.addEventListener("change", () => {
            requestsDetail = requestDetail.checked;
            reRenderRequestsSummary(panel);
        });
    }

    panel.querySelector('[data-hm="req-open"]')?.addEventListener("click", () => {
        document.querySelector('.nav-tile[data-target="workerRequestsPanel"]')?.click();
    });

    panel.querySelectorAll('[data-hm="req-accept"], [data-hm="req-reject"]')
        .forEach(button => {
            button.addEventListener("click", async () => {
                const requestId = button.dataset.requestId || "";
                if (!requestId) return;

                const actions = button.closest(".hm-req-row-actions");
                actions?.querySelectorAll("button").forEach(item => {
                    item.disabled = true;
                });

                const accepted = button.dataset.hm === "req-accept";
                const ok = accepted
                    ? await acceptWorkerRequestById(requestId)
                    : await rejectWorkerRequestById(requestId);

                if (!ok) {
                    actions?.querySelectorAll("button").forEach(item => {
                        item.disabled = false;
                    });
                    return;
                }

                renderHomePanel();
                window.dispatchEvent(new CustomEvent("proturnos:workerRequestsChanged"));
            });
        });

    // --- Cobertura: confirmar / cancelar un turno preasignado sin salir del inicio ---
    panel.querySelectorAll('[data-hm="cob-confirm"], [data-hm="cob-cancel"]')
        .forEach(button => {
            button.addEventListener("click", () => {
                const preassignment = getPreassignments().find(item =>
                    String(item.id) === button.dataset.preassignId
                );

                if (!preassignment) {
                    renderHomePanel();
                    return;
                }

                const confirmar = button.dataset.hm === "cob-confirm";
                const worker = preassignment.worker;
                const replaced = preassignment.replaced;
                const keyDay = keyFromISO(preassignment.date);
                const done = confirmar
                    ? confirmPreassignment(preassignment)
                    : cancelPreassignment(preassignment);

                if (!done) return;

                // refreshAll solo repinta la vista ACTIVA, y aca la activa es
                // el inicio: calendario y timeline quedaban con el marcador de
                // preasignado hasta recargar. Se actualizan sus casillas igual
                // que hace el modal del calendario, aunque esten ocultos.
                void (async () => {
                    await updateDayCell(replaced, keyDay);

                    if (worker && worker !== replaced) {
                        await updateDayCell(worker, keyDay);
                    }

                    updateTimelineCells(replaced, [keyDay]);

                    if (worker) updateTimelineCells(worker, [keyDay]);

                    await updateVisibleCalendarDays({ updateSummary: true });
                })();

                refreshAll();
                renderHomePanel();
            });
        });
}

// Cada resultado necesita su propio mensaje: "no se envio nada" por falta de
// candidatos no es lo mismo que porque ninguno tiene la app.
function announceAutomaticCoverage(result) {
    const toast = (text, options) =>
        (window.showAppToast || (message => alert(message)))(text, options);

    if (!result || result.status === "error") {
        toast("No se pudo iniciar la cobertura automática.", {
            title: "Cobertura automática",
            variant: "warn"
        });
        return;
    }

    if (result.status === "disabled") {
        toast(
            "La solicitud de aprobación al trabajador está desactivada en la configuración del entorno.",
            { title: "Cobertura automática", variant: "warn" }
        );
        return;
    }

    if (result.status === "already-running") {
        toast(
            "Ese turno ya tiene una cobertura automática en curso; sigue sola hasta que alguien acepte.",
            { title: "Cobertura automática", variant: "warn" }
        );
        return;
    }

    if (result.status === "nothing-to-cover") {
        toast("Ese turno ya no necesita cobertura.", {
            title: "Cobertura automática",
            variant: "warn"
        });
        return;
    }

    if (result.status === "canceled" || result.status === "invalid") {
        toast("No se pudo calcular los candidatos de ese turno.", {
            title: "Cobertura automática",
            variant: "warn"
        });
        return;
    }

    // El plazo decide el camino: con mas de 72 h se reparte por tercios, con
    // menos se manda de una a todos. Decirlo evita que el supervisor crea que
    // el boton "solo mando a tres personas".
    const plan = result.path === "short"
        ? "Faltan menos de 72 h: la solicitud salió a todos los que pueden cubrirlo."
        : "Primera etapa: el tercio con menos horas extras del mes del turno. Si nadie acepta, en 24 h sale la segunda y en 48 h la masiva.";

    if (!result.sent) {
        // "Nadie puede cubrir" y "todos pasarían el tope" se resuelven
        // distinto: el segundo se arregla repartiendo el turno, no buscando más
        // gente.
        const motivo = result.poolSize
            ? "Los candidatos de esta etapa no tienen la app enlazada o ya tenían una solicitud pendiente."
            : result.overLimit
                ? `Los ${result.overLimit} candidatos superarían las 40 horas extras diurnas del mes con este turno.`
                : "No hay trabajadores que puedan cubrir ese turno.";

        toast(
            `${motivo} La cobertura queda en curso y avanza a la etapa siguiente en 24 h.`,
            { title: "Cobertura automática", variant: "warn" }
        );
        return;
    }

    toast(
        `Solicitud enviada a ${result.sent} trabajador(es). ${plan}`,
        { title: "Cobertura automática", variant: "good" }
    );
}

function reRenderBirthdays(panel) {
    const { heading, count, list } = birthdaysBody();
    const monthEl = panel.querySelector('[data-hm="bday-month"]');
    const countEl = panel.querySelector('[data-hm="bday-count"]');
    const listEl = panel.querySelector('[data-hm="bday-list"]');

    if (monthEl) monthEl.textContent = heading;
    if (countEl) countEl.textContent = String(count);
    if (listEl) listEl.innerHTML = list;
}

function reRenderCoverage(panel) {
    // Por el interruptor, no por el ancho: la tarjeta cambio de columnas al
    // pasar al tablero de tres y un selector por .hm-col-N vuelve a romperse
    // en el proximo ajuste de layout.
    const card = panel.querySelector('[data-hm="cob-detail"]')?.closest(".hm-card");
    if (!card) return;
    const summary = card.querySelector(".hm-cob-summary");
    const list = card.querySelector(".hm-cob-list");

    if (summary) summary.hidden = coverageDetail;
    if (list) list.hidden = !coverageDetail;
}

function reRenderBrecha(panel) {
    // Por el interruptor y no por .hm-col-N: la tarjeta cambia de columna
    // segun el ancho y un selector por columna se rompe en el proximo ajuste.
    const card = panel
        .querySelector('[data-hm="brecha-detail"]')
        ?.closest(".hm-card");

    if (!card) return;

    const summary = card.querySelector(".hm-cob-summary");
    const list = card.querySelector(".hm-cob-list");

    if (summary) summary.hidden = brechaDetail;
    if (list) list.hidden = !brechaDetail;
}

function reRenderRequestsSummary(panel) {
    const control = panel.querySelector('[data-hm="req-detail"]');
    const card = control?.closest(".hm-card");
    if (!card) return;

    const summary = card.querySelector(".hm-req-summary");
    const list = card.querySelector(".hm-req-list");

    if (summary) summary.hidden = requestsDetail;
    if (list) list.hidden = !requestsDetail;
}

function shouldRefreshMedicalEquipmentCalendar(event) {
    const keys = event?.detail?.keys;

    return !Array.isArray(keys) ||
        !keys.length ||
        keys.includes(MEDICAL_EQUIPMENT_KEY);
}

function refreshTaskCalendarSurfaces(panel = document.getElementById("homePanel")) {
    if (!panel) return;

    reRenderTaskCalendar(panel);
    renderDayTasks(panel);
}

if (typeof window !== "undefined") {
    const refreshMedicalEquipmentCalendar = event => {
        if (!shouldRefreshMedicalEquipmentCalendar(event)) return;

        refreshTaskCalendarSurfaces();
    };

    window.addEventListener(
        "proturnos:medicalEquipmentChanged",
        refreshMedicalEquipmentCalendar
    );
    window.addEventListener(
        "proturnos:workspacePermissionsChanged",
        refreshMedicalEquipmentCalendar
    );
    window.addEventListener(
        "proturnos:persistenceChanged",
        refreshMedicalEquipmentCalendar
    );
}

// Refresca los listados de tareas y el calendario (para el sync remoto de Firestore).
export function refreshHomeTasks() {
    const panel = document.getElementById("homePanel");
    const list = panel?.querySelector('[data-hm="tasks-list"]');

    if (list) list.innerHTML = tasksListHTML();
    refreshTaskCalendarSurfaces(panel);
}

export function renderHomePanel() {
    const panel = document.getElementById("homePanel");
    if (!panel) return;

    panel.innerHTML = homeHTML();
    wire(panel);

    // La tarjeta del dia tambien filtra por "Diario Hábil": sin los feriados
    // cargados, una tarea habil apareceria en un feriado hasta el repintado.
    const year = new Date().getFullYear();

    void ensureHolidaysLoaded(year, () => {
        const list = panel.querySelector('[data-hm="tasks-list"]');

        if (list) list.innerHTML = tasksListHTML();
        // El mini calendario tambien marca los feriados: si todavia no estaban
        // cargados, se pinto sin ellos.
        reRenderMiniCalendar(panel);
    });

    // Si el mini calendario quedo en otro año (se avanzo de diciembre a
    // enero), sus feriados son otros.
    if (miniCalYear !== year) {
        void ensureHolidaysLoaded(miniCalYear, () => reRenderMiniCalendar(panel));
    }
}

if (typeof window !== "undefined") {
    // Otro equipo del mismo administrador cambio el orden de las tarjetas. No
    // se reordena en la cara de quien esta arrastrando o tiene un modal
    // abierto: en ese caso se aplica en el proximo pintado.
    window.addEventListener(HOME_LAYOUT_EVENT, () => {
        const panel = document.getElementById("homePanel");

        if (!panel?.querySelector('[data-hm="grid"]')) return;
        if (isHomeCardDragActive()) return;
        if (panel.querySelector(".hm-modal-backdrop:not([hidden])")) return;

        renderHomePanel();
    });
}
