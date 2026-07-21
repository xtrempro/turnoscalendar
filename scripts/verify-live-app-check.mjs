import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

export const MAX_RECAPTCHA_MIN_VALID_SCORE = 0.1;

export const APP_CHECK_ENVIRONMENTS = [
    {
        id: "production",
        projectId: "calendarioturnos-7c4d9",
        projectNumber: "1034511206564",
        appId: "1:1034511206564:web:d57211f4cb4c5446a1fe31",
        siteKey: "6Lff2zMtAAAAALE9w8AfJOfrWuoPy_35_aNwnh_8",
        requiredDomains: [
            "turnoplus.cl",
            "www.turnoplus.cl",
            "calendarioturnos-7c4d9.web.app",
            "calendarioturnos-7c4d9.firebaseapp.com",
            "turnoplusfuncionarios.web.app",
            "turnoplusfuncionarios.firebaseapp.com",
            "turnoplus-admin.web.app"
        ],
        serviceModes: {
            "firestore.googleapis.com": "ENFORCED",
            "firebasestorage.googleapis.com": "ENFORCED",
            "identitytoolkit.googleapis.com": "UNENFORCED"
        }
    },
    {
        id: "test",
        projectId: "turnoplus-test-7c4d9",
        projectNumber: "596177989812",
        appId: "1:596177989812:web:6e1e5a1e194dac99fbe7e1",
        siteKey: "6LdZgEctAAAAAGMCUugxmTLm3bfspq8OzqI5xs9M",
        requiredDomains: [
            "turnoplus-test-7c4d9.web.app",
            "turnoplus-test-7c4d9.firebaseapp.com",
            "turnoplusfunc-test.web.app",
            "turnoplusfunc-test.firebaseapp.com"
        ],
        serviceModes: {
            "firestore.googleapis.com": "ENFORCED",
            "firebasestorage.googleapis.com": "ENFORCED"
        }
    }
];

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
        throw new Error("Ejecuta firebase login antes de verificar App Check.");
    }

    const tokens = await auth.getAccessToken(
        account.tokens.refresh_token,
        []
    );

    return tokens.access_token;
}

async function api(environment, url, allowedStatuses = []) {
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${await accessToken()}`,
            "X-Goog-User-Project": environment.projectId
        }
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};

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

async function recaptchaKey(environment) {
    const { body } = await api(
        environment,
        "https://recaptchaenterprise.googleapis.com/v1/" +
        `projects/${environment.projectId}/keys?pageSize=100`
    );

    return (body.keys || []).find(key =>
        String(key.name || "").endsWith(`/${environment.siteKey}`)
    );
}

function appCheckConfigUrl(environment) {
    return (
        "https://firebaseappcheck.googleapis.com/v1/" +
        `projects/${environment.projectNumber}/apps/` +
        `${encodeURIComponent(environment.appId)}/` +
        "recaptchaEnterpriseConfig"
    );
}

async function appCheckConfig(environment) {
    const { body } = await api(environment, appCheckConfigUrl(environment));

    return body;
}

async function serviceMode(environment, service) {
    const { body, status } = await api(
        environment,
        "https://firebaseappcheck.googleapis.com/v1/" +
        `projects/${environment.projectNumber}/services/${service}`,
        [404]
    );

    if (status === 404) return "OFF";

    return String(body.enforcementMode || "OFF");
}

function assertRecaptchaDomains(environment, key) {
    if (!key) {
        throw new Error(
            `${environment.id}: no existe la llave reCAPTCHA ${environment.siteKey}.`
        );
    }

    const settings = key.webSettings || {};
    const allowedDomains = new Set(settings.allowedDomains || []);
    const missing = environment.requiredDomains.filter(domain =>
        !allowedDomains.has(domain)
    );

    if (settings.allowAllDomains === true) {
        throw new Error(
            `${environment.id}: reCAPTCHA no debe permitir todos los dominios.`
        );
    }

    if (settings.integrationType !== "SCORE") {
        throw new Error(
            `${environment.id}: reCAPTCHA debe usar integracion SCORE.`
        );
    }

    if (missing.length) {
        throw new Error(
            `${environment.id}: faltan dominios reCAPTCHA: ${missing.join(", ")}.`
        );
    }
}

function assertAppCheckConfig(environment, config) {
    const score = Number(config?.riskAnalysis?.minValidScore);

    if (config.siteKey !== environment.siteKey) {
        throw new Error(
            `${environment.id}: App Check usa una site key distinta.`
        );
    }

    if (
        !Number.isFinite(score) ||
        score > MAX_RECAPTCHA_MIN_VALID_SCORE
    ) {
        throw new Error(
            `${environment.id}: minValidScore debe ser <= ` +
            `${MAX_RECAPTCHA_MIN_VALID_SCORE}; actual ${score}.`
        );
    }
}

export async function verifyEnvironment(environment) {
    const [key, config] = await Promise.all([
        recaptchaKey(environment),
        appCheckConfig(environment)
    ]);

    assertRecaptchaDomains(environment, key);
    assertAppCheckConfig(environment, config);

    for (const [service, expected] of Object.entries(
        environment.serviceModes
    )) {
        const actual = await serviceMode(environment, service);

        if (actual !== expected) {
            throw new Error(
                `${environment.id}: ${service} debe estar ${expected}; ` +
                `actual ${actual}.`
            );
        }
    }
}

function selectedEnvironments() {
    const index = process.argv.indexOf("--env");
    const value = index >= 0
        ? process.argv[index + 1]
        : "all";

    if (!value || value === "all") return APP_CHECK_ENVIRONMENTS;

    const environment = APP_CHECK_ENVIRONMENTS.find(item =>
        item.id === value
    );

    if (!environment) {
        throw new Error(`Entorno App Check desconocido: ${value}`);
    }

    return [environment];
}

async function main() {
    const environments = selectedEnvironments();

    for (const environment of environments) {
        await verifyEnvironment(environment);
        console.log(`App Check ${environment.id}: OK`);
    }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        console.error(error.message || error);
        process.exitCode = 1;
    });
}
