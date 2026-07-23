// La Cloud Function personalBackupSync ancla el respaldo al RUT del trabajador.
// Lo critico: el RUT NO lo declara el cliente, se deriva del enlace canonico
// (workerLinks/{uid}.inviteId) y del profileRut de la invitacion, que fija el
// supervisor. Asi un trabajador solo puede tocar el respaldo de SU propio RUT.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("../functions/index.js", import.meta.url), "utf8");

function extract(name) {
    let start = src.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `no se encontro ${name}`);
    // Conserva el prefijo `async ` si lo tiene (si no, se pierde el await).
    if (src.slice(start - 6, start) === "async ") start -= 6;
    let depth = 0;
    for (let i = src.indexOf("{", start); i < src.length; i += 1) {
        if (src[i] === "{") depth += 1;
        else if (src[i] === "}") {
            depth -= 1;
            if (!depth) return src.slice(start, i + 1);
        }
    }
    throw new Error(`sin cierre: ${name}`);
}

class FakeHttpsError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

// Firestore falso: mapa de path -> data (o undefined si no existe).
function fakeDb(docs) {
    return {
        doc(path) {
            return {
                async get() {
                    const data = docs[path];
                    return { exists: data !== undefined, data: () => data };
                }
            };
        }
    };
}

function loadHelpers(docs) {
    const code = `
        ${extract("normalizeRutForBackup")}
        ${extract("trustedRutForWorker")}
        return { normalizeRutForBackup, trustedRutForWorker };
    `;
    return new Function("db", "HttpsError", code)(fakeDb(docs), FakeHttpsError);
}

test("normalizeRutForBackup deja solo digitos y K en mayuscula", () => {
    const { normalizeRutForBackup } = loadHelpers({});
    assert.equal(normalizeRutForBackup("17.816.632-8"), "178166328");
    assert.equal(normalizeRutForBackup("12.345.678-k"), "12345678K");
    assert.equal(normalizeRutForBackup(""), "");
});

test("el RUT se deriva de la invitacion, no del cliente", async () => {
    const { trustedRutForWorker } = loadHelpers({
        "workspaces/ws1/workerLinks/uidA": { uid: "uidA", inviteId: "inv1" },
        "workspaces/ws1/workerAppInvites/inv1": { profileRut: "17.816.632-8", workerUid: "uidA" }
    });

    const rut = await trustedRutForWorker("uidA", "ws1");
    assert.equal(rut, "178166328");
});

test("sin enlace en la unidad se rechaza (no puede leer datos ajenos)", async () => {
    const { trustedRutForWorker } = loadHelpers({
        // El uid NO tiene enlace en ws1.
        "workspaces/ws1/workerAppInvites/inv1": { profileRut: "17.816.632-8" }
    });

    await assert.rejects(
        () => trustedRutForWorker("intruso", "ws1"),
        (error) => error.code === "permission-denied"
    );
});

test("enlace sin invitacion o invitacion sin RUT devuelve vacio (no rompe)", async () => {
    const sinInvite = loadHelpers({
        "workspaces/ws1/workerLinks/uidA": { uid: "uidA", inviteId: "" }
    });
    assert.equal(await sinInvite.trustedRutForWorker("uidA", "ws1"), "");

    const inviteSinRut = loadHelpers({
        "workspaces/ws1/workerLinks/uidA": { uid: "uidA", inviteId: "inv1" },
        "workspaces/ws1/workerAppInvites/inv1": { profileRut: "" }
    });
    assert.equal(await inviteSinRut.trustedRutForWorker("uidA", "ws1"), "");
});

test("el payload gigante se rechaza", () => {
    const run = new Function("HttpsError", `
        ${extract("sanitizePersonalBackupPayload")}
        return sanitizePersonalBackupPayload;
    `)(FakeHttpsError);

    assert.equal(run(null), null);
    assert.deepEqual(run({ a: 1 }), { a: 1 });
    assert.throws(
        () => run({ big: "x".repeat(700001) }),
        (error) => error.code === "invalid-argument"
    );
});

test("la funcion nunca confia en un RUT enviado por el cliente", () => {
    const handler = src.slice(src.indexOf("exports.personalBackupSync"));
    const body = handler.slice(0, handler.indexOf("\nexports."));
    // El RUT sale de trustedRutForWorker, no de request.data.
    assert.match(body, /const rut = await trustedRutForWorker\(uid, workspaceId\)/);
    assert.doesNotMatch(body, /request\.data\?\.rut/);
    assert.doesNotMatch(body, /request\.data\.rut/);
});

test("la regla de Firestore niega el acceso directo a personalBackups", async () => {
    const rules = await readFile(new URL("../firebase.rules", import.meta.url), "utf8");
    assert.match(
        rules,
        /match \/personalBackups\/\{rutKey\} \{\s*allow read, write: if false;/
    );
});
