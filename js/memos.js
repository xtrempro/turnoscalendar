import { escapeHTML } from "./htmlUtils.js";
import { addAuditLog, AUDIT_CATEGORY } from "./auditLog.js";
import { showConfirm } from "./dialogs.js";
import { getJSON, setJSON } from "./persistence.js";
import { getProfiles, getRotativa } from "./storage.js";
import { getRotativaLabel } from "./rotationUtils.js";
import {
    ATTACHMENT_ACCEPT,
    canPreviewAttachment,
    deleteStoredAttachment,
    hasAttachmentContent,
    readAttachmentFile
} from "./attachmentUtils.js";
import {
    cachedAttachmentURL,
    forgetCachedAttachment,
    openCachedAttachment
} from "./attachmentCache.js";
import {
    MEMO_KINDS,
    MEMO_STATES,
    OVERDUE_DAYS,
    dayKeyToISO,
    formatISO,
    groupByWorker,
    initials,
    memoDaysOld,
    memoDocuments,
    memoFacts,
    memoIsOverdue,
    memoKind,
    memoMissingMark,
    memoMonth,
    memoRangeLabel,
    memoStartISO,
    memoStatus,
    memoWasRequested,
    monthLabel,
    plural,
    searchKey,
    shortName,
    sortMemosForList,
    timestampISO,
    timestampTime,
    todayISO
} from "./memosInsights.js";
import { memoListPrintHTML, printDocument } from "./memosPrint.js";

const MEMOS_KEY = "memos";
const DAY_KEY_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const STATUS_PENDING = "pending";
const STATUS_COMPLETED = "completed";

// El mismo juego de formatos que acepta el resto del app: el documento del
// memorandum se abre despues desde el calendario, asi que no hay razon para
// restringirlo mas aca.
export const MEMO_ATTACHMENT_ACCEPT = ATTACHMENT_ACCEPT;

function makeId(prefix = "memo") {
    return `${prefix}_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 9)}`;
}

function normalizeDocument(doc = {}) {
    const name = String(doc.name || "").trim();
    const dataUrl = String(doc.dataUrl || "");
    const storagePath = String(doc.storagePath || "");
    const downloadURL = String(doc.downloadURL || "");

    if (!name || (!dataUrl && !storagePath && !downloadURL)) return null;

    return {
        id: String(doc.id || makeId("memo_doc")),
        name,
        type: String(doc.type || "application/octet-stream"),
        size: Number(doc.size) || 0,
        dataUrl,
        storagePath,
        downloadURL,
        // Lo que trae impreso el documento del sistema de personal. No lo genera
        // TurnoPlus: se copia al adjuntar para poder buscarlo despues.
        resolution: String(doc.resolution || "").trim(),
        issuedAt: String(doc.issuedAt || "").trim(),
        uploadedByUid: String(doc.uploadedByUid || ""),
        attachedAt: doc.attachedAt || new Date().toISOString()
    };
}

function normalizeKeyList(value) {
    return (Array.isArray(value) ? value : [])
        .map(key => String(key || "").trim())
        .filter(key => DAY_KEY_PATTERN.test(key));
}

function normalizeMemo(memo = {}) {
    const sourceId = String(memo.sourceId || "");
    const createdAt = memo.createdAt || new Date().toISOString();
    const documents = Array.isArray(memo.documents)
        ? memo.documents.map(normalizeDocument).filter(Boolean)
        : [];
    // El estado no se marca a mano: lo decide el adjunto. Pendiente mientras no
    // haya documento, realizado con el primero. Se sigue escribiendo status
    // porque es lo que leen los memorandum viejos y el resto del app.
    const status = documents.length ? STATUS_COMPLETED : STATUS_PENDING;

    return {
        id: String(memo.id || sourceId || makeId()),
        sourceId,
        title: String(memo.title || "Memorándum pendiente"),
        profile: String(memo.profile || ""),
        typeLabel: String(memo.typeLabel || "MEMO"),
        detail: String(memo.detail || ""),
        startKey: String(memo.startKey || ""),
        endKey: String(memo.endKey || ""),
        dateKey: String(memo.dateKey || ""),
        // Que permiso lo origino y que dias abarca. Es lo que deja llegar desde
        // una casilla del calendario al memorandum que le corresponde. Los
        // memorandum viejos no lo traen: la busqueda cae al sourceId y al rango
        // startKey/endKey (ver memoLeaveType y memoCoversDay).
        leaveType: String(memo.leaveType || ""),
        keys: normalizeKeyList(memo.keys),
        status,
        createdAt,
        // Cuando se le pidio el documento al trabajador. Queda anotado aca para
        // no volver a pedir lo mismo y para saber cuanto lleva esperando.
        requestedAt: String(memo.requestedAt || ""),
        completedAt: documents.length
            ? memo.completedAt || documents[0].attachedAt || createdAt
            : "",
        documents
    };
}

function parseKey(key) {
    const match = String(key || "").match(DAY_KEY_PATTERN);

    if (!match) return null;

    return new Date(
        Number(match[1]),
        Number(match[2]),
        Number(match[3])
    );
}

function formatKey(key) {
    const date = parseKey(key);

    if (!date || Number.isNaN(date.getTime())) return "Sin fecha";

    return date.toLocaleDateString("es-CL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).replace(/\//g, "-");
}

// Del <input type="date"> a la clave del calendario, que lleva el mes en base 0.
function isoToDayKey(iso) {
    const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) return "";

    return [
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3])
    ].join("-");
}

function formatISODate(value) {
    const match = String(value || "")
        .match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

    if (!match) return "Sin fecha";

    return [
        String(Number(match[3])).padStart(2, "0"),
        String(Number(match[2])).padStart(2, "0"),
        match[1]
    ].join("-");
}

function sortMemos(a, b) {
    const statusWeight = status =>
        status === STATUS_PENDING ? 0 : 1;
    const statusDiff =
        statusWeight(a.status) - statusWeight(b.status);

    if (statusDiff) return statusDiff;

    return new Date(b.createdAt) - new Date(a.createdAt);
}

function dispatchMemosChanged() {
    if (typeof window === "undefined") return;

    window.dispatchEvent(
        new CustomEvent("proturnos:memosChanged")
    );
}

export function getMemos() {
    return Array.isArray(getJSON(MEMOS_KEY, []))
        ? getJSON(MEMOS_KEY, []).map(normalizeMemo).sort(sortMemos)
        : [];
}

function persistMemos(memos, { emit = true } = {}) {
    setJSON(MEMOS_KEY, memos.map(normalizeMemo));
    updateMemosNavBadge();

    if (emit) dispatchMemosChanged();
}

export function pendingMemosCount() {
    return getMemos().filter(memo =>
        memo.status === STATUS_PENDING
    ).length;
}

export function updateMemosNavBadge(count = pendingMemosCount()) {
    if (typeof document === "undefined") return;

    const tile = document.querySelector(
        ".nav-tile[data-target='memosPanel']"
    );

    if (!tile) return;

    let badge = tile.querySelector(".nav-alert-badge");

    if (!count) {
        badge?.remove();
        tile.removeAttribute("data-alert-count");
        return;
    }

    if (!badge) {
        badge = document.createElement("span");
        badge.className = "nav-alert-badge";
        tile.appendChild(badge);
    }

    badge.textContent = count > 99 ? "99+" : String(count);
    tile.dataset.alertCount = String(count);
}

export function createMemoTask(task = {}) {
    const memo = normalizeMemo({
        ...task,
        status: task.status || STATUS_PENDING,
        title: task.title || "Memorándum pendiente",
        sourceId:
            task.sourceId ||
            `${task.profile || "sin_perfil"}:${task.typeLabel || "memo"}:${task.startKey || task.dateKey || Date.now()}`
    });
    const memos = getMemos();
    const existingIndex = memos.findIndex(item =>
        item.sourceId && item.sourceId === memo.sourceId
    );

    if (existingIndex >= 0) {
        const existing = memos[existingIndex];

        memos[existingIndex] = normalizeMemo({
            ...existing,
            ...memo,
            id: existing.id,
            completedAt: existing.completedAt,
            requestedAt: existing.requestedAt,
            documents: existing.documents
        });
    } else {
        memos.unshift(memo);
    }

    persistMemos(memos);

    return memo;
}

function amountText(amount, typeLabel) {
    if (String(typeLabel).startsWith("1/2")) {
        return typeLabel;
    }

    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0) {
        return typeLabel;
    }

    if (value === 1) return `1 ${typeLabel}`;

    return `${value} ${typeLabel}`;
}

