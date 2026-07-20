import {
    FIREBASE_APP_CHECK_SITE_KEY,
    FIREBASE_CONFIG,
    FIREBASE_ENABLED,
    FIREBASE_SDK_BASE_URL
} from "./firebaseConfig.js";

let servicesPromise = null;
let initializedServices = null;
let currentAuthUser = null;
let mfaOperationPromise = null;

function hasConfigValue(value) {
    return Boolean(String(value || "").trim());
}

function isLocalDebugHost() {
    return Boolean(
        typeof location !== "undefined" &&
        ["localhost", "127.0.0.1"].includes(location.hostname)
    );
}

async function localAppCheckDebugToken() {
    if (!isLocalDebugHost()) return "";

    const fromUrl = new URLSearchParams(location.search)
        .get("appCheckDebugToken");

    if (fromUrl) {
        try {
            localStorage.setItem(
                "turnoplus_app_check_debug_token",
                fromUrl
            );
        } catch {
            // Si localStorage no esta disponible, igual se usa el token de URL.
        }
        return fromUrl;
    }

    try {
        const stored = localStorage.getItem(
            "turnoplus_app_check_debug_token"
        );

        if (stored) return stored;
    } catch {
        // En navegadores con storage bloqueado seguimos con el archivo local.
    }

    try {
        const response = await fetch("/appcheck-debug-token.local.json", {
            cache: "no-store"
        });

        if (!response.ok) return "";

        const data = await response.json();
        const token = String(data?.token || "").trim();

        if (token) {
            try {
                localStorage.setItem(
                    "turnoplus_app_check_debug_token",
                    token
                );
            } catch {
                // No es critico: se volvera a leer del archivo local.
            }
        }

        return token;
    } catch {
        return "";
    }
}

export function isFirebaseConfigured() {
    return Boolean(
        FIREBASE_ENABLED &&
        hasConfigValue(FIREBASE_CONFIG.apiKey) &&
        hasConfigValue(FIREBASE_CONFIG.authDomain) &&
        hasConfigValue(FIREBASE_CONFIG.projectId) &&
        hasConfigValue(FIREBASE_CONFIG.appId)
    );
}

async function loadFirebaseModule(name) {
    return import(`${FIREBASE_SDK_BASE_URL}/${name}.js`);
}

export async function getFirebaseServices() {
    if (!isFirebaseConfigured()) {
        throw new Error(
            "Firebase aun no esta configurado. Revisa js/firebaseConfig.js."
        );
    }

    if (!servicesPromise) {
        servicesPromise = Promise.all([
            loadFirebaseModule("firebase-app"),
            loadFirebaseModule("firebase-app-check"),
            loadFirebaseModule("firebase-auth"),
            loadFirebaseModule("firebase-firestore"),
            loadFirebaseModule("firebase-storage"),
            loadFirebaseModule("firebase-functions")
        ]).then(async ([
            appModule,
            appCheckModule,
            authModule,
            firestoreModule,
            storageModule,
            functionsModule
        ]) => {
            const app = appModule.initializeApp(FIREBASE_CONFIG);
            let appCheck = null;

            if (hasConfigValue(FIREBASE_APP_CHECK_SITE_KEY)) {
                if (
                    isLocalDebugHost()
                ) {
                    self.FIREBASE_APPCHECK_DEBUG_TOKEN =
                        await localAppCheckDebugToken() || true;
                }

                appCheck = appCheckModule.initializeAppCheck(app, {
                    provider:
                        new appCheckModule.ReCaptchaEnterpriseProvider(
                            FIREBASE_APP_CHECK_SITE_KEY
                        ),
                    isTokenAutoRefreshEnabled: true
                });

                appCheckModule.getToken(appCheck, false).catch((error) => {
                    console.warn(
                        "Firebase App Check no pudo obtener el token inicial.",
                        error
                    );
                });
            }

            const auth = authModule.getAuth(app);
            const db = firestoreModule.getFirestore(app);
            const storage = storageModule.getStorage(app);
            const functions = functionsModule.getFunctions(
                app,
                "southamerica-west1"
            );
            const googleProvider =
                new authModule.GoogleAuthProvider();

            googleProvider.setCustomParameters({
                prompt: "select_account"
            });

            const services = {
                app,
                appCheck,
                auth,
                db,
                functions,
                storage,
                googleProvider,
                appCheckModule,
                authModule,
                firestoreModule,
                functionsModule,
                storageModule
            };

            initializedServices = services;

            return services;
        });
    }

    return servicesPromise;
}

function isPopupBlocked(error) {
    return error?.code === "auth/popup-blocked";
}

