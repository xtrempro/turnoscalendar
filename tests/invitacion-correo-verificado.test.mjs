// El trabajador nuevo nace con identidad recuperable.
//
// La PWA ya no abre una sesion anonima al vuelo cuando se toca un enlace de
// invitacion: el trabajador entra con su correo y recien entonces acepta. Del
// lado del servidor eso obliga a dos cosas, y este archivo las fija:
//
//   1. Aceptar EXIGE que el correo de la sesion sea el de la invitacion.
//   2. El vinculo guarda el correo VERIFICADO, no el que el supervisor escribio
//      a mano.
//
// La segunda importa tanto como la primera: la recuperacion de identidad busca
// por workerEmail. Si el vinculo guardara un correo que su dueño no controla,
// esa persona no podria recuperarse nunca.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("functions/index.js", "utf8");

// El bloque de la comprobacion, en UN solo lugar. Cuando cada test recortaba su
// propia ventana de N caracteres, agregar un comentario al codigo desbordaba la
// mas corta y el test fallaba por algo que no tenia que ver con lo que afirma.
function bloqueVerificacionCorreo() {
  const inicio = source.indexOf("if (WORKER_PASSWORDLESS_INVITE_EMAIL_ENABLED) {");

  assert.notEqual(inicio, -1, "no se encontro la comprobacion de correo");

  return source.slice(inicio, inicio + 1400);
}

test("aceptar una invitacion exige el correo de la invitacion", () => {
  // La bandera esta APAGADA por ahora: se enciende junto con la de la PWA, en
  // ese orden, y de forma deliberada. Lo que se fija aqui es la CONDUCTA que
  // habra cuando se encienda, no su valor actual.
  assert.match(source, /const WORKER_PASSWORDLESS_INVITE_EMAIL_ENABLED = (true|false);/);

  const bloque = bloqueVerificacionCorreo();

  assert.match(bloque, /authEmail !== inviteEmail/);
  assert.match(bloque, /permission-denied/);
});

test("una invitacion SIN correo sigue pudiendo aceptarse", () => {
  // El diccionario de invitaciones contempla perfiles sin correo: el supervisor
  // comparte el enlace por WhatsApp. Si se exigiera coincidencia contra un
  // correo vacio, esos perfiles no podrian enlazarse NUNCA.
  const bloque = bloqueVerificacionCorreo();

  // Se compara solo cuando la invitacion trae correo...
  assert.match(bloque, /if \(inviteEmail && authEmail !== inviteEmail\)/);
  // ...pero entrar sin correo alguno se sigue rechazando.
  assert.match(bloque, /if \(!authEmail\)/);
});

test("el vinculo guarda el correo verificado, no el escrito a mano", () => {
  const inicio = source.indexOf("const workerEmail = WORKER_PASSWORDLESS_INVITE_EMAIL_ENABLED");
  assert.notEqual(inicio, -1, "no se encontro la eleccion de workerEmail");

  const bloque = source.slice(inicio, inicio + 220);

  // Con la bandera encendida gana el correo del token; el de la invitacion
  // queda solo como respaldo del camino anterior.
  assert.match(bloque, /\?\s*normalizeEmail\(authToken\.email\)/);
});
