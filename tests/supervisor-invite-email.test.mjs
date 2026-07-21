import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const firebaseShell = readFileSync("js/firebaseShell.js", "utf8");
const workspaces = readFileSync("js/workspaces.js", "utf8");
const functionsSource = readFileSync("functions/index.js", "utf8");

function exportedCallableBlock(name, nextName) {
    const start = functionsSource.indexOf(`exports.${name} = onCall`);
    const end = functionsSource.indexOf(`exports.${nextName} = onCall`, start);

    assert.notEqual(start, -1, `no se encontro la Function ${name}`);
    assert.notEqual(end, -1, `no se encontro el limite de ${name}`);
    return functionsSource.slice(start, end);
}

test("la tarjeta de unidad envia invitaciones por correo sin mailto", () => {
    assert.match(firebaseShell, /data-workspace-invite-email/);
    assert.match(firebaseShell, /data-action="send-workspace-invite-email"/);
    assert.match(firebaseShell, /sendSupervisorInvitationEmail/);
    assert.doesNotMatch(firebaseShell, /data-action="copy-workspace-id"/);
    assert.doesNotMatch(firebaseShell, /data-action="copy-workspace-invite"/);
    assert.doesNotMatch(firebaseShell, /firebase-workspace-id/);
    assert.doesNotMatch(firebaseShell, /firebase-workspace-actions/);
    assert.doesNotMatch(firebaseShell, /copyTextToClipboard/);
    assert.doesNotMatch(firebaseShell, /Unirse a una unidad existente/);
    assert.doesNotMatch(firebaseShell, /firebaseJoinWorkspaceId/);
    assert.doesNotMatch(firebaseShell, /data-action="join-workspace"/);
    assert.doesNotMatch(firebaseShell, /email-workspace-invite/);
    assert.doesNotMatch(firebaseShell, /mailto:\?subject/);
});

test("el wrapper frontend llama la callable de envio de supervisor", () => {
    assert.match(workspaces, /export async function sendSupervisorInvitationEmail/);
    assert.match(workspaces, /callWorkspaceFunction\("sendSupervisorInviteEmail"/);
});

test("la callable de correo exige seguridad y envia por Resend", () => {
    const source = exportedCallableBlock(
        "sendSupervisorInviteEmail",
        "claimSupervisorInvite"
    );

    assert.match(source, /enforceAppCheck:\s*ENFORCE_APP_CHECK/);
    assert.match(source, /secrets:\s*\[RESEND_API_KEY\]/);
    assert.match(source, /requireWorkspaceOwner\(/);
    assert.match(source, /reserveInviteEmailSend\(/);
    assert.match(source, /createSupervisorInviteDocument\(/);
    assert.match(source, /sendResendEmail\(/);
    assert.match(functionsSource, /function supervisorInviteUrl/);
    assert.match(functionsSource, /const PROTURNOS_APP_BASE_URL/);
    assert.match(functionsSource, /calendarioturnos-7c4d9\.firebaseapp\.com/);
    assert.match(functionsSource, /turnoplus-test-7c4d9\.firebaseapp\.com/);
    assert.match(functionsSource, /function buildSupervisorInviteEmail/);
});
