import { escapeHTML } from "./htmlUtils.js";
import { getJSON, setJSON } from "./persistence.js";
import {
    ATTACHMENT_ACCEPT,
    MAX_ATTACHMENT_FILES,
    attachmentStorageErrorMessage,
    canPreviewAttachment,
    deleteStoredAttachment,
    hasAttachmentContent,
    openAttachmentFile,
    readAttachmentFiles
} from "./attachmentUtils.js";
import {
    getCurrentFirebaseUser,
    getFirebaseServices,
    isFirebaseConfigured
} from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";
import { canEditMenu } from "./workspacePermissions.js";
import { showAlert, showConfirm } from "./dialogs.js";
import { getProfiles, isProfileActive } from "./storage.js";
import { getWorkerAppLinkForProfile } from "./workerAppLinks.js";
import {
    AUDIENCE_MODES,
    INFORMATION_CATEGORIES,
    audienceIncludes,
    audienceIsEmpty,
    audienceSummary,
    categoryLabel,
    effectiveStatus,
    normalizeAudience,
    normalizeCategory,
    normalizeStatus
} from "./informationsModel.js";
import {
    hasRead,
    informationReadsError,
    readStampFor,
    watchInformationReads
} from "./informationReads.js";

export const INFORMATIONS_KEY = "informations";
const PUBLISHED_DOC_ID = "informations";
const MAX_TITLE_LENGTH = 140;
const MAX_BODY_LENGTH = 5000;
const MAX_ITEMS = 200;

let editingInformationId = "";
let savingInformation = false;
// null = se ve la bandeja. Un objeto = el compositor esta abierto con ese
// borrador en pantalla. Vive en el modulo -y no en el DOM- porque el panel se
// vuelve a pintar entero cada vez que se toca un interruptor, y lo escrito
// tiene que sobrevivir a eso.
let composerDraft = null;
let activeTab = "publicadas";
let searchQuery = "";
let categoryFilter = "todas";
// Informacion cuya ficha de lectura esta abierta.
let readerInformationId = "";
let readerTab = "leyeron";

const TAB_STATUS = {
    publicadas: "published",
    programadas: "scheduled",
    borradores: "draft",
    archivadas: "archived"
};

const CATEGORY_TONE = {
    protocolo: "purple",
    turnos: "blue",
    urgente: "red",
    capacitacion: "green",
    general: "orange"
};

function makeId(prefix = "info") {
    return globalThis.crypto?.randomUUID?.() ||
        `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function escapeAttribute(value) {
    return escapeHTML(value).replace(/`/g, "&#096;");
}

function clampText(value, maxLength) {
    return String(value || "").trim().slice(0, maxLength);
}

function normalizeAttachment(attachment = {}) {
    const name = clampText(attachment.name, 240);
    const dataUrl = String(attachment.dataUrl || "");
    const storagePath = String(attachment.storagePath || "");
    const downloadURL = String(attachment.downloadURL || "");

    if (!name || (!dataUrl && !storagePath && !downloadURL)) return null;

    return {
        id: String(attachment.id || makeId("info_file")),
        name,
        type: String(attachment.type || "application/octet-stream")
            .toLowerCase(),
        size: Number(attachment.size) || 0,
        addedAt: String(
            attachment.addedAt ||
            attachment.attachedAt ||
            new Date().toISOString()
        ),
        dataUrl,
        storagePath,
        downloadURL,
        uploadedByUid: String(attachment.uploadedByUid || "")
    };
}

function isImageAttachment(attachment = {}) {
    const type = String(attachment.type || "").toLowerCase();
    const name = String(attachment.name || "").toLowerCase();

    return type.startsWith("image/") ||
        /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/.test(name);
}

// Etiqueta VIEJA, derivada del tipo de archivo (Anuncio / Imagen / Documento).
// La reemplazo la categoria elegida a mano, que dice algo que el adjunto no
// dice, pero se sigue calculando y publicando: una PWA que todavia no se
// actualizo lee `type` y se quedaria sin etiqueta si desapareciera.
function informationType(item = {}) {
    const attachments = Array.isArray(item.attachments)
        ? item.attachments
        : [];

    if (attachments.some(isImageAttachment)) return "image";
    if (attachments.length) return "document";

    return "announcement";
}

function fileExtLabel(attachment = {}) {
    const name = String(attachment.name || "").toLowerCase();

    if (isImageAttachment(attachment)) return "IMG";
    if (/\.pdf$/.test(name)) return "PDF";
    if (/\.(xlsx?|csv)$/.test(name)) return "XLS";
    if (/\.(docx?|rtf|txt)$/.test(name)) return "DOC";

    return "DOC";
}

function normalizeInformation(item = {}) {
    const createdAt = String(item.createdAt || new Date().toISOString());
    const updatedAt = String(item.updatedAt || item.publishedAt || createdAt);
    const attachments = Array.isArray(item.attachments)
        ? item.attachments.map(normalizeAttachment).filter(Boolean)
        : [];
    const normalized = {
        id: String(item.id || makeId()),
        title: clampText(item.title || "Informacion", MAX_TITLE_LENGTH),
        body: clampText(item.body || item.message || "", MAX_BODY_LENGTH),
        pinned: Boolean(item.pinned),
        // Sin `status` guardado es una informacion de antes de este cambio:
        // todas las que existian estaban publicadas.
        status: normalizeStatus(item.status),
        category: normalizeCategory(item.category),
        audience: normalizeAudience(item.audience),
        requiresAck: Boolean(item.requiresAck),
        notify: item.notify === undefined ? true : Boolean(item.notify),
        publishAt: String(item.publishAt || ""),
        expiresAt: String(item.expiresAt || ""),
        createdAt,
        updatedAt,
        publishedAt: String(item.publishedAt || updatedAt),
        createdByUid: String(item.createdByUid || ""),
        updatedByUid: String(item.updatedByUid || ""),
        attachments
    };

    normalized.type = informationType(normalized);

    return normalized;
}

function sortInformations(a, b) {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;

    return new Date(b.publishedAt || b.updatedAt || b.createdAt) -
        new Date(a.publishedAt || a.updatedAt || a.createdAt);
}

export function normalizeInformations(value = []) {
    return (Array.isArray(value) ? value : [])
        .map(normalizeInformation)
        .filter(item => item.title || item.body || item.attachments.length)
        .sort(sortInformations)
        .slice(0, MAX_ITEMS);
}

export function getInformations() {
    return normalizeInformations(getJSON(INFORMATIONS_KEY, []));
}

/* ==========================================================================
   Destinatarios contra la nomina real
   ========================================================================== */

function activeProfiles() {
    return getProfiles().filter(isProfileActive);
}

export function audienceProfiles(audience) {
    return activeProfiles().filter(profile => audienceIncludes(audience, profile));
}

function audienceGroupOptions(mode) {
    const key = mode === "profession" ? "profession" : "estamento";
    const fallback = mode === "profession" ? "Sin informacion" : "Sin estamento";
    const counts = new Map();

    activeProfiles().forEach(profile => {
        const value = String(profile?.[key] || "").trim() || fallback;

        counts.set(value, (counts.get(value) || 0) + 1);
    });

    return [...counts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => a.label.localeCompare(b.label, "es"));
}

function linkedCount(profiles) {
    return profiles.filter(profile => getWorkerAppLinkForProfile(profile)?.uid)
        .length;
}

/* ==========================================================================
   Lo que viaja a la PWA
   ========================================================================== */

function publicAttachmentPayload(attachment = {}) {
    const normalized = normalizeAttachment(attachment);

    if (!normalized) return null;

    return {
        id: normalized.id,
        name: normalized.name,
        type: normalized.type,
        size: normalized.size,
        addedAt: normalized.addedAt,
        storagePath: normalized.storagePath,
        downloadURL: normalized.downloadURL,
        uploadedByUid: normalized.uploadedByUid
    };
}

