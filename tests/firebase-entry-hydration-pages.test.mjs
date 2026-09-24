import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
    new URL("../js/firebaseAppState.js", import.meta.url),
    "utf8"
);

test("hidrata las entradas remotas en paginas acotadas y ordenadas", () => {
    assert.match(source, /const REMOTE_ENTRY_READ_BATCH_SIZE = 24/);
    assert.match(source, /orderBy\(firestoreModule\.documentId\(\)\)/);
    assert.match(source, /limit\(REMOTE_ENTRY_READ_BATCH_SIZE\)/);
    assert.match(source, /startAfter\(cursor\)/);
});

test("cede el hilo principal entre paginas sin omitir la ultima", () => {
    assert.match(
        source,
        /if \(snap\.docs\.length < REMOTE_ENTRY_READ_BATCH_SIZE\) break;[\s\S]*await yieldToMainThread\(\)/
    );
    assert.match(source, /firebase-app-state:hydrate-entry-page/);
});

test("cede el hilo durante la decodificacion de cada pagina", () => {
    assert.match(source, /for \(const docSnap of snap\.docs\)/);
    assert.match(
        source,
        /pageEntryCount \+= documentEntries\.length;\s*await yieldToMainThread\(\)/
    );
    assert.match(source, /duration: pageFinishedAt - pageStartedAt/);
    assert.match(source, /accumulatedEntryCount: entries\.length/);
});
