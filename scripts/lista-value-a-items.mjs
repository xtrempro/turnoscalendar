// Copia a `items` los registros de una lista que solo viven en `value`.
//
// Una entrada de lista guarda el estado en dos caras: `value` (la lista entera,
// formato viejo) e `items` (un campo por registro). Lo que vive solo en `value`
// se pierde si una sesion con la version anterior de la app vuelve a publicar
// la lista entera con una copia local incompleta: asi se perdieron 343
// reemplazos el 2026-09-15. Un registro que tambien esta en `items` sobrevive,
// porque los items se aplican encima de `value`.
//
// No cambia ningun dato: escribe como item el MISMO registro que ya se lee. No
// toca `value` ni los items que ya existen.
//
// Por defecto SOLO LEE. Uso:
//   node scripts/lista-value-a-items.mjs --modulo turnos --clave replacements
//   node scripts/lista-value-a-items.mjs --modulo turnos --clave replacements --apply

import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

function arg(name, fallback = "") {
    const index = process.argv.indexOf(name);

    return index !== -1 && process.argv[index + 1]
        ? process.argv[index + 1]
        : fallback;
}

const APPLY = process.argv.includes("--apply");
const PROJECT_ID = arg("--project", "calendarioturnos-7c4d9");
const WORKSPACE_ID = arg("--workspace", "Boh7mvO5ku9quFFsPcIq");
const MODULE_ID = arg("--modulo", "turnos");
const STORAGE_KEY = arg("--clave", "replacements");

const ENTRY_URL =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/workspaces/${WORKSPACE_ID}` +
    `/stateModules/${MODULE_ID}/entries/${encodeURIComponent(encodeURIComponent(STORAGE_KEY))}`;

const { mergePartialStateEntries, decodePartialStateItemKey, encodePartialStateItemKey } =
    await import(pathToFileURL(path.resolve("js/firebasePartialState.js")).href);

let cachedAccessToken = "";

async function accessToken() {
    if (cachedAccessToken) return cachedAccessToken;

    const auth = require(path.join(process.env.APPDATA, "npm", "node_modules", "firebase-tools", "lib", "auth.js"));
    const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount();

    if (!account?.tokens?.refresh_token) {
        throw new Error("Ejecuta firebase login antes de continuar.");
    }

    cachedAccessToken = (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token;
    return cachedAccessToken;
}

async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${await accessToken()}`,
            "Content-Type": "application/json",
            "X-Goog-User-Project": PROJECT_ID,
            ...(options.headers || {})
        }
    });
    const text = await response.text();

    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${response.status} ${url}\n${text.slice(0, 400)}`);

    return text ? JSON.parse(text) : {};
}

function fieldValue(value) {
    if (!value) return undefined;
    if ("stringValue" in value) return value.stringValue;
    if ("booleanValue" in value) return value.booleanValue;
    if ("mapValue" in value) {
        return Object.fromEntries(
            Object.entries(value.mapValue.fields || {}).map(([key, inner]) => [key, fieldValue(inner)])
        );
    }
    return undefined;
}

function readDocument(doc) {
    const data = Object.fromEntries(
        Object.entries(doc?.fields || {}).map(([key, value]) => [key, fieldValue(value)])
    );
    const base = { moduleId: MODULE_ID, storageKey: STORAGE_KEY };
    const entries = [];

    if (Object.prototype.hasOwnProperty.call(data, "value")) {
        entries.push({ ...base, itemKey: "", value: data.value, deleted: data.deleted === true });
    }

    const deleted = data.deletedItems || {};
    const itemIds = new Set();

    new Set([...Object.keys(data.items || {}), ...Object.keys(deleted)]).forEach(itemKey => {
        const id = decodePartialStateItemKey(itemKey);

        itemIds.add(id);
        entries.push({
            ...base,
            itemKey: id,
            container: data.container || "",
            value: data.items?.[itemKey],
            deleted: deleted[itemKey] === true
        });
    });

    const list = JSON.parse(mergePartialStateEntries({}, entries)[STORAGE_KEY] || "[]");

    return { list: Array.isArray(list) ? list : [], itemIds };
}

async function main() {
    console.log(`unidad ${WORKSPACE_ID}`);
    console.log(`clave  ${MODULE_ID}/${STORAGE_KEY}`);
    console.log(`modo   ${APPLY ? "ESCRITURA (--apply)" : "SOLO LECTURA"}\n`);

    const liveDoc = await api(ENTRY_URL);

    if (!liveDoc) throw new Error("No existe la entrada.");

    const { list, itemIds } = readDocument(liveDoc);
    const onlyInValue = list.filter(record => {
        const id = String(record?.id ?? "").trim();

        return id && !itemIds.has(id);
    });
    const withoutId = list.filter(record => !String(record?.id ?? "").trim());

    console.log(`registros en la lista:     ${list.length} (updateTime ${liveDoc.updateTime})`);
    console.log(`ya estan como item:        ${list.length - onlyInValue.length - withoutId.length}`);
    console.log(`solo en value (a copiar):  ${onlyInValue.length}`);
    if (withoutId.length) console.log(`sin id (no se pueden copiar): ${withoutId.length}`);

    if (!APPLY) {
        console.log("\nSOLO LECTURA. Para copiar: --apply");
        return;
    }

    if (!onlyInValue.length) {
        console.log("\nNada que copiar.");
        return;
    }

    const nextItems = { ...(liveDoc.fields?.items?.mapValue?.fields || {}) };
    const nextDeleted = { ...(liveDoc.fields?.deletedItems?.mapValue?.fields || {}) };

    onlyInValue.forEach(record => {
        const itemKey = encodePartialStateItemKey(record.id);

        nextItems[itemKey] = { stringValue: JSON.stringify(record) };
        nextDeleted[itemKey] = { booleanValue: false };
    });

    const stamp = new Date().toISOString();
    const body = {
        fields: {
            items: { mapValue: { fields: nextItems } },
            deletedItems: { mapValue: { fields: nextDeleted } },
            container: { stringValue: "array" },
            updatedAt: { timestampValue: stamp },
            updatedAtISO: { stringValue: stamp },
            clientId: { stringValue: "copia-value-a-items" }
        }
    };
    const mask = Object.keys(body.fields)
        .map(key => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
        .join("&");

    // Si alguien escribio entre la lectura y la escritura, falla en vez de
    // pisarlo: se vuelve a correr.
    await api(
        `${ENTRY_URL}?${mask}&currentDocument.updateTime=${encodeURIComponent(liveDoc.updateTime)}`,
        { method: "PATCH", body: JSON.stringify(body) }
    );

    const check = readDocument(await api(ENTRY_URL));
    const stillOnlyInValue = check.list.filter(record =>
        String(record?.id ?? "").trim() && !check.itemIds.has(String(record.id).trim())
    );

    console.log(
        `\nverificacion: ${check.list.length} registros (antes ${list.length}); ` +
        `solo en value: ${stillOnlyInValue.length} ` +
        (check.list.length === list.length && !stillOnlyInValue.length ? "OK" : "REVISAR")
    );
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
