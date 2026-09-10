// Tareas diarias del supervisor en el Home.
//
// Una tarea vive en UNO de dos lugares, y lo decide su visibilidad:
//
//   "private" (por defecto) -> users/{uid}/workspaces/{workspaceId}, el doc de
//       membresia del usuario, que las reglas dejan leer/escribir solo a su
//       dueño. Es la tarea "sólo yo" de siempre.
//   compartida ("all", "workers", "estamento:<X>") -> la clave compartida de la
//       unidad `home_shared_tasks` (modulo de estado "home", ver
//       js/firebaseStateModules.js). Ahi la ven TODOS los administradores del
//       entorno, y las dirigidas a trabajadores viajan ademas a la PWA como
//       recordatorios del supervisor (js/serverEngine.js).
//
// El visto NUNCA se comparte: sigue en el doc del usuario (homeTaskDone), asi
// que cada administrador marca su propia copia de una tarea compartida. Por eso
// lo que se guarda en la clave compartida va siempre con doneDates vacio: si
// viajara con los dias marcados de quien la creo, los demas verian hecha una
// tarea que no hicieron.
//
// El documento del usuario guarda DOS campos:
//   homeTasks    -> sus tareas privadas (nombre, hora, periodicidad, alerta)
//   homeTaskDone -> el visto por tarea: { [taskId]: [ISO, ...] }
//
// El visto va en un campo aparte y se escribe con arrayUnion/arrayRemove. Antes
// vivia dentro de cada tarea, asi que CUALQUIER guardado (marcar, agregar,
// editar o borrar otra tarea) reescribia la lista entera: si esa lista venia de
// una copia vieja -por ejemplo la del arranque, antes de que llegara la primera
// respuesta del servidor-, el visto ya marcado se perdia y la tarea volvia a
// aparecer sin hacer horas despues. Con el campo separado, marcar el visto toca
// solo ese dia de esa tarea y no lo pisa ninguna escritura de la lista.
//
// Ademas incluye un programador de alertas: cuando llega la hora de una tarea
// (menos el margen configurado) reproduce una alerta sonora y muestra un aviso.

import {
    getFirebaseServices,
    getCurrentFirebaseUser
} from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";
import { canEditAnyMenu } from "./workspacePermissions.js";
import { getJSON, setJSON } from "./persistence.js";
import { getCachedHolidays } from "./holidays.js";
import { isBusinessDay } from "./calculations.js";
// La visibilidad vive aparte, en un modulo puro: la comparten esta pantalla y
// las dos copias del motor que publican a la PWA.
import {
    HOME_SHARED_TASKS_KEY,
    isSharedHomeTask,
    isValidHomeTaskVisibility
} from "./homeSharedTasks.js";
// El orden de las tarjetas del inicio vive en el mismo documento del usuario:
// lo trae este mismo listener.
import { receiveRemoteHomeLayout } from "./homeLayout.js";

// Lista visible = las privadas de este usuario + las compartidas de la unidad.
let cache = [];
// Solo las privadas (las que viajan al doc del usuario).
let ownTasks = [];
// Visto por tarea tal como lo entrega el servidor. Manda sobre el visto que
// venga dentro de la tarea (formato viejo).
let doneMap = {};
// Ultima lista recibida del servidor. Sirve para no borrar por omision una
// tarea que el servidor conoce y esta copia todavia no.
let remoteTasks = [];
let unsub = null;
let changeHandler = null;
let currentUid = "";
let currentWid = "";
let idCounter = 0;
let hydrated = false;
let hydratedPromise = null;
let resolveHydrated = null;
let retryTimer = null;

// Cuanto se espera la primera respuesta del servidor antes de guardar la lista
// completa. Guardar sin esperarla sube la copia local (que puede venir vieja o
// vaciada) y pisa lo que ya estaba guardado.
const HYDRATION_TIMEOUT_MS = 8000;
// Si el listener se cae (red, token de App Check vencido) hay que volver a
// engancharlo: con el listener muerto la copia local se queda congelada y el
// siguiente guardado subiria datos viejos.
const RETRY_DELAY_MS = 5000;

