import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workerRequests = readFileSync("js/workerRequests.js", "utf8");
const main = readFileSync("js/main.js", "utf8");

test("el panel Solicitudes incluye aprobaciones de supervisor", () => {
    assert.match(workerRequests, /supervisor_invite: "Acceso Supervisor"/);
    assert.match(workerRequests, /listSupervisorInvitations/);
    assert.match(workerRequests, /getSupervisorInviteRequests/);
    assert.match(workerRequests, /supervisorInviteToPanelRequest/);
    assert.match(
        workerRequests,
        /const allRequests = \[[\s\S]*\.\.\.supervisorInviteRequests/
    );
    assert.match(
        workerRequests,
        /const pending = \[[\s\S]*\.\.\.supervisorInviteRequests/
    );
});

test("las solicitudes de supervisor se pueden aprobar o rechazar desde Solicitudes", () => {
    assert.match(workerRequests, /approveSupervisorInviteRequest/);
    assert.match(workerRequests, /rejectSupervisorInviteRequest/);
    assert.match(workerRequests, /showSupervisorInvitePermissionsDialog/);
    assert.match(workerRequests, /approveSupervisorInvitation/);
    assert.match(workerRequests, /rejectSupervisorInvitation/);
    assert.match(
        workerRequests,
        /isSupervisorInviteRequest\(request\)[\s\S]*approveSupervisorInviteRequest/
    );
});

test("el badge de Solicitudes escucha cambios de supervisorInvites", () => {
    assert.match(workerRequests, /startSupervisorInviteRequestsListener/);
    assert.match(workerRequests, /"supervisorInvites"/);
    assert.match(workerRequests, /proturnos:workerRequestsChanged/);
    assert.match(main, /startSupervisorInviteRequestsListener/);
    assert.match(main, /stopSupervisorInviteRequestsListener/);
});
