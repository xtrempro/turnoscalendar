// Campanita de notificaciones del supervisor. Reutiliza el evento
// `proturnos:workerRequestsChanged` (que ya dispara el listener dedicado de
// solicitudes en tiempo real, firebaseWorkerRequests.js) para NO abrir listeners
// nuevos de Firestore: al llegar una solicitud del trabajador (permiso, cambio de
// turno o incidencia de marcaje) se actualiza el badge y, si es una solicitud
// nueva, se disparan alertas sonoras + vibracion en el celular del supervisor.

import { getReplacementRequests, getWorkerRequests } from "./storage.js";
import { getJSON, setJSON } from "./persistence.js";

// Avisos que NO son solicitudes: nadie tiene que responderlos, solo enterarse.
// Hoy los usa el traspaso que la otra unidad acepto, donde el perfil ya se creo
// solo y no queda nada por hacer -pero quien lo pidio tiene que saberlo-.
//
// Viajan en el estado de la unidad y no en el navegador porque el traspaso lo
// aplica UNA sesion: si el aviso quedara local, los demas supervisores de esa
// unidad no se enterarian nunca.
const NOTICES_KEY = "bellNotices";
const MAX_NOTICES = 20;

// Que coberturas aceptadas ya se avisaron. Tiene que PERSISTIR: si solo viviera
// en memoria, una aceptacion ocurrida con el navegador cerrado se daria por
// vista al abrir -el arranque marca como conocidas las que ya estan- y el
// supervisor no se enteraria nunca de la que mas importa, la que paso mientras
// no miraba.
const SEEN_COVERS_KEY = "bellSeenCovers";

// Se alertan solo las solicitudes ORIGINADAS por el trabajador: permiso (leave),
// cambio de turno (swap) e incidencia de marcaje (missing_clock / clock_incident).
const WORKER_ORIGIN_TYPES = new Set([
    "swap",
    "missing_clock",
    "clock_incident"
]);

// Al abrir la app hay una ventana de "hidratacion" en la que el sync inicial trae
// las solicitudes ya existentes: durante ese lapso se actualiza el badge pero NO
// se alerta, para no sonar por solicitudes viejas al entrar.
const HYDRATION_GRACE_MS = 4000;
const REFRESH_DEBOUNCE_MS = 120;

let bellButton = null;
let bellBadge = null;
let bellPanel = null;
let bellPanelList = null;
let onOpenRequests = () => {};
let knownPendingIds = new Set();
// Las coberturas que ya estaban aceptadas al abrir. Sin esto, entrar a la
// unidad generaria un aviso por cada turno aceptado hace semanas.
let knownAcceptedCoverIds = new Set();
let alertsReadyAt = Infinity;
let audioContext = null;
let refreshTimer = null;
let initialized = false;

function pendingRequestId(request) {
    return String(request?.id || request?.createdAt || "").trim();
}

function isWorkerLeaveRequest(request) {
    const type = String(request?.type || "").trim();

    // Un permiso puede no traer type (o traer el tipo de permiso): cuenta como
    // solicitud del trabajador salvo los tipos administrativos entre unidades.
    return WORKER_ORIGIN_TYPES.has(type) || Boolean(request?.profile);
}

// Solicitudes pendientes del trabajador (permiso / cambio de turno / marcaje).
export function pendingWorkerRequests(requests = getWorkerRequests()) {
    return (Array.isArray(requests) ? requests : []).filter(request =>
        request?.status === "pending" && isWorkerLeaveRequest(request)
    );
}

export function getBellNotices() {
    const lista = getJSON(NOTICES_KEY, []);

    return Array.isArray(lista) ? lista : [];
}

// El id evita repetir el mismo aviso: la transferencia se aplica una vez, pero
// el oyente puede volver a dispararse antes de que el estado se asiente.
function pushNotice({ id, title, detail = "" }) {
    const clave = String(id || "").trim();

    if (!clave) return false;

    const previos = getBellNotices();

    if (previos.some(item => item?.id === clave)) return false;

    setJSON(NOTICES_KEY, [
        {
            id: clave,
            title: String(title || ""),
            detail: String(detail || ""),
            createdAt: new Date().toISOString()
        },
        ...previos
    ].slice(0, MAX_NOTICES));

    return true;
}

export function addBellNotice(notice) {
    // El refresco va aparte de guardar: los avisos que nacen DENTRO del propio
    // refresco lo llaman sin el, o se llamarian a si mismos sin parar.
    if (pushNotice(notice)) scheduleRefresh();
}

