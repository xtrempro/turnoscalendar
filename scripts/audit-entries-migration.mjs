// Auditoria de solo lectura para una migracion de estado basada en `entries`.
// Compara el contenido logico entre dos workspaces, incluso si viven en
// proyectos Firebase distintos. No escribe ni corrige documentos.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const arg = name => {
    const index = args.indexOf(name);
    return index >= 0 ? String(args[index + 1] || "") : "";
};

const sourceProject = arg("--source-project") || "calendarioturnos-7c4d9";
const sourceWorkspace = arg("--source-workspace");
const targetProject = arg("--target-project") || "turnoplus-test-7c4d9";
const targetWorkspace = arg("--target-workspace");
const allowUnmarked = args.includes("--allow-unmarked");
const modules = (arg("--modules") ||
    "profile,turnos,clockmarks,swap,hours,weekly,tasks")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

if (!sourceWorkspace || !targetWorkspace) {
    throw new Error(
        "Faltan --source-workspace y/o --target-workspace."
    );
}

let cachedAccessToken = "";

function firebaseToolsModule(relativePath) {
    const npmRoot = process.platform === "win32"
        ? path.join(process.env.APPDATA, "npm", "node_modules")
        : execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();

    return require(path.join(npmRoot, "firebase-tools", "lib", relativePath));
}

async function accessToken() {
    if (cachedAccessToken) return cachedAccessToken;

    const auth = firebaseToolsModule("auth.js");
    const account =
        auth.getProjectDefaultAccount(process.cwd()) ||
        auth.getGlobalDefaultAccount();

    if (!account?.tokens?.refresh_token) {
        throw new Error("Ejecuta firebase login antes de continuar.");
    }

    const tokens = await auth.getAccessToken(account.tokens.refresh_token, []);
    cachedAccessToken = tokens.access_token;
    return cachedAccessToken;
}

async function api(projectId, documentPath, query = {}) {
    const token = await accessToken();
    const url = new URL(
        `https://firestore.googleapis.com/v1/projects/${projectId}` +
        `/databases/(default)/documents/${documentPath}`
    );
    Object.entries(query).forEach(([key, value]) => {
        if (value !== "" && value !== undefined) url.searchParams.set(key, value);
    });

    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            "X-Goog-User-Project": projectId
        }
    });
    const text = await response.text();

    if (!response.ok) {
        throw new Error(`${response.status} ${url}\n${text.slice(0, 500)}`);
    }

    return text ? JSON.parse(text) : {};
}

function plainValue(value) {
    if (!value || typeof value !== "object") return value;
    if ("nullValue" in value) return null;
    if ("stringValue" in value) return value.stringValue;
    if ("booleanValue" in value) return value.booleanValue;
    if ("integerValue" in value) return Number(value.integerValue);
    if ("doubleValue" in value) return Number(value.doubleValue);
    if ("timestampValue" in value) return value.timestampValue;
    if ("arrayValue" in value) {
        return (value.arrayValue.values || []).map(plainValue);
    }
    if ("mapValue" in value) {
        return Object.fromEntries(
            Object.entries(value.mapValue.fields || {})
                .map(([key, item]) => [key, plainValue(item)])
        );
    }
    return value;
}

function plainDocument(document) {
    return Object.fromEntries(
        Object.entries(document.fields || {})
            .map(([key, value]) => [key, plainValue(value)])
    );
}

async function listDocuments(projectId, collectionPath) {
    const documents = [];
    let pageToken = "";

    do {
        const page = await api(projectId, collectionPath, {
            pageSize: "300",
            pageToken,
            orderBy: "__name__"
        });
        documents.push(...(page.documents || []));
        pageToken = String(page.nextPageToken || "");
    } while (pageToken);

    return documents;
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== "object") return value;

    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map(key => [key, canonical(value[key])])
    );
}

function logicalEntry(document) {
    const data = plainDocument(document);
    const logical = {
        storageKey: data.storageKey || "",
        itemKey: data.itemKey || "",
        container: data.container || "",
        deleted: data.deleted === true,
        value: data.value,
        items: data.items,
        deletedItems: data.deletedItems
    };

    return JSON.stringify(canonical(logical));
}

function entryMultiset(documents) {
    const counts = new Map();
    documents.forEach(document => {
        const signature = logicalEntry(document);
        counts.set(signature, (counts.get(signature) || 0) + 1);
    });
    return counts;
}

function compareMultisets(source, target) {
    let missing = 0;
    let extra = 0;
    const signatures = new Set([...source.keys(), ...target.keys()]);

    signatures.forEach(signature => {
        const difference = (source.get(signature) || 0) -
            (target.get(signature) || 0);
        if (difference > 0) missing += difference;
        if (difference < 0) extra += -difference;
    });

    return { missing, extra };
}

const rows = [];

for (const moduleId of modules) {
    const source = await listDocuments(
        sourceProject,
        `workspaces/${sourceWorkspace}/stateModules/${moduleId}/entries`
    );
    const target = await listDocuments(
        targetProject,
        `workspaces/${targetWorkspace}/stateModules/${moduleId}/entries`
    );
    const difference = compareMultisets(
        entryMultiset(source),
        entryMultiset(target)
    );

    rows.push({
        module: moduleId,
        source: source.length,
        target: target.length,
        missing: difference.missing,
        extra: difference.extra,
        ok: difference.missing === 0 && difference.extra === 0
    });
}

const targetRoot = plainDocument(await api(
    targetProject,
    `workspaces/${targetWorkspace}`
));

console.table(rows);
console.log(`Destino stateStorage: ${targetRoot.stateStorage || "(sin marca)"}`);

if (!allowUnmarked && targetRoot.stateStorage !== "entries-v1") {
    throw new Error("El destino no esta marcado como entries-v1.");
}

if (rows.some(row => !row.ok)) {
    throw new Error("La auditoria encontro diferencias de contenido.");
}

console.log("Auditoria correcta: contenido logico identico en todos los modulos.");
