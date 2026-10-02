// Los modales de detalle del calendario decian QUE paso y CUANDO, pero no
// QUIEN: con varios administradores en un entorno, ver un turno movido o un
// cambio de turno no dejaba manera de saber a quien preguntarle.
//
// El dato sale del LOG de auditoria, no del propio movimiento/cambio: los
// registros viejos no lo guardaron, y de ahi tomarlo evita inventarlo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const calendar = await read("../js/calendar.js");
const auditLog = await read("../js/auditLog.js");

test("el traslado se busca por origen+destino, no por keyDay", () => {
    // `latestCalendarActionInfo` no sirve: el traslado guarda el par
    // sourceKey/targetKey y no `meta.keyDay`, asi que ese helper nunca
    // encontraria el registro.
    assert.match(auditLog, /export function getShiftMoveAuditInfo\(profile, sourceKey, targetKey\)/);
    assert.match(
        auditLog,
        /String\(item\?\.meta\?\.sourceKey \|\| ""\) === source &&\s*\n\s*String\(item\?\.meta\?\.targetKey \|\| ""\) === target/
    );
    // Y contra la accion que efectivamente registra el traslado.
    assert.match(auditLog, /String\(item\?\.action \|\| ""\) === "Movio turno base"/);
});

test("el cambio de turno se busca por su id", () => {
    // Las fechas de un swap pueden coincidir con las de otro; el id no.
    assert.match(auditLog, /export function getSwapAuditInfo\(swapId\)/);
    assert.match(auditLog, /String\(item\?\.meta\?\.swapId \|\| ""\) === id/);
    assert.match(
        auditLog,
        /String\(item\?\.action \|\| ""\) === "Registro cambio de turno"/
    );
});

test("las acciones buscadas existen tal cual en el codigo que las registra", async () => {
    // Si alguien renombra la accion del log, el modal deja de mostrar el autor
    // en silencio. Esto ata las dos puntas.
    const main = await read("../js/main.js");
    const swaps = await read("../js/swaps.js");

    assert.match(main, /"Movio turno base"/);
    assert.match(swaps, /"Registro cambio de turno"/);
});

test("el modal de turno movido muestra quien lo hizo", () => {
    assert.match(calendar, /\["Movido por", actorLabelHTML\(audit\), true\]/);
    assert.match(
        calendar,
        /getShiftMoveAuditInfo\(\s*\n\s*move\.profile,\s*\n\s*move\.sourceKey,\s*\n\s*move\.targetKey\s*\n\s*\)/
    );
});

test("el modal de cambio de turno muestra quien lo registro", () => {
    assert.match(calendar, /const audit = getSwapAuditInfo\(swap\.id\);/);
    assert.match(calendar, /<span>Registrado por<\/span>/);
});

test("sin registro en el log no se inventa un autor: se omite la fila", () => {
    // Un traslado anterior a esta pantalla, o cuyo log ya fue evicto, no tiene
    // a quien atribuirse. Mostrar un nombre equivocado seria peor que no
    // mostrar ninguno.
    assert.match(
        calendar,
        /return audit \? \["Movido por", actorLabelHTML\(audit\), true\] : null;/
    );
    // En el de cambio de turno, la fila entera es condicional y cae a vacio.
    const swapBlock = calendar.slice(
        calendar.indexOf("const audit = getSwapAuditInfo(swap.id);"),
        calendar.indexOf("const audit = getSwapAuditInfo(swap.id);") + 400
    );

    assert.match(swapBlock, /return audit \? `/);
    assert.match(swapBlock, /` : "";/);
});

test("el nombre sale del actor del log, con respaldo si falta", () => {
    // logActorName recorre las formas en que quedo guardado el actor segun la
    // epoca del registro.
    assert.match(auditLog, /actorName: logActorName\(log\) \|\| "No registrado"/);
});

