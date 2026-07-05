import assert from "node:assert/strict";
import test from "node:test";

import {
    initPwaInstall,
    isStandaloneDisplay
} from "../js/pwaInstall.js";

class FakeButton extends EventTarget {
    hidden = false;
    disabled = false;
}

class FakeWindow extends EventTarget {
    constructor(standalone = false) {
        super();
        this.navigator = { standalone: false };
        this.standalone = standalone;
    }

    matchMedia() {
        return { matches: this.standalone };
    }
}

function nextTask() {
    return new Promise(resolve => setImmediate(resolve));
}

test("detecta el modo PWA instalado", () => {
    assert.equal(isStandaloneDisplay(new FakeWindow(false)), false);
    assert.equal(isStandaloneDisplay(new FakeWindow(true)), true);
});

test("muestra el boton al recibir beforeinstallprompt y abre el aviso nativo", async () => {
    const windowRef = new FakeWindow();
    const button = new FakeButton();
    const gateButton = new FakeButton();
    let promptCalls = 0;
    const event = new Event("beforeinstallprompt", { cancelable: true });

    event.prompt = async () => {
        promptCalls += 1;
    };
    event.userChoice = Promise.resolve({ outcome: "accepted" });

    const destroy = initPwaInstall({
        buttons: [button, gateButton],
        windowRef
    });
    assert.equal(button.hidden, true);
    assert.equal(gateButton.hidden, true);

    windowRef.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(button.hidden, false);
    assert.equal(gateButton.hidden, false);

    gateButton.dispatchEvent(new Event("click"));
    await nextTask();

    assert.equal(promptCalls, 1);
    assert.equal(button.hidden, true);
    assert.equal(gateButton.hidden, true);
    assert.equal(button.disabled, false);
    assert.equal(gateButton.disabled, false);
    destroy();
});

test("oculta el boton cuando el navegador confirma la instalacion", () => {
    const windowRef = new FakeWindow();
    const button = new FakeButton();
    const event = new Event("beforeinstallprompt", { cancelable: true });

    event.prompt = async () => {};
    event.userChoice = Promise.resolve({ outcome: "dismissed" });

    initPwaInstall({ button, windowRef });
    windowRef.dispatchEvent(event);
    assert.equal(button.hidden, false);

    windowRef.dispatchEvent(new Event("appinstalled"));
    assert.equal(button.hidden, true);
});

test("no ofrece instalacion dentro de la PWA", () => {
    const windowRef = new FakeWindow(true);
    const button = new FakeButton();
    const event = new Event("beforeinstallprompt", { cancelable: true });

    event.prompt = async () => {};
    event.userChoice = Promise.resolve({ outcome: "accepted" });

    initPwaInstall({ button, windowRef });
    windowRef.dispatchEvent(event);

    assert.equal(event.defaultPrevented, false);
    assert.equal(button.hidden, true);
});
