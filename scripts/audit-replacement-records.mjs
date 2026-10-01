// Compara la lista autoritativa de reemplazos con la coleccion individual.
// Por defecto solo lee. --apply exige una unidad y su nombre exacto, y crea
// unicamente los documentos faltantes; nunca pisa ni elimina documentos.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);

function arg(name, fallback = "") {
    const index = args.indexOf(name);

    return index >= 0 ? String(args[index + 1] || "") : fallback;
}

const PROJECT_ID = arg("--project", "calendarioturnos-7c4d9");
const WORKSPACE_ID = arg("--workspace");
const INCLUDE_ALL = args.includes("--all");
const APPLY = args.includes("--apply");
const EXPECTED_NAME = arg("--expected-name");
const SHOW_LIMIT = Math.max(1, Number(arg("--show", "10")) || 10);
const DOCUMENTS_ROOT =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    "/databases/(default)/documents";

function firebaseToolsModule(relativePath) {
    const npmRoot = process.platform === "win32"
        ? path.join(process.env.APPDATA, "npm", "node_modules")
        : execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();

    return require(path.join(npmRoot, "firebase-tools", "lib", relativePath));
}

const auth = firebaseToolsModule("auth.js");
const account = auth.getProjectDefaultAccount(process.cwd()) ||
    auth.getGlobalDefaultAccount();

if (!account?.tokens?.refresh_token) {
    throw new Error("Ejecuta firebase login antes de continuar.");
}

const tokens = await auth.getAccessToken(account.tokens.refresh_token, []);
const headers = {
    Authorization: `Bearer ${tokens.access_token}`,
    "X-Goog-User-Project": PROJECT_ID
};

async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...headers,
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {})
        }
    });

    if (response.status === 404) return null;

    const body = await response.json();

    if (!response.ok) {
        throw new Error(`${response.status} ${url}\n${JSON.stringify(body).slice(0, 500)}`);
    }

    return body;
}

function firestoreValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === "string") return { stringValue: value };
    if (typeof value === "boolean") return { booleanValue: value };
    if (typeof value === "number") {
        return Number.isInteger(value)
            ? { integerValue: String(value) }
            : { doubleValue: value };
    }
    if (Array.isArray(value)) {
        return { arrayValue: { values: value.map(firestoreValue) } };
    }
    if (typeof value === "object") {
        return {
            mapValue: {
                fields: Object.fromEntries(
                    Object.entries(value)
                        .filter(([, inner]) => inner !== undefined)
                        .map(([key, inner]) => [key, firestoreValue(inner)])
                )
            }
        };
    }

    return { stringValue: String(value) };
}

async function createIndividualRecord(workspaceId, record) {
    const recordId = String(record?.id || "").trim();
    const documentId = encodeURIComponent(recordId);
    const url = new URL(
        `${DOCUMENTS_ROOT}/workspaces/${encodeURIComponent(workspaceId)}` +
        `/replacementRecords/${encodeURIComponent(documentId)}`
    );
    const now = new Date().toISOString();

    url.searchParams.set("currentDocument.exists", "false");

    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(record?.date || ""))
        ? String(record.date)
        : "";
    const fields = {
        recordId: { stringValue: recordId },
        record: firestoreValue(record),
        deleted: { booleanValue: false },
        revision: { integerValue: "1" },
        updatedAtISO: { stringValue: now },
        updatedAt: { timestampValue: now },
        clientId: { stringValue: "audit-backfill-v1" }
    };

    if (date) {
        fields.date = { stringValue: date };
        fields.month = { stringValue: date.slice(0, 7) };
    }

    await api(url, {
        method: "PATCH",
        body: JSON.stringify({ fields })
    });
}

async function createMissingRecords(workspaceId, records) {
    const size = 10;

    for (let offset = 0; offset < records.length; offset += size) {
        await Promise.all(
            records.slice(offset, offset + size).map(record =>
                createIndividualRecord(workspaceId, record)
            )
        );
    }
}

