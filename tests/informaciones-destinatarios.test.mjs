import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    AUDIENCE_MODES,
    audienceIncludes,
    audienceIsEmpty,
    audienceSummary,
    categoryLabel,
    effectiveStatus,
    isVisibleToWorkers,
    normalizeAudience,
    normalizeCategory,
    normalizeStatus
} from "../js/informationsModel.js";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

const TM = { name: "BEATRIZ ESCOBAR", estamento: "Tecnologo Medico", profession: "Imagenologia" };
const TENS = { name: "ANDREA NILO", estamento: "TENS", profession: "Enfermeria" };

/* ==========================================================================
   Destinatarios
   ========================================================================== */

test("sin destinatarios guardados la informacion es para todos", () => {
    // Es la compatibilidad hacia atras: las informaciones que existian antes de
    // este cambio no traen `audience` y les llegaban a todos.
    const audience = normalizeAudience(undefined);

    assert.equal(audience.mode, "all");
    assert.ok(audienceIncludes(audience, TM));
    assert.ok(audienceIncludes(audience, TENS));
    assert.ok(!audienceIsEmpty(audience));
});

test("por estamento solo entra el estamento elegido", () => {
    const audience = normalizeAudience({
        mode: "estamento",
        groups: ["Tecnologo Medico"]
    });

    assert.ok(audienceIncludes(audience, TM));
    assert.ok(!audienceIncludes(audience, TENS));
});

test("por profesion mira la profesion, no el estamento", () => {
    const audience = normalizeAudience({
        mode: "profession",
        groups: ["Enfermeria"]
    });

    assert.ok(audienceIncludes(audience, TENS));
    assert.ok(!audienceIncludes(audience, TM));
});

test("por personas se compara el nombre sin importar mayusculas", () => {
    const audience = normalizeAudience({
        mode: "people",
        people: ["beatriz escobar"]
    });

    assert.ok(audienceIncludes(audience, TM));
    assert.ok(!audienceIncludes(audience, TENS));
});

test("un modo por grupos sin ningun grupo no le llega a nadie", () => {
    // No se corrige solo a "todos": mandarselo a gente que no se eligio seria
    // peor que no mandarlo. El panel lo marca en rojo y no deja publicar.
    const audience = normalizeAudience({ mode: "estamento", groups: [] });

    assert.ok(audienceIsEmpty(audience));
    assert.ok(!audienceIncludes(audience, TM));
});

test("los destinatarios repetidos o vacios se limpian", () => {
    const audience = normalizeAudience({
        mode: "people",
        people: ["ANA", " ANA ", "", null, "LUIS"]
    });

    assert.deepEqual(audience.people, ["ANA", "LUIS"]);
});

test("un modo desconocido cae en todos y no rompe", () => {
    assert.equal(normalizeAudience({ mode: "inventado" }).mode, "all");
    assert.ok(AUDIENCE_MODES.includes("estamento"));
    // El turno queda fuera a proposito: no es un grupo estable.
    assert.ok(!AUDIENCE_MODES.includes("turno"));
});

test("el resumen dice a quien le llega", () => {
    assert.equal(
        audienceSummary(normalizeAudience({ mode: "all" }), 132),
        "Toda la unidad - 132 personas"
    );
    assert.equal(
        audienceSummary(normalizeAudience({ mode: "estamento", groups: [] })),
        "Sin destinatarios elegidos"
    );
    assert.match(
        audienceSummary(
            normalizeAudience({
                mode: "estamento",
                groups: ["Tecnologo Medico", "TENS", "Enfermeria", "Auxiliares"]
            }),
            60
        ),
        /y 2 mas - 60 personas/
    );
});

/* ==========================================================================
   Categoria
   ========================================================================== */

test("la categoria desconocida cae en general", () => {
    assert.equal(normalizeCategory("protocolo"), "protocolo");
    assert.equal(normalizeCategory("PROTOCOLO"), "protocolo");
    assert.equal(normalizeCategory(""), "general");
    assert.equal(normalizeCategory("inventada"), "general");
    assert.equal(categoryLabel("urgente"), "Urgente");
});

/* ==========================================================================
   Programacion y vencimiento
   ========================================================================== */

const HOUR = 3600000;

test("la programada se esconde hasta su hora y despues se publica sola", () => {
    const now = Date.parse("2026-09-10T12:00:00.000Z");
    const futura = {
        status: "scheduled",
        publishAt: "2026-09-11T07:00:00.000Z"
    };
    const cumplida = {
        status: "scheduled",
        publishAt: "2026-09-10T07:00:00.000Z"
    };

    assert.equal(effectiveStatus(futura, now), "scheduled");
    assert.ok(!isVisibleToWorkers(futura, now));
    // Nadie tuvo que abrir la aplicacion a las 07:00: el estado se calcula
    // contra el reloj cada vez que se mira.
    assert.equal(effectiveStatus(cumplida, now), "published");
    assert.ok(isVisibleToWorkers(cumplida, now));
});

