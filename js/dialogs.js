const DIALOG_TONES = new Set(["info", "success", "warning", "danger"]);

const TONE_COPY = {
    info: {
        alertTitle: "Aviso",
        confirmTitle: "Confirmar acción",
        promptTitle: "Información requerida"
    },
    success: {
        alertTitle: "Operación completada",
        confirmTitle: "Confirmar acción",
        promptTitle: "Información requerida"
    },
    warning: {
        alertTitle: "Atención",
        confirmTitle: "Confirmar acción",
        promptTitle: "Verificación requerida"
    },
    danger: {
        alertTitle: "Acción importante",
        confirmTitle: "Confirmar acción",
        promptTitle: "Confirmación de seguridad"
    }
};

const ICONS = {
    info: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9"></circle>
            <path d="M12 10.8v5.3"></path>
            <path d="M12 7.6h.01"></path>
        </svg>
    `,
    success: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9"></circle>
            <path d="m8.2 12.2 2.5 2.5 5.3-5.4"></path>
        </svg>
    `,
    warning: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M10.3 4.7 3.2 17a2 2 0 0 0 1.7 3h14.2a2 2 0 0 0 1.7-3L13.7 4.7a2 2 0 0 0-3.4 0Z"></path>
            <path d="M12 9v4.2"></path>
            <path d="M12 16.5h.01"></path>
        </svg>
    `,
    danger: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3.2 20.4 7v5.7c0 4.4-3.1 7.2-8.4 8.5-5.3-1.3-8.4-4.1-8.4-8.5V7L12 3.2Z"></path>
            <path d="M12 8.5v4.7"></path>
            <path d="M12 16.3h.01"></path>
        </svg>
    `
};

let dialogQueue = Promise.resolve();
let alertOverrideInstalled = false;

function normalizeMessage(message) {
    if (message instanceof Error) {
        return message.message || "Ocurrió un error inesperado.";
    }

    if (message === undefined || message === null) return "";

    return String(message);
}

function inferAlertTone(message) {
    const value = normalizeMessage(message).toLocaleLowerCase("es");

    if (
        /\b(error|fall[oó]|no se pudo|no fue posible|bloque[oó]|desactivad[oa]|no tienes permiso)\b/.test(
            value
        )
    ) {
        return "danger";
    }

    if (
        /\b(registrad[oa]|guardad[oa]|completad[oa]|enviad[oa]|actualizad[oa]|eliminad[oa]|cread[oa])\b/.test(
            value
        )
    ) {
        return "success";
    }

    if (
        /\b(debes|selecciona|ingresa|indica|completa|no hay|no quedan|no puede|no se puede|permite)\b/.test(
            value
        )
    ) {
        return "warning";
    }

    return "info";
}

function normalizeTone(tone, message, type) {
    if (DIALOG_TONES.has(tone)) return tone;
    if (type === "alert") return inferAlertTone(message);
    if (type === "prompt") return "danger";
    return "warning";
}

function enqueueDialog(factory) {
    const pending = dialogQueue.then(factory, factory);

    dialogQueue = pending.catch(() => {});

    return pending;
}

