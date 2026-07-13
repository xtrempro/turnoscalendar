import assert from "node:assert/strict";
import test from "node:test";
import {
    splitSnapshotByStateModule,
    stateModuleForKey,
    stateModulePermission
} from "../js/firebaseStateModules.js";
import {
    isWorkerCalendarUrgentStateKey
} from "../js/firebaseAppState.js";

test("clasifica las claves persistidas por modulo de seguridad", () => {
    const cases = {
        profiles: "profile",
        baseData_worker_1: "profile",
        shiftAssignmentHistory_worker_1: "profile",
        data_worker_1: "turnos",
        absences_worker_1: "turnos",
        clockMarks_worker_1: "clockmarks",
        workerRequests: "requests",
        memos: "memos",
        shiftMoves: "swap",
        carry_worker_1: "hours",
        staffing_applicants: "weekly",
        weekly_task_assignment_entries: "tasks",
        agenda_contacts: "agenda",
        reportSignatureConfig: "reports",
        auditLog: "log",
        unknown_sensitive_setting: "system"
    };

    Object.entries(cases).forEach(([key, expected]) => {
        assert.equal(stateModuleForKey(key), expected, key);
    });
});

test("las claves desconocidas quedan reservadas al propietario", () => {
    assert.equal(stateModulePermission("system"), "owner");
    assert.equal(stateModulePermission("does-not-exist"), "owner");
});

test("divide un snapshot sin mezclar permisos", () => {
    const modules = splitSnapshotByStateModule({
        profiles: [{ id: "worker-1" }],
        data_worker_1: { "2026-06-25": "L" },
        memos: [{ id: "memo-1" }],
        unknown_sensitive_setting: true
    });

    assert.deepEqual(Object.keys(modules).sort(), [
        "memos",
        "profile",
        "system",
        "turnos"
    ]);
    assert.deepEqual(Object.keys(modules.profile), ["profiles"]);
    assert.deepEqual(Object.keys(modules.turnos), ["data_worker_1"]);
    assert.deepEqual(Object.keys(modules.memos), ["memos"]);
    assert.deepEqual(
        Object.keys(modules.system),
        ["unknown_sensitive_setting"]
    );
});

test("marca cambios de calendario PWA como sincronizacion urgente", () => {
    [
        "data_Ana",
        "baseData_Ana",
        "admin_Ana",
        "legal_Ana",
        "comp_Ana",
        "absences_Ana",
        "rotativa_Ana",
        "shift_Ana",
        "shiftAssignmentHistory_Ana",
        "replacements",
        "swaps",
        "manualHolidays",
        "turnoColorConfig",
        "profiles"
    ].forEach(key => {
        assert.equal(isWorkerCalendarUrgentStateKey(key), true, key);
    });

    assert.equal(isWorkerCalendarUrgentStateKey("memos"), false);
    assert.equal(isWorkerCalendarUrgentStateKey("agenda_contacts"), false);
});
