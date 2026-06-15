let busySequence = 0;
const activeBusyStates = [];

function ensureBusyIndicator() {
    let indicator =
        document.getElementById("appBusyIndicator");

    if (indicator) return indicator;

    indicator = document.createElement("div");
    indicator.id = "appBusyIndicator";
    indicator.className = "app-busy-indicator";
    indicator.setAttribute("role", "status");
    indicator.setAttribute("aria-live", "polite");
    indicator.innerHTML = `
        <span class="app-busy-indicator__spinner" aria-hidden="true"></span>
        <span data-busy-label>Procesando...</span>
    `;
    document.body.appendChild(indicator);

    return indicator;
}

function syncBusyState() {
    if (typeof document === "undefined" || !document.body) {
        return;
    }

    const active =
        activeBusyStates[activeBusyStates.length - 1];
    const isBusy = Boolean(active);

    document.body.classList.toggle("app-is-busy", isBusy);

    if (!isBusy) {
        document.body.removeAttribute("aria-busy");
        return;
    }

    document.body.setAttribute("aria-busy", "true");

    const label = ensureBusyIndicator()
        .querySelector("[data-busy-label]");

    if (label) {
        label.textContent = active.label;
    }
}

function waitForBusyPaint() {
    return new Promise(resolve => {
        if (typeof requestAnimationFrame !== "function") {
            setTimeout(resolve, 0);
            return;
        }

        requestAnimationFrame(() => {
            setTimeout(resolve, 0);
        });
    });
}

export function beginBusy(label = "Procesando...") {
    const state = {
        id: ++busySequence,
        label
    };

    activeBusyStates.push(state);
    syncBusyState();

    return () => {
        const index = activeBusyStates.findIndex(item =>
            item.id === state.id
        );

        if (index >= 0) {
            activeBusyStates.splice(index, 1);
        }

        syncBusyState();
    };
}

export async function withBusyState(
    callback,
    options = {}
) {
    const endBusy = beginBusy(
        options.label || "Procesando..."
    );

    try {
        if (options.paint !== false) {
            await waitForBusyPaint();
        }

        return await callback();
    } finally {
        endBusy();
    }
}
