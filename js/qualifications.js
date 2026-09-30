import { escapeHTML } from "./htmlUtils.js";
import { getJSON, setJSON } from "./persistence.js";
import {
    getProfiles,
    getReplacements,
    isProfileActive
} from "./storage.js";
import { getTurnoReal } from "./turnEngine.js";
import { TURNO_LABEL } from "./constants.js";
import { replacementActive } from "./replacements.js";
import {
    formatDisplayDate,
    keyToDate,
    parseISODate,
    toISODate
} from "./dateUtils.js";
import { buildAttendanceIncidents } from "./hoursReport.js";
import { getShiftAttendance } from "./shiftAttendance.js";
import { esAusenciaInjustificada } from "./rulesEngine.js";
import { canEditMenu } from "./workspacePermissions.js";
import { getActiveWorkspace } from "./workspaces.js";
import {
    ATTACHMENT_ACCEPT,
    attachmentStorageErrorMessage,
    deleteStoredAttachment,
    hasAttachmentContent,
    openAttachmentFile,
    readAttachmentFiles
} from "./attachmentUtils.js";
import { showAlert, showConfirm } from "./dialogs.js";
import {
    printQualificationForm,
    qualificationFormHTML
} from "./qualificationForm.js";

export const QUALIFICATIONS_KEY = "qualifications";

const STATUS_ALL = "all";
const STATUS_PENDING = "pending";
const STATUS_DRAFT = "draft";
// `evaluated` era el estado final cuando la evaluacion se cerraba dentro de la
// aplicacion. Ahora el cierre lo da el PAPEL: se imprime, lo firman las dos
// partes a mano y vuelve escaneado. Se conserva el nombre viejo para no
// invalidar los registros que ya existen y se leen como "impresa".
const STATUS_EVALUATED = "evaluated";
const STATUS_PRINTED = "printed";
const STATUS_ARCHIVED = "archived";

// La calificacion CON NOTAS es otro instrumento y ocurre una vez al ano, en
// septiembre, apoyada en los tres informes cuatrimestrales ya escritos
// (art. 19). Vive como un "periodo" mas para reutilizar el mismo almacen.
export const ANNUAL_PERIOD_ID = "anual";
const MAX_NOTE_LENGTH = 1600;
const MAX_TEXT_LENGTH = 240;

export const QUALIFICATION_FACTORS = [
    {
        key: "rendimiento",
        label: "Rendimiento",
        detail: "Trabajo ejecutado frente a tareas encomendadas.",
        // Calcado del formulario que reparte la unidad de personal.
        formTitle: "RENDIMIENTO",
        formText: "Mide el trabajo ejecutado durante el periodo en relacion a las tareas encomendadas (Cantidad de trabajo y Calidad de la labor realizada)",
        subfactors: [
            {
                key: "cumplimiento_labor",
                label: "Cumplimiento de la labor",
                detail: "Realizacion, rapidez y oportunidad."
            },
            {
                key: "calidad_labor",
                label: "Calidad de la labor",
                detail: "Ausencia de errores y habilidad."
            }
        ]
    },
    {
        key: "condiciones",
        label: "Condiciones personales",
        detail: "Actitud del funcionario en su vinculacion con los demas.",
        formTitle: "CONDICIONES PERSONALES",
        formText: "Evaluar las aptitudes del funcionario vinculadas con el cumplimiento de las funciones (Condiciones e interes por el trabajo que realiza. Capacidad para realizar trabajos en grupo)",
        subfactors: [
            {
                key: "interes_trabajo",
                label: "Interes por el trabajo",
                detail: "Perfeccionamiento, propuestas y soluciones."
            },
            {
                key: "trabajo_equipo",
                label: "Trabajo en equipo",
                detail: "Integracion y colaboracion eficaz."
            }
        ]
    },
    {
        key: "comportamiento",
        label: "Comportamiento del funcionario",
        detail: "Conducta en el cumplimiento de obligaciones.",
        formTitle: "COMPORTAMIENTO DEL FUNCIONARIO",
        // La errata del original ("del funcionamiento") se conserva: el papel
        // que archiva personal tiene que ser el que ellos reparten.
        formText: "Evaluar la conducta del funcionamiento en el cumplimiento de sus obligaciones (Asistencia y Puntualidad, Responsabilidad, Cumplimiento de normas)",
        subfactors: [
            {
                key: "normas_instrucciones",
                label: "Normas e instrucciones",
                detail: "Respeto de reglamentos y deberes."
            },
            {
                key: "asistencia_puntualidad",
                label: "Asistencia y puntualidad",
                detail: "Presencia y exactitud en la jornada."
            }
        ]
    }
];

export const QUALIFICATION_COEFFICIENTS = Object.freeze({
    directivos: {
        label: "Directivos",
        rendimiento: 4.5,
        condiciones: 3.5,
        comportamiento: 2
    },
    profesionales_tecnicos: {
        label: "Profesionales y tecnicos",
        rendimiento: 4,
        condiciones: 3.5,
        comportamiento: 2.5
    },
    administrativos_auxiliares: {
        label: "Administrativos y auxiliares",
        rendimiento: 4,
        condiciones: 3,
        comportamiento: 3
    }
});

const PERIOD_DEFS = [
    {
        id: "sep-dec",
        label: "Septiembre a diciembre",
        shortLabel: "Sep-Dic",
        startMonth: 8,
        startDay: 1,
        endMonth: 11,
        endDay: 31,
        yearOffset: 0
    },
    {
        id: "jan-apr",
        label: "Enero a abril",
        shortLabel: "Ene-Abr",
        startMonth: 0,
        startDay: 1,
        endMonth: 3,
        endDay: 30,
        yearOffset: 1
    },
    {
        id: "may-aug",
        label: "Mayo a agosto",
        shortLabel: "May-Ago",
        startMonth: 4,
        startDay: 1,
        endMonth: 7,
        endDay: 31,
        yearOffset: 1
    }
];

let selectedCycleStartYear = evaluationCycleStartYear();
let selectedPeriodId = currentPeriodId(new Date(), selectedCycleStartYear);
let selectedStatus = STATUS_ALL;
// Trabajador con la ficha ABIERTA. Vacio = se ve la bandeja.
let openProfileKey = "";
// Cual de los tres informes cuatrimestrales se lee desplegado en la anual.
let openReportId = "";
let searchText = "";
let searchRenderTimer = null;
let incidentCache = {
    key: "",
    loading: false,
    eventsByProfile: new Map()
};

function clampText(value, maxLength = MAX_TEXT_LENGTH) {
    return String(value || "").trim().slice(0, maxLength);
}

