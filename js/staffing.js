import { isoFromKey, parseKeyParts as parseKey } from "./dateUtils.js";
import { normalizeText } from "./stringUtils.js";
import { escapeHTML } from "./htmlUtils.js";
import {
    getCurrentProfile,
    getProfiles,
    getReplacements,
    getRotativa,
    isProfileActive,
    getProfessionOptionsForEstamento,
    normalizeProfession
} from "./storage.js";
import {
    aplicarCambiosTurno,
    getTurnoBase,
    getTurnoProgramado
} from "./turnEngine.js";
import { ESTAMENTO, TURNO } from "./constants.js";
import { currentDate } from "./calendar.js";
import { cededSwapTurnBlocks } from "./swaps.js";
import { getJSON, setJSON } from "./persistence.js";
import { getCurrentFirebaseUser } from "./firebaseClient.js";
import { fetchHolidays } from "./holidays.js";
import { isBusinessDay } from "./calculations.js";
import {
    formatContractDate,
    getAllReplacementContracts,
    getReplacedProfileForDate,
    isReplacementProfile
} from "./contracts.js";
import {
    getAbsenceType,
    requiereReemplazoTurnoBase
} from "./rulesEngine.js";
import {
    getReplacementForCoveredShift
} from "./replacements.js";
import {
    addAuditLog,
    AUDIT_CATEGORY
} from "./auditLog.js";
import { getHourReturn } from "./hourReturns.js";

const KEY = "staffing_config";
const APPLICANTS_KEY = "staffing_applicants";
const REMINDERS_KEY = "staffing_custom_reminders";

let staffingViewBound = false;
let staffingWeekDate = null;
let staffingAnalysisRequest = 0;
let staffingWeeklyStickyCleanup = null;
let lastInlineStaffingReport = null;

const STAFFING_DATE_REMINDERS = [
    { month: 4, day: 12, label: "D\u00eda de la Enfermera(o)" },
    { month: 4, day: 6, label: "D\u00eda del Nutricionista" },
    { month: 4, day: 6, label: "D\u00eda del Kinesi\u00f3logo" },
    { month: 11, day: 3, label: "D\u00eda del M\u00e9dico" },
    { month: 11, day: 3, label: "D\u00eda de la Secretaria" },
    { month: 2, day: 19, label: "D\u00eda del Auxiliar de Servicio" },
    { month: 9, day: 2, label: "D\u00eda del Tecn\u00f3logo M\u00e9dico" },
    { month: 8, day: 25, label: "D\u00eda del Qu\u00edmico Farmac\u00e9utico" },
    { month: 3, day: 5, label: "D\u00eda del Terapeuta Ocupacional" },
    { month: 11, day: 9, label: "D\u00eda del Psic\u00f3logo" },
    { month: 10, day: 8, label: "D\u00eda del Radi\u00f3logo" },
    { month: 2, day: 26, label: "D\u00eda del TENS" },
    { month: 10, day: 25, label: "D\u00eda del Param\u00e9dico" },
    { month: 8, day: 12, label: "D\u00eda del Contador" },
    { month: 5, day: 21, label: "D\u00eda del Padre" },
    { month: 4, day: 10, label: "D\u00eda de la Madre" },
    { month: 2, day: 8, label: "D\u00eda de la Mujer" },
    { month: 10, day: 19, label: "D\u00eda del Hombre" },
    { month: 4, day: 14, label: "D\u00eda del Ingeniero" },
    { month: 4, day: 21, label: "D\u00eda del Abogado" },
    { month: 5, day: 11, label: "D\u00eda del Periodista" },
    { month: 5, day: 30, label: "D\u00eda del Bombero" },
    { month: 9, day: 16, label: "D\u00eda del Profesor" },
    { month: 9, day: 27, label: "D\u00eda del Odont\u00f3logo" }
];

function defaultConfig() {
    return {};
}

function normalizeConfig(config = {}) {
    const base = defaultConfig();
    const tecnico = ESTAMENTO[1];
    const legacyTecnico =
        config["TÃ©cnico"] ||
        config.Tecnico ||
        {};

    return {
        ...base,
        ...config,
        [tecnico]: {
            ...base[tecnico],
            ...(config[tecnico] || legacyTecnico)
        }
    };
}

function configSummary(config) {
    return Object.entries(normalizeConfig(config))
        .map(([estamento, values]) =>
            `${estamento}: H${values.habil}/I${values.inhabil}/N${values.noche}`
        )
        .join("; ");
}

export function getStaffingConfig() {
    return normalizeStaffingConfig(getJSON(KEY, {}));
}

export function saveStaffingConfig(cfg) {
    setJSON(KEY, normalizeStaffingConfig(cfg));
}

function renderStaffingConfigSummary(cfg) {
    const summary = document.getElementById("staffingConfigSummary");
    if (!summary) return;

    summary.innerHTML = ESTAMENTO.map(est => `
        <article class="staffing-config-card">
            <strong>${est}</strong>
            <span>Habil: ${cfg[est].habil}</span>
            <span>Inhabil: ${cfg[est].inhabil}</span>
            <span>Noche: ${cfg[est].noche}</span>
        </article>
    `).join("");
}

function trabajaDia(turno) {
    return [1, 3, 4, 5].includes(turno);
}

function trabajaNoche(turno) {
    return [2, 3, 5].includes(turno);
}

const STAFFING_ESTAMENTOS = [
    "Profesional",
    "Técnico",
    "Administrativo",
    "Auxiliar"
];
const PROFESSION_BASED_ESTAMENTOS = new Set([
    "Profesional",
    "Técnico"
]);
const STAFFING_MODALITIES = [
    {
        key: "diurno",
        label: "Turno Diurno",
        dayLabel: "Diurno",
        checksNight: false
    },
    {
        key: "4turno",
        label: "4° Turno",
        dayLabel: "Larga",
        nightLabel: "Noche",
        checksNight: true
    },
    {
        key: "3turno",
        label: "3er Turno",
        dayLabel: "Larga",
        nightLabel: "Noche",
        checksNight: true
    }
];

function emptyStaffingConfig() {
    return STAFFING_MODALITIES.reduce((config, modality) => {
        config[modality.key] = {};
        STAFFING_ESTAMENTOS.forEach(estamento => {
            config[modality.key][estamento] = {};
        });
        return config;
    }, {});
}

function normalizeStaffingEstamento(value) {
    const clean = String(value || "").trim();

    const comparable = normalizeText(value);

    if (comparable === "tecnico") return "Técnico";

    return STAFFING_ESTAMENTOS.find(estamento =>
        normalizeText(estamento) === comparable
    ) || clean;
}

function isProfessionBasedStaffing(estamento) {
    return PROFESSION_BASED_ESTAMENTOS.has(
        normalizeStaffingEstamento(estamento)
    );
}

function professionEstamento(estamento) {
    const normalized = normalizeStaffingEstamento(estamento);
    const source = String(normalized || estamento || "")
        .toLowerCase();

    if (source.includes("cnico")) return "T\u00e9cnico";
    if (normalized === "Administrativo") return "Administrativo";
    if (normalized === "Auxiliar") return "Auxiliar";

    return "Profesional";
}

function normalizeStaffingProfession(value, estamento = "Profesional") {
    const clean = String(value || "").trim();

    return normalizeProfession(
        clean || "Sin informacion",
        professionEstamento(estamento)
    );
}

function normalizeStaffingRotativa(type) {
    const value = String(type || "")
        .trim()
        .toLowerCase();

    if (value === "4° turno" || value === "4 turno") return "4turno";
    if (value === "3er turno" || value === "3 turno") return "3turno";
    if (value === "diurno") return "diurno";

    return value;
}

function isStaffingModality(type) {
    return STAFFING_MODALITIES.some(modality =>
        modality.key === normalizeStaffingRotativa(type)
    );
}

function sanitizeStaffingAmount(value) {
    const number = Number(value);

    return Number.isFinite(number) && number > 0
        ? Math.round(number)
        : 0;
}

function normalizeStaffingConfig(config = {}) {
    const normalized = emptyStaffingConfig();

    STAFFING_MODALITIES.forEach(modality => {
        const modalityValues = config?.[modality.key] || {};

        STAFFING_ESTAMENTOS.forEach(estamento => {
            const values = modalityValues[estamento] || {};

            Object.entries(values).forEach(([group, value]) => {
                const groupKey = isProfessionBasedStaffing(estamento)
                    ? normalizeStaffingProfession(group, estamento)
                    : "total";
                const amount = sanitizeStaffingAmount(value);

                if (amount > 0) {
                    normalized[modality.key][estamento][groupKey] =
                        amount;
                }
            });
        });
    });

    return normalized;
}

function getStaffingProfileModality(profile, keyDay = "") {
    const replacedProfileName =
        keyDay && isReplacementProfile(profile.name)
            ? getReplacedProfileForDate(profile.name, keyDay)
            : "";
    const inheritedRotativa =
        replacedProfileName
            ? getRotativa(replacedProfileName)?.type
            : "";

    return normalizeStaffingRotativa(
        getRotativa(profile.name)?.type ||
        inheritedRotativa ||
        profile.rotativaActual ||
        profile.rotation
    );
}

function getStaffingProfileGroupKey(profile) {
    const estamento = normalizeStaffingEstamento(profile.estamento);

    return isProfessionBasedStaffing(estamento)
        ? normalizeStaffingProfession(profile.profession, estamento)
        : "total";
}

function getStaffingGroupLabel(estamento, groupKey) {
    return isProfessionBasedStaffing(estamento)
        ? normalizeStaffingProfession(groupKey, estamento)
        : estamento;
}

function profileMatchesStaffingGroup(profile, {
    modality,
    estamento,
    groupKey
}) {
    const profileEstamento =
        normalizeStaffingEstamento(profile.estamento);

    if (profileEstamento !== estamento) return false;
    if (getStaffingProfileModality(profile) !== modality) return false;

    return isProfessionBasedStaffing(estamento)
        ? getStaffingProfileGroupKey(profile) === groupKey
        : true;
}

function ensureStaffingConfigBucket(config, modality, estamento) {
    if (!config[modality]) config[modality] = {};
    if (!config[modality][estamento]) {
        config[modality][estamento] = {};
    }
}

export function syncStaffingConfigForProfileChange(
    previousProfile = {},
    nextProfile = {}
) {
    const previousModality =
        normalizeStaffingRotativa(previousProfile.rotativa?.type);
    const nextModality =
        normalizeStaffingRotativa(nextProfile.rotativa?.type);
    const previousEstamento =
        normalizeStaffingEstamento(previousProfile.estamento);
    const nextEstamento =
        normalizeStaffingEstamento(nextProfile.estamento);

    if (
        !previousModality ||
        !nextModality ||
        !isStaffingModality(previousModality) ||
        !isStaffingModality(nextModality) ||
        !isProfessionBasedStaffing(previousEstamento) ||
        !isProfessionBasedStaffing(nextEstamento)
    ) {
        return false;
    }

    const previousGroup = normalizeStaffingProfession(
        previousProfile.profession,
        previousEstamento
    );
    const nextGroup = normalizeStaffingProfession(
        nextProfile.profession,
        nextEstamento
    );

    if (
        previousModality === nextModality &&
        previousEstamento === nextEstamento &&
        previousGroup === nextGroup
    ) {
        return false;
    }

    const config = getStaffingConfig();
    const previousAmount = Number(
        config[previousModality]?.[previousEstamento]?.[previousGroup]
    ) || 0;

    if (!previousAmount) return false;

    ensureStaffingConfigBucket(
        config,
        nextModality,
        nextEstamento
    );

    if (
        !Number(
            config[nextModality]?.[nextEstamento]?.[nextGroup]
        )
    ) {
        config[nextModality][nextEstamento][nextGroup] =
            previousAmount;
    }

    const stillHasPreviousGroup = getProfiles()
        .filter(isProfileActive)
        .some(profile =>
            profileMatchesStaffingGroup(profile, {
                modality: previousModality,
                estamento: previousEstamento,
                groupKey: previousGroup
            })
        );

    if (!stillHasPreviousGroup) {
        delete config[previousModality][previousEstamento][previousGroup];
    }

    saveStaffingConfig(config);

    return true;
}

export function getStaffingModalities() {
    return STAFFING_MODALITIES.map(modality => ({ ...modality }));
}

