import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const firebaseClient = readFileSync("js/firebaseClient.js", "utf8");

test("login con Google abre el popup sin esperar carga asincrona previa", () => {
    const match = firebaseClient.match(
        /export function signInWithGoogle\(\) \{[\s\S]*?\n\}\n\nexport async function signOutFirebase/
    );

    assert.ok(match, "No se encontro signInWithGoogle");

    const signInWithGoogle = match[0];

    assert.match(firebaseClient, /initializedServices = services;/);
    assert.match(signInWithGoogle, /initializedServices/);
    assert.match(signInWithGoogle, /signInWithPopup/);
    assert.doesNotMatch(signInWithGoogle, /await\s+getFirebaseServices\(/);
    assert.doesNotMatch(
        firebaseClient,
        /export\s+async\s+function\s+signInWithGoogle/
    );
});

test("login con Google cae a redirect si el popup fue bloqueado", () => {
    const match = firebaseClient.match(
        /async function handleGoogleSignInError[\s\S]*?export function signInWithGoogle/
    );

    assert.ok(match, "No se encontro handleGoogleSignInError");
    assert.match(
        match[0],
        /isPopupBlocked\(error\)[\s\S]*signInWithGoogleRedirect\(services\)/
    );
});
