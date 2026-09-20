// El estamento es obligatorio, y la profesion tambien donde la dotacion se
// compara por profesion.
//
// Un trabajador sin estamento no entra en ninguna comparacion de dotacion: ni
// en los cupos del tablero de Titulares ni en la brecha del inicio. Su grupo
// aparece completo aunque le falte gente, y el hueco real queda invisible.
//
// En Profesional y Tecnico pasa lo mismo un escalon mas abajo: ahi la
// comparacion se abre POR PROFESION, asi que una ficha sin profesion se cae de
// su bloque y el cupo no sabe a quien pedir.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
);
const holders = await readFile(
    new URL("../js/shiftHolders.js", import.meta.url),
    "utf8"
);

/** El cuerpo del preflight de guardado, que es donde vive la validacion. */
function preflight() {
    const start = main.indexOf("async function validateProfileSavePreflight(");

    assert.notEqual(start, -1, "no se encontro el preflight de guardado");

    return main.slice(start, start + 2600);
}

/* =========================================================
   El estamento
========================================================= */

test("sin estamento no se guarda el perfil", () => {
    const fuente = preflight();

    assert.match(fuente, /if \(!String\(nextEstamento \|\| ""\)\.trim\(\)\) \{/);
    assert.match(fuente, /Falta el estamento/);
    // Abortar de verdad: el llamador corta el guardado con este false.
    assert.match(
        fuente,
        /Falta el estamento[\s\S]{0,320}?return false;/
    );
});

test("y el foco va al campo que falta", () => {
    // Igual que el RUT y el correo, que ya lo hacian: avisar sin mostrar donde
    // deja al supervisor buscando.
    assert.match(preflight(), /DOM\.profileRoleSelect\?\.focus\(\);/);
});

/* =========================================================
   La profesion, solo donde se compara por profesion
========================================================= */

test("en Profesional y Tecnico la profesion tambien es obligatoria", () => {
    const fuente = preflight();

    assert.match(
        fuente,
        /SPLIT_BY_PROFESSION\.has\(String\(nextEstamento\)\.trim\(\)\)/
    );
    assert.match(fuente, /Falta la profesion/);
    assert.match(fuente, /DOM\.profileProfessionSelect\?\.focus\(\);/);
});

test('"Sin informacion" cuenta como que falta', () => {
    // Es el centinela del catalogo y el valor con el que NACE la ficha, no una
    // cadena vacia. Comprobar solo que no este vacia dejaria pasar justamente
    // los perfiles que se quieren evitar.
    assert.match(
        preflight(),
        /nextProfession === SIN_INFORMACION_PROFESSION/
    );
});

test("Administrativo y Auxiliar no la exigen", () => {
    // Ahi la dotacion se compara por estamento, asi que la profesion es un
    // dato util pero no una condicion.
    assert.match(holders, /export const SPLIT_BY_PROFESSION = new Set\(\["Profesional", "Técnico"\]\)/);
});

/* =========================================================
   Una sola fuente de verdad
========================================================= */

test("la regla sale de la MISMA constante que abre los cupos", () => {
    // No una lista repetida en main.js: la validacion existe por esa regla, de
    // modo que si la regla cambia, la validacion la sigue sola.
    assert.match(
        main,
        /import \{\s*\n\s*SPLIT_BY_PROFESSION,[\s\S]{0,200}\} from "\.\/shiftHolders\.js";/
    );
    assert.doesNotMatch(
        preflight(),
        /"Profesional"[\s\S]{0,40}"Técnico"/
    );
});

test("el guardado le pasa los dos valores", () => {
    // Sin esto la validacion recibiria undefined y no bloquearia nada.
    assert.match(
        main,
        /validateProfileSavePreflight\(\{[\s\S]{0,200}nextEstamento,\s*\n\s*nextProfession\s*\n\s*\}\)/
    );
});
