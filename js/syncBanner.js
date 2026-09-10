// Aviso en pantalla cuando la sesión no está sincronizando con el servidor.
//
// Hasta el 2026-09-09 ese fallo solo se veía en la consola del navegador, y por
// eso estuvo dos días activo sin que nadie lo notara: la app seguía pintando su
// copia local y publicando encima de la del servidor. Ahora la publicación
// queda bloqueada mientras no se pueda leer (ver `waitingInitialState` en
// js/firebaseAppState.js), y esto le pone cara a esa espera.
//
// Se monta solo al importarse y no necesita hueco en el HTML: si hiciera falta
// tocar la plantilla, sería una razón más para que no se pusiera.

const BANNER_ID = "sync-blocked-banner";

let banner = null;

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

function show(message) {
    const node = ensureBanner();

    node.textContent = message;
    node.hidden = false;
}

function hide() {
    if (!banner?.isConnected) return;

    banner.hidden = true;
}

export function handleSyncStatus(detail) {
    if (detail?.type === "app-state-blocked") {
        show(
            detail.message ||
            "Sin sincronizacion con el servidor: tus cambios quedan en espera."
        );
        return;
    }

    // Cualquier señal de que el estado remoto SÍ está llegando retira el aviso.
    if (
        detail?.type === "app-state-applied" ||
        detail?.type === "app-state-entries-applied"
    ) {
        hide();
    }
}

if (typeof window !== "undefined") {
    window.addEventListener("proturnos:firebaseAppState", event => {
        handleSyncStatus(event.detail);
    });
}
