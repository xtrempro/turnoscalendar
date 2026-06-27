import assert from "node:assert/strict";
import test from "node:test";
import {
    REPLACEMENT_ROTATION_MODE,
    normalizeReplacementRotationMode,
    replacementRotationModeLabel
} from "../js/replacementRotation.js";
import {
    PROFILE_MODE,
    profileDraft,
    resetProfileDraft
} from "../js/profileDraft.js";
import { validateProfileDraft } from "../js/profileValidation.js";

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
        contractType: "Reemplazo"
    });

    assert.deepEqual(validateProfileDraft(), { ok: true });
});
