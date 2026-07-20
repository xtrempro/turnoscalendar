import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const firebaseShell = readFileSync("js/firebaseShell.js", "utf8");

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
