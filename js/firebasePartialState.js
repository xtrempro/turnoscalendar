const PARTIAL_MAP_PREFIXES = [
    "data_",
    "baseData_",
    "blocked_",
    "admin_",
    "legal_",
    "comp_",
    "absences_",
    "hourReturns_",
    "clockMarks_",
    "shiftAssignmentHistory_",
    "leaveBalances_",
    "hheeReturnTransfers_"
];

function parseObject(raw) {
    if (raw === null || raw === undefined || raw === "") return {};

    try {
        const value = JSON.parse(raw);
        return value && typeof value === "object" && !Array.isArray(value)
            ? value
            : {};
    } catch {
        return {};
    }
}

export function isPartialStateMapKey(key) {
    const value = String(key || "");
    return PARTIAL_MAP_PREFIXES.some(prefix => value.startsWith(prefix));
}

export function encodePartialStateItemKey(itemKey) {
    return encodeURIComponent(String(itemKey || ""))
        .replace(/\./g, "%2E");
}

export function decodePartialStateItemKey(itemKey) {
    try {
        return decodeURIComponent(String(itemKey || ""));
    } catch {
        return String(itemKey || "");
    }
}

export function groupPartialStateEntries(entries = []) {
    const grouped = new Map();

    entries.forEach(entry => {
        const id = `${entry.moduleId}\u001e${entry.storageKey}`;
        const group = grouped.get(id) || {
            moduleId: entry.moduleId,
            storageKey: entry.storageKey,
            items: {},
            deletedItems: {}
        };

        if (entry.itemKey) {
            const itemKey = encodePartialStateItemKey(entry.itemKey);

            group.items[itemKey] = entry.deleted
                ? "null"
                : String(entry.value ?? "");
            group.deletedItems[itemKey] = entry.deleted === true;
        } else {
            group.value = entry.deleted
                ? null
                : String(entry.value ?? "");
            group.deleted = entry.deleted === true;
        }

        grouped.set(id, group);
    });

    return [...grouped.values()];
}

export function planPartialStateEntries({
    keys = [],
    changes = {},
    readRaw = () => null,
    moduleForKey = () => ""
} = {}) {
    const entries = [];

    keys.forEach(storageKey => {
        const change = changes?.[storageKey] || {};
        const previousRaw = Object.prototype.hasOwnProperty.call(change, "previous")
            ? change.previous
            : null;
        const nextRaw = Object.prototype.hasOwnProperty.call(change, "next")
            ? change.next
            : readRaw(storageKey);
        const moduleId = moduleForKey(storageKey);

        if (!moduleId) return;

        if (!isPartialStateMapKey(storageKey)) {
            entries.push({
                moduleId,
                storageKey,
                itemKey: "",
                value: nextRaw,
                deleted: change.removed === true || nextRaw === null
            });
            return;
        }

        const previous = parseObject(previousRaw);
        const next = parseObject(nextRaw);
        const itemKeys = new Set([
            ...Object.keys(previous),
            ...Object.keys(next)
        ]);

        itemKeys.forEach(itemKey => {
            const previousValue = previous[itemKey];
            const nextHasValue = Object.prototype.hasOwnProperty.call(
                next,
                itemKey
            );
            const nextValue = next[itemKey];

            if (
                nextHasValue &&
                JSON.stringify(previousValue) === JSON.stringify(nextValue)
            ) return;

            entries.push({
                moduleId,
                storageKey,
                itemKey,
                value: nextHasValue ? JSON.stringify(nextValue) : null,
                deleted: !nextHasValue
            });
        });
    });

    return entries;
}

export function applyPartialStateEntry(snapshot = {}, entry = {}) {
    const storageKey = String(entry.storageKey || "");
    const itemKey = String(entry.itemKey || "");

    if (!storageKey) return snapshot;

    if (!itemKey) {
        if (entry.deleted) {
            delete snapshot[storageKey];
        } else {
            snapshot[storageKey] = String(entry.value ?? "");
        }
        return snapshot;
    }

    const map = parseObject(snapshot[storageKey]);

    if (entry.deleted) {
        delete map[itemKey];
    } else {
        try {
            map[itemKey] = JSON.parse(String(entry.value ?? "null"));
        } catch {
            map[itemKey] = entry.value;
        }
    }

    snapshot[storageKey] = JSON.stringify(map);
    return snapshot;
}

export function mergePartialStateEntries(snapshot = {}, entries = []) {
    return entries.reduce(
        (result, entry) => applyPartialStateEntry(result, entry),
        snapshot
    );
}
