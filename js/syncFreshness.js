// Cuando la copia local de un computador no merece que se edite encima.
//
// Pedido del usuario (2026-09-15), el mismo dia en que un navegador con la
// lista de reemplazos vacia publico 1 registro encima de 492: si un computador
// lleva mas de un dia sin traer datos del servidor, o lo que llega del servidor
// discrepa en varios puntos de su copia local, se muestra una barra de carga y
// no se deja editar hasta aplicar la ultima version.
//
// Aqui vive solo el CRITERIO, sin Firebase ni DOM, para poder probarlo. Lo usa
// js/firebaseAppState.js; la barra la dibuja js/syncBanner.js.

import { mergePartialStateEntries } from "./firebasePartialState.js";

export const STALE_SYNC_MS = 24 * 60 * 60 * 1000;
// Clave interna (no viaja a la nube): { [unidad]: ISO del ultimo contacto }.
export const LAST_SERVER_SYNC_KEY = "proturnos_last_server_sync";
// "Varios puntos": basta cualquiera de los tres.
export const DISCREPANCY_MIN_ENTRIES = 30;
export const DISCREPANCY_MIN_KEYS = 8;
// Una clave que el servidor tiene y esta copia no es un hueco, no un detalle:
// dos ya indican una copia a medio cargar.
export const DISCREPANCY_MIN_MISSING_KEYS = 2;

function readMap(readRaw) {
    try {
        const parsed = JSON.parse(readRaw(LAST_SERVER_SYNC_KEY) || "{}");

        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : {};
    } catch {
        return {};
    }
}

export function readLastServerSync(readRaw, workspaceId) {
    if (!workspaceId) return "";

    return String(readMap(readRaw)[workspaceId] || "");
}

export function writeLastServerSync(readRaw, writeRaw, workspaceId, now = Date.now()) {
    if (!workspaceId) return;

    const map = readMap(readRaw);

    map[workspaceId] = new Date(now).toISOString();
    writeRaw(LAST_SERVER_SYNC_KEY, JSON.stringify(map));
}

// Sin registro cuenta como vieja: un computador que nunca trajo datos del
// servidor tampoco sabe si lo que tiene sirve.
export function isSyncStale(lastSyncAt, now = Date.now()) {
    const last = Date.parse(String(lastSyncAt || ""));

    if (!Number.isFinite(last)) return true;

    return now - last > STALE_SYNC_MS;
}

function parse(raw) {
    if (raw === null || raw === undefined) return null;

    try {
        return JSON.parse(raw);
    } catch {
        return undefined;
    }
}

// Forma comparable: listas por id y objetos con sus claves ordenadas. La lista
// que resulta del `value` viejo con los items encima trae los mismos registros
// en otro orden, y eso no es una discrepancia.
function canonical(value) {
    if (Array.isArray(value)) {
        const items = value.map(canonical);
        const byId = value.length && value.every(item =>
            item && typeof item === "object" && !Array.isArray(item) &&
            item.id !== undefined
        );

        return byId
            ? items.sort((a, b) => String(a.id).localeCompare(String(b.id)))
            : items;
    }

    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.keys(value).sort().map(key => [key, canonical(value[key])])
        );
    }

    return value;
}

function isEmptyState(value) {
    return value === null ||
        (Array.isArray(value) && !value.length) ||
        (value && typeof value === "object" && !Object.keys(value).length);
}

/**
 * Cuanto cambiaria la copia local si se aplicaran estas entradas remotas. Se
 * mide por clave y con el resultado ya aplicado: el eco de lo que este mismo
 * computador acaba de subir no cambia nada y no cuenta.
 *
 * @returns {{ entryCount: number, keyCount: number, missingKeys: number }}
 */
export function measureRemoteDiscrepancy(entries = [], readRaw = () => null) {
    const byKey = new Map();

    entries.forEach(entry => {
        if (!entry?.storageKey) return;

        const list = byKey.get(entry.storageKey) || [];

        list.push(entry);
        byKey.set(entry.storageKey, list);
    });

    let entryCount = 0;
    let keyCount = 0;
    let missingKeys = 0;

    byKey.forEach((keyEntries, storageKey) => {
        const localRaw = readRaw(storageKey);
        const hasLocal = localRaw !== null && localRaw !== undefined;
        const next = mergePartialStateEntries(
            hasLocal ? { [storageKey]: localRaw } : {},
            keyEntries
        );
        const nextRaw = Object.prototype.hasOwnProperty.call(next, storageKey)
            ? next[storageKey]
            : null;
        const before = parse(hasLocal ? localRaw : null);
        const after = parse(nextRaw);

        if (
            before !== undefined &&
            after !== undefined &&
            JSON.stringify(canonical(before)) === JSON.stringify(canonical(after))
        ) return;

        // Una clave vacia que no estaba no es un hueco de la copia local.
        if (!hasLocal && after !== undefined && isEmptyState(after)) return;

        keyCount += 1;
        entryCount += keyEntries.length;

        if (!hasLocal) missingKeys += 1;
    });

    return { entryCount, keyCount, missingKeys };
}

export function isRemoteDiscrepant({
    entryCount = 0,
    keyCount = 0,
    missingKeys = 0
} = {}) {
    return entryCount >= DISCREPANCY_MIN_ENTRIES ||
        keyCount >= DISCREPANCY_MIN_KEYS ||
        missingKeys >= DISCREPANCY_MIN_MISSING_KEYS;
}
