import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const PROJECT_ID = "calendarioturnos-7c4d9";
const PROJECT_NUMBER = "1034511206564";
const TEST_PROJECT_ID = "turnoplus-test-7c4d9";
const TEST_PROJECT_NUMBER = "596177989812";
const API_KEY_ID = "b7357b4d-c437-4b8f-9a16-7d26904b1487";
const ALERT_EMAIL = "tm.alanplaza@gmail.com";
const ENABLE_TOTP_HARDENING =
    process.env.TURNOPLUS_ENABLE_TOTP === "true";

const FIREBASE_API_TARGETS = [
    "firebase.googleapis.com",
    "logging.googleapis.com",
    "firebaseinstallations.googleapis.com",
    "firebaseappcheck.googleapis.com",
    "identitytoolkit.googleapis.com",
    "securetoken.googleapis.com",
    "datastore.googleapis.com",
    "firestore.googleapis.com",
    "fcmregistrations.googleapis.com",
    "firebasestorage.googleapis.com"
];

const ALLOWED_REFERRERS = [
    "https://turnoplus.cl/*",
    "https://www.turnoplus.cl/*",
    "https://auth.turnoplus.cl/*",
    "https://calendarioturnos-7c4d9.web.app/*",
    "https://calendarioturnos-7c4d9.firebaseapp.com/*",
    "https://turnoplusfuncionarios.web.app/*",
    "https://turnoplusfuncionarios.firebaseapp.com/*",
    "http://localhost:*/*",
    "http://127.0.0.1:*/*"
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
        throw new Error("Ejecuta firebase login antes de continuar.");
    }

    const tokens = await auth.getAccessToken(
        account.tokens.refresh_token,
        []
    );

    return tokens.access_token;
}

async function api(url, options = {}, retry = 0) {
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
    const body = text ? JSON.parse(text) : {};

    if (!response.ok) {
        const retryable =
            response.status === 429 ||
            response.status >= 500 ||
            (
                response.status === 403 &&
                JSON.stringify(body).includes("SERVICE_DISABLED")
            );

        if (retryable && retry < 6) {
            await new Promise(resolve =>
                setTimeout(resolve, 2500 * (retry + 1))
            );
            return api(url, options, retry + 1);
        }

        throw new Error(
            `${response.status} ${body?.error?.message || text || url}`
        );
    }

    return body;
}

