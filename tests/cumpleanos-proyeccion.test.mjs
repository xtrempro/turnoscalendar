// El engine publica los cumpleaños de los compañeros para el calendario de la
// PWA: excluye al propio trabajador, usa un año de referencia fijo (no expone
// la edad) y solo el primer nombre.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("../js/serverEngine.js", import.meta.url), "utf8");
const engine = await readFile(new URL("../functions/engine/engine.mjs", import.meta.url), "utf8")
  .catch(() => "");

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `no se encontro ${name}`);
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

function runBuilder(profiles, currentName) {
  const code = `
    const BIRTHDAY_REFERENCE_YEAR = 2000;
    const getProfiles = () => PROFILES;
    const isProfileActive = (p) => p.active !== false;
    const normalizeText = (v) => String(v || "").trim().toLowerCase();
    ${extract("birthdayMonthDay")}
    ${extract("birthdayFirstName")}
    ${extract("buildBirthdayReminders")}
    return buildBirthdayReminders(CURRENT);
  `;
  return new Function("PROFILES", "CURRENT", code)(profiles, currentName);
}

const profiles = [
  { name: "Daniela Velarde", birthDate: "2000-01-01", active: true },
  { name: "Joaquin Sepulveda Torres", birthDate: "15-03-1988", active: true }, // DD-MM-YYYY
  { name: "Yo Mismo", birthDate: "1990-06-20", active: true },
  { name: "Inactivo Perez", birthDate: "1985-05-05", active: false },
  { name: "Sin Fecha", birthDate: "", active: true }
];

test("excluye al propio trabajador y a los inactivos y sin fecha", () => {
  const out = runBuilder(profiles, "Yo Mismo");
  const names = out.map((b) => b.name).sort();
  assert.deepEqual(names, ["Daniela", "Joaquin"]);
});

test("usa el año de referencia fijo (no expone la edad) y el primer nombre", () => {
  const out = runBuilder(profiles, "Yo Mismo");
  const dani = out.find((b) => b.name === "Daniela");
  const joaco = out.find((b) => b.name === "Joaquin");

  assert.equal(dani.date, "2000-01-01");
  assert.equal(joaco.date, "2000-03-15", "DD-MM-YYYY se convierte a mes/dia");
  // Ningun cumpleaños lleva el año real de nacimiento.
  assert.equal(out.every((b) => b.date.startsWith("2000-")), true);
});

test("el payload del engine publica birthdays y el bundle desplegado lo lleva", () => {
  assert.match(src, /birthdays: buildBirthdayReminders\(profile\.name\)/);
  if (engine) assert.match(engine, /birthdays:/);
});
