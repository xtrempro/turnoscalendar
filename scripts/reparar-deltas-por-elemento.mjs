// Mantenimiento legado: solo inspeccion. --apply esta deshabilitado porque
// reemplaza value y borra items sin control de concurrencia, incluso en tasks.
// La credencial REST usa IAM; las reglas de clientes no protegen esta ruta.
//
// Repara los documentos de deltas que quedaron en formato "por elemento" sin
// que el cliente supiera leerlos.
//
// Un despliegue del 31-08-2026 empezo a partir listas y objetos por elemento,
// pero perdia el marcador que dice como reconstruirlos. Los documentos quedaron
// con `value` (la version entera, anterior) y `items` (los elementos nuevos), y
// el cliente ignora `value` cuando hay `items`: lo que solo viviera en `value`
// desaparecia. Es lo que hacia que un cambio de turno se viera aplicado y se
// revirtiera solo.
//
// La reparacion funde `items` sobre `value` -que es el orden correcto, porque
// `value` es la foto anterior- y borra `items` para que no quede la trampa.
// Sirve tanto para listas de registros con id como para objetos.
//
// Uso:
//   node scripts/reparar-deltas-por-elemento.mjs --workspace <ws>
//   --apply: bloqueado; una reparacion nueva requiere deltas o CAS revisados.
//
// Sin --apply solo muestra que haria. Con --all recorre todos los entornos.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const arg = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : "";
};

const PROJECT_ID = arg("--project") || "calendarioturnos-7c4d9";
const WORKSPACE = arg("--workspace");
const APPLY = args.includes("--apply");
if (APPLY) throw new Error("Rescate de tareas en solo lectura: --apply esta deshabilitado porque esta reparacion reemplaza documentos completos. Usar una reparacion por deltas o CAS revisada.");
const ALL = args.includes("--all");

const ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    "/databases/(default)/documents";

// Claves que SIEMPRE viajaron por elemento: esas estan bien y no se tocan.
const MAP_PREFIXES = [
    "data_", "baseData_", "blocked_", "admin_", "legal_", "comp_", "absences_",
    "hourReturns_", "clockMarks_", "shiftAssignmentHistory_", "leaveBalances_",
    "hheeReturnTransfers_"
];
const MODULES = [
    "profile", "turnos", "clockmarks", "requests", "memos", "swap", "hours",
    "weekly", "tasks", "agenda", "reports", "log", "system"
];

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

    cachedAccessToken = (
        await auth.getAccessToken(account.tokens.refresh_token, [])
    ).access_token;

    return cachedAccessToken;
}

async function api(pathname, options = {}) {
    const token = await accessToken();
    const response = await fetch(ROOT + pathname, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-Goog-User-Project": PROJECT_ID
        }
    });
    const text = await response.text();

    if (!response.ok) {
        throw new Error(`${response.status} ${pathname}\n${text.slice(0, 300)}`);
    }

    return text ? JSON.parse(text) : {};
}

function parseStored(raw, fallback) {
    if (raw === null || raw === undefined || raw === "") return fallback;

    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function decodeItemKey(key) {
    try {
        return decodeURIComponent(key);
    } catch {
        return key;
    }
}

/** Funde los elementos sobre el valor entero. Devuelve el JSON resultante. */
function mergeItems(valueRaw, items, deletedItems) {
    const base = parseStored(valueRaw, null);
    const entries = Object.entries(items).map(([encoded, field]) => ({
        key: decodeItemKey(encoded),
        raw: field?.stringValue,
        deleted: deletedItems[encoded]?.booleanValue === true
    }));

    if (Array.isArray(base)) {
        const list = base.slice();

        entries.forEach(entry => {
            const parsed = parseStored(entry.raw, null);
            const id = parsed && typeof parsed === "object"
                ? String(parsed.id ?? "")
                : entry.key;
            const index = list.findIndex(item =>
                String(item?.id ?? "") === String(id)
            );

            if (entry.deleted) {
                if (index >= 0) list.splice(index, 1);
                return;
            }

            if (!parsed || typeof parsed !== "object") return;

            if (index >= 0) list[index] = parsed;
            else list.push(parsed);
        });

        return { kind: `lista(${list.length})`, json: JSON.stringify(list) };
    }

    const map = base && typeof base === "object" ? { ...base } : {};

    entries.forEach(entry => {
        if (entry.deleted) {
            delete map[entry.key];
            return;
        }

        map[entry.key] = parseStored(entry.raw, entry.raw);
    });

    return { kind: `objeto(${Object.keys(map).length})`, json: JSON.stringify(map) };
}

async function workspaces() {
    if (WORKSPACE) return [{ id: WORKSPACE, name: WORKSPACE }];

    const page = await api("/workspaces?pageSize=100");

    return (page.documents || []).map(doc => ({
        id: doc.name.split("/").pop(),
        name: doc.fields?.name?.stringValue || ""
    }));
}

async function main() {
    if (!WORKSPACE && !ALL) {
        console.error("Falta --workspace <id>, o --all para recorrer todos.");
        process.exit(1);
    }

    console.log(`proyecto ${PROJECT_ID}   (solo lectura; escritura antigua deshabilitada)\n`);

    let reparados = 0;

    for (const workspace of await workspaces()) {
        for (const moduleId of MODULES) {
            let page = null;

            try {
                page = await api(
                    `/workspaces/${workspace.id}/stateModules/${moduleId}/entries?pageSize=300`
                );
            } catch {
                continue;
            }

            for (const doc of page.documents || []) {
                const fields = doc.fields || {};
                const storageKey = fields.storageKey?.stringValue ||
                    decodeItemKey(doc.name.split("/").pop());

                if (!Object.prototype.hasOwnProperty.call(fields, "items")) continue;
                if (MAP_PREFIXES.some(prefix => storageKey.startsWith(prefix))) continue;

                const items = fields.items?.mapValue?.fields || {};
                const deletedItems = fields.deletedItems?.mapValue?.fields || {};
                const merged = mergeItems(
                    fields.value?.stringValue,
                    items,
                    deletedItems
                );

                console.log(
                    `${workspace.name || workspace.id} · ${moduleId}/${storageKey}`
                );
                console.log(
                    `   items:${Object.keys(items).length}  ->  ${merged.kind}`
                );

                reparados += 1;

                if (!APPLY) continue;

                // Se reescribe `value` con la union y se borran `items`,
                // `deletedItems` y `container`: van en la mascara pero no en el
                // cuerpo, que es como Firestore borra un campo.
                const mask = [
                    "value",
                    "deleted",
                    "items",
                    "deletedItems",
                    "container",
                    "updatedAtISO"
                ].map(name => `updateMask.fieldPaths=${name}`).join("&");

                await api(
                    `/workspaces/${workspace.id}/stateModules/${moduleId}` +
                    `/entries/${encodeURIComponent(doc.name.split("/").pop())}?${mask}`,
                    {
                        method: "PATCH",
                        body: JSON.stringify({
                            fields: {
                                value: { stringValue: merged.json },
                                deleted: { booleanValue: false },
                                updatedAtISO: {
                                    stringValue: new Date().toISOString()
                                }
                            }
                        })
                    }
                );

                console.log("   reparado");
            }
        }
    }

    console.log(
        reparados
            ? `\n${reparados} documento(s)${APPLY ? " reparados" : " por reparar"}.`
            : "\nNada que reparar."
    );
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
