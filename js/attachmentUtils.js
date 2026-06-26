import {
    getCurrentFirebaseUser,
    getFirebaseServices,
    isFirebaseConfigured
} from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";

export const ATTACHMENT_ACCEPT =
    ".png,.jpg,.jpeg,.gif,.webp,.bmp,.heic,.heif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx";
export const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
export const MAX_ATTACHMENT_FILES = 10;
export const MAX_ATTACHMENT_TOTAL_SIZE = 12 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set(
    ATTACHMENT_ACCEPT.split(",").map(extension => extension.slice(1))
);
const ALLOWED_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/heic",
    "image/heif",
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
const STORAGE_MODULES = new Set([
    "profile",
    "clockmarks",
    "agenda",
    "memos",
    "weekly",
    "requests"
]);
const MIME_BY_EXTENSION = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    heic: "image/heic",
    heif: "image/heif",
    pdf: "application/pdf",
    txt: "text/plain",
    csv: "text/csv",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

function fileExtension(name) {
    const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    return match?.[1] || "";
}

function safePathSegment(value, fallback = "item") {
    const clean = String(value || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 120);

    return clean || fallback;
}

function fileContentType(file) {
    return String(file.type || "").toLowerCase() ||
        MIME_BY_EXTENSION[fileExtension(file.name)] ||
        "application/octet-stream";
}

function storageContext(options = {}) {
    const moduleId = String(options.moduleId || options.module || "").trim();
    const ownerId = safePathSegment(options.ownerId, "workspace");
    const recordId = safePathSegment(
        options.recordId,
        `record_${Date.now()}`
    );

    if (!STORAGE_MODULES.has(moduleId)) return null;

    const workspace = getActiveWorkspace();
    const user = getCurrentFirebaseUser();

    if (
        !isFirebaseConfigured() ||
        !workspace?.id ||
        !user?.uid
    ) {
        return null;
    }

    return {
        moduleId,
        ownerId,
        recordId,
        workspaceId: workspace.id,
        userId: user.uid
    };
}

