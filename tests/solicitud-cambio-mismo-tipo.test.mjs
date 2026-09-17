// "Permitir Cambios de Turno entre diferentes tipos de turno", apagado.
//
// La regla dice que solo se puede devolver el MISMO tipo: Larga por Larga y
// Noche por Noche. Vive en una sola guarda (js/swaps.js) y depende de que quien
// pregunta le diga cual es el turno que se devuelve (`requiredTurn`).
//
// Ahi estaba el defecto: al ACEPTAR una solicitud venida de la app del
// trabajador (applySwapRequest en js/workerRequests.js) no se pasaba ese dato.
// Como la guarda exige un turno intercambiable y por omision recibe 0, la regla
// no se evaluaba y el ajuste de la unidad quedaba ignorado EN SILENCIO. El panel
// del supervisor (js/swapUI.js) siempre lo paso.
//
// Las dos primeras pruebas son de CONDUCTA: siembran el estado y llaman a la
// funcion real. La ultima fija que las dos superficies sigan pasandolo.
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

const {
    saveBaseProfileData,
    saveProfiles,
    saveTurnChangeConfig
} = await import("../js/storage.js");
const {
    getEligibleSwapReceivers,
    getSwapDateBlockReason,
    getSwapTurnState
} = await import("../js/swaps.js");

const leer = async name => (await readFile(
    new URL(name, import.meta.url), "utf8"
)).replace(/\r\n/g, "\n");

// Dia del cambio y dia de la devolucion.
const DIA_A = "2026-6-10";
const DIA_B = "2026-6-17";

function perfil(name) {
    return {
        name,
        estamento: "Profesional",
        profession: "Enfermería",
        contractType: "Planta",
        active: true
    };
}

/** Apaga el ajuste y deja tres personas con turnos conocidos. */
function sembrar({ permitirDistintos }) {
    globalThis.localStorage.clear();
    saveProfiles([perfil("Ana"), perfil("Diego"), perfil("Carla")]);
    saveTurnChangeConfig({
        allowSwaps: true,
        allowDifferentTurnTypes: permitirDistintos,
        allowTwentyFourHourShifts: true,
        allowInvertedTwentyFourHourShifts: true,
        limitMonthlySwaps: false
    });

    // Ana entrega una Larga el dia A y esta libre el dia B.
    saveBaseProfileData({ [DIA_A]: 1, [DIA_B]: 0 }, "Ana");
    // Diego devolveria una NOCHE: tipo distinto.
    saveBaseProfileData({ [DIA_A]: 0, [DIA_B]: 2 }, "Diego");
    // Carla devolveria una LARGA: mismo tipo.
    saveBaseProfileData({ [DIA_A]: 0, [DIA_B]: 1 }, "Carla");
}

/** La misma llamada que hacen el panel y la aceptacion de solicitudes. */
function motivoDelCambio(receptor) {
    return getSwapDateBlockReason({
        giver: "Ana",
        receiver: receptor,
        keyDay: DIA_A,
        requiredTurn: getSwapTurnState(receptor, DIA_B)
    });
}

beforeEach(() => {
    sembrar({ permitirDistintos: false });
});

/* =========================================================
   La regla, contra el estado real
========================================================= */

test("con el ajuste apagado, devolver otro tipo se rechaza", () => {
    // Ana entrega Larga; Diego devolveria Noche.
    assert.match(
        motivoDelCambio("Diego"),
        /solo permite devolver el mismo tipo de turno/
    );
});

test("y devolver el mismo tipo se permite", () => {
    // Ana entrega Larga; Carla devuelve Larga. Es justo lo que el ajuste busca
    // dejar disponible, asi que no puede quedar bloqueado de paso.
    assert.equal(motivoDelCambio("Carla"), "");
});

test("con el ajuste encendido, el tipo distinto vuelve a permitirse", () => {
    sembrar({ permitirDistintos: true });

    assert.equal(motivoDelCambio("Diego"), "");
});

/* =========================================================
   El defecto: sin `requiredTurn` la regla no se evalua
========================================================= */

test("sin decirle que turno se devuelve, la regla NO se aplica", () => {
    // Se deja escrito a proposito, porque es exactamente lo que ocurria al
    // aceptar una solicitud de la app: la guarda exige un turno intercambiable
    // y por omision recibe 0, asi que el ajuste pasaba inadvertido.
    assert.equal(
        getSwapDateBlockReason({
            giver: "Ana",
            receiver: "Diego",
            keyDay: DIA_A
        }),
        ""
    );
    // Con el dato, el mismo caso se rechaza.
    assert.match(
        motivoDelCambio("Diego"),
        /solo permite devolver el mismo tipo de turno/
    );
});

