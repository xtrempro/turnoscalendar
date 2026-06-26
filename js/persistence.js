const LOCAL_DRIVER = "local";
const INTERNAL_KEYS = new Set([
    "proturnos_theme",
    "firebaseActiveWorkspace",
    "proturnos_firebase_client_id",
    "proturnos_appstate_dirty_at",
    "proturnos_state_modules_dirty",
    "shiftMovesAuditMigrationV1"
]);
const INTERNAL_KEY_PREFIXES = [
    "firebase:",
    "firebase-",
    "kanban_private_",
    "holidaysCache_"
];

let activeDriver = LOCAL_DRIVER;
let suppressChangeEvents = 0;

// Persistence boundary: Firebase can later hydrate a cache and keep this API sync.
function storage() {
    if (typeof globalThis === "undefined") return null;
    return globalThis.localStorage || null;
}

function cloneFallback(fallback) {
    if (Array.isArray(fallback)) {
        return [...fallback];
    }

    if (fallback && typeof fallback === "object") {
        return { ...fallback };
    }

    return fallback;
}

function parseJSON(raw, fallback) {
    if (raw === null || raw === undefined) {
        return cloneFallback(fallback);
    }

    try {
        const parsed = JSON.parse(raw);

        return parsed ?? cloneFallback(fallback);
    } catch {
        return cloneFallback(fallback);
    }
}

export function isInternalKey(key) {
    const cleanKey = String(key || "");

    return (
        INTERNAL_KEYS.has(cleanKey) ||
        INTERNAL_KEY_PREFIXES.some(prefix =>
            cleanKey.startsWith(prefix)
        )
    );
}

function notifyPersistenceChanged(keys = [], action = "change") {
    if (
        suppressChangeEvents ||
        typeof window === "undefined" ||
        !keys.length
    ) {
        return;
    }

    window.dispatchEvent(
        new CustomEvent("proturnos:persistenceChanged", {
            detail: {
                action,
                keys
            }
        })
    );
}

export function getRaw(key, fallback = null) {
    const store = storage();
    if (!store) return fallback;

    const value = store.getItem(key);
    return value === null ? fallback : value;
}

export function setRaw(key, value) {
    const store = storage();
    if (!store) return;

    const nextValue = String(value);
    const previousValue = store.getItem(key);

    store.setItem(key, nextValue);

    if (previousValue !== nextValue) {
        notifyPersistenceChanged([key], "set");
    }
}

export function removeKey(key) {
    const store = storage();
    if (!store) return;

    const hadKey = store.getItem(key) !== null;

    store.removeItem(key);

    if (hadKey) {
        notifyPersistenceChanged([key], "remove");
    }
}

export function getJSON(key, fallback = {}) {
    return parseJSON(getRaw(key, null), fallback);
}

export function setJSON(key, value) {
    setRaw(key, JSON.stringify(value));
}

export function getNumber(key, fallback = 0) {
    const raw = getRaw(key, null);
    if (raw === null) return fallback;

    const value = Number(raw);

    return Number.isFinite(value) ? value : fallback;
}

export function listKeys(prefix = "") {
    const store = storage();
    if (!store) return [];

    const keys = [];

    for (let i = 0; i < store.length; i++) {
        const key = store.key(i);

        if (key && (!prefix || key.startsWith(prefix))) {
            keys.push(key);
        }
    }

    return keys;
}

export function exportLocalSnapshot({
    includeInternal = false
} = {}) {
    const store = storage();
    if (!store) return {};

    return listKeys().reduce((snapshot, key) => {
        if (!includeInternal && isInternalKey(key)) {
            return snapshot;
        }

        snapshot[key] = store.getItem(key);
        return snapshot;
    }, {});
}

export function replaceLocalSnapshot(snapshot = {}, {
    includeInternal = false,
    silent = true
} = {}) {
    const store = storage();
    if (!store || !snapshot || typeof snapshot !== "object") return;

    const changedKeys = new Set();
    const snapshotEntries = Object.entries(snapshot)
        .filter(([key, value]) =>
            (includeInternal || !isInternalKey(key)) &&
            value !== null &&
            value !== undefined
        );
    const snapshotKeys = new Set(
        snapshotEntries.map(([key]) => key)
    );

    if (silent) {
        suppressChangeEvents++;
    }

    try {
        listKeys().forEach(key => {
            if (!includeInternal && isInternalKey(key)) return;
            if (snapshotKeys.has(key)) return;

            store.removeItem(key);
            changedKeys.add(key);
        });

        snapshotEntries.forEach(([key, value]) => {
            const nextValue = String(value);

            if (store.getItem(key) !== nextValue) {
                store.setItem(key, nextValue);
                changedKeys.add(key);
            }
        });
    } finally {
        if (silent) {
            suppressChangeEvents--;
        }
    }

    if (!silent && changedKeys.size) {
        notifyPersistenceChanged([...changedKeys], "replace");
    }
}

export function replaceLocalSnapshotSubset(
    snapshot = {},
    belongsToSubset = () => false,
    { silent = true } = {}
) {
    const store = storage();
    if (!store || !snapshot || typeof snapshot !== "object") return;

    const entries = Object.entries(snapshot)
        .filter(([key, value]) =>
            !isInternalKey(key) &&
            belongsToSubset(key) &&
            value !== null &&
            value !== undefined
        );
    const nextKeys = new Set(entries.map(([key]) => key));
    const changedKeys = new Set();

    if (silent) suppressChangeEvents++;

    try {
        listKeys().forEach(key => {
            if (isInternalKey(key) || !belongsToSubset(key)) return;
            if (nextKeys.has(key)) return;

            store.removeItem(key);
            changedKeys.add(key);
        });

        entries.forEach(([key, value]) => {
            const nextValue = String(value);

            if (store.getItem(key) !== nextValue) {
                store.setItem(key, nextValue);
                changedKeys.add(key);
            }
        });
    } finally {
        if (silent) suppressChangeEvents--;
    }

    if (!silent && changedKeys.size) {
        notifyPersistenceChanged([...changedKeys], "replace-subset");
    }
}

export function moveKey(oldKey, newKey) {
    const value = getRaw(oldKey, null);
    if (value === null) return;

    setRaw(newKey, value);
    removeKey(oldKey);
}
