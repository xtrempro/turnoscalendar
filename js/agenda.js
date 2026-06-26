import { normalizeText } from "./stringUtils.js";
import { escapeHTML } from "./htmlUtils.js";
import { getJSON, setJSON } from "./persistence.js";
import {
    ATTACHMENT_ACCEPT,
    deleteStoredAttachment,
    openAttachmentFile,
    readAttachmentFile
} from "./attachmentUtils.js";
import { showConfirm } from "./dialogs.js";

const STORAGE_KEY = "agenda_contacts";
const NEW_CONTACT_ID = "__new_contact__";

let selectedContactId = NEW_CONTACT_ID;
let agendaSearch = "";

function normalizeSearch(value) {
    return normalizeText(value);
}

function normalizeAttachment(attachment) {
    if (!attachment?.name) return null;

    return {
        id: String(attachment.id || `agenda_doc_${Date.now()}`),
        name: String(attachment.name || ""),
        type: String(attachment.type || ""),
        size: Number(attachment.size || 0),
        addedAt: attachment.addedAt || new Date().toISOString(),
        dataUrl: attachment.dataUrl || "",
        storagePath: attachment.storagePath || "",
        uploadedByUid: attachment.uploadedByUid || ""
    };
}

function normalizeContact(contact = {}, index = 0) {
    return {
        id: String(
            contact.id ||
                `agenda_${Date.now()}_${index}_${Math.random()
                    .toString(36)
                    .slice(2, 8)}`
        ),
        name: String(contact.name || "").trim(),
        cargo: String(contact.cargo || "").trim(),
        email: String(contact.email || "").trim(),
        extension: String(contact.extension || "").trim(),
        mobile: String(contact.mobile || "").trim(),
        notes: String(contact.notes || "").trim(),
        attachment: normalizeAttachment(contact.attachment),
        createdAt: contact.createdAt || new Date().toISOString(),
        updatedAt:
            contact.updatedAt ||
            contact.createdAt ||
            new Date().toISOString()
    };
}

function getContacts() {
    const raw = getJSON(STORAGE_KEY, []);
    const contacts = Array.isArray(raw) ? raw : [];

    return contacts
        .map(normalizeContact)
        .filter(contact => contact.name)
        .sort((a, b) => a.name.localeCompare(b.name));
}

function saveContacts(contacts) {
    setJSON(
        STORAGE_KEY,
        contacts
            .map(normalizeContact)
            .filter(contact => contact.name)
    );
}

