import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    backfillReplacementRecordDates,
    planReplacementRecordDateBackfill
} from "../scripts/backfill-replacement-record-dates.mjs";
import { firestoreRestRequest, firestoreValue, plainDocument } from "../scripts/lib/firebase-rest.mjs";

const COLLECTION = "workspaces/ws/replacementRecords";

function raw(id, data, updateTime = "2026-09-28T00:48:32.215815Z") {
    return {
        name: `projects/demo/databases/(default)/documents/${COLLECTION}/${id}`,
        updateTime,
        fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, firestoreValue(value)]))
    };
}

// Lo que se ve en produccion: carga inicial sin fecha arriba, escrituras nuevas
// con fecha, un id que ya viene codificado y un tombstone.
function fixture({ conflictIds = [] } = {}) {
    const docs = new Map([
        ["sin-fecha", raw("sin-fecha", { recordId: "sin-fecha", deleted: false, revision: 1, record: { id: "sin-fecha", date: "2026-08-10", worker: "Ana" } })],
        ["coverage%3A2026-10-24%3AANA", raw("coverage%3A2026-10-24%3AANA", { recordId: "coverage:2026-10-24:ANA", deleted: false, revision: 3, record: { id: "coverage:2026-10-24:ANA", date: "2026-10-24" } })],
        ["con-fecha", raw("con-fecha", { recordId: "con-fecha", deleted: false, revision: 2, date: "2026-11-02", month: "2026-11", record: { id: "con-fecha", date: "2026-11-02" } })],
        ["borrado", raw("borrado", { recordId: "borrado", deleted: true, revision: 4 })]
    ]);
    const calls = [];
    const client = {
        getDocument: async target => target === "workspaces/ws" ? raw("ws", { name: "Unidad" }) : null,
        listDocuments: async collection => {
            assert.equal(collection, COLLECTION);
            return [...docs.values()];
        },
        async patchDocument(target, fields, mask, updateTime) {
            calls.push({ target, fields, mask, updateTime });
            const id = decodeURIComponent(target.slice(COLLECTION.length + 1));
            const current = docs.get(id);

            assert.ok(current, `documento inexistente: ${target}`);
            if (conflictIds.includes(id) || updateTime !== current.updateTime) {
                // La app lo reescribio con su payload completo, que trae fecha.
                const record = plainDocument(current).record;
                docs.set(id, raw(id, { ...plainDocument(current), date: record.date, month: record.date.slice(0, 7) }, "2026-11-19T15:00:00Z"));
                throw Object.assign(new Error("400 FAILED_PRECONDITION"), { status: 400, code: "FAILED_PRECONDITION" });
            }
            docs.set(id, { ...current, fields: { ...current.fields, ...fields }, updateTime: "2026-11-19T15:00:01Z" });
        }
    };
    return { client, calls, docs };
}

const run = (f, extra = {}) => backfillReplacementRecordDates({
    client: f.client, projectId: "demo", workspaceId: "ws", expectedName: "Unidad",
    logResult: () => {}, ...extra
});

test("planifica solo los vivos sin fecha arriba y no toca tombstones", () => {
    const plan = planReplacementRecordDateBackfill([...fixture().docs.values()]);

    assert.deepEqual(plan.patches.map(patch => [patch.id, patch.date, patch.month]), [
        ["sin-fecha", "2026-08-10", "2026-08"],
        ["coverage%3A2026-10-24%3AANA", "2026-10-24", "2026-10"]
    ]);
    assert.equal(plan.alreadyDated, 1);
    assert.equal(plan.tombstones, 1);
});

test("sin --apply no escribe ni respalda", async () => {
    const f = fixture();
    const result = await run(f);

    assert.equal(result.toComplete, 2);
    assert.equal(result.written, 0);
    assert.deepEqual(f.calls, []);
});

