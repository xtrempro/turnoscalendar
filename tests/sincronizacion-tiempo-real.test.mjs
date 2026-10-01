import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    planEntrySyncDelay,
    planRemoteStateApplyDelay
} from "../js/firebaseAppState.js";

// Un supervisor modifica un turno; un administrador colaborador mira el sistema
// al mismo tiempo y no lo ve aparecer: ni esperando, ni cambiando de menu. Solo
// el boton de refrescar lo traia.
//
// La causa era que las dos colas -la que sube el cambio y la que lo aplica-
// recalculaban su espera completa en cada reintento. Con la pestaña visible la
// espera se renovaba indefinidamente y el cambio nunca cruzaba. Estas pruebas
// sujetan el techo que lo impide.

const NOW = 1_700_000_000_000;

test("mirando el calendario, el cambio ajeno no se difiere para siempre", () => {
    const enCalendario = {
        now: NOW,
        visible: true,
        activeView: "turnos",
        lastUserActivityAt: NOW,
        oldestQueuedAt: NOW,
        urgent: false
    };

    // Antes esta rama devolvia 90 s fijos, y al vencer volvia a devolver 90 s.
    const primera = planRemoteStateApplyDelay(enCalendario);
    assert.ok(primera > 0, "sigue habiendo un diferimiento inicial");
    assert.ok(primera <= 6000, `la primera espera es acotada, no ${primera}`);

    // Tras agotarse el techo se aplica, siga o no el usuario en el calendario.
    assert.equal(
        planRemoteStateApplyDelay({
            ...enCalendario,
            now: NOW + 6000,
            lastUserActivityAt: NOW + 6000
        }),
        0
    );
});

test("la actividad continua del usuario ya no renueva la espera", () => {
    // El mouse sobre la app refrescaba `lastUserActivityAt` y con el la espera
    // entera: quien usaba el sistema nunca alcanzaba los 90 s de quietud.
    const moviendoseSiempre = paso => planRemoteStateApplyDelay({
        now: NOW + paso,
        visible: true,
        activeView: "dashboard",
        lastUserActivityAt: NOW + paso,
        oldestQueuedAt: NOW,
        urgent: false
    });

    assert.ok(moviendoseSiempre(0) > 0);
    assert.equal(moviendoseSiempre(6000), 0);
    assert.equal(moviendoseSiempre(60000), 0);
});

test("un turno ajeno se aplica en menos de un segundo", () => {
    // Turnos, permisos y reemplazos son lo que el otro perfil ve en pantalla:
    // se agrupan lo justo para no aplicar una edicion entrada por entrada.
    const delay = planRemoteStateApplyDelay({
        now: NOW,
        visible: true,
        activeView: "turnos",
        pendingInput: true,
        lastUserActivityAt: NOW,
        oldestQueuedAt: NOW,
        urgent: true
    });

    assert.ok(delay > 0, "se agrupa la rafaga de una misma edicion");
    assert.ok(delay <= 1000, `debe verse casi al instante, no en ${delay} ms`);
});

test("una entrada urgente encolada tampoco espera mas que su techo", () => {
    assert.equal(
        planRemoteStateApplyDelay({
            now: NOW + 2000,
            visible: true,
            activeView: "turnos",
            pendingInput: true,
            lastUserActivityAt: NOW + 2000,
            oldestQueuedAt: NOW,
            urgent: true
        }),
        0
    );
});

test("con la pestaña oculta se sigue aplicando de inmediato", () => {
    assert.equal(
        planRemoteStateApplyDelay({
            now: NOW,
            visible: false,
            activeView: "turnos",
            lastUserActivityAt: NOW,
            oldestQueuedAt: NOW
        }),
        0
    );
});

test("una clave no urgente ya no se queda sin subir con la pestaña abierta", () => {
    // `firebaseStateInteractiveDelay` devolvia 90 s mientras la pestaña
    // estuviera visible, sin mirar la antiguedad de lo encolado: el cambio solo
    // subia al ocultar la pestaña, y los demas perfiles no podian verlo nunca.
    const visibleYActivo = paso => planEntrySyncDelay({
        now: NOW + paso,
        visible: true,
        pendingInput: true,
        oldestQueuedAt: NOW
    });

    assert.ok(visibleYActivo(0) > 0, "sigue difiriendo mientras se interactua");
    assert.ok(visibleYActivo(0) <= 8000);
    assert.equal(visibleYActivo(8000), 0, "al vencer el techo, sube");
});

test("sin nada encolado no se inventa una espera", () => {
    assert.equal(
        planEntrySyncDelay({ now: NOW, visible: true, oldestQueuedAt: 0 }),
        0
    );
});

test("la marca de antiguedad no se pisa mientras quede cola", async () => {
    const source = await readFile(
        new URL("../js/firebaseAppState.js", import.meta.url),
        "utf8"
    );

    // Si cada entrada nueva reiniciara la marca, el techo se renovaria solo y
    // volveriamos al diferimiento infinito que se acaba de cerrar.
    assert.match(
        source,
        /if \(pendingRemoteStateEntries\.size && !remoteQueueOldestAt\) \{\s*\n\s*remoteQueueOldestAt = Date\.now\(\);/
    );
    assert.match(
        source,
        /if \(pendingStateEntries\.size && !pendingEntriesOldestAt\) \{\s*\n\s*pendingEntriesOldestAt = Date\.now\(\);/
    );
});

test("al vaciarse la cola la marca vuelve a cero", async () => {
    const source = await readFile(
        new URL("../js/firebaseAppState.js", import.meta.url),
        "utf8"
    );

    // Sin el reseteo, la siguiente entrada nacería con el techo ya agotado y
    // perderia por completo el diferimiento que protege el hilo principal.
    assert.match(source, /\} else \{\s*\n\s*remoteQueueOldestAt = 0;/);
    assert.match(
        source,
        /\} else if \(!pendingStateEntries\.size\) \{\s*\n\s*pendingEntriesOldestAt = 0;/
    );
});

test("las vistas con cache se enteran del cambio ajeno, no solo del arranque", async () => {
    const [timeline, staffing] = await Promise.all([
        readFile(new URL("../js/timeline.js", import.meta.url), "utf8"),
        readFile(new URL("../js/staffing.js", import.meta.url), "utf8")
    ]);

    // `app-state-applied` se emite una sola vez, al hidratar el entorno. Lo que
    // edita otra sesion viaja en `app-state-entries-applied`. Escuchando solo el
    // primero, timeline y resumen RRHH servian de su cache indefinidamente: el
    // cambio ya estaba en el estado local y aun asi no se veia.
    assert.match(timeline, /"app-state-entries-applied"/);
    assert.match(timeline, /"app-state-module-applied"/);
    assert.match(staffing, /"app-state-entries-applied"/);
    assert.match(staffing, /"app-state-module-applied"/);
});

test("drenar una rafaga no cuesta una espera completa por lote", async () => {
    const source = await readFile(
        new URL("../js/firebaseAppState.js", import.meta.url),
        "utf8"
    );

    // Se cede el hilo entre lotes, pero en milisegundos: con los 30 s / 10 s de
    // antes, una edicion de varias claves tardaba minutos en cruzar entera.
    assert.match(source, /const REMOTE_APPLY_BATCH_GAP_MS = (\d{1,3});/);
    assert.match(source, /const ENTRY_SLICE_GAP_MS = (\d{1,3});/);
    assert.match(
        source,
        /batchGapPending\s*\n\s*\? REMOTE_APPLY_BATCH_GAP_MS/
    );
    assert.match(source, /scheduleEntrySync\(ENTRY_SLICE_GAP_MS\);/);
});
