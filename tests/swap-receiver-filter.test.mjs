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

const { setJSON } = await import("../js/persistence.js");
const {
    saveBaseProfileData,
    saveProfiles,
    saveTurnChangeConfig
} = await import("../js/storage.js");
const { getEligibleSwapReceivers } = await import("../js/swaps.js");

const DAY = "2026-6-10";

function profile(name, estamento = "Profesional") {
    return {
        name,
        estamento,
        profession: "Enfermería",
        contractType: "Planta",
        active: true
    };
}

beforeEach(() => {
    globalThis.localStorage.clear();
    saveProfiles([
        profile("Ana"),
        profile("Bruno"),
        profile("Carla"),
        profile("Diego"),
        profile("Eva"),
        profile("Tomas", "Técnico")
    ]);
    saveTurnChangeConfig({
        allowSwaps: true,
        allowDifferentTurnTypes: true,
        allowTwentyFourHourShifts: true,
        allowInvertedTwentyFourHourShifts: true,
        limitMonthlySwaps: false
    });

    saveBaseProfileData({ [DAY]: 1 }, "Ana");
    saveBaseProfileData({ [DAY]: 0 }, "Bruno");
    saveBaseProfileData({ [DAY]: 1 }, "Carla");
    saveBaseProfileData({ [DAY]: 2 }, "Diego");
    saveBaseProfileData({ [DAY]: 0 }, "Eva");
    saveBaseProfileData({ [DAY]: 0 }, "Tomas");
    setJSON("absences_Eva", { [DAY]: { type: "license" } });
});

test("filtra receptores segun el turno y la fecha seleccionados", () => {
    assert.deepEqual(
        getEligibleSwapReceivers("Ana").map(item => item.name),
        ["Bruno", "Carla", "Diego", "Eva"]
    );

    assert.deepEqual(
        getEligibleSwapReceivers("Ana", DAY).map(item => item.name),
        ["Bruno", "Diego"]
    );
});

test("excluye el turno complementario cuando los turnos 24 estan desactivados", () => {
    saveTurnChangeConfig({
        allowSwaps: true,
        allowDifferentTurnTypes: true,
        allowTwentyFourHourShifts: false,
        allowInvertedTwentyFourHourShifts: true,
        limitMonthlySwaps: false
    });

    assert.deepEqual(
        getEligibleSwapReceivers("Ana", DAY).map(item => item.name),
        ["Bruno"]
    );
});

test("el combobox se recalcula al elegir el turno entregado", async () => {
    const source = await readFile(
        new URL("../js/swapUI.js", import.meta.url),
        "utf8"
    );

    assert.match(
        source,
        /fechaCambioSeleccionada = fecha;[\s\S]{0,160}actualizarSwapTo\(previousTo\)/
    );
    assert.match(
        source,
        /getTrabajadoresDisponibles\(\s*from,\s*selectedChangeKey\s*\)/
    );
});
