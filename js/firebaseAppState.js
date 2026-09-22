import { getFirebaseServices } from "./firebaseClient.js";
import {
    applyLocalPatch,
    exportLocalSnapshot,
    getRaw,
    isInternalKey,
    replaceLocalSnapshot,
    replaceLocalSnapshotSubset,
    setRaw
} from "./persistence.js";
import {
    canEditMenu,
    canViewMenu,
    isWorkspaceOwner
} from "./workspacePermissions.js";
import {
    splitSnapshotByStateModule,
    stateModuleForKey,
    stateModuleIds,
    stateModulePermission
} from "./firebaseStateModules.js";
import {
    decodePartialStateItemKey,
    groupPartialStateEntries,
    mergePartialStateEntries,
    planPartialStateEntries
} from "./firebasePartialState.js";
import {
    isRemoteDiscrepant,
    isSyncStale,
    measureRemoteDiscrepancy,
    readLastServerSync,
    writeLastServerSync
} from "./syncFreshness.js";
import {
    measurePerformance,
    recordPerformanceEvent
} from "./performanceMonitor.js";

const CLIENT_ID_KEY = "proturnos_firebase_client_id";
const ENTRY_BATCH_SIZE = 1;
const ENTRY_SYNC_DELAY_MS = 2500;
const ENTRY_USER_QUIET_MS = 90000;
const ENTRY_ACTIVE_RETRY_MS = 10000;
const ENTRY_BLOCKED_RETRY_MS = 4000;
// Reintento del arranque de la sincronizacion cuando falla. Sube hasta el techo
// para no castigar una caida larga, pero empieza corto porque hasta que no
// arranque la sesion NO PUEDE PUBLICAR (ver el catch de startFirebaseAppStateSync).
const INITIAL_STATE_RETRY_MS = 5000;
const INITIAL_STATE_RETRY_MAX_MS = 60000;
const ENTRY_VISIBLE_RETRY_MS = 60000;
// Techo duro de la cola de subida: ningun cambio local espera mas que esto,
// aunque el usuario siga interactuando y la pestaña siga visible.
const ENTRY_MAX_WAIT_MS = 8000;
// Hueco entre documentos al subir una rafaga, en lugar de una espera completa
// por cada uno.
const ENTRY_SLICE_GAP_MS = 300;
const REMOTE_APPLY_BATCH_SIZE = 4;
// Ventana de agrupacion para lo que el otro perfil acaba de tocar: junta las
// entradas de una misma edicion sin que el cambio se sienta diferido.
const REMOTE_APPLY_URGENT_DELAY_MS = 400;
// Reintento mientras el hilo principal esta ocupado. Es una cadencia, no una
// espera: el techo de abajo manda.
const REMOTE_APPLY_BUSY_DELAY_MS = 1500;
// Techo duro. Ninguna entrada remota puede esperar mas que esto con la pestaña
// visible, sin importar la vista ni si el usuario sigue interactuando.
const REMOTE_APPLY_URGENT_MAX_WAIT_MS = 2000;
const REMOTE_APPLY_MAX_WAIT_MS = 6000;
// Hueco entre lotes al drenar una rafaga: se cede el hilo entre tandas de 4
// entradas, pero la cola avanza en segundos, no en minutos.
const REMOTE_APPLY_BATCH_GAP_MS = 200;
const LOCAL_ENTRY_PROTECTION_MS = 30 * 60 * 1000;
const WORKER_CALENDAR_URGENT_STATE_PREFIXES = [
    "data_",
    "baseData_",
    "admin_",
    "legal_",
    "comp_",
    "absences_",
    "rotativa_",
    "shift_",
    "shiftAssignmentHistory_",
    "gradeHistory_",
    "contractHistory_"
];
const WORKER_CALENDAR_URGENT_STATE_KEYS = new Set([
    "replacements",
    "swaps",
    "manualHolidays",
    "turnoColorConfig",
    "profiles"
]);

let activeWorkspaceId = "";
let unsubscribeState = null;
let stateSyncStarting = false;
let entrySyncTimer = null;
let applyingRemoteState = false;
let waitingInitialState = false;
let initialStateRetryTimer = null;
// Ultimo estado conocido de "los datos vienen del servidor o de la cache", por
// modulo y agregado. null = todavia no se sabe.
const servingFromCacheByModule = new Map();
let servingFromCache = null;
let initialStateRetryDelay = INITIAL_STATE_RETRY_MS;
// Modulos que se estan aplicando en este momento. El estado del entorno viene
// partido en 13 modulos con un listener cada uno, y el turno de UNA casilla se
// calcula con datos de tres de ellos (profile, turnos y swap). Aplicados de a
// uno, la interfaz alcanza a pintar mezclas incompletas: la casilla muestra el
// turno sin el cambio de turno todavia aplicado, despues con el, despues con la
// base nueva. Es el "las casillas cambian solas" que reportaron los
// supervisores.
//
// IMPORTANTE: esto retiene el AVISO a la interfaz, nunca la aplicacion. El
// estado se sigue guardando en el momento en que llega. Diferir la aplicacion
// ensancharia la ventana en la que un cambio local se sube con una copia vieja
// y pisaria el de otro supervisor.
let modulesApplying = 0;
let settleTimer = null;
let settledSnapshot = null;
let settledPending = false;
let entrySyncInFlight = false;
let urgentEntrySyncPending = false;
let remoteApplyTimer = null;
let remoteApplyInFlight = false;
let remoteQueueOldestAt = 0;
let entryLastUserActivityAt = Date.now();
let pendingEntriesOldestAt = 0;
let servicesCache = null;
let onStateChanged = () => {};
let syncGeneration = 0;
const lastAppliedHashes = new Map();
const pendingStateEntries = new Map();
const pendingRemoteStateEntries = new Map();
const localDirtyStateEntries = new Map();
// Firma del ultimo valor que ya quedo aplicado localmente, por elemento.
// Firestore notifica por DOCUMENTO: como todos los elementos de una clave
// comparten documento, tocar uno reenvia los N. Sin esto se reaplicaban los N.
const appliedEntrySignatures = new Map();
const EMPTY_SIGNATURES = new Map();
const entryModulesPresent = new Set();
let unsubscribeStateEntries = null;
// Bloqueo de edicion mientras la copia local no merece que se edite encima
// (ver js/syncFreshness.js). "" = sin bloqueo; si no, "stale" o "discrepancy".
let stateLockReason = "";
let staleStart = false;
let lastServerSyncMarkAt = 0;
let freshnessCheckInFlight = false;
const SERVER_SYNC_MARK_THROTTLE_MS = 60 * 1000;
const LOCK_RELEASE_SETTLE_MS = 600;

function lockAppState(reason) {
    if (stateLockReason === reason) return;
    // La copia vieja pesa mas que una discrepancia: no se rebaja el aviso.
    if (stateLockReason === "stale" && reason === "discrepancy") return;

    stateLockReason = reason;
    dispatchStatus({ type: "app-state-lock", reason });
}

function unlockAppState() {
    if (!stateLockReason) return;

    stateLockReason = "";
    dispatchStatus({ type: "app-state-unlock" });
}

// Se suelta cuando lo del servidor ya quedo aplicado y la pantalla alcanzo a
// repintarse: soltar antes dejaria editar un instante sobre la vista vieja.
function releaseLockWhenApplied() {
    if (!stateLockReason) return;

    setTimeout(() => {
        if (
            !stateLockReason ||
            waitingInitialState ||
            pendingRemoteStateEntries.size ||
            freshnessCheckInFlight
        ) return;

        unlockAppState();
    }, LOCK_RELEASE_SETTLE_MS);
}

function markServerSync({ force = false } = {}) {
    if (!activeWorkspaceId) return;

    const now = Date.now();

    if (!force && now - lastServerSyncMarkAt < SERVER_SYNC_MARK_THROTTLE_MS) {
        return;
    }

    lastServerSyncMarkAt = now;
    writeLastServerSync(
        key => getRaw(key, null),
        (key, value) => setRaw(key, value),
        activeWorkspaceId,
        now
    );
}

function localCopyIsStale(workspaceId = activeWorkspaceId) {
    return isSyncStale(
        readLastServerSync(key => getRaw(key, null), workspaceId)
    );
}

// Al volver a un computador que llevaba mas de un dia sin contacto: se bloquea
// y se lee algo del SERVIDOR, no de la cache. Si responde, los listeners ya
// trajeron lo que faltaba; se suelta cuando termina de aplicarse. Sin servidor
// sigue bloqueado y se reintenta al reconectar.
async function confirmServerFreshness() {
    if (
        !activeWorkspaceId ||
        waitingInitialState ||
        freshnessCheckInFlight ||
        !localCopyIsStale()
    ) return;

    const workspaceId = activeWorkspaceId;
    const moduleId = stateModuleIds().find(canReadModule);

    if (!moduleId) return;

    freshnessCheckInFlight = true;
    lockAppState("stale");

    try {
        const { db, firestoreModule } = await services();
        const read = typeof firestoreModule.getDocFromServer === "function"
            ? firestoreModule.getDocFromServer
            : firestoreModule.getDoc;

        await read(moduleDocRef(db, firestoreModule, workspaceId, moduleId));

        if (workspaceId !== activeWorkspaceId) return;

        markServerSync({ force: true });
    } catch (error) {
        console.warn("No se pudo confirmar la version del servidor.", error);
        return;
    } finally {
        freshnessCheckInFlight = false;
    }

    // Lo que trajeron los listeners se aplica ya, sin la espera de cortesia.
    scheduleRemoteStateApply(0);
    releaseLockWhenApplied();
}

