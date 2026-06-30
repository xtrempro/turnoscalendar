import { escapeHTML } from "./htmlUtils.js";
import { getJSON, setJSON } from "./persistence.js";
import {
    ATTACHMENT_ACCEPT,
    deleteStoredAttachment,
    openAttachmentFile,
    readAttachmentFile
} from "./attachmentUtils.js";
import { showConfirm } from "./dialogs.js";
import {
    AGENDA_SEED,
    AGENDA_SEED_VERSION
} from "./agendaSeed.js";
import {
    CLAVE_AZUL_CONTACT_ID,
    agendaFavoriteValue,
    agendaFilterValues,
    compareAgendaContacts,
    filterAgendaContacts,
    isClaveAzulContact,
    normalizeAgendaDialNumber
} from "./agendaModel.js";

const STORAGE_KEY = "agenda_contacts";
const SEED_FLAG_KEY = "agenda_seeded_v1";
// v3 reemplaza por completo el directorio anterior con el CSV institucional.
// Es una migracion deliberada: los contactos previos eran solo datos de prueba.
const SEED_VERSION = AGENDA_SEED_VERSION;
const NEW_CONTACT_ID = "__new_contact__";
const CONTACT_PAGE_SIZE = 80;
const CLAVE_AZUL_CONTACT = {
    id: CLAVE_AZUL_CONTACT_ID,
    name: "CLAVE AZUL",
    establishment: "HCV",
    unidad: "Emergencia Adulto",
    cargo: "Emergencia",
    extension: "356427",
    dialNumber: "352206427",
    favorite: false,
    priority: true
};

let selectedContactId = NEW_CONTACT_ID;
let agendaSearch = "";
let agendaEstablishmentFilter = "";
let agendaUnitFilter = "";
let agendaFiltersOpen = false;
let visibleContactLimit = CONTACT_PAGE_SIZE;
let seedChecked = false;

// Carga inicial (una sola vez por version) del directorio institucional. La
// version 3 sustituye el listado de prueba completo; despues cada supervisor
// conserva sus favoritos y ediciones en su copia local.
export function ensureAgendaSeeded() {
    if (seedChecked) return;
    seedChecked = true;

    const seededVersion = Number(getJSON(SEED_FLAG_KEY, 0));
    const existing = getJSON(STORAGE_KEY, []);
    const current = (Array.isArray(existing) ? existing : []).map(normalizeContact);
    let nextContacts = current;

    if (seededVersion < SEED_VERSION) {
        nextContacts = AGENDA_SEED.map((row, index) => {
            if (!Array.isArray(row)) return normalizeContact(row, index);

            const [
                id,
                establishment,
                unidad,
                favorite,
                cargo,
                name,
                extension,
                dialNumber,
                email,
                priority
            ] = row;

            return normalizeContact({
                id,
                establishment,
                unidad,
                favorite,
                cargo,
                name,
                extension,
                dialNumber,
                email,
                priority
            }, index);
        });
    }

    const claveIndex = nextContacts.findIndex(isClaveAzulContact);
    const claveAzul = normalizeContact({
        ...(claveIndex >= 0 ? nextContacts[claveIndex] : {}),
        ...CLAVE_AZUL_CONTACT
    });

    nextContacts = claveIndex >= 0
        ? nextContacts.map((contact, index) =>
            index === claveIndex ? claveAzul : contact
        )
        : [claveAzul, ...nextContacts];

    setJSON(STORAGE_KEY, nextContacts);
    setJSON(SEED_FLAG_KEY, Math.max(seededVersion, SEED_VERSION));
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
        establishment: String(contact.establishment || "").trim(),
        unidad: String(contact.unidad || "").trim(),
        cargo: String(contact.cargo || "").trim(),
        email: String(contact.email || "").trim(),
        extension: String(contact.extension || "").trim(),
        mobile: String(contact.mobile || "").trim(),
        dialNumber: normalizeAgendaDialNumber(contact.dialNumber),
        favorite: agendaFavoriteValue(contact.favorite),
        priority: Boolean(contact.priority),
        notes: String(contact.notes || "").trim(),
        attachment: normalizeAttachment(contact.attachment),
        createdAt: contact.createdAt || new Date().toISOString(),
        updatedAt:
            contact.updatedAt ||
            contact.createdAt ||
            new Date().toISOString()
    };
}

