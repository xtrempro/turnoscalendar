// El supervisor puede adjuntar una imagen o un PDF (hasta 10 MB) a los mensajes
// que manda a un trabajador.
//
// La parte delicada no es el boton sino QUIEN puede leer el archivo: el
// trabajador no es miembro del entorno, entra por su enlace de PWA. Por eso el
// adjunto se guarda bajo el uid del destinatario y las reglas de Storage dejan
// que ese uid -y solo ese- lo lea.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const messages = await read("../js/supervisorMessages.js");
const attachments = await read("../js/attachmentUtils.js");
const rules = await read("../storage.rules");
const styles = await read("../styles.css");

/* =========================================================
   Que se puede adjuntar
========================================================= */

test("solo imagenes y PDF en los mensajes", () => {
    // El resto del app acepta Word, Excel y texto; en mensajeria no, porque el
    // trabajador los abre en el telefono.
    assert.match(
        attachments,
        /export const MESSAGE_ATTACHMENT_ACCEPT =\s*\n\s*"\.png,\.jpg,\.jpeg,\.gif,\.webp,\.bmp,\.heic,\.heif,\.pdf";/
    );
    assert.match(attachments, /export function validateMessageAttachment\(file\) \{/);
    // Se apoya en la validacion general (tamano, plan, extension) y ademas
    // recorta los tipos: no duplica el limite de 10 MB.
    assert.match(
        attachments,
        /function validateMessageAttachment\(file\) \{\s*\n\s*validateAttachmentFile\(file\);/
    );
    assert.match(attachments, /export const MAX_ATTACHMENT_SIZE = 10 \* 1024 \* 1024;/);
});

test("el modulo messages puede subir a Storage", () => {
    // Sin esto, storageContext devuelve null y el adjunto se guardaria como
    // dataUrl dentro del documento del mensaje.
    assert.match(attachments, /const STORAGE_MODULES = new Set\(\[[\s\S]{0,900}"messages"/);
});

/* =========================================================
   El compositor
========================================================= */

test("el compositor tiene el clip y acepta lo permitido", () => {
    assert.match(messages, /data-message-attachment-input/);
    assert.match(messages, /accept="\$\{MESSAGE_ATTACHMENT_ACCEPT\}"/);
    // El archivo se valida al elegirlo, no recien al enviar.
    assert.match(messages, /validateMessageAttachment\(file\);/);
});

test("volver a elegir el mismo archivo sigue funcionando", () => {
    // Si no se limpia el input, elegir dos veces el MISMO archivo no dispara
    // "change" y parece que la app se quedo pegada.
    assert.match(messages, /input\.value = "";/);
});

test("un mensaje puede ser solo un archivo", () => {
    assert.match(messages, /if \(!worker\?\.uid \|\| \(!text && !file\)\) return;/);
    // Y la lista de conversaciones tiene que decir algo: un mensaje sin texto
    // se veria vacio.
    assert.match(messages, /function attachmentPreviewText\(attachments = \[\]\)/);
    assert.match(messages, /lastMessage: text \|\| attachmentPreviewText\(attachments\)/);
});

test("el adjunto se guarda bajo el uid del destinatario", () => {
    // Es lo que hace que su PWA pueda leerlo sin ser miembro del entorno.
    assert.match(
        messages,
        /moduleId: "messages",[\s\S]{0,220}ownerId: worker\.uid/
    );
});

test("el mensaje viaja con sus adjuntos", () => {
    assert.match(messages, /async function writeSupervisorMessage\(worker, text, attachments = \[\]\)/);
    assert.match(messages, /text,\s*\n\s*attachments,\s*\n\s*sender: "supervisor"/);
});

test("el adjunto del mensaje guarda la URL de descarga", () => {
    // Asi la PWA puede abrir por navegacion directa y no depende solo de pedir
    // getDownloadURL desde el telefono al momento de tocar el archivo.
    assert.match(
        attachments,
        /const storageRef = storageModule\.ref\(storage, storagePath\);/
    );
    assert.match(
        attachments,
        /if \(context\.moduleId === "messages"\) \{\s*\n\s*downloadURL = await storageModule\.getDownloadURL\(storageRef\);/
    );
    assert.match(
        attachments,
        /if \(downloadURL\) \{\s*\n\s*attachment\.downloadURL = downloadURL;/
    );
});

test("el boton avisa mientras sube", () => {
    // Subir 10 MB no es instantaneo: sin esto parece que no paso nada.
    assert.match(messages, /submit\.textContent = file \? "Subiendo\.\.\." : "Enviando\.\.\.";/);
    assert.match(messages, /submit\.textContent = "Enviar";/);
});

test("el adjunto recibido se abre desde la burbuja", () => {
    assert.match(messages, /data-message-file="\$\{escapeHTML\(message\.id\)\}"/);
    assert.match(messages, /await openAttachmentFile\(attachment, \{ newTab: true \}\)/);
});

/* =========================================================
   Reglas de Storage: quien lo puede leer
========================================================= */

test("el trabajador destinatario puede leer su adjunto", () => {
    assert.match(rules, /function isMessageAttachment\(moduleId\) \{/);
    assert.match(rules, /function isLinkedWorkerRecipient\(workspaceId, ownerId\) \{/);
    // Solo el suyo: el ownerId de la ruta tiene que ser su propio uid.
    assert.match(rules, /ownerId == request\.auth\.uid &&/);
    assert.match(
        rules,
        /workerLinks\/\$\(request\.auth\.uid\)\);/
    );
});

test("subir un adjunto de mensaje solo pide ser miembro", () => {
    // La mensajeria no tiene permiso de menu propio, asi que no se puede exigir
    // canEditModule("messages"): ningun invitado lo tendria.
    assert.match(
        rules,
        /isMessageAttachment\(moduleId\) &&\s*\n\s*isWorkspaceMember\(workspaceId\) &&\s*\n\s*allowedMessageFile\(\)/
    );
});

test("los mensajes no pasan por la lista de tipos amplia", () => {
    // allowedFile permite Word/Excel/texto; en mensajeria solo imagen y PDF.
    assert.match(
        rules,
        /function allowedMessageFile\(\) \{[\s\S]{0,320}image\/\(png\|jpeg\|jpg\|pjpeg\|gif\|webp\|bmp\|heic\|heif\)\|application\/pdf/
    );
    assert.match(
        rules,
        /function allowedMessageFile\(\) \{[\s\S]{0,200}request\.resource\.size <= 10 \* 1024 \* 1024/
    );
    // Y la rama general excluye messages, para no aplicarle allowedFile.
    assert.match(rules, /!isMessageAttachment\(moduleId\) &&/);
});

test("el clip tiene estilos propios y texto para lectores de pantalla", () => {
    assert.match(styles, /\.supervisor-message-clip \{/);
    assert.match(styles, /\.supervisor-message-clip input\[type="file"\] \{ display: none; \}/);
    assert.match(styles, /\.sr-only \{/);
});
