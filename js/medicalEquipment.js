import { escapeHTML } from "./htmlUtils.js";
import { getJSON, setJSON } from "./persistence.js";
import {
    ATTACHMENT_ACCEPT,
    attachmentStorageErrorMessage,
    deleteStoredAttachment,
    hasAttachmentContent,
    openAttachmentFile,
    readAttachmentFiles,
    resolveAttachmentURL
} from "./attachmentUtils.js";
import {
    getCurrentFirebaseUser,
    getFirebaseServices,
    isFirebaseConfigured
} from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";
import { canEditMenu } from "./workspacePermissions.js";
import { showAlert, showConfirm } from "./dialogs.js";
import {
    CRITICALITY_LABELS,
    EQUIPMENT_STATUS,
    FAILURE_STATUS,
    LEVEL_TONES,
    MAINTENANCE_TYPE_LABELS,
    MONTHS_SHORT,
    SEVERITY_LABELS,
    addDaysISO,
    addMonthsISO,
    ageLabel,
    agoLabel,
    daysBetween,
    daysUntil,
    documentTypeLabel,
    documentTypeOptions,
    dueLabel,
    equipmentSnapshot,
    formatDate,
    formatDayMonth,
    formatDuration,
    formatPercent,
    formatTime,
    frequencyLabel,
    isOpenFailure,
    lifeEvents,
    localISODate,
    localISODateTime,
    maintenanceHours,
    maintenanceState,
    monthlyFailureCounts,
    parseDateTime,
    plannedMaintenanceHours,
    plural,
    renewalCardDate,
    toLocalDateTime,
    unitKpis,
    unitQueue
} from "./medicalEquipmentInsights.js";
import {
    SEVERITY_TONES,
    failureHistoryPrintHTML,
    isPrintableImage,
    lifeSheetPrintHTML,
    printDocument,
    unitReportPrintHTML
} from "./medicalEquipmentPrint.js";

export const MEDICAL_EQUIPMENT_KEY = "medicalEquipment";
export const MEDICAL_EQUIPMENT_CONTRACTS_KEY = "medicalEquipmentContracts";
const PUBLISHED_DOC_ID = "medicalEquipment";
const TASKS_KEY = "weekly_task_assignment_tasks";
const REPORTS_COLLECTION = "medicalEquipmentReports";
const MAX_EQUIPMENT = 300;
const MAX_CONTRACTS = 200;
const MAX_TEXT = 240;
const MAX_LONG_TEXT = 3000;

const STATUS_IDS = ["operational", "limited", "maintenance", "inactive"];
const MAINTENANCE_TYPE_IDS = ["preventive", "corrective", "calibration", "inspection"];
const FAILURE_STATUS_IDS = ["open", "review", "resolved", "dismissed"];
const SEVERITY_IDS = ["low", "medium", "high", "critical"];
const CRITICALITY_IDS = ["critical", "relevant", "support"];

let reports = [];
let reportsLoading = false;
let reportsError = "";
let unsubscribeReports = null;
let currentReportWorkspaceId = "";
let lastPublishedSignature = "";

function clampText(value, maxLength = MAX_TEXT) {
    return String(value || "").trim().slice(0, maxLength);
}

function escapeAttribute(value) {
    return escapeHTML(value).replace(/`/g, "&#096;");
}

function makeId(prefix = "equipment") {
    return globalThis.crypto?.randomUUID?.() ||
        `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeId(value, fallbackPrefix = "item") {
    return String(value || "")
        .trim()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 90) || makeId(fallbackPrefix);
}

function todayISO() {
    return localISODate();
}

function isoDate(value) {
    const clean = clampText(value, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : "";
}

function isoDateTime(value) {
    const clean = clampText(value, 30);
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(clean) ? clean : "";
}

function timeFromISODateTime(value) {
    const clean = isoDateTime(value);

    return clean ? clean.slice(11, 16) : "";
}

function formatDateForSentence(iso) {
    const clean = isoDate(iso);
    if (!clean) return String(iso || "");

    return `${clean.slice(8, 10)}/${clean.slice(5, 7)}/${clean.slice(0, 4)}`;
}

function pick(options, value, fallback) {
    const clean = String(value || "").trim();
    return options.includes(clean) ? clean : fallback;
}

function bounded(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
}

function normalizeIdList(value = [], max = 40) {
    return [...new Set(
        (Array.isArray(value) ? value : [])
            .map(item => String(item || "").trim())
            .filter(Boolean)
    )].slice(0, max);
}

function currentUserName() {
    const user = getCurrentFirebaseUser();
    return clampText(user?.displayName || user?.email || "Supervisor", 120);
}

/* ---------- normalizacion ---------- */

function normalizeAttachment(attachment = {}) {
    const name = clampText(attachment.name, 240);
    const dataUrl = String(attachment.dataUrl || "");
    const storagePath = String(attachment.storagePath || "");
    const downloadURL = String(attachment.downloadURL || "");

    if (!name || (!dataUrl && !storagePath && !downloadURL)) return null;

    const normalized = {
        id: String(attachment.id || makeId("equipment_file")),
        name,
        type: String(attachment.type || "application/octet-stream").toLowerCase(),
        size: Number(attachment.size) || 0,
        addedAt: String(attachment.addedAt || new Date().toISOString()),
        storagePath,
        downloadURL,
        dataUrl,
        uploadedByUid: String(attachment.uploadedByUid || "")
    };
    // Solo los documentos de la carpeta llevan tipo y vencimiento.
    const docType = clampText(attachment.docType, 60);
    const expiresAt = isoDate(attachment.expiresAt);

    if (docType) normalized.docType = docType;
    if (expiresAt) normalized.expiresAt = expiresAt;

    return normalized;
}

function normalizeAttachments(value = []) {
    return (Array.isArray(value) ? value : [])
        .map(normalizeAttachment)
        .filter(Boolean)
        .slice(0, 80);
}

function normalizeContact(contact = {}) {
    const name = clampText(contact.name);
    const phone = clampText(contact.phone, 80);
    const email = clampText(contact.email, 180);

    if (!name && !phone && !email) return null;

    return {
        id: String(contact.id || makeId("equipment_contact")),
        name: name || "Contacto",
        role: clampText(contact.role, 120),
        phone,
        email,
        notes: clampText(contact.notes, 800)
    };
}

function normalizeContacts(value = [], max = 60) {
    return (Array.isArray(value) ? value : [])
        .map(normalizeContact)
        .filter(Boolean)
        .slice(0, max);
}

function normalizeMaintenance(item = {}) {
    const startAt = isoDateTime(item.startAt);
    const endAt = isoDateTime(item.endAt);
    const date = isoDate(item.date) || startAt.slice(0, 10) || todayISO();
    const taskIds = normalizeIdList(item.taskIds, 80);

    return {
        id: String(item.id || makeId("equipment_maintenance")),
        type: pick(MAINTENANCE_TYPE_IDS, item.type, "preventive"),
        date,
        nextDate: isoDate(item.nextDate),
        startAt,
        endAt,
        provider: clampText(item.provider, 180),
        technician: clampText(item.technician, 180),
        summary: clampText(item.summary, MAX_LONG_TEXT),
        recommendations: clampText(item.recommendations, MAX_LONG_TEXT),
        taskIds,
        downtime: Boolean(item.downtime || taskIds.length || item.startAt || item.endAt),
        attachments: normalizeAttachments(item.attachments),
        // Las fallas (de la PWA o de supervision) que esta mantencion cerro.
        resolvesFailureIds: normalizeIdList(item.resolvesFailureIds),
        // Una mantencion programada: si ya se confirmo con el proveedor.
        confirmed: Boolean(item.confirmed),
        createdAt: String(item.createdAt || new Date().toISOString())
    };
}

function normalizeManualError(item = {}) {
    const title = clampText(item.title || "Error informado", 160);
    const detail = clampText(item.detail || item.summary, MAX_LONG_TEXT);

    if (!title && !detail) return null;

    return {
        id: String(item.id || makeId("equipment_error")),
        firestore: false,
        title,
        detail,
        status: pick(FAILURE_STATUS_IDS, item.status, "open"),
        severity: pick(SEVERITY_IDS, item.severity, "medium"),
        date: isoDate(item.date) || todayISO(),
        reportedByName: clampText(item.reportedByName || "Supervisor", 180),
        source: String(item.source || "supervisor"),
        attachments: normalizeAttachments(item.attachments),
        note: clampText(item.note, 1000),
        outOfService: Boolean(item.outOfService),
        createdAt: String(item.createdAt || new Date().toISOString()),
        resolvedAt: String(item.resolvedAt || "")
    };
}

function normalizeStatusEntry(entry = {}) {
    return {
        date: isoDate(entry.date) || todayISO(),
        status: pick(STATUS_IDS, entry.status, "operational"),
        byName: clampText(entry.byName, 120),
        note: clampText(entry.note, 300)
    };
}

export function normalizeMedicalEquipmentItem(item = {}) {
    const id = normalizeId(item.id || item.code, "equipment");
    const createdAt = String(item.createdAt || new Date().toISOString());
    const maintenances = (Array.isArray(item.maintenances) ? item.maintenances : [])
        .map(normalizeMaintenance)
        .filter(Boolean)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const errors = (Array.isArray(item.errors) ? item.errors : [])
        .map(normalizeManualError)
        .filter(Boolean)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return {
        id,
        name: clampText(item.name || "Equipo medico", 180),
        equipmentType: clampText(item.equipmentType, 120),
        code: clampText(item.code, 120),
        brand: clampText(item.brand, 120),
        model: clampText(item.model, 120),
        serialNumber: clampText(item.serialNumber, 120),
        location: clampText(item.location, 180),
        criticality: pick(CRITICALITY_IDS, item.criticality, ""),
        // null = todavia no se sabe: decide que documentos pide la carpeta.
        ionizing: item.ionizing === true ? true : item.ionizing === false ? false : null,
        details: clampText(item.details, MAX_LONG_TEXT),
        status: pick(STATUS_IDS, item.status, "operational"),
        downSince: isoDate(item.downSince),
        inactiveAt: isoDate(item.inactiveAt),
        inactiveReason: clampText(item.inactiveReason, 300),
        serviceActive: Boolean(item.serviceActive),
        serviceProvider: clampText(item.serviceProvider, 180),
        serviceUntil: isoDate(item.serviceUntil),
        contractId: clampText(item.contractId, 120),
        purchaseDate: isoDate(item.purchaseDate),
        installedAt: isoDate(item.installedAt),
        warrantyUntil: isoDate(item.warrantyUntil),
        usefulLifeYears: Math.round(bounded(item.usefulLifeYears, 0, 40)),
        nextMaintenanceAt: isoDate(item.nextMaintenanceAt),
        nextMaintenanceConfirmed: Boolean(item.nextMaintenanceConfirmed),
        maintenanceFrequencyDays: Math.round(bounded(item.maintenanceFrequencyDays, 0, 3650)),
        manufacturerRecommendations: clampText(item.manufacturerRecommendations, MAX_LONG_TEXT),
        taskIds: normalizeIdList(item.taskIds, 80),
        contacts: normalizeContacts(item.contacts),
        documents: normalizeAttachments(item.documents),
        documentsNotApplicable: normalizeIdList(item.documentsNotApplicable, 30),
        contractAttachments: normalizeAttachments(item.contractAttachments),
        statusHistory: (Array.isArray(item.statusHistory) ? item.statusHistory : [])
            .map(normalizeStatusEntry)
            .slice(-120),
        maintenances,
        errors,
        createdAt,
        updatedAt: String(item.updatedAt || createdAt),
        createdByUid: String(item.createdByUid || ""),
        updatedByUid: String(item.updatedByUid || "")
    };
}

export function normalizeMedicalEquipment(value = []) {
    return (Array.isArray(value) ? value : [])
        .map(normalizeMedicalEquipmentItem)
        .filter(item => item.name || item.code)
        .sort((a, b) => a.name.localeCompare(b.name, "es"))
        .slice(0, MAX_EQUIPMENT);
}

function normalizeContractPeriod(item = {}) {
    return {
        id: String(item.id || makeId("contract_period")),
        provider: clampText(item.provider, 180),
        tenderId: clampText(item.tenderId, 120),
        coverage: clampText(item.coverage, 240),
        startDate: isoDate(item.startDate),
        endDate: isoDate(item.endDate),
        amount: clampText(item.amount, 120),
        attachments: normalizeAttachments(item.attachments)
    };
}

export function normalizeMedicalEquipmentContract(item = {}) {
    const createdAt = String(item.createdAt || new Date().toISOString());

    return {
        id: normalizeId(item.id, "contract"),
        provider: clampText(item.provider, 180),
        tenderId: clampText(item.tenderId, 120),
        coverage: clampText(item.coverage, 240),
        startDate: isoDate(item.startDate),
        endDate: isoDate(item.endDate),
        amount: clampText(item.amount, 120),
        responseHours: Math.round(bounded(item.responseHours, 0, 720)),
        preventivesPerYear: Math.round(bounded(item.preventivesPerYear, 0, 52)),
        guaranteedAvailability: bounded(item.guaranteedAvailability, 0, 100),
        exclusions: clampText(item.exclusions, 1000),
        administrator: clampText(item.administrator, 180),
        contacts: normalizeContacts(item.contacts, 30),
        attachments: normalizeAttachments(item.attachments),
        previous: (Array.isArray(item.previous) ? item.previous : [])
            .map(normalizeContractPeriod)
            .slice(0, 20),
        createdAt,
        updatedAt: String(item.updatedAt || createdAt)
    };
}

export function normalizeMedicalEquipmentContracts(value = []) {
    const seen = new Set();

    return (Array.isArray(value) ? value : [])
        .map(normalizeMedicalEquipmentContract)
        .filter(item => !seen.has(item.id) && seen.add(item.id))
        .slice(0, MAX_CONTRACTS);
}

export function getMedicalEquipment() {
    return normalizeMedicalEquipment(getJSON(MEDICAL_EQUIPMENT_KEY, []));
}

export function getMedicalEquipmentContracts() {
    return normalizeMedicalEquipmentContracts(getJSON(MEDICAL_EQUIPMENT_CONTRACTS_KEY, []));
}

function getTaskCatalog() {
    const tasks = getJSON(TASKS_KEY, []);

    return (Array.isArray(tasks) ? tasks : [])
        .map(task => ({
            id: String(task?.id || "").trim(),
            title: clampText(task?.title, 160)
        }))
        .filter(task => task.id && task.title)
        .sort((a, b) => a.title.localeCompare(b.title, "es"));
}

function taskTitle(taskId, tasks = getTaskCatalog()) {
    return tasks.find(task => task.id === taskId)?.title || taskId;
}

/* ---------- publicacion a la PWA ---------- */

function publicEquipmentPayload(items = getMedicalEquipment()) {
    const tasks = getTaskCatalog();

    return normalizeMedicalEquipment(items)
        .filter(item => item.status !== "inactive")
        .map(item => ({
            id: item.id,
            name: item.name,
            code: item.code,
            brand: item.brand,
            model: item.model,
            location: item.location,
            status: item.status,
            nextMaintenanceAt: item.nextMaintenanceAt,
            taskIds: item.taskIds,
            taskTitles: item.taskIds
                .map(taskId => taskTitle(taskId, tasks))
                .filter(Boolean)
        }));
}

export async function publishMedicalEquipmentToWorkers(items = getMedicalEquipment()) {
    const workspace = getActiveWorkspace();

    if (!isFirebaseConfigured() || !workspace?.id) return false;

    const payload = publicEquipmentPayload(items);
    const signature = `${workspace.id}:${JSON.stringify(payload)}`;

    // Una nota, un documento o una mantencion no cambian lo que ve el
    // trabajador: no se reescribe el documento publicado por eso.
    if (signature === lastPublishedSignature) return false;

    const { db, firestoreModule } = await getFirebaseServices();
    const now = new Date().toISOString();
    const ref = firestoreModule.doc(
        db,
        "workspaces",
        workspace.id,
        "published",
        PUBLISHED_DOC_ID
    );

    await firestoreModule.setDoc(ref, {
        workspaceId: workspace.id,
        workspaceName: workspace.name || "",
        items: payload,
        updatedAt: typeof firestoreModule.serverTimestamp === "function"
            ? firestoreModule.serverTimestamp()
            : now,
        updatedAtISO: now,
        updatedByUid: getCurrentFirebaseUser()?.uid || ""
    }, { merge: true });

    lastPublishedSignature = signature;

    return true;
}

function dispatchMedicalEquipmentChanged() {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("proturnos:medicalEquipmentChanged"));
}

function saveMedicalEquipment(items, options = {}) {
    const normalized = normalizeMedicalEquipment(items);

    setJSON(MEDICAL_EQUIPMENT_KEY, normalized);
    dispatchMedicalEquipmentChanged();

    if (options.publish !== false) {
        publishMedicalEquipmentToWorkers(normalized).catch(error => {
            console.warn("No se pudo publicar equipos medicos a la PWA.", error);
        });
    }

    return normalized;
}

function saveContracts(contracts) {
    const normalized = normalizeMedicalEquipmentContracts(contracts);

    setJSON(MEDICAL_EQUIPMENT_CONTRACTS_KEY, normalized);

    return normalized;
}

function stamp(item) {
    return {
        ...item,
        updatedAt: new Date().toISOString(),
        updatedByUid: getCurrentFirebaseUser()?.uid || ""
    };
}

function upsertEquipment(item) {
    const current = getMedicalEquipment();
    const normalized = normalizeMedicalEquipmentItem(stamp(item));
    const exists = current.some(entry => entry.id === normalized.id);
    const next = exists
        ? current.map(entry => entry.id === normalized.id ? normalized : entry)
        : [...current, normalized];

    return saveMedicalEquipment(next);
}

function updateEquipment(id, updater) {
    const items = getMedicalEquipment();
    const index = items.findIndex(item => item.id === id);

    if (index < 0) return items;

    const next = [...items];
    next[index] = normalizeMedicalEquipmentItem(stamp(updater(next[index])));

    return saveMedicalEquipment(next);
}

function removeEquipment(id) {
    return saveMedicalEquipment(
        getMedicalEquipment().filter(item => item.id !== id)
    );
}

// El contrato vive aparte, pero cada equipo sigue guardando proveedor y
// vigencia: de ahi leen la tarjeta de renovacion del Kanban y el calendario.
function linkContract(equipment, contract) {
    if (!contract) {
        return {
            ...equipment,
            contractId: "",
            serviceActive: false,
            serviceProvider: "",
            serviceUntil: ""
        };
    }

    return {
        ...equipment,
        contractId: contract.id,
        serviceActive: !contract.endDate || contract.endDate >= todayISO(),
        serviceProvider: contract.provider,
        serviceUntil: contract.endDate
    };
}

function saveContract(contract, equipmentIds = null) {
    const normalized = normalizeMedicalEquipmentContract({
        ...contract,
        updatedAt: new Date().toISOString()
    });
    const contracts = getMedicalEquipmentContracts();
    const exists = contracts.some(item => item.id === normalized.id);

    saveContracts(exists
        ? contracts.map(item => item.id === normalized.id ? normalized : item)
        : [...contracts, normalized]);

    const ids = equipmentIds ? new Set(equipmentIds) : null;
    const items = getMedicalEquipment().map(item => {
        const linked = item.contractId === normalized.id;

        if (ids ? ids.has(item.id) : linked) {
            return normalizeMedicalEquipmentItem(stamp(linkContract(item, normalized)));
        }

        if (ids && linked) {
            return normalizeMedicalEquipmentItem(stamp(linkContract(item, null)));
        }

        return item;
    });

    saveMedicalEquipment(items);

    return normalized;
}

/* ---------- reportes de falla que llegan desde la PWA ---------- */

function normalizeWorkerReport(id, data = {}) {
    const equipmentId = String(data.equipmentId || "");
    const title = clampText(data.title || "Falla informada", 160);

    if (!equipmentId || !title) return null;

    return {
        id: String(data.id || id),
        firestore: true,
        equipmentId,
        equipmentName: clampText(data.equipmentName, 180),
        equipmentCode: clampText(data.equipmentCode, 120),
        title,
        detail: clampText(data.detail || data.note, MAX_LONG_TEXT),
        status: pick(FAILURE_STATUS_IDS, data.status, "open"),
        severity: pick(SEVERITY_IDS, data.severity, "medium"),
        date: isoDate(data.date) || String(data.createdAtISO || "").slice(0, 10),
        reportedByName: clampText(data.reportedByName || data.worker || data.profileName, 180),
        workerRut: clampText(data.workerRut || data.profileRut, 80),
        createdByUid: String(data.createdByUid || ""),
        createdAt: String(data.createdAtISO || data.createdAt || new Date().toISOString()),
        updatedAt: String(data.updatedAtISO || ""),
        resolvedAt: String(data.resolvedAt || ""),
        supervisorNote: clampText(data.supervisorNote, 1000),
        attachments: normalizeAttachments(data.attachments || data.documents)
    };
}

async function updateReportFields(reportId, fields) {
    const workspace = getActiveWorkspace();

    if (!isFirebaseConfigured() || !workspace?.id || !reportId) {
        throw new Error("No hay conexión con la unidad para actualizar el reporte.");
    }

    const { db, firestoreModule } = await getFirebaseServices();

    await firestoreModule.updateDoc(
        firestoreModule.doc(db, "workspaces", workspace.id, REPORTS_COLLECTION, reportId),
        {
            ...fields,
            updatedAt: firestoreModule.serverTimestamp(),
            updatedAtISO: new Date().toISOString()
        }
    );

    // Se refleja de inmediato; la escucha de Firestore lo confirma despues.
    reports = reports.map(report => report.id === reportId ? { ...report, ...fields } : report);
}

// Cambia una falla sin importar de donde vino: la de la PWA vive en Firestore
// y la de supervision dentro del equipo.
async function updateFailure(equipmentId, failureId, fields) {
    const report = reports.find(item => item.id === failureId && item.equipmentId === equipmentId);

    if (report) {
        const remote = { ...fields };

        if ("note" in remote) {
            remote.supervisorNote = remote.note;
            delete remote.note;
        }

        await updateReportFields(failureId, remote);
        return;
    }

    updateEquipment(equipmentId, equipment => ({
        ...equipment,
        errors: equipment.errors.map(error => error.id === failureId ? { ...error, ...fields } : error)
    }));
}

export async function startMedicalEquipmentReportSync(workspace = getActiveWorkspace(), options = {}) {
    if (
        workspace?.id &&
        currentReportWorkspaceId === workspace.id &&
        typeof unsubscribeReports === "function"
    ) {
        return unsubscribeReports;
    }

    stopMedicalEquipmentReportSync();

    if (!isFirebaseConfigured() || !workspace?.id) {
        reports = [];
        currentReportWorkspaceId = "";
        options.onChange?.();
        return () => {};
    }

    currentReportWorkspaceId = workspace.id;
    reportsLoading = true;
    reportsError = "";
    options.onChange?.();

    try {
        const { db, firestoreModule } = await getFirebaseServices();
        const collectionRef = firestoreModule.collection(
            db,
            "workspaces",
            workspace.id,
            REPORTS_COLLECTION
        );

        unsubscribeReports = firestoreModule.onSnapshot(
            collectionRef,
            snap => {
                if (currentReportWorkspaceId !== workspace.id) return;

                reports = snap.docs
                    .map(docSnap => normalizeWorkerReport(docSnap.id, docSnap.data()))
                    .filter(Boolean)
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
                reportsLoading = false;
                reportsError = "";
                options.onChange?.();
            },
            error => {
                if (currentReportWorkspaceId !== workspace.id) return;

                reports = [];
                reportsLoading = false;
                reportsError = error?.message || "No se pudieron leer reportes.";
                options.onChange?.();
            }
        );
    } catch (error) {
        reports = [];
        reportsLoading = false;
        reportsError = error?.message || "No se pudo iniciar la escucha.";
        options.onChange?.();
    }

    return unsubscribeReports;
}

export function stopMedicalEquipmentReportSync() {
    if (typeof unsubscribeReports === "function") {
        unsubscribeReports();
    }

    unsubscribeReports = null;
    currentReportWorkspaceId = "";
    reportsLoading = false;
}

/* ---------- lo que otros menus leen de los equipos ---------- */

export function medicalEquipmentOutagesForRange(startISO, endISO) {
    const start = String(startISO || "");
    const end = String(endISO || start);
    const now = localISODateTime();
    const items = [];

    getMedicalEquipment().forEach(equipment => {
        let hasOngoing = false;

        equipment.maintenances.forEach(record => {
            const ongoing = maintenanceState(record, now) === "ongoing";
            const openEnded = ongoing && !record.endAt;
            const from = String(record.startAt || record.date || "").slice(0, 10);
            // Una mantencion en curso sin termino bloquea hasta que alguien
            // la cierre, no solo el dia en que empezo.
            const to = openEnded
                ? end
                : String(record.endAt || record.date || from).slice(0, 10);

            if (ongoing) hasOngoing = true;
            if (!from || !to || to < start || from > end) return;
            if (!record.taskIds.length && !equipment.taskIds.length) return;

            items.push({
                id: `${equipment.id}:${record.id}`,
                equipmentId: equipment.id,
                equipmentName: equipment.name,
                maintenanceId: record.id,
                type: record.type,
                date: record.date,
                startAt: record.startAt,
                endAt: openEnded ? end : record.endAt,
                taskIds: record.taskIds.length ? record.taskIds : equipment.taskIds,
                summary: record.summary
            });
        });

        // Fuera de servicio sin reparacion registrada: igual deja sus tareas
        // inactivas desde el dia en que se detuvo.
        if (equipment.status === "maintenance" && !hasOngoing && equipment.taskIds.length) {
            const from = equipment.downSince || todayISO();

            if (from <= end) {
                items.push({
                    id: `${equipment.id}:out-of-service`,
                    equipmentId: equipment.id,
                    equipmentName: equipment.name,
                    maintenanceId: "",
                    type: "outOfService",
                    date: from,
                    startAt: from,
                    endAt: end,
                    taskIds: equipment.taskIds,
                    summary: "Fuera de servicio"
                });
            }
        }
    });

    return items;
}

function equipmentCalendarDetail(equipment, extra = "") {
    const details = [
        equipment.code ? `Código ${equipment.code}` : "",
        equipment.location || "",
        extra
    ].filter(Boolean);

    return details.join(" · ");
}

function dateRangeBetween(fromISO, toISO, startISO, endISO) {
    const from = fromISO < startISO ? startISO : fromISO;
    const to = toISO > endISO ? endISO : toISO;
    const dates = [];

    if (!from || !to || to < from) return dates;

    let cursor = from;
    let guard = 0;

    while (cursor && cursor <= to && guard < 370) {
        dates.push(cursor);
        cursor = addDaysISO(cursor, 1);
        guard += 1;
    }

    return dates;
}

function maintenanceTimeLabel(record) {
    const start = timeFromISODateTime(record.startAt);
    const end = timeFromISODateTime(record.endAt);

    if (start && end && start !== end) return `${start}-${end}`;
    if (start) return start;

    return "Mant.";
}

function pushMedicalCalendarEvent(events, event) {
    if (!event.date) return;

    events.push({
        source: "medicalEquipment",
        readOnly: true,
        repeat: "Equipos Médicos",
        alert: "Sin alerta",
        visibility: "medicalEquipment",
        ...event
    });
}

export function medicalEquipmentCalendarEventsForRange(
    startISO,
    endISO,
    equipmentItems = getMedicalEquipment()
) {
    const start = isoDate(startISO);
    const end = isoDate(endISO) || start;
    const events = [];

    if (!start || !end) return events;

    normalizeMedicalEquipment(equipmentItems).forEach(equipment => {
        const maintenanceDates = new Set();

        equipment.maintenances.forEach(record => {
            const from =
                isoDate(String(record.startAt || "").slice(0, 10)) ||
                record.date;
            const to =
                isoDate(String(record.endAt || "").slice(0, 10)) ||
                from;
            const typeLabel = MAINTENANCE_TYPE_LABELS[record.type] || "Mantenimiento";
            const dates = dateRangeBetween(from, to, start, end);

            dateRangeBetween(from, to, from, to).forEach(date => {
                maintenanceDates.add(date);
            });

            dates.forEach(date => {
                pushMedicalCalendarEvent(events, {
                    id: `${equipment.id}:${record.id}:${date}`,
                    kind: "maintenance",
                    tone: "maintenance",
                    equipmentId: equipment.id,
                    maintenanceId: record.id,
                    date,
                    time: maintenanceTimeLabel(record),
                    sortTime: timeFromISODateTime(record.startAt) || "08:00",
                    name: `${typeLabel} · ${equipment.name}`,
                    detail: equipmentCalendarDetail(
                        equipment,
                        record.provider || record.summary
                    )
                });
            });
        });

        if (
            equipment.nextMaintenanceAt &&
            !maintenanceDates.has(equipment.nextMaintenanceAt) &&
            equipment.nextMaintenanceAt >= start &&
            equipment.nextMaintenanceAt <= end
        ) {
            pushMedicalCalendarEvent(events, {
                id: `${equipment.id}:next-maintenance:${equipment.nextMaintenanceAt}`,
                kind: "nextMaintenance",
                tone: "next",
                equipmentId: equipment.id,
                date: equipment.nextMaintenanceAt,
                time: "Prox.",
                sortTime: "08:00",
                name: `Próximo mantenimiento · ${equipment.name}`,
                detail: equipmentCalendarDetail(
                    equipment,
                    equipment.serviceProvider
                )
            });
        }

        if (
            equipment.serviceUntil &&
            equipment.serviceUntil >= start &&
            equipment.serviceUntil <= end
        ) {
            pushMedicalCalendarEvent(events, {
                id: `${equipment.id}:service-until:${equipment.serviceUntil}`,
                kind: "serviceUntil",
                tone: "service",
                equipmentId: equipment.id,
                date: equipment.serviceUntil,
                time: "Vig.",
                sortTime: "17:00",
                name: `Vence servicio técnico · ${equipment.name}`,
                detail: equipmentCalendarDetail(
                    equipment,
                    equipment.serviceProvider
                )
            });
        }
    });

    return events.sort((a, b) =>
        a.date.localeCompare(b.date) ||
        String(a.sortTime || a.time).localeCompare(String(b.sortTime || b.time)) ||
        a.name.localeCompare(b.name, "es")
    );
}

export function medicalEquipmentContractRenewalKanbanCards(
    today = todayISO(),
    equipmentItems = getMedicalEquipment()
) {
    const baseDate = isoDate(today) || todayISO();
    const warningLimit = addMonthsISO(baseDate, 3);

    if (!warningLimit) return [];

    return normalizeMedicalEquipment(equipmentItems)
        .filter(equipment =>
            equipment.status !== "inactive" &&
            equipment.serviceUntil &&
            equipment.serviceUntil <= warningLimit
        )
        .sort((a, b) =>
            a.serviceUntil.localeCompare(b.serviceUntil) ||
            a.name.localeCompare(b.name, "es")
        )
        .map(equipment => ({
            id: `medical_contract_${equipment.id}_${equipment.serviceUntil}`,
            source: "medicalEquipmentRenewal",
            auto: true,
            readOnly: true,
            status: "pending",
            color: "coral",
            equipmentId: equipment.id,
            dueDate: equipment.serviceUntil,
            title: `Renovar contrato de mantenimiento del equipo ${equipment.name}, la vigencia del contrato dura hasta ${formatDateForSentence(equipment.serviceUntil)}`,
            detail: [
                equipment.serviceProvider ? `Servicio técnico: ${equipment.serviceProvider}` : "",
                equipment.code ? `Código: ${equipment.code}` : "",
                equipment.location ? `Ubicación: ${equipment.location}` : ""
            ].filter(Boolean).join("\n"),
            createdAt: `${baseDate}T00:00:00.000Z`,
            updatedAt: `${equipment.serviceUntil}T12:00:00.000Z`
        }));
}

/* ---------- estado de la pantalla ---------- */

const TABS = ["resumen", "fallas", "mantenciones", "contrato", "documentos", "hoja"];

const ui = {
    view: "panel",
    equipmentId: "",
    tab: "resumen",
    search: "",
    kpi: "",
    failures: "open",
    life: "all",
    queueAll: false
};

let lastContext = null;
let panelBound = false;
let busy = false;

export function selectMedicalEquipment(id, tab = "resumen") {
    ui.equipmentId = String(id || "");
    ui.view = ui.equipmentId ? "ficha" : "panel";
    ui.tab = TABS.includes(tab) ? tab : "resumen";
    ui.failures = "open";
    ui.life = "all";
}

/* ---------- iconos, capa flotante y piezas de vista ---------- */

const ICONS = {
    eq: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 10h2l1.5-2.5L13 13l1.5-3H17"/><path d="M9 20h6M12 16v4"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4Z"/><path d="M12 10v4.5M12 17.2v.1"/>',
    wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5a4 4 0 0 0-2-2Z"/><path d="M14.5 6.5 17 4l3 3-2.5 2.5"/>',
    file: '<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    contract: '<path d="M6 3h8l4 4v6"/><path d="M6 3v18h7"/><path d="M9 9h5M9 13h3"/><path d="m15 19 2 2 4-4"/>',
    history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    power: '<path d="M12 3v8"/><path d="M6.3 7a8 8 0 1 0 11.4 0"/>',
    repeat: '<path d="M4 12a7 7 0 0 1 12-5l2 2"/><path d="M18 4v5h-5"/><path d="M20 12a7 7 0 0 1-12 5l-2-2"/><path d="M6 20v-5h5"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>',
    tasks: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/>',
    print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v6H7z"/>',
    trash: '<path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'
};

const SPRITE = `<svg class="meq-sprite" aria-hidden="true" focusable="false">${Object.entries(ICONS)
    .map(([id, body]) => `<symbol id="meq-i-${id}" viewBox="0 0 24 24">${body}</symbol>`)
    .join("")}</svg>`;
const ICON_BY_LEVEL = ["clock", "file", "alert", "alert"];
const TAB_BUTTON = {
    fallas: "Ver fallas",
    mantenciones: "Ver mantenciones",
    contrato: "Ver contrato",
    documentos: "Ver documentos",
    resumen: "Abrir"
};
const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const esc = escapeHTML;
const attr = escapeAttribute;

function ic(name) {
    return `<svg class="meq-i" aria-hidden="true" focusable="false"><use href="#meq-i-${name}"/></svg>`;
}

function calHTML(iso, overdue = false) {
    return `<span class="meq-cal ${overdue ? "is-overdue" : ""}"><b>${Number(iso.slice(8, 10))}</b><small>${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]}</small></span>`;
}

function searchKey(value) {
    return String(value || "")
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase();
}

function ensureLayer() {
    let layer = document.getElementById("meqLayer");
    if (layer) return layer;

    layer = document.createElement("div");
    layer.id = "meqLayer";
    layer.className = "meq meq-layer";
    layer.innerHTML = `${SPRITE}
        <div class="meq-tip" id="meqTip" hidden></div>
        <div class="meq-toast" id="meqToast" role="status" hidden></div>
        <div class="meq-overlay" id="meqOverlay" hidden><div class="meq-dialog" id="meqDialog" role="dialog" aria-modal="true" aria-labelledby="meqDialogTitle"></div></div>`;
    document.body.appendChild(layer);
    bindLayer(layer);

    return layer;
}

let toastTimer = 0;

function toast(message) {
    const element = document.getElementById("meqToast");
    if (!element) return;

    element.textContent = message;
    element.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { element.hidden = true; }, 4200);
}

