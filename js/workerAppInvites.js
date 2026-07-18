import { escapeHTML } from "./htmlUtils.js";
import { sanitizeDigits } from "./stringUtils.js";
import {
    getCurrentFirebaseUser,
    getFirebaseServices
} from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";
import { getWorkerAppLinkForProfile } from "./workerAppDataSync.js";
import { performWorkerAppUnlink } from "./workerAppUnlink.js";
import { showConfirm } from "./dialogs.js";
import { getProfiles } from "./storage.js";
import { listWorkspaceMembersForPermissions } from "./workspacePermissions.js";
import { IS_TEST_ENVIRONMENT } from "./firebaseConfig.js";

// La PWA del trabajador es una app distinta por entorno: la de pruebas se conecta
// al proyecto de test y la de produccion al de produccion. El enlace copiado debe
// apuntar a la que corresponde (antes siempre apuntaba a produccion, por lo que
// una invitacion creada en test no se podia validar). El servidor ya hace lo
// mismo en functions/index.js (WORKER_APP_BASE_URL).
const WORKER_APP_URL = IS_TEST_ENVIRONMENT
    ? "https://turnoplusfunc-test.web.app/"
    : "https://turnoplusfuncionarios.web.app/";
const INVITE_DURATION_DAYS = 14;

function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

async function workspaceMemberEmailKeys(workspace, user) {
    const keys = new Set();
    const userEmail = normalizeEmail(user?.email);

    if (userEmail) keys.add(userEmail);
    if (!workspace?.id) return keys;

    try {
        const members = await listWorkspaceMembersForPermissions(workspace);

        members.forEach(member => {
            const email = normalizeEmail(member.email);

            if (email) keys.add(email);
        });
    } catch (error) {
        console.warn(
            "No se pudo validar correos administradores antes de invitar.",
            error
        );
    }

    return keys;
}

async function assertWorkerEmailCanBeInvited(profile, email, workspace, user) {
    if (!email) return;

    const duplicateProfile = getProfiles().find(item =>
        item.name !== profile.name &&
        normalizeEmail(item.email) === email
    );

    if (!duplicateProfile) return;

    const privilegedEmails =
        await workspaceMemberEmailKeys(workspace, user);

    if (privilegedEmails.has(email)) return;

    throw new Error(
        `Ya existe un trabajador creado con ese correo (${duplicateProfile.name}). Cada trabajador debe tener un correo distinto.`
    );
}

function createInviteToken() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID().replace(/-/g, "");
    }

    const bytes = new Uint8Array(20);

    if (globalThis.crypto?.getRandomValues) {
        globalThis.crypto.getRandomValues(bytes);
    } else {
        for (let index = 0; index < bytes.length; index++) {
            bytes[index] = Math.floor(Math.random() * 256);
        }
    }

    return Array.from(bytes)
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}

function getWorkerAppInviteUrl(workspaceId, token, email = "") {
    const url = new URL(WORKER_APP_URL);
    url.searchParams.set("workspace", workspaceId);
    url.searchParams.set("invite", token);

    if (email) {
        url.searchParams.set("email", email);
    }

    return url.toString();
}

function normalizeChileMobile(phone) {
    const digits = sanitizeDigits(phone, 12);

    if (!digits) return "";
    if (digits.startsWith("569") && digits.length === 11) return digits;
    if (digits.startsWith("9") && digits.length === 9) return `56${digits}`;
    if (digits.length === 8) return `569${digits}`;

    return digits;
}

function profileInitials(profile) {
    const words = String(profile?.name || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2);

    return words.map(word => word[0]?.toUpperCase() || "").join("") || "TP";
}

function inviteMessage(profile, workspace, inviteUrl) {
    const name = String(profile?.name || "trabajador").trim();
    const unit = String(workspace?.name || "TurnoPlus").trim();

    return [
        `Hola ${name}.`,
        `Te enviamos una invitacion para enlazar tu aplicacion TurnoPlus Trabajador con ${unit}.`,
        `Abre este enlace para ingresar a tu app: ${inviteUrl}`,
        `Para tenerla como app en tu celular, abre ${WORKER_APP_URL} y elige "Agregar a pantalla de inicio" o "Instalar app".`
    ].join("\n\n");
}

async function copyText(value) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
}

function closeInviteDialog(backdrop) {
    backdrop?.remove();
}

