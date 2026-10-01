const AUDIT_LOG_SHARD_COUNT = 4;

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

export function auditLogShardLocation(log = {}) {
    const id = String(log.id || "").trim();
    const createdAt = String(log.createdAt || "").trim();
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(createdAt);

    if (!id || !match) return null;

    const day = match[1];
    const shard = hashString(id) % AUDIT_LOG_SHARD_COUNT;

    return {
        id,
        month: day.slice(0, 7),
        day,
        shard,
        documentId: `${day}_${shard}`
    };
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
