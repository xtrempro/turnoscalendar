import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
for(const file of ["rescatar-asignaciones.mjs","reparar-semanas-tareas-renombradas.mjs","rescatar-catalogo-tareas.mjs","reparar-deltas-por-elemento.mjs"]) {
    test(`${file} rechaza --apply antes de autenticarse o escribir`,()=>{
        const result=spawnSync(process.execPath,[`scripts/${file}`,"--apply"],{encoding:"utf8"});
        assert.notEqual(result.status,0);
        assert.match(result.stderr,/solo lectura: --apply esta deshabilitado/);
        assert.doesNotMatch(result.stderr,/firebase login|refresh_token|401|403/);
    });
}
