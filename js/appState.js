const listeners = new Set();

const state = {
    revision: 0,
    workers: [],
    workersById: new Map(),
    workerIdsByName: new Map(),
    shiftsByWorker: new Map(),
    absencesByWorker: new Map(),
    calendar: {
        workerId: "",
        workerName: "",
        year: new Date().getFullYear(),
        month: new Date().getMonth()
    },
    filters: {
        profiles: {
            role: "Todos",
            query: "",
            showInactive: false
        },
        calendar: {}
    },
    configuration: {}
};

function notify(type, detail = {}) {
    state.revision++;

    listeners.forEach(listener => {
        listener(state, { type, ...detail });
    });
}

export function getAppState() {
    return state;
}

export function subscribeAppState(listener) {
    if (typeof listener !== "function") return () => {};

    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function syncWorkersState(workers = []) {
    const normalized = Array.isArray(workers) ? workers : [];

    state.workers = normalized;
    state.workersById = new Map(
        normalized.map(worker => [String(worker?.id || worker?.name || ""), worker])
    );
    state.workerIdsByName = new Map(
        normalized.map(worker => [
            String(worker?.name || ""),
            String(worker?.id || worker?.name || "")
        ])
    );
    notify("workers");

    return normalized;
}

export function resolveWorkerId(workerOrName) {
    if (workerOrName && typeof workerOrName === "object") {
        return String(workerOrName.id || workerOrName.name || "");
    }

    const value = String(workerOrName || "");
    return state.workerIdsByName.get(value) || value;
}

export function syncWorkerCalendarState({
    worker,
    year,
    month,
    shifts = {},
    absences = {},
    configuration = {}
} = {}) {
    const workerId = resolveWorkerId(worker);
    const workerName = String(worker?.name || worker || "");

    state.calendar = {
        workerId,
        workerName,
        year: Number(year),
        month: Number(month)
    };
    state.shiftsByWorker.set(workerId, shifts);
    state.absencesByWorker.set(workerId, absences);
    state.configuration = {
        ...state.configuration,
        ...configuration
    };
    notify("calendar", { workerId });

    return getWorkerCalendarState(workerId);
}

export function getWorkerCalendarState(workerOrId) {
    const workerId = resolveWorkerId(workerOrId);

    return {
        workerId,
        worker: state.workersById.get(workerId) || null,
        shifts: state.shiftsByWorker.get(workerId) || {},
        absences: state.absencesByWorker.get(workerId) || {
            admin: {},
            legal: {},
            comp: {},
            absences: {}
        }
    };
}

export function updateWorkerCalendarMaps(workerOrId, patch = {}) {
    const workerId = resolveWorkerId(workerOrId);

    if (Object.prototype.hasOwnProperty.call(patch, "shifts")) {
        state.shiftsByWorker.set(workerId, patch.shifts || {});
    }

    if (patch.absences) {
        state.absencesByWorker.set(workerId, patch.absences);
    }

    notify("worker-calendar", { workerId });
}

export function setAppFilters(scope, patch = {}) {
    const key = String(scope || "calendar");

    state.filters[key] = {
        ...(state.filters[key] || {}),
        ...patch
    };
    notify("filters", { scope: key });

    return state.filters[key];
}

export function getAppFilters(scope) {
    return state.filters[String(scope || "calendar")] || {};
}
