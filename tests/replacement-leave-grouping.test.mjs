import assert from "node:assert/strict";
import test from "node:test";
import {
    groupContinuousReplacementLeaveKeys
} from "../js/replacementLeaveGrouping.js";

test("mantiene unido un F. Legal que incluye el fin de semana", () => {
    const keys = [
        "2026-6-8",
        "2026-6-9",
        "2026-6-10",
        "2026-6-11",
        "2026-6-12",
        "2026-6-13",
        "2026-6-14"
    ];

    assert.deepEqual(
        groupContinuousReplacementLeaveKeys(keys, {
            businessContinuity: true
        }),
        [keys]
    );
});

test("tambien une bloques que solo almacenan dias habiles", () => {
    const keys = [
        "2026-6-8",
        "2026-6-9",
        "2026-6-10",
        "2026-6-13",
        "2026-6-14"
    ];

    assert.deepEqual(
        groupContinuousReplacementLeaveKeys(keys, {
            businessContinuity: true
        }),
        [keys]
    );
});

test("separa permisos distintos cuando falta un dia habil", () => {
    assert.deepEqual(
        groupContinuousReplacementLeaveKeys([
            "2026-6-8",
            "2026-6-9",
            "2026-6-13"
        ], {
            businessContinuity: true
        }),
        [
            ["2026-6-8", "2026-6-9"],
            ["2026-6-13"]
        ]
    );
});
