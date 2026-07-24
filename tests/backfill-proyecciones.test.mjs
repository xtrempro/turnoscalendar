// El backfill programado reproyecta a los trabajadores ENLAZADOS que aun no
// tienen workerAppData (se enlazaron antes del trigger onCreate). Se auto-limita
// por existencia de workerAppData y solo mira los IDs (select), no descarga las
// proyecciones completas.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("../functions/workerAppProjection.js", import.meta.url), "utf8");

function grab(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `no se encontro ${name}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error(`sin cierre: ${name}`);
}

const missingProjectionProfiles = new Function(
  `${grab("missingProjectionProfiles")}\nreturn missingProjectionProfiles;`
)();

test("devuelve los perfiles enlazados sin workerAppData", () => {
  const links = [
    { uid: "u1", profileName: "Daniela Velarde" }, // sin data -> falta
    { uid: "u2", profileName: "Joaquin Torres" },  // con data -> ok
    { uid: "u3", profileName: "Sin Data" }         // sin data -> falta
  ];
  const dataIds = ["u2"];

  assert.deepEqual(
    missingProjectionProfiles(links, dataIds).sort(),
    ["Daniela Velarde", "Sin Data"]
  );
});

test("si todos tienen workerAppData no hay nada que reproyectar", () => {
  const links = [{ uid: "u1", profileName: "A" }, { uid: "u2", profileName: "B" }];
  assert.deepEqual(missingProjectionProfiles(links, ["u1", "u2"]), []);
});

test("ignora enlaces sin uid o sin profileName", () => {
  const links = [
    { uid: "", profileName: "Sin uid" },
    { uid: "u2", profileName: "" },
    { uid: "u3", profileName: "Valido" }
  ];
  assert.deepEqual(missingProjectionProfiles(links, []), ["Valido"]);
});

test("no repite un mismo perfil", () => {
  const links = [
    { uid: "u1", profileName: "Repetido" },
    { uid: "u2", profileName: "Repetido" }
  ];
  assert.deepEqual(missingProjectionProfiles(links, []), ["Repetido"]);
});

test("la funcion programada usa select (solo IDs) y se auto-limita", () => {
  // Lee solo IDs para no descargar proyecciones completas.
  assert.match(src, /\.collection\("workerAppData"\)\.select\(\)\.get\(\)/);
  assert.match(src, /\.collection\("workerLinks"\)\.select\("uid", "profileName"\)\.get\(\)/);
  // Encola un projectionRequest por workspace con los faltantes.
  assert.match(src, /source: "backfill_missing"/);
  assert.match(src, /exports\.backfillMissingWorkerProjections = onSchedule\(/);
  assert.match(src, /schedule: "every 24 hours"/);
});