export function publicInformationsPayload(items = getInformations()) {
    return normalizeInformations(items)
        // El borrador no ha salido y la archivada ya se retiro: ninguna de las
        // dos tiene por que ocupar espacio en el documento compartido. La
        // programada SI viaja, con su fecha, y la PWA la esconde hasta el dia;
        // asi la hora de publicacion se cumple sin que nadie tenga que tener la
        // aplicacion abierta a esa hora.
        .filter(item => {
            const status = normalizeStatus(item.status);

            return status !== "draft" && status !== "archived";
        })
        .map(item => ({
            id: item.id,
            title: item.title,
            body: item.body,
            // `type` es la etiqueta vieja; se mantiene para la PWA que aun no
            // se actualiza. Ver el comentario de informationType().
            type: informationType(item),
            category: item.category,
            audience: item.audience,
            requiresAck: item.requiresAck,
            pinned: item.pinned,
            status: normalizeStatus(item.status),
            publishAt: item.publishAt,
            expiresAt: item.expiresAt,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            publishedAt: item.publishedAt,
            createdByUid: item.createdByUid,
            updatedByUid: item.updatedByUid,
            attachments: item.attachments
                .map(publicAttachmentPayload)
                .filter(attachment =>
                    attachment &&
                    (attachment.storagePath || attachment.downloadURL)
                )
        }));
}

function dispatchInformationsChanged() {
    if (typeof window === "undefined") return;

    window.dispatchEvent(new CustomEvent("proturnos:informationsChanged"));
}

