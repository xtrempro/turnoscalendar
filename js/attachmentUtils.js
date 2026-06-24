// Helpers compartidos para manejar archivos adjuntos: normalizar metadatos,
// leerlos como data URL y convertir un data URL de vuelta a Blob para abrirlo.
// Estos helpers no dependen del estado de la app (solo de APIs del navegador).

/**
 * Normaliza una lista de File a metadatos de adjunto (sin el contenido).
 * @param {FileList|File[]} files
 * @returns {Array<{id: string, name: string, type: string, size: number, addedAt: string}>}
 */
export function normalizeAttachmentFiles(files) {
    return Array.from(files || []).map(file => ({
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
export async function readAttachmentFiles(files) {
    const list = Array.from(files || []);
    const attachments = [];

    for (const file of list) {
        attachments.push({
            ...normalizeAttachmentFiles([file])[0],
            dataUrl: await readFileAsDataURL(file)
        });
    }

    return attachments;
}

/**
 * Convierte un data URL base64 a un Blob.
 * @param {string} dataUrl
 * @returns {Blob}
 */
export function dataUrlToBlob(dataUrl) {
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
