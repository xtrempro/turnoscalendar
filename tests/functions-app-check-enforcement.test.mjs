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
