import { stripAccents } from "./stringUtils.js";
import { escapeHTML } from "./htmlUtils.js";
import { getJSON, setJSON, getRaw } from "./persistence.js";
import { getCurrentFirebaseUser, getFirebaseServices } from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";
import { showConfirm } from "./dialogs.js";
import {
    MEDICAL_EQUIPMENT_KEY,
    medicalEquipmentContractRenewalKanbanCards,
    selectMedicalEquipment
} from "./medicalEquipment.js";
import { canEditMenu, canViewMenu } from "./workspacePermissions.js";

const LEGACY_STORAGE_KEY = "kanban_cards";
const STORAGE_KEY_PREFIX = "kanban_private_cards";

const KANBAN_COLUMNS = [
    { key: "pending", label: "Pendientes" },
    { key: "progress", label: "En Proceso" },
    { key: "done", label: "Terminadas" }
];

const KANBAN_CREATABLE_COLUMNS = new Set(["pending", "progress"]);

const CARD_COLORS = [
    "cyan",
    "yellow",
    "green",
    "coral"
];

let draggedCardId = "";
const migratedLocalKeys = new Set();
let automaticKanbanRefreshBound = false;

function isValidColumn(status) {
    return KANBAN_COLUMNS.some(column => column.key === status);
}

function normalizeKeyPart(value, fallback) {
    return stripAccents(String(value || fallback).trim())
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80) || fallback;
}

function getKanbanUserKey() {
    const user = getCurrentFirebaseUser();

    return user?.uid
        ? `user_${normalizeKeyPart(user.uid, "unknown")}`
        : "local_user";
}

function getKanbanStorageKey() {
    const workspace = getActiveWorkspace();
    const workspaceKey = workspace?.id
        ? `workspace_${normalizeKeyPart(workspace.id, "active")}`
        : "workspace_local";

    return `${STORAGE_KEY_PREFIX}_${workspaceKey}_${getKanbanUserKey()}`;
}

function normalizeCard(card, index = 0) {
    const status = isValidColumn(card?.status)
        ? card.status
        : KANBAN_COLUMNS[0].key;
    const color = CARD_COLORS.includes(card?.color)
        ? card.color
        : CARD_COLORS[index % CARD_COLORS.length];

    return {
        id: String(card?.id || `kanban_${Date.now()}_${index}`),
        title: String(card?.title || "").trim(),
        detail: String(card?.detail || "").trim(),
        status,
        color,
        createdAt: card?.createdAt || new Date().toISOString(),
        updatedAt: card?.updatedAt || card?.createdAt || new Date().toISOString()
    };
}

function getCards() {
    const storageKey = getKanbanStorageKey();

    migrateLocalKanbanIfNeeded(storageKey);

    return (Array.isArray(getJSON(storageKey, []))
        ? getJSON(storageKey, [])
        : []
    )
        .map(normalizeCard)
        .filter(card => card.title);
}

function saveCards(cards) {
    const normalized = cards.map(normalizeCard);

    setJSON(getKanbanStorageKey(), normalized);
    persistKanbanToFirebase(normalized);
}

function canViewMedicalEquipmentRenewalCards() {
    return canViewMenu("medicalEquipment") && canEditMenu("medicalEquipment");
}

function isAutomaticCard(card) {
    return card?.auto === true || card?.source === "medicalEquipmentRenewal";
}

export function getAutomaticKanbanCards(today) {
    if (!canViewMedicalEquipmentRenewalCards()) return [];

    return medicalEquipmentContractRenewalKanbanCards(today);
}

export function getKanbanCardsForRender(cards = getCards(), today) {
    const manualCards = (Array.isArray(cards) ? cards : [])
        .map(normalizeCard)
        .filter(card => card.title);
    const manualIds = new Set(manualCards.map(card => card.id));
    const automaticCards = getAutomaticKanbanCards(today)
        .filter(card => !manualIds.has(card.id));

    return [...manualCards, ...automaticCards];
}

