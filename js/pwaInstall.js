function isStandaloneDisplay(windowRef) {
    return Boolean(
        windowRef?.matchMedia?.("(display-mode: standalone)")?.matches ||
        windowRef?.navigator?.standalone === true
    );
}

export function initPwaInstall(options = {}) {
    const buttons = [
        ...(Array.isArray(options.buttons) ? options.buttons : []),
        options.button
    ].filter(Boolean);
    const windowRef = options.windowRef || globalThis.window;

    if (!buttons.length || !windowRef?.addEventListener) return () => {};

    let installPrompt = null;

    const hideButtons = () => {
        buttons.forEach(button => {
            button.hidden = true;
            button.disabled = false;
        });
    };

    const handleBeforeInstallPrompt = event => {
        if (isStandaloneDisplay(windowRef)) return;

        event.preventDefault();
        installPrompt = event;
        buttons.forEach(button => {
            button.hidden = false;
            button.disabled = false;
        });
    };

    const handleInstallClick = async () => {
        if (!installPrompt) return;

        const activePrompt = installPrompt;
        installPrompt = null;
        buttons.forEach(button => {
            button.disabled = true;
        });

        try {
            await activePrompt.prompt();
            await activePrompt.userChoice;
        } catch (error) {
            console.warn("No se pudo abrir la instalacion de TurnoPlus.", error);
        } finally {
            hideButtons();
        }
    };

    const handleAppInstalled = () => {
        installPrompt = null;
        hideButtons();
    };

    hideButtons();
    windowRef.addEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
    );
    windowRef.addEventListener("appinstalled", handleAppInstalled);
    buttons.forEach(button => {
        button.addEventListener("click", handleInstallClick);
    });

    return () => {
        windowRef.removeEventListener(
            "beforeinstallprompt",
            handleBeforeInstallPrompt
        );
        windowRef.removeEventListener("appinstalled", handleAppInstalled);
        buttons.forEach(button => {
            button.removeEventListener("click", handleInstallClick);
        });
    };
}

export { isStandaloneDisplay };
