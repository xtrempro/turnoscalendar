import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../js/workerRequests.js", import.meta.url),
  "utf8"
);
const memos = await readFile(
  new URL("../js/memos.js", import.meta.url),
  "utf8"
);
const main = await readFile(
  new URL("../js/main.js", import.meta.url),
  "utf8"
);
const storageRules = await readFile(
  new URL("../storage.rules", import.meta.url),
  "utf8"
);

test("las solicitudes de marcaje conservan adjuntos sin recrear el modulo retirado", () => {
  assert.match(source, /function normalizeClockRequestDocuments\(request = \{\}\)/);
  assert.match(source, /sourceDocuments: normalizeClockRequestDocuments\(request\)/);
  assert.doesNotMatch(source, /saveClockMarks\(/);
  assert.doesNotMatch(source, /attachRequestDocumentsToClockMark/);
});

test("la tarjeta del supervisor muestra que la incidencia trae adjuntos", () => {
  assert.match(source, /request\.type === "missing_clock"/);
  assert.match(source, /request\.type === "clock_incident"/);
  assert.match(source, /const documentCount = normalizeClockRequestDocuments\(request\)\.length/);
  assert.match(source, /pieces\.push\(`\$\{documentCount\} adjunto\(s\)`\)/);
  assert.match(source, /data-worker-request-document="view"/);
  assert.match(source, /data-worker-request-document="download"/);
  assert.match(source, /openCachedAttachment\(document/);
});

test("al aceptar la incidencia el respaldo pasa a memorandum", () => {
  assert.match(source, /sourceDocuments: normalizeClockRequestDocuments\(request\)/);
  assert.match(source, /new CustomEvent\("proturnos:openMemos"\)/);
  assert.match(memos, /const sourceDocuments = Array\.isArray\(memo\.sourceDocuments\)/);
  assert.match(memos, /Estos respaldos no completan el memorándum/);
  assert.match(main, /setActiveShortcut\("memosPanel"\)/);
});

test("solicitudes y memorandum pueden leer respaldos de clockmarks", () => {
  assert.match(storageRules, /function canViewClockIncidentAttachment/);
  assert.match(storageRules, /canViewModule\(workspaceId, "requests"\)/);
  assert.match(storageRules, /canViewModule\(workspaceId, "memos"\)/);
});
