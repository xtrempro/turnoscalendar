import {
    getCurrentFirebaseUser,
    getFirebaseServices,
    isFirebaseConfigured
} from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";
import {
    canUseAttachments,
    getCachedAccountUsage,
    refreshAccountUsage
} from "./subscription.js";

export const ATTACHMENT_ACCEPT =
    ".png,.jpg,.jpeg,.gif,.webp,.bmp,.heic,.heif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx";
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_FILES = 10;
export const MAX_ATTACHMENT_TOTAL_SIZE =
    MAX_ATTACHMENT_SIZE * MAX_ATTACHMENT_FILES;
const STORAGE_APP_CHECK_TIMEOUT_MS = 12000;
const MEDICAL_EQUIPMENT_ATTACHMENT_MODULE_ID = "medicalEquipment";

const ALLOWED_EXTENSIONS = new Set(
    ATTACHMENT_ACCEPT.split(",").map(extension => extension.slice(1))
);
const ALLOWED_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/pjpeg",
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
    "tasks",
    "requests",
    "informations",
    "medicalEquipment",
    // Formulario de evaluacion cuatrimestral firmado y escaneado. El ownerId es
    // el trabajador y el recordId el periodo evaluado.
    "qualifications",
    // Respaldos de licencias medicas. El ownerId es el trabajador y el recordId
    // el registro del LOG de esa licencia (ver leaveAttachments.js).
    "leaves",
    // Adjuntos de la mensajeria con los trabajadores. El ownerId de la ruta es
    // el uid del destinatario: es lo que deja que su PWA lea el archivo sin ser
    // miembro del entorno (ver storage.rules).
    "messages"
]);

// La mensajeria acepta MENOS tipos que el resto del app: solo lo que el
// trabajador puede abrir en el telefono sin instalar nada.
export const MESSAGE_ATTACHMENT_ACCEPT =
    ".png,.jpg,.jpeg,.gif,.webp,.bmp,.heic,.heif,.pdf";
const MESSAGE_ATTACHMENT_EXTENSIONS = new Set(
    MESSAGE_ATTACHMENT_ACCEPT.split(",").map(extension => extension.slice(1))
);
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
const PREVIEWABLE_MIME_TYPES = new Set([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/pjpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "text/plain",
    "text/csv"
]);
const PREVIEWABLE_EXTENSIONS = new Set([
    "pdf",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "bmp",
    "txt",
    "csv"
]);

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
    const type = String(file.type || "").toLowerCase();

    return (
        type === "image/jpg" || type === "image/pjpeg"
            ? "image/jpeg"
            : type
    ) ||
        MIME_BY_EXTENSION[fileExtension(file.name)] ||
        "application/octet-stream";
}

function baseContentType(type) {
    const clean = String(type || "")
        .toLowerCase()
        .split(";")[0]
        .trim();

    return clean === "image/jpg" || clean === "image/pjpeg"
        ? "image/jpeg"
        : clean;
}

export function canPreviewAttachment(attachment) {
    const type = baseContentType(attachment?.type);

    if (PREVIEWABLE_MIME_TYPES.has(type)) return true;

    return !type &&
        PREVIEWABLE_EXTENSIONS.has(fileExtension(attachment?.name));
}

function timeoutPromise(ms) {
    return new Promise((_, reject) => {
        globalThis.setTimeout(() => {
            reject(new Error("No se pudo validar App Check a tiempo."));
        }, ms);
    });
}

async function waitForStorageAppCheck(services, action) {
    if (!services?.appCheck || !services?.appCheckModule?.getToken) return;

    try {
        await Promise.race([
            services.appCheckReadyPromise,
            timeoutPromise(STORAGE_APP_CHECK_TIMEOUT_MS)
        ]);
    } catch {
        // Se pide token fresco abajo para obtener el error real de App Check.
    }

    try {
        await Promise.race([
            services.appCheckModule.getToken(services.appCheck, false),
            timeoutPromise(STORAGE_APP_CHECK_TIMEOUT_MS)
        ]);
    } catch (error) {
        throw attachmentStorageError(error, action);
    }
}

