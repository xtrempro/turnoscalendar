import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Dos trabajadores de rotativa Diurno vienen toda la semana. A uno le asignaron
// horas extras por extension de horario el miercoles (su Diurno subio a Larga),
// al otro el viernes. Quieren intercambiar ese dia de extension.
//
// Antes no se podia, y por tres razones distintas encadenadas:
//  1. `canSwapProfiles` descartaba el par: dos rotativas Diurno son identicas
//     dia a dia, asi que `haveSameBaseRotation` daba true.
//  2. `getSwapTurnState` leia la rotativa (siempre Diurno en dia habil), no el
//     turno asignado. La Larga vive como override en `data_`, asi que era
//     invisible: el dia se ofrecia como un Diurno cualquiera.
//  3. El receptor debia estar libre o con turno complementario. El companero
//     ese dia igual venia a trabajar en Diurno, asi que quedaba descartado.
//
// El resultado esperado es que la extension se mueva de un dia al otro sin que
// nadie deje de venir: quien entrega sigue trabajando, pero en Diurno.

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

// `registrarCambio` deja registro en el log de auditoria, que busca el nombre
// del usuario en el DOM. Fuera del navegador alcanza con que no exista.
globalThis.document = {
    getElementById: () => null,
    body: { dataset: {} }
};

const {
    saveBaseProfileData,
    saveProfileData,
    saveProfiles,
    saveRotativa,
    saveTurnChangeConfig
} = await import("../js/storage.js");
const {
    canSwapProfiles,
    getEligibleSwapReceivers,
    getSwapDateBlockReason,
    getSwapTurnState,
    registrarCambio
} = await import("../js/swaps.js");
const { aplicarCambiosTurno, getTurnoProgramado } =
    await import("../js/turnEngine.js");

const TURNO = { LIBRE: 0, LARGA: 1, NOCHE: 2, DIURNO: 4 };

// Semana del lunes 2026-06-08 al viernes 2026-06-12. Las claves de calendario
// usan mes 0-based, las fechas ISO del swap no.
const LUNES = "2026-5-8";
const MARTES = "2026-5-9";
const MIERCOLES = "2026-5-10";
const JUEVES = "2026-5-11";
const VIERNES = "2026-5-12";
const MIERCOLES_ISO = "2026-06-10";
const VIERNES_ISO = "2026-06-12";

const SEMANA = [LUNES, MARTES, MIERCOLES, JUEVES, VIERNES];

function diurno(name) {
    return {
        name,
        estamento: "Técnico",
        profession: "Enfermería",
        contractType: "Planta",
        active: true
    };
}

function turnoEfectivo(nombre, keyDay) {
    return aplicarCambiosTurno(
        nombre,
        keyDay,
        getTurnoProgramado(nombre, keyDay)
    );
}

beforeEach(() => {
    globalThis.localStorage.clear();

    saveProfiles([diurno("Juan"), diurno("Alexis")]);
    saveTurnChangeConfig({
        allowSwaps: true,
        allowDifferentTurnTypes: true,
        allowTwentyFourHourShifts: true,
        allowInvertedTwentyFourHourShifts: true,
        limitMonthlySwaps: false
    });

    ["Juan", "Alexis"].forEach(nombre => {
        saveRotativa(
            { type: "diurno", start: "2026-01-01" },
            nombre
        );

        const base = {};

        SEMANA.forEach(key => {
            base[key] = TURNO.DIURNO;
        });

        saveBaseProfileData(base, nombre);
        saveProfileData({ ...base }, nombre);
    });

    // La extension de horario: el Diurno sube a Larga ese dia puntual.
    saveProfileData(
        {
            [LUNES]: TURNO.DIURNO,
            [MARTES]: TURNO.DIURNO,
            [MIERCOLES]: TURNO.LARGA,
            [JUEVES]: TURNO.DIURNO,
            [VIERNES]: TURNO.DIURNO
        },
        "Juan"
    );
    saveProfileData(
        {
            [LUNES]: TURNO.DIURNO,
            [MARTES]: TURNO.DIURNO,
            [MIERCOLES]: TURNO.DIURNO,
            [JUEVES]: TURNO.DIURNO,
            [VIERNES]: TURNO.LARGA
        },
        "Alexis"
    );
});

