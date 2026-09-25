import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sync = readFileSync("js/firebaseReplacementRecords.js", "utf8");
const main = readFileSync("js/main.js", "utf8");
const shell = readFileSync("js/firebaseShell.js", "utf8");
const workspaces = readFileSync("js/workspaces.js", "utf8");

test("la marca de reemplazos viaja desde el documento de unidad", () => {
    assert.match(
        workspaces,
        /replacementStorage: String\(data\.replacementStorage \|\| ""\)/
    );
    assert.match(
        shell,
        /replacementStorage: info\?\.replacementStorage \|\| ""/
    );
    assert.match(
        shell,
        /currentWorkspace = refreshedWorkspace \|\| storedWorkspace/
    );
    assert.match(shell, /setActiveWorkspace\(refreshedWorkspace\)/);
});

test("el modo sombra exige una marca explicita", () => {
    assert.match(sync, /const SHADOW_STORAGE = "records-shadow-v1"/);
    assert.match(
        sync,
        /workspace\.replacementStorage !== SHADOW_STORAGE/
    );
});

test("la coleccion sombra nunca reemplaza el estado local", () => {
    assert.doesNotMatch(sync, /saveReplacements|setJSON\(\s*["']replacements/);
    assert.match(sync, /const localRecords = getReplacements\(\)/);
    assert.match(sync, /deletedIds: \[\]/);
});

test("la reconciliacion completa ocurre solo en el primer snapshot", () => {
    assert.match(sync, /initialReconciliationPending = true/);
    assert.match(
        sync,
        /initialReconciliationPending &&[\s\S]*discrepancy\.upserts\.length/
    );
    assert.match(sync, /initialReconciliationPending = false/);
});

test("los cambios locales generan upserts y tombstones individuales", () => {
    assert.match(sync, /diffReplacementRecords\(records\.previous, records\.next\)/);
    assert.match(sync, /replacementRecordPayload\(operation\.record, options\)/);
    assert.match(sync, /replacementRecordTombstone\(recordId, options\)/);
    assert.match(sync, /const WRITE_BATCH_SIZE = 400/);
});

test("el modo sombra arranca tras hidratar y se detiene al salir", () => {
    assert.match(
        main,
        /estadoHidratado\.then\(\(\) => \{[\s\S]*startFirebaseReplacementRecordShadowSync\(workspace\)/
    );
    assert.match(main, /stopFirebaseReplacementRecordShadowSync\(\)/);
});