function newId() {
    idCounter += 1;
    return `t${Date.now().toString(36)}${idCounter}`;
}

// A quien se le atribuye lo que se crea desde este navegador. Mismo criterio que
// los recordatorios: el uid manda, el correo es el respaldo cuando no hay sesion
// Firebase (uso local).
function currentTaskOwner() {
    const user = getCurrentFirebaseUser();
    const fallbackName = typeof document !== "undefined"
        ? document.getElementById("authUserName")?.textContent?.trim()
        : "";
    const uid = user?.uid || "";
    const email = user?.email || "";

    return {
        uid,
        email,
        name: user?.displayName || email || fallbackName || "Usuario local",
        key: uid
            ? `uid:${uid}`
            : (email ? `email:${email.toLowerCase()}` : "local_user")
    };
}

/**
 * Si esta tarea la puede modificar quien esta mirando. Una tarea compartida solo
 * la edita o borra su autor: para el resto es de lectura (pueden marcar su
 * propio visto, que es de cada uno).
 */
export function canEditHomeTask(task) {
    if (!isSharedHomeTask(task)) return true;

    const owner = currentTaskOwner();

    if (task.createdByKey) return task.createdByKey === owner.key;
    if (task.createdByUid && owner.uid) return task.createdByUid === owner.uid;

    if (task.createdByEmail && owner.email) {
        return task.createdByEmail.toLowerCase() === owner.email.toLowerCase();
    }

    return owner.key === "local_user";
}

// Cuantos vistos se conservan por tarea. Una tarea diaria acumularia un ISO por
// dia para siempre dentro del documento del usuario; con este tope guarda algo
// mas de medio año, que es de sobra para mirar hacia atras en el calendario.
const MAX_DONE_DATES = 200;

function normalizeDoneDates(list) {
    return [...new Set(
        (Array.isArray(list) ? list : []).map(String).filter(Boolean)
    )]
        .sort()
        .slice(-MAX_DONE_DATES);
}

function taskDoneDates(task) {
    // Antes el visto era UNA sola fecha ("hecha hoy"). Desde que se puede marcar
    // cualquier dia en el calendario hace falta una por dia: con una sola, poner
    // el visto el 27 borraba el del 26. Los dos formatos viejos se siguen
    // leyendo para no perder lo que ya estaba marcado.
    if (Array.isArray(task?.doneDates)) return task.doneDates;

    return task?.doneDate ? [task.doneDate] : [];
}

function normalizeDoneMap(raw) {
    if (!raw || typeof raw !== "object") return {};

    return Object.keys(raw).reduce((map, id) => {
        if (Array.isArray(raw[id])) map[String(id)] = normalizeDoneDates(raw[id]);

        return map;
    }, {});
}

function hasDoneEntry(map, id) {
    return Boolean(map) && Object.prototype.hasOwnProperty.call(map, id);
}

function normalizeTask(task, overrides) {
    const id = task && task.id ? String(task.id) : newId();
    const visibility = isValidHomeTaskVisibility(task?.visibility)
        ? task.visibility
        : "private";
    // Una tarea sin autor es de quien la esta guardando: o la acaba de escribir,
    // o venia de la version anterior (y esa lista es su documento privado).
    const owner = task?.createdByKey ? null : currentTaskOwner();

    return {
        id,
        name: String(task?.name || "").trim(),
        time: String(task?.time || "08:00"),
        repeat: String(task?.repeat || "Diario"),
        date: String(task?.date || ""),
        alert: String(task?.alert || "Sin alerta"),
        visibility,
        createdByKey: String(task?.createdByKey || owner?.key || ""),
        createdByUid: String(task?.createdByUid || owner?.uid || ""),
        createdByEmail: String(task?.createdByEmail || owner?.email || ""),
        createdByName: String(task?.createdByName || owner?.name || ""),
        // Fechas (ISO) en que se marcó como realizada, una por dia cumplido.
        doneDates: normalizeDoneDates(
            hasDoneEntry(overrides, id) ? overrides[id] : taskDoneDates(task)
        )
    };
}

// Unico lugar donde se decide si una tarea esta hecha en un dia. La tarjeta del
// inicio, el calendario y el listado del dia preguntan aca.
export function isTaskDoneOn(task, iso) {
    return Array.isArray(task?.doneDates) && task.doneDates.includes(iso);
}

