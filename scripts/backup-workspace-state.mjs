// Respaldo de solo lectura del estado modular de un workspace.
// El archivo se escribe fuera del repositorio y contiene lo necesario para
// reconstruir los documentos raiz, manifiestos y colecciones `entries`.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const arg = name => {
    const index = args.indexOf(name);
    return index >= 0 ? String(args[index + 1] || "") : "";
};
const projectId = arg("--project") || "calendarioturnos-7c4d9";
const workspaceId = arg("--workspace");
const output = arg("--output");
const modules = (arg("--modules") ||
    "profile,qualifications,turnos,clockmarks,requests,memos,informations," +
    "medicalEquipment,tenders,swap,hours,weekly,tasks,agenda,reports,home,system")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

if (!workspaceId || !output) {
    throw new Error("Faltan --workspace y/o --output.");
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
    const account = auth.getProjectDefaultAccount(process.cwd()) ||
        auth.getGlobalDefaultAccount();

    if (!account?.tokens?.refresh_token) {
        throw new Error("Ejecuta firebase login antes de continuar.");
    }

    const tokens = await auth.getAccessToken(account.tokens.refresh_token, []);
    cachedAccessToken = tokens.access_token;
    return cachedAccessToken;
}

async function request(documentPath, query = {}) {
    const token = await accessToken();
    const url = new URL(
        `https://firestore.googleapis.com/v1/projects/${projectId}` +
        `/databases/(default)/documents/${documentPath}`
    );
    Object.entries(query).forEach(([key, value]) => {
        if (value) url.searchParams.set(key, value);
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

async function optionalDocument(documentPath) {
    try {
        return await request(documentPath);
    } catch (error) {
        if (String(error?.message || "").startsWith("404 ")) return null;
        throw error;
    }
}

async function listDocuments(collectionPath) {
    const documents = [];
    let pageToken = "";

    do {
        const page = await request(collectionPath, {
            pageSize: "300",
            pageToken,
            orderBy: "__name__"
        });
        documents.push(...(page.documents || []));
        pageToken = String(page.nextPageToken || "");
    } while (pageToken);

    return documents;
}

const stateModules = {};

for (const moduleId of modules) {
    const documentPath = `workspaces/${workspaceId}/stateModules/${moduleId}`;
    const [document, entries] = await Promise.all([
        optionalDocument(documentPath),
        listDocuments(`${documentPath}/entries`)
    ]);
    stateModules[moduleId] = { document, entries };
}

const backup = {
    format: "turnoplus-workspace-state-backup-v1",
    createdAt: new Date().toISOString(),
    projectId,
    workspaceId,
    workspace: await request(`workspaces/${workspaceId}`),
    stateModules
};

await mkdir(path.dirname(path.resolve(output)), { recursive: true });
await writeFile(
    path.resolve(output),
    `${JSON.stringify(backup, null, 2)}\n`,
    "utf8"
);

const entryCount = Object.values(stateModules)
    .reduce((total, item) => total + item.entries.length, 0);
console.log(`Respaldo creado: ${path.resolve(output)}`);
console.log(`Modulos: ${modules.length}; entradas: ${entryCount}`);