function getInitials(name) {
    const parts = String(name || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    return (parts[0]?.[0] || "?") + (parts[1]?.[0] || "");
}

function filterContacts(contacts) {
    const query = normalizeSearch(agendaSearch);

    if (!query) return contacts;

    return contacts.filter(contact =>
        [contact.name, contact.cargo].some(value =>
            normalizeSearch(value).includes(query)
        )
    );
}

function getSelectedContact(contacts) {
    if (selectedContactId === NEW_CONTACT_ID) return null;

    return (
        contacts.find(contact => contact.id === selectedContactId) ||
        null
    );
}

async function openAttachment(attachment) {
    try {
        await openAttachmentFile(attachment, { newTab: true });
    } catch (error) {
        alert(error?.message || "No se pudo abrir el adjunto.");
    }
}

function renderContactItem(contact) {
    const active = contact.id === selectedContactId;
    const subtitle = contact.cargo || contact.email || "Sin cargo";

    return `
        <button class="profile-item agenda-contact-item${active ? " active" : ""}" type="button" data-agenda-contact="${escapeHTML(contact.id)}">
            <span class="profile-item__avatar">${escapeHTML(getInitials(contact.name).toUpperCase())}</span>
            <span class="profile-item__content">
                <strong>${escapeHTML(contact.name)}</strong>
                <span>${escapeHTML(subtitle)}</span>
            </span>
        </button>
    `;
}

function renderContactListMarkup(contacts) {
    const visible = filterContacts(contacts);

    if (!contacts.length) {
        return `
            <div class="empty-state empty-state--compact">
                Sin contactos registrados.
            </div>
        `;
    }

    if (!visible.length) {
        return `
            <div class="empty-state empty-state--compact">
                Sin resultados para la busqueda.
            </div>
        `;
    }

    return visible.map(renderContactItem).join("");
}

function renderAttachment(attachment) {
    if (!attachment) {
        return `
            <div class="attachment-empty">
                Sin archivo adjunto.
            </div>
        `;
    }

    return `
        <div class="attachment-item">
            <span>
                <strong>${escapeHTML(attachment.name)}</strong>
                <small>${escapeHTML(attachment.type || "Archivo")}</small>
            </span>
            <span class="attachment-actions">
                <button class="secondary-button attachment-view" type="button" data-agenda-view-attachment>
                    Ver
                </button>
                <button class="ghost-button attachment-remove" type="button" data-agenda-remove-attachment>
                    Quitar
                </button>
            </span>
        </div>
    `;
}

function renderForm(contact) {
    const isEditing = Boolean(contact);

    return `
        <form class="agenda-form" data-agenda-form autocomplete="off">
            <div class="section-head section-head--with-action">
                <span class="section-head__title">
                    <span class="section-icon tone-green">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M7 3h10a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"></path>
                            <path d="M8 8h8"></path>
                            <path d="M8 12h5"></path>
                        </svg>
                    </span>
                    <h3>${isEditing ? "Contacto" : "Nuevo contacto"}</h3>
                </span>
            </div>

            <div class="agenda-form-grid">
                <label class="metric-row metric-row--field">
                    <span class="metric-label">Nombre:</span>
                    <input name="name" type="text" maxlength="120" placeholder="Nombre del contacto" value="${escapeHTML(contact?.name || "")}" required>
                </label>

                <label class="metric-row metric-row--field">
                    <span class="metric-label">Cargo:</span>
                    <input name="cargo" type="text" maxlength="120" placeholder="Cargo" value="${escapeHTML(contact?.cargo || "")}">
                </label>

                <label class="metric-row metric-row--field">
                    <span class="metric-label">Correo:</span>
                    <input name="email" type="email" maxlength="160" placeholder="correo@ejemplo.cl" value="${escapeHTML(contact?.email || "")}">
                </label>

                <label class="metric-row metric-row--field">
                    <span class="metric-label">Anexo:</span>
                    <input name="extension" type="text" maxlength="40" placeholder="Anexo" value="${escapeHTML(contact?.extension || "")}">
                </label>

                <label class="metric-row metric-row--field">
                    <span class="metric-label">Celular:</span>
                    <input name="mobile" type="tel" maxlength="40" placeholder="+569..." value="${escapeHTML(contact?.mobile || "")}">
                </label>

                <label class="metric-row metric-row--field">
                    <span class="metric-label">Archivo Adjunto:</span>
                    <span>
                        <input name="attachment" type="file" accept="${ATTACHMENT_ACCEPT}">
                        <small class="field-help">Al guardar reemplaza el archivo adjunto actual.</small>
                    </span>
                </label>

                <label class="metric-row metric-row--field agenda-field--wide">
                    <span class="metric-label">Notas:</span>
                    <textarea name="notes" class="agenda-notes" rows="5" maxlength="900" placeholder="Notas del contacto">${escapeHTML(contact?.notes || "")}</textarea>
                </label>
            </div>

            <div class="attachment-list agenda-attachment-list">
                ${renderAttachment(contact?.attachment)}
            </div>

            <div class="agenda-actions">
                <button class="primary-button" type="submit">
                    Guardar contacto
                </button>
                <button class="secondary-button" type="button" data-agenda-new>
                    Nuevo
                </button>
                ${
                    isEditing
                        ? `
                            <button class="ghost-button agenda-delete-button" type="button" data-agenda-delete>
                                Eliminar
                            </button>
                        `
                        : ""
                }
            </div>
        </form>
    `;
}

function renderShell() {
    const contacts = getContacts();
    const selectedContact = getSelectedContact(contacts);

    return `
        <aside class="panel sidebar agenda-sidebar">
            <h2 class="panel-title">Contactos</h2>

            <label class="field-shell field-shell--icon">
                <svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="11" cy="11" r="7"></circle>
                    <line x1="16.5" y1="16.5" x2="21" y2="21"></line>
                </svg>
                <input data-agenda-search type="search" placeholder="Buscar por nombre o cargo" value="${escapeHTML(agendaSearch)}">
            </label>

            <div class="profile-list agenda-contact-list" data-agenda-list>
                ${renderContactListMarkup(contacts)}
            </div>
        </aside>

        <section class="panel agenda-panel">
            ${renderForm(selectedContact)}
        </section>
    `;
}

function bindContactListEvents(root) {
    root.querySelectorAll("[data-agenda-contact]").forEach(button => {
        button.onclick = () => {
            selectedContactId = button.dataset.agendaContact;
            renderAgendaPanel();
        };
    });
}

function refreshContactList(root) {
    const contacts = getContacts();
    const list = root.querySelector("[data-agenda-list]");

    if (!list) return;

    list.innerHTML = renderContactListMarkup(contacts);
    bindContactListEvents(root);
}

function bindAgendaEvents(root) {
    const searchInput = root.querySelector("[data-agenda-search]");
    const form = root.querySelector("[data-agenda-form]");

    if (searchInput) {
        searchInput.oninput = () => {
            agendaSearch = searchInput.value;
            refreshContactList(root);
        };
    }

    root.querySelectorAll("[data-agenda-new]").forEach(button => {
        button.onclick = () => {
            selectedContactId = NEW_CONTACT_ID;
            renderAgendaPanel();
            document
                .querySelector("[data-agenda-form] input[name='name']")
                ?.focus();
        };
    });

    bindContactListEvents(root);

    if (!form) return;

    form.onsubmit = async event => {
        event.preventDefault();

        const data = new FormData(form);
        const name = String(data.get("name") || "").trim();

        if (!name) {
            alert("Ingresa el nombre del contacto.");
            return;
        }

        const contacts = getContacts();
        const current = getSelectedContact(contacts);
        const now = new Date().toISOString();
        const file = form.elements.attachment?.files?.[0];
        const previousAttachment = current?.attachment || null;
        let attachment = current?.attachment || null;

        try {
            if (file) {
                attachment = await readAttachmentFile(file, {
                    moduleId: "agenda",
                    ownerId:
                        current?.id ||
                        selectedContactId ||
                        "new-contact",
                    recordId: "contact-attachment"
                });
            }
        } catch {
            alert("No se pudo leer el archivo adjunto. Intenta nuevamente con otro documento.");
            return;
        }

        const nextContact = normalizeContact({
            ...(current || {}),
            id:
                current?.id ||
                `agenda_${Date.now()}_${Math.random()
                    .toString(36)
                    .slice(2, 8)}`,
            name,
            cargo: data.get("cargo"),
            email: data.get("email"),
            extension: data.get("extension"),
            mobile: data.get("mobile"),
            notes: data.get("notes"),
            attachment,
            createdAt: current?.createdAt || now,
            updatedAt: now
        });

        const nextContacts = current
            ? contacts.map(contact =>
                contact.id === current.id ? nextContact : contact
            )
            : [...contacts, nextContact];

        saveContacts(nextContacts);
        if (
            file &&
            previousAttachment?.storagePath &&
            previousAttachment.storagePath !== attachment?.storagePath
        ) {
            await deleteStoredAttachment(previousAttachment)
                .catch(error => {
                    console.warn(
                        "No se pudo eliminar el adjunto reemplazado.",
                        error
                    );
                });
        }
        selectedContactId = nextContact.id;
        agendaSearch = "";
        renderAgendaPanel();
    };

    const selectedContact = getSelectedContact(getContacts());

    root.querySelector("[data-agenda-delete]")?.addEventListener(
        "click",
        async () => {
            if (!selectedContact) return;
            if (
                !await showConfirm(
                    "Se eliminará el contacto y sus datos asociados.",
                    {
                        title: "Eliminar contacto",
                        tone: "danger",
                        confirmText: "Eliminar",
                        destructive: true
                    }
                )
            ) {
                return;
            }

            saveContacts(
                getContacts().filter(
                    contact => contact.id !== selectedContact.id
                )
            );
            await deleteStoredAttachment(selectedContact.attachment)
                .catch(error => {
                    console.warn(
                        "No se pudo eliminar el adjunto remoto.",
                        error
                    );
                });
            selectedContactId = NEW_CONTACT_ID;
            renderAgendaPanel();
        }
    );

    root.querySelector("[data-agenda-view-attachment]")?.addEventListener(
        "click",
        () => openAttachment(selectedContact?.attachment)
    );

    root.querySelector("[data-agenda-remove-attachment]")?.addEventListener(
        "click",
        async () => {
            if (!selectedContact) return;

            saveContacts(
                getContacts().map(contact =>
                    contact.id === selectedContact.id
                        ? {
                            ...contact,
                            attachment: null,
                            updatedAt: new Date().toISOString()
                        }
                        : contact
                )
            );
            await deleteStoredAttachment(selectedContact.attachment)
                .catch(error => {
                    console.warn(
                        "No se pudo eliminar el adjunto remoto.",
                        error
                    );
                });
            renderAgendaPanel();
        }
    );
}

export function renderAgendaPanel() {
    const root = document.getElementById("agendaPanel");

    if (!root) return;

    root.innerHTML = renderShell();
    bindAgendaEvents(root);
}