export function toggleTaskDoneOn(task, iso) {
    const done = normalizeDoneDates(taskDoneDates(task))
        .filter(date => date !== iso);

    if (!isTaskDoneOn(task, iso)) done.push(iso);

    return { ...task, doneDates: done.sort().slice(-MAX_DONE_DATES) };
}

function normalizeList(list, overrides = doneMap) {
    return (Array.isArray(list) ? list : [])
        .map(task => normalizeTask(task, overrides))
        .filter(task => task.name);
}

// Une la lista con el visto guardado aparte. Es LA regla que impide que un
// guardado de la lista (agregar, editar o borrar otra tarea) borre un visto ya
// marcado: lo que manda es homeTaskDone, y la lista solo aporta el formato
// viejo de las tareas que nunca se marcaron desde esta version.
export function applyDoneMap(tasks, doneByTask) {
    return normalizeList(tasks, normalizeDoneMap(doneByTask));
}

function sortByTime(tasks) {
    return [...tasks].sort(
        (a, b) => String(a.time).localeCompare(String(b.time))
    );
}

function localKey() {
    return currentUid && currentWid
        ? `homeTasks_${currentUid}_${currentWid}`
        : "homeTasks_local";
}

function doneKey() {
    return currentUid && currentWid
        ? `homeTasksDone_${currentUid}_${currentWid}`
        : "homeTasksDone_local";
}

export function getHomeTasks() {
    return cache.map(task => ({ ...task }));
}

/* =========================================================
   La mitad compartida (clave `home_shared_tasks` de la unidad)
========================================================= */

function readSharedTasks() {
    const list = getJSON(HOME_SHARED_TASKS_KEY, []);

    return Array.isArray(list) ? list : [];
}

// Lo que se guarda en la unidad va SIEMPRE sin dias marcados: el visto es de
// cada administrador y vive en su propio documento.
function sharedTaskForStorage(task) {
    return { ...task, doneDates: [] };
}

/**
 * Reescribe la lista compartida de la unidad.
 *
 * `knownIds` son todas las tareas que esta copia conoce (compartidas y
 * privadas). Lo que ya estaba en la unidad y no aparece ahi se rescata: puede
 * ser de otro administrador que lo acaba de crear y que esta copia todavia no
 * recibio. Sin ese rescate, agregar una tarea propia borraria la suya.
 */
function writeSharedTasks(sharedTasks, knownIds, removedIds) {
    const current = readSharedTasks();
    const rescued = current.filter(task => {
        const id = String(task?.id || "");

        return id && !knownIds.has(id) && !removedIds.has(id);
    });
    const next = sortByTime(
        normalizeList([...sharedTasks, ...rescued], {})
    ).map(sharedTaskForStorage);

    // Cada escritura viaja a toda la unidad: si nada cambio, no se escribe.
    if (JSON.stringify(next) === JSON.stringify(current)) return;

    setJSON(HOME_SHARED_TASKS_KEY, next);
}

// La lista visible sale de juntar las dos casas. Si una tarea aparece en las dos
// -por ejemplo, una que se acaba de compartir y cuyo borrado del documento del
// usuario todavia no confirma el servidor- manda la compartida, que es la copia
// que ven los demas.
function rebuildCache() {
    const byId = new Map();

    normalizeList(ownTasks, doneMap).forEach(task => byId.set(task.id, task));
    normalizeList(readSharedTasks(), doneMap)
        .forEach(task => byId.set(task.id, task));

    cache = sortByTime([...byId.values()]);
    changeHandler?.(getHomeTasks());
}

// Deja la copia local y la pantalla al dia, sin tocar el servidor. `tasks` son
// SOLO las privadas: las compartidas se guardan en writeSharedTasks.
function applyLocal(tasks, map = doneMap) {
    doneMap = map;
    ownTasks = normalizeList(tasks, doneMap);
    setJSON(localKey(), ownTasks);
    setJSON(doneKey(), doneMap);
    rebuildCache();
}

