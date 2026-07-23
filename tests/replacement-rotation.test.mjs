import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
    REPLACEMENT_ROTATION_MODE,
    normalizeReplacementRotationMode,
    replacementRotationModeLabel
} from "../js/replacementRotation.js";
import {
    getReplacementRotationModeForDate
} from "../js/contracts.js";
import { TURNO } from "../js/constants.js";
import { setJSON } from "../js/persistence.js";
import {
    PROFILE_MODE,
    profileDraft,
    resetProfileDraft
} from "../js/profileDraft.js";
import { validateProfileDraft } from "../js/profileValidation.js";
import {
    getTurnoBase,
    getTurnoProgramado
} from "../js/turnEngine.js";

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

beforeEach(() => {
    globalThis.localStorage.clear();
});

test("normaliza las modalidades validas de un contrato de reemplazo", () => {
    assert.equal(
        normalizeReplacementRotationMode("INHERIT"),
        REPLACEMENT_ROTATION_MODE.INHERIT
    );
    assert.equal(
        normalizeReplacementRotationMode(" free "),
        REPLACEMENT_ROTATION_MODE.FREE
    );
});

test("usa el respaldo indicado para contratos antiguos", () => {
    assert.equal(
        normalizeReplacementRotationMode(
            "",
            REPLACEMENT_ROTATION_MODE.INHERIT
        ),
        REPLACEMENT_ROTATION_MODE.INHERIT
    );
});

test("describe las modalidades para la interfaz", () => {
    assert.match(
        replacementRotationModeLabel(REPLACEMENT_ROTATION_MODE.FREE),
        /Libre/
    );
    assert.match(
        replacementRotationModeLabel(REPLACEMENT_ROTATION_MODE.INHERIT),
        /Heredar/
    );
});

test("permite crear un perfil de reemplazo sin contrato", () => {
    resetProfileDraft();
    Object.assign(profileDraft, {
        mode: PROFILE_MODE.CREATE,
        name: "Reemplazante sin contrato",
        estamento: "Profesional",
        contractType: "Reemplazo",
        // El RUT es obligatorio al crear (ancla de identidad del trabajador).
        rut: "17.816.632-8"
    });

    assert.deepEqual(validateProfileDraft(), { ok: true });
});

test("un contrato antiguo sin modalidad hereda turnos aunque el reemplazante sea libre", () => {
    const key = "2026-6-1";

    setJSON("profiles", [
        { name: "Titular", contractType: "Planta", active: true },
        { name: "Reemplazante", contractType: "Reemplazo", active: true }
    ]);
    setJSON("rotativa_Titular", {
        type: "4turno",
        start: "2026-07-01",
        firstTurn: "larga"
    });
    setJSON("rotativa_Reemplazante", {
        type: "libre",
        start: "",
        firstTurn: "larga"
    });
    setJSON("replacementContracts_Reemplazante", [
        {
            id: "legacy-contract",
            start: "2026-07-01",
            end: "2026-07-02",
            replaces: "Titular"
        }
    ]);

    assert.equal(
        getReplacementRotationModeForDate("Reemplazante", key),
        REPLACEMENT_ROTATION_MODE.INHERIT
    );
    assert.equal(getTurnoBase("Titular", key), TURNO.LARGA);
    assert.equal(getTurnoBase("Reemplazante", key), TURNO.LARGA);
    assert.equal(
        getTurnoProgramado("Reemplazante", key),
        TURNO.LARGA
    );
});

test("un contrato marcado como libre mantiene los turnos manuales", () => {
    const key = "2026-6-1";

    setJSON("profiles", [
        { name: "Titular", contractType: "Planta", active: true },
        { name: "Reemplazante", contractType: "Reemplazo", active: true }
    ]);
    setJSON("rotativa_Titular", {
        type: "4turno",
        start: "2026-07-01",
        firstTurn: "larga"
    });
    setJSON("rotativa_Reemplazante", {
        type: "libre",
        start: "",
        firstTurn: "larga"
    });
    setJSON("replacementContracts_Reemplazante", [
        {
            id: "manual-contract",
            start: "2026-07-01",
            end: "2026-07-02",
            replaces: "Titular",
            rotationMode: REPLACEMENT_ROTATION_MODE.FREE
        }
    ]);

    assert.equal(
        getReplacementRotationModeForDate("Reemplazante", key),
        REPLACEMENT_ROTATION_MODE.FREE
    );
    assert.equal(getTurnoBase("Reemplazante", key), TURNO.LIBRE);
    assert.equal(
        getTurnoProgramado("Reemplazante", key),
        TURNO.LIBRE
    );
});
