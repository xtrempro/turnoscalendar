import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
    constructor() {
        this.values = new Map();
    }

    get length() {
        return this.values.size;
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    key(index) {
        return [...this.values.keys()][index] ?? null;
    }

    removeItem(key) {
        this.values.delete(key);
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }
}

globalThis.localStorage = new MemoryStorage();

const { getJSON, setJSON } = await import("../js/persistence.js");
const { ensureAgendaSeeded } = await import("../js/agenda.js");

test("la version 3 reemplaza por completo los contactos de prueba", () => {
    setJSON("agenda_contacts", [
        {
            id: "contacto-de-prueba",
            name: "Eliminar al migrar"
        }
    ]);
    setJSON("agenda_seeded_v1", 2);

    ensureAgendaSeeded();

    const contacts = getJSON("agenda_contacts", []);
    const claveAzul = contacts.find(contact =>
        contact.id === "agenda_clave_azul"
    );

    assert.equal(getJSON("agenda_seeded_v1", 0), 3);
    assert.equal(contacts.length, 473);
    assert.equal(
        contacts.some(contact => contact.id === "contacto-de-prueba"),
        false
    );
    assert.equal(contacts.filter(contact => contact.favorite).length, 19);
    assert.equal(contacts.filter(contact => contact.dialNumber).length, 286);
    assert.equal(claveAzul.extension, "356427");
    assert.equal(claveAzul.dialNumber, "352206427");
    assert.equal(claveAzul.priority, true);
});
