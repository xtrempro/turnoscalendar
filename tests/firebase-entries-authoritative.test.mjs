import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appState = readFileSync("js/firebaseAppState.js", "utf8");
const shell = readFileSync("js/firebaseShell.js", "utf8");
const workspaces = readFileSync("js/workspaces.js", "utf8");

test("la marca de almacenamiento viaja desde el documento raiz", () => {
    assert.match(workspaces, /stateStorage: String\(data\.stateStorage \|\| ""\)/);
    assert.match(shell, /stateStorage: info\?\.stateStorage \|\| ""/);
});

test("solo entries-v1 omite los manifiestos heredados", () => {
    assert.match(
        appState,
        /String\(workspace\?\.stateStorage \|\| ""\) === "entries-v1"/
    );
    assert.match(
        appState,
        /const ownerManifestPromise =\s*!entriesAreAuthoritative && isWorkspaceOwner\(\)/
    );
    assert.match(
        appState,
        /const moduleReads = entriesAreAuthoritative\s*\? moduleRefs\.map/
    );
});