// El "Por" del modal decia "Tecnologo Supervisor": el displayName de la cuenta
// de Google es el del servicio, no el de la persona que apreto el boton. Con
// varios supervisores compartiendo el entorno, la fila estaba pero no servia
// para saber a quien preguntarle.
test("el nombre visible de AJUSTES > USUARIOS manda sobre el de la cuenta", () => {
    // Al GUARDAR el registro nuevo.
    assert.match(
        auditLog,
        /return getAdminDisplayName\(user\?\.email\) \|\|\s*\n\s*user\?\.displayName \|\|/
    );
    // Y al MOSTRAR uno viejo: los que ya quedaron escritos con el alias de
    // Google tambien pasan a decir quien fue, porque se resuelve por correo.
    assert.match(
        auditLog,
        /function logActorName\(log\) \{\s*\n\s*const email = logActorEmail\(log\);\s*\n\s*\n\s*return String\(\s*\n\s*getAdminDisplayName\(email\) \|\|/
    );
});

test("el correo de la cuenta acompana al nombre", () => {
    // Es lo unico que identifica sin ambiguedad: dos cuentas pueden llamarse
    // igual, y un nombre generico no dice nada.
    assert.match(auditLog, /function logActorEmail\(log\) \{/);
    assert.match(auditLog, /log\?\.actor\?\.email \|\|\s*\n\s*log\?\.meta\?\.actorEmail \|\|/);
    // Y viaja en los cuatro informes que alimentan los modales, mas la entrada
    // del panel del LOG.
    assert.equal(
        (auditLog.match(/actorEmail: logActorEmail\(log\)/g) || []).length,
        5
    );
});

test("el correo va en su propia linea, no pegado al nombre", async () => {
    // Las filas de estos modales capitalizan su valor
    // (.leave-detail-rows b { text-transform: capitalize }), asi que un correo
    // dentro del nombre se leeria como mal escrito.
    assert.match(auditLog, /class="detail-actor-email"/);

    const styles = await read("../styles.css");
    const rule = styles.slice(
        styles.indexOf(".detail-actor-email {"),
        styles.indexOf(".detail-actor-email {") + 260
    );

    assert.match(rule, /display: block;/);
    assert.match(rule, /text-transform: none;/);
});

test("los modales de detalle usan el helper y no el campo crudo", () => {
    // Si alguno vuelve a imprimir `info.actorName` a secas, pierde el correo.
    assert.doesNotMatch(calendar, /escapeHTML\(\s*(info|audit|noCoverageInfo)\?\.actorName/);
    assert.match(calendar, /<span>Por<\/span><b>\$\{actorLabelHTML\(info\)\}<\/b>/);
    assert.match(
        calendar,
        /<span>Por<\/span><b>\$\{actorLabelHTML\(noCoverageInfo\)\}<\/b>/
    );
    assert.equal(
        (calendar.match(/<span>Por<\/span><b>\$\{actorHTML\}<\/b>/g) || []).length,
        2
    );
});

test("el detalle de un permiso espera la bitacora diferida", () => {
    const start = calendar.indexOf("async function openLeaveDetailDialog({");
    const end = calendar.indexOf("function attendanceMarksSlotHTML", start);
    const detailBlock = calendar.slice(start, end);

    assert.notEqual(start, -1);
    assert.match(
        detailBlock,
        /await hydrateDeferredStateModule\("log"\)/
    );
    assert.ok(
        detailBlock.indexOf('await hydrateDeferredStateModule("log")') <
        detailBlock.indexOf("loadLeaveApplicationInfo({"),
        "la bitacora debe llegar antes de buscar el permiso"
    );
    assert.match(
        detailBlock,
        /await loadLeaveApplicationInfo\(\{[\s\S]*?\.\.\.reference/
    );
    assert.match(
        calendar,
        /await openLeaveDetailDialog\(\{\s*\n\s*profile: profileName/
    );
});

test("el permiso archivado usa el logId del memorandum o reemplazo", async () => {
    assert.match(calendar, /function leaveAuditReferenceForDay\(/);
    assert.match(calendar, /if \(memo\?\.logId\)/);
    assert.match(calendar, /String\(item\?\.leaveLogId \|\| ""\)\.trim\(\)/);

    const auditReader = await read("../js/firebaseAuditLogShardReader.js");
    assert.match(
        auditReader,
        /export async function readFirebaseAuditLogShardEntry/
    );
    assert.match(
        auditLog,
        /await readFirebaseAuditLogShardEntry\(logId, createdAt\)/
    );
});