async function userWorkspaceRef() {
    const user = getCurrentFirebaseUser();
    const workspace = getActiveWorkspace();

    if (!user?.uid || !workspace?.id) return null;

    try {
        const { db, firestoreModule } = await getFirebaseServices();

        return {
            firestoreModule,
            ref: firestoreModule.doc(
                db, "users", user.uid, "workspaces", workspace.id
            )
        };
    } catch (error) {
        console.warn("No se pudo abrir el documento de tareas del home.", error);

        return null;
    }
}

function whenHydrated() {
    if (hydrated || !hydratedPromise) return Promise.resolve();

    // Con el tope, quedarse sin señal no deja la tarea colgada: se guarda igual
    // y el usuario ve el aviso si la escritura falla.
    return Promise.race([
        hydratedPromise,
        new Promise(resolve => { setTimeout(resolve, HYDRATION_TIMEOUT_MS); })
    ]);
}

// Guarda la lista completa (agregar / editar / borrar). El visto NO viaja por
// aca: para eso esta toggleTaskDone.
export async function saveHomeTasks(tasks, { removedIds = [] } = {}) {
    // Ultima guarda: un miembro de solo lectura no crea, modifica ni comparte
    // tareas. La pantalla ya no le ofrece el boton y las reglas rechazan su
    // escritura en la unidad; esto evita ademas que su copia local quede
    // mostrando algo que el servidor nunca acepto.
    if (!canEditAnyMenu()) return;

    // La lista que dejo el usuario, aparte de cache: mientras se espera al
    // servidor puede llegar una respuesta y reemplazar cache, y entonces se
    // guardaria lo que ya habia en vez de la edicion recien hecha.
    const intended = normalizeList(tasks);
    const removed = new Set(removedIds.map(String));
    // `known` lleva TODAS las tareas de esta copia, no solo las privadas: asi,
    // la que acaba de cambiar de casa (de privada a compartida o al reves) no la
    // rescata la otra mitad y no queda duplicada.
    const known = new Set(intended.map(task => task.id));

    writeSharedTasks(
        intended.filter(isSharedHomeTask),
        known,
        removed
    );
    applyLocal(intended.filter(task => !isSharedHomeTask(task)));

    const target = await userWorkspaceRef();
    if (!target) return;

    await whenHydrated();

    // Una tarea solo desaparece si se pidio borrarla. Las que el servidor ya
    // tenia y esta copia no conoce se rescatan: si se omitieran, guardar desde
    // una copia vieja borraria tareas que el usuario nunca toco.
    const rescued = remoteTasks.filter(
        task => !known.has(task.id) && !removed.has(task.id)
    );

    applyLocal(sortByTime(
        intended.filter(task => !isSharedHomeTask(task)).concat(rescued)
    ));

    const { firestoreModule, ref } = target;
    // La lista lleva ademas el visto dentro de cada tarea: es el formato que
    // leen las versiones anteriores de la app. Para esta version manda
    // homeTaskDone; la copia de adentro solo se refresca cuando se guarda la
    // lista, que es la unica escritura que puede permitirselo sin riesgo.
    const payload = { homeTasks: ownTasks };

    if (removed.size) {
        payload.homeTaskDone = {};
        removed.forEach(id => {
            payload.homeTaskDone[id] = firestoreModule.deleteField();
        });
    }

    try {
        await firestoreModule.setDoc(ref, payload, { merge: true });
    } catch (error) {
        console.warn("No se pudieron guardar las tareas del home.", error);
        showTasksIssue("No se pudieron guardar las tareas. Revisa tu conexión.");
    }
}

