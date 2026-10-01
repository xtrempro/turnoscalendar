// Inventario de solo lectura de documentos `entries`. Estima el tamano real
// que ocupan value, items y lapidas, y detecta migraciones incompletas.

import { assessFirestoreDocumentHealth } from "../js/firestoreDocumentHealth.js";
import {
    createFirestoreRestClient,
    plainDocument
} from "./lib/firebase-rest.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback = "") => {
    const index = args.indexOf(name);
    return index >= 0 ? String(args[index + 1] || "") : fallback;
};
const PROJECT_ID = arg("--project", "calendarioturnos-7c4d9");
const JSON_OUTPUT = args.includes("--json");
const FAIL_ON_CRITICAL = args.includes("--fail-on-critical");

function decodeItemKey(value) {
    try {
        return decodeURIComponent(String(value || ""));
    } catch {
        return String(value || "");
    }
}

function parsedLegacyValue(value) {
    if (typeof value !== "string") return null;

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function migrationCoverage(data = {}) {
    const legacy = parsedLegacyValue(data.value);
    const items = data.items && typeof data.items === "object" ? data.items : {};
    const itemIds = new Set(Object.keys(items).map(decodeItemKey));

    if (Array.isArray(legacy)) {
        const ids = legacy
            .map(item => String(item?.id ?? "").trim())
            .filter(Boolean);
        const invalid = legacy.length - ids.length;

        return {
            shape: "array",
            legacyCount: legacy.length,
            onlyInValue: ids.filter(id => !itemIds.has(id)).length,
            invalid
        };
    }

    if (legacy && typeof legacy === "object") {
        const keys = Object.keys(legacy);

        return {
            shape: "object",
            legacyCount: keys.length,
            onlyInValue: keys.filter(key => !itemIds.has(key)).length,
            invalid: 0
        };
    }

    return {
        shape: legacy === null ? "none" : "scalar",
        legacyCount: 0,
        onlyInValue: 0,
        invalid: 0
    };
}

function documentPath(document) {
    return String(document.name || "").split("/documents/")[1] || "";
}

const client = await createFirestoreRestClient(PROJECT_ID);
const documents = await client.runCollectionGroup("entries");
const rows = documents.map(document => {
    const data = plainDocument(document);
    const path = documentPath(document);
    const health = assessFirestoreDocumentHealth(data, path);
    const deletedItems = data.deletedItems && typeof data.deletedItems === "object"
        ? data.deletedItems
        : {};
    const coverage = migrationCoverage(data);

    return {
        path,
        workspaceId: path.split("/")[1] || "",
        module: String(data.moduleId || ""),
        key: String(data.storageKey || ""),
        level: health.level,
        percent: health.percent,
        estimatedKiB: Math.round(health.estimatedBytes / 1024),
        hasValue: Object.prototype.hasOwnProperty.call(data, "value"),
        itemCount: Object.keys(data.items || {}).length,
        tombstones: Object.values(deletedItems).filter(Boolean).length,
        ...coverage
    };
}).sort((a, b) => b.estimatedKiB - a.estimatedKiB);

const risky = rows.filter(row => row.level !== "healthy");
const mixed = rows.filter(row => row.hasValue && row.itemCount > 0);
const incomplete = mixed.filter(row => row.onlyInValue > 0 || row.invalid > 0);

if (JSON_OUTPUT) {
    console.log(JSON.stringify({
        projectId: PROJECT_ID,
        documentCount: rows.length,
        risky,
        mixed,
        incomplete
    }, null, 2));
} else {
    console.log(`Proyecto: ${PROJECT_ID}`);
    console.log(`Documentos entries: ${rows.length}`);
    console.log(
        `En alerta: ${risky.length}; mixtos value/items: ${mixed.length}; ` +
        `migracion incompleta: ${incomplete.length}`
    );
    if (risky.length) {
        console.log("\nDOCUMENTOS SOBRE UMBRAL");
        console.table(risky.map(row => ({
            nivel: row.level,
            porcentaje: row.percent,
            KiB: row.estimatedKiB,
            modulo: row.module,
            clave: row.key,
            lapidas: row.tombstones,
            ruta: row.path
        })));
    }
    if (incomplete.length) {
        console.log("\nNO SE PUEDE RETIRAR value");
        console.table(incomplete.map(row => ({
            unidad: row.workspaceId,
            modulo: row.module,
            clave: row.key,
            soloEnValue: row.onlyInValue,
            invalidos: row.invalid
        })));
    }
}

if (FAIL_ON_CRITICAL && risky.some(row => row.level === "critical")) {
    process.exitCode = 2;
}