function buildContext() {
    const today = localISODate();
    const now = localISODateTime();
    const equipment = getMedicalEquipment();
    const contracts = getMedicalEquipmentContracts();
    const tasks = getTaskCatalog();
    const snapshots = equipment.map(item => equipmentSnapshot(item, {
        reports,
        contracts,
        allEquipment: equipment,
        taskTitles: item.taskIds.map(id => taskTitle(id, tasks)),
        today,
        now
    }));

    return {
        today,
        now,
        equipment,
        contracts,
        tasks,
        snapshots,
        byId: new Map(snapshots.map(snapshot => [snapshot.equipment.id, snapshot])),
        canEdit: canEditMenu("medicalEquipment"),
        unitName: getActiveWorkspace()?.name || ""
    };
}

function titlesFor(ids, ctx) {
    return ids.map(id => taskTitle(id, ctx.tasks));
}

function readonlyHTML(ctx) {
    return ctx.canEdit
        ? ""
        : `<div class="meq-readonly">Tu usuario puede revisar este menú, pero no editarlo.</div>`;
}

/* ---------- encabezado e indicadores ---------- */

function pageHeadHTML(ctx) {
    return `<header class="meq-pagehead">
        <div class="meq-pagehead__top">
            <div>
                <span class="meq-kicker">Inventario clínico${ctx.unitName ? ` · ${esc(ctx.unitName)}` : ""}</span>
                <h1>Equipos Médicos</h1>
                <p>La hoja de vida de cada equipo: fallas, mantenciones, contrato y documentos, con lo urgente siempre arriba.</p>
            </div>
            <div class="meq-pagehead__side">
                ${reportsLoading ? `<span class="meq-pill">Cargando fallas de la PWA…</span>` : ""}
                ${reportsError ? `<span class="meq-pill meq-pill--danger" title="${attr(reportsError)}">No se pudieron leer las fallas de la PWA</span>` : ""}
                ${ctx.canEdit ? `<button class="meq-btn meq-btn--primary" type="button" data-meq-act="new">${ic("plus")}Nuevo equipo</button>` : ""}
            </div>
        </div>
        <div class="meq-kpis">${kpisHTML(ctx)}</div>
    </header>`;
}

function kpisHTML(ctx) {
    return unitKpis(ctx.snapshots, ctx.today).map(kpi => `
        <button class="meq-kpi ${ui.kpi === kpi.id ? "is-on" : ""} ${kpi.value ? "" : "is-zero"}" type="button" data-meq-kpi="${kpi.id}" aria-pressed="${ui.kpi === kpi.id}">
            <span class="meq-kpi__row"><span class="meq-dot meq-dot--${kpi.value ? kpi.tone : "muted"}"></span><strong>${kpi.value}${kpi.of ? `<small>/${kpi.of}</small>` : ""}</strong></span>
            <span class="meq-kpi__lbl">${esc(kpi.label)}</span>
        </button>`).join("");
}

/* ---------- lista lateral ---------- */

function eqItemHTML(snapshot) {
    const { equipment } = snapshot;
    const alerts = snapshot.alerts.filter(alert => alert.level >= 1).slice(0, 2);
    const status = EQUIPMENT_STATUS[equipment.status];
    const active = ui.view === "ficha" && ui.equipmentId === equipment.id;
    const meta = [equipment.code, equipment.location].filter(Boolean).join(" · ") || "Sin código";

    return `<button class="meq-eqi ${active ? "is-active" : ""} ${equipment.status === "inactive" ? "is-off" : ""}" type="button" data-meq-eq="${attr(equipment.id)}" ${active ? 'aria-current="true"' : ""}>
        <span class="meq-dot meq-dot--${status.tone}" title="${attr(status.label)}"></span>
        <span class="meq-eqi__main"><strong>${esc(equipment.name)}</strong><small>${esc(meta)}</small></span>
        ${alerts.length ? `<span class="meq-eqi__flags">${alerts.map(alert => `<span class="meq-pill meq-pill--${LEVEL_TONES[alert.level]}">${esc(alert.short)}</span>`).join("")}</span>` : ""}
    </button>`;
}

function railHTML(ctx) {
    return `<label class="meq-search" for="meqSearch">${ic("search")}<input id="meqSearch" type="search" placeholder="Nombre, código, serie o sala" value="${attr(ui.search)}" autocomplete="off" data-meq-search></label>
        <div class="meq-railbody" data-meq-railbody>${railBodyHTML(ctx)}</div>`;
}

function railBodyHTML(ctx) {
    const query = searchKey(ui.search.trim());
    const kpi = ui.kpi ? unitKpis(ctx.snapshots, ctx.today).find(item => item.id === ui.kpi) : null;
    const visible = ctx.snapshots.filter(snapshot => {
        const equipment = snapshot.equipment;
        const text = searchKey([
            equipment.name,
            equipment.code,
            equipment.serialNumber,
            equipment.location,
            equipment.brand,
            equipment.model,
            equipment.equipmentType
        ].join(" "));

        return (!query || text.includes(query)) &&
            (!kpi || (equipment.status !== "inactive" && kpi.match(snapshot)));
    });
    const attention = visible
        .filter(item => item.equipment.status !== "inactive" && item.level >= 2)
        .sort((a, b) => b.level - a.level);
    const calm = visible.filter(item => item.equipment.status !== "inactive" && item.level < 2);
    const off = visible.filter(item => item.equipment.status === "inactive");
    const activeCount = ctx.snapshots.filter(item => item.equipment.status !== "inactive").length;
    const openOff = ui.view === "ficha" && off.some(item => item.equipment.id === ui.equipmentId);

    return `
        ${kpi ? `<div class="meq-filterchip"><span>Filtro: ${esc(kpi.label)}</span><button type="button" data-meq-act="clear-kpi" aria-label="Quitar filtro">Quitar ✕</button></div>` : ""}
        <button class="meq-railnav ${ui.view === "panel" ? "is-active" : ""}" type="button" data-meq-act="panel">${ic("grid")}<span><strong>Panel de la unidad</strong><small>${plural(activeCount, "equipo activo", "equipos activos")} · lo urgente primero</small></span></button>
        ${attention.length ? `<div class="meq-railgroup"><div class="meq-railgroup__h"><span>Requieren atención</span><span>${attention.length}</span></div>${attention.map(eqItemHTML).join("")}</div>` : ""}
        ${calm.length ? `<div class="meq-railgroup"><div class="meq-railgroup__h"><span>Al día</span><span>${calm.length}</span></div>${calm.map(eqItemHTML).join("")}</div>` : ""}
        ${off.length ? `<details class="meq-railgroup" ${openOff ? "open" : ""}><summary class="meq-railgroup__h"><span>De baja ▸</span><span>${off.length}</span></summary>${off.map(eqItemHTML).join("")}</details>` : ""}
        ${!visible.length ? `<div class="meq-railempty">${ctx.snapshots.length ? "Ningún equipo coincide. Prueba con el código de inventario o la sala." : "Todavía no hay equipos registrados."}</div>` : ""}`;
}

/* ---------- piezas compartidas ---------- */

function alertRowHTML(alert, withEquipment, ctx) {
    const snapshot = ctx.byId.get(alert.equipmentId);
    const who = alert.key.startsWith("contract:")
        ? (snapshot?.contractEquipment || []).map(item => item.name).join(" · ")
        : snapshot?.equipment.name || "";

    return `<div class="meq-alert">
        <span class="meq-alert__ic meq-alert__ic--${LEVEL_TONES[alert.level]}">${ic(ICON_BY_LEVEL[alert.level])}</span>
        <span class="meq-alert__txt">${withEquipment ? `<em>${esc(who)}</em>` : ""}<strong>${esc(alert.title)}</strong><span>${esc(alert.text)}</span></span>
        <button class="meq-btn meq-btn--secondary meq-btn--sm" type="button" data-meq-open="${attr(alert.equipmentId)}" data-meq-tab="${alert.tab}">${TAB_BUTTON[alert.tab] || "Abrir"}</button>
    </div>`;
}

function barPath(x, y, width, height) {
    if (height <= 0) return "";

    const radius = Math.min(4, height, width / 2);

    return `M${x},${y + height}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + width - radius}Q${x + width},${y} ${x + width},${y + radius}V${y + height}Z`;
}

/* ---------- graficos del panel ---------- */

