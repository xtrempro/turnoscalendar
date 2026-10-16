// El mismo motor que corre dentro del Worker. Se importa tambien aqui para
// poder calcular en el hilo principal cuando el Worker no esta disponible:
// pasa, por ejemplo, con una pestaña abierta desde antes de un despliegue,
// donde el archivo del Worker ya no existe y el servidor devuelve el index
// (el navegador lo rechaza por MIME y nunca arranca).
import { runScheduleTask } from "./workers/scheduleWorker.js";

const DEFAULT_TIMEOUT_MS = 30000;
const WORKER_UNAVAILABLE = "worker-unavailable";

let scheduleWorker = null;
let taskSequence = 0;
// Una vez que el Worker demostro que no puede arrancar, no vale la pena
// volver a intentarlo en cada tarea: se calcula aqui de entrada.
let workerUnavailable = false;
const pendingTasks = new Map();
const channelTasks = new Map();

function abortError(message = "Tarea cancelada") {
    const error = new Error(message);
    error.name = "AbortError";
    return error;
}

function workerUnavailableError(message) {
    const error = new Error(message);
    error.code = WORKER_UNAVAILABLE;
    return error;
}

function runTaskOnMainThread(type, payload, cause = null) {
    if (cause) {
        console.warn(
            `El Web Worker no pudo con ${type}; se calcula en esta pestaña.`,
            cause
        );
    }

    return new Promise(resolve => resolve(runScheduleTask(type, payload)));
}

function scheduleWorkerUrl() {
    if (typeof __SCHEDULE_WORKER_URL__ !== "undefined") {
        return new URL(__SCHEDULE_WORKER_URL__, globalThis.location?.href);
    }

    return new URL("./workers/scheduleWorker.js", import.meta.url);
}

function rejectPendingTask(taskId, error, notifyWorker = false) {
    const pending = pendingTasks.get(taskId);
    if (!pending) return;

    pendingTasks.delete(taskId);
    clearTimeout(pending.timeoutId);
    pending.signal?.removeEventListener("abort", pending.onAbort);

    if (pending.channel && channelTasks.get(pending.channel) === taskId) {
        channelTasks.delete(pending.channel);
    }

    if (notifyWorker) {
        scheduleWorker?.postMessage({ type: "CANCEL_TASK", taskId });
    }

    pending.reject(error);
}

function rejectAll(error) {
    [...pendingTasks.keys()].forEach(taskId =>
        rejectPendingTask(taskId, error)
    );
}

function handleWorkerMessage(event) {
    const message = event.data || {};
    const pending = pendingTasks.get(message.taskId);

    if (!pending) return;

    pendingTasks.delete(message.taskId);
    clearTimeout(pending.timeoutId);
    pending.signal?.removeEventListener("abort", pending.onAbort);

    if (
        pending.channel &&
        channelTasks.get(pending.channel) === message.taskId
    ) {
        channelTasks.delete(pending.channel);
    }

    if (message.ok) {
        pending.resolve(message.payload);
    } else {
        pending.reject(new Error(message.error || "Falló el Web Worker."));
    }
}

function ensureScheduleWorker() {
    if (scheduleWorker) return scheduleWorker;

    if (typeof Worker === "undefined") {
        workerUnavailable = true;
        throw workerUnavailableError("Este navegador no soporta Web Workers.");
    }

    try {
        scheduleWorker = new Worker(scheduleWorkerUrl(), { type: "module" });
    } catch (error) {
        workerUnavailable = true;
        throw workerUnavailableError(
            error?.message || "No se pudo iniciar el Web Worker."
        );
    }

    scheduleWorker.addEventListener("message", handleWorkerMessage);
    scheduleWorker.addEventListener("error", event => {
        // Un "error" del Worker es que no cargo: su codigo no alcanza a
        // lanzar nada (el motor atrapa sus propias excepciones y las
        // responde como mensaje).
        workerUnavailable = true;
        rejectAll(workerUnavailableError(
            event.message || "El Web Worker dejó de responder."
        ));
        scheduleWorker?.terminate();
        scheduleWorker = null;
    });
    scheduleWorker.addEventListener("messageerror", () => {
        // Datos que no se pudieron clonar: es de esta tarea, el Worker sigue
        // sano.
        rejectAll(workerUnavailableError(
            "El Web Worker devolvió datos inválidos."
        ));
    });

    return scheduleWorker;
}

function postWorkerTask(
    worker,
    type,
    payload,
    {
        timeoutMs = DEFAULT_TIMEOUT_MS,
        signal = null,
        channel = "",
        replaceChannel = true
    } = {}
) {
    const taskId = `schedule_${Date.now()}_${++taskSequence}`;

    if (channel && replaceChannel) {
        const previousTaskId = channelTasks.get(channel);
        if (previousTaskId) {
            rejectPendingTask(
                previousTaskId,
                abortError("Resultado reemplazado por una solicitud más reciente."),
                true
            );
        }
        channelTasks.set(channel, taskId);
    }

    return new Promise((resolve, reject) => {
        const onAbort = () =>
            rejectPendingTask(taskId, abortError(), true);
        const timeoutId = setTimeout(() => {
            rejectPendingTask(
                taskId,
                new Error(`La tarea ${type} excedió ${timeoutMs} ms.`),
                true
            );
        }, Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));

        pendingTasks.set(taskId, {
            resolve,
            reject,
            timeoutId,
            signal,
            onAbort,
            channel
        });
        signal?.addEventListener("abort", onAbort, { once: true });
        worker.postMessage({ taskId, type, payload });
    });
}

export function runWorkerTask(type, payload, options = {}) {
    const { signal = null } = options;

    if (signal?.aborted) {
        return Promise.reject(abortError());
    }

    // Que el Worker no arranque no puede costarle el trabajo al supervisor:
    // la rotativa se calcula igual, con el mismo motor, en esta pestaña.
    if (workerUnavailable) {
        return runTaskOnMainThread(type, payload);
    }

    let worker = null;

    try {
        worker = ensureScheduleWorker();
    } catch (error) {
        if (error?.code !== WORKER_UNAVAILABLE) throw error;

        return runTaskOnMainThread(type, payload, error);
    }

    return postWorkerTask(worker, type, payload, options).catch(error => {
        if (error?.code !== WORKER_UNAVAILABLE) throw error;
        if (signal?.aborted) throw abortError();

        return runTaskOnMainThread(type, payload, error);
    });
}

export function cancelWorkerChannel(channel) {
    const taskId = channelTasks.get(String(channel || ""));
    if (!taskId) return false;

    rejectPendingTask(taskId, abortError(), true);
    return true;
}

export function terminateScheduleWorker() {
    rejectAll(abortError("Web Worker finalizado."));
    scheduleWorker?.terminate();
    scheduleWorker = null;
    channelTasks.clear();
}

export function calculateMonthInWorker(payload, options = {}) {
    return runWorkerTask("CALCULATE_MONTH", payload, options);
}

export function generateScheduleInWorker(payload, options = {}) {
    return runWorkerTask("GENERATE_SCHEDULE", payload, options);
}

export function validateAbsencesInWorker(payload, options = {}) {
    return runWorkerTask("VALIDATE_ABSENCES", payload, options);
}

export function searchReplacementsInWorker(payload, options = {}) {
    return runWorkerTask("SEARCH_REPLACEMENTS", payload, options);
}
