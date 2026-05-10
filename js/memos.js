import { addAuditLog, AUDIT_CATEGORY } from "./auditLog.js";
import { getJSON, setJSON } from "./persistence.js";

const MEMOS_KEY = "memos";
const STATUS_PENDING = "pending";
const STATUS_COMPLETED = "completed";

let selectedStatus = STATUS_PENDING;

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function makeId(prefix = "memo") {
    return `${prefix}_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 9)}`;
}

function normalizeStatus(status) {
    return status === STATUS_COMPLETED
        ? STATUS_COMPLETED
        : STATUS_PENDING;
}

function normalizeDocument(doc = {}) {
    const name = String(doc.name || "").trim();
    const dataUrl = String(doc.dataUrl || "");

    if (!name || !dataUrl) return null;

    return {
        id: String(doc.id || makeId("memo_doc")),
        name,
        type: String(doc.type || "application/octet-stream"),
        size: Number(doc.size) || 0,
        dataUrl,
        attachedAt: doc.attachedAt || new Date().toISOString()
    };
}

function normalizeMemo(memo = {}) {
    const sourceId = String(memo.sourceId || "");
    const createdAt = memo.createdAt || new Date().toISOString();
    const documents = Array.isArray(memo.documents)
        ? memo.documents.map(normalizeDocument).filter(Boolean)
        : [];
    const status = normalizeStatus(memo.status);

    return {
        id: String(memo.id || sourceId || makeId()),
        sourceId,
        title: String(memo.title || "Memorandum pendiente"),
        profile: String(memo.profile || ""),
        typeLabel: String(memo.typeLabel || "MEMO"),
        detail: String(memo.detail || ""),
        startKey: String(memo.startKey || ""),
        endKey: String(memo.endKey || ""),
        dateKey: String(memo.dateKey || ""),
        status,
        createdAt,
        completedAt:
            status === STATUS_COMPLETED
                ? memo.completedAt || createdAt
                : "",
        documents
    };
}

