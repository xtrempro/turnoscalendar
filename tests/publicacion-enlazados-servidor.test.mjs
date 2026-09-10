// Los dos documentos livianos de cada enlazado los publica ahora la Cloud
// Function, y el navegador del supervisor solo COMPRUEBA que esten.
//
// Antes los reescribia entero en cada carga de pagina: 132 documentos (66
// enlazados x 2) en ~54 s, por sesion y por supervisor, contendiendo por el
// mismo stream de escritura que sus propias ediciones.
//
// Lo que hace barata la migracion es la comparacion: si `updatedAtISO` -que
// cambia en CADA armado- entrara en ella, los 132 documentos se verian
// distintos siempre y no habriamos ganado nada.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
    linkedDocChanged,
    withoutVolatileFields,
    selectPrimaryLinkedProfiles,
    workerLinkRecency,
    VOLATILE_LINKED_DOC_FIELDS
} from "../js/serverLinkedDocs.js";

const cliente = await readFile(
    new URL("../js/workerAppDataSync.js", import.meta.url),
    "utf8"
);
const funcion = await readFile(
    new URL("../functions/workerAppProjection.js", import.meta.url),
    "utf8"
);
const escritor = await readFile(
    new URL("../functions/lib/linkedDocsWriter.js", import.meta.url),
    "utf8"
);
const harness = await readFile(
    new URL("../functions/lib/engineHarness.js", import.meta.url),
    "utf8"
);

const DOC = {
    uid: "u1",
    workspaceId: "ws",
    profileName: "ANA",
    worker: { name: "ANA", active: true },
    compatibleWorkerUids: ["u2", "u3"],
    updatedAtISO: "2026-09-10T01:00:00.000Z"
};

test("un documento identico salvo updatedAtISO NO cuenta como cambio", () => {
    const otro = { ...DOC, updatedAtISO: "2026-09-10T02:30:00.000Z" };

    assert.equal(linkedDocChanged(DOC, otro), false);
});

test("un cambio de verdad si se detecta, aunque sea anidado", () => {
    assert.equal(
        linkedDocChanged(DOC, { ...DOC, compatibleWorkerUids: ["u2"] }),
        true
    );
    assert.equal(
        linkedDocChanged(DOC, { ...DOC, worker: { name: "ANA", active: false } }),
        true
    );
});

test("un documento que no existe siempre cuenta como cambio", () => {
    assert.equal(linkedDocChanged(null, DOC), true);
    assert.equal(linkedDocChanged(undefined, DOC), true);
});

test("el orden de las propiedades no inventa cambios", () => {
    // Firestore no conserva el orden: comparar el JSON crudo daria falsos
    // positivos y reescribiria los 132 documentos.
    const alReves = {
        updatedAtISO: DOC.updatedAtISO,
        compatibleWorkerUids: DOC.compatibleWorkerUids,
        worker: { active: true, name: "ANA" },
        profileName: "ANA",
        workspaceId: "ws",
        uid: "u1"
    };

    assert.equal(linkedDocChanged(DOC, alReves), false);
});

test("updatedAt (el sello del servidor) tampoco entra en la comparacion", () => {
    assert.ok(VOLATILE_LINKED_DOC_FIELDS.includes("updatedAt"));
    assert.equal(
        Object.prototype.hasOwnProperty.call(
            withoutVolatileFields({ ...DOC, updatedAt: { seconds: 1 } }),
            "updatedAt"
        ),
        false
    );
});

test("con dos cuentas de la misma persona gana el enlace mas reciente", () => {
    const viejo = { uid: "viejo", updatedAtISO: "2026-01-01T00:00:00.000Z" };
    const nuevo = { uid: "nuevo", updatedAtISO: "2026-09-01T00:00:00.000Z" };
    const perfil = { name: "ANA" };

    const { primary, duplicates } = selectPrimaryLinkedProfiles(
        [{ link: viejo, profile: perfil }, { link: nuevo, profile: perfil }],
        workerLinkRecency
    );

    assert.equal(primary.length, 1);
    assert.equal(primary[0].link.uid, "nuevo");
    assert.deepEqual(duplicates.map(item => item.link.uid), ["viejo"]);
});

test("el arranque del cliente comprueba, no reescribe", () => {
    assert.match(cliente, /void verifyLinkedWorkerDocs\(\);/);
    // La comprobacion lee las colecciones y filtra por lo que cambio.
    assert.match(cliente, /firestoreModule\.getDocs\(/);
    assert.match(cliente, /linkedDocChanged\(stored\.get\(/);
    // Solo se escribe lo pendiente.
    assert.match(cliente, /await commitWorkerDocBatches\(pending, workspace\.id\)/);
});

test("si la comprobacion falla, la red tiende a reponer", () => {
    // Una red que no se puede comprobar tiene que publicar, no callarse: el
    // bootstrap existe porque una vez se perdio la publicacion y los
    // trabajadores nuevos no salian en Mensajes.
    const fn = cliente.slice(
        cliente.indexOf("async function verifyLinkedWorkerDocs("),
        cliente.indexOf("/** Los mismos documentos que arma el servidor")
    );

    assert.match(fn, /catch \(error\)/);
    assert.match(fn, /void publishLinkedWorkerDocs\(\);/);
});

test("cliente y servidor arman los documentos con el MISMO modulo", () => {
    // Es el objetivo de la migracion: con dos publicadores, cada campo nuevo
    // habia que cablearlo en dos sitios y podian divergir sin avisar.
    assert.match(cliente, /from "\.\/serverLinkedDocs\.js"/);
    assert.match(harness, /engine\.buildLinkedWorkerDocuments\(/);
});

test("la Cloud Function publica los documentos junto a la proyeccion", () => {
    assert.match(funcion, /await publishLinkedWorkerDocs\(db, workspaceId, workspace, links\)/);
    // Y siembra los dias bloqueados, que no viven en el estado del workspace.
    assert.match(funcion, /loadWorkerBlockedDays\(db, workspaceId\)/);
});

test("un fallo publicando los livianos no puede tumbar la proyeccion", () => {
    // La proyeccion es lo que mueve los turnos en el telefono: manda.
    const fn = funcion.slice(
        funcion.indexOf("async function publishLinkedWorkerDocs("),
        funcion.indexOf("exports.buildWorkerAppProjection")
    );

    assert.match(fn, /catch \(error\)/);
    assert.match(fn, /logger\.error\("worker-app linked docs failed"/);
});

test("el escritor lee de una pasada y solo escribe lo que cambio", () => {
    // 132 lecturas sueltas costarian lo mismo que el problema que se venia a
    // resolver: se leen las colecciones enteras, una consulta cada una.
    assert.match(escritor, /collectionRef\(db, workspaceId, name\)\.get\(\)/);
    assert.match(escritor, /if \(!changed\(current, payload\)\)/);
    assert.match(escritor, /skipped \+= 1/);
    // Y se escribe por lotes, nunca documento a documento.
    assert.match(escritor, /db\.batch\(\)/);
    assert.match(escritor, /BATCH_LIMIT/);
});

test("los duplicados se retiran solo si hace falta", () => {
    // Marcar como "unlinked" algo que ya lo esta seria una escritura inutil en
    // cada corrida.
    assert.match(escritor, /directory\.status !== "unlinked"/);
    assert.match(escritor, /candidate\.status !== "inactive"/);
});
