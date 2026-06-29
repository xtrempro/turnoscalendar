import test from "node:test";
import assert from "node:assert/strict";

import {
    diffWorkerLinks,
    planWorkerLinkSnapshot,
    runCooperativeQueue
} from "../js/workerAppPublishQueue.js";

function buildLink(index, overrides = {}) {
    return {
        uid: `worker-${index}`,
        profileName: `Trabajador ${index}`,
        profileRut: `${10000000 + index}-K`,
        workerEmail: `worker${index}@example.com`,
        workspaceName: "Entorno QA",
        status: "active",
        ...overrides
    };
}

test("detecta solo enlaces PWA agregados, modificados o eliminados", () => {
    const previous = [buildLink(1), buildLink(2), buildLink(3)];
    const next = [
        buildLink(1, { updatedAtISO: "campo irrelevante" }),
        buildLink(2, { workerEmail: "nuevo@example.com" }),
        buildLink(4)
    ];

    const result = diffWorkerLinks(previous, next);

    assert.deepEqual(result.changedUids.sort(), ["worker-2", "worker-4"]);
    assert.deepEqual(result.removedUids, ["worker-3"]);
});

test("un snapshot sin cambios no provoca republicaciones", () => {
    const links = Array.from({ length: 100 }, (_, index) => buildLink(index));
    const reordered = [...links].reverse();

    assert.deepEqual(diffWorkerLinks(links, reordered), {
        changedUids: [],
        removedUids: []
    });
});

test("el snapshot inicial de 100 enlaces hidrata sin publicar", () => {
    const links = Array.from({ length: 100 }, (_, index) => buildLink(index));
    const plan = planWorkerLinkSnapshot([], links, false);

    assert.equal(plan.initial, true);
    assert.equal(plan.changedUids.length, 100);
    assert.equal(plan.shouldPublish, false);
});

test("la cola de 100 trabajadores procesa uno por vez y cede el hilo", async () => {
    const workers = Array.from({ length: 100 }, (_, index) => index);
    let active = 0;
    let maxActive = 0;
    let yields = 0;
    const processed = [];

    const result = await runCooperativeQueue(
        workers,
        async worker => {
            active++;
            maxActive = Math.max(maxActive, active);
            await Promise.resolve();
            processed.push(worker);
            active--;
        },
        {
            yieldControl: async () => {
                yields++;
            }
        }
    );

    assert.equal(result.completed, true);
    assert.equal(result.processed, 100);
    assert.equal(processed.length, 100);
    assert.equal(maxActive, 1);
    assert.equal(yields, 99);
});

test("la cola se cancela al cambiar de entorno", async () => {
    let currentWorkspace = true;
    const processed = [];

    const result = await runCooperativeQueue(
        [1, 2, 3, 4],
        item => {
            processed.push(item);
        },
        {
            shouldContinue: () => currentWorkspace,
            yieldControl: async () => {
                currentWorkspace = false;
            }
        }
    );

    assert.deepEqual(processed, [1]);
    assert.deepEqual(result, { completed: false, processed: 1 });
});
