import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const PROJECT_ID = "turnoplus-test-7c4d9";
const PROJECT_NUMBER = "596177989812";
const APP_ID = "1:596177989812:web:6e1e5a1e194dac99fbe7e1";
const KEY_DISPLAY_NAME = "TurnoPlus Test App Check";
const REQUIRED_DOMAINS = [
    "turnoplus-test-7c4d9.web.app",
    "turnoplus-test-7c4d9.firebaseapp.com"
];
const REQUIRED_SERVICES = [
    "firebaseappcheck.googleapis.com",
    "recaptchaenterprise.googleapis.com"
];
const PROTECTED_FIREBASE_SERVICES = [
    "firebasestorage.googleapis.com",
    "firestore.googleapis.com"
];
const ENFORCE = process.argv.includes("--enforce");
const MONITOR = process.argv.includes("--monitor");
const APPLY =
    process.argv.includes("--apply") ||
    ENFORCE ||
    MONITOR;

function firebaseToolsModule(relativePath) {
    const npmRoot = process.platform === "win32"
        ? path.join(process.env.APPDATA, "npm", "node_modules")
        : execFileSync(
            "npm",
            ["root", "-g"],
            { encoding: "utf8" }
        ).trim();

    return require(path.join(
        npmRoot,
        "firebase-tools",
        "lib",
        relativePath
    ));
}

async function accessToken() {
    const auth = firebaseToolsModule("auth.js");
    const account =
        auth.getProjectDefaultAccount(process.cwd()) ||
        auth.getGlobalDefaultAccount();

    if (!account?.tokens?.refresh_token) {
        throw new Error("Ejecuta firebase login antes de continuar.");
    }

    const tokens = await auth.getAccessToken(
        account.tokens.refresh_token,
        []
    );

    return tokens.access_token;
}

async function api(url, options = {}, allowedStatuses = []) {
    const token = await accessToken();
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-Goog-User-Project": PROJECT_ID,
            ...(options.headers || {})
        }
    });
    const text = await response.text();
    let body = {};

    if (text) {
        try {
            body = JSON.parse(text);
        } catch {
            body = { raw: text };
        }
    }

    if (!response.ok && !allowedStatuses.includes(response.status)) {
        throw new Error(
            `${response.status} ${body?.error?.message || text || url}`
        );
    }

    return {
        body,
        status: response.status
    };
}

