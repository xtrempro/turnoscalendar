import {
    isFirebaseConfigured,
    onFirebaseAuthChanged,
    signInWithGoogle,
    signOutFirebase
} from "./firebaseClient.js";
import {
    createWorkspace,
    ensureFirebaseUser,
    getActiveWorkspace,
    joinWorkspace,
    listUserWorkspaces,
    prepareWorkspaceInvitation,
    setActiveWorkspace
} from "./workspaces.js";
import {
    acceptWorkspaceLink,
    listWorkspaceLinks,
    rejectWorkspaceLink,
    requestWorkspaceLink,
    unlinkWorkspaceLink
} from "./firebaseLinkedUnits.js";

let currentUser = null;
let currentWorkspace = getActiveWorkspace();
let workspaceList = [];
let options = {};
let linkedUnitState = {
    loading: false,
    message: "",
    links: []
};
let activeFirebaseBackdrop = null;
let loginGateEnabled = true;

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function displayUserName(user) {
    if (!isFirebaseConfigured()) return "Modo local";
    if (!user) return "Iniciar sesion";

    return user.displayName || user.email || "Usuario";
}

function workspaceText() {
    if (!isFirebaseConfigured()) return "Datos en localStorage";
    if (!currentUser) return "Sin sesion";
    if (!currentWorkspace) return "Sin entorno";

    return `Entorno: ${currentWorkspace.name}`;
}

function appShareURL() {
    if (typeof window === "undefined") return "";

    const url = new URL(window.location.href);

    url.search = "";
    url.hash = "";

    return url.toString();
}

function workspaceInviteURL(workspace) {
    const baseURL = appShareURL();

    if (!baseURL) return "";

    const url = new URL(baseURL);

    url.searchParams.set("joinWorkspace", workspace.id);
    if (workspace.inviteCode) {
        url.searchParams.set("inviteCode", workspace.inviteCode);
    }

    return url.toString();
}

function pendingJoinWorkspaceId() {
    if (typeof window === "undefined") return "";

    return new URL(window.location.href)
        .searchParams
        .get("joinWorkspace") || "";
}

function pendingJoinInviteCode() {
    if (typeof window === "undefined") return "";

    return new URL(window.location.href)
        .searchParams
        .get("inviteCode") || "";
}

function clearPendingJoinWorkspaceId() {
    if (
        typeof window === "undefined" ||
        !window.history?.replaceState
    ) {
        return;
    }

    const url = new URL(window.location.href);

    if (
        !url.searchParams.has("joinWorkspace") &&
        !url.searchParams.has("inviteCode")
    ) {
        return;
    }

    url.searchParams.delete("joinWorkspace");
    url.searchParams.delete("inviteCode");
    window.history.replaceState(
        {},
        "",
        `${url.pathname}${url.search}${url.hash}`
    );
}

function workspaceById(workspaceId) {
    return workspaceList.find(workspace =>
        workspace.id === workspaceId
    );
}

function workspaceInvitationText(workspace) {
    const inviteURL = workspaceInviteURL(workspace);

    return [
        `Te invito a unirte al entorno "${workspace.name || workspace.id}" en ProTurnos.`,
        "",
        inviteURL ? `Abre esta invitacion: ${inviteURL}` : "",
        "Inicia sesion con Google.",
        "Si el enlace no aparece automaticamente, pega estos datos en Unirse a entorno existente:",
        `${workspace.id} | ${workspace.inviteCode || ""}`
    ].filter(Boolean).join("\n");
}

async function copyTextToClipboard(text) {
    if (
        navigator.clipboard &&
        window.isSecureContext
    ) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textArea = document.createElement("textarea");

    textArea.value = text;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    textArea.remove();
}

function updateTopbar() {
    if (options.userName) {
        options.userName.textContent =
            displayUserName(currentUser);
    }

    if (options.userChip) {
        options.userChip.title = workspaceText();
        options.userChip.classList.toggle(
            "user-chip--firebase",
            Boolean(currentUser)
        );
    }
}

function setLoginGateActive(active) {
    if (typeof document === "undefined") return;

    document.body.classList.toggle(
        "auth-gate-active",
        Boolean(active)
    );
}

