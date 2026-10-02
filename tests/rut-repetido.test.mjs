// Un perfil no puede quedar con el RUT de otro trabajador de la unidad.
//
// El id del perfil sale de su RUT: con un RUT repetido, dos perfiles quedan con
// el mismo id y el timeline y la sincronizacion los confunden. Paso el
// 2026-10-01 en Imagenologia: NATALIA ROJAS RIQUELME se creo con el RUT de
// VERONICA ANDREA CANELO ACUÑA; Veronica desaparecio del timeline y Natalia salia
// repetida. Hasta entonces solo se impedia repetir el CORREO, nunca el RUT.
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { readFileSync } from "node:fs";

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

const { setJSON, getJSON } = await import("../js/persistence.js");
const { PROFILE_MODE, profileDraft, resetProfileDraft } = await import("../js/profileDraft.js");
const { validateProfileDraft, findDuplicateRutProfile } = await import("../js/profileValidation.js");
const { saveProfiles } = await import("../js/storage.js");

const VERONICA = {
    id: "profile_13_769_240-6",
    name: "VERONICA ANDREA CANELO ACUÑA",
    rut: "13.769.240-6",
    estamento: "Auxiliar",
    contractType: "Contrata",
    active: true
};

function draftNatalia(rut) {
    resetProfileDraft();
    Object.assign(profileDraft, {
        mode: PROFILE_MODE.CREATE,
        name: "NATALIA ROJAS RIQUELME",
        estamento: "Auxiliar",
        contractType: "Reemplazo",
        rut
    });
}

beforeEach(() => {
    globalThis.localStorage.clear();
    setJSON("profiles", [VERONICA]);
});

test("crear un perfil con el RUT de otro trabajador se rechaza y dice de quien es", () => {
    draftNatalia("13.769.240-6");

    const result = validateProfileDraft();

    assert.equal(result.ok, false);
    assert.equal(result.focusRut, true);
    assert.match(result.message, /ya pertenece a VERONICA ANDREA CANELO ACUÑA/);
});

test("el RUT se compara sin puntos ni guion (y con K mayuscula o minuscula)", () => {
    assert.equal(findDuplicateRutProfile([VERONICA], "13769240-6")?.name, VERONICA.name);
    assert.equal(findDuplicateRutProfile([VERONICA], "137692406")?.name, VERONICA.name);
    assert.equal(
        findDuplicateRutProfile([{ name: "Con K", rut: "12.345.678-K" }], "12345678k")?.name,
        "Con K"
    );
    assert.equal(findDuplicateRutProfile([VERONICA], "")?.name, undefined);
});

test("con un RUT propio el perfil se crea sin problema", () => {
    draftNatalia("19.061.139-6");

    assert.deepEqual(validateProfileDraft(), { ok: true });
});

test("al editar un perfil, su propio RUT no cuenta como repetido", () => {
    resetProfileDraft();
    Object.assign(profileDraft, {
        mode: PROFILE_MODE.EDIT,
        originalName: VERONICA.name,
        name: VERONICA.name,
        estamento: "Auxiliar",
        contractType: "Contrata",
        rotationType: "diurno",
        rut: VERONICA.rut
    });

    const result = validateProfileDraft();

    assert.doesNotMatch(String(result.message || ""), /ya pertenece/);
});

test("red de seguridad: un perfil NUEVO nunca recibe un id ya usado; los existentes conservan el suyo", () => {
    saveProfiles([
        VERONICA,
        { name: "NATALIA ROJAS RIQUELME", rut: "13.769.240-6", estamento: "Auxiliar" }
    ]);

    const saved = getJSON("profiles", []);

    assert.equal(saved[0].id, VERONICA.id, "Veronica conserva su id");
    assert.notEqual(saved[1].id, VERONICA.id, "Natalia no queda con el id de Veronica");
    assert.equal(new Set(saved.map(profile => profile.id)).size, 2);
});

test("el timeline da su propia fila a cada perfil aunque compartan id", () => {
    const timeline = readFileSync(new URL("../js/timeline.js", import.meta.url), "utf8");

    // La clave de la fila lleva id Y nombre.
    assert.match(
        timeline,
        /function timelineWorkerId\(profile\) \{[\s\S]{0,300}return id && name \? `\$\{id\}\|\$\{name\}` : id \|\| name;/
    );
});
