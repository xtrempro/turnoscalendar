// Preasignar turno: cobertura tentativa que NO proyecta ni suma horas hasta
// confirmar. Se guarda aparte de los reemplazos, muestra un logo propio, y un
// preasignado bloquea sugerencias incompatibles por la regla de 24h.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(k) { return this.values.has(k) ? this.values.get(k) : null; }
    key(i) { return [...this.values.keys()][i] ?? null; }
    removeItem(k) { this.values.delete(k); }
    setItem(k, v) { this.values.set(k, String(v)); }
}

globalThis.localStorage = new MemoryStorage();

const {
    addPreassignment,
    removePreassignment,
    getPreassignments,
    getPreassignmentForCoveredShift,
    getPreassignmentForWorker,
    getPreassignmentTurnForWorker
} = await import("../js/preassignments.js");
const { getReplacements } = await import("../js/storage.js");
const { TURNO } = await import("../js/constants.js");

test("la preasignacion persiste, se aisla de reemplazos y se consulta por ambos", () => {
    localStorage.clear();

    const record = addPreassignment({
        worker: "Ana Rojas",
        replaced: "Bruno Rojas",
        keyDay: "2026-7-13",
        turno: TURNO.NOCHE,
        absenceType: "Licencia Médica"
    });

    assert.ok(record.id);
    // Consultable por el ausente y por el reemplazante.
    assert.equal(
        getPreassignmentForCoveredShift("Bruno Rojas", "2026-7-13")?.worker,
        "Ana Rojas"
    );
    assert.equal(
        getPreassignmentForWorker("Ana Rojas", "2026-7-13")?.replaced,
        "Bruno Rojas"
    );
    assert.equal(
        getPreassignmentTurnForWorker("Ana Rojas", "2026-7-13"),
        TURNO.NOCHE
    );
    // NO aparece como reemplazo real (no proyecta turno ni suma horas).
    assert.equal(getReplacements().length, 0);

    removePreassignment(record.id);
    assert.equal(
        getPreassignmentForCoveredShift("Bruno Rojas", "2026-7-13"),
        null
    );
});

test("una sola cobertura por ausente/dia (la nueva reemplaza a la previa)", () => {
    localStorage.clear();

    addPreassignment({ worker: "Ana", replaced: "Bruno", keyDay: "2026-7-13", turno: TURNO.NOCHE });
    addPreassignment({ worker: "Carla", replaced: "Bruno", keyDay: "2026-7-13", turno: TURNO.NOCHE });

    const forBruno = getPreassignments().filter(p => p?.replaced === "Bruno");
    assert.equal(forBruno.length, 1);
    assert.equal(forBruno[0].worker, "Carla");
});

test("integracion: modo, handler, modal, badge, compatibilidad y sync", async () => {
    const [calendar, timeline, modules, replacements] = await Promise.all([
        readFile(new URL("../js/calendar.js", import.meta.url), "utf8"),
        readFile(new URL("../js/timeline.js", import.meta.url), "utf8"),
        readFile(new URL("../js/firebaseStateModules.js", import.meta.url), "utf8"),
        readFile(new URL("../js/replacements.js", import.meta.url), "utf8")
    ]);

    // Toggle de modo + handler que preasigna en vez de asignar.
    assert.match(calendar, /data-action="preassign-mode"/);
    assert.match(calendar, /Preasignar turno/);
    assert.match(calendar, /if \(preassignMode\) \{/);
    assert.match(calendar, /addPreassignment\(\{/);
    // Badge del ausente / reemplazante.
    assert.match(calendar, /const PREASSIGN_BADGE = "preassign"/);
    assert.match(calendar, /preassignedCovered\s*\n?\s*\?\s*PREASSIGN_BADGE/);
    // Modal confirmar/cancelar y su routing.
    assert.match(calendar, /function openPreassignmentDialog\(/);
    assert.match(calendar, /data-action="confirm"/);
    assert.match(calendar, /data-action="cancel-preassign"/);
    // Confirmar pasa a reemplazo REAL. La accion vive en replacements.js porque
    // tambien la dispara la tarjeta de cobertura del inicio; el modal la reusa.
    assert.match(calendar, /confirmPreassignment\(preassignment\);/);
    assert.match(calendar, /cancelPreassignment\(preassignment\);/);
    assert.match(replacements, /saveReplacement\(\{[\s\S]{0,260}?source: "replacement"/);
    assert.match(calendar, /return openPreassignmentDialog\(\{ profile: profileName, keyDay \}\)/);
    // Compatibilidad 24h con preasignaciones.
    // La regla de adyacencia de 24h se movio con el resto del motor de
    // candidatos a js/replacementCandidates.js.
    const candidatos = await readFile(
        new URL("../js/replacementCandidates.js", import.meta.url),
        "utf8"
    );

    assert.match(candidatos, /function preassignmentBlocksReplacementCandidate\(/);
    assert.match(candidatos, /if \(preassignmentBlocksReplacementCandidate\(/);
    // Timeline: marker + routing.
    assert.match(timeline, /const TIMELINE_PREASSIGN_MARKER =/);
    assert.match(timeline, /data-preassign-profile/);
    assert.match(timeline, /window\.openPreassignmentDialog\?\.\(/);
    // Sync entre dispositivos.
    assert.match(modules, /\["preassignments", "turnos"\]/);
});
