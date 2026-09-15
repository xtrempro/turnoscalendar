// Aviso en pantalla del estado de la sincronización.
//
// Hasta el 2026-09-09 un fallo de sincronización solo se veía en la consola, y
// por eso estuvo dos días activo sin que nadie lo notara: la app seguía pintando
// su copia local y publicando encima de la del servidor.
//
// Son DOS situaciones distintas y no conviene confundirlas:
//
//   BLOQUEADO  no se pudo leer el estado al arrancar. La publicación queda
//              cerrada (ver `waitingInitialState` en js/firebaseAppState.js)
//              porque la copia local puede ser vieja y pisaría la del servidor.
//              Es la peligrosa, y se avisa al tiro.
//
//   OFFLINE    se estaba sincronizando y se cayó la conexión. Aquí NO se
//              bloquea nada: Firestore encola las escrituras y las manda al
//              reconectar, en orden. Es informativo, y el aviso lo dice.
//
// Se monta solo al importarse y no necesita hueco en el HTML.

const BANNER_ID = "sync-blocked-banner";

const MENSAJE_OFFLINE =
    "Sin conexion: tus cambios se guardan y se enviaran solos al reconectar.";

// Un corte de pocos segundos no merece aviso: Firestore reconecta solo y las
// escrituras ya van encoladas. Hasta el 2026-09-14 el aviso salía en cada
// microcorte (el canal de Firestore que se reabre, el wifi que se reengancha,
// una pestaña que vuelve del segundo plano) y se leía como "se cae todo el
// rato". Solo se muestra si la caída dura esto SIN interrupción.
export const ESPERA_AVISO_SIN_CONEXION_MS = 30 * 1000;

let banner = null;
let bloqueado = "";
// Dos fuentes, y cada una se levanta por su lado: que el navegador vea red no
// prueba que el servidor responda, pero datos confirmados por el servidor sí
// prueban que hay red.
let navegadorSinRed = false;
let servidorSinRespuesta = false;
let esperaCaida = null;
let caidaConfirmada = false;

function ensureBanner() {
    if (banner?.isConnected) return banner;

    banner = document.getElementById(BANNER_ID);

    if (banner) return banner;

    banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.className = "sync-blocked-banner";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    banner.hidden = true;
    document.body.append(banner);

    return banner;
}

function hayCaida() {
    return navegadorSinRed || servidorSinRespuesta;
}

// El reloj corre desde la primera señal y NO se reinicia cuando la otra fuente
// se suma, ni cuando una se levanta mientras la otra sigue caída: lo que se
// mide es cuánto lleva sin conexión, de corrido. La vuelta sí es inmediata.
function vigilarCaida() {
    if (!hayCaida()) {
        clearTimeout(esperaCaida);
        esperaCaida = null;
        caidaConfirmada = false;
        return;
    }

    if (caidaConfirmada || esperaCaida) return;

    esperaCaida = setTimeout(() => {
        esperaCaida = null;
        caidaConfirmada = hayCaida();
        render();
    }, ESPERA_AVISO_SIN_CONEXION_MS);
}

// El bloqueo manda sobre la falta de conexión: si además no se puede publicar,
// eso es lo que hay que decir.
function render() {
    const node = ensureBanner();

    if (bloqueado) {
        node.textContent = bloqueado;
        node.className = "sync-blocked-banner is-blocked";
        node.hidden = false;
        return;
    }

    if (caidaConfirmada) {
        node.textContent = MENSAJE_OFFLINE;
        node.className = "sync-blocked-banner is-offline";
        node.hidden = false;
        return;
    }

    node.hidden = true;
}

export function handleSyncStatus(detail) {
    const tipo = detail?.type;

    if (tipo === "app-state-blocked") {
        bloqueado =
            detail.message ||
            "Sin sincronizacion con el servidor: tus cambios quedan en espera.";
        render();
        return;
    }

    if (tipo === "app-state-offline") {
        servidorSinRespuesta = true;
        vigilarCaida();
        render();
        return;
    }

    // Solo el servidor levanta su caída. Aplicar estado NO sirve para esto:
    // estando offline se aplican datos de la caché igual, y eso borraría el
    // aviso justo cuando hace falta.
    if (tipo === "app-state-online") {
        servidorSinRespuesta = false;
        navegadorSinRed = false;
        vigilarCaida();
        render();
        return;
    }

    // El bloqueo sí se levanta al aplicar el estado inicial: es exactamente la
    // condición que abre la compuerta de publicación.
    if (tipo === "app-state-applied" || tipo === "app-state-entries-applied") {
        bloqueado = "";
        render();
    }
}

/**
 * El navegador sabe de la caída antes que Firestore, pero también pierde la
 * red unos segundos cada vez que el wifi se reengancha: pasa por la misma
 * espera. Su vuelta no da por vuelto al servidor.
 */
export function handleBrowserConnectivity(online) {
    navegadorSinRed = !online;
    vigilarCaida();
    render();
}

if (typeof window !== "undefined") {
    window.addEventListener("proturnos:firebaseAppState", event => {
        handleSyncStatus(event.detail);
    });
    window.addEventListener("offline", () => handleBrowserConnectivity(false));
    window.addEventListener("online", () => handleBrowserConnectivity(true));
}
