// Arrastrar las tarjetas del inicio desde su manija.
//
// Cada tarjeta lleva arriba al centro una manija de cuatro puntos: con la mano
// encima dice que la tarjeta se puede arrastrar, y es el unico lugar desde
// donde se arrastra. Asi el resto de la tarjeta sigue siendo lo que era: se
// aprietan sus botones, se selecciona su texto y se scrollean sus listas como
// siempre.
//
// Se aprieta el clic sobre la manija y, sin soltar, se mueve: la tarjeta se
// levanta, sigue al puntero y un hueco punteado muestra donde va a quedar, en
// su columna o en otra. Escape la devuelve a su lugar.
//
// Solo con las tres columnas a la vista: bajo 1100 px las pilas se disuelven
// (display: contents) y las tarjetas se reparten solas, asi que no hay columna
// donde soltar; la manija ni se muestra.
//
// Este modulo solo mueve la tarjeta en pantalla y avisa donde se solto; que
// orden queda guardado lo decide quien lo usa (home.js con homeLayout.js).

export const DRAG_MEDIA_QUERY = "(min-width: 1101px)";

// Con el clic apretado sobre la manija, moverse esto ya es arrastrar. Menos es
// un clic suelto, y un clic suelto no mueve nada.
const DRAG_START_PX = 4;
// Cerca del borde de la pantalla, la pagina se desplaza sola.
const EDGE_PX = 70;
const EDGE_SCROLL_PX = 14;
// Tiempo en que, despues de soltar, se ignora el clic que dispara el navegador.
const CLICK_GUARD_MS = 400;

// La manija: cuatro puntos. El title explica que hace para quien no lo intuya.
export const DRAG_HANDLE_HTML =
    `<span class="hm-drag-handle" data-hm-drag-handle aria-hidden="true" title="Arrastrar para mover la tarjeta">` +
    `<svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">` +
    `<circle cx="3" cy="3" r="1.4"/><circle cx="9" cy="3" r="1.4"/>` +
    `<circle cx="3" cy="9" r="1.4"/><circle cx="9" cy="9" r="1.4"/>` +
    `</svg></span>`;

/**
 * Marca la raiz de una tarjeta con su id (lo que se arrastra y lo que dice que
 * tarjeta se solto) y le pone la manija como primer hijo. Una tarjeta que hoy
 * no se muestra ("") queda igual.
 *
 * @param {string} html una tarjeta que empieza con <div class="hm-card ...">
 * @param {string} id
 */
export function withDragHandle(html, id) {
    const markup = String(html || "");
    const start = markup.indexOf('<div class="hm-card');

    if (start === -1) return markup;

    const end = markup.indexOf(">", start);

    return markup.slice(0, start) +
        `<div data-hm-card="${id}"` +
        markup.slice(start + "<div".length, end + 1) +
        DRAG_HANDLE_HTML +
        markup.slice(end + 1);
}

let active = null;

export function isHomeCardDragActive() {
    return Boolean(active);
}

function stacksOf(grid) {
    return [...grid.children].filter(element =>
        element.classList.contains("hm-stack")
    );
}

/**
 * Donde caeria una tarjeta soltada en (x, y): la columna que tiene el puntero
 * encima -o la mas cercana, si esta entre dos- y la tarjeta delante de la cual
 * quedaria (null = al final).
 */
export function dropTarget(grid, x, y, dragged = null) {
    const stacks = stacksOf(grid);

    if (!stacks.length) return { stack: null, before: null, column: -1 };

    const rects = stacks.map(stack => stack.getBoundingClientRect());
    const center = rect => (rect.left + rect.right) / 2;
    let column = rects.findIndex(rect => x >= rect.left && x <= rect.right);

    if (column === -1) {
        column = rects.reduce(
            (best, rect, index) =>
                Math.abs(x - center(rect)) < Math.abs(x - center(rects[best]))
                    ? index
                    : best,
            0
        );
    }

    const stack = stacks[column];
    const cards = [...stack.children].filter(element =>
        element !== dragged && element.matches("[data-hm-card]")
    );
    const before = cards.find(card => {
        const rect = card.getBoundingClientRect();

        return y < rect.top + rect.height / 2;
    }) || null;

    return { stack, before, column };
}

function nextCard(element) {
    let node = element.nextElementSibling;

    while (node && !node.matches("[data-hm-card]")) {
        node = node.nextElementSibling;
    }

    return node;
}

function scrollParent(element) {
    for (let node = element?.parentElement; node; node = node.parentElement) {
        const { overflowY } = getComputedStyle(node);

        if (
            (overflowY === "auto" || overflowY === "scroll") &&
            node.scrollHeight > node.clientHeight
        ) {
            return node;
        }
    }

    return document.scrollingElement || document.documentElement;
}

/**
 * Habilita el arrastre en una grilla del inicio.
 *
 * @param {HTMLElement|null} grid la seccion con las tres .hm-stack
 * @param {(drop: {cardId: string, column: number, beforeId: string|null, card: HTMLElement}) => void} onDrop
 */