// Marca / desmarca el visto de UNA tarea en UN dia.
export async function toggleTaskDone(taskId, iso) {
    const id = String(taskId || "");
    const day = String(iso || "");
    const current = cache.find(task => task.id === id);

    if (!id || !day || !current) return;

    const updated = toggleTaskDoneOn(current, day);
    const done = isTaskDoneOn(updated, day);
    const hadEntry = hasDoneEntry(doneMap, id);
    const previousDates = normalizeDoneDates(taskDoneDates(current));

    // El visto solo toca el mapa del usuario: la tarea puede ser compartida, y
    // guardarla como propia la sacaria de la lista de la unidad.
    applyLocal(ownTasks, { ...doneMap, [id]: updated.doneDates });

    const target = await userWorkspaceRef();
    if (!target) return;

    const { firestoreModule, ref } = target;
    // Escritura quirurgica: toca un solo dia de una sola tarea. Dos pestañas, o
    // dos dias marcados casi a la vez, ya no se pisan. La primera vez que se
    // marca una tarea que venia del formato viejo se escribe su lista completa
    // de dias, para arrastrar lo que ya tenia marcado.
    const value = hadEntry
        ? (done
            ? firestoreModule.arrayUnion(day)
            : firestoreModule.arrayRemove(day))
        : updated.doneDates;

    try {
        await firestoreModule.setDoc(
            ref,
            { homeTaskDone: { [id]: value } },
            { merge: true }
        );
    } catch (error) {
        console.warn("No se pudo guardar el visto de la tarea.", error);

        // El visto no quedo guardado. Deshacerlo en pantalla es lo unico que
        // evita que el supervisor lo de por hecho y lo encuentre sin marcar mas
        // tarde. Se deshace SOLO esta tarea: lo demas pudo cambiar mientras
        // tanto.
        const revertedMap = { ...doneMap };

        if (hadEntry) revertedMap[id] = previousDates;
        else delete revertedMap[id];

        applyLocal(ownTasks, revertedMap);
        showTasksIssue("No se pudo guardar el visto. Revisa tu conexión.");
    }
}

export async function deleteHomeTask(taskId) {
    const id = String(taskId || "");
    if (!id) return;

    const nextMap = { ...doneMap };

    delete nextMap[id];
    doneMap = nextMap;

    // saveHomeTasks reparte lo que queda entre las dos casas, asi que borra la
    // tarea este donde este (privada o compartida).
    await saveHomeTasks(
        cache.filter(task => task.id !== id),
        { removedIds: [id] }
    );
}

function handleSnapshot(snapshot) {
    const data = snapshot.exists() ? snapshot.data() : {};

    doneMap = normalizeDoneMap(data.homeTaskDone);
    remoteTasks = normalizeList(data.homeTasks, doneMap);
    ownTasks = remoteTasks.map(task => ({ ...task }));
    setJSON(localKey(), ownTasks);
    setJSON(doneKey(), doneMap);
    receiveRemoteHomeLayout(data.homeLayout, currentUid, currentWid);

    // Solo cuenta como sincronizado lo que vino del servidor. El SDK tambien
    // avisa con lo que tiene en memoria (por ejemplo, una escritura propia
    // todavia sin confirmar): darlo por sincronizado seria creerle a la copia
    // local justo lo que hay que comprobar.
    if (!snapshot.metadata?.fromCache) {
        hydrated = true;
        resolveHydrated?.();
    }

    rebuildCache();
}

function scheduleResubscribe() {
    if (retryTimer || !currentUid || !currentWid) return;

    unsub = null;
    retryTimer = setTimeout(() => {
        retryTimer = null;
        void subscribe();
    }, RETRY_DELAY_MS);
}

async function subscribe() {
    if (!currentUid || !currentWid) return;

    const uid = currentUid;
    const wid = currentWid;

    try {
        const { db, firestoreModule } = await getFirebaseServices();

        if (uid !== currentUid || wid !== currentWid) return;

        unsub = firestoreModule.onSnapshot(
            firestoreModule.doc(db, "users", uid, "workspaces", wid),
            handleSnapshot,
            error => {
                console.warn(
                    "No se pudieron sincronizar las tareas del home.",
                    error
                );
                scheduleResubscribe();
            }
        );
    } catch (error) {
        console.warn(
            "No se pudo iniciar la sincronizacion de tareas del home.",
            error
        );
        scheduleResubscribe();
    }
}

export async function startHomeTasksSync(workspace, onChange) {
    stopHomeTasksSync();
    changeHandler = typeof onChange === "function" ? onChange : null;

    const user = getCurrentFirebaseUser();
    currentUid = user?.uid || "";
    currentWid = workspace?.id || "";

    // Hidrata desde cache local para render inmediato.
    doneMap = normalizeDoneMap(getJSON(doneKey(), {}));
    ownTasks = normalizeList(getJSON(localKey(), []), doneMap);
    rebuildCache();

    if (!currentUid || !currentWid) return;

    hydratedPromise = new Promise(resolve => { resolveHydrated = resolve; });

    await subscribe();
}