async function resolveGoogleSignInMfa(services, error) {
    const {
        auth,
        authModule
    } = services;
    const resolver =
        authModule.getMultiFactorResolver(auth, error);
    const hint = resolver.hints.find(item =>
        item.factorId ===
        authModule.TotpMultiFactorGenerator.FACTOR_ID
    );

    if (!hint) {
        throw new Error(
            "Tu cuenta exige un segundo factor no compatible. Contacta al propietario del sistema."
        );
    }

    const code = await promptTotpCode({
        title: "Verificacion en dos pasos",
        message:
            "Ingresa el codigo de seis digitos de tu aplicacion autenticadora.",
        confirmText: "Verificar"
    });
    const assertion =
        authModule.TotpMultiFactorGenerator
            .assertionForSignIn(hint.uid, code);

    return resolver.resolveSignIn(assertion);
}

async function signInWithGoogleRedirect(services = initializedServices) {
    const resolvedServices = services || await getFirebaseServices();
    const {
        auth,
        authModule,
        googleProvider
    } = resolvedServices;

    await authModule.signInWithRedirect(auth, googleProvider);

    return {
        redirected: true,
        user: null
    };
}

async function handleGoogleSignInError(services, error) {
    if (isPopupBlocked(error)) {
        return signInWithGoogleRedirect(services);
    }

    if (error?.code === "auth/multi-factor-auth-required") {
        return resolveGoogleSignInMfa(services, error);
    }

    throw error;
}

export function signInWithGoogle() {
    const services = initializedServices;

    if (!services) {
        return signInWithGoogleRedirect();
    }

    const {
        auth,
        authModule,
        googleProvider
    } = services;

    try {
        return authModule
            .signInWithPopup(auth, googleProvider)
            .catch(error => handleGoogleSignInError(services, error));
    } catch (error) {
        return handleGoogleSignInError(services, error);
    }
}

export async function signOutFirebase() {
    const { auth, authModule } = await getFirebaseServices();

    return authModule.signOut(auth);
}

export function getCurrentFirebaseUser() {
    return currentAuthUser;
}

export async function isFirebaseSessionMfaVerified(
    user = getCurrentFirebaseUser()
) {
    if (!user) return false;

    const tokenResult = await user.getIdTokenResult();

    return Boolean(
        tokenResult.claims?.firebase?.sign_in_second_factor
    );
}

export async function ensureFirebaseTotpEnrollment(options = {}) {
    if (mfaOperationPromise) return mfaOperationPromise;

    mfaOperationPromise = ensureFirebaseTotpEnrollmentInternal(options)
        .finally(() => {
            mfaOperationPromise = null;
        });

    return mfaOperationPromise;
}

async function ensureFirebaseTotpEnrollmentInternal(options = {}) {
    const {
        authModule,
        googleProvider
    } = await getFirebaseServices();
    const user = getCurrentFirebaseUser();

    if (!user) {
        throw new Error(
            "Debes iniciar sesion antes de configurar la verificacion en dos pasos."
        );
    }

    if (!user.emailVerified) {
        throw new Error(
            "Debes verificar tu correo antes de activar la verificacion en dos pasos."
        );
    }

    if (await isFirebaseSessionMfaVerified(user)) {
        return true;
    }

    const multiFactorUser = authModule.multiFactor(user);
    const totpFactor = multiFactorUser.enrolledFactors.find(factor =>
        factor.factorId ===
        authModule.TotpMultiFactorGenerator.FACTOR_ID
    );

    if (totpFactor) {
        await signOutFirebase();
        throw new Error(
            "Tu cuenta ya tiene TOTP configurado. Inicia sesion nuevamente para validar el segundo factor."
        );
    }

    let session;

    try {
        session = await multiFactorUser.getSession();
    } catch (error) {
        if (error?.code !== "auth/requires-recent-login") {
            throw error;
        }

        await authModule.reauthenticateWithPopup(
            user,
            googleProvider
        );
        session = await multiFactorUser.getSession();
    }

    const secret =
        await authModule.TotpMultiFactorGenerator
            .generateSecret(session);
    const code = await promptTotpEnrollment({
        secret: secret.secretKey,
        uri: secret.generateQrCodeUrl(
            user.email || user.uid,
            "TurnoPlus"
        ),
        reason:
            options.reason ||
            "Los propietarios y supervisores deben proteger su cuenta con una aplicacion autenticadora."
    });
    const assertion =
        authModule.TotpMultiFactorGenerator
            .assertionForEnrollment(secret, code);

    await multiFactorUser.enroll(
        assertion,
        "TurnoPlus TOTP"
    );
    await user.getIdToken(true);

    if (!await isFirebaseSessionMfaVerified(user)) {
        throw new Error(
            "TOTP se configuro, pero la sesion debe renovarse. Cierra sesion e ingresa nuevamente."
        );
    }

    return true;
}

