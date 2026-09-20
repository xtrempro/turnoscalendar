// El cupo dice de QUE es, y se aprieta para llenarlo.
//
// Antes decia el estamento -"Cupo disponible / Profesional"- y con eso no se
// puede salir a buscar a nadie: en Profesional conviven enfermeria,
// kinesiologia y matroneria, y en Tecnico los TENS con los de imagenologia.
//
// Se abre por profesion SOLO en esos dos. En Administrativo y Auxiliar basta
// el estamento: abrirlos inventaria un cupo por cada cargo distinto.
import test from "node:test";
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

const { buildProfessionGaps } = await import("../js/shiftHolders.js");
const holders = await readFile(
    new URL("../js/shiftHolders.js", import.meta.url),
    "utf8"
);

/** Columnas de mentira: cada trabajador es [estamento, profesion]. */
function columnas(...grupos) {
    return grupos.map(gente => ({
        workers: gente.map(([estamento, profession]) => ({
            profile: { estamento, profession }
        }))
    }));
}

const ENF = ["Profesional", "Enfermería"];
const KINE = ["Profesional", "Kinesiología"];
const TENS = ["Técnico", "Técnico en Enfermería"];
const TIMG = ["Técnico", "TM Imagenología"];
const AUX_SERV = ["Auxiliar", "Auxiliar de servicio"];
const AUX_ASEO = ["Auxiliar", "Auxiliar de aseo"];

/* =========================================================
   Profesional y Tecnico SI se abren
========================================================= */

test("en Profesional el cupo es de una PROFESION, no del estamento", () => {
    // Al grupo 2 le falta una enfermera. Por estamento estaria "parejo en
    // profesionales" y el hueco no se veria.
    const gaps = buildProfessionGaps(columnas(
        [ENF, ENF, KINE],
        [ENF, KINE],
        [ENF, ENF, KINE],
        [ENF, ENF, KINE]
    ));

    assert.deepEqual(gaps[1], [{
        estamento: "Profesional",
        profession: "Enfermería",
        label: "Enfermería",
        count: 1,
        reference: 2,
        missing: 1
    }]);
});

test("en Tecnico tambien", () => {
    const gaps = buildProfessionGaps(columnas(
        [TENS, TENS, TIMG],
        [TENS, TIMG],
        [TENS, TENS, TIMG],
        [TENS, TENS, TIMG]
    ));

    assert.equal(gaps[1].length, 1);
    assert.equal(gaps[1][0].label, "Técnico en Enfermería");
});

test("dos profesiones del mismo estamento son dos cupos distintos", () => {
    const gaps = buildProfessionGaps(columnas(
        [ENF, KINE],
        [],
        [ENF, KINE],
        [KINE]
    ));

    // Al cuarto le falta la enfermera, y solo esa.
    assert.deepEqual(
        gaps[3].map(gap => gap.label),
        ["Enfermería"]
    );
});

/* =========================================================
   Administrativo y Auxiliar NO
========================================================= */

test("en Auxiliar basta el estamento: no se abre por cargo", () => {
    // El mejor dotado tiene dos cargos distintos. Si se abriera por profesion,
    // al grupo corto le saldrian DOS cupos en vez de uno.
    const gaps = buildProfessionGaps(columnas(
        [AUX_SERV, AUX_ASEO],
        [AUX_SERV],
        [AUX_SERV, AUX_ASEO],
        [AUX_SERV, AUX_ASEO]
    ));

    assert.deepEqual(gaps[1], [{
        estamento: "Auxiliar",
        profession: "",
        label: "Auxiliar",
        count: 1,
        reference: 2,
        missing: 1
    }]);
});

test("en Administrativo lo mismo", () => {
    const gaps = buildProfessionGaps(columnas(
        [["Administrativo", "Secretaria"], ["Administrativo", "Estadística"]],
        [["Administrativo", "Secretaria"]],
        [["Administrativo", "Secretaria"], ["Administrativo", "Estadística"]],
        [["Administrativo", "Secretaria"], ["Administrativo", "Estadística"]]
    ));

    assert.equal(gaps[1].length, 1);
    assert.equal(gaps[1][0].label, "Administrativo");
    assert.equal(gaps[1][0].profession, "");
});