export function enableHomeCardDrag(grid, onDrop) {
    if (!grid || grid.dataset.dragReady === "true") return;

    grid.dataset.dragReady = "true";

    let pending = null;
    let suppressClickUntil = 0;

    // Soltar una tarjeta no puede terminar en un clic sobre lo que quedo
    // debajo del puntero.
    grid.addEventListener("click", event => {
        if (Date.now() >= suppressClickUntil) return;

        event.preventDefault();
        event.stopPropagation();
    }, true);

    function clearPending() {
        if (!pending) return;

        window.removeEventListener("pointermove", onPendingMove);
        window.removeEventListener("pointerup", clearPending);
        window.removeEventListener("pointercancel", clearPending);
        pending = null;
    }

    function onPendingMove(event) {
        if (!pending || event.pointerId !== pending.pointerId) return;

        const moved = Math.hypot(
            event.clientX - pending.startX,
            event.clientY - pending.startY
        );

        if (moved > DRAG_START_PX) {
            const { card, pointerId, startX, startY } = pending;

            clearPending();
            beginDrag(card, pointerId, startX, startY);
            onDragMove(event);
        }
    }

    grid.addEventListener("pointerdown", event => {
        if (active || event.button !== 0 || !event.isPrimary) return;
        if (!window.matchMedia(DRAG_MEDIA_QUERY).matches) return;

        const handle = event.target.closest?.("[data-hm-drag-handle]");
        const card = handle?.closest("[data-hm-card]");

        if (!card || !grid.contains(card)) return;

        // Sin esto, arrastrar desde la manija seleccionaria el texto vecino.
        event.preventDefault();
        clearPending();
        pending = {
            card,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY
        };
        window.addEventListener("pointermove", onPendingMove);
        window.addEventListener("pointerup", clearPending);
        window.addEventListener("pointercancel", clearPending);
    });

    function beginDrag(card, pointerId, x, y) {
        if (!card.isConnected) return;

        const rect = card.getBoundingClientRect();
        const placeholder = document.createElement("div");

        placeholder.className = "hm-card-placeholder";
        placeholder.style.height = `${rect.height}px`;

        active = {
            card,
            placeholder,
            pointerId,
            offsetX: x - rect.left,
            offsetY: y - rect.top,
            lastX: x,
            lastY: y,
            originParent: card.parentNode,
            originNext: card.nextSibling,
            scroller: scrollParent(grid),
            frame: 0
        };

        card.parentNode.insertBefore(placeholder, card);
        card.classList.add("is-dragging");
        card.style.width = `${rect.width}px`;
        card.style.height = `${rect.height}px`;
        positionCard();

        document.body.classList.add("hm-arranging");
        grid.classList.add("is-arranging");
        window.getSelection?.()?.removeAllRanges();

        window.addEventListener("pointermove", onDragMove);
        window.addEventListener("pointerup", onDragEnd);
        window.addEventListener("pointercancel", cancelDrag);
        window.addEventListener("keydown", onDragKey);
        window.addEventListener("blur", cancelDrag);
        active.frame = requestAnimationFrame(autoScroll);
    }

    function positionCard() {
        const { card, lastX, lastY, offsetX, offsetY } = active;

        card.style.left = `${lastX - offsetX}px`;
        card.style.top = `${lastY - offsetY}px`;
    }

    function placePlaceholder() {
        const { stack, before } = dropTarget(
            grid,
            active.lastX,
            active.lastY,
            active.card
        );

        if (!stack) return;
        if (
            active.placeholder.parentNode === stack &&
            nextCard(active.placeholder) === before
        ) {
            return;
        }

        stack.insertBefore(active.placeholder, before);
    }

    function onDragMove(event) {
        if (!active || event.pointerId !== active.pointerId) return;

        active.lastX = event.clientX;
        active.lastY = event.clientY;
        positionCard();
        placePlaceholder();
    }

    function autoScroll() {
        if (!active) return;

        const { scroller, lastY } = active;
        const isPage = scroller === document.scrollingElement ||
            scroller === document.documentElement;
        const rect = isPage
            ? { top: 0, bottom: window.innerHeight }
            : scroller.getBoundingClientRect();
        let delta = 0;

        if (lastY < rect.top + EDGE_PX) delta = -EDGE_SCROLL_PX;
        else if (lastY > rect.bottom - EDGE_PX) delta = EDGE_SCROLL_PX;

        if (delta) {
            scroller.scrollBy(0, delta);
            placePlaceholder();
        }

        active.frame = requestAnimationFrame(autoScroll);
    }

    function finishDrag() {
        const { card, placeholder, frame } = active;

        cancelAnimationFrame(frame);
        placeholder.remove();
        card.classList.remove("is-dragging");
        ["width", "height", "left", "top"].forEach(property => {
            card.style[property] = "";
        });
        document.body.classList.remove("hm-arranging");
        grid.classList.remove("is-arranging");

        window.removeEventListener("pointermove", onDragMove);
        window.removeEventListener("pointerup", onDragEnd);
        window.removeEventListener("pointercancel", cancelDrag);
        window.removeEventListener("keydown", onDragKey);
        window.removeEventListener("blur", cancelDrag);
        active = null;
    }

    function onDragEnd(event) {
        if (!active || event.pointerId !== active.pointerId) return;

        const { card, placeholder } = active;
        const stack = placeholder.parentNode;
        const column = stacksOf(grid).indexOf(stack);

        stack.insertBefore(card, placeholder);

        const before = nextCard(placeholder);

        finishDrag();
        suppressClickUntil = Date.now() + CLICK_GUARD_MS;

        if (column === -1) return;

        onDrop?.({
            cardId: card.dataset.hmCard,
            column,
            beforeId: before?.dataset.hmCard || null,
            card
        });
    }

    // Escape, perder el foco de la ventana o que el navegador cancele el
    // puntero: la tarjeta vuelve a donde estaba y no se guarda nada.
    function cancelDrag() {
        if (!active) return;

        const { card, originParent, originNext } = active;

        finishDrag();
        originParent.insertBefore(card, originNext);
    }

    function onDragKey(event) {
        if (event.key === "Escape") cancelDrag();
    }
}
