import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [
    rules,
    functionsIndex,
    supervisorMessages,
    workerAppInvites,
    workerAppDataSync,
    packageText
] = await Promise.all([
    readFile(new URL("firebase.rules", root), "utf8"),
    readFile(new URL("functions/index.js", root), "utf8"),
    readFile(new URL("js/supervisorMessages.js", root), "utf8"),
    readFile(new URL("js/workerAppInvites.js", root), "utf8"),
    readFile(new URL("js/workerAppDataSync.js", root), "utf8"),
    readFile(new URL("package.json", root), "utf8")
]);
const packageJson = JSON.parse(packageText);

function extractFunction(source, name) {
    const signature = `function ${name}`;
    const start = source.indexOf(signature);
    assert.notEqual(start, -1, `No se encontro ${signature}`);

    const paramsStart = source.indexOf("(", start);
    assert.notEqual(paramsStart, -1, `No se encontraron parametros de ${signature}`);

    let parenDepth = 0;
    let paramsEnd = -1;
    for (let index = paramsStart; index < source.length; index += 1) {
        if (source[index] === "(") parenDepth += 1;
        if (source[index] === ")") parenDepth -= 1;

        if (parenDepth === 0) {
            paramsEnd = index;
            break;
        }
    }
    assert.notEqual(paramsEnd, -1, `No se cerraron parametros de ${signature}`);

    const openBrace = source.indexOf("{", paramsEnd);
    assert.notEqual(openBrace, -1, `No se encontro cuerpo de ${signature}`);

    let depth = 0;
    for (let index = openBrace; index < source.length; index += 1) {
        if (source[index] === "{") depth += 1;
        if (source[index] === "}") depth -= 1;

        if (depth === 0) {
            return source.slice(start, index + 1);
        }
    }

    assert.fail(`No se pudo cerrar ${signature}`);
}

function sectionBetween(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `No se encontro ${startNeedle}`);

    const end = source.indexOf(endNeedle, start + startNeedle.length);
    assert.notEqual(end, -1, `No se encontro ${endNeedle}`);

    return source.slice(start, end);
}

test("security:check ejecuta las regresiones de mensajeria", () => {
    assert.equal(
        packageJson.scripts["test:messaging"],
        "node --test tests/messaging-regression.test.mjs"
    );
    assert.match(packageJson.scripts["security:check"], /npm run test:messaging/);
});

