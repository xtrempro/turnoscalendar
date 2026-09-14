// Documentos adjuntos de una licencia medica.
//
// Se guardan en Firebase Storage, no dentro del documento de estado. Es la
// diferencia con lo que pasaba en los registros del perfil, donde el archivo se
// "adjuntaba" pero solo quedaba su nombre y despues no habia nada que abrir.
// Aca cada adjunto lleva su storagePath, que es lo que permite recuperarlo.
//
// La licencia se identifica por su registro en el LOG (logId), que es el mismo
// que usa "Anular permiso": asi el adjunto pertenece a esa aplicacion concreta
// y no a una fecha suelta.

import { getJSON, setJSON } from "./persistence.js";
import {
    readAttachmentFile,
    validateAttachmentFile,
    deleteStoredAttachment
} from "./attachmentUtils.js";
import {
    forgetCachedAttachment,
    openCachedAttachment
} from "./attachmentCache.js";

const STORAGE_KEY = "leaveAttachments";

// Solo lo que el trabajador puede abrir en el telefono sin instalar nada, que
// es el mismo criterio de la mensajeria.
export const LEAVE_ATTACHMENT_ACCEPT =
    ".png,.jpg,.jpeg,.gif,.webp,.bmp,.heic,.heif,.pdf";
const ALLOWED_EXTENSIONS = new Set(
    LEAVE_ATTACHMENT_ACCEPT.split(",").map(extension => extension.slice(1))
);

// Tipos de ausencia que llevan documento de respaldo. Un permiso administrativo
// o un feriado legal no lo necesitan.
const DOCUMENTED_TYPES = new Set(["license", "professional_license"]);

export function leaveTypeNeedsDocument(type) {
    return DOCUMENTED_TYPES.has(String(type || ""));
}

function leaveKey(profile, logId) {
    const name = String(profile || "").trim();
    const id = String(logId || "").trim();

    return name && id ? `${name}|${id}` : "";
}

function getStore() {
    const stored = getJSON(STORAGE_KEY, {});

    return stored && typeof stored === "object" ? stored : {};
}

function normalizeList(value) {
    return (Array.isArray(value) ? value : []).filter(item =>
        item && (item.storagePath || item.dataUrl)
    );
}

/**
 * Adjuntos de una licencia.
 * @param {string} profile
 * @param {string} logId
 * @returns {Array<Object>}
 */
export function getLeaveAttachments(profile, logId) {
    const key = leaveKey(profile, logId);

    if (!key) return [];

    return normalizeList(getStore()[key]);
}

export function hasLeaveAttachments(profile, logId) {
    return getLeaveAttachments(profile, logId).length > 0;
}

function saveLeaveAttachments(profile, logId, attachments) {
    const key = leaveKey(profile, logId);

    if (!key) return;

    const store = getStore();
    const list = normalizeList(attachments);

    if (list.length) {
        store[key] = list;
    } else {
        delete store[key];
    }

    setJSON(STORAGE_KEY, store);
}

export function validateLeaveAttachment(file) {
    validateAttachmentFile(file);

    const extension = String(file.name || "")
        .toLowerCase()
        .match(/\.([a-z0-9]+)$/)?.[1] || "";

    if (!ALLOWED_EXTENSIONS.has(extension)) {
        throw new Error(
            "El respaldo de la licencia debe ser una imagen o un archivo PDF."
        );
    }

    return file;
}

// El memorandum de la licencia muestra estos mismos archivos (memos.js): se
// avisa para que su lista y el contador del menu se actualicen cuando se
// adjunta o se quita desde la casilla del calendario.
function notifyMemos() {
    if (
        typeof window === "undefined" ||
        typeof window.dispatchEvent !== "function" ||
        typeof CustomEvent !== "function"
    ) {
        return;
    }

    window.dispatchEvent(new CustomEvent("proturnos:memosChanged"));
}

/**
 * Sube un archivo y lo deja asociado a la licencia.
 *
 * @param {string} profile
 * @param {string} logId
 * @param {File} file
 * @returns {Promise<Object>} el adjunto guardado
 */
export async function addLeaveAttachment(profile, logId, file) {
    if (!leaveKey(profile, logId)) {
        throw new Error(
            "No se pudo identificar la licencia a la que pertenece el documento."
        );
    }

    validateLeaveAttachment(file);

    const attachment = await readAttachmentFile(file, {
        moduleId: "leaves",
        ownerId: profile,
        recordId: logId
    });

    if (!attachment?.storagePath && !attachment?.dataUrl) {
        throw new Error("El documento no se pudo guardar. Intenta nuevamente.");
    }

    saveLeaveAttachments(profile, logId, [
        ...getLeaveAttachments(profile, logId),
        attachment
    ]);
    notifyMemos();

    return attachment;
}

// Desde la copia del computador (attachmentCache.js): el respaldo de una
// licencia se vuelve a abrir desde el calendario y desde el perfil.
export async function openLeaveAttachment(attachment) {
    return openCachedAttachment(attachment, { newTab: true });
}

/**
 * Quita un adjunto: primero del almacenamiento y despues de la lista.
 *
 * Si se borrara la referencia antes, un fallo al eliminar el archivo dejaria
 * un documento huerfano en Storage que nadie puede ya alcanzar.
 */
export async function removeLeaveAttachment(profile, logId, attachmentId) {
    const attachments = getLeaveAttachments(profile, logId);
    const attachment = attachments.find(item =>
        String(item.id) === String(attachmentId)
    );

    if (!attachment) return false;

    await deleteStoredAttachment(attachment);
    saveLeaveAttachments(
        profile,
        logId,
        attachments.filter(item => item !== attachment)
    );
    void forgetCachedAttachment(attachment);
    notifyMemos();

    return true;
}
