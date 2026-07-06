import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const functionsSource = readFileSync("functions/index.js", "utf8");

function exportedBlock(name, nextName) {
    const start = functionsSource.indexOf(`exports.${name} = onCall`);
    const end = nextName
        ? functionsSource.indexOf(`exports.${nextName} = onCall`, start)
        : functionsSource.length;

    assert.notEqual(start, -1, `no se encontro la Function ${name}`);
    assert.notEqual(end, -1, `no se encontro el limite de ${name}`);
    return functionsSource.slice(start, end);
}

test("la busqueda interunidad exige permisos de gestion", () => {
    const source = exportedBlock(
        "findCompatibleReplacementInLinkedUnits",
        "getWorkerAppMonth"
    );

    assert.match(source, /requireWorkspaceRequestManager\s*\(/);
    assert.doesNotMatch(source, /requireWorkspaceMember\s*\(/);
});

test("el historial PWA valida el permiso del modulo", () => {
    const source = exportedBlock("getWorkerAppMonth", "cancelInterUnitLoan");

    assert.match(source, /memberCanReadWorkerCalendar\s*\(member\)/);
    assert.match(
        source,
        /authUid\s*===\s*requestedUid\s*&&\s*workerLinkSnap\.exists/,
        "el trabajador debe conservar acceso a su propio calendario"
    );
});

test("las membresias incompletas no atraviesan las Functions", () => {
    const helperStart = functionsSource.indexOf(
        "async function requireWorkspaceMember"
    );
    const helperEnd = functionsSource.indexOf(
        "async function requireWorkspaceOwner",
        helperStart
    );
    const source = functionsSource.slice(helperStart, helperEnd);

    assert.match(source, /memberHasExplicitAccess\s*\(/);
});

test("los administradores por correo deben tenerlo verificado", () => {
    assert.match(
        functionsSource,
        /function isCouponAdmin[\s\S]*?email_verified\s*!==\s*true/
    );
});