async function deleteWorkerEmailInviteMirror(
    firestoreModule,
    db,
    email,
    inviteId
) {
    const cleanEmail = normalizeEmail(email);

    if (!cleanEmail || !inviteId) return;

    try {
        await firestoreModule.deleteDoc(
            firestoreModule.doc(
                db,
                "workerAppEmailInvites",
                cleanEmail,
                "items",
                inviteId
            )
        );
    } catch (error) {
        // Este indice es solo una copia para que la PWA encuentre invitaciones
        // por correo. Si no existe, o si quedo con otro email antiguo, no debe
        // impedir el desenlace real (workerLinks es el acceso efectivo).
        console.warn(
            "No se pudo limpiar el indice de invitacion por correo.",
            error
        );
    }
}

function showInviteDialog({
    profile,
    workspace,
    inviteUrl,
    email,
    phoneE164
}) {
    const message = inviteMessage(profile, workspace, inviteUrl);
    const sentNote = email
        ? `Se envio un correo de invitacion a ${escapeHTML(email)} con el enlace para instalar y enlazar la app.`
        : "El perfil no tiene correo registrado, asi que no se envio correo automatico. Comparte el enlace por WhatsApp o copialo.";
    const whatsappUrl = phoneE164
        ? `https://wa.me/${phoneE164}?text=${encodeURIComponent(message)}`
        : "";
    const profileName = String(profile?.name || "Trabajador").trim();

    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog worker-app-invite-dialog" role="dialog" aria-modal="true" aria-labelledby="workerAppInviteTitle">
            <strong id="workerAppInviteTitle">Enlace app trabajador</strong>
            <div class="worker-app-invite-profile">
                <span class="worker-app-invite-avatar">${escapeHTML(profileInitials(profile))}</span>
                <div>
                    <b>${escapeHTML(profileName)}</b>
                    <small>${escapeHTML(email || "Sin correo registrado")}${phoneE164 ? ` | WhatsApp +${escapeHTML(phoneE164)}` : ""}</small>
                </div>
            </div>
            <p>${sentNote}</p>
            <label class="worker-app-invite-link">
                <span>Enlace de invitacion</span>
                <input type="text" value="${escapeHTML(inviteUrl)}" readonly>
            </label>
            <div class="turn-change-dialog__actions worker-app-invite-actions">
                <button class="secondary-button" type="button" data-worker-invite-action="whatsapp" ${phoneE164 ? "" : "disabled"}>WhatsApp</button>
                <button class="primary-button" type="button" data-worker-invite-action="copy">Copiar enlace</button>
                <button class="ghost-button" type="button" data-worker-invite-action="close">Cerrar</button>
            </div>
        </section>
    `;

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) {
            closeInviteDialog(backdrop);
        }
    });

    backdrop
        .querySelector("[data-worker-invite-action='whatsapp']")
        ?.addEventListener("click", () => {
            if (whatsappUrl) {
                window.open(whatsappUrl, "_blank", "noopener");
            }
        });

    backdrop
        .querySelector("[data-worker-invite-action='copy']")
        ?.addEventListener("click", async event => {
            const button = event.currentTarget;
            try {
                await copyText(inviteUrl);
                button.textContent = "Copiado";
            } catch (_error) {
                button.textContent = "No se pudo copiar";
            }
        });

    backdrop
        .querySelector("[data-worker-invite-action='close']")
        ?.addEventListener("click", () => closeInviteDialog(backdrop));

    document.body.appendChild(backdrop);
    backdrop.querySelector("input")?.select();
}

async function unlinkWorkerApp(workspaceId, link) {
    const { db, firestoreModule } = await getFirebaseServices();
    const batch = firestoreModule.writeBatch(db);
    const emailInviteCleanup = {
        email: normalizeEmail(link.workerEmail),
        inviteId: link.inviteId || ""
    };

    // Se ELIMINA el documento (no se deja como "unlinked"): las reglas de
    // Firestore consideran "enlazado" a un trabajador por la EXISTENCIA del
    // documento workerLinks/{uid}, no por su status. Si solo se marcara
    // "unlinked", el trabajador seguiria pudiendo leer datos y enviar
    // solicitudes (el documento existe), aunque el web lo oculte. Eliminarlo
    // revoca el acceso por completo.
    batch.delete(
        firestoreModule.doc(
            db,
            "workspaces",
            workspaceId,
            "workerLinks",
            link.uid
        )
    );
    batch.delete(
        firestoreModule.doc(
            db,
            "users",
            link.uid,
            "workerLinks",
            workspaceId
        )
    );

    if (link.inviteId) {
        batch.delete(
            firestoreModule.doc(
                db,
                "workspaces",
                workspaceId,
                "workerAppInvites",
                link.inviteId
            )
        );
    }

    await batch.commit();
    await deleteWorkerEmailInviteMirror(
        firestoreModule,
        db,
        emailInviteCleanup.email,
        emailInviteCleanup.inviteId
    );
}

/**
 * Desenlaza la app del trabajador asociado a un perfil (si existe enlace).
 * Se usa, por ejemplo, al desactivar el perfil. No falla si no hay enlace o
 * entorno activo.
 */
export async function unlinkWorkerAppForProfile(profile) {
    const profileName = typeof profile === "string"
        ? profile
        : profile?.name;

    if (!profileName) return false;

    const link = getWorkerAppLinkForProfile(profileName);
    const workspace = getActiveWorkspace();

    if (!link?.uid || !workspace?.id) return false;

    try {
        await unlinkWorkerApp(workspace.id, link);
        return true;
    } catch (error) {
        console.warn(
            "No se pudo desenlazar al trabajador del perfil.",
            error
        );
        return false;
    }
}

function showUnlinkDialog({ profile, workspace, link }) {
    const profileName = String(profile?.name || "Trabajador").trim();
    const email = normalizeEmail(profile.email) || link.workerEmail || "";

    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog worker-app-invite-dialog" role="dialog" aria-modal="true" aria-labelledby="workerAppInviteTitle">
            <strong id="workerAppInviteTitle">Enlace app trabajador</strong>
            <div class="worker-app-invite-profile">
                <span class="worker-app-invite-avatar">${escapeHTML(profileInitials(profile))}</span>
                <div>
                    <b>${escapeHTML(profileName)}</b>
                    <small>${escapeHTML(email || "Sin correo registrado")}</small>
                </div>
            </div>
            <p>Este trabajador ya tiene su aplicacion enlazada.</p>
            <div class="turn-change-dialog__actions worker-app-invite-actions">
                <button class="worker-app-unlink-button" type="button" data-worker-invite-action="unlink">Desenlazar</button>
                <button class="ghost-button" type="button" data-worker-invite-action="close">Cerrar</button>
            </div>
        </section>
    `;

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) {
            closeInviteDialog(backdrop);
        }
    });

    backdrop
        .querySelector("[data-worker-invite-action='unlink']")
        ?.addEventListener("click", event => {
            // currentTarget deja de estar disponible en cuanto el listener
            // cede el control con await. Se captura antes de abrir el modal de
            // confirmacion para que el desenlace pueda continuar al aceptarlo.
            const button = event.currentTarget;

            void performWorkerAppUnlink({
                button,
                confirm: () => showConfirm(
                    `${profileName} dejará de recibir información en la app y deberá enlazarse nuevamente.`,
                    {
                        title: "Desenlazar aplicación",
                        tone: "danger",
                        confirmText: "Desenlazar",
                        destructive: true
                    }
                ),
                unlink: () => unlinkWorkerApp(workspace.id, link),
                onSuccess: () => {
                    closeInviteDialog(backdrop);
                    alert("App desenlazada correctamente.");
                },
                onError: error => {
                    console.error(error);
                    alert(
                        error.message ||
                        "No se pudo desenlazar la app del trabajador."
                    );
                }
            });
        });

    backdrop
        .querySelector("[data-worker-invite-action='close']")
        ?.addEventListener("click", () => closeInviteDialog(backdrop));

    document.body.appendChild(backdrop);
}