function chartFailuresByMonthHTML(monthly) {
    const W = 560;
    const H = 190;
    const L = 26;
    const R = 6;
    const T = 18;
    const B = 36;
    const plotWidth = W - L - R;
    const plotHeight = H - T - B;
    const ymax = Math.max(4, ...monthly.map(item => item.count));
    const y = value => T + plotHeight - (value / ymax) * plotHeight;
    const band = plotWidth / monthly.length;
    const barWidth = 22;
    const max = Math.max(...monthly.map(item => item.count));
    const step = ymax > 8 ? 2 : 1;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fallas informadas por mes, últimos 12 meses">`;

    for (let value = 0; value <= ymax; value += step) {
        svg += `<line class="meq-gridl" x1="${L}" x2="${W - R}" y1="${y(value)}" y2="${y(value)}"/><text class="meq-axis" x="${L - 8}" y="${y(value) + 3.5}" text-anchor="end">${value}</text>`;
    }

    monthly.forEach((item, index) => {
        const center = L + band * index + band / 2;
        const height = (item.count / ymax) * plotHeight;
        const [year, month] = item.month.split("-");
        const tip = `${MONTHS_SHORT[Number(month) - 1]} ${year}: ${plural(item.count, "falla", "fallas")}${item.open ? ` (${plural(item.open, "abierta", "abiertas")})` : ""}${item.equipmentNames.length ? `\n${item.equipmentNames.join("\n")}` : ""}`;

        svg += `<g class="meq-bargrp"><rect class="meq-hit" x="${L + band * index}" y="${T}" width="${band}" height="${plotHeight}" data-meq-tip="${attr(tip)}"/>`;
        svg += `<path class="meq-bar" d="${barPath(center - barWidth / 2, y(item.count), barWidth, height)}" pointer-events="none"/></g>`;

        if (item.count === max && item.count > 0) {
            svg += `<text class="meq-vallbl" x="${center}" y="${y(item.count) - 6}" text-anchor="middle">${item.count}</text>`;
        }

        svg += `<text class="meq-axis ${index === monthly.length - 1 ? "meq-axis--strong" : ""}" x="${center}" y="${H - B + 16}" text-anchor="middle">${MONTHS_SHORT[Number(month) - 1]}</text>`;

        if (index === 0 || month === "01") {
            svg += `<text class="meq-axis" x="${center}" y="${H - B + 30}" text-anchor="middle">${year}</text>`;
        }
    });

    return `${svg}</svg>`;
}

function chartDowntimeHTML(ctx) {
    const rows = ctx.snapshots
        .filter(item => item.equipment.status !== "inactive")
        .sort((a, b) => b.metrics.downtime - a.metrics.downtime);
    const max = Math.max(1, ...rows.map(item => item.metrics.downtime));

    if (!rows.length) return `<p class="meq-hint">Sin equipos activos.</p>`;

    return `<div class="meq-hbars">${rows.map(({ equipment, metrics }) => `
        <button class="meq-hbar" type="button" data-meq-open="${attr(equipment.id)}" data-meq-tab="mantenciones" data-meq-tip="${attr(`${equipment.name}\n${metrics.downtime} h fuera de servicio · disponibilidad ${formatPercent(metrics.availability)}${equipment.status === "maintenance" ? "\nSigue fuera de servicio" : ""}`)}">
            <span class="meq-hbar__name">${esc(equipment.name)}</span>
            <span class="meq-hbar__track"><i style="width:${(metrics.downtime / max) * 100}%"></i></span>
            <span class="meq-hbar__val">${metrics.downtime} h<small>${formatPercent(metrics.availability)} disp.</small></span>
        </button>`).join("")}</div>`;
}

/* ---------- panel de la unidad ---------- */

function contractVigHTML(snapshot, ctx) {
    const contract = snapshot.contract;
    const equipmentList = snapshot.contractEquipment;
    const names = equipmentList.map(item => esc(item.name)).join(", ");

    if (!contract.endDate) {
        return `<div class="meq-vig">
            <div class="meq-vig__top"><strong>${esc(contract.provider || "Contrato sin datos")}</strong><span class="meq-pill meq-pill--warn">Sin fecha de término</span></div>
            <span class="meq-hint">${plural(equipmentList.length, "equipo", "equipos")}: ${names}. Completa la vigencia para recibir el aviso de renovación.</span>
        </div>`;
    }

    const rest = daysUntil(contract.endDate, ctx.today);
    const tone = rest <= 30 ? "danger" : rest <= 90 ? "warn" : "";
    const hasStart = Boolean(contract.startDate) && contract.startDate < contract.endDate;
    const total = hasStart ? daysBetween(contract.startDate, contract.endDate) : 0;
    const elapsed = hasStart ? daysBetween(contract.startDate, ctx.today) : 0;
    const progress = hasStart ? Math.max(0, Math.min(100, (elapsed / total) * 100)) : 100;
    const label = rest < 0
        ? `Vencido hace ${-rest} d`
        : rest <= 90 ? `Vence en ${rest} d` : `${Math.round(rest / 30.4)} meses restantes`;

    return `<div class="meq-vig">
        <div class="meq-vig__top"><strong>${esc(contract.provider || "Contrato")}</strong><span class="meq-pill meq-pill--${rest < 0 ? "danger" : tone || "ok"}">${label}</span></div>
        <span class="meq-hint">${contract.tenderId ? `${esc(contract.tenderId)} · ` : ""}${plural(equipmentList.length, "equipo", "equipos")}: ${names}</span>
        <div class="meq-vig__bar" data-meq-tip="${attr(`${hasStart ? `Inicio ${formatDate(contract.startDate)} · ` : ""}término ${formatDate(contract.endDate)}${hasStart ? `\nTranscurrido ${Math.round(progress)} %` : ""}`)}"><i class="${tone ? `meq-fill--${tone}` : ""}" style="width:${progress}%"></i></div>
        <div class="meq-vig__dates"><span>${hasStart ? formatDate(contract.startDate) : "—"}</span><span>${formatDate(contract.endDate)}</span></div>
    </div>`;
}

function panelViewHTML(ctx) {
    const header = `<div class="meq-sec__h">
        <div><span class="meq-kicker">Vista general</span><h2 class="meq-viewtitle">Panel de la unidad</h2></div>
        ${ctx.snapshots.length ? `<button class="meq-btn meq-btn--secondary meq-btn--sm" type="button" data-meq-act="print-report">${ic("download")}Informe mensual PDF</button>` : ""}
    </div>`;

    if (!ctx.snapshots.length) {
        return `<div class="meq-view">${readonlyHTML(ctx)}${header}
            <div class="meq-empty">
                <strong>Aún no hay equipos en esta unidad</strong>
                <span class="meq-hint">Crea el primer equipo: con nombre, código y ubicación ya aparece en la app de los trabajadores, que desde ahí informan sus fallas.</span>
                ${ctx.canEdit ? `<button class="meq-btn meq-btn--primary" type="button" data-meq-act="new">${ic("plus")}Nuevo equipo</button>` : ""}
            </div>
        </div>`;
    }

    const active = ctx.snapshots.filter(item => item.equipment.status !== "inactive");
    const queue = unitQueue(ctx.snapshots);
    const visibleQueue = ui.queueAll ? queue : queue.slice(0, 7);
    const due = active.reduce((sum, item) => sum + item.metrics.preventiveDue, 0);
    const done = active.reduce((sum, item) => sum + item.metrics.preventiveDone, 0);
    const agenda = active
        .filter(item => item.equipment.nextMaintenanceAt && daysUntil(item.equipment.nextMaintenanceAt, ctx.today) <= 60)
        .sort((a, b) => a.equipment.nextMaintenanceAt.localeCompare(b.equipment.nextMaintenanceAt));
    const contracts = [...new Map(
        active.filter(item => item.contract).map(item => [item.contract.id, item])
    ).values()].sort((a, b) =>
        (a.contract.endDate || "9999").localeCompare(b.contract.endDate || "9999")
    );
    const withoutContract = active.filter(item => !item.contract);
    const monthly = monthlyFailureCounts(ctx.snapshots, ctx.today);
    const total12 = monthly.reduce((sum, item) => sum + item.count, 0);
    const recent = monthly[10].count + monthly[11].count;
    const previousMonth = MONTH_NAMES[Number(monthly[10].month.slice(5, 7)) - 1];

    return `<div class="meq-view">
        ${readonlyHTML(ctx)}
        ${header}

        <section class="meq-sec">
            <div class="meq-sec__h"><h3>Qué hay que resolver</h3><p>${plural(queue.length, "pendiente", "pendientes")} · ordenados por urgencia</p></div>
            ${queue.length
                ? `<div class="meq-alerts">${visibleQueue.map(alert => alertRowHTML(alert, true, ctx)).join("")}</div>`
                : `<div class="meq-callout meq-callout--ok"><span class="meq-alert__ic">${ic("check")}</span><span class="meq-callout__txt"><strong>Nada pendiente</strong><span>Preventivas en fecha, fallas cerradas, contratos y documentos al día.</span></span></div>`}
            ${queue.length > 7 ? `<button class="meq-link" type="button" data-meq-act="toggle-queue">${ui.queueAll ? "Mostrar solo los 7 más urgentes" : `Ver ${queue.length - 7} avisos más`}</button>` : ""}
        </section>

        <div class="meq-cols">
            <section class="meq-sec meq-chart">
                <div class="meq-sec__h"><h3>Fallas informadas por mes</h3><p>${total12} en 12 meses · ${recent} desde ${previousMonth}</p></div>
                ${chartFailuresByMonthHTML(monthly)}
                <p class="meq-hint">Incluye las que llegan desde la PWA y las registradas por supervisión. Pasa el cursor por un mes para ver los equipos.</p>
            </section>
            <section class="meq-sec">
                <div class="meq-sec__h"><h3>Horas fuera de servicio</h3><p>últimos 12 meses · meta de disponibilidad 95 %</p></div>
                ${chartDowntimeHTML(ctx)}
                <p class="meq-hint">Suma preventivas, reparaciones y la detención en curso. Toca un equipo para ver sus mantenciones.</p>
            </section>
        </div>

        <div class="meq-cols">
            <section class="meq-sec">
                <div class="meq-sec__h"><h3>Próximas preventivas</h3><p>vencidas y próximos 60 días</p></div>
                <div class="meq-metric meq-metric--clear">
                    <span class="meq-metric__lbl">Programa preventivo · 12 meses</span>
                    ${due
                        ? `<span class="meq-metric__val">${done} <small>de ${due} realizadas · ${formatPercent((done / due) * 100)}</small></span>
                           <div class="meq-meter"><i class="${done / due >= 0.9 ? "meq-fill--ok" : "meq-fill--warn"}" style="width:${(done / due) * 100}%"></i></div>`
                        : `<span class="meq-metric__val">—</span>`}
                    <span class="meq-metric__ctx">${due ? "Respaldo para acreditación: cada preventiva realizada con su informe técnico." : "Define en la ficha de cada equipo cada cuántos días va su preventiva."}</span>
                </div>
                ${agenda.length ? `<div class="meq-agenda">${agenda.map(item => {
                    const days = daysUntil(item.equipment.nextMaintenanceAt, ctx.today);
                    return `<div class="meq-agenda__row">
                        ${calHTML(item.equipment.nextMaintenanceAt, days < 0)}
                        <span><strong>${esc(item.equipment.name)}</strong><span>Preventiva · ${esc(item.contract?.provider || "sin proveedor")}${days >= 0 ? (item.equipment.nextMaintenanceConfirmed ? " · confirmada" : " · por confirmar") : ""}</span></span>
                        <span class="meq-pill meq-pill--${days < 0 ? "danger" : days <= 14 ? "warn" : "notice"}">${dueLabel(item.equipment.nextMaintenanceAt, ctx.today)}</span>
                    </div>`;
                }).join("")}</div>` : `<p class="meq-hint">Sin preventivas vencidas ni en los próximos 60 días.</p>`}
            </section>
            <section class="meq-sec">
                <div class="meq-sec__h"><h3>Contratos de mantención</h3><p>vigencia y equipos que cubre cada uno</p></div>
                <div class="meq-box meq-box--flush">
                    ${contracts.map(item => contractVigHTML(item, ctx)).join("")}
                    ${withoutContract.map(item => {
                        const warranty = daysUntil(item.equipment.warrantyUntil, ctx.today);
                        const inWarranty = warranty !== null && warranty >= 0;
                        return `<div class="meq-vig"><div class="meq-vig__top"><strong>${esc(item.equipment.name)}</strong><span class="meq-pill meq-pill--${inWarranty ? "notice" : "danger"}">${inWarranty ? "En garantía" : "Sin contrato"}</span></div><span class="meq-hint">${inWarranty
                            ? `Garantía hasta el ${formatDate(item.equipment.warrantyUntil)}.`
                            : warranty !== null
                                ? `Terminó la garantía el ${formatDate(item.equipment.warrantyUntil)}. Ninguna preventiva tiene proveedor.`
                                : "No hay contrato ni garantía registrados."}</span></div>`;
                    }).join("")}
                </div>
            </section>
        </div>
    </div>`;
}

/* ---------- ficha: encabezado y pestañas ---------- */

function fichaHeadHTML(snapshot, ctx) {
    const { equipment, metrics, docs, contract } = snapshot;
    const status = EQUIPMENT_STATUS[equipment.status];
    const inactive = equipment.status === "inactive";
    const contractDays = contract?.endDate ? daysUntil(contract.endDate, ctx.today) : null;
    const warrantyDays = daysUntil(equipment.warrantyUntil, ctx.today);
    let contractBadge = "";

    if (!inactive) {
        if (!contract) {
            contractBadge = warrantyDays !== null && warrantyDays >= 0
                ? `<span class="meq-pill meq-pill--notice">garantía</span>`
                : `<span class="meq-pill meq-pill--danger">sin contrato</span>`;
        } else if (contractDays !== null && contractDays <= 90) {
            contractBadge = `<span class="meq-pill meq-pill--${contractDays < 0 ? "danger" : "warn"}">${contractDays < 0 ? "vencido" : `${contractDays} d`}</span>`;
        }
    }

    const tabs = [
        ["resumen", "Resumen", ""],
        ["fallas", "Fallas", metrics.open.length ? `<span class="meq-pill meq-pill--danger">${metrics.open.length}</span>` : ""],
        ["mantenciones", "Mantenciones", daysUntil(equipment.nextMaintenanceAt, ctx.today) < 0 ? `<span class="meq-pill meq-pill--danger">vencida</span>` : ""],
        ["contrato", "Contrato", contractBadge],
        ["documentos", "Documentos", `<span class="meq-pill meq-pill--${docs.summary.ok === docs.summary.total ? "ok" : "warn"}">${docs.summary.ok}/${docs.summary.total}</span>`],
        ["hoja", "Hoja de vida", ""]
    ];
    const meta = [
        ["Modelo", [equipment.brand, equipment.model].filter(Boolean).join(" ")],
        ["Cód.", equipment.code],
        ["Serie", equipment.serialNumber],
        ["Ubicación", equipment.location]
    ].filter(([, value]) => value);
    const kicker = [equipment.equipmentType, CRITICALITY_LABELS[equipment.criticality]]
        .filter(Boolean)
        .join(" · ") || "Equipo médico";

    return `<div class="meq-fhead">
        <div class="meq-fhead__top">
            <div class="meq-fhead__id">
                <span class="meq-kicker">${esc(kicker)}</span>
                <h2>${esc(equipment.name)}</h2>
                <div class="meq-fhead__meta">
                    <span class="meq-pill meq-pill--${status.tone}">${esc(status.label)}</span>
                    ${meta.map(([label, value]) => `<span><b>${label}</b> ${esc(value)}</span>`).join("")}
                </div>
            </div>
            <div class="meq-fhead__actions">
                <button class="meq-btn meq-btn--secondary" type="button" data-meq-act="print-failures" title="Imprime todas las fallas, con las fotos que adjuntaron los trabajadores, para entregárselo al técnico">${ic("print")}Imprimir historial</button>
                ${ctx.canEdit && !inactive ? `
                    <button class="meq-btn meq-btn--secondary" type="button" data-meq-act="failure">${ic("alert")}Informar falla</button>
                    <button class="meq-btn meq-btn--primary" type="button" data-meq-act="maintenance">${ic("wrench")}Registrar mantención</button>` : ""}
                <details class="meq-more">
                    <summary class="meq-btn meq-btn--ghost" aria-label="Más acciones">${ic("more")}</summary>
                    <div class="meq-more__menu">
                        ${ctx.canEdit && !inactive ? `
                            <button type="button" data-meq-act="edit">${ic("edit")}Editar ficha técnica</button>
                            <button type="button" data-meq-act="status">${ic("power")}Cambiar estado</button>` : ""}
                        <button type="button" data-meq-act="print-life">${ic("download")}Exportar hoja de vida (PDF)</button>
                        ${ctx.canEdit ? `<hr>
                            ${inactive
                                ? `<button type="button" data-meq-act="reactivate">${ic("power")}Reactivar equipo</button>`
                                : `<button type="button" data-meq-act="inactivate">${ic("power")}Dar de baja</button>`}
                            <button type="button" class="is-danger" data-meq-act="delete">${ic("trash")}Eliminar equipo</button>` : ""}
                    </div>
                </details>
            </div>
        </div>
        <div class="meq-tabs" role="tablist" aria-label="Secciones del equipo">${tabs.map(([id, label, extra]) =>
            `<button class="meq-tab" type="button" role="tab" aria-selected="${ui.tab === id}" data-meq-tabgo="${id}">${label}${extra}</button>`
        ).join("")}</div>
    </div>`;
}

function fichaHTML(snapshot, ctx) {
    const renderers = {
        resumen: tabSummaryHTML,
        fallas: tabFailuresHTML,
        mantenciones: tabMaintenanceHTML,
        contrato: tabContractHTML,
        documentos: tabDocumentsHTML,
        hoja: tabLifeHTML
    };
    const render = renderers[ui.tab] || tabSummaryHTML;

    return `${fichaHeadHTML(snapshot, ctx)}<div class="meq-view" role="tabpanel">${readonlyHTML(ctx)}${render(snapshot, ctx)}</div>`;
}

/* ---------- linea de tiempo del equipo ---------- */

function chartTimelineHTML(snapshot, ctx) {
    const { equipment, failures } = snapshot;
    const start = addDaysISO(ctx.today, -365);
    const end = addMonthsISO(ctx.today, 3);
    const W = 720;
    const H = 146;
    const L = 100;
    const R = 12;
    const plotWidth = W - L - R;
    const yF = 36;
    const yM = 84;
    const total = daysBetween(start, end);
    const x = iso => L + (daysBetween(start, iso) / total) * plotWidth;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fallas y mantenciones de los últimos 12 meses y las programadas">`;

    svg += `<rect class="meq-lane" x="${L}" y="${yF - 16}" width="${plotWidth}" height="32" rx="8"/><rect class="meq-lane" x="${L}" y="${yM - 16}" width="${plotWidth}" height="32" rx="8"/>`;
    svg += `<text class="meq-axis meq-axis--strong" x="0" y="${yF + 4}">Fallas</text><text class="meq-axis meq-axis--strong" x="0" y="${yM + 4}">Mantenciones</text>`;

    const [startYear, startMonth] = start.split("-").map(Number);
    let cursor = new Date(startYear, startMonth, 1);
    let first = true;

    while (localISODate(cursor) <= end) {
        const iso = localISODate(cursor);
        const position = x(iso);

        svg += `<line class="meq-gridl" x1="${position}" x2="${position}" y1="14" y2="${yM + 20}"/>`;
        svg += `<text class="meq-axis" x="${position + 3}" y="${H - 18}">${MONTHS_SHORT[cursor.getMonth()]}</text>`;

        if (cursor.getMonth() === 0 || first) {
            svg += `<text class="meq-axis" x="${position + 3}" y="${H - 4}">${cursor.getFullYear()}</text>`;
        }

        first = false;
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }

    const todayX = x(ctx.today);

    svg += `<line class="meq-today" x1="${todayX}" x2="${todayX}" y1="8" y2="${yM + 24}"/><text class="meq-axis meq-axis--strong" x="${todayX}" y="7" text-anchor="middle">hoy</text>`;

    const inRange = iso => iso >= start && iso <= end;
    const maintenances = equipment.maintenances.filter(record => inRange(record.date));
    const visibleFailures = failures.filter(failure => inRange(failure.date));

    visibleFailures.forEach(failure => {
        if (failure.maintenance && inRange(failure.maintenance.date)) {
            svg += `<line class="meq-linkline" x1="${x(failure.date)}" y1="${yF}" x2="${x(failure.maintenance.date)}" y2="${yM}"/>`;
        }
    });

    maintenances.forEach(record => {
        const position = x(record.date);
        const state = maintenanceState(record, ctx.now);
        const hours = state === "scheduled" ? plannedMaintenanceHours(record) : maintenanceHours(record, ctx.now);
        const tip = `${MAINTENANCE_TYPE_LABELS[record.type]}${state === "scheduled" ? " programada" : state === "ongoing" ? " en curso" : ""} · ${formatDate(record.date)}${record.summary ? `\n${record.summary}` : ""}${hours && state !== "scheduled" ? `\nFuera de servicio: ${formatDuration(hours)}` : ""}`;
        let marker;

        if (state === "scheduled") {
            marker = `<circle class="meq-mk-plan" cx="${position}" cy="${yM}" r="6"/>`;
        } else if (record.type === "corrective") {
            marker = `<rect class="meq-mk-corr" x="${position - 6}" y="${yM - 6}" width="12" height="12" rx="2" transform="rotate(45 ${position} ${yM})"/>`;
        } else if (record.type === "inspection" || record.type === "calibration") {
            marker = `<rect class="meq-mk-insp" x="${position - 5.5}" y="${yM - 5.5}" width="11" height="11" rx="2"/>`;
        } else {
            marker = `<circle class="meq-mk-prev" cx="${position}" cy="${yM}" r="6"/>`;
        }

        svg += `${marker}<circle class="meq-hit" cx="${position}" cy="${yM}" r="11" data-meq-tip="${attr(tip)}"/>`;
    });

    visibleFailures.forEach(failure => {
        const position = x(failure.date);
        const tip = `${failure.title} · ${formatDate(failure.date)}\nGravedad ${SEVERITY_LABELS[failure.severity].toLowerCase()} · ${FAILURE_STATUS[failure.status].label}${failure.repairHours ? `\nResuelta en ${formatDuration(failure.repairHours)}` : ""}`;

        svg += failure.status === "dismissed"
            ? `<circle class="meq-sev-dismissed" cx="${position}" cy="${yF}" r="5.5"/>`
            : `<circle class="meq-sev-${failure.severity} meq-ring" cx="${position}" cy="${yF}" r="6.5"/>`;
        svg += `<circle class="meq-hit" cx="${position}" cy="${yF}" r="11" data-meq-tip="${attr(tip)}"/>`;
    });

    return `${svg}</svg>`;
}