function waitFirebaseStateIdle(timeout = 500) {
    return new Promise(resolve => {
        if (
            typeof window !== "undefined" &&
            typeof window.requestIdleCallback === "function"
        ) {
            window.requestIdleCallback(resolve, {
                timeout: Math.max(120, Number(timeout) || 500)
            });
            return;
        }

        setTimeout(resolve, 0);
    });
}

function markFirebaseStateUserActivity() {
    entryLastUserActivityAt = Date.now();
}

function firebaseStateHasPendingInput() {
    try {
        return Boolean(
            typeof navigator !== "undefined" &&
            navigator.scheduling &&
            typeof navigator.scheduling.isInputPending === "function" &&
            navigator.scheduling.isInputPending({ includeContinuous: true })
        );
    } catch (_error) {
        return false;
    }
}

// Los commits de Firestore/IndexedDB pueden congelar el hilo principal incluso
// tras un periodo de quietud, asi que mientras el supervisor mira la app se
// prioriza la fluidez. Pero "se vacia al ocultar la pestaña" era literal: la
// espera se recalculaba entera en cada reintento, de modo que una clave no
// urgente no subia nunca con la pestaña abierta y los demas perfiles no podian
// verla. El diferimiento se mantiene; lo que se agrega es el techo.
//
// El loop del `carry_` que motivaba esperas de 90 s ya se corta en origen:
// `roundCarryHour` deja el valor estable y `setRaw` no lo reporta como cambio.
export function planEntrySyncDelay({
    now = Date.now(),
    visible = true,
    pendingInput = false,
    oldestQueuedAt = 0,
    quietMs = ENTRY_USER_QUIET_MS
} = {}) {
    if (!visible) return 0;
    if (!oldestQueuedAt) return 0;

    const waited = Math.max(0, now - oldestQueuedAt);
    const budget = Math.max(0, ENTRY_MAX_WAIT_MS - waited);

    if (budget <= 0) return 0;

    const delay = Math.max(
        ENTRY_VISIBLE_RETRY_MS,
        ENTRY_ACTIVE_RETRY_MS,
        Number(quietMs) || ENTRY_USER_QUIET_MS
    );

    return Math.min(
        budget,
        pendingInput ? Math.max(delay, ENTRY_ACTIVE_RETRY_MS) : delay
    );
}

function firebaseStateInteractiveDelay(quietMs = ENTRY_USER_QUIET_MS) {
    if (typeof document === "undefined") return 0;

    return planEntrySyncDelay({
        visible: document.visibilityState === "visible",
        pendingInput: firebaseStateHasPendingInput(),
        oldestQueuedAt: pendingEntriesOldestAt,
        quietMs
    });
}

export function isWorkerCalendarUrgentStateKey(key) {
    const value = String(key || "");

    return WORKER_CALENDAR_URGENT_STATE_KEYS.has(value) ||
        WORKER_CALENDAR_URGENT_STATE_PREFIXES.some(prefix =>
            value.startsWith(prefix)
        );
}

// Cuanto puede esperar lo que ya cambio otra sesion antes de aplicarse aqui.
//
// La version anterior devolvia 90 s fijos en el calendario y >=30 s mientras
// quedara quietud pendiente. Como al vencer el timer se volvia a consultar esta
// misma funcion, la espera se renovaba entera: un administrador mirando "turnos"
// -o simplemente moviendo el mouse cada minuto y medio- no recibia nunca el
// cambio del supervisor. Solo lo destrababa ocultar la pestaña o refrescar.
//
// Ahora la espera se descuenta contra el momento en que la entrada se encolo:
// el diferimiento sigue protegiendo el hilo principal, pero tiene techo.
export function planRemoteStateApplyDelay({
    now = Date.now(),
    visible = true,
    activeView = "",
    pendingInput = false,
    lastUserActivityAt = 0,
    oldestQueuedAt = 0,
    urgent = false
} = {}) {
    if (!visible) return 0;

    // Sin marca de encolado no hay contra que descontar el techo, y diferir a
    // ciegas es exactamente como se llegaba a la espera infinita. Se aplica.
    if (!oldestQueuedAt) return 0;

    const waited = Math.max(0, now - oldestQueuedAt);
    const budget = Math.max(
        0,
        (urgent
            ? REMOTE_APPLY_URGENT_MAX_WAIT_MS
            : REMOTE_APPLY_MAX_WAIT_MS) - waited
    );

    if (budget <= 0) return 0;

    // Turnos, permisos, reemplazos: lo que el otro perfil ve en pantalla. Solo
    // se agrupa lo justo para no aplicar una edicion entrada por entrada.
    if (urgent) {
        return Math.min(budget, REMOTE_APPLY_URGENT_DELAY_MS);
    }

    const quietRemaining = Math.max(
        0,
        ENTRY_USER_QUIET_MS - Math.max(0, now - lastUserActivityAt)
    );
    const calendarView =
        activeView === "turnos" || activeView === "timeline";

    if (!pendingInput && !quietRemaining && !calendarView) return 0;

    return Math.min(budget, REMOTE_APPLY_BUSY_DELAY_MS);
}

function firebaseRemoteApplyDelay() {
    if (typeof document === "undefined") return 0;

    return planRemoteStateApplyDelay({
        visible: document.visibilityState === "visible",
        activeView: document.body?.dataset?.activeView || "",
        pendingInput: firebaseStateHasPendingInput(),
        lastUserActivityAt: entryLastUserActivityAt,
        oldestQueuedAt: remoteQueueOldestAt,
        urgent: pendingRemoteStateHasUrgentKey()
    });
}

export function remoteEntryId(entry = {}) {
    return [
        entry.moduleId,
        entry.storageKey,
        entry.itemKey || ""
    ].join("\u001e");
}

export function normalizeFirebaseStateDelay(
    delay,
    fallback = ENTRY_SYNC_DELAY_MS
) {
    const value = Number(delay);

    return Number.isFinite(value)
        ? Math.max(0, value)
        : Math.max(0, Number(fallback) || 0);
}

export function shouldDeferFirebaseEntrySlice({
    urgent = false,
    visible = false
} = {}) {
    return !urgent && visible;
}

export function normalizeQueuedStateEntries(entries = []) {
    return (Array.isArray(entries) ? entries : [])
        .flatMap(entry => {
            const storageKey = String(entry?.storageKey || "");
            const moduleId = String(
                entry?.moduleId || stateModuleForKey(storageKey) || ""
            );

            if (!storageKey || !moduleId) return [];

            const items =
                entry.items && typeof entry.items === "object"
                    ? entry.items
                    : {};
            const deletedItems =
                entry.deletedItems && typeof entry.deletedItems === "object"
                    ? entry.deletedItems
                    : {};
            const itemKeys = new Set([
                ...Object.keys(items),
                ...Object.keys(deletedItems)
            ]);

            // El contenedor viaja con cada elemento. Perderlo aqui convertia
            // una lista en objeto al reaplicar un cambio local pendiente, y todo
            // lo que la recorre reventaba: el calendario quedaba sin pintar una
            // sola casilla.
            // Solo se agrega cuando existe: un mapa por dia no lleva
            // contenedor, y sumarle un campo vacio cambiaria la forma de la
            // entrada para todos los demas caminos.
            const container = String(entry.container || "");
            const withContainer = base => (
                container ? { ...base, container } : base
            );

            if (itemKeys.size) {
                return [...itemKeys].map(itemKey => withContainer({
                    moduleId,
                    storageKey,
                    itemKey: decodePartialStateItemKey(itemKey),
                    value: items[itemKey],
                    deleted: deletedItems[itemKey] === true
                }));
            }

            return [withContainer({
                moduleId,
                storageKey,
                itemKey: String(entry.itemKey || ""),
                value: entry.value,
                deleted: entry.deleted === true
            })];
        });
}

function remoteEntryUpdatedAtMillis(entry = {}) {
    const explicitMillis = Number(entry.updatedAtMillis);

    if (Number.isFinite(explicitMillis) && explicitMillis > 0) {
        return explicitMillis;
    }

    const isoMillis = Date.parse(String(entry.updatedAtISO || ""));

    if (Number.isFinite(isoMillis) && isoMillis > 0) {
        return isoMillis;
    }

    return 0;
}

export function isRemoteStateEntryStaleForLocalChange(
    entry = {},
    localChange = {},
    now = Date.now(),
    protectionMs = LOCAL_ENTRY_PROTECTION_MS
) {
    const changedAt = Number(localChange.changedAt) || 0;

    if (!changedAt) return false;

    const remoteMillis = remoteEntryUpdatedAtMillis(entry);

    if (remoteMillis > 0) {
        return remoteMillis < changedAt;
    }

    return Number(now) - changedAt < protectionMs;
}

function cleanupLocalDirtyStateEntries(now = Date.now()) {
    localDirtyStateEntries.forEach((record, id) => {
        if (
            Number(now) - Number(record.changedAt || 0) >
            LOCAL_ENTRY_PROTECTION_MS
        ) {
            localDirtyStateEntries.delete(id);
        }
    });
}

function rememberLocalStateEntries(entries = [], changedAt = Date.now()) {
    cleanupLocalDirtyStateEntries(changedAt);

    normalizeQueuedStateEntries(entries).forEach(entry => {
        localDirtyStateEntries.set(remoteEntryId(entry), {
            entry,
            changedAt
        });
    });
}

