import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { guardMemoEntryDocuments } from "../js/firebaseAppState.js";
import { shouldUploadWorkerRequest } from "../js/firebaseWorkerRequests.js";

function memoRaw(documents = [], deletedDocumentIds = []) {
    return JSON.stringify({
        id: "swap:uno",
        sourceId: "swap:uno",
        documents,
        deletedDocumentIds
    });
}

function document(id) {
    return {
        id,
        name: `${id}.pdf`,
        storagePath: `workspaces/test/attachments/memos/${id}`
    };
}

test("una copia pendiente no degrada una solicitud ya resuelta", () => {
    assert.equal(
        shouldUploadWorkerRequest(
            { id: "solicitud-1", status: "pending" },
            { id: "solicitud-1", status: "accepted" }
        ),
        false
    );
    assert.equal(
        shouldUploadWorkerRequest(
            { id: "solicitud-1", status: "accepted" },
            { id: "solicitud-1", status: "accepted" }
        ),
        true
    );
});

test("dos adjuntos concurrentes sobreviven en el mismo memorandum", () => {
    const guarded = guardMemoEntryDocuments(
        {
            moduleId: "memos",
            storageKey: "memos",
            items: { "swap%3Auno": memoRaw([document("local")]) },
            deletedItems: { "swap%3Auno": false }
        },
        {
            items: { "swap%3Auno": memoRaw([document("remoto")]) },
            deletedItems: { "swap%3Auno": false }
        }
    );
    const merged = JSON.parse(guarded.items["swap%3Auno"]);

    assert.deepEqual(
        merged.documents.map(item => item.id).sort(),
        ["local", "remoto"]
    );
    assert.equal(merged.status, "completed");
});

test("una eliminacion concurrente no resucita el archivo", () => {
    const guarded = guardMemoEntryDocuments(
        {
            moduleId: "memos",
            storageKey: "memos",
            items: {
                "swap%3Auno": memoRaw([document("nuevo")], ["eliminado"])
            },
            deletedItems: { "swap%3Auno": false }
        },
        {
            items: {
                "swap%3Auno": memoRaw([
                    document("eliminado"),
                    document("remoto")
                ])
            },
            deletedItems: { "swap%3Auno": false }
        }
    );
    const merged = JSON.parse(guarded.items["swap%3Auno"]);

    assert.deepEqual(
        merged.documents.map(item => item.id).sort(),
        ["nuevo", "remoto"]
    );
    assert.deepEqual(merged.deletedDocumentIds, ["eliminado"]);
});

test("la solicitud usa un id de cambio idempotente y una reserva remota", async () => {
    const source = await readFile(
        new URL("../js/workerRequests.js", import.meta.url),
        "utf8"
    );

    assert.match(source, /id: `worker_request:\$\{request\.id\}`/);
    assert.match(source, /await claimWorkerRequestResolution\(request\)/);
    assert.match(source, /await finishWorkerRequestResolution\(/);
});

test("el panel abierto repinta cuando cambia el memorandum remoto", async () => {
    const source = await readFile(
        new URL("../js/main.js", import.meta.url),
        "utf8"
    );

    assert.match(
        source,
        /activeView === "swap"[\s\S]{0,120}renderSwapPanel\(\)/
    );
    assert.match(
        source,
        /detail\.keys\?\.includes\("memos"\)[\s\S]{0,180}proturnos:memosChanged/
    );
});
