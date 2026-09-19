// El historial contractual guarda QUIEN cambio la rotativa y desde cuando.
//
// El boton "modificar rotativa" del calendario y el arrastre del tablero de
// Titulares escriben la rotativa sin pasar por la ficha del perfil, que era el
// unico camino que dejaba rastro. El cambio quedaba sin autor y sin fecha: en
// el historial no aparecia nada.
//
// Ademas normalizeContractHistoryEntry es una LISTA BLANCA: un campo que no se
// nombre ahi se descarta al guardar, sin ningun error. Por eso el autor se
// comprueba leyendolo DE VUELTA del almacen, y no mirando lo que se paso.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
    constructor() {
        this.values = new Map();
    }

    get length() {
        return this.values.size;
    }

    clear() {
        this.values.clear();
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

const {
    getContractHistory,
    addContractHistoryEntry
} = await import("../js/storage.js");
const {
    recordRotationChange,
    recordProfileContractHistory
} = await import("../js/contractHistoryUtils.js");

const PROFILE = "Ana";
const ANTES = { type: "4turno", start: "2026-01-05", firstTurn: "larga" };
const DESPUES = { type: "4turno", start: "2026-09-01", firstTurn: "libre1" };
const ACTOR = { name: "Alan Plaza", email: "tm.alanplaza@gmail.com" };

beforeEach(() => {
    delete globalThis.window;
    globalThis.document = {
        body: { dataset: {} },
        getElementById() {
            return null;
        },
        querySelector() {
            return null;
        },
        querySelectorAll() {
            return [];
        }
    };
    globalThis.localStorage.clear();
});

/* =========================================================
   Lo que se pidio: cuando, quien, y desde cuando
========================================================= */

test("queda registrado quien cambio la rotativa y desde cuando", () => {
    recordRotationChange(PROFILE, ANTES, DESPUES, ACTOR);

    const [entry] = getContractHistory(PROFILE);

    assert.ok(entry, "no se guardo la entrada");
    assert.equal(entry.summary, "Cambio de rotativa");
    // Desde cuando RIGE la rotativa nueva.
    assert.equal(entry.effectiveDate, "2026-09-01");
    // Cuando se hizo el cambio: son fechas distintas.
    assert.ok(entry.createdAt, "sin fecha de registro");
    // Y quien lo hizo.
    assert.equal(entry.actor.name, "Alan Plaza");
    assert.equal(entry.actor.email, "tm.alanplaza@gmail.com");
});

test("el cambio dice de que rotativa a cual", () => {
    recordRotationChange(PROFILE, ANTES, DESPUES, ACTOR);

    const [change] = getContractHistory(PROFILE)[0].changes;

    assert.equal(change.field, "rotation");
    assert.equal(change.label, "Rotativa");
    assert.match(change.from, /05-01-2026|2026/);
    assert.match(change.to, /01-09-2026|2026/);
});

/* =========================================================
   La lista blanca
========================================================= */

test("el autor sobrevive al normalizador que guarda", () => {
    // Si alguien quita `actor` de normalizeContractHistoryEntry, el campo se
    // pierde al guardar SIN ERROR. Esta prueba es la que lo delata.
    addContractHistoryEntry(PROFILE, {
        createdAt: new Date().toISOString(),
        summary: "Cambio de rotativa",
        actor: ACTOR,
        changes: [
            { field: "rotation", label: "Rotativa", from: "a", to: "b" }
        ]
    });

    assert.equal(getContractHistory(PROFILE)[0].actor.name, "Alan Plaza");
});

test("una entrada antigua, sin autor, se lee sin romperse", () => {
    // No se puede inventar un autor para algo registrado cuando no se guardaba.
    addContractHistoryEntry(PROFILE, {
        createdAt: new Date().toISOString(),
        summary: "Cambio de datos contractuales",
        changes: [
            { field: "grade", label: "Grado", from: "10", to: "11" }
        ]
    });

    assert.equal(getContractHistory(PROFILE)[0].actor, null);
});

test("un autor vacio no deja un rastro falso", () => {
    recordRotationChange(PROFILE, ANTES, DESPUES, { name: "", email: "" });

    assert.equal(getContractHistory(PROFILE)[0].actor, null);
});

/* =========================================================
   Cuando NO hay que registrar
========================================================= */

test("si la rotativa no cambio, no se registra nada", () => {
    recordRotationChange(PROFILE, ANTES, { ...ANTES }, ACTOR);

    assert.deepEqual(getContractHistory(PROFILE), []);
});

test("sin trabajador no se escribe en ningun lado", () => {
    recordRotationChange("", ANTES, DESPUES, ACTOR);

    assert.deepEqual(getContractHistory(PROFILE), []);
});

test("la ficha del perfil tambien guarda el autor", () => {
    recordProfileContractHistory(
        PROFILE,
        { grade: "10" },
        { grade: "11" },
        "2026-09-01",
        ACTOR
    );

    assert.equal(getContractHistory(PROFILE)[0].actor.name, "Alan Plaza");
});

/* =========================================================
   Los dos caminos que antes no dejaban rastro
========================================================= */

test("los dos caminos registran el cambio con su autor", async () => {
    // main.js no se puede importar desde las pruebas, asi que estos dos se
    // fijan sobre el texto.
    const main = await readFile(
        new URL("../js/main.js", import.meta.url),
        "utf8"
    );

    // El boton "modificar rotativa" del calendario.
    assert.match(
        main,
        /recordRotationChange\(\s*\n\s*profile\.name,\s*\n\s*previousRotation,\s*\n\s*getRotativa\(profile\.name\),\s*\n\s*getCurrentActor\(\)\s*\n\s*\);/
    );
    // El arrastre del tablero de Titulares.
    assert.match(
        main,
        /recordRotationChange\(\s*\n\s*profile,\s*\n\s*previousRotation,\s*\n\s*getRotativa\(profile\),\s*\n\s*getCurrentActor\(\)\s*\n\s*\);/
    );
});

test("la rotativa anterior se lee ANTES de guardar la nueva", async () => {
    // Al reves quedarian las dos iguales y el historial diria que no cambio.
    const main = await readFile(
        new URL("../js/main.js", import.meta.url),
        "utf8"
    );

    assert.ok(
        main.indexOf("const previousRotation = getRotativa(profile.name);") <
            main.indexOf("recordRotationChange("),
        "se lee la rotativa anterior despues de haberla sobreescrito"
    );
});

test("getCurrentActor esta exportado para poder usarlo", async () => {
    const auditLog = await readFile(
        new URL("../js/auditLog.js", import.meta.url),
        "utf8"
    );

    assert.match(auditLog, /export function getCurrentActor\(\)/);
});