export async function publishInformationsToWorkers(items = getInformations()) {
    const workspace = getActiveWorkspace();

    if (!isFirebaseConfigured() || !workspace?.id) {
        return false;
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const now = new Date().toISOString();
    const payload = publicInformationsPayload(items);
    const ref = firestoreModule.doc(
        db,
        "workspaces",
        workspace.id,
        "published",
        PUBLISHED_DOC_ID
    );

    await firestoreModule.setDoc(ref, {
        workspaceId: workspace.id,
        workspaceName: workspace.name || "",
        items: payload,
        updatedAt: typeof firestoreModule.serverTimestamp === "function"
            ? firestoreModule.serverTimestamp()
            : now,
        updatedAtISO: now,
        updatedByUid: getCurrentFirebaseUser()?.uid || ""
    }, { merge: true });

    return true;
}

async function saveInformations(items, options = {}) {
    const normalized = normalizeInformations(items);

    setJSON(INFORMATIONS_KEY, normalized);
    dispatchInformationsChanged();

    if (options.publish !== false) {
        await publishInformationsToWorkers(normalized);
    }

    return normalized;
}

function informationNotificationRecipientUids(item) {
    return [...new Set(
        audienceProfiles(item?.audience)
            .map(profile => uidOf(profile))
            .filter(Boolean)
    )];
}

function shouldNotifyInformationPublish(current, nextItem, status) {
    if (!nextItem?.notify || status !== "published") return false;

    // Una informacion que ya estaba publicada no vuelve a sonar por una edicion:
    // el switch avisa el alta/publicacion, no cada correccion de texto.
    return !current || effectiveStatus(current) !== "published";
}

async function notifyInformationPublished(item) {
    const workspace = getActiveWorkspace();
    const recipientUids = informationNotificationRecipientUids(item);

    if (!item?.id || !workspace?.id || !recipientUids.length) {
        return { ok: true, recipients: recipientUids.length, notified: 0 };
    }

    if (!isFirebaseConfigured()) {
        return { ok: false, recipients: recipientUids.length, notified: 0 };
    }

    const { functions, functionsModule } = await getFirebaseServices();
    const callable = functionsModule.httpsCallable(
        functions,
        "notifyInformationPublished"
    );
    const response = await callable({
        workspaceId: workspace.id,
        informationId: item.id,
        recipientUids,
        clientCreatedAtISO: new Date().toISOString()
    });

    return response.data || {};
}

/* ==========================================================================
   Formato
   ========================================================================== */

function formatDateTime(value) {
    const date = new Date(String(value || ""));

    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleString("es-CL", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function formatBytes(value) {
    const size = Number(value) || 0;

    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;

    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

// `datetime-local` quiere `YYYY-MM-DDTHH:mm` en hora local; lo guardado es ISO.
function toLocalInputValue(iso) {
    const date = new Date(String(iso || ""));

    if (Number.isNaN(date.getTime())) return "";

    const pad = value => String(value).padStart(2, "0");

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInputValue(value) {
    const text = String(value || "").trim();

    if (!text) return "";

    const date = new Date(text);

    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

// Iniciales y color del avatar de la ficha de lectura. El tono sale del nombre
// -no del azar- para que la misma persona salga siempre del mismo color, que es
// lo que deja reconocerla de un vistazo al recorrer la lista.
function initialsOf(name) {
    const parts = String(name || "").trim().split(/\s+/);

    return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase();
}

const AVATAR_TONES = ["blue", "purple", "teal", "orange"];

function avatarTone(name, read) {
    if (!read) return "muted";

    let sum = 0;

    String(name || "").split("").forEach(char => {
        sum += char.charCodeAt(0);
    });

    return AVATAR_TONES[sum % AVATAR_TONES.length];
}

/* ==========================================================================
   Bandeja
   ========================================================================== */

function matchesFilters(item) {
    const status = effectiveStatus(item);

    if (status !== TAB_STATUS[activeTab]) return false;
    if (categoryFilter !== "todas" && item.category !== categoryFilter) return false;

    const query = searchQuery.trim().toLowerCase();

    if (!query) return true;

    const haystack = [
        item.title,
        item.body,
        categoryLabel(item.category),
        ...item.attachments.map(attachment => attachment.name)
    ].join(" ").toLowerCase();

    return haystack.includes(query);
}

// El uid del enlace de la PWA de esa persona, que es la llave del documento de
// confirmaciones. Sin enlace no hay uid: esa persona no puede confirmar nada
// porque la informacion ni siquiera le llega.
function uidOf(profile) {
    return getWorkerAppLinkForProfile(profile)?.uid || "";
}

function readStatsFor(item) {
    const targets = audienceProfiles(item.audience);
    const read = targets.filter(profile => hasRead(item.id, uidOf(profile))).length;
    const total = targets.length;

    return {
        total,
        read,
        pending: Math.max(total - read, 0),
        percent: total ? Math.round((read / total) * 100) : 0
    };
}

function tagHTML(item) {
    const tone = CATEGORY_TONE[item.category] || "orange";

    return `<span class="worker-request-type information-type information-type--${escapeAttribute(tone)}">${escapeHTML(categoryLabel(item.category))}</span>`;
}

function readBlockHTML(item, status) {
    if (status === "draft") {
        return `
            <div class="information-read">
                <span class="information-read__label">Sin publicar</span>
                <strong class="information-read__value">--</strong>
                <small>Todavia no sale de aqui</small>
            </div>
        `;
    }

    const stats = readStatsFor(item);

    if (status === "scheduled") {
        return `
            <div class="information-read">
                <span class="information-read__label">Alcance previsto</span>
                <strong class="information-read__value">${stats.total}</strong>
                <small>personas al publicar</small>
            </div>
        `;
    }

    if (!item.requiresAck) {
        return `
            <div class="information-read">
                <span class="information-read__label">Destinatarios</span>
                <strong class="information-read__value">${stats.total}</strong>
                <small>sin confirmacion pedida</small>
            </div>
        `;
    }

    const level = stats.percent >= 90
        ? "ok"
        : stats.percent >= 60 ? "mid" : "low";

    return `
        <div class="information-read information-read--${level}">
            <span class="information-read__label">Confirmaron</span>
            <strong class="information-read__value">${stats.percent}%</strong>
            <span class="information-read__bar"><span style="width: ${stats.percent}%"></span></span>
            <small>${stats.read} de ${stats.total} trabajadores</small>
        </div>
    `;
}

// Los cuatro datos de la fila de metadatos llevan icono. No es adorno: los
// cuatro son texto corto y parecido -"73 personas", "1 archivo", una fecha y
// otra fecha- y sin el icono hay que LEERLOS para saber cual es cual.
const CHIP_ICONS = {
    people: `<path d="M16 19v-1.5a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3V19"></path><circle cx="9.5" cy="7.5" r="3"></circle><path d="M21 19v-1.5a3 3 0 0 0-2.2-2.9"></path><path d="M16 4.6a3 3 0 0 1 0 5.8"></path>`,
    clip: `<path d="M20 11.5 12.4 19a4.5 4.5 0 0 1-6.4-6.4l7.6-7.5a3 3 0 0 1 4.2 4.2l-7.5 7.6a1.5 1.5 0 0 1-2.1-2.1l6.9-6.9"></path>`,
    clock: `<circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.6V12l2.8 1.8"></path>`,
    calendar: `<rect x="3.5" y="5" width="17" height="15.5" rx="3"></rect><path d="M8 2.6v4"></path><path d="M16 2.6v4"></path><path d="M3.5 10h17"></path>`
};

function chipHTML(icon, text, modifier = "") {
    return `
        <span class="information-chip${modifier}">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${CHIP_ICONS[icon]}</svg>
            ${escapeHTML(text)}
        </span>
    `;
}

function metaChipsHTML(item, status) {
    const targets = audienceProfiles(item.audience);
    const chips = [
        chipHTML("people", audienceSummary(item.audience, targets.length))
    ];

    if (item.attachments.length) {
        chips.push(chipHTML(
            "clip",
            `${item.attachments.length} ${item.attachments.length === 1 ? "archivo" : "archivos"}`
        ));
    }

    if (status === "scheduled" && item.publishAt) {
        chips.push(chipHTML(
            "clock",
            `Se publica el ${formatDateTime(item.publishAt)}`,
            " information-chip--soon"
        ));
    } else if (status === "draft") {
        chips.push(chipHTML("clock", `Editado ${formatDateTime(item.updatedAt)}`));
    } else {
        chips.push(chipHTML(
            "clock",
            `Publicado ${formatDateTime(item.publishedAt || item.updatedAt)}`
        ));
    }

    if (item.expiresAt && status !== "draft") {
        chips.push(chipHTML(
            "calendar",
            `Se archiva el ${formatDateTime(item.expiresAt)}`,
            " information-chip--warn"
        ));
    }

    return chips.join("");
}

function fileButtonsHTML(item, attachment) {
    const preview = canPreviewAttachment(attachment);

    return `
        <span class="information-file">
            <span class="information-file__badge information-file__badge--${escapeAttribute(fileExtLabel(attachment).toLowerCase())}">${escapeHTML(fileExtLabel(attachment))}</span>
            <span class="information-file__meta">
                <strong>${escapeHTML(attachment.name)}</strong>
                <small>${escapeHTML(formatBytes(attachment.size))}</small>
            </span>
            <button class="information-file__button" type="button" data-info-open="${escapeAttribute(item.id)}" data-info-file="${escapeAttribute(attachment.id)}">
                ${preview ? "Ver" : "Abrir"}
            </button>
            <button class="information-file__button ghost" type="button" data-info-download="${escapeAttribute(item.id)}" data-info-file="${escapeAttribute(attachment.id)}">
                Descargar
            </button>
        </span>
    `;
}

function cardActionsHTML(item, status) {
    if (!canEditMenu("informations")) return "";

    const actions = [];

    if (status === "published") {
        if (item.requiresAck) {
            actions.push(
                `<button class="secondary-button secondary-button--small" type="button" data-info-readers="${escapeAttribute(item.id)}">Ver quien leyo</button>`
            );
        }
        actions.push(
            `<button class="ghost-button ghost-button--small" type="button" data-info-edit="${escapeAttribute(item.id)}">Editar</button>`,
            `<button class="ghost-button ghost-button--small" type="button" data-info-archive="${escapeAttribute(item.id)}">Archivar</button>`
        );
    } else if (status === "scheduled") {
        actions.push(
            `<button class="secondary-button secondary-button--small" type="button" data-info-publish-now="${escapeAttribute(item.id)}">Publicar ahora</button>`,
            `<button class="ghost-button ghost-button--small" type="button" data-info-edit="${escapeAttribute(item.id)}">Editar</button>`
        );
    } else if (status === "draft") {
        actions.push(
            `<button class="secondary-button secondary-button--small" type="button" data-info-edit="${escapeAttribute(item.id)}">Continuar redaccion</button>`
        );
    } else {
        actions.push(
            `<button class="secondary-button secondary-button--small" type="button" data-info-restore="${escapeAttribute(item.id)}">Volver a publicar</button>`
        );
    }

    actions.push(
        `<button class="danger-action" type="button" data-info-delete="${escapeAttribute(item.id)}">Eliminar</button>`
    );

    return `<div class="information-actions">${actions.join("")}</div>`;
}

function informationCardHTML(item) {
    const status = effectiveStatus(item);
    const attachments = item.attachments || [];

    return `
        <article class="information-card ${item.pinned ? "is-pinned" : ""}">
            <div class="information-card__head">
                <div class="information-card__lead">
                    <div class="information-card__tags">
                        ${tagHTML(item)}
                        ${item.pinned ? `<span class="information-pin">Fijado</span>` : ""}
                        ${item.requiresAck && status === "published" ? `<span class="information-flag">Pide confirmacion</span>` : ""}
                        ${status === "scheduled" ? `<span class="information-flag information-flag--soon">Programada</span>` : ""}
                        ${status === "draft" ? `<span class="information-flag information-flag--draft">Borrador</span>` : ""}
                        ${status === "archived" ? `<span class="information-flag information-flag--draft">Archivada</span>` : ""}
                    </div>
                    <h4>${escapeHTML(item.title)}</h4>
                    ${item.body ? `<p class="information-body">${escapeHTML(item.body)}</p>` : ""}
                </div>
                ${readBlockHTML(item, status)}
            </div>
            <div class="information-meta">${metaChipsHTML(item, status)}</div>
            ${attachments.length ? `
                <div class="information-files">
                    ${attachments.map(attachment => fileButtonsHTML(item, attachment)).join("")}
                </div>
            ` : ""}
            ${cardActionsHTML(item, status)}
        </article>
    `;
}

function tabsHTML(items) {
    const counts = {};

    Object.keys(TAB_STATUS).forEach(tab => {
        counts[tab] = items.filter(item =>
            effectiveStatus(item) === TAB_STATUS[tab]
        ).length;
    });

    const labels = {
        publicadas: "Publicadas",
        programadas: "Programadas",
        borradores: "Borradores",
        archivadas: "Archivadas"
    };

    return Object.keys(TAB_STATUS)
        .filter(tab => tab !== "archivadas" || counts.archivadas)
        .map(tab => `
            <button class="information-tab${activeTab === tab ? " is-on" : ""}" type="button" data-info-tab="${escapeAttribute(tab)}">
                ${escapeHTML(labels[tab])}
                <span>${counts[tab]}</span>
            </button>
        `).join("");
}

function categoryFilterHTML() {
    const options = [
        { id: "todas", label: "Todas" },
        ...INFORMATION_CATEGORIES
    ];

    return options.map(option => `
        <button class="information-chip-filter${categoryFilter === option.id ? " is-on" : ""}" type="button" data-info-category-filter="${escapeAttribute(option.id)}">
            ${escapeHTML(option.label)}
        </button>
    `).join("");
}

function inboxHTML(items) {
    const shown = items.filter(matchesFilters);
    const error = informationReadsError();

    return `
        <div class="information-toolbar">
            <div class="information-tabs">${tabsHTML(items)}</div>
            <label class="information-search">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <circle cx="11" cy="11" r="7"></circle>
                    <path d="m20 20-3.2-3.2"></path>
                </svg>
                <input type="search" value="${escapeAttribute(searchQuery)}" data-info-search placeholder="Buscar por titulo, texto o archivo" aria-label="Buscar informaciones">
            </label>
            <div class="information-chip-filters">${categoryFilterHTML()}</div>
        </div>
        ${error ? `<p class="information-note information-note--warn">${escapeHTML(error)}</p>` : ""}
        <div class="information-list">
            ${shown.length
                ? shown.map(informationCardHTML).join("")
                : `
                    <div class="empty-state empty-state--compact">
                        ${items.length
                            ? "Nada que mostrar con este filtro."
                            : "Aun no hay informaciones publicadas."}
                    </div>
                `}
        </div>
    `;
}

/* ==========================================================================
   Compositor
   ========================================================================== */

function draftFromItem(item) {
    const base = item ? normalizeInformation(item) : null;

    return {
        id: base?.id || makeId(),
        isNew: !base,
        title: base?.title || "",
        body: base?.body || "",
        category: base?.category || "general",
        audience: base?.audience || normalizeAudience({}),
        pinned: Boolean(base?.pinned),
        requiresAck: Boolean(base?.requiresAck),
        notify: base ? Boolean(base.notify) : true,
        scheduled: Boolean(base?.publishAt) || Boolean(base?.expiresAt),
        publishAt: base?.publishAt || "",
        expiresAt: base?.expiresAt || "",
        attachments: base?.attachments || [],
        // Archivos recien elegidos que TODAVIA no se han subido. Viven aqui y
        // no en el <input type="file">: el panel se repinta entero con cada
        // interruptor, y el input se vacia en cada repintado. Antes de esto,
        // elegir un archivo y despues cambiar de categoria lo perdia sin aviso.
        pendingFiles: [],
        createdAt: base?.createdAt || "",
        createdByUid: base?.createdByUid || "",
        status: base ? normalizeStatus(base.status) : "published"
    };
}

function audienceModesHTML() {
    const labels = {
        all: "Toda la unidad",
        estamento: "Por estamento",
        profession: "Por profesion",
        people: "Personas"
    };

    return AUDIENCE_MODES.map(mode => `
        <button class="information-seg${composerDraft.audience.mode === mode ? " is-on" : ""}" type="button" data-info-audience-mode="${escapeAttribute(mode)}">
            ${escapeHTML(labels[mode])}
        </button>
    `).join("");
}

function audienceBodyHTML() {
    const mode = composerDraft.audience.mode;

    if (mode === "all") {
        return `<p class="information-note">Le llega a todos los trabajadores activos de la unidad.</p>`;
    }

    if (mode === "people") {
        const chosen = composerDraft.audience.people;
        const options = activeProfiles()
            .filter(profile => !chosen.includes(profile.name))
            .map(profile => `<option value="${escapeAttribute(profile.name)}"></option>`)
            .join("");

        return `
            <div class="information-people">
                ${chosen.map(name => `
                    <span class="information-person">
                        ${escapeHTML(name)}
                        <button type="button" data-info-person-remove="${escapeAttribute(name)}" aria-label="Quitar a ${escapeAttribute(name)}">&times;</button>
                    </span>
                `).join("")}
                <input type="text" list="informationPeopleOptions" data-info-person-input placeholder="Escribe un nombre y pulsa Enter" aria-label="Agregar trabajador">
                <datalist id="informationPeopleOptions">${options}</datalist>
            </div>
        `;
    }

    const groups = audienceGroupOptions(mode);

    if (!groups.length) {
        return `<p class="information-note information-note--warn">No hay perfiles activos con ese dato cargado.</p>`;
    }

    return `
        <div class="information-groups">
            ${groups.map(group => {
                const on = composerDraft.audience.groups.includes(group.label);

                return `
                    <button class="information-group${on ? " is-on" : ""}" type="button" data-info-group="${escapeAttribute(group.label)}">
                        ${escapeHTML(group.label)}
                        <span>${group.count}</span>
                    </button>
                `;
            }).join("")}
        </div>
    `;
}

function optionToggleHTML(key, title, hint) {
    const on = Boolean(composerDraft[key]);

    return `
        <button class="information-option${on ? " is-on" : ""}" type="button" data-info-option="${escapeAttribute(key)}" aria-pressed="${on ? "true" : "false"}">
            <span class="information-switch"><span></span></span>
            <span class="information-option__text">
                <strong>${escapeHTML(title)}</strong>
                <small>${escapeHTML(hint)}</small>
            </span>
        </button>
    `;
}

function composerPreviewHTML() {
    const tone = CATEGORY_TONE[composerDraft.category] || "orange";

    return `
        <article class="information-preview__card${composerDraft.pinned ? " is-pinned" : ""}">
            <div class="information-card__tags">
                <span class="worker-request-type information-type information-type--${escapeAttribute(tone)}" data-preview-tag>${escapeHTML(categoryLabel(composerDraft.category))}</span>
                ${composerDraft.pinned ? `<span class="information-pin">Fijado</span>` : ""}
            </div>
            <strong data-preview-title>${escapeHTML(composerDraft.title || "Sin titulo todavia")}</strong>
            <p data-preview-body>${escapeHTML(composerDraft.body || "Escribe el mensaje y aparece aqui.")}</p>
            ${composerDraft.attachments.length ? `
                <div class="information-preview__files">
                    ${composerDraft.attachments.map(attachment => `
                        <span class="information-preview__file">
                            <span class="information-file__badge information-file__badge--${escapeAttribute(fileExtLabel(attachment).toLowerCase())}">${escapeHTML(fileExtLabel(attachment))}</span>
                            <span>${escapeHTML(attachment.name)}</span>
                            <em>Ver</em>
                        </span>
                    `).join("")}
                </div>
            ` : ""}
            <div class="information-preview__foot">
                <span>${escapeHTML(composerDraft.scheduled && composerDraft.publishAt ? formatDateTime(composerDraft.publishAt) : "Ahora mismo")}</span>
                <span>${escapeHTML(getActiveWorkspace()?.name || "Tu unidad")}</span>
            </div>
            ${composerDraft.requiresAck ? `
                <span class="information-preview__ack">Confirmo que lo lei</span>
            ` : ""}
        </article>
    `;
}

function composerHTML() {
    const targets = audienceProfiles(composerDraft.audience);
    const total = activeProfiles().length;
    const empty = audienceIsEmpty(composerDraft.audience);
    const linked = linkedCount(targets);
    // La vista previa muestra la publicada mas reciente, atenuada, debajo de la
    // que se esta escribiendo. Sin ella la tarjeta flota sola y no se ve como
    // va a quedar EN LA LISTA, que es como el trabajador la va a encontrar.
    const published = getInformations()
        .filter(item => effectiveStatus(item) === "published")
        .filter(item => item.id !== composerDraft.id);
    const publishedCount = published.length;
    const previousCard = published[0] || null;

    return `
        <div class="information-composer">
            <div class="information-composer__head">
                <div>
                    <h3>${composerDraft.isNew ? "Nueva informacion" : "Editar informacion"}</h3>
                    <p>Escribe a la izquierda; a la derecha ves como le queda al trabajador en su telefono.</p>
                </div>
                <span class="information-reach${empty ? " is-empty" : ""}" data-info-reach>
                    ${empty ? "Sin destinatarios" : `Llega a ${targets.length} de ${total}`}
                </span>
            </div>

            <form class="information-composer__grid" data-info-form>
                <div class="information-composer__main">
                    <label class="information-field">
                        <span>Categoria</span>
                        <div class="information-chip-filters">
                            ${INFORMATION_CATEGORIES.map(category => `
                                <button class="information-chip-filter information-chip-filter--${escapeAttribute(CATEGORY_TONE[category.id])}${composerDraft.category === category.id ? " is-on" : ""}" type="button" data-info-category="${escapeAttribute(category.id)}">
                                    ${escapeHTML(category.label)}
                                </button>
                            `).join("")}
                        </div>
                    </label>

                    <label class="information-field">
                        <span>Titulo</span>
                        <input name="title" type="text" maxlength="${MAX_TITLE_LENGTH}" value="${escapeAttribute(composerDraft.title)}" data-info-title placeholder="Ej: Nuevo protocolo de contraste en Resonancia" ${savingInformation ? "disabled" : ""} required>
                    </label>

                    <label class="information-field">
                        <span class="information-field__row">
                            Mensaje
                            <small data-info-body-count>${composerDraft.body.length} de ${MAX_BODY_LENGTH} caracteres</small>
                        </span>
                        <textarea name="body" rows="5" maxlength="${MAX_BODY_LENGTH}" data-info-body placeholder="Lo primero que se lee en el telefono son las dos primeras lineas." ${savingInformation ? "disabled" : ""}>${escapeHTML(composerDraft.body)}</textarea>
                    </label>

                    <div class="information-field">
                        <span>Imagenes o documentos</span>
                        ${composerDraft.attachments.length ? `
                            <div class="information-files">
                                ${composerDraft.attachments.map(attachment => `
                                    <span class="information-file">
                                        <span class="information-file__badge information-file__badge--${escapeAttribute(fileExtLabel(attachment).toLowerCase())}">${escapeHTML(fileExtLabel(attachment))}</span>
                                        <span class="information-file__meta">
                                            <strong>${escapeHTML(attachment.name)}</strong>
                                            <small>${escapeHTML(formatBytes(attachment.size))}</small>
                                        </span>
                                        <button class="information-file__remove" type="button" data-info-draft-file="${escapeAttribute(attachment.id)}" aria-label="Quitar ${escapeAttribute(attachment.name)}">&times;</button>
                                    </span>
                                `).join("")}
                            </div>
                        ` : ""}
                        ${composerDraft.pendingFiles.length ? `
                            <div class="information-files">
                                ${composerDraft.pendingFiles.map((file, index) => `
                                    <span class="information-file information-file--pending">
                                        <span class="information-file__badge information-file__badge--${escapeAttribute(fileExtLabel(file).toLowerCase())}">${escapeHTML(fileExtLabel(file))}</span>
                                        <span class="information-file__meta">
                                            <strong>${escapeHTML(file.name)}</strong>
                                            <small>${escapeHTML(formatBytes(file.size))} &middot; sin subir</small>
                                        </span>
                                        <button class="information-file__remove" type="button" data-info-pending-file="${index}" aria-label="Quitar ${escapeAttribute(file.name)}">&times;</button>
                                    </span>
                                `).join("")}
                            </div>
                        ` : ""}
                        <label class="information-drop${savingInformation ? " is-disabled" : ""}">
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path d="M12 16.5V4"></path>
                                <path d="m7.5 8.5 4.5-4.5 4.5 4.5"></path>
                                <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"></path>
                            </svg>
                            <span>Arrastra archivos aqu&iacute; o haz clic para elegirlos</span>
                            <input name="files" type="file" multiple accept="${ATTACHMENT_ACCEPT}" data-info-files ${savingInformation ? "disabled" : ""}>
                        </label>
                        <small>Hasta ${MAX_ATTACHMENT_FILES} archivos. Imagenes, PDF, texto, Word o Excel.</small>
                    </div>

                    <div class="information-audience">
                        <div class="information-field__row">
                            <span>Destinatarios</span>
                            <small>Filtra lo que se muestra, no es una barrera de seguridad</small>
                        </div>
                        <div class="information-segs">${audienceModesHTML()}</div>
                        ${audienceBodyHTML()}
                        <p class="information-note${empty ? " information-note--warn" : ""}" data-info-reach-detail>
                            ${empty
                                ? "Todavia no llega a nadie: elige al menos un destinatario."
                                : `Llega a ${targets.length} de ${total} trabajadores. ${linked} tienen la app enlazada.`}
                        </p>
                    </div>

                    <div class="information-field">
                        <span>Opciones de envio</span>
                        <div class="information-options">
                            ${optionToggleHTML("pinned", "Fijar arriba", "Queda primera en la lista del trabajador hasta que la desfijes.")}
                            ${optionToggleHTML("requiresAck", "Pedir confirmacion de lectura", "El trabajador confirma desde la app y tu ves quien falta.")}
                            ${optionToggleHTML("notify", "Avisar por notificacion", "Ademas de dejarla en la lista, le suena el telefono.")}
                            ${optionToggleHTML("scheduled", "Programar y vencer", "Elige cuando se publica y cuando se archiva sola.")}
                        </div>
                        ${composerDraft.scheduled ? `
                            <div class="information-schedule">
                                <label>
                                    <span>Se publica el</span>
                                    <input type="datetime-local" data-info-publish-at value="${escapeAttribute(toLocalInputValue(composerDraft.publishAt))}">
                                </label>
                                <label>
                                    <span>Se archiva sola el</span>
                                    <input type="datetime-local" data-info-expires-at value="${escapeAttribute(toLocalInputValue(composerDraft.expiresAt))}">
                                </label>
                            </div>
                        ` : ""}
                    </div>

                    <div class="information-editor__actions">
                        <button class="primary-button information-send" type="submit" ${savingInformation ? "disabled" : ""}>
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path d="m21 3-9.5 9.5"></path>
                                <path d="M21 3 14.5 21l-3-7.5-7.5-3Z"></path>
                            </svg>
                            ${savingInformation
                                ? "Publicando..."
                                : composerDraft.scheduled && composerDraft.publishAt
                                    ? "Programar envio"
                                    : "Publicar ahora"}
                        </button>
                        <button class="secondary-button" type="button" data-info-save-draft ${savingInformation ? "disabled" : ""}>Guardar borrador</button>
                        <button class="ghost-button" type="button" data-info-cancel ${savingInformation ? "disabled" : ""}>Descartar</button>
                    </div>
                </div>

                <aside class="information-preview">
                    <div class="information-field__row">
                        <span>Como lo ve el trabajador</span>
                        <small class="information-live">En vivo</small>
                    </div>
                    <div class="information-preview__phone">
                        <div class="information-preview__phonehead">
                            <strong>Informaciones</strong>
                            <span>${publishedCount + 1}</span>
                        </div>
                        ${composerPreviewHTML()}
                        ${previousCard ? `
                            <article class="information-preview__card information-preview__card--dim">
                                <span class="worker-request-type information-type information-type--${escapeAttribute(CATEGORY_TONE[previousCard.category] || "orange")}">${escapeHTML(categoryLabel(previousCard.category))}</span>
                                <strong>${escapeHTML(previousCard.title)}</strong>
                                <div class="information-preview__foot">
                                    <span>${escapeHTML(formatDateTime(previousCard.publishedAt || previousCard.updatedAt))}</span>
                                </div>
                            </article>
                        ` : ""}
                    </div>
                    ${composerDraft.notify && !empty ? `
                        <p class="information-note information-note--warn">Les suena el telefono a ${linked} personas con la app enlazada.</p>
                    ` : ""}
                </aside>
            </form>
        </div>
    `;
}

/* ==========================================================================
   Ficha de lectura
   ========================================================================== */

function readerHTML(item) {
    const targets = audienceProfiles(item.audience);
    const wantRead = readerTab === "leyeron";
    const rows = targets
        .filter(profile => hasRead(item.id, uidOf(profile)) === wantRead)
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
    const read = targets.filter(profile => hasRead(item.id, uidOf(profile))).length;
    const pending = targets.length - read;
    const unlinked = targets.filter(profile => !uidOf(profile)).length;
    const percent = targets.length ? Math.round((read / targets.length) * 100) : 0;

    return `
        <div class="information-reader-backdrop" data-info-reader-close></div>
        <section class="information-reader" role="dialog" aria-modal="true" aria-label="Confirmaciones de lectura">
            <div class="information-reader__head">
                <div>
                    ${tagHTML(item)}
                    <h3>${escapeHTML(item.title)}</h3>
                    <small>Publicado el ${escapeHTML(formatDateTime(item.publishedAt || item.updatedAt))} &middot; ${escapeHTML(audienceSummary(item.audience, targets.length))}</small>
                </div>
                <button class="ghost-button ghost-button--small" type="button" data-info-reader-close aria-label="Cerrar">&times;</button>
            </div>

            <div class="information-reader__stats">
                <div class="information-reader__stat information-reader__stat--ok">
                    <span>Confirmaron</span>
                    <strong>${read}</strong>
                    <small>${percent}% de los destinatarios</small>
                </div>
                <div class="information-reader__stat information-reader__stat--warn">
                    <span>Pendientes</span>
                    <strong>${pending}</strong>
                    <small>${unlinked} sin la app enlazada</small>
                </div>
                <div class="information-reader__stat">
                    <span>Destinatarios</span>
                    <strong>${targets.length}</strong>
                    <small>segun la nomina de hoy</small>
                </div>
            </div>

            <div class="information-reader__bar"><span style="width: ${percent}%"></span></div>

            <div class="information-tabs">
                <button class="information-tab${wantRead ? " is-on" : ""}" type="button" data-info-reader-tab="leyeron">Confirmaron <span>${read}</span></button>
                <button class="information-tab${wantRead ? "" : " is-on"}" type="button" data-info-reader-tab="pendientes">Pendientes <span>${pending}</span></button>
            </div>

            <div class="information-reader__list">
                ${rows.length ? rows.map(profile => {
                    const stamp = readStampFor(item.id, uidOf(profile));
                    const linked = Boolean(uidOf(profile));

                    return `
                        <div class="information-reader__row${wantRead ? "" : " is-pending"}">
                            <span class="information-reader__avatar information-reader__avatar--${escapeAttribute(avatarTone(profile.name, wantRead))}">${escapeHTML(initialsOf(profile.name))}</span>
                            <span class="information-reader__name">
                                <strong>${escapeHTML(profile.name)}</strong>
                                <small>${escapeHTML(profile.estamento || "Sin estamento")}${linked ? "" : " &middot; sin la app enlazada"}</small>
                            </span>
                            <span class="information-reader__stamp">${escapeHTML(wantRead ? formatDateTime(stamp) : linked ? "Sin abrir" : "No le llega")}</span>
                        </div>
                    `;
                }).join("") : `<div class="empty-state empty-state--compact">${wantRead ? "Nadie ha confirmado todavia." : "No queda nadie pendiente."}</div>`}
            </div>

            <div class="information-editor__actions">
                <button class="primary-button" type="button" data-info-remind="${escapeAttribute(item.id)}" ${pending ? "" : "disabled"}>
                    Recordar a los ${pending} pendientes
                </button>
                <button class="ghost-button" type="button" data-info-reader-close>Cerrar</button>
            </div>
        </section>
    `;
}

/* ==========================================================================
   Pintado
   ========================================================================== */

export function renderInformationsPanel() {
    if (typeof document === "undefined") return;

    const panel = document.getElementById("informationsPanel");

    if (!panel) return;

    // Idempotente: engancha el listener de confirmaciones la primera vez y en
    // cada cambio de unidad, y no hace nada el resto de las veces. Va aqui
    // -y no en el arranque- porque al arrancar todavia no hay unidad activa.
    void watchInformationReads();

    const items = getInformations();
    const editable = canEditMenu("informations");
    const published = items.filter(item => effectiveStatus(item) === "published");
    const publishedFiles = published.reduce(
        (count, item) => count + (item.attachments?.length || 0),
        0
    );
    const reader = readerInformationId
        ? items.find(item => item.id === readerInformationId)
        : null;
    // Porcentaje de lectura del conjunto, sumando destinatarios y
    // confirmaciones de las que SI la piden. Sin ninguna que la pida no se
    // muestra nada: un "0% de lectura" cuando nadie tenia que confirmar no es
    // un dato, es una alarma falsa.
    const acked = published.filter(item => item.requiresAck);
    const ackTotals = acked.reduce((sum, item) => {
        const stats = readStatsFor(item);

        return { read: sum.read + stats.read, total: sum.total + stats.total };
    }, { read: 0, total: 0 });
    const ackSummary = ackTotals.total
        ? `${Math.round((ackTotals.read / ackTotals.total) * 100)}% de lectura`
        : "";

    if (composerDraft && !editable) composerDraft = null;

    panel.innerHTML = `
        <div class="information-root">
            <div class="section-head section-head--with-action information-head">
                <span class="section-head__title">
                    <h3>Informaciones</h3>
                    <small>Lo que publiques aqui le llega a la PWA de los trabajadores que elijas.</small>
                </span>
                <span class="information-head__actions">
                    ${ackSummary ? `
                        <span class="worker-request-counter information-rate">
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                            ${escapeHTML(ackSummary)}
                        </span>
                    ` : ""}
                    <span class="worker-request-counter">
                        ${published.length} publicacion(es) / ${publishedFiles} archivo(s)
                    </span>
                    ${editable && !composerDraft ? `
                        <button class="primary-button" type="button" data-info-new>Nueva informacion</button>
                    ` : ""}
                </span>
            </div>
            ${editable ? "" : `
                <section class="panel information-editor--readonly">
                    <strong>Solo lectura</strong>
                    <p>Tu usuario puede revisar las informaciones publicadas, pero no modificarlas.</p>
                </section>
            `}
            <section class="panel information-body-panel">
                ${composerDraft ? composerHTML() : inboxHTML(items)}
            </section>
            ${reader ? readerHTML(reader) : ""}
        </div>
    `;

    bindInformationsPanel(panel);
}

/* ==========================================================================
   Guardado
   ========================================================================== */

async function uploadInformationFiles(files, informationId) {
    if (!files?.length) return [];

    return readAttachmentFiles(files, {
        moduleId: "informations",
        ownerId: "published",
        recordId: informationId
    });
}

function readComposerFields(form) {
    if (!composerDraft || !form) return;

    composerDraft.title = clampText(form.elements.title?.value, MAX_TITLE_LENGTH);
    composerDraft.body = clampText(form.elements.body?.value, MAX_BODY_LENGTH);
}

async function persistDraft(form, { asDraft = false } = {}) {
    if (!composerDraft) return;

    readComposerFields(form);

    const files = composerDraft.pendingFiles;

    if (!composerDraft.title) {
        await showAlert("Ingresa un titulo para publicar.", {
            title: "Informaciones",
            tone: "warning"
        });
        return;
    }

    if (!composerDraft.body && !files.length && !composerDraft.attachments.length) {
        await showAlert("Agrega un anuncio o al menos un archivo.", {
            title: "Informaciones",
            tone: "warning"
        });
        return;
    }

    if (!asDraft && audienceIsEmpty(composerDraft.audience)) {
        await showAlert(
            "Elige al menos un destinatario: asi como esta no le llega a nadie.",
            { title: "Informaciones", tone: "warning" }
        );
        return;
    }

    savingInformation = true;
    Array.from(form.querySelectorAll("input, textarea, button")).forEach(control => {
        control.disabled = true;
    });

    try {
        const uploaded = await uploadInformationFiles(files, composerDraft.id);
        const now = new Date().toISOString();
        const user = getCurrentFirebaseUser();
        const items = getInformations();
        const current = items.find(item => item.id === composerDraft.id) || null;
        const scheduled = composerDraft.scheduled &&
            composerDraft.publishAt &&
            Date.parse(composerDraft.publishAt) > Date.now();
        const status = asDraft ? "draft" : scheduled ? "scheduled" : "published";
        const nextItem = normalizeInformation({
            ...(current || {}),
            id: composerDraft.id,
            title: composerDraft.title,
            body: composerDraft.body,
            category: composerDraft.category,
            audience: composerDraft.audience,
            pinned: composerDraft.pinned,
            requiresAck: composerDraft.requiresAck,
            notify: composerDraft.notify,
            status,
            publishAt: composerDraft.scheduled ? composerDraft.publishAt : "",
            expiresAt: composerDraft.scheduled ? composerDraft.expiresAt : "",
            createdAt: composerDraft.createdAt || current?.createdAt || now,
            // Una que sale de borrador estrena fecha de publicacion; una que ya
            // estaba publicada y solo se corrige conserva la suya, para que no
            // salte al principio de la lista del trabajador por una coma.
            publishedAt: status === "published"
                ? (current && effectiveStatus(current) === "published"
                    ? current.publishedAt
                    : now)
                : "",
            updatedAt: now,
            createdByUid: composerDraft.createdByUid || current?.createdByUid || user?.uid || "",
            updatedByUid: user?.uid || "",
            attachments: [...composerDraft.attachments, ...uploaded]
        });
        const nextItems = current
            ? items.map(item => item.id === current.id ? nextItem : item)
            : [nextItem, ...items];
        const shouldNotify = shouldNotifyInformationPublish(
            current,
            nextItem,
            status
        );
        let notificationFailed = false;

        await saveInformations(nextItems);

        if (shouldNotify) {
            try {
                const result = await notifyInformationPublished(nextItem);
                notificationFailed = result?.ok === false;
            } catch (error) {
                notificationFailed = true;
                console.warn(
                    "La informacion se publico, pero no se pudo notificar.",
                    error
                );
            }
        }

        // Los adjuntos que se quitaron en el compositor se borran de Storage
        // AQUI y no al quitarlos: hasta que no se guarda, el supervisor puede
        // descartar el cambio, y un archivo borrado antes de tiempo dejaria a
        // la informacion publicada apuntando a nada.
        const kept = new Set(nextItem.attachments.map(file => file.id));

        await Promise.all(
            (current?.attachments || [])
                .filter(file => !kept.has(file.id))
                .map(file => deleteStoredAttachment(file).catch(error => {
                    console.warn("No se pudo borrar un archivo quitado.", error);
                }))
        );

        composerDraft = null;
        editingInformationId = "";
        activeTab = status === "draft"
            ? "borradores"
            : status === "scheduled" ? "programadas" : "publicadas";

        if (notificationFailed) {
            await showAlert(
                "La informacion quedo publicada, pero no se pudo enviar la notificacion de la campanita. Revisa la conexion e intenta recordar lectura mas tarde.",
                { title: "Informaciones", tone: "warning" }
            );
        }
    } catch (error) {
        console.error("No se pudo publicar la informacion.", error);
        await showAlert(
            error?.attachmentStorageMessage || String(error?.code || "").startsWith("storage/")
                ? attachmentStorageErrorMessage(error, "subir")
                : error?.message ||
                    "No se pudo publicar la informacion. Revisa la conexion e intenta nuevamente.",
            { title: "Informaciones", tone: "danger" }
        );
    } finally {
        savingInformation = false;
        renderInformationsPanel();
    }
}

function findInformationAttachment(infoId, attachmentId) {
    const item = getInformations().find(information =>
        information.id === infoId
    );
    const attachment = item?.attachments?.find(file =>
        file.id === attachmentId
    );

    return { item, attachment };
}

async function openInformationAttachment(button, { newTab = true } = {}) {
    const { attachment } = findInformationAttachment(
        button.dataset.infoOpen || button.dataset.infoDownload,
        button.dataset.infoFile
    );

    if (!hasAttachmentContent(attachment)) return;

    button.disabled = true;
    try {
        await openAttachmentFile(attachment, { newTab });
    } catch (error) {
        await showAlert(
            error?.attachmentStorageMessage
                ? error.message
                : error?.message || "No se pudo abrir el archivo.",
            { title: "Informaciones", tone: "danger" }
        );
    } finally {
        button.disabled = false;
    }
}

async function setInformationStatus(id, status) {
    const items = getInformations();
    const current = items.find(item => item.id === id);

    if (!current) return;

    const now = new Date().toISOString();
    const expired = current.expiresAt && Date.parse(current.expiresAt) <= Date.now();

    try {
        await saveInformations(items.map(item => item.id === id
            ? normalizeInformation({
                ...item,
                status,
                // Publicar ahora una programada apaga su fecha: si se quedara,
                // el calculo del estado volveria a esconderla.
                publishAt: status === "published" ? "" : item.publishAt,
                // Y volver a publicar una que se archivo SOLA tiene que apagar
                // tambien su vencimiento, o el mismo calculo la archiva de
                // nuevo en el acto y el boton no hace nada visible.
                expiresAt: status === "published" && expired ? "" : item.expiresAt,
                publishedAt: status === "published" ? now : item.publishedAt,
                updatedAt: now
            })
            : item
        ));
    } catch (error) {
        console.error("No se pudo cambiar el estado de la informacion.", error);
        await showAlert(
            error?.message ||
            "No se pudo guardar el cambio. Revisa la conexion e intenta nuevamente.",
            { title: "Informaciones", tone: "danger" }
        );
    }
}

async function deleteInformation(id) {
    const items = getInformations();
    const current = items.find(item => item.id === id);

    if (!current) return;

    if (!await showConfirm(
        "Se eliminara la informacion junto con sus archivos, y desaparece de la aplicacion de los trabajadores.",
        {
            title: "Eliminar informacion",
            tone: "danger",
            confirmText: "Eliminar",
            destructive: true
        }
    )) {
        return;
    }

    try {
        await Promise.all(
            (current.attachments || []).map(attachment =>
                deleteStoredAttachment(attachment).catch(error => {
                    console.warn("No se pudo borrar un archivo.", error);
                })
            )
        );
        await saveInformations(items.filter(item => item.id !== id));

        if (editingInformationId === id) editingInformationId = "";
        if (composerDraft?.id === id) composerDraft = null;
        if (readerInformationId === id) readerInformationId = "";
    } catch (error) {
        console.error("No se pudo eliminar la informacion.", error);
        await showAlert(
            error?.message || "No se pudo eliminar la informacion. Intenta nuevamente.",
            { title: "Informaciones", tone: "danger" }
        );
    } finally {
        renderInformationsPanel();
    }
}

async function remindPending(id) {
    const items = getInformations();
    const item = items.find(entry => entry.id === id);

    if (!item) return;

    const pending = audienceProfiles(item.audience)
        .filter(profile => uidOf(profile))
        .filter(profile => !hasRead(id, uidOf(profile)));

    if (!pending.length) {
        await showAlert(
            "No queda nadie a quien recordarle: o ya confirmaron, o no tienen la app enlazada.",
            { title: "Informaciones", tone: "info" }
        );
        return;
    }

    if (!await showConfirm(
        `Se les enviara un recordatorio a ${pending.length} ${pending.length === 1 ? "persona" : "personas"} que aun no confirman "${item.title}".`,
        { title: "Recordar lectura", confirmText: "Enviar" }
    )) {
        return;
    }

    const { notifyWorkerApp } = await import("./workerAppDataSync.js");
    let sent = 0;

    for (const profile of pending) {
        const ok = await notifyWorkerApp(
            profile.name,
            `Recordatorio: te falta confirmar la informacion "${item.title}".`
        );

        if (ok) sent += 1;
    }

    await showAlert(
        `Recordatorio enviado a ${sent} ${sent === 1 ? "persona" : "personas"}.`,
        { title: "Informaciones", tone: "success" }
    );
}

/* ==========================================================================
   Eventos
   ========================================================================== */

function updateComposerLive(panel) {
    if (!composerDraft) return;

    const title = panel.querySelector("[data-preview-title]");
    const body = panel.querySelector("[data-preview-body]");
    const count = panel.querySelector("[data-info-body-count]");

    if (title) title.textContent = composerDraft.title || "Sin titulo todavia";
    if (body) body.textContent = composerDraft.body || "Escribe el mensaje y aparece aqui.";
    if (count) {
        count.textContent = `${composerDraft.body.length} de ${MAX_BODY_LENGTH} caracteres`;
    }
}

function bindComposer(panel) {
    const form = panel.querySelector("[data-info-form]");

    if (!form || !composerDraft) return;

    form.onsubmit = event => {
        event.preventDefault();
        void persistDraft(form);
    };

    // El titulo y el mensaje NO vuelven a pintar el panel: se guardan en el
    // borrador y se copian a la vista previa a mano. Repintar con cada tecla
    // le quitaria el foco al campo en el que se esta escribiendo.
    const titleInput = panel.querySelector("[data-info-title]");
    const bodyInput = panel.querySelector("[data-info-body]");

    if (titleInput) {
        titleInput.oninput = () => {
            composerDraft.title = titleInput.value.slice(0, MAX_TITLE_LENGTH);
            updateComposerLive(panel);
        };
    }

    if (bodyInput) {
        bodyInput.oninput = () => {
            composerDraft.body = bodyInput.value.slice(0, MAX_BODY_LENGTH);
            updateComposerLive(panel);
        };
    }

    panel.querySelectorAll("[data-info-category]").forEach(button => {
        button.onclick = () => {
            readComposerFields(form);
            composerDraft.category = button.dataset.infoCategory;
            renderInformationsPanel();
        };
    });

    panel.querySelectorAll("[data-info-audience-mode]").forEach(button => {
        button.onclick = () => {
            readComposerFields(form);
            composerDraft.audience = normalizeAudience({
                ...composerDraft.audience,
                mode: button.dataset.infoAudienceMode
            });
            renderInformationsPanel();
        };
    });

    panel.querySelectorAll("[data-info-group]").forEach(button => {
        button.onclick = () => {
            readComposerFields(form);

            const label = button.dataset.infoGroup;
            const groups = composerDraft.audience.groups.includes(label)
                ? composerDraft.audience.groups.filter(entry => entry !== label)
                : [...composerDraft.audience.groups, label];

            composerDraft.audience = normalizeAudience({
                ...composerDraft.audience,
                groups
            });
            renderInformationsPanel();
        };
    });

    const personInput = panel.querySelector("[data-info-person-input]");

    if (personInput) {
        personInput.onkeydown = event => {
            if (event.key !== "Enter") return;

            event.preventDefault();

            const typed = personInput.value.trim();

            if (!typed) return;

            // Solo nombres de la nomina: un nombre mal escrito publicaria a
            // cero personas y el aviso no le llegaria a nadie.
            const match = activeProfiles().find(profile =>
                profile.name.toLowerCase() === typed.toLowerCase()
            );

            if (!match) {
                personInput.setCustomValidity?.("");
                void showAlert(
                    `No hay ningun trabajador activo que se llame "${typed}". Elige uno de la lista.`,
                    { title: "Destinatarios", tone: "warning" }
                );
                return;
            }

            readComposerFields(form);
            composerDraft.audience = normalizeAudience({
                ...composerDraft.audience,
                people: [...composerDraft.audience.people, match.name]
            });
            renderInformationsPanel();
        };
    }

    panel.querySelectorAll("[data-info-person-remove]").forEach(button => {
        button.onclick = () => {
            readComposerFields(form);
            composerDraft.audience = normalizeAudience({
                ...composerDraft.audience,
                people: composerDraft.audience.people.filter(
                    name => name !== button.dataset.infoPersonRemove
                )
            });
            renderInformationsPanel();
        };
    });

    panel.querySelectorAll("[data-info-option]").forEach(button => {
        button.onclick = () => {
            readComposerFields(form);

            const key = button.dataset.infoOption;

            composerDraft[key] = !composerDraft[key];
            renderInformationsPanel();
        };
    });

    const filesInput = panel.querySelector("[data-info-files]");

    if (filesInput) {
        filesInput.onchange = () => {
            readComposerFields(form);
            composerDraft.pendingFiles = [
                ...composerDraft.pendingFiles,
                ...Array.from(filesInput.files || [])
            ].slice(0, MAX_ATTACHMENT_FILES);
            renderInformationsPanel();
        };
    }

    panel.querySelectorAll("[data-info-pending-file]").forEach(button => {
        button.onclick = () => {
            readComposerFields(form);

            const index = Number(button.dataset.infoPendingFile);

            composerDraft.pendingFiles = composerDraft.pendingFiles.filter(
                (_file, position) => position !== index
            );
            renderInformationsPanel();
        };
    });

    panel.querySelectorAll("[data-info-draft-file]").forEach(button => {
        button.onclick = () => {
            readComposerFields(form);
            composerDraft.attachments = composerDraft.attachments.filter(
                attachment => attachment.id !== button.dataset.infoDraftFile
            );
            renderInformationsPanel();
        };
    });

    const publishAt = panel.querySelector("[data-info-publish-at]");
    const expiresAt = panel.querySelector("[data-info-expires-at]");

    if (publishAt) {
        publishAt.onchange = () => {
            composerDraft.publishAt = fromLocalInputValue(publishAt.value);
        };
    }

    if (expiresAt) {
        expiresAt.onchange = () => {
            composerDraft.expiresAt = fromLocalInputValue(expiresAt.value);
        };
    }

    panel.querySelector("[data-info-save-draft]")?.addEventListener("click", () => {
        void persistDraft(form, { asDraft: true });
    });

    panel.querySelector("[data-info-cancel]")?.addEventListener("click", () => {
        composerDraft = null;
        editingInformationId = "";
        renderInformationsPanel();
    });
}

function openComposer(item) {
    composerDraft = draftFromItem(item);
    editingInformationId = item?.id || "";
    renderInformationsPanel();
}

function bindInformationsPanel(panel) {
    bindComposer(panel);

    panel.querySelector("[data-info-new]")?.addEventListener("click", () => {
        openComposer(null);
    });

    panel.querySelectorAll("[data-info-tab]").forEach(button => {
        button.onclick = () => {
            activeTab = button.dataset.infoTab;
            renderInformationsPanel();
        };
    });

    panel.querySelectorAll("[data-info-category-filter]").forEach(button => {
        button.onclick = () => {
            categoryFilter = button.dataset.infoCategoryFilter;
            renderInformationsPanel();
        };
    });

    const search = panel.querySelector("[data-info-search]");

    if (search) {
        search.oninput = () => {
            searchQuery = search.value;

            const list = panel.querySelector(".information-list");

            if (!list) return;

            // Igual que el compositor: se repinta SOLO la lista para no perder
            // el cursor del buscador con cada letra.
            const items = getInformations();
            const shown = items.filter(matchesFilters);

            list.innerHTML = shown.length
                ? shown.map(informationCardHTML).join("")
                : `<div class="empty-state empty-state--compact">Nada que mostrar con este filtro.</div>`;
            bindCardActions(panel);
        };
    }

    bindCardActions(panel);
    bindReader(panel);
}

function bindCardActions(panel) {
    panel.querySelectorAll("[data-info-edit]").forEach(button => {
        button.onclick = () => {
            const id = button.dataset.infoEdit;

            openComposer(getInformations().find(item => item.id === id) || null);
        };
    });

    panel.querySelectorAll("[data-info-delete]").forEach(button => {
        button.onclick = () => {
            void deleteInformation(button.dataset.infoDelete);
        };
    });

    panel.querySelectorAll("[data-info-archive]").forEach(button => {
        button.onclick = async () => {
            await setInformationStatus(button.dataset.infoArchive, "archived");
            renderInformationsPanel();
        };
    });

    panel.querySelectorAll("[data-info-restore]").forEach(button => {
        button.onclick = async () => {
            await setInformationStatus(button.dataset.infoRestore, "published");
            renderInformationsPanel();
        };
    });

    panel.querySelectorAll("[data-info-publish-now]").forEach(button => {
        button.onclick = async () => {
            await setInformationStatus(button.dataset.infoPublishNow, "published");
            renderInformationsPanel();
        };
    });

    panel.querySelectorAll("[data-info-readers]").forEach(button => {
        button.onclick = () => {
            readerInformationId = button.dataset.infoReaders;
            readerTab = "leyeron";
            renderInformationsPanel();
        };
    });

    panel.querySelectorAll("[data-info-open]").forEach(button => {
        button.onclick = () => {
            void openInformationAttachment(button, { newTab: true });
        };
    });

    panel.querySelectorAll("[data-info-download]").forEach(button => {
        button.onclick = () => {
            void openInformationAttachment(button, { newTab: false });
        };
    });
}

function bindReader(panel) {
    panel.querySelectorAll("[data-info-reader-close]").forEach(node => {
        node.onclick = () => {
            readerInformationId = "";
            renderInformationsPanel();
        };
    });

    panel.querySelectorAll("[data-info-reader-tab]").forEach(button => {
        button.onclick = () => {
            readerTab = button.dataset.infoReaderTab;
            renderInformationsPanel();
        };
    });

    panel.querySelectorAll("[data-info-remind]").forEach(button => {
        button.onclick = () => {
            void remindPending(button.dataset.infoRemind);
        };
    });
}

/* ==========================================================================
   Arranque
   ========================================================================== */

export function initInformationsPanel() {
    if (typeof window === "undefined") return;

    const repaint = () => {
        if (document.body.dataset.activeView === "informations") {
            renderInformationsPanel();
        }
    };
    // Las confirmaciones llegan solas desde los telefonos, en cualquier
    // momento. Repintar con el compositor abierto le quitaria el cursor al
    // supervisor a media frase, y lo que cambia -el recuento de la bandeja- ni
    // siquiera esta en pantalla.
    const repaintInbox = () => {
        if (!composerDraft) repaint();
    };

    window.addEventListener("proturnos:informationsChanged", repaint);
    window.addEventListener("proturnos:informationReadsChanged", repaintInbox);

    window.addEventListener("proturnos:persistenceChanged", event => {
        if ((event.detail?.keys || []).includes(INFORMATIONS_KEY)) repaint();
    });

    window.addEventListener("proturnos:firebaseAppState", event => {
        if ((event.detail?.keys || []).includes(INFORMATIONS_KEY)) repaint();
    });

    window.addEventListener("proturnos:workspacePermissionsChanged", repaint);
}