function locallyProtectedEntries(moduleId = "") {
    cleanupLocalDirtyStateEntries();

    return [...localDirtyStateEntries.values()]
        .map(record => record.entry)
        .filter(entry =>
            !moduleId ||
            entry.moduleId === moduleId ||
            stateModuleForKey(entry.storageKey) === moduleId
        );
}

// Cuanto se espera sin que llegue otro modulo antes de repintar. Un poco mas
// que el viaje tipico entre modulos y bastante menos que lo que el ojo tolera
// como "lento".
const SETTLE_QUIET_MS = 400;
// Techo: en un entorno con edicion continua los modulos podrian no callarse
// nunca, y la pantalla no puede quedarse sin refrescar por eso.
const SETTLE_MAX_MS = 2500;

let settleStartedAt = 0;

function notifyStateSettled() {
    settleTimer = null;
    settleStartedAt = 0;

    if (!settledPending) return;

    const snapshot = settledSnapshot || {};

    settledPending = false;
    settledSnapshot = null;

    recordPerformanceEvent("firebase-app-state:settled", {
        type: "firebase",
        keyCount: Object.keys(snapshot).length
    });
    onStateChanged(snapshot);
}

/**
 * Junta los avisos de varios modulos en uno solo. Se repinta cuando pasan
 * SETTLE_QUIET_MS sin que llegue otro modulo, o al llegar al techo.
 */
function scheduleSettledNotify(snapshot) {
    settledPending = true;
    settledSnapshot = { ...(settledSnapshot || {}), ...(snapshot || {}) };

    const now = Date.now();

    if (!settleStartedAt) settleStartedAt = now;

    const delay = settleDelay(now - settleStartedAt);

    clearTimeout(settleTimer);

    if (delay <= 0) {
        notifyStateSettled();
        return;
    }

    settleTimer = setTimeout(notifyStateSettled, delay);
}

/**
 * Cuanto mas esperar antes de repintar, sabiendo cuanto lleva la espera.
 * Devuelve 0 cuando ya se llego al techo y hay que repintar ahora.
 */
export function settleDelay(elapsedMs) {
    const elapsed = Math.max(0, Number(elapsedMs) || 0);

    if (elapsed >= SETTLE_MAX_MS) return 0;

    return Math.min(SETTLE_QUIET_MS, SETTLE_MAX_MS - elapsed);
}

function mergeLocalDirtyStateEntries(snapshot = {}, moduleId = "") {
    const entries = locallyProtectedEntries(moduleId);

    if (!entries.length) return snapshot;

    return mergePartialStateEntries(snapshot, entries);
}

function shouldApplyRemoteStateEntry(entry = {}) {
    const id = remoteEntryId(entry);
    const localChange = localDirtyStateEntries.get(id);

    if (!localChange) return true;

    if (isRemoteStateEntryStaleForLocalChange(entry, localChange)) {
        recordPerformanceEvent("firebase-app-state:skip-stale-entry", {
            type: "firebase",
            moduleId: entry.moduleId,
            storageKey: entry.storageKey,
            itemKey: entry.itemKey || ""
        });
        return false;
    }

    localDirtyStateEntries.delete(id);
    return true;
}

function pendingRemoteStateHasUrgentKey() {
    for (const entry of pendingRemoteStateEntries.values()) {
        if (isWorkerCalendarUrgentStateKey(entry.storageKey)) return true;
    }

    return false;
}

function queueRemoteStateEntries(entries = []) {
    entries.forEach(entry => {
        if (!entry?.storageKey) return;
        pendingRemoteStateEntries.set(remoteEntryId(entry), entry);
    });

    // Marca de la entrada mas antigua sin aplicar: es contra ella que se
    // descuenta el techo de espera. No se pisa mientras quede cola, o el
    // diferimiento volveria a renovarse solo.
    if (pendingRemoteStateEntries.size && !remoteQueueOldestAt) {
        remoteQueueOldestAt = Date.now();
    }
}

function scheduleRemoteStateApply(delay = 0) {
    if (
        !pendingRemoteStateEntries.size ||
        remoteApplyInFlight ||
        !activeWorkspaceId
    ) return;

    clearTimeout(remoteApplyTimer);
    remoteApplyTimer = setTimeout(
        flushRemoteStateEntries,
        normalizeFirebaseStateDelay(delay, 0)
    );
}

async function flushRemoteStateEntries() {
    remoteApplyTimer = null;

    if (
        remoteApplyInFlight ||
        !activeWorkspaceId ||
        !pendingRemoteStateEntries.size
    ) return;

    // Bloqueado por copia vieja o discrepancia: se aplica ya. La espera existe
    // para no interrumpir a quien edita, y ahora no se puede editar.
    const delay = stateLockReason ? 0 : firebaseRemoteApplyDelay();

    if (delay > 0) {
        recordPerformanceEvent("firebase-app-state:apply-deferred", {
            type: "firebase",
            reason: "foreground-busy",
            delay,
            pendingCount: pendingRemoteStateEntries.size,
            activeView: document.body?.dataset?.activeView || ""
        });
        scheduleRemoteStateApply(delay);
        return;
    }

    remoteApplyInFlight = true;
    let batchGapPending = false;

    try {
        while (pendingRemoteStateEntries.size && activeWorkspaceId) {
            const batchSize =
                !stateLockReason &&
                typeof document !== "undefined" &&
                document.visibilityState === "visible"
                    ? REMOTE_APPLY_BATCH_SIZE
                    : pendingRemoteStateEntries.size;
            const entries = [...pendingRemoteStateEntries.values()]
                .slice(0, batchSize);

            entries.forEach(entry =>
                pendingRemoteStateEntries.delete(remoteEntryId(entry))
            );

            applyRemoteStateEntries(entries);

            if (!pendingRemoteStateEntries.size) break;

            if (
                typeof document !== "undefined" &&
                document.visibilityState === "visible"
            ) {
                // Se cede el hilo entre tandas, pero el resto de la rafaga
                // vuelve en milisegundos. Aqui se reprogramaba con la espera
                // completa: una edicion de varias entradas tardaba minutos en
                // verse entera. (Ademas la llamada era inerte:
                // `scheduleRemoteStateApply` se descarta con el apply en vuelo,
                // asi que el gap real lo ponia el `finally`.)
                batchGapPending = true;
                return;
            }

            await waitFirebaseStateIdle(600);
        }
    } finally {
        remoteApplyInFlight = false;

        if (pendingRemoteStateEntries.size) {
            scheduleRemoteStateApply(
                batchGapPending
                    ? REMOTE_APPLY_BATCH_GAP_MS
                    : firebaseRemoteApplyDelay()
            );
        } else {
            remoteQueueOldestAt = 0;
            releaseLockWhenApplied();
        }

        // El apply remoto es justo lo que bloquea el envio local: al terminar
        // hay que devolverle el turno, o lo encolado se queda sin timer.
        if (pendingStateEntries.size) {
            scheduleEntrySyncRetry();
        }
    }
}

function moduleDocRef(db, firestoreModule, workspaceId, moduleId) {
    return firestoreModule.doc(
        db,
        "workspaces",
        workspaceId,
        "stateModules",
        moduleId
    );
}

function moduleChunksCollection(
    db,
    firestoreModule,
    workspaceId,
    moduleId
) {
    return firestoreModule.collection(
        db,
        "workspaces",
        workspaceId,
        "stateModules",
        moduleId,
        "chunks"
    );
}

function moduleEntriesCollection(
    db,
    firestoreModule,
    workspaceId,
    moduleId
) {
    return firestoreModule.collection(
        db,
        "workspaces",
        workspaceId,
        "stateModules",
        moduleId,
        "entries"
    );
}

function entryDocId(storageKey) {
    const source = String(storageKey || "");
    const encoded = encodeURIComponent(source);

    if (encoded.length <= 900) return encoded;

    return `entry_${hashString(source)}`;
}

