// La copia local de los adjuntos (js/attachmentCache.js).
//
// Las reglas las fijo el usuario el 2026-09-14: 2 GB por computador, se borra
// lo que no se abre en 120 dias, y se vacia si entra otra cuenta. Aca se prueban
// las cuentas; lo que depende del navegador (Cache Storage, CORS, blob:) se
// verifica por fuente.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) { this.values.set(key, String(value)); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost" }
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, dataset: {}, appendChild() {} })
};

const cache = await import("../js/attachmentCache.js");

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const GB = 1024 * 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 14, 12);

/* =========================================================
   Las reglas
========================================================= */

test("tope de 2 GB y 120 dias sin abrir", () => {
    assert.equal(cache.ATTACHMENT_CACHE_MAX_BYTES, 2 * GB);
    assert.equal(cache.ATTACHMENT_CACHE_MAX_IDLE_DAYS, 120);
});

test("lo que no se abre en 120 dias se borra; justo 120 todavia no", () => {
    const { remove } = cache.planCacheCleanup([
        { key: "viejo", size: 100, lastAccess: NOW - 121 * DAY },
        { key: "limite", size: 100, lastAccess: NOW - 120 * DAY },
        { key: "nuevo", size: 100, lastAccess: NOW - DAY }
    ], { now: NOW });

    assert.deepEqual(remove, ["viejo"]);
});

test("al pasarse del tope se borra lo abierto hace mas tiempo, no lo mas grande", () => {
    const { remove, bytes } = cache.planCacheCleanup([
        { key: "reciente-grande", size: 1.2 * GB, lastAccess: NOW - DAY },
        { key: "antiguo-chico", size: 0.3 * GB, lastAccess: NOW - 40 * DAY },
        { key: "medio", size: 0.8 * GB, lastAccess: NOW - 10 * DAY }
    ], { now: NOW });

    // 2,3 GB: se va el mas antiguo (0,3) y alcanza.
    assert.deepEqual(remove, ["antiguo-chico"]);
    assert.ok(bytes <= 2 * GB);
});

test("bajo el tope y sin vencidos no se borra nada", () => {
    const { remove, bytes } = cache.planCacheCleanup([
        { key: "a", size: 500, lastAccess: NOW },
        { key: "b", size: 700, lastAccess: NOW - 30 * DAY }
    ], { now: NOW });

    assert.deepEqual(remove, []);
    assert.equal(bytes, 1200);
});

test("un indice roto no revienta la limpieza", () => {
    const { remove } = cache.planCacheCleanup([
        { key: "sin-datos" },
        { key: "texto", size: "abc", lastAccess: "x" }
    ], { now: NOW });

    // Sin fecha de uso no hay como saber si sirve: se trata como vencido.
    assert.deepEqual(remove.sort(), ["sin-datos", "texto"]);
});

/* =========================================================
   Identidad y tipos
========================================================= */

test("la copia se identifica por la ruta en Storage, que no cambia", () => {
    assert.equal(
        cache.attachmentCacheKey({ storagePath: "workspaces/w/attachments/memos/m1/d1", downloadURL: "https://x/y?token=1" }),
        "path:workspaces/w/attachments/memos/m1/d1"
    );
    // Sin ruta, la URL sin el token (el token puede rotar).
    assert.equal(
        cache.attachmentCacheKey({ downloadURL: "https://firebasestorage.googleapis.com/v0/b/b/o/a.pdf?alt=media&token=abc" }),
        "url:https://firebasestorage.googleapis.com/v0/b/b/o/a.pdf"
    );
    // Un adjunto viejo guardado entero en el dato ya esta en el computador.
    assert.equal(cache.attachmentCacheKey({ dataUrl: "data:application/pdf;base64,AA" }), "");
});

test("solo PDF, imagenes y texto conservan su tipo; el resto no se muestra", () => {
    // Un blob: vive en el origen del sitio: un SVG o un HTML podria ejecutar
    // codigo con la sesion del supervisor.
    assert.equal(cache.safeCachedType("application/pdf"), "application/pdf");
    assert.equal(cache.safeCachedType("image/jpg"), "image/jpeg");
    assert.equal(cache.safeCachedType("IMAGE/PNG; charset=binary"), "image/png");
    assert.equal(cache.safeCachedType("image/svg+xml"), "application/octet-stream");
    assert.equal(cache.safeCachedType("text/html"), "application/octet-stream");
    assert.equal(cache.safeCachedType(""), "application/octet-stream");
});

test("sin Cache Storage se muestra igual, como antes", async () => {
    // Node no tiene caches: es el mismo camino que un navegador sin soporte.
    const url = await cache.cachedAttachmentURL({
        id: "viejo",
        name: "viejo.pdf",
        dataUrl: "data:application/pdf;base64,AA"
    });

    assert.equal(url, "data:application/pdf;base64,AA");
});

/* =========================================================
   Lo que tiene que acompañar a la copia
========================================================= */

test("el service worker no borra la copia al activar un deploy nuevo", async () => {
    const sw = await read("../sw.js");

    assert.match(sw, /key !== CACHE && !key\.startsWith\("turnoplus-adjuntos"\)/);
    assert.equal(cache.ATTACHMENT_CACHE_NAME.startsWith("turnoplus-adjuntos"), true);
});

/* =========================================================
   Los menus que usan la copia
========================================================= */

