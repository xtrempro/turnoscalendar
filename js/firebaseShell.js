import { escapeHTML } from "./htmlUtils.js";
import { showConfirm, showPrompt } from "./dialogs.js";
import {
    FIREBASE_CONFIG,
    FIREBASE_PUBLIC_APP_URL
} from "./firebaseConfig.js";
import {
    completeGoogleRedirectSignIn,
    getFirebaseServices,
    isFirebaseConfigured,
    onFirebaseAuthChanged,
    signInWithGoogle,
    signOutFirebase
} from "./firebaseClient.js";
import {
    createWorkspace,
    ensureFirebaseUser,
    getActiveWorkspace,
    listUserWorkspaces,
    approveSupervisorInvitation,
    claimSupervisorInvitation,
    createSupervisorInvitation,
    listSupervisorInvitations,
    rejectSupervisorInvitation,
    revokeSupervisorInvitation,
    sendSupervisorInvitationEmail,
    setActiveWorkspace,
    fetchWorkspaceDeletionInfo,
    requestWorkspaceDeletion,
    cancelWorkspaceDeletion,
    WORKSPACE_DELETION_GRACE_HOURS
} from "./workspaces.js";
import {
    isValidEmailFormat,
    normalizeEmailKey
} from "./emailUtils.js";
import { replaceLocalSnapshot } from "./persistence.js";
import {
    MENU_PERMISSION_DEFS,
    normalizeMenuPermissions
} from "./workspacePermissions.js";
import {
    defaultSupervisorInvitePermissions,
    formatInviteDate
} from "./supervisorInvitesUI.js";
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
let supervisorInviteState = {
    loading: false,
    message: "",
    invites: []
};
let activeFirebaseBackdrop = null;
let handlingAccessLost = false;
let loginGateEnabled = true;
let unsubscribeUserWorkspaces = null;
let userWorkspacesListenerVersion = 0;
let activatingWorkspace = false;
let claimingPendingSupervisorInvite = false;

function displayUserName(user) {
    if (!isFirebaseConfigured()) return "Modo local";
    if (!user) return "Iniciar sesion";

    return user.displayName || user.email || "Usuario";
}

// Etiqueta principal del chip (junto al engranaje): muestra el entorno activo
// para que quede claro en que unidad se esta trabajando.
function displayWorkspaceLabel() {
    if (!isFirebaseConfigured()) return "Modo local";
    if (!currentUser) return "Iniciar sesion";
    if (!currentWorkspace) return "Sin unidad";

    return currentWorkspace.name;
}

function workspaceText() {
    if (!isFirebaseConfigured()) return "Datos en localStorage";
    if (!currentUser) return "Sin sesion";
    if (!currentWorkspace) return "Sin unidad";

    return `Unidad: ${currentWorkspace.name}`;
}

function appShareURL() {
    if (FIREBASE_PUBLIC_APP_URL) return FIREBASE_PUBLIC_APP_URL;
    if (typeof window === "undefined") return "";

    const url = new URL(window.location.href);

    url.search = "";
    url.hash = "";

    return url.toString();
}

function redirectPendingInviteToAuthDomain() {
    if (
        typeof window === "undefined" ||
        !pendingSupervisorInviteToken()
    ) {
        return false;
    }

    const authDomain = String(FIREBASE_CONFIG.authDomain || "").trim();

    if (
        !authDomain ||
        window.location.hostname === authDomain ||
        !["https:", "http:"].includes(window.location.protocol)
    ) {
        return false;
    }

    const targetURL = new URL(window.location.href);

    targetURL.hostname = authDomain;
    window.location.replace(targetURL.toString());

    return true;
}

function workspaceInviteURL(workspace) {
    const baseURL = appShareURL();

    if (!baseURL) return "";

    const url = new URL(baseURL);

    url.searchParams.set("joinWorkspace", workspace.id);
    if (workspace.supervisorInvite) {
        url.searchParams.set(
            "supervisorInvite",
            workspace.supervisorInvite
        );
    }

    return url.toString();
}

function pendingJoinWorkspaceId() {
    if (typeof window === "undefined") return "";

    return new URL(window.location.href)
        .searchParams
        .get("joinWorkspace") || "";
}