/**
 * Saca un aviso que dejo de ser cierto.
 *
 * Un aviso de la campanita manda a hacer algo. Si eso ya no esta -el pedido lo
 * retiraron, la solicitud la resolvio otro supervisor-, dejarlo puesto manda a
 * buscar algo que no existe.
 */
export function removeBellNotice(id) {
    const clave = String(id || "").trim();

    if (!clave) return false;

    const previos = getBellNotices();
    const quedan = previos.filter(item => item?.id !== clave);

    if (quedan.length === previos.length) return false;

    setJSON(NOTICES_KEY, quedan);
    scheduleRefresh();

    return true;
}

export function clearBellNotices() {
    if (!getBellNotices().length) return;

    setJSON(NOTICES_KEY, []);
    scheduleRefresh();
}

// Un trabajador acepto cubrir un turno desde su app.
//
// No hay nada que responder -el turno ya quedo tomado-, pero el supervisor
// tiene que enterarse: es la diferencia entre dar un turno por cubierto y
// creer que sigue descubierto.
function acceptedCoverRequests() {
    const lista = getReplacementRequests();

    return (Array.isArray(lista) ? lista : [])
        .filter(request => request?.status === "accepted");
}

function coverRequestId(request) {
    return String(request?.id || "").trim();
}

function coverDateLabel(value) {
    const texto = String(value || "");
    const partes = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);

    return partes ? `${partes[3]}-${partes[2]}-${partes[1]}` : "";
}

// La primera vez no hay nada guardado: ahi se siembra con lo que ya existe,
// para no soltar un aviso por cada turno cubierto en la historia de la unidad.
// De ahi en adelante, lo que no este en la lista es noticia, haya pasado con la
// aplicacion abierta o cerrada.
function loadSeenCoverIds() {
    const guardado = getJSON(SEEN_COVERS_KEY, null);

    if (!Array.isArray(guardado)) {
        const actuales = acceptedCoverRequests()
            .map(coverRequestId)
            .filter(Boolean);

        setJSON(SEEN_COVERS_KEY, actuales);

        return new Set(actuales);
    }

    return new Set(guardado.map(String).filter(Boolean));
}

function noticeAcceptedCovers() {
    const actuales = acceptedCoverRequests();

    for (const request of actuales) {
        const id = coverRequestId(request);

        if (!id || knownAcceptedCoverIds.has(id)) continue;

        const quien = String(request.worker || "").trim() || "Un trabajador";
        const cuando = coverDateLabel(request.date);

        pushNotice({
            id: `cobertura:${id}`,
            title: `${quien} aceptó cubrir un turno`,
            detail: cuando ? `Turno del ${cuando}.` : ""
        });
    }

    const vistas = actuales.map(coverRequestId).filter(Boolean);

    knownAcceptedCoverIds = new Set(vistas);
    setJSON(SEEN_COVERS_KEY, vistas);
}

export function pendingRequestIds(requests) {
    return new Set(
        pendingWorkerRequests(requests)
            .map(pendingRequestId)
            .filter(Boolean)
    );
}

// Hay solicitud nueva si aparece un id pendiente que no estaba antes.
export function hasNewPendingRequest(previousIds, currentIds) {
    const previous = previousIds instanceof Set
        ? previousIds
        : new Set(previousIds || []);

    for (const id of currentIds) {
        if (id && !previous.has(id)) return true;
    }

    return false;
}

// El recuadro de avisos. Antes la campanita llevaba derecho a Solicitudes, que
// para un aviso no sirve: no hay nada que resolver ahi, y el aviso desaparecia
// sin haberse leido. Ahora muestra lo que paso y se marca leido a mano.
function noticeTimeLabel(value) {
    const fecha = new Date(String(value || ""));

    if (Number.isNaN(fecha.getTime())) return "";

    const hoy = new Date();
    const mismoDia =
        fecha.getDate() === hoy.getDate() &&
        fecha.getMonth() === hoy.getMonth() &&
        fecha.getFullYear() === hoy.getFullYear();
    const hora = fecha.toLocaleTimeString("es-CL", {
        hour: "2-digit",
        minute: "2-digit"
    });

    if (mismoDia) return hora;

    const dia = fecha.toLocaleDateString("es-CL", {
        day: "2-digit",
        month: "2-digit"
    });

    return `${dia} ${hora}`;
}

