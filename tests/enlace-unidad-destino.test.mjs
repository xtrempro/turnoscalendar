// A que unidad apunta un enlace entre unidades.
//
// La solicitud se manda al CORREO DEL OWNER, y un owner puede tener varias
// unidades. Antes el destino no se preguntaba nunca: al aceptar, el enlace se
// amarraba en silencio a la unidad que ese owner tuviera activa en ese momento,
// que no tiene por que ser la que le estaban pidiendo. Y como el documento del
// enlace era uno solo por (unidad solicitante, owner), una segunda unidad del
// mismo dueño era imposible de enlazar.
//
// Ahora: el owner ELIGE su unidad al aceptar, quien solicita puede anotar cual
// espera, y cada solicitud abre su propio documento.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const leer = async name => (await readFile(
    new URL(name, import.meta.url), "utf8"
)).replace(/\r\n/g, "\n");

const dialogs = await leer("../js/dialogs.js");
const linkedUnits = await leer("../js/firebaseLinkedUnits.js");
const firebaseShell = await leer("../js/firebaseShell.js");
const workerRequests = await leer("../js/workerRequests.js");
const functionsSource = await leer("../functions/index.js");
const css = await leer("../styles.css");

function callableBlock(name, nextName) {
    const start = functionsSource.indexOf(`exports.${name} = onCall`);
    const end = functionsSource.indexOf(`exports.${nextName} = onCall`, start);

    assert.notEqual(start, -1, `no se encontro la Function ${name}`);
    assert.notEqual(end, -1, `no se encontro el limite de ${name}`);

    return functionsSource.slice(start, end);
}

/* =========================================================
   Elegir la unidad al aceptar
========================================================= */

test("hay un dialogo para elegir una opcion de una lista", () => {
    // No existia: solo alerta, confirmar y escribir un texto.
    assert.match(dialogs, /export function showChoice\(/);
    assert.match(dialogs, /type: "choice"/);
    assert.match(dialogs, /app-dialog__choices/);
    assert.match(css, /\.app-dialog__choices \{/);
});

test("cancelar el dialogo no elige nada", () => {
    // Si devolviera "" o false, el que llama no podria distinguir "cancele" de
    // "elegi la primera".
    assert.match(
        dialogs,
        /\(type === "prompt" \|\| type === "choice"\)\s*\n\s*\? null/
    );
});

test("solo ofrece unidades donde el usuario es OWNER", () => {
    // Las reglas exigen isOwner(toWorkspaceId) para responder el enlace: ofrecer
    // una unidad donde solo es miembro seria ofrecer algo que Firestore rechaza.
    assert.match(linkedUnits, /export async function listLinkTargetWorkspaces\(/);
    assert.match(
        linkedUnits,
        /String\(workspace\?\.role \|\| ""\) === "owner"/
    );
});

test("y nunca la unidad que esta solicitando", () => {
    assert.match(
        linkedUnits,
        /workspace\.id !== link\.fromWorkspaceId/
    );
    assert.match(linkedUnits, /No puedes enlazar una unidad consigo misma/);
});

test("el enlace se amarra a la unidad ELEGIDA, no a la activa", () => {
    assert.match(
        linkedUnits,
        /export async function acceptWorkspaceLink\(linkId, targetWorkspace = null\)/
    );
    assert.match(
        linkedUnits,
        /const target = targetWorkspace\?\.id\s*\n\s*\? targetWorkspace\s*\n\s*: activeWorkspace;/
    );
    // Y el payload de respuesta se arma con esa unidad.
    assert.match(
        linkedUnits,
        /\}, link, firestoreModule, target\)\);/
    );
});

test("la comprobacion de 'consigo misma' mira la unidad elegida", () => {
    // Con la activa nada mas, el owner parado en la unidad A no podia enlazar su
    // unidad B con A, y al reves se le colaba un enlace de A consigo misma.
    const bloque = linkedUnits.slice(
        linkedUnits.indexOf("function ensureLinkCanResolveHere(")
    ).slice(0, 900);

    assert.match(bloque, /targetWorkspace = null/);
    assert.match(bloque, /const target = targetWorkspace \|\| activeWorkspace;/);
    assert.match(bloque, /link\.fromWorkspaceId === target\.id/);
});

/* =========================================================
   Los dos lugares donde se acepta
========================================================= */

