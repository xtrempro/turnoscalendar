// Firebase queda apagado por defecto para no romper el modo local.
// Cuando tengas tu proyecto Firebase, cambia FIREBASE_ENABLED a true
// y pega aqui la configuracion que entrega la consola de Firebase.
export const FIREBASE_ENABLED = true;

export const FIREBASE_SDK_BASE_URL =
    "https://www.gstatic.com/firebasejs/12.15.0";

const PRODUCTION_APP_CHECK_SITE_KEY =
    "6Lff2zMtAAAAALE9w8AfJOfrWuoPy_35_aNwnh_8";
const TEST_APP_CHECK_SITE_KEY =
    "6LdZgEctAAAAAGMCUugxmTLm3bfspq8OzqI5xs9M";

const PRODUCTION_CONFIG = {
    apiKey: "AIzaSyCG7KarKpMMGzTHIXnRit9E2CGpGgjf6_k",
    authDomain: "calendarioturnos-7c4d9.firebaseapp.com",
    projectId: "calendarioturnos-7c4d9",
    storageBucket: "calendarioturnos-7c4d9.firebasestorage.app",
    messagingSenderId: "1034511206564",
    appId: "1:1034511206564:web:d57211f4cb4c5446a1fe31",
    measurementId: "G-XRVDMRZZ43"
};

const TEST_CONFIG = {
    apiKey: "AIzaSyCb8aig1wauxVFrDPKgOpwJOVH6KBcGmyk",
    authDomain: "turnoplus-test-7c4d9.firebaseapp.com",
    projectId: "turnoplus-test-7c4d9",
    storageBucket: "turnoplus-test-7c4d9.firebasestorage.app",
    messagingSenderId: "596177989812",
    appId: "1:596177989812:web:6e1e5a1e194dac99fbe7e1"
};

const TEST_HOSTS = new Set([
    "turnoplus-test-7c4d9.web.app",
    "turnoplus-test-7c4d9.firebaseapp.com"
]);
const useTestProject =
    typeof location !== "undefined" &&
    TEST_HOSTS.has(location.hostname);

// TOTP queda implementado, pero apagado durante la etapa comercial inicial.
// Solo debe activarse cuando un centro lo solicite o pase a ser requisito.
export const FIREBASE_REQUIRE_PRIVILEGED_MFA = false;

// Verdadero solo en el sitio de pruebas (turnoplus-test-7c4d9). Se usa para
// exponer utilidades de diagnostico (auto-pruebas) que no deben aparecer en
// produccion.
export const IS_TEST_ENVIRONMENT = useTestProject;

export const FIREBASE_APP_CHECK_SITE_KEY = useTestProject
    ? TEST_APP_CHECK_SITE_KEY
    : PRODUCTION_APP_CHECK_SITE_KEY;

export const FIREBASE_CONFIG = useTestProject
    ? TEST_CONFIG
    : PRODUCTION_CONFIG;
