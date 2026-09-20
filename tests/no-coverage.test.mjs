// "No requiere cobertura": el supervisor puede marcar un turno con permiso para
// que no vuelva a pedir reemplazo (se suprime el "!" en calendario/timeline/
// staffing). Ademas se agrupan las opciones del modal bajo "+ opciones".
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

const { isNoCoverageDay, setNoCoverageDay, getNoCoverageDays } =
    await import("../js/storage.js");

test("setNoCoverageDay / isNoCoverageDay persisten el override", () => {
    localStorage.clear();

    assert.equal(isNoCoverageDay("Ana", "2026-7-13"), false);

    setNoCoverageDay("Ana", "2026-7-13", true);
    assert.equal(isNoCoverageDay("Ana", "2026-7-13"), true);
    assert.deepEqual(getNoCoverageDays("Ana"), { "2026-7-13": true });

    setNoCoverageDay("Ana", "2026-7-13", false);
    assert.equal(isNoCoverageDay("Ana", "2026-7-13"), false);
    assert.deepEqual(getNoCoverageDays("Ana"), {});
});

test("el '!' se suprime con isNoCoverageDay en calendario, timeline y staffing", async () => {
    const [calendar, timeline, staffing, modules] = await Promise.all([
        readFile(new URL("../js/calendar.js", import.meta.url), "utf8"),
        readFile(new URL("../js/timeline.js", import.meta.url), "utf8"),
        readFile(new URL("../js/staffing.js", import.meta.url), "utf8"),
        readFile(new URL("../js/firebaseStateModules.js", import.meta.url), "utf8")
    ]);
    const calls = source => (source.match(/isNoCoverageDay\(/g) || []).length;

    assert.ok(calls(calendar) >= 3, "calendar debe suprimir en 3 sitios");
    assert.ok(calls(timeline) >= 2, "timeline debe suprimir en 2 sitios");
    assert.ok(calls(staffing) >= 2, "staffing debe suprimir en 2 sitios");
    // Se sincroniza entre dispositivos como el resto de datos de turnos.
    assert.match(modules, /\["noCoverage_", "turnos"\]/);
});

test("el boton tambien esta a la vista, junto a Anular permiso", async () => {
    // Vivia SOLO dentro del panel plegado tras el icono de opciones, donde casi
    // nadie lo encontraba. Ahora hay dos y hacen exactamente lo mismo.
    const calendar = await readFile(
        new URL("../js/calendar.js", import.meta.url),
        "utf8"
    );

    // En la fila de acciones, a la derecha de "Anular permiso".
    assert.match(
        calendar,
        /data-action="cancel-leave">\s*\n\s*Anular permiso\s*\n\s*<\/button>\s*\n\s*<button class="secondary-button" type="button" data-action="no-coverage"/
    );
    // Se enlazan los DOS. querySelector se queda con el primero del DOM -el del
    // panel, que se dibuja antes- y dejaria al de abajo sin hacer nada.
    assert.match(
        calendar,
        /querySelectorAll\("\[data-action='no-coverage'\]"\)\s*\n\s*\.forEach\(button => \{\s*\n\s*button\.onclick = markNoCoverage;/
    );
    // Y el nuevo respeta la misma regla que el del panel: en modo preasignar la
    // excepcion de cobertura no aplica.
    assert.match(
        calendar,
        /class="secondary-button" type="button" data-action="no-coverage" \$\{preassignMode \? "disabled" : ""\}/
    );
});

test("el modal agrupa opciones, agrega No requiere cobertura y renombra", async () => {
    const calendar = await readFile(
        new URL("../js/calendar.js", import.meta.url),
        "utf8"
    );

    // Icono (esquina superior derecha) que despliega el panel colapsable.
    assert.match(calendar, /data-action="toggle-options"/);
    assert.match(calendar, /replacement-options-icon/);
    assert.match(calendar, /REPLACEMENT_OPTIONS_ICON/);
    assert.match(calendar, /replacement-options-panel/);
    // Buscador que filtra candidatos, visible solo cuando el listado desborda.
    assert.match(calendar, /data-replacement-search/);
    assert.match(calendar, /class="replacement-candidate"/);
    assert.match(calendar, /is-search-hidden/);
    assert.match(
        calendar,
        /candidateList\.scrollHeight > candidateList\.clientHeight/
    );
    // Nuevo boton "No requiere cobertura".
    assert.match(calendar, /data-action="no-coverage"/);
    assert.match(calendar, /No requiere cobertura/);
    // Marcar el dia pasa por un segundo modal que pide un comentario opcional,
    // asi que la marca se guarda junto con ese motivo.
    assert.match(calendar, /openNoCoverageReasonDialog\(\s*\n?\s*profileName,\s*\n?\s*keyDay\s*\n?\s*\)/);
    assert.match(calendar, /setNoCoverageDay\(profileName, keyDay, true, reason\)/);
    // Rename del toggle.
    assert.match(calendar, /Solicitar aprobaci&oacute;n/);
    assert.doesNotMatch(calendar, /Solicitar aceptacion al trabajador/);
});

test("se puede revertir desde el detalle del permiso (Sí requiere cobertura)", async () => {
    const [calendar, audit] = await Promise.all([
        readFile(new URL("../js/calendar.js", import.meta.url), "utf8"),
        readFile(new URL("../js/auditLog.js", import.meta.url), "utf8")
    ]);

    // Al marcar sin cobertura se registra en el LOG (quien/cuando).
    assert.match(calendar, /"Marco sin cobertura"/);
    assert.match(audit, /export function getNoCoverageAuditInfo\(profile, keyDay\)/);

    // El modal de detalle del permiso muestra la seccion y el boton de revertir.
    assert.match(calendar, /getNoCoverageAuditInfo\(profile, keyDay\)/);
    assert.match(calendar, /Marcado como "No requiere cobertura"/);
    assert.match(calendar, /data-action="require-coverage"/);
    assert.match(calendar, /Sí requiere cobertura/);
    // El handler revierte (setNoCoverageDay false) y registra la reactivacion.
    assert.match(calendar, /setNoCoverageDay\(profile, keyDay, false\)/);
    assert.match(calendar, /"Reactivo cobertura"/);
});

// "Cancelar" salio del pie: ahora se cierra con la cruz de la cabecera.
test("el footer queda en 2 columnas", async () => {
    const css = await readFile(
        new URL("../styles.css", import.meta.url),
        "utf8"
    );

    assert.match(
        css,
        /\.replacement-dialog \.turn-change-dialog__actions \{\s*grid-template-columns: 1fr 1fr/
    );
});

/* =========================================================
   La marca no sobrevive al permiso que la motivo

   Caso real: se puso un P. Administrativo, se marco "no requiere cobertura", se
   anulo el permiso y se volvio a poner otro el mismo dia. El nuevo salio ya
   marcado como sin cobertura, sin preguntar, y el turno se quedo sin el "!" que
   pide reemplazo.

   La marca vive por (trabajador, dia) aparte del permiso, asi que le sobrevivia.
========================================================= */

test("aplicar un permiso descarta la marca del permiso anterior", async () => {
    const motor = (await readFile(
        new URL("../js/leaveEngine.js", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    assert.match(motor, /function clearStaleNoCoverage\(profile, keys = \[\]\)/);
    assert.match(motor, /if \(!key \|\| !isNoCoverageDay\(profile, key\)\) return;/);
    assert.match(motor, /setNoCoverageDay\(profile, key, false\);/);
});

test("se limpia al APLICAR y no al anular, que tiene varios caminos", async () => {
    // La anulacion ocurre desde el calendario, desde el trabajador y arrastrada
    // por un reemplazo: olvidar uno deja el mismo agujero. Al aplicar hay un
    // solo momento, y ademas es seguro: un dia solo admite un permiso a la vez,
    // asi que si recibe uno nuevo es que no tenia ninguno.
    const motor = (await readFile(
        new URL("../js/leaveEngine.js", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    // Los siete caminos que dejan un dia con permiso, licencia o ausencia.
    assert.equal(
        (motor.match(/^\s*clearStaleNoCoverage\(/gm) || []).length,
        7,
        "cada aplicador de permiso tiene que limpiar la marca"
    );
});

test("y no toca los dias que no reciben permiso", async () => {
    // Solo limpia las claves que se estan escribiendo: la marca de OTRO dia del
    // mismo trabajador sigue donde estaba.
    localStorage.clear();

    setNoCoverageDay("Ana", "2026-7-13", true, "Turno cubierto por el equipo");
    setNoCoverageDay("Ana", "2026-7-20", true);

    assert.equal(isNoCoverageDay("Ana", "2026-7-13"), true);
    assert.equal(isNoCoverageDay("Ana", "2026-7-20"), true);
    // Y el motivo guardado se recupera mientras la marca siga viva.
    const { getNoCoverageReason } = await import("../js/storage.js");

    assert.equal(
        getNoCoverageReason("Ana", "2026-7-13"),
        "Turno cubierto por el equipo"
    );
});
