// Al crear el enlace del trabajador (acepta la invitacion) se encola su
// proyeccion sin depender del navegador del supervisor. Antes, un trabajador
// enlazado con el supervisor desconectado se quedaba sin turnos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("../functions/workerAppProjection.js", import.meta.url), "utf8");

// Extrae el handler async (event) => {...} de un export dado.
function extractHandler(exportName) {
  const anchor = src.indexOf(`exports.${exportName} =`);
  assert.notEqual(anchor, -1, `no se encontro ${exportName}`);
  const start = src.indexOf("async (event) => {", anchor);
  assert.notEqual(start, -1, "no se encontro el handler");
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (!depth) return src.slice(src.indexOf("async (event) =>", anchor), i + 1);
    }
  }
  throw new Error("sin cierre del handler");
}

function makeRun(added) {
  const db = {
    collection: () => db,
    doc: () => db,
    add: async (payload) => { added.push(payload); return { id: "req-x" }; }
  };
  const admin = {
    firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => "TS" } })
  };
  const logger = { info() {}, warn() {}, error() {} };
  const handlerSrc = extractHandler("requestProjectionOnWorkerLink");
  // eslint-disable-next-line no-new-func
  return new Function("admin", "logger", `return (${handlerSrc});`)(admin, logger);
}

test("dispara sobre workerLinks/{workerUid}", () => {
  assert.match(src, /document: "workspaces\/\{workspaceId\}\/workerLinks\/\{workerUid\}"/);
});

test("encola un projectionRequest con el perfil del enlace", async () => {
  const added = [];
  const run = makeRun(added);
  await run({
    params: { workspaceId: "ws1", workerUid: "uidA" },
    data: { data: () => ({ profileName: "Daniela Velarde", uid: "uidA" }) }
  });

  assert.equal(added.length, 1);
  assert.deepEqual(added[0].profiles, ["Daniela Velarde"]);
  assert.equal(added[0].source, "worker_link_created");
  assert.equal(added[0].requestedAt, "TS");
});

test("sin profileName no encola nada (no rompe)", async () => {
  const added = [];
  const run = makeRun(added);
  await run({
    params: { workspaceId: "ws1", workerUid: "uidA" },
    data: { data: () => ({ uid: "uidA" }) }
  });

  assert.equal(added.length, 0);
});

test("el modulo exporta la nueva funcion y la de proyeccion", () => {
  assert.match(src, /exports\.requestProjectionOnWorkerLink = onDocumentCreated\(/);
  assert.match(src, /exports\.buildWorkerAppProjection = onDocumentCreated\(/);
});
