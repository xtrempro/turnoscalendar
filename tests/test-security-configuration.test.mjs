import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test("el cliente y Functions exigen TOTP solamente en Test", () => {
    const client = readFileSync("js/firebaseConfig.js", "utf8");
    const functions = readFileSync("functions/index.js", "utf8");
    const main = readFileSync("js/main.js", "utf8");

    assert.match(
        client,
        /FIREBASE_REQUIRE_PRIVILEGED_MFA\s*=\s*useTestProject/
    );
    assert.match(
        functions,
        /REQUIRE_PRIVILEGED_MFA\s*=\s*[\s\S]*?GCLOUD_PROJECT\s*===\s*"turnoplus-test-7c4d9"/
    );
    assert.match(
        main,
        /getActiveWorkspace\(\)\s*\|\|\s*\{\s*id:\s*"new-account"\s*\}/,
        "una cuenta nueva debe poder enrolar TOTP antes de crear su unidad"
    );
});

test("el build activa MFA solo en las reglas generadas de Test", () => {
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
            /return true; \/\/ TURNOPLUS_TEST_MFA/
        );
        assert.doesNotMatch(
            testRules,
            /return false; \/\/ TURNOPLUS_TEST_MFA/
        );
    }
});
