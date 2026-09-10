// Respaldo documental de una licencia medica.
//
// Lo que se quiere evitar es lo que pasaba en los registros del perfil: el
// archivo se "adjuntaba" pero solo quedaba su nombre, y despues no habia nada
// que abrir. Aca cada adjunto guarda su storagePath, y sin storagePath ni
// dataUrl la lista lo descarta: un adjunto que no se puede abrir no cuenta como
// adjunto.
import test from "node:test";
import assert from "node:assert/strict";
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
    querySelector: () => null,
    querySelectorAll: () => []
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const {
    LEAVE_ATTACHMENT_ACCEPT,
    getLeaveAttachments,
    hasLeaveAttachments,
    leaveTypeNeedsDocument
} = await import("../js/leaveAttachments.js");

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const leaveModule = await read("../js/leaveAttachments.js");
const calendar = await read("../js/calendar.js");
const main = await read("../js/main.js");
const audit = await read("../js/auditLog.js");
const rules = await read("../storage.rules");
const modules = await read("../js/firebaseStateModules.js");

const PROFILE = "ALAN RUFINO PLAZA MARTINEZ";
const LOG_ID = "log_123";

function guardar(lista) {
    localStorage.clear();
    localStorage.setItem(
        "leaveAttachments",
        JSON.stringify({ [`${PROFILE}|${LOG_ID}`]: lista })
    );
}

/* =========================================================
   Que licencias llevan documento
========================================================= */

test("solo las licencias medicas piden respaldo", () => {
    assert.equal(leaveTypeNeedsDocument("license"), true);
    assert.equal(leaveTypeNeedsDocument("professional_license"), true);
    // Un administrativo o un feriado legal no tienen documento que adjuntar.
    ["admin", "legal", "comp", "union_leave", "unpaid_leave", ""]
        .forEach(type => {
            assert.equal(leaveTypeNeedsDocument(type), false, type);
        });
});

