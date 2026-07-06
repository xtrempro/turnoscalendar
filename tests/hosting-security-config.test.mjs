import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function loadConfig(file) {
    return JSON.parse(readFileSync(file, "utf8"));
}

function headersFor(config, source) {
    const rule = config.hosting.headers.find(item =>
        item.source === source
    );

    assert.ok(rule, `Falta la regla de Hosting para ${source}`);

    return Object.fromEntries(
        rule.headers.map(header => [header.key, header.value])
    );
}

const production = loadConfig("firebase.json");
const testEnvironment = loadConfig("firebase.test.json");

test("Test conserva las mismas cabeceras de seguridad que producci\u00f3n", () => {
    const productionSecurity = headersFor(production, "**");
    const testSecurity = headersFor(testEnvironment, "**");
    const requiredHeaders = [
        "Content-Security-Policy",
        "Cross-Origin-Opener-Policy",
        "Origin-Agent-Cluster",
        "Permissions-Policy",
        "Referrer-Policy",
        "Strict-Transport-Security",
        "X-Content-Type-Options",
        "X-Frame-Options",
        "X-Permitted-Cross-Domain-Policies"
    ];

    assert.deepEqual(
        Object.keys(testSecurity).sort(),
        requiredHeaders.sort()
    );
    assert.deepEqual(testSecurity, productionSecurity);
    assert.match(
        testSecurity["Content-Security-Policy"],
        /script-src-attr 'none'/
    );
    assert.match(
        testSecurity["Content-Security-Policy"],
        /frame-ancestors 'none'/
    );
    assert.match(
        testSecurity["Content-Security-Policy"],
        /object-src 'none'/
    );
});

test("los bundles con hash usan cach\u00e9 inmutable en ambos entornos", () => {
    for (const config of [production, testEnvironment]) {
        assert.equal(
            headersFor(config, "assets/**")["Cache-Control"],
            "public, max-age=31536000, immutable"
        );
        assert.equal(
            headersFor(config, "/index.html")["Cache-Control"],
            "no-cache"
        );
        assert.equal(
            headersFor(config, "/sw.js")["Cache-Control"],
            "no-cache"
        );
    }
});

test("el manifiesto PWA se sirve sin cach\u00e9 y con su tipo correcto", () => {
    for (const config of [production, testEnvironment]) {
        const headers = headersFor(config, "/manifest.webmanifest");

        assert.equal(headers["Cache-Control"], "no-cache");
        assert.equal(
            headers["Content-Type"],
            "application/manifest+json; charset=utf-8"
        );
    }
});
