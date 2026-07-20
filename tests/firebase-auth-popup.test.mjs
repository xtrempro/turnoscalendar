import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const firebaseClient = readFileSync("js/firebaseClient.js", "utf8");
const firebaseShell = readFileSync("js/firebaseShell.js", "utf8");

test("login con Google usa redireccion como flujo principal", () => {
    const match = firebaseClient.match(
        /export function signInWithGoogle\(\) \{[\s\S]*?\n\}/
    );

    assert.ok(match, "No se encontro signInWithGoogle");

    const signInWithGoogle = match[0];

    assert.match(signInWithGoogle, /signInWithGoogleRedirect\(\)/);
    assert.doesNotMatch(signInWithGoogle, /signInWithPopup/);
    assert.match(firebaseClient, /signInWithRedirect/);
});

test("procesa el retorno de Google antes de escuchar auth state", () => {
    assert.match(firebaseClient, /export async function completeGoogleRedirectSignIn/);
    assert.match(firebaseClient, /getRedirectResult/);
    assert.match(
        firebaseShell,
        /await completeGoogleRedirectSignIn\(\);[\s\S]*await onFirebaseAuthChanged/
    );
});

test("mantiene resolucion MFA cuando Google vuelve por redirect", () => {
    assert.match(firebaseClient, /handleGoogleRedirectResultError/);
    assert.match(
        firebaseClient,
        /auth\/multi-factor-auth-required[\s\S]*resolveGoogleSignInMfa/
    );
});

test("un error interno del redirect no bloquea el estado de sesion", () => {
    assert.match(firebaseClient, /auth\/internal-error/);
    assert.match(firebaseClient, /se continua con onAuthStateChanged/);
    assert.match(firebaseClient, /return null/);
});

test("las invitaciones antiguas en web.app se mueven al authDomain", () => {
    assert.match(firebaseShell, /redirectPendingInviteToAuthDomain/);
    assert.match(firebaseShell, /pendingSupervisorInviteToken\(\)/);
    assert.match(firebaseShell, /FIREBASE_CONFIG\.authDomain/);
    assert.match(firebaseShell, /window\.location\.replace/);
    assert.match(firebaseShell, /if \(redirectPendingInviteToAuthDomain\(\)\) return;/);
});

test("reclama automaticamente la invitacion despues del login", () => {
    assert.match(firebaseShell, /claimPendingSupervisorInvite/);
    assert.match(firebaseShell, /pendingSupervisorInviteToken\(\)[\s\S]*claimPendingSupervisorInvite/);
    assert.match(firebaseShell, /claimSupervisorInvitation\([\s\S]*currentUser/);
    assert.match(firebaseShell, /clearPendingJoinWorkspaceId\(\)/);
    assert.match(firebaseShell, /Solicitud enviada para/);
});
