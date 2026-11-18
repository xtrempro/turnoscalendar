// Anular un evento es definitivo para ESE id. Aplicar otro permiso crea otro
// evento; una copia atrasada nunca debe quitar la anulacion del anterior.
export function preserveAuditLogCancellation(next, current) {
    if (!current?.canceledAt || !next || String(next.id) !== String(current.id)) return next;
    if (next.canceledAt && Date.parse(next.canceledAt) > Date.parse(current.canceledAt)) return next;
    return {
        ...next,
        ...Object.fromEntries(["canceledAt", "canceledBy", "cancellationDetails"]
            .filter(key => Object.hasOwn(current, key)).map(key => [key, current[key]]))
    };
}

export function guardAuditLogCancellations(entry, current = {}) {
    if (entry.storageKey !== "auditLog" || !entry.items) return entry;
    const legacy = current.deleted !== true && current.value
        ? JSON.parse(current.value) : [];
    const byId = new Map((Array.isArray(legacy) ? legacy : []).map(log => [String(log.id), log]));
    const items = { ...entry.items };
    for (const [key, raw] of Object.entries(items)) {
        if (entry.deletedItems?.[key] === true) continue; // La poda sigue permitida.
        const log = JSON.parse(raw);
        const existing = current.deletedItems?.[key] === true ? null
            : Object.hasOwn(current.items || {}, key)
                ? JSON.parse(current.items[key]) : byId.get(String(log?.id));
        items[key] = JSON.stringify(preserveAuditLogCancellation(log, existing));
    }
    return { ...entry, items };
}
