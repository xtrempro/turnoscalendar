import test from "node:test";
import assert from "node:assert/strict";
import { performWorkerAppUnlink } from "../js/workerAppUnlink.js";

test("no altera el enlace cuando se cancela la confirmacion", async () => {
    const button = { disabled: false };
    let unlinkCalls = 0;

    const result = await performWorkerAppUnlink({
        button,
        confirm: async () => false,
        unlink: async () => { unlinkCalls += 1; }
    });

    assert.equal(result, false);
    assert.equal(unlinkCalls, 0);
    assert.equal(button.disabled, false);
});

test("continua el desenlace despues de una confirmacion asincrona", async () => {
    const button = { disabled: false };
    const calls = [];

    const result = await performWorkerAppUnlink({
        button,
        confirm: async () => {
            await Promise.resolve();
            calls.push("confirmed");
            return true;
        },
        unlink: async () => { calls.push("unlinked"); },
        onSuccess: () => { calls.push("success"); }
    });

    assert.equal(result, true);
    assert.equal(button.disabled, true);
    assert.deepEqual(calls, ["confirmed", "unlinked", "success"]);
});

test("restaura el boton y comunica el error si Firestore rechaza la operacion", async () => {
    const button = { disabled: false };
    const expected = new Error("permission-denied");
    let received = null;

    const result = await performWorkerAppUnlink({
        button,
        confirm: async () => true,
        unlink: async () => { throw expected; },
        onError: error => { received = error; }
    });

    assert.equal(result, false);
    assert.equal(button.disabled, false);
    assert.equal(received, expected);
});
