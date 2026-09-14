// Copia local, en cada computador, de los adjuntos que se abren.
//
// Un PDF de resolucion o la foto de un permiso se revisan muchas veces: con el
// zoom, al volver a la lista, al dia siguiente. Sin copia, cada vista le pide
// la URL a Storage y baja el archivo entero. Con copia se baja una sola vez.
//
// Reglas (acordadas con el usuario el 2026-09-14; los computadores de los
// supervisores no son compartidos):
// - Solo se guarda lo que alguien abre, no todo lo que se sube.
// - Tope de 2 GB: al pasarse, se borra lo que hace mas tiempo no se abre.
// - Lo que no se abre en 90 dias se borra solo.
// - Si en el navegador entra OTRA cuenta, la copia se vacia entera.
//
// Lo que necesita fuera de este archivo:
// - CORS en el bucket con los origenes del supervisor (turnoplus.cl y los
//   sitios de Hosting). Sin eso el fetch falla y se muestra desde Storage, como
//   antes, sin copia.
// - blob: en el frame-src de la CSP, para mostrar el PDF copiado.
// - sw.js no borra esta cache al activar una version nueva.

import { getCurrentFirebaseUser } from "./firebaseClient.js";
import { resolveAttachmentURL } from "./attachmentUtils.js";

export const ATTACHMENT_CACHE_PREFIX = "turnoplus-adjuntos";
export const ATTACHMENT_CACHE_NAME = `${ATTACHMENT_CACHE_PREFIX}-v1`;
export const ATTACHMENT_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const ATTACHMENT_CACHE_MAX_IDLE_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;
const INDEX_PATH = "/__turnoplus-adjuntos__/indice.json";
const ENTRY_PATH = "/__turnoplus-adjuntos__/archivo/";
// Copias abiertas en memoria a la vez. El resto sigue en disco y se vuelve a
// leer al pedirlo: sin este limite, revisar 300 fotos en una tarde dejaria
// 300 archivos cargados en la pestaña.
const MAX_OBJECT_URLS = 24;

// Solo estos tipos conservan su tipo real. Un blob: vive en el origen del
// sitio: un SVG o un HTML ahi podria ejecutar codigo, asi que todo lo demas se
// guarda como binario que el navegador no muestra.
const SAFE_TYPES = new Set([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "text/plain",
    "text/csv"
]);

export function safeCachedType(type) {
    const clean = String(type || "").toLowerCase().split(";")[0].trim();
    const normalized = clean === "image/jpg" || clean === "image/pjpeg"
        ? "image/jpeg"
        : clean;

    return SAFE_TYPES.has(normalized)
        ? normalized
        : "application/octet-stream";
}

/**
 * Identidad estable de un adjunto. La ruta en Storage no cambia nunca (cada
 * subida crea un archivo nuevo); la URL de descarga si puede cambiar de token,
 * por eso se toma sin la query. Los adjuntos viejos guardados enteros en el
 * dato (dataUrl) no tienen clave: ya estan en el computador.
 *
 * @param {Object} attachment
 * @returns {string}
 */
export function attachmentCacheKey(attachment) {
    const storagePath = String(attachment?.storagePath || "").trim();

    if (storagePath) return `path:${storagePath}`;

    const downloadURL = String(attachment?.downloadURL || "").trim();

    return downloadURL ? `url:${downloadURL.split("?")[0]}` : "";
}

/**
 * Que borrar para cumplir las reglas: primero lo vencido (sin abrir en
 * maxIdleDays) y despues, si aun se pasa del tope, lo abierto hace mas tiempo.
 *
 * @param {Array<{key: string, size: number, lastAccess: number}>} entries
 * @param {{now?: number, maxBytes?: number, maxIdleDays?: number}} options
 * @returns {{remove: string[], bytes: number}} lo que se borra y lo que queda
 */
export function planCacheCleanup(entries, {
    now = Date.now(),
    maxBytes = ATTACHMENT_CACHE_MAX_BYTES,
    maxIdleDays = ATTACHMENT_CACHE_MAX_IDLE_DAYS
} = {}) {
    const remove = [];
    const alive = [];

    (entries || []).forEach(entry => {
        const lastAccess = Number(entry.lastAccess) || 0;

        if (now - lastAccess > maxIdleDays * DAY_MS) {
            remove.push(entry.key);
            return;
        }

        alive.push({
            key: entry.key,
            size: Math.max(0, Number(entry.size) || 0),
            lastAccess
        });
    });

    let bytes = alive.reduce((total, entry) => total + entry.size, 0);

    alive
        .sort((a, b) => a.lastAccess - b.lastAccess)
        .forEach(entry => {
            if (bytes <= maxBytes) return;

            remove.push(entry.key);
            bytes -= entry.size;
        });

    return { remove, bytes };
}