export function createLeaveMemoTask({
    profile,
    typeLabel,
    amount = 1,
    startKey,
    endKey,
    sourceType,
    // Los dias exactos del permiso. Un feriado legal de 10 dias no ocupa 10
    // casillas seguidas -salta fines de semana y festivos-, asi que el rango
    // startKey..endKey no alcanza para saber que casilla pertenece a este
    // memorandum. Cuando no llega, la busqueda cae al rango.
    keys = []
} = {}) {
    if (!profile || !typeLabel || !startKey) return null;

    const finalEndKey = endKey || startKey;
    const detail = [
        `Nombre: ${profile}`,
        `Permiso: ${amountText(amount, typeLabel)}`,
        `Fecha inicio: ${formatKey(startKey)}`,
        `Fecha termino: ${formatKey(finalEndKey)}`
    ].join(" | ");

    return createMemoTask({
        sourceId: [
            "leave",
            sourceType || typeLabel,
            profile,
            startKey,
            finalEndKey,
            amount
        ].join(":"),
        profile,
        typeLabel,
        detail,
        startKey,
        endKey: finalEndKey,
        leaveType: sourceType || "",
        keys
    });
}

function missingClockTypeLabel(missingEntry, missingExit) {
    if (missingEntry && missingExit) return "Marcaje incompleto";
    if (missingEntry) return "Marcaje sin entrada";

    return "Marcaje sin salida";
}

export function createClockMemoTask({
    profile,
    dateKey,
    segmentId = "turno",
    segmentLabel = "",
    missingEntry = false,
    missingExit = false
} = {}) {
    if (!profile || !dateKey || (!missingEntry && !missingExit)) {
        return null;
    }

    const missingParts = [
        missingEntry ? "entrada" : "",
        missingExit ? "salida" : ""
    ].filter(Boolean);
    const typeLabel = missingClockTypeLabel(
        missingEntry,
        missingExit
    );
    const detail = [
        `Nombre: ${profile}`,
        `Fecha: ${formatKey(dateKey)}`,
        `Falta de marcaje: ${missingParts.join(" y ")}`,
        segmentLabel ? `Turno: ${segmentLabel}` : ""
    ].filter(Boolean).join(" | ");

    return createMemoTask({
        sourceId: [
            "clock",
            profile,
            dateKey,
            segmentId
        ].join(":"),
        profile,
        typeLabel,
        detail,
        dateKey
    });
}

export function createReplacementContractMemoTask({
    profile,
    contract
} = {}) {
    const start = String(contract?.start || "");
    const end = String(contract?.end || "");
    const replaces = String(contract?.replaces || "").trim();
    const reason = String(contract?.reason || "").trim();

    if (!profile || !start || !end || !replaces) return null;

    const detail = [
        `Nombre: ${profile}`,
        `Inicio contrato: ${formatISODate(start)}`,
        `Término contrato: ${formatISODate(end)}`,
        reason ? `Motivo del reemplazo: ${reason}` : "",
        `Reemplaza a: ${replaces}`
    ].filter(Boolean).join(" | ");

    return createMemoTask({
        sourceId: [
            "replacement_contract",
            profile,
            contract.id || start,
            end,
            replaces,
            reason
        ].join(":"),
        title: "Memorándum pendiente",
        profile,
        typeLabel: "Contrato de reemplazo",
        detail
    });
}

/* =========================================================
   Desde el calendario hasta el memorandum

   El documento del memorandum tiene que poder abrirse desde cualquiera de las
   casillas que lo originaron: si a alguien se le aplican 10 feriados legales,
   el respaldo es uno solo y vale para los 10 dias. Por eso el memorandum no se
   busca por su id sino por (trabajador, tipo de permiso, dia).
========================================================= */

function sameProfileName(a, b) {
    return String(a || "").trim() === String(b || "").trim();
}

// Los memorandum creados antes de que existiera el campo leaveType lo llevan
// dentro del sourceId: "leave:<tipo>:<perfil>:<inicio>:<fin>:<cantidad>".
function memoLeaveType(memo = {}) {
    if (memo.leaveType) return memo.leaveType;

    const parts = String(memo.sourceId || "").split(":");

    return parts[0] === "leave" ? String(parts[1] || "") : "";
}

function keyOrder(key) {
    const match = String(key || "").match(DAY_KEY_PATTERN);

    if (!match) return NaN;

    return Number(match[1]) * 10000 +
        Number(match[2]) * 100 +
        Number(match[3]);
}

function memoCoversDay(memo, keyDay) {
    if (!keyDay) return false;
    if (memo.keys.length) return memo.keys.includes(keyDay);
    if (memo.dateKey) return memo.dateKey === keyDay;

    const day = keyOrder(keyDay);
    const start = keyOrder(memo.startKey);
    const end = keyOrder(memo.endKey || memo.startKey);

    if (!Number.isFinite(day) || !Number.isFinite(start)) return false;

    return day >= start && day <= (Number.isFinite(end) ? end : start);
}

// Los medios dias comparten memorandum con el legado "half_admin", que no
// distingue mañana de tarde.
function leaveTypeMatches(memoType, leaveType) {
    if (!memoType || !leaveType) return false;
    if (memoType === leaveType) return true;

    const halfAdmin = new Set([
        "half_admin",
        "half_admin_morning",
        "half_admin_afternoon"
    ]);

    return halfAdmin.has(memoType) && halfAdmin.has(leaveType);
}

export function getMemoById(id) {
    const memoId = String(id || "");

    return memoId
        ? getMemos().find(memo => memo.id === memoId) || null
        : null;
}

/**
 * Memorandum de permiso al que pertenece una casilla del calendario.
 *
 * @param {{profile: string, leaveType: string, keyDay: string}} options
 * @returns {Object|null}
 */
export function findLeaveMemoForDay({ profile, leaveType, keyDay } = {}) {
    if (!profile || !leaveType || !keyDay) return null;

    // getMemos() ya viene ordenado: pendientes primero y, dentro de cada grupo,
    // del mas nuevo al mas viejo. Si dos aplicaciones del mismo permiso pisan el
    // mismo dia, gana la mas reciente, que es la que sigue vigente.
    return getMemos().find(memo =>
        sameProfileName(memo.profile, profile) &&
        leaveTypeMatches(memoLeaveType(memo), leaveType) &&
        memoCoversDay(memo, keyDay)
    ) || null;
}

/**
 * Memorandum de marcaje incompleto de un dia.
 *
 * @param {{profile: string, keyDay: string}} options
 * @returns {Object|null}
 */
export function findClockMemoForDay({ profile, keyDay } = {}) {
    if (!profile || !keyDay) return null;

    return getMemos().find(memo =>
        String(memo.sourceId || "").startsWith("clock:") &&
        sameProfileName(memo.profile, profile) &&
        memo.dateKey === keyDay
    ) || null;
}

/**
 * Quita los memorandum pendientes de un permiso que se anulo.
 *
 * Si el permiso ya no existe, el documento que se pedia tampoco corresponde:
 * dejarlo en la lista era cobrarle al trabajador un papel de algo que no paso.
 *
 * Reglas:
 * - Solo los del mismo trabajador y el mismo tipo de permiso que tocan alguno
 *   de los dias anulados.
 * - Si se anularon solo algunos de sus dias, el memorandum se queda con los
 *   otros.
 * - Si ya tenia un documento adjunto, se queda: borrarlo eliminaria el archivo
 *   de Storage, y si la anulacion fue un error se perderia.
 *
 * Se llama al anular, NO comparando memorandum contra permisos: en otra sesion
 * los permisos pueden no haber llegado todavia, y ese "falta el permiso"
 * borraria memorandum validos en todos lados (ver el incidente de tareas
 * borradas).
 *
 * @param {{profile: string, leaveType: string, keys: string[]}} options
 * @returns {Array<Object>} los memorandum quitados
 */
export function cancelLeaveMemos({ profile, leaveType, keys = [] } = {}) {
    const cancelled = new Set(normalizeKeyList(keys));

    if (!profile || !leaveType || !cancelled.size) return [];

    const removed = [];
    let changed = false;
    const next = [];

    getMemos().forEach(memo => {
        const affected =
            sameProfileName(memo.profile, profile) &&
            leaveTypeMatches(memoLeaveType(memo), leaveType) &&
            [...cancelled].some(keyDay => memoCoversDay(memo, keyDay));

        if (!affected || memo.documents.length) {
            next.push(memo);
            return;
        }

        const remaining = memo.keys.filter(keyDay => !cancelled.has(keyDay));

        if (memo.keys.length && remaining.length) {
            next.push(normalizeMemo({
                ...memo,
                keys: remaining,
                startKey: remaining[0],
                endKey: remaining[remaining.length - 1]
            }));
            changed = true;
            return;
        }

        removed.push(memo);
        changed = true;
    });

    if (!changed) return [];

    persistMemos(next);

    removed.forEach(memo => {
        addAuditLog(
            AUDIT_CATEGORY.WORKER_REQUESTS,
            "Quito memorandum de permiso anulado",
            `${memo.profile || "Sin trabajador"}: ${memo.typeLabel}.`,
            {
                profile: memo.profile,
                memoId: memo.id,
                memoType: memo.typeLabel
            }
        );
    });

    return removed;
}

