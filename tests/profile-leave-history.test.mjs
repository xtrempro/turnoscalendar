import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

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

const { setJSON } = await import("../js/persistence.js");
const {
    buildProfileLeaveHistory,
    getProfileLeaveHistory,
    getProfileLeaveHistoryYears
} = await import("../js/profileLeaveHistory.js");

const PROFILE = "Ana P\u00e9rez";

beforeEach(() => {
    globalThis.localStorage.clear();
});

test("agrupa cada solicitud y muestra solo los registros del a\u00f1o elegido", () => {
    const history = buildProfileLeaveHistory({
        profileName: PROFILE,
        year: 2026,
        adminDays: {
            "2026-5-8": "0.5M",
            "2025-4-2": 1
        },
        legalDays: {
            "2026-0-12": true,
            "2026-0-13": true,
            "2026-0-14": true
        },
        absences: {
            "2026-6-20": { type: "license" },
            "2026-6-21": { type: "license" },
            "2025-3-1": { type: "unpaid_leave" }
        },
        auditLogs: [
            {
                id: "legal-1",
                category: "leave_absence",
                profile: PROFILE,
                createdAt: "2026-01-10T12:00:00.000Z",
                meta: {
                    profile: PROFILE,
                    type: "legal",
                    amount: 2,
                    keys: ["2026-0-12", "2026-0-13", "2026-0-14"]
                }
            },
            {
                id: "half-admin-1",
                category: "leave_absence",
                profile: PROFILE,
                createdAt: "2026-06-01T12:00:00.000Z",
                meta: {
                    profile: PROFILE,
                    type: "half_admin_morning",
                    amount: 0.5,
                    keys: ["2026-5-8"]
                }
            },
            {
                id: "license-1",
                category: "leave_absence",
                profile: PROFILE,
                createdAt: "2026-07-01T12:00:00.000Z",
                meta: {
                    profile: PROFILE,
                    type: "license",
                    amount: 2,
                    keys: ["2026-6-20", "2026-6-21"]
                }
            },
            {
                id: "canceled-1",
                category: "leave_absence",
                profile: PROFILE,
                createdAt: "2026-08-01T12:00:00.000Z",
                canceledAt: "2026-08-02T12:00:00.000Z",
                meta: {
                    profile: PROFILE,
                    type: "license",
                    amount: 1,
                    keys: ["2026-7-1"]
                }
            }
        ]
    });

    assert.deepEqual(
        history.map(record => record.id),
        ["license-1", "half-admin-1", "legal-1"]
    );
    assert.equal(history[0].label, "Licencia M\u00e9dica");
    assert.equal(history[0].amount, 2);
    assert.equal(history[1].label, "1/2 ADM Ma\u00f1ana");
    assert.equal(history[1].amount, 0.5);
    assert.equal(history[2].startKey, "2026-0-12");
    assert.equal(history[2].endKey, "2026-0-14");
    assert.equal(history[2].amount, 2);
    assert.equal(history.some(record => record.startKey.startsWith("2025-")), false);
});

test("recupera registros antiguos aunque no tengan auditor\u00eda", () => {
    const history = buildProfileLeaveHistory({
        profileName: PROFILE,
        year: 2025,
        adminDays: {
            "2025-2-3": 1,
            "2025-2-4": 1
        },
        absences: {
            "2025-8-15": { type: "union_leave" }
        }
    });

    assert.equal(history.length, 2);
    assert.equal(history[0].label, "Permiso Gremial");
    assert.equal(history[0].amount, 1);
    assert.equal(history[1].label, "P. Administrativo");
    assert.equal(history[1].amount, 2);
});

test("carga el a\u00f1o actual y ofrece los a\u00f1os anteriores disponibles", () => {
    setJSON(`admin_${PROFILE}`, {
        "2026-1-4": 1,
        "2024-10-20": 1
    });
    setJSON(`legal_${PROFILE}`, {
        "2025-6-7": true
    });
    setJSON(`absences_${PROFILE}`, {
        "2023-0-8": { type: "unjustified_absence" }
    });
    setJSON("auditLog", []);

    assert.deepEqual(
        getProfileLeaveHistoryYears(PROFILE, 2026),
        [2026, 2025, 2024, 2023]
    );
    assert.equal(getProfileLeaveHistory(PROFILE, 2026).length, 1);
    assert.equal(getProfileLeaveHistory(PROFILE, 2025).length, 1);
    assert.equal(getProfileLeaveHistory(PROFILE, 2024).length, 1);
});
