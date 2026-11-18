import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
    constructor() {
        this.values = new Map();
    }

    get length() {
        return this.values.size;
    }

    clear() {
        this.values.clear();
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    key(index) {
        return [...this.values.keys()][index] ?? null;
    }

    removeItem(key) {
        this.values.delete(key);
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }
}

globalThis.localStorage = new MemoryStorage();

const { getJSON, setJSON } = await import("../js/persistence.js");
const {
    cancelReplacementById,
    cancelReplacementsForWorkerKeys,
    getActiveReplacementsForWorkerKeys
} = await import("../js/replacements.js");
const { aplicarLicencia } = await import("../js/leaveEngine.js");
const { setCurrentProfile } = await import("../js/storage.js");
const { getTurnoProgramado } = await import("../js/turnEngine.js");
const { TURNO } = await import("../js/constants.js");
const { undoAuditLogEntry } = await import("../js/auditLog.js");
const { getClockExtraHours } = await import("../js/clockMarks.js");

const LICENSE_DAY_KEY = "2026-5-10";

function seedConflicts() {
    setJSON("replacements", [
        {
            id: "extra",
            worker: "Ana",
            replaced: "Carla",
            date: "2026-06-10",
            turno: "N",
            requestId: "request-1",
            requestGroupId: "group-1",
            canceled: false,
            addsShift: true
        },
        {
            id: "backup",
            worker: "Ana",
            date: "2026-06-10",
            turno: "L",
            canceled: false,
            addsShift: false
        },
        {
            id: "covers-ana",
            worker: "Bruno",
            replaced: "Ana",
            date: "2026-06-10",
            turno: "L",
            canceled: false
        },
        {
            id: "other-day",
            worker: "Ana",
            date: "2026-06-11",
            turno: "N",
            canceled: false
        },
        {
            id: "already-canceled",
            worker: "Ana",
            date: "2026-06-10",
            turno: "N",
            canceled: true
        }
    ]);
    setJSON("replacementRequests", [
        {
            id: "request-1",
            groupId: "group-1",
            worker: "Ana",
            status: "accepted"
        },
        {
            id: "request-2",
            groupId: "group-1",
            worker: "Diana",
            status: "rejected"
        },
        {
            id: "request-3",
            groupId: "group-2",
            worker: "Elena",
            status: "pending"
        }
    ]);
}

beforeEach(() => {
    delete globalThis.window;
    globalThis.document = {
        body: { dataset: {} },
        getElementById() {
            return null;
        }
    };
    globalThis.localStorage.clear();
    setJSON("profiles", [{ name: "Ana", id: "ana", contractType: "Contrata" }]);
    setCurrentProfile("Ana");
    seedConflicts();
});

test("detecta todos los turnos extra del trabajador dentro de la licencia", () => {
    const conflicts = getActiveReplacementsForWorkerKeys(
        "Ana",
        [LICENSE_DAY_KEY]
    );

    assert.deepEqual(
        conflicts.map(item => item.id).sort(),
        ["backup", "extra"]
    );
});

test("anula un reemplazo puntual por id y cancela sus solicitudes vinculadas", () => {
    const canceled = cancelReplacementById("extra", {
        reason: "supervisor_canceled",
        details: "Prueba"
    });
    const replacements = getJSON("replacements", []);
    const requests = getJSON("replacementRequests", []);
    const byId = Object.fromEntries(
        replacements.map(item => [item.id, item])
    );
    const requestById = Object.fromEntries(
        requests.map(item => [item.id, item])
    );

    assert.equal(canceled.id, "extra");
    assert.equal(byId.extra.canceled, true);
    assert.equal(byId.extra.cancelReason, "supervisor_canceled");
    assert.equal(byId.backup.canceled, false);
    assert.equal(byId["covers-ana"].canceled, false);
    assert.equal(requestById["request-1"].status, "canceled");
    assert.equal(requestById["request-2"].status, "canceled");
    assert.equal(requestById["request-3"].status, "pending");
});