// La anulacion desde el LOG (auditLog.js) avisa por evento: la bitacora no
// puede importar este modulo, porque este ya la importa a ella.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("proturnos:leaveCanceled", event => {
        cancelLeaveMemos(event?.detail || {});
    });
}

export function getMemoDocuments(memoId) {
    return getMemoById(memoId)?.documents || [];
}

function setMemoDocuments(memoId, documents) {
    const memos = getMemos();
    const updated = memos.map(memo =>
        memo.id === memoId
            ? normalizeMemo({ ...memo, documents })
            : memo
    );

    persistMemos(updated);

    return updated.find(memo => memo.id === memoId) || null;
}

/**
 * Deja anotado que ya se le pidio el documento al trabajador.
 *
 * Es una anotacion del supervisor, no un aviso: sirve para no volver a pedir lo
 * mismo y para distinguir al que no ha traido el papel del que ni siquiera
 * sabe que se lo estan pidiendo.
 */
function setMemoRequested(memoIds) {
    const ids = new Set(
        (Array.isArray(memoIds) ? memoIds : [memoIds]).map(String)
    );
    const now = new Date().toISOString();
    const memos = getMemos();
    const touched = [];
    const updated = memos.map(memo => {
        if (!ids.has(memo.id) || memoStatus(memo) !== "pending") return memo;

        touched.push(memo);

        return normalizeMemo({ ...memo, requestedAt: now });
    });

    if (!touched.length) return [];

    persistMemos(updated);

    touched.forEach(memo => {
        addAuditLog(
            AUDIT_CATEGORY.WORKER_REQUESTS,
            "Anoto que pidio el documento del memorandum",
            `${memo.profile || "Sin trabajador"}: ${memo.typeLabel}.`,
            {
                profile: memo.profile,
                memoId: memo.id,
                memoType: memo.typeLabel
            }
        );
    });

    return touched;
}

function attachMemoDocument(id, document) {
    const memos = getMemos();
    const updated = memos.map(memo => {
        if (memo.id !== id) return memo;

        return normalizeMemo({
            ...memo,
            documents: [
                ...(memo.documents || []),
                document
            ]
        });
    });
    const memo = updated.find(item => item.id === id);

    persistMemos(updated);

    if (memo) {
        addAuditLog(
            AUDIT_CATEGORY.WORKER_REQUESTS,
            "Adjunto documento a memorandum",
            `${memo.profile || "Sin trabajador"}: ${document.name}.`,
            {
                profile: memo.profile,
                memoId: memo.id,
                memoType: memo.typeLabel
            }
        );
    }
}

async function fileToMemoDocument(file, memoId, meta = {}) {
    const document = await readAttachmentFile(file, {
        moduleId: "memos",
        ownerId: memoId,
        recordId: "memo-documents"
    });

    return {
        ...document,
        resolution: String(meta.resolution || "").trim(),
        issuedAt: String(meta.issuedAt || "").trim(),
        attachedAt:
            document?.addedAt ||
            new Date().toISOString()
    };
}

/**
 * Sube un archivo y lo deja adjunto al memorandum.
 *
 * Es el mismo camino que usa el panel de memos, expuesto para que el calendario
 * pueda adjuntar desde la casilla del permiso.
 *
 * @param {string} memoId
 * @param {File} file
 * @param {{resolution?: string, issuedAt?: string}} meta datos que trae impreso
 *   el documento del sistema de personal
 * @returns {Promise<Object>} el documento guardado
 */
export async function addMemoDocument(memoId, file, meta = {}) {
    if (!getMemoById(memoId)) {
        throw new Error(
            "No se pudo identificar el memorandum al que pertenece el documento."
        );
    }

    const document = await fileToMemoDocument(file, memoId, meta);

    if (!hasAttachmentContent(document)) {
        throw new Error("El documento no se pudo guardar. Intenta nuevamente.");
    }

    attachMemoDocument(memoId, document);

    return document;
}

/**
 * Quita un documento del memorandum.
 *
 * Primero se borra el archivo y despues la referencia, igual que en las
 * licencias: al reves, un fallo al eliminar dejaria el archivo en Storage sin
 * nada que lo alcance.
 *
 * @param {string} memoId
 * @param {string} documentId
 * @returns {Promise<boolean>}
 */
export async function removeMemoDocument(memoId, documentId) {
    const documents = getMemoDocuments(memoId);
    const document = documents.find(item =>
        String(item.id) === String(documentId)
    );

    if (!document) return false;

    await deleteStoredAttachment(document);

    const memo = setMemoDocuments(
        memoId,
        documents.filter(item => item !== document)
    );

    // La copia del computador ya no sirve: el archivo no existe en Storage.
    void forgetCachedAttachment(document);

    if (memo) {
        addAuditLog(
            AUDIT_CATEGORY.WORKER_REQUESTS,
            "Elimino documento de memorandum",
            `${memo.profile || "Sin trabajador"}: ${document.name}.`,
            {
                profile: memo.profile,
                memoId: memo.id,
                memoType: memo.typeLabel
            }
        );
    }

    return true;
}

export async function openMemoDocument(memoId, documentId) {
    if (typeof window === "undefined") return;

    const document = getMemoDocuments(memoId).find(item =>
        item.id === documentId
    );

    if (!hasAttachmentContent(document)) return;

    await openCachedAttachment(document, { newTab: true });
}

/* =========================================================
   Panel

   Portado del mockup aprobado: encabezado con los cinco indicadores, barra de
   filtros, lista agrupada por trabajador y, al lado, el visor del documento.
   El documento se ve AQUI MISMO -no se abre otra pestana- porque revisar que
   el papel calce con el permiso es lo que se hace todo el dia.
========================================================= */

const ICONS = {
    memo: '<path d="M9 3h6l1.5 2H20a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3.5Z"/><path d="M9 3h6v4H9Z"/><path d="m7.5 13 2.2 2.2L16.5 9"/><path d="M7 18h10"/>',
    print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v6H7z"/>',
    clip: '<path d="m21.4 11.6-8.8 8.8a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
    file: '<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    swap: '<path d="M17 3l4 4-4 4"/><path d="M3 7h18"/><path d="M7 21l-4-4 4-4"/><path d="M21 17H3"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4Z"/><path d="M12 10v4.5M12 17.2v.1"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    group: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 11a3 3 0 1 0-1.5-5.6"/><path d="M18 20a5.6 5.6 0 0 0-2.2-4.4"/>',
    trash: '<path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'
};

const SPRITE = `<svg class="mem-sprite" aria-hidden="true" focusable="false">${Object.entries(ICONS)
    .map(([id, body]) => `<symbol id="mem-i-${id}" viewBox="0 0 24 24">${body}</symbol>`)
    .join("")}</svg>`;

const TYPE_OPTIONS = [
    ["all", "Todos"],
    ["leave", "Permisos"],
    ["clock", "Marcajes"],
    ["contract", "Contratos"],
    ["manual", "Manuales"]
];

const VIEWER_KICKER = {
    leave: "Documento del permiso",
    clock: "Documento del marcaje",
    contract: "Documento del contrato",
    manual: "Documento del memorándum"
};

const ORIGIN_STEP = {
    leave: "Permiso aplicado en TurnoPlus",
    clock: "Marcaje incompleto detectado",
    contract: "Contrato de reemplazo registrado",
    manual: "Memorándum creado en TurnoPlus"
};

const esc = escapeHTML;