function closeModal(backdrop, options = {}) {
    if (
        !options.force &&
        backdrop?.dataset.authRequired === "true" &&
        !currentUser
    ) {
        return;
    }

    if (activeFirebaseBackdrop === backdrop) {
        activeFirebaseBackdrop = null;
    }

    backdrop?.remove();
}

function createModal(options = {}) {
    if (activeFirebaseBackdrop?.isConnected) {
        if (options.locked) {
            activeFirebaseBackdrop.dataset.authRequired = "true";
            activeFirebaseBackdrop.classList.add(
                "turn-change-dialog-backdrop--locked"
            );
        }

        return activeFirebaseBackdrop;
    }

    const backdrop = document.createElement("div");

    backdrop.className = "turn-change-dialog-backdrop";
    if (options.locked) {
        backdrop.dataset.authRequired = "true";
        backdrop.classList.add("turn-change-dialog-backdrop--locked");
    }
    document.body.appendChild(backdrop);

    backdrop.addEventListener("click", event => {
        if (
            event.target === backdrop &&
            backdrop.dataset.authRequired !== "true"
        ) {
            closeModal(backdrop);
        }
    });

    activeFirebaseBackdrop = backdrop;

    return backdrop;
}

function renderDisabledModal() {
    const backdrop = createModal();

    backdrop.innerHTML = `
        <section class="turn-change-dialog firebase-dialog">
            <strong>Firebase aun no esta activo</strong>
            <p>
                El sistema sigue trabajando en modo local. Para activar login con Gmail
                y entornos compartidos, completa <code>js/firebaseConfig.js</code>
                con los datos de tu proyecto Firebase y cambia
                <code>FIREBASE_ENABLED</code> a <code>true</code>.
            </p>
            <div class="firebase-dialog-note">
                Siguiente etapa: iniciar sesion, crear un entorno y sincronizar el estado completo del sistema.
            </div>
            <div class="turn-change-dialog__actions">
                <button class="primary-button" type="button" data-action="close">Entendido</button>
                <button class="secondary-button" type="button" data-action="keep-local">Seguir local</button>
            </div>
        </section>
    `;

    backdrop.querySelectorAll("[data-action]").forEach(button => {
        button.onclick = () => closeModal(backdrop);
    });
}

function workspaceListHTML() {
    if (!workspaceList.length) {
        return `
            <div class="firebase-empty">
                Aun no perteneces a ningun entorno.
            </div>
        `;
    }

    return workspaceList.map(workspace => {
        const isActive = currentWorkspace?.id === workspace.id;

        return `
            <article class="firebase-workspace-item ${isActive ? "is-active" : ""}">
                <div class="firebase-workspace-main">
                    <span>
                        <strong>${escapeHTML(workspace.name || workspace.id)}</strong>
                        <small>${escapeHTML(workspace.role || "member")}</small>
                    </span>
                    ${isActive ? `
                        <em>Activo</em>
                    ` : `
                        <button class="secondary-button firebase-workspace-use" type="button" data-workspace-select="${escapeHTML(workspace.id)}">
                            Usar
                        </button>
                    `}
                </div>

                <label class="firebase-workspace-id">
                    <span>ID del entorno</span>
                    <input type="text" readonly value="${escapeHTML(workspace.id)}">
                </label>

                <div class="firebase-workspace-actions">
                    <button class="secondary-button" type="button" data-action="copy-workspace-id" data-workspace-ref="${escapeHTML(workspace.id)}">
                        Copiar ID
                    </button>
                    <button class="secondary-button" type="button" data-action="copy-workspace-invite" data-workspace-ref="${escapeHTML(workspace.id)}">
                        Copiar invitacion
                    </button>
                    <button class="primary-button" type="button" data-action="email-workspace-invite" data-workspace-ref="${escapeHTML(workspace.id)}">
                        Enviar correo
                    </button>
                </div>
            </article>
        `;
    }).join("");
}