test("anula los turnos extra y su grupo de solicitudes, sin tocar otras coberturas", () => {
    const canceled = cancelReplacementsForWorkerKeys(
        "Ana",
        [LICENSE_DAY_KEY],
        {
            reason: "medical_leave_applied",
            details: "Licencia Medica aplicada a Ana."
        }
    );
    const replacements = getJSON("replacements", []);
    const requests = getJSON("replacementRequests", []);
    const byId = Object.fromEntries(
        replacements.map(item => [item.id, item])
    );
    const requestById = Object.fromEntries(
        requests.map(item => [item.id, item])
    );

    assert.deepEqual(
        canceled.map(item => item.id).sort(),
        ["backup", "extra"]
    );
    assert.equal(byId.extra.canceled, true);
    assert.equal(byId.extra.cancelReason, "medical_leave_applied");
    assert.equal(byId.backup.canceled, true);
    assert.equal(byId["covers-ana"].canceled, false);
    assert.equal(byId["other-day"].canceled, false);
    assert.equal(requestById["request-1"].status, "canceled");
    assert.equal(requestById["request-2"].status, "canceled");
    assert.equal(requestById["request-3"].status, "pending");
});

test("si el supervisor rechaza el modal no cambia reemplazos, cambios ni licencia", async () => {
    setJSON("swaps", [
        {
            id: "swap-1",
            from: "Ana",
            to: "Bruno",
            fecha: "2026-06-10",
            devolucion: "2026-06-12",
            turno: "N",
            turnoDevuelto: "L",
            canceled: false
        }
    ]);
    globalThis.window = {};
    let warning = "";
    let prepared = false;

    try {
        const applied = await aplicarLicencia(
            new Date(2026, 5, 10),
            1,
            "license",
            {
                // Ana tiene un turno cubierto ese dia: se mantiene la
                // cobertura y se rechaza el aviso de conflictos.
                confirmCoverage: async () => ({ action: "confirm" }),
                confirmConflicts: async message => {
                    warning = message;
                    return false;
                },
                beforeMutation: () => {
                    prepared = true;
                }
            }
        );

        assert.equal(applied, null);
        assert.equal(prepared, false);
        assert.match(warning, /Turnos extra\/reemplazos \(2\)/);
        assert.match(warning, /Cambios de turno \(1\)/);
        assert.deepEqual(getJSON("absences_Ana", {}), {});
        assert.equal(
            getJSON("replacements", []).find(item => item.id === "extra").canceled,
            false
        );
        assert.equal(getJSON("swaps", [])[0].canceled, false);
    } finally {
        delete globalThis.window;
    }
});

test("al aceptar anula reemplazos y cambios antes de aplicar la licencia", async () => {
    setJSON("swaps", [
        {
            id: "swap-1",
            from: "Ana",
            to: "Bruno",
            fecha: "2026-06-10",
            devolucion: "2026-06-12",
            turno: "N",
            turnoDevuelto: "L",
            canceled: false
        }
    ]);

    const applied = await aplicarLicencia(
        new Date(2026, 5, 10),
        1,
        "license"
    );
    const absences = getJSON("absences_Ana", {});
    const replacements = getJSON("replacements", []);
    const swaps = getJSON("swaps", []);

    assert.equal(applied, true);
    assert.equal(absences[LICENSE_DAY_KEY].type, "license");
    assert.equal(
        replacements.find(item => item.id === "extra").canceled,
        true
    );
    assert.equal(
        replacements.find(item => item.id === "backup").canceled,
        true
    );
    assert.equal(
        replacements.find(item => item.id === "covers-ana").canceled,
        false
    );
    assert.equal(swaps[0].canceled, true);
});