/* =========================================================
   Fichas incompletas
========================================================= */

test("sin profesion cargada el cupo cae al estamento", () => {
    // En una unidad que todavia no carga las profesiones, el cupo tiene que
    // seguir viendose como antes -"falta 1 Profesional"- en vez de
    // desaparecer por culpa de un dato que falta. La profesion afina el cupo
    // donde existe; donde no, no lo borra.
    const gaps = buildProfessionGaps(columnas(
        [["Profesional", ""], ["Profesional", ""]],
        [["Profesional", ""]],
        [],
        []
    ));

    assert.deepEqual(gaps[1], [{
        estamento: "Profesional",
        profession: "",
        label: "Profesional",
        count: 1,
        reference: 2,
        missing: 1
    }]);
});

test("un estamento fuera del catalogo tampoco", () => {
    const gaps = buildProfessionGaps(columnas(
        [["Directivo", "Jefatura"], ["Directivo", "Jefatura"]],
        [["Directivo", "Jefatura"]],
        [],
        []
    ));

    assert.deepEqual(gaps[1], []);
});

test("pero un grupo entero vacio sigue sin llenarse de cupos", () => {
    const gaps = buildProfessionGaps(columnas(
        [ENF, ENF], [ENF, ENF], [ENF, ENF], []
    ));

    assert.deepEqual(gaps[3], []);
});

/* =========================================================
   La tarjeta
========================================================= */

test("el cupo se pinta como boton y lleva con que buscar", () => {
    // Sin estos datos el clic no sabria a que grupo ni a que profesion
    // corresponde el cupo que se apreto.
    assert.match(holders, /<button class="tt-vacancy" type="button"/);
    assert.match(holders, /data-tt-gap="\$\{escapeHTML\(letter \|\| ""\)\}"/);
    assert.match(holders, /data-tt-gap-estamento=/);
    assert.match(holders, /data-tt-gap-profession=/);
    assert.match(holders, /data-tt-gap-label=/);
});

test("la columna le pasa su letra a cada cupo", () => {
    assert.match(
        holders,
        /items\.map\(item => itemHTML\(item, column\.letter\)\)/
    );
});

/* =========================================================
   El clic
========================================================= */

test("los candidatos son diurnos de esa misma profesion", () => {
    // Mover a un titular de otro grupo solo trasladaria el hueco.
    const cuerpo = holders.slice(
        holders.indexOf("async function openGapDialog(")
    );

    assert.match(
        cuerpo,
        /getRotativa\(profile\.name\)\.type === "diurno"/
    );
    assert.match(
        cuerpo,
        /profileEstamento\(profile\) === estamento &&\s*\n\s*bucketProfession\(profile\) === profession/
    );
    assert.match(cuerpo, /\.filter\(isProfileActive\)/);
});

test("sin candidatos se avisa y no se abre nada", () => {
    const cuerpo = holders.slice(
        holders.indexOf("async function openGapDialog(")
    );

    assert.match(
        cuerpo,
        /if \(!candidatos\.length\) \{\s*\n\s*await showAlert\(/
    );
    assert.match(cuerpo, /No hay funcionarios en horario diurno de \$\{label\}/);
});

test("al elegir a alguien se pregunta desde que fecha", () => {
    const cuerpo = holders.slice(
        holders.indexOf("async function openGapDialog(")
    );

    // Sin letra de origen: viene del diurno, no de otro grupo.
    assert.match(cuerpo, /openGroupChangeDialog\(elegido, "", letter\);/);
});

test("el cuadro no dice que venga de otro grupo", () => {
    // Con fromLetter vacio, "pasa del grupo  al grupo A" quedaba roto.
    assert.match(
        holders,
        /fromLetter\s*\n\s*\? `del grupo <b>\$\{escapeHTML\(fromLetter\)\}<\/b>`\s*\n\s*: "del turno <b>diurno<\/b>"/
    );
});

test("el clic del cupo esta enganchado al tablero", () => {
    assert.match(
        holders,
        /root\.querySelectorAll\("\[data-tt-gap\]"\)\.forEach\(card => \{[\s\S]{0,300}openGapDialog\(/
    );
});
