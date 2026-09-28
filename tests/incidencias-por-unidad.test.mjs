// Las incidencias de marcaje calculadas son de UNA unidad.
//
// 2026-09-28: al pasar de Imagenologia a otra unidad, el recuadro "Incidencias
// de marcaje" del inicio seguia mostrando las de Imagenologia. El resultado se
// guardaba en memoria indexado solo por mes, y el cambio de unidad vacia el
// estado local en silencio (replaceLocalSnapshot con silent: true), asi que
// nada lo invalidaba. Son datos sensibles de cada unidad.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const home = await readFile(new URL("../js/home.js", import.meta.url), "utf8");
const indice = await readFile(
    new URL("../js/attendanceIncidentIndex.js", import.meta.url),
    "utf8"
);

test("el recuadro del inicio guarda lo calculado por unidad y mes", () => {
    assert.match(
        home,
        /function incidenciasMesKey\(date\) \{\s*return `\$\{getActiveWorkspace\(\)\?\.id \|\| ""\}\|/
    );
});

test("un calculo que termina despues de cambiar de unidad no se pinta", () => {
    assert.match(
        home,
        /if \(clave !== incidenciasMesKey\(incidenciasMes\)\) return;/
    );
});

test("el indice del calendario tambien separa por unidad", () => {
    assert.match(indice, /import \{ getActiveWorkspace \} from "\.\/workspaces\.js";/);
    assert.match(
        indice,
        /function cacheKey\(profileName, year, month\) \{\s*return `\$\{getActiveWorkspace\(\)\?\.id \|\| ""\}\|\$\{profileName\}/
    );
});
