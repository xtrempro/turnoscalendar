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
        rotationSource,
        timelineSource,
        staffingSource,
        persistenceSource
    ] = await Promise.all([
        readFile(new URL("../js/calendar.js", import.meta.url), "utf8"),
        readFile(new URL("../js/main.js", import.meta.url), "utf8"),
        readFile(new URL("../js/firebaseAppState.js", import.meta.url), "utf8"),
        readFile(new URL("../js/rotationApply.js", import.meta.url), "utf8"),
        readFile(new URL("../js/timeline.js", import.meta.url), "utf8"),
        readFile(new URL("../js/staffing.js", import.meta.url), "utf8"),
        readFile(new URL("../js/persistence.js", import.meta.url), "utf8")
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
    assert.match(
        timelineSource,
        /openReplacementDialog\?\.\(\s*cell\.dataset\.replacementProfile,\s*cell\.dataset\.replacementKey/
    );
    assert.match(calendarSource, /showTimelinePendingMonth\(/);
    assert.match(calendarSource, /CALENDAR_CACHE_PREFIX/);
    assert.match(calendarSource, /CALENDAR_CACHE_WRITE_DELAY_MS/);
    assert.match(calendarSource, /CALENDAR_PARTIAL_BATCH_SIZE\s*=\s*5/);
    assert.match(calendarSource, /readCalendarCache/);
    assert.match(calendarSource, /writeCalendarCache/);
    assert.match(calendarSource, /activateCalendarCache/);
    assert.match(calendarSource, /backgroundFresh/);
    assert.match(calendarSource, /scheduleCalendarBackgroundFreshRender/);
    assert.match(calendarSource, /showCalendarBackgroundPending/);
    assert.match(calendarSource, /const renderPromise = renderCalendar\(renderOptions\)/);
    assert.doesNotMatch(calendarSource, /await renderCalendar\(renderOptions\);/);
    assert.match(calendarSource, /await waitCalendarIdle\(options\.deferHeavy \? 900 : 300\)/);
    assert.match(calendarSource, /await runDeferredTimelineUpdate\(\)/);
    assert.match(calendarSource, /await runDeferredStaffingUpdate\(\)/);
    assert.match(calendarSource, /scheduleActiveCalendarCacheWrite\(cal/);
    assert.match(calendarSource, /cooperativePartialRender/);
    assert.match(calendarSource, /calendarShiftAssignedResolver/);
    assert.match(calendarSource, /buildCalendarReplacementIndex/);
    assert.match(mainSource, /scheduleModeCalendarRefresh/);
    assert.match(mainSource, /cooperative:\s*true/);
    assert.match(calendarSource, /handleCalendarCellFallbackClick/);
    assert.match(timelineSource, /export function showTimelinePendingMonth\(/);
    assert.match(timelineSource, /dataset\.timelineMonthKey/);
    assert.match(timelineSource, /dataset\.timelineState = "pending"/);
    assert.doesNotMatch(timelineSource, /event\.target\.closest\("\[data-timeline-load-more\]"\)/);
    assert.doesNotMatch(timelineSource, /dataTimelineLoadMore/);
    assert.match(timelineSource, /data-timeline-filter-select/);
    assert.match(timelineSource, /function timelineCurrentProfileGroup/);
    assert.match(timelineSource, /selectedKey !== currentGroup\.key/);
    assert.match(timelineSource, /function syncTimelineActiveProfile/);
    assert.match(timelineSource, /is-current-calendar-profile/);
    assert.match(timelineSource, /TIMELINE_INITIAL_BATCH_SIZE\s*=\s*5/);
    assert.match(timelineSource, /TIMELINE_INCREMENTAL_BATCH_SIZE\s*=\s*5/);
    assert.match(timelineSource, /TIMELINE_CACHE_PREFIX/);
    assert.match(timelineSource, /TIMELINE_ROW_CACHE_PREFIX/);
    assert.match(timelineSource, /function orderTimelineProfiles/);
    assert.match(timelineSource, /function timelineSortContext\(year, month, diasMes, renderCache = null\)/);
    assert.match(timelineSource, /orderTimelineProfiles\(\s*grupo,\s*actual,\s*year,\s*month,\s*diasMes,\s*sortContext\s*\)/);
    assert.doesNotMatch(timelineSource, /viewSignature = \[\s*actual,/);
    assert.match(timelineSource, /timelineRowLimit = context\.orderedGroup\.length/);
    assert.doesNotMatch(
        timelineSource,
        /grupo\s*\.filter\(profile => profile\.name !== actual\)\s*\.sort\(\(a, b\) => a\.name\.localeCompare\(b\.name\)\)/
    );
    assert.match(timelineSource, /readTimelineRowCache/);
    assert.match(timelineSource, /writeTimelineRowCache/);
    assert.match(timelineSource, /createTimelineRow/);
    assert.match(timelineSource, /updateTimelineRow/);
    assert.match(timelineSource, /reconcileTimelineRows/);
    assert.match(timelineSource, /DocumentFragment/);
    assert.match(timelineSource, /readTimelineCache/);
    assert.match(timelineSource, /writeTimelineCache/);
    assert.match(calendarSource, /showInlineStaffingPendingMonth\?\.\(/);
    assert.match(staffingSource, /export function showInlineStaffingPendingMonth\(/);
    assert.match(staffingSource, /staffingAnalysisRequest\+\+/);
    assert.match(staffingSource, /dataset\.staffingReportState = "pending"/);
    assert.match(staffingSource, /STAFFING_REPORT_CACHE_PREFIX/);
    assert.doesNotMatch(staffingSource, /STAFFING_REPORT_CACHE_MAX_AGE_MS/);
    assert.match(staffingSource, /STAFFING_REPORT_PRELOAD_MONTHS_AHEAD\s*=\s*6/);
    assert.match(staffingSource, /STAFFING_REPORT_PAST_RETENTION_MONTHS\s*=\s*12/);
    assert.match(staffingSource, /readStaffingReportCache/);
    assert.match(staffingSource, /writeStaffingReportCache/);
    assert.match(staffingSource, /scheduleStaffingReportPreload/);
    assert.match(staffingSource, /STAFFING_WEEKLY_CACHE_PREFIX/);
    assert.match(staffingSource, /STAFFING_WEEKLY_PRELOAD_OFFSETS\s*=\s*\[0,\s*1,\s*-1,\s*2,\s*3\]/);
    assert.match(staffingSource, /readStaffingWeeklyCache/);
    assert.match(staffingSource, /writeStaffingWeeklyCache/);
    assert.match(staffingSource, /scheduleStaffingWeeklyPreload/);
    assert.match(calendarSource, /scheduleStaffingWeeklyPreload\?\.\(/);
    assert.match(persistenceSource, /"proturnos_ui_cache_"/);
    assert.match(
        calendarSource,
        /shouldContinue:\s*\(\)\s*=>\s*requestId === replacementCandidateRequest/
    );
    assert.doesNotMatch(
        calendarSource,
        /requestId === replacementCandidateRequest\s*&&\s*getCurrentProfile\(\) === profileName/
    );
});
