// El saludo del inicio mostraba la firma del supervisor a TODOS los usuarios,
// asi que un administrador invitado entraba y veia el nombre de otra persona.
//
// Ahora cada uno ve el suyo. El nombre lo decide el supervisor -al invitar, o
// despues en Ajustes- y se guarda por correo, no por uid: asi queda listo antes
// de que la persona acepte la invitacion.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) { this.values.set(key, String(value)); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost" }
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => []
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const {
    getAdminDisplayName,
    getAdminDisplayNames,
    setAdminDisplayName
} = await import("../js/storage.js");

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const home = await read("../js/home.js");
const settings = await read("../js/systemSettings.js");
const modules = await read("../js/firebaseStateModules.js");

/* =========================================================
   El almacen de nombres
========================================================= */

test("el nombre se guarda y se recupera por correo", () => {
    localStorage.clear();
    setAdminDisplayName("patricia.farias.b@gmail.com", "Patricia Farías");

    assert.equal(
        getAdminDisplayName("patricia.farias.b@gmail.com"),
        "Patricia Farías"
    );
});

test("el correo no distingue mayusculas ni espacios", () => {
    // Quien escribe el correo en la invitacion y quien inicia sesion no siempre
    // lo tipean igual; si no se normalizara, el saludo no encontraria el nombre.
    localStorage.clear();
    setAdminDisplayName("  Javiera.CornejoCH@Gmail.com ", "Javiera Cornejo");

    assert.equal(
        getAdminDisplayName("javiera.cornejoch@gmail.com"),
        "Javiera Cornejo"
    );
    assert.equal(
        getAdminDisplayName("JAVIERA.CORNEJOCH@GMAIL.COM"),
        "Javiera Cornejo"
    );
});

test("un correo sin nombre asignado devuelve vacio", () => {
    localStorage.clear();

    assert.equal(getAdminDisplayName("nadie@correo.cl"), "");
    assert.equal(getAdminDisplayName(""), "");
    assert.equal(getAdminDisplayName(undefined), "");
});

test("borrar el nombre lo quita, no guarda uno vacio", () => {
    localStorage.clear();
    setAdminDisplayName("dpma1014@gmail.com", "Daniela Medina");
    setAdminDisplayName("dpma1014@gmail.com", "   ");

    assert.equal(getAdminDisplayName("dpma1014@gmail.com"), "");
    assert.deepEqual(getAdminDisplayNames(), {});
});

test("guardar un nombre no pisa los demas", () => {
    localStorage.clear();
    setAdminDisplayName("a@correo.cl", "Ana");
    setAdminDisplayName("b@correo.cl", "Bruno");

    assert.deepEqual(getAdminDisplayNames(), {
        "a@correo.cl": "Ana",
        "b@correo.cl": "Bruno"
    });
});

test("los nombres viajan con el resto del entorno", () => {
    // Sin esto quedarian solo en el navegador del supervisor y el invitado
    // seguiria viendo el nombre equivocado.
    assert.match(modules, /\["adminDisplayNames", "reports"\]/);
});

/* =========================================================
   El saludo
========================================================= */

test("el saludo ya no devuelve siempre la firma del supervisor", () => {
    // Era la causa: getSupervisorName leia la firma del informe, que es una
    // sola para toda la unidad.
    assert.match(home, /const asignado = getAdminDisplayName\(user\?\.email\);/);
    assert.match(home, /if \(asignado\) return asignado;/);
});

test("un invitado sin nombre asignado ve el de su cuenta", () => {
    // Y solo el dueño de la unidad cae en la firma del informe.
    assert.match(home, /const propio = String\(user\?\.displayName/);
    assert.match(home, /if \(!isWorkspaceOwner\(\) && propio\) return propio;/);
});

test("el pie de firma de una unidad nueva se escribe despues de hidratar", async () => {
    // Escrito antes, la hidratacion lo pisaba: UCI y UTI quedaron con las
    // cuatro lineas vacias un minuto despues de crearse.
    const shell = await readFile(new URL("../js/firebaseShell.js", import.meta.url), "utf8");
    const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");

    assert.match(shell, /afterStateHydrated: \(\) => saveReportSignatureConfig\(/);
    assert.match(
        main,
        /void estadoHidratado\.then\(async \(\) => \{[\s\S]{0,600}changeOptions\.afterStateHydrated\(\);/
    );
});

test("una unidad sin firma saluda con la cuenta del dueño, no con la maqueta", () => {
    // UCI y UTI se crearon con el campo del supervisor vacio y el inicio decia
    // "Hola, Cristian Morales".
    assert.doesNotMatch(home, /Cristian Morales/);
    assert.match(home, /if \(line\) return line;\s*\n[\s\S]{0,200}if \(propio\) return propio;/);
});

/* =========================================================
   Donde se define el nombre
========================================================= */

test("la invitacion pide el nombre y no deja enviarla sin el", () => {
    assert.match(settings, /data-settings-invite-name/);
    assert.match(settings, /Nombre de la persona/);
    assert.match(settings, /Ingresa el nombre de la persona que vas a invitar/);
});

test("el nombre se guarda al invitar, antes de que la persona acepte", () => {
    // Asi el saludo la reconoce apenas entra, sin que nadie tenga que volver a
    // Ajustes despues.
    assert.match(settings, /setAdminDisplayName\(email, displayName\);/);
});

test("el supervisor puede corregirlo en Ajustes", () => {
    assert.match(settings, /data-member-name="\$\{escapeHTML\(member\.email \|\| ""\)\}"/);
    assert.match(
        settings,
        /setAdminDisplayName\(\s*\n\s*nameInput\.dataset\.memberName,\s*\n\s*nameInput\.value\s*\n\s*\)/
    );
    // Se guarda al salir del campo, no en cada tecla: escribir "Patricia" no
    // puede disparar seis guardados y seis sincronizaciones.
    assert.match(settings, /backdrop\.addEventListener\("change"/);
});

test("el nombre asignado manda sobre el de la cuenta de Google", () => {
    // El de la cuenta suele ser un alias o el propio correo.
    assert.match(
        settings,
        /function memberLabel\(member\) \{[\s\S]{0,260}getAdminDisplayName\(member\.email\) \|\|[\s\S]{0,40}member\.displayName/
    );
});