function attr(value) {
    return escapeHTML(value).replace(/`/g, "&#096;");
}

function ic(name) {
    return `<svg class="mem-i" aria-hidden="true" focusable="false"><use href="#mem-i-${name}"/></svg>`;
}

const ui = {
    estado: "pending",
    tipo: "all",
    periodo: "all",
    vista: "grupo",
    query: "",
    // "Ver los atrasados" del aviso: solo los que llevan mas de 15 dias sin
    // documento, de cualquier mes y estado.
    onlyOverdue: false,
    openId: "",
    docIndex: 0,
    zoom: 1,
    collapsed: new Set()
};

// Un turno de carga por visor (el del panel y el de pantalla completa): si el
// panel se redibuja mientras resuelve, la respuesta vieja no pisa la nueva.
const previewTokens = new Map();
let dialogSubmit = null;
let busy = false;
let toastTimer = 0;

/* ---------- capa flotante ---------- */

function ensureLayer() {
    let layer = document.getElementById("memLayer");

    if (layer) return layer;

    layer = document.createElement("div");
    layer.id = "memLayer";
    layer.className = "mem mem-layer";
    layer.innerHTML = `${SPRITE}
        <div class="mem-toast" id="memToast" role="status" hidden></div>
        <div class="mem-overlay" id="memOverlay" hidden><div class="mem-dialog" id="memDialog" role="dialog" aria-modal="true" aria-labelledby="memDialogTitle"></div></div>`;
    document.body.appendChild(layer);
    bindLayer(layer);

    return layer;
}

function toast(message) {
    const element = document.getElementById("memToast");

    if (!element) return;

    element.textContent = message;
    element.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { element.hidden = true; }, 4200);
}

function openDialog({
    title,
    subtitle = "",
    body,
    submitLabel,
    onSubmit,
    wide = false
}) {
    const layer = ensureLayer();
    const overlay = layer.querySelector("#memOverlay");
    const dialog = layer.querySelector("#memDialog");

    dialog.className = `mem-dialog ${wide ? "mem-dialog--wide" : ""}`;
    dialog.innerHTML = `<div class="mem-dialog__h">
            <div><h3 id="memDialogTitle">${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div>
            <button class="mem-iconbtn" type="button" data-mem-dlg="close" aria-label="Cerrar">${ic("x")}</button>
        </div>
        <form novalidate>
            <div class="mem-dialog__b">${body}</div>
            <div class="mem-dialog__f">
                <button class="mem-btn mem-btn--ghost" type="button" data-mem-dlg="close">${submitLabel ? "Cancelar" : "Cerrar"}</button>
                ${submitLabel ? `<button class="mem-btn mem-btn--primary" type="submit">${esc(submitLabel)}</button>` : ""}
            </div>
        </form>`;
    dialogSubmit = onSubmit || null;
    overlay.hidden = false;
    dialog.querySelector("input:not([type=file]), select, textarea")?.focus();
}

function closeDialog() {
    const overlay = document.getElementById("memOverlay");

    if (overlay) overlay.hidden = true;
    dialogSubmit = null;
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
            renderMemosPanel();
        }
    } catch (error) {
        toast(error?.message || "No se pudo guardar. Intenta nuevamente.");
        console.error(error);
    } finally {
        busy = false;

        if (button?.isConnected) {
            button.disabled = false;
            button.textContent = label;
        }
    }
}

function bindLayer(layer) {
    layer.addEventListener("click", event => {
        if (event.target.id === "memOverlay") {
            closeDialog();
            return;
        }

        if (event.target.closest("[data-mem-dlg='close']")) closeDialog();

        // El mismo enlace de respaldo del PDF, dentro de la pantalla completa.
        if (event.target.closest("[data-mem-act='open-doc']")) {
            const doc = memoDocuments(getMemoById(ui.openId) || {})[ui.docIndex];

            if (doc) {
                openCachedAttachment(doc, { newTab: true }).catch(error =>
                    toast(error?.message || "No se pudo abrir el documento.")
                );
            }
        }
    });

    layer.addEventListener("submit", event => {
        event.preventDefault();
        void submitDialog(event.target);
    });

    // El nombre del archivo elegido, dentro del recuadro de arrastre.
    layer.addEventListener("change", event => {
        const input = event.target;

        if (input.type !== "file") return;

        const drop = input.closest(".mem-drop");
        const text = drop?.querySelector("[data-mem-droplabel]");
        const file = input.files?.[0];

        drop?.classList.toggle("has-files", Boolean(file));

        if (text) {
            text.textContent = file
                ? file.name
                : text.dataset.default || "";
        }
    });
}

/* ---------- el documento adjunto ---------- */

function documentKindLabel(doc) {
    const type = String(doc?.type || "").toLowerCase();
    const name = String(doc?.name || "").toLowerCase();

    if (type === "application/pdf" || name.endsWith(".pdf")) return "PDF";
    if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/.test(name)) {
        return "FOTO";
    }

    return "ARCHIVO";
}

function isImageDocument(doc) {
    return documentKindLabel(doc) === "FOTO" && canPreviewAttachment(doc);
}

function isPdfDocument(doc) {
    return documentKindLabel(doc) === "PDF";
}

// La URL sale de la copia del computador (attachmentCache.js): la primera vez
// se baja de Storage y queda guardada; despues, ni el redibujo por zoom ni la
// vuelta al dia siguiente vuelven a bajarla.
async function previewURL(doc) {
    return doc ? cachedAttachmentURL(doc) : "";
}

function previewHTML(doc, url) {
    if (!url) {
        return `<div class="mem-docfile">${ic("file")}<strong>${esc(doc.name)}</strong><span>No se pudo cargar la vista previa.</span></div>`;
    }

    if (isImageDocument(doc)) {
        return `<img src="${attr(url)}" alt="${attr(doc.name)}">`;
    }

    if (isPdfDocument(doc)) {
        // El iframe apunta a firebasestorage.googleapis.com, que tiene que estar
        // en el frame-src de la CSP (firebase.json). Y hay navegadores -Chrome en
        // Android, Safari en iPhone- que no dibujan un PDF dentro de la pagina:
        // para esos queda el enlace para abrirlo aparte.
        return `<iframe src="${attr(url)}#toolbar=0&navpanes=0" title="${attr(doc.name)}" loading="lazy"></iframe>
            <button class="mem-link mem-docwrap__alt" type="button" data-mem-act="open-doc">¿No se ve el PDF? Ábrelo en otra pestaña</button>`;
    }

    return `<div class="mem-docfile">${ic("file")}<strong>${esc(doc.name)}</strong><span>Este formato se revisa fuera de TurnoPlus.</span>
        <button class="mem-btn mem-btn--secondary mem-btn--sm" type="button" data-mem-act="open-doc">${ic("eye")}Abrir el archivo</button></div>`;
}

// El visor se dibuja al instante con un aviso de carga y despues se rellena:
// resolver la URL de Storage puede demorar, y la ficha no puede quedarse en
// blanco mientras tanto. scope separa el visor del panel del de pantalla
// completa: los dos tienen su propio [data-mem-stage], y el del panel esta
// antes en el documento.
async function hydrateViewer(doc, scope = ".mem-viewer") {
    const selector = `${scope} [data-mem-stage]`;
    const token = (previewTokens.get(scope) || 0) + 1;

    previewTokens.set(scope, token);

    if (!doc || !document.querySelector(selector)) return;

    let html;

    try {
        html = previewHTML(doc, await previewURL(doc));
    } catch (error) {
        html = `<div class="mem-docfile">${ic("alert")}<strong>No se pudo mostrar el documento</strong><span>${esc(error?.message || "Intenta nuevamente.")}</span></div>`;
    }

    if (previewTokens.get(scope) !== token) return;

    const stage = document.querySelector(selector);

    if (stage) stage.innerHTML = html;
}

// Las miniaturas de la lista: solo las fotos, y solo las que se estan viendo.
async function hydrateThumbs(memos) {
    const pending = memos
        .map(memo => memoDocuments(memo)[0])
        .filter(doc => doc && isImageDocument(doc))
        .slice(0, 12);

    for (const doc of pending) {
        try {
            const url = await previewURL(doc);
            const slot = document.querySelector(
                `[data-mem-thumb="${CSS.escape(doc.id)}"]`
            );

            if (url && slot) {
                slot.innerHTML = `<img src="${attr(url)}" alt="" loading="lazy">`;
            }
        } catch {
            // La miniatura se queda con el icono; el visor explica el problema.
        }
    }
}

/* ---------- contexto y filtros ---------- */

function buildContext() {
    const today = todayISO();
    const memos = getMemos();

    return {
        today,
        memos,
        unitName: ""
    };
}

function visibleMemos(ctx, { ignore = "" } = {}) {
    const query = searchKey(ui.query.trim());

    return ctx.memos.filter(memo => {
        if (
            ignore !== "estado" &&
            ui.estado !== "all" &&
            memoStatus(memo) !== ui.estado
        ) {
            return false;
        }

        if (ignore !== "tipo" && ui.tipo !== "all" && memoKind(memo) !== ui.tipo) {
            return false;
        }

        if (
            ignore !== "periodo" &&
            ui.periodo !== "all" &&
            memoMonth(memo) !== ui.periodo
        ) {
            return false;
        }

        if (
            query &&
            !searchKey(memo.profile).includes(query) &&
            !searchKey(memo.typeLabel).includes(query)
        ) {
            return false;
        }

        return !ui.onlyOverdue || memoIsOverdue(memo, ctx.today);
    });
}

function periodOptions(ctx) {
    const months = [...new Set(
        ctx.memos.map(memoMonth).filter(Boolean)
    )].sort().reverse();

    return [
        `<option value="all" ${ui.periodo === "all" ? "selected" : ""}>Todos los meses</option>`,
        ...months.map(month =>
            `<option value="${attr(month)}" ${ui.periodo === month ? "selected" : ""}>${esc(monthLabel(month))}</option>`
        )
    ].join("");
}

function workerRut(name) {
    try {
        const profile = getProfiles().find(item => item.name === name);

        return String(profile?.rut || "").trim();
    } catch {
        return "";
    }
}

// La rotativa del trabajador ("4° Turno"), que es el turno que se lee en la
// fila de un permiso. Se cachea por dibujo: cada fila la pediria de nuevo.
const shiftCache = new Map();

function workerShift(name) {
    if (shiftCache.has(name)) return shiftCache.get(name);

    let label = "";

    try {
        const type = getRotativa(name)?.type;
        const text = type ? getRotativaLabel(type) : "";

        label = text === "Sin rotativa" ? "" : text;
    } catch {
        label = "";
    }

    shiftCache.set(name, label);

    return label;
}

/* ---------- encabezado ---------- */

// Sin texto explicativo ni tarjetas de indicadores: el usuario los quito el
// 2026-09-14, no los necesita.
function pageHeadHTML() {
    return `<header class="mem-pagehead">
        <div class="mem-pagehead__top">
            <div>
                <span class="mem-kicker">Documentos del personal</span>
                <h1>Memorándum</h1>
            </div>
            <div class="mem-pagehead__side">
                <button class="mem-btn mem-btn--secondary" type="button" data-mem-act="print-list">${ic("print")}Imprimir listado</button>
                <button class="mem-btn mem-btn--primary" type="button" data-mem-act="new">${ic("plus")}Nuevo memorándum</button>
            </div>
        </div>
    </header>`;
}

function toolbarHTML(ctx) {
    const count = estado =>
        visibleMemos(ctx, { ignore: "estado" }).filter(memo =>
            estado === "all" || memoStatus(memo) === estado
        ).length;

    return `<div class="mem-toolbar">
        <div class="mem-toolbar__group">
            <label class="mem-search" for="memSearch">${ic("search")}<input id="memSearch" type="search" placeholder="Buscar por trabajador" autocomplete="off" value="${attr(ui.query)}" data-mem-search></label>
            <div class="mem-segbtns" role="group" aria-label="Estado">
                ${[["pending", "Pendientes"], ["done", "Realizados"], ["all", "Todos"]]
                    .map(([id, label]) => `<button type="button" class="${ui.estado === id ? "is-on" : ""}" data-mem-estado="${id}">${label} · ${count(id)}</button>`)
                    .join("")}
            </div>
        </div>
        <div class="mem-toolbar__group">
            <label class="mem-select">Tipo
                <select data-mem-tipo>${TYPE_OPTIONS.map(([value, label]) =>
                    `<option value="${value}" ${ui.tipo === value ? "selected" : ""}>${label}</option>`
                ).join("")}</select>
            </label>
            <label class="mem-select">Período
                <select data-mem-periodo>${periodOptions(ctx)}</select>
            </label>
            <div class="mem-segbtns" role="group" aria-label="Vista">
                <button type="button" class="${ui.vista === "grupo" ? "is-on" : ""}" data-mem-vista="grupo">${ic("group")} Por trabajador</button>
                <button type="button" class="${ui.vista === "lista" ? "is-on" : ""}" data-mem-vista="lista">${ic("list")} Lista</button>
            </div>
        </div>
    </div>`;
}

/* ---------- lista ---------- */

function memoRowHTML(memo, ctx) {
    const state = MEMO_STATES[memoStatus(memo)];
    const age = memoDaysOld(memo, ctx.today);
    const overdue = memoIsOverdue(memo, ctx.today);
    const documents = memoDocuments(memo);
    const first = documents[0];
    const open = ui.openId === memo.id;
    const kind = memoKind(memo);

    return `<div class="mem-memo ${open ? "is-on" : ""}" data-mem-memo="${attr(memo.id)}">
        <span class="mem-memo__type mem-memo__type--${kind}" title="${attr(MEMO_KINDS[kind].label)}">${ic(MEMO_KINDS[kind].icon)}</span>
        <div class="mem-memo__body">
            <div class="mem-memo__top">
                <strong>${esc(memo.typeLabel)}</strong>
                <span class="mem-pill mem-pill--${state.tone}">${esc(state.label)}</span>
                ${overdue ? `<span class="mem-pill mem-pill--danger">${ic("alert")}${age} días sin documento</span>` : ""}
                ${memoMissingMark(memo) ? `<span class="mem-pill mem-pill--warn">Falta ${esc(memoMissingMark(memo))}</span>` : ""}
            </div>
            <div class="mem-memo__facts">
                ${memoFacts(memo, { shift: workerShift(memo.profile) }).map(fact =>
                    `<span><b>${esc(fact.label)}</b>${esc(fact.value)}</span>`
                ).join("")}
            </div>
            <div class="mem-memo__foot">
                <span>${ic("clock")} Creado ${esc(formatISO(timestampISO(memo.createdAt)))} ${esc(timestampTime(memo.createdAt))}${age > 0 ? ` · hace ${esc(plural(age, "día", "días"))}` : ""}</span>
                ${first?.resolution ? `<span>${ic("file")} Res. exenta N° ${esc(first.resolution)}${documents.length > 1 ? ` · ${documents.length} documentos` : ""}</span>` : ""}
                ${documents.length
                    ? `<span>${ic("check")} Adjunto ${esc(formatISO(timestampISO(first.attachedAt)))}</span>`
                    : memoWasRequested(memo)
                        ? `<span>${ic("send")} Se lo pedí el ${esc(formatISO(timestampISO(memo.requestedAt)))}</span>`
                        : ""}
            </div>
        </div>
        <div class="mem-memo__side">
            <div class="mem-memo__actions">
                <button class="mem-thumb ${documents.length ? "" : "is-empty"}" type="button" data-mem-ver="${attr(memo.id)}" title="${attr(documents.length ? `Ver ${first.name} aquí mismo` : "Todavía no hay documento")}" aria-label="${attr(documents.length ? "Ver el documento" : "Sin documento")}">
                    ${documents.length
                        ? `<span class="mem-thumb__slot" data-mem-thumb="${attr(first.id)}">${ic("file")}</span><span class="mem-thumb__tag">${documents.length > 1 ? `${documents.length} docs` : documentKindLabel(first)}</span>`
                        : ic("clip")}
                </button>
            </div>
            <div class="mem-memo__actions">
                ${documents.length
                    ? `<button class="mem-btn mem-btn--secondary mem-btn--sm" type="button" data-mem-ver="${attr(memo.id)}">${ic("eye")}Ver aquí</button>`
                    : `<button class="mem-btn mem-btn--secondary mem-btn--sm" type="button" data-mem-act="attach" data-mem-id="${attr(memo.id)}">${ic("clip")}Adjuntar documento</button>`}
            </div>
        </div>
    </div>`;
}

function groupHTML(group, ctx) {
    const overdue = group.memos.filter(memo =>
        memoIsOverdue(memo, ctx.today)
    ).length;
    const open = !ui.collapsed.has(group.name);
    const rut = workerRut(group.name);

    return `<section class="mem-group">
        <button class="mem-group__h" type="button" data-mem-grupo="${attr(group.name)}" aria-expanded="${open}">
            <span class="mem-avatar">${esc(initials(group.name))}</span>
            <span class="mem-group__name">
                <strong>${esc(group.name)}</strong>
                <small>${rut ? `${esc(rut)} · ` : ""}${esc(plural(group.memos.length, "memorándum", "memorándums"))} en el filtro</small>
            </span>
            <span class="mem-group__side">
                ${group.pending
                    ? `<span class="mem-pill mem-pill--danger">${group.pending} sin documento</span>`
                    : `<span class="mem-pill mem-pill--ok">${ic("check")}Al día</span>`}
                ${overdue ? `<span class="mem-pill mem-pill--warn">${overdue} atrasado${overdue > 1 ? "s" : ""}</span>` : ""}
                ${group.pending > 1 ? `<span class="mem-btn mem-btn--secondary mem-btn--sm" data-mem-act="request-group" data-mem-group="${attr(group.name)}">${ic("send")}Pedirle los ${group.pending}</span>` : ""}
            </span>
        </button>
        ${open ? group.memos.map(memo => memoRowHTML(memo, ctx)).join("") : ""}
    </section>`;
}

function overdueCalloutHTML(list, ctx) {
    // El aviso no depende del filtro: un memorandum atrasado de otro mes es
    // justamente el que se pierde de vista.
    const all = ctx.memos.filter(memo => memoIsOverdue(memo, ctx.today));

    if (!all.length || ui.onlyOverdue) return "";

    const outside = all.length - list.filter(memo =>
        memoIsOverdue(memo, ctx.today)
    ).length;
    const oldest = [...all].sort((a, b) =>
        String(a.createdAt).localeCompare(String(b.createdAt))
    )[0];

    return `<div class="mem-callout">
        <span class="mem-callout__ic">${ic("alert")}</span>
        <span class="mem-callout__txt">
            <strong>${esc(plural(all.length, "memorándum lleva", "memorándums llevan"))} más de ${OVERDUE_DAYS} días sin cerrarse</strong>
            <span>El más antiguo es de ${esc(shortName(oldest.profile))}, creado hace ${esc(plural(memoDaysOld(oldest, ctx.today), "día", "días"))}${outside ? ` · ${outside === all.length ? "quedan fuera del filtro de ahora" : `${outside} queda${outside > 1 ? "n" : ""} fuera del filtro`}` : ""}. Sin el documento firmado, el permiso queda sin respaldo.</span>
        </span>
        <button class="mem-btn mem-btn--secondary mem-btn--sm" type="button" data-mem-act="show-overdue">Ver los atrasados</button>
    </div>`;
}

function listHTML(ctx, list) {
    const heading = ui.onlyOverdue
        ? `Atrasados (+${OVERDUE_DAYS} días)`
        : {
            pending: "Pendientes",
            done: "Realizados",
            all: "Todos los memorándums"
        }[ui.estado] || "Memorándums";
    // Con el filtro de atrasados el aviso desaparece: sin este enlace no habria
    // como volver a la lista completa.
    const title = `<div class="mem-sec__h">
        <h3>${esc(heading)}</h3>
        <p>${esc(plural(list.length, "documento", "documentos"))}${ui.periodo === "all" ? "" : ` · ${esc(monthLabel(ui.periodo))}`}${ui.onlyOverdue ? ` · <button class="mem-link" type="button" data-mem-act="clear-overdue">Quitar filtro</button>` : ""}</p>
    </div>`;

    if (!list.length) {
        return `${title}<div class="mem-empty">${ic("memo")}<strong>Nada por aquí</strong><span class="mem-hint">Con estos filtros no hay memorándums. Prueba con otro período o quita el filtro de estado.</span></div>`;
    }

    const body = ui.vista === "grupo"
        ? groupByWorker(list).map(group => groupHTML(group, ctx)).join("")
        : `<section class="mem-group">${list.map(memo => memoRowHTML(memo, ctx)).join("")}</section>`;
    return `${title}${overdueCalloutHTML(list, ctx)}${body}`;
}

/* ---------- visor ---------- */

function timelineHTML(memo) {
    const done = memoStatus(memo) === "done";
    const documents = memoDocuments(memo);
    const steps = [
        {
            done: true,
            title: ORIGIN_STEP[memoKind(memo)],
            detail: `${formatISO(timestampISO(memo.createdAt))} ${timestampTime(memo.createdAt)} · desde ${MEMO_KINDS[memoKind(memo)].label.toLowerCase()}`,
            icon: "memo"
        },
        {
            done,
            title: done ? "Documento adjunto" : "Falta el documento",
            detail: done
                ? `${formatISO(timestampISO(documents[0].attachedAt))} · ${plural(documents.length, "documento", "documentos")}`
                : memoWasRequested(memo)
                    ? `Se lo pedí el ${formatISO(timestampISO(memo.requestedAt))}; todavía no llega`
                    : "Adjúntalo y el memorándum queda realizado",
            icon: "clip"
        }
    ];

    return `<div class="mem-timeline">${steps.map(step => `
        <div class="mem-tl">
            <span class="mem-tl__dot ${step.done ? "is-done" : "is-now"}">${ic(step.done ? "check" : step.icon)}</span>
            <span class="mem-tl__txt"><strong>${esc(step.title)}</strong><small>${esc(step.detail)}</small></span>
        </div>`).join("")}</div>`;
}

// Compara lo que dice el documento con lo que TurnoPlus tiene del permiso.
function matchHTML(memo, doc) {
    const issued = doc?.issuedAt;
    const start = memoStartISO(memo);
    // El documento se emite antes o el mismo dia en que parte el permiso; si
    // esta fechado despues, lo mas probable es que sea de otro permiso.
    const late = issued && start && issued > start;

    if (!issued) {
        return `<div class="mem-match">
            <span class="mem-match__ic">${ic("check")}</span>
            <span class="mem-match__txt">
                <strong>Documento adjunto</strong>
                <span>${esc(memo.typeLabel)} · ${esc(memoRangeLabel(memo))}. Anota el N° de resolución al adjuntar para poder buscarlo después.</span>
            </span>
        </div>`;
    }

    return `<div class="mem-match ${late ? "mem-match--warn" : ""}">
        <span class="mem-match__ic">${ic(late ? "alert" : "check")}</span>
        <span class="mem-match__txt">
            <strong>${late ? "Revisa las fechas" : "Coincide con el permiso"}</strong>
            <span>${late
                ? `El documento está fechado el ${esc(formatISO(issued))} y el permiso parte el ${esc(formatISO(start))}. Confirma cuál corresponde.`
                : `${esc(memo.typeLabel)} · ${esc(memoRangeLabel(memo))}, igual que en el calendario.`}</span>
        </span>
    </div>`;
}

function viewerHTML(memo, ctx) {
    if (!memo) {
        return `<div class="mem-empty">${ic("file")}<strong>Sin memorándum abierto</strong><span class="mem-hint">Elige uno de la lista para ver su documento aquí mismo.</span></div>`;
    }

    const documents = memoDocuments(memo);
    const doc = documents[ui.docIndex] || documents[0];
    const state = MEMO_STATES[memoStatus(memo)];
    const year = ctx.today.slice(0, 4);
    const fromWorker = ctx.memos.filter(item =>
        item.profile === memo.profile &&
        timestampISO(item.createdAt).slice(0, 4) === year
    );
    const pending = fromWorker.filter(item =>
        memoStatus(item) === "pending"
    ).length;
    const body = doc
        ? `<div class="mem-viewer-tools">
                <span class="mem-viewer-tools__grp">
                    <button class="mem-iconbtn" type="button" data-mem-zoom="out" title="Alejar" aria-label="Alejar">−</button>
                    <span class="mem-zoomlbl">${Math.round(ui.zoom * 100)} %</span>
                    <button class="mem-iconbtn" type="button" data-mem-zoom="in" title="Acercar" aria-label="Acercar">+</button>
                    <button class="mem-link" type="button" data-mem-zoom="fit" style="margin-left:4px">Ajustar</button>
                </span>
                ${documents.length > 1 ? `<span class="mem-viewer-tools__grp">
                    <button class="mem-iconbtn" type="button" data-mem-doc="prev" title="Documento anterior" aria-label="Documento anterior">‹</button>
                    <span class="mem-zoomlbl">${ui.docIndex + 1} de ${documents.length}</span>
                    <button class="mem-iconbtn" type="button" data-mem-doc="next" title="Documento siguiente" aria-label="Documento siguiente">›</button>
                </span>` : ""}
                <span class="mem-viewer-tools__grp">
                    <button class="mem-iconbtn" type="button" data-mem-act="fullscreen" title="Ver más grande, sin salir de la página" aria-label="Ver más grande">${ic("eye")}</button>
                    <button class="mem-iconbtn" type="button" data-mem-act="download-doc" title="Descargar" aria-label="Descargar">${ic("download")}</button>
                    <button class="mem-iconbtn" type="button" data-mem-act="print-doc" title="Imprimir" aria-label="Imprimir">${ic("print")}</button>
                    <button class="mem-iconbtn mem-iconbtn--danger" type="button" data-mem-act="remove-doc" data-mem-doc-id="${attr(doc.id)}" title="Quitar este documento" aria-label="Quitar ${attr(doc.name)}">${ic("trash")}</button>
                </span>
            </div>
            <div class="mem-viewer-stage"><div class="mem-docwrap" style="zoom:${(ui.zoom * 0.88).toFixed(2)}" data-mem-stage><div class="mem-docfile">${ic("file")}<span>Cargando el documento…</span></div></div></div>
            ${matchHTML(memo, doc)}
            <button class="mem-btn mem-btn--secondary mem-btn--sm" type="button" data-mem-act="attach" data-mem-id="${attr(memo.id)}">${ic("plus")}Agregar otro documento</button>`
        : `<div class="mem-dropzone">
                ${ic("clip")}
                <strong>Todavía no está el documento</strong>
                <p>Descárgalo del sistema de personal y adjúntalo aquí, o toma una foto del papel visado. Apenas se adjunta, el memorándum queda realizado.</p>
                <span class="mem-dropzone__acts">
                    <button class="mem-btn mem-btn--primary mem-btn--sm" type="button" data-mem-act="attach" data-mem-id="${attr(memo.id)}">${ic("clip")}Adjuntar documento</button>
                    ${memoWasRequested(memo) ? "" : `<button class="mem-btn mem-btn--secondary mem-btn--sm" type="button" data-mem-act="request" data-mem-id="${attr(memo.id)}">${ic("send")}Marcar que se lo pedí</button>`}
                </span>
            </div>`;

    return `<div class="mem-viewer-head">
            <div class="mem-viewer-file">
                <span class="mem-kicker">${esc(VIEWER_KICKER[memoKind(memo)])}</span>
                <strong>${esc(doc ? doc.name : shortName(memo.profile))}</strong>
                <small>${doc
                    ? `${doc.resolution ? `Res. exenta N° ${esc(doc.resolution)} · ` : ""}${doc.issuedAt ? `${esc(formatISO(doc.issuedAt))} · ` : ""}${documentKindLabel(doc)}`
                    : `${esc(memo.typeLabel)} · ${esc(shortName(memo.profile))}`}</small>
            </div>
            <span class="mem-pill mem-pill--${state.tone}">${esc(state.label)}</span>
        </div>
        ${body}
        <div class="mem-viewer-meta">
            ${timelineHTML(memo)}
            <div class="mem-metric">
                <span>${esc(shortName(memo.profile))} este año</span>
                <strong>${esc(plural(fromWorker.length, "memorándum", "memorándums"))}</strong>
                <span class="mem-hint">${pending ? `${pending} pendiente${pending > 1 ? "s" : ""}` : "Todos realizados"}</span>
            </div>
            <button class="mem-link" type="button" data-mem-act="open-calendar" data-mem-id="${attr(memo.id)}">Ver el permiso en el calendario</button>
        </div>`;
}

/* ---------- dialogos ---------- */

function attachDialog(memo) {
    openDialog({
        title: "Adjuntar el documento",
        subtitle: `${memo.typeLabel} · ${shortName(memo.profile)}`,
        submitLabel: "Adjuntar documento",
        body: `<div class="mem-field">
                <span>Documento del sistema de personal</span>
                <label class="mem-drop">
                    ${ic("clip")}<span data-mem-droplabel data-default="Elige el PDF o la foto del papel firmado">Elige el PDF o la foto del papel firmado</span>
                    <input type="file" name="file" accept="${attr(MEMO_ATTACHMENT_ACCEPT)}" required>
                </label>
                <small>Sirve el PDF descargado del sistema o una foto del documento visado. Queda en esta ficha y en la casilla del calendario.</small>
            </div>
            <div class="mem-fgrid">
                <label class="mem-field"><span>N° de resolución exenta</span><input type="text" name="resolution" placeholder="Ej: 2026051601029209"><small>Se lee del documento; sirve para buscarlo después.</small></label>
                <label class="mem-field"><span>Fecha del documento</span><input type="date" name="issuedAt"></label>
            </div>
            <p class="mem-hint">Apenas quede adjunto, el memorándum pasa a <b>Realizado</b>. Si después llega otro documento (la visación firmada, por ejemplo), se agrega al mismo memorándum.</p>`,
        onSubmit: async form => {
            const file = form.querySelector('input[name="file"]')?.files?.[0];

            if (!file) {
                toast("Elige el archivo que vas a adjuntar.");
                return false;
            }

            await addMemoDocument(memo.id, file, {
                resolution: form.querySelector('input[name="resolution"]')?.value || "",
                issuedAt: form.querySelector('input[name="issuedAt"]')?.value || ""
            });

            ui.openId = memo.id;
            ui.docIndex = 0;
            toast("Documento adjunto: el memorándum quedó realizado.");

            return true;
        }
    });
}

function newMemoDialog(ctx) {
    const names = [...new Set([
        ...getProfilesSafe().map(profile => profile.name),
        ...ctx.memos.map(memo => memo.profile)
    ].filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));

    openDialog({
        title: "Nuevo memorándum",
        subtitle: "Para el documento que no nace de un permiso ni de un marcaje y que igual hay que guardar.",
        submitLabel: "Crear memorándum",
        body: `<div class="mem-fgrid">
                <label class="mem-field"><span>Trabajador</span><select name="profile">${names.map(name => `<option value="${attr(name)}">${esc(name)}</option>`).join("")}</select></label>
                <label class="mem-field"><span>Asunto</span><input type="text" name="typeLabel" placeholder="Ej: Constancia de entrega de uniforme" required></label>
                <label class="mem-field"><span>Fecha del documento</span><input type="date" name="date" value="${attr(ctx.today)}"></label>
                <label class="mem-field"><span>N° de resolución o referencia</span><input type="text" name="reference" placeholder="Si el documento lo trae"></label>
            </div>
            <label class="mem-field is-wide"><span>Detalle</span><textarea name="detail" placeholder="Lo que conviene dejar anotado del documento."></textarea></label>
            <p class="mem-hint">Puedes crearlo ahora y adjuntar el documento después: queda en la lista como pendiente.</p>`,
        onSubmit: async form => {
            const profile = form.querySelector('select[name="profile"]')?.value || "";
            const typeLabel = (form.querySelector('input[name="typeLabel"]')?.value || "").trim();
            const date = form.querySelector('input[name="date"]')?.value || ctx.today;
            const reference = (form.querySelector('input[name="reference"]')?.value || "").trim();
            const detail = (form.querySelector('textarea[name="detail"]')?.value || "").trim();

            if (!profile || !typeLabel) {
                toast("Falta el trabajador o el asunto.");
                return false;
            }

            const memo = createMemoTask({
                sourceId: ["manual", profile, typeLabel, date, Date.now()].join(":"),
                profile,
                typeLabel,
                dateKey: isoToDayKey(date),
                detail: [
                    `Nombre: ${profile}`,
                    `Asunto: ${typeLabel}`,
                    `Fecha: ${formatISO(date)}`,
                    reference ? `Referencia: ${reference}` : "",
                    detail ? `Detalle: ${detail}` : ""
                ].filter(Boolean).join(" | ")
            });

            ui.openId = memo.id;
            ui.docIndex = 0;
            toast("Memorándum creado: queda pendiente hasta que se adjunte el documento.");

            return true;
        }
    });
}

function fullscreenDialog(memo) {
    const doc = memoDocuments(memo)[ui.docIndex] || memoDocuments(memo)[0];

    if (!doc) return;

    openDialog({
        title: doc.name,
        subtitle: [
            doc.resolution ? `Res. exenta N° ${doc.resolution}` : "",
            shortName(memo.profile)
        ].filter(Boolean).join(" · "),
        wide: true,
        body: `<div class="mem-viewer-stage is-full"><div class="mem-docwrap" data-mem-stage><div class="mem-docfile">${ic("file")}<span>Cargando el documento…</span></div></div></div>`
    });

    void hydrateViewer(doc, "#memDialog");
}

function getProfilesSafe() {
    try {
        return getProfiles();
    } catch {
        return [];
    }
}

/* ---------- acciones ---------- */

function openMemo(memoId) {
    ui.openId = memoId;
    ui.docIndex = 0;
    ui.zoom = 1;
}

async function printList(memos, ctx, { title, subtitle }) {
    if (!memos.length) {
        toast("No hay memorándums en este filtro para imprimir.");
        return;
    }

    toast("Preparando el listado…");

    await printDocument(memoListPrintHTML({
        memos,
        today: ctx.today,
        unitName: ctx.unitName,
        printedAt: `${formatISO(ctx.today)} ${timestampTime(new Date().toISOString())}`,
        title,
        subtitle
    }));
}

async function printCurrentDocument(memo) {
    const doc = memoDocuments(memo)[ui.docIndex] || memoDocuments(memo)[0];

    if (!doc) return;

    // Una foto se imprime tal cual; un PDF lo imprime su propio visor, que
    // pagina mejor que cualquier cosa que armemos aca.
    if (!isImageDocument(doc)) {
        await openCachedAttachment(doc, { newTab: true });
        toast("El documento se abrió para imprimirlo desde su visor.");
        return;
    }

    const url = await previewURL(doc);

    await printDocument(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${escapeHTML(doc.name)}</title>
<style>@page { size: A4; margin: 10mm; } body { margin: 0; } img { width: 100%; object-fit: contain; }</style>
</head><body><img src="${attr(url)}" alt="${attr(doc.name)}"></body></html>`);
}

async function removeCurrentDocument(memo, documentId) {
    const confirmed = await showConfirm(
        "¿Eliminar este documento del memorandum? " +
        "Tambien dejara de verse en las casillas del calendario, y el " +
        "memorandum vuelve a quedar pendiente si era el unico.",
        {
            title: "Eliminar documento",
            confirmText: "Eliminar",
            destructive: true
        }
    );

    if (!confirmed) return;

    try {
        await removeMemoDocument(memo.id, documentId);
        ui.docIndex = 0;
        toast(memoDocuments(getMemoById(memo.id) || {}).length
            ? "Documento quitado; queda el otro adjunto."
            : "Documento quitado: el memorándum vuelve a Pendiente.");
        renderMemosPanel();
    } catch (error) {
        toast(error?.message || "No se pudo eliminar el documento.");
        console.error(error);
    }
}

function requestDocuments(memos, message) {
    const touched = setMemoRequested(memos.map(memo => memo.id));

    if (!touched.length) {
        toast("No hay documentos pendientes que marcar.");
        return;
    }

    toast(message(touched));
    renderMemosPanel();
}

// El calendario no se puede importar desde aca (el calendario ya importa este
// modulo): se avisa a main.js por el mismo camino que usa "Ver en calendario"
// de Solicitudes, que selecciona al trabajador ANTES de abrir el mes. Solo
// cambiar el mes dejaba a la vista el calendario de la ultima persona abierta.
function openInCalendar(memo) {
    const keyDay = memo.keys[0] || memo.dateKey || memo.startKey;

    if (!keyDay) {
        toast("Este memorándum no está asociado a un día del calendario.");
        return;
    }

    window.dispatchEvent(new CustomEvent("proturnos:viewWorkerRequestInCalendar", {
        detail: { profile: memo.profile, date: dayKeyToISO(keyDay) }
    }));
}

/* ---------- eventos del panel ---------- */

let documentBound = false;

async function onPanelClick(event) {
    const target = event.target.closest(
        "[data-mem-estado],[data-mem-vista],[data-mem-grupo],[data-mem-ver],[data-mem-zoom],[data-mem-doc],[data-mem-act],[data-mem-memo]"
    );

    if (!target) return;

    const data = target.dataset;
    const ctx = buildContext();
    const memoById = id => ctx.memos.find(memo => memo.id === id) || null;

    if (data.memVer) {
        openMemo(data.memVer);
        renderMemosPanel();
        return;
    }

    if (data.memZoom) {
        ui.zoom = data.memZoom === "in"
            ? Math.min(2.4, ui.zoom + 0.2)
            : data.memZoom === "out"
                ? Math.max(0.6, ui.zoom - 0.2)
                : 1;
        renderMemosPanel();
        return;
    }

    if (data.memDoc) {
        const total = memoDocuments(memoById(ui.openId) || {}).length;

        if (!total) return;

        ui.docIndex = data.memDoc === "next"
            ? (ui.docIndex + 1) % total
            : (ui.docIndex - 1 + total) % total;
        renderMemosPanel();
        return;
    }

    if (data.memEstado) {
        ui.estado = data.memEstado;
        ui.onlyOverdue = false;
        renderMemosPanel();
        return;
    }

    if (data.memVista) {
        ui.vista = data.memVista;
        renderMemosPanel();
        return;
    }

    if (data.memGrupo && !data.memAct) {
        if (ui.collapsed.has(data.memGrupo)) {
            ui.collapsed.delete(data.memGrupo);
        } else {
            ui.collapsed.add(data.memGrupo);
        }

        renderMemosPanel();
        return;
    }

    switch (data.memAct) {
        case "attach": {
            const memo = memoById(data.memId);

            if (memo) attachDialog(memo);
            return;
        }
        case "new":
            newMemoDialog(ctx);
            return;
        case "fullscreen": {
            const memo = memoById(ui.openId);

            if (memo) fullscreenDialog(memo);
            return;
        }
        case "open-doc":
        case "download-doc": {
            const memo = memoById(ui.openId);
            const doc = memoDocuments(memo || {})[ui.docIndex];

            if (!doc) return;

            try {
                await openCachedAttachment(doc, { newTab: data.memAct === "open-doc" });
            } catch (error) {
                toast(error?.message || "No se pudo abrir el documento.");
            }
            return;
        }
        case "print-doc": {
            const memo = memoById(ui.openId);

            if (!memo) return;

            try {
                await printCurrentDocument(memo);
            } catch (error) {
                toast(error?.message || "No se pudo imprimir el documento.");
            }
            return;
        }
        case "remove-doc": {
            const memo = memoById(ui.openId);

            if (memo) await removeCurrentDocument(memo, data.memDocId);
            return;
        }
        case "request": {
            const memo = memoById(data.memId);

            if (memo) {
                requestDocuments(
                    [memo],
                    () => `Anotado: le pediste el documento a ${shortName(memo.profile)}.`
                );
            }
            return;
        }
        case "request-group": {
            const name = data.memGroup;
            const pending = ctx.memos.filter(memo =>
                memo.profile === name && memoStatus(memo) === "pending"
            );

            requestDocuments(
                pending,
                touched => `Anotado: le pediste ${plural(touched.length, "documento", "documentos")} a ${shortName(name)}.`
            );
            return;
        }
        case "print-list":
            await printList(visibleMemos(ctx), ctx, {
                title: ui.estado === "pending"
                    ? "Memorándums pendientes"
                    : "Listado de memorándums",
                subtitle: `${ui.periodo === "all" ? "Todos los meses" : monthLabel(ui.periodo)} · ${plural(visibleMemos(ctx).length, "memorándum", "memorándums")}`
            });
            return;
        case "show-overdue":
            ui.onlyOverdue = true;
            ui.estado = "all";
            ui.periodo = "all";
            renderMemosPanel();
            return;
        case "clear-overdue":
            ui.onlyOverdue = false;
            ui.estado = "pending";
            renderMemosPanel();
            return;
        case "open-calendar": {
            const memo = memoById(data.memId);

            if (memo) openInCalendar(memo);
            return;
        }
        default:
            break;
    }

    if (data.memMemo) {
        openMemo(data.memMemo);
        renderMemosPanel();
    }
}

function onPanelChange(event) {
    const input = event.target;

    if (input.dataset.memTipo !== undefined) {
        ui.tipo = input.value;
        renderMemosPanel();
        return;
    }

    if (input.dataset.memPeriodo !== undefined) {
        ui.periodo = input.value;
        renderMemosPanel();
    }
}

function bindPanel(panel) {
    if (panel.dataset.memBound !== "1") {
        panel.dataset.memBound = "1";
        panel.addEventListener("click", event => { void onPanelClick(event); });
        panel.addEventListener("change", onPanelChange);
        panel.addEventListener("input", event => {
            if (!event.target.matches?.("[data-mem-search]")) return;

            ui.query = event.target.value || "";
            renderMemosPanel();
        });
    }

    if (!documentBound) {
        documentBound = true;
        document.addEventListener("keydown", event => {
            if (event.key !== "Escape") return;
            if (document.getElementById("memOverlay")?.hidden === false) {
                closeDialog();
            }
        });
    }
}

/* ---------- entrada ---------- */

export function renderMemosPanel() {
    if (typeof document === "undefined") return;

    const panel = document.getElementById("memosPanel");

    updateMemosNavBadge();

    if (!panel) return;

    ensureLayer();
    bindPanel(panel);

    shiftCache.clear();

    const ctx = buildContext();
    const list = sortMemosForList(visibleMemos(ctx), ctx.today);

    // El visor sigue al memorandum abierto; si el filtro lo dejo fuera, muestra
    // el primero de la lista para no quedar en blanco.
    if (!ctx.memos.some(memo => memo.id === ui.openId)) {
        ui.openId = list[0]?.id || ctx.memos[0]?.id || "";
        ui.docIndex = 0;
    }

    const openMemoRecord = ctx.memos.find(memo => memo.id === ui.openId) || null;
    const active = document.activeElement;
    const searchFocused = active?.id === "memSearch";
    const caret = searchFocused ? active.selectionStart : null;

    panel.innerHTML = `<div class="mem mem-root">
        ${pageHeadHTML()}
        ${toolbarHTML(ctx)}
        <div class="mem-workspace">
            <main class="mem-list-panel" aria-label="Memorándums">${listHTML(ctx, list)}</main>
            <aside class="mem-viewer" aria-label="Documento adjunto">${viewerHTML(openMemoRecord, ctx)}</aside>
        </div>
    </div>`;

    if (searchFocused) {
        const input = document.getElementById("memSearch");

        input?.focus();
        if (input && caret !== null) input.setSelectionRange(caret, caret);
    }

    const openDoc = memoDocuments(openMemoRecord || {})[ui.docIndex];

    if (openDoc) void hydrateViewer(openDoc);

    void hydrateThumbs(list);
}
