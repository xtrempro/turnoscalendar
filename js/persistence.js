const LOCAL_DRIVER = "local";
const INTERNAL_KEYS = new Set([
    "proturnos_theme",
    "firebaseActiveWorkspace",
    "proturnos_firebase_client_id",
    "proturnos_appstate_dirty_at",
    "proturnos_state_modules_dirty",
    "shiftMovesAuditMigrationV1",
    // La agenda es local por supervisor (no se sincroniza entre usuarios del
    // mismo entorno): cada uno edita/borra su propia copia.
    "agenda_contacts",
    "agenda_seeded_v1"
]);
const INTERNAL_KEY_PREFIXES = [
    "firebase:",
    "firebase-",
    "kanban_private_",
    "holidaysCache_",
    "proturnos_ui_cache_"
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

function notifyPersistenceChanged(
    keys = [],
    action = "change",
    changes = {}
) {
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
                keys,
                changes
            }
        })
    );
}

// Ejecuta `fn` sin emitir eventos de persistencia (sin sync a Firebase ni
// re-render). Util para correr pruebas aisladas sobre localStorage. Soporta fn
// sincronica o async; siempre restaura el contador.
export async function runWithoutPersistenceEvents(fn) {
    suppressChangeEvents++;

    try {
        return await fn();
    } finally {
        suppressChangeEvents--;
    }
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
        notifyPersistenceChanged([key], "set", {
            [key]: {
                previous: previousValue,
                next: nextValue
            }
        });
    }
}

export function removeKey(key) {
    const store = storage();
    if (!store) return;

    const previousValue = store.getItem(key);
    const hadKey = previousValue !== null;

    store.removeItem(key);

    if (hadKey) {
        notifyPersistenceChanged([key], "remove", {
            [key]: {
                previous: previousValue,
                next: null,
                removed: true
            }
        });
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

// Aplica un conjunto pequeño de claves sin reconstruir el snapshot local.
// `null` representa una eliminación (tombstone remoto).
export function applyLocalPatch(patch = {}, { silent = true } = {}) {
    const store = storage();
    if (!store || !patch || typeof patch !== "object") return [];

    const changedKeys = [];

    if (silent) suppressChangeEvents++;

    try {
        Object.entries(patch).forEach(([key, value]) => {
            if (isInternalKey(key)) return;

            if (value === null || value === undefined) {
                if (store.getItem(key) !== null) {
                    store.removeItem(key);
                    changedKeys.push(key);
                }
                return;
            }

            const nextValue = String(value);
            if (store.getItem(key) === nextValue) return;

            store.setItem(key, nextValue);
            changedKeys.push(key);
        });
    } finally {
        if (silent) suppressChangeEvents--;
    }

    if (!silent && changedKeys.length) {
        notifyPersistenceChanged(changedKeys, "patch");
    }

    return changedKeys;
}

export function moveKey(oldKey, newKey) {
    const value = getRaw(oldKey, null);
    if (value === null) return;

    setRaw(newKey, value);
    removeKey(oldKey);
}
