// Activa o retira la marca de almacenamiento autoritativo de una unidad.
// Exige ID y nombre esperados para reducir el riesgo de marcar otra unidad.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const arg = name => {
    const index = args.indexOf(name);
    return index >= 0 ? String(args[index + 1] || "") : "";
};
const projectId = arg("--project") || "calendarioturnos-7c4d9";
const workspaceId = arg("--workspace");
const expectedName = arg("--expected-name");
const value = arg("--value");
const apply = args.includes("--apply");

if (!workspaceId || !expectedName || !["entries-v1", "legacy"].includes(value)) {
    throw new Error(
        "Usa --workspace, --expected-name y --value entries-v1|legacy."
    );
}

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
const documentUrl =
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/(default)/documents/workspaces/${workspaceId}`;
const headers = {
    Authorization: `Bearer ${tokens.access_token}`,
    "Content-Type": "application/json",
    "X-Goog-User-Project": projectId
};
const currentResponse = await fetch(documentUrl, { headers });
const current = await currentResponse.json();

if (!currentResponse.ok) {
    throw new Error(`${currentResponse.status} ${JSON.stringify(current)}`);
}

const actualName = String(current.fields?.name?.stringValue || "");
const previous = String(current.fields?.stateStorage?.stringValue || "");

if (actualName !== expectedName) {
    throw new Error(
        `ABORTA: se esperaba "${expectedName}" y el workspace es "${actualName}".`
    );
}

console.log(`proyecto: ${projectId}`);
console.log(`workspace: ${workspaceId}`);
console.log(`nombre: ${actualName}`);
console.log(`stateStorage: ${previous || "(sin marca)"} -> ${value}`);

if (!apply) {
    console.log("Simulacion: agrega --apply para escribir.");
    process.exit(0);
}

const patchUrl = new URL(documentUrl);
patchUrl.searchParams.append("updateMask.fieldPaths", "stateStorage");
const response = await fetch(patchUrl, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
        fields: {
            stateStorage: { stringValue: value }
        }
    })
});
const result = await response.json();

if (!response.ok) {
    throw new Error(`${response.status} ${JSON.stringify(result)}`);
}

console.log(
    `Aplicado: ${result.fields?.stateStorage?.stringValue || "(sin marca)"}`
);
