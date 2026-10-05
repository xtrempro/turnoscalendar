import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const memory = new Map();
globalThis.localStorage = {
    getItem(key) {
        return memory.has(key) ? memory.get(key) : null;
    },
    setItem(key, value) {
        memory.set(key, String(value));
    },
    removeItem(key) {
        memory.delete(key);
    },
    key(index) {
        return [...memory.keys()][index] || null;
    },
    get length() {
        return memory.size;
    }
};

const catalogModule = await import("../js/rotationCatalog.js");
const rotationUtils = await import("../js/rotationUtils.js");
const clockMarks = await import("../js/clockMarks.js");
const storage = await import("../js/storage.js");
const turnEngine = await import("../js/turnEngine.js");
const rotationBase = await import("../js/rotationBase.js");
const serverEngine = await import("../js/serverEngine.js");

test("el catalogo inicial conserva Diurno, 3er turno y 4to turno", () => {
    const catalog = catalogModule.normalizeRotationCatalog(null);
    assert.deepEqual(
        catalog.rotations.map(item => item.id),
        ["diurno", "3turno", "4turno"]
    );
    assert.deepEqual(
        catalog.rotations.find(item => item.id === "3turno").pattern,
        ["larga", "larga", "noche", "noche", "libre", "libre"]
    );
    assert.deepEqual(
        catalog.rotations.find(item => item.id === "4turno").pattern,
        ["larga", "noche", "libre", "libre"]
    );
});

test("reconoce solo un patron que ya se repitio completo", () => {
    assert.deepEqual(
        catalogModule.detectRotationPattern([
            "larga", "noche", "libre", "libre",
            "larga", "noche", "libre", "libre", ""
        ]),
        ["larga", "noche", "libre", "libre"]
    );
    assert.deepEqual(
        catalogModule.detectRotationPattern(["larga", "noche", "libre"]),
        []
    );
});

test("una rotativa nueva genera la secuencia desde cualquier posicion", () => {
    const catalog = catalogModule.normalizeRotationCatalog(null);
    catalog.shifts.push({
        id: "noche-corta",
        name: "Noche corta",
        turn: 2,
        start: "21:00",
        end: "07:00",
        nextDay: true,
        active: true
    });
    catalog.rotations.push({
        id: "especial",
        name: "Especial",
        mode: "sequence",
        pattern: ["larga", "noche-corta", "libre"],
        active: true
    });
    catalogModule.saveRotationCatalog(catalog);

    assert.deepEqual(
        rotationUtils.getRotationSequence("especial", "position:0"),
        [1, 2, 0]
    );
    assert.deepEqual(
        rotationUtils.getRotationSequence("especial", "position:1"),
        [2, 0, 1]
    );
    assert.equal(rotationUtils.getRotativaLabel("especial"), "Especial");
    assert.equal(rotationUtils.requiresRotationFirstTurn("especial"), true);
});

test("resuelve el turno y horario propio de cada dia del patron", () => {
    const monday = new Date(2026, 9, 5);
    const tuesday = new Date(2026, 9, 6);
    const rotativa = {
        type: "especial",
        start: "2026-10-05",
        firstTurn: "position:0"
    };

    assert.equal(
        catalogModule.rotationShiftForDate(rotativa, monday)?.id,
        "larga"
    );
    assert.equal(
        catalogModule.rotationShiftForDate(rotativa, tuesday)?.id,
        "noche-corta"
    );
    assert.equal(
        catalogModule.rotationShiftForDate(rotativa, tuesday)?.start,
        "21:00"
    );
});

test("la proyeccion PWA lleva el patron, las etiquetas y los horarios", () => {
    const portable = rotationBase.buildPortableRotativa({
        type: "especial",
        start: "2026-10-05",
        firstTurn: "position:1"
    });
    const day = rotationBase.baseRenderDay(portable, "2026-10-05");

    assert.equal(portable.name, "Especial");
    assert.equal(portable.definition.mode, "sequence");
    assert.deepEqual(
        portable.definition.pattern.map(item => item.id),
        ["larga", "noche-corta", "libre"]
    );
    assert.equal(portable.definition.pattern[1].start, "21:00");
    assert.equal(portable.definition.pattern[1].end, "07:00");
    assert.equal(day.turno, 2);
    assert.equal(day.label, "Noche corta");
    assert.equal(day.shiftDefinition.id, "noche-corta");
});

test("un dia base configurable no se publica como excepcion por su etiqueta", () => {
    const portable = rotationBase.buildPortableRotativa({
        type: "especial",
        start: "2026-10-05",
        firstTurn: "position:1"
    });
    const base = rotationBase.baseRenderDay(portable, "2026-10-05");
    const calculated = {
        turno: 2,
        displayLabel: "Noche corta",
        className: "noche",
        isManualExtra: false,
        hasLeave: false
    };

    assert.equal(rotationBase.projectedDayDiffersFromBase(calculated, base), false);
    assert.equal(rotationBase.projectedDayDiffersFromBase({
        ...calculated,
        displayLabel: "Noche modificada"
    }, base), true);
    assert.equal(rotationBase.projectedDayDiffersFromBase({
        ...calculated,
        hasLeave: true
    }, base), true);
    assert.equal(rotationBase.projectedDayDiffersFromBase({
        ...calculated,
        swapMarker: { label: "CCTT" }
    }, base), true);
});

