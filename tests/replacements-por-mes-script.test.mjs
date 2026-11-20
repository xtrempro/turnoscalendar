// scripts/replacements-por-mes.mjs: corte atomico al documento por mes y vuelta atras.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    planShardSplit,
    rollbackReplacementsByMonth,
    splitReplacementsByMonth
} from "../scripts/replacements-por-mes.mjs";
import { firestoreValue, plainDocument } from "../scripts/lib/firebase-rest.mjs";

const ROOT = "https://firestore.test/v1/projects/demo/databases/(default)/documents";
const ENTRIES = "workspaces/ws/stateModules/turnos/entries";

// Firestore en memoria con commits atomicos y precondiciones (updateTime / exists).
function fakeFirestore(initial) {
    const docs = new Map();
    let clock = 0;
    const stamp = () => `2026-11-19T20:00:${String(++clock).padStart(2, "0")}Z`;
    const put = (docPath, fields) => {
        const updateTime = stamp();
        docs.set(docPath, { name: `projects/demo/databases/(default)/documents/${docPath}`, fields, updateTime,
            createTime: docs.get(docPath)?.createTime || updateTime });
    };

    Object.entries(initial).forEach(([docPath, data]) => put(docPath, Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, firestoreValue(value)])
    )));

    const pathOf = name => name.split("/documents/")[1];
    const client = {
        docs,
        commits: 0,
        documentUrl: docPath => `${ROOT}/${docPath}`,
        getDocument: async docPath => docs.get(docPath) || null,
        listDocuments: async collection => [...docs.entries()]
            .filter(([docPath]) => docPath.startsWith(`${collection}/`) && !docPath.slice(collection.length + 1).includes("/"))
            .map(([, document]) => document),
        async request(url, { body }) {
            assert.equal(url, `${ROOT}:commit`);
            const { writes } = JSON.parse(body);
            // Validar TODAS las precondiciones antes de aplicar nada.
            for (const write of writes) {
                const docPath = pathOf(write.update?.name || write.delete);
                const current = docs.get(docPath);
                const pre = write.currentDocument;
                if (pre?.exists === false && current) throw Object.assign(new Error("ALREADY_EXISTS"), { status: 409 });
                if (pre?.updateTime && current?.updateTime !== pre.updateTime) throw Object.assign(new Error("FAILED_PRECONDITION"), { status: 400 });
            }
            for (const write of writes) {
                if (write.delete) { docs.delete(pathOf(write.delete)); continue; }
                const docPath = pathOf(write.update.name);
                const fields = { ...(docs.get(docPath)?.fields || {}) };
                write.updateMask.fieldPaths.forEach(field => { fields[field] = write.update.fields[field]; });
                put(docPath, fields);
            }
            client.commits++;
            return {};
        }
    };
    return client;
}

const rec = (id, date, extra = {}) => JSON.stringify({ id, worker: "ANA", date, ...extra });
const legacyDoc = () => ({
    moduleId: "turnos", storageKey: "replacements", container: "array",
    items: {
        a: rec("a", "2026-10-03"),
        b: rec("b", "2026-11-20"),
        "coverage%3A2026-11-21%3AANA": rec("coverage:2026-11-21:ANA", "2026-11-21"),
        z: rec("z", "2026-11-22")
    },
    deletedItems: { z: true }
});
const unit = () => fakeFirestore({ "workspaces/ws": { name: "Unidad" }, [`${ENTRIES}/replacements`]: legacyDoc() });
const run = (fn, client, extra) => fn({ client, workspaceId: "ws", expectedName: "Unidad", logResult: () => {}, ...extra });

