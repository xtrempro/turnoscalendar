import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

function firebaseToolsModule(relativePath) {
    const npmRoot = process.platform === "win32"
        ? path.join(process.env.APPDATA, "npm", "node_modules")
        : execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();

    return require(path.join(npmRoot, "firebase-tools", "lib", relativePath));
}

export function firestoreValue(value) {
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
                        .filter(([, item]) => item !== undefined)
                        .map(([key, item]) => [key, firestoreValue(item)])
                )
            }
        };
    }

    return { stringValue: String(value) };
}

export function plainValue(value) {
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

    return undefined;
}

export function plainDocument(document) {
    return Object.fromEntries(
        Object.entries(document?.fields || {})
            .map(([key, value]) => [key, plainValue(value)])
    );
}

export async function createFirestoreRestClient(projectId) {
    const auth = firebaseToolsModule("auth.js");
    const account = auth.getProjectDefaultAccount(process.cwd()) ||
        auth.getGlobalDefaultAccount();

    if (!account?.tokens?.refresh_token) {
        throw new Error("Ejecuta firebase login antes de continuar.");
    }

    const tokens = await auth.getAccessToken(account.tokens.refresh_token, []);
    const root = `https://firestore.googleapis.com/v1/projects/${projectId}` +
        "/databases/(default)/documents";
    const headers = {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
        "X-Goog-User-Project": projectId
    };

    async function request(url, options = {}) {
        const response = await fetch(url, {
            ...options,
            headers: { ...headers, ...(options.headers || {}) }
        });
        const text = await response.text();

        if (response.status === 404) return null;
        if (!response.ok) {
            throw new Error(`${response.status} ${url}\n${text.slice(0, 1000)}`);
        }

        return text ? JSON.parse(text) : {};
    }

    function documentUrl(documentPath) {
        return `${root}/${documentPath}`;
    }

    async function getDocument(documentPath) {
        return request(documentUrl(documentPath));
    }

    async function patchDocument(
        documentPath,
        fields,
        updateMask = [],
        updateTime = "",
        options = {}
    ) {
        const url = new URL(documentUrl(documentPath));

        updateMask.forEach(fieldPath =>
            url.searchParams.append("updateMask.fieldPaths", fieldPath)
        );
        if (updateTime) {
            url.searchParams.set("currentDocument.updateTime", updateTime);
        } else if (options.mustNotExist === true) {
            url.searchParams.set("currentDocument.exists", "false");
        }

        return request(url, {
            method: "PATCH",
            body: JSON.stringify({ fields })
        });
    }

    async function runCollectionGroup(collectionId) {
        const result = await request(`${root}:runQuery`, {
            method: "POST",
            body: JSON.stringify({
                structuredQuery: {
                    from: [{ collectionId, allDescendants: true }]
                }
            })
        });

        return (Array.isArray(result) ? result : [])
            .map(item => item.document)
            .filter(Boolean);
    }

    async function listDocuments(collectionPath) {
        const documents = [];
        let pageToken = "";

        do {
            const url = new URL(`${root}/${collectionPath}`);
            url.searchParams.set("pageSize", "1000");
            url.searchParams.set("showMissing", "false");
            if (pageToken) url.searchParams.set("pageToken", pageToken);

            const page = await request(url);
            documents.push(...(page?.documents || []));
            pageToken = String(page?.nextPageToken || "");
        } while (pageToken);

        return documents;
    }

    return {
        documentUrl,
        getDocument,
        listDocuments,
        patchDocument,
        request,
        runCollectionGroup
    };
}