function pendingSupervisorInviteToken() {
    if (typeof window === "undefined") return "";

    return new URL(window.location.href)
        .searchParams
        .get("supervisorInvite") || "";
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
        !url.searchParams.has("inviteCode") &&
        !url.searchParams.has("supervisorInvite")
    ) {
        return;
    }

    url.searchParams.delete("joinWorkspace");
    url.searchParams.delete("inviteCode");
    url.searchParams.delete("supervisorInvite");
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
    const expiresAt = workspace.supervisorInviteExpiresAt
        ? new Date(workspace.supervisorInviteExpiresAt)
        : null;
    const expiresText = expiresAt && !Number.isNaN(expiresAt.getTime())
        ? expiresAt.toLocaleString("es-CL", {
            dateStyle: "medium",
            timeStyle: "short"
        })
        : "";

    return [
        `Te invito a solicitar acceso como supervisor a la unidad "${workspace.name || workspace.id}" en TurnoPlus.`,
        "",
        inviteURL ? `Abre esta invitacion: ${inviteURL}` : "",
        "Inicia sesion con Google.",
        "La invitacion es de un solo uso y debe ser aprobada por el propietario.",
        expiresText ? `Vence el ${expiresText}.` : "",
        "Si el enlace no aparece automaticamente, pega el enlace completo en Unirse a una unidad existente."
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
        // Mostrar el entorno activo como etiqueta principal.
        options.userName.textContent = displayWorkspaceLabel();
    }

    if (options.userChip) {
        // El tooltip conserva el detalle: usuario + entorno.
        const userName = displayUserName(currentUser);

        options.userChip.title = currentUser
            ? `${userName} | ${workspaceText()}`
            : workspaceText();
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

// El entorno activo es valido solo si esta entre los entornos del usuario.
// Si se elimino o se perdio la membresia, deja de aparecer en la lista.
function hasValidActiveWorkspace() {
    const id = currentWorkspace?.id;

    if (!id) return false;

    return workspaceList.some(workspace => workspace.id === id);
}

// La app queda bloqueada (no editable) mientras no haya sesion o no haya un
// entorno activo valido. Asi se evita trabajar sobre datos locales de un
// entorno inexistente o ya eliminado.
function isShellLocked() {
    if (!loginGateEnabled) return false;
    if (!currentUser) return true;

    return !hasValidActiveWorkspace();
}

// Sincroniza el gate de la app con el estado actual: bloquea si falta sesion o
// entorno valido, libera si todo esta en orden.
function refreshShellGate() {
    setLoginGateActive(isShellLocked());
}

async function activateWorkspace(workspace, optionsOverride = {}) {
    if (!workspace?.id || activatingWorkspace) return false;

    activatingWorkspace = true;

    try {
        currentWorkspace = workspace;
        setActiveWorkspace(workspace);
        linkedUnitState.message = "";
        refreshShellGate();
        updateTopbar();

        // Detener el sync actual y LIMPIAR el estado local antes de activar
        // el nuevo entorno; si no, los datos locales del entorno anterior se
        // subirian al nuevo (corrupcion al cambiar de unidad).
        await options.onWorkspaceChange?.(null);
        replaceLocalSnapshot({}, { silent: true });
        await options.onWorkspaceChange?.(currentWorkspace);

        await refreshSupervisorInvites();

        if (optionsOverride.closeModal !== false) {
            closeModal(activeFirebaseBackdrop, { force: true });
        }

        return true;
    } finally {
        activatingWorkspace = false;
    }
}

async function maybeActivateSingleWorkspace() {
    if (!currentUser) return false;
    if (hasValidActiveWorkspace()) return false;
    if (workspaceList.length !== 1) return false;

    return activateWorkspace(workspaceList[0]);
}

async function claimPendingSupervisorInvite() {
    const workspaceId = pendingJoinWorkspaceId();
    const token = pendingSupervisorInviteToken();

    if (
        !currentUser ||
        !workspaceId ||
        !token ||
        claimingPendingSupervisorInvite
    ) {
        return false;
    }

    claimingPendingSupervisorInvite = true;
    supervisorInviteState.loading = true;
    supervisorInviteState.message = "Enviando solicitud de acceso...";

    try {
        const result = await claimSupervisorInvitation(
            currentUser,
            workspaceId,
            token
        );

        clearPendingJoinWorkspaceId();
        supervisorInviteState.message =
            `Solicitud enviada para ${result.workspaceName || "la unidad"}. Espera la aprobacion del propietario.`;
        await refreshWorkspaces();
        await refreshLinkedUnits();
        refreshShellGate();
        updateTopbar();

        return true;
    } catch (error) {
        supervisorInviteState.message = "";
        throw error;
    } finally {
        supervisorInviteState.loading = false;
        claimingPendingSupervisorInvite = false;
    }
}

function closeModal(backdrop, options = {}) {
    if (
        !options.force &&
        backdrop?.dataset.authRequired === "true" &&
        isShellLocked()
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
                y unidades compartidas, completa <code>js/firebaseConfig.js</code>
                con los datos de tu proyecto Firebase y cambia
                <code>FIREBASE_ENABLED</code> a <code>true</code>.
            </p>
            <div class="firebase-dialog-note">
                Siguiente etapa: iniciar sesion, crear una unidad y sincronizar el estado completo del sistema.
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

function currentWorkspaceIsOwner() {
    const workspace = workspaceById(currentWorkspace?.id);

    return Boolean(
        workspace &&
        (
            workspace.role === "owner" ||
            (
                workspace.ownerUid &&
                currentUser &&
                workspace.ownerUid === currentUser.uid
            )
        )
    );
}

function readInvitePermissions(container) {
    const permissions = {};

    MENU_PERMISSION_DEFS.forEach(menu => {
        const view = container.querySelector(
            `[data-invite-permission-menu="${menu.key}"][data-permission-kind="view"]`
        );
        const edit = container.querySelector(
            `[data-invite-permission-menu="${menu.key}"][data-permission-kind="edit"]`
        );
        const canView = Boolean(view?.checked);

        permissions[menu.key] = {
            view: canView,
            edit: canView && Boolean(edit?.checked)
        };
    });

    return normalizeMenuPermissions(permissions);
}

function invitePermissionsHTML(permissions) {
    const normalized = normalizeMenuPermissions(permissions);

    return `
        <div class="settings-permission-grid supervisor-invite-permissions">
            <div class="settings-permission-row settings-permission-row--head">
                <span>Menú</span>
                <span>Ver</span>
                <span>Editar</span>
            </div>
            ${MENU_PERMISSION_DEFS.map(menu => {
                const permission = normalized[menu.key];

                return `
                    <label class="settings-permission-row">
                        <span>${escapeHTML(menu.label)}</span>
                        <input
                            type="checkbox"
                            data-invite-permission-menu="${escapeHTML(menu.key)}"
                            data-permission-kind="view"
                            ${permission.view ? "checked" : ""}
                        >
                        <input
                            type="checkbox"
                            data-invite-permission-menu="${escapeHTML(menu.key)}"
                            data-permission-kind="edit"
                            ${permission.edit ? "checked" : ""}
                            ${permission.view ? "" : "disabled"}
                        >
                    </label>
                `;
            }).join("")}
        </div>
    `;
}

function showSupervisorInvitePermissionsDialog({
    title,
    message,
    confirmText,
    permissions = defaultSupervisorInvitePermissions()
} = {}) {
    return new Promise(resolve => {
        const backdrop = document.createElement("div");
        const normalized = normalizeMenuPermissions(permissions);

        backdrop.className =
            "turn-change-dialog-backdrop supervisor-invite-backdrop";
        backdrop.innerHTML = `
            <section class="turn-change-dialog firebase-dialog supervisor-invite-dialog">
                <strong>${escapeHTML(title || "Invitación de supervisor")}</strong>
                <p>
                    ${escapeHTML(message || "Define los permisos que tendrá este supervisor si el propietario aprueba la solicitud.")}
                </p>
                <div class="firebase-dialog-note supervisor-invite-error" hidden></div>
                ${invitePermissionsHTML(normalized)}
                <div class="turn-change-dialog__actions supervisor-invite-actions">
                    <button class="secondary-button" type="button" data-invite-action="cancel">Cancelar</button>
                    <button class="secondary-button" type="button" data-invite-action="read-only">Solo lectura</button>
                    <button class="primary-button" type="button" data-invite-action="confirm">${escapeHTML(confirmText || "Continuar")}</button>
                </div>
            </section>
        `;

        document.body.appendChild(backdrop);

        const dialog = backdrop.querySelector(".supervisor-invite-dialog");
        const errorBox = backdrop.querySelector(".supervisor-invite-error");

        const finish = value => {
            backdrop.remove();
            resolve(value);
        };

        const syncRow = viewInput => {
            const menu = viewInput?.dataset.invitePermissionMenu;
            const editInput = menu
                ? dialog.querySelector(
                    `[data-invite-permission-menu="${menu}"][data-permission-kind="edit"]`
                )
                : null;

            if (!editInput) return;
            editInput.disabled = !viewInput.checked;
            if (!viewInput.checked) {
                editInput.checked = false;
            }
        };

        dialog
            .querySelectorAll("[data-permission-kind='view']")
            .forEach(input => {
                input.addEventListener("change", () => syncRow(input));
            });

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) {
                finish(null);
            }
        });

        dialog.querySelectorAll("[data-invite-action]").forEach(button => {
            button.addEventListener("click", () => {
                const action = button.dataset.inviteAction;

                if (action === "cancel") {
                    finish(null);
                    return;
                }

                if (action === "read-only") {
                    MENU_PERMISSION_DEFS.forEach(menu => {
                        const view = dialog.querySelector(
                            `[data-invite-permission-menu="${menu.key}"][data-permission-kind="view"]`
                        );
                        const edit = dialog.querySelector(
                            `[data-invite-permission-menu="${menu.key}"][data-permission-kind="edit"]`
                        );

                        if (view) view.checked = true;
                        if (edit) {
                            edit.checked = false;
                            edit.disabled = false;
                        }
                    });
                    return;
                }

                const selected = readInvitePermissions(dialog);
                const hasAny = MENU_PERMISSION_DEFS.some(menu =>
                    selected[menu.key]?.view || selected[menu.key]?.edit
                );

                if (!hasAny) {
                    errorBox.hidden = false;
                    errorBox.textContent =
                        "Selecciona al menos un permiso visible.";
                    return;
                }

                finish(selected);
            });
        });
    });
}