async function tempDir(t) {
    const dir = await mkdtemp(path.join(tmpdir(), "por-mes-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    return dir;
}

test("simulacion: reparte solo los vivos y no escribe", async () => {
    const client = unit();
    const result = await run(splitReplacementsByMonth, client);

    assert.equal(result.applied, false);
    assert.deepEqual(result.months.map(month => [month.month, month.count]), [["2026-10", 1], ["2026-11", 2]]);
    assert.equal(client.commits, 0);
});

test("corte: meses creados con las mismas cadenas, antiguo vacio y congelado, marca puesta, en un commit", async t => {
    const client = unit();
    const result = await run(splitReplacementsByMonth, client, { apply: true, backupDirectory: await tempDir(t) });

    assert.equal(result.verified, 3);
    assert.equal(client.commits, 1);

    const november = plainDocument(client.docs.get(`${ENTRIES}/replacements__2026-11`));
    assert.equal(november.storageKey, "replacements");
    assert.equal(november.shard, "2026-11");
    assert.equal(november.items["coverage%3A2026-11-21%3AANA"], legacyDoc().items["coverage%3A2026-11-21%3AANA"], "clave y cadena tal cual");
    assert.ok(!("z" in november.items), "el borrado no viaja");

    const legacy = plainDocument(client.docs.get(`${ENTRIES}/replacements`));
    assert.equal(legacy.frozen, true);
    assert.deepEqual(legacy.items, {});
    assert.equal(plainDocument(client.docs.get("workspaces/ws")).replacementShards, "monthly-v1");
});

test("si alguien escribe entre la lectura y el commit, no se aplica nada", async t => {
    const client = unit();
    const original = client.request.bind(client);
    client.request = async (url, options) => {
        // Una pestana guarda justo antes del commit: cambia el updateTime del antiguo.
        const legacy = client.docs.get(`${ENTRIES}/replacements`);
        client.docs.set(`${ENTRIES}/replacements`, { ...legacy, updateTime: "2026-11-19T21:00:00Z" });
        return original(url, options);
    };

    await assert.rejects(run(splitReplacementsByMonth, client, { apply: true, backupDirectory: await tempDir(t) }), /FAILED_PRECONDITION/);
    assert.ok(!client.docs.has(`${ENTRIES}/replacements__2026-11`), "ningun mes creado");
    assert.equal(plainDocument(client.docs.get(`${ENTRIES}/replacements`)).frozen, undefined);
});

test("se niega con otra unidad, con value, congelado o con meses ya creados", async t => {
    await assert.rejects(run(splitReplacementsByMonth, unit(), { expectedName: "Otra" }), /ABORTA/);
    assert.throws(() => planShardSplit({ ...legacyDoc(), value: "[]" }), /value/);
    assert.throws(() => planShardSplit({ ...legacyDoc(), frozen: true }), /congelado/);
    assert.throws(() => planShardSplit({ ...legacyDoc(), items: { x: "{roto" } }), /ilegibles/);

    const client = unit();
    await run(splitReplacementsByMonth, client, { apply: true, backupDirectory: await tempDir(t) });
    await assert.rejects(run(splitReplacementsByMonth, client), /Ya hay documentos por mes|congelado/);
});

test("vuelta atras: junta los meses, descongela, borra los meses y quita la marca", async t => {
    const client = unit();
    const dir = await tempDir(t);
    await run(splitReplacementsByMonth, client, { apply: true, backupDirectory: dir });

    // Despues del corte se agrego un reemplazo en noviembre.
    const novPath = `${ENTRIES}/replacements__2026-11`;
    const nov = client.docs.get(novPath);
    client.docs.set(novPath, { ...nov, fields: { ...nov.fields, items: firestoreValue({ ...plainDocument(nov).items, n: rec("n", "2026-11-25") }) } });

    const result = await run(rollbackReplacementsByMonth, client, { apply: true, backupDirectory: dir });

    assert.equal(result.live, 4);
    const legacy = plainDocument(client.docs.get(`${ENTRIES}/replacements`));
    assert.equal(legacy.frozen, false);
    assert.deepEqual(Object.keys(legacy.items).sort(), ["a", "b", "coverage%3A2026-11-21%3AANA", "n"]);
    assert.ok(![...client.docs.keys()].some(key => key.includes("replacements__")), "meses borrados");
    assert.equal(plainDocument(client.docs.get("workspaces/ws")).replacementShards, "");
});

// ---- Auditoria por mes (P2-2, P3-1, P3-2) ----

test("preflight: chunks, clave distinta del id, id repetido y marca ya puesta abortan sin escribir", async () => {
    const withChunk = unit();
    withChunk.docs.set("workspaces/ws/stateModules/turnos/chunks/0", { name: "x/chunks/0", fields: {}, updateTime: "t", createTime: "t" });
    await assert.rejects(run(splitReplacementsByMonth, withChunk), /chunks/);

    assert.throws(() => planShardSplit({ ...legacyDoc(), items: { otra: rec("a", "2026-10-03") } }), /no corresponde/);
    assert.throws(() => planShardSplit({ ...legacyDoc(), items: { a: rec("a", "2026-10-03"), "a%2E": rec("a.", "2026-10-03"), b: rec("a.", "2026-11-03") } }), /no corresponde|repetido/);

    const flagged = fakeFirestore({ "workspaces/ws": { name: "Unidad", replacementShards: "rollback-pending" }, [`${ENTRIES}/replacements`]: legacyDoc() });
    await assert.rejects(run(splitReplacementsByMonth, flagged), /ya tiene la marca/);
    assert.equal(withChunk.commits + flagged.commits, 0);
});

test("vuelta atras: aborta ante un estado mezclado (antiguo vivo + un mes, sin marca)", async () => {
    const client = fakeFirestore({
        "workspaces/ws": { name: "Unidad" },
        [`${ENTRIES}/replacements`]: legacyDoc(),
        [`${ENTRIES}/replacements__2026-11`]: { moduleId: "turnos", storageKey: "replacements", shard: "2026-11", items: { b: rec("b", "2026-11-20") }, deletedItems: {} }
    });

    await assert.rejects(run(rollbackReplacementsByMonth, client, { apply: true }), /no esta en modo mensual|mezclado/);
    assert.equal(client.commits, 0);
    assert.ok(Object.keys(plainDocument(client.docs.get(`${ENTRIES}/replacements`)).items).length > 1, "no piso el antiguo");
});

test("vuelta atras: cierra la entrada ANTES de enumerar, asi un mes creado entre medio entra en la reconstruccion", async t => {
    const client = unit();
    const dir = await tempDir(t);
    await run(splitReplacementsByMonth, client, { apply: true, backupDirectory: dir });

    // Una pestana en modo mensual crea enero despues de la primera lectura del
    // script y antes de que cierre la entrada (con las reglas, despues del
    // cierre ya no podria).
    const original = client.request.bind(client);
    let commits = 0;
    client.request = async (url, options) => {
        if (commits++ === 0) {
            client.docs.set(`${ENTRIES}/replacements__2027-01`, {
                name: `projects/demo/databases/(default)/documents/${ENTRIES}/replacements__2027-01`,
                fields: Object.fromEntries(Object.entries({ moduleId: "turnos", storageKey: "replacements", shard: "2027-01",
                    items: { j: rec("j", "2027-01-05") }, deletedItems: {} }).map(([key, value]) => [key, firestoreValue(value)])),
                updateTime: "2026-11-19T22:00:00Z", createTime: "2026-11-19T22:00:00Z"
            });
        }
        return original(url, options);
    };

    const result = await run(rollbackReplacementsByMonth, client, { apply: true, backupDirectory: dir });

    assert.equal(result.verified, 4);
    assert.ok("j" in plainDocument(client.docs.get(`${ENTRIES}/replacements`)).items, "enero reconstruido");
    assert.ok(![...client.docs.keys()].some(key => key.includes("replacements__")));
});

test("corte: una escritura legitima despues del commit se informa como actividad, no como corrupcion", async t => {
    const client = unit();
    const original = client.request.bind(client);
    client.request = async (url, options) => {
        const result = await original(url, options);
        // Alguien guarda en noviembre justo despues del corte.
        const novPath = `${ENTRIES}/replacements__2026-11`;
        const nov = client.docs.get(novPath);
        client.docs.set(novPath, { ...nov, updateTime: "2026-11-19T23:00:00Z",
            fields: { ...nov.fields, items: firestoreValue({ ...plainDocument(nov).items, n: rec("n", "2026-11-25") }) } });
        return result;
    };

    const logs = [];
    const result = await run(splitReplacementsByMonth, client, { apply: true, backupDirectory: await tempDir(t), logResult: line => logs.push(line) });

    assert.equal(result.applied, true);
    assert.equal(result.verified, false);
    assert.match(logs.join("\n"), /actividad posterior/);
    assert.match(logs.join("\n"), /replacements__2026-11/);
});
