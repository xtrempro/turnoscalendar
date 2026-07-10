const PERF_ENABLED_KEY = "proturnos_perf_monitor";
const PERF_EVENTS_KEY = "proturnos_perf_events";
const PERF_CONSOLE_KEY = "proturnos_perf_console";
const PERF_MAX_EVENTS = 240;
const LONG_TASK_THRESHOLD_MS = 50;
const SPAN_THRESHOLD_MS = 50;
const ASYNC_SPAN_THRESHOLD_MS = 180;

let enabled = false;
let observer = null;
let events = [];
let lastPersistAt = 0;

function roundDuration(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
}

function now() {
    return typeof performance !== "undefined" &&
        typeof performance.now === "function"
        ? performance.now()
        : Date.now();
}

function safeStorageGet(key) {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function safeStorageSet(key, value) {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // Si localStorage esta lleno o bloqueado, el monitor sigue en memoria.
    }
}

function safeStorageRemove(key) {
    try {
        window.localStorage.removeItem(key);
    } catch {
        // no-op
    }
}

function currentContext(extra = {}) {
    const body = typeof document !== "undefined"
        ? document.body
        : null;

    return {
        view: body?.dataset?.activeView || "",
        visibility:
            typeof document !== "undefined"
                ? document.visibilityState || ""
                : "",
        href:
            typeof window !== "undefined"
                ? `${window.location.pathname}${window.location.search}${window.location.hash}`
                : "",
        ...extra
    };
}

function isTruthyFlag(value) {
    return ["1", "true", "on", "yes", "si", "sí"].includes(
        String(value || "").trim().toLowerCase()
    );
}

function isFalsyFlag(value) {
    return ["0", "false", "off", "no"].includes(
        String(value || "").trim().toLowerCase()
    );
}

function defaultEnabled() {
    if (typeof window === "undefined") return false;

    const params = new URLSearchParams(window.location.search || "");
    const queryFlag = params.get("perf") || params.get("performance");

    if (isTruthyFlag(queryFlag)) return true;
    if (isFalsyFlag(queryFlag)) return false;

    const stored = safeStorageGet(PERF_ENABLED_KEY);

    if (isTruthyFlag(stored)) return true;
    if (isFalsyFlag(stored)) return false;

    const host = window.location.hostname || "";

    return (
        host.includes("turnoplus-test") ||
        host.includes("turnoplusfunc-test") ||
        host === "localhost" ||
        host === "127.0.0.1"
    );
}

function consoleLoggingEnabled() {
    if (typeof window === "undefined") return false;

    const params = new URLSearchParams(window.location.search || "");
    const queryFlag = params.get("perfLog") || params.get("performanceLog");

    if (isTruthyFlag(queryFlag)) return true;
    if (isFalsyFlag(queryFlag)) return false;

    return isTruthyFlag(safeStorageGet(PERF_CONSOLE_KEY));
}

function loadStoredEvents() {
    const raw = safeStorageGet(PERF_EVENTS_KEY);

    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);

        return Array.isArray(parsed)
            ? parsed.slice(-PERF_MAX_EVENTS)
            : [];
    } catch {
        return [];
    }
}

function persistEvents(force = false) {
    const timestamp = Date.now();

    if (!force && timestamp - lastPersistAt < 800) return;

    lastPersistAt = timestamp;
    safeStorageSet(
        PERF_EVENTS_KEY,
        JSON.stringify(events.slice(-PERF_MAX_EVENTS))
    );
}

function pushEvent(entry) {
    if (!enabled) return null;

    const {
        context,
        ...rest
    } = entry;
    const normalized = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        at: new Date().toISOString(),
        ...rest,
        ...currentContext(context),
        duration: roundDuration(entry.duration)
    };

    events.push(normalized);

    if (events.length > PERF_MAX_EVENTS) {
        events = events.slice(-PERF_MAX_EVENTS);
    }

    persistEvents(normalized.duration >= 250);

    if (typeof window !== "undefined") {
        window.dispatchEvent(
            new CustomEvent("proturnos:performance-event", {
                detail: normalized
            })
        );
    }

    if (consoleLoggingEnabled() && typeof console !== "undefined") {
        const method = normalized.duration >= 120 ? "warn" : "info";
        console[method](
            `[TurnoPlus perf] ${normalized.label || normalized.type}: ${normalized.duration} ms`,
            normalized
        );
    }

    return normalized;
}

function observeLongTasks() {
    if (
        typeof PerformanceObserver === "undefined" ||
        !PerformanceObserver.supportedEntryTypes?.includes("longtask")
    ) {
        pushEvent({
            type: "monitor",
            label: "performance-observer:longtask-no-disponible",
            duration: 0
        });
        return;
    }

    observer = new PerformanceObserver(list => {
        list.getEntries().forEach(entry => {
            if (entry.duration < LONG_TASK_THRESHOLD_MS) return;

            pushEvent({
                type: "longtask",
                label: "browser:long-task",
                duration: entry.duration,
                startTime: roundDuration(entry.startTime),
                attribution: Array.from(entry.attribution || []).map(item => ({
                    name: item.name || "",
                    entryType: item.entryType || "",
                    containerType: item.containerType || "",
                    containerName: item.containerName || "",
                    containerId: item.containerId || ""
                }))
            });
        });
    });

    observer.observe({ entryTypes: ["longtask"] });
}