function hasContactData(contact) {
    return Boolean(
        contact.name ||
        contact.cargo ||
        contact.unidad ||
        contact.establishment
    );
}

function getContacts() {
    ensureAgendaSeeded();

    const raw = getJSON(STORAGE_KEY, []);
    const contacts = Array.isArray(raw) ? raw : [];

    return contacts
        .map(normalizeContact)
        .filter(hasContactData)
        .sort(compareAgendaContacts);
}

function saveContacts(contacts) {
    setJSON(
        STORAGE_KEY,
        contacts
            .map(normalizeContact)
            .filter(hasContactData)
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
    return filterAgendaContacts(contacts, {
        search: agendaSearch,
        establishment: agendaEstablishmentFilter,
        unit: agendaUnitFilter
    });
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
    const claveAzul = isClaveAzulContact(contact);
    const displayName = contact.name || contact.cargo || contact.unidad || "Contacto";
    const subtitleParts = [];

    if (contact.name && contact.cargo) subtitleParts.push(contact.cargo);
    if (contact.establishment) subtitleParts.push(contact.establishment);
    if (contact.unidad) subtitleParts.push(contact.unidad);
    if (contact.extension) subtitleParts.push(contact.extension);

    const subtitle = subtitleParts.join(" · ") || contact.email || "Sin datos";
    const favoriteLabel = contact.favorite
        ? "Quitar de favoritos"
        : "Agregar a favoritos";

    return `
        <article class="profile-item agenda-contact-item${active ? " active" : ""}${claveAzul ? " is-priority" : ""}" data-agenda-contact-row="${escapeHTML(contact.id)}">
            <button class="agenda-contact-select" type="button" data-agenda-contact="${escapeHTML(contact.id)}">
                <span class="profile-item__avatar">${claveAzul ? "🚨" : escapeHTML(getInitials(displayName).toUpperCase())}</span>
                <span class="profile-item__content">
                    <strong>${escapeHTML(displayName)}</strong>
                    <span>${escapeHTML(subtitle)}</span>
                </span>
            </button>
            <span class="agenda-contact-item__actions">
                ${
                    claveAzul
                        ? ""
                        : `
                            <button class="agenda-favorite-button${contact.favorite ? " is-favorite" : ""}" type="button" data-agenda-favorite="${escapeHTML(contact.id)}" aria-label="${favoriteLabel}" title="${favoriteLabel}" aria-pressed="${contact.favorite ? "true" : "false"}">
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"></path>
                                </svg>
                            </button>
                        `
                }
                ${
                    contact.dialNumber
                        ? `
                            <a class="agenda-call-button" href="tel:${contact.dialNumber}" data-agenda-call aria-label="Llamar desde el móvil" title="Llamar desde el móvil">
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M6.7 3.5 9.4 3a1.5 1.5 0 0 1 1.7.9l1.2 3a1.5 1.5 0 0 1-.4 1.7l-1.5 1.3a14.7 14.7 0 0 0 3.7 3.7l1.3-1.5a1.5 1.5 0 0 1 1.7-.4l3 1.2a1.5 1.5 0 0 1 .9 1.7l-.5 2.7a3 3 0 0 1-3 2.5C10.1 19.2 4.8 13.9 4.2 6.5a3 3 0 0 1 2.5-3Z"></path>
                                </svg>
                            </a>
                        `
                        : ""
                }
            </span>
        </article>
    `;
}

function renderContactListMarkup(contacts) {
    const visible = filterContacts(contacts);
    const rendered = visible.slice(0, visibleContactLimit);

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

    return `
        ${rendered.map(renderContactItem).join("")}
        ${
            rendered.length < visible.length
                ? `
                    <button class="secondary-button agenda-load-more" type="button" data-agenda-load-more>
                        Mostrar más (${visible.length - rendered.length})
                    </button>
                `
                : ""
        }
    `;
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
    const protectedContact = isClaveAzulContact(contact);

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
                    <span class="metric-label">Establecimiento:</span>
                    <input name="establishment" type="text" maxlength="160" placeholder="Establecimiento" value="${escapeHTML(contact?.establishment || "")}">
                </label>

                <label class="metric-row metric-row--field">
                    <span class="metric-label">Unidad:</span>
                    <input name="unidad" type="text" maxlength="160" placeholder="Unidad" value="${escapeHTML(contact?.unidad || "")}">
                </label>

                <label class="metric-row metric-row--field">
                    <span class="metric-label">Nombre:</span>
                    <input name="name" type="text" maxlength="120" placeholder="Nombre del contacto" value="${escapeHTML(contact?.name || "")}">
                </label>

                <label class="metric-row metric-row--field">
                    <span class="metric-label">Cargo:</span>
                    <input name="cargo" type="text" maxlength="160" placeholder="Cargo" value="${escapeHTML(contact?.cargo || "")}">
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
                    <span class="metric-label">Número para llamar desde móvil:</span>
                    <span>
                        <input name="dialNumber" type="tel" inputmode="numeric" maxlength="11" placeholder="9 dígitos" value="${escapeHTML(contact?.dialNumber || "")}">
                        <small class="field-help">Solo se muestra como botón de llamada y debe contener 9 dígitos.</small>
                    </span>
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
                    isEditing && !protectedContact
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

function renderFilterOptions(values, selected, emptyLabel) {
    return [
        `<option value="">${emptyLabel}</option>`,
        ...values.map(value => `
            <option value="${escapeHTML(value)}" ${value === selected ? "selected" : ""}>
                ${escapeHTML(value)}
            </option>
        `)
    ].join("");
}

function renderAgendaFilters(contacts) {
    const establishments = agendaFilterValues(
        contacts,
        "establishment"
    );
    const contactsForUnits = agendaEstablishmentFilter
        ? filterAgendaContacts(contacts, {
            establishment: agendaEstablishmentFilter
        })
        : contacts;
    const units = agendaFilterValues(contactsForUnits, "unidad");
    const filtersApplied = Boolean(
        agendaEstablishmentFilter || agendaUnitFilter
    );

    return `
        <div class="agenda-list-toolbar">
            <span data-agenda-count>${filterContacts(contacts).length} contacto(s)</span>
            <button class="agenda-filter-toggle${filtersApplied ? " is-active" : ""}" type="button" data-agenda-filter-toggle aria-expanded="${agendaFiltersOpen ? "true" : "false"}">
                Filtros
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m7 10 5 5 5-5"></path>
                </svg>
            </button>
        </div>
        <div class="agenda-filter-menu${agendaFiltersOpen ? "" : " hidden"}" data-agenda-filter-menu>
            <label>
                <span>Establecimiento</span>
                <select data-agenda-establishment-filter>
                    ${renderFilterOptions(establishments, agendaEstablishmentFilter, "Todos los establecimientos")}
                </select>
            </label>
            <label>
                <span>Unidad</span>
                <select data-agenda-unit-filter>
                    ${renderFilterOptions(units, agendaUnitFilter, "Todas las unidades")}
                </select>
            </label>
            <button class="ghost-button" type="button" data-agenda-clear-filters ${filtersApplied ? "" : "disabled"}>
                Limpiar filtros
            </button>
        </div>
    `;
}

function renderShell() {
    const contacts = getContacts();
    const selectedContact = getSelectedContact(contacts);

    return `
        <aside class="panel sidebar agenda-sidebar">
            <h2 class="panel-title">Contactos</h2>

            <div class="agenda-sidebar-actions">
                <button class="primary-button" type="button" data-agenda-new aria-label="Nuevo contacto">
                    <span aria-hidden="true">+</span>
                    <span>Nuevo contacto</span>
                </button>
            </div>

            <label class="field-shell field-shell--icon">
                <svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="11" cy="11" r="7"></circle>
                    <line x1="16.5" y1="16.5" x2="21" y2="21"></line>
                </svg>
                <input data-agenda-search type="search" placeholder="Buscar por nombre, cargo, establecimiento o unidad" value="${escapeHTML(agendaSearch)}">
            </label>

            ${renderAgendaFilters(contacts)}

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

    root.querySelectorAll("[data-agenda-favorite]").forEach(button => {
        button.onclick = () => {
            const contactId = button.dataset.agendaFavorite;

            saveContacts(
                getContacts().map(contact =>
                    contact.id === contactId
                        ? {
                            ...contact,
                            favorite: !contact.favorite,
                            updatedAt: new Date().toISOString()
                        }
                        : contact
                )
            );
            refreshContactList(root);
        };
    });

    root.querySelector("[data-agenda-load-more]")?.addEventListener(
        "click",
        () => {
            visibleContactLimit += CONTACT_PAGE_SIZE;
            refreshContactList(root);
        }
    );
}

function refreshContactList(root) {
    const contacts = getContacts();
    const list = root.querySelector("[data-agenda-list]");

    if (!list) return;

    list.innerHTML = renderContactListMarkup(contacts);
    const count = root.querySelector("[data-agenda-count]");

    if (count) {
        count.textContent = `${filterContacts(contacts).length} contacto(s)`;
    }
    bindContactListEvents(root);
}

function bindAgendaEvents(root) {
    const searchInput = root.querySelector("[data-agenda-search]");
    const form = root.querySelector("[data-agenda-form]");

    if (searchInput) {
        searchInput.oninput = () => {
            agendaSearch = searchInput.value;
            visibleContactLimit = CONTACT_PAGE_SIZE;
            refreshContactList(root);
        };
    }

    root.querySelector("[data-agenda-filter-toggle]")?.addEventListener(
        "click",
        event => {
            agendaFiltersOpen = !agendaFiltersOpen;
            event.currentTarget.setAttribute(
                "aria-expanded",
                agendaFiltersOpen ? "true" : "false"
            );
            root
                .querySelector("[data-agenda-filter-menu]")
                ?.classList.toggle("hidden", !agendaFiltersOpen);
        }
    );

    root
        .querySelector("[data-agenda-establishment-filter]")
        ?.addEventListener("change", event => {
            agendaEstablishmentFilter = event.currentTarget.value;
            agendaUnitFilter = "";
            visibleContactLimit = CONTACT_PAGE_SIZE;
            agendaFiltersOpen = true;
            renderAgendaPanel();
        });

    root
        .querySelector("[data-agenda-unit-filter]")
        ?.addEventListener("change", event => {
            agendaUnitFilter = event.currentTarget.value;
            visibleContactLimit = CONTACT_PAGE_SIZE;
            agendaFiltersOpen = true;
            renderAgendaPanel();
        });

    root.querySelector("[data-agenda-clear-filters]")?.addEventListener(
        "click",
        () => {
            agendaEstablishmentFilter = "";
            agendaUnitFilter = "";
            visibleContactLimit = CONTACT_PAGE_SIZE;
            agendaFiltersOpen = true;
            renderAgendaPanel();
        }
    );

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

    const dialNumberInput = form.elements.dialNumber;

    if (dialNumberInput) {
        dialNumberInput.oninput = () => {
            dialNumberInput.value = dialNumberInput.value
                .replace(/\D/g, "")
                .slice(0, 11);
        };
    }

    form.onsubmit = async event => {
        event.preventDefault();

        const data = new FormData(form);
        const name = String(data.get("name") || "").trim();
        const cargo = String(data.get("cargo") || "").trim();
        const unidad = String(data.get("unidad") || "").trim();
        const establishment = String(
            data.get("establishment") || ""
        ).trim();
        const rawDialNumber = String(data.get("dialNumber") || "").trim();
        const dialNumber = normalizeAgendaDialNumber(rawDialNumber);

        if (!name && !cargo && !unidad && !establishment) {
            alert("Ingresa al menos nombre, cargo, establecimiento o unidad.");
            return;
        }

        if (rawDialNumber && !dialNumber) {
            alert(
                "El número para llamar desde móvil debe contener exactamente 9 dígitos."
            );
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
        } catch (error) {
            alert(error?.planBlocked
                ? error.message
                : "No se pudo leer el archivo adjunto. Intenta nuevamente con otro documento.");
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
            establishment,
            unidad,
            cargo,
            email: data.get("email"),
            extension: data.get("extension"),
            mobile: data.get("mobile"),
            dialNumber,
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