function friendlyFirebaseError(error) {
    const code = error?.code || "";

    if (code === "auth/unauthorized-domain") {
        const hostname =
            typeof window !== "undefined"
                ? window.location.hostname
                : "este dominio";

        return [
            `Firebase no permite iniciar sesion desde ${hostname}.`,
            "Agrega ese dominio en Firebase Console > Authentication > Settings > Authorized domains.",
            "Si estas usando ProTurnos localmente, agrega 127.0.0.1 y localhost, sin puerto."
        ].join(" ");
    }

    if (
        code === "permission-denied" ||
        String(error?.message || "")
            .toLowerCase()
            .includes("insufficient permissions")
    ) {
        return [
            "Firebase no permitio esta operacion.",
            "Si intentabas unirte o enlazar un entorno, revisa que el ID sea correcto, que no exista una solicitud previa y que las reglas actualizadas de Firestore esten publicadas."
        ].join(" ");
    }

    return error?.message || "No se pudo completar la accion.";
}

function linkedUnitStatusLabel(status) {
    if (status === "accepted") return "Activo";
    if (status === "rejected") return "Rechazado";
    if (status === "unlinked") return "Desenlazado";
    return "Pendiente";
}

function linkedUnitsPanelHTML() {
    if (!currentWorkspace) return "";

    const incoming = linkedUnitState.links.filter(link =>
        link.toWorkspaceId === currentWorkspace.id &&
        link.status === "pending"
    );
    const outgoing = linkedUnitState.links.filter(link =>
        link.fromWorkspaceId === currentWorkspace.id
    );
    const outgoingVisible = outgoing.filter(link =>
        link.status !== "accepted"
    );
    const accepted = linkedUnitState.links.filter(link =>
        link.status === "accepted" &&
        (
            link.fromWorkspaceId === currentWorkspace.id ||
            link.toWorkspaceId === currentWorkspace.id
        )
    );
    const message = linkedUnitState.message
        ? `
            <div class="firebase-linked-status">
                ${escapeHTML(linkedUnitState.message)}
            </div>
        `
        : "";

    return `
        <div class="firebase-linked-panel">
            <strong>Unidades enlazadas</strong>
            <p>
                Solicita enlace a otra unidad para buscar personal compatible
                como sugerencia de reemplazo. No se agrega el otro entorno al
                selector de trabajo.
            </p>
            ${message}
            <div class="firebase-linked-request">
                <input id="firebaseLinkedWorkspaceId" type="text" placeholder="ID del entorno a enlazar">
                <button class="secondary-button" type="button" data-action="request-workspace-link" ${linkedUnitState.loading ? "disabled" : ""}>
                    Solicitar enlace
                </button>
            </div>
            ${incoming.length ? `
                <div class="firebase-linked-list">
                    <span>Solicitudes recibidas</span>
                    ${incoming.map(link => `
                        <article class="firebase-linked-item">
                            <div>
                                <strong>${escapeHTML(link.fromWorkspaceName || link.fromWorkspaceId)}</strong>
                                <small>Solicitado por ${escapeHTML(link.requestedByName || "Usuario")}</small>
                            </div>
                            <div class="firebase-linked-actions">
                                <button class="primary-button" type="button" data-action="accept-workspace-link" data-link-ref="${escapeHTML(link.id)}">
                                    Aceptar
                                </button>
                                <button class="secondary-button" type="button" data-action="reject-workspace-link" data-link-ref="${escapeHTML(link.id)}">
                                    Rechazar
                                </button>
                            </div>
                        </article>
                    `).join("")}
                </div>
            ` : ""}
            ${outgoingVisible.length ? `
                <div class="firebase-linked-list">
                    <span>Solicitudes enviadas</span>
                    ${outgoingVisible.map(link => `
                        <article class="firebase-linked-item">
                            <div>
                                <strong>${escapeHTML(link.toWorkspaceName || link.toWorkspaceId)}</strong>
                                <small>${escapeHTML(linkedUnitStatusLabel(link.status))}</small>
                            </div>
                        </article>
                    `).join("")}
                </div>
            ` : ""}
            ${accepted.length ? `
                <div class="firebase-linked-list">
                    <span>Enlaces activos</span>
                    ${accepted.map(link => {
                        const isSource =
                            link.fromWorkspaceId === currentWorkspace.id;
                        const name = isSource
                            ? link.toWorkspaceName || link.toWorkspaceId
                            : link.fromWorkspaceName || link.fromWorkspaceId;

                        return `
                            <article
                                class="firebase-linked-item firebase-linked-item--action"
                                role="button"
                                tabindex="0"
                                data-action="unlink-workspace-link"
                                data-link-ref="${escapeHTML(link.id)}"
                                data-link-name="${escapeHTML(name)}"
                            >
                                <div>
                                    <strong>${escapeHTML(name)}</strong>
                                    <small>${isSource ? "Disponible para buscar prestamos" : "Puede recibir solicitudes de prestamo"} | Clic para desenlazar</small>
                                </div>
                                <em>Activo</em>
                            </article>
                        `;
                    }).join("")}
                </div>
            ` : ""}
        </div>
    `;
}

