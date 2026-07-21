import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const firebaseShell = readFileSync("js/firebaseShell.js", "utf8");
const supervisorInvitesUI = readFileSync("js/supervisorInvitesUI.js", "utf8");
const workspaces = readFileSync("js/workspaces.js", "utf8");
const systemSettings = readFileSync("js/systemSettings.js", "utf8");
const styles = readFileSync("styles.css", "utf8");
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
    assert.match(firebaseShell, /Agrega a un administrador m&aacute;s para colaborar en la gesti&oacute;n de la unidad/);
    assert.match(firebaseShell, /placeholder="colaborador@correo\.cl"/);
    assert.doesNotMatch(firebaseShell, /supervisor@correo\.cl/);
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

test("las invitaciones nuevas parten con permisos de ver y editar", () => {
    const start = supervisorInvitesUI.indexOf(
        "export function defaultSupervisorInvitePermissions()"
    );
    const end = supervisorInvitesUI.indexOf("function timestampToMillis", start);

    assert.notEqual(start, -1, "no se encontro defaultSupervisorInvitePermissions");
    assert.notEqual(end, -1, "no se encontro el limite de defaultSupervisorInvitePermissions");

    const source = supervisorInvitesUI.slice(start, end);

    assert.match(source, /view:\s*true/);
    assert.match(source, /edit:\s*true/);
    assert.doesNotMatch(source, /edit:\s*false/);
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

test("el historial de invitaciones cerradas se recorta por estado", () => {
    assert.match(
        functionsSource,
        /SUPERVISOR_INVITE_REVOKED_HISTORY_LIMIT\s*=\s*3/
    );
    assert.match(
        functionsSource,
        /SUPERVISOR_INVITE_EXPIRED_HISTORY_LIMIT\s*=\s*5/
    );
    assert.match(functionsSource, /async function trimSupervisorInviteHistory/);
    assert.match(functionsSource, /\.where\("status",\s*"==",\s*status\)/);
    assert.match(functionsSource, /\.slice\(limit\)/);
    assert.match(functionsSource, /exports\.trimSupervisorInviteHistory = onCall/);
    assert.match(workspaces, /trimSupervisorInvitationHistory/);
    assert.match(workspaces, /await trimSupervisorInvitationHistory\(workspaceId\)/);
});

test("las invitaciones aprobadas y cerradas tienen estados visuales y acceso a Usuarios", () => {
    assert.match(firebaseShell, /SUPERVISOR_INVITE_DISPLAY_LIMITS[\s\S]*revoked:\s*3/);
    assert.match(firebaseShell, /SUPERVISOR_INVITE_DISPLAY_LIMITS[\s\S]*expired:\s*5/);
    assert.match(firebaseShell, /supervisor-invite-item--approved/);
    assert.match(firebaseShell, /supervisor-invite-item--danger/);
    assert.match(firebaseShell, /open-approved-supervisor-settings/);
    assert.match(firebaseShell, /openSystemSettings\("users"\)/);
    assert.match(styles, /\.supervisor-invite-item--approved/);
    assert.match(styles, /\.supervisor-invite-item--danger/);
});

test("usuarios y permisos oculta al creador y muestra solo colaboradores", () => {
    assert.match(
        systemSettings,
        /const collaborators = memberPermissionDraft\.filter\(member =>[\s\S]*member\.role !== "owner"/
    );
    assert.match(systemSettings, /collaborators\.map\(member =>/);
    assert.match(systemSettings, /<em>Colaborador<\/em>/);
    assert.match(
        systemSettings,
        /Aun no hay colaboradores aprobados en esta unidad/
    );
    assert.match(systemSettings, /openSystemSettings\(initialTab = activeTab\)/);
});
