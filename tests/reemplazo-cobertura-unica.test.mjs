import test from "node:test";
import assert from "node:assert/strict";

import { replacementCoverageRecordId } from "../js/replacements.js";

const base = {
    replaced: "LUIS AINOL RAMIREZ"
};

test("una cobertura completa tiene una clave unica por ausente y fecha", () => {
    const first = replacementCoverageRecordId(
        { ...base, worker: "AMBAR" },
        "2026-09-02"
    );
    const concurrent = replacementCoverageRecordId(
        { ...base, worker: "GERALDINE" },
        "2026-09-02"
    );

    assert.equal(first, concurrent);
    assert.match(first, /:full$/);
});

test("tramos horarios explicitos pueden pertenecer a reemplazantes distintos", () => {
    const morning = replacementCoverageRecordId({
        ...base,
        coverFrom: "08:00",
        coverUntil: "13:00"
    }, "2026-09-02");
    const afternoon = replacementCoverageRecordId({
        ...base,
        coverFrom: "13:00",
        coverUntil: "20:00"
    }, "2026-09-02");

    assert.notEqual(morning, afternoon);
    assert.match(morning, /:08:00-13:00$/);
    assert.match(afternoon, /:13:00-20:00$/);
});

test("un horario incompleto se trata como cobertura completa", () => {
    assert.match(
        replacementCoverageRecordId({
            ...base,
            coverFrom: "08:00"
        }, "2026-09-02"),
        /:full$/
    );
});