test("solo se aceptan imagenes y PDF", () => {
    assert.equal(
        LEAVE_ATTACHMENT_ACCEPT,
        ".png,.jpg,.jpeg,.gif,.webp,.bmp,.heic,.heif,.pdf"
    );
    assert.match(leaveModule, /export function validateLeaveAttachment\(file\)/);
    // Se apoya en la validacion general, que ya trae el limite de 10 MB.
    assert.match(
        leaveModule,
        /function validateLeaveAttachment\(file\) \{\s*\n\s*validateAttachmentFile\(file\);/
    );
});

/* =========================================================
   Que el adjunto quede recuperable
========================================================= */

test("un adjunto sin contenido NO cuenta como adjunto", () => {
    // Es exactamente el bug del perfil: quedaba el nombre y nada mas. Si no se
    // puede abrir, no sirve de respaldo.
    guardar([{ id: "a", name: "licencia.pdf" }]);

    assert.deepEqual(getLeaveAttachments(PROFILE, LOG_ID), []);
    assert.equal(hasLeaveAttachments(PROFILE, LOG_ID), false);
});

test("un adjunto con storagePath si cuenta", () => {
    guardar([{
        id: "a",
        name: "licencia.pdf",
        storagePath: "workspaces/x/attachments/leaves/ALAN/log_123/a_licencia.pdf"
    }]);

    assert.equal(getLeaveAttachments(PROFILE, LOG_ID).length, 1);
    assert.equal(hasLeaveAttachments(PROFILE, LOG_ID), true);
});

test("subir exige que el archivo haya quedado guardado", () => {
    // Si readAttachmentFile no devuelve ruta ni contenido, se avisa en vez de
    // guardar una referencia vacia.
    assert.match(
        leaveModule,
        /if \(!attachment\?\.storagePath && !attachment\?\.dataUrl\) \{[\s\S]{0,120}throw new Error/
    );
});

test("el adjunto se guarda bajo el trabajador y su registro del LOG", () => {
    // El logId es el mismo que usa "Anular permiso": asi el documento pertenece
    // a esa aplicacion concreta y no a una fecha suelta.
    assert.match(
        leaveModule,
        /moduleId: "leaves",\s*\n\s*ownerId: profile,\s*\n\s*recordId: logId/
    );
});

test("una licencia sin registro en el LOG no acepta documentos", () => {
    assert.deepEqual(getLeaveAttachments(PROFILE, ""), []);
    assert.deepEqual(getLeaveAttachments("", LOG_ID), []);
    assert.match(
        leaveModule,
        /if \(!leaveKey\(profile, logId\)\) \{[\s\S]{0,140}throw new Error/
    );
});

test("al quitar, primero se borra el archivo y despues la referencia", () => {
    // Al reves, un fallo al eliminar dejaria un archivo huerfano en Storage que
    // ya nadie puede alcanzar.
    assert.match(
        leaveModule,
        /await deleteStoredAttachment\(attachment\);\s*\n\s*saveLeaveAttachments\(/
    );
});

test("los adjuntos viajan con el resto del entorno", () => {
    // Si quedaran solo en el navegador del supervisor, otro administrador no
    // podria verlos.
    assert.match(modules, /\["leaveAttachments", "requests"\]/);
});

/* =========================================================
   Donde aparecen los botones
========================================================= */

test("se ofrece adjuntar apenas se aplica la licencia", () => {
    // Es el momento en que el supervisor tiene el documento a mano; dejarlo
    // para despues significa que casi nunca se sube.
    assert.match(main, /await offerLeaveDocumentPrompt\(fecha\);/);
    assert.match(main, /if \(!leaveTypeNeedsDocument\(licenseType\)\) return;/);
    assert.match(main, /confirmText: "Adjuntar documento"/);
});

test("el aviso busca la licencia por el NOMBRE del trabajador", () => {
    // getPerfilActual devuelve el perfil entero. Pasarlo tal cual comparaba
    // "[object Object]" contra el LOG, no encontraba la licencia y el aviso
    // no salia nunca.
    assert.match(
        main,
        /async function offerLeaveDocumentPrompt\(fecha\) \{[\s\S]{0,400}const profile = getPerfilActual\(\)\?\.name \|\| "";/
    );
});

test("el detalle del permiso muestra adjuntar o ver, segun corresponda", () => {
    // El texto lo decide un solo lugar, compartido por los tres cuadros que
    // ofrecen el boton (detalle del permiso, reemplazo y marcaje).
    assert.match(
        calendar,
        /\? \(target\.count > 1 \? "Ver documentos" : "Ver documento"\)\s*\n\s*: "Adjuntar documento"/
    );
    assert.match(calendar, /data-action="leave-docs"/);
    // La licencia sigue contando sus adjuntos contra el registro del LOG.
    assert.match(
        calendar,
        /count: getLeaveAttachments\(profile, logId\)\.length/
    );
});

test("el cuadro de reemplazo lo muestra junto a Anular permiso", () => {
    assert.match(
        calendar,
        /data-action="cancel-leave">\s*\n\s*Anular permiso\s*\n\s*<\/button>\s*\n\s*\$\{leaveDocsButton\}/
    );
    assert.match(
        calendar,
        /const leaveDocsButton = documentsButtonHTML\(\s*\n\s*dayDocumentsTarget\(profileName, keyDay\)\s*\n\s*\);/
    );
    // getLeaveApplicationInfo recibe un OBJETO. Llamarla con los argumentos
    // sueltos devolvia siempre null, asi que el boton no aparecia nunca.
    assert.doesNotMatch(
        calendar,
        /getLeaveApplicationInfo\(profileName, keyDay\)/
    );
    assert.doesNotMatch(main, /getLeaveApplicationInfo\(profile, keyDay\)/);
});

test("el LOG expone el tipo de permiso", () => {
    // Sin el, el calendario no puede saber si corresponde ofrecer el respaldo.
    assert.match(audit, /leaveType: getLeaveUndoType\(log\)/);
});

/* =========================================================
   Permisos de Storage
========================================================= */

test("adjuntar exige poder editar Turnos", () => {
    // La licencia se aplica desde el calendario: es el permiso que corresponde.
    // "leaves" no tiene permiso de menu propio.
    assert.match(rules, /function isLeaveAttachment\(moduleId\) \{/);
    // Lo que se comprueba es que las tres condiciones vayan en la MISMA rama,
    // no que esten en lineas consecutivas: la rama gano despues un
    // `isWorkspaceMember` en medio y esta prueba se puso roja sin que la regla
    // hubiera dejado de ser correcta.
    assert.match(
        rules,
        /isLeaveAttachment\(moduleId\) &&[\s\S]{0,200}canEditModule\(workspaceId, "turnos"\) &&[\s\S]{0,80}allowedMessageFile\(\)/
    );
});

test("cualquier miembro del entorno puede verlo", () => {
    assert.match(
        rules,
        /isMessageAttachment\(moduleId\) \|\|\s*\n\s*isLeaveAttachment\(moduleId\) \|\|/
    );
});

test("no se le aplica la lista de tipos amplia", () => {
    // allowedFile permite Word y Excel; un respaldo de licencia es imagen o PDF.
    assert.match(rules, /!isLeaveAttachment\(moduleId\) &&/);
});
