// La invitacion a la app del trabajador sale SOLO con el boton Enlazar.
//
// 2026-09-29: guardar un perfil con un correo nuevo enviaba de inmediato el
// correo de enlace. El usuario pidio que no: el supervisor decide cuando
// enviarlo, con el boton del perfil.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");
const invites = await readFile(
    new URL("../js/workerAppInvites.js", import.meta.url),
    "utf8"
);

test("guardar el perfil no crea invitaciones", () => {
    assert.doesNotMatch(main, /sendWorkerAppInviteEmail/);
    assert.doesNotMatch(main, /shouldSendAutomaticWorkerInvite/);
    assert.doesNotMatch(invites, /export async function sendWorkerAppInviteEmail/);
});

test("el boton Enlazar sigue creando la invitacion", () => {
    assert.match(
        main,
        /DOM\.workerAppInviteBtn\.onclick = \(\) =>\s*openWorkerAppInviteDialog\(getPerfilActual\(\)\);/
    );
    assert.match(
        invites,
        /export async function openWorkerAppInviteDialog\(profile\) \{\s*try \{\s*const result = await createWorkerAppInvite\(profile\);/
    );
});

test("cambiar el correo de un enlazado desenlaza sin enviar nada", () => {
    assert.match(
        main,
        /if \(shouldReplaceWorkerAppLink\) \{\s*previousLinkRevoked = await unlinkWorkerAppForProfile\(/
    );
    assert.match(main, /No se enviará ningún correo todavía/);
});

test("cambiar el correo anula las invitaciones pendientes al anterior", () => {
    assert.match(main, /const shouldSupersedeWorkerInvites = emailChanged;/);
    assert.match(main, /await supersedePendingWorkerInvites\(\{/);
    assert.match(invites, /status: "superseded",\s*supersededAt: now,\s*supersededReason: "email_changed"/);
});
