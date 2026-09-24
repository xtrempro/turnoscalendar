import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const timeline = readFileSync("js/timeline.js", "utf8");

test("el timeline no pide de nuevo el motivo en un dia de cambio de turno", () => {
    assert.match(
        timeline,
        /const turnChangeKeys = timelineTurnChangeKeys\(profileName, swaps\)/
    );
    assert.match(
        timeline,
        /const turnChange = rowAux\?\.turnChangeKeys\?\.has\(key\) \|\| false/
    );
    assert.match(
        timeline,
        /const showExtraReason =[\s\S]{0,160}!turnChange &&[\s\S]{0,80}pendingManualExtra/
    );
});

test("el cambio invalida las filas antiguas que conservaban el signo", () => {
    assert.match(timeline, /const TIMELINE_CACHE_VERSION = 5/);
});