function renderSignedInModal(backdrop) {
    const pendingWorkspaceId = pendingJoinWorkspaceId();

    backdrop.innerHTML = `
        <section class="turn-change-dialog firebase-dialog">
            <strong>Cuenta y entornos</strong>
            <p>
                ${escapeHTML(currentUser.displayName || currentUser.email || "Usuario")}
                ${currentWorkspace ? `trabajando en ${escapeHTML(currentWorkspace.name)}.` : "sin entorno activo."}
            </p>

            <div class="firebase-dialog-grid">
                <label class="firebase-field">
                    <span>Crear entorno nuevo</span>
                    <input id="firebaseCreateWorkspaceName" type="text" placeholder="Ej: UCI Hospital Central">
                    <button class="primary-button" type="button" data-action="create-workspace">Crear entorno</button>
                </label>

                <label class="firebase-field">
                    <span>Unirse a entorno existente</span>
                    <input id="firebaseJoinWorkspaceId" type="text" placeholder="Pega enlace de invitacion o ID | codigo" value="${escapeHTML(pendingWorkspaceId)}">
                    <button class="secondary-button" type="button" data-action="join-workspace">Unirme</button>
                </label>
            </div>

            <div class="firebase-workspace-list">
                ${workspaceListHTML()}
            </div>

            ${linkedUnitsPanelHTML()}

            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="sign-out">Cerrar sesion</button>
                <button class="primary-button" type="button" data-action="close">Cerrar</button>
            </div>
        </section>
    `;

    bindModalActions(backdrop);
}

function renderSignedOutModal(backdrop, options = {}) {
    const required = Boolean(options.required);

    backdrop.innerHTML = `
        <section class="turn-change-dialog firebase-dialog">
            <strong>Iniciar sesion</strong>
            <p>
                Ingresa con tu cuenta Google para crear un entorno de trabajo
                o unirte a uno existente.
            </p>
            ${required ? "" : `
                <div class="firebase-dialog-note">
                    Hasta iniciar sesion y elegir un entorno, el sistema seguira trabajando en este equipo.
                </div>
            `}
            <div class="turn-change-dialog__actions">
                <button class="primary-button" type="button" data-action="sign-in">Ingresar con Google</button>
                ${required ? "" : `
                    <button class="secondary-button" type="button" data-action="close">Cancelar</button>
                `}
            </div>
        </section>
    `;

    bindModalActions(backdrop);
}

async function refreshWorkspaces() {
    if (!currentUser || !isFirebaseConfigured()) {
        workspaceList = [];
        return;
    }

    workspaceList = await listUserWorkspaces(currentUser);
    currentWorkspace = getActiveWorkspace();
}

async function refreshLinkedUnits() {
    if (
        !currentUser ||
        !currentWorkspace?.id ||
        !isFirebaseConfigured()
    ) {
        linkedUnitState.links = [];
        return;
    }

    try {
        linkedUnitState.links =
            await listWorkspaceLinks(currentWorkspace);
    } catch (error) {
        linkedUnitState.links = [];
        linkedUnitState.message =
            "No se pudieron cargar unidades enlazadas. Revisa que las reglas de Firestore esten publicadas.";
        console.warn("No se pudieron cargar unidades enlazadas.", error);
    }
}