async function patchIndividualRecordDate(document, date) {
    const data = documentData(document);
    const documentPath = String(document.name || "").split("/documents/")[1];

    if (!documentPath || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

    const now = new Date().toISOString();
    const url = new URL(`${DOCUMENTS_ROOT}/${documentPath}`);
    const fieldPaths = [
        "date",
        "month",
        "revision",
        "updatedAtISO",
        "updatedAt",
        "clientId"
    ];

    fieldPaths.forEach(fieldPath =>
        url.searchParams.append("updateMask.fieldPaths", fieldPath)
    );
    url.searchParams.set("currentDocument.updateTime", document.updateTime);

    await api(url, {
        method: "PATCH",
        body: JSON.stringify({
            fields: {
                date: { stringValue: date },
                month: { stringValue: date.slice(0, 7) },
                revision: {
                    integerValue: String(Math.max(1, Number(data.revision || 0) + 1))
                },
                updatedAtISO: { stringValue: now },
                updatedAt: { timestampValue: now },
                clientId: { stringValue: "audit-date-backfill-v1" }
            }
        })
    });
}

async function patchIndividualRecordDates(records) {
    const size = 10;

    for (let offset = 0; offset < records.length; offset += size) {
        await Promise.all(records.slice(offset, offset + size).map(item =>
            patchIndividualRecordDate(item.document, item.date)
        ));
    }
}

function fieldValue(value) {
    if (!value) return undefined;
    if ("nullValue" in value) return null;
    if ("stringValue" in value) return value.stringValue;
    if ("booleanValue" in value) return value.booleanValue;
    if ("integerValue" in value) return Number(value.integerValue);
    if ("doubleValue" in value) return Number(value.doubleValue);
    if ("timestampValue" in value) return value.timestampValue;
    if ("arrayValue" in value) {
        return (value.arrayValue.values || []).map(fieldValue);
    }
    if ("mapValue" in value) {
        return Object.fromEntries(
            Object.entries(value.mapValue.fields || {}).map(
                ([key, inner]) => [key, fieldValue(inner)]
            )
        );
    }

    return undefined;
}

function documentData(document) {
    return Object.fromEntries(
        Object.entries(document?.fields || {}).map(
            ([key, value]) => [key, fieldValue(value)]
        )
    );
}

async function listDocuments(collectionPath) {
    const documents = [];
    let pageToken = "";

    do {
        const url = new URL(`${DOCUMENTS_ROOT}/${collectionPath}`);
        url.searchParams.set("pageSize", "1000");
        url.searchParams.set("showMissing", "false");
        if (pageToken) url.searchParams.set("pageToken", pageToken);

        const page = await api(url);
        documents.push(...(page?.documents || []));
        pageToken = String(page?.nextPageToken || "");
    } while (pageToken);

    return documents;
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== "object") return value;

    return Object.keys(value).sort().reduce((result, key) => {
        result[key] = stableValue(value[key]);
        return result;
    }, {});
}

function signature(value) {
    return JSON.stringify(stableValue(value));
}

function parseLegacyRecords(document) {
    const data = documentData(document);
    let records = [];

    try {
        records = JSON.parse(String(data.value || "[]"));
    } catch {
        records = [];
    }

    if (!Array.isArray(records)) records = [];

    const byId = new Map();
    const invalid = [];
    const duplicates = [];

    records.forEach(record => {
        const id = String(record?.id || "").trim();

        if (!id) {
            invalid.push(record);
            return;
        }
        if (byId.has(id)) duplicates.push(id);
        byId.set(id, record);
    });

    const items = data.items && typeof data.items === "object" ? data.items : {};
    const deletedItems = data.deletedItems && typeof data.deletedItems === "object"
        ? data.deletedItems
        : {};

    new Set([...Object.keys(items), ...Object.keys(deletedItems)])
        .forEach(encodedId => {
            let id = encodedId;

            try {
                id = decodeURIComponent(encodedId);
            } catch {
                // La clave ya es util para el diagnostico aunque no decodifique.
            }

            if (deletedItems[encodedId] === true) {
                byId.delete(id);
                return;
            }

            if (!(encodedId in items)) return;

            try {
                const record = JSON.parse(String(items[encodedId] || "null"));
                const recordId = String(record?.id || id || "").trim();

                if (!record || typeof record !== "object" || !recordId) {
                    invalid.push(record);
                    return;
                }

                byId.set(recordId, record);
            } catch {
                invalid.push({ encodedId, unparsable: true });
            }
        });

    return { byId, invalid, duplicates };
}