function createDialog({
    type,
    message,
    title,
    tone,
    confirmText,
    cancelText,
    value,
    placeholder,
    inputLabel,
    inputType,
    destructive
}) {
    return new Promise(resolve => {
        const normalizedMessage = normalizeMessage(message);
        const normalizedTone = normalizeTone(tone, normalizedMessage, type);
        const previousFocus =
            document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
        const backdrop = document.createElement("div");
        const dialog = document.createElement("section");
        const headingId = `app-dialog-title-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`;
        const descriptionId = `${headingId}-description`;

        backdrop.className = "app-dialog-backdrop";
        backdrop.dataset.dialogType = type;
        dialog.className = `app-dialog app-dialog--${normalizedTone}`;
        dialog.setAttribute("role", type === "alert" ? "alertdialog" : "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-labelledby", headingId);
        dialog.setAttribute("aria-describedby", descriptionId);
        dialog.innerHTML = `
            <div class="app-dialog__accent" aria-hidden="true"></div>
            <div class="app-dialog__header">
                <span class="app-dialog__icon">${ICONS[normalizedTone]}</span>
                <div class="app-dialog__heading">
                    <span class="app-dialog__eyebrow">TurnoPlus</span>
                    <h2 id="${headingId}"></h2>
                </div>
            </div>
            <div class="app-dialog__body">
                <p id="${descriptionId}" class="app-dialog__message"></p>
            </div>
            <div class="app-dialog__actions"></div>
        `;

        dialog.querySelector(`#${headingId}`).textContent =
            title ||
            TONE_COPY[normalizedTone][
                type === "alert"
                    ? "alertTitle"
                    : type === "prompt"
                      ? "promptTitle"
                      : "confirmTitle"
            ];
        dialog.querySelector(`#${descriptionId}`).textContent =
            normalizedMessage;

        const body = dialog.querySelector(".app-dialog__body");
        const actions = dialog.querySelector(".app-dialog__actions");
        let input = null;
        let settled = false;

        if (type === "prompt") {
            const field = document.createElement("label");
            const label = document.createElement("span");

            field.className = "app-dialog__field";
            label.className = "app-dialog__field-label";
            label.textContent = inputLabel || "Escribe la información solicitada";
            input = document.createElement("input");
            input.className = "app-dialog__input";
            input.type = inputType || "text";
            input.value = value === undefined || value === null
                ? ""
                : String(value);
            input.placeholder = placeholder || "";
            input.autocomplete = "off";
            field.append(label, input);
            body.append(field);
        }

        const cancelButton = document.createElement("button");
        const confirmButton = document.createElement("button");

        cancelButton.type = "button";
        cancelButton.className =
            "app-dialog__button app-dialog__button--secondary";
        cancelButton.textContent = cancelText || "Cancelar";

        confirmButton.type = "button";
        confirmButton.className =
            "app-dialog__button app-dialog__button--primary";
        if (destructive || normalizedTone === "danger") {
            confirmButton.classList.add("app-dialog__button--danger");
        }
        confirmButton.textContent =
            confirmText || (type === "alert" ? "Entendido" : "Continuar");

        if (type !== "alert") {
            actions.append(cancelButton);
        }
        actions.append(confirmButton);
        backdrop.append(dialog);
        document.body.append(backdrop);
        document.body.classList.add("app-dialog-open");

        const finish = result => {
            if (settled) return;
            settled = true;
            document.removeEventListener("keydown", onKeydown, true);
            backdrop.classList.add("is-closing");

            window.setTimeout(() => {
                backdrop.remove();
                if (!document.querySelector(".app-dialog-backdrop")) {
                    document.body.classList.remove("app-dialog-open");
                }
                if (previousFocus?.isConnected) previousFocus.focus();
                resolve(result);
            }, 150);
        };

        const accept = () => {
            if (type === "prompt") {
                finish(input.value);
                return;
            }

            finish(true);
        };

        const cancel = () => {
            finish(type === "alert" ? true : type === "prompt" ? null : false);
        };

        function onKeydown(event) {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                cancel();
                return;
            }

            if (event.key !== "Enter" || event.shiftKey) return;

            event.preventDefault();
            event.stopPropagation();
            accept();
        }

        confirmButton.addEventListener("click", accept);
        cancelButton.addEventListener("click", cancel);
        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) cancel();
        });
        document.addEventListener("keydown", onKeydown, true);

        window.requestAnimationFrame(() => {
            backdrop.classList.add("is-visible");
            (input || confirmButton).focus();
            if (input) input.select();
        });
    });
}

export function showAlert(message, options = {}) {
    return enqueueDialog(() =>
        createDialog({
            ...options,
            type: "alert",
            message
        })
    );
}

export function showConfirm(message, options = {}) {
    return enqueueDialog(() =>
        createDialog({
            ...options,
            type: "confirm",
            message
        })
    );
}

export function showPrompt(message, options = {}) {
    return enqueueDialog(() =>
        createDialog({
            ...options,
            type: "prompt",
            message
        })
    );
}

export function installAppDialogs() {
    if (
        alertOverrideInstalled ||
        typeof window === "undefined" ||
        typeof document === "undefined"
    ) {
        return;
    }

    alertOverrideInstalled = true;
    window.alert = message => {
        void showAlert(message);
    };
}
