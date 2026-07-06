import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const PROJECT_ID = "turnoplus-test-7c4d9";
const BUCKET_LOCATION = "SOUTHAMERICA-WEST1";
const APPLY_STORAGE = process.argv.includes("--apply-storage");
const ENABLE_TOTP = process.argv.includes("--enable-totp");
const DISABLE_TOTP = process.argv.includes("--disable-totp");

if (ENABLE_TOTP && DISABLE_TOTP) {
    throw new Error("No se puede habilitar y deshabilitar TOTP a la vez.");
}

function firebaseToolsModule(relativePath) {
    const npmRoot = process.platform === "win32"
        ? path.join(process.env.APPDATA, "npm", "node_modules")
        : execFileSync("npm", ["root", "-g"], {
            encoding: "utf8"
        }).trim();

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

    return (await auth.getAccessToken(
        account.tokens.refresh_token,
        []
    )).access_token;
}

async function api(url, options = {}, allowedStatuses = []) {
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${await accessToken()}`,
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

    return { body, status: response.status };
}

async function ensureStorage() {
    const billing = await api(
        `https://cloudbilling.googleapis.com/v1/projects/${PROJECT_ID}/billingInfo`
    );

    if (
        billing.body.billingEnabled !== true ||
        !billing.body.billingAccountName
    ) {
        throw new Error(
            "TurnoPlus Test necesita facturacion Blaze antes de crear Storage."
        );
    }

    let bucket = await api(
        `https://firebasestorage.googleapis.com/v1alpha/projects/${PROJECT_ID}/defaultBucket`,
        {},
        [404]
    );

    if (bucket.status === 404) {
        if (!APPLY_STORAGE) {
            throw new Error(
                "Storage Test no existe. Ejecuta con --apply-storage."
            );
        }

        bucket = await api(
            `https://firebasestorage.googleapis.com/v1alpha/projects/${PROJECT_ID}/defaultBucket`,
            {
                method: "POST",
                body: JSON.stringify({ location: BUCKET_LOCATION })
            }
        );
    }

    if (bucket.body.location !== BUCKET_LOCATION) {
        throw new Error(
            `Storage Test esta en ${bucket.body.location || "una region desconocida"}; ` +
            `se esperaba ${BUCKET_LOCATION}.`
        );
    }

    return bucket.body;
}

function totpEnabled(config) {
    return config.mfa?.state === "ENABLED" &&
        config.mfa?.providerConfigs?.some(provider =>
            provider.state === "ENABLED" &&
            provider.totpProviderConfig
        );
}

async function ensureTotp() {
    const url =
        "https://identitytoolkit.googleapis.com/admin/v2/" +
        `projects/${PROJECT_ID}/config`;
    let config = (await api(url)).body;

    if (!totpEnabled(config) && ENABLE_TOTP) {
        config = (await api(`${url}?updateMask=mfa`, {
            method: "PATCH",
            body: JSON.stringify({
                mfa: {
                    state: "ENABLED",
                    providerConfigs: [{
                        state: "ENABLED",
                        totpProviderConfig: {
                            adjacentIntervals: 2
                        }
                    }]
                }
            })
        })).body;
    }

    if (totpEnabled(config) && DISABLE_TOTP) {
        config = (await api(`${url}?updateMask=mfa`, {
            method: "PATCH",
            body: JSON.stringify({
                mfa: {
                    state: "DISABLED",
                    providerConfigs: [{
                        state: "DISABLED",
                        totpProviderConfig: {
                            adjacentIntervals: 2
                        }
                    }]
                }
            })
        })).body;
    }

    if (ENABLE_TOTP && !totpEnabled(config)) {
        throw new Error("Firebase Auth no confirmo la activacion de TOTP.");
    }
    if (DISABLE_TOTP && totpEnabled(config)) {
        throw new Error("Firebase Auth no confirmo la desactivacion de TOTP.");
    }

    return totpEnabled(config);
}

const bucket = await ensureStorage();
const isTotpEnabled = await ensureTotp();

console.log("Seguridad de TurnoPlus Test verificada.");
console.log(`Storage: ${bucket.bucket?.name || bucket.name}`);
console.log(`Region: ${bucket.location}`);
console.log(`TOTP: ${isTotpEnabled ? "ENABLED" : "DISABLED"}`);