export function buildStaffingRequirementRows(
    config = getStaffingConfig()
) {
    const normalized = normalizeStaffingConfig(config);
    const profiles = getProfiles()
        .filter(isProfileActive)
        .filter(profile =>
            STAFFING_ESTAMENTOS.includes(
                normalizeStaffingEstamento(profile.estamento)
            )
        );
    const rows = [];

    STAFFING_MODALITIES.forEach(modality => {
        STAFFING_ESTAMENTOS.forEach(estamento => {
            const profilesForGroup = profiles.filter(profile =>
                normalizeStaffingEstamento(profile.estamento) === estamento &&
                getStaffingProfileModality(profile) === modality.key
            );

            if (!profilesForGroup.length) return;

            const groups = isProfessionBasedStaffing(estamento)
                ? [...new Set(
                    profilesForGroup.map(getStaffingProfileGroupKey)
                )].sort((a, b) => a.localeCompare(b, "es"))
                : ["total"];

            groups.forEach(groupKey => {
                rows.push({
                    modality: modality.key,
                    modalityLabel: modality.label,
                    sectionLabel: `${estamento} en ${modality.label}`,
                    estamento,
                    groupKey,
                    groupLabel:
                        getStaffingGroupLabel(estamento, groupKey),
                    required:
                        normalized[modality.key]?.[estamento]?.[groupKey] ||
                        0
                });
            });
        });
    });

    return rows;
}

export function staffingConfigSummary(config = getStaffingConfig()) {
    const rows = buildStaffingRequirementRows(config)
        .filter(row => row.required > 0);

    if (!rows.length) return "Sin dotacion requerida configurada.";

    return rows
        .map(row =>
            `${row.sectionLabel} / ${row.groupLabel}: ${row.required}`
        )
        .join("; ");
}

function worksStaffingDiurno(turno) {
    return turno === TURNO.DIURNO ||
        turno === TURNO.DIURNO_NOCHE;
}

function worksStaffingLong(turno) {
    return turno === TURNO.LARGA ||
        turno === TURNO.TURNO24;
}

function worksStaffingNight(turno) {
    return turno === TURNO.NOCHE ||
        turno === TURNO.TURNO24 ||
        turno === TURNO.DIURNO_NOCHE;
}

const STAFFING_SEGMENT = {
    DAY_MORNING: "day_morning",
    DAY_AFTERNOON: "day_afternoon",
    NIGHT: "night"
};

function addDaySegments(segments) {
    segments.add(STAFFING_SEGMENT.DAY_MORNING);
    segments.add(STAFFING_SEGMENT.DAY_AFTERNOON);
}

function turnSegmentsForStaffing(row, turno) {
    const state = Number(turno) || TURNO.LIBRE;
    const segments = new Set();

    if (
        state === TURNO.NOCHE ||
        state === TURNO.TURNO24 ||
        state === TURNO.DIURNO_NOCHE ||
        state === TURNO.TURNO18
    ) {
        segments.add(STAFFING_SEGMENT.NIGHT);
    }

    if (row.modality === "diurno") {
        if (
            state === TURNO.DIURNO ||
            state === TURNO.DIURNO_NOCHE
        ) {
            addDaySegments(segments);
        }
    } else if (
        state === TURNO.LARGA ||
        state === TURNO.TURNO24
    ) {
        addDaySegments(segments);
    }

    if (state === TURNO.MEDIA_MANANA) {
        segments.add(STAFFING_SEGMENT.DAY_MORNING);
    }

    if (
        state === TURNO.MEDIA_TARDE ||
        state === TURNO.TURNO18
    ) {
        segments.add(STAFFING_SEGMENT.DAY_AFTERNOON);
    }

    return segments;
}

function checkSegmentsForShift(shiftKind) {
    if (shiftKind === "night") {
        return [STAFFING_SEGMENT.NIGHT];
    }

    return [
        STAFFING_SEGMENT.DAY_MORNING,
        STAFFING_SEGMENT.DAY_AFTERNOON
    ];
}

function segmentLabel(segments) {
    const hasMorning =
        segments.includes(STAFFING_SEGMENT.DAY_MORNING);
    const hasAfternoon =
        segments.includes(STAFFING_SEGMENT.DAY_AFTERNOON);

    if (hasMorning && !hasAfternoon) return "manana";
    if (!hasMorning && hasAfternoon) return "tarde";

    return "";
}

function removeSegmentsByAbsence(absence, currentSegments) {
    const removed = new Set();

    if (!absence) return removed;

    if (absence.kind === "half_morning") {
        removed.add(STAFFING_SEGMENT.DAY_MORNING);
        return removed;
    }

    if (absence.kind === "half_afternoon") {
        removed.add(STAFFING_SEGMENT.DAY_AFTERNOON);
        return removed;
    }

    if (absence.kind === "half_unknown") {
        removed.add(STAFFING_SEGMENT.DAY_MORNING);
        removed.add(STAFFING_SEGMENT.DAY_AFTERNOON);
        return removed;
    }

    currentSegments.forEach(segment => removed.add(segment));

    return removed;
}

function key(y, m, d){
    return `${y}-${m}-${d}`;
}

function normalizeSearch(value) {
    return normalizeText(value);
}

const STAFFING_REMINDER_RECURRENCES = new Set([
    "once",
    "yearly",
    "monthly"
]);

const STAFFING_REMINDER_VISIBILITIES = new Set([
    "all",
    "private"
]);

const STAFFING_REMINDER_RECURRENCE_LABELS = {
    once: "Una sola vez",
    yearly: "Anual en la misma fecha",
    monthly: "Mensual"
};

const STAFFING_REMINDER_VISIBILITY_LABELS = {
    all: "Todos los usuarios",
    private: "Solo quien lo crea"
};

function reminderDateParts(value) {
    const match = String(value || "")
        .match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day);

    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month ||
        date.getDate() !== day
    ) {
        return null;
    }

    return { year, month, day };
}

function normalizeReminderDateISO(value) {
    const parts = reminderDateParts(value);

    if (!parts) return "";

    return [
        parts.year,
        String(parts.month + 1).padStart(2, "0"),
        String(parts.day).padStart(2, "0")
    ].join("-");
}

function currentReminderOwner() {
    const user = getCurrentFirebaseUser();
    const fallbackName =
        typeof document !== "undefined"
            ? document.getElementById("authUserName")?.textContent?.trim()
            : "";
    const uid = user?.uid || "";
    const email = user?.email || "";

    return {
        uid,
        email,
        name:
            user?.displayName ||
            email ||
            fallbackName ||
            "Usuario local",
        key: uid
            ? `uid:${uid}`
            : email
                ? `email:${email.toLowerCase()}`
                : "local_user"
    };
}

function normalizeStaffingReminder(reminder, index = 0) {
    const recurrence = STAFFING_REMINDER_RECURRENCES.has(
        reminder?.recurrence
    )
        ? reminder.recurrence
        : "once";
    const visibility = STAFFING_REMINDER_VISIBILITIES.has(
        reminder?.visibility
    )
        ? reminder.visibility
        : "all";
    const description = String(
        reminder?.description || reminder?.label || ""
    ).trim();
    const owner = currentReminderOwner();
    const createdByKey =
        String(reminder?.createdByKey || "").trim() ||
        (
            reminder?.createdByUid
                ? `uid:${reminder.createdByUid}`
                : (
                    reminder?.createdByEmail
                        ? `email:${String(reminder.createdByEmail).toLowerCase()}`
                        : owner.key
                )
        );

    return {
        id: String(
            reminder?.id ||
            `staffing_reminder_${Date.now()}_${index}`
        ),
        dateISO: normalizeReminderDateISO(
            reminder?.dateISO || reminder?.date || ""
        ),
        description,
        visibility,
        recurrence,
        createdByKey,
        createdByUid: String(reminder?.createdByUid || ""),
        createdByEmail: String(reminder?.createdByEmail || ""),
        createdByName: String(reminder?.createdByName || ""),
        createdAt: reminder?.createdAt || new Date().toISOString(),
        updatedAt: reminder?.updatedAt || reminder?.createdAt || ""
    };
}

function getStaffingCustomReminders() {
    const reminders = getJSON(REMINDERS_KEY, []);

    if (!Array.isArray(reminders)) return [];

    return reminders
        .map(normalizeStaffingReminder)
        .filter(reminder => reminder.dateISO && reminder.description);
}

function saveStaffingCustomReminders(reminders) {
    setJSON(
        REMINDERS_KEY,
        reminders
            .map(normalizeStaffingReminder)
            .filter(reminder => reminder.dateISO && reminder.description)
    );
}

function isStaffingReminderVisible(reminder) {
    if (reminder.visibility !== "private") return true;

    const owner = currentReminderOwner();

    if (reminder.createdByKey) {
        return reminder.createdByKey === owner.key;
    }

    if (reminder.createdByUid && owner.uid) {
        return reminder.createdByUid === owner.uid;
    }

    if (reminder.createdByEmail && owner.email) {
        return (
            reminder.createdByEmail.toLowerCase() ===
            owner.email.toLowerCase()
        );
    }

    return owner.key === "local_user";
}

function getVisibleStaffingCustomReminders() {
    return getStaffingCustomReminders()
        .filter(isStaffingReminderVisible);
}

function reportDateIsBeforeReminderStart(year, month, day, parts) {
    if (year !== parts.year) return year < parts.year;
    if (month !== parts.month) return month < parts.month;

    return day < parts.day;
}

function staffingReminderMatchesDate(reminder, year, month, day) {
    const parts = reminderDateParts(reminder.dateISO);

    if (!parts) return false;

    if (reportDateIsBeforeReminderStart(year, month, day, parts)) {
        return false;
    }

    if (reminder.recurrence === "monthly") {
        return parts.day === day;
    }

    if (reminder.recurrence === "yearly") {
        return parts.month === month && parts.day === day;
    }

    return (
        parts.year === year &&
        parts.month === month &&
        parts.day === day
    );
}