test("la vencida se archiva sola", () => {
    const now = Date.parse("2026-09-10T12:00:00.000Z");
    const vigente = {
        status: "published",
        expiresAt: new Date(now + HOUR).toISOString()
    };
    const vencida = {
        status: "published",
        expiresAt: new Date(now - HOUR).toISOString()
    };

    assert.equal(effectiveStatus(vigente, now), "published");
    assert.equal(effectiveStatus(vencida, now), "archived");
    assert.ok(!isVisibleToWorkers(vencida, now));
});

test("el borrador y la archivada a mano no dependen del reloj", () => {
    const now = Date.parse("2026-09-10T12:00:00.000Z");

    assert.equal(effectiveStatus({ status: "draft" }, now), "draft");
    assert.equal(effectiveStatus({ status: "archived" }, now), "archived");
    // Un borrador con fecha pasada sigue siendo borrador: no se publica solo.
    assert.equal(
        effectiveStatus({ status: "draft", publishAt: "2020-01-01T00:00:00.000Z" }, now),
        "draft"
    );
});

test("sin estado guardado la informacion es una publicada de antes", () => {
    assert.equal(normalizeStatus(undefined), "published");
    assert.equal(normalizeStatus("inventado"), "published");
    assert.ok(isVisibleToWorkers({}, Date.now()));
});

/* ==========================================================================
   Lo que viaja, y lo que no
   ========================================================================== */

test("el borrador nunca sale y la programada sale con su fecha", async () => {
    const source = await read("../js/informations.js");

    // Si esto se pierde, un borrador a medio escribir aparece en el telefono
    // de todos.
    assert.match(source, /status !== "draft" && status !== "archived"/);
    // La programada tiene que viajar CON su fecha o la PWA no sabe cuando
    // mostrarla.
    assert.match(source, /publishAt: item\.publishAt/);
    assert.match(source, /expiresAt: item\.expiresAt/);
    assert.match(source, /audience: item\.audience/);
    assert.match(source, /requiresAck: item\.requiresAck/);
});

test("se sigue publicando la etiqueta vieja para la PWA sin actualizar", async () => {
    const source = await read("../js/informations.js");

    // `type` (Anuncio / Imagen / Documento) lo lee la version anterior de la
    // aplicacion del trabajador. Quitarlo la dejaria sin etiqueta.
    assert.match(source, /type: informationType\(item\)/);
    assert.match(source, /function informationType/);
});

test("la PWA filtra por destinatarios y por fecha antes de pintar", async () => {
    const app = await read("../../APP TurnoPlus/www/js/app.js");

    assert.match(app, /function informationIsForMe/);
    assert.match(app, /function informationIsVisibleNow/);
    assert.match(
        app,
        /getPublishedInformations\(\)[\s\S]{0,260}informationIsVisibleNow[\s\S]{0,120}informationIsForMe/
    );
    // Sin el dato en el perfil se muestra: esconder por un campo vacio es peor.
    assert.match(app, /if \(!value\) return true;/);
});

test("el switch de avisar crea notificaciones solo al publicar", async () => {
    const [panel, functions] = await Promise.all([
        read("../js/informations.js"),
        read("../functions/index.js")
    ]);

    assert.match(panel, /function shouldNotifyInformationPublish/);
    assert.match(panel, /!nextItem\?\.notify \|\| status !== "published"/);
    assert.match(panel, /effectiveStatus\(current\) !== "published"/);
    assert.match(panel, /function informationNotificationRecipientUids/);
    assert.match(panel, /notifyInformationPublished\(nextItem\)/);
    assert.match(panel, /"notifyInformationPublished"/);
    assert.match(panel, /recipientUids/);

    assert.match(functions, /exports\.notifyInformationPublished = onCall/);
    assert.match(functions, /memberCanPublishInformations\(member\)/);
    assert.match(functions, /"workerNotifications"/);
    assert.match(functions, /type:\s*"information_published"/);
    assert.match(functions, /category:\s*"informations"/);
    assert.match(functions, /screen:\s*"informaciones"/);
    assert.match(functions, /informationId/);
});

test("la confirmacion la escribe el trabajador en su propio documento", async () => {
    const [app, rules] = await Promise.all([
        read("../../APP TurnoPlus/www/js/app.js"),
        read("../firebase.rules")
    ]);

    assert.match(app, /function confirmInformationRead/);
    assert.match(app, /"informationReads"/);
    // La regla acota QUE puede escribir el trabajador y a quien pertenece el
    // documento: nadie firma por otro.
    assert.match(rules, /match \/informationReads\/\{userId\}/);
    assert.match(
        rules,
        /allow create: if isLinkedWorker\(workspaceId, userId\)[\s\S]{0,200}"profileName"[\s\S]{0,60}"acks"/
    );
    // Solo se agregan confirmaciones: sin este `hasAll`, escribir `acks: {}`
    // encima vaciaba el informe pese a tener prohibido el borrado.
    assert.match(
        rules,
        /request\.resource\.data\.acks\.keys\(\)\.hasAll\(resource\.data\.acks\.keys\(\)\)/
    );
    assert.match(rules, /allow list: if canViewInformationsMenu\(workspaceId\)/);
    assert.match(rules, /allow delete: if false;/);
});