for (const type of ["license", "professional_license"]) {
    test(`${type}: retira el extra manual, conserva la noche base y limpia el horario`, async () => {
        setJSON("baseData_Ana", { [LICENSE_DAY_KEY]: TURNO.NOCHE });
        setJSON("data_Ana", { [LICENSE_DAY_KEY]: TURNO.DIURNO_NOCHE });
        setJSON("replacements", [{
            id: "manual", worker: "Ana", date: "2026-06-10",
            turno: "D", source: "manual_extra", addsShift: false
        }]);
        const outsideMark = { segments: { diurno: { exitTime: "16:00" } } };
        setJSON("clockMarks_Ana", {
            [LICENSE_DAY_KEY]: outsideMark,
            "2026-5-11": outsideMark
        });
        setJSON("clockMarks_Bruno", { [LICENSE_DAY_KEY]: outsideMark });
        setJSON("attendanceMarks", [{ id: "real-attendance", time: "16:01" }]);

        assert.equal(await aplicarLicencia(new Date(2026, 5, 10), 1, type), true);
        assert.equal(getTurnoProgramado("Ana", LICENSE_DAY_KEY), TURNO.NOCHE);
        assert.equal(getJSON("replacements", [])[0].canceled, true);
        assert.deepEqual(getJSON("clockMarks_Ana", {}), { "2026-5-11": outsideMark });
        assert.deepEqual(getJSON("clockMarks_Bruno", {}), { [LICENSE_DAY_KEY]: outsideMark });
        assert.deepEqual(getJSON("attendanceMarks", []), [{ id: "real-attendance", time: "16:01" }]);
        const log = getJSON("auditLog", []).find(log => log.meta?.clearedClockMarkKeys);
        assert.deepEqual(log?.meta.clearedClockMarkKeys, [LICENSE_DAY_KEY]);
    });
}

test("licencia limpia horarios aunque el respaldo del extra ya estuviera anulado", async () => {
    setJSON("replacements", [{
        id: "old-extra", worker: "Ana", date: "2026-06-10",
        turno: "D", source: "manual_extra", canceled: true
    }]);
    setJSON("baseData_Ana", { [LICENSE_DAY_KEY]: TURNO.NOCHE });
    setJSON("data_Ana", { [LICENSE_DAY_KEY]: TURNO.NOCHE });
    setJSON("clockMarks_Ana", {
        [LICENSE_DAY_KEY]: { segments: { diurno: { exitTime: "16:00" } } }
    });

    assert.equal(await aplicarLicencia(new Date(2026, 5, 10), 1), true);
    assert.deepEqual(getJSON("clockMarks_Ana", {}), {});
    assert.equal(getTurnoProgramado("Ana", LICENSE_DAY_KEY), TURNO.NOCHE);
});

test("rechazar licencia conserva el extra manual y su horario", async () => {
    setJSON("data_Ana", { [LICENSE_DAY_KEY]: TURNO.DIURNO });
    setJSON("replacements", [{
        id: "manual", worker: "Ana", date: "2026-06-10",
        turno: "D", source: "manual_extra", addsShift: false
    }]);
    const marks = { [LICENSE_DAY_KEY]: { segments: { diurno: { exitTime: "16:00" } } } };
    setJSON("clockMarks_Ana", marks);
    globalThis.window = {};
    try {
        assert.equal(await aplicarLicencia(new Date(2026, 5, 10), 1, "license", {
            confirmConflicts: async () => false
        }), null);
        assert.equal(getTurnoProgramado("Ana", LICENSE_DAY_KEY), TURNO.DIURNO);
        assert.deepEqual(getJSON("clockMarks_Ana", {}), marks);
        assert.equal(getJSON("replacements", [])[0].canceled, undefined);
        assert.deepEqual(getJSON("absences_Ana", {}), {});
    } finally {
        delete globalThis.window;
    }
});

function enableEvents() {
    globalThis.window = { dispatchEvent: () => true };
    globalThis.CustomEvent = class {
        constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
    };
}