function escapeAttribute(value) {
    return escapeHTML(value).replace(/`/g, "&#096;");
}

function compactKey(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function rutKey(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^0-9k]+/g, "");
}

function profileKey(profile = {}) {
    return (
        rutKey(profile.rut) ||
        compactKey(profile.id) ||
        compactKey(profile.name)
    );
}

function makeId(prefix = "qualification") {
    return globalThis.crypto?.randomUUID?.() ||
        `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// Las tres apreciaciones escritas del informe cuatrimestral. Es lo unico que
// lleva ese instrumento: las notas van en la calificacion anual.
function normalizeAppraisals(values = {}) {
    return QUALIFICATION_FACTORS.reduce((map, factor) => {
        map[factor.key] = clampText(values?.[factor.key], MAX_NOTE_LENGTH);
        return map;
    }, {});
}

// El formulario firmado que vuelve escaneado. Se guarda la misma forma que el
// resto de adjuntos del proyecto para poder abrirlo con attachmentUtils.
function normalizeScan(value = {}) {
    const name = clampText(value?.name, 240);
    const storagePath = String(value?.storagePath || "");
    const downloadURL = String(value?.downloadURL || "");
    const dataUrl = String(value?.dataUrl || "");

    if (!name || (!storagePath && !downloadURL && !dataUrl)) return null;

    return {
        id: String(value.id || makeId("qual_scan")),
        name,
        type: String(value.type || "application/octet-stream").toLowerCase(),
        size: Number(value.size) || 0,
        addedAt: String(value.addedAt || new Date().toISOString()),
        storagePath,
        downloadURL,
        dataUrl,
        uploadedByUid: String(value.uploadedByUid || "")
    };
}

function validStatus(status) {
    return [
        STATUS_DRAFT,
        STATUS_EVALUATED,
        STATUS_PRINTED,
        STATUS_ARCHIVED
    ].includes(status)
        ? status
        : STATUS_DRAFT;
}

function normalizePlainText(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function normalizeScore(value) {
    if (value === "" || value === null || value === undefined) return "";

    const score = Number(value);

    if (!Number.isFinite(score)) return "";

    return Math.min(10, Math.max(1, Math.round(score)));
}

function scoreNumber(value) {
    if (value === "" || value === null || value === undefined) return NaN;

    const score = Number(value);

    return Number.isFinite(score) ? score : NaN;
}

function factorComputedScore(factorValue = {}) {
    const source = factorValue && typeof factorValue === "object"
        ? factorValue
        : {};
    const scores = Object.values(source.subfactors || {})
        .map(item => scoreNumber(item?.score))
        .filter(Number.isFinite);

    if (!scores.length) return scoreNumber(source.score);

    return Number(
        (
            scores.reduce((sum, value) => sum + value, 0) / scores.length
        ).toFixed(2)
    );
}

function normalizeFactorValues(values = {}) {
    return QUALIFICATION_FACTORS.reduce((map, factor) => {
        const source = values?.[factor.key] || {};
        const subfactorSource =
            source.subfactors && typeof source.subfactors === "object"
                ? source.subfactors
                : {};
        const subfactors = {};

        factor.subfactors.forEach(subfactor => {
            subfactors[subfactor.key] = {
                score: normalizeScore(
                    subfactorSource?.[subfactor.key]?.score
                ),
                comment: clampText(
                    subfactorSource?.[subfactor.key]?.comment,
                    MAX_NOTE_LENGTH
                )
            };
        });

        const computedScore = factorComputedScore({ subfactors });
        const fallbackScore = normalizeScore(source.score);

        map[factor.key] = {
            score: Number.isFinite(computedScore)
                ? computedScore
                : fallbackScore,
            subfactors,
            comment: clampText(source.comment, MAX_NOTE_LENGTH)
        };

        return map;
    }, {});
}

function normalizeRecord(record = {}) {
    const cycleStartYear = Number(record.cycleStartYear);

    if (!record?.profileKey || !record?.periodId || !cycleStartYear) {
        return null;
    }

    return {
        id: String(record.id || makeId()),
        profileKey: String(record.profileKey),
        profileName: clampText(record.profileName, 180),
        profileRut: clampText(record.profileRut, 40),
        cycleStartYear,
        periodId: String(record.periodId),
        status: validStatus(record.status),
        // Las notas SOLO las usa la calificacion anual. En un informe
        // cuatrimestral quedan en cero y no se muestran; el campo se conserva
        // porque los registros creados antes de esta separacion las traen.
        factors: normalizeFactorValues(record.factors),
        appraisals: normalizeAppraisals(record.appraisals),
        scan: normalizeScan(record.scan),
        supervisorName: clampText(record.supervisorName, 180),
        supervisorCargo: clampText(record.supervisorCargo, 180),
        observations: clampText(record.observations, MAX_NOTE_LENGTH),
        employeeObservations: clampText(
            record.employeeObservations,
            MAX_NOTE_LENGTH
        ),
        employeeAgreement: record.employeeAgreement === false
            ? "disconforme"
            : record.employeeAgreement === true
                ? "conforme"
                : String(record.employeeAgreement || ""),
        createdAt: String(record.createdAt || new Date().toISOString()),
        updatedAt: String(record.updatedAt || new Date().toISOString()),
        evaluatedAt: String(record.evaluatedAt || "")
    };
}

export function normalizeQualificationState(value = {}) {
    const rawRecords = value?.records && typeof value.records === "object"
        ? value.records
        : {};
    const records = {};

    Object.entries(rawRecords).forEach(([id, record]) => {
        const normalized = normalizeRecord({
            ...record,
            id: record?.id || id
        });

        if (normalized) records[normalized.id] = normalized;
    });

    return { records };
}

export function getQualificationState() {
    return normalizeQualificationState(getJSON(QUALIFICATIONS_KEY, {}));
}

function saveQualificationState(state) {
    setJSON(QUALIFICATIONS_KEY, normalizeQualificationState(state));
}

export function evaluationCycleStartYear(date = new Date()) {
    const parsed = date instanceof Date ? date : new Date(date);
    const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

    return safeDate.getMonth() >= 8
        ? safeDate.getFullYear()
        : safeDate.getFullYear() - 1;
}

export function qualificationPeriods(cycleStartYear = selectedCycleStartYear) {
    const startYear = Number(cycleStartYear) ||
        evaluationCycleStartYear();

    return PERIOD_DEFS.map((period, index) => {
        const year = startYear + period.yearOffset;
        const startDate = new Date(
            year,
            period.startMonth,
            period.startDay
        );
        const endDate = new Date(
            year,
            period.endMonth,
            period.endDay
        );

        return {
            ...period,
            order: index + 1,
            cycleStartYear: startYear,
            startDate,
            endDate,
            startISO: toISODate(startDate),
            endISO: toISODate(endDate),
            deadlineISO: toISODate(endDate)
        };
    });
}

/**
 * La calificacion anual del ciclo. Cubre los doce meses del articulo 3 (1 de
 * septiembre al 31 de agosto) y se hace en septiembre, cuando los tres
 * informes cuatrimestrales ya estan escritos.
 */
export function annualPeriod(cycleStartYear = selectedCycleStartYear) {
    const startYear = Number(cycleStartYear) || evaluationCycleStartYear();
    const startDate = new Date(startYear, 8, 1);
    const endDate = new Date(startYear + 1, 7, 31);

    return {
        id: ANNUAL_PERIOD_ID,
        label: "Calificacion anual",
        shortLabel: "Anual",
        annual: true,
        order: 4,
        cycleStartYear: startYear,
        startDate,
        endDate,
        startISO: toISODate(startDate),
        endISO: toISODate(endDate),
        // El proceso se inicia el 1 de septiembre y la precalificacion del jefe
        // directo corre en los primeros dias (art. 3 y art. 20).
        deadlineISO: toISODate(new Date(startYear + 1, 8, 15))
    };
}

export function isAnnualPeriod(period) {
    return Boolean(period?.annual) || period?.id === ANNUAL_PERIOD_ID;
}

/** Los tres informes escritos MAS la calificacion anual. */
export function qualificationCycleSteps(cycleStartYear = selectedCycleStartYear) {
    return [...qualificationPeriods(cycleStartYear), annualPeriod(cycleStartYear)];
}

function periodById(id, cycleStartYear = selectedCycleStartYear) {
    if (id === ANNUAL_PERIOD_ID) return annualPeriod(cycleStartYear);

    return qualificationPeriods(cycleStartYear).find(period =>
        period.id === id
    ) || qualificationPeriods(cycleStartYear)[0];
}

function currentPeriodId(date = new Date(), cycleStartYear = selectedCycleStartYear) {
    const iso = toISODate(date instanceof Date ? date : new Date(date));

    return qualificationPeriods(cycleStartYear).find(period =>
        period.startISO <= iso && iso <= period.endISO
    )?.id || "sep-dec";
}

export function isISODateInPeriod(value, period) {
    const iso = normalizeISODate(value);

    return Boolean(
        iso &&
        period?.startISO &&
        period?.endISO &&
        period.startISO <= iso &&
        iso <= period.endISO
    );
}

function normalizeISODate(value) {
    if (!value) return "";

    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        return String(value);
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) return "";

    return toISODate(parsed);
}

function periodRecordId(period, profile) {
    return [
        period.cycleStartYear,
        period.id,
        profileKey(profile)
    ].join(":");
}

function findRecordForProfile(state, period, profile) {
    const id = periodRecordId(period, profile);

    return state.records[id] || null;
}

export function qualificationRecordStatus(record = null) {
    if (!record) return STATUS_PENDING;
    // El escaneo firmado es la prueba de que el circuito se cerro: manda sobre
    // el estado guardado, porque el papel es el original.
    if (record.scan) return STATUS_ARCHIVED;
    if (record.status === STATUS_ARCHIVED) return STATUS_ARCHIVED;
    if (
        record.status === STATUS_PRINTED ||
        record.status === STATUS_EVALUATED ||
        record.evaluatedAt
    ) {
        return STATUS_PRINTED;
    }

    return STATUS_DRAFT;
}

// Cerrado = ya salio a la impresora, con o sin el escaneado de vuelta. Es lo
// que antes contaba `evaluated`.
function isClosedStatus(status) {
    return status === STATUS_PRINTED || status === STATUS_ARCHIVED;
}

function statusLabel(status) {
    if (status === STATUS_ARCHIVED) return "Firmada y archivada";
    // `evaluated` es el estado que dejaban los registros anteriores a la
    // separacion entre informe escrito y calificacion anual.
    if (status === STATUS_PRINTED || status === STATUS_EVALUATED) {
        return "Impresa, sin firma";
    }
    if (status === STATUS_DRAFT) return "Borrador";

    return "Sin escribir";
}

function statusClass(status) {
    if (status === STATUS_ARCHIVED) return "accepted";
    if (status === STATUS_PRINTED || status === STATUS_EVALUATED) return "completed";
    if (status === STATUS_DRAFT) return "completed";

    return "pending";
}

function periodMonths(period) {
    const months = [];
    const cursor = new Date(
        period.startDate.getFullYear(),
        period.startDate.getMonth(),
        1
    );
    const endSerial =
        period.endDate.getFullYear() * 12 + period.endDate.getMonth();

    while (
        cursor.getFullYear() * 12 + cursor.getMonth() <= endSerial
    ) {
        months.push(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
        cursor.setMonth(cursor.getMonth() + 1);
    }

    return months;
}

function incidentCacheKey(period, profiles = []) {
    return [
        period.cycleStartYear,
        period.id,
        profiles.map(profile => profileKey(profile)).join("|")
    ].join("::");
}

async function ensurePeriodIncidents(period, profiles) {
    const key = incidentCacheKey(period, profiles);

    if (incidentCache.key === key || incidentCache.loading) return;

    incidentCache = {
        key,
        loading: true,
        eventsByProfile: new Map()
    };

    try {
        const results = await Promise.all(
            periodMonths(period).map(month =>
                buildAttendanceIncidents(profiles, month)
            )
        );
        const eventsByProfile = new Map();

        results.flatMap(result => result.events || [])
            .filter(event => isISODateInPeriod(event.iso, period))
            .forEach(event => {
                const name = String(event.profile || "");

                if (!eventsByProfile.has(name)) {
                    eventsByProfile.set(name, []);
                }

                eventsByProfile.get(name).push(event);
            });

        incidentCache = {
            key,
            loading: false,
            eventsByProfile
        };
    } catch (error) {
        console.warn(
            "No se pudieron calcular las incidencias para calificaciones.",
            error
        );
        incidentCache = {
            key,
            loading: false,
            eventsByProfile: new Map()
        };
    }

    if (
        typeof document !== "undefined" &&
        document.body?.dataset?.activeView === "qualifications"
    ) {
        renderQualificationsPanel();
    }
}

function getProfileLogs(profileName) {
    const raw = getJSON(`hrLogs_${profileName}`, {});
    const normalized = {};

    [
        "training",
        "diplomas",
        "events",
        "merit",
        "demerit",
        "performance"
    ].forEach(key => {
        normalized[key] = Array.isArray(raw?.[key])
            ? raw[key]
            : [];
    });

    return normalized;
}

function entryDate(entry = {}) {
    return normalizeISODate(entry.date || entry.start || entry.createdAt);
}

function entriesInPeriod(entries = [], period) {
    return entries.filter(entry =>
        isISODateInPeriod(entryDate(entry), period)
    );
}

function calendarEntriesInPeriod(profileName, period) {
    const result = [];
    const maps = [
        ["admin", "Permiso administrativo", getJSON(`admin_${profileName}`, {})],
        ["legal", "Feriado legal", getJSON(`legal_${profileName}`, {})],
        ["comp", "Permiso compensatorio", getJSON(`comp_${profileName}`, {})],
        ["absence", "Ausencia", getJSON(`absences_${profileName}`, {})]
    ];

    maps.forEach(([kind, label, values]) => {
        Object.entries(values || {}).forEach(([keyDay, value]) => {
            const date = keyToDate(keyDay);

            if (
                Number.isNaN(date.getTime()) ||
                !isISODateInPeriod(toISODate(date), period)
            ) {
                return;
            }

            const type = kind === "absence"
                ? absenceType(value)
                : kind;

            // La injustificada va a Asistencia y puntualidad; el resto de
            // las ausencias y los permisos son derechos, no antecedentes.
            const unjustified = kind === "absence" && esAusenciaInjustificada(value);

            result.push({
                kind: type,
                unjustified,
                label: type === "training"
                    ? "Capacitacion"
                    : unjustified
                        ? "Ausencia injustificada"
                        : label,
                iso: toISODate(date),
                detail: calendarEntryDetail(type, value)
            });
        });
    });

    return result.sort((a, b) =>
        a.iso.localeCompare(b.iso) ||
        a.label.localeCompare(b.label)
    );
}

function absenceType(value) {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
        return String(value.type || value.kind || "absence");
    }

    return "absence";
}

function calendarEntryDetail(type, value) {
    if (value && typeof value === "object") {
        return clampText(value.note || value.reason || value.detail, 260);
    }

    if (type === "training") return "Capacitacion registrada en calendario";

    return "";
}

// Minutos de atraso del periodo. El evento del reloj control los trae al
// comienzo de su texto ("12 min (entro 08:12, le tocaba 08:00)"); no se
// agrega un campo al evento para no tocar el motor protegido de horas.
function sumLateMinutes(events = []) {
    return events
        .filter(event => event.kind === "atraso")
        .reduce((total, event) => {
            const minutes = Number(event.minutes) ||
                Number(String(event.detail || "").match(/^(\d+)\s*min/)?.[1]) ||
                0;

            return total + minutes;
        }, 0);
}

function lateMinutesOf(event) {
    return Number(String(event?.detail || "").match(/^(\d+)\s*min/)?.[1]) || 0;
}

/**
 * El dia de un evento del reloj control, dicho para la apreciacion: el turno
 * que tenia y por que estaba (a quien cubria o su motivo de HHEE).
 * "12/09/2026, Larga, cubria a Juan Perez"
 */
function attendanceEventContext(profileName, iso) {
    const [year, month, day] = String(iso || "").split("-").map(Number);
    const keyDay = `${year}-${month - 1}-${day}`;
    const turno = TURNO_LABEL[Number(getTurnoReal(profileName, keyDay)) || 0] || "";
    const records = getReplacements().filter(record =>
        record?.worker === profileName &&
        record.date === iso &&
        replacementActive(record)
    );
    const why = [
        ...new Set(records.map(record => record.replaced
            ? `cubria a ${record.replaced}`
            : String(record.reason || "").trim()
                ? `HHEE: ${String(record.reason).trim()}`
                : ""
        ).filter(Boolean))
    ];

    return [formatDate(iso), turno, ...why].filter(Boolean).join(", ");
}

export function attendanceEventLine(profileName, event) {
    const context = attendanceEventContext(profileName, event.iso);

    if (event.kind === "atraso") {
        const minutes = lateMinutesOf(event);

        return `${context}${minutes ? `: ${minutes} min` : ""}`;
    }

    if (event.kind === "earlyExit") {
        return `${context}: salida temprana (${String(event.detail || "").replace(/^Sali[oó]\s*/i, "salio a las ")})`;
    }

    return `${context}: entrada tardia a un turno extra (${event.detail || ""})`;
}

function countLateEvents(events = []) {
    return events.filter(event =>
        event.kind === "atraso" ||
        event.kind === "lateOnExtra"
    ).length;
}

function buildSummary(profile, period, state, eventsByProfile) {
    const logs = getProfileLogs(profile.name);
    const record = findRecordForProfile(state, period, profile);
    const status = qualificationRecordStatus(record);
    const incidents = eventsByProfile.get(profile.name) || [];
    const calendar = calendarEntriesInPeriod(profile.name, period);
    const training = [
        ...entriesInPeriod(logs.training, period),
        ...entriesInPeriod(logs.diplomas, period)
    ];

    return {
        profile,
        profileKey: profileKey(profile),
        record,
        status,
        merits: entriesInPeriod(logs.merit, period),
        demerits: entriesInPeriod(logs.demerit, period),
        events: entriesInPeriod(logs.events, period),
        performance: entriesInPeriod(logs.performance, period),
        training,
        calendar,
        calendarTraining: calendar.filter(item => item.kind === "training"),
        incidents,
        lateCount: countLateEvents(incidents),
        lateMinutes: sumLateMinutes(incidents),
        // Del reloj control, para Asistencia y puntualidad: los atrasos (van
        // aparte, con sus minutos) y las entradas tardias a un turno extra y
        // salidas tempranas. Las marcas que faltan, entrar antes o salir despues
        // son para revisar el marcaje, no antecedentes de la calificacion.
        lateEvents: incidents.filter(event => event.kind === "atraso"),
        punctualityEvents: incidents.filter(event =>
            event.kind === "lateOnExtra" || event.kind === "earlyExit"
        ),
        clockIssueCount: incidents.length,
        // Turnos aceptados que no se cumplieron (historial del perfil): van a
        // Asistencia y puntualidad (art. 16, 3 b).
        shiftAttendance: getShiftAttendance(profile.name)
            .filter(entry => isISODateInPeriod(entry.date, period))
            .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    };
}

function searchableText(summary) {
    const profile = summary.profile || {};

    return normalizePlainText([
        profile.name,
        profile.rut,
        profile.estamento,
        profile.profession,
        statusLabel(summary.status)
    ].join(" "));
}

function visibleSummaries(summaries) {
    const cleanSearch = normalizePlainText(searchText);

    return summaries
        .filter(summary => {
            if (selectedStatus === STATUS_ALL) return true;
            // "Impresas" agrupa las dos etapas del papel; "Archivadas" es el
            // subconjunto que ya volvio firmado.
            if (selectedStatus === STATUS_PRINTED) {
                return isClosedStatus(summary.status);
            }

            return summary.status === selectedStatus;
        })
        .filter(summary =>
            !cleanSearch || searchableText(summary).includes(cleanSearch)
        )
        .sort((a, b) => {
            // Sin los estados nuevos aqui, la resta daba NaN y el orden
            // "primero lo que falta" se perdia.
            const order = {
                [STATUS_PENDING]: 0,
                [STATUS_DRAFT]: 1,
                [STATUS_EVALUATED]: 2,
                [STATUS_PRINTED]: 2,
                [STATUS_ARCHIVED]: 3
            };
            const statusDiff = (order[a.status] || 0) - (order[b.status] || 0);

            if (statusDiff) return statusDiff;

            return String(a.profile.name || "")
                .localeCompare(String(b.profile.name || ""), "es");
        });
}

function formatDate(value) {
    return formatDisplayDate(value) || "Sin fecha";
}

function formatPeriodDeadline(period) {
    return formatDate(period.deadlineISO);
}

function daysUntilDeadline(period) {
    const today = new Date();
    const start = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
    );
    const deadline = parseISODate(period.deadlineISO);

    return Math.ceil((deadline - start) / 86400000);
}

function deadlineText(period, pendingCount) {
    const days = daysUntilDeadline(period);

    if (!pendingCount) return "Periodo cerrado";
    if (days < 0) return `${Math.abs(days)} dia(s) vencido`;
    if (days === 0) return "Vence hoy";

    return `${days} dia(s) restantes`;
}

export function qualificationCoefficientGroup(profile = {}) {
    const estamento = normalizePlainText(
        profile.estamento || profile.role || profile.profession
    );

    if (estamento.includes("directivo")) return "directivos";
    if (
        estamento.includes("profesional") ||
        estamento.includes("tecnico")
    ) {
        return "profesionales_tecnicos";
    }

    return "administrativos_auxiliares";
}

export function qualificationPoints(record, profile = {}) {
    if (!record) return "";

    const group =
        QUALIFICATION_COEFFICIENTS[qualificationCoefficientGroup(profile)] ||
        QUALIFICATION_COEFFICIENTS.administrativos_auxiliares;
    let total = 0;

    for (const factor of QUALIFICATION_FACTORS) {
        const score = factorComputedScore(record.factors?.[factor.key]);

        if (!Number.isFinite(score)) return "";

        total += score * (group[factor.key] || 0);
    }

    return Number(total.toFixed(2));
}

export function qualificationList(points) {
    if (points === "" || points === null || points === undefined) return null;

    const score = Number(points);

    if (!Number.isFinite(score) || score < 10) return null;
    if (score >= 81) return { number: 1, label: "Distincion" };
    if (score >= 46) return { number: 2, label: "Buena" };
    if (score >= 30) return { number: 3, label: "Condicional" };

    return { number: 4, label: "Eliminacion" };
}

function qualificationListLabel(points) {
    const list = qualificationList(points);

    return list ? `Lista ${list.number}: ${list.label}` : "-";
}

function scoreConcept(score) {
    const value = scoreNumber(score);

    if (!Number.isFinite(value)) return "Sin nota";
    if (value >= 9) return "Optimo";
    if (value >= 7) return "Buena";
    if (value >= 5) return "Satisfactorio";
    if (value >= 3) return "Insuficiente";

    return "Deficiente";
}

function initials(name) {
    return String(name || "?")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(part => part[0]?.toUpperCase() || "")
        .join("") || "?";
}

function kpiCardHTML(label, value, detail, tone = "blue") {
    return `
        <article class="qual-kpi qual-kpi--${tone}">
            <span>${escapeHTML(label)}</span>
            <strong>${escapeHTML(String(value))}</strong>
            <small>${escapeHTML(detail)}</small>
        </article>
    `;
}

function filterButtonHTML(status, label, count) {
    const active = selectedStatus === status;

    return `
        <button class="worker-request-filter ${active ? "is-active" : ""}"
            type="button"
            data-qual-status="${escapeAttribute(status)}">
            ${escapeHTML(label)} <span>${count}</span>
        </button>
    `;
}

// Solo lo que TIENE algo. Antes cada fila arrastraba "0 merito 0 demerito
// 0 atraso 0 capacitacion" en gris: cuatro ceros repetidos setenta y tres
// veces que no distinguen a nadie y tapan a los que si tienen antecedentes.
function workerTagsHTML(summary) {
    const training = summary.training.length + summary.calendarTraining.length;
    const tags = [
        ["bad", summary.lateCount, "atraso", "atrasos"],
        ["bad", (summary.shiftAttendance || []).length, "turno no cumplido", "turnos no cumplidos"],
        ["warn", summary.demerits.length, "demerito", "demeritos"],
        ["ok", summary.merits.length, "merito", "meritos"],
        ["ok", training, "capacitacion", "capacitaciones"]
    ].filter(([, count]) => count > 0);

    if (!tags.length) return "";

    return `
        <span class="qual-worker-tags">
            ${tags.map(([tone, count, one, many]) => `
                <span class="qual-tag qual-tag--${tone}">
                    ${count} ${escapeHTML(count === 1 ? one : many)}
                </span>
            `).join("")}
        </span>
    `;
}

function workerRowHTML(summary) {
    const profile = summary.profile;
    const selected = summary.profileKey === openProfileKey;
    // Estamento y profesion, sin repetir cuando son la misma palabra. El RUT
    // sale de aqui: no ayuda a reconocer a nadie de un vistazo y lo unico que
    // hace es empujar el resto de la linea.
    const role = [profile.estamento, profile.profession]
        .map(value => String(value || "").trim())
        .filter(Boolean);
    const subtitle = [...new Set(role)].join(" - ") ||
        profile.rut ||
        "Sin datos de planta";

    return `
        <button class="qual-worker-row ${selected ? "is-selected" : ""}"
            type="button"
            data-qual-profile="${escapeAttribute(summary.profileKey)}">
            <span class="qual-avatar">${escapeHTML(initials(profile.name))}</span>
            <span class="qual-worker-main">
                <strong>${escapeHTML(profile.name || "Sin nombre")}</strong>
                <small>${escapeHTML(subtitle)}</small>
            </span>
            ${workerTagsHTML(summary)}
            <span class="qual-worker-scan">
                ${summary.record?.scan
                    ? `<span class="qual-scan-badge">PDF</span>`
                    : `<small>sin escaneo</small>`}
            </span>
            <span class="worker-request-status worker-request-status--${statusClass(summary.status)}">
                ${escapeHTML(statusLabel(summary.status))}
            </span>
        </button>
    `;
}

// Los antecedentes se reparten entre los tres factores para que cada uno se
// escriba MIRANDO lo suyo. Antes vivian en un recuadro aparte, arriba de todo:
// habia que leerlos, bajar, y redactar de memoria.
//
// El reparto es por afinidad, no exacto: un demerito puede pesar en rendimiento
// o en comportamiento segun de que sea. Por eso el chip es solo un atajo -copia
// su texto a la apreciacion- y no una clasificacion que decida nada.
function evidenceByFactor(summary) {
    const buckets = {
        rendimiento: [],
        condiciones: [],
        comportamiento: []
    };

    summary.merits.forEach(item => {
        buckets.rendimiento.push({
            tone: "ok",
            title: item.title || "Anotacion de merito",
            detail: [formatDate(entryDate(item)), item.detail].filter(Boolean).join(" - "),
            text: item.title || "Anotacion de merito"
        });
    });

    summary.demerits.forEach(item => {
        buckets.comportamiento.push({
            tone: "warn",
            title: item.title || "Anotacion de demerito",
            detail: [formatDate(entryDate(item)), item.detail].filter(Boolean).join(" - "),
            text: item.title || "Anotacion de demerito"
        });
    });

    summary.performance.forEach((item, index) => {
        buckets.rendimiento.push({
            tone: "mute",
            title: "Evaluacion anterior",
            detail: [formatDate(entryDate(item)), item.detail]
                .filter(Boolean)
                .join(" - "),
            text: String(item.detail || "Evaluacion de desempeno anterior."),
            // Apuntan al registro original para poder abrir su PDF.
            fileSource: item.file ? "performance" : "",
            fileIndex: item.file ? index : -1
        });
    });

    summary.events.forEach((item, index) => {
        const detail = String(item.detail || item.title || "").trim();

        buckets.condiciones.push({
            tone: "mute",
            title: `Evento del ${formatDate(entryDate(item))}`,
            detail: detail || "Sin detalle",
            text: detail || `Evento registrado el ${formatDate(entryDate(item))}.`,
            fileSource: item.file ? "events" : "",
            fileIndex: item.file ? index : -1
        });
    });

    [...summary.training, ...summary.calendarTraining].forEach(item => {
        const name = item.name || item.label || "Capacitacion";
        const extra = [
            item.hours ? `${item.hours} horas` : "",
            item.grade ? `nota ${item.grade}` : ""
        ].filter(Boolean).join(", ");

        buckets.condiciones.push({
            tone: "ok",
            title: name,
            detail: extra || formatDate(entryDate(item) || item.iso),
            text: extra ? `${name} (${extra})` : name
        });
    });

    const lateEvents = summary.lateEvents || [];

    if (lateEvents.length) {
        const count = lateEvents.length;
        const minutes = summary.lateMinutes || 0;
        const name = summary.profile?.name || "";

        buckets.comportamiento.push({
            tone: "bad",
            title: `${count} ${count === 1 ? "atraso" : "atrasos"}${minutes ? ` · ${minutes} min en total` : ""}`,
            detail: `Reloj control: ${lateEvents.map(event => formatDate(event.iso)).join(", ")}`,
            // Al copiarlo va con el detalle de cada uno: cuando, que turno y
            // por que estaba (a quien cubria o su motivo de HHEE).
            text: (count === 1
                ? "Registra un atraso en el reloj control durante el periodo"
                : `Registra ${count} atrasos en el reloj control durante el periodo`) +
                (minutes ? `, con un total de ${minutes} minutos` : "") +
                `: ${lateEvents.map(event => attendanceEventLine(name, event)).join("; ")}.`
        });
    }

    (summary.shiftAttendance || []).forEach(entry => {
        const turno = entry.turnoLabel ? `turno ${entry.turnoLabel}` : "turno";

        buckets.comportamiento.push({
            tone: "bad",
            title: `No cumple ${turno} aceptado`,
            detail: `${formatDate(entry.date)} - ${entry.comment}`,
            text: `El ${formatDate(entry.date)} no cumple el ${turno} que habia aceptado${entry.replaced ? ` (cubria a ${entry.replaced})` : ""}: ${entry.comment}.`
        });
    });

    const punctuality = summary.punctualityEvents || [];

    if (punctuality.length) {
        const late = punctuality.filter(event => event.kind === "lateOnExtra").length;
        const early = punctuality.length - late;
        const name = summary.profile?.name || "";
        const parts = [
            late ? `${late} ${late === 1 ? "entrada tardia" : "entradas tardias"}` : "",
            early ? `${early} ${early === 1 ? "salida temprana" : "salidas tempranas"}` : ""
        ].filter(Boolean);

        buckets.comportamiento.push({
            tone: "warn",
            title: parts.join(" · "),
            detail: `Reloj control: ${punctuality.map(event => formatDate(event.iso)).join(", ")}`,
            text: `Registra ${parts.join(" y ")} en el periodo: ` +
                `${punctuality.map(event => attendanceEventLine(name, event)).join("; ")}.`
        });
    }

    // Solo las ausencias injustificadas: los permisos (administrativo,
    // feriados, licencias) son derechos del funcionario y no califican.
    summary.calendar
        .filter(item => item.unjustified)
        .forEach(item => {
            buckets.comportamiento.push({
                tone: "bad",
                title: item.label,
                detail: formatDate(item.iso),
                text: `${item.label} el ${formatDate(item.iso)}.`
            });
        });

    return buckets;
}

function evidenceChipsHTML(factorKey, items) {
    if (!items.length) {
        return `
            <p class="qual-evidence-empty">
                Sin registros de este tipo en el periodo. La apreciacion se escribe igual.
            </p>
        `;
    }

    return items.slice(0, 8).map((item, index) => `
        <span class="qual-chip-row">
            <button class="qual-chip qual-chip--${escapeAttribute(item.tone)}"
                type="button"
                data-qual-insert="${escapeAttribute(factorKey)}"
                data-qual-insert-index="${index}"
                title="Copiar a la apreciacion">
                <span class="qual-chip__dot"></span>
                <span class="qual-chip__text">
                    <strong>${escapeHTML(item.title)}</strong>
                    <small>${escapeHTML(item.detail || "")}</small>
                </span>
                <span class="qual-chip__add" aria-hidden="true">+</span>
            </button>
            ${item.fileIndex >= 0 ? `
                <button class="qual-chip__file"
                    type="button"
                    data-qual-file-source="${escapeAttribute(item.fileSource)}"
                    data-qual-file-index="${item.fileIndex}"
                    title="Abrir el archivo de respaldo">
                    PDF
                </button>
            ` : ""}
        </span>
    `).join("");
}

// ---------------------------------------------------------------------------
// Informe cuatrimestral: apreciaciones escritas, sin notas.
// ---------------------------------------------------------------------------

function appraisalFieldHTML(factor, record, evidence, editable) {
    const text = record?.appraisals?.[factor.key] || "";

    return `
        <section class="qual-factor qual-factor--quarter">
            <div class="qual-factor__main">
                <div class="qual-factor-head">
                    <div>
                        <strong>${escapeHTML(factor.label)}</strong>
                        <small>${escapeHTML(factor.formText)}</small>
                    </div>
                </div>
                <textarea class="qual-appraisal"
                    rows="5"
                    data-qual-appraisal="${escapeAttribute(factor.key)}"
                    maxlength="${MAX_NOTE_LENGTH}"
                    placeholder="Que hizo, con que oportunidad y con que calidad durante el cuatrimestre."
                    ${editable ? "" : "disabled"}>${escapeHTML(text)}</textarea>
                <span class="qual-appraisal-count" data-qual-count="${escapeAttribute(factor.key)}">
                    ${text.trim().length ? `${text.trim().length} caracteres escritos` : "Sin escribir"}
                </span>
            </div>
            <aside class="qual-factor__evidence">
                <span class="qual-evidence-title">Antecedentes de este factor</span>
                ${evidenceChipsHTML(factor.key, evidence)}
            </aside>
        </section>
    `;
}

function paperFlowHTML(summary, status) {
    const written = QUALIFICATION_FACTORS.every(factor =>
        String(summary.record?.appraisals?.[factor.key] || "").trim()
    );
    const printed = status === STATUS_PRINTED || status === STATUS_ARCHIVED;
    const archived = status === STATUS_ARCHIVED;
    const steps = [
        ["1", "Escribir", "Las tres apreciaciones del cuatrimestre.", written],
        ["2", "Imprimir", "Sale el formulario de personal, ya relleno.", printed],
        ["3", "Firmar en papel", "Jefatura y funcionario, con fecha.", archived],
        ["4", "Escanear y guardar", "Queda archivado en este cuatrimestre.", archived]
    ];

    return `
        <section class="qual-paper">
            <div class="qual-subhead">
                <h4>Formulario firmado</h4>
                <span>El papel es el original; aqui queda la copia del periodo</span>
            </div>
            <div class="qual-paper-steps">
                ${steps.map(([number, title, detail, done]) => `
                    <div class="qual-step ${done ? "is-done" : ""}">
                        <span class="qual-step__dot">${number}</span>
                        <strong>${escapeHTML(title)}</strong>
                        <small>${escapeHTML(detail)}</small>
                    </div>
                `).join("")}
            </div>
            ${scanRowHTML(summary)}
        </section>
    `;
}

function scanRowHTML(summary) {
    const scan = summary.record?.scan;
    const editable = canEditMenu("qualifications");

    if (!scan) {
        return `
            <label class="qual-scan-drop ${editable ? "" : "is-disabled"}">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M12 16.5V4"></path>
                    <path d="m7.5 8.5 4.5-4.5 4.5 4.5"></path>
                    <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"></path>
                </svg>
                <span>Adjuntar el formulario escaneado y firmado</span>
                <input type="file" accept="${ATTACHMENT_ACCEPT}" data-qual-scan ${editable ? "" : "disabled"}>
            </label>
        `;
    }

    return `
        <div class="qual-scan">
            <span class="qual-scan__badge">${escapeHTML(scanExtLabel(scan))}</span>
            <span class="qual-scan__meta">
                <strong>${escapeHTML(scan.name)}</strong>
                <small>${escapeHTML(formatBytes(scan.size))} - ${escapeHTML(formatDate(scan.addedAt))}</small>
            </span>
            <button class="secondary-button secondary-button--small" type="button" data-qual-scan-open>Ver</button>
            ${editable ? `
                <button class="qual-scan__remove" type="button" data-qual-scan-remove aria-label="Quitar el escaneado">&times;</button>
            ` : ""}
        </div>
    `;
}

function scanExtLabel(scan = {}) {
    const name = String(scan.name || "").toLowerCase();

    if (/\.pdf$/.test(name)) return "PDF";
    if (/\.(png|jpe?g|gif|webp|heic|heif)$/.test(name)) return "IMG";

    return "DOC";
}

function formatBytes(value) {
    const size = Number(value) || 0;

    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;

    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Calificacion anual: las notas del articulo 14.
// ---------------------------------------------------------------------------

// Tramo de nota del articulo 14. Es lo que da el color de cada casilla y el
// concepto que se lee debajo.
function noteBand(value) {
    if (value >= 9) return "optimo";
    if (value >= 7) return "buena";
    if (value >= 5) return "satisfactorio";
    if (value >= 3) return "insuficiente";

    return "deficiente";
}

/**
 * La nota que esa persona obtuvo en el subfactor el ciclo ANTERIOR.
 *
 * Se marca en la escala con un borde punteado. No es adorno: una nota que se
 * mueve dos puntos de un ano a otro es justo lo que una apelacion va a mirar,
 * y verla al lado evita moverla sin darse cuenta.
 */
function previousCycleScores(profile, cycleStartYear) {
    const state = getQualificationState();
    const previous = annualPeriod(cycleStartYear - 1);
    const record = findRecordForProfile(state, previous, profile);
    const map = {};

    QUALIFICATION_FACTORS.forEach(factor => {
        factor.subfactors.forEach(subfactor => {
            const value = scoreNumber(
                record?.factors?.[factor.key]?.subfactors?.[subfactor.key]?.score
            );

            map[`${factor.key}:${subfactor.key}`] = Number.isFinite(value)
                ? value
                : 0;
        });
    });

    return map;
}

// El articulo 14 exige fundar cada nota. Pedir seis textos por persona es lo
// que hace que nadie los escriba, asi que el recuadro se pide donde una
// apelacion va a mirar: en los extremos, y cuando la nota se mueve dos puntos
// o mas respecto del ciclo anterior.
function needsReason(value, previous) {
    if (!value) return false;
    if (value <= 4 || value >= 9) return true;

    return Boolean(previous) && Math.abs(value - previous) >= 2;
}

function reasonLabel(value, previous) {
    if (value >= 9) return "Fundamento obligatorio: nota en el tramo optimo";
    if (value <= 4) return "Fundamento obligatorio: nota bajo el estandar";

    return `Fundamento obligatorio: cambia ${Math.abs(value - previous)} puntos`;
}

function noteScaleHTML(factor, subfactor, value, previous, editable) {
    const key = `${factor.key}:${subfactor.key}`;

    return `
        <div class="qual-scale" role="group" aria-label="Nota de ${escapeAttribute(subfactor.label)}">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(note => `
                <button class="qual-cell qual-cell--${noteBand(note)}${value === note ? " is-on" : ""}${previous === note ? " is-previous" : ""}"
                    type="button"
                    data-qual-note="${escapeAttribute(key)}"
                    data-qual-note-value="${note}"
                    title="${note} - ${escapeAttribute(scoreConcept(note))}"
                    aria-pressed="${value === note ? "true" : "false"}"
                    ${editable ? "" : "disabled"}>${note}</button>
            `).join("")}
        </div>
    `;
}

function factorFieldHTML(factor, record, editable, previousScores = {}) {
    const value = record?.factors?.[factor.key] || {};
    const score = factorComputedScore(value);
    const ready = Number.isFinite(score);

    return `
        <section class="qual-factor qual-factor--annual" data-qual-factor="${escapeAttribute(factor.key)}">
            <div class="qual-factor-head">
                <div>
                    <strong>${escapeHTML(factor.label)}</strong>
                    <small>${escapeHTML(factor.detail)}</small>
                </div>
                <span class="qual-factor-score">
                    <span>
                        <small>Nota factor</small>
                        <strong data-qual-factor-note="${escapeAttribute(factor.key)}">${ready ? score.toFixed(2) : "--"}</strong>
                    </span>
                    <span>
                        <small>Puntos</small>
                        <strong class="is-points" data-qual-factor-points="${escapeAttribute(factor.key)}">--</strong>
                    </span>
                </span>
            </div>

            <div class="qual-subfactors">
                ${factor.subfactors.map(subfactor => {
                    const key = `${factor.key}:${subfactor.key}`;
                    const subvalue = value.subfactors?.[subfactor.key] || {};
                    const note = scoreNumber(subvalue.score) || 0;
                    const previous = previousScores[key] || 0;
                    const asks = needsReason(note, previous);

                    return `
                        <div class="qual-subfactor" data-qual-sub="${escapeAttribute(key)}">
                            <div class="qual-subfactor__head">
                                <strong>${escapeHTML(subfactor.label)}</strong>
                                <small>${escapeHTML(subfactor.detail)}</small>
                            </div>

                            ${noteScaleHTML(factor, subfactor, note, previous, editable)}

                            <div class="qual-subfactor__foot">
                                <span class="qual-concept qual-concept--${noteBand(note || 0)}"
                                    data-qual-concept="${escapeAttribute(key)}">
                                    ${note ? `${note} - ${escapeHTML(scoreConcept(note))}` : "Sin nota"}
                                </span>
                                <small>${previous ? `Ciclo anterior ${previous}` : "Sin ciclo anterior"}</small>
                            </div>

                            <!-- El valor real que lee el guardado. La escala de
                                 arriba solo lo escribe. -->
                            <input type="hidden"
                                data-qual-sub-score="${escapeAttribute(key)}"
                                value="${escapeAttribute(note || "")}">

                            <label class="qual-reason ${asks ? "is-required" : ""}"
                                data-qual-reason="${escapeAttribute(key)}"
                                ${asks ? "" : "hidden"}>
                                <span data-qual-reason-label="${escapeAttribute(key)}">
                                    ${asks ? escapeHTML(reasonLabel(note, previous)) : ""}
                                </span>
                                <textarea rows="2"
                                    data-qual-sub-comment="${escapeAttribute(key)}"
                                    maxlength="${MAX_NOTE_LENGTH}"
                                    placeholder="Hecho del periodo que sostiene esta nota."
                                    ${editable ? "" : "disabled"}>${escapeHTML(subvalue.comment || "")}</textarea>
                            </label>
                        </div>
                    `;
                }).join("")}
            </div>
        </section>
    `;
}

// Bloque de puntaje con las bandas del articulo 15 a escala real: el ancho de
// cada franja es su tramo de puntos, no una porcion igual. Es lo unico con
// efecto de verdad (ascenso, estimulos, eliminacion) y hasta ahora no se veia
// hasta guardar.
// El puntaje que obtuvo el ciclo ANTERIOR. Va al pie de la tarjeta: la
// calificacion se lee contra la del ano pasado, no en el vacio.
function previousCyclePoints(profile, cycleStartYear) {
    const state = getQualificationState();
    const previous = annualPeriod(cycleStartYear - 1);
    const record = findRecordForProfile(state, previous, profile);

    return qualificationPoints(record, profile);
}

function scoreCardHTML(record, points, previousPoints) {
    const value = Number(points) || 0;
    const marker = value
        ? Math.max(0, Math.min(100, ((value - 10) / 90) * 100))
        : 0;
    const filled = QUALIFICATION_FACTORS.reduce((count, factor) =>
        count + factor.subfactors.filter(subfactor => scoreNumber(
            record?.factors?.[factor.key]?.subfactors?.[subfactor.key]?.score
        )).length,
        0
    );

    return `
        <section class="qual-scoreboard">
            <div class="qual-scoreboard__head">
                <span>
                    <small>Puntaje</small>
                    <strong data-qual-total>${value ? value.toFixed(2) : "--"}</strong>
                </span>
                <span class="qual-scoreboard__list">
                    <small>Lista</small>
                    <strong data-qual-list>${escapeHTML(qualificationListLabel(value))}</strong>
                </span>
            </div>
            <div class="qual-bands">
                <span class="qual-band qual-band--4"></span>
                <span class="qual-band qual-band--3"></span>
                <span class="qual-band qual-band--2"></span>
                <span class="qual-band qual-band--1"></span>
                <span class="qual-bands__marker"
                    data-qual-marker
                    style="left: ${marker}%"
                    ${value ? "" : "hidden"}></span>
            </div>
            <div class="qual-bands__scale">
                <span>10</span><span>30</span><span>46</span><span>81</span><span>100</span>
            </div>
            <div class="qual-scoreboard__foot">
                <span data-qual-filled>${filled} de 6 notas puestas</span>
                <span>${previousPoints
                    ? `Ciclo anterior: ${escapeHTML(Number(previousPoints).toFixed(2))}`
                    : "Sin ciclo anterior"}</span>
            </div>
        </section>
    `;
}

/**
 * Recalcula nota de factor, puntos, puntaje y lista SIN repintar el panel.
 *
 * Repintar aqui costaria el texto sin guardar de los fundamentos y el foco del
 * recuadro en el que se este escribiendo, asi que se tocan solo los nodos que
 * cambian.
 */
function refreshAnnualTotals(form, profile) {
    const group = QUALIFICATION_COEFFICIENTS[
        qualificationCoefficientGroup(profile)
    ] || QUALIFICATION_COEFFICIENTS.administrativos_auxiliares;
    let total = 0;

    QUALIFICATION_FACTORS.forEach(factor => {
        const notes = factor.subfactors
            .map(subfactor => scoreNumber(
                form.querySelector(
                    `[data-qual-sub-score="${factor.key}:${subfactor.key}"]`
                )?.value
            ))
            .filter(Number.isFinite);
        const ready = notes.length === factor.subfactors.length;
        const note = ready
            ? notes.reduce((sum, item) => sum + item, 0) / notes.length
            : 0;
        const points = ready ? note * group[factor.key] : 0;
        const noteNode = form.querySelector(
            `[data-qual-factor-note="${factor.key}"]`
        );
        const pointsNode = form.querySelector(
            `[data-qual-factor-points="${factor.key}"]`
        );

        if (noteNode) noteNode.textContent = ready ? note.toFixed(2) : "--";
        if (pointsNode) pointsNode.textContent = ready ? points.toFixed(2) : "--";

        total += points;
    });

    // Dos decimales, como pide el articulo 14.
    const rounded = Math.round(total * 100) / 100;
    const totalNode = form.querySelector("[data-qual-total]");
    const listNode = form.querySelector("[data-qual-list]");
    const marker = form.querySelector("[data-qual-marker]");

    if (totalNode) totalNode.textContent = rounded ? rounded.toFixed(2) : "--";
    if (listNode) listNode.textContent = qualificationListLabel(rounded);

    const filledNode = form.querySelector("[data-qual-filled]");

    if (filledNode) {
        const filled = QUALIFICATION_FACTORS.reduce((count, factor) =>
            count + factor.subfactors.filter(subfactor => scoreNumber(
                form.querySelector(
                    `[data-qual-sub-score="${factor.key}:${subfactor.key}"]`
                )?.value
            )).length,
            0
        );

        filledNode.textContent = `${filled} de 6 notas puestas`;
    }

    if (marker) {
        marker.hidden = !rounded;
        marker.style.left =
            `${Math.max(0, Math.min(100, ((rounded - 10) / 90) * 100))}%`;
    }
}

/** La escala de notas: escribe el valor y repinta solo lo que cambia. */
function bindNoteScales(form, summary, period) {
    const previousScores = previousCycleScores(
        summary.profile,
        period.cycleStartYear
    );

    form.querySelectorAll("[data-qual-note]").forEach(button => {
        button.onclick = () => {
            const key = button.dataset.qualNote;
            const note = Number(button.dataset.qualNoteValue) || 0;
            const hidden = form.querySelector(
                `[data-qual-sub-score="${key}"]`
            );

            if (!hidden) return;

            // Volver a tocar la misma nota la quita: es la forma de dejar el
            // subfactor sin calificar sin tener que borrar un campo.
            const next = scoreNumber(hidden.value) === note ? 0 : note;

            hidden.value = next || "";

            const group = form.querySelector(`[data-qual-sub="${key}"]`);

            group?.querySelectorAll("[data-qual-note]").forEach(cell => {
                const value = Number(cell.dataset.qualNoteValue) || 0;
                const on = value === next;

                cell.classList.toggle("is-on", on);
                cell.setAttribute("aria-pressed", on ? "true" : "false");
            });

            const concept = form.querySelector(`[data-qual-concept="${key}"]`);

            if (concept) {
                concept.textContent = next
                    ? `${next} - ${scoreConcept(next)}`
                    : "Sin nota";
                concept.className =
                    `qual-concept qual-concept--${noteBand(next || 0)}`;
            }

            const previous = previousScores[key] || 0;
            const reason = form.querySelector(`[data-qual-reason="${key}"]`);
            const label = form.querySelector(`[data-qual-reason-label="${key}"]`);
            const asks = needsReason(next, previous);

            if (reason) {
                reason.hidden = !asks;
                reason.classList.toggle("is-required", asks);
            }

            if (label && asks) {
                label.textContent = reasonLabel(next, previous);
            }

            refreshAnnualTotals(form, summary.profile);
        };
    });

    refreshAnnualTotals(form, summary.profile);
}

function detailHTML(summary, period, readonly, queue = []) {
    if (!summary) {
        return `
            <section class="panel qual-detail-panel">
                <div class="empty-state empty-state--compact">
                    Sin trabajador seleccionado para el filtro actual.
                </div>
            </section>
        `;
    }

    return isAnnualPeriod(period)
        ? annualDetailHTML(summary, period, readonly, queue)
        : quarterDetailHTML(summary, period, readonly, queue);
}

function detailHeadHTML(summary, period) {
    const profile = summary.profile;
    const annual = isAnnualPeriod(period);

    return `
        <div class="qual-detail-head">
            <button class="qual-back" type="button" data-qual-back>
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="m14 6-6 6 6 6"></path>
                </svg>
                Volver a la lista
            </button>

            <div class="qual-detail-id">
                <span class="qual-avatar qual-avatar--lg">${escapeHTML(initials(profile.name))}</span>
                <div>
                    <div class="qual-detail-name">
                        <h3>${escapeHTML(profile.name || "Sin nombre")}</h3>
                        <span class="worker-request-status worker-request-status--${statusClass(summary.status)}">
                            ${escapeHTML(statusLabel(summary.status))}
                        </span>
                    </div>
                    <small>${escapeHTML([
                        profile.rut || "Sin RUT",
                        profile.estamento ? `Planta ${profile.estamento}` : "",
                        profile.profession || ""
                    ].filter(Boolean).join(" \u00b7 "))}</small>
                </div>
            </div>

            <div class="qual-detail-periods">
                <span class="qual-detail-kind">
                    ${annual ? "Calificacion anual" : "Informe cuatrimestral"}
                </span>
                <div class="qual-periods qual-periods--compact">
                    ${qualificationCycleSteps(period.cycleStartYear).map(step => `
                        <button class="qual-period${step.id === period.id ? " is-active" : ""}${isAnnualPeriod(step) ? " qual-period--annual" : ""}"
                            type="button"
                            data-qual-period="${escapeAttribute(step.id)}">
                            <strong>${escapeHTML(step.shortLabel)}</strong>
                        </button>
                    `).join("")}
                </div>
            </div>
        </div>
    `;
}

// Franja de antecedentes del periodo, arriba de los tres factores. Reemplaza a
// la rejilla de contadores: dice lo mismo en una linea y deja sitio para lo que
// de verdad se hace en esta pantalla, que es escribir.
function ledgerStripHTML(summary, period) {
    const training = summary.training.length + summary.calendarTraining.length;
    const leaveDays = summary.calendar.filter(item =>
        item.kind !== "training"
    ).length;
    const chips = [
        ["ok", summary.merits.length, "merito", "meritos"],
        ["warn", summary.demerits.length, "demerito", "demeritos"],
        ["mute", summary.events.length, "evento", "eventos"],
        ["bad", summary.lateCount, "atraso", "atrasos"],
        ["ok", training, "capacitacion", "capacitaciones"],
        ["mute", leaveDays, "dia de permiso", "dias de permiso"]
    ].filter(([, count]) => count > 0);

    return `
        <div class="qual-strip">
            <span class="qual-strip__label">
                Antecedentes de ${escapeHTML(period.label.toLowerCase())}
            </span>
            ${chips.length
                ? chips.map(([tone, count, one, many]) => `
                    <span class="qual-strip__chip qual-strip__chip--${tone}">
                        <strong>${count}</strong> ${escapeHTML(count === 1 ? one : many)}
                    </span>
                `).join("")
                : `<span class="qual-strip__chip qual-strip__chip--mute">Sin antecedentes en el periodo</span>`}
            <span class="qual-strip__hint">Toca un antecedente y se copia a la apreciacion</span>
        </div>
    `;
}

function supervisorFieldsHTML(record, editable) {
    return `
        <div class="qual-form-grid">
            <label>
                <span>Jefe directo</span>
                <input name="supervisorName"
                    type="text"
                    maxlength="${MAX_TEXT_LENGTH}"
                    value="${escapeAttribute(record?.supervisorName || "")}"
                    ${editable ? "" : "disabled"}>
            </label>
            <label>
                <span>Cargo</span>
                <input name="supervisorCargo"
                    type="text"
                    maxlength="${MAX_TEXT_LENGTH}"
                    value="${escapeAttribute(record?.supervisorCargo || "")}"
                    ${editable ? "" : "disabled"}>
            </label>
        </div>
    `;
}

/* ==========================================================================
   Informe cuatrimestral: tres al ano, escrito y SIN notas.
   ========================================================================== */

// "3 de 73" y el salto al siguiente sin evaluar: es lo que evita volver a la
// bandeja entre trabajador y trabajador cuando hay setenta y tres que escribir.
function queueFooterHTML(summary, queue = []) {
    const index = queue.findIndex(item =>
        item.profileKey === summary.profileKey
    );
    const next = queue.find(item =>
        item.profileKey !== summary.profileKey &&
        item.status !== STATUS_ARCHIVED
    );

    return `
        <span class="qual-queue-foot">
            <small>${index >= 0 ? index + 1 : 1} de ${queue.length || 1}</small>
            ${next ? `
                <button class="ghost-button ghost-button--small" type="button" data-qual-next="${escapeAttribute(next.profileKey)}">
                    Siguiente sin evaluar
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="m10 6 6 6-6 6"></path>
                    </svg>
                </button>
            ` : ""}
        </span>
    `;
}

function quarterDetailHTML(summary, period, readonly, queue = []) {
    const record = summary.record;
    const editable = !readonly;
    const evidence = evidenceByFactor(summary);
    const written = QUALIFICATION_FACTORS.filter(factor =>
        String(record?.appraisals?.[factor.key] || "").trim()
    ).length;
    const complete = written === QUALIFICATION_FACTORS.length;

    return `
        <section class="panel qual-detail-panel">
            ${detailHeadHTML(summary, period)}

            ${ledgerStripHTML(summary, period)}

            <p class="qual-note">
                Este informe va SIN notas: son apreciaciones escritas. Las notas,
                los coeficientes y la lista se ponen una vez al ano, en la
                calificacion de septiembre.
            </p>

            <form class="qual-form" data-qual-form>
                ${supervisorFieldsHTML(record, editable)}

                <div class="qual-factors">
                    ${QUALIFICATION_FACTORS.map(factor => appraisalFieldHTML(
                        factor,
                        record,
                        evidence[factor.key] || [],
                        editable
                    )).join("")}
                </div>

                ${paperFlowHTML(summary, summary.status)}

                <div class="qual-actions">
                    <button class="secondary-button" type="button" data-qual-print ${complete && editable ? "" : "disabled"}>
                        ${complete ? "Imprimir formulario" : "Escribe las tres apreciaciones"}
                    </button>
                    <button class="primary-button" type="submit" ${editable ? "" : "disabled"}>
                        Guardar borrador
                    </button>
                    <button class="danger-action" type="button" data-qual-reset ${editable ? "" : "disabled"}>
                        Reiniciar
                    </button>
                    ${queueFooterHTML(summary, queue)}
                </div>
            </form>
        </section>
    `;
}

/* ==========================================================================
   Calificacion anual: una al ano, con las notas del articulo 14.
   ========================================================================== */

// Las dos primeras lineas del informe, para poder compararlos sin abrirlos.
function reportExcerpt(parts) {
    const text = parts.map(part => part.text).join(" ").trim();

    if (!text) return "Sin escribir en este cuatrimestre.";

    return text.length > 96 ? `${text.slice(0, 95)}...` : text;
}

function quarterReportsHTML(summary, period) {
    const state = getQualificationState();
    const reports = qualificationPeriods(period.cycleStartYear).map(quarter => {
        const record = findRecordForProfile(state, quarter, summary.profile);
        const parts = QUALIFICATION_FACTORS
            .map(factor => ({
                label: factor.label,
                text: String(record?.appraisals?.[factor.key] || "").trim()
            }))
            .filter(part => part.text);

        return { quarter, parts };
    });

    const openId = openReportId ||
        (reports.find(item => item.parts.length) || reports[0])?.quarter.id ||
        "";
    const open = reports.find(item => item.quarter.id === openId);

    return `
        <section class="qual-reports">
            <div class="qual-subhead">
                <h4>Los tres informes cuatrimestrales del periodo</h4>
                <span>Art. 19: antecedente relevante de la precalificacion</span>
            </div>
            <div class="qual-reports__cards">
                ${reports.map(({ quarter, parts }) => `
                    <button class="qual-report-card${quarter.id === openId ? " is-open" : ""}"
                        type="button"
                        data-qual-report="${escapeAttribute(quarter.id)}">
                        <span class="qual-report-card__head">
                            <strong>${escapeHTML(quarter.shortLabel)} ${quarter.endDate.getFullYear()}</strong>
                            <span class="${parts.length ? "is-ok" : "is-missing"}">
                                ${parts.length ? "escrita" : "sin escribir"}
                            </span>
                        </span>
                        <small>${escapeHTML(reportExcerpt(parts))}</small>
                    </button>
                `).join("")}
            </div>
            ${open && open.parts.length ? `
                <div class="qual-report__body">
                    <span class="qual-report__title">${escapeHTML(open.quarter.label)} ${open.quarter.endDate.getFullYear()}</span>
                    ${open.parts.map(part => `
                        <div class="qual-report__part">
                            <strong>${escapeHTML(part.label)}</strong>
                            <p>${escapeHTML(part.text)}</p>
                        </div>
                    `).join("")}
                </div>
            ` : `
                <p class="qual-evidence-empty">
                    No se escribio el informe de ese cuatrimestre.
                </p>
            `}
        </section>
    `;
}

function annualDetailHTML(summary, period, readonly, queue = []) {
    const profile = summary.profile;
    const record = summary.record;
    const editable = !readonly;
    const points = qualificationPoints(record, profile);
    const coefficientGroup =
        QUALIFICATION_COEFFICIENTS[qualificationCoefficientGroup(profile)] ||
        QUALIFICATION_COEFFICIENTS.administrativos_auxiliares;
    const previousScores = previousCycleScores(profile, period.cycleStartYear);

    const coefficients = QUALIFICATION_FACTORS
        .map(factor => String(coefficientGroup[factor.key]).replace(".", ","))
        .join(" / ");

    return `
        <section class="panel qual-detail-panel">
            <div class="qual-detail-bar">
                <button class="qual-back" type="button" data-qual-back>
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="m14 6-6 6 6 6"></path>
                    </svg>
                    Volver a la lista
                </button>
                <div class="qual-periods qual-periods--compact">
                    ${qualificationCycleSteps(period.cycleStartYear).map(step => `
                        <button class="qual-period${step.id === period.id ? " is-active" : ""}${isAnnualPeriod(step) ? " qual-period--annual" : ""}"
                            type="button"
                            data-qual-period="${escapeAttribute(step.id)}">
                            <strong>${escapeHTML(step.shortLabel)}</strong>
                        </button>
                    `).join("")}
                </div>
            </div>

            <div class="qual-annual-head">
                <div class="qual-detail-id">
                    <span class="qual-avatar qual-avatar--lg">${escapeHTML(initials(profile.name))}</span>
                    <div>
                        <div class="qual-detail-name">
                            <h3>${escapeHTML(profile.name || "Sin nombre")}</h3>
                            <span class="qual-kind-pill">Precalificacion anual</span>
                        </div>
                        <small>Planta ${escapeHTML(coefficientGroup.label)} &middot; coeficientes ${escapeHTML(coefficients)} (art. 17)</small>
                        <small>Periodo ${escapeHTML(formatDate(period.startISO))} al ${escapeHTML(formatDate(period.endISO))} &middot; la precalificacion se cierra el ${escapeHTML(formatDate(period.deadlineISO))}</small>
                    </div>
                </div>
                ${scoreCardHTML(
                    record,
                    points,
                    previousCyclePoints(profile, period.cycleStartYear)
                )}
            </div>

            ${quarterReportsHTML(summary, period)}

            <form class="qual-form" data-qual-form>
                ${supervisorFieldsHTML(record, editable)}

                <div class="qual-factors">
                    ${QUALIFICATION_FACTORS.map(factor => factorFieldHTML(
                        factor,
                        record,
                        editable,
                        previousScores
                    )).join("")}
                </div>

                <label>
                    <span>Observaciones de la jefatura</span>
                    <textarea name="observations"
                        rows="3"
                        maxlength="${MAX_NOTE_LENGTH}"
                        ${editable ? "" : "disabled"}>${escapeHTML(record?.observations || "")}</textarea>
                </label>

                <div class="qual-actions">
                    <button class="primary-button" type="submit" ${editable ? "" : "disabled"}>
                        Guardar borrador
                    </button>
                    <button class="secondary-button" type="button" data-qual-evaluate ${editable ? "" : "disabled"}>
                        Cerrar precalificacion
                    </button>
                    <button class="danger-action" type="button" data-qual-reset ${editable ? "" : "disabled"}>
                        Reiniciar
                    </button>
                    ${queueFooterHTML(summary, queue)}
                </div>
            </form>
        </section>
    `;
}

function collectFormRecord(form, summary, period, status = STATUS_DRAFT) {
    const now = new Date().toISOString();
    const profile = summary.profile;
    const previous = summary.record || {};
    const annual = isAnnualPeriod(period);
    const factors = {};
    const appraisals = {};

    QUALIFICATION_FACTORS.forEach(factor => {
        if (annual) {
            // Solo la calificacion anual lleva notas.
            const commentInput = form.querySelector(
                `[data-qual-comment="${factor.key}"]`
            );
            const subfactors = {};

            factor.subfactors.forEach(subfactor => {
                const scoreInput = form.querySelector(
                    `[data-qual-sub-score="${factor.key}:${subfactor.key}"]`
                );
                const subCommentInput = form.querySelector(
                    `[data-qual-sub-comment="${factor.key}:${subfactor.key}"]`
                );

                subfactors[subfactor.key] = {
                    score: scoreInput?.value || "",
                    comment: subCommentInput?.value || ""
                };
            });

            factors[factor.key] = {
                subfactors,
                comment: commentInput?.value || ""
            };
            return;
        }

        const appraisal = form.querySelector(
            `[data-qual-appraisal="${factor.key}"]`
        );

        appraisals[factor.key] = appraisal?.value || "";
    });

    return normalizeRecord({
        ...previous,
        id: periodRecordId(period, profile),
        profileKey: profileKey(profile),
        profileName: profile.name || "",
        profileRut: profile.rut || "",
        cycleStartYear: period.cycleStartYear,
        periodId: period.id,
        status,
        // Cada instrumento escribe lo suyo y deja intacto lo del otro: si se
        // guarda un informe escrito, las notas de la anual no se tocan.
        factors: annual ? factors : previous.factors,
        appraisals: annual ? previous.appraisals : appraisals,
        scan: previous.scan,
        supervisorName: form.elements.supervisorName?.value || "",
        supervisorCargo: form.elements.supervisorCargo?.value || "",
        // Se lee el campo tal cual: con `|| previous` no habia forma de
        // dejarlo vacio, porque al borrarlo volvia el texto anterior.
        observations: form.elements.observations
            ? form.elements.observations.value
            : previous.observations || "",
        employeeObservations: previous.employeeObservations || "",
        employeeAgreement: previous.employeeAgreement || "",
        createdAt: previous.createdAt || now,
        updatedAt: now,
        evaluatedAt: status === STATUS_EVALUATED || status === STATUS_ARCHIVED
            ? previous.evaluatedAt || now
            : previous.evaluatedAt || ""
    });
}

// El formulario de personal, relleno con lo que se escribio.
function buildFormDocument(summary, period) {
    const record = summary.record || {};
    const profile = summary.profile || {};

    return qualificationFormHTML({
        folio: String(record.id || "").slice(-12).toUpperCase(),
        periodId: period.id,
        year: period.endDate.getFullYear(),
        profile: {
            name: profile.name || "",
            planta: profile.estamento || "",
            unidad: profile.profession || getActiveWorkspaceName()
        },
        supervisor: {
            name: record.supervisorName || "",
            cargo: record.supervisorCargo || ""
        },
        factors: QUALIFICATION_FACTORS.map(factor => ({
            title: factor.formTitle,
            formText: factor.formText,
            text: record.appraisals?.[factor.key] || ""
        }))
    });
}

function getActiveWorkspaceName() {
    try {
        return getActiveWorkspace()?.name || "";
    } catch (error) {
        return "";
    }
}

function persistRecord(record) {
    if (!record?.id) return;

    const state = getQualificationState();
    state.records[record.id] = record;
    saveQualificationState(state);
}

function removeRecord(summary, period) {
    const id = periodRecordId(period, summary.profile);
    const state = getQualificationState();

    delete state.records[id];
    saveQualificationState(state);
}



// Estado del cuatrimestre dentro del ciclo, para la pastilla del boton: lo que
// ya paso, lo que corre y lo que todavia no empieza.
function periodStageLabel(period, today = new Date()) {
    if (isAnnualPeriod(period)) return "septiembre";

    const iso = toISODate(today);

    if (iso > period.endISO) return "cerrado";
    if (iso < period.startISO) return "por venir";

    return "en curso";
}

function periodButtonHTML(period) {
    const active = period.id === selectedPeriodId;
    const annual = isAnnualPeriod(period);
    const stage = periodStageLabel(period);

    return `
        <button class="qual-period${active ? " is-active" : ""}${annual ? " qual-period--annual" : ""}"
            type="button"
            data-qual-period="${escapeAttribute(period.id)}">
            <strong>${escapeHTML(annual ? "Calificacion anual" : period.label)}</strong>
            <span class="qual-period__stage">${escapeHTML(stage)}</span>
        </button>
    `;
}

// Lo que entro al periodo en TODA la unidad. No es adorno: es el material con
// el que se escriben las apreciaciones, y verlo junto evita la sensacion de
// que hay que ir a buscarlo a otra parte.
function unitLedgerHTML(summaries) {
    const totals = summaries.reduce((sum, summary) => ({
        merits: sum.merits + summary.merits.length,
        demerits: sum.demerits + summary.demerits.length,
        events: sum.events + summary.events.length,
        late: sum.late + summary.lateCount,
        training: sum.training +
            summary.training.length +
            summary.calendarTraining.length
    }), { merits: 0, demerits: 0, events: 0, late: 0, training: 0 });

    const rows = [
        ["ok", totals.merits, "anotaciones de merito"],
        ["warn", totals.demerits, "anotaciones de demerito"],
        ["mute", totals.events, "eventos registrados"],
        ["bad", totals.late, "atrasos en reloj control"],
        ["ok", totals.training, "capacitaciones aprobadas"]
    ];

    return `
        <section class="qual-ledger">
            <div class="qual-panel-head">
                <span>Antecedentes que entraron al periodo</span>
            </div>
            <div class="qual-ledger__grid">
                ${rows.map(([tone, count, label]) => `
                    <div class="qual-ledger__item">
                        <span class="qual-ledger__dot qual-ledger__dot--${tone}"></span>
                        <span>
                            <strong>${count}</strong>
                            <small>${escapeHTML(label)}</small>
                        </span>
                    </div>
                `).join("")}
            </div>
            <p class="qual-ledger__note">
                Todo esto ya esta en el sistema: anotaciones, reloj control y
                capacitaciones. La apreciacion escrita se apoya en ello y no hay
                que ir a buscarlo a otra parte.
            </p>
        </section>
    `;
}

function progressHTML(period, summaries) {
    const total = summaries.length || 1;
    const pending = summaries.filter(summary =>
        summary.status === STATUS_PENDING
    ).length;
    const drafts = summaries.filter(summary =>
        summary.status === STATUS_DRAFT
    ).length;
    const printed = summaries.filter(summary =>
        summary.status === STATUS_PRINTED
    ).length;
    const archived = summaries.filter(summary =>
        summary.status === STATUS_ARCHIVED
    ).length;
    const annual = isAnnualPeriod(period);

    return `
        <section class="qual-progress">
            <div class="qual-panel-head">
                <span>${annual ? "Avance de la calificacion anual" : "Avance del cuatrimestre"}</span>
                <strong>${archived} de ${summaries.length} ${annual ? "cerradas" : "firmadas"}</strong>
            </div>
            <div class="qual-progress__bar">
                <span class="qual-progress__done" style="width: ${(archived / total) * 100}%"></span>
                <span class="qual-progress__printed" style="width: ${(printed / total) * 100}%"></span>
            </div>
            <div class="qual-progress__grid">
                ${kpiCardHTML(
                    "Sin escribir",
                    pending,
                    "no empezadas",
                    pending ? "orange" : "green"
                )}
                ${kpiCardHTML("Borradores", drafts, "a medio escribir", "slate")}
                ${kpiCardHTML(
                    "Impresas",
                    printed,
                    annual ? "sin cerrar" : "esperando firma",
                    "blue"
                )}
                ${kpiCardHTML(
                    "Archivadas",
                    archived,
                    annual ? "cerradas" : "escaneadas",
                    "green"
                )}
            </div>
        </section>
    `;
}

function renderHeader(period, summaries) {
    const pending = summaries.filter(summary =>
        summary.status === STATUS_PENDING
    ).length;
    const nextPending = summaries.find(summary =>
        summary.status !== STATUS_ARCHIVED
    );

    return `
        <div class="section-head section-head--with-action qual-head">
            <span class="section-head__title">
                <h3>Calificaciones</h3>
                <small>Tres informes escritos al a&ntilde;o, y la calificaci&oacute;n con notas en septiembre</small>
            </span>
            <span class="qual-head__actions">
                <span class="qual-deadline${pending ? " is-urgent" : ""}">
                    ${escapeHTML(deadlineText(period, pending))}
                </span>
                ${nextPending ? `
                    <button class="primary-button qual-queue" type="button" data-qual-queue>
                        Evaluar en fila
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="m10 6 6 6-6 6"></path>
                        </svg>
                    </button>
                ` : ""}
            </span>
        </div>

        <section class="qual-cyclebar">
            <button class="qual-cycle-nav" type="button" data-qual-cycle="-1" aria-label="Ciclo anterior">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m14 6-6 6 6 6"></path></svg>
            </button>
            <strong>Ciclo ${period.cycleStartYear}&#8209;${period.cycleStartYear + 1}</strong>
            <button class="qual-cycle-nav" type="button" data-qual-cycle="1" aria-label="Ciclo siguiente">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m10 6 6 6-6 6"></path></svg>
            </button>
            <div class="qual-periods">
                ${qualificationCycleSteps(period.cycleStartYear)
                    .map(periodButtonHTML)
                    .join("")}
            </div>
        </section>

        <section class="qual-overview">
            ${progressHTML(period, summaries)}
            ${unitLedgerHTML(summaries)}
        </section>
    `;
}

function renderList(visible, summaries, period) {
    const counts = {
        [STATUS_ALL]: summaries.length,
        [STATUS_PENDING]: summaries.filter(summary =>
            summary.status === STATUS_PENDING
        ).length,
        [STATUS_DRAFT]: summaries.filter(summary =>
            summary.status === STATUS_DRAFT
        ).length,
        // Un solo filtro para las dos etapas del papel: lo que ya salio a
        // la impresora, este o no de vuelta el escaneado.
        [STATUS_PRINTED]: summaries.filter(summary =>
            isClosedStatus(summary.status)
        ).length,
        [STATUS_ARCHIVED]: summaries.filter(summary =>
            summary.status === STATUS_ARCHIVED
        ).length
    };

    return `
        <section class="panel qual-list-panel">
            <div class="qual-list-tools">
                <label class="field-shell field-shell--icon">
                    <span class="field-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="11" cy="11" r="7"></circle>
                            <path d="M21 21l-4.35-4.35"></path>
                        </svg>
                    </span>
                    <input type="search"
                        data-qual-search
                        value="${escapeAttribute(searchText)}"
                        placeholder="Buscar trabajador, RUT o estamento">
                </label>
                <div class="worker-request-filters">
                    ${filterButtonHTML(STATUS_ALL, "Todos", counts[STATUS_ALL])}
                    ${filterButtonHTML(STATUS_PENDING, "Pendientes", counts[STATUS_PENDING])}
                    ${filterButtonHTML(STATUS_DRAFT, "Borrador", counts[STATUS_DRAFT])}
                    ${filterButtonHTML(STATUS_PRINTED, "Impresas", counts[STATUS_PRINTED])}
                    ${filterButtonHTML(STATUS_ARCHIVED, "Archivadas", counts[STATUS_ARCHIVED])}
                </div>
            </div>

            <div class="qual-list-head">
                <h4>Trabajadores</h4>
                <small>${escapeHTML(formatDate(period.startISO))} - ${escapeHTML(formatDate(period.endISO))}</small>
            </div>

            <div class="qual-worker-list">
                ${incidentCache.loading
                    ? `<div class="qual-sync-note">Calculando marcajes del periodo...</div>`
                    : ""}
                ${visible.length
                    ? visible.map(workerRowHTML).join("")
                    : `
                        <div class="empty-state empty-state--compact">
                            Sin trabajadores para el filtro seleccionado.
                        </div>
                    `}
            </div>
        </section>
    `;
}

export function renderQualificationsPanel() {
    if (typeof document === "undefined") return;

    const panel = document.getElementById("qualificationsPanel");

    if (!panel) return;

    const period = periodById(selectedPeriodId, selectedCycleStartYear);
    const profiles = getProfiles().filter(isProfileActive);
    const state = getQualificationState();

    void ensurePeriodIncidents(period, profiles);

    const summaries = profiles.map(profile =>
        buildSummary(
            profile,
            period,
            state,
            incidentCache.eventsByProfile
        )
    );
    const visible = visibleSummaries(summaries);
    // Solo hay ficha abierta si el supervisor eligio a alguien. Sin eleccion
    // se ve la bandeja entera, que es donde se pasa la mayor parte del tiempo.
    const selected = openProfileKey
        ? visible.find(summary => summary.profileKey === openProfileKey) ||
            summaries.find(summary => summary.profileKey === openProfileKey) ||
            null
        : null;
    const readonly = !canEditMenu("qualifications");

    if (openProfileKey && !selected) openProfileKey = "";

    panel.innerHTML = `
        <div class="qual-root">
            ${selected
                ? detailHTML(selected, period, readonly, visible)
                : `
                    ${renderHeader(period, summaries)}
                    ${renderList(visible, summaries, period)}
                `}
        </div>
    `;

    bindQualificationsPanel(panel, {
        period,
        summaries,
        selected
    });
}

function bindQualificationsPanel(panel, { period, summaries, selected }) {
    panel.querySelectorAll("[data-qual-cycle]").forEach(button => {
        button.onclick = () => {
            selectedCycleStartYear += Number(button.dataset.qualCycle) || 0;
            selectedPeriodId = "sep-dec";
            openProfileKey = "";
            incidentCache = {
                key: "",
                loading: false,
                eventsByProfile: new Map()
            };
            renderQualificationsPanel();
        };
    });

    panel.querySelectorAll("[data-qual-period]").forEach(button => {
        button.onclick = () => {
            selectedPeriodId = button.dataset.qualPeriod || "sep-dec";
            // NO se cierra la ficha: dentro de una evaluacion los cuatro pasos
            // del ciclo son pestañas de la MISMA persona, y cerrarla obligaria
            // a volver a buscarla en la lista para ver su otro cuatrimestre.
            incidentCache = {
                key: "",
                loading: false,
                eventsByProfile: new Map()
            };
            renderQualificationsPanel();
        };
    });

    panel.querySelectorAll("[data-qual-status]").forEach(button => {
        button.onclick = () => {
            selectedStatus = button.dataset.qualStatus || STATUS_ALL;
            openProfileKey = "";
            renderQualificationsPanel();
        };
    });

    const search = panel.querySelector("[data-qual-search]");

    if (search) {
        search.oninput = () => {
            searchText = search.value || "";
            openProfileKey = "";
            const cursor = search.selectionStart;

            clearTimeout(searchRenderTimer);
            searchRenderTimer = setTimeout(() => {
                renderQualificationsPanel();
                const nextSearch = document.querySelector(
                    "[data-qual-search]"
                );

                nextSearch?.focus();
                if (
                    nextSearch &&
                    typeof nextSearch.setSelectionRange === "function"
                ) {
                    nextSearch.setSelectionRange(cursor, cursor);
                }
            }, 140);
        };
    }

    panel.querySelectorAll("[data-qual-report]").forEach(button => {
        button.onclick = () => {
            openReportId = button.dataset.qualReport || "";
            renderQualificationsPanel();
        };
    });

    panel.querySelector("[data-qual-back]")?.addEventListener("click", () => {
        openProfileKey = "";
        renderQualificationsPanel();
    });

    panel.querySelector("[data-qual-next]")?.addEventListener("click", event => {
        openProfileKey = event.currentTarget.dataset.qualNext || "";
        renderQualificationsPanel();
    });

    panel.querySelector("[data-qual-queue]")?.addEventListener("click", () => {
        // Salta al primero que aun no este archivado, respetando el orden de
        // la lista: primero lo que falta por escribir.
        const next = summaries.find(summary =>
            summary.status !== STATUS_ARCHIVED
        );

        if (!next) return;

        openProfileKey = next.profileKey;
        renderQualificationsPanel();
    });

    panel.querySelectorAll("[data-qual-profile]").forEach(button => {
        button.onclick = () => {
            openProfileKey = button.dataset.qualProfile || "";
            renderQualificationsPanel();
        };
    });

    const form = panel.querySelector("[data-qual-form]");

    if (form && selected) {
        const annual = isAnnualPeriod(period);

        form.onsubmit = event => {
            event.preventDefault();
            persistRecord(collectFormRecord(form, selected, period));
            renderQualificationsPanel();
        };

        form.querySelector("[data-qual-evaluate]")?.addEventListener(
            "click",
            () => {
                persistRecord(
                    collectFormRecord(form, selected, period, STATUS_EVALUATED)
                );
                renderQualificationsPanel();
            }
        );

        form.querySelector("[data-qual-reset]")?.addEventListener(
            "click",
            () => {
                void resetRecord(selected, period);
            }
        );

        // Imprimir NO abre el dialogo del navegador sobre la pagina entera:
        // arma el formulario de personal relleno y lo manda a un iframe. Y deja
        // el informe marcado como impreso, que es el paso que sigue en el papel.
        form.querySelector("[data-qual-print]")?.addEventListener(
            "click",
            () => {
                persistRecord(
                    collectFormRecord(form, selected, period, STATUS_PRINTED)
                );
                printQualificationForm(
                    buildFormDocument(
                        currentSummaryFor(selected, period),
                        period
                    )
                );
                renderQualificationsPanel();
            }
        );

        if (annual) {
            bindNoteScales(form, selected, period);
        } else {
            bindAppraisalHelpers(form, selected, period);
        }
    }

    bindScanControls(panel, selected, period);

    if (
        selected &&
        !summaries.some(summary =>
            summary.profileKey === openProfileKey
        )
    ) {
        openProfileKey = selected.profileKey;
    }
}

// Vuelve a leer el resumen desde el almacen. Se usa justo despues de guardar,
// cuando hay que imprimir con lo recien escrito y el `summary` en mano ya
// quedo viejo.
function currentSummaryFor(summary, period) {
    const state = getQualificationState();
    const record = findRecordForProfile(state, period, summary.profile);

    return { ...summary, record };
}

/**
 * Los atajos del informe escrito: contar caracteres mientras se escribe y
 * copiar un antecedente al final de la apreciacion.
 *
 * El contador se actualiza a mano, sin repintar el panel: repintar con cada
 * tecla le quitaria el foco al recuadro en el que se esta escribiendo.
 */
function bindAppraisalHelpers(form, summary, period) {
    const evidence = evidenceByFactor(summary);

    QUALIFICATION_FACTORS.forEach(factor => {
        const field = form.querySelector(
            `[data-qual-appraisal="${factor.key}"]`
        );
        const counter = form.querySelector(
            `[data-qual-count="${factor.key}"]`
        );

        if (!field) return;

        const paint = () => {
            if (!counter) return;

            const length = field.value.trim().length;

            counter.textContent = length
                ? `${length} caracteres escritos`
                : "Sin escribir";
        };

        field.oninput = paint;
    });

    form.querySelectorAll("[data-qual-file-source]").forEach(button => {
        button.onclick = () => {
            const source = button.dataset.qualFileSource;
            const index = Number(button.dataset.qualFileIndex);
            const entry = (summary[source] || [])[index];

            if (!hasAttachmentContent(entry?.file)) return;

            void openAttachmentFile(entry.file, { newTab: true })
                .catch(async error => {
                    await showAlert(
                        error?.message || "No se pudo abrir el archivo.",
                        { title: "Calificaciones", tone: "danger" }
                    );
                });
        };
    });

    form.querySelectorAll("[data-qual-insert]").forEach(button => {
        button.onclick = () => {
            const key = button.dataset.qualInsert;
            const index = Number(button.dataset.qualInsertIndex);
            const item = (evidence[key] || [])[index];
            const field = form.querySelector(
                `[data-qual-appraisal="${key}"]`
            );

            if (!item || !field) return;

            // Se agrega al final y no se reemplaza: el antecedente es material
            // para la redaccion, no la redaccion misma.
            const current = field.value.trim();

            field.value = current ? `${current} ${item.text}` : item.text;
            field.focus();
            field.setSelectionRange(field.value.length, field.value.length);
            field.dispatchEvent(new Event("input", { bubbles: true }));
        };
    });
}

/** Subir, abrir y quitar el formulario firmado que vuelve escaneado. */
function bindScanControls(panel, summary, period) {
    if (!summary) return;

    const input = panel.querySelector("[data-qual-scan]");

    if (input) {
        input.onchange = () => {
            // Se le pasa el formulario: adjuntar tiene que guardar tambien lo
            // que este escrito y sin guardar, o el repintado posterior se lo
            // lleva por delante.
            void attachScan(
                input,
                summary,
                period,
                panel.querySelector("[data-qual-form]")
            );
        };
    }

    panel.querySelector("[data-qual-scan-open]")?.addEventListener(
        "click",
        () => {
            void openScan(summary);
        }
    );

    panel.querySelector("[data-qual-scan-remove]")?.addEventListener(
        "click",
        () => {
            void removeScan(summary, period);
        }
    );
}

async function attachScan(input, summary, period, form) {
    const file = input.files?.[0];

    if (!file) return;

    input.disabled = true;

    // Lo escrito en pantalla manda sobre lo guardado: si el supervisor termino
    // de redactar y arrastro el escaneado sin guardar antes, no se pierde.
    const typed = form
        ? collectFormRecord(form, summary, period, STATUS_ARCHIVED)
        : null;

    try {
        const [uploaded] = await readAttachmentFiles([file], {
            moduleId: "qualifications",
            ownerId: summary.profileKey,
            recordId: periodRecordId(period, summary.profile)
        });

        if (!uploaded) return;

        const state = getQualificationState();
        const previous = typed ||
            findRecordForProfile(state, period, summary.profile);
        const record = normalizeRecord({
            ...(previous || {}),
            id: periodRecordId(period, summary.profile),
            profileKey: summary.profileKey,
            profileName: summary.profile.name || "",
            profileRut: summary.profile.rut || "",
            cycleStartYear: period.cycleStartYear,
            periodId: period.id,
            status: STATUS_ARCHIVED,
            scan: uploaded,
            createdAt: previous?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            evaluatedAt: previous?.evaluatedAt || new Date().toISOString()
        });

        persistRecord(record);
    } catch (error) {
        console.error("No se pudo adjuntar el escaneado.", error);
        await showAlert(
            error?.attachmentStorageMessage ||
            String(error?.code || "").startsWith("storage/")
                ? attachmentStorageErrorMessage(error, "subir")
                : error?.message ||
                    "No se pudo adjuntar el archivo. Revisa la conexion e intenta nuevamente.",
            { title: "Calificaciones", tone: "danger" }
        );
    } finally {
        input.disabled = false;
        renderQualificationsPanel();
    }
}

async function openScan(summary) {
    const scan = summary.record?.scan;

    if (!hasAttachmentContent(scan)) return;

    try {
        await openAttachmentFile(scan, { newTab: true });
    } catch (error) {
        await showAlert(
            error?.attachmentStorageMessage
                ? error.message
                : error?.message || "No se pudo abrir el archivo.",
            { title: "Calificaciones", tone: "danger" }
        );
    }
}

async function removeScan(summary, period) {
    const scan = summary.record?.scan;

    if (!scan) return;

    if (!await showConfirm(
        "Se quitara el formulario escaneado de este cuatrimestre. El informe vuelve a quedar como impreso sin firma.",
        {
            title: "Quitar escaneado",
            tone: "danger",
            confirmText: "Quitar",
            destructive: true
        }
    )) {
        return;
    }

    try {
        await deleteStoredAttachment(scan);
    } catch (error) {
        console.warn("No se pudo borrar el archivo del almacenamiento.", error);
    }

    const state = getQualificationState();
    const previous = findRecordForProfile(state, period, summary.profile);

    if (previous) {
        persistRecord(normalizeRecord({
            ...previous,
            scan: null,
            status: STATUS_PRINTED,
            updatedAt: new Date().toISOString()
        }));
    }

    renderQualificationsPanel();
}

async function resetRecord(summary, period) {
    if (!await showConfirm(
        "Se borrara lo escrito en este periodo, incluido el formulario escaneado si lo hay.",
        {
            title: "Reiniciar evaluacion",
            tone: "danger",
            confirmText: "Reiniciar",
            destructive: true
        }
    )) {
        return;
    }

    const scan = summary.record?.scan;

    if (scan) {
        try {
            await deleteStoredAttachment(scan);
        } catch (error) {
            console.warn("No se pudo borrar el archivo del almacenamiento.", error);
        }
    }

    removeRecord(summary, period);
    renderQualificationsPanel();
}

function qualificationDataChanged(keys = []) {
    return keys.some(key => {
        const clean = String(key || "");

        return clean === QUALIFICATIONS_KEY ||
            clean === "profiles" ||
            clean === "attendanceMarks" ||
            clean === "attendanceMarksImportedAt" ||
            clean.startsWith("hrLogs_") ||
            clean.startsWith("shiftAttendance_") ||
            clean.startsWith("admin_") ||
            clean.startsWith("legal_") ||
            clean.startsWith("comp_") ||
            clean.startsWith("absences_") ||
            clean.startsWith("clockMarks_");
    });
}

export function initQualificationsPanel() {
    if (typeof window === "undefined") return;

    const rerenderWhenActive = keys => {
        if (
            document.body.dataset.activeView !== "qualifications" ||
            !qualificationDataChanged(keys)
        ) {
            return;
        }

        incidentCache = {
            key: "",
            loading: false,
            eventsByProfile: new Map()
        };
        renderQualificationsPanel();
    };

    window.addEventListener("proturnos:persistenceChanged", event => {
        rerenderWhenActive(event.detail?.keys || []);
    });

    window.addEventListener("proturnos:firebaseAppState", event => {
        rerenderWhenActive(event.detail?.keys || []);
    });

    window.addEventListener("proturnos:workspacePermissionsChanged", () => {
        if (document.body.dataset.activeView === "qualifications") {
            renderQualificationsPanel();
        }
    });
}