/* =========================================================
   Cache del navegador
========================================================= */

let cachePromise = null;
// { uid, entries: { [key]: { size, lastAccess, storedAt, type, name } } }
let index = null;
const removedKeys = new Set();
const objectUrls = new Map();
let saveTimer = 0;
let cleanedThisSession = false;

function cacheSupported() {
    return typeof caches !== "undefined" &&
        typeof fetch === "function" &&
        typeof Response === "function" &&
        typeof URL?.createObjectURL === "function";
}

function entryPath(key) {
    return `${ENTRY_PATH}${encodeURIComponent(key)}`;
}

function jsonResponse(data) {
    return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" }
    });
}

function openCache() {
    if (!cachePromise) {
        cachePromise = caches.open(ATTACHMENT_CACHE_NAME).catch(error => {
            cachePromise = null;
            throw error;
        });
    }

    return cachePromise;
}

async function readStoredIndex(cache) {
    try {
        const response = await cache.match(INDEX_PATH);
        const data = response ? await response.json() : null;

        return {
            uid: String(data?.uid || ""),
            entries: data?.entries && typeof data.entries === "object"
                ? data.entries
                : {}
        };
    } catch {
        return { uid: "", entries: {} };
    }
}

// Otra pestaña pudo guardar archivos mientras tanto: antes de escribir se
// mezcla con el indice en disco, para que ninguna copia quede sin contar en el
// tope.
async function saveIndex() {
    if (!index) return;

    const cache = await openCache();
    const stored = await readStoredIndex(cache);
    const entries = { ...stored.entries };

    Object.entries(index.entries).forEach(([key, entry]) => {
        const other = entries[key];

        if (!other || (Number(entry.lastAccess) || 0) >= (Number(other.lastAccess) || 0)) {
            entries[key] = entry;
        }
    });
    removedKeys.forEach(key => { delete entries[key]; });

    index = { uid: index.uid || stored.uid, entries };
    await cache.put(INDEX_PATH, jsonResponse(index));
}

function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveIndex().catch(() => {});
    }, 800);
}

function touch(key) {
    const entry = index?.entries?.[key];

    if (!entry) return;

    entry.lastAccess = Date.now();
    scheduleSave();
}

function forgetObjectUrl(key) {
    const url = objectUrls.get(key);

    if (url) URL.revokeObjectURL(url);
    objectUrls.delete(key);
}

function rememberObjectUrl(key, blob) {
    forgetObjectUrl(key);

    const url = URL.createObjectURL(blob);

    objectUrls.set(key, url);

    while (objectUrls.size > MAX_OBJECT_URLS) {
        forgetObjectUrl(objectUrls.keys().next().value);
    }

    return url;
}

async function removeEntries(cache, keys) {
    for (const key of keys) {
        await cache.delete(entryPath(key)).catch(() => false);
        delete index.entries[key];
        removedKeys.add(key);
        forgetObjectUrl(key);
    }
}

async function clearForAnotherAccount(cache, uid) {
    const requests = await cache.keys();

    await Promise.all(requests.map(request => cache.delete(request)));
    objectUrls.forEach(url => URL.revokeObjectURL(url));
    objectUrls.clear();
    removedKeys.clear();
    index = { uid, entries: {} };
    await cache.put(INDEX_PATH, jsonResponse(index));
}

async function cleanup(cache) {
    const { remove } = planCacheCleanup(
        Object.entries(index.entries).map(([key, entry]) => ({ key, ...entry }))
    );

    if (remove.length) {
        await removeEntries(cache, remove);
        scheduleSave();
    }

    // Copias en disco que no figuran en el indice (una pestaña se cerro a
    // mitad de guardar): no cuentan para el tope, asi que se borran.
    const requests = await cache.keys();

    for (const request of requests) {
        const path = new URL(request.url).pathname;

        if (!path.startsWith(ENTRY_PATH)) continue;

        const key = decodeURIComponent(path.slice(ENTRY_PATH.length));

        if (!index.entries[key]) await cache.delete(request);
    }
}