function getClientId() {
    const existing = getRaw(CLIENT_ID_KEY, "");

    if (existing) return existing;

    const nextId =
        globalThis.crypto?.randomUUID?.() ||
        `client_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    setRaw(CLIENT_ID_KEY, nextId);
    return nextId;
}

function stableSnapshotString(snapshot = {}) {
    const ordered = {};

    Object.keys(snapshot)
        .filter(key => !isInternalKey(key))
        .sort()
        .forEach(key => {
            ordered[key] = snapshot[key];
        });

    return JSON.stringify(ordered);
}

function currentModuleSnapshot(moduleId) {
    return splitSnapshotByStateModule(
        exportLocalSnapshot()
    )[moduleId] || {};
}

function currentModuleStateString(moduleId) {
    return stableSnapshotString(currentModuleSnapshot(moduleId));
}

// JSON.stringify no garantiza el orden de claves entre dos lecturas distintas
// del SDK. Se ordena a mano para que la firma solo cambie cuando cambia el dato.
function stableValueString(value) {
    if (value === undefined) return "null";

    if (value === null || typeof value !== "object") {
        return JSON.stringify(value) ?? "null";
    }

    if (Array.isArray(value)) {
        return `[${value.map(stableValueString).join(",")}]`;
    }

    return `{${Object.keys(value)
        .sort()
        .map(key => `${JSON.stringify(key)}:${stableValueString(value[key])}`)
        .join(",")}}`;
}

export function remoteEntrySignature(entry = {}) {
    return hashString(
        `${entry.deleted === true ? "1" : "0"}|${stableValueString(entry.value)}`
    );
}

// Firestore notifica por DOCUMENTO. Como todos los elementos de una clave
// comparten documento, tocar uno reenvia los N: `changeCount: 1` con
// `entryCount: 15`. Aplicar los 15 no solo cuesta, ademas repinta la vista
// entera por un cambio de uno. Aqui se quedan solo los que de verdad cambiaron.
export function selectUnappliedStateEntries(
    entries = [],
    signatures = new Map()
) {
    return entries.filter(entry => {
        const known = signatures.get(remoteEntryId(entry));

        return known === undefined || known !== remoteEntrySignature(entry);
    });
}

function rememberAppliedStateEntries(entries = []) {
    entries.forEach(entry => {
        if (!entry?.storageKey) return;

        const moduleId = String(entry.moduleId || "");
        let moduleSignatures = appliedEntrySignatures.get(moduleId);

        if (!moduleSignatures) {
            moduleSignatures = new Map();
            appliedEntrySignatures.set(moduleId, moduleSignatures);
        }

        moduleSignatures.set(
            remoteEntryId(entry),
            remoteEntrySignature(entry)
        );
    });
}

// Cuando el estado local de un modulo se reescribe entero por fuera de estas
// firmas, dejan de describir lo aplicado. Se olvidan: mas vale reaplicar de mas
// que filtrar un elemento que hacia falta.
function forgetAppliedStateEntries(moduleId) {
    appliedEntrySignatures.delete(String(moduleId || ""));
}

function moduleAppliedSignatures(moduleId) {
    return appliedEntrySignatures.get(String(moduleId || "")) ||
        EMPTY_SIGNATURES;
}

function hashString(value) {
    let hash = 2166136261;

    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return `${value.length}-${(hash >>> 0).toString(36)}`;
}

async function services() {
    if (!servicesCache) {
        // El total de tener Firebase listo. Se reparte entre
        // `firebase:load-modules` y `firebase:appcheck-token`; lo que no cuadre
        // con esas dos es la inicializacion en si.
        servicesCache = await measurePerformance(
            "firebase-app-state:services",
            () => getFirebaseServices(),
            {},
            { asyncThreshold: 40 }
        );
    }

    return servicesCache;
}

function canWriteModule(moduleId) {
    const permission = stateModulePermission(moduleId);

    if (permission === "owner") {
        return isWorkspaceOwner();
    }

    return canEditMenu(permission);
}

function canReadModule(moduleId) {
    const permission = stateModulePermission(moduleId);

    if (permission === "owner") {
        return isWorkspaceOwner();
    }

    return canViewMenu(permission);
}

// Reintento para cuando el envio local no puede salir AHORA porque hay un
// apply remoto en curso, el estado inicial todavia no llega o ya hay un envio
// volando. Los tres son transitorios: se despejan solos.
//
// Existe aparte de `scheduleEntrySync` justo porque aquella descarta la
// programacion ante esas mismas condiciones. Si nadie reintenta, el cambio se
// queda encolado sin timer, y al vencer su proteccion local de 30 minutos el
// estado remoto lo pisa: el usuario ve su cambio aparecer y desaparecer solo.
function scheduleEntrySyncRetry(delay = ENTRY_BLOCKED_RETRY_MS) {
    if (!pendingStateEntries.size || !activeWorkspaceId) return;

    clearTimeout(entrySyncTimer);
    entrySyncTimer = setTimeout(flushPartialStateEntries, delay);
}

function scheduleEntrySync(delay = ENTRY_SYNC_DELAY_MS, options = {}) {
    if (options.urgent) {
        urgentEntrySyncPending = true;
    }

    if (
        !pendingStateEntries.size ||
        !activeWorkspaceId ||
        applyingRemoteState ||
        waitingInitialState ||
        entrySyncInFlight
    ) return;

    clearTimeout(entrySyncTimer);
    entrySyncTimer = setTimeout(
        flushPartialStateEntries,
        normalizeFirebaseStateDelay(delay, ENTRY_SYNC_DELAY_MS)
    );
}

function queueGroupedPartialStateEntries(entries = []) {
    normalizeQueuedStateEntries(entries).forEach(entry => {
        const id = [
            entry.moduleId,
            entry.storageKey,
            entry.itemKey || ""
        ].join("\u001e");

        pendingStateEntries.set(id, entry);
    });

    // Igual que en la cola de bajada: la marca es de la entrada mas antigua sin
    // subir, y no se pisa mientras quede cola. Es contra ella que se descuenta
    // `ENTRY_MAX_WAIT_MS`.
    if (pendingStateEntries.size && !pendingEntriesOldestAt) {
        pendingEntriesOldestAt = Date.now();
    }
}

function queuePartialStateEntries(entries = [], options = {}) {
    if (options.urgent) {
        urgentEntrySyncPending = true;
    }

    rememberLocalStateEntries(entries);
    queueGroupedPartialStateEntries(entries);

    if (!pendingStateEntries.size || !activeWorkspaceId) return;

    if (applyingRemoteState || waitingInitialState) {
        scheduleEntrySyncRetry();
        return;
    }

    scheduleEntrySync(
        options.urgent ? 0 : ENTRY_SYNC_DELAY_MS,
        { urgent: options.urgent }
    );
}

function pendingStateEntryId(entry = {}) {
    return [
        entry.moduleId,
        entry.storageKey,
        entry.itemKey || ""
    ].join("\u001e");
}

async function commitPartialStateDocumentsNow(
    documents = [],
    {
        workspaceId = activeWorkspaceId,
        reason = "manual-flush"
    } = {}
) {
    if (!workspaceId || !documents.length) return;

    const { db, firestoreModule } = await services();
    const batch = firestoreModule.writeBatch(db);

    documents.forEach(entry => {
        const payload = {
            moduleId: entry.moduleId,
            storageKey: entry.storageKey,
            clientId: getClientId(),
            updatedAtISO: new Date().toISOString(),
            updatedAt: firestoreModule.serverTimestamp()
        };

        if (
            Object.keys(entry.items || {}).length ||
            Object.keys(entry.deletedItems || {}).length
        ) {
            payload.items = entry.items || {};
            payload.deletedItems = entry.deletedItems || {};

            // Igual que en el envio normal: quien lea el documento tiene que
            // saber si parchea una lista o un mapa.
            if (entry.container) payload.container = entry.container;
        }

        if (Object.prototype.hasOwnProperty.call(entry, "value")) {
            payload.value = entry.value;
            payload.deleted = entry.deleted;
        }

        batch.set(
            firestoreModule.doc(
                moduleEntriesCollection(
                    db,
                    firestoreModule,
                    workspaceId,
                    entry.moduleId
                ),
                entryDocId(entry.storageKey)
            ),
            payload,
            { merge: true }
        );
    });

    try {
        await measurePerformance(
            "firebase-app-state:commit-entries-now",
            () => batch.commit(),
            {
                reason,
                documentCount: documents.length,
                moduleIds: Array.from(
                    new Set(documents.map(entry => entry.moduleId))
                ).join(",")
            },
            {
                asyncThreshold: 120
            }
        );
    } catch (error) {
        // Diagnostico: si Firestore rechaza por tamano de payload (o "Transaction
        // too big"), adjuntamos que claves/modulos son los mas pesados para
        // ubicar el origen.
        if (/payload size exceeds|too big|maximum|exceeds the maximum/i.test(String(error?.message || ""))) {
            const sizes = documents
                .map(entry => {
                    let bytes = 0;
                    try {
                        bytes = JSON.stringify(
                            entry.value !== undefined ? entry.value : entry.items || {}
                        ).length;
                    } catch (_) {
                        bytes = -1;
                    }
                    return {
                        key: `${entry.moduleId}/${entry.storageKey}`,
                        kb: Math.round(bytes / 1024)
                    };
                })
                .sort((a, b) => b.kb - a.kb)
                .slice(0, 4)
                .map(item => `${item.key}=${item.kb}KB`)
                .join(", ");
            const err = new Error(`${error.message} [top: ${sizes}]`);
            err.code = error.code;
            throw err;
        }
        throw error;
    }
}

function isStoredListRaw(raw) {
    if (typeof raw !== "string" || !raw.trimStart().startsWith("[")) {
        return false;
    }

    try {
        return Array.isArray(JSON.parse(raw));
    } catch {
        return false;
    }
}

export async function flushPendingFirebaseAppStateEntries({
    keys = [],
    changes = {},
    reason = "manual-flush"
} = {}) {
    if (!activeWorkspaceId) {
        return {
            flushed: false,
            count: 0,
            reason: "no-workspace"
        };
    }

    const stateKeys = Array.from(new Set(
        (Array.isArray(keys) ? keys : [keys])
            .map(key => String(key || "").trim())
            .filter(key => key && !isInternalKey(key))
    ));

    if (!stateKeys.length) {
        return {
            flushed: false,
            count: 0,
            reason: "no-keys"
        };
    }

    // Una LISTA sin su cambio a mano no se vuelve a planificar desde cero. Sin la
    // version anterior no hay contra que diferenciar, y publicar la copia local
    // entera pisaba la de la nube: el 2026-09-15 una sesion con la lista de
    // reemplazos vacia confirmo un guardado y dejo 1 registro de 492. Los
    // cambios reales de una lista ya estan en la cola desde que se hicieron.
    const planKeys = stateKeys.filter(key =>
        Object.prototype.hasOwnProperty.call(changes || {}, key) ||
        !isStoredListRaw(getRaw(key, null))
    );
    const planned = planPartialStateEntries({
        keys: planKeys,
        changes,
        readRaw: key => getRaw(key, null),
        moduleForKey: stateModuleForKey
    }).filter(entry => canWriteModule(entry.moduleId));
    const stateKeySet = new Set(stateKeys);
    const queued = [...pendingStateEntries.values()]
        .filter(entry => stateKeySet.has(entry.storageKey))
        .filter(entry => canWriteModule(entry.moduleId));
    const writable = [
        ...planned,
        ...queued
    ];

    // Solo listas y nada en cola ni en camino: lo que hay que confirmar ya esta
    // en la nube.
    if (
        !writable.length &&
        planKeys.length < stateKeys.length &&
        !entrySyncInFlight
    ) {
        return {
            flushed: true,
            count: 0,
            reason: "already-synced"
        };
    }

    if (!writable.length) {
        return {
            flushed: false,
            count: 0,
            reason: "no-writable-entries"
        };
    }

    const documents = groupPartialStateEntries(writable);

    try {
        rememberLocalStateEntries(writable);
        await commitPartialStateDocumentsNow(documents, { reason });

        writable.forEach(entry => {
            pendingStateEntries.delete(pendingStateEntryId(entry));
        });

        if (!pendingStateEntries.size) {
            pendingEntriesOldestAt = 0;
        }

        dispatchStatus({
            type: "app-state-entries-saved",
            count: writable.length,
            reason
        });

        return {
            flushed: true,
            count: writable.length,
            documentCount: documents.length
        };
    } catch (error) {
        queueGroupedPartialStateEntries(writable);
        scheduleEntrySync(0, { urgent: true });
        throw error;
    }
}

async function flushPartialStateEntries() {
    entrySyncTimer = null;

    if (!activeWorkspaceId || !pendingStateEntries.size) return;

    if (applyingRemoteState || waitingInitialState || entrySyncInFlight) {
        scheduleEntrySyncRetry();
        return;
    }

    const urgent = urgentEntrySyncPending;
    urgentEntrySyncPending = false;
    const interactiveDelay = urgent ? 0 : firebaseStateInteractiveDelay();

    if (interactiveDelay > 0) {
        recordPerformanceEvent("firebase-app-state:commit-deferred", {
            type: "firebase",
            reason: "user-active",
            delay: interactiveDelay,
            pendingCount: pendingStateEntries.size
        });
        scheduleEntrySync(interactiveDelay);
        return;
    }

    entrySyncInFlight = true;
    const workspaceId = activeWorkspaceId;
    const pending = [...pendingStateEntries.values()];
    pendingStateEntries.clear();
    const writable = pending.filter(entry =>
        canWriteModule(entry.moduleId)
    );
    const documents = groupPartialStateEntries(writable);

    try {
        const { db, firestoreModule } = await services();

        for (
            let offset = 0;
            offset < documents.length;
            offset += ENTRY_BATCH_SIZE
        ) {
            if (workspaceId !== activeWorkspaceId) return;

            const deferredDelay = urgent ? 0 : firebaseStateInteractiveDelay();

            if (deferredDelay > 0) {
                queueGroupedPartialStateEntries(documents.slice(offset));
                recordPerformanceEvent("firebase-app-state:commit-deferred", {
                    type: "firebase",
                    reason: "user-active-before-slice",
                    delay: deferredDelay,
                    pendingCount: documents.length - offset
                });
                scheduleEntrySync(deferredDelay);
                return;
            }

            const batch = firestoreModule.writeBatch(db);
            const slice = documents.slice(
                offset,
                offset + ENTRY_BATCH_SIZE
            );

            slice.forEach(entry => {
                const payload = {
                    moduleId: entry.moduleId,
                    storageKey: entry.storageKey,
                    clientId: getClientId(),
                    updatedAtISO: new Date().toISOString(),
                    updatedAt: firestoreModule.serverTimestamp()
                };

                if (
                    Object.keys(entry.items).length ||
                    Object.keys(entry.deletedItems).length
                ) {
                    payload.items = entry.items;
                    payload.deletedItems = entry.deletedItems;

                    // Una lista se parchea elemento por elemento; un mapa, por
                    // clave. Quien lea el documento tiene que saber cual es.
                    if (entry.container) payload.container = entry.container;
                }

                if (Object.prototype.hasOwnProperty.call(entry, "value")) {
                    payload.value = entry.value;
                    payload.deleted = entry.deleted;
                }

                batch.set(
                    firestoreModule.doc(
                        moduleEntriesCollection(
                            db,
                            firestoreModule,
                            workspaceId,
                            entry.moduleId
                        ),
                        entryDocId(entry.storageKey)
                    ),
                    payload,
                    { merge: true }
                );
            });

            await measurePerformance(
                "firebase-app-state:commit-entries",
                () => batch.commit(),
                {
                    documentCount: slice.length,
                    entryCount: writable.length,
                    moduleIds: Array.from(
                        new Set(slice.map(entry => entry.moduleId))
                    ).join(",")
                },
                {
                    asyncThreshold: 120
                }
            );

            if (offset + ENTRY_BATCH_SIZE < documents.length) {
                const visible =
                    typeof document !== "undefined" &&
                    document.visibilityState === "visible";

                if (shouldDeferFirebaseEntrySlice({ urgent, visible })) {
                    queueGroupedPartialStateEntries(
                        documents.slice(offset + ENTRY_BATCH_SIZE)
                    );
                    recordPerformanceEvent("firebase-app-state:commit-deferred", {
                        type: "firebase",
                        reason: "one-visible-slice-per-flush",
                        delay: ENTRY_ACTIVE_RETRY_MS,
                        pendingCount:
                            documents.length -
                            (offset + ENTRY_BATCH_SIZE)
                    });
                    // Un documento por vuelta sigue cediendo el hilo, pero el
                    // resto de la rafaga vuelve enseguida: con los 10 s de antes
                    // una edicion de varias claves tardaba minutos en publicarse.
                    scheduleEntrySync(ENTRY_SLICE_GAP_MS);
                    return;
                }

                if (!urgent) {
                    await waitFirebaseStateIdle(1200);
                }
            }
        }

        dispatchStatus({
            type: "app-state-entries-saved",
            count: writable.length
        });
        markServerSync();
    } catch (error) {
        pending.forEach(entry => {
            const id = [
                entry.moduleId,
                entry.storageKey,
                entry.itemKey || ""
            ].join("\u001e");
            pendingStateEntries.set(id, entry);
        });
        dispatchStatus({
            type: "app-state-error",
            message: error.message || "Error guardando cambios parciales"
        });
        console.warn(
            "No se pudieron guardar los cambios parciales del estado.",
            error
        );
    } finally {
        entrySyncInFlight = false;

        if (pendingStateEntries.size) {
            scheduleEntrySync(
                urgentEntrySyncPending ? 0 : firebaseStateInteractiveDelay(),
                { urgent: urgentEntrySyncPending }
            );
        } else {
            pendingEntriesOldestAt = 0;
        }
    }
}

// Firestore no avisa "me quede sin servidor": sigue sirviendo desde su cache y
// encolando las escrituras. `metadata.fromCache` es la senal honesta de que lo
// que se esta pintando no viene confirmado por el servidor.
//
// Cada modulo tiene su listener y no siempre coinciden: al reconectar, uno
// puede seguir en cache unos segundos mientras los demas ya volvieron. Con un
// solo indicador compartido cada snapshot pisaba al anterior y el aviso de
// caida parpadeaba. Una caida de verdad deja a TODOS en cache (el estado de
// conexion del SDK es uno solo), y basta UNO confirmado por el servidor para
// saber que hay conexion.
//
// Solo se avisa en los CAMBIOS del agregado, no en cada snapshot.
function noteServerReachability(moduleId, metadata) {
    const fromCache = metadata?.fromCache;

    if (typeof fromCache !== "boolean") return;

    servingFromCacheByModule.set(moduleId, fromCache);

    const allFromCache = [...servingFromCacheByModule.values()].every(Boolean);

    if (allFromCache === servingFromCache) return;

    servingFromCache = allFromCache;

    dispatchStatus({
        type: allFromCache ? "app-state-offline" : "app-state-online"
    });
}

function dispatchStatus(detail) {
    if (typeof window === "undefined") return;

    window.dispatchEvent(
        new CustomEvent("proturnos:firebaseAppState", {
            detail
        })
    );
}

async function readRemoteModuleSnapshot(
    workspaceId,
    moduleId,
    expectedChunkCount
) {
    const { db, firestoreModule } = await services();
    const snap = await firestoreModule.getDocs(
        moduleChunksCollection(
            db,
            firestoreModule,
            workspaceId,
            moduleId
        )
    );
    const chunks = snap.docs
        .map(docSnap => ({
            id: docSnap.id,
            index: Number(docSnap.data()?.index) || 0,
            text: String(docSnap.data()?.text || "")
        }))
        .sort((a, b) =>
            a.index - b.index ||
            a.id.localeCompare(b.id)
        );

    if (
        Number.isFinite(Number(expectedChunkCount)) &&
        chunks.length < Number(expectedChunkCount)
    ) {
        throw new Error(
            `El modulo ${moduleId} aun no esta completo.`
        );
    }

    const stateString = chunks.map(chunk => chunk.text).join("");

    return {
        stateString,
        snapshot: JSON.parse(stateString || "{}")
    };
}

function stateEntriesFromDoc(docSnap) {
    const data = docSnap.data() || {};
    const updatedAtMillis =
        typeof data.updatedAt?.toMillis === "function"
            ? data.updatedAt.toMillis()
            : Date.parse(String(data.updatedAtISO || "")) || 0;
    const base = {
        moduleId: String(data.moduleId || ""),
        storageKey: String(data.storageKey || ""),
        clientId: String(data.clientId || ""),
        updatedAtISO: String(data.updatedAtISO || ""),
        updatedAtMillis
    };

    if (!base.storageKey) return [];

    if (
        data.items &&
        typeof data.items === "object"
    ) {
        const deletedItems = data.deletedItems || {};
        const itemKeys = new Set([
            ...Object.keys(data.items),
            ...Object.keys(deletedItems)
        ]);
        const items = [...itemKeys].map(itemKey => ({
            ...base,
            itemKey: decodePartialStateItemKey(itemKey),
            container: String(data.container || ""),
            value: data.items[itemKey],
            deleted: deletedItems[itemKey] === true
        }));

        // Una clave que ANTES viajaba entera y ahora se parte por elemento deja
        // su `value` viejo en el documento: merge no borra campos. Ese valor es
        // una foto anterior a los items, asi que se aplica PRIMERO y los items
        // la parchean encima. Ignorarlo perderia lo que solo viviera ahi.
        if (Object.prototype.hasOwnProperty.call(data, "value")) {
            return [
                {
                    ...base,
                    itemKey: "",
                    value: data.value,
                    deleted: data.deleted === true
                },
                ...items
            ];
        }

        return items;
    }

    return [{
        ...base,
        itemKey: String(data.itemKey || ""),
        value: data.value,
        deleted: data.deleted === true
    }];
}

async function readRemoteModuleEntries(
    workspaceId,
    moduleId
) {
    const { db, firestoreModule } = await services();
    const snap = await firestoreModule.getDocs(
        moduleEntriesCollection(
            db,
            firestoreModule,
            workspaceId,
            moduleId
        )
    );
    const entries = snap.docs
        .flatMap(stateEntriesFromDoc)
        .filter(entry => entry.storageKey);

    if (entries.length) entryModulesPresent.add(moduleId);
    return entries;
}

function applyRemoteStateEntries(entries = []) {
    return measurePerformance(
        "firebase-app-state:apply-entries",
        () => {
            const applicableEntries = entries.filter(shouldApplyRemoteStateEntry);

            if (!applicableEntries.length) return;

            const storageKeys = new Set(
                applicableEntries.map(entry => entry.storageKey)
            );
            const snapshot = {};
            storageKeys.forEach(key => {
                snapshot[key] = getRaw(key, null);
            });
            mergePartialStateEntries(snapshot, applicableEntries);
            const patch = {};
            storageKeys.forEach(key => {
                patch[key] = Object.prototype.hasOwnProperty.call(
                    snapshot,
                    key
                )
                    ? snapshot[key]
                    : null;
            });

            applyingRemoteState = true;
            let changedKeys = [];

            try {
                changedKeys = measurePerformance(
                    "firebase-app-state:apply-local-patch",
                    () => applyLocalPatch(patch, { silent: true }),
                    {
                        entryCount: applicableEntries.length,
                        patchKeyCount: Object.keys(patch).length
                    }
                );
            } finally {
                applyingRemoteState = false;
            }

            // Se anota DESPUES del parche: si `applyLocalPatch` revienta, la
            // entrada sigue sin firma y el proximo snapshot la reintenta.
            rememberAppliedStateEntries(applicableEntries);

            if (changedKeys.length) {
                dispatchStatus({
                    type: "app-state-entries-applied",
                    keys: changedKeys
                });
                onStateChanged(patch, {
                    partial: true,
                    keys: changedKeys
                });
            }
        },
        {
            entryCount: entries.length
        }
    );
}

function handleEntriesSnapshot(
    snap,
    moduleId,
    workspaceId,
    generation
) {
    if (
        workspaceId !== activeWorkspaceId ||
        generation !== syncGeneration
    ) return;

    // Antes del corte por snapshot vacio: un snapshot sin cambios tambien dice
    // de donde vienen los datos. Los que traen SOLO eso (el listener pide
    // includeMetadataChanges) terminan en ese corte: docChanges() los excluye.
    noteServerReachability(moduleId, snap?.metadata);

    if (snap?.metadata?.fromCache === false) markServerSync();

    const changes = typeof snap.docChanges === "function"
        ? snap.docChanges()
        : snap.docs.map(doc => ({ type: "added", doc }));
    const entries = changes
        .filter(change => change.type !== "removed")
        .flatMap(change => stateEntriesFromDoc(change.doc))
        .filter(entry => entry.storageKey);

    if (!entries.length) return;

    entryModulesPresent.add(moduleId);

    const changedEntries = selectUnappliedStateEntries(
        entries,
        moduleAppliedSignatures(moduleId)
    );

    recordPerformanceEvent("firebase-app-state:entries-snapshot", {
        type: "firebase",
        moduleId,
        entryCount: entries.length,
        changeCount: changes.length,
        queuedCount: changedEntries.length,
        skippedCount: entries.length - changedEntries.length
    });

    if (!changedEntries.length) return;

    // Varios puntos distintos de la copia local -o claves que esta copia ni
    // tiene-: no se deja editar encima y se aplica ya (ver js/syncFreshness.js).
    // Un cambio de una sola entrada, lo normal, ni se mide.
    const discrepant = !waitingInitialState &&
        changedEntries.length + pendingRemoteStateEntries.size >= 2 &&
        isRemoteDiscrepant(measureRemoteDiscrepancy(
            [...pendingRemoteStateEntries.values(), ...changedEntries],
            key => getRaw(key, null)
        ));

    if (discrepant) lockAppState("discrepancy");

    queueRemoteStateEntries(changedEntries);
    scheduleRemoteStateApply(discrepant ? 0 : firebaseRemoteApplyDelay());
}

async function applyRemoteModule(
    moduleId,
    manifest,
    workspaceId,
    generation
) {
    if (
        workspaceId !== activeWorkspaceId ||
        generation !== syncGeneration
    ) {
        return;
    }

    const remoteHash = String(manifest?.hash || "");
    const localHash = hashString(currentModuleStateString(moduleId));

    if (
        remoteHash &&
        (
            remoteHash === lastAppliedHashes.get(moduleId) ||
            remoteHash === localHash
        )
    ) {
        return;
    }

    const { stateString, snapshot } =
        await readRemoteModuleSnapshot(
            workspaceId,
            moduleId,
            manifest?.chunkCount || 0
        );
    const entries = await readRemoteModuleEntries(
        workspaceId,
        moduleId
    );
    const mergedSnapshot = mergePartialStateEntries(
        { ...snapshot },
        entries
    );
    mergeLocalDirtyStateEntries(mergedSnapshot, moduleId);

    if (
        workspaceId !== activeWorkspaceId ||
        generation !== syncGeneration
    ) {
        return;
    }

    applyingRemoteState = true;

    try {
        measurePerformance(
            "firebase-app-state:replace-module-subset",
            () => replaceLocalSnapshotSubset(
                mergedSnapshot,
                key => stateModuleForKey(key) === moduleId,
                { silent: true }
            ),
            {
                moduleId,
                keyCount: Object.keys(mergedSnapshot).length,
                stateLength: stateString.length
            }
        );
        lastAppliedHashes.set(
            moduleId,
            remoteHash || hashString(stateString)
        );
    } finally {
        applyingRemoteState = false;
    }

    // La lectura completa ya dejo estos elementos aplicados. Sin anotarlos, el
    // primer snapshot de la suscripcion los trae todos como "added" y se
    // reaplicarian enteros.
    rememberAppliedStateEntries(entries);

    dispatchStatus({
        type: "app-state-module-applied",
        moduleId,
        hash: lastAppliedHashes.get(moduleId)
    });
    scheduleSettledNotify(mergedSnapshot);
}

/**
 * Lanza la lectura de las entradas de todos los modulos legibles.
 *
 * Va EN PARALELO con la de los documentos de modulo porque no depende de ella:
 * las entradas se piden por `moduleId`, no por lo que traigan esos documentos.
 * Medido el 2026-09-22 en prod: encoladas costaban 43,7 + 7,95 = 51,6 s.
 *
 * Cada modulo responde por si mismo: con un `Promise.all` pelado, un solo
 * `permission-denied` rechaza el lote y se pierde la hidratacion entera. Es el
 * incidente del 2026-09-09, y este camino no tenia el arreglo.
 */
function readAllModuleEntries(workspaceId, readableModules) {
    return Promise.all(
        readableModules.map(async moduleId => {
            try {
                const entries = await measurePerformance(
                    "firebase-app-state:hydrate-entries",
                    () => readRemoteModuleEntries(workspaceId, moduleId),
                    { moduleId },
                    { asyncThreshold: 40 }
                );

                return { moduleId, entries };
            } catch (error) {
                dispatchStatus({
                    type: "app-state-error",
                    moduleId,
                    message: error?.message ||
                        "No se pudieron leer las entradas del modulo"
                });
                console.warn(
                    `No se pudieron leer las entradas de ${moduleId}.`,
                    error
                );

                return { moduleId, entries: [] };
            }
        })
    );
}

async function applyInitialModules(
    moduleDocs,
    workspaceId,
    generation,
    entriesPromise
) {
    const mergedSnapshot = {};
    const manifests = moduleDocs.filter(({ docSnap }) =>
        docSnap.exists()
    );

    // Sondas de diagnostico. La hidratacion entera se medía con UNA sonda
    // (`firebase-app-state:start-sync`), que el 2026-09-22 marco 128 SEGUNDOS en
    // prod sin decir de que: son 17 modulos, cada uno con su manifiesto (mas sus
    // trozos) y su coleccion de entradas. Con el reparto por MODULO se sabe cual
    // pesa; el `log` movia 3.300 entradas en otra medicion.
    for (const { moduleId, docSnap } of manifests) {
        const manifest = docSnap.data() || {};
        const { stateString, snapshot } =
            await measurePerformance(
                "firebase-app-state:hydrate-manifest",
                () => readRemoteModuleSnapshot(
                    workspaceId,
                    moduleId,
                    manifest.chunkCount || 0
                ),
                {
                    moduleId,
                    chunkCount: manifest.chunkCount || 0
                },
                { asyncThreshold: 40 }
            );

        Object.assign(mergedSnapshot, snapshot);
        lastAppliedHashes.set(
            moduleId,
            String(manifest.hash || "") || hashString(stateString)
        );
    }

    const initialEntries = [];

    // Ya pedidas: la lectura arranco en paralelo con la de los documentos de
    // modulo (ver readAllModuleEntries, en startFirebaseAppStateSync).
    const lecturas = await entriesPromise;

    // El mezclado sigue siendo EN ORDEN de modulo: se lee a la vez, pero la foto
    // se arma en la misma secuencia que antes. `Promise.all` conserva el orden
    // del arreglo, asi que esto no depende de cual termine primero.
    for (const { moduleId, entries } of lecturas) {
        initialEntries.push(...entries);

        // El mezclado va aparte de la lectura: uno es red y el otro es CPU, y
        // mezclarlos en una sola cifra fue justo lo que despisto con
        // `start-sync`.
        measurePerformance(
            "firebase-app-state:hydrate-merge",
            () => mergePartialStateEntries(mergedSnapshot, entries),
            {
                moduleId,
                entryCount: entries.length
            },
            { threshold: 20 }
        );
    }

    // Copia de mas de un dia: manda el servidor, sin encimarle nada local. La
    // edicion estuvo bloqueada, asi que lo pendiente lo genero la app sola
    // -saneados, predefinidos- sobre datos viejos, y se regenera con los nuevos.
    if (staleStart) {
        pendingStateEntries.clear();
        localDirtyStateEntries.clear();
    }

    measurePerformance(
        "firebase-app-state:hydrate-merge-local",
        () => mergeLocalDirtyStateEntries(mergedSnapshot),
        { entryCount: localDirtyStateEntries.size },
        { threshold: 20 }
    );

    if (
        workspaceId !== activeWorkspaceId ||
        generation !== syncGeneration
    ) {
        return;
    }

    applyingRemoteState = true;

    try {
        measurePerformance(
            "firebase-app-state:replace-initial-snapshot",
            () => replaceLocalSnapshot(mergedSnapshot, { silent: true }),
            {
                moduleCount: manifests.length,
                keyCount: Object.keys(mergedSnapshot).length
            }
        );
    } finally {
        applyingRemoteState = false;
    }

    // Una firma por entrada, y cada firma serializa el valor entero
    // (stableValueString ordena claves y recorre en profundidad).
    measurePerformance(
        "firebase-app-state:hydrate-remember",
        () => rememberAppliedStateEntries(initialEntries),
        { entryCount: initialEntries.length },
        { threshold: 20 }
    );

    // Se leyo bien: se abre la compuerta y se olvida la espera acumulada.
    clearInitialStateRetry();
    initialStateRetryDelay = INITIAL_STATE_RETRY_MS;
    waitingInitialState = false;
    dispatchStatus({
        type: "app-state-applied",
        modules: Array.from(new Set([
            ...manifests.map(({ moduleId }) => moduleId),
            ...entryModulesPresent
        ])),
        empty:
            manifests.length === 0 &&
            entryModulesPresent.size === 0
    });
    onStateChanged(mergedSnapshot);

    // Leer del servidor es el contacto que cuenta para "hace cuanto".
    markServerSync({ force: true });
    staleStart = false;
    releaseLockWhenApplied();

    if (pendingStateEntries.size) {
        scheduleEntrySync(
            urgentEntrySyncPending ? 0 : ENTRY_SYNC_DELAY_MS,
            { urgent: urgentEntrySyncPending }
        );
    }
}

async function handleModuleSnapshot(
    docSnap,
    moduleId,
    workspaceId,
    generation
) {
    if (
        workspaceId !== activeWorkspaceId ||
        generation !== syncGeneration
    ) {
        return;
    }

    modulesApplying += 1;

    try {
        if (!docSnap.exists()) {
            // El estado vive en `entries`: que el documento del modulo no
            // exista es lo normal y no dice nada de lo que hay en la nube.
            //
            // Hasta el 2026-09-15 este aviso reemplazaba el modulo local por
            // los cambios propios de los ultimos 30 minutos -o lo vaciaba si
            // aun no llegaban las entradas-: la copia local quedaba sin
            // reemplazos ni bitacora hasta volver a aplicarlos. Ese dia, con la
            // lista vacia, se publico 1 reemplazo encima de 492.
            return;
        }

        await applyRemoteModule(
            moduleId,
            docSnap.data() || {},
            workspaceId,
            generation
        );
    } catch (error) {
        console.warn("No se pudo aplicar estado modular Firebase.", error);
        dispatchStatus({
            type: "app-state-error",
            moduleId,
            message: error.message || "Error leyendo estado remoto"
        });
    } finally {
        modulesApplying = Math.max(0, modulesApplying - 1);
    }
}

/** Modulos que se estan aplicando ahora. Lo usan las pruebas y el diagnostico. */
export function pendingStateModuleCount() {
    return modulesApplying;
}

function clearInitialStateRetry() {
    clearTimeout(initialStateRetryTimer);
    initialStateRetryTimer = null;
}

// Reintenta el arranque con espera creciente. Mientras tanto la sesion sigue
// sin publicar: es preferible que espere a que pise datos buenos con los suyos.
function scheduleInitialStateRetry(workspace, options) {
    const workspaceId = workspace?.id || "";

    if (!workspaceId || initialStateRetryTimer) return;

    const delay = initialStateRetryDelay;

    initialStateRetryDelay = Math.min(
        initialStateRetryDelay * 2,
        INITIAL_STATE_RETRY_MAX_MS
    );

    initialStateRetryTimer = setTimeout(() => {
        initialStateRetryTimer = null;

        // Si mientras tanto se cambio de unidad o ya arranco, no se insiste.
        if (activeWorkspaceId !== workspaceId || unsubscribeState) return;

        void startFirebaseAppStateSync(workspace, options);
    }, delay);
}

export async function startFirebaseAppStateSync(
    workspace,
    options = {}
) {
    const workspaceId = workspace?.id || "";

    // Fases que se REPARTEN el total. Las sondas sueltas dejaban huecos entre
    // ellas: el 2026-09-22 `start-sync` marcaba 53,6 s y lo medido sumaba ~9,5
    // (7,95 de lecturas, 1,5 de mezclado, 25 ms de firmas). Los otros 44 s no
    // estaban en ningun `await` instrumentado y tampoco eran CPU -la mayor
    // tarea larga era de 1,7 s-. Midiendo por tramos consecutivos, la suma
    // tiene que dar el total y el hueco no se puede esconder.
    let faseDesde = typeof performance !== "undefined"
        ? performance.now()
        : Date.now();
    const marcarFase = nombre => {
        const ahora = typeof performance !== "undefined"
            ? performance.now()
            : Date.now();

        recordPerformanceEvent(`firebase-app-state:fase-${nombre}`, {
            type: "firebase",
            duration: ahora - faseDesde
        });
        faseDesde = ahora;
    };

    onStateChanged =
        typeof options.onChange === "function"
            ? options.onChange
            : () => {};

    if (
        activeWorkspaceId === workspaceId &&
        (unsubscribeState || stateSyncStarting)
    ) {
        return;
    }

    stopFirebaseAppStateSync();
    activeWorkspaceId = workspaceId;
    syncGeneration++;
    const generation = syncGeneration;

    if (!activeWorkspaceId) return;

    waitingInitialState = true;
    stateSyncStarting = true;
    // Mas de un dia sin traer datos del servidor: no se edita hasta aplicar lo
    // del servidor (ver applyInitialModules).
    staleStart = localCopyIsStale(workspaceId);

    if (staleStart) lockAppState("stale");

    try {
        const { db, firestoreModule } = await services();
        marcarFase("servicios");

        const readableModules = stateModuleIds().filter(canReadModule);
        // Se PIDE ya, sin esperarla: corre junto a la lectura de los documentos
        // de modulo en vez de detras. Nunca rechaza -cada modulo atrapa lo
        // suyo-, asi que dejarla en vuelo si algo falla despues es seguro.
        const entriesPromise = readAllModuleEntries(
            workspaceId,
            readableModules
        );
        const moduleRefs = readableModules.map(moduleId => ({
            moduleId,
            ref: moduleDocRef(
                db,
                firestoreModule,
                workspaceId,
                moduleId
            )
        }));
        const ownerManifestPromise = isWorkspaceOwner()
            ? measurePerformance(
                "firebase-app-state:module-manifests-query",
                () => firestoreModule.getDocsFromServer(
                    firestoreModule.collection(
                        db,
                        "workspaces",
                        workspaceId,
                        "stateModules"
                    )
                ),
                { moduleCount: moduleRefs.length },
                { asyncThreshold: 40 }
            )
            : null;
        // Un modulo que se deniega NO puede tumbar la sincronizacion entera.
        //
        // Con Promise.all, un solo `permission-denied` rechazaba el lote, saltaba
        // al catch de abajo y la app quedaba en SOLO ESCRITURA: publicaba sin
        // leer nada, sin mas senal que un warning en consola. Paso el 2026-09-09
        // con `medicalEquipment`, cuyas reglas no se habian desplegado todavia:
        // basto ese modulo nuevo para que ningun supervisor volviera a recibir
        // cambios de NINGUN modulo (y para que un borrado local se publicara sin
        // que el estado remoto lo corrigiera).
        //
        // Los propietarios leen los manifiestos existentes con una consulta.
        // Los demas conservan lecturas individuales y errores por modulo.
        const moduleReads = await measurePerformance(
            "firebase-app-state:module-docs",
            async () => {
                if (ownerManifestPromise) {
                    try {
                        const manifests = await ownerManifestPromise;
                        const byId = new Map(
                            manifests.docs.map(docSnap => [docSnap.id, docSnap])
                        );
                        return moduleRefs.map(({ moduleId }) => {
                            const docSnap = byId.get(moduleId);
                            return {
                                moduleId,
                                docSnap: docSnap || { exists: () => false },
                                existe: Boolean(docSnap)
                            };
                        });
                    } catch (error) {
                        // Reglas antiguas pueden no permitir listar la coleccion.
                        if (error?.code !== "permission-denied") throw error;
                    }
                }

                return Promise.all(
                    moduleRefs.map(async ({ moduleId, ref }) => {
                        try {
                            const docSnap = await measurePerformance(
                                "firebase-app-state:module-doc",
                                () => firestoreModule.getDoc(ref),
                                { moduleId },
                                { asyncThreshold: 40 }
                            );

                            return { moduleId, docSnap, existe: docSnap.exists() };
                        } catch (error) {
                            return { moduleId, error };
                        }
                    })
                );
            },
            { moduleCount: moduleRefs.length },
            { asyncThreshold: 40 }
        );
        marcarFase("documentos");

        // Cuantos de los 17 EXISTEN. Si son cero, esos 43 s se gastan trayendo
        // documentos vacios: el estado real vive en las colecciones `entries`.
        recordPerformanceEvent("firebase-app-state:module-docs-existen", {
            type: "firebase",
            duration: 0,
            pedidos: moduleReads.length,
            existen: moduleReads.filter(item => item.existe).length
        });

        const deniedModules = moduleReads.filter(item => item.error);
        const moduleDocs = moduleReads.filter(item => !item.error);

        if (deniedModules.length) {
            // Se avisa por el canal de estado, no solo por consola: quedarse sin
            // leer un modulo es un problema que hay que poder ver.
            deniedModules.forEach(({ moduleId, error }) => {
                dispatchStatus({
                    type: "app-state-error",
                    moduleId,
                    message: error?.message || "No se pudo leer el modulo remoto"
                });
                console.warn(`No se pudo leer el modulo ${moduleId}.`, error);
            });
        }

        if (!moduleDocs.length && deniedModules.length) {
            throw deniedModules[0].error;
        }

        await applyInitialModules(
            moduleDocs,
            workspaceId,
            generation,
            entriesPromise
        );

        marcarFase("aplicar");

        if (
            workspaceId !== activeWorkspaceId ||
            generation !== syncGeneration
        ) {
            return;
        }

        const legibles = new Set(moduleDocs.map(item => item.moduleId));
        const refsLegibles = moduleRefs.filter(({ moduleId }) =>
            legibles.has(moduleId)
        );

        const unsubscribers = refsLegibles.map(({ moduleId, ref }) =>
            firestoreModule.onSnapshot(
                ref,
                docSnap =>
                    handleModuleSnapshot(
                        docSnap,
                        moduleId,
                        workspaceId,
                        generation
                    ),
                error => {
                    if (
                        workspaceId === activeWorkspaceId &&
                        generation === syncGeneration
                    ) {
                        dispatchStatus({
                            type: "app-state-error",
                            moduleId,
                            message:
                                error.message ||
                                "No se pudo leer el modulo remoto"
                        });
                    }
                    console.warn(
                        `No se pudo leer el modulo ${moduleId}.`,
                        error
                    );
                }
            )
        );
        const entryUnsubscribers = refsLegibles.map(({ moduleId }) =>
            firestoreModule.onSnapshot(
                moduleEntriesCollection(
                    db,
                    firestoreModule,
                    workspaceId,
                    moduleId
                ),
                // Sin esto Firestore no entrega el paso de cache a servidor si
                // no cambia un dato: la vuelta de la conexion llegaba con el
                // siguiente cambio de alguien, y el aviso de caida se quedaba
                // pegado mientras tanto.
                { includeMetadataChanges: true },
                snap => handleEntriesSnapshot(
                    snap,
                    moduleId,
                    workspaceId,
                    generation
                ),
                error => {
                    if (
                        workspaceId === activeWorkspaceId &&
                        generation === syncGeneration
                    ) {
                        // Un listener caido ya no informa: no puede quedar
                        // votando con su ultimo estado de conexion.
                        servingFromCacheByModule.delete(moduleId);
                        console.warn(
                            `No se pudieron leer cambios parciales de ${moduleId}.`,
                            error
                        );
                    }
                }
            )
        );

        unsubscribeStateEntries = () => {
            entryUnsubscribers.forEach(unsubscribe => unsubscribe());
        };

        unsubscribeState = () => {
            unsubscribers.forEach(unsubscribe => unsubscribe());
            unsubscribeStateEntries?.();
            unsubscribeStateEntries = null;
        };

        marcarFase("oyentes");
    } catch (error) {
        // NO se abre la compuerta de publicacion.
        //
        // `waitingInitialState` bloquea las subidas, y ponerlo en false aqui
        // convertia "no pude leer" en "puedo escribir": la sesion se quedaba
        // con su copia local y la publicaba encima de la del servidor sin
        // enterarse. Es lo que dejo pasar el borrado de la programacion de
        // tareas del 2026-09-09, con dos dias de reglas sin desplegar.
        //
        // Quedandose cerrada, las ediciones NO se pierden: las tres compuertas
        // reencolan (`scheduleEntrySyncRetry`) y salen cuando la lectura
        // vuelva. Por eso hace falta reintentar, o la sesion quedaria muda.
        scheduleInitialStateRetry(workspace, options);

        dispatchStatus({
            type: "app-state-blocked",
            workspaceId,
            message:
                "Sin sincronizacion con el servidor: tus cambios quedan en " +
                "espera y no se publican hasta recuperarla.",
            error: error?.message || String(error),
            retryInMs: initialStateRetryDelay
        });
        console.warn(
            "No se pudo iniciar sincronizacion modular Firebase.",
            error
        );
    } finally {
        stateSyncStarting = false;
    }
}

export function stopFirebaseAppStateSync() {
    clearInitialStateRetry();
    servingFromCacheByModule.clear();
    servingFromCache = null;
    unlockAppState();
    staleStart = false;
    freshnessCheckInFlight = false;
    clearTimeout(settleTimer);
    settleTimer = null;
    settleStartedAt = 0;
    settledPending = false;
    settledSnapshot = null;
    modulesApplying = 0;
    clearTimeout(entrySyncTimer);
    entrySyncTimer = null;
    clearTimeout(remoteApplyTimer);
    remoteApplyTimer = null;

    if (unsubscribeState) {
        unsubscribeState();
        unsubscribeState = null;
    }

    if (unsubscribeStateEntries) {
        unsubscribeStateEntries();
        unsubscribeStateEntries = null;
    }

    activeWorkspaceId = "";
    stateSyncStarting = false;
    applyingRemoteState = false;
    waitingInitialState = false;
    entrySyncInFlight = false;
    remoteApplyInFlight = false;
    remoteQueueOldestAt = 0;
    pendingEntriesOldestAt = 0;
    lastAppliedHashes.clear();
    pendingStateEntries.clear();
    pendingRemoteStateEntries.clear();
    localDirtyStateEntries.clear();
    appliedEntrySignatures.clear();
    entryModulesPresent.clear();
    syncGeneration++;
}

if (typeof window !== "undefined") {
    [
        "pointerdown",
        "keydown",
        "wheel",
        "touchstart",
        "input"
    ].forEach(eventName => {
        window.addEventListener(
            eventName,
            markFirebaseStateUserActivity,
            { capture: true, passive: true }
        );
    });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            scheduleEntrySync(0);
            scheduleRemoteStateApply(0);
            return;
        }

        // Volver a un computador que llevaba mas de un dia sin contacto.
        void confirmServerFreshness();
    });
    window.addEventListener("online", () => {
        void confirmServerFreshness();
    });

    window.addEventListener("proturnos:persistenceChanged", event => {
        const keys = event.detail?.keys || [];
        const stateKeys = keys.filter(key => !isInternalKey(key));

        if (!stateKeys.length) return;

        queuePartialStateEntries(
            planPartialStateEntries({
                keys: stateKeys,
                changes: event.detail?.changes || {},
                readRaw: key => getRaw(key, null),
                moduleForKey: stateModuleForKey
            }),
            {
                urgent: stateKeys.some(isWorkerCalendarUrgentStateKey)
            }
        );
    });
}