async function getStorageServices(action) {
    const services = await getFirebaseServices();

    await waitForStorageAppCheck(services, action);

    return services;
}

export function attachmentStorageErrorMessage(error, action = "usar") {
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    const normalizedMessage = message.toLowerCase();

    if (error?.planBlocked) return message;
    if (error?.attachmentStorageMessage) return message;

    if (code === "storage/object-not-found") {
        return "El archivo adjunto ya no esta disponible en TurnoPlus.";
    }

    if (
        code === "storage/unauthenticated" ||
        code === "storage/unauthorized" ||
        code === "permission-denied" ||
        code === "functions/unauthenticated" ||
        code === "functions/permission-denied"
    ) {
        if (action === "subir") {
            return "No tienes permisos para subir este archivo adjunto en la unidad activa.";
        }

        if (action === "eliminar") {
            return "No tienes permisos para eliminar este archivo adjunto.";
        }

        return "No tienes permisos para acceder a este archivo adjunto.";
    }

    if (
        code === "storage/retry-limit-exceeded" ||
        code === "storage/canceled" ||
        code === "storage/unknown" ||
        normalizedMessage.includes("retry time") ||
        normalizedMessage.includes("app check")
    ) {
        return (
            `Firebase Storage no pudo ${action} el archivo. ` +
            "Revisa la conexion, recarga TurnoPlus e intenta nuevamente."
        );
    }

    return `No se pudo ${action} el archivo adjunto. Intenta nuevamente.`;
}

function attachmentStorageError(error, action) {
    const next = new Error(attachmentStorageErrorMessage(error, action));

    next.code = error?.code || "storage/operation-failed";
    next.cause = error;
    next.attachmentStorageMessage = true;

    return next;
}

function isPublishedInformationContext(context) {
    return context?.moduleId === "informations" &&
        context.ownerId === "published";
}

function isQualificationContext(context) {
    return context?.moduleId === "qualifications";
}

function isMedicalEquipmentContext(context) {
    return context?.moduleId === MEDICAL_EQUIPMENT_ATTACHMENT_MODULE_ID;
}

function isPublishedInformationStoragePath(storagePath) {
    const parts = String(storagePath || "").split("/");

    return parts.length === 7 &&
        parts[0] === "workspaces" &&
        parts[2] === "attachments" &&
        parts[3] === "informations" &&
        parts[4] === "published" &&
        Boolean(parts[5]) &&
        Boolean(parts[6]);
}

function isQualificationStoragePath(storagePath) {
    const parts = String(storagePath || "").split("/");

    return parts.length === 7 &&
        parts[0] === "workspaces" &&
        parts[2] === "attachments" &&
        parts[3] === "qualifications" &&
        Boolean(parts[4]) &&
        Boolean(parts[5]) &&
        Boolean(parts[6]);
}

function isMedicalEquipmentStoragePath(storagePath) {
    const parts = String(storagePath || "").split("/");

    return parts.length === 7 &&
        parts[0] === "workspaces" &&
        parts[2] === "attachments" &&
        parts[3] === MEDICAL_EQUIPMENT_ATTACHMENT_MODULE_ID &&
        Boolean(parts[4]) &&
        Boolean(parts[5]) &&
        Boolean(parts[6]);
}

async function uploadInformationAttachment(file, context) {
    const services = await getFirebaseServices();

    await waitForStorageAppCheck(services, "subir");

    const callable = services.functionsModule.httpsCallable(
        services.functions,
        "uploadInformationAttachment"
    );
    const response = await callable({
        workspaceId: context.workspaceId,
        recordId: context.recordId,
        name: String(file.name || ""),
        type: fileContentType(file),
        size: file.size || 0,
        dataUrl: await readFileAsDataURL(file)
    });
    const data = response?.data || {};

    if (!data.storagePath) {
        throw new Error("La subida no devolvio la ruta del archivo.");
    }

    return {
        id: String(data.id || attachmentId("information")),
        name: String(data.name || file.name || "archivo"),
        type: String(data.type || fileContentType(file)).toLowerCase(),
        size: Number(data.size) || file.size || 0,
        addedAt: String(data.addedAt || new Date().toISOString()),
        storagePath: String(data.storagePath || ""),
        downloadURL: String(data.downloadURL || ""),
        uploadedByUid: String(data.uploadedByUid || context.userId)
    };
}

