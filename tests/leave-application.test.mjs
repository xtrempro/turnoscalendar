// Regresion para el refactor que renombro confirmCancelTurnChanges a
// confirmAndCancelScheduleConflicts: P. Administrativo, F. Legal y
// F. Compensatorio llamaban a la funcion antigua (ReferenceError) y al pulsar
// el dia en el calendario "no pasaba nada". Estas pruebas aplican cada tipo y,
// en el caso del F. Compensatorio, verifican que ademas anula los cambios de
// turno en conflicto antes de aplicarse.
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
    aplicarAdministrativo,
    aplicarLegal,
    aplicarComp
} = await import("../js/leaveEngine.js");
const {
    setCurrentProfile,
    saveBaseProfileData,
    getAdminDays,
    getLegalDays,
    getCompDays
} = await import("../js/storage.js");

const PROFILE = "Ana";
// Miercoles 10 de junio de 2026. Las claves internas usan el mes 0-indexado.
const START_DATE = new Date(2026, 5, 10);
const START_KEY = "2026-5-10";

beforeEach(() => {
    delete globalThis.window;
    globalThis.document = {
        body: { dataset: {} },
        getElementById() {
            return null;
        },
        querySelector() {
            return null;
        },
        querySelectorAll() {
            return [];
        }
    };
    globalThis.localStorage.clear();
    setCurrentProfile(PROFILE);
    // Cache de feriados sembrada para evitar el fetch de red; el feriado de enero
    // deja junio libre de feriados oficiales.
    setJSON("holidaysCache_2026", { "2026-0-1": "Ano Nuevo" });
});

test("aplica P. Administrativo sobre un turno largo base", async () => {
    saveBaseProfileData({ [START_KEY]: 1 }, PROFILE); // 1 = TURNO.LARGA

    const aplicado = await aplicarAdministrativo(START_DATE, 1);

    assert.equal(aplicado, true);
    assert.equal(getAdminDays()[START_KEY], 1);
});

test("aplica F. Legal en un bloque de diez dias habiles", async () => {
    const aplicado = await aplicarLegal(START_DATE, 10);

    assert.equal(aplicado, true);
    assert.equal(getLegalDays()[START_KEY], true);
});

test("aplica F. Compensatorio en un bloque de diez dias habiles", async () => {
    const aplicado = await aplicarComp(START_DATE, 10);

    assert.equal(aplicado, true);
    assert.equal(getCompDays()[START_KEY], true);
});

test("F. Compensatorio anula los cambios de turno en conflicto antes de aplicarse", async () => {
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

    const aplicado = await aplicarComp(START_DATE, 10);
    const swaps = getJSON("swaps", []);

    assert.equal(aplicado, true);
    assert.equal(getCompDays()[START_KEY], true);
    assert.equal(swaps[0].canceled, true);
});
