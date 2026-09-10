// Documentos de cada permiso desde el registro del perfil.
//
// El recuadro "Registro de vacaciones / ausencias" lista los mismos permisos
// que el calendario. Cada uno tiene que llegar al MISMO documento que sus
// casillas: si el perfil resolviera el suyo por otro camino, un documento
// subido desde el calendario podria no verse en el perfil, o al reves.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const calendar = await read("../js/calendar.js");
const main = await read("../js/main.js");

test("el perfil resuelve el documento igual que la casilla", () => {
    // El primer dia del permiso es una casilla mas de ese permiso: llega a la
    // misma licencia o al mismo memorandum.
    assert.match(
        main,
        /getLeaveRecordDocumentButtons\(\s*\n\s*profileName,\s*\n\s*records\.map\(record => record\.startKey\)\s*\n\s*\)/
    );
    assert.match(
        calendar,
        /export function getLeaveRecordDocumentButtons\(profile, keyDays\) \{[\s\S]{0,400}dayDocumentsTarget\(profile, keyDay, maps\)/
    );
});

test("el perfil no busca el documento por su cuenta", () => {
    // Sin atajos: si main.js consultara directamente los adjuntos o los
    // memorandum, se saltaria las reglas de la casilla (licencia sin registro
    // en el LOG, usuario sin permiso de MEMOS).
    assert.doesNotMatch(main, /findLeaveMemoForDay|getLeaveAttachments\(/);
});

test("el boton dice lo mismo que en el calendario", () => {
    assert.match(
        calendar,
        /buttons\.set\(keyDay, documentsButtonLabel\(target\)\)/
    );
    assert.match(
        calendar,
        /data-action="leave-docs">\$\{documentsButtonLabel\(target\)\}/
    );
});

test("cada permiso del registro lleva su boton", () => {
    assert.match(
        main,
        /data-leave-record-docs="\$\{escapeHTML\(record\.startKey\)\}"/
    );
    assert.match(main, /\$\{days\}\s*\n\s*\$\{docsButton\}/);
});

test("al hacer click se vuelve a resolver el destino", () => {
    // Entre que se dibujo el registro y el click pudo llegar un documento, o
    // anularse el permiso, desde otra sesion.
    assert.match(
        calendar,
        /export function openLeaveRecordDocuments\([\s\S]{0,200}const target = dayDocumentsTarget\(profile, keyDay\);/
    );
    assert.match(
        main,
        /openLeaveRecordDocuments\(\s*\n\s*profileName,\s*\n\s*button\.dataset\.leaveRecordDocs,/
    );
});

test("al cerrar el cuadro se redibuja solo el registro", () => {
    // Redibujar todo el recuadro de saldos perderia lo que se estuviera
    // editando ahi.
    assert.match(calendar, /backdrop\.remove\(\);\s*\n\s*onClose\?\.\(\);/);
    assert.match(
        main,
        /onClose: \(\) => \{[\s\S]{0,200}setLeaveHistoryHTML\(\s*\n\s*availabilityHistoryHTML\(profileName\)\s*\n\s*\);/
    );
    assert.doesNotMatch(main, /onClose: renderDisponibilidadVacaciones/);
});

test("los dos cuadros reciben el aviso de cierre", () => {
    assert.match(
        calendar,
        /canEdit: canEditTarget\("calendarPanel"\),\s*\n\s*onClose\s*\n/
    );
    assert.match(
        calendar,
        /canEdit: canEditTarget\("memosPanel"\),\s*\n\s*onClose\s*\n/
    );
});
