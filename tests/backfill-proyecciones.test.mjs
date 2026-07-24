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
const projectedUidsFromDocs = new Function(
  `${grab("projectedUidsFromDocs")}\nreturn projectedUidsFromDocs;`
)();

test("solo cuentan como proyectados los workerAppData con status", () => {
  const docs = [
    { id: "u1", status: "active" },        // proyectado
    { id: "u2", status: "profile_not_found" }, // proyectado (aunque no calce)
    { id: "u3" },                          // parcial (sin status) -> NO
    { id: "u4", status: "  " }             // status vacio -> NO
  ];
  assert.deepEqual(projectedUidsFromDocs(docs).sort(), ["u1", "u2"]);
});

test("faltan los enlazados sin proyeccion real (incluye docs parciales)", () => {
  const links = [
    { uid: "u1", profileName: "Daniela Velarde" }, // proyectado -> ok
    { uid: "u2", profileName: "Joaquin Torres" },  // doc parcial sin status -> falta
    { uid: "u3", profileName: "Sin Data" }         // sin doc -> falta
  ];
  const projectedUids = ["u1"]; // solo u1 tiene status

  assert.deepEqual(
    missingProjectionProfiles(links, projectedUids).sort(),
    ["Joaquin Torres", "Sin Data"]
  );
});

test("si todos tienen proyeccion real no hay nada que reproyectar", () => {
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

test("la funcion programada lee solo lo justo (select) y se auto-limita", () => {
  // Lee solo el status de workerAppData (no descarga las proyecciones enteras).
  assert.match(src, /\.collection\("workerAppData"\)\.select\("status"\)\.get\(\)/);
  assert.match(src, /\.collection\("workerLinks"\)\.select\("uid", "profileName"\)\.get\(\)/);
  // Encola un projectionRequest por workspace con los faltantes.
  assert.match(src, /source: "backfill_missing"/);
  assert.match(src, /exports\.backfillMissingWorkerProjections = onSchedule\(/);
  assert.match(src, /schedule: "every 24 hours"/);
});