/* =========================================================
   Las dos superficies tienen que preguntar igual
========================================================= */

test("el panel y la aceptacion de solicitudes pasan el turno devuelto", async () => {
    // Si una de las dos deja de pasarlo, el ajuste se ignora por esa via y el
    // supervisor no tiene como notarlo: no aparece ningun error.
    const [swapUI, workerRequests] = await Promise.all([
        leer("../js/swapUI.js"),
        leer("../js/workerRequests.js")
    ]);

    [swapUI, workerRequests].forEach((source, index) => {
        assert.match(
            source,
            /requiredTurn: getSwapTurnState\(to, keyDevolucion\)/,
            `la superficie ${index} no pasa el turno de la devolucion`
        );
        assert.match(
            source,
            /requiredTurn: getSwapTurnState\(from, keyCambio\)/,
            `la superficie ${index} no pasa el turno del cambio`
        );
    });
});

/* =========================================================
   Elegido el turno, solo quedan los candidatos que sirven
========================================================= */

test("el desplegable deja fuera a quien no puede devolver nada compatible", () => {
    // Ana entrega una Larga el dia A. Carla devuelve Larga -sirve-; Diego solo
    // tiene una Noche -no sirve con el ajuste apagado-. Ofrecer a Diego lleva a
    // un calendario de devolucion vacio y a un cambio que no se puede registrar.
    assert.deepEqual(
        getEligibleSwapReceivers("Ana", DIA_A).map(item => item.name),
        ["Carla"]
    );
});

test("con el ajuste encendido vuelven a aparecer los dos", () => {
    sembrar({ permitirDistintos: true });

    assert.deepEqual(
        getEligibleSwapReceivers("Ana", DIA_A).map(item => item.name).sort(),
        ["Carla", "Diego"]
    );
});

test("sin fecha elegida no se filtra por turno", () => {
    // Todavia no se sabe que turno se entrega, asi que no hay con que comparar.
    assert.deepEqual(
        getEligibleSwapReceivers("Ana").map(item => item.name).sort(),
        ["Carla", "Diego"]
    );
});

/* =========================================================
   El panel filtra DESDE EL PRINCIPIO

   Con el ajuste apagado, los dos mini-calendarios se pintaban enteros mientras
   no hubiera nada elegido -requiredTurn vale 0 y la guarda exige un turno
   intercambiable-, asi que uno ofrecia Noches y el otro Largas. Al elegir una
   fecha, el calendario de enfrente quedaba vacio sin decir por que.
========================================================= */

test("los tipos se cruzan antes de pintar, no despues de hacer clic", async () => {
    const swapUI = await leer("../js/swapUI.js");

    assert.match(swapUI, /function tiposIntercambiablesComunes\(from, to\)/);
    // Con el ajuste encendido no restringe nada.
    assert.match(
        swapUI,
        /if \(getTurnChangeConfig\(\)\.allowDifferentTurnTypes\) return null;/
    );
    // Se cruzan los tipos que cada uno puede ofrecer DE VERDAD.
    assert.match(
        swapUI,
        /\[\.\.\.entrega\]\.filter\(turno => devuelve\.has\(turno\)\)/
    );
});

test("y los dos calendarios reciben ese cruce", async () => {
    // Si solo lo recibiera uno, el otro seguiria invitando a una combinacion
    // que despues no se puede registrar.
    const swapUI = await leer("../js/swapUI.js");
    const bloque = swapUI.slice(
        swapUI.indexOf("const tiposComunes = tiposIntercambiablesComunes(")
    ).slice(0, 400);

    assert.match(bloque, /"swapCalendar1"[\s\S]{0,140}tiposComunes/);
    assert.match(bloque, /"swapCalendar2"[\s\S]{0,140}tiposComunes/);
});

test("un calendario vacio explica el motivo", async () => {
    // Quedarse en blanco sin decir nada es lo que hacia parecer que el ajuste
    // no funcionaba.
    const swapUI = await leer("../js/swapUI.js");

    assert.match(swapUI, /div\.innerHTML = ofrecidos\s*\n\s*\? html/);
    assert.match(
        swapUI,
        /El ajuste de la unidad solo permite cambiar Larga por/
    );
});