test("el compositor no repinta el panel con cada tecla", async () => {
    const source = await read("../js/informations.js");

    // Repintar con cada letra le quita el foco al campo. El titulo y el
    // mensaje se copian a mano a la vista previa.
    assert.match(source, /function updateComposerLive/);
    assert.match(source, /titleInput\.oninput/);
    assert.match(source, /bodyInput\.oninput/);
});

/* ==========================================================================
   Trampas que ya se pisaron una vez
   ========================================================================== */

test("el archivo elegido sobrevive a repintar el compositor", async () => {
    const source = await read("../js/informations.js");

    // El panel se repinta entero con cada interruptor y eso vacia el
    // <input type="file">. Los archivos elegidos viven en el borrador.
    assert.match(source, /pendingFiles: \[\]/);
    assert.match(source, /const files = composerDraft\.pendingFiles;/);
    assert.doesNotMatch(source, /Array\.from\(form\.elements\.files\?\.files/);
});

test("volver a publicar una vencida le apaga el vencimiento", async () => {
    const source = await read("../js/informations.js");

    // Sin esto el calculo del estado la archiva de nuevo en el acto y el boton
    // parece no hacer nada.
    assert.match(source, /expiresAt: status === "published" && expired \? "" : item\.expiresAt/);
});

test("las confirmaciones se cruzan por uid y no por nombre", async () => {
    const [panel, reads] = await Promise.all([
        read("../js/informations.js"),
        read("../js/informationReads.js")
    ]);

    // Un perfil renombrado deja el enlace con el nombre viejo: cruzar por
    // nombre lo dejaria como pendiente para siempre.
    assert.match(panel, /function uidOf/);
    assert.match(panel, /hasRead\(item\.id, uidOf\(profile\)\)/);
    assert.match(reads, /export function hasRead/);
    assert.doesNotMatch(reads, /entry\.profileName\.toLowerCase\(\)/);
});

test("los adjuntos quitados se borran de Storage recien al guardar", async () => {
    const source = await read("../js/informations.js");

    assert.match(source, /const kept = new Set\(nextItem\.attachments\.map/);
    assert.match(source, /deleteStoredAttachment\(file\)/);
});

test("una confirmacion ajena no repinta con el compositor abierto", async () => {
    const source = await read("../js/informations.js");

    assert.match(source, /const repaintInbox = \(\) => \{\s*if \(!composerDraft\) repaint\(\);/);
    assert.match(
        source,
        /"proturnos:informationReadsChanged", repaintInbox/
    );
});

test("el filtro de la PWA no deja la lista vacia sin salida", async () => {
    const app = await read("../../APP TurnoPlus/www/js/app.js");

    assert.match(
        app,
        /if \(!pending && informationFilter !== "todas"\) informationFilter = "todas";/
    );
});

test("toda clase information-* que se emite tiene estilo", async () => {
    const [source, css] = await Promise.all([
        read("../js/informations.js"),
        read("../styles.css")
    ]);

    // Asi se colaron `information-type--purple` y `--red`: el panel las
    // emitia, nadie las habia escrito, y las cinco categorias se veian del
    // mismo azul. No da error en ningun lado; solo se ve mal.
    const emitted = new Set();
    const classAttr = /class="([^"]*)"/g;
    let match;

    while ((match = classAttr.exec(source))) {
        match[1]
            .split(/\s+/)
            // "information-tab${activeTab === ..." -> "information-tab". Lo que
            // va detras de la interpolacion son variantes (` is-on`), que se
            // comprueban por su cuenta mas abajo.
            .map(name => name.split("${")[0])
            .filter(name => name.startsWith("information-") && !name.includes("$"))
            .forEach(name => emitted.add(name));
    }

    // Las que se arman con un tono: `information-type--${tone}`.
    const tones = ["purple", "blue", "red", "green", "orange"];

    tones.forEach(tone => {
        emitted.add(`information-type--${tone}`);
        emitted.add(`information-chip-filter--${tone}`);
    });
    ["pdf", "doc", "xls", "img"].forEach(ext => {
        emitted.add(`information-file__badge--${ext}`);
    });
    ["blue", "purple", "teal", "orange", "muted"].forEach(tone => {
        emitted.add(`information-reader__avatar--${tone}`);
    });
    ["ok", "mid", "low"].forEach(level => {
        emitted.add(`information-read--${level}`);
    });

    // Las compartidas con el resto de la aplicacion tambien: `ghost-button--small`
    // y `danger-action` se emitian sin regla y salian, respectivamente, a doble
    // altura y como un boton pelado.
    [
        "primary-button",
        "secondary-button",
        "secondary-button--small",
        "ghost-button",
        "ghost-button--small",
        "danger-action",
        "empty-state--compact",
        "worker-request-counter",
        "worker-request-type"
    ].forEach(name => emitted.add(name));

    const missing = [...emitted].filter(name => !css.includes(`.${name}`));

    assert.deepEqual(
        missing,
        [],
        `clases sin estilo en styles.css: ${missing.join(", ")}`
    );
});
