import assert from "node:assert/strict";
import test from "node:test";
import {
    assessFirestoreDocumentHealth,
    estimateFirestoreDocumentBytes
} from "../js/firestoreDocumentHealth.js";

test("el estimador incluye value, items y lapidas", () => {
    const base = estimateFirestoreDocumentBytes({
        moduleId: "log",
        storageKey: "auditLog",
        items: { uno: "x".repeat(1000) }
    }, "workspaces/u/stateModules/log/entries/auditLog");
    const complete = estimateFirestoreDocumentBytes({
        moduleId: "log",
        storageKey: "auditLog",
        value: "y".repeat(2000),
        items: { uno: "x".repeat(1000), dos: "null" },
        deletedItems: { dos: true }
    }, "workspaces/u/stateModules/log/entries/auditLog");

    assert.ok(complete > base + 2000);
});

test("avisa al 70 por ciento y escala al 85 por ciento", () => {
    const warning = assessFirestoreDocumentHealth(
        { value: "x".repeat(710) },
        "doc",
        { limitBytes: 1000 }
    );
    const critical = assessFirestoreDocumentHealth(
        { value: "x".repeat(880) },
        "doc",
        { limitBytes: 1000 }
    );

    assert.equal(warning.level, "warning");
    assert.equal(critical.level, "critical");
});

test("un documento holgado permanece saludable", () => {
    const result = assessFirestoreDocumentHealth(
        { value: "x".repeat(100) },
        "doc",
        { limitBytes: 1000 }
    );

    assert.equal(result.level, "healthy");
    assert.ok(result.percent < 70);
});
