import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const firebaseShell = readFileSync("js/firebaseShell.js", "utf8");
const linkedUnits = readFileSync("js/firebaseLinkedUnits.js", "utf8");
const workerRequests = readFileSync("js/workerRequests.js", "utf8");
const functionsSource = readFileSync("functions/index.js", "utf8");

function exportedCallableBlock(name, nextName) {
    const start = functionsSource.indexOf(`exports.${name} = onCall`);
    const end = functionsSource.indexOf(`exports.${nextName} = onCall`, start);

    assert.notEqual(start, -1, `no se encontro la Function ${name}`);
    assert.notEqual(end, -1, `no se encontro el limite de ${name}`);
    return functionsSource.slice(start, end);
}

test("unidades enlazadas solicita por correo del owner y no por ID visible", () => {
    assert.match(firebaseShell, /firebaseLinkedWorkspaceOwnerEmail/);
    assert.match(firebaseShell, /placeholder="owner@correo\.cl"/);
    assert.match(firebaseShell, /Ingresa el correo del owner de la unidad que quieres enlazar/);
    assert.doesNotMatch(firebaseShell, /firebaseLinkedWorkspaceId/);
    assert.doesNotMatch(firebaseShell, /ID de la unidad a enlazar/);
});

test("el frontend crea solicitudes de enlace mediante callable por email", () => {
    assert.match(linkedUnits, /requestWorkspaceLinkByOwnerEmail/);
    assert.match(linkedUnits, /ownerEmail:\s*email/);
    assert.match(linkedUnits, /toOwnerUid/);
    assert.match(linkedUnits, /workspaceLinkDisplayName/);
});

test("solicitudes escucha enlaces directos dirigidos al owner", () => {
    assert.match(workerRequests, /where\("toOwnerUid",\s*"=="/);
    assert.match(workerRequests, /getWorkspaceLinkRequests\(\)/);
    assert.match(
        workerRequests,
        /const pending = \[[\s\S]*\.\.\.linkRequests/
    );
});

test("la callable de enlace por correo crea solicitud y envia correo", () => {
    const source = exportedCallableBlock(
        "requestWorkspaceLinkByOwnerEmail",
        "claimSupervisorInvite"
    );

    assert.match(source, /enforceAppCheck:\s*ENFORCE_APP_CHECK/);
    assert.match(source, /secrets:\s*\[RESEND_API_KEY\]/);
    assert.match(source, /requireWorkspaceRequestManager\(/);
    assert.match(source, /resolveWorkspaceLinkOwner\(/);
    assert.match(source, /collection\("workspaceLinks"\)/);
    assert.match(source, /toOwnerUid/);
    assert.match(source, /requestMode:\s*"owner_email"/);
    assert.match(source, /buildWorkspaceLinkRequestEmail\(/);
    assert.match(source, /sendResendEmail\(/);
});
