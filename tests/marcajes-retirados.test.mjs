import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stateModuleIds } from "../js/firebaseStateModules.js";
import { MENU_PERMISSION_DEFS } from "../js/workspacePermissions.js";
import { HOME_CARD_IDS } from "../js/homeLayout.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");
const home = await readFile(new URL("../js/home.js", import.meta.url), "utf8");

test("Marcajes ya no existe como menu, panel, importador ni modulo remoto", () => {
    assert.doesNotMatch(html, /data-target="clockMarksPanel"/);
    assert.doesNotMatch(html, /id="clockMarksPanel"/);
    assert.doesNotMatch(html, /id="attendanceImportInput"/);
    assert.equal(MENU_PERMISSION_DEFS.some(item => item.key === "clockmarks"), false);
    assert.equal(stateModuleIds().includes("clockmarks"), false);
});

test("Inicio tampoco conserva la tarjeta ni el modal de Marcajes", () => {
    assert.equal(HOME_CARD_IDS.includes("incidencias"), false);
    assert.doesNotMatch(home, /incidencias:\s*incidenciasWidget/);
    assert.doesNotMatch(home, /<div[^>]+data-hm="inc-modal"/);
    assert.doesNotMatch(home, /iniciarNotas\(panel\);\s*void cargarIncidencias/);
});

test("el arranque elimina copias locales retiradas", () => {
    assert.match(main, /const RETIRED_CLOCKMARK_KEYS = new Set/);
    assert.match(main, /startsWith\("clockMarks_"\)/);
    assert.match(main, /purgeRetiredClockmarkState\(\)/);
});
