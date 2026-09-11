// Calculos del menu Equipos Medicos: indicadores, avisos, carpeta de
// documentos y hoja de vida. No tocan el DOM ni el almacenamiento: los usan
// igual la pantalla y las impresiones, y se prueban con node.

const DAY_MS = 86400000;
const HOUR_MS = 3600000;

export const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export const EQUIPMENT_STATUS = {
    operational: { label: "Operativo", tone: "ok" },
    limited: { label: "Operativo con observación", tone: "warn" },
    // El id sigue siendo "maintenance" porque asi lo lee la PWA publicada; lo
    // que cambia es como se nombra: el equipo puede estar detenido por una
    // falla que todavia nadie repara, no solo por una mantencion.
    maintenance: { label: "Fuera de servicio", tone: "danger" },
    inactive: { label: "De baja", tone: "muted" }
};

export const SEVERITY_LABELS = { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" };

export const FAILURE_STATUS = {
    open: { label: "Pendiente", tone: "danger" },
    review: { label: "En revisión", tone: "warn" },
    resolved: { label: "Resuelta", tone: "ok" },
    dismissed: { label: "Descartada", tone: "muted" }
};

export const MAINTENANCE_TYPE_LABELS = {
    preventive: "Preventiva",
    corrective: "Correctiva",
    calibration: "Calibración",
    inspection: "Revisión técnica"
};

export const CRITICALITY_LABELS = { critical: "Crítico", relevant: "Relevante", support: "Apoyo" };

// Nivel de un aviso: 3 urgente, 2 atencion, 1 aviso, 0 informativo.
export const LEVEL_TONES = ["muted", "notice", "warn", "danger"];

// Lo que deberia tener la carpeta de cada equipo. Los que emiten radiacion
// ionizante suman los documentos de proteccion radiologica.
export const DOCUMENT_TEMPLATE = [
    {
        id: "acquisition",
        label: "Adquisición",
        items: [
            { id: "purchase_order", label: "Orden de compra o factura" },
            { id: "reception_act", label: "Acta de recepción conforme" },
            { id: "warranty", label: "Certificado de garantía" }
        ]
    },
    {
        id: "technical",
        label: "Técnicos",
        items: [
            { id: "user_manual", label: "Manual de usuario" },
            { id: "service_manual", label: "Manual de servicio" },
            { id: "datasheet", label: "Ficha técnica del fabricante" }
        ]
    },
    {
        id: "radiation",
        label: "Regulatorio y protección radiológica",
        onlyIonizing: true,
        items: [
            { id: "seremi_authorization", label: "Autorización sanitaria (SEREMI)", expires: true },
            { id: "radiometric_survey", label: "Levantamiento radiométrico", expires: true },
            { id: "quality_control", label: "Control de calidad anual", expires: true }
        ]
    },
    {
        id: "staff",
        label: "Personal",
        items: [
            { id: "operator_training", label: "Registro de capacitación de operadores" }
        ]
    }
];

const DOCUMENT_TYPES = DOCUMENT_TEMPLATE.flatMap(group =>
    group.items.map(item => ({ ...item, groupId: group.id, onlyIonizing: Boolean(group.onlyIonizing) }))
);

export function documentTypeLabel(id) {
    return DOCUMENT_TYPES.find(item => item.id === id)?.label || "";
}

export function documentTypeOptions(ionizing) {
    return DOCUMENT_TYPES.filter(item => !item.onlyIonizing || ionizing === true);
}

/* ---------- fechas y formatos ---------- */

function pad(value) {
    return String(value).padStart(2, "0");
}

export function isISODate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export function localISODate(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function localISODateTime(date = new Date()) {
    return `${localISODate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Acepta fecha sola, fecha-hora local (lo que entrega un datetime-local) o un
// ISO con zona (lo que guarda Firestore en createdAtISO).
export function parseDateTime(value) {
    const text = String(value || "").trim();
    const local = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/);

    if (local) {
        return new Date(
            Number(local[1]),
            Number(local[2]) - 1,
            Number(local[3]),
            local[4] ? Number(local[4]) : 12,
            local[5] ? Number(local[5]) : 0
        );
    }

    if (!text) return null;

    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function toLocalDateTime(value) {
    const date = parseDateTime(value);
    return date ? localISODateTime(date) : "";
}

function dateAtNoon(iso) {
    const [year, month, day] = String(iso).slice(0, 10).split("-").map(Number);
    return new Date(year, month - 1, day, 12);
}

export function daysBetween(fromISO, toISO) {
    return Math.round((dateAtNoon(toISO) - dateAtNoon(fromISO)) / DAY_MS);
}

export function daysUntil(iso, today) {
    return isISODate(iso) ? daysBetween(today, iso) : null;
}

export function addDaysISO(iso, days) {
    const date = dateAtNoon(iso);
    date.setDate(date.getDate() + days);
    return localISODate(date);
}

export function addMonthsISO(iso, months) {
    const date = dateAtNoon(iso);
    const day = date.getDate();

    date.setDate(1);
    date.setMonth(date.getMonth() + months);
    date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));

    return localISODate(date);
}

export function hoursBetween(from, to) {
    const start = parseDateTime(from);
    const end = parseDateTime(to);
    return start && end ? (end - start) / HOUR_MS : 0;
}

export function formatDate(iso) {
    const clean = String(iso || "").slice(0, 10);
    return isISODate(clean) ? `${clean.slice(8, 10)}-${clean.slice(5, 7)}-${clean.slice(0, 4)}` : "—";
}

export function formatDayMonth(iso) {
    return `${Number(iso.slice(8, 10))} ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]}`;
}

export function formatTime(value) {
    if (!/T\d{2}:\d{2}/.test(String(value || ""))) return "";
    const date = parseDateTime(value);
    return date ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : "";
}

export function formatDecimal(value, digits = 1) {
    return Number(value).toFixed(digits).replace(".", ",");
}

// Se trunca y no se redondea: un 99,97 % no debe leerse como 100 %.
export function formatPercent(value) {
    return `${formatDecimal(Math.floor(value * 10) / 10)} %`;
}

export function formatDuration(hours) {
    const value = Math.max(0, Number(hours) || 0);
    return value >= 48
        ? `${formatDecimal(value / 24).replace(/,0$/, "")} d`
        : `${Math.round(value)} h`;
}

export function plural(count, one, many) {
    return `${count} ${count === 1 ? one : many}`;
}

export function agoLabel(iso, today) {
    const days = daysBetween(iso, today);
    if (days <= 0) return "hoy";
    if (days === 1) return "ayer";
    return `hace ${days} días`;
}

export function dueLabel(iso, today) {
    const days = daysBetween(today, iso);
    if (days === 0) return "hoy";
    if (days === 1) return "mañana";
    if (days < 0) return `vencida hace ${-days} d`;
    return `en ${days} d`;
}

export function ageLabel(fromISO, today) {
    const months = Math.max(0, Math.floor(daysBetween(fromISO, today) / 30.44));
    const years = Math.floor(months / 12);
    const rest = months % 12;

    if (!years) return plural(months, "mes", "meses");
    return `${plural(years, "año", "años")}${rest ? ` ${plural(rest, "mes", "meses")}` : ""}`;
}

export function frequencyLabel(days) {
    const value = Number(days) || 0;
    if (!value) return "No aplica";
    if (value >= 360) return "Anual";
    if (value >= 175) return "Semestral";
    if (value >= 115) return "Cuatrimestral";
    if (value >= 85) return "Trimestral";
    if (value >= 28 && value <= 31) return "Mensual";
    return `Cada ${value} días`;
}

export function normalizeTitleKey(title) {
    return String(title || "")
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

/* ---------- mantenciones ---------- */

// Estado derivado, sin campo propio: una mantencion con inicio y sin termino
// esta en curso; una con fecha futura esta programada.
export function maintenanceState(record, now) {
    const start = toLocalDateTime(record.startAt);
    const end = toLocalDateTime(record.endAt);

    if (start) {
        if (start > now) return "scheduled";
        if (!end || end > now) return "ongoing";
        return "done";
    }

    return String(record.date || "") > now.slice(0, 10) ? "scheduled" : "done";
}

export function maintenanceHours(record, now) {
    if (!record.startAt) return 0;

    const state = maintenanceState(record, now);
    const end = state === "ongoing" ? now : (record.endAt || record.startAt);

    return Math.max(0, hoursBetween(record.startAt, end));
}

export function plannedMaintenanceHours(record) {
    return record.startAt && record.endAt
        ? Math.max(0, hoursBetween(record.startAt, record.endAt))
        : 0;
}

/* ---------- fallas: PWA y supervision en una sola lista ---------- */

export function buildFailures(equipment, reports = [], now = localISODateTime()) {
    const maintenanceByFailure = new Map();

    (equipment.maintenances || []).forEach(record => {
        (record.resolvesFailureIds || []).forEach(id => {
            if (!maintenanceByFailure.has(id)) maintenanceByFailure.set(id, record);
        });
    });

    const fromWorkers = reports
        .filter(report => report.equipmentId === equipment.id)
        .map(report => ({
            id: report.id,
            source: "worker",
            channel: "PWA",
            title: report.title,
            detail: report.detail,
            severity: report.severity,
            status: report.status,
            createdAt: report.createdAt,
            date: report.date || String(report.createdAt || "").slice(0, 10),
            reportedByName: report.reportedByName || "Trabajador",
            attachments: report.attachments || [],
            note: report.supervisorNote || "",
            resolvedAt: report.resolvedAt || "",
            outOfService: false
        }));
    const fromSupervisor = (equipment.errors || []).map(error => ({
        id: error.id,
        source: "supervisor",
        channel: "Supervisor",
        title: error.title,
        detail: error.detail,
        severity: error.severity,
        status: error.status,
        createdAt: error.createdAt,
        date: error.date || String(error.createdAt || "").slice(0, 10),
        reportedByName: error.reportedByName || "Supervisor",
        attachments: error.attachments || [],
        note: error.note || "",
        resolvedAt: error.resolvedAt || "",
        outOfService: Boolean(error.outOfService)
    }));

    return [...fromWorkers, ...fromSupervisor]
        .map(failure => {
            const maintenance = maintenanceByFailure.get(failure.id) || null;
            const localCreated = toLocalDateTime(failure.createdAt);
            const time = localCreated.slice(0, 10) === failure.date
                ? formatTime(failure.createdAt)
                : "";
            const repairEnd = maintenance?.endAt && maintenanceState(maintenance, now) === "done"
                ? maintenance.endAt
                : failure.status === "resolved" ? failure.resolvedAt : "";
            const repairHours = repairEnd && failure.createdAt
                ? Math.max(0, hoursBetween(failure.createdAt, repairEnd))
                : null;
            const responseHours = maintenance?.startAt && maintenance.type === "corrective" && failure.createdAt
                ? Math.max(0, hoursBetween(failure.createdAt, maintenance.startAt))
                : null;

            return { ...failure, time, maintenance, repairHours, responseHours };
        })
        .sort((a, b) =>
            String(b.date).localeCompare(String(a.date)) ||
            String(b.createdAt).localeCompare(String(a.createdAt))
        );
}

export function isOpenFailure(failure) {
    return failure.status === "open" || failure.status === "review";
}

/* ---------- contrato ---------- */

// Los equipos anteriores al contrato como ficha propia solo tenian proveedor,
// vigencia y adjuntos sueltos. Se leen como un contrato para no perder la
// vigencia ni el aviso de renovacion hasta que el supervisor lo complete.
export function resolveContract(equipment, contracts = []) {
    if (equipment.contractId) {
        const contract = contracts.find(item => item.id === equipment.contractId);
        if (contract) return contract;
    }

    if (!equipment.serviceActive && !equipment.serviceUntil) return null;

    return {
        id: `legacy_${equipment.id}`,
        legacy: true,
        provider: equipment.serviceProvider || "",
        tenderId: "",
        coverage: "",
        startDate: "",
        endDate: equipment.serviceUntil || "",
        amount: "",
        responseHours: 0,
        preventivesPerYear: 0,
        guaranteedAvailability: 0,
        exclusions: "",
        administrator: "",
        contacts: equipment.contacts || [],
        attachments: equipment.contractAttachments || [],
        previous: []
    };
}

export function renewalCardDate(endDate) {
    return isISODate(endDate) ? addMonthsISO(endDate, -3) : "";
}

/* ---------- indicadores del equipo: ultimos 12 meses ---------- */

export function equipmentMetrics(equipment, failures, contract, { today, now }) {
    const start12 = addDaysISO(today, -365);
    const start24 = addDaysISO(today, -730);
    const maintenances = equipment.maintenances || [];
    const valid = failures.filter(failure => failure.status !== "dismissed");
    const in12 = valid.filter(failure => failure.date >= start12 && failure.date <= today);
    const previous = valid.filter(failure => failure.date >= start24 && failure.date < start12);
    const origin = equipment.installedAt || equipment.purchaseDate || "";
    const hasPreviousYear = Boolean(origin && origin <= start12) ||
        failures.some(failure => failure.date < start12) ||
        maintenances.some(record => record.date < start12);
    const repaired = in12.filter(failure =>
        failure.status === "resolved" && failure.repairHours !== null && failure.repairHours > 0
    );
    const windowStart = `${start12}T00:00`;
    let downtime = 0;

    maintenances.forEach(record => {
        const state = maintenanceState(record, now);
        if (state === "scheduled" || !record.startAt) return;

        const start = toLocalDateTime(record.startAt);
        const end = state === "ongoing" ? now : toLocalDateTime(record.endAt || record.startAt);
        if (end < windowStart) return;

        downtime += Math.max(0, hoursBetween(start < windowStart ? windowStart : start, end));
    });

    const hasOngoing = maintenances.some(record => maintenanceState(record, now) === "ongoing");

    if (equipment.status === "maintenance" && equipment.downSince && !hasOngoing) {
        const start = `${equipment.downSince}T00:00`;
        downtime += Math.max(0, hoursBetween(start < windowStart ? windowStart : start, now));
    }

    downtime = Math.round(downtime);

    const frequency = Number(equipment.maintenanceFrequencyDays) || 0;
    const preventiveDue = frequency ? Math.max(1, Math.round(365 / frequency)) : 0;
    const preventiveDone = Math.min(
        preventiveDue,
        maintenances.filter(record =>
            record.type === "preventive" &&
            record.date >= start12 &&
            maintenanceState(record, now) === "done"
        ).length
    );
    const groups = new Map();

    in12.forEach(failure => {
        const key = normalizeTitleKey(failure.title);
        if (!key) return;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(failure);
    });

    const recurrent = [...groups.values()]
        .filter(list => list.length >= 2)
        .map(list => ({
            title: list[0].title,
            count: list.length,
            dates: list.map(failure => failure.date).sort(),
            failures: list
        }))
        .sort((a, b) => b.count - a.count);
    const responses = in12.filter(failure => failure.responseHours !== null);
    const responseLimit = Number(contract?.responseHours) || 0;

    return {
        failures12: in12.length,
        previous12: hasPreviousYear ? previous.length : null,
        mtbf: in12.length ? Math.round(365 / in12.length) : null,
        mttr: repaired.length
            ? Math.round(repaired.reduce((sum, failure) => sum + failure.repairHours, 0) / repaired.length)
            : null,
        downtime,
        availability: Math.max(0, 100 * (1 - downtime / 8760)),
        preventiveDue,
        preventiveDone,
        open: failures.filter(isOpenFailure),
        recurrent,
        responseAverage: responses.length
            ? Math.round(responses.reduce((sum, failure) => sum + failure.responseHours, 0) / responses.length)
            : null,
        responseCount: responses.length,
        responseLate: responseLimit
            ? responses.filter(failure => failure.responseHours > responseLimit).length
            : 0
    };
}

/* ---------- carpeta de documentos ---------- */

export function documentStatus(doc, today) {
    if (!doc) return { level: "missing", tone: "danger", label: "Falta" };

    if (isISODate(doc.expiresAt)) {
        const days = daysUntil(doc.expiresAt, today);
        if (days < 0) return { level: "expired", tone: "danger", label: `Vencido hace ${-days} d` };
        if (days <= 60) return { level: "expiring", tone: "warn", label: `Vence en ${days} d` };
        return { level: "ok", tone: "ok", label: `Vigente hasta ${formatDate(doc.expiresAt)}` };
    }

    return { level: "ok", tone: "ok", label: "Al día" };
}

export function documentChecklist(equipment, today) {
    const documents = equipment.documents || [];
    const notApplicable = new Set(equipment.documentsNotApplicable || []);
    const groups = DOCUMENT_TEMPLATE
        .filter(group => !group.onlyIonizing || equipment.ionizing === true)
        .map(group => ({
            id: group.id,
            label: group.label,
            items: group.items.map(item => {
                const versions = documents
                    .filter(doc => doc.docType === item.id)
                    .sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
                const doc = versions[0] || null;
                const status = !doc && notApplicable.has(item.id)
                    ? { level: "na", tone: "muted", label: "No aplica" }
                    : documentStatus(doc, today);

                return { ...item, doc, versions, status };
            })
        }));
    const visibleTypes = new Set(groups.flatMap(group => group.items.map(item => item.id)));
    const others = documents.filter(doc => !visibleTypes.has(doc.docType));
    const counted = groups.flatMap(group => group.items).filter(item => item.status.level !== "na");

    return {
        groups,
        others,
        summary: {
            total: counted.length,
            ok: counted.filter(item => item.status.level === "ok").length,
            missing: counted.filter(item => item.status.level === "missing"),
            expired: counted.filter(item => item.status.level === "expired"),
            expiring: counted.filter(item => item.status.level === "expiring")
        }
    };
}

/* ---------- avisos ---------- */

export function equipmentAlerts(equipment, context) {
    if (equipment.status === "inactive") return [];

    const {
        failures = [],
        metrics,
        contract,
        contractEquipment = [],
        docs,
        taskTitles = [],
        today,
        now
    } = context;
    const alerts = [];
    const add = (level, short, title, text, tab, key) => alerts.push({
        level,
        short,
        title,
        text,
        tab,
        key: key || `${equipment.id}:${short}`,
        equipmentId: equipment.id
    });
    const maintenances = equipment.maintenances || [];
    const due = daysUntil(equipment.nextMaintenanceAt, today);
    const ongoing = maintenances.find(record => maintenanceState(record, now) === "ongoing");
    const tasksText = taskTitles.length ? ` Tareas inactivas: ${taskTitles.join(", ")}.` : "";

    if (equipment.status === "maintenance") {
        add(
            3,
            "Fuera de servicio",
            equipment.downSince ? `Fuera de servicio desde ${formatDate(equipment.downSince)}` : "Fuera de servicio",
            `${ongoing ? ongoing.summary || `${MAINTENANCE_TYPE_LABELS[ongoing.type]} en curso.` : "Sin mantención registrada."}${tasksText}`,
            "mantenciones"
        );
    }

    if (due !== null && due < 0) {
        add(
            3,
            "Preventiva vencida",
            `Preventiva vencida hace ${plural(-due, "día", "días")}`,
            `Tocaba el ${formatDate(equipment.nextMaintenanceAt)}. ${contract ? `Coordínala con ${contract.provider || "el proveedor"}.` : "No hay contrato vigente con quien agendarla."}`,
            "mantenciones"
        );
    }

    docs.summary.expired.forEach(item => add(
        3,
        "Doc. vencido",
        `${item.label}: vencido`,
        `Venció el ${formatDate(item.doc.expiresAt)}. Sube el documento renovado para dejar la carpeta al día.`,
        "documentos",
        `${equipment.id}:doc:${item.id}`
    ));

    metrics.recurrent.forEach(group => add(
        2,
        "Falla recurrente",
        `Falla recurrente: «${group.title}»`,
        `${group.count} veces en 12 meses (${group.dates.map(formatDayMonth).join(", ")}). Conviene escalarla con el proveedor.`,
        "fallas",
        `${equipment.id}:recurrent:${normalizeTitleKey(group.title)}`
    ));

    const loose = metrics.open.filter(failure =>
        !(failure.maintenance && maintenanceState(failure.maintenance, now) === "ongoing")
    );

    if (loose.length) {
        const oldest = loose.reduce((a, b) => (a.date <= b.date ? a : b));
        const label = plural(loose.length, "falla abierta", "fallas abiertas");
        const age = daysBetween(oldest.date, today);

        add(
            2,
            label,
            label,
            `${loose.length > 1 ? "La más antigua, " : ""}«${oldest.title}»${loose.length > 1 ? "," : ""} lleva ${plural(age, "día", "días")} sin cerrarse.`,
            "fallas",
            `${equipment.id}:open`
        );
    }

    if (contract) {
        const provider = contract.provider || "del proveedor";

        if (!isISODate(contract.endDate)) {
            add(
                1,
                "Contrato sin vigencia",
                "Contrato sin fecha de término",
                "Registra hasta cuándo rige el contrato para recibir el aviso de renovación a tiempo.",
                "contrato",
                `contract:${contract.id}:nodate`
            );
        } else {
            const days = daysUntil(contract.endDate, today);
            const covers = plural(contractEquipment.length || 1, "equipo", "equipos");

            if (days < 0) {
                add(
                    3,
                    "Contrato vencido",
                    `Contrato ${provider} vencido hace ${plural(-days, "día", "días")}`,
                    `Terminó el ${formatDate(contract.endDate)} y cubría ${covers}. Registra la renovación o el nuevo contrato.`,
                    "contrato",
                    `contract:${contract.id}`
                );
            } else if (days <= 90) {
                add(
                    days <= 30 ? 3 : 1,
                    `Contrato ${days} d`,
                    `Contrato ${provider} vence en ${plural(days, "día", "días")}`,
                    `Vigente hasta ${formatDate(contract.endDate)} y cubre ${covers}. Tarjeta de renovación en Kanban desde el ${formatDate(renewalCardDate(contract.endDate))}.`,
                    "contrato",
                    `contract:${contract.id}`
                );
            }
        }
    } else {
        const warranty = equipment.warrantyUntil;
        const warrantyDays = daysUntil(warranty, today);

        if (warrantyDays !== null && warrantyDays >= 0) {
            if (warrantyDays <= 90) {
                add(
                    1,
                    `Garantía ${warrantyDays} d`,
                    `La garantía termina en ${plural(warrantyDays, "día", "días")}`,
                    `El ${formatDate(warranty)} el equipo queda sin cobertura si no hay un contrato de mantención.`,
                    "contrato"
                );
            }
        } else {
            add(
                2,
                "Sin contrato",
                "Sin contrato de mantención",
                warrantyDays !== null
                    ? `Desde el ${formatDate(warranty)}, cuando terminó la garantía. Las preventivas no tienen proveedor.`
                    : "No hay contrato registrado: las preventivas y las reparaciones no tienen proveedor ni plazos comprometidos.",
                "contrato"
            );
        }
    }

    docs.summary.expiring.forEach(item => {
        const days = daysUntil(item.doc.expiresAt, today);

        add(
            days <= 30 ? 2 : 1,
            "Doc. por vencer",
            `${item.label}: vence en ${plural(days, "día", "días")}`,
            `Vigente hasta el ${formatDate(item.doc.expiresAt)}. Inicia la renovación con tiempo.`,
            "documentos",
            `${equipment.id}:doc:${item.id}`
        );
    });

    const start12 = addDaysISO(today, -365);

    maintenances
        .filter(record =>
            record.date >= start12 &&
            maintenanceState(record, now) === "done" &&
            !(record.attachments || []).length
        )
        .forEach(record => add(
            1,
            "Sin informe",
            `${MAINTENANCE_TYPE_LABELS[record.type]} del ${formatDate(record.date)} sin informe técnico`,
            "Pide el informe al proveedor: sin él, la mantención no queda respaldada ante una auditoría.",
            "mantenciones",
            `${equipment.id}:report:${record.id}`
        ));

    if (docs.summary.missing.length) {
        const count = docs.summary.missing.length;

        add(
            1,
            `Faltan ${count} doc.`,
            `Faltan ${plural(count, "documento", "documentos")} en la carpeta`,
            docs.summary.missing.map(item => item.label).join(" · "),
            "documentos"
        );
    }

    if (due !== null && due >= 0 && due <= 30) {
        add(
            0,
            `Preventiva ${dueLabel(equipment.nextMaintenanceAt, today)}`,
            `Preventiva ${dueLabel(equipment.nextMaintenanceAt, today)}`,
            `${formatDate(equipment.nextMaintenanceAt)}${equipment.nextMaintenanceConfirmed ? " · confirmada con el proveedor" : " · falta confirmar con el proveedor"}.`,
            "mantenciones"
        );
    }

    return alerts
        .map((alert, index) => ({ alert, index }))
        .sort((a, b) => b.alert.level - a.alert.level || a.index - b.index)
        .map(item => item.alert);
}

/* ---------- foto completa de un equipo ---------- */

export function equipmentSnapshot(equipment, context) {
    const {
        reports = [],
        contracts = [],
        allEquipment = [],
        taskTitles = [],
        today,
        now
    } = context;
    const failures = buildFailures(equipment, reports, now);
    const contract = resolveContract(equipment, contracts);
    const contractEquipment = !contract
        ? []
        : contract.legacy
            ? [equipment]
            : allEquipment.filter(item => item.contractId === contract.id && item.status !== "inactive");
    const metrics = equipmentMetrics(equipment, failures, contract, { today, now });
    const docs = documentChecklist(equipment, today);
    const alerts = equipmentAlerts(equipment, {
        failures,
        metrics,
        contract,
        contractEquipment,
        docs,
        taskTitles,
        today,
        now
    });

    return {
        equipment,
        failures,
        contract,
        contractEquipment,
        metrics,
        docs,
        alerts,
        level: alerts.length ? alerts[0].level : -1
    };
}

/* ---------- la unidad completa ---------- */

function coverageEndsSoon(snapshot, today) {
    const contract = snapshot.contract;

    if (contract) {
        return isISODate(contract.endDate) ? daysUntil(contract.endDate, today) <= 90 : false;
    }

    const warranty = daysUntil(snapshot.equipment.warrantyUntil, today);
    return !(warranty !== null && warranty > 90);
}

function pendingDocuments(snapshot) {
    const summary = snapshot.docs.summary;
    return summary.missing.length + summary.expired.length + summary.expiring.length;
}

function upcomingPreventive(snapshot, today) {
    const days = daysUntil(snapshot.equipment.nextMaintenanceAt, today);
    return days !== null && days >= 0 && days <= 30;
}

export function unitKpis(snapshots, today) {
    const active = snapshots.filter(item => item.equipment.status !== "inactive");
    const count = test => active.filter(test).length;

    return [
        {
            id: "available",
            label: "Disponibles hoy",
            value: count(item => item.equipment.status !== "maintenance"),
            of: active.length,
            tone: "ok",
            match: item => item.equipment.status !== "maintenance"
        },
        {
            id: "down",
            label: "Fuera de servicio",
            value: count(item => item.equipment.status === "maintenance"),
            tone: "danger",
            match: item => item.equipment.status === "maintenance"
        },
        {
            id: "overdue",
            label: "Preventivas vencidas",
            value: count(item => daysUntil(item.equipment.nextMaintenanceAt, today) < 0),
            tone: "danger",
            match: item => daysUntil(item.equipment.nextMaintenanceAt, today) < 0
        },
        {
            id: "upcoming",
            label: "Preventivas en 30 días",
            value: count(item => upcomingPreventive(item, today)),
            tone: "notice",
            match: item => upcomingPreventive(item, today)
        },
        {
            id: "failures",
            label: "Fallas abiertas",
            value: active.reduce((sum, item) => sum + item.metrics.open.length, 0),
            tone: "warn",
            match: item => item.metrics.open.length > 0
        },
        {
            id: "coverage",
            label: "Equipos sin cobertura en 90 días",
            value: count(item => coverageEndsSoon(item, today)),
            tone: "warn",
            match: item => coverageEndsSoon(item, today)
        },
        {
            id: "documents",
            label: "Documentos por regularizar",
            value: active.reduce((sum, item) => sum + pendingDocuments(item), 0),
            tone: "warn",
            match: item => pendingDocuments(item) > 0
        }
    ];
}

// Un contrato que cubre tres equipos es UN pendiente, no tres.
export function unitQueue(snapshots) {
    const seen = new Set();

    return snapshots
        .filter(item => item.equipment.status !== "inactive")
        .flatMap(item => item.alerts)
        .filter(alert => alert.level >= 1 && !seen.has(alert.key) && seen.add(alert.key))
        .sort((a, b) => b.level - a.level);
}

export function monthlyFailureCounts(snapshots, today) {
    const [year, month] = today.split("-").map(Number);
    const months = [];

    for (let offset = 11; offset >= 0; offset -= 1) {
        const date = new Date(year, month - 1 - offset, 1);
        months.push(`${date.getFullYear()}-${pad(date.getMonth() + 1)}`);
    }

    return months.map(key => {
        const list = snapshots.flatMap(item =>
            item.failures
                .filter(failure => failure.date.startsWith(key))
                .map(failure => ({ ...failure, equipmentName: item.equipment.name }))
        );

        return {
            month: key,
            count: list.length,
            open: list.filter(isOpenFailure).length,
            equipmentNames: [...new Set(list.map(failure => failure.equipmentName))]
        };
    });
}

/* ---------- hoja de vida ---------- */

export function lifeEvents(snapshot, { now }) {
    const { equipment, failures, contract, docs } = snapshot;
    const events = [];
    const push = (date, type, title, detail = "") => {
        if (isISODate(String(date || "").slice(0, 10))) {
            events.push({ date: String(date).slice(0, 10), type, title, detail });
        }
    };

    failures.forEach(failure => push(
        failure.date,
        "failure",
        `Falla informada: ${failure.title}`,
        `Gravedad ${SEVERITY_LABELS[failure.severity].toLowerCase()} · ${failure.reportedByName} vía ${failure.channel} · ${FAILURE_STATUS[failure.status].label.toLowerCase()}`
    ));

    (equipment.maintenances || []).forEach(record => {
        const state = maintenanceState(record, now);
        if (state === "scheduled") return;

        const label = MAINTENANCE_TYPE_LABELS[record.type];
        const hours = maintenanceHours(record, now);
        const report = (record.attachments || []).length
            ? " · informe adjunto"
            : state === "ongoing" ? "" : " · sin informe técnico";

        push(
            record.date,
            "maintenance",
            `${label}${state === "ongoing" ? " en curso" : ""}: ${record.summary || label}`,
            `${record.provider || "Sin proveedor"}${record.technician ? ` · ${record.technician}` : ""} · ${formatDuration(hours)} fuera de servicio${report}`
        );
    });

    const typed = docs.groups.flatMap(group => group.items);

    typed.forEach(item => item.versions.forEach(doc => push(
        doc.addedAt,
        "document",
        `Documento: ${item.label}`,
        doc.name
    )));
    docs.others.forEach(doc => push(doc.addedAt, "document", "Documento adjunto", doc.name));

    if (equipment.purchaseDate) push(equipment.purchaseDate, "milestone", "Compra del equipo");
    if (equipment.installedAt) push(equipment.installedAt, "milestone", "Instalación y puesta en marcha");
    if (equipment.warrantyUntil && equipment.warrantyUntil <= now.slice(0, 10)) {
        push(equipment.warrantyUntil, "milestone", "Termina la garantía del fabricante");
    }

    if (contract && !contract.legacy) {
        push(
            contract.startDate,
            "milestone",
            `Inicia contrato ${contract.provider}${contract.tenderId ? ` ${contract.tenderId}` : ""}`,
            contract.coverage
        );
        (contract.previous || []).forEach(item => push(
            item.startDate,
            "milestone",
            `Contrato anterior: ${item.provider || "proveedor"}${item.tenderId ? ` ${item.tenderId}` : ""}`,
            `${formatDate(item.startDate)} a ${formatDate(item.endDate)}${item.coverage ? ` · ${item.coverage}` : ""}`
        ));
    }

    (equipment.statusHistory || []).forEach(entry => push(
        entry.date,
        "milestone",
        `Cambio de estado: ${EQUIPMENT_STATUS[entry.status]?.label || entry.status}`,
        [entry.byName, entry.note].filter(Boolean).join(" · ")
    ));

    if (equipment.status === "inactive" && equipment.inactiveAt) {
        push(equipment.inactiveAt, "milestone", "Dado de baja", equipment.inactiveReason);
    }

    push(equipment.createdAt, "milestone", "Registrado en TurnoPlus");

    return events.sort((a, b) => b.date.localeCompare(a.date));
}
