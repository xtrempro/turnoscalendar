"use strict";

// Quien tiene la PWA y la aplicacion instaladas registra dos tokens bajo el
// mismo trabajador, y recibia cada aviso dos veces. No se puede arreglar en el
// cliente: abrir la PWA vuelve a activar su token, asi que gana el ultimo que
// arranque y acaban los dos activos. La decision vive al enviar.

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const fuente = readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

function extraer(nombre) {
  let inicio = fuente.indexOf("function " + nombre + "(");
  assert.notEqual(inicio, -1, "no se encontro " + nombre);

  let nivel = 0;
  for (let i = fuente.indexOf("{", inicio); i < fuente.length; i += 1) {
    if (fuente[i] === "{") nivel += 1;
    else if (fuente[i] === "}") {
      nivel -= 1;
      if (!nivel) return fuente.slice(inicio, i + 1);
    }
  }
  throw new Error("sin cierre: " + nombre);
}

const tokenIsNativeApp = new Function(
  extraer("tokenIsNativeApp") + " return tokenIsNativeApp;"
)();

test("la marca del token manda sobre el user agent", () => {
  assert.equal(tokenIsNativeApp({ client: "android" }), true);
  assert.equal(tokenIsNativeApp({ client: "ios" }), true);
  assert.equal(tokenIsNativeApp({ client: "web" }), false);

  // Aunque el user agent diga otra cosa, la marca decide.
  assert.equal(
    tokenIsNativeApp({ client: "web", userAgent: "Android 14; SM-A556E; wv) AppleWebKit" }),
    false
  );
});

test("los tokens antiguos se reconocen por el user agent", () => {
  // No traen marca: se registraron antes de que existiera la aplicacion.
  assert.equal(
    tokenIsNativeApp({
      userAgent: "Mozilla/5.0 (Linux; Android 14; SM-A556E Build/UP1A; wv) AppleWebKit/537.36"
    }),
    true
  );
  assert.equal(
    tokenIsNativeApp({
      userAgent: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/154 Mobile Safari"
    }),
    false
  );
  assert.equal(tokenIsNativeApp({}), false);
  assert.equal(tokenIsNativeApp(null), false);
});

test("con la aplicacion instalada se envia solo ahi", () => {
  const seleccion = extraer("getWorkerTokens");

  assert.match(seleccion, /const nativos = tokens\.filter\(tokenIsNativeApp\);/);
  // Y sin ningun token de la aplicacion, no cambia nada: van todos.
  assert.match(seleccion, /return nativos\.length \? nativos : tokens;/);
});
