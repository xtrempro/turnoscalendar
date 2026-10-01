// Activa o retira la escritura fragmentada de bitacora para una unidad.

import {
    createFirestoreRestClient,
    firestoreValue,
    plainDocument
} from "./lib/firebase-rest.mjs";

const args = process.argv.slice(2);
const arg = name => {
    const index = args.indexOf(name);
    return index >= 0 ? String(args[index + 1] || "") : "";
};
const PROJECT_ID = arg("--project") || "calendarioturnos-7c4d9";
const WORKSPACE_ID = arg("--workspace");
const EXPECTED_NAME = arg("--expected-name");
const VALUE = arg("--value");
const APPLY = args.includes("--apply");

if (
    !WORKSPACE_ID ||
    !EXPECTED_NAME ||
    !["shards-shadow-v1", "legacy"].includes(VALUE)
) {
    throw new Error(
        "Usa --workspace, --expected-name y " +
        "--value shards-shadow-v1|legacy."
    );
}

const client = await createFirestoreRestClient(PROJECT_ID);
const documentPath = `workspaces/${encodeURIComponent(WORKSPACE_ID)}`;
const document = await client.getDocument(documentPath);
if (!document) throw new Error("La unidad no existe.");

const data = plainDocument(document);
if (String(data.name || "") !== EXPECTED_NAME) {
    throw new Error(
        `ABORTA: se esperaba "${EXPECTED_NAME}" y la unidad es ` +
        `"${data.name || "(sin nombre)"}".`
    );
}

console.log(`Proyecto: ${PROJECT_ID}`);
console.log(`Unidad: ${EXPECTED_NAME} [${WORKSPACE_ID}]`);
console.log(`auditLogStorage: ${data.auditLogStorage || "(sin marca)"} -> ${VALUE}`);

if (!APPLY) {
    console.log("Simulacion: agrega --apply para escribir.");
    process.exit(0);
}

await client.patchDocument(
    documentPath,
    { auditLogStorage: firestoreValue(VALUE) },
    ["auditLogStorage"],
    document.updateTime
);
console.log("Marca aplicada y verificada por precondicion de version.");
