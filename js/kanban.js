import { stripAccents } from "./stringUtils.js";
import { escapeHTML } from "./htmlUtils.js";
import { getJSON, setJSON } from "./persistence.js";
import { getCurrentFirebaseUser } from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";
import { showConfirm } from "./dialogs.js";

const LEGACY_STORAGE_KEY = "kanban_cards";
const STORAGE_KEY_PREFIX = "kanban_private_cards";

const KANBAN_COLUMNS = [
    { key: "pending", label: "Pendientes" },
    { key: "progress", label: "En Proceso" },
    { key: "done", label: "Terminadas" }
];

const CARD_COLORS = [
    "cyan",
    "yellow",
    "green",
    "coral"
];

let draggedCardId = "";
const migratedLocalKeys = new Set();

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
    setJSON(getKanbanStorageKey(), cards.map(normalizeCard));
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
    const cards = getCards();
    const now = new Date().toISOString();

    cards.push({
        id: `kanban_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: String(title || "").trim(),
        detail: String(detail || "").trim(),
        status: isValidColumn(status) ? status : KANBAN_COLUMNS[0].key,
        color: CARD_COLORS[cards.length % CARD_COLORS.length],
        createdAt: now,
        updatedAt: now
    });

    saveCards(cards);
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
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleDateString("es-CL", {
        day: "2-digit",
        month: "short"
    });
}

function renderCard(card) {
    return `
        <article class="kanban-card kanban-card--${escapeHTML(card.color)}" draggable="true" data-kanban-card="${escapeHTML(card.id)}">
            <div class="kanban-card__head">
                <strong>${escapeHTML(card.title)}</strong>
                <span class="kanban-card__actions">
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
                    </button>
                </span>
            </div>
            ${card.detail ? `<p>${escapeHTML(card.detail)}</p>` : ""}
            <small>${escapeHTML(formatDate(card.updatedAt))}</small>
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
                <span class="metric-label">Titulo</span>
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
        </section>
    `;
}

function renderShell(cards) {
    return `
        <div class="kanban-head">
            <form class="kanban-form" data-kanban-form autocomplete="off">
                <input name="title" type="text" maxlength="80" placeholder="Titulo de tarjeta" required>
                <textarea name="detail" maxlength="280" placeholder="Detalle opcional"></textarea>
                <select name="status" aria-label="Columna inicial">
                    ${KANBAN_COLUMNS.map(column => `
                        <option value="${escapeHTML(column.key)}">${escapeHTML(column.label)}</option>
                    `).join("")}
                </select>
                <button class="primary-button kanban-add-button" type="submit">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M12 5v14"></path>
                        <path d="M5 12h14"></path>
                    </svg>
                    <span>Crear</span>
                </button>
            </form>
        </div>
        <div class="kanban-board">
            ${KANBAN_COLUMNS.map(column => renderColumn(column, cards)).join("")}
        </div>
    `;
}

function bindKanbanEvents(root) {
    const form = root.querySelector("[data-kanban-form]");

    if (form) {
        form.onsubmit = event => {
            event.preventDefault();

            const data = new FormData(form);
            const title = String(data.get("title") || "").trim();

            if (!title) return;

            createCard({
                title,
                detail: data.get("detail"),
                status: data.get("status")
            });
            renderKanbanBoard();
            document
                .querySelector("[data-kanban-form] input[name='title']")
                ?.focus();
        };
    }

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

export function renderKanbanBoard() {
    const root = document.getElementById("kanbanPanel");

    if (!root) return;

    root.innerHTML = renderShell(getCards());
    bindKanbanEvents(root);
}