for (const type of ["license", "professional_license"]) {
    test(`${type}: conserva un turno base trasladado, incluso al anular la licencia`, async () => {
        setJSON("baseData_Ana", { [LICENSE_DAY_KEY]: TURNO.LARGA });
        setJSON("data_Ana", { [LICENSE_DAY_KEY]: TURNO.LARGA });
        setJSON("replacements", [{
            id: "moved-base", worker: "Ana", replaced: "Carla", date: "2026-06-10",
            turno: "L", source: "manual_extra", addsShift: false
        }]);
        assert.equal(await aplicarLicencia(new Date(2026, 5, 10), 1, type), true);
        assert.equal(getJSON("replacements", [])[0].canceled, true);
        assert.equal(getTurnoProgramado("Ana", LICENSE_DAY_KEY), TURNO.LARGA);
        enableEvents();
        const log = getJSON("auditLog", []).find(log => log.meta?.type === type);
        assert.equal((await undoAuditLogEntry(log.id)).ok, true);
        assert.equal(getTurnoProgramado("Ana", LICENSE_DAY_KEY), TURNO.LARGA);
    });

    test(`${type}: retira HT de un Diurno extendido a Larga`, async () => {
        setJSON("baseData_Ana", { [LICENSE_DAY_KEY]: TURNO.DIURNO });
        setJSON("data_Ana", { [LICENSE_DAY_KEY]: TURNO.LARGA });
        setJSON("replacements", [{
            id: "extension", worker: "Ana", date: "2026-06-10",
            turno: "HT", source: "manual_extra", addsShift: false
        }]);
        assert.equal(await aplicarLicencia(new Date(2026, 5, 10), 1, type), true);
        assert.equal(getTurnoProgramado("Ana", LICENSE_DAY_KEY), TURNO.DIURNO);
    });

    test(`${type}: anular recupera la extension por marcaje y sus documentos completos`, async () => {
        setJSON("replacements", []);
        setJSON("baseData_Ana", { [LICENSE_DAY_KEY]: TURNO.LARGA });
        const original = {
            [LICENSE_DAY_KEY]: {
                segments: { larga: { exitTime: "22:00", documents: [{
                    id: "attachment", name: "justificacion.pdf", storagePath: "private/path.pdf"
                }] } },
                source: "worker_request", workerRequestId: "request-doc",
                updatedAt: "2026-06-01T12:00:00.000Z"
            }
        };
        setJSON("clockMarks_Ana", original);
        const extraBefore = getClockExtraHours("Ana", LICENSE_DAY_KEY, new Date(2026, 5, 10), TURNO.LARGA, {});
        assert.ok(extraBefore.d + extraBefore.n > 0);
        assert.equal(await aplicarLicencia(new Date(2026, 5, 10), 1, type), true);
        assert.deepEqual(getJSON("clockMarks_Ana", {}), {});
        const log = getJSON("auditLog", []).find(log => log.meta?.type === type);
        assert.deepEqual(getJSON("leaveClockMarks_Ana", {})[LICENSE_DAY_KEY].mark, original[LICENSE_DAY_KEY]);
        assert.equal(log.meta.clockMarkBackupId, log.id);
        assert.equal(JSON.stringify(log).includes("private/path.pdf"), false);
        enableEvents();
        assert.equal((await undoAuditLogEntry(log.id)).ok, true);
        assert.deepEqual(getJSON("clockMarks_Ana", {}), original);
        assert.deepEqual(getClockExtraHours("Ana", LICENSE_DAY_KEY, new Date(2026, 5, 10), TURNO.LARGA, {}), extraBefore);
        assert.deepEqual(getJSON("leaveClockMarks_Ana", {}), {});
    });
}

test("anular licencia conserva un horario nuevo en vez de reponer el anterior", async () => {
    setJSON("replacements", []);
    setJSON("clockMarks_Ana", { [LICENSE_DAY_KEY]: { segments: { larga: { exitTime: "22:00" } } } });
    assert.equal(await aplicarLicencia(new Date(2026, 5, 10), 1), true);
    const log = getJSON("auditLog", []).find(log => log.meta?.type === "license");
    const next = { [LICENSE_DAY_KEY]: { segments: { larga: { exitTime: "21:00" } }, workerRequestId: "new" } };
    setJSON("clockMarks_Ana", next);
    enableEvents();
    assert.equal((await undoAuditLogEntry(log.id)).ok, true);
    assert.deepEqual(getJSON("clockMarks_Ana", {}), next);
});

