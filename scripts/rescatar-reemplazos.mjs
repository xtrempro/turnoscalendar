// Rescate de reemplazos perdidos, con Point-in-Time Recovery.
//
// Incidente del 2026-09-15 13:38 UTC, Imagenologia: un navegador con la lista
// local de reemplazos vacia confirmo un guardado, y la confirmacion publico la
// lista entera -1 registro- en el campo `value`, encima de los 492 que habia.
// Los `items` (formato por elemento) sobrevivieron; lo que vivia solo en `value`
// se perdio: 341 registros, 248 activos.
//
// Por defecto SOLO LEE. Con --apply repone los registros que estaban en el
// instante bueno y hoy no estan, como ITEMS del documento: un `value` pisado de
// nuevo por otro navegador ya no los puede borrar. No toca `value` ni los
// registros que siguen existiendo (si alguien los edito despues, manda lo suyo).
//
// Uso:
//   node scripts/rescatar-reemplazos.mjs --desde 2026-09-15T13:37:00Z
//   node scripts/rescatar-reemplazos.mjs --desde 2026-09-15T13:37:00Z --apply

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
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
const FROM = arg("--desde", "2026-09-15T13:37:00Z");
const OUT = arg("--salida", "reemplazos-rescatados.json");
// Ids a dejar fuera (por ejemplo, coberturas que ya se volvieron a asignar).
const SKIP = new Set(arg("--omitir", "").split(",").map(value => value.trim()).filter(Boolean));

const DOCUMENTS_ROOT =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    "/databases/(default)/documents";
const ENTRY_URL =
    `${DOCUMENTS_ROOT}/workspaces/${WORKSPACE_ID}` +
    "/stateModules/turnos/entries/replacements";

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

// La lista como la ve la app: `value` primero y los `items` encima.
function readList(doc) {
    const data = Object.fromEntries(
        Object.entries(doc?.fields || {}).map(([key, value]) => [key, fieldValue(value)])
    );
    const base = { moduleId: "turnos", storageKey: "replacements" };
    const entries = [];

    if (Object.prototype.hasOwnProperty.call(data, "value")) {
        entries.push({ ...base, itemKey: "", value: data.value, deleted: data.deleted === true });
    }

    const deleted = data.deletedItems || {};

    new Set([...Object.keys(data.items || {}), ...Object.keys(deleted)]).forEach(itemKey => {
        entries.push({
            ...base,
            itemKey: decodePartialStateItemKey(itemKey),
            container: data.container || "",
            value: data.items?.[itemKey],
            deleted: deleted[itemKey] === true
        });
    });

    return JSON.parse(mergePartialStateEntries({}, entries).replacements || "[]");
}

const short = name => {
    const parts = String(name || "").trim().split(/\s+/);
    return parts.length > 2 ? `${parts[0]} ${parts[parts.length - 2]}` : String(name || "-");
};

async function main() {
    console.log(`unidad ${WORKSPACE_ID}`);
    console.log(`bueno  ${FROM}`);
    console.log(`modo   ${APPLY ? "ESCRITURA (--apply)" : "SOLO LECTURA"}\n`);

    const [goodDoc, liveDoc] = await Promise.all([
        api(`${ENTRY_URL}?readTime=${encodeURIComponent(FROM)}`),
        api(ENTRY_URL)
    ]);
    const good = readList(goodDoc);
    const live = readList(liveDoc);
    const liveIds = new Set(live.map(record => record?.id));
    const missing = good.filter(record => record?.id && !liveIds.has(record.id));

    // Una cobertura que alguien volvio a asignar despues de ver el "!": mismo
    // dia, mismo ausente y mismo turno, activa en vivo. Reponer la vieja la
    // duplicaria.
    const liveActive = live.filter(record => record && !record.canceled);
    const duplicateOf = record => record.replaced && liveActive.find(other =>
        other.date === record.date &&
        other.replaced === record.replaced &&
        String(other.turno) === String(record.turno)
    );
    const duplicates = missing.filter(record => !record.canceled && duplicateOf(record));
    const toRestore = missing.filter(record =>
        !SKIP.has(record.id) && !(!record.canceled && duplicateOf(record))
    );

    const byMonth = {};
    toRestore.forEach(record => {
        const month = String(record.date || "").slice(0, 7);
        byMonth[month] = (byMonth[month] || 0) + 1;
    });

    console.log(`en el instante bueno: ${good.length} registros`);
    console.log(`en vivo:              ${live.length} registros (updateTime ${liveDoc.updateTime})`);
    console.log(`faltan:               ${missing.length} (activos ${missing.filter(record => !record.canceled).length})`);
    console.log(`ya reasignados (no se reponen): ${duplicates.length}`);
    duplicates.forEach(record => {
        const other = duplicateOf(record);
        console.log(`  ${record.date} t${record.turno} ausente=${short(record.replaced)} antes=${short(record.worker)} ahora=${short(other.worker)}  ${record.id}`);
    });
    console.log(`a reponer:            ${toRestore.length}  por mes ${JSON.stringify(byMonth)}`);

    writeFileSync(
        OUT,
        JSON.stringify({ readTime: FROM, workspaceId: WORKSPACE_ID, liveUpdateTime: liveDoc.updateTime, toRestore, duplicates }, null, 2),
        "utf8"
    );
    console.log(`respaldo en ${OUT}`);

    if (!APPLY) {
        console.log("\nSOLO LECTURA. Para reponer: --apply");
        return;
    }

    if (!toRestore.length) {
        console.log("\nNada que reponer.");
        return;
    }

    const liveItems = liveDoc.fields?.items?.mapValue?.fields || {};
    const liveDeleted = liveDoc.fields?.deletedItems?.mapValue?.fields || {};
    const nextItems = { ...liveItems };
    const nextDeleted = { ...liveDeleted };

    toRestore.forEach(record => {
        const itemKey = encodePartialStateItemKey(record.id);

        nextItems[itemKey] = { stringValue: JSON.stringify(record) };
        nextDeleted[itemKey] = { booleanValue: false };
    });

    // Hora ACTUAL: ninguna sesion debe creer que la reposicion es vieja.
    const stamp = new Date().toISOString();
    const body = {
        fields: {
            items: { mapValue: { fields: nextItems } },
            deletedItems: { mapValue: { fields: nextDeleted } },
            container: { stringValue: "array" },
            updatedAt: { timestampValue: stamp },
            updatedAtISO: { stringValue: stamp },
            clientId: { stringValue: `rescate-pitr-${FROM}` }
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

    const check = readList(await api(ENTRY_URL));
    const checkIds = new Set(check.map(record => record?.id));
    const stillMissing = toRestore.filter(record => !checkIds.has(record.id));

    console.log(`\nverificacion: ${check.length} registros en vivo; faltan de lo repuesto: ${stillMissing.length} ${stillMissing.length ? "REVISAR" : "OK"}`);
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
