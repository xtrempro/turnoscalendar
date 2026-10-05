// El motor de proyeccion debe publicar, por cada dia de un cambio de turno aplicado,
// un marcador { type, label } (CCTT/DDTT) para que la PWA del trabajador lo muestre
// igual que el calendario del supervisor. Reutiliza getCambioTurnoCalendario (la
// misma fuente que usa el supervisor).
//
// OJO: el motor esta DUPLICADO. serverEngine.js lo usa la Cloud Function; y
// workerAppDataSync.js tiene su propia copia que usa el navegador del SUPERVISOR
// para publicar (es la que corre al hacer un cambio). Ambas deben llevar el
// marcador o el cambio no aparece segun quien publique.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const engineSrc = await readFile(
  new URL("../js/serverEngine.js", import.meta.url),
  "utf8"
);
const clientSrc = await readFile(
  new URL("../js/workerAppDataSync.js", import.meta.url),
  "utf8"
);
const swapsSrc = await readFile(
  new URL("../js/swaps.js", import.meta.url),
  "utf8"
);
const rotationBaseSrc = await readFile(
  new URL("../js/rotationBase.js", import.meta.url),
  "utf8"
);

// Ambas copias del motor deben tener el mismo cableado del marcador.
for (const [nombre, src] of [
  ["serverEngine.js (Cloud Function)", engineSrc],
  ["workerAppDataSync.js (cliente supervisor)", clientSrc]
]) {
  test(`${nombre}: importa y usa getCambioTurnoCalendario por dia`, () => {
    assert.match(src, /getCambioTurnoCalendario/);
    assert.match(src, /from "\.\/swaps\.js"/);
    assert.match(src, /const swapMarker = getCambioTurnoCalendario\(profile\.name, keyDay\)/);
  });

  test(`${nombre}: incluye swapMarker (type/label/counterpart) solo cuando hay cambio`, () => {
    assert.match(src, /swapMarker: \{/);
    assert.match(src, /type: swapMarker\.type/);
    assert.match(src, /label: swapMarker\.label/);
    // counterpart = el companero del cambio, para el detalle en la PWA.
    assert.match(src, /counterpart: swapMarker\.perspective\?\.counterpart \|\| ""/);
  });

  test(`${nombre}: usa la comparacion base compartida`, () => {
    assert.match(src, /projectedDayDiffersFromBase/);
    assert.match(src, /from "\.\/rotationBase\.js"/);
  });
}

test("la comparacion base compartida considera el marcador", () => {
  assert.match(
    rotationBaseSrc,
    /String\(actual\?\.swapMarker\?\.label \|\| ""\) !== String\(base\?\.swapMarker\?\.label \|\| ""\)/
  );
});

test("swaps.js expone getCambioTurnoCalendario con etiquetas CCTT/DDTT", () => {
  assert.match(swapsSrc, /export function getCambioTurnoCalendario/);
  assert.match(swapsSrc, /`CCTT \$\{perspective\.changeTurnLabel\}`/);
  assert.match(swapsSrc, /`DDTT \$\{perspective\.returnTurnLabel\}`/);
});