async function uploadMedicalEquipmentAttachment(file, context) {
    const services = await getFirebaseServices();

    await waitForStorageAppCheck(services, "subir");

    const callable = services.functionsModule.httpsCallable(
        services.functions,
        "uploadMedicalEquipmentAttachment"
    );
    const response = await callable({
        workspaceId: context.workspaceId,
        ownerId: context.ownerId,
        recordId: context.recordId,
        name: String(file.name || ""),
        type: fileContentType(file),
        size: file.size || 0,
        dataUrl: await readFileAsDataURL(file)
    });
    const data = response?.data || {};

    if (!data.storagePath) {
        throw new Error("La subida no devolvio la ruta del archivo.");
    }

    return {
        id: String(data.id || attachmentId("medical_equipment")),
        name: String(data.name || file.name || "archivo"),
        type: String(data.type || fileContentType(file)).toLowerCase(),
        size: Number(data.size) || file.size || 0,
        addedAt: String(data.addedAt || new Date().toISOString()),
        storagePath: String(data.storagePath || ""),
        downloadURL: String(data.downloadURL || ""),
        uploadedByUid: String(data.uploadedByUid || context.userId)
    };
}

async function uploadQualificationAttachment(file, context) {
    const services = await getFirebaseServices();

    await waitForStorageAppCheck(services, "subir");

    const callable = services.functionsModule.httpsCallable(
        services.functions,
        "uploadQualificationAttachment"
    );
    const response = await callable({
        workspaceId: context.workspaceId,
        ownerId: context.ownerId,
        recordId: context.recordId,
        name: String(file.name || ""),
        type: fileContentType(file),
        size: file.size || 0,
        dataUrl: await readFileAsDataURL(file)
    });
    const data = response?.data || {};

    if (!data.storagePath) {
        throw new Error("La subida no devolvio la ruta del archivo.");
    }

    return {
        id: String(data.id || attachmentId("qualification")),
        name: String(data.name || file.name || "archivo"),
        type: String(data.type || fileContentType(file)).toLowerCase(),
        size: Number(data.size) || file.size || 0,
        addedAt: String(data.addedAt || new Date().toISOString()),
        storagePath: String(data.storagePath || ""),
        downloadURL: String(data.downloadURL || ""),
        uploadedByUid: String(data.uploadedByUid || context.userId)
    };
}

async function deleteInformationAttachment(attachment) {
    const workspace = getActiveWorkspace();
    const services = await getFirebaseServices();

    await waitForStorageAppCheck(services, "eliminar");

    const callable = services.functionsModule.httpsCallable(
        services.functions,
        "deleteInformationAttachment"
    );

    await callable({
        workspaceId: workspace?.id || "",
        storagePath: String(attachment?.storagePath || "")
    });
}

async function deleteMedicalEquipmentAttachment(attachment) {
    const workspace = getActiveWorkspace();
    const services = await getFirebaseServices();

    await waitForStorageAppCheck(services, "eliminar");

    const callable = services.functionsModule.httpsCallable(
        services.functions,
        "deleteMedicalEquipmentAttachment"
    );

    await callable({
        workspaceId: workspace?.id || "",
        storagePath: String(attachment?.storagePath || "")
    });
}

async function deleteQualificationAttachment(attachment) {
    const workspace = getActiveWorkspace();
    const services = await getFirebaseServices();

    await waitForStorageAppCheck(services, "eliminar");

    const callable = services.functionsModule.httpsCallable(
        services.functions,
        "deleteQualificationAttachment"
    );

    await callable({
        workspaceId: workspace?.id || "",
        storagePath: String(attachment?.storagePath || "")
    });
}