// --- Respaldo por usuario en Firebase --------------------------------------
// El tablero es privado por usuario (la clave local incluye el uid), por eso NO
// viaja en el sync de estado del entorno (que es compartido). Se respalda en un
// documento propio: workspaces/{id}/kanbanBoards/{uid}, que solo ese usuario
// puede leer/escribir (ver firebase.rules).

let kanbanHydratedKey = "";
let kanbanHydrateInFlight = "";

async function kanbanBoardRef() {
    const user = getCurrentFirebaseUser();
    const workspace = getActiveWorkspace();

    if (!user?.uid || !workspace?.id) return null;

    const { db, firestoreModule } = await getFirebaseServices();

    return {
        firestoreModule,
        ref: firestoreModule.doc(
            db,
            "workspaces",
            workspace.id,
            "kanbanBoards",
            user.uid
        )
    };
}

async function persistKanbanToFirebase(cards) {
    try {
        const board = await kanbanBoardRef();
        if (!board) return;

        await board.firestoreModule.setDoc(board.ref, {
            cards: cards.map(normalizeCard),
            updatedAt: board.firestoreModule.serverTimestamp(),
            updatedAtISO: new Date().toISOString()
        });
    } catch (error) {
        // Best-effort: el cambio ya quedo en localStorage; se re-subira en el
        // proximo guardado o al re-montar el tablero.
    }
}

async function hydrateKanbanFromFirebase() {
    const user = getCurrentFirebaseUser();
    const workspace = getActiveWorkspace();

    if (!user?.uid || !workspace?.id) return false;

    const storageKey = getKanbanStorageKey();

    // Se hidrata una sola vez por entorno/usuario; luego manda el cache local
    // (que ya se respalda en cada guardado). Se rehidrata al cambiar de
    // entorno/usuario (cambia la storageKey).
    if (kanbanHydratedKey === storageKey || kanbanHydrateInFlight === storageKey) {
        return false;
    }

    kanbanHydrateInFlight = storageKey;

    try {
        const board = await kanbanBoardRef();
        if (!board) return false;

        const snap = await board.firestoreModule.getDoc(board.ref);
        kanbanHydratedKey = storageKey;

        if (snap.exists()) {
            const remote = Array.isArray(snap.data()?.cards)
                ? snap.data().cards.map(normalizeCard)
                : [];
            const nextRaw = JSON.stringify(remote);

            if (getRaw(storageKey, "") !== nextRaw) {
                setJSON(storageKey, remote);
                return true;
            }

            return false;
        }

        // Aun no hay respaldo: subir el tablero local actual (respaldo inicial /
        // migracion desde localStorage).
        const local = getCards();
        if (local.length) {
            await persistKanbanToFirebase(local);
        }

        return false;
    } catch (error) {
        // Sin conexion / permisos: se usa el cache local y se reintenta al
        // re-montar el tablero.
        return false;
    } finally {
        kanbanHydrateInFlight = "";
    }
}

function migrateLocalKanbanIfNeeded(storageKey) {
    if (
        getCurrentFirebaseUser() ||
        migratedLocalKeys.has(storageKey) ||
        storageKey === LEGACY_STORAGE_KEY
    ) {
        return;
    }

    migratedLocalKeys.add(storageKey);

    const currentCards = getJSON(storageKey, []);
    const legacyCards = getJSON(LEGACY_STORAGE_KEY, []);

    const hasCurrentCards =
        Array.isArray(currentCards) && currentCards.length;
    const hasLegacyCards =
        Array.isArray(legacyCards) && legacyCards.length;

    if (hasCurrentCards || !hasLegacyCards) {
        return;
    }

    setJSON(storageKey, legacyCards);
}

