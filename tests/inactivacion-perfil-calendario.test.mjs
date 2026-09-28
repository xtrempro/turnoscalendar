import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { TURN, scheduledTurn, actualTurn } = require(
    "../functions/lib/turnEngine.js"
);

test("el ultimo dia conserva su turno y los posteriores quedan libres", () => {
    const state = {
        profiles: [{ name: "Camila", unitExitDate: "2026-09-24" }],
        rotativa_Camila: {
            type: "diurno",
            start: "2026-09-01"
        },
        data_Camila: {
            "2026-8-25": TURN.LONG
        },
        replacements: [{
            id: "future-cover",
            worker: "Camila",
            replaced: "Otra persona",
            date: "2026-09-25",
            turno: TURN.LONG,
            status: "active"
        }]
    };

    assert.equal(scheduledTurn(state, "Camila", "2026-09-24"), TURN.DAY);
    assert.equal(scheduledTurn(state, "Camila", "2026-09-25"), TURN.FREE);
    assert.equal(actualTurn(state, "Camila", "2026-09-25"), TURN.FREE);
});

test("guardar una inactivacion exige fecha y limpia desde el dia siguiente", async () => {
    const source = await readFile(
        new URL("../js/main.js", import.meta.url),
        "utf8"
    );

    assert.match(
        source,
        /inactivationLastDate = await requestProfileInactivationDate\(\s*profileDraft\.originalName,\s*nextName/
    );
    assert.match(
        source,
        /cleanupFutureSchedule\(parseInputDate\(cleanupStart\), \{\s*preserveProtectedLeaves: false/
    );
    assert.match(
        source,
        /cancelFutureWorkerRequests\(\s*nextName,\s*cleanupStart/
    );
    assert.match(
        source,
        /nextProfilePayload\.unitExitDate = inactivationLastDate/
    );
});