const TIMELINE_LEGEND = `<div class="meq-legend">
    <span><svg viewBox="0 0 14 14"><circle class="meq-sev-low" cx="7" cy="7" r="5"/></svg>Baja</span>
    <span><svg viewBox="0 0 14 14"><circle class="meq-sev-medium" cx="7" cy="7" r="5"/></svg>Media</span>
    <span><svg viewBox="0 0 14 14"><circle class="meq-sev-high" cx="7" cy="7" r="5"/></svg>Alta</span>
    <span><svg viewBox="0 0 14 14"><circle class="meq-sev-critical" cx="7" cy="7" r="5"/></svg>Crítica</span>
    <span><svg viewBox="0 0 14 14"><circle class="meq-mk-prev" cx="7" cy="7" r="5"/></svg>Preventiva</span>
    <span><svg viewBox="0 0 14 14"><rect class="meq-mk-corr" x="3" y="3" width="8" height="8" rx="1.5" transform="rotate(45 7 7)" style="stroke:none"/></svg>Correctiva</span>
    <span><svg viewBox="0 0 14 14"><rect class="meq-mk-insp" x="2.5" y="2.5" width="9" height="9" rx="1.5"/></svg>Revisión técnica</span>
    <span><svg viewBox="0 0 14 14"><circle class="meq-mk-plan" cx="7" cy="7" r="5"/></svg>Programada</span>
    <span><svg viewBox="0 0 14 14"><line class="meq-linkline" x1="1" y1="7" x2="13" y2="7"/></svg>Falla → reparación</span>
</div>`;

/* ---------- pestaña Resumen ---------- */

function datosHTML(snapshot, ctx) {
    const { equipment, contract } = snapshot;
    const frequency = equipment.maintenanceFrequencyDays;
    const fields = [
        ["Marca y modelo", [equipment.brand, equipment.model].filter(Boolean).join(" ") || null],
        ["Código inventario", equipment.code || null],
        ["N° de serie", equipment.serialNumber || null],
        ["Ubicación", equipment.location || null],
        ["Criticidad", CRITICALITY_LABELS[equipment.criticality] || null],
        ["Instalación", equipment.installedAt ? `${formatDate(equipment.installedAt)} · ${ageLabel(equipment.installedAt, ctx.today)}` : null],
        ["Fecha de compra", equipment.purchaseDate ? formatDate(equipment.purchaseDate) : null],
        ["Garantía hasta", equipment.warrantyUntil ? formatDate(equipment.warrantyUntil) : null],
        ["Preventiva", frequency ? `${frequencyLabel(frequency)} · cada ${frequency} días` : null],
        ["Próxima preventiva", equipment.nextMaintenanceAt ? `${formatDate(equipment.nextMaintenanceAt)} · ${dueLabel(equipment.nextMaintenanceAt, ctx.today)}` : "—"],
        ["Servicio técnico", contract ? contract.provider || null : equipment.status === "inactive" ? "—" : "Sin contrato"],
        ["Visible en la PWA", equipment.status === "inactive" ? "No" : "Sí"]
    ];

    return `<dl class="meq-dl">${fields.map(([label, value]) =>
        `<div><dt>${label}</dt><dd class="${value === null ? "is-missing" : ""}">${value === null ? "Falta completar" : esc(value)}</dd></div>`
    ).join("")}</dl>`;
}

function comparisonPill(current, previous) {
    if (previous === null) return "sin datos del año anterior";
    if (current > previous) return `<span class="meq-pill meq-pill--warn">▲ ${previous} el año anterior</span>`;
    if (current < previous) return `<span class="meq-pill meq-pill--ok">▼ ${previous} el año anterior</span>`;
    return `<span class="meq-pill">= ${previous} el año anterior</span>`;
}

function tabSummaryHTML(snapshot, ctx) {
    const { equipment, metrics, alerts, contract } = snapshot;

    if (equipment.status === "inactive") {
        return `<div class="meq-callout meq-callout--muted">
                <span class="meq-alert__ic">${ic("power")}</span>
                <span class="meq-callout__txt"><strong>Dado de baja${equipment.inactiveAt ? ` el ${formatDate(equipment.inactiveAt)}` : ""}</strong><span>${equipment.inactiveReason ? `${esc(equipment.inactiveReason)}. ` : ""}El historial y los documentos se conservan; ya no aparece en la PWA ni en los indicadores.</span></span>
                ${ctx.canEdit ? `<button class="meq-btn meq-btn--secondary meq-btn--sm" type="button" data-meq-act="reactivate">Reactivar</button>` : ""}
            </div>
            <section class="meq-sec"><div class="meq-sec__h"><h3>Datos del equipo</h3></div>${datosHTML(snapshot, ctx)}</section>`;
    }

    const origin = equipment.installedAt || equipment.purchaseDate;
    const lifeMonths = equipment.usefulLifeYears * 12;
    const usedMonths = origin ? Math.floor(daysBetween(origin, ctx.today) / 30.44) : 0;
    const taskNames = titlesFor(equipment.taskIds, ctx);
    const sla = Number(contract?.responseHours) || 0;
    let responseContext = "sin contrato vigente";

    if (contract) {
        if (metrics.responseAverage === null) {
            responseContext = "sin visitas correctivas en 12 meses";
        } else if (sla) {
            responseContext = `<span class="meq-pill meq-pill--${metrics.responseAverage > sla ? "danger" : "ok"}">${metrics.responseAverage > sla ? "sobre" : "dentro de"} las ${sla} h del contrato</span>`;
        } else {
            responseContext = "el contrato no fija un plazo";
        }
    }

    return `
        ${alerts.length
            ? `<section class="meq-sec"><div class="meq-sec__h"><h3>Requiere atención</h3><p>${plural(alerts.length, "aviso", "avisos")} de este equipo</p></div><div class="meq-alerts">${alerts.map(alert => alertRowHTML(alert, false, ctx)).join("")}</div></section>`
            : `<div class="meq-callout meq-callout--ok"><span class="meq-alert__ic">${ic("check")}</span><span><strong>Todo al día</strong><span> · sin fallas abiertas, preventivas en fecha, contrato y documentos vigentes.</span></span></div>`}

        <section class="meq-sec">
            <div class="meq-sec__h"><h3>Indicadores · últimos 12 meses</h3><p>se calculan solos con las fallas y mantenciones registradas</p></div>
            <div class="meq-metrics">
                <div class="meq-metric">
                    <span class="meq-metric__lbl">Disponibilidad</span>
                    <span class="meq-metric__val">${formatPercent(metrics.availability)}</span>
                    <div class="meq-meter"><i class="${metrics.availability >= 95 ? "meq-fill--ok" : "meq-fill--danger"}" style="width:${metrics.availability}%"></i></div>
                    <span class="meq-metric__ctx">${metrics.downtime} h fuera de servicio · meta 95 %</span>
                </div>
                <div class="meq-metric">
                    <span class="meq-metric__lbl">Fallas</span>
                    <span class="meq-metric__val">${metrics.failures12}${metrics.mtbf ? ` <small>una cada ${metrics.mtbf} días</small>` : ""}</span>
                    <span class="meq-metric__ctx">${comparisonPill(metrics.failures12, metrics.previous12)}</span>
                </div>
                <div class="meq-metric">
                    <span class="meq-metric__lbl">Tiempo medio de reparación</span>
                    <span class="meq-metric__val">${metrics.mttr !== null ? formatDuration(metrics.mttr) : "—"}</span>
                    <span class="meq-metric__ctx">desde el aviso hasta que vuelve a operar</span>
                </div>
                <div class="meq-metric">
                    <span class="meq-metric__lbl">Respuesta del proveedor</span>
                    <span class="meq-metric__val">${metrics.responseAverage !== null ? `${metrics.responseAverage} h` : "—"}</span>
                    <span class="meq-metric__ctx">${responseContext}</span>
                </div>
            </div>
        </section>

        <section class="meq-sec meq-chart">
            <div class="meq-sec__h"><h3>Fallas y mantenciones en el tiempo</h3><p>12 meses atrás y 3 hacia adelante</p></div>
            <div class="meq-chartscroll"><div>${chartTimelineHTML(snapshot, ctx)}</div></div>
            ${TIMELINE_LEGEND}
        </section>

        <div class="meq-cols">
            <section class="meq-sec"><div class="meq-sec__h"><h3>Datos del equipo</h3>${ctx.canEdit ? `<button class="meq-link" type="button" data-meq-act="edit">Editar ficha</button>` : ""}</div>${datosHTML(snapshot, ctx)}</section>
            <section class="meq-sec">
                <div class="meq-sec__h"><h3>Uso en la unidad</h3>${ctx.canEdit ? `<button class="meq-link" type="button" data-meq-act="edit">Editar</button>` : ""}</div>
                <div class="meq-box">
                    <span class="meq-box__lbl">Tareas que dependen de este equipo</span>
                    ${taskNames.length
                        ? `<div class="meq-chips">${taskNames.map(name => `<span class="meq-chip is-on">${ic("tasks")}${esc(name)}</span>`).join("")}</div>
                           <span class="meq-hint">Si el equipo queda fuera de servicio, estas tareas se marcan inactivas en Asignación de Tareas y el equipo aparece como no disponible en la PWA.</span>`
                        : `<span class="meq-hint">Ninguna tarea depende de este equipo. Agrégalas en la ficha para que se inactiven solas cuando quede fuera de servicio.</span>`}
                </div>
                <div class="meq-box">
                    <span class="meq-box__lbl">Vida útil</span>
                    ${origin && lifeMonths
                        ? `<div class="meq-meter"><i class="${usedMonths / lifeMonths > 0.85 ? "meq-fill--warn" : ""}" style="width:${Math.min(100, (usedMonths / lifeMonths) * 100)}%"></i></div>
                           <span class="meq-metric__ctx">${ageLabel(origin, ctx.today)} de ${equipment.usefulLifeYears} años · reposición estimada ${formatDate(addMonthsISO(origin, lifeMonths))}</span>`
                        : `<span class="meq-hint">Indica la instalación y los años de vida útil para estimar cuándo reponerlo.</span>`}
                </div>
                ${equipment.manufacturerRecommendations ? `<div class="meq-box"><span class="meq-box__lbl">Recomendaciones del fabricante</span><p>${esc(equipment.manufacturerRecommendations)}</p></div>` : ""}
                ${equipment.details ? `<div class="meq-box"><span class="meq-box__lbl">Detalles del equipo</span><p>${esc(equipment.details)}</p></div>` : ""}
            </section>
        </div>`;
}

/* ---------- pestaña Fallas ---------- */

function attachmentsStripHTML(failure) {
    if (!failure.attachments.length) return "";

    return `<div class="meq-atts">
        <span class="meq-atts__h">${ic("camera")}${failure.channel === "PWA" ? "Adjuntos del trabajador" : "Adjuntos"} · ${failure.attachments.length}</span>
        <div class="meq-atts__list">${failure.attachments.map(file => {
            const url = isPrintableImage(file) ? file.downloadURL || file.dataUrl || "" : "";

            return url
                ? `<button class="meq-att" type="button" data-meq-att="${attr(failure.id)}" data-meq-file="${attr(file.id)}" title="Ver ${attr(file.name)}"><img src="${attr(url)}" alt="${attr(file.name)}" loading="lazy" data-meq-thumb></button>`
                : `<button class="meq-att meq-att--file" type="button" data-meq-att="${attr(failure.id)}" data-meq-file="${attr(file.id)}" title="Abrir ${attr(file.name)}">${ic("file")}<span>${esc(file.name)}</span></button>`;
        }).join("")}</div>
    </div>`;
}

function failureCardHTML(failure, snapshot, ctx) {
    const closed = failure.status === "resolved" || failure.status === "dismissed";
    const repair = failure.maintenance;
    const repairState = repair ? maintenanceState(repair, ctx.now) : "";
    const status = FAILURE_STATUS[failure.status];
    let control;

    if (failure.status === "dismissed") {
        control = `<span class="meq-pill">Descartada</span>`;
    } else if (ctx.canEdit) {
        control = `<div class="meq-steps" role="group" aria-label="Estado de la falla">${["open", "review", "resolved"].map(value =>
            `<button type="button" class="${failure.status === value ? "is-on" : ""}" data-meq-fstatus="${value}" data-meq-failure="${attr(failure.id)}" aria-pressed="${failure.status === value}">${FAILURE_STATUS[value].label}</button>`
        ).join("")}</div>`;
    } else {
        control = `<span class="meq-pill meq-pill--${status.tone}">${esc(status.label)}</span>`;
    }

    return `<article class="meq-fcard ${closed ? "is-closed" : ""}">
        <span class="meq-sev meq-sev--${failure.severity}" title="Gravedad ${attr(SEVERITY_LABELS[failure.severity])}">${esc(SEVERITY_LABELS[failure.severity].slice(0, 4))}</span>
        <div class="meq-fcard__body">
            <div class="meq-fcard__top">
                <div class="meq-fcard__title"><strong>${esc(failure.title)}</strong>
                    <span class="meq-fcard__by">${esc(failure.reportedByName)} · vía ${failure.channel} · ${formatDate(failure.date)}${failure.time ? ` ${failure.time}` : ""}${closed ? "" : ` · <b class="is-${failure.status}">abierta ${agoLabel(failure.date, ctx.today)}</b>`}</span></div>
                ${control}
            </div>
            ${failure.detail ? `<p>${esc(failure.detail)}</p>` : ""}
            ${failure.note ? `<p class="meq-hint">${ic("file")} ${esc(failure.note)}</p>` : ""}
            ${attachmentsStripHTML(failure)}
            <div class="meq-fcard__foot">
                <div class="meq-linkrow">
                    ${repair ? `<button class="meq-link" type="button" data-meq-tabgo="mantenciones">${ic("link")} ${repairState === "ongoing" ? "En reparación" : "Reparada con"}: ${esc(MAINTENANCE_TYPE_LABELS[repair.type].toLowerCase())} del ${formatDate(repair.date)}${repairState !== "ongoing" && failure.repairHours !== null ? ` · ${formatDuration(failure.repairHours)} hasta volver a operar` : ""}</button>` : ""}
                    ${failure.status === "resolved" && !repair ? `<span>${ic("check")} Resuelta sin intervención técnica</span>` : ""}
                    ${failure.outOfService ? `<span>${ic("power")} Dejó el equipo fuera de servicio</span>` : ""}
                </div>
                ${ctx.canEdit ? `<div class="meq-fcard__acts">
                    <button class="meq-link" type="button" data-meq-act="note" data-meq-failure="${attr(failure.id)}">${failure.note ? "Editar nota" : "Agregar nota"}</button>
                    ${failure.status === "dismissed"
                        ? `<button class="meq-link" type="button" data-meq-act="reopen" data-meq-failure="${attr(failure.id)}">Reabrir</button>`
                        : !closed ? `<button class="meq-link meq-link--danger" type="button" data-meq-act="dismiss" data-meq-failure="${attr(failure.id)}">Descartar</button>` : ""}
                    ${!closed && !repair ? `<button class="meq-btn meq-btn--secondary meq-btn--sm" type="button" data-meq-act="maintenance" data-meq-failure="${attr(failure.id)}">${ic("wrench")}Cerrar con una mantención</button>` : ""}
                </div>` : ""}
            </div>
        </div>
    </article>`;
}

function tabFailuresHTML(snapshot, ctx) {
    const { equipment, failures, metrics } = snapshot;
    const open = failures.filter(isOpenFailure);
    const list = ui.failures === "open" ? open : failures;
    const fromWorkers = failures.filter(failure => failure.channel === "PWA").length;
    const active = equipment.status !== "inactive";

    return `
        <div class="meq-sec__h">
            <div class="meq-seg" role="group" aria-label="Filtrar fallas">
                <button class="meq-chip ${ui.failures === "open" ? "is-on" : ""}" type="button" data-meq-failures="open">Abiertas · ${open.length}</button>
                <button class="meq-chip ${ui.failures === "all" ? "is-on" : ""}" type="button" data-meq-failures="all">Todas · ${failures.length}</button>
            </div>
            <div class="meq-fhead__actions">
                <button class="meq-btn meq-btn--secondary meq-btn--sm" type="button" data-meq-act="print-failures">${ic("print")}Imprimir historial</button>
                ${ctx.canEdit && active ? `<button class="meq-btn meq-btn--secondary meq-btn--sm" type="button" data-meq-act="failure">${ic("plus")}Registrar falla</button>` : ""}
            </div>
        </div>
        ${metrics.recurrent.map(group => `<div class="meq-callout">
            <span class="meq-alert__ic">${ic("repeat")}</span>
            <span class="meq-callout__txt"><strong>«${esc(group.title)}» se repitió ${group.count} veces en 12 meses</strong><span>${group.dates.map(formatDate).join(" · ")}. Varias reparaciones del mismo problema sugieren pedir al proveedor un diagnóstico de fondo o evaluar el reemplazo de la pieza.</span></span>
            <button class="meq-btn meq-btn--secondary meq-btn--sm" type="button" data-meq-act="escalate" data-meq-title="${attr(group.title)}">Escalar al proveedor</button>
        </div>`).join("")}
        <div class="meq-cards">${list.length
            ? list.map(failure => failureCardHTML(failure, snapshot, ctx)).join("")
            : reportsLoading
                ? `<p class="meq-hint">Cargando las fallas informadas desde la PWA…</p>`
                : `<div class="meq-callout meq-callout--ok"><span class="meq-alert__ic">${ic("check")}</span><span><strong>${ui.failures === "open" ? "Sin fallas abiertas." : "Sin fallas registradas."}</strong><span> Las que informen los trabajadores desde la PWA llegan aquí al instante.</span></span></div>`}</div>
        <p class="meq-hint">${fromWorkers} de ${failures.length} fallas de este equipo llegaron desde la PWA. Cada una queda con quién la informó, cuándo, sus fotos y la reparación que la cerró.</p>`;
}

/* ---------- pestaña Mantenciones ---------- */

function scheduleLabel(record) {
    const start = formatTime(record.startAt);
    const end = formatTime(record.endAt);

    if (start && end) return `${start} a ${end}`;
    if (start) return `desde ${start}`;
    return "todo el día";
}

function attachmentLinksHTML(files, group) {
    return files.map(file =>
        `<button class="meq-link" type="button" data-meq-openfile="${attr(group)}" data-meq-file="${attr(file.id)}">${ic("file")} ${esc(file.name)}</button>`
    ).join("");
}

function uploadLinkHTML(group, label = "Subir") {
    return `<label class="meq-link" style="cursor:pointer">${label}<input type="file" hidden multiple accept="${ATTACHMENT_ACCEPT}" data-meq-upload="${attr(group)}"></label>`;
}

