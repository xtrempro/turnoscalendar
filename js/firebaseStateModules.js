export const FIREBASE_STATE_MODULES = Object.freeze({
    profile: { permission: "profile" },
    turnos: { permission: "turnos" },
    clockmarks: { permission: "clockmarks" },
    requests: { permission: "requests" },
    memos: { permission: "memos" },
    swap: { permission: "swap" },
    hours: { permission: "hours" },
    weekly: { permission: "weekly" },
    tasks: { permission: "tasks" },
    agenda: { permission: "agenda" },
    reports: { permission: "reports" },
    log: { permission: "log" },
    system: { permission: "owner" }
});

const EXACT_KEY_MODULES = new Map([
    ["profiles", "profile"],
    ["swaps", "swap"],
    ["shiftMoves", "swap"],
    ["turnChangeConfig", "swap"],
    ["replacements", "turnos"],
    ["manualHolidays", "turnos"],
    ["turnoColorConfig", "turnos"],
    ["replacementRequests", "requests"],
    ["workerRequests", "requests"],
    ["replacementRequestConfig", "requests"],
    ["workerNotifications", "requests"],
    ["memos", "memos"],
    ["agenda_contacts", "agenda"],
    ["staffing_config", "weekly"],
    ["staffing_applicants", "weekly"],
    ["staffing_custom_reminders", "weekly"],
    ["weekly_task_assignment_tasks", "tasks"],
    ["weekly_task_assignment_entries", "tasks"],
    ["gradeHourConfig", "hours"],
    ["reportSignatureConfig", "reports"],
    ["auditLog", "log"]
]);

const PREFIX_KEY_MODULES = [
    ["baseData_", "profile"],
    ["rotativa_", "profile"],
    ["shift_", "profile"],
    ["shiftAssignmentHistory_", "profile"],
    ["gradeHistory_", "profile"],
    ["contractHistory_", "profile"],
    ["replacementContracts_", "profile"],
    ["hrLogs_", "profile"],
    ["data_", "turnos"],
    ["admin_", "turnos"],
    ["legal_", "turnos"],
    ["comp_", "turnos"],
    ["absences_", "turnos"],
    ["blocked_", "turnos"],
    ["leaveBalances_", "turnos"],
    ["clockMarks_", "clockmarks"],
    ["carry_", "hours"],
    ["hourReturns_", "hours"],
    ["hheeReturnTransfers_", "hours"]
];

export function stateModuleForKey(key) {
    const cleanKey = String(key || "");
    const exact = EXACT_KEY_MODULES.get(cleanKey);

    if (exact) return exact;

    return PREFIX_KEY_MODULES.find(([prefix]) =>
        cleanKey.startsWith(prefix)
    )?.[1] || "system";
}

export function stateModulePermission(moduleId) {
    return FIREBASE_STATE_MODULES[moduleId]?.permission || "owner";
}

export function stateModuleIds() {
    return Object.keys(FIREBASE_STATE_MODULES);
}

export function splitSnapshotByStateModule(snapshot = {}) {
    const modules = {};

    Object.entries(snapshot).forEach(([key, value]) => {
        const moduleId = stateModuleForKey(key);

        if (!modules[moduleId]) {
            modules[moduleId] = {};
        }

        modules[moduleId][key] = value;
    });

    return modules;
}