function createMfaDialog({ title, message, confirmText }) {
    const backdrop = document.createElement("div");

    backdrop.className = "turn-change-dialog-backdrop firebase-mfa-backdrop";
    backdrop.innerHTML = `
        <form class="turn-change-dialog firebase-mfa-dialog" role="dialog" aria-modal="true">
            <header>
                <span class="firebase-mfa-shield" aria-hidden="true">✓</span>
                <div>
                    <h3></h3>
                    <p></p>
                </div>
            </header>
            <div class="firebase-mfa-content"></div>
            <div class="firebase-mfa-actions">
                <button class="secondary-button" type="button" data-mfa-cancel>Salir</button>
                <button class="primary-button" type="submit"></button>
            </div>
        </form>
    `;
    backdrop.querySelector("h3").textContent = title;
    backdrop.querySelector("header p").textContent = message;
    backdrop.querySelector('[type="submit"]').textContent = confirmText;
    document.body.appendChild(backdrop);

    return {
        backdrop,
        form: backdrop.querySelector("form"),
        content: backdrop.querySelector(".firebase-mfa-content"),
        cancel: backdrop.querySelector("[data-mfa-cancel]")
    };
}

function promptTotpCode({
    title,
    message,
    confirmText
}) {
    return new Promise((resolve, reject) => {
        const dialog = createMfaDialog({
            title,
            message,
            confirmText
        });

        dialog.content.innerHTML = `
            <label>
                <span>Codigo TOTP</span>
                <input inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required>
            </label>
            <small>
                Si perdiste el autenticador, solicita al administrador del proyecto
                que reinicie el segundo factor de tu cuenta.
            </small>
            <small data-mfa-error></small>
        `;
        const input = dialog.content.querySelector("input");
        const errorBox =
            dialog.content.querySelector("[data-mfa-error]");

        dialog.form.onsubmit = event => {
            event.preventDefault();
            const code = input.value.replace(/\D/g, "");

            if (code.length !== 6) {
                errorBox.textContent =
                    "Ingresa los seis digitos del autenticador.";
                input.focus();
                return;
            }

            dialog.backdrop.remove();
            resolve(code);
        };
        dialog.cancel.onclick = () => {
            dialog.backdrop.remove();
            reject(new Error(
                "La verificacion en dos pasos es obligatoria para continuar."
            ));
        };
        input.focus();
    });
}

function promptTotpEnrollment({ secret, uri, reason }) {
    return new Promise((resolve, reject) => {
        const dialog = createMfaDialog({
            title: "Protege tu cuenta",
            message: reason,
            confirmText: "Activar TOTP"
        });

        dialog.content.innerHTML = `
            <div class="firebase-mfa-step">
                <strong>1. Agrega la cuenta en Google Authenticator, Microsoft Authenticator, 1Password u otra aplicacion TOTP.</strong>
                <p>
                    Guarda esta clave en un gestor de contraseñas seguro. Es tu
                    respaldo para recuperar el autenticador en otro dispositivo.
                </p>
                <label>
                    <span>Clave de configuracion</span>
                    <div class="firebase-mfa-secret-row">
                        <input data-mfa-secret readonly>
                        <button class="secondary-button" type="button" data-mfa-copy>Copiar</button>
                    </div>
                </label>
                <details>
                    <summary>Configuracion avanzada</summary>
                    <textarea data-mfa-uri readonly rows="3"></textarea>
                </details>
            </div>
            <div class="firebase-mfa-step">
                <strong>2. Ingresa el codigo generado.</strong>
                <label>
                    <span>Codigo de seis digitos</span>
                    <input data-mfa-code inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required>
                </label>
                <small data-mfa-error></small>
            </div>
        `;

        const secretInput =
            dialog.content.querySelector("[data-mfa-secret]");
        const uriInput =
            dialog.content.querySelector("[data-mfa-uri]");
        const codeInput =
            dialog.content.querySelector("[data-mfa-code]");
        const errorBox =
            dialog.content.querySelector("[data-mfa-error]");

        secretInput.value = secret;
        uriInput.value = uri;
        dialog.content
            .querySelector("[data-mfa-copy]")
            .onclick = async event => {
                await navigator.clipboard.writeText(secret);
                event.currentTarget.textContent = "Copiada";
            };
        dialog.form.onsubmit = event => {
            event.preventDefault();
            const code = codeInput.value.replace(/\D/g, "");

            if (code.length !== 6) {
                errorBox.textContent =
                    "Ingresa los seis digitos del autenticador.";
                codeInput.focus();
                return;
            }

            dialog.backdrop.remove();
            resolve(code);
        };
        dialog.cancel.onclick = () => {
            dialog.backdrop.remove();
            reject(new Error(
                "TOTP es obligatorio para propietarios y supervisores. Si perdiste el acceso, solicita al administrador del proyecto reiniciar tu segundo factor."
            ));
        };
        codeInput.focus();
    });
}

export async function onFirebaseAuthChanged(callback) {
    if (!isFirebaseConfigured()) {
        currentAuthUser = null;
        callback(null);
        return () => {};
    }

    const { auth, authModule } = await getFirebaseServices();

    return authModule.onAuthStateChanged(auth, user => {
        currentAuthUser = user || null;
        callback(user);
    });
}
