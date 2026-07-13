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
    getProfileData,
    saveProfileData,
    saveProfileDayTurn
} = await import("../js/storage.js");

const PROFILE = "Ana";
const FIRST_DAY = "2026-6-10";
const SECOND_DAY = "2026-6-11";

beforeEach(() => {
    globalThis.localStorage.clear();
});

test("cada edicion directa conserva los cambios recientes de otras casillas", () => {
    saveProfileData({
        [FIRST_DAY]: 1,
        [SECOND_DAY]: 2
    }, PROFILE);

    const staleSnapshot = getProfileData(PROFILE);

    saveProfileDayTurn(FIRST_DAY, 3, PROFILE);
    assert.equal(staleSnapshot[FIRST_DAY], 1);

    saveProfileDayTurn(SECOND_DAY, 4, PROFILE);

    assert.deepEqual(getProfileData(PROFILE), {
        [FIRST_DAY]: 3,
        [SECOND_DAY]: 4
    });
});

test("el calendario relee el turno y guarda solo la fecha pulsada", async () => {
    const source = await readFile(
        new URL("../js/calendar.js", import.meta.url),
        "utf8"
    );
    const mainSource = await readFile(
        new URL("../js/main.js", import.meta.url),
        "utf8"
    );

    assert.match(
        source,
        /currentState = Number\.isFinite\(previewState\)[\s\S]{0,120}: getActualState\(profileName, keyDay\)/
    );
    assert.match(
        source,
        /saveProfileDayTurn\(keyDay, turnToStore, profileName\)/
    );
    assert.match(
        source,
        /Number\(nuevo\) === Number\(currentState\)[\s\S]{0,120}return;/
    );
    assert.match(
        source,
        /recordCalendarDirectEditChange\(\{[\s\S]{0,180}previousTurn: currentState,[\s\S]{0,80}nextTurn: nuevo/
    );
    assert.match(
        source,
        /proturnos:calendarProfilesChanged/
    );
    assert.match(
        mainSource,
        /CALENDAR_DIRECT_EDIT_IDLE_TIMEOUT_MS = 10 \* 60 \* 1000/
    );
    assert.match(
        mainSource,
        /beforeunload[\s\S]{0,120}commitBeforeExit/
    );
    assert.doesNotMatch(source, /data\[keyDay\] = nuevo/);
});
