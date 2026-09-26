// El modal "Seleccionar reemplazo" incluye un boton "Anular permiso" que quita
// el permiso/ausencia del trabajador ausente y le restablece su turno original,
// reutilizando el mismo camino que el modal de detalle de permiso
// (undoAuditLogEntry) con una limpieza manual de respaldo cuando el permiso no
// tiene un registro undoable en el LOG.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const calendar = await readFile(
    new URL("../js/calendar.js", import.meta.url),
    "utf8"
);
const main = await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
);
const timeline = await readFile(
    new URL("../js/timeline.js", import.meta.url),
    "utf8"
);
const auditLog = await readFile(
    new URL("../js/auditLog.js", import.meta.url),
    "utf8"
);
const replacements = await readFile(
    new URL("../js/replacements.js", import.meta.url),
    "utf8"
);

test("el modal de reemplazo ofrece el boton Anular permiso", () => {
    assert.match(
        calendar,
        /data-action="cancel-leave"[\s\S]{0,80}Anular permiso/
    );
});

test("el handler del boton confirma y llama a cancelReplacedProfileLeave", () => {
    assert.match(
        calendar,
        /\[data-action='cancel-leave'\]/
    );
    assert.match(
        calendar,
        /cancelReplacedProfileLeave\(\s*profileName,\s*keyDay\s*\)/
    );
    // Refresca la vista tras anular: rango afectado, timeline y calendario visible.
    assert.match(calendar, /const affectedKeys = Array\.isArray\(result\.keys\)/);
    assert.match(calendar, /affectedKeys\.map\(dayKey =>\s*updateDayCell\(profileName, dayKey\)/);
    // Refresca la fila del ausente y de cada trabajador que dejo de cubrir.
    assert.match(
        calendar,
        /const affectedProfiles = new Set\(\[\s*profileName,\s*\.\.\.\(result\.coveringWorkers \|\| \[\]\)/
    );
    assert.match(
        calendar,
        /affectedProfiles\.forEach\(worker => \{\s*updateTimelineCells\(worker\)/
    );
    assert.match(
        calendar,
        /updateVisibleCalendarDays\(\{ updateSummary: true \}\)/
    );
});

test("cancelReplacedProfileLeave reporta a los trabajadores que cubrian", () => {
    const start = calendar.indexOf(
        "async function cancelReplacedProfileLeave("
    );
    // La ventana tiene que cubrir el cuerpo entero: la funcion crecio al limpiar
    // tambien la espera de cobertura del permiso (js/leaveHold.js).
    const body = calendar.slice(start, start + 6000);

    // Captura determinista de quienes cubren ANTES de cancelar (no depende de la
    // salida del undo, que no siempre reporta a esos trabajadores).
    assert.match(body, /const coveringBefore = new Set\(/);
    assert.match(body, /replacement\.replaced === profileName/);
    // Camino con LOG: parte de coveringBefore y suma lo que reporta el undo.
    assert.match(body, /const coveringWorkers = new Set\(coveringBefore\)/);
    assert.match(body, /result\.canceledReplacements \|\| \[\]/);
    assert.match(body, /return \{ ok: true, type, coveringWorkers, keys: cancelKeys \}/);
    // Camino manual: anula los reemplazos del periodo y los recopila.
    assert.match(body, /const cancelIsoDates = new Set\(/);
    assert.match(body, /replacement\.replaced === profileName &&\s*cancelIsoDates\.has\(replacement\.date\)/);
    assert.match(body, /coveringWorkers\.add\(worker\)/);
    assert.match(body, /saveReplacements\(nextReplacements\)/);
});

test("cancelReplacedProfileLeave reutiliza el undo del LOG", () => {
    const start = calendar.indexOf(
        "async function cancelReplacedProfileLeave("
    );
    assert.notEqual(start, -1, "no se encontro cancelReplacedProfileLeave");
    const body = calendar.slice(start, start + 5000);

    assert.match(body, /leaveTypeForDay\(keyDay, admin, legal, comp, absences\)/);
    assert.match(
        body,
        /undoAuditLogEntry\(\s*info\.logId,\s*\{\s*source: "calendar"\s*\}\s*\)/
    );
});

test("cancelReplacedProfileLeave limpia manualmente el mapa y el bloqueo", () => {
    const start = calendar.indexOf(
        "async function cancelReplacedProfileLeave("
    );
    const body = calendar.slice(start, start + 5000);

    // Borra el permiso del mapa correspondiente en todo el periodo.
    assert.match(body, /const cancelKeys = leaveCancellationKeysForDay\(/);
    assert.match(body, /cancelKeys\.forEach\(dayKey => \{/);
    assert.match(body, /delete sourceMap\[dayKey\]/);
    // Persiste cada mapa segun el tipo de permiso.
    assert.match(body, /setJSON\(`admin_\$\{profileName\}`, admin\)/);
    assert.match(body, /setJSON\(`legal_\$\{profileName\}`, legal\)/);
    assert.match(body, /setJSON\(`comp_\$\{profileName\}`, comp\)/);
    assert.match(body, /setJSON\(`absences_\$\{profileName\}`, absences\)/);
    // Libera los bloqueos del periodo solo si ya no queda ninguna ausencia.
    assert.match(body, /cancelKeys\.forEach\(dayKey => \{/);
    assert.match(body, /delete blocked\[dayKey\]/);
    assert.match(body, /setJSON\(`blocked_\$\{profileName\}`, blocked\)/);
});

test("la anulacion manual resuelve el periodo completo de una licencia", () => {
    const start = calendar.indexOf(
        "function leaveCancellationKeysForDay("
    );
    assert.notEqual(start, -1, "no se encontro leaveCancellationKeysForDay");
    const body = calendar.slice(start, start + 1800);

    assert.match(body, /info\?\.keys/);
    assert.match(body, /explicitKeys\.includes\(keyDay\)/);
    assert.match(body, /contiguousLeaveKeysForDay\(sourceMap, type, keyDay\)/);
});

test("undoAuditLogEntry borra el periodo completo registrado en el LOG", () => {
    assert.match(
        auditLog,
        /function removeAbsenceBlock\(\s*profile,\s*startKey,\s*amount,\s*type,\s*explicitKeys = \[\]/
    );
    assert.match(
        auditLog,
        /const targetKeys = explicitKeys\.length[\s\S]*?contiguousAbsenceKeys\(absences, startKey, type\)/
    );
    assert.match(
        auditLog,
        /const explicitKeys = normalizeKeyList\(log\?\.meta\?\.keys\)/
    );
    assert.match(
        auditLog,
        /removeAbsenceBlock\(\s*profile,\s*startKey,\s*amount,\s*type,\s*explicitKeys\s*\)/
    );
    assert.match(
        auditLog,
        /logTypeCanUseMapSpan\(type\)[\s\S]*?mapSpanIncludes\(sourceMap, type, startKey, keyDay\)/
    );
});

test("el listener auditUndoApplied refresca las filas de quienes cubrian", () => {
    const start = main.indexOf(
        'window.addEventListener("proturnos:auditUndoApplied"'
    );
    assert.notEqual(start, -1, "no se encontro el listener auditUndoApplied");
    const body = main.slice(start, start + 1400);

    // Ademas del ausente, refresca el timeline de cada trabajador cuyo reemplazo
    // se cancelo, para que su turno extra y su resumen de HH.EE se actualicen.
    assert.match(body, /canceledReplacements/);
    assert.match(body, /\.forEach\(worker => updateTimelineCells\(worker\)\)/);
});

test("el refresco por cambio de estado recomputa HH.EE frescas", () => {
    const start = timeline.indexOf("const handleTimelineStateChange = (");
    assert.notEqual(
        start,
        -1,
        "no se encontro el manejador de cambios de estado del timeline"
    );
    const body = timeline.slice(start, start + 1900);

    // Sin forceFreshMetrics, el resumen de HH.EE de los perfiles afectados se
    // servia del caché/resumen publicado stale tras anular un permiso.
    assert.match(
        body,
        /refreshVisibleTimelineRows\(affectedProfiles,\s*\{\s*forceFreshMetrics: true\s*\}\s*\)/
    );
    // Marca a los editados como "dirty" para no volver a hidratar su publicado.
    assert.match(body, /timelineLocallyDirtyProfiles\.add\(name\)/);
});

test("un cambio de otra sesion pasa por el mismo refresco del timeline", () => {
    // El apply remoto escribe en silencio, asi que no emite persistenceChanged.
    // Cuando este listener solo miraba "app-state-applied" -la hidratacion
    // inicial-, el timeline seguia pintando desde su cache y el turno editado
    // por el supervisor no aparecia hasta apretar refrescar.
    assert.match(
        timeline,
        /window\.addEventListener\("proturnos:persistenceChanged", event => \{\s*\n\s*handleTimelineStateChange\(event\.detail\);/
    );
    assert.match(
        timeline,
        /if \(type === "app-state-entries-applied"\) \{\s*\n\s*handleTimelineStateChange\(/
    );
});

test("el publicado no se hidrata para perfiles editados localmente", () => {
    assert.match(timeline, /const timelineLocallyDirtyProfiles = new Set\(\)/);
    // hydrateTimelineHheeFromPublished salta los perfiles marcados dirty.
    const start = timeline.indexOf(
        "async function hydrateTimelineHheeFromPublished("
    );
    assert.notEqual(start, -1, "no se encontro hydrateTimelineHheeFromPublished");
    const body = timeline.slice(start, start + 1600);

    assert.match(
        body,
        /if \(timelineLocallyDirtyProfiles\.has\(profile\.name\)\) continue/
    );
});

test("updateTimelineCells captura la fila ANTES de reemplazar casillas", () => {
    const start = timeline.indexOf(
        "export function updateTimelineCells("
    );
    assert.notEqual(start, -1, "no se encontro updateTimelineCells");
    const body = timeline.slice(start, start + 3200);

    // Regresion: sin claves se reemplazan TODAS las casillas (incluida rowCell),
    // que quedaria desprendida; su .closest() daria null y las HH.EE no se
    // recalculaban. La fila se captura antes del loop y se reutiliza.
    const rowDecl = body.indexOf(
        'const timelineRow = rowCell.closest("[data-timeline-row]")'
    );
    const loopStart = body.indexOf("targetKeys.forEach");
    assert.notEqual(rowDecl, -1, "no se captura timelineRow");
    assert.notEqual(loopStart, -1, "no se encontro el loop de casillas");
    assert.ok(
        rowDecl < loopStart,
        "timelineRow debe capturarse ANTES del loop de casillas"
    );
    assert.match(
        body,
        /refreshTimelineRowHheeCells\(\s*timelineRow,/
    );
});

test("restoreLeaveBalanceFromUndo es idempotente por logId", () => {
    const start = main.indexOf("function restoreLeaveBalanceFromUndo(");
    assert.notEqual(start, -1, "no se encontro restoreLeaveBalanceFromUndo");
    const body = main.slice(start, start + 900);

    // Guarda: cada anulacion (logId) restaura el saldo una sola vez.
    assert.match(body, /restoredBalanceLogIds\.has\(logId\)/);
    assert.match(body, /restoredBalanceLogIds\.add\(logId\)/);
    assert.match(
        main,
        /const restoredBalanceLogIds = new Set\(\)/
    );
});

test("una cobertura tardia se anula si el permiso ya no existe", () => {
    assert.match(
        replacements,
        /export function cancelOrphanedReplacementCoverage\(\)/
    );
    assert.match(
        replacements,
        /String\(replacement\?\.id \|\| ""\)\.startsWith\("coverage:"\)/
    );
    assert.match(
        replacements,
        /!workerHasAbsence\(\s*replacement\.replaced,\s*keyFromISO\(replacement\.date\)\s*\)/
    );
    assert.match(
        replacements,
        /queueMicrotask\(cancelOrphanedReplacementCoverage\)/
    );
});
