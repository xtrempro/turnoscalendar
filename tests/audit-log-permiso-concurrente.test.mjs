import test from "node:test";
import assert from "node:assert/strict";

import {
    AUDIT_CATEGORY,
    equivalentActiveLeaveLogs
} from "../js/auditLog.js";

const leave = (id, profile, date, type = "admin", extra = {}) => ({
    id,
    category: AUDIT_CATEGORY.LEAVE_ABSENCE,
    profile,
    createdAt: `2026-09-25T10:32:2${id}.000Z`,
    meta: { profile, date, type, amount: 1 },
    ...extra
});

test("agrupa permisos concurrentes equivalentes para anularlos juntos", () => {
    const source = leave("1", "LUIS AINOL RAMIREZ", "2026-09-02");
    const duplicate = leave("2", "LUIS AINOL RAMIREZ", "2026-09-02");
    const otherDate = leave("3", "LUIS AINOL RAMIREZ", "2026-09-03");
    const otherType = leave("4", "LUIS AINOL RAMIREZ", "2026-09-02", "legal");
    const alreadyCanceled = leave(
        "5",
        "LUIS AINOL RAMIREZ",
        "2026-09-02",
        "admin",
        { canceledAt: "2026-09-25T10:33:30.000Z" }
    );

    assert.deepEqual(
        equivalentActiveLeaveLogs(
            [source, duplicate, otherDate, otherType, alreadyCanceled],
            source
        ).map(log => log.id),
        ["1", "2"]
    );
});

test("no agrupa acciones que no son permisos anulables", () => {
    const calendarLog = {
        id: "calendar",
        category: AUDIT_CATEGORY.CALENDAR,
        profile: "LUIS AINOL RAMIREZ",
        createdAt: "2026-09-25T10:32:20.000Z",
        meta: { date: "2026-09-02", type: "admin" }
    };

    assert.deepEqual(equivalentActiveLeaveLogs([calendarLog], calendarLog), []);
});
