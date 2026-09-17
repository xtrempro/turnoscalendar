// Capacitacion en un dia de turno de NOCHE.
//
// Por omision una capacitacion solo se aplica sobre Larga o Diurno. Cuando la
// unidad lo habilita (Ajustes -> Reemplazos), tambien se puede sobre una Noche:
// el trabajador se exime de presentarse, y como se exime la jornada COMPLETA no
// se le pregunta de que hora a que hora -eso solo tiene sentido cuando la
// capacitacion ocupa parte del turno-. El turno queda pidiendo reemplazo.
import test, { beforeEach } from "node:test";
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

const { aplicarCapacitacion } = await import("../js/leaveEngine.js");
const {
    esTurnoCapacitacionValido,
    estaBloqueadoModo,
    requiereReemplazoTurnoBase
} = await import("../js/rulesEngine.js");
const {
    getAbsences,
    getBlockedDays,
    saveBaseProfileData,
    saveReplacementRequestConfig,
    setCurrentProfile
} = await import("../js/storage.js");
const {
    getTrainingCoverageHours
} = await import("../js/replacementCandidates.js");
const { TURNO } = await import("../js/constants.js");

const leer = async name => (await readFile(
    new URL(name, import.meta.url), "utf8"
)).replace(/\r\n/g, "\n");

const PROFILE = "Ana";
const NOCHE = new Date(2026, 7, 25);
const NOCHE_KEY = "2026-7-25";

function permitirNoche(valor) {
    saveReplacementRequestConfig({ allowNightTrainingReplacement: valor });
}

beforeEach(() => {
    delete globalThis.window;
    globalThis.document = {
        body: { dataset: {} },
        getElementById() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; }
    };
    globalThis.localStorage.clear();
    setCurrentProfile(PROFILE);
    saveBaseProfileData({ [NOCHE_KEY]: TURNO.NOCHE }, PROFILE);
});

/* =========================================================
   El ajuste manda
========================================================= */

test("por omision la Noche sigue rechazandose", async () => {
    // Sin tocar nada, la funcion se comporta como siempre.
    assert.equal(await aplicarCapacitacion(NOCHE, {}), false);
    assert.deepEqual(getAbsences(), {});
});

test("habilitado, la capacitacion se aplica sobre la Noche", async () => {
    permitirNoche(true);

    assert.equal(await aplicarCapacitacion(NOCHE, {}), true);
    assert.equal(getBlockedDays()[NOCHE_KEY], true);
});

test("y se guarda SIN horario: se exime la noche completa", async () => {
    // Es la diferencia con Larga y Diurno, donde el formulario pregunta de que
    // hora a que hora y esas horas dimensionan el reemplazo.
    permitirNoche(true);
    await aplicarCapacitacion(NOCHE, {});

    assert.deepEqual(getAbsences()[NOCHE_KEY], {
        type: "training",
        startTime: "",
        endTime: "",
        scheduledStart: "",
        scheduledEnd: "",
        overtimeHours: { d: 0, n: 0 }
    });
});

test("la regla pura recibe el permiso por parametro", () => {
    // rulesEngine.js viaja en el bundle del servidor y no lee la configuracion
    // de la unidad, asi que el permiso llega como argumento y por omision va
    // apagado.
    assert.equal(esTurnoCapacitacionValido(TURNO.NOCHE), false);
    assert.equal(esTurnoCapacitacionValido(TURNO.NOCHE, true), true);
    // Lo de siempre no cambia.
    assert.equal(esTurnoCapacitacionValido(TURNO.LARGA), true);
    assert.equal(esTurnoCapacitacionValido(TURNO.DIURNO), true);
    assert.equal(esTurnoCapacitacionValido(TURNO.TURNO24, true), false);
});

test("la casilla del calendario se habilita solo con el permiso", () => {
    const bloqueado = allowNightTraining => estaBloqueadoModo(
        "training",
        NOCHE_KEY,
        TURNO.NOCHE,
        true,
        {},
        {},
        {},
        {},
        true,
        { allowNightTraining }
    );

    assert.equal(bloqueado(false), true);
    assert.equal(bloqueado(true), false);
});

/* =========================================================
   Lo que pasa despues: el turno pide reemplazo
========================================================= */

test("aplicada la capacitacion, el turno de noche pide reemplazo", async () => {
    // Es el "!" del calendario: turno base por encima de Libre y una ausencia
    // ese dia. Sin esto el trabajador se eximiria y nadie cubriria la noche.
    permitirNoche(true);
    await aplicarCapacitacion(NOCHE, {});

    assert.equal(
        requiereReemplazoTurnoBase(
            NOCHE_KEY,
            TURNO.NOCHE,
            {},
            {},
            {},
            getAbsences()
        ),
        true
    );
});

test("el reemplazo toma la noche completa, no cero horas", async () => {
    // La capacitacion nocturna se guarda con {d:0,n:0}. Ese objeto es truthy,
    // asi que se devolvia tal cual y dimensionaba el reemplazo en CERO horas.
    // Cero no es una anulacion: es "sin anulacion", y manda el horario del
    // turno.
    permitirNoche(true);
    await aplicarCapacitacion(NOCHE, {});

    assert.equal(getTrainingCoverageHours(PROFILE, NOCHE_KEY), null);
});

/* =========================================================
   El cableado
========================================================= */

test("el ajuste existe en Reemplazos, apagado por omision", async () => {
    const [storage, settings] = await Promise.all([
        leer("../js/storage.js"),
        leer("../js/systemSettings.js")
    ]);

    assert.match(storage, /allowNightTrainingReplacement: false/);
    assert.match(
        storage,
        /allowNightTrainingReplacement:\s*\n\s*config\.allowNightTrainingReplacement === true/
    );
    assert.match(settings, /id: "settingsAllowNightTrainingReplacement"/);
    assert.match(
        settings,
        /title: "Permitir el reemplazo de capacitaciones cuando al funcionario le corresponde turno de noche"/
    );
    // Y se lee de vuelta al guardar, o la casilla no quedaria marcada.
    assert.match(
        settings,
        /hasInput\("settingsAllowNightTrainingReplacement"\)/
    );
});

test("en la Noche no se abre el formulario de horario", async () => {
    // El resto de los turnos sigue pasando por openTrainingDialog.
    const main = await leer("../js/main.js");
    const bloque = main.slice(
        main.indexOf("async function handleTrainingSelection(")
    ).slice(0, 2600);

    assert.match(bloque, /if \(Number\(state\) === TURNO\.NOCHE\) \{/);

    const noche = bloque.indexOf("if (Number(state) === TURNO.NOCHE) {");
    const dialogo = bloque.indexOf("await openTrainingDialog(");

    assert.ok(noche > 0 && dialogo > 0, "los dos caminos siguen ahi");
    assert.ok(
        noche < dialogo,
        "la Noche se resuelve ANTES de llegar al formulario"
    );
});

test("las tres superficies respetan el ajuste", async () => {
    // Si una sola se queda con la regla vieja, la casilla se puede marcar y
    // despues no se aplica, o al reves.
    const [main, calendar, leaveEngine] = await Promise.all([
        leer("../js/main.js"),
        leer("../js/calendar.js"),
        leer("../js/leaveEngine.js")
    ]);

    assert.match(main, /esTurnoCapacitacionValido\(state, allowNight\)/);
    assert.match(calendar, /allowNightTraining:\s*\n\s*getReplacementRequestConfig\(\)/);
    assert.match(
        leaveEngine,
        /getReplacementRequestConfig\(\)\.allowNightTrainingReplacement === true/
    );
});