function parseKey(key) {
    const match = String(key || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

    if (!match) return null;

    return new Date(
        Number(match[1]),
        Number(match[2]),
        Number(match[3])
    );
}

function formatKey(key) {
    const date = parseKey(key);

    if (!date || Number.isNaN(date.getTime())) return "Sin fecha";

    return date.toLocaleDateString("es-CL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).replace(/\//g, "-");
}

function formatTimestamp(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "Sin fecha";

    return date.toLocaleString("es-CL", {
        dateStyle: "short",
        timeStyle: "short"
    });
}

function sortMemos(a, b) {
    const statusWeight = status =>
        status === STATUS_PENDING ? 0 : 1;
    const statusDiff =
        statusWeight(a.status) - statusWeight(b.status);

    if (statusDiff) return statusDiff;

    return new Date(b.createdAt) - new Date(a.createdAt);
}

function memoStatusLabel(status) {
    return status === STATUS_COMPLETED
        ? "Realizado"
        : "Pendiente";
}

function dispatchMemosChanged() {
    if (typeof window === "undefined") return;

    window.dispatchEvent(
        new CustomEvent("proturnos:memosChanged")
    );
}

export function getMemos() {
    return Array.isArray(getJSON(MEMOS_KEY, []))
        ? getJSON(MEMOS_KEY, []).map(normalizeMemo).sort(sortMemos)
        : [];
}

function persistMemos(memos, { emit = true } = {}) {
    setJSON(MEMOS_KEY, memos.map(normalizeMemo));
    updateMemosNavBadge();

    if (emit) dispatchMemosChanged();
}

export function pendingMemosCount() {
    return getMemos().filter(memo =>
        memo.status === STATUS_PENDING
    ).length;
}

export function updateMemosNavBadge(count = pendingMemosCount()) {
    if (typeof document === "undefined") return;

    const tile = document.querySelector(
        ".nav-tile[data-target='memosPanel']"
    );

    if (!tile) return;

    let badge = tile.querySelector(".nav-alert-badge");

    if (!count) {
        badge?.remove();
        tile.removeAttribute("data-alert-count");
        return;
    }

    if (!badge) {
        badge = document.createElement("span");
        badge.className = "nav-alert-badge";
        tile.appendChild(badge);
    }

    badge.textContent = count > 99 ? "99+" : String(count);
    tile.dataset.alertCount = String(count);
}

export function createMemoTask(task = {}) {
    const memo = normalizeMemo({
        ...task,
        status: task.status || STATUS_PENDING,
        title: task.title || "Memorandum pendiente",
        sourceId:
            task.sourceId ||
            `${task.profile || "sin_perfil"}:${task.typeLabel || "memo"}:${task.startKey || task.dateKey || Date.now()}`
    });
    const memos = getMemos();
    const existingIndex = memos.findIndex(item =>
        item.sourceId && item.sourceId === memo.sourceId
    );

    if (existingIndex >= 0) {
        const existing = memos[existingIndex];

        memos[existingIndex] = normalizeMemo({
            ...existing,
            ...memo,
            id: existing.id,
            status: existing.status,
            completedAt: existing.completedAt,
            documents: existing.documents
        });
    } else {
        memos.unshift(memo);
    }

    persistMemos(memos);

    return memo;
}

function amountText(amount, typeLabel) {
    if (String(typeLabel).startsWith("1/2")) {
        return typeLabel;
    }

    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0) {
        return typeLabel;
    }

    if (value === 1) return `1 ${typeLabel}`;

    return `${value} ${typeLabel}`;
}

export function createLeaveMemoTask({
    profile,
    typeLabel,
    amount = 1,
    startKey,
    endKey,
    sourceType
} = {}) {
    if (!profile || !typeLabel || !startKey) return null;

    const finalEndKey = endKey || startKey;
    const detail = [
        `Nombre: ${profile}`,
        `Permiso: ${amountText(amount, typeLabel)}`,
        `Fecha inicio: ${formatKey(startKey)}`,
        `Fecha termino: ${formatKey(finalEndKey)}`
    ].join(" | ");

    return createMemoTask({
        sourceId: [
            "leave",
            sourceType || typeLabel,
            profile,
            startKey,
            finalEndKey,
            amount
        ].join(":"),
        profile,
        typeLabel,
        detail,
        startKey,
        endKey: finalEndKey
    });
}

function missingClockTypeLabel(missingEntry, missingExit) {
    if (missingEntry && missingExit) return "Marcaje incompleto";
    if (missingEntry) return "Marcaje sin entrada";

    return "Marcaje sin salida";
}

export function createClockMemoTask({
    profile,
    dateKey,
    segmentId = "turno",
    segmentLabel = "",
    missingEntry = false,
    missingExit = false
} = {}) {
    if (!profile || !dateKey || (!missingEntry && !missingExit)) {
        return null;
    }

    const missingParts = [
        missingEntry ? "entrada" : "",
        missingExit ? "salida" : ""
    ].filter(Boolean);
    const typeLabel = missingClockTypeLabel(
        missingEntry,
        missingExit
    );
    const detail = [
        `Nombre: ${profile}`,
        `Fecha: ${formatKey(dateKey)}`,
        `Falta de marcaje: ${missingParts.join(" y ")}`,
        segmentLabel ? `Turno: ${segmentLabel}` : ""
    ].filter(Boolean).join(" | ");

    return createMemoTask({
        sourceId: [
            "clock",
            profile,
            dateKey,
            segmentId
        ].join(":"),
        profile,
        typeLabel,
        detail,
        dateKey
    });
}

function setMemoCompleted(id, completed) {
    const memos = getMemos();
    const updated = memos.map(memo => {
        if (memo.id !== id) return memo;

        return normalizeMemo({
            ...memo,
            status: completed
                ? STATUS_COMPLETED
                : STATUS_PENDING,
            completedAt: completed
                ? new Date().toISOString()
                : ""
        });
    });
    const memo = updated.find(item => item.id === id);

    persistMemos(updated);

    if (memo) {
        addAuditLog(
            AUDIT_CATEGORY.WORKER_REQUESTS,
            completed
                ? "Marco memorandum como realizado"
                : "Reabrio memorandum pendiente",
            `${memo.profile || "Sin trabajador"}: ${memo.typeLabel}.`,
            {
                profile: memo.profile,
                memoId: memo.id,
                memoType: memo.typeLabel
            }
        );
    }
}

function attachMemoDocument(id, document) {
    const memos = getMemos();
    const updated = memos.map(memo => {
        if (memo.id !== id) return memo;

        return normalizeMemo({
            ...memo,
            documents: [
                ...(memo.documents || []),
                document
            ]
        });
    });
    const memo = updated.find(item => item.id === id);

    persistMemos(updated);

    if (memo) {
        addAuditLog(
            AUDIT_CATEGORY.WORKER_REQUESTS,
            "Adjunto documento a memorandum",
            `${memo.profile || "Sin trabajador"}: ${document.name}.`,
            {
                profile: memo.profile,
                memoId: memo.id,
                memoType: memo.typeLabel
            }
        );
    }
}

function fileToMemoDocument(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onerror = () => reject(reader.error);
        reader.onload = () => resolve({
            id: makeId("memo_doc"),
            name: file.name,
            type: file.type || "application/octet-stream",
            size: file.size || 0,
            dataUrl: reader.result,
            attachedAt: new Date().toISOString()
        });
        reader.readAsDataURL(file);
    });
}

function openMemoDocument(memoId, documentId) {
    if (typeof window === "undefined") return;

    const memo = getMemos().find(item => item.id === memoId);
    const document = memo?.documents?.find(item =>
        item.id === documentId
    );

    if (!document?.dataUrl) return;

    const link = window.document.createElement("a");

    link.href = document.dataUrl;
    link.target = "_blank";
    link.rel = "noopener";
    link.download = document.name;
    link.click();
}

