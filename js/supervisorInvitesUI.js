import { escapeHTML } from "./htmlUtils.js";
import {
    MENU_PERMISSION_DEFS,
    normalizeMenuPermissions
} from "./workspacePermissions.js";

export function defaultSupervisorInvitePermissions() {
    return MENU_PERMISSION_DEFS.reduce((permissions, menu) => {
        permissions[menu.key] = {
            view: true,
            edit: true
        };
        return permissions;
    }, {});
}

function timestampToMillis(value) {
    if (!value) return 0;
    if (typeof value === "number") return value;
    if (value.toMillis) return value.toMillis();
    if (value.seconds) return value.seconds * 1000;

    return 0;
}

export function formatInviteDate(value) {
    const ms = timestampToMillis(value);
    if (!ms) return "";

    return new Date(ms).toLocaleString("es-CL", {
        dateStyle: "medium",
        timeStyle: "short"
    });
}

export function supervisorInviteStatusLabel(status) {
    if (status === "open") return "Abierta";
    if (status === "claimed") return "Pendiente de aprobacion";
    if (status === "approved") return "Aprobada";
    if (status === "rejected") return "Rechazada";
    if (status === "revoked") return "Revocada";
    if (status === "expired") return "Vencida";
    return "Pendiente";
}

export function supervisorInviteActor(invite) {
    return (
        invite.claimedByName ||
        invite.claimedByEmail ||
        invite.createdByName ||
        invite.createdByEmail ||
        "Usuario"
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
                <span>Menu</span>
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

export function showSupervisorInvitePermissionsDialog({
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
                <strong>${escapeHTML(title || "Invitacion de supervisor")}</strong>
                <p>
                    ${escapeHTML(message || "Define los permisos que tendra este supervisor si el propietario aprueba la solicitud.")}
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