async function waitOperation(operationName) {
    if (!operationName) return;

    for (let attempt = 0; attempt < 40; attempt++) {
        const { body } = await api(
            `https://serviceusage.googleapis.com/v1/${operationName}`
        );

        if (body.done) {
            if (body.error) {
                throw new Error(body.error.message);
            }
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    throw new Error(`La operaci\u00f3n ${operationName} no termin\u00f3 a tiempo.`);
}

async function serviceState(service) {
    const { body } = await api(
        `https://serviceusage.googleapis.com/v1/projects/${PROJECT_NUMBER}/services/${service}`
    );

    return body.state || "STATE_UNSPECIFIED";
}

async function ensureService(service) {
    const currentState = await serviceState(service);

    if (currentState === "ENABLED") return;

    if (!APPLY) {
        throw new Error(
            `${service} no est\u00e1 habilitada. Ejecuta el comando con --apply.`
        );
    }

    const { body } = await api(
        `https://serviceusage.googleapis.com/v1/projects/${PROJECT_NUMBER}/services/${service}:enable`,
        {
            method: "POST",
            body: "{}"
        }
    );

    await waitOperation(body.name);
}

async function listKeys() {
    const { body } = await api(
        `https://recaptchaenterprise.googleapis.com/v1/projects/${PROJECT_ID}/keys?pageSize=100`
    );

    return Array.isArray(body.keys) ? body.keys : [];
}

function keyId(key) {
    return String(key?.name || "").split("/").pop();
}

function keyMatches(key) {
    const settings = key?.webSettings || {};
    const allowed = new Set(settings.allowedDomains || []);

    return (
        settings.allowAllDomains !== true &&
        settings.integrationType === "SCORE" &&
        REQUIRED_DOMAINS.every(domain => allowed.has(domain))
    );
}

async function ensureRecaptchaKey() {
    const keys = await listKeys();
    const existing = keys.find(key =>
        key.displayName === KEY_DISPLAY_NAME
    );

    if (existing) {
        if (!keyMatches(existing)) {
            throw new Error(
                `La clave existente ${KEY_DISPLAY_NAME} no tiene ` +
                "los dominios o el modo SCORE esperados."
            );
        }

        return keyId(existing);
    }

    if (!APPLY) {
        throw new Error(
            `No existe la clave ${KEY_DISPLAY_NAME}. ` +
            "Ejecuta el comando con --apply."
        );
    }

    const { body } = await api(
        `https://recaptchaenterprise.googleapis.com/v1/projects/${PROJECT_ID}/keys`,
        {
            method: "POST",
            body: JSON.stringify({
                displayName: KEY_DISPLAY_NAME,
                labels: {
                    environment: "test",
                    application: "turnoplus"
                },
                webSettings: {
                    allowAllDomains: false,
                    allowedDomains: REQUIRED_DOMAINS,
                    allowAmpTraffic: false,
                    integrationType: "SCORE"
                }
            })
        }
    );

    const siteKey = keyId(body);

    if (!siteKey) {
        throw new Error("reCAPTCHA Enterprise no devolvi\u00f3 una site key.");
    }

    return siteKey;
}

function appCheckConfigUrl() {
    return (
        "https://firebaseappcheck.googleapis.com/v1/" +
        `projects/${PROJECT_NUMBER}/apps/${encodeURIComponent(APP_ID)}/` +
        "recaptchaEnterpriseConfig"
    );
}

async function getAppCheckConfig() {
    return api(appCheckConfigUrl(), {}, [404]);
}

async function ensureAppCheckConfig(siteKey) {
    const current = await getAppCheckConfig();

    if (current.status === 200 && current.body.siteKey === siteKey) {
        return current.body;
    }

    if (!APPLY) {
        throw new Error(
            "La app web Test no est\u00e1 registrada con la site key esperada. " +
            "Ejecuta el comando con --apply."
        );
    }

    const name =
        `projects/${PROJECT_NUMBER}/apps/${APP_ID}/` +
        "recaptchaEnterpriseConfig";
    const { body } = await api(
        `${appCheckConfigUrl()}?updateMask=siteKey`,
        {
            method: "PATCH",
            body: JSON.stringify({ name, siteKey })
        }
    );

    return body;
}

function serviceConfigUrl(service) {
    return (
        "https://firebaseappcheck.googleapis.com/v1/" +
        `projects/${PROJECT_NUMBER}/services/${service}`
    );
}

async function getEnforcementModes() {
    const entries = await Promise.all(
        PROTECTED_FIREBASE_SERVICES.map(async service => {
            const { body, status } = await api(
                serviceConfigUrl(service),
                {},
                [404]
            );

            return [
                service,
                status === 200
                    ? String(body.enforcementMode || "OFF")
                    : "OFF"
            ];
        })
    );

    return Object.fromEntries(entries);
}

async function setEnforcementMode(mode) {
    const current = await getEnforcementModes();

    if (PROTECTED_FIREBASE_SERVICES.every(service =>
        current[service] === mode
    )) {
        return current;
    }

    const parent = `projects/${PROJECT_NUMBER}`;
    const { body } = await api(
        `https://firebaseappcheck.googleapis.com/v1/${parent}/services:batchUpdate`,
        {
            method: "POST",
            body: JSON.stringify({
                updateMask: "enforcementMode",
                requests: PROTECTED_FIREBASE_SERVICES.map(service => ({
                    updateMask: "enforcementMode",
                    service: {
                        name: `${parent}/services/${service}`,
                        enforcementMode: mode
                    }
                }))
            })
        }
    );
    const updated = Object.fromEntries(
        (body.services || []).map(service => [
            String(service.name || "").split("/").pop(),
            service.enforcementMode
        ])
    );

    if (!PROTECTED_FIREBASE_SERVICES.every(service =>
        updated[service] === mode
    )) {
        throw new Error(
            `No todos los servicios quedaron en modo ${mode}.`
        );
    }

    return updated;
}

async function main() {
    for (const service of REQUIRED_SERVICES) {
        await ensureService(service);
    }

    const siteKey = await ensureRecaptchaKey();
    const config = await ensureAppCheckConfig(siteKey);

    if (config.siteKey !== siteKey) {
        throw new Error("La verificaci\u00f3n final de App Check no coincide.");
    }

    const desiredMode = ENFORCE
        ? "ENFORCED"
        : (MONITOR ? "UNENFORCED" : "");
    const enforcementModes = desiredMode
        ? await setEnforcementMode(desiredMode)
        : await getEnforcementModes();

    console.log(
        APPLY
            ? "App Check de TurnoPlus Test configurado."
            : "App Check de TurnoPlus Test verificado."
    );
    console.log(`Site key p\u00fablica: ${siteKey}`);
    console.log(`Dominios: ${REQUIRED_DOMAINS.join(", ")}`);
    PROTECTED_FIREBASE_SERVICES.forEach(service => {
        console.log(`${service}: ${enforcementModes[service]}`);
    });
}

main().catch(error => {
    console.error(error.message || error);
    process.exitCode = 1;
});
