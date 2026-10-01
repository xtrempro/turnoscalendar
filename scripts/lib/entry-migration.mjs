function decodeItemKey(value) {
    try {
        return decodeURIComponent(String(value || ""));
    } catch {
        return String(value || "");
    }
}

function parseJSON(value) {
    if (typeof value !== "string") return null;

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== "object") return value;

    return Object.fromEntries(
        Object.keys(value).sort().map(key => [key, stableValue(value[key])])
    );
}

function listState(data = {}, includeValue = true) {
    const useLegacy = includeValue &&
        Object.prototype.hasOwnProperty.call(data, "value");
    const base = useLegacy ? parseJSON(data.value) : [];

    if (useLegacy && !Array.isArray(base)) return null;

    const records = new Map();
    for (const record of base || []) {
        const id = String(record?.id ?? "").trim();

        if (!id || records.has(id)) return null;
        records.set(id, record);
    }

    const items = data.items && typeof data.items === "object" ? data.items : {};
    const deletedItems = data.deletedItems && typeof data.deletedItems === "object"
        ? data.deletedItems
        : {};

    for (const encodedKey of new Set([
        ...Object.keys(items),
        ...Object.keys(deletedItems)
    ])) {
        const id = decodeItemKey(encodedKey);

        if (deletedItems[encodedKey] === true) {
            records.delete(id);
            continue;
        }
        if (!Object.prototype.hasOwnProperty.call(items, encodedKey)) continue;

        const record = parseJSON(items[encodedKey]);
        const recordId = String(record?.id ?? id).trim();

        if (!record || typeof record !== "object" || !recordId) return null;
        records.set(recordId, record);
    }

    return [...records.entries()]
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([, record]) => stableValue(record));
}

function objectState(data = {}, includeValue = true) {
    const useLegacy = includeValue &&
        Object.prototype.hasOwnProperty.call(data, "value");
    const base = useLegacy ? parseJSON(data.value) : {};

    if (
        useLegacy &&
        (!base || typeof base !== "object" || Array.isArray(base))
    ) {
        return null;
    }

    const result = { ...(base || {}) };
    const items = data.items && typeof data.items === "object" ? data.items : {};
    const deletedItems = data.deletedItems && typeof data.deletedItems === "object"
        ? data.deletedItems
        : {};

    for (const encodedKey of new Set([
        ...Object.keys(items),
        ...Object.keys(deletedItems)
    ])) {
        const key = decodeItemKey(encodedKey);

        if (deletedItems[encodedKey] === true) {
            delete result[key];
            continue;
        }
        if (!Object.prototype.hasOwnProperty.call(items, encodedKey)) continue;

        const value = parseJSON(items[encodedKey]);

        if (value === null && items[encodedKey] !== "null") return null;
        result[key] = value;
    }

    return stableValue(result);
}

export function entryLogicalState(data = {}, includeValue = true) {
    const legacy = parseJSON(data.value);
    const isArray = data.container === "array" || Array.isArray(legacy);

    return isArray
        ? listState(data, includeValue)
        : objectState(data, includeValue);
}

export function assessLegacyValueRemoval(data = {}) {
    if (!Object.prototype.hasOwnProperty.call(data, "value")) {
        return { safe: true, reason: "value ya no existe", before: null, after: null };
    }
    if (!data.items || typeof data.items !== "object") {
        return { safe: false, reason: "no existe items", before: null, after: null };
    }

    const before = entryLogicalState(data, true);
    const after = entryLogicalState(data, false);

    if (before === null || after === null) {
        return {
            safe: false,
            reason: "la estructura no se puede reconstruir de forma segura",
            before,
            after
        };
    }

    const safe = JSON.stringify(before) === JSON.stringify(after);

    return {
        safe,
        reason: safe
            ? "items cubre todo el estado logico"
            : "hay datos que solo viven en value",
        before,
        after
    };
}

export function compactEntryMaps(data = {}) {
    const items = data.items && typeof data.items === "object" ? data.items : {};
    const deletedItems = data.deletedItems && typeof data.deletedItems === "object"
        ? data.deletedItems
        : {};
    const nextItems = {};
    let removedTombstones = 0;
    let removedFalseMarkers = 0;

    Object.entries(items).forEach(([key, value]) => {
        if (deletedItems[key] === true) {
            removedTombstones++;
            return;
        }
        nextItems[key] = value;
    });
    Object.values(deletedItems).forEach(deleted => {
        if (deleted !== true) removedFalseMarkers++;
    });

    return {
        items: nextItems,
        deletedItems: {},
        removedTombstones,
        removedFalseMarkers
    };
}
