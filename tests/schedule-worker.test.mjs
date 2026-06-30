import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
    buildInterUnitMonths,
    calculateMonth,
    generateSchedule,
    searchReplacements,
    validateAbsences
} from "../js/workers/scheduleWorker.js";

test("genera Auto Diurno y rotativas sin depender de la interfaz", () => {
    const diurno = generateSchedule({
        mode: "diurno",
        startISO: "2026-06-29",
        endISO: "2026-07-03",
        holidays: { "2026-6-1": "Feriado de prueba" }
    });
    const rotation = generateSchedule({
        mode: "sequence",
        startISO: "2026-06-29",
        endISO: "2026-07-04",
        sequence: [1, 2, 0, 0]
    });

    assert.deepEqual(
        diurno.entries.map(item => item.turn),
        [4, 4, 0, 4, 4]
    );
    assert.deepEqual(
        rotation.entries.map(item => item.turn),
        [1, 2, 0, 0, 1, 2]
    );
});

test("calcula en lote horas y arrastre de varios trabajadores", () => {
    const result = calculateMonth({
        year: 2026,
        month: 5,
        holidays: {},
        workers: [
            {
                workerId: "worker-1",
                days: [
                    { iso: "2026-06-29", state: 1 },
                    { iso: "2026-06-30", state: 2 }
                ]
            },
            {
                workerId: "worker-2",
                days: [
                    { iso: "2026-06-29", state: 4 },
                    { iso: "2026-06-30", state: 0 }
                ]
            }
        ]
    });

    assert.equal(result.workerTotals.length, 2);
    assert.equal(result.workerTotals[0].totalD, 14);
    assert.equal(result.workerTotals[0].totalN, 10);
    assert.deepEqual(result.workerTotals[0].carryOut, { d: 1, n: 7 });
    assert.equal(result.workerTotals[1].totalD, 8.8);
});

test("procesa 60 trabajadores por dos meses como datos planos", () => {
    const workers = Array.from({ length: 60 }, (_item, workerIndex) => ({
        id: `worker-${workerIndex}`,
        name: `Trabajador ${workerIndex}`,
        days: Object.fromEntries(
            Array.from({ length: 30 }, (_day, dayIndex) => [
                `2026-06-${String(dayIndex + 1).padStart(2, "0")}`,
                { turn: dayIndex % 5, available: true, blocked: false }
            ])
        )
    }));
    const result = buildInterUnitMonths({
        workspace: { id: "workspace-test", name: "Unidad Test" },
        months: [
            { month: "2026-06", workers },
            { month: "2026-07", workers }
        ],
        updatedAtISO: "2026-06-29T12:00:00.000Z"
    });

    assert.equal(result.payloads.length, 2);
    assert.equal(result.payloads[0].payload.workerCount, 60);
    assert.ok(result.payloads[0].byteLength > 0);
    assert.notEqual(result.payloads[0].hash, result.payloads[1].hash);
});

test("valida ausencias y ordena candidatos fuera del hilo principal", () => {
    const validation = validateAbsences({
        records: [
            { id: "a", workerId: "w1", start: "2026-06-01", end: "2026-06-05" },
            { id: "b", workerId: "w1", start: "2026-06-04", end: "2026-06-06" }
        ]
    });
    const replacements = searchReplacements({
        requiredRole: "Profesional",
        requiredProfession: "Enfermería",
        candidates: [
            { id: "a", name: "Ana", role: "Profesional", profession: "Enfermería", monthlyHhee: 2 },
            { id: "b", name: "Berta", role: "Profesional", profession: "Kinesiología", monthlyHhee: 0 },
            { id: "c", name: "Carla", role: "Profesional", profession: "Enfermería", blocked: true }
        ]
    });

    assert.equal(validation.warnings.length, 1);
    assert.deepEqual(
        replacements.candidates.map(item => item.id),
        ["a", "b"]
    );
});

test("el worker permanece puro y las rutas pesadas lo consumen", async () => {
    const [workerSource, serviceSource, interUnitSource, rotationSource] =
        await Promise.all([
            readFile(new URL(
                "../js/workers/scheduleWorker.js",
                import.meta.url
            ), "utf8"),
            readFile(new URL("../js/workerService.js", import.meta.url), "utf8"),
            readFile(new URL(
                "../js/firebaseInterUnitLoans.js",
                import.meta.url
            ), "utf8"),
            readFile(new URL("../js/rotationApply.js", import.meta.url), "utf8")
        ]);

    assert.doesNotMatch(
        workerSource,
        /\b(?:document|window|localStorage|indexedDB)\b|firebase/i
    );
    assert.match(serviceSource, /pendingTasks = new Map\(\)/);
    assert.match(serviceSource, /CANCEL_TASK/);
    assert.match(serviceSource, /timeoutMs/);
    assert.match(interUnitSource, /listAcceptedLinkedWorkspaces/);
    assert.match(interUnitSource, /runCooperativeRange/);
    assert.match(interUnitSource, /buildInterUnitMonthsInWorker/);
    assert.match(interUnitSource, /HOT_MONTHS_FORWARD = 1/);
    assert.match(rotationSource, /generateScheduleInWorker/);
});