function workspaceListHTML() {
    if (!workspaceList.length) {
        return `
            <div class="firebase-empty">
                Aun no perteneces a ninguna unidad.
            </div>
        `;
    }

    return workspaceList.map(workspace => {
        const isActive = currentWorkspace?.id === workspace.id;
        const isOwner = workspace.role === "owner" ||
            Boolean(
                workspace.ownerUid &&
                currentUser &&
                workspace.ownerUid === currentUser.uid
            );

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
                    <span>ID de la unidad</span>
                    <input type="text" readonly value="${escapeHTML(workspace.id)}">
                </label>

                <div class="firebase-workspace-actions">
                    <button class="secondary-button" type="button" data-action="copy-workspace-id" data-workspace-ref="${escapeHTML(workspace.id)}">
                        Copiar ID
                    </button>
                    ${isOwner ? `
                        <button class="secondary-button" type="button" data-action="copy-workspace-invite" data-workspace-ref="${escapeHTML(workspace.id)}">
                            Copiar invitación segura
                        </button>
                    ` : ""}
                </div>

                ${isOwner ? `
                    <div class="firebase-workspace-email">
                        <label class="firebase-workspace-email-field">
                            <span>Correo para invitación</span>
                            <input
                                type="email"
                                inputmode="email"
                                autocomplete="email"
                                data-workspace-invite-email
                                placeholder="supervisor@correo.cl"
                            >
                        </label>
                        <button class="primary-button" type="button" data-action="send-workspace-invite-email" data-workspace-ref="${escapeHTML(workspace.id)}">
                            Enviar invitación
                        </button>
                    </div>
                ` : ""}

                ${workspaceDeletionBlockHTML(workspace)}
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

    if (code === "auth/cancelled-popup-request") {
        return [
            "El inicio de sesion anterior quedo abierto o fue reemplazado por otro intento.",
            "Cierra cualquier ventana de Google abierta y vuelve a presionar Ingresar con Google una sola vez."
        ].join(" ");
    }

    if (code === "auth/popup-blocked") {
        return [
            "El navegador bloqueo la ventana de Google.",
            "Vuelve a intentar: el inicio de sesion usa redireccion para evitar ventanas emergentes."
        ].join(" ");
    }

    if (code === "auth/web-storage-unsupported") {
        return [
            "El navegador bloqueo el almacenamiento que Firebase necesita para iniciar sesion.",
            "Habilita cookies y datos del sitio para TurnoPlus y Google, o prueba en una ventana normal sin modo privado."
        ].join(" ");
    }

    if (code === "auth/operation-not-supported-in-this-environment") {
        return [
            "Este navegador o visor embebido no permite completar el login de Google.",
            "Abre TurnoPlus directamente en Chrome, Edge o Safari actualizado."
        ].join(" ");
    }

    if (code === "auth/redirect-cancelled-by-user") {
        return "El inicio de sesion con Google fue cancelado antes de completarse.";
    }

    if (code === "auth/internal-error") {
        return [
            "Firebase no pudo completar el retorno de Google en este navegador.",
            "Abre nuevamente el enlace de invitacion en Chrome o Edge, y si vuelve a ocurrir borra los datos del sitio de TurnoPlus antes de intentar otra vez."
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
            "Si intentabas unirte o enlazar una unidad, revisa que el ID sea correcto, que no exista una solicitud previa y que las reglas actualizadas de Firestore esten publicadas."
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
                como sugerencia de reemplazo. No se agrega la otra unidad al
                selector de trabajo.
            </p>
            ${message}
            <div class="firebase-linked-request">
                <input id="firebaseLinkedWorkspaceId" type="text" placeholder="ID de la unidad a enlazar">
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

function supervisorInviteStatusLabel(status) {
    if (status === "open") return "Abierta";
    if (status === "claimed") return "Pendiente de aprobación";
    if (status === "approved") return "Aprobada";
    if (status === "rejected") return "Rechazada";
    if (status === "revoked") return "Revocada";
    if (status === "expired") return "Vencida";
    return "Pendiente";
}

function supervisorInviteActor(invite) {
    return (
        invite.claimedByName ||
        invite.claimedByEmail ||
        invite.createdByName ||
        invite.createdByEmail ||
        "Usuario"
    );
}

function supervisorInvitesPanelHTML() {
    if (!currentWorkspace || !currentWorkspaceIsOwner()) return "";

    const message = supervisorInviteState.message
        ? `
            <div class="firebase-linked-status">
                ${escapeHTML(supervisorInviteState.message)}
            </div>
        `
        : "";
    const visibleInvites = supervisorInviteState.invites
        .filter(invite =>
            ["open", "claimed", "approved", "rejected", "revoked", "expired"]
                .includes(invite.status)
        )
        .slice(0, 12);

    return `
        <div class="firebase-linked-panel supervisor-invite-panel">
            <strong>Invitaciones de supervisor</strong>
            <p>
                Las invitaciones son de un solo uso. El supervisor queda sin acceso
                hasta que apruebes su solicitud.
            </p>
            ${message}
            ${supervisorInviteState.loading ? `
                <div class="firebase-empty">Cargando invitaciones...</div>
            ` : visibleInvites.length ? `
                <div class="firebase-linked-list">
                    ${visibleInvites.map(invite => {
                        const status = invite.status || "open";
                        const expiresAt = formatInviteDate(invite.expiresAt);
                        const createdAt = formatInviteDate(invite.createdAt);
                        const actor = supervisorInviteActor(invite);

                        return `
                            <article class="firebase-linked-item supervisor-invite-item">
                                <div>
                                    <strong>${escapeHTML(actor)}</strong>
                                    <small>
                                        ${escapeHTML(supervisorInviteStatusLabel(status))}
                                        ${expiresAt ? ` | vence ${escapeHTML(expiresAt)}` : ""}
                                        ${createdAt ? ` | creada ${escapeHTML(createdAt)}` : ""}
                                    </small>
                                </div>
                                <div class="firebase-linked-actions">
                                    ${status === "claimed" ? `
                                        <button class="primary-button" type="button" data-action="approve-supervisor-invite" data-invite-ref="${escapeHTML(invite.id)}">
                                            Aprobar
                                        </button>
                                        <button class="secondary-button" type="button" data-action="reject-supervisor-invite" data-invite-ref="${escapeHTML(invite.id)}">
                                            Rechazar
                                        </button>
                                    ` : ""}
                                    ${["open", "claimed"].includes(status) ? `
                                        <button class="secondary-button" type="button" data-action="revoke-supervisor-invite" data-invite-ref="${escapeHTML(invite.id)}">
                                            Revocar
                                        </button>
                                    ` : ""}
                                </div>
                            </article>
                        `;
                    }).join("")}
                </div>
            ` : `
                <div class="firebase-empty">
                    No hay invitaciones ni solicitudes pendientes.
                </div>
            `}
        </div>
    `;
}

function renderSignedInModal(backdrop) {
    const pendingWorkspaceId = pendingJoinWorkspaceId();
    const pendingInviteToken = pendingSupervisorInviteToken();
    const locked = isShellLocked();

    // Mientras no haya entorno valido, el selector queda bloqueado: no se puede
    // cerrar hasta crear o elegir uno.
    backdrop.dataset.authRequired = locked ? "true" : "false";
    backdrop.classList.toggle(
        "turn-change-dialog-backdrop--locked",
        locked
    );

    backdrop.innerHTML = `
        <section class="turn-change-dialog firebase-dialog">
            <strong>Cuentas y Unidades</strong>
            <p>
                ${escapeHTML(currentUser.displayName || currentUser.email || "Usuario")}
                ${currentWorkspace ? `trabajando en ${escapeHTML(currentWorkspace.name)}.` : "sin unidad activa."}
            </p>
            ${locked ? `
                <div class="firebase-dialog-note">
                    Debes crear una unidad o unirte a una para empezar a trabajar.
                    No se puede editar informacion sin una unidad activa.
                </div>
            ` : ""}
            ${supervisorInviteState.message ? `
                <div class="firebase-dialog-note firebase-dialog-note--success">
                    ${escapeHTML(supervisorInviteState.message)}
                </div>
            ` : ""}

            <div class="firebase-dialog-grid">
                <label class="firebase-field">
                    <span>Crear nueva unidad</span>
                    <input id="firebaseCreateWorkspaceName" type="text" placeholder="Ej: UCI Hospital Central">
                    <button class="primary-button" type="button" data-action="create-workspace">Crear unidad</button>
                </label>

                <label class="firebase-field">
                    <span>Unirse a una unidad existente</span>
                    <input id="firebaseJoinWorkspaceId" type="text" placeholder="Pega enlace de invitación segura" value="${escapeHTML(pendingWorkspaceId)}">
                    <button class="secondary-button" type="button" data-action="join-workspace">
                        ${pendingInviteToken ? "Solicitar acceso" : "Solicitar acceso"}
                    </button>
                </label>
            </div>

            <div class="firebase-workspace-list">
                ${workspaceListHTML()}
            </div>

            ${linkedUnitsPanelHTML()}
            ${supervisorInvitesPanelHTML()}

            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="sign-out">Cerrar sesion</button>
                ${locked ? "" : `<button class="primary-button" type="button" data-action="close">Cerrar</button>`}
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
                Ingresa con tu cuenta Google para crear una unidad de trabajo
                o unirte a una existente.
            </p>
            ${required ? "" : `
                <div class="firebase-dialog-note">
                    Hasta iniciar sesion y elegir una unidad, el sistema seguira trabajando en este equipo.
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
        supervisorInviteState.invites = [];
        return;
    }

    const list = await listUserWorkspaces(currentUser);

    // Adjunta el estado de eliminacion de cada entorno (doc top-level).
    workspaceList = await Promise.all(
        list.map(async workspace => {
            const info = await fetchWorkspaceDeletionInfo(workspace.id);

            return {
                ...workspace,
                deletionStatus: info?.deletionStatus || "",
                deletionScheduledMs: info?.deletionScheduledMs || null,
                ownerUid: info?.ownerUid || workspace.ownerUid || ""
            };
        })
    );
    currentWorkspace = getActiveWorkspace();
    await refreshSupervisorInvites();
}

function stopUserWorkspacesListener() {
    userWorkspacesListenerVersion += 1;

    if (unsubscribeUserWorkspaces) {
        unsubscribeUserWorkspaces();
        unsubscribeUserWorkspaces = null;
    }
}

async function handleUserWorkspacesChanged(uid) {
    if (!currentUser || currentUser.uid !== uid) return;

    await refreshWorkspaces();

    if (await maybeActivateSingleWorkspace()) {
        return;
    }

    refreshShellGate();
    updateTopbar();

    if (activeFirebaseBackdrop?.isConnected) {
        renderSignedInModal(activeFirebaseBackdrop);
    }
}

async function startUserWorkspacesListener(user) {
    stopUserWorkspacesListener();

    if (!user?.uid || !isFirebaseConfigured()) return;

    userWorkspacesListenerVersion += 1;

    const listenerVersion = userWorkspacesListenerVersion;

    try {
        const { db, firestoreModule } = await getFirebaseServices();

        if (
            listenerVersion !== userWorkspacesListenerVersion ||
            !currentUser ||
            currentUser.uid !== user.uid
        ) {
            return;
        }

        const ref = firestoreModule.collection(
            db,
            "users",
            user.uid,
            "workspaces"
        );

        unsubscribeUserWorkspaces = firestoreModule.onSnapshot(
            ref,
            () => {
                void handleUserWorkspacesChanged(user.uid);
            },
            error => {
                console.warn(
                    "No se pudo sincronizar las unidades del usuario.",
                    error
                );
            }
        );
    } catch (error) {
        console.warn(
            "No se pudo iniciar sincronizacion de unidades del usuario.",
            error
        );
    }
}

async function refreshSupervisorInvites() {
    supervisorInviteState.invites = [];

    if (!currentWorkspace?.id || !currentWorkspaceIsOwner()) {
        return;
    }

    try {
        supervisorInviteState.loading = true;
        supervisorInviteState.invites =
            await listSupervisorInvitations(currentWorkspace.id);
    } catch (error) {
        console.warn("No se pudieron cargar invitaciones de supervisor.", error);
        supervisorInviteState.message =
            "No se pudieron cargar las invitaciones de supervisor.";
    } finally {
        supervisorInviteState.loading = false;
    }
}

function workspaceDeletionBlockHTML(workspace) {
    // El creador se determina por ownerUid (mas fiable que el rol de membresia,
    // que en entornos antiguos puede no estar como "owner").
    const isOwner = workspace.role === "owner" ||
        Boolean(workspace.ownerUid && currentUser && workspace.ownerUid === currentUser.uid);
    const pending = workspace.deletionStatus === "pending_deletion";

    if (pending) {
        const when = workspace.deletionScheduledMs
            ? new Date(workspace.deletionScheduledMs)
            : null;
        const hoursLeft = when
            ? Math.max(0, Math.ceil((when.getTime() - Date.now()) / 3600000))
            : null;
        const whenText = when
            ? when.toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" })
            : "";

        return `
            <div class="firebase-workspace-danger is-pending">
                <strong>Eliminacion programada</strong>
                <p>
                    Esta unidad se eliminara definitivamente el ${escapeHTML(whenText)}${hoursLeft !== null ? ` (en ~${hoursLeft} h)` : ""}.
                    Hasta entonces se conserva el acceso a los datos.
                </p>
                ${isOwner ? `
                    <button class="primary-button" type="button" data-action="cancel-workspace-deletion" data-workspace-ref="${escapeHTML(workspace.id)}">
                        Anular eliminacion
                    </button>
                ` : `<small>Solo el creador de la unidad puede anular la eliminacion.</small>`}
            </div>
        `;
    }

    if (!isOwner) return "";

    return `
        <div class="firebase-workspace-danger">
            <button class="danger-button firebase-workspace-delete" type="button" data-action="request-workspace-deletion" data-workspace-ref="${escapeHTML(workspace.id)}">
                Eliminar unidad
            </button>
        </div>
    `;
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

            if (result?.redirected) return;

            currentUser = result?.user || currentUser;
            if (currentUser) {
                await ensureFirebaseUser(currentUser);
                await startUserWorkspacesListener(currentUser);
                await refreshWorkspaces();

                if (await maybeActivateSingleWorkspace()) {
                    options.onAuthChange?.(currentUser);
                    return;
                }

                // El gate y el bloqueo del modal los resuelve refreshShellGate /
                // renderSignedInModal segun haya o no un entorno valido.
                refreshShellGate();
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

            stopUserWorkspacesListener();
            setActiveWorkspace(null);
            currentWorkspace = null;
            workspaceList = [];
            updateTopbar();
            await options.onWorkspaceChange?.(currentWorkspace);
            replaceLocalSnapshot({}, { silent: true });
            await signOutFirebase();

            if (!loginGateEnabled) {
                closeModal(backdrop, { force: true });
            }
            return;
        }

        if (action === "request-workspace-deletion") {
            const id = sourceButton?.dataset.workspaceRef;
            const workspace = workspaceList.find(item => item.id === id);
            const name = workspace?.name || id || "";
            const typed = await showPrompt(
                `Esto programara la ELIMINACION de la unidad "${name}" en ${WORKSPACE_DELETION_GRACE_HOURS} horas.\n` +
                "Se avisara a los demas usuarios y a los trabajadores enlazados. Podras anularla durante ese plazo.\n" +
                "Pasado el plazo se borrara de forma definitiva y no podras volver a acceder.\n\n" +
                "Para confirmar, escribe el nombre exacto de la unidad.",
                {
                    title: "Programar eliminación de la unidad",
                    tone: "danger",
                    inputLabel: "Nombre exacto de la unidad",
                    placeholder: name,
                    confirmText: "Programar eliminación",
                    destructive: true
                }
            );

            if (typed === null) return;

            if (String(typed).trim() !== String(name).trim()) {
                alert("El nombre no coincide. No se programo la eliminacion.");
                return;
            }

            await requestWorkspaceDeletion(id);
            await refreshWorkspaces();
            renderSignedInModal(backdrop);
            return;
        }

        if (action === "cancel-workspace-deletion") {
            const id = sourceButton?.dataset.workspaceRef;
            await cancelWorkspaceDeletion(id);
            await refreshWorkspaces();
            renderSignedInModal(backdrop);
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

            const permissions =
                await showSupervisorInvitePermissionsDialog({
                    title: "Nueva invitación segura",
                    message:
                        "Selecciona los permisos que tendrá el supervisor si apruebas su solicitud.",
                    confirmText: "Crear invitación"
                });

            if (!permissions) return;

            const invitationWorkspace =
                await createSupervisorInvitation(
                    currentUser,
                    workspace,
                    permissions
                );

            await copyTextToClipboard(
                workspaceInvitationText(invitationWorkspace)
            );
            supervisorInviteState.message =
                "Invitación segura creada y copiada al portapapeles.";
            await refreshWorkspaces();
            renderSignedInModal(backdrop);
            return;
        }

        if (action === "send-workspace-invite-email") {
            const workspace = workspaceById(
                sourceButton?.dataset.workspaceRef
            );

            if (!workspace) return;

            const emailInput = sourceButton
                ?.closest(".firebase-workspace-item")
                ?.querySelector("[data-workspace-invite-email]");
            const email = normalizeEmailKey(emailInput?.value);

            if (!email) {
                emailInput?.focus();
                throw new Error("Ingresa el correo al que quieres enviar la invitación.");
            }

            if (!isValidEmailFormat(email)) {
                emailInput?.focus();
                throw new Error("El correo debe tener el formato nombre@dominio.cl.");
            }

            const permissions =
                await showSupervisorInvitePermissionsDialog({
                    title: "Nueva invitación segura",
                    message:
                        "Selecciona los permisos que tendrá el supervisor si apruebas su solicitud.",
                    confirmText: "Enviar invitación"
                });

            if (!permissions) return;

            await sendSupervisorInvitationEmail(
                currentUser,
                workspace,
                email,
                permissions
            );

            supervisorInviteState.message =
                `Invitación enviada a ${email}.`;
            await refreshWorkspaces();
            renderSignedInModal(backdrop);
            return;
        }

        if (action === "create-workspace") {
            const input = backdrop.querySelector(
                "#firebaseCreateWorkspaceName"
            );

            currentWorkspace =
                await createWorkspace(currentUser, input?.value);
            await options.onWorkspaceChange?.(null);
            replaceLocalSnapshot({}, { silent: true });
            await refreshWorkspaces();
            await refreshLinkedUnits();
            linkedUnitState.message = "";
            refreshShellGate();
            updateTopbar();
            await options.onWorkspaceChange?.(currentWorkspace);
            closeModal(backdrop, { force: true });
            return;
        }

        if (action === "join-workspace") {
            const input = backdrop.querySelector(
                "#firebaseJoinWorkspaceId"
            );

            const result = await claimSupervisorInvitation(
                currentUser,
                input?.value,
                pendingSupervisorInviteToken()
            );
            clearPendingJoinWorkspaceId();
            supervisorInviteState.message =
                `Solicitud enviada para ${result.workspaceName || "la unidad"}. Espera la aprobacion del propietario.`;
            await refreshWorkspaces();
            await refreshLinkedUnits();
            refreshShellGate();
            updateTopbar();
            renderSignedInModal(backdrop);
            return;
        }

        if (action === "approve-supervisor-invite") {
            const inviteId = sourceButton?.dataset.inviteRef;
            const invite = supervisorInviteState.invites.find(item =>
                item.id === inviteId
            );

            if (!invite || !currentWorkspace?.id) return;

            const permissions =
                await showSupervisorInvitePermissionsDialog({
                    title: "Aprobar supervisor",
                    message:
                        `Revisa los permisos para ${supervisorInviteActor(invite)} antes de aprobar el acceso.`,
                    confirmText: "Aprobar",
                    permissions: invite.permissions || {}
                });

            if (!permissions) return;

            await approveSupervisorInvitation(
                currentWorkspace.id,
                inviteId,
                permissions
            );
            supervisorInviteState.message =
                "Supervisor aprobado. Su unidad aparecera al actualizar o volver a iniciar sesion.";
            await refreshWorkspaces();
            renderSignedInModal(backdrop);
            return;
        }

        if (action === "reject-supervisor-invite") {
            const inviteId = sourceButton?.dataset.inviteRef;
            const reason = await showPrompt(
                "Puedes indicar un motivo breve para dejarlo registrado.",
                {
                    title: "Rechazar solicitud",
                    tone: "warning",
                    inputLabel: "Motivo opcional",
                    placeholder: "Ej: solicitud no autorizada",
                    confirmText: "Rechazar"
                }
            );

            if (reason === null || !currentWorkspace?.id) return;

            await rejectSupervisorInvitation(
                currentWorkspace.id,
                inviteId,
                reason
            );
            supervisorInviteState.message =
                "Solicitud de supervisor rechazada.";
            await refreshWorkspaces();
            renderSignedInModal(backdrop);
            return;
        }

        if (action === "revoke-supervisor-invite") {
            const inviteId = sourceButton?.dataset.inviteRef;
            const confirmed = await showConfirm(
                "Esta invitacion quedara cerrada y el enlace ya no podra usarse.",
                {
                    title: "Revocar invitacion",
                    tone: "danger",
                    confirmText: "Revocar",
                    destructive: true
                }
            );

            if (!confirmed || !currentWorkspace?.id) return;

            await revokeSupervisorInvitation(currentWorkspace.id, inviteId);
            supervisorInviteState.message =
                "Invitacion de supervisor revocada.";
            await refreshWorkspaces();
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
            const confirmed = await showConfirm(
                `Se eliminará el enlace con ${linkName} y ya no se podrá buscar personal de esa unidad para préstamos.`,
                {
                    title: "Desenlazar unidad",
                    tone: "danger",
                    confirmText: "Desenlazar",
                    destructive: true
                }
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
        supervisorInviteState.loading = false;
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
        button.onclick = async () => {
            const workspace = workspaceList.find(item =>
                item.id === button.dataset.workspaceSelect
            );

            if (!workspace) return;

            await activateWorkspace(workspace);
        };
    });
}

// Se perdio el acceso al entorno activo (fue eliminado o se quito la membresia).
// Saca al usuario del entorno, limpia el estado local en cache y abre el
// selector de entornos.
async function handleWorkspaceAccessLost(workspaceId) {
    const active = getActiveWorkspace();

    if (handlingAccessLost) return;
    if (!active || (workspaceId && active.id !== workspaceId)) return;

    handlingAccessLost = true;

    try {
        await options.onWorkspaceChange?.(null);
        setActiveWorkspace(null);
        currentWorkspace = null;
        replaceLocalSnapshot({}, { silent: true });
        await refreshWorkspaces();
        refreshShellGate();
        updateTopbar();

        window.alert(
            "Esta unidad ya no esta disponible (fue eliminada o perdiste el acceso). Selecciona o crea otra unidad."
        );

        if (activeFirebaseBackdrop?.isConnected) {
            renderSignedInModal(activeFirebaseBackdrop);
        } else {
            await openFirebaseModal({ required: true });
        }
    } catch (error) {
        console.warn("No se pudo manejar la perdida de acceso al entorno.", error);
    } finally {
        handlingAccessLost = false;
    }
}

async function openFirebaseModal(modalOptions = {}) {
    if (!isFirebaseConfigured()) {
        renderDisabledModal();
        return;
    }

    // La app esta bloqueada si falta sesion o entorno valido; en ambos casos el
    // modal no se puede cerrar hasta resolverlo. modalOptions.required permite
    // forzar el bloqueo aunque el estado todavia no se haya recalculado.
    const locked = isShellLocked() || Boolean(modalOptions.required);
    const backdrop = createModal({ locked });

    if (!currentUser) {
        renderSignedOutModal(backdrop, { required: locked });
        return;
    }

    await refreshWorkspaces();
    if (await maybeActivateSingleWorkspace()) return;

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

    window.addEventListener("proturnos:firebaseAppState", event => {
        if (event.detail?.type === "app-state-access-lost") {
            handleWorkspaceAccessLost(event.detail.workspaceId);
        }
    });

    if (!isFirebaseConfigured()) return;

    if (redirectPendingInviteToAuthDomain()) return;

    if (loginGateEnabled) {
        setLoginGateActive(true);
    }

    try {
        try {
            await completeGoogleRedirectSignIn();
        } catch (error) {
            console.warn("No se pudo completar el retorno de Google.", error);
            alert(friendlyFirebaseError(error));
        }

        await onFirebaseAuthChanged(async user => {
            currentUser = user;
            let workspaceChangeHandled = false;

            if (user) {
                await ensureFirebaseUser(user);
                await startUserWorkspacesListener(user);
                await refreshWorkspaces();

                if (pendingSupervisorInviteToken()) {
                    try {
                        await claimPendingSupervisorInvite();
                    } catch (error) {
                        console.warn(
                            "No se pudo reclamar la invitacion de supervisor.",
                            error
                        );
                        alert(friendlyFirebaseError(error));
                    }
                }

                workspaceChangeHandled =
                    await maybeActivateSingleWorkspace();

                if (
                    workspaceChangeHandled ||
                    hasValidActiveWorkspace()
                ) {
                    setLoginGateActive(false);

                    if (
                        activeFirebaseBackdrop?.isConnected &&
                        activeFirebaseBackdrop.dataset.authRequired === "true"
                    ) {
                        if (workspaceChangeHandled) {
                            closeModal(activeFirebaseBackdrop, {
                                force: true
                            });
                        } else {
                            renderSignedInModal(activeFirebaseBackdrop);
                        }
                    }
                } else {
                    // Logueado pero sin entorno valido (nunca creo uno, o el
                    // activo fue eliminado): limpiar el activo obsoleto y forzar
                    // que cree/elija uno antes de poder editar.
                    if (currentWorkspace) {
                        setActiveWorkspace(null);
                        currentWorkspace = null;
                    }
                    setLoginGateActive(true);
                    await openFirebaseModal({ required: true });
                }
            } else {
                workspaceList = [];
                currentWorkspace = null;
                linkedUnitState.links = [];
                stopUserWorkspacesListener();

                if (loginGateEnabled) {
                    setLoginGateActive(true);
                    openFirebaseModal({ required: true });
                }
            }

            updateTopbar();
            options.onAuthChange?.(user);
            if (!workspaceChangeHandled) {
                options.onWorkspaceChange?.(currentWorkspace);
            }
        });
    } catch (error) {
        console.warn("No se pudo inicializar Firebase.", error);
        updateTopbar();
    }
}
