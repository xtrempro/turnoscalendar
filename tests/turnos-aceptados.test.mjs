// Historial de turnos aceptados: al quitar a alguien de un turno que habia
// aceptado, ya por empezar (6 h antes), en curso o terminado, el supervisor
// puede dejar un comentario en su historial; la calificacion lo ve en
// Asistencia y puntualidad.

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

const asistencia = await import("../js/shiftAttendance.js");

beforeEach(() => localStorage.clear());

test("la ventana: desde 6 horas antes del inicio, durante y despues", () => {
    const ahora = new Date(2026, 8, 30, 12, 0);
    const horas = h => new Date(ahora.getTime() + h * 60 * 60 * 1000);

    assert.equal(asistencia.shiftAttendanceWindowOpen(horas(7), ahora), false);
    assert.equal(asistencia.shiftAttendanceWindowOpen(horas(6), ahora), true);
    assert.equal(asistencia.shiftAttendanceWindowOpen(horas(2), ahora), true);
    assert.equal(asistencia.shiftAttendanceWindowOpen(horas(-30), ahora), true);
    assert.equal(asistencia.shiftAttendanceWindowOpen(null, ahora), false);
});

test("se guarda, se lee y se elimina del historial del trabajador", () => {
    const entrada = asistencia.addShiftAttendanceEntry("Ana Soto", {
        date: "2026-09-22",
        turno: "L",
        turnoLabel: "Larga",
        comment: "El funcionario no se presenta a trabajar",
        replaced: "Juan Perez"
    });

    assert.ok(entrada?.id);
    assert.deepEqual(
        asistencia.getShiftAttendance("Ana Soto").map(e => [e.date, e.turnoLabel, e.comment]),
        [["2026-09-22", "Larga", "El funcionario no se presenta a trabajar"]]
    );
    assert.match(
        asistencia.shiftAttendanceText("Ana Soto", entrada),
        /^Turno Larga del 22\/09\/2026: Ana Soto — "El funcionario no se presenta a trabajar"$/
    );

    // Sin comentario no se guarda nada.
    assert.equal(asistencia.addShiftAttendanceEntry("Ana Soto", { date: "2026-09-23", comment: "  " }), null);

    assert.ok(asistencia.removeShiftAttendanceEntry("Ana Soto", entrada.id));
    assert.deepEqual(asistencia.getShiftAttendance("Ana Soto"), []);
});

test("viaja con el perfil (sin reglas nuevas) y lo ve la calificacion", async () => {
    const leer = ruta => readFile(new URL(ruta, import.meta.url), "utf8");
    const [modulos, calificaciones, calendario, mensual] = await Promise.all([
        leer("../js/firebaseStateModules.js"),
        leer("../js/qualifications.js"),
        leer("../js/calendar.js"),
        leer("../js/monthlyCalendar.js")
    ]);

    assert.match(modulos, /\["shiftAttendance_", "profile"\]/);
    assert.match(modulos, /\["shiftAttendanceCommentPresets", "turnos"\]/);
    // En Comportamiento funcionario (Asistencia y puntualidad).
    assert.match(calificaciones, /buckets\.comportamiento\.push\(\{\s*tone: "bad",\s*title: `No cumple \$\{turno\} aceptado`/);
    // Se ofrece al quitar desde el calendario y desde el Calendario Mensual.
    assert.match(calendario, /await offerShiftAttendanceNote\(\[quitado\]\)/);
    assert.match(mensual, /window\.offerShiftAttendanceNote\?\.\(canceled\)/);
});