async function waitOperation(operationName) {
    if (!operationName) return;
    if (operationName.includes("DONE_OPERATION")) return;

    for (let attempt = 0; attempt < 30; attempt++) {
        const operation = await api(
            `https://serviceusage.googleapis.com/v1/${operationName}`
        );

        if (operation.done) {
            if (operation.error) {
                throw new Error(operation.error.message);
            }
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    throw new Error(`La operacion ${operationName} no termino a tiempo.`);
}

async function enableService(projectNumber, service) {
    const result = await api(
        `https://serviceusage.googleapis.com/v1/projects/${projectNumber}/services/${service}:enable`,
        {
            method: "POST",
            body: "{}"
        }
    );

    await waitOperation(result.name);
}

async function enableRequiredApis() {
    const productionServices = [
        "apikeys.googleapis.com",
        "billingbudgets.googleapis.com",
        "cloudbilling.googleapis.com",
        "firestore.googleapis.com",
        "identitytoolkit.googleapis.com",
        "logging.googleapis.com",
        "monitoring.googleapis.com"
    ];

    for (const service of productionServices) {
        await enableService(PROJECT_NUMBER, service);
    }

    await enableService(
        TEST_PROJECT_NUMBER,
        "firestore.googleapis.com"
    );
    await enableService(
        TEST_PROJECT_NUMBER,
        "identitytoolkit.googleapis.com"
    );
}

async function initializeTestAuth() {
    try {
        await api(
            `https://identitytoolkit.googleapis.com/v2/projects/${TEST_PROJECT_ID}/identityPlatform:initializeAuth`,
            {
                method: "POST",
                headers: {
                    "X-Goog-User-Project": TEST_PROJECT_ID
                },
                body: "{}"
            }
        );
    } catch (error) {
        if (
            !String(error?.message || "").includes("409") &&
            !String(error?.message || "").includes("ALREADY_EXISTS")
        ) {
            throw error;
        }
    }
}

async function configureTotp(projectId, enabled) {
    await api(
        `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config?updateMask=mfa`,
        {
            method: "PATCH",
            headers: {
                "X-Goog-User-Project": projectId
            },
            body: JSON.stringify({
                mfa: {
                    state: enabled ? "ENABLED" : "DISABLED",
                    providerConfigs: [{
                        state: enabled ? "ENABLED" : "DISABLED",
                        totpProviderConfig: {
                            adjacentIntervals: 2
                        }
                    }]
                }
            })
        }
    );
}

function authTotpEnabled(authConfig) {
    return authConfig.mfa?.state === "ENABLED" &&
        authConfig.mfa?.providerConfigs?.some(provider =>
            provider.state === "ENABLED" &&
            provider.totpProviderConfig
        );
}

async function enableTestGoogleSignIn() {
    await api(
        `https://identitytoolkit.googleapis.com/admin/v2/projects/${TEST_PROJECT_ID}/defaultSupportedIdpConfigs/google.com?updateMask=enabled`,
        {
            method: "PATCH",
            headers: {
                "X-Goog-User-Project": TEST_PROJECT_ID
            },
            body: JSON.stringify({
                enabled: true
            })
        }
    );
}

async function configureTestProjectAuthBestEffort() {
    try {
        await initializeTestAuth();
        if (ENABLE_TOTP_HARDENING) {
            await configureTotp(TEST_PROJECT_ID, true);
        }
        await enableTestGoogleSignIn();

        const [testAuthConfig, testGoogleProvider] = await Promise.all([
            api(
                `https://identitytoolkit.googleapis.com/admin/v2/projects/${TEST_PROJECT_ID}/config`,
                {
                    headers: {
                        "X-Goog-User-Project": TEST_PROJECT_ID
                    }
                }
            ),
            api(
                `https://identitytoolkit.googleapis.com/admin/v2/projects/${TEST_PROJECT_ID}/defaultSupportedIdpConfigs/google.com`,
                {
                    headers: {
                        "X-Goog-User-Project": TEST_PROJECT_ID
                    }
                }
            )
        ]);
        const testTotpEnabled = authTotpEnabled(testAuthConfig);

        if (
            (ENABLE_TOTP_HARDENING && !testTotpEnabled) ||
            !testGoogleProvider.enabled
        ) {
            throw new Error(
                ENABLE_TOTP_HARDENING
                    ? "El proyecto de pruebas no quedo con Google Login y TOTP."
                    : "El proyecto de pruebas no quedo con Google Login."
            );
        }

        console.log(
            ENABLE_TOTP_HARDENING
                ? "Proyecto de pruebas: Google Login y TOTP habilitados."
                : "Proyecto de pruebas: Google Login habilitado; TOTP queda desactivado."
        );
    } catch (error) {
        const message = String(error?.message || "");
        if (
            message.includes("BILLING_NOT_ENABLED") ||
            message.includes("CONFIGURATION_NOT_FOUND") ||
            message.includes("404")
        ) {
            console.warn(
                "Proyecto de pruebas: Auth/TOTP requiere activar facturacion o inicializar Authentication manualmente; se omitio para no generar costos."
            );
            return;
        }

        throw error;
    }
}

async function restrictFirebaseApiKey() {
    const keyName =
        `projects/${PROJECT_NUMBER}/locations/global/keys/${API_KEY_ID}`;
    const current = await api(
        `https://apikeys.googleapis.com/v2/${keyName}`
    );

    await api(
        `https://apikeys.googleapis.com/v2/${keyName}?updateMask=restrictions`,
        {
            method: "PATCH",
            body: JSON.stringify({
                etag: current.etag,
                restrictions: {
                    browserKeyRestrictions: {
                        allowedReferrers: ALLOWED_REFERRERS
                    },
                    apiTargets: FIREBASE_API_TARGETS.map(service => ({
                        service
                    }))
                }
            })
        }
    );
}

async function upsertLogMetric(name, description, filter) {
    await api(
        `https://logging.googleapis.com/v2/projects/${PROJECT_ID}/metrics/${name}`,
        {
            method: "PUT",
            body: JSON.stringify({
                name,
                description,
                filter,
                metricDescriptor: {
                    metricKind: "DELTA",
                    valueType: "INT64",
                    unit: "1"
                }
            })
        }
    );
}

async function ensureNotificationChannel() {
    const result = await api(
        `https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/notificationChannels`
    );
    const existing = (result.notificationChannels || []).find(channel =>
        channel.type === "email" &&
        channel.labels?.email_address === ALERT_EMAIL
    );

    if (existing) return existing.name;

    const created = await api(
        `https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/notificationChannels`,
        {
            method: "POST",
            body: JSON.stringify({
                type: "email",
                displayName: "TurnoPlus security alerts",
                labels: {
                    email_address: ALERT_EMAIL
                },
                enabled: true
            })
        }
    );

    return created.name;
}

async function ensureAlertPolicy({
    displayName,
    metricName,
    notificationChannel,
    documentation
}) {
    const policies = await api(
        `https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/alertPolicies`
    );

    if ((policies.alertPolicies || []).some(policy =>
        policy.displayName === displayName
    )) {
        return;
    }

    await api(
        `https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/alertPolicies`,
        {
            method: "POST",
            body: JSON.stringify({
                displayName,
                combiner: "OR",
                enabled: true,
                notificationChannels: notificationChannel
                    ? [notificationChannel]
                    : [],
                documentation: {
                    content: documentation,
                    mimeType: "text/markdown"
                },
                alertStrategy: {
                    autoClose: "86400s"
                },
                conditions: [{
                    displayName,
                    conditionThreshold: {
                        filter:
                            `resource.type=\"cloud_run_revision\" AND metric.type=\"logging.googleapis.com/user/${metricName}\"`,
                        comparison: "COMPARISON_GT",
                        thresholdValue: 0,
                        duration: "0s",
                        aggregations: [{
                            alignmentPeriod: "300s",
                            perSeriesAligner: "ALIGN_SUM",
                            crossSeriesReducer: "REDUCE_SUM"
                        }]
                    }
                }]
            })
        }
    );
}

async function configureMonitoring() {
    await upsertLogMetric(
        "turnoplus_function_errors",
        "Errores de Cloud Run Functions de TurnoPlus.",
        [
            'resource.type="cloud_run_revision"',
            "severity>=ERROR"
        ].join("\n")
    );
    await upsertLogMetric(
        "turnoplus_invalid_appcheck",
        "Solicitudes callable con token App Check invalido.",
        [
            'resource.type="cloud_run_revision"',
            'labels."firebase-log-type"="callable-request-verification"',
            '(',
            'jsonPayload.verifications.app="INVALID"',
            "OR",
            'jsonPayload.verifications.appCheck="INVALID"',
            ')'
        ].join("\n")
    );

    const channel = await ensureNotificationChannel();

    await ensureAlertPolicy({
        displayName: "TurnoPlus - errores de Functions",
        metricName: "turnoplus_function_errors",
        notificationChannel: channel,
        documentation:
            "Se detectaron errores de severidad ERROR en Functions de TurnoPlus durante los ultimos cinco minutos."
    });
    await ensureAlertPolicy({
        displayName: "TurnoPlus - App Check invalido",
        metricName: "turnoplus_invalid_appcheck",
        notificationChannel: channel,
        documentation:
            "Se detecto al menos una solicitud callable con un token App Check invalido."
    });
}

async function configureBudget() {
    const billingInfo = await api(
        `https://cloudbilling.googleapis.com/v1/projects/${PROJECT_ID}/billingInfo`
    );

    if (!billingInfo.billingEnabled || !billingInfo.billingAccountName) {
        console.log("Budget: omitido porque el proyecto no tiene facturacion.");
        return;
    }

    const accountName = billingInfo.billingAccountName;
    const budgets = await api(
        `https://billingbudgets.googleapis.com/v1/${accountName}/budgets`
    );
    const displayName = "TurnoPlus produccion - presupuesto mensual";

    if ((budgets.budgets || []).some(budget =>
        budget.displayName === displayName
    )) {
        return;
    }

    await api(
        `https://billingbudgets.googleapis.com/v1/${accountName}/budgets`,
        {
            method: "POST",
            body: JSON.stringify({
                displayName,
                budgetFilter: {
                    projects: [`projects/${PROJECT_NUMBER}`]
                },
                amount: {
                    lastPeriodAmount: {}
                },
                thresholdRules: [
                    { thresholdPercent: 0.5 },
                    { thresholdPercent: 0.9 },
                    { thresholdPercent: 1 }
                ],
                notificationsRule: {
                    disableDefaultIamRecipients: false,
                    enableProjectLevelRecipients: true
                }
            })
        }
    );
}

async function verifyCloudHardening() {
    const [authConfig, key, policies, metrics, billingInfo] =
        await Promise.all([
        api(
            `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config`
        ),
        api(
            `https://apikeys.googleapis.com/v2/projects/${PROJECT_NUMBER}/locations/global/keys/${API_KEY_ID}`
        ),
        api(
            `https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/alertPolicies`
        ),
        api(
            `https://logging.googleapis.com/v2/projects/${PROJECT_ID}/metrics`
        ),
        api(
            `https://cloudbilling.googleapis.com/v1/projects/${PROJECT_ID}/billingInfo`
        )
    ]);
    const totpEnabled = authTotpEnabled(authConfig);
    const allowedApis = new Set(
        (key.restrictions?.apiTargets || []).map(target =>
            target.service
        )
    );
    const apiRestrictionsMatch =
        allowedApis.size === FIREBASE_API_TARGETS.length &&
        FIREBASE_API_TARGETS.every(service =>
            allowedApis.has(service)
        );
    const policyNames = new Set(
        (policies.alertPolicies || []).map(policy =>
            policy.displayName
        )
    );
    const metricNames = new Set(
        (metrics.metrics || []).map(metric => metric.name)
    );

    if (ENABLE_TOTP_HARDENING && !totpEnabled) {
        throw new Error("La configuracion TOTP no quedo activa.");
    }
    if (!ENABLE_TOTP_HARDENING && totpEnabled) {
        throw new Error(
            "TOTP esta activo, pero TURNOPLUS_ENABLE_TOTP no fue habilitado."
        );
    }
    if (!apiRestrictionsMatch) {
        throw new Error(
            "La API key no quedo limitada al allowlist Firebase esperado."
        );
    }
    if (
        !policyNames.has("TurnoPlus - errores de Functions") ||
        !policyNames.has("TurnoPlus - App Check invalido")
    ) {
        throw new Error("Faltan politicas de alertas de seguridad.");
    }
    if (
        !metricNames.has("turnoplus_function_errors") ||
        !metricNames.has("turnoplus_invalid_appcheck")
    ) {
        throw new Error("Faltan metricas basadas en logs.");
    }

    if (billingInfo.billingEnabled && billingInfo.billingAccountName) {
        const budgets = await api(
            `https://billingbudgets.googleapis.com/v1/${billingInfo.billingAccountName}/budgets`
        );

        if (!(budgets.budgets || []).some(budget =>
            budget.displayName ===
            "TurnoPlus produccion - presupuesto mensual"
        )) {
            throw new Error("Falta el presupuesto mensual de produccion.");
        }
    }
}

async function main() {
    await enableRequiredApis();
    await configureTotp(PROJECT_ID, ENABLE_TOTP_HARDENING);
    await restrictFirebaseApiKey();
    await configureMonitoring();
    await configureBudget();
    await verifyCloudHardening();
    await configureTestProjectAuthBestEffort();

    console.log(
        ENABLE_TOTP_HARDENING
            ? "Cloud hardening aplicado: TOTP, API key, alertas y presupuesto."
            : "Cloud hardening aplicado: TOTP desactivado, API key, alertas y presupuesto."
    );
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
