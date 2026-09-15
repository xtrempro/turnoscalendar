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

// Barra de carga que no deja editar: copia local de mas de un dia, o varios
// cambios del servidor que esta copia no tenia (ver js/syncFreshness.js).
const LOCK_ID = "sync-lock-overlay";
const LOCK_RELOAD_AFTER_MS = 20 * 1000;
const LOCK_COPY = {
    stale: {
        title: "Trayendo la última versión del servidor",
        text: "Este computador llevaba más de un día sin sincronizar. Para no editar sobre datos viejos, espera a que termine de cargar."
    },
    discrepancy: {
        title: "Actualizando datos",
        text: "Llegaron del servidor varios cambios que este computador no tenía. Espera un momento mientras se aplican."
    }
};

let banner = null;
let bloqueado = "";
let lockReason = "";
let lockNode = null;
let lockTitle = null;
let lockText = null;
let lockReload = null;
let lockReloadTimer = null;
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

function ensureLockNode() {
    if (lockNode?.isConnected) return lockNode;

    lockNode = document.createElement("div");
    lockNode.id = LOCK_ID;
    lockNode.className = "sync-lock-overlay";
    lockNode.setAttribute("role", "alertdialog");
    lockNode.setAttribute("aria-modal", "true");
    lockNode.setAttribute("aria-busy", "true");
    lockNode.hidden = true;

    const card = document.createElement("div");
    const bar = document.createElement("div");

    card.className = "sync-lock-card";
    bar.className = "sync-lock-bar";
    bar.appendChild(document.createElement("span"));
    lockTitle = document.createElement("strong");
    lockText = document.createElement("p");
    lockReload = document.createElement("button");
    lockReload.type = "button";
    lockReload.className = "secondary-button sync-lock-reload";
    lockReload.textContent = "Recargar";
    lockReload.hidden = true;
    lockReload.addEventListener("click", () => window.location.reload());
    card.append(lockTitle, lockText, bar, lockReload);
    lockNode.appendChild(card);
    document.body.append(lockNode);

    return lockNode;
}

function refreshLockText() {
    if (!lockReason || !lockText) return;

    const copy = LOCK_COPY[lockReason] || LOCK_COPY.discrepancy;

    lockTitle.textContent = copy.title;
    lockText.textContent = hayCaida()
        ? `${copy.text} Sin conexión: conéctate a internet para continuar.`
        : copy.text;
}

function renderLock() {
    const node = ensureLockNode();

    clearTimeout(lockReloadTimer);
    lockReloadTimer = null;

    if (!lockReason) {
        node.hidden = true;
        lockReload.hidden = true;
        return;
    }

    refreshLockText();
    node.hidden = false;
    lockReload.hidden = true;
    // Si no se suelta sola, que haya una salida visible.
    lockReloadTimer = setTimeout(() => {
        if (lockReason) lockReload.hidden = false;
    }, LOCK_RELOAD_AFTER_MS);
}

/** Con la barra puesta no se escribe: solo recargar sigue funcionando. */
export function shouldBlockKey(event, locked = Boolean(lockReason)) {
    if (!locked || !event) return false;
    if (event.key === "F5") return false;
    if (
        (event.ctrlKey || event.metaKey) &&
        String(event.key || "").toLowerCase() === "r"
    ) return false;
    if (
        lockNode &&
        event.target &&
        typeof lockNode.contains === "function" &&
        lockNode.contains(event.target)
    ) return false;

    return true;
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

    refreshLockText();

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

    if (tipo === "app-state-lock") {
        lockReason = detail.reason || "discrepancy";
        renderLock();
        return;
    }

    if (tipo === "app-state-unlock") {
        lockReason = "";
        renderLock();
        return;
    }

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
    document.addEventListener("keydown", event => {
        if (!shouldBlockKey(event)) return;

        event.preventDefault();
        event.stopPropagation();
    }, true);
}