test("se pregunta desde Cuentas y Unidades", () => {
    assert.match(firebaseShell, /chooseWorkspaceForLink/);
    assert.match(
        firebaseShell,
        /const needsChoice = isOwnerPendingWorkspaceLink\(link, currentUser\);/
    );
    // Cancelar el dialogo no acepta el enlace.
    assert.match(firebaseShell, /if \(needsChoice && !target\) return;/);
    assert.match(firebaseShell, /await acceptWorkspaceLink\(linkId, target\);/);
});

test("y tambien desde el menu Solicitudes", () => {
    assert.match(workerRequests, /needsWorkspaceChoice: isOwnerPendingWorkspaceLink\(link\)/);
    assert.match(
        workerRequests,
        /request\.needsWorkspaceChoice\s*\n\s*\? await chooseWorkspaceForLink\(/
    );
    assert.match(
        workerRequests,
        /if \(request\.needsWorkspaceChoice && !target\) return;/
    );
    assert.match(workerRequests, /await acceptWorkspaceLink\(request\.linkId, target\);/);
});

test("la tarjeta avisa que la unidad se elige al aceptar", () => {
    assert.match(workerRequests, /Eliges tu unidad al aceptar/);
    assert.match(firebaseShell, /Eliges tu unidad al aceptar/);
});

/* =========================================================
   Decir que unidad se espera
========================================================= */

test("quien solicita puede anotar que unidad espera", () => {
    assert.match(firebaseShell, /firebaseLinkedExpectedWorkspaceName/);
    assert.match(
        firebaseShell,
        /await requestWorkspaceLink\(email, expectedWorkspaceName\)/
    );
    assert.match(
        linkedUnits,
        /expectedWorkspaceName: cleanText\(expectedWorkspaceName\)/
    );
    // Se sigue pidiendo el correo del owner, como antes.
    assert.match(
        firebaseShell,
        /Ingresa el correo del owner de la unidad que quieres enlazar/
    );
});

test("y esa nota llega a quien tiene que elegir", () => {
    assert.match(workerRequests, /Espera enlazar: \$\{request\.expectedWorkspaceName\}/);
    assert.match(firebaseShell, /Espera enlazar:/);
    assert.match(linkedUnits, /Dice esperar la unidad/);
});

test("la Function guarda la unidad esperada y el correo la nombra", () => {
    const source = callableBlock(
        "requestWorkspaceLinkByOwnerEmail",
        "claimSupervisorInvite"
    );

    assert.match(
        source,
        /cleanCallableText\(request\.data\?\.expectedWorkspaceName, 160\)/
    );
    assert.match(source, /expectedWorkspaceName,/);
    assert.match(functionsSource, /Dice esperar tu unidad/);
    // El correo ya no promete la unidad activa.
    assert.doesNotMatch(
        functionsSource,
        /quedara enlazada con la unidad que tengas activa/
    );
});

/* =========================================================
   Varias unidades del mismo owner
========================================================= */

test("una segunda solicitud al mismo owner ya no se rechaza", () => {
    const source = callableBlock(
        "requestWorkspaceLinkByOwnerEmail",
        "claimSupervisorInvite"
    );

    assert.doesNotMatch(
        source,
        /Ya existe un enlace activo con una unidad de ese owner/
    );
    // Cada solicitud abre su propio documento...
    assert.match(source, /db\.collection\("workspaceLinks"\)\.doc\(\)/);
    // ...salvo que haya una sin responder, que se reutiliza para no dejar dos
    // solicitudes colgando.
    assert.match(source, /const pendingLink = await findPendingWorkspaceLink\(/);
    assert.match(
        functionsSource,
        /async function findPendingWorkspaceLink\(fromWorkspaceId, ownerUid\)/
    );
});

test("solo se reutiliza una solicitud pendiente y sin unidad destino", () => {
    const bloque = functionsSource.slice(
        functionsSource.indexOf("async function findPendingWorkspaceLink(")
    ).slice(0, 900);

    assert.match(bloque, /String\(data\.status \|\| "pending"\) === "pending"/);
    assert.match(bloque, /!cleanCallableText\(data\.toWorkspaceId, 160\)/);
    // Dos igualdades: no necesita indice compuesto.
    assert.match(bloque, /\.where\("fromWorkspaceId", "==", fromWorkspaceId\)/);
    assert.match(bloque, /\.where\("toOwnerUid", "==", ownerUid\)/);
});
