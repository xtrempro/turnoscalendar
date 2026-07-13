import test from "node:test";
import assert from "node:assert/strict";

const {
    buildCalendarChangeEventFromStorageMutation,
    changedCalendarKeysFromRawMutation,
    normalizeAffectedDates
} = await import("../js/calendarChangeEvents.js");

test("detecta fechas modificadas en mapas de calendario", () => {
    const change = {
        previous: JSON.stringify({
            "2026-6-18": 0,
            "2026-6-19": 1
        }),
        next: JSON.stringify({
            "2026-6-18": 1,
            "2026-6-19": 1,
            "2026-6-20": 2
        })
    };

    assert.deepEqual(
        changedCalendarKeysFromRawMutation(change),
        ["2026-6-18", "2026-6-20"]
    );
    assert.deepEqual(
        normalizeAffectedDates(changedCalendarKeysFromRawMutation(change)),
        ["2026-07-18", "2026-07-20"]
    );
});

test("clasifica una edicion manual de turno como cambio de calendario", () => {
    const metadata = buildCalendarChangeEventFromStorageMutation({
        storageKey: "data_Ana",
        change: {
            previous: JSON.stringify({ "2026-6-18": 0 }),
            next: JSON.stringify({ "2026-6-18": 1 })
        }
    });

    assert.equal(metadata.changeType, "shift_added");
    assert.equal(metadata.source, "main_calendar_manual_edit");
    assert.deepEqual(metadata.affectedDates, ["2026-07-18"]);
});

test("clasifica rotativa como evento agrupado sin recorrer dias", () => {
    const metadata = buildCalendarChangeEventFromStorageMutation({
        storageKey: "rotativa_Ana",
        change: {
            previous: JSON.stringify({ type: "4turno" }),
            next: JSON.stringify({ type: "diurno" })
        }
    });

    assert.equal(metadata.changeType, "rotation_changed");
    assert.equal(metadata.source, "rotation_generator");
    assert.deepEqual(metadata.affectedDates, []);
});

test("la edicion directa difiere notificaciones hasta cerrar el switch", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
        new URL("../js/workerAppDataSync.js", import.meta.url),
        "utf8"
    );

    assert.match(source, /function shouldDeferDirectEditCalendarEvent/);
    assert.match(source, /window\.calendarDirectEditEnabled\(\)/);
    assert.match(
        source,
        /shouldDeferDirectEditCalendarEvent\(metadata\)[\s\S]{0,120}continue;/
    );
});
