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
//              Es la peligrosa.
//
//   OFFLINE    se estaba sincronizando y se cayó la conexión. Aquí NO se
//              bloquea nada: Firestore encola las escrituras y las manda al
//              reconectar, en orden. Es informativo, y el aviso lo dice.
//
// Se monta solo al importarse y no necesita hueco en el HTML.

const BANNER_ID = "sync-blocked-banner";

const MENSAJE_OFFLINE =
    "Sin conexion: tus cambios se guardan y se enviaran solos al reconectar.";

let banner = null;
let bloqueado = "";
let sinConexion = false;

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

    if (sinConexion) {
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
        sinConexion = true;
        render();
        return;
    }

    // Solo el servidor levanta la caída. Aplicar estado NO sirve para esto:
    // estando offline se aplican datos de la caché igual, y eso borraría el
    // aviso justo cuando hace falta.
    if (tipo === "app-state-online") {
        sinConexion = false;
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

/** El navegador sabe de la caída antes que Firestore: se usa como aviso rápido. */
export function handleBrowserConnectivity(online) {
    sinConexion = !online;
    render();
}

if (typeof window !== "undefined") {
    window.addEventListener("proturnos:firebaseAppState", event => {
        handleSyncStatus(event.detail);
    });
    window.addEventListener("offline", () => handleBrowserConnectivity(false));
    window.addEventListener("online", () => handleBrowserConnectivity(true));
}
