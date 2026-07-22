import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    attachmentStorageErrorMessage,
    canPreviewAttachment,
    MAX_ATTACHMENT_FILES,
    MAX_ATTACHMENT_SIZE,
    MAX_ATTACHMENT_TOTAL_SIZE,
    validateAttachmentFile,
    validateAttachmentFiles
} from "../js/attachmentUtils.js";

test("los adjuntos permiten hasta 10 MB por archivo", () => {
    assert.equal(MAX_ATTACHMENT_SIZE, 10 * 1024 * 1024);
    assert.equal(MAX_ATTACHMENT_TOTAL_SIZE, MAX_ATTACHMENT_SIZE * MAX_ATTACHMENT_FILES);

    const allowed = new File(
        [new Uint8Array(MAX_ATTACHMENT_SIZE)],
        "respaldo.pdf",
        { type: "application/pdf" }
    );
    const tooLarge = new File(
        [new Uint8Array(MAX_ATTACHMENT_SIZE + 1)],
        "muy-grande.pdf",
        { type: "application/pdf" }
    );

    assert.equal(validateAttachmentFile(allowed), allowed);
    assert.throws(
        () => validateAttachmentFile(tooLarge),
        /10 MB/
    );
    assert.throws(
        () => validateAttachmentFiles(
            Array.from({ length: MAX_ATTACHMENT_FILES + 1 }, (_, index) =>
                new File([new Uint8Array(1)], `archivo-${index}.pdf`, {
                    type: "application/pdf"
                })
            )
        ),
        /Puedes adjuntar hasta/
    );
});

test("Storage Rules conservan limite de 10 MB por objeto", () => {
    const rules = readFileSync("storage.rules", "utf8");

    assert.match(rules, /request\.resource\.size <= 10 \* 1024 \* 1024/);
    assert.doesNotMatch(rules, /request\.resource\.size <= 5 \* 1024 \* 1024/);
});

test("solo archivos previsualizables abren pestana", () => {
    assert.equal(canPreviewAttachment({
        name: "contrato.pdf",
        type: "application/pdf"
    }), true);
    assert.equal(canPreviewAttachment({
        name: "foto.jpg",
        type: "image/jpeg"
    }), true);
    assert.equal(canPreviewAttachment({
        name: "planilla.xlsx",
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }), false);
    assert.equal(canPreviewAttachment({
        name: "documento.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    }), false);
});

test("errores tecnicos de Firebase Storage se traducen a mensajes utiles", () => {
    assert.equal(
        attachmentStorageErrorMessage({
            code: "storage/retry-limit-exceeded",
            message: "Firebase Storage: Max retry time for operation exceeded"
        }, "abrir"),
        "Firebase Storage no pudo abrir el archivo. Revisa la conexion, recarga TurnoPlus e intenta nuevamente."
    );
    assert.equal(
        attachmentStorageErrorMessage({ code: "storage/object-not-found" }, "abrir"),
        "El archivo adjunto ya no esta disponible en TurnoPlus."
    );
});