test("con --apply respalda, escribe solo date/month con precondicion y verifica", async t => {
    const dir = await mkdtemp(path.join(tmpdir(), "backfill-dates-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const f = fixture();
    const before = plainDocument(f.docs.get("sin-fecha"));
    const result = await run(f, { apply: true, backupDirectory: dir });

    assert.equal(result.written, 2);
    for (const call of f.calls) {
        assert.deepEqual(call.mask, ["date", "month"]);
        assert.deepEqual(Object.keys(call.fields).sort(), ["date", "month"]);
        assert.ok(call.updateTime, "lleva la precondicion");
    }
    // El id con `%` va codificado otra vez en la ruta.
    assert.ok(f.calls.some(call => call.target.endsWith("/coverage%253A2026-10-24%253AANA")));

    const after = plainDocument(f.docs.get("sin-fecha"));
    assert.deepEqual(after.record, before.record, "el reemplazo no cambia");
    assert.equal(after.revision, before.revision, "la revision no cambia");
    assert.equal(after.date, "2026-08-10");
    assert.equal(after.month, "2026-08");

    const [backup] = await readdir(dir);
    const saved = JSON.parse(await readFile(path.join(dir, backup), "utf8"));
    assert.equal(saved.documents.length, 2, "respalda solo lo que cambia");
});

test("si la app reescribio un documento, la precondicion no lo pisa y la verificacion pasa", async t => {
    const dir = await mkdtemp(path.join(tmpdir(), "backfill-dates-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const f = fixture({ conflictIds: ["sin-fecha"] });
    const result = await run(f, { apply: true, backupDirectory: dir });

    assert.equal(result.written, 1);
    assert.equal(result.conflicts.length, 1);
    assert.equal(plainDocument(f.docs.get("sin-fecha")).date, "2026-08-10");
});

test("rechaza otra unidad y una fecha ilegible sin escribir", async () => {
    await assert.rejects(run(fixture(), { expectedName: "Otra" }), /ABORTA/);

    const f = fixture();
    f.docs.set("rota", raw("rota", { recordId: "rota", deleted: false, revision: 1, record: { id: "rota", date: "10-08-2026" } }));
    await assert.rejects(run(f, { apply: true }), /ilegible/);
    assert.deepEqual(f.calls, []);
});

// Auditoria GPT 19-11, P2-1: "ya tiene fecha" exige que coincida con record.date.
test("metadatos de otro mes se corrigen; una fecha imposible o rota no se certifica", () => {
    const base = { recordId: "x", deleted: false, revision: 1 };
    const plan = planReplacementRecordDateBackfill([
        raw("otro-mes", { ...base, recordId: "otro-mes", date: "2026-10-10", month: "2026-09", record: { id: "otro-mes", date: "2026-11-10" } }),
        raw("rota-con-arriba", { ...base, recordId: "rota-con-arriba", date: "2026-11-10", month: "2026-11", record: { id: "rota-con-arriba", date: "10-11-2026" } }),
        raw("imposible", { ...base, recordId: "imposible", record: { id: "imposible", date: "2026-13-40" } }),
        raw("bisiesto-falso", { ...base, recordId: "bisiesto-falso", record: { id: "bisiesto-falso", date: "2026-02-29" } })
    ]);

    assert.deepEqual(plan.patches.map(patch => [patch.id, patch.date, patch.month]), [
        ["otro-mes", "2026-11-10", "2026-11"]
    ]);
    assert.deepEqual(plan.unreadable.map(item => item.id).sort(), ["bisiesto-falso", "imposible", "rota-con-arriba"]);
    assert.equal(plan.alreadyDated, 0);
});

// Auditoria GPT 19-11, P3-1: solo una precondicion fallida es un conflicto.
test("un error de permisos detiene el script en vez de contarse como conflicto", async t => {
    const dir = await mkdtemp(path.join(tmpdir(), "backfill-dates-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const f = fixture();
    const original = f.client.patchDocument;
    let calls = 0;
    f.client.patchDocument = async (...args) => {
        calls++;
        if (calls === 2) throw Object.assign(new Error("403 PERMISSION_DENIED"), { status: 403, code: "PERMISSION_DENIED" });
        return original.apply(f.client, args);
    };

    await assert.rejects(run(f, { apply: true, backupDirectory: dir }), /no es de version.*403 PERMISSION_DENIED.*Ya se escribieron 1/s);
    assert.equal(calls, 2, "no sigue despues del error permanente");
});

// Auditoria fase 0, P3-2: un 404 al ESCRIBIR no es "no existe": no se escribio.
test("un PATCH 404 se propaga y detiene el script; un GET 404 sigue siendo null", async t => {
    const response = (status, body) => ({ status, ok: status < 300, text: async () => JSON.stringify(body) });
    const notFound = response(404, { error: { status: "NOT_FOUND" } });

    assert.equal(await firestoreRestRequest("u", {}, { fetchImpl: async () => notFound }), null);
    await assert.rejects(
        firestoreRestRequest("u", { method: "PATCH" }, { fetchImpl: async () => notFound }),
        error => error.status === 404 && error.code === "NOT_FOUND"
    );

    const dir = await mkdtemp(path.join(tmpdir(), "backfill-dates-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const f = fixture();
    let calls = 0;
    // El documento desaparecio entre la lectura y la escritura.
    f.client.patchDocument = async () => {
        calls++;
        await firestoreRestRequest("u", { method: "PATCH" }, { fetchImpl: async () => notFound });
    };

    await assert.rejects(run(f, { apply: true, backupDirectory: dir }), /no es de version.*404 NOT_FOUND.*Ya se escribieron 0/s);
    assert.equal(calls, 1);
});
