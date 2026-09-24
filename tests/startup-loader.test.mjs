import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../js/main.js", import.meta.url), "utf8");

test("muestra una barra hasta que la vista inicial queda preparada", () => {
    assert.match(html, /id="appStartupLoader"/);
    assert.match(html, /class="theme-dark app-is-starting"/);
    assert.match(html, /Preparando tu unidad/);
    assert.match(main, /Promise\.all\(\[startupViewReady, initialWorkspaceStartup\]\)[\s\S]*\.finally\(finishAppStartup\)/);
});

test("libera la interfaz aunque falle la preparacion inicial", () => {
    assert.match(main, /startupViewReady = setActiveShortcut[\s\S]*\.catch\(error =>/);
    assert.match(main, /document\.body\.removeAttribute\("aria-busy"\)/);
});

test("espera la hidratacion, el refresco de la unidad y el repintado", () => {
    assert.match(main, /estadoHidratado\.then\(async \(\) =>/);
    assert.match(main, /refrescarVistasDelEntorno\(\);[\s\S]*await settleInitialWorkspaceStartup\(\)/);
    assert.match(main, /requestAnimationFrame\(\(\) => \{[\s\S]*requestAnimationFrame/);
});
