// El RUT es el ancla de identidad del trabajador: obligatorio al crear el
// perfil y no editable una vez guardado. Asi los datos y el respaldo siguen a
// la persona aunque el supervisor le cambie el correo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const validation = await readFile(new URL("../js/profileValidation.js", import.meta.url), "utf8");
const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("crear un perfil sin RUT se rechaza", () => {
    assert.match(
        validation,
        /profileDraft\.mode === PROFILE_MODE\.CREATE &&\s*\n\s*!String\(profileDraft\.rut \|\| ""\)\.trim\(\)/
    );
    // El mensaje explica que el RUT es el identificador que conserva los datos.
    assert.match(validation, /El RUT es obligatorio para crear el perfil/);
});

test("el campo RUT queda bloqueado si el perfil ya tiene RUT guardado", () => {
    assert.match(main, /const rutAlreadySet = Boolean\(String\(data\.rut \|\| ""\)\.trim\(\)\);/);
    assert.match(main, /DOM\.profileRutInput\.disabled = !editing \|\| rutAlreadySet;/);
});

test("el input de RUT es required en el formulario", () => {
    assert.match(html, /id="profileRutField"[^>]*\brequired\b/);
});

test("el input de RUT no muestra un RUT de maqueta cuando esta vacio", () => {
    assert.doesNotMatch(
        html,
        /id="profileRutField"[^>]*placeholder=/
    );
});
