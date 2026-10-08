import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Una lista de perfiles vacia -o a medias- NO autoriza a vaciar casillas.
//
// 2026-10-08 05:06 (Chile), unidad Imagenologia: una pestana que paso la noche
// abierta publico a la PWA (ventana de tres semanas) con la lista de perfiles
// aun vacia. El saneado quitaba a "un perfil que ya no existe", asi que cada
// nombre de las semanas 28-sep, 5-oct y 12-oct se borro para todas las
// sesiones. Es el mismo patron del catalogo vacio (2026-09-03).

const readSource = () => readFile(
    new URL("../js/taskAssignments.js", import.meta.url),
    "utf8"
);

test("sin perfiles, el saneado no toca ni guarda nada", async () => {
    const source = await readSource();
    const body = source.slice(source.indexOf("function cleanAssignmentsForWeek("));
    const guard = body.indexOf("if (!profilesByName.size) return assignments;");
    const loop = body.indexOf("Object.entries(assignments).forEach(([cellKey, entry]) => {");

    assert.ok(guard !== -1 && loop !== -1);
    assert.ok(guard < loop, "el guardia debe ir antes del recorrido de casillas");
});

test("un nombre sin perfil queda en su casilla; solo sale el inactivo o ausente", async () => {
    const source = await readSource();
    const body = source.slice(source.indexOf("function cleanAssignmentsForWeek("));
    const filter = body.slice(body.indexOf(".filter(name => {"), body.indexOf("});", body.indexOf(".filter(name => {")));

    assert.match(filter, /if \(!profile\) return true;/);
    assert.match(filter, /isProfileActive\(profile\)/);
    assert.match(filter, /hasBlockingAbsence\(name, keyDay, shift\)/);
});
