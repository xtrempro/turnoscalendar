export const AUDIT_LOG_SHARD_COUNT = 4;

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== "object") return value;

    return Object.fromEntries(
        Object.keys(value).sort().map(key => [key, stableValue(value[key])])
    );
}

function signature(value) {
    return JSON.stringify(stableValue(value));
}

function hashString(value) {
    let hash = 2166136261;

    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
}

function utcDay(value) {
    const timestamp = Date.parse(String(value || ""));

    if (!Number.isFinite(timestamp)) return "";

    return new Date(timestamp).toISOString().slice(0, 10);
}

export function auditLogTimestampFromId(logId) {
    const match = /^(\d{13})(?:_|$)/.exec(String(logId || "").trim());
    const timestamp = Number(match?.[1] || NaN);

    if (!Number.isSafeInteger(timestamp)) return "";

    const date = new Date(timestamp);

    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function auditLogUtcMonth(value) {
    return utcDay(value).slice(0, 7);
}

export function auditLogShardLocation(log = {}) {
    const id = String(log.id || "").trim();
    const day = utcDay(log.createdAt);

    if (!id || !day) return null;

    const shard = hashString(id) % AUDIT_LOG_SHARD_COUNT;

    return {
        id,
        month: day.slice(0, 7),
        day,
        shard,
        documentId: `${day}_${shard}`
    };
}

export function auditLogShardLocationFromId(logId, createdAt = "") {
    const id = String(logId || "").trim();
    const inferredCreatedAt = createdAt || auditLogTimestampFromId(id);

    return auditLogShardLocation({ id, createdAt: inferredCreatedAt });
}

export function diffAuditLogShardUpserts(previous = [], next = []) {
    const before = new Map(
        (Array.isArray(previous) ? previous : [])
            .map(log => [String(log?.id || "").trim(), log])
            .filter(([id]) => id)
    );

    return (Array.isArray(next) ? next : []).filter(log => {
        const id = String(log?.id || "").trim();

        return id &&
            auditLogShardLocation(log) &&
            signature(before.get(id)) !== signature(log);
    });
}

export function groupAuditLogsByShard(logs = []) {
    const groups = new Map();

    logs.forEach(log => {
        const location = auditLogShardLocation(log);

        if (!location) return;

        const group = groups.get(location.documentId) || {
            ...location,
            logs: []
        };
        group.logs.push({ ...log });
        groups.set(location.documentId, group);
    });

    return [...groups.values()].sort((a, b) =>
        a.documentId.localeCompare(b.documentId)
    );
}

export function auditLogsFromShardDocuments(documents = []) {
    const logs = new Map();

    documents.forEach(document => {
        const data = document?.data || document || {};

        Object.values(data.items || {}).forEach(raw => {
            let log = raw;

            if (typeof raw === "string") {
                try {
                    log = JSON.parse(raw);
                } catch {
                    return;
                }
            }

            const id = String(log?.id || "").trim();
            if (id) logs.set(id, log);
        });
    });

    return [...logs.values()].sort((a, b) =>
        String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
    );
}
