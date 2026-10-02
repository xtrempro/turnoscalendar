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

test("la salud del almacenamiento no llega a la pantalla de nadie", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
        new URL("../js/firebaseAppState.js", import.meta.url),
        "utf8"
    );
    const banner = await readFile(
        new URL("../js/syncBanner.js", import.meta.url),
        "utf8"
    );

    // Solo queda como metrica de la sesion; los avisos tecnicos viven en
    // TurnoPlus-Admin (checkStorageHealth), no en la app de supervisores.
    assert.match(source, /recordPerformanceEvent\("firebase-app-state:document-health"/);
    assert.doesNotMatch(source, /app-state-document-health/);
    assert.doesNotMatch(banner, /document-health|storage-health|is-storage/);
});