test("el horario del turno configurado llega al motor de marcajes", () => {
    storage.saveRotativa({
        type: "especial",
        start: "2026-10-05",
        firstTurn: "position:0"
    }, "Ana");
    assert.deepEqual(storage.getRotativa("Ana"), {
        type: "especial",
        start: "2026-10-05",
        firstTurn: "position:0"
    });
    storage.saveProfiles([{
        name: "Ana",
        contractType: "Contrata",
        estamento: "Tecnico"
    }]);
    assert.equal(turnEngine.getTurnoBase("Ana", "2026-9-5"), 1);
    assert.equal(turnEngine.getTurnoBase("Ana", "2026-9-6"), 2);
    const date = new Date(2026, 9, 6);
    const segments = clockMarks.getScheduledSegmentsForProfile(
        "Ana",
        "2026-9-6",
        date,
        2,
        {}
    );

    assert.equal(segments.length, 1);
    assert.equal(segments[0].label, "Noche corta");
    assert.equal(segments[0].start.getHours(), 21);
    assert.equal(segments[0].end.getDate(), 7);
    assert.equal(segments[0].end.getHours(), 7);

    const schedule = serverEngine.computeProfileSchedule({
        name: "Ana",
        contractType: "Contrata",
        estamento: "Tecnico"
    }, new Date(2026, 9, 5));
    assert.equal(schedule.days["2026-10-06"].label, "Noche corta");
    assert.equal(schedule.days["2026-10-06"].displayLabel, "Noche corta");
});

test("las rotativas y turnos de sistema no se pueden reescribir desde el catalogo", () => {
    const catalog = catalogModule.getRotationCatalog();
    const fourth = catalog.rotations.find(item => item.id === "4turno");
    const larga = catalog.shifts.find(item => item.id === "larga");
    fourth.name = "Cuarto turno local";
    fourth.pattern = ["larga", "noche", "libre"];
    larga.turn = 2;
    larga.start = "10:00";
    catalogModule.saveRotationCatalog(catalog);

    assert.equal(rotationUtils.getRotativaLabel("4turno"), "4to Turno");
    assert.deepEqual(
        rotationUtils.getRotationSequence("4turno", "position:0"),
        [1, 2, 0, 0]
    );
    assert.deepEqual(
        catalogModule.getShiftDefinition("larga"),
        {
            id: "larga",
            name: "Larga",
            turn: 1,
            start: "08:00",
            end: "20:00",
            nextDay: false,
            active: true,
            builtin: true
        }
    );
});

test("los alias historicos del primer turno siguen normalizados", () => {
    assert.deepEqual(
        rotationUtils.getRotationSequence("3turno", "Segunda larga"),
        [1, 2, 2, 0, 0, 1]
    );
    assert.deepEqual(
        rotationUtils.getRotationSequence("3turno", "Noche"),
        [2, 2, 0, 0, 1, 1]
    );
    assert.deepEqual(
        rotationUtils.getRotationSequence("4turno", "SEGUNDO LIBRE"),
        [0, 1, 2, 0]
    );
});

test("la configuracion se sincroniza y llega a los motores", async () => {
    const modules = await readFile(
        new URL("../js/firebaseStateModules.js", import.meta.url),
        "utf8"
    );
    const sync = await readFile(
        new URL("../js/workerAppDataSync.js", import.meta.url),
        "utf8"
    );
    const settings = await readFile(
        new URL("../js/systemSettings.js", import.meta.url),
        "utf8"
    );
    const rotationSettings = await readFile(
        new URL("../js/rotationSettings.js", import.meta.url),
        "utf8"
    );
    const serverEngine = await readFile(
        new URL("../js/serverEngine.js", import.meta.url),
        "utf8"
    );

    assert.match(modules, /\["rotationCatalog", "turnos"\]/);
    assert.match(sync, /"rotationCatalog"/);
    assert.match(settings, /renderRotationSettingsPanel/);
    assert.match(settings, /saveRotationSettingsDraft\(\)/);
    assert.match(rotationSettings, /rotationPatternLocked/);
    assert.match(rotationSettings, /shiftDefinitionLocked/);
    assert.match(rotationSettings, /duplicate-rotation/);
    assert.match(rotationSettings, /duplicate-shift/);
    assert.match(sync, /buildPortableRotativa\(getRotativa\(profile\.name\)\)/);
    assert.match(sync, /WORKER_APP_BASE_VERSION = 2/);
    assert.match(serverEngine, /buildPortableRotativa\(getRotativa\(profile\.name\)\)/);
    assert.match(serverEngine, /WORKER_APP_BASE_VERSION = 2/);
});
