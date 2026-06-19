import { getCurrentFirebaseUser, getFirebaseServices } from "./firebaseClient.js";
import { getWorkerAppLinks } from "./workerAppDataSync.js";

let activeWorkspace = null;
let unreadUnsubscribe = null;
let messagesUnsubscribe = null;
let activeWorkerUid = "";
let activeMessages = [];
let unreadCount = 0;
let floatingButton = null;
let floatingBadge = null;
let dialog = null;

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

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
        alert("Selecciona un entorno Firebase para usar mensajeria.");
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
                <button class="icon-button supervisor-messages-close" type="button" data-supervisor-message-close aria-label="Cerrar">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <path d="M6 6l12 12"></path>
                        <path d="M18 6L6 18"></path>
                    </svg>
                </button>
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

    document.body.appendChild(dialog);
    refreshDialog();
    subscribeSelectedWorkerMessages();
}

function closeMessagesDialog() {
    dialog?.remove();
    dialog = null;
    stopMessagesSubscription();
}

function refreshDialog() {
    if (!dialog) return;

    const body = dialog.querySelector(".supervisor-messages-body");
    if (!body) return;

    const workers = linkedWorkers();
    const worker = selectedWorker();

    body.innerHTML = workers.length
        ? renderMessagesLayout(workers, worker)
        : `
            <div class="supervisor-messages-empty">
                No hay trabajadores con aplicacion enlazada.
            </div>
        `;

    body.querySelectorAll("[data-message-worker]").forEach(button => {
        button.addEventListener("click", () => {
            activeWorkerUid = button.dataset.messageWorker || "";
            activeMessages = [];
            refreshDialog();
            subscribeSelectedWorkerMessages();
        });
    });

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

function renderMessagesLayout(workers, worker) {
    return `
        <aside class="supervisor-message-workers">
            ${workers.map(item => `
                <button class="supervisor-message-worker ${item.uid === worker?.uid ? "is-active" : ""}" type="button" data-message-worker="${escapeHTML(item.uid)}">
                    <span class="supervisor-message-avatar">${escapeHTML(initials(item.name))}</span>
                    <span>
                        <strong>${escapeHTML(item.name)}</strong>
                        <small>${escapeHTML(item.role || item.email || "App enlazada")}</small>
                    </span>
                </button>
            `).join("")}
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
                <textarea name="message" rows="2" placeholder="Escribe un mensaje para ${escapeHTML(worker?.name || "el trabajador")}"></textarea>
                <button class="primary-button" type="submit">Enviar</button>
            </form>
        </section>
    `;
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