export function stopHomeTasksSync() {
    if (unsub) {
        try { unsub(); } catch (error) { /* noop */ }
        unsub = null;
    }
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
    changeHandler = null;
    currentUid = "";
    currentWid = "";
    cache = [];
    ownTasks = [];
    doneMap = {};
    remoteTasks = [];
    hydrated = false;
    hydratedPromise = null;
    resolveHydrated = null;
}

// Lo compartido no llega por el listener del documento del usuario, sino por el
// sync del estado de la unidad: cuando otro administrador comparte o edita una
// tarea, el parche entra por aca y hay que repintar.
function affectsSharedTasks(detail) {
    if (detail?.type === "app-state-applied") {
        return !Array.isArray(detail.modules) || detail.modules.includes("home");
    }

    if (detail?.type !== "app-state-entries-applied") return false;

    return (detail.keys || []).includes(HOME_SHARED_TASKS_KEY);
}

if (typeof window !== "undefined") {
    window.addEventListener("proturnos:firebaseAppState", event => {
        if (!affectsSharedTasks(event.detail)) return;

        rebuildCache();
    });
}

/* =========================================================
   Alertas sonoras
========================================================= */

const ALERT_CHECK_MS = 30000;   // revisa cada 30 s
const ALERT_WINDOW_MIN = 2;     // dispara si estamos dentro de 2 min del momento
let alertTimer = null;
const firedAlerts = new Set();
let audioCtx = null;

function alertOffsetMinutes(alert) {
    switch (alert) {
        case "Al momento": return 0;
        case "5 minutos antes": return 5;
        case "15 minutos antes": return 15;
        case "30 minutos antes": return 30;
        case "1 hora antes": return 60;
        default: return null; // "Sin alerta"
    }
}

function parseISODate(iso) {
    const parts = String(iso || "").split("-");
    if (parts.length !== 3) return null;
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return Number.isNaN(date.getTime()) ? null : date;
}

function monthsBetween(from, to) {
    return (to.getFullYear() - from.getFullYear()) * 12 +
        (to.getMonth() - from.getMonth());
}

// Exportada: el calendario organizativo del home pregunta, dia por dia, que
// tareas caen ahi. Tiene que ser LA MISMA regla que dispara las alertas, o el
// calendario mostraria una recurrencia y el aviso sonaria en otra.
export function isTaskActiveOn(task, date, holidays) {
    const anchor = parseISODate(task.date);
    if (!anchor) {
        // Sin fecha de inicio no hay donde anclar la recurrencia, asi que la
        // tarea vale para todos los dias. Es la unica lectura que no la hace
        // desaparecer: si se descartara, no saldria en la tarjeta, ni en el
        // calendario, ni sonaria nunca su alerta.
        return true;
    }

    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    if (day < start) return false;

    switch (task.repeat) {
        case "Una sola vez": return day.getTime() === start.getTime();
        case "Diario": return true;
        // Habil = ni fin de semana ni feriado. Se usa el mismo isBusinessDay que
        // el motor de horas, para que "habil" signifique lo mismo en toda la app
        // (incluidos los feriados que el usuario agrega a mano).
        case "Diario Hábil":
            return isBusinessDay(
                day,
                holidays || getCachedHolidays(day.getFullYear())
            );
        case "Semanal": return day.getDay() === start.getDay();
        case "Mensual": return day.getDate() === start.getDate();
        case "Trimestral":
            return day.getDate() === start.getDate() &&
                monthsBetween(start, day) % 3 === 0;
        case "Cuatrimestral":
            return day.getDate() === start.getDate() &&
                monthsBetween(start, day) % 4 === 0;
        case "Anual":
            return day.getDate() === start.getDate() &&
                day.getMonth() === start.getMonth();
        default: return false;
    }
}