export function initPerformanceMonitor(options = {}) {
    if (typeof window === "undefined" || enabled) return false;

    enabled = options.enabled ?? defaultEnabled();

    if (!enabled) {
        window.TurnoPlusPerf = {
            enable() {
                safeStorageSet(PERF_ENABLED_KEY, "1");
                window.location.reload();
            },
            disabled: true
        };
        return false;
    }

    events = loadStoredEvents();
    observeLongTasks();

    window.TurnoPlusPerf = {
        enabled: true,
        clear() {
            events = [];
            safeStorageRemove(PERF_EVENTS_KEY);
            return [];
        },
        consoleLogs(value = true) {
            safeStorageSet(PERF_CONSOLE_KEY, value ? "1" : "0");
            return value === true;
        },
        disable() {
            safeStorageSet(PERF_ENABLED_KEY, "0");
            observer?.disconnect?.();
            observer = null;
            enabled = false;
            return true;
        },
        enable() {
            safeStorageSet(PERF_ENABLED_KEY, "1");
            return true;
        },
        events() {
            return events.slice();
        },
        report(limit = 20) {
            return performanceReport(limit);
        },
        export() {
            return JSON.stringify(events.slice(), null, 2);
        }
    };

    pushEvent({
        type: "monitor",
        label: "performance-monitor:activo",
        duration: 0
    });

    return true;
}

export function isPerformanceMonitorEnabled() {
    return enabled;
}

export function recordPerformanceEvent(label, detail = {}) {
    return pushEvent({
        type: detail.type || "event",
        label,
        duration: Number(detail.duration) || 0,
        context: detail.context,
        detail
    });
}

export function startPerformanceSpan(label, detail = {}, options = {}) {
    if (!enabled) {
        return () => {};
    }

    const started = now();
    const threshold = Number.isFinite(Number(options.threshold))
        ? Number(options.threshold)
        : SPAN_THRESHOLD_MS;
    let closed = false;

    return (finishDetail = {}) => {
        if (closed) return null;

        closed = true;
        const duration = now() - started;

        if (duration < threshold) return null;

        return pushEvent({
            type: options.type || "span",
            label,
            duration,
            context: {
                ...detail,
                ...finishDetail
            }
        });
    };
}

export function measurePerformance(label, fn, detail = {}, options = {}) {
    if (!enabled || typeof fn !== "function") {
        return fn();
    }

    const started = now();
    const asyncThreshold = Number.isFinite(Number(options.asyncThreshold))
        ? Number(options.asyncThreshold)
        : ASYNC_SPAN_THRESHOLD_MS;
    const syncThreshold = Number.isFinite(Number(options.threshold))
        ? Number(options.threshold)
        : SPAN_THRESHOLD_MS;

    try {
        const result = fn();

        if (result && typeof result.then === "function") {
            return result.then(
                value => {
                    const duration = now() - started;

                    if (duration >= asyncThreshold) {
                        pushEvent({
                            type: options.type || "async-span",
                            label,
                            duration,
                            context: detail
                        });
                    }

                    return value;
                },
                error => {
                    const duration = now() - started;

                    pushEvent({
                        type: options.type || "async-span-error",
                        label,
                        duration,
                        context: {
                            ...detail,
                            error: error?.message || String(error)
                        }
                    });

                    throw error;
                }
            );
        }

        const duration = now() - started;

        if (duration >= syncThreshold) {
            pushEvent({
                type: options.type || "span",
                label,
                duration,
                context: detail
            });
        }

        return result;
    } catch (error) {
        const duration = now() - started;

        pushEvent({
            type: options.type || "span-error",
            label,
            duration,
            context: {
                ...detail,
                error: error?.message || String(error)
            }
        });

        throw error;
    }
}

export function performanceReport(limit = 20) {
    const max = Math.max(1, Number(limit) || 20);
    const grouped = new Map();

    events.forEach(entry => {
        const label = entry.label || entry.type || "sin-etiqueta";
        const current = grouped.get(label) || {
            label,
            count: 0,
            total: 0,
            max: 0,
            lastAt: ""
        };

        current.count++;
        current.total += Number(entry.duration) || 0;
        current.max = Math.max(current.max, Number(entry.duration) || 0);
        current.lastAt = entry.at || current.lastAt;
        grouped.set(label, current);
    });

    return Array.from(grouped.values())
        .map(item => ({
            ...item,
            total: roundDuration(item.total),
            avg: roundDuration(item.total / Math.max(1, item.count)),
            max: roundDuration(item.max)
        }))
        .sort((a, b) => b.max - a.max || b.total - a.total)
        .slice(0, max);
}