function tabMaintenanceHTML(snapshot, ctx) {
    const { equipment, metrics, contract, failures } = snapshot;
    const states = new Map(equipment.maintenances.map(record => [record.id, maintenanceState(record, ctx.now)]));
    const scheduled = equipment.maintenances
        .filter(record => states.get(record.id) === "scheduled")
        .sort((a, b) => (a.startAt || a.date).localeCompare(b.startAt || b.date));
    const ongoing = equipment.maintenances.filter(record => states.get(record.id) === "ongoing");
    const history = equipment.maintenances.filter(record => states.get(record.id) === "done");
    const frequency = equipment.maintenanceFrequencyDays;
    const nextDays = daysUntil(equipment.nextMaintenanceAt, ctx.today);
    const showNext = equipment.status !== "inactive" &&
        equipment.nextMaintenanceAt &&
        !scheduled.some(record => record.type === "preventive");
    const failureTitle = id => failures.find(failure => failure.id === id)?.title;

    return `
        <div class="meq-metrics meq-metrics--3">
            <div class="meq-metric">
                <span class="meq-metric__lbl">Programa preventivo · 12 meses</span>
                ${metrics.preventiveDue
                    ? `<span class="meq-metric__val">${metrics.preventiveDone} <small>de ${metrics.preventiveDue} realizadas</small></span>
                       <div class="meq-meter"><i class="${metrics.preventiveDone >= metrics.preventiveDue ? "meq-fill--ok" : "meq-fill--warn"}" style="width:${(metrics.preventiveDone / metrics.preventiveDue) * 100}%"></i></div>`
                    : `<span class="meq-metric__val">—</span><span class="meq-metric__ctx">sin frecuencia definida</span>`}
            </div>
            <div class="meq-metric">
                <span class="meq-metric__lbl">Frecuencia</span>
                <span class="meq-metric__val">${frequencyLabel(frequency)}</span>
                <span class="meq-metric__ctx">${frequency ? `cada ${frequency} días · la próxima fecha se calcula sola` : "defínela en la ficha del equipo"}</span>
            </div>
            <div class="meq-metric">
                <span class="meq-metric__lbl">Incluidas en el contrato</span>
                <span class="meq-metric__val">${contract?.preventivesPerYear ? `${contract.preventivesPerYear} <small>al año</small>` : "—"}</span>
                <span class="meq-metric__ctx">${contract ? esc(contract.provider || "proveedor sin nombre") : "sin contrato vigente"}</span>
            </div>
        </div>

        ${ongoing.map(record => `<div class="meq-callout meq-callout--danger">
            <span class="meq-alert__ic">${ic("wrench")}</span>
            <span class="meq-callout__txt"><strong>${esc(MAINTENANCE_TYPE_LABELS[record.type])} en curso desde el ${formatDate(record.date)} · ${formatDuration(maintenanceHours(record, ctx.now))} fuera de servicio</strong><span>${esc(record.summary || "Sin detalle del trabajo.")}${record.taskIds.length ? ` Tareas inactivas: ${esc(titlesFor(record.taskIds, ctx).join(", "))}.` : ""}</span></span>
            ${ctx.canEdit ? `<button class="meq-btn meq-btn--primary meq-btn--sm" type="button" data-meq-act="finish" data-meq-id="${attr(record.id)}">Terminar y volver a operar</button>` : ""}
        </div>`).join("")}

        <section class="meq-sec">
            <div class="meq-sec__h"><h3>Programadas</h3><p>se publican en el Calendario Semanal y en la PWA</p></div>
            <div class="meq-box meq-box--flush">
                ${scheduled.map(record => `<div class="meq-agenda__row">
                    ${calHTML(String(record.startAt || record.date).slice(0, 10))}
                    <span><strong>${esc(MAINTENANCE_TYPE_LABELS[record.type])} · ${esc(scheduleLabel(record))}</strong><span>${esc(record.provider || "Sin proveedor")}${record.summary ? ` · ${esc(record.summary)}` : ""}${record.taskIds.length ? ` · quedará inactiva: ${esc(titlesFor(record.taskIds, ctx).join(", "))}` : ""}</span></span>
                    <span class="meq-agenda__side">
                        ${ctx.canEdit
                            ? `<button class="meq-pill meq-pill--${record.confirmed ? "ok" : "warn"}" type="button" data-meq-act="toggle-confirm" data-meq-id="${attr(record.id)}" title="Cambiar confirmación">${record.confirmed ? "Confirmada" : "Por confirmar"}</button>
                               <button class="meq-link" type="button" data-meq-act="complete" data-meq-id="${attr(record.id)}">Registrar realizada</button>
                               <button class="meq-iconbtn" type="button" data-meq-act="delete-maintenance" data-meq-id="${attr(record.id)}" title="Quitar">${ic("trash")}</button>`
                            : `<span class="meq-pill meq-pill--${record.confirmed ? "ok" : "warn"}">${record.confirmed ? "Confirmada" : "Por confirmar"}</span>`}
                    </span>
                </div>`).join("")}
                ${showNext ? `<div class="meq-agenda__row">
                    ${calHTML(equipment.nextMaintenanceAt, nextDays < 0)}
                    <span><strong>Preventiva ${esc(frequencyLabel(frequency).toLowerCase())}</strong><span>${nextDays < 0 ? `Vencida hace ${plural(-nextDays, "día", "días")} · ` : ""}${contract ? esc(contract.provider || "proveedor sin nombre") : "Sin proveedor: no hay contrato vigente"} · sin agendar</span></span>
                    ${ctx.canEdit ? `<button class="meq-btn meq-btn--primary meq-btn--sm" type="button" data-meq-act="schedule">${ic("cal")}Agendar</button>` : `<span></span>`}
                </div>` : ""}
                ${!scheduled.length && !showNext ? `<span class="meq-hint">Sin mantenciones programadas.</span>` : ""}
            </div>
        </section>

        <section class="meq-sec">
            <div class="meq-sec__h"><h3>Historial</h3><p>${plural(history.length, "registro", "registros")} · el informe técnico es el respaldo ante auditorías</p></div>
            <div class="meq-tblwrap"><table class="meq-tbl">
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Trabajo realizado</th><th>Fuera de servicio</th><th>Informe técnico</th></tr></thead>
                <tbody>${history.map(record => {
                    const closedTitles = record.resolvesFailureIds.map(failureTitle).filter(Boolean);
                    const hours = maintenanceHours(record, ctx.now);
                    const group = `maintenance:${record.id}`;

                    return `<tr>
                        <td class="meq-num"><strong>${formatDate(record.date)}</strong></td>
                        <td><span class="meq-pill meq-pill--${record.type === "corrective" ? "warn" : record.type === "preventive" ? "" : "notice"}">${esc(MAINTENANCE_TYPE_LABELS[record.type])}</span></td>
                        <td><strong>${esc(record.summary || MAINTENANCE_TYPE_LABELS[record.type])}</strong><small>${esc(record.provider || "Sin proveedor")}${record.technician ? ` · ${esc(record.technician)}` : ""}${closedTitles.length ? ` · cerró la falla «${esc(closedTitles.join("», «"))}»` : ""}</small>${record.recommendations ? `<small>Recomendación: ${esc(record.recommendations)}</small>` : ""}</td>
                        <td class="meq-num">${hours ? formatDuration(hours) : "—"}${hours && record.taskIds.length ? `<small>${esc(titlesFor(record.taskIds, ctx).join(", "))} inactiva${record.taskIds.length > 1 ? "s" : ""}</small>` : ""}</td>
                        <td><div class="meq-tbl__files">
                            ${record.attachments.length
                                ? attachmentLinksHTML(record.attachments, group)
                                : `<span class="meq-pill meq-pill--danger">Falta</span>`}
                            ${ctx.canEdit ? `<span class="meq-linkrow">${uploadLinkHTML(group, record.attachments.length ? "Agregar" : "Subir")}<button class="meq-iconbtn" type="button" data-meq-act="delete-maintenance" data-meq-id="${attr(record.id)}" title="Quitar registro">${ic("trash")}</button></span>` : ""}
                        </div></td>
                    </tr>`;
                }).join("") || `<tr><td colspan="5">Sin mantenciones registradas.</td></tr>`}</tbody>
            </table></div>
        </section>`;
}

/* ---------- pestaña Contrato ---------- */

function contactsHTML(contacts, ctx) {
    if (!contacts.length) {
        return `<p class="meq-hint">Sin contactos. Agrega la mesa de ayuda y al ingeniero de campo del proveedor.</p>`;
    }

    return `<div class="meq-contacts">${contacts.map(contact => `<div class="meq-contact">
        <strong>${esc(contact.name)}</strong><span>${esc(contact.role || "Contacto técnico")}</span>
        ${contact.phone ? `<a href="tel:${attr(contact.phone.replace(/\s/g, ""))}">${ic("phone")}${esc(contact.phone)}</a>` : ""}
        ${contact.email ? `<a href="mailto:${attr(contact.email)}">${ic("mail")}${esc(contact.email)}</a>` : ""}
        ${contact.notes ? `<span>${esc(contact.notes)}</span>` : ""}
        ${ctx.canEdit ? `<button class="meq-iconbtn" type="button" data-meq-act="delete-contact" data-meq-contact="${attr(contact.id)}" title="Quitar contacto">${ic("trash")}</button>` : ""}
    </div>`).join("")}</div>`;
}

function fileRowsHTML(files, group, ctx, emptyText) {
    if (!files.length) return `<p class="meq-hint">${esc(emptyText)}</p>`;

    return `<div class="meq-docgroup">${files.map(file => `<div class="meq-doc">
        <span class="meq-doc__ic">${ic("file")}</span>
        <span style="min-width:0"><strong>${esc(file.name)}</strong><span>Subido el ${formatDate(file.addedAt)}</span></span>
        <span class="meq-doc__side">
            <button class="meq-link" type="button" data-meq-openfile="${attr(group)}" data-meq-file="${attr(file.id)}">Ver</button>
            ${ctx.canEdit ? `<button class="meq-iconbtn" type="button" data-meq-act="delete-file" data-meq-group="${attr(group)}" data-meq-file="${attr(file.id)}" title="Quitar archivo">${ic("trash")}</button>` : ""}
        </span>
    </div>`).join("")}</div>`;
}

function noContractHTML(snapshot, ctx) {
    const { equipment } = snapshot;
    const warrantyDays = daysUntil(equipment.warrantyUntil, ctx.today);
    const inWarranty = warrantyDays !== null && warrantyDays >= 0;
    const others = ctx.contracts;
    const newButton = ctx.canEdit
        ? `<button class="meq-btn meq-btn--primary meq-btn--sm" type="button" data-meq-act="contract-new">${ic("plus")}Registrar contrato</button>`
        : "";
    const head = inWarranty
        ? `<div class="meq-callout meq-callout--ok"><span class="meq-alert__ic">${ic("contract")}</span>
            <span class="meq-callout__txt"><strong>En garantía del fabricante hasta el ${formatDate(equipment.warrantyUntil)}</strong><span>${warrantyDays <= 90 ? `Quedan ${plural(warrantyDays, "día", "días")}. ` : ""}Registra el contrato de mantención antes de que termine para no quedar sin cobertura.</span></span>${newButton}</div>`
        : `<div class="meq-callout meq-callout--danger"><span class="meq-alert__ic">${ic("contract")}</span>
            <span class="meq-callout__txt"><strong>${equipment.warrantyUntil ? `Sin contrato de mantención desde el ${formatDate(equipment.warrantyUntil)}` : "Sin contrato de mantención"}</strong><span>${equipment.warrantyUntil ? "Terminó la garantía del fabricante. " : ""}Mientras no haya contrato, las preventivas y las reparaciones no tienen proveedor ni plazos comprometidos.</span></span>${newButton}</div>`;

    return `${head}
        ${others.length ? `<section class="meq-sec"><div class="meq-sec__h"><h3>¿Lo cubre un contrato que ya existe?</h3><p>un mismo contrato puede cubrir varios equipos</p></div>
            <div class="meq-box meq-box--flush">${others.map(contract => {
                const covered = ctx.equipment.filter(item => item.contractId === contract.id && item.status !== "inactive").length;
                return `<div class="meq-agenda__row meq-agenda__row--2">
                    <span><strong>${esc(contract.provider || "Contrato")}${contract.tenderId ? ` · ${esc(contract.tenderId)}` : ""}</strong><span>${esc(contract.coverage || "Cobertura sin detallar")}${contract.endDate ? ` · hasta ${formatDate(contract.endDate)}` : ""} · ${plural(covered, "equipo", "equipos")}</span></span>
                    ${ctx.canEdit ? `<button class="meq-btn meq-btn--secondary meq-btn--sm" type="button" data-meq-act="contract-link" data-meq-contract="${attr(contract.id)}">Asociar</button>` : "<span></span>"}
                </div>`;
            }).join("")}</div>
        </section>` : ""}
        ${equipment.contacts.length ? `<section class="meq-sec"><div class="meq-sec__h"><h3>A quién llamar</h3>${ctx.canEdit ? `<button class="meq-link" type="button" data-meq-act="contact">Agregar contacto</button>` : ""}</div>${contactsHTML(equipment.contacts, ctx)}</section>` : ""}`;
}

function legacyContractHTML(snapshot, ctx) {
    const { contract } = snapshot;
    const rest = contract.endDate ? daysUntil(contract.endDate, ctx.today) : null;

    return `<div class="meq-callout">
            <span class="meq-alert__ic">${ic("contract")}</span>
            <span class="meq-callout__txt"><strong>Faltan los datos del contrato</strong><span>Hoy solo se sabe el proveedor${contract.endDate ? " y la vigencia" : ""}. Complétalo para ver sus compromisos, recibir el aviso de renovación a tiempo y compartirlo con otros equipos.</span></span>
            ${ctx.canEdit ? `<button class="meq-btn meq-btn--primary meq-btn--sm" type="button" data-meq-act="contract-complete">Completar contrato</button>` : ""}
        </div>
        <section class="meq-sec">
            <div class="meq-sec__h"><div><span class="meq-kicker">Contrato de mantención</span><h3 style="font-size:17px">${esc(contract.provider || "Proveedor sin nombre")}</h3></div>
                <span class="meq-pill meq-pill--${rest === null ? "warn" : rest < 0 ? "danger" : rest <= 90 ? "warn" : "ok"}">${rest === null ? "Sin fecha de término" : rest < 0 ? `Vencido hace ${-rest} d` : rest <= 90 ? `Vence en ${rest} d` : `Vigente hasta ${formatDate(contract.endDate)}`}</span></div>
        </section>
        <div class="meq-cols">
            <section class="meq-sec">
                <div class="meq-sec__h"><h3>Documentos del contrato</h3>${ctx.canEdit ? uploadLinkHTML("contract", "Adjuntar") : ""}</div>
                ${fileRowsHTML(contract.attachments, "contract", ctx, "Sin documentos. Adjunta el contrato firmado, las bases y los anexos.")}
            </section>
            <section class="meq-sec">
                <div class="meq-sec__h"><h3>A quién llamar</h3>${ctx.canEdit ? `<button class="meq-link" type="button" data-meq-act="contact">Agregar contacto</button>` : ""}</div>
                ${contactsHTML(contract.contacts, ctx)}
            </section>
        </div>`;
}

function preventivesDoneIn12Months(equipment, ctx) {
    const start12 = addDaysISO(ctx.today, -365);

    return equipment.maintenances.filter(record =>
        record.type === "preventive" &&
        record.date >= start12 &&
        maintenanceState(record, ctx.now) === "done"
    ).length;
}

function tabContractHTML(snapshot, ctx) {
    const { equipment, contract, metrics } = snapshot;

    if (equipment.status === "inactive") {
        return `<p class="meq-hint">El equipo está dado de baja; no mantiene contrato.</p>`;
    }

    if (!contract) return noContractHTML(snapshot, ctx);
    if (contract.legacy) return legacyContractHTML(snapshot, ctx);

    const rest = contract.endDate ? daysUntil(contract.endDate, ctx.today) : null;
    const tone = rest === null ? "warn" : rest <= 30 ? "danger" : rest <= 90 ? "warn" : "ok";
    const hasStart = Boolean(contract.startDate && contract.endDate && contract.startDate < contract.endDate);
    const progress = hasStart
        ? Math.max(0, Math.min(100, (daysBetween(contract.startDate, ctx.today) / daysBetween(contract.startDate, contract.endDate)) * 100))
        : 0;
    const covered = snapshot.contractEquipment;
    const start12 = addDaysISO(ctx.today, -365);
    const coveredDays = contract.startDate && contract.startDate > start12
        ? Math.max(0, daysBetween(contract.startDate, ctx.today))
        : 365;
    const expectedPreventives = Math.round(contract.preventivesPerYear * Math.min(1, coveredDays / 365));
    const donePreventives = preventivesDoneIn12Months(equipment, ctx);
    const rows = [];
    let pillLabel = "Vigente";

    if (rest === null) pillLabel = "Sin fecha de término";
    else if (rest < 0) pillLabel = `Vencido hace ${-rest} d`;
    else if (rest <= 90) pillLabel = `Vence en ${rest} d`;

    if (contract.responseHours) {
        rows.push([
            "Tiempo de respuesta",
            `${contract.responseHours} h`,
            metrics.responseAverage !== null
                ? `${metrics.responseAverage} h promedio · ${metrics.responseLate} de ${plural(metrics.responseCount, "visita", "visitas")} fuera de plazo`
                : "Sin visitas correctivas en 12 meses",
            metrics.responseAverage === null ? null : metrics.responseAverage <= contract.responseHours
        ]);
    }

    if (contract.preventivesPerYear) {
        rows.push([
            "Preventivas",
            `${contract.preventivesPerYear} al año`,
            `${donePreventives} en 12 meses${expectedPreventives !== contract.preventivesPerYear ? ` · esperadas ${expectedPreventives} desde el inicio` : ""}`,
            donePreventives >= expectedPreventives
        ]);
    }

    if (contract.guaranteedAvailability) {
        rows.push([
            "Disponibilidad",
            `≥ ${String(contract.guaranteedAvailability).replace(".", ",")} %`,
            formatPercent(metrics.availability),
            metrics.availability >= contract.guaranteedAvailability
        ]);
    }

    const verdict = value => value === null
        ? `<span class="meq-pill">Sin datos</span>`
        : `<span class="meq-pill meq-pill--${value ? "ok" : "danger"}">${ic(value ? "check" : "x")}${value ? "Sí" : "No"}</span>`;

    return `
        ${rest !== null && rest <= 90 ? `<div class="meq-callout ${rest < 0 ? "meq-callout--danger" : ""}">
            <span class="meq-alert__ic">${ic("clock")}</span>
            <span class="meq-callout__txt"><strong>${rest < 0 ? `Venció hace ${plural(-rest, "día", "días")} (${formatDate(contract.endDate)})` : `Vence en ${plural(rest, "día", "días")} (${formatDate(contract.endDate)})`}</strong><span>La tarjeta de renovación está en Kanban desde el ${formatDate(renewalCardDate(contract.endDate))}. Al renovar, carga la nueva vigencia aquí una sola vez: se aplica a los ${plural(covered.length, "equipo", "equipos")} que cubre.</span></span>
            ${ctx.canEdit ? `<button class="meq-btn meq-btn--primary meq-btn--sm" type="button" data-meq-act="contract-renew">Registrar renovación</button>` : ""}
        </div>` : ""}
        <section class="meq-sec">
            <div class="meq-sec__h">
                <div><span class="meq-kicker">${contract.tenderId ? `ID Mercado Público ${esc(contract.tenderId)}` : "Contrato de mantención"}</span><h3 style="font-size:17px">${esc(contract.provider || "Proveedor sin nombre")}</h3></div>
                <span class="meq-linkrow">${ctx.canEdit ? `<button class="meq-link" type="button" data-meq-act="contract-edit">Editar contrato</button>` : ""}<span class="meq-pill meq-pill--${tone}">${pillLabel}</span></span>
            </div>
            ${contract.endDate ? `<div style="display:grid;gap:6px">
                <div class="meq-vig__bar" data-meq-tip="${attr(hasStart ? `Transcurrido ${Math.round(progress)} % del contrato` : "Sin fecha de inicio registrada")}"><i class="${tone === "ok" ? "" : `meq-fill--${tone}`}" style="width:${hasStart ? progress : 100}%"></i></div>
                <div class="meq-vig__dates"><span>Inicio ${formatDate(contract.startDate)}</span><span>Término ${formatDate(contract.endDate)}</span></div>
            </div>` : ""}
            <dl class="meq-dl">
                <div><dt>Cobertura</dt><dd>${esc(contract.coverage || "—")}</dd></div>
                <div><dt>Monto</dt><dd>${esc(contract.amount || "—")}</dd></div>
                <div><dt>Administrador del contrato</dt><dd>${esc(contract.administrator || "—")}</dd></div>
                <div><dt>No cubre</dt><dd>${esc(contract.exclusions || "—")}</dd></div>
            </dl>
        </section>
        <section class="meq-sec">
            <div class="meq-sec__h"><h3>Lo que promete el contrato y lo que pasó</h3><p>últimos 12 meses · respaldo para multas o para la próxima licitación</p></div>
            ${rows.length
                ? `<div class="meq-tblwrap"><table class="meq-tbl"><thead><tr><th>Compromiso</th><th>Contrato</th><th>Real</th><th>Cumple</th></tr></thead><tbody>
                    ${rows.map(([label, promised, real, ok]) => `<tr><td><strong>${label}</strong></td><td>${esc(promised)}</td><td class="meq-num">${esc(real)}</td><td>${verdict(ok)}</td></tr>`).join("")}
                </tbody></table></div>`
                : `<p class="meq-hint">El contrato no tiene compromisos registrados (tiempo de respuesta, preventivas al año, disponibilidad). Edítalo para compararlos con lo que pasa.</p>`}
        </section>
        <div class="meq-cols">
            <section class="meq-sec">
                <div class="meq-sec__h"><h3>Equipos que cubre</h3>${ctx.canEdit ? `<button class="meq-link" type="button" data-meq-act="contract-edit">Cambiar</button>` : `<p>${plural(covered.length, "equipo", "equipos")}</p>`}</div>
                <div class="meq-chips">${covered.map(item => `<button class="meq-chip ${item.id === equipment.id ? "is-on" : ""}" type="button" data-meq-open="${attr(item.id)}" data-meq-tab="contrato">${ic("eq")}${esc(item.name)}</button>`).join("")}</div>
                <div class="meq-sec__h"><h3>Documentos del contrato</h3>${ctx.canEdit ? uploadLinkHTML("contract", "Adjuntar") : ""}</div>
                ${fileRowsHTML(contract.attachments, "contract", ctx, "Sin documentos. Adjunta el contrato firmado, las bases y los anexos.")}
                ${contract.previous.length ? `<div class="meq-sec__h"><h3>Contratos anteriores</h3></div>
                    <div class="meq-box" style="gap:6px">${contract.previous.map(item => `<span class="meq-hint"><b style="color:var(--meq-text-soft)">${formatDate(item.startDate)} a ${formatDate(item.endDate)}</b> · ${esc(item.provider || "Proveedor")}${item.coverage ? ` · ${esc(item.coverage)}` : ""}${item.attachments.length ? ` · ${plural(item.attachments.length, "documento", "documentos")}` : ""}</span>`).join("")}</div>` : ""}
            </section>
            <section class="meq-sec">
                <div class="meq-sec__h"><h3>A quién llamar</h3>${ctx.canEdit ? `<button class="meq-link" type="button" data-meq-act="contact">Agregar contacto</button>` : ""}</div>
                ${contactsHTML(contract.contacts, ctx)}
                <p class="meq-hint">Los contactos viven en el contrato: si cambia el ingeniero de campo, se actualiza una vez para todos sus equipos.</p>
            </section>
        </div>`;
}

/* ---------- pestaña Documentos ---------- */

function documentRowHTML(item, ctx) {
    const doc = item.doc;
    const notApplicable = item.status.level === "na";
    const view = doc
        ? `<button class="meq-link" type="button" data-meq-openfile="documents" data-meq-file="${attr(doc.id)}">Ver</button>`
        : "";
    let actions = "";

    if (!doc) {
        if (ctx.canEdit) {
            actions = notApplicable
                ? `<button class="meq-link" type="button" data-meq-act="doc-na" data-meq-doctype="${attr(item.id)}">Deshacer</button>`
                : `<button class="meq-btn meq-btn--secondary meq-btn--sm" type="button" data-meq-act="document" data-meq-doctype="${attr(item.id)}">Subir</button>
                   <button class="meq-link" type="button" data-meq-act="doc-na" data-meq-doctype="${attr(item.id)}">No aplica</button>`;
        }
    } else if (item.status.level === "ok") {
        actions = view;
    } else {
        actions = `${ctx.canEdit ? `<button class="meq-btn meq-btn--secondary meq-btn--sm" type="button" data-meq-act="document" data-meq-doctype="${attr(item.id)}">Renovar</button>` : ""}${view}`;
    }

    if (doc && ctx.canEdit) {
        actions += `<button class="meq-iconbtn" type="button" data-meq-act="delete-file" data-meq-group="documents" data-meq-file="${attr(doc.id)}" title="Quitar documento">${ic("trash")}</button>`;
    }

    const versions = item.versions.length > 1
        ? ` · ${plural(item.versions.length - 1, "versión anterior", "versiones anteriores")}`
        : "";
    const detail = doc
        ? `${esc(doc.name)} · subido el ${formatDate(doc.addedAt)}${versions}`
        : notApplicable ? "Marcado como no aplicable a este equipo" : "Aún no se sube";

    return `<div class="meq-doc">
        <span class="meq-doc__ic ${doc ? "" : "is-missing"}">${ic(doc ? "file" : "plus")}</span>
        <span style="min-width:0"><strong>${esc(item.label)}</strong><span>${detail}</span></span>
        <span class="meq-doc__side"><span class="meq-pill meq-pill--${item.status.tone}">${esc(item.status.label)}</span>${actions}</span>
    </div>`;
}