async function prepare() {
    const cache = await openCache();

    if (!index) index = await readStoredIndex(cache);

    const uid = String(getCurrentFirebaseUser()?.uid || "");

    if (uid && index.uid && index.uid !== uid) {
        await clearForAnotherAccount(cache, uid);
    } else if (uid && !index.uid) {
        index.uid = uid;
        scheduleSave();
    }

    if (!cleanedThisSession) {
        cleanedThisSession = true;
        await cleanup(cache);
    }

    return cache;
}

/**
 * URL para mostrar un adjunto en la pagina, desde la copia del computador.
 *
 * Si ya esta copiado, no se toca la red. Si no, se baja una vez de Storage, se
 * guarda y se devuelve la copia. Si el navegador no deja copiarlo (sin Cache
 * Storage, CORS del bucket, cuota llena, modo incognito), devuelve la URL de
 * Storage igual que antes: la vista nunca se queda sin documento por la copia.
 *
 * @param {Object} attachment
 * @returns {Promise<string>}
 */
export async function cachedAttachmentURL(attachment) {
    if (!attachment) return "";

    const key = attachmentCacheKey(attachment);

    if (!key || !cacheSupported()) return resolveAttachmentURL(attachment);

    let cache = null;

    try {
        cache = await prepare();

        if (index.entries[key] && objectUrls.has(key)) {
            const url = objectUrls.get(key);

            // Queda como la mas reciente de las abiertas en memoria.
            objectUrls.delete(key);
            objectUrls.set(key, url);
            touch(key);

            return url;
        }

        if (index.entries[key]) {
            const hit = await cache.match(entryPath(key));

            if (hit) {
                const blob = await hit.blob();

                touch(key);

                return rememberObjectUrl(key, blob);
            }

            delete index.entries[key];
        }
    } catch {
        cache = null;
    }

    const remoteUrl = await resolveAttachmentURL(attachment);

    if (!cache) return remoteUrl;

    try {
        const response = await fetch(remoteUrl, {
            mode: "cors",
            credentials: "omit"
        });

        if (!response.ok) return remoteUrl;

        const raw = await response.blob();
        const blob = new Blob([raw], {
            type: safeCachedType(raw.type || attachment.type)
        });

        if (!blob.size || blob.size > ATTACHMENT_CACHE_MAX_BYTES) return remoteUrl;

        await cache.put(entryPath(key), new Response(blob, {
            headers: { "Content-Type": blob.type }
        }));

        const now = Date.now();

        removedKeys.delete(key);
        index.entries[key] = {
            size: blob.size,
            lastAccess: now,
            storedAt: now,
            type: blob.type,
            name: String(attachment.name || "")
        };

        const { remove } = planCacheCleanup(
            Object.entries(index.entries).map(([entryKey, entry]) => ({ key: entryKey, ...entry }))
        );

        if (remove.length) {
            await removeEntries(cache, remove.filter(item => item !== key));
        }

        scheduleSave();

        return rememberObjectUrl(key, blob);
    } catch {
        return remoteUrl;
    }
}

/**
 * Borra la copia de un adjunto que se elimino: el archivo ya no existe en
 * Storage y la copia solo ocuparia espacio.
 *
 * @param {Object} attachment
 */
export async function forgetCachedAttachment(attachment) {
    const key = attachmentCacheKey(attachment);

    if (!key || !cacheSupported()) return;

    try {
        const cache = await openCache();

        if (!index) index = await readStoredIndex(cache);

        await removeEntries(cache, [key]);
        scheduleSave();
    } catch {
        // Si no se pudo, la limpieza de 90 dias o el tope se hacen cargo.
    }
}

/**
 * Cuanto hay copiado en este computador.
 *
 * @returns {Promise<{supported: boolean, files: number, bytes: number}>}
 */
export async function attachmentCacheStats() {
    if (!cacheSupported()) return { supported: false, files: 0, bytes: 0 };

    const cache = await openCache();

    if (!index) index = await readStoredIndex(cache);

    const entries = Object.values(index.entries);

    return {
        supported: true,
        files: entries.length,
        bytes: entries.reduce((total, entry) => total + (Number(entry.size) || 0), 0)
    };
}
