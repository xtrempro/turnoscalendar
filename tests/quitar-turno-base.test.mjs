import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

const { setJSON } = await import("../js/persistence.js");
const {
    setCurrentProfile,
    saveBaseProfileData,
    setShiftAssigned,
    getTurnChangeConfig,
    saveTurnChangeConfig
} = await import("../js/storage.js");
const {
    recordBaseShiftRemoval,
    getBaseShiftRemoval,
    getEditableBaseShift,
    clearBaseShiftRemoval
} = await import("../js/baseShiftRemovals.js");
const { getAddTurnResult } = await import("../js/turnEngine.js");
const { calcularHorasMesPerfil } = await import("../js/hoursEngine.js");
const { stateModuleForKey } = await import("../js/firebaseStateModules.js");
const { TURNO } = await import("../js/constants.js");

const PROFILE = "Ana";
// Septiembre 2026: lunes 7 y martes 8 son habiles.
const LARGA_KEY = "2026-8-7";
const EXTRA_KEY = "2026-8-8";

function stats() {
    return calcularHorasMesPerfil(
        PROFILE,
        2026,
        8,
        30,
        {},
        {},
        {},
        { d: 0, n: 0 }
    );
}

function seed({ assigned }) {
    saveBaseProfileData({
        [LARGA_KEY]: TURNO.LARGA,
        "2026-8-10": TURNO.LARGA,
        "2026-8-11": TURNO.NOCHE
    }, PROFILE);
    setShiftAssigned(assigned, PROFILE);
    // Un Larga extra para que haya horas extras de donde descontar.
    setJSON(`data_${PROFILE}`, { [EXTRA_KEY]: TURNO.LARGA });
}

function removeBaseLarga() {
    setJSON(`data_${PROFILE}`, {
        [EXTRA_KEY]: TURNO.LARGA,
        [LARGA_KEY]: TURNO.LIBRE
    });
    recordBaseShiftRemoval(PROFILE, LARGA_KEY, TURNO.LARGA);
}

beforeEach(() => {
    delete globalThis.window;
    globalThis.localStorage.clear();
    setCurrentProfile(PROFILE);
});

test("quitar un turno base descuenta sus horas de las extras (rotativa asignada)", () => {
    seed({ assigned: true });

    const before = stats();

    assert.equal(before.mode, "assigned");
    assert.ok(before.hheeDiurnas > 0);

    removeBaseLarga();

    const after = stats();
    const removed =
        (before.hheeDiurnas - after.hheeDiurnas) +
        (before.hheeNocturnas - after.hheeNocturnas);

    // Una Larga son 12 horas.
    assert.equal(Math.round(removed * 100) / 100, 12);
    // Sin valor hora configurado el pago es 0; con valor, baja con las horas.
    assert.ok(after.paymentDiurno <= before.paymentDiurno);
});

test("sin la anotacion, dejar el dia libre no descontaba nada (por eso existe)", () => {
    seed({ assigned: true });

    const before = stats();

    setJSON(`data_${PROFILE}`, {
        [EXTRA_KEY]: TURNO.LARGA,
        [LARGA_KEY]: TURNO.LIBRE
    });

    const after = stats();

    assert.equal(after.hheeDiurnas, before.hheeDiurnas);
    assert.equal(after.hheeNocturnas, before.hheeNocturnas);
});

test("si el turno se vuelve a poner, el descuento desaparece solo", () => {
    seed({ assigned: true });

    const before = stats();

    removeBaseLarga();
    setJSON(`data_${PROFILE}`, {
        [EXTRA_KEY]: TURNO.LARGA,
        [LARGA_KEY]: TURNO.LARGA
    });

    assert.ok(getBaseShiftRemoval(PROFILE, LARGA_KEY));

    const after = stats();

    assert.equal(after.hheeDiurnas, before.hheeDiurnas);
    assert.equal(after.hheeNocturnas, before.hheeNocturnas);
});

test("quitar la base libera la casilla para agregar una rotativa especial", () => {
    seed({ assigned: true });

    removeBaseLarga();

    const editableBase = getEditableBaseShift(
        PROFILE,
        LARGA_KEY,
        TURNO.LARGA
    );
    const result = getAddTurnResult(
        PROFILE,
        LARGA_KEY,
        TURNO.NOCHE,
        true,
        {
            effectiveBaseTurn: editableBase,
            actualState: TURNO.LIBRE,
            replacementTurn: TURNO.LIBRE
        }
    );

    assert.equal(editableBase, TURNO.LIBRE);
    assert.equal(result.allowed, true);
    assert.equal(result.nextVisibleTurn, TURNO.NOCHE);
    assert.ok(getBaseShiftRemoval(PROFILE, LARGA_KEY));
});

test("todos los caminos de edicion respetan la base quitada", () => {
    const calendar = readFileSync(
        new URL("../js/calendar.js", import.meta.url),
        "utf8"
    );

    assert.match(
        calendar,
        /function getEditableCalendarBaseTurn\([\s\S]{0,320}getEditableBaseShift\(profileName, keyDay, projectedBaseTurn\)/
    );

    const uses = calendar.match(/getEditableCalendarBaseTurn\(/g) || [];

    // Definicion + visor de extras + edicion directa + iluminacion + deteccion
    // de extras + guardado normal + preasignacion.
    assert.equal(uses.length, 7);
});

test("en el modo agregado el dia quitado ya resta lo trabajado: no se descuenta dos veces", () => {
    seed({ assigned: false });

    setJSON(`data_${PROFILE}`, {
        [EXTRA_KEY]: TURNO.LARGA,
        [LARGA_KEY]: TURNO.LIBRE
    });

    const withoutRecord = stats();

    assert.equal(withoutRecord.mode, "aggregate");

    recordBaseShiftRemoval(PROFILE, LARGA_KEY, TURNO.LARGA);

    const withRecord = stats();

    assert.equal(withRecord.hheeDiurnas, withoutRecord.hheeDiurnas);
    assert.equal(withRecord.hheeNocturnas, withoutRecord.hheeNocturnas);

    assert.equal(clearBaseShiftRemoval(PROFILE, LARGA_KEY), true);
    assert.equal(getBaseShiftRemoval(PROFILE, LARGA_KEY), null);
});

test("la anotacion viaja con las horas y el ajuste arranca apagado", () => {
    assert.equal(stateModuleForKey(`baseShiftRemovals_${PROFILE}`), "hours");
    assert.equal(getTurnChangeConfig().allowRemoveShiftButton, false);

    saveTurnChangeConfig({
        ...getTurnChangeConfig(),
        allowRemoveShiftButton: true
    });

    assert.equal(getTurnChangeConfig().allowRemoveShiftButton, true);
});

test("el boton QUITAR TURNO: siempre para reemplazo y honorarios, planta y contrata solo con el ajuste", () => {
    const main = readFileSync(new URL("../js/main.js", import.meta.url), "utf8");
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

    assert.match(html, /id="removeTurnBtn"[^>]*data-remove-turn/);
    assert.match(html, /<span>QUITAR TURNO<\/span>/);
    assert.match(
        main,
        /if \(isReplacementProfile\(profile\) \|\| isHonorariaProfile\(profile\)\) \{\s*return true;\s*\}\s*return getTurnChangeConfig\(\)\.allowRemoveShiftButton === true;/
    );
    assert.match(main, /selectionMode === "removeturn"\) \{\s*await handleRemoveTurnSelection\(fecha, celda\);/);
});