async function createWorkerAppInvite(
    profile,
    {
        requireEmail = false,
        ignoreExistingLink = false,
        replaceLink = null
    } = {}
) {
    if (!profile?.name) {
        throw new Error(
            "Selecciona un trabajador para generar el enlace."
        );
    }

    const user = getCurrentFirebaseUser();
    const workspace = getActiveWorkspace();

    if (!user) {
        throw new Error(
            "Debes iniciar sesion para enviar enlaces de la app."
        );
    }

    if (!workspace?.id) {
        throw new Error(
            "Selecciona una unidad Firebase antes de enviar el enlace."
        );
    }

    const existingLink = ignoreExistingLink || replaceLink
        ? null
        : getWorkerAppLinkForProfile(profile);

    if (existingLink) {
        return {
            status: "linked",
            profile,
            workspace,
            link: existingLink
        };
    }

    const email = normalizeEmail(profile.email);
    const phoneE164 = normalizeChileMobile(profile.phone);

    await assertWorkerEmailCanBeInvited(
        profile,
        email,
        workspace,
        user
    );

    if (requireEmail && !email) {
        return {
            status: "no_email",
            profile,
            workspace
        };
    }

    if (!email && !phoneE164) {
        throw new Error(
            "El perfil necesita correo o telefono para enviar la invitacion."
        );
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const token = createInviteToken();
    const inviteUrl = getWorkerAppInviteUrl(workspace.id, token, email);
    const now = firestoreModule.serverTimestamp();
    const expiresAt = new Date(
        Date.now() + INVITE_DURATION_DAYS * 24 * 60 * 60 * 1000
    );
    const canonicalRef = firestoreModule.doc(
        db,
        "workspaces",
        workspace.id,
        "workerAppInvites",
        token
    );
    const payload = {
        token,
        workspaceId: workspace.id,
        workspaceName: workspace.name || "",
        profileName: profile.name || "",
        profileRut: profile.rut || "",
        email,
        emailKey: email,
        phone: sanitizeDigits(profile.phone, 12),
        phoneE164,
        status: "pending",
        inviteUrl,
        appInstallUrl: WORKER_APP_URL,
        createdByUid: user.uid,
        createdByEmail: user.email || "",
        createdByName: user.displayName || "",
        createdAt: now,
        updatedAt: now,
        expiresAt
    };
    const batch = firestoreModule.writeBatch(db);
    let previousEmailInviteCleanup = null;

    if (replaceLink?.uid) {
        batch.delete(
            firestoreModule.doc(
                db,
                "workspaces",
                workspace.id,
                "workerLinks",
                replaceLink.uid
            )
        );
        batch.delete(
            firestoreModule.doc(
                db,
                "users",
                replaceLink.uid,
                "workerLinks",
                workspace.id
            )
        );

        if (replaceLink.inviteId) {
            batch.delete(
                firestoreModule.doc(
                    db,
                    "workspaces",
                    workspace.id,
                    "workerAppInvites",
                    replaceLink.inviteId
                )
            );

            const previousEmail =
                normalizeEmail(replaceLink.workerEmail);

            if (previousEmail) {
                previousEmailInviteCleanup = {
                    email: previousEmail,
                    inviteId: replaceLink.inviteId
                };
            }
        }
    }

    batch.set(canonicalRef, payload);

    if (email) {
        const emailRef = firestoreModule.doc(
            db,
            "workerAppEmailInvites",
            email,
            "items",
            token
        );

        batch.set(emailRef, {
            ...payload,
            createdAt: now,
            updatedAt: now
        });
    }

    await batch.commit();

    if (previousEmailInviteCleanup) {
        await deleteWorkerEmailInviteMirror(
            firestoreModule,
            db,
            previousEmailInviteCleanup.email,
            previousEmailInviteCleanup.inviteId
        );
    }

    return {
        status: "created",
        profile,
        workspace,
        inviteUrl,
        email,
        phoneE164
    };
}

/**
 * Crea una invitacion pendiente para que Cloud Functions envie el correo.
 * No abre modales: se usa al guardar un perfil con correo nuevo o modificado.
 */
export async function sendWorkerAppInviteEmail(
    profile,
    {
        ignoreExistingLink = false,
        replaceLink = null
    } = {}
) {
    try {
        const result = await createWorkerAppInvite(
            profile,
            {
                requireEmail: true,
                ignoreExistingLink,
                replaceLink
            }
        );

        return {
            sent: result.status === "created",
            status: result.status,
            email: result.email || normalizeEmail(profile?.email),
            inviteUrl: result.inviteUrl || ""
        };
    } catch (error) {
        console.warn(
            "No se pudo crear la invitacion automatica de la app.",
            error
        );

        return {
            sent: false,
            status: "error",
            email: normalizeEmail(profile?.email),
            error
        };
    }
}

export async function openWorkerAppInviteDialog(profile) {
    try {
        const result = await createWorkerAppInvite(profile);

        if (result.status === "linked") {
            showUnlinkDialog({
                profile: result.profile,
                workspace: result.workspace,
                link: result.link
            });
            return;
        }

        showInviteDialog(result);
    } catch (error) {
        alert(
            error.message ||
            "No se pudo generar la invitacion para la app."
        );
    }
}
