import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
    REPLACEMENT_ROTATION_MODE,
    normalizeReplacementRotationMode,
    replacementRotationModeLabel
} from "../js/replacementRotation.js";
import {
    getDiurnoBridgeContractForProfile,
    getReplacementBridgeProfileForDate,
    getReplacementRotationModeForDate,
    replacementContractCoversCoveredShift
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
    assert.equal(
        normalizeReplacementRotationMode("diurno_bridge"),
        REPLACEMENT_ROTATION_MODE.DIURNO_BRIDGE
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
    assert.match(
        replacementRotationModeLabel(REPLACEMENT_ROTATION_MODE.DIURNO_BRIDGE),
        /diurno/i
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

test("exige seleccionar el diurno puente cuando esa modalidad esta activa", () => {
    setJSON("profiles", [
        { name: "Titular", contractType: "Planta", active: true },
        { name: "Diurno", contractType: "Planta", active: true }
    ]);
    resetProfileDraft();
    Object.assign(profileDraft, {
        mode: PROFILE_MODE.CREATE,
        name: "Reemplazante con puente",
        estamento: "Profesional",
        contractType: "Reemplazo",
        rut: "17.816.632-8",
        contractStart: "2026-07-01",
        contractEnd: "2026-07-04",
        contractReplaces: "Titular",
        contractReason: "F. Legal",
        contractLeaveRef: "legal:Titular:2026-07-01:2026-07-04",
        contractRotationMode: REPLACEMENT_ROTATION_MODE.DIURNO_BRIDGE,
        contractBridgeProfile: ""
    });

    const result = validateProfileDraft();

    assert.equal(result.ok, false);
    assert.match(result.message, /trabajador diurno/i);
});

test("acepta el contrato puente cuando el diurno elegido existe", () => {
    setJSON("profiles", [
        { name: "Titular", contractType: "Planta", active: true },
        { name: "Diurno", contractType: "Planta", active: true }
    ]);
    resetProfileDraft();
    Object.assign(profileDraft, {
        mode: PROFILE_MODE.CREATE,
        name: "Reemplazante con puente",
        estamento: "Profesional",
        contractType: "Reemplazo",
        rut: "17.816.632-8",
        contractStart: "2026-07-01",
        contractEnd: "2026-07-04",
        contractReplaces: "Titular",
        contractReason: "F. Legal",
        contractLeaveRef: "legal:Titular:2026-07-01:2026-07-04",
        contractRotationMode: REPLACEMENT_ROTATION_MODE.DIURNO_BRIDGE,
        contractBridgeProfile: "Diurno"
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

test("un contrato puente mueve al diurno a la rotativa y deja al reemplazante diurno", () => {
    const keyLarga = "2026-6-1";
    const keyNoche = "2026-6-2";
    const keyLibre = "2026-6-3";
    const keySabado = "2026-6-4";

    setJSON("profiles", [
        {
            name: "Titular",
            contractType: "Planta",
            estamento: "Profesional",
            profession: "TM Imagenologia",
            active: true
        },
        {
            name: "Reemplazante",
            contractType: "Reemplazo",
            estamento: "Profesional",
            profession: "TM Imagenologia",
            active: true
        },
        {
            name: "Diurno",
            contractType: "Planta",
            estamento: "Profesional",
            profession: "TM Imagenologia",
            active: true
        }
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
    setJSON("rotativa_Diurno", {
        type: "diurno",
        start: "2026-01-01",
        firstTurn: "larga"
    });
    setJSON("replacementContracts_Reemplazante", [
        {
            id: "bridge-contract",
            start: "2026-07-01",
            end: "2026-07-04",
            replaces: "Titular",
            rotationMode: REPLACEMENT_ROTATION_MODE.DIURNO_BRIDGE,
            bridgeProfile: "Diurno"
        }
    ]);

    const bridgeContract =
        getDiurnoBridgeContractForProfile("Diurno", keyLarga);

    assert.equal(
        getReplacementRotationModeForDate("Reemplazante", keyLarga),
        REPLACEMENT_ROTATION_MODE.DIURNO_BRIDGE
    );
    assert.equal(
        getReplacementBridgeProfileForDate("Reemplazante", keyLarga),
        "Diurno"
    );
    assert.equal(bridgeContract?.worker, "Reemplazante");
    assert.equal(
        replacementContractCoversCoveredShift(
            bridgeContract,
            keyLarga
        ),
        true
    );
    assert.equal(getTurnoBase("Diurno", keyLarga), TURNO.LARGA);
    assert.equal(getTurnoBase("Diurno", keyNoche), TURNO.NOCHE);
    assert.equal(getTurnoBase("Diurno", keyLibre), TURNO.LIBRE);
    assert.equal(getTurnoBase("Reemplazante", keyLarga), TURNO.DIURNO);
    assert.equal(getTurnoBase("Reemplazante", keySabado), TURNO.LIBRE);
});
