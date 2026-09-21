import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const firebaseShell = readFileSync("js/firebaseShell.js", "utf8");
const main = readFileSync("js/main.js", "utf8");
const calendar = readFileSync("js/calendar.js", "utf8");

test("escucha cambios en unidades del usuario autenticado", () => {
    assert.match(firebaseShell, /startUserWorkspacesListener/);
    assert.match(firebaseShell, /stopUserWorkspacesListener/);
    assert.match(
        firebaseShell,
        /"users"[\s\S]*user\.uid[\s\S]*"workspaces"/
    );
    assert.match(firebaseShell, /onSnapshot/);
    assert.match(firebaseShell, /handleUserWorkspacesChanged/);
});

test("activa automaticamente la unica unidad disponible", () => {
    assert.match(firebaseShell, /maybeActivateSingleWorkspace/);
    assert.match(firebaseShell, /workspaceList\.length !== 1/);
    assert.match(firebaseShell, /activateWorkspace\(workspaceList\[0\]\)/);
    assert.match(firebaseShell, /await maybeActivateSingleWorkspace\(\)/);
});

test("el boton Usar reutiliza la misma activacion de unidad", () => {
    assert.match(
        firebaseShell,
        /data-workspace-select[\s\S]*await activateWorkspace\(workspace\)/
    );
});

test("cambiar de unidad no repinta con datos del entorno anterior", () => {
    assert.match(
        firebaseShell,
        /await options\.onWorkspaceChange\?\.\(null,\s*\{\s*skipViewRefresh: true\s*\}\);\s*\n\s*replaceLocalSnapshot\(\{\}, \{ silent: true \}\);\s*\n\s*await options\.onWorkspaceChange\?\.\(currentWorkspace\)/
    );
    assert.match(
        main,
        /if \(changeOptions\.skipViewRefresh === true\) \{\s*\n\s*return;\s*\n\s*\}\s*\n\s*syncWorkspaceStateViews\(\);/
    );
});

test("la vista se refresca despues de hidratar la unidad nueva", () => {
    assert.match(
        main,
        /await measurePerformance\(\s*"firebase-app-state:start-sync"/
    );
    assert.doesNotMatch(
        main,
        /void measurePerformance\(\s*"firebase-app-state:start-sync"/
    );
});

test("el calendario invalida cache al aplicar la foto inicial del entorno", () => {
    assert.match(
        calendar,
        /event\.detail\?\.type === "app-state-applied"[\s\S]{0,220}clearCalendarCache\(\);[\s\S]{0,260}skipCache: true/
    );
});