function ensureBellPanel() {
    if (bellPanel) return bellPanel;

    bellPanel = document.createElement("div");
    bellPanel.className = "bell-panel";
    bellPanel.id = "notificationsBellPanel";
    bellPanel.hidden = true;
    bellPanel.setAttribute("role", "dialog");
    bellPanel.setAttribute("aria-label", "Avisos");

    const head = document.createElement("header");
    const titulo = document.createElement("strong");
    const leidas = document.createElement("button");

    head.className = "bell-panel__head";
    titulo.textContent = "Avisos";
    leidas.type = "button";
    leidas.className = "bell-panel__action";
    leidas.textContent = "Marcar leídas";
    leidas.addEventListener("click", () => {
        clearBellNotices();
        renderBellPanel();
    });
    head.append(titulo, leidas);

    bellPanelList = document.createElement("div");
    bellPanelList.className = "bell-panel__list";

    const foot = document.createElement("footer");
    const verSolicitudes = document.createElement("button");

    foot.className = "bell-panel__foot";
    verSolicitudes.type = "button";
    verSolicitudes.className = "bell-panel__requests";
    verSolicitudes.textContent = "Ver solicitudes";
    verSolicitudes.addEventListener("click", () => {
        closeBellPanel();
        onOpenRequests();
    });
    foot.append(verSolicitudes);

    bellPanel.append(head, bellPanelList, foot);
    // Colgado del body y posicionado a mano: asi no depende de que la barra
    // superior tenga un contenedor posicionado, que hoy no tiene.
    document.body.appendChild(bellPanel);

    return bellPanel;
}

function placeBellPanel() {
    if (!bellPanel || !bellButton) return;

    const rect = bellButton.getBoundingClientRect();
    const ancho = Math.min(360, window.innerWidth - 24);

    bellPanel.style.width = `${ancho}px`;
    bellPanel.style.top = `${Math.round(rect.bottom + 10)}px`;
    bellPanel.style.right = `${Math.max(12, Math.round(window.innerWidth - rect.right))}px`;
}

// Se arma con nodos y textContent, no con HTML: los avisos llevan nombres de
// personas y de unidades, que vienen del estado y no son de fiar como marcado.
function renderBellPanel() {
    if (!bellPanelList) return;

    const avisos = getBellNotices();
    const pendientes = pendingWorkerRequests().length;

    bellPanelList.replaceChildren();

    if (!avisos.length) {
        const vacio = document.createElement("p");

        vacio.className = "bell-panel__empty";
        vacio.textContent = pendientes
            ? "No hay avisos nuevos. Tienes solicitudes pendientes por revisar."
            : "No hay avisos nuevos.";
        bellPanelList.appendChild(vacio);
    }

    for (const aviso of avisos) {
        const item = document.createElement("article");
        const titulo = document.createElement("strong");

        item.className = "bell-notice";
        titulo.textContent = aviso?.title || "Aviso";
        item.appendChild(titulo);

        if (aviso?.detail) {
            const detalle = document.createElement("p");

            detalle.textContent = aviso.detail;
            item.appendChild(detalle);
        }

        const cuando = noticeTimeLabel(aviso?.createdAt);

        if (cuando) {
            const time = document.createElement("time");

            time.textContent = cuando;
            item.appendChild(time);
        }

        bellPanelList.appendChild(item);
    }

    const verSolicitudes = bellPanel?.querySelector(".bell-panel__requests");

    if (verSolicitudes) {
        verSolicitudes.textContent = pendientes
            ? `Ver solicitudes (${pendientes})`
            : "Ver solicitudes";
    }
}

function bellPanelIsOpen() {
    return Boolean(bellPanel) && bellPanel.hidden === false;
}

function handleBellOutsideClick(event) {
    if (!bellPanelIsOpen()) return;
    if (bellPanel.contains(event.target)) return;
    if (bellButton?.contains(event.target)) return;

    closeBellPanel();
}

function handleBellKeydown(event) {
    if (event.key === "Escape") closeBellPanel();
}

function openBellPanel() {
    ensureBellPanel();
    renderBellPanel();
    bellPanel.hidden = false;
    placeBellPanel();
    document.addEventListener("click", handleBellOutsideClick, true);
    document.addEventListener("keydown", handleBellKeydown);
    window.addEventListener("resize", placeBellPanel);
    window.addEventListener("scroll", placeBellPanel, true);
}

function closeBellPanel() {
    if (!bellPanel) return;

    bellPanel.hidden = true;
    document.removeEventListener("click", handleBellOutsideClick, true);
    document.removeEventListener("keydown", handleBellKeydown);
    window.removeEventListener("resize", placeBellPanel);
    window.removeEventListener("scroll", placeBellPanel, true);
}

