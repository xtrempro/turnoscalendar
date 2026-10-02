// Empaqueta el motor de proyección del cliente (js/serverEngine.js y su cierre
// de módulos puros) en un único archivo ESM autocontenido para Node, que la
// Cloud Function importa dinámicamente y ejecuta con un shim de globales
// (ver functions/lib/engineHarness.js). Así el servidor corre EXACTAMENTE el
// mismo motor de turnos/horas que el navegador, sin reescribirlo.
//
// Se ejecuta como predeploy de functions (firebase.json / firebase.test.json).

import * as esbuild from "esbuild";
import { mkdirSync } from "fs";
import { currentBuildId } from "./scripts/build-id.mjs";

mkdirSync("functions/engine", { recursive: true });

// Los registros de bitacora que escribe el servidor (p. ej. la cobertura
// automatica) tambien llevan version de escritura (js/auditLogVersion.js); el
// prefijo distingue el motor del servidor del bundle del navegador.
const define = {
    __TURNOPLUS_AUDIT_BUILD_ID__: JSON.stringify(`server-${currentBuildId()}`)
};

await esbuild.build({
    entryPoints: ["js/serverEngine.js"],
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node22"],
    charset: "utf8",
    legalComments: "none",
    define,
    outfile: "functions/engine/engine.mjs",
    logLevel: "info"
});

console.log("OK: functions/engine/engine.mjs");

// Motor de la cobertura automatica por etapas. Va en su propio bundle y no
// dentro de engine.mjs porque son dos trabajos distintos: la proyeccion se
// recalcula por trabajador cuando cambia su calendario, y esto corre en un
// temporizador que barre las campañas abiertas. Comparte los modulos de
// computo, que esbuild duplica en cada salida (son puros, sin estado global
// compartido entre invocaciones salvo la cache de feriados, que se limpia).
await esbuild.build({
    entryPoints: ["js/serverAutoCoverage.js"],
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node22"],
    charset: "utf8",
    legalComments: "none",
    define,
    outfile: "functions/engine/autoCoverage.mjs",
    logLevel: "info"
});

console.log("OK: functions/engine/autoCoverage.mjs");

// El importador de programación (Excel -> grid) es un módulo puro compartido con
// el cliente y los tests. Se empaqueta a CJS para que la Cloud Function lo use
// (require) sin duplicar la lógica. Queda en functions/engine (gitignored) como
// artefacto de build, igual que engine.mjs.
await esbuild.build({
    entryPoints: ["js/scheduleGridFromSheet.js"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: ["node22"],
    charset: "utf8",
    legalComments: "none",
    define,
    outfile: "functions/engine/scheduleGridFromSheet.cjs",
    logLevel: "info"
});

console.log("OK: functions/engine/scheduleGridFromSheet.cjs");