function createCard({
    title,
    detail,
    status
}) {
    const cleanTitle = String(title || "").trim();
    if (!cleanTitle) return false;

    const cards = getCards();
    const now = new Date().toISOString();

    cards.push({
        id: `kanban_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: cleanTitle,
        detail: String(detail || "").trim(),
        status: isValidColumn(status) ? status : KANBAN_COLUMNS[0].key,
        color: CARD_COLORS[cards.length % CARD_COLORS.length],
        createdAt: now,
        updatedAt: now
    });

    saveCards(cards);
    return true;
}

function deleteCard(cardId) {
    saveCards(
        getCards().filter(card => card.id !== cardId)
    );
}

function updateCard(cardId, {
    title,
    detail,
    status
}) {
    const cleanTitle = String(title || "").trim();
    if (!cleanTitle) return false;

    const cards = getCards();
    const index = cards.findIndex(card => card.id === cardId);

    if (index === -1) return false;

    cards[index] = {
        ...cards[index],
        title: cleanTitle,
        detail: String(detail || "").trim(),
        status: isValidColumn(status) ? status : cards[index].status,
        updatedAt: new Date().toISOString()
    };

    saveCards(cards);
    return true;
}

function moveCard(cardId, nextStatus) {
    if (!isValidColumn(nextStatus)) return;

    const cards = getCards();
    const index = cards.findIndex(card => card.id === cardId);

    if (index === -1) return;

    const [card] = cards.splice(index, 1);
    card.status = nextStatus;
    card.updatedAt = new Date().toISOString();

    const insertAt = cards.reduce(
        (position, item, itemIndex) =>
            item.status === nextStatus
                ? itemIndex + 1
                : position,
        cards.length
    );

    cards.splice(insertAt, 0, card);
    saveCards(cards);
}

function formatDate(value) {
    const raw = String(value || "");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? new Date(`${raw}T12:00:00`)
        : new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleDateString("es-CL", {
        day: "2-digit",
        month: "short"
    });
}

function renderCard(card) {
    const automatic = isAutomaticCard(card);
    const cardAttrs = automatic
        ? `data-kanban-auto-card="${escapeHTML(card.id)}"`
        : `draggable="true" data-kanban-card="${escapeHTML(card.id)}"`;
    const actions = automatic
        ? `
                    <button class="kanban-card__open" type="button" aria-label="Ver equipo médico" data-kanban-medical-equipment="${escapeHTML(card.equipmentId || "")}">
                        Ver equipo
                    </button>`
        : `
                    <button class="kanban-card__edit" type="button" aria-label="Editar tarjeta" data-kanban-edit="${escapeHTML(card.id)}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M12 20h9"></path>
                            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
                        </svg>
                    </button>
                    <button class="kanban-card__delete" type="button" aria-label="Eliminar tarjeta" data-kanban-delete="${escapeHTML(card.id)}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M3 6h18"></path>
                            <path d="M8 6V4h8v2"></path>
                            <path d="M19 6l-1 14H6L5 6"></path>
                            <path d="M10 11v5"></path>
                            <path d="M14 11v5"></path>
                        </svg>
                    </button>`;

    return `
        <article class="kanban-card kanban-card--${escapeHTML(card.color)} ${automatic ? "kanban-card--automatic" : ""}" ${cardAttrs}>
            <div class="kanban-card__head">
                <strong>${escapeHTML(card.title)}</strong>
                <span class="kanban-card__actions">
                    ${actions}
                </span>
            </div>
            ${card.detail ? `<p>${escapeHTML(card.detail)}</p>` : ""}
            <small>${escapeHTML(automatic ? `Vence ${formatDate(card.dueDate || card.updatedAt)}` : formatDate(card.updatedAt))}</small>
        </article>
    `;
}

function openEditCardDialog(cardId) {
    const card = getCards().find(item => item.id === cardId);
    if (!card) return;

    const backdrop = document.createElement("div");
    const close = () => backdrop.remove();

    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <form class="turn-change-dialog kanban-edit-dialog" data-kanban-edit-form autocomplete="off">
            <strong>Editar tarjeta</strong>
            <label class="metric-row metric-row--field">
                <span class="metric-label">Título</span>
                <input name="title" type="text" maxlength="80" value="${escapeHTML(card.title)}" required>
            </label>
            <label class="metric-row metric-row--field">
                <span class="metric-label">Detalle</span>
                <textarea name="detail" maxlength="280" rows="4">${escapeHTML(card.detail)}</textarea>
            </label>
            <label class="metric-row metric-row--field">
                <span class="metric-label">Estado</span>
                <select name="status">
                    ${KANBAN_COLUMNS.map(column => `
                        <option value="${escapeHTML(column.key)}" ${column.key === card.status ? "selected" : ""}>${escapeHTML(column.label)}</option>
                    `).join("")}
                </select>
            </label>
            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-dialog-cancel>Cancelar</button>
                <button class="primary-button" type="submit">Guardar</button>
            </div>
        </form>
    `;

    document.body.appendChild(backdrop);
    backdrop.querySelector("[data-dialog-cancel]")?.addEventListener("click", close);
    backdrop
        .querySelector("[data-kanban-edit-form]")
        ?.addEventListener("submit", event => {
            event.preventDefault();

            const data = new FormData(event.currentTarget);
            if (
                updateCard(cardId, {
                    title: data.get("title"),
                    detail: data.get("detail"),
                    status: data.get("status")
                })
            ) {
                close();
                renderKanbanBoard();
            }
        });
}

function openCreateCardDialog(status) {
    const column = KANBAN_COLUMNS.find(item => item.key === status);

    if (!column || !KANBAN_CREATABLE_COLUMNS.has(column.key)) return;

    const backdrop = document.createElement("div");
    const close = () => backdrop.remove();

    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <form class="turn-change-dialog kanban-edit-dialog kanban-create-dialog" role="dialog" aria-modal="true" aria-labelledby="kanbanCreateTitle" data-kanban-create-form autocomplete="off">
            <strong id="kanbanCreateTitle">Nueva tarjeta</strong>
            <div class="turn-change-dialog__meta">${escapeHTML(column.label)}</div>
            <label class="metric-row metric-row--field">
                <span class="metric-label">Título</span>
                <input name="title" type="text" maxlength="80" required>
            </label>
            <label class="metric-row metric-row--field">
                <span class="metric-label">Detalle</span>
                <textarea name="detail" maxlength="280" rows="4"></textarea>
            </label>
            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-dialog-cancel>Cancelar</button>
                <button class="primary-button" type="submit">Agregar</button>
            </div>
        </form>
    `;

    document.body.appendChild(backdrop);
    backdrop.querySelector("[data-dialog-cancel]")?.addEventListener("click", close);
    backdrop
        .querySelector("[data-kanban-create-form]")
        ?.addEventListener("submit", event => {
            event.preventDefault();

            const data = new FormData(event.currentTarget);

            if (
                createCard({
                    title: data.get("title"),
                    detail: data.get("detail"),
                    status: column.key
                })
            ) {
                close();
                renderKanbanBoard();
            }
        });
    backdrop.querySelector("input[name='title']")?.focus();
}

function renderColumnAddButton(column) {
    if (!KANBAN_CREATABLE_COLUMNS.has(column.key)) return "";

    return `
        <button class="kanban-column-add" type="button" aria-label="Agregar tarjeta en ${escapeHTML(column.label)}" title="Agregar tarjeta" data-kanban-add-status="${escapeHTML(column.key)}">
            +
        </button>
    `;
}

function openMedicalEquipmentFromKanban(equipmentId) {
    const id = String(equipmentId || "");

    if (!id) return;

    // La tarjeta es de renovacion: se abre directo el contrato del equipo.
    selectMedicalEquipment(id, "contrato");
    document
        .querySelector('.nav-tile[data-target="medicalEquipmentPanel"]')
        ?.click();
}

function renderColumn(column, cards) {
    const columnCards = cards.filter(card => card.status === column.key);

    return `
        <section class="kanban-column" data-kanban-column="${escapeHTML(column.key)}">
            <div class="kanban-column__head">
                <h4>${escapeHTML(column.label)}</h4>
                <span>${columnCards.length}</span>
            </div>
            <div class="kanban-column__cards">
                ${
                    columnCards.length
                        ? columnCards.map(renderCard).join("")
                        : `<div class="kanban-empty">Sin tarjetas</div>`
                }
            </div>
            ${renderColumnAddButton(column)}
        </section>
    `;
}

function renderShell(cards) {
    return `
        <div class="kanban-board">
            ${KANBAN_COLUMNS.map(column => renderColumn(column, cards)).join("")}
        </div>
    `;
}

function bindKanbanEvents(root) {
    root.querySelectorAll("[data-kanban-add-status]").forEach(button => {
        button.onclick = () => openCreateCardDialog(button.dataset.kanbanAddStatus);
    });

    root.querySelectorAll("[data-kanban-medical-equipment]").forEach(button => {
        button.onclick = () =>
            openMedicalEquipmentFromKanban(button.dataset.kanbanMedicalEquipment);
    });

    root.querySelectorAll("[data-kanban-delete]").forEach(button => {
        button.onclick = async () => {
            if (
                !await showConfirm(
                    "La tarjeta se eliminará del tablero.",
                    {
                        title: "Eliminar tarjeta",
                        tone: "danger",
                        confirmText: "Eliminar",
                        destructive: true
                    }
                )
            ) {
                return;
            }

            deleteCard(button.dataset.kanbanDelete);
            renderKanbanBoard();
        };
    });

    root.querySelectorAll("[data-kanban-edit]").forEach(button => {
        button.onclick = () => openEditCardDialog(button.dataset.kanbanEdit);
    });

    root.querySelectorAll("[data-kanban-card]").forEach(card => {
        card.ondragstart = event => {
            draggedCardId = card.dataset.kanbanCard;
            card.classList.add("is-dragging");
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", draggedCardId);
        };

        card.ondragend = () => {
            draggedCardId = "";
            card.classList.remove("is-dragging");
        };
    });

    root.querySelectorAll("[data-kanban-column]").forEach(column => {
        column.ondragover = event => {
            event.preventDefault();
            column.classList.add("is-drag-over");
            event.dataTransfer.dropEffect = "move";
        };

        column.ondragleave = event => {
            if (!column.contains(event.relatedTarget)) {
                column.classList.remove("is-drag-over");
            }
        };

        column.ondrop = event => {
            event.preventDefault();
            column.classList.remove("is-drag-over");

            const cardId =
                draggedCardId ||
                event.dataTransfer.getData("text/plain");

            if (!cardId) return;

            moveCard(cardId, column.dataset.kanbanColumn);
            renderKanbanBoard();
        };
    });
}

function shouldRefreshForMedicalEquipment(event) {
    const keys = event?.detail?.keys;

    return !Array.isArray(keys) ||
        !keys.length ||
        keys.includes(MEDICAL_EQUIPMENT_KEY);
}

function refreshKanbanForMedicalEquipment(event) {
    if (!shouldRefreshForMedicalEquipment(event)) return;
    if (document.body?.dataset?.activeView !== "kanban") return;

    renderKanbanBoard();
}

function bindAutomaticKanbanRefresh() {
    if (automaticKanbanRefreshBound || typeof window === "undefined") return;

    automaticKanbanRefreshBound = true;
    window.addEventListener(
        "proturnos:medicalEquipmentChanged",
        refreshKanbanForMedicalEquipment
    );
    window.addEventListener(
        "proturnos:workspacePermissionsChanged",
        refreshKanbanForMedicalEquipment
    );
    window.addEventListener(
        "proturnos:persistenceChanged",
        refreshKanbanForMedicalEquipment
    );
}

export function renderKanbanBoard() {
    const root = document.getElementById("kanbanPanel");

    if (!root) return;

    bindAutomaticKanbanRefresh();

    root.innerHTML = renderShell(getKanbanCardsForRender());
    bindKanbanEvents(root);

    // Traer el respaldo del usuario desde Firebase (una vez por entorno/usuario)
    // y re-render si el remoto difiere del cache local.
    hydrateKanbanFromFirebase().then((changed) => {
        if (!changed) return;

        const node = document.getElementById("kanbanPanel");
        if (!node) return;

        node.innerHTML = renderShell(getKanbanCardsForRender());
        bindKanbanEvents(node);
    });
}
