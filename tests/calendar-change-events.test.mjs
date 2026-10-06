import test from "node:test";
import assert from "node:assert/strict";

const {
    buildCalendarChangeEventFromStorageMutation,
    changedCalendarKeysFromRawMutation,
    normalizeAffectedDates
} = await import("../js/calendarChangeEvents.js");

test("detecta fechas modificadas en mapas de calendario", () => {
    const change = {
        previous: JSON.stringify({
            "2026-6-18": 0,
            "2026-6-19": 1
        }),
        next: JSON.stringify({
            "2026-6-18": 1,
            "2026-6-19": 1,
            "2026-6-20": 2
        })
    };

    assert.deepEqual(
        changedCalendarKeysFromRawMutation(change),
        ["2026-6-18", "2026-6-20"]
    );
    assert.deepEqual(
        normalizeAffectedDates(changedCalendarKeysFromRawMutation(change), { base0: true }),
        ["2026-07-18", "2026-07-20"]
    );
});

test("clasifica una edicion manual de turno como cambio de calendario", () => {
    const metadata = buildCalendarChangeEventFromStorageMutation({
        storageKey: "data_Ana",
        change: {
            previous: JSON.stringify({ "2026-6-18": 0 }),
            next: JSON.stringify({ "2026-6-18": 1 })
        }
    });

    assert.equal(metadata.changeType, "shift_added");
    assert.equal(metadata.source, "main_calendar_manual_edit");
    assert.deepEqual(metadata.affectedDates, ["2026-07-18"]);
});

test("clasifica rotativa como evento agrupado sin recorrer dias", () => {
    const metadata = buildCalendarChangeEventFromStorageMutation({
        storageKey: "rotativa_Ana",
        change: {
            previous: JSON.stringify({ type: "4turno" }),
            next: JSON.stringify({ type: "diurno" })
        }
    });

    assert.equal(metadata.changeType, "rotation_changed");
    assert.equal(metadata.source, "rotation_generator");
    assert.deepEqual(metadata.affectedDates, []);
});

test("la edicion directa difiere notificaciones hasta cerrar el switch", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
        new URL("../js/workerAppDataSync.js", import.meta.url),
        "utf8"
    );

    assert.match(source, /function shouldDeferDirectEditCalendarEvent/);
    assert.match(source, /window\.calendarDirectEditEnabled\(\)/);
    assert.match(
        source,
        /shouldDeferDirectEditCalendarEvent\(metadata\)[\s\S]{0,120}continue;/
    );
});

test("asignar reemplazo notifica solo al trabajador que cubre", async () => {
    const { readFile } = await import("node:fs/promises");
    const [replacementsSource, workerAppSource] = await Promise.all([
        readFile(new URL("../js/replacements.js", import.meta.url), "utf8"),
        readFile(new URL("../js/workerAppDataSync.js", import.meta.url), "utf8")
    ]);

    assert.match(
        replacementsSource,
        /notifyProfiles:\s*\[data\.worker\]\.filter\(Boolean\)/
    );
    assert.match(workerAppSource, /changeMetadata\.notifyProfiles/);
    assert.match(
        workerAppSource,
        /notifyProfileNames\s*&&\s*!notifyProfileNames\.has\(name\)/
    );
});

// Noviembre y diciembre son los meses 10 y 11 en base 0, asi que sus claves ya
// traen dos digitos. La version anterior adivinaba el formato contando digitos
// y los anunciaba con un mes de menos: un turno agregado el 25 de noviembre
// llegaba al trabajador como 25 de octubre.
test("las claves de noviembre y diciembre no se leen con un mes de menos", () => {
    assert.deepEqual(
        normalizeAffectedDates(["2026-10-25"], { base0: true }),
        ["2026-11-25"]
    );
    assert.deepEqual(
        normalizeAffectedDates(["2026-11-03"], { base0: true }),
        ["2026-12-03"]
    );
});

test("los meses de un digito siguen funcionando", () => {
    assert.deepEqual(
        normalizeAffectedDates(["2026-0-01", "2026-6-18", "2026-9-30"], { base0: true }),
        ["2026-01-01", "2026-07-18", "2026-10-30"]
    );
});

test("una fecha ya en ISO se respeta tal cual", () => {
    // Es lo que llega al fusionar eventos pendientes, que ya fueron normalizados.
    assert.deepEqual(
        normalizeAffectedDates(["2026-10-25", "2026-12-03"]),
        ["2026-10-25", "2026-12-03"]
    );
});

test("un mes fuera de rango se descarta en los dos formatos", () => {
    assert.deepEqual(normalizeAffectedDates(["2026-12-01"], { base0: true }), []);
    assert.deepEqual(normalizeAffectedDates(["2026-13-01"]), []);
});