function attachmentId(prefix = "attachment") {
    return globalThis.crypto?.randomUUID?.() ||
        `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function validateAttachmentFile(file) {
    if (!(file instanceof File)) {
        throw new Error("El archivo adjunto no es valido.");
    }

    if (file.size <= 0 || file.size > MAX_ATTACHMENT_SIZE) {
        throw new Error("Cada adjunto debe pesar entre 1 byte y 5 MB.");
    }

    const extension = fileExtension(file.name);
    const mime = String(file.type || "").toLowerCase();

    if (
        !ALLOWED_EXTENSIONS.has(extension) ||
        (mime && !ALLOWED_MIME_TYPES.has(mime))
    ) {
        throw new Error(
            "Formato no permitido. Usa imagenes, PDF, texto, Word o Excel sin macros."
        );
    }

    return file;
}

export function validateAttachmentFiles(files) {
    const list = Array.from(files || []);

    if (list.length > MAX_ATTACHMENT_FILES) {
        throw new Error(`Puedes adjuntar hasta ${MAX_ATTACHMENT_FILES} archivos.`);
    }

    let totalSize = 0;

    list.forEach(file => {
        validateAttachmentFile(file);
        totalSize += file.size;
    });

    if (totalSize > MAX_ATTACHMENT_TOTAL_SIZE) {
        throw new Error("El total de adjuntos no puede superar 12 MB.");
    }

    return list;
}

/**
 * Normaliza una lista de File a metadatos de adjunto (sin el contenido).
 * @param {FileList|File[]} files
 * @returns {Array<{id: string, name: string, type: string, size: number, addedAt: string}>}
 */
export function normalizeAttachmentFiles(files) {
    return validateAttachmentFiles(files).map(file => ({
        id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name: file.name,
        type: file.type || "",
        size: file.size || 0,
        addedAt: new Date().toISOString()
    }));
}

/**
 * Lee un File como data URL (base64).
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        try {
            validateAttachmentFile(file);
        } catch (error) {
            reject(error);
            return;
        }

        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

/**
 * Normaliza y lee una lista de File, incluyendo su contenido como data URL.
 * @param {FileList|File[]} files
 * @returns {Promise<Array<Object>>}
 */
export async function readAttachmentFiles(files, options = {}) {
    const list = validateAttachmentFiles(files);
    const attachments = [];
    const context = storageContext(options);

    for (const file of list) {
        if (!context) {
            attachments.push({
                ...normalizeAttachmentFiles([file])[0],
                dataUrl: await readFileAsDataURL(file)
            });
            continue;
        }

        const id = attachmentId("attachment");
        const safeName = safePathSegment(file.name, "archivo");
        const storagePath = [
            "workspaces",
            context.workspaceId,
            "attachments",
            context.moduleId,
            context.ownerId,
            context.recordId,
            `${id}_${safeName}`
        ].join("/");
        const { storage, storageModule } =
            await getFirebaseServices();

        await storageModule.uploadBytes(
            storageModule.ref(storage, storagePath),
            file,
            {
                contentType: fileContentType(file),
                customMetadata: {
                    workspaceId: context.workspaceId,
                    moduleId: context.moduleId,
                    ownerId: context.ownerId,
                    recordId: context.recordId,
                    uploadedByUid: context.userId,
                    originalName: String(file.name || "").slice(0, 240)
                }
            }
        );

        attachments.push({
            id,
            name: file.name,
            type: fileContentType(file),
            size: file.size || 0,
            addedAt: new Date().toISOString(),
            storagePath,
            uploadedByUid: context.userId
        });
    }

    return attachments;
}

export async function readAttachmentFile(file, options = {}) {
    if (!file) return null;

    return (await readAttachmentFiles([file], options))[0] || null;
}

export function hasAttachmentContent(attachment) {
    return Boolean(attachment?.dataUrl || attachment?.storagePath);
}

async function storedAttachmentBlob(attachment) {
    if (!attachment?.storagePath) return null;

    const { storage, storageModule } = await getFirebaseServices();

    return storageModule.getBlob(
        storageModule.ref(storage, attachment.storagePath)
    );
}

export async function openAttachmentFile(
    attachment,
    { newTab = false } = {}
) {
    if (!hasAttachmentContent(attachment)) {
        throw new Error("Este adjunto no tiene contenido disponible.");
    }

    const openedTab = newTab
        ? window.open("about:blank", "_blank")
        : null;

    if (newTab && !openedTab) {
        throw new Error(
            "El navegador bloqueo la ventana emergente."
        );
    }

    if (openedTab) {
        openedTab.opener = null;
    }

    let url = "";

    try {
        const blob = attachment.storagePath
            ? await storedAttachmentBlob(attachment)
            : dataUrlToBlob(attachment.dataUrl);

        url = URL.createObjectURL(blob);
    } catch (error) {
        openedTab?.close();
        throw error;
    }

    if (newTab) {
        openedTab.location.replace(url);
    } else {
        const link = window.document.createElement("a");

        link.href = url;
        link.download = attachment.name || "archivo";
        link.rel = "noopener";
        link.click();
    }

    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function deleteStoredAttachment(attachment) {
    if (!attachment?.storagePath) return;

    const { storage, storageModule } = await getFirebaseServices();

    await storageModule.deleteObject(
        storageModule.ref(storage, attachment.storagePath)
    );
}

/**
 * Convierte un data URL base64 a un Blob.
 * @param {string} dataUrl
 * @returns {Blob}
 */
// Tipos que el navegador renderiza inline y pueden ejecutar script (SVG, HTML,
// XML). Al abrirse como blob heredan el origen de la app, asi que se fuerzan a
// descarga (octet-stream) para evitar XSS almacenado.
const UNSAFE_INLINE_MIME = /^(image\/svg|text\/html|application\/xhtml|application\/xml|text\/xml)/i;

export function dataUrlToBlob(dataUrl) {
    const [header, data] = String(dataUrl || "").split(",");
    const mimeMatch = header.match(/data:([^;]+);base64/);
    let mime = mimeMatch?.[1] || "application/octet-stream";

    if (UNSAFE_INLINE_MIME.test(mime)) {
        mime = "application/octet-stream";
    }

    const binary = atob(data || "");
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type: mime });
}
