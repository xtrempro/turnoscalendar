// Establecimientos: de esto depende que dos unidades se reconozcan para
// pedirse el traslado de un trabajador aunque no esten enlazadas.

import test from "node:test";
import assert from "node:assert/strict";

import {
    ESTABLISHMENTS,
    establishmentName,
    establishmentOptionsHTML,
    isKnownEstablishment,
    normalizeEstablishment,
    sameEstablishment
} from "../js/establishments.js";

test("se guarda el id y no el nombre", () => {
    // Renombrar un hospital no deberia romper las coincidencias ya guardadas.
    assert.equal(normalizeEstablishment("hospital-claudio-vicuna"), "hospital-claudio-vicuna");
    assert.equal(establishmentName("hospital-claudio-vicuna"), "Hospital Claudio Vicuña");
});

test("lo que no esta en la lista se guarda vacio", () => {
    // La deteccion compara establecimientos: aceptar texto libre haria convivir
    // "HCV" con "Hospital Claudio Vicuña" sin que coincidan, que es justo la
    // normalizacion que esto viene a resolver.
    assert.equal(normalizeEstablishment("HCV"), "");
    assert.equal(normalizeEstablishment("Hospital Claudio Vicuña"), "");
    assert.equal(normalizeEstablishment(""), "");
    assert.equal(normalizeEstablishment(null), "");
    assert.equal(isKnownEstablishment("hospital-cualquiera"), false);
});

test("dos unidades sin indicar NO comparten establecimiento", () => {
    // Es el caso que mas importa: sin esto, cualquier par de unidades sin
    // establecimiento se ofreceria traslados entre desconocidas.
    assert.equal(sameEstablishment("", ""), false);
    assert.equal(sameEstablishment(null, undefined), false);
    assert.equal(sameEstablishment("HCV", "HCV"), false);
});

test("dos unidades del mismo establecimiento si se reconocen", () => {
    assert.equal(
        sameEstablishment("hospital-claudio-vicuna", "hospital-claudio-vicuna"),
        true
    );
    assert.equal(
        sameEstablishment("hospital-claudio-vicuna", "otro-hospital"),
        false
    );
});

test("la lista siempre ofrece salir sin elegir", () => {
    // Quien no encuentre el suyo tiene que poder crear su unidad igual.
    const html = establishmentOptionsHTML();

    assert.match(html, /<option value=""\s+selected>Sin indicar<\/option>/);

    for (const item of ESTABLISHMENTS) {
        assert.ok(html.includes(`value="${item.id}"`), `falta ${item.id}`);
        assert.ok(html.includes(item.name), `falta el nombre de ${item.id}`);
    }
});

test("al editar, queda marcado el que ya tenia", () => {
    const html = establishmentOptionsHTML("hospital-claudio-vicuna");

    assert.match(html, /value="hospital-claudio-vicuna" selected/);
    assert.ok(
        !/<option value=""\s+selected>/.test(html),
        "no debe quedar marcado tambien Sin indicar"
    );
});
