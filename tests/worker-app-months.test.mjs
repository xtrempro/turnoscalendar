import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
    monthScheduleBounds,
    normalizeProfileTargets,
    splitDaysByMonth
} from "../js/workerAppMonths.js";

test("separa el calendario PWA en documentos mensuales", () => {
    const days = {
        "2026-06-29": { turno: 1 },
        "2026-06-30": { turno: 2 },
        "2026-07-01": { turno: 0 },
        invalido: { turno: 3 }
    };

    assert.deepEqual(splitDaysByMonth(days), {
        "2026-06": {
            "2026-06-29": { turno: 1 },
            "2026-06-30": { turno: 2 }
        },
        "2026-07": {
            "2026-07-01": { turno: 0 }
        }
    });
});

test("calcula los limites de cada documento mensual", () => {
    assert.deepEqual(monthScheduleBounds({
        "2026-06-30": {},
        "2026-06-01": {},
        "2026-06-15": {}
    }), {
        start: "2026-06-01",
        end: "2026-06-30"
    });
});

test("normaliza perfiles dirigidos sin duplicar", () => {
    assert.deepEqual(
        normalizeProfileTargets([" Ana ", "", "Ana", "Luis"]),
        ["Ana", "Luis"]
    );
});

test("la sincronizacion cliente no contiene una ruta de publicacion fria global", async () => {
    const source = await readFile(
        new URL("../js/workerAppDataSync.js", import.meta.url),
        "utf8"
    );

    assert.doesNotMatch(source, /dirtyAll/);
    assert.doesNotMatch(source, /scheduleColdPublish|publishColdNow/);
    assert.doesNotMatch(source, /SCHEDULE_MONTHS_(BACK|FORWARD)/);
    assert.match(source, /hotScheduleRange\(today\)/);
    assert.match(source, /writeWorkerAppMonths/);
});

test("la PWA reutiliza resumenes HH.EE y los refresca en segundo plano", async () => {
    const source = await readFile(
        new URL("../js/workerAppDataSync.js", import.meta.url),
        "utf8"
    );

    assert.match(source, /OVERTIME_SUMMARY_CACHE_VERSION/);
    assert.match(source, /function buildOvertimeSummarySignature\(profile, schedule\)/);
    assert.match(source, /previousPayload\?\.overtimeSummaries/);
    assert.match(source, /source: "stale-cache"/);
    assert.match(source, /scheduleColdOvertimeSummaryRefresh/);
    assert.match(source, /refreshWorkerOvertimeSummariesCold/);
    assert.match(source, /overtimeSummariesStatus: "fresh"/);
});

test("Perfil y Timeline limitan la primera pagina", async () => {
    const [mainSource, timelineSource] = await Promise.all([
        readFile(new URL("../js/main.js", import.meta.url), "utf8"),
        readFile(new URL("../js/timeline.js", import.meta.url), "utf8")
    ]);

    assert.match(mainSource, /PROFILE_LIST_PAGE_SIZE\s*=\s*30/);
    assert.match(mainSource, /visibles\.slice\(0, profileListLimit\)/);
    assert.match(timelineSource, /TIMELINE_PAGINATION_THRESHOLD\s*=\s*45/);
    assert.match(timelineSource, /TIMELINE_PAGE_SIZE\s*=\s*45/);
    assert.match(timelineSource, /context\.orderedGroup\.slice\(0, context\.rowLimit\)/);
});