function updateBadge(count) {
    if (bellBadge) {
        bellBadge.textContent = count > 99 ? "99+" : String(count);
        bellBadge.classList.toggle("hidden", count === 0);
    }

    if (bellButton) {
        bellButton.classList.toggle("has-notifications", count > 0);
        bellButton.setAttribute(
            "aria-label",
            count > 0
                ? `Solicitudes de trabajadores: ${count} pendiente${count === 1 ? "" : "s"}`
                : "Solicitudes de trabajadores"
        );
    }
}

function vibrateDevice() {
    if (!navigator.vibrate) return;

    try {
        navigator.vibrate([220, 90, 220]);
    } catch (error) {
        console.warn("No se pudo vibrar el dispositivo.", error);
    }
}

function getAudioContextClass() {
    return window.AudioContext || window.webkitAudioContext || null;
}

// El audio requiere un gesto previo del usuario: se prepara/reanuda el contexto.
function unlockNotificationAudio() {
    const AudioCtx = getAudioContextClass();

    if (!AudioCtx) return;

    try {
        audioContext ||= new AudioCtx();

        if (audioContext.state === "suspended") {
            audioContext.resume?.().catch(() => {});
        }
    } catch (error) {
        console.warn("No se pudo preparar el audio de alertas.", error);
    }
}

function playNotificationTone() {
    const AudioCtx = getAudioContextClass();

    if (!AudioCtx) return;

    try {
        const context = audioContext || new AudioCtx();
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        audioContext = context;
        context.resume?.().catch(() => {});
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(880, context.currentTime);
        oscillator.frequency.setValueAtTime(1175, context.currentTime + 0.12);
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.36);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.38);
    } catch (error) {
        console.warn("No se pudo reproducir el sonido de alerta.", error);
    }
}

function alertNewRequest() {
    vibrateDevice();
    playNotificationTone();
}

function refreshNow() {
    // Antes de contar: una cobertura recien aceptada se vuelve aviso aqui.
    noticeAcceptedCovers();

    const currentIds = pendingRequestIds();

    // Los avisos cuentan y suenan igual que una solicitud nueva: el prefijo
    // evita que un id de aviso choque con el de una solicitud.
    getBellNotices().forEach(notice => {
        if (notice?.id) currentIds.add(`aviso:${notice.id}`);
    });

    updateBadge(currentIds.size);

    if (bellPanelIsOpen()) renderBellPanel();

    const isNew = hasNewPendingRequest(knownPendingIds, currentIds);

    knownPendingIds = currentIds;

    if (isNew && Date.now() >= alertsReadyAt) {
        alertNewRequest();
    }
}

function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshNow, REFRESH_DEBOUNCE_MS);
}

export function initNotificationsBell({ onOpen } = {}) {
    if (initialized) return;

    bellButton = document.getElementById("notificationsBellBtn");
    bellBadge = document.getElementById("notificationsBellBadge");
    onOpenRequests = typeof onOpen === "function" ? onOpen : () => {};

    if (!bellButton) return;

    initialized = true;

    // Estado inicial desde la cache local (sin alertar) + ventana de gracia para
    // absorber la hidratacion del sync sin sonar por solicitudes viejas.
    knownPendingIds = pendingRequestIds();
    getBellNotices().forEach(notice => {
        if (notice?.id) knownPendingIds.add(`aviso:${notice.id}`);
    });
    knownAcceptedCoverIds = loadSeenCoverIds();
    alertsReadyAt = Date.now() + HYDRATION_GRACE_MS;
    updateBadge(knownPendingIds.size);

    bellButton.addEventListener("click", () => {
        unlockNotificationAudio();

        // Abre el recuadro en vez de llevar a Solicitudes: un aviso no se
        // resuelve ahi, y asi no desaparece sin haberse leido.
        if (bellPanelIsOpen()) {
            closeBellPanel();
            return;
        }

        openBellPanel();
    });

    // Desbloquea el audio en el primer gesto del supervisor.
    const unlock = () => unlockNotificationAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    // Reutiliza los eventos existentes en vez de abrir listeners nuevos.
    //
    // Los DOS hacen falta: las solicitudes del trabajador llegan por el
    // primero, pero las coberturas tienen su propio sync y emiten el segundo.
    // Escuchando solo el primero, que alguien acepte cubrir un turno no
    // despertaba a la campanita.
    window.addEventListener("proturnos:workerRequestsChanged", scheduleRefresh);
    window.addEventListener(
        "proturnos:replacementRequestsChanged",
        scheduleRefresh
    );
}
