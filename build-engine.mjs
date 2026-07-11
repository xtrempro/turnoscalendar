// Empaqueta el motor de proyección del cliente (js/serverEngine.js y su cierre
// de módulos puros) en un único archivo ESM autocontenido para Node, que la
// Cloud Function importa dinámicamente y ejecuta con un shim de globales
// (ver functions/lib/engineHarness.js). Así el servidor corre EXACTAMENTE el
// mismo motor de turnos/horas que el navegador, sin reescribirlo.
//
// Se ejecuta como predeploy de functions (firebase.json / firebase.test.json).

import * as esbuild from "esbuild";
import { mkdirSync } from "fs";

mkdirSync("functions/engine", { recursive: true });

await esbuild.build({
    entryPoints: ["js/serverEngine.js"],
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node22"],
    charset: "utf8",
    legalComments: "none",
    outfile: "functions/engine/engine.mjs",
    logLevel: "info"
});

console.log("OK: functions/engine/engine.mjs");
