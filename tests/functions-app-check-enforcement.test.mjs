import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const callableSources = [
    "functions/index.js",
    "functions/getAccountsAndUnits.js"
].map(file => ({
    file,
    source: readFileSync(file, "utf8")
}));
const appCheckConfiguration = readFileSync(
    "scripts/configure-test-app-check.mjs",
    "utf8"
);

test("ninguna Function callable desactiva App Check", () => {
    callableSources.forEach(({ file, source }) => {
        assert.doesNotMatch(
            source,
            /enforceAppCheck\s*:\s*false/,
            `${file} contiene una excepci\u00f3n insegura`
        );
    });
});

test("los m\u00f3dulos callable fijan App Check como obligatorio", () => {
    callableSources.forEach(({ file, source }) => {
        assert.match(
            source,
            /const ENFORCE_APP_CHECK\s*=\s*true\s*;/,
            `${file} no exige App Check`
        );
        assert.match(
            source,
            /enforceAppCheck\s*:\s*ENFORCE_APP_CHECK/,
            `${file} no aplica la constante a sus callables`
        );
    });
});

test("los endpoints onRequest delegan su seguridad al runtime", () => {
    const indexSource = callableSources.find(({ file }) =>
        file === "functions/index.js"
    ).source;

    assert.match(
        indexSource,
        /setGlobalOptions\(\{[\s\S]*?invoker\s*:\s*"public"[\s\S]*?\}\);/,
        "Functions HTTPS no permite que el preflight CORS alcance el runtime"
    );
});

test("la configuración de Test habilita el preflight de cada callable", () => {
    assert.match(
        appCheckConfiguration,
        /labels\?\.\["deployment-callable"\]\s*===\s*"true"/,
        "la automatización no limita el cambio IAM a Functions callable"
    );
    assert.match(
        appCheckConfiguration,
        /role:\s*"roles\/run\.invoker"[\s\S]*?members:\s*\["allUsers"\]/,
        "la automatización no permite que OPTIONS alcance Cloud Run"
    );
    assert.match(
        appCheckConfiguration,
        /:getIamPolicy/,
        "la automatización no conserva la política IAM existente"
    );
    assert.match(
        appCheckConfiguration,
        /:setIamPolicy/,
        "la automatización no persiste la política IAM"
    );
    assert.match(
        appCheckConfiguration,
        /process\.argv\.includes\("--fix-invokers"\)/,
        "el cambio IAM debe requerir una opción explícita"
    );
});
