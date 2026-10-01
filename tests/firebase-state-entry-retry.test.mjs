import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Un cambio local que se encola sin timer no da error: simplemente nunca sube.
// El usuario lo ve aplicado, y cuando vence su proteccion local de 30 minutos
// el estado remoto lo pisa y "desaparece solo". Estas pruebas sujetan los tres
// puntos donde eso podia pasar.

const readSource = () => readFile(
    new URL("../js/firebaseAppState.js", import.meta.url),
    "utf8"
);

test("encolar un cambio con el estado remoto aplicandose deja un reintento", async () => {
    const source = await readSource();

    assert.match(
        source,
        /function queuePartialStateEntries[\s\S]{0,500}if \(applyingRemoteState \|\| waitingInitialState\) \{\s*\n\s*scheduleEntrySyncRetry\(\);/
    );
});

test("el envio bloqueado se reprograma en vez de devolver en silencio", async () => {
    const source = await readSource();

    assert.match(
        source,
        /async function flushPartialStateEntries[\s\S]{0,400}if \(applyingRemoteState \|\| waitingInitialState \|\| entrySyncInFlight\) \{\s*\n\s*scheduleEntrySyncRetry\(\);/
    );
});

test("al terminar el apply remoto se le devuelve el turno al envio local", async () => {
    const source = await readSource();

    // El apply remoto es justo la condicion que bloquea el envio local: si al
    // terminar no avisa, lo encolado se queda sin nadie que lo reintente.
    assert.match(
        source,
        /remoteApplyInFlight = false;[\s\S]{0,800}if \(pendingStateEntries\.size\) \{\s*\n\s*scheduleEntrySyncRetry\(\);/
    );
});

test("el reintento existe aparte porque scheduleEntrySync descarta la programacion", async () => {
    const source = await readSource();

    // `scheduleEntrySync` sigue abandonando ante las condiciones transitorias;
    // por eso el reintento programa el timer por su cuenta.
    assert.match(source, /function scheduleEntrySyncRetry\(delay = ENTRY_BLOCKED_RETRY_MS\)/);
    assert.match(
        source,
        /function scheduleEntrySyncRetry[\s\S]{0,300}entrySyncTimer = setTimeout\(flushPartialStateEntries, delay\)/
    );
    assert.match(source, /const ENTRY_BLOCKED_RETRY_MS = \d+;/);
});

test("el reintento no se programa si no hay nada encolado ni workspace", async () => {
    const source = await readSource();

    // Sin este guardia el timer se reprogramaria solo para siempre.
    assert.match(
        source,
        /function scheduleEntrySyncRetry[\s\S]{0,200}if \(!pendingStateEntries\.size \|\| !activeWorkspaceId\) return;/
    );
});

test("un LOG encolado no se pierde si otro cambio urgente se guarda antes", async () => {
    const source = await readSource();
    const flush = source.slice(
        source.indexOf("async function flushPartialStateEntries()"),
        source.indexOf("// Firestore no avisa", source.indexOf("async function flushPartialStateEntries()"))
    );

    assert.match(
        flush,
        /const deferred = pending\.filter\(entry =>\s*deferredPendingModules\.has\(entry\.moduleId\)\s*\);/
    );
    assert.match(flush, /queueGroupedPartialStateEntries\(deferred\);/);
    assert.match(
        flush,
        /const writable = pending\.filter\(entry =>\s*!deferredPendingModules\.has\(entry\.moduleId\) &&\s*canWriteModule\(entry\.moduleId\)\s*\);/
    );
    assert.match(flush, /if \(!writable\.length\) return;/);
});

test("hidratar LOG reanuda de inmediato las entradas que quedaron en cola", async () => {
    const source = await readSource();
    const hydrate = source.slice(source.indexOf("hydrateDeferred = async moduleId"));
    const opensBarrier = hydrate.indexOf("deferredPendingModules.delete(moduleId)");
    const resumesQueue = hydrate.indexOf(
        "scheduleEntrySync(0, { urgent: true })",
        opensBarrier
    );

    assert.notEqual(opensBarrier, -1, "la hidratacion ya no abre la barrera");
    assert.ok(
        resumesQueue > opensBarrier,
        "la cola se reanuda antes de abrir la barrera o no se reanuda"
    );
});
