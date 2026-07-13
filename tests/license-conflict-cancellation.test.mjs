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
