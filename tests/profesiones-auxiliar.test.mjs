import test from "node:test";
import assert from "node:assert/strict";

import {
    AUXILIARY_PROFESSIONS,
    getProfessionOptionsForEstamento,
    normalizeProfession
} from "../js/storage.js";

test("Auxiliar ofrece Conductor como profesion disponible", () => {
    assert.deepEqual(AUXILIARY_PROFESSIONS, ["Conductor"]);
    assert.deepEqual(
        getProfessionOptionsForEstamento("Auxiliar"),
        ["Conductor"]
    );
    assert.equal(
        normalizeProfession("conductor", "Auxiliar"),
        "Conductor"
    );
});

test("Conductor no aparece en el catalogo Administrativo", () => {
    assert.equal(
        getProfessionOptionsForEstamento("Administrativo")
            .includes("Conductor"),
        false
    );
});

test("Administrativo ofrece Radioperadora como profesion disponible", () => {
    assert.equal(
        getProfessionOptionsForEstamento("Administrativo")
            .includes("Radioperadora"),
        true
    );
    assert.equal(
        normalizeProfession("radioperadora", "Administrativo"),
        "Radioperadora"
    );
});

test("Radioperadora no aparece en el catalogo Auxiliar", () => {
    assert.equal(
        getProfessionOptionsForEstamento("Auxiliar")
            .includes("Radioperadora"),
        false
    );
});