function tabDocumentsHTML(snapshot, ctx) {
    const { equipment, docs } = snapshot;
    const summary = docs.summary;
    const reason = equipment.ionizing === true
        ? "como emite radiación ionizante, pide autorización sanitaria, levantamiento radiométrico y control de calidad."
        : equipment.ionizing === false
            ? "este equipo no emite radiación ionizante, así que no pide los documentos de protección radiológica."
            : "indica en la ficha si emite radiación ionizante para saber si pide los documentos de protección radiológica.";

    return `
        <div class="meq-sec__h">
            <div class="meq-metric meq-metric--plain">
                <span class="meq-metric__lbl">Carpeta del equipo</span>
                <span class="meq-metric__val">${summary.ok} <small>de ${summary.total} documentos al día</small></span>
                <div class="meq-meter"><i class="${summary.ok === summary.total ? "meq-fill--ok" : "meq-fill--warn"}" style="width:${summary.total ? (summary.ok / summary.total) * 100 : 0}%"></i></div>
            </div>
            ${ctx.canEdit ? `<button class="meq-btn meq-btn--primary meq-btn--sm" type="button" data-meq-act="document">${ic("plus")}Subir documento</button>` : ""}
        </div>
        <p class="meq-hint" style="max-width:80ch">La lista de documentos esperados depende del tipo de equipo: ${reason} Los que vencen avisan con 60 días de anticipación.</p>
        ${docs.groups.map(group => {
            const counted = group.items.filter(item => item.status.level !== "na");
            const ok = counted.filter(item => item.status.level === "ok").length;
            return `<div class="meq-docgroup"><div class="meq-docgroup__h"><span>${esc(group.label)}</span><span class="meq-num">${ok}/${counted.length}</span></div>${group.items.map(item => documentRowHTML(item, ctx)).join("")}</div>`;
        }).join("")}
        ${docs.others.length ? `<div class="meq-docgroup"><div class="meq-docgroup__h"><span>Otros documentos</span><span class="meq-num">${docs.others.length}</span></div>${docs.others.map(doc => `<div class="meq-doc">
            <span class="meq-doc__ic">${ic("file")}</span>
            <span style="min-width:0"><strong>${esc(doc.name)}</strong><span>${doc.docType && documentTypeLabel(doc.docType) ? `${esc(documentTypeLabel(doc.docType))} · ` : ""}subido el ${formatDate(doc.addedAt)}</span></span>
            <span class="meq-doc__side">
                ${ctx.canEdit ? `<select aria-label="Clasificar ${attr(doc.name)}" data-meq-classify="${attr(doc.id)}"><option value="">Clasificar como…</option>${documentTypeOptions(equipment.ionizing).map(option => `<option value="${option.id}">${esc(option.label)}</option>`).join("")}</select>` : ""}
                <button class="meq-link" type="button" data-meq-openfile="documents" data-meq-file="${attr(doc.id)}">Ver</button>
                ${ctx.canEdit ? `<button class="meq-iconbtn" type="button" data-meq-act="delete-file" data-meq-group="documents" data-meq-file="${attr(doc.id)}" title="Quitar documento">${ic("trash")}</button>` : ""}
            </span>
        </div>`).join("")}</div>` : ""}`;
}

/* ---------- pestaña Hoja de vida ---------- */

const LIFE_FILTERS = [
    ["all", "Todo"],
    ["failure", "Fallas"],
    ["maintenance", "Mantenciones"],
    ["document", "Documentos"],
    ["milestone", "Estado y contrato"]
];
const LIFE_ICONS = { failure: "alert", maintenance: "wrench", document: "file", milestone: "history" };

function tabLifeHTML(snapshot, ctx) {
    const events = lifeEvents(snapshot, { now: ctx.now })
        .filter(event => ui.life === "all" || event.type === ui.life);
    const years = [...new Set(events.map(event => event.date.slice(0, 4)))];

    return `
        <div class="meq-sec__h">
            <div class="meq-seg" role="group" aria-label="Filtrar hoja de vida">${LIFE_FILTERS.map(([id, label]) =>
                `<button class="meq-chip ${ui.life === id ? "is-on" : ""}" type="button" data-meq-life="${id}">${label}</button>`
            ).join("")}</div>
            <button class="meq-btn meq-btn--secondary meq-btn--sm" type="button" data-meq-act="print-life">${ic("download")}Exportar PDF</button>
        </div>
        <p class="meq-hint">Todo lo que ha pasado con el equipo desde su instalación, en orden. Es el registro que se pide en auditorías y en acreditación.</p>
        <div class="meq-hv">${years.map(year => `<div class="meq-hv__year"><h4>${year}</h4>${events
            .filter(event => event.date.startsWith(year))
            .map(event => `<div class="meq-hv__ev">
                <span class="meq-hv__date">${event.date.slice(8, 10)}-${event.date.slice(5, 7)}</span>
                <span class="meq-hv__ic meq-hv__ic--${event.type}">${ic(LIFE_ICONS[event.type])}</span>
                <span class="meq-hv__txt"><strong>${esc(event.title)}</strong>${event.detail ? `<span>${esc(event.detail)}</span>` : ""}</span>
            </div>`).join("")}</div>`).join("") || `<p class="meq-hint">Sin registros para este filtro.</p>`}</div>`;
}

/* ---------- dialogos ---------- */

let dialogSubmit = null;
let dialogExtra = null;
let dialogAutonote = null;

function openDialog({ title, subtitle = "", body, submitLabel, onSubmit, extraLabel = "", onExtra = null, autonote = null }) {
    const layer = ensureLayer();
    const overlay = layer.querySelector("#meqOverlay");
    const dialog = layer.querySelector("#meqDialog");

    dialog.innerHTML = `<div class="meq-dialog__h">
            <div><h3 id="meqDialogTitle">${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div>
            <button class="meq-btn meq-btn--ghost meq-btn--sm" type="button" data-meq-dlg="close" aria-label="Cerrar">${ic("x")}</button>
        </div>
        <form novalidate>
            <div class="meq-dialog__b">${body}</div>
            <div class="meq-dialog__f">
                ${extraLabel ? `<button class="meq-btn meq-btn--ghost" type="button" data-meq-dlg="extra" style="margin-right:auto">${esc(extraLabel)}</button>` : ""}
                <button class="meq-btn meq-btn--ghost" type="button" data-meq-dlg="close">Cancelar</button>
                <button class="meq-btn meq-btn--primary" type="submit">${esc(submitLabel)}</button>
            </div>
        </form>`;
    dialogSubmit = onSubmit;
    dialogExtra = onExtra;
    dialogAutonote = autonote;
    overlay.hidden = false;
    updateAutonote();
    dialog.querySelector("input:not([type=file]), select, textarea")?.focus();
}

function closeDialog() {
    const overlay = document.getElementById("meqOverlay");

    if (overlay) overlay.hidden = true;
    dialogSubmit = null;
    dialogExtra = null;
    dialogAutonote = null;
}

function updateAutonote() {
    const form = document.querySelector("#meqDialog form");
    if (form && dialogAutonote) dialogAutonote(form);
}

async function submitDialog(form) {
    if (busy || !dialogSubmit) return;

    const button = form.querySelector('button[type="submit"]');
    const label = button?.textContent || "";

    busy = true;
    if (button) {
        button.disabled = true;
        button.textContent = "Guardando…";
    }

    try {
        const result = await dialogSubmit(form);

        if (result !== false) {
            closeDialog();
            renderMedicalEquipmentPanel();
        }
    } catch (error) {
        toast(error?.message || "No se pudo guardar. Intenta nuevamente.");
    } finally {
        busy = false;
        if (button?.isConnected) {
            button.disabled = false;
            button.textContent = label;
        }
    }
}

function fieldHTML(id, label, value = "", { type = "text", wide = false, attrs = "", hint = "" } = {}) {
    return `<label class="meq-field ${wide ? "is-wide" : ""}" for="${id}"><span>${label}</span><input id="${id}" type="${type}" value="${attr(value ?? "")}" ${attrs}>${hint ? `<small>${hint}</small>` : ""}</label>`;
}

function textareaHTML(id, label, value = "", placeholder = "") {
    return `<label class="meq-field is-wide" for="${id}"><span>${label}</span><textarea id="${id}" placeholder="${attr(placeholder)}">${esc(value || "")}</textarea></label>`;
}

function segHTML(name, options, selected) {
    return `<div class="meq-seg" data-meq-seg="${name}">${options.map(([value, label]) =>
        `<button type="button" class="meq-chip ${value === selected ? "is-on" : ""}" data-meq-segv="${attr(value)}">${esc(label)}</button>`
    ).join("")}</div>`;
}

function segValue(form, name) {
    return form.querySelector(`[data-meq-seg="${name}"] .meq-chip.is-on`)?.dataset.meqSegv ?? "";
}

function dropHTML(id, label, icon = "file") {
    return `<label class="meq-drop" for="${id}">${ic(icon)}<span data-meq-droplabel data-default="${attr(label)}">${esc(label)}</span><input id="${id}" type="file" multiple accept="${ATTACHMENT_ACCEPT}"></label>`;
}

function taskChipHTML(task, on) {
    return `<button type="button" class="meq-chip ${on ? "is-on" : ""}" data-meq-multiv="${attr(task.id)}">${esc(task.title)}</button>`;
}

function allTaskChipsHTML(selected, ctx) {
    return ctx.tasks.length
        ? `<div class="meq-chips" data-meq-multi="tasks">${ctx.tasks.map(task => taskChipHTML(task, selected.includes(task.id))).join("")}</div>`
        : `<span class="meq-hint">No hay tareas creadas en Asignación de Tareas.</span>`;
}

function taskChipsWithMoreHTML(selected, equipmentTaskIds, ctx) {
    if (!ctx.tasks.length) return `<span class="meq-hint">No hay tareas creadas en Asignación de Tareas.</span>`;

    const primary = ctx.tasks.filter(task => equipmentTaskIds.includes(task.id) || selected.includes(task.id));
    const rest = ctx.tasks.filter(task => !primary.includes(task));

    return `<div class="meq-chips" data-meq-multi="tasks">
        ${primary.map(task => taskChipHTML(task, selected.includes(task.id))).join("")}
        ${rest.length ? `<button type="button" class="meq-chip" data-meq-dlg="more-tasks">${ic("plus")}Otra tarea</button><span data-meq-moretasks hidden style="display:contents">${rest.map(task => taskChipHTML(task, false)).join("")}</span>` : ""}
    </div>`;
}

function multiValues(form, name) {
    return [...form.querySelectorAll(`[data-meq-multi="${name}"] .meq-chip.is-on[data-meq-multiv]`)]
        .map(button => button.dataset.meqMultiv);
}

function val(form, id) {
    return String(form.querySelector(`#${id}`)?.value ?? "").trim();
}

function filesOf(form, id) {
    return form.querySelector(`#${id}`)?.files || [];
}

async function uploadFiles(equipmentId, recordId, fileList) {
    try {
        return await readAttachmentFiles(fileList, {
            moduleId: "medicalEquipment",
            ownerId: equipmentId,
            recordId: String(recordId).replace(/[^a-zA-Z0-9_-]+/g, "_")
        });
    } catch (error) {
        // Las validaciones (formato, tamaño, plan) traen su propio mensaje.
        const storageError = error?.code || error?.planBlocked || error?.attachmentStorageMessage;
        throw new Error(storageError || !error?.message
            ? attachmentStorageErrorMessage(error, "subir")
            : error.message);
    }
}

function withStatus(equipment, status, note = "") {
    if (status === equipment.status) return equipment;

    return {
        ...equipment,
        status,
        downSince: status === "maintenance" ? todayISO() : "",
        statusHistory: [
            ...equipment.statusHistory,
            { date: todayISO(), status, byName: currentUserName(), note }
        ]
    };
}

/* ---------- dialogos: falla, mantencion, estado, ficha ---------- */

function openFailureDialog(snapshot, ctx) {
    const equipment = snapshot.equipment;
    const names = titlesFor(equipment.taskIds, ctx);

    openDialog({
        title: "Registrar falla",
        subtitle: `${equipment.name} · ${equipment.code || "sin código"}`,
        submitLabel: "Registrar falla",
        body: `
            ${fieldHTML("meqFTitle", "¿Qué le pasa al equipo?", "", { attrs: 'placeholder="Ej: Detector no se conecta" maxlength="160"' })}
            <div class="meq-field"><span>Gravedad</span>${segHTML("severity", [["low", "Baja"], ["medium", "Media"], ["high", "Alta"], ["critical", "Crítica"]], "medium")}</div>
            <div class="meq-field"><span>¿Se puede seguir usando?</span>${segHTML("down", [["no", "Sí, con la falla"], ["yes", "No, quedó fuera de servicio"]], "no")}
                <small>${names.length ? `Si quedó fuera de servicio se inactivan ${esc(names.join(", "))} en Asignación de Tareas y la PWA lo muestra como no disponible.` : "Si quedó fuera de servicio, la PWA lo muestra como no disponible."}</small></div>
            ${textareaHTML("meqFDetail", "Detalle", "", "Qué ocurre, desde cuándo y qué se intentó")}
            <div class="meq-field"><span>Fotos o videos</span>${dropHTML("meqFFiles", "Arrastra o toca para adjuntar", "camera")}</div>`,
        onSubmit: async form => {
            const title = val(form, "meqFTitle");

            if (!title) {
                form.querySelector("#meqFTitle")?.focus();
                throw new Error("Escribe en pocas palabras qué le pasa al equipo.");
            }

            const id = makeId("equipment_error");
            const files = filesOf(form, "meqFFiles");
            const attachments = files.length ? await uploadFiles(equipment.id, `error_${id}`, files) : [];
            const down = segValue(form, "down") === "yes";

            updateEquipment(equipment.id, item => {
                const next = {
                    ...item,
                    errors: [{
                        id,
                        title,
                        detail: val(form, "meqFDetail"),
                        severity: segValue(form, "severity") || "medium",
                        status: "open",
                        date: todayISO(),
                        reportedByName: currentUserName(),
                        source: "supervisor",
                        attachments,
                        outOfService: down,
                        createdAt: new Date().toISOString()
                    }, ...item.errors]
                };

                return down ? withStatus(next, "maintenance", `Falla: ${title}`) : next;
            });

            ui.tab = "fallas";
            ui.failures = "open";
            toast(down
                ? `Falla registrada. ${equipment.name} quedó fuera de servicio y sus tareas, inactivas.`
                : "Falla registrada. Ya aparece en la pestaña Fallas.");
        }
    });
}

function openMaintenanceDialog(snapshot, ctx, { mode = "register", recordId = "", failureId = "" } = {}) {
    const equipment = snapshot.equipment;
    const record = recordId ? equipment.maintenances.find(item => item.id === recordId) : null;
    const schedule = mode === "schedule";
    const openFailures = snapshot.failures.filter(failure => isOpenFailure(failure) && !failure.maintenance);
    const type = record?.type || (failureId ? "corrective" : "preventive");
    const baseDate = equipment.nextMaintenanceAt && equipment.nextMaintenanceAt > ctx.today
        ? equipment.nextMaintenanceAt
        : addDaysISO(ctx.today, 1);
    const start = record?.startAt || (schedule ? `${baseDate}T08:00` : "");
    const end = record?.endAt || (schedule ? `${baseDate}T12:00` : "");
    const selectedTasks = record?.taskIds?.length ? record.taskIds : equipment.taskIds;
    const frequency = equipment.maintenanceFrequencyDays;
    const title = schedule
        ? "Agendar mantención"
        : mode === "complete" ? "Registrar mantención realizada" : "Registrar mantención";

    openDialog({
        title,
        subtitle: `${equipment.name} · ${equipment.code || "sin código"}`,
        submitLabel: schedule ? "Agendar" : "Guardar mantención",
        extraLabel: failureId ? "Se resolvió sin mantención" : "",
        onExtra: failureId
            ? async () => {
                await updateFailure(equipment.id, failureId, { status: "resolved", resolvedAt: new Date().toISOString() });
                closeDialog();
                toast("Falla marcada como resuelta sin intervención técnica.");
                renderMedicalEquipmentPanel();
            }
            : null,
        body: `
            <div class="meq-field"><span>Tipo</span>${segHTML("mtype", Object.entries(MAINTENANCE_TYPE_LABELS), type)}</div>
            <div class="meq-fgrid">
                ${fieldHTML("meqMStart", schedule ? "Desde" : "Fuera de servicio desde", start.slice(0, 16), { type: "datetime-local" })}
                ${fieldHTML("meqMEnd", "Hasta", end.slice(0, 16), { type: "datetime-local", hint: schedule ? "" : "Déjalo vacío si sigue en reparación." })}
                ${fieldHTML("meqMProvider", "Proveedor", record?.provider || snapshot.contract?.provider || "")}
                ${fieldHTML("meqMTech", "Técnico", record?.technician || "", { attrs: 'placeholder="Nombre del técnico"' })}
            </div>
            ${schedule
                ? `<div class="meq-field"><span>¿Confirmada con el proveedor?</span>${segHTML("confirmed", [["yes", "Sí"], ["no", "Todavía no"]], record?.confirmed ? "yes" : "no")}</div>`
                : `<label class="meq-field" for="meqMFailure"><span>¿Qué falla resuelve?</span><select id="meqMFailure"><option value="">Ninguna (mantención programada)</option>${openFailures.map(failure =>
                    `<option value="${attr(failure.id)}" ${failure.id === failureId ? "selected" : ""}>${esc(failure.title)} · ${formatDate(failure.date)}</option>`
                ).join("")}</select><small>La falla elegida queda cerrada y enlazada a esta mantención; así se calcula el tiempo de reparación.</small></label>`}
            ${textareaHTML("meqMSummary", schedule ? "Qué se hará" : "Trabajo realizado", record?.summary || "", schedule ? "Ej: Preventiva semestral del contrato" : "Qué se hizo, repuestos cambiados, pruebas")}
            ${schedule ? "" : `<div class="meq-field"><span>Informe técnico del proveedor</span>${dropHTML("meqMFiles", "Adjuntar informe (PDF o foto)")}<small>Sin informe, la mantención queda marcada como pendiente de respaldo.</small></div>`}
            <div class="meq-field"><span>Tareas inactivas mientras dura</span>${taskChipsWithMoreHTML(selectedTasks, equipment.taskIds, ctx)}</div>
            <div class="meq-autonote" data-meq-autonote>${ic("cal")}<span></span></div>`,
        autonote: form => {
            const note = form.querySelector("[data-meq-autonote] span");
            if (!note) return;

            const currentType = segValue(form, "mtype");
            const from = val(form, "meqMStart");
            const to = val(form, "meqMEnd");
            const date = from.slice(0, 10);

            if (schedule) {
                note.textContent = date
                    ? `Queda en el calendario el ${formatDate(date)}${currentType === "preventive" ? " como la próxima preventiva" : ""}. Las tareas elegidas se inactivan en ese horario.`
                    : "Elige la fecha y el horario de la visita.";
            } else if (from && !to && from <= localISODateTime()) {
                note.textContent = "Sin término queda en curso: el equipo pasa a Fuera de servicio y sus tareas siguen inactivas hasta que la termines.";
            } else if (currentType === "preventive" && frequency && date) {
                note.textContent = `Próxima preventiva: ${formatDate(addDaysISO(date, frequency))} (fecha + ${frequency} días). Se agenda sola en el calendario.`;
            } else {
                note.textContent = equipment.nextMaintenanceAt
                    ? `La próxima preventiva se mantiene el ${formatDate(equipment.nextMaintenanceAt)}.`
                    : "El equipo no tiene próxima preventiva definida.";
            }
        },
        onSubmit: async form => {
            const startAt = val(form, "meqMStart");
            const endAt = val(form, "meqMEnd");
            const kind = segValue(form, "mtype") || "preventive";
            const nowLocal = localISODateTime();

            if (!startAt) {
                throw new Error(schedule ? "Indica cuándo será la mantención." : "Indica desde cuándo estuvo el equipo fuera de servicio.");
            }
            if (endAt && endAt < startAt) throw new Error("El término no puede ser anterior al inicio.");
            if (schedule && startAt <= nowLocal) {
                throw new Error("Para agendar elige una fecha futura. Si ya ocurrió, usa «Registrar mantención».");
            }
            if (!schedule && startAt > nowLocal) {
                throw new Error("Esa fecha todavía no llega: usa «Agendar» en la pestaña Mantenciones.");
            }

            const failure = schedule ? "" : val(form, "meqMFailure");
            const files = schedule ? [] : filesOf(form, "meqMFiles");
            const id = record?.id || makeId("equipment_maintenance");
            const attachments = files.length ? await uploadFiles(equipment.id, `maintenance_${id}`, files) : [];
            const next = {
                ...(record || {}),
                id,
                type: kind,
                date: startAt.slice(0, 10),
                startAt,
                endAt,
                provider: val(form, "meqMProvider"),
                technician: val(form, "meqMTech"),
                summary: val(form, "meqMSummary"),
                taskIds: multiValues(form, "tasks"),
                confirmed: schedule ? segValue(form, "confirmed") === "yes" : Boolean(record?.confirmed),
                resolvesFailureIds: [...new Set([...(record?.resolvesFailureIds || []), ...(failure ? [failure] : [])])],
                attachments: [...(record?.attachments || []), ...attachments],
                createdAt: record?.createdAt || new Date().toISOString()
            };
            const state = maintenanceState(next, nowLocal);

            updateEquipment(equipment.id, item => {
                let updated = {
                    ...item,
                    maintenances: record
                        ? item.maintenances.map(entry => entry.id === id ? next : entry)
                        : [next, ...item.maintenances]
                };

                if (kind === "preventive") {
                    if (state === "scheduled") {
                        updated = { ...updated, nextMaintenanceAt: next.date, nextMaintenanceConfirmed: next.confirmed };
                    } else if (item.maintenanceFrequencyDays) {
                        updated = {
                            ...updated,
                            nextMaintenanceAt: addDaysISO(next.date, item.maintenanceFrequencyDays),
                            nextMaintenanceConfirmed: false
                        };
                    }
                }

                if (state === "ongoing") {
                    updated = withStatus(updated, "maintenance", `${MAINTENANCE_TYPE_LABELS[kind]} en curso`);
                } else if (state === "done" && item.status === "maintenance" && failure) {
                    updated = withStatus(updated, "operational", "Reparado");
                }

                return updated;
            });

            if (failure) {
                const current = snapshot.failures.find(item => item.id === failure);

                if (state === "done") {
                    await updateFailure(equipment.id, failure, {
                        status: "resolved",
                        resolvedAt: parseDateTime(endAt || startAt)?.toISOString() || new Date().toISOString()
                    });
                } else if (state === "ongoing" && current?.status === "open") {
                    await updateFailure(equipment.id, failure, { status: "review" });
                }
            }

            // Si se cerro una falla desde su tarjeta, se queda en Fallas para
            // verla resuelta con su reparacion.
            if (!failureId) ui.tab = "mantenciones";

            if (schedule) {
                toast("Mantención agendada: ya aparece en el calendario.");
            } else if (state === "ongoing") {
                toast("Mantención registrada en curso. El equipo quedó fuera de servicio hasta que la termines.");
            } else {
                const missingReport = !next.attachments.length ? " Queda pendiente el informe técnico." : "";
                toast(`${failure ? "Mantención guardada y falla cerrada." : "Mantención guardada."}${missingReport}`);
            }
        }
    });
}

