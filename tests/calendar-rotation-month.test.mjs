import test from "node:test";
import assert from "node:assert/strict";
import { getRotationSelectionMonth } from "../js/rotationUtils.js";

test("Modificar rotativa conserva el mes visible del calendario", () => {
    const visibleCalendarDate = new Date(2031, 10, 18);

    assert.deepEqual(
        getRotationSelectionMonth(visibleCalendarDate),
        { year: 2031, month: 10 }
    );
});

test("conserva correctamente meses en los limites del ano", () => {
    assert.deepEqual(
        getRotationSelectionMonth(new Date(2028, 0, 1)),
        { year: 2028, month: 0 }
    );
    assert.deepEqual(
        getRotationSelectionMonth(new Date(2028, 11, 31)),
        { year: 2028, month: 11 }
    );
});