test("las reglas permiten listar solo hilos propios entre trabajadores", () => {
    assert.match(
        rules,
        /function canReadWorkerPeerThread\(workspaceId\) \{[\s\S]*isCurrentLinkedWorker\(workspaceId\)[\s\S]*request\.auth\.uid in resource\.data\.participantUids[\s\S]*\}/
    );
    assert.match(
        rules,
        /match \/workerPeerThreads\/\{threadId\} \{[\s\S]*allow read: if canReadWorkerPeerThread\(workspaceId\);/
    );
});

test("las push de mensajes abren Mensajes y el chat correcto", () => {
    const supervisorPush = sectionBetween(
        functionsIndex,
        "exports.notifySupervisorMessageCreated = onDocumentCreated",
        "exports.notifyWorkerPeerMessageCreated = onDocumentCreated"
    );
    const workerPeerPush = sectionBetween(
        functionsIndex,
        "exports.notifyWorkerPeerMessageCreated = onDocumentCreated",
        "async function sendWorkerPush"
    );

    assert.match(supervisorPush, /uid: workerUid/);
    assert.match(supervisorPush, /type: "supervisor_message_created"/);
    assert.match(supervisorPush, /screen: "mensajes"/);
    assert.match(supervisorPush, /url: `\$\{WORKER_APP_BASE_URL\}\?screen=mensajes`/);
    assert.match(workerPeerPush, /uid: targetUid/);
    assert.match(workerPeerPush, /type: "worker_peer_message_created"/);
    assert.match(workerPeerPush, /screen: "mensajes"/);
    assert.match(workerPeerPush, /url: `\$\{WORKER_APP_BASE_URL\}\?screen=mensajes&peer=\$\{encodeURIComponent\(senderUid\)\}`/);
});

test("el panel supervisor ordena chats y muestra badges por trabajador", () => {
    const activeLinkedWorkers = extractFunction(
        supervisorMessages,
        "activeLinkedWorkers"
    );
    const historicalMessageWorkers = extractFunction(
        supervisorMessages,
        "historicalMessageWorkers"
    );
    const linkedWorkers = extractFunction(supervisorMessages, "linkedWorkers");
    const explicitThreadUnreadCount = extractFunction(
        supervisorMessages,
        "explicitThreadUnreadCount"
    );
    const workerUnreadCount = extractFunction(supervisorMessages, "workerUnreadCount");
    const updateTotalUnreadCount = extractFunction(
        supervisorMessages,
        "updateTotalUnreadCount"
    );
    const sortWorkersForMessages = extractFunction(
        supervisorMessages,
        "sortWorkersForMessages"
    );
    const renderMessagesLayout = extractFunction(
        supervisorMessages,
        "renderMessagesLayout"
    );

    assert.match(activeLinkedWorkers, /isActive: true/);
    assert.match(activeLinkedWorkers, /isHistorical: false/);
    assert.match(historicalMessageWorkers, /Array\.from\(threadIndex\.values\(\)\)/);
    assert.match(historicalMessageWorkers, /!activeByUid\.has\(thread\.uid\)/);
    assert.match(historicalMessageWorkers, /isActive: false/);
    assert.match(historicalMessageWorkers, /isHistorical: true/);
    assert.match(linkedWorkers, /historicalMessageWorkers\(byUid\)\.forEach/);
    assert.match(explicitThreadUnreadCount, /thread\.unreadForSupervisorCount/);
    assert.match(explicitThreadUnreadCount, /thread\.unreadSupervisorCount/);
    assert.match(workerUnreadCount, /if \(!thread\?\.unreadForSupervisor\) return 0/);
    assert.match(workerUnreadCount, /explicitThreadUnreadCount\(thread\) \|\|/);
    assert.match(workerUnreadCount, /threadUnreadCounts\.get\(uid\) \|\|/);
    assert.match(updateTotalUnreadCount, /total \+ workerUnreadCount\(uid\)/);
    assert.match(updateTotalUnreadCount, /updateFloatingBadge\(\)/);
    assert.match(sortWorkersForMessages, /return bTime - aTime/);
    assert.match(renderMessagesLayout, /const unread = workerUnreadCount\(item\.uid\)/);
    assert.match(renderMessagesLayout, /supervisor-message-unread-badge/);
    assert.match(renderMessagesLayout, /const canSend = Boolean\(worker\?\.uid\) && worker\.isActive !== false/);
    assert.match(renderMessagesLayout, /supervisor-message-disabled-note/);
    assert.match(renderMessagesLayout, /Este trabajador ya no tiene la aplicacion enlazada\. El historial queda disponible\./);
    assert.match(renderMessagesLayout, /type="submit" \$\{canSend \? "" : "disabled"\}/);
});

test("leer y responder desde supervisor limpia solo no leidos del supervisor", () => {
    const writeSupervisorMessage = extractFunction(
        supervisorMessages,
        "writeSupervisorMessage"
    );
    const markThreadReadBySupervisor = extractFunction(
        supervisorMessages,
        "markThreadReadBySupervisor"
    );
    const sendSupervisorMessage = extractFunction(
        supervisorMessages,
        "sendSupervisorMessage"
    );
    const sendMassMessage = extractFunction(supervisorMessages, "sendMassMessage");

    assert.match(sendSupervisorMessage, /if \(worker\.isActive === false\)/);
    assert.match(sendMassMessage, /activeLinkedWorkers\(\)[\s\S]*\.filter\(item => massSelected\.has\(item\.uid\)\)/);
    assert.match(writeSupervisorMessage, /if \(worker\?\.isActive === false\)/);
    assert.match(writeSupervisorMessage, /unreadForWorker: true/);
    assert.match(writeSupervisorMessage, /unreadForSupervisor: false/);
    assert.match(writeSupervisorMessage, /unreadForSupervisorCount: 0/);
    assert.match(writeSupervisorMessage, /readBySupervisor: true/);
    assert.match(writeSupervisorMessage, /readByWorker: false/);
    assert.match(writeSupervisorMessage, /threadUnreadCounts\.set\(worker\.uid, 0\)/);
    assert.match(markThreadReadBySupervisor, /where\("readBySupervisor", "==", false\)/);
    assert.match(markThreadReadBySupervisor, /\(docSnap\.data\(\) \|\| \{\}\)\.sender !== "supervisor"/);
    assert.match(markThreadReadBySupervisor, /unreadForSupervisor: false/);
    assert.match(markThreadReadBySupervisor, /unreadForSupervisorCount: 0/);
    assert.match(markThreadReadBySupervisor, /threadUnreadCounts\.set\(uid, 0\)/);
});

test("desenlazar no borra historial y marca contactos como historicos", () => {
    const unlinkWorkerApp = extractFunction(workerAppInvites, "unlinkWorkerApp");
    const buildUnlinkedPayload = extractFunction(
        workerAppDataSync,
        "buildUnlinkedWorkerMessageDirectoryPayload"
    );
    const markUnlinkedDirectoryEntries = extractFunction(
        workerAppDataSync,
        "markUnlinkedWorkerMessageDirectoryEntries"
    );
    const startSupervisorMessages = extractFunction(
        workerAppDataSync,
        "startWorkerAppDataSync"
    );

    assert.match(unlinkWorkerApp, /"workerMessageDirectory",\s*link\.uid/);
    assert.match(unlinkWorkerApp, /status: "unlinked"/);
    assert.match(unlinkWorkerApp, /"workerSwapCandidates",\s*link\.uid/);
    assert.doesNotMatch(unlinkWorkerApp, /"workerMessages"/);
    assert.doesNotMatch(unlinkWorkerApp, /"workerPeerThreads"/);
    assert.match(buildUnlinkedPayload, /status: "unlinked"/);
    assert.match(markUnlinkedDirectoryEntries, /includeOrphans/);
    assert.match(markUnlinkedDirectoryEntries, /String\(data\.status \|\| "active"\) !== "active"/);
    assert.match(startSupervisorMessages, /markUnlinkedWorkerMessageDirectoryEntries\([\s\S]*includeOrphans: initial/);
});
