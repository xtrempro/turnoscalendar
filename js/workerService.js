const DEFAULT_TIMEOUT_MS = 30000;

let scheduleWorker = null;
let taskSequence = 0;
const pendingTasks = new Map();
const channelTasks = new Map();

function abortError(message = "Tarea cancelada") {
    const error = new Error(message);
    error.name = "AbortError";
    return error;
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
        throw new Error("Este navegador no soporta Web Workers.");
    }

    scheduleWorker = new Worker(scheduleWorkerUrl(), { type: "module" });
    scheduleWorker.addEventListener("message", handleWorkerMessage);
    scheduleWorker.addEventListener("error", event => {
        rejectAll(new Error(
            event.message || "El Web Worker dejó de responder."
        ));
        scheduleWorker?.terminate();
        scheduleWorker = null;
    });
    scheduleWorker.addEventListener("messageerror", () => {
        rejectAll(new Error("El Web Worker devolvió datos inválidos."));
    });

    return scheduleWorker;
}

export function runWorkerTask(
    type,
    payload,
    {
        timeoutMs = DEFAULT_TIMEOUT_MS,
        signal = null,
        channel = "",
        replaceChannel = true
    } = {}
) {
    const worker = ensureScheduleWorker();
    const taskId = `schedule_${Date.now()}_${++taskSequence}`;

    if (signal?.aborted) {
        return Promise.reject(abortError());
    }

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

export function buildInterUnitMonthsInWorker(payload, options = {}) {
    return runWorkerTask("BUILD_INTER_UNIT_MONTHS", payload, options);
}