test("dos rotativas Diurno ahora son compatibles entre si", () => {
    assert.equal(canSwapProfiles("Juan", "Alexis"), true);
    assert.equal(canSwapProfiles("Alexis", "Juan"), true);
});

test("un Diurno solo cambia con otro Diurno", () => {
    // Lo que entrega un Diurno es su dia de extension horaria, y eso solo tiene
    // contraparte en otro Diurno. La regla es mutua: el companero de otra
    // rotativa tampoco lo ve a el.
    saveRotativa({ type: "4turno", start: "2026-01-01" }, "Alexis");

    assert.equal(canSwapProfiles("Juan", "Alexis"), false);
    assert.equal(canSwapProfiles("Alexis", "Juan"), false);
    assert.deepEqual(
        getEligibleSwapReceivers("Juan", MIERCOLES).map(item => item.name),
        []
    );
});

test("dos rotativas que no son Diurno siguen como antes", () => {
    saveRotativa({ type: "3turno", start: "2026-01-01" }, "Juan");
    saveRotativa({ type: "4turno", start: "2026-01-01" }, "Alexis");

    assert.equal(canSwapProfiles("Juan", "Alexis"), true);
    assert.equal(canSwapProfiles("Alexis", "Juan"), true);
});

test("el menu Cambios de Turno ya no se apaga para los Diurno", async () => {
    // Antes el menu quedaba gris para cualquier perfil Diurno, aunque la PWA ya
    // les dejaba pedir el cambio. Quien decide con quien se puede cambiar es
    // canSwapProfiles, no el menu.
    const main = (await readFile(
        new URL("../js/main.js", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");
    const start = main.indexOf("function updateTurnChangesNavState()");
    const end = main.indexOf("function syncWorkspacePermissionUI(");

    assert.ok(start > -1 && end > start, "no se encontro updateTurnChangesNavState");

    const fn = main.slice(start, end);

    assert.doesNotMatch(fn, /type === "diurno"/);
    assert.doesNotMatch(fn, /con rotativa Diurno/);
});

test("la Larga por extension de horario se ve como turno entregable", () => {
    // Es un override en `data_`, no un reemplazo ni la rotativa.
    assert.equal(getSwapTurnState("Juan", MIERCOLES), TURNO.LARGA);
    assert.equal(getSwapTurnState("Alexis", VIERNES), TURNO.LARGA);

    // Un dia sin extension sigue siendo Diurno, no entregable.
    assert.equal(getSwapTurnState("Juan", MARTES), TURNO.DIURNO);
    assert.equal(getSwapTurnState("Alexis", MIERCOLES), TURNO.DIURNO);
});

test("el companero que ese dia viene en Diurno puede recibir la Larga", () => {
    assert.equal(
        getSwapDateBlockReason({
            giver: "Juan",
            receiver: "Alexis",
            keyDay: MIERCOLES
        }),
        ""
    );
    assert.equal(
        getSwapDateBlockReason({
            giver: "Alexis",
            receiver: "Juan",
            keyDay: VIERNES
        }),
        ""
    );
});

test("no se puede entregar una Larga a quien ya tiene una ese dia", () => {
    // Recibirla no le agregaria jornada: el cambio quedaria sin efecto.
    saveProfileData(
        {
            [LUNES]: TURNO.DIURNO,
            [MARTES]: TURNO.DIURNO,
            [MIERCOLES]: TURNO.LARGA,
            [JUEVES]: TURNO.DIURNO,
            [VIERNES]: TURNO.LARGA
        },
        "Alexis"
    );

    assert.match(
        getSwapDateBlockReason({
            giver: "Juan",
            receiver: "Alexis",
            keyDay: MIERCOLES
        }),
        /ya tiene un turno Larga o Noche/
    );
});

test("un dia sin extension no se puede ofrecer", () => {
    assert.match(
        getSwapDateBlockReason({
            giver: "Juan",
            receiver: "Alexis",
            keyDay: MARTES
        }),
        /no tiene turno Larga o Noche para entregar/
    );
});

test("el companero aparece en la lista de receptores del dia", () => {
    assert.deepEqual(
        getEligibleSwapReceivers("Juan", MIERCOLES).map(item => item.name),
        ["Alexis"]
    );
});

test("al intercambiar, la extension cambia de dia y nadie queda libre", () => {
    registrarCambio({
        from: "Juan",
        to: "Alexis",
        fecha: MIERCOLES_ISO,
        devolucion: VIERNES_ISO,
        turno: "L",
        turnoDevuelto: "L",
        year: 2026,
        month: 5
    });

    // Miercoles: la extension pasa de Juan a Alexis.
    assert.equal(
        turnoEfectivo("Juan", MIERCOLES),
        TURNO.DIURNO,
        "Juan sigue viniendo el miercoles, pero en Diurno"
    );
    assert.equal(
        turnoEfectivo("Alexis", MIERCOLES),
        TURNO.LARGA,
        "Alexis extiende su jornada el miercoles"
    );

    // Viernes: la devolucion, en espejo.
    assert.equal(
        turnoEfectivo("Alexis", VIERNES),
        TURNO.DIURNO,
        "Alexis sigue viniendo el viernes, pero en Diurno"
    );
    assert.equal(
        turnoEfectivo("Juan", VIERNES),
        TURNO.LARGA,
        "Juan extiende su jornada el viernes"
    );

    // El resto de la semana queda intacto.
    [LUNES, MARTES, JUEVES].forEach(key => {
        assert.equal(turnoEfectivo("Juan", key), TURNO.DIURNO);
        assert.equal(turnoEfectivo("Alexis", key), TURNO.DIURNO);
    });
});

test("ninguno queda Libre: la dotacion del dia no baja", () => {
    registrarCambio({
        from: "Juan",
        to: "Alexis",
        fecha: MIERCOLES_ISO,
        devolucion: VIERNES_ISO,
        turno: "L",
        turnoDevuelto: "L",
        year: 2026,
        month: 5
    });

    // Es la diferencia con el cambio de turno clasico, donde quien entrega deja
    // el dia libre y el servicio pierde una persona.
    SEMANA.forEach(key => {
        assert.notEqual(turnoEfectivo("Juan", key), TURNO.LIBRE);
        assert.notEqual(turnoEfectivo("Alexis", key), TURNO.LIBRE);
    });
});

test("las horas extra siguen a la larga: el motor de horas usa el turno ya cambiado", async () => {
    // Lo que se intercambia son horas extras por extension de horario, asi que
    // al moverse la Larga tienen que moverse con ella. No hay libro de extras
    // aparte: el motor de horas resuelve cada dia con la MISMA expresion que
    // este test usa en `turnoEfectivo`, o sea que ya ve el turno post-cambio.
    // Si algun dia se separan, las horas quedarian en el dia equivocado.
    const source = await readFile(
        new URL("../js/hoursEngine.js", import.meta.url),
        "utf8"
    );

    assert.match(
        source,
        /function actualStateForDay[\s\S]{0,200}aplicarCambiosTurno\(\s*\n\s*nombre,\s*\n\s*keyDay,\s*\n\s*getTurnoProgramado\(nombre, keyDay\)\s*\n\s*\)/
    );
});

test("no se rompe el cambio clasico: 3er turno sigue dejando Libre", () => {
    // Dos rotativas distintas, turno Larga de verdad (no extension sobre Diurno):
    // quien entrega debe quedar Libre, como siempre.
    saveRotativa({ type: "3turno", start: "2026-01-01" }, "Juan");
    saveBaseProfileData({ [MIERCOLES]: TURNO.LARGA }, "Juan");
    saveProfileData({ [MIERCOLES]: TURNO.LARGA }, "Juan");
    saveBaseProfileData({ [MIERCOLES]: TURNO.LIBRE }, "Alexis");
    saveProfileData({ [MIERCOLES]: TURNO.LIBRE }, "Alexis");
    saveRotativa({ type: "4turno", start: "2026-01-01" }, "Alexis");

    registrarCambio({
        from: "Juan",
        to: "Alexis",
        fecha: MIERCOLES_ISO,
        devolucion: VIERNES_ISO,
        turno: "L",
        turnoDevuelto: "L",
        year: 2026,
        month: 5
    });

    assert.equal(turnoEfectivo("Juan", MIERCOLES), TURNO.LIBRE);
    assert.equal(turnoEfectivo("Alexis", MIERCOLES), TURNO.LARGA);
});
