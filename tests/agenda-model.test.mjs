import test from "node:test";
import assert from "node:assert/strict";

import {
    agendaFavoriteValue,
    compareAgendaContacts,
    filterAgendaContacts,
    normalizeAgendaDialNumber
} from "../js/agendaModel.js";
import {
    AGENDA_SEED,
    AGENDA_SEED_VERSION
} from "../js/agendaSeed.js";

test("normaliza solo numeros chilenos marcables de nueve digitos", () => {
    assert.equal(normalizeAgendaDialNumber("352206427"), "352206427");
    assert.equal(normalizeAgendaDialNumber("+56 35 220 6427"), "352206427");
    assert.equal(normalizeAgendaDialNumber("356427"), "");
});

test("interpreta la columna favorito del Excel", () => {
    assert.equal(agendaFavoriteValue("favorito"), true);
    assert.equal(agendaFavoriteValue("Sí"), true);
    assert.equal(agendaFavoriteValue(""), false);
});

test("ordena Clave Azul primero y luego los favoritos", () => {
    const contacts = [
        { id: "normal", name: "Ana", favorite: false },
        { id: "favorite", name: "Bea", favorite: true },
        { id: "agenda_clave_azul", name: "CLAVE AZUL", priority: true }
    ].sort(compareAgendaContacts);

    assert.deepEqual(
        contacts.map(contact => contact.id),
        ["agenda_clave_azul", "favorite", "normal"]
    );
});

test("filtra por establecimiento, unidad y busqueda libre", () => {
    const contacts = [
        {
            id: "one",
            name: "Ana Pérez",
            cargo: "Enfermera",
            establishment: "Hospital Norte",
            unidad: "Urgencia"
        },
        {
            id: "two",
            name: "Bruno Soto",
            cargo: "TENS",
            establishment: "Hospital Sur",
            unidad: "Pabellón"
        }
    ];

    assert.deepEqual(
        filterAgendaContacts(contacts, {
            establishment: "Hospital Norte",
            unit: "Urgencia",
            search: "enfermera"
        }).map(contact => contact.id),
        ["one"]
    );
});

test("la semilla CSV contiene todos los contactos y telefonos validados", () => {
    const ids = new Set(AGENDA_SEED.map(row => row[0]));
    const favorites = AGENDA_SEED.filter(row => row[3]).length;
    const dialNumbers = AGENDA_SEED
        .map(row => row[7])
        .filter(Boolean);
    const claveAzul = AGENDA_SEED[0];

    assert.equal(AGENDA_SEED_VERSION, 3);
    assert.equal(AGENDA_SEED.length, 473);
    assert.equal(ids.size, 473);
    assert.equal(favorites, 19);
    assert.equal(dialNumbers.length, 286);
    assert.ok(dialNumbers.every(number => /^\d{9}$/.test(number)));
    assert.equal(claveAzul[0], "agenda_clave_azul");
    assert.equal(claveAzul[6], "356427");
    assert.equal(claveAzul[7], "352206427");
    assert.equal(claveAzul[9], true);
});