function openStatusDialog(snapshot, ctx) {
    const equipment = snapshot.equipment;
    const names = titlesFor(equipment.taskIds, ctx);
    const options = [
        ["operational", "Operativo", "Funciona sin observaciones."],
        ["limited", "Operativo con observación", "Se puede usar; la PWA muestra un aviso a los trabajadores."],
        ["maintenance", "Fuera de servicio", names.length
            ? `No se puede usar. Se inactivan ${names.join(", ")} y la PWA lo muestra como no disponible.`
            : "No se puede usar. La PWA lo muestra como no disponible."]
    ];

    openDialog({
        title: "Cambiar estado",
        subtitle: equipment.name,
        submitLabel: "Guardar estado",
        body: `${options.map(([value, label, detail]) => `<label class="meq-opt"><input type="radio" name="meqStatus" value="${value}" ${equipment.status === value ? "checked" : ""}><strong>${label}</strong><span>${esc(detail)}</span></label>`).join("")}
            <p class="meq-hint">Para retirar el equipo usa «Dar de baja»: conserva el historial y los documentos.</p>`,
        onSubmit: form => {
            const value = form.querySelector('input[name="meqStatus"]:checked')?.value;
            if (!value || value === equipment.status) return;

            updateEquipment(equipment.id, item => withStatus(item, value));
            toast(`Estado actualizado: ${EQUIPMENT_STATUS[value].label}. La PWA lo verá en segundos.`);
        }
    });
}

function equipmentFormBody(equipment, ctx) {
    return `<span class="meq-kicker">Identificación</span>
        <div class="meq-fgrid">
            ${fieldHTML("meqEName", "Nombre del equipo", equipment.name, { attrs: 'maxlength="180"' })}
            ${fieldHTML("meqEType", "Tipo de equipo", equipment.equipmentType, { attrs: 'placeholder="Ej: Rayos X digital"' })}
            ${fieldHTML("meqEBrand", "Marca", equipment.brand)}
            ${fieldHTML("meqEModel", "Modelo", equipment.model)}
            ${fieldHTML("meqECode", "Código inventario", equipment.code)}
            ${fieldHTML("meqESerial", "N° de serie", equipment.serialNumber)}
        </div>
        <span class="meq-kicker">Ubicación y uso</span>
        <div class="meq-fgrid">
            ${fieldHTML("meqELocation", "Ubicación", equipment.location)}
            <label class="meq-field" for="meqECrit"><span>Criticidad</span><select id="meqECrit"><option value="">Sin clasificar</option>${Object.entries(CRITICALITY_LABELS).map(([value, label]) => `<option value="${value}" ${equipment.criticality === value ? "selected" : ""}>${label}</option>`).join("")}</select><small>Crítico: si falla, se detiene la atención de pacientes.</small></label>
            <div class="meq-field is-wide"><span>¿Emite radiación ionizante?</span>${segHTML("ionizing", [["yes", "Sí"], ["no", "No"]], equipment.ionizing === true ? "yes" : equipment.ionizing === false ? "no" : "")}<small>Define qué documentos pide la carpeta: autorización sanitaria, levantamiento radiométrico y control de calidad.</small></div>
            <div class="meq-field is-wide"><span>Tareas que dependen de este equipo</span>${allTaskChipsHTML(equipment.taskIds || [], ctx)}<small>Se inactivan solas mientras el equipo esté fuera de servicio o en mantención.</small></div>
        </div>
        <span class="meq-kicker">Fechas y plan</span>
        <div class="meq-fgrid">
            ${fieldHTML("meqEPurchase", "Fecha de compra", equipment.purchaseDate, { type: "date" })}
            ${fieldHTML("meqEInstalled", "Instalación", equipment.installedAt, { type: "date" })}
            ${fieldHTML("meqEWarranty", "Garantía hasta", equipment.warrantyUntil, { type: "date" })}
            ${fieldHTML("meqELife", "Vida útil (años)", equipment.usefulLifeYears || "", { type: "number", attrs: 'min="0" max="40"' })}
            ${fieldHTML("meqEFreq", "Preventiva cada (días)", equipment.maintenanceFrequencyDays || "", { type: "number", attrs: 'min="0" max="3650"' })}
            ${fieldHTML("meqENext", "Próxima preventiva", equipment.nextMaintenanceAt, { type: "date" })}
        </div>
        <span class="meq-kicker">Notas</span>
        <div class="meq-fgrid">
            ${textareaHTML("meqEDetails", "Detalles del equipo", equipment.details)}
            ${textareaHTML("meqERecs", "Recomendaciones del fabricante", equipment.manufacturerRecommendations)}
        </div>`;
}

function readEquipmentForm(form) {
    const ionizing = segValue(form, "ionizing");

    return {
        name: val(form, "meqEName"),
        equipmentType: val(form, "meqEType"),
        brand: val(form, "meqEBrand"),
        model: val(form, "meqEModel"),
        code: val(form, "meqECode"),
        serialNumber: val(form, "meqESerial"),
        location: val(form, "meqELocation"),
        criticality: val(form, "meqECrit"),
        ionizing: ionizing === "yes" ? true : ionizing === "no" ? false : null,
        taskIds: multiValues(form, "tasks"),
        purchaseDate: val(form, "meqEPurchase"),
        installedAt: val(form, "meqEInstalled"),
        warrantyUntil: val(form, "meqEWarranty"),
        usefulLifeYears: val(form, "meqELife"),
        maintenanceFrequencyDays: val(form, "meqEFreq"),
        nextMaintenanceAt: val(form, "meqENext"),
        details: val(form, "meqEDetails"),
        manufacturerRecommendations: val(form, "meqERecs")
    };
}

function openEquipmentFormDialog(snapshot, ctx) {
    const editing = Boolean(snapshot);
    const equipment = snapshot?.equipment || normalizeMedicalEquipmentItem({ id: "new", name: "" });

    openDialog({
        title: editing ? "Editar ficha técnica" : "Nuevo equipo",
        subtitle: editing ? equipment.name : "Con nombre, código y ubicación ya aparece en la PWA; lo demás se completa después.",
        submitLabel: editing ? "Guardar ficha" : "Crear equipo",
        body: equipmentFormBody(equipment, ctx),
        onSubmit: form => {
            const fields = readEquipmentForm(form);

            if (!fields.name) {
                form.querySelector("#meqEName")?.focus();
                throw new Error("Ponle un nombre al equipo.");
            }

            if (editing) {
                upsertEquipment({ ...equipment, ...fields });
                toast("Ficha guardada. Nombre, ubicación y tareas se publican solos en la PWA.");
                return;
            }

            const id = makeId("equipment");

            upsertEquipment({
                ...fields,
                id,
                status: "operational",
                statusHistory: [{ date: todayISO(), status: "operational", byName: currentUserName(), note: "Alta del equipo" }],
                createdByUid: getCurrentFirebaseUser()?.uid || "",
                createdAt: new Date().toISOString()
            });
            selectMedicalEquipment(id, "resumen");
            toast("Equipo creado. Completa su contrato y documentos cuando los tengas.");
        }
    });
}

function openInactivateDialog(snapshot) {
    const equipment = snapshot.equipment;

    openDialog({
        title: "Dar de baja",
        subtitle: equipment.name,
        submitLabel: "Dar de baja",
        body: `<div class="meq-fgrid">
                ${fieldHTML("meqBDate", "Fecha de baja", todayISO(), { type: "date" })}
                ${fieldHTML("meqBReason", "Motivo", "", { attrs: 'placeholder="Ej: Obsolescencia, sin repuestos"' })}
            </div>
            <p class="meq-hint">El historial, los documentos y los contratos se conservan. Deja de aparecer en la PWA y en los indicadores.</p>`,
        onSubmit: form => {
            const reason = val(form, "meqBReason");

            updateEquipment(equipment.id, item => ({
                ...withStatus(item, "inactive", reason),
                inactiveAt: val(form, "meqBDate") || todayISO(),
                inactiveReason: reason
            }));
            toast("Equipo dado de baja. Su historial se conserva.");
        }
    });
}

function openNoteDialog(snapshot, failureId) {
    const failure = snapshot.failures.find(item => item.id === failureId);
    if (!failure) return;

    openDialog({
        title: failure.note ? "Editar nota" : "Agregar nota",
        subtitle: failure.title,
        submitLabel: "Guardar nota",
        body: `${textareaHTML("meqNText", "Nota de supervisión", failure.note, "Ej: Visita técnica agendada, N° de caso del proveedor")}
            <p class="meq-hint">La nota sale en el historial impreso que se le entrega al técnico.</p>`,
        onSubmit: async form => {
            await updateFailure(snapshot.equipment.id, failureId, { note: val(form, "meqNText") });
            toast("Nota guardada.");
        }
    });
}

/* ---------- dialogos: contrato, contactos y documentos ---------- */

function openContractDialog(snapshot, ctx, mode) {
    const equipment = snapshot.equipment;
    const current = snapshot.contract && !snapshot.contract.legacy ? snapshot.contract : null;
    const legacy = snapshot.contract?.legacy ? snapshot.contract : null;
    let base = {};

    if (mode === "edit" && current) base = current;
    if (mode === "renew" && current) {
        base = {
            ...current,
            startDate: current.endDate ? addDaysISO(current.endDate, 1) : "",
            endDate: "",
            tenderId: "",
            amount: ""
        };
    }
    if (mode === "complete" && legacy) base = { provider: legacy.provider, endDate: legacy.endDate };

    const covered = (mode === "edit" || mode === "renew") && current
        ? snapshot.contractEquipment.map(item => item.id)
        : [equipment.id];
    const candidates = ctx.equipment.filter(item => item.status !== "inactive");
    const titles = {
        new: "Registrar contrato",
        edit: "Editar contrato",
        renew: "Registrar renovación",
        complete: "Completar contrato"
    };

    openDialog({
        title: titles[mode] || "Contrato",
        subtitle: mode === "renew" && current
            ? `El contrato actual (${current.provider} hasta ${formatDate(current.endDate)}) pasa a «Contratos anteriores» con sus documentos.`
            : "Un mismo contrato puede cubrir varios equipos.",
        submitLabel: mode === "renew" ? "Registrar renovación" : "Guardar contrato",
        body: `<div class="meq-fgrid">
                ${fieldHTML("meqCProvider", "Proveedor", base.provider)}
                ${fieldHTML("meqCTender", "ID Mercado Público", base.tenderId, { attrs: 'placeholder="Ej: 1057480-38-LQ24"' })}
                ${fieldHTML("meqCCoverage", "Cobertura", base.coverage, { wide: true, attrs: 'placeholder="Ej: Preventiva y correctiva, con repuestos"' })}
                ${fieldHTML("meqCStart", "Inicio", base.startDate, { type: "date" })}
                ${fieldHTML("meqCEnd", "Término", base.endDate, { type: "date", hint: "Tres meses antes aparece la tarjeta de renovación en Kanban." })}
                ${fieldHTML("meqCAmount", "Monto", base.amount, { attrs: 'placeholder="Ej: $ 21.600.000 anual"' })}
                ${fieldHTML("meqCAdmin", "Administrador del contrato", base.administrator)}
                ${fieldHTML("meqCResponse", "Tiempo de respuesta (horas)", base.responseHours || "", { type: "number", attrs: 'min="0" max="720"' })}
                ${fieldHTML("meqCPreventives", "Preventivas incluidas al año", base.preventivesPerYear || "", { type: "number", attrs: 'min="0" max="52"' })}
                ${fieldHTML("meqCAvailability", "Disponibilidad garantizada (%)", base.guaranteedAvailability || "", { type: "number", attrs: 'min="0" max="100" step="0.1"' })}
                ${textareaHTML("meqCExclusions", "No cubre", base.exclusions, "Ej: Tubo de rayos X, accesorios")}
                <div class="meq-field is-wide"><span>Equipos que cubre</span><div class="meq-chips" data-meq-multi="equipment">${candidates.map(item => `<button type="button" class="meq-chip ${covered.includes(item.id) ? "is-on" : ""}" data-meq-multiv="${attr(item.id)}">${esc(item.name)}</button>`).join("")}</div></div>
            </div>`,
        onSubmit: form => {
            const provider = val(form, "meqCProvider");
            const startDate = val(form, "meqCStart");
            const endDate = val(form, "meqCEnd");
            const ids = multiValues(form, "equipment");

            if (!provider) throw new Error("Indica el proveedor del contrato.");
            if (startDate && endDate && endDate < startDate) throw new Error("El término no puede ser anterior al inicio.");
            if (!ids.length) throw new Error("Elige al menos un equipo que cubra el contrato.");

            const fields = {
                provider,
                tenderId: val(form, "meqCTender"),
                coverage: val(form, "meqCCoverage"),
                startDate,
                endDate,
                amount: val(form, "meqCAmount"),
                administrator: val(form, "meqCAdmin"),
                responseHours: val(form, "meqCResponse"),
                preventivesPerYear: val(form, "meqCPreventives"),
                guaranteedAvailability: val(form, "meqCAvailability"),
                exclusions: val(form, "meqCExclusions")
            };
            let contract;

            if (mode === "edit" && current) {
                contract = { ...current, ...fields };
            } else if (mode === "renew" && current) {
                contract = {
                    ...current,
                    ...fields,
                    attachments: [],
                    previous: [{
                        provider: current.provider,
                        tenderId: current.tenderId,
                        coverage: current.coverage,
                        startDate: current.startDate,
                        endDate: current.endDate,
                        amount: current.amount,
                        attachments: current.attachments
                    }, ...current.previous]
                };
            } else if (mode === "complete" && legacy) {
                contract = { id: makeId("contract"), ...fields, contacts: legacy.contacts, attachments: legacy.attachments, previous: [] };
            } else {
                contract = { id: makeId("contract"), ...fields, contacts: [], attachments: [], previous: [] };
            }

            saveContract(contract, ids);

            // Lo que el equipo guardaba suelto se muda al contrato.
            if (mode === "complete") {
                updateEquipment(equipment.id, item => ({ ...item, contacts: [], contractAttachments: [] }));
            }

            toast(mode === "renew"
                ? "Renovación registrada. La nueva vigencia se aplicó a todos sus equipos."
                : `Contrato guardado. Cubre ${plural(ids.length, "equipo", "equipos")}.`);
        }
    });
}

function linkToContract(snapshot, ctx, contractId) {
    const contract = ctx.contracts.find(item => item.id === contractId);
    if (!contract) return;

    const ids = ctx.equipment.filter(item => item.contractId === contractId).map(item => item.id);

    saveContract(contract, [...ids, snapshot.equipment.id]);
    toast(`${snapshot.equipment.name} quedó cubierto por el contrato de ${contract.provider || "ese proveedor"}.`);
    renderMedicalEquipmentPanel();
}

function openContactDialog(snapshot) {
    const contract = snapshot.contract && !snapshot.contract.legacy ? snapshot.contract : null;

    openDialog({
        title: "Agregar contacto",
        subtitle: contract ? `Contrato ${contract.provider}` : snapshot.equipment.name,
        submitLabel: "Agregar contacto",
        body: `<div class="meq-fgrid">
                ${fieldHTML("meqKName", "Nombre", "", { attrs: 'placeholder="Ej: Mesa de ayuda"' })}
                ${fieldHTML("meqKRole", "Cargo o rol", "", { attrs: 'placeholder="Ej: Ingeniero de campo"' })}
                ${fieldHTML("meqKPhone", "Teléfono", "", { type: "tel" })}
                ${fieldHTML("meqKMail", "Correo", "", { type: "email" })}
                ${textareaHTML("meqKNotes", "Notas", "", "Ej: Pedir siempre el N° de caso")}
            </div>`,
        onSubmit: form => {
            const contact = normalizeContact({
                name: val(form, "meqKName"),
                role: val(form, "meqKRole"),
                phone: val(form, "meqKPhone"),
                email: val(form, "meqKMail"),
                notes: val(form, "meqKNotes")
            });

            if (!contact) throw new Error("Ingresa al menos un nombre, teléfono o correo.");

            if (contract) saveContract({ ...contract, contacts: [...contract.contacts, contact] });
            else updateEquipment(snapshot.equipment.id, item => ({ ...item, contacts: [...item.contacts, contact] }));

            toast("Contacto agregado.");
        }
    });
}

function openDocumentDialog(snapshot, docType = "") {
    const equipment = snapshot.equipment;
    const options = documentTypeOptions(equipment.ionizing);
    const firstMissing = snapshot.docs.summary.missing[0]?.id || "";
    const selected = docType || firstMissing;
    const renewing = Boolean(docType && snapshot.docs.groups.some(group => group.items.some(item => item.id === docType && item.doc)));
    const label = documentTypeLabel(docType);

    openDialog({
        title: docType ? `${renewing ? "Renovar" : "Subir"}: ${label}` : "Subir documento",
        subtitle: equipment.name,
        submitLabel: "Subir documento",
        body: `<label class="meq-field" for="meqDType"><span>Tipo de documento</span><select id="meqDType">${options.map(option =>
                `<option value="${option.id}" ${option.id === selected ? "selected" : ""}>${esc(option.label)}</option>`
            ).join("")}<option value="" ${selected ? "" : "selected"}>Otro documento</option></select></label>
            ${fieldHTML("meqDExpires", "Vence el", "", { type: "date", hint: "Solo si el documento tiene vencimiento: se avisa 60 días antes." })}
            <div class="meq-field"><span>Archivo</span>${dropHTML("meqDFiles", "Elige el archivo (PDF, foto, Word o Excel)")}</div>
            ${renewing ? `<p class="meq-hint">La versión anterior queda guardada en la hoja de vida.</p>` : ""}`,
        onSubmit: async form => {
            const files = filesOf(form, "meqDFiles");
            if (!files.length) throw new Error("Elige el archivo que quieres subir.");

            const type = val(form, "meqDType");
            const expiresAt = val(form, "meqDExpires");
            const uploaded = await uploadFiles(equipment.id, "documents", files);
            const tagged = uploaded.map(file => ({
                ...file,
                ...(type ? { docType: type } : {}),
                ...(expiresAt ? { expiresAt } : {})
            }));

            updateEquipment(equipment.id, item => ({
                ...item,
                documents: [...item.documents, ...tagged],
                documentsNotApplicable: item.documentsNotApplicable.filter(id => id !== type)
            }));
            toast(tagged.length > 1 ? `${tagged.length} documentos subidos.` : "Documento subido.");
        }
    });
}

/* ---------- acciones directas ---------- */

function attachmentsForGroup(snapshot, group) {
    const equipment = snapshot.equipment;

    if (group === "documents") return equipment.documents;
    if (group === "contract") return snapshot.contract ? snapshot.contract.attachments : equipment.contractAttachments;
    if (group.startsWith("maintenance:")) {
        return equipment.maintenances.find(item => item.id === group.slice(12))?.attachments || [];
    }

    return [];
}

async function uploadToGroup(snapshot, group, files) {
    const equipment = snapshot.equipment;
    const attachments = await uploadFiles(equipment.id, group, files);

    if (group === "contract") {
        const contract = snapshot.contract;

        if (contract && !contract.legacy) {
            saveContract({ ...contract, attachments: [...contract.attachments, ...attachments] });
        } else {
            updateEquipment(equipment.id, item => ({ ...item, contractAttachments: [...item.contractAttachments, ...attachments] }));
        }
    } else if (group.startsWith("maintenance:")) {
        const id = group.slice(12);

        updateEquipment(equipment.id, item => ({
            ...item,
            maintenances: item.maintenances.map(record =>
                record.id === id ? { ...record, attachments: [...record.attachments, ...attachments] } : record
            )
        }));
    }

    return attachments.length;
}

async function deleteFile(snapshot, group, fileId) {
    const file = attachmentsForGroup(snapshot, group).find(item => item.id === fileId);
    if (!file) return;

    const confirmed = await showConfirm(`Se quitará ${file.name}.`, {
        title: "Quitar archivo",
        tone: "danger",
        confirmText: "Quitar",
        destructive: true
    });

    if (!confirmed) return;

    try {
        await deleteStoredAttachment(file);
    } catch (error) {
        await showAlert(attachmentStorageErrorMessage(error, "eliminar"), { title: "Equipos Médicos", tone: "danger" });
        return;
    }

    const equipment = snapshot.equipment;
    const without = list => list.filter(item => item.id !== fileId);

    if (group === "documents") {
        updateEquipment(equipment.id, item => ({ ...item, documents: without(item.documents) }));
    } else if (group === "contract") {
        const contract = snapshot.contract;

        if (contract && !contract.legacy) saveContract({ ...contract, attachments: without(contract.attachments) });
        else updateEquipment(equipment.id, item => ({ ...item, contractAttachments: without(item.contractAttachments) }));
    } else if (group.startsWith("maintenance:")) {
        const id = group.slice(12);

        updateEquipment(equipment.id, item => ({
            ...item,
            maintenances: item.maintenances.map(record => record.id === id ? { ...record, attachments: without(record.attachments) } : record)
        }));
    }

    toast("Archivo quitado.");
}

