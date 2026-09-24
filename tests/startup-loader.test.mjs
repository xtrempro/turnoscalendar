import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../js/main.js", import.meta.url), "utf8");

test("muestra una barra hasta que la vista inicial queda preparada", () => {
    assert.match(html, /id="appStartupLoader"/);
    assert.match(html, /class="theme-dark app-is-starting"/);
    assert.match(html, /Preparando tu unidad/);
    assert.match(main, /setActiveShortcut\(startupTarget[\s\S]*\.finally\(finishAppStartup\)/);
});

test("libera la interfaz aunque falle la preparacion inicial", () => {
    assert.match(main, /\.catch\(error =>[\s\S]*\.finally\(finishAppStartup\)/);
    assert.match(main, /document\.body\.removeAttribute\("aria-busy"\)/);
});