function ensureAudioContext() {
    if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        try { audioCtx = new Ctx(); } catch (error) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => { /* noop */ });
    }
    return audioCtx;
}

function playBeep() {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    const start = ctx.currentTime;
    [880, 1175, 880].forEach((freq, i) => {
        const at = start + i * 0.2;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.28, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.17);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.18);
    });
}

function toastHost() {
    if (typeof document === "undefined") return null;

    let host = document.getElementById("hmAlertToasts");

    if (!host) {
        host = document.createElement("div");
        host.id = "hmAlertToasts";
        host.className = "hm-alert-toasts";
        document.body.appendChild(host);
    }

    return host;
}

// Arma el aviso y devuelve el nodo para rellenar el texto (siempre como texto,
// nunca como HTML: evita inyeccion desde el nombre de la tarea).
function pushToast(icon, title) {
    const host = toastHost();

    if (!host) return null;

    const toast = document.createElement("div");

    toast.className = "hm-alert-toast";
    toast.setAttribute("role", "alert");
    toast.innerHTML = `
        <span class="hm-alert-toast__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
        </span>
        <span class="hm-alert-toast__body">
            <strong></strong>
            <span></span>
        </span>
        <button class="hm-alert-toast__close" type="button" aria-label="Cerrar">&times;</button>
    `;
    toast.querySelector(".hm-alert-toast__body strong").textContent = title;
    toast.querySelector(".hm-alert-toast__close")
        .addEventListener("click", () => toast.remove());
    host.appendChild(toast);

    setTimeout(() => toast.remove(), 9000);

    return toast.querySelector(".hm-alert-toast__body span");
}

const IC_BELL = '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.7 21a2 2 0 0 1-3.4 0"></path>';
const IC_WARN = '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>';

function showToast(task) {
    const body = pushToast(IC_BELL, `Tarea: ${task.time}`);

    if (body) body.textContent = task.name;
}

// Aviso de que algo NO se guardo. Va por el mismo canal que las alertas porque
// el riesgo es el mismo: si el visto no llego al servidor y nadie lo dice, el
// supervisor lo da por hecho y lo encuentra sin marcar horas despues.
function showTasksIssue(message) {
    const body = pushToast(IC_WARN, "Tareas diarias");

    if (body) body.textContent = message;
}

function fireAlert(task) {
    playBeep();
    showToast(task);
}

/**
 * Alerta sonora + aviso visible para OTROS avisos del inicio que necesitan la
 * misma atencion que una tarea vencida (hoy: la cobertura automatica que se
 * quedo sin respuesta).
 *
 * Se expone desde aca y no se duplica el oscilador porque el desbloqueo de
 * audio del navegador se hace una sola vez, al arrancar el programador de
 * tareas: un segundo AudioContext creado en otro modulo quedaria suspendido.
 */
export function fireHomeAlert(title, message) {
    playBeep();

    const body = pushToast(IC_WARN, title);

    if (body) body.textContent = message;
}

function checkAlerts() {
    if (!cache.length) return;

    const now = new Date();
    const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    cache.forEach(task => {
        const offset = alertOffsetMinutes(task.alert);
        if (offset === null) return;
        if (!isTaskActiveOn(task, now)) return;

        const [h, m] = String(task.time || "").split(":").map(Number);
        if (Number.isNaN(h) || Number.isNaN(m)) return;

        const fireMinutes = h * 60 + m - offset;
        if (fireMinutes < 0) return;

        const key = `${task.id}|${dayKey}`;
        if (firedAlerts.has(key)) return;

        if (nowMinutes >= fireMinutes && nowMinutes < fireMinutes + ALERT_WINDOW_MIN) {
            firedAlerts.add(key);
            fireAlert(task);
        }
    });
}

export function startTaskAlertScheduler() {
    stopTaskAlertScheduler();

    // Habilita el audio tras la primera interaccion del usuario (política de
    // autoplay de los navegadores).
    const unlock = () => ensureAudioContext();
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });

    alertTimer = setInterval(checkAlerts, ALERT_CHECK_MS);
    checkAlerts();
}

export function stopTaskAlertScheduler() {
    if (alertTimer) {
        clearInterval(alertTimer);
        alertTimer = null;
    }
}
