export const FIRESTORE_DOCUMENT_LIMIT_BYTES = 1024 * 1024;
export const FIRESTORE_DOCUMENT_WARNING_RATIO = 0.70;
export const FIRESTORE_DOCUMENT_CRITICAL_RATIO = 0.85;

function utf8Bytes(value) {
    const text = String(value ?? "");

    if (typeof TextEncoder !== "undefined") {
        return new TextEncoder().encode(text).length;
    }

    return unescape(encodeURIComponent(text)).length;
}

function isTimestampLike(value) {
    return Boolean(value) && typeof value === "object" && (
        typeof value.toMillis === "function" ||
        (
            Number.isFinite(Number(value.seconds)) &&
            Number.isFinite(Number(value.nanoseconds || 0))
        )
    );
}

export function estimateFirestoreValueBytes(value) {
    if (value === null || value === undefined) return 1;
    if (typeof value === "boolean") return 1;
    if (typeof value === "number" || typeof value === "bigint") return 8;
    if (typeof value === "string") return utf8Bytes(value) + 1;
    if (value instanceof Date || isTimestampLike(value)) return 8;

    if (Array.isArray(value)) {
        return value.reduce(
            (total, item) => total + estimateFirestoreValueBytes(item),
            0
        );
    }

    if (typeof value === "object") {
        return 32 + Object.entries(value).reduce(
            (total, [key, item]) =>
                total + utf8Bytes(key) + 1 + estimateFirestoreValueBytes(item),
            0
        );
    }

    return utf8Bytes(value) + 1;
}

export function estimateFirestoreDocumentBytes(data = {}, documentPath = "") {
    return 32 + utf8Bytes(documentPath) + 1 + Object.entries(data || {}).reduce(
        (total, [key, value]) =>
            total + utf8Bytes(key) + 1 + estimateFirestoreValueBytes(value),
        0
    );
}

export function assessFirestoreDocumentHealth(
    data = {},
    documentPath = "",
    options = {}
) {
    const limitBytes = Math.max(
        1,
        Number(options.limitBytes) || FIRESTORE_DOCUMENT_LIMIT_BYTES
    );
    const warningRatio = Number.isFinite(Number(options.warningRatio))
        ? Number(options.warningRatio)
        : FIRESTORE_DOCUMENT_WARNING_RATIO;
    const criticalRatio = Number.isFinite(Number(options.criticalRatio))
        ? Number(options.criticalRatio)
        : FIRESTORE_DOCUMENT_CRITICAL_RATIO;
    const estimatedBytes = estimateFirestoreDocumentBytes(data, documentPath);
    const ratio = estimatedBytes / limitBytes;
    const level = ratio >= criticalRatio
        ? "critical"
        : ratio >= warningRatio
            ? "warning"
            : "healthy";

    return {
        level,
        estimatedBytes,
        limitBytes,
        ratio,
        percent: Math.round(ratio * 1000) / 10
    };
}