function renderAttachmentTabMessage(openedTab, title, message) {
    if (!openedTab) return;

    try {
        const doc = openedTab.document;

        doc.open();
        doc.write(`
            <!doctype html>
            <html lang="es">
            <head>
                <meta charset="utf-8">
                <title></title>
                <style>
                    body {
                        margin: 0;
                        min-height: 100vh;
                        display: grid;
                        place-items: center;
                        background: #f5f7fb;
                        color: #14233b;
                        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    }
                    main {
                        width: min(460px, calc(100vw - 32px));
                        padding: 28px;
                        border: 1px solid #d9e1ef;
                        border-radius: 10px;
                        background: #fff;
                        box-shadow: 0 18px 55px rgba(22, 37, 62, 0.14);
                    }
                    strong {
                        display: block;
                        margin-bottom: 10px;
                        font-size: 20px;
                    }
                    p {
                        margin: 0;
                        color: #596a85;
                        line-height: 1.5;
                    }
                </style>
            </head>
            <body>
                <main>
                    <strong></strong>
                    <p></p>
                </main>
            </body>
            </html>
        `);
        doc.close();
        doc.title = title;
        doc.querySelector("strong").textContent = title;
        doc.querySelector("p").textContent = message;
    } catch {
        // Si el navegador bloquea esta escritura, el modal principal informa.
    }
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
    // Gate de plan: adjuntar archivos requiere plan de pago. Si aun no hay datos
    // de uso, no bloquea (evita castigar a cuentas pagas por cache frio) y
    // refresca en segundo plano para la proxima vez.
    if (!getCachedAccountUsage()) {
        void refreshAccountUsage();
    } else if (!canUseAttachments()) {
        const planError = new Error(
            "Adjuntar archivos no esta disponible en tu plan. " +
            "Mejora tu plan desde el boton de Planes en la barra superior."
        );
        planError.planBlocked = true;
        throw planError;
    }

    if (!(file instanceof File)) {
        throw new Error("El archivo adjunto no es valido.");
    }

    if (file.size <= 0 || file.size > MAX_ATTACHMENT_SIZE) {
        throw new Error("Cada adjunto debe pesar entre 1 byte y 10 MB.");
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

// Valida un adjunto de mensajeria: imagen o PDF, hasta 10 MB.
export function validateMessageAttachment(file) {
    validateAttachmentFile(file);

    if (!MESSAGE_ATTACHMENT_EXTENSIONS.has(fileExtension(file.name))) {
        throw new Error(
            "En los mensajes solo puedes adjuntar imágenes o archivos PDF."
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
        throw new Error(
            `El total de adjuntos no puede superar ${MAX_ATTACHMENT_FILES * 10} MB.`
        );
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

        if (isPublishedInformationContext(context)) {
            try {
                attachments.push(
                    await uploadInformationAttachment(file, context)
                );
            } catch (error) {
                throw attachmentStorageError(error, "subir");
            }
            continue;
        }

        if (isMedicalEquipmentContext(context)) {
            try {
                attachments.push(
                    await uploadMedicalEquipmentAttachment(file, context)
                );
            } catch (error) {
                throw attachmentStorageError(error, "subir");
            }
            continue;
        }

        if (isQualificationContext(context)) {
            try {
                attachments.push(
                    await uploadQualificationAttachment(file, context)
                );
            } catch (error) {
                throw attachmentStorageError(error, "subir");
            }
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
            await getStorageServices("subir");
        const storageRef = storageModule.ref(storage, storagePath);
        let downloadURL = "";

        try {
            await storageModule.uploadBytes(
                storageRef,
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

            if (context.moduleId === "messages") {
                downloadURL = await storageModule.getDownloadURL(storageRef);
            }
        } catch (error) {
            throw attachmentStorageError(error, "subir");
        }

        const attachment = {
            id,
            name: file.name,
            type: fileContentType(file),
            size: file.size || 0,
            addedAt: new Date().toISOString(),
            storagePath,
            uploadedByUid: context.userId
        };

        if (downloadURL) {
            attachment.downloadURL = downloadURL;
        }

        attachments.push(attachment);
    }

    return attachments;
}

export async function readAttachmentFile(file, options = {}) {
    if (!file) return null;

    return (await readAttachmentFiles([file], options))[0] || null;
}

export function hasAttachmentContent(attachment) {
    return Boolean(
        attachment?.dataUrl ||
        attachment?.storagePath ||
        attachment?.downloadURL
    );
}

async function storedAttachmentDownloadURL(attachment) {
    if (attachment?.downloadURL) return String(attachment.downloadURL);
    if (!attachment?.storagePath) return "";

    const { storage, storageModule } = await getStorageServices("abrir");

    try {
        return await storageModule.getDownloadURL(
            storageModule.ref(storage, attachment.storagePath)
        );
    } catch (error) {
        throw attachmentStorageError(error, "abrir");
    }
}

export async function openAttachmentFile(
    attachment,
    { newTab = false } = {}
) {
    if (!hasAttachmentContent(attachment)) {
        throw new Error("Este adjunto no tiene contenido disponible.");
    }

    const shouldPreview = newTab && canPreviewAttachment(attachment);
    const openedTab = shouldPreview
        ? window.open("about:blank", "_blank")
        : null;

    if (shouldPreview && !openedTab) {
        throw new Error(
            "El navegador bloqueo la ventana emergente."
        );
    }

    if (openedTab) {
        openedTab.opener = null;
        renderAttachmentTabMessage(
            openedTab,
            "Abriendo archivo",
            "TurnoPlus esta preparando el adjunto."
        );
    }

    // Para adjuntos en Storage se abre la URL de descarga (getDownloadURL) por
    // NAVEGACION, no descargando el binario con getBlob. getBlob hace un fetch
    // directo del contenido que exige CORS del bucket (y dispara un preflight por
    // la cabecera de App Check); cuando eso falla, el SDK reintenta ~2 min y
    // termina en storage/retry-limit-exceeded ("no se pudo abrir"). La URL con
    // token se sirve por navegacion, sin CORS ni fetch del binario.
    // Los adjuntos antiguos (solo dataUrl local) siguen usando un object URL.
    const usesObjectUrl = !attachment.storagePath && !attachment.downloadURL;
    let url = "";

    try {
        url = attachment.storagePath || attachment.downloadURL
            ? await storedAttachmentDownloadURL(attachment)
            : URL.createObjectURL(dataUrlToBlob(attachment.dataUrl));
    } catch (error) {
        renderAttachmentTabMessage(
            openedTab,
            "No se pudo abrir",
            attachmentStorageErrorMessage(error, "abrir")
        );
        throw error;
    }

    if (shouldPreview) {
        openedTab.location.replace(url);
    } else {
        const link = window.document.createElement("a");

        link.href = url;
        // La URL de Storage es de otro origen: el atributo download se ignora, asi
        // que se abre en una pestana nueva (sin sacar al usuario de TurnoPlus). El
        // object URL local si respeta la descarga con el nombre original.
        if (usesObjectUrl) {
            link.download = attachment.name || "archivo";
        } else {
            link.target = "_blank";
        }
        link.rel = "noopener";
        link.click();
    }

    if (usesObjectUrl) {
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
}

export async function deleteStoredAttachment(attachment) {
    if (!attachment?.storagePath) return;

    if (isPublishedInformationStoragePath(attachment.storagePath)) {
        try {
            await deleteInformationAttachment(attachment);
        } catch (error) {
            throw attachmentStorageError(error, "eliminar");
        }
        return;
    }

    if (isMedicalEquipmentStoragePath(attachment.storagePath)) {
        try {
            await deleteMedicalEquipmentAttachment(attachment);
        } catch (error) {
            throw attachmentStorageError(error, "eliminar");
        }
        return;
    }

    if (isQualificationStoragePath(attachment.storagePath)) {
        try {
            await deleteQualificationAttachment(attachment);
        } catch (error) {
            throw attachmentStorageError(error, "eliminar");
        }
        return;
    }

    const { storage, storageModule } = await getStorageServices("eliminar");

    try {
        await storageModule.deleteObject(
            storageModule.ref(storage, attachment.storagePath)
        );
    } catch (error) {
        throw attachmentStorageError(error, "eliminar");
    }
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
