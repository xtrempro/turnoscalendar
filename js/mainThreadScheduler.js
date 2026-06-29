export function yieldToMainThread() {
    if (typeof globalThis.scheduler?.yield === "function") {
        return globalThis.scheduler.yield();
    }

    return new Promise(resolve => setTimeout(resolve, 0));
}

export function scheduleIdleTask(callback, options = {}) {
    const timeout = Math.max(0, Number(options.timeout) || 700);

    if (typeof globalThis.requestIdleCallback === "function") {
        const id = globalThis.requestIdleCallback(callback, { timeout });

        return () => globalThis.cancelIdleCallback?.(id);
    }

    const id = setTimeout(callback, 0);

    return () => clearTimeout(id);
}

export async function runCooperativeRange(
    start,
    end,
    handler,
    {
        shouldContinue = () => true,
        yieldControl = yieldToMainThread
    } = {}
) {
    let processed = 0;

    for (let value = start; value <= end; value++) {
        if (!shouldContinue()) {
            return { completed: false, processed };
        }

        await handler(value);
        processed++;

        if (value < end) await yieldControl();
    }

    return {
        completed: shouldContinue(),
        processed
    };
}
