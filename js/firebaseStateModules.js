export const FIREBASE_STATE_MODULES = Object.freeze({
    profile: { permission: "profile" },
    qualifications: { permission: "qualifications" },
    turnos: { permission: "turnos" },
    clockmarks: { permission: "clockmarks" },
    requests: { permission: "requests" },
    memos: { permission: "memos" },
    informations: { permission: "informations" },
    medicalEquipment: { permission: "medicalEquipment" },
    swap: { permission: "swap" },
    hours: { permission: "hours" },
    weekly: { permission: "weekly" },
    tasks: { permission: "tasks" },
    agenda: { permission: "agenda" },
    reports: { permission: "reports" },
    log: { permission: "log" },
    // El inicio no es un menu con permiso propio: lo ve todo administrador del
    // entorno. Por eso su permiso no coincide con ninguna clave de
    // MENU_PERMISSION_DEFS y canViewMenu/canEditMenu lo dejan pasar; en las
    // reglas basta con ser miembro de la unidad.
    home: { permission: "home" },
    system: { permission: "owner" }
});

const EXACT_KEY_MODULES = new Map([
    ["profiles", "profile"],
    ["qualifications", "qualifications"],
    ["swaps", "swap"],
    ["shiftMoves", "swap"],
    ["turnChangeConfig", "swap"],
    ["replacements", "turnos"],
    ["preassignments", "turnos"],
    ["manualHolidays", "turnos"],
    ["manualExtraReasonPresets", "turnos"],
    ["noCoverageReasonPresets", "turnos"],
    ["turnoColorConfig", "turnos"],
    // La tanda de colores de la programacion. Se comparte porque la
    // programacion se imprime y se reparte: los colores son una decision de la
    // unidad, no del navegador que la abrio.
    ["taskScheduleColorSeed", "turnos"],
    ["replacementRequests", "requests"],
    ["workerRequests", "requests"],
    ["replacementRequestConfig", "requests"],
    ["leaveAttachments", "requests"],
    ["workerNotifications", "requests"],
    ["memos", "memos"],
    ["informations", "informations"],
    ["medicalEquipment", "medicalEquipment"],
    // Contratos de mantencion: uno puede cubrir varios equipos. Viaja en el
    // mismo modulo que los equipos, asi que usa las reglas ya desplegadas.
    ["medicalEquipmentContracts", "medicalEquipment"],
    ["agenda_contacts", "agenda"],
    // Tareas diarias del inicio que un administrador comparte con la unidad o
    // con los trabajadores. Las privadas NO pasan por aca: viven en el
    // documento de su dueño (ver js/homeTasks.js).
    ["home_shared_tasks", "home"],
    ["staffing_config", "weekly"],
    ["staffing_applicants", "weekly"],
    ["staffing_custom_reminders", "weekly"],
    ["weekly_task_assignment_tasks", "tasks"],
    ["weekly_task_assignment_entries", "tasks"],
    ["weekly_task_assignment_updated", "tasks"],
    ["weekly_task_schedule_attachment", "tasks"],
    ["weekly_task_schedule_attachments", "tasks"],
    ["gradeHourConfig", "hours"],
    ["attendanceMarks", "clockmarks"],
    // Cuando se subio la ultima planilla: viaja con las marcas porque decide
    // hasta que hora se juzga lo que falta, y el motor del servidor lo lee.
    ["attendanceMarksImportedAt", "clockmarks"],
    // El horario propio de cada trabajador viaja con las marcas: sin esto
    // quedaria solo en el navegador de quien lo configuro, y otro supervisor
    // veria atrasos que no existen.
    ["workerSchedules", "clockmarks"],
    ["reportSignatureConfig", "reports"],
    ["adminDisplayNames", "reports"],
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
    ["honorariaContracts_", "profile"],
    ["hrLogs_", "profile"],
    ["data_", "turnos"],
    ["admin_", "turnos"],
    ["legal_", "turnos"],
    ["comp_", "turnos"],
    ["absences_", "turnos"],
    ["blocked_", "turnos"],
    ["noCoverage_", "turnos"],
    // Permisos aplicados que aun no viajan a la PWA (js/leaveHold.js). Viaja con
    // los permisos porque el motor del servidor lo lee para decidir que esconder.
    ["leaveHold_", "turnos"],
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
