import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
    getAppFilters,
    getWorkerCalendarState,
    setAppFilters,
    syncWorkersState,
    syncWorkerCalendarState
} from "../js/appState.js";
import {
    diffCalendarRecordKeys,
    getCalendarCell,
    keysForCalendarRange,
    registerCalendarCell,
    replaceCalendarCell
} from "../js/calendarUpdates.js";
import {
    groupPartialStateEntries,
    mergePartialStateEntries,
    planPartialStateEntries
} from "../js/firebasePartialState.js";

test("el estado central conserva trabajadores, filtros, turnos y ausencias", () => {
    const worker = { id: "worker-1", name: "Ana" };

    syncWorkersState([worker]);
    setAppFilters("profiles", {
        role: "Profesional",
        query: "ana",
        showInactive: false
    });
    syncWorkerCalendarState({
        worker,
        year: 2026,
        month: 5,
        shifts: { "2026-5-10": 2 },
        absences: {
            admin: { "2026-5-11": 1 },
            legal: {},
            comp: {},
            absences: {}
        }
    });

    assert.equal(getAppFilters("profiles").role, "Profesional");
    assert.equal(getWorkerCalendarState("worker-1").shifts["2026-5-10"], 2);
    assert.equal(
        getWorkerCalendarState("worker-1").absences.admin["2026-5-11"],
        1
    );
});

test("el registro DOM reemplaza solo la celda solicitada", () => {
    let replacement = null;
    const previous = {
        isConnected: true,
        replaceWith(next) {
            replacement = next;
        }
    };
    const next = { id: "next-cell" };

    registerCalendarCell("worker-1", "2026-5-10", previous);

    assert.equal(
        replaceCalendarCell("worker-1", "2026-5-10", next),
        true
    );
    assert.equal(replacement, next);
    assert.equal(getCalendarCell("worker-1", "2026-5-10"), next);
});

test("detecta únicamente fechas modificadas y rangos locales", () => {
    assert.deepEqual(
        diffCalendarRecordKeys(
            { "2026-5-1": 1, "2026-5-2": 2 },
            { "2026-5-1": 1, "2026-5-2": 3 }
        ),
        ["2026-5-2"]
    );
    assert.deepEqual(
        keysForCalendarRange("2026-06-29", "2026-07-01"),
        ["2026-5-29", "2026-5-30", "2026-6-1"]
    );
});

test("Firestore recibe un delta por día y no el calendario completo", () => {
    const previous = JSON.stringify({
        "2026-5-1": 1,
        "2026-5-2": 2
    });
    const next = JSON.stringify({
        "2026-5-1": 1,
        "2026-5-2": 3
    });
    const entries = planPartialStateEntries({
        keys: ["data_Ana"],
        changes: {
            data_Ana: { previous, next }
        },
        moduleForKey: () => "turnos"
    });

    assert.deepEqual(entries, [{
        moduleId: "turnos",
        storageKey: "data_Ana",
        itemKey: "2026-5-2",
        value: "3",
        deleted: false
    }]);

    assert.deepEqual(groupPartialStateEntries(entries), [{
        moduleId: "turnos",
        storageKey: "data_Ana",
        items: {
            "2026-5-2": "3"
        },
        deletedItems: {
            "2026-5-2": false
        }
    }]);

    const snapshot = { data_Ana: previous };
    mergePartialStateEntries(snapshot, entries);
    assert.deepEqual(JSON.parse(snapshot.data_Ana), {
        "2026-5-1": 1,
        "2026-5-2": 3
    });
});

test("un calendario extenso sigue produciendo un solo delta", () => {
    const previous = Object.fromEntries(
        Array.from({ length: 730 }, (_item, index) => [
            `day-${index}`,
            index % 5
        ])
    );
    const next = {
        ...previous,
        "day-500": 8
    };
    const entries = planPartialStateEntries({
        keys: ["data_worker_100"],
        changes: {
            data_worker_100: {
                previous: JSON.stringify(previous),
                next: JSON.stringify(next)
            }
        },
        moduleForKey: () => "turnos"
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].itemKey, "day-500");
    assert.equal(entries[0].value, "8");
});

test("el calendario usa delegación y una ruta de render parcial", async () => {
    const [
        calendarSource,
        mainSource,
        firebaseSource,
        rotationSource
    ] = await Promise.all([
        readFile(new URL("../js/calendar.js", import.meta.url), "utf8"),
        readFile(new URL("../js/main.js", import.meta.url), "utf8"),
        readFile(new URL("../js/firebaseAppState.js", import.meta.url), "utf8"),
        readFile(new URL("../js/rotationApply.js", import.meta.url), "utf8")
    ]);

    assert.match(calendarSource, /delegatedCalendar\.addEventListener\("click"/);
    assert.doesNotMatch(calendarSource, /div\.onclick\s*=/);
    assert.match(calendarSource, /replaceCalendarCell\(activeWorkerId, keyDay, div\)/);
    assert.match(calendarSource, /export async function updateDayCells\(/);
    assert.match(calendarSource, /renderCalendar\(\{\s*changedKeys,/);
    assert.match(mainSource, /setCalendarSelectionHandler\(/);
    assert.match(mainSource, /updateDayCells\(/);
    assert.doesNotMatch(
        mainSource,
        /document\.addEventListener\("click", async event => \{\s*const celda/
    );
    assert.match(firebaseSource, /planPartialStateEntries\(/);
    assert.match(firebaseSource, /moduleEntriesCollection\(/);
    assert.doesNotMatch(
        firebaseSource,
        /async function uploadModule|scheduleAppStateUpload/
    );
    assert.doesNotMatch(rotationSource, /refreshAll/);
    assert.match(rotationSource, /updateVisibleCalendarDays/);
});
