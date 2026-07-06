import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test("el cliente y Functions conservan TOTP apagado por defecto", () => {
    const client = readFileSync("js/firebaseConfig.js", "utf8");
    const functions = readFileSync("functions/index.js", "utf8");

    assert.match(
        client,
        /FIREBASE_REQUIRE_PRIVILEGED_MFA\s*=\s*false/
    );
    assert.match(
        functions,
        /REQUIRE_PRIVILEGED_MFA\s*=\s*false/
    );
});

test("el build de reglas solo activa MFA con una opcion explicita", () => {
    execFileSync(
        process.execPath,
        ["scripts/build-test-security-rules.mjs"],
        { stdio: "pipe" }
    );

    for (const file of ["firebase.rules", "storage.rules"]) {
        const production = readFileSync(file, "utf8");
        const testRules = readFileSync(
            `.firebase/turnoplus-test/${file}`,
            "utf8"
        );

        assert.match(
            production,
            /return false; \/\/ TURNOPLUS_TEST_MFA/
        );
        assert.match(
            testRules,
            /return false; \/\/ TURNOPLUS_TEST_MFA/
        );
    }

    execFileSync(
        process.execPath,
        ["scripts/build-test-security-rules.mjs", "--enable-mfa"],
        { stdio: "pipe" }
    );

    for (const file of ["firebase.rules", "storage.rules"]) {
        const testRules = readFileSync(
            `.firebase/turnoplus-test/${file}`,
            "utf8"
        );

        assert.match(testRules, /return true; \/\/ TURNOPLUS_TEST_MFA/);
    }
});