async function handleAction(action, backdrop, sourceButton = null) {
    try {
        if (action === "close") {
            closeModal(backdrop);
            return;
        }

        if (action === "sign-in") {
            const result = await signInWithGoogle();

            currentUser = result?.user || currentUser;
            if (currentUser) {
                await ensureFirebaseUser(currentUser);
                await refreshWorkspaces();
                await refreshLinkedUnits();
                setLoginGateActive(false);
                backdrop.dataset.authRequired = "false";
                backdrop.classList.remove(
                    "turn-change-dialog-backdrop--locked"
                );
                updateTopbar();
                options.onAuthChange?.(currentUser);
                options.onWorkspaceChange?.(currentWorkspace);
                renderSignedInModal(backdrop);
            } else {
                closeModal(backdrop, { force: true });
            }
            return;
        }

        if (action === "sign-out") {
            if (loginGateEnabled) {
                setLoginGateActive(true);
            }

            await signOutFirebase();
            setActiveWorkspace(null);
            currentWorkspace = null;
            workspaceList = [];
            closeModal(backdrop, { force: true });
            updateTopbar();
            options.onWorkspaceChange?.(currentWorkspace);
            return;
        }

        if (action === "copy-workspace-id") {
            const workspace = workspaceById(
                sourceButton?.dataset.workspaceRef
            );

            if (!workspace) return;

            await copyTextToClipboard(workspace.id);
            return;
        }

        if (action === "copy-workspace-invite") {
            const workspace = workspaceById(
                sourceButton?.dataset.workspaceRef
            );

            if (!workspace) return;

            const invitationWorkspace =
                await prepareWorkspaceInvitation(currentUser, workspace);

            await copyTextToClipboard(
                workspaceInvitationText(invitationWorkspace)
            );
            await refreshWorkspaces();
            return;
        }

        if (action === "email-workspace-invite") {
            const workspace = workspaceById(
                sourceButton?.dataset.workspaceRef
            );

            if (!workspace) return;

            const invitationWorkspace =
                await prepareWorkspaceInvitation(currentUser, workspace);

            const subject = encodeURIComponent(
                `Invitacion a ProTurnos - ${workspace.name || workspace.id}`
            );
            const body = encodeURIComponent(
                workspaceInvitationText(invitationWorkspace)
            );

            window.location.href =
                `mailto:?subject=${subject}&body=${body}`;
            await refreshWorkspaces();
            return;
        }

        if (action === "create-workspace") {
            const input = backdrop.querySelector(
                "#firebaseCreateWorkspaceName"
            );

            currentWorkspace =
                await createWorkspace(currentUser, input?.value);
            await refreshWorkspaces();
            await refreshLinkedUnits();
            linkedUnitState.message = "";
            updateTopbar();
            options.onWorkspaceChange?.(currentWorkspace);
            renderSignedInModal(backdrop);
            return;
        }

        if (action === "join-workspace") {
            const input = backdrop.querySelector(
                "#firebaseJoinWorkspaceId"
            );

            currentWorkspace =
                await joinWorkspace(
                    currentUser,
                    input?.value,
                    pendingJoinInviteCode()
                );
            clearPendingJoinWorkspaceId();
            await refreshWorkspaces();
            await refreshLinkedUnits();
            linkedUnitState.message = "";
            updateTopbar();
            options.onWorkspaceChange?.(currentWorkspace);
            renderSignedInModal(backdrop);
            return;
        }

        if (action === "request-workspace-link") {
            const input = backdrop.querySelector(
                "#firebaseLinkedWorkspaceId"
            );

            linkedUnitState.loading = true;
            linkedUnitState.message = "Enviando solicitud de enlace...";
            renderSignedInModal(backdrop);

            await requestWorkspaceLink(input?.value);
            linkedUnitState.loading = false;
            linkedUnitState.message =
                "Solicitud enviada. La otra unidad debe aceptarla para activar busqueda de prestamos.";
            await refreshLinkedUnits();
            window.dispatchEvent(
                new CustomEvent("proturnos:workerRequestsChanged")
            );
            renderSignedInModal(backdrop);
            return;
        }

        if (action === "accept-workspace-link") {
            await acceptWorkspaceLink(sourceButton?.dataset.linkRef);
            linkedUnitState.message =
                "Enlace aceptado. La unidad solicitante ya puede buscar sugerencias de prestamo.";
            await refreshLinkedUnits();
            window.dispatchEvent(
                new CustomEvent("proturnos:workerRequestsChanged")
            );
            renderSignedInModal(backdrop);
            return;
        }

        if (action === "reject-workspace-link") {
            await rejectWorkspaceLink(sourceButton?.dataset.linkRef);
            linkedUnitState.message = "Solicitud de enlace rechazada.";
            await refreshLinkedUnits();
            window.dispatchEvent(
                new CustomEvent("proturnos:workerRequestsChanged")
            );
            renderSignedInModal(backdrop);
            return;
        }

        if (action === "unlink-workspace-link") {
            const linkName =
                sourceButton?.dataset.linkName || "esta unidad";
            const confirmed = window.confirm(
                `Deseas desenlazarte de ${linkName}? Ya no se podra buscar personal de esa unidad para prestamos.`
            );

            if (!confirmed) return;

            await unlinkWorkspaceLink(sourceButton?.dataset.linkRef);
            linkedUnitState.message =
                `Enlace con ${linkName} eliminado.`;
            await refreshLinkedUnits();
            window.dispatchEvent(
                new CustomEvent("proturnos:workerRequestsChanged")
            );
            renderSignedInModal(backdrop);
            return;
        }
    } catch (error) {
        linkedUnitState.loading = false;
        if (backdrop?.isConnected && currentUser) {
            renderSignedInModal(backdrop);
        }
        alert(friendlyFirebaseError(error));
    }
}