function statusButtonHTML(status, label, count) {
    return `
        <button class="worker-request-filter ${selectedStatus === status ? "is-active" : ""}" type="button" data-memo-status="${status}">
            ${label} <span>${count}</span>
        </button>
    `;
}

function documentsHTML(memo) {
    const documents = memo.documents || [];

    return `
        <div class="memo-documents">
            ${documents.length
                ? `
                    <div class="memo-document-list">
                        ${documents.map(document => `
                            <button class="memo-document-button" type="button" data-memo-doc="${escapeHTML(document.id)}" data-memo-id="${escapeHTML(memo.id)}">
                                ${escapeHTML(document.name)}
                            </button>
                        `).join("")}
                    </div>
                `
                : `<small>Sin documentos adjuntos.</small>`}
            <label class="memo-file-button">
                Adjuntar documento
                <input type="file" data-memo-file="${escapeHTML(memo.id)}">
            </label>
        </div>
    `;
}

function memoCardHTML(memo) {
    const completed = memo.status === STATUS_COMPLETED;

    return `
        <article class="worker-request-card memo-card ${completed ? "is-completed" : ""}">
            <div class="worker-request-card__main">
                <div>
                    <span class="worker-request-type">${escapeHTML(memo.typeLabel)}</span>
                    <h4>${escapeHTML(memo.title)}</h4>
                    <p>${escapeHTML(memo.detail || "Sin detalle adicional.")}</p>
                    <small>Creado: ${escapeHTML(formatTimestamp(memo.createdAt))}</small>
                </div>

                <div class="worker-request-card__meta">
                    <span class="worker-request-status worker-request-status--${escapeHTML(memo.status)}">
                        ${escapeHTML(memoStatusLabel(memo.status))}
                    </span>
                    <label class="memo-check">
                        <input type="checkbox" data-memo-complete="${escapeHTML(memo.id)}" ${completed ? "checked" : ""}>
                        <span>Realizado</span>
                    </label>
                </div>
            </div>
            ${documentsHTML(memo)}
        </article>
    `;
}

export function renderMemosPanel() {
    if (typeof document === "undefined") return;

    const panel = document.getElementById("memosPanel");

    updateMemosNavBadge();

    if (!panel) return;

    const memos = getMemos();
    const pending = memos.filter(memo =>
        memo.status === STATUS_PENDING
    );
    const completed = memos.filter(memo =>
        memo.status === STATUS_COMPLETED
    );
    const visible = selectedStatus === "all"
        ? memos
        : memos.filter(memo => memo.status === selectedStatus);

    panel.innerHTML = `
        <div class="section-head section-head--with-action">
            <span class="section-head__title">
                <h3>MEMOS</h3>
                <small>
                    Revisa los memorandum pendientes asociados a permisos y marcajes incompletos.
                </small>
            </span>
            <span class="worker-request-counter">
                ${pending.length} pendiente(s)
            </span>
        </div>

        <div class="worker-request-filters">
            ${statusButtonHTML(STATUS_PENDING, "Pendientes", pending.length)}
            ${statusButtonHTML(STATUS_COMPLETED, "Realizados", completed.length)}
            ${statusButtonHTML("all", "Todos", memos.length)}
        </div>

        <div class="worker-request-list memo-list">
            ${visible.length
                ? visible.map(memoCardHTML).join("")
                : `
                    <div class="empty-state empty-state--compact">
                        ${selectedStatus === STATUS_PENDING
                            ? "No hay memorandum pendientes."
                            : "No hay memorandum para este filtro."}
                    </div>
                `}
        </div>
    `;

    panel.querySelectorAll("[data-memo-status]").forEach(button => {
        button.onclick = () => {
            selectedStatus = button.dataset.memoStatus || STATUS_PENDING;
            renderMemosPanel();
        };
    });

    panel.querySelectorAll("[data-memo-complete]").forEach(input => {
        input.onchange = () => {
            setMemoCompleted(
                input.dataset.memoComplete,
                input.checked
            );
        };
    });

    panel.querySelectorAll("[data-memo-file]").forEach(input => {
        input.onchange = async () => {
            const file = input.files?.[0];

            if (!file) return;

            try {
                const document = await fileToMemoDocument(file);
                attachMemoDocument(input.dataset.memoFile, document);
            } catch (error) {
                alert("No se pudo adjuntar el documento.");
                console.error(error);
            } finally {
                input.value = "";
            }
        };
    });

    panel.querySelectorAll("[data-memo-doc]").forEach(button => {
        button.onclick = () => {
            openMemoDocument(
                button.dataset.memoId,
                button.dataset.memoDoc
            );
        };
    });
}
