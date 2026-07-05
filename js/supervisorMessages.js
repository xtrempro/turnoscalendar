import { escapeHTML } from "./htmlUtils.js";
import { normalizeText } from "./stringUtils.js";
import { getCurrentFirebaseUser, getFirebaseServices } from "./firebaseClient.js";
import { getWorkerAppLinks } from "./workerAppDataSync.js";
import { showConfirm } from "./dialogs.js";

let activeWorkspace = null;
let unreadUnsubscribe = null;
let messagesUnsubscribe = null;
let activeWorkerUid = "";
let activeMessages = [];
let unreadCount = 0;
let floatingButton = null;
let floatingBadge = null;
let dialog = null;
let workerSearch = "";
let massMode = false;
const massSelected = new Set();
let massText = "";
let massSending = false;

function initials(value) {
    return String(value || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0]?.toUpperCase() || "")
        .join("") || "TP";
}

function messageId() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function timestampToDate(value) {
    const date = value?.toDate?.() || new Date(value);

    return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatTime(value) {
    const date = timestampToDate(value);

    return new Intl.DateTimeFormat("es-CL", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);
}

function linkedWorkers() {
    return getWorkerAppLinks()
        .filter(link => link.uid)
        .map(link => ({
            uid: link.uid,
            name: link.profile?.name || link.profileName || "Trabajador",
            estamento: link.profile?.estamento || "",
            role: [
                link.profile?.estamento || "",
                link.profile?.profession || ""
            ].filter(Boolean).join(" | "),
            email: link.profile?.email || link.workerEmail || "",
            rut: link.profile?.rut || link.profileRut || "",
            link
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function selectedWorker() {
    const workers = linkedWorkers();

    return workers.find(worker => worker.uid === activeWorkerUid) ||
        workers[0] ||
        null;
}

function updateFloatingBadge() {
    if (!floatingBadge) return;

    floatingBadge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    floatingBadge.classList.toggle("hidden", unreadCount <= 0);
}

function messageComposer() {
    return dialog?.querySelector(
        "[data-supervisor-message-form] textarea"
    ) || null;
}

function focusMessageComposer() {
    window.requestAnimationFrame(() => {
        const textarea = messageComposer();

        if (!textarea || textarea.disabled) return;

        textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(
            textarea.value.length,
            textarea.value.length
        );
    });
}

function handleComposerKeydown(event) {
    if (
        event.key !== "Enter" ||
        event.shiftKey ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.isComposing
    ) {
        return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
}

function handleDialogKeydown(event) {
    if (event.key === "Escape") {
        event.preventDefault();
        closeMessagesDialog();
    }
}

export function initSupervisorMessages({ button, badge } = {}) {
    floatingButton = button || null;
    floatingBadge = badge || null;

    floatingButton?.addEventListener("click", openMessagesDialog);
    updateFloatingBadge();
}

export async function startSupervisorMessages(workspace) {
    stopSupervisorMessages();

    const workspaceId = String(workspace?.id || "").trim();
    if (!workspaceId) return;

    activeWorkspace = {
        id: workspaceId,
        name: workspace?.name || ""
    };

    try {
        const { db, firestoreModule } = await getFirebaseServices();
        const threadsRef = firestoreModule.collection(
            db,
            "workspaces",
            workspaceId,
            "workerMessages"
        );

        unreadUnsubscribe = firestoreModule.onSnapshot(
            threadsRef,
            snap => {
                unreadCount = snap.docs
                    .map(docSnap => docSnap.data() || {})
                    .filter(thread => thread.unreadForSupervisor === true)
                    .length;
                updateFloatingBadge();
                refreshDialog();
            },
            error => {
                console.warn("No se pudo leer mensajeria.", error);
            }
        );
    } catch (error) {
        console.warn("No se pudo iniciar mensajeria.", error);
    }
}

export function stopSupervisorMessages() {
    if (unreadUnsubscribe) {
        unreadUnsubscribe();
        unreadUnsubscribe = null;
    }

    stopMessagesSubscription();
    activeWorkspace = null;
    activeWorkerUid = "";
    activeMessages = [];
    unreadCount = 0;
    updateFloatingBadge();
    closeMessagesDialog();
}

function openMessagesDialog() {
    if (!getCurrentFirebaseUser()) {
        alert("Debes iniciar sesion para enviar mensajes.");
        return;
    }

    if (!activeWorkspace?.id) {
        alert("Selecciona una unidad Firebase para usar mensajeria.");
        return;
    }

    const workers = linkedWorkers();
    if (!activeWorkerUid && workers[0]) {
        activeWorkerUid = workers[0].uid;
    }

    dialog = document.createElement("div");
    dialog.className = "turn-change-dialog-backdrop supervisor-messages-backdrop";
    dialog.innerHTML = `
        <section class="supervisor-messages-dialog" role="dialog" aria-modal="true" aria-labelledby="supervisorMessagesTitle">
            <header class="supervisor-messages-header">
                <div>
                    <strong id="supervisorMessagesTitle">Mensajeria</strong>
                    <small>${escapeHTML(activeWorkspace.name || "TurnoPlus")}</small>
                </div>
                <div class="supervisor-messages-header-actions">
                    <button class="secondary-button supervisor-messages-mass-toggle" type="button" data-supervisor-mass-toggle>Mensaje masivo</button>
                    <button class="icon-button supervisor-messages-close" type="button" data-supervisor-message-close aria-label="Cerrar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                            <path d="M6 6l12 12"></path>
                            <path d="M18 6L6 18"></path>
                        </svg>
                    </button>
                </div>
            </header>
            <div class="supervisor-messages-body"></div>
        </section>
    `;

    dialog.addEventListener("click", event => {
        if (event.target === dialog) {
            closeMessagesDialog();
        }
    });
    dialog
        .querySelector("[data-supervisor-message-close]")
        ?.addEventListener("click", closeMessagesDialog);

    dialog
        .querySelector("[data-supervisor-mass-toggle]")
        ?.addEventListener("click", () => {
            massMode = !massMode;
            massSelected.clear();
            massText = "";
            updateMassToggleLabel();
            refreshDialog();
        });

    document.addEventListener("keydown", handleDialogKeydown);
    document.body.appendChild(dialog);
    updateMassToggleLabel();
    refreshDialog();
    subscribeSelectedWorkerMessages();
}

function updateMassToggleLabel() {
    const button = dialog?.querySelector("[data-supervisor-mass-toggle]");

    if (!button) return;

    button.textContent = massMode ? "Volver al chat" : "Mensaje masivo";
    button.classList.toggle("is-active", massMode);
}

function closeMessagesDialog() {
    document.removeEventListener("keydown", handleDialogKeydown);
    dialog?.remove();
    dialog = null;
    workerSearch = "";
    massMode = false;
    massSelected.clear();
    massText = "";
    massSending = false;
    stopMessagesSubscription();
}

function refreshDialog() {
    if (!dialog) return;

    const body = dialog.querySelector(".supervisor-messages-body");
    if (!body) return;

    const workers = linkedWorkers();

    if (!workers.length) {
        body.innerHTML = `
            <div class="supervisor-messages-empty">
                No hay trabajadores con aplicacion enlazada.
            </div>
        `;
        return;
    }

    if (massMode) {
        body.innerHTML = renderMassLayout(workers);
        bindMassLayout(body);
        bindWorkerSearch(body);
        applyWorkerSearchFilter();
        return;
    }

    const worker = selectedWorker();

    body.innerHTML = renderMessagesLayout(workers, worker);

    body.querySelectorAll("[data-message-worker]").forEach(button => {
        button.addEventListener("click", () => {
            activeWorkerUid = button.dataset.messageWorker || "";
            activeMessages = [];
            refreshDialog();
            subscribeSelectedWorkerMessages();
        });
    });

    bindWorkerSearch(body);
    applyWorkerSearchFilter();

    const form = body.querySelector("[data-supervisor-message-form]");
    form?.addEventListener("submit", sendSupervisorMessage);
    form
        ?.querySelector("textarea")
        ?.addEventListener("keydown", handleComposerKeydown);

    const list = body.querySelector(".supervisor-message-thread");
    if (list) {
        list.scrollTop = list.scrollHeight;
    }

    focusMessageComposer();
}

function bindWorkerSearch(body) {
    const searchInput = body.querySelector("[data-message-worker-search]");

    if (!searchInput) return;

    searchInput.addEventListener("input", () => {
        workerSearch = searchInput.value;
        applyWorkerSearchFilter();
    });
}

function workerSearchText(item) {
    return normalizeText(
        [item.name, item.role, item.email, item.rut]
            .filter(Boolean)
            .join(" ")
    );
}

function applyWorkerSearchFilter() {
    if (!dialog) return;

    const query = normalizeText(workerSearch);
    const buttons = dialog.querySelectorAll(
        ".supervisor-message-workers [data-search]"
    );
    let visibleCount = 0;

    buttons.forEach(button => {
        const matches =
            !query || (button.dataset.search || "").includes(query);

        button.classList.toggle("hidden", !matches);

        if (matches) visibleCount++;
    });

    const noResults = dialog.querySelector(".supervisor-message-no-results");

    if (noResults) {
        noResults.classList.toggle(
            "hidden",
            visibleCount > 0 || !buttons.length
        );
    }
}

function renderMessagesLayout(workers, worker) {
    return `
        <aside class="supervisor-message-workers">
            <div class="supervisor-message-search">
                <input type="search" data-message-worker-search placeholder="Buscar trabajador" value="${escapeHTML(workerSearch)}" autocomplete="off">
            </div>
            ${workers.map(item => `
                <button class="supervisor-message-worker ${item.uid === worker?.uid ? "is-active" : ""}" type="button" data-message-worker="${escapeHTML(item.uid)}" data-search="${escapeHTML(workerSearchText(item))}">
                    <span class="supervisor-message-avatar">${escapeHTML(initials(item.name))}</span>
                    <span>
                        <strong>${escapeHTML(item.name)}</strong>
                        <small>${escapeHTML(item.role || item.email || "App enlazada")}</small>
                    </span>
                </button>
            `).join("")}
            <div class="supervisor-message-no-results hidden">Sin resultados</div>
        </aside>
        <section class="supervisor-message-chat">
            <div class="supervisor-message-chat-head">
                <span class="supervisor-message-avatar">${escapeHTML(initials(worker?.name))}</span>
                <div>
                    <strong>${escapeHTML(worker?.name || "Trabajador")}</strong>
                    <small>${escapeHTML(worker?.email || worker?.rut || "App enlazada")}</small>
                </div>
            </div>
            <div class="supervisor-message-thread">
                ${activeMessages.length
                    ? activeMessages.map(renderMessageBubble).join("")
                    : `<div class="supervisor-messages-empty">Sin mensajes todavia.</div>`}
            </div>
            <form class="supervisor-message-form" data-supervisor-message-form>
                <textarea name="message" rows="2" maxlength="2000" placeholder="Escribe un mensaje para ${escapeHTML(worker?.name || "el trabajador")}"></textarea>
                <button class="primary-button" type="submit">Enviar</button>
            </form>
        </section>
    `;
}

function massGroups(workers) {
    const groups = new Map();

    workers.forEach(item => {
        const label = item.estamento || "Sin estamento";

        if (!groups.has(label)) {
            groups.set(label, []);
        }

        groups.get(label).push(item.uid);
    });

    return Array.from(groups.entries())
        .map(([label, uids]) => ({ label, uids }))
        .sort((a, b) => a.label.localeCompare(b.label, "es"));
}

function renderMassLayout(workers) {
    const groups = massGroups(workers);
    const selectedCount = workers
        .filter(item => massSelected.has(item.uid))
        .length;

    return `
        <aside class="supervisor-message-workers">
            <div class="supervisor-message-search">
                <input type="search" data-message-worker-search placeholder="Buscar trabajador" value="${escapeHTML(workerSearch)}" autocomplete="off">
            </div>
            ${workers.map(item => `
                <label class="supervisor-mass-worker ${massSelected.has(item.uid) ? "is-selected" : ""}" data-search="${escapeHTML(workerSearchText(item))}">
                    <input type="checkbox" data-mass-worker="${escapeHTML(item.uid)}" ${massSelected.has(item.uid) ? "checked" : ""}>
                    <span class="supervisor-message-avatar">${escapeHTML(initials(item.name))}</span>
                    <span>
                        <strong>${escapeHTML(item.name)}</strong>
                        <small>${escapeHTML(item.role || item.email || "App enlazada")}</small>
                    </span>
                </label>
            `).join("")}
            <div class="supervisor-message-no-results hidden">Sin resultados</div>
        </aside>
        <section class="supervisor-message-mass">
            <div class="supervisor-message-mass-head">
                <strong>Mensaje masivo</strong>
                <small data-mass-count>${selectedCount} seleccionado(s)</small>
            </div>
            <div class="supervisor-mass-groups">
                <button type="button" class="supervisor-mass-chip" data-mass-group="__all__">Todos (${workers.length})</button>
                <button type="button" class="supervisor-mass-chip" data-mass-group="__none__">Ninguno</button>
                ${groups.map(group => `
                    <button type="button" class="supervisor-mass-chip" data-mass-group="${escapeHTML(group.label)}">${escapeHTML(group.label)} (${group.uids.length})</button>
                `).join("")}
            </div>
            <textarea class="supervisor-mass-text" data-mass-text rows="4" maxlength="2000" placeholder="Escribe el mensaje para los trabajadores seleccionados (por ejemplo, el link de una reunion).">${escapeHTML(massText)}</textarea>
            <button class="primary-button supervisor-mass-send" type="button" data-mass-send ${massSending ? "disabled" : ""}>
                ${massSending ? "Enviando..." : `Enviar a ${selectedCount}`}
            </button>
        </section>
    `;
}

function syncMassSelectionUI() {
    if (!dialog) return;

    const count = massSelected.size;
    const countEl = dialog.querySelector("[data-mass-count]");

    if (countEl) {
        countEl.textContent = `${count} seleccionado(s)`;
    }

    const sendButton = dialog.querySelector("[data-mass-send]");

    if (sendButton && !massSending) {
        sendButton.textContent = `Enviar a ${count}`;
    }
}

function bindMassLayout(body) {
    body.querySelectorAll("[data-mass-worker]").forEach(checkbox => {
        checkbox.addEventListener("change", () => {
            const uid = checkbox.dataset.massWorker || "";

            if (checkbox.checked) {
                massSelected.add(uid);
            } else {
                massSelected.delete(uid);
            }

            checkbox
                .closest(".supervisor-mass-worker")
                ?.classList.toggle("is-selected", checkbox.checked);
            syncMassSelectionUI();
        });
    });

    body.querySelectorAll("[data-mass-group]").forEach(chip => {
        chip.addEventListener("click", () => {
            const group = chip.dataset.massGroup || "";
            const workers = linkedWorkers();

            if (group === "__all__") {
                workers.forEach(item => massSelected.add(item.uid));
            } else if (group === "__none__") {
                massSelected.clear();
            } else {
                workers
                    .filter(item =>
                        (item.estamento || "Sin estamento") === group
                    )
                    .forEach(item => massSelected.add(item.uid));
            }

            body.querySelectorAll("[data-mass-worker]").forEach(checkbox => {
                const checked = massSelected.has(
                    checkbox.dataset.massWorker || ""
                );

                checkbox.checked = checked;
                checkbox
                    .closest(".supervisor-mass-worker")
                    ?.classList.toggle("is-selected", checked);
            });

            syncMassSelectionUI();
        });
    });

    const textarea = body.querySelector("[data-mass-text]");

    if (textarea) {
        textarea.addEventListener("input", () => {
            massText = textarea.value;
        });
    }

    body
        .querySelector("[data-mass-send]")
        ?.addEventListener("click", sendMassMessage);
}

async function sendMassMessage() {
    if (massSending) return;

    const text = String(massText || "").trim();
    const recipients = linkedWorkers()
        .filter(item => massSelected.has(item.uid));

    if (!text) {
        alert("Escribe un mensaje para enviar.");
        return;
    }

    if (!recipients.length) {
        alert("Selecciona al menos un trabajador.");
        return;
    }

    if (
        !await showConfirm(
            `El mensaje se enviará a ${recipients.length} trabajador(es).`,
            {
                title: "Confirmar envío masivo",
                tone: "info",
                confirmText: "Enviar mensaje"
            }
        )
    ) {
        return;
    }

    massSending = true;
    refreshDialog();

    let sent = 0;
    let failed = 0;

    for (const worker of recipients) {
        try {
            await writeSupervisorMessage(worker, text);
            sent++;
        } catch (error) {
            console.error(error);
            failed++;
        }
    }

    massSending = false;
    massText = "";
    massSelected.clear();
    refreshDialog();

    alert(
        failed
            ? `Mensaje enviado a ${sent}. No se pudo enviar a ${failed}.`
            : `Mensaje enviado a ${sent} trabajador(es).`
    );
}

function renderMessageBubble(message) {
    const mine = message.sender === "supervisor";

    return `
        <article class="supervisor-message-bubble ${mine ? "is-mine" : "is-worker"}">
            <p>${escapeHTML(message.text)}</p>
            <small>${mine ? "Supervisor" : "Trabajador"} | ${escapeHTML(formatTime(message.createdAt))}</small>
        </article>
    `;
}

function stopMessagesSubscription() {
    if (messagesUnsubscribe) {
        messagesUnsubscribe();
        messagesUnsubscribe = null;
    }
}

async function subscribeSelectedWorkerMessages() {
    stopMessagesSubscription();

    const worker = selectedWorker();
    if (!activeWorkspace?.id || !worker?.uid) {
        activeMessages = [];
        refreshDialog();
        return;
    }

    try {
        const { db, firestoreModule } = await getFirebaseServices();
        const messagesRef = firestoreModule.collection(
            db,
            "workspaces",
            activeWorkspace.id,
            "workerMessages",
            worker.uid,
            "messages"
        );

        messagesUnsubscribe = firestoreModule.onSnapshot(
            messagesRef,
            async snap => {
                activeMessages = snap.docs
                    .map(docSnap => ({
                        id: docSnap.id,
                        ...docSnap.data()
                    }))
                    .sort((a, b) =>
                        timestampToDate(a.createdAt) -
                        timestampToDate(b.createdAt)
                    );
                refreshDialog();
                await markThreadReadBySupervisor(worker.uid);
            },
            error => {
                console.warn("No se pudieron leer mensajes.", error);
            }
        );
    } catch (error) {
        console.warn("No se pudo iniciar conversacion.", error);
    }
}

async function sendSupervisorMessage(event) {
    event.preventDefault();

    const worker = selectedWorker();
    const textarea = event.currentTarget.querySelector("textarea");
    const text = String(textarea?.value || "").trim();

    if (!worker?.uid || !text) return;

    textarea.disabled = true;

    try {
        await writeSupervisorMessage(worker, text);
        textarea.value = "";
    } catch (error) {
        console.error(error);
        alert(error.message || "No se pudo enviar el mensaje.");
    } finally {
        textarea.disabled = false;
        focusMessageComposer();
    }
}

async function writeSupervisorMessage(worker, text) {
    const user = getCurrentFirebaseUser();
    const { db, firestoreModule } = await getFirebaseServices();
    const threadRef = firestoreModule.doc(
        db,
        "workspaces",
        activeWorkspace.id,
        "workerMessages",
        worker.uid
    );
    const messageRef = firestoreModule.doc(
        firestoreModule.collection(threadRef, "messages"),
        messageId()
    );
    const now = firestoreModule.serverTimestamp();

    await firestoreModule.writeBatch(db)
        .set(threadRef, {
            uid: worker.uid,
            workspaceId: activeWorkspace.id,
            workspaceName: activeWorkspace.name || "",
            profileName: worker.name || "",
            profileRut: worker.rut || "",
            workerEmail: worker.email || "",
            lastMessage: text,
            lastSender: "supervisor",
            unreadForWorker: true,
            unreadForSupervisor: false,
            updatedAt: now
        }, { merge: true })
        .set(messageRef, {
            id: messageRef.id,
            workspaceId: activeWorkspace.id,
            workerUid: worker.uid,
            profileName: worker.name || "",
            profileRut: worker.rut || "",
            text,
            sender: "supervisor",
            senderUid: user?.uid || "",
            senderName: user?.displayName || user?.email || "Supervisor",
            createdAt: now,
            readBySupervisor: true,
            readByWorker: false
        })
        .commit();
}

async function markThreadReadBySupervisor(uid) {
    if (!activeWorkspace?.id || !uid) return;

    try {
        const { db, firestoreModule } = await getFirebaseServices();
        await firestoreModule.setDoc(
            firestoreModule.doc(
                db,
                "workspaces",
                activeWorkspace.id,
                "workerMessages",
                uid
            ),
            {
                unreadForSupervisor: false,
                supervisorReadAt: firestoreModule.serverTimestamp()
            },
            { merge: true }
        );
    } catch (error) {
        console.warn("No se pudo marcar conversacion como leida.", error);
    }
}