function bindModalActions(backdrop) {
    backdrop.querySelectorAll("[data-action]").forEach(button => {
        button.onclick = () =>
            handleAction(button.dataset.action, backdrop, button);

        if (button.tagName === "BUTTON") return;

        button.onkeydown = event => {
            if (
                event.key !== "Enter" &&
                event.key !== " "
            ) {
                return;
            }

            event.preventDefault();
            handleAction(button.dataset.action, backdrop, button);
        };
    });

    backdrop.querySelectorAll("[data-workspace-select]").forEach(button => {
        button.onclick = () => {
            const workspace = workspaceList.find(item =>
                item.id === button.dataset.workspaceSelect
            );

            if (!workspace) return;

            currentWorkspace = workspace;
            setActiveWorkspace(workspace);
            linkedUnitState.message = "";
            updateTopbar();
            options.onWorkspaceChange?.(currentWorkspace);
            refreshLinkedUnits()
                .catch(error => {
                    console.warn(
                        "No se pudieron cargar unidades enlazadas.",
                        error
                    );
                })
                .finally(() => renderSignedInModal(backdrop));
        };
    });
}

async function openFirebaseModal(options = {}) {
    if (!isFirebaseConfigured()) {
        renderDisabledModal();
        return;
    }

    const required =
        Boolean(options.required) && loginGateEnabled && !currentUser;
    const backdrop = createModal({ locked: required });

    if (!currentUser) {
        renderSignedOutModal(backdrop, { required });
        return;
    }

    await refreshWorkspaces();
    await refreshLinkedUnits();
    renderSignedInModal(backdrop);
}

export async function initFirebaseShell(initOptions = {}) {
    options = initOptions;
    loginGateEnabled = options.requireLogin !== false;

    updateTopbar();

    options.userChip?.addEventListener("click", () => {
        openFirebaseModal({
            required: loginGateEnabled && !currentUser
        });
    });

    if (!isFirebaseConfigured()) return;

    if (loginGateEnabled) {
        setLoginGateActive(true);
    }

    try {
        await onFirebaseAuthChanged(async user => {
            currentUser = user;

            if (user) {
                await ensureFirebaseUser(user);
                await refreshWorkspaces();
                await refreshLinkedUnits();
                setLoginGateActive(false);

                if (
                    activeFirebaseBackdrop?.isConnected &&
                    activeFirebaseBackdrop.dataset.authRequired === "true"
                ) {
                    activeFirebaseBackdrop.dataset.authRequired = "false";
                    activeFirebaseBackdrop.classList.remove(
                        "turn-change-dialog-backdrop--locked"
                    );
                    renderSignedInModal(activeFirebaseBackdrop);
                }
            } else {
                workspaceList = [];
                currentWorkspace = null;
                linkedUnitState.links = [];

                if (loginGateEnabled) {
                    setLoginGateActive(true);
                    openFirebaseModal({ required: true });
                }
            }

            updateTopbar();
            options.onAuthChange?.(user);
            options.onWorkspaceChange?.(currentWorkspace);
        });
    } catch (error) {
        console.warn("No se pudo inicializar Firebase.", error);
        updateTopbar();
    }
}