function parseIndividualRecords(documents) {
    const active = new Map();
    const tombstones = new Set();
    const allIds = new Set();
    const invalid = [];
    const documentsById = new Map();

    documents.forEach(document => {
        const data = documentData(document);
        const id = String(data.recordId || data.record?.id || "").trim();

        if (!id) {
            invalid.push(document.name || "documento sin nombre");
            return;
        }

        allIds.add(id);
        documentsById.set(id, { document, data });

        if (data.deleted === true) {
            tombstones.add(id);
            return;
        }

        if (!data.record || typeof data.record !== "object") {
            invalid.push(id);
            return;
        }

        active.set(id, data.record);
    });

    return { active, tombstones, allIds, invalid, documentsById };
}

function sample(values) {
    const list = [...values];
    const visible = list.slice(0, SHOW_LIMIT);
    const remaining = list.length - visible.length;

    return `${visible.join(", ")}${remaining > 0 ? ` ... (+${remaining})` : ""}`;
}

async function auditWorkspace(workspace) {
    const id = workspace.id;
    const entry = await api(
        `${DOCUMENTS_ROOT}/workspaces/${encodeURIComponent(id)}` +
        "/stateModules/turnos/entries/replacements"
    );
    const individualDocuments = await listDocuments(
        `workspaces/${encodeURIComponent(id)}/replacementRecords`
    );
    const legacy = parseLegacyRecords(entry);
    const individual = parseIndividualRecords(individualDocuments);
    const missing = [];
    const extra = [];
    const different = [];
    const activeTombstones = [];
    const missingQueryDates = [];

    legacy.byId.forEach((record, id) => {
        if (!individual.active.has(id)) {
            missing.push(id);
            if (individual.tombstones.has(id)) activeTombstones.push(id);
            return;
        }

        if (signature(record) !== signature(individual.active.get(id))) {
            different.push(id);
        }
    });

    individual.active.forEach((_record, id) => {
        if (!legacy.byId.has(id)) extra.push(id);
    });

    individual.documentsById.forEach(({ document, data }, recordId) => {
        const date = String(
            data.record?.date || legacy.byId.get(recordId)?.date || ""
        );

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
        if (data.date === date && data.month === date.slice(0, 7)) return;

        missingQueryDates.push({ recordId, date, document });
    });

    const issueCount = missing.length + extra.length + different.length +
        missingQueryDates.length + legacy.invalid.length +
        legacy.duplicates.length + individual.invalid.length;
    const latestIndividualUpdate = individualDocuments
        .map(document => String(document.updateTime || ""))
        .filter(Boolean)
        .sort()
        .at(-1) || "";

    console.log(`\n${workspace.name} [${id}]`);
    console.log(`  modo: ${workspace.replacementStorage || "(sin marca)"}`);
    if (issueCount) {
        console.log(
            `  owner: ${workspace.createdByEmail || "(sin correo)"}` +
            `  legacy actualizado=${entry?.updateTime || "(sin documento)"}` +
            `  individual actualizado=${latestIndividualUpdate || "(sin documentos)"}`
        );
    }
    console.log(
        `  legacy=${legacy.byId.size}  individuales=${individual.active.size}` +
        `  tombstones=${individual.tombstones.size}`
    );
    console.log(
        `  faltan=${missing.length}  extras=${extra.length}` +
        `  distintos=${different.length}  invalidos=${legacy.invalid.length + individual.invalid.length}` +
        `  ids-duplicados=${legacy.duplicates.length}` +
        `  sin-fecha-consultable=${missingQueryDates.length}`
    );
    if (missing.length) console.log(`  IDs faltantes: ${sample(missing)}`);
    if (activeTombstones.length) {
        console.log(`  activos legacy con tombstone: ${sample(activeTombstones)}`);
    }
    if (extra.length) console.log(`  IDs extras: ${sample(extra)}`);
    if (different.length) console.log(`  IDs distintos: ${sample(different)}`);
    if (legacy.duplicates.length) {
        console.log(`  IDs duplicados legacy: ${sample(legacy.duplicates)}`);
    }
    if (missingQueryDates.length) {
        console.log(
            `  IDs sin fecha consultable: ${sample(missingQueryDates.map(item => item.recordId))}`
        );
    }

    if (APPLY) {
        if (workspace.name !== EXPECTED_NAME) {
            throw new Error(
                `ABORTA: se esperaba "${EXPECTED_NAME}" y la unidad es ` +
                `"${workspace.name}".`
            );
        }

        const recordsToCreate = missing
            .filter(recordId => !individual.allIds.has(recordId))
            .map(recordId => legacy.byId.get(recordId))
            .filter(Boolean);

        if (recordsToCreate.length) {
            await createMissingRecords(id, recordsToCreate);
            console.log(`  BACKFILL: creados ${recordsToCreate.length} documentos.`);
        } else {
            console.log("  BACKFILL: no hay documentos faltantes para crear.");
        }

        const protectedMissing = missing.length - recordsToCreate.length;
        if (protectedMissing) {
            console.log(
                `  BACKFILL: ${protectedMissing} faltantes ya tienen documento o ` +
                "tombstone y no fueron sobrescritos."
            );
        }

        if (missingQueryDates.length) {
            await patchIndividualRecordDates(missingQueryDates);
            console.log(
                `  BACKFILL: ${missingQueryDates.length} documentos recibieron date/month.`
            );
        } else {
            console.log("  BACKFILL: todas las fechas consultables ya estan listas.");
        }
    }

    return {
        id,
        name: workspace.name,
        legacyCount: legacy.byId.size,
        individualCount: individual.active.size,
        tombstoneCount: individual.tombstones.size,
        missingCount: missing.length,
        extraCount: extra.length,
        differentCount: different.length,
        missingQueryDateCount: missingQueryDates.length,
        issueCount
    };
}

