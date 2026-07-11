"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FieldValue } = require("firebase-admin/firestore");
const {
    writeProjection,
    splitDaysByMonth,
    monthDaysHash
} = require("../lib/projectionWriter");

function makeDb() {
    const writes = [];
    const docRef = (path) => ({
        _path: path,
        collection: (name) => colRef(`${path}/${name}`)
    });
    const colRef = (path) => ({
        _path: path,
        doc: (id) => docRef(`${path}/${id}`)
    });
    const batch = {
        set(ref, data, opts) { writes.push({ path: ref._path, data, opts }); },
        async commit() {}
    };

    return {
        writes,
        collection: (name) => colRef(name),
        batch: () => batch
    };
}

test("splitDaysByMonth agrupa por YYYY-MM y descarta claves inválidas", () => {
    const months = splitDaysByMonth({
        "2026-01-31": { iso: "2026-01-31" },
        "2026-02-01": { iso: "2026-02-01" },
        "bad": { iso: "bad" }
    });

    assert.deepEqual(Object.keys(months).sort(), ["2026-01", "2026-02"]);
    assert.equal(Object.keys(months["2026-01"]).length, 1);
});

test("monthDaysHash es estable e independiente del orden de claves", () => {
    const a = monthDaysHash({ "2026-01-01": { turno: 1 }, "2026-01-02": { turno: 2 } });
    const b = monthDaysHash({ "2026-01-02": { turno: 2 }, "2026-01-01": { turno: 1 } });

    assert.equal(a, b);
});

test("writeProjection escribe un doc por mes y el doc raíz sin days", async () => {
    const db = makeDb();
    const payload = {
        profileName: "Ana",
        profileRut: "11.111.111-1",
        updatedAtISO: "2026-01-15T00:00:00.000Z",
        status: "active",
        overtimeSummaries: [{ year: 2026, month: 0 }],
        exceptionsJson: "{}",
        reportsByMonth: { "2026-0": "<html>" },
        days: {
            "2026-01-31": { iso: "2026-01-31", turno: 1 },
            "2026-02-01": { iso: "2026-02-01", turno: 2 }
        }
    };

    const result = await writeProjection(db, "w1", "u1", payload);

    assert.deepEqual(result.availableMonths, ["2026-01", "2026-02"]);
    assert.deepEqual(Object.keys(result.monthHashes).sort(), ["2026-01", "2026-02"]);

    const monthWrites = db.writes.filter(w => w.path.includes("/months/"));
    assert.equal(monthWrites.length, 2, "debe escribir un doc por mes");
    assert.ok(
        monthWrites.every(w => w.data.days && typeof w.data.days === "object"),
        "cada mes lleva sus días"
    );

    const rootWrite = db.writes.find(w =>
        w.path === "workspaces/w1/workerAppData/u1"
    );
    assert.ok(rootWrite, "debe escribir el doc raíz");
    assert.equal(rootWrite.data.days, FieldValue.delete(), "el raíz borra days");
    assert.equal(rootWrite.data.profileName, "Ana");
    assert.equal(rootWrite.data.hasMonthlyCalendar, true);
    assert.deepEqual(rootWrite.data.availableMonths, ["2026-01", "2026-02"]);
    assert.ok(rootWrite.data.reportsByMonth, "el raíz conserva reportsByMonth");
    assert.ok(Array.isArray(rootWrite.data.overtimeSummaries));
});
