import test from "node:test";
import assert from "node:assert/strict";

import {
    runCooperativeRange,
    scheduleIdleTask
} from "../js/mainThreadScheduler.js";

test("divide un mes completo y cede el hilo entre cada dia", async () => {
    const days = [];
    let yields = 0;

    const result = await runCooperativeRange(
        1,
        31,
        day => days.push(day),
        {
            yieldControl: async () => {
                yields++;
            }
        }
    );

    assert.equal(result.completed, true);
    assert.equal(result.processed, 31);
    assert.equal(days.length, 31);
    assert.equal(yields, 30);
});

test("cancela el calculo cooperativo cuando cambia la vista", async () => {
    let active = true;
    const days = [];

    const result = await runCooperativeRange(
        1,
        31,
        day => days.push(day),
        {
            shouldContinue: () => active,
            yieldControl: async () => {
                active = false;
            }
        }
    );

    assert.deepEqual(days, [1]);
    assert.deepEqual(result, { completed: false, processed: 1 });
});

test("una tarea diferida cancelada no llega a ejecutarse", async () => {
    let called = false;
    const cancel = scheduleIdleTask(() => {
        called = true;
    });

    cancel();
    await new Promise(resolve => setTimeout(resolve, 10));

    assert.equal(called, false);
});
