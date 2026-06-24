// Tema claro/oscuro: aplica la clase al body, sincroniza el toggle y recuerda
// la preferencia del usuario en almacenamiento local.

import { DOM } from "./dom.js";
import { getRaw, setRaw } from "./persistence.js";

const THEME_KEY = "proturnos_theme";

/**
 * Aplica un tema ("light" | "dark") al body y actualiza el toggle.
 * @param {string} theme
 */
export function applyTheme(theme) {
    document.body.classList.remove("theme-light", "theme-dark");
    document.body.classList.add(`theme-${theme}`);
    DOM.themeToggle.setAttribute(
        "aria-pressed",
        theme === "dark" ? "true" : "false"
    );
}

/**
 * Inicializa el tema: usa el guardado o la preferencia del sistema, y enlaza
 * el toggle para alternarlo.
 */
export function initTheme() {
    const savedTheme = getRaw(THEME_KEY, "");
    const prefersLight =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: light)").matches;

    const initialTheme =
        savedTheme || (prefersLight ? "light" : "dark");

    applyTheme(initialTheme);

    DOM.themeToggle.onclick = () => {
        const nextTheme =
            document.body.classList.contains("theme-dark")
                ? "light"
                : "dark";

        setRaw(THEME_KEY, nextTheme);
        applyTheme(nextTheme);
    };
}