test("rechazar el aviso de horarios sin extras no modifica ni respalda nada", async () => {
    setJSON("replacements", []);
    const marks = { [LICENSE_DAY_KEY]: { segments: { larga: { exitTime: "22:00" } } } };
    setJSON("clockMarks_Ana", marks);
    enableEvents();
    let warning = "";
    let prepared = false;
    assert.equal(await aplicarLicencia(new Date(2026, 5, 10), 1, "license", {
        confirmConflicts: async message => { warning = message; return false; },
        beforeMutation: () => { prepared = true; }
    }), null);
    assert.match(warning, /Ajustes de horario \(1\)/);
    assert.match(warning, /incluidos sus documentos/);
    assert.match(warning, /Al anular la licencia se recuperarán/);
    assert.equal(prepared, false);
    assert.deepEqual(getJSON("clockMarks_Ana", {}), marks);
    assert.deepEqual(getJSON("leaveClockMarks_Ana", {}), {});
    assert.deepEqual(getJSON("absences_Ana", {}), {});
});

test("beforeMutation fallido conserva el horario y sus documentos", async () => {
    setJSON("replacements", []);
    const marks = { [LICENSE_DAY_KEY]: { segments: { larga: { exitTime: "22:00" } } } };
    setJSON("clockMarks_Ana", marks);
    await assert.rejects(aplicarLicencia(new Date(2026, 5, 10), 1, "license", {
        beforeMutation: () => { throw new Error("history failed"); }
    }), /history failed/);
    assert.deepEqual(getJSON("clockMarks_Ana", {}), marks);
    assert.deepEqual(getJSON("leaveClockMarks_Ana", {}), {});
});

test("el respaldo sincronizado por dia se puede restaurar desde otro equipo", async () => {
    const { planPartialStateEntries, applyPartialStateEntry } = await import("../js/firebasePartialState.js");
    const { stateModuleForKey } = await import("../js/firebaseStateModules.js");
    setJSON("replacements", []);
    const marks = { [LICENSE_DAY_KEY]: { segments: { larga: { exitTime: "22:00", documents: [{
        name: "respaldo.pdf", storagePath: "private/request.pdf"
    }] } }, workerRequestId: "original" } };
    setJSON("clockMarks_Ana", marks);
    assert.equal(await aplicarLicencia(new Date(2026, 5, 10), 1), true);
    const logs = getJSON("auditLog", []);
    const key = "leaveClockMarks_Ana";
    const raw = localStorage.getItem(key);
    const entries = planPartialStateEntries({keys:[key], changes:{[key]:{previous:null,next:raw}}, moduleForKey:stateModuleForKey});
    assert.equal(entries.length, 1);
    assert.equal(entries[0].moduleId, "clockmarks");
    assert.equal(entries[0].itemKey, LICENSE_DAY_KEY);
    const hydrated = applyPartialStateEntry({}, entries[0]);
    localStorage.clear();
    setJSON("profiles", [{ name:"Ana", id:"ana" }]);
    setJSON("auditLog", logs);
    setJSON("absences_Ana", { [LICENSE_DAY_KEY]: {type:"license"} });
    localStorage.setItem(key, hydrated[key]);
    enableEvents();
    const log = logs.find(log => log.meta?.type === "license");
    assert.equal((await undoAuditLogEntry(log.id)).ok, true);
    assert.deepEqual(getJSON("clockMarks_Ana", {}), marks);
});

test("el respaldo solo se repone en los dias que se anulan efectivamente", async () => {
    setJSON("replacements", []);
    const marks = {
        [LICENSE_DAY_KEY]: {segments:{larga:{exitTime:"22:00"}}},
        "2026-5-11": {segments:{larga:{exitTime:"21:00"}}}
    };
    setJSON("clockMarks_Ana", marks);
    assert.equal(await aplicarLicencia(new Date(2026, 5, 10), 2), true);
    const log = getJSON("auditLog", []).find(log => log.meta?.type === "license");
    // Otro permiso vigente ocupa el segundo dia: anular esta licencia no lo toca.
    setJSON("absences_Ana", {[LICENSE_DAY_KEY]:{type:"license"},"2026-5-11":{type:"training"}});
    enableEvents();
    assert.equal((await undoAuditLogEntry(log.id)).ok, true);
    assert.deepEqual(getJSON("clockMarks_Ana", {}), {[LICENSE_DAY_KEY]:marks[LICENSE_DAY_KEY]});
    assert.deepEqual(getJSON("leaveClockMarks_Ana", {})["2026-5-11"].mark, marks["2026-5-11"]);
});