function addStaffingCustomReminder(data) {
    const owner = currentReminderOwner();
    const reminder = normalizeStaffingReminder({
        ...data,
        id: `staffing_reminder_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        createdByKey: owner.key,
        createdByUid: owner.uid,
        createdByEmail: owner.email,
        createdByName: owner.name,
        createdAt: new Date().toISOString()
    });
    const reminders = getStaffingCustomReminders();

    saveStaffingCustomReminders([...reminders, reminder]);

    addAuditLog(
        AUDIT_CATEGORY.STAFFING,
        "Agrega recordatorio",
        `${reminder.dateISO} | ${reminder.description}`
    );

    return reminder;
}

function staffingReminderDefaultDate() {
    const today = new Date();
    const year =
        lastInlineStaffingReport?.year ??
        currentDate.getFullYear();
    const month =
        lastInlineStaffingReport?.month ??
        currentDate.getMonth();
    const monthDays = new Date(year, month + 1, 0).getDate();
    const day = (
        today.getFullYear() === year &&
        today.getMonth() === month
    )
        ? Math.min(today.getDate(), monthDays)
        : 1;

    return [
        year,
        String(month + 1).padStart(2, "0"),
        String(day).padStart(2, "0")
    ].join("-");
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

async function readApplicantDocuments(files) {
    const docs = [];

    for (const file of Array.from(files || [])) {
        docs.push({
            name: file.name,
            type: file.type || "Archivo",
            size: file.size || 0,
            dataUrl: await readFileAsDataURL(file)
        });
    }

    return docs;
}

function dataUrlToBlob(dataUrl) {
    const [header, data] = String(dataUrl || "").split(",");
    const mimeMatch = header.match(/data:([^;]+);base64/);
    const mime = mimeMatch?.[1] || "application/octet-stream";
    const binary = atob(data || "");
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type: mime });
}

function openApplicantDocument(doc) {
    if (!doc?.dataUrl) {
        alert("Este documento no tiene contenido disponible para visualizar.");
        return;
    }

    const url = URL.createObjectURL(dataUrlToBlob(doc.dataUrl));
    const opened = window.open(url, "_blank", "noopener");

    if (!opened) {
        alert("El navegador bloqueo la ventana emergente. Permite pop-ups para visualizar el documento.");
    }

    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function formatFileSize(size) {
    const bytes = Number(size) || 0;

    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 102.4) / 10} KB`;
    }

    return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

function firstName(name) {
    return String(name || "")
        .trim()
        .split(/\s+/)[0] || "colaborador";
}

function birthDateParts(value) {
    const source = String(value || "").trim();
    let match = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (match) {
        return {
            month: Number(match[2]) - 1,
            day: Number(match[3])
        };
    }

    match = source.match(/^(\d{2})-(\d{2})-(\d{4})$/);

    if (match) {
        return {
            month: Number(match[2]) - 1,
            day: Number(match[1])
        };
    }

    return null;
}

function birthdayDetailsForDay(month, day) {
    return getProfiles()
        .filter(isProfileActive)
        .filter(profile => {
            const parts = birthDateParts(profile.birthDate);

            return parts &&
                parts.month === month &&
                parts.day === day;
        })
        .map(profile => ({
            tipo: "birthday",
            name: firstName(profile.name)
        }));
}

function reminderDetailsForDay(
    year,
    month,
    day,
    customReminders = getVisibleStaffingCustomReminders()
) {
    const fixedReminders = STAFFING_DATE_REMINDERS
        .filter(reminder =>
            reminder.month === month &&
            reminder.day === day
        )
        .map(reminder => ({
            tipo: "reminder",
            label: reminder.label
        }));

    const userReminders = customReminders
        .filter(reminder =>
            staffingReminderMatchesDate(reminder, year, month, day)
        )
        .map(reminder => ({
            tipo: "reminder",
            label: reminder.description,
            custom: true,
            visibility: reminder.visibility,
            recurrence: reminder.recurrence
        }));

    return [
        ...fixedReminders,
        ...userReminders
    ];
}

function withBirthdayDetails(data, year, month) {
    const customReminders = getVisibleStaffingCustomReminders();

    return data.map(item => ({
        ...item,
        detalle: [
            ...item.detalle,
            ...birthdayDetailsForDay(month, item.dia),
            ...reminderDetailsForDay(
                year,
                month,
                item.dia,
                customReminders
            )
        ]
    }));
}

function formatMonth(year, month) {
    return new Date(year, month, 1)
        .toLocaleString("es-CL", {
            month: "short",
            year: "2-digit"
        })
        .replace(".", "");
}

function formatFullWeekday(date) {
    return date
        .toLocaleDateString("es-CL", { weekday: "long" });
}

function formatShortDate(date) {
    return date.toLocaleDateString("es-CL", {
        day: "2-digit",
        month: "2-digit"
    });
}

function isMedicalType(type) {
    return (
        type === "license" ||
        type === "union_leave" ||
        type === "professional_license"
    );
}

function getAbsencesPerfil(nombre) {
    return getJSON("absences_" + nombre, {});
}

function medicalSeriesTemplate() {
    const end = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
    );
    const start = new Date(
        end.getFullYear(),
        end.getMonth() - 23,
        1
    );
    const months = [];

    for (let i = 0; i < 24; i++) {
        const date = new Date(
            start.getFullYear(),
            start.getMonth() + i,
            1
        );

        months.push({
            year: date.getFullYear(),
            month: date.getMonth(),
            label: formatMonth(
                date.getFullYear(),
                date.getMonth()
            ),
            license: 0,
            professional: 0
        });
    }

    return months;
}

function countMedicalAbsences(nombre) {
    const months = medicalSeriesTemplate();
    const index = new Map(
        months.map((item, position) => [
            `${item.year}-${item.month}`,
            position
        ])
    );

    Object.entries(getAbsencesPerfil(nombre))
        .forEach(([keyDay, absence]) => {
            const type = getAbsenceType(absence);

            if (!isMedicalType(type)) return;

            const parsed = parseKey(keyDay);
            const position =
                index.get(`${parsed.year}-${parsed.month}`);

            if (position === undefined) return;

            if (type === "professional_license") {
                months[position].professional++;
            } else {
                months[position].license++;
            }
        });

    return months;
}

function mode(values) {
    if (!values.length) return 0;

    const counts = new Map();

    values.forEach(value => {
        counts.set(value, (counts.get(value) || 0) + 1);
    });

    return [...counts.entries()]
        .sort((a, b) =>
            b[1] - a[1] ||
            b[0] - a[0]
        )[0][0];
}

function formatDecimal(value) {
    const rounded =
        Math.round((Number(value) || 0) * 10) / 10;

    if (Number.isInteger(rounded)) return String(rounded);

    return String(rounded).replace(".", ",");
}

export function renderStaffingMedicalChart() {
    const target = document.getElementById("staffingMedicalChart");
    if (!target) return;

    const selectedName = getCurrentProfile();
    const selectedProfile = getProfiles().find(profile =>
        profile.name === selectedName
    );

    if (!selectedProfile) {
        target.innerHTML = `
            <section class="medical-chart-card">
                <div class="empty-state empty-state--compact">
                    Selecciona un trabajador para comparar licencias.
                </div>
            </section>
        `;
        return;
    }

    const peers = getProfiles()
        .filter(isProfileActive)
        .filter(profile =>
            profile.name !== selectedProfile.name &&
            profile.estamento === selectedProfile.estamento
        );
    const selectedSeries =
        countMedicalAbsences(selectedProfile.name);
    const peerSeries =
        peers.map(profile => countMedicalAbsences(profile.name));

    const chartRows = selectedSeries.map((item, index) => {
        const peerTotals = peerSeries.map(series =>
            (series[index]?.license || 0) +
            (series[index]?.professional || 0)
        );
        const average = peerTotals.length
            ? peerTotals.reduce((sum, value) => sum + value, 0) /
                peerTotals.length
            : 0;

        return {
            ...item,
            total: item.license + item.professional,
            peerAverage: average,
            peerMode: mode(peerTotals)
        };
    });
    const maxValue = Math.max(
        1,
        ...chartRows.map(row =>
            Math.max(row.total, row.peerAverage, row.peerMode)
        )
    );
    const selectedTotals = chartRows.reduce(
        (total, row) => ({
            license: total.license + row.license,
            professional:
                total.professional + row.professional
        }),
        { license: 0, professional: 0 }
    );
    const peerPeriodTotals = peers.map((_profile, peerIndex) =>
        peerSeries[peerIndex].reduce(
            (sum, row) =>
                sum + row.license + row.professional,
            0
        )
    );
    const peerPeriodAverage = peerPeriodTotals.length
        ? peerPeriodTotals.reduce((sum, value) => sum + value, 0) /
            peerPeriodTotals.length
        : 0;
    const peerPeriodMode = mode(peerPeriodTotals);
    const latestLabel =
        chartRows[chartRows.length - 1]?.label || "";
    const firstLabel = chartRows[0]?.label || "";

    target.innerHTML = `
        <section class="medical-chart-card">
            <div class="medical-chart-head">
                <div>
                    <h4>Licencias \u00faltimos 2 a\u00f1os</h4>
                    <p>
                        ${selectedProfile.name} vs ${peers.length} trabajador(es)
                        ${selectedProfile.estamento} | ${firstLabel} - ${latestLabel}
                    </p>
                </div>

                <div class="medical-chart-summary">
                    <span>LM: <strong>${selectedTotals.license}</strong></span>
                    <span>LMP: <strong>${selectedTotals.professional}</strong></span>
                    <span>Prom. pares: <strong>${formatDecimal(peerPeriodAverage)}</strong></span>
                    <span>Moda pares: <strong>${formatDecimal(peerPeriodMode)}</strong></span>
                </div>
            </div>

            <div class="medical-chart-legend">
                <span><i class="medical-color-license"></i> LM perfil</span>
                <span><i class="medical-color-professional"></i> LMP perfil</span>
                <span><i class="medical-line-average"></i> Promedio pares</span>
                <span><i class="medical-line-mode"></i> Moda pares</span>
            </div>

            <div class="medical-chart-bars">
                ${chartRows.map(row => {
                    const licenseHeight = row.license
                        ? (row.license / maxValue) * 100
                        : 0;
                    const professionalHeight = row.professional
                        ? (row.professional / maxValue) * 100
                        : 0;
                    const averageBottom =
                        (row.peerAverage / maxValue) * 100;
                    const modeBottom =
                        (row.peerMode / maxValue) * 100;

                    return `
                        <div class="medical-chart-month" title="${row.label}: LM ${row.license}, LMP ${row.professional}, promedio pares ${formatDecimal(row.peerAverage)}, moda pares ${formatDecimal(row.peerMode)}">
                            <div class="medical-chart-bar">
                                <span class="medical-ref medical-ref--average" style="bottom:${averageBottom}%"></span>
                                <span class="medical-ref medical-ref--mode" style="bottom:${modeBottom}%"></span>
                                <span class="medical-stack medical-stack--professional" style="height:${professionalHeight}%"></span>
                                <span class="medical-stack medical-stack--license" style="height:${licenseHeight}%"></span>
                            </div>
                            <small>${row.label}</small>
                        </div>
                    `;
                }).join("")}
            </div>
        </section>
    `;
}

function getApplicants() {
    return getJSON(APPLICANTS_KEY, [])
        .map(applicant => ({
            id: applicant.id || `app_${Date.now()}`,
            name: String(applicant.name || "").trim(),
            phone: String(applicant.phone || "").trim(),
            receivedDate: applicant.receivedDate || "",
            estamento: normalizeStaffingEstamento(
                applicant.estamento || "Profesional"
            ),
            profession: normalizeProfession(
                applicant.profession,
                applicant.estamento || "Profesional"
            ),
            institution: String(applicant.institution || "").trim(),
            graduationYear:
                String(applicant.graduationYear || "").trim(),
            experience: String(applicant.experience || "").trim(),
            interviewImpressions:
                String(applicant.interviewImpressions || "").trim(),
            documents: Array.isArray(applicant.documents)
                ? applicant.documents
                : [],
            createdAt: applicant.createdAt || new Date().toISOString()
        }))
        .sort((a, b) =>
            String(b.receivedDate || "").localeCompare(
                String(a.receivedDate || "")
            ) ||
            a.name.localeCompare(b.name, "es")
        );
}

function saveApplicants(applicants) {
    setJSON(APPLICANTS_KEY, applicants);
}

function applicantRoleOptions(selected = "") {
    return ["Profesional", "T\u00e9cnico", "Administrativo", "Auxiliar"]
        .map(estamento => `
            <option value="${escapeHTML(estamento)}" ${normalizeStaffingEstamento(selected) === normalizeStaffingEstamento(estamento) ? "selected" : ""}>
                ${escapeHTML(estamento)}
            </option>
        `)
        .join("");
}

function formatEstamentoLabel(value) {
    const normalized = normalizeSearch(value);

    if (normalized.includes("cnico")) return "T\u00e9cnico";
    if (normalized.includes("administrativo")) return "Administrativo";
    if (normalized.includes("auxiliar")) return "Auxiliar";

    return "Profesional";
}

function applicantProfessionOptions(estamento = "Profesional") {
    return getProfessionOptionsForEstamento(estamento)
        .filter(value => value !== "Sin informacion")
        .map(value => `
            <option value="${escapeHTML(value)}"></option>
        `)
        .join("");
}

function applicantFilterProfessionOptions(applicants, selected) {
    const professions = [...new Set(
        applicants
            .map(applicant => applicant.profession)
            .filter(Boolean)
            .filter(value => value !== "Sin informacion")
    )].sort((a, b) => a.localeCompare(b, "es"));

    return `
        <option value="Todas">Todas</option>
        ${professions.map(profession => `
            <option value="${escapeHTML(profession)}" ${profession === selected ? "selected" : ""}>
                ${escapeHTML(profession)}
            </option>
        `).join("")}
    `;
}

function applicantMatchesFilters(applicant, roleFilter, professionFilter) {
    const roleMatches =
        roleFilter === "Todos" ||
        normalizeStaffingEstamento(applicant.estamento) ===
            normalizeStaffingEstamento(roleFilter);
    const professionMatches =
        professionFilter === "Todas" ||
        applicant.profession === professionFilter;

    return roleMatches && professionMatches;
}

function renderApplicantDocuments(applicant) {
    const docs = applicant.documents || [];

    if (!docs.length) {
        return `
            <div class="attachment-empty">
                Sin documentos adjuntos.
            </div>
        `;
    }

    return docs.map((doc, index) => `
        <div class="attachment-item">
            <span>
                <strong>${escapeHTML(doc.name || "Documento")}</strong>
                <small>
                    ${escapeHTML(doc.type || "Archivo")}
                    ${doc.size ? ` | ${escapeHTML(formatFileSize(doc.size))}` : ""}
                </small>
            </span>
            <span class="attachment-actions">
                <button class="secondary-button attachment-view" type="button" data-applicant-doc="${escapeHTML(applicant.id)}" data-doc-index="${index}" ${doc.dataUrl ? "" : "disabled"}>
                    Ver
                </button>
            </span>
        </div>
    `).join("");
}

function renderApplicantCard(applicant) {
    return `
        <article class="applicant-card" data-applicant-id="${escapeHTML(applicant.id)}">
            <div class="applicant-card__head">
                <div class="applicant-card__title">
                    <strong>${escapeHTML(applicant.name || "Sin nombre")}</strong>
                    <span>
                        ${escapeHTML(formatEstamentoLabel(applicant.estamento))}
                        ${applicant.profession && applicant.profession !== "Sin informacion" ? ` | ${escapeHTML(applicant.profession)}` : ""}
                    </span>
                </div>
                <button class="ghost-button" type="button" data-applicant-delete="${escapeHTML(applicant.id)}">
                    Eliminar
                </button>
            </div>

            <div class="applicant-card__meta">
                <span>Tel: <strong>${escapeHTML(applicant.phone || "Sin informacion")}</strong></span>
                <span>Recepcion: <strong>${escapeHTML(applicant.receivedDate || "Sin fecha")}</strong></span>
                <span>Egreso: <strong>${escapeHTML(applicant.graduationYear || "Sin informacion")}</strong></span>
                <span>Institucion: <strong>${escapeHTML(applicant.institution || "Sin informacion")}</strong></span>
            </div>

            <div class="applicant-card__notes">
                <div>
                    <small>Experiencia Laboral</small>
                    <p>${escapeHTML(applicant.experience || "Sin informacion")}</p>
                </div>
                <div>
                    <small>Impresiones de la Entrevista</small>
                    <p>${escapeHTML(applicant.interviewImpressions || "Sin informacion")}</p>
                </div>
            </div>

            <div class="applicant-documents">
                ${renderApplicantDocuments(applicant)}
            </div>
        </article>
    `;
}

function renderApplicantsPanel() {
    const target = document.getElementById("staffingApplicantsPanel");

    if (!target) return;

    const applicants = getApplicants();
    const roleFilter =
        document.getElementById("applicantFilterRole")?.value ||
        "Todos";
    const currentProfessionFilter =
        document.getElementById("applicantFilterProfession")?.value ||
        "Todas";
    const professions = new Set(
        applicants.map(applicant => applicant.profession)
    );
    const professionFilter = professions.has(currentProfessionFilter)
        ? currentProfessionFilter
        : "Todas";
    const visible = applicants.filter(applicant =>
        applicantMatchesFilters(
            applicant,
            roleFilter,
            professionFilter
        )
    );
    const today = new Date().toISOString().slice(0, 10);

    target.innerHTML = `
        <div class="section-head">
            <h3>Postulantes</h3>
        </div>

        <div class="applicant-toolbar">
            <label>
                <span>Filtrar estamento</span>
                <select id="applicantFilterRole">
                    <option value="Todos">Todos</option>
                    ${applicantRoleOptions(roleFilter)}
                </select>
            </label>

            <label>
                <span>Filtrar profesi\u00f3n</span>
                <select id="applicantFilterProfession">
                    ${applicantFilterProfessionOptions(applicants, professionFilter)}
                </select>
            </label>
        </div>

        <form id="applicantForm" class="applicant-form">
            <label>
                <span>Nombre</span>
                <input name="name" type="text" required>
            </label>
            <label>
                <span>Telefono</span>
                <input name="phone" type="tel">
            </label>
            <label>
                <span>Fecha de Recepci\u00f3n</span>
                <input name="receivedDate" type="date" value="${today}">
            </label>
            <label>
                <span>Estamento</span>
                <select name="estamento">
                    ${applicantRoleOptions("Profesional")}
                </select>
            </label>
            <label>
                <span>Profesi\u00f3n</span>
                <input name="profession" type="text" list="applicantProfessionOptions">
                <datalist id="applicantProfessionOptions">
                    ${applicantProfessionOptions("Profesional")}
                </datalist>
            </label>
            <label>
                <span>Universidad/Instituto</span>
                <input name="institution" type="text">
            </label>
            <label>
                <span>A\u00f1o de egreso</span>
                <input name="graduationYear" type="number" min="1950" max="2100">
            </label>
            <label>
                <span>Documentos</span>
                <input name="documents" type="file" multiple>
            </label>
            <label>
                <span>Experiencia Laboral</span>
                <textarea name="experience"></textarea>
            </label>
            <label>
                <span>Impresiones de la Entrevista</span>
                <textarea name="interviewImpressions"></textarea>
            </label>
            <div class="applicant-form-actions">
                <button class="primary-button" type="submit">
                    Guardar postulante
                </button>
            </div>
        </form>

        <div class="applicant-list">
            ${visible.length
                ? visible.map(renderApplicantCard).join("")
                : `
                    <div class="attachment-empty">
                        ${applicants.length ? "No hay postulantes para los filtros seleccionados." : "Sin postulantes registrados."}
                    </div>
                `}
        </div>
    `;

    bindApplicantsPanel(target);
}

function bindApplicantsPanel(target) {
    const form = target.querySelector("#applicantForm");
    const roleFilter = target.querySelector("#applicantFilterRole");
    const professionFilter =
        target.querySelector("#applicantFilterProfession");
    const roleInput = form?.elements.estamento;
    const professionOptions =
        target.querySelector("#applicantProfessionOptions");

    if (roleFilter) {
        roleFilter.onchange = renderApplicantsPanel;
    }

    if (professionFilter) {
        professionFilter.onchange = renderApplicantsPanel;
    }

    if (roleInput && professionOptions) {
        roleInput.onchange = () => {
            professionOptions.innerHTML =
                applicantProfessionOptions(roleInput.value);
        };
    }

    if (form) {
        form.onsubmit = async event => {
            event.preventDefault();

            const formData = new FormData(form);
            const estamento = normalizeStaffingEstamento(
                formData.get("estamento")
            );
            const name = String(formData.get("name") || "").trim();

            if (!name) {
                alert("Debes indicar el nombre del postulante.");
                return;
            }

            const submitButton = form.querySelector("[type='submit']");

            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = "Guardando...";
            }

            try {
                const documents = await readApplicantDocuments(
                    form.elements.documents?.files
                );
                const applicants = getApplicants();
                const record = {
                    id: `app_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    name,
                    phone: String(formData.get("phone") || "").trim(),
                    receivedDate:
                        String(formData.get("receivedDate") || "").trim(),
                    estamento,
                    profession: normalizeProfession(
                        formData.get("profession"),
                        estamento
                    ),
                    institution:
                        String(formData.get("institution") || "").trim(),
                    graduationYear:
                        String(formData.get("graduationYear") || "").trim(),
                    experience:
                        String(formData.get("experience") || "").trim(),
                    interviewImpressions:
                        String(formData.get("interviewImpressions") || "").trim(),
                    documents,
                    createdAt: new Date().toISOString()
                };

                saveApplicants([record, ...applicants]);
                addAuditLog(
                    AUDIT_CATEGORY.STAFFING,
                    "Agrego postulante",
                    `${record.name}: ${formatEstamentoLabel(record.estamento)} | ${record.profession}.`,
                    { applicantId: record.id }
                );
                renderApplicantsPanel();
            } catch (error) {
                console.error(error);
                alert("No se pudieron guardar los documentos del postulante.");
            }
        };
    }

    target
        .querySelectorAll("[data-applicant-delete]")
        .forEach(button => {
            button.onclick = () => {
                const id = button.dataset.applicantDelete;
                const applicants = getApplicants();
                const applicant = applicants.find(item =>
                    item.id === id
                );

                if (
                    !applicant ||
                    !confirm(`Eliminar postulante ${applicant.name}?`)
                ) {
                    return;
                }

                saveApplicants(applicants.filter(item => item.id !== id));
                addAuditLog(
                    AUDIT_CATEGORY.STAFFING,
                    "Elimino postulante",
                    `${applicant.name}: registro eliminado.`,
                    { applicantId: applicant.id }
                );
                renderApplicantsPanel();
            };
        });

    target
        .querySelectorAll("[data-applicant-doc]")
        .forEach(button => {
            button.onclick = () => {
                const applicant = getApplicants().find(item =>
                    item.id === button.dataset.applicantDoc
                );
                const doc =
                    applicant?.documents?.[Number(button.dataset.docIndex)];

                openApplicantDocument(doc);
            };
        });
}

function renderStaffingProfiles() {
    const target = document.getElementById("staffingProfiles");

    if (!target) return;

    const profiles = getProfiles();
    const showInactive =
        document.getElementById("staffingShowInactiveProfiles")?.checked ??
        false;
    const roleFilter =
        document.getElementById("staffingFilterRole")?.value ||
        "Todos";
    const query = normalizeSearch(
        document.getElementById("staffingProfileSearch")?.value || ""
    );
    const current = getCurrentProfile();
    const visible = profiles.filter(profile => {
        const activeMatches =
            showInactive || isProfileActive(profile);
        const roleMatches =
            roleFilter === "Todos" ||
            normalizeStaffingEstamento(profile.estamento) ===
                normalizeStaffingEstamento(roleFilter);
        const haystack = normalizeSearch([
            profile.name,
            profile.estamento,
            profile.profession,
            profile.email,
            profile.rut
        ].join(" "));

        return activeMatches &&
            roleMatches &&
            (!query || haystack.includes(query));
    });
    const empty = document.getElementById("staffingEmptyProfiles");

    target.innerHTML = "";

    if (empty) {
        empty.classList.toggle("hidden", Boolean(visible.length));
        empty.textContent = profiles.length
            ? "No hay resultados con ese filtro."
            : "Aun no hay colaboradores creados.";
    }

    visible.forEach(profile => {
        const item = document.createElement("div");
        item.className = "profile-item";

        if (!isProfileActive(profile)) {
            item.classList.add("is-inactive");
        }

        if (profile.name === current) {
            item.classList.add("active");
        }

        const avatar = document.createElement("div");
        avatar.className = "profile-item__avatar";
        avatar.textContent =
            profile.name.trim().charAt(0).toUpperCase() || "T";

        const content = document.createElement("div");
        content.className = "profile-item__content";

        const name = document.createElement("strong");
        name.textContent = profile.name;

        const meta = document.createElement("span");
        meta.textContent = [
            formatEstamentoLabel(profile.estamento),
            profile.profession && profile.profession !== "Sin informacion"
                ? profile.profession
                : ""
        ]
            .filter(Boolean)
            .join(" | ");

        content.append(name, meta);
        item.append(avatar, content);

        item.onclick = () => {
            if (typeof window.selectProfileByName === "function") {
                window.selectProfileByName(profile.name);
            }

            renderStaffingProfiles();
            renderStaffingMedicalChart();
        };

        target.appendChild(item);
    });
}

function bindStaffingView() {
    if (staffingViewBound) return;

    staffingViewBound = true;

    const search = document.getElementById("staffingProfileSearch");
    const role = document.getElementById("staffingFilterRole");
    const showInactive =
        document.getElementById("staffingShowInactiveProfiles");

    if (search) {
        search.oninput = renderStaffingProfiles;
    }

    if (role) {
        role.onchange = renderStaffingProfiles;
    }

    if (showInactive) {
        showInactive.onchange = renderStaffingProfiles;
    }
}

function getDataPerfil(nombre){
    return getJSON("data_" + nombre, {});
}

function absenceCacheKey(profileName, keyDay) {
    return `${profileName}::${keyDay}`;
}

function absenceLabelFromType(type) {
    if (type === "professional_license") return "LM Profesional";
    if (type === "union_leave") return "Permiso Gremial";
    if (type === "unpaid_leave") return "Permiso sin Goce";
    if (type === "license") return "Licencia M\u00e9dica";
    if (type === "unjustified_absence") {
        return "Ausencia injustificada";
    }

    return type ? "Ausencia" : "";
}

function getProfileStaffingAbsence(profileName, keyDay, cache) {
    const cacheKey = absenceCacheKey(profileName, keyDay);

    if (cache?.has(cacheKey)) {
        return cache.get(cacheKey);
    }

    const admin = getJSON(`admin_${profileName}`, {});
    const legal = getJSON(`legal_${profileName}`, {});
    const comp = getJSON(`comp_${profileName}`, {});
    const absences = getJSON(`absences_${profileName}`, {});
    let absence = null;

    if (admin[keyDay] === 1) {
        absence = {
            code: "admin",
            kind: "full",
            label: "P. Administrativo"
        };
    } else if (admin[keyDay] === "0.5M") {
        absence = {
            code: "half_morning",
            kind: "half_morning",
            label: "1/2 ADM Ma\u00f1ana"
        };
    } else if (admin[keyDay] === "0.5T") {
        absence = {
            code: "half_afternoon",
            kind: "half_afternoon",
            label: "1/2 ADM Tarde"
        };
    } else if (admin[keyDay] === 0.5) {
        absence = {
            code: "half_unknown",
            kind: "half_unknown",
            label: "1/2 ADM"
        };
    } else if (legal[keyDay]) {
        absence = {
            code: "legal",
            kind: "full",
            label: "F. Legal"
        };
    } else if (comp[keyDay]) {
        absence = {
            code: "comp",
            kind: "full",
            label: "F. Compensatorio"
        };
    } else if (absences[keyDay]) {
        const type = getAbsenceType(absences[keyDay]);

        absence = {
            code: type,
            kind: "full",
            label: absenceLabelFromType(type)
        };
    }

    if (cache) {
        cache.set(cacheKey, absence);
    }

    return absence;
}

function replacementCodeToTurno(code) {
    if (code === "L") return TURNO.LARGA;
    if (code === "N") return TURNO.NOCHE;
    if (code === "24") return TURNO.TURNO24;
    if (code === "D") return TURNO.DIURNO;
    if (code === "D+N") return TURNO.DIURNO_NOCHE;
    if (code === "HM") return TURNO.MEDIA_MANANA;
    if (code === "HT") return TURNO.MEDIA_TARDE;
    if (code === "18") return TURNO.TURNO18;

    return TURNO.LIBRE;
}

function replacementAddsStaffingCoverage(replacement) {
    return Boolean(replacement) &&
        !replacement.canceled &&
        replacement.addsShift !== false &&
        replacement.source !== "clock_extra" &&
        Boolean(replacement.replaced);
}

function staffingGroupMatches(profile, row, keyDay = "") {
    const estamento = normalizeStaffingEstamento(profile.estamento);

    if (estamento !== row.estamento) return false;
    if (getStaffingProfileModality(profile, keyDay) !== row.modality) {
        return false;
    }

    return isProfessionBasedStaffing(estamento)
        ? getStaffingProfileGroupKey(profile) === row.groupKey
        : true;
}

function replacementTargetsStaffingRow(replacement, row) {
    const target = getProfiles().find(profile =>
        profile.name === replacement.replaced
    );

    return target
        ? profileMatchesStaffingGroup(target, row)
        : false;
}

function getReplacementSegmentsForStaffingRow(
    profile,
    row,
    keyDay
) {
    const iso = isoFromKey(keyDay);
    const segments = new Set();

    getReplacements()
        .filter(replacement =>
            replacementAddsStaffingCoverage(replacement) &&
            replacement.worker === profile.name &&
            replacement.date === iso &&
            replacementTargetsStaffingRow(replacement, row)
        )
        .forEach(replacement => {
            turnSegmentsForStaffing(
                row,
                replacementCodeToTurno(replacement.turno)
            ).forEach(segment => segments.add(segment));
        });

    return segments;
}

function getStaffingTurno(profile, y, m, d, options = {}) {
    const dayKey = key(y, m, d);

    return aplicarCambiosTurno(
        profile.name,
        dayKey,
        getTurnoProgramado(profile.name, dayKey),
        options
    );
}

function getProfileStaffingCoverage(
    profile,
    row,
    y,
    m,
    d,
    absenceCache
) {
    const dayKey = key(y, m, d);
    const beforeSegments = new Set();
    const ownCoverage =
        staffingGroupMatches(profile, row, dayKey);

    if (ownCoverage) {
        turnSegmentsForStaffing(
            row,
            getStaffingTurno(profile, y, m, d)
        ).forEach(segment => beforeSegments.add(segment));
    }

    getReplacementSegmentsForStaffingRow(
        profile,
        row,
        dayKey
    ).forEach(segment => beforeSegments.add(segment));

    const absence = getProfileStaffingAbsence(
        profile.name,
        dayKey,
        absenceCache
    );
    const removedSegments =
        removeSegmentsByAbsence(absence, beforeSegments);
    const activeSegments = new Set(
        [...beforeSegments].filter(segment =>
            !removedSegments.has(segment)
        )
    );

    return {
        activeSegments,
        beforeSegments,
        removedSegments,
        absence
    };
}

function weekStartMonday(date) {
    const base = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );
    const day = base.getDay();
    const offset = day === 0 ? -6 : 1 - day;

    base.setDate(base.getDate() + offset);
    return base;
}

function staffingWeekDays(date = currentDate) {
    const start = weekStartMonday(date);

    return Array.from({ length: 7 }, (_, index) => {
        const day = new Date(start);
        day.setDate(start.getDate() + index);
        return day;
    });
}

function getStaffingWeekDate() {
    if (!staffingWeekDate) {
        staffingWeekDate = new Date(
            currentDate.getFullYear(),
            currentDate.getMonth(),
            currentDate.getDate()
        );
    }

    return staffingWeekDate;
}

function changeStaffingWeek(offset) {
    const next = new Date(getStaffingWeekDate());
    next.setDate(next.getDate() + offset * 7);
    staffingWeekDate = next;
    renderStaffingWeeklyCalendar();
}

function profileWeeklyShiftContext(
    profile,
    date,
    absenceCache,
    options = {}
) {
    const y = date.getFullYear();
    const m = date.getMonth();
    const d = date.getDate();
    const dayKey = key(y, m, d);
    const modality = getStaffingProfileModality(profile, dayKey);
    const isDiurno = modality === "diurno";
    const turno = getStaffingTurno(profile, y, m, d, options);
    const displaysAsLong =
        isDiurno &&
        worksStaffingLong(turno);
    const row = {
        modality:
            isDiurno && !displaysAsLong
                ? "diurno"
                : "4turno"
    };
    const beforeSegments = turnSegmentsForStaffing(row, turno);
    const absence = getProfileStaffingAbsence(
        profile.name,
        dayKey,
        absenceCache
    );
    const removedSegments =
        removeSegmentsByAbsence(absence, beforeSegments);
    const activeSegments = new Set(
        [...beforeSegments].filter(segment =>
            !removedSegments.has(segment)
        )
    );

    return {
        dayKey,
        isDiurno,
        displaysAsLong,
        turno,
        activeSegments,
        beforeSegments,
        removedSegments,
        absence
    };
}

function weeklySegmentsForShift(shiftKey, context, segments) {
    const source = [...segments];

    if (shiftKey === "diurno") {
        if (!context.isDiurno || context.displaysAsLong) return [];
        return source.filter(segment =>
            segment === STAFFING_SEGMENT.DAY_MORNING ||
            segment === STAFFING_SEGMENT.DAY_AFTERNOON
        );
    }

    if (shiftKey === "larga") {
        if (context.isDiurno && !context.displaysAsLong) return [];
        return source.filter(segment =>
            segment === STAFFING_SEGMENT.DAY_MORNING ||
            segment === STAFFING_SEGMENT.DAY_AFTERNOON
        );
    }

    if (
        shiftKey === "noche" &&
        source.includes(STAFFING_SEGMENT.NIGHT)
    ) {
        return [STAFFING_SEGMENT.NIGHT];
    }

    return [];
}

function profileWeeklyShiftSegments(profile, date, shiftKey, absenceCache) {
    const context = profileWeeklyShiftContext(
        profile,
        date,
        absenceCache
    );

    return weeklySegmentsForShift(
        shiftKey,
        context,
        context.activeSegments
    );
}

function weeklyProfileMeta(profile) {
    const group = getStaffingProfileGroupKey(profile);
    const estamento = normalizeStaffingEstamento(profile.estamento);
    const groupLabel = getStaffingGroupLabel(estamento, group);
    const profession = weeklyProfileProfession(profile);

    if (isProfessionBasedStaffing(estamento)) return groupLabel;
    if (profession === "Sin informacion") return estamento;

    return `${estamento} | ${profession}`;
}

function weeklyProfileProfession(profile) {
    return normalizeStaffingProfession(
        profile.profession,
        normalizeStaffingEstamento(profile.estamento)
    );
}

function weeklyProfileMatchesFilters(
    profile,
    roleFilter = "Todos",
    professionFilter = "Todas"
) {
    const profileEstamento =
        normalizeStaffingEstamento(profile.estamento);
    const roleMatches =
        roleFilter === "Todos" ||
        profileEstamento === normalizeStaffingEstamento(roleFilter);
    const professionMatches =
        professionFilter === "Todas" ||
        weeklyProfileProfession(profile) === professionFilter;

    return roleMatches && professionMatches;
}

function weeklyAvailableProfessions(roleFilter) {
    return [...new Set(
        getProfiles()
            .filter(isProfileActive)
            .filter(profile =>
                weeklyProfileMatchesFilters(profile, roleFilter)
            )
            .map(weeklyProfileProfession)
    )].sort((a, b) => a.localeCompare(b, "es"));
}

function weeklyProfileNeedsReplacement(profile, keyDay, turno) {
    const maps = {
        admin: getJSON(`admin_${profile.name}`, {}),
        legal: getJSON(`legal_${profile.name}`, {}),
        comp: getJSON(`comp_${profile.name}`, {}),
        absences: getJSON(`absences_${profile.name}`, {})
    };

    return requiereReemplazoTurnoBase(
        keyDay,
        turno,
        maps.admin,
        maps.legal,
        maps.comp,
        maps.absences
    ) &&
        !getReplacementForCoveredShift(profile.name, keyDay);
}

function profileWeeklyPendingReplacementSlot(
    profile,
    date,
    shiftKey,
    absenceCache
) {
    const context = profileWeeklyShiftContext(
        profile,
        date,
        absenceCache,
        { includeReplacements: false }
    );
    const segments = weeklySegmentsForShift(
        shiftKey,
        context,
        context.removedSegments
    );

    if (!segments.length) return null;
    if (
        !weeklyProfileNeedsReplacement(
            profile,
            context.dayKey,
            context.turno
        )
    ) {
        return null;
    }

    return {
        type: "replacement-slot",
        profile,
        keyDay: context.dayKey,
        segments,
        absence: context.absence
    };
}

function renderWeeklyRoleFilterOptions(selected) {
    return STAFFING_ESTAMENTOS.map(estamento => `
        <option value="${escapeHTML(estamento)}" ${normalizeStaffingEstamento(estamento) === normalizeStaffingEstamento(selected) ? "selected" : ""}>
            ${escapeHTML(estamento)}
        </option>
    `).join("");
}

function renderWeeklyProfessionFilterOptions(professions, selected) {
    return professions.map(profession => `
        <option value="${escapeHTML(profession)}" ${profession === selected ? "selected" : ""}>
            ${escapeHTML(profession)}
        </option>
    `).join("");
}

const WEEKLY_SHIFTS = [
    { key: "diurno", label: "Diurno" },
    { key: "larga", label: "Larga" },
    { key: "noche", label: "Noche" }
];

const WEEKLY_LEAVE_ROWS = [
    { key: "license", label: "Licencia M\u00e9dica" },
    { key: "professional_license", label: "LM Profesional" },
    { key: "union_leave", label: "Permiso Gremial" },
    { key: "admin", label: "P. Administrativo" },
    { key: "legal", label: "F. Legal" },
    { key: "comp", label: "F. Compensatorio" },
    { key: "half_morning", label: "1/2 ADM Ma\u00f1ana" },
    { key: "half_afternoon", label: "1/2 ADM Tarde" },
    { key: "unpaid_leave", label: "Permiso sin Goce" },
    { key: "unjustified_absence", label: "Ausencia injustificada" },
    { key: "hour_return", label: "Devoluci\u00f3n de Hora" }
];

function weeklyTypeFilterOptions(leaveRows = []) {
    return [
        { value: "Todos", label: "Todos" },
        ...WEEKLY_SHIFTS.map(shift => ({
            value: `shift:${shift.key}`,
            label: shift.label
        })),
        ...leaveRows.map(row => ({
            value: `leave:${row.key}`,
            label: row.label
        }))
    ];
}

function normalizeWeeklyTypeFilter(value, options) {
    const clean = String(value || "Todos");
    const availableOptions = options || weeklyTypeFilterOptions();

    return availableOptions.some(option =>
        option.value === clean
    )
        ? clean
        : "Todos";
}

function renderWeeklyTypeFilterOptions(selected, options) {
    return options.map(option => `
        <option value="${escapeHTML(option.value)}" ${option.value === selected ? "selected" : ""}>
            ${escapeHTML(option.label)}
        </option>
    `).join("");
}

async function weeklyHolidayMap(days) {
    const years = [...new Set(
        days.map(day => day.getFullYear())
    )];
    const holidays = await Promise.all(
        years.map(year => fetchHolidays(year))
    );

    return Object.assign({}, ...holidays);
}

function weeklyIsInhabil(day, holidays) {
    return !isBusinessDay(day, holidays);
}

function staffingEstamentoOrder(profile) {
    const estamento = normalizeStaffingEstamento(profile?.estamento);
    const index = STAFFING_ESTAMENTOS.indexOf(estamento);

    return index === -1 ? STAFFING_ESTAMENTOS.length : index;
}

function weeklyShiftProfiles(
    date,
    shiftKey,
    absenceCache,
    roleFilter,
    professionFilter
) {
    return getProfiles()
        .filter(isProfileActive)
        .filter(profile =>
            weeklyProfileMatchesFilters(
                profile,
                roleFilter,
                professionFilter
            )
        )
        .flatMap(profile => {
            const segments = profileWeeklyShiftSegments(
                profile,
                date,
                shiftKey,
                absenceCache
            );
            const replacementSlot =
                profileWeeklyPendingReplacementSlot(
                    profile,
                    date,
                    shiftKey,
                    absenceCache
                );
            const items = [];

            if (segments?.length) {
                items.push({
                    type: "profile",
                    profile,
                    segments
                });
            }

            if (replacementSlot) {
                items.push(replacementSlot);
            }

            return items;
        })
        .sort((a, b) =>
            staffingEstamentoOrder(a.profile) -
                staffingEstamentoOrder(b.profile) ||
            a.profile.name.localeCompare(b.profile.name, "es") ||
            (a.type === "replacement-slot" ? 1 : -1)
        );
}

function weeklySegmentSummary(segments) {
    if (!segments?.length) return "";
    if (segments.includes(STAFFING_SEGMENT.NIGHT)) return "";

    const hasMorning =
        segments.includes(STAFFING_SEGMENT.DAY_MORNING);
    const hasAfternoon =
        segments.includes(STAFFING_SEGMENT.DAY_AFTERNOON);

    if (hasMorning && hasAfternoon) return "";
    if (hasMorning) return "AM";
    if (hasAfternoon) return "PM";

    return "";
}

function weeklyClassModifier(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function renderWeeklyProfileChip(item) {
    if (item.type === "replacement-slot") {
        const label = item.absence?.label
            ? `Reemplazo pendiente por ${item.absence.label}`
            : "Reemplazo pendiente";

        return `
            <button class="staffing-weekly-replacement-slot" type="button" data-weekly-replacement-profile="${escapeHTML(item.profile.name)}" data-weekly-replacement-key="${escapeHTML(item.keyDay)}" title="${escapeHTML(label)}: ${escapeHTML(item.profile.name)}" aria-label="${escapeHTML(label)}: ${escapeHTML(item.profile.name)}">
                <span>!</span>
            </button>
        `;
    }

    const partial = weeklySegmentSummary(item.segments);
    const needsReplacement = item.needsReplacement;

    return `
        <span class="staffing-weekly-person${needsReplacement ? " staffing-weekly-person--needs-replacement" : ""}">
            ${needsReplacement ? `
                <button class="staffing-weekly-replacement-alert" type="button" data-weekly-replacement-profile="${escapeHTML(item.profile.name)}" data-weekly-replacement-key="${escapeHTML(item.keyDay)}" title="Buscar reemplazo">
                    !
                </button>
            ` : ""}
            <span class="staffing-weekly-person__body">
                <strong>${escapeHTML(item.profile.name)}</strong>
                <small>${escapeHTML(weeklyProfileMeta(item.profile))}${partial ? ` | ${escapeHTML(partial)}` : ""}</small>
            </span>
        </span>
    `;
}

function renderStaffingWeeklyCell(
    date,
    shift,
    absenceCache,
    roleFilter,
    professionFilter,
    isInhabil
) {
    const people = weeklyShiftProfiles(
        date,
        shift.key,
        absenceCache,
        roleFilter,
        professionFilter
    );

    return `
        <article class="staffing-weekly-cell staffing-weekly-cell--${shift.key}${isInhabil ? " staffing-weekly-cell--inhabil" : ""}">
            <div class="staffing-weekly-cell__shift">
                <span>${escapeHTML(shift.label)}</span>
                ${
                    shift.key === "noche"
                        ? `
                            <svg class="staffing-weekly-cell__shift-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M21 12.79A9 9 0 1 1 11.21 3A7 7 0 0 0 21 12.79z"></path>
                            </svg>
                        `
                        : `
                            <svg class="staffing-weekly-cell__shift-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <circle cx="12" cy="12" r="4"></circle>
                                <path d="M12 2v2"></path>
                                <path d="M12 20v2"></path>
                                <path d="M4.93 4.93l1.41 1.41"></path>
                                <path d="M17.66 17.66l1.41 1.41"></path>
                                <path d="M2 12h2"></path>
                                <path d="M20 12h2"></path>
                                <path d="M6.34 17.66l-1.41 1.41"></path>
                                <path d="M17.66 6.34l1.41-1.41"></path>
                            </svg>
                        `
                }
            </div>
            <div class="staffing-weekly-people">
                ${
                    people.length
                        ? people.map(renderWeeklyProfileChip).join("")
                        : `<span class="staffing-weekly-empty">Sin personal disponible</span>`
                }
            </div>
        </article>
    `;
}

function weeklyLeaveProfiles(
    date,
    row,
    absenceCache,
    roleFilter,
    professionFilter
) {
    const keyDay = key(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );
    return getProfiles()
        .filter(isProfileActive)
        .filter(profile =>
            weeklyProfileMatchesFilters(
                profile,
                roleFilter,
                professionFilter
            )
        )
        .map(profile => {
            if (row.key === "hour_return") {
                return getHourReturn(profile.name, keyDay)
                    ? { profile, keyDay, needsReplacement: false }
                    : null;
            }

            const absence = getProfileStaffingAbsence(
                profile.name,
                keyDay,
                absenceCache
            );

            if (absence?.code !== row.key) return null;

            return {
                profile,
                keyDay,
                needsReplacement:
                    weeklyProfileNeedsReplacement(
                        profile,
                        keyDay,
                        getStaffingTurno(
                            profile,
                            date.getFullYear(),
                            date.getMonth(),
                            date.getDate(),
                            { includeReplacements: false }
                        )
                    )
            };
        })
        .filter(Boolean)
        .sort((a, b) =>
            staffingEstamentoOrder(a.profile) -
                staffingEstamentoOrder(b.profile) ||
            a.profile.name.localeCompare(b.profile.name, "es")
        );
}

function weeklyLeaveRows(
    days,
    absenceCache,
    roleFilter,
    professionFilter,
    options = {}
) {
    const forcedRowKey = options.rowKey || "";
    const sourceRows = forcedRowKey
        ? WEEKLY_LEAVE_ROWS.filter(row => row.key === forcedRowKey)
        : WEEKLY_LEAVE_ROWS;

    return sourceRows
        .map(row => ({
            ...row,
            days: days.map(day => ({
                date: day,
                people: weeklyLeaveProfiles(
                    day,
                    row,
                    absenceCache,
                    roleFilter,
                    professionFilter
                )
            }))
        }))
        .filter(row =>
            forcedRowKey ||
            row.days.some(day => day.people.length)
        );
}

function renderStaffingWeeklyLeaveCell(row, day, isInhabil) {
    const leaveClass = weeklyClassModifier(row.key);

    return `
        <article class="staffing-weekly-cell staffing-weekly-cell--leave${leaveClass ? ` staffing-weekly-cell--leave-${leaveClass}` : ""}${isInhabil ? " staffing-weekly-cell--inhabil" : ""}">
            <div class="staffing-weekly-cell__shift">${escapeHTML(row.label)}</div>
            <div class="staffing-weekly-people">
                ${
                    day.people.length
                        ? day.people.map(renderWeeklyProfileChip).join("")
                        : `<span class="staffing-weekly-empty">Sin registros</span>`
                }
            </div>
        </article>
    `;
}

function bindStaffingWeeklyScrollSync(target) {
    const dayRows = [
        ...target.querySelectorAll(
            ".staffing-weekly-days, .staffing-weekly-mobile-days"
        )
    ];
    const grid = target.querySelector(".staffing-weekly-grid");

    if (!dayRows.length || !grid) {
        return;
    }

    let syncing = false;
    const syncScroll = source => {
        if (syncing) {
            return;
        }

        syncing = true;
        const left = source.scrollLeft;
        [...dayRows, grid].forEach(element => {
            if (element !== source) {
                element.scrollLeft = left;
            }
        });
        window.requestAnimationFrame(() => {
            syncing = false;
        });
    };

    dayRows.forEach(row => {
        row.addEventListener("scroll", () => syncScroll(row), {
            passive: true
        });
    });
    grid.addEventListener("scroll", () => syncScroll(grid), {
        passive: true
    });
}

function bindStaffingWeeklyMobileSticky(target) {
    if (typeof staffingWeeklyStickyCleanup === "function") {
        staffingWeeklyStickyCleanup();
        staffingWeeklyStickyCleanup = null;
    }

    const header = target.querySelector(".staffing-weekly-mobile-days");
    if (!header) return;

    const placeholder = document.createElement("div");
    placeholder.className = "staffing-weekly-mobile-days-placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    header.before(placeholder);

    let frame = 0;

    const reset = () => {
        placeholder.style.height = "0px";
        header.classList.remove("staffing-weekly-mobile-days--fixed");
        header.style.removeProperty("top");
        header.style.removeProperty("left");
        header.style.removeProperty("width");
    };

    const topOffset = () => {
        const topbar = document.querySelector(".topbar");
        if (!topbar || window.innerWidth > 760) return 0;

        const style = window.getComputedStyle(topbar);
        if (style.position !== "sticky" && style.position !== "fixed") {
            return 0;
        }

        const rect = topbar.getBoundingClientRect();
        return rect.top <= 1 && rect.bottom > 0
            ? Math.round(rect.bottom)
            : 0;
    };

    const update = () => {
        frame = 0;

        if (
            !header.isConnected ||
            document.body.dataset.activeView !== "weekly" ||
            window.innerWidth > 760
        ) {
            reset();
            return;
        }

        const stickyTop = topOffset();
        const panelRect = target.getBoundingClientRect();
        const anchorRect = placeholder.getBoundingClientRect();
        const headerHeight = header.offsetHeight || 0;
        const shouldFix =
            anchorRect.top <= stickyTop &&
            panelRect.bottom > stickyTop + headerHeight + 8;

        if (!shouldFix) {
            reset();
            return;
        }

        const viewportWidth =
            document.documentElement.clientWidth || window.innerWidth;
        const left = Math.max(0, Math.round(panelRect.left));
        const width = Math.max(
            0,
            Math.min(Math.round(panelRect.width), viewportWidth - left)
        );

        placeholder.style.height = `${headerHeight}px`;
        header.classList.add("staffing-weekly-mobile-days--fixed");
        header.style.top = `${stickyTop}px`;
        header.style.left = `${left}px`;
        header.style.width = `${width}px`;
    };

    const requestUpdate = () => {
        if (!frame) {
            frame = window.requestAnimationFrame(update);
        }
    };

    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate, { passive: true });
    window.addEventListener("orientationchange", requestUpdate, {
        passive: true
    });

    staffingWeeklyStickyCleanup = () => {
        if (frame) {
            window.cancelAnimationFrame(frame);
            frame = 0;
        }
        window.removeEventListener("scroll", requestUpdate);
        window.removeEventListener("resize", requestUpdate);
        window.removeEventListener("orientationchange", requestUpdate);
        reset();
        placeholder.remove();
    };

    requestUpdate();
}

export async function renderStaffingWeeklyCalendar() {
    const target = document.getElementById("staffingWeeklyCalendar");
    if (!target) return;

    const roleFilter =
        target.querySelector("#staffingWeeklyFilterRole")?.value ||
        "Todos";
    const currentProfessionFilter =
        target.querySelector("#staffingWeeklyFilterProfession")?.value ||
        "Todas";
    const availableProfessions =
        weeklyAvailableProfessions(roleFilter);
    const professionFilter =
        availableProfessions.includes(currentProfessionFilter)
            ? currentProfessionFilter
            : "Todas";
    const days = staffingWeekDays(getStaffingWeekDate());
    const holidays = await weeklyHolidayMap(days);
    const absenceCache = new Map();
    const allLeaveRows = weeklyLeaveRows(
        days,
        absenceCache,
        roleFilter,
        professionFilter
    );
    const typeOptions = weeklyTypeFilterOptions(allLeaveRows);
    const typeFilter = normalizeWeeklyTypeFilter(
        target.querySelector("#staffingWeeklyFilterType")?.value ||
        "Todos",
        typeOptions
    );
    const selectedShiftKey = typeFilter.startsWith("shift:")
        ? typeFilter.slice("shift:".length)
        : "";
    const selectedLeaveKey = typeFilter.startsWith("leave:")
        ? typeFilter.slice("leave:".length)
        : "";
    const visibleShifts = selectedLeaveKey
        ? []
        : WEEKLY_SHIFTS.filter(shift =>
            !selectedShiftKey || shift.key === selectedShiftKey
        );
    const visibleLeaveRows = selectedShiftKey
        ? []
        : selectedLeaveKey
            ? allLeaveRows.filter(row => row.key === selectedLeaveKey)
            : allLeaveRows;
    const weeklyRowsHTML = `
        ${visibleShifts.map(shift =>
            days.map(day =>
                renderStaffingWeeklyCell(
                    day,
                    shift,
                    absenceCache,
                    roleFilter,
                    professionFilter,
                    weeklyIsInhabil(day, holidays)
                )
            ).join("")
        ).join("")}
        ${visibleLeaveRows.map(row =>
            row.days.map(day =>
                renderStaffingWeeklyLeaveCell(
                    row,
                    day,
                    weeklyIsInhabil(day.date, holidays)
                )
            ).join("")
        ).join("")}
    `;
    const weeklyEmptyHTML = `
        <div class="staffing-weekly-empty-state">
            Sin registros para el filtro seleccionado.
        </div>
    `;
    const dayHeadersHTML = days.map(day => `
        <div class="staffing-weekly-day${weeklyIsInhabil(day, holidays) ? " staffing-weekly-day--inhabil" : ""}">
            <strong>${escapeHTML(formatFullWeekday(day))} ${escapeHTML(formatShortDate(day))}</strong>
        </div>
    `).join("");

    target.innerHTML = `
        <div class="staffing-weekly-sticky">
            <div class="staffing-weekly-filters">
                <label>
                    <span>Filtrar estamento</span>
                    <select id="staffingWeeklyFilterRole">
                        <option value="Todos" ${roleFilter === "Todos" ? "selected" : ""}>Todos</option>
                        ${renderWeeklyRoleFilterOptions(roleFilter)}
                    </select>
                </label>
                <label>
                    <span>Filtrar profesi&oacute;n</span>
                    <select id="staffingWeeklyFilterProfession">
                        <option value="Todas" ${professionFilter === "Todas" ? "selected" : ""}>Todas</option>
                        ${renderWeeklyProfessionFilterOptions(availableProfessions, professionFilter)}
                    </select>
                </label>
                <label>
                    <span>Filtrar tipo</span>
                    <select id="staffingWeeklyFilterType">
                        ${renderWeeklyTypeFilterOptions(typeFilter, typeOptions)}
                    </select>
                </label>
                <span class="staffing-weekly-nav">
                    <button class="secondary-button secondary-button--small" type="button" data-staffing-week-prev>
                        Anterior
                    </button>
                    <button class="secondary-button secondary-button--small" type="button" data-staffing-week-next>
                        Siguiente
                    </button>
                </span>
            </div>
            <div class="staffing-weekly-days">
                ${dayHeadersHTML}
            </div>
        </div>
        <div class="staffing-weekly-mobile-days">
            ${dayHeadersHTML}
        </div>
        <div class="staffing-weekly-grid">
            ${weeklyRowsHTML.trim() || weeklyEmptyHTML}
        </div>
    `;

    bindStaffingWeeklyScrollSync(target);
    bindStaffingWeeklyMobileSticky(target);

    target
        .querySelector("[data-staffing-week-prev]")
        ?.addEventListener("click", () => changeStaffingWeek(-1));
    target
        .querySelector("[data-staffing-week-next]")
        ?.addEventListener("click", () => changeStaffingWeek(1));
    target
        .querySelector("#staffingWeeklyFilterRole")
        ?.addEventListener("change", renderStaffingWeeklyCalendar);
    target
        .querySelector("#staffingWeeklyFilterProfession")
        ?.addEventListener("change", renderStaffingWeeklyCalendar);
    target
        .querySelector("#staffingWeeklyFilterType")
        ?.addEventListener("change", renderStaffingWeeklyCalendar);
    target
        .querySelectorAll("[data-weekly-replacement-profile]")
        .forEach(button => {
            button.addEventListener("click", event => {
                event.stopPropagation();

                if (typeof window.openReplacementDialog !== "function") {
                    return;
                }

                window.openReplacementDialog(
                    button.dataset.weeklyReplacementProfile,
                    button.dataset.weeklyReplacementKey
                );
            });
        });
}

function uniqueAbsences(absences) {
    const seen = new Set();

    return absences.filter(item => {
        const key = `${item.profile}|${item.label}`;

        if (seen.has(key)) return false;

        seen.add(key);
        return true;
    });
}

function getPendingReplacementTarget(profile, keyDay) {
    const admin = getJSON(`admin_${profile.name}`, {});
    const legal = getJSON(`legal_${profile.name}`, {});
    const comp = getJSON(`comp_${profile.name}`, {});
    const absences = getJSON(`absences_${profile.name}`, {});
    const baseTurn = getTurnoBase(profile.name, keyDay);

    if (
        !requiereReemplazoTurnoBase(
            keyDay,
            baseTurn,
            admin,
            legal,
            comp,
            absences
        )
    ) {
        return null;
    }

    if (getReplacementForCoveredShift(profile.name, keyDay)) {
        return null;
    }

    return {
        profile: profile.name,
        keyDay
    };
}

function contarRequerimiento(
    profiles,
    row,
    y,
    m,
    d,
    shiftKind,
    absenceCache
) {
    const dayKey = key(y, m, d);
    const checkSegments = checkSegmentsForShift(shiftKind);
    const segmentCounts = new Map(
        checkSegments.map(segment => [segment, 0])
    );
    const absences = [];

    profiles
        .forEach(profile => {
            const coverage = getProfileStaffingCoverage(
                profile,
                row,
                y,
                m,
                d,
                absenceCache
            );

            checkSegments.forEach(segment => {
                if (coverage.activeSegments.has(segment)) {
                    segmentCounts.set(
                        segment,
                        (segmentCounts.get(segment) || 0) + 1
                    );
                }
            });

            const absenceAffectsShift = Boolean(coverage.absence) &&
                checkSegments.some(segment =>
                    coverage.beforeSegments.has(segment) &&
                    coverage.removedSegments.has(segment)
                );

            if (absenceAffectsShift) {
                absences.push({
                    profile: profile.name,
                    label: coverage.absence.label,
                    replacementTarget:
                        getPendingReplacementTarget(profile, dayKey)
                });
            }
        });

    const counts = checkSegments.map(segment =>
        segmentCounts.get(segment) || 0
    );
    const real = counts.length
        ? Math.min(...counts)
        : 0;
    const missingSegments = checkSegments.filter(segment =>
        (segmentCounts.get(segment) || 0) < row.required
    );

    return {
        real,
        missingSegments,
        absences: uniqueAbsences(absences)
    };
}

function sugerirReemplazo(profiles, row, y, m, d, absenceCache, shiftKind){
    const dayKey = key(y, m, d);
    const neededTurn = shiftKind === "night"
        ? TURNO.NOCHE
        : shiftKind === "diurno"
            ? TURNO.DIURNO
            : TURNO.LARGA;
    const libres = profiles
        .filter(profile => staffingGroupMatches(profile, row, dayKey))
        .filter(profile =>
            !getProfileStaffingAbsence(
                profile.name,
                dayKey,
                absenceCache
            )
        )
        .filter(profile => {
            return getStaffingTurno(profile, y, m, d) === 0;
        })
        .filter(profile =>
            !cededSwapTurnBlocks(profile.name, dayKey, neededTurn)
        );

    if (!libres.length) return null;

    libres.sort((a, b) => a.name.localeCompare(b.name));

    return libres[0].name;
}

// Cache de analizarMes: el calculo de dotacion (dias x requerimientos x
// perfiles) es pesado. Se memoiza por mes + firma de feriados y se invalida
// ante cualquier cambio de datos local o aplicacion de estado remoto.
const ANALIZAR_MES_CACHE = new Map();

function holidaysSignature(holidays) {
    return Object.keys(holidays || {}).sort().join(",");
}

function clearAnalizarMesCache() {
    ANALIZAR_MES_CACHE.clear();
}

if (typeof window !== "undefined") {
    window.addEventListener(
        "proturnos:persistenceChanged",
        clearAnalizarMesCache
    );
    window.addEventListener("proturnos:firebaseAppState", event => {
        if (event.detail?.type === "app-state-applied") {
            clearAnalizarMesCache();
        }
    });
}

export function analizarMes(year, month, holidays = {}){
    const cacheKey = `${year}|${month}|${holidaysSignature(holidays)}`;
    const cachedResult = ANALIZAR_MES_CACHE.get(cacheKey);

    if (cachedResult) {
        return cachedResult;
    }

    const profiles = getProfiles().filter(isProfileActive);
    const requirements = buildStaffingRequirementRows()
        .filter(row => row.required > 0);
    const diasMes =
        new Date(year, month + 1, 0).getDate();
    const absenceCache = new Map();

    const salida = [];

    for (let d = 1; d <= diasMes; d++) {
        const detalle = [];
        const date = new Date(year, month, d);
        const isHab = isBusinessDay(date, holidays);

        requirements.forEach(row => {
            if (row.modality === "diurno" && !isHab) {
                return;
            }

            const checks = row.modality === "diurno"
                ? [{
                    kind: "diurno",
                    label: "Diurno",
                    badgeType: "faltante"
                }]
                : [
                    {
                        kind: "day",
                        label: "Larga",
                        badgeType: "faltante"
                    },
                    {
                        kind: "night",
                        label: "Noche",
                        badgeType: "noche"
                    }
            ];

            checks.forEach(check => {
                const coverage = contarRequerimiento(
                    profiles,
                    row,
                    year,
                    month,
                    d,
                    check.kind,
                    absenceCache
                );
                const real = coverage.real;

                if (real < row.required) {
                    detalle.push({
                        tipo: check.badgeType,
                        estamento: row.estamento,
                        groupLabel: row.groupLabel,
                        shiftLabel: check.label,
                        segmentLabel: segmentLabel(
                            coverage.missingSegments
                        ),
                        absences: coverage.absences,
                        replacementTargets: coverage.absences
                            .map(item => item.replacementTarget)
                            .filter(Boolean),
                        cantidad: row.required - real,
                        sugerencia: sugerirReemplazo(
                            profiles,
                            row,
                            year,
                            month,
                            d,
                            absenceCache,
                            check.kind
                        )
                    });
                }

                if (real > row.required) {
                    detalle.push({
                        tipo: "exceso",
                        estamento: row.estamento,
                        groupLabel: row.groupLabel,
                        shiftLabel: check.label,
                        cantidad: real - row.required
                    });
                }
            });
        });

        salida.push({
            dia: d,
            detalle
        });
    }

    ANALIZAR_MES_CACHE.set(cacheKey, salida);

    return salida;
}

export function renderStaffingPanel(){
    bindStaffingView();
    renderApplicantsPanel();
    renderStaffingAnalysis();
}

function formatShiftLabel(detail, fallback) {
    const base = detail.shiftLabel || fallback;

    return detail.segmentLabel
        ? `${base} (${detail.segmentLabel})`
        : base;
}

function formatAbsenceReason(detail) {
    const absences = detail.absences || [];

    if (!absences.length) return "";

    const summary = absences
        .slice(0, 3)
        .map(item =>
            `${item.profile} (${item.label})`
        )
        .join(", ");
    const extra = absences.length > 3
        ? ` y ${absences.length - 3} mas`
        : "";

    return ` por ausencia: ${summary}${extra}`;
}

function detailReplacementTarget(detail) {
    return (detail.replacementTargets || [])[0] || null;
}

function renderStaffingPill(detail, className, content) {
    const target = detailReplacementTarget(detail);

    if (!target) {
        return `
            <span class="staffing-pill ${className}">
                ${content}
            </span>
        `;
    }

    return `
        <button class="staffing-pill ${className} staffing-pill--action" type="button" data-staffing-replacement-profile="${escapeHTML(target.profile)}" data-staffing-replacement-key="${escapeHTML(target.keyDay)}" title="Buscar reemplazo">
            ${content}
        </button>
    `;
}

function renderDetailBadge(detail){
    if (detail.tipo === "birthday") {
        return `
            <span class="staffing-pill staffing-pill--birthday">
                Cumplea&ntilde;os de ${escapeHTML(detail.name)}
            </span>
        `;
    }

    if (detail.tipo === "reminder") {
        const meta = detail.custom
            ? [
                STAFFING_REMINDER_VISIBILITY_LABELS[detail.visibility],
                STAFFING_REMINDER_RECURRENCE_LABELS[detail.recurrence]
            ]
                .filter(Boolean)
                .join(" | ")
            : "";
        const title = meta
            ? ` title="${escapeHTML(meta)}"`
            : "";

        return `
            <span class="staffing-pill staffing-pill--reminder"${title}>
                Recordatorio: ${escapeHTML(detail.label)}
            </span>
        `;
    }

    if (detail.tipo === "faltante") {
        return renderStaffingPill(
            detail,
            "staffing-pill--bad",
            `
            Falta ${detail.cantidad} ${escapeHTML(detail.groupLabel || detail.estamento)}
            en turno ${escapeHTML(formatShiftLabel(detail, "Diurno"))}
            ${escapeHTML(formatAbsenceReason(detail))}
            ${detail.sugerencia ? ` - Sugerido: ${escapeHTML(detail.sugerencia)}` : ""}
            `
        );
    }

    if (detail.tipo === "exceso") {
        return `
            <span class="staffing-pill staffing-pill--warn">
                Exceso ${detail.cantidad} ${escapeHTML(detail.groupLabel || detail.estamento)}
                en turno ${escapeHTML(detail.shiftLabel || "Diurno")}
            </span>
        `;
    }

    return renderStaffingPill(
        detail,
        "staffing-pill--night",
        `
        Falta ${detail.cantidad} ${escapeHTML(detail.groupLabel || detail.estamento)}
        en turno ${escapeHTML(formatShiftLabel(detail, "Noche"))}
        ${escapeHTML(formatAbsenceReason(detail))}
        `
    );
}

function bindStaffingReplacementAlerts(container) {
    if (!container) return;

    container
        .querySelectorAll("[data-staffing-replacement-profile][data-staffing-replacement-key]")
        .forEach(button => {
            button.onclick = async event => {
                event.preventDefault();
                event.stopPropagation();

                if (typeof window.openReplacementDialog !== "function") {
                    alert("No se pudo abrir el cuadro de reemplazos.");
                    return;
                }

                await window.openReplacementDialog(
                    button.dataset.staffingReplacementProfile,
                    button.dataset.staffingReplacementKey
                );
            };
        });
}

function renderStaffingReportToolbar() {
    return `
        <div class="staffing-report-toolbar">
            <button class="staffing-report-reminder-button" type="button" data-staffing-reminder-add title="Agregar recordatorio" aria-label="Agregar recordatorio">
                +
            </button>
        </div>
    `;
}

function closeStaffingReminderDialog(backdrop, keyHandler) {
    if (keyHandler) {
        document.removeEventListener("keydown", keyHandler);
    }

    backdrop?.remove();
}

function rerenderLastInlineStaffingReport() {
    if (!lastInlineStaffingReport) return;

    renderInlineStaffingReport(
        lastInlineStaffingReport.data,
        lastInlineStaffingReport.year,
        lastInlineStaffingReport.month
    );
}

function openStaffingReminderDialog() {
    const existing = document.querySelector(
        "[data-staffing-reminder-dialog]"
    );

    existing?.remove();

    const backdrop = document.createElement("div");
    const defaultDate = staffingReminderDefaultDate();

    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.dataset.staffingReminderDialog = "true";
    backdrop.innerHTML = `
        <form class="turn-change-dialog staffing-reminder-dialog" data-staffing-reminder-form autocomplete="off" role="dialog" aria-modal="true" aria-labelledby="staffingReminderTitle">
            <strong id="staffingReminderTitle">Agregar recordatorio</strong>
            <p>Selecciona la fecha, visibilidad y periodicidad del recordatorio.</p>
            <div class="staffing-reminder-fields">
                <label class="staffing-reminder-field">
                    <span>Fecha</span>
                    <input type="date" name="dateISO" value="${escapeHTML(defaultDate)}" required>
                </label>
                <label class="staffing-reminder-field">
                    <span>Descripci&oacute;n</span>
                    <textarea name="description" rows="3" maxlength="240" placeholder="Ej: Revisar cobertura especial." required></textarea>
                </label>
                <label class="staffing-reminder-field">
                    <span>Visibilidad</span>
                    <select name="visibility">
                        <option value="all">Todos los usuarios del entorno</option>
                        <option value="private">S&oacute;lo quien lo crea</option>
                    </select>
                </label>
                <label class="staffing-reminder-field">
                    <span>Periodicidad</span>
                    <select name="recurrence">
                        <option value="once">Una sola vez</option>
                        <option value="yearly">Anual en la misma fecha</option>
                        <option value="monthly">Mensual</option>
                    </select>
                </label>
            </div>
            <div class="turn-change-dialog__actions staffing-reminder-actions">
                <button class="secondary-button" type="button" data-staffing-reminder-cancel>Cancelar</button>
                <button class="primary-button" type="submit">Guardar</button>
            </div>
        </form>
    `;

    const keyHandler = event => {
        if (event.key === "Escape") {
            closeStaffingReminderDialog(backdrop, keyHandler);
        }
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) {
            closeStaffingReminderDialog(backdrop, keyHandler);
        }
    });

    backdrop
        .querySelector("[data-staffing-reminder-cancel]")
        ?.addEventListener("click", () => {
            closeStaffingReminderDialog(backdrop, keyHandler);
        });

    backdrop
        .querySelector("[data-staffing-reminder-form]")
        ?.addEventListener("submit", event => {
            event.preventDefault();

            const formData = new FormData(event.currentTarget);
            const dateISO = normalizeReminderDateISO(
                formData.get("dateISO")
            );
            const description = String(
                formData.get("description") || ""
            ).trim();
            const visibility = String(
                formData.get("visibility") || "all"
            );
            const recurrence = String(
                formData.get("recurrence") || "once"
            );

            if (!dateISO || !description) {
                alert("Completa fecha y descripcion.");
                return;
            }

            addStaffingCustomReminder({
                dateISO,
                description,
                visibility,
                recurrence
            });
            closeStaffingReminderDialog(backdrop, keyHandler);
            rerenderLastInlineStaffingReport();

            if (document.body.dataset.activeView === "staffing") {
                renderStaffingAnalysis();
            }
        });

    document.body.appendChild(backdrop);
    document.addEventListener("keydown", keyHandler);
    backdrop.querySelector("textarea")?.focus();
}

function bindStaffingReportToolbar(container) {
    container
        ?.querySelector("[data-staffing-reminder-add]")
        ?.addEventListener("click", event => {
            event.preventDefault();
            openStaffingReminderDialog();
        });
}

function mostrarResultado(
    data,
    year = currentDate.getFullYear(),
    month = currentDate.getMonth()
){
    const div = document.getElementById("staffingResult");
    if (!div) return;

    const reportData = withBirthdayDetails(data, year, month);
    const issues = reportData.filter(item => item.detalle.length);

    if (!issues.length) {
        div.innerHTML = `
            <div class="staffing-summary staffing-summary--ok">
                Cobertura completa para el mes visible.
            </div>
        `;
        bindStaffingReplacementAlerts(div);
        return;
    }

    div.innerHTML = issues
        .map(item => `
            <article class="staffing-entry">
                <div class="staffing-entry__day">Día ${item.dia}</div>
                <div class="staffing-entry__list">
                    ${item.detalle.map(renderDetailBadge).join("")}
                </div>
            </article>
        `)
        .join("");

    bindStaffingReplacementAlerts(div);
}

function getStaffingReportScrollTarget(div, day) {
    const entries = Array.from(
        div.querySelectorAll("[data-staffing-report-day]")
    );

    return entries.find(entry =>
        Number(entry.dataset.staffingReportDay) === day
    ) ||
        entries.find(entry =>
            Number(entry.dataset.staffingReportDay) > day
        ) ||
        entries[entries.length - 1] ||
        null;
}

export function scrollInlineStaffingReportToToday() {
    const div = document.getElementById("staffingReportInline");
    if (!div) return;

    const today = new Date();
    const reportYear = Number(div.dataset.staffingReportYear);
    const reportMonth = Number(div.dataset.staffingReportMonth);

    if (
        reportYear !== today.getFullYear() ||
        reportMonth !== today.getMonth()
    ) {
        return;
    }

    const target = getStaffingReportScrollTarget(
        div,
        today.getDate()
    );
    if (!target) return;

    const scrollTop =
        target.getBoundingClientRect().top -
        div.getBoundingClientRect().top +
        div.scrollTop;

    div.scrollTop = Math.max(0, scrollTop);
}

function scrollInlineStaffingReportIfVisible() {
    if (document.body.dataset.activeView !== "turnos") return;

    requestAnimationFrame(scrollInlineStaffingReportToToday);
}

function renderInlineStaffingReport(
    data,
    year = currentDate.getFullYear(),
    month = currentDate.getMonth()
){
    const div = document.getElementById("staffingReportInline");
    if (!div) return;

    lastInlineStaffingReport = {
        data,
        year,
        month
    };
    div.dataset.staffingReportYear = year;
    div.dataset.staffingReportMonth = month;

    const reportData = withBirthdayDetails(data, year, month);
    const issues = reportData.filter(item => item.detalle.length);

    if (!issues.length) {
        div.innerHTML = `
            ${renderStaffingReportToolbar()}
            <div class="staffing-report-empty">
                Cobertura completa para el mes visible.
            </div>
        `;
        bindStaffingReportToolbar(div);
        bindStaffingReplacementAlerts(div);
        scrollInlineStaffingReportIfVisible();
        return;
    }

    div.innerHTML = `
        ${renderStaffingReportToolbar()}
        ${issues
            .map(item => `
            <article class="staffing-report-day" data-staffing-report-day="${item.dia}">
                <strong>D&iacute;a ${item.dia}</strong>
                <div class="staffing-report-pills">
                    ${item.detalle.map(renderDetailBadge).join("")}
                </div>
            </article>
        `)
            .join("")}
    `;

    bindStaffingReportToolbar(div);
    bindStaffingReplacementAlerts(div);
    scrollInlineStaffingReportIfVisible();
}

export function renderReplacementContractsLog(){
    const div = document.getElementById("replacementContractsLog");
    if (!div) return;

    const contracts = getAllReplacementContracts();

    if (!contracts.length) {
        div.innerHTML = `
            <div class="staffing-contract-log staffing-contract-log--empty">
                Sin contratos de reemplazo registrados.
            </div>
        `;
        return;
    }

    div.innerHTML = `
        <section class="staffing-contract-log">
            <h4>Contratos personal Reemplazo</h4>
            ${contracts.map(contract => `
                <article class="staffing-contract-item">
                    <strong>${contract.worker}</strong>
                    <span>${contract.estamento}</span>
                    <small>
                        ${formatContractDate(contract.start)} - ${formatContractDate(contract.end)}
                        | Reemplaza a: ${contract.replaces}
                    </small>
                </article>
            `).join("")}
        </section>
    `;
}

export async function analizarStaffingMes(
    year = currentDate.getFullYear(),
    month = currentDate.getMonth(),
    options = {}
){
    const requestId = options.latestOnly
        ? ++staffingAnalysisRequest
        : 0;
    const holidays = await fetchHolidays(year);

    if (
        options.latestOnly &&
        requestId !== staffingAnalysisRequest
    ) {
        return [];
    }

    if (
        options.activeView &&
        document.body.dataset.activeView !== options.activeView
    ) {
        return [];
    }

    const data = analizarMes(year, month, holidays);

    if (options.renderPanel !== false) {
        mostrarResultado(data, year, month);
    }

    renderInlineStaffingReport(data, year, month);
    return data;
}

export async function renderInlineStaffingAnalysis(){
    return await analizarStaffingMes(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        {
            renderPanel: false,
            latestOnly: true,
            activeView: "turnos"
        }
    );
}

export async function renderStaffingAnalysis(){
    bindStaffingView();
    renderStaffingProfiles();
    renderStaffingWeeklyCalendar();
    renderReplacementContractsLog();
    renderStaffingMedicalChart();

    return await analizarStaffingMes(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        {
            latestOnly: true,
            activeView: "staffing"
        }
    );
}

window.renderStaffingAnalysis = renderStaffingAnalysis;
window.renderInlineStaffingAnalysis =
    renderInlineStaffingAnalysis;
window.renderStaffingPanel = renderStaffingPanel;
window.renderStaffingMedicalChart = renderStaffingMedicalChart;
