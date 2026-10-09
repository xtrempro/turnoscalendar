// Poblar el establecimiento de las unidades que ya existian.
//
// El campo `establishment` nacio con el formulario de creacion, asi que las
// unidades anteriores lo tienen vacio y no participan de la deteccion entre
// unidades del mismo establecimiento.
//
// Se emparejan por correo del creador Y nombre de la unidad, no solo por
// correo: quien creo una unidad del hospital pudo crear ademas una "Unidad de
// practica", que no es del establecimiento y no debe tocarse.
//
// Uso:
//   node scripts/poblar-establecimientos.mjs            (muestra que haria)
//   node scripts/poblar-establecimientos.mjs --apply    (lo escribe)
//
// El token sale de gcloud, asi que escribe con permisos de proyecto y no pasa
// por las reglas de Firestore.

import { execFileSync } from "node:child_process";

const PROYECTO = "calendarioturnos-7c4d9";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents/workspaces`;

// Las unidades del Hospital Claudio Vicuña, nombradas una por una a proposito:
// una lista explicita se revisa de un vistazo, un filtro no.
const OBJETIVO = "hospital-claudio-vicuna";
const UNIDADES = [
  { correo: "tecnologosupervisor@gmail.com", nombre: "Imagenologia" },
  { correo: "acuevas.enf@gmail.com", nombre: "UCI" },
  { correo: "macarenadonosocarvajal@gmail.com", nombre: "UTI" },
  { correo: "jefaturaurgenciashcv@gmail.com", nombre: "Urgencia Adulto" },
  { correo: "jefaturaurgenciashcv@gmail.com", nombre: "Urgencia Infantil" }
];

const aplicar = process.argv.includes("--apply");
// shell: true porque en Windows gcloud es un .cmd y execFileSync no lo resuelve.
const token = execFileSync("gcloud", ["auth", "print-access-token"], {
  encoding: "utf8",
  shell: true
}).trim();

const cabeceras = {
  Authorization: `Bearer ${token}`,
  "x-goog-user-project": PROYECTO,
  "Content-Type": "application/json"
};

async function listarUnidades() {
  const todas = [];
  let pageToken = "";

  do {
    const url = `${BASE}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const respuesta = await fetch(url, { headers: cabeceras });
    const datos = await respuesta.json();

    if (datos.error) throw new Error(datos.error.message);

    for (const doc of datos.documents || []) {
      const campos = doc.fields || {};

      todas.push({
        id: doc.name.split("/").pop(),
        nombre: campos.name?.stringValue || "",
        correo: campos.createdByEmail?.stringValue || "",
        establecimiento: campos.establishment?.stringValue || ""
      });
    }

    pageToken = datos.nextPageToken || "";
  } while (pageToken);

  return todas;
}

const todas = await listarUnidades();
const porHacer = [];

for (const esperada of UNIDADES) {
  const encontradas = todas.filter(
    (unidad) =>
      unidad.correo === esperada.correo && unidad.nombre === esperada.nombre
  );

  if (encontradas.length !== 1) {
    console.log(
      `AMBIGUA  ${esperada.nombre} (${esperada.correo}): ${encontradas.length} coincidencias, se omite`
    );
    continue;
  }

  const unidad = encontradas[0];

  if (unidad.establecimiento === OBJETIVO) {
    console.log(`YA ESTABA ${unidad.nombre}`);
    continue;
  }

  porHacer.push(unidad);
  console.log(
    `${aplicar ? "ESCRIBE " : "ESCRIBIRIA"} ${unidad.nombre.padEnd(20)} ${unidad.id}`
  );
}

if (!aplicar) {
  console.log(`\n${porHacer.length} unidad(es) por actualizar. Repite con --apply.`);
  process.exit(0);
}

for (const unidad of porHacer) {
  // updateMask: solo ese campo. Sin el, un PATCH reemplazaria el documento
  // entero y se llevaria por delante todo lo demas.
  const url = `${BASE}/${unidad.id}?updateMask.fieldPaths=establishment`;
  const respuesta = await fetch(url, {
    method: "PATCH",
    headers: cabeceras,
    body: JSON.stringify({ fields: { establishment: { stringValue: OBJETIVO } } })
  });

  if (!respuesta.ok) {
    console.log(`ERROR    ${unidad.nombre}: ${respuesta.status} ${await respuesta.text()}`);
    continue;
  }

  console.log(`LISTO    ${unidad.nombre}`);
}
