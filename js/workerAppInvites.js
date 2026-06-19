import {
    getCurrentFirebaseUser,
    getFirebaseServices
} from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";

const WORKER_APP_URL = "https://turnoplusfuncionarios.web.app/";
const WORKER_APP_DOWNLOAD_URL =
    "https://play.google.com/store/apps/details?id=cl.turnoplus.trabajador";
const INVITE_DURATION_DAYS = 14;

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function sanitizeDigits(value, maxLength = Infinity) {
    return String(value || "")
        .replace(/\D/g, "")
        .slice(0, maxLength);
}

function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
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

function getWorkerAppInviteUrl(workspaceId, token) {
    const url = new URL(WORKER_APP_URL);
    url.searchParams.set("workspace", workspaceId);
    url.searchParams.set("invite", token);
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
        `Abre este enlace e inicia sesion con tu correo Google: ${inviteUrl}`,
        `Si aun no tienes la app, puedes instalarla desde: ${WORKER_APP_DOWNLOAD_URL}`
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

function showInviteDialog({
    profile,
    workspace,
    inviteUrl,
    email,
    phoneE164
}) {
    const message = inviteMessage(profile, workspace, inviteUrl);
    const mailtoUrl = email
        ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Invitacion TurnoPlus Trabajador")}&body=${encodeURIComponent(message)}`
        : "";
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
            <p>La invitacion quedo creada. Puedes enviarla por correo, WhatsApp o copiar el enlace.</p>
            <label class="worker-app-invite-link">
                <span>Enlace de invitacion</span>
                <input type="text" value="${escapeHTML(inviteUrl)}" readonly>
            </label>
            <div class="turn-change-dialog__actions worker-app-invite-actions">
                <button class="secondary-button" type="button" data-worker-invite-action="email" ${email ? "" : "disabled"}>Correo</button>
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
        .querySelector("[data-worker-invite-action='email']")
        ?.addEventListener("click", () => {
            if (mailtoUrl) window.location.href = mailtoUrl;
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

export async function openWorkerAppInviteDialog(profile) {
    if (!profile?.name) {
        alert("Selecciona un trabajador para generar el enlace.");
        return;
    }

    const user = getCurrentFirebaseUser();
    const workspace = getActiveWorkspace();

    if (!user) {
        alert("Debes iniciar sesion para enviar enlaces de la app.");
        return;
    }

    if (!workspace?.id) {
        alert("Selecciona un entorno Firebase antes de enviar el enlace.");
        return;
    }

    const email = normalizeEmail(profile.email);
    const phoneE164 = normalizeChileMobile(profile.phone);

    if (!email && !phoneE164) {
        alert("El perfil necesita correo o telefono para enviar la invitacion.");
        return;
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const token = createInviteToken();
    const inviteUrl = getWorkerAppInviteUrl(workspace.id, token);
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
        appDownloadUrl: WORKER_APP_DOWNLOAD_URL,
        createdByUid: user.uid,
        createdByEmail: user.email || "",
        createdByName: user.displayName || "",
        createdAt: now,
        updatedAt: now,
        expiresAt
    };
    const batch = firestoreModule.writeBatch(db);

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

    showInviteDialog({
        profile,
        workspace,
        inviteUrl,
        email,
        phoneE164
    });
}
