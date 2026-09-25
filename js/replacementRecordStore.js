const MAX_RECORD_ID_LENGTH = 900;

function cleanRecordId(value) {
    return String(value ?? "").trim();
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== "object") return value;

    return Object.keys(value)
        .sort()
        .reduce((result, key) => {
            result[key] = stableValue(value[key]);
            return result;
        }, {});
}

function recordSignature(record) {
    return JSON.stringify(stableValue(record));
}

export function replacementRecordDocId(recordId) {
    const clean = cleanRecordId(recordId);

    if (!clean) return "";

    const encoded = encodeURIComponent(clean);

    if (encoded.length > MAX_RECORD_ID_LENGTH) {
        throw new Error("El ID del reemplazo excede el limite permitido.");
    }

    return encoded;
}

export function replacementRecordPayload(record, options = {}) {
    const recordId = cleanRecordId(record?.id);

    if (!recordId) {
        throw new Error("Cada reemplazo necesita un ID estable.");
    }

    return {
        recordId,
        record: { ...record },
        deleted: false,
        revision: Math.max(1, Number(options.revision) || 1),
        updatedAtISO:
            String(options.updatedAtISO || "").trim() ||
            new Date().toISOString(),
        clientId: String(options.clientId || "").trim()
    };
}

export function replacementRecordTombstone(recordId, options = {}) {
    const clean = cleanRecordId(recordId);

    if (!clean) {
        throw new Error("El tombstone necesita el ID del reemplazo.");
    }

    return {
        recordId: clean,
        deleted: true,
        revision: Math.max(1, Number(options.revision) || 1),
        updatedAtISO:
            String(options.updatedAtISO || "").trim() ||
            new Date().toISOString(),
        clientId: String(options.clientId || "").trim()
    };
}

export function replacementRecordsFromDocuments(documents = []) {
    const records = new Map();

    documents.forEach(document => {
        const data = document?.data || document || {};
        const recordId = cleanRecordId(data.recordId || data.record?.id);

        if (!recordId || data.deleted === true || !data.record) return;

        records.set(recordId, { ...data.record });
    });

    return [...records.values()];
}

export function diffReplacementRecords(previous = [], next = []) {
    const before = new Map(
        previous.map(record => [cleanRecordId(record?.id), record])
            .filter(([id]) => id)
    );
    const after = new Map(
        next.map(record => [cleanRecordId(record?.id), record])
            .filter(([id]) => id)
    );
    const upserts = [];
    const deletedIds = [];

    after.forEach((record, id) => {
        if (recordSignature(before.get(id)) !== recordSignature(record)) {
            upserts.push(record);
        }
    });

    before.forEach((_record, id) => {
        if (!after.has(id)) deletedIds.push(id);
    });

    return { upserts, deletedIds };
}
