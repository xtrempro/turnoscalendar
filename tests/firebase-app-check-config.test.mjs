import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    APP_CHECK_ENVIRONMENTS,
    MAX_RECAPTCHA_MIN_VALID_SCORE
} from "../scripts/verify-live-app-check.mjs";

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

test("Auth usa el dominio firebaseapp autorizado por Google", async () => {
    const productionWeb = await configForHost(
        "calendarioturnos-7c4d9.web.app",
        "auth-domain=firebaseapp-production-web"
    );
    const productionFirebase = await configForHost(
        "calendarioturnos-7c4d9.firebaseapp.com",
        "auth-domain=firebaseapp-production"
    );
    const testWeb = await configForHost(
        "turnoplus-test-7c4d9.web.app",
        "auth-domain=firebaseapp-test-web"
    );
    const testFirebase = await configForHost(
        "turnoplus-test-7c4d9.firebaseapp.com",
        "auth-domain=firebaseapp-test"
    );

    assert.equal(
        productionWeb.FIREBASE_CONFIG.authDomain,
        "calendarioturnos-7c4d9.firebaseapp.com"
    );
    assert.equal(
        productionFirebase.FIREBASE_CONFIG.authDomain,
        "calendarioturnos-7c4d9.firebaseapp.com"
    );
    assert.equal(
        testWeb.FIREBASE_CONFIG.authDomain,
        "turnoplus-test-7c4d9.firebaseapp.com"
    );
    assert.equal(
        testFirebase.FIREBASE_CONFIG.authDomain,
        "turnoplus-test-7c4d9.firebaseapp.com"
    );
    assert.equal(
        productionWeb.FIREBASE_PUBLIC_APP_URL,
        "https://calendarioturnos-7c4d9.firebaseapp.com/"
    );
    assert.equal(
        testWeb.FIREBASE_PUBLIC_APP_URL,
        "https://turnoplus-test-7c4d9.firebaseapp.com/"
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

test("App Check usa un score reCAPTCHA compatible con navegadores reales", () => {
    const automation = readFileSync(
        "scripts/configure-test-app-check.mjs",
        "utf8"
    );
    const production = APP_CHECK_ENVIRONMENTS.find(item =>
        item.id === "production"
    );
    const testEnvironment = APP_CHECK_ENVIRONMENTS.find(item =>
        item.id === "test"
    );

    assert.equal(MAX_RECAPTCHA_MIN_VALID_SCORE, 0.1);
    assert.match(
        automation,
        /const MIN_VALID_RECAPTCHA_SCORE\s*=\s*0\.1/
    );
    assert.match(
        automation,
        /riskAnalysis:\s*\{\s*minValidScore:\s*MIN_VALID_RECAPTCHA_SCORE/
    );
    assert.ok(production.requiredDomains.includes("turnoplus.cl"));
    assert.ok(production.requiredDomains.includes("www.turnoplus.cl"));
    assert.ok(
        production.requiredDomains.includes(
            "calendarioturnos-7c4d9.firebaseapp.com"
        )
    );
    assert.equal(
        production.serviceModes["firestore.googleapis.com"],
        "ENFORCED"
    );
    assert.equal(
        production.serviceModes["identitytoolkit.googleapis.com"],
        "UNENFORCED"
    );
    assert.equal(
        testEnvironment.serviceModes["firestore.googleapis.com"],
        "ENFORCED"
    );
});