const MENUS = {
    memorandum: "../js/memos.js",
    equipos: "../js/medicalEquipment.js",
    informaciones: "../js/informations.js",
    licencias: "../js/leaveAttachments.js"
};

test("Memorandum, Equipos, Informaciones y Licencias abren desde la copia", async () => {
    for (const [menu, path] of Object.entries(MENUS)) {
        const source = await read(path);

        assert.match(source, /openCachedAttachment\(/, menu);
        // Ni un camino que siga bajando de Storage cada vez.
        assert.doesNotMatch(source, /openAttachmentFile\(/, menu);
        assert.doesNotMatch(source, /resolveAttachmentURL\(/, menu);
    }

    assert.match(await read(MENUS.informaciones), /await openCachedAttachment\(attachment, \{ newTab \}\)/);
    assert.match(await read(MENUS.licencias), /return openCachedAttachment\(attachment, \{ newTab: true \}\)/);
});

test("al eliminar un adjunto se borra tambien su copia, en los cuatro menus", async () => {
    assert.match(await read(MENUS.memorandum), /void forgetCachedAttachment\(document\);/);
    assert.match(await read(MENUS.equipos), /await deleteStoredAttachment\(file\);\n\s*void forgetCachedAttachment\(file\);/);
    assert.match(await read(MENUS.licencias), /void forgetCachedAttachment\(attachment\);/);

    const informaciones = await read(MENUS.informaciones);

    assert.match(informaciones, /deleteStoredAttachment\(file\)\.then\(\(\) => forgetCachedAttachment\(file\)\)/);
    assert.match(informaciones, /deleteStoredAttachment\(attachment\)\.then\(\(\) => forgetCachedAttachment\(attachment\)\)/);
});

test("las fotos de una falla ya no se bajan de Storage en cada ficha", async () => {
    const equipos = await read(MENUS.equipos);

    // Antes: <img src="${attr(url)}"> con la downloadURL directo.
    assert.doesNotMatch(equipos, /file\.downloadURL \|\| file\.dataUrl/);
    assert.match(equipos, /data-meq-thumb data-meq-thumb-file=/);
    assert.match(equipos, /const url = await cachedAttachmentURL\(file\);/);
    assert.match(equipos, /void hydrateThumbs\(panel\);/);
    // Se espera cada foto antes de seguir: las URLs en memoria tienen tope.
    assert.match(equipos, /await image\.decode\(\)\.catch\(\(\) => \{\}\);/);
});

test("la impresion del historial usa URLs propias, no las de las miniaturas", async () => {
    const equipos = await read(MENUS.equipos);

    assert.match(equipos, /const \{ blob, remoteUrl \} = await cachedAttachmentBlob\(file\);/);
    assert.match(equipos, /localUrls\.forEach\(url => URL\.revokeObjectURL\(url\)\)/);
});

test("la pestaña se abre dentro del clic, antes de esperar la copia", async () => {
    // Si se abre despues del await, el navegador la bloquea como emergente.
    const source = await read("../js/attachmentCache.js");
    const body = source.slice(source.indexOf("export async function openCachedAttachment"));
    const openAt = body.indexOf('window.open("about:blank", "_blank")');
    const awaitAt = body.indexOf("await cachedAttachmentBlob(attachment)");

    assert.ok(openAt > 0 && awaitAt > 0, "no se encontro el cuerpo esperado");
    assert.ok(openAt < awaitAt, "la pestaña se abre despues de esperar la copia");
});

test("descargar desde la copia conserva el nombre del archivo", async () => {
    const source = await read("../js/attachmentCache.js");

    assert.match(source, /if \(local\) \{\n\s*link\.download = attachment\.name \|\| "archivo";/);
});

test("Actualizar (y tocar el logo) no borra la copia de los adjuntos", async () => {
    // reloadAppToLatestVersion vaciaba TODAS las caches, y el logo la dispara:
    // es lo primero que la gente toca cuando algo se ve raro.
    const main = await read("../js/main.js");

    assert.match(main, /keys\s*\.filter\(key => !key\.startsWith\("turnoplus-adjuntos"\)\)\s*\.map\(key => caches\.delete\(key\)/);
});

test("la CSP deja mostrar el PDF copiado (blob:) en prod y en test", async () => {
    for (const file of ["../firebase.json", "../firebase.test.json"]) {
        const frameSrcs = (await read(file)).match(/frame-src [^;"]*/g) || [];

        assert.ok(frameSrcs.length, `${file} no define frame-src`);
        frameSrcs.forEach(src => assert.match(src, /(\s)blob:(\s|$)/, `${file}: ${src}`));
    }
});

test("si el fetch falla (CORS, cuota) se devuelve la URL de Storage", async () => {
    const source = await read("../js/attachmentCache.js");

    assert.match(source, /if \(!response\.ok\) return \{ blob: null, remoteUrl \};/);
    assert.match(source, /\} catch \{\n\s*return \{ blob: null, remoteUrl \};\n\s*\}/);
    // Y quien pide la URL recibe la de Storage cuando no hubo copia.
    assert.match(source, /return blob && key \? rememberObjectUrl\(key, blob\) : remoteUrl;/);
    assert.match(source, /url = remoteUrl;/);
});

test("otra cuenta en el mismo navegador vacia la copia", async () => {
    const source = await read("../js/attachmentCache.js");

    assert.match(source, /if \(uid && index\.uid && index\.uid !== uid\) \{\n\s*await clearForAnotherAccount\(cache, uid\);/);
});
