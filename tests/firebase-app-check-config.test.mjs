import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

async function configForHost(hostname, cacheKey) {
    globalThis.location = { hostname };
    return import(`../js/firebaseConfig.js?${cacheKey}`);
}

test("producci\u00f3n y Test usan proveedores App Check independientes", async () => {
    const testConfig = await configForHost(
        "turnoplus-test-7c4d9.web.app",
        "environment=test"
    );
    const productionConfig = await configForHost(
        "calendarioturnos-7c4d9.web.app",
        "environment=production"
    );

    assert.equal(testConfig.IS_TEST_ENVIRONMENT, true);
    assert.equal(
        testConfig.FIREBASE_CONFIG.projectId,
        "turnoplus-test-7c4d9"
    );
    assert.equal(
        testConfig.FIREBASE_APP_CHECK_SITE_KEY,
        "6LdZgEctAAAAAGMCUugxmTLm3bfspq8OzqI5xs9M"
    );

    assert.equal(productionConfig.IS_TEST_ENVIRONMENT, false);
    assert.equal(
        productionConfig.FIREBASE_CONFIG.projectId,
        "calendarioturnos-7c4d9"
    );
    assert.equal(
        productionConfig.FIREBASE_APP_CHECK_SITE_KEY,
        "6Lff2zMtAAAAALE9w8AfJOfrWuoPy_35_aNwnh_8"
    );
    assert.notEqual(
        testConfig.FIREBASE_APP_CHECK_SITE_KEY,
        productionConfig.FIREBASE_APP_CHECK_SITE_KEY
    );

    delete globalThis.location;
});

test("Auth usa el mismo dominio publico que abrio la app", async () => {
    const productionWeb = await configForHost(
        "calendarioturnos-7c4d9.web.app",
        "auth-domain=production-web"
    );
    const productionFirebase = await configForHost(
        "calendarioturnos-7c4d9.firebaseapp.com",
        "auth-domain=production-firebase"
    );
    const testWeb = await configForHost(
        "turnoplus-test-7c4d9.web.app",
        "auth-domain=test-web"
    );
    const testFirebase = await configForHost(
        "turnoplus-test-7c4d9.firebaseapp.com",
        "auth-domain=test-firebase"
    );

    assert.equal(
        productionWeb.FIREBASE_CONFIG.authDomain,
        "calendarioturnos-7c4d9.web.app"
    );
    assert.equal(
        productionFirebase.FIREBASE_CONFIG.authDomain,
        "calendarioturnos-7c4d9.firebaseapp.com"
    );
    assert.equal(
        testWeb.FIREBASE_CONFIG.authDomain,
        "turnoplus-test-7c4d9.web.app"
    );
    assert.equal(
        testFirebase.FIREBASE_CONFIG.authDomain,
        "turnoplus-test-7c4d9.firebaseapp.com"
    );

    delete globalThis.location;
});

test("App Check Test autoriza tambien la PWA de funcionarios Test", () => {
    const automation = readFileSync(
        "scripts/configure-test-app-check.mjs",
        "utf8"
    );

    assert.match(automation, /"turnoplusfunc-test\.web\.app"/);
    assert.match(automation, /"turnoplusfunc-test\.firebaseapp\.com"/);
});