test("una licencia que sustituye otra conserva el respaldo original", async () => {
    setJSON("replacements", []);
    const marks = {[LICENSE_DAY_KEY]:{segments:{larga:{exitTime:"22:00"}}}};
    setJSON("clockMarks_Ana", marks);
    assert.equal(await aplicarLicencia(new Date(2026, 5, 10), 1, "license"), true);
    assert.equal(await aplicarLicencia(new Date(2026, 5, 10), 1, "professional_license"), true);
    const log = getJSON("auditLog", []).find(log => log.meta?.type === "professional_license");
    enableEvents();
    assert.equal((await undoAuditLogEntry(log.id)).ok, true);
    assert.deepEqual(getJSON("clockMarks_Ana", {}), marks);
});

// Licencia sobre un feriado legal ya cubierto (caso de test del 29-09): el
// feriado partio ANTES de la licencia, asi que antes quedaba encimado con ella.
async function licenciaSobreFeriado(coverageAction) {
    const realFetch = globalThis.fetch;
    const warnings = [];

    globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
    globalThis.window = { dispatchEvent: () => true };
    setJSON("legal_Ana", {
        "2026-5-8": true, "2026-5-9": true, "2026-5-10": true,
        "2026-5-11": true, "2026-5-12": true
    });

    try {
        const applied = await aplicarLicencia(new Date(2026, 5, 10), 2, "license", {
            confirmConflicts: async message => {
                warnings.push(message);
                return true;
            },
            confirmCoverage: async message => {
                warnings.push(message);
                return { action: coverageAction };
            }
        });

        return { applied, warnings };
    } finally {
        globalThis.fetch = realFetch;
        delete globalThis.window;
    }
}

test("la licencia pisa el feriado que se cruza, avisando cuantos permisos quita", async () => {
    const { applied, warnings } = await licenciaSobreFeriado("confirm");
    const legal = getJSON("legal_Ana", {});

    assert.equal(applied, true);
    assert.match(warnings[0], /Se quitará 1 permiso de Ana para reemplazarlos por Licencia Médica/);
    assert.match(warnings[0], /Feriado legal: 10\/06\/2026 al 11\/06\/2026/);
    // Solo los dias cruzados: lo de antes y despues del feriado sigue.
    assert.deepEqual(Object.keys(legal).sort(), ["2026-5-12", "2026-5-8", "2026-5-9"]);
    assert.equal(getJSON("absences_Ana", {})["2026-5-10"].type, "license");
});

test("turno ya cubierto: mantener la cobertura la deja por la licencia", async () => {
    const { warnings } = await licenciaSobreFeriado("confirm");
    const cubre = getJSON("replacements", []).find(item => item.id === "covers-ana");

    assert.match(warnings[1], /Hay 1 turno de Ana ya cubierto/);
    assert.match(warnings[1], /Bruno/);
    assert.equal(cubre.canceled, false);
    assert.equal(cubre.absenceType, "Licencia Médica");
});

test("turno ya cubierto: quitar todos los reemplazos programados", async () => {
    await licenciaSobreFeriado("remove");

    assert.equal(
        getJSON("replacements", []).find(item => item.id === "covers-ana").canceled,
        true
    );
});

test("volver en la pregunta de cobertura no aplica nada", async () => {
    const { applied } = await licenciaSobreFeriado("cancel");

    assert.equal(applied, null);
    assert.deepEqual(getJSON("absences_Ana", {}), {});
    assert.equal(Object.keys(getJSON("legal_Ana", {})).length, 5);
});
