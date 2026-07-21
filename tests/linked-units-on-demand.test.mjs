import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const {
    TURN,
    actualTurn,
    canCover,
    profilesAreCompatible
} = require("../functions/linkedReplacementSearch.js");

test("calcula disponibilidad puntual sin estado del navegador", () => {
    const state = {
        "rotativa_Ana": JSON.stringify({
            type: "4turno",
            start: "2026-06-30",
            firstTurn: "larga"
        }),
        replacements: JSON.stringify([]),
        swaps: JSON.stringify([])
    };

    assert.equal(actualTurn(state, "Ana", "2026-06-30"), TURN.LONG);
    assert.equal(canCover(TURN.LONG, TURN.NIGHT, true), true);
    assert.equal(canCover(TURN.LONG, TURN.NIGHT, false), false);
});

test("mantiene compatibilidad por estamento y profesion", () => {
    assert.equal(profilesAreCompatible(
        { estamento: "Profesional", profession: "Enfermeria" },
        { estamento: "Profesional", profession: "Enfermería" }
    ), true);
    assert.equal(profilesAreCompatible(
        { estamento: "Auxiliar", profession: "" },
        { estamento: "Administrativo", profession: "" }
    ), false);
});

test("las unidades enlazadas solo se consultan desde la accion explicita", async () => {
    const [
        main,
        calendar,
        loans,
        service,
        worker,
        workerRequests,
        firebaseShell,
        functions
    ] =
        await Promise.all([
            readFile(new URL("../js/main.js", import.meta.url), "utf8"),
            readFile(new URL("../js/calendar.js", import.meta.url), "utf8"),
            readFile(new URL(
                "../js/firebaseInterUnitLoans.js",
                import.meta.url
            ), "utf8"),
            readFile(new URL(
                "../js/linkedReplacementService.js",
                import.meta.url
            ), "utf8"),
            readFile(new URL(
                "../js/workers/scheduleWorker.js",
                import.meta.url
            ), "utf8"),
            readFile(new URL("../js/workerRequests.js", import.meta.url), "utf8"),
            readFile(new URL("../js/firebaseShell.js", import.meta.url), "utf8"),
            readFile(new URL("../functions/index.js", import.meta.url), "utf8")
        ]);

    assert.doesNotMatch(main, /scheduleInterUnitStaffingPublish/);
    assert.doesNotMatch(main, /startWorkerRequestsRealtimeSync/);
    assert.doesNotMatch(loans, /listAcceptedLinkedWorkspaces/);
    assert.doesNotMatch(loans, /linkedStaffingMonths/);
    assert.doesNotMatch(loans, /proturnos:(?:persistenceChanged|firebaseAppState)/);
    assert.doesNotMatch(worker, /BUILD_INTER_UNIT_MONTHS/);
    assert.doesNotMatch(calendar, /readLinkedStaffingMonth|listAcceptedLinkedWorkspaces/);
    assert.match(
        calendar,
        /data-action="linked-units"[\s\S]{0,500}Buscar reemplazo compatible en unidades enlazadas/
    );
    assert.match(calendar, /findCompatibleReplacementInLinkedUnits\(\{/);
    assert.match(
        service,
        /httpsCallable\([\s\S]*"findCompatibleReplacementInLinkedUnits"/
    );
    assert.doesNotMatch(service, /addEventListener|onSnapshot|listAcceptedLinkedWorkspaces/);
    assert.match(workerRequests, /where\("toOwnerUid",\s*"=="/);
    assert.match(
        workerRequests,
        /workspaceLinks[\s\S]{0,600}onSnapshot|onSnapshot[\s\S]{0,600}workspaceLinks/
    );
    assert.doesNotMatch(
        firebaseShell,
        /await refreshWorkspaces\(\);\s*await refreshLinkedUnits\(\);\s*if \(hasValidActiveWorkspace/
    );
    assert.match(
        functions,
        /exports\.findCompatibleReplacementInLinkedUnits = onCall/
    );
});