async function main() {
    if (APPLY && (!WORKSPACE_ID || !EXPECTED_NAME)) {
        throw new Error(
            "--apply exige --workspace y --expected-name para evitar escribir " +
            "en otra unidad."
        );
    }

    const workspaceDocuments = WORKSPACE_ID
        ? [await api(`${DOCUMENTS_ROOT}/workspaces/${encodeURIComponent(WORKSPACE_ID)}`)]
        : await listDocuments("workspaces");
    const allWorkspaces = workspaceDocuments
        .filter(Boolean)
        .map(document => {
            const data = documentData(document);
            return {
                id: document.name.split("/").pop(),
                name: String(data.name || "Sin nombre"),
                replacementStorage: String(data.replacementStorage || ""),
                createdByEmail: String(data.createdByEmail || "")
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
    const workspaces = allWorkspaces
        .filter(workspace =>
            WORKSPACE_ID || INCLUDE_ALL ||
            workspace.replacementStorage === "records-shadow-v1"
        );
    const withoutShadow = allWorkspaces.filter(workspace =>
        workspace.replacementStorage !== "records-shadow-v1"
    );

    console.log(`Proyecto: ${PROJECT_ID}`);
    console.log(`Unidades totales: ${allWorkspaces.length}`);
    console.log(`Unidades auditadas: ${workspaces.length}`);
    if (!WORKSPACE_ID) {
        console.log(`Unidades sin modo sombra: ${withoutShadow.length}`);
        if (withoutShadow.length) {
            console.log(`  ${sample(withoutShadow.map(workspace =>
                `${workspace.name} [${workspace.id}]`
            ))}`);
        }
    }
    console.log(`Modo: ${APPLY ? "BACKFILL SEGURO" : "SOLO LECTURA"}`);

    const results = [];

    for (const workspace of workspaces) {
        results.push(await auditWorkspace(workspace));
    }

    const issues = results.reduce((sum, result) => sum + result.issueCount, 0);
    const legacy = results.reduce((sum, result) => sum + result.legacyCount, 0);
    const individual = results.reduce(
        (sum, result) => sum + result.individualCount,
        0
    );

    console.log("\nRESUMEN");
    console.log(
        `  unidades=${results.length}  legacy=${legacy}` +
        `  individuales=${individual}  discrepancias=${issues}`
    );
    process.exitCode = issues ? 2 : 0;
}

main().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