function openFile(file) {
    openAttachmentFile(file, { newTab: true }).catch(error => {
        void showAlert(attachmentStorageErrorMessage(error, "abrir"), { title: "Equipos Médicos", tone: "danger" });
    });
}

async function setFailure(snapshot, failureId, fields, message) {
    try {
        await updateFailure(snapshot.equipment.id, failureId, fields);
        toast(message);
    } catch (error) {
        await showAlert(error?.message || "No se pudo actualizar la falla.", { title: "Equipos Médicos", tone: "danger" });
    }

    renderMedicalEquipmentPanel();
}

async function dismissFailure(snapshot, failureId) {
    const failure = snapshot.failures.find(item => item.id === failureId);
    if (!failure) return;

    const confirmed = await showConfirm(
        `«${failure.title}» quedará como descartada: no era una falla del equipo o ya no aplica. Agrega una nota si quieres dejar el motivo.`,
        { title: "Descartar falla", confirmText: "Descartar" }
    );

    if (confirmed) {
        await setFailure(snapshot, failureId, { status: "dismissed", resolvedAt: new Date().toISOString() }, "Falla descartada.");
    }
}

function toggleConfirmation(snapshot, recordId) {
    updateEquipment(snapshot.equipment.id, item => {
        const record = item.maintenances.find(entry => entry.id === recordId);
        if (!record) return item;

        const confirmed = !record.confirmed;

        return {
            ...item,
            maintenances: item.maintenances.map(entry => entry.id === recordId ? { ...entry, confirmed } : entry),
            nextMaintenanceConfirmed: record.type === "preventive" && record.date === item.nextMaintenanceAt
                ? confirmed
                : item.nextMaintenanceConfirmed
        };
    });
    renderMedicalEquipmentPanel();
}

async function deleteMaintenance(snapshot, recordId) {
    const record = snapshot.equipment.maintenances.find(item => item.id === recordId);
    if (!record) return;

    const confirmed = await showConfirm(
        `Se quitará la ${MAINTENANCE_TYPE_LABELS[record.type].toLowerCase()} del ${formatDate(record.date)}. Sus tareas vuelven a quedar activas.`,
        { title: "Quitar mantención", tone: "danger", confirmText: "Quitar", destructive: true }
    );

    if (!confirmed) return;

    updateEquipment(snapshot.equipment.id, item => ({
        ...item,
        maintenances: item.maintenances.filter(entry => entry.id !== recordId)
    }));
    toast("Mantención quitada.");
    renderMedicalEquipmentPanel();
}

async function finishMaintenance(snapshot, recordId) {
    const record = snapshot.equipment.maintenances.find(item => item.id === recordId);
    if (!record) return;

    const confirmed = await showConfirm(
        "La mantención se cerrará con término ahora, el equipo vuelve a Operativo y sus tareas quedan activas otra vez.",
        { title: "Terminar mantención", confirmText: "Terminar" }
    );

    if (!confirmed) return;

    const endAt = localISODateTime();

    updateEquipment(snapshot.equipment.id, item => withStatus({
        ...item,
        maintenances: item.maintenances.map(entry => entry.id === recordId ? { ...entry, endAt } : entry)
    }, item.status === "maintenance" ? "operational" : item.status, "Reparación terminada"));

    for (const failureId of record.resolvesFailureIds) {
        try {
            await updateFailure(snapshot.equipment.id, failureId, { status: "resolved", resolvedAt: new Date().toISOString() });
        } catch (error) {
            console.warn("No se pudo cerrar la falla enlazada.", error);
        }
    }

    toast(record.attachments.length
        ? "Mantención terminada. El equipo volvió a operar."
        : "Mantención terminada. Falta adjuntar el informe técnico.");
    renderMedicalEquipmentPanel();
}

async function reactivateEquipment(snapshot) {
    const confirmed = await showConfirm(`${snapshot.equipment.name} vuelve a Operativo y a aparecer en la PWA.`, {
        title: "Reactivar equipo",
        confirmText: "Reactivar"
    });

    if (!confirmed) return;

    updateEquipment(snapshot.equipment.id, item => ({
        ...withStatus(item, "operational", "Reactivado"),
        inactiveAt: "",
        inactiveReason: ""
    }));
    toast("Equipo reactivado.");
    renderMedicalEquipmentPanel();
}

async function deleteEquipment(snapshot) {
    const confirmed = await showConfirm(
        `${snapshot.equipment.name} y todo su historial saldrán del inventario. Para un equipo retirado conviene «Dar de baja», que conserva la hoja de vida.`,
        { title: "Eliminar equipo", tone: "danger", confirmText: "Eliminar", destructive: true }
    );

    if (!confirmed) return;

    removeEquipment(snapshot.equipment.id);
    ui.view = "panel";
    ui.equipmentId = "";
    toast("Equipo eliminado.");
    renderMedicalEquipmentPanel();
}

function toggleNotApplicable(snapshot, docType) {
    updateEquipment(snapshot.equipment.id, item => ({
        ...item,
        documentsNotApplicable: item.documentsNotApplicable.includes(docType)
            ? item.documentsNotApplicable.filter(id => id !== docType)
            : [...item.documentsNotApplicable, docType]
    }));
    renderMedicalEquipmentPanel();
}

async function deleteContact(snapshot, contactId) {
    const contract = snapshot.contract && !snapshot.contract.legacy ? snapshot.contract : null;
    const list = contract ? contract.contacts : snapshot.equipment.contacts;
    const contact = list.find(item => item.id === contactId);
    if (!contact) return;

    const confirmed = await showConfirm(`Se quitará el contacto ${contact.name}.`, {
        title: "Quitar contacto",
        tone: "danger",
        confirmText: "Quitar",
        destructive: true
    });

    if (!confirmed) return;

    if (contract) saveContract({ ...contract, contacts: contract.contacts.filter(item => item.id !== contactId) });
    else updateEquipment(snapshot.equipment.id, item => ({ ...item, contacts: item.contacts.filter(entry => entry.id !== contactId) }));

    renderMedicalEquipmentPanel();
}

function escalateFailure(snapshot, ctx, title) {
    const group = snapshot.metrics.recurrent.find(item => item.title === title);
    if (!group) return;

    const equipment = snapshot.equipment;
    const contacts = snapshot.contract?.contacts || equipment.contacts;
    const emails = contacts.map(contact => contact.email).filter(Boolean);
    const subject = `Falla recurrente: ${group.title} · ${equipment.name}${equipment.code ? ` (${equipment.code})` : ""}`;
    const lines = [
        "Estimados:",
        "",
        `El equipo ${equipment.name}${equipment.code ? `, código ${equipment.code}` : ""}${equipment.serialNumber ? `, serie ${equipment.serialNumber}` : ""}, ubicado en ${equipment.location || "nuestra unidad"}, presentó la falla «${group.title}» ${group.count} veces en los últimos 12 meses:`,
        "",
        ...[...group.failures]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(failure => `- ${formatDate(failure.date)}: ${failure.detail || failure.title}${failure.maintenance ? ` (reparada con la ${MAINTENANCE_TYPE_LABELS[failure.maintenance.type].toLowerCase()} del ${formatDate(failure.maintenance.date)})` : ""}`),
        "",
        "Solicitamos un diagnóstico de fondo o la evaluación del reemplazo de la pieza. Podemos enviarles el historial impreso con las fotos.",
        "",
        "Saludos,",
        currentUserName(),
        ctx.unitName
    ];
    const link = document.createElement("a");

    link.href = `mailto:${emails.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
    link.click();

    if (!emails.length) toast("El contrato no tiene correo de contacto: completa el destinatario en el correo.");
}

/* ---------- impresiones ---------- */

function printedAt() {
    const now = localISODateTime();
    return `${formatDate(now.slice(0, 10))} ${now.slice(11, 16)}`;
}

async function printFailureHistory(snapshot, ctx) {
    const images = snapshot.failures.flatMap(failure => failure.attachments.filter(isPrintableImage));
    const imageUrls = new Map();

    toast(images.length ? `Preparando el historial con ${plural(images.length, "foto", "fotos")}…` : "Preparando el historial…");

    await Promise.all(images.map(async file => {
        try {
            imageUrls.set(file.id, await resolveAttachmentURL(file));
        } catch {
            // La impresion muestra un aviso en el lugar de esa foto.
        }
    }));

    await printDocument(failureHistoryPrintHTML({
        snapshot,
        unitName: ctx.unitName,
        printedBy: currentUserName(),
        printedAt: printedAt(),
        now: ctx.now,
        imageUrls
    }));
}

async function printLifeSheet(snapshot, ctx) {
    toast("Preparando la hoja de vida…");

    await printDocument(lifeSheetPrintHTML({
        snapshot,
        events: lifeEvents(snapshot, { now: ctx.now }),
        unitName: ctx.unitName,
        printedBy: currentUserName(),
        printedAt: printedAt()
    }));
}

async function printUnitReport(ctx) {
    toast("Preparando el informe de la unidad…");

    await printDocument(unitReportPrintHTML({
        snapshots: ctx.snapshots,
        kpis: unitKpis(ctx.snapshots, ctx.today),
        queue: unitQueue(ctx.snapshots),
        monthly: monthlyFailureCounts(ctx.snapshots, ctx.today),
        unitName: ctx.unitName,
        printedBy: currentUserName(),
        printedAt: printedAt(),
        today: ctx.today
    }));
}

/* ---------- eventos ---------- */

const READ_ONLY_ACTIONS = new Set(["panel", "clear-kpi", "toggle-queue", "print-report", "print-failures", "print-life", "escalate"]);

async function runAction(action, target, ctx, snapshot) {
    const data = target.dataset;

    if (!READ_ONLY_ACTIONS.has(action) && !ctx.canEdit) return;

    switch (action) {
        case "panel":
            ui.view = "panel";
            ui.equipmentId = "";
            renderMedicalEquipmentPanel();
            return;
        case "clear-kpi":
            ui.kpi = "";
            renderMedicalEquipmentPanel();
            return;
        case "toggle-queue":
            ui.queueAll = !ui.queueAll;
            renderMedicalEquipmentPanel();
            return;
        case "new":
            openEquipmentFormDialog(null, ctx);
            return;
        case "print-report":
            await printUnitReport(ctx);
            return;
        default:
            break;
    }

    if (!snapshot) return;

    switch (action) {
        case "print-failures": await printFailureHistory(snapshot, ctx); break;
        case "print-life": await printLifeSheet(snapshot, ctx); break;
        case "failure": openFailureDialog(snapshot, ctx); break;
        case "maintenance": openMaintenanceDialog(snapshot, ctx, { failureId: data.meqFailure || "" }); break;
        case "schedule": openMaintenanceDialog(snapshot, ctx, { mode: "schedule" }); break;
        case "complete": openMaintenanceDialog(snapshot, ctx, { mode: "complete", recordId: data.meqId }); break;
        case "edit": openEquipmentFormDialog(snapshot, ctx); break;
        case "status": openStatusDialog(snapshot, ctx); break;
        case "inactivate": openInactivateDialog(snapshot); break;
        case "reactivate": await reactivateEquipment(snapshot); break;
        case "delete": await deleteEquipment(snapshot); break;
        case "note": openNoteDialog(snapshot, data.meqFailure); break;
        case "dismiss": await dismissFailure(snapshot, data.meqFailure); break;
        case "reopen": await setFailure(snapshot, data.meqFailure, { status: "open", resolvedAt: "" }, "Falla reabierta."); break;
        case "toggle-confirm": toggleConfirmation(snapshot, data.meqId); break;
        case "delete-maintenance": await deleteMaintenance(snapshot, data.meqId); break;
        case "finish": await finishMaintenance(snapshot, data.meqId); break;
        case "escalate": escalateFailure(snapshot, ctx, data.meqTitle); break;
        case "contract-new": openContractDialog(snapshot, ctx, "new"); break;
        case "contract-edit": openContractDialog(snapshot, ctx, "edit"); break;
        case "contract-renew": openContractDialog(snapshot, ctx, "renew"); break;
        case "contract-complete": openContractDialog(snapshot, ctx, "complete"); break;
        case "contract-link": linkToContract(snapshot, ctx, data.meqContract); break;
        case "contact": openContactDialog(snapshot); break;
        case "delete-contact": await deleteContact(snapshot, data.meqContact); break;
        case "document": openDocumentDialog(snapshot, data.meqDoctype || ""); break;
        case "doc-na": toggleNotApplicable(snapshot, data.meqDoctype); break;
        case "delete-file": await deleteFile(snapshot, data.meqGroup, data.meqFile); renderMedicalEquipmentPanel(); break;
        default: break;
    }
}

function openEquipment(id, tab) {
    selectMedicalEquipment(id, tab);
    renderMedicalEquipmentPanel();

    const main = document.querySelector(".meq-main");

    if (main && (main.getBoundingClientRect().top < 0 || window.innerWidth < 900)) {
        main.scrollIntoView({ block: "start" });
    }
}

async function onPanelClick(event) {
    const target = event.target.closest(
        "[data-meq-kpi],[data-meq-act],[data-meq-eq],[data-meq-open],[data-meq-tabgo],[data-meq-failures],[data-meq-life],[data-meq-fstatus],[data-meq-openfile],[data-meq-att]"
    );

    if (!target) return;

    target.closest(".meq-more")?.removeAttribute("open");

    const data = target.dataset;

    if (data.meqKpi) {
        ui.kpi = ui.kpi === data.meqKpi ? "" : data.meqKpi;
        renderMedicalEquipmentPanel();
        return;
    }
    if (data.meqEq) return openEquipment(data.meqEq);
    if (data.meqOpen) return openEquipment(data.meqOpen, data.meqTab);
    if (data.meqTabgo) {
        ui.tab = data.meqTabgo;
        renderMedicalEquipmentPanel();
        return;
    }
    if (data.meqFailures) {
        ui.failures = data.meqFailures;
        renderMedicalEquipmentPanel();
        return;
    }
    if (data.meqLife) {
        ui.life = data.meqLife;
        renderMedicalEquipmentPanel();
        return;
    }

    const ctx = buildContext();
    const snapshot = ctx.byId.get(ui.equipmentId) || null;

    // Abrir un adjunto va antes de cualquier await: el navegador solo deja
    // abrir la pestaña nueva dentro del mismo clic.
    if (data.meqOpenfile) {
        const file = snapshot && attachmentsForGroup(snapshot, data.meqOpenfile).find(item => item.id === data.meqFile);
        if (file) openFile(file);
        return;
    }
    if (data.meqAtt) {
        const failure = snapshot?.failures.find(item => item.id === data.meqAtt);
        const file = failure?.attachments.find(item => item.id === data.meqFile);
        if (file) openFile(file);
        return;
    }

    try {
        if (data.meqFstatus) {
            if (!ctx.canEdit || !snapshot) return;

            const failure = snapshot.failures.find(item => item.id === data.meqFailure);
            if (!failure || failure.status === data.meqFstatus) return;

            if (data.meqFstatus === "resolved" && !failure.maintenance) {
                openMaintenanceDialog(snapshot, ctx, { failureId: failure.id });
                return;
            }

            await setFailure(snapshot, failure.id, {
                status: data.meqFstatus,
                resolvedAt: data.meqFstatus === "resolved" ? new Date().toISOString() : ""
            }, `Falla marcada como ${FAILURE_STATUS[data.meqFstatus].label.toLowerCase()}.`);
            return;
        }

        await runAction(data.meqAct, target, ctx, snapshot);
    } catch (error) {
        await showAlert(error?.message || "No se pudo completar la acción.", { title: "Equipos Médicos", tone: "danger" });
    }
}

async function onPanelChange(event) {
    const input = event.target;

    if (input.matches?.("[data-meq-upload]")) {
        const ctx = buildContext();
        const snapshot = ctx.byId.get(ui.equipmentId);

        if (!ctx.canEdit || !snapshot || !input.files?.length) return;

        toast("Subiendo…");

        try {
            const count = await uploadToGroup(snapshot, input.dataset.meqUpload, input.files);
            toast(count > 1 ? `${count} archivos subidos.` : "Archivo subido.");
        } catch (error) {
            await showAlert(error?.message || "No se pudo subir el archivo.", { title: "Equipos Médicos", tone: "danger" });
        } finally {
            input.value = "";
            renderMedicalEquipmentPanel();
        }
        return;
    }

    if (input.matches?.("[data-meq-classify]") && input.value) {
        const ctx = buildContext();
        const snapshot = ctx.byId.get(ui.equipmentId);
        if (!ctx.canEdit || !snapshot) return;

        const docType = input.value;

        updateEquipment(snapshot.equipment.id, item => ({
            ...item,
            documents: item.documents.map(doc => doc.id === input.dataset.meqClassify ? { ...doc, docType } : doc),
            documentsNotApplicable: item.documentsNotApplicable.filter(id => id !== docType)
        }));
        toast(`Documento clasificado como ${documentTypeLabel(docType)}.`);
        renderMedicalEquipmentPanel();
    }
}

function renderRailBody() {
    const body = document.querySelector("[data-meq-railbody]");
    if (body) body.innerHTML = railBodyHTML(lastContext || buildContext());
}

function onPointerMove(event) {
    const tip = document.getElementById("meqTip");
    if (!tip) return;

    const element = event.target?.closest?.("[data-meq-tip]");

    if (!element) {
        if (!tip.hidden) tip.hidden = true;
        return;
    }

    tip.textContent = element.getAttribute("data-meq-tip");
    tip.hidden = false;

    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    let left = event.clientX + 14;
    let top = event.clientY + 14;

    if (left + width > window.innerWidth - 8) left = event.clientX - width - 14;
    if (top + height > window.innerHeight - 8) top = event.clientY - height - 14;

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
}

function bindLayer(layer) {
    layer.addEventListener("click", event => {
        if (event.target.id === "meqOverlay") {
            closeDialog();
            return;
        }

        const button = event.target.closest("[data-meq-dlg],[data-meq-segv],[data-meq-multiv]");
        if (!button) return;

        if (button.dataset.meqSegv !== undefined) {
            button.closest("[data-meq-seg]")?.querySelectorAll(".meq-chip").forEach(chip => {
                chip.classList.toggle("is-on", chip === button);
            });
            updateAutonote();
            return;
        }

        if (button.dataset.meqMultiv !== undefined) {
            button.classList.toggle("is-on");
            return;
        }

        const action = button.dataset.meqDlg;

        if (action === "close") closeDialog();
        if (action === "more-tasks") {
            layer.querySelector("[data-meq-moretasks]")?.removeAttribute("hidden");
            button.remove();
        }
        if (action === "extra" && dialogExtra) {
            dialogExtra().catch(error => toast(error?.message || "No se pudo completar la acción."));
        }
    });

    layer.addEventListener("submit", event => {
        event.preventDefault();
        void submitDialog(event.target);
    });

    layer.addEventListener("input", () => updateAutonote());

    layer.addEventListener("change", event => {
        const input = event.target;

        if (input.type === "file") {
            const drop = input.closest(".meq-drop");
            const text = drop?.querySelector("[data-meq-droplabel]");
            const names = [...(input.files || [])].map(file => file.name);

            drop?.classList.toggle("has-files", names.length > 0);
            if (text) {
                text.textContent = names.length
                    ? names.length === 1 ? names[0] : `${names.length} archivos: ${names.join(", ")}`
                    : text.dataset.default || "";
            }
        }

        updateAutonote();
    });
}

let documentBound = false;

function bindPanel(panel) {
    if (panel.dataset.meqBound !== "1") {
        panel.dataset.meqBound = "1";
        panel.addEventListener("click", event => { void onPanelClick(event); });
        panel.addEventListener("input", event => {
            if (event.target.matches?.("[data-meq-search]")) {
                ui.search = event.target.value || "";
                renderRailBody();
            }
        });
        panel.addEventListener("change", event => { void onPanelChange(event); });
        // Una miniatura que no carga (HEIC, enlace vencido) pasa a boton de archivo.
        panel.addEventListener("error", event => {
            const image = event.target;
            if (!image?.matches?.("img[data-meq-thumb]")) return;

            const button = image.closest(".meq-att");
            if (!button) return;

            button.classList.add("meq-att--file");
            button.innerHTML = `${ic("file")}<span>${esc(image.alt)}</span>`;
        }, true);
    }

    if (!documentBound) {
        documentBound = true;
        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("keydown", event => {
            if (event.key !== "Escape") return;
            if (document.getElementById("meqOverlay")?.hidden === false) closeDialog();
            document.querySelectorAll(".meq-more[open]").forEach(details => details.removeAttribute("open"));
        });
        document.addEventListener("click", event => {
            document.querySelectorAll(".meq-more[open]").forEach(details => {
                if (!details.contains(event.target)) details.removeAttribute("open");
            });
        });
    }
}

/* ---------- entrada ---------- */

function mainHTML(ctx) {
    if (ui.view === "ficha") {
        const snapshot = ctx.byId.get(ui.equipmentId);
        if (snapshot) return fichaHTML(snapshot, ctx);
    }

    return panelViewHTML(ctx);
}

export function renderMedicalEquipmentPanel() {
    const panel = document.getElementById("medicalEquipmentPanel");
    if (!panel) return;

    ensureLayer();
    bindPanel(panel);

    const ctx = buildContext();
    lastContext = ctx;

    if (ui.view === "ficha" && !ctx.byId.has(ui.equipmentId)) {
        ui.view = "panel";
        ui.equipmentId = "";
    }

    const active = document.activeElement;
    const searchFocused = active?.id === "meqSearch";
    const caret = searchFocused ? active.selectionStart : null;

    panel.innerHTML = `<div class="meq meq-root">
        ${pageHeadHTML(ctx)}
        <div class="meq-workspace">
            <aside class="meq-rail" aria-label="Equipos">${railHTML(ctx)}</aside>
            <section class="meq-main">${mainHTML(ctx)}</section>
        </div>
    </div>`;

    if (searchFocused) {
        const input = document.getElementById("meqSearch");
        input?.focus();
        if (input && caret !== null) input.setSelectionRange(caret, caret);
    }
}

export function initMedicalEquipmentPanel() {
    if (typeof window === "undefined") return;

    window.addEventListener("proturnos:medicalEquipmentChanged", () => {
        if (document.body.dataset.activeView === "medicalEquipment") {
            renderMedicalEquipmentPanel();
        }
    });
}
